# catops-cli

Framework interno para pipelines DevOps, empaquetado como librería npm instalable en cualquier proyecto.

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
npm pack               # genera catops-cli-0.1.0.tgz

# Dentro del proyecto que lo va a consumir
npm install /ruta/a/catops-cli-0.1.0.tgz
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

1. La librería: `const { Context, Menu, services } = require("catops-cli");`
2. El binario: `npx catops-cli` (o `catops-cli` si lo instalaste global con `-g`).

## Publicar una nueva versión

```bash
npm version patch   # o minor / major
npm publish         # agrega --access public si usas un scope (@miorg/catops-cli)
```

## Piezas que integra

Une dos piezas que ya tenías:

1. El **ExecutionContext** (estado global: flags, params, env, vars, results, logger, prompt).
2. Los **servicios de shell** (`shell`, `docker`, `git`, `kubectl`, `helm`, `npm`, `archive`), integrados **tal cual** los diste, sin reescribir su lógica.

La única pieza nueva es el pegamento: `ctx.services` apunta directamente a los módulos de `src/services`, así que cualquier task puede hacer `ctx.services.docker.build(...)` sin recibir nada por parámetro, tal como describías.

## Estructura

```
src/
  core/
    Context.js    -> ExecutionContext singleton (Context.current())
    Menu.js        -> Renderer/Menu.render() para navegación jerárquica
    prompt.js       -> ctx.ask / ctx.confirm / ctx.select (sin dependencias externas)
    logger.js       -> logger usado por Context y por shell.js
  services/
    shell.js        -> motor base (spawn), con retry/timeout/dryRun
    docker.js       -> tal cual el original
    git.js          -> tal cual el original
    kubectl.js      -> tal cual el original
    helm.js         -> tal cual el original
    npm.js          -> tal cual el original
    archive.js      -> tal cual el original
    terraform.js    -> init/plan/apply/destroy/output/validate/fmt
    ansible.js      -> playbook/adhoc/vaultEncrypt/vaultDecrypt/galaxyInstall
    argocd.js       -> login/appSync/appGet/appWait/appSet/appList/appRollback
    tekton.js       -> pipelineStart/pipelinerunList/pipelinerunLogs/taskStart/taskrunLogs
    oc.js           -> login/project/apply/get/rollout/newApp/startBuild/logs
    az.js           -> loginServicePrincipal/acrBuild/webappDeploy/aksGetCredentials/...
    azdo.js         -> logging commands de Azure Pipelines (##vso)
    index.js        -> registra todos los servicios anteriores
  index.js          -> exporta { Context, Menu, logger, prompt, services }
examples/
  pipeline-example.js -> pipeline + menú de ejemplo
test/
  context.test.js     -> Context, flags, vars, parseArgv, dryRun global
  shell.test.js       -> retry, timeout, dryRun del motor shell.exec
  services.test.js    -> verifica que docker/terraform/argocd arman bien los args
```

## Qué se corrigió para que "convivan"

- `shell.js` usaba `logger.info(...)` / `logger.error(...)` sin importarlo. Se agregó `const logger = require("../core/logger")`.
- `Context.js` hacía `this.logger = logger` sin importar `logger` tampoco. Ahora importa `./logger`.
- Se agregó `this.services = services` dentro del constructor de `Context`, cableando exactamente el "Registry" que proponías al final de tu mensaje:

```javascript
ctx.services.git.clone(...)
ctx.services.docker.build(...)
```

- `Context.instance` pasó de crearse en la definición de la clase a crearse de forma perezosa en `Context.current()`, para evitar problemas de orden de carga con los `require` circulares entre `Context` → `services` → `shell` → `logger`.

## Uso dentro de un proyecto que lo instaló

Crea un `devops.pipeline.js` (o `devops.config.js` / `.catops-cli.js`) en la raíz de tu proyecto:

```javascript
// devops.pipeline.js
module.exports = (ctx) => ({
    title: "Pipeline",
    options: {
        Build: async () => {
            await ctx.services.docker.build({
                image: "registry/app:v1",
                dockerfile: "Dockerfile"
            });
        },
        Deploy: async () => {
            await ctx.services.kubectl.apply("deployment.yaml");
        }
    }
});
```

Y ejecuta:

```bash
npx catops-cli --debug --env=prod
```

`catops-cli` detecta el archivo, arma el `Context` a partir de los flags/params de `argv`, y renderiza el menú.

## Uso como librería (sin el menú interactivo)

```bash
npm run example -- --debug --env=prod
```

```javascript
const { Context, Menu } = require("./src");

const ctx = Context.parseArgv(); // llena flags/params desde argv

ctx.set("image", "registry/api:v1");

await ctx.services.git.checkout("develop");
await ctx.services.npm.ci();
await ctx.services.docker.build({ image: ctx.get("image"), dockerfile: "Dockerfile" });
await ctx.services.docker.push(ctx.get("image"));
await ctx.services.kubectl.apply("deployment.yaml");
```

O con menús interactivos anidados:

```javascript
await Menu.render({
    title: "Deploy",
    options: {
        Build: buildTask,
        Docker: dockerMenu,   // submenú anidado
        Publish: publishTask
    }
});
```

## retry / timeout / dryRun en shell.exec

