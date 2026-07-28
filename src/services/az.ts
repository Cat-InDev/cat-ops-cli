import { shell } from "./shell";
import type { ExecResult } from "../core/types";

export interface AzLoginOptions {
    username: string;
    password: string;
    tenant: string;
}

export interface AzAcrBuildOptions {
    registry: string;
    image: string;
    file?: string;
}

export interface AzWebappDeployOptions {
    name: string;
    resourceGroup: string;
    srcPath: string;
}

export interface AzAksCredentialsOptions {
    name: string;
    resourceGroup: string;
    overwriteExisting?: boolean;
}

export interface AzDeploymentGroupOptions {
    resourceGroup: string;
    templateFile: string;
    parameters?: Record<string, string>;
}

export function loginServicePrincipal({ username, password, tenant }: AzLoginOptions): Promise<ExecResult> {

    return shell.exec(
        "az", "login",
        "--service-principal",
        "-u", username,
        "-p", password,
        "--tenant", tenant
    );

}

export function setAccount(subscription: string): Promise<ExecResult> {
    return shell.exec("az", "account", "set", "--subscription", subscription);
}

export function acrBuild({ registry, image, file = "." }: AzAcrBuildOptions): Promise<ExecResult> {

    return shell.exec(
        "az", "acr", "build",
        "--registry", registry,
        "--image", image,
        file
    );

}

export function acrLogin(registry: string): Promise<ExecResult> {
    return shell.exec("az", "acr", "login", "--name", registry);
}

export function webappDeploy({ name, resourceGroup, srcPath }: AzWebappDeployOptions): Promise<ExecResult> {

    return shell.exec(
        "az", "webapp", "deploy",
        "--name", name,
        "--resource-group", resourceGroup,
        "--src-path", srcPath
    );

}

export function aksGetCredentials({ name, resourceGroup, overwriteExisting = true }: AzAksCredentialsOptions): Promise<ExecResult> {

    const args = [
        "aks", "get-credentials",
        "--name", name,
        "--resource-group", resourceGroup
    ];

    if (overwriteExisting) {
        args.push("--overwrite-existing");
    }

    return shell.exec("az", ...args);

}

export function deploymentGroupCreate({ resourceGroup, templateFile, parameters = {} }: AzDeploymentGroupOptions): Promise<ExecResult> {

    const args = [
        "deployment", "group", "create",
        "--resource-group", resourceGroup,
        "--template-file", templateFile
    ];

    Object.entries(parameters).forEach(([k, v]) => {
        args.push("--parameters", `${k}=${v}`);
    });

    return shell.exec("az", ...args);

}
