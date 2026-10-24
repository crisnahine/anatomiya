import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, scratch } from "./git-worktrees.mjs";
import {
  addedRanges, branchChange, pendingPaths, renamesSkipped, unquotePath,
} from "../plugins/anatomiya/lib/changeset.mjs";

function repo(t) {
  const dir = scratch(t, "anatomiya-changeset-");
  git(dir, "init", "-q");
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  return { dir, write, git: (...a) => git(dir, ...a) };
}

test("the pending paths name every kind of uncommitted work the way the check reads it", async (t) => {
  const { dir, write, git } = repo(t);
  write("src/edited.ts", "export const a = 1\n");
  write("src/old.ts", "export const moved = 1\n");
  write("src/gone.ts", "export const gone = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");

  write("src/edited.ts", "export const a = 2\n");
  write("src/staged.ts", "export const s = 1\n");
  git("add", "src/staged.ts");
  write("src/intent.ts", "export const i = 1\n");
  git("add", "-N", "src/intent.ts");
  git("mv", "src/old.ts", "src/moved.ts");
  rmSync(join(dir, "src/gone.ts"));

  const pending = await pendingPaths(dir);

  const byPath = (a, b) => (a.path < b.path ? -1 : 1);
  assert.deepEqual(pending.present.sort(byPath), [
    { path: "src/edited.ts", status: "M", from: "src/edited.ts" },
    // `add -N` writes its letter in the tree column, and it is still an addition.
    { path: "src/intent.ts", status: "A", from: null },
    { path: "src/moved.ts", status: "M", from: "src/old.ts" },
    { path: "src/staged.ts", status: "A", from: null },
  ]);
  assert.deepEqual(pending.deleted.sort(), ["src/gone.ts", "src/old.ts"], "a move leaves its old path");
  assert.deepEqual(pending.removed, ["src/gone.ts"], "and a move is no deletion in the report");
});

test("the added ranges are read per hunk, one range per run of added lines", async (t) => {
  const { dir, write, git } = repo(t);
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  write("a.ts", `${lines.join("\n")}\n`);
  git("add", "-A");
  git("commit", "-qm", "init");
  lines[1] = "changed 2";
  lines.splice(8, 0, "new 9", "new 10");
  write("a.ts", `${lines.join("\n")}\n`);
  git("commit", "-qam", "two hunks");

  const ranges = await addedRanges(dir, "HEAD~1");

  assert.deepEqual([...ranges], [["a.ts", [[2, 2], [9, 10]]]]);
});

test("a name git quotes is read back as the path it names", () => {
  assert.equal(unquotePath("\"a\\\"b\\303\\251.ts\""), "a\"bé.ts");
  assert.equal(unquotePath("plain.ts"), "plain.ts");
});

const sha = (git, ref = "HEAD") => git("rev-parse", ref).toString().trim();
const byPath = (a, b) => (a.path < b.path ? -1 : 1);

