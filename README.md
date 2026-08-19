# catops-cli

Framework para pipelines DevOps, escrito en **TypeScript** (100% usable desde JavaScript puro), empaquetado como librería npm instalable en cualquier proyecto.

Trae:

- Un **ExecutionContext** compartido (`flags`, `params`, `env`, `vars`, `results`, `logger`, `services`, `notifier`) para que ninguna task tenga que recibir parámetros manualmente.
- **15 servicios** listos (`shell`, `docker`, `git`, `kubectl`, `helm`, `npm`, `archive`, `terraform`, `ansible`, `argocd`, `tekton`, `oc`, `az`, `azdo`, `http`) + un **cliente REST API** para Azure DevOps (`AzureDevOpsApi`) + un **motor de pipelines** declarativo con dependencias (`Pipeline`).
- **Servicio HTTP** con interceptores de request/response, registry de agentes nombrados, configuración global, query params, dry-run y timeout.
- **Menús interactivos** con navegación anidada y **selección automática por flag** (para correr pipelines sin prompts, ideal para CI).
- **retry / timeout / dryRun** en cada comando de shell.
- Validación cíclica de rollouts de Kubernetes/OpenShift (`waitForDeployment`, `waitForDeploymentGroup`).
- **Callbacks de éxito/error por tarea** + un sistema de **notificaciones clasificadas por área de TI**, con mensajes personalizables y senders (`log`, `file`, `http`, `webhook`, `websocket`). Incluye `ctx.wrap()` para monitoreo automático de servicios con metadata de servicio/método/argumentos.

## Instalación

**Opción A — publicado en tu registro npm (público o privado tipo Verdaccio/Artifactory/GitHub Packages):**

```bash
npm install catops-cli
# o si lo publicas con scope propio, p.ej. @miorg/catops-cli
npm install @miorg/catops-cli
```

**Opción B — sin publicar, directo desde este proyecto (útil mientras lo maduras):**

```bash
# Dentro del repo de catops-cli
npm pack               # genera catops-cli-<version>.tgz

# Dentro del proyecto que lo va a consumir
npm install /ruta/a/catops-cli-<version>.tgz
```

**Opción C — enlazado local con `npm link` (para desarrollar la librería y el proyecto que la consume al mismo tiempo):**

```bash
# Dentro del repo de catops-cli
npm link

# Dentro del proyecto consumidor
npm link catops-cli
```

**Opción D — como dependencia de Git (monorepo o repo privado, sin registro npm):**

```bash
npm install git+https://github.com/tu-org/catops-cli.git
```

Cualquiera de las 4 deja disponibles dos cosas en el proyecto consumidor:

1. La librería, tanto desde TS como desde JS puro:
   ```typescript
   import { Context, Menu, services, type MenuDefinition } from "catops-cli";
   ```
   ```javascript
   const { Context, Menu, services } = require("catops-cli");
   ```
2. El binario: `npx catops-cli` (o `catops-cli` si lo instalaste global con `-g`).

## Publicar una nueva versión

```bash
npm version patch   # o minor / major
npm publish         # agrega --access public si usas un scope (@miorg/catops-cli)
```

`prepublishOnly` corre el build y los tests automáticamente antes de publicar.

## TypeScript

Todo `src/` está escrito en TypeScript, con `strict: true`. `npm run build` compila a `dist/` (JS + `.d.ts` + source maps por archivo) — eso es lo único que se publica (ver `files` en `package.json`).

```
src/
  core/
    Context.ts       -> ExecutionContext singleton (Context.current() / Context.parseArgv() / ctx.wrap())
    Menu.ts           -> Menu.render() con navegación anidada + selección automática por flag
    Notifier.ts       -> clasificación de errores por área + canales + senders
    classifiers.ts    -> fábricas de ErrorClassifier: byCommand, byPattern, byService
    messages.ts        -> fábricas de ErrorMessageFormatter: byPattern, byCommand, byRule, byService
    senders.ts          -> fábricas de Sender: log, file, http, webhook, websocket
    prompt.ts            -> ctx.ask / ctx.confirm / ctx.select (sin dependencias externas)
    logger.ts             -> logger usado por Context y por shell.ts
    types.ts               -> tipos compartidos (MenuDefinition, ExecOptions, NotificationEvent, ServiceError, ...)
  services/
    shell.ts          -> motor base (spawn), con retry/timeout/dryRun
    http.ts           -> cliente HTTP con interceptores de request/response, múltiples instancias
    http-types.ts     -> tipos del servicio HTTP (HttpRequest, HttpResponse, interceptors, ...)
    docker.ts, git.ts, kubectl.ts, helm.ts, npm.ts, archive.ts
    terraform.ts, ansible.ts, argocd.ts, tekton.ts, oc.ts,     az.ts, azdo.ts, azdo-api.ts, pipeline.ts
    index.ts           -> registra todos los servicios anteriores (ServicesRegistry)
  index.ts             -> entry point público: Context, Menu, Notifier, senders, classifiers, messages, services, http, tipos
  bin/
    devops-cli.ts      -> CLI ejecutable (busca devops.pipeline.js en el proyecto consumidor)
examples/
  pipeline-example.js  -> pipeline + menú + notificaciones de ejemplo, corre contra dist/
test/
    context.test.js, shell.test.js, services.test.js, menu-selector.test.js,
  notifier.test.js, senders.test.js, hooks-integration.test.js,
  http.test.js, kubectl.test.js, oc.test.js, deployment-group.test.js,
  exec-options-passthrough.test.js, azdo-api.test.js, pipeline.test.js,
  service-notify.test.js
```

## Uso rápido: menú con `devops.pipeline.js` + el bin

Crea un `devops.pipeline.js` (o `devops.config.js` / `.catops-cli.js`) en la raíz de tu proyecto:

```javascript
// devops.pipeline.js
module.exports = (ctx) => ({
    title: "Pipeline",
    options: {
        Build: async () => {
            await ctx.services.docker.build({ image: "registry/app:v1", dockerfile: "Dockerfile" });
        },
        Deploy: async () => {
            await ctx.services.kubectl.apply("deployment.yaml", { namespace: "prod" });
        }
    }
});
```

```bash
npx catops-cli --debug --env=prod
```

`catops-cli` detecta el archivo, arma el `Context` a partir de los flags/params de `argv`, y renderiza el menú.

