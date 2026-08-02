const { test } = require("node:test");
const assert = require("node:assert/strict");

const { Notifier, classifiers, messages } = require("../dist");

test("Notifier enruta el error al área correcta según classify()", async () => {

    const notifier = new Notifier();
    const received = [];

    notifier.classify(classifiers.byCommand({ docker: "containers", git: "scm" }));
    notifier.channel("containers", event => received.push(event));
    notifier.channel("scm", event => received.push({ wrongChannel: true, ...event }));

    const error = { command: "docker", stderr: "algo falló" };

    const area = await notifier.reportError("build", error, {});

    assert.equal(area, "containers");
    assert.equal(received.length, 1);
    assert.equal(received[0].area, "containers");
    assert.equal(received[0].taskId, "build");

});

test("Notifier usa el área 'unclassified' si ningún classifier matchea", async () => {

    const notifier = new Notifier();
    let area;

    notifier.channel("unclassified", event => { area = event.area; });

    await notifier.reportError("algo", new Error("boom"), {});

    assert.equal(area, "unclassified");

});

test("el canal '*' recibe todos los errores además del área específica", async () => {

    const notifier = new Notifier();
    const wildcardCalls = [];
    const specificCalls = [];

    notifier.classify(() => "infra");
    notifier.channel("*", () => wildcardCalls.push(1));
    notifier.channel("infra", () => specificCalls.push(1));

    await notifier.reportError("t1", new Error("x"), {});

    assert.equal(wildcardCalls.length, 1);
    assert.equal(specificCalls.length, 1);

});

test("onSuccess() dispara los senders solo en éxito, con el resultado", async () => {

    const notifier = new Notifier();
    let captured;

    notifier.onSuccess(event => { captured = event; });

    await notifier.reportSuccess("deploy", { ok: true }, {});

    assert.equal(captured.type, "success");
    assert.equal(captured.taskId, "deploy");
    assert.deepEqual(captured.result, { ok: true });

});

test("classifiers.byPattern matchea contra el stderr del error", () => {

    const classify = classifiers.byPattern([
        [/permission denied/i, "security"],
        [/no space left/i, "infra"]
    ]);

    assert.equal(classify({ stderr: "Permission denied" }), "security");
    assert.equal(classify({ stderr: "no space left on device" }), "infra");
    assert.equal(classify({ stderr: "algo random" }), undefined);

});

test("notifier.describeError() reemplaza el mensaje crudo cuando matchea", async () => {

    const notifier = new Notifier();
    let received;

    notifier.classify(classifiers.byCommand({ docker: "containers" }));
    notifier.describeError(messages.byPattern([
        [/500 Internal Server Error/, "Se ha reportado a infraestructura: falta de espacio en el registry"]
    ]));
    notifier.channel("containers", event => { received = event; });

    await notifier.reportError("push", { command: "docker", stderr: "unknown blob: 500 Internal Server Error" }, {});

    assert.equal(received.message, "Se ha reportado a infraestructura: falta de espacio en el registry");
    assert.equal(received.area, "containers");

});

test("notifier.describeError() cae al mensaje crudo si ningún formatter matchea", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byPattern([[/500 Internal Server Error/, "mensaje custom"]]));
    notifier.channel("unclassified", event => { received = event; });

    await notifier.reportError("t", { stderr: "algo random sin match" }, {});

    assert.equal(received.message, "algo random sin match");

});

test("messages.byCommand devuelve un mensaje fijo por comando", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byCommand({ docker: "Falló un paso de Docker, revisa el build/push del registry" }));
    notifier.channel("unclassified", event => { received = event; });

    await notifier.reportError("t", { command: "docker", stderr: "lo que sea" }, {});

    assert.equal(received.message, "Falló un paso de Docker, revisa el build/push del registry");

});

test("messages.byRule distingue el mismo patrón (500) según el comando", async () => {

    const notifier = new Notifier();
    const captured = [];

    notifier.describeError(messages.byRule([
        { command: "docker", args: "push", pattern: /500/, message: "falta espacio en el registry" },
        { command: "kubectl", pattern: /500/, message: "API server devolvió 500" },
        { pattern: /500/, message: "500 genérico" }
    ]));

    notifier.channel("unclassified", event => captured.push(event.message));

    await notifier.reportError("push", { command: "docker", args: ["push", "app"], stderr: "500 Internal Server Error" }, {});
    await notifier.reportError("apply", { command: "kubectl", args: ["apply"], stderr: "500 from apiserver" }, {});
    await notifier.reportError("other", { command: "terraform", args: ["plan"], stderr: "500 unknown" }, {});

    assert.deepEqual(captured, [
        "falta espacio en el registry",
        "API server devolvió 500",
        "500 genérico"
    ]);

});

test("messages.byRule respeta 'args' para distinguir sub-comandos del mismo binario", async () => {

    const notifier = new Notifier();
    const captured = [];

    notifier.describeError(messages.byRule([
        { command: "docker", args: "push", pattern: /500/, message: "mensaje de push" }
    ]));

    notifier.channel("unclassified", event => captured.push(event.message));

    // docker build con 500 NO debe matchear la regla (es específica de "push")
    await notifier.reportError("build", { command: "docker", args: ["build", "-t", "x"], stderr: "500 boom" }, {});

    assert.equal(captured[0], "500 boom"); // cae al mensaje crudo, no matcheó ninguna regla

});

test("messages.byRule soporta mensaje dinámico como función (error, ctx)", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byRule([
        {
            command: "terraform",
            pattern: /500/,
            message: (error, ctx) => `Terraform falló en env=${ctx.params?.env ?? "?"}`
        }
    ]));

    notifier.channel("unclassified", event => { received = event.message; });

    await notifier.reportError("plan", { command: "terraform", stderr: "500 backend error" }, { params: { env: "prod" } });

    assert.equal(received, "Terraform falló en env=prod");

});

test("messages.byRule: una regla sin condiciones actúa como catch-all", async () => {

    const notifier = new Notifier();
    let received;

    notifier.describeError(messages.byRule([
        { message: "cualquier error cae acá" }
    ]));

    notifier.channel("unclassified", event => { received = event.message; });

    await notifier.reportError("t", { stderr: "lo que sea, no importa el texto" }, {});

    assert.equal(received, "cualquier error cae acá");

});
