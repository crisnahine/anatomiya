import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFile } from "../plugins/anatomiya/lib/parse-file.mjs";
import { holdsTypeSyntax } from "../plugins/anatomiya/lib/langs.mjs";
import { REGISTRY, rowByKey } from "../plugins/anatomiya/lib/registry.mjs";
import { EXCLUDED, HOLDS, SFC_FIXTURES } from "./sfc-fixtures.mjs";

/**
 * What a person reading each component would answer for each JavaScript row,
 * written from the row's `sites` sentence before the row was run.
 *
 * A counted row reads `conforming/sites`. A row that learns its class reads the
 * class each site votes for, sorted. A fixture a row is not listed under holds
 * no site for it.
 */
const EXPECTED = {
  swallowed_error: {
    "vue-setup": "1/1", "vue-options": "1/1", "vue-js-setup": "0/1", "vue-define": "0/1",
    "svelte-runes": "1/1", "svelte-store": "0/1", "svelte-form": "1/1", "svelte-tabs": "1/1",
  },
  error_shape: {
    "vue-options": "0/1", "vue-two": "0/1", "vue-class": "0/1",
    "svelte-form": "1/2", "svelte-two": "0/1",
  },
  module_state_const: {
    "vue-two": "2/2", "vue-define": "1/1", "svelte-store": "1/1", "svelte-two": "1/1",
  },
  async_error_handling: {
    "vue-setup": "1/2", "vue-options": "1/2", "vue-js-setup": "1/2", "vue-class": "0/1", "vue-define": "1/1",
    "svelte-runes": "1/2", "svelte-store": "1/1", "svelte-form": "1/1",
  },
  optional_chaining: { "vue-two": "0/2", "svelte-form": "0/2" },
  hook_per_module: {},
  function_style: {
    "vue-setup": "3/4", "vue-two": "2/4", "vue-js-setup": "0/2",
    "svelte-runes": "3/4", "svelte-legacy": "3/3", "svelte-store": "3/4", "svelte-form": "2/3",
    "svelte-two": "4/4", "svelte-tabs": "2/3",
  },
  explicit_return_type: { "vue-two": "1/2", "svelte-legacy": "0/1", "svelte-two": "1/2" },
  type_only_import: { "vue-setup": "1/1", "vue-class": "1/1", "svelte-runes": "1/1", "svelte-two": "1/1" },
  import_extension: {
    "vue-setup": "1/3", "vue-options": "1/2", "vue-two": "0/1", "vue-js-setup": "2/3", "vue-class": "0/2",
    "vue-define": "2/2", "svelte-runes": "1/2", "svelte-legacy": "1/2", "svelte-store": "2/3",
    "svelte-form": "2/2", "svelte-two": "0/1", "svelte-tabs": "2/2",
  },
  nullish_default: {
    "vue-setup": "2/3", "vue-options": "0/1", "vue-two": "1/1", "vue-js-setup": "1/3",
    "svelte-runes": "1/2", "svelte-legacy": "0/1", "svelte-store": "0/1", "svelte-form": "1/2",
    "svelte-two": "1/1", "svelte-tabs": "1/1",
  },
  non_null_assertion: {
    "vue-setup": "2/3", "svelte-runes": "1/1", "svelte-legacy": "1/1", "svelte-two": "1/1", "svelte-tabs": "0/1",
  },
  absent_is_null: {
    "vue-setup": "1/1", "vue-options": "0/1", "vue-two": "0/1", "vue-js-setup": "0/1", "vue-class": "1/1",
    "svelte-legacy": "1/1", "svelte-store": "0/1",
  },
  iterate_with_for_of: {
    "vue-setup": "1/1", "vue-options": "0/1", "vue-js-setup": "0/1",
    "svelte-runes": "1/1", "svelte-store": "1/2", "svelte-tabs": "1/1",
  },
  test_call_style: {},
  assertion_style: { "svelte-tabs": "0/1" },
  doc_comment_style: { "vue-two": "1/2", "vue-class": "1/1", "svelte-legacy": "0/1", "svelte-two": "1/3" },
  function_naming_case: {
    "vue-setup": "camelCase camelCase camelCase", "vue-two": "camelCase camelCase snake_case",
    "vue-js-setup": "snake_case", "svelte-runes": "camelCase camelCase camelCase",
    "svelte-legacy": "camelCase snake_case", "svelte-store": "camelCase camelCase",
    "svelte-two": "camelCase camelCase camelCase", "svelte-tabs": "camelCase snake_case",
  },
  exported_symbol_case: {
    "vue-two": "camelCase camelCase camelCase", "svelte-two": "camelCase camelCase camelCase",
  },
  exported_class_case: { "vue-class": "PascalCase", "svelte-two": "PascalCase" },
  exported_type_case: { "vue-two": "PascalCase PascalCase", "svelte-two": "PascalCase PascalCase" },
  extends_base: { "vue-class": "Vue", "svelte-two": "Error", "svelte-tabs": "TabRegistry" },
  interface_prefix: {
    "vue-setup": "none", "vue-two": "I", "vue-class": "I",
    "svelte-runes": "none", "svelte-two": "none none", "svelte-tabs": "I",
  },
  type_alias_prefix: {
    "vue-setup": "none", "vue-two": "none", "vue-class": "T",
    "svelte-runes": "none", "svelte-two": "none", "svelte-tabs": "none",
  },
  route_logging: {
    "vue-setup": "0/2", "vue-options": "1/1", "vue-define": "1/1",
    "svelte-runes": "0/2", "svelte-legacy": "0/1", "svelte-store": "1/1",
  },
  route_network: {
    "vue-setup": "1/2", "vue-options": "0/1", "vue-js-setup": "1/1",
    "svelte-runes": "1/2", "svelte-store": "1/1", "svelte-form": "0/1",
  },
  route_env: {
    "vue-setup": "0/1", "vue-two": "1/1", "vue-js-setup": "1/1", "svelte-legacy": "1/1", "svelte-form": "2/2",
  },
};

