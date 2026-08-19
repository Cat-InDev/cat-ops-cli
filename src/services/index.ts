import { shell } from "./shell";
import * as docker from "./docker";
import * as git from "./git";
import * as kubectl from "./kubectl";
import * as helm from "./helm";
import * as npm from "./npm";
import * as archive from "./archive";
import * as terraform from "./terraform";
import * as ansible from "./ansible";
import * as argocd from "./argocd";
import * as tekton from "./tekton";
import * as oc from "./oc";
import * as az from "./az";
import * as azdo from "./azdo";
import * as http from "./http";
import { PipelineRegistry } from "./pipeline";

export const services = {
    shell,
    docker,
    git,
    kubectl,
    helm,
    npm,
    archive,
    terraform,
    ansible,
    argocd,
    tekton,
    oc,
    az,
    azdo,
    http,
    pipeline: new PipelineRegistry()
};

export type ServicesRegistry = typeof services;

export {
    shell,
    docker,
    git,
    kubectl,
    helm,
    npm,
    archive,
    terraform,
    ansible,
    argocd,
    tekton,
    oc,
    az,
    azdo,
    http
};

export { PipelineRegistry } from "./pipeline";
