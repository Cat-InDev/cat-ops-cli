import type { HttpRequest, HttpResponse, RequestInterceptor, ResponseInterceptor } from "./http-types";
import type { ExecOptions } from "../core/types";
import { HttpService } from "./http";
import { toAzdoApiError } from "./azdo-errors";

// Agente HTTP usable por AzureDevOpsApi. Además de `request`, puede exponer
// los métodos de interceptores de HttpService — si no los expone (agente
// custom minimalista), no se podrán registrar interceptores sobre él.
interface HttpAgent {
    request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
    addRequestInterceptor?(interceptor: RequestInterceptor): unknown;
    removeRequestInterceptor?(interceptor: RequestInterceptor): unknown;
    clearRequestInterceptors?(): unknown;
    addResponseInterceptor?(interceptor: ResponseInterceptor): unknown;
    removeResponseInterceptor?(interceptor: ResponseInterceptor): unknown;
    clearResponseInterceptors?(): unknown;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AzureDevOpsApiConfig {
    /** URL base de la instancia (e.g. https://dev.azure.com/myorg o https://myorg.visualstudio.com). */
    baseUrl: string;
    /** Personal Access Token para autenticación. */
    pat: string;
    /** Nombre del proyecto (opcional — se puede pasar por llamada). */
    project?: string;
    /** Versión de la API (default: "7.1"). */
    apiVersion?: string;
    /** Agent HTTP a usar para las peticiones. Si no se pasa, se crea uno interno. */
    agent?: HttpAgent;
    /**
     * Interceptores de request que se registran en el agente HTTP
     * (interno o inyectado, siempre que lo soporte). Útiles para tracing,
     * headers extra, métricas, etc. Se ejecutan ANTES de enviar cada petición.
     */
    requestInterceptors?: RequestInterceptor[];
    /**
     * Interceptores de response que se registran en el agente HTTP.
     * Se ejecutan DESPUÉS de recibir cada respuesta (incluye errores HTTP).
     */
    responseInterceptors?: ResponseInterceptor[];
}

// ---------------------------------------------------------------------------
// Request options
// ---------------------------------------------------------------------------

export interface AzdoRequestOptions {
    /** Project override para esta llamada. */
    project?: string;
    /** API version override para esta llamada. */
    apiVersion?: string;
    /** Parámetros query extra. */
    query?: Record<string, string | number | boolean | undefined>;
    /** Opciones de exec (dryRun, retry, timeout). */
    exec?: ExecOptions;
    /** Si es true, omite el project de la URL (para endpoints de organización). */
    organizationLevel?: boolean;
}

// ---------------------------------------------------------------------------
// API response types (parciales — solo los campos más usados)
// ---------------------------------------------------------------------------

export interface AzdoProject {
    id: string;
    name: string;
    url: string;
    state: string;
    revision: string;
    visibility: string;
    lastUpdateTime: string;
}

export interface AzdoGitRepository {
    id: string;
    name: string;
    url: string;
    defaultBranch: string | null;
    project: AzdoProject;
    size: number;
    remoteUrl: string;
    sshUrl: string;
    webUrl: string;
    isDisabled: boolean;
}

export interface AzdoGitBranch {
    name: string;
    aheadCount: number;
    behindCount: number;
    isBaseVersion: boolean;
    commit: AzdoGitCommitRef;
}

export interface AzdoGitCommitRef {
    commitId: string;
    author: AzdoGitAuthor;
    committer: AzdoGitAuthor;
    comment: string;
    url: string;
}

export interface AzdoGitAuthor {
    name: string;
    email: string;
    date: string;
}

export interface AzdoGitPullRequest {
    pullRequestId: number;
    title: string;
    description: string;
    status: string;
    createdBy: AzdoGitAuthor;
    creationDate: string;
    sourceRefName: string;
    targetRefName: string;
    mergeStatus: string;
    mergeId: string;
    url: string;
}

export interface AzdoBuildDefinition {
    id: number;
    name: string;
    path: string;
    queueStatus: string;
    revision: number;
    type: string;
    url: string;
}

export interface AzdoBuild {
    id: number;
    buildNumber: string;
    status: string;
    result: string | null;
    definition: { id: number; name: string };
    requestedBy: AzdoGitAuthor;
    startTime: string;
    finishTime: string | null;
    url: string;
}

export interface AzdoPipeline {
    id: number;
    name: string;
    folder: string;
    revision: number;
    url: string;
}

export interface AzdoWorkItem {
    id: number;
    rev: number;
    fields: Record<string, unknown>;
    url: string;
}

export interface AzdoListResponse<T> {
    count: number;
    value: T[];
}

// ---------------------------------------------------------------------------
// New response types
// ---------------------------------------------------------------------------

export interface AzdoWebHookSubscription {
    id: number;
    publisherId: string;
    publisherInputs: Record<string, string>;
    consumerInputs: Record<string, string>;
    eventType: string;
    resourceVersion: string;
    scope: number;
}

export interface AzdoEnvironment {
    id: number;
    name: string;
    description: string;
    project: AzdoProject;
}

export interface AzdoIdentityGroup {
    displayName: string;
    samAccountName: string;
    localId: string;
    subjectDescriptor: string;
    imageUrl?: string;
    uniqueName?: string;
    metaType?: string;
    sid?: string;
    mailAddress?: string;
}

export interface AzdoPolicyConfiguration {
    id: number;
    url: string;
    type: { id: string; displayName: string };
    isEnabled: boolean;
    isBlocking: boolean;
    settings: Record<string, unknown>;
}

export interface AzdoAgentPool {
    id: number;
    name: string;
    url: string;
    size: number;
    isHosted: boolean;
}

export interface AzdoAgentQueue {
    id: number;
    name: string;
    pool: AzdoAgentPool;
    url: string;
}

export interface AzdoVariableGroup {
    id: number;
    name: string;
    variables: Record<string, { value?: string; isSecret?: boolean }>;
    type: string;
}

export interface AzdoBuildFolder {
    path: string;
    project: AzdoProject;
}

export interface AzdoServiceEndpoint {
    id: string;
    name: string;
    type: string;
    url: string;
    projectReferences: Array<{ id: string; name: string }>;
}

export interface AzdoGitRef {
    name: string;
    objectId: string;
    peeledObjectId?: string;
    creator?: AzdoGitAuthor;
}

export interface AzdoGitTag {
    name: string;
    ref: string;
    objectId: string;
    creator?: AzdoGitAuthor;
    peeledObjectId?: string;
}

export interface AzdoGitItem {
    path: string;
    content?: string;
    contentType?: string;
}

// ---------------------------------------------------------------------------
// AzureDevOpsApi
// ---------------------------------------------------------------------------

export class AzureDevOpsApi {

