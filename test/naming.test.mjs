import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectHits } from "../plugins/anatomiya/lib/walk.mjs";
import { learnClass, verdictFor } from "../plugins/anatomiya/lib/reduce.mjs";
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { classifyBasename } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");
  assert.equal(classifyBasename("src/user-profile.ts"), "kebab-case");
  assert.equal(classifyBasename("src/userProfile.ts"), "camelCase");
  assert.equal(classifyBasename("src/UserProfile.tsx"), "PascalCase");
  assert.equal(classifyBasename("app/models/user_profile.rb"), "snake_case");
  assert.equal(classifyBasename("src/index.ts"), null, "a single lowercase word matches every class");
  assert.equal(classifyBasename("Rakefile"), null, "a bare filename is its own convention");
  assert.equal(classifyBasename("src/OrderList.stories.tsx"), "PascalCase", "only the stem is read");
});

test("an area of mostly kebab files states the learned class over every classifiable file", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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

/* --- the sites the classifier declines to vote on (A41) --- */

test("a site whose stem spells no class is counted as declined, not silently dropped", async () => {
  // `classify` answers null for two different files and only one of them is a
  // non-site. A stem spelling none of the four is a site with no vote, so it
  // leaves the printed population while `check` still enforces over it, and a
  // bare `N of N` then reads as a population it never held.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = [
    "src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts",
    "src/form-input.ts", "src/nav-bar.ts", "src/date-utils.ts", "src/error-page.ts",
    "src/big-table.ts",
    "src/add__price_updates.ts", "src/TMP_PROBE.ts",
  ];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.candidates, 9, "the nine that voted");
  assert.equal(slot.conforming, 9, "and every one of them agreed");
  assert.equal(slot.declined, 2, "and the two that are sites with no vote are counted, not dropped");
});

test("an area where every site voted carries no declined count at all", async () => {
  // Absent rather than zero, the way a syntax row carries no companion side: a
  // key on every record of every area is bytes on disk for a fact nobody prints.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal("declined" in slot, false);
});

test("a declined name on the side the row narrowed away is not counted either", async () => {
  // The row learns over one kind of file and the other kind leaves the
  // population. A count that did not leave with it would name a file the
  // sentence above it does not speak about: "files here that hold no JSX are
  // named kebab-case" disclosing a name from the JSX side.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = [
    "src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts",
    "src/form-input.ts", "src/nav-bar.ts", "src/date-utils.ts", "src/error-page.ts",
    "src/TMP_PROBE.tsx",
  ];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: rel.endsWith(".tsx") } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.learnedKind, "module", "the eight module files are the side it learned over");
  assert.equal("declined" in slot, false, "and the one declined name sits on the side that left");
});

test("a file that is no site at all is not counted as declined", async () => {
  // `index.ts` matches every class at once and `Rakefile` has no stem to read.
  // Neither disagrees with anything, so neither is a site and neither is a fact
  // the reader is owed.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = [
    "src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts",
    "src/index.ts",
  ];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.candidates, 4);
  assert.equal("declined" in slot, false);
});

test("a naming tie produces no slot at all", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/orderList.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));
  assert.equal(reduceArea(area, parsed).find((d) => d.key === "file_naming_case"), undefined);
});

/* --- the AST naming rows --- */