## Uso directo en tu propio script (p. ej. con `tsx`)

```typescript
// src/index.ts
import { Context, Menu, type MenuDefinition } from "catops-cli";

const ctx = Context.parseArgv();

const mainMenu: MenuDefinition = {
    title: "Pipeline",
    "flag-selector": "--menu-selector",
    options: {
        Build: { selector: "build", action: () => ctx.services.docker.build({ image: "app:v1" }) }
    }
};

Menu.render(mainMenu, ctx);
```

```json
{ "scripts": { "dev": "tsx src/index.ts" } }
```

```bash
npx tsx src/index.ts --menu-selector=build
npm run dev -- --menu-selector=build     # con npm hace falta el "--" para reenviar flags
```

## Uso como librería sin menú (pipeline lineal)

```javascript
const { Context } = require("catops-cli"); // o require("./dist") dentro de este repo

const ctx = Context.parseArgv(); // llena flags/params desde argv

ctx.set("image", "registry/api:v1");

await ctx.services.git.checkout("develop");
await ctx.services.npm.ci();
await ctx.services.docker.build({ image: ctx.get("image"), dockerfile: "Dockerfile" });
await ctx.services.docker.push(ctx.get("image"));
await ctx.services.kubectl.apply("deployment.yaml", { namespace: "prod" });
```

## Menús: definición, anidamiento y selectores automáticos por flag

Un `MenuDefinition` es `{ title, options }`, donde cada entrada de `options` puede ser:

- una **función** — task directa: `Build: () => {...}`
- otro **`MenuDefinition`** — submenú directo: `Docker: dockerMenu`
- un **objeto largo** — para poder darle `selector`, `onSuccess`/`onError`, o envolver un submenú:
  ```javascript
  Build: { selector: "build", action: () => {...}, onSuccess: (r, ctx) => {...}, onError: (e, ctx) => {...} }
  Docker: { selector: "docker", menu: dockerMenu }
  // también podés inlinear el submenú directo con su propio selector al lado:
  Docker: { selector: "docker", title: "Docker", "flag-selector": "--docker-action", options: {...} }
  ```

### Selección automática por flag

Cualquier `MenuDefinition` puede declarar `"flag-selector": "--algun-flag"`. Si el `Context` trae un param que matchea el `selector` de alguno de sus items, esa opción se ejecuta **automáticamente, sin ningún prompt**:

```javascript
const dockerMenu = {
    title: "Docker",
    "flag-selector": "--docker-action",
    options: {
        Build: { selector: "build", action: buildTask },
        Push: { selector: "push", action: pushTask }
    }
};

const mainMenu = {
    title: "Pipeline",
    "flag-selector": "--menu-selector",
    options: {
        Docker: { selector: "docker", menu: dockerMenu },
        Deploy: { selector: "deploy", action: deployTask }
    }
};

Menu.render(mainMenu, ctx);
```

```bash
# encadena ambos niveles en un solo comando, sin ningún prompt interactivo:
catops-cli --menu-selector=docker --docker-action=build

# un solo nivel:
catops-cli --menu-selector=deploy

# sin flags -> menú interactivo normal
catops-cli
```

Si el valor del flag no matchea ningún `selector` del nivel actual, cae de vuelta al menú interactivo (con un warning), en vez de fallar en seco. Cada submenú revisa su **propio** `flag-selector` de forma independiente, así que podés automatizar tantos niveles como quieras encadenando flags.

### Callbacks de éxito/error por item

```javascript
Deploy: {
    selector: "deploy",
    action: () => ctx.services.kubectl.apply("deployment.yaml"),
    onSuccess: (result, ctx) => ctx.logger.success("Deploy OK"),
    onError: (error, ctx) => ctx.logger.error(`Deploy falló: ${error.message}`)
}
```

Mismo patrón con `ctx.run()` fuera de un menú:

```javascript
await ctx.run(
    "deploy",
    () => ctx.services.kubectl.apply("deployment.yaml"),
    {
        onSuccess: (result, ctx) => ctx.logger.success("Deploy OK"),
        onError: (error, ctx) => ctx.logger.error(`Deploy falló: ${error.message}`)
    }
);
```

En ambos casos, además de tus callbacks, el resultado se reporta automáticamente al `ctx.notifier` (ver más abajo) — no hay que llamarlo a mano.

## retry / timeout / dryRun — en shell.exec y en TODOS los servicios

`shell.exec(command, ...args)` sigue aceptando exactamente los mismos argumentos de siempre. Si el último argumento es un objeto plano, se interpreta como opciones **solo para esa llamada**:

```javascript
await ctx.services.docker.push(image); // igual que siempre

await ctx.services.shell.exec("curl", "https://flaky-api.internal", {
    retry: 3,         // reintentos totales (default: 1 = sin retry)
    retryDelay: 1000, // ms entre reintentos
    timeout: 5000,    // ms antes de matar el proceso con SIGTERM
    dryRun: true       // solo loguea el comando, no lo ejecuta
});
```

**Todos los comandos de todos los servicios** (`docker`, `git`, `kubectl`, `helm`, `npm`, `archive`, `terraform`, `ansible`, `argocd`, `tekton`, `oc`, `az`) aceptan este mismo control, sin que cambie nada de lo que ya usabas:

- Si la función ya recibía un **objeto de opciones** (la mayoría), agregale la clave `exec`:
  ```javascript
  await ctx.services.terraform.apply({ autoApprove: true, exec: { retry: 3 } });
  await ctx.services.argocd.appSync("mi-app", { prune: true, exec: { retry: 3 } });
  ```
- Si la función recibe **argumentos posicionales** (strings sueltos), `exec` va como el **último argumento**:
  ```javascript
  await ctx.services.docker.push("registry/app:v1", { retry: 3 });
  await ctx.services.git.push({ retry: 3 });
  await ctx.services.helm.uninstall("mi-app", { retry: 3 });
  ```
- `kubectl` y `oc` combinan `exec` en el **mismo objeto** que ya usás para `kubeconfig`/`namespace`:
  ```javascript
  // 10 reintentos en un login inestable de OpenShift
  await ctx.services.oc.login({
      server: "https://api.cluster:6443",
      token: process.env.OC_TOKEN,
      namespace: "prod",
      exec: { retry: 10, retryDelay: 2000 }
  });

  await ctx.services.kubectl.apply("deploy.yaml", { namespace: "prod", exec: { retry: 5, timeout: 30000 } });
  ```

