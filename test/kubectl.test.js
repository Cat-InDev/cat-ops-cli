const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell, kubectl } = services;

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

function mockDeploymentJSON(responses) {

    const original = shell.exec.bind(shell);
    let i = 0;

    shell.exec = (...args) => {

        const isDeployGet = args.includes("get")
            && args.some(a => typeof a === "string" && a.startsWith("deployment/"));

        if (isDeployGet) {
            const json = responses[Math.min(i, responses.length - 1)];
            i += 1;
            return Promise.resolve({ code: 0, stdout: JSON.stringify(json), stderr: "" });
        }

        if (args.includes("pods")) {
            return Promise.resolve({ code: 0, stdout: JSON.stringify({ items: [] }), stderr: "" });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    return {
        restore() {
            shell.exec = original;
        }
    };

}

function mockDeploymentGroup(map) {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {

        const isList = args.includes("get") && args.includes("deployments") && args.includes("-l");

        if (isList) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ items: Object.keys(map).map(name => ({ metadata: { name } })) }),
                stderr: ""
            });
        }

        const target = args.find(a => typeof a === "string" && a.startsWith("deployment/"));

        if (target) {
            const name = target.split("/")[1];
            return Promise.resolve({ code: 0, stdout: JSON.stringify(map[name]), stderr: "" });
        }

        if (args.includes("pods")) {
            return Promise.resolve({ code: 0, stdout: JSON.stringify({ items: [] }), stderr: "" });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    return {
        restore() {
            shell.exec = original;
        }
    };

}

// ---------------------------------------------------------------------------
// kubeconfig / namespace en cada comando
// ---------------------------------------------------------------------------

test("kubectl.apply agrega --kubeconfig y -n", async () => {

    const capture = captureExec();

    await kubectl.apply("deploy.yaml", { kubeconfig: "/tmp/kc.yaml", namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], [
        "kubectl", "apply", "-f", "deploy.yaml", "--kubeconfig", "/tmp/kc.yaml", "-n", "prod"
    ]);

});

test("kubectl.get sigue aceptando args variádicos y opciones al final", async () => {

    const capture = captureExec();

    await kubectl.get("pods", "-o", "wide", { namespace: "staging" });

    capture.restore();

    assert.deepEqual(capture.calls[0], [
        "kubectl", "get", "pods", "-o", "wide", "-n", "staging"
    ]);

});

test("kubectl.get sin opciones sigue funcionando igual que antes", async () => {

    const capture = captureExec();

    await kubectl.get("pods", "-o", "wide");

    capture.restore();

    assert.deepEqual(capture.calls[0], ["kubectl", "get", "pods", "-o", "wide"]);

});

// ---------------------------------------------------------------------------
// waitForDeployment (individual)
// ---------------------------------------------------------------------------

test("kubectl.waitForDeployment resuelve success cuando ready==updated==desired", async () => {

    const mock = mockDeploymentJSON([
        { spec: { replicas: 2 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } },
        { spec: { replicas: 2 }, status: { readyReplicas: 2, updatedReplicas: 2, conditions: [] } }
    ]);

    const result = await kubectl.waitForDeployment({ deployment: "api", pollInterval: 10, timeout: 5000 });

    mock.restore();

    assert.equal(result.status, "success");
    assert.equal(result.restarts, 0);

});

test("kubectl.waitForDeployment lanza DeploymentRolloutError por timeout", async () => {

    const mock = mockDeploymentJSON([
        { spec: { replicas: 2 }, status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] } }
    ]);

    await assert.rejects(
        () => kubectl.waitForDeployment({ deployment: "api", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.name, "DeploymentRolloutError");
            assert.equal(error.status, "timeout");
            assert.equal(error.command, "kubectl");
            return true;
        }
    );

    mock.restore();

});

