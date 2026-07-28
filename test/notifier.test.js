const { test } = require("node:test");
const assert = require("node:assert/strict");

const { Notifier, classifiers } = require("../dist");

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
