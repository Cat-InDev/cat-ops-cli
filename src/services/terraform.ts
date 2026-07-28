import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface TerraformInitOptions {
    backendConfig?: Record<string, string>;
}

export interface TerraformPlanOptions {
    out?: string;
    varFile?: string;
    vars?: Record<string, string>;
}

export interface TerraformApplyOptions {
    autoApprove?: boolean;
    planFile?: string;
}

export interface TerraformDestroyOptions {
    autoApprove?: boolean;
}

export interface TerraformFmtOptions {
    check?: boolean;
}

export function init({ backendConfig = {} }: TerraformInitOptions = {}): Promise<ExecResult> {

    const args = ["init"];

    Object.entries(backendConfig).forEach(([k, v]) => {
        args.push("-backend-config", `${k}=${v}`);
    });

    return shell.exec("terraform", ...args);

}

export function plan({ out, varFile, vars = {} }: TerraformPlanOptions = {}): Promise<ExecResult> {

    const args = ["plan"];

    if (varFile) {
        args.push("-var-file", varFile);
    }

    Object.entries(vars).forEach(([k, v]) => {
        args.push("-var", `${k}=${v}`);
    });

    if (out) {
        args.push("-out", out);
    }

    return shell.exec("terraform", ...args);

}

export function apply({ autoApprove = true, planFile }: TerraformApplyOptions = {}): Promise<ExecResult> {

    const args = ["apply"];

    if (autoApprove) {
        args.push("-auto-approve");
    }

    if (planFile) {
        args.push(planFile);
    }

    return shell.exec("terraform", ...args);

}

export function destroy({ autoApprove = true }: TerraformDestroyOptions = {}): Promise<ExecResult> {

    const args = ["destroy"];

    if (autoApprove) {
        args.push("-auto-approve");
    }

    return shell.exec("terraform", ...args);

}

export function output(name?: string): Promise<ExecResult> {

    const args = ["output", "-raw"];

    if (name) args.push(name);

    return shell.exec("terraform", ...args);

}

export function validate(): Promise<ExecResult> {
    return shell.exec("terraform", "validate");
}

export function fmt({ check = false }: TerraformFmtOptions = {}): Promise<ExecResult> {

    const args = ["fmt"];

    if (check) args.push("-check");

    return shell.exec("terraform", ...args);

}
