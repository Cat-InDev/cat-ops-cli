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

test("un item de menú con onError captura el error sin interrumpir el menú", async () => {

    const ctx = Context.reset();
    ctx.setFlag("__auto_exit_test", true);

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

    // No debe lanzar: Menu.executeEntry atrapa el error internamente.
    await Menu.render(menu, ctx);

    assert.equal(onErrorCalled, true);
    assert.equal(notifierEvents.length, 1);
    assert.equal(notifierEvents[0].taskId, "Fail");

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
