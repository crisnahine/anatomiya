import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { writeFacts, readFacts, statedSide, FACTS_SCHEMA, FACTS_PATH } from "../plugins/anatomiya/lib/facts.mjs";

/**
 * One owner for the machine record, so one round trip through it.
 *
 * Writer and reader have to agree about a shape neither of them states out
 * loud, and nothing else in the suite compares the two: every other test builds
 * the record it wants to read.
 */
function root(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-facts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const result = (dimensions) => ({
  root: "/nowhere",
  scannedAt: "2026-01-01T00:00:00.000Z",
  corpus: { files: 8, frameworks: [] },
  parse: { parsed: 8 },
  suppressAll: false,
  areas: [{ id: "aaaaaaaa", path: "src", globs: [{ negated: false, dir: "src", tail: "**/*.ts" }], fileCount: 8, dimensions }],
});

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

test("what the writer emits is what the reader reads back", (t) => {
  const dir = root(t);

  writeFacts(dir, result([dim()]));
  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null);
  assert.equal(facts.schema, FACTS_SCHEMA);
  assert.equal(facts.areas[0].dimensions[0].key, "k");
  assert.equal(statedSide(facts.areas[0].dimensions[0]).states, "claim");
});

test("a record written before the new counts existed still reads", (t) => {
  // C10: an older record stays readable, and the three numbers the map prints
  // are simply absent from one written before schema 6.
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({
      schema: 5,
      areas: [{ id: "a", path: "src", fileCount: 8, dimensions: [{ key: "k", directive: true, candidates: 4, conforming: 4 }] }],
    })
  );

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null, "a schema this build knows stays readable");
  assert.equal(facts.areas[0].dimensions[0].moreExceptions, undefined, "and simply carries no such count");
});

test("the record says which engine answered this scan and at what version", (t) => {
  const dir = root(t);
  const scan = result([dim()]);
  scan.parse = { parsed: 8, engines: { oxc: { version: "0.144.0" } } };

  writeFacts(dir, scan);

  assert.deepEqual(readFacts(dir).facts.parse.engines, { oxc: { version: "0.144.0" } });
});

test("a record written before the engines were stored still reads", (t) => {
  // C10 again, for schema 12. A record that never asked which engine answered
  // reads as absent rather than as a probe that found none, which is the
  // difference between an older map and a machine with no parser on it.
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({ schema: 11, parse: { parsed: 8, crashed: 0 }, areas: [] })
  );

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null, "a schema this build knows stays readable");
  assert.equal(facts.parse.engines, null);
  assert.equal(facts.parse.parsed, 8, "and everything it did carry is untouched");
});

test("the record carries the files this pass's dimension could speak about", (t) => {
  // `applyGates` divides by `langFileCount`, the files the dimension could
  // speak about, and the record stored only the numerator. So the one number a
  // human needs to tell a narrow predicate from a rare construct was computed,
  // shaped the gate, and was then dropped before anything could audit it
  // (C2, C3). This pass's count beside this pass's `applicability`, which is
  // the pair that divides: on a pinned repository the gate reads the
  // baseline's, and storing that instead would put a numerator and a
  // denominator from two populations on one line.
  const dir = root(t);

  writeFacts(dir, result([dim({ applicability: 3, langFileCount: 40 })]));
  const { facts } = readFacts(dir);

  assert.equal(facts.areas[0].dimensions[0].langFileCount, 40);
});

test("every number the rendered map prints comes back off the record", (t) => {
  // The map is derivable from this file, which is why the check reads the
  // record rather than the rendered map. Two numbers the renderer prints were
  // computed, rendered and then dropped before the record was written: the
  // count behind "and 6 more", and the namesake count that separates "this
  // repository has no such habit" from "the predicate is looking in the wrong
  // place" (C7).
  const dir = root(t);

  writeFacts(dir, result([
    dim({
      companionsElsewhere: 17,
      exceptions: [{ path: "a.rb", count: 1 }],
      moreExceptions: 6,
      counterClaim: "the other way",
      counterExceptions: [{ path: "b.rb", count: 1 }],
      moreCounterExceptions: 2,
    }),
  ]));
  const written = readFacts(dir).facts.areas[0].dimensions[0];

  assert.equal(written.moreExceptions, 6, "the count behind the rendered \"and N more\"");
  assert.equal(written.moreCounterExceptions, 2, "the same on the side the map may have stated");
  assert.equal(written.companionsElsewhere, 17, "the namesake count an obligation renders (C7)");
});

test("a syntax dimension carries no companion count, because it has no companion", (t) => {
  const dir = root(t);

  writeFacts(dir, result([dim()]));

  assert.equal("companionsElsewhere" in readFacts(dir).facts.areas[0].dimensions[0], false);
});

