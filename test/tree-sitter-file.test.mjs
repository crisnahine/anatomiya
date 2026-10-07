import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ENGINE, ENGINE_VERSION, ensureRuntime, failure, parseTreeFile, probeGrammars } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { createPool } from "../plugins/anatomiya/lib/pool.mjs";
import { ENGINES, LANGUAGES } from "../plugins/anatomiya/lib/langs.mjs";
import { walkTree } from "../plugins/anatomiya/lib/tree-walk.mjs";
import { ANATOMIYA, ROOT } from "../scripts/plugins.mjs";
import * as SAMPLES from "./tree-samples.mjs";
import { BROKEN } from "./tree-broken.mjs";

const HOSTED = LANGUAGES.filter((l) => l.engine === "tree-sitter");
const BODY = join(ANATOMIYA, "lib", "tree-sitter-file.mjs");
const WORKER = join(ANATOMIYA, "lib", "tree-sitter-worker.mjs");
const GRAMMARS = join(ANATOMIYA, "grammars");

function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function file(dir, name, body, lang) {
  const abs = join(dir, name);
  writeFileSync(abs, body);
  return { rel: name, abs, lang };
}

test("the body names the engine the registry declares, at the version its package states", () => {
  assert.equal(ENGINE, "tree-sitter");
  assert.equal(ENGINE, ENGINES["tree-sitter"].id);
  const manifest = JSON.parse(readFileSync(join(ROOT, "node_modules", ENGINES["tree-sitter"].module, "package.json"), "utf8"));
  assert.equal(ENGINE_VERSION, manifest.version);
});

for (const decl of HOSTED) {
  const lang = decl.id;
  const rel = `src/a.${decl.exts[0]}`;

  test(`${lang}: an ordinary file is an ok record carrying counts and no tree`, async () => {
    const source = SAMPLES[lang];
    // No row asked: what a row finds in the sample is its own test's to say.
    const r = await parseTreeFile(source, rel, lang, { rows: [] });

    assert.deepEqual(r, {
      rel,
      ok: true,
      hits: {},
      facets: { testRunner: null, testCalls: false },
      errors: 0,
      length: source.length,
    });
  });

  for (const [kind, source] of Object.entries(BROKEN[lang])) {
    test(`${lang}: a file the grammar answers with ${kind === "error" ? "an ERROR node" : "a MISSING token"} is rejected, with a count and nothing read`, async () => {
      const r = await parseTreeFile(source, rel, lang);

      assert.equal(r.ok, false);
      assert.ok(r.errors >= 1, `errors: ${r.errors}`);
      assert.equal(r.error, `${r.errors} syntax error(s)`);
      assert.deepEqual(Object.keys(r).sort(), ["error", "errors", "ok", "rel"], "no site and no facet crosses");
    });
  }

  test(`${lang}: tree mode returns the plain tree and an empty comment channel`, async () => {
    const source = SAMPLES[lang];
    const r = await parseTreeFile(source, rel, lang, { withProgram: true });

    assert.equal(r.ok, true);
    assert.equal(r.program.lang, lang);
    assert.equal(typeof r.program.children[0].start, "number");
    assert.equal(source.slice(r.program.children[0].start, r.program.children[0].end).length > 0, true);
    assert.deepEqual(r.comments, []);
    assert.deepEqual(r.hits, (await parseTreeFile(source, rel, lang)).hits, "tree mode carries what counts mode carries, and the tree beside it");
    assert.deepEqual(JSON.parse(JSON.stringify(r.program)), r.program, "nothing in it is lost over IPC");
  });
}

test("a broken file counts every ERROR and MISSING node it holds", async () => {
  const two = await parseTreeFile("class A { int x = 1 }\nclass B { int y = 2 }\n", "src/A.java", "java");
  assert.equal(two.errors, 2);
  assert.equal(two.error, "2 syntax error(s)");
});

test("a file the grammar marks broken without a node to show for it still counts one error", async () => {
  // The grammar, not Kotlin, wants a line break after a member, and says so with a hidden token.
  const r = await parseTreeFile("class A { fun f() {} }\n", "src/A.kt", "kotlin");
  assert.equal(r.ok, false);
  assert.equal(r.errors, 1);
});

