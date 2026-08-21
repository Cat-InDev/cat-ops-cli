const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { http: httpService, HttpService, HttpRegistry } = require("../dist");

function createServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, () => {
            const port = server.address().port;
            resolve({ server, port, url: `http://localhost:${port}` });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

// ---------------------------------------------------------------------------
// Construcción básica
// ---------------------------------------------------------------------------

test("http.get() hace GET y devuelve status + body", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
    });

    const res = await httpService.get(`${url}/test`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });

    await closeServer(server);

});

test("http.post() envía JSON y el server lo recibe", async () => {

    let receivedBody = null;
    let receivedMethod = null;

    const { server, url } = await createServer((req, res) => {
        receivedMethod = req.method;
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            receivedBody = JSON.parse(body);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ id: 1 }));
        });
    });

    const res = await httpService.post(`${url}/create`, { name: "test" });

    assert.equal(receivedMethod, "POST");
    assert.deepEqual(receivedBody, { name: "test" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 1 });

    await closeServer(server);

});

test("http.put() envía PUT", async () => {

    let receivedMethod = null;

    const { server, url } = await createServer((req, res) => {
        receivedMethod = req.method;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ updated: true }));
    });

    await httpService.put(`${url}/item/1`, { name: "updated" });
    assert.equal(receivedMethod, "PUT");

    await closeServer(server);

});

test("http.patch() envía PATCH", async () => {

    let receivedMethod = null;

    const { server, url } = await createServer((req, res) => {
        receivedMethod = req.method;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ patched: true }));
    });

    await httpService.patch(`${url}/item/1`, { name: "patched" });
    assert.equal(receivedMethod, "PATCH");

    await closeServer(server);

});