Defaults globales para todo el proceso (afecta a todos los comandos que no pasen su propio `exec`/opciones puntuales):

```javascript
ctx.services.shell.configure({ retry: 3, timeout: 30000 });
```

`Context.parseArgv()` ya conecta flags de línea de comandos automáticamente a esos defaults globales:

```bash
npx catops-cli --dry-run             # activa dryRun global
npx catops-cli --retry=3 --timeout=15000
```

## Servicios de infraestructura incluidos

```javascript
await ctx.services.terraform.plan({ varFile: "prod.tfvars" });
await ctx.services.terraform.apply();

await ctx.services.ansible.playbook("site.yml", { inventory: "hosts.ini" });

await ctx.services.argocd.appSync("mi-app", { prune: true });

await ctx.services.tekton.pipelineStart("build-pipeline", { params: { image: "app:v1" } });

await ctx.services.az.acrBuild({ registry: "miregistro", image: "app:v1" });
```

## kubectl / oc: kubeconfig, namespace, retry/timeout, y espera cíclica del rollout

`kubectl` y `oc` aceptan `{ kubeconfig, namespace, exec }` como último argumento en **todos** sus comandos (retrocompatible, sigue funcionando sin ese argumento — ver la sección anterior para el detalle de `exec`):

```javascript
await ctx.services.kubectl.apply("deploy.yaml", { kubeconfig: "/etc/kube/prod.yaml", namespace: "prod" });
await ctx.services.kubectl.get("pods", "-o", "wide", { namespace: "staging", exec: { retry: 3 } });

await ctx.services.oc.login({ server: "https://api.cluster:6443", token, namespace: "prod", exec: { retry: 10 } });
await ctx.services.oc.apply("deploy.yaml", { namespace: "prod" });
```

### `waitForDeployment` — validación cíclica del rollout

Sondea el Deployment (o `DeploymentConfig` con `oc` + `resourceType: "dc"`) hasta que:

- llega a **estado exitoso** (réplicas listas/actualizadas == deseadas) → resuelve con `{ status: "success", ... }`,
- se queda en **estado Failed** más de `failedGracePeriod` sin recuperarse → lanza `DeploymentRolloutError`,
- supera **`maxRestarts`** reinicios acumulados entre todos sus pods → lanza `DeploymentRolloutError` de inmediato, sin esperar el grace period,
- o se cumple el **`timeout`** global sin éxito → lanza `DeploymentRolloutError`.

En los tres casos de fallo, el polling se detiene y el error se re-lanza — listo para que `ctx.run(...)` lo capture y lo reporte automáticamente vía `ctx.notifier` (el error ya trae `command: "kubectl"` / `command: "oc"`, así que `classifiers.byCommand({ kubectl: "kubernetes" })` lo clasifica sin configuración extra).

```javascript
await ctx.run("deploy-api", async () => {
    await ctx.services.kubectl.apply("deployment.yaml", { namespace: "prod" });

    return ctx.services.kubectl.waitForDeployment({
        deployment: "api",
        namespace: "prod",
        timeout: 5 * 60 * 1000,      // 5 min totales antes de abortar
        pollInterval: 5000,           // chequea cada 5s
        failedGracePeriod: 30_000,    // si entra en Failed, espera 30s a que se recupere
        maxRestarts: 5                // si supera 5 reinicios acumulados, aborta ya
    });
});
```

### `waitForDeploymentGroup` — validar todas las instancias de un mismo despliegue GitOps

Pensada para el caso de GitOps donde un mismo repo termina desplegado como **varios Deployments** (una instancia por región/config/cliente, etc.), todos marcados con un label común:

```yaml
metadata:
  labels:
    deployment-group: repository-14
```

Descubre todas las instancias que compartan ese label y corre `waitForDeployment` sobre **cada una en paralelo**, con el mismo `timeout`/`pollInterval`/`failedGracePeriod`/`maxRestarts` para todas:

```javascript
await ctx.run("deploy-repo-14", () =>
    ctx.services.kubectl.waitForDeploymentGroup({
        label: { "deployment-group": "repository-14" }, // o el string ya armado: "deployment-group=repository-14"
        namespace: "prod",
        timeout: 5 * 60 * 1000,
        pollInterval: 5000,
        failedGracePeriod: 30_000,
        maxRestarts: 5
    })
);
```

- Si **todas** llegan a estado exitoso → resuelve con `{ status: "success", deployments: [...] }` (el detalle de cada una).
- Si **alguna falla** → espera a que las demás terminen, y lanza `DeploymentGroupRolloutError` con `succeeded` (nombres que sí llegaron) y `failed` (nombre + status + mensaje de cada una que no).
- Si el label **no matchea ningún deployment**, también lanza `DeploymentGroupRolloutError` (grupo vacío = error, no éxito silencioso).

Con `oc`, ambas funciones aceptan `resourceType: "dc"` para apuntar a `DeploymentConfig` clásico en vez de `Deployment` nativo (default: `"deployment"`).

## Logging commands de Azure Pipelines (`ctx.services.azdo`)

```javascript
ctx.services.azdo.setVariable("BUILD_TAG", "v1.2.3");
ctx.services.azdo.logWarning("El caché de npm no se encontró, se reconstruye desde cero.");
ctx.services.azdo.group("Build");
// ... pasos ...
ctx.services.azdo.endGroup();
```

## Cliente HTTP de Azure DevOps REST API (`AzureDevOpsApi`)

Un cliente tipado para la REST API de Azure DevOps (Repos, Builds, Pipelines, Work Items). Usa autenticación Basic con PAT, project-level por defecto, y soporta overrides por llamada.

### Configuración

```typescript
import { AzureDevOpsApi } from "catops-cli";

const azdo = new AzureDevOpsApi().configure({
    baseUrl: "https://dev.azure.com/miorg",
    pat: process.env.AZDO_PAT,
    project: "mi-proyecto",         // project por defecto (opcional)
    apiVersion: "7.1",              // default
});
```

Se puede pasar un agente HTTP existente con `agent` para reusar interceptores/configuración:

