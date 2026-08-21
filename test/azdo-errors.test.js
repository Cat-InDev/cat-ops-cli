const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
    AzureDevOpsApi,
    HttpService,
    AzdoApiError,
    parseAzdoError,
    formatAzdoError
} = require("../dist");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => handler(req, res, body));
        });
        server.listen(0, () => {
            resolve({ server, url: `http://localhost:${server.address().port}` });
        });
    });
}

function createApi(url) {
    const agent = new HttpService();
    return new AzureDevOpsApi().configure({
        baseUrl: url,
        pat: "test-pat-token",
        project: "my-project",
        agent
    });
}

// ---------------------------------------------------------------------------
// parseAzdoError — unidad
// ---------------------------------------------------------------------------

test("parseAzdoError devuelve null para errores no-HTTP", () => {

    assert.equal(parseAzdoError(new Error("boom")), null);
    assert.equal(parseAzdoError("un string"), null);
    assert.equal(parseAzdoError(null), null);
    assert.equal(parseAzdoError({ foo: 1 }), null);

});

test("parseAzdoError extrae message/typeKey/code y clasifica permisos", () => {

    const err = new Error("HTTP POST https://dev.azure.com/org/proj/_apis/git/pushes responded with 403");
    err.status = 403;
    err.headers = { "x-tfs": "1" };
    err.body = {
        "$id": "1",
        "innerException": null,
        "message": "TF401027: You need the Git 'ForcePush' permission to perform this operation.",
        "typeName": "Microsoft.TeamFoundation.Server.Core.RequestNotAuthorizedException, Microsoft.TeamFoundation.Server.Core",
        "typeKey": "RequestNotAuthorizedException",
        "errorCode": 0,
        "eventId": 3000
    };
    err.request = { url: "https://dev.azure.com/org/proj/_apis/git/pushes", method: "POST" };

    const detail = parseAzdoError(err);

    assert.ok(detail);
    assert.equal(detail.status, 403);
    assert.equal(detail.statusLabel, "Forbidden");
    assert.equal(detail.kind, "Permisos");
    assert.equal(detail.code, "TF401027");
    assert.ok(detail.codeSummary && /ForcePush/i.test(detail.codeSummary));
    assert.equal(detail.typeKey, "RequestNotAuthorizedException");
    assert.match(detail.typeName, /RequestNotAuthorizedException/);
    assert.equal(detail.errorCode, 0);
    assert.equal(detail.eventId, 3000);
    assert.equal(detail.serverMessage, "TF401027: You need the Git 'ForcePush' permission to perform this operation.");
    assert.equal(detail.method, "POST");
    assert.match(detail.url, /git\/pushes$/);
    assert.ok(detail.hints.some(h => /Force push|ForcePush/i.test(h)));

});

test("parseAzdoError aplana la cadena innerException", () => {

    const err = new Error("responded with 400");
    err.status = 400;
    err.body = {
        message: "VS402397: The pipeline is not valid.",
        innerException: {
            message: "TF400889: root cause",
            innerException: { message: "nested level 2" }
        },
        typeKey: "InvalidPipelineException"
    };

    const detail = parseAzdoError(err);

    assert.deepEqual(detail.innerMessages, ["TF400889: root cause", "nested level 2"]);
    assert.equal(detail.kind, "Petición inválida");

});

test("parseAzdoError soporta cuerpos que no son JSON (texto plano)", () => {

    const err = new Error("responded with 502");
    err.status = 502;
    err.body = "<html>Bad Gateway</html>";

    const detail = parseAzdoError(err);

    assert.ok(detail);
    assert.equal(detail.serverMessage, "<html>Bad Gateway</html>");
    assert.equal(detail.kind, "Error del servidor");
    assert.equal(detail.code, null);

});

test("parseAzdoError clasifica errores de red/timeout (status 0)", () => {

    const err = new Error("timeout after 5000ms");
    err.status = 0;
    err.body = null;
    err.request = { url: "https://dev.azure.com/org", method: "GET" };

    const detail = parseAzdoError(err);

    assert.ok(detail);
    assert.equal(detail.status, 0);
    assert.equal(detail.kind, "Red / Timeout");
    assert.equal(detail.serverMessage, null);

});

