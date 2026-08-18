import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectHits } from "../lib/walk.mjs";
import { learnClass, verdictFor } from "../lib/reduce.mjs";
import { needsRuby } from "./ruby-available.mjs";

/* --- hits carry a class only when the dimension gives one --- */

test("collectHits keeps a hit's class and omits the key otherwise", () => {
  const dim = {
    key: "k",
    run(_program, add) {
      add({ conforming: true, where: null, class: "kebab-case" });
      add({ conforming: false, where: null });
    },
  };
  const hits = collectHits({ type: "Program", body: [] }, [dim]);
  assert.equal(hits.k[0].class, "kebab-case");
  assert.equal("class" in hits.k[1], false);
});

test("collectHits keeps a hit's group and omits the key otherwise", () => {
  const dim = {
    key: "k",
    run(_program, add) {
      add({ conforming: false, where: null, class: "A", group: 2 });
      add({ conforming: false, where: null, class: "B" });
    },
  };
  const hits = collectHits({ type: "Program", body: [] }, [dim]);
  assert.equal(hits.k[0].group, 2);
  assert.equal("group" in hits.k[1], false);
});

/* --- the majority class --- */

const sites = (cls, n) => Array.from({ length: n }, () => ({ conforming: false, class: cls }));

test("learnClass answers the plurality class", () => {
  const perFile = new Map([
    ["a.ts", sites("kebab-case", 3)],
    ["b.ts", [...sites("kebab-case", 2), ...sites("camelCase", 1)]],
  ]);
  assert.equal(learnClass(perFile), "kebab-case");
});

test("a tie learns nothing", () => {
  const perFile = new Map([
    ["a.ts", sites("kebab-case", 2)],
    ["b.ts", sites("camelCase", 2)],
  ]);
  assert.equal(learnClass(perFile), null);
});

test("a hit with no class does not vote", () => {
  const perFile = new Map([["a.ts", [...sites("snake_case", 1), { conforming: false }]]]);
  assert.equal(learnClass(perFile), "snake_case");
});

test("a grouped row votes once per body and class", () => {
  const inBody = (cls, group) => ({ conforming: false, class: cls, group });
  const perFile = new Map([
    ["a.rb", [inBody("A", 1), inBody("A", 1)]],
    ["b.rb", [inBody("B", 1)]],
  ]);
  assert.equal(learnClass(perFile, { grouped: true }), null, "one body including A twice is one vote for A");
  assert.equal(learnClass(perFile), "A", "counted per site, the repeat wins it");
});

/* --- a body whose sites travel together, voting once per body and class --- */

/**
 * One file per class body, hits shaped the way the worker emits them: one per
 * included constant, every constant of a body carrying that body's group.
 */
const includeArea = (bodies, key = "module_include") => {
  const rels = bodies.map((_, i) => `app/workers/w${i}.rb`);
  return {
    area: { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) },
    parsed: bodies.map((classes, i) => ({
      rel: rels[i],
      ok: true,
      hits: { [key]: classes.map((cls) => ({ conforming: false, where: "W", class: cls, group: 1 })) },
    })),
  };
};

const includeSlot = async (bodies) => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const { area, parsed } = includeArea(bodies);
  return reduceArea(area, parsed).find((d) => d.key === "module_include");
};

test("a class including two modules is one candidate, not one per constant", async () => {
  const slot = await includeSlot([...Array(10).fill(["A", "B"]), ["A"]]);
  assert.equal(slot.learned, "A");
  assert.equal(slot.candidates, 11, "eleven bodies, not twenty-one includes");
  assert.equal(slot.conforming, 11, "a body including A conforms whatever else it includes");
  assert.deepEqual(slot.exceptions, []);
});

test("a row that is not grouped still counts one site per constant", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const bodies = [...Array(10).fill(["A", "B"]), ["A"]];
  const rels = bodies.map((_, i) => `src/m${i}.ts`);
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = bodies.map((classes, i) => ({
    rel: rels[i],
    ok: true,
    hits: { extends_base: classes.map((cls) => ({ conforming: false, where: "W", class: cls })) },
  }));
  const slot = reduceArea(area, parsed).find((d) => d.key === "extends_base");
  assert.equal(slot.candidates, 21);
  assert.equal(slot.conforming, 11);
});

