import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, scratch } from "./git-worktrees.mjs";
import {
  addedRanges, changedFiles, onlyInHead, pendingPaths, unquotePath, withPendingEdits,
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

test("the pending edits fold into the diff rows the way the check reads each case", () => {
  const cases = [
    {
      name: "a committed rename edited again keeps the base path the diff found",
      rows: [{ status: "R", path: "src/new.ts", from: "src/old.ts" }],
      pending: { present: [{ path: "src/new.ts", status: "M", from: "src/new.ts" }], deleted: [] },
      want: [{ status: "R", path: "src/new.ts", from: "src/old.ts", tree: true }],
    },
    {
      name: "a file the branch added and then moved is still an addition",
      rows: [{ status: "A", path: "src/added.ts", from: null }],
      pending: { present: [{ path: "src/moved.ts", status: "M", from: "src/added.ts" }], deleted: ["src/added.ts"] },
      want: [{ status: "A", path: "src/moved.ts", from: null, tree: true }],
    },
    {
      name: "a committed edit then moved reads its base from where the merge base held it",
      rows: [{ status: "M", path: "src/kept.ts", from: "src/kept.ts" }],
      pending: { present: [{ path: "src/there.ts", status: "M", from: "src/kept.ts" }], deleted: ["src/kept.ts"] },
      want: [{ status: "M", path: "src/there.ts", from: "src/kept.ts", tree: true }],
    },
    {
      name: "an addition deleted again in the tree leaves",
      rows: [{ status: "A", path: "src/gone.ts", from: null }, { status: "M", path: "src/stays.ts", from: "src/stays.ts" }],
      pending: { present: [], deleted: ["src/gone.ts"] },
      want: [{ status: "M", path: "src/stays.ts", from: "src/stays.ts" }],
    },
    {
      name: "an edit to a file the branch never changed is a row of its own",
      rows: [],
      pending: { present: [{ path: "src/untouched.ts", status: "M", from: "src/untouched.ts" }], deleted: [] },
      want: [{ status: "M", path: "src/untouched.ts", from: "src/untouched.ts", tree: true }],
    },
  ];
  for (const { name, rows, pending, want } of cases) {
    assert.deepEqual(withPendingEdits(rows, pending), want, name);
  }
});

test("a pending deletion stays only where HEAD holds the path", async (t) => {
  const { dir, write, git } = repo(t);
  write("src/a.ts", "export const a = 1\n");
  write("src/b.ts", "export const b = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");

  const pending = { present: [], deleted: ["src/a.ts", "src/never.ts"], removed: ["src/b.ts", "src/never.ts"] };
  const held = await onlyInHead(dir, pending);

  assert.deepEqual([held.deleted, held.removed], [["src/a.ts"], ["src/b.ts"]]);
  assert.deepEqual(pending.deleted, ["src/a.ts", "src/never.ts"], "the caller's lists are left as they were");
});

test("the committed diff names each change with the path its base is read from", async (t) => {
  const { dir, write, git } = repo(t);
  write("src/edited.ts", "export const a = 1\n");
  write("src/gone.ts", "export const gone = 1\n");
  write("src/old.ts", "export const moved = 1\n".repeat(5));
  git("add", "-A");
  git("commit", "-qm", "init");
  const from = git("rev-parse", "HEAD").toString().trim();
  write("src/edited.ts", "export const a = 2\n");
  write("src/added.ts", "export const added = 1\n");
  git("rm", "-q", "src/gone.ts");
  git("mv", "src/old.ts", "src/new.ts");
  git("add", "-A");
  git("commit", "-qm", "change");

  const diff = await changedFiles(dir, from);

  const byPath = (a, b) => (a.path < b.path ? -1 : 1);
  assert.equal(diff.ok, true);
  assert.deepEqual(diff.rows.sort(byPath), [
    { status: "A", path: "src/added.ts", from: null },
    { status: "M", path: "src/edited.ts", from: "src/edited.ts" },
    { status: "D", path: "src/gone.ts", from: "src/gone.ts" },
    { status: "R", path: "src/new.ts", from: "src/old.ts" },
  ]);
  assert.deepEqual(await changedFiles(dir, "f".repeat(40)), { ok: false, rows: [] }, "a diff git refused is no empty branch");
});
