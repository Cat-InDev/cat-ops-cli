import { shell } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

// ---------------------------------------------------------------------------
// Opciones globales: --kubeconfig, -n/--namespace, y exec (retry/timeout/dryRun)
// en todos los comandos
// ---------------------------------------------------------------------------

export interface KubectlOptions {
    /** Ruta al archivo kubeconfig. Se pasa como --kubeconfig <path>. */
    kubeconfig?: string;
    /** Namespace destino. Se pasa como -n <namespace>. */
    namespace?: string;
    /** retry/timeout/dryRun para esta llamada puntual (ver shell.exec). */
    exec?: ExecOptions;
}

function isKubectlOptions(value: unknown): value is KubectlOptions {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value)
        && ("kubeconfig" in (value as object) || "namespace" in (value as object) || "exec" in (value as object) || Object.keys(value as object).length === 0);
}

function withGlobalFlags(args: string[], options: KubectlOptions = {}): string[] {

    const result = [...args];

    if (options.kubeconfig) {
        result.push("--kubeconfig", options.kubeconfig);
    }

    if (options.namespace) {
        result.push("-n", options.namespace);
    }

    return result;

}

/** Arma los args finales para shell.exec: flags (--kubeconfig/-n) + el objeto exec al final, si se pasó. */
function toExecArgs(args: string[], options: KubectlOptions = {}): Array<string | ExecOptions> {

    const withFlags = withGlobalFlags(args, options);

    return options.exec ? [...withFlags, options.exec] : withFlags;

}

export function apply(file: string, options: KubectlOptions = {}): Promise<ExecResult> {
    return shell.exec("kubectl", ...toExecArgs(["apply", "-f", file], options));
}

export function del(file: string, options: KubectlOptions = {}): Promise<ExecResult> {
    return shell.exec("kubectl", ...toExecArgs(["delete", "-f", file], options));
}

/**
 * Igual que antes (`kubectl.get("pods", "-o", "wide")`), pero ahora también
 * acepta KubectlOptions como último argumento:
 *   kubectl.get("pods", "-o", "wide", { namespace: "prod", exec: { retry: 3 } })
 */
export function get(...rawArgs: Array<string | KubectlOptions>): Promise<ExecResult> {

    let args = rawArgs as string[];
    let options: KubectlOptions = {};

    const last = rawArgs[rawArgs.length - 1];

    if (rawArgs.length && isKubectlOptions(last)) {
        options = last as KubectlOptions;
        args = rawArgs.slice(0, -1) as string[];
    }

    return shell.exec("kubectl", "get", ...toExecArgs(args, options));

}

export function logs(pod: string, options: KubectlOptions = {}): Promise<ExecResult> {
    return shell.exec("kubectl", ...toExecArgs(["logs", pod], options));
}

export function rolloutStatus(deployment: string, options: KubectlOptions = {}): Promise<ExecResult> {
    return shell.exec("kubectl", ...toExecArgs(["rollout", "status", deployment], options));
}

export function setImage(resource: string, image: string, options: KubectlOptions = {}): Promise<ExecResult> {
    return shell.exec("kubectl", ...toExecArgs(["set", "image", resource, image], options));
}

export { del as delete };

// ---------------------------------------------------------------------------
// waitForDeployment — validación cíclica del rollout de un Deployment
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface DeploymentConditionJSON {
    type: string;
    status: string;
    reason?: string;
    message?: string;
}

interface DeploymentJSON {
    spec?: {
        replicas?: number;
        selector?: { matchLabels?: Record<string, string> };
    };
    status?: {
        replicas?: number;
        readyReplicas?: number;
        updatedReplicas?: number;
        unavailableReplicas?: number;
        conditions?: DeploymentConditionJSON[];
    };
}

export type DeploymentRolloutStatus = "success" | "failed" | "timeout";

export interface DeploymentWatchResult {
    status: DeploymentRolloutStatus;
    deployment: string;
    elapsedMs: number;
    restarts: number;
    message: string;
}