test("a PHP file with no open tag is empty, not rejected", async () => {
  const source = "<p>hello</p>\n";
  const r = await parseTreeFile(source, "views/a.php", "php");

  assert.deepEqual(r, {
    rel: "views/a.php",
    ok: true,
    hits: {},
    facets: { testRunner: null, testCalls: false, empty: true },
    errors: 0,
    length: source.length,
  });
});

test("a PHP template with one echo in it is read, and its markup is no code", async () => {
  const r = await parseTreeFile("<table>\n<tr><td><?php echo $x ?></td></tr>\n</table>\n", "views/a.php", "php", { withProgram: true });

  assert.equal(r.ok, true);
  assert.equal("empty" in r.facets, false);
  const types = [];
  walkTree(r.program, (node) => types.push(node.type));
  assert.deepEqual(types.filter((type) => type.endsWith("_statement")), ["echo_statement"]);
});

test("the record's length is the source's, in UTF-16 units, wherever the first node starts", async () => {
  const source = "\n\n# 😀\nx = 1\n";
  const r = await parseTreeFile(source, "a.py", "python", { withProgram: true });

  assert.equal(r.length, source.length);
  assert.notEqual(r.program.start, 0, "the root starts at the first node, so it is not the file's length");
});

test("a Go file tagged for another system, a Rust file of macros and a Kotlin script are read", async () => {
  const go = '//go:build windows\n\npackage a\n\nimport "syscall"\n\nfunc pid() int { return syscall.Getpid() }\n';
  const rust = 'macro_rules! m {\n    ($x:expr) => {\n        $x + 1\n    };\n}\n\nfn f() {\n    let v = vec![1, 2];\n    println!("{:?} {}", v, m!(1));\n}\n';
  const kts = 'plugins {\n    kotlin("jvm") version "1.9.0"\n}\n\ndependencies {\n    implementation("a:b:1")\n}\n';

  assert.equal((await parseTreeFile(go, "a_windows.go", "go")).ok, true);
  assert.equal((await parseTreeFile(rust, "m.rs", "rust")).ok, true);
  assert.equal((await parseTreeFile(kts, "build.gradle.kts", "kotlin")).ok, true);
});

// Correct C# the grammar has no rule for: a directive anywhere but around whole statements or members.
const CONDITIONAL = {
  "a member-access chain": 'class A\n{\n    bool F(string s)\n    {\n        return s\n#if SPAN\n            .Trim()\n#endif\n            .StartsWith("a");\n    }\n}\n',
  "a parameter list": "class A\n{\n    void F(\n#if SPAN\n        System.ReadOnlySpan<char> context,\n#else\n        string context,\n#endif\n        out int level)\n    {\n        level = 0;\n    }\n}\n",
  "a base list": "class A : System.IDisposable\n#if ASYNC\n    , System.IAsyncDisposable\n#endif\n{\n    public void Dispose() { }\n}\n",
  "an enum body": "enum E\n{\n    A,\n#if X\n    B,\n#endif\n    C\n}\n",
  "an array initializer": "class A\n{\n    static readonly System.Type[] T =\n    {\n        typeof(int),\n#if NET6\n        typeof(System.DateOnly),\n#endif\n        typeof(string)\n    };\n}\n",
  "alternative method signatures": "class A\n{\n#if SPAN\n    public void F(System.ReadOnlySpan<char> s)\n#else\n    public void F(string s)\n#endif\n    {\n        G();\n    }\n    void G() { }\n}\n",
};

for (const [where, source] of Object.entries(CONDITIONAL)) {
  test(`csharp: a conditional inside ${where} is read with its first branch, and the record says so where a branch went unread`, async () => {
    const r = await parseTreeFile(source, "src/A.cs", "csharp", { rows: [] });

    assert.deepEqual(r, {
      rel: "src/A.cs",
      ok: true,
      hits: {},
      facets: { testRunner: null, testCalls: false },
      errors: 0,
      length: source.length,
      ...(source.includes("#else") ? { oneBranch: true } : {}),
    });
  });
}

test("csharp: a directive on a last line with no line break after it is read, with nothing unread", async () => {
  const r = await parseTreeFile("class A { }\n#pragma warning restore 618", "src/A.cs", "csharp");

  assert.equal(r.ok, true);
  assert.equal("oneBranch" in r, false);
});

// The grammar rejects a directive on a last line with no line break after it, wherever the file's conditionals sit.
const UNENDED = "\n#pragma warning restore 618";
const WHOLE_MEMBERS = "class A\n{\n#if X\n    void F() { }\n#else\n    void G() { }\n#endif\n}";

