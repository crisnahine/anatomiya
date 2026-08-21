import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installWithoutStripper, FLOW_SOURCE } from "./no-stripper.mjs";

import { needsRuby } from "./ruby-available.mjs";
import { check, severityFor, unreadReason, unreadCode } from "../lib/check.mjs";
import { formatReport, CAVEATS } from "../lib/check-report.mjs";
import { scan } from "../lib/scan.mjs";
import { writeMap } from "../lib/write.mjs";
import { writeFacts } from "../lib/facts.mjs";

// The area record carries a glob in the two halves it is composed from.
const glob = (dir) => ({ negated: false, dir, tail: "**/*.ts" });

/**
 * Every case here builds a real git repository, because the properties under
 * test are properties of the diff: a rename, a line shift, and a base branch
 * that moved ahead are all invisible to a fixture.
 *
 * Cleanup is registered before the build runs, so a failed assertion leaves no
 * temporary repository behind.
 */
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("checkout", "-q", "-b", "main");

  const write = (rel, body) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const commit = (msg) => {
    git("add", "-A");
    git("commit", "-qm", msg);
  };
  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  build({ dir, git, write, commit, read });
  return dir;
}

const swallow = (n) =>
  Array.from({ length: n }, (_, i) => `export function f${i}() { try { go${i}() } catch (e) { } }`).join("\n") + "\n";

const clean = (n) =>
  Array.from({ length: n }, (_, i) => `export function g${i}() { try { go${i}() } catch (e) { log(e) } }`).join("\n") + "\n";

const dim = (o = {}) => ({
  key: "swallowed_error",
  precision: "precise",
  directive: true,
  gate: null,
  applicability: 6,
  candidates: 60,
  conforming: 60,
  exceptions: [],
  baseline: { candidates: 60, conforming: 60, exceptions: [] },
  ...o,
});

/**
 * The two files the check reads: the rendered map's facts, and the pin that
 * says which files the baseline population held. They are separate on disk
 * because the pin stores no counts, so there is nothing to fall back to when
 * its sha goes unreachable.
 */
function facts(dir, { sha, dimensions = [dim()], path = "src", fileCount = 8, pinned = null, areas = null, capabilities = [] } = {}) {
  const store = join(dir, ".claude/anatomiya");
  mkdirSync(store, { recursive: true });
  const mapped = areas
    || [{ id: "aaaaaaaa", path, globs: [glob(path)], fileCount, dimensions }];
  // Through the writer, never hand-built. This fixture used to spell `schema: 1`
  // while the writer emitted 3, so every one of these tests read the check
  // against a shape nothing had produced for two versions.
  writeFacts(dir, {
    root: dir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    corpus: { files: fileCount, frameworks: [], capabilities },
    parse: { parsed: fileCount },
    suppressAll: false,
    areas: mapped,
  });
  if (!sha) return;
  writeFileSync(
    join(store, "baseline.json"),
    JSON.stringify({
      schema: 1,
      sha,
      areas: mapped.map((a) => ({
        id: a.id,
        path: a.path,
        files: pinned || Array.from({ length: fileCount }, (_, i) => `${a.path}/f${i}.ts`),
      })),
    })
  );
}

const sha = (dir, ref = "HEAD") =>
  execFileSync("git", ["rev-parse", ref], { cwd: dir, encoding: "utf8" }).trim();

const forKey = (report, key) => report.findings.filter((f) => f.dimension === key);

/** A caveat is a code and a sentence; these cases are about the sentence. */
const notes = (report) => report.caveats.map((c) => c.message);

/**
 * A "reports nothing" assertion is only worth anything if the file reached the
 * parser. Every one of the negative cases would otherwise pass just as well on
 * a check that skipped the file for being unreadable.
 */
function assertExamined(report, path) {
  assert.ok(
    report.examined.some((c) => c.path === path),
    `${path} was never examined, so the case proves nothing`
  );
  const skipped = notes(report).filter((m) => m.includes(path));
  assert.deepEqual(skipped, [], `${path} was skipped: ${skipped.join("; ")}`);
}

test("a rename with no content change reports nothing", async (t) => {
  // Keying on path plus line would forge every site in the file: a pure git mv
  // changes the path of all of them and moves none of them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    write("src/other.ts", clean(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    commit("move it");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "compare");
  assertExamined(r, "src/moved.ts");
  assert.deepEqual(r.findings, [], "a move introduces no violation");
});

test("a rename that also adds a violation reports only the new site", async (t) => {
  // The control for the case above: following the rename must not cost the
  // ability to see what the same commit actually introduced.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    write("src/moved.ts", swallow(4));
    commit("move it and add one");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, "three carried sites are absorbed, the fourth is new");
  assert.equal(hits[0].path, "src/moved.ts");
  assert.equal(hits[0].oldPath, "src/legacy.ts");
});

test("an import added above existing violations reports nothing", async (t) => {
  // One added import shifts every line below it. A position key would report
  // three untouched catch blocks as newly written.
  const dir = repo(t, ({ git, write, commit, read }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", `import { go0 } from "./go"\n\n${read("src/a.ts")}`);
    commit("add an import");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/a.ts");
  assert.deepEqual(r.findings, [], "shifted lines are the same sites");
});

test("a base branch that moved ahead contributes no findings", async (t) => {
  // The three-dot diff is the whole point: two dots compares the endpoints and
  // hands the author every file the base branch changed since the fork.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(3));
    write("src/mine.ts", clean(2));
    commit("init");

    git("checkout", "-q", "-b", "work");
    write("src/mine.ts", clean(2) + swallow(1));
    commit("my change");

    git("checkout", "-q", "main");
    write("src/theirs.ts", swallow(4));
    commit("someone else's change");
    git("checkout", "-q", "work");
  });
  facts(dir, { sha: sha(dir, "work") });

  const r = await check(dir, { baseRef: "main" });
  const paths = new Set(r.findings.map((f) => f.path));

  assert.ok(r.findings.length > 0, "the author's own new violation is still reported");
  assert.deepEqual([...paths], ["src/mine.ts"]);
  assert.equal(r.changed.some((c) => c.path === "src/theirs.ts"), false);
});

test("a file the map names as an exception never reaches MUST-FIX", async (t) => {
  // The map told the agent this file is exempt so it would not refactor it.
  // Severity derived from the area ratio alone would flag it forever.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", clean(2));
    write("src/fresh.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/legacy.ts", clean(2) + swallow(1));
    write("src/fresh.ts", clean(2) + swallow(1));
    commit("touch both");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ exceptions: [{ path: "src/legacy.ts", count: 2 }] })],
  });

  const r = await check(dir, { baseRef: "main" });
  const bySeverity = Object.fromEntries(
    forKey(r, "swallowed_error").map((f) => [f.path, f.severity])
  );

  assert.equal(bySeverity["src/legacy.ts"], "FIX");
  assert.equal(bySeverity["src/fresh.ts"], "MUST-FIX", "the control must still be top severity");
});

test("an exception listed under the pre-rename path still exempts the file", async (t) => {
  // The map named the path it saw at scan time. A rename in the change under
  // review must not silently revoke the exemption the map granted.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/renamed.ts");
    write("src/renamed.ts", clean(2) + swallow(1));
    commit("rename and add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ exceptions: [{ path: "src/legacy.ts", count: 2 }] })],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "FIX");
});

test("a partial dimension never reaches MUST-FIX", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a() { return { ok: true } }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", `export function a() { return { ok: true } }\nexport function b() { throw new Error("x") }\n`);
    commit("throw");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({
        key: "error_shape",
        precision: "partial",
        candidates: 60,
        conforming: 60,
        baseline: { candidates: 60, conforming: 60, exceptions: [] },
      }),
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "error_shape");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "FIX", "a predicate that under-counts cannot demand a fix");
});

test("a stale map caps severity instead of stopping the check", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: "0".repeat(40) });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /unreachable/);
  assert.equal(hits.length, 1, "a stale map still reports");
  assert.equal(hits[0].severity, "FIX");
});

test("a map with no pin at all caps severity", async (t) => {
  // Counts with nothing behind them are the agent's own output. Without a pin
  // there is no population that predates the branch.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: null });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /no baseline pinned/);
  assert.equal(hits[0].severity, "FIX");
});

test("a dimension a gate suppressed cannot demand anything", async (t) => {
  // The check may only enforce what the map stated. A suppressed dimension is
  // one the map explicitly declined to state.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ directive: false, gate: "authors" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.match(hits[0].reason, /authors/);
});

test("a file in no mapped area is a NIT", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("tools/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("tools/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.equal(hits[0].area, null);
});

test("a dimension the map never counted inside an area is not reported at all", async (t) => {
  // Inside a mapped area the scan recorded every dimension it saw a site of, so
  // a key missing from that list is one the map deliberately said nothing
  // about. Outside every area nothing was measured, which is what the NIT is
  // for, and the same source is written to both places to prove the difference
  // is the map rather than the code.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("tools/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    write("tools/a.ts", clean(2) + swallow(1));
    commit("swallow in both");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    forKey(r, "swallowed_error").map((f) => f.path),
    ["tools/a.ts"]
  );
});

test("the deepest area containing a file supplies its claims", async (t) => {
  // Nested areas both contain the path. Reading the shallower one would judge
  // the file against a convention counted over a different population.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/api/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      {
        id: "bbbbbbbb",
        path: "src/api",
        globs: [glob("src/api")],
        fileCount: 8,
        dimensions: [dim({ directive: false, gate: "authors" })],
      },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].area, "src/api");
  assert.equal(hits[0].severity, "NIT", "the deeper area suppressed this dimension");
});

test("no map on disk enforces nothing and says so", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.ok(r.caveats.some((c) => c.code === CAVEATS.NO_MAP));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.equal(hits[0].area, null);
});

test("a changed Ruby file is parsed by prism and its new violation is reported", needsRuby, async (t) => {
  // Ruby reaches the check through the same scratch-directory read as oxc, one
  // prism subprocess rather than the pool. Excluding it would state Ruby
  // conventions in the map and enforce none of them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.rb", "def a\n  1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n");
    commit("rescue");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "rescue_uses_error" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(r.changed.some((c) => c.path === "src/a.rb"));
  assert.deepEqual(
    r.examined.map((c) => c.path),
    ["src/a.rb"],
    "a Ruby file in the diff is examined, not skipped"
  );
  assert.ok(
    !notes(r).some((m) => /could not be parsed|not examined/.test(m)),
    `no parse caveat: ${notes(r).join(" | ")}`
  );
  assert.equal(r.findings.length, 1, "the rescue that ignores its error is newly introduced");
  assert.equal(r.findings[0].dimension, "rescue_uses_error");
  assert.equal(r.findings[0].path, "src/a.rb");
  assert.equal(r.findings[0].line, 4, "prism reports a line even with no byte offsets");
});

