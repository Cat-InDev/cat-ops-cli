import { shell } from "./shell";
import { logger } from "../core/logger";
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

export interface KubectlLogsOptions extends KubectlOptions {
    /** Contenedor del pod (-c). Necesario si el pod tiene varios contenedores. */
    container?: string;
    /** Trae (e imprime) el log del contenedor actual. Default: true. */
    current?: boolean;
    /**
     * Trae (e imprime) también el log del contenedor anterior (--previous),
     * útil tras un CrashLoopBackOff. Si no existe un contenedor anterior, se
     * retorna vacío en vez de fallar. Default: false.
     */
    previous?: boolean;
    /** Solo las últimas N líneas (--tail). */
    tail?: number;
    /** Logs de todos los contenedores del pod (--all-containers). Ignora `container`. Default: false. */
    allContainers?: boolean;
}

export interface KubectlLogsResult extends ExecResult {
    /** Log del contenedor actual ("" si `current: false`). */
    current: string;
    /** Log del contenedor anterior ("" si no se pidió o no existe). */
    previous: string;
}

function isPreviousLogNotFound(error: unknown): boolean {
    const stderr = (error as Partial<ExecResult>)?.stderr ?? "";
    return /previous terminated container|not found/i.test(stderr);
}

/**
 * `kubectl logs <pod>`. Por defecto se comporta igual que antes (solo el log
 * actual, en `stdout`/`current`). Con `previous: true` también trae el log
 * del contenedor anterior:
 *   const { current, previous } = await kubectl.logs("api-7d9f", { previous: true, namespace: "prod" });
 */
export async function logs(pod: string, { container, current = true, previous = false, tail, allContainers = false, ...options }: KubectlLogsOptions = {}): Promise<KubectlLogsResult> {

    const args = ["logs", pod];

    if (allContainers) {
        args.push("--all-containers=true");
    } else if (container) {
        args.push("-c", container);
    }

    if (tail !== undefined) {
        args.push("--tail", String(tail));
    }

    let base: ExecResult = { code: 0, stdout: "", stderr: "" };
    let currentLog = "";
    let previousLog = "";

    if (current) {
        base = await shell.exec("kubectl", ...toExecArgs(args, options));
        currentLog = base.stdout;
    }

    if (previous) {

        logger.info(`Log anterior (--previous) de "${pod}"`);

        try {
            const result = await shell.exec("kubectl", ...toExecArgs([...args, "--previous"], options));
            previousLog = result.stdout;
            if (!current) base = result;
        } catch (error) {
            if (!isPreviousLogNotFound(error)) throw error;
            logger.info(`"${pod}" no tiene un contenedor anterior, log anterior vacío`);
        }

    }

    return { ...base, current: currentLog, previous: previousLog };

}

// ---------------------------------------------------------------------------
// Eventos — de namespace, de un pod individual o de un deployment
// ---------------------------------------------------------------------------

export interface KubectlEventsOptions extends KubectlOptions {
    /** Solo eventos de tipo Warning. Default: false. */
    warningsOnly?: boolean;
}

export interface KubectlEvent {
    /** "Normal" | "Warning". */
    type: string;
    reason: string;
    message: string;
    /** Kind del objeto involucrado (Pod, ReplicaSet, Deployment, ...). */
    kind: string;
    /** Nombre del objeto involucrado. */
    name: string;
    count: number;
    lastTimestamp: string;
}

interface EventJSON {
    type?: string;
    reason?: string;
    message?: string;
    count?: number;
    series?: { count?: number };
    lastTimestamp?: string;
    eventTime?: string;
    firstTimestamp?: string;
    metadata?: { creationTimestamp?: string };
    involvedObject?: { kind?: string; name?: string };
}

/** Mismas opciones pero sin imprimir el comando ni su salida (consultas internas). */
function quiet(options: KubectlOptions): KubectlOptions {
    return { ...options, exec: { ...options.exec, silent: true } };
}

