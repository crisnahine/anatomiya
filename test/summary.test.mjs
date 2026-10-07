import { test } from "node:test";
import assert from "node:assert/strict";

import { pinJson, pinLines, pinSummary, scanJson, scanLines, scanSummary, SUMMARY_SCHEMA } from "../plugins/anatomiya/lib/summary.mjs";
import { buildPin, pinDelta, PIN_PATH } from "../plugins/anatomiya/lib/baseline.mjs";
import { truncatedHistoryLine } from "../plugins/anatomiya/lib/render.mjs";
import { layoutSummary } from "../plugins/anatomiya/lib/render-layout.mjs";
import { readFileSync } from "node:fs";

const RUNNING_SESSION = "a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or /clear loads the whole map";
const UNPINNED =
  "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. Inside Claude Code the plugin's background refresh pins one when this checkout sits on the tip of origin's default branch with nothing uncommitted, or `/anatomiya:pin` takes one by hand";

/** A summary with every count at rest, so a case names only what it changes. */
const summary = (o = {}) => ({
  files: 40,
  areas: 2,
  durationMs: 12,
  root: "/repo",
  untracked: 0,
  claims: { stated: 3, matchingDefault: 0, total: 9 },
  engines: null,
  layoutLine: null,
  baseline: { status: "unpinned", sha: null, drift: null, baseRef: null, countsOnly: true },
  truncated: false,
  orphaned: 0,
  barren: 0,
  unexamined: [],
  semantic: null,
  historyError: null,
  rules: { foreign: [], unknown: [], unreadable: [], listed: true, replaced: [] },
  removed: 0,
  wrote: 5,
  blind: [],
  dryRun: false,
  ...o,
});

test("a scan with nothing to report prints the head, the claims, the baseline and the write", () => {
  assert.deepEqual(scanLines(summary()), [
    "40 files, 2 areas, 12ms, root /repo",
    "3 of 9 claims stated, the rest print as counts",
    UNPINNED,
    "wrote 5 files",
    RUNNING_SESSION,
  ]);
});

test("the README's sample run is the lines a scan prints for that run", () => {
  // A new user compares a first run with this block, and scan.md has the agent
  // report these lines. The block kept a baseline and an orphan line in
  // wording the CLI had stopped printing, and none of the engines, layout or
  // running-session lines it had started printing, and no gate read it. The
  // run's own facts go through the printer, so a wording change fails here
  // until the README says it too. Measured: excalidraw at 438d898, first run.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("## What it prints"));
  const block = /```\r?\n([\s\S]*?)\r?\n```/.exec(section)[1].split(/\r?\n/);

  const areas = Array.from({ length: 38 }, (_, i) => ({
    imports: i < 14 ? ["x"] : [],
    reused: i < 18 ? ["y"] : [],
  }));
  const layout = {
    roots: Array.from({ length: 7 }, () => ({})),
    more: { roots: 3 },
    tests: [
      { runner: "test files", root: "packages", files: 98, under: 96 },
      { runner: "vitest", root: "packages/excalidraw", files: 43, under: 35 },
    ],
  };
  const run = summary({
    files: 693,
    areas: 38,
    durationMs: 3409,
    root: "/Users/me/code/excalidraw",
    claims: { stated: 87, matchingDefault: 48, total: 716 },
    engines: { oxc: { version: "0.149.0" } },
    layoutLine: layoutSummary(layout, areas),
    orphaned: 15,
    wrote: 39,
  });

  assert.deepEqual(block, scanLines(run));
});

test("the counts on the summary read at one", () => {
  // Measured across a thirty-five repository corpus: seven scans printed
  // "1 files hold syntax the parser rejected". Every count here reaches a
  // person, and several are 1 on a real repository.
  const lines = scanLines(
    summary({ files: 1, areas: 1, untracked: 1, claims: { stated: 1, matchingDefault: 1, total: 1 }, wrote: 1 })
  ).join("\n");

  assert.doesNotMatch(lines, /\b1 (files|areas|claims|source files)\b/, `a count of one wearing a plural:\n${lines}`);
});

test("the untracked sentence reads at one and at many", () => {
  // Fixing the count and leaving the clause after it is the same defect one
  // word along. Nothing on the line has to agree with a number twice.
  const untrackedLine = (n) => scanLines(summary({ untracked: n }))[1];

  assert.equal(
    untrackedLine(1),
    "1 source file in the working tree is untracked. The corpus is tracked files only, so nothing there was counted"
  );
  assert.equal(
    untrackedLine(3),
    "3 source files in the working tree are untracked. The corpus is tracked files only, so nothing there was counted"
  );
});

test("claims that match the model default are counted apart on the same line", () => {
  assert.equal(
    scanLines(summary({ claims: { stated: 3, matchingDefault: 6, total: 9 } }))[1],
    "3 of 9 claims stated, 6 match the model default, the rest print as counts"
  );
});

test("the engines that answered print with their versions, right after the head", () => {
  // Which build produced these counts. A map is compared against the last one
  // far more often than it is read fresh, and a parser version moving under it
  // is the first thing to rule out.
  const lines = scanLines(summary({ engines: { oxc: { version: "0.144.0" }, prism: { version: "1.5.2" } } }));

  assert.equal(lines[1], "engines: oxc 0.144.0, prism 1.5.2");
});

test("an engine that answered no version is left off the line rather than printed as null", () => {
  const one = scanLines(summary({ engines: { oxc: { version: "0.144.0" }, prism: { version: null } } }));
  assert.equal(one[1], "engines: oxc 0.144.0");

  // Nothing answered at all, so there is no line: a scan of a repository with
  // no source in it has no engine to name.
  const none = scanLines(summary({ engines: { prism: { version: null } } }));
  assert.ok(!none.some((l) => l.startsWith("engines:")), none.join("\n"));
});

