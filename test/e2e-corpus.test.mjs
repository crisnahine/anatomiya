import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsPosixSeparators, needsSymlinks, needsUnreadableDirs } from "./platform.mjs";
import { git, initWithCommit, scratch } from "./git-worktrees.mjs";
import { FACTS_PATH, FACTS_SCHEMA } from "../plugins/anatomiya/lib/facts.mjs";
import { scanJson, scanSummary } from "../plugins/anatomiya/lib/summary.mjs";
import { layoutSummary } from "../plugins/anatomiya/lib/render-layout.mjs";
import {
  COLUMNS,
  areaProblems,
  baseOf,
  byName,
  checkDirs,
  copyDependencies,
  dependencyProblems,
  corpusRepos,
  factsProblems,
  findingPaths,
  overviewProblems,
  parseArgs,
  probePlan,
  readJson,
  rootsColumn,
  rootsProblems,
  rootsPrinted,
  rosterCounts,
  semanticCell,
  summaryProblems,
  tableOf,
  timeless,
  writtenProblems,
  wroteProblems,
} from "../scripts/e2e-corpus.mjs";

/** What a scan of a pinned Rails repository prints, line for line. */
const SCAN = [
  "252 files, 32 areas, 517ms, root /tmp/e2e/errbit",
  "0 of 71 claims stated, the rest print as counts",
  "layout: 7 roots, 7 folded, tests: 100 rspec under spec; roster lines: 0 areas with imports, 0 with reuse",
  "baseline 4bd14f9f, 0 files changed since the pin (measured against origin/HEAD)",
  "9 files in no area: at the repository root, under the per-directory floor, or under a name no glob can spell",
  "wrote 33 files",
  "a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or /clear loads the whole map",
  "",
].join("\n");

/** The same scan as the record `--format json` prints. */
const RECORD = {
  schema: 1,
  files: 252,
  areas: 32,
  durationMs: 517,
  root: "/tmp/e2e/errbit",
  claims: { stated: 0, matchingDefault: 0, total: 71 },
  layoutLine: "layout: 7 roots, 7 folded, tests: 100 rspec under spec; roster lines: 0 areas with imports, 0 with reuse",
  baseline: { status: "ok", sha: "4bd14f9f0000000000000000000000000000abcd", drift: 0, baseRef: null, countsOnly: false },
  wrote: 33,
};

test("the harness reads the fields the scan's record answers", () => {
  const s = readJson(JSON.stringify(RECORD));

  assert.deepEqual(summaryProblems(s), []);
  assert.equal(s.files, 252);
  assert.equal(s.areas, 32);
  assert.equal(s.claims.stated, 0);
  assert.equal(s.claims.total, 71);
  assert.equal(s.baseline.sha, RECORD.baseline.sha);
  assert.equal(s.wrote, 33);
  // The table's roots column is what the scan printed, so it comes off the
  // layout line rather than from a second count of the areas.
  assert.equal(rootsPrinted(s), 7);
  assert.equal(rootsPrinted({ layoutLine: null }), null);
  // A layout line the reader cannot parse printed `null/-/-` in the table with
  // no failure, on a run nobody watches. The truncation sentence is the one
  // layout line that legitimately carries no count.
  assert.deepEqual(rootsProblems(s), []);
  assert.deepEqual(rootsProblems({ layoutLine: "layout: not counted, the scan was truncated" }), []);
  // Off the writer as well as the literal: the harness once spelled this
  // sentence for itself, and a reworded one would have failed every truncated
  // repository.
  assert.deepEqual(rootsProblems({ layoutLine: layoutSummary({ truncated: true }) }), []);
  for (const rel of ["scripts/e2e-corpus.mjs", "scripts/measure-layout.mjs"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /not counted, the scan was truncated/, `${rel} spells the writer's sentence`);
  }
  assert.deepEqual(rootsProblems({ layoutLine: "layout: seven roots, 0 folded" }), [
    'the layout line does not open with a roots count: "layout: seven roots, 0 folded"',
  ]);
  assert.equal(readJson("wrote 33 files"), null, "a run that printed lines is not a record");
});