async function fetchEvents(fieldSelectors: string[], warningsOnly: boolean, options: KubectlOptions): Promise<KubectlEvent[]> {

    const selectors = warningsOnly ? [...fieldSelectors, "type=Warning"] : fieldSelectors;
    const args = ["events", "-o", "json"];

    if (selectors.length) {
        args.push("--field-selector", selectors.join(","));
    }

    const result = await get(...args, quiet(options));

    const parsed = JSON.parse(result.stdout || "{}") as { items?: EventJSON[] };

    return (parsed.items ?? [])
        .map(item => ({
            type: item.type ?? "",
            reason: item.reason ?? "",
            message: (item.message ?? "").trim(),
            kind: item.involvedObject?.kind ?? "",
            name: item.involvedObject?.name ?? "",
            count: item.count ?? item.series?.count ?? 1,
            lastTimestamp: item.lastTimestamp ?? item.eventTime ?? item.firstTimestamp ?? item.metadata?.creationTimestamp ?? ""
        }))
        .sort((a, b) => a.lastTimestamp.localeCompare(b.lastTimestamp));

}

function logEvents(title: string, list: KubectlEvent[]): void {

    if (!list.length) {
        logger.info(`${title}: sin eventos`);
        return;
    }

    logger.warn(`${title}:`);

    for (const event of list) {

        const count = event.count > 1 ? ` (x${event.count})` : "";
        const line = `  ${event.lastTimestamp} ${event.type} ${event.kind}/${event.name} ${event.reason}: ${event.message}${count}`;

        if (event.type === "Warning") {
            logger.warn(line);
        } else {
            logger.info(line);
        }

    }

}

/** Imprime (y retorna) los eventos de todo el namespace (el de `namespace`, o el actual), ordenados por fecha. */
export async function events({ warningsOnly = false, ...options }: KubectlEventsOptions = {}): Promise<KubectlEvent[]> {
    const list = await fetchEvents([], warningsOnly, options);
    logEvents(`Eventos del namespace ${options.namespace ?? "actual"}`, list);
    return list;
}

/** Imprime (y retorna) los eventos de un pod individual. */
export async function podEvents(pod: string, { warningsOnly = false, ...options }: KubectlEventsOptions = {}): Promise<KubectlEvent[]> {
    const list = await fetchEvents(["involvedObject.kind=Pod", `involvedObject.name=${pod}`], warningsOnly, options);
    logEvents(`Eventos del pod ${pod}`, list);
    return list;
}

/**
 * Indica si un evento pertenece al Deployment: el Deployment en sí y sus
 * ReplicaSets (`<name>-<hash>`). Los errores de quota (FailedCreate) se
 * registran en el ReplicaSet, no en el Deployment ni en los pods.
 */
function isWorkloadEvent(event: KubectlEvent, deployment: string): boolean {

    if (event.kind === "Deployment") return event.name === deployment;

    const suffix = event.name.startsWith(`${deployment}-`) ? event.name.slice(deployment.length + 1) : null;

    return event.kind === "ReplicaSet" && suffix !== null && /^[a-z0-9]+$/.test(suffix);

}

/**
 * Imprime (y retorna) los eventos de un Deployment, incluyendo los de sus
 * ReplicaSets (escalados, FailedCreate por quota, etc.).
 */
export async function deploymentEvents(deployment: string, { warningsOnly = false, ...options }: KubectlEventsOptions = {}): Promise<KubectlEvent[]> {

    const list = (await fetchEvents([], warningsOnly, options))
        .filter(event => isWorkloadEvent(event, deployment));

    logEvents(`Eventos de deployment/${deployment}`, list);

    return list;

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
    /**
     * Al terminar la validación con error (timeout, Failed o maxRestarts)
     * imprime los eventos, una sola vez, para saber qué está fallando:
     * `true` = deployment (incluye sus ReplicaSets/ReplicationControllers,
     * donde aparecen p. ej. los errores de quota) y pods; o elegir con
     * `{ deployment: true, pods: true }`. Default: no imprime.
     */
    printEvents?: boolean | PrintEventsOptions;
    /**
     * Al terminar la validación con error imprime, una sola vez, el log de
     * cada pod: `true` = actual + anterior (--previous), o elegir con
     * `{ current, previous, tail }`. Default: no imprime.
     */
    printLogs?: boolean | PrintLogsOptions;
}

