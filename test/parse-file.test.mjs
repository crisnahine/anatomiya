import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { parseFile } from "../plugins/anatomiya/lib/parse-file.mjs";
import { ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";
import { language } from "../plugins/anatomiya/lib/langs.mjs";
import { scriptBlocks } from "../plugins/anatomiya/lib/script-blocks.mjs";

// Linux is where a child's address space can be capped from a shell: macOS
// refuses `ulimit -v` outright, and Windows never asks for the raw transfer.
const needsAddressSpaceLimit =
  process.platform === "linux" ? {} : { skip: "only Linux enforces an address-space limit set with ulimit -v" };

test("a process that cannot reserve the raw transfer's buffer still parses every file", needsAddressSpaceLimit, () => {
  // Measured under `ulimit -v 4000000`, a limit shared servers and some CI
  // hosts set, and what strict overcommit amounts to: the raw transfer asks
  // for a 6 GiB buffer before it parses anything, V8 refuses it, and every
  // JavaScript and TypeScript file came back unreadable. The scan then wrote
  // an overview of zero areas and removed the correct area files beside it.
  // The parser answers the same tree without the raw transfer, so a buffer
  // it cannot have costs speed rather than the file.
  const body = new URL("../plugins/anatomiya/lib/parse-file.mjs", import.meta.url).href;
  const script = [
    `const { parseFile } = await import(${JSON.stringify(body)});`,
    "const out = [];",
    'for (const rel of ["src/a.ts", "src/b.ts"]) {',
    "  try {",
    '    const r = await parseFile("export const n: number = 1;\\n", rel, "js");',
    "    out.push(`${rel} ${r.ok}`);",
    "  } catch (err) {",
    "    out.push(`${rel} threw ${err.message}`);",
    "  }",
    "}",
    'console.log(out.join("\\n"));',
  ].join("\n");
  const run = spawnSync("sh", ["-c", 'ulimit -v 4000000 && exec "$0" --input-type=module -e "$1"', process.execPath, script], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "src/a.ts true\nsrc/b.ts true");
});

test("a generated chain the raw transfer cannot carry is parsed through the plain one", async () => {
  // Measured: the raw transfer's deserializer recurses in JS and runs out of
  // stack near 3,000 operands, while the plain transfer reads the same file
  // with no error. A generated string table is exactly this shape.
  const chain = "module.exports = " + Array.from({ length: 3200 }, (_, i) => JSON.stringify(`line ${i}`)).join(" +\n  ") + ";\n";

  const r = await parseFile(chain, "src/strings.js", "js");

  assert.equal(r.ok, true, r.error);
  assert.equal(r.errors, 0);
  const after = await parseFile("export const a = 1;\n", "src/a.js", "js");
  assert.equal(after.ok, true, "the next file still parses");
});

test("the grammar follows the real extension: a ts assertion parses in .ts and not in .tsx", async () => {
  const cast = "const x = <string>window.name;\nexport const y = x;\n";
  const ts = await parseFile(cast, "src/a.ts", "js");
  assert.equal(ts.ok, true);

  const tsx = await parseFile(cast, "src/a.tsx", "jsx");
  assert.equal(tsx.ok, false);
  assert.ok(tsx.errors > 0);
});

test("JSX is legal in a .js file", async () => {
  const r = await parseFile('export const el = <div a="1" />;\n', "src/a.js", "js");
  assert.equal(r.ok, true);
});

test("a parse reporting syntax errors answers ok false and contributes no sites", async () => {
  const r = await parseFile("function f( {\n", "src/a.js", "js");
  assert.equal(r.ok, false);
  assert.ok(r.errors > 0);
  assert.equal(r.hits, undefined);
});

test("a Flow file is retried blanked, and the rows the blanking blinds are not answered", async () => {
  // Flow-only syntax, because the TypeScript grammar accepts most of what Flow
  // writes: a plain annotation parses clean and the retry never fires.
  const flow = 'import { helper } from "./b.mjs";\ntype Opts = {| n: number |};\nexport function f(o: Opts) { return helper(o.n); }\n';
  const r = await parseFile(flow, "src/a.js", "js");
  assert.equal(r.ok, true);
  assert.equal(r.stripped, true);
  // The stripper deletes what import_extension counts, so the stripped file
  // leaves that denominator rather than reading as more conformant than it is.
  assert.equal(r.hits.import_extension, undefined);

  const plain = 'import { helper } from "./b.mjs";\nexport const f = (x) => helper(x);\n';
  const p = await parseFile(plain, "src/b.js", "js");
  assert.equal(p.stripped, false);
  assert.ok(p.hits.import_extension.length > 0);
});

test("a guarded top-level return is Node's own CommonJS wrapper, not a syntax error", async () => {
  // Real shape: backstage's OpenTelemetry preload and next.js's vendored bull
  // and bullmq, all node --check clean, all rejected before this retry.
  const cjs = 'if (typeof require === "undefined") {\n  return;\n}\nmodule.exports = { ready: true };\n';
  const r = await parseFile(cjs, "src/preload.js", "js");
  assert.equal(r.ok, true);
  // The retry blanks a keyword, not a type: nothing here goes blind.
  assert.equal(r.stripped, false);
});

test("sourceType: script does not fix it either, so a .mjs with the same shape stays rejected", async () => {
  // Node always loads .mjs as ESM, so a top-level return there is really broken.
  const cjs = 'if (typeof require === "undefined") {\n  return;\n}\nmodule.exports = { ready: true };\n';
  const r = await parseFile(cjs, "src/preload.mjs", "js");
  assert.equal(r.ok, false);
});

test("two guarded returns in one file are each patched", async () => {
  const cjs = [
    'if (typeof require === "undefined") { return; }',
    'if (typeof module === "undefined") { return; }',
    "module.exports = {};",
    "",
  ].join("\n");
  const r = await parseFile(cjs, "src/a.cjs", "js");
  assert.equal(r.ok, true);
});

test("a top-level return beside a real syntax error stays rejected", async () => {
  const broken = 'if (x) {\n  return;\n}\nfunction( {\n';
  const r = await parseFile(broken, "src/a.js", "js");
  assert.equal(r.ok, false);
});

test("an absent stripper leaves the file rejected and says which absence it was", async () => {
  const flow = "type Opts = {| n: number |};\nexport const f = (o: Opts) => o.n;\n";
  const r = await parseFile(flow, "src/a.js", "js", { stripper: false });
  assert.equal(r.ok, false);
  assert.equal(r.noStripper, true);
});

test("facets carry the runner core", async () => {
  const spec = 'import { test } from "vitest";\ntest("x", () => {});\n';
  const r = await parseFile(spec, "src/a.test.js", "js");
  assert.equal(r.facets.testRunner, "vitest");
  assert.equal(r.facets.testCalls, true);

  const p = await parseFile("export const a = 1;\n", "src/b.js", "js");
  assert.equal(p.facets.testRunner, null);
});

test("tree mode returns the program and its comment side channel", async () => {
  const r = await parseFile("// why\nexport const a = 1;\n", "src/a.js", "js", { withProgram: true });
  assert.ok(r.program);
  assert.ok(Array.isArray(r.comments));
});

test("a plain JavaScript file is not asked for a return type it cannot carry", async () => {
  // `export function total(rows): number` is a SyntaxError under Node, so the
  // row's own blind field already said a plain JavaScript file has no
  // annotation to find, and it counted the sites anyway.
  const src = "export function total(rows) { return rows.length }\nexport const pick = (rows) => rows[0]\n";

  for (const [rel, lang] of [["src/a.js", "js"], ["src/a.mjs", "js"], ["src/a.cjs", "js"], ["src/a.jsx", "jsx"]]) {
    const r = await parseFile(src, rel, lang);
    assert.equal(r.ok, true, rel);
    assert.equal(r.hits.explicit_return_type, undefined, rel);
  }
});

test("a TypeScript file still answers it", async () => {
  const src = "export function total(rows: string[]) { return rows.length }\n";

  for (const [rel, lang] of [["src/a.ts", "js"], ["src/a.mts", "js"], ["src/a.tsx", "jsx"]]) {
    const r = await parseFile(src, rel, lang);
    assert.equal(r.hits.explicit_return_type.length, 1, rel);
  }
});

test("a Flow file carries the annotation its extension says it cannot", async () => {
  // The extension is a proxy and it is wrong here: `// @flow` declares return
  // types the way a `.ts` file does, and it is read under the same grammar.
  // Measured, the extension rule alone took `explicit_return_type` from 73 area
  // slots to 18 on react, and lost a 68-of-69 claim in a directory that is 100%
  // Flow.
  const flow = "// @flow\nexport function g(a: number): string { return String(a) }\n";
  const plain = "export function g(a) { return String(a) }\n";

  const typed = await parseFile(flow, "src/a.js", "js");
  assert.equal(typed.facets.typed, true);
  assert.equal(typed.hits.explicit_return_type.length, 1);

  const untyped = await parseFile(plain, "src/b.js", "js");
  assert.equal(untyped.facets.typed, false);
  assert.equal(untyped.hits.explicit_return_type, undefined);
});

test("a React component in a .js file is asked the JSX rows, and a .js module holding none is not", async () => {
  // The scan's own kinds line called these files "(JSX)" and no JSX row ever
  // ran on them: the rows declare `jsx`, and a `.js` file is `js` by extension.
  // CRA-era apps, React Native and many Next.js projects keep every component
  // in `.js`, so their maps stated none of the five conventions. The tree is
  // the answer here the way it is for Flow's annotations.
  const component = [
    "import React from 'react';",
    "export function Comp(props) {",
    "  const [n, setN] = React.useState(0);",
    "  return <button onClick={() => setN(n + 1)} {...props}>x</button>;",
    "}",
  ].join("\n") + "\n";
  const hook = "import React from 'react';\nexport function useCount() {\n  return React.useState(0);\n}\n";

  const js = await parseFile(component, "src/Comp.js", "js");
  const jsx = await parseFile(component, "src/Comp.jsx", "jsx");
  for (const key of ["hook_call_style", "handler_is_named", "spread_on_component"]) {
    assert.equal(js.hits[key]?.length, jsx.hits[key].length, key);
  }

  const module = await parseFile(hook, "src/useCount.js", "js");
  assert.equal(module.facets.jsx, false);
  assert.equal(module.hits.hook_call_style, undefined, "a file holding no JSX stays out of the row, as a .ts one does");
});

test("a file's own facets choose its rows before any row walks", async (t) => {
  // Riding the rows' walk, the facets were known only after it, so every row
  // a file could get walked and the ones its facets ruled out were dropped
  // after: 25 rows a file became 32 on this repository, for the same map.
  const row = ALL_DIMENSIONS.find((d) => d.key === "hook_call_style");
  const asked = t.mock.method(row, "visitor");
  const r = await parseFile("export const n: number = 1;\n", "src/n.ts", "js");
  assert.equal(r.ok, true);
  assert.equal(r.facets.jsx, false);
  assert.equal(asked.mock.callCount(), 0, "a JSX row was never made for a file holding no JSX");
});

test("a Vue component answers an ok record with its script's facets", async () => {
  const source = [
    "<template>",
    "  <button @click=\"n++\">{{ n }}</button>",
    "</template>",
    "",
    "<script setup>",
    "import { ref } from \"vue\";",
    "import { clamp } from \"./clamp.js\";",
    "const n = ref(clamp(0));",
    "</script>",
    "",
  ].join("\n");

  const r = await parseFile(source, "src/components/Counter.vue", "vue");

  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.facets.imports.map((i) => i.module), ["vue", "./clamp.js"]);
  assert.equal(r.facets.embedded, "vue");
  assert.equal(r.facets.empty, undefined);
  assert.equal(r.errors, 0);
  // Blanking the markup is not the Flow strip, and no row goes blind for it.
  assert.equal(r.stripped, false);
  assert.equal(r.length, source.length);
  assert.ok(r.hits && typeof r.hits === "object");
  assert.equal(r.program, undefined, "counts mode does not promise a tree");
});

