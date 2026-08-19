const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell } = services;

test("shell.exec respeta dryRun por-llamada sin ejecutar el comando real", async () => {
    const result = await shell.exec("comando-inexistente-xyz", { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.code, 0);
});

test("shell.exec reintenta según options.retry y finalmente rechaza", async () => {
    await assert.rejects(
        () => shell.exec("false", { retry: 2, retryDelay: 10 }),
        error => {
            assert.equal(error.code, 1);
            return true;
        }
    );
});

test("shell.exec rechaza con code 1 aunque el error salga por stdout y conserva ese stdout en el error", async () => {
    await assert.rejects(
        () => shell.exec(
            "node",
            "-e",
            "console.log('Error from server (InternalError): 500 Internal Server Error'); process.exit(1)"
        ),
        error => {
            assert.equal(error.code, 1);
            assert.match(error.stdout, /500 Internal Server Error/);
            return true;
        }
    );
});

test("shell.exec aplica timeout y mata el proceso", async () => {
    await assert.rejects(
        () => shell.exec("sleep", "3", { timeout: 200, retry: 1 }),
        error => {
            assert.equal(error.timedOut, true);
            return true;
        }
    );
});

test("shell.configure() cambia los defaults globales", async () => {
    shell.configure({ dryRun: true });

    const result = await shell.exec("comando-inexistente-xyz");
    assert.equal(result.dryRun, true);

    shell.configure({ dryRun: false });
});
