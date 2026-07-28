import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface TektonPipelineStartOptions {
    params?: Record<string, string>;
    workspace?: string;
    serviceAccount?: string;
}

export interface TektonLogsOptions {
    follow?: boolean;
}

export function pipelineStart(name: string, { params = {}, workspace, serviceAccount }: TektonPipelineStartOptions = {}): Promise<ExecResult> {

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

    return shell.exec("tkn", ...args);

}

export function pipelinerunList(pipelineName?: string): Promise<ExecResult> {

    const args = ["pipelinerun", "list"];

    if (pipelineName) {
        args.push(pipelineName);
    }

    return shell.exec("tkn", ...args);

}

export function pipelinerunLogs(name: string, { follow = true }: TektonLogsOptions = {}): Promise<ExecResult> {

    const args = ["pipelinerun", "logs", name];

    if (follow) {
        args.push("-f");
    }

    return shell.exec("tkn", ...args);

}

export function taskStart(name: string, params: Record<string, string> = {}): Promise<ExecResult> {

    const args = ["task", "start", name];

    Object.entries(params).forEach(([k, v]) => {
        args.push("-p", `${k}=${v}`);
    });

    return shell.exec("tkn", ...args);

}

export function taskrunLogs(name: string): Promise<ExecResult> {
    return shell.exec("tkn", "taskrun", "logs", name, "-f");
}
