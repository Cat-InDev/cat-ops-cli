const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    Context, Notifier, ServiceError, CodedError, GENERIC_ERRORS,
    classifiers, messages, senders, codes, codeMatches
} = require("../dist");

function captureConsole() {
    const methods = ["log", "warn", "error"];
    const originals = methods.map(name => console[name]);
    const lines = [];
    methods.forEach(name => { console[name] = (...args) => lines.push(args.join(" ")); });
    return { lines, restore() { methods.forEach((name, i) => { console[name] = originals[i]; }); } };
}

const execError = (command, args, stderr, extra = {}) => ({ code: 1, stdout: "", stderr, command, args, ...extra });

const k8sError = () => Object.assign(new Error("[K8S-101-TIMEOUT] Timeout esperando el rollout de \"api\""), {
    code: "K8S-101-TIMEOUT",
    causes: [{ code: "K8S-201-OOMKILLED", pod: "api-1", container: "app", detail: "límite de memoria 256Mi" }]
});

async function report(notifier, taskId, error) {
    let event;
    notifier.channel("*", e => { event = e; });
    await notifier.reportError(taskId, error, {});
    return event;
}

// ---------------------------------------------------------------------------
// Código por defecto en todas las tareas
// ---------------------------------------------------------------------------

test("todo evento de error lleva código: genérico por forma del error", async () => {

    assert.equal((await report(new Notifier(), "t", new Error("boom"))).code, "GEN-000-UNKNOWN");
    assert.equal((await report(new Notifier(), "t", execError("docker", ["push"], "500"))).code, "GEN-001-EXEC");
    assert.equal((await report(new Notifier(), "t", execError("helm", [], "", { timedOut: true }))).code, "GEN-002-EXECTIMEOUT");
    assert.equal((await report(new Notifier(), "t", "texto suelto")).code, "GEN-000-UNKNOWN");
    assert.equal(GENERIC_ERRORS.EXEC.code, "GEN-001-EXEC");

});

test("usa el código propio del error (K8S, CodedError) y lo busca dentro de ServiceError", async () => {

    const k8s = await report(new Notifier(), "deploy", k8sError());
    assert.equal(k8s.code, "K8S-101-TIMEOUT");
    assert.deepEqual(k8s.causes.map(c => c.code), ["K8S-201-OOMKILLED"]);

    const coded = await report(new Notifier(), "cfg", new CodedError("APP-100-CONFIG", "Falta DB_URL"));
    assert.equal(coded.code, "APP-100-CONFIG");

    const wrapped = await report(new Notifier(), "svc", new ServiceError("kubectl", "waitForDeployment", [], k8sError()));
    assert.equal(wrapped.code, "K8S-101-TIMEOUT");
    assert.equal(wrapped.causes.length, 1);

    // Un `code` que no cumple el formato (p. ej. de Node) no se toma como código.
    const node = await report(new Notifier(), "fs", Object.assign(new Error("no existe"), { code: "ENOENT" }));
    assert.equal(node.code, "GEN-000-UNKNOWN");

});

test("CodedError valida el formato del código", () => {
    assert.throws(() => new CodedError("APP-CONFIG", "x"), /formato esperado/);
    assert.throws(() => new CodedError("app-100-config", "x"), /formato esperado/);
});

test("ctx.run, menú y ctx.failures llevan el código", async () => {

    const ctx = Context.reset();
    const events = [];
    ctx.notifier.channel("*", e => events.push(e));

    await assert.rejects(ctx.run("deploy", () => { throw new CodedError("APP-200-DEPLOY", "falló"); }));

    ctx.markFailure("deploy", new CodedError("APP-200-DEPLOY", "falló"));

    assert.equal(events[0].code, "APP-200-DEPLOY");
    assert.equal(ctx.failures[0].code, "APP-200-DEPLOY");

});

// ---------------------------------------------------------------------------
// notifier.code(...) — asignar códigos propios
// ---------------------------------------------------------------------------

