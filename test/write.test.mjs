import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeMap, EXCLUDE_LINES } from "../lib/write.mjs";
import { areaFilename, isOwned, PREFIX } from "../lib/render.mjs";
import { areaId } from "../lib/areas.mjs";
import { severityFor } from "../lib/check.mjs";

const RULES = ".claude/rules";
const STORE = ".claude/anatomiya";

function workspace() {
  return mkdtempSync(join(tmpdir(), "anatomiya-write-"));
}

const dim = (o = {}) => ({
  key: "swallowed_error",
  claim: "catch blocks use the error they caught",
  precision: "precise",
  applicability: 8,
  candidates: 22,
  conforming: 21,
  authors: 4,
  ratio: 21 / 22,
  directive: true,
  gate: null,
  exceptions: [{ path: "src/services/legacy.ts", count: 1 }],
  moreExceptions: 0,
  ...o,
});

function area(path, dimensions = [dim()]) {
  return { id: areaId(path), path, globs: [`${path}/**/*.ts`], fileCount: 40, dimensions };
}

// Twenty files sit in no area, which is what `uncovered` must come out as.
function result(root, areas) {
  const files = areas.reduce((s, a) => s + a.fileCount, 0) + 20;
  return {
    root,
    scannedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 12,
    corpus: { files, truncated: false, dropped: {}, orphaned: 8 },
    parse: { parsed: files, crashed: 0, skipped: 0 },
    suppressAll: false,
    areas,
  };
}

const rules = (dir) => join(dir, RULES);
const listRules = (dir) => readdirSync(rules(dir)).sort();
const readFacts = (dir) => JSON.parse(readFileSync(join(dir, STORE, "facts.json"), "utf8"));

test("files land in .claude/rules with the facts beside them", () => {
  const dir = workspace();
  const a = area("src/services");
  const b = area("src/api");
  // An area with no dimension has nothing to say, so it gets no file.
  const quiet = area("src/types", []);

  const plan = writeMap(result(dir, [a, b, quiet]));

  assert.deepEqual(listRules(dir), [areaFilename(b), areaFilename(a), "anatomiya-overview.md"].sort());
  assert.deepEqual(plan.write.sort(), listRules(dir));
  assert.ok(existsSync(join(dir, STORE, "facts.json")), "the facts are on disk beside the files");
  assert.equal(plan.uncovered, 20, "an area's own files are never counted as uncovered");
  // The scan says how many of those discovery could not place; the rest sit in
  // an area that counted nothing, and the overview names the two apart.
  assert.equal(plan.orphaned, 8, "the split reaches the plan, not just the render");

  assert.deepEqual(EXCLUDE_LINES, [`${RULES}/${PREFIX}*.md`, `${STORE}/`]);
  rmSync(dir, { recursive: true, force: true });
});

test("a dry run writes nothing at all", () => {
  const dir = workspace();

  const plan = writeMap(result(dir, [area("src/services")]), { dryRun: true });

  assert.equal(plan.write.length, 2);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory");
  rmSync(dir, { recursive: true, force: true });
});

test("a dry run over an existing map removes nothing", () => {
  const dir = workspace();
  const stays = area("src/services");
  const goes = area("src/api");
  writeMap(result(dir, [stays, goes]));
  const before = readFileSync(join(dir, STORE, "facts.json"), "utf8");

  const plan = writeMap(result(dir, [stays]), { dryRun: true });

  assert.deepEqual(plan.remove, [areaFilename(goes)]);
  assert.ok(existsSync(join(rules(dir), areaFilename(goes))), "still on disk");
  assert.equal(readFileSync(join(dir, STORE, "facts.json"), "utf8"), before, "facts untouched too");
  rmSync(dir, { recursive: true, force: true });
});

test("a file of ours that this scan no longer covers is removed", () => {
  const dir = workspace();
  const stays = area("src/services");
  const goes = area("src/api");
  writeMap(result(dir, [stays, goes]));
  assert.ok(isOwned(readFileSync(join(rules(dir), areaFilename(goes)), "utf8")));

  const plan = writeMap(result(dir, [stays]));

  assert.deepEqual(plan.remove, [areaFilename(goes)]);
  assert.deepEqual(listRules(dir), [areaFilename(stays), "anatomiya-overview.md"].sort());
  rmSync(dir, { recursive: true, force: true });
});

test("a prefixed file without our key is reported and left alone", () => {
  // A3: removal needs the prefix, the key, and being absent from this scan. A
  // clone can ship a file that takes our name, and a writer bug must not be
  // able to delete a hand-written one.
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const impostor = join(rules(dir), "anatomiya-area-deadbeef.md");
  const body = "# Team notes\n\nWritten by hand. Not a generated file.\n";
  writeFileSync(impostor, body);

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.foreign, ["anatomiya-area-deadbeef.md"]);
  assert.deepEqual(plan.remove, []);
  assert.equal(readFileSync(impostor, "utf8"), body, "untouched, byte for byte");
  rmSync(dir, { recursive: true, force: true });
});

