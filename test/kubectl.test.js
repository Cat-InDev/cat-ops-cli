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

function captureConsole() {
    const lines = [];
    const methods = ["log", "warn", "error"];
    const originals = methods.map(name => console[name]);
    methods.forEach(name => {
        console[name] = (...args) => lines.push(args.join(" "));
    });
    return {
        lines,
        restore() {
            methods.forEach((name, i) => {
                console[name] = originals[i];
            });
        }
    };
}

const quotaMessage = 'pods "api-5d8f9-x" is forbidden: exceeded quota: compute-resources, requested: limits.cpu=2, used: limits.cpu=8, limited: limits.cpu=8';

const sampleEvents = {
    items: [
        { type: "Normal", reason: "ScalingReplicaSet", message: "Scaled up replica set api-5d8f9 to 1", lastTimestamp: "2026-11-06T10:00:00Z", involvedObject: { kind: "Deployment", name: "api" } },
        { type: "Warning", reason: "FailedCreate", message: quotaMessage, count: 7, lastTimestamp: "2026-11-06T10:00:05Z", involvedObject: { kind: "ReplicaSet", name: "api-5d8f9" } },
        { type: "Warning", reason: "FailedCreate", message: "otro deployment", lastTimestamp: "2026-11-06T10:00:06Z", involvedObject: { kind: "ReplicaSet", name: "api-worker-7c6b5" } },
        { type: "Warning", reason: "BackOff", message: "Back-off restarting failed container", lastTimestamp: "2026-11-06T10:00:07Z", involvedObject: { kind: "Pod", name: "api-5d8f9-abcde" } }
    ]
};

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

test("kubectl.events / podEvents consultan en silencio y arman los field selectors", async () => {

    const capture = captureExec();

    await kubectl.events({ namespace: "prod" });
    await kubectl.podEvents("api-1", { namespace: "prod", warningsOnly: true });

    capture.restore();

    assert.deepEqual(capture.calls[0], ["kubectl", "get", "events", "-o", "json", "-n", "prod", { silent: true }]);
    assert.deepEqual(capture.calls[1], [
        "kubectl", "get", "events", "-o", "json",
        "--field-selector", "involvedObject.kind=Pod,involvedObject.name=api-1,type=Warning", "-n", "prod", { silent: true }
    ]);

});

test("kubectl.deploymentEvents incluye los eventos de sus ReplicaSets (quota) y excluye otros deployments", async () => {

    const original = shell.exec.bind(shell);
    const output = captureConsole();

    shell.exec = () => Promise.resolve({ code: 0, stdout: JSON.stringify(sampleEvents), stderr: "" });

    let list;

    try {
        list = await kubectl.deploymentEvents("api", { namespace: "prod" });
    } finally {
        shell.exec = original;
        output.restore();
    }

    assert.deepEqual(list.map(e => `${e.kind}/${e.name}`), ["Deployment/api", "ReplicaSet/api-5d8f9"]);
    assert.equal(list[1].count, 7);
    assert.ok(output.lines.some(line => line.includes("exceeded quota")));

});

test("kubectl.waitForDeployment con error de quota imprime eventos del ReplicaSet solo al final", async () => {

    const original = shell.exec.bind(shell);
    const output = captureConsole();
    const calls = [];

    const deploymentJSON = {
        spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
        status: {
            readyReplicas: 0,
            updatedReplicas: 0,
            conditions: [{ type: "ReplicaFailure", status: "True", reason: "FailedCreate", message: quotaMessage }]
        }
    };

    shell.exec = (...args) => {
        calls.push(args);
        if (args.includes("events")) return Promise.resolve({ code: 0, stdout: JSON.stringify(sampleEvents), stderr: "" });
        if (args.includes("pods")) return Promise.resolve({ code: 0, stdout: JSON.stringify({ items: [] }), stderr: "" });
        return Promise.resolve({ code: 0, stdout: JSON.stringify(deploymentJSON), stderr: "" });
    };

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, failedGracePeriod: 30, printEvents: true, printLogs: true }),
            err => err.name === "DeploymentRolloutError" && err.status === "failed"
        );
    } finally {
        shell.exec = original;
        output.restore();
    }

    const polls = calls.filter(args => args.includes("deployment/api"));
    const eventCalls = calls.filter(args => args.includes("events"));

    assert.ok(polls.length > 2, "debe haber varias iteraciones de polling");
    assert.equal(eventCalls.length, 1, "los eventos se consultan una sola vez, al final");
    assert.ok(polls.every(args => args[args.length - 1].silent === true), "el polling no imprime nada");
    assert.equal(calls.filter(args => args.includes("logs")).length, 0, "sin pods no hay logs que pedir");
    assert.ok(output.lines.some(line => line.includes("ReplicaSet/api-5d8f9") && line.includes("exceeded quota")));

});

test("kubectl.waitForDeployment con printLogs imprime logs (actual y anterior) de cada pod al final", async () => {

    const original = shell.exec.bind(shell);
    const output = captureConsole();
    const calls = [];

    const deploymentJSON = {
        spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
        status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] }
    };

    shell.exec = (...args) => {
        calls.push(args);
        if (args.includes("logs")) return Promise.resolve({ code: 0, stdout: "log", stderr: "" });
        if (args.includes("pods")) return Promise.resolve({ code: 0, stdout: JSON.stringify({ items: [{ metadata: { name: "api-1" } }, { metadata: { name: "api-2" } }] }), stderr: "" });
        return Promise.resolve({ code: 0, stdout: JSON.stringify(deploymentJSON), stderr: "" });
    };

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 5, printLogs: { tail: 100 } }),
            err => err.status === "timeout"
        );
    } finally {
        shell.exec = original;
        output.restore();
    }

    const logCalls = calls.filter(args => args.includes("logs"));

    assert.deepEqual(logCalls, [
        ["kubectl", "logs", "api-1", "--all-containers=true", "--tail", "100"],
        ["kubectl", "logs", "api-1", "--all-containers=true", "--tail", "100", "--previous"],
        ["kubectl", "logs", "api-2", "--all-containers=true", "--tail", "100"],
        ["kubectl", "logs", "api-2", "--all-containers=true", "--tail", "100", "--previous"]
    ]);
    assert.equal(calls.filter(args => args.includes("events")).length, 0, "sin printEvents no se consultan eventos");

});

test("kubectl.waitForDeployment sin flags no consulta eventos ni logs", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }), stderr: "" });
    };

    try {
        await assert.rejects(kubectl.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 10 }));
        assert.equal(calls.filter(args => args.includes("events") || args.includes("logs")).length, 0);
    } finally {
        shell.exec = original;
    }

});
