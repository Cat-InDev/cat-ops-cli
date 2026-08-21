const { test } = require("node:test");
const assert = require("node:assert/strict");

const { Context, Menu } = require("../dist");

test("ctx.run() dispara hooks.onSuccess y notifier.onSuccess en éxito", async () => {

    const ctx = Context.reset();

    let hookCalled = false;
    const notifierEvents = [];

    ctx.notifier.onSuccess(event => notifierEvents.push(event));

    const value = await ctx.run(
        "mi-task",
        () => "resultado",
        { onSuccess: (result) => { hookCalled = true; assert.equal(result, "resultado"); } }
    );

    assert.equal(value, "resultado");
    assert.equal(hookCalled, true);
    assert.equal(ctx.results["mi-task"], "resultado");
    assert.equal(notifierEvents.length, 1);
    assert.equal(notifierEvents[0].taskId, "mi-task");

});

test("ctx.run() dispara hooks.onError y notifier.reportError, y re-lanza el error", async () => {

    const ctx = Context.reset();

    let hookError;
    const notifierEvents = [];

    ctx.notifier.classify(() => "test-area");
    ctx.notifier.channel("test-area", event => notifierEvents.push(event));

    await assert.rejects(
        () => ctx.run(
            "task-fallida",
            () => { throw new Error("boom"); },
            { onError: (error) => { hookError = error; } }
        ),
        /boom/
    );

    assert.equal(hookError.message, "boom");
    assert.equal(notifierEvents.length, 1);
    assert.equal(notifierEvents[0].area, "test-area");
    assert.equal(notifierEvents[0].taskId, "task-fallida");

});

test("un item de menú que falla lanza por defecto y mata el proceso (vía main)", async () => {

    const ctx = Context.reset();

    let onErrorCalled = false;
    const notifierEvents = [];

    ctx.notifier.channel("unclassified", event => notifierEvents.push(event));

    const menu = {
        title: "Test",
        "flag-selector": "--menu-selector",
        options: {
            Fail: {
                selector: "fail",
                action: () => { throw new Error("item falló"); },
                onError: () => { onErrorCalled = true; }
            }
        }
    };

    ctx.params["menu-selector"] = "fail";

    // Por defecto el error se re-lanza después de notificar.
    await assert.rejects(
        () => Menu.render(menu, ctx),
        /item falló/
    );

    assert.equal(onErrorCalled, true);
    assert.equal(notifierEvents.length, 1);
    assert.equal(notifierEvents[0].taskId, "Fail");

});

test("con --catch=no-throw el error se traga sin interrumpir el menú", async () => {

    const ctx = Context.reset();

    let onErrorCalled = false;
    const notifierEvents = [];

    ctx.notifier.channel("unclassified", event => notifierEvents.push(event));

    const menu = {
        title: "Test",
        "flag-selector": "--menu-selector",
        options: {
            Fail: {
                selector: "fail",
                action: () => { throw new Error("item falló"); },
                onError: () => { onErrorCalled = true; }
            }
        }
    };

    ctx.params["menu-selector"] = "fail";
    ctx.params.catch = "no-throw";

    // No debe lanzar: el usuario pidió explícitamente no-throw.
    await Menu.render(menu, ctx);

    assert.equal(onErrorCalled, true);
    assert.equal(notifierEvents.length, 1);
    assert.equal(notifierEvents[0].taskId, "Fail");

    // El fallo queda registrado en el ctx por si se quiere auditar.
    assert.equal(ctx.hasFailures(), true);
    assert.deepEqual(ctx.failures.map(f => f.label), ["Fail"]);

});

test("un item de menú con onSuccess recibe el resultado de action", async () => {

    const ctx = Context.reset();

    let received;

    const menu = {
        title: "Test",
        "flag-selector": "--menu-selector",
        options: {
            Ok: {
                selector: "ok",
                action: () => 123,
                onSuccess: (result) => { received = result; }
            }
        }
    };

    ctx.params["menu-selector"] = "ok";

    await Menu.render(menu, ctx);

    assert.equal(received, 123);
    assert.equal(ctx.results.Ok, 123);

});
