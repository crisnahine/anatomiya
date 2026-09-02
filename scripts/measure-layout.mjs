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
 * The classification predicates are imported from `layout.mjs` rather than
 * copied: a test file is a test file by one definition, and a second one here
 * would measure the disagreement rather than the counts. What the recount owns
 * is the summation, the root subsets and the reading back of the printed line,
 * which is where a wrong number would come from.
 *
 * Read-only over the corpus. A repository is opened, listed, parsed and left
 * exactly as it was; facts records go to `--facts` under this tool's own
 * scratch directory so the applicability audit has something to read.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokedAs } from "./entry.mjs";
import { namesakeCompanions, namesakeIndex } from "../plugins/anatomiya/lib/companions.mjs";
import { collect, frameworksIn } from "../plugins/anatomiya/lib/corpus.mjs";
import {
  isStoryFile,
  isTestFile,
  majorityDir,
  mirroredTests,
  MODULE_EXTS,
  runnerOf,
  tally,
  underTestTree,
} from "../plugins/anatomiya/lib/layout.mjs";
import { parseAll } from "../plugins/anatomiya/lib/parse.mjs";
import { baseOf, dirOf, extOf, stemOf } from "../plugins/anatomiya/lib/paths.mjs";
import { scan } from "../plugins/anatomiya/lib/scan.mjs";
import { MAX_LINES } from "../plugins/anatomiya/lib/render.mjs";
import { namesakeClause, ROOT_LABEL, runnerCount, RUNNERS_SHOWN, specCount, TESTS_GROUPS, TRUNCATED_LAYOUT } from "../plugins/anatomiya/lib/render-layout.mjs";
import { statedSide, writeFacts } from "../plugins/anatomiya/lib/facts.mjs";
import { OVERVIEW_FILE } from "../plugins/anatomiya/lib/rules.mjs";
import { planMap } from "../plugins/anatomiya/lib/write.mjs";
import { encodePath } from "../plugins/anatomiya/lib/encode.mjs";

const HEADING = "## What lives where";
const LEVEL_SUFFIX = " (files at this level)";

// The five rows part 2 added, counted per repository so a row nothing states
// anywhere is visible as such.
export const LEARNED_ROWS = ["extends_base", "class_base", "module_include", "interface_prefix", "type_alias_prefix"];

// --- the recount ------------------------------------------------------------

// The recount orders the way the roster it reads back does, and `localeCompare`
// orders case by whatever ICU tables the host was built with.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The mirror index the corpus decides, set once per repository before anything
// is recounted: it is a fact about the whole tree, like the roster's own.
let mirrored = new Set();

const isTest = (f) => isTestFile(f, mirrored);
const runner = (f) => runnerOf(f.rel, f.facets);

// What the renderer calls a flat repository's one root, read back to the path.
const pathOf = (label) => (label === ROOT_LABEL ? "." : label);

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
    const name = runner(f);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(f);
  }
  return [...groups]
    .map(([runner, group]) => {
      const ranked = tally(group.map((f) => dirOf(f.rel)).filter((d) => d !== dir).map(baseOf));
      // The vote count travels with the name here too: a strict majority is as
      // few as half the group plus one, so the name can hold 5 of 8.
      const won = ranked.length > 0 && ranked[0][1] * 2 > group.length ? ranked[0] : null;
      return {
        runner,
        files: group.length,
        sub: won === null ? null : won[0],
        under: won === null ? group.length : won[1],
      };
    })
    .sort((a, b) => b.files - a.files || byCode(a.runner, b.runner));
}

/**
 * One root, recounted from the corpus under the path the section printed.
 *
 * `byStem` is the whole corpus's index, built the way `layoutIndexes` builds
 * it. Rebuilding it from the test files alone would ask a narrower question
 * than the scan asks, with no learned spelling and no ownership, and the
 * recount would then measure the disagreement rather than the counts.
 */
