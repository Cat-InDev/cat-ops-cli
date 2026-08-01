import type { ErrorMessageFormatter } from "./types";

interface ExecLikeError {
    command?: string;
    stderr?: string;
    message?: string;
}

/**
 * Formateador de fábrica: prueba una lista de [regex, mensaje] contra el
 * stderr/mensaje del error y devuelve el mensaje personalizado del primer
 * patrón que matchee, en vez del stderr crudo.
 *
 * Ejemplo:
 *   notifier.describeError(messages.byPattern([
 *       [/500 Internal Server Error/, "Se reportó a infraestructura: falta de espacio en el registry"],
 *       [/unauthorized|403/i, "Credenciales inválidas contra el registry, revisa el secret"],
 *       [/no space left|ENOSPC/i, "El nodo se quedó sin espacio en disco"]
 *   ]));
 */
export function byPattern(rules: Array<[RegExp, string]>): ErrorMessageFormatter {

    return (error: unknown) => {

        const execError = error as ExecLikeError;
        const text = execError?.stderr || execError?.message || String(error);

        for (const [pattern, message] of rules) {
            if (pattern.test(text)) {
                return message;
            }
        }

        return undefined;

    };

}

/**
 * Formateador de fábrica: mapea el comando que falló (docker, kubectl,
 * terraform, etc.) a un mensaje genérico fijo, sin importar el detalle del
 * error. Útil como mensaje "catch-all" por comando cuando no necesitas
 * distinguir por patrón.
 *
 * Ejemplo:
 *   notifier.describeError(messages.byCommand({
 *       docker: "Falló un paso de Docker, revisa el build/push del registry"
 *   }));
 */
export function byCommand(map: Record<string, string>): ErrorMessageFormatter {

    return (error: unknown) => {

        const command = (error as ExecLikeError)?.command;

        if (!command) return undefined;

        return map[command];

    };

}