test("a branch's change set: the committed diff, the tree's work folded in, and what it took away", async (t) => {
  const { dir, write, git } = repo(t);
  write("src/edited.ts", "export const a = 1\n");
  write("src/gone.ts", "export const gone = 1\n");
  write("src/old.ts", "export const moved = 1\n".repeat(5));
  write("src/kept.ts", "export const kept = 1\n".repeat(5));
  write("src/untouched.ts", "export const u = 1\n");
  write("README.md", "# a\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const from = sha(git);
  write("src/edited.ts", "export const a = 2\n");
  write("src/added.ts", "export const added = 1\n".repeat(5));
  write("src/schema.ts", "// @generated\nexport const s = 1\n");
  git("rm", "-q", "src/gone.ts");
  git("mv", "src/old.ts", "src/new.ts");
  write("README.md", "# b\n");
  write("src/kept.ts", "export const kept = 2\n".repeat(5));
  git("add", "-A");
  git("commit", "-qm", "change");
  // The tree's own work: the rename edited again, the added file moved, the
  // committed edit moved, an edit to a file the branch never changed.
  write("src/new.ts", "export const moved = 2\n".repeat(5));
  git("mv", "src/added.ts", "src/moved.ts");
  git("mv", "src/kept.ts", "src/there.ts");
  write("src/untouched.ts", "export const u = 2\n");

  const change = await branchChange(dir, { from, head: sha(git), mergeBase: from, compare: true });

  assert.equal(change.readable, true);
  assert.deepEqual(change.rows.map((r) => r.path).sort(), ["README.md", "src/added.ts", "src/edited.ts", "src/gone.ts", "src/kept.ts", "src/new.ts", "src/schema.ts"]);
  assert.deepEqual(change.examined.sort(byPath), [
    { status: "M", path: "src/edited.ts", from: "src/edited.ts" },
    // A file the branch added and then moved is still an addition.
    { status: "A", path: "src/moved.ts", from: null, tree: true },
    // A committed rename edited again keeps the base path the diff found.
    { status: "R", path: "src/new.ts", from: "src/old.ts", tree: true },
    // A committed edit then moved reads its base from where the merge base held it.
    { status: "M", path: "src/there.ts", from: "src/kept.ts", tree: true },
    { status: "M", path: "src/untouched.ts", from: "src/untouched.ts", tree: true },
  ], "the generated file and the prose stay out");
  assert.deepEqual(change.removed, ["src/gone.ts"]);
  assert.deepEqual([...change.lost].sort(), ["src/added.ts", "src/gone.ts", "src/kept.ts", "src/old.ts"]);
  assert.equal(change.listed, true);
  assert.equal(change.unjudged, 0);
  assert.equal(change.renamesSkipped, false);
  assert.equal(change.added, null, "ranges only where asked");
});

test("a pending addition the merge base holds reads its base from there, and a pending deletion stays only where HEAD holds the path", async (t) => {
  const { dir, write, git } = repo(t);
  write("src/a.ts", "export const a = 1\n");
  write("src/b.ts", "export const b = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const base = sha(git);
  git("rm", "-q", "src/a.ts");
  git("commit", "-qm", "drop a");
  // Back in the tree, it is an addition to HEAD of a path the merge base holds.
  write("src/a.ts", "export const a = 2\n");
  // An addition deleted again in the tree never reached HEAD.
  write("src/never.ts", "export const n = 1\n");
  git("add", "src/never.ts");
  rmSync(join(dir, "src/never.ts"));
  rmSync(join(dir, "src/b.ts"));

  const change = await branchChange(dir, { from: base, head: sha(git), mergeBase: base, compare: true });

  assert.deepEqual(change.examined, [{ status: "A", path: "src/a.ts", from: "src/a.ts", tree: true }]);
  assert.deepEqual(change.pending.deleted, ["src/b.ts"]);
  assert.deepEqual(change.pending.removed, ["src/b.ts"]);
});

test("with no base to compare against, the tree's work is unjudged and the ranges are read where asked", async (t) => {
  const { dir, write, git } = repo(t);
  write("a.ts", "line 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  write("a.ts", "line 1\nline 2\n");
  git("commit", "-qam", "more");
  write("b.ts", "export const b = 1\n");

  const change = await branchChange(dir, { from: sha(git, "HEAD~1"), head: sha(git), mergeBase: null, compare: false, ranges: true });

  assert.equal(change.unjudged, 1);
  assert.deepEqual(change.pending.present, [], "nothing pending is judged without a base");
  assert.deepEqual([...change.added], [["a.ts", [[2, 2]]]]);
});

test("a diff git refused is no empty branch, and a nothing to compare from is no diff", async (t) => {
  const { dir, write, git } = repo(t);
  write("a.ts", "export const a = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");

  const refused = await branchChange(dir, { from: "f".repeat(40), head: sha(git), mergeBase: null, compare: false });
  assert.deepEqual([refused.readable, refused.rows], [false, []]);
  const none = await branchChange(dir, { from: null, head: sha(git), mergeBase: null, compare: false });
  assert.deepEqual([none.readable, none.rows, none.examined], [true, [], []]);
});

test("git skips inexact rename pairing past its limit, which the rows it answered with are enough to tell", () => {
  const rows = (adds, dels) => [
    ...Array.from({ length: adds }, (_, i) => ({ status: "A", path: `n${i}.ts`, from: null })),
    ...Array.from({ length: dels }, (_, i) => ({ status: "D", path: `o${i}.ts`, from: `o${i}.ts` })),
    { status: "R", path: "r.ts", from: "q.ts" },
  ];
  assert.equal(renamesSkipped(rows(2, 2), 1), true);
  assert.equal(renamesSkipped(rows(1, 1), 1), false);
  assert.equal(renamesSkipped(rows(5, 0), 1), false, "nothing deleted is nothing to pair");
});