function recountRoot(path, corpus, testFiles, byStem) {
  const own = filesUnder(path, corpus);
  const dir = path.endsWith(LEVEL_SUFFIX) ? path.slice(0, -LEVEL_SUFFIX.length) : path === "." ? "" : path;
  const tests = own.filter(isTest);
  const jsxFiles = own.filter((f) => f.facets?.jsx);
  const exts = tally(own.map((f) => extOf(f.rel))).slice(0, 2);
  // The first shown extension any source file wears, not simply the first: a
  // root whose bulk is screenshots or markdown has real producers under the
  // second one, and reading only exts[0] counts every one of them as zero.
  const producerExt = exts.find(([ext]) => own.some((f) => f.lang && extOf(f.rel) === ext))?.[0];
  const producers = own.filter(
    (f) => f.lang && extOf(f.rel) === producerExt && !f.facets?.empty && !isTest(f) && !isStoryFile(f.rel));
  const stories = own.filter((f) => isStoryFile(f.rel));

  const jsxByExt = new Map(tally(jsxFiles.map((f) => extOf(f.rel))));
  const out = {
    // Beside the printed label, since a shell's own files are labelled
    // `lib (files at this level)`, which names no directory.
    dir,
    files: own.length,
    source: own.filter((f) => f.lang).length,
    exts,
    other: own.length - exts.reduce((n, [, count]) => n + count, 0),
    jsxExt: exts.find(([ext, count]) => (jsxByExt.get(ext) ?? 0) * 2 >= count)?.[0] ?? null,
    tests: testGroupsOf(own, dir),
    testRoot: tests.length * 2 > own.length,
    companions:
      producers.length > 0 && testFiles.length > 0 && !underTestTree(dir)
        ? namesakeCompanions(producers, testFiles, dir, byStem)
        : null,
    helpers: null,
  };
  if (stories.length > 0) out.stories = stories.length;

  const modules = own.filter(
    (f) => f.facets && MODULE_EXTS.has(extOf(f.rel)) && !f.facets.jsx && !isTest(f) && !isStoryFile(f.rel));
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
    const name = runner(f);
    if (!dirs.has(name)) dirs.set(name, []);
    dirs.get(name).push(dirOf(f.rel));
  }
  return [...dirs]
    .map(([runner, group]) => {
      const root = majorityDir(group);
      const under = root === null ? group.length : group.filter((d) => d === root || d.startsWith(`${root}/`)).length;
      return { runner, root, files: group.length, under };
    })
    .sort((a, b) => b.files - a.files || byCode(a.root ?? "", b.root ?? "") || byCode(a.runner, b.runner));
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

// The clauses the fold line can carry: `3 more directories holding 91 files`,
// the files in directories that cleared no floor, and the files sitting at the
// repository root. One line prints whichever of the three it has, so they are
// read as a series rather than as one anchored sentence.
//
// The middle one keeps an older spelling too, from before the three were
// counted apart, which a map on disk still carries until it is rescanned.
const FOLD_DIRS = /^(\d+) more (?:directory|directories) holding (\d+) files?$/;
const FOLD_FILES = /^(\d+) files? in \d+ (?:directory|directories) under the floor$/;
const FOLD_OLD_FILES = /^(\d+) more files? in directories under the floor$/;
const FOLD_ROOT = /^(\d+)(?: files?)? at the repository root$/;

/**
 * The fold line's two numbers: how many whole directories folded, and how many
 * files the line accounts for across every clause it carries. Null where a
 * clause does not read as any of the forms above.
 *
 * Exported because nothing runs this parser until a corpus run does, and a
 * spelling it cannot read fails 35 repositories at once, eighteen minutes in.
 */
export function foldCounts(line) {
  // The line joins two clauses on a bare "and" and three on a comma series, so
  // the separator is either, and no clause of its own holds either spelling.
  const said = line.replace(/^- and /, "").split(/,\s+and\s+|,\s+|\s+and\s+/);
  let folded = 0;
  let files = 0;
  for (const one of said) {
    const dirs = one.match(FOLD_DIRS);
    const under = one.match(FOLD_FILES) ?? one.match(FOLD_OLD_FILES);
    const root = one.match(FOLD_ROOT);
    if (dirs) {
      folded = Number(dirs[1]);
      files += Number(dirs[2]);
    } else if (under) {
      files += Number(under[1]);
    } else if (root) {
      files += Number(root[1]);
    } else {
      return null;
    }
  }
  return { folded, files };
}

