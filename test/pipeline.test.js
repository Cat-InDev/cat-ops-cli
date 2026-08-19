const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Pipeline, PipelineStage, PipelineJob, PipelineTask, PipelineRegistry, PipelineResultsAccessor } = require("../dist");

function createCtx() {
    const { Context } = require("../dist");
    return Context.current();
}

// ---------------------------------------------------------------------------
// PipelineTask
// ---------------------------------------------------------------------------

describe("PipelineTask", () => {

    it("ejecuta el callback y guarda el resultado", async () => {
        const task = new PipelineTask("build", {
            exec: () => "built"
        });

        const ctx = createCtx();
        const results = {};
        await task.run(ctx, results, "s1", "j1");

        assert.equal(task.status, "success");
        assert.equal(task.result, "built");
        assert.ok(task.duration >= 0);
    });

    it("marca failed si el callback lanza", async () => {
        const task = new PipelineTask("fail", {
            exec: () => { throw new Error("boom"); }
        });

        const ctx = createCtx();
        const results = {};
        await assert.rejects(() => task.run(ctx, results, "s1", "j1"), { message: "boom" });

        assert.equal(task.status, "failed");
        assert.equal(task.error.message, "boom");
    });

    it("lanza si falta una dependencia", async () => {
        const task = new PipelineTask("deploy", {
            exec: () => "ok",
            depends: ["build"]
        });

        const ctx = createCtx();
        await assert.rejects(
            () => task.run(ctx, {}, "s1", "j1"),
            /dependency "build" not found/
        );
    });

    it("resuelve si la dependencia está en results", async () => {
        const task = new PipelineTask("deploy", {
            exec: () => "deployed",
            depends: ["build"]
        });

        const ctx = createCtx();
        const results = { build: "built" };
        await task.run(ctx, results, "s1", "j1");

        assert.equal(task.status, "success");
        assert.equal(task.result, "deployed");
    });

    it("resuelve el callback con ctx y results", async () => {
        let receivedCtx, receivedResults;
        const task = new PipelineTask("check", {
            exec: (ctx, results) => {
                receivedCtx = ctx;
                receivedResults = results;
                return 42;
            }
        });

        const ctx = createCtx();
        const results = { prev: "value" };
        await task.run(ctx, results, "s1", "j1");

        assert.equal(receivedCtx, ctx);
        assert.equal(receivedResults, results);
        assert.equal(task.result, 42);
    });

    it("reset() restaura el estado a pending", async () => {
        const task = new PipelineTask("x", { exec: () => "done" });
        const ctx = createCtx();
        await task.run(ctx, {}, "s1", "j1");

        assert.equal(task.status, "success");
        task.reset();
        assert.equal(task.status, "pending");
        assert.equal(task.result, undefined);
    });

    it("soporta exec async", async () => {
        const task = new PipelineTask("async", {
            exec: async () => {
                await new Promise(r => setTimeout(r, 10));
                return "async-done";
            }
        });

        const ctx = createCtx();
        await task.run(ctx, {}, "s1", "j1");
        assert.equal(task.result, "async-done");
    });

    it("guarda metadata", () => {
        const task = new PipelineTask("m", { exec: () => {}, metadata: { owner: "team-a" } });
        assert.deepEqual(task.metadata, { owner: "team-a" });
    });

});

// ---------------------------------------------------------------------------
// PipelineJob
// ---------------------------------------------------------------------------

