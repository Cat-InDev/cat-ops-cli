import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export function apply(file: string): Promise<ExecResult> {
    return shell.exec("kubectl", "apply", "-f", file);
}

export function del(file: string): Promise<ExecResult> {
    return shell.exec("kubectl", "delete", "-f", file);
}

export function get(...args: string[]): Promise<ExecResult> {
    return shell.exec("kubectl", "get", ...args);
}

export function logs(pod: string): Promise<ExecResult> {
    return shell.exec("kubectl", "logs", pod);
}

export function rolloutStatus(deployment: string): Promise<ExecResult> {
    return shell.exec("kubectl", "rollout", "status", deployment);
}

export function setImage(resource: string, image: string): Promise<ExecResult> {
    return shell.exec("kubectl", "set", "image", resource, image);
}

export { del as delete };
