import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installWithoutStripper, FLOW_SOURCE } from "./no-stripper.mjs";

import { needsRuby } from "./ruby-available.mjs";
import { check, severityFor, formatReport, unreadReason } from "../lib/check.mjs";
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
function facts(dir, { sha, dimensions = [dim()], path = "src", fileCount = 8, pinned = null, areas = null } = {}) {
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
    corpus: { files: fileCount, frameworks: [] },
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
  const skipped = report.caveats.filter((c) => c.includes(path));
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

  assert.ok(r.caveats.some((c) => c.includes("no map on disk")));
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
    !r.caveats.some((c) => /could not be parsed|not examined/.test(c)),
    `no parse caveat: ${r.caveats.join(" | ")}`
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
    r.caveats.some((c) => c.includes("src/a.ts")),
    `expected a parse caveat naming the file: ${r.caveats.join(" | ")}`
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
    r.caveats.some((c) => /diff/.test(c)),
    `expected the unread diff to be named: ${r.caveats.join(" | ")}`
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
    r.caveats.some((c) => /schema/.test(c)),
    `expected the unreadable map to be named: ${r.caveats.join(" | ")}`
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
    r.caveats.some((c) => /crashed/.test(c)),
    `expected the crash to be named: ${r.caveats.join(" | ")}`
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
    r.caveats.some((c) => /syntax/.test(c)),
    `expected the syntax cause to be named: ${r.caveats.join(" | ")}`
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

test("uncommitted edits to a changed file are reported as unread", async (t) => {
  // The diff is committed content. Silence here would let a working-tree fix,
  // or a working-tree violation, pass unmentioned.
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

  assert.ok(r.caveats.some((c) => /uncommitted edits/.test(c)));
  assert.equal(forKey(r, "swallowed_error").length, 1, "the committed site, not the working-tree one");
});

test("work that exists only in the working tree is still reported as unread", async (t) => {
  // The state right before review is usually uncommitted. An empty diff plus a
  // dirty tree has to say so, or a silent zero reads as "conforms".
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.examined.length, 0, "nothing committed, so nothing examined");
  assert.ok(r.caveats.some((c) => /uncommitted edits/.test(c)));
});

test("a staged but uncommitted file is reported as unread", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
    git("add", "-A");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(r.caveats.some((c) => /uncommitted edits/.test(c)));
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

  const note = r.caveats.find((c) => /uncommitted edits/.test(c));
  assert.ok(note, "the rename is uncommitted work the check did not read");
  assert.match(note, /^1 file/, "one file, not two");
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
    r.caveats.filter((c) => /uncommitted edits/.test(c)).length,
    0,
    "a clean tree plus an untracked map is not pending work"
  );
});

test("a repository with no commits examines nothing and refuses nothing", async (t) => {
  const dir = repo(t, ({ write }) => {
    write("src/a.ts", swallow(3));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "none");
  assert.deepEqual(r.findings, []);
  assert.ok(r.caveats.some((c) => c.includes("nothing was examined")));
  assert.doesNotThrow(() => formatReport(r));
});

test("an unresolvable base ref degrades to added lines rather than refusing", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir, { baseRef: "no/such/ref" });

  assert.equal(r.mode, "added-lines");
  assert.ok(r.caveats.some((c) => c.includes("added")), "the caveat must be stated");
  assert.equal(forKey(r, "swallowed_error").length, 1, "the added line is still checked");
});

test("added-lines mode reports only sites on the added lines", async (t) => {
  // Without a base version to difference against, the added-line ranges are the
  // only thing separating what this change wrote from what the file held.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    write("src/a.ts", swallow(3) + swallow(1).replace("f0", "z0"));
    commit("one more");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir, { baseRef: "no/such/ref" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.mode, "added-lines");
  assert.equal(hits.length, 1, "the three sites the file already held are not the author's");
  assert.equal(hits[0].line, 4);
});

test("added lines cannot reach MUST-FIX either", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir, { baseRef: "no/such/ref" });

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
  assert.match(found[0].reason, /spec\/lib\/tasks\/lonely_spec\.rb/);
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
    r.caveats.some((c) => /resolves outside the repository/.test(c)),
    `no caveat said so: ${r.caveats.join("; ")}`
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
  assert.match(owed[0].reason, /no "spec\/models\/lonely_spec\.rb"/);
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

  const out = execFileSync(process.execPath, [join(home, "bin", "anatomiya.mjs"), "check", repo, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(out, /src\/flowed\.js/, `the Flow file was expected in the caveats:\n${out}`);
  assert.match(out, /flow-remove-types is not installed/, `nothing named the missing dependency:\n${out}`);
});

test("a claim is not silenced by a finding invented off the base's stripped tree", async (t) => {
  // The base side goes through the same retry, so on a Flow file its
  // annotations are blanked too. Asking a blind row about that tree answers
  // "no return type" for every function in it, and those answers cancel the
  // real ones on the head side: a violation the branch genuinely has is
  // reported as pre-existing and disappears.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-basestrip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(): number {\n  return ${i}\n}\n`);
  }
  // Flow-only syntax, so the base is retried and its annotations blanked.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    ["// @flow", "type O = {| n: string |}", "export function legacy(o: O) {", "  return o.n", "}"].join("\n") + "\n"
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  git("checkout", "-q", "-b", "migrate");
  // Same file, same missing return type. Only the Flow-only syntax goes, so the
  // head parses as written and the base is still stripped.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    ["// @flow", "type O = {n: string}", "export function legacy(o: O) {", "  return o.n", "}"].join("\n") + "\n"
  );
  git("commit", "-qam", "migrate");

  const out = execFileSync(process.execPath, [bin, "check", dir, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(
    out,
    /exported functions declare their return type/,
    `the head file declares no return type and nothing said so:\n${out}`
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
