import { logger } from "../core/logger";

// ---------------------------------------------------------------------------
// Catálogo de errores de rollout (kubectl / oc)
//
//   K8S-1xx  Errores principales: POR QUÉ terminó la validación
//            (timeout, máximo de reinicios, Failed, no existe, sin acceso...).
//   K8S-2xx  Errores secundarios: la CAUSA detectada en pods, eventos y
//            condiciones (OOMKilled, ImagePull, probes, quota, scheduling...).
//
// Ver la sección "Catálogo de errores de rollout" del README.
// ---------------------------------------------------------------------------

export type RolloutErrorLevel = "primary" | "secondary";

export interface RolloutErrorDefinition {
    code: string;
    key: string;
    level: RolloutErrorLevel;
    title: string;
    hint: string;
}

function def(code: string, key: string, level: RolloutErrorLevel, title: string, hint: string): RolloutErrorDefinition {
    return { code, key, level, title, hint };
}

export const ROLLOUT_ERRORS = {
    // ---- Principales -----------------------------------------------------
    ROLLOUT_TIMEOUT: def("K8S-101-TIMEOUT", "ROLLOUT_TIMEOUT", "primary",
        "El rollout no terminó dentro del timeout",
        "Revisar las causas secundarias; si el despliegue es lento por naturaleza, aumentar `timeout`."),
    MAX_RESTARTS_EXCEEDED: def("K8S-102-MAXREINIT", "MAX_RESTARTS_EXCEEDED", "primary",
        "Los pods superaron el máximo de reinicios permitido",
        "La app se cae al arrancar: revisar logs (`printLogs`) y las causas (OOMKilled, exit code, liveness)."),
    PROGRESS_DEADLINE_EXCEEDED: def("K8S-103-DEADLINE", "PROGRESS_DEADLINE_EXCEEDED", "primary",
        "Kubernetes marcó el rollout como estancado (progressDeadlineSeconds)",
        "Los pods nuevos no llegan a Ready: revisar causas secundarias y `spec.progressDeadlineSeconds`."),
    REPLICA_FAILURE: def("K8S-104-REPLICAFAIL", "REPLICA_FAILURE", "primary",
        "El controlador no pudo crear los pods (ReplicaFailure)",
        "Normalmente quota, LimitRange, SCC/PodSecurity o un webhook de admisión: ver causas secundarias."),
    ROLLOUT_FAILED: def("K8S-105-FAILED", "ROLLOUT_FAILED", "primary",
        "El recurso quedó en estado Failed (Progressing=False) y no se recuperó",
        "Revisar la condición informada y los eventos del recurso."),
    RESOURCE_NOT_FOUND: def("K8S-106-NOTFOUND", "RESOURCE_NOT_FOUND", "primary",
        "El Deployment/DeploymentConfig no existe en el namespace",
        "Verificar nombre, namespace, kubeconfig y que el apply/sync se haya hecho."),
    ACCESS_DENIED: def("K8S-107-FORBIDDEN", "ACCESS_DENIED", "primary",
        "Sin permisos o credenciales inválidas para leer el recurso",
        "Revisar token/kubeconfig (Unauthorized) o el RBAC del service account (Forbidden)."),
    CLUSTER_UNREACHABLE: def("K8S-108-UNREACHABLE", "CLUSTER_UNREACHABLE", "primary",
        "No se pudo consultar el cluster durante toda la validación",
        "Revisar conectividad con el API server, VPN/proxy, certificados y que el CLI esté instalado."),
    GROUP_EMPTY: def("K8S-109-GROUPEMPTY", "GROUP_EMPTY", "primary",
        "Ningún recurso coincide con el label del grupo",
        "Verificar el label (p. ej. `deployment-group=repository-14`), el namespace y el `resourceType`."),
    GROUP_FAILED: def("K8S-110-GROUPFAIL", "GROUP_FAILED", "primary",
        "Una o más instancias del grupo no llegaron a estado exitoso",
        "Ver `failed[]`: cada instancia trae su propio código principal y sus causas."),

    // ---- Secundarios -----------------------------------------------------
    OOM_KILLED: def("K8S-201-OOMKILLED", "OOM_KILLED", "secondary",
        "Contenedor terminado por falta de memoria (OOMKilled)",
        "Subir `resources.limits.memory` o reducir el consumo (heap de JVM/Node, cachés)."),
    CRASH_LOOP_BACKOFF: def("K8S-202-CRASHLOOP", "CRASH_LOOP_BACKOFF", "secondary",
        "El contenedor se cae repetidamente (CrashLoopBackOff)",
        "Revisar el log anterior (--previous): error de arranque, config o dependencia caída."),
    CONTAINER_EXIT_ERROR: def("K8S-203-EXITCODE", "CONTAINER_EXIT_ERROR", "secondary",
        "El contenedor terminó con código de salida distinto de 0",
        "Revisar logs; exit 1 = error de la app, 126/127 = comando no ejecutable/no encontrado, 137 = SIGKILL, 143 = SIGTERM."),
    IMAGE_PULL_FAILED: def("K8S-204-IMAGEPULL", "IMAGE_PULL_FAILED", "secondary",
        "No se pudo descargar la imagen (ErrImagePull / ImagePullBackOff)",
        "Verificar que el tag exista, el acceso al registry y el `imagePullSecrets`."),
    INVALID_IMAGE_NAME: def("K8S-205-IMAGENAME", "INVALID_IMAGE_NAME", "secondary",
        "El nombre de la imagen es inválido",
        "Revisar la referencia de imagen en el manifiesto (registry/repo:tag)."),
    CONFIG_ERROR: def("K8S-206-CONFIGMISSING", "CONFIG_ERROR", "secondary",
        "Falta configuración para crear el contenedor (CreateContainerConfigError)",
        "Un Secret/ConfigMap (o una key) referenciado no existe en el namespace."),
    CONTAINER_CREATE_FAILED: def("K8S-207-CREATEFAIL", "CONTAINER_CREATE_FAILED", "secondary",
        "El runtime no pudo crear/arrancar el contenedor",
        "Revisar command/args, entrypoint, permisos del filesystem y securityContext."),
    INIT_CONTAINER_FAILED: def("K8S-208-INITFAIL", "INIT_CONTAINER_FAILED", "secondary",
        "Un init container falló o no termina",
        "Revisar el log del init container (migraciones, espera de dependencias, permisos)."),
    READINESS_PROBE_FAILED: def("K8S-209-READINESS", "READINESS_PROBE_FAILED", "secondary",
        "Falla el readiness probe (el pod no recibe tráfico)",
        "Verificar path/puerto del health, tiempos (`initialDelaySeconds`, `timeoutSeconds`) y dependencias."),
    LIVENESS_PROBE_FAILED: def("K8S-210-LIVENESS", "LIVENESS_PROBE_FAILED", "secondary",
        "Falla el liveness probe (Kubernetes reinicia el contenedor)",
        "Verificar el endpoint de health y darle más margen (`initialDelaySeconds`/`failureThreshold`) o usar startupProbe."),
    STARTUP_PROBE_FAILED: def("K8S-211-STARTUP", "STARTUP_PROBE_FAILED", "secondary",
        "Falla el startup probe (la app no termina de arrancar)",
        "Aumentar `failureThreshold * periodSeconds` o revisar por qué el arranque es lento."),
    INSUFFICIENT_RESOURCES: def("K8S-212-NORESOURCES", "INSUFFICIENT_RESOURCES", "secondary",
        "No hay nodos con CPU/memoria suficiente para programar el pod",
        "Bajar `resources.requests`, escalar el cluster o liberar capacidad."),
    UNSCHEDULABLE: def("K8S-213-UNSCHEDULABLE", "UNSCHEDULABLE", "secondary",
        "El pod no se puede programar en ningún nodo",
        "Revisar nodeSelector, afinidad/antiafinidad, taints/tolerations y topology spread."),
    PVC_UNBOUND: def("K8S-214-PVCUNBOUND", "PVC_UNBOUND", "secondary",
        "Un PersistentVolumeClaim no existe o no está enlazado",
        "Verificar el PVC, su StorageClass y que haya PVs/provisioner disponibles."),
    VOLUME_MOUNT_FAILED: def("K8S-215-MOUNTFAIL", "VOLUME_MOUNT_FAILED", "secondary",
        "No se pudo montar/adjuntar un volumen",
        "Revisar que el Secret/ConfigMap/PVC exista y que el volumen no esté tomado por otro nodo."),
    QUOTA_EXCEEDED: def("K8S-216-QUOTA", "QUOTA_EXCEEDED", "secondary",
        "Se excedió el ResourceQuota del namespace",
        "Pedir más quota, bajar requests/limits o réplicas, o liberar recursos del namespace."),
    ADMISSION_DENIED: def("K8S-217-ADMISSION", "ADMISSION_DENIED", "secondary",
        "La creación del pod fue rechazada (LimitRange, SCC, PodSecurity o webhook)",
        "Ajustar el pod a las políticas del namespace (límites, securityContext, SCC) según el mensaje."),
    POD_EVICTED: def("K8S-218-EVICTED", "POD_EVICTED", "secondary",
        "El pod fue desalojado del nodo (Evicted)",
        "Normalmente presión de memoria/disco en el nodo: revisar requests y uso de ephemeral-storage."),
    PODS_NOT_CREATED: def("K8S-219-NOPODS", "PODS_NOT_CREATED", "secondary",
        "No existe ningún pod del deployment",
        "Revisar eventos del ReplicaSet/ReplicationController y que `replicas` no sea 0."),
    PODS_NOT_READY: def("K8S-220-NOTREADY", "PODS_NOT_READY", "secondary",
        "Pods corriendo pero no Ready, sin una causa explícita",
        "Revisar readiness probe, logs de la app y dependencias externas."),
    PODS_PENDING: def("K8S-221-PENDING", "PODS_PENDING", "secondary",
        "Pods en Pending sin una causa explícita",
        "Revisar eventos del pod (scheduling, volúmenes, pull de imagen)."),
    DEPLOYER_FAILED: def("K8S-222-DEPLOYERFAIL", "DEPLOYER_FAILED", "secondary",
        "Falló o se canceló el deployer pod del DeploymentConfig (OpenShift)",
        "Revisar el log del pod `<dc>-<n>-deploy` y los eventos del ReplicationController."),
    NODE_LOST: def("K8S-223-NODELOST", "NODE_LOST", "secondary",
        "El nodo del pod dejó de responder (estado Unknown / NodeNotReady)",
        "Problema de infraestructura del nodo: revisar el estado del nodo con el equipo de plataforma."),
    UNKNOWN_CAUSE: def("K8S-299-UNKNOWN", "UNKNOWN_CAUSE", "secondary",
        "No se identificó una causa específica",
        "Revisar el diagnóstico completo con `printEvents: true` y `printLogs: true`.")
} as const;

