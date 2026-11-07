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

test("oc.logs por defecto solo trae el log actual (compatible con antes)", async () => {

    const capture = captureExec();

    const result = await oc.logs("api-1", { namespace: "prod" });

    capture.restore();

    assert.equal(capture.calls.length, 1);
    assert.deepEqual(capture.calls[0], ["oc", "logs", "api-1", "-n", "prod"]);
    assert.equal(result.current, "{}");
    assert.equal(result.previous, "");

});

test("oc.logs con previous trae actual y --previous", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    shell.exec = (...args) => {
        calls.push(args);
        const isPrevious = args.includes("--previous");
        return Promise.resolve({ code: 0, stdout: isPrevious ? "prev-log" : "curr-log", stderr: "" });
    };

    try {
        const result = await oc.logs("api-1", { previous: true, container: "app", tail: 50 });
        assert.equal(result.current, "curr-log");
        assert.equal(result.previous, "prev-log");
        assert.deepEqual(calls[1], ["oc", "logs", "api-1", "-c", "app", "--tail", "50", "--previous"]);
    } finally {
        shell.exec = original;
    }

});

test("oc.logs con previous retorna vacío si no existe contenedor anterior", async () => {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => args.includes("--previous")
        ? Promise.reject({ code: 1, stdout: "", stderr: 'previous terminated container "app" in pod "api-1" not found' })
        : Promise.resolve({ code: 0, stdout: "curr-log", stderr: "" });

    try {
        const result = await oc.logs("api-1", { previous: true });
        assert.equal(result.current, "curr-log");
        assert.equal(result.previous, "");
    } finally {
        shell.exec = original;
    }

});

test("oc.events / podEvents consultan en silencio y arman los field selectors", async () => {

    const capture = captureExec();

    await oc.events({ namespace: "prod" });
    await oc.podEvents("api-1", { namespace: "prod", warningsOnly: true });

    capture.restore();

    assert.deepEqual(capture.calls[0], ["oc", "get", "events", "-o", "json", "-n", "prod", { silent: true }]);
    assert.deepEqual(capture.calls[1], [
        "oc", "get", "events", "-o", "json",
        "--field-selector", "involvedObject.kind=Pod,involvedObject.name=api-1,type=Warning", "-n", "prod", { silent: true }
    ]);

});

test("oc.deploymentEvents incluye los eventos de sus ReplicaSets (quota) y excluye otros deployments", async () => {

    const original = shell.exec.bind(shell);
    const output = captureConsole();

    shell.exec = () => Promise.resolve({ code: 0, stdout: JSON.stringify(sampleEvents), stderr: "" });

    let list;

    try {
        list = await oc.deploymentEvents("api", { namespace: "prod" });
    } finally {
        shell.exec = original;
        output.restore();
    }

    assert.deepEqual(list.map(e => `${e.kind}/${e.name}`), ["Deployment/api", "ReplicaSet/api-5d8f9"]);
    assert.equal(list[1].count, 7);
    assert.ok(output.lines.some(line => line.includes("exceeded quota")));

});

test("oc.waitForDeployment con error de quota imprime eventos del ReplicaSet solo al final", async () => {

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
            oc.waitForDeployment({ deployment: "api", pollInterval: 5, failedGracePeriod: 30, printEvents: true, printLogs: true }),
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

test("oc.waitForDeployment con printLogs imprime logs (actual y anterior) de cada pod al final", async () => {

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
            oc.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 5, printLogs: { tail: 100 } }),
            err => err.status === "timeout"
        );
    } finally {
        shell.exec = original;
        output.restore();
    }

    const logCalls = calls.filter(args => args.includes("logs"));

    assert.deepEqual(logCalls, [
        ["oc", "logs", "api-1", "--all-containers=true", "--tail", "100"],
        ["oc", "logs", "api-1", "--all-containers=true", "--tail", "100", "--previous"],
        ["oc", "logs", "api-2", "--all-containers=true", "--tail", "100"],
        ["oc", "logs", "api-2", "--all-containers=true", "--tail", "100", "--previous"]
    ]);
    assert.equal(calls.filter(args => args.includes("events")).length, 0, "sin printEvents no se consultan eventos");

});

test("oc.waitForDeployment sin flags no consulta eventos ni logs", async () => {

    const original = shell.exec.bind(shell);
    const calls = [];

    shell.exec = (...args) => {
        calls.push(args);
        return Promise.resolve({ code: 0, stdout: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }), stderr: "" });
    };

    try {
        await assert.rejects(oc.waitForDeployment({ deployment: "api", timeout: 30, pollInterval: 10 }));
        assert.equal(calls.filter(args => args.includes("events") || args.includes("logs")).length, 0);
    } finally {
        shell.exec = original;
    }

});
