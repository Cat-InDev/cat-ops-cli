const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    Context,
    Notifier,
    ServiceError,
    classifiers,
    messages
} = require("../dist");

// ---------------------------------------------------------------------------
// ServiceError
// ---------------------------------------------------------------------------

test("ServiceError: extiende Error con service, method, args, cause", () => {

    const cause = { command: "docker", args: ["push"], stderr: "denied" };
    const err = new ServiceError("docker", "push", ["myimage:latest"], cause);

    assert.ok(err instanceof Error);
    assert.equal(err.name, "ServiceError");
    assert.equal(err.service, "docker");
    assert.equal(err.method, "push");
    assert.deepEqual(err.args, ["myimage:latest"]);
    assert.equal(err.cause, cause);
    assert.ok(err.message.includes("docker.push"));

});

test("ServiceError: causa nativa de Error extrae message", () => {

    const cause = new Error("connection refused");
    const err = new ServiceError("http", "request", [{ url: "http://x" }], cause);

    assert.ok(err.message.includes("http.request"));
    assert.ok(err.message.includes("connection refused"));

});

test("ServiceError: causa string extrae String(cause)", () => {

    const err = new ServiceError("custom", "do", [], "raw failure");

    assert.ok(err.message.includes("custom.do"));
    assert.ok(err.message.includes("raw failure"));

});

// ---------------------------------------------------------------------------
// ctx.wrap() — Proxy interceptor
// ---------------------------------------------------------------------------

test("ctx.wrap(): exito pasa el resultado sin intervenir", async () => {

    const ctx = Context.reset();

    const fakeService = {
        add: async (a, b) => a + b,
        greet: async (name) => `hola ${name}`
    };

    const wrapped = ctx.wrap(fakeService, "math");

    assert.equal(await wrapped.add(2, 3), 5);
    assert.equal(await wrapped.greet("mundo"), "hola mundo");

});

test("ctx.wrap(): error lanza ServiceError y despacha al notifier", async () => {

    const ctx = Context.reset();
    const events = [];

    ctx.notifier.classify(classifiers.byService({ mysvc: "ops" }));
    ctx.notifier.channel("ops", event => events.push(event));

    const fakeService = {
        fail: async () => { throw new Error("boom"); }
    };

    const wrapped = ctx.wrap(fakeService, "mysvc");

    await assert.rejects(
        () => wrapped.fail(),
        err => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.service, "mysvc");
            assert.equal(err.method, "fail");
            assert.deepEqual(err.args, []);
            assert.equal(err.cause.message, "boom");
            return true;
        }
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].service, "mysvc");
    assert.equal(events[0].method, "fail");
    assert.deepEqual(events[0].args, []);
    assert.equal(events[0].area, "ops");
    assert.ok(events[0].taskId.includes("mysvc.fail"));

});

test("ctx.wrap(): ServiceError envuelve ExecResult con command/args", async () => {

    const ctx = Context.reset();
    const events = [];

    ctx.notifier.classify(classifiers.byCommand({ docker: "containers" }));
    ctx.notifier.channel("containers", event => events.push(event));

    const fakeDocker = {
        push: async () => {
            throw { command: "docker", args: ["push", "img"], stderr: "denied" };
        }
    };

    const wrapped = ctx.wrap(fakeDocker, "docker");

    await assert.rejects(() => wrapped.push("img"));

    assert.equal(events.length, 1);
    // byCommand should still work because it unwraps ServiceError.cause
    assert.equal(events[0].area, "containers");
    assert.equal(events[0].service, "docker");
    assert.equal(events[0].method, "push");

});

test("ctx.wrap(): propiedades no-función pasan sin proxy", async () => {

    const ctx = Context.reset();

    const fakeService = {
        version: "1.0",
        doStuff: async () => "ok"
    };

    const wrapped = ctx.wrap(fakeService, "svc");

    assert.equal(wrapped.version, "1.0");
    assert.equal(await wrapped.doStuff(), "ok");

});

test("ctx.wrap(): serializa args en taskId", async () => {

    const ctx = Context.reset();
    const events = [];

    ctx.notifier.channel("*", event => events.push(event));

    const fakeService = {
        deploy: async (env, tag) => { throw new Error("fail"); }
    };

    const wrapped = ctx.wrap(fakeService, "k8s");

    await assert.rejects(() => wrapped.deploy("prod", "v1.2.3"));

    assert.ok(events[0].taskId.includes('"prod"'));
    assert.ok(events[0].taskId.includes('"v1.2.3"'));

});

// ---------------------------------------------------------------------------
// Notifier: popula service/method/args en NotificationEvent
// ---------------------------------------------------------------------------

