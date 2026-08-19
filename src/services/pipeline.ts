import { logger } from "../core/logger";
import type { Context } from "../core/Context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineEntityStatus = "pending" | "running" | "success" | "failed" | "skipped";

// ---------------------------------------------------------------------------
// Task config — cada propiedad define el tipo de ejecución
// ---------------------------------------------------------------------------

export interface PipelineTaskBase {
    depends?: string[];
    metadata?: Record<string, unknown>;
}

export interface CallbackTaskConfig extends PipelineTaskBase {
    exec: (ctx: Context, results: Record<string, unknown>) => unknown | Promise<unknown>;
}

export type PipelineTaskConfig = CallbackTaskConfig;

export interface PipelineJobConfig {
    tasks?: Record<string, PipelineTaskConfig>;
    depends?: string[];
    metadata?: Record<string, unknown>;
}

export interface PipelineStageConfig {
    jobs?: Record<string, PipelineJobConfig>;
    depends?: string[];
    metadata?: Record<string, unknown>;
}

export interface PipelineConfig {
    stages?: Record<string, PipelineStageConfig>;
    jobs?: Record<string, PipelineJobConfig>;
    tasks?: Record<string, PipelineTaskConfig>;
    metadata?: Record<string, unknown>;
    ctx?: Context;
}

export interface PipelineRunResult {
    status: "success" | "failed";
    results: Record<string, unknown>;
    error?: unknown;
    duration: number;
}

// ---------------------------------------------------------------------------
// PipelineResultsAccessor
// ---------------------------------------------------------------------------

export class PipelineResultsAccessor {

    private readonly _pipelineResults: Record<string, unknown>;
    private readonly _stageName: string;
    private readonly _jobName: string;

    constructor(
        pipelineResults: Record<string, unknown>,
        stageName: string,
        jobName: string
    ) {
        this._pipelineResults = pipelineResults;
        this._stageName = stageName;
        this._jobName = jobName;
    }

    resolve(name: string): unknown {
        if (name in this._pipelineResults) {
            return this._pipelineResults[name];
        }

        const jobPath = this._pipelineResults[this._jobName];
        if (jobPath && typeof jobPath === "object" && name in (jobPath as Record<string, unknown>)) {
            return (jobPath as Record<string, unknown>)[name];
        }

        const stagePath = this._pipelineResults[this._stageName];
        if (stagePath && typeof stagePath === "object") {
            const stageJobs = stagePath as Record<string, unknown>;
            const jobResults = stageJobs[this._jobName];
            if (jobResults && typeof jobResults === "object" && name in (jobResults as Record<string, unknown>)) {
                return (jobResults as Record<string, unknown>)[name];
            }
        }

        return undefined;
    }

    toProxy(): Record<string, unknown> {
        const self = this;
        return new Proxy({} as Record<string, unknown>, {
            get(_target, prop: string) {
                return self.resolve(prop);
            },
            has(_target, prop: string) {
                return self.resolve(prop) !== undefined;
            }
        });
    }
}

// ---------------------------------------------------------------------------
// PipelineTask
// ---------------------------------------------------------------------------

export class PipelineTask {

    readonly name: string;
    readonly config: PipelineTaskConfig;
    readonly depends: string[];
    readonly metadata: Record<string, unknown>;

    status: PipelineEntityStatus = "pending";
    result: unknown = undefined;
    error: unknown = undefined;
    duration = 0;

    constructor(name: string, config: PipelineTaskConfig) {
        this.name = name;
        this.config = config;
        this.depends = config.depends ?? [];
        this.metadata = config.metadata ?? {};
    }

    async run(
        ctx: Context,
        resultsAccessor: Record<string, unknown>,
        stageName: string,
        jobName: string
    ): Promise<void> {
        if (this.status === "success" || this.status === "running") return;

        for (const dep of this.depends) {
            const segments = dep.split(".");
            let current: unknown = resultsAccessor;
            let found = true;
            for (const segment of segments) {
                if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
                    current = (current as Record<string, unknown>)[segment];
                } else {
                    found = false;
                    break;
                }
            }
            if (!found || current === undefined) {
                throw new Error(`Pipeline task "${this.name}": dependency "${dep}" not found or not completed`);
            }
        }