const FRAMEWORKS = ["vue", "svelte"];
const treeKeys = Object.keys(EXPECTED);

// The answer in the table's spelling, with the row forced on whatever its
// `langs` say and held to the one gate the scan applies per file.
async function answers(fixture) {
  const record = await parseFile(fixture.source, fixture.rel, fixture.lang, { withProgram: true });
  assert.equal(record.ok, true, `${fixture.id} parses`);
  const out = {};
  for (const key of treeKeys) {
    const row = rowByKey(key);
    if (row.needsTypeSyntax && !holdsTypeSyntax(fixture.rel, record.facets)) continue;
    const hits = [];
    row.run(record.program, (hit) => hits.push(hit), { comments: record.comments, source: fixture.source, rel: fixture.rel });
    if (hits.length === 0) continue;
    out[key] = row.learnedClasses
      ? hits.map((h) => h.class).sort().join(" ")
      : `${hits.filter((h) => h.conforming).length}/${hits.length}`;
  }
  return out;
}

const ANSWERS = new Map();
for (const fixture of SFC_FIXTURES) ANSWERS.set(fixture.id, await answers(fixture));

const listing = (lang) => REGISTRY.filter((row) => row.langs.includes(lang)).map((row) => row.key).sort();

test("the table asks every syntactic tree row JavaScript has", () => {
  const rows = REGISTRY.filter((r) => r.langs.includes("js") && r.kind === "tree" && r.tier === "syntactic");
  assert.deepEqual(treeKeys.slice().sort(), rows.map((r) => r.key).sort());
});

