const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services, ROLLOUT_ERRORS, rolloutErrorCatalog, diagnoseRollout } = require("../dist");
const { shell, kubectl, oc } = services;

function silenceConsole() {
    const methods = ["log", "warn", "error"];
    const originals = methods.map(name => console[name]);
    const lines = [];
    methods.forEach(name => { console[name] = (...args) => lines.push(args.join(" ")); });
    return { lines, restore() { methods.forEach((name, i) => { console[name] = originals[i]; }); } };
}

function mockExec(handler) {
    const original = shell.exec.bind(shell);
    shell.exec = (...args) => Promise.resolve(handler(args));
    return () => { shell.exec = original; };
}

const ok = value => ({ code: 0, stderr: "", stdout: JSON.stringify(value) });

const keys = causes => causes.map(c => c.key);

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

test("catálogo: códigos únicos, principales K8S-1xx y secundarios K8S-2xx", () => {

    const catalog = rolloutErrorCatalog();
    const codes = catalog.map(e => e.code);

    assert.equal(new Set(codes).size, codes.length, "sin códigos repetidos");

    for (const entry of catalog) {
        assert.match(entry.code, /^K8S-\d{3}-[A-Z]+$/);
        assert.equal(entry.level === "primary", entry.code.startsWith("K8S-1"), `${entry.code} nivel coherente`);
        assert.ok(entry.title && entry.hint, `${entry.code} con título y sugerencia`);
        assert.equal(ROLLOUT_ERRORS[entry.key], entry);
    }

});

// ---------------------------------------------------------------------------
// diagnoseRollout — causas secundarias
// ---------------------------------------------------------------------------

const pod = (name, status, spec = {}) => ({ metadata: { name }, spec, status });

test("diagnoseRollout detecta OOMKilled con el límite de memoria y CrashLoopBackOff", () => {

    const causes = diagnoseRollout({
        workload: "api",
        conditions: [],
        events: [],
        pods: [pod("api-1", {
            phase: "Running",
            containerStatuses: [{
                name: "app", ready: false, restartCount: 4,
                state: { waiting: { reason: "CrashLoopBackOff" } },
                lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } }
            }]
        }, { containers: [{ name: "app", resources: { limits: { memory: "256Mi" } } }] })]
    });

    assert.deepEqual(keys(causes), ["OOM_KILLED", "CRASH_LOOP_BACKOFF"]);
    assert.equal(causes[0].code, "K8S-201-OOMKILLED");
    assert.equal(causes[0].pod, "api-1");
    assert.equal(causes[0].container, "app");
    assert.match(causes[0].detail, /256Mi/);

});

test("diagnoseRollout clasifica estados waiting de contenedor", () => {

    const waiting = (name, reason, message) => pod(name, {
        phase: "Pending",
        containerStatuses: [{ name: "app", ready: false, state: { waiting: { reason, message } } }]
    });

    const causes = diagnoseRollout({
        workload: "api",
        conditions: [],
        events: [],
        pods: [
            waiting("p1", "ImagePullBackOff", "Back-off pulling image \"reg/api:9.9\""),
            waiting("p2", "InvalidImageName", "bad"),
            waiting("p3", "CreateContainerConfigError", "secret \"db\" not found"),
            waiting("p4", "RunContainerError", "exec: not found")
        ]
    });

    assert.deepEqual(keys(causes), ["IMAGE_PULL_FAILED", "INVALID_IMAGE_NAME", "CONFIG_ERROR", "CONTAINER_CREATE_FAILED"]);
    assert.match(causes[2].detail, /secret "db" not found/);

});

test("diagnoseRollout detecta exit code != 0, init container, Evicted y nodo perdido", () => {

    const causes = diagnoseRollout({
        workload: "api",
        conditions: [],
        events: [],
        pods: [
            pod("p1", { phase: "Running", containerStatuses: [{ name: "app", ready: false, state: { terminated: { reason: "Error", exitCode: 1 } } }] }),
            pod("p2", { phase: "Pending", initContainerStatuses: [{ name: "migrate", state: { waiting: { reason: "CrashLoopBackOff" } } }] }),
            pod("p3", { phase: "Failed", reason: "Evicted", message: "The node was low on resource: memory." }),
            pod("p4", { phase: "Unknown" }, { nodeName: "worker-9" })
        ]
    });

    assert.deepEqual(keys(causes), ["CONTAINER_EXIT_ERROR", "INIT_CONTAINER_FAILED", "POD_EVICTED", "NODE_LOST"]);
    assert.match(causes[0].detail, /exit 1/);
    assert.equal(causes[1].container, "migrate");

});

