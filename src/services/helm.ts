import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export function install(name: string, chart: string, values?: string): Promise<ExecResult> {

    const args = ["install", name, chart];

    if (values) {
        args.push("-f", values);
    }

    return shell.exec("helm", ...args);

}

export function upgrade(name: string, chart: string, values?: string): Promise<ExecResult> {

    const args = ["upgrade", name, chart];

    if (values) {
        args.push("-f", values);
    }

    return shell.exec("helm", ...args);

}

export function uninstall(name: string): Promise<ExecResult> {
    return shell.exec("helm", "uninstall", name);
}
