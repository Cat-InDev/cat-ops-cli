import type { HttpRequest } from "./http-types";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Cuerpo típico de error de la REST API de Azure DevOps. */
export interface AzdoErrorBody {
    message?: string;
    typeName?: string;
    typeKey?: string;
    errorCode?: number;
    eventId?: number;
    innerException?: AzdoErrorBody | null;
}

/** Detalle estructurado y legible de un error de Azure DevOps. */
export interface AzdoErrorDetail {
    /** Código HTTP (0 = error de red / timeout). */
    status: number;
    /** Texto del código HTTP ("Not Found", "Forbidden", ...). */
    statusLabel: string;
    /** Categoría legible: "Permisos", "No encontrado", "Conflicto", etc. */
    kind: string;
    /** Mensaje devuelto por el servidor (`body.message`). */
    serverMessage: string | null;
    /** Código TF/VS extraído del mensaje (ej. "TF401027", "VS800075"). */
    code: string | null;
    /** Resumen legible del código TF/VS si es conocido. */
    codeSummary: string | null;
    typeKey: string | null;
    typeName: string | null;
    errorCode: number | null;
    eventId: number | null;
    /** Mensajes de la cadena `innerException` aplanada. */
    innerMessages: string[];
    /**
     * Causa real de un fallo de conectividad (ej. "ENOTFOUND · getaddrinfo
     * dev.azure.com"), desenterrada de la cadena `cause` del fetch.
     */
    networkCause: string | null;
    method: string | null;
    url: string | null;
    /** Sugerencias accionables en español. */
    hints: string[];
    /** Cuerpo crudo tal cual llegó. */
    rawBody: unknown;
}

// ---------------------------------------------------------------------------
// Base de conocimiento
// ---------------------------------------------------------------------------

interface StatusInfo {
    label: string;
    kind: string;
    meaning: string;
    hints: string[];
}

const STATUS_INFO: Record<number, StatusInfo> = {
    0: {
        label: "Network Error",
        kind: "Red / Timeout",
        meaning: "La petición no llegó al servidor o expiró el timeout.",
        hints: [
            "Verifica conectividad y que la URL base de la organización sea correcta.",
            "Revisa proxies/firewall corporativos.",
            "Aumenta el timeout (exec.timeout) para operaciones pesadas."
        ]
    },
    400: {
        label: "Bad Request",
        kind: "Petición inválida",
        meaning: "El servidor rechazó el cuerpo o los parámetros de la petición.",
        hints: [
            "Revisa el body/query enviado: campos obligatorios, tipos y nombres.",
            "Prueba con otra api-version (algunos endpoints solo existen en previews).",
            "Si envías JSON, asegúrate de que el Content-Type sea application/json."
        ]
    },
    401: {
        label: "Unauthorized",
        kind: "Autenticación",
        meaning: "Las credenciales no son válidas o están ausentes.",
        hints: [
            "El PAT es inválido, expiró o fue revocado — genera uno nuevo.",
            "Verifica que el PAT pertenezca a la MISMA organización que baseUrl.",
            "Algunos endpoints requieren scopes adicionales en el PAT."
        ]
    },
    403: {
        label: "Forbidden",
        kind: "Permisos",
        meaning: "Autenticado, pero la cuenta no tiene permisos sobre el recurso.",
        hints: [
            "Pide al administrador los permisos necesarios sobre el proyecto/repo/pipeline.",
            "Si el PAT tiene restricciones de scope, amplíalo (ej. Code Read & Write, Build).",
            "Revisa políticas y grupos de seguridad del proyecto en Project Settings > Permissions."
        ]
    },
    404: {
        label: "Not Found",
        kind: "No encontrado",
        meaning: "El recurso no existe o no eres visible para él.",
        hints: [
            "Verifica el nombre/GUID del proyecto, repo, branch o ID usado.",
            "Azure DevOps devuelve 404 también por falta de permisos — valida acceso.",
            "Revisa que baseUrl apunte a la organización correcta."
        ]
    },
    405: {
        label: "Method Not Allowed",
        kind: "Método incorrecto",
        meaning: "El verbo HTTP no corresponde al endpoint.",
        hints: ["Consulta la doc del endpoint: algunos requieren POST/PATCH aunque parezcan lecturas."]
    },
    409: {
        label: "Conflict",
        kind: "Conflicto",
        meaning: "El estado actual del recurso choca con la operación.",
        hints: [
            "En push: el oldObjectId no coincide con el HEAD actual (alguien pusheó antes).",
            "Branch ya existente, edición concurrente o PR en estado incompatible.",
            "Vuelve a leer el recurso y reintenta con el valor fresco."
        ]
    },
    413: {
        label: "Payload Too Large",
        kind: "Payload demasiado grande",
        meaning: "El cuerpo enviado excede el límite del servidor.",
        hints: ["Divide el push en varios commits o reduce el tamaño del contenido."]
    },
    429: {
        label: "Too Many Requests",
        kind: "Rate limit",
        meaning: "Se superó el límite de peticiones (throttling).",
        hints: [
            "Espera y reintenta con backoff exponencial.",
            "Reduce llamadas en bucle usando filtros ($top) o cacheando respuestas."
        ]
    },
    500: {
        label: "Internal Server Error",
        kind: "Error del servidor",
        meaning: "Falla inesperada del lado de Azure DevOps.",
        hints: ["Reintenta más tarde; si persiste revisa status.dev.azure.com."]
    },
    502: {
        label: "Bad Gateway",
        kind: "Error del servidor",
        meaning: "Proxy/gateway intermedio reportó falla.",
        hints: ["Reintenta; suele ser transitorio."]
    },
    503: {
        label: "Service Unavailable",
        kind: "Servicio no disponible",
        meaning: "Mantenimiento o sobrecarga temporal.",
        hints: ["Reintenta con backoff; revisa status.dev.azure.com."]
    },
    504: {
        label: "Gateway Timeout",
        kind: "Timeout del servidor",
        meaning: "El gateway agotó la espera de respuesta.",
        hints: ["Reintenta; si ocurre en operaciones grandes, divídelas."]
    }
};

