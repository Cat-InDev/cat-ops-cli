import * as fs from "fs/promises";
import * as fssync from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { logger } from "../core/logger";
import type { ExecOptions, ExecResult } from "../core/types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Formato tipo `ls -l` para logs
function fmtMode(stat: fssync.Stats): string {
    const type = stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : stat.isFile() ? "-" : "?";
    const rwx = (bits: number): string =>
        (bits & 4 ? "r" : "-") + (bits & 2 ? "w" : "-") + (bits & 1 ? "x" : "-");
    return type + rwx((stat.mode >> 6) & 7) + rwx((stat.mode >> 3) & 7) + rwx(stat.mode & 7);
}

function fmtSize(stat: fssync.Stats, human?: boolean): string {
    const bytes = stat.size;
    if (!human) return String(bytes);
    const units = ["B", "K", "M", "G", "T"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`;
}

function fmtDate(stat: fssync.Stats): string {
    const d = new Date(stat.mtime);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ShellExecError extends ExecResult {
    message?: string;
}

class Shell {

    cwdPath: string = process.cwd();

    environment: NodeJS.ProcessEnv = { ...process.env };

    // Defaults globales, ajustables con shell.configure({...})
    // o por-llamada pasando un objeto de opciones al final de exec(...).
    defaults: ExecOptions = {
        retry: 1,
        retryDelay: 1000,
        timeout: 0,
        dryRun: false,
        shell: false,
        env: {}
    };

    configure(options: ExecOptions = {}): this {
        Object.assign(this.defaults, options);
        return this;
    }

    cwd(dir: string): this {
        this.cwdPath = path.resolve(dir);
        // Un cd explícito manda: descarta el cwd default fijado con configure()
        delete this.defaults.cwd;
        return this;
    }

    /**
     * Directorio de trabajo efectivo: el `cwd` de la llamada puntual, o el
     * default global fijado con `configure({ cwd })`, resuelto contra el
     * directorio actual del shell (`cwdPath`).
     */
    private _runCwd(options: ExecOptions): string {
        const cwd = options.cwd ?? this.defaults.cwd;
        return cwd ? path.resolve(this.cwdPath, cwd) : this.cwdPath;
    }

    /** Log extra con el directorio real de ejecución (EXEC-CWD). */
    private _logCwd(runCwd: string): void {
        logger.info(`EXEC-CWD: ${runCwd}`);
    }

    /**
     * Aplica dryRun + retry/retryDelay a operaciones de fs, igual que
     * `shell.exec` lo hace con los comandos.
     */
    private async _guard<T>(
        label: string,
        options: ExecOptions,
        op: () => T | Promise<T>,
        dryRunResult?: T
    ): Promise<T> {
        const opts = { ...this.defaults, ...options } as Required<ExecOptions>;
        if (opts.dryRun) {
            logger.warn(`DRY-RUN: no se ejecuta realmente "${label}"`);
            return dryRunResult as T;
        }
        const attempts = Math.max(1, opts.retry);
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await op();
            } catch (error) {
                lastError = error;
                if (attempt === attempts) break;
                logger.warn(
                    `Reintentando "${label}" (intento ${attempt + 1}/${attempts}) tras fallo`
                );
                if (opts.retryDelay > 0) {
                    await sleep(opts.retryDelay);
                }
            }
        }
        throw lastError;
    }

    env(name: string, value: string): this {
        this.environment[name] = value;
        return this;
    }

    /**
     * Crea un shell compartido: copia del shell actual con su propio estado
     * (cd/entorno/defaults). Ideal para `sh.cwd(repo)` y luego pasar `sh`
     * como `{ exec: { runner: sh } }` a cualquier servicio.
     */
    clone(): Shell {
        const copy = new Shell();
        copy.cwdPath = this.cwdPath;
        copy.environment = { ...this.environment };
        copy.defaults = { ...this.defaults };
        return copy;
    }

    private _execOnce(command: string, args: string[], options: Required<ExecOptions>): Promise<ExecResult> {

        return new Promise((resolve, reject) => {

            logger.info(`EXEC: ${command} ${args.join(" ")}`);

            const runCwd = options.cwd
                ? path.resolve(this.cwdPath, options.cwd)
                : this.cwdPath;

            logger.info(`EXEC-CWD: ${runCwd}`);

            if (options.dryRun) {

                logger.warn(
                    `DRY-RUN: no se ejecuta realmente "${command} ${args.join(" ")}"`
                );

                resolve({
                    code: 0,
                    stdout: "",
                    stderr: "",
                    dryRun: true,
                    command,
                    args
                });

                return;

            }

            const stdout: string[] = [];
            const stderr: string[] = [];

            const spawnEnv = options.env
                ? { ...this.environment, ...options.env }
                : this.environment;

            const child = spawn(
                command,
                args,
                {
                    cwd: runCwd,
                    env: spawnEnv,
                    shell: options.shell,
                    stdio: ["inherit", "pipe", "pipe"]
                }
            );

            let timedOut = false;
            let timer: NodeJS.Timeout | null = null;

            if (options.timeout > 0) {

                timer = setTimeout(() => {
                    timedOut = true;
                    logger.error(
                        `TIMEOUT: "${command}" excedió ${options.timeout}ms, se envía SIGTERM`
                    );
                    child.kill("SIGTERM");
                }, options.timeout);

            }

            child.stdout?.on("data", data => {
                const text = data.toString();
                stdout.push(text);
                logger.info(text.trimEnd());
            });

            child.stderr?.on("data", data => {
                const text = data.toString();
                stderr.push(text);
                logger.error(text.trimEnd());
            });

            child.on("close", code => {

                if (timer) clearTimeout(timer);

                const result: ExecResult = {
                    code,
                    stdout: stdout.join(""),
                    stderr: stderr.join(""),
                    timedOut,
                    command,
                    args
                };

                code === 0 && !timedOut
                    ? resolve(result)
                    : reject(result as ShellExecError);

            });

            child.on("error", error => {
                if (timer) clearTimeout(timer);
                Object.assign(error, { command, args });
                reject(error);
            });

        });

    }

    async exec(command: string, ...rawArgs: Array<string | ExecOptions>): Promise<ExecResult> {

        let args = rawArgs as string[];
        let callOptions: ExecOptions = {};

        const last = rawArgs[rawArgs.length - 1];

        if (rawArgs.length && isPlainObject(last)) {
            callOptions = last as ExecOptions;
            args = rawArgs.slice(0, -1) as string[];
        }

        // Shell compartido: se delega al runner (conserva su propio cd/env).
        const runner = callOptions.runner;
        if (runner && runner !== this) {
            const { runner: _runner, ...rest } = callOptions;
            return runner.exec(command, ...args, rest);
        }

        const options = {
            ...this.defaults,
            ...callOptions
        } as Required<ExecOptions>;

        const attempts = Math.max(1, options.retry);

        let lastError: unknown = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {

            try {

                return await this._execOnce(command, args, options);

            } catch (error) {

                lastError = error;

                const isLastAttempt = attempt === attempts;

                if (isLastAttempt) break;

                logger.warn(
                    `Reintentando "${command}" (intento ${attempt + 1}/${attempts}) tras fallo`
                );

                if (options.retryDelay > 0) {
                    await sleep(options.retryDelay);
                }

            }

        }

        throw lastError;

    }

    async exists(file: string, options: ExecOptions = {}): Promise<boolean> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.exists(file, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const full = path.resolve(runCwd, file);
        return this._guard(`exists ${full}`, options, () => fssync.existsSync(full), false);
    }

    async mkdir(dir: string, options: ExecOptions = {}): Promise<void> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.mkdir(dir, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const full = path.resolve(runCwd, dir);
        await this._guard(`mkdir ${full}`, options, () => fs.mkdir(full, { recursive: true }));
    }

    async remove(target: string, options: ExecOptions = {}): Promise<void> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.remove(target, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const full = path.resolve(runCwd, target);
        await this._guard(`remove ${full}`, options, () => fs.rm(full, { recursive: true, force: true }));
    }

    async copy(from: string, to: string, options: ExecOptions = {}): Promise<void> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.copy(from, to, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const fullFrom = path.resolve(runCwd, from);
        const fullTo = path.resolve(runCwd, to);
        await this._guard(`copy ${fullFrom} -> ${fullTo}`, options, () => fs.cp(fullFrom, fullTo, { recursive: true }));
    }

    async move(from: string, to: string, options: ExecOptions = {}): Promise<void> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.move(from, to, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const fullFrom = path.resolve(runCwd, from);
        const fullTo = path.resolve(runCwd, to);
        await this._guard(`move ${fullFrom} -> ${fullTo}`, options, () => fs.rename(fullFrom, fullTo));
    }

    async read(file: string, options: ExecOptions = {}): Promise<string> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.read(file, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const full = path.resolve(runCwd, file);
        return this._guard(`read ${full}`, options, () => fs.readFile(full, "utf8"), "");
    }

    async write(file: string, data: string, options: ExecOptions = {}): Promise<void> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.write(file, data, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const full = path.resolve(runCwd, file);
        await this._guard(`write ${full}`, options, () => fs.writeFile(full, data));
    }

    /** Imprime un mensaje en el log (helper de depuración) y lo devuelve. */
    async echo(message: string, options: ExecOptions = {}): Promise<string> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.echo(message, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        logger.info(message);
        return message;
    }

    /**
     * Lista un directorio. Opciones tipo `ls`: `all` (-a), `long` (-l),
     * `recursive` (-R), `directory` (-d) y `human` (-h). Con `long` imprime
     * el detalle (permisos, tamaño, fecha) en el log. Devuelve la lista de
     * nombres (con prefijo de ruta si es recursivo).
     */
    async ls(dir = ".", options: LsOptions = {}): Promise<string[]> {
        if (options.runner && options.runner !== this) {
            const { runner: _runner, ...rest } = options;
            return options.runner.ls(dir, rest);
        }
        const runCwd = this._runCwd(options);
        this._logCwd(runCwd);
        const fullDir = path.resolve(runCwd, dir);
        const flags = [
            options.all && "-a",
            options.long && "-l",
            options.recursive && "-R",
            options.directory && "-d",
            options.human && "-h"
        ].filter(Boolean).join(" ") || "-";
        logger.info(`LS: ${fullDir} (${flags})`);
        const out: string[] = [];

        const list = async (dirFull: string, base: string): Promise<void> => {
            const entries = await fs.readdir(dirFull, { withFileTypes: true });
            const visible = options.all ? entries : entries.filter(e => !e.name.startsWith("."));
            const sorted = visible.sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            for (const entry of sorted) {
                const rel = base ? `${base}/${entry.name}` : entry.name;
                if (options.long) {
                    const stat = await fs.stat(path.join(dirFull, entry.name));
                    logger.info(
                        `${fmtMode(stat)}  ${fmtSize(stat, options.human).padStart(8)}  ${fmtDate(stat)}  ${entry.isDirectory() ? rel + "/" : rel}`
                    );
                }
                out.push(rel);
                if (options.recursive && entry.isDirectory()) {
                    await list(path.join(dirFull, entry.name), rel);
                }
            }
        };

        await this._guard(`ls ${fullDir}`, options, async () => {
            if (options.directory) {
                const stat = await fs.stat(fullDir);
                if (options.long) {
                    logger.info(`${fmtMode(stat)}  ${fmtSize(stat, options.human).padStart(8)}  ${fmtDate(stat)}  ${dir}/`);
                }
                out.push(dir);
                return;
            }
            await list(fullDir, "");
        });

        return out;
    }

}

export const shell = new Shell();
export type { Shell };

/** Flags tipo `ls` que acompañan a `shell.ls(dir, { ... })`. */
export interface LsFlags {
    /** `-a`: incluye archivos ocultos (los que empiezan con `.`). */
    all?: boolean;
    /** `-l`: formato largo (permisos, tamaño, fecha) impreso en el log. */
    long?: boolean;
    /** `-R`: recorre subdirectorios recursivamente. */
    recursive?: boolean;
    /** `-d`: lista el propio directorio indicado, no su contenido. */
    directory?: boolean;
    /** `-h`: tamaños legibles (K/M/G) junto a `long`. */
    human?: boolean;
}

export type LsOptions = LsFlags & ExecOptions;

/**
 * Helper compartido por todos los servicios (docker, git, kubectl, ...):
 * arma la lista final de argumentos para `shell.exec`, agregando el objeto
 * `exec` (retry/timeout/dryRun) al final SOLO si se pasó, para que el
 * `retry`/`timeout`/`dryRun` de una llamada puntual llegue tal cual a
 * `shell.exec` sin que cada servicio tenga que reimplementar esta lógica.
 */
export function withExecOptions(args: string[], exec?: ExecOptions): Array<string | ExecOptions> {
    return exec ? [...args, exec] : args;
}
