import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsPosixSeparators } from "./platform.mjs";
import { FACTS_PATH, FACTS_SCHEMA } from "../lib/facts.mjs";
import {
  COLUMNS,
  areaProblems,
  byName,
  checkDirs,
  corpusRepos,
  factsProblems,
  findingPaths,
  overviewProblems,
  parseArgs,
  parseSummary,
  probePlan,
  rootsColumn,
  rosterCounts,
  selectRepos,
  summaryProblems,
  tableOf,
  timeless,
  wroteProblems,
} from "../scripts/e2e-corpus.mjs";

/** What a scan of a pinned Rails repository prints, line for line. */
const SCAN = [
  "252 files, 32 areas, 517ms, root /tmp/e2e/errbit",
  "0 of 71 claims stated, the rest print as counts",
  "layout: 7 roots, 7 folded, tests: 100 rspec under spec; roster lines: 0 areas with imports, 0 with reuse",
  "baseline 4bd14f9f, 0 files changed since origin/HEAD",
  "9 files in no area: too few per directory",
  "wrote 33 files",
  "a session already running still holds the old map; restart to pick it up",
  "",
].join("\n");

test("the summary parser reads every line the scan's own summary prints", () => {
  const s = parseSummary(SCAN);

  assert.equal(s.files, 252);
  assert.equal(s.areas, 32);
  assert.equal(s.ms, 517);
  assert.equal(s.root, "/tmp/e2e/errbit");
  assert.equal(s.stated, 0);
  assert.equal(s.claims, 71);
  assert.equal(s.roots, 7);
  assert.equal(s.folded, 7);
  assert.equal(s.baselineSha, "4bd14f9f");
  assert.equal(s.wrote, 33);
  assert.deepEqual(summaryProblems(s), []);
});

test("the summary parser reads a count of one, which the scan spells singular", () => {
  // `plural` drops the s at one on four of these lines at once, so a parser
  // written against the plural spelling reads a one-file repository as a scan
  // that printed nothing.
  const s = parseSummary(
    [
      "1 file, 1 area, 8ms, root /tmp/e2e/tiny",
      "1 of 1 claim stated, the rest print as counts",
      "layout: 1 root, 0 folded, tests: none; roster lines: 1 area with imports, 0 with reuse",
      "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. `anatomiya pin` accepts one",
      "wrote 1 file",
      "",
    ].join("\n")
  );

  assert.equal(s.files, 1);
  assert.equal(s.areas, 1);
  assert.equal(s.stated, 1);
  assert.equal(s.claims, 1);
  assert.equal(s.roots, 1);
  assert.equal(s.wrote, 1);
  assert.equal(s.baselineSha, null);
  assert.deepEqual(summaryProblems(s), []);
});

test("a pinned commit this clone cannot reach is a baseline line, not a missing one", () => {
  const s = parseSummary(
    [
      "8 files, 1 area, 8ms, root /tmp/e2e/tiny",
      "0 of 4 claims stated, the rest print as counts",
      "layout: 1 root, 0 folded, tests: none; roster lines: 0 areas with imports, 0 with reuse",
      "the pinned commit deadbeef is gone from this clone, so every claim dropped to counts",
      "wrote 2 files",
      "",
    ].join("\n")
  );

  assert.equal(s.baselineSha, null);
  assert.equal(s.baseline, "the pinned commit deadbeef is gone from this clone, so every claim dropped to counts");
  assert.deepEqual(summaryProblems(s), []);
});

test("a summary missing a line says which line, rather than reading as zero", () => {
  const problems = summaryProblems(parseSummary("wrote 3 files\n"));

  assert.deepEqual(problems, [
    "no files/areas line",
    "no claims line",
    "no layout line",
    "no baseline line",
  ]);
});

test("two runs of unchanged source differ only in the duration", () => {
  const again = SCAN.replace("517ms", "1004ms");

  assert.equal(timeless(again), timeless(SCAN));
  assert.notEqual(timeless(again.replace("252 files", "251 files")), timeless(SCAN));
});

const front = ["---", "generator: anatomiya", "---", ""];

