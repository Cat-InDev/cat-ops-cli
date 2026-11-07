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

// ---------------------------------------------------------------------------
// logs (actual / anterior) y eventos
// ---------------------------------------------------------------------------

test("kubectl.logs por defecto solo trae el log actual (compatible con antes)", async () => {

    const capture = captureExec();

    const result = await kubectl.logs("api-1", { namespace: "prod" });

    capture.restore();

    assert.equal(capture.calls.length, 1);
    assert.deepEqual(capture.calls[0], ["kubectl", "logs", "api-1", "-n", "prod"]);
    assert.equal(result.current, "{}");
    assert.equal(result.previous, "");

});

test("kubectl.logs con previous trae actual y --previous", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    shell.exec = (...args) => {
        calls.push(args);
        const isPrevious = args.includes("--previous");
        return Promise.resolve({ code: 0, stdout: isPrevious ? "prev-log" : "curr-log", stderr: "" });
    };

    try {
        const result = await kubectl.logs("api-1", { previous: true, container: "app", tail: 50 });
        assert.equal(result.current, "curr-log");
        assert.equal(result.previous, "prev-log");
        assert.deepEqual(calls[1], ["kubectl", "logs", "api-1", "-c", "app", "--tail", "50", "--previous"]);
    } finally {
        shell.exec = original;
    }

});

test("kubectl.logs con previous retorna vacío si no existe contenedor anterior", async () => {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => args.includes("--previous")
        ? Promise.reject({ code: 1, stdout: "", stderr: 'previous terminated container "app" in pod "api-1" not found' })
        : Promise.resolve({ code: 0, stdout: "curr-log", stderr: "" });

    try {
        const result = await kubectl.logs("api-1", { previous: true });
        assert.equal(result.current, "curr-log");
        assert.equal(result.previous, "");
    } finally {
        shell.exec = original;
    }

});

test("kubectl.events / podEvents / deploymentEvents arman los field selectors", async () => {

    const capture = captureExec();

    await kubectl.events({ namespace: "prod" });
    await kubectl.podEvents("api-1", { namespace: "prod", warningsOnly: true });
    await kubectl.deploymentEvents("api", { namespace: "prod" });

    capture.restore();

    assert.deepEqual(capture.calls[0], ["kubectl", "get", "events", "--sort-by=.lastTimestamp", "-n", "prod"]);
    assert.deepEqual(capture.calls[1], [
        "kubectl", "get", "events", "--sort-by=.lastTimestamp",
        "--field-selector", "involvedObject.kind=Pod,involvedObject.name=api-1,type=Warning", "-n", "prod"
    ]);
    assert.deepEqual(capture.calls[2], [
        "kubectl", "get", "events", "--sort-by=.lastTimestamp",
        "--field-selector", "involvedObject.kind=Deployment,involvedObject.name=api", "-n", "prod"
    ]);

});

test("kubectl.waitForDeployment con printEvents imprime eventos del deployment y sus pods al fallar", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    const deploymentJSON = {
        spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
        status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] }
    };

    shell.exec = (...args) => {
        calls.push(args);
        if (args.includes("deployment/api")) return Promise.resolve({ code: 0, stdout: JSON.stringify(deploymentJSON), stderr: "" });
        if (args.includes("pods")) return Promise.resolve({ code: 0, stdout: JSON.stringify({ items: [{ metadata: { name: "api-1" } }, { metadata: { name: "api-2" } }] }), stderr: "" });
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 10, printEvents: true }),
            err => err.name === "DeploymentRolloutError" && err.status === "timeout"
        );

        const selectors = calls
            .filter(args => args.includes("events"))
            .map(args => args[args.indexOf("--field-selector") + 1]);

        assert.deepEqual(selectors, [
            "involvedObject.kind=Deployment,involvedObject.name=api",
            "involvedObject.kind=Pod,involvedObject.name=api-1",
            "involvedObject.kind=Pod,involvedObject.name=api-2"
        ]);
    } finally {
        shell.exec = original;
    }

});

test("kubectl.waitForDeployment sin printEvents no consulta eventos", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }), stderr: "" });
    };

    try {
        await assert.rejects(kubectl.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 10 }));
        assert.equal(calls.filter(args => args.includes("events")).length, 0);
    } finally {
        shell.exec = original;
    }

});