test("a body including nothing the area learned is one exception, not one per constant", async () => {
  const slot = await includeSlot([...Array(10).fill(["A", "B"]), ["A"], ["C", "D"]]);
  assert.equal(slot.learned, "A");
  assert.equal(slot.candidates, 12);
  assert.equal(slot.conforming, 11);
  assert.deepEqual(slot.exceptions, [{ path: "app/workers/w11.rb", count: 1 }]);
});

test("a hit carrying no group is its own site", async () => {
  // The fold reads the group off the hit, so a row that grouped nothing counts
  // the way it did before: one site per constant, and every constant votes.
  const { reduceArea } = await import("../lib/reduce.mjs");
  const bodies = [...Array(10).fill(["A", "B"]), ["A"]];
  const rels = bodies.map((_, i) => `app/workers/w${i}.rb`);
  const area = { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) };
  const parsed = bodies.map((classes, i) => ({
    rel: rels[i],
    ok: true,
    hits: { module_include: classes.map((cls) => ({ conforming: false, where: "W", class: cls })) },
  }));
  const slot = reduceArea(area, parsed).find((d) => d.key === "module_include");
  assert.equal(slot.learned, "A");
  assert.equal(slot.candidates, 21);
  assert.equal(slot.conforming, 11);
});

test("a directory where every class includes both modules learns nothing", async () => {
  // C13: a tie is a directory that has not said anything, and grouping the
  // sites does not give it a casting vote.
  assert.equal(await includeSlot(Array(12).fill(["A", "B"])), undefined);
});

/* --- the learned class moving since the pin closes the slot --- */

const gatedDim = (o = {}) => ({
  key: "k", claim: "c", precision: "precise",
  applicability: 10, langFileCount: 12,
  candidates: 60, conforming: 60,
  effectiveFiles: 5, top: { candidates: 12, conforming: 12 },
  files: ["a/1.ts", "a/2.ts", "b/3.ts", "a/4.ts", "b/5.ts"],
  exceptions: [], moreExceptions: 0, ...o,
});

test("a learned class that moved since the pin states nothing", () => {
  const r = verdictFor(gatedDim({ learned: "kebab-case" }), {
    baselineDim: gatedDim({ learned: "camelCase" }),
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.states, null);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "learned-moved");
  assert.equal(r.counterGate, "learned-moved");
});

test("a learned class that held since the pin states as usual", () => {
  const r = verdictFor(gatedDim({ learned: "kebab-case" }), {
    baselineDim: gatedDim({ learned: "kebab-case" }),
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.states, "claim");
  assert.equal(r.gate, null);
});

/* --- file naming, classified from the basename --- */

test("classifyBasename tells the four classes apart and refuses the ambiguous", async () => {
  const { classifyBasename } = await import("../lib/dimensions-naming.mjs");
  assert.equal(classifyBasename("src/user-profile.ts"), "kebab-case");
  assert.equal(classifyBasename("src/userProfile.ts"), "camelCase");
  assert.equal(classifyBasename("src/UserProfile.tsx"), "PascalCase");
  assert.equal(classifyBasename("app/models/user_profile.rb"), "snake_case");
  assert.equal(classifyBasename("src/index.ts"), null, "a single lowercase word matches every class");
  assert.equal(classifyBasename("Rakefile"), null, "a bare filename is its own convention");
  assert.equal(classifyBasename("src/OrderList.stories.tsx"), "PascalCase", "only the stem is read");
});

test("an area of mostly kebab files states the learned class over every classifiable file", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const rels = [
    "src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts",
    "src/form-input.ts", "src/nav-bar.ts", "src/date-utils.ts", "src/error-page.ts",
    "src/big-table.ts", "src/oneOff.ts",
  ];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));
  const dims = reduceArea(area, parsed);
  const slot = dims.find((d) => d.key === "file_naming_case");
  assert.ok(slot, "the corpus dimension produced a slot");
  assert.equal(slot.learned, "kebab-case");
  assert.equal(slot.claim, "files here are named kebab-case");
  assert.equal(slot.candidates, 10);
  assert.equal(slot.conforming, 9);
  assert.equal(slot.applicability, 10);
  assert.equal(slot.exceptions[0].path, "src/oneOff.ts");
});