test("kubectl.waitForDeployment lanza error si Failed no se recupera en el grace period", async () => {

    const mock = mockDeploymentJSON([
        {
            spec: { replicas: 1 },
            status: {
                readyReplicas: 0,
                updatedReplicas: 0,
                conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }]
            }
        }
    ]);

    await assert.rejects(
        () => kubectl.waitForDeployment({ deployment: "api", pollInterval: 10, timeout: 5000, failedGracePeriod: 30 }),
        error => {
            assert.equal(error.status, "failed");
            assert.match(error.message, /Failed/);
            return true;
        }
    );

    mock.restore();

});

test("kubectl.waitForDeployment se recupera de un Failed transitorio dentro del grace period", async () => {

    const mock = mockDeploymentJSON([
        {
            spec: { replicas: 1 },
            status: {
                readyReplicas: 0,
                updatedReplicas: 0,
                conditions: [{ type: "Progressing", status: "False" }]
            }
        },
        { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } }
    ]);

    const result = await kubectl.waitForDeployment({
        deployment: "api",
        pollInterval: 10,
        timeout: 5000,
        failedGracePeriod: 5000
    });

    mock.restore();

    assert.equal(result.status, "success");

});

test("kubectl.waitForDeployment aborta de inmediato si se supera maxRestarts", async () => {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {

        const isDeployGet = args.includes("get")
            && args.some(a => typeof a === "string" && a.startsWith("deployment/"));

        if (isDeployGet) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({
                    spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
                    status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] }
                }),
                stderr: ""
            });
        }

        if (args.includes("pods")) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({
                    items: [{ status: { containerStatuses: [{ restartCount: 9 }] } }]
                }),
                stderr: ""
            });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    await assert.rejects(
        () => kubectl.waitForDeployment({ deployment: "api", pollInterval: 10, timeout: 5000, maxRestarts: 3 }),
        error => {
            assert.equal(error.status, "failed");
            assert.equal(error.restarts, 9);
            return true;
        }
    );

    shell.exec = original;

});

// ---------------------------------------------------------------------------
// waitForDeploymentGroup (varias instancias del mismo repo, por label)
// ---------------------------------------------------------------------------

test("kubectl.waitForDeploymentGroup resuelve success cuando todas las instancias llegan a listo", async () => {

    const mock = mockDeploymentGroup({
        "repository-14-us": { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } },
        "repository-14-eu": { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } }
    });

    const result = await kubectl.waitForDeploymentGroup({
        label: { "deployment-group": "repository-14" },
        pollInterval: 10,
        timeout: 5000
    });

    mock.restore();

    assert.equal(result.status, "success");
    assert.equal(result.label, "deployment-group=repository-14");
    assert.deepEqual(
        result.deployments.map(d => d.deployment).sort(),
        ["repository-14-eu", "repository-14-us"]
    );

});

test("kubectl.waitForDeploymentGroup lanza DeploymentGroupRolloutError si una instancia falla", async () => {

    const mock = mockDeploymentGroup({
        "repository-14-us": { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } },
        "repository-14-eu": { spec: { replicas: 1 }, status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] } }
    });

    await assert.rejects(
        () => kubectl.waitForDeploymentGroup({ label: "deployment-group=repository-14", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.name, "DeploymentGroupRolloutError");
            assert.equal(error.command, "kubectl");
            assert.deepEqual(error.succeeded, ["repository-14-us"]);
            assert.equal(error.failed.length, 1);
            assert.equal(error.failed[0].deployment, "repository-14-eu");
            return true;
        }
    );

    mock.restore();

});

test("kubectl.waitForDeploymentGroup lanza error si el label no matchea ningún deployment", async () => {

    const mock = mockDeploymentGroup({});

    await assert.rejects(
        () => kubectl.waitForDeploymentGroup({ label: "deployment-group=no-existe", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.name, "DeploymentGroupRolloutError");
            assert.equal(error.succeeded.length, 0);
            assert.equal(error.failed.length, 0);
            return true;
        }
    );

    mock.restore();

});
