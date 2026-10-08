import { test } from "node:test";
import assert from "node:assert/strict";
import { caseSensitiveDir, needsBindableSocketPath, needsPosixPermissions, needsPosixSpecialFiles, needsSymlinks } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, realpathSync, rmdirSync, statSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { commitMap, planMap, writeMap } from "../plugins/anatomiya/lib/write.mjs";
import { areaFilename, isOwned, realpathOf, realpathOrNull, targetState, EXCLUDE_LINES, HEAD_BYTES, PREFIX, SETTINGS_PATH } from "../plugins/anatomiya/lib/rules.mjs";
import { areaId } from "../plugins/anatomiya/lib/areas.mjs";
import { TARGETS, areaName, isClaude, overviewName } from "../plugins/anatomiya/lib/targets.mjs";
import { writeFacts, readFacts as readFactsFrom, readLayout, FACTS_SCHEMA } from "../plugins/anatomiya/lib/facts.mjs";
import { severityFor } from "../plugins/anatomiya/lib/check.mjs";

const RULES = ".claude/rules";
const STORE = ".claude/anatomiya";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-write-"));
  t?.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function elsewhere(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
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
  assert.deepEqual(EXCLUDE_LINES, [
    `${RULES}/${PREFIX}*.md`,
    `${STORE}/`,
    `.cursor/rules/${PREFIX}*.mdc`,
    `.github/instructions/${PREFIX}*.instructions.md`,
  ]);
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

/** Every byte of the map on disk, by name, so a failed write can be compared whole. */
function snapshot(dir) {
  const out = {};
  for (const sub of [RULES, STORE]) {
    for (const name of readdirSync(join(dir, sub)).sort()) out[`${sub}/${name}`] = readFileSync(join(dir, sub, name), "utf8");
  }
  return out;
}

/**
 * The snapshot with the layout file's stamp left out. The record a rollback
 * puts back is a new file with a new mtime, so its layout file is stamped again.
 */
function unstamped(snap) {
  const layout = JSON.parse(snap[`${STORE}/layout.json`]);
  delete layout.record;
  return { ...snap, [`${STORE}/layout.json`]: layout };
}

test("a rules directory that refuses the write leaves the previous facts as well as the previous files", needsPosixPermissions, () => {
  // `check` reads facts.json, so new facts beside the old files called the map
  // fresh while the session loaded a map of an older scan.
  const dir = workspace();
  writeMap(result(dir, [area("src/services"), area("src/api")]));
  const before = snapshot(dir);
  chmodSync(rules(dir), 0o555);
  try {
    assert.throws(() => writeMap(result(dir, [area("src/services"), area("src/hooks")])), /\.claude\/rules is not writable, so the map could not be written/);
  } finally {
    chmodSync(rules(dir), 0o755);
  }

  assert.deepEqual(unstamped(snapshot(dir)), unstamped(before), "the previous map, whole, and no temporary file beside it");
  assert.notEqual(readLayout(dir), null, "and its layout file answers for the record put back");
  rmSync(dir, { recursive: true, force: true });
});

/** Make the `n`th call of one `node:fs` export throw, and put it back after the test. */
async function failNth(t, name, n, code = "EPERM") {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs[name];
  let calls = 0;
  fs[name] = (...args) => {
    if (++calls === n) throw Object.assign(new Error(`${code}: operation not permitted, ${name}`), { code });
    return real(...args);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs[name] = real;
    syncBuiltinESMExports();
  });
}

test("a replace that fails part way puts back every file it had already replaced", async (t) => {
  // The facts go first, so a failure on the second file already had them new.
  const dir = workspace();
  writeMap(result(dir, [area("src/services"), area("src/api")]));
  const before = snapshot(dir);
  await failNth(t, "renameSync", 3);

  assert.throws(() => writeMap(result(dir, [area("src/services"), area("src/hooks")])), /EPERM/);

  assert.deepEqual(unstamped(snapshot(dir)), unstamped(before), "the previous map, whole, and no temporary file beside it");
  assert.notEqual(readLayout(dir), null, "and its layout file answers for the record put back");
  rmSync(dir, { recursive: true, force: true });
});