test("a naming tie produces no slot at all", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/orderList.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));
  assert.equal(reduceArea(area, parsed).find((d) => d.key === "file_naming_case"), undefined);
});

/* --- the AST naming rows --- */

const astHits = async (key, src) => {
  const { parseSync } = await import("oxc-parser");
  const { NAMING_AST } = await import("../lib/dimensions-naming.mjs");
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  NAMING_AST.find((d) => d.key === key).run(program, (h) => out.push(h));
  return out;
};

test("function_naming_case votes with each module-level function's class", async () => {
  const h = await astHits("function_naming_case", `
    function fooBar() {}
    function foo_bar() {}
    const FooBar = () => {}
    function foo() {}
    function outer() { function innerName() {} }
  `);
  assert.deepEqual(h.map((x) => x.class).sort(), ["PascalCase", "camelCase", "snake_case"]);
});

test("a class method is not a module-level function site", async () => {
  const h = await astHits("function_naming_case", `class C { fooBar() {} }`);
  assert.equal(h.length, 0);
});

test("exported_symbol_case votes with a function or a variable, never a class or a type", async () => {
  const h = await astHits("exported_symbol_case", `
    export function fooBar() {}
    export const my_thing = 1;
    export const doThing = () => {};
    export class OrderList {}
    export interface IFoo { a: string }
    export type UserShape = { id: string };
    export enum Color { Red, Green }
  `);
  assert.deepEqual(h.map((x) => x.where).sort(), ["doThing", "fooBar", "my_thing"]);
});

test("exported_class_case votes with a class declaration or a class bound to a variable", async () => {
  const h = await astHits("exported_class_case", `
    export class OrderList {}
    export const Foo = class {};
    export function fooBar() {}
    export const my_thing = 1;
  `);
  assert.deepEqual(h.map((x) => x.where).sort(), ["Foo", "OrderList"]);
});

test("exported_type_case votes with an interface, a type alias, or an enum", async () => {
  const h = await astHits("exported_type_case", `
    export interface IFoo { a: string }
    export type UserShape = { id: string };
    export enum Color { Red, Green }
    export class OrderList {}
    export function fooBar() {}
  `);
  assert.deepEqual(h.map((x) => x.where).sort(), ["Color", "IFoo", "UserShape"]);
});

test("a default export, a namespace, and a renaming specifier answer none of the three rows", async () => {
  const src = `
    export default function ignoredName() {}
    export namespace NS { export const x = 1; }
    const plain = 1;
    export { plain as renamedThing };
  `;
  for (const key of ["exported_symbol_case", "exported_class_case", "exported_type_case"]) {
    assert.deepEqual(await astHits(key, src), [], key);
  }
});

test("an export declared inside an ambient module is not a top-level site", async () => {
  // `declare module "legacy" { export var legacyGlobal: number }` is Flow's
  // way to describe a dependency with no types of its own, and the Flow retry
  // deletes the whole block: a site counted inside it would move once the
  // retry ran, which stripped-consistency.test.mjs exists to catch.
  const src = `
    declare module "legacy" {
      export var legacyGlobal: number;
    }
  `;
  for (const key of ["exported_symbol_case", "exported_class_case", "exported_type_case"]) {
    assert.deepEqual(await astHits(key, src), [], key);
  }
});

test("the naming AST rows are reachable from the registry", async () => {
  const { dimensionsFor } = await import("../lib/dimensions.mjs");
  const keys = dimensionsFor(["js"]).map((d) => d.key);
  for (const key of ["function_naming_case", "exported_symbol_case", "exported_class_case", "exported_type_case"]) {
    assert.ok(keys.includes(key), key);
  }
});

