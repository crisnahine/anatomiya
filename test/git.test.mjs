import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { gitBuffered, parseNameStatusZ } from "../lib/git.mjs";

/**
 * One runner and one record grammar, because four copies of each had drifted:
 * the baseline's runner carried no timeout at all, and three hand-rolled state
 * machines read the same `--name-status -z` output three ways.
 */
function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { dir, git };
}

test("a rename is one record carrying both of its paths", () => {
  // Three NUL fields where everything else has two. Splitting on NUL and
  // pairing blindly reads the old path as a status and shifts every record
  // after it.
  const rows = parseNameStatusZ("R100\0src/old.ts\0src/new.ts\0M\0src/other.ts\0");

  assert.deepEqual(rows, [
    { status: "R100", from: "src/old.ts", to: "src/new.ts" },
    { status: "M", from: null, to: "src/other.ts" },
  ]);
});

test("a path holding a newline stays one record", () => {
  // Why the grammar is read on NUL and never on newlines: git permits a newline
  // inside a path, and a newline split turns one hostile filename into two.
  const rows = parseNameStatusZ("A\0src/two\nlines.ts\0");

  assert.deepEqual(rows, [{ status: "A", from: null, to: "src/two\nlines.ts" }]);
});

test("a truncated record is dropped rather than completed with a guess", () => {
  // A byte cap can cut the output mid-record. Emitting the half that arrived
  // would name a file the diff never reported.
  assert.deepEqual(parseNameStatusZ("M\0src/a.ts\0R100\0src/old.ts\0"), [
    { status: "M", from: null, to: "src/a.ts" },
  ]);
});

test("a call that outruns its timeout answers instead of hanging", async (t) => {
  // The baseline's runner passed no timeout, so a git that never returns took
  // the scan with it.
  //
  // `hash-object --stdin` blocks reading a stdin nothing writes to, so the
  // timeout is the only thing that can end it and no machine finishes it early.
  // A fast command with a tiny budget is not the same test: it raced, and the
  // CI runner won.
  const { dir } = repo(t);

  const r = await gitBuffered(dir, ["hash-object", "--stdin"], { timeout: 250 });

  assert.equal(r.ok, false, "a killed call is not a successful one");
  assert.equal(r.stdout, "", "and it reports no output it did not receive");
});

test("a non-zero exit is reported rather than read as an empty answer", async (t) => {
  // `git merge-base` exits 1 with empty stdout and no stderr when two commits
  // share no ancestor. A caller reading stdout alone passes "" on as a sha.
  const { dir, git } = repo(t);
  git("checkout", "-q", "--orphan", "other");
  writeFileSync(join(dir, "b.ts"), "export const b = 2\n");
  git("add", "-A");
  git("commit", "-qm", "unrelated");

  const r = await gitBuffered(dir, ["merge-base", "other", "main"]);

  assert.equal(r.ok, false);
  assert.notEqual(r.code, 0, "the exit code is what says so");
});