test("two blocks are one program", async () => {
  const source = [
    "<script>",
    "// plain",
    "import a from \"./a.js\";",
    "export const shared = a;",
    "</script>",
    "<template><p>{{ shared }}</p></template>",
    "<script setup>",
    "/* setup */",
    "import b from \"./b.js\";",
    "export { b as renamed };",
    "</script>",
    "",
  ].join("\n");

  const r = await parseFile(source, "src/Two.vue", "vue", { withProgram: true });

  assert.equal(r.ok, true, r.error);
  assert.equal(r.program.start, 0);
  assert.equal(r.program.end, source.length);
  // File order, and every offset the file's own: a node sliced out of the
  // file text is the statement as written.
  assert.deepEqual(
    r.program.body.map((n) => source.slice(n.start, n.end)),
    ['import a from "./a.js";', "export const shared = a;", 'import b from "./b.js";', "export { b as renamed };"]
  );
  assert.deepEqual(
    r.comments.map((c) => source.slice(c.start, c.end)),
    ["// plain", "/* setup */"]
  );
  assert.deepEqual(r.facets.imports.map((i) => i.module), ["./a.js", "./b.js"]);
  assert.deepEqual(r.facets.exports, ["shared", "renamed"]);
});

test("the same binding imported by both blocks is not a syntax error", async () => {
  // Both frameworks allow it, and read as one module it is a redeclaration.
  const source = '<script>\nimport { ref } from "vue";\nexport const a = ref(0);\n</script>\n<script setup>\nimport { ref } from "vue";\nconst b = ref(1);\n</script>\n';

  const r = await parseFile(source, "src/Twice.vue", "vue");

  assert.equal(r.ok, true, r.error);
  assert.equal(r.facets.imports.length, 2);
});

