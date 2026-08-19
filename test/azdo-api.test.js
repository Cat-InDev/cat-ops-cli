const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { AzureDevOpsApi, HttpService } = require("../dist");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockServer(routes) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {

            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {

                const url = new URL(req.url, `http://localhost`);
                const decodedPath = decodeURIComponent(url.pathname);
                const routeKey = `${req.method} ${decodedPath}`;
                const route = routes[routeKey];

                if (route) {
                    res.writeHead(200, { "content-type": "application/json" });
                    res.end(JSON.stringify(route(url, body ? JSON.parse(body) : null)));
                } else {
                    res.writeHead(404, { "content-type": "application/json" });
                    res.end(JSON.stringify({ message: "Not Found" }));
                }
            });
        });

        server.listen(0, () => {
            resolve({ server, url: `http://localhost:${server.address().port}` });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
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
// configure()
// ---------------------------------------------------------------------------

test("AzureDevOpsApi lanza si no está configurado", async () => {

    const api = new AzureDevOpsApi();

    try {
        await api.listRepos();
        assert.fail("should have thrown");
    } catch (err) {
        assert.match(err.message, /not configured/i);
    }

});

test("configure() es chainable", () => {

    const api = new AzureDevOpsApi();
    const result = api.configure({
        baseUrl: "https://dev.azure.com/test",
        pat: "token"
    });

    assert.equal(result, api);

});

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

test("envía Authorization Basic con PAT codificado en base64", async () => {

    let receivedAuth = null;

    const server = http.createServer((req, res) => {
        receivedAuth = req.headers["authorization"];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ count: 0, value: [] }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const url = `http://localhost:${server.address().port}`;

    const api = createApi(url);
    await api.listRepos();

    const expected = `Basic ${Buffer.from(":test-pat-token").toString("base64")}`;
    assert.equal(receivedAuth, expected);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

test("listProjects() llama al endpoint correcto", async () => {

    const { server, url } = await createMockServer({
        "GET /_apis/projects": () => ({
            count: 2,
            value: [
                { id: "p1", name: "Project A", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" },
                { id: "p2", name: "Project B", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" }
            ]
        })
    });

    const api = createApi(url);
    const res = await api.listProjects();

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.value[0].name, "Project A");

    await closeServer(server);

});

test("getProject() llama al endpoint con el nombre correcto", async () => {

    let receivedPath = null;

    const { server, url } = await createMockServer({
        "GET /_apis/projects/TestProject": (parsedUrl) => {
            receivedPath = parsedUrl.pathname;
            return { id: "p1", name: "TestProject", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" };
        }
    });

    const api = createApi(url);
    await api.getProject("TestProject");

    assert.match(receivedPath, /TestProject/);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Git Repositories
// ---------------------------------------------------------------------------

test("listRepos() lista repos del proyecto", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories": () => ({
            count: 2,
            value: [
                { id: "r1", name: "frontend", url: "", defaultBranch: "refs/heads/main", project: { id: "p1", name: "my-project", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" }, size: 1024, remoteUrl: "", sshUrl: "", webUrl: "", isDisabled: false },
                { id: "r2", name: "backend", url: "", defaultBranch: "refs/heads/main", project: { id: "p1", name: "my-project", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" }, size: 2048, remoteUrl: "", sshUrl: "", webUrl: "", isDisabled: false }
            ]
        })
    });

    const api = createApi(url);
    const res = await api.listRepos();

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.value[0].name, "frontend");
    assert.equal(res.body.value[1].name, "backend");

    await closeServer(server);

});

test("getRepo() obtiene un repo por nombre", async () => {

    let receivedPath = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend": (parsedUrl) => {
            receivedPath = parsedUrl.pathname;
            return { id: "r1", name: "frontend", url: "", defaultBranch: "refs/heads/main", project: { id: "p1", name: "my-project", url: "", state: "wellFormed", revision: "1", visibility: "private", lastUpdateTime: "" }, size: 1024, remoteUrl: "", sshUrl: "", webUrl: "", isDisabled: false };
        }
    });

    const api = createApi(url);
    const res = await api.getRepo("frontend");

    assert.match(receivedPath, /frontend/);
    assert.equal(res.body.name, "frontend");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

test("listBranches() lista branches de un repo", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/refs": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("filter");
            return {
                count: 2,
                value: [
                    { name: "refs/heads/main", aheadCount: 0, behindCount: 0, isBaseVersion: true, commit: { commitId: "abc123", author: { name: "Dev", email: "dev@test.com", date: "" }, committer: { name: "Dev", email: "dev@test.com", date: "" }, comment: "initial", url: "" } },
                    { name: "refs/heads/feature/login", aheadCount: 3, behindCount: 1, isBaseVersion: false, commit: { commitId: "def456", author: { name: "Dev", email: "dev@test.com", date: "" }, committer: { name: "Dev", email: "dev@test.com", date: "" }, comment: "feat: login", url: "" } }
                ]
            };
        }
    });

    const api = createApi(url);
    const res = await api.listBranches("frontend");

    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.value[0].name, "refs/heads/main");
    assert.equal(res.body.value[1].name, "refs/heads/feature/login");
    assert.equal(receivedQuery, "heads/");

    await closeServer(server);

});

test("branchExists() devuelve true si la branch existe", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/refs/refs/heads/main": () => ({
            name: "refs/heads/main", aheadCount: 0, behindCount: 0, isBaseVersion: true,
            commit: { commitId: "abc", author: { name: "D", email: "d@t.com", date: "" }, committer: { name: "D", email: "d@t.com", date: "" }, comment: "", url: "" }
        })
    });

    const api = createApi(url);
    const exists = await api.branchExists("frontend", "main");

    assert.equal(exists, true);

    await closeServer(server);

});