test("csharp: a file rejected only for its last line's missing line break is read whole, with no branch dropped", async () => {
  const source = WHOLE_MEMBERS + UNENDED;
  const r = await parseTreeFile(source, "src/A.cs", "csharp", { withProgram: true });

  assert.equal(r.ok, true);
  assert.equal("oneBranch" in r, false);
  assert.equal(r.length, source.length);
  const methods = [];
  walkTree(r.program, (node) => {
    assert.ok(node.end <= source.length, `${node.type} ends at ${node.end} of ${source.length}`);
    if (!node.children.length) assert.equal(node.text, source.slice(node.start, node.end), node.type);
    if (node.type === "method_declaration") methods.push(source.slice(node.start, node.end));
  });
  assert.deepEqual(methods, ["void F() { }", "void G() { }"]);
  // The grammar ends these two on the line break it was given, which the file does not hold.
  assert.equal(r.program.end, source.length);
  assert.equal(source.slice(r.program.children.at(-1).start, r.program.children.at(-1).end), UNENDED.slice(1));
});

test("csharp: a row is handed a file read that way as it was written", async () => {
  const source = WHOLE_MEMBERS + UNENDED;
  let handed;
  const row = { key: "probe", langs: ["csharp"], tier: "syntactic", visitor: (program, add, extra) => ((handed = extra.source), {}) };

  await parseTreeFile(source, "src/A.cs", "csharp", { rows: [row] });

  assert.equal(handed, source);
});

test("csharp: a file with no line break at its end that still needs a branch dropped is marked", async () => {
  const r = await parseTreeFile(CONDITIONAL["alternative method signatures"].trimEnd() + UNENDED, "src/A.cs", "csharp");

  assert.equal(r.ok, true);
  assert.equal(r.oneBranch, true);
});

test("csharp: a file is parsed once where it reads as written, and again only for what the last parse left wrong", async (t) => {
  const { Parser } = await ensureRuntime();
  const parse = Parser.prototype.parse;
  const texts = [];
  Parser.prototype.parse = function (text, ...rest) {
    texts.push(text);
    return parse.call(this, text, ...rest);
  };
  t.after(() => (Parser.prototype.parse = parse));
  const parsesOf = async (source) => {
    texts.length = 0;
    await parseTreeFile(source, "src/A.cs", "csharp");
    return texts.map((text) => (text === source ? "written" : text === `${source}\n` ? "ended" : "blanked"));
  };
  const needsABranchDropped = CONDITIONAL["a parameter list"];

  assert.deepEqual(await parsesOf(WHOLE_MEMBERS), ["written"]);
  assert.deepEqual(await parsesOf(`${WHOLE_MEMBERS}\n`), ["written"]);
  assert.deepEqual(await parsesOf(WHOLE_MEMBERS + UNENDED), ["written", "ended"]);
  assert.deepEqual(await parsesOf(needsABranchDropped), ["written", "blanked"]);
  assert.deepEqual(await parsesOf(needsABranchDropped.replace(/\n/g, "\r")), ["written", "blanked"]);
  assert.deepEqual(await parsesOf(needsABranchDropped.trimEnd() + UNENDED), ["written", "ended", "blanked"]);
});

test("csharp: a byte order mark before a first-line conditional does not switch the retry off", async () => {
  const r = await parseTreeFile("\uFEFF#if X\nclass A : I\n#else\nclass A : J\n#endif\n{ }\n", "src/A.cs", "csharp");

  assert.equal(r.ok, true);
  assert.equal(r.oneBranch, true);
});

test("csharp: a file that parsed as written is not retried, so both branches of its conditional are in the tree", async () => {
  const source = "class A\n{\n#if X\n    void F() { }\n#else\n    void G() { }\n#endif\n}\n";
  const r = await parseTreeFile(source, "src/A.cs", "csharp", { withProgram: true });

  const methods = [];
  walkTree(r.program, (node) => node.type === "method_declaration" && methods.push(source.slice(node.start, node.end)));
  assert.deepEqual(methods, ["void F() { }", "void G() { }"]);
  assert.equal("oneBranch" in r, false);
});