test("a changed file the parser cannot read is named, not silently skipped", async (t) => {
  // A file that answers `ok: false` is skipped by every loop that walks a
  // program, which is right, and reported by none of them, which is the same
  // silence the scan had: an empty finding list reads as "conforms".
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", "export const a = 1\nfoo(\n");
    commit("break it");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  // Named, whatever the cause turned out to be: the sibling case above pins
  // which sentence each cause gets, this one pins that the file is reported.
  assert.ok(
    notes(r).some((m) => m.includes("src/a.ts")),
    `expected a parse caveat naming the file: ${notes(r).join(" | ")}`
  );
  assert.equal(r.findings.length, 0, "and nothing is claimed about a file nobody could read");
});

test("a diff the check could not read is not reported as a branch that changed nothing", async (t) => {
  // Every git call in the check reads its output without looking at the exit
  // code, so a diff that fails comes back as an empty change list: no file
  // examined, no finding, and a report shaped exactly like a clean branch.
  // The same silence as reporting clean for a file that was never parsed.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(6));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("add a swallow");
  });
  // The base commit object survives, so the base still resolves and every
  // earlier stage succeeds; its tree does not, so the diff cannot be produced.
  const tree = execFileSync("git", ["rev-parse", "main^{tree}"], { cwd: dir, encoding: "utf8" }).trim();
  rmSync(join(dir, ".git", "objects", tree.slice(0, 2), tree.slice(2)));

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.DIFF_UNREADABLE),
    `expected the unread diff to be named: ${notes(r).join(" | ")}`
  );
});

test("a map the scan actually wrote is one the check can enforce", async (t) => {
  // Every other case here hand-writes facts.json, and it hand-wrote a schema
  // the writer had stopped emitting two versions earlier. Nothing ran the
  // writer and the reader against each other, so the two were free to drift.
  const dir = repo(t, ({ write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(8));
    commit("init");
  });

  await writeMap(await scan(dir), {});

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("checkout", "-q", "-b", "work");
  writeFileSync(join(dir, "src", "f0.ts"), clean(8) + swallow(1));
  git("add", "-A");
  git("commit", "-qm", "swallow one");

  const r = await check(dir, { baseRef: "main" });

  const found = forKey(r, "swallowed_error");
  assert.equal(found.length, 1, `expected the written claim to be enforced: ${JSON.stringify(r.findings)}`);
  assert.notEqual(found[0].severity, "NIT", "a NIT here means the map was not read at all");
});

test("facts written by a newer scan are not read as if their shape were known", async (t) => {
  // The reader never looked at the schema it was handed, so a record whose
  // fields had moved would be read positionally and enforce a convention
  // nobody stated. The writer versions this file precisely so the two can
  // disagree out loud.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(6));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("add a swallow");
  });
  const store = join(dir, ".claude/anatomiya");
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(store, "facts.json"),
    JSON.stringify({
      schema: 99,
      areas: [{ id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] }],
    })
  );

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /schema/.test(m)),
    `expected the unreadable map to be named: ${notes(r).join(" | ")}`
  );
  assert.deepEqual(
    r.findings.filter((f) => f.severity !== "NIT"),
    [],
    "and nothing is enforced from a map this reader cannot read"
  );
});

test("a plain-Ruby branch is not asked a Rails question", needsRuby, async (t) => {
  // C8: `zone_aware_time` has no counter-claim, so off-Rails it can only ever
  // read zero, and one of the measured symptoms was a NIT delivered onto a
  // plain-Ruby branch. The scan learned the frameworks from the corpus and
  // stopped offering the dimension; the check never asked, so it still runs
  // every Rails claim against a repository holding none.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/thing.rb", "def a\n  1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("lib/thing.rb", "def a\n  Time.now\nend\n");
    commit("stamp it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    forKey(r, "zone_aware_time"),
    [],
    `no app/models, db/migrate or config/application.rb in this corpus: ${JSON.stringify(r.findings)}`
  );
});

test("a Rails branch is still asked the Rails question", needsRuby, async (t) => {
  // The pair above answers the same way if the fix were to stop offering the
  // dimension anywhere, and nothing else here would notice: the registry tests
  // cover `dimensionsFor`, not what the check does with it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User\n  def a\n    1\n  end\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/user.rb", "class User\n  def a\n    Time.now\n  end\nend\n");
    commit("stamp it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    forKey(r, "zone_aware_time").length,
    1,
    `app/models is the Rails signal: ${JSON.stringify(r.findings)}`
  );
});

test("a file that crashed the parser is named apart from one it merely rejected", async (t) => {
  // The third of the four causes the scan names. A crash is this tool's
  // problem and a syntax error is the file's, so folding them into one
  // sentence points the author at the wrong thing.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    // Deep nesting is the portable way to segfault oxc, which is why the
    // parser runs out of process at all.
    write("src/a.ts", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    commit("nest it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /crashed/.test(m)),
    `expected the crash to be named: ${notes(r).join(" | ")}`
  );
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.HEAD_CRASHED),
    `and named by its own code: ${JSON.stringify(r.caveats)}`
  );
});

test("a file the parser rejected is named apart from one this tool could not read", async (t) => {
  // The scan names the two apart because the reader's next move differs: syntax
  // the parser rejected is the branch's own code to go and look at, a file that
  // could not be read at all is this tool or the filesystem. The check folded
  // both into one sentence, so the one the author can act on read as a tool bug.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", "export const a = 1\nfoo(\n");
    commit("break it");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /syntax/.test(m)),
    `expected the syntax cause to be named: ${notes(r).join(" | ")}`
  );
  // The code carries the same split the sentence does, or a reader that is not
  // a human is back to matching "syntax" against a phrase nobody promised.
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.HEAD_REJECTED),
    `the branch's own code is not this tool crashing: ${JSON.stringify(r.caveats)}`
  );
});

test("a Ruby file whose violation already existed at the base is not reported", async (t) => {
  // The offset-free fingerprint is the only identity a Ruby site has, so the
  // two-run difference has to still cancel an unchanged one.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n\ndef b\n  2\nend\n");
    commit("append");
  });
  facts(dir, { sha: sha(dir, "main"), dimensions: [dim({ key: "rescue_uses_error" })] });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((c) => c.path), ["src/a.rb"]);
  assert.deepEqual(r.findings, [], "the rescue was already there");
});

test("a deleted file produces no findings", async (t) => {
  // Its content is in the diff as removals. Reading it at HEAD is impossible
  // and charging the author for what they removed is backwards.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    write("src/keep.ts", clean(1));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("rm", "-q", "src/a.ts");
    commit("delete it");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.changed.map((c) => c.path), []);
  assert.deepEqual(r.findings, []);
});

test("a path containing a newline stays one path", needsPosixPaths, async (t) => {
  // Git permits a newline in a path. A line-split over `--name-status` turns
  // one hostile filename into two entries, and the encoder is what keeps it
  // from breaking the rendered report open.
  const hostile = "src/a\nb.ts";
  const dir = repo(t, ({ git, write, commit }) => {
    write(hostile, clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write(hostile, clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.deepEqual(r.changed.map((c) => c.path), [hostile]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, hostile);

  const rendered = formatReport(r);
  assert.ok(rendered.includes('"src/a b.ts"'), "the path is encoded and quoted");
  assert.equal(rendered.includes(hostile), false, "the raw newline never reaches the report");
});

test("the report names files in .claude/rules this tool did not write", async (t) => {
  // A clone can ship a rule file with no `paths` key that loads from the moment
  // of clone, in our house style, forever.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-overview.md", "---\ngenerator: anatomiya\n---\n\nours\n");
    write(".claude/rules/house.md", "someone else's\n");
    write(".claude/rules/notes.txt", "not a rule file\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, ["house.md"]);
  assert.deepEqual(r.unknown, []);
  assert.ok(formatReport(r).includes("house.md"));
});

test("our own filename with nobody's frontmatter is not ours (A3)", async (t) => {
  // The prefix is a name anyone can type. Two of the three facts is not
  // ownership, and the report is what says so.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-area-deadbeef.md", "# hand-written, our name\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, ["anatomiya-area-deadbeef.md"]);
});

test("our frontmatter with no map naming it is reported apart from a foreign file (A3, A4)", async (t) => {
  // This tool's own output from a scan whose record is gone. It still loads, so
  // it is named; it is not removed, because the map cannot vouch for it.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-area-99999999.md", "---\ngenerator: anatomiya\n---\n\nstale\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, [], "not somebody else's");
  assert.deepEqual(r.unknown, ["anatomiya-area-99999999.md"]);
  const rendered = formatReport(r);
  assert.ok(rendered.includes("the map on disk does not name"));
  assert.ok(rendered.includes("anatomiya-area-99999999.md"));
});

test("a file edited since its commit is read as it stands, not as it was committed", async (t) => {
  // One violation committed, a second added in the tree. The tree is what the
  // agent has in front of it, so it is the side the head is read from.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    write("src/a.ts", clean(2) + swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(r.caveats.some((c) => c.code === CAVEATS.READ_FROM_TREE));
  assert.equal(forKey(r, "swallowed_error").length, 2, "both sites, the committed one and the pending one");
});

// An agent writes, checks, fixes, then commits. Run at the moment the findings
// are cheapest, the check used to answer "0 MUST-FIX, 0 FIX, 0 NIT" and put the
// one line that unsaid it in a caveat.
test("an untracked file is examined, so the check answers before the commit", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/b.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

test("a tracked file edited only in the tree is judged against its base, not read as all new", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    // Two violations at the base, so a head side read as wholly new would
    // report three rather than the one this branch added.
    write("src/a.ts", swallow(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", swallow(3));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(forKey(r, "swallowed_error").length, 1, JSON.stringify(r.findings));
});

test("a file read from the tree is named as read from the tree", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.READ_FROM_TREE),
    `a run that read uncommitted content says so: ${JSON.stringify(r.caveats)}`
  );
});

test("a staged but uncommitted file is examined the same as an unstaged one", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
    git("add", "-A");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/b.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

test("a renamed file counts once, and under its own name", async (t) => {
  // `status --porcelain -z` writes a rename as two fields, the new path with a
  // status prefix and the old path bare. Reading the second as another status
  // line both double-counts the rename and mangles the path.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("mv", "src/a.ts", "src/renamed.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  const note = r.caveats.find((c) => c.code === CAVEATS.READ_FROM_TREE);
  assert.ok(note, "the rename is work the check read from the tree");
  assert.match(note.message, /^1 file/, "one file, not two");
});

test("the store the map writes is not counted as pending work", async (t) => {
  // facts.json and the rendered rules are this tool's own output. Counting them
  // would fire the caveat on every clean repository that has been scanned.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    r.caveats.filter((c) => c.code === CAVEATS.READ_FROM_TREE).length,
    0,
    "a clean tree plus an untracked map is not pending work"
  );
  assert.deepEqual(r.examined, [], "the map is not source this branch changed");
});

test("a repository with no commits examines nothing and refuses nothing", async (t) => {
  const dir = repo(t, ({ write }) => {
    write("src/a.ts", swallow(3));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "none");
  assert.deepEqual(r.findings, []);
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.NOTHING_EXAMINED));
  assert.doesNotThrow(() => formatReport(r));
});

test("a repository holding none of the base refs degrades to added lines rather than refusing", async (t) => {
  // The guessed candidate list not resolving is a repository that keeps its
  // trunk somewhere else. A ref somebody typed is a different question, and
  // #51 made that one a refusal.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(r.mode, "added-lines");
  assert.ok(notes(r).some((m) => m.includes("added")), "the caveat must be stated");
  assert.equal(forKey(r, "swallowed_error").length, 1, "the added line is still checked");
});

test("added-lines mode reports only sites on the added lines", async (t) => {
  // Without a base version to difference against, the added-line ranges are the
  // only thing separating what this change wrote from what the file held.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", swallow(3) + swallow(1).replace("f0", "z0"));
    commit("one more");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.mode, "added-lines");
  assert.equal(hits.length, 1, "the three sites the file already held are not the author's");
  assert.equal(hits[0].line, 4);
});

test("added lines cannot reach MUST-FIX either", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(forKey(r, "swallowed_error")[0].severity, "FIX");
});

test("drift is measured to the base ref, never to HEAD", async (t) => {
  // Every mapped file is rewritten on this branch. Measured over HEAD that is
  // 6 of 6 drifted and the map ages itself out, so severity would fall as the
  // change under review grows.
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    for (let i = 1; i < 6; i++) write(`src/f${i}.ts`, clean(3));
    write("src/f0.ts", clean(3) + swallow(1));
    commit("touch everything");
  });
  facts(dir, { sha: sha(dir, "main"), fileCount: 6 });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.stale, false, "the branch cannot age its own map");
  assert.equal(forKey(r, "swallowed_error")[0].severity, "MUST-FIX");
});

