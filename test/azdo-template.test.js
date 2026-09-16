const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const JSZip = require("jszip");

const { AzureDevOpsApi, HttpService, RepositoryWorkspace, isTextFile, shouldOmit } = require("../dist");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openServers = new Set();

function createRawServer(routes) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                const url = new URL(req.url, "http://localhost");
                const decodedPath = decodeURIComponent(url.pathname);
                const route = routes[`${req.method} ${decodedPath}`];

                if (!route) {
                    res.writeHead(404, { "content-type": "application/json" });
                    res.end(JSON.stringify({ message: "Not Found" }));
                    return;
                }

                try {
                    const result = await route(url, body ? JSON.parse(body) : null);

                    if (Buffer.isBuffer(result) || result instanceof ArrayBuffer) {
                        res.writeHead(200, { "content-type": "application/zip" });
                        res.end(Buffer.from(result));
                        return;
                    }

                    const status = (result && typeof result === "object" && result.statusCode) ? result.statusCode : 200;
                    const payload = (result && typeof result === "object" && result.statusCode) ? result.body : result;
                    if (Buffer.isBuffer(payload) || payload instanceof ArrayBuffer) {
                        res.writeHead(status, { "content-type": "application/zip" });
                        res.end(Buffer.from(payload));
                        return;
                    }
                    res.writeHead(status, { "content-type": "application/json" });
                    res.end(JSON.stringify(payload));
                } catch (err) {
                    res.writeHead(500, { "content-type": "application/json" });
                    res.end(JSON.stringify({ message: err.message || "Internal Server Error" }));
                }
            });
        });

        server.listen(0, () => {
            openServers.add(server);
            resolve({ server, url: `http://localhost:${server.address().port}` });
        });
    });
}

function closeServer(server) {
    openServers.delete(server);
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
}

test.after(() => {
    for (const server of openServers) {
        server.closeAllConnections();
        server.close(() => {});
    }
    openServers.clear();
});

function createApi(url) {
    const agent = new HttpService();
    return new AzureDevOpsApi().configure({
        baseUrl: url,
        pat: "test-pat-token",
        project: "my-project",
        agent
    });
}

/** Construye un ZIP con los archivos indicados. */
function buildZip(files) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
        zip.file(name, content);
    }
    return zip.generateAsync({ type: "nodebuffer" });
}

function itemsRoute(project, repository, zipBuffer) {
    return {
        [`GET /${project}/_apis/git/repositories/${repository}/items`]: () => zipBuffer
    };
}

function latestCommitRoute(project, repository, commitId) {
    return {
        [`GET /${project}/_apis/git/repositories/${repository}/commits`]: () => ({
            value: [{ commitId, comment: "", author: { name: "Dev", date: "" }, committer: { name: "Dev", date: "" } }]
        })
    };
}

function pushesRoute(project, repository) {
    let receivedBody = null;
    return {
        route: {
            [`POST /${project}/_apis/git/repositories/${repository}/pushes`]: (_, body) => {
                receivedBody = body;
                return { pushId: 1 };
            }
        },
        receivedBody: () => receivedBody
    };
}

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

test("isTextFile() y shouldOmit() distinguen texto/binario y rutas omitidas", () => {
    assert.equal(isTextFile("azure-pipelines.yml"), true);
    assert.equal(isTextFile("logo.png"), false);
    assert.equal(shouldOmit("/.vscode/settings.json", [".vscode"]), true);
    assert.equal(shouldOmit("/src/main.ts", [".vscode"]), false);
    assert.equal(shouldOmit("/docs/a/b.md", ["docs"]), true);
    assert.equal(shouldOmit("/azure-pipelines.yml", [".vscode"]), false);

    assert.equal(shouldOmit("/azure-pipelines.yml", ["**/azure-pipelines*.y*"]), true);
    assert.equal(shouldOmit("/pipelines/azure-pipelines.dev.yml", ["**/azure-pipelines*.y*"]), true);
    assert.equal(shouldOmit("/src/main.ts", ["**/azure-pipelines*.y*"]), false);
    assert.equal(shouldOmit("/infra/main.tf", ["**/azure-pipelines*.y*", "infra"]), true);
    assert.equal(shouldOmit("/azure-pipelines.yml", ["**/azure-pipelines*.y*", "infra"]), true);
    assert.equal(shouldOmit("/src/main.ts", ["**/azure-pipelines*.y*", "infra"]), false);
});