// ---------------------------------------------------------------------------
// formatAzdoError
// ---------------------------------------------------------------------------

test("formatAzdoError produce salida legible multi-línea", () => {

    const err = new Error("responded with 403");
    err.status = 403;
    err.body = {
        message: "TF401027: You need the Git 'ForcePush' permission to perform this operation.",
        typeKey: "RequestNotAuthorizedException",
        typeName: "Microsoft.TeamFoundation.Server.Core.RequestNotAuthorizedException, Microsoft.TeamFoundation.Server.Core",
        errorCode: 0,
        eventId: 3000
    };
    err.request = { url: "https://dev.azure.com/org/proj/_apis/git/pushes?api-version=7.1", method: "POST" };

    const text = formatAzdoError(err);

    assert.match(text, /HTTP 403 Forbidden/);
    assert.match(text, /POST .*git\/pushes/);
    assert.match(text, /TF401027: You need the Git 'ForcePush'/);
    assert.match(text, /código=TF401027/);
    assert.match(text, /tipo=RequestNotAuthorizedException/);
    assert.match(text, /eventId=3000/);
    assert.match(text, /Sugerencias:/);
    // El typeName largo se recorta al nombre de clase
    assert.ok(!text.includes("Microsoft.TeamFoundation.Server.Core.RequestNotAuthorizedException,"));

});

test("formatAzdoError acepta un detalle ya parseado", () => {

    const err = new Error("responded with 404");
    err.status = 404;
    err.body = { message: "VS800075: The project does not exist or you do not have access to it." };
    err.request = { url: "https://dev.azure.com/org/_apis/projects/x", method: "GET" };

    const detail = parseAzdoError(err);
    const fromDetail = formatAzdoError(detail);
    const direct = formatAzdoError(err);

    assert.equal(fromDetail, direct);

});

test("formatAzdoError cae al mensaje original para errores no parseables", () => {

    const plain = new Error("not configured");
    assert.equal(formatAzdoError(plain), "not configured");
    assert.equal(formatAzdoError(42), "42");

});

// ---------------------------------------------------------------------------
// Integración con AzureDevOpsApi
// ---------------------------------------------------------------------------

test("AzureDevOpsApi lanza AzdoApiError con detalle legible en errores HTTP", async () => {

    const { server, url } = await startServer((req, res) => {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({
            message: "TF401027: You need the Git 'ForcePush' permission to perform this operation.",
            typeName: "Microsoft.TeamFoundation.Server.Core.RequestNotAuthorizedException, Microsoft.TeamFoundation.Server.Core",
            typeKey: "RequestNotAuthorizedException",
            errorCode: 0,
            eventId: 3000
        }));
    });

    try {
        const api = createApi(url);

        const err = await api.listBranches("my-repo").catch(e => e);

        assert.ok(err instanceof AzdoApiError);
        assert.equal(err.name, "AzdoApiError");
        assert.equal(err.status, 403);
        assert.equal(err.detail.code, "TF401027");
        assert.match(err.message, /\[AZDO\]/);
        assert.match(err.message, /TF401027/);

        // toString() legible multi-línea
        assert.match(String(err), /Sugerencias:/);
    } finally {
        await new Promise(r => server.close(r));
    }

});

test("los checks de status === 404 siguen funcionando tras el wrap", async () => {

    const { server, url } = await startServer((req, res) => {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({
            message: "VS800075: The project with id 'missing-project' does not exist or you do not have access to it."
        }));
    });

    try {
        const api = createApi(url);

        // branchExists debe devolver false (el error envuelto conserva .status)
        const exists = await api.branchExists("my-repo", "feature/no-existe");
        assert.equal(exists, false);

        // repoExists debe devolver undefined
        const repo = await api.repoExists(undefined, "no-existe-repo");
        assert.equal(repo, undefined);
    } finally {
        await new Promise(r => server.close(r));
    }

});