test("diagnoseRollout clasifica eventos de probes, scheduling y volúmenes", () => {

    const ev = (name, reason, message) => ({ type: "Warning", reason, message, kind: "Pod", name, count: 3, lastTimestamp: "" });
    const running = name => pod(name, { phase: "Running", containerStatuses: [{ name: "app", ready: false, state: { running: {} } }] });
    const pending = name => pod(name, { phase: "Pending" });

    const causes = diagnoseRollout({
        workload: "api",
        conditions: [],
        pods: [running("r1"), running("r2"), running("r3"), pending("s1"), pending("s2"), pending("s3"), pending("v1")],
        events: [
            ev("r1", "Unhealthy", "Readiness probe failed: HTTP probe failed with statuscode: 503"),
            ev("r2", "Unhealthy", "Liveness probe failed: Get \"http://10.0.0.1:8080/health\": connection refused"),
            ev("r3", "Unhealthy", "Startup probe failed: timeout"),
            ev("s1", "FailedScheduling", "0/3 nodes are available: 3 Insufficient memory."),
            ev("s2", "FailedScheduling", "0/3 nodes are available: 3 node(s) had untolerated taint"),
            ev("s3", "FailedScheduling", "pod has unbound immediate PersistentVolumeClaims"),
            ev("v1", "FailedMount", "MountVolume.SetUp failed for volume \"cfg\": configmap \"cfg\" not found")
        ]
    });

    assert.deepEqual(keys(causes), [
        "READINESS_PROBE_FAILED", "LIVENESS_PROBE_FAILED", "STARTUP_PROBE_FAILED",
        "INSUFFICIENT_RESOURCES", "UNSCHEDULABLE", "PVC_UNBOUND", "VOLUME_MOUNT_FAILED"
    ]);
    assert.match(causes[0].detail, /\(x3\)/);

});

test("diagnoseRollout: quota y admisión desde la condición ReplicaFailure y eventos del ReplicaSet", () => {

    const quota = diagnoseRollout({
        workload: "api",
        conditions: [{ type: "ReplicaFailure", status: "True", reason: "FailedCreate", message: "pods \"api-x\" is forbidden: exceeded quota: compute" }],
        pods: [],
        events: []
    });

    assert.deepEqual(keys(quota), ["QUOTA_EXCEEDED"], "sin PODS_NOT_CREATED cuando ya se sabe por qué no hay pods");

    const scc = diagnoseRollout({
        workload: "api",
        conditions: [],
        pods: [],
        events: [{ type: "Warning", reason: "FailedCreate", message: "unable to validate against any security context constraint", kind: "ReplicaSet", name: "api-5d8f9", count: 1, lastTimestamp: "" }]
    });

    assert.deepEqual(keys(scc), ["ADMISSION_DENIED"]);

});

test("diagnoseRollout: genéricos PODS_NOT_CREATED, PODS_NOT_READY, PODS_PENDING, DEPLOYER_FAILED y UNKNOWN_CAUSE", () => {

    assert.deepEqual(keys(diagnoseRollout({ workload: "api", conditions: [], pods: [], events: [] })), ["PODS_NOT_CREATED"]);

    assert.deepEqual(keys(diagnoseRollout({
        workload: "api",
        conditions: [],
        events: [],
        pods: [
            pod("a", { phase: "Running", containerStatuses: [{ ready: false, state: { running: {} } }] }),
            pod("b", { phase: "Pending" })
        ]
    })), ["PODS_NOT_READY", "PODS_PENDING"]);

    assert.deepEqual(keys(diagnoseRollout({
        workload: "api",
        resourceType: "dc",
        conditions: [],
        pods: [pod("api-3-abcde", { phase: "Running", containerStatuses: [{ ready: true }] })],
        events: [{ type: "Warning", reason: "Failed", message: "deployer pod failed", kind: "Pod", name: "api-3-deploy", count: 1, lastTimestamp: "" }]
    })), ["DEPLOYER_FAILED"]);

    assert.deepEqual(keys(diagnoseRollout({
        workload: "api",
        conditions: [],
        events: [],
        pods: [pod("a", { phase: "Running", containerStatuses: [{ ready: true, state: { running: {} } }] })]
    })), ["UNKNOWN_CAUSE"]);

});

