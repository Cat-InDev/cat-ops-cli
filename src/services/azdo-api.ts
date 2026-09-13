import type { HttpRequest, HttpResponse, HttpError, RequestInterceptor, ResponseInterceptor } from "./http-types";
import type { ExecOptions } from "../core/types";
import { HttpService } from "./http";
import { toAzdoApiError } from "./azdo-errors";
import {
    RepositoryWorkspace,
    loadRepositoryZip,
    shouldOmit,
    type WorkspaceFile
} from "./azdo-workspace";

// Agente HTTP usable por AzureDevOpsApi. Además de `request`, puede exponer
// los métodos de interceptores y configuración de HttpService — si no los
// expone (agente custom minimalista), esas funciones no estarán disponibles.
interface HttpAgent {
    request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
    configure?(config: { insecureTls?: boolean }): unknown;
    isInsecureTls?(): boolean;
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
     * Acepta certificados TLS no confiables (autofirmados, proxies de
     * inspección corporativa). Se hereda al agente HTTP — interno o inyectado.
     * Úsalo con cuidado: deshabilita la protección contra MITM; para CAs
     * corporativas es preferible NODE_EXTRA_CA_CERTS.
     */
    insecureTls?: boolean;
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
    /** Override por-llamada: desactiva la validación del certificado TLS. */
    insecureTls?: boolean;
    /** Formato de respuesta esperado (binario para ZIP, etc.). */
    responseType?: "json" | "text" | "arraybuffer";
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
    /** Recurso protegido por la check (por ejemplo el environment de una approval). */
    resource?: { type?: string; id?: number | string; name?: string };
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

/** Cambio individual de un push (add / edit / delete). */
export interface AzdoGitChange {
    changeType: "add" | "edit" | "delete";
    item: { path: string };
    newContent?: {
        content: string;
        contentType: "rawtext" | "base64Encoded";
    };
}

/** Resultado de `mergeWithTemplate`. */
export interface AzdoMergeResult {
    message: string;
    changes: AzdoGitChange[];
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
    /** TLS inseguro heredado al agente HTTP (interno o inyectado). */
    private insecureTls = false;

    configure(config: AzureDevOpsApiConfig): this {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.pat = config.pat;
        if (config.project !== undefined) this.project = config.project;
        if (config.apiVersion !== undefined) this.apiVersion = config.apiVersion;
        if (config.agent) {
            this.agent = config.agent;
            this.ownAgent = false;
        }
        if (config.insecureTls !== undefined) {
            this.insecureTls = config.insecureTls;
            // Hereda la configuración al agente inyectado (si lo soporta);
            // el interno se crea con ella al materializarse.
            if (this.agent && typeof this.agent.configure === "function") {
                this.agent.configure({ insecureTls: this.insecureTls });
            }
        }
        // Los interceptores se aplican al agente activo, o quedan en cola si
        // el agente interno todavía no se ha creado.
        for (const i of config.requestInterceptors ?? []) this.addRequestInterceptor(i);
        for (const i of config.responseInterceptors ?? []) this.addResponseInterceptor(i);
        return this;
    }

