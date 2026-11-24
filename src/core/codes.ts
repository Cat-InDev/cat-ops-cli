import type { ErrorCodeResolver } from "./types";
import { ServiceError } from "./types";
import { isErrorCode } from "./errorCodes";
import { matchesErrorRule, textOf, unwrapExecLike } from "./messages";
import type { ErrorRuleConditions } from "./messages";

// ---------------------------------------------------------------------------
// Fábricas de resolvers de código: asignan un código propio (DOMINIO-NNN-
// NOMBRE) a errores que hoy salen con un genérico (GEN-xxx). Se registran con
// `ctx.notifier.code(...)` y se prueban en orden; gana el primero que matchee.
// ---------------------------------------------------------------------------

function assertCode(code: string): string {
    if (!isErrorCode(code)) {
        throw new Error(`Código de error inválido "${code}" (formato esperado DOMINIO-NNN-NOMBRE, p. ej. DOCKER-100-PUSH)`);
    }
    return code;
}

/**
 * Código según el texto del error (stderr, o stdout si stderr viene vacío,
 * o message). Desenvuelve `ServiceError`.
 *
 *   notifier.code(codes.byPattern([
 *       [/no space left|ENOSPC/i, "INFRA-100-NOSPACE"],
 *       [/unauthorized|403/i, "SEC-100-UNAUTHORIZED"]
 *   ]));
 */
export function byPattern(rules: Array<[RegExp, string]>): ErrorCodeResolver {

    rules.forEach(([, code]) => assertCode(code));

    return (error: unknown) => {
        const text = textOf(error);
        return rules.find(([pattern]) => pattern.test(text))?.[1];
    };

}

/**
 * Código fijo por comando que falló (el primer argumento de `shell.exec`).
 *
 *   notifier.code(codes.byCommand({ docker: "DOCKER-000-EXEC", terraform: "TF-000-EXEC" }));
 */
export function byCommand(map: Record<string, string>): ErrorCodeResolver {

    Object.values(map).forEach(assertCode);

    return (error: unknown) => {
        const command = unwrapExecLike(error)?.command;
        return command ? map[command] : undefined;
    };

}

/** Código fijo por servicio envuelto con `ctx.wrap()` (ServiceError). */
export function byService(map: Record<string, string>): ErrorCodeResolver {

    Object.values(map).forEach(assertCode);

    return (error: unknown) => error instanceof ServiceError ? map[error.service] : undefined;

}

export interface CodeRule extends ErrorRuleConditions {
    /** Código a asignar si se cumplen todas las condiciones. */
    code: string;
}

/**
 * Lo mismo que `messages.byRule` pero asignando un código: comando + args +
 * patrón, en modo AND (las condiciones omitidas no filtran).
 *
 *   notifier.code(codes.byRule([
 *       { command: "docker", args: "push", pattern: /500/, code: "DOCKER-101-PUSH500" },
 *       { command: "docker", args: "build", code: "DOCKER-102-BUILD" },
 *       { command: "git", pattern: /CONFLICT/, code: "GIT-100-CONFLICT" }
 *   ]));
 */
export function byRule(rules: CodeRule[]): ErrorCodeResolver {

    rules.forEach(rule => assertCode(rule.code));

    return (error: unknown) => rules.find(rule => matchesErrorRule(rule, error))?.code;

}