/** Códigos TF/VS conocidos → resumen + hint. Solo entradas verificables. */
const KNOWN_CODES: Record<string, { summary: string; hint: string }> = {
    TF400813: {
        summary: "Usuario anónimo/no autorizado para este recurso.",
        hint: "El PAT no es válido para esa organización (u org distinta). Verifica baseUrl vs. organización del PAT."
    },
    TF401019: {
        summary: "Objeto Git desconocido (repo, commit o ref inexistente o sin permisos).",
        hint: "Valida nombre/GUID del repo, commitId o ref. Un 404 disfrazado también indica falta de permisos."
    },
    TF401027: {
        summary: "Falta el permiso 'ForcePush' de Git.",
        hint: "Un admin debe conceder 'Force push (rewrite history)' en Repos > Security, o evita reescribir historial."
    },
    TF401320: {
        summary: "El proyecto no existe o no tienes acceso.",
        hint: "Verifica el nombre exacto del proyecto y tu membresía en algún grupo del mismo."
    },
    VS800075: {
        summary: "El proyecto no existe o no tienes acceso (nivel organización).",
        hint: "Verifica el proyecto contra GET /_apis/projects y tu acceso."
    },
    TF400324: {
        summary: "Error interno inesperado del servidor.",
        hint: "Reintenta; si persiste, revisa el estado del servicio o reporta con el eventId."
    },
    TF401349: {
        summary: "Operación bloqueada por una política o validación del servicio.",
        hint: "Revisa las políticas del repo/branch y las restricciones del pipeline."
    }
};

/** Reglas sobre typeKey/typeName/message para clasificar cuando no hay código conocido. */
const TYPE_RULES: Array<{ test: RegExp; kind: string; hint?: string }> = [
    { test: /notauthorized|unauthorized|securitypermission/i, kind: "Permisos", hint: "La cuenta autenticada carece de permisos para esta operación." },
    { test: /doesnotexist|notfound/i, kind: "No encontrado", hint: "Algún identificador (proyecto/repo/branch/ID) no existe o no es visible." },
    { test: /conflict|concurrency/i, kind: "Conflicto", hint: "Estado concurrente: vuelve a leer el recurso y reintenta." },
    { test: /validation|argument|invalid/i, kind: "Petición inválida", hint: "Revisa campos y formatos del body/query." },
    { test: /quota|limit|throttl/i, kind: "Límite alcanzado", hint: "Reduce la frecuencia de peticiones o el tamaño del payload." }
];

