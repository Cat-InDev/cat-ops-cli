import { logger } from "../core/logger";
import nodeHttp from "node:http";
import nodeHttps from "node:https";
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

/**
 * Describe la causa real de un fallo de red de fetch. Node envuelve el error
 * verdadero (DNS, conexión rechazada, TLS, ...) en la cadena `cause` y el
 * mensaje visible es solo "fetch failed" — aquí lo desenterramos.
 */
function describeNetworkFailure(error: unknown): string {
    const parts: string[] = [];
    let cur: unknown = error;
    const seen = new Set<unknown>();
    while (cur && typeof cur === "object" && !seen.has(cur)) {
        seen.add(cur);
        const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
        if (typeof e.code === "string" && e.code) parts.push(e.code);
        else if (typeof e.message === "string" && e.message.trim() && e.message !== "fetch failed") {
            parts.push(e.message.trim());
        }
        cur = e.cause;
    }
    return [...new Set(parts)].join(" · ") || "fallo de red sin detalle";
}

class HttpService {

    private baseUrl = "";
    private defaultHeaders: Record<string, string> = {};
    private defaultTimeout = 0;
    private insecureTls = false;
    /** Agente dedicado para TLS inseguro — se crea perezosamente. */
    private insecureAgent: nodeHttps.Agent | null = null;
    private requestInterceptors: RequestInterceptor[] = [];
    private responseInterceptors: ResponseInterceptor[] = [];

    configure(config: HttpServiceConfig): this {
        if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl;
        if (config.defaultHeaders !== undefined) this.defaultHeaders = { ...config.defaultHeaders };
        if (config.defaultTimeout !== undefined) this.defaultTimeout = config.defaultTimeout;
        if (config.insecureTls !== undefined) this.insecureTls = config.insecureTls;
        if (config.requestInterceptors) this.requestInterceptors = [...config.requestInterceptors];
        if (config.responseInterceptors) this.responseInterceptors = [...config.responseInterceptors];
        return this;
    }

    /** Indica si este agente acepta certificados TLS no confiables. */
    isInsecureTls(): boolean {
        return this.insecureTls;
    }

    /**
     * Transporte alternativo para TLS inseguro (certificados autofirmados,
     * CAs corporativas no instaladas, ...): usa node:http/https con
     * `rejectUnauthorized: false` y devuelve un `Response` estándar para que
     * el resto del pipeline (parseo, interceptores, errores) sea idéntico al
     * del fetch normal. Sigue redirecciones hasta MAX_REDIRECTS.
     */
    private insecureFetch(url: string, init: RequestInit): Promise<globalThis.Response> {

        const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

        const abortError = (signal: AbortSignal): Error => {
            // Misma semántica que el timeout de fetch: DOMException TimeoutError.
            return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
                ? signal.reason
                : new DOMException("The operation was aborted.", "TimeoutError");
        };

        // Agente propio (no el global): sin keep-alive para no retener sockets
        // abiertos tras la respuesta — crítico en CLI y tests.
        if (!this.insecureAgent) {
            this.insecureAgent = new nodeHttps.Agent({
                rejectUnauthorized: false,
                keepAlive: false
            });
        }
        const insecureAgent = this.insecureAgent;

        return new Promise((resolve, reject) => {

            const doRequest = (targetUrl: string, redirectsLeft: number): void => {

                let parsed: URL;
                try {
                    parsed = new URL(targetUrl);
                } catch {
                    reject(new Error(`URL inválida: ${targetUrl}`));
                    return;
                }

                const isHttps = parsed.protocol === "https:";
                const transport = isHttps ? nodeHttps : nodeHttp;

                const reqOptions: nodeHttps.RequestOptions = {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: init.method ?? "GET",
                    headers: init.headers as Record<string, string> | undefined,
                    // Núcleo de "TLS inseguro": no validar la cadena del servidor
                    rejectUnauthorized: false,
                    agent: isHttps ? insecureAgent : nodeHttp.globalAgent
                };

                const req = transport.request(reqOptions, (res) => {
                    const status = res.statusCode ?? 0;

                    if (REDIRECT_STATUSES.has(status)) {
                        res.resume(); // drena el body pendiente
                        const location = res.headers.location;
                        if (!location || redirectsLeft <= 0) {
                            reject(new Error(
                                `HTTP ${status} sin Location utilizable o demasiados redireccionamientos en ${targetUrl}`
                            ));
                            return;
                        }
                        // 303 siempre pasa a GET; 301/302 degradan POST a GET
                        // como hacen los navegadores; 307/308 conservan método.
                        let nextMethod = init.method ?? "GET";
                        if (status === 303 || ((status === 301 || status === 302) && nextMethod === "POST")) {
                            nextMethod = "GET";
                        }
                        const nextInit: RequestInit = {
                            method: nextMethod,
                            headers: init.headers,
                            signal: init.signal
                        };
                        if (nextMethod !== "GET" && typeof init.body === "string") nextInit.body = init.body;
                        doRequest(new URL(location, targetUrl).toString(), redirectsLeft - 1);
                        return;
                    }

                    const chunks: Buffer[] = [];
                    res.on("data", chunk => chunks.push(chunk as Buffer));
                    res.on("error", reject);
                    res.on("end", () => {
                        const headers = new Headers();
                        for (const [key, value] of Object.entries(res.headers)) {
                            if (Array.isArray(value)) headers.set(key, value.join(", "));
                            else if (value !== undefined) headers.set(key, value);
                        }
                        resolve(new Response(Buffer.concat(chunks), {
                            status,
                            statusText: res.statusMessage ?? "",
                            headers
                        }));
                    });
                });

                req.on("error", reject);

                if (init.signal) {
                    const signal = init.signal;
                    if (signal.aborted) {
                        req.destroy(abortError(signal));
                        return;
                    }
                    signal.addEventListener(
                        "abort",
                        () => req.destroy(abortError(signal)),
                        { once: true }
                    );
                }

                if (typeof init.body === "string") req.write(init.body);
                req.end();
            };

            doRequest(url, 5);

        });
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

        // TLS inseguro: por-petición tiene prioridad sobre el default del agente
        const insecure = req.insecureTls ?? this.insecureTls;

        logger.info(`HTTP ${method} ${ctx.request.url}`);

        let rawRes: globalThis.Response;

        try {
            rawRes = insecure
                ? await this.insecureFetch(ctx.request.url, fetchInit)
                : await fetch(ctx.request.url, fetchInit);
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
            // Fallo a nivel de red (DNS, conexión rechazada, TLS, ...): en vez
            // del opaco "fetch failed", se envuelve como HttpError con status 0
            // y la causa real en el mensaje (y en .cause para uso programático).
            const wrapped = createHttpError(
                `HTTP ${method} ${ctx.request.url} falló antes de recibir respuesta (${describeNetworkFailure(error)})`,
                0,
                {},
                null,
                ctx.request
            );
            (wrapped as { cause?: unknown }).cause = error;
            throw wrapped;
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