test("a base branch that moved past the pin caps severity", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(2));
    commit("pin here");
    for (let i = 1; i < 5; i++) write(`src/f${i}.ts`, clean(4));
    commit("the world moved");

    git("checkout", "-q", "-b", "work");
    write("src/f0.ts", clean(2) + swallow(1));
    commit("my change");
  });
  facts(dir, { sha: sha(dir, "main~1"), fileCount: 6 });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /mapped files changed since the pin/);
  assert.equal(forKey(r, "swallowed_error")[0].severity, "FIX");
});

// --- the severity table on its own ---

test("MUST-FIX needs a baseline whose evidence would have cleared the gate that stated it", () => {
  // The check may only enforce at top severity what the scan was willing to
  // state, so both read the same bound. A floor left behind here would enforce
  // as law a claim the scan considered too thin to make.
  const at = (o) => severityFor({ path: "src/a.ts" }, { dim: dim(o), fresh: true }).severity;

  assert.equal(at({}), "MUST-FIX");
  assert.equal(at({ baseline: { candidates: 20, conforming: 20 } }), "FIX", "twenty perfect sites hold 0.84");
  assert.equal(at({ baseline: { candidates: 5, conforming: 5 } }), "FIX", "five sites is not evidence");
  assert.equal(at({ baseline: { candidates: 20, conforming: 19 } }), "FIX", "not a clean baseline");
  assert.equal(at({ baseline: null }), "FIX", "no baseline recorded");
});

test("severity never reads the current population", () => {
  // The agent's own output accumulates in the current counts. Judging against
  // them lets a branch raise the bar it is measured by.
  const d = dim({ candidates: 400, conforming: 400, baseline: { candidates: 6, conforming: 5 } });
  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d, fresh: true }).severity, "FIX");
});

test("an exception recorded on the baseline population still exempts", () => {
  // Which of the two lists carries the exception is a detail of when the scan
  // saw it. Either one means the map told the agent this file was exempt.
  const d = dim({ exceptions: [], baseline: { candidates: 60, conforming: 60, exceptions: [{ path: "src/a.ts" }] } });
  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d, fresh: true }).severity, "FIX");
  assert.equal(severityFor({ path: "src/b.ts" }, { dim: d, fresh: true }).severity, "MUST-FIX");
});

test("nothing in the table says BLOCK", () => {
  const seen = new Set();
  for (const fresh of [true, false]) {
    for (const d of [null, dim(), dim({ directive: false }), dim({ precision: "partial" })]) {
      seen.add(severityFor({ path: "src/a.ts" }, { dim: d, fresh }).severity);
    }
  }
  assert.deepEqual([...seen].sort(), ["FIX", "MUST-FIX", "NIT"]);
});

// --- polarity: the area is checked against the sentence it was handed ---

const counterDim = (o = {}) => ({
  key: "test_call_style",
  precision: "precise",
  directive: false,
  states: "counter",
  gate: "ratio",
  counterGate: null,
  claim: "test cases are declared with test(), not it()",
  counterClaim: "test cases are declared with it(), not test()",
  applicability: 6,
  candidates: 60,
  conforming: 0,
  exceptions: [],
  counterExceptions: [],
  baseline: { candidates: 60, conforming: 0, exceptions: [], counterExceptions: [] },
  ...o,
});

test("an area that states the inverse is checked against the inverse, not against the claim", async (t) => {
  // The rendered file deliberately carries no marker saying which side it is,
  // so a check reading `conforming` unconditionally reports every site the map
  // just told the agent to write and stays silent on the one that broke it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\nit("three", () => {})\ntest("four", () => {})\n`);
    commit("add one of each");
  });
  facts(dir, { sha: sha(dir, "main"), dimensions: [counterDim()] });

  const r = await check(dir, { baseRef: "main" });
  assertExamined(r, "src/a.test.ts");

  const found = forKey(r, "test_call_style");
  assert.equal(found.length, 1, "only the site that broke the stated sentence is reported");
  assert.equal(found[0].claim, "test cases are declared with it(), not test()");
  assert.ok(found[0].snippet.startsWith("test("), `reported ${found[0].snippet}`);
  assert.equal(found[0].severity, "MUST-FIX");
});

test("a suppressed two-sided dimension enforces neither side above NIT", async (t) => {
  // States nothing at all, so both the it() and the test() are sites the map
  // counted and said nothing about.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.test.ts", `it("one", () => {})\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\ntest("three", () => {})\n`);
    commit("both sides");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [counterDim({ states: null, gate: "ratio", counterGate: "evidence" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "test_call_style");
  assert.ok(found.length > 0, "the counts still reach the check");
  for (const f of found) assert.equal(f.severity, "NIT", f.snippet);
});

test("the severity table reads the stated side's baseline counts and its own exception list", () => {
  // On a counter area the stored pair is the suppressed side. Reading it there
  // turns 0 of 60 into the weakest possible evidence for a sentence the map
  // never stated, and exempts exactly the files that never broke the one it did.
  const at = (o, file = { path: "src/a.ts" }) =>
    severityFor(file, { dim: counterDim(o), fresh: true }).severity;

  assert.equal(at({}), "MUST-FIX", "60 of 60 counter sites is a clean baseline");
  assert.equal(at({ baseline: { candidates: 60, conforming: 1 } }), "FIX", "one site breaks the inverse");
  assert.equal(
    at({ baseline: { candidates: 60, conforming: 0, counterExceptions: [{ path: "src/a.ts" }] } }),
    "FIX",
    "the counter's own exception list exempts"
  );
  assert.equal(
    at({ baseline: { candidates: 60, conforming: 0, exceptions: [{ path: "src/a.ts" }] } }),
    "MUST-FIX",
    "the claim's exception list is the other side's and exempts nothing here"
  );
});

test("a branch that adds a rake task with no spec breaks a stated obligation", needsRuby, async (t) => {
  // The gap this closes: check iterates dimensions that run against a program,
  // and an obligation has none. A stated claim it cannot run came back clean,
  // which is the shape of the bug 0.1.3 fixed for unread files.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/lonely.rake", "task :lonely do\n  puts 2\nend\n");
    commit("add a task with no spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [
      dim({
        key: "rake_task_spec",
        claim: "a rake task ships with a spec",
        applicability: 60,
        candidates: 60,
        conforming: 60,
        baseline: { candidates: 60, conforming: 60, exceptions: [] },
      }),
    ],
  });

  const report = await check(dir, {});
  const found = forKey(report, "rake_task_spec");

  assert.equal(found.length, 1, `expected one finding, got ${JSON.stringify(report.findings)}`);
  assert.equal(found[0].path, "lib/tasks/lonely.rake");
  assert.equal(found[0].companion, "spec/lib/tasks/lonely_spec.rb");
});

