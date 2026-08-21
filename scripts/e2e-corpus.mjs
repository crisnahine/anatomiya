#!/usr/bin/env node
/**
 * From-zero acceptance: the real CLI, on a fresh clone, from no map at all.
 *
 * Every child of the corpus directory that is a git repository is cloned into a
 * scratch directory, scanned, scanned again, pinned, scanned a third time,
 * checked on a clean tree, and then checked again against a branch carrying one
 * file built to break a row the map actually stated. The clone is removed
 * afterwards, always, so the scratch directory ends empty.
 *
 * It runs the shipped `bin/anatomiya.mjs` in its own process rather than
 * importing `scan`, which is what separates this from `measure-layout.mjs`: the
 * argument parsing, the exit codes, the records the commands print and the files
 * that land on disk are the surface a user meets, and none of them are exercised
 * by an in-process call.
 *
 * Read-only over the corpus. A repository is cloned with `--local`, which
 * hardlinks the object store, and nothing is ever written back into it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isSource } from "../lib/corpus.mjs";
import { language } from "../lib/langs.mjs";
import { CLASSES } from "../lib/dimensions-naming.mjs";
import { rowByKey } from "../lib/registry.mjs";
import { FACTS_PATH, FACTS_SCHEMA, statedSide } from "../lib/facts.mjs";
import { PIN_PATH } from "../lib/baseline.mjs";
import { MAX_LINES } from "../lib/render.mjs";
import { isGeneratedName, OVERVIEW_FILE, RULES_DIR } from "../lib/rules.mjs";
import { scanLines } from "../lib/summary.mjs";
import { formatReport } from "../lib/check-report.mjs";

const LAYOUT_HEADING = "## What lives where";
const TRUNCATED = "layout: not counted, the scan was truncated";

// --- the records the commands print -----------------------------------------

/**
 * What a command answered, off `--format json`, or null when it printed
 * something else.
 *
 * Read as a record rather than scraped off the lines: every count on those
 * lines is spelled by `plural`, so each drops its `s` at one, and a parser
 * written against the plural spelling read a one-file repository as a run that
 * printed nothing at all.
 */
export function readJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Which of the facts a scan always answers this run did not. */
export function summaryProblems(s) {
  const problems = [];
  if (typeof s.files !== "number") problems.push("no file count");
  if (typeof s.areas !== "number") problems.push("no area count");
  if (typeof s.claims?.stated !== "number") problems.push("no claims");
  // Null is a scan that counted no layout at all, which the lines say by
  // printing nothing, and this harness has always read that as a failure.
  if (!s.layoutLine) problems.push("no layout line");
  if (!s.baseline) problems.push("no baseline");
  if (typeof s.wrote !== "number") problems.push("no wrote count");
  return problems;
}

