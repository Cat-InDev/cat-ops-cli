const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell, oc } = services;

function captureExec() {
    const calls = [];
    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    };

    return {
        calls,
        restore() {
            shell.exec = original;
        }
    };
}

// ---------------------------------------------------------------------------
// kubeconfig / namespace en cada comando
// ---------------------------------------------------------------------------

test("oc.apply agrega --kubeconfig y -n", async () => {

    const capture = captureExec();

    await oc.apply("deploy.yaml", { kubeconfig: "/tmp/kc.yaml", namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], [
        "oc", "apply", "-f", "deploy.yaml", "--kubeconfig", "/tmp/kc.yaml", "-n", "prod"
    ]);

});

test("oc.login agrega namespace/kubeconfig sin romper token/server", async () => {

    const capture = captureExec();

    await oc.login({ server: "https://api.cluster:6443", token: "xyz", namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], [
        "oc", "login", "https://api.cluster:6443", "--token", "xyz", "-n", "prod"
    ]);

});

test("oc.rollout usa dc/<name> y respeta namespace", async () => {

    const capture = captureExec();

    await oc.rollout("api", { namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], ["oc", "rollout", "status", "dc/api", "-n", "prod"]);

});

// ---------------------------------------------------------------------------
// waitForDeployment (individual)
// ---------------------------------------------------------------------------

test("oc.waitForDeployment funciona con resourceType 'dc' (DeploymentConfig)", async () => {

    const original = shell.exec.bind(shell);
    let i = 0;

    const responses = [
        { spec: { replicas: 1 }, status: { availableReplicas: 0, updatedReplicas: 0, conditions: [] } },
        { spec: { replicas: 1 }, status: { availableReplicas: 1, updatedReplicas: 1, conditions: [] } }
    ];

    shell.exec = (...args) => {

        const isGet = args.includes("get")
            && args.some(a => typeof a === "string" && a.startsWith("dc/"));

        if (isGet) {
            const json = responses[Math.min(i, responses.length - 1)];
            i += 1;
            return Promise.resolve({ code: 0, stdout: JSON.stringify(json), stderr: "" });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    const result = await oc.waitForDeployment({
        deployment: "api",
        resourceType: "dc",
        pollInterval: 10,
        timeout: 5000
    });

    shell.exec = original;

    assert.equal(result.status, "success");

});

test("oc.waitForDeployment lanza DeploymentRolloutError con command='oc' por timeout", async () => {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {

        const isGet = args.includes("get")
            && args.some(a => typeof a === "string" && a.startsWith("deployment/"));

        if (isGet) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] } }),
                stderr: ""
            });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    await assert.rejects(
        () => oc.waitForDeployment({ deployment: "api", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.name, "DeploymentRolloutError");
            assert.equal(error.status, "timeout");
            assert.equal(error.command, "oc");
            return true;
        }
    );

    shell.exec = original;

});

// ---------------------------------------------------------------------------
// waitForDeploymentGroup (varias instancias del mismo repo, por label)
// ---------------------------------------------------------------------------

test("oc.waitForDeploymentGroup con resourceType 'dc' agrupa varias instancias por label", async () => {

    const original = shell.exec.bind(shell);
    const names = ["repo-14-a", "repo-14-b"];

    shell.exec = (...args) => {

        const isList = args.includes("get") && args.includes("dc") && args.includes("-l");

        if (isList) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ items: names.map(n => ({ metadata: { name: n } })) }),
                stderr: ""
            });
        }

        const isSingle = args.some(a => typeof a === "string" && a.startsWith("dc/"));

        if (isSingle) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ spec: { replicas: 1 }, status: { availableReplicas: 1, updatedReplicas: 1, conditions: [] } }),
                stderr: ""
            });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    const result = await oc.waitForDeploymentGroup({
        label: "deployment-group=repository-14",
        resourceType: "dc",
        pollInterval: 10,
        timeout: 5000
    });

    shell.exec = original;

    assert.equal(result.status, "success");
    assert.deepEqual(result.deployments.map(d => d.deployment).sort(), names.sort());

});

test("oc.waitForDeploymentGroup lanza DeploymentGroupRolloutError con command='oc' si falla una instancia", async () => {

    const original = shell.exec.bind(shell);
    const names = ["repo-14-a", "repo-14-b"];

    shell.exec = (...args) => {

        const isList = args.includes("get") && args.includes("deployments") && args.includes("-l");

        if (isList) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ items: names.map(n => ({ metadata: { name: n } })) }),
                stderr: ""
            });
        }

        const singleIdx = args.findIndex(a => typeof a === "string" && a.startsWith("deployment/"));

        if (singleIdx !== -1) {
            const name = args[singleIdx].split("/")[1];
            const ready = name === "repo-14-a" ? 1 : 0;
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: ready, updatedReplicas: ready, conditions: [] } }),
                stderr: ""
            });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    await assert.rejects(
        () => oc.waitForDeploymentGroup({ label: "deployment-group=repository-14", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.name, "DeploymentGroupRolloutError");
            assert.equal(error.command, "oc");
            assert.deepEqual(error.succeeded, ["repo-14-a"]);
            assert.equal(error.failed[0].deployment, "repo-14-b");
            return true;
        }
    );

    shell.exec = original;

});