test("an overview at the bound passes and one line past it does not", () => {
  const body = (n) => [...front, "## What lives where", ...Array.from({ length: n - 2 }, (_, i) => `- d${i}: 2 .ts`)];

  assert.deepEqual(overviewProblems(body(40).join("\n")), []);
  assert.deepEqual(overviewProblems(body(41).join("\n")), ["the overview has 41 body lines, past 40"]);
});

test("an overview with no layout section says so, and the truncation notice stands in for one", () => {
  assert.deepEqual(overviewProblems([...front, "# Repository map"].join("\n")), [
    'the overview has neither "## What lives where" nor the truncation notice',
  ]);
  assert.deepEqual(
    overviewProblems([...front, "layout: not counted, the scan was truncated"].join("\n")),
    []
  );
});

test("an area file with no paths pattern loads on every turn, which is the one thing it may not do", () => {
  const noKey = ["---", "generator: anatomiya", "---", "", "# lib  4 files"].join("\n");
  const emptyKey = ["---", "generator: anatomiya", "paths:", "---", "", "# lib  4 files"].join("\n");

  assert.deepEqual(areaProblems("a.md", noKey), ['"a.md" has no paths pattern, so it loads on every turn']);
  assert.deepEqual(areaProblems("a.md", emptyKey), ['"a.md" has no paths pattern, so it loads on every turn']);
  assert.deepEqual(areaProblems("a.md", ["---", "generator: anatomiya", "paths:", '  - "lib/*.ts"', "---", "", "# lib"].join("\n")), []);
});

test("a paths list past the bound is the documented exemption, and the body it carries is not", () => {
  // The globs are delivery: one dropped to save a line mis-delivers the whole
  // file, so the list is exempt and everything under it is not.
  const globs = Array.from({ length: 60 }, (_, i) => `  - "d${i}/*.ts"`);
  const head = ["---", "generator: anatomiya", "paths:", ...globs, "---", ""];

  assert.deepEqual(areaProblems("wide.md", [...head, "# wide  9 files"].join("\n")), []);

  const long = [...head, ...Array.from({ length: 40 }, (_, i) => `line ${i}`)];
  assert.deepEqual(areaProblems("wide.md", long.join("\n")), [
    '"wide.md" has 41 body lines, past 40',
    '"wide.md" is 105 lines with 60 globs',
  ]);
});

const facts = (over = {}) => ({
  schema: 11,
  layout: { roots: [], more: { roots: 0, files: 0 }, tests: [] },
  areas: [{ id: "a1", path: "lib", kinds: { exts: [[".mjs", 9]] }, imports: [], reused: null, dimensions: [] }],
  ...over,
});

test("a facts record is read against the schema this build writes", () => {
  const p = FACTS_PATH;
  assert.deepEqual(factsProblems(facts()), []);
  assert.deepEqual(factsProblems(facts({ schema: 10 })), [`${p} is schema 10, not ${FACTS_SCHEMA}`]);
  assert.deepEqual(factsProblems(facts({ layout: null })), [`${p} carries no layout`]);
  assert.deepEqual(factsProblems(facts({ areas: [{ id: "a1", path: "lib", kinds: null, dimensions: [] }] })), [
    `${p} area "lib" carries no kinds`,
  ]);
});

test("the roster counts the areas that answered each sibling question, not the ones that were asked", () => {
  // Null is an area with no static import surface, which was never asked. An
  // empty list is an area that was asked and imports nothing.
  assert.deepEqual(rosterCounts(facts()), { imports: 1, reused: 0 });
});

/* --- the synthetic violation --- */

const dim = (key, over = {}) => ({ key, states: "claim", directive: "x", learned: "snake_case", ...over });

const rubyArea = (dimensions) => ({
  id: "a1",
  path: "app/models",
  kinds: { exts: [[".rb", 14]] },
  imports: null,
  reused: null,
  dimensions,
});