/**
 * Se lanza cuando `waitForDeployment` no llega a un rollout exitoso, ya sea
 * por timeout global, por quedarse en estado Failed sin recuperarse, o por
 * superar el máximo de reinicios permitido. Lleva `command: "kubectl"` para
 * que `classifiers.byCommand({ kubectl: "kubernetes" })` lo clasifique
 * automáticamente si usas el sistema de notificaciones.
 */
export class DeploymentRolloutError extends Error {

    readonly command = "kubectl";
    readonly status: DeploymentRolloutStatus;
    readonly deployment: string;
    readonly elapsedMs: number;
    readonly restarts: number;

    constructor(message: string, info: Omit<DeploymentWatchResult, "message">) {
        super(message);
        this.name = "DeploymentRolloutError";
        this.status = info.status;
        this.deployment = info.deployment;
        this.elapsedMs = info.elapsedMs;
        this.restarts = info.restarts;
    }

}

export interface WaitForDeploymentOptions extends KubectlOptions {
    /** Nombre del deployment, sin el prefijo "deployment/". */
    deployment: string;
    /** Milisegundos totales antes de abortar y reportar error. Default: 300000 (5 min). */
    timeout?: number;
    /** Milisegundos entre cada chequeo. Default: 5000. */
    pollInterval?: number;
    /**
     * Si el deployment entra en estado Failed, milisegundos a esperar para
     * ver si se recupera solo antes de darlo por fallido. Default: igual a
     * `pollInterval` * 6 (30s con los defaults).
     */
    failedGracePeriod?: number;
    /**
     * Máximo de reinicios (sumados entre todos los pods/containers del
     * deployment) tolerados antes de abortar inmediatamente, sin esperar
     * el `failedGracePeriod` ni el `timeout`. Si no se pasa, no se valida.
     */
    maxRestarts?: number;
}

async function readDeploymentJSON(name: string, options: KubectlOptions): Promise<DeploymentJSON> {
    const result = await get(`deployment/${name}`, "-o", "json", options);
    return JSON.parse(result.stdout) as DeploymentJSON;
}

