import { logger } from "../core/logger";
import type {
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpServiceConfig,
    RequestInterceptor,
    ResponseInterceptor,
    RequestContext
} from "./http-types";

function buildQueryString(query?: Record<string, string | number | boolean | undefined>): string {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
}

function parseHeaders(raw: Headers): Record<string, string> {
    const headers: Record<string, string> = {};
    raw.forEach((value, key) => {
        headers[key] = value;
    });
    return headers;
}

async function parseBody(res: globalThis.Response): Promise<unknown> {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        return res.json();
    }
    return res.text();
}

function createHttpError<T>(
    message: string,
    status: number,
    headers: Record<string, string>,
    body: T,
    request: HttpRequest
): Error & { status: number; headers: Record<string, string>; body: T; request: HttpRequest } {
    const err = new Error(message) as Error & {
        status: number;
        headers: Record<string, string>;
        body: T;
        request: HttpRequest;
    };
    err.status = status;
    err.headers = headers;
    err.body = body;
    err.request = request;
    return err;
}

class HttpService {

    private baseUrl = "";
    private defaultHeaders: Record<string, string> = {};
    private defaultTimeout = 0;
    private requestInterceptors: RequestInterceptor[] = [];
    private responseInterceptors: ResponseInterceptor[] = [];

    configure(config: HttpServiceConfig): this {
        if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
        if (config.defaultHeaders !== undefined) this.defaultHeaders = { ...config.defaultHeaders };
        if (config.defaultTimeout !== undefined) this.defaultTimeout = config.defaultTimeout;
        if (config.requestInterceptors) this.requestInterceptors = [...config.requestInterceptors];
        if (config.responseInterceptors) this.responseInterceptors = [...config.responseInterceptors];
        return this;
    }

    addRequestInterceptor(interceptor: RequestInterceptor): this {
        this.requestInterceptors.push(interceptor);
        return this;
    }

    removeRequestInterceptor(interceptor: RequestInterceptor): this {
        const idx = this.requestInterceptors.indexOf(interceptor);
        if (idx !== -1) this.requestInterceptors.splice(idx, 1);
        return this;
    }

    clearRequestInterceptors(): this {
        this.requestInterceptors = [];
        return this;
    }

    addResponseInterceptor(interceptor: ResponseInterceptor): this {
        this.responseInterceptors.push(interceptor);
        return this;
    }

    removeResponseInterceptor(interceptor: ResponseInterceptor): this {
        const idx = this.responseInterceptors.indexOf(interceptor);
        if (idx !== -1) this.responseInterceptors.splice(idx, 1);
        return this;
    }

    clearResponseInterceptors(): this {
        this.responseInterceptors = [];
        return this;
    }

    async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {

        const fullUrl = this.baseUrl + req.url + buildQueryString(req.query);
        const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
        const timeout = req.timeout ?? this.defaultTimeout;

        const mergedHeaders: Record<string, string> = {
            ...this.defaultHeaders,
            ...req.headers
        };

        if (req.body !== undefined && !mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
            mergedHeaders["Content-Type"] = "application/json";
        }

        // --- request interceptors ---
        const ctx: RequestContext = {
            request: { url: fullUrl, method, headers: mergedHeaders, body: req.body, timeout },
            abort: (reason) => {
                ctx.aborted = true;
                ctx.abortReason = reason ?? "Request aborted by interceptor";
            },
            aborted: false
        };

        for (const interceptor of this.requestInterceptors) {
            await interceptor(ctx);
            if (ctx.aborted) {
                throw new Error(ctx.abortReason ?? "Request aborted by interceptor");
            }
        }

        // --- dry-run support ---
        const execOpts = req.exec;
        if (execOpts?.dryRun) {
            logger.warn(`DRY-RUN HTTP: ${method} ${ctx.request.url}`);
            return {
                status: 0,
                headers: {},
                body: null as T,
                request: ctx.request
            };
        }

        // --- fetch ---
        const fetchInit: RequestInit = {
            method: ctx.request.method,
            headers: ctx.request.headers
        };

        if (ctx.request.body !== undefined && method !== "GET" && method !== "HEAD") {
            fetchInit.body = typeof ctx.request.body === "string"
                ? ctx.request.body
                : JSON.stringify(ctx.request.body);
        }

        if (timeout > 0) {
            fetchInit.signal = AbortSignal.timeout(timeout);
        }

        logger.info(`HTTP ${method} ${ctx.request.url}`);

        let rawRes: globalThis.Response;

        try {
            rawRes = await fetch(ctx.request.url, fetchInit);
        } catch (error) {
            if (error instanceof DOMException && error.name === "TimeoutError") {
                throw createHttpError(
                    `HTTP ${method} ${ctx.request.url} timeout after ${timeout}ms`,
                    0,
                    {},
                    null,
                    ctx.request
                );
            }
            throw error;
        }

        const responseHeaders = parseHeaders(rawRes.headers);
        const body = await parseBody(rawRes) as T;

        const response: HttpResponse<T> = {
            status: rawRes.status,
            headers: responseHeaders,
            body,
            request: ctx.request
        };

        // --- response interceptors ---
        const resCtx = { response, request: ctx.request };
        for (const interceptor of this.responseInterceptors) {
            await interceptor(resCtx);
        }

        // --- error on non-2xx ---
        if (!rawRes.ok) {
            throw createHttpError(
                `HTTP ${method} ${ctx.request.url} responded with ${rawRes.status}`,
                rawRes.status,
                responseHeaders,
                body,
                ctx.request
            );
        }

        return resCtx.response;

    }

