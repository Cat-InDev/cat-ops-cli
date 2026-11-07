import type { Context } from "./Context";

// ---------------------------------------------------------------------------
// shell.exec
// ---------------------------------------------------------------------------

export interface ExecResult {
    code: number | null;
    stdout: string;
    stderr: string;
    dryRun?: boolean;
    timedOut?: boolean;
    /** Comando ejecutado, útil para clasificar errores por área de TI. */
    command?: string;
    args?: string[];
}

/** Shell que mantiene su propio contexto (cwd/env) y puede compartirse entre servicios. */
export interface ShellRunner {
    /** Directorio de trabajo actual (`cd`) del shell. */
    cwdPath: string;
    /** Ejecuta el comando en el contexto de este shell. */
    exec(command: string, ...rawArgs: Array<string | ExecOptions>): Promise<ExecResult>;
    /** Verifica si existe un archivo/carpeta (resuelto contra el cwd del shell). */
    exists(file: string, options?: ExecOptions): Promise<boolean>;
    /** Crea un directorio (recursivo) en el contexto de este shell. */
    mkdir(dir: string, options?: ExecOptions): Promise<void>;
    /** Elimina un archivo/carpeta en el contexto de este shell. */
    remove(target: string, options?: ExecOptions): Promise<void>;
    /** Copia un archivo/carpeta en el contexto de este shell. */
    copy(from: string, to: string, options?: ExecOptions): Promise<void>;
    /** Mueve/renombra un archivo/carpeta en el contexto de este shell. */
    move(from: string, to: string, options?: ExecOptions): Promise<void>;
    /** Lee un archivo en el contexto de este shell. */
    read(file: string, options?: ExecOptions): Promise<string>;
    /** Escribe un archivo en el contexto de este shell. */
    write(file: string, data: string, options?: ExecOptions): Promise<void>;
    /** Imprime un mensaje en el log y lo devuelve. */
    echo(message: string, options?: ExecOptions): Promise<string>;
    /** Lista un directorio en el contexto de este shell. */
    ls(dir?: string, options?: ExecOptions): Promise<string[]>;
}

export interface ExecOptions {
    /** Número total de intentos (1 = sin retry). Default: 1 */
    retry?: number;
    /** Milisegundos de espera entre reintentos. Default: 1000 */
    retryDelay?: number;
    /** Milisegundos antes de matar el proceso con SIGTERM. Default: 0 (sin límite) */
    timeout?: number;
    /** Si es true, solo loguea el comando y no lo ejecuta. Default: false */
    dryRun?: boolean;
    /** Si se quiere ejecutar comandos en el shell del sistema directamente. Default: false */
    shell?: boolean;
    /** Variables de entorno adicionales para este llamada. Se fusionan con el entorno actual. */
    env?: NodeJS.ProcessEnv;
    /** Directorio de trabajo para esta llamada puntual (equivale a un `cd` antes del comando). */
    cwd?: string;
    /** Shell compartido (con su propio `cd`/env) en el que ejecutar este comando. */
    runner?: ShellRunner;
    /**
     * Si es true, no imprime el comando ni su stdout/stderr (solo con DEBUG).
     * El resultado se retorna igual. Útil para consultas internas repetitivas
     * (p. ej. el polling de `waitForDeployment`). Default: false
     */
    silent?: boolean;
}

// ---------------------------------------------------------------------------
// ServiceError — error enriquecido con metadata del servicio
// ---------------------------------------------------------------------------

/**
 * Error generado por `ctx.wrap()` cuando un servicio falla. Enriches el error
 * original con el nombre del servicio, el método invocado y los argumentos,
 * para que classifiers y formatters puedan resolver el área y el mensaje
 * humano a partir de esa metadata.
 *
 * La propiedad `cause` contiene el error original (puede ser un ExecResult,
 * un HttpError, un Error nativo, etc.).
 */
export class ServiceError extends Error {
    readonly service: string;
    readonly method: string;
    readonly args: unknown[];
    readonly cause: unknown;

    constructor(service: string, method: string, args: unknown[], cause: unknown) {
        const originalMessage = cause instanceof Error
            ? cause.message
            : (cause as { message?: string })?.message ?? String(cause);

        super(`${service}.${method}: ${originalMessage}`);

        this.name = "ServiceError";
        this.service = service;
        this.method = method;
        this.args = args;
        this.cause = cause;

        if (cause instanceof Error && cause.stack) {
            this.stack = `${this.message}\n\n--- Original stack ---\n${cause.stack}`;
        }
    }
}