export interface PrintEventsOptions {
    /** Eventos del deployment y de sus ReplicaSets/ReplicationControllers (quota, FailedCreate, escalados). */
    deployment?: boolean;
    /** Eventos de cada pod del deployment (ImagePullBackOff, FailedScheduling, probes, etc.). */
    pods?: boolean;
}

export interface PrintLogsOptions {
    /** Log del contenedor actual. Default: true. */
    current?: boolean;
    /** Log del contenedor anterior (--previous); vacío si no existe. Default: true. */
    previous?: boolean;
    /** Solo las últimas N líneas. */
    tail?: number;
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

async function listPodNames(matchLabels: Record<string, string> | undefined, options: KubectlOptions): Promise<string[]> {

    if (!matchLabels || !Object.keys(matchLabels).length) {
        return [];
    }

    const selector = Object.entries(matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

    const result = await get("pods", "-l", selector, "-o", "json", options);

    const parsed = JSON.parse(result.stdout) as {
        items?: Array<{ metadata?: { name?: string } }>;
    };

    return (parsed.items ?? [])
        .map(item => item.metadata?.name)
        .filter((name): name is string => Boolean(name));

}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return (error as Partial<ExecResult>)?.stderr?.trim() || String(error);
}

interface DiagnosticsOptions {
    printEvents?: boolean | PrintEventsOptions;
    printLogs?: boolean | PrintLogsOptions;
}

/**
 * Se llama una sola vez, al terminar la validación con error: imprime las
 * condiciones del recurso y, según los flags, sus eventos y los logs de sus
 * pods. Nunca lanza, para no tapar el error original del rollout.
 */
async function printDiagnostics(
    deployment: string,
    { printEvents = false, printLogs = false }: DiagnosticsOptions,
    options: KubectlOptions
): Promise<void> {

    const eventsConfig: PrintEventsOptions = printEvents === true ? { deployment: true, pods: true } : printEvents || {};
    const logsConfig: PrintLogsOptions | false = printLogs === true ? {} : printLogs;

    if (!eventsConfig.deployment && !eventsConfig.pods && !logsConfig) return;

    logger.warn(`----- Diagnóstico de deployment/${deployment} -----`);

    let matchLabels: Record<string, string> | undefined;

    try {

        const json = await readDeploymentJSON(deployment, quiet(options));

        matchLabels = json.spec?.selector?.matchLabels;

        for (const condition of json.status?.conditions ?? []) {
            const reason = condition.reason ? ` (${condition.reason})` : "";
            const message = condition.message ? `: ${condition.message}` : "";
            logger.warn(`Condición ${condition.type}=${condition.status}${reason}${message}`);
        }

    } catch (error) {
        logger.warn(`No se pudo leer deployment/${deployment}: ${errorText(error)}`);
    }

    if (eventsConfig.deployment) {
        try {
            await deploymentEvents(deployment, options);
        } catch (error) {
            logger.warn(`No se pudieron obtener los eventos de "${deployment}": ${errorText(error)}`);
        }
    }

    if (!eventsConfig.pods && !logsConfig) return;

    let pods: string[] = [];

    try {
        pods = await listPodNames(matchLabels, quiet(options));
    } catch (error) {
        logger.warn(`No se pudieron listar los pods de "${deployment}": ${errorText(error)}`);
        return;
    }

    if (!pods.length) {
        logger.warn(`"${deployment}" no tiene pods; si no se pudieron crear (p. ej. quota), la causa está en los eventos del deployment`);
        return;
    }

    if (eventsConfig.pods) {
        try {
            const podNames = new Set(pods);
            const list = (await fetchEvents(["involvedObject.kind=Pod"], false, options))
                .filter(event => podNames.has(event.name));
            logEvents(`Eventos de los pods de "${deployment}"`, list);
        } catch (error) {
            logger.warn(`No se pudieron obtener los eventos de los pods de "${deployment}": ${errorText(error)}`);
        }
    }

    if (!logsConfig) return;

    const { current = true, previous = true, tail } = logsConfig;

    for (const pod of pods) {
        try {
            logger.warn(`Logs del pod ${pod}:`);
            await logs(pod, { current, previous, tail, allContainers: true, ...options });
        } catch (error) {
            logger.warn(`No se pudieron obtener los logs del pod "${pod}": ${errorText(error)}`);
        }
    }

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
        printEvents = false,
        printLogs = false,
        ...kubectlOptions
    } = options;