async function countPodRestarts(matchLabels: Record<string, string> | undefined, options: KubectlOptions): Promise<number> {

    if (!matchLabels || !Object.keys(matchLabels).length) {
        return 0;
    }

    const selector = Object.entries(matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

    const result = await get("pods", "-l", selector, "-o", "json", options);

    const parsed = JSON.parse(result.stdout) as {
        items?: Array<{ status?: { containerStatuses?: Array<{ restartCount?: number }> } }>;
    };

    return (parsed.items ?? []).reduce((total, pod) => {
        const podRestarts = (pod.status?.containerStatuses ?? [])
            .reduce((sum, container) => sum + (container.restartCount ?? 0), 0);
        return total + podRestarts;
    }, 0);

}

function isProgressingFailed(conditions: DeploymentConditionJSON[]): boolean {

    const progressing = conditions.find(c => c.type === "Progressing");

    if (progressing?.status === "False") return true;

    return conditions.some(c => c.type === "ReplicaFailure" && c.status === "True");

}

/**
 * Valida cíclicamente el estado de un Deployment hasta que:
 *   - llega a estado exitoso (replicas listas/actualizadas == replicas deseadas) -> resuelve,
 *   - supera `maxRestarts` reinicios acumulados -> lanza DeploymentRolloutError,
 *   - se queda en estado Failed más de `failedGracePeriod` sin recuperarse -> lanza DeploymentRolloutError,
 *   - o se cumple `timeout` sin éxito -> lanza DeploymentRolloutError.
 *
 * En cualquier caso de error, el polling se detiene ("se mata el proceso")
 * y el error se re-lanza, listo para que `ctx.run(...)` lo capture y lo
 * reporte vía `ctx.notifier` si lo tienes configurado.
 */
export async function waitForDeployment(options: WaitForDeploymentOptions): Promise<DeploymentWatchResult> {

    const {
        deployment,
        timeout = 300_000,
        pollInterval = 5_000,
        failedGracePeriod = pollInterval * 6,
        maxRestarts,
        ...kubectlOptions
    } = options;

    const startedAt = Date.now();
    let failedSince: number | null = null;

    while (true) {

        const elapsedMs = Date.now() - startedAt;

        if (elapsedMs >= timeout) {
            const message = `Timeout esperando el rollout de "${deployment}" (${timeout}ms)`;
            throw new DeploymentRolloutError(message, { status: "timeout", deployment, elapsedMs, restarts: -1 });
        }

        let json: DeploymentJSON;

        try {
            json = await readDeploymentJSON(deployment, kubectlOptions);
        } catch {
            // El recurso puede no existir todavía (justo después de un apply); reintenta.
            await sleep(pollInterval);
            continue;
        }

        const desired = json.spec?.replicas ?? 1;
        const ready = json.status?.readyReplicas ?? 0;
        const updated = json.status?.updatedReplicas ?? 0;
        const conditions = json.status?.conditions ?? [];
        const failed = isProgressingFailed(conditions);
        const success = !failed && ready >= desired && updated >= desired;

        let restarts = 0;

        if (maxRestarts !== undefined) {

            restarts = await countPodRestarts(json.spec?.selector?.matchLabels, kubectlOptions);

            if (restarts > maxRestarts) {
                const message = `Deployment "${deployment}" superó el máximo de reinicios permitido (${restarts} > ${maxRestarts})`;
                throw new DeploymentRolloutError(message, { status: "failed", deployment, elapsedMs, restarts });
            }

        }

        if (success) {
            const message = `Deployment "${deployment}" alcanzó el estado esperado (${ready}/${desired} listas)`;
            return { status: "success", deployment, elapsedMs, restarts, message };
        }

        if (failed) {

            if (failedSince === null) {
                failedSince = Date.now();
            } else if (Date.now() - failedSince >= failedGracePeriod) {
                const message = `Deployment "${deployment}" quedó en estado Failed y no se recuperó en ${failedGracePeriod}ms`;
                throw new DeploymentRolloutError(message, { status: "failed", deployment, elapsedMs, restarts });
            }

        } else {
            failedSince = null;
        }

        await sleep(pollInterval);

    }

}

// ---------------------------------------------------------------------------
// waitForDeploymentGroup — valida TODAS las instancias de un mismo despliegue
// GitOps (varios Deployments del mismo repo con distinta config, agrupados
// por un label común, p. ej. "deployment-group=repository-14").
// ---------------------------------------------------------------------------

export type DeploymentGroupStatus = "success" | "failed" | "timeout";

export interface DeploymentGroupFailure {
    deployment: string;
    status: DeploymentRolloutStatus;
    message: string;
}

export interface DeploymentGroupWatchResult {
    status: "success";
    label: string;
    elapsedMs: number;
    deployments: DeploymentWatchResult[];
    message: string;
}

/**
 * Se lanza cuando `waitForDeploymentGroup` no logra que TODAS las instancias
 * del grupo lleguen a estado exitoso. Lleva `command: "kubectl"` para que
 * `classifiers.byCommand({ kubectl: "kubernetes" })` lo clasifique solo.
 */
export class DeploymentGroupRolloutError extends Error {

    readonly command = "kubectl";
    readonly label: string;
    readonly elapsedMs: number;
    readonly succeeded: string[];
    readonly failed: DeploymentGroupFailure[];

    constructor(message: string, info: { label: string; elapsedMs: number; succeeded: string[]; failed: DeploymentGroupFailure[] }) {
        super(message);
        this.name = "DeploymentGroupRolloutError";
        this.label = info.label;
        this.elapsedMs = info.elapsedMs;
        this.succeeded = info.succeeded;
        this.failed = info.failed;
    }

}

export interface WaitForDeploymentGroupOptions extends KubectlOptions {
    /**
     * Label que agrupa todas las instancias del despliegue. Puede ser el
     * selector ya armado ("deployment-group=repository-14") o un objeto
     * ({ "deployment-group": "repository-14" }).
     */
    label: string | Record<string, string>;
    /** Milisegundos totales antes de abortar el grupo entero. Default: 300000 (5 min). */
    timeout?: number;
    /** Milisegundos entre cada chequeo, por instancia. Default: 5000. */
    pollInterval?: number;
    /** Igual que en waitForDeployment, aplicado a cada instancia del grupo. */
    failedGracePeriod?: number;
    /** Igual que en waitForDeployment, aplicado a cada instancia del grupo. */
    maxRestarts?: number;
}

function toSelectorString(label: string | Record<string, string>): string {

    if (typeof label === "string") return label;

    return Object.entries(label)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

}

async function listDeploymentNames(selector: string, options: KubectlOptions): Promise<string[]> {

    const result = await get("deployments", "-l", selector, "-o", "json", options);

    const parsed = JSON.parse(result.stdout) as {
        items?: Array<{ metadata?: { name?: string } }>;
    };

    return (parsed.items ?? [])
        .map(item => item.metadata?.name)
        .filter((name): name is string => Boolean(name));

}

/**
 * Descubre todos los Deployments que compartan el `label` dado (p. ej.
 * todas las instancias GitOps de un mismo repo, marcadas con
 * `deployment-group: repository-14`) y espera a que TODAS lleguen a estado
 * exitoso, corriendo `waitForDeployment` por cada una en paralelo con el
 * mismo `timeout` global.
 *
 * Si alguna instancia falla (timeout individual, Failed sin recuperarse, o
 * maxRestarts superado), se espera a que terminen las demás y se lanza
 * `DeploymentGroupRolloutError` con el detalle de cuáles fallaron y cuáles sí
 * llegaron a estado exitoso — listo para que `ctx.run(...)` lo capture y lo
 * reporte vía `ctx.notifier`.
 */
export async function waitForDeploymentGroup(options: WaitForDeploymentGroupOptions): Promise<DeploymentGroupWatchResult> {

    const {
        label,
        timeout = 300_000,
        pollInterval = 5_000,
        failedGracePeriod = pollInterval * 6,
        maxRestarts,
        ...kubectlOptions
    } = options;

    const selector = toSelectorString(label);
    const startedAt = Date.now();

    const names = await listDeploymentNames(selector, kubectlOptions);

    if (!names.length) {
        const message = `No se encontraron deployments con el label "${selector}"`;
        throw new DeploymentGroupRolloutError(message, {
            label: selector,
            elapsedMs: Date.now() - startedAt,
            succeeded: [],
            failed: []
        });
    }

    const remainingMs = () => Math.max(0, timeout - (Date.now() - startedAt));

    const settled = await Promise.allSettled(
        names.map(deployment => waitForDeployment({
            deployment,
            timeout: remainingMs(),
            pollInterval,
            failedGracePeriod,
            maxRestarts,
            ...kubectlOptions
        }))
    );

    const succeeded: string[] = [];
    const failed: DeploymentGroupFailure[] = [];
    const deployments: DeploymentWatchResult[] = [];

    settled.forEach((outcome, index) => {

        const name = names[index];

        if (outcome.status === "fulfilled") {
            succeeded.push(name);
            deployments.push(outcome.value);
            return;
        }

        const reason = outcome.reason as Partial<DeploymentRolloutError>;

        failed.push({
            deployment: name,
            status: reason?.status ?? "failed",
            message: reason?.message ?? String(outcome.reason)
        });

    });

    const elapsedMs = Date.now() - startedAt;

    if (failed.length) {

        const summary = failed.map(f => `${f.deployment} (${f.status})`).join(", ");
        const message = `${failed.length}/${names.length} deployments del grupo "${selector}" no llegaron a estado exitoso: ${summary}`;

        throw new DeploymentGroupRolloutError(message, { label: selector, elapsedMs, succeeded, failed });

    }

    const message = `Los ${names.length} deployments del grupo "${selector}" alcanzaron el estado esperado`;

    return { status: "success", label: selector, elapsedMs, deployments, message };

}
