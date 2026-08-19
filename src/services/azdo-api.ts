import type { HttpRequest, HttpResponse } from "./http-types";
import type { ExecOptions } from "../core/types";

// Re-export the HttpService type for configure()
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface HttpAgent {
    request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
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
// AzureDevOpsApi
// ---------------------------------------------------------------------------

export class AzureDevOpsApi {

    private baseUrl = "";
    private pat = "";
    private project = "";
    private apiVersion = "7.1";
    private agent: HttpAgent | null = null;
    private ownAgent = false;

    configure(config: AzureDevOpsApiConfig): this {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.pat = config.pat;
        if (config.project !== undefined) this.project = config.project;
        if (config.apiVersion !== undefined) this.apiVersion = config.apiVersion;
        if (config.agent) {
            this.agent = config.agent;
            this.ownAgent = false;
        }
        return this;
    }

    private getAgent(): HttpAgent {
        if (!this.agent) {
            throw new Error(
                "AzureDevOpsApi not configured. Call .configure({ baseUrl, pat }) first."
            );
        }
        return this.agent;
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
        const prefix = opts?.organizationLevel ? "" : this.projectPath(opts);
        const url = `${this.baseUrl}${prefix}/_apis${apiPath}`;
        const agent = this.getAgent();
        return agent.request<T>({
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

}
