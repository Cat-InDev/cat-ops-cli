import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface ArgoLoginOptions {
    server: string;
    username: string;
    password: string;
    insecure?: boolean;
}

export interface ArgoSyncOptions {
    prune?: boolean;
}

export interface ArgoWaitOptions {
    timeout?: number;
}

export function login({ server, username, password, insecure = false }: ArgoLoginOptions): Promise<ExecResult> {

    const args = ["login", server, "--username", username, "--password", password];

    if (insecure) {
        args.push("--insecure");
    }

    return shell.exec("argocd", ...args);

}

export function appSync(name: string, { prune = false }: ArgoSyncOptions = {}): Promise<ExecResult> {

    const args = ["app", "sync", name];

    if (prune) {
        args.push("--prune");
    }

    return shell.exec("argocd", ...args);

}

export function appGet(name: string): Promise<ExecResult> {
    return shell.exec("argocd", "app", "get", name);
}

export function appWait(name: string, { timeout }: ArgoWaitOptions = {}): Promise<ExecResult> {

    const args = ["app", "wait", name];

    if (timeout) {
        args.push("--timeout", String(timeout));
    }

    return shell.exec("argocd", ...args);

}

export function appSet(name: string, params: Record<string, string> = {}): Promise<ExecResult> {

    const args = ["app", "set", name];

    Object.entries(params).forEach(([k, v]) => {
        args.push("-p", `${k}=${v}`);
    });

    return shell.exec("argocd", ...args);

}

export function appList(): Promise<ExecResult> {
    return shell.exec("argocd", "app", "list");
}

export function appRollback(name: string, revisionId: string): Promise<ExecResult> {
    return shell.exec("argocd", "app", "rollback", name, revisionId);
}
