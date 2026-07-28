import type { ErrorClassifier } from "./types";

interface ExecLikeError {
    command?: string;
    stderr?: string;
    message?: string;
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

        const command = (error as ExecLikeError)?.command;

        if (!command) return undefined;

        return map[command];

    };

}

/**
 * Clasificador de fábrica: prueba una lista de [regex, área] contra el
 * stderr/mensaje del error y devuelve el área del primer patrón que matchee.
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

        const execError = error as ExecLikeError;
        const text = execError?.stderr || execError?.message || String(error);

        for (const [pattern, area] of rules) {
            if (pattern.test(text)) {
                return area;
            }
        }

        return undefined;

    };

}