```typescript
const azdo = new AzureDevOpsApi().configure({
    baseUrl: "https://dev.azure.com/miorg",
    pat: process.env.AZDO_PAT,
    agent: ctx.services.http.agent("azdo")  // o un HttpService nuevo
});
```

### Proyectos

```typescript
const res = await azdo.listProjects();
const proj = await azdo.getProject("mi-proyecto");
```

### Git Repos

```typescript
const repos = await azdo.listRepos();
const repo  = await azdo.getRepo("frontend");
```

### Branches

```typescript
const branches = await azdo.listBranches("frontend");

const exists = await azdo.branchExists("frontend", "feature/login");  // true | false

const branch = await azdo.getBranch("frontend", "feature/login");
// → branch.body.aheadCount, .behindCount, .commit.commitId, ...
```

### Commits

```typescript
const commits = await azdo.listCommits("frontend", { branch: "main", top: 10 });
const commit  = await azdo.getCommit("frontend", "abc123");
```

### Pull Requests

```typescript
const prs  = await azdo.listPullRequests("frontend", { status: "active" });
const pr   = await azdo.getPullRequest("frontend", 42);
const newPr = await azdo.createPullRequest("frontend", {
    sourceRefName: "refs/heads/feature/login",
    targetRefName: "refs/heads/main",
    title: "feat: login",
    description: "Agrega pantalla de login"
});
```

### Build Definitions & Builds

```typescript
const defs = await azdo.listBuildDefinitions();
const def  = await azdo.getBuildDefinition(1);

const builds = await azdo.listBuilds({ definitionId: 5, top: 10 });
const build  = await azdo.getBuild(100);

const queued = await azdo.queueBuild(5, { branch: "main", parameters: { config: "Release" } });
// → queued.body.id, .status, .buildNumber
```

### Pipelines

```typescript
const pipelines = await azdo.listPipelines();
const pipeline  = await azdo.getPipeline(10);

const run = await azdo.runPipeline(10, {
    branch: "main",
    variables: { ENV: { value: "production" } }
});
```

### Work Items

```typescript
const wi = await azdo.getWorkItem(123, { fields: ["System.Title", "System.State"] });

const query = await azdo.queryWorkItems(
    "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'"
);
// → query.body.workItems → [{ id, url }, ...]
```

### Overrides por llamada

Cada método acepta un objeto de opciones con `project`, `apiVersion`, `query`, y `exec`:

```typescript
// project override → usa otro proyecto solo para esta llamada
await azdo.listRepos({ project: "otro-proyecto" });

// organization-level → omite el project de la URL
await azdo.listProjects({ organizationLevel: true });

// dry-run — solo loguea la petición HTTP sin enviarla
await azdo.listRepos({ exec: { dryRun: true } });
```

Los tipos de respuesta completos (`AzdoProject`, `AzdoGitRepository`, `AzdoBuild`, etc.) se exportan desde la raíz del paquete para tipado en TypeScript.

## Motor de pipelines declarativo (`ctx.services.pipeline`)

Un motor de ejecución de pipelines con **stages → jobs → tasks**, dependencias entre entidades, acceso a resultados jerárquico por contexto (`stage.job.task`), tipos de task extensibles, y registro global de pipelines reutilizables.

### Estructura flexible

La estructura es **completamente opcional en cada nivel** — podés definir un pipeline con stages completos, solo jobs, o solo tasks:

```javascript
// Pipeline completo: stages → jobs → tasks
const fullPipeline = new Pipeline("deploy");
fullPipeline
    .stage("build")
        .job("compile")
            .task("install-deps", { exec: async (ctx) => { /* ... */ } })
            .task("compile", { exec: async (ctx) => { /* ... */ } })
    .stage("test")
        .job("unit-tests")
            .task("run-tests", { exec: async (ctx) => { /* ... */ } })
    .stage("deploy")
        .job("push")
            .task("upload", { exec: async (ctx, results) => { /* results.build.compile */ }, depends: ["build.compile"] });

await fullPipeline.run(ctx);
```

```javascript
// Solo tasks (sin stages ni jobs) — acceso flat dentro del mismo job
const simple = new Pipeline("simple", {
    tasks: {
        build: { exec: async (ctx) => { await ctx.services.docker.build({...}); } },
        test:  { exec: async (ctx) => { await ctx.services.shell.exec("npm", "test"); } },
        push:  { exec: async (ctx, results) => { await ctx.services.docker.push({...}); }, depends: ["build"] }
    }
});
await simple.run(ctx);
```

```javascript
// Solo jobs (sin stages)
const jobsOnly = new Pipeline("ci", {
    jobs: {
        build: { tasks: { compile: { exec: () => "ok" } } },
        test:  { tasks: { unit: { exec: () => "pass" } } }
    }
});
await jobsOnly.run(ctx);
```

### Dependencias

Cada task, job, o stage puede declarar `depends: ["nombre"]` — el motor resuelve el orden automáticamente:

```javascript
const pipeline = new Pipeline("ordered");
pipeline
    .stage("build")
        .job("compile")
            .task("install", { exec: () => "deps installed" })
            .task("compile", { exec: () => "compiled", depends: ["install"] })
    .stage("test")
        .job("unit")
            .task("test", {
                exec: (_, results) => `testing ${results.build.compile.compile}`,
                depends: ["build.compile.compile"]   // cross-stage: stage.job.task
            })
    .stage("deploy")
        .job("push")
            .task("upload", {
                exec: (_, results) => `deployed ${results.unit.test}`,
                depends: ["unit.test"]               // cross-job mismo stage: job.task
            });

await pipeline.run(ctx);
```

Las dependencias son **cross-level** — una task en un stage puede depender de una task de otro stage usando paths con dot notation:

```javascript
// Cross-stage: deploy necesita un resultado de build
.task("upload", {
    exec: (_, results) => `uploaded ${results.build.compile.artifact}`,
    depends: ["build.compile.artifact"]   // stage.job.task
})

// Cross-job mismo stage: test necesita algo de build
.task("verify", {
    exec: (_, results) => `verified ${results.compile.output}`,
    depends: ["compile.output"]           // job.task
})

// Mismo job: dependencia directa por nombre
.task("deploy", {
    exec: (_, results) => `deploy-${results.build}`,
    depends: ["build"]                    // task (flat)
})
```

Los stages y jobs se ejecutan en **orden secuencial por defecto** (definition order).

### Acceso a resultados