test("notifier.code con codes.byRule/byCommand/byPattern/byService reemplaza al genérico", async () => {

    const notifier = new Notifier()
        .code(codes.byRule([
            { command: "docker", args: "push", pattern: /500/, code: "DOCKER-101-PUSH500" },
            { command: "docker", args: "build", code: "DOCKER-102-BUILD" }
        ]))
        .code(codes.byPattern([[/no space left/i, "INFRA-100-NOSPACE"]]))
        .code(codes.byService({ http: "HTTP-000-ERROR" }))
        .code(codes.byCommand({ docker: "DOCKER-000-EXEC" }));

    const resolve = error => notifier.resolveCode(error, {});

    assert.equal(resolve(execError("docker", ["push", "img"], "500 Internal Server Error")), "DOCKER-101-PUSH500");
    assert.equal(resolve(execError("docker", ["build", "."], "x")), "DOCKER-102-BUILD");
    assert.equal(resolve(execError("tar", [], "write: no space left on device")), "INFRA-100-NOSPACE");
    assert.equal(resolve(new ServiceError("http", "get", [], new Error("timeout"))), "HTTP-000-ERROR");
    assert.equal(resolve(execError("docker", ["tag"], "x")), "DOCKER-000-EXEC");
    assert.equal(resolve(execError("git", ["push"], "x")), "GEN-001-EXEC", "lo no mapeado sigue genérico");

});

test("el resolver propio tiene prioridad sobre el código del error; códigos inválidos se ignoran", async () => {

    const notifier = new Notifier()
        .code(() => "no-es-un-codigo")
        .code(error => error.code === "K8S-101-TIMEOUT" ? "TEAM-101-K8STIMEOUT" : undefined);

    assert.equal(notifier.resolveCode(k8sError(), {}), "TEAM-101-K8STIMEOUT");

});

test("codes.* rechaza códigos mal formados al registrarlos", () => {
    assert.throws(() => codes.byCommand({ docker: "docker-error" }), /Código de error inválido/);
});

// ---------------------------------------------------------------------------
// notifier.mapCode(...) — interceptar por código
// ---------------------------------------------------------------------------

test("mapCode cambia mensaje y área por código exacto, con plantilla", async () => {

    const notifier = new Notifier()
        .code(codes.byRule([{ command: "docker", args: "push", code: "DOCKER-100-PUSH" }]))
        .mapCode("DOCKER-100-PUSH", { message: "[{code}] {taskId}: no se pudo subir la imagen", area: "containers" });

    const received = [];
    notifier.channel("containers", e => received.push(e));

    const area = await notifier.reportError("publish", execError("docker", ["push", "img"], "denied: requested access"), {});

    assert.equal(area, "containers");
    assert.equal(received[0].message, "[DOCKER-100-PUSH] publish: no se pudo subir la imagen");
    assert.equal(received[0].rawMessage, "denied: requested access");
    assert.equal(received[0].mappedCode, "DOCKER-100-PUSH");

});

test("mapCode matchea causas secundarias si no hay mapeo del principal, y acepta glob/función", async () => {

    const notifier = new Notifier()
        .mapCode("K8S-201-*", { message: (info) => `Sin memoria (${info.matchedCode}) en ${info.causes[0].pod}; principal ${info.code}` });

    const event = await report(notifier, "deploy", k8sError());

    assert.equal(event.mappedCode, "K8S-201-OOMKILLED");
    assert.equal(event.message, "Sin memoria (K8S-201-OOMKILLED) en api-1; principal K8S-101-TIMEOUT");

    const primaryFirst = new Notifier()
        .mapCode("K8S-201-OOMKILLED", { message: "por causa" })
        .mapCode(/^K8S-1/, { message: "por principal" });

    assert.equal((await report(primaryFirst, "d", k8sError())).message, "por principal");

});

test("mapCode tiene prioridad sobre classify/describeError; sin mapeo se usan ellos", async () => {

    const notifier = new Notifier()
        .classify(() => "general")
        .describeError(() => "mensaje del formatter")
        .mapCode("APP-100-CONFIG", { message: "mensaje del mapeo", area: "apps" });

    const mapped = await report(notifier, "a", new CodedError("APP-100-CONFIG", "x"));
    assert.equal(mapped.area, "apps");
    assert.equal(mapped.message, "mensaje del mapeo");

    const notMapped = await report(new Notifier().classify(() => "general").describeError(() => "mensaje del formatter"), "b", new Error("x"));
    assert.equal(notMapped.area, "general");
    assert.equal(notMapped.message, "mensaje del formatter");
    assert.equal(notMapped.mappedCode, undefined);

});