/* --- the three exported-name populations are judged apart, never against
   each other: a defect shown on typeorm and mastodon by planting a change and
   running the real CLI (percheck-fixes task 8) --- */

test("a class-only area's class row ignores a planted function, whichever way the function is cased (typeorm shape)", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const classFiles = Array.from({ length: 9 }, (_, i) => ({
    rel: `entity/Model${i}.ts`,
    ok: true,
    hits: { exported_class_case: [{ conforming: false, where: `Model${i}`, class: "PascalCase" }] },
  }));
  const fnFiles = [
    { rel: "entity/good1.ts", ok: true, hits: { exported_symbol_case: [{ conforming: false, where: "isValidPost", class: "camelCase" }] } },
    { rel: "entity/good2.ts", ok: true, hits: { exported_symbol_case: [{ conforming: false, where: "filterByCte", class: "camelCase" }] } },
    { rel: "entity/good3.ts", ok: true, hits: { exported_symbol_case: [{ conforming: false, where: "loadEntity", class: "camelCase" }] } },
    { rel: "entity/bad.ts", ok: true, hits: { exported_symbol_case: [{ conforming: false, where: "IsValidPost", class: "PascalCase" }] } },
  ];
  const files = [...classFiles, ...fnFiles];
  const area = { langs: ["js"], files: files.map((f) => ({ rel: f.rel, lang: "js" })) };
  const dims = reduceArea(area, files);

  const classSlot = dims.find((d) => d.key === "exported_class_case");
  assert.equal(classSlot.learned, "PascalCase");
  assert.equal(classSlot.candidates, 9, "a function export must not be a site for the class row");

  const fnSlot = dims.find((d) => d.key === "exported_symbol_case");
  assert.equal(fnSlot.learned, "camelCase", "the function population states its own convention, not the class population's");
  assert.deepEqual(
    fnSlot.exceptions.map((e) => e.path),
    ["entity/bad.ts"],
    "the camelCase function is not an exception; only the PascalCase one is"
  );
});

test("a value-dominated area's type row learns its own PascalCase and calls no idiomatic type export a violation (mastodon shape)", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const valueFiles = Array.from({ length: 20 }, (_, i) => ({
    rel: `app/mod${i}.ts`,
    ok: true,
    hits: { exported_symbol_case: [{ conforming: false, where: `doThing${i}`, class: "camelCase" }] },
  }));
  const typeFiles = [
    { rel: "app/api_types/timeline.ts", ok: true, hits: { exported_type_case: [{ conforming: false, where: "TimelineParams", class: "PascalCase" }] } },
    { rel: "app/api_types/status.ts", ok: true, hits: { exported_type_case: [{ conforming: false, where: "StatusInteractionIntent", class: "PascalCase" }] } },
    { rel: "app/api_types/modal.ts", ok: true, hits: { exported_type_case: [{ conforming: false, where: "ModalType", class: "PascalCase" }] } },
  ];
  const files = [...valueFiles, ...typeFiles];
  const area = { langs: ["js"], files: files.map((f) => ({ rel: f.rel, lang: "js" })) };
  const dims = reduceArea(area, files);

  const typeSlot = dims.find((d) => d.key === "exported_type_case");
  assert.equal(typeSlot.learned, "PascalCase");
  assert.equal(typeSlot.candidates, 3, "the value exports must not be sites for the type row");
  assert.equal(typeSlot.exceptions.length, 0, "an idiomatic PascalCase type export is not a violation of its own row");
});