Los resultados se organizan jerárquicamente: `stage → job → task`. Cada callback recibe `(ctx, results)` donde `results` es un proxy que resuelve por contexto:

```javascript
pipeline
    .stage("build")
        .job("compile")
            .task("compile", { exec: () => "artifact-v1" })
    .stage("deploy")
        .job("push")
            .task("upload", {
                exec: (_, results) => {
                    // Mismo job: acceso directo por nombre de task
                    // results.myTask = "valor"

                    // Mismo stage, otro job: job.task
                    // results.compile.compile = "artifact-v1"

                    // Otro stage: stage.job.task
                    // results.build.compile = { compile: "artifact-v1" }

                    return `uploaded ${results.build.compile.compile}`;
                },
                depends: ["build.compile.compile"]
            });
```

**Reglas de resolución:**

| Contexto | Sintaxis | Ejemplo |
|---|---|---|
| Misma task (otro task en el mismo job) | `results.<task>` | `results.build` |
| Mismo stage, otro job | `results.<job>.<task>` | `results.compile.output` |
| Otro stage | `results.<stage>.<job>.<task>` | `results.build.compile.artifact` |

El proxy intenta resolver en este orden: flat → job path → stage path. El primer match gana.

Cada entidad también expone sus resultados vía `.results` (PipelineTask), `.results` (PipelineJob — mapa anidado), y `.getResults()` (PipelineStage/Pipeline).

### Registry global de pipelines

`ctx.services.pipeline` es un registry — definís pipelines al inicio y los ejecutás por nombre:

```javascript
// Definir pipelines globales
ctx.services.pipeline.define("build-and-test", {
    tasks: {
        build: { exec: async (ctx) => { await ctx.services.docker.build({...}); } },
        test:  { exec: async (ctx) => { await ctx.services.shell.exec("npm", "test"); } }
    }
});

ctx.services.pipeline.define("deploy-prod", {
    stages: {
        build: { jobs: { compile: { tasks: { step: { exec: async (ctx) => { /* ... */ } } } } } },
        deploy: { jobs: { push: { tasks: { step: { exec: async (ctx) => { /* ... */ } } } } } }
    }
});

// Ejecutar por nombre
await ctx.services.pipeline.run("build-and-test", ctx);
await ctx.services.pipeline.run("deploy-prod", ctx);
```

**Gestión de pipelines:**

```javascript
// Listar todos los pipelines registrados
ctx.services.pipeline.list();  // ["build-and-test", "deploy-prod"]

// Obtener un pipeline para modificarlo
const p = ctx.services.pipeline.get("build-and-test");

// Eliminar un pipeline
ctx.services.pipeline.remove("deploy-prod");
```

### Context access

Cada task recibe `ctx` como primer argumento — acceso completo a servicios, flags, params, logger, etc.:

```javascript
pipeline.stage("build").job("compile").task("step1", {
    exec: async (ctx) => {
        ctx.logger.info(`Building with env: ${ctx.params.env}`);
        await ctx.services.docker.build({ image: `app:${ctx.params.version}` });
        ctx.set("image", `app:${ctx.params.version}`);
    }
});
```

### PipelineRunResult

`pipeline.run()` devuelve un objeto con status, results (jerárquico), error, y duration:

```javascript
const result = await pipeline.run(ctx);

if (result.status === "success") {
    ctx.logger.success(`Pipeline completed in ${result.duration}ms`);
    console.log(result.results);
    // {
    //     build: {                        // stage
    //         compile: {                  // job
    //             step1: "compiled"       // task
    //         }
    //     },
    //     deploy: {
    //         push: {
    //             upload: "uploaded-v1"
    //         }
    //     }
    // }
} else {
    ctx.logger.error(`Pipeline failed: ${result.error.message}`);
}
```

### Task types

El tipo de ejecución se determina por la **propiedad** presente en la config. No hay campo `type` — la propiedad misma es el tipo:

```javascript
// exec = callback (único type actualmente)
.task("compile", {
    exec: async (ctx, results) => { /* ... */ }
})
```

Para agregar un nuevo tipo en el futuro, solo se agrega la propiedad al config y el case en `_execute`:

```javascript
// Futuro: shell
.task("test", {
    shell: { command: "npm", args: ["test"] }
})

// Futuro: docker
.task("build", {
    docker: { action: "build", image: "app:v1" }
})
```

El engine detecta `"exec" in config`, `"shell" in config`, etc. y ejecuta la estrategia correspondiente.

### Reset y reutilización

Los pipelines son reutilizables — `reset()` restaura el estado de todas las entidades:

```javascript
const pipeline = new Pipeline("reusable", {
    tasks: { step: { exec: () => ++count } }
});

await pipeline.run(ctx);  // count = 1
pipeline.reset();
await pipeline.run(ctx);  // count = 2
```

### Servicio HTTP con interceptores (`ctx.services.http`)

Un cliente HTTP completo con soporte para **interceptors de request y response**, configurable como servicio global o como instancias independientes.

### Uso básico

```javascript
// GET
const res = await ctx.services.http.get("https://api.example.com/users");
console.log(res.body);  // { users: [...] }

// POST
const res = await ctx.services.http.post("https://api.example.com/users", {
    name: "John",
    email: "john@example.com"
});

// PUT / PATCH / DELETE
await ctx.services.http.put("/users/1", { name: "Jane" });
await ctx.services.http.patch("/users/1", { email: "new@example.com" });
await ctx.services.http.delete("/users/1");
```

### Configuración global

```javascript
ctx.services.http.configure({
    baseUrl: "https://api.example.com",
    defaultHeaders: {
        "Authorization": `Bearer ${process.env.API_TOKEN}`,
        "Accept": "application/json"
    },
    defaultTimeout: 10000  // 10 segundos
});

// Ahora las peticiones son relativas
await ctx.services.http.get("/users");        // -> GET https://api.example.com/users
await ctx.services.http.post("/users", data); // -> POST https://api.example.com/users
```

### Query params

```javascript
await ctx.services.http.get("/search", {
    query: { q: "hello", page: 1, active: true }
});
// -> GET /search?q=hello&page=1&active=true
```

### Errores HTTP

Las respuestas con status 4xx/5xx lanzan un error con metadata completa:

