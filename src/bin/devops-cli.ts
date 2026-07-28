#!/usr/bin/env node

import * as path from "path";
import * as fs from "fs";
import { Context } from "../core/Context";
import { Menu } from "../core/Menu";
import { logger } from "../core/logger";
import type { MenuDefinition } from "../core/types";

const CONFIG_CANDIDATES = [
    "devops.pipeline.js",
    "devops.config.js",
    ".catops-cli.js"
];

function findConfig(): string | null {

    const cwd = process.cwd();

    for (const file of CONFIG_CANDIDATES) {

        const fullPath = path.join(cwd, file);

        if (fs.existsSync(fullPath)) {
            return fullPath;
        }

    }

    return null;

}

function printHelp(): void {

    console.log(`
catops-cli — framework CLI para pipelines DevOps

Uso:
  catops-cli [--flag] [--param=valor]

Este comando busca, en el directorio actual, uno de estos archivos:
  ${CONFIG_CANDIDATES.join("\n  ")}

Ese archivo debe exportar una definición de menú, por ejemplo:

  // devops.pipeline.js
  module.exports = (ctx) => ({
      title: "Pipeline",
      "flag-selector": "--menu-selector",
      options: {
          Build: {
              selector: "build",
              action: async () => {
                  await ctx.services.docker.build({
                      image: "registry/app:v1",
                      dockerfile: "Dockerfile"
                  });
              }
          },
          Deploy: {
              selector: "deploy",
              action: async () => {
                  await ctx.services.kubectl.apply("deployment.yaml");
              }
          }
      }
  });

Con esa definición, ambas formas funcionan:

  catops-cli                       # menú interactivo
  catops-cli --menu-selector=build # ejecuta "Build" directamente, sin prompts

Si "Deploy" fuera un submenú anidado con su propio "flag-selector", se puede
encadenar en un solo comando, por ejemplo:

  catops-cli --menu-selector=deploy --deploy-target=staging

También puedes usar la librería directamente en tu código:

  const { Context, Menu } = require("catops-cli");
  import { Context, Menu } from "catops-cli"; // con tipados, en TS
`);

}

interface PipelineModule {
    (ctx: Context): MenuDefinition | Promise<MenuDefinition>;
}

async function main(): Promise<void> {

    const configPath = findConfig();

    if (!configPath) {
        printHelp();
        process.exit(0);
    }

    const ctx = Context.parseArgv();

    if (ctx.hasFlag("help") || ctx.hasFlag("h")) {
        printHelp();
        process.exit(0);
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const definitionFactory = require(configPath) as PipelineModule | MenuDefinition;

    const definition = typeof definitionFactory === "function"
        ? await definitionFactory(ctx)
        : definitionFactory;

    logger.info(`Usando configuración: ${path.relative(process.cwd(), configPath)}`);

    await Menu.render(definition, ctx);

}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exit(1);
});