const astHits = async (key, src) => {
  const { parseSync } = await import("oxc-parser");
  const { NAMING_AST } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");
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

test("a default export that names what it declares is a site", async () => {
  // One class per file, default-exported, is the ordinary shape for a React
  // component, and none of it was visible. On a six-class repository where
  // five are default-exported PascalCase, the one named-export outlier was the
  // whole evidence base and the row stated the opposite of the convention.
  const h = await astHits("exported_class_case", `
    export default class Header {}
  `);
  assert.deepEqual(h.map((x) => x.where), ["Header"]);

  const anon = await astHits("exported_class_case", `
    export default class {}
  `);
  assert.deepEqual(anon, [], "an anonymous default export names nothing and is still not a site");
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

test("an anonymous default export, a namespace, and a renaming specifier answer none of the three rows", async () => {
  // A default export used to be skipped whole. It names what it declares often
  // enough that skipping it left a repository of default-exported components
  // speaking through whichever one file used a named export instead, so only
  // the anonymous one is out now.
  const src = `
    export default function () {}
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
  const { dimensionsFor } = await import("../plugins/anatomiya/lib/dimensions.mjs");
  const keys = dimensionsFor(["js"]).map((d) => d.key);
  for (const key of ["function_naming_case", "exported_symbol_case", "exported_class_case", "exported_type_case"]) {
    assert.ok(keys.includes(key), key);
  }
});

/* --- the three exported-name populations are judged apart, never against
   each other: a defect shown on typeorm and mastodon by planting a change and
   running the real CLI (percheck-fixes task 8) --- */

test("a class-only area's class row ignores a planted function, whichever way the function is cased (typeorm shape)", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { reduceArea, verdictFor } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { assertLearnedRows } = await import("../plugins/anatomiya/lib/dimensions.mjs");
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
  const { classifyBasename } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");
  assert.equal(classifyBasename("db/migrate/20260816120000_add_bad_column.rb"), "snake_case");
  assert.equal(classifyBasename("db/migrate/20260816120000_AddBadColumn.rb"), "PascalCase", "the violating shape must classify, or the check cannot see it");
  assert.equal(classifyBasename("db/migrate/20260816120000_addBadColumn.rb"), "camelCase");
  assert.equal(classifyBasename("db/migrate/001-create-users.rb"), "kebab-case");
  assert.equal(classifyBasename("src/v2Client.ts"), "camelCase", "a digit inside a word is part of the word");
  assert.equal(classifyBasename("src/404.ts"), null, "digits alone name nothing");
});

/* --- the classifier is linear on hostile identifiers --- */

test("classifyWord answers a long uppercase run followed by a non-word in linear time", async () => {
  const { classifyWord } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");
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

test("prefixClass answers for a name that can say, and says nothing for one that cannot", async () => {
  const { prefixClass } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");
  assert.equal(prefixClass("IFoo"), "I");
  assert.equal(prefixClass("TCommentAuthor"), "T");
  assert.equal(prefixClass("Comment"), "none");
  assert.equal(prefixClass("iFoo"), "none");
  // Three leading capitals reads both ways and the classifier cannot tell
  // which: `IEFLogon` is `I` on the `EFLogon` of the directory it sits in, and
  // `IOStream` is an acronym carrying no prefix. Charged as a violation, the
  // only way to comply was to write `IIEFLogon`.
  assert.equal(prefixClass("IO"), null, "a two-letter acronym cannot say");
  assert.equal(prefixClass("IOStream"), null, "and neither can a three-letter one");
  assert.equal(prefixClass("IEFLogon"), null);
  assert.equal(prefixClass("TEFLogonStep"), null);
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
  // Two hits, not three: a name the classifier cannot read is not a site, the
  // way every other row here already skips a name that classifies to null.
  assert.equal(i.length, 2);
  assert.deepEqual(i.map((x) => x.class), ["I", "none"]);
  const t = await astHits("type_alias_prefix", `
    type TBar = 1
    type Plain = 2
    type TEFLogonStep = 3
  `);
  assert.equal(t.length, 2);
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
  const { parseRuby } = await import("../plugins/anatomiya/lib/ruby.mjs");
  const { RUBY_DIMENSIONS } = await import("../plugins/anatomiya/lib/dimensions-ruby.mjs");
  const abs = join(dir, `${key}.rb`);
  writeFileSync(abs, src);
  const file = (await parseRuby([{ rel: `${key}.rb`, abs }])).results[0];
  assert.ok(file && file.ok, `the fixture did not parse: ${file && file.error}`);
  const hits = [];
  RUBY_DIMENSIONS.find((d) => d.key === key).run(file.program, (h) => hits.push(h));
  return hits;
}

test("class_base votes with the superclass a Ruby class names, and a bare class votes for none", needsRuby, async () => {
  // The bare class is a site conforming to no base: the omission is what an
  // agent actually commits, a PORO dropped into a directory of models.
  const h = await rubyHits("class_base", `
class A < ApplicationController
end

class B < ActionController::Base
end

class C
end
`);
  assert.deepEqual(h.map((x) => x.class ?? null), ["ApplicationController", "ActionController::Base", null]);
  assert.equal(h[0].where, "A");
  assert.equal(h[2].where, "C");
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
  const { dimensionsFor } = await import("../plugins/anatomiya/lib/dimensions.mjs");
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
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
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
  const { defaultClassFor } = await import("../plugins/anatomiya/lib/model-defaults.mjs");
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
  const { defaultClassFor } = await import("../plugins/anatomiya/lib/model-defaults.mjs");
  for (const key of ["extends_base", "class_base", "module_include"]) {
    assert.equal(defaultClassFor(key), null, `${key} cannot have a default the model writes`);
  }
});

test("namesASite separates a name that matches every class from one that matches none", async () => {
  // `classifyBasename` answers null for both, and only the first is not a site.
  // A name matching every class cannot disagree with any; a name matching none
  // disagrees with all of them, and it was the violation the check could not see.
  const { namesASite } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");

  assert.equal(namesASite("src/index.ts"), false, "a single lowercase word matches every class");
  assert.equal(namesASite("Rakefile"), false, "a bare filename has no stem to read");
  assert.equal(namesASite("src/404.ts"), false, "digits alone name nothing to disagree with");
  assert.equal(namesASite("db/migrate/20260816120000.rb"), false, "and a timestamp is a digit run");

  assert.equal(namesASite("app/models/TMP_PROBE_UPPER.rb"), true, "SCREAMING_SNAKE spells no class");
  assert.equal(namesASite("app/models/_tmp_probe.rb"), true, "and neither does a leading underscore");
  assert.equal(namesASite("src/user-profile.ts"), true, "a name that spells one is a site too");
  assert.equal(namesASite("src/index.stories.tsx"), false, "only the stem is read, and it is one word");
});

test("a name that spells no class does not vote for one", async () => {
  // The scan side is unchanged: a stem that classifies to null was never
  // counted into the area's own totals, and counting it now would move every
  // learned class in the corpus.
  const { classifyBasename } = await import("../plugins/anatomiya/lib/dimensions-naming.mjs");

  assert.equal(classifyBasename("app/models/TMP_PROBE_UPPER.rb"), null);
  assert.equal(classifyBasename("app/models/_tmp_probe.rb"), null);
});

test("an interface inside an ambient module or a namespace does not vote on the prefix", async () => {
  // The name is the identity of the thing being augmented, so the prefix is not
  // available: `IWindow` compiles and the merge silently stops happening, and
  // `tsc --strict` then reports the property missing at the use site rather
  // than anything at the declaration. 24 of one repository's 40 non-conforming
  // interface names were augmentations. Same ancestor test C12 already applies
  // to module_state_const.
  const hits = await astHits("interface_prefix", `
    declare global {
      interface Window { dataLayer: unknown[] }
    }
    declare module "axios" {
      interface AxiosRequestConfig { retries?: number }
    }
    interface IThing { a: string }
  `);

  assert.deepEqual(hits.map((h) => h.where), ["IThing"]);
});

test("a type alias inside a module augmentation still votes, because it cannot merge", async () => {
  // `tsc` accepts `export type TTheme` inside a module augmentation, so the
  // prefix really is available there.
  const hits = await astHits("type_alias_prefix", `
    declare module "styled-components" {
      export type TTheme = { a: string }
    }
  `);

  assert.deepEqual(hits.map((h) => [h.where, h.class]), [["TTheme", "T"]]);
});

/* --- the class an area learned is not a site of its own row (#58) --- */

test("collectHits keeps a hit's own qualified name and omits the key otherwise", async () => {
  const { collectHits } = await import("../plugins/anatomiya/lib/walk.mjs");
  const named = collectHits({ type: "Program", body: [] }, [
    { key: "k", run: (_p, add) => add({ node: null, conforming: false, class: "B", self: "A::B" }) },
  ]);
  const bare = collectHits({ type: "Program", body: [] }, [
    { key: "k", run: (_p, add) => add({ node: null, conforming: false, class: "B" }) },
  ]);

  assert.equal(named.k[0].self, "A::B");
  assert.equal("self" in bare.k[0], false, "a hit with nothing to say costs no bytes over IPC");
});

test("collectHits keeps the scope a bare constant resolves in", async () => {
  // The hits cross a process boundary through this shape, and a key it does not
  // name is dropped. `nesting` was emitted, asserted in unit tests that call the
  // dimension directly, and silently thrown away on every real scan: the base
  // class row went back to counting two spellings as two classes.
  const { collectHits } = await import("../plugins/anatomiya/lib/walk.mjs");
  const scoped = collectHits({ type: "Program", body: [] }, [
    { key: "k", run: (_p, add) => add({ node: null, conforming: false, class: "B", nesting: ["A::V1", "A"] }) },
  ]);
  const top = collectHits({ type: "Program", body: [] }, [
    { key: "k", run: (_p, add) => add({ node: null, conforming: false, class: "B", nesting: [] }) },
  ]);

  assert.deepEqual(scoped.k[0].nesting, ["A::V1", "A"]);
  assert.deepEqual(top.k[0].nesting, [], "the top level is no scope, and not the same as never having said");
});

test("isLearnedItself matches the class an area learned, by either spelling", async () => {
  const { isLearnedItself } = await import("../plugins/anatomiya/lib/reduce.mjs");

  assert.equal(isLearnedItself({ self: "ApplicationRecord" }, "ApplicationRecord"), true);
  assert.equal(isLearnedItself({ self: "Api::V1::BaseController" }, "BaseController"), false, "a name that merely ends in the learned one is a different class");
  assert.equal(isLearnedItself({ self: "Interactions::Base" }, "ActiveInteraction::Base"), false);
  assert.equal(isLearnedItself({ self: "Base" }, "ActiveInteraction::Base"), false, "the last segment alone is too loose");
  assert.equal(isLearnedItself({}, "ApplicationRecord"), false);
  assert.equal(isLearnedItself({ self: "X" }, undefined), false);
});

test("the class an area learned does not count against its own row", async () => {
  // `class ApplicationRecord < ApplicationRecord` is a NameError, and the map
  // printed the absurdity: app/models states "classes here inherit
  // ApplicationRecord" and listed application_record.rb as one of its
  // exceptions.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = ["app/models/application_record.rb", ...Array.from({ length: 8 }, (_, i) => `app/models/m${i}.rb`)];
  const area = { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) };
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: {
      class_base: rel.endsWith("application_record.rb")
        ? [{ conforming: false, class: "ActiveRecord::Base", self: "ApplicationRecord", where: "ApplicationRecord" }]
        : [{ conforming: false, class: "ApplicationRecord", self: rel, where: "M" }],
    },
  }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "class_base");

  assert.equal(slot.learned, "ApplicationRecord");
  assert.equal(slot.candidates, 8, "the base itself is not one of its own sites");
  assert.equal(slot.conforming, 8);
  assert.deepEqual(slot.exceptions, []);
});

/* --- a component's name is JSX's to decide, not the area's (#77 row 8) --- */

test("a function that renders JSX is not judged by the area's naming class", async () => {
  // Lowercase a component and the element becomes a host tag: TS2339, Property
  // 'auditBadge' does not exist on type 'JSX.IntrinsicElements'. The tool's own
  // `isHostElement` reads the same rule from the other side. The row is
  // `precise`, so it reaches MUST-FIX the day one appears.
  const h = await astHits("function_naming_case", `
    export function AuditBadge() { return <span /> }
    export const Panel = () => <div />
    export function useThing() { return 1 }
    export function formatName(x) { return x }
  `);

  assert.deepEqual(h.map((x) => x.where), ["useThing", "formatName"]);
});

test("a component this file only renders is excluded too", async () => {
  // A component exported and rendered elsewhere is the ordinary shape in a
  // components directory, and one rendered here is the same thing.
  const h = await astHits("function_naming_case", `
    function Wrapper() { if (a) return null; return <div /> }
    const Local = () => 1
    export const Page = () => <Local />
  `);

  assert.deepEqual(h.map((x) => x.where), []);
});

test("an ordinary function in a JSX file is still judged", async () => {
  const h = await astHits("function_naming_case", `
    export const Page = () => <div />
    export function fetchAll() { return [] }
  `);

  assert.deepEqual(h.map((x) => x.where), ["fetchAll"]);
});

/* --- a directory of components and a directory of helpers hold different conventions (#64) --- */

test("a naming row learns over one kind of file, and leaves the other kind unjudged", async () => {
  // A React directory holds `UserCard.tsx` beside `formatDate.ts`. The area
  // learns PascalCase off the components and every correctly camelCase helper
  // in it becomes a violation of a convention nobody holds: on one measured
  // pull request a single `.ts` helper collected 5 of the 9 findings, and in a
  // 982-commit replay 29 of 55 false findings were this pooling.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const components = ["UserCard", "OrderList", "DataTable", "FormInput", "NavBar", "ErrorPage", "BigTable", "SidePanel"];
  const helpers = ["formatDate", "parseAmount", "buildQuery"];
  const rels = [
    ...components.map((n) => `src/${n}.tsx`),
    ...helpers.map((n) => `src/${n}.ts`),
  ];
  const area = { langs: ["jsx", "js"], files: rels.map((rel) => ({ rel, lang: rel.endsWith("x") ? "jsx" : "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: rel.endsWith(".tsx") } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.learned, "PascalCase");
  assert.equal(slot.learnedKind, "jsx");
  assert.equal(slot.candidates, 8, "the three helpers left the population");
  assert.equal(slot.conforming, 8);
  assert.deepEqual(slot.exceptions, []);
  assert.ok(!slot.files.some((f) => f.endsWith("formatDate.ts")), JSON.stringify(slot.files));
});

test("the mirror: an area of mostly helpers leaves its two components unjudged", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const helpers = ["formatDate", "parseAmount", "buildQuery", "readCache", "writeCache", "toSlug", "fromSlug", "sumRows", "pickOne"];
  const rels = [...helpers.map((n) => `src/${n}.ts`), "src/UserCard.tsx", "src/OrderList.tsx"];
  const area = { langs: ["jsx", "js"], files: rels.map((rel) => ({ rel, lang: rel.endsWith("x") ? "jsx" : "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: rel.endsWith(".tsx") } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.learned, "camelCase");
  assert.equal(slot.learnedKind, "module");
  assert.equal(slot.candidates, 9);
  assert.deepEqual(slot.exceptions, []);
});

test("an area holding one kind of file is not narrowed at all", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/oneOff.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: false } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.candidates, 4);
  assert.equal(slot.conforming, 3);
  assert.equal(slot.learnedKind, "module");
});

test("a narrowed naming claim names the population it was learned over", async () => {
  // The narrowing is invisible in the sentence the agent reads, and the area
  // file loads on the files the population excluded: a directory of 45 helpers
  // beside 12 components delivered "files here are named camelCase" to the
  // components, and naming one of those camelCase turns the element into a host
  // tag. The check does not catch it, because the row does not judge that kind.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const components = ["UserCard", "OrderList", "DataTable", "FormInput", "NavBar", "ErrorPage", "BigTable", "SidePanel"];
  const helpers = ["formatDate", "parseAmount", "buildQuery"];
  const rels = [...components.map((n) => `src/${n}.tsx`), ...helpers.map((n) => `src/${n}.ts`)];
  const area = { langs: ["jsx", "js"], files: rels.map((rel) => ({ rel, lang: rel.endsWith("x") ? "jsx" : "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: rel.endsWith(".tsx") } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.claim, "files here that hold JSX are named PascalCase");
});

test("the mirror: the module side names the population too", async () => {
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const helpers = ["formatDate", "parseAmount", "buildQuery", "readCache", "writeCache", "toSlug", "fromSlug", "sumRows", "pickOne"];
  const rels = [...helpers.map((n) => `src/${n}.ts`), "src/UserCard.tsx", "src/OrderList.tsx"];
  const area = { langs: ["jsx", "js"], files: rels.map((rel) => ({ rel, lang: rel.endsWith("x") ? "jsx" : "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: rel.endsWith(".tsx") } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.claim, "files here that hold no JSX are named camelCase");
});

test("an area that holds one kind of file keeps the plain sentence", async () => {
  // The exclusion is worth naming only where it excluded something: a
  // repository with no JSX in it reads the qualifier as a distinction its code
  // does not draw.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/type-check.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {}, facets: { jsx: false } }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "file_naming_case");

  assert.equal(slot.learnedKind, "module", "still narrowed, so a component added later is not judged");
  assert.equal(slot.claim, "files here are named kebab-case");
});

test("a class that merely shares its last segment with the learned base is still a site", async () => {
  // A suffix match exempted `Api::V1::Admin::BaseController` under a learned
  // `BaseController`, and it fired even where that class named an explicit and
  // different superclass, which the "a base cannot inherit itself" argument
  // cannot justify. Telling the two apart needs Ruby's own constant lookup.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = [
    "app/controllers/api/v1/base_controller.rb",
    "app/controllers/api/v1/admin/base_controller.rb",
    ...Array.from({ length: 8 }, (_, i) => `app/controllers/api/v1/c${i}_controller.rb`),
  ];
  const area = { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) };
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: {
      class_base: rel.endsWith("api/v1/base_controller.rb")
        ? [{ conforming: false, class: "ApplicationController", self: "BaseController", where: "BaseController" }]
        : rel.endsWith("admin/base_controller.rb")
          ? [{ conforming: false, class: "ActionController::Metal", self: "Api::V1::Admin::BaseController", where: "BaseController" }]
          : [{ conforming: false, class: "BaseController", self: rel, where: "C" }],
    },
  }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "class_base");

  assert.equal(slot.learned, "BaseController");
  assert.equal(slot.candidates, 9, "the area's own base leaves, the namesake does not");
  assert.equal(slot.conforming, 8);
  assert.deepEqual(slot.exceptions.map((e) => e.path), ["app/controllers/api/v1/admin/base_controller.rb"]);
});

test("a superclass written relative to its enclosing namespace is the class it resolves to", async () => {
  // empire-flippers/api: 55 controllers under app/controllers/api/v1 write
  // `< Api::V1::BaseController` and four write `< BaseController` from inside
  // `module Api::V1`, where Ruby resolves the bare name to the same class.
  // Counted as two classes the row read 55 of 64 and fell under the 0.90 gate,
  // so the strongest fact in the largest controller area went unstated.
  const { sameConstant } = await import("../plugins/anatomiya/lib/reduce.mjs");

  assert.equal(sameConstant("BaseController", "Api::V1::BaseController", ["Api::V1", "Api"]), true);
  assert.equal(sameConstant("Api::V1::BaseController", "Api::V1::BaseController", ["Api::V1", "Api"]), true);
  assert.equal(
    sameConstant("BaseController", "Api::V1::BaseController", ["Api::V2", "Api"]),
    false,
    "a nesting that does not hold the learned class resolves somewhere else"
  );
  assert.equal(
    sameConstant("ApplicationController", "Api::V1::BaseController", ["Api::V1"]),
    false,
    "a different name is a different class however it is nested"
  );
  assert.equal(
    sameConstant("Api::V1::ChromeExtension::BaseController", "Api::V1::BaseController", ["Api::V1"]),
    false,
    "a scoped name already says which class it means"
  );
});

test("a controller area counts the relative and the scoped spelling as one base", async () => {
  // The 59-of-64 shape from empire-flippers/api, reduced to its smallest form:
  // above the 0.90 gate together, under it counted apart.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const scoped = Array.from({ length: 8 }, (_, i) => `app/controllers/api/v1/s${i}.rb`);
  const relative = ["app/controllers/api/v1/qbo_controller.rb", "app/controllers/api/v1/notes_controller.rb"];
  const rels = [...scoped, ...relative];
  // `module Api::V1; class QboController`, which is how the four relative ones
  // are written: the nesting is what the bare superclass resolves against.
  const className = (rel) => `Api::V1::${rel.slice(rel.lastIndexOf("/") + 1, -3)}`;
  const area = { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) };
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: {
      class_base: [
        relative.includes(rel)
          ? { conforming: false, class: "BaseController", self: className(rel), nesting: ["Api::V1", "Api"], where: "X" }
          : { conforming: false, class: "Api::V1::BaseController", self: className(rel), nesting: ["Api::V1", "Api"], where: "X" },
      ],
    },
  }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "class_base");

  assert.equal(slot.learned, "Api::V1::BaseController");
  assert.equal(slot.candidates, 10);
  assert.equal(slot.conforming, 10, "all ten name the same base, in two spellings");
});

test("a compact class name resolves its superclass at the top level, not inside itself", async () => {
  // Ruby evaluates the superclass expression in the scope the class is written
  // in. `class Api::V1::Qbo < BaseController` is written at the top level, so
  // the bare name is `::BaseController`; only bodies actually nested in
  // `module Api::V1` resolve it to `Api::V1::BaseController`. The site's own
  // qualified name cannot tell the two apart, because both read back alike.
  const { sameConstant } = await import("../plugins/anatomiya/lib/reduce.mjs");

  assert.equal(sameConstant("BaseController", "Api::V1::BaseController", ["Api::V1", "Api"]), true);
  assert.equal(
    sameConstant("BaseController", "Api::V1::BaseController", []),
    false,
    "written at the top level, the bare name is the top-level class"
  );
  assert.equal(sameConstant("BaseController", "Api::V1::BaseController", ["Api"]), false);
});

test("a grouped row resolves a relative mixin the way the superclass row does", async () => {
  // `module_include` counts one site per body, so it folds through `groupSites`
  // rather than the per-hit path, and the resolution has to reach both.
  const { reduceArea } = await import("../plugins/anatomiya/lib/reduce.mjs");
  const rels = Array.from({ length: 10 }, (_, i) => `app/models/concerns/m${i}.rb`);
  const area = { langs: ["ruby"], files: rels.map((rel) => ({ rel, lang: "ruby" })) };
  const relative = new Set([rels[0], rels[1]]);
  const parsed = rels.map((rel) => ({
    rel,
    ok: true,
    hits: {
      module_include: [
        {
          conforming: false,
          class: relative.has(rel) ? "Trackable" : "Api::V1::Trackable",
          nesting: ["Api::V1", "Api"],
          group: 1,
          where: "X",
        },
      ],
    },
  }));

  const slot = reduceArea(area, parsed).find((d) => d.key === "module_include");

  assert.equal(slot.learned, "Api::V1::Trackable");
  assert.equal(slot.conforming, 10, "both spellings name the module the nesting resolves to");
});