test("a block with lang ts is parsed as TypeScript, and one with none is not", async () => {
  // `<string>y` is a cast in TypeScript and the start of an element everywhere else.
  const typed = await parseFile('<script lang="ts">\nconst x = <string>y;\n</script>\n', "src/A.vue", "vue");
  assert.equal(typed.ok, true, typed.error);

  const plain = await parseFile("<script>\nconst x = <string>y;\n</script>\n", "src/B.vue", "vue");
  assert.equal(plain.ok, false);
  assert.ok(plain.errors >= 1);
  assert.equal(plain.hits, undefined);
});

test("a block with no lang is read as a .js file is: an annotation parses, and the tree says it is typed", async () => {
  // An annotation is what the JSX-only grammar rejects, and what no tag declared.
  const r = await parseFile("<script>\nexport const x: number = 1;\n</script>\n", "src/A.vue", "vue");
  assert.equal(r.ok, true, r.error);
  assert.equal(r.facets.typed, true);
});

test("a block with lang tsx holds JSX", async () => {
  // An element is what the TypeScript grammar reads as a cast and rejects.
  const r = await parseFile('<script setup lang="tsx">\nconst el = <div />;\n</script>\n', "src/A.vue", "vue");
  assert.equal(r.ok, true, r.error);
});

test("a comment on a script's last line ends where the script does", async () => {
  // The end tag is blanked to spaces, which a line comment runs on through.
  for (const [rel, lang] of [["src/A.vue", "vue"], ["src/A.svelte", "svelte"]]) {
    const source = "<script>\nconst a = 1; // why</script>\n<p>markup</p>\n";
    const [block] = scriptBlocks(source, lang).blocks;

    const r = await parseFile(source, rel, lang, { withProgram: true });

    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.comments.map((c) => [source.slice(c.start, c.end), c.value]), [["// why", " why"]], rel);
    for (const c of r.comments) assert.ok(c.end <= block.end, rel);
  }
});

