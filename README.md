# catops-cli

Framework para pipelines DevOps, escrito en **TypeScript** (100% usable desde JavaScript puro), empaquetado como librería npm instalable en cualquier proyecto.

Trae:

- Un **ExecutionContext** compartido (`flags`, `params`, `env`, `vars`, `results`, `logger`, `services`, `notifier`) para que ninguna task tenga que recibir parámetros manualmente. `ctx.env` está sincronizado con `shell.environment` — cualquier variable que agregues se refleja en todos los comandos.
- **16 servicios** listos (`shell`, `docker`, `git`, `kubectl`, `helm`, `npm`, `archive`, `terraform`, `ansible`, `argocd`, `tekton`, `oc`, `az`, `azdo`, `http`, `yaml`) + un **cliente REST API** para Azure DevOps (`AzureDevOpsApi`) + un **motor de pipelines** declarativo con dependencias (`Pipeline`).
- **Servicio HTTP** con interceptores de request/response, registry de agentes nombrados, configuración global, query params, dry-run y timeout. Los interceptores también se pueden registrar sobre el agente que integra `AzureDevOpsApi`. Modo TLS inseguro (`insecureTls`) para servidores con certificado autofirmado o CA interna no confiable.
- **Parser de errores de Azure DevOps**: cada fallo de la REST API se convierte en un `AzdoApiError` legible con el mensaje del servidor, código TF/VS, tipo de excepción y sugerencias accionables (`parseAzdoError` / `formatAzdoError`).
- **Menús interactivos** con navegación anidada y **selección automática por flag** (para correr pipelines sin prompts, ideal para CI).
- **retry / timeout / dryRun / env / cwd** en cada comando de shell, más **shell compartido** (`runner`) para ejecutar servicios en un mismo directorio/entorno.
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
   import { Context, Menu, services, YamlService, type MenuDefinition } from "catops-cli";
   ```
   ```javascript
   const { Context, Menu, services, YamlService } = require("catops-cli");
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
    terraform.ts, ansible.ts, argocd.ts, tekton.ts, oc.ts, az.ts, azdo.ts, azdo-api.ts, azdo-errors.ts, pipeline.ts
    yaml.ts              -> YamlService: manipulación de archivos YAML con prepare(), multidocument, comentarios
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
  exec-options-passthrough.test.js,   azdo-api.test.js, pipeline.test.js,
  service-notify.test.js, yaml.test.js
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

## retry / timeout / dryRun / env / cwd — en shell.exec y en TODOS los servicios

`shell.exec(command, ...args)` sigue aceptando exactamente los mismos argumentos de siempre. Si el último argumento es un objeto plano, se interpreta como opciones **solo para esa llamada**:

```javascript
await ctx.services.docker.push(image); // igual que siempre

await ctx.services.shell.exec("curl", "https://flaky-api.internal", {
    retry: 3,         // reintentos totales (default: 1 = sin retry)
    retryDelay: 1000, // ms entre reintentos
    timeout: 5000,    // ms antes de matar el proceso con SIGTERM
    dryRun: true,     // solo loguea el comando, no lo ejecuta
    env: {            // variables de entorno extra para esta llamada (se fusionan con ctx.env)
        HTTP_PROXY: "http://proxy:3128"
    }
});
```

### Variables de entorno (`env`)

`ctx.env` es la **misma referencia** que `shell.environment` — cualquier cambio en uno se refleja en el otro y afecta a **todos** los comandos:

```javascript
// Global: afecta a TODOS los comandos (docker, kubectl, git, ...)
ctx.env["DOCKER_CONFIG"] = "/ruta/custom/config";
ctx.env["DOCKER_BUILDKIT"] = "0";

await ctx.services.docker.build({ image: "app:v1" });  // recibe ambas
await ctx.services.docker.push("app:v1");              // recibe ambas
await ctx.services.git.clone("url", "path");           // también las recibe
```

Para override puntual (por llamada), usá `exec.env` — se **fusiona** con `ctx.env`:

```javascript
// Solo para esta llamada,叠加 sobre ctx.env
await ctx.services.docker.build({
    image: "app:v1",
    exec: { env: { DOCKER_BUILDKIT: "0" } }
});

// Equivalente vía shell
ctx.services.shell.env("DOCKER_CONFIG", "/ruta/config");
```

La jerarquía es: `process.env` → `ctx.env` (global) → `exec.env` (por llamada).

### Directorio de trabajo (`cwd`)

`cwd` ejecuta el comando en una carpeta puntual, como si hicieras `cd` antes del comando. Vale para **cualquier** comando de **cualquier** servicio, directo en `shell.exec` o vía `exec.cwd`:

```javascript
// Directo en shell
await ctx.services.shell.exec("git", "status", { cwd: "/ruta/del/repo" });

// En un servicio, vía exec (funciona con kubectl, docker, helm, oc, ...)
await ctx.services.kubectl.apply("deploy.yaml", {
    exec: { cwd: "/ruta/repo/infra", retry: 3 }
});

// Git acepta cwd directamente en su objeto de opciones
await ctx.services.git.status({ cwd: "./repo" });
await ctx.services.git.pull({ remote: "origin", branch: "main", cwd: "/ruta/repo" });
```

`cwd` puede ser **absoluto** o **relativo** (resuelve contra el directorio actual del shell). También se puede fijar como default global:

```javascript
ctx.services.shell.configure({ cwd: "/ruta/repo" }); // todos los comandos corren ahí por defecto
```

### Shell compartido (`runner`)

Para flujos donde varios servicios deben correr en un mismo directorio/entorno (p. ej. despliegue GitOps: clonar, configurar, aplicar), podés crear un **shell compartido** con su propio `cd` y pasárselo a los siguientes comandos. Se crea con `shell.clone()`, se hace `cd` con `sh.cwd(...)`, y se pasa como `runner`:

```javascript
// Un shell compartido apuntando al repo
const sh = ctx.services.shell.clone();
sh.cwd("/ruta/repo");               // cd a la carpeta que tiene el .git
sh.env("MY_CONTEXT", "prod");       // entorno propio del shell compartido

// El siguiente servicio usa ESE shell (mismo directorio + entorno)
await ctx.services.git.status({ runner: sh });
await ctx.services.git.branchCreate("feat/gitops", { runner: sh, checkout: true });
await ctx.services.npm.ci({ exec: { runner: sh } });       // también vía exec
await ctx.services.docker.build({ image: "app:v1", exec: { runner: sh } });
```

El `runner` conserva su propio `cd`/env **entre llamadas** (hasta que lo cambies con `sh.cwd(...)`), mientras que `cwd` solo aplica a esa llamada puntual. Ambos coexisten: `cwd` tiene prioridad sobre el directorio del runner. El shell compartido hace lo mismo que el default (`clone`, `cwd`, `env`, `configure`, `exec`), y al pasarlo como `runner` no tocas el shell global.

```javascript
// Combinado: runner para varios pasos + cwd puntual para uno solo
await ctx.services.git.add(".", { runner: sh });
await ctx.services.git.commit("fix: quota", { runner: sh, exec: { cwd: "/tmp/otro-repo" } });
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

## Docker (`ctx.services.docker`)

`ctx.services.docker` agrupa las operaciones habituales de Docker (`build`, `push`, `tag`, `login`, `pull`, `rm`, `rmi`, `prune`) más utilidades de validación de disco y caché (`systemDf`, `buildxDu`, `validateCache`, `validateSpace`).

```javascript
// build — `--pull=false/true` y `--no-cache`
await ctx.services.docker.build({
    image: "registry/app:v1",
    context: ".",
    dockerfile: "Dockerfile",
    buildArgs: { NODE_ENV: "production" },
    pull: false,       // docker build --pull=false ...
    noCache: true,     // ... --no-cache
    exec: {            // override de env solo para este build
        env: { DOCKER_BUILDKIT: "0", DOCKER_CONFIG: "/tmp/docker" }
    }
});

// Variables de entorno globales para TODOS los comandos docker
ctx.env["DOCKER_CONFIG"] = "/ruta/custom/config";
ctx.env["DOCKER_BUILDKIT"] = "0";

await ctx.services.docker.push("registry/app:v1");
await ctx.services.docker.tag("app:v1", "registry/app:v1");
await ctx.services.docker.login({ registry, username, password });
await ctx.services.docker.pull("registry/app:v1");

// rm / rmi — eliminar contenedor / imagen (rm con -f si lo deseas)
await ctx.services.docker.rm("mycontainer");
await ctx.services.docker.rm("mycontainer", { force: true });
await ctx.services.docker.rmi("registry/app:v1");