describe("PipelineJob", () => {

    it("ejecuta tareas en secuencia y guarda results", async () => {
        const job = new PipelineJob("build", {
            tasks: {
                compile: { exec: () => "compiled" },
                test: { exec: () => "tested" }
            }
        });

        const ctx = createCtx();
        const results = {};
        await job.run(ctx, results, "s1");

        assert.equal(job.status, "success");
        assert.equal(job.results.compile, "compiled");
        assert.equal(job.results.test, "tested");
    });

    it("para en la primera tarea que falla", async () => {
        const job = new PipelineJob("build", {
            tasks: {
                compile: { exec: () => { throw new Error("compile error"); } },
                test: { exec: () => "tested" }
            }
        });

        const ctx = createCtx();
        await assert.rejects(() => job.run(ctx, {}, "s1"));

        assert.equal(job.status, "failed");
        assert.equal(job.error.message, "compile error");
    });

    it("resuelve dependencias entre tareas del mismo job", async () => {
        const job = new PipelineJob("pipeline", {
            tasks: {
                build: { exec: () => "artifact" },
                deploy: { exec: (_, r) => `deploy-${r.build}`, depends: ["build"] }
            }
        });

        const ctx = createCtx();
        const results = {};
        await job.run(ctx, results, "s1");

        assert.equal(job.results.deploy, "deploy-artifact");
    });

    it("fluent: .task() agrega tareas", () => {
        const job = new PipelineJob("j");
        job.task("a", { exec: () => 1 }).task("b", { exec: () => 2 });

        assert.equal(job.tasks.size, 2);
        assert.ok(job.getTask("a"));
        assert.ok(job.getTask("b"));
    });

    it("fluent: .task(config) crea tarea anónima", () => {
        const job = new PipelineJob("j");
        job.task({ exec: () => 1 });

        assert.equal(job.tasks.size, 1);
        assert.ok(job.getTask("task1"));
    });

    it("job vacío resolve.success", async () => {
        const job = new PipelineJob("empty");
        const ctx = createCtx();
        await job.run(ctx, {}, "s1");
        assert.equal(job.status, "success");
    });

    it("getResults() devuelve resultados de todas las tareas", async () => {
        const job = new PipelineJob("j", {
            tasks: {
                a: { exec: () => 10 },
                b: { exec: () => 20 }
            }
        });

        const ctx = createCtx();
        await job.run(ctx, {}, "s1");

        const results = job.getResults();
        assert.equal(results.a, 10);
        assert.equal(results.b, 20);
    });

});

// ---------------------------------------------------------------------------
// PipelineStage
// ---------------------------------------------------------------------------

describe("PipelineStage", () => {

    it("ejecuta jobs en secuencia", async () => {
        const stage = new PipelineStage("ci", {
            jobs: {
                build: { tasks: { compile: { exec: () => "ok" } } },
                test: { tasks: { unit: { exec: () => "pass" } } }
            }
        });

        const ctx = createCtx();
        const results = {};
        await stage.run(ctx, results);

        assert.equal(stage.status, "success");
    });

    it("lanza si falta dependencia de stage", async () => {
        const stage = new PipelineStage("deploy", {
            depends: ["ci"]
        });

        const ctx = createCtx();
        await assert.rejects(
            () => stage.run(ctx, {}),
            /dependency "ci" not found/
        );
    });

    it("fluent: .job() agrega jobs", () => {
        const stage = new PipelineStage("s");
        stage.job("j1", { tasks: { t1: { exec: () => 1 } } });
        assert.equal(stage.jobs.size, 1);
        assert.ok(stage.getJob("j1"));
    });

    it("getResults() devuelve resultados anidados de jobs", async () => {
        const stage = new PipelineStage("s", {
            jobs: {
                j1: { tasks: { t1: { exec: () => "a" } } },
                j2: { tasks: { t2: { exec: () => "b" } } }
            }
        });

        const ctx = createCtx();
        await stage.run(ctx, {});

        const results = stage.getResults();
        assert.deepEqual(results.j1, { t1: "a" });
        assert.deepEqual(results.j2, { t2: "b" });
    });

});

// ---------------------------------------------------------------------------
// Pipeline (full)
// ---------------------------------------------------------------------------