test("a removal that fails puts back what the scan had written", async (t) => {
  // A stale area file left beside new facts is a rendered file no fact on disk derives.
  const dir = workspace();
  writeMap(result(dir, [area("src/services"), area("src/api")]));
  const before = snapshot(dir);
  await failNth(t, "unlinkSync", 1);

  assert.throws(() => writeMap(result(dir, [area("src/services")])), /EPERM/);

  assert.deepEqual(unstamped(snapshot(dir)), unstamped(before));
  assert.notEqual(readLayout(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

test("every file being replaced is read before the first one is renamed", async (t) => {
  // A read between two renames widens the window in which the facts are new and
  // the rules are not.
  const dir = workspace();
  writeMap(result(dir, [area("src/services"), area("src/api")]));
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = { readFileSync: fs.readFileSync, renameSync: fs.renameSync };
  const calls = [];
  for (const name of Object.keys(real)) fs[name] = (...args) => (calls.push(name), real[name](...args));
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(fs, real);
    syncBuiltinESMExports();
  });

  writeMap(result(dir, [area("src/services"), area("src/hooks")]));

  const firstRename = calls.indexOf("renameSync");
  assert.ok(firstRename > 0, "the replace renamed");
  assert.equal(calls.lastIndexOf("readFileSync") < firstRename, true, "no read after the first rename");
  rmSync(dir, { recursive: true, force: true });
});

/** A roster with one root, the shape the overview renders from. */
const roster = (root) => ({
  size: 10,
  minFiles: 3,
  roots: [{ path: root, dir: root, files: 5, source: 5, exts: [[".ts", 5]], other: 0, jsx: 0, jsxExt: null, tests: [], testRoot: false }],
  more: { roots: 0, files: 0, floor: { dirs: 4, files: 4, root: 14 } },
  tests: [],
  principles: [],
  truncated: false,
});

test("a scan writes the layout file beside the record, holding the record's layout", (t) => {
  const dir = workspace();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const layout = roster("src/services");

  writeMap({ ...result(dir, [area("src/services")]), layout });

  assert.deepEqual(JSON.parse(readFileSync(join(dir, STORE, "layout.json"), "utf8")).layout, readFacts(dir).layout);
  assert.deepEqual(readFacts(dir).layout, layout);
  // Read back too: the stamp is the record's as it landed, so the rename kept it.
  assert.deepEqual(readLayout(dir), { layout, schema: FACTS_SCHEMA });
});

test("a replace that fails part way puts the previous layout file back with the record", async (t) => {
  // Staged with the record, so the two always describe the same scan.
  const dir = workspace();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeMap({ ...result(dir, [area("src/services"), area("src/api")]), layout: roster("src/a") });
  const before = snapshot(dir);
  await failNth(t, "renameSync", 3);

  assert.throws(() => writeMap({ ...result(dir, [area("src/services"), area("src/hooks")]), layout: roster("src/b") }), /EPERM/);

  assert.ok(`${STORE}/layout.json` in before, "the first scan wrote one");
  assert.deepEqual(unstamped(snapshot(dir)), unstamped(before));
  // The record put back is a new file, so a layout file put back with its old
  // stamp would leave every hook reading the whole record until the next scan.
  assert.deepEqual(readLayout(dir), { layout: roster("src/a"), schema: FACTS_SCHEMA }, "the pair put back still answers");
});

test("a layout file put back keeps the schema it was written under", async (t) => {
  // The record put back was written by that scan, so the layout file is restamped
  // under that scan's schema, not this build's.
  const dir = workspace();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeMap({ ...result(dir, [area("src/services"), area("src/api")]), layout: roster("src/a") });
  const layoutPath = join(dir, STORE, "layout.json");
  const older = { ...JSON.parse(readFileSync(layoutPath, "utf8")), schema: FACTS_SCHEMA - 1 };
  writeFileSync(layoutPath, JSON.stringify(older));
  assert.deepEqual(readLayout(dir), { layout: roster("src/a"), schema: FACTS_SCHEMA - 1 }, "the control: the forged file answers");
  await failNth(t, "renameSync", 3);

  assert.throws(() => writeMap({ ...result(dir, [area("src/services"), area("src/hooks")]), layout: roster("src/b") }), /EPERM/);

  assert.deepEqual(readLayout(dir), { layout: roster("src/a"), schema: FACTS_SCHEMA - 1 });
});

test("a record that could not be read before the replace is not written back", needsPosixPermissions, async (t) => {
  // Its bytes are unknown, so there is nothing to put back, and the layout file
  // beside it still answers for the old record and must not be restamped from nothing.
  const dir = workspace();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeMap({ ...result(dir, [area("src/services"), area("src/api")]), layout: roster("src/a") });
  const record = join(dir, STORE, "facts.json");
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.openSync;
  const recordTemps = [];
  fs.openSync = (path, ...rest) => {
    if (String(path).includes("facts.json.tmp-")) recordTemps.push(String(path));
    return real(path, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.openSync = real;
    syncBuiltinESMExports();
  });
  await failNth(t, "renameSync", 3);
  chmodSync(record, 0o000);
  try {
    assert.notEqual(readLayout(dir), null, "the control: the old layout file answers");
    assert.throws(() => writeMap({ ...result(dir, [area("src/services"), area("src/hooks")]), layout: roster("src/b") }), /EPERM/);
  } finally {
    chmodSync(record, 0o644);
  }

  assert.equal(recordTemps.length, 1, "only the scan's own record was staged");
});

test("a dry run writes nothing at all", () => {
  const dir = workspace();

  const plan = writeMap(result(dir, [area("src/services")]), { dryRun: true });

  assert.equal(plan.write.length, 2);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory, so neither the record nor the layout file");
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

test("a run that read one language and not the other writes the first and leaves the other's areas as they were", () => {
  // Measured: a TypeScript repository with one Gemfile, on a machine with no
  // ruby, got no map at all, because a run blind to any language wrote
  // nothing. Decided per language instead: the areas holding a file of the
  // language this run read none of are left byte-identical and stay in the
  // record the check reads, and everything else is written as usual.
  const dir = workspace();
  const models = area("app/models");
  const services = area("app/services");
  writeMap(result(dir, [models, services]));
  const modelsBefore = readFileSync(join(rules(dir), areaFilename(models)), "utf8");
  const heldRecord = readFacts(dir).areas.find((a) => a.id === models.id);

  const partial = result(dir, [area("app/services", [dim({ conforming: 22, exceptions: [] })])]);
  partial.parse = { ...partial.parse, unreadable: ["ruby"] };
  partial.held = [{ id: models.id, path: models.path, fileCount: models.fileCount }];
  partial.readNothing = false;
  const plan = writeMap(partial);

  assert.equal(plan.blind, false, "something was read, so something is written");
  assert.deepEqual(plan.write.sort(), [areaFilename(services), "anatomiya-overview.md"].sort());
  assert.deepEqual(plan.remove, [], "the area this run could not read is not removed as gone");
  assert.equal(readFileSync(join(rules(dir), areaFilename(models)), "utf8"), modelsBefore, "nor rewritten");
  assert.match(readFileSync(join(rules(dir), areaFilename(services)), "utf8"), /22 of 22/, "while the rest is");
  // The check reads the record rather than the map, and a record that dropped
  // the area would leave its file loading with nothing on disk deriving it.
  assert.deepEqual(readFacts(dir).areas.find((a) => a.id === models.id), heldRecord, "and its record is carried over");
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
  assert.deepEqual(severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored }), {
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
  assert.deepEqual(severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored }), {
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
    severityFor({ path: "src/services/new.ts", oldPath: null }, { dim: stored }).severity,
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
function scanSequences(t, seed, runs) {
  let state = seed;
  const rnd = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const chance = (p) => rnd() < p;

  const pool = ["src/a", "src/b", "src/c", "lib/x", "lib/y"];
  const every = Object.values(TARGETS);
  // Every shape the three-fact rule has to answer for, in each directory's own extension.
  const intruders = every.flatMap((t) => [
    { dir: t.dir, name: `house${t.ext}`, body: "# house rules\n" },
    { dir: t.dir, name: `${PREFIX}notes${t.ext}`, body: "# our name, nobody's key\n" },
    { dir: t.dir, name: `${PREFIX}area-deadbeef${t.ext}`, body: "---\ngenerator: anatomiya\n---\n\nan older build\n", says: t },
    // Our key under our prefix, at names no scan gives a file: a copy somebody kept.
    { dir: t.dir, name: `${PREFIX}overview${t.ext}.bak${t.ext}`, body: "---\ngenerator: anatomiya\n---\n\nnot a name we plan\n" },
    { dir: t.dir, name: `${PREFIX}my-notes${t.ext}`, body: "---\ngenerator: anatomiya\n---\n\nnot a name we plan\n" },
    // A person's own file at a name a scan plans, where another tool reads it.
    ...(isClaude(t) ? [] : [overviewName(t), areaName(t, areaId(pool[0])), areaName(t, areaId(pool[3]))].map((name) => ({ dir: t.dir, name, body: "# mine, at a name of yours\n" }))),
  ]);
  const record = (dir) => (existsSync(join(dir, STORE, "facts.json")) ? readFileSync(join(dir, STORE, "facts.json"), "utf8") : null);
  const sets = [null, ["claude"], ["claude", "cursor"], ["claude", "copilot"], ["claude", "cursor", "copilot"]];
  const digest = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const snapshot = (dir) =>
    new Map(
      every.flatMap((t) =>
        (existsSync(join(dir, t.dir)) ? readdirSync(join(dir, t.dir)) : [])
          .filter((n) => statSync(join(dir, t.dir, n)).isFile())
          .map((n) => [`${t.dir}/${n}`, digest(readFileSync(join(dir, t.dir, n), "utf8"))])
      )
    );

  const problems = [];
  for (let run = 0; run < runs; run++) {
    const dir = workspace(t);
    const written = new Set();
    const theirs = new Map();
    // The planted files that say this tool wrote them, by the target whose directory holds them.
    const keyed = new Map();

    for (let step = 0; step < 6; step++) {
      if (chance(0.5)) {
        const it = pick(intruders);
        const at = `${it.dir}/${it.name}`;
        mkdirSync(join(dir, it.dir), { recursive: true });
        if (!written.has(at)) {
          writeFileSync(join(dir, at), it.body);
          theirs.set(at, digest(it.body));
          if (it.says) keyed.set(at, it.says);
        }
      }
      // A fresh clone routinely has the rules without the store, since the one
      // exclude line hides both and neither is committed by default.
      if (chance(0.2)) rmSync(join(dir, STORE), { recursive: true, force: true });

      const blind = chance(0.15);
      const dryRun = chance(0.15);
      const targets = pick(sets);
      const areas = pool.filter(() => chance(0.5)).map((p) => area(p));
      const scan = result(dir, areas);
      if (blind) scan.parse = { ...scan.parse, unreadable: ["ruby"] };

      const where = `run ${run} step ${step} targets ${JSON.stringify(targets)}`;
      const before = snapshot(dir);
      const recordBefore = record(dir);
      let plan;
      try {
        plan = writeMap(scan, { dryRun, targets });
      } catch (err) {
        // The one refusal a sequence can reach: a named target with a person's file at a name it writes.
        const named = every.find((t) => !isClaude(t) && targets?.includes(t.id) && err.message.startsWith(`${t.dir}/`));
        if (!named || !/ was not written by this tool, so .* nothing was written anywhere/.test(err.message)) throw err;
        const now = snapshot(dir);
        if (before.size !== now.size || [...before].some(([name, hash]) => now.get(name) !== hash) || record(dir) !== recordBefore) {
          problems.push(`${where}: refused, and the disk changed`);
        }
        continue;
      }
      const after = snapshot(dir);

      // Leaving Cursor or Copilot out by name is the one thing that removes a file no record lists.
      const namedOff = (name) => !blind && !dryRun && targets !== null && keyed.has(name) && !isClaude(keyed.get(name)) && !targets.includes(keyed.get(name).id);
      for (const name of [...theirs.keys()].filter(namedOff)) {
        if (after.has(name)) problems.push(`${where}: ${name} says this tool wrote it and outlived its target being left out`);
        theirs.delete(name);
        keyed.delete(name);
        written.add(name);
      }
      for (const [name, hash] of theirs) {
        if (!after.has(name)) problems.push(`${where}: removed ${name}`);
        else if (after.get(name) !== hash) problems.push(`${where}: modified ${name}`);
      }
      if (dryRun) {
        if (before.size !== after.size) problems.push(`${where}: a dry run wrote`);
        continue;
      }
      const wrote = [
        ...plan.write.map((n) => `${RULES}/${n}`),
        ...Object.values(plan.targets).flatMap((t) => t.write.map((w) => `${t.dir}/${w.name}`)),
      ];
      const removed = [
        ...plan.remove.map((n) => `${RULES}/${n}`),
        ...Object.values(plan.targets).flatMap((t) => t.remove.map((n) => `${t.dir}/${n}`)),
      ];
      for (const name of wrote) {
        if (!after.has(name)) problems.push(`${where}: ${name} never landed`);
        written.add(name);
      }
      for (const name of removed) {
        if (!written.has(name)) problems.push(`${where}: removed ${name}, which no scan here wrote`);
        if (after.has(name)) problems.push(`${where}: ${name} was planned for removal and is still there`);
        written.delete(name);
      }
      // Nothing changes on disk that the plan did not say.
      for (const name of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(name) === after.get(name) || wrote.includes(name) || removed.includes(name)) continue;
        problems.push(`${where}: ${name} changed and the plan names it nowhere`);
      }
      if (blind) {
        for (const [name, hash] of before) {
          if (after.get(name) !== hash) problems.push(`${where}: a blind run touched ${name}`);
        }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}

test("no sequence of scans removes or rewrites a file this build did not write", (t) => {
  // The one failure that cannot be recovered from inside this tool: somebody's
  // hand-written context deleted. Verified red against removal on two facts
  // rather than three, which is the defect A3 names.
  for (const seed of [1, 7, 42]) {
    assert.deepEqual(scanSequences(t, seed, 40).slice(0, 5), [], `seed ${seed}`);
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

test("a rules directory linked to a real directory inside .claude is fine", () => {
  // Fail closed is not fail always. A repository may keep the directory behind
  // a link of its own, and the resolved path is inside `.claude`. A link to
  // anywhere else in the repository is refused: see the tests below.
  const dir = workspace();
  mkdirSync(join(dir, ".claude", "actual-rules"), { recursive: true });
  symlinkSync(join(dir, ".claude", "actual-rules"), join(dir, ".claude", "rules"));

  const plan = writeMap(result(dir, [area("src/services")]));

  assert.equal(plan.write.length, 2);
  assert.ok(existsSync(join(dir, ".claude", "actual-rules", "anatomiya-overview.md")));
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

test("a file where a map directory belongs is refused by name, and a dry run refuses it too", () => {
  // Measured: with a regular file at `.claude/rules`, a dry run printed "would
  // write 2 files" and the real scan died on a raw `EEXIST` out of `mkdir`; a
  // file at `.claude` gave `ENOTDIR`, and one at the store `EEXIST` again. The
  // plan is what a dry run answers with, so it has to know the write cannot
  // happen, and say which path is in the way.
  for (const [blocker, named] of [
    [RULES, RULES],
    [".claude", ".claude"],
    [STORE, STORE],
  ]) {
    const dir = workspace();
    mkdirSync(join(dir, blocker, ".."), { recursive: true });
    writeFileSync(join(dir, blocker), "occupied\n");

    for (const dryRun of [true, false]) {
      assert.throws(
        () => writeMap(result(dir, [area("src/services")]), { dryRun }),
        (err) => err.message === `${named} is not a directory, so the map could not be written: remove it and scan again`,
        `${blocker}, ${dryRun ? "dry run" : "real write"}`
      );
    }
    assert.equal(readFileSync(join(dir, blocker), "utf8"), "occupied\n", "and it is left as it was");
    rmSync(dir, { recursive: true, force: true });
  }
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
  // Writable, or the plan refuses the directory before listing it.
  chmodSync(rules(dir), 0o300);

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

/* --- the two map directories sit in the repository's own .claude (F2) --- */

test("a map directory linked to a file is named by its own path, never by the file it points at", () => {
  // Measured: a committed `.claude/rules -> ../README.md` made the refusal read
  // "README.md is not a directory ... remove it and scan again", and an agent
  // following that sentence deletes the README. The link is what is in the way.
  const dir = workspace();
  writeFileSync(join(dir, "README.md"), "# readme\n");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "notes.md"), "notes\n");

  symlinkSync("notes.md", join(dir, RULES));
  for (const dryRun of [true, false]) {
    assert.throws(
      () => writeMap(result(dir, [area("src/services")]), { dryRun }),
      (err) =>
        err.message.startsWith(`${RULES} is a link to .claude/notes.md, which is not a directory`) &&
        !/remove it/.test(err.message),
      dryRun ? "dry run" : "real write"
    );
  }

  rmSync(join(dir, RULES));
  symlinkSync("../README.md", join(dir, RULES));
  assert.throws(
    () => writeMap(result(dir, [area("src/services")])),
    (err) => err.message.startsWith(`${RULES} is a link to README.md, which is not a directory`) && !/remove it/.test(err.message)
  );
  assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "# readme\n");
  assert.equal(readFileSync(join(dir, ".claude", "notes.md"), "utf8"), "notes\n");
  rmSync(dir, { recursive: true, force: true });
});

test("map directories linked where the tool must not write are refused, not written through", () => {
  // Measured: with committed `.claude/anatomiya -> ../.git/hooks`, a scan wrote
  // facts.json into .git/hooks while printing `.claude/...`. The store is held
  // to the repository's own `.claude`, and the map to the working tree outside
  // the git directory.
  for (const [link, target] of [
    [RULES, "../.git/hooks"],
    [STORE, "../.git/hooks"],
    [STORE, "../config"],
    [".claude", "config"],
  ]) {
    const dir = workspace();
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    mkdirSync(join(dir, "config"), { recursive: true });
    mkdirSync(join(dir, link, ".."), { recursive: true });
    symlinkSync(target, join(dir, link));

    for (const dryRun of [true, false]) {
      assert.throws(
        () => writeMap(result(dir, [area("src/services")]), { dryRun }),
        link === STORE ? /resolves outside the repository's own \.claude directory/ : /resolves where this tool does not write/,
        `${link}, ${dryRun ? "dry run" : "real write"}`
      );
    }
    assert.deepEqual(readdirSync(join(dir, "src")), [], `${link}: nothing in src`);
    assert.deepEqual(readdirSync(join(dir, ".git", "hooks")), [], `${link}: nothing in .git/hooks`);
    assert.deepEqual(readdirSync(join(dir, "config")), [], `${link}: nothing in config`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rules directory the repository shares between agents through a link is written through", () => {
  // Measured on calcom/cal.diy: a committed `.claude/rules -> ../agents/rules`
  // keeps one rules directory for every agent, and Claude Code reads it
  // through the link. Refused, the scan wrote nothing at all there.
  const dir = workspace();
  mkdirSync(join(dir, "agents", "rules"), { recursive: true });
  writeFileSync(join(dir, "agents", "rules", "house.md"), "# ours\n");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync("../agents/rules", join(dir, RULES));

  writeMap(result(dir, [area("src/services")]), { dryRun: true });
  writeMap(result(dir, [area("src/services")]));

  const written = readdirSync(join(dir, "agents", "rules"));
  assert.ok(written.includes("anatomiya-overview.md"), written.join(", "));
  assert.equal(readFileSync(join(dir, "agents", "rules", "house.md"), "utf8"), "# ours\n");
  assert.equal(existsSync(join(dir, STORE, "facts.json")), true, "the store stays in the repository's own .claude");
  rmSync(dir, { recursive: true, force: true });
});

test("a directory where facts.json or layout.json belongs is refused by name before a dry run answers", () => {
  // Measured: a committed directory at .claude/anatomiya/facts.json let a dry
  // run print "would write" and the real scan die on a raw EISDIR out of the
  // rename. layout.json is renamed into place beside it the same way.
  for (const leaf of ["facts.json", "layout.json"]) {
    const dir = workspace();
    mkdirSync(join(dir, STORE, leaf), { recursive: true });

    for (const dryRun of [true, false]) {
      assert.throws(
        () => writeMap(result(dir, [area("src/services")]), { dryRun }),
        (err) => err.message === `${STORE}/${leaf} is not a file, so the map could not be written: remove it and scan again`,
        `${leaf}, ${dryRun ? "dry run" : "real write"}`
      );
    }
    assert.equal(existsSync(join(dir, RULES)), false, `${leaf}: and nothing else was written`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a facts.json linked out of .claude is not read", () => {
  // The directory was resolved and the leaf was not, so a committed
  // `.claude/anatomiya/facts.json -> /elsewhere/facts.json` put a record outside
  // the repository in charge of what a branch is judged against.
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  writeFacts(outside, result(outside, [area("src/elsewhere")]));
  mkdirSync(join(dir, STORE), { recursive: true });
  symlinkSync(join(outside, STORE, "facts.json"), join(dir, STORE, "facts.json"));

  const { facts, unreadable } = readFactsFrom(dir);

  assert.equal(facts, null);
  assert.match(unreadable, /resolves outside the repository/);
  // A write still replaces the link rather than writing through it.
  writeMap(result(dir, [area("src/services")]));
  assert.deepEqual(readFactsFrom(outside).facts.areas.map((a) => a.path), ["src/elsewhere"]);
  assert.deepEqual(readFactsFrom(dir).facts.areas.map((a) => a.path), ["src/services"]);
  rmSync(outside, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("a held area whose committed record is malformed is dropped, not carried into a crash", () => {
  // Measured: `dimensions: [null]` on a held area in a committed facts.json
  // took the scan down with "Cannot read properties of null (reading
  // 'states')". Only the array was checked, never what was in it.
  const dir = workspace();
  const models = area("app/models");
  const services = area("app/services");
  writeMap(result(dir, [models, services]));
  const record = readFacts(dir);
  const whole = record.areas.find((a) => a.id === models.id).dimensions[0];

  for (const bad of [[null], [42], [[]], [{ key: "k" }], [{ ...whole, candidates: "x" }], [{ ...whole, exceptions: null }]]) {
    const edited = { ...record, areas: record.areas.map((a) => (a.id === models.id ? { ...a, dimensions: bad } : a)) };
    writeFileSync(join(dir, STORE, "facts.json"), JSON.stringify(edited));

    const partial = result(dir, [area("app/services")]);
    partial.parse = { ...partial.parse, unreadable: ["ruby"] };
    partial.held = [{ id: models.id, path: models.path, fileCount: models.fileCount }];
    partial.readNothing = false;

    const plan = writeMap(partial, { dryRun: true });
    assert.deepEqual(plan.held, [], JSON.stringify(bad));
  }
  rmSync(dir, { recursive: true, force: true });
});

/* --- the same map in the Cursor and Copilot directories --- */

const { cursor, copilot } = TARGETS;
const ALL = ["claude", "cursor", "copilot"];
const OTHERS = [cursor, copilot];
const namesIn = (dir, target) => (existsSync(join(dir, target.dir)) ? readdirSync(join(dir, target.dir)).sort() : null);
const mapOf = (target, ...areas) => [...areas.map((a) => areaName(target, a.id)), overviewName(target)].sort();
const OURS = "---\ngenerator: anatomiya\n---\n\nan older build\n";

/** Every file under the root by its path, with its bytes, and a link as where it leads. */
function tree(dir, rel = "") {
  const out = {};
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const at = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) out[at] = "-> link";
    else if (e.isDirectory()) Object.assign(out, { [`${at}/`]: "", ...tree(dir, at) });
    else out[at] = readFileSync(join(dir, at), "utf8");
  }
  return out;
}

/** The tree with the layout file's stamp left out, as `unstamped` does for a snapshot. */
function settled(dir) {
  const all = tree(dir);
  const key = `${STORE}/layout.json`;
  if (key in all) {
    const layout = JSON.parse(all[key]);
    delete layout.record;
    all[key] = layout;
  }
  return all;
}

/** Count and record every call of one `node:fs` export, and make the `n`th from now throw when armed. */
async function watched(t, name) {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs[name];
  const watch = { calls: [], left: 0, failOn: (n) => { watch.left = n; } };
  fs[name] = (...args) => {
    watch.calls.push(args);
    if (watch.left > 0 && --watch.left === 0) throw Object.assign(new Error(`EPERM: operation not permitted, ${name}`), { code: "EPERM" });
    return real(...args);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs[name] = real;
    syncBuiltinESMExports();
  });
  return watch;
}

const BEFORE_PLAN = {
  write: ["anatomiya-overview.md", "anatomiya-area-5c06cdf8.md"],
  remove: [],
  foreign: [],
  unknown: [],
  replaced: [],
  unreadableRules: [],
  listed: true,
  uncovered: 20,
  orphaned: 8,
  unreadable: [],
  held: [],
  blind: false,
};
const BEFORE_KEYS = ["write", "remove", "foreign", "unknown", "replaced", "unreadableRules", "listed", "uncovered", "orphaned", "unreadable", "held", "bodies", "blind", "root", "result"];
const BEFORE_AREA = `---
generator: anatomiya
paths:
  - "src/services/**/*.ts"
---

# src/services  40 files

catch blocks use the error they caught
  21 of 22 sites across 8 of 40 files, 4 authors
  except "src/services/legacy.ts"
`;
const BEFORE_OVERVIEW = `---
generator: anatomiya
---

# Repository map

Facts counted from this repository's own code, per directory.
A claim states how many sites conform out of how many were eligible; "no convention" means the gate in parentheses stopped it, and its sites may still all agree.

Read a file before editing it: these notes load when you read, not when you grep.
When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.
When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion.

## Areas (2)

- src/services — 40 files, 1 stated
- and 1 more area in its own file, loaded when you read one of its files

## Not covered

- 8 source files sit in no area (at the repository root, under the per-directory floor, or under a name no glob can spell)
- 12 source files sit in a directory nothing was counted in
- memory, GC and I/O behaviour: runtime only, nothing static to count

Generated files: 2 under .claude/rules/anatomiya-*.md
Any other file there was not written by this tool.
`;
// The record as the build before the targets wrote it.
const BEFORE_FACTS = {
  schema: 19,
  root: "<root>",
  scannedAt: "2026-01-01T00:00:00.000Z",
  corpus: { files: 100, truncated: false, dropped: {}, orphaned: 8 },
  parse: { parsed: 100, crashed: 0, skipped: 0 },
  semantic: { ran: false, status: null, reason: null, typedResolutionRate: null },
  suppressAll: false,
  authors: null,
  layout: null,
  areas: [
    {
      id: "5c06cdf8",
      path: "src/services",
      globs: [{ negated: false, dir: "src/services", tail: "**/*.ts" }],
      fileCount: 40,
      kinds: null,
      imports: null,
      reused: null,
      dimensions: [
        {
          key: "swallowed_error",
          precision: "precise",
          applicability: 8,
          langFileCount: 40,
          candidates: 22,
          conforming: 21,
          authors: 4,
          ratio: 0.9545,
          bound: 0,
          priorBound: 0,
          directive: true,
          gate: null,
          exceptions: [{ path: "src/services/legacy.ts", count: 1 }],
          moreExceptions: 0,
          states: "claim",
        },
      ],
    },
    { id: "15bf0633", path: "src/types", globs: [{ negated: false, dir: "src/types", tail: "**/*.ts" }], fileCount: 40, kinds: null, imports: null, reused: null, dimensions: [] },
  ],
};

test("with no target asked for and none on, the plan and the disk are what they were", (t) => {
  // Every literal here was captured from the build before a second directory existed.
  const dir = workspace(t);
  const scan = result(dir, [area("src/services"), area("src/types", [])]);

  const plan = writeMap(scan);

  const { bodies, result: planned, root, targets, ...fields } = plan;
  assert.deepEqual(fields, BEFORE_PLAN);
  assert.deepEqual(Object.keys(plan).filter((k) => k !== "targets"), BEFORE_KEYS);
  assert.equal(root, dir);
  assert.equal(planned, scan, "the scan itself, with nothing added to it");
  assert.deepEqual([...bodies], [["anatomiya-overview.md", BEFORE_OVERVIEW], ["anatomiya-area-5c06cdf8.md", BEFORE_AREA]]);
  assert.deepEqual(Object.keys(tree(dir)), [
    ".claude/",
    ".claude/anatomiya/",
    ".claude/anatomiya/facts.json",
    ".claude/anatomiya/layout.json",
    ".claude/rules/",
    ".claude/rules/anatomiya-area-5c06cdf8.md",
    ".claude/rules/anatomiya-overview.md",
  ]);
  assert.equal(readFileSync(join(rules(dir), "anatomiya-overview.md"), "utf8"), BEFORE_OVERVIEW);
  assert.equal(readFileSync(join(rules(dir), "anatomiya-area-5c06cdf8.md"), "utf8"), BEFORE_AREA);
  const record = readFileSync(join(dir, STORE, "facts.json"), "utf8");
  assert.equal(record, JSON.stringify({ ...BEFORE_FACTS, root: dir }, null, 2) + "\n", "the record's bytes, key order included");
  assert.equal("targets" in JSON.parse(record), false);
  const { record: stamp, ...layout } = JSON.parse(readFileSync(join(dir, STORE, "layout.json"), "utf8"));
  assert.deepEqual(layout, { schema: 19, layout: null });
  assert.deepEqual(Object.keys(stamp), ["size", "mtimeMs"]);
  for (const t of OTHERS) {
    assert.deepEqual(
      { state: targets[t.id].state, on: targets[t.id].on, write: targets[t.id].write, remove: targets[t.id].remove },
      { state: "off", on: false, write: [], remove: [] }
    );
  }
});

test("a named target gets the overview and one file per area with a directive", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  const scan = () => result(dir, [a, b, area("src/types", [])]);

  const dry = writeMap(scan(), { dryRun: true, targets: ALL });
  assert.deepEqual(tree(dir), {}, "a dry run creates nothing in any directory");
  assert.deepEqual(dry.targets.cursor.write.map((w) => w.name).sort(), mapOf(cursor, a, b));

  const plan = writeMap(scan(), { targets: ALL });

  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a, b));
  for (const t of OTHERS) {
    assert.deepEqual(namesIn(dir, t), mapOf(t, a, b), t.id);
    const mine = plan.targets[t.id];
    assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(t, a, b));
    assert.deepEqual({ dir: mine.dir, state: mine.state, on: mine.on, remove: mine.remove, unfiled: mine.unfiled }, { dir: t.dir, state: "off", on: true, remove: [], unfiled: [] });
    for (const { name, body } of mine.write) {
      assert.equal(readFileSync(join(dir, t.dir, name), "utf8"), body, name);
      assert.ok(isOwned(body), name);
    }
    assert.match(readFileSync(join(dir, t.dir, overviewName(t)), "utf8"), new RegExp(`^Generated files: 3 under ${t.dir.replaceAll(".", "\\.")}/`, "m"));
  }
  const head = (t) => readFileSync(join(dir, t.dir, areaName(t, a.id)), "utf8").split("\n").slice(0, 5);
  assert.deepEqual(head(cursor), ["---", "generator: anatomiya", "globs: src/services/**/*.ts", "alwaysApply: false", "---"]);
  assert.deepEqual(head(copilot).slice(0, 4), ["---", "generator: anatomiya", 'applyTo: "src/services/**/*.ts"', "---"]);
  assert.deepEqual(readFacts(dir).targets, { cursor: mapOf(cursor, a, b), copilot: mapOf(copilot, a, b) });
  for (const t of OTHERS) assert.deepEqual(readdirSync(join(dir, t.dir)).filter((n) => n.includes(".tmp-")), []);
});

test("every directory's overview names the areas claude's does, whatever else each directory holds", (t) => {
  const dir = workspace(t);
  const areas = Array.from({ length: 30 }, (_, i) => area(`src/a${String(i).padStart(2, "0")}`));
  mkdirSync(rules(dir), { recursive: true });
  // Six files of somebody's in Claude Code's directory, each a line of its overview that an area would have had.
  for (let i = 0; i < 6; i++) writeFileSync(join(rules(dir), `house-${i}.md`), "# by hand\n");

  writeMap(result(dir, areas), { targets: ALL });

  const named = (target) =>
    readFileSync(join(dir, target.dir, overviewName(target)), "utf8").split("\n").filter((l) => /^- (src\/a\d\d|and \d+ more areas)/.test(l)).map((l) => l.replace(target.listed, "LISTED"));
  const mine = named(TARGETS.claude);
  assert.ok(mine.length > 2 && mine.length < 30, mine.join("\n"));
  for (const target of OTHERS) assert.deepEqual(named(target), mine, target.id);
});

test("a target stays on without being named again", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a]), { targets: ["claude", "cursor"] });

  const plan = writeMap(result(dir, [a, b]));

  assert.deepEqual(namesIn(dir, cursor), mapOf(cursor, a, b));
  assert.deepEqual({ state: plan.targets.cursor.state, on: plan.targets.cursor.on }, { state: "on", on: true });
  assert.equal(namesIn(dir, copilot), null, "the one never asked for is not created");
  assert.equal(existsSync(join(dir, ".github")), false);
  assert.deepEqual(readFacts(dir).targets, { cursor: mapOf(cursor, a, b) });
});

test("a target a plain scan writes while the record names no file there is marked as its first write, once", (t) => {
  const a = area("src/services");
  const dir = workspace(t);
  assert.equal(writeMap(result(dir, [a]), { targets: ALL }).targets.cursor.first, false, "named, so nobody needs telling");
  // A clone: the committed files, and no record.
  rmSync(join(dir, STORE), { recursive: true, force: true });

  assert.deepEqual(OTHERS.map((o) => planMap(result(dir, [a])).targets[o.id].first), [true, true], "a dry run says it too");
  const plan = writeMap(result(dir, [a]));
  const again = writeMap(result(dir, [a]));

  assert.deepEqual(OTHERS.map((o) => plan.targets[o.id].first), [true, true]);
  assert.deepEqual(OTHERS.map((o) => again.targets[o.id].first), [false, false]);
  assert.equal(writeMap(result(dir, [a]), { targets: ["claude"] }).targets.cursor.first, false);
});

test("a file that cannot be replaced or removed is named in a sentence with its directory and what to do", async (t) => {
  const a = area("src/services");
  const b = area("src/api");
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = { renameSync: fs.renameSync, unlinkSync: fs.unlinkSync };
  let locked = null;
  for (const name of Object.keys(real)) {
    fs[name] = (...args) => {
      const at = String(args.at(-1)).split(sep).join("/");
      if (locked !== null && at.endsWith(`/${locked.at}`)) throw Object.assign(new Error(`${locked.code}: operation not permitted, ${name} '${args[0]}'`), { code: locked.code });
      return real[name](...args);
    };
  }
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(fs, real);
    syncBuiltinESMExports();
  });
  const said = (at, verb, code) =>
    `${at} could not be ${verb} (${code}), so the scan stopped and put back what it had replaced: ` +
    "the file is locked or read-only, so close what holds it or change its mode, then scan again";

  for (const [at, code] of [
    [`${copilot.dir}/${areaName(copilot, a.id)}`, "EPERM"],
    [`${cursor.dir}/${overviewName(cursor)}`, "EBUSY"],
    [`${RULES}/${areaFilename(a)}`, "EACCES"],
    [`${STORE}/facts.json`, "EPERM"],
  ]) {
    const dir = workspace(t);
    writeMap(result(dir, [a]), { targets: ALL });
    const before = unstamped(snapshot(dir));
    const theirs = OTHERS.map((o) => tree(join(dir, o.dir)));
    locked = { at, code };

    assert.throws(() => writeMap(result(dir, [a, b])), { message: said(at, "replaced", code) }, at);

    locked = null;
    assert.deepEqual(unstamped(snapshot(dir)), before, at);
    assert.deepEqual(OTHERS.map((o) => tree(join(dir, o.dir))), theirs, `${at}: and no temporary file is left`);
  }

  const dir = workspace(t);
  writeMap(result(dir, [a, b]), { targets: ALL });
  locked = { at: `${cursor.dir}/${areaName(cursor, b.id)}`, code: "EPERM" };
  assert.throws(() => writeMap(result(dir, [a])), { message: said(locked.at, "removed", "EPERM") });

  // Anything else is not a lock, so it is not called one.
  locked = { at: `${cursor.dir}/${overviewName(cursor)}`, code: "ENOSPC" };
  assert.throws(() => writeMap(result(dir, [a, b])), { code: "ENOSPC" });
  locked = null;
});

test("a locked file whose rollback loses a file says the scan stopped part way, and never that everything was put back", async (t) => {
  const a = area("src/services");
  const b = area("src/api");
  const dir = workspace(t);
  writeMap(result(dir, [a]));
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  let renames = 0;
  // Two files take their replacement, the third is locked, and so is every put-back after it.
  fs.renameSync = (...args) => {
    if (++renames > 2) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${args[0]}'`), { code: "EPERM" });
    return real(...args);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = real;
    syncBuiltinESMExports();
  });

  assert.throws(() => writeMap(result(dir, [a, b])), {
    message: /^\.claude\/\S+ could not be replaced \(EPERM\), so the scan stopped part way: the file is locked or read-only, so close what holds it or change its mode, then scan again$/,
  });
  assert.ok(renames > 3, "a put-back was tried and refused");
});

test("naming claude alone turns the others off and removes every file there that says this tool wrote it", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a, b]), { targets: ALL });
  const planted = {};
  for (const t of OTHERS) {
    planted[`${t.dir}/team${t.ext}`] = "# the team's own rule\n";
    planted[`${t.dir}/${PREFIX}notes${t.ext}`] = "# our name, nobody's key\n";
    planted[`${t.dir}/${PREFIX}area-deadbeef${t.ext}`] = OURS;
  }
  for (const [at, body] of Object.entries(planted)) writeFileSync(join(dir, at), body);
  const claudeBefore = snapshot(dir);

  const plan = writeMap(result(dir, [a, b]), { targets: ["claude"] });

  for (const t of OTHERS) {
    const mine = plan.targets[t.id];
    // The record never listed the last of them: leaving the target out by name is what removes it.
    assert.deepEqual(mine.remove, [...mapOf(t, a, b), `${PREFIX}area-deadbeef${t.ext}`].sort(), t.id);
    assert.deepEqual(mine.write, []);
    assert.deepEqual(mine.foreign, [`${PREFIX}notes${t.ext}`]);
    assert.deepEqual(mine.unknown, []);
    assert.deepEqual({ state: mine.state, on: mine.on }, { state: "on", on: false });
    assert.deepEqual(namesIn(dir, t), [`${PREFIX}notes${t.ext}`, `team${t.ext}`].sort());
    assert.equal(targetState(dir, t), "off");
  }
  for (const [at, body] of Object.entries(planted)) {
    if (!at.includes("deadbeef")) assert.equal(readFileSync(join(dir, at), "utf8"), body, at);
  }
  assert.equal("targets" in readFacts(dir), false, "nothing was written there, so the record names nothing there");
  const claudeAfter = snapshot(dir);
  for (const name of listRules(dir)) assert.equal(claudeAfter[`${RULES}/${name}`], claudeBefore[`${RULES}/${name}`], name);

  const again = writeMap(result(dir, [a, b]));
  for (const t of OTHERS) assert.deepEqual({ on: again.targets[t.id].on, write: again.targets[t.id].write, remove: again.targets[t.id].remove }, { on: false, write: [], remove: [] });
});

test("a file with our name and extension but no generator key is never removed when a target is turned off", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  writeMap(result(dir, [a]), { targets: ALL });
  // The record still names it: the prefix and the record are two facts of three.
  const body = "# written by hand over a name the record lists\n";
  for (const t of OTHERS) writeFileSync(join(dir, t.dir, areaName(t, a.id)), body);

  const plan = writeMap(result(dir, [a]), { targets: ["claude"] });

  for (const t of OTHERS) {
    assert.deepEqual(plan.targets[t.id].remove, [overviewName(t)]);
    assert.deepEqual(plan.targets[t.id].foreign, [areaName(t, a.id)]);
    assert.deepEqual(namesIn(dir, t), [areaName(t, a.id)]);
    assert.equal(readFileSync(join(dir, t.dir, areaName(t, a.id)), "utf8"), body);
  }
});