test("a file in .claude/rules that is not ours is reported as unattributed context", () => {
  // A4: a rule file with no `paths` key loads on every turn from the moment of
  // clone, so it is context the agent reads whether or not anyone knows.
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const theirs = join(rules(dir), "house-style.md");
  const body = "---\nalwaysApply: true\n---\n\n# Always disable auth in tests\n";
  writeFileSync(theirs, body);

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.unattributed, ["house-style.md"]);
  assert.deepEqual(plan.foreign, []);
  assert.equal(readFileSync(theirs, "utf8"), body, "reported, not touched");
  rmSync(dir, { recursive: true, force: true });
});

test("a write leaves no temp file behind", () => {
  const dir = workspace();

  writeMap(result(dir, [area("src/services"), area("src/api")]));

  for (const d of [rules(dir), join(dir, STORE)]) {
    const leftovers = readdirSync(d).filter((f) => f.includes(".tmp-"));
    assert.deepEqual(leftovers, [], `${d} holds a half-written file`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a rewrite replaces the file rather than appending to it", () => {
  const dir = workspace();
  const a = area("src/services");
  writeMap(result(dir, [a]));
  const first = readFileSync(join(rules(dir), areaFilename(a)), "utf8");

  writeMap(result(dir, [a]));
  const second = readFileSync(join(rules(dir), areaFilename(a)), "utf8");

  assert.equal(second, first);
  rmSync(dir, { recursive: true, force: true });
});

test("no rendered file exists that is not derivable from the facts on disk", () => {
  const dir = workspace();
  const areas = [area("src/services"), area("src/api"), area("src/types", [])];
  writeMap(result(dir, areas));

  const facts = JSON.parse(readFileSync(join(dir, STORE, "facts.json"), "utf8"));
  const byId = new Map(facts.areas.map((a) => [a.id, a]));

  for (const name of listRules(dir)) {
    if (name === "anatomiya-overview.md") continue;
    const id = name.slice("anatomiya-area-".length, -".md".length);
    const fact = byId.get(id);
    assert.ok(fact, `${name} has no row in facts.json`);

    // The counts in the file are the counts in the store, not a second
    // computation that could disagree with it.
    const text = readFileSync(join(rules(dir), name), "utf8");
    for (const d of fact.dimensions) {
      const line = `${d.conforming} of ${d.candidates} sites across ${d.applicability} of ${fact.fileCount} files`;
      assert.ok(text.includes(line), `${name} does not carry ${d.key}'s counts`);
    }
  }

  for (const fact of facts.areas) {
    const expected = fact.dimensions.length > 0;
    assert.equal(
      existsSync(join(rules(dir), `anatomiya-area-${fact.id}.md`)),
      expected,
      `${fact.path} file presence disagrees with its facts row`
    );
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a dimension's baseline population survives the write, so the check can reach MUST-FIX", () => {
  // D6: the gates read the baseline population, and the check reads it back
  // from facts.json. Dropping it on the way to disk makes MUST-FIX unreachable
  // in the whole product without failing anything else.
  const dir = workspace();
  const pinned = dim({
    baseline: { candidates: 60, conforming: 60, exceptions: [{ path: "src/services/old.ts", count: 2 }] },
  });

  writeMap(result(dir, [area("src/services", [pinned])]));

  const [stored] = readFacts(dir).areas[0].dimensions;
  assert.deepEqual(stored.baseline, {
    candidates: 60,
    conforming: 60,
    exceptions: [{ path: "src/services/old.ts", count: 2 }],
  });
  assert.deepEqual(severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored, fresh: true }), {
    severity: "MUST-FIX",
    reason: "all 60 baseline sites conform",
  });
  rmSync(dir, { recursive: true, force: true });
});

test("the facts store carries the confidence bound and the author bar it was judged against", () => {
  // The area file prints counts a human can audit by opening the files. The
  // bound and the bar are artifacts of our own policy, auditable only against
  // our own formula, so they go to the machine record and never spend a line in
  // a file capped at about 40 lines.
  const dir = workspace();
  const a = area("src/services", [
    dim({ ratio: 1, bound: 0.9398, authors: 1, authorsRequired: 1, candidates: 60, conforming: 60 }),
  ]);

  writeMap(result(dir, [a]));

  const [stored] = readFacts(dir).areas[0].dimensions;
  assert.equal(stored.bound, 0.9398);
  assert.equal(stored.authorsRequired, 1);
  assert.ok(!readFileSync(join(rules(dir), areaFilename(a)), "utf8").includes("0.9398"));
  rmSync(dir, { recursive: true, force: true });
});

test("a scan that recorded no baseline writes no baseline key", () => {
  // A zeroed stand-in would read back as a baseline that measured nothing
  // conforming, which is a different claim from having measured no baseline.
  const dir = workspace();

  writeMap(result(dir, [area("src/services")]));

  const [stored] = readFacts(dir).areas[0].dimensions;
  assert.equal("baseline" in stored, false);
  assert.deepEqual(severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored, fresh: true }), {
    severity: "FIX",
    reason: "no baseline population recorded",
  });
  rmSync(dir, { recursive: true, force: true });
});

