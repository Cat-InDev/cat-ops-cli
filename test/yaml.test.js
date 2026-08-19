const { test } = require("node:test");
const assert = require("node:assert/strict");

const { YamlService } = require("../dist");

// ---------------------------------------------------------------------------
// fromYaml / fromJson / yamlify / jsonify / stringify
// ---------------------------------------------------------------------------

test("fromYaml() parsea un string YAML", () => {
    const yaml = new YamlService();
    yaml.fromYaml("name: test\nversion: 1");
    assert.deepEqual(yaml.jsonify(), { name: "test", version: 1 });
});

test("fromYaml() con string vacío crea documento vacío", () => {
    const yaml = new YamlService();
    yaml.fromYaml("");
    assert.deepEqual(yaml.jsonify(), null);
});

test("fromJson() convierte JSON a YAML interno", () => {
    const yaml = new YamlService();
    yaml.fromJson({ a: 1, b: "two" });
    assert.deepEqual(yaml.jsonify(), { a: 1, b: "two" });
});

test("yamlify() serializa JSON a string YAML", () => {
    const yaml = new YamlService();
    const result = yaml.yamlify({ hello: "world" });
    assert.match(result, /hello: world/);
});

test("yamlify() sin argumentos devuelve el YAML actual", () => {
    const yaml = new YamlService();
    yaml.fromYaml("x: 1");
    assert.match(yaml.yamlify(), /x: 1/);
});

test("jsonify() devuelve el objeto JSON del documento", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: [1, 2, 3]");
    assert.deepEqual(yaml.jsonify(), { a: [1, 2, 3] });
});

test("stringify() devuelve JSON pretty-printed", () => {
    const yaml = new YamlService();
    yaml.fromYaml("key: value");
    const result = yaml.stringify();
    assert.equal(typeof result, "string");
    assert.ok(result.includes('"key"'));
    assert.ok(result.includes('"value"'));
});

// ---------------------------------------------------------------------------
// yamlGet / yamlSet / yamlPush
// ---------------------------------------------------------------------------

test("yamlGet() obtiene un valor por path", () => {
    const yaml = new YamlService();
    yaml.fromYaml("server:\n  port: 8080\n  host: localhost");
    assert.equal(yaml.yamlGet("server.port"), 8080);
    assert.equal(yaml.yamlGet("server.host"), "localhost");
});

test("yamlGet() devuelve defaultValue si el path no existe", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1");
    assert.equal(yaml.yamlGet("missing", "fallback"), "fallback");
});

test("yamlSet() asigna un valor en un path anidado", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a:\n  b: 1");
    yaml.yamlSet(["a", "b"], 99);
    assert.equal(yaml.yamlGet("a.b"), 99);
});

test("yamlSet() crea paths nuevos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("root: true");
    yaml.yamlSet(["new", "nested", "key"], "hello");
    assert.equal(yaml.yamlGet("new.nested.key"), "hello");
});

test("yamlPush() agrega un elemento a un array", () => {
    const yaml = new YamlService();
    yaml.fromYaml("items:\n  - one\n  - two");
    yaml.yamlPush(["items"], "three");
    const items = yaml.yamlGet("items");
    assert.deepEqual(items, ["one", "two", "three"]);
});

test("yamlPush() agrega múltiples elementos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("list:\n  - a");
    yaml.yamlPush(["list"], ["b", "c"]);
    assert.deepEqual(yaml.yamlGet("list"), ["a", "b", "c"]);
});

test("yamlPush() crea el array si no existe", () => {
    const yaml = new YamlService();
    yaml.fromYaml("root: true");
    yaml.yamlPush(["newArray"], "first");
    assert.deepEqual(yaml.yamlGet("newArray"), ["first"]);
});

// ---------------------------------------------------------------------------
// yamlConcatInitAndSet
// ---------------------------------------------------------------------------

