import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export function install(): Promise<ExecResult> {
    return shell.exec("npm", "install");
}

export function ci(): Promise<ExecResult> {
    return shell.exec("npm", "ci");
}

export function run(script: string): Promise<ExecResult> {
    return shell.exec("npm", "run", script);
}

export function publish(): Promise<ExecResult> {
    return shell.exec("npm", "publish");
}
