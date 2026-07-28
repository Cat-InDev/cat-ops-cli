import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export function clone(url: string, targetPath: string): Promise<ExecResult> {
    return shell.exec("git", "clone", url, targetPath);
}

export function checkout(branch: string): Promise<ExecResult> {
    return shell.exec("git", "checkout", branch);
}

export function pull(): Promise<ExecResult> {
    return shell.exec("git", "pull");
}

export function fetch(): Promise<ExecResult> {
    return shell.exec("git", "fetch", "--all");
}

export function tag(name: string): Promise<ExecResult> {
    return shell.exec("git", "tag", name);
}

export function commit(message: string): Promise<ExecResult> {
    return shell.exec("git", "commit", "-m", message);
}

export function push(): Promise<ExecResult> {
    return shell.exec("git", "push");
}

export function revParse(): Promise<ExecResult> {
    return shell.exec("git", "rev-parse", "HEAD");
}
