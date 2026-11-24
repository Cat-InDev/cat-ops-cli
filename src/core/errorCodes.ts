import { ServiceError } from "./types";

// ---------------------------------------------------------------------------
// Códigos de error para TODAS las tareas
//
// Formato: <DOMINIO>-<NNN>-<NOMBRE>, p. ej. "K8S-201-OOMKILLED",
// "GEN-001-EXEC", "APP-100-CONFIG". El número es estable (para ordenar y
// agrupar) y el sufijo describe el error de un vistazo.
//
// Resolución del código de un error (ver Notifier.resolveCode):
//   1. Resolvers registrados con `notifier.code(...)` (tu mapeo propio).
//   2. El código que ya trae el error (`err.code` / `err.errorCode` con este
//      formato): p. ej. los DeploymentRolloutError de kubectl/oc, o un
//      `CodedError` lanzado por tu task.
//   3. Un genérico según la forma del error (GEN-xxx).
// ---------------------------------------------------------------------------

/** Formato válido de un código: DOMINIO-NNN-NOMBRE. */
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*-\d{3}-[A-Z0-9]+$/;

export interface GenericErrorDefinition {
    code: string;
    title: string;
    hint: string;
}

/** Códigos genéricos por defecto, para errores que todavía no tienen un código propio. */
export const GENERIC_ERRORS = {
    UNKNOWN: {
        code: "GEN-000-UNKNOWN",
        title: "Error sin código asignado",
        hint: "Asignarle un código propio con `ctx.notifier.code(...)` o lanzar un `CodedError`."
    },
    EXEC: {
        code: "GEN-001-EXEC",
        title: "Un comando terminó con código de salida distinto de 0",
        hint: "Ver stderr/stdout del comando; mapearlo con `codes.byCommand` / `codes.byRule`."
    },
    EXEC_TIMEOUT: {
        code: "GEN-002-EXECTIMEOUT",
        title: "Un comando superó su `exec.timeout` y fue terminado",
        hint: "Aumentar `exec.timeout` o revisar por qué el comando se cuelga."
    }
} as const satisfies Record<string, GenericErrorDefinition>;

/**
 * Error con código propio. Lánzalo desde tus tasks para que el notifier lo
 * reporte con ese código sin necesidad de mapearlo:
 *   throw new CodedError("APP-100-CONFIG", "Falta la variable DB_URL");
 */
export class CodedError extends Error {

    readonly code: string;
    readonly details?: unknown;

    constructor(code: string, message: string, details?: unknown) {
        if (!ERROR_CODE_PATTERN.test(code)) {
            throw new Error(`CodedError: código inválido "${code}" (formato esperado DOMINIO-NNN-NOMBRE, p. ej. APP-100-CONFIG)`);
        }
        super(message);
        this.name = "CodedError";
        this.code = code;
        this.details = details;
    }

}

export function isErrorCode(value: unknown): value is string {
    return typeof value === "string" && ERROR_CODE_PATTERN.test(value);
}

/** El error original: desenvuelve `ServiceError` (ctx.wrap) para mirar su `cause`. */
export function unwrapError(error: unknown): unknown {
    return error instanceof ServiceError && error.cause !== undefined ? error.cause : error;
}

function ownCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return undefined;
    const candidate = error as { code?: unknown; errorCode?: unknown };
    if (isErrorCode(candidate.errorCode)) return candidate.errorCode;
    if (isErrorCode(candidate.code)) return candidate.code;
    return undefined;
}

function isExecResult(error: unknown): error is { code: number | null; stderr: string; timedOut?: boolean } {
    return Boolean(error) && typeof error === "object" && "stderr" in (error as object) && "stdout" in (error as object);
}

/** Código propio del error (o de su `cause`), o el genérico que le corresponde. */
export function builtInErrorCode(error: unknown): string {

    const code = ownCode(error) ?? ownCode(unwrapError(error));
    if (code) return code;

    const inner = unwrapError(error);

    if (isExecResult(inner)) {
        return inner.timedOut ? GENERIC_ERRORS.EXEC_TIMEOUT.code : GENERIC_ERRORS.EXEC.code;
    }

    return GENERIC_ERRORS.UNKNOWN.code;

}

/** Una causa secundaria con código (p. ej. las K8S-2xx de un rollout). */
export interface ErrorCauseLike {
    code: string;
    detail?: string;
    pod?: string;
    container?: string;
    [key: string]: unknown;
}

/**
 * Causas secundarias que trae el error: `err.causes` y, en errores de grupo,
 * las de cada `err.failed[]`. Sin duplicados (código + pod).
 */
export function errorCauses(error: unknown): ErrorCauseLike[] {

    const inner = unwrapError(error) as { causes?: unknown; failed?: unknown } | undefined;
    if (!inner || typeof inner !== "object") return [];

    const list: ErrorCauseLike[] = [];
    const seen = new Set<string>();

    const push = (items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
            if (!item || typeof item !== "object" || !isErrorCode((item as ErrorCauseLike).code)) continue;
            const cause = item as ErrorCauseLike;
            const id = `${cause.code}|${cause.pod ?? ""}`;
            if (seen.has(id)) continue;
            seen.add(id);
            list.push(cause);
        }
    };

    push(inner.causes);

    if (Array.isArray(inner.failed)) {
        for (const failure of inner.failed) push((failure as { causes?: unknown })?.causes);
    }

    return list;

}

/** Patrón para matchear códigos: exacto, glob con `*` ("K8S-2*"), RegExp o lista de ellos. */
export type ErrorCodeMatcher = string | RegExp | Array<string | RegExp>;

function globToRegExp(glob: string): RegExp {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
}

export function codeMatches(matcher: ErrorCodeMatcher, code: string): boolean {

    if (Array.isArray(matcher)) return matcher.some(item => codeMatches(item, code));
    if (matcher instanceof RegExp) return matcher.test(code);
    if (matcher.includes("*")) return globToRegExp(matcher).test(code);

    return matcher === code;

}