test("yamlConcatInitAndSet() concatena valor al inicio", () => {
    const yaml = new YamlService();
    yaml.fromYaml("greeting: world");
    yaml.yamlConcatInitAndSet(["greeting"], "hello ");
    assert.equal(yaml.yamlGet("greeting"), "hello world");
});

// ---------------------------------------------------------------------------
// yamlOmit
// ---------------------------------------------------------------------------

test("yamlOmit() elimina paths del documento", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2\nc: 3");
    yaml.yamlOmit(["a", "c"]);
    assert.deepEqual(yaml.jsonify(), { b: 2 });
});

test("yamlOmit() sin argumentos no elimina nada", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2");
    yaml.yamlOmit();
    assert.deepEqual(yaml.jsonify(), { a: 1, b: 2 });
});

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------

test("comment() agrega commentBefore a un nodo", () => {
    const yaml = new YamlService();
    yaml.fromYaml("key: value");
    yaml.comment("this is important", ["key"]);
    const doc = yaml.metadata;
    const node = doc.get("key", true);
    assert.ok(node.commentBefore.includes("this is important"));
});

// ---------------------------------------------------------------------------
// prepare() — $set
// ---------------------------------------------------------------------------

test("prepare() con $set asigna valores", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2");
    yaml.prepare({ $set: [{ path: "a", value: 100 }, { path: "c", value: 3 }] });
    assert.equal(yaml.yamlGet("a"), 100);
    assert.equal(yaml.yamlGet("c"), 3);
});

test("prepare() con $set soporta paths anidados como string", () => {
    const yaml = new YamlService();
    yaml.fromYaml("server:\n  port: 80");
    yaml.prepare({ $set: [{ path: "server.port", value: 443 }] });
    assert.equal(yaml.yamlGet("server.port"), 443);
});

// ---------------------------------------------------------------------------
// prepare() — $push
// ---------------------------------------------------------------------------

test("prepare() con $push agrega elementos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("tags:\n  - dev");
    yaml.prepare({ $push: [{ path: "tags", value: "prod" }] });
    assert.deepEqual(yaml.yamlGet("tags"), ["dev", "prod"]);
});

// ---------------------------------------------------------------------------
// prepare() — $spread
// ---------------------------------------------------------------------------

test("prepare() con $spread fusiona objetos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("meta:\n  a: 1\n  b: 2");
    yaml.prepare({ $spread: [{ path: "meta", value: { b: 99, c: 3 } }] });
    assert.deepEqual(yaml.yamlGet("meta"), { a: 1, b: 99, c: 3 });
});

// ---------------------------------------------------------------------------
// prepare() — $superSet ($set)
// ---------------------------------------------------------------------------

test("prepare() con $superSet.$set asigna el mismo valor a múltiples paths", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2\nc: 3");
    yaml.prepare({
        $superSet: [{ value: "shared", $set: ["a", "b", "c"] }]
    });
    assert.equal(yaml.yamlGet("a"), "shared");
    assert.equal(yaml.yamlGet("b"), "shared");
    assert.equal(yaml.yamlGet("c"), "shared");
});

// ---------------------------------------------------------------------------
// prepare() — $superSet ($init)
// ---------------------------------------------------------------------------

test("prepare() con $superSet.$init concatena al inicio en múltiples paths", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: world\nb: earth");
    yaml.prepare({
        $superSet: [{ value: "hello ", $init: ["a", "b"] }]
    });
    assert.equal(yaml.yamlGet("a"), "hello world");
    assert.equal(yaml.yamlGet("b"), "hello earth");
});

// ---------------------------------------------------------------------------
// prepare() — $merge
// ---------------------------------------------------------------------------

test("prepare() con $merge asigna valores por path", () => {
    const yaml = new YamlService();
    yaml.fromYaml("x: 1");
    yaml.prepare({ $merge: { x: 10, "new.deep.path": "value" } });
    assert.equal(yaml.yamlGet("x"), 10);
    assert.equal(yaml.yamlGet("new.deep.path"), "value");
});