test("csharp: a file still broken with one branch of its conditionals stays rejected, counted as it was written", async () => {
  const broken = CONDITIONAL["a member-access chain"].replace('("a")', '("a"');
  const r = await parseTreeFile(broken, "src/A.cs", "csharp");
  const unbalanced = await parseTreeFile(CONDITIONAL["a member-access chain"].replace("#endif\n", ""), "src/A.cs", "csharp");

  for (const rejected of [r, unbalanced]) {
    assert.equal(rejected.ok, false);
    assert.deepEqual(Object.keys(rejected).sort(), ["error", "errors", "ok", "rel"]);
  }
  // The retried tree holds one error and the file as written holds more: the count is the file's.
  assert.equal(r.errors, (await parseTreeFile(broken, "src/A.java", "csharp")).errors);
  assert.ok(r.errors > 1, `errors: ${r.errors}`);
});

test("csharp: every offset and line in a retried tree is the file's own", async () => {
  const source = `// \u{1F600}\r\n${CONDITIONAL["alternative method signatures"].replace(/\n/g, "\r\n")}`;
  const r = await parseTreeFile(source, "src/A.cs", "csharp", { withProgram: true });

  assert.equal(r.ok, true);
  assert.equal(r.oneBranch, true);
  assert.equal(r.length, source.length);
  const seen = {};
  walkTree(r.program, (node) => {
    if (node.type === "parameter" || node.type === "invocation_expression") seen[node.type] = [source.slice(node.start, node.end), node.line];
    if (node.type === "method_declaration") (seen.methods ??= []).push([source.slice(node.start, node.start + 12), node.line]);
  });
  assert.deepEqual(seen.parameter, ["System.ReadOnlySpan<char> s", 5]);
  assert.deepEqual(seen.invocation_expression, ["G()", 10]);
  assert.deepEqual(seen.methods, [["public void ", 5], ["void G() { }", 12]]);
});