// The roots column is what the scan printed, so it is read off the layout line
// the scan wrote rather than recounted from the areas.
export const rootsPrinted = (s) => {
  const m = /^layout: (\d+) roots?/.exec(s.layoutLine ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * The summary with the one number that legitimately moves taken out, so two
 * runs over unchanged source can be compared whole.
 */
export function timeless(stdout) {
  return stdout.replace(/, \d+ms, root /, ", <ms>, root ");
}

// The lines a scan prints, rendered from the record it printed. Through the
// module that owns the wording, so the acceptance run and the terminal never
// come to two spellings of one summary.
const printed = (s) => scanLines(s).join("\n");

// --- what landed on disk ----------------------------------------------------

function frontmatterEnd(lines) {
  if (lines[0] !== "---") return 0;
  const close = lines.indexOf("---", 1);
  return close === -1 ? 0 : close + 1;
}

/**
 * The overview loads on every turn, so the bound is measured over the body a
 * reader reads rather than over the file.
 */
export function overviewProblems(text) {
  const problems = [];
  const lines = text.trimEnd().split("\n");
  const body = lines.length - frontmatterEnd(lines);
  if (body > MAX_LINES) problems.push(`the overview has ${body} body lines, past ${MAX_LINES}`);
  if (!lines.includes(LAYOUT_HEADING) && !lines.includes(TRUNCATED)) {
    problems.push(`the overview has neither "${LAYOUT_HEADING}" nor the truncation notice`);
  }
  return problems;
}

/**
 * An area file is delivered by its `paths` list, so a missing one is not a
 * formatting slip: the file loads on every turn, which is the overview's job.
 *
 * The list itself is exempt from the bound, because a glob dropped to save a
 * line mis-delivers the whole file. Nothing under it is.
 */
export function areaProblems(name, text) {
  const problems = [];
  const lines = text.trimEnd().split("\n");
  const end = frontmatterEnd(lines);
  const globs = lines.filter((l) => /^ {2}- /.test(l)).length;
  const at = lines.slice(0, end).indexOf("paths:");
  if (at === -1 || globs === 0) problems.push(`${JSON.stringify(name)} has no paths pattern, so it loads on every turn`);

  const body = lines.length - end;
  if (body > MAX_LINES) problems.push(`${JSON.stringify(name)} has ${body} body lines, past ${MAX_LINES}`);
  const whole = lines.length - Math.max(0, globs - 1);
  if (whole > MAX_LINES) problems.push(`${JSON.stringify(name)} is ${lines.length} lines with ${globs} globs`);
  return problems;
}

/** The record the check reads, against the shape this build writes. */
export function factsProblems(facts) {
  const problems = [];
  if (facts.schema !== FACTS_SCHEMA) problems.push(`${FACTS_PATH} is schema ${facts.schema}, not ${FACTS_SCHEMA}`);
  if (!facts.layout) problems.push(`${FACTS_PATH} carries no layout`);
  for (const a of facts.areas) {
    if (!a.kinds) problems.push(`${FACTS_PATH} area ${JSON.stringify(a.path)} carries no kinds`);
  }
  return problems;
}

/**
 * How many areas answered each sibling question. Null is an area with no static
 * import surface, which was never asked; an empty list is one that was asked and
 * imports nothing, so the two do not fold together.
 */
export function rosterCounts(facts) {
  return {
    imports: facts.areas.filter((a) => a.imports !== null && a.imports !== undefined).length,
    reused: facts.areas.filter((a) => a.reused !== null && a.reused !== undefined).length,
  };
}

// The roots column, in the one shape a reader compares down the table: root
// lines printed, then the two roster answers. A run that never got as far as
// the record says so with a dash rather than with a shorter column.
export const rootsColumn = (roots, roster = null) =>
  `${roots}/${roster ? roster.imports : "-"}/${roster ? roster.reused : "-"}`;

/** The write line's own count, against the generated names in the directory it wrote to. */
export function wroteProblems(wrote, names) {
  if (wrote === names.length) return [];
  return [
    `the scan says it wrote ${wrote} files and ${RULES_DIR}/ holds ${names.length} generated files: ${names.join(", ")}`,
  ];
}

// --- the synthetic violation ------------------------------------------------

// In the order they are tried. The first is stated far more often than the two
// base rows, and it needs no parse to answer, so it is the probe with the
// fewest ways to go quiet.
const PROBE_ROWS = ["file_naming_case", "extends_base", "class_base"];

// Deliberately the opposite spelling rather than the next class in the list: a
// PascalCase name in a snake_case Ruby directory is the shape a reviewer would
// actually catch, and a snake_case one is that shape's mirror.
const OTHER_CLASS = { snake_case: "PascalCase", "kebab-case": "PascalCase", camelCase: "PascalCase", PascalCase: "snake_case" };
const STEM = { camelCase: "zzProbeFile", PascalCase: "ZzProbeFile", "kebab-case": "zz-probe-file", snake_case: "zz_probe_file" };

const langsOf = (key) => rowByKey(key)?.langs ?? [];

/** The area's own commonest extension that the row speaks and a check opens. */
function extFor(area, key) {
  const langs = langsOf(key);
  const exts = (area.kinds && area.kinds.exts) || [];
  return exts.map(([ext]) => ext).find((ext) => isSource(`f${ext}`) && langs.includes(language(`f${ext}`))) ?? null;
}

/**
 * One file that breaks a row the map stated, or null when nothing stated one.
 *
 * The two base rows get a filename that votes for no naming class at all, or
 * the finding this probe reads back would be the naming row's rather than the
 * one it set out to break.
 *
 * A row that narrowed its population needs a probe inside it. A naming row
 * learned over the files that hold JSX says nothing about one that does not, so
 * a bare comment planted in a components directory breaks nothing and the probe
 * reads back as the check going quiet. The body carries an element there.
 */
export function probePlan(facts) {
  for (const area of facts.areas) {
    for (const key of PROBE_ROWS) {
      const d = (area.dimensions || []).find((x) => x.key === key);
      if (!d || statedSide(d).states === null || d.matchesDefault === true) continue;
      if (typeof d.learned !== "string" || d.learned === "") continue;
      if (key === "file_naming_case" && !CLASSES.includes(d.learned)) continue;
      const ext = extFor(area, key);
      if (ext === null) continue;

      const ruby = language(`f${ext}`) === "ruby";
      const stem = key === "file_naming_case" ? STEM[OTHER_CLASS[d.learned]] : "zzprobe";
      const jsxKind = d.learnedKind === "jsx" && !ruby;
      const body =
        key === "file_naming_case"
          ? jsxKind
            ? "// e2e probe\nexport const ZzProbeElement = () => <div />\n"
            : `${ruby ? "#" : "//"} e2e probe\n`
          : ruby
            ? "class ZzProbe < NotTheBase\nend\n"
            : "class ZzProbe extends NotTheBase {}\n";
      return { area: area.path, dimension: key, learned: d.learned, path: `${area.path}/${stem}${ext}`, body };
    }
  }
  return null;
}

/** The paths the report's findings name, and nothing off the rest of it. */
export function findingPaths(report) {
  return report.findings.map((f) => f.path);
}

// --- the report -------------------------------------------------------------

export const COLUMNS = [
  "repo",
  "files",
  "areas",
  "stated",
  "roots",
  "wrote",
  "stable",
  "pin",
  "clean",
  "probe",
  "seconds",
];

export function tableOf(rows, columns = COLUMNS) {
  const out = [`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${columns.map((c) => r[c]).join(" | ")} |`);
  return out.join("\n");
}

const USAGE = `usage: node scripts/e2e-corpus.mjs <corpusDir> <scratchDir> [options]

  <corpusDir>        a directory whose children are the repositories to run
  <scratchDir>       where each clone goes; every clone is removed again
  --only <a,b>       run these repositories rather than every child
`;

export function parseArgs(argv) {
  const opts = { corpus: null, scratch: null, only: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      // Last on the line it read nothing and ran all thirty-six, which is an
      // hour of clones for a run that asked for one repository.
      if (i + 1 >= argv.length) return { error: "--only needs a comma-separated list of repository names" };
      opts.only = argv[++i];
      continue;
    }
    if (arg.startsWith("-")) return { error: `unknown option: ${arg}` };
    positional.push(arg);
  }
  if (positional.length === 0) return { error: "the corpus directory is required" };
  if (positional.length === 1) return { error: "the scratch directory is required" };
  return { ...opts, corpus: positional[0], scratch: positional[1] };
}

/**
 * The repositories the run covers, or the names `--only` asked for that the
 * corpus does not hold.
 *
 * A typo used to select nothing and print `0 of 0 repositories passed`, which
 * is exit 0 and reads as an acceptance of the corpus it never ran.
 */
export function selectRepos(repos, only) {
  if (only === null) return { repos };
  const wanted = only.split(",");
  const missing = wanted.filter((name) => !repos.some((r) => r.name === name));
  if (missing.length) return { error: `--only ${only}: the corpus holds no repository named ${missing.join(", ")}` };
  return { repos: repos.filter((r) => wanted.includes(r.name)) };
}

// The order both measurement documents record the corpus in. Code units, not
// locale: ICU orders case by whatever tables the host was built with.
export const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Every child of the corpus directory that is a git repository, or why the path
 * is not a corpus.
 *
 * A mistyped corpus threw ENOENT out of the driver as a stack trace, and by
 * then the scratch directory had been made for a run that never started.
 */
export function corpusRepos(corpusDir) {
  let entries;
  try {
    entries = readdirSync(corpusDir, { withFileTypes: true });
  } catch (err) {
    return { error: `the corpus directory ${corpusDir} cannot be listed: ${err.code ?? err.message}` };
  }
  return {
    repos: entries
      .filter((e) => e.isDirectory() && existsSync(join(corpusDir, e.name, ".git")))
      .map((e) => ({ name: e.name, source: join(corpusDir, e.name) }))
      .sort(byName),
  };
}

const inside = (path, dir) => path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

// The three shapes one pair of directories is refused for.
function overlap(corpus, scratch) {
  if (corpus === scratch) {
    return `the corpus and the scratch directory are the same directory, ${corpus}, so every clone would be written into the corpus`;
  }
  if (inside(scratch, corpus)) {
    return `the scratch directory ${scratch} is inside the corpus ${corpus}, so every clone would be written into the corpus`;
  }
  if (inside(corpus, scratch)) {
    return `the corpus ${corpus} is inside the scratch directory ${scratch}, and this run removes what it finds under the scratch directory by name`;
  }
  return null;
}

/**
 * The path as the filesystem holds it. A directory this run has not made yet
 * resolves through its parent, which is the link that would move it.
 */
function real(path) {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(path);
    return up === path ? path : join(real(up), basename(path));
  }
}