test("Notifier reportError(): popula service/method/args si error es ServiceError", async () => {

    const notifier = new Notifier();
    let received;

    notifier.channel("*", event => { received = event; });

    const cause = { command: "kubectl", stderr: "timeout" };
    const serviceError = new ServiceError("kubectl", "rollout", ["status", "deploy/myapp"], cause);

    await notifier.reportError("deploy", serviceError, {});

    assert.equal(received.service, "kubectl");
    assert.equal(received.method, "rollout");
    assert.deepEqual(received.args, ["status", "deploy/myapp"]);
    assert.equal(received.error, serviceError);

});

test("Notifier reportError(): NO popula service/method/args si error es raw", async () => {

    const notifier = new Notifier();
    let received;

    notifier.channel("*", event => { received = event; });

    await notifier.reportError("task", new Error("raw error"), {});

    assert.equal(received.service, undefined);
    assert.equal(received.method, undefined);
    assert.equal(received.args, undefined);

});

// ---------------------------------------------------------------------------
// Notifier toMessage unwrap: ServiceError.message tiene prioridad
// ---------------------------------------------------------------------------

test("Notifier toMessage(): usa ServiceError.message si tiene prioridad", async () => {

    const notifier = new Notifier();
    let received;

    notifier.channel("*", event => { received = event; });

    const cause = new Error("original message");
    const serviceError = new ServiceError("docker", "push", [], cause);

    await notifier.reportError("task", serviceError, {});

    // ServiceError.message = "docker.push: original message"
    assert.ok(received.message.includes("docker.push"));
    assert.ok(received.message.includes("original message"));

});

// ---------------------------------------------------------------------------
// classifiers.byService
// ---------------------------------------------------------------------------

test("classifiers.byService(): clasifica por nombre de servicio", () => {

    const classify = classifiers.byService({
        docker: "containers",
        http: "networking"
    });

    const svcErr = new ServiceError("docker", "push", [], new Error("fail"));
    assert.equal(classify(svcErr), "containers");

    const httpErr = new ServiceError("http", "request", [], new Error("timeout"));
    assert.equal(classify(httpErr), "networking");

});

test("classifiers.byService(): retorna undefined si no es ServiceError", () => {

    const classify = classifiers.byService({ docker: "containers" });

    assert.equal(classify(new Error("raw")), undefined);
    assert.equal(classify({ command: "docker", stderr: "x" }), undefined);

});

// ---------------------------------------------------------------------------
// classifiers.byCommand unwrap: funciona con ServiceError.cause
// ---------------------------------------------------------------------------

test("classifiers.byCommand(): unwrap ServiceError.cause.command", () => {

    const classify = classifiers.byCommand({ docker: "containers" });

    // ServiceError que wrappea un ExecResult
    const execResult = { command: "docker", stderr: "denied" };
    const svcErr = new ServiceError("docker", "push", [], execResult);

    assert.equal(classify(svcErr), "containers");

    // Raw error sigue funcionando
    assert.equal(classify(execResult), "containers");

});

// ---------------------------------------------------------------------------
// classifiers.byPattern unwrap: funciona con ServiceError.cause
// ---------------------------------------------------------------------------

test("classifiers.byPattern(): unwrap ServiceError.cause para extraer texto", () => {

    const classify = classifiers.byPattern([
        [/permission denied/i, "security"],
        [/timeout/i, "networking"]
    ]);

    // ServiceError que wrappea ExecResult con stderr
    const execResult = { command: "docker", stderr: "permission denied" };
    const svcErr = new ServiceError("docker", "push", [], execResult);

    assert.equal(classify(svcErr), "security");

    // Raw error sigue funcionando
    assert.equal(classify({ stderr: "timeout" }), "networking");

});

// ---------------------------------------------------------------------------
// messages.byService
// ---------------------------------------------------------------------------

test("messages.byService(): devuelve mensaje por servicio", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byService({
        docker: "Error de Docker",
        http: "Error de red"
    }));
    notifier.channel("*", event => { received = event; });

    const svcErr = new ServiceError("docker", "push", [], new Error("fail"));
    await notifier.reportError("t", svcErr, {});

    assert.equal(received.message, "Error de Docker");

});

test("messages.byService(): retorna undefined si no es ServiceError", () => {

    const format = messages.byService({ docker: "Error Docker" });

    assert.equal(format(new Error("raw")), undefined);

});

// ---------------------------------------------------------------------------
// messages.byCommand unwrap: funciona con ServiceError.cause
// ---------------------------------------------------------------------------

test("messages.byCommand(): unwrap ServiceError.cause.command", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byCommand({ docker: "Docker step failed" }));
    notifier.channel("*", event => { received = event; });

    const execResult = { command: "docker", stderr: "denied" };
    const svcErr = new ServiceError("docker", "push", [], execResult);

    await notifier.reportError("t", svcErr, {});

    assert.equal(received.message, "Docker step failed");

});

// ---------------------------------------------------------------------------
// messages.byRule unwrap: funciona con ServiceError.cause
// ---------------------------------------------------------------------------