test("a rake task added with its spec in the same commit reports nothing", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/fresh.rake", "task :fresh do\n  puts 2\nend\n");
    write("spec/lib/tasks/fresh_spec.rb", "describe 'fresh' do\nend\n");
    commit("add a task with its spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", claim: "a rake task ships with a spec" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("an obligation the map counted but never stated is not a finding", needsRuby, async (t) => {
  // The same rule every other dimension follows: the check enforces what the
  // map stated. A count the gates suppressed is the map's business.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/lonely.rake", "task :lonely do\n  puts 2\nend\n");
    commit("add a task with no spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", directive: false, gate: "ratio" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("a producer the corpus excludes is not held to an obligation", needsRuby, async (t) => {
  // The scan counts over the corpus, which drops fixture and vendor trees. The
  // check takes its producers from the diff, which does not, so a fixture file
  // was measured against a claim the map never counted it in.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/fixtures/sample.rake", "task :sample do\n  puts 2\nend\n");
    commit("add a fixture rake task");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", claim: "a rake task ships with a spec" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("a rules directory linked out of the repository is reported, not examined", async (t) => {
  // The scan refuses to write through such a link. The check has nothing to
  // refuse, so it says what it could not look at: a clean rules directory
  // reported here is the same lie as a clean diff reported for one git would
  // not produce (F15, F2).
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "house.md"), "# theirs\n");

  const dir = repo(t, ({ dir, write, commit }) => {
    write("src/a.ts", clean(2));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    symlinkSync(outside, join(dir, ".claude", "rules"));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, [], "nothing outside the repository was read");
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.RULES_ESCAPED),
    `no caveat said so: ${notes(r).join("; ")}`
  );
});

test("the report counts rule files past a handful rather than naming them all", async (t) => {
  // This report is read by an agent, and a repository holding ten thousand
  // `.md` files in `.claude/rules/` would otherwise spend ten thousand lines of
  // its context saying so.
  const dir = repo(t, ({ dir, write, commit }) => {
    write("src/a.ts", clean(2));
    mkdirSync(join(dir, ".claude/rules"), { recursive: true });
    for (let i = 0; i < 40; i++) writeFileSync(join(dir, ".claude/rules", `theirs-${i}.md`), "# theirs\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const rendered = formatReport(r);

  assert.equal(r.foreign.length, 40, "the count is still the truth");
  assert.ok(rendered.split("\n").filter((l) => /^ {2}"theirs-/.test(l)).length <= 20);
  assert.match(rendered, /^ {2}and 20 more$/m);
});

test("an unreadable tree reports the obligation unchecked instead of failing every producer", async (t) => {
  // Same shape as F13 for history and F15 for the diff: `ls-tree` answering
  // nothing is not a repository with no files. Read as one, every changed model
  // on the branch owes a spec that "does not exist", and a map stating the
  // obligation puts those at MUST-FIX against an author who wrote the spec.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/other.rb", "class Other\nend\n");
    write("spec/models/other_spec.rb", "describe Other do\nend\n");
    commit("both halves, so nothing is owed");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });
  //
  // The unreadable-tree half is pinned at the `filesAt` seam in `git.mjs`, not
  // here: `ls-tree -r HEAD` and `diff base...HEAD` walk the same tree, so no
  // repository state breaks one and leaves the other working. Removing HEAD's
  // tree, or any subtree under it, fails both, and the run then reports the
  // diff instead. What this case pins is the other side of the guard, that a
  // tree git *does* answer still gets its obligations checked.
  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.findings.filter((f) => f.dimension === "model_spec"),
    [],
    "the companion is in the same commit, so nothing is owed"
  );
});

// The companion listing is the tree at HEAD, and the producers now come from
// the working tree, so an author who wrote both halves and committed neither
// owed a spec that was sitting right there beside the model.
test("a companion written but not committed satisfies the obligation", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/other.rb", "class Other\nend\n");
    write("spec/models/other_spec.rb", "describe Other do\nend\n");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.findings.filter((f) => f.dimension === "model_spec"),
    [],
    "both halves are in the tree, so nothing is owed"
  );
});

// A rename's old path is where its base version lives. Read as a file with no
// base, every site in it is new, and a `git mv` before committing reported the
// whole file as this branch's work: the forgery the base side exists to stop.
test("a file renamed but not committed is judged against its old path", async (t) => {
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    // A fourth site, added after the move. Without the old path the base is
    // unreadable and the file is skipped whole, which reports nothing and
    // passes an assertion that only counts the three that predate the branch.
    writeFileSync(join(root, "src", "moved.ts"), swallow(4));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    forKey(r, "swallowed_error").length,
    1,
    `three sites came with the file and one is new: ${JSON.stringify(r.findings)}`
  );
});

// `--porcelain` defaults to `-unormal`, which collapses an untracked directory
// to one entry ending in `/`. That path is not source, so it was dropped, and
// a new service directory checked before its first commit read clean.
test("a file in a wholly new directory is examined", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/new/deep.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/new/deep.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

// The scan refuses to write through a link out of the repository. The check
// reads, so it refuses to read through one: the matched text reaches a report
// the agent then reads back.
test("a pending path that resolves outside the repository is not read", needsPosixPaths, async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "anat-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.ts"), swallow(2));

  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  symlinkSync(join(outside, "secret.ts"), join(dir, "src", "leak.ts"));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
});

// The header counted the two sets and printed the second only when the numbers
// differed, so two changed files and two examined ones read as the same two
// even when one of the examined was never in the diff.
test("the header says what was examined whenever it is not what changed", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(3));
    write("notes.md", "not source\n");
    commit("one source file and one not");
    write("src/untracked.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.changed.length, 2, "the diff carries a source file and a markdown one");
  assert.equal(r.examined.length, 2, "the markdown is not examined, the untracked source is");
  assert.match(formatReport(r), /2 examined/);
});

// The index letter says the path is an addition; whether it has a base version
// is a question about the merge base, and only that question decides whether
// every site in the file is this branch's work.
test("a tracked file unstaged from the index keeps the base version at its path", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("rm", "-q", "--cached", "src/a.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
});

// A staged rename prints `R` and no `D`, so the path it moved away from was
// never counted as gone: a companion renamed out from under its producer still
// read as sitting right there.
test("a companion renamed away in the tree no longer satisfies the obligation", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/thing.rb", "class Thing\n  def name\n  end\nend\n");
    git("mv", "spec/models/thing_spec.rb", "spec/models/renamed_spec.rb");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    r.findings.filter((f) => f.dimension === "model_spec").length,
    1,
    `the spec this model owes was moved away: ${JSON.stringify(r.findings)}`
  );
});

// The committed side stops at the file cap, and the two sides disagreeing on
// what is too big is what `limits.mjs` exists to stop. Read through one open
// handle, so the size that was checked is the size that is read.
test("a pending file over the size cap is not read from the tree", async (t) => {
  const dir = repo(t, ({ dir: root, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    writeFileSync(join(root, "src", "big.ts"), `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`);
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
  // The whole sentence rather than the prefix, like the other two: which of
  // the three places was looked in is the only thing the three of them say.
  assert.ok(
    notes(r).includes("could not read src/big.ts in the working tree"),
    `a file it refused to read is named, not silently dropped: ${JSON.stringify(r.caveats)}`
  );
});

// Both committed sides are read in one pass per revision, so which revision a
// blob failed to come back from is a lookup rather than the call that failed.
// The three sentences say which of the three places was looked in, and an agent
// reads them to know whether to fix the file or the run.
test("a committed file that will not come back is named at HEAD", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/big.ts", `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`);
    commit("over the cap");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
  assert.ok(notes(r).includes("could not read src/big.ts at HEAD"), JSON.stringify(r.caveats));
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.HEAD_UNREADABLE));
});

test("a base version that will not come back skips the file rather than charging it", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/big.ts", `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/big.ts", swallow(3));
    commit("under the cap");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], "every site in it would otherwise read as newly introduced");
  assert.ok(
    notes(r).includes("could not read src/big.ts at the merge base, so src/big.ts was skipped"),
    JSON.stringify(r.caveats)
  );
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.BASE_UNREADABLE));
});

// Both trees are on disk before either is used, so the guard that removes them
// has to be open from the first read: wrapped around the parse alone it left
// the head tree behind whenever the base read or the loop threw.
test("a revision tree does not outlive a check that threw", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", swallow(2));
    commit("second");
  });
  facts(dir, { sha: sha(dir, "main") });

  // The read that fails is whichever one runs while an earlier tree is still
  // on disk, which is the base read: no counting, and nothing to keep in step
  // with the order the reads are made in.
  const made = [];
  const real = fs.mkdtempSync;
  fs.mkdtempSync = (prefix, ...rest) => {
    const ours = String(prefix).includes("anatomiya-revision-");
    if (ours && made.some(existsSync)) throw new Error("no space left on device");
    const out = real(prefix, ...rest);
    if (ours) made.push(out);
    return out;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.mkdtempSync = real;
    syncBuiltinESMExports();
    for (const path of made) rmSync(path, { recursive: true, force: true });
  });

  await assert.rejects(() => check(dir, { baseRef: "main" }), /no space left on device/);

  assert.equal(made.length, 1, "the head read wrote a tree and the base read threw");
  assert.deepEqual(made.filter(existsSync), [], "the tree already on disk was removed on the way out");
});

// `git status` lists a deletion, and a path that is gone cannot be read. It
// reported one file read from the tree and one it could not read, in the same
// run, about the same file.
test("a file deleted in the working tree is not examined", async (t) => {
  const dir = repo(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    write("src/b.ts", clean(2));
    commit("init");
    git("rm", "-q", "src/b.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), []);
  assert.deepEqual(notes(r).filter((m) => /could not read/.test(m)), []);
});

test("a producer whose companion the branch never wrote is still reported", async (t) => {
  // The control for the guard above. A `return` that fired on every tree rather
  // than on a missing one would turn the whole obligation off, and every case
  // that asserts nothing was found would pass louder for it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/lonely.rb", "class Lonely\nend\n");
    commit("a model with no spec");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });
  const owed = r.findings.filter((f) => f.dimension === "model_spec");

  assert.equal(owed.length, 1, `expected the missing spec to be reported: ${JSON.stringify(r.findings)}`);
  assert.equal(owed[0].path, "app/models/lonely.rb");
  // A field of its own rather than part of the reason, so each writer places it.
  assert.equal(owed[0].companion, "spec/models/lonely_spec.rb");
});

test("a file the check could not read names its own cause, in the singular", () => {
  // This surface always names one file, so it always takes the singular verb,
  // and the four causes are four different things to do about it: a crash is
  // this tool's, rejected syntax is the branch's own code, the cap is a
  // generated file nobody writes by hand, and the rest is this tool or the
  // filesystem. Folding any of them into another sends the reader after the
  // wrong thing.
  assert.equal(unreadReason({ kind: "crashed" }), "crashed the parser");
  assert.equal(unreadReason({ kind: "rejected" }), "holds syntax the parser rejected");
  assert.equal(unreadReason({ kind: "oversize" }), "exceeded the size cap");
  assert.equal(unreadReason({ kind: "unreadable" }), "could not be parsed");
  assert.equal(unreadReason(null), "could not be parsed", "no record at all is the same as unreadable");
});

test("the four causes carry four codes, so nothing has to read the sentence", () => {
  // The sentence above keeps them apart for a human. One code for all four put
  // every other reader back to matching that prose, which is the substring
  // match the codes exist to end.
  const codes = [
    unreadCode({ kind: "crashed" }),
    unreadCode({ kind: "rejected" }),
    unreadCode({ kind: "oversize" }),
    unreadCode({ kind: "unreadable" }),
  ];

  assert.deepEqual(codes, [
    CAVEATS.HEAD_CRASHED,
    CAVEATS.HEAD_REJECTED,
    CAVEATS.HEAD_OVERSIZE,
    CAVEATS.HEAD_UNPARSED,
  ]);
  assert.equal(new Set(codes).size, 4, "four causes, four codes");
  assert.equal(unreadCode(null), CAVEATS.HEAD_UNPARSED, "no record at all is the same as unreadable");
});


/**
 * A repository whose branch adds a Flow file to an area that states the
 * return-type claim. Flow is not TypeScript, so the parser rejects it and the
 * worker retries with the annotations blanked.
 */