test("classifiers.byCode y messages.byCode por código (glob)", async () => {

    const notifier = new Notifier()
        .classify(classifiers.byCode({ "K8S-*": "kubernetes", "GEN-001-EXEC": "pipeline" }))
        .describeError(messages.byCode({ "K8S-101-TIMEOUT": "El rollout no terminó a tiempo" }));

    const k8s = await report(notifier, "d", k8sError());
    assert.equal(k8s.area, "kubernetes");
    assert.equal(k8s.message, "El rollout no terminó a tiempo");

    const exec = await report(notifier, "e", execError("npm", ["ci"], "ERR!"));
    assert.equal(exec.area, "pipeline");

});

test("codeMatches: exacto, glob, RegExp y lista", () => {
    assert.ok(codeMatches("K8S-201-OOMKILLED", "K8S-201-OOMKILLED"));
    assert.ok(codeMatches("K8S-2*", "K8S-201-OOMKILLED"));
    assert.ok(!codeMatches("K8S-1*", "K8S-201-OOMKILLED"));
    assert.ok(codeMatches(/OOM/, "K8S-201-OOMKILLED"));
    assert.ok(codeMatches(["GEN-*", "K8S-201-OOMKILLED"], "K8S-201-OOMKILLED"));
});

// ---------------------------------------------------------------------------
// senders.console() — canal de consola para verificar códigos
// ---------------------------------------------------------------------------

test("senders.console muestra código, mapeo, mensaje original, causas y sugiere mapear los genéricos", async () => {

    const output = captureConsole();

    try {

        const notifier = new Notifier()
            .mapCode("K8S-201-OOMKILLED", { message: "Sin memoria" })
            .channel("*", senders.console());

        await notifier.reportError("deploy", k8sError(), {});
        await notifier.reportError("build", execError("docker", ["build"], "falló el build"), {});
        await notifier.reportError("ok", execError("docker", ["build"], "x"), {});

    } finally {
        output.restore();
    }

    const [main, original, cause] = output.lines;

    assert.match(main, /\[K8S-101-TIMEOUT\] \(mapeado por K8S-201-OOMKILLED\) \[unclassified\] deploy: Sin memoria/);
    assert.match(original, /original: \[K8S-101-TIMEOUT\] Timeout/);
    assert.match(cause, /causa K8S-201-OOMKILLED \| pod api-1 \| container app \| límite de memoria 256Mi/);
    assert.ok(output.lines.some(line => /\[GEN-001-EXEC\] .*build: falló el build/.test(line)));
    assert.ok(output.lines.some(line => /\[GEN-001-EXEC\] código genérico/.test(line)));

});

test("senders.console con `only` filtra por código y con opciones apaga detalles", async () => {

    const output = captureConsole();

    try {
        const notifier = new Notifier().channel("*", senders.console({ only: "K8S-*", causes: false, success: false }));
        await notifier.reportError("build", execError("docker", ["build"], "x"), {});
        await notifier.reportError("deploy", k8sError(), {});
        await notifier.reportSuccess("ok", 1, {});
    } finally {
        output.restore();
    }

    assert.equal(output.lines.length, 1);
    assert.match(output.lines[0], /K8S-101-TIMEOUT/);

});

test("senders.log incluye el código", async () => {

    const output = captureConsole();

    try {
        await new Notifier().channel("*", senders.log()).reportError("t", new CodedError("APP-100-CONFIG", "x"), {});
    } finally {
        output.restore();
    }

    assert.match(output.lines[0], /\[unclassified\] \[APP-100-CONFIG\] t: x/);

});

test("mapCode: mensaje y área se resuelven por separado (área por principal, mensaje por causa)", async () => {

    const notifier = new Notifier()
        .mapCode("K8S-201-OOMKILLED", { message: "Sin memoria en {taskId}" })
        .mapCode("K8S-1*", { area: "kubernetes" });

    const received = [];
    notifier.channel("kubernetes", e => received.push(e));

    await notifier.reportError("deploy-api", k8sError(), {});

    assert.equal(received.length, 1);
    assert.equal(received[0].area, "kubernetes");
    assert.equal(received[0].message, "Sin memoria en deploy-api");
    assert.equal(received[0].mappedCode, "K8S-201-OOMKILLED");

});