test("a mixed area lets the class claim and the function claim disagree on casing", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const files = [
    ...Array.from({ length: 5 }, (_, i) => ({
      rel: `src/Model${i}.ts`,
      ok: true,
      hits: { exported_class_case: [{ conforming: false, where: `Model${i}`, class: "PascalCase" }] },
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      rel: `src/helper${i}.ts`,
      ok: true,
      hits: { exported_symbol_case: [{ conforming: false, where: `helper${i}`, class: "camelCase" }] },
    })),
  ];
  const area = { langs: ["js"], files: files.map((f) => ({ rel: f.rel, lang: "js" })) };
  const dims = reduceArea(area, files);
  assert.equal(dims.find((d) => d.key === "exported_class_case").learned, "PascalCase");
  assert.equal(dims.find((d) => d.key === "exported_symbol_case").learned, "camelCase");
});

/* --- a learned class matching the model's own class is map-noise --- */

test("a learned class equal to the model default renders as counts", () => {
  const r = verdictFor(gatedDim({ learned: "camelCase", learnedClasses: true }), {
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
    defaultSide: () => null,
    defaultClass: () => "camelCase",
  });
  assert.equal(r.states, "claim");
  assert.equal(r.matchesDefault, true);
});

test("a learned class the model does not write keeps stating", () => {
  const r = verdictFor(gatedDim({ learned: "snake_case", learnedClasses: true }), {
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
    defaultClass: () => "camelCase",
  });
  assert.equal(r.matchesDefault, false);
});

/* --- the filter must fire through the real pipeline, not a hand-built record --- */

test("a learned class equal to the model default is flagged through reduceArea itself", async () => {
  const { reduceArea, verdictFor } = await import("../lib/reduce.mjs");
  const rels = Array.from({ length: 40 }, (_, i) => `src/mod${i}.ts`);
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: { function_naming_case: [{ conforming: false, where: "fetchAll", class: "camelCase" }] },
  }));
  const slot = reduceArea(area, parsed).find((d) => d.key === "function_naming_case");
  assert.equal(slot.learned, "camelCase");
  const r = verdictFor(slot, {
    current: { fileCount: 40, dirCount: 1 },
    authors: 3,
    defaultClass: (key) => (key === "function_naming_case" ? "camelCase" : null),
  });
  assert.equal(r.states, "claim");
  assert.equal(r.matchesDefault, true, "the record reduceArea builds must reach the class branch");
});

test("a learned row may never carry a counter, by load-time throw", async () => {
  const { assertLearnedRows } = await import("../lib/dimensions.mjs");
  assert.throws(
    () => assertLearnedRows([{ key: "x", learnedClasses: true, claim: "y are <style>", counterClaim: "no" }]),
    /counter/
  );
  assert.throws(
    () => assertLearnedRows([{ key: "x", learnedClasses: true, claim: "no placeholder", counterClaim: null }]),
    /<style>/
  );
});

/* --- a timestamp prefix is not part of the name (#33) --- */

test("a leading digit run and its separator are cut before the stem is classified", async () => {
  const { classifyBasename } = await import("../lib/dimensions-naming.mjs");
  assert.equal(classifyBasename("db/migrate/20260816120000_add_bad_column.rb"), "snake_case");
  assert.equal(classifyBasename("db/migrate/20260816120000_AddBadColumn.rb"), "PascalCase", "the violating shape must classify, or the check cannot see it");
  assert.equal(classifyBasename("db/migrate/20260816120000_addBadColumn.rb"), "camelCase");
  assert.equal(classifyBasename("db/migrate/001-create-users.rb"), "kebab-case");
  assert.equal(classifyBasename("src/v2Client.ts"), "camelCase", "a digit inside a word is part of the word");
  assert.equal(classifyBasename("src/404.ts"), null, "digits alone name nothing");
});

/* --- the classifier is linear on hostile identifiers --- */

test("classifyWord answers a long uppercase run followed by a non-word in linear time", async () => {
  const { classifyWord } = await import("../lib/dimensions-naming.mjs");
  // The camelCase pattern used to carry `(?:[A-Z][a-zA-Z0-9]*)+`, whose
  // uppercase runs split ambiguously; 28 characters measured six seconds.
  const hostile = "a" + "A".repeat(40) + "!";
  const t = Date.now();
  assert.equal(classifyWord(hostile), null);
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
  // The behaviour the pattern encodes still holds on the shapes that matter.
  assert.equal(classifyWord("fooBar"), "camelCase");
  assert.equal(classifyWord("fooBARBaz"), "camelCase");
  assert.equal(classifyWord("v2Client"), "camelCase");
  assert.equal(classifyWord("FooBar"), "PascalCase");
  assert.equal(classifyWord("foo"), null);
  assert.equal(classifyWord("FOO"), "PascalCase");
});