/**
 * Whether these two directories are safe to run between, on resolved paths.
 *
 * The corpus is read-only and the scratch directory is a place this run makes
 * and removes clones in, so one inside the other is either a write into the
 * corpus or a removal of it. Swapped arguments are the ordinary way to reach
 * both. Entries already there are the third refusal: a clone is removed by name
 * before it is made, so a directory holding somebody else's work is a directory
 * this run would delete from.
 *
 * Asked twice, the shape the repository already confines paths with: lexically
 * because it costs nothing, then on both realpaths, since `resolve` normalises
 * `..` but never follows a symlink and every write here does.
 */
export function checkDirs(corpus, scratch, entries) {
  for (const [c, s] of [[corpus, scratch], [real(corpus), real(scratch)]]) {
    const refused = overlap(c, s);
    if (refused) return refused;
  }
  if (entries.length) {
    return `the scratch directory ${scratch} already holds ${entries.length} ${entries.length === 1 ? "entry" : "entries"} (${entries.join(", ")}), and a clone is removed by name before it is made`;
  }
  return null;
}

// --- the driver -------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "anatomiya.mjs");
const MAX_BUFFER = 256 * 1024 * 1024;

const git = (args, cwd) => run("git", args, cwd);
// Run from the scratch directory, not from this tool's own tree: a command
// that reads the working directory would otherwise be answered by the
// repository under test's own source.
const anatomiya = (args, cwd) => run(process.execPath, [BIN, ...args], cwd);

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER });
  return { status: r.status, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
}

