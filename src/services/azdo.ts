// Azure Pipelines "logging commands": https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands
// Estos deben imprimirse en stdout tal cual, sin el formato/color del logger interno,
// porque el agente de Azure DevOps los parsea línea por línea.

function escape(value: unknown): string {
    return String(value)
        .replace(/%/g, "%AZP25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A")
        .replace(/]/g, "%5D")
        .replace(/;/g, "%3B");
}

function print(command: string, properties: Record<string, unknown>, message = ""): void {

    const props = Object.entries(properties)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${escape(v)}`)
        .join(";");

    console.log(`##vso[${command}${props ? ` ${props}` : ""}]${message}`);

}

export interface SetVariableOptions {
    isSecret?: boolean;
    isOutput?: boolean;
}

export function setVariable(name: string, value: unknown, { isSecret = false, isOutput = false }: SetVariableOptions = {}): void {
    print("task.setvariable", { variable: name, issecret: isSecret, isoutput: isOutput }, String(value));
}

export function logError(message: string): void {
    print("task.logissue", { type: "error" }, message);
}

export function logWarning(message: string): void {
    print("task.logissue", { type: "warning" }, message);
}

export function setProgress(percent: number, currentOperation = ""): void {
    print("task.setprogress", { value: percent }, currentOperation);
}

export function complete(result: "Succeeded" | "SucceededWithIssues" | "Failed" = "Succeeded", message = ""): void {
    print("task.complete", { result }, message);
}

export function addBuildTag(tag: string): void {
    print("build.addbuildtag", {}, tag);
}

export function uploadArtifact(name: string, path: string, containerFolder = ""): void {
    print("artifact.upload", { artifactname: name, containerfolder: containerFolder }, path);
}

export function group(name: string): void {
    console.log(`##[group]${name}`);
}

export function endGroup(): void {
    console.log("##[endgroup]");
}