async function flowRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-flow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(): number { return ${i} }\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });
  git("checkout", "-q", "-b", "probe");
  writeFileSync(
    join(dir, "src", "flowed.js"),
    ["// @flow", "type Opts = {| name: string |}", "export function describe(o: Opts): string { return o.name }"].join("\n") + "\n"
  );
  git("add", "-A");
  git("commit", "-qm", "flow");
  return dir;
}

test("the check does not report a type claim against a file whose types were stripped", async (t) => {
  // The check walks the same tree the scan counted, and on a retried file the
  // annotations are blanked. Left alone it prints "exported functions declare
  // their return type" next to a line that declares one.
  const repo = await flowRepo(t);

  const report = await check(repo, { baseRef: "main" });
  const text = formatReport(report);

  assert.doesNotMatch(
    text,
    /exported functions declare their return type/,
    `a claim about annotations, on a file whose annotations were stripped:\n${text}`
  );
});

test("a check that could not load the stripper names the dependency too", async (t) => {
  // The check runs in CI, where nobody watched the scan output, so the caveat
  // has to stand on its own: a Flow file it could not read reads as a broken
  // file rather than a missing dependency.
  const home = installWithoutStripper(t);

  const repo = mkdtempSync(join(tmpdir(), "anatomiya-flowcheck-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  mkdirSync(join(repo, "src"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(repo, "src", `f${i}.ts`), `export function f${i}(): number { return ${i} }\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  execFileSync(process.execPath, [join(home, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" });
  git("checkout", "-q", "-b", "probe");
  writeFileSync(join(repo, "src", "flowed.js"), FLOW_SOURCE + "\n");
  git("add", "-A");
  git("commit", "-qm", "flow");

  // As the record rather than as the lines: what the caveat means to a reader
  // is its code, and the sentence is wording nobody promised to keep.
  const out = execFileSync(
    process.execPath,
    [join(home, "bin", "anatomiya.mjs"), "check", repo, "--base", "main", "--format", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const caveats = JSON.parse(out).caveats;

  assert.ok(
    caveats.some((c) => c.code === CAVEATS.STRIPPER_MISSING),
    `nothing named the missing dependency:\n${out}`
  );
  assert.ok(
    caveats.some((c) => c.code === CAVEATS.HEAD_REJECTED && c.message.includes("src/flowed.js")),
    `the Flow file was expected in the caveats:\n${out}`
  );
});

test("a claim is not silenced by a finding invented off the base's stripped tree", async (t) => {
  // The base side goes through the same retry, so on a Flow file its
  // annotations are blanked too. Asking a blind row about that tree answers for
  // every function in it, and those answers cancel the real ones on the head
  // side: a violation the branch genuinely has is reported as pre-existing and
  // disappears. Asked through `doc_comment_style` rather than
  // `explicit_return_type`, because a plain `.js` file cannot carry a return
  // type at all and no longer answers that row on either side.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-basestrip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `/** doc */\nexport function f${i}(): number {\n  return ${i}\n}\n`);
  }
  // Flow-only syntax, so the base is retried and its annotations blanked.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    ["// @flow", "type O = {| n: string |}", "/** doc */", "export function legacy(o: O) {", "  return o.n", "}"].join("\n") + "\n"
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  git("checkout", "-q", "-b", "migrate");
  // Only the Flow-only syntax goes, so the head parses as written and the base
  // is still stripped. The branch adds one export with no doc comment.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    [
      "// @flow",
      "type O = {n: string}",
      "/** doc */",
      "export function legacy(o: O) {",
      "  return o.n",
      "}",
      "export function bare(o: O) {",
      "  return o.n",
      "}",
    ].join("\n") + "\n"
  );
  git("commit", "-qam", "migrate");

  const out = execFileSync(process.execPath, [bin, "check", dir, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(
    out,
    /exported functions carry a doc comment/,
    `the head file added an undocumented export and nothing said so:\n${out}`
  );
});

test("a map holding a type-checked claim says the check did not enforce it", async (t) => {
  // A check that reports no findings is what the command file tells the agent
  // to trust, so a whole class of claim going unasked has to be said out loud.
  // Same shape as B13 for a missing parser and F15 for an unreadable git, and
  // both of those were real bugs.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-deepcaveat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(s: string) {\n  return s.trim().toLowerCase()\n}\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  // Plant a stated semantic claim, which is what a --deep scan would have left.
  const factsPath = join(dir, ".claude/anatomiya/facts.json");
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  facts.areas[0].dimensions.push({
    key: "law_of_demeter",
    tier: "semantic",
    claim: "a call chain stays inside one type",
    precision: "partial",
    applicability: 14,
    langFileCount: 14,
    candidates: 40,
    conforming: 39,
    files: [],
    directive: true,
    states: "claim",
    gate: null,
    exceptions: [],
  });
  writeFileSync(factsPath, JSON.stringify(facts));

  git("checkout", "-q", "-b", "probe");
  writeFileSync(join(dir, "src", "f0.ts"), `export function f0(s: string) {\n  return s.trim()\n}\n`);
  git("commit", "-qam", "probe");

  const out = execFileSync(process.execPath, [bin, "check", dir, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(out, /type-checked claim is stated in the map and not enforced on a branch/, out);
  assert.match(out, /anatomiya scan --deep/, "and it says where the tier does run");
});

/* --- the new claim families at check time --- */

test("the doc-comment claim reads the comments, so a commented export is clean", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `/** a */\nexport function fA() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `/** what b does */\nexport function fB() {}\n`);
    write("src/c.ts", `export function fC() {}\n`);
    commit("add files");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "doc_comment_style", precision: "partial" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assertExamined(report, "src/c.ts");
  const found = forKey(report, "doc_comment_style");
  assert.deepEqual(found.map((f) => f.path), ["src/c.ts"], "only the uncommented export is a finding");
});

test("a learned naming class is enforced as the class the map stored", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function goodName() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `function anotherGood() {}\nfunction bad_name() {}\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "function_naming_case");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].where, "bad_name");
  assert.equal(found[0].line, 2, "the finding points at the declaration, not line 1");
  assert.ok(found[0].snippet.includes("bad_name"), JSON.stringify(found[0].snippet));
});

test("a routing claim is not asked of a repository with no wrapper", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("tools/loose.ts", `console.log("x");\n`);
    commit("add");
  });
  facts(dir, { sha: sha(dir, "main") });
  const report = await check(dir);
  assertExamined(report, "tools/loose.ts");
  assert.deepEqual(forKey(report, "route_logging"), []);
});

test("a new file breaking the area's learned filename class is a finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/orderList.ts", `export const b = 2;\n`);
    write("src/data-store.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/orderList.ts");
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/orderList.ts"]);
  assert.equal(found[0].claim, "files here are named kebab-case");
});

test("a modified file keeping its old name is not a filename finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacyName.ts", `export const a = 1;\n`);
    write("src/user-profile.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/legacyName.ts", `export const a = 9;\n`);
    commit("edit");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/legacyName.ts");
  assert.deepEqual(forKey(report, "file_naming_case"), [], "the name predates this branch");
});

test("a hostile learned value in the facts never reaches a claim", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function goodName() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `function fooBar() {}\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "\n# hostile\ninjected" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assert.ok(!JSON.stringify(report.findings).includes("hostile"), "the value is not a class, so it enforces nothing");
  assert.deepEqual(forKey(report, "function_naming_case"), []);
});

test("a learned base class is enforced the way a learned naming class is", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/controllers/users_controller.rb", "class UsersController < ApplicationController\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/controllers/x_controller.rb", "class XController < ActionController::Base\nend\n");
    commit("add");
  });
  const rubyArea = (learned) => [{
    id: "aaaaaaaa",
    path: "app/controllers",
    globs: [{ negated: false, dir: "app/controllers", tail: "**/*.rb" }],
    fileCount: 8,
    dimensions: [dim({ key: "class_base", learned })],
  }];
  facts(dir, { sha: sha(dir, "main"), areas: rubyArea("ApplicationController") });
  const report = await check(dir);
  assertExamined(report, "app/controllers/x_controller.rb");
  assert.deepEqual(notes(report).filter((m) => /schema/.test(m)), [], "the writer's own schema reads clean");
  const found = forKey(report, "class_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/controllers/x_controller.rb");
  assert.equal(found[0].line, 1);
  assert.equal(found[0].claim, "classes here inherit ApplicationController");
});

test("a learned mixin is enforced the way a learned base class is", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User\n  include Auditable\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/order.rb", "class Order\n  include Trackable\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Auditable" })],
    }],
  });
  const report = await check(dir);
  assertExamined(report, "app/models/order.rb");
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/models/order.rb");
  assert.equal(found[0].claim, "classes here include Auditable");
});

test("a mixin finding fires once per class body, not once per included constant", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    // The shape the row was written for: a worker mixing in the learned module
    // and one more beside it.
    write("app/workers/b_worker.rb", "class BWorker\n  include Sidekiq::Worker\n  include Sidekiq::Throttled::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\nend\n");
    write("app/workers/d_worker.rb", "class DWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.deepEqual(
    found.map((f) => f.path).sort(),
    ["app/workers/c_worker.rb", "app/workers/d_worker.rb"],
    JSON.stringify(report.findings)
  );
});

// The violation an agent actually commits. A new worker that forgets the
// include used to pass clean on the same run that caught `include Comparable`.
test("a body that forgets the include is caught, not only one that includes the wrong module", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/wrong_worker.rb", "class WrongWorker\n  include Comparable\nend\n");
    write("app/workers/bare_worker.rb", "class BareWorker\n  def perform\n  end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.deepEqual(
    found.map((f) => f.path).sort(),
    ["app/workers/bare_worker.rb", "app/workers/wrong_worker.rb"],
    JSON.stringify(report.findings)
  );
});

// A body declaring nothing has no constants to be identified by, so every bare
// body in one file fingerprinted alike and a new one absorbed an older one's
// finding: the report then names a class the branch never touched.
test("a bare body added above two others is the one reported", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/w.rb", "class BWorker\nend\n\nclass CWorker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/w.rb", "class NewWorker\nend\n\nclass BWorker\nend\n\nclass CWorker\nend\n");
    commit("a third bare body, written first");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/workers",
    dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "module_include");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].where, "NewWorker", "the body this branch added, not the one it sat above");
});

test("a body mixing in a different set of modules is not the body it replaced", needsRuby, async (t) => {
  // The grouped site's identity used to be the include call's own node, which
  // is `call include` for every body in the file, so one new violating body
  // absorbed the one it was written next to.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/w.rb", "class AWorker\n  include Sidekiq::Worker\nend\n\nclass CWorker\n  include Foo::Bar\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/w.rb", "class AWorker\n  include Sidekiq::Worker\nend\n\nclass DWorker\n  include Baz::Qux\nend\n");
    commit("swap the body");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/workers/w.rb");
});

test("reordering the modules a class body includes introduces nothing", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Baz\n  include Foo::Bar\nend\n");
    commit("swap");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  assertExamined(report, "app/workers/c_worker.rb");
  assert.deepEqual(forKey(report, "module_include"), [], JSON.stringify(report.findings));
});

test("a violating body that gains a constant is charged again, and that is accepted", needsRuby, async (t) => {
  // The accepted cost of keying the site on what the body mixes in: adding a
  // module to a body that already violated moves its fingerprint, so the branch
  // is charged for a violation it did not write. The branch did edit the
  // violating body, and the severity is still capped by the baseline rules.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("add one module to a body that already violated");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/workers/c_worker.rb");
});

test("a learned superclass is enforced the way a learned naming class is", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends React.Component {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "React.Component" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  const found = forKey(report, "extends_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "Widget");
  assert.equal(found[0].claim, "classes here extend React.Component");
});

test("a learned type prefix is enforced on a new interface", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface IThing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface Comment { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "I" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "interface_prefix");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "Comment");
  assert.equal(found[0].claim, "interfaces are named with a I prefix");
});

test("a learned absence of a prefix is enforced against a prefixed interface", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface Thing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface IFoo { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "none" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "interface_prefix");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "IFoo");
  assert.equal(found[0].claim, "interfaces carry no prefix", "an absence is written out, never filled in");
});

test("a learned class read off the source is encoded before it reaches a claim", async (t) => {
  // The stored class of a source-learned row is repository text, so widening
  // the check to enforce it widens what a committed record can render (F4).
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends Base {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "Evil|Base\nX" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  const found = forKey(report, "extends_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].claim, "classes here extend Evil Base X");
  assert.ok(!/[|\n]/.test(found[0].claim), JSON.stringify(found[0].claim));
});

test("a learned class the encoder empties enforces nothing", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends Base {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "```" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  assert.deepEqual(forKey(report, "extends_base"), [], "a sentence that would name nothing states nothing");
});