test("a tag's lang marks the file typed before any annotation exists", async () => {
  const ts = await parseFile('<script lang="ts">\nexport const a = 1;\n</script>\n', "src/A.vue", "vue");
  assert.equal(ts.facets.typed, true);

  const tsx = await parseFile('<script setup lang="tsx">\nconst a = 1;\n</script>\n', "src/B.vue", "vue");
  assert.equal(tsx.facets.typed, true);

  const js = await parseFile("<script>\nexport const a = 1;\n</script>\n", "src/C.vue", "vue");
  assert.equal(js.facets.typed, false);

  const svelte = await parseFile('<script lang="ts">\nexport const a = 1;\n</script>\n', "src/D.svelte", "svelte");
  assert.equal(svelte.facets.typed, true);
});

test("one typed block of two marks the file typed", async () => {
  const source = '<script>\nexport const a = 1;\n</script>\n<script setup lang="ts">\nconst b = 2;\n</script>\n';
  const r = await parseFile(source, "src/A.vue", "vue");
  assert.equal(r.facets.typed, true);
});

test("a component with no script is empty, not rejected", async () => {
  const sources = {
    "src/Plain.vue": "<template>\n  <p>hello</p>\n</template>\n<style>p { color: red }</style>\n",
    "src/Plain.svelte": "<p>hello</p>\n",
    // A language nobody here reads holds no script this tool can count.
    "src/Coffee.vue": '<script lang="coffee">\nx = -> 1\n</script>\n',
    "src/Nothing.vue": "",
  };

  for (const [rel, source] of Object.entries(sources)) {
    const lang = rel.endsWith(".vue") ? "vue" : "svelte";
    const r = await parseFile(source, rel, lang, { withProgram: true });
    assert.equal(r.ok, true, rel);
    assert.deepEqual(r.hits, {}, rel);
    assert.equal(r.facets.empty, true, rel);
    assert.equal(r.facets.embedded, lang, rel);
    assert.equal(r.facets.testRunner, null, rel);
    assert.equal(r.facets.testCalls, false, rel);
    assert.equal(r.errors, 0, rel);
    assert.equal(r.stripped, false, rel);
    assert.equal(r.length, source.length, rel);
    assert.deepEqual(r.program.body, [], rel);
    assert.equal(r.program.end, source.length, rel);
  }
});