test("every fixture is a real script of thirty lines or more", () => {
  for (const f of SFC_FIXTURES) {
    const lines = [...f.source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .reduce((n, m) => n + m[1].trim().split("\n").length, 0);
    assert.ok(lines >= 30, `${f.id} holds ${lines} script lines`);
  }
  for (const lang of FRAMEWORKS) assert.equal(SFC_FIXTURES.filter((f) => f.lang === lang).length, 6);
});

for (const lang of FRAMEWORKS) {
  test(`every row listed for ${lang} answers each ${lang} component as a person would`, () => {
    for (const key of treeKeys.filter((k) => rowByKey(k).langs.includes(lang))) {
      for (const f of SFC_FIXTURES.filter((x) => x.lang === lang)) {
        assert.equal(ANSWERS.get(f.id)[key], EXPECTED[key][f.id], `${key} on ${f.id}`);
      }
    }
  });

  test(`the rows that hold for ${lang} are the rows the registry lists it under`, () => {
    assert.deepEqual(listing(lang), HOLDS[lang].slice().sort());
  });
}

test("every excluded row misreads the fixture its sentence names", () => {
  for (const entry of EXCLUDED) {
    assert.ok(entry.why.length > 40, `${entry.key} says which construct it misreads`);
    for (const lang of entry.langs) {
      const id = entry.decidedBy[lang];
      assert.equal(SFC_FIXTURES.find((f) => f.id === id)?.lang, lang, `${entry.key} names a ${lang} fixture`);
      assert.notEqual(ANSWERS.get(id)[entry.key], EXPECTED[entry.key][id], `${entry.key} now reads ${id} as a person would: list it`);
    }
  }
});

test("a JavaScript row holds or is excluded, per framework, never both and never neither", () => {
  for (const lang of FRAMEWORKS) {
    const out = EXCLUDED.filter((e) => e.langs.includes(lang)).map((e) => e.key);
    const all = [...HOLDS[lang], ...out].sort();
    assert.deepEqual(all, [...treeKeys, "file_naming_case"].sort(), lang);
  }
});

test("svelte is listed exactly where vue is, unless the exclusion names one framework", () => {
  const oneSided = new Map(EXCLUDED.filter((e) => e.langs.length === 1).map((e) => [e.key, e.langs[0]]));
  for (const row of REGISTRY) {
    const [vue, svelte] = FRAMEWORKS.map((l) => row.langs.includes(l));
    if (vue === svelte) {
      assert.equal(oneSided.has(row.key), false, `${row.key} is excluded for one framework and listed for both or neither`);
      continue;
    }
    assert.equal(oneSided.get(row.key), vue ? "svelte" : "vue", `${row.key} lists one framework with no sentence saying why`);
  }
});

test("a row gains the two ids after its own, so its walk stays the oxc walk", () => {
  for (const row of REGISTRY.filter((r) => FRAMEWORKS.some((l) => r.langs.includes(l)))) {
    assert.equal(row.langs[0], "js", row.key);
  }
});

const hitsOf = async (key, rel, source) => {
  const lang = rel.slice(rel.lastIndexOf(".") + 1);
  const record = await parseFile(source, rel, ["vue", "svelte"].includes(lang) ? lang : "js", { withProgram: true });
  assert.equal(record.ok, true, `${rel} parses`);
  const hits = [];
  rowByKey(key).run(record.program, (hit) => hits.push(hit), { comments: record.comments, source, rel });
  return hits;
};

test("a function a Vue template renders as a component is not a function name", async () => {
  // The shape of element-plus's table examples: a row renderer declared in the
  // script, capitalised because the template mounts it as `<Row>`.
  const body = `
import { cloneVNode } from "vue";

const colSpanIndex = 1;

const Row = ({ rowData, cells }) => {
  cells[colSpanIndex] = cloneVNode(cells[colSpanIndex], { rowData });
  return cells;
};

function CustomizedHeader({ cells }) {
  return cells;
}

const generateColumns = (length = 10) => Array.from({ length });
`;
  const vue = `<template>\n  <el-table-v2 :columns="generateColumns()">\n    <template #row="props"><Row v-bind="props" /></template>\n  </el-table-v2>\n</template>\n\n<script lang="ts" setup>${body}</script>\n`;

  const names = async (rel, source) => (await hitsOf("function_naming_case", rel, source)).map((h) => `${h.where} ${h.class}`);
  assert.deepEqual(await names("docs/examples/table-v2/colspan.vue", vue), ["generateColumns camelCase"]);
  assert.deepEqual(
    await names("docs/examples/table-v2/colspan.ts", body),
    ["Row PascalCase", "CustomizedHeader PascalCase", "generateColumns camelCase"],
    "a module has no template to render it, so the name still votes"
  );
});

test("a Svelte prop is a prop to every row that reads an export or a function", async () => {
  const script = `
  export let onDelete = () => {};
  export var formatLabel = (text: string) => text.trim();
  export const parseLabel = (text: string) => text.trim();
  export function resetLabel() {}
`;
  const svelte = `<script lang="ts">${script}</script>\n\n<button on:click={onDelete}>{formatLabel("x")}</button>\n`;
  const sites = async (key, rel, source) => (await hitsOf(key, rel, source)).map((h) => h.where);

  for (const [key, inComponent, inModule] of [
    ["function_style", ["parseLabel", "resetLabel"], ["onDelete", "formatLabel", "parseLabel", "resetLabel"]],
    ["explicit_return_type", ["parseLabel", "resetLabel"], ["onDelete", "formatLabel", "parseLabel", "resetLabel"]],
    ["doc_comment_style", ["parseLabel", "resetLabel"], ["onDelete", "formatLabel", "parseLabel", "resetLabel"]],
    ["exported_symbol_case", ["parseLabel", "resetLabel"], ["onDelete", "formatLabel", "parseLabel", "resetLabel"]],
    ["function_naming_case", ["parseLabel", "resetLabel"], ["onDelete", "formatLabel", "parseLabel", "resetLabel"]],
  ]) {
    assert.deepEqual(await sites(key, "src/lib/Todo.svelte", svelte), inComponent, `${key} in a component`);
    assert.deepEqual(await sites(key, "src/lib/todo.ts", script), inModule, `${key} in a module`);
  }
});

test("a Svelte prop holding a class is a prop when classes are named", async () => {
  const script = `
  export let Renderer = class {};
  export const DefaultRenderer = class {};
  export class PlainRenderer {}
`;
  const svelte = `<script>${script}</script>\n\n<p>{new Renderer()}</p>\n`;
  const sites = async (rel, source) => (await hitsOf("exported_class_case", rel, source)).map((h) => h.where);

  assert.deepEqual(await sites("src/lib/Canvas.svelte", svelte), ["DefaultRenderer", "PlainRenderer"]);
  assert.deepEqual(await sites("src/lib/canvas.ts", script), ["Renderer", "DefaultRenderer", "PlainRenderer"]);
});
