import * as yamlLib from "yaml";
import { omit, get, set, has } from "lodash";

export interface YamlPrepareActions {
    $set?: Array<{ path: string | string[]; value: any }>;
    $push?: Array<{ path: string | string[]; value: any }>;
    $spread?: Array<{ path: string | string[]; value: Record<string, any> }>;
    $superSet?: Array<{ value: any; $set?: Array<string | string[]>; $init?: Array<string | string[]> }>;
    $merge?: Record<string, any>;
    $delete?: string[];
}

export class YamlService {
    metadata: yamlLib.Document = new yamlLib.Document();
    documents: Record<string, yamlLib.Document> = {};
    using = "default";

    fromYaml(yaml?: string): yamlLib.Document {
        this.metadata = yamlLib.parseDocument(yaml || "");
        return this.metadata;
    }

    fromJson(json?: Record<string, any>): yamlLib.Document {
        return this.fromYaml(this.yamlify(json));
    }

    yamlify(json?: Record<string, any>): string {
        return json ? yamlLib.stringify(json) : this.metadata.toString();
    }

    jsonify(): any {
        return this.metadata.toJSON();
    }

    stringify(): string {
        return JSON.stringify(this.jsonify(), null, 2);
    }

    yamlGet(propPath: string, defaultValue?: any): any {
        return get(this.jsonify(), propPath) || defaultValue;
    }

    yamlSet(path: string[], value: any): void {
        this.metadata.setIn(path, value);
    }

    yamlPush(path: string[], value: any): void {
        const original = this.yamlGet(path.join("."), []);
        original.push(...(Array.isArray(value) ? value : [value]));
        this.yamlSet(path, original);
    }

    yamlConcatInitAndSet(path: string[], value: any): void {
        const original = this.yamlGet(path.join("."));
        this.yamlSet(path, `${value}${original}`);
    }

    yamlOmit(paths?: string[]): void {
        const data = this.jsonify();
        this.fromJson(omit(data, paths || []));
    }

    comment(text: string, afterPath?: string[]): void {
        let actualProp: any = this.metadata;
        for (const prop of afterPath || []) {
            actualProp = actualProp.get(prop, true);
        }
        actualProp.commentBefore = `##!!COMMENT!!## ${text}`;
    }

    prepare(actions: YamlPrepareActions): void {
        for (const sa of actions.$set || []) {
            const key = typeof sa.path === "string" ? sa.path.split(".") : sa.path;
            this.yamlSet(key, sa.value);
        }

        for (const pa of actions.$push || []) {
            const key = typeof pa.path === "string" ? pa.path.split(".") : pa.path;
            this.yamlPush(key, pa.value);
        }

        for (const spa of actions.$spread || []) {
            const key = typeof spa.path === "string" ? spa.path.split(".") : spa.path;
            this.yamlSet(key, { ...this.yamlGet(key.join(".")), ...spa.value });
        }

        for (const ssa of actions.$superSet || []) {
            for (const ssaKey of ssa.$set || []) {
                const key = typeof ssaKey === "string" ? ssaKey.split(".") : ssaKey;
                this.yamlSet(key, ssa.value);
            }
            for (const ssaKey of ssa.$init || []) {
                const key = typeof ssaKey === "string" ? ssaKey.split(".") : ssaKey;
                this.yamlConcatInitAndSet(key, ssa.value);
            }
        }

        for (const [key, value] of Object.entries(actions.$merge || {})) {
            this.yamlSet(key.split("."), value);
        }

        this.yamlOmit(actions.$delete);
    }

    multidocument(
        params: { yaml?: string; json?: Record<string, any>; name: string },
        extra?: Record<string, any>
    ): void {
        set(this.documents, this.using, this.metadata);
        this.using = params.name;

        if (params.yaml) this.fromYaml(params.yaml);
        else if (params.json) this.fromJson(params.json);

        if (extra) this.prepare({ $merge: { ...extra } });

        set(this.documents, params.name, this.metadata);
    }

    use(name: string): yamlLib.Document {
        set(this.documents, this.using, this.metadata);
        this.metadata = get(this.documents, name);
        this.using = name;
        return this.metadata;
    }

    existDocument(name: string): boolean {
        return has(this.documents, name);
    }

    clone(): YamlService {
        const clone = new YamlService();
        clone.metadata = yamlLib.parseDocument(this.metadata.toString());
        clone.using = this.using;

        for (const [key, doc] of Object.entries(this.documents)) {
            clone.documents[key] = yamlLib.parseDocument(doc.toString());
        }

        return clone;
    }
}
