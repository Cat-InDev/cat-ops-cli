import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface DockerBuildOptions {
    image: string;
    context?: string;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
    /** `--pull=<true|false>`: fuerza intentar descargar la imagen base. */
    pull?: boolean;
    /** `--no-cache`: omite la caché de capas durante el build. */
    noCache?: boolean;
    /** retry/timeout/dryRun para esta llamada puntual. */
    exec?: ExecOptions;
}

export interface DockerLoginOptions {
    registry: string;
    username: string;
    password: string;
    exec?: ExecOptions;
}

export interface DockerPruneOptions {
    /** `-a`: elimina también imágenes y caché sin uso (build cache). */
    all?: boolean;
    /** `--volumes`: elimina también volúmenes anónimos. */
    volumes?: boolean;
    /** `--filter`: filtros adicionales (ej. "until=24h"). */
    filter?: string;
    /** retry/timeout/dryRun para esta llamada puntual. */
    exec?: ExecOptions;
}

export interface DockerRmOptions {
    /** Fuerza la eliminación de un contenedor en ejecución. */
    force?: boolean;
    /** retry/timeout/dryRun para esta llamada puntual. */
    exec?: ExecOptions;
}

/** Entrada parseada de una fila de `docker system df`. */
export interface DockerDiskUsageRow {
    type: string;
    total: number;
    active: number;
    size: number;
    reclaimable: number;
}

/** Resultado de `docker system df` con unidades normalizadas a bytes. */
export interface DockerDiskUsage {
    rows: DockerDiskUsageRow[];
    /** Fila agregada que suma todos los tipos (total/reclaimable en bytes). */
    total: DockerDiskUsageRow;
    raw: string;
}

/** Umbrals de validación para `validateSpace` (en bytes). */
export interface DockerSpaceThresholds {
    /** Espacio total ocupado por imágenes. */
    images?: number;
    /** Espacio total ocupado por contenedores. */
    containers?: number;
    /** Espacio total ocupado por volúmenes locales. */
    volumes?: number;
    /** Espacio total ocupado por la caché de build. */
    buildCache?: number;
    /** Espacio total reclaimable (suma de todos los tipos). */
    reclaimable?: number;
}

export function build({
    image,
    context = ".",
    dockerfile,
    buildArgs = {},
    pull,
    noCache,
    exec
}: DockerBuildOptions): Promise<ExecResult> {

    const args = ["build", "-t", image];

    if (dockerfile) {
        args.push("-f", dockerfile);
    }

    Object.entries(buildArgs).forEach(([k, v]) => {
        args.push("--build-arg", `${k}=${v}`);
    });

    if (pull !== undefined) {
        args.push(`--pull=${String(pull)}`);
    }

    if (noCache) {
        args.push("--no-cache");
    }

    args.push(context);

    return shell.exec("docker", ...withExecOptions(args, exec));

}

export function push(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["push", image], exec));
}

export function tag(source: string, target: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["tag", source, target], exec));
}

export function login({ registry, username, password, exec }: DockerLoginOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["login", registry, "-u", username, "-p", password], exec));
}

export function pull(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["pull", image], exec));
}

export function rmi(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["rmi", image], exec));
}

export function rm(container: string, { force, exec }: DockerRmOptions = {}): Promise<ExecResult> {
    const args = ["rm"];
    if (force) {
        args.push("-f");
    }
    args.push(container);
    return shell.exec("docker", ...withExecOptions(args, exec));
}

/** `docker system prune`: libera espacio eliminando contenedores/imágenes/volúmenes/caché sin uso. */
export function prune({ all, volumes, filter, exec }: DockerPruneOptions = {}): Promise<ExecResult> {
    const args = ["system", "prune"];
    if (all) {
        args.push("-a");
    }
    if (volumes) {
        args.push("--volumes");
    }
    if (filter) {
        args.push("--filter", filter);
    }
    args.push("-f");
    return shell.exec("docker", ...withExecOptions(args, exec));
}

/**
 * `docker system df`: devuelve el uso de disco de imágenes, contenedores,
 * volúmenes y caché de build, normalizado a bytes para su análisis.
 */
export async function systemDf(exec?: ExecOptions): Promise<DockerDiskUsage> {
    const res = await shell.exec("docker", ...withExecOptions(["system", "df"], exec));
    return parseSystemDf(res.stdout);
}

