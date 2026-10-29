import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runScan } from "../plugins/anatomiya/lib/commands.mjs";
import { applyGates, reduceArea } from "../plugins/anatomiya/lib/reduce.mjs";
import { isWholeArea, SCAN_ONLY, scopeOf, SLOT_FIELDS, slotRecord, statedSide } from "../plugins/anatomiya/lib/slot.mjs";
import { removeTree } from "./platform.mjs";

const dim = (o) => ({
  key: "k",
  precision: "precise",
  applicability: 6,
  candidates: 60,
  conforming: 60,
  authors: 3,
  authorsRequired: 2,
  ratio: 1,
  bound: 0.94,
  states: "claim",
  directive: true,
  gate: null,
  exceptions: [],
  ...o,
});

/* --- the side a slot states: a plurality is not a majority --- */

test("a plurality of seven does not flip the printed sentence", () => {
  // `handler_is_named` is 799 of 1,055 = 0.757 repo-wide, and in one 7-file
  // area it is 3 of 7 named. The plurality flipped, so that area printed "an
  // event handler prop is given an inline arrow, not a named function" while
  // other areas of the same repository printed the forward claim: one
  // dimension, one run, two directly opposed sentences.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "ratio", candidates: 7, conforming: 3 }),
    counterClaim: "the other way",
    counterGate: "ratio",
  });

  assert.equal(side.side, "claim", "four of seven is a directory with no habit");
  assert.equal(side.conforming, 3);
});

test("a majority the sample can support still flips it", () => {
  // C6's measured case, and the reason "always print the claim" is not the fix:
  // 2 of 61 reports a directory with no habit when it has a very strong one.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "concentration", candidates: 61, conforming: 2 }),
    counterClaim: "the other way",
    counterGate: null,
  });

  assert.equal(side.side, "counter");
  assert.equal(side.conforming, 59);
});

test("a sentence no site here follows is never the one printed", () => {
  // The bound is penalised hardest at small n, so a unanimous counter side of
  // three failed it and the map printed the claim with 0 of 3: the sentence the
  // directory follows zero times, which the check then enforced against files
  // doing what every other file in the directory does. On one measured
  // repository 81 unanimous rows read this way, and one parent and its own
  // child printed directly opposed sentences off the same run.
  const at = (candidates) =>
    statedSide({
      ...dim({ states: null, directive: false, gate: "ratio", candidates, conforming: 0 }),
      counterClaim: "the other way",
      counterGate: "ratio",
    });

  for (const n of [2, 3, 4]) {
    assert.equal(at(n).side, "counter", `${n} of ${n} take the other side`);
    assert.equal(at(n).conforming, n);
  }
});

test("one observation is not a habit, so a single site decides nothing", () => {
  // Without a floor the zero clause flipped a one-site directory against a
  // claim the rest of the repository holds at 94.7%, and its own parent area
  // stated the opposite as a directive: the D9 defect again, at n = 1. Of the
  // 81 unanimous counters on one measured repository, 29 are a single site.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "evidence", candidates: 1, conforming: 0 }),
    counterClaim: "the other way",
    counterGate: "evidence",
  });

  assert.equal(side.side, "claim");
  assert.equal(side.conforming, 0, "the count beside it says how thin this is");
});

test("a claim side holding one site is still a directory with no habit", () => {
  // The floor is zero sites, not a small share: one site each way is mixed, and
  // the plurality rule is what decides it.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "ratio", candidates: 4, conforming: 1 }),
    counterClaim: "the other way",
    counterGate: "ratio",
  });

  assert.equal(side.side, "claim");
  assert.equal(side.conforming, 1);
});

test("a side the gates actually stated is never re-decided by the counts", () => {
  const side = statedSide({
    ...dim({ states: "counter", directive: false, gate: "ratio", candidates: 7, conforming: 3 }),
    counterClaim: "the other way",
    counterGate: null,
  });

  assert.equal(side.side, "counter", "the gates decided this, not the plurality");
});

test("the flip needs a majority at ten sites too, and eight of ten is not one", () => {
  const at = (conforming) =>
    statedSide({
      ...dim({ states: null, directive: false, gate: "ratio", candidates: 10, conforming }),
      counterClaim: "the other way",
      counterGate: "ratio",
    }).side;

  assert.equal(at(2), "claim", "eight of ten: the lower bound on the majority is 0.49");
  assert.equal(at(1), "counter", "nine of ten clears a half");
});

/* --- a slot as the record stores it --- */

test("every slot the record writes is whole enough to carry, however many sides it has", () => {
  const counter = { counterClaim: "the other way", counterRatio: 0, counterBound: 0, counterPriorBound: 0, counterGate: null, counterAuthors: 0, counterExceptions: [], moreCounterExceptions: 0 };
  const baseline = { baseline: { candidates: 40, conforming: 39, exceptions: [{ path: "a.ts", count: 1 }], counterExceptions: [] } };
  for (const slot of [dim(), dim(counter), dim({ ...counter, ...baseline }), dim({ scope: [".ts"], declined: 2, companionsElsewhere: 1 })]) {
    const area = { id: "aaaaaaaa", path: "src", globs: [], fileCount: 8, dimensions: [slotRecord(slot)] };
    assert.equal(isWholeArea(area), true, JSON.stringify(slot));
  }
  assert.equal(isWholeArea({ id: "aaaaaaaa", path: "src", fileCount: 8, dimensions: [null] }), false, "a hand edit that broke a slot is not carried");
});