test("branchExists() devuelve false si la branch no existe (404)", async () => {

    const { server, url } = await createMockServer({});

    const api = createApi(url);
    const exists = await api.branchExists("frontend", "nonexistent");

    assert.equal(exists, false);

    await closeServer(server);

});

test("getBranch() obtiene una branch específica", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/refs/refs/heads/feature/login": () => ({
            name: "refs/heads/feature/login", aheadCount: 3, behindCount: 1, isBaseVersion: false,
            commit: { commitId: "def456", author: { name: "Dev", email: "d@t.com", date: "" }, committer: { name: "Dev", email: "d@t.com", date: "" }, comment: "feat: login", url: "" }
        })
    });

    const api = createApi(url);
    const res = await api.getBranch("frontend", "feature/login");

    assert.equal(res.body.name, "refs/heads/feature/login");
    assert.equal(res.body.aheadCount, 3);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

test("listCommits() lista commits de una branch", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/git/repositories/frontend/commits": (parsedUrl, body) => {
            receivedBody = body;
            return {
                count: 1,
                value: [
                    { commitId: "abc123", author: { name: "Dev", email: "d@t.com", date: "" }, committer: { name: "Dev", email: "d@t.com", date: "" }, comment: "feat: add login", url: "" }
                ]
            };
        }
    });

    const api = createApi(url);
    const res = await api.listCommits("frontend", { branch: "feature/login", top: 10 });

    assert.equal(res.status, 200);
    assert.equal(res.body.value[0].commitId, "abc123");
    assert.equal(receivedBody.searchCriteria.itemVersion.version, "feature/login");
    assert.equal(receivedBody.searchCriteria.itemVersion.versionType, "branch");

    await closeServer(server);

});

test("listCommits() usa 'main' como branch por defecto", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/git/repositories/frontend/commits": (parsedUrl, body) => {
            receivedBody = body;
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listCommits("frontend");

    assert.equal(receivedBody.searchCriteria.itemVersion.version, "main");

    await closeServer(server);

});

test("getCommit() obtiene un commit por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/commits/abc123": () => ({
            commitId: "abc123", author: { name: "Dev", email: "d@t.com", date: "" }, committer: { name: "Dev", email: "d@t.com", date: "" }, comment: "fix: bug", url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getCommit("frontend", "abc123");

    assert.equal(res.body.commitId, "abc123");
    assert.equal(res.body.comment, "fix: bug");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

test("listPullRequests() lista PRs activos por defecto", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/pullrequests": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("status");
            return {
                count: 1,
                value: [
                    { pullRequestId: 42, title: "Add login", description: "", status: "active", createdBy: { name: "Dev", email: "d@t.com", date: "" }, creationDate: "", sourceRefName: "refs/heads/feature/login", targetRefName: "refs/heads/main", mergeStatus: "succeeded", mergeId: "", url: "" }
                ]
            };
        }
    });

    const api = createApi(url);
    const res = await api.listPullRequests("frontend");

    assert.equal(res.status, 200);
    assert.equal(res.body.value[0].pullRequestId, 42);
    assert.equal(res.body.value[0].title, "Add login");
    assert.equal(receivedQuery, "active");

    await closeServer(server);

});