        this.status = "running";
        const start = Date.now();

        try {
            this.result = await this._execute(ctx, resultsAccessor);
            this.status = "success";
        } catch (err) {
            this.error = err;
            this.status = "failed";
            throw err;
        } finally {
            this.duration = Date.now() - start;
        }
    }

    private async _execute(ctx: Context, results: Record<string, unknown>): Promise<unknown> {
        if ("exec" in this.config) {
            return this.config.exec(ctx, results);
        }
        throw new Error(`Pipeline task "${this.name}": no ejecutable (no se encontró una propiedad de ejecución válida)`);
    }

    reset(): void {
        this.status = "pending";
        this.result = undefined;
        this.error = undefined;
        this.duration = 0;
    }
}

// ---------------------------------------------------------------------------
// PipelineJob
// ---------------------------------------------------------------------------

export class PipelineJob {

    readonly name: string;
    readonly tasks: Map<string, PipelineTask> = new Map();
    readonly depends: string[];
    readonly metadata: Record<string, unknown>;

    status: PipelineEntityStatus = "pending";
    results: Record<string, unknown> = {};
    error: unknown = undefined;
    duration = 0;

    constructor(name: string, config?: PipelineJobConfig) {
        this.name = name;
        this.depends = config?.depends ?? [];
        this.metadata = config?.metadata ?? {};

        if (config?.tasks) {
            for (const [taskName, taskConfig] of Object.entries(config.tasks)) {
                this.tasks.set(taskName, new PipelineTask(taskName, taskConfig));
            }
        }
    }

    task(nameOrConfig: string | PipelineTaskConfig, config?: PipelineTaskConfig): this {
        if (typeof nameOrConfig === "string") {
            this.tasks.set(nameOrConfig, new PipelineTask(nameOrConfig, config!));
        } else {
            const name = `task${this.tasks.size + 1}`;
            this.tasks.set(name, new PipelineTask(name, nameOrConfig));
        }
        return this;
    }

    getTask(name: string): PipelineTask | undefined {
        return this.tasks.get(name);
    }

    getResults(): Record<string, unknown> {
        const results: Record<string, unknown> = {};
        for (const [name, task] of this.tasks) {
            results[name] = task.result;
        }
        return results;
    }

    async run(ctx: Context, pipelineResults: Record<string, unknown>, stageName: string): Promise<void> {
        if (this.status === "success" || this.status === "running") return;

        for (const dep of this.depends) {
            if (!(dep in pipelineResults)) {
                throw new Error(`Pipeline job "${this.name}": dependency "${dep}" not found or not completed`);
            }
        }

        this.status = "running";
        const start = Date.now();

        try {
            const taskEntries = Array.from(this.tasks.entries());
            if (taskEntries.length === 0) {
                this.status = "success";
                return;
            }

            const accessor = new PipelineResultsAccessor(pipelineResults, stageName, this.name);
            const proxy = accessor.toProxy();

            pipelineResults[this.name] = this.results;

            for (const [taskName, task] of taskEntries) {
                logger.info(`  [${this.name}] task: ${taskName}`);
                await task.run(ctx, proxy, stageName, this.name);
                this.results[taskName] = task.result;
            }

            pipelineResults[this.name] = this.getResults();
            this.status = "success";
        } catch (err) {
            this.error = err;
            this.status = "failed";
            throw err;
        } finally {
            this.duration = Date.now() - start;
        }
    }

    reset(): void {
        this.status = "pending";
        this.results = {};
        this.error = undefined;
        this.duration = 0;
        for (const task of this.tasks.values()) {
            task.reset();
        }
    }
}

// ---------------------------------------------------------------------------
// PipelineStage
// ---------------------------------------------------------------------------