// prune — docker system prune [-a] [--volumes] [--filter ...]
await ctx.services.docker.prune({ all: true, volumes: true });
await ctx.services.docker.prune({ all: true, filter: "until=24h" });

// systemDf — docker system df con tamaños normalizados a bytes
const usage = await ctx.services.docker.systemDf();
// → { rows: [{ type: "Images", total, active, size, reclaimable }, ...],
//     total: { size, reclaimable, ... }, raw }
console.log(usage.total.size);            // bytes totales ocupados
console.log(usage.rows[0].reclaimable);   // bytes reclaimables por tipo

// buildxDu — tamaño de la caché de build (buildkit)
await ctx.services.docker.buildxDu();

// validateCache — cuánto ocupa la caché de build y cuánto es recuperable
const cache = await ctx.services.docker.validateCache();
// → { cache, reclaimable, usage }

// validateSpace — compara cada métrica contra umbrales configurados (bytes)
const { exceeded } = await ctx.services.docker.validateSpace({
    images:     10 * 1e9,   // 10 GB de imágenes
    containers: 2 * 1e9,    // 2 GB de contenedores
    volumes:    5 * 1e9,    // 5 GB de volúmenes
    buildCache: 3 * 1e9,    // 3 GB de caché de build
    reclaimable: 6 * 1e9    // 6 GB reclaimables en total
});

if (exceeded.length) {
    await ctx.services.docker.prune({ all: true });
}

// Con throwOnExceeded=true lanza un Error si se supera algún umbral
await ctx.services.docker.validateSpace({ images: 8 * 1e9 }, undefined, true);
```

Los umbrales y los tamaños del `systemDf` se expresan en **bytes** (con `parseSize` que normaliza `KB/MB/GB/TB`). Todas las funciones aceptan `exec` (retry/timeout/dryRun) como antes.

## Git (`ctx.services.git`)

`ctx.services.git` cubre el flujo completo de trabajo con git: `clone`, `checkout`, creación/borrado/listado de **ramas**, `pull`/`fetch`, `add`/`commit`/`push`, `tag`, `merge`/`rebase`, `status`/`log`/`diff`/`show`, `remote`, `stash`, `reset`, `init`, `config` y `revParse`.

Todas las funciones aceptan `exec` (retry/timeout/dryRun) como último argumento plano (`git.push({ retry: 3 })`) o embebido en el objeto de opciones (`git.commit({ exec: { retry: 3 } })`). También aceptan `cwd` y `runner` a nivel de opciones (`git.status({ cwd: "./repo" })`), sin necesidad de anidarlos en `exec`.

```javascript
// clone — con rama y profundidad opcionales
await ctx.services.git.clone("https://github.com/org/repo.git", "./repo");
await ctx.services.git.clone("https://github.com/org/repo.git", "./repo", {
    branch: "dev", depth: 1, singleBranch: true
});

// checkout — pasarse de rama, o crearla y pasarse
await ctx.services.git.checkout("develop");
await ctx.services.git.checkout("feat/api", { create: true });          // git checkout -b feat/api
await ctx.services.git.checkout("dev", { create: true, track: true, startPoint: "origin/dev" });
```

**Ramas** — `branch` (genérico) y helpers dedicados `branchCreate`, `branchDelete`, `branchRename`, `branchList`, `branchShowCurrent`, `branchSetUpstream`, `branchUnsetUpstream`:

```javascript
// Crear
await ctx.services.git.branchCreate("feat/x", { startPoint: "main" });
await ctx.services.git.branchCreate("feat/x", { startPoint: "origin/main", track: true });
await ctx.services.git.branchCreate("hotfix", { force: true });          // git branch -f hotfix

// Borrar (con -D si usás force) y renombrar
await ctx.services.git.branchDelete("feat/x");
await ctx.services.git.branchDelete("legacy", { force: true });          // git branch -D legacy
await ctx.services.git.branchRename("feature/x");                        // renombra la rama actual
await ctx.services.git.branchRename("feature/x", { oldName: "feat/x" });
await ctx.services.git.branchRename("feature/x", { oldName: "feat/x", force: true }); // -M

// Listar
await ctx.services.git.branchList({ all: true });                        // git branch -a
await ctx.services.git.branchList({ remote: true, verbose: true });      // git branch -r -vv
await ctx.services.git.branchList({ merged: "main" });                   // las ya fusionadas en main
await ctx.services.git.branchList({ noMerged: true, pattern: "feat*" });
await ctx.services.git.branchList({ contains: "abc123", sort: "-committerdate" });

// Actual y upstream
const current = await ctx.services.git.branchShowCurrent();              // git branch --show-current
await ctx.services.git.branchSetUpstream({ upstream: "origin/main" });   // git branch -u origin/main
await ctx.services.git.branchSetUpstream({ upstream: "origin/main", name: "dev" });
await ctx.services.git.branchUnsetUpstream();                            // git branch --unset-upstream
```

**pull / fetch** — con remote, rama y estrategia:

```javascript
await ctx.services.git.pull();                                           // git pull
await ctx.services.git.pull({ remote: "origin", branch: "main", rebase: true });
await ctx.services.git.pull({ remote: "origin", branch: "main", ffOnly: true });
await ctx.services.git.pull({ prune: true, tags: true });

await ctx.services.git.fetch();                                          // git fetch --all (default)
await ctx.services.git.fetch({ remote: "origin", branch: "develop" });
await ctx.services.git.fetch({ depth: 1, tags: true });
await ctx.services.git.fetch({ prune: true });
```

**add / commit / push** — `add` acepta un arreglo de archivos o `"."`; `commit` hace el `add` automáticamente si le pasás archivos:

```javascript
// add
await ctx.services.git.add(".");
await ctx.services.git.add(["src/", "package.json"]);
await ctx.services.git.add(".", { all: true });                          // git add -A .
await ctx.services.git.add(["src/"], { force: true });                   // git add -f src/

// commit — si recibís archivos, los agrega solos antes de commitear
await ctx.services.git.commit("fix: corrección de login");
await ctx.services.git.commit("feat: api", ["src/api/**"], { amend: false });
await ctx.services.git.commit("feat: todo", { files: ".", allowEmpty: true });
await ctx.services.git.commit("wip", ".", { exec: { retry: 2 } });
await ctx.services.git.commit("release", { all: true, amend: true });    // git commit -a --amend

// push — remote y rama posicionales u opcionales
await ctx.services.git.push();                                           // git push
await ctx.services.git.push("origin");                                   // git push origin
await ctx.services.git.push("origin", "main");                           // git push origin main
await ctx.services.git.push({ remote: "origin", branch: "main", setUpstream: true }); // -u
await ctx.services.git.push({ remote: "origin", branch: "main", force: true });       // --force
await ctx.services.git.push({ remote: "origin", branch: "main", forceWithLease: true });
await ctx.services.git.push({ tags: true });                             // git push --tags
```

**tags**:

```javascript
await ctx.services.git.tag("v1.0.0");                                    // git tag v1.0.0
await ctx.services.git.tag("v1.0.0", { message: "release 1.0" });        // anotada
await ctx.services.git.tag("v1.0.0", { message: "release", force: true });
await ctx.services.git.tagDelete("v1.0.0");                              // git tag -d v1.0.0
await ctx.services.git.tagList({ pattern: "v1.*", sort: "-creatordate" });
```

**merge / rebase**:

```javascript
await ctx.services.git.merge("develop");
await ctx.services.git.merge("develop", { noEdit: true });
await ctx.services.git.merge("main", { ffOnly: true });                  // aborta si no es fast-forward
await ctx.services.git.merge({ abort: true });                           // aborta el merge en conflicto

await ctx.services.git.rebase({ branch: "main" });                       // git rebase main
await ctx.services.git.rebase({ branch: "dev", onto: "main" });
await ctx.services.git.rebase({ interactive: true });
await ctx.services.git.rebase({ abort: true });                          // aborta el rebase en curso
```

**status / log / diff / show**:

```javascript
await ctx.services.git.status();
await ctx.services.git.status({ short: true, branch: true });            // git status -sb
await ctx.services.git.status({ porcelain: true });                      // para scripting

await ctx.services.git.log({ maxCount: 10, oneline: true });             // git log --max-count 10 --oneline
await ctx.services.git.log({ since: "2 weeks ago", author: "miuser" });
await ctx.services.git.log({ graph: true, allBranches: true });