export type RolloutErrorKey = keyof typeof ROLLOUT_ERRORS;

/** Una causa secundaria detectada (K8S-2xx). */
export interface RolloutCause {
    code: string;
    key: RolloutErrorKey;
    title: string;
    hint: string;
    /** Detalle concreto: mensaje del evento/estado, exit code, límite de memoria, etc. */
    detail: string;
    pod?: string;
    container?: string;
}

/** Lista plana del catálogo, ordenada por código (útil para documentar o mapear). */
export function rolloutErrorCatalog(): RolloutErrorDefinition[] {
    return Object.values(ROLLOUT_ERRORS).sort((a, b) => a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Tipos de entrada (subset del JSON de la API)
// ---------------------------------------------------------------------------

export interface ConditionLike {
    type: string;
    status: string;
    reason?: string;
    message?: string;
}

export interface EventLike {
    type: string;
    reason: string;
    message: string;
    kind: string;
    name: string;
    count: number;
    lastTimestamp: string;
}

interface ContainerStateJSON {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { reason?: string; exitCode?: number; message?: string };
}

export interface ContainerStatusJSON {
    name?: string;
    ready?: boolean;
    restartCount?: number;
    state?: ContainerStateJSON;
    lastState?: ContainerStateJSON;
}

export interface PodJSON {
    metadata?: { name?: string; creationTimestamp?: string; deletionTimestamp?: string };
    spec?: {
        nodeName?: string;
        containers?: Array<{ name?: string; resources?: { limits?: { memory?: string } } }>;
    };
    status?: {
        phase?: string;
        reason?: string;
        message?: string;
        conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
        initContainerStatuses?: ContainerStatusJSON[];
        containerStatuses?: ContainerStatusJSON[];
    };
}

// ---------------------------------------------------------------------------
// Errores de lectura del recurso (stderr del CLI)
// ---------------------------------------------------------------------------

export type ReadErrorKind = "notFound" | "access" | "other";

export function classifyReadError(text: string): ReadErrorKind {
    if (/NotFound|not found/i.test(text)) return "notFound";
    if (/Unauthorized|Forbidden|forbidden|You must be logged in|must be logged in/i.test(text)) return "access";
    return "other";
}

// ---------------------------------------------------------------------------
// Diagnóstico: pods + eventos + condiciones -> causas secundarias
// ---------------------------------------------------------------------------

function clip(text: string, max = 220): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function cause(key: RolloutErrorKey, detail: string, pod?: string, container?: string): RolloutCause {
    const entry = ROLLOUT_ERRORS[key];
    return { code: entry.code, key, title: entry.title, hint: entry.hint, detail: clip(detail), pod, container };
}

/** Clasifica un mensaje de creación rechazada (FailedCreate / ReplicaFailure). */
function classifyCreateFailure(message: string): RolloutErrorKey {
    if (/exceeded quota/i.test(message)) return "QUOTA_EXCEEDED";
    return "ADMISSION_DENIED";
}

/** Clasifica un mensaje de FailedScheduling / PodScheduled=False. */
function classifyScheduling(message: string): RolloutErrorKey {
    if (/PersistentVolumeClaim|unbound|persistentvolumeclaim/i.test(message)) return "PVC_UNBOUND";
    if (/Insufficient|Too many pods/i.test(message)) return "INSUFFICIENT_RESOURCES";
    return "UNSCHEDULABLE";
}

/** Clasifica el `reason` de un contenedor en waiting. */
function classifyWaiting(reason: string): RolloutErrorKey | null {
    switch (reason) {
        case "CrashLoopBackOff": return "CRASH_LOOP_BACKOFF";
        case "ErrImagePull":
        case "ImagePullBackOff":
        case "ErrImageNeverPull":
        case "RegistryUnavailable": return "IMAGE_PULL_FAILED";
        case "InvalidImageName": return "INVALID_IMAGE_NAME";
        case "CreateContainerConfigError": return "CONFIG_ERROR";
        case "CreateContainerError":
        case "RunContainerError":
        case "PreCreateHookError":
        case "PostStartHookError": return "CONTAINER_CREATE_FAILED";
        default: return null;
    }
}

/** Clasifica un evento Warning. `null` = no aporta una causa conocida. */
function classifyEvent(event: EventLike): RolloutErrorKey | null {

    const { reason, message } = event;

    switch (reason) {
        case "Unhealthy":
            if (/Readiness probe/i.test(message)) return "READINESS_PROBE_FAILED";
            if (/Liveness probe/i.test(message)) return "LIVENESS_PROBE_FAILED";
            if (/Startup probe/i.test(message)) return "STARTUP_PROBE_FAILED";
            return null;
        case "FailedScheduling": return classifyScheduling(message);
        case "FailedMount":
        case "FailedAttachVolume":
        case "FailedMapVolume": return "VOLUME_MOUNT_FAILED";
        case "FailedCreate": return classifyCreateFailure(message);
        case "Evicted": return "POD_EVICTED";
        case "NodeNotReady": return "NODE_LOST";
        case "InspectFailed":
        case "InvalidImageName": return "INVALID_IMAGE_NAME";
        case "ErrImageNeverPull": return "IMAGE_PULL_FAILED";
        case "BackOff":
            if (/pull/i.test(message)) return "IMAGE_PULL_FAILED";
            if (/restarting failed container/i.test(message)) return "CRASH_LOOP_BACKOFF";
            return null;
        case "Failed":
            if (/pull|image/i.test(message)) return "IMAGE_PULL_FAILED";
            if (/(secret|configmap).*not found|couldn't find key/i.test(message)) return "CONFIG_ERROR";
            if (/Error:/i.test(message)) return "CONTAINER_CREATE_FAILED";
            return null;
        case "DeploymentCancelled":
        case "RolloutCancelled":
        case "DeploymentFailed": return "DEPLOYER_FAILED";
        default: return null;
    }

}

export interface DiagnoseInput {
    /** Nombre del workload (para detectar deployer pods de un dc). */
    workload: string;
    resourceType?: "deployment" | "dc";
    conditions: ConditionLike[];
    /** Pods actuales del workload (por su selector). */
    pods: PodJSON[];
    /** Eventos ya filtrados al workload, sus ReplicaSets/RCs y sus pods. */
    events: EventLike[];
}

/**
 * Analiza el estado del workload y devuelve las causas secundarias (K8S-2xx)
 * deduplicadas por código + pod. Si no detecta nada, devuelve UNKNOWN_CAUSE.
 */
export function diagnoseRollout({ workload, resourceType = "deployment", conditions, pods, events }: DiagnoseInput): RolloutCause[] {

    const causes: RolloutCause[] = [];
    const seen = new Set<string>();

    const add = (item: RolloutCause): void => {
        const id = `${item.code}|${item.pod ?? ""}`;
        if (seen.has(id)) return;
        seen.add(id);
        causes.push(item);
    };

    // 1) Condiciones del workload (ReplicaFailure trae el mensaje de quota/admisión).
    for (const condition of conditions) {
        if (condition.type === "ReplicaFailure" && condition.status === "True") {
            add(cause(classifyCreateFailure(condition.message ?? ""), condition.message ?? condition.reason ?? "ReplicaFailure"));
        }
    }

    // 2) Estado de cada pod.
    for (const pod of pods) {

        const podName = pod.metadata?.name;
        const status = pod.status ?? {};
        const before = causes.length;

        if (status.reason === "Evicted") {
            add(cause("POD_EVICTED", status.message ?? "Evicted", podName));
            continue;
        }

        if (status.phase === "Unknown") {
            add(cause("NODE_LOST", `pod en estado Unknown${pod.spec?.nodeName ? ` (node ${pod.spec.nodeName})` : ""}`, podName));
            continue;
        }

        for (const init of status.initContainerStatuses ?? []) {
            if (init.state?.terminated?.exitCode === 0) continue;
            const waiting = init.state?.waiting;
            const terminated = init.state?.terminated ?? init.lastState?.terminated;
            if (waiting?.reason && waiting.reason !== "PodInitializing") {
                add(cause("INIT_CONTAINER_FAILED", `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`, podName, init.name));
            } else if (terminated && terminated.exitCode !== 0) {
                add(cause("INIT_CONTAINER_FAILED", `${terminated.reason ?? "Error"} (exit ${terminated.exitCode ?? "?"})`, podName, init.name));
            }
        }

        const limits = new Map((pod.spec?.containers ?? []).map(c => [c.name, c.resources?.limits?.memory]));

        for (const container of status.containerStatuses ?? []) {

            const waiting = container.state?.waiting;
            const terminated = container.state?.terminated ?? container.lastState?.terminated;

            if (terminated?.reason === "OOMKilled") {
                const limit = limits.get(container.name);
                add(cause("OOM_KILLED", `límite de memoria ${limit ?? "sin definir"}, restarts=${container.restartCount ?? 0}`, podName, container.name));
            } else if (terminated && terminated.exitCode !== undefined && terminated.exitCode !== 0) {
                const reason = terminated.reason ?? "Error";
                const key: RolloutErrorKey = /ContainerCannotRun|StartError/.test(reason) ? "CONTAINER_CREATE_FAILED" : "CONTAINER_EXIT_ERROR";
                add(cause(key, `${reason} exit ${terminated.exitCode}${terminated.message ? `: ${terminated.message}` : ""}`, podName, container.name));
            }

            if (waiting?.reason) {
                const key = classifyWaiting(waiting.reason);
                if (key) add(cause(key, `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`, podName, container.name));
            }

        }

        const scheduled = (status.conditions ?? []).find(c => c.type === "PodScheduled" && c.status === "False");
        if (scheduled) {
            add(cause(classifyScheduling(scheduled.message ?? ""), scheduled.message ?? scheduled.reason ?? "Unschedulable", podName));
        }

        // 3) Eventos Warning del pod.
        for (const event of events) {
            if (event.kind !== "Pod" || event.name !== podName || event.type !== "Warning") continue;
            const key = classifyEvent(event);
            if (key) add(cause(key, `${event.reason}: ${event.message}${event.count > 1 ? ` (x${event.count})` : ""}`, podName));
        }

        // 4) Sin causa explícita: Pending o Running-no-Ready.
        if (causes.length === before) {
            const containers = status.containerStatuses ?? [];
            const allReady = containers.length > 0 && containers.every(c => c.ready);
            if (status.phase === "Pending") {
                add(cause("PODS_PENDING", "Pending", podName));
            } else if (status.phase === "Running" && !allReady && !pod.metadata?.deletionTimestamp) {
                add(cause("PODS_NOT_READY", "Running pero no Ready", podName));
            }
        }

    }

    // 5) Eventos Warning del workload y de sus ReplicaSets/ReplicationControllers/deployers.
    const deployerPod = new RegExp(`^${workload.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+-deploy$`);
    const podNames = new Set(pods.map(p => p.metadata?.name));

    for (const event of events) {

        if (event.type !== "Warning") continue;
        if (event.kind === "Pod" && podNames.has(event.name)) continue;

        const isDeployer = resourceType === "dc" && event.kind === "Pod" && deployerPod.test(event.name);
        const key = isDeployer ? "DEPLOYER_FAILED" : classifyEvent(event);

        if (key) add(cause(key, `${event.kind}/${event.name} ${event.reason}: ${event.message}${event.count > 1 ? ` (x${event.count})` : ""}`, isDeployer ? event.name : undefined));

    }

    if (!pods.length && !causes.some(c => c.key === "QUOTA_EXCEEDED" || c.key === "ADMISSION_DENIED")) {
        add(cause("PODS_NOT_CREATED", "el selector del workload no devuelve pods"));
    }

    if (!causes.length) {
        add(cause("UNKNOWN_CAUSE", "sin señales en pods, eventos ni condiciones"));
    }

    return causes;

}

/** Resumen corto de las causas para el `message` del error. */
export function summarizeCauses(causes: RolloutCause[], max = 3): string {

    if (!causes.length) return "";

    const parts = causes.slice(0, max).map(c => `${c.code}${c.pod ? ` en ${c.pod}` : ""}`);
    const rest = causes.length > max ? ` (+${causes.length - max} más)` : "";

    return `causas: ${parts.join(", ")}${rest}`;

}

/** Imprime el error principal y una línea por causa secundaria. */
export function logRolloutFailure(resource: string, code: string, message: string, causes: RolloutCause[]): void {

    logger.error(`[${code}] ${resource}: ${message}`);

    for (const item of causes) {
        const where = [item.pod && `pod ${item.pod}`, item.container && `container ${item.container}`].filter(Boolean).join(" | ");
        logger.warn(`[${resource}] ${item.code}${where ? ` | ${where}` : ""} | ${item.detail} | sugerencia: ${item.hint}`);
    }

}

// ---------------------------------------------------------------------------
// Log periódico de estado — una línea por pod, para que se vea el avance
// del rollout y no parezca que el proceso se quedó pegado.
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {

    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (h) return `${h}h${m}m`;
    if (m) return `${m}m${s}s`;
    return `${s}s`;

}

/** Estado legible del pod, equivalente a la columna STATUS de `get pods`. */
export function podStatusText(pod: PodJSON): string {

    if (pod.metadata?.deletionTimestamp) return "Terminating";

    const status = pod.status ?? {};
    const inits = status.initContainerStatuses ?? [];

    for (let i = 0; i < inits.length; i++) {
        const init = inits[i];
        if (init.state?.terminated && init.state.terminated.exitCode === 0) continue;
        if (init.state?.waiting?.reason && init.state.waiting.reason !== "PodInitializing") return `Init:${init.state.waiting.reason}`;
        if (init.state?.terminated) return `Init:${init.state.terminated.reason ?? "Error"}`;
        return `Init:${i}/${inits.length}`;
    }

    for (const container of status.containerStatuses ?? []) {
        if (container.state?.waiting?.reason) return container.state.waiting.reason;
        if (container.state?.terminated?.reason) return container.state.terminated.reason;
    }

    const unschedulable = (status.conditions ?? []).find(c => c.type === "PodScheduled" && c.status === "False");
    if (unschedulable) return unschedulable.reason ?? "Unschedulable";

    return status.reason ?? status.phase ?? "Unknown";

}

const PROBLEM_STATUS = /BackOff|Err|Error|Failed|OOMKilled|Unschedulable|Evicted|CreateContainer|Invalid/i;

export function logPodLine(prefix: string, pod: PodJSON, now: number): void {

    const containers = pod.status?.containerStatuses ?? [];
    const total = containers.length || pod.spec?.containers?.length || 0;
    const ready = containers.filter(c => c.ready).length;
    const restarts = containers.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
    const lastReason = containers.map(c => c.lastState?.terminated?.reason).find(Boolean);
    const created = pod.metadata?.creationTimestamp ? Date.parse(pod.metadata.creationTimestamp) : NaN;
    const status = podStatusText(pod);

    const parts = [
        `${prefix} pod ${pod.metadata?.name ?? "?"}`,
        `status=${status}`,
        `ready=${ready}/${total}`,
        `restarts=${restarts}${lastReason ? ` (último: ${lastReason})` : ""}`,
        `age=${Number.isNaN(created) ? "?" : formatDuration(now - created)}`
    ];

    if (pod.spec?.nodeName) parts.push(`node=${pod.spec.nodeName}`);

    const line = parts.join(" | ");

    if (PROBLEM_STATUS.test(status)) {
        logger.warn(line);
    } else {
        logger.info(line);
    }

}
