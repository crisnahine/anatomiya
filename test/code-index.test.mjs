import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

import { buildIndex, saveIndex } from "../plugins/anatomiya/lib/code-index.mjs";
import { findSymbols, formatHit, queryWords, RANKING } from "../plugins/anatomiya/lib/find.mjs";
import { creditOf } from "../plugins/anatomiya/lib/siblings.mjs";
import { readIndex, usableIndex } from "../plugins/anatomiya/lib/index-home.mjs";
import { INDEX_FILE, STORE_DIR } from "../plugins/anatomiya/lib/rules.mjs";

const importersOf = (symbols, byName, rel) => creditOf(symbols, byName, rel).files.map((files) => files.size);

/** A parse record as the worker writes it, carrying only what the index reads. */
const record = (symbols, imports = [], extra = {}) => ({
  ok: true,
  facets: { testRunner: null, testCalls: false, imports: imports.map(([module, names]) => ({ module, names, relative: module.startsWith(".") })), symbols, ...extra },
});

function repository() {
  const files = [
    { rel: "src/utils/compare_urls.ts", lang: "js" },
    { rel: "src/a.ts", lang: "js" },
    { rel: "src/b.ts", lang: "js" },
    { rel: "src/c.test.ts", lang: "js" },
  ];
  const records = new Map([
    ["src/utils/compare_urls.ts", record([["compareUrls", "fn", 3, null, "(a, b)", "Compare two URLs."], ["origin", "fn", 9, null, "(u)", null]])],
    ["src/a.ts", record([["urlBadge", "fn", 1, null, "()", null]], [["./utils/compare_urls", ["compareUrls"]]])],
    ["src/b.ts", record([], [["./utils/compare_urls", ["compareUrls", "origin"]]])],
    ["src/c.test.ts", record([["compareUrlsFixture", "fn", 1, null, null, null]], [["./utils/compare_urls", ["compareUrls"]]], { testCalls: true })],
  ]);
  return { files, records, corpusRels: new Set(files.map((f) => f.rel)) };
}

test("each definition carries how many other files import it, and a file with none is left out", () => {
  const { files, records, corpusRels } = repository();
  const index = buildIndex(files, records, corpusRels);
  assert.equal(index.count, 4);
  assert.deepEqual(
    index.files.map(([rel, test, symbols]) => [rel, test, symbols.map((s) => [s[0], s.at(-1)])]),
    [
      ["src/a.ts", 0, [["urlBadge", 0]]],
      ["src/c.test.ts", 1, [["compareUrlsFixture", 0]]],
      ["src/utils/compare_urls.ts", 0, [["compareUrls", 3], ["origin", 1]]],
    ]
  );
});

test("a call written Class.method credits that class's method and the class, and not a method of another class", () => {
  const symbols = [["Repo", "class", 1, null, null, null], ["find", "method", 2, "Repo", "(self)", null], ["find", "method", 5, "Other", "(self)", null], ["find", "fn", 9, null, "()", null]];
  const byName = new Map([
    ["Repo.find", new Set(["b.py", "c.py", "a.py"])],
    ["Admin::Repo", new Set(["d.rb"])],
  ]);
  // The defining file is no importer of its own; a bare function of the name is not the class's method.
  assert.deepEqual(importersOf(symbols, byName, "a.py"), [3, 2, 0, 0]);
});

test("find ranks a name holding every word first, then by importers, and source before a test", () => {
  const { files, records, corpusRels } = repository();
  const index = buildIndex(files, records, corpusRels);
  const hits = findSymbols(index, ["compare", "urls"]);
  assert.deepEqual(hits.map((h) => h.name), ["compareUrls", "compareUrlsFixture", "urlBadge"]);
  assert.equal(hits[1].test, true);
  // A name in any casing asks the same words.
  assert.deepEqual(findSymbols(index, ["compare_urls"]).map((h) => h.name), hits.map((h) => h.name));
  // And a word however it ends: a plural, `-ing`, `-ation`.
  assert.deepEqual(queryWords(["compareUrls", "URL", "comparing"]), ["compar", "url"]);
  assert.deepEqual(queryWords(["indentation", "indents"]), ["indent"]);
});

test("the ranking is find's to take: today's numbers by default, and another set reorders the same hits", () => {
  const { files, records, corpusRels } = repository();
  const index = buildIndex(files, records, corpusRels);
  const names = (ranking) => findSymbols(index, ["compare", "urls"], ranking).map((h) => h.name);
  assert.deepEqual(names(RANKING), names(undefined));
  // A test's match weighed three times a source's ranks the fixture ahead of the helper it covers.
  assert.deepEqual(names({ ...RANKING, test: 3 }), ["compareUrlsFixture", "compareUrls", "urlBadge"]);
  assert.equal(findSymbols(index, ["compare", "urls"], { ...RANKING, shown: 1 }).length, 1);
  assert.throws(() => findSymbols(index, ["url"], { ...RANKING, name: undefined }), /a ranking names every weight RANKING does/);
});

