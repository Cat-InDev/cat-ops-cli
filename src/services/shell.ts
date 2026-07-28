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

interface ShellExecError extends ExecResult {
    message?: string;
}

class Shell {

    cwdPath: string = process.cwd();

    environment: NodeJS.ProcessEnv = { ...process.env };

    // Defaults globales, ajustables con shell.configure({...})
    // o por-llamada pasando un objeto de opciones al final de exec(...).
    defaults: Required<ExecOptions> = {
        retry: 1,
        retryDelay: 1000,
        timeout: 0,
        dryRun: false
    };

    configure(options: ExecOptions = {}): this {
        Object.assign(this.defaults, options);
        return this;
    }

    cwd(dir: string): this {
        this.cwdPath = path.resolve(dir);
        return this;
    }

    env(name: string, value: string): this {
        this.environment[name] = value;
        return this;
    }

    private _execOnce(command: string, args: string[], options: Required<ExecOptions>): Promise<ExecResult> {

        return new Promise((resolve, reject) => {

            logger.info(`EXEC: ${command} ${args.join(" ")}`);

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

            const child = spawn(
                command,
                args,
                {
                    cwd: this.cwdPath,
                    env: this.environment,
                    shell: false,
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

        const options: Required<ExecOptions> = {
            ...this.defaults,
            ...callOptions
        };

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

    async exists(file: string): Promise<boolean> {
        return fssync.existsSync(file);
    }

    async mkdir(dir: string): Promise<void> {
        await fs.mkdir(dir, { recursive: true });
    }

    async remove(target: string): Promise<void> {
        await fs.rm(target, { recursive: true, force: true });
    }

    async copy(from: string, to: string): Promise<void> {
        await fs.cp(from, to, { recursive: true });
    }

    async move(from: string, to: string): Promise<void> {
        await fs.rename(from, to);
    }

    async read(file: string): Promise<string> {
        return fs.readFile(file, "utf8");
    }

    async write(file: string, data: string): Promise<void> {
        await fs.writeFile(file, data);
    }

}

export const shell = new Shell();
export type { Shell };