/** Códigos de error de red/TLS que pueden aparecer en la cadena `cause` del fetch. */
const NETWORK_CODES = new Set([
    "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPIPE",
    "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"
]);

/** Hint accionable por código de red. */
const NETWORK_HINTS: Record<string, string> = {
    ENOTFOUND: "El hostname no se pudo resolver (DNS): revisa que baseUrl apunte a la organización correcta y que haya resolución DNS/VPN activa.",
    EAI_AGAIN: "Fallo temporal de DNS: reintenta; si persiste, revisa los servidores DNS/VPN.",
    ECONNREFUSED: "Nada escuchó en host:puerto — verifica la URL base, el puerto y que no haya firewall bloqueando la salida.",
    ECONNRESET: "La conexión fue cortada a mitad de camino: típico de proxies corporativos o VPN inestable.",
    ETIMEDOUT: "El host no respondió a tiempo: revisa conectividad/latencia hacia dev.azure.com.",
    UND_ERR_CONNECT_TIMEOUT: "Timeout de conexión del fetch: revisa conectividad o aumenta el timeout.",
    CERT_HAS_EXPIRED: "El certificado TLS del servidor (o del proxy de inspección) está vencido.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "Certificado autofirmado interceptando el TLS: agrega la CA corporativa con NODE_EXTRA_CA_CERTS.",
    SELF_SIGNED_CERT_IN_CHAIN: "Cadena de certificados con CA autofirmada: agrega la CA corporativa con NODE_EXTRA_CA_CERTS.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "No se pudo verificar el certificado TLS: falta la CA raíz corporativa (NODE_EXTRA_CA_CERTS).",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "Falta la CA emisora en el almacén local: configura NODE_EXTRA_CA_CERTS con la CA corporativa.",
    ERR_TLS_CERT_ALTNAME_INVALID: "El certificado TLS no corresponde al hostname: puede haber un proxy inspeccionando el tráfico."
};

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const HTTP_STATUS_LABELS: Record<number, string> = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 406: "Not Acceptable", 408: "Request Timeout",
    409: "Conflict", 410: "Gone", 413: "Payload Too Large", 415: "Unsupported Media Type",
    422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
    503: "Service Unavailable", 504: "Gateway Timeout"
};

function statusLabel(status: number): string {
    return HTTP_STATUS_LABELS[status] ?? (status >= 500 ? "Server Error" : status >= 400 ? "Client Error" : "Unknown");
}

function extractAzdoCode(message: string): string | null {
    const m = /\b(?:TF|VS|DevTools|TFS)\d{4,7}\b/i.exec(message);
    return m ? m[0].toUpperCase() : null;
}

function flattenInner(body: AzdoErrorBody | undefined | null): string[] {
    const out: string[] = [];
    let cur = body?.innerException ?? null;
    const seen = new Set<unknown>();
    while (cur && typeof cur === "object" && !seen.has(cur)) {
        seen.add(cur);
        if (typeof cur.message === "string" && cur.message.trim()) out.push(cur.message.trim());
        cur = cur.innerException ?? null;
    }
    return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorBody(raw: unknown): AzdoErrorBody {
    if (isRecord(raw)) return raw as AzdoErrorBody;
    if (typeof raw === "string") {
        // Algunos proxies devuelven HTML/texto plano en lugar de JSON.
        const trimmed = raw.trim();
        if (!trimmed) return {};
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (isRecord(parsed)) return parsed as AzdoErrorBody;
        } catch {
            /* no era JSON — se usa como texto */
        }
        return { message: trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed };
    }
    return {};
}

function dedupe(items: Array<string | null | undefined>): string[] {
    return [...new Set(items.filter((i): i is string => !!i))];
}

/**
 * Recorre la cadena `cause` de un error (fetch/undici envuelven la causa real
 * ahí) y devuelve los códigos de red reconocidos + mensajes útiles.
 */
