import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

import { scan } from "../lib/scan.mjs";
import { renderOverview } from "../lib/render.mjs";
import { PIN_PATH, PIN_SCHEMA } from "../lib/baseline.mjs";
import { RUBY_GUARDS } from "../lib/ruby.mjs";
import { needsRuby } from "./ruby-available.mjs";

// The directory is removed through the test context, so a failing assertion
// still cleans up instead of leaving a repository in the temporary directory.
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  build(dir, { git, write, author, pin });
  return dir;

  function write(rel, body = "export const x = 1\n") {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  function author(email) {
    git("config", "user.email", email);
    git("config", "user.name", email.split("@")[0]);
  }
  /** Accept a baseline: the pinned file list per area, at the given commit. */
  function pin(areas, sha = git("rev-parse", "HEAD").trim()) {
    const body = { schema: PIN_SCHEMA, sha, areas };
    const abs = join(dir, PIN_PATH);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(body, null, 2) + "\n");
    return sha;
  }
}

/** Module-level bindings, which is what the module_state_const dimension counts. */
function moduleSource(i, kind = "const") {
  return `const first${i} = 1\n${kind} second${i} = 2\nexport { first${i}, second${i} }\n`;
}

function dimension(result, path, key) {
  const area = result.areas.find((a) => a.path === path);
  assert.ok(area, `area ${path} exists`);
  const dim = area.dimensions.find((d) => d.key === key);
  assert.ok(dim, `${path} counts ${key}`);
  return dim;
}

/** Everything a second scan of unchanged source must reproduce exactly. */
function stable(result) {
  return {
    corpus: result.corpus,
    parse: result.parse,
    suppressAll: result.suppressAll,
    baseline: result.baseline,
    areas: result.areas.map((a) => ({
      id: a.id,
      path: a.path,
      glob: a.glob,
      fileCount: a.fileCount,
      baseline: a.baseline,
      dimensions: a.dimensions.map((d) => ({
        key: d.key,
        applicability: d.applicability,
        candidates: d.candidates,
        conforming: d.conforming,
        authors: d.authors,
        ratio: d.ratio,
        directive: d.directive,
        gate: d.gate,
        files: d.files,
        exceptions: d.exceptions,
        baseline: d.baseline,
      })),
    })),
  };
}

test("a repository with no source files produces no areas", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("README.md", "# hi\n");
    write("docs/design.md", "# design\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 0);
  assert.deepEqual(result.areas, []);
  assert.deepEqual(result.parse, {
    parsed: 0,
    crashed: 0,
    skipped: 0,
    // A file that answers `ok: false` is charged here rather than counted as
    // parsed, which is what made a repository nothing could read look empty.
    failed: 0,
    missingParser: null,
  });

  // The overview still renders, because an empty repository is a real answer.
  assert.match(renderOverview(result, { uncovered: 0 }), /^## Areas \(0\)$/m);
});

test("a repository with no history produces no authors and still scans", async (t) => {
  // `git ls-files` sees the index, `git log` has nothing to read. The author
  // gate handles the gap; it is not an error that should lose the scan.
  // Twenty files, not six: `moduleSource` yields two sites each, and the
  // evidence gate refuses a perfect record under 35 sites before the author
  // gate is ever consulted. This test is about the author gate.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 20);
  assert.equal(result.areas.length, 1);
  const dims = result.areas[0].dimensions;
  assert.ok(dims.length > 0, "counts are still produced");
  for (const d of dims) {
    assert.equal(d.authors, 0);
    assert.equal(d.directive, false);
    assert.equal(d.gate, "authors", "D4: nobody's convention is not a convention");
  }
});

test("scanning a directory outside any repository fails loudly", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-scan-nogit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(() => scan(dir), /not a git repository/);
});

test("a file that kills the parser costs that one file", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    // Deep nesting is what was measured taking oxc down with an uncatchable
    // SIGSEGV from inside parseSync (B2).
    write("src/bomb.ts", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.crashed, 1, "the crash is reported, not swallowed");
  assert.equal(result.parse.parsed, 7, "every file got an answer");
  assert.equal(result.areas.length, 1, "the six healthy files still make an area");

  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.applicability, 6, "the crashed file contributes no sites");
  assert.ok(!dim.files.includes("src/bomb.ts"));
});

test("a file the parser could not read costs that one file", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    // oxc recovers instead of dying, so this file was charged as parsed and its
    // recovery walked as if it were the file. Whatever the recovery leaves is
    // not what anyone wrote, and on react/react 288 files are this shape.
    write("src/broken.ts", "export const broken = 5\nfoo(\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.failed, 1, "the syntax errors are reported, not swallowed");
  assert.equal(result.parse.parsed, 7, "every file got an answer");

  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.applicability, 6, "the unreadable file contributes no sites");
  assert.ok(!dim.files.includes("src/broken.ts"));
});

