import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export function install(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("npm", ...withExecOptions(["install"], exec));
}

export function ci(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("npm", ...withExecOptions(["ci"], exec));
}

export function run(script: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("npm", ...withExecOptions(["run", script], exec));
}

export function publish(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("npm", ...withExecOptions(["publish"], exec));
}