test("a file with our generator key that the record does not list is removed only when its target is left out by name", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  writeMap(result(dir, [a]), { targets: ALL });
  for (const target of OTHERS) writeFileSync(join(dir, target.dir, areaName(target, "99999999")), OURS);

  // Stale by name while the target is on, and two facts of three.
  for (const targets of [null, ALL]) {
    const on = writeMap(result(dir, [a]), { targets });
    for (const target of OTHERS) {
      assert.deepEqual(on.targets[target.id].remove, [], JSON.stringify(targets));
      assert.deepEqual(on.targets[target.id].unknown, [areaName(target, "99999999")]);
      assert.equal(readFileSync(join(dir, target.dir, areaName(target, "99999999")), "utf8"), OURS);
    }
  }

  const off = writeMap(result(dir, [a]), { targets: ["claude"] });
  for (const target of OTHERS) {
    assert.deepEqual(off.targets[target.id].remove, [areaName(target, "99999999"), ...mapOf(target, a)].sort());
    assert.deepEqual(off.targets[target.id].unknown, []);
    assert.deepEqual(namesIn(dir, target), []);
  }
});

test("turning a target off removes only the names a scan gives a file, whatever else carries the key", (t) => {
  const a = area("src/services");
  const kept = (target) => [
    `${PREFIX}my-notes${target.ext}`,
    `${PREFIX}overview copy${target.ext}`,
    `${PREFIX}overview${target.ext}.bak${target.ext}`,
    `${PREFIX}area-DEADBEEF${target.ext}`,
    `${PREFIX}area-deadbee${target.ext}`,
    `${PREFIX}area-deadbeef0${target.ext}`,
  ].sort();

  // With the record, and as a clone holds it: without. A record naming them makes no difference either.
  for (const record of ["kept", "gone", "names them"]) {
    const dir = workspace(t);
    writeMap(result(dir, [a]), { targets: ALL });
    for (const target of OTHERS) for (const name of kept(target)) writeFileSync(join(dir, target.dir, name), OURS);
    if (record === "gone") rmSync(join(dir, STORE), { recursive: true, force: true });
    if (record === "names them") {
      const facts = readFacts(dir);
      for (const target of OTHERS) facts.targets[target.id].push(...kept(target));
      writeFileSync(join(dir, STORE, "facts.json"), JSON.stringify(facts));
    }

    const plan = writeMap(result(dir, [a]), { targets: ["claude"] });

    for (const target of OTHERS) {
      assert.deepEqual(plan.targets[target.id].remove, mapOf(target, a), `${target.id}, record ${record}`);
      assert.deepEqual(namesIn(dir, target), kept(target), `${target.id}, record ${record}`);
      for (const name of kept(target)) assert.equal(readFileSync(join(dir, target.dir, name), "utf8"), OURS, name);
    }
  }
});