test("a learned prefix outside its own vocabulary enforces nothing", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface IThing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface Comment { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "\n# hostile\ninjected" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assert.ok(!JSON.stringify(report.findings).includes("hostile"), JSON.stringify(report.findings));
  assert.deepEqual(forKey(report, "interface_prefix"), []);
});

test("a rename into a foreign filename class is a finding, a rename within the class is not", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/data-store.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/data-store.ts", "src/dataStore.ts");
    git("mv", "src/user-profile.ts", "src/user-page.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/dataStore.ts"], JSON.stringify(found));
  assert.equal(found[0].oldPath, "src/data-store.ts", "the rename provenance travels with the finding");
});

test("a stated routing claim is enforced at check time where the map offers it", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/logger.ts", `export const logger = { info(_m) {} };\n`);
    write("src/a.ts", `import { logger } from "./logger.js";\nlogger.info("x");\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/loud.ts", `console.log("direct");\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "route_logging", precision: "partial" })],
    capabilities: ["logging"],
  });
  const report = await check(dir);
  assertExamined(report, "src/loud.ts");
  const found = forKey(report, "route_logging");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.ok(found[0].snippet.includes("console.log"));
});

test("a badly named new file that does not parse is still a filename finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/badName.ts", `export const = 5 ((((\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/badName.ts"], "the name needs no tree");
});

test("a Pascal-named migration breaks a stated snake_case claim (#33)", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("db/migrate/20260101000000_create_users.rb", `class CreateUsers < ActiveRecord::Migration[7.0]\n  def change\n  end\nend\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("db/migrate/20260816120000_AddBadColumn.rb", `class AddBadColumn < ActiveRecord::Migration[7.0]\n  def change\n  end\nend\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "db/migrate",
    dimensions: [dim({ key: "file_naming_case", learned: "snake_case" })],
    areas: [{ id: "aaaaaaaa", path: "db/migrate", globs: [{ negated: false, dir: "db/migrate", tail: "**/*.rb" }], fileCount: 8,
      dimensions: [dim({ key: "file_naming_case", learned: "snake_case" })] }],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["db/migrate/20260816120000_AddBadColumn.rb"], JSON.stringify(report.findings));
  assert.equal(found[0].severity, "MUST-FIX", "the baseline holds no violation, so this branch is the first");
});

/* --- the caveat codes, at the site each one is raised --- */

/** The codes a run answered with, so a case names the code rather than its sentence. */
const codesOf = (report) => report.caveats.map((c) => c.code);

test("a map from a build this one cannot read is one code, whatever the sentence says", async (t) => {
  // Two sentences answer this: a store directory resolving outside the
  // repository, and a schema this build does not read. They are one fact to a
  // reader, that there is a map and none of it was used.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });
  const store = join(dir, ".claude", "anatomiya", "facts.json");
  writeFileSync(store, JSON.stringify({ ...JSON.parse(readFileSync(store, "utf8")), schema: 999 }));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(codesOf(r), [CAVEATS.MAP_UNREADABLE]);
});

test("a repository holding none of the base refs says so, by code", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });

  const r = await check(dir);

  assert.ok(codesOf(r).includes(CAVEATS.NO_BASE_REF), JSON.stringify(codesOf(r)));
});

test("a branch sharing no history with its base is the degraded mode, not an empty answer", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "--orphan", "work");
    write("src/b.ts", swallow(1));
    commit("orphan");
    // Left in the tree: with no base to judge it against, a pending file is
    // named rather than charged to whoever happens to be running the check.
    write("src/c.ts", swallow(1));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.NO_MERGE_BASE), JSON.stringify(codesOf(r)));
  assert.ok(codesOf(r).includes(CAVEATS.PENDING_UNJUDGED), JSON.stringify(codesOf(r)));
});

/**
 * A repository whose index git will not read.
 *
 * Every corpus probe goes through that index, and so does the pending edits
 * listing, while a three-dot diff between two commits does not. That is what
 * makes it the cheap way to reach the three codes below at once.
 */
function withUnreadableIndex(t, extra = null) {
  return repo(t, ({ dir, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    if (extra) write(extra.path, extra.body);
    commit("swallow");
    writeFileSync(join(dir, ".git", "index"), "this is not a git index");
  });
}

test("a corpus that will not list costs the routing claims and says so, by code", async (t) => {
  // Nothing here refuses over it: a probe that failed is a question left
  // unanswered rather than a branch nobody may report on.
  const dir = withUnreadableIndex(t);

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.PENDING_UNLISTED), JSON.stringify(codesOf(r)));
  assert.ok(codesOf(r).includes(CAVEATS.CAPABILITIES_UNKNOWN), JSON.stringify(codesOf(r)));
  // The discriminator between the two single-use codes: nothing examined here
  // could carry a framework, so the framework probe never ran. Exchanging the
  // two codes at their sites passes every other test in this repository.
  assert.ok(!codesOf(r).includes(CAVEATS.FRAMEWORKS_UNKNOWN), JSON.stringify(codesOf(r)));
});

test("a corpus that will not list costs the framework claims too, where one could signal", needsRuby, async (t) => {
  const dir = withUnreadableIndex(t, { path: "app/models/thing.rb", body: "class Thing\nend\n" });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.FRAMEWORKS_UNKNOWN), JSON.stringify(codesOf(r)));
});

test("a file that did not parse at the merge base is named apart from one that did not parse now", async (t) => {
  // The branch fixed it, so there is no base side to difference against and
  // every site in the file reads as newly introduced. The code is what tells
  // that apart from a file this branch broke.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/broken.ts", "export function x( { !!!\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/broken.ts", swallow(1));
    commit("fixed");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(codesOf(r), [CAVEATS.NO_MAP, CAVEATS.BASE_UNPARSED]);
});

test("a rules directory that is not a directory is one nobody could list", async (t) => {
  // `.claude/rules` is a repository path like any other, so a clone can ship a
  // regular file there. Reported rather than refused: the check has nothing to
  // refuse and says what it could not look at.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    write(".claude/rules", "not a directory\n");
    commit("swallow");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.RULES_UNLISTED), JSON.stringify(codesOf(r)));
});

test("a new file whose stem spells no naming class at all is a finding", async (t) => {
  // The one-sided shape H16 fixed for `module_include`, on the filename row: a
  // stem spelling a different class was caught and a stem spelling no class
  // escaped, so `TMP_FILE.ts` and `_tmpProbe.ts` passed a stated camelCase
  // claim while `TmpFile.ts` and `tmp_file.ts` were both caught.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/TMP_FILE.ts", `export const b = 2;\n`);
    write("src/_tmpProbe.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path).sort(), ["src/TMP_FILE.ts", "src/_tmpProbe.ts"]);
  assert.equal(found[0].claim, "files here are named kebab-case");
});

test("the two names that match every class are still not sites", async (t) => {
  // A single lowercase run and a bare filename are the predicate's own two
  // exclusions, and they are kept: counting them would let a directory of
  // `index.ts` state a convention no filename ever expressed, and then break
  // its own claim on the next one.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/index.ts", `export const b = 2;\n`);
    write("src/Rakefile", `task :x\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assert.deepEqual(forKey(report, "file_naming_case"), []);
});

/* --- an explicit base that names nothing is a refusal (#51) --- */

test("an explicit base that resolves nowhere is refused, with the ref echoed back", async (t) => {
  // The command file's own contract is that a non-zero exit means the check
  // could not run. A typo used to be answered with 685 added-lines findings
  // over 2,150 files at exit 0, and the agent reading it saw a giant review it
  // never asked for on a branch that changed nothing.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  await assert.rejects(
    () => check(dir, { baseRef: "no/such/ref" }),
    (err) => {
      assert.match(err.message, /no\/such\/ref/, err.message);
      assert.match(err.message, /--base/, "the fix named is the argument, not the repository");
      return true;
    }
  );
});

test("HEAD resolves locally, so it is refused for what it is rather than as unfetchable", async (t) => {
  // `HEAD` resolves in every repository that has a commit, so reporting it as a
  // base the shallow clone could not fetch names the wrong cause and the wrong
  // fix. It is refused because it is this branch's own tip (E6).
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(
    () => check(dir, { baseRef: "HEAD" }),
    (err) => {
      assert.match(err.message, /HEAD/);
      assert.doesNotMatch(err.message, /fetch/, err.message);
      return true;
    }
  );
});

test("a base that does resolve is used, whatever its spelling", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  for (const ref of ["main", sha(dir, "main")]) {
    const r = await check(dir, { baseRef: ref });
    assert.equal(r.mode, "compare", `${ref} resolves`);
  }
});

test("the default candidate list still degrades rather than refusing", async (t) => {
  // The degradation stays for the case it was built for: a repository holding
  // none of the base refs was never asked for one, so nothing was mistyped.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(r.mode, "added-lines");
  assert.ok(codesOf(r).includes(CAVEATS.NO_BASE_REF), JSON.stringify(codesOf(r)));
});

