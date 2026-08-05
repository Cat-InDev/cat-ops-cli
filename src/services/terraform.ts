import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface TerraformInitOptions {
    backendConfig?: Record<string, string>;
    exec?: ExecOptions;
}

export interface TerraformPlanOptions {
    out?: string;
    varFile?: string;
    vars?: Record<string, string>;
    exec?: ExecOptions;
}

export interface TerraformApplyOptions {
    autoApprove?: boolean;
    planFile?: string;
    exec?: ExecOptions;
}

export interface TerraformDestroyOptions {
    autoApprove?: boolean;
    exec?: ExecOptions;
}

export interface TerraformFmtOptions {
    check?: boolean;
    exec?: ExecOptions;
}

export function init({ backendConfig = {}, exec }: TerraformInitOptions = {}): Promise<ExecResult> {

    const args = ["init"];

    Object.entries(backendConfig).forEach(([k, v]) => {
        args.push("-backend-config", `${k}=${v}`);
    });

    return shell.exec("terraform", ...withExecOptions(args, exec));

}

export function plan({ out, varFile, vars = {}, exec }: TerraformPlanOptions = {}): Promise<ExecResult> {

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

    return shell.exec("terraform", ...withExecOptions(args, exec));

}

export function apply({ autoApprove = true, planFile, exec }: TerraformApplyOptions = {}): Promise<ExecResult> {

    const args = ["apply"];

    if (autoApprove) {
        args.push("-auto-approve");
    }

    if (planFile) {
        args.push(planFile);
    }

    return shell.exec("terraform", ...withExecOptions(args, exec));

}

export function destroy({ autoApprove = true, exec }: TerraformDestroyOptions = {}): Promise<ExecResult> {

    const args = ["destroy"];

    if (autoApprove) {
        args.push("-auto-approve");
    }

    return shell.exec("terraform", ...withExecOptions(args, exec));

}

export function output(name?: string, exec?: ExecOptions): Promise<ExecResult> {

    const args = ["output", "-raw"];

    if (name) args.push(name);

    return shell.exec("terraform", ...withExecOptions(args, exec));

}

export function validate(exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("terraform", ...withExecOptions(["validate"], exec));
}

export function fmt({ check = false, exec }: TerraformFmtOptions = {}): Promise<ExecResult> {

    const args = ["fmt"];

    if (check) args.push("-check");

    return shell.exec("terraform", ...withExecOptions(args, exec));

}
