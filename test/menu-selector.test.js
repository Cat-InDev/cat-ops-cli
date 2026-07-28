const { test } = require("node:test");
const assert = require("node:assert/strict");

const { Context, Menu } = require("../dist");

function makeCtx(argv) {
    Context.reset();
    return Context.parseArgv(argv);
}

test("selector de un solo nivel ejecuta la task sin prompts", async () => {

    const ctx = makeCtx(["--menu-selector=build"]);

    let executed = false;

    const menu = {
        title: "Pipeline",
        "flag-selector": "--menu-selector",
        options: {
            Build: { selector: "build", action: () => { executed = true; } },
            Deploy: { selector: "deploy", action: () => {} }
        }
    };

    const result = await Menu.render(menu, ctx);

    assert.equal(executed, true);
    assert.notEqual(result, Menu.EXIT);

});

test("selector en cascada de 2 niveles ejecuta el submenú automáticamente", async () => {

    const ctx = makeCtx(["--menu-selector=docker", "--docker-action=push"]);

    const calls = [];

    const dockerMenu = {
        title: "Docker",
        "flag-selector": "--docker-action",
        options: {
            Build: { selector: "build", action: () => calls.push("build") },
            Push: { selector: "push", action: () => calls.push("push") }
        }
    };

    const mainMenu = {
        title: "Pipeline",
        "flag-selector": "--menu-selector",
        options: {
            Docker: { selector: "docker", menu: dockerMenu },
            Deploy: { selector: "deploy", action: () => calls.push("deploy") }
        }
    };

    await Menu.render(mainMenu, ctx);

    assert.deepEqual(calls, ["push"]);

});

test("acepta flag-selector sin los guiones iniciales (--menu-selector o menu-selector)", async () => {

    const ctx = makeCtx(["--x=build"]);

    let executed = false;

    const menu = {
        title: "Pipeline",
        "flag-selector": "x", // sin "--"
        options: {
            Build: { selector: "build", action: () => { executed = true; } }
        }
    };

    await Menu.render(menu, ctx);

    assert.equal(executed, true);

});