test("csharp: a row counts a retried file over the text that was kept, never the branch that was not read", async () => {
  const source = CONDITIONAL["alternative method signatures"];
  const texts = [];
  const row = {
    key: "probe",
    langs: ["csharp"],
    tier: "syntactic",
    visitor: (program, add, extra) => ({
      node: (node) => {
        if (node.type !== "method_declaration") return;
        texts.push(extra.source.slice(node.start, node.end));
        add({ conforming: true });
      },
    }),
  };

  const r = await parseTreeFile(source, "src/A.cs", "csharp", { rows: [row] });

  assert.equal(r.hits.probe.length, 2);
  assert.equal(texts[0].length, source.indexOf("    void G()") - 1 - source.indexOf("public void F(System"));
  assert.match(texts[0], /^public void F\(System\.ReadOnlySpan<char> s\)\s+\{\s+G\(\);\s+\}$/);
  assert.doesNotMatch(texts[0], /string s|#/);
});

test("csharp: the text a retried tree was read from rides on the record a caller asks the tree of, and on no other", async () => {
  const source = CONDITIONAL["alternative method signatures"];

  const retried = await parseTreeFile(source, "src/A.cs", "csharp", { withProgram: true });

  assert.equal(retried.oneBranch, true);
  assert.equal(retried.text.length, source.length);
  assert.doesNotMatch(retried.text, /string s|#/);
  assert.equal("text" in (await parseTreeFile(source, "src/A.cs", "csharp")), false, "a count crosses without it");
  assert.equal("text" in (await parseTreeFile("class A { }\n", "src/A.cs", "csharp", { withProgram: true })), false, "a file read as written is its own text");
});

test("the conditional retry is C#'s alone: a directive-looking line in another language's rejected file changes nothing", async () => {
  // Blanked, this is a clean Java file: nothing blanks it.
  const r = await parseTreeFile("#if X\nclass B { }\n#else\nclass A { }\n#endif\n", "src/A.java", "java");

  assert.equal(r.ok, false);
  assert.equal("oneBranch" in r, false);
});

test("a row is handed the walk, the source and the path, and its sites cross as counts", async () => {
  const source = "def one():\n    def inner():\n        pass\n\n\ndef two():\n    pass\n";
  const seen = [];
  const row = {
    key: "probe",
    langs: ["python"],
    tier: "syntactic",
    visitor: (program, add, extra) => {
      seen.push(extra);
      return {
        node: (node, ctx) => {
          if (node.type === "function_definition") add({ conforming: ctx.enclosing === null, where: extra.source.slice(node.start, node.start + 3) });
        },
      };
    },
  };

  const r = await parseTreeFile(source, "src/a.py", "python", { rows: [row] });

  // The middle one sits inside a function, which only this engine's own walk knows is one.
  assert.deepEqual(r.hits, { probe: [{ conforming: true, where: "def" }, { conforming: false, where: "def" }, { conforming: true, where: "def" }] });
  // The facets too, read once for the record and handed over, so no row walks the tree again to ask what file this is.
  assert.deepEqual(seen, [{ comments: [], source, rel: "src/a.py", facets: r.facets }]);
  assert.equal(seen[0].facets, r.facets);
});

test("a grammar that is not there reads as a missing parser, and names the file", async (t) => {
  const empty = scratch(t, "anatomiya-no-grammars-");

  await assert.rejects(parseTreeFile(SAMPLES.python, "a.py", "python", { grammars: empty }), (err) => {
    assert.equal(err.missingParser, true);
    assert.equal(err.missingGrammar, "python");
    assert.match(err.message, /^grammars\/python\.wasm did not load: /);
    return true;
  });
});

test("a grammar file cut short reads the same way, and the other languages keep working", async (t) => {
  const dir = scratch(t, "anatomiya-cut-grammar-");
  cpSync(GRAMMARS, dir, { recursive: true });
  writeFileSync(join(dir, "kotlin.wasm"), readFileSync(join(GRAMMARS, "kotlin.wasm")).subarray(0, 4096));

  await assert.rejects(parseTreeFile(SAMPLES.kotlin, "a.kt", "kotlin", { grammars: dir }), (err) => {
    assert.equal(err.missingParser, true);
    assert.equal(err.missingGrammar, "kotlin");
    assert.match(err.message, /^grammars\/kotlin\.wasm did not load: /);
    return true;
  });
  assert.equal((await parseTreeFile(SAMPLES.go, "a.go", "go", { grammars: dir })).ok, true);
  assert.equal((await parseTreeFile(SAMPLES.kotlin, "a.kt", "kotlin")).ok, true, "the plugin's own copy is untouched");
});

test("the grammar probe counts what loads and names what does not", async (t) => {
  assert.deepEqual(await probeGrammars(), { total: 7, missing: [] });

  const dir = scratch(t, "anatomiya-probe-grammars-");
  cpSync(GRAMMARS, dir, { recursive: true });
  rmSync(join(dir, "rust.wasm"));
  writeFileSync(join(dir, "go.wasm"), "not a grammar");
  assert.deepEqual(await probeGrammars({ grammars: dir }), { total: 7, missing: ["go", "rust"] });
});

test("a failure is answered in the worker's reply shape, and only a wasm trap retires the worker", () => {
  assert.deepEqual(failure("a.py", new Error("boom")), { rel: "a.py", ok: false, error: "boom", missingParser: false });

  const trap = new WebAssembly.RuntimeError("Aborted()");
  assert.deepEqual(failure("a.py", trap), { rel: "a.py", ok: false, error: "Aborted()", missingParser: false, retire: true });

  const absent = Object.assign(new Error("grammars/go.wasm did not load: ENOENT"), { missingParser: true, missingGrammar: "go" });
  assert.deepEqual(failure("a.go", absent), {
    rel: "a.go",
    ok: false,
    error: "grammars/go.wasm did not load: ENOENT",
    missingParser: true,
    missingGrammar: "go",
  });
  assert.equal("errors" in failure("a.py", trap), false, "a trap is no syntax error");
});

test("the worker says which engine it is, in the registry's own spelling, with its version", async (t) => {
  const dir = scratch(t, "anatomiya-ts-pool-");
  const pool = createPool({ size: 1, worker: WORKER, engine: "tree-sitter" });
  try {
    const r = await pool.parse(file(dir, "a.py", SAMPLES.python, "python"));
    assert.equal(r.ok, true);
    assert.deepEqual(pool.versions, { "tree-sitter": ENGINE_VERSION });
  } finally {
    await pool.close();
  }
});

test("one worker reads all seven languages, and a broken file between them costs only itself", async (t) => {
  const dir = scratch(t, "anatomiya-ts-pool-");
  const files = HOSTED.flatMap((decl) => [
    file(dir, `ok.${decl.exts[0]}`, SAMPLES[decl.id], decl.id),
    file(dir, `bad.${decl.exts[0]}`, BROKEN[decl.id].error, decl.id),
  ]);

  const pool = createPool({ size: 1, worker: WORKER, engine: "tree-sitter" });
  try {
    const results = await Promise.all(files.map((f) => pool.parse(f)));
    for (const r of results) {
      assert.equal(r.ok, r.rel.startsWith("ok."), `${r.rel}: ${r.error}`);
      assert.notEqual(r.crashed, true, r.rel);
      if (!r.ok) assert.ok(r.errors >= 1, r.rel);
    }
  } finally {
    await pool.close();
  }
});

test("a tree too deep for the channel is answered as unread, and its counts still cross", async (t) => {
  const dir = scratch(t, "anatomiya-ts-deep-");
  const deep = file(dir, "deep.py", `x = ${"(".repeat(6000)}1${")".repeat(6000)}\n`, "python");
  const flat = file(dir, "flat.py", SAMPLES.python, "python");

  const trees = createPool({ size: 1, worker: WORKER, engine: "tree-sitter", withProgram: true });
  try {
    const [r, after] = await Promise.all([trees.parse(deep), trees.parse(flat)]);
    assert.deepEqual(r, { rel: "deep.py", ok: false, error: "the tree is too deep to send", attempts: 1 });
    assert.equal(after.ok, true, "the worker went on to the next file");
    assert.equal(after.program.lang, "python");
  } finally {
    await trees.close();
  }

  const counts = createPool({ size: 1, worker: WORKER, engine: "tree-sitter" });
  try {
    const r = await counts.parse(deep);
    assert.equal(r.ok, true, r.error);
  } finally {
    await counts.close();
  }
});

test("five hundred large parses leave the child's memory where it started", { timeout: 30 * 60_000 }, async (t) => {
  const dir = scratch(t, "anatomiya-ts-memory-");
  const unit = SAMPLES.python.replace("from __future__ import annotations\n", "");
  const big = file(dir, "big.py", unit.repeat(Math.floor(990_000 / unit.length)), "python");
  // The real body behind a shell that also says how much the process holds,
  // which the pool's own shell has no reason to. The runtime frees a tree
  // nobody deleted once the collector reaches it, and measured that hid a body
  // that deletes nothing: 443 MB after 500 parses against 340. The body may not
  // lean on the collector's timing, so this shell takes the finalizer away.
  const worker = join(dir, "measuring-worker.mjs");
  writeFileSync(
    worker,
    `globalThis.FinalizationRegistry = class { register() {} unregister() {} };
import { readFileSync } from "node:fs";
import { parseTreeFile } from ${JSON.stringify(pathToFileURL(BODY).href)};
process.on("message", async ({ rel, abs, lang }) => {
  const r = await parseTreeFile(readFileSync(abs, "utf8"), rel, lang);
  process.send({ rel, ok: r.ok, error: r.error, rss: process.memoryUsage().rss });
});
process.send({ ready: true, engine: "tree-sitter", version: null });
`,
  );

  // The clock is the machine's to lose here, not the parser's: a loaded runner must not turn this into a timeout test.
  const pool = createPool({ size: 1, worker, engine: "tree-sitter", guards: { timeoutMs: 120_000 } });
  try {
    const rss = [];
    for (let i = 0; i < 500; i++) {
      const r = await pool.parse(big);
      assert.equal(r.ok, true, `parse ${i + 1}: ${r.error}`);
      rss.push(r.rss);
    }
    const mb = (bytes) => Math.round(bytes / 1024 / 1024);
    // The first ten are the heap growing to its working size, and one reading
    // after them is not the floor: measured on a loaded machine, parse 10 read
    // 200 MB in a run that ended at 316, and parse 50 read 253 between 356 and
    // 340. So the middle reading of a hundred parses is held against the
    // middle of the last hundred.
    const middle = (from, to) => rss.slice(from, to).sort((a, b) => a - b)[(to - from) >> 1];
    const [early, late] = [middle(10, 110), middle(400, 500)];
    t.diagnostic(`rss after 1: ${mb(rss[0])} MB, after 10: ${mb(rss[9])} MB, after 500: ${mb(rss[499])} MB, peak: ${mb(Math.max(...rss))} MB`);
    t.diagnostic(`middle of parses 11 to 110: ${mb(early)} MB, of 401 to 500: ${mb(late)} MB`);
    assert.ok(late - early < 64 * 1024 * 1024, `resident size grew ${mb(late - early)} MB between the first hundred parses and the last`);
  } finally {
    await pool.close();
  }
});