await ctx.services.git.diff({ stat: true });                             // git diff --stat
await ctx.services.git.diff({ cached: true });                           // staged
await ctx.services.git.diff({ nameOnly: true });                         // solo archivos

await ctx.services.git.show("HEAD");                                     // git show HEAD
await ctx.services.git.show("abc123", { stat: true });                   // git show --stat abc123
```

**remote / stash / reset / init / config / revParse**:

```javascript
// remote
await ctx.services.git.remote({ verbose: true });                        // git remote -v
await ctx.services.git.remote({ show: "origin" });                       // git remote show origin
await ctx.services.git.remoteAdd("upstream", "https://github.com/org/repo.git");
await ctx.services.git.remoteRemove("upstream");
await ctx.services.git.remoteSetUrl("origin", "git@github.com:org/repo.git");

// stash
await ctx.services.git.stashPush({ message: "wip", includeUntracked: true });
await ctx.services.git.stashPush({ keepIndex: true });
await ctx.services.git.stashList();
await ctx.services.git.stashPop();                                       // git stash pop
await ctx.services.git.stashPop({ index: 1 });                           // git stash pop stash@{1}
await ctx.services.git.stashApply({ index: 0 });
await ctx.services.git.stashDrop({ index: 2 });

// reset / init / config
await ctx.services.git.reset({ mode: "hard", commit: "HEAD~1" });        // git reset --hard HEAD~1
await ctx.services.git.init({ initialBranch: "main" });                  // git init -b main
await ctx.services.git.configSet("user.name", "Cat");
await ctx.services.git.configGet("user.name");
await ctx.services.git.configList();

// revParse — resuelve refs (default HEAD)
const sha = await ctx.services.git.revParse();                           // git rev-parse HEAD
await ctx.services.git.revParse("HEAD~1");
await ctx.services.git.revParse({ short: true });                        // SHA abreviado
await ctx.services.git.revParse({ abbrevRef: true });                    // nombre de la rama actual
await ctx.services.git.revParse({ showTopLevel: true });                 // raíz absoluta del repo
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
- se queda en **estado Failed** más de `failedGracePeriod` sin recuperarse → lanza `DeploymentRolloutError` (`K8S-103-DEADLINE`, `K8S-104-REPLICAFAIL` o `K8S-105-FAILED` según la condición),
- supera **`maxRestarts`** reinicios acumulados entre todos sus pods → lanza `DeploymentRolloutError` (`K8S-102-MAXREINIT`) de inmediato, sin esperar el grace period,
- o se cumple el **`timeout`** global sin éxito → lanza `DeploymentRolloutError` (`K8S-101-TIMEOUT`; o `K8S-106-NOTFOUND`/`K8S-108-UNREACHABLE` si el recurso nunca se pudo leer).