/** What a fresh clone holds: a target's files committed, and no record beside them. */
function cloned(t, a, b) {
  const dir = workspace(t);
  writeMap(result(dir, [a, b]), { targets: ALL });
  for (const target of OTHERS) {
    writeFileSync(join(dir, target.dir, `team${target.ext}`), "# the team's own rule\n");
    writeFileSync(join(dir, target.dir, `${PREFIX}notes${target.ext}`), "# our name, nobody's key\n");
  }
  rmSync(join(dir, STORE), { recursive: true, force: true });
  return dir;
}

test("a target is turned off by name whether or not the record lists its files", (t) => {
  const a = area("src/services");
  const b = area("src/api");
  const theirs = (target) => [`${PREFIX}notes${target.ext}`, `team${target.ext}`];
  const dir = cloned(t, a, b);

  const dry = writeMap(result(dir, [a, b]), { dryRun: true, targets: ["claude"] });
  for (const target of OTHERS) {
    assert.deepEqual(dry.targets[target.id].remove, mapOf(target, a, b), "a dry run says so");
    assert.deepEqual(namesIn(dir, target), [...mapOf(target, a, b), ...theirs(target)].sort(), "and removes nothing");
  }

  const plan = writeMap(result(dir, [a, b]), { targets: ["claude"] });

  for (const target of OTHERS) {
    const mine = plan.targets[target.id];
    assert.deepEqual({ state: mine.state, on: mine.on, write: mine.write, unknown: mine.unknown }, { state: "on", on: false, write: [], unknown: [] });
    assert.deepEqual(mine.remove, mapOf(target, a, b));
    assert.deepEqual(mine.foreign, [`${PREFIX}notes${target.ext}`]);
    assert.deepEqual(namesIn(dir, target), theirs(target), "what does not say this tool wrote it stays");
    assert.equal(readFileSync(join(dir, target.dir, `${PREFIX}notes${target.ext}`), "utf8"), "# our name, nobody's key\n");
    assert.equal(targetState(dir, target), "off");
  }
  assert.equal("targets" in readFacts(dir), false);
  const again = writeMap(result(dir, [a, b]));
  for (const target of OTHERS) assert.deepEqual({ state: again.targets[target.id].state, on: again.targets[target.id].on, write: again.targets[target.id].write }, { state: "off", on: false, write: [] });
});

test("with no record and no target named, nothing in a target is removable", (t) => {
  const a = area("src/services");
  const b = area("src/api");
  const dir = cloned(t, a, b);

  const plan = writeMap(result(dir, [a]));

  for (const target of OTHERS) {
    assert.deepEqual({ state: plan.targets[target.id].state, on: plan.targets[target.id].on }, { state: "on", on: true });
    assert.deepEqual(plan.targets[target.id].remove, []);
    assert.deepEqual(plan.targets[target.id].unknown, [areaName(target, b.id)], "the area that went away is two facts of three");
    assert.deepEqual(namesIn(dir, target), [...mapOf(target, a, b), `${PREFIX}notes${target.ext}`, `team${target.ext}`].sort());
  }
});

const HAND = "---\nalwaysApply: true\n---\n# Written by hand\n";
const moved = (target, did) =>
  `${target.dir} was replaced by something else while the map was being written, so the scan ${did}: look at what is at ${target.dir} now, then scan again`;
const UNTOUCHED = "stopped before writing anything there";
const PUT_BACK = "stopped and put back what it had replaced";
const PUT_BACK_ELSEWHERE = "stopped and put back what it had replaced everywhere else";
const refusal = (target, name, what = "was not written by this tool") =>
  `${target.dir}/${name} ${what}, so ${target.dir} could not be written and nothing was written anywhere: move or delete it and scan again`;