test("RepositoryWorkspace clona sin compartir Buffers", () => {
    const ws = new RepositoryWorkspace();
    ws.set({ path: "/a.txt", content: Buffer.from("hola"), binary: false });
    const copy = ws.clone();
    copy.get("/a.txt").content.write("x");
    assert.equal(ws.get("/a.txt").content.toString(), "hola");
    assert.equal(copy.get("/a.txt").content.toString(), "xola");
});

// ---------------------------------------------------------------------------
// downloadRepositoryZip()
// ---------------------------------------------------------------------------

test("downloadRepositoryZip() desempaqueta el ZIP y quita la carpeta raíz", async () => {
    const zip = await buildZip({
        "tpl/azure-pipelines.yml": "trigger:\n- main",
        "tpl/.vscode/settings.json": "{}\n",
        "tpl/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47])
    });

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", zip)
    });

    try {
        const api = createApi(url);
        const ws = await api.downloadRepositoryZip({ project: "tpl-proj", repository: "tpl-repo", branch: "main" });

        assert.deepEqual(ws.listPaths().sort(), ["/.vscode/settings.json", "/azure-pipelines.yml", "/logo.png"]);
        assert.equal(ws.get("/logo.png").binary, true);
        assert.equal(ws.get("/azure-pipelines.yml").binary, false);
        assert.equal(ws.get("/azure-pipelines.yml").content.toString(), "trigger:\n- main");
    } finally {
        await closeServer(server);
    }
});

// ---------------------------------------------------------------------------
// mergeWithTemplate()
// ---------------------------------------------------------------------------

test("mergeWithTemplate() aplica add/edit/delete y hace push", async () => {
    const templateZip = await buildZip({
        "tpl/azure-pipelines.yml": "new-pipeline",
        "tpl/.github/workflows/ci.yml": "on: push"
    });
    const destZip = await buildZip({
        "azure-pipelines.yml": "old-pipeline",
        "docs/readme.md": "keep me"
    });

    const pushes = pushesRoute("my-project", "repo-1");

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", templateZip),
        ...itemsRoute("my-project", "repo-1", destZip),
        ...latestCommitRoute("my-project", "repo-1", "base-sha"),
        ...pushes.route
    });

    try {
        const api = createApi(url);
        const result = await api.mergeWithTemplate({
            project: "my-project",
            repository: "repo-1",
            targetBranch: "main",
            template: { project: "tpl-proj", repository: "tpl-repo", branch: "main" },
            deleteExtra: true
        });

        assert.equal(result.message, "Applied 3 changes");
        assert.equal(result.changes.length, 3);

        const body = pushes.receivedBody();
        assert.ok(body, "se debe haber hecho push");
        assert.equal(body.refUpdates[0].name, "refs/heads/main");
        assert.equal(body.refUpdates[0].oldObjectId, "base-sha");

        const changes = body.commits[0].changes;
        const byType = Object.fromEntries(changes.map(c => [c.changeType, c.item.path]));
        assert.equal(byType.edit, "/azure-pipelines.yml");
        assert.equal(byType.add, "/.github/workflows/ci.yml");
        assert.equal(byType.delete, "/docs/readme.md");

        const pipeline = changes.find(c => c.item.path === "/azure-pipelines.yml");
        assert.equal(pipeline.newContent.content, "new-pipeline");
        assert.equal(pipeline.newContent.contentType, "rawtext");
    } finally {
        await closeServer(server);
    }
});

