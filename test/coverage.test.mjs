import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FLOORS, SUMMARY, SUMMARY_FLAG, parseLcov, shortfalls } from "../scripts/coverage.mjs";
import { REL } from "../scripts/plugins.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/coverage.mjs", import.meta.url));

/** One lcov record, spelled the way node's reporter spells one. */
const record = (file, { lf = 100, lh = 100, brf = 100, brh = 100, fnf = 10, fnh = 10 } = {}) =>
  [`TN:`, `SF:${file}`, `LF:${lf}`, `LH:${lh}`, `BRF:${brf}`, `BRH:${brh}`, `FNF:${fnf}`, `FNH:${fnh}`, `end_of_record`].join("\n");

test("a report reads back as one row per file, with a found and a hit per kind", () => {
  const rows = parseLcov(`${record("lib/a.mjs", { lf: 10, lh: 9 })}\n${record("lib/b.mjs", { brf: 4, brh: 1 })}`);

  assert.deepEqual(rows.map((row) => row.file), ["lib/a.mjs", "lib/b.mjs"]);
  assert.equal(rows[0].lines.found, 10);
  assert.equal(rows[0].lines.hit, 9);
  assert.equal(rows[1].branches.hit, 1);
});

test("a file with nothing of a kind in it is not a file that fails on that kind", () => {
  // A module with no branch at all reports zero found, and zero of zero is not
  // a shortfall: it is a file the question does not apply to.
  const rows = parseLcov(record("lib/flat.mjs", { brf: 0, brh: 0 }));

  assert.deepEqual(shortfalls(rows, { scope: "s", include: "lib/**", whole: {}, file: { branches: 90 } }), []);
});

test("the aggregate is counted over the scope, not averaged over its files", () => {
  // A thousand covered lines beside ten bare ones is 99.01% counted and 50%
  // averaged. Which of the two a floor reads decides whether one small file
  // with no tests at all can fail a scope, and the counted answer is the one
  // node's own floors use.
  const rows = parseLcov(`${record("lib/big.mjs", { lf: 1000, lh: 1000 })}\n${record("lib/small.mjs", { lf: 10, lh: 0 })}`);

  assert.deepEqual(shortfalls(rows, { scope: "s", include: "lib/**", whole: { lines: 99 }, file: {} }), []);
  assert.deepEqual(shortfalls(rows, { scope: "s", include: "lib/**", whole: { lines: 99.5 }, file: {} }), [
    "s: 99.01% of lines, under the 99.5% this holds the whole scope to",
  ]);
});

test("a file under its own floor is named, whatever the total says", () => {
  // The failure this exists for: the total clears the floor and one file is far
  // under it, which is what an aggregate cannot see.
  const rows = parseLcov(`${record("lib/big.mjs", { brf: 1000, brh: 1000 })}\n${record("lib/thin.mjs", { brf: 100, brh: 50 })}`);
  const floor = { scope: "s", include: "lib/**", whole: { branches: 90 }, file: { branches: 90 } };

  assert.deepEqual(shortfalls(rows, floor), ["lib/thin.mjs: 50% of branches, under the 90% this holds every file to"]);
});

test("a file outside the scope is not held to it", () => {
  const rows = parseLcov(`${record("lib/in.mjs", { lf: 10, lh: 1 })}\n${record("other/out.mjs", { lf: 10, lh: 1 })}`);

  assert.deepEqual(
    shortfalls(rows, { scope: "s", include: "lib/**", whole: {}, file: { lines: 50 } }),
    ["lib/in.mjs: 10% of lines, under the 50% this holds every file to"],
  );
});

test("a scope that matched no file at all is a report that measured nothing", () => {
  // A floor over an empty set passes by construction, which is how a renamed
  // directory turns a gate into a no-op.
  const rows = parseLcov(record("lib/a.mjs"));

  assert.deepEqual(shortfalls(rows, { scope: "second", include: "elsewhere/**", whole: {}, file: {} }), [
    "second: the report holds no file under elsewhere/**, so nothing was measured",
  ]);
});