export class PipelineStage {

    readonly name: string;
    readonly jobs: Map<string, PipelineJob> = new Map();
    readonly depends: string[];
    readonly metadata: Record<string, unknown>;

    status: PipelineEntityStatus = "pending";
    results: Record<string, unknown> = {};
    error: unknown = undefined;
    duration = 0;

    constructor(name: string, config?: PipelineStageConfig) {
        this.name = name;
        this.depends = config?.depends ?? [];
        this.metadata = config?.metadata ?? {};

        if (config?.jobs) {
            for (const [jobName, jobConfig] of Object.entries(config.jobs)) {
                this.jobs.set(jobName, new PipelineJob(jobName, jobConfig));
            }
        }
    }

    job(nameOrConfig: string | PipelineJobConfig, config?: PipelineJobConfig): PipelineJob {
        if (typeof nameOrConfig === "string") {
            const job = new PipelineJob(nameOrConfig, config);
            this.jobs.set(nameOrConfig, job);
            return job;
        } else {
            const name = `job${this.jobs.size + 1}`;
            const job = new PipelineJob(name, nameOrConfig);
            this.jobs.set(name, job);
            return job;
        }
    }

    getJob(name: string): PipelineJob | undefined {
        return this.jobs.get(name);
    }

    getResults(): Record<string, unknown> {
        const results: Record<string, unknown> = {};
        for (const [name, job] of this.jobs) {
            results[name] = job.getResults();
        }
        return results;
    }

    async run(ctx: Context, pipelineResults: Record<string, unknown>): Promise<void> {
        if (this.status === "success" || this.status === "running") return;

        for (const dep of this.depends) {
            if (!(dep in pipelineResults)) {
                throw new Error(`Pipeline stage "${this.name}": dependency "${dep}" not found or not completed`);
            }
        }

        this.status = "running";
        const start = Date.now();

        try {
            const jobEntries = Array.from(this.jobs.entries());
            if (jobEntries.length === 0) {
                this.status = "success";
                return;
            }

            for (const [jobName, job] of jobEntries) {
                logger.info(`[${this.name}] job: ${jobName}`);
                await job.run(ctx, pipelineResults, this.name);
            }

            this.results = this.getResults();
            this.status = "success";
        } catch (err) {
            this.error = err;
            this.status = "failed";
            throw err;
        } finally {
            this.duration = Date.now() - start;
        }
    }