test("a stated inverse survives the trip, because the rendered map never says which side it is", (t) => {
  // C6. The map deliberately prints the sentence and no marker, so this file is
  // the only place the check can learn that the area was handed the inverse.
  const dir = root(t);

  writeFacts(dir, result([
    dim({
      states: "counter",
      directive: false,
      gate: "ratio",
      counterClaim: "the other way",
      counterRatio: 0.97,
      counterBound: 0.93,
      counterGate: null,
      counterExceptions: [{ path: "src/a.ts", count: 1 }],
      conforming: 2,
    }),
  ]));
  const side = statedSide(readFacts(dir).facts.areas[0].dimensions[0]);

  assert.equal(side.side, "counter");
  assert.equal(side.claim, "the other way");
  assert.equal(side.conforming, 58, "the counter's numerator is the sites the claim did not hold at");
  assert.deepEqual(side.exceptions, [{ path: "src/a.ts", count: 1 }]);
});

test("a one-sided dimension costs no counter fields on disk", (t) => {
  // Refusing an inverse is part of the dimension, so a dimension with no
  // hand-written counter carries nothing about one.
  const dir = root(t);

  writeFacts(dir, result([dim()]));
  const written = readFacts(dir).facts.areas[0].dimensions[0];

  assert.equal("counterClaim" in written, false);
  assert.equal(written.states, "claim", "but the side it took is always written");
});

test("a dimension that lost its baseline counts carries no stand-in for them", (t) => {
  // D6. The check reads `baseline` to decide MUST-FIX, and a zeroed stand-in
  // would read as a baseline that measured nothing conforming.
  const dir = root(t);

  writeFacts(dir, result([dim({ baseline: null })]));

  assert.equal("baseline" in readFacts(dir).facts.areas[0].dimensions[0], false);
});

test("the record is replaced whole, so a crash never leaves half a map", (t) => {
  const dir = root(t);

  writeFacts(dir, result([dim()]));
  writeFacts(dir, result([dim({ key: "second" })]));

  const raw = JSON.parse(readFileSync(join(dir, FACTS_PATH), "utf8"));
  assert.deepEqual(raw.areas[0].dimensions.map((d) => d.key), ["second"]);
});

test("a record from a schema this build has not heard of is refused, not read", (t) => {
  // Fields move between versions, and a record read against the wrong shape
  // enforces a convention nobody stated. Hand-built on purpose: this is the one
  // record the writer cannot produce, because it emits its own version.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const raw = JSON.parse(readFileSync(join(dir, FACTS_PATH), "utf8"));
  writeFileSync(join(dir, FACTS_PATH), JSON.stringify({ ...raw, schema: FACTS_SCHEMA + 1 }));

  const { facts, unreadable } = readFacts(dir);

  assert.equal(facts, null, "nothing is enforced from a record this build cannot read");
  assert.match(unreadable, /scan again with this build/);
});

test("a schema this build cannot make sense of is refused, not read positionally", (t) => {
  // Only a finite number above this build's version was refused, so a record
  // whose version is a string, a null or a fraction was read field by field
  // against a shape nothing promised. The point of versioning the record is
  // that a reader never guesses.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const raw = JSON.parse(readFileSync(join(dir, FACTS_PATH), "utf8"));

  for (const schema of ["tomorrow", null, {}, [], 1.5, -1, NaN]) {
    writeFileSync(join(dir, FACTS_PATH), JSON.stringify({ ...raw, schema }));
    assert.equal(readFacts(dir).facts, null, `schema ${JSON.stringify(schema)} is not a version`);
  }
});

test("a record written before the polarity fields existed still names a side", (t) => {
  // The compat rule for schema 1: no `states` key, and `directive` is the claim
  // side, which is what every schema-1 record meant. The check's own tests used
  // to be this coverage by fabricating one; they write through the writer now,
  // so the rule needs a reader of its own or nothing exercises it.
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({
      schema: 1,
      areas: [{ id: "a", path: "src", fileCount: 8, dimensions: [{ key: "k", directive: true, candidates: 4, conforming: 4 }] }],
    })
  );

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null, "an older record stays readable");
  assert.equal(statedSide(facts.areas[0].dimensions[0]).states, "claim");
});

