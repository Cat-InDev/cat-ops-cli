import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface AnsiblePlaybookOptions {
    inventory?: string;
    extraVars?: Record<string, string>;
    tags?: string;
}

export function playbook(playbookPath: string, { inventory, extraVars = {}, tags }: AnsiblePlaybookOptions = {}): Promise<ExecResult> {

    const args = ["-i", inventory || "inventory.ini", playbookPath];

    Object.entries(extraVars).forEach(([k, v]) => {
        args.push("--extra-vars", `${k}=${v}`);
    });

    if (tags) {
        args.push("--tags", tags);
    }

    return shell.exec("ansible-playbook", ...args);

}

export function adhoc(host: string, module: string, moduleArgs?: string): Promise<ExecResult> {

    const args = [host, "-m", module];

    if (moduleArgs) {
        args.push("-a", moduleArgs);
    }

    return shell.exec("ansible", ...args);

}

export function vaultEncrypt(file: string): Promise<ExecResult> {
    return shell.exec("ansible-vault", "encrypt", file);
}

export function vaultDecrypt(file: string): Promise<ExecResult> {
    return shell.exec("ansible-vault", "decrypt", file);
}

export function galaxyInstall(requirementsFile: string): Promise<ExecResult> {
    return shell.exec("ansible-galaxy", "install", "-r", requirementsFile);
}
