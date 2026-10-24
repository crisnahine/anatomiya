import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { needsPosixPermissions, needsPosixSpecialFiles, removeTree } from "./platform.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { factsJson, schemaProblem, writeFacts, readFacts, readLayout, readRecord, FACTS_SCHEMA, FACTS_PATH, LAYOUT_PATH } from "../plugins/anatomiya/lib/facts.mjs";
import { statedSide } from "../plugins/anatomiya/lib/slot.mjs";
import { recordFor } from "../plugins/anatomiya/lib/rules.mjs";
import { TARGETS } from "../plugins/anatomiya/lib/targets.mjs";

const knownNames = (facts, target) => recordFor(facts, target).names;

/**
 * One owner for the machine record, so one round trip through it.
 *
 * Writer and reader have to agree about a shape neither of them states out
 * loud, and nothing else in the suite compares the two: every other test builds
 * the record it wants to read.
 */
function root(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-facts-"));
  t.after(() => removeTree(dir));
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

test("the names written for each target survive the round trip, and a target that wrote none has no key", (t) => {
  const dir = root(t);
  const cursor = ["anatomiya-area-aaaaaaaa.mdc", "anatomiya-overview.mdc"];
  mkdirSync(join(dir, dirname(FACTS_PATH)), { recursive: true });

  writeFileSync(join(dir, FACTS_PATH), factsJson(result([dim()]), { cursor, copilot: [] }));
  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null);
  assert.equal(facts.schema, 19);
  assert.equal(FACTS_SCHEMA, 19, "the key moved no field, so the number every installed build reads stays");
  assert.deepEqual(facts.targets, { cursor });
  assert.deepEqual(knownNames(facts, TARGETS.cursor), new Set(cursor));
  assert.equal(knownNames(facts, TARGETS.copilot), null, "no key is a target that scan did not write, so nothing there is known");
  assert.deepEqual(knownNames(facts), new Set(["anatomiya-overview.md", "anatomiya-area-aaaaaaaa.md"]));
  assert.equal("targets" in JSON.parse(factsJson(result([dim()]))), false);
  assert.equal("targets" in JSON.parse(factsJson(result([dim()]), { cursor: [], copilot: [] })), false);
});

test("a record with no target named reads with none", (t) => {
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  assert.equal("targets" in JSON.parse(readFileSync(join(dir, FACTS_PATH), "utf8")), false, "a plain write names no target");

  const { facts, unreadable } = readFacts(dir);

  assert.equal(unreadable, null);
  assert.equal(facts.targets, undefined);
  assert.equal(knownNames(facts, TARGETS.cursor), null);
  assert.equal(knownNames(facts, TARGETS.copilot), null);
  assert.equal(knownNames(facts).has("anatomiya-area-aaaaaaaa.md"), true, "and Claude Code's names are read as before");
});

test("a build that has never heard of the targets reads a record naming them", () => {
  // Such a build's check and refresh refuse a schema above their own, so the key shares the number the record had.
  const named = JSON.parse(factsJson(result([dim()]), { cursor: ["anatomiya-overview.mdc"] }));

  assert.equal(named.schema, 19);
  assert.equal(schemaProblem(named), null);
  const { targets, ...rest } = named;
  assert.deepEqual(targets, { cursor: ["anatomiya-overview.mdc"] });
  assert.equal(JSON.stringify(rest, null, 2) + "\n", factsJson(result([dim()])), "and without the key it is the record that build writes, to the byte");
});

test("a target's names in a record somebody edited are held to that target's own names", () => {
  const names = (targets) => knownNames({ areas: [], targets }, TARGETS.cursor);
  assert.deepEqual(names({ cursor: ["anatomiya-overview.mdc", "team.mdc", "../anatomiya-x.mdc", "anatomiya-overview.md", 7, null] }), new Set(["anatomiya-overview.mdc"]));
  for (const bad of [null, [], "cursor", { cursor: "anatomiya-overview.mdc" }, { cursor: null }, { cursor: {} }]) {
    assert.equal(names(bad), null, JSON.stringify(bad));
  }
  assert.equal(knownNames(null, TARGETS.cursor), null);
});

test("a map on disk that does not parse is unreadable, not absent", (t) => {
  // A committed map that conflicted on a merge was reported as no map at all,
  // the same bug the pin reader already fixed.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const path = join(dir, FACTS_PATH);
  writeFileSync(path, `<<<<<<< HEAD\n${readFileSync(path, "utf8")}=======\n{}\n>>>>>>> other\n`);

  const { facts, unreadable } = readFacts(dir);

  assert.equal(facts, null);
  assert.match(unreadable ?? "", /does not parse as JSON/);
  rmSync(path);
  assert.deepEqual(readFacts(dir), { facts: null, unreadable: null }, "no file at all is still no map");
});