test("a rare word outweighs common ones, and a name typed run together finds the name", () => {
  const files = [{ rel: "src/a.ts", lang: "js" }];
  const common = Array.from({ length: 40 }, (_, i) => [`newRunId${i}`, "fn", i + 1, null, "()", null]);
  const records = new Map([["src/a.ts", record([...common, ["uuidV7", "fn", 50, null, "()", null], ["unIndent", "fn", 60, null, "()", null]])]]);
  const index = buildIndex(files, records, new Set(["src/a.ts"]));
  assert.equal(findSymbols(index, ["new", "run", "id", "uuid"])[0].name, "uuidV7");
  assert.equal(findSymbols(index, ["unindent"])[0].name, "unIndent");
  const snake = buildIndex(files, new Map([["src/a.ts", record([["compare_urls", "fn", 1, null, "()", null]])]]), new Set(["src/a.ts"]));
  assert.equal(findSymbols(snake, ["compareurls"])[0]?.name, "compare_urls", "a separator in the name is no part of the word typed run together");
});

test("each word counts once, in the best place it matches, so one word said three times does not beat two words", () => {
  // Sourcegraph's BM25F note: summing a score per field gives a match in several fields too big an advantage.
  // `beta` is common, so the second word weighs little: summed, `alpha` in a name, a class and a doc outscored it.
  const files = [{ rel: "src/a.ts", lang: "js" }, { rel: "src/b.ts", lang: "js" }, { rel: "src/c.ts", lang: "js" }];
  const records = new Map([
    ["src/a.ts", record([["alphaThing", "method", 1, "Alpha", "()", "Alpha alpha thing."]])],
    ["src/b.ts", record([["alphaBeta", "fn", 1, null, "()", null]])],
    ["src/c.ts", record(Array.from({ length: 30 }, (_, i) => [`beta_${i}`, "fn", i + 1, null, "()", null]))],
  ]);
  const index = buildIndex(files, records, new Set(["src/a.ts", "src/b.ts", "src/c.ts"]));
  assert.equal(findSymbols(index, ["alpha", "beta"])[0].name, "alphaBeta");
});

test("find answers with six hits at most, the screen a subagent reads in one call", () => {
  const files = [{ rel: "src/a.ts", lang: "js" }];
  const records = new Map([["src/a.ts", record(Array.from({ length: 20 }, (_, i) => [`parse_${i}`, "fn", i + 1, null, "()", null]))]]);
  assert.equal(findSymbols(buildIndex(files, records, new Set(["src/a.ts"])), ["parse"]).length, 6);
});

test("a word only the path holds finds nothing: every definition in a file would tie", () => {
  const { files, records, corpusRels } = repository();
  assert.deepEqual(findSymbols(buildIndex(files, records, corpusRels), ["utils"]), []);
  assert.deepEqual(findSymbols(buildIndex(files, records, corpusRels), ["   "]), []);
});

test("a hit prints its signature, place, kind, reach and doc on one line", () => {
  const { files, records, corpusRels } = repository();
  const [hit] = findSymbols(buildIndex(files, records, corpusRels), ["compare", "urls"]);
  assert.equal(formatHit(hit), "compareUrls(a, b)  src/utils/compare_urls.ts:3  fn, 3 files import it  - Compare two URLs.");
  assert.equal(formatHit({ ...hit, importers: 1, container: "Cls", kind: "method", doc: null, test: true }), "compareUrls(a, b)  src/utils/compare_urls.ts:3  method of Cls, 1 file imports it, in a test file");
});

test("a hit's line carries no control character, whatever the repository wrote", () => {
  const index = { schema: 1, count: 1, files: [["src/\u001bx.ts", 0, [["alpha", "fn", 1, null, "(x)", "Bad\u001b[31m red\u0007.", 0]]]] };
  assert.equal(formatHit(findSymbols(index, ["alpha"])[0]), "alpha(x)  src/ x.ts:1  fn  - Bad [31m red .");
});