test("messages.byRule(): unwrap ServiceError.cause para command/args/pattern", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byRule([
        {
            command: "docker", args: "push", pattern: /500/,
            message: "Registry issue"
        }
    ]));
    notifier.channel("*", event => { received = event; });

    const execResult = { command: "docker", args: ["push", "img"], stderr: "500 Internal Server Error" };
    const svcErr = new ServiceError("docker", "push", ["img"], execResult);

    await notifier.reportError("t", svcErr, {});

    assert.equal(received.message, "Registry issue");

});

// ---------------------------------------------------------------------------
// Integración: ctx.wrap() + classifier + sender
// ---------------------------------------------------------------------------

test("integración: ctx.wrap() + byService classifier + channel sender", async () => {

    const ctx = Context.reset();
    const events = [];

    ctx.notifier
        .classify(classifiers.byService({
            docker: "containers",
            kubectl: "kubernetes",
            http: "networking"
        }))
        .channel("containers", event => events.push(event))
        .channel("kubernetes", event => events.push(event));

    const docker = ctx.wrap({
        push: async () => { throw { command: "docker", stderr: "denied" }; }
    }, "docker");

    const kubectl = ctx.wrap({
        apply: async () => { throw { command: "kubectl", stderr: "connection refused" }; }
    }, "kubectl");

    await assert.rejects(() => docker.push());
    await assert.rejects(() => kubectl.apply());

    assert.equal(events.length, 2);
    assert.equal(events[0].area, "containers");
    assert.equal(events[0].service, "docker");
    assert.equal(events[0].method, "push");
    assert.equal(events[1].area, "kubernetes");
    assert.equal(events[1].service, "kubectl");
    assert.equal(events[1].method, "apply");

});

test("integración: ctx.wrap() + byCommand fallback (raw ExecResult en cause)", async () => {

    const ctx = Context.reset();
    const events = [];

    // byCommand first (unwraps cause.command), then byService as fallback
    ctx.notifier
        .classify(classifiers.byCommand({ docker: "containers" }))
        .classify(classifiers.byService({ mysvc: "custom" }))
        .channel("containers", event => events.push(event));

    const fakeSvc = {
        push: async () => {
            throw { command: "docker", stderr: "denied" };
        }
    };

    const wrapped = ctx.wrap(fakeSvc, "mysvc");

    await assert.rejects(() => wrapped.push());

    // byService("mysvc") → undefined → byCommand("docker") → "containers"
    assert.equal(events.length, 1);
    assert.equal(events[0].area, "containers");

});

test("integración: ctx.wrap() + messages.byService + byCommand en cadena", async () => {

    const ctx = Context.reset();
    let received;

    ctx.notifier
        .classify(classifiers.byService({ mysvc: "ops" }))
        .describeError(messages.byService({ mysvc: "Error custom mysvc" }))
        .describeError(messages.byCommand({ docker: "Error Docker" }))
        .channel("ops", event => { received = event; });

    const fakeSvc = {
        doIt: async () => { throw { command: "docker", stderr: "x" }; }
    };

    const wrapped = ctx.wrap(fakeSvc, "mysvc");

    await assert.rejects(() => wrapped.doIt());

    // byService("mysvc") matches first → "Error custom mysvc"
    assert.equal(received.message, "Error custom mysvc");

});

// ---------------------------------------------------------------------------
// Classifiers y messages existentes: no se rompen
// ---------------------------------------------------------------------------

test("backward compat: classifiers.byCommand funciona con raw error", () => {

    const classify = classifiers.byCommand({ docker: "containers" });

    assert.equal(classify({ command: "docker", stderr: "x" }), "containers");
    assert.equal(classify({ command: "git", stderr: "x" }), undefined);
    assert.equal(classify(new Error("no command")), undefined);

});

test("backward compat: classifiers.byPattern funciona con raw error", () => {

    const classify = classifiers.byPattern([[/500/, "infra"]]);

    assert.equal(classify({ stderr: "500 Internal Server Error" }), "infra");
    assert.equal(classify({ stderr: "something else" }), undefined);

});

test("backward compat: messages.byCommand funciona con raw error", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byCommand({ docker: "Docker fail" }));
    notifier.channel("*", event => { received = event; });

    await notifier.reportError("t", { command: "docker", stderr: "x" }, {});

    assert.equal(received.message, "Docker fail");

});

test("backward compat: messages.byRule funciona con raw error", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byRule([
        { command: "docker", args: "push", pattern: /500/, message: "Registry issue" }
    ]));
    notifier.channel("*", event => { received = event; });

    await notifier.reportError("t", { command: "docker", args: ["push", "img"], stderr: "500" }, {});

    assert.equal(received.message, "Registry issue");

});

test("backward compat: Notifier reportError sin ServiceError no tiene service/method/args", async () => {

    const notifier = new Notifier();
    let received;

    notifier.channel("*", event => { received = event; });

    await notifier.reportError("task", { command: "docker", stderr: "x" }, {});

    assert.equal(received.service, undefined);
    assert.equal(received.method, undefined);
    assert.equal(received.args, undefined);

});