describe("Pipeline", () => {

    it("ejecuta stages en secuencia", async () => {
        const order = [];
        const pipeline = new Pipeline("full", {
            stages: {
                build: {
                    jobs: {
                        compile: { tasks: { step1: { exec: () => { order.push("compile"); return "c"; } } } }
                    }
                },
                deploy: {
                    jobs: {
                        push: { tasks: { step2: { exec: () => { order.push("deploy"); return "d"; } } } }
                    }
                }
            }
        });

        const result = await pipeline.run(createCtx());

        assert.equal(result.status, "success");
        assert.deepEqual(order, ["compile", "deploy"]);
        assert.equal(pipeline.status, "success");
    });

    it("pipeline sin stages resolve de inmediato", async () => {
        const pipeline = new Pipeline("empty");
        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.deepEqual(result.results, {});
    });

    it("pipeline con solo tasks (sin stages ni jobs)", async () => {
        const pipeline = new Pipeline("tasks-only", {
            tasks: {
                a: { exec: () => 1 },
                b: { exec: () => 2 }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.default.default.a, 1);
        assert.equal(result.results.default.default.b, 2);
    });

    it("pipeline con solo jobs (sin stages)", async () => {
        const pipeline = new Pipeline("jobs-only", {
            jobs: {
                build: { tasks: { compile: { exec: () => "ok" } } },
                test: { tasks: { unit: { exec: () => "pass" } } }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.default.build.compile, "ok");
        assert.equal(result.results.default.test.unit, "pass");
    });

    it("dependencias cross-stage: deploy depends on build", async () => {
        const pipeline = new Pipeline("cross", {
            stages: {
                build: {
                    jobs: {
                        compile: { tasks: { artifact: { exec: () => "v1" } } }
                    }
                },
                deploy: {
                    jobs: {
                        push: {
                            tasks: {
                                upload: {
                                    exec: (_, r) => `uploaded-${r.build.compile.artifact}`,
                                    depends: ["build.compile.artifact"]
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
    });

    it("fluent API: stage().job().task()", async () => {
        const pipeline = new Pipeline("fluent");
        pipeline.stage("build").job("compile").task("step1", { exec: () => "done" });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.build.compile.step1, "done");
    });

    it("fluent API anidado inline", async () => {
        const pipeline = new Pipeline("fluent2");
        pipeline.stage("s1", {
            jobs: {
                j1: { tasks: { t1: { exec: () => 42 } } }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.s1.j1.t1, 42);
    });

    it("lanza si dependencia cross-stage no existe", async () => {
        const pipeline = new Pipeline("bad-dep", {
            stages: {
                deploy: {
                    jobs: {
                        push: {
                            tasks: {
                                upload: {
                                    exec: () => "nope",
                                    depends: ["nonexistent"]
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "failed");
        assert.match(String(result.error), /dependency "nonexistent" not found/);
    });

    it("para en la primera stage que falla", async () => {
        const order = [];
        const pipeline = new Pipeline("fail-fast", {
            stages: {
                build: {
                    jobs: {
                        compile: { tasks: { step1: { exec: () => { order.push("build"); throw new Error("fail"); } } } }
                    }
                },
                deploy: {
                    jobs: {
                        push: { tasks: { step2: { exec: () => { order.push("deploy"); return "ok"; } } } }
                    }
                }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.deepEqual(order, ["build"]);
        assert.equal(result.status, "failed");
        assert.equal(pipeline.status, "failed");
    });

    it("result() se puede llamar con un context directamente", async () => {
        const pipeline = new Pipeline("ctx-test", {
            tasks: {
                check: { exec: (ctx) => ctx !== undefined ? "has-ctx" : "no-ctx" }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.results.default.default.check, "has-ctx");
    });

    it("reset() restaura el pipeline completo", async () => {
        const pipeline = new Pipeline("reset-test", {
            tasks: {
                a: { exec: () => "done" }
            }
        });

        await pipeline.run(createCtx());
        assert.equal(pipeline.status, "success");

        pipeline.reset();
        assert.equal(pipeline.status, "pending");
        assert.deepEqual(pipeline.results, {});
    });

    it("getStage() devuelve la stage por nombre", () => {
        const pipeline = new Pipeline("get-stage", {
            stages: {
                build: { jobs: { j1: { tasks: { t1: { exec: () => 1 } } } } }
            }
        });

        const stage = pipeline.getStage("build");
        assert.ok(stage);
        assert.equal(stage.name, "build");
        assert.ok(stage.getJob("j1"));
    });

    it("metadata se propaga", () => {
        const pipeline = new Pipeline("meta", { metadata: { env: "prod" } });
        assert.equal(pipeline.metadata.env, "prod");
    });

    it("setContext() guarda el context", async () => {
        const ctx = createCtx();
        const pipeline = new Pipeline("ctx-set").setContext(ctx);
        assert.ok(pipeline);
    });

});

// ---------------------------------------------------------------------------
// PipelineRegistry
// ---------------------------------------------------------------------------

describe("PipelineRegistry", () => {

    it("define() registra un pipeline por nombre", () => {
        const registry = new PipelineRegistry();
        registry.define("deploy", {
            tasks: { a: { exec: () => 1 } }
        });

        assert.deepEqual(registry.list(), ["deploy"]);
    });

    it("get() devuelve el pipeline registrado", () => {
        const registry = new PipelineRegistry();
        registry.define("my-pipeline", {
            tasks: { step: { exec: () => "ok" } }
        });

        const pipeline = registry.get("my-pipeline");
        assert.equal(pipeline.name, "my-pipeline");
    });

    it("get() lanza si el pipeline no existe", () => {
        const registry = new PipelineRegistry();
        assert.throws(
            () => registry.get("nope"),
            /Pipeline "nope" not found/
        );
    });

    it("run() ejecuta el pipeline registrado", async () => {
        const registry = new PipelineRegistry();
        registry.define("simple", {
            tasks: { step: { exec: () => 42 } }
        });

        const result = await registry.run("simple", createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.default.default.step, 42);
    });

    it("remove() elimina un pipeline", () => {
        const registry = new PipelineRegistry();
        registry.define("temp", { tasks: { a: { exec: () => 1 } } });
        assert.ok(registry.remove("temp"));
        assert.deepEqual(registry.list(), []);
    });

    it("list() devuelve todos los nombres", () => {
        const registry = new PipelineRegistry();
        registry.define("p1", { tasks: { a: { exec: () => 1 } } });
        registry.define("p2", { tasks: { b: { exec: () => 2 } } });
        assert.deepEqual(registry.list(), ["p1", "p2"]);
    });

    it("define() sin nombre usa auto-name", () => {
        const registry = new PipelineRegistry();
        registry.define({ tasks: { a: { exec: () => 1 } } });
        assert.deepEqual(registry.list(), ["pipeline1"]);
    });

    it("define() reemplaza si el nombre ya existe", () => {
        const registry = new PipelineRegistry();
        registry.define("p", { tasks: { a: { exec: () => 1 } } });
        registry.define("p", { tasks: { b: { exec: () => 2 } } });
        assert.deepEqual(registry.list(), ["p"]);

        const pipeline = registry.get("p");
        assert.ok(pipeline.getStage("default")?.getJob("default")?.getTask("b"));
    });

    it("ctx.services.pipeline funciona como registry", async () => {
        const ctx = createCtx();
        ctx.services.pipeline.define("test-pipeline", {
            tasks: { step: { exec: () => "works" } }
        });

        const result = await ctx.services.pipeline.run("test-pipeline", ctx);
        assert.equal(result.status, "success");
        assert.equal(result.results.default.default.step, "works");

        ctx.services.pipeline.remove("test-pipeline");
    });

});

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

describe("resolución de dependencias", () => {

    it("ejecuta stages en orden secuencial (definition order)", async () => {
        const order = [];
        const pipeline = new Pipeline("sequential", {
            stages: {
                a: { jobs: { j1: { tasks: { t1: { exec: async () => { await new Promise(r => setTimeout(r, 20)); order.push("a"); return "a"; } } } } } },
                b: { jobs: { j2: { tasks: { t2: { exec: async () => { await new Promise(r => setTimeout(r, 20)); order.push("b"); return "b"; } } } } } }
            }
        });

        await pipeline.run(createCtx());

        // Stages always run sequentially
        assert.deepEqual(order, ["a", "b"]);
    });

    it("respeta el orden con dependencias", async () => {
        const order = [];
        const pipeline = new Pipeline("ordered", {
            tasks: {
                a: { exec: async () => { await new Promise(r => setTimeout(r, 20)); order.push("a"); return "a"; } },
                b: { exec: async () => { await new Promise(r => setTimeout(r, 20)); order.push("b"); return "b"; }, depends: ["a"] },
                c: { exec: async () => { await new Promise(r => setTimeout(r, 20)); order.push("c"); return "c"; }, depends: ["b"] }
            }
        });

        await pipeline.run(createCtx());
        assert.deepEqual(order, ["a", "b", "c"]);
    });

    it("detecta dependencia no satisfecha en stages", async () => {
        const pipeline = new Pipeline("bad-dep", {
            stages: {
                a: { depends: ["nonexistent"] }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "failed");
        assert.match(String(result.error), /dependency "nonexistent" not found/);
    });

    it("dependencias entre stages dentro de un job", async () => {
        const order = [];
        const pipeline = new Pipeline("stage-deps", {
            stages: {
                build: {
                    jobs: {
                        compile: { tasks: { c1: { exec: async () => { await new Promise(r => setTimeout(r, 10)); order.push("compile"); return "ok"; } } } }
                    }
                },
                test: {
                    depends: ["build"],
                    jobs: {
                        unit: { tasks: { t1: { exec: async () => { await new Promise(r => setTimeout(r, 10)); order.push("test"); return "pass"; } } } }
                    }
                },
                deploy: {
                    depends: ["test"],
                    jobs: {
                        push: { tasks: { d1: { exec: async () => { await new Promise(r => setTimeout(r, 10)); order.push("deploy"); return "done"; } } } }
                    }
                }
            }
        });

        await pipeline.run(createCtx());
        assert.deepEqual(order, ["compile", "test", "deploy"]);
    });

    it("un wave de stages corre en secuencial por defecto", async () => {
        const order = [];
        const pipeline = new Pipeline("seq-stages", {
            stages: {
                a: { jobs: { j1: { tasks: { t1: { exec: async () => { await new Promise(r => setTimeout(r, 10)); order.push("a"); } } } } } },
                b: { jobs: { j2: { tasks: { t2: { exec: async () => { await new Promise(r => setTimeout(r, 10)); order.push("b"); } } } } } }
            }
        });

        await pipeline.run(createCtx());

        // Stages always run sequentially
        assert.deepEqual(order, ["a", "b"]);
    });

});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {

    it("pipeline reutilizable: reset + run de nuevo", async () => {
        let count = 0;
        const pipeline = new Pipeline("reusable", {
            tasks: { inc: { exec: () => ++count } }
        });

        await pipeline.run(createCtx());
        assert.equal(count, 1);

        pipeline.reset();
        await pipeline.run(createCtx());
        assert.equal(count, 2);
    });

    it("results incluyen inputResults previos", async () => {
        const pipeline = new Pipeline("with-input", {
            tasks: {
                use: { exec: (_, r) => `prev=${r.existing}` }
            }
        });

        const result = await pipeline.run({ existing: "hello" });
        assert.equal(result.results.default.default.use, "prev=hello");
    });

    it("stage vacía resolve.success", async () => {
        const pipeline = new Pipeline("empty-stage", {
            stages: { empty: {} }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
    });

    it("duration se calcula correctamente", async () => {
        const pipeline = new Pipeline("duration", {
            tasks: { a: { exec: async () => { await new Promise(r => setTimeout(r, 20)); return "ok"; } } }
        });

        const result = await pipeline.run(createCtx());
        assert.ok(result.duration >= 15);
    });

});

// ---------------------------------------------------------------------------
// PipelineResultsAccessor
// ---------------------------------------------------------------------------

describe("PipelineResultsAccessor", () => {

    it("resuelve task dentro del mismo job (flat)", () => {
        const pipelineResults = {};
        const accessor = new PipelineResultsAccessor(pipelineResults, "build", "compile");
        const proxy = accessor.toProxy();

        pipelineResults["compile"] = { step1: "result1" };

        assert.equal(proxy.step1, "result1");
    });

    it("resuelve task de otro job en el mismo stage", () => {
        const pipelineResults = {};
        const accessor = new PipelineResultsAccessor(pipelineResults, "build", "test");
        const proxy = accessor.toProxy();

        pipelineResults["compile"] = { step1: "result1" };

        assert.equal(proxy.compile.step1, "result1");
    });

    it("resuelve task de otro stage", () => {
        const pipelineResults = {};
        const accessor = new PipelineResultsAccessor(pipelineResults, "deploy", "push");
        const proxy = accessor.toProxy();

        pipelineResults["build"] = { compile: { artifact: "v1" } };

        assert.equal(proxy.build.compile.artifact, "v1");
    });

    it("devuelve undefined si no existe", () => {
        const pipelineResults = {};
        const accessor = new PipelineResultsAccessor(pipelineResults, "s1", "j1");
        const proxy = accessor.toProxy();

        assert.equal(proxy.nonexistent, undefined);
    });

    it("has() funciona correctamente", () => {
        const pipelineResults = {};
        const accessor = new PipelineResultsAccessor(pipelineResults, "s1", "j1");
        const proxy = accessor.toProxy();

        pipelineResults["j1"] = { t1: "a" };
        pipelineResults["s1"] = { j1: { t2: "b" } };

        assert.equal("t1" in proxy, true);
        assert.equal("t2" in proxy, true);
        assert.equal("missing" in proxy, false);
    });

});

// ---------------------------------------------------------------------------
// Task type system
// ---------------------------------------------------------------------------

describe("task type system", () => {

    it("exec se ejecuta correctamente", async () => {
        const pipeline = new Pipeline("type-test", {
            tasks: {
                a: { exec: () => "result" }
            }
        });

        const result = await pipeline.run(createCtx());
        assert.equal(result.status, "success");
        assert.equal(result.results.default.default.a, "result");
    });

    it("sin exec lanza error", async () => {
        const task = new PipelineTask("no-exec", { depends: [] });
        const ctx = createCtx();
        await assert.rejects(
            () => task.run(ctx, {}, "s1", "j1"),
            /no ejecutable/
        );
    });

});
