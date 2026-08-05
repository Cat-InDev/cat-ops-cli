import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface AnsiblePlaybookOptions {
    inventory?: string;
    extraVars?: Record<string, string>;
    tags?: string;
    exec?: ExecOptions;
}

export function playbook(playbookPath: string, { inventory, extraVars = {}, tags, exec }: AnsiblePlaybookOptions = {}): Promise<ExecResult> {

    const args = ["-i", inventory || "inventory.ini", playbookPath];

    Object.entries(extraVars).forEach(([k, v]) => {
        args.push("--extra-vars", `${k}=${v}`);
    });

    if (tags) {
        args.push("--tags", tags);
    }

    return shell.exec("ansible-playbook", ...withExecOptions(args, exec));

}

export function adhoc(host: string, module: string, moduleArgs?: string, exec?: ExecOptions): Promise<ExecResult> {

    const args = [host, "-m", module];

    if (moduleArgs) {
        args.push("-a", moduleArgs);
    }

    return shell.exec("ansible", ...withExecOptions(args, exec));

}

export function vaultEncrypt(file: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("ansible-vault", ...withExecOptions(["encrypt", file], exec));
}

export function vaultDecrypt(file: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("ansible-vault", ...withExecOptions(["decrypt", file], exec));
}

export function galaxyInstall(requirementsFile: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("ansible-galaxy", ...withExecOptions(["install", "-r", requirementsFile], exec));
}
