import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export function clone(url: string, targetPath: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["clone", url, targetPath], exec));
}

export function checkout(branch: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["checkout", branch], exec));
}

export function pull(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["pull"], exec));
}

export function fetch(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["fetch", "--all"], exec));
}

export function tag(name: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["tag", name], exec));
}

export function commit(message: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["commit", "-m", message], exec));
}

export function push(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["push"], exec));
}

export function revParse(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("git", ...withExecOptions(["rev-parse", "HEAD"], exec));
}
