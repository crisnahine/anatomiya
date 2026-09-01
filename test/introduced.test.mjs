import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSync } from "oxc-parser";

import { needsRuby } from "./ruby-available.mjs";
import { bodyIdentity, newlyIntroduced, siteIdentity } from "../plugins/anatomiya/lib/introduced.mjs";
import { parseRuby } from "../plugins/anatomiya/lib/ruby.mjs";
import { rowByKey } from "../plugins/anatomiya/lib/registry.mjs";

/** One revision of a file, parsed the way the check hands it over: the tree, the same string, the comments. */
function revision(src, { file = "f.tsx", jsx = file.endsWith("x"), stripped = false } = {}) {
  const { program, comments } = parseSync(file, src, { sourceType: "module" });
  return { program, source: src, comments: comments ?? [], stripped, facets: { jsx } };
}

/** An area holding the slots given, the way the facts record spells one. */
const area = (...dimensions) => ({ path: "src", globs: ["src/**"], dimensions });
const stated = (key, over = {}) => ({ key, directive: true, states: "claim", ...over });

/**
 * The sites of one row. The module answers for every row of the language and
 * leaves it to the check to drop the rows the area holds no slot for, since
 * that lookup is also what decides a site's severity.
 */
const only = (key, found) => found.filter((f) => f.dimension === key);

const judge = (over) =>
  only("handler_is_named", newlyIntroduced({ area: area(stated("handler_is_named")), path: "src/a.jsx", lang: "jsx", ...over }));

/* --- identity --- */

test("a site's identity is the node type and the normalised slice, never the line", () => {
  // Two literals verified by hand against sha256 of the four parts joined by NUL,
  // truncated to sixteen hex characters. Recomputing them here would make the
  // test agree with whatever the module does.
  assert.equal(siteIdentity("src/a.ts", "hook_call_style", { type: "Identifier", start: 0, end: 8 }, "useState"), "048f55c3113cbd87");
  assert.equal(
    siteIdentity("src/a.ts", "hook_call_style", { type: "Identifier", start: 0, end: 11 }, "use\n  State"),
    siteIdentity("src/a.ts", "hook_call_style", { type: "Identifier", start: 0, end: 9 }, "use State"),
    "whitespace inside the slice is one space"
  );
  assert.notEqual(
    siteIdentity("src/a.ts", "hook_call_style", { type: "Identifier", start: 0, end: 8 }, "useState"),
    siteIdentity("src/b.ts", "hook_call_style", { type: "Identifier", start: 0, end: 8 }, "useState"),
    "the path is part of it"
  );
});

test("a node reporting no offsets is identified by its name, whatever line it sits on", () => {
  // prism reports no byte offsets (B5), so a Ruby site has only its name.
  const at = (line) => siteIdentity("app/w.rb", "class_base", { type: "ConstantReadNode", name: "Base", line }, "class X < Base\nend\n");
  assert.equal(at(3), at(30));
  assert.match(at(3), /^[0-9a-f]{16}$/);
});

test("a body's identity is its sorted constants, and a bare body is named after where it sits", () => {
  assert.equal(bodyIdentity("app/w.rb", "module_include", [{ class: "Comparable" }, { class: "A::B" }]), "5ff751cf4cff9d44");
  assert.equal(
    bodyIdentity("app/w.rb", "module_include", [{ class: "Comparable" }, { class: "A::B" }]),
    bodyIdentity("app/w.rb", "module_include", [{ class: "A::B" }, { class: "Comparable" }]),
    "swapping two includes is the same body"
  );
  assert.notEqual(
    bodyIdentity("app/w.rb", "module_include", [{ where: "W" }]),
    bodyIdentity("app/w.rb", "module_include", [{ where: "V" }]),
    "two bodies declaring nothing are told apart by where they are"
  );
});

/* --- what a branch introduced --- */

test("a line shift introduces nothing, and the same file against no base introduces its one site", () => {
  const src = `const A = () => <B onClick={() => save(1)} />;`;
  const shifted = `\n\n${src}`;

  assert.deepEqual(judge({ head: revision(shifted), base: revision(src) }), []);
  const [only, ...rest] = judge({ head: revision(shifted), base: null });
  assert.deepEqual(rest, []);
  assert.equal(only.dimension, "handler_is_named");
  assert.equal(only.claim, "an event handler prop is given a named function, not an inline arrow");
  assert.equal(only.text, "onClick", "the reported node is the attribute name");
  assert.equal(only.line, 3, "the line is on the site for the added-lines mode, and in the identity for nothing");
  assert.match(only.fp, /^[0-9a-f]{16}$/);
});