    private baseUrl = "";
    private pat = "";
    private project = "";
    private apiVersion = "7.1";
    private agent: HttpAgent | null = null;
    private ownAgent = false;
    /** Interceptores en cola mientras el agente (perezoso) aún no existe. */
    private pendingRequestInterceptors: RequestInterceptor[] = [];
    private pendingResponseInterceptors: ResponseInterceptor[] = [];

    configure(config: AzureDevOpsApiConfig): this {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.pat = config.pat;
        if (config.project !== undefined) this.project = config.project;
        if (config.apiVersion !== undefined) this.apiVersion = config.apiVersion;
        if (config.agent) {
            this.agent = config.agent;
            this.ownAgent = false;
        }
        // Los interceptores se aplican al agente activo, o quedan en cola si
        // el agente interno todavía no se ha creado.
        for (const i of config.requestInterceptors ?? []) this.addRequestInterceptor(i);
        for (const i of config.responseInterceptors ?? []) this.addResponseInterceptor(i);
        return this;
    }

    // ---- interceptores del agente HTTP ----

    /**
     * Registra un interceptor de request en el agente HTTP. Si el agente
     * interno aún no existe, queda en cola y se aplica al crearlo.
     */
    addRequestInterceptor(interceptor: RequestInterceptor): this {
        if (this.agent) {
            this.requireAgentMethod("addRequestInterceptor");
            this.agent.addRequestInterceptor!(interceptor);
        } else {
            this.pendingRequestInterceptors.push(interceptor);
        }
        return this;
    }

    /** Elimina un interceptor de request (de la cola o del agente activo). */
    removeRequestInterceptor(interceptor: RequestInterceptor): this {
        const idx = this.pendingRequestInterceptors.indexOf(interceptor);
        if (idx !== -1) {
            this.pendingRequestInterceptors.splice(idx, 1);
            return this;
        }
        if (this.agent) {
            this.requireAgentMethod("removeRequestInterceptor");
            this.agent.removeRequestInterceptor!(interceptor);
        }
        return this;
    }

    /** Elimina todos los interceptores de request (cola + agente activo). */
    clearRequestInterceptors(): this {
        this.pendingRequestInterceptors = [];
        if (this.agent) {
            this.requireAgentMethod("clearRequestInterceptors");
            this.agent.clearRequestInterceptors!();
        }
        return this;
    }

    /**
     * Registra un interceptor de response en el agente HTTP. Si el agente
     * interno aún no existe, queda en cola y se aplica al crearlo.
     */
    addResponseInterceptor(interceptor: ResponseInterceptor): this {
        if (this.agent) {
            this.requireAgentMethod("addResponseInterceptor");
            this.agent.addResponseInterceptor!(interceptor);
        } else {
            this.pendingResponseInterceptors.push(interceptor);
        }
        return this;
    }

    /** Elimina un interceptor de response (de la cola o del agente activo). */
    removeResponseInterceptor(interceptor: ResponseInterceptor): this {
        const idx = this.pendingResponseInterceptors.indexOf(interceptor);
        if (idx !== -1) {
            this.pendingResponseInterceptors.splice(idx, 1);
            return this;
        }
        if (this.agent) {
            this.requireAgentMethod("removeResponseInterceptor");
            this.agent.removeResponseInterceptor!(interceptor);
        }
        return this;
    }

    /** Elimina todos los interceptores de response (cola + agente activo). */
    clearResponseInterceptors(): this {
        this.pendingResponseInterceptors = [];
        if (this.agent) {
            this.requireAgentMethod("clearResponseInterceptors");
            this.agent.clearResponseInterceptors!();
        }
        return this;
    }

    /** Vuelca la cola de interceptores pendientes sobre el agente activo. */
    private flushPendingInterceptors(): void {
        if (!this.agent) return;
        while (this.pendingRequestInterceptors.length) {
            const i = this.pendingRequestInterceptors.shift()!;
            this.requireAgentMethod("addRequestInterceptor");
            this.agent.addRequestInterceptor!(i);
        }
        while (this.pendingResponseInterceptors.length) {
            const i = this.pendingResponseInterceptors.shift()!;
            this.requireAgentMethod("addResponseInterceptor");
            this.agent.addResponseInterceptor!(i);
        }
    }

    /** Falla con un error descriptivo si el agente no soporta interceptores. */
    private requireAgentMethod(method: keyof HttpAgent & string): void {
        const agent = this.agent as Record<string, unknown> | null;
        if (!agent || typeof agent[method] !== "function") {
            throw new Error(
                `El agente HTTP configurado no soporta interceptores (falta "${method}"). ` +
                "Provee una instancia de HttpService o deja que AzureDevOpsApi cree su agente interno."
            );
        }
    }