const otherText = (n) => (n ? ` and ${n} other` : "");

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
  if (section.includes(TRUNCATED_LAYOUT)) return { roots: 0, folded: 0, principles: 0, truncated: true };

  const bullets = section.filter((l) => l.startsWith("- "));
  const rootLines = bullets.filter((l) => !l.startsWith("- tests: ") && !l.startsWith("- and "));
  if (rootLines.length === 0) fail(`${HEADING} printed no root line`);

  const testFiles = corpus.filter(isTest);
  // The same index the scan hands its roots, over the same corpus: the sources
  // are what decide ownership and what a second spelling is learned from, and
  // an index built from the test files alone answers a narrower question.
  const sources = corpus.filter((f) => f.lang && !f.facets?.empty && !isTest(f) && !isStoryFile(f.rel));
  const byStem = namesakeIndex(testFiles, sources);
  let printedFiles = 0;

  for (const line of rootLines) {
    const parsed = readRootLine(line);
    if (parsed === null) fail(`root line has no path label: ${line}`);
    const path = pathOf(parsed.label);
    checkPathOnDisk(path, root);
    const counted = recountRoot(path, corpus, testFiles, byStem);
    printedFiles += counted.files;

    const clauses = [...parsed.clauses];
    if (counted.testRoot && counted.tests.length > 0) {
      const shown = counted.tests.slice(0, RUNNERS_SHOWN);
      const expected =
        shown.map((t) => specCount(t.files, t.runner)).join(", ") +
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

    if (counted.stories) {
      const clause = clauses.shift();
      const expected = `${counted.stories} story file${counted.stories === 1 ? "" : "s"}`;
      if (clause !== expected) fail(`${parsed.label} stories clause: printed "${clause}", recount "${expected}"`);
    }

    for (const group of counted.tests) {
      const clause = clauses.shift();
      const named = group.under !== group.files ? `${group.under} of ` : "";
      const count = specCount(group.files, group.runner);
      const expected = group.sub ? `${named}${count} under ${pathLabel(group.sub)}` : `${named}${count}`;
      if (clause !== expected) fail(`${parsed.label} tests clause: printed "${clause}", recount "${expected}"`);
    }

    if (counted.companions) {
      const clause = clauses.shift();
      const expected = namesakeClause(counted.companions);
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
    const counts = foldCounts(foldLine);
    if (counts === null) {
      fail(`fold line does not parse: ${foldLine}`);
    } else {
      folded = counts.folded;
      foldedFiles = counts.files;
    }
  }
  if (printedFiles + foldedFiles !== corpus.length) {
    fail(
      `root lines and the fold account for ${printedFiles + foldedFiles} files, the corpus holds ${corpus.length}`
    );
  }

  checkTestsLine(bullets.find((l) => l.startsWith("- tests: ")), corpus, recordRoots, testFiles, byStem);

  const principles = section.filter((l) => l !== "" && !l.startsWith("- ") && l !== HEADING).length;
  return { roots: rootLines.length, folded, principles, truncated: false };
}

/** The tests line's groups, against a recount over the whole corpus. */
function checkTestsLine(line, corpus, recordRoots, testFiles, byStem) {
  const recount = recountTests(corpus);
  if (!line) {
    if (recount.length > 0) fail(`the tests line is missing and ${recount.length} runner group(s) were counted`);
    return;
  }
  const clauses = line.slice("- tests: ".length).split("; ");
  const shown = recount.slice(0, TESTS_GROUPS);
  for (const [i, g] of shown.entries()) {
    const named = g.under !== g.files ? `${g.under} of ` : "";
    const count = (i === 0 ? specCount : runnerCount)(g.files, g.runner);
    const expected = `${named}${count}` + (g.root ? ` under ${pathLabel(g.root)}` : "");
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
  const top = topNamesakeRoot(recordRoots, corpus, testFiles, byStem);
  if (top) {
    const clause = clauses.shift();
    const expected = namesakeClause({ ...top.companions, root: null }, `${top.exts[0][0]} file`, top.dir);
    if (clause !== expected) fail(`tests line namesake clause: printed "${clause}", recount "${expected}"`);
  }
  if (clauses.length) fail(`tests line carries a clause the recount has no ground for: ${clauses[0]}`);
}

/** The first root with a namesake count, recounted under the record's paths. */
function topNamesakeRoot(recordRoots, corpus, testFiles, byStem) {
  for (const path of recordRoots) {
    const counted = recountRoot(path, corpus, testFiles, byStem);
    if (!counted.testRoot && counted.companions && counted.exts.length > 0) return { ...counted, path };
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

/** The overview body a real write would put on disk, rendered and not written. */
export function overviewFor(result) {
  const plan = planMap(result);
  const body = plan.bodies.get(OVERVIEW_FILE);
  // A scan blind to a language renders nothing at all, and a recount of no
  // overview is not a section this bar may report either way.
  if (body === undefined) fail(`no overview was rendered: the scan read no ${plan.unreadable.join(" or ")} file at all`);
  return body;
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
  mirrored = mirroredTests(corpus);
  const section = sectionOf(a);
  const seen = checkSection(section, corpus, first.root, (first.layout?.roots ?? []).map((r) => r.path));

  return {
    name,
    root: first.root,
    section: section === null ? null : section.join("\n"),
    overviewLines: count,
    result: first,
    learned: learnedRows(name, first.areas),
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

function tableOf(rows, columns = COLUMNS) {
  const out = [`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${columns.map((c) => r[c]).join(" | ")} |`);
  return out.join("\n");
}

// --- the dimension bar ------------------------------------------------------

/**
 * What the bar asks for and a summary cannot answer: the three numbers and the
 * ratio, per repository and per area, for each of the five learned rows.
 *
 * A summary hides the one thing step 3 is looking for. `module_state_const`
 * scored 620 of 620 on one repository and shipped a directive nobody could
 * break; what would have caught it is a column of ratios sitting at 1.0.
 */
const LEARNED_COLUMNS = [
  "repo",
  "area",
  "applicability",
  "langFileCount",
  "candidates",
  "conforming",
  "ratio",
  "learned",
  "stated",
];

// A repository with sixty leaf areas holding one class each is not what the bar
// is asking about, and a table nobody reads to the end proves nothing.
const ROW_AREAS = 5;

/**
 * Whether the area was handed the sentence, and what stopped it if not.
 *
 * The gate is the point of the column: a row suppressed everywhere by `ratio`
 * is a repository disagreeing with itself, and one suppressed by `evidence` is
 * a repository that agrees and has too little of it to say so.
 */
function statedText(d) {
  const { states, gate } = statedSide(d);
  if (states === null) return `no (${gate})`;
  return d.matchesDefault === true ? "no (model default)" : "yes";
}

/** One repository's lines for each learned row, biggest area first. */
export function learnedRows(repo, areas) {
  const out = new Map(LEARNED_ROWS.map((key) => [key, []]));
  for (const a of areas) {
    for (const d of a.dimensions) {
      // An area holding no site of the row is not evidence about it either way,
      // and printing it as a zero row buries the areas that counted something.
      if (!out.has(d.key) || !d.candidates) continue;
      out.get(d.key).push({
        repo,
        area: a.path,
        applicability: d.applicability,
        langFileCount: d.langFileCount ?? "-",
        candidates: d.candidates,
        conforming: d.conforming,
        ratio: d.ratio.toFixed(3),
        learned: d.learned ?? "-",
        stated: statedText(d),
      });
    }
  }
  for (const [key, rows] of out) {
    rows.sort((x, y) => y.candidates - x.candidates || byCode(x.area, y.area));
    out.set(key, rows.slice(0, ROW_AREAS));
  }
  return out;
}

/** The five tables, in registry order, from `[key, rows]` pairs. */
export function learnedTables(collected) {
  const byKey = new Map(collected);
  return LEARNED_ROWS.flatMap((key) => [`### ${key}`, "", tableOf(byKey.get(key) ?? [], LEARNED_COLUMNS), ""]).join(
    "\n"
  );
}

const USAGE = `usage: node scripts/measure-layout.mjs <corpusDir> [options]

  <corpusDir>        a directory whose children are the repositories to measure
  --only <a,b>       measure these repositories rather than every child
  --md <path>        write the table and the rendered sections here
  --force            write over the --md path if a file is already there
  --facts <dir>      write each repository's facts record under here
`;

const VALUE_OPTIONS = ["--md", "--facts", "--only"];

export function parseArgs(argv) {
  const opts = { corpus: null, md: null, facts: null, only: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      opts.force = true;
      continue;
    }
    if (VALUE_OPTIONS.includes(arg)) {
      // Last on the line it read past the end, and `--only` reading undefined
      // measured all thirty-five rather than the one repository asked for.
      if (i + 1 >= argv.length) return { error: `${arg} needs a value after it` };
      opts[arg.slice(2)] = argv[++i];
      continue;
    }
    if (arg.startsWith("-")) return { error: `unknown option: ${arg}` };
    opts.corpus = arg;
  }
  if (opts.corpus === null) return { error: "the corpus directory is required" };
  return opts;
}

/**
 * The repositories this run measures, or the names `--only` asked for that the
 * corpus does not hold.
 *
 * The rule the e2e harness got first: a typo selected nothing and printed
 * `0 of 0 repositories passed`, which is exit 0 and reads as an acceptance of a
 * corpus this run never opened.
 */
export function selectRepos(names, only) {
  if (only === null) return { repos: names };
  const wanted = only.split(",");
  const missing = wanted.filter((name) => !names.includes(name));
  if (missing.length) {
    return { error: `--only ${only}: the corpus holds no repository named ${missing.join(", ")}` };
  }
  return { repos: names.filter((name) => wanted.includes(name)) };
}

/**
 * Whether the run may write where `--md` points.
 *
 * The target is written whole, and what usually sits there is a run of record
 * somebody merged into a document by hand. `--force` is how a rerun says it
 * meant that file.
 */
export function checkOutput(path, force, exists) {
  if (path === null || force || !exists) return null;
  return `${path} is already there, and this run writes its --md target whole; pass --force to write over it`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}\n\n${USAGE}`);
    process.exit(2);
  }
  const corpusDir = resolve(opts.corpus);
  // Before anything is measured: an hour of scanning that ends in a refusal to
  // write is an hour nobody gets back.
  const md = opts.md === null ? null : resolve(opts.md);
  const refused = checkOutput(md, opts.force, md !== null && existsSync(md));
  if (refused) {
    console.error(`${refused}\n\n${USAGE}`);
    process.exit(2);
  }

  const children = readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(corpusDir, e.name, ".git")))
    .map((e) => e.name)
    .sort();
  const selected = selectRepos(children, opts.only);
  if (selected.error) {
    console.error(`${selected.error}\n\n${USAGE}`);
    process.exit(2);
  }
  const repos = selected.repos;

  const rows = [];
  const sections = [];
  const learned = new Map(LEARNED_ROWS.map((key) => [key, []]));
  const failures = [];

  for (const name of repos) {
    try {
      const out = await measure(name, join(corpusDir, name));
      rows.push(out.row);
      sections.push(out);
      for (const [key, lines] of out.learned) learned.get(key).push(...lines);
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
  console.log("");
  console.log(learnedTables([...learned]));

  if (md) {
    const body = [
      tableOf(rows),
      "",
      learnedTables([...learned]),
      ...sections.flatMap((s) => [`## ${s.name}`, "", "```", s.section ?? "(no section)", "```", ""]),
    ];
    writeFileSync(md, body.join("\n"));
  }

  if (failures.length) {
    console.error(`\n${failures.length} of ${repos.length} repositories failed:`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.error(`\n${rows.length} of ${repos.length} repositories passed`);
}

// Guarded, because the tests import the bar's table builders from here and an
// unguarded run would scan a corpus instead of asserting.
if (invokedAs(import.meta.url)) {
  await main();
}
