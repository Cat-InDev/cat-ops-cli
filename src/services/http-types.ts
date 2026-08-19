import type { ExecOptions } from "../core/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface HttpRequest {
    url: string;
    method?: HttpMethod;
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    timeout?: number;
    exec?: ExecOptions;
}

export interface HttpResponse<T = unknown> {
    status: number;
    headers: Record<string, string>;
    body: T;
    request: HttpRequest;
}

export interface HttpError<T = unknown> extends Error {
    status: number;
    headers: Record<string, string>;
    body: T;
    request: HttpRequest;
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

export interface RequestContext {
    request: HttpRequest;
    /** Permite abortar la cadena de interceptores y la petición. */
    abort: (reason?: string) => void;
    aborted: boolean;
    abortReason?: string;
}

export interface ResponseContext<T = unknown> {
    response: HttpResponse<T>;
    request: HttpRequest;
}

/**
 * Interceptor de request: se ejecuta ANTES de enviar la petición.
 * Puede mutar el request (agregar headers, auth, logging, etc.).
 * Si aborta, no se envía la petición y se lanza un error.
 */
export type RequestInterceptor = (ctx: RequestContext) => void | Promise<void>;

/**
 * Interceptor de response: se ejecuta DESPUÉS de recibir la respuesta.
 * Puede mutar la respuesta (transformar datos, logging, retry, etc.).
 */
export type ResponseInterceptor<T = unknown> = (ctx: ResponseContext<T>) => void | Promise<void>;

// ---------------------------------------------------------------------------
// HttpService config
// ---------------------------------------------------------------------------

export interface HttpServiceConfig {
    /** URL base que se antepone a todas las peticiones relativas. */
    baseUrl?: string;
    /** Headers por defecto que se envían en todas las peticiones. */
    defaultHeaders?: Record<string, string>;
    /** Timeout por defecto en ms (0 = sin límite). */
    defaultTimeout?: number;
    /** Interceptors de request que se ejecutan antes de cada petición. */
    requestInterceptors?: RequestInterceptor[];
    /** Interceptors de response que se ejecutan después de cada respuesta. */
    responseInterceptors?: ResponseInterceptor[];
}
