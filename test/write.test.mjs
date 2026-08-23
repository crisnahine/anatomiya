import { test } from "node:test";
import assert from "node:assert/strict";
import { needsBindableSocketPath, needsPosixPermissions, needsPosixSpecialFiles } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, statSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { commitMap, planMap, writeMap } from "../plugins/anatomiya/lib/write.mjs";
import { areaFilename, isOwned, realpathOf, realpathOrNull, EXCLUDE_LINES, HEAD_BYTES, PREFIX, SETTINGS_PATH } from "../plugins/anatomiya/lib/rules.mjs";
import { areaId } from "../plugins/anatomiya/lib/areas.mjs";
import { writeFacts, readFacts as readFactsFrom } from "../plugins/anatomiya/lib/facts.mjs";
import { severityFor } from "../plugins/anatomiya/lib/check.mjs";

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
  return {
    id: areaId(path),
    path,
    globs: [{ negated: false, dir: path, tail: "**/*.ts" }],
    fileCount: 40,
    // A single-language area comes out of the reducer with a denominator equal
    // to its file count, and the renderer divides by that.
    dimensions: dimensions.map((d) => ({ langFileCount: 40, ...d })),
  };
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

  // Everything a scan can leave untracked: a third thing written without a
  // third line here is a dirty `git status` for anyone who followed the
  // documented exclude. The settings file was on this list while the scan
  // installed its hook there, and a scan only takes that entry out now.
  assert.deepEqual(EXCLUDE_LINES, [`${RULES}/${PREFIX}*.md`, `${STORE}/`]);
  assert.equal(EXCLUDE_LINES.includes(SETTINGS_PATH), false, "nothing this writes lives there");
  rmSync(dir, { recursive: true, force: true });
});

test("a plan carries every body it would write, and puts none of them on disk", () => {
  // The measurement harness held its own copy of this derivation, because the
  // only way to see a body was to write it. A plan that renders is the one
  // rendering, so a field added here cannot reach the map and miss the recount.
  const dir = workspace();
  const a = area("src/services");
  const quiet = area("src/types", []);

  const plan = planMap(result(dir, [a, quiet]));

  assert.deepEqual([...plan.bodies.keys()], ["anatomiya-overview.md", areaFilename(a)]);
  assert.deepEqual(plan.write, [...plan.bodies.keys()]);
  assert.equal(plan.blind, false);
  assert.equal(plan.root, dir);
  assert.match(plan.bodies.get(areaFilename(a)), /catch blocks use the error they caught/);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory");
  rmSync(dir, { recursive: true, force: true });
});

test("a plan made by one call is committed by the other", () => {
  const dir = workspace();
  const a = area("src/services");

  const plan = commitMap(dir, planMap(result(dir, [a])));

  assert.deepEqual(listRules(dir), [areaFilename(a), "anatomiya-overview.md"].sort());
  assert.equal(readFileSync(join(rules(dir), areaFilename(a)), "utf8"), plan.bodies.get(areaFilename(a)));
  assert.ok(existsSync(join(dir, STORE, "facts.json")), "the facts are on disk beside the files");
  rmSync(dir, { recursive: true, force: true });
});