```javascript
try {
    await ctx.services.http.get("/missing");
} catch (err) {
    console.log(err.status);    // 404
    console.log(err.body);      // { error: "not found" }
    console.log(err.headers);   // { ... }
    console.log(err.request);   // { url, method, headers, ... }
}
```

### Interceptores de request

Los interceptors se ejecutan **antes** de cada petición. Pueden mutar el request (headers, auth, logging) o abortarlo:

```javascript
// Agregar token de auth a todas las peticiones
ctx.services.http.addRequestInterceptor((ctx) => {
    ctx.request.headers["Authorization"] = `Bearer ${process.env.TOKEN}`;
});

// Logging de cada petición
ctx.services.http.addRequestInterceptor((ctx) => {
    console.log(`→ ${ctx.request.method} ${ctx.request.url}`);
});

// Abortar peticiones a ciertos dominios
ctx.services.http.addRequestInterceptor((ctx) => {
    if (ctx.request.url.includes("internal")) {
        ctx.abort("blocked by policy");
    }
});
```

Los interceptors se ejecutan en orden. Si uno aborta, se lanza un error y no se envía la petición.

### Interceptores de response

Los interceptors se ejecutan **después** de cada respuesta. Pueden transformar el body, loguear, o hacer retry:

```javascript
// Logging de cada respuesta
ctx.services.http.addResponseInterceptor((ctx) => {
    console.log(`← ${ctx.response.status} ${ctx.request.url}`);
});

// Transformar la respuesta
ctx.services.http.addResponseInterceptor((ctx) => {
    if (ctx.response.body?.data) {
        ctx.response.body = ctx.response.body.data;
    }
});
```

### Gestión de interceptors

```javascript
// Agregar
const myInterceptor = (ctx) => { /* ... */ };
ctx.services.http.addRequestInterceptor(myInterceptor);
ctx.services.http.addResponseInterceptor(myInterceptor);

// Eliminar uno específico
ctx.services.http.removeRequestInterceptor(myInterceptor);
ctx.services.http.removeResponseInterceptor(myInterceptor);

// Limpiar todos
ctx.services.http.clearRequestInterceptors();
ctx.services.http.clearResponseInterceptors();
```

### Agentes HTTP nombrados

`ctx.services.http` es un **registry** que gestiona agentes HTTP. Cada agente tiene su propia configuración, interceptores y defaults aislados.

**Default agent** — directamente en `ctx.services.http`:

```javascript
await ctx.services.http.get("/users");
await ctx.services.http.post("/users", data);
```

**Agentes nombrados** — para APIs distintas con configuración propia:

```javascript
import { HttpService } from "catops-cli";

// Crear y registrar un agente
ctx.services.http.createAgent(
    new HttpService().configure({
        baseUrl: "https://api.github.com",
        defaultHeaders: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    }),
    "github"
);

ctx.services.http.createAgent(
    new HttpService().configure({
        baseUrl: "https://internal.mycompany.com/api",
        defaultHeaders: { "X-API-Key": process.env.INTERNAL_KEY }
    }),
    "internal"
);

// Usar por nombre — cada uno tiene interceptores y config aislados
await ctx.services.http.agent("github").get("/repos/org/repo");
await ctx.services.http.agent("internal").get("/services/status");
```

**Gestión de agentes:**

```javascript
// Listar todos los agentes registrados
ctx.services.http.listAgents();  // ["github", "internal"]

// Eliminar un agente
ctx.services.http.removeAgent("github");

// Reemplazar un agente existente (mismo nombre)
ctx.services.http.createAgent(new HttpService().configure({...}), "internal");
```

**Ejemplo completo — interceptores por agente:**

```javascript
const github = new HttpService()
    .configure({
        baseUrl: "https://api.github.com",
        defaultHeaders: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    })
    .addRequestInterceptor((ctx) => {
        ctx.request.headers["Accept"] = "application/vnd.github.v3+json";
    })
    .addResponseInterceptor((ctx) => {
        if (ctx.response.body?.data) {
            ctx.response.body = ctx.response.body.data;
        }
    });

const internal = new HttpService()
    .configure({ baseUrl: "https://internal.mycompany.com/api" })
    .addRequestInterceptor(async (ctx) => {
        const token = await fetchTokenFromVault();
        ctx.request.headers["Authorization"] = `Bearer ${token}`;
    });

ctx.services.http.createAgent(github, "github");
ctx.services.http.createAgent(internal, "internal");

// Cada agente usa sus propios interceptores
await ctx.services.http.agent("github").get("/repos/org/repo");
await ctx.services.http.agent("internal").get("/services/status");
```

### Opciones por llamada

```javascript
await ctx.services.http.get("/slow-endpoint", {
    timeout: 30000,              // override del default
    headers: { "X-Request-Id": "123" },
    query: { includeDeleted: false }
});

await ctx.services.http.post("/data", payload, {
    exec: { dryRun: true }       // soporte dry-run
});
```

### Interceptors con async/await

Los interceptors soportan operaciones asíncronas (base de datos, llamadas a servicios, etc.):

```javascript
ctx.services.http.addRequestInterceptor(async (ctx) => {
    const token = await fetchTokenFromVault();
    ctx.request.headers["Authorization"] = `Bearer ${token}`;
});
```

## Notificaciones: clasificar errores por área de TI, personalizar el mensaje, y enviarlos

`ctx.notifier` tiene tres responsabilidades independientes:

1. **`classify()`** — decide a qué **área de TI** pertenece un error (para elegir a qué canal mandarlo).
2. **`describeError()`** — decide el **mensaje** a reportar (reemplaza el stderr/stdout crudo por algo humano).
3. **`channel()`** / **`onSuccess()`** — a qué **senders** se manda cada área.