test("a scope that measured nothing says so rather than reporting it as perfect", (t) => {
  // `share` counts a kind nothing was found of as satisfied, which is right for
  // a file with no branches in it and wrong for a scope with no files: printing
  // the summary on a failing run put "100% lines, 100% branches" at the top of
  // the report for a scope whose own shortfall, two lines below, says nothing
  // was measured at all.
  const { lines } = measured(t, 'import { test } from "node:test";\ntest("t", () => {});\n');
  const empty = lines.filter((line) => line.includes("0 files"));

  assert.ok(empty.length > 0, `no scope came out empty:\n${lines.join("\n")}`);
  for (const line of empty) {
    assert.doesNotMatch(line, /100%/, `a scope with no files in it reported a share: ${line}`);
  }
});

test("a file a scope names as excepted is not held to that scope's per-file floor", () => {
  // A floor set under the worst file in a scope binds nothing. What CI cannot
  // reach is named instead, so the floor can sit where it actually catches
  // something and the exception is a line somebody has to write rather than a
  // number quietly lowered.
  const rows = parseLcov([record("lib/a.mjs", { lh: 10 }), record("lib/b.mjs", { lh: 10 })].join("\n"));
  const floor = { scope: "lib", include: "lib/**", whole: {}, file: { lines: 80 }, except: ["lib/b.mjs"] };

  assert.deepEqual(shortfalls(rows, floor), [
    "lib/a.mjs: 10% of lines, under the 80% this holds every file to",
  ]);
});

test("an exception naming a file the scope does not hold is a stale exception", () => {
  // An excepted path that has gone, or was renamed, silently widens the floor
  // it was written to narrow.
  const rows = parseLcov(record("lib/a.mjs"));
  const floor = { scope: "lib", include: "lib/**", whole: {}, file: { lines: 80 }, except: ["lib/gone.mjs"] };

  assert.deepEqual(shortfalls(rows, floor), [
    "lib: lib/gone.mjs is excepted from the per-file floor and the report holds no such file",
  ]);
});

test("a report row from outside the tree is not part of the whole tree", () => {
  // `**` matched every path the reporter wrote, and it writes a relative one
  // for a spec run from anywhere, so a file above the root counted toward the
  // scope named for the tree.
  const rows = parseLcov([record("lib/a.mjs"), record("../elsewhere/x.mjs", { lh: 0 })].join("\n"));

  assert.deepEqual(shortfalls(rows, { scope: "the whole tree", include: "**", whole: { lines: 95 }, file: {} }), []);
});

test("this repository's own floors are the measured ones", () => {
  // Pinned rather than described: a test that only asks whether a number is
  // there passes with every number set to zero, which is a gate that enforces
  // nothing and a file that says it does.
  assert.deepEqual(FLOORS, [
    {
      scope: "the whole tree",
      include: "**",
      whole: { lines: 95, branches: 87, functions: 95 },
      file: {},
    },
    {
      scope: "ultracode-anywhere",
      include: `${REL.ultracode}/**`,
      whole: { lines: 95, branches: 87, functions: 97 },
      file: { lines: 92, branches: 75, functions: 90 },
    },
    {
      // Named for the plugin as well as the directory: the scope name is
      // printed into the job summary beside `ultracode-anywhere`, where a bare
      // `lib` names nothing a reader of that summary can go and look at.
      scope: "anatomiya lib",
      include: `${REL.anatomiya}/lib/**`,
      whole: {},
      file: { lines: 80, branches: 65, functions: 80 },
      except: [`${REL.anatomiya}/lib/dimensions-semantic.mjs`],
    },
  ]);
});


// --- what the job reads off a run --------------------------------------------

/** `coverage.mjs` as CI runs it, over one throwaway test file. */
function measured(t, body, options = []) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-coverage-run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spec = join(dir, "one.test.mjs");
  writeFileSync(spec, body);

  // Bounded: this spawns a runner that spawns a runner, and `node --test` has
  // no per-case timeout, so a child that never finishes takes the whole file
  // with nothing printed, the passing cases included.
  const run = spawnSync(process.execPath, [SCRIPT, ...options, spec], { encoding: "utf8", timeout: 120_000 });
  return { ...run, lines: run.stdout.split("\n").filter((line) => line.startsWith(SUMMARY)) };
}