    reset(): void {
        this.status = "pending";
        this.results = {};
        this.error = undefined;
        this.duration = 0;
        for (const job of this.jobs.values()) {
            job.reset();
        }
    }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {

    readonly name: string;
    readonly stages: Map<string, PipelineStage> = new Map();
    readonly metadata: Record<string, unknown>;

    private ctx?: Context;
    private _results: Record<string, unknown> = {};
    private _status: PipelineEntityStatus = "pending";
    private _error: unknown = undefined;
    private _duration = 0;

    constructor(name: string, config?: PipelineConfig) {
        this.name = name;
        this.metadata = config?.metadata ?? {};
        this.ctx = config?.ctx;

        if (config?.stages) {
            for (const [stageName, stageConfig] of Object.entries(config.stages)) {
                this.stages.set(stageName, new PipelineStage(stageName, stageConfig));
            }
        }
        if (config?.jobs) {
            const stage = new PipelineStage("default");
            for (const [jobName, jobConfig] of Object.entries(config.jobs)) {
                stage.jobs.set(jobName, new PipelineJob(jobName, jobConfig));
            }
            this.stages.set("default", stage);
        }
        if (config?.tasks) {
            const stage = new PipelineStage("default");
            const job = new PipelineJob("default");
            for (const [taskName, taskConfig] of Object.entries(config.tasks)) {
                job.tasks.set(taskName, new PipelineTask(taskName, taskConfig));
            }
            stage.jobs.set("default", job);
            this.stages.set("default", stage);
        }
    }

    get status(): PipelineEntityStatus { return this._status; }
    get results(): Record<string, unknown> { return this._results; }
    get error(): unknown { return this._error; }
    get duration(): number { return this._duration; }

    setContext(ctx: Context): this {
        this.ctx = ctx;
        return this;
    }

    stage(nameOrConfig: string | PipelineStageConfig, config?: PipelineStageConfig): PipelineStage {
        if (typeof nameOrConfig === "string") {
            const stage = new PipelineStage(nameOrConfig, config);
            this.stages.set(nameOrConfig, stage);
            return stage;
        } else {
            const name = `stage${this.stages.size + 1}`;
            const stage = new PipelineStage(name, nameOrConfig);
            this.stages.set(name, stage);
            return stage;
        }
    }

    getStage(name: string): PipelineStage | undefined {
        return this.stages.get(name);
    }

    getResults(): Record<string, unknown> {
        const results: Record<string, unknown> = {};
        for (const [name, stage] of this.stages) {
            results[name] = stage.getResults();
        }
        return results;
    }

    async run(ctxOrResults?: Context | Record<string, unknown>): Promise<PipelineRunResult> {

        let ctx: Context;
        let inputResults: Record<string, unknown> = {};

        if (ctxOrResults && "services" in ctxOrResults) {
            ctx = ctxOrResults as Context;
        } else if (ctxOrResults) {
            inputResults = ctxOrResults as Record<string, unknown>;
            ctx = this.ctx ?? (await import("../core/Context")).Context.current();
        } else {
            ctx = this.ctx ?? (await import("../core/Context")).Context.current();
        }

        this._results = { ...inputResults };
        this._status = "running";
        const start = Date.now();

        logger.info(`Pipeline "${this.name}" starting`);

        try {
            const stageEntries = Array.from(this.stages.entries());

            if (stageEntries.length === 0) {
                this._status = "success";
                this._duration = Date.now() - start;
                return { status: "success", results: this._results, duration: this._duration };
            }

            for (const [stageName, stage] of stageEntries) {
                logger.info(`stage: ${stageName}`);
                await stage.run(ctx, this._results);
                this._results[stageName] = stage.getResults();
            }

            this._status = "success";
            logger.success(`Pipeline "${this.name}" completed successfully`);

        } catch (err) {
            this._error = err;
            this._status = "failed";
            logger.error(`Pipeline "${this.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            this._duration = Date.now() - start;
        }

        return {
            status: this._status as "success" | "failed",
            results: this._results,
            error: this._error,
            duration: this._duration
        };
    }

    reset(): void {
        this._status = "pending";
        this._results = {};
        this._error = undefined;
        this._duration = 0;
        for (const stage of this.stages.values()) {
            stage.reset();
        }
    }
}

// ---------------------------------------------------------------------------
// PipelineRegistry
// ---------------------------------------------------------------------------

export class PipelineRegistry {

    private pipelines: Map<string, Pipeline> = new Map();

    define(nameOrConfig: string | PipelineConfig, config?: PipelineConfig): this {
        if (typeof nameOrConfig === "string") {
            this.pipelines.set(nameOrConfig, new Pipeline(nameOrConfig, config));
        } else {
            const name = `pipeline${this.pipelines.size + 1}`;
            this.pipelines.set(name, new Pipeline(name, nameOrConfig));
        }
        return this;
    }

    get(name: string): Pipeline {
        const p = this.pipelines.get(name);
        if (!p) {
            throw new Error(
                `Pipeline "${name}" not found. Available: ${this.list().join(", ") || "(none)"}`
            );
        }
        return p;
    }

    remove(name: string): boolean {
        return this.pipelines.delete(name);
    }

    list(): string[] {
        return Array.from(this.pipelines.keys());
    }

    async run(name: string, ctx?: Context): Promise<PipelineRunResult> {
        const pipeline = this.get(name);
        if (ctx) pipeline.setContext(ctx);
        return pipeline.run(ctx);
    }
}
