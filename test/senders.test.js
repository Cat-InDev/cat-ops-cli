const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { senders } = require("../dist");

test("senders.file() escribe cada evento como una línea JSON", async () => {

    const filePath = path.join(os.tmpdir(), `devops-cli-test-${Date.now()}.log`);
    const sender = senders.file({ path: filePath });

    await sender({ type: "error", taskId: "a", message: "x", timestamp: "t" });
    await sender({ type: "success", taskId: "b", message: "y", timestamp: "t" });

    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").map(line => JSON.parse(line));

    assert.equal(lines.length, 2);
    assert.equal(lines[0].taskId, "a");
    assert.equal(lines[1].taskId, "b");

    await fs.rm(filePath, { force: true });

});

test("senders.http() hace POST del evento como JSON", async () => {

    let receivedBody = null;
    let receivedUrl = null;

    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            receivedUrl = req.url;
            receivedBody = JSON.parse(body);
            res.writeHead(200);
            res.end("ok");
        });
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const sender = senders.http({ url: `http://localhost:${port}/notify` });

    await sender({ type: "error", taskId: "deploy", message: "boom", timestamp: "t" });

    server.close();

    assert.equal(receivedUrl, "/notify");
    assert.equal(receivedBody.taskId, "deploy");
    assert.equal(receivedBody.message, "boom");

});

test("senders.webhook() formatea el mensaje por defecto como { text }", async () => {

    let receivedBody = null;

    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200);
            res.end("ok");
        });
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const sender = senders.webhook({ url: `http://localhost:${port}/hook` });

    await sender({ type: "error", taskId: "deploy", area: "infra", message: "boom", timestamp: "t" });

    server.close();

    assert.match(receivedBody.text, /deploy/);
    assert.match(receivedBody.text, /infra/);

});

test("senders.webhook() respeta un formatter custom", async () => {

    let receivedBody = null;

    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200);
            res.end("ok");
        });
    });

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const sender = senders.webhook({
        url: `http://localhost:${port}/hook`,
        format: (event) => ({ customField: event.taskId })
    });

    await sender({ type: "success", taskId: "deploy", message: "ok", timestamp: "t" });

    server.close();

    assert.deepEqual(receivedBody, { customField: "deploy" });

});

test("senders.log() no lanza y distingue éxito/error", () => {

    const sender = senders.log();

    assert.doesNotThrow(() => {
        sender({ type: "success", taskId: "a", message: "ok", timestamp: "t" });
        sender({ type: "error", taskId: "b", area: "infra", message: "boom", timestamp: "t" });
    });

});
