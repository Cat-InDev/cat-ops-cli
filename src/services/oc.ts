import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface OcLoginOptions {
    server: string;
    token?: string;
    username?: string;
    password?: string;
    insecureSkipTlsVerify?: boolean;
}

export interface OcStartBuildOptions {
    follow?: boolean;
}

export function login({ server, token, username, password, insecureSkipTlsVerify = false }: OcLoginOptions): Promise<ExecResult> {

    const args = ["login", server];

    if (token) {
        args.push("--token", token);
    } else {
        args.push("-u", username ?? "", "-p", password ?? "");
    }

    if (insecureSkipTlsVerify) {
        args.push("--insecure-skip-tls-verify");
    }

    return shell.exec("oc", ...args);

}

export function project(name: string): Promise<ExecResult> {
    return shell.exec("oc", "project", name);
}

export function apply(file: string): Promise<ExecResult> {
    return shell.exec("oc", "apply", "-f", file);
}

export function get(...args: string[]): Promise<ExecResult> {
    return shell.exec("oc", "get", ...args);
}

export function rollout(deployment: string): Promise<ExecResult> {
    return shell.exec("oc", "rollout", "status", `dc/${deployment}`);
}

export function newApp(...args: string[]): Promise<ExecResult> {
    return shell.exec("oc", "new-app", ...args);
}

export function startBuild(buildConfig: string, { follow = true }: OcStartBuildOptions = {}): Promise<ExecResult> {

    const args = ["start-build", buildConfig];

    if (follow) {
        args.push("-F");
    }

    return shell.exec("oc", ...args);

}

export function logs(pod: string): Promise<ExecResult> {
    return shell.exec("oc", "logs", pod);
}