test("an edit inside a pre-existing inline handler is not a new site", () => {
  const a = revision(`const A = () => <B onClick={() => save(1)} />;`);
  const b = revision(`const A = () => <B onClick={() => save(2)} />;`);

  assert.deepEqual(judge({ head: b, base: a }), []);
});

test("a renamed file is judged under the path it had, so the rename forges nothing", () => {
  const src = revision(`const A = () => <B onClick={() => save(1)} />;`);

  assert.deepEqual(judge({ path: "src/new.jsx", keyPath: "src/old.jsx", head: src, base: src }), []);
  const [only] = judge({ path: "src/new.jsx", keyPath: "src/old.jsx", head: src, base: null });
  assert.equal(only.fp, siteIdentity("src/old.jsx", "handler_is_named", { type: "JSXIdentifier", start: 19, end: 26 }, src.source));
});

test("identical sites are told apart by count: two at the base absorb two at the head, and a third is new", () => {
  const one = revision(`const A = () => <><B onClick={() => x()} /></>;`);
  const two = revision(`const A = () => <><B onClick={() => x()} /><B onClick={() => x()} /></>;`);
  const three = revision(`const A = () => <><B onClick={() => x()} /><B onClick={() => x()} /><B onClick={() => x()} /></>;`);

  assert.equal(judge({ head: two, base: one }).length, 1);
  assert.equal(judge({ head: three, base: two }).length, 1);
  assert.equal(judge({ head: three, base: one }).length, 2);
  assert.deepEqual(judge({ head: two, base: three }), []);
});

/* --- one polarity for both revisions --- */

const functionStyle = rowByKey("function_style");

test("on the counter side the conforming sites are the violations, and the sentence is the counter-claim", () => {
  const counter = area(stated("function_style", { states: "counter", counterClaim: functionStyle.counterClaim }));
  const base = revision(`export const b = () => 1;`, { file: "f.ts" });
  const head = revision(`function a() {}\nexport const b = () => 1;`, { file: "f.ts" });

  const [one, ...rest] = only("function_style", newlyIntroduced({ area: counter, path: "src/a.ts", lang: "js", head, base }));
  assert.deepEqual(rest, []);
  assert.equal(one.where, "a");
  assert.equal(one.claim, functionStyle.counterClaim);

  const claim = area(stated("function_style"));
  assert.deepEqual(only("function_style", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head, base })), [], "on the claim side the declaration is what the area asked for");
});

test("both revisions are read against the sentence the area stated, so nothing pre-existing reads as new", () => {
  const counter = area(stated("function_style", { states: "counter", counterClaim: functionStyle.counterClaim }));
  const src = revision(`function a() {}\nfunction b() {}\nexport const c = () => 1;`, { file: "f.ts" });

  assert.deepEqual(newlyIntroduced({ area: counter, path: "src/a.ts", lang: "js", head: src, base: src }), [], "every row, not only the one stated");
  assert.equal(only("function_style", newlyIntroduced({ area: counter, path: "src/a.ts", lang: "js", head: src, base: null })).length, 2);
});

test("a slot the area does not hold is answered by the nearest ancestor that states one", () => {
  const parent = area(stated("function_style", { states: "counter", counterClaim: functionStyle.counterClaim }));
  const child = { path: "src/deep", globs: ["src/deep/**"], dimensions: [] };
  const head = revision(`function a() {}`, { file: "f.ts" });

  const found = only("function_style", newlyIntroduced({ area: child, ancestorsOf: () => [parent], path: "src/deep/a.ts", lang: "js", head, base: null }));
  assert.equal(found.length, 1, "the ancestor's counter side reaches the child");
  assert.equal(found[0].claim, functionStyle.counterClaim);
});

/* --- the two modes --- */

test("the added-lines mode keeps the head sites inside the ranges and needs no base", () => {
  const head = revision(`export const a = () => 1;\nexport const b = () => 2;\nexport const c = () => 3;`, { file: "f.ts" });
  const claim = area(stated("function_style"));

  const inside = only("function_style", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head, base: null, addedLines: [[2, 2]] }));
  assert.deepEqual(inside.map((f) => [f.line, f.where]), [[2, "b"]]);
  assert.equal(only("function_style", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head, base: null, addedLines: null })).length, 3, "a file the branch added is new in full");
  assert.throws(
    () => newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head, base: head, addedLines: [[1, 3]] }),
    TypeError,
    "a base and a range list are two answers to one question"
  );
});