test("an unterminated script is rejected", async () => {
  const vue = await parseFile("<template><p/></template>\n<script setup>\nconst a = 1;\n", "src/A.vue", "vue");
  assert.equal(vue.ok, false);
  assert.ok(vue.errors >= 1);
  assert.equal(vue.hits, undefined);

  const svelte = await parseFile("<script>\nlet a = 1;\n", "src/A.svelte", "svelte");
  assert.equal(svelte.ok, false);
  assert.ok(svelte.errors >= 1);
});

test("a script that never ends rejects the file even after one that did", async () => {
  // The block found first parses clean, and half a component is not the file.
  const source = "<script>\nexport const a = 1;\n</script>\n<script setup>\nconst b = 2;\n";
  const r = await parseFile(source, "src/A.vue", "vue");
  assert.equal(r.ok, false);
  assert.ok(r.errors >= 1);
});

test("a syntax error in either block rejects the file", async () => {
  const first = await parseFile("<script>\nfunction f( {\n</script>\n<script setup>\nconst b = 2;\n</script>\n", "src/A.vue", "vue");
  assert.equal(first.ok, false);
  assert.ok(first.errors >= 1);

  const second = await parseFile("<script>\nexport const a = 1;\n</script>\n<script setup>\nfunction f( {\n</script>\n", "src/B.vue", "vue");
  assert.equal(second.ok, false);
  assert.ok(second.errors >= 1);
});

test("a Svelte 5 component with runes parses", async () => {
  const source = [
    '<script lang="ts">',
    "  let { step = 1 }: { step?: number } = $props();",
    "  let count = $state(0);",
    "  const double = $derived(count * 2);",
    "  $effect(() => { console.log(double); });",
    "</script>",
    "",
    "<button onclick={() => (count += step)}>{double}</button>",
    "",
  ].join("\n");

  const r = await parseFile(source, "src/lib/Counter.svelte", "svelte");

  assert.equal(r.ok, true, r.error);
  assert.equal(r.facets.embedded, "svelte");
  assert.equal(r.facets.typed, true);
});