test("a plan is committed to the root it was made for, or to nothing", () => {
  // The committer resolves the store from the root it is handed, and the record
  // it writes there carries the root the plan was made for, so two roots put one
  // repository's facts in another repository under that one's name.
  const dir = workspace();
  const elsewhere = workspace();

  assert.throws(
    () => commitMap(elsewhere, planMap(result(dir, [area("src/services")]))),
    /was made for/
  );
  assert.equal(existsSync(join(elsewhere, ".claude")), false, "nothing was created there");
  rmSync(elsewhere, { recursive: true, force: true });
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

test("a scan that could not read a whole language removes nothing", () => {
  // Measured: `env -i PATH=/usr/bin:/bin` on a 200-file Rails repository. Every
  // Ruby file is charged as a crash, every area then counts nothing and is
  // dropped, and the writer deletes three correct area files in the same run
  // that reports it could not read them. A container without ruby is the
  // ordinary case for a JavaScript pipeline on a mixed repository.
  const dir = workspace();
  const models = area("app/models");
  const services = area("app/services");
  writeMap(result(dir, [models, services]));

  const before = readdirSync(rules(dir)).sort().map((f) => readFileSync(join(rules(dir), f), "utf8"));
  const factsBefore = readFileSync(join(dir, STORE, "facts.json"), "utf8");

  const blind = result(dir, []);
  blind.parse = { ...blind.parse, crashed: blind.corpus.files, unreadable: ["ruby"] };
  const plan = writeMap(blind);

  assert.deepEqual(plan.remove, [], "a map this run cannot speak for is left alone");
  assert.deepEqual(plan.write, [], "and not half-rewritten either");
  assert.deepEqual(plan.unreadable, ["ruby"], "the caller is told which language went unread");
  assert.ok(existsSync(join(rules(dir), areaFilename(models))), "both area files are still there");
  assert.ok(existsSync(join(rules(dir), areaFilename(services))));
  // The overview is the file that says how many areas exist and how many files
  // this tool generated. Rewriting it from a run that read nothing leaves it
  // claiming zero areas beside three area files that still load.
  const after = readdirSync(rules(dir)).sort().map((f) => readFileSync(join(rules(dir), f), "utf8"));
  assert.deepEqual(after, before, "the map on disk is byte-identical");
  // Keeping the rendered files while replacing the facts they came from would
  // break the one invariant this writer has: nothing rendered that the facts on
  // disk do not derive. check reads facts.json, so it would read the empty one.
  assert.equal(readFileSync(join(dir, STORE, "facts.json"), "utf8"), factsBefore, "and so are the facts");
  rmSync(dir, { recursive: true, force: true });
});

test("a blind run creates no directory either", () => {
  // Both `mkdir`s ran before the blind check, so a container with no ruby left
  // an empty `.claude/rules` and an empty `.claude/anatomiya` behind on every
  // scan of a repository it could not read. Nothing is ever written into
  // either, and an empty rules directory is what a repository nobody has
  // scanned looks like.
  const dir = workspace();
  const blind = result(dir, []);
  blind.parse = { ...blind.parse, crashed: blind.corpus.files, unreadable: ["ruby"] };

  const plan = writeMap(blind);

  assert.equal(plan.blind, true);
  assert.deepEqual(plan.write, []);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory");
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

  assert.deepEqual(plan.foreign, ["house-style.md"]);
  assert.deepEqual(plan.unknown, []);
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

/* --- ownership is three facts, or the file is left alone (A3) --- */

test("a prefixed file carrying our frontmatter survives a scan that never wrote it", () => {
  // A3: the prefix is a name anyone can type, and the frontmatter is what an
  // older build left. Neither pair is ownership, so removal needs the map to
  // name the file too.
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const orphan = join(rules(dir), `${PREFIX}area-99999999.md`);
  const body = "---\ngenerator: anatomiya\n---\n\n# an older build's area\n";
  writeFileSync(orphan, body);

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.remove, [], "no map named it, so nothing may remove it");
  assert.deepEqual(plan.unknown, [`${PREFIX}area-99999999.md`], "reported instead");
  assert.equal(readFileSync(orphan, "utf8"), body, "left byte for byte");
  rmSync(dir, { recursive: true, force: true });
});

test("a second scan removes the area file the first one wrote and this one did not", () => {
  // All three facts now hold: the prefix, the key, and the map on disk from the
  // first scan naming it.
  const dir = workspace();

  writeMap(result(dir, [area("src/services"), area("src/api")]));
  assert.equal(listRules(dir).length, 3);

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.remove, [areaFilename(area("src/api"))]);
  assert.deepEqual(plan.unknown, []);
  assert.equal(existsSync(join(rules(dir), areaFilename(area("src/api")))), false);
  rmSync(dir, { recursive: true, force: true });
});

test("a deleted facts record makes every area file unremovable rather than removable", () => {
  // The store is excluded from git beside the rules, so a fresh clone can hold
  // one without the other. Leaving a stale file loading is recoverable; deleting
  // a file this build cannot vouch for is not.
  const dir = workspace();

  writeMap(result(dir, [area("src/services"), area("src/api")]));
  rmSync(join(dir, STORE), { recursive: true, force: true });

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.unknown, [areaFilename(area("src/api"))]);
  assert.equal(existsSync(join(rules(dir), areaFilename(area("src/api")))), true);
  rmSync(dir, { recursive: true, force: true });
});

test("a file this run is rewriting is not also reported as unknown", () => {
  // It carries our frontmatter and no map names it, but this scan is about to
  // replace it, which is not the same as leaving somebody's file alone.
  const dir = workspace();
  const mine = area("src/services");
  mkdirSync(rules(dir), { recursive: true });
  writeFileSync(join(rules(dir), areaFilename(mine)), "---\ngenerator: anatomiya\n---\n\nold\n");

  const plan = writeMap(result(dir, [mine]));

  assert.deepEqual(plan.unknown, []);
  assert.ok(readFileSync(join(rules(dir), areaFilename(mine)), "utf8").includes("catch blocks"));
  rmSync(dir, { recursive: true, force: true });
});

test("the overview names the rule files the scan did not write (A4)", () => {
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  writeFileSync(join(rules(dir), "house-style.md"), "# theirs\n");

  writeMap(result(dir, [area("src/services")]));

  const overview = readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8");
  assert.match(overview, /^Any other file there was not written by this tool:$/m);
  assert.match(overview, /^- "house-style\.md"$/m);
  rmSync(dir, { recursive: true, force: true });
});

/* --- every write lands under .claude/rules (A1) --- */

test("an area id that would escape the rules directory refuses the whole write", () => {
  // A1: a hand-written CLAUDE.md may not be reachable by a writer bug, whatever
  // an area id is derived from. Asserted rather than trusted because today's id
  // happens to be a hex digest.
  const dir = workspace();
  const escaping = { ...area("src/services"), id: "../../../CLAUDE" };

  assert.throws(() => writeMap(result(dir, [escaping])), /refusing to write outside \.claude\/rules/);
  assert.equal(existsSync(rules(dir)), false, "nothing was created");
  rmSync(dir, { recursive: true, force: true });
});

test("a dry run refuses the same escape a real write refuses", () => {
  const dir = workspace();
  const escaping = { ...area("src/services"), id: "a/b" };

  assert.throws(() => writeMap(result(dir, [escaping]), { dryRun: true }), /refusing to write outside/);
  rmSync(dir, { recursive: true, force: true });
});

test("every name a scan plans is a bare file under the rules directory", () => {
  const dir = workspace();

  const plan = writeMap(result(dir, [area("src/services"), area("lib/http/client")]), { dryRun: true });

  for (const name of plan.write) {
    assert.ok(name.startsWith(PREFIX) && name.endsWith(".md"), name);
    assert.equal(name.includes("/"), false, name);
    assert.equal(name.includes("\\"), false, name);
  }
  rmSync(dir, { recursive: true, force: true });
});

/* --- ownership across a sequence of scans, not one of them (A3) --- */

/**
 * A3 is a state machine and every test above covers one step of it. A file is
 * present or not, carries our prefix or not, carries our key or not, is named
 * by the map or not, and is planned by this scan or not, and a repository walks
 * that machine over many scans while wiping the store and planting files.
 *
 * Deterministic, because a failing seed has to replay. `Math.random` gives a
 * run nobody can redo.
 */
function scanSequences(seed, runs) {
  let state = seed;
  const rnd = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const chance = (p) => rnd() < p;

  const pool = ["src/a", "src/b", "src/c", "lib/x", "lib/y"];
  // Every shape the three-fact rule has to answer for.
  const intruders = [
    { name: "house.md", body: "# house rules\n" },
    { name: `${PREFIX}notes.md`, body: "# our name, nobody's key\n" },
    { name: `${PREFIX}area-deadbeef.md`, body: "---\ngenerator: anatomiya\n---\n\nan older build\n" },
    { name: `${PREFIX}overview.md.bak.md`, body: "---\ngenerator: anatomiya\n---\n\nnot a name we plan\n" },
  ];
  const digest = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const snapshot = (dir) =>
    new Map(
      (existsSync(rules(dir)) ? readdirSync(rules(dir)) : [])
        .filter((n) => statSync(join(rules(dir), n)).isFile())
        .map((n) => [n, digest(readFileSync(join(rules(dir), n), "utf8"))])
    );

  const problems = [];
  for (let run = 0; run < runs; run++) {
    const dir = workspace();
    const written = new Set();
    const theirs = new Map();

    for (let step = 0; step < 6; step++) {
      if (chance(0.4)) {
        const it = pick(intruders);
        mkdirSync(rules(dir), { recursive: true });
        if (!written.has(it.name)) {
          writeFileSync(join(rules(dir), it.name), it.body);
          theirs.set(it.name, digest(it.body));
        }
      }
      // A fresh clone routinely has the rules without the store, since the one
      // exclude line hides both and neither is committed by default.
      if (chance(0.2)) rmSync(join(dir, STORE), { recursive: true, force: true });

      const blind = chance(0.15);
      const dryRun = chance(0.15);
      const areas = pool.filter(() => chance(0.5)).map((p) => area(p));
      const scan = result(dir, areas);
      if (blind) scan.parse = { ...scan.parse, unreadable: ["ruby"] };

      const before = snapshot(dir);
      const plan = writeMap(scan, { dryRun });
      const after = snapshot(dir);

      for (const [name, hash] of theirs) {
        if (!after.has(name)) problems.push(`run ${run} step ${step}: removed ${name}`);
        else if (after.get(name) !== hash) problems.push(`run ${run} step ${step}: modified ${name}`);
      }
      if (dryRun) {
        if (before.size !== after.size) problems.push(`run ${run} step ${step}: a dry run wrote`);
        continue;
      }
      for (const name of plan.write) {
        if (!after.has(name)) problems.push(`run ${run} step ${step}: ${name} never landed`);
        written.add(name);
      }
      for (const name of plan.remove) written.delete(name);
      if (blind) {
        for (const [name, hash] of before) {
          if (after.get(name) !== hash) problems.push(`run ${run} step ${step}: a blind run touched ${name}`);
        }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}

test("no sequence of scans removes or rewrites a file this build did not write", () => {
  // The one failure that cannot be recovered from inside this tool: somebody's
  // hand-written context deleted. Verified red against removal on two facts
  // rather than three, which is the defect A3 names.
  for (const seed of [1, 7, 42]) {
    assert.deepEqual(scanSequences(seed, 40).slice(0, 5), [], `seed ${seed}`);
  }
});

/* --- the rules directory is inside the repository, or it is not ours (F2) --- */

test("a .claude symlinked outside the repository refuses the whole write", () => {
  // F2 is lexical containment and then realpath, fail closed. It was applied to
  // the corpus read and never to the directory this tool writes into, and
  // `join` normalises `..` without resolving a link. Measured: a tracked
  // `.claude -> ../victim` (git mode 120000, so it survives a clone) had the
  // scan write the map into `../victim`, name that directory's files in the
  // always-loaded overview, and remove one of its `anatomiya-*.md` files on the
  // next scan.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  mkdirSync(join(outside, "rules"), { recursive: true });
  const theirs = join(outside, "rules", "anatomiya-area-deadbeef.md");
  writeFileSync(theirs, "---\ngenerator: anatomiya\n---\n\nsomebody else's map\n");
  symlinkSync(outside, join(dir, ".claude"));

  assert.throws(() => writeMap(result(dir, [area("src/services")])), /outside the repository/);
  assert.ok(existsSync(theirs), "nothing outside the repository was touched");
  assert.deepEqual(readdirSync(join(outside, "rules")), ["anatomiya-area-deadbeef.md"]);

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a dry run refuses the symlinked directory a real write refuses", () => {
  // The refusal belongs to the half that plans, or a dry run answers with a
  // clean plan for a write that lands in `../victim` the moment one is asked
  // for.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  symlinkSync(outside, join(dir, ".claude"));

  assert.throws(
    () => writeMap(result(dir, [area("src/services")]), { dryRun: true }),
    /outside the repository/
  );
  assert.deepEqual(readdirSync(outside), [], "and nothing was written there either");

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a .claude/rules symlinked outside the repository refuses it too", () => {
  // The link can sit at either level, and only the resolved path says so.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(outside, join(dir, ".claude", "rules"));

  assert.throws(() => writeMap(result(dir, [area("src/services")])), /outside the repository/);
  assert.deepEqual(readdirSync(outside), [], "nothing was written there");

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a rules directory linked to a real directory inside the repository is fine", () => {
  // Fail closed is not fail always. A repository may legitimately keep the
  // directory behind a link of its own, and the resolved path is inside.
  const dir = workspace();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, "actual-rules"), { recursive: true });
  symlinkSync(join(dir, "actual-rules"), join(dir, ".claude", "rules"));

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.equal(plan.write.length, 2);
  assert.ok(existsSync(join(dir, "actual-rules", "anatomiya-overview.md")));
  rmSync(dir, { recursive: true, force: true });
});

test("only the head of a rules file is read to test its frontmatter", () => {
  // The ownership test is a regex anchored to byte zero and closed by the second
  // fence, so nothing past the frontmatter was ever the question. Measured: a
  // tracked symlink to a 400 MB blob took peak resident size to 1.2 GB, and
  // pointed at /dev/zero the read never returned.
  //
  // The one file that distinguishes a head read from a whole read is one whose
  // fence opens at byte zero and whose key sits past the cap. Losing it goes in
  // the safe direction: not ours, so left alone.
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const atByteZero = join(rules(dir), `${PREFIX}head.md`);
  const pastTheHead = join(rules(dir), `${PREFIX}tail.md`);
  const filler = "x: y\n".repeat(Math.ceil((HEAD_BYTES + 4096) / 5));
  writeFileSync(atByteZero, `---\ngenerator: anatomiya\n---\n\n${filler}\n`);
  writeFileSync(pastTheHead, `---\n${filler}generator: anatomiya\n---\n`);

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.unknown, [`${PREFIX}head.md`], "the key at byte zero is found");
  assert.deepEqual(plan.foreign, [`${PREFIX}tail.md`], "a key past the cap is never reached");
  rmSync(dir, { recursive: true, force: true });
});

test("an area file whose cover is longer than a short head is still ours", () => {
  // The cap is sized by our own frontmatter, not by a guess: an area's `paths`
  // list is one line per pattern, and a cover needing 170 of them is 14 KB on
  // canvas-lms. Measured at 8 KB, that file's closing fence fell past the head,
  // so this tool's own output came back as a file it had not written: never
  // removable, and named as somebody else's in the always-loaded overview.
  const dir = workspace();
  const wide = {
    ...area("app/features"),
    globs: Array.from({ length: 220 }, (_, i) => ({
      negated: i > 0,
      dir: `app/features/a-fairly-long-subdirectory-name-number-${i}/react/components`,
      tail: "**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}",
    })),
  };

  writeMap(result(dir, [wide]));
  const written = readFileSync(join(rules(dir), areaFilename(wide)), "utf8");
  // The scan that no longer covers it has to be able to remove it.
  const plan = writeMap(result(dir, [area("src/services")]));

  assert.ok(written.length > 8 * 1024, `the fixture is only ${written.length} bytes`);
  assert.ok(isOwned(written), "the whole file carries our key");
  assert.deepEqual(plan.foreign, [], "our own output is not somebody else's");
  assert.deepEqual(plan.remove, [areaFilename(wide)], "and it is removable");
  rmSync(dir, { recursive: true, force: true });
});

test("a rules entry that is not a regular file is not a rule file", () => {
  // A directory named `x.md` is a shape, not a file: typed on the opened handle
  // where the platform opens it, and on the EISDIR where it refuses.
  const dir = workspace();
  mkdirSync(join(rules(dir), "adirectory.md"), { recursive: true });

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.foreign, [], "a directory is not a file in the directory");
  assert.deepEqual(plan.unknown, []);
  rmSync(dir, { recursive: true, force: true });
});