test("the layout line prints where there is one", () => {
  const line = "layout: 2 roots, 0 folded, tests: none; roster lines: 0 areas with imports, 0 with reuse";

  assert.equal(scanLines(summary({ layoutLine: line }))[2], line);
});

test("a truncated corpus says every directive is suppressed", () => {
  assert.ok(
    scanLines(summary({ truncated: true })).includes(
      "only part of the corpus was read, so every directive is suppressed and only counts print"
    )
  );
});

test("the two causes of an uncovered file are named apart", () => {
  // One folded number printed beside "N files crashed the parser" invited
  // exactly the reading the overview line was fixed to stop.
  const lines = scanLines(summary({ orphaned: 3, barren: 1 }));

  // Not "too few per directory": a file at the repository root or under a
  // directory no glob can spell is in no area too, and the count does not
  // say which.
  assert.ok(
    lines.includes(
      "3 files in no area: at the repository root, under the per-directory floor, or under a name no glob can spell"
    ),
    lines.join("\n")
  );
  assert.ok(lines.includes("1 file in a directory nothing was counted in"));
});

test("the unexamined lines are printed as the renderer worded them", () => {
  const lines = scanLines(summary({ unexamined: ["2 files crashed the parser", "1 file exceeded the size cap"] }));

  assert.ok(lines.includes("2 files crashed the parser"));
  assert.ok(lines.includes("1 file exceeded the size cap"));
});

test("tracked files the working tree would not hand over are counted aloud", () => {
  // A file under a directory the scan may not enter, or one whose name is not
  // UTF-8, used to be charged to the escaped bucket, which nothing prints.
  const s = scanSummary(
    result({ corpus: { files: 40, untracked: 0, truncated: false, dropped: { escaped: 3, unreadable: 2 } } }),
    plan()
  );
  assert.equal(s.unreadFiles, 2);
  assert.ok(scanLines(s).includes("2 files could not be read, so nothing in them was counted"));
  assert.ok(scanLines(summary({ unreadFiles: 1 })).includes("1 file could not be read, so nothing in it was counted"));
  assert.ok(!scanLines(summary()).some((l) => l.includes("could not be read")));
});

test("unread history is reported with the reason it could not be read", () => {
  assert.ok(
    scanLines(summary({ historyError: "git log failed" })).includes(
      "history could not be read, so every claim fails the author gate: git log failed"
    )
  );
});

test("the terminal says the history was a window, how big it was, and what it cost", () => {
  // The overview carries the claim alone, because it owes byte-stability and
  // both numbers move. This is the surface that may print them.
  // Built by the module that owns the sentence, and asked for here through it,
  // so a reworded claim moves both surfaces or fails this.
  const shallow = { commits: 503, oldest: "2026-01-22T00:43:30Z" };
  const lines = scanLines(summary({ historyTruncated: truncatedHistoryLine(shallow, 105), authorGated: 105 }));

  assert.ok(
    lines.includes(
      "history truncated: shallow clone, 503 commits since 2026-01-22, so author counts are a floor" +
        " and 105 claims print as counts on the author gate"
    ),
    lines.join("\n")
  );

  const bare = scanLines(summary({ historyTruncated: truncatedHistoryLine({ commits: null, oldest: null }, 0) }));

  assert.ok(
    bare.includes("history truncated: shallow clone, so author counts are a floor"),
    "a clone that could not say how much it holds, whose gate cost nothing, still says it is one"
  );
});

test("the terminal builds its own truncation line from what the scan read", () => {
  // Handed in ready-made, this passes with the scan never asking: the wire from
  // `result.authors.shallow` through `scanSummary` is the half that carries it.
  const s = scanSummary(
    result({ authors: { files: 9, error: null, repo: 1, shallow: { commits: 1, oldest: "2026-01-22T00:00:00Z" } } }),
    plan()
  );

  assert.equal(
    s.historyTruncated,
    "history truncated: shallow clone, 1 commit since 2026-01-22, so author counts are a floor"
  );
  assert.equal(scanSummary(result(), plan()).historyTruncated, null, "and a whole clone says nothing");
});

test("the author-gate count is taken on the side the map prints", () => {
  // A slot shown on its counter side prints the counter's gate, so counting the
  // claim side's gate says fewer claims went to counts than the map shows.
  const flipped = {
    key: "function_style",
    claim: "module-level functions are declared with function",
    counterClaim: "module-level functions are assigned to variables",
    candidates: 40,
    conforming: 0,
    directive: false,
    states: null,
    gate: "ratio",
    counterGate: "authors",
  };
  const unflipped = { ...flipped, conforming: 40, gate: "evidence", counterGate: "authors" };
  const s = scanSummary(
    result({
      areas: [{ path: "src", dimensions: [flipped, unflipped] }],
      authors: { files: 9, error: null, repo: 1, shallow: { commits: 1, oldest: "2026-09-30T00:00:00Z" } },
    }),
    plan()
  );

  assert.equal(s.authorGated, 1);
  assert.ok(s.historyTruncated.endsWith("and 1 claim print as counts on the author gate"), s.historyTruncated);
});

test("a history that could not be read at all says that, and not that it was a window", () => {
  // The shallow probe is a `rev-parse` and answers even where the log failed,
  // so both were true at once: the terminal said the gate held claims to counts
  // and then named a gate no slot was on, because they had all failed the
  // earlier one.
  const s = scanSummary(
    result({ authors: { files: 0, error: "git log failed", repo: null, shallow: { commits: 1, oldest: null } } }),
    plan()
  );

  assert.equal(s.historyTruncated, null);
  assert.ok(scanLines(s).some((l) => l.startsWith("history could not be read")));
  assert.ok(!scanLines(s).some((l) => l.startsWith("history truncated")));
});

test("a rule file this tool did not write is named, not counted", () => {
  const lines = scanLines(summary({ rules: { ...summary().rules, foreign: ["house-style.md"] } }));

  assert.ok(lines.includes('"house-style.md" in .claude/rules/ was not written by this tool'));
});

