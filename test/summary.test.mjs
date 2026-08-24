import { test } from "node:test";
import assert from "node:assert/strict";

import { pinJson, pinLines, pinSummary, scanJson, scanLines, scanSummary, SUMMARY_SCHEMA } from "../plugins/anatomiya/lib/summary.mjs";
import { buildPin, pinDelta, PIN_PATH } from "../plugins/anatomiya/lib/baseline.mjs";

const RESTART = "a session already running still holds the old map; restart to pick it up";
const UNPINNED =
  "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. `anatomiya pin` accepts one";

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
    RESTART,
  ]);
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

  assert.ok(lines.includes("3 files in no area: too few per directory"));
  assert.ok(lines.includes("1 file in a directory nothing was counted in"));
});

test("the unexamined lines are printed as the renderer worded them", () => {
  const lines = scanLines(summary({ unexamined: ["2 files crashed the parser", "1 file exceeded the size cap"] }));

  assert.ok(lines.includes("2 files crashed the parser"));
  assert.ok(lines.includes("1 file exceeded the size cap"));
});

test("unread history is reported with the reason it could not be read", () => {
  assert.ok(
    scanLines(summary({ historyError: "git log failed" })).includes(
      "history could not be read, so every claim fails the author gate: git log failed"
    )
  );
});

test("a rule file this tool did not write is named, not counted", () => {
  const lines = scanLines(summary({ rules: { ...summary().rules, foreign: ["house-style.md"] } }));

  assert.ok(lines.includes('"house-style.md" in .claude/rules/ was not written by this tool'));
});

test("a rule file listing is bounded and counts what it did not name", () => {
  const names = Array.from({ length: 22 }, (_, i) => `f${i}.md`);

  const lines = scanLines(summary({ rules: { ...summary().rules, foreign: names } }));

  assert.equal(lines.filter((l) => l.includes("was not written by this tool")).length, 21);
  assert.ok(lines.includes("and 2 more file(s) in .claude/rules/ that was not written by this tool"));
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
  assert.ok(dry.includes("2 area file(s) would be removed: their area is gone or states nothing"));
  assert.ok(dry.includes("would write 5 files"));
  assert.ok(
    real.includes('"anatomiya-overview.md" in .claude/rules/ held a name this scan writes, so it was replaced')
  );
  assert.ok(real.includes("2 area file(s) removed: their area is gone or states nothing"));
  assert.ok(real.includes("wrote 5 files"));
});

test("a dry run does not claim a session needs restarting", () => {
  // Nothing was written, so there is nothing to pick up.
  assert.ok(!scanLines(summary({ dryRun: true })).includes(RESTART));
  assert.ok(scanLines(summary()).includes(RESTART));
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
  assert.ok(!lines.includes(RESTART));
});

test("a run blind to a language names the engine behind it and what to do", () => {
  // Measured with ruby on PATH and no prism: the scan said "this is usually a
  // missing interpreter", which is true of the other cause. The interpreter was
  // there; the library was not, and nothing on screen said so.
  const lines = scanLines(summary({ blind: ["ruby"], wrote: 0, engines: { prism: { version: null } } }));

  assert.deepEqual(lines.slice(-2), [
    "read no ruby file at all, so nothing was written and the previous map was left alone",
    "prism reported no version: install Ruby 3.4 or newer, which ships prism 1.x, and put ruby on PATH",
  ]);
});

test("an engine that answered and still read nothing is not called a missing install", () => {
  // It ran, so the remedy is not an install: the files are what failed, and
  // saying otherwise sends the reader to fix something that is not broken.
  const lines = scanLines(summary({ blind: ["ruby"], wrote: 0, engines: { prism: { version: "1.5.2" } } }));

  assert.equal(lines.at(-1), "prism 1.5.2 ran and answered for none of them");
});

test("a run blind to two languages names both", () => {
  assert.ok(
    scanLines(summary({ blind: ["js", "ruby"], wrote: 0 })).includes(
      "read no js or ruby file at all, so nothing was written and the previous map was left alone"
    )
  );
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
    "baseline abcdef12, 1 file changed since main"
  );
  assert.equal(
    line({ status: "ok", sha: "abcdef1234567890", drift: 4, baseRef: null, countsOnly: false }),
    "baseline abcdef12, 4 files changed since the base"
  );
});

test("an unreachable pin with no sha at all still says which commit it looked for", () => {
  assert.equal(
    scanLines(summary({ baseline: { status: "unreachable", sha: null, drift: null, baseRef: null, countsOnly: false } }))[2],
    "the pinned commit ? is gone from this clone, so every claim dropped to counts"
  );
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
    baseline: { status: "unpinned", sha: null, drift: null, baseRef: null, countsOnly: true },
    // Absent and unchanged read the same here on purpose: the line this drives
    // is said once, when the settings actually moved. The refusal beside it is
    // the other outcome, and a scan that neither installed nor refused says
    // nothing about either.
    hookRemoved: false,
    hookRefused: null,
    truncated: false,
    orphaned: 0,
    barren: 0,
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
    "1 of 3 claims stated, 1 match the model default, the rest print as counts",
    UNPINNED,
    "2 files in no area: too few per directory",
    "1 file in a directory nothing was counted in",
    "history could not be read, so every claim fails the author gate: no history",
    '"house-style.md" in .claude/rules/ was not written by this tool',
    "1 area file(s) removed: their area is gone or states nothing",
    "wrote 2 files",
    RESTART,
  ]);
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
    "run `anatomiya scan` to measure the map against it",
    RESTART,
  ]);
});

test("a pin that would write says so and sends nobody off to scan", () => {
  const next = pinFor(["lib"]);
  const s = pinSummary({ previous: null, next, delta: pinDelta(null, next), path: PIN_PATH, dryRun: true });

  assert.deepEqual(pinLines(s).slice(-2), ["", "would write .claude/anatomiya/baseline.json"]);
  assert.ok(!pinLines(s).includes(RESTART));
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

/* --- a tier that ran badly reaches the terminal too (#72) --- */

test("a degraded semantic tier is on the summary, not only in the map", () => {
  // `--deep` costs about 26x the parse. On a measured 2,486-file React
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
  // A clean tier is the tier working, and a scan without --deep never asked.
  // `null` is the only value a run produces for either, so the comparison is
  // against the sentence rather than against another falsy spelling of it.
  const lines = scanLines(summary({ semantic: null }));

  assert.ok(!lines.some((l) => l.startsWith("type-checked claims")), lines.join("\n"));
  assert.deepEqual(lines, scanLines(summary()));
});
