#!/usr/bin/env node
/**
 * The coverage floors, enforced per file where a scope is small enough to hold
 * every one of its files to a number.
 *
 * A floor over a whole scope cannot say anything about one file inside it. The
 * second plugin's `hook-io.mjs` measured 75.8% of branches against a floor of
 * 87, and the aggregate over the whole suite never showed it. Scoping that
 * aggregate to the plugin alone did not fix it: measured again there the file
 * was still under the same 87 and the scoped total still cleared, because what
 * an aggregate hides is proportional to how much larger the rest of its scope
 * is. Moving one down moves the problem rather than removing it.
 *
 * Measured on the whole tree when this floor was set, 13 of the 151 files then
 * counted sat under the whole-tree floor on their own while the total cleared,
 * and the largest module the plugin ships could have lost every covered line
 * unnoticed. So the plugin's own `lib` is held to a floor per file too.
 * The rest of the tree is not: the `--deep` tier runs only in the smoke job and
 * the harnesses under `scripts/` are run by hand, so `scripts/ab/run.mjs`
 * reports a third of its lines, and a floor low enough to admit that says
 * nothing about the rest.
 *
 * The numbers are measured rather than chosen, and sit under the worst run
 * observed rather than at it, which is what leaves room for one refactor.
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { invokedAs } from "./entry.mjs";
import { REL } from "./plugins.mjs";

/**
 * What each scope is held to.
 *
 * `whole` is counted over every file the scope matches; `file` is asked of each
 * of them on its own. A scope may carry either or both.
 */
export const FLOORS = [
  {
    // Everything measured, which is what the floors this replaces were counted
    // over: the plugin's own code, the scripts around it, and the suite itself.
    // Not one plugin's, and named for what it covers rather than for one of the
    // two things inside it.
    scope: "the whole tree",
    include: "**",
    // Measured at 98.4 line, 94.4 branch, 98.0 function over 171 files.
    whole: { lines: 95, branches: 87, functions: 95 },
    file: {},
  },
  {
    scope: "ultracode-anywhere",
    include: `${REL.ultracode}/**`,
    // Measured at 98.4 line, 89.7 branch, 99.1 function over the seven files.
    whole: { lines: 95, branches: 87, functions: 97 },
    // The worst single file is `counters.mjs` at 95.9 of lines on the run where
    // its sweep catch goes uncovered, and `hook-io.mjs` at 83.8 of branches and
    // 96.0 of functions. These sit a few points under each.
    file: { lines: 92, branches: 75, functions: 90 },
  },
  {
    // The shipped code, held to a floor each. The aggregate above says nothing
    // about one file inside it, and the size of that silence was measured: 13
    // of the 151 files counted then sat under the whole-tree floor on their
    // own, and the largest module the plugin ships could lose every covered
    // line with the total still clearing 95. This is the bound on how far any
    // one of them may fall.
    scope: "anatomiya lib",
    include: `${REL.anatomiya}/lib/**`,
    // The aggregate is the scope above; this row exists for the per-file floor.
    whole: {},
    // Measured at 99.0 line, 93.6 branch, 99.0 function over 54 files. The
    // worst single one CI can reach is `commands.mjs` at 84.9 of lines, 71.0 of
    // branches and 83.3 of functions, and these sit a few points under each.
    // The floor caught `tsconfig.mjs` at 71.4 of functions on the first run it
    // was enforced, which is what a floor that binds looks like.
    file: { lines: 80, branches: 65, functions: 80 },
    // Its walkers run only when a scan is asked for the semantic tier, and the
    // unit suite never asks: it reaches the module's exports and none of their
    // bodies, so the file measures 37% of lines and 0% of functions with
    // TypeScript installed and working. Named rather than accommodated on all
    // three kinds, because a floor low enough to admit 0% of functions would
    // admit every other file at 0% too. The tier itself is covered by the
    // smoke job, which runs `scan --deep` against a real repository.
    except: [`${REL.anatomiya}/lib/dimensions-semantic.mjs`],
  },
];

/** The three kinds a floor can name. */
const KINDS = ["lines", "branches", "functions"];

