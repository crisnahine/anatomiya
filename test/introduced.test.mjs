import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSync } from "oxc-parser";

import { needsRuby } from "./ruby-available.mjs";
import { doublingRatio, LINEAR } from "./growth.mjs";
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
  const [one, ...rest] = judge({ head: revision(shifted), base: null });
  assert.deepEqual(rest, []);
  assert.equal(one.dimension, "handler_is_named");
  assert.equal(one.claim, "an event handler prop is given a named function, not an inline arrow");
  assert.equal(one.text, "onClick", "the reported node is the attribute name");
  assert.equal(one.line, 3, "the line is on the site for the added-lines mode, and in the identity for nothing");
  assert.match(one.fp, /^[0-9a-f]{16}$/);
});

test("a component written in a .js file is judged by the JSX rows its area states", () => {
  // The check picked rows by extension alone, so a `.js` component adding an
  // inline handler under a stated "handlers are named" passed unseen while the
  // same line in `.jsx` was a finding. The head's tree is what says JSX.
  const src = `const A = () => <B onClick={() => save(1)} />;`;
  // Parsed under the tsx grammar, which is what `grammarFor` hands a `.js` file.
  const found = judge({ path: "src/a.js", lang: "js", head: revision(src, { file: "f.tsx", jsx: true }) });
  assert.deepEqual(found.map((f) => f.text), ["onClick"]);
});

test("an edit inside a pre-existing inline handler is not a new site", () => {
  const a = revision(`const A = () => <B onClick={() => save(1)} />;`);
  const b = revision(`const A = () => <B onClick={() => save(2)} />;`);

  assert.deepEqual(judge({ head: b, base: a }), []);
});

