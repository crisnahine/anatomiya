import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHead } from "../plugins/anatomiya/lib/contained.mjs";
import { removeTree } from "./platform.mjs";

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-contained-"));
  t.after(() => removeTree(dir));
  return dir;
}

const put = (dir, rel, text) => writeFileSync(join(dir, rel), text);

test("a whole read takes a file of exactly the bound it is given, and only the size of one a byte past it", (t) => {
  const dir = workspace(t);
  put(dir, "four", "abcd");
  put(dir, "five", "abcde");
  assert.equal(readHead(join(dir, "four"), 4, { whole: true }).head, "abcd");
  const over = readHead(join(dir, "five"), 4, { whole: true });
  assert.deepEqual([over.head, over.size], [null, 5]);
});
