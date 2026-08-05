import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export function install(name: string, chart: string, values?: string, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["install", name, chart];

    if (values) {
        args.push("-f", values);
    }

    return shell.exec("helm", ...withExecOptions(args, exec));

}

export function upgrade(name: string, chart: string, values?: string, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["upgrade", name, chart];

    if (values) {
        args.push("-f", values);
    }

    return shell.exec("helm", ...withExecOptions(args, exec));

}

export function uninstall(name: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("helm", ...withExecOptions(["uninstall", name], exec));
}