function collectNetworkFailure(err: unknown): { codes: string[]; messages: string[] } {
    const codes = new Set<string>();
    const messages: string[] = [];
    let cur: unknown = err;
    const seen = new Set<unknown>();
    while (cur && typeof cur === "object" && !seen.has(cur)) {
        seen.add(cur);
        const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
        if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) codes.add(e.code);
        if (typeof e.message === "string") {
            const m = e.message.trim();
            // Se ignoran los mensajes genéricos del wrapper de fetch
            if (m && m !== "fetch failed" && !messages.includes(m)) messages.push(m);
        }
        cur = e.cause;
    }
    return { codes: [...codes], messages };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Convierte un error capturado (el HttpError de HttpService u otro) en un
 * detalle estructurado y legible.
 *
 * Devuelve `null` si el error no tiene forma de error HTTP reconocible
 * (no tiene `status` numérico).
 */
export function parseAzdoError(err: unknown): AzdoErrorDetail | null {
    if (!isRecord(err) || typeof err.status !== "number") return null;

    const status: number = err.status;
    const info = STATUS_INFO[status];
    const body = readErrorBody(err.body);

    const serverMessage = typeof body.message === "string" && body.message.trim() ? body.message.trim() : null;
    const innerMessages = flattenInner(body);

    const code = serverMessage ? extractAzdoCode(serverMessage) : null;
    const known = code ? KNOWN_CODES[code] : undefined;

    const typeKey = typeof body.typeKey === "string" && body.typeKey ? body.typeKey : null;
    const typeName = typeof body.typeName === "string" && body.typeName ? body.typeName : null;
    const errorCode = typeof body.errorCode === "number" ? body.errorCode : null;
    const eventId = typeof body.eventId === "number" ? body.eventId : null;

    // --- causa de red (cadena `cause` del fetch) ---
    const network = collectNetworkFailure(err);
    // El mensaje del HttpError de red ya incluye la causa — se ignora para no duplicar
    const causeMessages = network.messages.filter(m => m !== (typeof err.message === "string" ? err.message : ""));
    const networkCause = network.codes.length || causeMessages.length
        ? dedupe([...network.codes, ...causeMessages]).join(" · ")
        : null;

    // --- clasificación: código conocido > reglas de tipo > status ---
    let kind = info?.kind ?? statusLabel(status);
    const haystack = `${typeKey ?? ""} ${typeName ?? ""} ${serverMessage ?? ""}`;
    for (const rule of TYPE_RULES) {
        if (rule.test.test(haystack)) { kind = rule.kind; break; }
    }

    // --- sugerencias ---
    const hints = dedupe([
        ...(known ? [known.hint] : []),
        ...innerMessages.map(m => {
            const c = extractAzdoCode(m);
            return c && KNOWN_CODES[c] ? KNOWN_CODES[c].hint : null;
        }),
        ...network.codes.map(c => NETWORK_HINTS[c] ?? null),
        ...(info?.hints ?? [])
    ]);

    const request = isRecord(err.request) ? err.request as unknown as HttpRequest : null;

    return {
        status,
        statusLabel: info?.label ?? statusLabel(status),
        kind,
        serverMessage,
        code,
        codeSummary: known?.summary ?? null,
        typeKey,
        typeName,
        errorCode,
        eventId,
        innerMessages,
        networkCause,
        method: request && typeof request.method === "string" ? request.method : null,
        url: request && typeof request.url === "string" ? request.url : null,
        hints,
        rawBody: err.body
    };
}

// ---------------------------------------------------------------------------
// Formatter — salida legible multi-línea
// ---------------------------------------------------------------------------

/**
 * Formatea un error de la API de Azure DevOps en un texto legible.
 * Acepta cualquier cosa; si no puede parsearlo, cae a String(input).
 */
