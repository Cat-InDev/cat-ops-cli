import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface DockerBuildOptions {
    image: string;
    context?: string;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
}

export interface DockerLoginOptions {
    registry: string;
    username: string;
    password: string;
}

export function build({
    image,
    context = ".",
    dockerfile,
    buildArgs = {}
}: DockerBuildOptions): Promise<ExecResult> {

    const args = ["build", "-t", image];

    if (dockerfile) {
        args.push("-f", dockerfile);
    }

    Object.entries(buildArgs).forEach(([k, v]) => {
        args.push("--build-arg", `${k}=${v}`);
    });

    args.push(context);

    return shell.exec("docker", ...args);

}

export function push(image: string): Promise<ExecResult> {
    return shell.exec("docker", "push", image);
}

export function tag(source: string, target: string): Promise<ExecResult> {
    return shell.exec("docker", "tag", source, target);
}

export function login({ registry, username, password }: DockerLoginOptions): Promise<ExecResult> {
    return shell.exec("docker", "login", registry, "-u", username, "-p", password);
}

export function pull(image: string): Promise<ExecResult> {
    return shell.exec("docker", "pull", image);
}

export function rmi(image: string): Promise<ExecResult> {
    return shell.exec("docker", "rmi", image);
}
