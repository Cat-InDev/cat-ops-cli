const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell, docker, git, helm, npm, archive, terraform, ansible, argocd, tekton, az, kubectl, oc } = services;

function captureExec() {
    const calls = [];
    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    return {
        calls,
        restore() { shell.exec = original; }
    };
}

test("docker: exec (dryRun) llega como último argumento en build/push/tag/login/pull/rmi", async () => {

    const capture = captureExec();

    await docker.build({ image: "app:v1", exec: { dryRun: true } });
    await docker.push("app:v1", { dryRun: true });
    await docker.tag("app:v1", "app:latest", { dryRun: true });
    await docker.login({ registry: "r", username: "u", password: "p", exec: { dryRun: true } });
    await docker.pull("app:v1", { dryRun: true });
    await docker.rmi("app:v1", { dryRun: true });

    capture.restore();

    capture.calls.forEach(call => {
        assert.deepEqual(call[call.length - 1], { dryRun: true });
    });

});

test("git: exec llega como último argumento en todos los comandos", async () => {

    const capture = captureExec();

    await git.clone("url", "path", { retry: 2 });
    await git.checkout("main", { retry: 2 });
    await git.pull({ retry: 2 });
    await git.fetch({ retry: 2 });
    await git.tag("v1", { retry: 2 });
    await git.commit("msg", { retry: 2 });
    await git.push({ retry: 2 });
    await git.revParse({ retry: 2 });

    capture.restore();

    capture.calls.forEach(call => {
        assert.deepEqual(call[call.length - 1], { retry: 2 });
    });

});

test("helm/npm/archive: exec llega como último argumento", async () => {

    const capture = captureExec();

    await helm.install("name", "chart", undefined, { retry: 3 });
    await helm.upgrade("name", "chart", "values.yaml", { retry: 3 });
    await helm.uninstall("name", { retry: 3 });
    await npm.ci({ retry: 3 });
    await npm.run("build", { retry: 3 });
    await archive.zip("src", "out.zip", { retry: 3 });

    capture.restore();

    capture.calls.forEach(call => {
        assert.deepEqual(call[call.length - 1], { retry: 3 });
    });

});

test("terraform/ansible: exec dentro del objeto de opciones existente", async () => {

    const capture = captureExec();

    await terraform.apply({ autoApprove: true, exec: { timeout: 60000 } });
    await terraform.validate({ timeout: 60000 });
    await ansible.playbook("site.yml", { inventory: "hosts", exec: { timeout: 60000 } });

    capture.restore();

    capture.calls.forEach(call => {
        assert.deepEqual(call[call.length - 1], { timeout: 60000 });
    });

});

test("argocd/tekton/az: exec dentro del objeto de opciones existente", async () => {

    const capture = captureExec();

    await argocd.login({ server: "s", username: "u", password: "p", exec: { retry: 4 } });
    await argocd.appSync("app", { prune: true, exec: { retry: 4 } });
    await tekton.pipelineStart("pipe", { params: { a: "b" }, exec: { retry: 4 } });
    await az.acrBuild({ registry: "r", image: "i", exec: { retry: 4 } });

    capture.restore();

    capture.calls.forEach(call => {
        assert.deepEqual(call[call.length - 1], { retry: 4 });
    });

});

test("kubectl/oc: exec convive con kubeconfig/namespace en el mismo objeto", async () => {

    const capture = captureExec();

    await kubectl.apply("d.yaml", { namespace: "prod", exec: { retry: 10 } });
    await oc.login({ server: "s", token: "t", namespace: "prod", exec: { retry: 10 } });

    capture.restore();

    assert.deepEqual(capture.calls[0], [
        "kubectl", "apply", "-f", "d.yaml", "-n", "prod", { retry: 10 }
    ]);

    assert.deepEqual(capture.calls[1], [
        "oc", "login", "s", "--token", "t", "-n", "prod", { retry: 10 }
    ]);

});

test("sin exec, el comportamiento es idéntico al de siempre (retrocompatible)", async () => {

    const capture = captureExec();

    await docker.push("app:v1");
    await kubectl.apply("d.yaml", { namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], ["docker", "push", "app:v1"]);
    assert.deepEqual(capture.calls[1], ["kubectl", "apply", "-f", "d.yaml", "-n", "prod"]);

});

test("retry real: docker.push se recupera tras 2 fallos con retry:5 (simulando spawn)", async () => {

    const cp = require("node:child_process");
    const originalSpawn = cp.spawn;

    let attempts = 0;

    cp.spawn = (cmd, args, opts) => {
        attempts += 1;
        const realCmd = attempts < 3 ? "false" : "true";
        return originalSpawn(realCmd, [], opts);
    };

    const result = await docker.push("app:v1", { retry: 5, retryDelay: 5 });

    cp.spawn = originalSpawn;

    assert.equal(attempts, 3);
    assert.equal(result.code, 0);

});