test("the probe breaks the learned naming class the map actually stated", () => {
  const plan = probePlan({ areas: [rubyArea([dim("file_naming_case")])] });

  assert.equal(plan.dimension, "file_naming_case");
  assert.equal(plan.learned, "snake_case");
  assert.equal(plan.path, "app/models/ZzProbeFile.rb");
  assert.match(plan.body, /^#/);
});

test("the probe spells the other class in each direction the learning can go", () => {
  const at = (learned) => probePlan({ areas: [rubyArea([dim("file_naming_case", { learned })])] }).path;

  assert.equal(at("PascalCase"), "app/models/zz_probe_file.rb");
  assert.equal(at("camelCase"), "app/models/ZzProbeFile.rb");
  assert.equal(at("kebab-case"), "app/models/ZzProbeFile.rb");
});

test("a Ruby base row gets a class body and a filename that votes for no class at all", () => {
  // The filename must not answer the naming row too, or the finding this probe
  // is looking for is not the finding it reads back.
  const plan = probePlan({ areas: [rubyArea([dim("class_base", { learned: "ApplicationRecord" })])] });

  assert.equal(plan.dimension, "class_base");
  assert.equal(plan.path, "app/models/zzprobe.rb");
  assert.match(plan.body, /^class ZzProbe < NotTheBase\b/);
});

test("a JavaScript base row extends something the repository does not", () => {
  const area = { id: "a", path: "src", kinds: { exts: [[".ts", 20]] }, dimensions: [dim("extends_base", { learned: "Component" })] };
  const plan = probePlan({ areas: [area] });

  assert.equal(plan.path, "src/zzprobe.ts");
  assert.match(plan.body, /^class ZzProbe extends NotTheBase\b/);
});

test("a row the map suppressed states nothing, so there is nothing to break", () => {
  const suppressed = probePlan({ areas: [rubyArea([dim("file_naming_case", { states: null, directive: null })])] });
  const byDefault = probePlan({ areas: [rubyArea([dim("file_naming_case", { matchesDefault: true })])] });

  assert.equal(suppressed, null);
  assert.equal(byDefault, null);
});

test("an area whose dominant extension the check would not read is not where the probe goes", () => {
  // `dimensionsFor` decides what a check opens, and the probe has to land in a
  // language it opens or the file is never examined and the run reads clean.
  const yaml = { id: "a", path: "config", kinds: { exts: [[".yml", 30]] }, dimensions: [dim("file_naming_case")] };
  const both = [yaml, rubyArea([dim("file_naming_case")])];

  assert.equal(probePlan({ areas: [yaml] }), null);
  assert.equal(probePlan({ areas: both }).path, "app/models/ZzProbeFile.rb");
});

test("the report's finding paths are read off the finding lines and nothing else", () => {
  const report = [
    'base main (4bd14f9), 3 changed files, compare',
    "1 MUST-FIX, 0 FIX, 1 NIT",
    "note: 2 files were read from the working tree rather than from a commit: 1 more",
    "",
    'MUST-FIX  "app/models/ZzProbeFile.rb":1  files here are named snake_case',
    "  ZzProbeFile.rb",
    "",
    'NIT  "app/models/other.rb":12  classes here inherit ApplicationRecord',
    "  no convention stated here (ratio)",
    "",
  ].join("\n");

  assert.deepEqual(findingPaths(report), ["app/models/ZzProbeFile.rb", "app/models/other.rb"]);
});

/* --- the report --- */

test("the table prints one row per repository, in the order they ran", () => {
  const rows = [
    { repo: "errbit", files: 252, areas: 32, stated: 0, roots: 7, wrote: 33, stable: "yes", pin: "ok", clean: 0, probe: "n.a.", seconds: 4.1 },
  ];

  const out = tableOf(rows).split("\n");
  assert.equal(out[0], `| ${COLUMNS.join(" | ")} |`);
  assert.equal(out[1], `|${COLUMNS.map(() => "---").join("|")}|`);
  assert.equal(out[2], "| errbit | 252 | 32 | 0 | 7 | 33 | yes | ok | 0 | n.a. | 4.1 |");
});

test("the arguments name a corpus and a scratch directory, and refuse anything else", () => {
  assert.deepEqual(parseArgs(["/corpus", "/scratch"]), { corpus: "/corpus", scratch: "/scratch", only: null });
  assert.deepEqual(parseArgs(["/corpus", "/scratch", "--only", "a,b"]).only, "a,b");
  assert.match(parseArgs(["/corpus"]).error, /scratch directory/);
  assert.match(parseArgs([]).error, /corpus directory/);
  assert.match(parseArgs(["--wat", "/c", "/s"]).error, /unknown option/);
});

test("--only with nothing after it is an error, not a run of everything", () => {
  // It read the next argument, which was not there, and a run that was meant
  // to be one repository silently became all thirty-six.
  assert.match(parseArgs(["/corpus", "/scratch", "--only"]).error, /--only/);
});

test("a --only name the corpus does not hold is an error, not a shorter run", () => {
  // A typo ran zero repositories and printed `0 of 0 repositories passed`,
  // which is exit 0 and reads as an acceptance.
  const repos = [{ name: "errbit" }, { name: "eslint" }];

  assert.deepEqual(selectRepos(repos, null).repos, repos);
  assert.deepEqual(selectRepos(repos, "eslint").repos, [{ name: "eslint" }]);
  assert.match(selectRepos(repos, "errbti").error, /errbti/);
  assert.match(selectRepos(repos, "errbit,eslnit").error, /eslnit/);
});

test("a scratch directory that overlaps the corpus, or already holds entries, is refused", needsPosixSeparators, () => {
  assert.equal(checkDirs("/corpus", "/scratch", []), null);
  assert.match(checkDirs("/corpus", "/corpus", []), /same directory/);
  // The nested case: the clones land inside the corpus this run may not write.
  assert.match(checkDirs("/corpus", "/corpus/scratch", []), /inside the corpus/);
  // The swapped arguments: the corpus is what the removal would walk.
  assert.match(checkDirs("/scratch/corpus", "/scratch", []), /removes/);
  assert.match(checkDirs("/corpus", "/scratch", ["whitehall", "eslint"]), /2 entries/);
  assert.equal(checkDirs("/corpus", "/corpus-scratch", []), null, "a shared prefix is not a parent");
});

test("a scratch directory holding one dotfile is refused, and the message names it", () => {
  // `.DS_Store` is the entry a mac puts there by looking at the directory, and
  // a refusal that would not say which entry reads as a bug in the guard.
  const refused = checkDirs("/corpus", "/scratch", [".DS_Store"]);

  assert.match(refused, /1 entry/);
  assert.match(refused, /\.DS_Store/);
});

test("a scratch directory that reaches the corpus through a symlink is refused", (t) => {
  // Lexically the two are siblings. `resolve` normalises `..` and never follows
  // a link, which is the repository's own reason for realpathing both sides.
  const home = mkdtempSync(join(tmpdir(), "e2e-dirs-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const corpus = join(home, "corpus");
  mkdirSync(join(corpus, "inner"), { recursive: true });
  const scratch = join(home, "scratch");
  symlinkSync(join(corpus, "inner"), scratch);

  assert.match(checkDirs(corpus, scratch, []), /inside the corpus/);
  assert.match(checkDirs(scratch, corpus, []), /removes/);
});

test("a corpus path that cannot be listed is a refusal, not a stack trace", (t) => {
  // It threw ENOENT out of the driver, after the scratch directory had already
  // been made for a run that was never going to happen.
  const home = mkdtempSync(join(tmpdir(), "e2e-corpus-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "errbit", ".git"), { recursive: true });
  mkdirSync(join(home, "notes"));

  assert.deepEqual(corpusRepos(home).repos, [{ name: "errbit", source: join(home, "errbit") }]);
  assert.match(corpusRepos(join(home, "nope")).error, /nope/);
});

test("the repositories run in code-unit order, so the recorded table does not follow the locale", () => {
  // Both measurement documents list the corpus in this order, and
  // `localeCompare` orders case by whatever ICU tables the host was built with.
  assert.deepEqual(
    [{ name: "foo" }, { name: "Foo" }].sort(byName).map((r) => r.name),
    ["Foo", "foo"]
  );
});

test("the roots column is one string, whether or not the record was read", () => {
  assert.equal(rootsColumn(7, { imports: 5, reused: 4 }), "7/5/4");
  assert.equal(rootsColumn(7), "7/-/-");
});

test("the write line's count has to be the number of files in the rules directory", () => {
  assert.deepEqual(wroteProblems(2, ["anatomiya-overview.md", "anatomiya-lib.md"]), []);
  assert.match(wroteProblems(2, ["anatomiya-overview.md"])[0], /wrote 2 .* holds 1 generated files/);
});
