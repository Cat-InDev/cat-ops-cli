const { test } = require("node:test");
const assert = require("node:assert/strict");

const { Context } = require("../dist");

test("Context.current() devuelve siempre la misma instancia (singleton)", () => {
    const a = Context.current();
    const b = Context.current();
    assert.equal(a, b);
});

test("Context expone todos los servicios esperados", () => {
    const ctx = Context.current();
    const expected = [
        "shell", "docker", "git", "kubectl", "helm",
        "npm", "archive", "terraform", "ansible",
        "argocd", "tekton", "oc", "az", "azdo"
    ];

    expected.forEach(name => {
        assert.equal(
            typeof ctx.services[name],
            "object",
            `falta el servicio "${name}"`
        );
    });
});

test("set/get de variables compartidas", () => {
    const ctx = Context.current();
    ctx.set("image", "registry/app:v1");
    assert.equal(ctx.get("image"), "registry/app:v1");
});

test("flags: setFlag/getFlag/hasFlag", () => {
    const ctx = Context.current();
    ctx.setFlag("debug");
    assert.equal(ctx.getFlag("debug"), true);
    assert.equal(ctx.hasFlag("debug"), true);
    assert.equal(ctx.hasFlag("inexistente"), false);
});

test("Context.parseArgv separa flags y params", () => {
    const ctx = Context.parseArgv(["--debug", "--env=staging", "--retry=3"]);
    assert.equal(ctx.hasFlag("debug"), true);
    assert.equal(ctx.params.env, "staging");
    assert.equal(ctx.params.retry, "3");
});

test("Context.parseArgv con --dry-run configura shell en modo dry-run", async () => {
    const ctx = Context.parseArgv(["--dry-run"]);
    const result = await ctx.services.shell.exec("echo", "hola");
    assert.equal(result.dryRun, true);

    // Restaurar estado global para no afectar otros tests/archivos
    ctx.services.shell.configure({ dryRun: false });
});

test("ctx.run() guarda el resultado en ctx.results", async () => {
    const ctx = Context.current();
    const value = await ctx.run("miTask", async () => 42);
    assert.equal(value, 42);
    assert.equal(ctx.results.miTask, 42);
});

test("ctx.env es la misma referencia que shell.environment", () => {
    const ctx = Context.current();
    assert.equal(ctx.env, ctx.services.shell.environment);
});

test("ctx.env['KEY'] = value se refleja en shell.environment", () => {
    const ctx = Context.current();
    ctx.env["TEST_SYNC_KEY"] = "from-ctx";
    assert.equal(ctx.services.shell.environment["TEST_SYNC_KEY"], "from-ctx");
    delete ctx.env["TEST_SYNC_KEY"];
});

test("shell.env() se refleja en ctx.env", () => {
    const ctx = Context.current();
    ctx.services.shell.env("TEST_SYNC_KEY_2", "from-shell");
    assert.equal(ctx.env["TEST_SYNC_KEY_2"], "from-shell");
    delete ctx.env["TEST_SYNC_KEY_2"];
});

test("Context.reset() genera un env fresco desvinculado del anterior", () => {
    const ctx1 = Context.current();
    ctx1.env["RESET_TEST"] = "before-reset";

    const ctx2 = Context.reset();
    assert.notEqual(ctx2.env["RESET_TEST"], "before-reset");
    assert.equal(ctx2.env, ctx2.services.shell.environment);
});