/* --- the class a declared type name's prefix votes for --- */

test("prefixClass reads a leading capital only where a second capital and a lowercase follow", async () => {
  const { prefixClass } = await import("../lib/dimensions-naming.mjs");
  assert.equal(prefixClass("IFoo"), "I");
  assert.equal(prefixClass("TCommentAuthor"), "T");
  assert.equal(prefixClass("Comment"), "none");
  assert.equal(prefixClass("IO"), "none", "a two-letter acronym is a word, not a prefix");
  assert.equal(prefixClass("IOStream"), "none", "and neither is a three-letter one");
  assert.equal(prefixClass("iFoo"), "none");
});

/* --- the base a class names --- */

test("extends_base votes with the superclass as it is written", async () => {
  const h = await astHits("extends_base", `
    class A extends B {}
    class C extends React.Component {}
    const D = class extends Foo.Bar.Baz {}
    class E {}
  `);
  assert.deepEqual(h.map((x) => x.class), ["B", "React.Component", "Foo.Bar.Baz"]);
  assert.equal(h[0].where, "A");
});

test("a computed superclass names nothing and is not a site", async () => {
  const h = await astHits("extends_base", `class A extends bases[0] {}`);
  assert.equal(h.length, 0);
});

/* --- the prefix on a declared type name --- */

test("interface_prefix and type_alias_prefix vote per declared name", async () => {
  const i = await astHits("interface_prefix", `
    interface IFoo { a: string }
    interface Comment { a: string }
    interface IO { a: string }
  `);
  assert.deepEqual(i.map((x) => x.class), ["I", "none", "none"]);
  const t = await astHits("type_alias_prefix", `
    type TBar = 1
    type Plain = 2
  `);
  assert.deepEqual(t.map((x) => x.class), ["T", "none"]);
  assert.equal(t[0].where, "TBar");
});

test("an interface is not a type alias and neither row answers for the other", async () => {
  assert.equal((await astHits("type_alias_prefix", `interface IFoo { a: string }`)).length, 0);
  assert.equal((await astHits("interface_prefix", `type TBar = 1`)).length, 0);
});

/* --- the Ruby half of the same two questions --- */

const dir = mkdtempSync(join(tmpdir(), "anatomiya-naming-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

async function rubyHits(key, src) {
  const { parseRuby } = await import("../lib/ruby.mjs");
  const { RUBY_DIMENSIONS } = await import("../lib/dimensions-ruby.mjs");
  const abs = join(dir, `${key}.rb`);
  writeFileSync(abs, src);
  const file = (await parseRuby([{ rel: `${key}.rb`, abs }])).results[0];
  assert.ok(file && file.ok, `the fixture did not parse: ${file && file.error}`);
  const hits = [];
  RUBY_DIMENSIONS.find((d) => d.key === key).run(file.program, (h) => hits.push(h));
  return hits;
}

test("class_base votes with the superclass a Ruby class names", needsRuby, async () => {
  const h = await rubyHits("class_base", `
class A < ApplicationController
end

class B < ActionController::Base
end

class C
end
`);
  assert.deepEqual(h.map((x) => x.class), ["ApplicationController", "ActionController::Base"]);
  assert.equal(h[0].where, "A");
});

test("module_include votes with each constant a class or module body includes", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class W
  include Sidekiq::Worker
  include Comparable
end

module M
  include Enumerable
end

class Late
  def go
    include Foo
  end
end

include TopLevel
`);
  // `Late` declares no mixin and is a site carrying no vote, which is its own
  // test; a method body and the top level are not bodies and vote either way.
  assert.deepEqual(h.filter((x) => x.class).map((x) => x.class), ["Sidekiq::Worker", "Comparable", "Enumerable"]);
  assert.equal(h[0].where, "W");
});

test("module_include groups the constants one class body includes", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class W
  include A, B
  include C
end

class X
  include A
end
`);
  assert.deepEqual(h.map((x) => x.class), ["A", "B", "C", "A"]);
  assert.equal(new Set(h.slice(0, 3).map((x) => x.group)).size, 1, "one body is one group");
  assert.notEqual(h[3].group, h[0].group, "a second body is a second group");
});