test("http.delete() envía DELETE", async () => {

    let receivedMethod = null;

    const { server, url } = await createServer((req, res) => {
        receivedMethod = req.method;
        res.writeHead(204);
        res.end();
    });

    const res = await httpService.delete(`${url}/item/1`);
    assert.equal(receivedMethod, "DELETE");
    assert.equal(res.status, 204);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

test("http.request() envía headers custom y default", async () => {

    let receivedHeaders = {};

    const { server, url } = await createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.configure({ defaultHeaders: { "x-global": "yes" } });

    await httpService.get(`${url}/test`, {
        headers: { "x-custom": "hello" }
    });

    assert.equal(receivedHeaders["x-global"], "yes");
    assert.equal(receivedHeaders["x-custom"], "hello");

    httpService.configure({ defaultHeaders: {} });

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

test("http.get() agrega query params a la URL", async () => {

    let receivedUrl = null;

    const { server, url } = await createServer((req, res) => {
        receivedUrl = req.url;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    await httpService.get(`${url}/search`, {
        query: { q: "hello", page: 1, active: true }
    });

    assert.match(receivedUrl, /q=hello/);
    assert.match(receivedUrl, /page=1/);
    assert.match(receivedUrl, /active=true/);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Errores HTTP (non-2xx)
// ---------------------------------------------------------------------------

test("http.request() lanza error en non-2xx con status y body", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    });

    try {
        await httpService.get(`${url}/missing`);
        assert.fail("should have thrown");
    } catch (err) {
        assert.equal(err.status, 404);
        assert.deepEqual(err.body, { error: "not found" });
        assert.match(err.message, /404/);
    }

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test("http.request() lanza error en timeout", async () => {

    const { server, url } = await createServer((req, res) => {
        setTimeout(() => {
            res.writeHead(200);
            res.end("late");
        }, 2000);
    });

    try {
        await httpService.get(`${url}/slow`, { timeout: 100 });
        assert.fail("should have thrown");
    } catch (err) {
        assert.match(err.message, /timeout/i);
        assert.equal(err.status, 0);
    }

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Request interceptors
// ---------------------------------------------------------------------------

test("request interceptor puede mutar headers antes de enviar", async () => {

    let receivedHeaders = {};

    const { server, url } = await createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearRequestInterceptors();
    httpService.addRequestInterceptor((ctx) => {
        ctx.request.headers["x-auth-token"] = "abc123";
    });

    await httpService.get(`${url}/protected`);

    assert.equal(receivedHeaders["x-auth-token"], "abc123");

    httpService.clearRequestInterceptors();
    await closeServer(server);

});

test("request interceptor puede abortar la petición", async () => {

    let serverHit = false;

    const { server, url } = await createServer((req, res) => {
        serverHit = true;
        res.writeHead(200);
        res.end("ok");
    });

    httpService.clearRequestInterceptors();
    httpService.addRequestInterceptor((ctx) => {
        if (ctx.request.url.includes("/blocked")) {
            ctx.abort("blocked by policy");
        }
    });

    try {
        await httpService.get(`${url}/blocked`);
        assert.fail("should have thrown");
    } catch (err) {
        assert.match(err.message, /blocked by policy/);
    }

    assert.equal(serverHit, false);

    httpService.clearRequestInterceptors();
    await closeServer(server);

});

test("múltiples request interceptors se ejecutan en orden", async () => {

    const order = [];

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearRequestInterceptors();
    httpService.addRequestInterceptor(() => { order.push("first"); });
    httpService.addRequestInterceptor(() => { order.push("second"); });
    httpService.addRequestInterceptor(() => { order.push("third"); });

    await httpService.get(`${url}/test`);

    assert.deepEqual(order, ["first", "second", "third"]);

    httpService.clearRequestInterceptors();
    await closeServer(server);

});

test("request interceptor async se espera correctamente", async () => {

    let receivedHeaders = {};

    const { server, url } = await createServer((req, res) => {
        receivedHeaders = req.headers;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearRequestInterceptors();
    httpService.addRequestInterceptor(async (ctx) => {
        await new Promise(r => setTimeout(r, 10));
        ctx.request.headers["x-delayed"] = "yes";
    });

    await httpService.get(`${url}/test`);

    assert.equal(receivedHeaders["x-delayed"], "yes");

    httpService.clearRequestInterceptors();
    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Response interceptors
// ---------------------------------------------------------------------------

test("response interceptor puede mutar la respuesta", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ raw: true }));
    });

    httpService.clearResponseInterceptors();
    httpService.addResponseInterceptor((ctx) => {
        ctx.response.body = { ...ctx.response.body, injected: true };
    });

    const res = await httpService.get(`${url}/test`);

    assert.deepEqual(res.body, { raw: true, injected: true });

    httpService.clearResponseInterceptors();
    await closeServer(server);

});

test("múltiples response interceptors se ejecutan en orden", async () => {

    const order = [];

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearResponseInterceptors();
    httpService.addResponseInterceptor(() => { order.push("first"); });
    httpService.addResponseInterceptor(() => { order.push("second"); });
    httpService.addResponseInterceptor(() => { order.push("third"); });

    await httpService.get(`${url}/test`);

    assert.deepEqual(order, ["first", "second", "third"]);

    httpService.clearResponseInterceptors();
    await closeServer(server);

});

test("response interceptor async se espera correctamente", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ original: true }));
    });

    httpService.clearResponseInterceptors();
    httpService.addResponseInterceptor(async (ctx) => {
        await new Promise(r => setTimeout(r, 10));
        ctx.response.body = { ...ctx.response.body, asyncInjected: true };
    });

    const res = await httpService.get(`${url}/test`);

    assert.deepEqual(res.body, { original: true, asyncInjected: true });

    httpService.clearResponseInterceptors();
    await closeServer(server);

});

// ---------------------------------------------------------------------------
// removeRequestInterceptor / removeResponseInterceptor
// ---------------------------------------------------------------------------

test("removeRequestInterceptor elimina el interceptor correcto", async () => {

    const order = [];

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearRequestInterceptors();
    const first = () => { order.push("first"); };
    const second = () => { order.push("second"); };

    httpService.addRequestInterceptor(first);
    httpService.addRequestInterceptor(second);

    httpService.removeRequestInterceptor(first);

    await httpService.get(`${url}/test`);

    assert.deepEqual(order, ["second"]);

    httpService.clearRequestInterceptors();
    await closeServer(server);

});

test("removeResponseInterceptor elimina el interceptor correcto", async () => {

    const order = [];

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.clearResponseInterceptors();
    const first = () => { order.push("first"); };
    const second = () => { order.push("second"); };

    httpService.addResponseInterceptor(first);
    httpService.addResponseInterceptor(second);

    httpService.removeResponseInterceptor(first);

    await httpService.get(`${url}/test`);

    assert.deepEqual(order, ["second"]);

    httpService.clearResponseInterceptors();
    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Múltiples instancias aisladas
// ---------------------------------------------------------------------------

test("múltiples instancias de HttpService tienen interceptores aislados", async () => {

    const serviceA = new HttpService();
    const serviceB = new HttpService();

    const orderA = [];
    const orderB = [];

    serviceA.addRequestInterceptor(() => { orderA.push("a"); });
    serviceB.addRequestInterceptor(() => { orderB.push("b"); });

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    await serviceA.get(`${url}/test`);
    await serviceB.get(`${url}/test`);

    assert.deepEqual(orderA, ["a"]);
    assert.deepEqual(orderB, ["b"]);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// configure() con baseUrl
// ---------------------------------------------------------------------------

test("configure() con baseUrl permite peticiones relativas", async () => {

    let receivedUrl = null;

    const { server, url } = await createServer((req, res) => {
        receivedUrl = req.url;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    httpService.configure({ baseUrl: url });

    const res = await httpService.get("/api/test");

    assert.equal(receivedUrl, "/api/test");
    assert.equal(res.status, 200);

    httpService.configure({ baseUrl: "" });
    await closeServer(server);

});

// ---------------------------------------------------------------------------
// dryRun
// ---------------------------------------------------------------------------

test("http.request() con dryRun no envía la petición", async () => {

    let serverHit = false;

    const { server, url } = await createServer((req, res) => {
        serverHit = true;
        res.writeHead(200);
        res.end("ok");
    });

    const res = await httpService.get(`${url}/test`, { exec: { dryRun: true } });

    assert.equal(serverHit, false);
    assert.equal(res.status, 0);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Body parsing: non-JSON
// ---------------------------------------------------------------------------

test("http.get() parsea body como texto si no es JSON", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello world");
    });

    const res = await httpService.get(`${url}/text`);

    assert.equal(res.body, "hello world");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Chainable API
// ---------------------------------------------------------------------------

test("configure(), addRequestInterceptor(), addResponseInterceptor() son chainable", async () => {

    const service = new HttpService();

    const result = service
        .configure({ baseUrl: "http://localhost" })
        .addRequestInterceptor(() => {})
        .addResponseInterceptor(() => {});

    assert.equal(result, service);

});

// ---------------------------------------------------------------------------
// HttpRegistry — agentes nombrados
// ---------------------------------------------------------------------------

test("createAgent() registra un agente y agent() lo devuelve", async () => {

    let receivedSource = null;

    const { server, url } = await createServer((req, res) => {
        receivedSource = req.headers["x-source"];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ from: "internal" }));
    });

    httpService.createAgent("internal", {
        baseUrl: url,
        defaultHeaders: { "x-source": "internal" }
    });

    const res = await httpService.agent("internal").get("/test");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { from: "internal" });
    assert.equal(receivedSource, "internal");

    httpService.removeAgent("internal");
    await closeServer(server);

});

test("agent() lanza si el agente no existe", () => {

    assert.throws(
        () => httpService.agent("nonexistent"),
        /not found/
    );

});

test("removeAgent() elimina el agente y agent() ya no lo encuentra", () => {

    httpService.createAgent("temp");

    assert.deepEqual(httpService.listAgents().includes("temp"), true);

    httpService.removeAgent("temp");

    assert.throws(
        () => httpService.agent("temp"),
        /not found/
    );

});

test("listAgents() devuelve los nombres de todos los agentes registrados", () => {

    httpService.createAgent("alpha");
    httpService.createAgent("beta");

    const names = httpService.listAgents();

    assert.ok(names.includes("alpha"));
    assert.ok(names.includes("beta"));

    httpService.removeAgent("alpha");
    httpService.removeAgent("beta");

});

test("agentes nombrados tienen interceptores aislados entre sí", async () => {

    const orderA = [];
    const orderB = [];

    httpService.createAgent("agentA", {
        requestInterceptors: [() => { orderA.push("a"); }]
    });
    httpService.createAgent("agentB", {
        requestInterceptors: [() => { orderB.push("b"); }]
    });

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    await httpService.agent("agentA").get(`${url}/test`);
    await httpService.agent("agentB").get(`${url}/test`);

    assert.deepEqual(orderA, ["a"]);
    assert.deepEqual(orderB, ["b"]);

    httpService.removeAgent("agentA");
    httpService.removeAgent("agentB");
    await closeServer(server);

});

test("agentes nombrados no afectan al default ni entre sí", async () => {

    const defaultHeaders = [];
    const agentHeaders = [];

    httpService.clearRequestInterceptors();
    httpService.addRequestInterceptor((ctx) => {
        defaultHeaders.push(ctx.request.headers["x-default"]);
    });

    httpService.createAgent("special", {
        requestInterceptors: [(ctx) => {
            agentHeaders.push(ctx.request.headers["x-agent"]);
        }]
    });

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
    });

    await httpService.get(`${url}/test`, { headers: { "x-default": "yes" } });
    await httpService.agent("special").get(`${url}/test`, { headers: { "x-agent": "yes" } });

    assert.deepEqual(defaultHeaders, ["yes"]);
    assert.deepEqual(agentHeaders, ["yes"]);

    httpService.clearRequestInterceptors();
    httpService.removeAgent("special");
    await closeServer(server);

});

test("createAgent() reemplaza un agente existente con el mismo nombre", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ version: "v2" }));
    });

    httpService.createAgent("versioned");
    httpService.createAgent("versioned", { baseUrl: url });

    const res = await httpService.agent("versioned").get("/test");

    assert.deepEqual(res.body, { version: "v2" });

    httpService.removeAgent("versioned");
    await closeServer(server);

});

test("createAgent() aplica responseInterceptors del config", async () => {

    const { server, url } = await createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { inner: "value" } }));
    });

    httpService.createAgent("unwrap", {
        baseUrl: url,
        responseInterceptors: [
            (ctx) => {
                if (ctx.response.body?.data) {
                    ctx.response.body = ctx.response.body.data;
                }
            }
        ]
    });

    const res = await httpService.agent("unwrap").get("/test");

    assert.deepEqual(res.body, { inner: "value" });

    httpService.removeAgent("unwrap");
    await closeServer(server);

});

test("createAgent() es chainable", () => {

    const result = httpService
        .createAgent("a")
        .createAgent("b");

    assert.equal(result, httpService);

    httpService.removeAgent("a");
    httpService.removeAgent("b");

});