test("a rule file listing is bounded and counts what it did not name", () => {
  const names = Array.from({ length: 22 }, (_, i) => `f${i}.md`);

  const lines = scanLines(summary({ rules: { ...summary().rules, foreign: names } }));

  assert.equal(lines.filter((l) => l.includes("was not written by this tool")).length, 20);
  // The tail counts files, so its verb is theirs: "2 more file(s) ... that was"
  // gave one line two numbers.
  assert.ok(lines.includes("and 2 more files in .claude/rules/ that were not written by this tool"), lines.join("\n"));
});

test("the tail of every rule file listing agrees with its count", () => {
  const names = (n) => Array.from({ length: n }, (_, i) => `f${i}.md`);
  const tail = (rules, n) => scanLines(summary({ rules: { ...summary().rules, ...rules } })).find((l) => l.startsWith("and "));

  assert.equal(tail({ foreign: names(21) }), "and 1 more file in .claude/rules/ that was not written by this tool");
  assert.equal(
    tail({ unknown: names(22) }),
    "and 2 more files in .claude/rules/ that carry our frontmatter but no map names them, so they were left alone"
  );
  assert.equal(
    tail({ unreadable: names(22) }),
    "and 2 more files in .claude/rules/ that could not be read, so whose they are was not established"
  );
  assert.equal(
    tail({ replaced: names(22) }),
    "and 2 more files in .claude/rules/ that held a name this scan writes, so they were replaced"
  );
});

test("one removed area file and one default-matching claim read at one", () => {
  const lines = scanLines(summary({ removed: 1, claims: { stated: 3, matchingDefault: 1, total: 9 } }));

  assert.ok(lines.includes("1 area file removed: its area is gone or states nothing"), lines.join("\n"));
  assert.ok(lines.includes("3 of 9 claims stated, 1 matches the model default, the rest print as counts"), lines.join("\n"));
  const many = scanLines(summary({ removed: 2, dryRun: true }));
  assert.ok(many.includes("2 area files would be removed: their area is gone or states nothing"), many.join("\n"));
});

test("a root and a history error reach the terminal on one line each", () => {
  // `--format json` encoded both and the lines printed them raw: a git stderr
  // of two lines added a stray line under the summary, and a root directory
  // named with a newline forged one.
  const lines = scanLines(
    summary({
      root: "/repo\nwrote 0 files",
      historyError: "fatal: bad revision 'HEAD'\nhint: something else",
    })
  );

  for (const l of lines) assert.doesNotMatch(l, /\n/, JSON.stringify(l));
  assert.equal(lines[0], "40 files, 2 areas, 12ms, root /repo wrote 0 files");
  assert.ok(
    lines.includes("history could not be read, so every claim fails the author gate: fatal: bad revision 'HEAD'"),
    lines.join("\n")
  );
});

test("the three kinds of rule file the scan leaves alone each get their own sentence", () => {
  const lines = scanLines(
    summary({
      rules: { foreign: [], unknown: ["anatomiya-old.md"], unreadable: ["locked.md"], listed: false, replaced: [] },
    })
  );

  assert.ok(
    lines.includes('"anatomiya-old.md" in .claude/rules/ carries our frontmatter but no map names it, so it was left alone')
  );
  assert.ok(lines.includes('"locked.md" in .claude/rules/ could not be read, so whose it is was not established'));
  assert.ok(lines.includes(".claude/rules/ could not be listed, so nothing in it was examined"));
});

test("a dry run does not report in the past tense", () => {
  // A dry run writes nothing, so every line about what happened to a file is
  // about something that did not happen.
  const rules = { ...summary().rules, replaced: ["anatomiya-overview.md"] };
  const dry = scanLines(summary({ dryRun: true, rules, removed: 2 }));
  const real = scanLines(summary({ rules, removed: 2 }));

  assert.ok(
    dry.includes('"anatomiya-overview.md" in .claude/rules/ holds a name this scan writes, so it would be replaced')
  );
  assert.ok(dry.includes("2 area files would be removed: their area is gone or states nothing"));
  assert.ok(dry.includes("would write 5 files"));
  assert.ok(
    real.includes('"anatomiya-overview.md" in .claude/rules/ held a name this scan writes, so it was replaced')
  );
  assert.ok(real.includes("2 area files removed: their area is gone or states nothing"));
  assert.ok(real.includes("wrote 5 files"));
});

test("a dry run does not tell a running session what it will get", () => {
  // Nothing was written, so there is nothing to pick up.
  assert.ok(!scanLines(summary({ dryRun: true })).includes(RUNNING_SESSION));
  assert.ok(scanLines(summary()).includes(RUNNING_SESSION));
});

test("a run that read no file of a language says so and stops", () => {
  // Nothing was written, and the reason is not "this repository has nothing in
  // it". Said before the count, because the count is 0 and reads as the first.
  const lines = scanLines(summary({ blind: ["ruby"], wrote: 0 }));

  assert.deepEqual(lines.slice(-2), [
    "read no ruby file at all, so nothing was written and the previous map was left alone",
    "this is usually a missing interpreter rather than a repository that changed",
  ]);
  assert.ok(!lines.some((l) => /^(?:would write|wrote) /.test(l)), "no write line at all");
  assert.ok(!lines.includes(RUNNING_SESSION));
});

test("a run blind to a language names the engine behind it and what to do", () => {
  // Measured with ruby on PATH and no prism: the scan said "this is usually a
  // missing interpreter", which is true of the other cause. The interpreter was
  // there; the library was not, and nothing on screen said so.
  const lines = scanLines(summary({ blind: ["ruby"], wrote: 0, engines: { prism: { version: null } } }));

  assert.deepEqual(lines.slice(-2), [
    "read no ruby file at all, so nothing was written and the previous map was left alone",
    "prism reported no version: install Ruby 3.4 or newer, which ships prism 1.x, or run gem install prism on the Ruby you have, and put ruby on PATH",
  ]);
});