/** An lcov report as one row per file. */
export function parseLcov(text) {
  const rows = [];
  let row = null;
  const counts = { LF: ["lines", "found"], LH: ["lines", "hit"], BRF: ["branches", "found"], BRH: ["branches", "hit"], FNF: ["functions", "found"], FNH: ["functions", "hit"] };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      // Spelled with forward slashes whatever the platform: the reporter writes
      // `relative(cwd, file)`, which is backslash-separated on Windows, and a
      // scope that matched on a slash then matched none of its own files and
      // failed naming a directory that is there.
      row = { file: asPosix(line.slice(3).trim()), lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } };
      continue;
    }
    if (row === null) continue;
    if (line.trim() === "end_of_record") {
      rows.push(row);
      row = null;
      continue;
    }
    const at = line.indexOf(":");
    const named = counts[line.slice(0, at)];
    if (named) row[named[0]][named[1]] = Number(line.slice(at + 1));
  }
  return rows;
}

/** A path as this repository spells one, whatever the platform wrote. */
const asPosix = (path) => path.split(sep).join("/");

/**
 * Whether a repository-relative path is inside a scope.
 *
 * The two spellings a scope needs and no more: everything, or everything under
 * one directory. A glob library for two cases is a dependency this does not
 * need, and `parseLcov` has already put every path into one spelling.
 */
const inScope = (file, include) =>
  !file.startsWith("../") && (include === "**" || file.startsWith(include.replace(/\*\*$/, "")));

/** A percentage, with a kind nothing was found of counting as satisfied. */
const share = ({ found, hit }) => (found === 0 ? 100 : (100 * hit) / found);

/** One kind's share over a set of rows, counted rather than averaged. */
const shareOver = (rows, kind) =>
  share(rows.reduce((sum, row) => ({ found: sum.found + row[kind].found, hit: sum.hit + row[kind].hit }), { found: 0, hit: 0 }));

/**
 * What a summary line starts with.
 *
 * Kept for a reader watching a run go by, one line per scope. The job does not
 * read these: it asks for `--summary` and prints the file, because a pattern
 * over this output is a second copy of one fact and matches any line a test
 * prints at column zero.
 */
export const SUMMARY = "coverage ";

/** Where the caller asks for the same lines as a file, so nothing has to grep for them. */
export const SUMMARY_FLAG = "--summary";

/** Rounded the way a percentage reads, two places at most and no trailing zero. */
const shown = (value) => Number(value.toFixed(2));

/**
 * Every floor this report misses, as sentences.
 *
 * Returned rather than printed, for the reason the other gates here return
 * theirs: the cases are reports, and that is what puts them under test.
 */
export function shortfalls(rows, floor) {
  const problems = [];
  const inside = rows.filter((row) => inScope(row.file, floor.include));
  if (inside.length === 0) {
    return [`${floor.scope}: the report holds no file under ${floor.include}, so nothing was measured`];
  }

  for (const kind of KINDS) {
    const wanted = floor.whole[kind];
    if (wanted === undefined) continue;
    const counted = shareOver(inside, kind);
    if (counted < wanted) {
      problems.push(`${floor.scope}: ${shown(counted)}% of ${kind}, under the ${wanted}% this holds the whole scope to`);
    }
  }

  // Named rather than accommodated: a floor set under the worst file in a
  // scope binds nothing, and lowering one is invisible where a line naming a
  // file is not. An exception for a file the report does not hold is itself
  // reported, or a rename widens the floor with nothing saying so.
  const except = new Set(floor.except ?? []);
  for (const rel of except) {
    if (!inside.some((row) => row.file === rel)) {
      problems.push(`${floor.scope}: ${rel} is excepted from the per-file floor and the report holds no such file`);
    }
  }
  for (const kind of KINDS) {
    const wanted = floor.file[kind];
    if (wanted === undefined) continue;
    for (const row of inside) {
      if (except.has(row.file)) continue;
      if (share(row[kind]) < wanted) {
        problems.push(`${row.file}: ${shown(share(row[kind]))}% of ${kind}, under the ${wanted}% this holds every file to`);
      }
    }
  }

  return problems;
}

/**
 * Every line this run has to say, for a reader who was not watching it.
 *
 * Written to a file the caller names rather than picked out of stdout: the job
 * grepped the run's own output for a prefix, which is a second copy of one fact
 * and picks up any line a test happens to print at column zero.
 */