test("mergeWithTemplate() respeta filters.omit y no toca archivos omitidos", async () => {
    const templateZip = await buildZip({
        ".vscode/settings.json": "{}",
        "azure-pipelines.yml": "new"
    });
    const destZip = await buildZip({
        ".vscode/settings.json": "{}",
        "azure-pipelines.yml": "new"
    });

    const pushes = pushesRoute("my-project", "repo-1");

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", templateZip),
        ...itemsRoute("my-project", "repo-1", destZip),
        ...latestCommitRoute("my-project", "repo-1", "base-sha"),
        ...pushes.route
    });

    try {
        const api = createApi(url);
        const result = await api.mergeWithTemplate({
            project: "my-project",
            repository: "repo-1",
            targetBranch: "main",
            template: { project: "tpl-proj", repository: "tpl-repo", branch: "main" },
            filters: { omit: [".vscode"] }
        });

        assert.equal(result.message, "No changes");
        assert.equal(pushes.receivedBody(), null, "no debe hacerse push si no hay cambios");
    } finally {
        await closeServer(server);
    }
});

test("mergeWithTemplate() con overwrite=false no pisa archivos existentes", async () => {
    const templateZip = await buildZip({
        "azure-pipelines.yml": "new",
        "new-file.txt": "hola"
    });
    const destZip = await buildZip({
        "azure-pipelines.yml": "old"
    });

    const pushes = pushesRoute("my-project", "repo-1");

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", templateZip),
        ...itemsRoute("my-project", "repo-1", destZip),
        ...latestCommitRoute("my-project", "repo-1", "base-sha"),
        ...pushes.route
    });

    try {
        const api = createApi(url);
        const result = await api.mergeWithTemplate({
            project: "my-project",
            repository: "repo-1",
            targetBranch: "main",
            template: { project: "tpl-proj", repository: "tpl-repo", branch: "main" },
            overwrite: false
        });

        assert.equal(result.message, "Applied 1 changes");
        const changes = result.changes;
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, "add");
        assert.equal(changes[0].item.path, "/new-file.txt");
    } finally {
        await closeServer(server);
    }
});

test("mergeWithTemplate() aplica transformaciones antes de comparar", async () => {
    const templateZip = await buildZip({
        "azure-pipelines.yml": "placeholder"
    });
    const destZip = await buildZip({});

    const pushes = pushesRoute("my-project", "repo-1");

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", templateZip),
        ...itemsRoute("my-project", "repo-1", destZip),
        ...latestCommitRoute("my-project", "repo-1", "base-sha"),
        ...pushes.route
    });

    try {
        const api = createApi(url);
        const result = await api.mergeWithTemplate({
            project: "my-project",
            repository: "repo-1",
            targetBranch: "main",
            template: { project: "tpl-proj", repository: "tpl-repo", branch: "main" },
            transform: (file) => {
                if (file.path === "/azure-pipelines.yml") {
                    file.content = Buffer.from("name: repo-1");
                }
            }
        });

        assert.equal(result.changes[0].newContent.content, "name: repo-1");
        assert.equal(pushes.receivedBody().commits[0].changes[0].newContent.content, "name: repo-1");
    } finally {
        await closeServer(server);
    }
});

test("mergeWithTemplate() sobre un repo vacío (branch sin commits) usa oldObjectId en ceros", async () => {
    const templateZip = await buildZip({
        "azure-pipelines.yml": "new"
    });

    const pushes = pushesRoute("my-project", "repo-1");

    const { server, url } = await createRawServer({
        ...itemsRoute("tpl-proj", "tpl-repo", templateZip),
        [`GET /my-project/_apis/git/repositories/repo-1/commits`]: () => ({ value: [] }),
        ...pushes.route
    });

    try {
        const api = createApi(url);
        const result = await api.mergeWithTemplate({
            project: "my-project",
            repository: "repo-1",
            targetBranch: "main",
            template: { project: "tpl-proj", repository: "tpl-repo", branch: "main" }
        });

        assert.equal(result.message, "Applied 1 changes");
        const body = pushes.receivedBody();
        assert.equal(body.refUpdates[0].oldObjectId, "0000000000000000000000000000000000000000");
        assert.equal(body.commits[0].changes[0].newContent.content, "new");
    } finally {
        await closeServer(server);
    }
});