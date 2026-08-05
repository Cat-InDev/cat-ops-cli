import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface ArgoLoginOptions {
    server: string;
    username: string;
    password: string;
    insecure?: boolean;
    exec?: ExecOptions;
}

export interface ArgoSyncOptions {
    prune?: boolean;
    exec?: ExecOptions;
}

export interface ArgoWaitOptions {
    timeout?: number;
    exec?: ExecOptions;
}

export function login({ server, username, password, insecure = false, exec }: ArgoLoginOptions): Promise<ExecResult> {

    const args = ["login", server, "--username", username, "--password", password];

    if (insecure) {
        args.push("--insecure");
    }

    return shell.exec("argocd", ...withExecOptions(args, exec));

}

export function appSync(name: string, { prune = false, exec }: ArgoSyncOptions = {}): Promise<ExecResult> {

    const args = ["app", "sync", name];

    if (prune) {
        args.push("--prune");
    }

    return shell.exec("argocd", ...withExecOptions(args, exec));

}

export function appGet(name: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("argocd", ...withExecOptions(["app", "get", name], exec));
}

export function appWait(name: string, { timeout, exec }: ArgoWaitOptions = {}): Promise<ExecResult> {

    const args = ["app", "wait", name];

    if (timeout) {
        args.push("--timeout", String(timeout));
    }

    return shell.exec("argocd", ...withExecOptions(args, exec));

}

export function appSet(name: string, params: Record<string, string> = {}, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["app", "set", name];

    Object.entries(params).forEach(([k, v]) => {
        args.push("-p", `${k}=${v}`);
    });

    return shell.exec("argocd", ...withExecOptions(args, exec));

}

export function appList(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("argocd", ...withExecOptions(["app", "list"], exec));
}

export function appRollback(name: string, revisionId: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("argocd", ...withExecOptions(["app", "rollback", name, revisionId], exec));
}