/* --- the rows a file is judged by --- */

test("a row that needs type syntax is not asked of a file that cannot carry it", () => {
  const src = `export function f() { return 1 }`;
  const claim = area(stated("explicit_return_type"));

  const returnType = (path) => only("explicit_return_type", newlyIntroduced({ area: claim, path, lang: "js", head: revision(src, { file: "f.ts" }), base: null }));
  assert.equal(returnType("src/a.ts").length, 1);
  assert.deepEqual(returnType("src/a.js"), []);
});

test("a row blind on a stripped tree is not asked of one", () => {
  const src = `export function f() { return 1 }`;
  const claim = area(stated("explicit_return_type"));

  assert.deepEqual(only("explicit_return_type", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head: revision(src, { file: "f.ts", stripped: true }), base: null })), []);
  assert.equal(only("explicit_return_type", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head: revision(src, { file: "f.ts" }), base: null })).length, 1, "and asked of the whole tree");
});

test("a learned row is enforced as the class the map stored, and not at all where that class is not one", () => {
  const src = revision(`export function DoThing() { return 1 }`, { file: "f.ts" });

  const named = (learned) => only("function_naming_case", newlyIntroduced({ area: area(stated("function_naming_case", { learned })), path: "src/a.ts", lang: "js", head: src, base: null }));
  const [one, ...rest] = named("camelCase");
  assert.deepEqual(rest, []);
  assert.equal(one.claim, "functions are named camelCase");
  assert.deepEqual(named("bogus"), []);
});

test("a row that throws on a tree loses its own sites for that file and nothing else", () => {
  const boom = { key: "boom", kind: "tree", tier: "syntactic", langs: ["js"], claim: "boom", precision: "precise", run() { throw new Error("boom"); } };
  const head = revision(`export const a = () => 1;`, { file: "f.ts" });

  const found = newlyIntroduced({ area: area(stated("function_style"), stated("boom")), path: "src/a.ts", lang: "js", head, base: null, rows: [boom, functionStyle] });
  assert.deepEqual(found.map((f) => f.dimension), ["function_style"]);
});

/* --- grouped bodies, over the Ruby tier --- */

async function rubyRevision(t, src) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-introduced-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const abs = join(dir, "w.rb");
  writeFileSync(abs, src);
  const out = await parseRuby([{ rel: "app/w.rb", abs, lang: "ruby" }]);
  const [r] = out.results;
  assert.ok(r.ok && r.program, out.error ?? "ruby did not parse");
  return { program: r.program, source: src, comments: [], stripped: false, facets: r.facets ?? null };
}

test("a grouped row is judged per body, and a body's identity survives its includes being reordered", needsRuby, async (t) => {
  const slot = area(stated("module_include", { learned: "Comparable" }));
  const base = await rubyRevision(t, "class W\n  include Enumerable\n  include Foo\nend\n");
  const swapped = await rubyRevision(t, "class W\n  include Foo\n  include Enumerable\nend\n");
  const grown = await rubyRevision(t, "class W\n  include Enumerable\n  include Foo\n  include Bar\nend\n");

  const ask = (head, from) => newlyIntroduced({ area: slot, path: "app/w.rb", lang: "ruby", head, base: from });
  assert.equal(ask(base, null).length, 1, "one body, one site");
  assert.deepEqual(ask(swapped, base), []);
  const [charged] = ask(grown, base);
  assert.equal(charged.fp, bodyIdentity("app/w.rb", "module_include", [{ class: "Foo" }, { class: "Bar" }, { class: "Enumerable" }]), "the body's identity is its sorted constants");
});

test("an omission is reported only where the map stated the claim", needsRuby, async (t) => {
  // A body that includes nothing votes with no class (H16). Its whole meaning
  // is "you should have written X", which is a directive, so it is only said
  // where the map said X.
  const src = await rubyRevision(t, "class W\nend\n");
  const said = area(stated("module_include", { learned: "Comparable" }));
  const unsaid = area({ key: "module_include", learned: "Comparable", directive: false, states: null });

  const ask = (slot) => only("module_include", newlyIntroduced({ area: slot, path: "app/w.rb", lang: "ruby", head: src, base: null }));
  assert.equal(ask(said).length, 1);
  assert.deepEqual(ask(unsaid), []);
});

