const { test } = require("node:test");
const assert = require("node:assert/strict");

const { services } = require("../dist");
const { shell, kubectl, oc } = services;

function mockGroup({ names, perDeploymentJSON, listResource = "deployments" }) {

    const original = shell.exec.bind(shell);

    shell.exec = (...args) => {

        const isList = args.includes("get")
            && args.includes(listResource)
            && args.includes("-l");

        if (isList) {
            return Promise.resolve({
                code: 0,
                stdout: JSON.stringify({ items: names.map(name => ({ metadata: { name } })) }),
                stderr: ""
            });
        }

        const deploymentArg = args.find(a => typeof a === "string" && /^(deployment|dc)\//.test(a));

        if (deploymentArg) {
            const name = deploymentArg.split("/")[1];
            const json = perDeploymentJSON(name);
            return Promise.resolve({ code: 0, stdout: JSON.stringify(json), stderr: "" });
        }

        return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });

    };

    return {
        restore() { shell.exec = original; }
    };

}

test("kubectl.waitForDeploymentGroup resuelve success cuando todas las instancias llegan OK", async () => {

    const mock = mockGroup({
        names: ["repository-14-blue", "repository-14-green"],
        perDeploymentJSON: () => ({
            spec: { replicas: 1 },
            status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] }
        })
    });

    const result = await kubectl.waitForDeploymentGroup({
        label: { "deployment-group": "repository-14" },
        pollInterval: 10,
        timeout: 5000
    });

    mock.restore();

    assert.equal(result.status, "success");
    assert.equal(result.label, "deployment-group=repository-14");
    assert.equal(result.deployments.length, 2);

});

test("kubectl.waitForDeploymentGroup acepta el label como string ya armado", async () => {

    const mock = mockGroup({
        names: ["repository-14-blue"],
        perDeploymentJSON: () => ({
            spec: { replicas: 1 },
            status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] }
        })
    });

    const result = await kubectl.waitForDeploymentGroup({
        label: "deployment-group=repository-14",
        pollInterval: 10,
        timeout: 5000
    });

    mock.restore();

    assert.equal(result.status, "success");

});

test("kubectl.waitForDeploymentGroup reporta cuáles fallaron y cuáles no, esperando a todas", async () => {

    const mock = mockGroup({
        names: ["repository-14-blue", "repository-14-green"],
        perDeploymentJSON: (name) => {
            if (name === "repository-14-green") {
                return { spec: { replicas: 1 }, status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] } };
            }
            return { spec: { replicas: 1 }, status: { readyReplicas: 1, updatedReplicas: 1, conditions: [] } };
        }
    });

    await assert.rejects(
        () => kubectl.waitForDeploymentGroup({
            label: { "deployment-group": "repository-14" },
            pollInterval: 10,
            timeout: 50
        }),
        error => {
            assert.equal(error.name, "DeploymentGroupRolloutError");
            assert.equal(error.command, "kubectl");
            assert.deepEqual(error.succeeded, ["repository-14-blue"]);
            assert.equal(error.failed.length, 1);
            assert.equal(error.failed[0].deployment, "repository-14-green");
            assert.equal(error.failed[0].status, "timeout");
            return true;
        }
    );

    mock.restore();

});

test("kubectl.waitForDeploymentGroup lanza si no encuentra ningún deployment con ese label", async () => {

    const mock = mockGroup({ names: [], perDeploymentJSON: () => ({}) });

    await assert.rejects(
        () => kubectl.waitForDeploymentGroup({ label: "deployment-group=inexistente", pollInterval: 10 }),
        error => {
            assert.equal(error.name, "DeploymentGroupRolloutError");
            assert.deepEqual(error.succeeded, []);
            assert.deepEqual(error.failed, []);
            return true;
        }
    );

    mock.restore();

});

test("oc.waitForDeploymentGroup funciona con resourceType 'dc'", async () => {

    const mock = mockGroup({
        names: ["repository-14-blue", "repository-14-green"],
        listResource: "dc",
        perDeploymentJSON: () => ({
            spec: { replicas: 1 },
            status: { availableReplicas: 1, updatedReplicas: 1, conditions: [] }
        })
    });

    const result = await oc.waitForDeploymentGroup({
        label: { "deployment-group": "repository-14" },
        resourceType: "dc",
        pollInterval: 10,
        timeout: 5000
    });

    mock.restore();

    assert.equal(result.status, "success");
    assert.equal(result.deployments.length, 2);

});

test("oc.waitForDeploymentGroup marca command='oc' en el error agregado", async () => {

    const mock = mockGroup({
        names: ["repository-14-blue"],
        perDeploymentJSON: () => ({
            spec: { replicas: 1 },
            status: { readyReplicas: 0, updatedReplicas: 0, conditions: [] }
        })
    });

    await assert.rejects(
        () => oc.waitForDeploymentGroup({ label: "deployment-group=repository-14", pollInterval: 10, timeout: 40 }),
        error => {
            assert.equal(error.command, "oc");
            assert.equal(error.failed[0].deployment, "repository-14-blue");
            return true;
        }
    );

    mock.restore();

});