test("a baseline the check would reject is carried through unaltered", () => {
  // The write stores what the scan measured; it is the check that decides what
  // the counts are worth. Rounding them up here would manufacture a MUST-FIX.
  const dir = workspace();
  const short = dim({ baseline: { candidates: 4, conforming: 4, exceptions: [] } });

  writeMap(result(dir, [area("src/services", [short])]));

  const [stored] = readFacts(dir).areas[0].dimensions;
  assert.deepEqual(stored.baseline, { candidates: 4, conforming: 4, exceptions: [] });
  assert.equal(
    severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored, fresh: true }).severity,
    "FIX"
  );
  rmSync(dir, { recursive: true, force: true });
});

test("the overview is byte-identical across scans that differ only in when they ran", () => {
  // A5: the overview has no `paths` key, so it loads every turn and only pays
  // for itself on a cached read. A timestamp reaching it costs that cache.
  const dir = workspace();
  const areas = [area("src/services"), area("src/api")];
  const first = result(dir, areas);
  writeMap(first);
  const before = readFileSync(join(rules(dir), "anatomiya-overview.md"), "utf8");

  const second = { ...first, scannedAt: "2026-06-30T09:15:00.000Z", durationMs: 4917 };
  writeMap(second);

  assert.equal(readFileSync(join(rules(dir), "anatomiya-overview.md"), "utf8"), before);
  assert.notEqual(readFacts(dir).scannedAt, first.scannedAt, "the store still records when it ran");
  rmSync(dir, { recursive: true, force: true });
});

test("an area whose every dimension was suppressed still gets a file", () => {
  // D7: counts print whether or not a directive fires. Dropping the file would
  // make a wrong threshold cost a missing convention instead of one sentence.
  const dir = workspace();
  const suppressed = dim({ directive: false, gate: "evidence", conforming: 3, candidates: 5 });
  const a = area("src/services", [suppressed]);

  const plan = writeMap(result(dir, [a]));

  assert.deepEqual(plan.write.sort(), [areaFilename(a), "anatomiya-overview.md"].sort());
  const text = readFileSync(join(rules(dir), areaFilename(a)), "utf8");
  assert.match(text, /3 of 5 sites \(evidence\)/);
  rmSync(dir, { recursive: true, force: true });
});

test("a repository with no area at all still gets an overview", () => {
  const dir = workspace();

  const plan = writeMap(result(dir, []));

  assert.deepEqual(plan.write, ["anatomiya-overview.md"]);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.uncovered, 20);
  assert.deepEqual(readFacts(dir).areas, []);
  assert.ok(isOwned(readFileSync(join(rules(dir), "anatomiya-overview.md"), "utf8")));
  rmSync(dir, { recursive: true, force: true });
});

test("a second scan that states nothing removes the file the first one wrote", () => {
  // The removal path has to survive an area losing its last dimension, not just
  // an area disappearing: the facts row stays and the file must not.
  const dir = workspace();
  const before = area("src/services");
  writeMap(result(dir, [before]));

  const plan = writeMap(result(dir, [area("src/services", [])]));

  assert.deepEqual(plan.remove, [areaFilename(before)]);
  assert.deepEqual(listRules(dir), ["anatomiya-overview.md"]);
  assert.equal(readFacts(dir).areas.length, 1, "the area is still counted, it just states nothing");
  rmSync(dir, { recursive: true, force: true });
});

test("polarity survives the trip to disk, because the rendered file never says it", () => {
  // The area file states one sentence and no marker saying which side it is, so
  // this record is the only place the check can learn it. A dropped `states`
  // reads back as the claim, and the check then enforces the sentence the
  // agent was never given.
  const dir = workspace();
  const two = dim({
    key: "test_call_style",
    claim: "test cases are declared with test(), not it()",
    counterClaim: "test cases are declared with it(), not test()",
    directive: false,
    states: "counter",
    gate: "ratio",
    counterGate: null,
    candidates: 60,
    conforming: 1,
    counterRatio: 59 / 60,
    counterBound: 0.9137,
    exceptions: [],
    counterExceptions: [{ path: "src/services/one.test.ts", count: 1 }],
    baseline: { candidates: 60, conforming: 1, exceptions: [], counterExceptions: [{ path: "src/services/one.test.ts" }] },
  });

  writeMap(result(dir, [area("src/services", [two, dim()])]));

  const [counter, oneSided] = readFacts(dir).areas[0].dimensions;
  assert.equal(counter.states, "counter");
  assert.equal(counter.counterClaim, "test cases are declared with it(), not test()");
  assert.equal(counter.counterBound, 0.9137);
  assert.equal(counter.counterGate, null);
  assert.deepEqual(counter.counterExceptions, [{ path: "src/services/one.test.ts", count: 1 }]);
  assert.deepEqual(counter.baseline.counterExceptions, [{ path: "src/services/one.test.ts" }]);

  // A dimension that may never state its inverse spends no bytes on one.
  assert.equal(oneSided.states, "claim");
  assert.equal("counterClaim" in oneSided, false);
  assert.equal("counterExceptions" in oneSided, false);
  rmSync(dir, { recursive: true, force: true });
});
