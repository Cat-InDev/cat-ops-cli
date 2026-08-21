const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { AzureDevOpsApi, HttpService } = require("../dist");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(onRequest) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                const seen = onRequest(req);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ count: 1, value: [{ id: "repo-1", name: "my-repo" }], seen }));
            });
        });
        server.listen(0, () => {
            resolve({ server, url: `http://localhost:${server.address().port}` });
        });
    });
}

function createApi(url, extra = {}) {
    return new AzureDevOpsApi().configure({
        baseUrl: url,
        pat: "test-pat-token",
        project: "my-project",
        ...extra
    });
}

// ---------------------------------------------------------------------------
// Interceptores vía configure()
// ---------------------------------------------------------------------------

test("configure() con requestInterceptors agrega headers al agente interno perezoso", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const api = createApi(url, {
            requestInterceptors: [
                ctx => { ctx.request.headers["x-correlation-id"] = "abc-123"; }
            ]
        });

        const res = await api.listRepos();

        assert.equal(res.status, 200);
        assert.equal(seen["x-correlation-id"], "abc-123");
        // El auth normal sigue presente
        assert.match(seen["authorization"], /^Basic /);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("configure() con responseInterceptors puede mutar la respuesta", async () => {

    const { server, url } = await startServer(() => null);

    try {
        const api = createApi(url, {
            responseInterceptors: [
                ctx => { ctx.response.body.__touchedByInterceptor = true; }
            ]
        });

        const res = await api.listRepos();

        assert.equal(res.body.__touchedByInterceptor, true);
        assert.equal(res.body.count, 1);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("configure() acepta varios interceptores y se ejecutan en orden", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const order = [];
        const api = createApi(url, {
            requestInterceptors: [
                ctx => { order.push("a"); ctx.request.headers["x-order"] = "a"; },
                ctx => { order.push("b"); ctx.request.headers["x-order"] += "-b"; }
            ]
        });

        await api.listRepos();

        assert.deepEqual(order, ["a", "b"]);
        assert.equal(seen["x-order"], "a-b");
    } finally {
        await new Promise(r => server.close(r));
    }

});

// ---------------------------------------------------------------------------
// Métodos add/remove/clear
// ---------------------------------------------------------------------------

test("addRequestInterceptor() antes del primer request queda en cola y se aplica al crear el agente", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const api = createApi(url);
        api.addRequestInterceptor(ctx => { ctx.request.headers["x-late"] = "yes"; });

        // El agente aún no existe — no debe lanzar ni crear nada todavía
        await api.listRepos();

        assert.equal(seen["x-late"], "yes");
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("removeRequestInterceptor() elimina un interceptor aún pendiente", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const api = createApi(url);
        const spy = ctx => { ctx.request.headers["x-spy"] = "1"; };

        api.addRequestInterceptor(spy);
        api.removeRequestInterceptor(spy);

        await api.listRepos();

        assert.ok(!("x-spy" in seen));
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("clearRequestInterceptors() limpia los pendientes", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const api = createApi(url);
        api.addRequestInterceptor(ctx => { ctx.request.headers["x-one"] = "1"; });
        api.addRequestInterceptor(ctx => { ctx.request.headers["x-two"] = "2"; });

        api.clearRequestInterceptors();
        await api.listRepos();

        assert.ok(!("x-one" in seen));
        assert.ok(!("x-two" in seen));
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("los métodos son chainable", () => {

    const api = new AzureDevOpsApi();
    const i = () => {};

    assert.equal(api.addRequestInterceptor(i), api);
    assert.equal(api.removeRequestInterceptor(i), api);
    assert.equal(api.clearRequestInterceptors(), api);
    assert.equal(api.addResponseInterceptor(i), api);
    assert.equal(api.removeResponseInterceptor(i), api);
    assert.equal(api.clearResponseInterceptors(), api);

});

// ---------------------------------------------------------------------------
// Agente externo
// ---------------------------------------------------------------------------

test("los interceptores se aplican también a un agente externo inyectado", async () => {

    let seen = {};
    const { server, url } = await startServer(req => {
        seen = req.headers;
        return null;
    });

    try {
        const agent = new HttpService();
        const api = createApi(url, {
            agent,
            requestInterceptors: [
                ctx => { ctx.request.headers["x-shared-agent"] = "true"; }
            ]
        });

        await api.listRepos();
        assert.equal(seen["x-shared-agent"], "true");

        // El interceptor vive en el AGENTE, así que peticiones hechas directo
        // al mismo agente por otros consumidores también lo llevan.
        delete seen["x-shared-agent"];
        await agent.get(`${url}/direct-call`);
        assert.equal(seen["x-shared-agent"], "true");
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("un agente custom sin soporte de interceptores lanza error descriptivo", async () => {

    const { server, url } = await startServer(() => null);

    try {
        const minimalAgent = {
            request: async (req) => ({ status: 200, headers: {}, body: null, request: req })
        };
        const api = createApi(url, { agent: minimalAgent });

        assert.throws(
            () => api.addRequestInterceptor(() => {}),
            /no soporta interceptores.*falta "addRequestInterceptor"/s
        );

        assert.throws(
            () => createApi(url, { agent: minimalAgent, requestInterceptors: [() => {}] }),
            /no soporta interceptores/s
        );
    } finally {
        await new Promise(r => server.close(r));
    }

});
