import type { Context } from "./Context";
import type { ErrorMessageFormatter } from "./types";

interface ExecLikeError {
    command?: string;
    args?: string[];
    stderr?: string;
    message?: string;
}

function textOf(error: unknown): string {
    const execError = error as ExecLikeError;
    return execError?.stderr || execError?.message || String(error);
}

/**
 * Formateador de fábrica: prueba una lista de [regex, mensaje] contra el
 * stderr/mensaje del error y devuelve el mensaje personalizado del primer
 * patrón que matchee, en vez del stderr crudo.
 *
 * Ojo: esto NO distingue por comando — un mismo patrón (ej. "500 Internal
 * Server Error") aplica igual venga de `docker`, `kubectl` o `terraform`.
 * Si necesitas distinguir por comando (y opcionalmente por sub-comando),
 * usa `byRule` más abajo.
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

        const text = textOf(error);

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

/**
 * Una regla de `byRule`: TODAS las condiciones que definas deben cumplirse
 * (AND) para que aplique. Omitir una condición equivale a "no filtrar por
 * eso" (matchea cualquier valor).
 */
export interface MessageRule {
    /**
     * Comando exacto (o lista de comandos) que debe haber fallado, tal como
     * lo ve `shell.exec` (el primer argumento: "docker", "kubectl", "oc",
     * "terraform", "git", etc.). Sin esto, la regla no filtra por comando.
     */
    command?: string | string[];
    /**
     * Sub-comando / argumento que debe estar presente, por ejemplo "push"
     * para distinguir `docker push` de `docker build`. Puede ser un string
     * exacto (se busca entre los args, o como substring de los args unidos)
     * o un RegExp contra los args unidos con espacios.
     */
    args?: string | RegExp;
    /** Patrón contra el stderr/mensaje del error. Sin esto, no filtra por texto. */
    pattern?: RegExp;
    /** Mensaje final. Puede ser un string fijo o una función que lo arma dinámicamente. */
    message: string | ((error: unknown, ctx: Context) => string);
}

function commandMatches(rule: MessageRule, command: string | undefined): boolean {

    if (!rule.command) return true;
    if (!command) return false;

    const candidates = Array.isArray(rule.command) ? rule.command : [rule.command];

    return candidates.includes(command);

}

function argsMatch(rule: MessageRule, args: string[] | undefined): boolean {

    if (!rule.args) return true;
    if (!args || !args.length) return false;

    const joined = args.join(" ");

    if (rule.args instanceof RegExp) {
        return rule.args.test(joined);
    }

    return args.includes(rule.args) || joined.includes(rule.args);

}

function patternMatches(rule: MessageRule, text: string): boolean {

    if (!rule.pattern) return true;

    return rule.pattern.test(text);

}

/**
 * Formateador de fábrica avanzado: combina comando + sub-comando/args +
 * patrón de texto (todo opcional, en modo AND) para distinguir el MISMO
 * error de red/HTTP según de dónde vino. Resuelve justo el caso de "un 500
 * puede venir de docker push, de kubectl, o de terraform, y cada uno
 * necesita su propio mensaje".
 *
 * Se prueban las reglas en orden; gana la primera que matchee todas sus
 * condiciones. Una regla sin `command` ni `args` ni `pattern` matchea
 * cualquier error (útil como catch-all al final de la lista).
 *
 * Ejemplo — el caso concreto de varios comandos devolviendo el mismo 500:
 *
 *   notifier.describeError(messages.byRule([
 *       {
 *           command: "docker", args: "push", pattern: /500 Internal Server Error/,
 *           message: "Se ha reportado a infraestructura: falta de espacio en el registry"
 *       },
 *       {
 *           command: "kubectl", pattern: /500/,
 *           message: "El API server de Kubernetes devolvió 500, reintenta en unos minutos"
 *       },
 *       {
 *           command: "terraform", pattern: /500/,
 *           message: (error, ctx) => `El backend remoto de Terraform State no respondió (env: ${ctx.params.env ?? "?"})`
 *       },
 *       {
 *           pattern: /500 Internal Server Error/,
 *           message: "Error 500 no clasificado por comando, revisar logs crudos"
 *       }
 *   ]));
 */
export function byRule(rules: MessageRule[]): ErrorMessageFormatter {

    return (error: unknown, ctx: Context) => {

        const execError = error as ExecLikeError;
        const text = textOf(error);

        for (const rule of rules) {

            const matches = commandMatches(rule, execError?.command)
                && argsMatch(rule, execError?.args)
                && patternMatches(rule, text);

            if (matches) {
                return typeof rule.message === "function"
                    ? rule.message(error, ctx)
                    : rule.message;
            }

        }

        return undefined;

    };

}