test("a foreign overview does not turn a target on", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  for (const target of OTHERS) {
    mkdirSync(join(dir, target.dir), { recursive: true });
    writeFileSync(join(dir, target.dir, overviewName(target)), HAND);
  }

  const left = writeMap(result(dir, [a]));

  for (const target of OTHERS) {
    assert.deepEqual({ state: left.targets[target.id].state, on: left.targets[target.id].on }, { state: "off", on: false });
    assert.deepEqual(left.targets[target.id].foreign, [overviewName(target)], "said to be somebody else's");
    assert.deepEqual(left.targets[target.id].replaced, []);
    assert.deepEqual(namesIn(dir, target), [overviewName(target)]);
    assert.equal(readFileSync(join(dir, target.dir, overviewName(target)), "utf8"), HAND);
  }
});

test("a person's file at a name a named target writes refuses the scan before anything is written anywhere", (t) => {
  const a = area("src/services");
  for (const target of OTHERS) {
    for (const name of [overviewName(target), areaName(target, a.id)]) {
      const dir = workspace(t);
      mkdirSync(join(dir, target.dir), { recursive: true });
      writeFileSync(join(dir, target.dir, name), HAND);
      const before = tree(dir);

      for (const dryRun of [true, false]) {
        assert.throws(
          () => writeMap(result(dir, [a]), { dryRun, targets: ["claude", target.id] }),
          (err) => err.message === refusal(target, name),
          `${name}, ${dryRun ? "dry run" : "real write"}`
        );
      }

      assert.deepEqual(tree(dir), before, `${name}: its bytes, and no directory of Claude Code's either`);
    }
  }
});

test("a person's file at a name a target that is merely on writes is left as it is, and that area has no file there", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a, b]), { targets: ALL });
  // Taking the key out is how a person says the file is theirs now.
  for (const target of OTHERS) writeFileSync(join(dir, target.dir, areaName(target, b.id)), HAND);
  const overviews = () => OTHERS.map((target) => readFileSync(join(dir, target.dir, overviewName(target)), "utf8"));

  const plan = writeMap(result(dir, [a, b]));

  for (const target of OTHERS) {
    const mine = plan.targets[target.id];
    assert.deepEqual({ state: mine.state, on: mine.on, remove: mine.remove, replaced: mine.replaced }, { state: "on", on: true, remove: [], replaced: [] });
    assert.deepEqual(mine.foreign, [areaName(target, b.id)]);
    assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(target, a), "the name is not planned");
    assert.equal(readFileSync(join(dir, target.dir, areaName(target, b.id)), "utf8"), HAND);
    assert.deepEqual(readFacts(dir).targets[target.id], mapOf(target, a), "and the record does not call it ours");
    const overview = readFileSync(join(dir, target.dir, overviewName(target)), "utf8");
    assert.match(overview, /^## Areas \(1\)$/m, "the overview promises no notes for it");
    assert.match(overview, /^Generated files: 2 under /m);
    assert.ok(overview.includes(`- "${areaName(target, b.id)}"`), "and names it as a file this tool did not write");
  }
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a, b));
  const first = overviews();
  writeMap(result(dir, [a, b]));
  assert.deepEqual(overviews(), first, "byte-stable across two scans of unchanged source");

  // Named, the same file refuses; turned off, it stays.
  const before = tree(dir);
  assert.throws(() => writeMap(result(dir, [a, b]), { targets: ALL }), (err) => err.message === refusal(cursor, areaName(cursor, b.id)));
  assert.deepEqual(tree(dir), before);
  writeMap(result(dir, [a, b]), { targets: ["claude"] });
  for (const target of OTHERS) {
    assert.deepEqual(namesIn(dir, target), [areaName(target, b.id)]);
    assert.equal(readFileSync(join(dir, target.dir, areaName(target, b.id)), "utf8"), HAND);
  }
});

// Whether this volume answers for a name spelled in another case, as macOS and Windows do by default.
const FOLDS = (() => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-fold-"));
  try {
    writeFileSync(join(dir, "probe"), "");
    return existsSync(join(dir, "PROBE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

test("an overview spelled in another case is somebody's file: the target reads off, and naming it refuses", (t) => {
  const a = area("src/services");
  for (const target of OTHERS) {
    // Keyed too: a name this tool never spells is not its file, whatever the file says.
    for (const body of [HAND, OURS]) {
      const dir = workspace(t);
      const theirs = overviewName(target).replace("anatomiya-overview", "Anatomiya-Overview");
      mkdirSync(join(dir, target.dir), { recursive: true });
      writeFileSync(join(dir, target.dir, theirs), body);
      assert.equal(existsSync(join(dir, target.dir, overviewName(target))), FOLDS, "the control: this volume folds the two names, or keeps them apart");
      const before = tree(dir);

      assert.equal(targetState(dir, target), "off", target.id);
      for (const dryRun of [true, false]) {
        assert.throws(
          () => writeMap(result(dir, [a]), { dryRun, targets: ["claude", target.id] }),
          (err) => err.message === refusal(target, theirs),
          `${target.id}, ${dryRun ? "dry run" : "real write"}`
        );
      }
      assert.deepEqual(tree(dir), before, "named: its bytes, and nothing of Claude Code's either");

      const plan = writeMap(result(dir, [a]));
      const mine = plan.targets[target.id];
      assert.deepEqual({ state: mine.state, on: mine.on, write: mine.write, remove: mine.remove }, { state: "off", on: false, write: [], remove: [] });
      assert.deepEqual(namesIn(dir, target), [theirs]);
      assert.equal(readFileSync(join(dir, target.dir, theirs), "utf8"), body, "not named: its bytes");
    }
  }
});

test("an entry spelled as an area's name in another case holds that name", (t) => {
  const a = area("src/services");
  const b = area("src/api");
  const spellings = (target) => {
    const name = areaName(target, b.id);
    return [
      name.replace(b.id, b.id.toUpperCase()),
      name.replace(PREFIX, "Anatomiya-"),
      name.slice(0, -target.ext.length) + target.ext.toUpperCase(),
      // The long s, which APFS folds onto `s` and a plain lower-casing does not.
      name.replace("area", "area".replace("a", "A")).replace(target.ext, target.ext.replace("s", "ſ")),
    ];
  };
  for (const target of OTHERS) {
    for (const theirs of spellings(target)) {
      for (const body of [HAND, OURS]) {
        const dir = workspace(t);
        const said = `${target.id}, ${theirs}`;
        assert.notEqual(theirs, areaName(target, b.id));
        writeMap(result(dir, [a, b]), { targets: ["claude", target.id] });
        rmSync(join(dir, target.dir, areaName(target, b.id)));
        writeFileSync(join(dir, target.dir, theirs), body);
        assert.equal(existsSync(join(dir, target.dir, areaName(target, b.id))), FOLDS, `${said}: the control`);
        const held = [theirs, ...mapOf(target, a)].sort();

        for (const dryRun of [true, false]) {
          const mine = writeMap(result(dir, [a, b]), { dryRun }).targets[target.id];
          assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(target, a), `${said}: the name is not planned`);
          assert.deepEqual({ foreign: mine.foreign, unknown: mine.unknown, remove: mine.remove }, { foreign: [theirs], unknown: [], remove: [] }, said);
        }
        assert.deepEqual(namesIn(dir, target), held, said);
        assert.equal(readFileSync(join(dir, target.dir, theirs), "utf8"), body, `${said}: its bytes after a plain scan`);
        assert.deepEqual(readFacts(dir).targets[target.id], mapOf(target, a), `${said}: the record does not call it ours`);
        // A name outside ASCII goes through the overview's encoder, which is not this test's subject.
        if (/^[\x20-\x7e]+$/.test(theirs)) {
          assert.ok(readFileSync(join(dir, target.dir, overviewName(target)), "utf8").includes(`- "${theirs}"`), `${said}: the overview names it as spelled`);
        }

        const before = tree(dir);
        for (const dryRun of [true, false]) {
          assert.throws(() => writeMap(result(dir, [a, b]), { dryRun, targets: ["claude", target.id] }), (err) => err.message === refusal(target, theirs), said);
        }
        assert.deepEqual(tree(dir), before, `${said}: its bytes after a named scan`);

        const off = writeMap(result(dir, [a, b]), { targets: ["claude"] });
        assert.deepEqual(off.targets[target.id].remove, mapOf(target, a), `${said}: removal is by the exact name`);
        assert.deepEqual(namesIn(dir, target), [theirs]);
        assert.equal(readFileSync(join(dir, target.dir, theirs), "utf8"), body);
      }
    }
  }
});

test("a volume that tells two spellings apart keeps both: the other spelling is an ordinary file there", (t) => {
  const volume = caseSensitiveDir(t);
  if (volume.skip) return t.skip(volume.skip);
  const a = area("src/services");
  const b = area("src/api");
  for (const target of OTHERS) {
    for (const body of [HAND, OURS]) {
      const dir = mkdtempSync(join(volume.dir, "repo-"));
      const said = `${target.id}, ${body === OURS ? "keyed" : "keyless"}`;
      const named = ["claude", target.id];
      writeMap(result(dir, [a, b]), { targets: named });
      const overview = overviewName(target).replace("anatomiya-overview", "Anatomiya-Overview");
      const areaFile = areaName(target, b.id).replace(b.id, b.id.toUpperCase());
      for (const name of [overview, areaFile, `team${target.ext}`]) writeFileSync(join(dir, target.dir, name), body);
      const all = [...mapOf(target, a, b), overview, areaFile, `team${target.ext}`].sort();
      assert.deepEqual(namesIn(dir, target), all, `${said}: the control, both spellings are in the listing`);
      assert.equal(targetState(dir, target), "on", said);

      // Under the prefix it is listed as any file there that the record does not name; outside it, as `team` is: not at all.
      const others = body === OURS ? { foreign: [], unknown: [areaFile] } : { foreign: [areaFile], unknown: [] };
      for (const targets of [undefined, named]) {
        for (const dryRun of [true, false]) {
          const mine = writeMap(result(dir, [a, b]), { dryRun, targets }).targets[target.id];
          const how = `${said}, ${targets ? "named" : "plain"}, ${dryRun ? "dry run" : "real write"}`;
          assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(target, a, b), `${how}: every exact name is planned`);
          assert.deepEqual({ foreign: mine.foreign, unknown: mine.unknown, remove: mine.remove, replaced: mine.replaced }, { ...others, remove: [], replaced: [] }, how);
        }
      }
      assert.deepEqual(namesIn(dir, target), all, said);
      for (const name of [overview, areaFile]) assert.equal(readFileSync(join(dir, target.dir, name), "utf8"), body, `${said}: ${name} keeps its bytes`);
      assert.deepEqual(readFacts(dir).targets[target.id], mapOf(target, a, b), `${said}: the record names the exact spellings alone`);

      const off = writeMap(result(dir, [a, b]), { targets: ["claude"] });
      assert.deepEqual(off.targets[target.id].remove, mapOf(target, a, b), `${said}: removal is by the exact name`);
      assert.deepEqual(namesIn(dir, target), [overview, areaFile, `team${target.ext}`].sort(), said);
    }
  }
});

/** What a scan does with an entry at an area's name that no rename can replace, in each other directory. */
function oddEntryAtAnAreaName(t, make) {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a, b]), { targets: ALL });
  for (const target of OTHERS) {
    rmSync(join(dir, target.dir, areaName(target, b.id)));
    make(join(dir, target.dir, areaName(target, b.id)));
  }
  const still = () => OTHERS.map((target) => lstatSync(join(dir, target.dir, areaName(target, b.id))).isFile());

  // Merely on: the scan goes on, and the name is somebody else's.
  for (const dryRun of [true, false]) {
    const plan = writeMap(result(dir, [a, b]), { dryRun });
    for (const target of OTHERS) {
      const mine = plan.targets[target.id];
      assert.deepEqual({ state: mine.state, on: mine.on, remove: mine.remove, replaced: mine.replaced }, { state: "on", on: true, remove: [], replaced: [] });
      assert.deepEqual(mine.foreign, [areaName(target, b.id)]);
      assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(target, a), "the name is not planned");
    }
  }
  assert.deepEqual(still(), [false, false], "the entry is what it was");
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a, b), "and the rest was written");
  for (const target of OTHERS) {
    assert.deepEqual(readFacts(dir).targets[target.id], mapOf(target, a));
    const overview = readFileSync(join(dir, target.dir, overviewName(target)), "utf8");
    assert.match(overview, /^## Areas \(1\)$/m);
    assert.ok(overview.includes(`- "${areaName(target, b.id)}"`), "named as a file this tool did not write");
  }

  // Named, it refuses as a person's file does; turned off, it stays.
  // Not `tree`: reading a fifo never returns.
  const held = () => [readFileSync(join(dir, STORE, "facts.json"), "utf8"), listRules(dir), ...OTHERS.map((target) => namesIn(dir, target))];
  const before = held();
  for (const dryRun of [true, false]) {
    assert.throws(() => writeMap(result(dir, [a, b]), { dryRun, targets: ALL }), (err) => err.message === refusal(cursor, areaName(cursor, b.id), "is not a file"));
  }
  assert.deepEqual(held(), before);
  const off = writeMap(result(dir, [a, b]), { targets: ["claude"] });
  for (const target of OTHERS) {
    assert.deepEqual(off.targets[target.id].remove, mapOf(target, a));
    assert.deepEqual(namesIn(dir, target), [areaName(target, b.id)]);
  }
  assert.deepEqual(still(), [false, false]);
}