    get<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "GET" });
    }

    post<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "POST", body });
    }

    put<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "PUT", body });
    }

    patch<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "PATCH", body });
    }

    delete<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "DELETE" });
    }

    head<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "HEAD" });
    }

    options<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.request<T>({ ...options, url, method: "OPTIONS" });
    }

}

// ---------------------------------------------------------------------------
// HttpRegistry — gestor de agentes HTTP nombrados
// ---------------------------------------------------------------------------

class HttpRegistry {

    private defaultAgent: HttpService;
    private agents: Map<string, HttpService> = new Map();

    constructor(defaultAgent?: HttpService) {
        this.defaultAgent = defaultAgent ?? new HttpService();
    }

    // ---- agent management ----

    /**
     * Crea un agente nombrado a partir de parámetros de configuración.
     * El `HttpService` interno se construye aquí — no hace falta instanciarlo
     * por fuera. Si ya existe un agente con ese nombre, lo reemplaza.
     */
    createAgent(name: string, config?: HttpServiceConfig): this {
        const agent = new HttpService();
        if (config) agent.configure(config);
        this.agents.set(name, agent);
        return this;
    }

    /**
     * Devuelve el agente registrado con el nombre indicado.
     * Lanza si no existe.
     */
    agent(name: string): HttpService {
        const a = this.agents.get(name);
        if (!a) {
            throw new Error(
                `HTTP agent "${name}" not found. Available: ${this.listAgents().join(", ") || "(none)"}`
            );
        }
        return a;
    }

    /**
     * Elimina un agente nombrado. Devuelve true si existía.
     */
    removeAgent(name: string): boolean {
        return this.agents.delete(name);
    }

    /**
     * Lista los nombres de todos los agentes registrados.
     */
    listAgents(): string[] {
        return Array.from(this.agents.keys());
    }

    // ---- delegation to default agent ----

    configure(config: HttpServiceConfig): this {
        this.defaultAgent.configure(config);
        return this;
    }

    addRequestInterceptor(interceptor: RequestInterceptor): this {
        this.defaultAgent.addRequestInterceptor(interceptor);
        return this;
    }

    removeRequestInterceptor(interceptor: RequestInterceptor): this {
        this.defaultAgent.removeRequestInterceptor(interceptor);
        return this;
    }

    clearRequestInterceptors(): this {
        this.defaultAgent.clearRequestInterceptors();
        return this;
    }

    addResponseInterceptor(interceptor: ResponseInterceptor): this {
        this.defaultAgent.addResponseInterceptor(interceptor);
        return this;
    }

    removeResponseInterceptor(interceptor: ResponseInterceptor): this {
        this.defaultAgent.removeResponseInterceptor(interceptor);
        return this;
    }

    clearResponseInterceptors(): this {
        this.defaultAgent.clearResponseInterceptors();
        return this;
    }

    request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
        return this.defaultAgent.request(req);
    }

    get<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.defaultAgent.get(url, options);
    }

    post<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.defaultAgent.post(url, body, options);
    }

    put<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.defaultAgent.put(url, body, options);
    }

    patch<T = unknown>(url: string, body?: unknown, options?: Omit<HttpRequest, "url" | "method" | "body">): Promise<HttpResponse<T>> {
        return this.defaultAgent.patch(url, body, options);
    }

    delete<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.defaultAgent.delete(url, options);
    }

    head<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.defaultAgent.head(url, options);
    }

    options<T = unknown>(url: string, options?: Omit<HttpRequest, "url" | "method">): Promise<HttpResponse<T>> {
        return this.defaultAgent.options(url, options);
    }

}

const http: HttpService & HttpRegistry = new HttpRegistry() as HttpService & HttpRegistry;

export { http, HttpService, HttpRegistry };
export type {
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpServiceConfig,
    RequestInterceptor,
    ResponseInterceptor,
    RequestContext,
    ResponseContext
} from "./http-types";