test("listPullRequests() respeta el status override", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/pullrequests": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("status");
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listPullRequests("frontend", { status: "completed" });

    assert.equal(receivedQuery, "completed");

    await closeServer(server);

});

test("getPullRequest() obtiene un PR por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories/frontend/pullrequests/42": () => ({
            pullRequestId: 42, title: "Add login", description: "Login flow", status: "active",
            createdBy: { name: "Dev", email: "d@t.com", date: "" }, creationDate: "",
            sourceRefName: "refs/heads/feature/login", targetRefName: "refs/heads/main",
            mergeStatus: "succeeded", mergeId: "", url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getPullRequest("frontend", 42);

    assert.equal(res.body.pullRequestId, 42);
    assert.equal(res.body.title, "Add login");

    await closeServer(server);

});

test("createPullRequest() envía POST con el body correcto", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/git/repositories/frontend/pullrequests": (parsedUrl, body) => {
            receivedBody = body;
            return {
                pullRequestId: 99, title: body.title, description: body.description || "",
                status: "active", createdBy: { name: "Dev", email: "d@t.com", date: "" },
                creationDate: "", sourceRefName: body.sourceRefName, targetRefName: body.targetRefName,
                mergeStatus: "succeeded", mergeId: "", url: ""
            };
        }
    });

    const api = createApi(url);
    const res = await api.createPullRequest("frontend", {
        sourceRefName: "refs/heads/feature/new",
        targetRefName: "refs/heads/main",
        title: "New feature",
        description: "Adds new feature"
    });

    assert.equal(res.body.pullRequestId, 99);
    assert.equal(receivedBody.title, "New feature");
    assert.equal(receivedBody.sourceRefName, "refs/heads/feature/new");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Build Definitions
// ---------------------------------------------------------------------------

test("listBuildDefinitions() lista definiciones de build", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/build/definitions": () => ({
            count: 1,
            value: [{ id: 1, name: "CI Pipeline", path: "\\", queueStatus: "enabled", revision: 1, type: "build", url: "" }]
        })
    });

    const api = createApi(url);
    const res = await api.listBuildDefinitions();

    assert.equal(res.body.count, 1);
    assert.equal(res.body.value[0].name, "CI Pipeline");

    await closeServer(server);

});

test("getBuildDefinition() obtiene una definición por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/build/definitions/1": () => ({
            id: 1, name: "CI Pipeline", path: "\\", queueStatus: "enabled", revision: 1, type: "build", url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getBuildDefinition(1);

    assert.equal(res.body.id, 1);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

test("listBuilds() lista builds recientes", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/build/builds": () => ({
            count: 1,
            value: [{ id: 100, buildNumber: "20240101.1", status: "completed", result: "succeeded", definition: { id: 1, name: "CI" }, requestedBy: { name: "Dev", email: "d@t.com", date: "" }, startTime: "", finishTime: "", url: "" }]
        })
    });

    const api = createApi(url);
    const res = await api.listBuilds();

    assert.equal(res.body.value[0].buildNumber, "20240101.1");
    assert.equal(res.body.value[0].result, "succeeded");

    await closeServer(server);

});

test("listBuilds() filtra por definitionId", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/build/builds": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("definitionId");
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listBuilds({ definitionId: 5 });

    assert.equal(receivedQuery, "5");

    await closeServer(server);

});

test("getBuild() obtiene un build por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/build/builds/100": () => ({
            id: 100, buildNumber: "20240101.1", status: "completed", result: "succeeded",
            definition: { id: 1, name: "CI" }, requestedBy: { name: "Dev", email: "d@t.com", date: "" },
            startTime: "", finishTime: "", url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getBuild(100);

    assert.equal(res.body.id, 100);

    await closeServer(server);

});

test("queueBuild() ejecuta un build con body correcto", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/build/builds": (parsedUrl, body) => {
            receivedBody = body;
            return {
                id: 200, buildNumber: "pending", status: "notStarted", result: null,
                definition: { id: 1, name: "CI" }, requestedBy: { name: "Dev", email: "d@t.com", date: "" },
                startTime: "", finishTime: "", url: ""
            };
        }
    });

    const api = createApi(url);
    await api.queueBuild(1, { branch: "feature/test" });

    assert.equal(receivedBody.definition.id, 1);
    assert.equal(receivedBody.sourceBranch, "refs/heads/feature/test");

    await closeServer(server);

});

