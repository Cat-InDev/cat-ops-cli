import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

// ---------------------------------------------------------------------------
// Base común: toda función de git acepta exec (retry/timeout/dryRun) ya sea
// como objeto plano al final (git.push({ retry: 3 })), o embebido en el
// objeto de opciones (git.push({ remote: "origin", exec: { retry: 3 } })).
// ---------------------------------------------------------------------------

export interface GitCommon {
    /** retry/timeout/dryRun para esta llamada puntual (ver shell.exec). */
    exec?: ExecOptions;
}

const EXEC_KEYS: ReadonlyArray<keyof ExecOptions> = ["retry", "retryDelay", "timeout", "dryRun", "shell", "env"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** True si el objeto solo contiene claves de ExecOptions (retry/timeout/dryRun/env...). */
export function isBareExec(value: unknown): value is ExecOptions {
    if (!isRecord(value)) return false;
    return Object.keys(value).every(key => (EXEC_KEYS as readonly string[]).includes(key));
}

/** Separa los argumentos posicionales (strings) del objeto de opciones final. */
function splitArgs<T extends object>(rawArgs: Array<string | T>): { positional: string[]; options: T } {
    const positional: string[] = [];
    let options = {} as T;
    for (const arg of rawArgs) {
        if (typeof arg === "string") positional.push(arg);
        else if (isRecord(arg)) options = arg as T;
    }
    return { positional, options };
}

/** Devuelve el ExecOptions a pasar a shell.exec, o undefined si el objeto está vacío. */
function toExec(value: GitCommon | ExecOptions | undefined): ExecOptions | undefined {
    if (value === undefined) return undefined;
    if (isBareExec(value)) {
        return Object.keys(value).length ? value : undefined;
    }
    return value.exec;
}

/** Normaliza el último argumento: objeto de opciones o ExecOptions plano. */
function lastOptions<T extends GitCommon>(opts?: T | ExecOptions): { options: T; exec: ExecOptions | undefined } {
    if (opts === undefined || isBareExec(opts)) {
        return { options: {} as T, exec: toExec(opts) };
    }
    return { options: opts as T, exec: opts.exec };
}

function toTargets(files: string[] | string): string[] {
    return Array.isArray(files) ? files : [files];
}

// ---------------------------------------------------------------------------
// clone
// ---------------------------------------------------------------------------

export interface GitCloneOptions extends GitCommon {
    /** `--branch <name>`: rama a clonar en lugar de la default. */
    branch?: string;
    /** `--depth <n>`: clon shallow con n historias. */
    depth?: number;
    /** `--bare`: clon sin working tree (para repos remotos de despliegue). */
    bare?: boolean;
    /** `--single-branch`: clona solo la rama indicada, sin las demás refs. */
    singleBranch?: boolean;
}

export function clone(url: string, targetPath: string, opts: GitCloneOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitCloneOptions>(opts);
    const args = ["clone"];
    if (options.branch) args.push("--branch", options.branch);
    if (options.depth !== undefined) args.push("--depth", String(options.depth));
    if (options.bare) args.push("--bare");
    if (options.singleBranch) args.push("--single-branch");
    args.push(url, targetPath);
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// checkout / branch
// ---------------------------------------------------------------------------

export interface GitCheckoutOptions extends GitCommon {
    /** `-b`: crear la rama y pasarse a ella. */
    create?: boolean;
    /** `--track`: crear la rama con upstream hacia una remota. */
    track?: boolean;
    /** `-f`: descartar cambios locales en conflicto. */
    force?: boolean;
    /** `--detach`: dejar HEAD en detached. */
    detach?: boolean;
    /** Rama/commit base cuando se crea (`git checkout -b dev origin/dev`). */
    startPoint?: string;
}

export function checkout(branch: string, opts: GitCheckoutOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitCheckoutOptions>(opts);
    const args = ["checkout"];
    if (options.create) args.push("-b");
    if (options.track) args.push("--track");
    if (options.force) args.push("-f");
    if (options.detach) args.push("--detach");
    args.push(branch);
    if (options.startPoint) args.push(options.startPoint);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitBranchOptions extends GitCommon {
    /** Crea una rama: `git branch <create> [startPoint]`. */
    create?: string;
    /** Punto de partida al crear la rama. */
    startPoint?: string;
    /** `-f`: recrea/reapunta la rama existente. */
    forceCreate?: boolean;
    /** Borra una rama con `-d` (solo si está fusionada). */
    delete?: string;
    /** Borra con `-D`, ignorando estado de fusión. */
    forceDelete?: string;
    /** `--show-current`: imprime la rama actual. */
    showCurrent?: boolean;
    /** `-a`: lista también ramas remotas. */
    all?: boolean;
}

export function branch(opts: GitBranchOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitBranchOptions>(opts);
    const args = ["branch"];
    if (options.showCurrent) args.push("--show-current");
    if (options.all) args.push("--all");
    if (options.delete || options.forceDelete) {
        const target = options.delete || options.forceDelete!;
        args.push(options.forceDelete ? "-D" : "-d", target);
    } else if (options.create) {
        if (options.forceCreate) args.push("-f");
        args.push(options.create);
        if (options.startPoint) args.push(options.startPoint);
    }
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// pull / fetch
// ---------------------------------------------------------------------------

export interface GitPullOptions extends GitCommon {
    /** Origin/repositorio a traer (`git pull <remote>`). */
    remote?: string;
    /** Rama/refspec a traer (`git pull origin main`). */
    branch?: string;
    /** `--rebase`: reaplica el trabajo local sobre el remoto. */
    rebase?: boolean;
    /** `--no-rebase`: fuerza merge en vez de rebase. */
    noRebase?: boolean;
    /** `--ff-only`: solo avanza si se puede hacer fast-forward. */
    ffOnly?: boolean;
    /** `--no-ff`: crea commit de merge aunque haya fast-forward. */
    noFF?: boolean;
    /** `--prune`: borra refs remotas que desaparecieron. */
    prune?: boolean;
    /** `--tags`: trae también las etiquetas. */
    tags?: boolean;
}

export function pull(opts: GitPullOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitPullOptions>(opts);
    const args = ["pull"];
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    if (options.rebase) args.push("--rebase");
    if (options.noRebase) args.push("--no-rebase");
    if (options.ffOnly) args.push("--ff-only");
    if (options.noFF) args.push("--no-ff");
    if (options.prune) args.push("--prune");
    if (options.tags) args.push("--tags");
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitFetchOptions extends GitCommon {
    /** Remote a fetchear; al indicarlo se omite `--all`. */
    remote?: string;
    /** Rama específica a fetchear. */
    branch?: string;
    /** `--depth <n>`: solo las n historias más recientes. */
    depth?: number;
    /** `--unshallow`: convierte un clon shallow en completo. */
    unshallow?: boolean;
    /** `--prune`: borra refs remotas huérfanas. */
    prune?: boolean;
    /** `--tags`: descarga también las etiquetas. */
    tags?: boolean;
    /** `--all` (default true si no se indica remote). */
    all?: boolean;
}

export function fetch(opts: GitFetchOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitFetchOptions>(opts);
    const args = ["fetch"];
    if (options.depth !== undefined) args.push("--depth", String(options.depth));
    if (options.unshallow) args.push("--unshallow");
    if (options.prune) args.push("--prune");
    if (options.tags) args.push("--tags");
    if (options.remote) {
        args.push(options.remote);
        if (options.branch) args.push(options.branch);
    } else if (options.all !== false) {
        args.push("--all");
    }
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// add / commit / push
// ---------------------------------------------------------------------------

export interface GitAddOptions extends GitCommon {
    /** `-A`: agrega también archivos borrados/renombrados del working tree. */
    all?: boolean;
    /** `-u`: solo actualiza archivos ya rastreados. */
    update?: boolean;
    /** `-f`: agrega archivos ignorados por .gitignore. */
    force?: boolean;
}

export function add(files: string[] | string, opts: GitAddOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitAddOptions>(opts);
    const args = ["add"];
    if (options.all) args.push("-A");
    if (options.update) args.push("-u");
    if (options.force) args.push("-f");
    args.push(...toTargets(files));
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitCommitOptions extends GitCommon {
    /** Archivos a agregar automáticamente antes del commit (o "."). */
    files?: string[] | string;
    /** `-a`: hace add de los archivos modificados/eliminados rastreados. */
    all?: boolean;
    /** `--allow-empty`: permite commit sin cambios. */
    allowEmpty?: boolean;
    /** `--amend`: reemplaza el último commit en vez de crear uno nuevo. */
    amend?: boolean;
}

/** Versión tipo: se traen los archivos indicados (si hay) y se commitea. */
export async function commit(message: string, ...rest: Array<string[] | string | GitCommitOptions>): Promise<ExecResult> {
    const files: string[] = [];
    let options: GitCommitOptions = {};
    for (const arg of rest) {
        if (typeof arg === "string" || Array.isArray(arg)) {
            files.push(...toTargets(arg as string[] | string));
        } else if (isRecord(arg)) {
            options = arg as GitCommitOptions;
        }
    }
    const exec = toExec(options);
    const targets = [...files, ...toTargets(options.files ?? [])];
    if (targets.length > 0) {
        await add(targets, exec);
    }
    const args = ["commit"];
    if (options.all) args.push("-a");
    if (options.allowEmpty) args.push("--allow-empty");
    if (options.amend) args.push("--amend");
    args.push("-m", message);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitPushOptions extends GitCommon {
    /** Remote destino (ej. "origin"). */
    remote?: string;
    /** Rama/refspec a publicar (ej. "main"). */
    branch?: string;
    /** `--tags`: publica también las etiquetas. */
    tags?: boolean;
    /** `--force`: fuerza el push descartando conflicto remoto. */
    force?: boolean;
    /** `--force-with-lease`: fuerza solo si el remoto no avanzó desde nuestro fetch. */
    forceWithLease?: boolean;
    /** `-u`: setea el upstream para próximos pull/push sin argumentos. */
    setUpstream?: boolean;
}

/** `git.push("origin", "main")` o `git.push({ remote: "origin", branch: "main", force: true })`. */
export function push(...rawArgs: Array<string | GitPushOptions>): Promise<ExecResult> {
    const { positional, options } = splitArgs<GitPushOptions>(rawArgs);
    const exec = toExec(options);
    const args = ["push"];
    const remote = options.remote ?? positional[0];
    const branch = options.branch ?? positional[1];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    if (options.tags) args.push("--tags");
    if (options.force) args.push("--force");
    else if (options.forceWithLease) args.push("--force-with-lease");
    if (options.setUpstream) args.push("-u");
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// tag
// ---------------------------------------------------------------------------

export interface GitTagOptions extends GitCommon {
    /** `-m <mgs>` con `-a`: crea una tag anotada con mensaje. */
    message?: string;
    /** `-a`: fuerza tag anotada (suele combinarse con message). */
    annotated?: boolean;
    /** `-f`: reemplaza una tag existente. */
    force?: boolean;
}

export function tag(name: string, opts: GitTagOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitTagOptions>(opts);
    const args = ["tag"];
    if (options.annotated || options.message) args.push("-a");
    if (options.force) args.push("-f");
    args.push(name);
    if (options.message) args.push("-m", options.message);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export function tagDelete(name: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["tag", "-d", name], exec));
}

export interface GitTagListOptions extends GitCommon {
    /** Patrón de filtro (ej. "v1.*"). */
    pattern?: string;
    /** `--sort=-creatordate`: ordena por fecha de creación. */
    sort?: string;
}

export function tagList(opts: GitTagListOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitTagListOptions>(opts);
    const args = ["tag", "--list"];
    if (options.sort) args.push(`--sort=${options.sort}`);
    if (options.pattern) args.push(options.pattern);
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// merge / rebase
// ---------------------------------------------------------------------------

export interface GitMergeOptions extends GitCommon {
    /** `-m <msg>`: mensaje del commit de merge. */
    message?: string;
    /** `--no-edit`: usa el mensaje default sin abrir editor. */
    noEdit?: boolean;
    /** `--ff-only`: aborta si no se puede hacer fast-forward. */
    ffOnly?: boolean;
    /** `--no-ff`: crea commit de merge aunque haya fast-forward. */
    noFF?: boolean;
    /** `--abort`: aborta un merge en conflicto. */
    abort?: boolean;
}

export function merge(branch: string, opts: GitMergeOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitMergeOptions>(opts);
    const args = ["merge"];
    if (options.noEdit) args.push("--no-edit");
    if (options.ffOnly) args.push("--ff-only");
    if (options.noFF) args.push("--no-ff");
    if (options.abort) args.push("--abort");
    else {
        if (options.message) args.push("-m", options.message);
        args.push(branch);
    }
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitRebaseOptions extends GitCommon {
    /** Rama base (`git rebase main`). */
    branch?: string;
    /** `--onto <base>`: base concreta para reaplicar. */
    onto?: string;
    /** `--interactive`: abre editor para reordenar commits. */
    interactive?: boolean;
    /** `--continue`: continúa tras resolver conflictos. */
    continue?: boolean;
    /** `--abort`: aborta el rebase en curso. */
    abort?: boolean;
    /** `--skip`: salta el commit conflictivo. */
    skip?: boolean;
}

export function rebase(opts: GitRebaseOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitRebaseOptions>(opts);
    const args = ["rebase"];
    if (options.interactive) args.push("--interactive");
    if (options.continue) args.push("--continue");
    if (options.abort) args.push("--abort");
    if (options.skip) args.push("--skip");
    if (options.onto) args.push("--onto", options.onto);
    if (options.branch) args.push(options.branch);
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// status / log / diff / show
// ---------------------------------------------------------------------------

export interface GitStatusOptions extends GitCommon {
    /** `-s`: salida corta. */
    short?: boolean;
    /** `-b`: muestra la rama actual (con -s). */
    branch?: boolean;
    /** `--porcelain`: salida estable para scripting. */
    porcelain?: boolean;
    /** `--untracked-files=no|normal|all`. */
    untrackedFiles?: "no" | "normal" | "all";
}

export function status(opts: GitStatusOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitStatusOptions>(opts);
    const args = ["status"];
    if (options.short) args.push("-s");
    if (options.branch) args.push("-b");
    if (options.porcelain) args.push("--porcelain");
    if (options.untrackedFiles !== undefined) args.push(`--untracked-files=${options.untrackedFiles}`);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitLogOptions extends GitCommon {
    /** `--max-count <n>`: limita a los n commits más recientes. */
    maxCount?: number;
    /** `--since <fecha>`: commits desde una fecha/expresión. */
    since?: string;
    /** `--until <fecha>`: commits hasta una fecha/expresión. */
    until?: string;
    /** `--author <patron>`: filtra por autor. */
    author?: string;
    /** `--oneline`: resumen de una línea por commit. */
    oneline?: boolean;
    /** `--graph`: muestra el grafo de ramas. */
    graph?: boolean;
    /** `--all`: incluye todas las ramas. */
    allBranches?: boolean;
    /** `--pretty=format:<fmt>`: formato personalizado (NOTA: usa %h, %s, %an, ...). */
    format?: string;
    /** Rama o rango a consultar. */
    branch?: string;
}

export function log(opts: GitLogOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitLogOptions>(opts);
    const args = ["log"];
    if (options.maxCount !== undefined) args.push("--max-count", String(options.maxCount));
    if (options.since) args.push("--since", options.since);
    if (options.until) args.push("--until", options.until);
    if (options.author) args.push("--author", options.author);
    if (options.oneline) args.push("--oneline");
    if (options.graph) args.push("--graph");
    if (options.allBranches) args.push("--all");
    if (options.format) args.push(`--pretty=format:${options.format}`);
    if (options.branch) args.push(options.branch);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitDiffOptions extends GitCommon {
    /** `--cached`: diff del índice (staged). */
    cached?: boolean;
    /** `--stat`: resumen de archivos cambiados. */
    stat?: boolean;
    /** `--name-only`: solo nombres de archivos. */
    nameOnly?: boolean;
    /** Archivos/rangos a comparar. */
    files?: string[] | string;
}

export function diff(opts: GitDiffOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitDiffOptions>(opts);
    const args = ["diff"];
    if (options.cached) args.push("--cached");
    if (options.stat) args.push("--stat");
    if (options.nameOnly) args.push("--name-only");
    args.push(...toTargets(options.files ?? []));
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitShowOptions extends GitCommon {
    /** `--stat`: resumen de archivos del commit. */
    stat?: boolean;
    /** `--name-only`: solo nombres de archivos. */
    nameOnly?: boolean;
}

export function show(ref: string, opts: GitShowOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitShowOptions>(opts);
    const args = ["show"];
    if (options.stat) args.push("--stat");
    if (options.nameOnly) args.push("--name-only");
    args.push(ref);
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// remote
// ---------------------------------------------------------------------------

export interface GitRemoteOptions extends GitCommon {
    /** `-v`: lista remotes con sus URLs. */
    verbose?: boolean;
    /** `git remote show <name>`: detalle de un remote. */
    show?: string;
    /** `git remote get-url <name>`. */
    getUrl?: string;
}

export function remote(opts: GitRemoteOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitRemoteOptions>(opts);
    const args = ["remote"];
    if (options.verbose) args.push("-v");
    if (options.show) args.push("show", options.show);
    else if (options.getUrl) args.push("get-url", options.getUrl);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export function remoteAdd(name: string, url: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["remote", "add", name, url], exec));
}

export function remoteRemove(name: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["remote", "remove", name], exec));
}

export function remoteSetUrl(name: string, url: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["remote", "set-url", name, url], exec));
}

// ---------------------------------------------------------------------------
// stash
// ---------------------------------------------------------------------------

export interface GitStashOptions extends GitCommon {
    /** `-m <msg>`: mensaje descriptivo del stash. */
    message?: string;
    /** `-k`: mantiene el índice (deja staged lo que estaba staged). */
    keepIndex?: boolean;
    /** `-u`: incluye archivos untracked. */
    includeUntracked?: boolean;
    /** `-q`: sin salida. */
    quiet?: boolean;
}

export function stashPush(opts: GitStashOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitStashOptions>(opts);
    const args = ["stash", "push"];
    if (options.quiet) args.push("-q");
    if (options.keepIndex) args.push("-k");
    if (options.includeUntracked) args.push("-u");
    if (options.message) args.push("-m", options.message);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitStashIndexOptions extends GitCommon {
    /** Índice del stash: `stash@{n}`. */
    index?: number;
}

export function stashPop(opts: GitStashIndexOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitStashIndexOptions>(opts);
    const args = ["stash", "pop"];
    if (options.index !== undefined) args.push(`stash@{${options.index}}`);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export function stashApply(opts: GitStashIndexOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitStashIndexOptions>(opts);
    const args = ["stash", "apply"];
    if (options.index !== undefined) args.push(`stash@{${options.index}}`);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export function stashList(opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["stash", "list"], exec));
}

export function stashDrop(opts: GitStashIndexOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitStashIndexOptions>(opts);
    const args = ["stash", "drop"];
    if (options.index !== undefined) args.push(`stash@{${options.index}}`);
    return shell.exec("git", ...withExecOptions(args, exec));
}

// ---------------------------------------------------------------------------
// reset / init / config / rev-parse
// ---------------------------------------------------------------------------

export interface GitResetOptions extends GitCommon {
    /** `--soft | --mixed | --hard`. */
    mode?: "soft" | "mixed" | "hard";
    /** Commit al que volver (por defecto HEAD). */
    commit?: string;
}

export function reset(opts: GitResetOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitResetOptions>(opts);
    const args = ["reset"];
    if (options.mode) args.push(`--${options.mode}`);
    if (options.commit) args.push(options.commit);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export interface GitInitOptions extends GitCommon {
    /** `--bare`: repo sin working tree. */
    bare?: boolean;
    /** `-b <name>`: rama inicial (ej. "main"). */
    initialBranch?: string;
}

export function init(opts: GitInitOptions | ExecOptions = {}): Promise<ExecResult> {
    const { options, exec } = lastOptions<GitInitOptions>(opts);
    const args = ["init"];
    if (options.bare) args.push("--bare");
    if (options.initialBranch) args.push("-b", options.initialBranch);
    return shell.exec("git", ...withExecOptions(args, exec));
}

export function configGet(name: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["config", "--get", name], exec));
}

export function configSet(name: string, value: string, opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["config", name, value], exec));
}

export function configList(opts: GitCommon | ExecOptions = {}): Promise<ExecResult> {
    const { exec } = lastOptions<GitCommon>(opts);
    return shell.exec("git", ...withExecOptions(["config", "--list"], exec));
}

export interface GitRevParseOptions extends GitCommon {
    /** Ref a resolver (por defecto "HEAD"). */
    ref?: string;
    /** `--short`: SHA abreviado. */
    short?: boolean;
    /** `--verify`: falla si el ref no existe. */
    verify?: boolean;
    /** `--abbrev-ref`: nombre corto de la rama (branch actual). */
    abbrevRef?: boolean;
    /** `--show-toplevel`: ruta absoluta de la raíz del repo. */
    showTopLevel?: boolean;
}

/** `revParse()`, `revParse("HEAD~1")` o `revParse({ short: true })`. */
export function revParse(...rawArgs: Array<string | GitRevParseOptions>): Promise<ExecResult> {
    const { positional, options } = splitArgs<GitRevParseOptions>(rawArgs);
    const exec = toExec(options);
    const args = ["rev-parse"];
    if (options.short) args.push("--short");
    if (options.verify) args.push("--verify");
    if (options.abbrevRef) args.push("--abbrev-ref");
    if (options.showTopLevel) args.push("--show-toplevel");
    args.push(options.ref ?? positional[0] ?? "HEAD");
    return shell.exec("git", ...withExecOptions(args, exec));
}