Cada error trae su código principal y las causas detectadas (OOMKilled, ImagePull, probes, quota, scheduling...): ver el [catálogo de errores de rollout](#catálogo-de-errores-de-rollout-k8s-nnn-nombre).

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

El polling no imprime el comando ni el JSON en cada iteración. Para que no parezca pegado, cada `statusInterval` ms (default `15000`, `0` lo desactiva) imprime un resumen del recurso y **una línea por pod**:

```
INFO [deployment/api] esperando rollout | 1m15s/5m0s | listas=1/2 | actualizadas=2/2 | Progressing=True (ReplicaSetUpdated)
INFO [deployment/api] pod api-7d9f-abc | status=Running | ready=1/1 | restarts=0 | age=1m35s | node=worker-1
WARN [deployment/api] pod api-7d9f-xyz | status=CrashLoopBackOff | ready=0/1 | restarts=2 (último: Error) | age=40s | node=worker-2
```

En `waitForDeploymentGroup` cada instancia imprime sus propias líneas con su prefijo. Si la validación termina con error (timeout, Failed o `maxRestarts`), se imprime **una sola vez, al final**, un diagnóstico con las condiciones del recurso (p. ej. `ReplicaFailure (FailedCreate): ... exceeded quota`) y, según los flags:

- `printEvents`: `true` imprime los eventos del deployment y de sus pods; también se puede elegir con `{ deployment: true, pods: true }`. Los eventos del deployment **incluyen los de sus ReplicaSets** (o ReplicationControllers y deployer pods con `dc`), que es donde Kubernetes registra los `FailedCreate` por quota: esos pods nunca llegan a existir.
- `printLogs`: `true` imprime el log actual y el anterior (`--previous`, vacío si no existe) de cada pod, con todos sus contenedores; también se puede elegir con `{ current, previous, tail }`.

`waitForDeploymentGroup` acepta los mismos flags y, al final, imprime el diagnóstico de cada instancia que falló, de a una.

```javascript
await ctx.services.oc.waitForDeployment({
    deployment: "api",
    namespace: "prod",
    printEvents: true,                 // o { deployment: true, pods: true }
    printLogs: { tail: 200 }           // actual + anterior, últimas 200 líneas
});
```

### Logs y eventos

```javascript
const { kubectl, oc } = ctx.services;

// Igual que antes: solo el log actual (result.stdout / result.current)
await kubectl.logs("api-7d9f", { namespace: "prod" });

// Log actual + el del contenedor anterior (--previous). Si no hay contenedor
// anterior, `previous` queda en "" en vez de fallar.
const { current, previous } = await oc.logs("api-7d9f", { namespace: "prod", previous: true, container: "app", tail: 200 });

// Solo el anterior, de todos los contenedores
await oc.logs("api-7d9f", { current: false, previous: true, allContainers: true });

// Eventos: se imprimen ordenados por fecha y se retornan como lista
// ({ type, reason, message, kind, name, count, lastTimestamp }).
// `warningsOnly: true` filtra solo Warning.
await oc.events({ namespace: "prod" });                                      // de todo el namespace
await oc.podEvents("api-7d9f", { namespace: "prod" });                       // de un pod
await oc.deploymentEvents("api", { namespace: "prod" });                     // deployment + sus ReplicaSets
await oc.deploymentEvents("api", { namespace: "prod", resourceType: "dc" }); // dc + sus ReplicationControllers
```

Para tus propias consultas internas también puedes silenciar cualquier comando con `exec: { silent: true }`: no imprime el comando ni su salida (salvo con `DEBUG`), pero el resultado se retorna igual.

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

### Catálogo de errores de rollout (`K8S-NNN-NOMBRE`)

Cuando `waitForDeployment` / `waitForDeploymentGroup` (de `kubectl` y de `oc`) terminan con error, el error trae un **código principal** (por qué terminó la validación) y una lista de **causas secundarias** (por qué no se levantó), detectadas en una sola consulta final de pods + eventos + condiciones:

Los códigos tienen el formato `K8S-<número>-<NOMBRE>`: el número es estable (agrupa y ordena) y el sufijo describe el error de un vistazo (p. ej. `K8S-201-OOMKILLED`, `K8S-102-MAXREINIT`). Son los mismos códigos que llegan a los canales del notifier, así que se pueden interceptar con `ctx.notifier.mapCode("K8S-201-OOMKILLED", {...})` (ver [Códigos de error en todas las tareas](#códigos-de-error-en-todas-las-tareas)).

- `K8S-1xx` — **principales**: `err.code` / `err.errorKey`.
- `K8S-2xx` — **secundarias**: `err.causes[]`, cada una con `{ code, key, title, hint, detail, pod?, container? }`. Se deduplican por código + pod.

```javascript
try {
    await ctx.services.kubectl.waitForDeployment({ deployment: "api", namespace: "prod", maxRestarts: 5 });
} catch (err) {
    err.code;       // "K8S-102-MAXREINIT"
    err.errorKey;   // "MAX_RESTARTS_EXCEEDED" (clave estable para usar en código)
    err.causes;     // [{ code: "K8S-201-OOMKILLED", key: "OOM_KILLED", pod: "api-7d9f-x", container: "app", detail: "límite de memoria 256Mi, restarts=6", ... }, ...]
    err.message;    // "[K8S-102-MAXREINIT] Deployment \"api\" superó el máximo de reinicios permitido (6 > 5) | causas: K8S-201-OOMKILLED en api-7d9f-x, K8S-202-CRASHLOOP en api-7d9f-x"
}
```

Además, al fallar se imprime siempre (con o sin `printEvents`/`printLogs`) el error principal y **una línea por causa**:

```
ERROR [K8S-102-MAXREINIT] deployment/api: Deployment "api" superó el máximo de reinicios permitido (6 > 5)
WARN  [deployment/api] K8S-201-OOMKILLED | pod api-7d9f-x | container app | límite de memoria 256Mi, restarts=6 | sugerencia: Subir `resources.limits.memory` ...
WARN  [deployment/api] K8S-202-CRASHLOOP | pod api-7d9f-x | container app | CrashLoopBackOff: back-off 5m0s ... | sugerencia: Revisar el log anterior (--previous) ...
```

En `waitForDeploymentGroup`, `err.code` es `K8S-109-GROUPEMPTY`/`K8S-110-GROUPFAIL` y cada elemento de `err.failed[]` trae su propio `code`, `errorKey` y `causes`. El catálogo completo está disponible en código con `ROLLOUT_ERRORS` (por clave) y `rolloutErrorCatalog()` (lista ordenada), exportados desde la raíz del paquete y desde `services.kubectl` / `services.oc`; `diagnoseRollout(...)` expone el clasificador por si quieres aplicarlo a tus propios JSON de pods/eventos.

Notas:

- Los eventos del Deployment/ReplicaSets/ReplicationControllers se consideran solo si son de los 10 minutos previos al inicio de la espera en adelante, para no culpar al rollout actual por eventos de un rollout anterior. Los eventos de pods se toman de los pods actuales del selector.
- `K8S-107-FORBIDDEN` (sin permisos) aborta al primer intento: un `Forbidden`/`Unauthorized` no se arregla reintentando. `K8S-106-NOTFOUND` y `K8S-108-UNREACHABLE` reemplazan al timeout genérico cuando el recurso **nunca** se pudo leer.
- Si no se detecta nada concreto, la causa es `K8S-299-UNKNOWN UNKNOWN_CAUSE`: usar `printEvents: true` y `printLogs: true` para ver el detalle completo.

#### Errores principales (`K8S-1xx`) — por qué terminó la validación

| Código | Clave | Qué significa | Cómo se detecta | Qué revisar |
|---|---|---|---|---|
| `K8S-101-TIMEOUT` | `ROLLOUT_TIMEOUT` | El rollout no terminó dentro del timeout | Se cumple `timeout` sin llegar a listas/actualizadas == deseadas. | Revisar las causas secundarias; si el despliegue es lento por naturaleza, aumentar `timeout`. |
| `K8S-102-MAXREINIT` | `MAX_RESTARTS_EXCEEDED` | Los pods superaron el máximo de reinicios permitido | Suma de `restartCount` de los pods > `maxRestarts` (aborta de inmediato). | La app se cae al arrancar: revisar logs (`printLogs`) y las causas (OOMKilled, exit code, liveness). |
| `K8S-103-DEADLINE` | `PROGRESS_DEADLINE_EXCEEDED` | Kubernetes marcó el rollout como estancado (progressDeadlineSeconds) | `Progressing=False` con reason `ProgressDeadlineExceeded` durante más de `failedGracePeriod`. | Los pods nuevos no llegan a Ready: revisar causas secundarias y `spec.progressDeadlineSeconds`. |
| `K8S-104-REPLICAFAIL` | `REPLICA_FAILURE` | El controlador no pudo crear los pods (ReplicaFailure) | Condición `ReplicaFailure=True` (FailedCreate) durante más de `failedGracePeriod`. | Normalmente quota, LimitRange, SCC/PodSecurity o un webhook de admisión: ver causas secundarias. |
| `K8S-105-FAILED` | `ROLLOUT_FAILED` | El recurso quedó en estado Failed (Progressing=False) y no se recuperó | `Progressing=False` con otro reason (p. ej. rollout de un dc cancelado) durante más de `failedGracePeriod`. | Revisar la condición informada y los eventos del recurso. |
| `K8S-106-NOTFOUND` | `RESOURCE_NOT_FOUND` | El Deployment/DeploymentConfig no existe en el namespace | Durante todo el `timeout` el `get` devolvió `NotFound`. | Verificar nombre, namespace, kubeconfig y que el apply/sync se haya hecho. |
| `K8S-107-FORBIDDEN` | `ACCESS_DENIED` | Sin permisos o credenciales inválidas para leer el recurso | El `get` devuelve `Unauthorized`/`Forbidden` (aborta de inmediato, no reintenta). | Revisar token/kubeconfig (Unauthorized) o el RBAC del service account (Forbidden). |
| `K8S-108-UNREACHABLE` | `CLUSTER_UNREACHABLE` | No se pudo consultar el cluster durante toda la validación | Durante todo el `timeout` el `get` falló por otro motivo (conexión, TLS, CLI). | Revisar conectividad con el API server, VPN/proxy, certificados y que el CLI esté instalado. |
| `K8S-109-GROUPEMPTY` | `GROUP_EMPTY` | Ningún recurso coincide con el label del grupo | `waitForDeploymentGroup`: el label no devuelve recursos. | Verificar el label (p. ej. `deployment-group=repository-14`), el namespace y el `resourceType`. |
| `K8S-110-GROUPFAIL` | `GROUP_FAILED` | Una o más instancias del grupo no llegaron a estado exitoso | `waitForDeploymentGroup`: al menos una instancia falló. | Ver `failed[]`: cada instancia trae su propio código principal y sus causas. |

#### Errores secundarios (`K8S-2xx`) — por qué no se levantó

| Código | Clave | Qué significa | Cómo se detecta | Qué revisar |
|---|---|---|---|---|
| `K8S-201-OOMKILLED` | `OOM_KILLED` | Contenedor terminado por falta de memoria (OOMKilled) | `state`/`lastState.terminated.reason = OOMKilled` (informa el límite de memoria). | Subir `resources.limits.memory` o reducir el consumo (heap de JVM/Node, cachés). |
| `K8S-202-CRASHLOOP` | `CRASH_LOOP_BACKOFF` | El contenedor se cae repetidamente (CrashLoopBackOff) | `waiting.reason = CrashLoopBackOff` o evento `BackOff` "restarting failed container". | Revisar el log anterior (--previous): error de arranque, config o dependencia caída. |
| `K8S-203-EXITCODE` | `CONTAINER_EXIT_ERROR` | El contenedor terminó con código de salida distinto de 0 | `terminated.exitCode != 0` (informa reason y exit code). | Revisar logs; exit 1 = error de la app, 126/127 = comando no ejecutable/no encontrado, 137 = SIGKILL, 143 = SIGTERM. |
| `K8S-204-IMAGEPULL` | `IMAGE_PULL_FAILED` | No se pudo descargar la imagen (ErrImagePull / ImagePullBackOff) | `waiting.reason` `ErrImagePull`/`ImagePullBackOff`/`ErrImageNeverPull`, o eventos `Failed`/`BackOff` de pull. | Verificar que el tag exista, el acceso al registry y el `imagePullSecrets`. |
| `K8S-205-IMAGENAME` | `INVALID_IMAGE_NAME` | El nombre de la imagen es inválido | `waiting.reason = InvalidImageName` o evento `InspectFailed`. | Revisar la referencia de imagen en el manifiesto (registry/repo:tag). |
| `K8S-206-CONFIGMISSING` | `CONFIG_ERROR` | Falta configuración para crear el contenedor (CreateContainerConfigError) | `waiting.reason = CreateContainerConfigError` (Secret/ConfigMap/key faltante). | Un Secret/ConfigMap (o una key) referenciado no existe en el namespace. |
| `K8S-207-CREATEFAIL` | `CONTAINER_CREATE_FAILED` | El runtime no pudo crear/arrancar el contenedor | `CreateContainerError`, `RunContainerError`, `ContainerCannotRun`, `StartError`, hooks fallidos. | Revisar command/args, entrypoint, permisos del filesystem y securityContext. |
| `K8S-208-INITFAIL` | `INIT_CONTAINER_FAILED` | Un init container falló o no termina | Un init container en waiting (≠ PodInitializing) o terminado con exit ≠ 0. | Revisar el log del init container (migraciones, espera de dependencias, permisos). |
| `K8S-209-READINESS` | `READINESS_PROBE_FAILED` | Falla el readiness probe (el pod no recibe tráfico) | Evento `Unhealthy` "Readiness probe failed". | Verificar path/puerto del health, tiempos (`initialDelaySeconds`, `timeoutSeconds`) y dependencias. |
| `K8S-210-LIVENESS` | `LIVENESS_PROBE_FAILED` | Falla el liveness probe (Kubernetes reinicia el contenedor) | Evento `Unhealthy` "Liveness probe failed". | Verificar el endpoint de health y darle más margen (`initialDelaySeconds`/`failureThreshold`) o usar startupProbe. |
| `K8S-211-STARTUP` | `STARTUP_PROBE_FAILED` | Falla el startup probe (la app no termina de arrancar) | Evento `Unhealthy` "Startup probe failed". | Aumentar `failureThreshold * periodSeconds` o revisar por qué el arranque es lento. |
| `K8S-212-NORESOURCES` | `INSUFFICIENT_RESOURCES` | No hay nodos con CPU/memoria suficiente para programar el pod | `FailedScheduling` / `PodScheduled=False` con "Insufficient cpu/memory" o "Too many pods". | Bajar `resources.requests`, escalar el cluster o liberar capacidad. |
| `K8S-213-UNSCHEDULABLE` | `UNSCHEDULABLE` | El pod no se puede programar en ningún nodo | `FailedScheduling` por taints, nodeSelector, afinidad, etc. | Revisar nodeSelector, afinidad/antiafinidad, taints/tolerations y topology spread. |
| `K8S-214-PVCUNBOUND` | `PVC_UNBOUND` | Un PersistentVolumeClaim no existe o no está enlazado | `FailedScheduling` con "unbound PersistentVolumeClaims" o PVC no encontrado. | Verificar el PVC, su StorageClass y que haya PVs/provisioner disponibles. |
| `K8S-215-MOUNTFAIL` | `VOLUME_MOUNT_FAILED` | No se pudo montar/adjuntar un volumen | Eventos `FailedMount`, `FailedAttachVolume`, `FailedMapVolume`. | Revisar que el Secret/ConfigMap/PVC exista y que el volumen no esté tomado por otro nodo. |
| `K8S-216-QUOTA` | `QUOTA_EXCEEDED` | Se excedió el ResourceQuota del namespace | `FailedCreate` / `ReplicaFailure` con "exceeded quota". | Pedir más quota, bajar requests/limits o réplicas, o liberar recursos del namespace. |
| `K8S-217-ADMISSION` | `ADMISSION_DENIED` | La creación del pod fue rechazada (LimitRange, SCC, PodSecurity o webhook) | `FailedCreate` / `ReplicaFailure` por otro rechazo (LimitRange, SCC, PodSecurity, webhook). | Ajustar el pod a las políticas del namespace (límites, securityContext, SCC) según el mensaje. |
| `K8S-218-EVICTED` | `POD_EVICTED` | El pod fue desalojado del nodo (Evicted) | `status.reason = Evicted` o evento `Evicted`. | Normalmente presión de memoria/disco en el nodo: revisar requests y uso de ephemeral-storage. |
| `K8S-219-NOPODS` | `PODS_NOT_CREATED` | No existe ningún pod del deployment | El selector no devuelve pods y no hay quota/admisión que lo explique. | Revisar eventos del ReplicaSet/ReplicationController y que `replicas` no sea 0. |
| `K8S-220-NOTREADY` | `PODS_NOT_READY` | Pods corriendo pero no Ready, sin una causa explícita | Pod `Running` y no Ready, sin otra causa detectada para ese pod. | Revisar readiness probe, logs de la app y dependencias externas. |
| `K8S-221-PENDING` | `PODS_PENDING` | Pods en Pending sin una causa explícita | Pod `Pending` sin otra causa detectada para ese pod. | Revisar eventos del pod (scheduling, volúmenes, pull de imagen). |
| `K8S-222-DEPLOYERFAIL` | `DEPLOYER_FAILED` | Falló o se canceló el deployer pod del DeploymentConfig (OpenShift) | `dc`: evento Warning del deployer pod `<dc>-<n>-deploy` o `DeploymentCancelled`/`RolloutCancelled`/`DeploymentFailed`. | Revisar el log del pod `<dc>-<n>-deploy` y los eventos del ReplicationController. |
| `K8S-223-NODELOST` | `NODE_LOST` | El nodo del pod dejó de responder (estado Unknown / NodeNotReady) | Pod en fase `Unknown` o evento `NodeNotReady`. | Problema de infraestructura del nodo: revisar el estado del nodo con el equipo de plataforma. |
| `K8S-299-UNKNOWN` | `UNKNOWN_CAUSE` | No se identificó una causa específica | Ninguna de las anteriores. | Revisar el diagnóstico completo con `printEvents: true` y `printLogs: true`. |

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
    // insecureTls: true            // https con certificado autofirmado o CA interna
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

### Interceptores del agente HTTP

`AzureDevOpsApi` integra su propio agente HTTP (se crea perezosamente en la primera petición) y permite registrar **interceptores de request/response** sobre él, igual que en `ctx.services.http`:

```typescript
const azdo = new AzureDevOpsApi().configure({
    baseUrl: "https://dev.azure.com/miorg",
    pat: process.env.AZDO_PAT,
    project: "mi-proyecto",

    // Se registran sobre el agente activo (interno o inyectado)
    requestInterceptors: [
        ctx => { ctx.request.headers["x-correlation-id"] = crypto.randomUUID(); }
    ],
    responseInterceptors: [
        ctx => { console.log(`← ${ctx.response.status} ${ctx.request.url}`); }
    ]
});
```

También hay métodos chainable para gestionarlos en cualquier momento — si el agente interno aún no existe, quedan en cola y se aplican al crearlo:

```typescript
azdo
    .addRequestInterceptor(ctx => { /* tracing, headers extra, ... */ })
    .addResponseInterceptor(ctx => { /* logging, métricas, ... */ });

// Eliminar uno específico o todos
azdo.removeRequestInterceptor(myInterceptor);
azdo.clearRequestInterceptors();
azdo.clearResponseInterceptors();
```

Detalles a tener en cuenta:

- Si inyectas un `agent` externo (`HttpService`), los interceptores se registran **en ese agente**, así que también afectan al resto de consumidores que compartan la instancia.
- El auth Basic del PAT se aplica siempre, independientemente de los interceptores.
- Un agente custom que no exponga los métodos de interceptores lanza un error descriptivo en vez de ignorarlos silenciosamente.

### Conexiones TLS inseguras (`insecureTls`)

Si tu Azure DevOps Server usa HTTPS con un certificado autofirmado o una CA corporativa que tu máquina no confía, activa `insecureTls` para que el cliente acepte el certificado sin validarlo. No requiere instalar ni configurar ningún certificado:

```typescript
const azdo = new AzureDevOpsApi().configure({
    baseUrl: "https://azdos.internal:8080/miorg",
    pat: process.env.AZDO_PAT,
    insecureTls: true   // acepta cualquier certificado TLS del servidor
});
```

La opción se propaga al agente que sea:

- **Agente interno**: se crea ya configurado en la primera petición (el agente es perezoso).
- **Agente externo** (`agent: ctx.services.http.agent(...)`): se configura al llamar `configure()`, así que el resto de consumidores de esa misma instancia `HttpService` también quedan en modo inseguro.
- **Por llamada**: tiene prioridad sobre la configuración global, igual que los demás overrides:

```typescript
await azdo.listRepos({ insecureTls: true });           // solo esta llamada es insegura
const err = await azdo.listProjects().catch(e => e);   // sin override -> falla el handshake
```

`azdo.isInsecureTls()` consulta el estado actual.

**Importante**: desactivar la validación TLS te expone a ataques man-in-the-middle. Úsalo solo contra servidores de confianza dentro de tu red (Azure DevOps Server on-premise, proxies corporativos, etc.).

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

### Archivos

```typescript
const file = await azdo.fileExists("mi-proyecto", "frontend", "main", "/src/index.ts");
// → { exists: true, data } si existe · { exists: false } si no

await azdo.createFileInRepo("mi-proyecto", "frontend", "main", "README.md", "/", "$README:TEMPLATE");
// crea solo si no existe; usa overrideFileInRepo() para sobrescribir

#### Basing (`mergeWithTemplate`)

`mergeWithTemplate()` basa un repositorio destino en un template: descarga
origen y destino, copia los archivos del template sobre el destino — respetando
`overwrite`, `deleteExtra` y `filters.omit`—, aplica opcionalmente una
transformación y publica el resultado en un único commit. Si no hay
diferencias, no hace push.

```typescript
await azdo.mergeWithTemplate({
    project: "mi-proyecto",
    repository: "frontend",
    targetBranch: "main",
    template: { project: "shared", repository: "camaleon", branch: "main" },
    filters: { omit: ["**/azure-pipelines*.y*", "infra"] }, // no copiar pipelines ni la carpeta infra
    overwrite: true,        // true por defecto: pisa archivos existentes
    deleteExtra: false,     // false por defecto: no borra archivos que el template no tiene
    transform: (file) => {
        if (file.path === "/azure-pipelines.yml") {
            file.content = Buffer.from("name: " + repo);
        }
    },
    comment: "feat: sincronizar con camaleon"
});
// → { message: "Applied N changes", changes: [...] }  |  { message: "No changes", changes: [] }
```

Los patrones de `filters.omit` soportan globs tipo gitignore:
`*` no cruza carpetas, un globstar (`**`) cruza cualquier profundidad y,
seguido de `/`, cubre también la raíz. Los nombres de carpeta (`"infra"`)
omiten la carpeta y todo su contenido.

### Branches

```typescript
const branches = await azdo.listBranches("frontend");

const exists = await azdo.branchExists("frontend", "feature/login");  // → exists.body.exists → true | false

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
// Si ya existe un PR activo con la misma fuente/destino, no lanza el error 409:
// devuelve el PR existente con newPr.body.exists === true.
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

### Environments

```typescript
const env = await azdo.environmentExists("mi-proyecto", "staging");
// → { exists: true, data } si existe · { exists: false } si no

const created = await azdo.createEnvironment("mi-proyecto", "staging", "Staging environment");
// si ya existe un environment con ese nombre, devuelve el existente con
// created.body.exists === true en lugar de lanzar el 409 de Azure
```

> **Creación idempotente**: todos los métodos `create*` validan existencia antes de crear y devuelven el recurso existente con `exists: true` en lugar de lanzar el error 409 de Azure (y si Azure responde 409 por un race, recuperan el existente). Esto aplica a `createPullRequest()`, `createEnvironment()`, `createEnvironmentWithApprovals()`, `createEnvironmentApproval()`, `createWebhook()`, `createPipeline()`, `createVariableGroup()`, `createBuildFolder()`, `createPipelinesFolder()`, `createFileInRepo()`, `addAgentPoolToProject()`, `overrideAgentPoolToProject()` y `shareServiceConnection()`.

### Overrides por llamada

Cada método acepta un objeto de opciones con `project`, `apiVersion`, `query`, `insecureTls` y `exec`:

```typescript
// project override → usa otro proyecto solo para esta llamada
await azdo.listRepos({ project: "otro-proyecto" });

// organization-level → omite el project de la URL
await azdo.listProjects({ organizationLevel: true });

// TLS inseguro solo para esta llamada (certificado autofirmado / CA interna)
await azdo.listBuilds({ definitionId: 5, insecureTls: true });

// dry-run — solo loguea la petición HTTP sin enviarla
await azdo.listRepos({ exec: { dryRun: true } });
```

Los tipos de respuesta completos (`AzdoProject`, `AzdoGitRepository`, `AzdoBuild`, etc.) se exportan desde la raíz del paquete para tipado en TypeScript.

### Errores legibles (`AzdoApiError`)

La REST API de Azure DevOps devuelve errores con cuerpo JSON rico (`message`, `typeKey`, `errorCode`, `innerException`, ...), pero el detalle se perdía en un genérico `HTTP 403 responded with 403`. Cualquier error HTTP de `AzureDevOpsApi` se lanza ahora como **`AzdoApiError`**, que parsea ese cuerpo y lo presenta de forma legible:

```typescript
try {
    await azdo.pushChanges({ project: "mi-proyecto", repository: "api", branch: "main", comment: "x", changes: [] });
} catch (err) {
    console.log(String(err));
}
```

```
✖ Azure DevOps permisos — HTTP 403 Forbidden
  Petición : POST https://dev.azure.com/miorg/mi-proyecto/_apis/git/repositories/api/pushes?api-version=7.1
  Mensaje  : TF401027: You need the Git 'ForcePush' permission to perform this operation.
  Detalle  : código=TF401027 · tipo=RequestNotAuthorizedException · errorCode=0 · eventId=3000
  Qué significa: Falta el permiso 'ForcePush' de Git.
  Sugerencias:
    • Un admin debe conceder 'Force push (rewrite history)' en Repos > Security, o evita reescribir historial.
    • Pide al administrador los permisos necesarios sobre el proyecto/repo/pipeline.
    • Si el PAT tiene restricciones de scope, amplíalo (ej. Code Read & Write, Build).
```

Qué aporta cada pieza:

| API | Uso |
|---|---|
| `err.message` | Resumen de una línea: `[AZDO] HTTP 403 Forbidden — POST ... — TF401027: You need...` |
| `String(err)` / `formatAzdoError(err)` | Bloque multi-línea legible (el del ejemplo) |
| `err.detail` | Detalle estructurado: `{ status, kind, serverMessage, code, typeKey, errorCode, eventId, innerMessages, hints, ... }` |
| `parseAzdoError(err)` | Parsea cualquier error con forma HTTP y devuelve el detalle (o `null`) |
| `formatAzdoError(err)` | Devuelve el texto legible; acepta el error o el detalle ya parseado |

Notas:

- El error conserva `status`, `headers`, `body` y `request` del error HTTP original, así que los checks tipo `err.status === 404` siguen funcionando igual que siempre. Los helpers de existencia (`branchExists()`, `repoExists()`, `fileExists()`, `webhookExists()`, `environmentExists()`, `pipelineExists()`) devuelven una propiedad `exists` en lugar de lanzar: `branchExists()` la expone en `body.exists`, y el resto en `result.exists` (con `result.data` cuando existe).
- Detecta códigos TF/VS conocidos (`TF400813`, `TF401019`, `TF401027`, `TF401320`, `VS800075`, ...) con explicación y sugerencia específica; los desconocidos caen a sugerencias por status HTTP (401 → PAT expirado/org incorrecta, 404 → puede ser falta de permisos, 409 → `oldObjectId` desactualizado, 429 → throttling, etc.).
- Aplana la cadena `innerException` del servidor en `detail.innerMessages`.
- Soporta cuerpos no-JSON (proxies que devuelven HTML) y clasifica errores de red/timeout (`status: 0`) como `Red / Timeout`.

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
    defaultTimeout: 10000,  // 10 segundos
    insecureTls: false      // true = acepta cualquier certificado TLS del servidor
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
// Crear agentes a partir de parámetros — el HttpService interno se crea solo
ctx.services.http.createAgent("github", {
    baseUrl: "https://api.github.com",
    defaultHeaders: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
});

ctx.services.http.createAgent("internal", {
    baseUrl: "https://internal.mycompany.com/api",
    defaultHeaders: { "X-API-Key": process.env.INTERNAL_KEY }
});

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
ctx.services.http.createAgent("internal", { baseUrl: "https://nueva-api.mycompany.com" });
```

**Ejemplo completo — interceptores por agente:**

```javascript
ctx.services.http.createAgent("github", {
    baseUrl: "https://api.github.com",
    defaultHeaders: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    requestInterceptors: [
        (ctx) => {
            ctx.request.headers["Accept"] = "application/vnd.github.v3+json";
        }
    ],
    responseInterceptors: [
        (ctx) => {
            if (ctx.response.body?.data) {
                ctx.response.body = ctx.response.body.data;
            }
        }
    ]
});

ctx.services.http.createAgent("internal", {
    baseUrl: "https://internal.mycompany.com/api",
    requestInterceptors: [
        async (ctx) => {
            const token = await fetchTokenFromVault();
            ctx.request.headers["Authorization"] = `Bearer ${token}`;
        }
    ]
});

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

### TLS inseguro (`insecureTls`)

Para servidores con certificado autofirmado o firmado por una CA interna que tu máquina no confía (Azure DevOps Server on-premise, proxies corporativos, ...), activa `insecureTls` y el agente omitirá la validación del certificado TLS. No requiere gestionar ningún certificado:

```javascript
// Global para el agente (y para cada agente nombrado que lo declare en su config)
ctx.services.http.configure({ baseUrl: "https://azdos.internal:8080", insecureTls: true });

// O solo para una llamada puntual — prioridad sobre el default del agente
await ctx.services.http.get("https://azdos.internal:8080/ping", { insecureTls: true });

// Agentes nombrados también aceptan la opción en createAgent()
ctx.services.http.createAgent("onprem", {
    baseUrl: "https://azdos.internal:8080",
    insecureTls: true
});

// Consultar el estado de un agente
ctx.services.http.agent("onprem").isInsecureTls(); // true
```

Sin `insecureTls`, un certificado no confiable falla con un error descriptivo (`status: 0`, causa real en el mensaje — no un genérico "fetch failed").

**Importante**: desactivar la validación TLS te expone a ataques man-in-the-middle. Úsalo solo contra servidores de confianza dentro de tu red.

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

Además, cada error lleva un **código** (`code()` para asignarlos y `mapCode()` para interceptarlos por código), ver [Códigos de error en todas las tareas](#códigos-de-error-en-todas-las-tareas).

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
| `senders.log()` | Usa el logger interno (consola), con área y código |
| `senders.console({ causes?, original?, success?, hintGeneric?, only? })` | Consola para **verificar códigos de error**: código, mapeo aplicado, mensaje original y causas (ver [Canal de consola](#canal-de-consola-sendersconsole)) |
| `senders.file({ path })` | Agrega el evento como una línea JSON al archivo |
| `senders.http({ url, method?, headers?, formatBody? })` | `POST` genérico del evento como JSON |
| `senders.webhook({ url, format? })` | Como `http`, pero formatea `{ text: "❌ ..." }` por defecto — compatible con Slack/Discord y con **Microsoft Teams** vía Workflows (Power Automate), pasando un `format` que arme el payload de Adaptive Card que Teams espera |
| `senders.websocket({ url, timeout? })` | Abre una conexión WS, manda el evento como JSON y cierra. Requiere Node ≥21 (usa el `WebSocket` global) |

Podés escribir tu propio sender: es cualquier función `(event) => void | Promise<void>` — recibe `{ type, taskId, area?, error?, result?, message, timestamp, service?, method?, args?, code?, causes?, rawMessage?, mappedCode? }`.

En los eventos de error, `code` siempre está presente (ver [Códigos de error en todas las tareas](#códigos-de-error-en-todas-las-tareas)). `rawMessage` es el mensaje antes de `mapCode`/`describeError`, `causes` trae las causas secundarias con código (p. ej. las `K8S-2xx` de un rollout) y `mappedCode` indica con qué código matcheó un `mapCode`.

Los campos `service`, `method` y `args` solo están presentes cuando el error viene de `ctx.wrap()` (un `ServiceError`).

### Códigos de error en todas las tareas

Todo evento de error que llega a los canales (`ctx.run`, items de menú, `ctx.wrap`) trae un **código** con el formato `DOMINIO-NNN-NOMBRE`, también en `ctx.failures[].code` y en el `errorCode` del resultado de un pipeline. El número es estable y el sufijo describe el error de un vistazo (`K8S-201-OOMKILLED`, `APP-100-CONFIG`, ...).

El código se resuelve en este orden:

1. **Tus resolvers**, registrados con `ctx.notifier.code(...)`, en orden: gana el primero que devuelva un código válido.
2. **El código propio del error**: `err.code` / `err.errorCode` con ese formato, como los `DeploymentRolloutError` de `kubectl`/`oc` ([catálogo K8S](#catálogo-de-errores-de-rollout-k8s-nnn-nombre)) o un `CodedError` lanzado por tu task. Se busca también dentro de `ServiceError.cause`. Los `code` de Node (`ENOENT`, ...) no cumplen el formato y se ignoran.
3. **Un genérico**, según la forma del error:

| Código | Cuándo | Qué hacer |
|---|---|---|
| `GEN-000-UNKNOWN` | Cualquier error sin código propio (`Error`, string, ...) | Asignarle uno con `ctx.notifier.code(...)` o lanzar un `CodedError` |
| `GEN-001-EXEC` | Un comando de `shell.exec` (o de cualquier servicio que lo use) salió con código ≠ 0 | Mapearlo con `codes.byCommand` / `codes.byRule` |
| `GEN-002-EXECTIMEOUT` | Un comando superó su `exec.timeout` | Aumentar el timeout o revisar por qué se cuelga |

La idea es partir con todo en genérico, mirar en consola qué cae ahí y **ir mapeando** de a poco:

```javascript
const { codes, senders, CodedError } = require("@cat-indev/catops-cli");

// 1. Canal de consola para verificar los códigos (ver abajo)
ctx.notifier.channel("*", senders.console());

// 2. Asignar códigos propios a lo que hoy sale como GEN-xxx
ctx.notifier
    .code(codes.byRule([
        { command: "docker", args: "push", pattern: /500 Internal Server Error/, code: "DOCKER-101-PUSH500" },
        { command: "docker", args: "build", code: "DOCKER-102-BUILD" },
        { command: "git", pattern: /CONFLICT/, code: "GIT-100-CONFLICT" }
    ]))
    .code(codes.byPattern([[/no space left|ENOSPC/i, "INFRA-100-NOSPACE"]]))
    .code(codes.byCommand({ terraform: "TF-000-EXEC" }));   // catch-all por comando

// 3. Interceptar por código: cambiar el mensaje y/o el canal
ctx.notifier
    .mapCode("DOCKER-101-PUSH500", { message: "Se reportó a infraestructura: registry sin espacio", area: "infra" })
    .mapCode("K8S-201-OOMKILLED", { message: info => `Sin memoria en ${info.causes[0]?.pod}, subir limits` })
    .mapCode("K8S-1*", { area: "kubernetes" })                        // glob
    .mapCode(/^GEN-/, { message: "[{code}] {taskId}: {rawMessage}" });  // plantilla

// 4. O que la task lance su propio código
await ctx.run("config", () => {
    if (!process.env.DB_URL) throw new CodedError("APP-100-CONFIG", "Falta la variable DB_URL");
});
```

**`mapCode(matcher, { message?, area? })`**

- `matcher` puede ser un código exacto, un glob (`"K8S-2*"`), un `RegExp` o una lista de ellos.
- Primero se busca un mapeo para el **código principal**. Si no hay, se prueba con cada **causa secundaria** en orden. Así, mapear `K8S-201-OOMKILLED` también aplica a un `K8S-101-TIMEOUT` cuyo motivo fue un OOM. `message` y `area` se resuelven por separado: cada uno toma el primer mapeo que matchee **y** defina ese campo (en el ejemplo, el área sale de `K8S-1*` y el mensaje de `K8S-201-OOMKILLED`).
- `message` puede ser un string con los placeholders `{code}`, `{matchedCode}`, `{taskId}` y `{rawMessage}`, o una función `(info, ctx) => string`. `info` trae `{ taskId, code, matchedCode, causes, error, rawMessage }`.
- `area` cambia el canal al que se enruta.
- `mapCode` tiene prioridad sobre `classify()` y `describeError()`. Si no hay mapeo, esos siguen funcionando igual que siempre.

También hay fábricas por código para los mecanismos existentes: `classifiers.byCode({ "K8S-*": "kubernetes" })` y `messages.byCode({ "GEN-001-EXEC": "Falló un comando" })`. `ctx.notifier.resolveCode(error, ctx)` devuelve el código de cualquier error con la misma resolución.

| Fábrica de `codes` | Uso |
|---|---|
| `codes.byRule([{ command?, args?, pattern?, code }, ...])` | Comando + sub-comando + patrón de texto, en modo AND (igual que `messages.byRule`) |
| `codes.byPattern([[regex, code], ...])` | Según el texto del error (stderr → stdout → message) |
| `codes.byCommand({ docker: "DOCKER-000-EXEC" })` | Código fijo por comando |
| `codes.byService({ http: "HTTP-000-ERROR" })` | Código fijo por servicio envuelto con `ctx.wrap()` |

Las fábricas validan el formato al registrarse: un código mal formado lanza un error de inmediato, no cuando ocurre el fallo.

#### Canal de consola: `senders.console()`

Pensado para **verificar los códigos**. Por cada error imprime el código, si lo cambió un `mapCode`, el mensaje original (cuando se reemplazó) y una línea por causa secundaria. Para los genéricos, además, sugiere cómo mapearlos:

```
ERROR [K8S-101-TIMEOUT] (mapeado por K8S-201-OOMKILLED) [kubernetes] deploy-api: Sin memoria en api-7d9f-x, subir limits
WARN    [K8S-101-TIMEOUT] original: [K8S-101-TIMEOUT] Timeout esperando el rollout de "api" (300000ms) | causas: K8S-201-OOMKILLED en api-7d9f-x
WARN    [K8S-101-TIMEOUT] causa K8S-201-OOMKILLED | pod api-7d9f-x | container app | límite de memoria 256Mi, restarts=4
ERROR [GEN-001-EXEC] [unclassified] build: npm ERR! code ELIFECYCLE
INFO    [GEN-001-EXEC] código genérico: asígnale uno propio con ctx.notifier.code(codes.byRule([...])) o lanza un CodedError
```

| Opción | Default | |
|---|---|---|
| `causes` | `true` | Una línea por causa secundaria |
| `original` | `true` | El mensaje crudo, si `mapCode`/`describeError` lo cambió |
| `success` | `true` | Imprime también los eventos de éxito |
| `hintGeneric` | `true` | Sugerencia para los `GEN-xxx` |
| `only` | — | Solo los errores cuyo código matchee (`"K8S-*"`, `RegExp` o lista) |

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

## Servicio YAML: manipulación de archivos de configuración (`ctx.services.yaml`)

Un servicio para leer, modificar y serializar archivos YAML con soporte para operaciones declarativas, comentarios, y documentos múltiples.

### Uso básico

```typescript
// Parsear YAML desde string
ctx.services.yaml.fromYaml(`
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  ENV: production
`);

// Obtener valores
ctx.services.yaml.yamlGet("metadata.name");            // "app-config"
ctx.services.yaml.yamlGet("data.ENV", "default");     // "production"

// Asignar valores (crea paths nuevos si no existen)
ctx.services.yaml.yamlSet(["data", "DEBUG"], "false");

// Serializar a YAML
const yamlString = ctx.services.yaml.yamlify();

// Serializar a JSON
const jsonString = ctx.services.yaml.stringify();
```

### Trabajar con JSON

```typescript
// Convertir JSON a YAML interno
ctx.services.yaml.fromJson({
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "api-service" }
});

// Obtener como objeto JSON
const obj = ctx.services.yaml.jsonify();
```

### Arrays y omisión de keys

```typescript
// Agregar elementos a un array
ctx.services.yaml.yamlPush(["data", "ALLOWED_HOSTS"], ["host1.example.com", "host2.example.com"]);

// Concatenar al inicio de un string
ctx.services.yaml.yamlConcatInitAndSet(["data", "PREFIX"], "prod-");  // "prod-valor-anterior"

// Eliminar paths del documento
ctx.services.yaml.yamlOmit(["data", "DEBUG", "data", "TEMP"]);
```

### Comentarios

```typescript
// Agregar commentBefore a un nodo específico
ctx.services.yaml.comment("Configuración del backend", ["data", "BACKEND_URL"]);
```

### Declaraciones batch con `prepare()`

`prepare()` permite aplicar múltiples mutaciones en una sola llamada — ideal para transformaciones complejas:

```typescript
ctx.services.yaml.prepare({
    // Asignar valores por path
    $set: [
        { path: "apiVersion", value: "v1" },
        { path: "metadata.labels.env", value: "production" }
    ],

    // Agregar a arrays
    $push: [
        { path: "spec.containers", value: { name: "sidecar", image: "proxy:v1" } }
    ],

    // Fusionar objetos existentes
    $spread: [
        { path: "metadata.labels", value: { version: "v2", team: "platform" } }
    ],

    // Asignar el mismo valor a múltiples paths
    $superSet: {
        value: "true",
        $set: ["data.ENABLE_FEATURE_A", "data.ENABLE_FEATURE_B"],
        $init: ["data.PREFIX"]  // concatena al inicio en vez de reemplazar
    },

    // Asignar valores por path (shorthand)
    $merge: {
        "data.RETRY_COUNT": "3",
        "data.TIMEOUT": "30000"
    },

    // Eliminar keys
    $delete: ["data.DEBUG", "data.TEMP"]
});
```

### Documentos múltiples

Para archivos YAML con múltiples documentos separados por `---`:

```typescript
// Crear documentos múltiples
ctx.services.yaml.multidocument(
    { yaml: "kind: Deployment\nmetadata:\n  name: api", name: "deployment" },
    { replicas: 3 }  // apply extra values sobre el nuevo doc
);

ctx.services.yaml.multidocument(
    { yaml: "kind: Service\nmetadata:\n  name: api-svc", name: "service" }
);

// Cambiar entre documentos
ctx.services.yaml.use("deployment");
console.log(ctx.services.yaml.yamlify());  // imprime el doc "deployment"

ctx.services.yaml.use("service");
console.log(ctx.services.yaml.yamlify());  // imprime el doc "service"

// Verificar si un documento existe
ctx.services.yaml.existDocument("deployment");  // true
```

### Clonar

```typescript
const clone = ctx.services.yaml.clone();
// clone es independiente — modificar uno no afecta al otro
```

### Parsear YAML vacío

```typescript
ctx.services.yaml.fromYaml("");  // crea documento vacío, no lanza error
```

### Ejemplo completo: modificar un Deployment de Kubernetes

```typescript
ctx.services.yaml.fromYaml(readFileSync("deployment.yaml", "utf8"));

ctx.services.yaml.prepare({
    $set: [
        { path: "spec.template.metadata.labels.version", value: "v2.1.0" },
        { path: "spec.template.spec.containers.0.image", value: "registry/app:v2.1.0" }
    ],
    $spread: [
        { path: "spec.template.metadata.annotations", value: { "deployed-at": new Date().toISOString() } }
    ],
    $delete: ["spec.template.spec.initContainers"]
});

const updatedYaml = ctx.services.yaml.yamlify();
writeFileSync("deployment.yaml", updatedYaml);
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
- `http-insecure.test.js` — TLS inseguro contra un servidor HTTPS real con certificado autofirmado: rechazo por defecto, aceptación con insecureTls global/nombrado/por-petición y herencia de AzureDevOpsApi al agente interno perezoso y al externo inyectado
- `kubectl.test.js`, `oc.test.js` — kubeconfig/namespace, waitForDeployment (éxito, timeout, Failed, maxRestarts)
- `exec-options-passthrough.test.js` — retry/timeout/dryRun (`exec`) llegando a todos los servicios, incluyendo un retry real que se recupera tras 2 fallos
- `deployment-group.test.js` — waitForDeploymentGroup (éxito total, fallo parcial, label sin matches, oc con `dc`)
- `azdo-api.test.js` — AzureDevOpsApi contra mock server: proyectos, repos, branches, commits, PRs, builds, pipelines, work items, overrides
- `azdo-errors.test.js` — parser de errores de Azure DevOps: extracción de message/typeKey/código TF/VS, innerException aplanada, cuerpos no-JSON, errores de red, formato legible, compatibilidad de los checks de 404 tras el wrap
- `azdo-interceptors.test.js` — interceptores del agente HTTP de AzureDevOpsApi: vía configure() y vía métodos add/remove/clear, cola perezosa antes del primer request, agente externo compartido, error descriptivo con agentes sin soporte
- `azdo-template.test.js` — mergeWithTemplate(): add/edit/delete en un único push, filters.omit (carpetas y globs tipo `**/azure-pipelines*.y*`), overwrite, transform previa a la comparación, repo vacío
- `pipeline.test.js` — Pipeline motor: stages/jobs/tasks, dependencias cross-level con paths dotted, resultados jerárquicos (stage.job.task), fluent API, registry, reset, ctx access, detección de tipo por propiedad, PipelineResultsAccessor
- `service-notify.test.js` — ServiceError, ctx.wrap(), Notifier con service/method/args, classifiers.byService/messages.byService, unwrap de ServiceError en byCommand/byPattern/byRule, integración completa, backward compat
- `yaml.test.js` — YamlService: fromYaml/fromJson, yamlGet/yamlSet/yamlPush/yamlOmit, comment(), prepare() con $set/$push/$spread/$superSet/$merge/$delete, multidocument/use/clone

## Siguientes pasos posibles

- Publicar en un registro privado (Verdaccio/Artifactory/GitHub Packages) para instalarlo con scope, p.ej. `@miorg/catops-cli`.
- Agregar más plugins (`ansible-lint`, `trivy`, `sonar-scanner`) con el mismo patrón que `terraform.ts`/`docker.ts`.
- CI propio (GitHub Actions/Azure Pipelines) que corra `npm test` en cada PR antes de `npm publish`.
- ~~`--catch=throw` (o similar) para que un item de menú fallido mate el proceso completo~~ **Hecho e invertido**: ahora un item de menú fallido lanza el error y mata el proceso con exit 1 por defecto (útil corriendo vía `--menu-selector` dentro de un step de Azure Pipelines). Con `--catch=no-throw` se traga el error y el menú sigue operando.
- Exportar tipos YAML (`YamlPrepareActions`) y crear helpers para templates comunes (Kubernetes manifests, Helm values, etc.).