test("an engine that answered and still read nothing is not called a missing install", () => {
  // It ran, so the remedy is not an install: the files are what failed, and
  // saying otherwise sends the reader to fix something that is not broken.
  const lines = scanLines(summary({ blind: ["ruby"], wrote: 0, engines: { prism: { version: "1.5.2" } } }));

  assert.equal(lines.at(-1), "prism 1.5.2 ran and answered for none of them");
});

test("an engine its own clock stopped before it answered is not called a missing install", () => {
  // doctor reported the parser installed; the workers stalled at startup. The
  // setup remedy fixes nothing there, and the cause was never printed.
  const lines = scanLines(
    summary({ blind: ["js"], wrote: 0, engines: { oxc: { version: null, stalled: "no ready answer in 20000ms" } } })
  );

  assert.equal(lines.at(-1), "oxc was stopped by its own clock before it answered: no ready answer in 20000ms");
  assert.ok(!lines.some((l) => l.includes("setup")), lines.join("\n"));
});

test("a run blind to two languages names both", () => {
  assert.ok(
    scanLines(summary({ blind: ["js", "ruby"], wrote: 0 })).includes(
      "read no js or ruby file at all, so nothing was written and the previous map was left alone"
    )
  );
});

test("a run that read one language and not another says which, why, and writes the rest", () => {
  // The other half of a blind run (B41): a TypeScript repository with one
  // Gemfile on a machine without Ruby. The map is written, so the write line
  // stays, and the language it read none of is named with the engine's remedy
  // beside how many area files were left as the last scan wrote them.
  const lines = scanLines(summary({ uncounted: ["ruby"], held: 2, engines: { prism: { version: null } } }));

  const at = lines.indexOf(
    "read no ruby file at all, so none was counted and 2 areas holding one were left as the last scan wrote them"
  );
  assert.ok(at !== -1, lines.join("\n"));
  assert.equal(
    lines[at + 1],
    "prism reported no version: install Ruby 3.4 or newer, which ships prism 1.x, or run gem install prism on the Ruby you have, and put ruby on PATH"
  );
  assert.ok(lines.includes("wrote 5 files"), "the rest of the map was written");
  assert.ok(!lines.some((l) => l.includes("nothing was written")), lines.join("\n"));
});

test("the baseline line says which population the gates read", () => {
  const line = (baseline) => scanLines(summary({ baseline }))[2];

  assert.equal(line(summary().baseline), UNPINNED);
  assert.equal(
    line({ status: "unreachable", sha: "abcdef1234567890", drift: null, baseRef: null, countsOnly: false }),
    "the pinned commit abcdef12 is gone from this clone, so every claim dropped to counts"
  );
  assert.equal(
    line({ status: "ok", sha: "abcdef1234567890", drift: null, baseRef: null, countsOnly: false }),
    "baseline abcdef12"
  );
  assert.equal(
    line({ status: "ok", sha: "abcdef1234567890", drift: 1, baseRef: { ref: "main" }, countsOnly: false }),
    "baseline abcdef12, 1 file changed since the pin (measured against main)"
  );
  assert.equal(
    line({ status: "ok", sha: "abcdef1234567890", drift: 4, baseRef: null, countsOnly: false }),
    "baseline abcdef12, 4 files changed since the pin (measured against the base)"
  );
});

test("an unreachable pin with no sha at all still says which commit it looked for", () => {
  assert.equal(
    scanLines(summary({ baseline: { status: "unreachable", sha: null, drift: null, baseRef: null, countsOnly: false } }))[2],
    "the pinned commit ? is gone from this clone, so every claim dropped to counts"
  );
});

test("a pin on disk that will not load is named with why, never as no pin at all", () => {
  // A pin that conflicted on a merge, or that a newer build wrote, printed
  // UNPINNED and its "`anatomiya pin` accepts one", in a repository whose pin a
  // human had committed.
  const baseline = { status: "pin-unreadable", unreadable: "it is schema 2 and this build reads 1", sha: null, countsOnly: true, baseRef: null, drift: null };

  const lines = scanLines(scanSummary(result({ baseline }), plan()));

  assert.ok(
    lines.includes(
      "the pin on disk could not be read because it is schema 2 and this build reads 1, so claims are measured against the current tree and no finding can exceed FIX"
    ),
    lines.join("\n")
  );
  assert.ok(!lines.includes(UNPINNED));
});

/* --- the facts the summary is built from --- */

const dim = (o = {}) => ({
  key: "swallowed_error",
  claim: "catch blocks use the error they caught",
  candidates: 22,
  conforming: 21,
  directive: true,
  ...o,
});

const result = (o = {}) => ({
  root: "/repo",
  durationMs: 12,
  corpus: { files: 40, untracked: 0, truncated: false },
  areas: [{ path: "src", dimensions: [dim(), dim({ matchesDefault: true }), dim({ directive: false })] }],
  layout: null,
  baseline: { status: "unpinned", sha: null, countsOnly: true, baseRef: null, drift: null },
  parse: { crashed: 0, failed: 0, syntaxErrors: 0, skipped: 0, missingStripper: false, engines: { oxc: { version: "0.144.0" } } },
  authors: { error: null },
  ...o,
});

const plan = (o = {}) => ({
  write: ["anatomiya-overview.md", "anatomiya-area-1.md"],
  remove: [],
  foreign: [],
  unknown: [],
  replaced: [],
  unreadableRules: [],
  listed: true,
  uncovered: 0,
  orphaned: 0,
  unreadable: [],
  held: [],
  blind: false,
  ...o,
});