```javascript
const { classifiers, messages, senders } = require("catops-cli");

// 1. ¿A qué área de TI pertenece este error?
ctx.notifier.classify(classifiers.byCommand({
    docker: "containers",
    kubectl: "kubernetes",
    oc: "kubernetes",
    terraform: "infra",
    ansible: "infra",
    git: "scm",
    argocd: "cd-pipeline",
    tkn: "cd-pipeline",
    az: "cloud-azure"
}));

// también podés clasificar por el texto del error:
ctx.notifier.classify(classifiers.byPattern([
    [/permission denied|unauthorized/i, "security"],
    [/timeout|ECONNREFUSED/i, "networking"],
    [/no space left|ENOSPC/i, "infra"]
]));

// 2. ¿qué mensaje se reporta? (opcional — sin esto, se usa el stderr/stdout crudo)
ctx.notifier.describeError(messages.byRule([
    {
        command: "docker", args: "push", pattern: /500 Internal Server Error/,
        message: "Se ha reportado a infraestructura: falta de espacio en el registry"
    },
    {
        command: "kubectl", pattern: /500/,
        message: "El API server de Kubernetes devolvió 500, reintenta en unos minutos"
    },
    {
        command: "terraform", pattern: /500/,
        message: (error, ctx) => `Backend remoto de Terraform no respondió (env: ${ctx.params.env ?? "?"})`
    }
]));

// 3. ¿a dónde se manda cada área?
ctx.notifier.channel("kubernetes", senders.webhook({ url: process.env.TEAMS_WEBHOOK }));
ctx.notifier.channel("security", senders.http({ url: "https://security.miempresa.com/incidents" }));
ctx.notifier.channel("*", senders.file({ path: "./catops-cli-errors.log" })); // TODO error, sin importar el área

// (opcional) éxito, sin clasificación de área
ctx.notifier.onSuccess(senders.log());
```

A partir de aquí, cualquier `ctx.run(...)` o item de menú con `action` reporta automáticamente al notifier — no hay que llamarlo a mano en cada task.

### Clasificadores de área (`classifiers`)

| Fábrica | Uso |
|---|---|
| `classifiers.byCommand({ docker: "containers", ... })` | Mapea el comando que falló (adjunto automáticamente por `shell.exec`) a un área. También funciona con `ServiceError`: unwrappea `cause.command` automáticamente. |
| `classifiers.byPattern([[regex, area], ...])` | Matchea contra el `stderr`/`stdout`/mensaje del error. Unwrappea `ServiceError.cause` para extraer el texto. |
| `classifiers.byService({ docker: "containers", ... })` | Mapea el nombre del **servicio** que falló a un área. Solo matchea `ServiceError` (generados por `ctx.wrap()`). |

### Formateadores de mensaje (`messages`)

| Fábrica | Uso |
|---|---|
| `messages.byPattern([[regex, mensaje], ...])` | Mismo mensaje sin importar el comando — solo mira el texto del error (`stderr`, o `stdout` si `stderr` viene vacío). Unwrappea `ServiceError.cause`. |
| `messages.byCommand({ docker: "mensaje fijo" })` | Mensaje fijo por comando, sin importar el detalle del error. Unwrappea `ServiceError.cause.command`. |
| `messages.byRule([{ command?, args?, pattern?, message }, ...])` | **La opción avanzada**: combina comando + sub-comando (`args`, distingue `docker push` de `docker build`) + patrón de texto, todo en modo AND. `message` puede ser un string fijo o una función `(error, ctx) => string`. Resuelve el caso de "el mismo 500 puede venir de docker, kubectl o terraform, y cada uno necesita su propio mensaje". Unwrappea `ServiceError.cause`. |
| `messages.byService({ docker: "mensaje fijo" })` | Mensaje fijo por nombre de servicio. Solo matchea `ServiceError` (generados por `ctx.wrap()`). |

> **Errores que salen por `stdout` en vez de `stderr`:** algunos comandos (p. ej. `oc login`, o errores HTTP del API server) imprimen el mensaje en `stdout` y aun así salen con exit code ≠ 0. Como `shell.exec` rechaza con el `ExecResult` completo (que conserva `stdout` y `stderr`), todos los formateadores/clasificadores de `messages`/`classifiers` prueban primero `stderr` y, si viene vacío, caen a `stdout`. No hace falta configuración extra — el mismo `describeError`/`classify` que usás hoy funciona aunque el texto vaya por stdout:

```javascript
ctx.notifier.describeError(messages.byPattern([
    [/500 Internal Server Error/, "Se ha reportado a infraestructura: falta de espacio en el registry"],
    [/unauthorized|403/i, "Credenciales inválidas contra el registry, revisa el secret"]
]));
```

Si ningún classifier/formatter matchea, se usa el área `"unclassified"` y el mensaje crudo del error, respectivamente — nada se rompe si no configurás nada de esto.

### Senders incluidos

| Sender | Uso |
|---|---|
| `senders.log()` | Usa el logger interno (consola) |
| `senders.file({ path })` | Agrega el evento como una línea JSON al archivo |
| `senders.http({ url, method?, headers?, formatBody? })` | `POST` genérico del evento como JSON |
| `senders.webhook({ url, format? })` | Como `http`, pero formatea `{ text: "❌ ..." }` por defecto — compatible con Slack/Discord y con **Microsoft Teams** vía Workflows (Power Automate), pasando un `format` que arme el payload de Adaptive Card que Teams espera |
| `senders.websocket({ url, timeout? })` | Abre una conexión WS, manda el evento como JSON y cierra. Requiere Node ≥21 (usa el `WebSocket` global) |

Podés escribir tu propio sender: es cualquier función `(event) => void | Promise<void>` — recibe `{ type, taskId, area?, error?, result?, message, timestamp, service?, method?, args? }`.

Los campos `service`, `method` y `args` solo están presentes cuando el error viene de `ctx.wrap()` (un `ServiceError`).

## Notificaciones de servicios: `ctx.wrap()`

`ctx.wrap(service, serviceName)` envuelve un objeto de servicio en un **Proxy** que intercepta cada llamada a método. Si el método falla, el error se envuelve automáticamente en un `ServiceError` con metadata del servicio y se despacha al `ctx.notifier` antes de re-lanzarlo.

### Uso básico

```typescript
// Envolver servicios que quieras monitorear
const docker = ctx.wrap(ctx.services.docker, "docker");
const kubectl = ctx.wrap(ctx.services.kubectl, "kubectl");

// Configurar classifiers y canales (igual que siempre)
ctx.notifier
    .classify(classifiers.byCommand({ docker: "containers", kubectl: "kubernetes" }))
    .classify(classifiers.byService({ docker: "containers", kubectl: "kubernetes" }))
    .channel("containers", senders.webhook({ url: process.env.SLACK_WEBHOOK }))
    .channel("kubernetes", senders.webhook({ url: process.env.TEAMS_WEBHOOK }));

// Cualquier fallo auto-notifica con contexto completo
await docker.push("myimage:latest");
// → taskId: 'docker.push("myimage:latest")'
// → error: ServiceError { service: "docker", method: "push", args: ["myimage:latest"], cause: ExecResult }
```

