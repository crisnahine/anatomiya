import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ENGINE, ENGINE_VERSION, failure, parseTreeFile, probeGrammars } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
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
    const r = await parseTreeFile(source, rel, lang);

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
    assert.deepEqual(r.hits, {}, "tree mode carries what counts mode carries, and the tree beside it");
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
  assert.deepEqual(seen, [{ comments: [], source, rel: "src/a.py" }]);
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