// ---------------------------------------------------------------------------
// Callbacks de éxito/error por tarea
// ---------------------------------------------------------------------------

export type SuccessCallback<T = unknown> = (result: T, ctx: Context) => unknown | Promise<unknown>;
export type ErrorCallback = (error: unknown, ctx: Context) => unknown | Promise<unknown>;

export interface TaskHooks<T = unknown> {
    onSuccess?: SuccessCallback<T>;
    onError?: ErrorCallback;
}

// ---------------------------------------------------------------------------
// Notificaciones: clasificación de errores por área de TI + canales + senders
// ---------------------------------------------------------------------------

export interface NotificationEvent {
    type: "success" | "error";
    /** Id de la tarea (taskId de ctx.run(), o el label del item de menú). */
    taskId: string;
    /** Área de TI a la que se enrutó el error (solo en eventos de error). */
    area?: string;
    error?: unknown;
    result?: unknown;
    message: string;
    timestamp: string;
    /** Servicio que falló (solo en errores de servicios envueltos con ctx.wrap). */
    service?: string;
    /** Método del servicio que falló. */
    method?: string;
    /** Argumentos pasados al método. */
    args?: unknown[];
}

/**
 * Determina a qué área de TI corresponde un error. Devuelve el nombre del
 * área (usado luego para buscar los senders registrados en esa área vía
 * notifier.channel(area, ...senders)), o `undefined` si esta función no
 * sabe clasificar ese error (se prueba el siguiente classifier registrado).
 */
export type ErrorClassifier = (error: unknown, ctx: Context) => string | undefined;

/** Un sender recibe el evento ya armado y lo entrega por el medio que sea. */
export type Sender = (event: NotificationEvent) => unknown | Promise<unknown>;

// ---------------------------------------------------------------------------
// Menu / selectores
// ---------------------------------------------------------------------------

/** Una task ejecutable de un item de menú. Recibe el Context activo. */
export type MenuTask = (ctx: Context) => unknown | Promise<unknown>;

/**
 * Forma "larga" de un item de menú, usada cuando necesitas asociarle un
 * selector (para poder elegirlo automáticamente vía flag), callbacks de
 * éxito/error, o ambos, además de su acción o submenú.
 *
 * Ejemplo:
 *   Build: {
 *       selector: "build",
 *       action: async (ctx) => {...},
 *       onSuccess: (result, ctx) => {...},
 *       onError: (error, ctx) => {...}
 *   }
 *   Docker: { selector: "docker", menu: dockerMenu }
 */
export interface MenuOptionWithSelector {
    /** Valor que debe matchear el flag definido en "flag-selector" del menú padre. */
    selector?: string;
    /** Task a ejecutar si este item es una hoja. */
    action?: MenuTask;
    /** Submenú a renderizar si este item lleva a otro nivel. */
    menu?: MenuDefinition;
    /** Se llama si `action` resuelve exitosamente. */
    onSuccess?: SuccessCallback;
    /** Se llama si `action` lanza un error (además de reportarse al notifier). */
    onError?: ErrorCallback;
}

/**
 * Valor de un item de menú. Puede ser:
 *   - una función (task directa, sin selector ni callbacks)
 *   - un MenuDefinition (submenú directo, sin selector)
 *   - un MenuOptionWithSelector (para poder asignarle selector y/o callbacks)
 */
export type MenuOptionValue = MenuTask | MenuDefinition | MenuOptionWithSelector;

export interface MenuDefinition {
    title: string;
    /**
     * Nombre del flag (con o sin "--") que, al recibir un valor que matchee
     * el "selector" de alguno de los items, selecciona esa opción de forma
     * automática y no interactiva.
     *
     * Ejemplo: "flag-selector": "--menu-selector"
     * Uso:     catops-cli --menu-selector=build
     */
    "flag-selector"?: string;
    options: Record<string, MenuOptionValue>;
}

export interface ResolvedMenuEntry {
    kind: "task" | "menu";
    selector?: string;
    run?: MenuTask;
    menu?: MenuDefinition;
    onSuccess?: SuccessCallback;
    onError?: ErrorCallback;
}

/**
 * Igual que ErrorClassifier, pero en vez de decidir el área, devuelve el
 * mensaje humano que se va a reportar (reemplazando el stderr/mensaje crudo
 * del error). Devuelve `undefined` si no sabe describir ese error (se
 * prueba el siguiente formatter registrado, y si ninguno matchea se usa el
 * mensaje crudo del error como antes).
 */
export type ErrorMessageFormatter = (error: unknown, ctx: Context) => string | undefined;