    /** Indica si las peticiones de este cliente aceptan certificados TLS no confiables. */
    isInsecureTls(): boolean {
        return this.insecureTls;
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
            const svc = new HttpService();
            if (this.insecureTls) svc.configure({ insecureTls: true });
            this.agent = svc;
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

    /**
     * Normaliza un nombre de branch al ref completo `refs/heads/<branch>`.
     * Acepta `"main"`, `"heads/main"` o `"refs/heads/main"` indistintamente,
     * evitando doble prefijo.
     */
    private toRefName(branch: string): string {
        if (branch.startsWith("refs/heads/")) return branch;
        const clean = branch.replace(/^refs\//, "").replace(/^heads\//, "");
        return clean ? `refs/heads/${clean}` : branch;
    }

    /**
     * Patrón compartido por las funciones de creación: si el recurso ya existe,
     * o Azure responde 409/400 por duplicado en un race, devuelve el existente
     * con `exists: true` en el body en lugar de lanzar error.
     */
    private async createWithExistenceCheck<T>(
        findExisting: () => Promise<HttpResponse<T> | undefined>,
        create: () => Promise<HttpResponse<T>>,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<T & { exists: boolean }>> {
        const existing = await findExisting();
        if (existing) {
            return { ...existing, body: { ...existing.body, exists: true } };
        }

        try {
            const res = await create();
            return { ...res, body: { ...res.body, exists: false } };
        } catch (err) {
            // Race: entre el pre-check y la creación alguien creó el recurso.
            if (err && typeof err === "object" && "status" in err) {
                const status = (err as { status: number }).status;
                if (status === 409 || status === 400) {
                    const found = await findExisting();
                    if (found) {
                        return { ...found, body: { ...found.body, exists: true } };
                    }
                }
            }
            throw err;
        }
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
                insecureTls: opts?.insecureTls,
                responseType: opts?.responseType,
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
    ): Promise<HttpResponse<{ exists: boolean; data?: AzdoGitBranch }> > {
        try {
            const branch = await this.getBranch(repoNameOrId, branchName, opts);
            return {...branch, body: { exists: !!branch.body, data: branch.body }};
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return { ...err, body: { exists: false }, request: (err as any).request, status: 404, headers: (err as any).headers};
            }
            throw err;
        }
    }

    /** Obtiene una branch específica con su último commit. */
    async getBranch(repoNameOrId: string, branchName: string, opts?: AzdoRequestOptions): Promise<HttpResponse<AzdoGitBranch>> {
        const refName = branchName.replace(/^refs\//, "").replace(/^heads\//, "");
        const response = await this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/refs`, {...opts, query: { filter: `heads/${refName}` }});
        const branch = (response.body as Record<string, any>).value.find((b: AzdoGitBranch) => b.name === `refs/heads/${refName}`);
        return { ...response, body: branch };
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
        const query: Record<string, string | number | boolean | undefined> = {
            "searchCriteria.itemVersion.version": branch,
            "searchCriteria.itemVersion.versionType": "branch"
        };
        if (opts?.top !== undefined) query["searchCriteria.$top"] = opts.top;
        if (opts?.skip !== undefined) query["searchCriteria.$skip"] = opts.skip;
        return this.request("GET", `/git/repositories/${encodeURIComponent(repoNameOrId)}/commits`, {
            ...opts,
            query: { ...query, ...opts?.query }
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

    /**
     * Busca el PR activo que ya exista con la misma fuente/destino.
     * Devuelve `undefined` si no existe.
     */
    private async findPullRequest(
        repoNameOrId: string,
        sourceRefName: string,
        targetRefName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoGitPullRequest> | undefined> {
        try {
            const res = await this.request<AzdoListResponse<AzdoGitPullRequest>>(
                "GET",
                `/git/repositories/${encodeURIComponent(repoNameOrId)}/pullrequests`,
                {
                    ...opts,
                    query: {
                        status: "active",
                        "searchCriteria.sourceRefName": sourceRefName,
                        "searchCriteria.targetRefName": targetRefName,
                        ...opts?.query
                    }
                }
            );
            const pr = res.body.value.find(
                p => p.status === "active" && p.sourceRefName === sourceRefName && p.targetRefName === targetRefName
            );
            return pr ? { ...res, body: pr } : undefined;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
    }

    /**
     * Crea un pull request. Si ya existe un PR activo con la misma fuente
     * (sourceRefName) y destino (targetRefName), no lanza el error 409 de
     * Azure: devuelve el PR existente con `exists: true` en el body.
     */
    async createPullRequest(
        repoNameOrId: string,
        pr: { sourceRefName: string; targetRefName: string; title: string; description?: string },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoGitPullRequest & { exists: boolean }>> {
        const sourceRefName = this.toRefName(pr.sourceRefName);
        const targetRefName = this.toRefName(pr.targetRefName);

        return this.createWithExistenceCheck(
            () => this.findPullRequest(repoNameOrId, sourceRefName, targetRefName, opts),
            () => this.request<AzdoGitPullRequest>(
                "POST",
                `/git/repositories/${encodeURIComponent(repoNameOrId)}/pullrequests`,
                { ...opts, body: { ...pr, sourceRefName, targetRefName } }
            )
        );
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
    ): Promise<{ exists: boolean; data?: AzdoGitRepository }> {
        try {
            const res = await this.request<AzdoGitRepository>(
                "GET",
                `/git/repositories/${encodeURIComponent(repoName)}`,
                { ...opts, project: project ?? opts?.project }
            );
            return {exists: true, data: res.body};
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return {exists: false};
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
                    name: this.toRefName(branchName),
                    newObjectId: fromObjectId,
                    oldObjectId: "0000000000000000000000000000000000000000"
                }
            ]
        });
    }

    // =========================================================================
    // Commits — latest
    // =========================================================================

    /**
     * Obtiene el último commit de un repo (o de una branch específica).
     * Devuelve `null` si no hay commits.
     */
    async getLatestCommit(
        project: string | undefined,
        repoNameOrId: string,
        opts?: AzdoRequestOptions & { branch?: string }
    ): Promise<{ commitId: string; message: string; date: string; author: { name: string; date: string } } | null> {
        const branch = opts?.branch;
        const query: Record<string, string | number | boolean | undefined> = { "searchCriteria.$top": 1 };
        if (branch) {
            query["searchCriteria.itemVersion.version"] = branch;
            query["searchCriteria.itemVersion.versionType"] = "branch";
        }
        try {
            const res = await this.request<AzdoListResponse<AzdoGitCommitRef>>(
                "GET",
                `/git/repositories/${encodeURIComponent(repoNameOrId)}/commits`,
                { ...opts, project: project ?? opts?.project, query: { ...query, ...opts?.query } }
            );
            if (!res.body.value.length) return null;
            const commit = res.body.value[0];
            return {
                commitId: commit.commitId,
                message: commit.comment,
                date: commit.author.date,
                author: { name: commit.author.name, date: commit.author.date }
            };
        } catch (err) {
            if (
                branch &&
                err && typeof err === "object" &&
                (err as { message?: string }).message &&
                /could not be resolved|TF401175/.test((err as { message: string }).message)
            ) {
                return null;
            }
            throw err;
        }
    }

    // =========================================================================
    // Files — existence check
    // =========================================================================

    /**
     * Verifica si un archivo existe en una branch.
     * Devuelve `{ exists: true, data }` si existe, `{ exists: false }` si no.
     */
    async fileExists(
        project: string | undefined,
        repoName: string,
        branchName: string,
        filePath: string,
        opts?: AzdoRequestOptions
    ): Promise<{ exists: boolean; data?: AzdoGitItem }> {
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
            return { exists: true, data: res.body };
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return { exists: false };
            }
            if (
                err && typeof err === "object" &&
                (err as { message?: string }).message &&
                /could not be resolved|TF401175/.test((err as { message: string }).message)
            ) {
                return { exists: false };
            }
            throw err;
        }
    }

    // =========================================================================
    // Files — create / update
    // =========================================================================

    /**
     * Construye el body de un push (`refUpdates` + `commits`). Reutilizable
     * por todas las operaciones que escriben en un repo.
     */
    private buildPushBody(
        branch: string,
        oldObjectId: string | null,
        commits: Array<{ comment: string; changes: Array<Record<string, unknown>> }>
    ): Record<string, unknown> {
        const refName = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
        return {
            refUpdates: [
                {
                    name: refName,
                    oldObjectId: oldObjectId ?? "0000000000000000000000000000000000000000"
                }
            ],
            commits
        };
    }

    /**
     * Envía un push de uno o varios cambios en un solo commit. Reutiliza
     * `getLatestCommit` para resolver de forma automática el head de la branch
     * y no pedir el commit manualmente.
     */
    private async sendPush(
        options: {
            project: string | undefined;
            repository: string;
            branch: string;
            comment: string;
            changes: Array<Record<string, unknown>>;
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const latest = await this.getLatestCommit(options.project, options.repository, {
            ...opts,
            branch: options.branch
        });
        return this.request(
            "POST",
            `/git/repositories/${encodeURIComponent(options.repository)}/pushes`,
            {
                ...opts,
                project: options.project,
                body: this.buildPushBody(options.branch, latest?.commitId ?? null, [
                    { comment: options.comment, changes: options.changes }
                ])
            }
        );
    }

    /** Crea o actualiza un archivo en una branch (push de un solo archivo). */
    async createOrUpdateFile(
        options: {
            project: string | undefined;
            repo: string;
            branch: string;
            filePath: string;
            fileContent: string | Buffer;
            comment?: string;
            override?: boolean; // si es true, ignora si el archivo ya existe y fuerza la creación/actualización
        },
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const file = await this.fileExists(options.project, options.repo, options.branch, options.filePath, opts);

        if (file.exists && options.override === false) {
            throw new Error(`File ${options.filePath} already exists in ${options.repo}@${options.branch}. Use override=true to force update.`);
        }

        const isBuffer = Buffer.isBuffer(options.fileContent);
        const changes: Array<Record<string, unknown>> = [
            {
                changeType: file.exists ? "edit" : "add",
                item: { path: options.filePath },
                newContent: {
                    content: isBuffer ? options.fileContent.toString("base64") : options.fileContent,
                    contentType: isBuffer ? "base64Encoded" : "rawtext"
                }
            }
        ];

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.sendPush({
                    project: options.project,
                    repository: options.repo,
                    branch: options.branch,
                    comment: options.comment ?? "Automatic update",
                    changes
                }, opts);
            } catch (err) {
                if (attempt < maxRetries - 1 && err && typeof err === "object" && "status" in err && (err as { status: number }).status === 409) {
                    continue;
                }
                throw err;
            }
        }
        throw new Error("Unreachable");
    }

    /**
     * Resuelve la ruta y el contenido final de un archivo a crear.
     * Si `fileContent` es una plantilla conocida (ej. `$README:TEMPLATE`),
     * genera un README.md con el contenido por defecto.
     */
    private resolveFileTarget(
        repo: string,
        fileName: string,
        filePath: string,
        fileContent: string
    ): { path: string; content: string } {
        const contentTemplates: Record<string, { name: string }> = {
            "$README:TEMPLATE": { name: "README.md" }
        };
        const template = contentTemplates[fileContent];
        const path = `${filePath}/${template ? template.name : fileName}`.replace(/\/+/g, "/");
        const content = template ? `# ${repo}\n\nProject repository.` : fileContent;
        return { path, content };
    }

    /**
     * Crea un archivo en un repo SOLO si no existe: si ya existe no lo crea,
     * no lo reemplaza ni falla (devuelve `undefined`). Para sobrescribirlo,
     * usa `overrideFileInRepo`.
     */
    async createFileInRepo(
        project: string | undefined,
        repo: string,
        branch: string,
        fileName: string,
        filePath: string,
        fileContent: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown> | undefined> {
        const { path, content } = this.resolveFileTarget(repo, fileName, filePath, fileContent);

        const file = await this.fileExists(project, repo, branch, path, opts);
        if (file.exists) return undefined;

        return this.createOrUpdateFile({
            project,
            repo,
            branch,
            filePath: path,
            fileContent: content,
            comment: "Automated by prepare ci/cd process",
            override: true
        }, opts);
    }

    /**
     * Fuerza la creación/sobrescritura de un archivo en un repo aunque ya
     * exista (usa `changeType` edit si existe, add si no).
     */
    async overrideFileInRepo(
        project: string | undefined,
        repo: string,
        branch: string,
        fileName: string,
        filePath: string,
        fileContent: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<unknown>> {
        const { path, content } = this.resolveFileTarget(repo, fileName, filePath, fileContent);

        return this.createOrUpdateFile({
            project,
            repo,
            branch,
            filePath: path,
            fileContent: content,
            comment: "Automated by prepare ci/cd process",
            override: true
        }, opts);
    }

    /**
     * Inicializa un repositorio existente que no tiene branches,
     * creando un commit inicial con un README en la branch por defecto.
     * Si el repositorio ya tiene branches, no hace nada.
     * Si el repositorio no existe, lanza un error.
     */
    async initRepo(
        project: string | undefined,
        repository: string,
        opts?: AzdoRequestOptions
    ): Promise<void> {
        const repoCheck = await this.repoExists(project, repository, opts);
        if (!repoCheck.exists) {
            throw new Error(`Repository ${repository} does not exist.`);
        }

        await this.initRepoById(project, repoCheck.data!.id, opts);
    }

    private async initRepoById(
        project: string | undefined,
        repoId: string,
        opts?: AzdoRequestOptions
    ): Promise<void> {
        const branches = await this.listBranches(repoId, {
            ...opts,
            project: project ?? opts?.project
        });

        if (branches.body.value.length === 0) {
            await this.createFileInRepo(project, repoId, "main", "README.md", "/", "$README:TEMPLATE", opts);
        }
    }

    /** Crea un repositorio y lo inicializa con un README. */
    async createAndInitRepository(
        projectName: string,
        projectId: string,
        repository: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoGitRepository> {
        const existing = await this.repoExists(projectId, repository, opts);
        let repoData = existing.data;

        if (!existing.exists) {
            const res = await this.createRepository(projectName, projectId, repository, opts);
            repoData = res.body;
        }

        await this.initRepoById(projectId, repoData!.id, opts);

        return repoData!;
    }

    // =========================================================================
    // Pushes — bulk push (multiple changes)
    // =========================================================================

    /** Hace un push con múltiples cambios (add/edit/delete) en un solo commit. */
    pushChanges(
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
        return this.sendPush({
            project: options.project,
            repository: options.repository,
            branch: options.branch,
            comment: options.comment,
            changes: options.changes as Array<Record<string, unknown>>
        }, opts);
    }

    // =========================================================================
    // Templates — download + merge
    // =========================================================================

    /** Descarga un repositorio completo como ZIP y lo devuelve como workspace. */
    async downloadRepositoryZip(
        options: {
            project: string;
            repository: string;
            branch: string;
            scopePath?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<RepositoryWorkspace> {
        const res = await this.request<ArrayBuffer>(
            "GET",
            `/git/repositories/${encodeURIComponent(options.repository)}/items`,
            {
                ...opts,
                project: options.project,
                responseType: "arraybuffer",
                query: {
                    path: options.scopePath ?? "/",
                    "versionDescriptor[versionOptions]": 0,
                    "versionDescriptor[versionType]": 0,
                    "versionDescriptor[version]": options.branch,
                    resolveLfs: true,
                    "$format": "zip",
                    download: true,
                    ...opts?.query
                }
            }
        );
        return loadRepositoryZip(Buffer.from(res.body));
    }

    /**
     * Descarga el workspace de destino tratándolo como si fuera una base
     * sobre la que aplicar el template. Si la branch no existe todavía
     * (repo recién creado sin commits), devuelve un workspace vacío.
     */
    private async downloadWorkspaceOrEmpty(
        options: {
            project: string;
            repository: string;
            branch: string;
            scopePath?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<RepositoryWorkspace> {
        try {
            return await this.downloadRepositoryZip(options, opts);
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 404) {
                return new RepositoryWorkspace();
            }
            throw err;
        }
    }

    /**
     * Copia los archivos del template (`source`) sobre el workspace destino.
     * Con `overwrite: false` no pisa archivos existentes; con
     * `deleteExtra: true` elimina del destino los archivos que no existen
     * en el template.
     */
    copyWorkspace(
        options: {
            source: RepositoryWorkspace;
            destination: RepositoryWorkspace;
            overwrite?: boolean;
            deleteExtra?: boolean;
            omit?: string[];
        }
    ): void {
        const { source, destination, overwrite = true, deleteExtra = false } = options;
        if (deleteExtra) {
            for (const path of destination.listPaths()) {
                if (!source.has(path)) {
                    destination.delete(path);
                }
            }
        }
        for (const file of source.files.values()) {
            if (shouldOmit(file.path, options.omit)) continue;
            if (!overwrite && destination.has(file.path)) continue;
            destination.set({ path: file.path, content: Buffer.from(file.content), binary: file.binary });
        }
    }

    /** Aplica una transformación a cada archivo del workspace (en memoria). */
    async transformWorkspace(
        workspace: RepositoryWorkspace,
        transform: (file: WorkspaceFile) => void | Promise<void>
    ): Promise<void> {
        for (const file of workspace.files.values()) {
            await transform(file);
        }
    }

    /**
     * Compara dos workspaces y devuelve los cambios necesarios para dejar
     * `original` igual a `modified` (add / edit / delete), listos para
     * enviarlos por `pushChanges`.
     */
    compareWorkspaces(
        original: RepositoryWorkspace,
        modified: RepositoryWorkspace
    ): AzdoGitChange[] {
        const changes: AzdoGitChange[] = [];

        for (const file of modified.files.values()) {
            const previous = original.get(file.path);
            const newContent: AzdoGitChange["newContent"] = {
                content: file.binary ? file.content.toString("base64") : file.content.toString(),
                contentType: file.binary ? "base64Encoded" : "rawtext"
            };
            if (!previous) {
                changes.push({ changeType: "add", item: { path: file.path }, newContent });
                continue;
            }
            if (Buffer.compare(previous.content, file.content) === 0) continue;
            changes.push({ changeType: "edit", item: { path: file.path }, newContent });
        }

        for (const path of original.listPaths()) {
            if (!modified.has(path)) {
                changes.push({ changeType: "delete", item: { path } });
            }
        }

        return changes;
    }

    /**
     * Basa un repositorio en otro (template): descarga ambos, copia los
     * archivos del template sobre el destino —respetando `overwrite`,
     * `deleteExtra` y `filters.omit`—, aplica opcionalmente una
     * transformación y publica los cambios resultantes en un único commit.
     * Si no hay diferencias, no hace push.
     */
    async mergeWithTemplate(
        options: {
            project: string;
            repository: string;
            targetBranch: string;
            template: { project: string; repository: string; branch: string };
            filters?: { omit?: string[] };
            overwrite?: boolean;
            deleteExtra?: boolean;
            transform?: (file: WorkspaceFile) => void | Promise<void>;
            comment?: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<AzdoMergeResult> {
        const templateWorkspace = await this.downloadRepositoryZip(options.template, opts);
        const originalWorkspace = await this.downloadWorkspaceOrEmpty(
            { project: options.project, repository: options.repository, branch: options.targetBranch },
            opts
        );

        const mergedWorkspace = originalWorkspace.clone();

        this.copyWorkspace({
            source: templateWorkspace,
            destination: mergedWorkspace,
            overwrite: options.overwrite,
            deleteExtra: options.deleteExtra,
            omit: options.filters?.omit
        });

        if (options.transform) {
            await this.transformWorkspace(mergedWorkspace, options.transform);
        }

        const changes = this.compareWorkspaces(originalWorkspace, mergedWorkspace);
        if (changes.length === 0) {
            return { message: "No changes", changes };
        }

        await this.pushChanges({
            project: options.project,
            repository: options.repository,
            branch: options.targetBranch,
            comment: options.comment ?? "Automatic CI/CD configuration",
            changes
        }, opts);

        return { message: `Applied ${changes.length} changes`, changes };
    }

    // =========================================================================
    // Webhooks
    // =========================================================================
private async findWebhook(
        projectId: string,
        repositoryId: string,
        branchName: string,
        webhookUrl: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoWebHookSubscription> | undefined> {
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
            const found = res.body.results.find(
                e => e.publisherInputs.projectId === projectId
                    && e.publisherInputs.repository === repositoryId
                    && e.publisherInputs.branch === branchName
                    && e.consumerInputs.url === webhookUrl
            );
            return found ? { ...res, body: found } : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Verifica si existe un webhook de push para un repo/branch/URL dados.
     * Devuelve `{ exists: true, data }` si existe, `{ exists: false }` si no.
     */
    async webhookExists(
        projectId: string,
        repositoryId: string,
        branchName: string,
        webhookUrl: string,
        opts?: AzdoRequestOptions
    ): Promise<{ exists: boolean; data?: AzdoWebHookSubscription }> {
        const found = await this.findWebhook(projectId, repositoryId, branchName, webhookUrl, opts);
        return found ? { exists: true, data: found.body } : { exists: false };
    }

    /**
     * Crea un webhook de push para un repositorio. Si ya existe un webhook con
     * el mismo repo/branch/URL, no lanza el 409 de Azure: devuelve el existente
     * con `exists: true` en el body.
     */
    async createWebhook(
        projectId: string,
        repoId: string,
        sourceBranch: string,
        webhookUrl: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoWebHookSubscription & { exists: boolean }>> {
        return this.createWithExistenceCheck(
            () => this.findWebhook(projectId, repoId, sourceBranch, webhookUrl, opts),
            () => this.request<AzdoWebHookSubscription>(
                "POST",
                "/hooks/subscriptions",
                {
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
                }
            )
        );
    }

    // =========================================================================
    // Environments
    // =========================================================================

    /** Busca un environment por nombre en el proyecto. */
    private async findEnvironment(
        project: string | undefined,
        name: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoEnvironment> | undefined> {
        try {
            const res = await this.request<AzdoListResponse<AzdoEnvironment>>(
                "GET",
                "/distributedtask/environments",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "5.2-preview.1",
                    query: { name, ...opts?.query }
                }
            );
            const env = res.body.value.find(e => e.name === name);
            return env ? { ...res, body: env } : undefined;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
    }

    /**
     * Verifica si un environment existe en el proyecto.
     * Devuelve `{ exists: true, data }` si existe, `{ exists: false }` si no.
     */
    async environmentExists(
        project: string | undefined,
        name: string,
        opts?: AzdoRequestOptions
    ): Promise<{ exists: boolean; data?: AzdoEnvironment }> {
        const found = await this.findEnvironment(project, name, opts);
        return found ? { exists: true, data: found.body } : { exists: false };
    }

    /**
     * Crea un environment en un proyecto. Si ya existe un environment con el
     * mismo nombre, no lanza el error 409 de Azure: devuelve el existente con
     * `exists: true` en el body.
     */
    async createEnvironment(
        project: string | undefined,
        name: string,
        description = "",
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoEnvironment & { exists: boolean }>> {
        return this.createWithExistenceCheck(
            () => this.findEnvironment(project, name, opts),
            () => this.request<AzdoEnvironment>(
                "POST",
                "/distributedtask/environments",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "5.2-preview.1",
                    body: { name, description }
                }
            )
        );
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

    /** Busca la approval check de un environment, si existe. */
    private async findEnvironmentCheck(
        project: string | undefined,
        environmentId: number,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoPolicyConfiguration> | undefined> {
const isApprovalCheck = (c: AzdoPolicyConfiguration) =>
            c.type?.id === "8C6F20A7-A545-4486-9777-F762FAFE0D4D" &&
            c.resource?.type === "environment" &&
            (c.resource?.id === environmentId || String(c.resource?.id) === String(environmentId));

        try {
            const res = await this.request<AzdoListResponse<AzdoPolicyConfiguration>>(
                "GET",
                "/pipelines/checks/configurations",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "7.1-preview.1",
                    query: { resourceType: "environment", resourceId: String(environmentId), ...opts?.query }
                }
            );
            const check = res.body.value.find(isApprovalCheck);
            if (check) return { ...res, body: check };
        } catch (err) {
            // Si el filtro no está soportado (400/405...), intentamos query por recurso.
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
        }

// Fallback: el List de Azure exige resourceType + resourceId a la vez, así que
        // no hay "list all" fiable. Usamos el endpoint Query (POST), que recibe
        // los recursos en el body y devuelve sus checks exactas — sin params de
        // query expuestos a quedar nulos.
        try {
            const res = await this.request<AzdoListResponse<AzdoPolicyConfiguration>>(
                "POST",
                "/pipelines/checks/queryconfigurations",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "7.1-preview.1",
                    body: [{ type: "environment", id: String(environmentId) }]
                }
            );
            const value = Array.isArray(res.body) ? (res.body as AzdoPolicyConfiguration[]) : res.body.value;
            const check = value.find(isApprovalCheck);
            if (check) return { ...res, body: check };
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }

        return undefined;
    }

    /**
     * Crea una approval check para un environment. Si el environment ya tiene
     * una approval check, no la duplica: devuelve la existente con
     * `exists: true` en el body.
     */
    async createEnvironmentApproval(
        project: string | undefined,
        environmentId: number,
        environmentName: string,
        approver: AzdoIdentityGroup,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoPolicyConfiguration & { exists: boolean }>> {
        const existing = await this.findEnvironmentCheck(project, environmentId, opts);
        if (existing) {
            return { ...existing, body: { ...existing.body, exists: true } };
        }

        const post = () =>
            this.request<AzdoPolicyConfiguration>(
                "POST",
                "/pipelines/checks/configurations",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "7.1-preview.1",
                    query: { resourceType: "environment", resourceId: String(environmentId), ...opts?.query },
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
                }
            );

        try {
            const created = await post();
            return { ...created, body: { ...created.body, exists: false } };
        } catch (err) {
            const httpErr = err && typeof err === "object" && "status" in err ? (err as HttpError) : undefined;
            const status = httpErr?.status;
            const message =
                err instanceof Error
                    ? err.message
                    : String((httpErr?.body as { message?: string } | null)?.message ?? "");
            const isDuplicate =
                status === 409 ||
                (status === 400 && /(?:already\s+exists|exists\s+already|duplicate)/i.test(String(message)));

            if (httpErr && isDuplicate) {
                const found = await this.findEnvironmentCheck(project, environmentId, opts);
                if (found) {
                    return { ...found, body: { ...found.body, exists: true } };
                }
                // Azure confirmó que la check ya existe, pero no la lista:
                // devolvemos la existente sin fallar (idempotente).
                return {
                    ...httpErr,
                    body: {
                        id: 0,
                        url: "",
                        type: { id: "8C6F20A7-A545-4486-9777-F762FAFE0D4D", displayName: "Approval" },
                        isEnabled: true,
                        isBlocking: true,
                        settings: {},
                        exists: true
                    }
                };
            }
            throw err;
        }
    }

    /**
     * Crea un environment con approvals.
     * Si `approverGroup` es `"none"`, no agrega approvals.
     * Si el environment ya existe, lo devuelve con `exists: true` (sin crear ni
     * duplicar approvals).
     */
    async createEnvironmentWithApprovals(
        options: {
            project: string | undefined;
            environmentName: string;
            description?: string;
            approverGroup: string;
        },
        opts?: AzdoRequestOptions
    ): Promise<AzdoEnvironment & { exists: boolean }> {
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

    /** Busca un agent pool por nombre a nivel de organización. */
    private async findAgentPool(
        agentPoolName: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoAgentPool> {
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
        return pool;
    }

    /**
     * Busca la queue del proyecto que ya usa un pool, si existe.
     * Devuelve `{ exists: true, data }` con la queue, o `{ exists: false }`.
     */
    private async findAgentPoolQueue(
        project: string | undefined,
        poolId: number,
        agentPoolName: string,
        opts?: AzdoRequestOptions
    ): Promise<{ exists: boolean; data?: HttpResponse<AzdoAgentQueue> }> {
        try {
            const queuesRes = await this.request<AzdoListResponse<AzdoAgentQueue>>(
                "GET",
                "/distributedtask/queues",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "7.1-preview.1"
                }
            );
            const queue = queuesRes.body.value.find(q => q.pool?.id === poolId || q.name === agentPoolName);
            return queue ? { exists: true, data: { ...queuesRes, body: queue } } : { exists: false };
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return { exists: false };
            }
            throw err;
        }
    }

    /** Crea la queue que asocia un pool a un proyecto. */
    private createAgentQueue(
        project: string | undefined,
        agentPoolName: string,
        poolId: number,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoAgentQueue>> {
        return this.request("POST", "/distributedtask/queues", {
            ...opts,
            project: project ?? opts?.project,
            apiVersion: "7.1-preview.1",
            query: { authorizePipelines: true, ...opts?.query },
            body: { name: agentPoolName, pool: { id: poolId } }
        });
    }

    /**
     * Asocia un agent pool existente a un proyecto (crea una queue).
     * Si la queue ya existe, la devuelve con `exists: true` en el body: no crea
     * otra, no la reemplaza y no produce error 40X.
     */
    async addAgentPoolToProject(
        project: string | undefined,
        agentPoolName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoAgentQueue & { exists: boolean }>> {
        const pool = await this.findAgentPool(agentPoolName, opts);

        const existing = await this.findAgentPoolQueue(project, pool.id, agentPoolName, opts);
        if (existing.exists && existing.data) {
            return { ...existing.data, body: { ...existing.data.body, exists: true } };
        }

        return this.createAgentQueueWithExists(project, agentPoolName, pool.id, opts, false);
    }

    /** Crea la queue y agrega `exists: false` al body (o recupera en un 409). */
    private async createAgentQueueWithExists(
        project: string | undefined,
        agentPoolName: string,
        poolId: number,
        opts?: AzdoRequestOptions,
        force = true
    ): Promise<HttpResponse<AzdoAgentQueue & { exists: boolean }>> {
        try {
            const res = await this.createAgentQueue(project, agentPoolName, poolId, opts);
            return { ...res, body: { ...res.body, exists: false } };
        } catch (err) {
            if (force && err && typeof err === "object" && "status" in err) {
                const status = (err as { status: number }).status;
                if (status === 409 || status === 400) {
                    const existing = await this.findAgentPoolQueue(project, poolId, agentPoolName, opts);
                    if (existing.exists && existing.data) {
                        return { ...existing.data, body: { ...existing.data.body, exists: true } };
                    }
                }
            }
            throw err;
        }
    }

    /**
     * Fuerza la creación de la queue del pool en el proyecto (sin pre-chequeo).
     * Si Azure responde 409/400 porque la queue ya existe, devuelve la queue
     * existente con `exists: true` en el body.
     */
    async overrideAgentPoolToProject(
        project: string | undefined,
        agentPoolName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoAgentQueue & { exists: boolean }>> {
        const pool = await this.findAgentPool(agentPoolName, opts);

        return this.createAgentQueueWithExists(project, agentPoolName, pool.id, opts, true);
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

    /**
     * Crea un variable group. Si ya existe con el mismo nombre, lo devuelve
     * con `exists: true` sin crear.
     */
    async createVariableGroup(
        project: string | undefined,
        name: string,
        variables: Record<string, { value?: string; isSecret?: boolean }> = {},
        opts?: AzdoRequestOptions
    ): Promise<AzdoVariableGroup & { exists: boolean }> {
        const existingRes = await this.request<AzdoListResponse<AzdoVariableGroup>>(
            "GET",
            "/distributedtask/variablegroups",
            { ...opts, project: project ?? opts?.project, apiVersion: "7.1-preview.1" }
        );
        const existing = existingRes.body.value.find(vg => vg.name === name);
        if (existing) return { ...existing, exists: true };

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
        return { ...res.body, exists: false };
    }

    // =========================================================================
    // Build Folders
    // =========================================================================

    /** Crea una carpeta de build. Si ya existe, la devuelve con `exists: true`. */
    async createBuildFolder(
        project: string | undefined,
        folderPath: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoBuildFolder & { exists: boolean }> {
        const normalizedPath = folderPath.startsWith("\\") ? folderPath : `\\${folderPath}`;

        const foldersRes = await this.request<AzdoListResponse<AzdoBuildFolder>>(
            "GET",
            "/build/folders",
            { ...opts, project: project ?? opts?.project, apiVersion: "7.2-preview.2" }
        );
        const existing = foldersRes.body.value.find(f => f.path === normalizedPath);
        if (existing) return { ...existing, exists: true };

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
        return { ...res.body, exists: false };
    }

    /**
     * Crea un folder de pipelines en el proyecto. En Azure DevOps los folders
     * de la sección "Pipelines" se gestionan con la misma API de build folders,
     * por lo que delega en {@link createBuildFolder}. Si el folder ya existe,
     * no lo recrea: devuelve `exists: true`.
     */
    async createPipelinesFolder(
        project: string | undefined,
        folderPath: string,
        opts?: AzdoRequestOptions
    ): Promise<AzdoBuildFolder & { exists: boolean }> {
        return this.createBuildFolder(project, folderPath, opts);
    }

    // =========================================================================
    // Pipelines — creation
    // =========================================================================

    /** Busca un pipeline por nombre en el proyecto. */
    private async findPipeline(
        project: string | undefined,
        name: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoPipeline> | undefined> {
        try {
            const res = await this.request<AzdoListResponse<AzdoPipeline>>(
                "GET",
                "/pipelines",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    query: { name, ...opts?.query }
                }
            );
            const pipeline = res.body.value.find(p => p.name === name);
            return pipeline ? { ...res, body: pipeline } : undefined;
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
    }

    /**
     * Verifica si un pipeline existe en el proyecto.
     * Devuelve `{ exists: true, data }` si existe, `{ exists: false }` si no.
     */
    async pipelineExists(
        project: string | undefined,
        name: string,
        opts?: AzdoRequestOptions
    ): Promise<{ exists: boolean; data?: AzdoPipeline }> {
        const found = await this.findPipeline(project, name, opts);
        return found ? { exists: true, data: found.body } : { exists: false };
    }

    /**
     * Crea un pipeline YAML asociado a un repositorio. Si ya existe un pipeline
     * con el mismo nombre, no lanza el 409: devuelve el existente con
     * `exists: true` en el body.
     */
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
    ): Promise<HttpResponse<AzdoPipeline & { exists: boolean }>> {
        const reposRes = await this.listRepos({ ...opts, project: options.project });
        const repo = reposRes.body.value.find(r => r.name === options.repository || r.id === options.repository);
        if (!repo) {
            throw new Error(`Repository '${options.repository}' not found.`);
        }

        const folder = options.folder ?? "\\";
        if (folder !== "\\") {
            await this.createBuildFolder(options.project, folder, opts);
        }

        return this.createWithExistenceCheck(
            () => this.findPipeline(options.project, options.name, opts),
            () => this.request<AzdoPipeline>(
                "POST",
                "/pipelines",
                {
                    ...opts,
                    project: options.project,
                    apiVersion: "7.1-preview.1",
                    body: {
                        name: options.name,
                        folder,
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
                }
            )
        );
    }

    // =========================================================================
    // Service Connections
    // =========================================================================

    /** Busca si un service endpoint ya existe en un proyecto (p. ej. compartido). */
    private async findServiceConnectionInProject(
        project: string,
        endpointId: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoServiceEndpoint> | undefined> {
        try {
            const res = await this.request<AzdoListResponse<AzdoServiceEndpoint>>(
                "GET",
                "/serviceendpoint/endpoints",
                {
                    ...opts,
                    project: project ?? opts?.project,
                    apiVersion: "6.0-preview.4",
                    query: { ...opts?.query }
                }
            );
            const value = Array.isArray(res.body)
                ? (res.body as AzdoServiceEndpoint[])
                : res.body.value;
            const endpoint = value.find(e => e.id === endpointId);
            if (endpoint) return { ...res, body: endpoint };
        } catch (err) {
            if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
                return undefined;
            }
            throw err;
        }
        return undefined;
    }

    /**
     * Comparte un service endpoint con un proyecto.
     * Si el endpoint ya existe en el proyecto destino, no lo duplica: devuelve
     * el existente con `exists: true`.
     */
    async shareServiceConnection(
        project: string,
        resourceId: string,
        resourceName: string,
        opts?: AzdoRequestOptions
    ): Promise<HttpResponse<AzdoServiceEndpoint & { exists: boolean }>> {
        const projectRes = await this.getProject(project, { ...opts, organizationLevel: true });
        if (!projectRes.body) {
            throw new Error(`Project '${project}' not found.`);
        }

        return this.createWithExistenceCheck<AzdoServiceEndpoint>(
            () => this.findServiceConnectionInProject(project, resourceId, opts),
            () => this.request(
                "PATCH",
                `/serviceendpoint/endpoints/${resourceId}`,
                {
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
                }
            ),
            opts
        );
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
