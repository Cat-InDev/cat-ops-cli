import { shell, withExecOptions } from "./shell";
import type { ExecOptions, ExecResult } from "../core/types";

export interface AzLoginOptions {
    username: string;
    password: string;
    tenant: string;
    exec?: ExecOptions;
}

export interface AzAcrBuildOptions {
    registry: string;
    image: string;
    file?: string;
    exec?: ExecOptions;
}

export interface AzWebappDeployOptions {
    name: string;
    resourceGroup: string;
    srcPath: string;
    exec?: ExecOptions;
}

export interface AzAksCredentialsOptions {
    name: string;
    resourceGroup: string;
    overwriteExisting?: boolean;
    exec?: ExecOptions;
}

export interface AzDeploymentGroupOptions {
    resourceGroup: string;
    templateFile: string;
    parameters?: Record<string, string>;
    exec?: ExecOptions;
}

export function loginServicePrincipal({ username, password, tenant, exec }: AzLoginOptions): Promise<ExecResult> {

    const args = ["login", "--service-principal", "-u", username, "-p", password, "--tenant", tenant];

    return shell.exec("az", ...withExecOptions(args, exec));

}

export function setAccount(subscription: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("az", ...withExecOptions(["account", "set", "--subscription", subscription], exec));
}

export function acrBuild({ registry, image, file = ".", exec }: AzAcrBuildOptions): Promise<ExecResult> {

    const args = ["acr", "build", "--registry", registry, "--image", image, file];

    return shell.exec("az", ...withExecOptions(args, exec));

}

export function acrLogin(registry: string, exec?: ExecOptions): Promise<ExecResult> {
    return shell.exec("az", ...withExecOptions(["acr", "login", "--name", registry], exec));
}

export function webappDeploy({ name, resourceGroup, srcPath, exec }: AzWebappDeployOptions): Promise<ExecResult> {

    const args = ["webapp", "deploy", "--name", name, "--resource-group", resourceGroup, "--src-path", srcPath];

    return shell.exec("az", ...withExecOptions(args, exec));

}

export function aksGetCredentials({ name, resourceGroup, overwriteExisting = true, exec }: AzAksCredentialsOptions): Promise<ExecResult> {

    const args = [
        "aks", "get-credentials",
        "--name", name,
        "--resource-group", resourceGroup
    ];

    if (overwriteExisting) {
        args.push("--overwrite-existing");
    }

    return shell.exec("az", ...withExecOptions(args, exec));

}

export function deploymentGroupCreate({ resourceGroup, templateFile, parameters = {}, exec }: AzDeploymentGroupOptions): Promise<ExecResult> {

    const args = [
        "deployment", "group", "create",
        "--resource-group", resourceGroup,
        "--template-file", templateFile
    ];

    Object.entries(parameters).forEach(([k, v]) => {
        args.push("--parameters", `${k}=${v}`);
    });

    return shell.exec("az", ...withExecOptions(args, exec));

}
