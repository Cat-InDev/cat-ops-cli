import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export function zip(source: string, target: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("zip", ...withExecOptions(["-r", target, source], exec));
}

export function unzip(file: string, target: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("unzip", ...withExecOptions([file, "-d", target], exec));
}

export function tar(source: string, target: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("tar", ...withExecOptions(["-czf", target, source], exec));
}