test("an index of the right schema and the wrong shape reads as none, or loses only its bad rows", (t) => {
  // A committed copy is the repository's to write: every field `find` prints or reads has to be checked.
  const root = mkdtempSync(join(tmpdir(), "anatomiya-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  const put = (index) => writeFileSync(join(root, STORE_DIR, INDEX_FILE), gzipSync(JSON.stringify(index)));
  const good = ["parse", "fn", 3, null, "(s)", "Parses it.", 2];

  put({ schema: 1, count: "\u001b]0;x\u0007", files: [["a.js", 0, [good]]] });
  assert.equal(readIndex(root).count, 1, "the count is the rows', not the file's word");
  put({ schema: 1, count: 3, files: [["a.js", 0, null], [null, 0, [good]], ["b.js", 0, [[7, "fn", 1, null, null, null, 0], ["x", "\u001b[2J", 1, null, null, null, 0], ["y", "fn", "\u001b[31m", null, null, null, 0], good]]] });
  const read = readIndex(root);
  assert.deepEqual(read.files, [["b.js", 0, [good]]]);
  assert.equal(findSymbols(read, ["parse"])[0].name, "parse");
  put({ schema: 1, files: "nope" });
  assert.equal(readIndex(root), null);
});

test("a committed index row longer than any scan writes is dropped, so find never hands a subagent a page of it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "anatomiya-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  const good = ["parse", "fn", 3, null, "(s)", "Parses it.", 2];
  const long = "x".repeat(99_000);
  const rows = [good, ["parse", "fn", 4, null, long, null, 0], ["parse", "fn", 5, null, null, long, 0], ["parse", "fn", 6, long, null, null, 0], [long, "fn", 7, null, null, null, 0]];
  writeFileSync(join(root, STORE_DIR, INDEX_FILE), gzipSync(JSON.stringify({ schema: 1, files: [["a.js", 0, rows], [`${long}.js`, 0, [good]]] })));

  const read = readIndex(root);
  assert.deepEqual(read.files, [["a.js", 0, [good]]]);
  assert.ok(formatHit(findSymbols(read, ["parse"])[0]).length < 200);
});

test("a word and its plural find each other, whichever ending each was written with", () => {
  const index = { schema: 1, count: 2, files: [["src/s.ts", 0, [["status", "fn", 1, null, null, null, 0], ["aliases", "fn", 2, null, null, null, 0]]]] };
  assert.equal(findSymbols(index, ["statuses"])[0]?.name, "status");
  assert.equal(findSymbols(index, ["alias"])[0]?.name, "aliases");
  const y = { schema: 1, count: 2, files: [["src/p.ts", 0, [["getProperties", "fn", 1, null, null, null, 0], ["runQuery", "fn", 2, null, null, null, 0]]]] };
  assert.equal(findSymbols(y, ["property"])[0]?.name, "getProperties");
  assert.equal(findSymbols(y, ["queries"])[0]?.name, "runQuery");
  // A word ending in y is not cut to meet another: `factory` is no `factor`.
  const z = { schema: 1, count: 3, files: [["src/f.ts", 0, [["scaleFactor", "fn", 1, null, null, null, 9], ["UserFactory", "class", 2, null, null, null, 0], ["retry", "fn", 3, null, null, null, 0]]]] };
  assert.equal(findSymbols(z, ["factory"])[0]?.name, "UserFactory");
  assert.equal(findSymbols(z, ["factory"]).length, 1);
  assert.equal(findSymbols(z, ["retried"])[0]?.name, "retry");
});

test("a call qualified by an inline module or a namespace no symbol declares credits the function inside it", () => {
  const symbols = [["parse", "fn", 2, "util", "()", null], ["parse", "fn", 9, "other", "()", null]];
  const byName = new Map([["util::parse", ["src/a.rs", "src/b.rs"]]]);
  assert.deepEqual(importersOf(symbols, byName, "src/lib.rs"), [2, 0]);
});

test("a call written Module.method credits the module's method, as a class's", () => {
  const files = [{ rel: "lib/billing.rb", lang: "ruby" }, { rel: "app/a.rb", lang: "ruby" }];
  const records = new Map([
    ["lib/billing.rb", record([["Billing", "module", 1, null, null, null], ["round", "method", 2, "Billing", "(x)", null]])],
    ["app/a.rb", record([], [["lib/billing", ["Billing.round"]]])],
  ]);
  const [[, , symbols]] = buildIndex(files, records, new Set(files.map((f) => f.rel))).files;
  assert.deepEqual(symbols.map(([name, kind, , , , , importers]) => [name, kind, importers]), [["Billing", "module", 1], ["round", "method", 1]]);
});

test("a word every doc holds weighs little, so a filler word in a query does not reorder the hits", () => {
  const rows = [
    ["readIndex", "fn", 1, null, "(root)", "Reads the index the scan wrote."],
    ["saveIndex", "fn", 2, null, "(root)", "Writes the index to the store."],
    ["formatHit", "fn", 3, null, "(hit)", "One line for the hit."],
    ["invokedAs", "fn", 4, null, "(url)", "Whether the module was run as the script."],
    ["readFacts", "fn", 5, null, "(root)", "Reads the facts the map holds."],
  ];
  const index = { schema: 1, count: rows.length, files: [["src/a.mjs", 0, rows.map((r) => [...r, 0])]] };
  const names = (words) => findSymbols(index, words).map((h) => h.name);
  assert.deepEqual(names(["read", "the", "index"]), names(["read", "index"]));
  assert.ok(!names(["format", "the", "hit"]).includes("invokedAs"), "a doc that only shares `the` is no hit");
});

test("a lone letter asks nothing: it is in nearly every name", () => {
  const { files, records, corpusRels } = repository();
  const index = buildIndex(files, records, corpusRels);
  assert.deepEqual(queryWords(["a", "compare", "x"]), queryWords(["compare"]));
  assert.deepEqual(findSymbols(index, ["a"]), []);
  // A digit is no letter, and `v 7` asks for a 7.
  assert.deepEqual(queryWords(["v", "7"]), ["7"]);
});

test("a language this scan could not read keeps the rows the last index had for it, as its areas keep their record", () => {
  const files = [{ rel: "app/models/user.rb", lang: "ruby" }, { rel: "src/a.ts", lang: "js" }];
  const records = new Map([["app/models/user.rb", { ok: false }], ["src/a.ts", record([["urlBadge", "fn", 1, null, "()", null]])]]);
  const previous = { schema: 1, count: 2, files: [["app/models/user.rb", 0, [["User", "class", 1, null, null, "A person.", 3]]], ["gone.rb", 0, [["Gone", "class", 1, null, null, null, 0]]]] };

  const index = buildIndex(files, records, new Set(files.map((f) => f.rel)), null, { previous, unread: ["ruby"] });
  assert.deepEqual(index.files.map(([rel]) => rel), ["app/models/user.rb", "src/a.ts"]);
  assert.equal(index.count, 2);
  assert.deepEqual(buildIndex(files, records, new Set(files.map((f) => f.rel))).files.map(([rel]) => rel), ["src/a.ts"]);
});

test("two definitions on one line do not both take the comment above it", () => {
  const files = [{ rel: "src/W.java", lang: "java" }];
  const records = new Map([["src/W.java", record([["W", "class", 1, null, null, "A widget."], ["build", "method", 1, "W", "()", "A widget."], ["stop", "method", 2, "W", "()", "Stops it."]])]]);
  const [[, , symbols]] = buildIndex(files, records, new Set(["src/W.java"])).files;
  assert.deepEqual(symbols.map(([name, , , , , doc]) => [name, doc]), [["W", "A widget."], ["build", null], ["stop", "Stops it."]]);
});

test("an index this cannot write takes the old one away, so find never answers from an older scan as the last", (t) => {
  const root = mkdtempSync(join(tmpdir(), "anatomiya-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  const { files, records, corpusRels } = repository();
  assert.equal(saveIndex(root, buildIndex(files, records, corpusRels)), true);
  // JSON.stringify throws a RangeError past the longest string V8 holds.
  const tooLong = { toJSON() { throw new RangeError("Invalid string length"); } };

  assert.equal(saveIndex(root, tooLong), false);
  assert.equal(readIndex(root), null);
});

test("a hit carries no control or direction character in any field, so the JSON find prints is as safe as its lines", () => {
  const index = { schema: 1, count: 1, files: [["src/\u202ea.ts", 0, [["parse", "fn", 1, "Box\u009b", "(s\u0007)", "Parses\u202e it.", 0]]]] };
  const [hit] = findSymbols(index, ["parse"]);
  for (const value of [hit.rel, hit.container, hit.params, hit.doc]) assert.doesNotMatch(value, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
});

test("the index is written into the store and read back; a missing, foreign or corrupt one reads as none", (t) => {
  const root = mkdtempSync(join(tmpdir(), "anatomiya-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { files, records, corpusRels } = repository();
  const index = buildIndex(files, records, corpusRels);
  assert.equal(readIndex(root), null);
  // The store is the map's to make: a scan that made none keeps no index.
  assert.equal(saveIndex(root, index), false);
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  assert.equal(saveIndex(root, index), true);
  assert.deepEqual(readIndex(root), index);
  writeFileSync(join(root, STORE_DIR, INDEX_FILE), "not gzip");
  assert.equal(readIndex(root), null);
});

test("what a scan writes first is the head a stop reads off an index too large to read whole", (t) => {
  // The writer's key order is the head's whole format: written another way, a large index would read as none.
  const root = mkdtempSync(join(tmpdir(), "anatomiya-index-head-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  const { files, records, corpusRels } = repository();
  assert.equal(saveIndex(root, buildIndex(files, records, corpusRels)), true);
  assert.deepEqual(usableIndex(root, { readMost: 0 }), { home: root, index: null, count: readIndex(root).count });
});