test("a stored dimension carries the tier the check filters on", async (t) => {
  // check.mjs counts the map's semantic claims with `d.tier === "semantic"`.
  // The writer never stored the field, so that count was 0 for every map any
  // scan has ever produced and the unmeasured-claims note could not fire. Read
  // off a real scan rather than a hand-built record: the test that covered this
  // planted `tier` into facts.json by hand, which is a shape the writer cannot
  // produce, so it passed while the product was broken.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-tierfield-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(): number {\n  return ${i}\n}\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  const stored = JSON.parse(readFileSync(join(dir, ".claude/anatomiya/facts.json"), "utf8"));
  const dims = stored.areas.flatMap((a) => a.dimensions ?? []);

  assert.ok(dims.length > 0, "the fixture produced no dimensions to check");
  const missing = dims.filter((d) => d.tier === undefined).map((d) => d.key);
  assert.deepEqual(missing, [], "a stored dimension with no tier is one the check cannot classify");
});

test("matchesDefault survives the round trip and absent reads as false", (t) => {
  const dir = root(t);
  writeFacts(dir, result([dim({ matchesDefault: true }), dim({ key: "k2" })]));
  const { facts } = readFacts(dir);
  const [flagged, plain] = facts.areas[0].dimensions;
  assert.equal(flagged.matchesDefault, true);
  assert.equal("matchesDefault" in plain, false, "stored only when true, so a schema-9 record reads unchanged");
});

/** One root's record, in the shape `rootFacts` emits it. */
const kindsOf = (path, ext, count) => ({
  path,
  files: count,
  source: count,
  exts: [[ext, count]],
  other: 0,
  jsx: 0,
  jsxExt: null,
  tests: [],
  testRoot: false,
});

test("the roster survives the round trip, at the top and under each area", (t) => {
  const dir = root(t);
  const layout = {
    size: 10,
    minFiles: 3,
    roots: [kindsOf("src/components", ".tsx", 5)],
    more: { roots: 0, files: 0 },
    tests: [{ runner: "cypress", root: "cypress/integration", files: 5 }],
    principles: ["test_shape"],
    truncated: false,
  };
  const kinds = kindsOf("src", ".ts", 8);
  const base = result([dim()]);

  writeFacts(dir, { ...base, layout, areas: [{ ...base.areas[0], kinds }] });
  const { facts } = readFacts(dir);

  assert.equal(facts.schema, FACTS_SCHEMA, "and the record stamps the shape it was written in");
  assert.deepEqual(facts.layout, layout);
  assert.deepEqual(facts.areas[0].kinds, kinds);
});

test("a record written before the roster existed reads as not counted, not as empty", (t) => {
  // An empty roster and an absent one render the same way and mean opposite
  // things: one is a repository with nothing in it, the other is a scan that
  // never counted.
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({ schema: 10, areas: [{ id: "a", path: "src", fileCount: 8, dimensions: [] }] })
  );

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null, "a schema this build knows stays readable");
  assert.equal(facts.layout, null);
  assert.equal(facts.areas[0].kinds, null);
});

test("a null area on disk is carried, not thrown on", (t) => {
  // `knownNames` in rules.mjs guards the same shape: a hand-edited or truncated
  // record is the ordinary case of a file nobody promised, and reading it must
  // not take the whole check down.
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(join(dir, FACTS_PATH), JSON.stringify({ schema: FACTS_SCHEMA, areas: [null] }));

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null);
  assert.deepEqual(facts.areas, [null]);
});

test("the sibling rosters survive the round trip", (t) => {
  const dir = root(t);
  const imports = [
    { module: "styled-components", files: 42, of: 50 },
    { module: "~/components/base", files: 31, of: 50 },
  ];
  const reused = [{ name: "getFullName", file: "src/utils/user.ts", importers: 42 }];
  const base = result([dim()]);

  writeFacts(dir, { ...base, areas: [{ ...base.areas[0], imports, reused }] });
  const { facts } = readFacts(dir);

  assert.deepEqual(facts.areas[0].imports, imports);
  assert.deepEqual(facts.areas[0].reused, reused);
});

test("an area with no import surface stores neither roster as a measured empty one", (t) => {
  // The same distinction `kinds` carries: an empty roster is an area whose
  // files import nothing, and a null one is an area nobody asked.
  const dir = root(t);
  const base = result([dim()]);

  writeFacts(dir, { ...base, areas: [{ ...base.areas[0], imports: null, reused: [] }] });
  const { facts } = readFacts(dir);

  assert.equal(facts.areas[0].imports, null);
  assert.deepEqual(facts.areas[0].reused, []);
});

test("a record written before the sibling rosters existed reads as not counted", (t) => {
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({ schema: 10, areas: [{ id: "a", path: "src", fileCount: 8, dimensions: [] }] })
  );

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null);
  assert.equal(facts.areas[0].imports, null);
  assert.equal(facts.areas[0].reused, null);
});

/* --- a plurality is not a majority (#78) --- */

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