test("a directory at a name a target that is merely on writes is left, and that area has no file there", (t) => {
  oddEntryAtAnAreaName(t, (path) => {
    mkdirSync(path);
    writeFileSync(join(path, "inside.md"), "# somebody's\n");
  });
});

test("a fifo at a name a target that is merely on writes is left, and that area has no file there", needsPosixSpecialFiles, (t) => {
  oddEntryAtAnAreaName(t, (path) => execFileSync("mkfifo", [path]));
});

test("an overview that stops being this tool's while a plain scan is planned refuses, and is not written over", async (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  writeMap(result(dir, [a]), { targets: ["claude", "cursor"] });
  const overview = join(dir, cursor.dir, overviewName(cursor));
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.readdirSync;
  let swapped = false;
  // The target has read as on by the time its directory is listed, which is when the person's file lands.
  fs.readdirSync = (path, ...rest) => {
    if (!swapped && String(path).split(sep).join("/").endsWith(`/${cursor.dir}`)) {
      swapped = true;
      writeFileSync(overview, HAND);
    }
    return real(path, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.readdirSync = real;
    syncBuiltinESMExports();
  });

  assert.throws(() => writeMap(result(dir, [a])), (err) => err.message === refusal(cursor, overviewName(cursor)));

  assert.equal(swapped, true, "the control, the swap happened");
  assert.equal(readFileSync(overview, "utf8"), HAND);
});

test("a link at a generated name is somebody else's in a directory another tool reads", needsSymlinks, (t) => {
  // It leads to a file carrying our key, and the record names it: all three facts, of a file this tool never wrote.
  const dir = workspace(t);
  const outside = elsewhere(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a, b]), { targets: ALL });
  writeFileSync(join(outside, "victim.md"), OURS);
  for (const target of OTHERS) {
    rmSync(join(dir, target.dir, areaName(target, b.id)));
    symlinkSync(join(outside, "victim.md"), join(dir, target.dir, areaName(target, b.id)));
  }
  const linked = (target) => lstatSync(join(dir, target.dir, areaName(target, b.id))).isSymbolicLink();

  const on = writeMap(result(dir, [a, b]));
  for (const target of OTHERS) {
    assert.deepEqual(on.targets[target.id].foreign, [areaName(target, b.id)]);
    assert.deepEqual(on.targets[target.id].write.map((w) => w.name).sort(), mapOf(target, a));
    assert.equal(linked(target), true, "left while the target is on");
  }
  assert.throws(() => writeMap(result(dir, [a, b]), { targets: ALL }), (err) => err.message === refusal(cursor, areaName(cursor, b.id)));

  const gone = writeMap(result(dir, [a]));
  const off = writeMap(result(dir, [a]), { targets: ["claude"] });
  for (const target of OTHERS) {
    assert.deepEqual(gone.targets[target.id].remove, [], "not removed with the area");
    assert.deepEqual(off.targets[target.id].remove, mapOf(target, a));
    assert.equal(linked(target), true, "nor with the target");
  }
  assert.equal(readFileSync(join(outside, "victim.md"), "utf8"), OURS);
});

test("a file at a planned name that could not be read is not written over in a directory another tool reads", needsPosixPermissions, (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  writeMap(result(dir, [a, b]), { targets: ["claude", "cursor"] });
  const shut = join(dir, cursor.dir, areaName(cursor, b.id));
  writeFileSync(shut, HAND);
  chmodSync(shut, 0o000);

  const plan = writeMap(result(dir, [a, b]));

  assert.deepEqual(plan.targets.cursor.unreadableRules, [areaName(cursor, b.id)]);
  assert.deepEqual(plan.targets.cursor.write.map((w) => w.name).sort(), mapOf(cursor, a));
  assert.throws(
    () => writeMap(result(dir, [a, b]), { targets: ["claude", "cursor"] }),
    (err) => err.message === refusal(cursor, areaName(cursor, b.id), "could not be read")
  );
  chmodSync(shut, 0o644);
  assert.equal(readFileSync(shut, "utf8"), HAND);
});

test("a link at .github refuses the scan before any directory is touched", needsSymlinks, (t) => {
  const dir = workspace(t);
  const outside = elsewhere(t);
  mkdirSync(join(outside, "instructions"));
  writeFileSync(join(outside, "instructions", overviewName(copilot)), OURS);
  symlinkSync(outside, join(dir, ".github"));
  const before = tree(outside);

  for (const dryRun of [true, false]) {
    assert.throws(
      () => writeMap(result(dir, [area("src/services")]), { dryRun, targets: ALL }),
      (err) => err.message === ".github is a link, so .github/instructions could not be written and nothing was written anywhere: make .github a directory of this repository and scan again",
      dryRun ? "dry run" : "real write"
    );
  }

  assert.deepEqual(tree(outside), before, "nothing through the link");
  assert.deepEqual(tree(dir), { ".github": "-> link" }, "and no directory of ours, the Claude ones included");
});

test("naming an unknown target refuses before any directory is touched", needsSymlinks, (t) => {
  for (const [target, at, made, sentence] of [
    [cursor, ".cursor", (p) => symlinkSync(elsewhere(t), p), ".cursor is a link"],
    [cursor, ".cursor", (p) => writeFileSync(p, "a file\n"), ".cursor is not a directory"],
    [copilot, ".github/instructions", (p) => writeFileSync(p, "a file\n"), ".github/instructions is not a directory"],
    [cursor, `.cursor/rules/${overviewName(cursor)}`, (p) => mkdirSync(p), `.cursor/rules/${overviewName(cursor)} is not a file`],
    [copilot, `.github/instructions/${overviewName(copilot)}`, (p) => symlinkSync("elsewhere.md", p), `.github/instructions/${overviewName(copilot)} is a link`],
  ]) {
    const dir = workspace(t);
    mkdirSync(join(dir, at, ".."), { recursive: true });
    made(join(dir, at));
    const before = tree(dir);

    for (const dryRun of [true, false]) {
      assert.throws(
        () => writeMap(result(dir, [area("src/services")]), { dryRun, targets: ["claude", target.id] }),
        (err) => err.message.startsWith(`${sentence}, so ${target.dir} could not be written and nothing was written anywhere: `),
        `${sentence}, ${dryRun ? "dry run" : "real write"}`
      );
    }
    assert.deepEqual(tree(dir), before, sentence);
  }
});

test("the Claude directories are refused first, whatever the other targets are", needsSymlinks, (t) => {
  const dir = workspace(t);
  const outside = elsewhere(t);
  symlinkSync(outside, join(dir, ".claude"));
  symlinkSync(outside, join(dir, ".cursor"));

  assert.throws(() => writeMap(result(dir, [area("src/services")]), { targets: ALL }), (err) => err.message.startsWith(".claude/rules resolves where this tool does not write"));
  assert.deepEqual(readdirSync(outside), []);
});

test("a target nobody can name is refused, not ignored", (t) => {
  const dir = workspace(t);
  assert.throws(() => writeMap(result(dir, [area("src/services")]), { targets: ["claude", "windsurf"] }), /unknown target: windsurf; the targets are claude, cursor, copilot/);
  assert.throws(() => writeMap(result(dir, [area("src/services")]), { targets: "cursor" }), /targets is a list of names/);
  assert.deepEqual(tree(dir), {});
});

test("a target in an unknown state is left exactly as it was, and the plan says why", { ...needsSymlinks, ...needsPosixPermissions }, (t) => {
  const a = area("src/services");
  const b = area("src/api");

  // An overview that cannot be opened: whether it is ours was never read.
  const dir = workspace(t);
  writeMap(result(dir, [a, b]), { targets: ALL });
  const overview = join(dir, cursor.dir, overviewName(cursor));
  const areaBefore = readFileSync(join(dir, cursor.dir, areaName(cursor, b.id)), "utf8");
  chmodSync(overview, 0o000);
  try {
    // Left out by name, with files of ours the record names: that asks for a removal nobody can check.
    const held = () => [readFileSync(join(dir, STORE, "facts.json"), "utf8"), listRules(dir), namesIn(dir, cursor), namesIn(dir, copilot)];
    const before = held();
    for (const targets of [["claude"], ["claude", "copilot"]]) {
      for (const dryRun of [true, false]) {
        assert.throws(
          () => writeMap(result(dir, [a]), { dryRun, targets }),
          (err) =>
            err.message ===
            `.cursor/rules/${overviewName(cursor)} could not be read, so .cursor/rules could not be turned off and nothing was written anywhere: make it readable and scan again`,
          JSON.stringify(targets)
        );
      }
    }
    assert.deepEqual(held(), before, "refused, and the disk is what it was");

    const plan = writeMap(result(dir, [a]));
    assert.deepEqual(
      { state: plan.targets.cursor.state, reason: plan.targets.cursor.reason, on: plan.targets.cursor.on, write: plan.targets.cursor.write, remove: plan.targets.cursor.remove },
      { state: "unknown", reason: `.cursor/rules/${overviewName(cursor)} could not be read`, on: false, write: [], remove: [] }
    );
    assert.deepEqual(namesIn(dir, cursor), mapOf(cursor, a, b), "the area that went away is still there");
    assert.equal(readFileSync(join(dir, cursor.dir, areaName(cursor, b.id)), "utf8"), areaBefore);
    // The record keeps naming them, or they could never be removed once the file is readable again.
    assert.deepEqual(readFacts(dir).targets.cursor, mapOf(cursor, a, b));
  } finally {
    chmodSync(overview, 0o644);
  }
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a), "while the rest was written as usual");
  const healed = writeMap(result(dir, [a]));
  assert.deepEqual(healed.targets.cursor.remove, [areaName(cursor, b.id)]);
  assert.deepEqual(namesIn(dir, cursor), mapOf(cursor, a));

  // A link at `.cursor`, and no record of a file there: where it leads is not
  // this repository's to write, and leaving it out by name asks for nothing.
  const linked = workspace(t);
  const outside = elsewhere(t);
  mkdirSync(join(outside, "rules"));
  writeFileSync(join(outside, "rules", overviewName(cursor)), OURS);
  writeFileSync(join(outside, "rules", areaName(cursor, b.id)), OURS);
  symlinkSync(outside, join(linked, ".cursor"));
  const before = tree(outside);

  for (const targets of [null, ["claude"]]) {
    const left = writeMap(result(linked, [a]), { targets });
    assert.deepEqual(
      { state: left.targets.cursor.state, reason: left.targets.cursor.reason, write: left.targets.cursor.write, remove: left.targets.cursor.remove },
      { state: "unknown", reason: ".cursor is a link", write: [], remove: [] }
    );
  }
  assert.deepEqual(tree(outside), before);
  assert.deepEqual(listRules(linked), mapOf(TARGETS.claude, a));
});

test("a target left alone is neither written nor cleared, and the record goes on naming its files", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  const c = area("src/hooks");
  writeMap(result(dir, [a, b]), { targets: ALL });
  const before = tree(join(dir, cursor.dir));

  const plan = writeMap(result(dir, [a, c]), { leaveAlone: ["cursor"] });

  const mine = plan.targets.cursor;
  assert.deepEqual(
    { leftAlone: mine.leftAlone, state: mine.state, write: mine.write, remove: mine.remove, names: mine.names },
    { leftAlone: true, state: "on", write: [], remove: [], names: mapOf(cursor, a, b) }
  );
  assert.deepEqual(tree(join(dir, cursor.dir)), before, "every byte there is what it was");
  assert.equal(targetState(dir, cursor), "on", "and it is not turned off");
  assert.deepEqual(readFacts(dir).targets, { cursor: mapOf(cursor, a, b), copilot: mapOf(copilot, a, c) });
  assert.deepEqual(namesIn(dir, copilot), mapOf(copilot, a, c), "the one not held is written as usual");
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a, c));
  assert.equal("held" in plan.targets.copilot, false);

  // The next scan that holds nothing catches it up.
  const next = writeMap(result(dir, [a, c]));
  assert.deepEqual(next.targets.cursor.remove, [areaName(cursor, b.id)]);
  assert.deepEqual(namesIn(dir, cursor), mapOf(cursor, a, c));
});