test("a small plurality does not turn the practice most of the repository follows into a finding", async (t) => {
  // Measured end to end: a 7-site area at 3 named and 4 inline flipped the
  // printed sentence, and a branch adding a *named* handler was then reported
  // against the inverse. `handler_is_named` is 0.757 the other way repo-wide.
  const named = 'export const A = () => { const h = () => {}; return <button onClick={h} /> }\n';
  const inline = 'export const B = () => <button onClick={() => {}} />\n';
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 3; i++) write(`src/n${i}.tsx`, named.replace(/A/g, `A${i}`).replace("h", `h${i}`));
    for (let i = 0; i < 4; i++) write(`src/i${i}.tsx`, inline.replace("B", `B${i}`));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/new.tsx", named.replace(/A/g, "N").replace("h", "hn"));
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    fileCount: 7,
    pinned: ["src/n0.tsx", "src/n1.tsx", "src/n2.tsx", "src/i0.tsx", "src/i1.tsx", "src/i2.tsx", "src/i3.tsx"],
    dimensions: [
      dim({
        key: "handler_is_named",
        directive: false,
        states: null,
        gate: "ratio",
        candidates: 7,
        conforming: 3,
        counterClaim: "an event handler prop is given an inline arrow, not a named function",
        counterGate: "ratio",
        baseline: { candidates: 7, conforming: 3, exceptions: [] },
      }),
    ],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "handler_is_named"), [], JSON.stringify(forKey(r, "handler_is_named")));
});

test("a claim stated on borrowed confidence is capped, and the reason says whose confidence it was", () => {
  // The map may state a nine-site claim on the strength of the rest of the
  // repository, and the check may not then enforce it at the severity that
  // means "this branch is the first violation in the area's history". The old
  // reason read "9 of 9 baseline sites is thin" under a map that had just
  // stated it, which is a contradiction rather than an explanation.
  const d = dim({ borrowed: true, baseline: { candidates: 9, conforming: 9, exceptions: [] } });
  const v = severityFor({ path: "src/a.ts" }, { dim: d, fresh: true });

  assert.equal(v.severity, "FIX");
  assert.match(v.reason, /rest of the repository/, v.reason);
  assert.doesNotMatch(v.reason, /thin/);
});

test("a thin baseline nobody lent anything to still reads as thin", () => {
  const d = dim({ baseline: { candidates: 9, conforming: 9, exceptions: [] } });

  assert.match(severityFor({ path: "src/a.ts" }, { dim: d, fresh: true }).reason, /9 of 9 baseline sites is thin/);
});

test("an @ base is refused before anything is fetched, so a remote branch named HEAD cannot become one", async (t) => {
  // E6: over `<HEAD>..HEAD` the branch's own edits count as map drift, so the
  // literal ref is refused rather than quietly accepted. The shallow fallback
  // fetches by branch name, so the refusal has to come before it.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(() => check(dir, { baseRef: "@" }), /--base @ names this branch's own tip/);
});

test("a base spelled in a way git will not take resolves to nothing and is refused as such", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(() => check(dir, { baseRef: "bad..name" }), /--base bad\.\.name resolves to no commit/);
});

/* --- an area with no slot for a dimension inherits the nearest one that states (#55) --- */

test("the first site of a kind an area has never held is answered by the area it sits inside", async (t) => {
  // A dimension that finds zero sites in an area produces no slot at all, so
  // the area has no sentence to ask and the first `Net::HTTP` call it ever
  // sees, the one that decides whether the area's HTTP goes through the
  // repository's own client, could never be flagged at any severity. Covered
  // but first-of-kind was blinder than uncovered, which at least gets a NIT.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].area, "src/api");
  assert.equal(hits[0].severity, "FIX", "the ancestor's file is not delivered to this directory, so not MUST-FIX");
  assert.match(hits[0].reason, /counted in src/);
});

test("no slot anywhere on the path keeps today's silence", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim({ directive: false, states: null, gate: "authors" })] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], "an ancestor that states nothing lends nothing");
});

test("an area that holds its own slot never reads an ancestor's", async (t) => {
  // The deepest area containing a file supplies its claims. Inheriting past a
  // slot the area does have would judge the file against a convention counted
  // over a different population.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [dim({ directive: false, states: null, gate: "authors" })] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT", "its own suppressed slot, not the parent's stated one");
});

test("an inherited slot is judged on the side the ancestor was handed", async (t) => {
  // The polarity travels with the slot. Reading the ancestor for the finding
  // and the area for the side would charge an author for writing the sentence
  // the ancestor's map handed them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a() { try { go() } catch (e) { log(e) } }\n`);
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write(
      "src/api/b.ts",
      `export const b = 1;\n` +
        "/** documented */\nexport function documented() { return 1 }\n" +
        "export function bare() { return 2 }\n"
    );
    commit("two exports");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [
          dim({
            key: "doc_comment_style",
            states: "counter",
            directive: false,
            gate: "ratio",
            counterClaim: "code here explains itself; exported functions carry no doc comment",
            counterGate: null,
            counterExceptions: [],
          }),
        ],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "doc_comment_style");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].where, "documented", "the documented export is what breaks the inherited sentence");
  assert.equal(hits[0].claim, "code here explains itself; exported functions carry no doc comment");
});

/* --- a directive the 40-line budget dropped may not reach MUST-FIX (#70) --- */

test("a claim the area file had no room to print is capped, and the reason says why", () => {
  const d = dim({ baseline: { candidates: 60, conforming: 60, exceptions: [] } });

  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d, fresh: true }).severity, "MUST-FIX");
  const capped = severityFor({ path: "src/a.ts" }, { dim: d, fresh: true, dropped: true });
  assert.equal(capped.severity, "FIX");
  assert.match(capped.reason, /no room/, capped.reason);
});

test("a directive the file dropped is enforced, but never at the top severity", async (t) => {
  // `check` reads facts.json, not the rendered area file, so a sentence the map
  // never printed was still reported as "all 60 baseline sites conform", which
  // means the map told the agent and they were the first to break it. On a
  // measured repository three slots with a perfect baseline reached MUST-FIX on
  // a claim that appears nowhere in the file the agent reads.
  const filler = [
    "error_shape", "module_state_const", "async_error_handling", "optional_chaining",
    "function_style", "explicit_return_type", "nullish_default", "non_null_assertion",
    "absent_is_null", "doc_comment_style",
  ];
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    // `swallowed_error` sits last, so it is the block the budget drops.
    dimensions: [...filler.map((key) => dim({ key, precision: "partial" })), dim()],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].severity, "FIX");
  assert.match(hits[0].reason, /no room/, hits[0].reason);
});

test("an error class is not held to the base the area learned", needsRuby, async (t) => {
  // Every Rails service directory grows error classes, so on a perfect
  // baseline the next one anyone adds was a MUST-FIX asking for a class Ruby
  // refuses to raise.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/services/a.rb", "class A < ActiveInteraction::Base\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/services/quota_exceeded_error.rb", "class QuotaExceededError < StandardError\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/services",
      globs: [{ negated: false, dir: "app/services", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ActiveInteraction::Base" })],
    }],
  });

  const report = await check(dir);

  assert.deepEqual(forKey(report, "class_base"), [], JSON.stringify(forKey(report, "class_base")));
});

test("the class an area learned is not asked to inherit itself", needsRuby, async (t) => {
  // `class ApplicationRecord < ApplicationRecord` is a NameError.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User < ApplicationRecord\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/application_record.rb", "class ApplicationRecord < ActiveRecord::Base\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord" })],
    }],
  });

  const report = await check(dir);

  assert.deepEqual(forKey(report, "class_base"), [], JSON.stringify(forKey(report, "class_base")));
});

/* --- an omission is only a finding where the map stated the claim (#54) --- */

test("a body that includes nothing is not judged against a row the map did not state", needsRuby, async (t) => {
  // H16's new site is the forgotten include, and its whole meaning is "you
  // should have written X". On a row the map holds at "20 of 31 sites, no
  // convention" that is advice the map itself refuses to print: a count failing
  // the gate prints as a count and never as a directive. The NIT tier softens
  // it, not the direction.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  def name; end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty", directive: false, states: null, gate: "ratio" })],
    }],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "module_include"), [], JSON.stringify(forKey(r, "module_include")));
});

test("a body that includes the wrong module is still counted where the map said nothing", needsRuby, async (t) => {
  // The difference is the direction of the advice. "you wrote a different
  // module from the one this area writes" is the count speaking; "add this
  // module" is a directive the gates refused.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  include Comparable\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty", directive: false, states: null, gate: "ratio" })],
    }],
  });

  const r = await check(dir);
  const hits = forKey(r, "module_include");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].severity, "NIT");
});

test("a forgotten include is still a finding where the map did state the claim", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  def name; end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty" })],
    }],
  });

  const r = await check(dir);

  assert.equal(forKey(r, "module_include").length, 1, JSON.stringify(r.findings));
});

test("the check excuses the wrapper the scan excused", async (t) => {
  // A scan-only exclusion is the H12 asymmetry in reverse: the map stops
  // naming the client as its own exception and the check keeps reporting it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/request.ts", `export const go = () => fetch("/x");\n`);
    write("src/userApi.ts", `export const go = () => fetch("/y");\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    capabilities: ["network"],
    dimensions: [dim({ key: "route_network", precision: "partial" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "route_network").map((f) => f.path), ["src/userApi.ts"], JSON.stringify(r.findings));
});

test("a branch that edits an abstract base is not asked for a spec for it", needsRuby, async (t) => {
  // A scan-only exclusion makes the one commit in 483 that edits a base
  // controller a finding against a file the map never counted.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/controllers/api/v1/base_controller.rb", "class Api::V1::BaseController\nend\n");
    write("app/controllers/api/v1/listings_controller.rb", "class Api::V1::ListingsController\nend\n");
    write("spec/controllers/api/v1/listings_controller_spec.rb", "describe Api::V1::ListingsController do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/controllers/api/v1/base_controller.rb", "class Api::V1::BaseController\n  def x; end\nend\n");
    commit("edit the base");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/controllers",
      globs: [{ negated: false, dir: "app/controllers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "controller_spec" })],
    }],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "controller_spec"), [], JSON.stringify(r.findings));
});

test("a plain JavaScript file on a branch is not asked for a return type", async (t) => {
  // The scan does not count it, so the check must not enforce it: the two
  // disagreeing about what a site is is the asymmetry every one of these rules
  // is written to close.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a(): number { return 1 }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.js", `export function b(rows) { return rows.length }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "explicit_return_type", precision: "partial" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "explicit_return_type"), [], JSON.stringify(r.findings));
});