test("a renamed file is judged under the path it had, so the rename forges nothing", () => {
  const src = revision(`const A = () => <B onClick={() => save(1)} />;`);

  assert.deepEqual(judge({ path: "src/new.jsx", keyPath: "src/old.jsx", head: src, base: src }), []);
  const [one] = judge({ path: "src/new.jsx", keyPath: "src/old.jsx", head: src, base: null });
  assert.equal(one.fp, siteIdentity("src/old.jsx", "handler_is_named", { type: "JSXIdentifier", start: 19, end: 26 }, src.source));
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

test("a site added above an identical one is reported where it was added, not where the base held one", () => {
  // Count alone absorbed the first site in walk order, which was the new one,
  // and reported the one the base already held: the line, the function and the
  // annotation all pointed at code the branch never touched.
  const slot = area(stated("swallowed_error"));
  const base = revision(`export class L {\n  legacy() {\n    try { old(); } catch (e) {}\n  }\n}\n`, { file: "f.ts" });
  const head = revision(
    `export class L {\n  brandNew() {\n    try { risky(); } catch (e) {}\n  }\n  legacy() {\n    try { old(); } catch (e) {}\n  }\n}\n`,
    { file: "f.ts" }
  );

  const found = only("swallowed_error", newlyIntroduced({ area: slot, path: "src/l.ts", lang: "js", head, base }));

  assert.deepEqual(found.map((f) => [f.line, f.where]), [[3, "brandNew"]]);
});

test("renaming the function around a site still introduces nothing", () => {
  // The control for the case above: the enclosing name picks which of a
  // group's copies is which, and is never what makes a site new.
  const slot = area(stated("swallowed_error"));
  const base = revision(`export function before() {\n  try { old(); } catch (e) {}\n}\n`, { file: "f.ts" });
  const head = revision(`export function after() {\n  try { old(); } catch (e) {}\n}\n`, { file: "f.ts" });

  assert.deepEqual(only("swallowed_error", newlyIntroduced({ area: slot, path: "src/l.ts", lang: "js", head, base })), []);
});

test("a site added above a function that was renamed is the one reported, not the renamed one", () => {
  // Neither copy's enclosing name matched the base's, so the two fell through
  // to count, which absorbed in walk order: the report sent the reader to the
  // renamed function's untouched line 5 and said nothing about line 2.
  const slot = area(stated("swallowed_error"));
  const base = revision(`export function before() {\n  try { old(); } catch (e) {}\n}\n`, { file: "f.ts" });
  const head = revision(
    `export function added() {\n  try { risky(); } catch (e) {}\n}\nexport function after() {\n  try { old(); } catch (e) {}\n}\n`,
    { file: "f.ts" }
  );

  const found = only("swallowed_error", newlyIntroduced({ area: slot, path: "src/l.ts", lang: "js", head, base }));

  assert.deepEqual(found.map((f) => [f.line, f.where]), [[2, "added"]]);
});

test("an edit inside a function or class body is not a site on the declaration that holds it", () => {
  // The three rows report the whole declaration, so a line added to its body
  // gave the old site a new identity and the untouched declaration came back
  // as one the branch introduced.
  const slot = area(
    stated("function_style", { states: "counter", counterClaim: "x" }),
    stated("doc_comment_style", { states: "counter", counterClaim: "x" }),
    stated("explicit_return_type")
  );
  const judged = (base, head) =>
    newlyIntroduced({ area: slot, path: "src/a.ts", lang: "js", head: revision(head, { file: "f.ts" }), base: revision(base, { file: "f.ts" }) })
      .filter((f) => slot.dimensions.some((d) => d.key === f.dimension))
      .map((f) => `${f.dimension}@${f.line}`);

  assert.deepEqual(
    judged(`// why\nexport function f(a) {\n  return a\n}\n`, `// why\nexport function f(a) {\n  const b = 1\n  return a\n}\n`),
    []
  );
  assert.deepEqual(
    judged(`// why\nexport const g = (a) => {\n  return a\n}\n`, `// why\nexport const g = (a) => {\n  const b = 1\n  return a\n}\n`),
    []
  );
  assert.deepEqual(
    judged(`// why\nexport class C {\n  m() {\n    return 1\n  }\n}\n`, `// why\nexport class C {\n  m() {\n    return 2\n  }\n  n() {}\n}\n`),
    []
  );
  assert.deepEqual(
    judged(`// why\nexport function f(a) {\n  return a\n}\n`, `// why\nexport function f(a) {\n  return a\n}\nexport function h(a) {\n  return a\n}\n`),
    ["function_style@5", "explicit_return_type@5"],
    "a function the branch adds is still new"
  );
});

test("an edited body beside a new one of the same shape is matched by the function around it", () => {
  // Both callbacks share an identity once the body is out of it, so count
  // alone would absorb the new one in walk order and report the edited one.
  const slot = area(stated("iterate_with_for_of"));
  const base = revision(`export function f() {\n  items.forEach((i) => {\n    a(i);\n  });\n}\n`, { file: "f.ts" });
  const head = revision(
    `export function g() {\n  items.forEach((i) => {\n    b(i);\n  });\n}\nexport function f() {\n  items.forEach((i) => {\n    a(i, 2);\n  });\n}\n`,
    { file: "f.ts" }
  );

  const found = only("iterate_with_for_of", newlyIntroduced({ area: slot, path: "src/l.ts", lang: "js", head, base }));

  assert.deepEqual(found.map((f) => [f.line, f.where]), [[2, "g"]]);

  // In one function the name tells them apart no more than the identity does,
  // so the untouched copy is found by its own text first.
  const inOne = revision(
    `export function f() {\n  items.forEach((i) => {\n    b(i);\n  });\n  items.forEach((i) => {\n    a(i);\n  });\n}\n`,
    { file: "f.ts" }
  );
  const added = only("iterate_with_for_of", newlyIntroduced({ area: slot, path: "src/l.ts", lang: "js", head: inOne, base }));
  assert.deepEqual(added.map((f) => [f.line, f.where]), [[2, "f"]]);
});

test("a row that judges the body aligns alike copies the way a line diff does", () => {
  // With the body out of the identity every anonymous handler is one site, so
  // which copy breaks has to be read off an alignment of all of them. `human`
  // is what a reviewer reading both files would name. `limit` is the answer
  // where only the names inside the bodies tell the readings apart: G1 and G4
  // read as two copies edited in place, as a line diff reads them.
  const caught = (call) => `try { await ${call}() } catch (e) { res.end() }`;
  const then = (...bodies) => bodies.map((b) => `p.then(async (r) => {\n  ${b}\n})\n`).join("");
  const handlers = (a, b) => `app.get("/a", async (req, res) => {\n  ${a}\n})\napp.get("/b", async (req, res) => {\n  ${b}\n})\n`;
  const routes = (...pairs) => pairs.map(([p, b]) => `app.get("${p}", async (req, res) => {\n  ${b}\n})\n`).join("");
  const catches = (a, b) => `try { x() } catch (e) { later(() => ${a}) }\ntry { y() } catch (e) { later(() => ${b}) }\n`;
  const sync = (a, b) =>
    `export async function sync() {\n  try {\n    await pull()\n  } catch (err) {\n    queue(() => ${a})\n  }\n  try {\n    await push()\n  } catch (err) {\n    queue(() => ${b})\n  }\n}\n`;
  const top = (a, b) => `try {\n  x()\n} catch (e) {\n  later(() => ${a})\n}\ntry {\n  y()\n} catch (e) {\n  later(() => ${b})\n}\n`;
  const multi = (...bodies) => bodies.map((b) => `try {\n  x()\n} catch (e) {\n  later(() => ${b})\n}\n`).join("");
  const A = "async_error_handling";
  const S = "swallowed_error";

  const cases = [
    // As many copies on both sides: each was edited in place.
    ["the catch moved from /a to /b", A, handlers(caught("a"), "await b()"), handlers("await a()", caught("b")), [1]],
    ["/a lost its catch and /b was edited", A, handlers(caught("a"), "await b()"), handlers("await a()", "await b(); log()"), [1]],
    ["an edit inside /b alone", A, handlers(caught("a"), "await b()"), handlers(caught("a"), "await b(); log()"), []],
    ["a catch that stopped reading its error inside a closure", S, catches("log(e)", "report()"), catches("log()", "report(e)"), [1]],
    ["multi-line catches in one function", S, sync("log(err)", "retry()"), sync("log()", "retry(1)"), [4]],
    ["multi-line catches that swap which one swallows", S, top("log(e)", "report()"), top("log()", "report(e)"), [3]],
    ["the catch moved between same-opening handlers (T7)", A, then(caught("a"), "await b()"), then("await a()", caught("b")), [1]],
    ["an edit inside the bare one alone", A, then(caught("a"), "await b()"), then(caught("a"), "await b(); log()"), []],
    ["one removed above and one added below an edited one (E4)", A, then(caught("a"), "await b()"), then("await b(); log()", caught("c")), [], [1]],
    // Copies on other routes open on other lines, so they are other groups.
    ["other routes added around an edited one", A, routes(["/b", "await b()"]), routes(["/a", caught("a")], ["/b", "await b(); log()"], ["/c", caught("c")]), []],
    ["one route removed above and one added below an edited one", A, routes(["/a", caught("a")], ["/b", "await b()"]), routes(["/b", "await b(); log()"], ["/c", caught("c")]), []],
    ["the catch moved from /a to /b while /c was added", A, routes(["/a", caught("a")], ["/b", "await b()"]), routes(["/a", "await a()"], ["/b", caught("b")], ["/c", caught("c")]), [1]],
    // A copy added or removed: an unchanged copy on both sides anchors, and
    // between two anchors an edited copy has no known partner.
    ["a caught handler added above an untouched caught one and an edited bare one", A, then(caught("a"), "await b()"), then(caught("x"), caught("a"), "await b(); log()"), []],
    ["a new bare handler beside an untouched bare one", A, then("await a()"), then("await a()", "await b()"), [4]],
    ["a new swallowing catch above an untouched reading one (S2)", S, multi("log(e)"), multi("report()", "log(e)"), [3]],
    ["b lost its catch while a gained one and c was added above (F1)", A, then("await a()", caught("b")), then(caught("c"), caught("a"), "await b()"), [7]],
    ["b lost its catch while a gained one and c was added below (F2)", A, then("await a()", caught("b")), then(caught("a"), "await b()", caught("c")), [4]],
    ["b lost its catch while a gained one and c was removed (F3)", A, then("await a()", caught("b"), caught("c")), then(caught("a"), "await b()"), [4]],
    ["b lost its catch while a gained one and c was added between (F5)", A, then("await a()", caught("b")), then(caught("a"), caught("c"), "await b()"), [7]],
    ["bare a deleted and b lost its catch (F6)", A, then("await a()", caught("b")), then("await b()"), [1]],
    ["bare a unchanged, b lost its catch, c added (F7)", A, then("await a()", caught("b")), then("await a()", "await b()", caught("c")), [4]],
    ["the reading catch stopped reading and the swallowing one was deleted (S3)", S, multi("log(e)", "report()"), multi("log()"), [3]],
    ["a fixed, b stopped reading, c added (S4)", S, multi("log()", "report(e)"), multi("log(e)", "report()", "keep(e)"), [8]],
    ["a caught handler added above an edited bare one", A, then("await b()"), then(caught("a"), "await b(); log()"), [], [4]],
    ["caught handlers added on both sides of an edited bare one (E1)", A, then("await b()"), then(caught("a"), "await b(); log()", caught("c")), [], [4]],
    ["caught handlers removed from both sides of an edited bare one (E2)", A, then(caught("a"), "await b()", caught("c")), then("await b(); log()"), [], [1]],
    ["a caught handler added above an edited bare one beside an untouched bare one (E3)", A, then("await b()", "await z()"), then(caught("a"), "await b(); log()", "await z()"), [], [4]],
    ["a new bare handler above an edited bare one (E5)", A, then("await b()"), then("await n()", "await b(); log()"), [1], [1, 4]],
    ["reading catches added on both sides of an edited swallowing one (S1)", S, multi("report()"), multi("log(e)", "report(1)", "log(e)"), [], [8]],
    ["bare a deleted, b lost its catch, a caught one added below (G1)", A, then("await a()", caught("b")), then("await b()", caught("z")), [1], []],
    ["the swallowing catch deleted, the reading one stopped reading, a reading one added below (G4)", S, multi("report()", "log(e)"), multi("log()", "keep(e)"), [3], []],
    ["an unchanged file", A, then(caught("a"), "await b()", "await b()"), then(caught("a"), "await b()", "await b()"), []],
  ];
  const wrong = [];
  for (const [name, key, base, head, human, limit] of cases) {
    const found = only(key, newlyIntroduced({ area: area(stated(key)), path: "src/a.ts", lang: "js", head: revision(head, { file: "f.ts" }), base: revision(base, { file: "f.ts" }) }));
    const lines = found.map((f) => f.line);
    if (JSON.stringify(lines) !== JSON.stringify(limit ?? human)) wrong.push(`${name}: ${JSON.stringify(lines)}`);
  }
  assert.deepEqual(wrong, []);
});

test("a long file of many sites is judged in time linear in its length", () => {
  // Each site's line was counted from the start of the file, so the work grew
  // with the square of the file: a 619 KB file of 30,000 sites took 28 seconds.
  // The blank lines between sites make the file's length, not the per-site
  // work, the cost that doubles.
  const gap = 1000;
  const judged = (n) => {
    const src = Array.from({ length: n }, (_, i) => `try { g${i}(); } catch (e) {}` + "\n".repeat(gap)).join("");
    const head = revision(src, { file: "f.ts" });
    return () => only("swallowed_error", newlyIntroduced({ area: area(stated("swallowed_error")), path: "src/l.ts", lang: "js", head }));
  };

  const found = judged(500)();
  assert.equal(found.length, 500);
  assert.deepEqual([found[0].line, found[499].line], [1, 1 + 499 * gap]);

  const ratio = doublingRatio(judged, 500);
  assert.ok(ratio < LINEAR, `twice the file took ${ratio.toFixed(2)} times as long`);
});

test("a long group of alike copies edited at both ends is aligned in time linear in its length", () => {
  // With both ends edited nothing trims, and the alignment filled a table of
  // every base copy against every head copy: 30,000 catches took 10 seconds
  // and 1.2 GB.
  const rows = [rowByKey("swallowed_error")];
  const judged = (n) => {
    const src = (first, last) =>
      Array.from({ length: n }, (_, i) => `try {\n  x()\n} catch (e) {\n  later(() => ${i === 0 ? first : i === n - 1 ? last : `log${i}(e)`})\n}\n`).join("");
    const base = revision(src("log0(e)", "keep(e)"), { file: "f.ts" });
    const head = revision(src("log0()", "keep()"), { file: "f.ts" });
    return () => newlyIntroduced({ area: area(stated("swallowed_error")), path: "src/l.ts", lang: "js", head, base, rows });
  };

  assert.deepEqual(judged(3000)().map((f) => f.line), [3, 5 * 3000 - 2]);

  const ratio = doublingRatio(judged, 3000);
  assert.ok(ratio < LINEAR, `twice the copies took ${ratio.toFixed(2)} times as long`);
});

/* --- one polarity for both revisions --- */

const functionStyle = rowByKey("function_style");

test("on the counter side the conforming sites are the findings, and the sentence is the counter-claim", () => {
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

test("a map stating the counter side of a row that no longer has one enforces neither side", () => {
  // Read as the claim, the map's own majority became the finding: every new
  // site written the way the area said to write it.
  const slot = area(stated("non_null_assertion", { states: "counter", counterClaim: "an older sentence" }));
  const head = revision(`declare const a: string[] | null;\nexport const b = a!.length;\nexport const c = a?.length;`, { file: "f.ts" });
  assert.equal(rowByKey("non_null_assertion").counterClaim, null);
  assert.deepEqual(only("non_null_assertion", newlyIntroduced({ area: slot, path: "src/a.ts", lang: "js", head, base: null })), []);
  const claim = area(stated("non_null_assertion"));
  assert.equal(only("non_null_assertion", newlyIntroduced({ area: claim, path: "src/a.ts", lang: "js", head, base: null })).length, 1, "the claim side still finds it");
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

test("a Ruby rescue added above one the base held is the one reported", needsRuby, async (t) => {
  // prism reports no offsets, so every rescue in a file is one identity and
  // any added above an existing swallowing one was reported at the old one.
  const slot = area(stated("rescue_uses_error"));
  const body = (name) => `  def ${name}\n    go\n  rescue StandardError => e\n    nil\n  end\n`;
  const base = await rubyRevision(t, `class W\n${body("legacy")}end\n`);
  const head = await rubyRevision(t, `class W\n${body("brand_new")}${body("legacy")}end\n`);

  const found = only("rescue_uses_error", newlyIntroduced({ area: slot, path: "app/w.rb", lang: "ruby", head, base }));

  assert.deepEqual(found.map((f) => f.where), ["brand_new"]);
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

test("a base spelled relative to the nesting it is written in is the learned one, as the fold reads it", needsRuby, async (t) => {
  // The fold resolves a bare constant against the site's nesting (C30), and
  // compared as written the check flagged every class the map counted.
  const relative = await rubyRevision(t, "module Api\n  module V1\n    class Qbo < BaseController\n    end\n  end\nend\n");
  const elsewhere = await rubyRevision(t, "class Api::V1::Qbo < BaseController\nend\n");
  const mixin = await rubyRevision(t, "module Api\n  class W\n    include Concern\n  end\nend\n");

  const ask = (key, learned, head) =>
    only(key, newlyIntroduced({ area: area(stated(key, { learned })), path: "app/w.rb", lang: "ruby", head, base: null }));
  assert.deepEqual(ask("class_base", "Api::V1::BaseController", relative), []);
  assert.equal(ask("class_base", "Api::V1::BaseController", elsewhere).length, 1, "at the top level the bare name is ::BaseController");
  assert.deepEqual(ask("module_include", "Api::Concern", mixin), []);
});