// The row's predicate says the body is one site, and the walk only reached a
// body that already had an include, so the omitted include was invisible: the
// violation an agent actually commits passed clean.
test("module_include counts a body that includes nothing as a site", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class W
  include Sidekiq::Worker
end

class Forgot
end
`);

  assert.deepEqual(h.map((x) => x.where), ["W", "Forgot"]);
  assert.equal(h[1].class, undefined, "a body that includes nothing votes for no class");
  assert.notEqual(h[1].group, h[0].group, "the bare body is its own site");
});

test("a body whose only include sits inside a method declares no mixin", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class Late
  def go
    include Foo
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["Late", undefined]]);
});

test("a bare class inside another body is its own site, and the outer class is too", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class Outer
  class Inner
    include A
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["Outer", undefined], ["Inner", "A"]]);
  assert.equal(new Set(h.map((x) => x.group)).size, 2);
});

// Namespacing is what a module is for. Counting a bare one as a forgotten
// include put forem's `app/workers` at 88 of 176 and suppressed a claim that
// was true of every worker in it: the 88 extra bodies were `module Users`
// wrappers, not workers missing a mixin.
test("a module that declares no include is namespacing, not a site", needsRuby, async () => {
  const h = await rubyHits("module_include", `
module Users
  class DeleteWorker
    include Sidekiq::Job
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["DeleteWorker", "Sidekiq::Job"]]);
});

// A subclass can receive the mixin through its base, so its bare body is not
// evidence of a forgotten include. Counting it read forem's `app/workers` at
// 88 of 97, and all nine were `< BustCacheBaseWorker`, which carries the job
// mixin for them. The same reasoning class_base states in the other direction.
test("a class naming a superclass is not a forgotten include, because the base may carry it", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class AWorker
  include Sidekiq::Job
end

class BustCacheWorker < BustCacheBaseWorker
  def perform
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["AWorker", "Sidekiq::Job"]]);
});

// A class inside a class is that class's own helper, not a peer of the ones the
// directory's claim is about. Discourse's `Chat::Channel::Policy::MessageCreation`
// holds a bare `class Strategy`, and counting it made the policy object read as
// a service that forgot `Service::Base`. A class inside a module is namespaced,
// not owned, so it stays a subject.
test("a class nested in another class is that class's helper, not a forgotten include", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class Policy < Service::PolicyBase
  class Strategy
    def call
    end
  end
end

module Chat
  class Destroyer
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["Chat::Destroyer", undefined]]);
});

// The predicate says "names no superclass". Reading the superclass through
// `constName` made every computed base read as none, so `Struct.new` and
// `Data.define` classes were reported as forgetting an include their base may
// carry.
test("a class whose superclass is a call still names a superclass", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class Point < Struct.new(:x, :y)
end

class Coord < Data.define(:x, :y)
end
`);

  assert.deepEqual(h, []);
});

// `prepend` puts the module ahead of the class in the ancestry instead of
// behind it. The body declared the mixin either way, so it has not forgotten
// one.
test("a body that prepends a module has not forgotten an include", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class PWorker
  prepend Sidekiq::Worker
end
`);

  assert.deepEqual(h, []);
});