// ---------------------------------------------------------------------------
// waitForDeployment — código principal + causas en el error
// ---------------------------------------------------------------------------

test("kubectl.waitForDeployment: maxRestarts -> K8S-102-MAXREINIT con causa OOMKilled", async () => {

    const output = silenceConsole();
    const restore = mockExec(args => {
        if (args.includes("pods")) {
            return ok({ items: [pod("api-1", {
                phase: "Running",
                containerStatuses: [{ name: "app", ready: false, restartCount: 6, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } } }]
            }, { containers: [{ name: "app", resources: { limits: { memory: "128Mi" } } }] })] });
        }
        if (args.includes("events")) return ok({ items: [] });
        return ok({ spec: { replicas: 1, selector: { matchLabels: { app: "api" } } }, status: { readyReplicas: 0, updatedReplicas: 1 } });
    });

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 5000, maxRestarts: 3, statusInterval: 0 }),
            err => {
                assert.equal(err.code, "K8S-102-MAXREINIT");
                assert.equal(err.errorKey, "MAX_RESTARTS_EXCEEDED");
                assert.deepEqual(err.causes.map(c => c.code), ["K8S-201-OOMKILLED", "K8S-202-CRASHLOOP"]);
                assert.match(err.message, /^\[K8S-102-MAXREINIT\]/);
                assert.match(err.message, /K8S-201-OOMKILLED en api-1/);
                return true;
            }
        );
    } finally {
        restore();
        output.restore();
    }

    assert.ok(output.lines.some(line => line.includes("[K8S-102-MAXREINIT]")), "imprime el error principal");
    assert.ok(output.lines.some(line => line.includes("K8S-201-OOMKILLED") && line.includes("128Mi")), "imprime una línea por causa");

});

test("kubectl.waitForDeployment: ProgressDeadlineExceeded -> K8S-103-DEADLINE", async () => {

    const output = silenceConsole();
    const restore = mockExec(args => {
        if (args.includes("pods") || args.includes("events")) return ok({ items: [] });
        return ok({
            spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
            status: { conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }] }
        });
    });

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 5000, failedGracePeriod: 10, statusInterval: 0 }),
            err => err.code === "K8S-103-DEADLINE" && /ProgressDeadlineExceeded/.test(err.message)
        );
    } finally {
        restore();
        output.restore();
    }

});

test("oc.waitForDeployment: ReplicaFailure por quota -> K8S-104-REPLICAFAIL + K8S-216-QUOTA", async () => {

    const output = silenceConsole();
    const restore = mockExec(args => {
        if (args.includes("pods") || args.includes("events")) return ok({ items: [] });
        return ok({
            spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
            status: { conditions: [{ type: "ReplicaFailure", status: "True", reason: "FailedCreate", message: "exceeded quota: compute-resources" }] }
        });
    });

    try {
        await assert.rejects(
            oc.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 5000, failedGracePeriod: 10, statusInterval: 0 }),
            err => err.code === "K8S-104-REPLICAFAIL" && err.causes.length === 1 && err.causes[0].code === "K8S-216-QUOTA"
        );
    } finally {
        restore();
        output.restore();
    }

});

test("kubectl.waitForDeployment: recurso inexistente -> K8S-106-NOTFOUND (no un timeout genérico)", async () => {

    const output = silenceConsole();
    const restore = mockExec(() => Promise.reject({ code: 1, stdout: "", stderr: "Error from server (NotFound): deployments.apps \"api\" not found" }));

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 30, statusInterval: 0 }),
            err => err.code === "K8S-106-NOTFOUND" && err.errorKey === "RESOURCE_NOT_FOUND"
        );
    } finally {
        restore();
        output.restore();
    }

});