test("a store symlinked outside the repository refuses the write too", () => {
  // The rules directory and the store are separate paths under one `.claude`,
  // and a link at either level escapes on its own. The rules check fires first
  // on the shared parent, so this is the case that reaches the store's.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  mkdirSync(rules(dir), { recursive: true });
  symlinkSync(outside, join(dir, STORE));

  assert.throws(() => writeMap(result(dir, [area("src/services")])), /outside the repository/);
  assert.deepEqual(readdirSync(outside), [], "no facts record landed outside");
  assert.deepEqual(readdirSync(rules(dir)), [], "and the map was not written either");

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("the facts record refuses a store outside the repository on its own", () => {
  // `writeFacts` is reachable without the writer, and the record is the file the
  // check reads, so it carries the rule rather than trusting its caller.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(outside, join(dir, STORE));

  assert.throws(() => writeFacts(dir, result(dir, [area("src/services")])), /outside the repository/);
  assert.deepEqual(readdirSync(outside), []);

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a hand-written file holding a planned name is not called somebody else's", () => {
  // It carries our prefix and not our key, so the audit calls it foreign, and
  // this run writes the map over it because that name is ours by construction.
  // Naming it in the overview as a file this tool did not write is false about
  // a file the same run replaced, and it makes the overview differ between two
  // scans of unchanged source, which is the one thing it may never do (A5).
  const dir = workspace();
  const mine = area("src/services");
  mkdirSync(rules(dir), { recursive: true });
  writeFileSync(join(rules(dir), areaFilename(mine)), "# hand written, takes our exact name\n");

  const plan = writeMap(result(dir, [mine]));
  const first = readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8");
  const second = (writeMap(result(dir, [mine])), readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8"));

  assert.deepEqual(plan.foreign, [], "this run wrote it, so it is not somebody else's");
  assert.deepEqual(plan.replaced, [areaFilename(mine)], "and the caller is told the name was taken");
  assert.equal(first, second, "the overview is byte-stable across two scans");
  rmSync(dir, { recursive: true, force: true });
});

test("a fifo in the rules directory is a shape, and the open does not hang on it", needsPosixSpecialFiles, () => {
  // A fifo with no writer blocks a blocking open forever. Opened non-blocking
  // and typed on the handle, it answers "other" like a directory does, and the
  // scan that read the directory continues.
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const fifo = join(rules(dir), "pipe.md");
  execFileSync("mkfifo", [fifo]);

  const t = Date.now();
  const plan = writeMap(result(dir, [area("src/services")]));
  assert.ok(Date.now() - t < 5000, "the open returned");
  assert.deepEqual(plan.foreign, [], "a fifo is not somebody else's rule file");
  assert.deepEqual(plan.unreadableRules, [], "and it is not a file this tool failed to read");

  rmSync(dir, { recursive: true, force: true });
});

test("a socket in the rules directory is a shape on every platform, not an unreadable file", { ...needsPosixSpecialFiles, ...needsBindableSocketPath }, async () => {
  // A unix socket refuses to open, and the errno differs: ENXIO on Linux,
  // EOPNOTSUPP on macOS. Whichever it is, the entry is a shape and occupies
  // its name; only a regular file that will not open is "unreadable".
  const { createServer } = await import("node:net");
  const dir = workspace();
  mkdirSync(rules(dir), { recursive: true });
  const sock = join(rules(dir), "sock.md");
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(sock, resolve).once("error", reject));
  try {
    const plan = writeMap(result(dir, [area("src/services")]));
    assert.deepEqual(plan.foreign, [], "a socket is not somebody else's rule file");
    assert.deepEqual(plan.unreadableRules, [], "and it is not a file this tool failed to read");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory holding a generated name is reported, not an errno", () => {
  // `anatomiya-overview.md` is a fixed name, so a repository can ship a
  // directory called that and every scan dies on `EISDIR` out of the rename.
  // A repository-shaped condition owes a repository-shaped sentence.
  const dir = workspace();
  mkdirSync(join(rules(dir), `${PREFIX}overview.md`), { recursive: true });

  assert.throws(
    () => writeMap(result(dir, [area("src/services")])),
    /is not a file, so the map could not be written/
  );
  rmSync(dir, { recursive: true, force: true });
});

test("a dry run refuses the occupied name a real write refuses", () => {
  // Same half, same reason: the plan is what a dry run answers with, so what
  // says the write cannot happen has to run before the plan is built.
  const dir = workspace();
  mkdirSync(join(rules(dir), `${PREFIX}overview.md`), { recursive: true });

  assert.throws(
    () => writeMap(result(dir, [area("src/services")]), { dryRun: true }),
    /is not a file, so the map could not be written/
  );
  rmSync(dir, { recursive: true, force: true });
});

test("a symlinked rule file is reported like the regular file it loads as", () => {
  // Claude loads a symlinked `.md` on every turn exactly as it loads a regular
  // one, so it belongs in the same report. The type test exists for shapes that
  // cannot be read at all, and `lstat` refused this one as collateral: it went
  // missing from the scan, the check and the overview at once.
  const dir = workspace();
  const shared = join(dir, "shared-rules.md");
  mkdirSync(rules(dir), { recursive: true });
  writeFileSync(shared, "# a rule file the repository keeps elsewhere\n");
  symlinkSync(shared, join(rules(dir), "linked.md"));

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.deepEqual(plan.foreign, ["linked.md"]);
  const overview = readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8");
  assert.match(overview, /^- "linked\.md"$/m);
  rmSync(dir, { recursive: true, force: true });
});

test("a symlink holding a generated name is replaced, not refused", () => {
  // The link resolves to a regular file, so the atomic replace works on it and
  // always did. Refusing the scan over one would be a repository able to stop
  // the map being built at all.
  const dir = workspace();
  const shared = join(dir, "shared-overview.md");
  mkdirSync(rules(dir), { recursive: true });
  writeFileSync(shared, "# not ours\n");
  symlinkSync(shared, join(rules(dir), `${PREFIX}overview.md`));

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.ok(plan.write.includes(`${PREFIX}overview.md`));
  assert.match(readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8"), /# Repository map/);
  rmSync(dir, { recursive: true, force: true });
});

test("a store linked outside the repository is read by nobody either", () => {
  // The check drives every enforced claim, every area assignment and every
  // severity from this record. Refusing to look at the escaped directory and
  // enforcing conventions out of it in the same run is one report contradicting
  // itself.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  mkdirSync(join(outside, "anatomiya"), { recursive: true });
  writeFileSync(join(outside, "anatomiya", "facts.json"), JSON.stringify({ schema: 4, areas: [] }));
  symlinkSync(outside, join(dir, ".claude"));

  const { facts, unreadable } = readFactsFrom(dir);

  assert.equal(facts, null, "nothing outside the repository decides what a branch is judged against");
  assert.match(unreadable, /resolves outside the repository/);

  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a rule file this tool cannot open is neither ours nor somebody else's", needsPosixPermissions, () => {
  // `readHead` answered "" for a file it could not read, which put it through
  // the frontmatter test as if it had been. Measured: a mode-000 area file of
  // our own came back as somebody else's, the always-loaded overview said so,
  // and it could never re-enter the removable set, so a stale map for a deleted
  // directory loaded forever.
  const dir = workspace();
  const mine = area("src/services");
  writeMap(result(dir, [mine, area("lib/http")]));
  const stale = areaFilename(area("lib/http"));
  chmodSync(join(rules(dir), stale), 0o000);

  const plan = writeMap(result(dir, [mine]));

  assert.deepEqual(plan.foreign, [], "authorship nobody checked is not asserted");
  assert.deepEqual(plan.unreadableRules, [stale], "it is reported as what it is");
  assert.deepEqual(plan.remove, [], "and never removed on a guess");
  const overview = readFileSync(join(rules(dir), `${PREFIX}overview.md`), "utf8");
  assert.match(overview, /could not be read, so whose it is is unknown/);
  assert.doesNotMatch(overview, new RegExp(`- "${stale}"`), "not named as somebody else's");

  chmodSync(join(rules(dir), stale), 0o644);
  rmSync(dir, { recursive: true, force: true });
});

test("a rules directory that cannot be listed is not one holding nothing", needsPosixPermissions, () => {
  // The same rule the escape branch carries: a directory nobody looked in is
  // reported, never rendered as a clean one.
  const dir = workspace();
  writeMap(result(dir, [area("src/services")]));
  chmodSync(rules(dir), 0o100);

  const blind = writeMap(result(dir, [area("src/services")]), { dryRun: true });
  chmodSync(rules(dir), 0o755);
  const seeing = writeMap(result(dir, [area("src/services")]), { dryRun: true });

  assert.equal(blind.listed, false, "the caller is told nothing was listed");
  assert.deepEqual(blind.remove, [], "and nothing is removed off an empty listing");
  assert.equal(seeing.listed, true, "and a directory it could list says so");

  rmSync(dir, { recursive: true, force: true });
});

test("a rules directory that does not exist yet was looked in, not refused", () => {
  // The first scan of any repository finds no `.claude/rules`, and `readdir`
  // answers ENOENT the same way it answers a permission failure. Reported as
  // "could not be listed", every first run describes a broken install rather
  // than an empty one. The same rule the
  // parser and the git reads already follow: not-there is not could-not-read.
  const dir = workspace();

  const first = writeMap(result(dir, [area("src/services")]), { dryRun: true });

  assert.equal(first.listed, true, "nothing is there, and that is an answer");
  assert.deepEqual(first.remove, []);

  rmSync(dir, { recursive: true, force: true });
});

test("the realpath used is the one that expands a Windows short name", () => {
  // tmpdir() on a runner answers C:\Users\RUNNER~1\..., and the compiler
  // resolves the same file to the long form. Comparing those two refused every
  // file it discovered for itself, which is 0% resolution with nothing wrong.
  const here = fileURLToPath(new URL(".", import.meta.url));

  assert.equal(realpathOf(here).replace(/[/\\]$/, ""), realpathSync(here).replace(/[/\\]$/, ""));
});

test("the two spellings of an unresolvable path are the whole reason there are two", () => {
  // One reader is deciding where it is and has to refuse; the other is
  // comparing two paths and may fall back. A single helper served whichever
  // caller was written first, and the hook took the lexical path, which walks
  // the parents of a link rather than of the code.
  const missing = join(fileURLToPath(new URL(".", import.meta.url)), "no-such-file");

  assert.equal(realpathOrNull(missing), null);
  assert.equal(realpathOf(missing), resolve(missing));
});
