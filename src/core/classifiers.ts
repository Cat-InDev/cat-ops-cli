import type { ErrorClassifier } from "./types";
import { ServiceError } from "./types";

interface ExecLikeError {
    command?: string;
    stdout?: string;
    stderr?: string;
    message?: string;
}

function unwrapExecLike(error: unknown): ExecLikeError {
    if (error instanceof ServiceError && error.cause) {
        return error.cause as ExecLikeError;
    }
    return error as ExecLikeError;
}

function unwrapText(error: unknown): string {
    if (error instanceof ServiceError && error.cause) {
        const cause = error.cause as ExecLikeError;
        return cause.stderr || cause.stdout || cause.message || String(error.cause);
    }
    const execError = error as ExecLikeError;
    return execError?.stderr || execError?.stdout || execError?.message || String(error);
}

/**
 * Clasificador de fábrica: mapea el comando que falló (el primer argumento
 * que le pasaste a shell.exec / docker.*, git.*, etc.) a un área de TI.
 *
 * Ejemplo:
 *   notifier.classify(classifiers.byCommand({
 *       docker: "containers",
 *       kubectl: "kubernetes",
 *       oc: "kubernetes",
 *       terraform: "infra",
 *       ansible: "infra",
 *       git: "scm",
 *       argocd: "cd-pipeline",
 *       tkn: "cd-pipeline",
 *       az: "cloud-azure"
 *   }));
 */
export function byCommand(map: Record<string, string>): ErrorClassifier {

    return (error: unknown) => {

        const execError = unwrapExecLike(error);
        const command = execError?.command;

        if (!command) return undefined;

        return map[command];

    };

}

/**
 * Clasificador de fábrica: prueba una lista de [regex, área] contra el
 * stderr (o stdout si stderr viene vacío) /mensaje del error y devuelve el
 * área del primer patrón que matchee.
 *
 * Ejemplo:
 *   notifier.classify(classifiers.byPattern([
 *       [/permission denied|unauthorized/i, "security"],
 *       [/timeout|ETIMEDOUT|ECONNREFUSED/i, "networking"],
 *       [/no space left|ENOSPC/i, "infra"]
 *   ]));
 */
export function byPattern(rules: Array<[RegExp, string]>): ErrorClassifier {

    return (error: unknown) => {

        const text = unwrapText(error);

        for (const [pattern, area] of rules) {
            if (pattern.test(text)) {
                return area;
            }
        }

        return undefined;

    };

}

/**
 * Clasificador de fábrica: mapea el nombre del servicio que falló a un área
 * de TI. Funciona con errores envueltos por `ctx.wrap()` (ServiceError) y
 * también con errores raw de `shell.exec` (via `byCommand` como fallback).
 *
 * Ejemplo:
 *   notifier.classify(classifiers.byService({
 *       docker: "containers",
 *       kubectl: "kubernetes",
 *       http: "networking"
 *   }));
 */
export function byService(map: Record<string, string>): ErrorClassifier {

    return (error: unknown) => {

        if (error instanceof ServiceError) {
            return map[error.service];
        }

        return undefined;

    };

}