test("a path with a newline or a leading dash survives the whole scan", needsPosixPaths, async (t) => {
  // F1 and F5 end to end: the corpus is NUL-split, and no repository-controlled
  // path reaches an argument position where git or the parser reads it as an
  // option. A path lost here would silently shrink an area's population.
  const odd = ["src/we\nird.ts", "src/-dash.ts"];
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    // Only these two files carry the second author, so the author count is
    // where a path the log walk dropped would show up.
    author("second@t.test");
    write(odd[0], moduleSource(90));
    write(odd[1], moduleSource(91));
    git("add", "-A");
    git("commit", "-qm", "odd paths");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.crashed, 0);
  const dim = dimension(result, "src", "module_state_const");
  for (const rel of odd) assert.ok(dim.files.includes(rel), `${JSON.stringify(rel)} was counted`);
  assert.equal(dim.authors, 2, "git log attributed the odd paths too");
});

test("two scans of an unchanged repository agree", async (t) => {
  // This is what makes the overview's byte-stability claim reachable (A5).
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
  });

  const first = await scan(dir);
  const second = await scan(dir);

  assert.deepEqual(stable(second), stable(first));

  const overview = (r) => renderOverview(r, { uncovered: 0 });
  assert.equal(Buffer.compare(Buffer.from(overview(first)), Buffer.from(overview(second))), 0);

  // Two authors and a leaf directory, so the map has something to state. A
  // scan that agreed with itself while saying nothing would prove little.
  const stated = first.areas.flatMap((a) => a.dimensions).filter((d) => d.directive);
  assert.ok(stated.length > 0, "the fixture reaches a stated directive");
});

test("the gates read the baseline population, not the current one", async (t) => {
  // D6. Two of six files violate at the pin, so the baseline ratio is 0.83; the
  // working tree is then repaired to 1.00. Gating on today's counts would let an
  // agent clear its own bar by writing conforming sites.
  // Twenty files, five violating at the pin: the baseline ratio is 0.875 and
  // fails, while the repaired tree has the 35 sites the evidence gate wants, so
  // the control below proves the suppression is the baseline and nothing else.
  const files = Array.from({ length: 20 }, (_, i) => `src/m${i}.ts`);
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i, i < 5 ? "let" : "const"));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "src", files }]);

    author("second@t.test");
    for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("commit", "-qam", "repair");
  });

  const pinned = await scan(dir);
  const dim = dimension(pinned, "src", "module_state_const");

  assert.deepEqual(pinned.areas[0].baseline, { status: "ok", files: 20, missing: 0 });
  assert.deepEqual(
    { candidates: dim.baseline.candidates, conforming: dim.baseline.conforming },
    { candidates: 40, conforming: 35 },
    "E2: the baseline is read at the pinned commit, not from the working tree"
  );
  assert.equal(dim.candidates, 40);
  assert.equal(dim.conforming, 40, "D7: today's counts still print");
  assert.equal(dim.authors, 2);
  assert.equal(dim.directive, false);
  assert.equal(dim.gate, "ratio");

  // The control: the same tree with no pin does state the directive, so the
  // suppression above is the baseline and not some unrelated gate.
  rmSync(join(dir, PIN_PATH), { force: true });
  const unpinned = await scan(dir);
  const same = dimension(unpinned, "src", "module_state_const");
  assert.equal(same.baseline, null);
  assert.equal(same.directive, true);
});

test("an unreachable pinned commit drops the scan to counts", async (t) => {
  // E3. Squash-merge deletes the branch and the pinned sha with it. Never fall
  // back to stored counts: the pin stores none.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
    pin([{ path: "src", files: ["src/m0.ts"] }], "0".repeat(40));
  });

  const result = await scan(dir);

  assert.equal(result.baseline.status, "unreachable");
  assert.equal(result.baseline.countsOnly, true);
  assert.deepEqual(result.areas[0].baseline, { status: "unreachable", files: 0, missing: 0 });
  const dims = result.areas[0].dimensions;
  assert.ok(dims.length > 0, "counts are still produced");
  for (const d of dims) {
    assert.equal(d.directive, false);
    assert.equal(d.gate, "unreachable");
    assert.equal(d.baseline, null);
  }
});