    private getAgent(): HttpAgent {
        if (!this.agent) {
            // Agente interno: se crea perezosamente en la primera petición,
            // tal como promete la documentación de AzureDevOpsApiConfig.agent.
            this.agent = new HttpService();
            this.ownAgent = true;
        }
        this.flushPendingInterceptors();
        return this.agent;
    }

    private assertConfigured(): void {
        if (!this.baseUrl || !this.pat) {
            throw new Error(
                "AzureDevOpsApi not configured. Call .configure({ baseUrl, pat }) first."
            );
        }
    }

    private authHeaders(): Record<string, string> {
        const encoded = Buffer.from(`:${this.pat}`).toString("base64");
        return {
            "Authorization": `Basic ${encoded}`,
            "Accept": "application/json"
        };
    }

    private projectPath(opts?: AzdoRequestOptions): string {
        const p = opts?.project ?? this.project;
        return p ? `/${p}` : "";
    }

    private version(opts?: AzdoRequestOptions): string {
        return opts?.apiVersion ?? this.apiVersion;
    }

    // ---- internal request helper ----

    async request<T = unknown>(
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        apiPath: string,
        opts?: AzdoRequestOptions & { body?: unknown }
    ): Promise<HttpResponse<T>> {
        this.assertConfigured();
        const prefix = opts?.organizationLevel ? "" : this.projectPath(opts);
        const url = `${this.baseUrl}${prefix}/_apis${apiPath}`;
        const agent = this.getAgent();
        try {
            return await agent.request<T>({
                url,
                method,
                headers: this.authHeaders(),
                body: opts?.body,
                query: {
                    "api-version": this.version(opts),
                    ...opts?.query
                },
                exec: opts?.exec
            });
        } catch (err) {
            // Enriquece los errores HTTP con el detalle legible de Azure DevOps
            // (message/typeKey/TF-code del body + sugerencias). El error envuelto
            // conserva `status`, así que los checks de 404 siguen funcionando.
            throw toAzdoApiError(err);
        }
    }

    // =========================================================================
    // Projects
    // =========================================================================