test("a map on disk that will not open is unreadable, not absent", needsPosixPermissions, (t) => {
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const path = join(dir, FACTS_PATH);
  chmodSync(path, 0o000);

  const { facts, unreadable } = readFacts(dir);

  assert.equal(facts, null);
  assert.match(unreadable ?? "", /could not be opened/);
});

test("the counter side's authors reach the record and the side that prints them", (t) => {
  // A held area re-renders from this record, so a number the renderer prints
  // has to survive the round trip.
  const dir = root(t);
  writeFacts(
    dir,
    result([
      dim({ counterClaim: "the inverse", states: null, directive: false, conforming: 0, candidates: 40,
            gate: "ratio", counterGate: "authors", authors: 0, counterAuthors: 1 }),
    ])
  );
  const d = readFacts(dir).facts.areas[0].dimensions[0];

  assert.equal(d.counterAuthors, 1);
  assert.equal(statedSide(d).side, "counter");
  assert.equal(statedSide(d).authors, 1);
  assert.equal(statedSide({ ...d, counterAuthors: undefined }).authors, 0, "an older record prints what it printed");
  assert.equal(statedSide(dim({ authors: 3 })).authors, 3, "the claim side keeps its own");
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

test("the count behind a declined-name line survives the trip to disk", (t) => {
  // Same failure as the two above, one stage later: the reducer counted it, the
  // renderer printed it, and the record's own field list dropped it. The record
  // is what the map is derivable from, so a number the counts line carries and
  // the field list drops is a store the map cannot be rebuilt from.
  const dir = root(t);

  writeFacts(dir, result([dim({ key: "file_naming_case", declined: 3 })]));

  assert.equal(readFacts(dir).facts.areas[0].dimensions[0].declined, 3);
});

test("a slot with no scope writes no key, so an older record and a newer one agree there", () => {
  const slotOf = (o) => JSON.parse(factsJson(result([dim(o)]))).areas[0].dimensions[0];

  assert.equal("scope" in slotOf({ scope: null }), false);
  assert.equal("scope" in slotOf({ scope: [] }), false);
  assert.equal("scope" in slotOf({}), false);
  assert.deepEqual(slotOf({ scope: [".ts"] }).scope, [".ts"]);
});

test("a row that declined nothing carries no such count", (t) => {
  const dir = root(t);

  writeFacts(dir, result([dim({ key: "file_naming_case" })]));

  assert.equal("declined" in readFacts(dir).facts.areas[0].dimensions[0], false);
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
  t.after(() => removeTree(dir));
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
    more: { roots: 1, files: 3, floor: { dirs: 4, files: 4, root: 14 } },
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

test("what history said survives the round trip, including how much of it there was", (t) => {
  // Half of what schema 18 is for. The gates have always read this and nothing
  // on disk held it, so no reader could ask why a claim printed as a count.
  const dir = root(t);
  const authors = { files: 213, error: null, repo: 1, shallow: { commits: 1, oldest: "2026-01-22T00:43:30Z" } };

  writeFacts(dir, { ...result([dim()]), authors });

  assert.deepEqual(readFacts(dir).facts.authors, authors);
});

test("a record written before the two fields of schema 18 reads as a scan that never asked", (t) => {
  const dir = root(t);
  mkdirSync(dirname(join(dir, FACTS_PATH)), { recursive: true });
  writeFileSync(
    join(dir, FACTS_PATH),
    JSON.stringify({
      schema: 17,
      areas: [],
      // The summed count is what that record printed, and a null floor is what
      // tells the renderer to print it that way again.
      layout: { size: 9, minFiles: 3, roots: [], more: { roots: 2, files: 3564 }, tests: [] },
    })
  );

  const { facts } = readFacts(dir);

  assert.equal(facts.authors, null, "nothing said whether that clone was whole");
  assert.deepEqual(facts.layout.more, { roots: 2, files: 3564, floor: null });
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
  // `recordFor` in rules.mjs guards the same shape: a hand-edited or truncated
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

test("a record path holding a fifo reads as no record, rather than waiting on it", needsPosixSpecialFiles, (t) => {
  // A plain read of a fifo waits for a writer for ever, and this runs on every
  // scan and every check. Driven in a child with a bound, because a hung read
  // holds this process too.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-fifo-"));
  t.after(() => removeTree(dir));
  mkdirSync(join(dir, ".claude/anatomiya"), { recursive: true });
  execFileSync("mkfifo", [join(dir, FACTS_PATH)]);

  const script = `import { readFacts } from ${JSON.stringify(new URL("../plugins/anatomiya/lib/facts.mjs", import.meta.url).href)};
    process.stdout.write(JSON.stringify(readFacts(${JSON.stringify(dir)})));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 8000 });

  assert.equal(run.signal, null, `still waiting on the fifo after 8 seconds: killed by ${run.signal}`);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { facts: null, unreadable: null });
});

test("a record past the size cap is named as unread, not taken for a repository nobody scanned", (t) => {
  // Nothing this tool writes comes near the cap, so a file past it is one it
  // did not write, and the check says so rather than reading it as no map.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-big-record-"));
  t.after(() => removeTree(dir));
  mkdirSync(join(dir, ".claude/anatomiya"), { recursive: true });
  writeFileSync(join(dir, FACTS_PATH), Buffer.alloc(64 * 1024 * 1024 + 1, 0x20));

  const { facts, unreadable } = readFacts(dir);
  assert.equal(facts, null);
  assert.match(unreadable ?? "", /64 MiB/);
});

test("a record of exactly the size cap is read, and one byte more is not", (t) => {
  const dir = root(t);
  const path = join(dir, "record.json");
  const padded = (size) => {
    const bytes = Buffer.alloc(size, 0x20);
    bytes.write("{}");
    return bytes;
  };
  writeFileSync(path, padded(64 * 2 ** 20));
  assert.deepEqual(readRecord(path), { record: {}, oversize: false });
  writeFileSync(path, padded(64 * 2 ** 20 + 1));
  assert.deepEqual(readRecord(path), { record: null, oversize: true });
});

test("a record past the size cap is told by its size before a byte of it is read", (t) => {
  // Every hook reads a record, so one committed past the cap cost each tool call a 64 MiB read.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-big-record-"));
  t.after(() => removeTree(dir));
  mkdirSync(join(dir, ".claude/anatomiya"), { recursive: true });
  writeFileSync(join(dir, FACTS_PATH), "");
  truncateSync(join(dir, FACTS_PATH), 600 * 1024 * 1024);
  let read = 0;
  const real = fs.readSync;
  fs.readSync = (...args) => {
    const n = real(...args);
    read += n;
    return n;
  };
  syncBuiltinESMExports();
  try {
    assert.match(readFacts(dir).unreadable ?? "", /64 MiB/);
  } finally {
    fs.readSync = real;
    syncBuiltinESMExports();
  }
  assert.equal(read, 0);
});

test("a record is measured by its bytes on disk, not by its decoded length", (t) => {
  // A byte that is not UTF-8 decodes to three, and 22 MB of them read as a
  // record past the 64 MiB cap in a sentence that named a size nobody measured.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-odd-record-"));
  t.after(() => removeTree(dir));
  mkdirSync(join(dir, ".claude/anatomiya"), { recursive: true });
  writeFileSync(join(dir, FACTS_PATH), Buffer.alloc(22 * 1024 * 1024, 0xff));

  const { facts, unreadable } = readFacts(dir);
  assert.equal(facts, null);
  assert.match(unreadable ?? "", /does not parse as JSON/);
  assert.doesNotMatch(unreadable, /MB/);
});

test("the layout is written beside the record, and reads back as the record's own", (t) => {
  // The hooks want the layout alone, and the record holding it was 10 MB on
  // microsoft/vscode: parsing all of it to read 1.5 KB was most of a notice.
  const dir = root(t);
  const layout = { tests: [], roots: [{ dir: "app", path: "app", companions: { with: 0, of: 6 } }] };

  writeFacts(dir, { ...result([dim()]), layout });
  const record = JSON.parse(readFileSync(join(dir, FACTS_PATH), "utf8"));

  const { size, mtimeMs } = statSync(join(dir, FACTS_PATH));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, LAYOUT_PATH), "utf8")), { schema: FACTS_SCHEMA, record: { size, mtimeMs }, layout: record.layout });
  assert.deepEqual(readLayout(dir), { layout: record.layout, schema: FACTS_SCHEMA });
});

test("a layout file that cannot answer for the record beside it is not read", (t) => {
  // Each refusal leaves the caller to read the record itself, which is what a
  // map written before the layout file existed already needs.
  const absent = root(t);
  assert.equal(readLayout(absent), null, "nothing written");

  // Stamped from the record as it stands, so each case below refuses on its one change.
  const stamped = (dir, { schema = FACTS_SCHEMA, size = 0, mtimeMs = 0 } = {}) => {
    const now = statSync(join(dir, FACTS_PATH));
    const record = { size: now.size + size, mtimeMs: now.mtimeMs + mtimeMs };
    writeFileSync(join(dir, LAYOUT_PATH), JSON.stringify({ schema, record, layout: { tests: [], roots: [] } }));
  };

  const exact = root(t);
  writeFacts(exact, result([dim()]));
  stamped(exact);
  assert.deepEqual(readLayout(exact), { layout: { tests: [], roots: [] }, schema: FACTS_SCHEMA }, "the control: an exact stamp is read");

  const ahead = root(t);
  writeFacts(ahead, result([dim()]));
  stamped(ahead, { schema: FACTS_SCHEMA + 1 });
  assert.equal(readLayout(ahead), null, "a schema this build has not heard of");

  const shifted = root(t);
  writeFacts(shifted, result([dim()]));
  stamped(shifted, { mtimeMs: 1 });
  assert.equal(readLayout(shifted), null, "a record one millisecond off, at the same size");

  const resized = root(t);
  writeFacts(resized, result([dim()]));
  stamped(resized, { size: 1 });
  assert.equal(readLayout(resized), null, "a record of another size");

  const alone = root(t);
  writeFacts(alone, result([dim()]));
  rmSync(join(alone, FACTS_PATH));
  assert.equal(readLayout(alone), null, "no record for it to be the layout of");

  // A restore or an older build that rewrites the record leaves this file
  // describing a record that is no longer there, whatever the layout file's own mtime.
  const behind = root(t);
  writeFacts(behind, result([dim()]));
  const then = new Date(Date.now() - 60_000);
  utimesSync(join(behind, FACTS_PATH), then, then);
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(behind, LAYOUT_PATH), later, later);
  assert.equal(readLayout(behind), null, "a record with another mtime");

  // Past the size the reader takes, the record reads as nothing, so the layout
  // file cannot answer for it even stamped exactly. Sparse, so it costs no disk.
  const over = root(t);
  writeFacts(over, result([dim()]));
  truncateSync(join(over, FACTS_PATH), 64 * 1024 * 1024 + 1);
  stamped(over);
  assert.equal(readLayout(over), null, "a record past the cap");
});

test("a record past the cap is written over without being read", (t) => {
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  truncateSync(join(dir, FACTS_PATH), 70 * 2 ** 20);

  writeFacts(dir, result([dim()]));

  assert.equal(readFacts(dir).facts.schema, FACTS_SCHEMA);
});

test("the layout file is stamped from the record this writer renamed, not whatever is there after", async (t) => {
  // Another writer replacing the record right after this one's rename must
  // leave a layout file that refuses, so the reader goes to that writer's record.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  let replaced = 0;
  // The writer renames through the resolved directory, so the target is matched by its tail.
  fs.renameSync = (from, to) => {
    real(from, to);
    if (to.endsWith(join(".claude", "anatomiya", "facts.json"))) {
      writeFileSync(`${to}.theirs`, readFileSync(to, "utf8") + "\n\n");
      real(`${to}.theirs`, to);
      replaced++;
    }
  };
  syncBuiltinESMExports();
  try {
    writeFacts(dir, result([dim({ key: "mine" })]));
  } finally {
    fs.renameSync = real;
    syncBuiltinESMExports();
  }

  assert.equal(replaced, 1, "the other writer ran once, right after this one's rename");
  assert.equal(readLayout(dir), null);
});

/** `fs[name]` throwing EPERM for every path `refuse` picks, for the rest of the test. */
async function refuseFor(t, name, refuse) {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs[name];
  fs[name] = (path, ...rest) => {
    if (refuse(String(path))) throw Object.assign(new Error(`EPERM: operation not permitted, ${name}`), { code: "EPERM" });
    return real(path, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs[name] = real;
    syncBuiltinESMExports();
  });
}

test("a layout file that cannot be written leaves the record it was for unreplaced", async (t) => {
  // A caller told the write failed must find the record it had, not a new one
  // with no layout file to answer for it.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const before = readFileSync(join(dir, FACTS_PATH), "utf8");
  await refuseFor(t, "openSync", (path) => path.includes("layout.json.tmp-"));

  assert.throws(() => writeFacts(dir, result([dim({ key: "new" })])), /EPERM/);

  assert.equal(readFileSync(join(dir, FACTS_PATH), "utf8"), before);
  assert.deepEqual(readdirSync(join(dir, ".claude", "anatomiya")).sort(), ["facts.json", "layout.json"], "no temporary file left");
  assert.notEqual(readLayout(dir), null, "the pair still answers");
});

test("a record that cannot be renamed into place leaves no temporary file", async (t) => {
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const before = readFileSync(join(dir, FACTS_PATH), "utf8");
  await refuseFor(t, "renameSync", (path) => path.includes("facts.json.tmp-"));

  assert.throws(() => writeFacts(dir, result([dim({ key: "new" })])), /EPERM/);

  assert.equal(readFileSync(join(dir, FACTS_PATH), "utf8"), before);
  assert.deepEqual(readdirSync(join(dir, ".claude", "anatomiya")).sort(), ["facts.json", "layout.json"]);
  assert.notEqual(readLayout(dir), null, "the old pair still answers");
});

test("a layout file that cannot be renamed into place puts the record back", async (t) => {
  // The record is renamed first, so a throw at the layout's rename had already
  // replaced it: a caller told the write failed found the new record beside
  // the old layout file.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  const before = readFileSync(join(dir, FACTS_PATH), "utf8");
  const fresh = root(t);
  await refuseFor(t, "renameSync", (path) => path.includes("layout.json.tmp-"));

  assert.throws(() => writeFacts(dir, result([dim({ key: "new" })])), /EPERM/);
  assert.equal(readFileSync(join(dir, FACTS_PATH), "utf8"), before);
  assert.deepEqual(readdirSync(join(dir, ".claude", "anatomiya")).sort(), ["facts.json", "layout.json"], "no temporary file left");

  assert.throws(() => writeFacts(fresh, result([dim()])), /EPERM/);
  assert.deepEqual(readdirSync(join(fresh, ".claude", "anatomiya")), [], "a record that was not there is not left there");
});

test("a record put back after a failed layout rename is answered by its layout file again", async (t) => {
  // The record put back is a new file, so the old layout file's stamp no
  // longer names it unless the rollback writes the pair again.
  const dir = root(t);
  writeFacts(dir, result([dim()]));
  let refused = false;
  await refuseFor(t, "renameSync", (path) => path.includes("layout.json.tmp-") && !refused && (refused = true));

  assert.throws(() => writeFacts(dir, result([dim({ key: "new" })])), /EPERM/);
  assert.notEqual(readLayout(dir), null, "the old pair still answers");
});

test("a directory with no record is answered before the layout file's path is resolved", async (t) => {
  // The notice asks this of every ancestor it walks past, and most hold no map.
  const dir = root(t);
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.realpathSync;
  let resolved = 0;
  fs.realpathSync = (...args) => {
    resolved++;
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(readLayout(dir, join(dir, FACTS_PATH)), null);
  } finally {
    fs.realpathSync = real;
    syncBuiltinESMExports();
  }
  assert.equal(resolved, 0);
});

test("what ships together rides in the layout under the same schema, and an older record states none of it", async (t) => {
  const { statedClaims } = await import("../plugins/anatomiya/lib/cochange.mjs");
  const claim = {
    producer: "src/*.ts", companion: { kind: "edits", path: "src/index.ts" }, candidates: 40, conforming: 40, newest: [8, 8],
    authors: 3, authorsRequired: 2, lift: 4.1, files: [40, 41], area: "src", gate: null, directive: true,
  };
  const cochange = { unit: "first-parent", depth: 20000, perClass: 100, tip: "a".repeat(40), from: "pin", read: 90, counted: 88, bulk: 1, shallow: false, error: null, truncated: false, claims: [claim] };
  const layout = { roots: [], tests: [], more: { roots: 0, files: 0, floor: null }, principles: [], truncated: false };
  const dir = root(t);

  writeFacts(dir, { ...result([dim()]), layout: { ...layout, cochange } });
  const { facts } = readFacts(dir);
  assert.equal(facts.schema, 19);
  assert.deepEqual(facts.layout.cochange, cochange);
  assert.deepEqual(readLayout(dir).layout.cochange, cochange);
  assert.deepEqual(statedClaims(facts.layout.cochange), [claim]);

  // A scan from before the walk wrote no member: no claim, no finding, no notice.
  const older = root(t);
  writeFacts(older, { ...result([dim()]), layout });
  assert.equal(readFacts(older).facts.layout.cochange, undefined);
  assert.deepEqual(statedClaims(readFacts(older).facts.layout.cochange), []);
});
