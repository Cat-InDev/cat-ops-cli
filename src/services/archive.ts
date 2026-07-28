import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export function zip(source: string, target: string): Promise<ExecResult> {
    return shell.exec("zip", "-r", target, source);
}

export function unzip(file: string, target: string): Promise<ExecResult> {
    return shell.exec("unzip", file, "-d", target);
}

export function tar(source: string, target: string): Promise<ExecResult> {
    return shell.exec("tar", "-czf", target, source);
}