    /** Lista todos los proyectos de la organización. */
    listProjects(opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoListResponse<AzdoProject>>> {
        return this.request("GET", "/projects", { ...opts, organizationLevel: true });
    }

    /** Obtiene un proyecto por nombre o GUID. */
    getProject(projectNameOrId: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoProject>> {
        return this.request("GET", `/projects/${encodeURIComponent(projectNameOrId)}`, { ...opts, organizationLevel: true });
    }

    // =========================================================================
    // Git Repositories
    // =========================================================================

    /** Lista todos los repos del proyecto. */
    listRepos(opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoListResponse<AzdoGitRepository>>> {
        return this.request("GET", "/git/repositories", opts);
    }

    /** Obtiene un repo por nombre o GUID. */
    getRepo(repoNameOrId: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoGitRepository>> {
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}`, opts);
    }

    // =========================================================================
    // Branches
    // =========================================================================

    /** Lista todas las branches de un repo. */
    listBranches(repoNameOrId: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoListResponse<AzdoGitBranch>>> {
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/refs`, {
            ...opts,
            query: { filter: "heads/", ...opts?.query }
        });
    }

    /** Verifica si una branch existe. Devuelve `true`/`false`. */
    async branchExists(
        repoNameOrId: string,
        branchName: string,
        opts?: AzdoRequestOptions
    ): Promise<boolean> {
        try {
            const refName = branchName.startsWith("refs/heads/") ? branchName : `refs/heads/${branchName}`;
            await this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/refs/${refName}`, opts);
            return true;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return false;
            }
            throw err;
        }
    }

    /** Obtiene una branch específica con su último commit. */
    getBranch(repoNameOrId: string, branchName: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoGitBranch>> {
        const refName = branchName.startsWith("refs/heads/") ? branchName : `refs/heads/${branchName}`;
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/refs/${refName}`, opts);
    }

    // =========================================================================
    // Commits
    // =========================================================================

    /** Lista commits de una branch. */
    listCommits(
        repoNameOrId: string,
        opts?: AzdoRequestOptions & { branch?: string; top?: number; skip?: number }
    ): Promise<HttpResponse<AzdoListResponse<AzdoGitCommitRef>>> {
        const branch = opts?.branch ?? "main";
        const body: Record<string, unknown> = {
            searchCriteria: {
                itemVersion: { version: branch, versionType: "branch" },
                ...(opts?.top !== undefined ? { $top: opts.top } : {}),
                ...(opts?.skip !== undefined ? { $skip: opts.skip } : {})
            }
        };
        return this.request("POST", `/git/repositories/${encodeURIComponent(repoNameOrId)}/commits`, {
            ...opts,
            body
        });
    }

    /** Obtiene un commit específico. */
    getCommit(repoNameOrId: string, commitId: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoGitCommitRef>> {
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/commits/${commitId}`, opts);
    }

    // =========================================================================
    // Pull Requests
    // =========================================================================

    /** Lista pull requests de un repo. */
    listPullRequests(
        repoNameOrId: string,
        opts?: AzdoRequestOptions & { status?: "active" | "abandoned" | "completed" | "all" }
    ): Promise<HttpResponse<AzdoListResponse<AzdoGitPullRequest>>> {
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/pullrequests`, {
            ...opts,
            query: { status: opts?.status ?? "active", ...opts?.query }
        });
    }

    /** Obtiene un pull request por ID. */
    getPullRequest(repoNameOrId: string, pullRequestId: number, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoGitPullRequest>> {
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/pullrequests/${pullRequestId}`, opts);
    }

    /** Crea un pull request. */
    createPullRequest(
        repoNameOrId: string,
        pr: { sourceRefName: string; targetRefName: string; title: string; description?: string },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoGitPullRequest>> {
        return this.request("POST", `/git/repositories/${encodeURIComponent(repoNameOrId)}/pullrequests`, {
            ...opts,
            body: pr
        });
    }

    // =========================================================================
    // Build Definitions
    // =========================================================================

    /** Lista definiciones de build. */
    listBuildDefinitions(opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoListResponse<AzdoBuildDefinition>>> {
        return this.request("GET", "/build/definitions", opts);
    }

    /** Obtiene una definición de build por ID. */
    getBuildDefinition(definitionId: number, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoBuildDefinition>> {
        return this.request("GET", `/build/definitions/${definitionId}`, opts);
    }

    // =========================================================================
    // Builds
    // =========================================================================

    /** Lista builds recientes. */
    listBuilds(
        opts?: AzdoRequestOptions & { definitionId?: number; top?: number; status?: string }
    ): Promise<HttpResponse<AzdoListResponse<AzdoBuild>>> {
        return this.request("GET", "/build/builds", {
            ...opts,
            query: {
                ...(opts?.definitionId !== undefined ? { definitionId: opts.definitionId } : {}),
                ...(opts?.top !== undefined ? { $top: opts.top } : {}),
                ...(opts?.status !== undefined ? { statusFilter: opts.status } : {}),
                ...opts?.query
            }
        });
    }

    /** Obtiene un build por ID. */
    getBuild(buildId: number, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoBuild>> {
        return this.request("GET", `/build/builds/${buildId}`, opts);
    }

    /** Ejecuta (queue) un build. */
    queueBuild(
        definitionId: number,
        opts?: AzdoRequestOptions & { branch?: string; parameters?: Record<string, unknown> }
    ): Promise<HttpResponse<AzdoBuild>> {
        const body: Record<string, unknown> = { definition: { id: definitionId } };
        if (opts?.branch) {
            body.sourceBranch = opts.branch.startsWith("refs/") ? opts.branch : `refs/heads/${opts.branch}`;
        }
        if (opts?.parameters) {
            body.parameters = opts.parameters;
        }
        return this.request("POST", "/build/builds", { ...opts, body });
    }

    // =========================================================================
    // Pipelines
    // =========================================================================

    /** Lista pipelines del proyecto. */
    listPipelines(opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoListResponse<AzdoPipeline>>> {
        return this.request("GET", "/pipelines", opts);
    }

    /** Obtiene un pipeline por ID. */
    getPipeline(pipelineId: number, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoPipeline>> {
        return this.request("GET", `/pipelines/${pipelineId}`, opts);
    }

    /** Ejecuta (run) un pipeline. */
    runPipeline(
        pipelineId: number,
        opts?: AzdoRequestOptions & { branch?: string; variables?: Record<string, { value: unknown }> }
    ): Promise<HttpResponse<Record<string, unknown>>> {
        const body: Record<string, unknown> = {};
        if (opts?.branch) {
            body.resources = {
                repositories: {
                    self: { refName: opts.branch.startsWith("refs/") ? opts.branch : `refs/heads/${opts.branch}` }
                }
            };
        }
        if (opts?.variables) {
            body.variables = opts.variables;
        }
        return this.request("POST", `/pipelines/${pipelineId}/runs`, { ...opts, body });
    }

    // =========================================================================
    // Work Items
    // =========================================================================

    /** Obtiene un work item por ID. */
    getWorkItem(
        workItemId: number,
        opts?: AzdoRequestOptions & { fields?: string[] }
    ): Promise<HttpResponse<AzdoWorkItem>> {
        const query: Record<string, string | number | boolean | undefined> = {};
        if (opts?.fields?.length) {
            query.fields = opts.fields.join(",");
        }
        return this.request("GET", `/wit/workitems/${workItemId}`, { ...opts, query });
    }

    /** Consulta work items por WiQL. */
    queryWorkItems(
        wiql: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<{ workItems: Array<{ id: number; url: string }> }>> {
        return this.request("POST", "/wit/wiql", {
            ...opts,
            body: { query: wiql }
        });
    }

    // =========================================================================
    // Git Repositories — existence checks + creation
    // =========================================================================

    /** Verifica si un repositorio existe. Devuelve el repo o `undefined`. */
    async repoExists(
        project: string | undefined,
        repoName: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoGitRepository | undefined> {
        try {
            const res = await this.request<AzdoGitRepository>(
                "GET",
                `/git/repositories/${encodeURIComponent(repoName)}`,
                { ...opts, project: project ?? opts?.project }
            );
            return res.body;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
    }

    /** Crea un repositorio en un proyecto. */
    createRepository(
        projectName: string,
        projectId: string,
        repoName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoGitRepository>> {
        return this.request("POST", "/git/repositories", {
            ...opts,
            body: {
                name: repoName,
                project: { id: projectId, name: projectName }
            }
        });
    }

    // =========================================================================
    // Branches — creation
    // =========================================================================

    /** Crea una branch nueva a partir de un commit ID. */
    createBranch(
        project: string | undefined,
        repoName: string,
        branchName: string,
        fromObjectId: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoGitRef[]>> {
        return this.request("POST", `/git/repositories/${encodeURIComponent(repoName)}/refs`, {
            ...opts,
            project: project ?? opts?.project,
            body: [
                {
                    name: `refs/heads/${branchName}`,
                    newObjectId: fromObjectId,
                    oldObjectId: "0000000000000000000000000000000000000000"
                }
            ]
        });
    }

    // =========================================================================
    // Commits — latest
    // =========================================================================

    /** Obtiene el último commit de un repo. Devuelve `null` si no hay commits. */
    async getLatestCommit(
        project: string | undefined,
        repoNameOrId: string,
        opts?: AzdoRequestOptions
    ): Promise<{ commitId: string; message: string; date: string; author: { name: string; date: string } } | null> {
        const res = await this.request<AzdoListResponse<AzdoGitCommitRef>>(
            "GET",
            `/git/repositories/${encodeURIComponent(repoNameOrId)}/commits`,
            { ...opts, project: project ?? opts?.project, query: { $top: 1, ...opts?.query } }
        );
        if (!res.body.value.length) return null;
        const commit = res.body.value[0];
        return {
            commitId: commit.commitId,
            message: commit.comment,
            date: commit.author.date,
            author: { name: commit.author.name, date: commit.author.date }
        };
    }

    // =========================================================================
    // Files — existence check
    // =========================================================================

    /** Verifica si un archivo existe en una branch. Devuelve el item o `undefined`. */
    async fileExists(
        project: string | undefined,
        repoName: string,
        branchName: string,
        filePath: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoGitItem | undefined> {
        try {
            const res = await this.request<AzdoGitItem>(
                "GET",
                `/git/repositories/${encodeURIComponent(repoName)}/items`,
                {
                    ...opts,
                    project: project ?? opts?.project,
                    query: { path: filePath, "versionDescriptor.version": branchName, ...opts?.query }
                }
            );
            return res.body;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
    }

    // =========================================================================
    // Files — create / update
    // =========================================================================

    /** Crea o actualiza un archivo en una branch (push de un solo archivo). */
    async createOrUpdateFile(
        options: {
            project: string | undefined;
            repo: string;
            branch: string;
            filePath: string;
            fileContent: string | Buffer;
            comment?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        let ref: string | undefined;
        try {
            const refName = options.branch.startsWith("refs/heads/") ? options.branch : `refs/heads/${options.branch}`;
            const branchRes = await this.request<AzdoListResponse<AzdoGitRef>>(
                "GET",
                `/git/repositories/${encodeURIComponent(options.repo)}/refs/${refName}`,
                { ...opts, project: options.project }
            );
            ref = branchRes.body?.value?.[0]?.objectId;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                ref = undefined;
            } else {
                throw err;
            }
        }
        const exists = await this.fileExists(options.project, options.repo, options.branch, options.filePath, opts);
        const isBuffer = Buffer.isBuffer(options.fileContent);
        return this.request(
            "POST",
            `/git/repositories/${encodeURIComponent(options.repo)}/pushes`,
            {
                ...opts,
                project: options.project,
                body: {
                    refUpdates: [
                        {
                            name: `refs/heads/${options.branch}`,
                            oldObjectId: !ref ? "0000000000000000000000000000000000000000" : ref
                        }
                    ],
                    commits: [
                        {
                            comment: options.comment ?? "Automatic update",
                            changes: [
                                {
                                    changeType: exists ? "edit" : "add",
                                    item: { path: options.filePath },
                                    newContent: {
                                        content: isBuffer ? options.fileContent.toString("base64") : options.fileContent,
                                        contentType: isBuffer ? "base64Encoded" : "rawtext"
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        );
    }

    /**
     * Crea un archivo en un repo. Si el contenido es una de las plantillas
     * conocidas (ej. `$README:TEMPLATE`), genera un README.md con el contenido
     * por defecto.
     */
    async createFileInRepo(
        project: string | undefined,
        repo: string,
        branch: string,
        fileName: string,
        filePath: string,
        fileContent: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const contentTemplates: Record<string, { name: string; type: string }> = {
            "$README:TEMPLATE": { name: "README.md", type: "readme" }
        };

        if (contentTemplates[fileContent]) {
            return this.createOrUpdateFile({
                project,
                repo,
                branch,
                filePath: `${filePath}/${contentTemplates[fileContent].name}`,
                fileContent: `# ${repo}\n\nProject repository.`
            }, opts);
        }

        return this.createOrUpdateFile({
            project,
            repo,
            branch,
            filePath: `${filePath}/${fileName}`.replace(/\/+/g, "/"),
            fileContent,
            comment: "Automated by prepare ci/cd process"
        }, opts);
    }

