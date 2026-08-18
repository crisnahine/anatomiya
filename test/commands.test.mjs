import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { runCheck, runPin, runScan } from "../lib/commands.mjs";
import { PIN_PATH } from "../lib/baseline.mjs";

const RULES = join(".claude", "rules");

/** A committed repository with one area's worth of source in it. */
function repo(t, files = 8) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < files; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `const a${i} = 1\nexport { a${i} }\n`);
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

/** A branch off the base with one added file, which is what a check examines. */
function repoWithBranch(t) {
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("branch", "-M", "main");
  git("checkout", "-q", "-b", "feat");
  writeFileSync(join(dir, "src", "f8.ts"), "export function h() { try { go() } catch (e) { } }\n");
  git("add", "-A");
  git("commit", "-qm", "add");
  return dir;
}

test("a dry-run scan plans the whole map and puts none of it on disk", async (t) => {
  const dir = repo(t);

  const { plan, summary } = await runScan(dir, { dryRun: true });

  assert.equal(summary.wrote, plan.write.length);
  assert.equal(summary.dryRun, true);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory");
});

test("a scan writes the files its summary counted", async (t) => {
  const dir = repo(t);

  const { summary } = await runScan(dir);

  assert.equal(summary.dryRun, false);
  assert.equal(readdirSync(join(dir, RULES)).length, summary.wrote);
  assert.ok(summary.wrote > 0, "a repository with an area writes a map");
});

test("a scan answers with the whole result, so the summary is not the only thing it derived", async (t) => {
  const dir = repo(t);

  const { result, summary } = await runScan(dir, { dryRun: true });

  assert.equal(summary.files, result.corpus.files);
  assert.equal(summary.areas, result.areas.length);
  assert.equal(summary.root, result.root);
});

test("a path inside the repository is widened to the root the scan reports", async (t) => {
  // `git rev-parse --show-toplevel` resolves any path inside a repository to
  // its root, so `scan ./packages/api` in a monorepo maps the monorepo.
  const dir = repo(t);

  const { summary } = await runScan(join(dir, "src"), { dryRun: true });

  assert.ok(existsSync(join(summary.root, "src", "f0.ts")), `not the repository that was scanned: ${summary.root}`);
  assert.ok(!existsSync(join(summary.root, "src", "src")), "the argument was widened to the root");
});

test("a scan of a directory that is not a repository refuses rather than reporting nothing", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(() => runScan(dir, { dryRun: true }), /not a git repository/);
});

test("a pin writes the baseline and answers with the delta it accepted", async (t) => {
  const dir = repo(t);

  const { summary, pin, previous, delta } = await runPin(dir);

  assert.ok(existsSync(join(dir, PIN_PATH)));
  assert.equal(previous, null, "nothing was pinned before");
  assert.equal(summary.delta, delta);
  assert.equal(delta.addedFiles, 8);
  assert.equal(delta.removedFiles, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).sha, pin.sha);
});

test("a dry-run pin writes nothing", async (t) => {
  const dir = repo(t);

  const { summary } = await runPin(dir, { dryRun: true });

  assert.equal(existsSync(join(dir, PIN_PATH)), false);
  assert.equal(summary.dryRun, true);
});

test("a second pin measures itself against the first", async (t) => {
  const dir = repo(t);
  await runPin(dir);
  writeFileSync(join(dir, "src", "f8.ts"), "export const b = 1\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "one more");

  const { summary, previous } = await runPin(dir);

  assert.ok(previous, "the pin already on disk was read");
  assert.equal(summary.previousSha, previous.sha);
  assert.equal(summary.delta.addedFiles, 1);
});

test("a repository with no commit cannot be pinned", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-fresh-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });

  await assert.rejects(() => runPin(dir), /no commit to pin/);
});

test("a check answers with a report the caller can count", async (t) => {
  const dir = repoWithBranch(t);
  await runScan(dir);

  const { report } = await runCheck(dir);

  assert.ok(report.counts, "the report carries its own tally");
  assert.equal(typeof report.counts.NIT, "number");
  assert.equal(typeof report.counts.FIX, "number");
});

test("a check reads the base it was given", async (t) => {
  const dir = repoWithBranch(t);
  await runScan(dir);

  const { report } = await runCheck(dir, { baseRef: "main" });

  assert.equal(report.base.ref, "main");
});
