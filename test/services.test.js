const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell, docker, terraform, argocd } = services;

function captureExec() {
    const calls = [];
    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    return {
        calls,
        restore() {
            shell.exec = original;
        }
    };
}

test("docker.build arma correctamente el comando con buildArgs", async () => {
    const capture = captureExec();

    await docker.build({
        image: "registry/app:v1",
        dockerfile: "Dockerfile",
        buildArgs: { NODE_ENV: "production" }
    });

    capture.restore();

    const [command, ...args] = capture.calls[0];
    assert.equal(command, "docker");
    assert.deepEqual(args, [
        "build", "-t", "registry/app:v1",
        "-f", "Dockerfile",
        "--build-arg", "NODE_ENV=production",
        "."
    ]);
});

test("terraform.apply agrega -auto-approve por defecto", async () => {
    const capture = captureExec();

    await terraform.apply();

    capture.restore();

    const [command, ...args] = capture.calls[0];
    assert.equal(command, "terraform");
    assert.deepEqual(args, ["apply", "-auto-approve"]);
});

test("argocd.appSync agrega --prune solo si se pide", async () => {
    const capture = captureExec();

    await argocd.appSync("mi-app", { prune: true });

    capture.restore();

    const [command, ...args] = capture.calls[0];
    assert.equal(command, "argocd");
    assert.deepEqual(args, ["app", "sync", "mi-app", "--prune"]);
});