// One class, written in two parts. The second part is the same class as the
// first, and the first is where it declares its mixins.
test("a class reopened in the same file is one body, not a bare second one", needsRuby, async () => {
  const h = await rubyHits("module_include", `
class BWorker
  include Sidekiq::Worker
end

class BWorker
  def perform
  end
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["BWorker", "Sidekiq::Worker"]]);
});

// Two classes of the same short name under different namespaces are two
// bodies. Told apart by the short name alone they fingerprint alike, and the
// finding lands on whichever the branch did not touch.
test("a bare body is named by its whole path, not by its last segment", needsRuby, async () => {
  const h = await rubyHits("module_include", `
module A
  class Worker
  end
end

module B
  class Worker
  end
end
`);

  assert.deepEqual(h.map((x) => x.where), ["A::Worker", "B::Worker"]);
});

test("a module that declares an include is still a site, because it composed one", needsRuby, async () => {
  const h = await rubyHits("module_include", `
module M
  include Enumerable
end
`);

  assert.deepEqual(h.map((x) => [x.where, x.class]), [["M", "Enumerable"]]);
});

/* --- the five rows ship --- */

test("the five learned rows are reachable from the registry", async () => {
  const { dimensionsFor } = await import("../lib/dimensions.mjs");
  const js = dimensionsFor(["js"]).map((d) => d.key);
  for (const key of ["extends_base", "interface_prefix", "type_alias_prefix"]) {
    assert.ok(js.includes(key), `${key} is not offered to JavaScript`);
  }
  const ruby = dimensionsFor(["ruby"]).map((d) => d.key);
  for (const key of ["class_base", "module_include"]) {
    assert.ok(ruby.includes(key), `${key} is not offered to Ruby`);
  }
});

/* --- a learned class that is repository text, and one that is an absence --- */

const learnedSlot = async (key, cls, lang = "js") => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const rels = Array.from({ length: 6 }, (_, i) => `src/mod${i}.${lang === "ruby" ? "rb" : "ts"}`);
  const area = { langs: [lang], files: rels.map((rel) => ({ rel, lang })) };
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: { [key]: [{ conforming: false, where: "X", class: cls }] },
  }));
  return reduceArea(area, parsed).find((d) => d.key === key);
};

test("a learned class taken from repository text is encoded into the claim", async () => {
  const slot = await learnedSlot("extends_base", "Base|X");
  assert.equal(slot.learned, "Base|X", "the record keeps what was measured");
  assert.equal(slot.claim, "classes here extend Base X", "the sentence carries no table cell boundary");
});

test("a Ruby superclass reaches the claim through the same encoder", async () => {
  const slot = await learnedSlot("class_base", "Application`Controller", "ruby");
  assert.equal(slot.claim, "classes here inherit Application Controller");
});

test("a prefix row that learned none states the absence instead of filling the template", async () => {
  const none = await learnedSlot("interface_prefix", "none");
  assert.equal(none.claim, "interfaces carry no prefix");
  const prefixed = await learnedSlot("interface_prefix", "I");
  assert.equal(prefixed.claim, "interfaces are named with a I prefix");
  assert.equal((await learnedSlot("type_alias_prefix", "none")).claim, "type aliases carry no prefix");
});

/* --- an area that prefixes nothing has said what the model already writes --- */

test("none is the model's own prefix class, so an unprefixed area prints as counts", async () => {
  const { defaultClassFor } = await import("../lib/model-defaults.mjs");
  assert.equal(defaultClassFor("interface_prefix"), "none");
  assert.equal(defaultClassFor("type_alias_prefix"), "none");
  const r = verdictFor(gatedDim({ key: "interface_prefix", learned: "none", learnedClasses: true }), {
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.states, "claim");
  assert.equal(r.matchesDefault, true);
});

test("an area that does prefix its interfaces states the prefix", () => {
  const r = verdictFor(gatedDim({ key: "interface_prefix", learned: "I", learnedClasses: true }), {
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.matchesDefault, false);
});

test("a class read off the source has no model default, so the row keeps stating", async () => {
  const { defaultClassFor } = await import("../lib/model-defaults.mjs");
  for (const key of ["extends_base", "class_base", "module_include"]) {
    assert.equal(defaultClassFor(key), null, `${key} cannot have a default the model writes`);
  }
});
