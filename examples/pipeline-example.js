const { Context, Menu, senders, classifiers } = require("../dist");

// node pipeline-example.js --menu-selector=docker --docker-action=build
// node pipeline-example.js --menu-selector=deploy
// node pipeline-example.js                                  (menú interactivo)
const ctx = Context.parseArgv();
ctx.services.shell.configure({ dryRun: true }); // demo: no ejecuta nada real

ctx.set("image", "registry/api:v1");
ctx.set("chart", "./deploy/api");

// --- Notificaciones: clasificar errores por área de TI y enrutarlos -------

ctx.notifier.classify(classifiers.byCommand({
    docker: "containers",
    kubectl: "kubernetes",
    git: "scm"
}));

ctx.notifier.channel("containers", senders.log());
ctx.notifier.channel("kubernetes", senders.log());
ctx.notifier.channel("*", senders.file({ path: "./catops-cli-errors.log" }));
ctx.notifier.onSuccess(senders.log());

// --- Tasks ------------------------------------------------------------

async function buildTask() {
    const image = ctx.get("image");
    await ctx.run("git", () => ctx.services.git.revParse());
    await ctx.services.npm.ci();
    await ctx.run(
        "build",
        () => ctx.services.docker.build({ image, dockerfile: "Dockerfile" }),
        {
            onSuccess: () => ctx.logger.success(`Imagen construida: ${image}`),
            onError: (error) => ctx.logger.error(`Build falló: ${error.message}`)
        }
    );
}

async function pushTask() {
    const image = ctx.get("image");
    await ctx.services.docker.push(image);
}

async function deployTask() {
    const chart = ctx.get("chart");
    await ctx.services.kubectl.apply(`${chart}/deployment.yaml`);
    await ctx.services.kubectl.rolloutStatus("deployment/api");
}

const dockerMenu = {
    title: "Docker",
    "flag-selector": "--docker-action",
    options: {
        Build: { selector: "build", action: buildTask },
        Push: {
            selector: "push",
            action: pushTask,
            onSuccess: (r, c) => c.logger.success("Push OK"),
            onError: (e, c) => c.logger.error(`Push falló: ${e.message}`)
        }
    }
};

const mainMenu = {
    title: "Pipeline API",
    "flag-selector": "--menu-selector",
    options: {
        Docker: { selector: "docker", menu: dockerMenu },
        Deploy: { selector: "deploy", action: deployTask }
    }
};

Menu.render(mainMenu, ctx);