test("queueBuild() agrega refs/ si la branch no lo trae", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/build/builds": (parsedUrl, body) => {
            receivedBody = body;
            return { id: 200, buildNumber: "p", status: "notStarted", result: null, definition: { id: 1, name: "" }, requestedBy: { name: "", email: "", date: "" }, startTime: "", finishTime: "", url: "" };
        }
    });

    const api = createApi(url);
    await api.queueBuild(1, { branch: "main" });

    assert.equal(receivedBody.sourceBranch, "refs/heads/main");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

test("listPipelines() lista pipelines", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/pipelines": () => ({
            count: 1,
            value: [{ id: 10, name: "Deploy Pipeline", folder: "\\", revision: 1, url: "" }]
        })
    });

    const api = createApi(url);
    const res = await api.listPipelines();

    assert.equal(res.body.value[0].name, "Deploy Pipeline");

    await closeServer(server);

});

test("getPipeline() obtiene un pipeline por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/pipelines/10": () => ({
            id: 10, name: "Deploy Pipeline", folder: "\\", revision: 1, url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getPipeline(10);

    assert.equal(res.body.id, 10);

    await closeServer(server);

});

test("runPipeline() ejecuta un pipeline con branch", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/pipelines/10/runs": (parsedUrl, body) => {
            receivedBody = body;
            return { id: 1, name: "run-1", state: "running", url: "" };
        }
    });

    const api = createApi(url);
    await api.runPipeline(10, { branch: "main" });

    assert.equal(receivedBody.resources.repositories.self.refName, "refs/heads/main");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Work Items
// ---------------------------------------------------------------------------

test("getWorkItem() obtiene un work item por ID", async () => {

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/wit/workitems/123": () => ({
            id: 123, rev: 5, fields: { "System.Title": "Fix login bug" }, url: ""
        })
    });

    const api = createApi(url);
    const res = await api.getWorkItem(123);

    assert.equal(res.body.id, 123);
    assert.equal(res.body.fields["System.Title"], "Fix login bug");

    await closeServer(server);

});

test("getWorkItem() soporta fields filter", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/wit/workitems/123": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("fields");
            return { id: 123, rev: 5, fields: { "System.Title": "Fix" }, url: "" };
        }
    });

    const api = createApi(url);
    await api.getWorkItem(123, { fields: ["System.Title", "System.State"] });

    assert.equal(receivedQuery, "System.Title,System.State");

    await closeServer(server);

});

test("queryWorkItems() ejecuta WiQL", async () => {

    let receivedBody = null;

    const { server, url } = await createMockServer({
        "POST /my-project/_apis/wit/wiql": (parsedUrl, body) => {
            receivedBody = body;
            return { workItems: [{ id: 1, url: "" }, { id: 2, url: "" }] };
        }
    });

    const api = createApi(url);
    const res = await api.queryWorkItems("SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'");

    assert.equal(res.body.workItems.length, 2);
    assert.match(receivedBody.query, /SELECT/);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// Overrides por llamada
// ---------------------------------------------------------------------------

test("project override funciona por llamada", async () => {

    let receivedPath = null;

    const { server, url } = await createMockServer({
        "GET /other-project/_apis/git/repositories": (parsedUrl) => {
            receivedPath = parsedUrl.pathname;
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listRepos({ project: "other-project" });

    assert.match(receivedPath, /other-project/);

    await closeServer(server);

});

test("apiVersion override funciona por llamada", async () => {

    let receivedVersion = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories": (parsedUrl) => {
            receivedVersion = parsedUrl.searchParams.get("api-version");
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listRepos({ apiVersion: "6.0" });

    assert.equal(receivedVersion, "6.0");

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// dryRun
// ---------------------------------------------------------------------------

test("dryRun no envía la petición", async () => {

    let serverHit = false;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories": () => {
            serverHit = true;
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listRepos({ exec: { dryRun: true } });

    assert.equal(serverHit, false);

    await closeServer(server);

});

// ---------------------------------------------------------------------------
// AzdoRequestOptions query extra
// ---------------------------------------------------------------------------

test("query extra se agrega a la petición", async () => {

    let receivedQuery = null;

    const { server, url } = await createMockServer({
        "GET /my-project/_apis/git/repositories": (parsedUrl) => {
            receivedQuery = parsedUrl.searchParams.get("customParam");
            return { count: 0, value: [] };
        }
    });

    const api = createApi(url);
    await api.listRepos({ query: { customParam: "value123" } });

    assert.equal(receivedQuery, "value123");

    await closeServer(server);

});