test("the summary carries every fact the scan prints", () => {
  const s = scanSummary(result(), plan());

  assert.deepEqual(s, {
    files: 40,
    areas: 1,
    durationMs: 12,
    root: "/repo",
    untracked: 0,
    claims: { stated: 1, matchingDefault: 1, total: 3 },
    engines: { oxc: { version: "0.144.0" } },
    layoutLine: null,
    baseline: { status: "unpinned", sha: null, drift: null, baseRef: null, countsOnly: true, unreadable: null },
    // Absent and unchanged read the same here on purpose: the line this drives
    // is said once, when the settings actually moved. The refusal beside it is
    // the other outcome, and a scan that neither installed nor refused says
    // nothing about either.
    hookRemoved: false,
    hookRefused: null,
    truncated: false,
    orphaned: 0,
    barren: 0,
    unreadFiles: 0,
    unexamined: [],
    // Null on a scan that never asked for the tier and on one where it ran
    // clean. Only a tier that ran badly has anything to say.
    semantic: null,
    historyError: null,
    // Null on a whole clone, and on one this tool could not ask. A window is
    // the only thing that fills it, and the count beside it is what the author
    // gate then held to counts.
    historyTruncated: null,
    authorGated: 0,
    rules: { foreign: [], unknown: [], unreadable: [], listed: true, replaced: [] },
    removed: 0,
    wrote: 2,
    blind: [],
    uncounted: [],
    held: 0,
    dryRun: false,
  });
});

test("a slot the model states by default is counted apart from one it does not", () => {
  // Through the renderer's own partition, or the summary disagrees with the
  // map: a stated slot the model writes by default renders as a counts line.
  const s = scanSummary(result(), plan());

  assert.deepEqual(s.claims, { stated: 1, matchingDefault: 1, total: 3 });
});

test("the uncovered files split into the two the scan names apart", () => {
  const s = scanSummary(result(), plan({ uncovered: 9, orphaned: 4 }));

  assert.equal(s.orphaned, 4);
  assert.equal(s.barren, 5);
});

test("the dry run flag is the run's, not the plan's", () => {
  assert.equal(scanSummary(result(), plan()).dryRun, false);
  assert.equal(scanSummary(result(), plan(), { dryRun: true }).dryRun, true);
});

test("the parse tallies reach the summary as the sentences the overview uses", () => {
  const s = scanSummary(result({ parse: { crashed: 2, failed: 0, syntaxErrors: 1, skipped: 0 } }), plan());

  assert.deepEqual(s.unexamined, ["2 files crashed the parser", "1 file holds syntax the parser rejected"]);
});

test("the summary and its lines agree on a whole scan", () => {
  const s = scanSummary(
    result({
      corpus: { files: 41, untracked: 2, truncated: false },
      authors: { error: "no history" },
    }),
    plan({ uncovered: 3, orphaned: 2, foreign: ["house-style.md"], remove: ["anatomiya-area-9.md"] })
  );

  assert.deepEqual(scanLines(s), [
    "41 files, 1 area, 12ms, root /repo",
    "engines: oxc 0.144.0",
    "2 source files in the working tree are untracked. The corpus is tracked files only, so nothing there was counted",
    "1 of 3 claims stated, 1 matches the model default, the rest print as counts",
    UNPINNED,
    "2 files in no area: at the repository root, under the per-directory floor, or under a name no glob can spell",
    "1 file in a directory nothing was counted in",
    "history could not be read, so every claim fails the author gate: no history",
    '"house-style.md" in .claude/rules/ was not written by this tool',
    "1 area file removed: its area is gone or states nothing",
    "wrote 2 files",
    RUNNING_SESSION,
  ]);
});

/* --- the other directories the map goes to --- */

const COPILOT_DIR = ".github/instructions";

/** One other target on the plan, off and untouched, so a case names only what it changes. */
const target = (o = {}) => ({
  dir: ".cursor/rules",
  state: "off",
  reason: null,
  on: false,
  write: [],
  remove: [],
  foreign: [],
  unknown: [],
  replaced: [],
  unreadableRules: [],
  listed: true,
  unfiled: [],
  names: [],
  ...o,
});
const files = (n) => Array.from({ length: n }, (_, i) => ({ name: `anatomiya-${i}`, body: "" }));
const others = (cursor = {}, copilot = {}) => ({ targets: { cursor: target(cursor), copilot: target({ dir: COPILOT_DIR, ...copilot }) } });

// Captured from the build before any target reached the summary.
const BEFORE_LINES = [
  "40 files, 1 area, 12ms, root /repo",
  "engines: oxc 0.144.0",
  "1 of 3 claims stated, 1 matches the model default, the rest print as counts",
  UNPINNED,
  "wrote 2 files",
  RUNNING_SESSION,
];
const BEFORE_JSON =
  '{\n  "schema": 2,\n  "files": 40,\n  "areas": 1,\n  "durationMs": 12,\n  "root": "/repo",\n  "untracked": 0,\n  "claims": {\n    "stated": 1,\n    "matchingDefault": 1,\n    "total": 3\n  },\n  "engines": {\n    "oxc": {\n      "version": "0.144.0"\n    }\n  },\n  "layoutLine": null,\n  "baseline": {\n    "status": "unpinned",\n    "sha": null,\n    "drift": null,\n    "baseRef": null,\n    "countsOnly": true,\n    "unreadable": null\n  },\n  "hookRemoved": false,\n  "hookRefused": null,\n  "truncated": false,\n  "orphaned": 0,\n  "barren": 0,\n  "unreadFiles": 0,\n  "unexamined": [],\n  "semantic": null,\n  "historyError": null,\n  "historyTruncated": null,\n  "authorGated": 0,\n  "rules": {\n    "foreign": [],\n    "unknown": [],\n    "unreadable": [],\n    "listed": true,\n    "replaced": []\n  },\n  "removed": 0,\n  "wrote": 2,\n  "blind": [],\n  "uncounted": [],\n  "held": 0,\n  "dryRun": false\n}\n';