    const startedAt = Date.now();
    let failedSince: number | null = null;

    // El polling no imprime nada en cada iteración; solo el resultado final.
    const pollOptions = quiet(kubectlOptions);

    // Eventos/logs (si se pidieron) una sola vez, al terminar con error.
    const fail = async (message: string, info: Omit<DeploymentWatchResult, "message">): Promise<DeploymentRolloutError> => {
        await printDiagnostics(deployment, { printEvents, printLogs }, kubectlOptions);
        return new DeploymentRolloutError(message, info);
    };

    while (true) {

        const elapsedMs = Date.now() - startedAt;

        if (elapsedMs >= timeout) {
            const message = `Timeout esperando el rollout de "${deployment}" (${timeout}ms)`;
            throw await fail(message, { status: "timeout", deployment, elapsedMs, restarts: -1 });
        }

        let json: DeploymentJSON;

        try {
            json = await readDeploymentJSON(deployment, pollOptions);
        } catch {
            // El recurso puede no existir todavía (justo después de un apply); reintenta.
            await sleep(pollInterval);
            continue;
        }

        const matchLabels = json.spec?.selector?.matchLabels;

        const desired = json.spec?.replicas ?? 1;
        const ready = json.status?.readyReplicas ?? 0;
        const updated = json.status?.updatedReplicas ?? 0;
        const conditions = json.status?.conditions ?? [];
        const failed = isProgressingFailed(conditions);
        const success = !failed && ready >= desired && updated >= desired;

        let restarts = 0;

        if (maxRestarts !== undefined) {

            restarts = await countPodRestarts(matchLabels, pollOptions);

            if (restarts > maxRestarts) {
                const message = `Deployment "${deployment}" superó el máximo de reinicios permitido (${restarts} > ${maxRestarts})`;
                throw await fail(message, { status: "failed", deployment, elapsedMs, restarts });
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
                throw await fail(message, { status: "failed", deployment, elapsedMs, restarts });
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
    /** Igual que en waitForDeployment: se imprime al final, por cada instancia que falle. */
    printEvents?: boolean | PrintEventsOptions;
    /** Igual que en waitForDeployment: se imprime al final, por cada instancia que falle. */
    printLogs?: boolean | PrintLogsOptions;
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
        printEvents,
        printLogs,
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

        // Diagnóstico al final, de a una instancia para que no se mezcle la salida.
        for (const failure of failed) {
            await printDiagnostics(failure.deployment, { printEvents, printLogs }, kubectlOptions);
        }

        const summary = failed.map(f => `${f.deployment} (${f.status})`).join(", ");
        const message = `${failed.length}/${names.length} deployments del grupo "${selector}" no llegaron a estado exitoso: ${summary}`;

        throw new DeploymentGroupRolloutError(message, { label: selector, elapsedMs, succeeded, failed });

    }

    const message = `Los ${names.length} deployments del grupo "${selector}" alcanzaron el estado esperado`;

    return { status: "success", label: selector, elapsedMs, deployments, message };

}
