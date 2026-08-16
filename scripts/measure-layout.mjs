#!/usr/bin/env node
/**
 * Corpus acceptance for the `## What lives where` section.
 *
 * Every child of the corpus directory that is a git repository is scanned twice
 * and rendered twice, in this process and writing nothing into it. Then the
 * printed section is taken apart clause by clause and every number in it is
 * recounted here, from `git ls-files` and the parse facets, rather than read
 * back out of the record that produced it.
 *
 * The recount shares the classification rules with `layout.mjs` on purpose: a
 * test file is a test file by one definition, and a second one here would only
 * measure the disagreement. What it does not share is the summation, the root
 * subsets or the rendering, which is where a wrong number would come from.
 *
 * Read-only over the corpus. A repository is opened, listed, parsed and left
 * exactly as it was; facts records go to `--facts` under this tool's own
 * scratch directory so the applicability audit has something to read.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { collect, frameworksIn } from "../lib/corpus.mjs";
import { parseAll } from "../lib/parse.mjs";
import { scan } from "../lib/scan.mjs";
import { MAX_LINES, renderOverview, splitUncovered } from "../lib/render.mjs";
import { readFacts, statedSide, writeFacts } from "../lib/facts.mjs";
import { areaFilename, auditRules, knownNames, OVERVIEW_FILE } from "../lib/rules.mjs";
import { encodePath } from "../lib/encode.mjs";

const DEFAULT_CORPUS = "/Users/crisn/Documents/Projects/anatomiya-corpus";

const HEADING = "## What lives where";
const TRUNCATED = "layout: not counted, the scan was truncated";
const LEVEL_SUFFIX = " (files at this level)";

// The five rows part 2 added, counted per repository so a row nothing states
// anywhere is visible as such.
const LEARNED_ROWS = ["extends_base", "class_base", "module_include", "interface_prefix", "type_alias_prefix"];

// --- the recount ------------------------------------------------------------

const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const extOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "(none)";
};
const stemOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

const TEST_DIRS = new Set(["__tests__"]);
const TEST_NAME = /[.-](test|spec|cy)\.|_(spec|test)\.rb$/;
const TEST_ROOTS = new Set(["test", "tests", "spec"]);
const MODULE_EXTS = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"]);
const NAMESAKE_SUFFIXES = ["_spec", "_test", ".test", ".spec", ".cy"];

// The mirror index the corpus decides, set once per repository before anything
// is recounted: it is a fact about the whole tree, like the roster's own.
let mirrored = new Set();

function isTest(f) {
  if (!f.lang) return false;
  if (f.facets?.testRunner || f.facets?.testCalls) return true;
  if (TEST_NAME.test(baseOf(f.rel))) return true;
  if (mirrored.has(f.rel)) return true;
  const dir = dirOf(f.rel);
  return dir !== "" && dir.split("/").some((seg) => TEST_DIRS.has(seg));
}

const withoutExt = (rel) => {
  const dot = rel.lastIndexOf(".");
  return dot > rel.lastIndexOf("/") ? rel.slice(0, dot) : rel;
};

const inTestRoot = (rel) => rel.includes("/") && TEST_ROOTS.has(rel.slice(0, rel.indexOf("/")));

/** A test tree's files that mirror a source file outside it, recounted here. */
function mirrorIndex(corpus) {
  const outside = new Set();
  for (const f of corpus) {
    if (!f.lang || inTestRoot(f.rel)) continue;
    const segments = withoutExt(f.rel).split("/");
    for (let i = 0; i < segments.length; i++) outside.add(segments.slice(i).join("/"));
  }
  const out = new Set();
  for (const f of corpus) {
    if (!f.lang || !inTestRoot(f.rel)) continue;
    const under = withoutExt(f.rel).slice(f.rel.indexOf("/") + 1);
    if (under.includes("/") && outside.has(under)) out.add(f.rel);
  }
  return out;
}

const runnerOf = (f) =>
  f.facets?.testRunner || (dirOf(f.rel).split("/").includes("cypress") ? "cypress" : "test files");

const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const WRAPPER_SHARE = 0.8;