test("with no other target on and none asked for, the lines and the record are what they were", () => {
  // Off and never asked for, or unread with no file recorded there: whatever the directory holds is not this scan's to say.
  const strangers = others(
    { foreign: ["anatomiya-overview.mdc"], unknown: ["anatomiya-area-deadbeef.mdc"], unreadableRules: ["anatomiya-area-0badf00d.mdc"] },
    { state: "unknown", reason: ".github is a link", listed: false }
  );
  for (const p of [plan(), plan(others()), plan(strangers)]) {
    const s = scanSummary(result(), p);

    assert.deepEqual(scanLines(s), BEFORE_LINES);
    assert.equal(scanJson(s), BEFORE_JSON);
  }
});

test("each other target that was written says how many files, where, and for which tool", () => {
  // Cursor named on this scan, Copilot on from an earlier one: the same line.
  const s = scanSummary(result(), plan(others({ on: true, write: files(2) }, { state: "on", on: true, write: files(1) })));

  assert.deepEqual(s.targets, {
    cursor: { state: "on", dir: ".cursor/rules", wrote: 2, removed: 0, unfiled: 0, foreign: 0 },
    copilot: { state: "on", dir: COPILOT_DIR, wrote: 1, removed: 0, unfiled: 0, foreign: 0 },
  });
  assert.deepEqual(scanLines(s), [
    ...BEFORE_LINES.slice(0, -1),
    "wrote 2 files under .cursor/rules for Cursor",
    "wrote 1 file under .github/instructions for GitHub Copilot",
    RUNNING_SESSION,
  ]);
});

test("a target turned off says what was removed and that it is off", () => {
  const s = scanSummary(result(), plan(others({ state: "on", remove: ["a", "b", "c"] })));

  assert.deepEqual(s.targets, { cursor: { state: "off", dir: ".cursor/rules", wrote: 0, removed: 3, unfiled: 0, foreign: 0 } });
  assert.deepEqual(scanLines(s).slice(-3), ["removed 3 files under .cursor/rules", ".cursor/rules is off now", RUNNING_SESSION]);
});

test("a target that stays on and lost an area's file is not called off", () => {
  const s = scanSummary(result(), plan(others({}, { state: "on", on: true, write: files(2), remove: ["a"] })));

  assert.deepEqual(scanLines(s).slice(-3), [
    "wrote 2 files under .github/instructions for GitHub Copilot",
    "removed 1 file under .github/instructions",
    RUNNING_SESSION,
  ]);
});

test("a dry run says what it would do in each other directory", () => {
  const p = plan(others({ on: true, write: files(3) }, { state: "on", remove: ["a"] }));
  const lines = scanLines(scanSummary(result(), p, { dryRun: true }));

  assert.deepEqual(lines.slice(-4), [
    "would write 2 files",
    "would write 3 files under .cursor/rules for Cursor",
    "would remove 1 file under .github/instructions",
    ".github/instructions would be off",
  ]);
});

test("the areas a target has no file for are counted, and only the ones that have one elsewhere", () => {
  // An area that states nothing has no file in any directory.
  const two = result({ areas: [...result().areas, { path: "lib", dimensions: [dim()] }, { path: "docs", dimensions: [] }] });
  const many = scanSummary(two, plan(others({ state: "on", on: true, write: files(1), unfiled: ["docs", "lib", "src"] })));
  const one = scanSummary(two, plan(others({}, { state: "on", on: true, write: files(2), unfiled: ["docs", "lib"] })));

  assert.equal(many.targets.cursor.unfiled, 2);
  assert.ok(scanLines(many).includes("2 areas have no pattern Cursor can be given, so no file under .cursor/rules covers them"));
  assert.ok(
    scanLines(one).includes("1 area has no pattern GitHub Copilot can be given, so no file under .github/instructions covers it")
  );
  const none = scanSummary(two, plan(others({ state: "on", on: true, write: files(3), unfiled: ["docs"] })));
  assert.equal(scanLines(none).some((l) => l.includes("no pattern")), false);
});

test("files under this tool's names that it did not write are counted where they were left", () => {
  const one = scanSummary(result(), plan(others({ state: "on", on: true, write: files(2), foreign: ["a"] })));
  const on = scanSummary(result(), plan(others({ state: "on", on: true, write: files(2), foreign: ["a"], unknown: ["b"] })));
  // Turned off by this scan, so it is said once more on the way out.
  const off = scanSummary(result(), plan(others({ state: "on", remove: ["c"], foreign: ["a"] })));

  assert.equal(one.targets.cursor.foreign, 1);
  assert.deepEqual(scanLines(one).slice(-3), [
    "wrote 2 files under .cursor/rules for Cursor",
    ".cursor/rules holds 1 file with this tool's names that it did not write; it was left",
    RUNNING_SESSION,
  ]);
  assert.ok(scanLines(on).includes(".cursor/rules holds 2 files with this tool's names that it did not write; they were left"));
  assert.ok(scanLines(off).includes(".cursor/rules holds 1 file with this tool's names that it did not write; it was left"));
});

test("a file that could not be read in a target this scan wrote is named under that directory, as one in .claude/rules is", () => {
  const names = ["anatomiya-area-0badf00d.mdc", "anatomiya-area-deadbeef.mdc"];
  const s = scanSummary(result(), plan({ unreadableRules: ["anatomiya-area-1.md"], ...others({ state: "on", on: true, write: files(2), unreadableRules: names }) }));

  assert.deepEqual(s.targets.cursor, { state: "on", dir: ".cursor/rules", wrote: 2, removed: 0, unfiled: 0, foreign: 0, unreadable: names });
  assert.deepEqual(scanLines(s).slice(-4), [
    "wrote 2 files under .cursor/rules for Cursor",
    '"anatomiya-area-0badf00d.mdc" in .cursor/rules/ could not be read, so whose it is was not established',
    '"anatomiya-area-deadbeef.mdc" in .cursor/rules/ could not be read, so whose it is was not established',
    RUNNING_SESSION,
  ]);
  assert.ok(scanLines(s).includes('"anatomiya-area-1.md" in .claude/rules/ could not be read, so whose it is was not established'));
  const crafted = scanSummary(result(), plan(others({ state: "on", on: true, write: files(2), unreadableRules: ["anatomiya-ev\u202eli.mdc"] })));
  assert.doesNotMatch(JSON.parse(scanJson(crafted)).targets.cursor.unreadable[0], /\u202e/);
});