export function formatAzdoError(input: unknown): string {
    const detail = input !== null && typeof input === "object" && "kind" in (input as object)
        ? input as AzdoErrorDetail
        : parseAzdoError(input);

    if (!detail) {
        return input instanceof Error ? input.message : String(input);
    }

    const lines: string[] = [];

    const target = detail.method && detail.url
        ? `${detail.method} ${shortenUrl(detail.url)}`
        : "(petición desconocida)";
    lines.push(`✖ Azure DevOps ${detail.kind.toLowerCase()} — HTTP ${detail.status} ${detail.statusLabel}`);
    lines.push(`  Petición : ${target}`);

    if (detail.serverMessage) {
        lines.push(`  Mensaje  : ${detail.serverMessage}`);
    }

    if (detail.networkCause) {
        lines.push(`  Causa    : ${detail.networkCause}`);
    }

    const meta: string[] = [];
    if (detail.code) meta.push(`código=${detail.code}`);
    if (detail.typeKey) {
        const shortType = detail.typeName ? shortenTypeName(detail.typeName) : null;
        const extra = shortType && shortType !== detail.typeKey ? ` (${shortType})` : "";
        meta.push(`tipo=${detail.typeKey}${extra}`);
    }
    if (detail.errorCode !== null) meta.push(`errorCode=${detail.errorCode}`);
    if (detail.eventId !== null) meta.push(`eventId=${detail.eventId}`);
    if (meta.length) {
        lines.push(`  Detalle  : ${meta.join(" · ")}`);
    }

    if (detail.codeSummary) {
        lines.push(`  Qué significa: ${detail.codeSummary}`);
    }

    if (detail.innerMessages.length) {
        lines.push("  Excepciones internas:");
        for (const im of detail.innerMessages) {
            lines.push(`    ↳ ${im}`);
        }
    }

    if (detail.hints.length) {
        lines.push("  Sugerencias:");
        for (const h of detail.hints) {
            lines.push(`    • ${h}`);
        }
    }

    return lines.join("\n");
}

/** Recorta query strings largas para mantener la salida compacta. */
function shortenUrl(url: string, max = 160): string {
    return url.length > max ? `${url.slice(0, max)}…` : url;
}

/** Quita el namespace largo de .NET: "Ns.FooException, Assembly" -> "FooException". */
function shortenTypeName(typeName: string): string {
    const withoutAssembly = typeName.split(",")[0].trim();
    const parts = withoutAssembly.split(".");
    return parts[parts.length - 1] || withoutAssembly;
}

/** Construye el mensaje de una línea para el Error (compacto pero informativo). */
function buildSummaryMessage(detail: AzdoErrorDetail): string {
    const parts: string[] = [];
    parts.push(detail.status === 0 ? "error de red" : `HTTP ${detail.status} ${detail.statusLabel}`);
    if (detail.method && detail.url) parts.push(`${detail.method} ${shortenUrl(detail.url, 100)}`);
    if (detail.serverMessage) parts.push(detail.serverMessage);
    else if (detail.networkCause) parts.push(detail.networkCause);
    else if (detail.codeSummary) parts.push(detail.codeSummary);
    return `[AZDO] ${parts.join(" — ")}`;
}

// ---------------------------------------------------------------------------
// AzdoApiError
// ---------------------------------------------------------------------------

/**
 * Error lanzado por AzureDevOpsApi con el detalle de Azure DevOps ya parseado.
 * Conserva `status`/`headers`/`body`/`request` del HttpError original, así que
 * los checks tipo `err.status === 404` siguen funcionando.
 */
export class AzdoApiError extends Error {

    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: unknown;
    readonly request?: HttpRequest;
    readonly detail: AzdoErrorDetail;

    constructor(
        detail: AzdoErrorDetail,
        source: Error & { headers?: Record<string, string>; body?: unknown; request?: HttpRequest }
    ) {
        super(buildSummaryMessage(detail));
        this.name = "AzdoApiError";
        this.status = detail.status;
        this.headers = source.headers ?? {};
        this.body = source.body;
        this.request = source.request;
        this.detail = detail;
        if (source.stack && source instanceof Error && source !== this) {
            this.stack = `${this.name}: ${this.message}\n    (causado por) ${source.stack}`;
        }
    }

    /** Representación legible multi-línea lista para loguear/mostrar al usuario. */
    toString(): string {
        return formatAzdoError(this.detail);
    }
}

/**
 * Envuelve un error capturado en `AzdoApiError` si es parseable;
 * devuelve el original intacto si no lo es.
 */
export function toAzdoApiError(err: unknown): unknown {
    const detail = parseAzdoError(err);
    if (detail && err instanceof Error) {
        return new AzdoApiError(detail, err as Error & { headers?: Record<string, string> });
    }
    return err;
}