test("a scope a sentence could not name is neither stored nor read", () => {
  const many = Array.from({ length: 17 }, (_, i) => `.e${i}`);
  assert.deepEqual(scopeOf(dim({ scope: [".ts", "Gemfile"] })), [".ts", "Gemfile"]);
  for (const scope of [many, [], [".t s"], [1], null, undefined]) {
    assert.equal(scopeOf(dim({ scope })), null, JSON.stringify(scope));
    assert.equal("scope" in slotRecord(dim({ scope })), false, JSON.stringify(scope));
  }
  assert.deepEqual(slotRecord(dim({ scope: [".ts"] })).scope, [".ts"]);
});

/* --- the fields a slot keeps: what the fold hands it is stored or named as the scan's own --- */

test("every field a scan hands a slot is one the record stores or one the scan keeps for itself", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-slot-fields-"));
  t.after(() => removeTree(dir));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(
      join(dir, "src", `f${i}.ts`),
      `import { Base } from "./base";\n\n/** F${i}. */\nexport class F${i} extends Base {\n  run(): number {\n    try {\n      return ${i} ?? 0;\n    } catch (err) {\n      return ${i % 3 === 0 ? "0" : "err.code"};\n    }\n  }\n}\n`,
    );
  }
  writeFileSync(join(dir, "src", "base.ts"), "export class Base {}\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");

  const { result } = await runScan(dir, { dryRun: true });
  const fields = new Set(result.areas.flatMap((a) => a.dimensions.flatMap((d) => Object.keys(d))));
  assert.ok(fields.has("learned") && fields.has("files"), "the fixture reaches a learned row and the scan's own fields");
  const known = new Set([...SLOT_FIELDS, ...Object.keys(SCAN_ONLY)]);
  assert.deepEqual([...fields].filter((f) => !known.has(f)).sort(), []);
});

test("a route table's slot, counted over its sections, holds only fields the two lists name", () => {
  // The fold gives a slot `sections` and `sectionDirs` only where a site names its declaration, which no plain scan fixture reaches.
  const rels = ["src/router/routes.tsx", "src/router/Router.tsx", "src/router/index.tsx", "src/router/keys.tsx"];
  const hits = Array.from({ length: 40 }, (_, i) => ({ conforming: false, where: `seg${i}`, class: "kebab-case", section: `s${i % 10}` }));
  const parsed = rels.map((rel, i) => ({ rel, ok: true, facets: { jsx: true }, hits: i === 0 ? { url_segment_case: hits } : {} }));
  const slot = reduceArea({ langs: ["jsx"], files: rels.map((rel) => ({ rel, lang: "jsx" })) }, parsed).find((d) => d.key === "url_segment_case");
  const gated = { ...slot, ...applyGates(slot, { authors: 3, areaFileCount: 4, areaDirCount: 1 }) };
  assert.ok("sections" in gated && "sectionDirs" in gated, "the fixture reaches a route table's fields");
  const known = new Set([...SLOT_FIELDS, ...Object.keys(SCAN_ONLY)]);
  assert.deepEqual(Object.keys(gated).filter((f) => !known.has(f)).sort(), []);
});

test("every field the table says the record keeps is one the record reads", () => {
  const full = {
    ...dim({ tier: "syntactic", langFileCount: 9, priorBound: 0.5, borrowed: false, matchesDefault: false }),
    learned: "PascalCase",
    learnedKind: "module",
    reaches: ["Base"],
    narrowed: false,
    moreExceptions: 1,
    companionsElsewhere: 2,
    declined: 1,
    scope: [".ts"],
    counterClaim: "the other way",
    counterRatio: 0.2,
    counterBound: 0.1,
    counterPriorBound: 0.1,
    counterBorrowed: false,
    counterGate: "ratio",
    counterAuthors: 1,
    counterExceptions: [{ path: "a.ts", count: 1 }],
    moreCounterExceptions: 1,
    baseline: { candidates: 10, conforming: 9, exceptions: [] },
  };
  assert.deepEqual(SLOT_FIELDS.filter((f) => !(f in full)), [], "the fixture sets every field");
  const changed = (v) =>
    typeof v === "number" ? v + 7
      : typeof v === "string" ? `${v}x`
      : typeof v === "boolean" ? !v
      : Array.isArray(v) ? [...v, "zz"]
      : v === null ? "q"
      : { ...v, candidates: 999 };
  const stored = JSON.stringify(slotRecord(full));
  const unread = SLOT_FIELDS.filter((f) => JSON.stringify(slotRecord({ ...full, [f]: changed(full[f]) })) === stored);
  assert.deepEqual(unread, []);
});

test("no field is both one the record keeps and one the scan keeps for itself", () => {
  assert.deepEqual(SLOT_FIELDS.filter((f) => Object.hasOwn(SCAN_ONLY, f)), []);
  for (const [field, why] of Object.entries(SCAN_ONLY)) assert.ok(why.length > 20, `${field} says why it stays out`);
});