test("every scope is stated on a run that misses a floor, not only on one that clears it", (t) => {
  // The job pipes this to a file and puts the summary in front of whoever broke
  // the build. Printing the scopes only on the way out of a clean run left that
  // summary empty on exactly the runs it exists for. The throwaway suite loads
  // one file of two of the scopes and exercises none of it, so those two are
  // missed on a percentage rather than on an empty report; the third says it
  // measured nothing, which is the other half of the same summary.
  const loads = [fileURLToPath(new URL("../scripts/entry.mjs", import.meta.url)),
                 fileURLToPath(new URL("../plugins/ultracode-anywhere/hooks/hook-io.mjs", import.meta.url))];
  const { status, lines, stderr } = measured(
    t,
    `import { test } from "node:test";\n${loads.map((at) => `import ${JSON.stringify(at)};`).join("\n")}\ntest("t", () => {});\n`,
  );

  assert.notEqual(status, 0, "a run that loads two files and calls neither cannot be clearing the floors");
  assert.equal(lines.length, FLOORS.length, `stated ${lines.length} of ${FLOORS.length} scopes`);
  for (const floor of FLOORS) {
    assert.ok(lines.some((line) => line.includes(floor.scope)), `${floor.scope} went unstated`);
  }
  assert.match(stderr, /under the \d+% this holds/, "and the shortfall is still said");
});

test("a suite that fails is a suite failure, and no floor is claimed off it", (t) => {
  // The record a failing run writes is missing whatever the failing test would
  // have reached, so reading floors off it reports shortfalls that are the
  // failure and not the coverage.
  const { status, lines, stdout } = measured(
    t,
    'import { test } from "node:test";\ntest("t", () => { throw new Error("boom"); });\n',
  );

  assert.notEqual(status, 0);
  assert.deepEqual(lines, [], "a floor was read off a suite that did not finish");
  assert.match(stdout, /boom/, "and the test failure itself is what the reader sees");
});

test("the job asks for its summary by the flag this module takes", () => {
  // One fact in two files, and the workflow's half is run by no suite. A
  // pattern there went quietly empty the moment a scope was renamed here, and
  // matched any line a test printed at column zero; a file the script is asked
  // to write is one thing, named once on each side.
  const workflow = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");
  const measure = workflow.match(/- name: Measure and enforce\n(?:.*\n)*?          (node scripts\/coverage\.mjs[^\n]*)/);
  const summarise = workflow.match(/- name: Summarise\n(?:.*\n)*?              (cat "\$RUNNER_TEMP\/[^"]+")/);

  assert.ok(measure, "the coverage job no longer runs this script");
  assert.ok(measure[1].includes(`${SUMMARY_FLAG} `), `the job asks for no summary: ${measure[1]}`);
  assert.ok(summarise, "the coverage job asks for a summary and reads it back from somewhere else");
  const [, asked] = measure[1].match(new RegExp(`${SUMMARY_FLAG} ("[^"]+")`)) ?? [];
  assert.ok(summarise[1].includes(asked), `written to ${asked}, read from ${summarise[1]}`);
});

test("a run writes the summary where it was asked to, shortfalls and all", (t) => {
  // The job prints this file and nothing else, so a shortfall that only ever
  // reached stderr was invisible to the reader it was written for.
  const at = join(mkdtempSync(join(tmpdir(), "anatomiya-coverage-said-")), "cov.txt");
  t.after(() => rmSync(join(at, ".."), { recursive: true, force: true }));
  const loads = fileURLToPath(new URL("../scripts/entry.mjs", import.meta.url));
  const { status } = measured(t, `import { test } from "node:test";\nimport ${JSON.stringify(loads)};\ntest("t", () => {});\n`, [
    SUMMARY_FLAG,
    at,
  ]);

  assert.notEqual(status, 0);
  const said = readFileSync(at, "utf8");
  for (const floor of FLOORS) assert.ok(said.includes(`${floor.scope}:`), `${floor.scope} is not in the summary`);
  assert.match(said, /under the \d+% this holds/, "the shortfall itself never reached the file the job prints");
});


test("a single-dash typo is not a path the summary is written to", (t) => {
  // The guard knew two dashes. `-x` was taken as the path, and the file the
  // reader meant was never written while a dash-named one appeared beside it.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-coverage-dash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const run = spawnSync(process.execPath, [SCRIPT, SUMMARY_FLAG, "-x", "one.test.mjs"], { cwd: dir, encoding: "utf8", timeout: 60_000 });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /needs a path/);
  assert.equal(existsSync(join(dir, "-x")), false, "a dash-named file was written anyway");
});