// ---------------------------------------------------------------------------
// prepare() — $delete
// ---------------------------------------------------------------------------

test("prepare() con $delete elimina keys", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2\nc: 3");
    yaml.prepare({ $delete: ["a", "c"] });
    assert.deepEqual(yaml.jsonify(), { b: 2 });
});

// ---------------------------------------------------------------------------
// prepare() — combinación completa
// ---------------------------------------------------------------------------

test("prepare() maneja todas las acciones combinadas", () => {
    const yaml = new YamlService();
    yaml.fromYaml("name: app\nversion: 1\ntags:\n  - dev\nmeta:\n  env: dev");

    yaml.prepare({
        $set: [{ path: "version", value: 2 }],
        $push: [{ path: "tags", value: "prod" }],
        $spread: [{ path: "meta", value: { region: "us-east" } }],
        $delete: ["name"]
    });

    const data = yaml.jsonify();
    assert.equal(data.version, 2);
    assert.deepEqual(data.tags, ["dev", "prod"]);
    assert.deepEqual(data.meta, { env: "dev", region: "us-east" });
    assert.equal(data.name, undefined);
});

// ---------------------------------------------------------------------------
// multidocument / use / existDocument
// ---------------------------------------------------------------------------

test("multidocument() guarda y cambia entre documentos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("first: true");

    yaml.multidocument({ name: "doc1" });
    yaml.fromYaml("second: true");

    yaml.multidocument({ name: "doc2", json: { third: true } });

    assert.ok(yaml.existDocument("doc1"));
    assert.ok(yaml.existDocument("doc2"));
});

test("use() guarda y restaura documentos", () => {
    const yaml = new YamlService();
    yaml.fromYaml("original: data");

    yaml.multidocument({ name: "saved" });
    yaml.fromYaml("changed: data");

    yaml.use("default");
    assert.equal(yaml.yamlGet("original"), "data");

    yaml.use("saved");
    assert.equal(yaml.yamlGet("changed"), "data");
});

test("existDocument() devuelve false si el documento no existe", () => {
    const yaml = new YamlService();
    assert.equal(yaml.existDocument("nonexistent"), false);
});

test("multidocument() con extra aplica prepare sobre el nuevo doc", () => {
    const yaml = new YamlService();
    yaml.fromYaml("base: true");

    yaml.multidocument({ name: "extended", yaml: "extra: 1" }, { added: true });

    yaml.use("extended");
    assert.equal(yaml.yamlGet("extra"), 1);
    assert.equal(yaml.yamlGet("added"), true);
});

// ---------------------------------------------------------------------------
// clone()
// ---------------------------------------------------------------------------

test("clone() crea una copia independiente", () => {
    const yaml = new YamlService();
    yaml.fromYaml("a: 1\nb: 2");

    const cloned = yaml.clone();
    cloned.yamlSet(["a"], 999);

    assert.equal(yaml.yamlGet("a"), 1);
    assert.equal(cloned.yamlGet("a"), 999);
});

test("clone() preserva documentos multidoc", () => {
    const yaml = new YamlService();
    yaml.fromYaml("first: true");
    yaml.multidocument({ name: "doc1", json: { second: true } });

    const cloned = yaml.clone();
    assert.ok(cloned.existDocument("doc1"));

    cloned.use("doc1");
    assert.equal(cloned.yamlGet("second"), true);
});

// ---------------------------------------------------------------------------
// Context integration
// ---------------------------------------------------------------------------

test("ctx.services.yaml es una instancia de YamlService", () => {
    const { Context } = require("../dist");
    const ctx = Context.current();
    assert.ok(ctx.services.yaml);
    assert.equal(typeof ctx.services.yaml.fromYaml, "function");
    assert.equal(typeof ctx.services.yaml.prepare, "function");
});