/**
 * Remove a clone, or say why it is still there.
 *
 * `git commit` starts a detached `gc --auto`, and on a repository with enough
 * history it is still writing into `.git/` while the walk is unlinking: the
 * first run died on ENOTEMPTY over whitehall's 39,480 commits. The clone turns
 * the collector off, and the retries cover whatever else holds a file open.
 */
function removeTree(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return null;
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

function ruleFiles(clone) {
  const dir = join(clone, RULES_DIR);
  if (!existsSync(dir)) return new Map();
  const names = readdirSync(dir).filter(isGeneratedName).sort();
  return new Map(names.map((n) => [n, readFileSync(join(dir, n), "utf8")]));
}

function sameFiles(a, b) {
  if (a.size !== b.size) return false;
  for (const [name, body] of a) if (b.get(name) !== body) return false;
  return true;
}

/** The whole flow for one repository, on a clone that is removed either way. */
async function runRepo(name, source, scratchDir) {
  const clone = join(scratchDir, name);
  const started = Date.now();
  const problems = [];
  const row = { repo: name, files: "-", areas: "-", stated: "-", roots: "-", wrote: "-", stable: "-", pin: "-", clean: "-", probe: "-", seconds: "-" };
  const fail = (what) => problems.push(`${name}: ${what}`);

  try {
    removeTree(clone);
    const cloned = git(["clone", "--local", "--quiet", source, clone]);
    if (cloned.status !== 0) {
      fail(`clone failed: ${cloned.err}`);
      return { row, problems };
    }
    git(["config", "gc.auto", "0"], clone);
    git(["config", "maintenance.auto", "false"], clone);
    const branch = git(["symbolic-ref", "--short", "HEAD"], clone);
    if (branch.status !== 0 || git(["rev-parse", "HEAD"], clone).status !== 0) {
      row.probe = "no commits";
      return { row, problems };
    }
    const base = branch.out.trim();

    /* 1 and 2: the first scan, and what it wrote. */
    const first = anatomiya(["scan", clone, "--format", "json"], scratchDir);
    if (first.status !== 0) {
      fail(`scan exited ${first.status}: ${first.err.split("\n")[0]}`);
      return { row, problems };
    }
    const s1 = readJson(first.out);
    if (s1 === null) {
      fail(`the scan printed no record: ${first.out.split("\n")[0]}`);
      return { row, problems };
    }
    for (const p of summaryProblems(s1)) fail(p);
    Object.assign(row, {
      files: s1.files,
      areas: s1.areas,
      stated: `${s1.claims?.stated}/${s1.claims?.total}`,
      roots: rootsColumn(rootsPrinted(s1)),
      wrote: s1.wrote,
    });

    const overview = join(clone, RULES_DIR, OVERVIEW_FILE);
    if (!existsSync(overview)) fail(`no ${OVERVIEW_FILE} was written`);
    else for (const p of overviewProblems(readFileSync(overview, "utf8"))) fail(p);
    const written = ruleFiles(clone);
    for (const [n, body] of written) if (n !== OVERVIEW_FILE) for (const p of areaProblems(n, body)) fail(p);
    for (const p of wroteProblems(s1.wrote, [...written.keys()])) fail(p);

    const factsFile = join(clone, FACTS_PATH);
    if (!existsSync(factsFile)) fail(`no ${FACTS_PATH} was written`);
    else {
      const facts = JSON.parse(readFileSync(factsFile, "utf8"));
      for (const p of factsProblems(facts)) fail(p);
      row.roots = rootsColumn(rootsPrinted(s1), rosterCounts(facts));
    }

    /* 3: the same source twice, byte for byte, or the map is not worth a
       cached read. */
    const second = anatomiya(["scan", clone, "--format", "json"], scratchDir);
    if (second.status !== 0) fail(`the second scan exited ${second.status}: ${second.err.split("\n")[0]}`);
    row.stable = sameFiles(written, ruleFiles(clone)) ? "yes" : "no";
    if (row.stable === "no") fail("the second scan wrote a different map over unchanged source");
    const s2 = readJson(second.out);
    if (s2 === null) fail("the second scan printed no record");
    else if (timeless(printed(s2)) !== timeless(printed(s1))) {
      fail("the second scan's summary differs from the first beyond its timing");
      row.stable = "no";
    }

    /* 4: pin, then scan against it. */
    const pinned = anatomiya(["pin", clone], scratchDir);
    row.pin = pinned.status === 0 && existsSync(join(clone, PIN_PATH)) ? "ok" : "no";
    if (row.pin === "no") fail(`pin exited ${pinned.status}: ${pinned.err.split("\n")[0] || `no ${PIN_PATH}`}`);
    const sha = git(["rev-parse", "HEAD"], clone).out.trim();

    const third = anatomiya(["scan", clone, "--format", "json"], scratchDir);
    if (third.status !== 0) fail(`the scan after the pin exited ${third.status}: ${third.err.split("\n")[0]}`);
    const s3 = readJson(third.out);
    if (s3 === null) fail("the scan after the pin printed no record");
    else if (s3.baseline?.countsOnly || s3.baseline?.sha !== sha) {
      fail(`the baseline reads ${s3.baseline?.countsOnly ? "counts only" : s3.baseline?.sha}, not the pinned ${sha}`);
    }
    const summary = s3 ? printed(s3) : "";
    if (existsSync(overview)) for (const p of overviewProblems(readFileSync(overview, "utf8"))) fail(p);

    /* 5: the clean tree. Findings never set the exit code. */
    const clean = anatomiya(["check", clone, "--format", "json"], scratchDir);
    if (clean.status !== 0) fail(`check exited ${clean.status} on a clean tree: ${clean.err.split("\n")[0]}`);
    const cleanReport = readJson(clean.out);
    if (cleanReport === null) fail("the check printed no record on the clean tree");
    else row.clean = findingPaths(cleanReport).length;
    // The head line the check prints, rendered from the record it printed: the
    // writer owns that wording. The record has already been through the
    // encoder, which passes an encoded value through unchanged.
    const head = cleanReport ? formatReport(cleanReport).split("\n")[0] : null;

    /* 6: one file built to break a row the map stated. */
    const plan = probePlan(JSON.parse(readFileSync(factsFile, "utf8")));
    const probePath = plan ? plan.path : "e2e-probe.md";
    if (git(["checkout", "-q", "-b", "e2e/probe"], clone).status !== 0) fail("could not branch the clone");
    // The clone is a copy, but the probe body is not this repository's code and
    // overwriting a real file would measure the tool against a file it wrote.
    if (existsSync(join(clone, probePath))) {
      fail(`${probePath} already exists, so the probe would overwrite real code`);
      return { row, problems, head, summary };
    }
    mkdirSync(dirname(join(clone, probePath)), { recursive: true });
    writeFileSync(join(clone, probePath), plan ? plan.body : "e2e probe\n");
    git(["add", "--", probePath], clone);
    const committed = git(["-c", "user.name=e2e", "-c", "user.email=e2e@local", "commit", "-qm", "e2e probe"], clone);
    if (committed.status !== 0) fail(`could not commit the probe: ${committed.err.split("\n")[0]}`);

    const probed = anatomiya(["check", clone, "--base", base, "--format", "json"], scratchDir);
    if (probed.status !== 0) fail(`check exited ${probed.status} on the probe branch: ${probed.err.split("\n")[0]}`);
    const probeReport = readJson(probed.out);
    if (probeReport === null) fail("the check printed no record on the probe branch");
    const named = probeReport ? findingPaths(probeReport) : [];
    if (plan) {
      row.probe = named.includes(probePath) ? `yes ${plan.dimension}` : "no";
      if (row.probe === "no") fail(`no finding names ${probePath}, and ${plan.dimension} states ${plan.learned} in ${plan.area}`);
    } else {
      row.probe = "n.a.";
      if (named.length !== 0) fail(`a markdown file drew ${named.length} finding(s)`);
    }
    return { row, problems, head, summary };
  } catch (err) {
    fail(err && err.stack ? err.stack : String(err));
    return { row, problems };
  } finally {
    // In the finally, and never allowed to throw out of it: a clone left behind
    // is a finding about this harness, not a reason to abandon the other 35.
    const left = removeTree(clone);
    if (left) fail(`the clone could not be removed: ${left}`);
    row.seconds = ((Date.now() - started) / 1000).toFixed(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}\n\n${USAGE}`);
    process.exit(2);
  }
  const corpusDir = resolve(opts.corpus);
  const scratchDir = resolve(opts.scratch);

  // Asked before the directory is made, so a scratch path inside the corpus is
  // refused rather than created there.
  const refused = checkDirs(corpusDir, scratchDir, existsSync(scratchDir) ? readdirSync(scratchDir) : []);
  if (refused) {
    console.error(`${refused}\n\n${USAGE}`);
    process.exit(2);
  }
  const found = corpusRepos(corpusDir);
  if (found.error) {
    console.error(`${found.error}\n\n${USAGE}`);
    process.exit(2);
  }
  // This tool's own repository, last, because the acceptance has to include the
  // one repository whose map its authors read every day.
  const repos = [...found.repos, { name: "anatomiya", source: resolve(HERE, "..") }];

  const selected = selectRepos(repos, opts.only);
  if (selected.error) {
    console.error(`${selected.error}\n\n${USAGE}`);
    process.exit(2);
  }
  // Last, so a run refused for any of the reasons above leaves no directory
  // behind it.
  mkdirSync(scratchDir, { recursive: true });

  const rows = [];
  const problems = [];
  const heads = new Map();
  const summaries = new Map();
  for (const { name, source } of selected.repos) {
    const out = await runRepo(name, source, scratchDir);
    rows.push(out.row);
    problems.push(...out.problems);
    if (out.head) heads.set(name, out.head);
    if (out.summary) summaries.set(name, out.summary);
    console.log(`| ${COLUMNS.map((c) => out.row[c]).join(" | ")} |`);
  }

  console.log("");
  console.log(tableOf(rows));
  console.log("");
  for (const [name, head] of heads) console.log(`${name}: ${head}`);
  // The summary of the scan against the pin, per repository. The table reduces
  // it to five numbers, and the lines themselves are what a user actually reads.
  for (const [name, summary] of summaries) console.log(`\n--- ${name} scan against the pin ---\n${summary.trimEnd()}`);

  const left = readdirSync(scratchDir);
  if (left.length) problems.push(`the scratch directory still holds ${left.length} entries: ${left.join(", ")}`);

  if (problems.length) {
    console.error(`\n${problems.length} failed assertion(s):`);
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.error(`\n${rows.length} of ${rows.length} repositories passed`);
}

// Guarded, because the tests import the helpers from here and an unguarded run
// would clone a corpus instead of asserting.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