test("a target that was on and could not be read says why, and one never written says nothing", () => {
  const was = scanSummary(result(), plan(others({ state: "unknown", reason: ".cursor is a link", listed: false, names: ["anatomiya-overview.mdc"] })));
  const never = scanSummary(result(), plan(others({ state: "unknown", reason: ".cursor is a link", listed: false })));

  assert.deepEqual(was.targets, {
    cursor: { state: "unknown", dir: ".cursor/rules", wrote: 0, removed: 0, unfiled: 0, foreign: 0, reason: ".cursor is a link" },
  });
  assert.deepEqual(scanLines(was).slice(-3), [
    "wrote 2 files",
    ".cursor/rules could not be read (.cursor is a link), so nothing there was written or removed",
    RUNNING_SESSION,
  ]);
  assert.deepEqual(scanLines(never), BEFORE_LINES);
});

test("a run that wrote nothing leaves a target as it found it", () => {
  const s = scanSummary(result(), plan({ blind: true, unreadable: ["ruby"], ...others({ on: true }, { state: "on", on: true }) }));

  assert.equal(s.targets.cursor.state, "off");
  assert.equal(s.targets.copilot.state, "on");
  assert.equal(scanLines(s).some((l) => l.includes(".cursor/rules") || l.includes(COPILOT_DIR)), false);
});

test("the record carries each target's counts, and the schema it had", () => {
  const s = JSON.parse(scanJson(scanSummary(result(), plan(others({ on: true, write: files(2) })))));

  assert.equal(s.schema, 2);
  assert.deepEqual(s.targets, { cursor: { state: "on", dir: ".cursor/rules", wrote: 2, removed: 0, unfiled: 0, foreign: 0 } });
  assert.deepEqual(Object.keys(s).slice(-2), ["dryRun", "targets"]);
});

/* --- the pin --- */

const pinFor = (paths) =>
  buildPin(
    paths.map((p, i) => ({ id: `id${i}`, path: p, files: [{ rel: `${p}/a.js` }, { rel: `${p}/b.js` }] })),
    { sha: "abcdef1234567890abcdef1234567890abcdef12", corpus: paths.length * 2 }
  );

test("a pin prints the delta it accepted, then what it wrote", () => {
  const next = pinFor(["lib"]);
  const delta = pinDelta(null, next);

  const s = pinSummary({ previous: null, next, delta, path: PIN_PATH, dryRun: false });

  assert.deepEqual(pinLines(s), [
    "baseline pinned at abcdef12",
    "2 files enter the baseline population, 0 leave it",
    // A first pin counts the areas rather than listing them: every one of them
    // is new by arithmetic, so the list said the same thing once per directory.
    "1 area enters it",
    "",
    "wrote .claude/anatomiya/baseline.json",
    "run `/anatomiya:scan` to measure the map against it",
    RUNNING_SESSION,
  ]);
});

test("a pin that would write says so and sends nobody off to scan", () => {
  const next = pinFor(["lib"]);
  const s = pinSummary({ previous: null, next, delta: pinDelta(null, next), path: PIN_PATH, dryRun: true });

  assert.deepEqual(pinLines(s).slice(-2), ["", "would write .claude/anatomiya/baseline.json"]);
  assert.ok(!pinLines(s).includes(RUNNING_SESSION));
});

test("the pin summary carries the shas either side of the delta", () => {
  const previous = pinFor(["lib"]);
  const next = pinFor(["lib", "test"]);
  const delta = pinDelta(previous, next);

  const s = pinSummary({ previous, next, delta, path: PIN_PATH, dryRun: false });

  assert.equal(s.sha, next.sha);
  assert.equal(s.previousSha, previous.sha);
  assert.equal(s.areas, 2);
  assert.equal(s.path, PIN_PATH);
  assert.equal(s.dryRun, false);
  assert.equal(s.delta, delta);
});

test("a first pin has no previous sha", () => {
  const next = pinFor(["lib"]);

  assert.equal(pinSummary({ previous: null, next, delta: pinDelta(null, next), path: PIN_PATH, dryRun: false }).previousSha, null);
});

/* --- the records a machine reads --- */

test("a scan answers as a record, with the shape it is", () => {
  const text = scanJson(summary({ layoutLine: "layout: 2 roots, 0 folded, tests: none" }));
  const s = JSON.parse(text);

  assert.equal(s.schema, SUMMARY_SCHEMA);
  assert.equal(s.files, 40);
  assert.equal(s.areas, 2);
  assert.equal(s.claims.stated, 3);
  assert.equal(s.claims.total, 9);
  assert.equal(s.layoutLine, "layout: 2 roots, 0 folded, tests: none");
  assert.equal(s.baseline.countsOnly, true);
  assert.equal(s.wrote, 5);
  assert.ok(text.endsWith("\n"), "one record, one trailing newline");
});

test("a pin answers as a record, carrying the delta it accepted", () => {
  const next = pinFor(["lib"]);
  const delta = pinDelta(null, next);

  const s = JSON.parse(pinJson(pinSummary({ previous: null, next, delta, path: PIN_PATH, dryRun: true })));

  assert.equal(s.schema, SUMMARY_SCHEMA);
  assert.equal(s.sha, next.sha);
  assert.equal(s.previousSha, null);
  assert.equal(s.areas, 1);
  assert.equal(s.path, PIN_PATH);
  assert.equal(s.dryRun, true);
  assert.deepEqual(s.delta.areas, delta.areas);
});