function summarise(at, lines) {
  if (at === null) return;
  try {
    writeFileSync(at, lines.map((line) => `${line}\n`).join(""));
  } catch (err) {
    console.error(`could not write the summary to ${at}: ${err.message}`);
  }
}

/**
 * The suite, the record it wrote, and the floors read off it. The status to
 * exit with.
 *
 * Answered rather than exited from, because `process.exit` does not run a
 * `finally` and the record is a megabyte: exiting from inside the run left one
 * behind on every failing run, which is every run somebody is working through.
 */
function measure(argv, root, report, summary) {
  // Both reporters at once: the spec output is what a person reads while it
  // runs, and the record is what the floors are read off. Running the suite
  // twice to get both is a minute of CI for one number.
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-test-coverage",
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `--test-reporter-destination=${report}`,
      // Resolved against the caller's own directory before the child is moved
      // to the repository root, so a path or a pattern still names what the
      // caller meant by it.
      ...argv.map((arg) => (arg.startsWith("-") ? arg : resolve(arg))),
    ],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      // A suite that hangs holds this and whatever spawned it. The CI job caps
      // at 30 minutes; this stops well inside that and says which run it was.
      timeout: 25 * 60 * 1000,
      // Node's runner marks its own children with this, and a child that sees
      // it reports over the parent's channel and ignores every `--test-reporter`
      // it was given. This module is a runner of its own, so a run started from
      // inside a suite wrote no record at all.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    },
  );
  if (run.status !== 0) return run.status ?? 1;

  const rows = parseLcov(readFileSync(report, "utf8"));
  const said = [];
  // Stated before the floors are read, because the job puts this summary in
  // front of whoever broke the build: printed on the way out of a clean run
  // only, it was empty on exactly the runs it exists for.
  for (const floor of FLOORS) {
    const inside = rows.filter((row) => inScope(row.file, floor.include));
    const of = (kind) => shown(shareOver(inside, kind));
    // A kind nothing was found of counts as satisfied, which is right for a
    // file with no branches and wrong for a scope with no files: the shares
    // would come out at 100 and head the report for a scope that measured
    // nothing at all.
    const line =
      inside.length === 0
        ? `0 files under ${floor.include}, so nothing was measured`
        : `${inside.length} files, ${of("lines")}% lines, ${of("branches")}% branches, ${of("functions")}% functions`;
    said.push(`${floor.scope}: ${line}`);
    console.log(`${SUMMARY}${floor.scope}: ${line}`);
  }

  const problems = FLOORS.flatMap((floor) => shortfalls(rows, floor));
  // The shortfall names the file, and the summary the job prints is the only
  // thing some readers see: an aggregate on its own is the shape this module
  // was written to argue against.
  summarise(summary, [...said, ...problems]);
  if (problems.length) {
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    for (const problem of problems) console.error(`${prefix}${problem}`);
    return 1;
  }
  return 0;
}

function main(argv) {
  // One option, taken out of the list before the rest goes to the runner. A
  // value that is another option is a typo, and writing the summary to a file
  // named `--x` is the failure this whole file exists to make visible.
  const at = argv.indexOf(SUMMARY_FLAG);
  let summary = null;
  if (at !== -1) {
    summary = argv[at + 1];
    // Any dash, not two: `-x` was taken as the path and the file the reader
    // meant was never written, while a dash-named one appeared beside it.
    if (!summary || summary.startsWith("-")) {
      console.error(`${SUMMARY_FLAG} needs a path`);
      process.exit(2);
    }
    argv = [...argv.slice(0, at), ...argv.slice(at + 2)];
  }

  // Resolved from here rather than from the caller's directory, the way the
  // gates beside this one resolve theirs: the reporter writes paths relative to
  // the child's own directory, so where the command was run from decided which
  // files a scope matched, and a scope that matched none of its own failed
  // naming a directory that is there.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-coverage-"));
  let code;
  try {
    code = measure(argv, root, join(dir, "lcov.info"), summary);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (code !== 0) process.exit(code);
}

if (invokedAs(import.meta.url)) main(process.argv.slice(2));