    /** Crea un repositorio y lo inicializa con un README. */
    async createAndInitRepository(
        projectName: string,
        projectId: string,
        repository: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoGitRepository> {
        const existing = await this.repoExists(projectId, repository, opts);
        let repoData = existing;

        if (!existing) {
            const res = await this.createRepository(projectName, projectId, repository, opts);
            repoData = res.body;
        }

        const repoId = repoData!.id;
        await this.createFileInRepo(projectId, repoId, "main", "README.md", "/", "$README:TEMPLATE", opts);

        return repoData!;
    }

    // =========================================================================
    // Pushes — bulk push (multiple changes)
    // =========================================================================

    /** Hace un push con múltiples cambios (add/edit/delete) en un solo commit. */
    async pushChanges(
        options: {
            project: string | undefined;
            repository: string;
            branch: string;
            changes: Array<{
                changeType: string;
                item: { path: string };
                newContent?: { content: string; contentType: string };
            }>;
            comment: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        let ref: string | undefined;
        try {
            const refName = options.branch.startsWith("refs/heads/") ? options.branch : `refs/heads/${options.branch}`;
            const branchRes = await this.request<AzdoListResponse<AzdoGitRef>>(
                "GET",
                `/git/repositories/${encodeURIComponent(options.repository)}/refs/${refName}`,
                {
                    ...opts,
                    project: options.project
                }
            );
            ref = branchRes.body?.value?.[0]?.objectId;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                ref = undefined;
            } else {
                throw err;
            }
        }

        return this.request(
            "POST",
            `/git/repositories/${encodeURIComponent(options.repository)}/pushes`,
            {
                ...opts,
                project: options.project,
                body: {
                    refUpdates: [
                        {
                            name: `refs/heads/${options.branch}`,
                            oldObjectId: ref
                        }
                    ],
                    commits: [
                        {
                            comment: options.comment,
                            changes: options.changes
                        }
                    ]
                }
            }
        );
    }

    // =========================================================================
    // Templates — download + merge
    // =========================================================================

    /** Descarga un repositorio completo como buffer ZIP. */
    async downloadRepositoryZip(
        options: {
            project: string;
            repository: string;
            branch: string;
            scopePath?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const path = options.scopePath ?? "/";
        return this.request("GET", `/git/repositories/${encodeURIComponent(options.repository)}/items`, {
            ...opts,
            project: options.project,
            query: {
                path,
                "versionDescriptor[versionOptions]": 0,
                "versionDescriptor[versionType]": 0,
                "versionDescriptor[version]": options.branch,
                resolveLfs: true,
                "$format": "zip",
                download: true,
                ...opts?.query
            }
        });
    }

    // =========================================================================
    // Webhooks
    // =========================================================================

    /** Verifica si existe un webhook de push para un repo/branch/URL dados. */
    async webhookExists(
        projectId: string,
        repositoryId: string,
        branchName: string,
        webhookUrl: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoWebHookSubscription | undefined> {
        try {
            const res = await this.request<{ results: AzdoWebHookSubscription[] }>(
                "POST",
                "/hooks/subscriptionsQuery",
                {
                    ...opts,
                    organizationLevel: true,
                    apiVersion: "7.2-preview.1",
                    body: {
                        publisherId: "tfs",
                        publisherInputFilters: [
                            {
                                conditions: [
                                    { inputId: "projectId", operator: 0, inputValue: projectId }
                                ]
                            }
                        ]
                    }
                }
            );
            return res.body.results.find(
                e => e.publisherInputs.projectId === projectId
                    && e.publisherInputs.repository === repositoryId
                    && e.publisherInputs.branch === branchName
                    && e.consumerInputs.url === webhookUrl
            );
        } catch {
            return undefined;
        }
    }

    /** Crea un webhook de push para un repositorio. */
    createWebhook(
        projectId: string,
        repoId: string,
        sourceBranch: string,
        webhookUrl: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoWebHookSubscription>> {
        return this.request("POST", "/hooks/subscriptions", {
            ...opts,
            organizationLevel: true,
            apiVersion: "7.2-preview.1",
            body: {
                consumerActionId: "httpRequest",
                consumerId: "webHooks",
                consumerInputs: { url: webhookUrl },
                eventType: "git.push",
                publisherId: "tfs",
                publisherInputs: {
                    repository: repoId,
                    branch: sourceBranch,
                    pushedBy: "",
                    projectId
                },
                resourceVersion: "1.0",
                scope: 1
            }
        });
    }

    // =========================================================================
    // Environments
    // =========================================================================

    /** Crea un environment en un proyecto. */
    createEnvironment(
        project: string | undefined,
        name: string,
        description = "",
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoEnvironment>> {
        return this.request("POST", "/distributedtask/environments", {
            ...opts,
            project: project ?? opts?.project,
            apiVersion: "5.2-preview.1",
            body: { name, description }
        });
    }

    /** Busca un grupo de identidades por nombre (SAM account name). */
    async findIdentityGroup(
        groupName: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoIdentityGroup> {
        const res = await this.request<{ results: Array<{ identities: AzdoIdentityGroup[] }> }>(
            "POST",
            "/IdentityPicker/Identities",
            {
                ...opts,
                organizationLevel: true,
                apiVersion: "5.0-preview.1",
                body: {
                    query: groupName,
                    identityTypes: ["group"],
                    operationScopes: ["ims", "source"],
                    options: { MinResults: 1, MaxResults: 20 },
                    properties: ["DisplayName", "SamAccountName", "SubjectDescriptor"]
                }
            }
        );
        const group = res.body.results[0].identities.find(g => g.samAccountName === groupName);
        if (!group) {
            throw new Error(`Group '${groupName}' not found.`);
        }
        return group;
    }

    /** Crea una approval check para un environment. */
    createEnvironmentApproval(
        project: string | undefined,
        environmentId: number,
        environmentName: string,
        approver: AzdoIdentityGroup,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        return this.request("POST", "/pipelines/checks/configurations", {
            ...opts,
            project: project ?? opts?.project,
            apiVersion: "5.2-preview.1",
            body: {
                type: { id: "8C6F20A7-A545-4486-9777-F762FAFE0D4D", name: "Approval" },
                settings: {
                    approvers: [
                        {
                            displayName: approver.displayName,
                            id: approver.localId,
                            descriptor: approver.subjectDescriptor,
                            imageUrl: approver.imageUrl ?? "",
                            uniqueName: approver.uniqueName ?? ""
                        }
                    ],
                    executionOrder: 1,
                    instructions: "",
                    blockedApprovers: [],
                    minRequiredApprovers: 0,
                    requesterCannotBeApprover: false,
                    definitionRef: {
                        id: "26014962-64a0-49f4-885b-4b874119a5cc"
                    }
                },
                resource: { type: "environment", id: environmentId, name: environmentName },
                timeout: 43200
            }
        });
    }

    /**
     * Crea un environment con approvals.
     * Si `approverGroup` es `"none"`, no agrega approvals.
     */
    async createEnvironmentWithApprovals(
        options: {
            project: string | undefined;
            environmentName: string;
            description?: string;
            approverGroup: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<AzdoEnvironment> {
        const envRes = await this.createEnvironment(
            options.project,
            options.environmentName,
            options.description ?? "",
            opts
        );
        const environment = envRes.body;

        if (options.approverGroup === "none") return environment;

        const group = await this.findIdentityGroup(options.approverGroup, opts);
        await this.createEnvironmentApproval(
            options.project,
            environment.id,
            options.environmentName,
            group,
            opts
        );

        return environment;
    }

    // =========================================================================
    // Permissions — committer regex + deny
    // =========================================================================

    /** Crea una política de validación de email del committer. */
    applyCommitterRegexPermissions(
        projectId: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<number>> {
        return this.request("POST", "/policy/Configurations", {
            ...opts,
            apiVersion: "5.0-preview.1",
            body: {
                type: { id: "77ed4bd3-b063-4689-934a-175e4d0a78d7" },
                revision: 1,
                isDeleted: false,
                isBlocking: true,
                isEnabled: true,
                settings: {
                    authorEmailPatterns: null,
                    scope: [{ repositoryId: null }]
                }
            }
        });
    }

    /** Actualiza una política de validación de email del committer. */
    updateCommitterRegexPermissions(
        projectId: string,
        policyId: number,
        allowedEmailPatterns: string[],
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<number>> {
        return this.request("POST", `/policy/Configurations/${policyId}`, {
            ...opts,
            apiVersion: "5.0-preview.1",
            body: {
                isEnabled: true,
                isBlocking: true,
                isDeleted: false,
                settings: {
                    authorEmailPatterns: allowedEmailPatterns,
                    scope: [{ repositoryId: null }]
                },
                revision: 3,
                id: policyId,
                type: {
                    id: "77ed4bd3-b063-4689-934a-175e4d0a78d7",
                    displayName: "Commit author email validation"
                }
            }
        });
    }

    /** Obtiene los grupos con permisos de contribuidor del proyecto. */
    async getContributorGroups(
        projectId: string,
        projectName: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoIdentityGroup[]> {
        const res = await this.request<{
            dataProviders: Record<string, { identities: AzdoIdentityGroup[] }>;
        }>(
            "POST",
            "/Contribution/HierarchyQuery",
            {
                ...opts,
                organizationLevel: true,
                apiVersion: "5.0-preview.1",
                body: {
                    contributionIds: ["ms.vss-admin-web.security-view-members-data-provider"],
                    dataProviderContext: {
                        properties: {
                            permissionSetId: "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87",
                            permissionSetToken: `repoV2/${projectId}/`,
                            sourcePage: {
                                url: `https://dev.azure.com/${this.baseUrl.split("/").pop()}/${encodeURIComponent(projectName)}/_settings/repositories?_a=permissions`,
                                routeId: "ms.vss-admin-web.project-admin-hub-route",
                                routeValues: {
                                    project: projectName,
                                    adminPivot: "repositories",
                                    controller: "ContributedPage",
                                    action: "Execute"
                                }
                            }
                        }
                    }
                }
            }
        );
        return res.body.dataProviders["ms.vss-admin-web.security-view-members-data-provider"].identities;
    }

    /** Deniega permisos a una entidad por SID. */
    denyPermission(
        projectId: string,
        entityId: string,
        permissionCode: number,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        return this.request("POST", "/AccessControlEntries/2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87", {
            ...opts,
            organizationLevel: true,
            apiVersion: "5.0-preview.1",
            body: {
                token: `repoV2/${projectId}/`,
                merge: true,
                accessControlEntries: [
                    {
                        descriptor: `Microsoft.TeamFoundation.Identity;${entityId}`,
                        allow: 0,
                        deny: permissionCode,
                        extendedInfo: {
                            effectiveAllow: 0,
                            effectiveDeny: permissionCode,
                            inheritedAllow: 0,
                            inheritedDeny: permissionCode
                        }
                    }
                ]
            }
        });
    }

    /** Deniega permisos a un usuario por email. */
    denyPermissionByEmail(
        projectId: string,
        userEmail: string,
        permissionCode: number,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        return this.request("POST", "/AccessControlEntries/2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87", {
            ...opts,
            organizationLevel: true,
            apiVersion: "5.0-preview.1",
            body: {
                token: `repoV2/${projectId}/`,
                merge: true,
                accessControlEntries: [
                    {
                        descriptor: `Microsoft.IdentityModel.Claims.ClaimsIdentity;e95d19cb-8725-4b0b-8ce2-ff42be9ae6e9\\\\${userEmail}`,
                        allow: 0,
                        deny: permissionCode,
                        extendedInfo: {
                            effectiveAllow: 0,
                            effectiveDeny: permissionCode,
                            inheritedAllow: 0,
                            inheritedDeny: permissionCode
                        }
                    }
                ]
            }
        });
    }

    /**
     * Aplica permisos a todos los proyectos: crea la política de regex,
     * obtiene los grupos, y deniega los permisos de Force Push y Create Branch.
     */
    async applyPermissions(
        opts?: AzdoRequestOptions
    ): Promise<Array<{ project: string; groupsProcessed: number }>> {
        const projectsRes = await this.listProjects(opts);
        const projects = projectsRes.body.value;
        const summary: Array<{ project: string; groupsProcessed: number }> = [];

        for (const project of projects) {
            const policyRes = await this.applyCommitterRegexPermissions(project.id, opts);
            const policyId = policyRes.body;

            await this.updateCommitterRegexPermissions(project.id, policyId, [], opts);

            const groups = await this.getContributorGroups(project.id, project.name, opts);

            for (const group of groups) {
                if (group.sid) {
                    await this.denyPermission(project.id, group.sid, 32768, opts);
                    await this.denyPermission(project.id, group.sid, 128, opts);
                } else if (group.metaType === "member") {
                    if (group.sid) {
                        await this.denyPermission(project.id, group.sid, 32768, opts);
                    }
                    if (group.mailAddress) {
                        await this.denyPermissionByEmail(project.id, group.mailAddress, 128, opts);
                    }
                }
            }

            summary.push({ project: project.name, groupsProcessed: groups.length });
        }

        return summary;
    }

    // =========================================================================
    // Agent Pools
    // =========================================================================

    /** Asocia un agent pool existente a un proyecto (crea una queue). */
    async addAgentPoolToProject(
        project: string | undefined,
        agentPoolName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoAgentQueue>> {
        const poolsRes = await this.request<AzdoListResponse<AzdoAgentPool>>(
            "GET",
            "/distributedtask/pools",
            {
                ...opts,
                organizationLevel: true,
                apiVersion: "7.1-preview.1"
            }
        );
        const pool = poolsRes.body.value.find(p => p.name === agentPoolName);
        if (!pool) {
            throw new Error(`Agent Pool '${agentPoolName}' not found.`);
        }

        return this.request("POST", "/distributedtask/queues", {
            ...opts,
            project: project ?? opts?.project,
            apiVersion: "7.1-preview.1",
            query: { authorizePipelines: true, ...opts?.query },
            body: { name: agentPoolName, pool: { id: pool.id } }
        });
    }

    /** Autoriza todos los pipelines para usar una queue. */
    authorizeAgentPool(
        project: string | undefined,
        queueId: number,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        return this.request("PATCH", `/pipelines/pipelinePermissions/queue/${queueId}`, {
            ...opts,
            project: project ?? opts?.project,
            apiVersion: "7.1-preview.1",
            body: {
                resource: { type: "queue", id: String(queueId) },
                allPipelines: { authorized: true, authorizedBy: null, authorizedOn: null },
                pipelines: []
            }
        });
    }

    // =========================================================================
    // Variable Groups
    // =========================================================================

    /** Crea un variable group. Si ya existe con el mismo nombre, lo devuelve sin crear. */
    async createVariableGroup(
        project: string | undefined,
        name: string,
        variables: Record<string, { value?: string; isSecret?: boolean }> = {},
        opts?: AzdoRequestOptions
    ): Promise<AzdoVariableGroup> {
        const existingRes = await this.request<AzdoListResponse<AzdoVariableGroup>>(
            "GET",
            "/distributedtask/variablegroups",
            { ...opts, project: project ?? opts?.project, apiVersion: "7.1-preview.1" }
        );
        const existing = existingRes.body.value.find(vg => vg.name === name);
        if (existing) return existing;

        const res = await this.request<AzdoVariableGroup>(
            "POST",
            "/distributedtask/variablegroups",
            {
                ...opts,
                project: project ?? opts?.project,
                apiVersion: "7.1-preview.1",
                body: { name, variables }
            }
        );
        return res.body;
    }

    // =========================================================================
    // Build Folders
    // =========================================================================

    /** Crea una carpeta de build. Si ya existe, la devuelve. */
    async createBuildFolder(
        project: string | undefined,
        folderPath: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoBuildFolder> {
        const normalizedPath = folderPath.startsWith("\\") ? folderPath : `\\${folderPath}`;

        const foldersRes = await this.request<AzdoListResponse<AzdoBuildFolder>>(
            "GET",
            "/build/folders",
            { ...opts, project: project ?? opts?.project, apiVersion: "7.2-preview.2" }
        );
        const existing = foldersRes.body.value.find(f => f.path === normalizedPath);
        if (existing) return existing;

        const encodedPath = encodeURIComponent(normalizedPath);
        const res = await this.request<AzdoBuildFolder>(
            "PUT",
            `/build/folders?path=${encodedPath}`,
            {
                ...opts,
                project: project ?? opts?.project,
                apiVersion: "6.0-preview.2",
                body: { path: normalizedPath }
            }
        );
        return res.body;
    }

    // =========================================================================
    // Pipelines — creation
    // =========================================================================

    /** Crea un pipeline YAML asociado a un repositorio. */
    async createPipeline(
        options: {
            project: string | undefined;
            name: string;
            folder?: string;
            repository: string;
            yamlPath: string;
            defaultBranch?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const reposRes = await this.listRepos({ ...opts, project: options.project });
        const repo = reposRes.body.value.find(r => r.name === options.repository);
        if (!repo) {
            throw new Error(`Repository '${options.repository}' not found.`);
        }

        return this.request("POST", "/pipelines", {
            ...opts,
            project: options.project,
            apiVersion: "7.1-preview.1",
            body: {
                name: options.name,
                folder: options.folder ?? "\\",
                configuration: {
                    type: "yaml",
                    path: options.yamlPath,
                    repository: {
                        id: repo.id,
                        type: "azureReposGit",
                        name: repo.name,
                        defaultBranch: options.defaultBranch ?? "refs/heads/main"
                    }
                }
            }
        });
    }

    // =========================================================================
    // Service Connections
    // =========================================================================

    /** Comparte un service endpoint con un proyecto. */
    async shareServiceConnection(
        project: string,
        resourceId: string,
        resourceName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const projectRes = await this.getProject(project, { ...opts, organizationLevel: true });
        if (!projectRes.body) {
            throw new Error(`Project '${project}' not found.`);
        }

        return this.request("PATCH", `/serviceendpoint/endpoints/${resourceId}`, {
            ...opts,
            organizationLevel: true,
            apiVersion: "6.0-preview.4",
            body: [
                {
                    description: "",
                    name: `${resourceName}-${projectRes.body.name}`,
                    projectReference: { id: projectRes.body.id, name: projectRes.body.name }
                }
            ]
        });
    }

    // =========================================================================
    // Tags
    // =========================================================================

    /** Lista todas las tags de un repositorio. */
    async getTags(
        project: string | undefined,
        repository: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoGitTag[]> {
        const res = await this.request<AzdoListResponse<AzdoGitRef>>(
            "GET",
            `/git/repositories/${encodeURIComponent(repository)}/refs`,
            {
                ...opts,
                project: project ?? opts?.project,
                query: { filter: "tags/", ...opts?.query }
            }
        );
        return res.body.value.map(tag => ({
            name: tag.name.replace("refs/tags/", ""),
            ref: tag.name,
            objectId: tag.objectId,
            creator: tag.creator,
            peeledObjectId: tag.peeledObjectId
        }));
    }

}
