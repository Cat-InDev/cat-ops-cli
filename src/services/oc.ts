import { shell } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

// ---------------------------------------------------------------------------
// Opciones globales: --kubeconfig, -n/--namespace, y exec (retry/timeout/dryRun)
// en todos los comandos
// ---------------------------------------------------------------------------

export interface OcOptions {
    /** Ruta al archivo kubeconfig. Se pasa como --kubeconfig <path>. */
    kubeconfig?: string;
    /** Namespace/proyecto destino. Se pasa como -n <namespace>. */
    namespace?: string;
    /** retry/timeout/dryRun para esta llamada puntual (ver shell.exec). */
    exec?: ExecOptions;
}

function isOcOptions(value: unknown): value is OcOptions {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value)
        && ("kubeconfig" in (value as object) || "namespace" in (value as object) || "exec" in (value as object) || Object.keys(value as object).length === 0);
}

function withGlobalFlags(args: string[], options: OcOptions = {}): string[] {

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
function toExecArgs(args: string[], options: OcOptions = {}): Array<string | ExecOptions> {

    const withFlags = withGlobalFlags(args, options);

    return options.exec ? [...withFlags, options.exec] : withFlags;

}

export interface OcLoginOptions extends OcOptions {
    server: string;
    token?: string;
    username?: string;
    password?: string;
    insecureSkipTlsVerify?: boolean;
}

export interface OcStartBuildOptions extends OcOptions {
    follow?: boolean;
}

/**
 * Ejemplo — 10 reintentos ante un login inestable:
 *   await ctx.services.oc.login({
 *       server: "https://api.cluster:6443",
 *       token: process.env.OC_TOKEN,
 *       exec: { retry: 10, retryDelay: 2000 }
 *   });
 */
export function login({ server, token, username, password, insecureSkipTlsVerify = false, ...options }: OcLoginOptions): Promise<ExecResult> {

    const args = ["login", server];

    if (token) {
        args.push("--token", token);
    } else {
        args.push("-u", username ?? "", "-p", password ?? "");
    }

    if (insecureSkipTlsVerify) {
        args.push("--insecure-skip-tls-verify");
    }

    return shell.exec("oc", ...toExecArgs(args, options));

}

export function project(name: string, options: OcOptions = {}): Promise<ExecResult> {
    return shell.exec("oc", ...toExecArgs(["project", name], options));
}

export function apply(file: string, options: OcOptions = {}): Promise<ExecResult> {
    return shell.exec("oc", ...toExecArgs(["apply", "-f", file], options));
}

/**
 * Igual que antes (`oc.get("pods", "-o", "wide")`), pero ahora también
 * acepta OcOptions como último argumento:
 *   oc.get("pods", "-o", "wide", { namespace: "prod", exec: { retry: 3 } })
 */
export function get(...rawArgs: Array<string | OcOptions>): Promise<ExecResult> {

    let args = rawArgs as string[];
    let options: OcOptions = {};

    const last = rawArgs[rawArgs.length - 1];

    if (rawArgs.length && isOcOptions(last)) {
        options = last as OcOptions;
        args = rawArgs.slice(0, -1) as string[];
    }

    return shell.exec("oc", "get", ...toExecArgs(args, options));

}

export function rollout(deployment: string, options: OcOptions = {}): Promise<ExecResult> {
    return shell.exec("oc", ...toExecArgs(["rollout", "status", `dc/${deployment}`], options));
}

export function newApp(...args: string[]): Promise<ExecResult> {
    return shell.exec("oc", "new-app", ...args);
}

export function startBuild(buildConfig: string, { follow = true, ...options }: OcStartBuildOptions = {}): Promise<ExecResult> {

    const args = ["start-build", buildConfig];

    if (follow) {
        args.push("-F");
    }

    return shell.exec("oc", ...toExecArgs(args, options));

}

export function logs(pod: string, options: OcOptions = {}): Promise<ExecResult> {
    return shell.exec("oc", ...toExecArgs(["logs", pod], options));
}

// ---------------------------------------------------------------------------
// waitForDeployment — validación cíclica del rollout, para Deployment (k8s
// nativo) o DeploymentConfig (OpenShift clásico).
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface OcConditionJSON {
    type: string;
    status: string;
    reason?: string;
    message?: string;
}

interface OcWorkloadJSON {
    spec?: {
        replicas?: number;
        selector?: { matchLabels?: Record<string, string> } | Record<string, string>;
    };
    status?: {
        replicas?: number;
        readyReplicas?: number;
        availableReplicas?: number;
        updatedReplicas?: number;
        conditions?: OcConditionJSON[];
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
 * Se lanza cuando `waitForDeployment` no llega a un rollout exitoso. Lleva
 * `command: "oc"` para que `classifiers.byCommand({ oc: "kubernetes" })`
 * lo clasifique automáticamente si usas el sistema de notificaciones.
 */
export class DeploymentRolloutError extends Error {

    readonly command = "oc";
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

export interface WaitForDeploymentOptions extends OcOptions {
    /** Nombre del deployment/deploymentconfig, sin prefijo de recurso. */
    deployment: string;
    /** "deployment" (k8s nativo, default) o "dc" (DeploymentConfig clásico de OpenShift). */
    resourceType?: "deployment" | "dc";
    /** Milisegundos totales antes de abortar y reportar error. Default: 300000 (5 min). */
    timeout?: number;
    /** Milisegundos entre cada chequeo. Default: 5000. */
    pollInterval?: number;
    /**
     * Si el recurso entra en estado Failed, milisegundos a esperar para ver
     * si se recupera solo antes de darlo por fallido. Default: `pollInterval * 6`.
     */
    failedGracePeriod?: number;
    /**
     * Máximo de reinicios (sumados entre todos los pods/containers) tolerados
     * antes de abortar inmediatamente. Si no se pasa, no se valida.
     */
    maxRestarts?: number;
}

type SelectorLike = { matchLabels?: Record<string, string> } | Record<string, string> | undefined;

function matchLabelsOf(selector: SelectorLike): Record<string, string> | undefined {

    if (!selector) return undefined;

    if ("matchLabels" in selector) {
        return (selector as { matchLabels?: Record<string, string> }).matchLabels;
    }

    return selector as Record<string, string>;

}

async function readWorkloadJSON(resourceType: "deployment" | "dc", name: string, options: OcOptions): Promise<OcWorkloadJSON> {
    const result = await get(`${resourceType}/${name}`, "-o", "json", options);
    return JSON.parse(result.stdout) as OcWorkloadJSON;
}

async function countPodRestarts(matchLabels: Record<string, string> | undefined, options: OcOptions): Promise<number> {

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

function isProgressingFailed(conditions: OcConditionJSON[]): boolean {

    const progressing = conditions.find(c => c.type === "Progressing");

    if (progressing?.status === "False") return true;

    return conditions.some(c => c.type === "ReplicaFailure" && c.status === "True");

}

/**
 * Valida cíclicamente el estado de un Deployment/DeploymentConfig hasta que:
 *   - llega a estado exitoso (replicas listas/actualizadas == replicas deseadas) -> resuelve,
 *   - supera `maxRestarts` reinicios acumulados -> lanza DeploymentRolloutError,
 *   - se queda en estado Failed más de `failedGracePeriod` sin recuperarse -> lanza DeploymentRolloutError,
 *   - o se cumple `timeout` sin éxito -> lanza DeploymentRolloutError.
 *
 * El polling se detiene ("se mata el proceso") apenas se detecta cualquiera
 * de las condiciones de fallo, re-lanzando el error para que `ctx.run(...)`
 * lo capture y lo reporte vía `ctx.notifier` si lo tienes configurado.
 */
export async function waitForDeployment(options: WaitForDeploymentOptions): Promise<DeploymentWatchResult> {

    const {
        deployment,
        resourceType = "deployment",
        timeout = 300_000,
        pollInterval = 5_000,
        failedGracePeriod = pollInterval * 6,
        maxRestarts,
        ...ocOptions
    } = options;

    const startedAt = Date.now();
    let failedSince: number | null = null;

    while (true) {

        const elapsedMs = Date.now() - startedAt;

        if (elapsedMs >= timeout) {
            const message = `Timeout esperando el rollout de "${deployment}" (${timeout}ms)`;
            throw new DeploymentRolloutError(message, { status: "timeout", deployment, elapsedMs, restarts: -1 });
        }

        let json: OcWorkloadJSON;

        try {
            json = await readWorkloadJSON(resourceType, deployment, ocOptions);
        } catch {
            // El recurso puede no existir todavía (justo después de un apply); reintenta.
            await sleep(pollInterval);
            continue;
        }

        const desired = json.spec?.replicas ?? 1;
        const ready = json.status?.readyReplicas ?? json.status?.availableReplicas ?? 0;
        const updated = json.status?.updatedReplicas ?? 0;
        const conditions = json.status?.conditions ?? [];
        const failed = isProgressingFailed(conditions);
        const success = !failed && ready >= desired && updated >= desired;

        let restarts = 0;

        if (maxRestarts !== undefined) {

            restarts = await countPodRestarts(matchLabelsOf(json.spec?.selector), ocOptions);

            if (restarts > maxRestarts) {
                const message = `"${deployment}" superó el máximo de reinicios permitido (${restarts} > ${maxRestarts})`;
                throw new DeploymentRolloutError(message, { status: "failed", deployment, elapsedMs, restarts });
            }

        }

        if (success) {
            const message = `"${deployment}" alcanzó el estado esperado (${ready}/${desired} listas)`;
            return { status: "success", deployment, elapsedMs, restarts, message };
        }

        if (failed) {

            if (failedSince === null) {
                failedSince = Date.now();
            } else if (Date.now() - failedSince >= failedGracePeriod) {
                const message = `"${deployment}" quedó en estado Failed y no se recuperó en ${failedGracePeriod}ms`;
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
// GitOps (varios Deployments/DeploymentConfigs del mismo repo con distinta
// config, agrupados por un label común, p. ej.
// "deployment-group=repository-14").
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
 * del grupo lleguen a estado exitoso. Lleva `command: "oc"` para que
 * `classifiers.byCommand({ oc: "kubernetes" })` lo clasifique solo.
 */
export class DeploymentGroupRolloutError extends Error {

    readonly command = "oc";
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

export interface WaitForDeploymentGroupOptions extends OcOptions {
    /**
     * Label que agrupa todas las instancias del despliegue. Puede ser el
     * selector ya armado ("deployment-group=repository-14") o un objeto
     * ({ "deployment-group": "repository-14" }).
     */
    label: string | Record<string, string>;
    /** "deployment" (k8s nativo, default) o "dc" (DeploymentConfig clásico de OpenShift). */
    resourceType?: "deployment" | "dc";
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

async function listWorkloadNames(resourceType: "deployment" | "dc", selector: string, options: OcOptions): Promise<string[]> {

    const listCommand = resourceType === "dc" ? "dc" : "deployments";

    const result = await get(listCommand, "-l", selector, "-o", "json", options);

    const parsed = JSON.parse(result.stdout) as {
        items?: Array<{ metadata?: { name?: string } }>;
    };

    return (parsed.items ?? [])
        .map(item => item.metadata?.name)
        .filter((name): name is string => Boolean(name));

}

/**
 * Descubre todos los Deployments/DeploymentConfigs que compartan el `label`
 * dado (p. ej. todas las instancias GitOps de un mismo repo, marcadas con
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
        resourceType = "deployment",
        timeout = 300_000,
        pollInterval = 5_000,
        failedGracePeriod = pollInterval * 6,
        maxRestarts,
        ...ocOptions
    } = options;

    const selector = toSelectorString(label);
    const startedAt = Date.now();

    const names = await listWorkloadNames(resourceType, selector, ocOptions);

    if (!names.length) {
        const message = `No se encontraron ${resourceType === "dc" ? "deploymentconfigs" : "deployments"} con el label "${selector}"`;
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
            resourceType,
            timeout: remainingMs(),
            pollInterval,
            failedGracePeriod,
            maxRestarts,
            ...ocOptions
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
        const message = `${failed.length}/${names.length} instancias del grupo "${selector}" no llegaron a estado exitoso: ${summary}`;

        throw new DeploymentGroupRolloutError(message, { label: selector, elapsedMs, succeeded, failed });

    }

    const message = `Las ${names.length} instancias del grupo "${selector}" alcanzaron el estado esperado`;

    return { status: "success", label: selector, elapsedMs, deployments, message };

}
