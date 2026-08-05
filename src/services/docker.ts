import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface DockerBuildOptions {
    image: string;
    context?: string;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
    /** retry/timeout/dryRun para esta llamada puntual. */
    exec?: ExecOptions;
}

export interface DockerLoginOptions {
    registry: string;
    username: string;
    password: string;
    exec?: ExecOptions;
}

export function build({
    image,
    context = ".",
    dockerfile,
    buildArgs = {},
    exec
}: DockerBuildOptions): Promise<ExecResult> {

    const args = ["build", "-t", image];

    if (dockerfile) {
        args.push("-f", dockerfile);
    }

    Object.entries(buildArgs).forEach(([k, v]) => {
        args.push("--build-arg", `${k}=${v}`);
    });

    args.push(context);

    return shell.exec("docker", ...withExecOptions(args, exec));

}

export function push(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["push", image], exec));
}

export function tag(source: string, target: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["tag", source, target], exec));
}

export function login({ registry, username, password, exec }: DockerLoginOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["login", registry, "-u", username, "-p", password], exec));
}

export function pull(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["pull", image], exec));
}

export function rmi(image: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("docker", ...withExecOptions(["rmi", image], exec));
}