const majorityDir = (dirs) => {
  const bar = WRAPPER_SHARE * dirs.length;
  const prefix = [];
  for (;;) {
    const under = dirs.filter((d) => d.startsWith(prefix.length ? `${prefix.join("/")}/` : ""));
    const next = tally(under.map((d) => d.split("/")[prefix.length]).filter(Boolean));
    if (next.length === 0 || next[0][1] < bar) break;
    prefix.push(next[0][0]);
  }
  return prefix.length === 0 ? null : prefix.join("/");
};

const namesakeStem = (rel) => {
  const stem = stemOf(rel);
  for (const suffix of NAMESAKE_SUFFIXES) {
    if (stem.length > suffix.length && stem.endsWith(suffix)) return stem.slice(0, -suffix.length);
  }
  return stem;
};

const tailOf = (rel, rootPath) => {
  const dir = dirOf(rel);
  if (rootPath === "" || rootPath === ".") return dir;
  if (dir === rootPath) return "";
  return dir.startsWith(`${rootPath}/`) ? dir.slice(rootPath.length + 1) : dir;
};

function namesakes(sourceFiles, testFiles, rootPath) {
  const byStem = new Map();
  for (const t of testFiles) {
    const stem = namesakeStem(t.rel);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(t.rel);
  }
  const votes = new Map();
  let answered = 0;
  for (const f of sourceFiles) {
    const tail = tailOf(f.rel, rootPath);
    let matched = false;
    for (const rel of byStem.get(stemOf(f.rel)) ?? []) {
      const dir = dirOf(rel);
      if (tail !== "" && dir !== tail && !dir.endsWith(`/${tail}`)) continue;
      matched = true;
      const prefix = tail === "" ? dir : dir.slice(0, Math.max(0, dir.length - tail.length - 1));
      votes.set(prefix, (votes.get(prefix) ?? 0) + 1);
    }
    if (matched) answered++;
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { with: answered, of: sourceFiles.length, root: ranked.length === 0 ? null : ranked[0][0] || "." };
}

/** The files a printed root path stands for, by the rule that selected it. */
function filesUnder(path, corpus) {
  const level = path.endsWith(LEVEL_SUFFIX);
  const raw = level ? path.slice(0, -LEVEL_SUFFIX.length) : path;
  const dir = raw === "." ? "" : raw;
  if (level || dir === "") return corpus.filter((f) => dirOf(f.rel) === dir);
  return corpus.filter((f) => f.rel.startsWith(`${dir}/`));
}

function testGroupsOf(own, dir) {
  const groups = new Map();
  for (const f of own.filter(isTest)) {
    const runner = runnerOf(f);
    if (!groups.has(runner)) groups.set(runner, []);
    groups.get(runner).push(f);
  }
  return [...groups]
    .map(([runner, group]) => {
      const ranked = tally(group.map((f) => dirOf(f.rel)).filter((d) => d !== dir).map(baseOf));
      return {
        runner,
        files: group.length,
        sub: ranked.length > 0 && ranked[0][1] * 2 > group.length ? ranked[0][0] : null,
      };
    })
    .sort((a, b) => b.files - a.files || a.runner.localeCompare(b.runner));
}

/** One root, recounted from the corpus under the path the section printed. */
function recountRoot(path, corpus, testFiles) {
  const own = filesUnder(path, corpus);
  const dir = path.endsWith(LEVEL_SUFFIX) ? path.slice(0, -LEVEL_SUFFIX.length) : path === "." ? "" : path;
  const tests = own.filter(isTest);
  const jsxFiles = own.filter((f) => f.facets?.jsx);
  const exts = tally(own.map((f) => extOf(f.rel))).slice(0, 2);
  const producers = own.filter((f) => f.lang && extOf(f.rel) === exts[0]?.[0] && !isTest(f));

  const jsxByExt = new Map(tally(jsxFiles.map((f) => extOf(f.rel))));
  const out = {
    files: own.length,
    source: own.filter((f) => f.lang).length,
    exts,
    other: own.length - exts.reduce((n, [, count]) => n + count, 0),
    jsxExt: exts.find(([ext, count]) => (jsxByExt.get(ext) ?? 0) * 2 >= count)?.[0] ?? null,
    tests: testGroupsOf(own, dir),
    testRoot: tests.length * 2 > own.length,
    companions: producers.length > 0 && testFiles.length > 0 ? namesakes(producers, testFiles, dir) : null,
    helpers: null,
  };

  const modules = own.filter((f) => MODULE_EXTS.has(extOf(f.rel)) && !f.facets?.jsx && !isTest(f));
  if (jsxFiles.length > 0 && modules.length > 0) {
    out.helpers = {
      siblingModules: modules.length,
      stems: tally(modules.map((f) => stemOf(f.rel))).slice(0, 3).map(([stem]) => stem),
      inlineFiles: jsxFiles.filter((f) => f.facets?.inlineHelpers > 0).length,
    };
  }
  return out;
}

/** The whole-repository tests line, recounted. */
function recountTests(corpus) {
  const dirs = new Map();
  for (const f of corpus) {
    if (!isTest(f)) continue;
    const runner = runnerOf(f);
    if (!dirs.has(runner)) dirs.set(runner, []);
    dirs.get(runner).push(dirOf(f.rel));
  }
  return [...dirs]
    .map(([runner, group]) => ({ runner, root: majorityDir(group), files: group.length }))
    .sort(
      (a, b) =>
        b.files - a.files || (a.root ?? "").localeCompare(b.root ?? "") || a.runner.localeCompare(b.runner)
    );
}

// --- reading the rendered section ------------------------------------------

/** The lines between the heading and the next one, trailing blank dropped. */
function sectionOf(overview) {
  const lines = overview.split("\n");
  const at = lines.indexOf(HEADING);
  if (at === -1) return null;
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  while (end > at && lines[end - 1] === "") end--;
  return lines.slice(at, end);
}

const pathLabel = (p) => JSON.parse(encodePath(p)) || "(unnamed)";

// `- and 3 more directories holding 91 files`, and the form for a fold that
// dropped no whole directory.
const FOLD_DIRS = /^- and (\d+) more (?:directory|directories) holding (\d+) files?$/;
const FOLD_FILES = /^- and (\d+) more files? in directories under the floor$/;

const otherText = (n) => (n ? ` and ${n} other` : "");

// What a test root names before it counts the rest, and what the tests line
// shows before it counts the rest. Both live in the renderer too.
const RUNNERS_SHOWN = 2;
const TESTS_GROUPS = 3;

/**
 * The printed clauses of one root line, as numbers and labels.
 *
 * Parsed rather than regenerated: the point is to read what the file actually
 * says, which is what the agent gets.
 */
function readRootLine(line) {
  const body = line.slice(2);
  const at = body.indexOf(": ");
  if (at === -1) return null;
  return { label: body.slice(0, at), clauses: body.slice(at + 2).split("; ") };
}

function readExtClause(clause) {
  const tail = clause.match(/ and (\d+) other$/);
  const head = tail ? clause.slice(0, clause.length - tail[0].length) : clause;
  const exts = [];
  for (const item of head.split(", ")) {
    const m = item.match(/^(\d+) (\S+)( \(JSX\))?$/);
    if (!m) return null;
    exts.push({ count: Number(m[1]), ext: m[2], jsx: Boolean(m[3]) });
  }
  return { exts, other: tail ? Number(tail[1]) : 0 };
}

const RUNNER_LABELS = { cypress: "Cypress", rspec: "RSpec" };
const runnerLabel = (runner) => RUNNER_LABELS[runner] ?? runner;
const specNoun = (n, runner) =>
  runner === "test files" ? `test file${n === 1 ? "" : "s"}` : `${runnerLabel(runner)} spec${n === 1 ? "" : "s"}`;

// --- the assertions ---------------------------------------------------------

class Failed extends Error {}

const fail = (what) => {
  throw new Failed(what);
};

const same = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: printed ${JSON.stringify(got)}, recount ${JSON.stringify(want)}`);
};

/**
 * Every clause of every root line, against the recount.
 *
 * Returns what the summary table needs: how many roots printed, and how many
 * the fold line reported.
 */
function checkSection(section, corpus, root, recordRoots) {
  if (section === null) fail(`${HEADING} is missing`);
  if (section.includes(TRUNCATED)) return { roots: 0, folded: 0, principles: 0, truncated: true };

  const bullets = section.filter((l) => l.startsWith("- "));
  const rootLines = bullets.filter((l) => !l.startsWith("- tests: ") && !l.startsWith("- and "));
  if (rootLines.length === 0) fail(`${HEADING} printed no root line`);

  const testFiles = corpus.filter(isTest);
  let printedFiles = 0;

  for (const line of rootLines) {
    const parsed = readRootLine(line);
    if (parsed === null) fail(`root line has no path label: ${line}`);
    checkPathOnDisk(parsed.label, root);
    const counted = recountRoot(parsed.label, corpus, testFiles);
    printedFiles += counted.files;

    const clauses = [...parsed.clauses];
    if (counted.testRoot && counted.tests.length > 0) {
      const shown = counted.tests.slice(0, RUNNERS_SHOWN);
      const expected =
        shown.map((t) => `${t.files} ${specNoun(t.files, t.runner)}`).join(", ") +
        otherText(counted.files - shown.reduce((n, t) => n + t.files, 0));
      const clause = clauses.shift();
      if (clause !== expected) fail(`${parsed.label} test root: printed "${clause}", recount "${expected}"`);
      if (clauses.length) fail(`test root line carries more than its runners: ${line}`);
      continue;
    }

    const ext = readExtClause(clauses.shift());
    if (ext === null) fail(`extension clause does not parse: ${line}`);
    same(
      `${parsed.label} extensions`,
      ext.exts.map((e) => [e.ext, e.count]),
      counted.exts
    );
    same(`${parsed.label} other`, ext.other, counted.other);
    same(`${parsed.label} JSX extension`, ext.exts.find((e) => e.jsx)?.ext ?? null, counted.jsxExt);

    for (const group of counted.tests) {
      const want = specNoun(group.files, group.runner);
      const clause = clauses.shift();
      const expected = group.sub ? `${group.files} ${want} under ${pathLabel(group.sub)}` : `${group.files} ${want}`;
      if (clause !== expected) fail(`${parsed.label} tests clause: printed "${clause}", recount "${expected}"`);
    }

    if (counted.companions) {
      const clause = clauses.shift();
      const c = counted.companions;
      const expected =
        `${c.with} of ${c.of} have a namesake test` + (c.root ? ` under ${pathLabel(c.root)}` : "");
      if (clause !== expected) fail(`${parsed.label} namesake clause: printed "${clause}", recount "${expected}"`);
    }

    if (counted.helpers) {
      const h = counted.helpers;
      const first = clauses.shift();
      const wantFirst =
        `${h.siblingModules} sibling module${h.siblingModules === 1 ? "" : "s"} named ${h.stems.join("/")}`;
      if (first !== wantFirst) fail(`${parsed.label} sibling clause: printed "${first}", recount "${wantFirst}"`);
      const second = clauses.shift();
      const wantSecond = `${h.inlineFiles} file${h.inlineFiles === 1 ? "" : "s"} inline${h.inlineFiles === 1 ? "s" : ""} a helper`;
      if (second !== wantSecond) fail(`${parsed.label} inline clause: printed "${second}", recount "${wantSecond}"`);
    }

    if (clauses.length) fail(`${parsed.label} printed a clause the recount has no ground for: ${clauses[0]}`);
  }

  // The fold line, and the one invariant that ties it to the root lines: every
  // tracked file is under a printed root or inside the fold.
  const foldLine = bullets.find((l) => l.startsWith("- and "));
  let folded = 0;
  let foldedFiles = 0;
  if (foldLine) {
    const dirs = foldLine.match(FOLD_DIRS);
    const only = foldLine.match(FOLD_FILES);
    if (dirs) {
      folded = Number(dirs[1]);
      foldedFiles = Number(dirs[2]);
    } else if (only) {
      foldedFiles = Number(only[1]);
    } else {
      fail(`fold line does not parse: ${foldLine}`);
    }
  }
  if (printedFiles + foldedFiles !== corpus.length) {
    fail(
      `root lines and the fold account for ${printedFiles + foldedFiles} files, the corpus holds ${corpus.length}`
    );
  }

  checkTestsLine(bullets.find((l) => l.startsWith("- tests: ")), corpus, recordRoots, testFiles);

  const principles = section.filter((l) => l !== "" && !l.startsWith("- ") && l !== HEADING).length;
  return { roots: rootLines.length, folded, principles, truncated: false };
}

/** The tests line's groups, against a recount over the whole corpus. */
function checkTestsLine(line, corpus, recordRoots, testFiles) {
  const recount = recountTests(corpus);
  if (!line) {
    if (recount.length > 0) fail(`the tests line is missing and ${recount.length} runner group(s) were counted`);
    return;
  }
  const clauses = line.slice("- tests: ".length).split("; ");
  const shown = recount.slice(0, TESTS_GROUPS);
  for (const [i, g] of shown.entries()) {
    const noun = i === 0 ? specNoun(g.files, g.runner) : g.runner === "test files" ? `test file${g.files === 1 ? "" : "s"}` : runnerLabel(g.runner);
    const expected = `${g.files} ${noun}` + (g.root ? ` under ${pathLabel(g.root)}` : "");
    const clause = clauses.shift();
    if (clause !== expected) fail(`tests line group ${i + 1}: printed "${clause}", recount "${expected}"`);
  }
  if (recount.length > shown.length) {
    const expected = `and ${recount.length - shown.length} more`;
    const clause = clauses.shift();
    if (clause !== expected) fail(`tests line tail: printed "${clause}", recount "${expected}"`);
  }
  // The trailing namesake clause names no directory. Which root it speaks for
  // is the first one holding a namesake count, and that root may have lost its
  // own line to the budget, so the path comes from the record and the numbers
  // are recounted here like every other.
  const top = topNamesakeRoot(recordRoots, corpus, testFiles);
  if (top) {
    const clause = clauses.shift();
    const noun = `${top.exts[0][0]} file${top.companions.of === 1 ? "" : "s"}`;
    const expected = `${top.companions.with} of ${top.companions.of} ${noun} have a namesake test`;
    if (clause !== expected) fail(`tests line namesake clause: printed "${clause}", recount "${expected}"`);
  }
  if (clauses.length) fail(`tests line carries a clause the recount has no ground for: ${clauses[0]}`);
}

/** The first root with a namesake count, recounted under the record's paths. */
function topNamesakeRoot(recordRoots, corpus, testFiles) {
  for (const path of recordRoots) {
    const counted = recountRoot(path, corpus, testFiles);
    if (!counted.testRoot && counted.companions && counted.exts.length > 0) return counted;
  }
  return null;
}

/**
 * Assert the printed path is a directory this repository has. The label is what
 * the agent reads, so it is what gets checked; a name the encoder emptied comes
 * through as `(unnamed)` and answers to no path.
 */
function checkPathOnDisk(label, root) {
  if (label === "(unnamed)") return;
  const raw = label.endsWith(LEVEL_SUFFIX) ? label.slice(0, -LEVEL_SUFFIX.length) : label;
  const dir = raw === "." ? "" : raw;
  if (!existsSync(join(root, dir))) fail(`root path does not exist: ${label}`);
}

// --- one repository ---------------------------------------------------------

/**
 * The `files` argument a real write would hand the overview: the uncovered
 * split, and whatever else is already loading out of the rules directory.
 * Mirrors `writeMap`, which cannot be called for a body it does not return.
 */
function overviewFor(result) {
  const uncovered = result.corpus.files - result.areas.reduce((s, a) => s + a.fileCount, 0);
  const { orphaned } = splitUncovered(uncovered, result.corpus.orphaned ?? uncovered);
  const planned = new Set([OVERVIEW_FILE, ...result.areas.filter((a) => a.dimensions.length > 0).map(areaFilename)]);
  const audit = auditRules(result.root, knownNames(readFacts(result.root).facts));
  const others = {
    foreign: audit.foreign.filter((f) => !planned.has(f)).sort(),
    unknown: audit.unknown.filter((f) => !planned.has(f)).sort(),
    unreadable: audit.unreadable.filter((f) => !planned.has(f)).sort(),
  };
  return renderOverview(result, { uncovered, orphaned, others });
}

/** The layout corpus, rebuilt here rather than read out of the scan. */
async function layoutCorpus(root) {
  const { files, others } = await collect(root);
  const head = await parseAll(files, { frameworks: [...frameworksIn(files)] });
  return [
    ...files.map((f) => ({ rel: f.rel, lang: f.lang, facets: head.records.get(f.rel)?.facets ?? null })),
    ...others.map((o) => ({ rel: o.rel, lang: null, facets: null })),
  ];
}

const statedCount = (areas, key) =>
  areas.reduce(
    (n, a) =>
      n +
      a.dimensions.filter(
        (d) => d.key === key && statedSide(d).states !== null && d.matchesDefault !== true
      ).length,
    0
  );

/** The one line two renders disagree on, which is what makes a drift findable. */
function firstDifference(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) return `line ${i + 1} is "${left[i] ?? "(absent)"}" then "${right[i] ?? "(absent)"}"`;
  }
  return "the two are equal line by line";
}

async function measure(name, dir) {
  const started = Date.now();
  const first = await scan(dir);
  const a = overviewFor(first);
  const second = await scan(dir);
  const b = overviewFor(second);

  const lines = a.split("\n");
  // The trailing newline is not a line of the file.
  const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  if (count > MAX_LINES) fail(`the overview is ${count} lines, over the ${MAX_LINES} bound`);
  if (a !== b) fail(`two scans of one tree rendered different overviews: ${firstDifference(a, b)}`);

  const corpus = await layoutCorpus(first.root);
  mirrored = mirrorIndex(corpus);
  const section = sectionOf(a);
  const seen = checkSection(section, corpus, first.root, (first.layout?.roots ?? []).map((r) => r.path));

  return {
    name,
    root: first.root,
    section: section === null ? null : section.join("\n"),
    overviewLines: count,
    result: first,
    row: {
      repo: name,
      tracked: corpus.length,
      roots: seen.roots,
      folded: seen.folded,
      testGroups: first.layout?.tests?.length ?? 0,
      principles: seen.principles,
      ...Object.fromEntries(LEARNED_ROWS.map((key) => [key, statedCount(first.areas, key)])),
      imports: first.areas.filter((x) => x.imports?.length).length,
      reused: first.areas.filter((x) => x.reused?.length).length,
      seconds: ((Date.now() - started) / 1000).toFixed(1),
    },
  };
}

// --- the run ----------------------------------------------------------------

const COLUMNS = [
  "repo",
  "tracked",
  "roots",
  "folded",
  "testGroups",
  "principles",
  ...LEARNED_ROWS,
  "imports",
  "reused",
  "seconds",
];

function tableOf(rows) {
  const out = [`| ${COLUMNS.join(" | ")} |`, `|${COLUMNS.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${COLUMNS.map((c) => r[c]).join(" | ")} |`);
  return out.join("\n");
}

function parseArgs(argv) {
  const opts = { corpus: null, md: null, facts: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--md" || arg === "--facts" || arg === "--only") {
      opts[arg.slice(2)] = argv[++i];
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    }
    opts.corpus = arg;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const corpusDir = resolve(opts.corpus ?? DEFAULT_CORPUS);
  const only = opts.only ? new Set(opts.only.split(",")) : null;

  const repos = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(corpusDir, e.name, ".git")))
    .map((e) => e.name)
    .filter((name) => only === null || only.has(name))
    .sort();

  const rows = [];
  const sections = [];
  const failures = [];

  for (const name of repos) {
    try {
      const out = await measure(name, join(corpusDir, name));
      rows.push(out.row);
      sections.push(out);
      console.log(`| ${COLUMNS.map((c) => out.row[c]).join(" | ")} |`);
      if (opts.facts) {
        const dir = join(resolve(opts.facts), name);
        mkdirSync(dir, { recursive: true });
        writeFacts(dir, out.result);
      }
    } catch (err) {
      const how = err instanceof Failed ? err.message : `${err && err.stack ? err.stack : err}`;
      failures.push(`${name}: ${how}`);
      console.error(`FAIL ${name}: ${how}`);
    }
  }

  console.log("");
  console.log(tableOf(rows));

  if (opts.md) {
    const body = [
      tableOf(rows),
      "",
      ...sections.flatMap((s) => [`## ${s.name}`, "", "```", s.section ?? "(no section)", "```", ""]),
    ];
    writeFileSync(resolve(opts.md), body.join("\n"));
  }

  if (failures.length) {
    console.error(`\n${failures.length} of ${repos.length} repositories failed:`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.error(`\n${rows.length} of ${repos.length} repositories passed`);
}

await main();