test("an area that postdates the baseline states nothing", async (t) => {
  // E4. Greenfield directories are where agents write most, and there the
  // baseline would be the agent's own output at 100%.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`old/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "old", files: Array.from({ length: 20 }, (_, i) => `old/m${i}.ts`) }]);

    author("second@t.test");
    for (let i = 0; i < 20; i++) write(`src/n${i}.ts`, moduleSource(i));
    write("old/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("add", "-A");
    git("commit", "-qm", "greenfield");
  });

  const result = await scan(dir);

  const greenfield = result.areas.find((a) => a.path === "src");
  assert.equal(greenfield.baseline.status, "postdates-baseline");
  for (const d of greenfield.dimensions) {
    assert.equal(d.directive, false);
    assert.equal(d.gate, "postdates-baseline");
  }

  // The pinned area beside it is unaffected, so this is not a scan-wide stop.
  const old = dimension(result, "old", "module_state_const");
  assert.equal(old.baseline.candidates, 40);
  assert.equal(old.directive, true);
});

test("a greenfield area does not state its inverse either", async (t) => {
  // The same E4 stop, on the other side. Forcing `directive` false alone leaves
  // a two-sided dimension free to state its counter from a population that is
  // entirely the agent's own output, which is the identical laundering with the
  // sentence flipped.
  const arrows = (i) => `const a${i} = () => 1\nconst b${i} = () => 2\nexport { a${i}, b${i} }\n`;

  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`old/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "old", files: Array.from({ length: 20 }, (_, i) => `old/m${i}.ts`) }]);

    for (let i = 0; i < 10; i++) write(`src/n${i}.ts`, arrows(i));
    git("add", "-A");
    git("commit", "-qm", "greenfield, first hand");

    author("second@t.test");
    for (let i = 10; i < 20; i++) write(`src/n${i}.ts`, arrows(i));
    git("add", "-A");
    git("commit", "-qm", "greenfield, second hand");
  });

  const result = await scan(dir);
  const d = dimension(result, "src", "function_style");

  // Every count the counter's gates read is at its maximum, so nothing but the
  // block is holding the sentence back.
  assert.equal(d.candidates, 40);
  assert.equal(d.conforming, 0);
  assert.equal(d.counterRatio, 1);
  assert.ok(d.counterBound >= 0.9, `counter bound ${d.counterBound} clears the bar on its own`);
  assert.equal(d.authors, 2);

  assert.equal(d.states, null, "the inverse is blocked with the claim");
  assert.equal(d.directive, false);
  assert.equal(d.gate, "postdates-baseline");
  assert.equal(d.counterGate, "postdates-baseline");
});

test("a pinned file that left the area suppresses until a human re-pins", async (t) => {
  // E1. The pinned list is the population. A violating file moved out of the
  // area would otherwise lift the baseline ratio with every other guard holding.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 8; i++) write(`src/m${i}.ts`, moduleSource(i, i < 2 ? "let" : "const"));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "src", files: Array.from({ length: 8 }, (_, i) => `src/m${i}.ts`) }]);

    author("second@t.test");
    git("rm", "-q", "src/m0.ts", "src/m1.ts");
    git("commit", "-qm", "drop the violations");
  });

  const result = await scan(dir);

  assert.deepEqual(result.areas[0].baseline, { status: "population-change", files: 8, missing: 2 });
  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.candidates, 12, "the current counts print");
  assert.equal(dim.conforming, 12);
  assert.equal(dim.directive, false);
  assert.equal(dim.gate, "population-change");
  assert.equal(dim.baseline, null);
});

test("no repository size truncates the corpus", async (t) => {
  // There was a 50,000-file cap here, and hitting it did not trim the tail: it
  // set `truncated`, which suppresses every directive in the whole map. A
  // repository one file over the line got counts and no conventions at all.
  // The cap existed because the parent held every syntax tree; the trees stay
  // in their workers now, so nothing is left for a file count to protect.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 200; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
  });

  const out = await scan(dir);

  assert.equal(out.corpus.files, 200);
  assert.equal(out.corpus.truncated, false);
  assert.equal(out.suppressAll, false);
  assert.ok(
    out.areas.flatMap((a) => a.dimensions).some((d) => d.directive),
    "a corpus this size states directives rather than being suppressed wholesale"
  );
});

test("a corpus only partly answered states nothing at all", needsRuby, async (t) => {
  // F7, through its one remaining cause: the Ruby stream's per-line guard. A
  // partial corpus answered for an arbitrary subset, and a ratio counted over
  // that subset and rendered as a convention is worse than reporting counts.
  // The suppression has to reach the dimension, not just the overview's note,
  // or the area files still state directives.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 8; i++) write(`app/services/s${i}.rb`, `class S${i}\n  TZ = Time.zone.now\nend\n`);
    // The line guard reads the undrained buffer, so it needs one file whose
    // tree spans stdout chunks: 400 KB of JSON against a 64 KB pipe chunk.
    write("app/services/big.rb", Array.from({ length: 2000 }, (_, i) => `X${i} = Time.zone.now`).join("\n") + "\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("app/services/s0.rb", "class S0\n  TZ = Time.zone.now\n  OTHER = Time.zone.now\nend\n");
    git("commit", "-qam", "second");
  });

  const full = await scan(dir);
  assert.equal(full.suppressAll, false);

  const partial = await scan(dir, { rubyGuards: { ...RUBY_GUARDS, maxLineBytes: 8 } });

  assert.equal(partial.corpus.truncated, true);
  assert.equal(partial.suppressAll, true);
  for (const d of partial.areas.flatMap((a) => a.dimensions)) {
    assert.equal(d.directive, false, "no directive survives a partial corpus");
    assert.equal(d.gate, "corpus-truncated");
  }
});

test("a rake task with no spec is counted, and one with a spec conforms", needsRuby, async (t) => {
  // Issue #7: an obligation between two files, not syntax inside one. The count
  // is a set-membership test over the corpus, so nothing here needs the parser
  // to see the spec at all.
  const dir = repo(t, (d, { git, write }) => {
    write("lib/tasks/backfill.rake", "task :backfill do\n  puts 1\nend\n");
    write("lib/tasks/cleanup.rake", "task :cleanup do\n  puts 2\nend\n");
    write("lib/tasks/reindex.rake", "task :reindex do\n  puts 3\nend\n");
    write("spec/lib/tasks/backfill_spec.rb", "describe 'backfill' do\nend\n");
    git("add", "-A");
    git("commit", "-qm", "one");
  });

  const result = await scan(dir, { rubyGuards: RUBY_GUARDS });
  const area = result.areas.find((a) => a.path === "lib/tasks");

  assert.ok(area, `no lib/tasks area: ${result.areas.map((a) => a.path).join(", ")}`);
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");
  assert.ok(row, `no obligation counted: ${area.dimensions.map((dim) => dim.key).join(", ")}`);
  assert.equal(row.candidates, 3, "one site per rake task");
  assert.equal(row.conforming, 1, "only backfill ships a spec");
});

test("the baseline counts an obligation against the pinned corpus, not today's", needsRuby, async (t) => {
  // An obligation is answered by which files exist, so a branch that DELETES a
  // spec changes the answer without touching the producer. The producer's bytes
  // are unchanged, so the baseline reuses the corpus parse, and that record
  // carries hits computed over today's file list. Reusing them makes the
  // baseline agree with the branch and the violation disappears.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (const n of ["backfill", "cleanup", "reindex"]) {
      write(`lib/tasks/${n}.rake`, `task :${n} do\n  puts 1\nend\n`);
      write(`spec/lib/tasks/${n}_spec.rb`, `describe '${n}' do\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "lib/tasks", files: ["lib/tasks/backfill.rake", "lib/tasks/cleanup.rake", "lib/tasks/reindex.rake"] }]);

    author("second@t.test");
    git("rm", "-q", "spec/lib/tasks/cleanup_spec.rb");
    git("commit", "-qm", "drop a spec");
  });

  const result = await scan(dir, { rubyGuards: RUBY_GUARDS });
  const area = result.areas.find((a) => a.path === "lib/tasks");
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");

  assert.equal(row.conforming, 2, "today: cleanup lost its spec");
  assert.equal(row.candidates, 3);
  assert.ok(row.baseline, "no baseline counts at all");
  assert.equal(row.baseline.conforming, 3, "at the pin every task had a spec");
  assert.equal(row.baseline.candidates, 3);
});

test("a spec in the wrong directory is counted, so a narrow predicate is visible", needsRuby, async (t) => {
  // Measured on alphagov/whitehall: the app/models area scores 0 of 160, and 117
  // of those models have a test one directory deeper. Without this count the row
  // reads "this repository does not test its models".
  const dir = repo(t, (d, { git, write }) => {
    for (const n of ["backfill", "cleanup", "reindex"]) {
      write(`lib/tasks/${n}.rake`, `task :${n} do\n  puts 1\nend\n`);
    }
    write("spec/lib/tasks/backfill_spec.rb", "describe 'backfill' do\nend\n");
    // cleanup is specced, one directory away from where the predicate looks.
    write("spec/tasks/cleanup_spec.rb", "describe 'cleanup' do\nend\n");
    git("add", "-A");
    git("commit", "-qm", "one");
  });

  const result = await scan(dir, { rubyGuards: RUBY_GUARDS });
  const area = result.areas.find((a) => a.path === "lib/tasks");
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");

  assert.equal(row.candidates, 3);
  assert.equal(row.conforming, 1, "only backfill is specced where the predicate looks");
  assert.equal(row.companionsElsewhere, 1, "cleanup is specced, one directory away");
});