test("oc.waitForDeployment: Forbidden -> K8S-107-FORBIDDEN de inmediato", async () => {

    const output = silenceConsole();
    let reads = 0;
    const restore = mockExec(() => {
        reads += 1;
        return Promise.reject({ code: 1, stdout: "", stderr: "Error from server (Forbidden): deployments.apps \"api\" is forbidden: User \"system:serviceaccount:ci:bot\" cannot get resource" });
    });

    try {
        await assert.rejects(
            oc.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 5000, statusInterval: 0 }),
            err => err.code === "K8S-107-FORBIDDEN"
        );
    } finally {
        restore();
        output.restore();
    }

    assert.equal(reads, 1, "no reintenta un error de permisos");

});

test("kubectl.waitForDeployment: cluster inalcanzable -> K8S-108-UNREACHABLE", async () => {

    const output = silenceConsole();
    const restore = mockExec(() => Promise.reject({ code: 1, stdout: "", stderr: "Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout" }));

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 30, statusInterval: 0 }),
            err => err.code === "K8S-108-UNREACHABLE" && err.status === "timeout"
        );
    } finally {
        restore();
        output.restore();
    }

});

test("kubectl.waitForDeployment: timeout -> K8S-101-TIMEOUT con causa de readiness", async () => {

    const output = silenceConsole();
    const restore = mockExec(args => {
        if (args.includes("pods")) return ok({ items: [pod("api-1", { phase: "Running", containerStatuses: [{ name: "app", ready: false, state: { running: {} } }] })] });
        if (args.includes("events")) return ok({ items: [{ type: "Warning", reason: "Unhealthy", message: "Readiness probe failed: 503", involvedObject: { kind: "Pod", name: "api-1" } }] });
        return ok({ spec: { replicas: 1, selector: { matchLabels: { app: "api" } } }, status: { readyReplicas: 0, updatedReplicas: 1 } });
    });

    try {
        await assert.rejects(
            kubectl.waitForDeployment({ deployment: "api", pollInterval: 5, timeout: 30, statusInterval: 0 }),
            err => err.code === "K8S-101-TIMEOUT" && err.causes[0].code === "K8S-209-READINESS"
        );
    } finally {
        restore();
        output.restore();
    }

});

// ---------------------------------------------------------------------------
// waitForDeploymentGroup
// ---------------------------------------------------------------------------

test("waitForDeploymentGroup: K8S-110-GROUPFAIL con código y causas por instancia; K8S-109-GROUPEMPTY si el grupo está vacío", async () => {

    const output = silenceConsole();
    const restore = mockExec(args => {
        if (args.includes("deployments") && args.includes("-l")) return ok({ items: [{ metadata: { name: "api-cl" } }, { metadata: { name: "api-pe" } }] });
        if (args.includes("pods")) {
            const selector = args[args.indexOf("-l") + 1];
            if (selector === "app=api-pe") {
                return ok({ items: [pod("api-pe-1", { phase: "Pending", containerStatuses: [{ name: "app", ready: false, state: { waiting: { reason: "ImagePullBackOff" } } }] })] });
            }
            return ok({ items: [] });
        }
        if (args.includes("events")) return ok({ items: [] });
        const name = args.find(a => typeof a === "string" && a.startsWith("deployment/")).split("/")[1];
        const ready = name === "api-cl" ? 1 : 0;
        return ok({ spec: { replicas: 1, selector: { matchLabels: { app: name } } }, status: { readyReplicas: ready, updatedReplicas: 1 } });
    });

    try {

        await assert.rejects(
            kubectl.waitForDeploymentGroup({ label: "deployment-group=repo-14", pollInterval: 5, timeout: 30, statusInterval: 0 }),
            err => {
                assert.equal(err.code, "K8S-110-GROUPFAIL");
                assert.deepEqual(err.succeeded, ["api-cl"]);
                assert.equal(err.failed[0].code, "K8S-101-TIMEOUT");
                assert.equal(err.failed[0].causes[0].code, "K8S-204-IMAGEPULL");
                assert.match(err.message, /api-pe \(K8S-101-TIMEOUT: K8S-204-IMAGEPULL\)/);
                return true;
            }
        );

    } finally {
        restore();
    }

    const restoreEmpty = mockExec(() => ok({ items: [] }));

    try {
        await assert.rejects(
            oc.waitForDeploymentGroup({ label: "deployment-group=nada", pollInterval: 5, timeout: 30 }),
            err => err.code === "K8S-109-GROUPEMPTY" && /^\[K8S-109-GROUPEMPTY\]/.test(err.message)
        );
    } finally {
        restoreEmpty();
        output.restore();
    }

});