test("a file that gains JSX on the branch does not have its whole base side skipped", async (t) => {
  // The kind was answered per revision, so a file whose base version held no
  // JSX had its base side judged as the other kind and skipped whole: every
  // pre-existing violation in it came back as newly introduced, at MUST-FIX, on
  // lines the diff never touched.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    write("src/Helper.tsx", `export function bad_helper(x) { return x + 1 }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/Helper.tsx", `export function bad_helper(x) { return x + 1 }\nexport const Extra = () => <div />\n`);
    commit("add a component to the helper file");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "jsx", narrowed: true })],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "function_naming_case").map((f) => f.where),
    [],
    JSON.stringify(r.findings)
  );
});

test("the sentence the check quotes is the one the map printed", async (t) => {
  // The map names the kind a narrowed row was learned over. The check built its
  // own text from the registry template and quoted the unqualified sentence,
  // the one that pools the excluded files back in, in the finding, the JSON and
  // the annotations at once.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/SyncTooltip.ts", `export function SyncTooltip(x) { return x }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({ key: "file_naming_case", learned: "camelCase", learnedKind: "module", narrowed: true }),
      dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "module", narrowed: true }),
    ],
  });

  const r = await check(dir);
  const claims = r.findings.map((f) => f.claim);

  assert.ok(claims.length >= 2, JSON.stringify(r.findings));
  for (const c of claims) {
    assert.match(c, /files that hold no JSX|files here that hold no JSX/, JSON.stringify(claims));
  }
});

test("an area the narrowing left whole keeps the plain sentence in the finding too", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/SyncTooltip.ts", `export function SyncTooltip(x) { return x }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "module" })],
  });

  const r = await check(dir);

  assert.deepEqual(
    [...new Set(r.findings.map((f) => f.claim))],
    ["functions are named camelCase"],
    JSON.stringify(r.findings)
  );
});

test("a claim the owning area's own globs never deliver here is capped", async (t) => {
  // Ownership is the directory prefix and delivery is the glob, and A10 makes
  // the glob the narrower of the two: an area listing only its own files owns
  // every new subdirectory under it and delivers its sentences to none of them.
  // On one measured repository 11 of 156 areas carry no recursive glob of their
  // own, and a planted file in a new subdirectory of one of them drew MUST-FIX
  // on a claim its author was never handed.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/one.ts", `export const one = 1\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/nested/deep.ts", `let two = 2\nexport { two }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [{ negated: false, dir: "src", tail: "*.ts" }],
        fileCount: 8,
        dimensions: [dim({ key: "module_state_const" })],
      },
    ],
  });

  const r = await check(dir);
  const found = forKey(r, "module_state_const");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "FIX", JSON.stringify(found[0]));
  assert.match(found[0].reason, /which this directory sits inside/);
});

test("an obligation is capped on a path the area's globs never deliver to, like every other finding", async (t) => {
  // The cap reached the tree rows and the filename rows and not the third
  // producer, so one file could draw a FIX for its name and a MUST-FIX for its
  // missing spec off the same undelivered area file.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/nested/other.rb", "class Other\nend\n");
    commit("a model in a new subdirectory, no spec");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "app/models",
        globs: [{ negated: false, dir: "app/models", tail: "*.rb" }],
        fileCount: 8,
        dimensions: [dim({ key: "model_spec", directive: true })],
      },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "model_spec");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "FIX", JSON.stringify(found[0]));
  assert.match(found[0].reason, /which this directory sits inside/);
});

test("an undelivered claim the gates suppressed is still only a NIT", async (t) => {
  // The cap replaced the verdict instead of capping it, so a slot the map
  // prints as "no convention" was raised from NIT to FIX on exactly the paths
  // the map never delivered to, with a reason claiming it was counted there.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/one.ts", `export const one = 1\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/nested/deep.ts", `let two = 2\nexport { two }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [{ negated: false, dir: "src", tail: "*.ts" }],
        fileCount: 8,
        dimensions: [dim({ key: "module_state_const", states: null, directive: false, gate: "ratio" })],
      },
    ],
  });

  const r = await check(dir);
  const found = forKey(r, "module_state_const");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "NIT", JSON.stringify(found[0]));
  assert.match(found[0].reason, /no convention stated here/);
});

test("a helper in a directory of components is not judged by the components' naming class", async (t) => {
  // The map learned PascalCase over the files that hold JSX. A camelCase helper
  // beside them expresses no opinion about that convention, and judging it by
  // one produced 5 of the 9 findings on one measured pull request.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    write("src/orderList.tsx", `export const orderList = () => <div />\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" })],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "file_naming_case").map((f) => f.path),
    ["src/orderList.tsx"],
    JSON.stringify(forKey(r, "file_naming_case"))
  );
});

test("a file the parser could not read is not sorted into a kind by its absence", async (t) => {
  // `facets: null` read as "module", so a row narrowed to the module side
  // judged an unread `.tsx` at MUST-FIX, one line under the caveat saying the
  // file was not checked, and the rename it asked for turns a component into a
  // host element.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/WidgetNew.tsx", `export function WidgetNew() {\n  return <div>x</div>\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "camelCase", learnedKind: "module" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case"), [], JSON.stringify(r.findings));
});

test("a map with no learned kind judges every file, which is what an older record means", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "PascalCase" })],
  });

  const r = await check(dir);

  assert.equal(forKey(r, "file_naming_case").length, 1);
});

test("a sibling whose path merely starts with another area's is not inside it", async (t) => {
  // `src/apiary` is not inside `src/api`. The separator is what makes the
  // prefix a containment rather than a spelling coincidence.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/api/a.ts", clean(2));
    write("src/apiary/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/apiary/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/apiary", globs: [glob("src/apiary")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(forKey(r, "swallowed_error")));
});

test("the repository root is an ancestor of everything and is asked last", async (t) => {
  // "." contains every path without being a prefix of any of them, the same
  // rule `areaOwner` already carries.
  const dir = repo(t, ({ git, write, commit }) => {
    write("root.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: ".", globs: [glob(".")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim({ key: "error_shape" })] },
      { id: "cccccccc", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(r.findings));
  assert.match(hits[0].reason, /counted in \./, hits[0].reason);
});

test("the nearest ancestor that states wins over a further one", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("root.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: ".", globs: [glob(".")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "cccccccc", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.match(forKey(r, "swallowed_error")[0].reason, /counted in src/);
});

test("an inherited slot is judged over the population its ancestor measured, not over this file", async (t) => {
  // The two rules have to compose: a slot inherited from an ancestor is still
  // a class learned over one kind of file, and a helper does not answer it just
  // because it sits one directory further down.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    write("src/api/keep.tsx", `export const Keep = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    write("src/api/orderList.tsx", `export const orderList = () => <div />\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" })],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "file_naming_case").map((f) => f.path),
    ["src/api/orderList.tsx"],
    JSON.stringify(forKey(r, "file_naming_case"))
  );
});

test("a filename claim is inherited from the area above, capped at FIX", async (t) => {
  // An area with no slot for the filename row is one where nothing classified,
  // not one that declined the convention.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/api/index.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/orderList.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir);
  const hits = forKey(r, "file_naming_case");

  assert.deepEqual(hits.map((f) => f.path), ["src/api/orderList.ts"]);
  assert.equal(hits[0].severity, "FIX");
  assert.match(hits[0].reason, /counted in src/);
});

test("renaming a file that was not a site to one that is is still a finding", async (t) => {
  // The rename guard compared the two classes, and a name that spells no class
  // and a name that spells every class both classify to null, so renaming
  // `index.ts` to `TMP_FILE.ts` compared null against null and answered
  // "the name did not change class".
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/index.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/index.ts", "src/TMP_FILE.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case").map((f) => f.path), ["src/TMP_FILE.ts"]);
});

test("renaming between two names that both spell no class is not a new finding", async (t) => {
  // The old name predates the branch and both are the same non-answer.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/TMP_A.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/TMP_A.ts", "src/TMP_B.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case"), []);
});

test("a hand-edited area with no path does not take the whole check down", async (t) => {
  // The record is repository-committed, so a shape nobody wrote by machine has
  // to degrade rather than throw: the array is checked, its entries are not.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: null, globs: [glob("src")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(forKey(r, "swallowed_error").length, 1, JSON.stringify(r.findings));
});

test("a name spelling no class is an omission too, so it needs a stated claim", async (t) => {
  // The same rule the include-less body gets: "name this file differently" is
  // advice, and on a row the gates suppressed it is advice the map itself
  // refuses to print. A name spelling a *different* class is the count
  // speaking and is reported either way, which is what it always did.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/TMP_FILE.ts", `export const b = 2;\n`);
    write("src/orderList.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({ key: "file_naming_case", learned: "kebab-case", directive: false, states: null, gate: "evidence" }),
    ],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case").map((f) => f.path), ["src/orderList.ts"]);
});

/* --- the shallow arm, which #51 was measured on --- */

/** A depth-1 clone of a repository with history, which is what CI checks out. */
function shallowClone(t, build) {
  const outer = mkdtempSync(join(tmpdir(), "anatomiya-shallow-"));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const origin = join(outer, "origin");
  mkdirSync(origin, { recursive: true });

  const git = (...a) => execFileSync("git", a, { cwd: origin, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("checkout", "-q", "-b", "main");
  build({
    write: (rel, body) => {
      const abs = join(origin, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    },
    commit: (m) => {
      git("add", "-A");
      git("commit", "-qm", m);
    },
  });

  const clone = join(outer, "clone");
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${origin}`, clone], { stdio: "pipe" });
  return clone;
}

test("a shallow clone refuses a base it cannot reach rather than reviewing the whole branch", async (t) => {
  // The measurement behind this was taken on a genuinely shallow clone, where
  // the fetch fallback exists for a reason: 685 added-lines findings over 2,150
  // files at exit 0, on a branch that changed nothing.
  const dir = shallowClone(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(3));
    commit("more");
  });
  assert.equal(
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: dir, encoding: "utf8" }).trim(),
    "true",
    "the fixture really is shallow"
  );

  await assert.rejects(
    () => check(dir, { baseRef: "no/such/ref" }),
    /--base no\/such\/ref resolves to no commit in this repository, and this shallow clone could not fetch it/
  );
});

test("a shallow clone with no base named still degrades rather than refusing", async (t) => {
  // The candidate list is this tool's own guess, and a clone that holds none of
  // them is an ordinary repository rather than a typo.
  const dir = shallowClone(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  execFileSync("git", ["remote", "remove", "origin"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["branch", "-m", "topic"], { cwd: dir, stdio: "pipe" });

  const r = await check(dir);

  assert.ok(codesOf(r).includes(CAVEATS.SHALLOW_UNFETCHED), JSON.stringify(codesOf(r)));
});