// A bidi override and a zero-width joiner: `JSON.stringify` escapes neither,
// because both are category Cf rather than Cc.
const CF = /[​-‏‪-‮]/;

test("the scan record neutralises every value the repository named", () => {
  // The lines encode as they render, so a writer that is not the renderer is
  // the one surface a crafted filename reaches whole.
  const s = JSON.parse(
    scanJson(
      summary({
        root: "/repo/ev‮li",
        historyError: "fatal: bad object ‍head",
        rules: {
          foreign: ["ho‮use.md"],
          unknown: ["un‍known.md"],
          unreadable: ["unre‮adable.md"],
          replaced: ["repl‍aced.md"],
          listed: true,
        },
      })
    )
  );

  const named = [
    s.root,
    s.historyError,
    ...s.rules.foreign,
    ...s.rules.unknown,
    ...s.rules.unreadable,
    ...s.rules.replaced,
  ];
  for (const value of named) assert.doesNotMatch(value, CF, value);
});

test("an ASCII scan record comes back from the writer unchanged", () => {
  const s = summary({
    historyError: "fatal: not a git repository",
    rules: { foreign: ["house.md"], unknown: [], unreadable: [], listed: true, replaced: [] },
  });

  const out = JSON.parse(scanJson(s));

  assert.equal(out.root, s.root);
  assert.equal(out.historyError, s.historyError);
  assert.deepEqual(out.rules, s.rules);
});

test("the scan record carries the root and rule files whole, as the text line and check json do", () => {
  // Paths a reader opens: a cap or the mixed-script placeholder leaves nothing to `cd` to.
  const long = `/work/${"a".repeat(60)}/${"b".repeat(60)}/r`;
  const mixed = "/work/раyments/r";
  for (const root of [long, mixed]) {
    const rules = { foreign: [`${"c".repeat(130)}.md`], unknown: ["раyments.md"], unreadable: [], listed: true, replaced: [] };
    const s = summary({ root, rules });

    const out = JSON.parse(scanJson(s));

    assert.equal(out.root, root);
    assert.ok(scanLines(s)[0].endsWith(`root ${out.root}`), "the text line and the record name one root");
    assert.deepEqual(out.rules, rules);
  }
});

test("the pin record carries a long file path whole", () => {
  const dir = `lib/${"d".repeat(130)}`;
  const next = pinFor([dir]);

  const s = JSON.parse(pinJson(pinSummary({ previous: null, next, delta: pinDelta(null, next), path: PIN_PATH, dryRun: true })));

  assert.deepEqual(s.delta.areas[0].added, [`${dir}/a.js`, `${dir}/b.js`]);
});

test("the pin record neutralises the paths only it prints", () => {
  // The added list is printed by this writer and by nothing else, so it has no
  // encoded counterpart anywhere: the line a human reads counts them.
  const next = pinFor(["li‮b"]);
  const delta = pinDelta(null, next);

  const s = JSON.parse(pinJson(pinSummary({ previous: null, next, delta, path: PIN_PATH, dryRun: true })));

  for (const a of s.delta.areas) {
    for (const value of [a.path, ...a.added, ...a.removed]) assert.doesNotMatch(value, CF, value);
  }
});

test("the pin record neutralises the paths a move names as well", () => {
  // A file that only changed area is carried in lists of its own, and those
  // come out of the same repository-controlled pin as the added list.
  const sha = "abcdef1234567890abcdef1234567890abcdef12";
  const previous = buildPin([{ id: "a", path: "lib", files: [{ rel: "lib/a.js" }, { rel: "lib/su‮b/b.js" }] }], { sha });
  const next = buildPin([
    { id: "a", path: "lib", files: [{ rel: "lib/a.js" }] },
    { id: "b", path: "lib/su‮b", files: [{ rel: "lib/su‮b/b.js" }] },
  ], { sha });
  const delta = pinDelta(previous, next);

  const s = JSON.parse(pinJson(pinSummary({ previous, next, delta, path: PIN_PATH, dryRun: true })));

  assert.equal(s.delta.movedFiles, 1);
  const moved = s.delta.areas.flatMap((a) => [...a.movedIn, ...a.movedOut]);
  assert.equal(moved.length, 2, "the file is named on both sides of the move");
  for (const value of moved) assert.doesNotMatch(value, CF, value);
});

/* --- a tier that ran badly reaches the terminal too (#72) --- */

test("a degraded semantic tier is on the summary, not only in the map", () => {
  // The checker costs a few times a plain scan. On a measured 2,486-file React
  // repository it added 110 slots, every one of them read zero, and the summary
  // said nothing: the reader paid 24 seconds instead of 12 and had no way to
  // know the tier answered nothing. The map, `facts.json` and every area file
  // all said so; the terminal the caller was watching was the one surface that
  // did not.
  const lines = scanLines(
    summary({ semantic: "type-checked claims are counts only: 15% of type lookups resolved (low-resolution)" })
  );

  assert.ok(
    lines.includes("type-checked claims are counts only: 15% of type lookups resolved (low-resolution)"),
    lines.join("\n")
  );
});

test("a tier that ran cleanly, and one that never ran, say nothing", () => {
  // A clean tier is the tier working, and a scan that left it off never asked.
  // `null` is the only value a run produces for either, so the comparison is
  // against the sentence rather than against another falsy spelling of it.
  const lines = scanLines(summary({ semantic: null }));

  assert.ok(!lines.some((l) => l.startsWith("type-checked claims")), lines.join("\n"));
  assert.deepEqual(lines, scanLines(summary()));
});