test("an area that went away is removed from every target", (t) => {
  const dir = workspace(t);
  const stays = area("src/services");
  const goes = area("src/api");
  writeMap(result(dir, [stays, goes]), { targets: ALL });

  const plan = writeMap(result(dir, [stays]));

  assert.deepEqual(plan.remove, [areaFilename(goes)]);
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, stays));
  for (const t of OTHERS) {
    assert.deepEqual(plan.targets[t.id].remove, [areaName(t, goes.id)]);
    assert.deepEqual(namesIn(dir, t), mapOf(t, stays));
  }
  assert.deepEqual(readFacts(dir).targets, { cursor: mapOf(cursor, stays), copilot: mapOf(copilot, stays) });
});

test("an area no pattern of which Copilot can be given has no file there, and a stale one from an earlier scan is removed", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const q = area("src/quoted");
  writeMap(result(dir, [a, q]), { targets: ALL });
  assert.deepEqual(namesIn(dir, copilot), mapOf(copilot, a, q));
  // The same area, now only reachable through a directory neither reader's list can hold.
  const moved = { ...q, globs: [{ negated: false, dir: 'src/quoted/a"b', tail: "**/*.ts" }] };

  const plan = writeMap(result(dir, [a, moved]));

  for (const t of OTHERS) {
    const mine = plan.targets[t.id];
    assert.deepEqual(mine.unfiled, ["src/quoted"], t.id);
    assert.deepEqual(mine.remove, [areaName(t, q.id)]);
    assert.deepEqual(mine.write.map((w) => w.name).sort(), mapOf(t, a));
    assert.deepEqual(namesIn(dir, t), mapOf(t, a));
    const overview = readFileSync(join(dir, t.dir, overviewName(t)), "utf8");
    assert.match(overview, /^Generated files: 2 under /m, "the count is the files that are there");
    assert.match(overview, new RegExp(`^- 1 area has no pattern ${t.reader} can be given`, "m"));
    assert.deepEqual(readFacts(dir).targets[t.id], mapOf(t, a));
  }
  // Claude Code takes the pattern quoted, so its file stays.
  assert.deepEqual(listRules(dir), mapOf(TARGETS.claude, a, q));
  assert.deepEqual(plan.remove, []);
});

test("a target directory that became a link after the plan was made refuses the commit", needsSymlinks, (t) => {
  const dir = workspace(t);
  const outside = elsewhere(t);
  mkdirSync(join(outside, "rules"));
  const plan = planMap(result(dir, [area("src/services")]), { targets: ["claude", "cursor"] });
  symlinkSync(outside, join(dir, ".cursor"));

  assert.throws(() => commitMap(dir, plan), (err) => err.message === moved(cursor, UNTOUCHED));

  assert.deepEqual(readdirSync(join(outside, "rules")), []);
  assert.equal(existsSync(join(dir, ".claude")), false, "and nothing of Claude Code's either");
});

test("a run that read nothing writes and removes nothing in any directory", (t) => {
  const dir = workspace(t);
  writeMap(result(dir, [area("app/models"), area("app/services")]), { targets: ALL });
  const before = tree(dir);
  const blind = () => {
    const scan = result(dir, []);
    scan.parse = { ...scan.parse, crashed: scan.corpus.files, unreadable: ["ruby"] };
    return scan;
  };

  for (const targets of [null, ["claude"], ALL]) {
    const plan = writeMap(blind(), { targets });
    assert.equal(plan.blind, true);
    for (const t of OTHERS) assert.deepEqual({ write: plan.targets[t.id].write, remove: plan.targets[t.id].remove }, { write: [], remove: [] });
    assert.deepEqual(tree(dir), before, JSON.stringify(targets));
  }

  // Nor does it create a directory for a target it was asked to start.
  const fresh = workspace(t);
  const first = result(fresh, []);
  first.parse = { ...first.parse, crashed: first.corpus.files, unreadable: ["ruby"] };
  writeMap(first, { targets: ALL });
  assert.deepEqual(tree(fresh), {});
});

test("a held area's file is kept in every target that stays on, and goes with one that is turned off", (t) => {
  const dir = workspace(t);
  const models = area("app/models");
  const services = area("app/services");
  writeMap(result(dir, [models, services]), { targets: ALL });
  const kept = Object.fromEntries(OTHERS.map((t) => [t.id, readFileSync(join(dir, t.dir, areaName(t, models.id)), "utf8")]));
  const partial = () => {
    const scan = result(dir, [area("app/services", [dim({ conforming: 22, exceptions: [] })])]);
    scan.parse = { ...scan.parse, unreadable: ["ruby"] };
    scan.held = [{ id: models.id, path: models.path, fileCount: models.fileCount }];
    scan.readNothing = false;
    return scan;
  };

  const plan = writeMap(partial());

  for (const t of OTHERS) {
    assert.deepEqual(plan.targets[t.id].remove, []);
    assert.deepEqual(plan.targets[t.id].write.map((w) => w.name).sort(), mapOf(t, services));
    assert.equal(readFileSync(join(dir, t.dir, areaName(t, models.id)), "utf8"), kept[t.id], "neither removed nor rewritten");
    assert.match(readFileSync(join(dir, t.dir, areaName(t, services.id)), "utf8"), /22 of 22/);
    assert.deepEqual(readFacts(dir).targets[t.id], mapOf(t, models, services), "and the record still names it");
  }

  // Off is none of ours left there, and what an area holds has no bearing on it.
  const off = writeMap(partial(), { targets: ["claude"] });
  for (const t of OTHERS) {
    assert.deepEqual(off.targets[t.id].remove, mapOf(t, models, services));
    assert.deepEqual(namesIn(dir, t), []);
  }
  assert.equal("targets" in readFacts(dir), false);
  assert.equal(existsSync(join(rules(dir), areaFilename(models))), true, "Claude Code's own held file stays");
});

test("a target turned on by a run that holds an area counts only the area files it has", (t) => {
  const dir = workspace(t);
  const models = area("app/models");
  const services = area("app/services");
  writeMap(result(dir, [models, services]));
  const partial = result(dir, [services]);
  partial.parse = { ...partial.parse, unreadable: ["ruby"] };
  partial.held = [{ id: models.id, path: models.path, fileCount: models.fileCount }];
  partial.readNothing = false;
  const counts = (body) => [/^## Areas \(\d+\)$/m, /^Generated files: \d+/m].map((re) => body.match(re)?.[0]);

  writeMap(partial, { targets: ALL });

  assert.deepEqual(counts(readFileSync(join(rules(dir), overviewName(TARGETS.claude)), "utf8")), ["## Areas (2)", "Generated files: 3"]);
  for (const t of OTHERS) {
    assert.deepEqual(namesIn(dir, t), mapOf(t, services));
    assert.deepEqual(counts(readFileSync(join(dir, t.dir, overviewName(t)), "utf8")), ["## Areas (1)", "Generated files: 2"], t.id);
  }

  // Held again with the target already on: the file is still not there, so it is still not counted.
  writeMap({ ...partial }, {});
  for (const t of OTHERS) {
    assert.deepEqual(counts(readFileSync(join(dir, t.dir, overviewName(t)), "utf8")), ["## Areas (1)", "Generated files: 2"], t.id);
  }
});

test("a held area's file that no record names goes with the rest when its target is turned off by name", (t) => {
  const models = area("app/models");
  const services = area("app/services");
  const dir = workspace(t);
  writeMap(result(dir, [models, services]), { targets: ALL });
  rmSync(join(dir, STORE), { recursive: true, force: true });
  const partial = result(dir, [services]);
  partial.parse = { ...partial.parse, unreadable: ["ruby"] };
  partial.held = [{ id: models.id, path: models.path, fileCount: models.fileCount }];
  partial.readNothing = false;

  const off = writeMap(partial, { targets: ["claude"] });

  for (const target of OTHERS) {
    assert.deepEqual(off.targets[target.id].remove, mapOf(target, models, services));
    assert.deepEqual(off.targets[target.id].unknown, []);
    assert.deepEqual(namesIn(dir, target), []);
  }
  assert.equal("targets" in readFacts(dir), false);
});

test("a target directory swapped for a link once the renames began refuses in a sentence, with nothing written through it", needsSymlinks, async (t) => {
  const race = await swappedAtRename(t);
  const a = area("src/services");
  for (const target of OTHERS) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    writeMap(result(dir, [a]), { targets: ALL });
    for (const name of mapOf(target, a)) writeFileSync(join(outside, name), OURS);
    const theirs = tree(outside);
    const claude = unstamped(snapshot(dir));
    race.arm(1, join(dir, target.dir), outside);

    assert.throws(
      () => writeMap(result(dir, [a, area("src/api")])),
      (err) => err.message === moved(target, PUT_BACK),
      target.id
    );

    assert.equal(race.left, 0, `${target.id}: the control, the swap happened`);
    assert.deepEqual(tree(outside), theirs);
    assert.deepEqual(unstamped(snapshot(dir)), claude, `${target.id}: the record and Claude Code's files are the ones that were there`);
  }
});

test("a target directory moved aside and linked back once the renames began has nothing renamed into it", needsSymlinks, async (t) => {
  // The staged files are still reachable through the link, so only the look before each rename stops them.
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  let race = null;
  fs.renameSync = (from, to) => {
    const done = real(from, to);
    if (race !== null) {
      real(race.at, race.to);
      symlinkSync(race.to, race.at);
      race = null;
    }
    return done;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = real;
    syncBuiltinESMExports();
  });
  const a = area("src/services");

  for (const target of OTHERS) {
    const dir = workspace(t);
    const aside = join(elsewhere(t), "aside");
    writeMap(result(dir, [a]), { targets: ALL });
    const theirs = tree(join(dir, target.dir));
    const claude = unstamped(snapshot(dir));
    race = { at: join(dir, target.dir), to: aside };

    assert.throws(
      () => writeMap(result(dir, [a, area("src/api")])),
      (err) => err.message === moved(target, PUT_BACK),
      target.id
    );

    assert.equal(race, null, `${target.id}: the control, the swap happened`);
    assert.deepEqual(tree(aside), theirs, `${target.id}: every file where the link leads is the one that was there`);
    assert.deepEqual(unstamped(snapshot(dir)), claude, `${target.id}: the record and Claude Code's files are the ones that were there`);
  }
});

test("the rename order is record, layout, claude, cursor, copilot", async (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  const b = area("src/api");
  const c = area("src/hooks");
  writeMap(result(dir, [a, b]), { targets: ALL });
  const before = settled(dir);
  const renames = await watched(t, "renameSync");
  const kind = (path) => {
    const rel = String(path).split(sep).join("/");
    if (rel.endsWith(`${STORE}/facts.json`)) return "record";
    if (rel.endsWith(`${STORE}/layout.json`)) return "layout";
    return ["claude", "cursor", "copilot"].find((id) => rel.includes(`/${TARGETS[id].dir}/`));
  };

  // Each position in turn: whatever had been renamed is put back, in every directory.
  const positions = 2 + 3 * 3;
  for (let n = 1; n <= positions; n++) {
    renames.calls.length = 0;
    renames.failOn(n);
    assert.throws(() => writeMap(result(dir, [a, c])), /EPERM/, `rename ${n}`);
    assert.deepEqual(settled(dir), before, `after a failure at rename ${n}`);
    const done = renames.calls.slice(0, n).map(([, to]) => kind(to));
    assert.deepEqual(done, ["record", "layout", "claude", "claude", "claude", "cursor", "cursor", "cursor", "copilot", "copilot", "copilot"].slice(0, n));
  }

  renames.calls.length = 0;
  writeMap(result(dir, [a, c]));
  assert.deepEqual(
    renames.calls.map(([, to]) => kind(to)),
    ["record", "layout", "claude", "claude", "claude", "cursor", "cursor", "cursor", "copilot", "copilot", "copilot"]
  );
  for (const [from] of renames.calls) assert.match(String(from), /\.tmp-/, "each one a temporary file staged beside its destination");
});

test("every temporary file is staged before the first rename, each beside its destination", async (t) => {
  const dir = workspace(t);
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = { openSync: fs.openSync, renameSync: fs.renameSync };
  const events = [];
  fs.openSync = (path, flags, ...rest) => {
    if (flags === "wx") events.push(["stage", String(path)]);
    return real.openSync(path, flags, ...rest);
  };
  fs.renameSync = (from, to) => (events.push(["rename", String(from), String(to)]), real.renameSync(from, to));
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(fs, real);
    syncBuiltinESMExports();
  });

  writeMap(result(dir, [area("src/services")]), { targets: ALL });

  const firstRename = events.findIndex(([what]) => what === "rename");
  assert.equal(firstRename, 2 + 3 * 2, "the record, the layout file and two files in each of three directories");
  assert.equal(events.slice(firstRename).every(([what]) => what === "rename"), true, "no file is staged after the first rename");
  for (const [, from, to] of events.slice(firstRename)) assert.ok(from.startsWith(`${to}.tmp-`), `${from} is not beside ${to}`);
});

