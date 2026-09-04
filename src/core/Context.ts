import { logger, type Logger } from "./logger";
import * as prompt from "./prompt";
import { services, type ServicesRegistry } from "../services";
import { Notifier } from "./Notifier";
import type { AskOptions, ConfirmOptions, SelectChoices } from "./prompt";
import type { TaskHooks } from "./types";
import { ServiceError } from "./types";

export type FlagValue = boolean | string;

export class Context {

    private static instance: Context | null = null;

    flags: Record<string, FlagValue> = {};
    params: Record<string, string> = {};
    env: NodeJS.ProcessEnv;
    vars: Record<string, unknown> = {};
    results: Record<string, unknown> = {};
    failures: Array<{ label: string; error: unknown }> = [];
    logger: Logger = logger;
    services: ServicesRegistry = services;
    notifier: Notifier = new Notifier();
    config: Record<string, unknown> = {};
    state: Record<string, unknown> = {};

    constructor() {
        this.env = this.services.shell.environment;
    }

    static current(): Context {
        if (!Context.instance) {
            Context.instance = new Context();
        }
        return Context.instance;
    }

    /** Reinicia el singleton. Útil sobre todo en tests. */
    static reset(): Context {
        Context.instance = new Context();
        Context.instance.services.shell.environment = { ...process.env };
        Context.instance.env = Context.instance.services.shell.environment;
        return Context.instance;
    }

    // ---- flags ----

    setFlag(name: string, value: FlagValue = true): this {
        this.flags[name] = value;
        return this;
    }

    getFlag(name: string): FlagValue | undefined {
        return this.flags[name];
    }

    hasFlag(name: string): boolean {
        return Boolean(this.flags[name]);
    }

    // ---- vars ----

    set<T = unknown>(name: string, value: T): this {
        this.vars[name] = value;
        return this;
    }

    get<T = unknown>(name: string): T | undefined {
        return this.vars[name] as T | undefined;
    }

    // ---- results del pipe ----

    /**
     * Registra una task fallida (label + error). El CLI usa esto al final
     * para decidir el exit code: si hubo fallos, sale con código 1 aunque
     * el menú haya seguido funcionando.
     */
    markFailure(label: string, error: unknown): this {
        this.failures.push({ label, error });
        return this;
    }

    hasFailures(): boolean {
        return this.failures.length > 0;
    }


    /**
     * Ejecuta una task, guarda su resultado en `ctx.results[taskId]`, y
     * dispara los callbacks de éxito/error correspondientes:
     *   1. `hooks.onSuccess` / `hooks.onError` (si los pasaste), y
     *   2. el `notifier` global (clasifica el error por área de TI y
     *      lo reporta a los canales registrados con `ctx.notifier.channel(...)`).
     *
     * Si la task lanza, el error se re-lanza después de notificar, para no
     * esconder fallas silenciosamente.
     */
    async run<T>(
        taskId: string,
        callback: (ctx: Context) => Promise<T> | T,
        hooks: TaskHooks<T> = {}
    ): Promise<T> {

        try {

            const value = await callback(this);
            this.results[taskId] = value;

            await hooks.onSuccess?.(value, this);
            await this.notifier.reportSuccess(taskId, value, this);

            return value;

        } catch (error) {

            await hooks.onError?.(error, this);
            await this.notifier.reportError(taskId, error, this);

            throw error;

        }

    }

    /**
     * Envuelve un objeto de servicio (o cualquier objeto con métodos) en un
     * Proxy que intercepta cada llamada a método. Si el método lanza un error,
     * lo envuelve en un `ServiceError` con metadata del servicio (nombre,
     * método, argumentos) y lo despacha al notifier antes de re-lanzarlo.
     *
     * Ejemplo:
     *   const docker = ctx.wrap(ctx.services.docker, "docker");
     *   await docker.push("myimage:latest");
     *   // Si falla, el notifier recibe:
     *   //   taskId: 'docker.push("myimage:latest")'
     *   //   error: ServiceError { service: "docker", method: "push", args: [...], cause: ExecResult }
     */
    wrap<T extends Record<string, (...args: any[]) => any>>(service: T, serviceName: string): T {
        const ctx = this;
        return new Proxy(service, {
            get(target, prop, receiver) {
                const original = Reflect.get(target, prop, receiver);
                if (typeof original !== "function") return original;
                return async function (this: unknown, ...args: unknown[]) {
                    try {
                        return await original.apply(target, args);
                    } catch (error) {
                        const methodName = String(prop);
                        const serializedArgs = args.map(a => {
                            try { return JSON.stringify(a); } catch { return String(a); }
                        }).join(", ");
                        const taskId = `${serviceName}.${methodName}(${serializedArgs})`;
                        const wrapped = new ServiceError(serviceName, methodName, args, error);
                        await ctx.notifier.reportError(taskId, wrapped, ctx);
                        throw wrapped;
                    }
                };
            }
        });
    }

    // ---- prompts ----

    async ask(question: string, options?: AskOptions): Promise<string | undefined> {
        return prompt.ask(question, options);
    }

    async confirm(question: string, options?: ConfirmOptions): Promise<boolean> {
        return prompt.confirm(question, options);
    }

    async select(title: string, choices: SelectChoices): Promise<string> {
        return prompt.select(title, choices);
    }

    // ---- inicialización desde argv ----

    static parseArgv(argv: string[] = process.argv.slice(2)): Context {

        const ctx = Context.current();

        argv.forEach(arg => {

            if (arg.startsWith("--")) {

                const [key, value] = arg.slice(2).split("=");

                if (value === undefined) {
                    ctx.setFlag(key, true);
                } else {
                    ctx.params[key] = value;
                }

            }

        });

        // Flags globales que reconfiguran shell.exec para todo el proceso,
        // sin que ninguna task tenga que pasarlos manualmente.
        const shellOptions: { dryRun?: boolean; retry?: number; timeout?: number } = {};

        if (ctx.hasFlag("dry-run") || ctx.hasFlag("dryRun")) {
            shellOptions.dryRun = true;
        }

        if (ctx.params.retry !== undefined) {
            shellOptions.retry = parseInt(ctx.params.retry, 10);
        }

        if (ctx.params.timeout !== undefined) {
            shellOptions.timeout = parseInt(ctx.params.timeout, 10);
        }

        if (Object.keys(shellOptions).length) {
            ctx.services.shell.configure(shellOptions);
        }

        return ctx;

    }

}
