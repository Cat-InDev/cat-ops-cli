import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface TektonPipelineStartOptions {
    params?: Record<string, string>;
    workspace?: string;
    serviceAccount?: string;
    exec?: ExecOptions;
}

export interface TektonLogsOptions {
    follow?: boolean;
    exec?: ExecOptions;
}

export function pipelineStart(name: string, { params = {}, workspace, serviceAccount, exec }: TektonPipelineStartOptions = {}): Promise<ExecResult> {

    const args = ["pipeline", "start", name];

    Object.entries(params).forEach(([k, v]) => {
        args.push("-p", `${k}=${v}`);
    });

    if (workspace) {
        args.push("-w", workspace);
    }

    if (serviceAccount) {
        args.push("-s", serviceAccount);
    }

    return shell.exec("tkn", ...withExecOptions(args, exec));

}

export function pipelinerunList(pipelineName?: string, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["pipelinerun", "list"];

    if (pipelineName) {
        args.push(pipelineName);
    }

    return shell.exec("tkn", ...withExecOptions(args, exec));

}

export function pipelinerunLogs(name: string, { follow = true, exec }: TektonLogsOptions = {}): Promise<ExecResult> {

    const args = ["pipelinerun", "logs", name];

    if (follow) {
        args.push("-f");
    }

    return shell.exec("tkn", ...withExecOptions(args, exec));

}

export function taskStart(name: string, params: Record<string, string> = {}, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["task", "start", name];

    Object.entries(params).forEach(([k, v]) => {
        args.push("-p", `${k}=${v}`);
    });

    return shell.exec("tkn", ...withExecOptions(args, exec));

}

export function taskrunLogs(name: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("tkn", ...withExecOptions(["taskrun", "logs", name, "-f"], exec));
}
