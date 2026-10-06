import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, scratch } from "./git-worktrees.mjs";
import { addedRanges, pendingPaths, unquotePath } from "../plugins/anatomiya/lib/changeset.mjs";

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