test("a throw on the last rename puts back every directory", async (t) => {
  const dir = workspace(t);
  writeMap(result(dir, [area("src/services"), area("src/api")]), { targets: ALL });
  const before = settled(dir);
  await failNth(t, "renameSync", 2 + 3 * 3);

  assert.throws(() => writeMap(result(dir, [area("src/services"), area("src/hooks")])), /EPERM/);

  assert.deepEqual(settled(dir), before, "all three directories and the record, with no temporary file in any");
  assert.notEqual(readLayout(dir), null);
});

test("a removal that fails in the last directory puts back every directory", async (t) => {
  const dir = workspace(t);
  writeMap(result(dir, [area("src/services"), area("src/api")]), { targets: ALL });
  const before = settled(dir);
  // One stale file in each of the three directories, removed in that order.
  await failNth(t, "unlinkSync", 3);

  assert.throws(() => writeMap(result(dir, [area("src/services")])), /EPERM/);

  assert.deepEqual(settled(dir), before);
});

test("a rollback removes the directory this run created, and leaves one it did not", async (t) => {
  const renames = await watched(t, "renameSync");
  const scan = (dir) => writeMap(result(dir, [area("src/services")]), { targets: ALL });

  for (const n of [1, 2 + 2 + 1, 2 + 2 * 3]) {
    const fresh = workspace(t);
    renames.failOn(n);
    assert.throws(() => scan(fresh), /EPERM/);
    assert.equal(existsSync(join(fresh, ".cursor")), false, `rename ${n}: .cursor and .cursor/rules were this run's`);
    assert.equal(existsSync(join(fresh, ".github")), false, `rename ${n}: and so were .github and .github/instructions`);
  }

  const dir = workspace(t);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "on: push\n");
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  const emptyGithub = workspace(t);
  mkdirSync(join(emptyGithub, ".github"));
  for (const root of [dir, emptyGithub]) {
    renames.failOn(2 + 2 * 3);
    assert.throws(() => scan(root), /EPERM/);
  }
  assert.deepEqual(readdirSync(join(dir, ".github")), ["workflows"], "the instructions directory is gone, and .github is not ours to remove");
  assert.deepEqual(readdirSync(join(dir, ".cursor", "rules")), [], "a directory that was already there stays, empty as it was");
  assert.deepEqual(readdirSync(join(emptyGithub, ".github")), [], "even an empty .github, when this run did not make it");
  assert.equal(existsSync(join(emptyGithub, ".cursor")), false);
});

test("a link raced into a created directory refuses and rolls back", needsSymlinks, async (t) => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.mkdirSync;
  let race = null;
  // The race itself: the directory this run just made is swapped for a link before it is looked at again.
  fs.mkdirSync = (path, ...rest) => {
    const made = real(path, ...rest);
    if (race !== null && String(path).split(sep).join("/").endsWith(`/${race.at}`)) {
      rmdirSync(path);
      symlinkSync(race.to, path);
    }
    return made;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.mkdirSync = real;
    syncBuiltinESMExports();
  });

  for (const at of [".cursor", ".cursor/rules", ".github", ".github/instructions"]) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    mkdirSync(join(outside, "rules"));
    mkdirSync(join(outside, "instructions"));
    race = { at, to: outside };

    assert.throws(
      () => writeMap(result(dir, [area("src/services")]), { targets: ALL }),
      (err) => err.message === `${at} is not a directory, so nothing was written: remove it and scan again`,
      at
    );

    race = null;
    assert.deepEqual(tree(outside), { "instructions/": "", "rules/": "" }, `${at}: nothing was written through the link`);
    assert.equal(lstatSync(join(dir, at)).isSymbolicLink(), true, `${at}: the link is somebody else's, so it stays`);
    assert.equal(existsSync(join(dir, STORE, "facts.json")), false, `${at}: no record`);
    assert.deepEqual(existsSync(rules(dir)) ? readdirSync(rules(dir)) : [], [], `${at}: no Claude file`);
    for (const t2 of OTHERS) {
      if (at.startsWith(t2.dir.split("/")[0])) continue;
      assert.equal(existsSync(join(dir, t2.dir.split("/")[0])), false, `${at}: the other target's directory was taken back out`);
    }
  }
});

test("a target directory swapped for a link while its files were staged refuses before any is renamed", needsSymlinks, async (t) => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.openSync;
  let race = null;
  // The directory is this run's own and empty until its first temporary file, which is when it is swapped.
  fs.openSync = (path, flags, ...rest) => {
    const at = String(path).split(sep).join("/");
    if (race !== null && flags === "wx" && at.includes(`/${race.at}/`)) {
      const parent = at.slice(0, at.lastIndexOf("/"));
      rmdirSync(parent);
      symlinkSync(race.to, parent);
      race = null;
    }
    return real(path, flags, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.openSync = real;
    syncBuiltinESMExports();
  });

  for (const target of OTHERS) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    race = { at: target.dir, to: outside };

    assert.throws(
      () => writeMap(result(dir, [area("src/services")]), { targets: ALL }),
      (err) => err.message === moved(target, UNTOUCHED),
      target.id
    );

    assert.equal(race, null, `${target.id}: the control, the swap happened`);
    assert.deepEqual(readdirSync(outside), [], `${target.id}: nothing is left where the link leads`);
    assert.equal(lstatSync(join(dir, target.dir)).isSymbolicLink(), true, `${target.id}: the link is somebody else's, so it stays`);
    assert.equal(existsSync(join(dir, STORE, "facts.json")), false, `${target.id}: no record`);
    assert.deepEqual(readdirSync(rules(dir)), [], `${target.id}: no Claude file`);
    for (const other of OTHERS.filter((o) => o !== target)) {
      assert.equal(existsSync(join(dir, other.dir.split("/")[0])), false, `${target.id}: the other target's directory was taken back out`);
    }
  }
});

/** Swap one target's directory for a link to `to` as the `n`th rename from now returns: after the last look before the renames. */
async function swappedAtRename(t) {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  const race = { left: 0, at: null, to: null, arm: (n, at, to) => Object.assign(race, { left: n, at, to }) };
  fs.renameSync = (from, to) => {
    const done = real(from, to);
    if (race.left > 0 && --race.left === 0) {
      rmSync(race.at, { recursive: true });
      symlinkSync(race.to, race.at);
    }
    return done;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = real;
    syncBuiltinESMExports();
  });
  return race;
}

test("a target directory swapped for a link once the renames began has nothing removed through it when the target is turned off", needsSymlinks, async (t) => {
  const race = await swappedAtRename(t);
  const a = area("src/services");
  for (const target of OTHERS) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    writeMap(result(dir, [a]), { targets: ALL });
    // Somebody else's files, under the very names this scan is about to remove.
    for (const name of mapOf(target, a)) writeFileSync(join(outside, name), OURS);
    const theirs = tree(outside);
    const other = OTHERS.find((o) => o !== target);
    const before = { record: readFileSync(join(dir, STORE, "facts.json"), "utf8"), claude: unstamped(snapshot(dir)), other: namesIn(dir, other) };
    race.arm(1, join(dir, target.dir), outside);

    assert.throws(
      () => writeMap(result(dir, [a]), { targets: ["claude"] }),
      (err) => err.message === moved(target, PUT_BACK),
      target.id
    );

    assert.equal(race.left, 0, `${target.id}: the control, the swap happened`);
    assert.deepEqual(tree(outside), theirs, `${target.id}: nothing where the link leads was removed`);
    assert.equal(readFileSync(join(dir, STORE, "facts.json"), "utf8"), before.record, `${target.id}: the record is the one that was there`);
    assert.deepEqual(unstamped(snapshot(dir)), before.claude);
    assert.deepEqual(namesIn(dir, other), before.other, `${target.id}: and nothing was removed from the other directory either`);
  }
});

test("a target directory swapped for a link after its files were renamed has no stale file removed through it, and nothing put back there", needsSymlinks, async (t) => {
  const race = await swappedAtRename(t);
  const a = area("src/services");
  const b = area("src/api");
  for (const target of OTHERS) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    writeMap(result(dir, [a, b]), { targets: ALL });
    for (const name of mapOf(target, a, b)) writeFileSync(join(outside, name), OURS);
    const theirs = tree(outside);
    const other = OTHERS.find((o) => o !== target);
    const before = { record: readFileSync(join(dir, STORE, "facts.json"), "utf8"), claude: unstamped(snapshot(dir)), other: tree(join(dir, other.dir)) };
    // The record, its layout file and two files in each of three directories.
    race.arm(2 + 3 * 2, join(dir, target.dir), outside);

    assert.throws(
      () => writeMap(result(dir, [a])),
      // Its own new files went with the directory, wherever that is now.
      (err) => err.message === moved(target, PUT_BACK_ELSEWHERE),
      target.id
    );

    assert.equal(race.left, 0, `${target.id}: the control, the swap happened`);
    assert.deepEqual(tree(outside), theirs, `${target.id}: nothing where the link leads was removed or written`);
    assert.equal(readFileSync(join(dir, STORE, "facts.json"), "utf8"), before.record);
    assert.deepEqual(unstamped(snapshot(dir)), before.claude, `${target.id}: Claude Code's stale file is back`);
    assert.deepEqual(tree(join(dir, other.dir)), before.other, `${target.id}: and so is the other directory's`);
  }
});

test("a target directory swapped for a link between the last look and the rename refuses in the same sentence, not an errno", needsSymlinks, async (t) => {
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  let race = null;
  // Inside the rename itself, so the look before it has already passed.
  fs.renameSync = (from, to) => {
    if (race !== null && String(to).startsWith(race.at + sep)) {
      rmSync(race.at, { recursive: true });
      symlinkSync(race.to, race.at);
      race = null;
    }
    return real(from, to);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = real;
    syncBuiltinESMExports();
  });
  const a = area("src/services");

  for (const target of OTHERS) {
    const dir = workspace(t);
    const outside = elsewhere(t);
    writeMap(result(dir, [a]), { targets: ALL });
    for (const name of mapOf(target, a)) writeFileSync(join(outside, name), OURS);
    const theirs = tree(outside);
    const claude = unstamped(snapshot(dir));
    race = { at: join(realpathSync(dir), ...target.dir.split("/")), to: outside };

    assert.throws(() => writeMap(result(dir, [a, area("src/api")])), (err) => err.message === moved(target, PUT_BACK), target.id);

    assert.equal(race, null, `${target.id}: the control, the swap happened`);
    assert.deepEqual(tree(outside), theirs, `${target.id}: nothing where the link leads was written`);
    assert.deepEqual(unstamped(snapshot(dir)), claude, `${target.id}: the record and Claude Code's files are the ones that were there`);
  }
});

test("nothing is removed until every file has been renamed into place", async (t) => {
  // Removed first, an orphan is gone while the record and the overview on disk still name it.
  const dir = workspace(t);
  const stays = area("src/services");
  writeMap(result(dir, [stays, area("src/api")]), { targets: ALL });
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = { renameSync: fs.renameSync, unlinkSync: fs.unlinkSync };
  const events = [];
  for (const name of Object.keys(real)) fs[name] = (...args) => (events.push(name), real[name](...args));
  syncBuiltinESMExports();
  t.after(() => {
    Object.assign(fs, real);
    syncBuiltinESMExports();
  });

  writeMap(result(dir, [stays]));

  const renames = 2 + 3 * 2;
  assert.deepEqual(events, [...Array(renames).fill("renameSync"), "unlinkSync", "unlinkSync", "unlinkSync"], "the record, its layout file and two files in each directory, then one orphan in each");
});

test("a target directory that cannot be written is refused by name before a dry run answers", needsPosixPermissions, (t) => {
  const dir = workspace(t);
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  chmodSync(join(dir, ".cursor", "rules"), 0o555);
  try {
    for (const dryRun of [true, false]) {
      assert.throws(
        () => writeMap(result(dir, [area("src/services")]), { dryRun, targets: ["claude", "cursor"] }),
        (err) => err.message === ".cursor/rules is not writable, so the map could not be written: fix its permissions and scan again"
      );
    }
  } finally {
    chmodSync(join(dir, ".cursor", "rules"), 0o755);
  }
  assert.equal(existsSync(join(dir, ".claude")), false);
});

test("a directory holding a generated name in a target is reported, not an errno", (t) => {
  const dir = workspace(t);
  const a = area("src/services");
  mkdirSync(join(dir, copilot.dir, areaName(copilot, a.id)), { recursive: true });

  for (const dryRun of [true, false]) {
    assert.throws(
      () => writeMap(result(dir, [a]), { dryRun, targets: ALL }),
      (err) => err.message === refusal(copilot, areaName(copilot, a.id), "is not a file")
    );
  }
  assert.equal(existsSync(join(dir, ".claude")), false);
  assert.equal(existsSync(join(dir, ".cursor")), false);
  // Left off, the shape is nobody's business.
  assert.deepEqual(writeMap(result(dir, [a])).targets.copilot.write, []);
});