test("a Svelte 4 component with export let and a reactive label parses", async () => {
  const source = [
    '<script context="module">',
    '  import { writable } from "svelte/store";',
    "  export const total = writable(0);",
    "</script>",
    "",
    "<script>",
    '  import { onMount } from "svelte";',
    "  export let name = \"world\";",
    "  let count = 0;",
    "  $: doubled = count * 2;",
    "  $: if (count > 10) count = 0;",
    "  onMount(() => { $total += 1; });",
    "</script>",
    "",
    "<h1>Hello {name} {doubled}</h1>",
    "",
  ].join("\n");

  const r = await parseFile(source, "src/lib/Hello.svelte", "svelte");

  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.facets.imports.map((i) => i.module), ["svelte/store", "svelte"]);
  assert.deepEqual(r.facets.exports, ["total", "name"]);
});

test("line numbers are the file's", async () => {
  // CRLF markup and a BOM above the script: the offset a node carries indexes
  // the string the caller holds, so the line a check reports is the file's own.
  const markup = Array.from({ length: 10 }, (_, i) => `  <p>line ${i} é 𝒳</p>`);
  const source = "﻿" + ["<template>", ...markup, "</template>", "<script setup>", "const first = 1;", "</script>", ""].join("\r\n");
  const at = source.indexOf("const first = 1;");

  const r = await parseFile(source, "src/A.vue", "vue", { withProgram: true });

  assert.equal(r.ok, true, r.error);
  assert.equal(r.program.body[0].start, at);
  assert.equal(source.slice(0, r.program.body[0].start).split("\n").length, 14);
  assert.equal(r.length, source.length);
});

test("a row asked of a component is handed the file's own text", async (t) => {
  // A row slices between offsets, and the check hands the same rows the file
  // as the caller holds it: the two must be one string, markup and all.
  const row = ALL_DIMENSIONS.find((d) => d.key === "doc_comment_style");
  const langs = row.langs;
  row.langs = [...langs, "vue"];
  t.after(() => {
    row.langs = langs;
  });
  const asked = t.mock.method(row, "visitor");
  const source = "<template><p/></template>\n<script>\nexport const a = 1;\n</script>\n<script setup>\nconst b = 2;\n</script>\n";

  const r = await parseFile(source, "src/A.vue", "vue");

  assert.equal(r.ok, true, r.error);
  assert.equal(asked.mock.callCount(), 1);
  const [program, , extra] = asked.mock.calls[0].arguments;
  assert.equal(extra.source, source);
  assert.equal(extra.rel, "src/A.vue");
  assert.equal(program.body.length, 2);
});

test("a component's rows are chosen for its own language and no other", async () => {
  // No blanket mapping onto the JavaScript rows: a row answers a component
  // only once it lists the language, and the const row lists neither.
  const r = await parseFile("<script>\nlet a = 1;\ntry { f(); } catch (e) {}\n</script>\n", "src/A.vue", "vue");
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.hits), ["swallowed_error"]);
});

test("a .svelte.ts module is plain TypeScript, read whole", async () => {
  const rel = "src/state.svelte.ts";
  const r = await parseFile("export const count = $state(0);\n", rel, language(rel));
  assert.equal(r.ok, true);
  assert.equal(r.facets.embedded, undefined);
  assert.deepEqual(r.facets.exports, ["count"]);
});

test("a megabyte of markup around a two-line script parses inside the per-file clock", async () => {
  const source = "<template>\n" + "<div>x</div>\n".repeat(70_000) + "</template>\n<script setup>\nconst a = 1;\n</script>\n";
  const from = performance.now();
  const r = await parseFile(source, "src/Big.vue", "vue");
  assert.equal(r.ok, true);
  assert.ok(performance.now() - from < 2_000, "linear in the file");
});