`shell.exec(command, ...args)` sigue aceptando exactamente los mismos argumentos que antes (por eso `docker.js`, `git.js`, etc. no necesitaron cambiar). Ahora, si el último argumento es un objeto plano, se interpreta como opciones **solo para esa llamada**:

```javascript
await ctx.services.docker.push(image); // igual que siempre

await ctx.services.shell.exec("curl", "https://flaky-api.internal", {
    retry: 3,        // reintentos totales (default: 1 = sin retry)
    retryDelay: 1000,// ms entre reintentos
    timeout: 5000,   // ms antes de matar el proceso con SIGTERM
    dryRun: true      // solo loguea el comando, no lo ejecuta
});
```

También puedes fijar defaults globales para todo el proceso:

```javascript
ctx.services.shell.configure({ retry: 3, timeout: 30000 });
```

Y `Context.parseArgv()` ya conecta flags de línea de comandos automáticamente:

```bash
npx catops-cli --dry-run             # activa dryRun global
npx catops-cli --retry=3 --timeout=15000
```

## Logging commands de Azure Pipelines (`ctx.services.azdo`)

```javascript
ctx.services.azdo.setVariable("BUILD_TAG", "v1.2.3");
ctx.services.azdo.logWarning("El caché de npm no se encontró, se reconstruye desde cero.");
ctx.services.azdo.group("Build");
// ... pasos ...
ctx.services.azdo.endGroup();
```

## Servicios de infraestructura ya integrados

```javascript
await ctx.services.terraform.plan({ varFile: "prod.tfvars" });
await ctx.services.terraform.apply();

await ctx.services.ansible.playbook("site.yml", { inventory: "hosts.ini" });

await ctx.services.argocd.appSync("mi-app", { prune: true });

await ctx.services.tekton.pipelineStart("build-pipeline", { params: { image: "app:v1" } });

await ctx.services.oc.login({ server: "https://api.cluster:6443", token: process.env.OC_TOKEN });
await ctx.services.oc.rollout("mi-app");

await ctx.services.az.acrBuild({ registry: "miregistro", image: "app:v1" });
```

## Callbacks de éxito/error por tarea + notificaciones por área de TI

Cada tarea (`ctx.run()` o un item de menú) puede llevar sus propios callbacks, y además reporta automáticamente al `notifier` global del `Context`.

### Callbacks por tarea

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

En un menú, los mismos campos van directo en el item:

```javascript
options: {
    Deploy: {
        selector: "deploy",
        action: () => ctx.services.kubectl.apply("deployment.yaml"),
        onSuccess: (result, ctx) => {...},
        onError: (error, ctx) => {...}
    }
}
```

### Clasificar el error por área de TI y enrutarlo a canales

`ctx.notifier` clasifica cada error (con la función que le des) y lo manda a los `senders` que hayas registrado para esa área:

```javascript
const { classifiers, senders } = require("catops-cli");

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

// también puedes clasificar por el texto del error:
ctx.notifier.classify(classifiers.byPattern([
    [/permission denied|unauthorized/i, "security"],
    [/timeout|ECONNREFUSED/i, "networking"],
    [/no space left|ENOSPC/i, "infra"]
]));

// 2. ¿A dónde se manda cada área?
ctx.notifier.channel("kubernetes", senders.webhook({ url: process.env.SLACK_K8S_WEBHOOK }));
ctx.notifier.channel("security", senders.http({ url: "https://security.miempresa.com/incidents" }));
ctx.notifier.channel("*", senders.file({ path: "./catops-cli-errors.log" })); // TODO error, sin importar el área

// 3. (opcional) éxito, sin clasificación de área
ctx.notifier.onSuccess(senders.log());
```

A partir de aquí, cualquier `ctx.run(...)` o item de menú con `action` reporta automáticamente al notifier — no hay que llamarlo a mano en cada task.

### Senders incluidos

| Sender | Uso |
|---|---|
| `senders.log()` | Usa el logger interno (consola) |
| `senders.file({ path })` | Agrega el evento como una línea JSON al archivo |
| `senders.http({ url, method?, headers?, formatBody? })` | `POST` genérico del evento como JSON |
| `senders.webhook({ url, format? })` | Como `http`, pero formatea `{ text: "❌ ..." }` por defecto (Slack/Teams/Discord-friendly) |
| `senders.websocket({ url, timeout? })` | Abre una conexión WS, manda el evento como JSON y cierra. Requiere Node ≥21 (usa el `WebSocket` global) |

Puedes escribir tu propio sender: es cualquier función `(event) => void | Promise<void>` — recibe `{ type, taskId, area?, error?, result?, message, timestamp }`.

## Tests

```bash
npm test
```

Corre sobre `node:test` (sin dependencias externas): valida el `Context`, el motor `shell.exec` (retry/timeout/dryRun) y que los servicios armen los comandos correctos, interceptando `shell.exec` en vez de ejecutar binarios reales.

## Siguientes pasos posibles

- Publicar en un registro privado (Verdaccio/Artifactory/GitHub Packages) para instalarlo con scope, p.ej. `@miorg/catops-cli`.
- Agregar tipos (`.d.ts`) si el equipo usa TypeScript.
- Agregar más plugins (`ansible-lint`, `trivy`, `sonar-scanner`) con el mismo patrón.
- CI propio (GitHub Actions/Azure Pipelines) que corra `npm test` en cada PR antes de `npm publish`.