test("the record the scan really writes answers every field the harness reads", () => {
  // The fixture above is hand-written, so a renamed field would go red in
  // `summary.test.mjs` and quietly start reporting "no claims" here, on a run
  // nobody watches. Through the writer, so what is read is what a scan prints.
  const record = readJson(
    scanJson(
      scanSummary(
        {
          root: "/repo",
          durationMs: 12,
          corpus: { files: 40, untracked: 0, truncated: false },
          areas: [{ path: "src", dimensions: [] }],
          layout: { truncated: false, roots: ["."], more: { roots: 0 }, tests: [] },
          baseline: { status: "unpinned", sha: null, countsOnly: true, baseRef: null, drift: null },
          parse: { crashed: 0, failed: 0, syntaxErrors: 0, skipped: 0, missingStripper: false },
          authors: { error: null },
        },
        { write: ["anatomiya-overview.md"], remove: [], foreign: [], unknown: [], replaced: [],
          unreadableRules: [], listed: true, uncovered: 0, orphaned: 0, unreadable: [], held: [], blind: false }
      )
    )
  );

  assert.deepEqual(summaryProblems(record), []);
  assert.equal(rootsPrinted(record), 1, "the writer's own layout line opens with the roots count");
});

test("a record missing a field says which field, rather than reading as zero", () => {
  assert.deepEqual(summaryProblems({ wrote: 3 }), [
    "no file count",
    "no area count",
    "no claims",
    "no layout line",
    "no baseline",
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

test("an overview carrying a paths key is refused, since it would load only beside those paths", () => {
  const body = ["---", "generator: anatomiya", "paths:", '  - "src/**/*.ts"', "---", "", "## What lives where"];
  assert.deepEqual(overviewProblems(body.join("\n")), ["the overview carries a paths key, so it no longer loads on every turn"]);
  const inline = ["---", "generator: anatomiya", "paths: []", "---", "", "## What lives where"];
  assert.deepEqual(overviewProblems(inline.join("\n")), ["the overview carries a paths key, so it no longer loads on every turn"]);
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
  schema: FACTS_SCHEMA,
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

test("the report's finding paths are read off its findings and nothing else", () => {
  const report = {
    counts: { "MUST-FIX": 1, FIX: 0, NIT: 1 },
    findings: [
      { severity: "MUST-FIX", path: "app/models/ZzProbeFile.rb", line: 1, claim: "files here are named snake_case" },
      { severity: "NIT", path: "app/models/other.rb", line: 12, claim: "classes here inherit ApplicationRecord" },
    ],
  };

  assert.deepEqual(findingPaths(report), ["app/models/ZzProbeFile.rb", "app/models/other.rb"]);
});

/* --- the report --- */

test("the table prints one row per repository, in the order they ran", () => {
  const rows = [
    { repo: "errbit", files: 252, areas: 32, stated: 0, roots: 7, wrote: 33, stable: "yes", pin: "ok", clean: 0, probe: "n.a.", semantic: "off no-dependencies", seconds: 4.1 },
  ];

  const out = tableOf(rows).split("\n");
  assert.equal(out[0], `| ${COLUMNS.join(" | ")} |`);
  assert.equal(out[1], `|${COLUMNS.map(() => "---").join("|")}|`);
  assert.equal(out[2], "| errbit | 252 | 32 | 0 | 7 | 33 | yes | ok | 0 | n.a. | off no-dependencies | 4.1 |");
});

test("the arguments name a corpus and a scratch directory, and refuse anything else", () => {
  assert.deepEqual(parseArgs(["/corpus", "/scratch"]), { corpus: "/corpus", scratch: "/scratch", only: null });
  assert.deepEqual(parseArgs(["/corpus", "/scratch", "--only", "a,b"]).only, "a,b");
  assert.match(parseArgs(["/corpus"]).error, /scratch directory/);
  assert.match(parseArgs([]).error, /corpus directory/);
  assert.equal(parseArgs(["--wat", "/c", "/s"]).code, "ERR_PARSE_ARGS_UNKNOWN_OPTION");
  // A third path was dropped without a word.
  assert.match(parseArgs(["/c", "/s", "/x"]).error, /two directories/);
});

test("--only with nothing after it is an error, not a run of everything", () => {
  // It read the next argument, which was not there, and a run that was meant
  // to be one repository silently became all thirty-six.
  assert.match(parseArgs(["/corpus", "/scratch", "--only"]).error, /--only/);
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

test("the probe lands inside the population a narrowed row learned over", () => {
  // A naming row learned over the files that hold JSX says nothing about one
  // that does not, so a bare comment planted in a components directory breaks
  // nothing and the probe reads back as the check going quiet. Three
  // repositories failed the run that way before the body carried an element.
  const jsxArea = (over) => ({
    id: "a2",
    path: "src/components",
    kinds: { exts: [[".tsx", 40]] },
    imports: null,
    reused: null,
    dimensions: [dim("file_naming_case", { learned: "PascalCase", ...over })],
  });

  const narrowed = probePlan({ areas: [jsxArea({ learnedKind: "jsx" })] });
  assert.equal(narrowed.path, "src/components/zz_probe_file.tsx");
  assert.match(narrowed.body, /<div \/>/, narrowed.body);

  // A row that narrowed nothing keeps the bare comment: nothing about the file
  // has to hold JSX for it to answer.
  const whole = probePlan({ areas: [jsxArea({})] });
  assert.equal(whole.path, "src/components/zz_probe_file.tsx");
  assert.doesNotMatch(whole.body, /<div \/>/);

  // Ruby cannot carry an element whatever the record says.
  const ruby = probePlan({ areas: [rubyArea([dim("file_naming_case", { learnedKind: "jsx" })])] });
  assert.match(ruby.body, /^#/);
});

test("a glob ending in a bare /** is refused, since an exclusion under it silently does nothing", () => {
  // The matcher strips a trailing /** before matching, so "app/**" excludes the
  // directory itself and nothing under it can be re-included.
  const body = ["---", "generator: anatomiya", "paths:", '  - "app/**"', "---", "", "# app"].join("\n");
  assert.deepEqual(areaProblems("a.md", body), ['"a.md" has a glob ending in a bare /**: app/**']);
});

test("what a scan wrote is held to the count it printed and to every rule the corpus run keeps", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "e2e-written-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, ".claude/rules"), { recursive: true });
  mkdirSync(join(repo, ".claude/anatomiya"), { recursive: true });
  writeFileSync(join(repo, ".claude/rules/anatomiya-overview.md"), [...front, "## What lives where"].join("\n"));
  writeFileSync(join(repo, ".claude/rules/anatomiya-area-1.md"), ["---", "generator: anatomiya", "paths:", '  - "lib/**/*.ts"', "---", "", "# lib"].join("\n"));
  writeFileSync(join(repo, FACTS_PATH), JSON.stringify(facts()));

  const good = writtenProblems(repo, 2);
  assert.deepEqual(good.problems, []);
  assert.deepEqual([...good.written.keys()], ["anatomiya-area-1.md", "anatomiya-overview.md"]);
  assert.equal(good.facts.schema, FACTS_SCHEMA);

  assert.match(writtenProblems(repo, 3).problems.join("\n"), /says it wrote 3 files/);
  writeFileSync(join(repo, FACTS_PATH), "{ half a record");
  assert.deepEqual(writtenProblems(repo, 2).problems, [`no readable ${FACTS_PATH} was written`]);
  rmSync(join(repo, FACTS_PATH));
  assert.deepEqual(writtenProblems(repo, 2).problems, [`no readable ${FACTS_PATH} was written`]);
  rmSync(join(repo, ".claude/rules/anatomiya-overview.md"));
  assert.match(writtenProblems(repo, 1).problems.join("\n"), /no anatomiya-overview\.md was written/);
});

test("the semantic column says whether the checker ran, what it answered and why not", () => {
  assert.equal(semanticCell({ ran: true, status: "ok", reason: null, typedResolutionRate: 0.9064 }), "ok 90.6%");
  assert.equal(
    semanticCell({ ran: true, status: "degraded", reason: "no-tsconfig", typedResolutionRate: 0.12 }),
    "degraded no-tsconfig 12.0%"
  );
  // No property access anywhere is ok with no rate, and a rate of 0 is a rate.
  assert.equal(semanticCell({ ran: true, status: "ok", reason: null, typedResolutionRate: null }), "ok");
  assert.equal(semanticCell({ ran: true, status: "degraded", reason: "low-resolution", typedResolutionRate: 0 }), "degraded low-resolution 0.0%");
  assert.equal(semanticCell({ ran: false, status: null, reason: "no-dependencies", typedResolutionRate: null }), "off no-dependencies");
  // A facts record from before the tier carries no semantic key at all.
  assert.equal(semanticCell(undefined), "-");
});

/** A source repository ignoring its installs, and an empty directory to copy them into. */
function installed(t) {
  const home = scratch(t, "e2e-deps-");
  const source = join(home, "source");
  const clone = join(home, "clone");
  mkdirSync(clone);
  git(clone, "init", "-q");
  const write = (rel, body = "x\n") => {
    mkdirSync(join(source, rel, ".."), { recursive: true });
    writeFileSync(join(source, rel), body);
  };
  write(".gitignore", "node_modules/\ndist/\n");
  git(source, "init", "-q");
  write("node_modules/left-pad/index.js");
  write("packages/a/node_modules/b/index.js");
  write("dist/out.js");
  return { source, clone };
}

test("a clone gets every installed node_modules the source holds, and nothing else it ignores", async (t) => {
  // A clone carries tracked files only, so without this the checker read
  // no-dependencies in all 36 repositories and the corpus never ran it.
  const { source, clone } = installed(t);

  assert.deepEqual(await copyDependencies(source, clone), { copied: ["node_modules", "packages/a/node_modules"] });
  assert.equal(readFileSync(join(clone, "node_modules/left-pad/index.js"), "utf8"), "x\n");
  assert.equal(readFileSync(join(clone, "packages/a/node_modules/b/index.js"), "utf8"), "x\n");
  // The checker refuses a linked node_modules, so the copy has to be a directory.
  assert.ok(lstatSync(join(clone, "node_modules")).isDirectory());
  assert.throws(() => lstatSync(join(clone, "dist")), { code: "ENOENT" });
  // The clone does not carry the source's info/exclude or global excludes, so
  // the copy is excluded there too, or a scan counts it as untracked source.
  assert.equal(git(clone, "status", "--porcelain", "--untracked-files=all").toString(), "");
});

test("the clone's exclude names each install literally, on a line of its own", async (t) => {
  // A template's exclude can end without a newline, and a bracket in a
  // directory name is a character class unless it is escaped.
  const { source, clone } = installed(t);
  mkdirSync(join(source, "pk/[s]/node_modules/b"), { recursive: true });
  writeFileSync(join(source, "pk/[s]/node_modules/b/index.js"), "x\n");
  writeFileSync(join(source, ".gitignore"), "node_modules/\n");
  writeFileSync(join(clone, ".git/info/exclude"), "# last line");

  assert.deepEqual((await copyDependencies(source, clone)).copied, ["node_modules", "packages/a/node_modules", "pk/[s]/node_modules"]);
  assert.equal(git(clone, "status", "--porcelain", "--untracked-files=all").toString(), "");
  assert.match(readFileSync(join(clone, ".git/info/exclude"), "utf8"), /^# last line\n/);
});

test("a link the source tracks inside its install is left as the clone has it", needsSymlinks, async (t) => {
  // cpSync refuses to copy over an existing link, and the clone already holds
  // every tracked one.
  const { source, clone } = installed(t);
  mkdirSync(join(source, "node_modules/.pnpm/c"), { recursive: true });
  symlinkSync(".pnpm/c", join(source, "node_modules/c"));
  writeFileSync(join(source, ".gitignore"), "node_modules/*\n!node_modules/c\n");
  mkdirSync(join(clone, "node_modules"));
  symlinkSync(".pnpm/c", join(clone, "node_modules/c"));

  const out = await copyDependencies(source, clone);

  assert.equal(out.error, undefined);
  assert.equal(readlinkSync(join(clone, "node_modules/c")), ".pnpm/c");
  assert.equal(readFileSync(join(clone, "node_modules/left-pad/index.js"), "utf8"), "x\n");
});

test("a copy that fails names the install it stopped on", needsUnreadableDirs, async (t) => {
  const { source, clone } = installed(t);
  const locked = join(source, "node_modules/left-pad");
  chmodSync(locked, 0o000);
  let out;
  try {
    out = await copyDependencies(source, clone);
  } finally {
    // Before the scratch directory's own cleanup, which cannot remove it locked.
    chmodSync(locked, 0o755);
  }

  assert.match(out.error, /could not copy node_modules: EACCES/);
});

test("an install ignored by its contents rather than by its name is still copied whole", async (t) => {
  // With a tracked file inside, `node_modules/*` makes git list each package
  // rather than the directory.
  const { source, clone } = installed(t);
  writeFileSync(join(source, ".gitignore"), "node_modules/*\n!node_modules/.keep\npackages/a/node_modules/*\n");
  writeFileSync(join(source, "node_modules/.keep"), "");
  git(source, "add", ".gitignore", "node_modules/.keep");

  assert.deepEqual(await copyDependencies(source, clone), { copied: ["node_modules", "packages/a/node_modules"] });
  assert.equal(readFileSync(join(clone, "node_modules/left-pad/index.js"), "utf8"), "x\n");
});

test("an installed clone whose checker still reads no-dependencies fails the run", (t) => {
  // The copy is what lets the corpus run the checker; a clone that reads
  // no-dependencies after it is the blind run coming back.
  const clone = scratch(t, "e2e-deps-finding-");
  const off = (reason) => ({ ran: false, status: null, reason, typedResolutionRate: null });
  assert.deepEqual(dependencyProblems(clone, off("no-dependencies")), [], "nothing installed");
  // A root install of tool caches only is no install to the checker either.
  mkdirSync(join(clone, "node_modules/.vite"), { recursive: true });
  assert.deepEqual(dependencyProblems(clone, off("no-dependencies")), [], "caches only");
  mkdirSync(join(clone, "node_modules/left-pad"));
  assert.deepEqual(dependencyProblems(clone, off("no-dependencies")), [
    "node_modules holds packages, and the checker still read no-dependencies",
  ]);
  assert.deepEqual(dependencyProblems(clone, off("plain-javascript")), []);
  assert.deepEqual(dependencyProblems(clone, undefined), []);
});

test("a source with nothing installed copies nothing", async (t) => {
  const { source, clone } = installed(t);
  rmSync(join(source, "node_modules"), { recursive: true });
  rmSync(join(source, "packages"), { recursive: true });

  assert.deepEqual(await copyDependencies(source, clone), { copied: [] });
});

test("a source git cannot list is an error that says why, not a clone quietly left uninstalled", async (t) => {
  // Copying nothing reads no-dependencies again, which is the blind run this exists to end.
  const home = scratch(t, "e2e-deps-nogit-");
  mkdirSync(join(home, "plain"));

  assert.match((await copyDependencies(join(home, "plain"), home)).error, /could not list .*not a git repository/i);
  // A directory that is not there fails before git runs, and has no stderr to quote.
  assert.match((await copyDependencies(join(home, "missing"), home)).error, /could not list .*ENOENT/);
});

test("links inside an install are copied as the same links", needsSymlinks, async (t) => {
  // pnpm's node_modules is relative links into node_modules/.pnpm; a link
  // rewritten to the source's absolute path would read the corpus, not the clone.
  const { source, clone } = installed(t);
  mkdirSync(join(source, "node_modules/.pnpm/c/node_modules/c"), { recursive: true });
  symlinkSync(".pnpm/c/node_modules/c", join(source, "node_modules/c"));

  await copyDependencies(source, clone);

  assert.equal(readlinkSync(join(clone, "node_modules/c")), ".pnpm/c/node_modules/c");
});

test("a detached checkout is based on its commit, and only a repository with none has no base", (t) => {
  // A frozen copy at a sha is detached, and its row once read "no commits" and
  // counted as passed without running.
  const dir = scratch(t, "anatomiya-e2e-base-");
  git(dir, "init", "-q");
  assert.equal(baseOf(dir), null);
  initWithCommit(dir);
  const branch = git(dir, "symbolic-ref", "--short", "HEAD").toString().trim();
  assert.equal(baseOf(dir), branch);
  const sha = git(dir, "rev-parse", "HEAD").toString().trim();
  git(dir, "checkout", "-q", "--detach");
  assert.equal(baseOf(dir), sha);
});