### Qué information llega al sender

Cuando `ctx.wrap()` captura un error, el `NotificationEvent` incluye:

| Campo | Tipo | Descripción |
|---|---|---|
| `taskId` | `string` | Nombre generado: `service.method(args serializados)`, ej. `docker.push("myimage:latest")` |
| `service` | `string` | Nombre del servicio: `"docker"`, `"kubectl"`, `"http"`, etc. |
| `method` | `string` | Método que falló: `"push"`, `"apply"`, `"request"`, etc. |
| `args` | `unknown[]` | Argumentos originales pasados al método |
| `error` | `ServiceError` | El error completo (`.cause` contiene el error original) |
| `area` | `string` | Área de TI resuelta por los classifiers |
| `message` | `string` | Mensaje resuelto por los formatters, o `ServiceError.message` |

### ServiceError

`ServiceError` extiende `Error` y contiene:

```typescript
class ServiceError extends Error {
    readonly service: string;   // "docker", "http", etc.
    readonly method: string;    // "push", "request", etc.
    readonly args: unknown[];   // argumentos originales
    readonly cause: unknown;    // error original (ExecResult, HttpError, Error, etc.)
}
```

La propiedad `cause` contiene el error original — los classifiers y formatters existentes (`byCommand`, `byPattern`, `byRule`) unwrappean `ServiceError.cause` automáticamente, así que la configuración que ya tenés sigue funcionando sin cambios.

### Combinación con classifiers existentes

`byCommand` y `byPattern` unwrappean `ServiceError.cause` automáticamente. Esto significa que un `docker.push()` que falla con un error de shell (que tiene `command: "docker"`) se clasifica correctamente vía `byCommand`, y un `http.request()` que falla con un `status: 504` se clasifica vía `byPattern`:

```typescript
ctx.notifier
    // byCommand unwrappea ServiceError.cause.command → "docker" → "containers"
    .classify(classifiers.byCommand({ docker: "containers", kubectl: "kubernetes" }))

    // byPattern unwrappea ServiceError.cause.stderr → /permission denied/ → "security"
    .classify(classifiers.byPattern([
        [/permission denied|unauthorized/i, "security"],
        [/timeout|ECONNREFUSED/i, "networking"]
    ]))

    // byService matchea directamente ServiceError.service → "http" → "networking"
    .classify(classifiers.byService({ http: "networking" }))
```

El orden importa: el primer classifier que matchea gana. Usá `byCommand`/`byPattern` primero (más específico) y `byService` como fallback.

### Mensajes personalizados para servicios

```typescript
ctx.notifier
    // byService: mensaje fijo por nombre de servicio
    .describeError(messages.byService({
        docker: "Falló una operación de Docker, revisa el build/push del registry",
        http: "Falló una petición HTTP, revisa la conectividad"
    }))

    // byRule unwrappea ServiceError.cause → distingue por comando + args + patrón
    .describeError(messages.byRule([
        {
            command: "docker", args: "push", pattern: /500 Internal Server Error/,
            message: "Falta espacio en el registry"
        },
        {
            command: "kubectl", pattern: /500/,
            message: "El API server de Kubernetes devolvió 500"
        }
    ]));
```

### Propiedades no-función pasan sin proxy

El Proxy solo intercepta llamadas a métodos. Las propiedades que no son funciones (strings, números, objetos) pasan directamente:

```typescript
const docker = ctx.wrap(ctx.services.docker, "docker");
docker.version; // pasa directo, sin proxy
```

## Tests

```bash
npm test
```

`pretest` corre el build automáticamente, así los tests validan el `dist/` real que se publica (no el código fuente). Usa `node:test`, sin dependencias externas — interceptando `shell.exec` en vez de ejecutar binarios reales:

- `context.test.js` — Context, flags, vars, parseArgv, dryRun global
- `shell.test.js` — retry, timeout, dryRun del motor shell.exec
- `services.test.js` — que docker/terraform/argocd arman bien sus argumentos
- `menu-selector.test.js` — selección automática por flag, en cascada de varios niveles
- `hooks-integration.test.js` — ctx.run() y items de menú con onSuccess/onError
- `notifier.test.js` — classify/channel/onSuccess/describeError/byRule
- `senders.test.js` — file/http/webhook/log contra servidores reales en localhost
- `http.test.js` — servicio HTTP: métodos, headers, query, interceptors, abort, timeout, dryRun, múltiples instancias aisladas
- `kubectl.test.js`, `oc.test.js` — kubeconfig/namespace, waitForDeployment (éxito, timeout, Failed, maxRestarts)
- `exec-options-passthrough.test.js` — retry/timeout/dryRun (`exec`) llegando a todos los servicios, incluyendo un retry real que se recupera tras 2 fallos
- `deployment-group.test.js` — waitForDeploymentGroup (éxito total, fallo parcial, label sin matches, oc con `dc`)
- `azdo-api.test.js` — AzureDevOpsApi contra mock server: proyectos, repos, branches, commits, PRs, builds, pipelines, work items, overrides
- `pipeline.test.js` — Pipeline motor: stages/jobs/tasks, dependencias cross-level con paths dotted, resultados jerárquicos (stage.job.task), fluent API, registry, reset, ctx access, detección de tipo por propiedad, PipelineResultsAccessor
- `service-notify.test.js` — ServiceError, ctx.wrap(), Notifier con service/method/args, classifiers.byService/messages.byService, unwrap de ServiceError en byCommand/byPattern/byRule, integración completa, backward compat

## Siguientes pasos posibles

- Publicar en un registro privado (Verdaccio/Artifactory/GitHub Packages) para instalarlo con scope, p.ej. `@miorg/catops-cli`.
- Agregar más plugins (`ansible-lint`, `trivy`, `sonar-scanner`) con el mismo patrón que `terraform.ts`/`docker.ts`.
- CI propio (GitHub Actions/Azure Pipelines) que corra `npm test` en cada PR antes de `npm publish`.
- `--catch=throw` (o similar) para que un item de menú fallido mate el proceso completo en vez de solo loguear y seguir — útil corriendo vía `--menu-selector` dentro de un step de Azure Pipelines.