/** `docker buildx du`: tamaño de la caché de build (buildkit). */
export function buildxDu(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["buildx", "du"], exec));
}

/**
 * Valida la caché de build. Devuelve el uso de la caché (reclaimable) para
 * decidir si conviene hacer prune. No lanza error por sí mismo: retorna el
 * resultado analizado.
 */
export async function validateCache(exec?: ExecOptions): Promise<{ cache: number; reclaimable: number; usage: DockerDiskUsage }> {
    const usage = await systemDf(exec);
    const cacheRows = usage.rows.filter(r => /cache/i.test(r.type));
    const cache = cacheRows.reduce((s, r) => s + r.size, 0);
    const reclaimable = cacheRows.reduce((s, r) => s + r.reclaimable, 0);
    return { cache, reclaimable, usage };
}

/**
 * Valida el espacio usado por imagenes, contenedores, volúmenes y caché.
 * Compara cada métrica con los umbrales configurados (en bytes) y devuelve
 * una lista con los que se han superado. Si `throwOnExceeded` es true, lanza
 * un Error al superarse algún umbral.
 */
export async function validateSpace(
    thresholds: DockerSpaceThresholds = {},
    exec?: ExecOptions,
    throwOnExceeded = false
): Promise<{ exceeded: string[]; usage: DockerDiskUsage }> {
    const usage = await systemDf(exec);

    const map: Record<string, { actual: number; limit?: number; label: string }> = {
        images: { actual: usage.rows.find(r => /^images$/i.test(r.type))?.size ?? 0, limit: thresholds.images, label: "Imágenes" },
        containers: { actual: usage.rows.find(r => /^containers$/i.test(r.type))?.size ?? 0, limit: thresholds.containers, label: "Contenedores" },
        volumes: { actual: usage.rows.find(r => /volume/i.test(r.type))?.size ?? 0, limit: thresholds.volumes, label: "Volúmenes" },
        buildCache: { actual: usage.rows.find(r => /cache/i.test(r.type))?.size ?? 0, limit: thresholds.buildCache, label: "Caché de build" },
        reclaimable: { actual: usage.total.reclaimable, limit: thresholds.reclaimable, label: "Espacio reclaimable" }
    };

    const exceeded: string[] = [];
    for (const [, { actual, limit, label }] of Object.entries(map)) {
        if (limit !== undefined && actual > limit) {
            exceeded.push(`${label}: ${formatBytes(actual)} supera el umbral de ${formatBytes(limit)}`);
        }
    }

    if (throwOnExceeded && exceeded.length > 0) {
        throw new Error(`Espacio de docker por encima de los umbrales: ${exceeded.join("; ")}`);
    }

    return { exceeded, usage };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function parseSize(value: string): number {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-" || trimmed === "0B") return 0;
    const match = /^([\d.]+)\s*([kKmMgGtT]?)[bB]?$/.exec(trimmed);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const mult: Record<string, number> = { "": 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 };
    return Math.round(num * (mult[unit] ?? 1));
}

function composeNumber(value: string): number {
    const m = /(\d+)/.exec(value.trim());
    return m ? parseInt(m[1], 10) : 0;
}

function parseSystemDf(stdout: string): DockerDiskUsage {
    const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const headerIdx = lines.findIndex(l => /^TYPE/.test(l));
    if (headerIdx === -1) {
        return { rows: [], total: { type: "Total", total: 0, active: 0, size: 0, reclaimable: 0 }, raw: stdout };
    }

    const rows: DockerDiskUsageRow[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split(/\s{2,}/).map(c => c.trim());
        if (cols.length < 5) continue;
        rows.push({
            type: cols[0],
            total: composeNumber(cols[1]),
            active: composeNumber(cols[2]),
            size: parseSize(cols[3]),
            reclaimable: parseSize(cols[4].split(" ")[0])
        });
    }

    const total: DockerDiskUsageRow = {
        type: "Total",
        total: rows.reduce((s, r) => s + r.total, 0),
        active: rows.reduce((s, r) => s + r.active, 0),
        size: rows.reduce((s, r) => s + r.size, 0),
        reclaimable: rows.reduce((s, r) => s + r.reclaimable, 0)
    };

    return { rows, total, raw: stdout };
}

function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1000));
    const val = bytes / Math.pow(1000, Math.min(i, units.length - 1));
    return `${val.toFixed(1)} ${units[Math.min(i, units.length - 1)]}`;
}
