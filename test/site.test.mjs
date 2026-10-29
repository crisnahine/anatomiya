import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSite, fencedBlocks, fillPage, moduleClosure, resultRows } from "../scripts/site.mjs";
import { ANATOMIYA, ROOT } from "../scripts/plugins.mjs";
import { removeTree } from "./platform.mjs";

const README = readFileSync(join(ROOT, "README.md"), "utf8");
const TEMPLATE = readFileSync(join(ROOT, "site", "index.html"), "utf8");
const INDEX = { schema: 1, count: 1, files: [["lib/a.mjs", 0, [["alpha", "fn", 1, null, "()", "The first letter.", 0]]]] };
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-site-"));
  t.after(() => removeTree(dir));
  return dir;
}

test("a fenced block is read under its own heading, and a hash line inside one is the block's", () => {
  const text = [
    "# Top", "", "```markdown", "## A", "```", "",
    "## A", "", "```text", "one", "# not a heading", "```", "", "### Deeper", "", "~~~diff", "+two", "~~~", "",
    "## B", "", "````", "three", "```", "````",
  ].join("\n");

  assert.deepEqual(fencedBlocks(text, "A"), [
    { lang: "text", body: "one\n# not a heading" },
    { lang: "diff", body: "+two" },
  ]);
  assert.deepEqual(fencedBlocks(text, "B"), [{ lang: "", body: "three\n```" }]);
  assert.deepEqual(fencedBlocks(text, "Missing"), []);
});

test("the results chart is the README's own reuse tables, and they add up to what its prose states", () => {
  // The page's totals are summed from the rows, so the sentence the README leads with is held to its table.
  const { models, rows } = resultRows(README);
  const cells = rows.flatMap((row) => row.counts);
  const sum = (arm) => cells.reduce((total, c) => total + c[arm], 0);
  const stated = README.match(/(\d+)\s+of\s+(\d+)\s+sessions\s+called\s+the\s+function\s+that\s+was\s+already\s+there\.\s+Without\s+it,\s+(\d+)\s+of\s+(\d+)\s+did/);
  const changed = README.match(/Of\s+the\s+(\d+)\s+task\s+and\s+model\s+pairs[^.]*?anatomiya\s+changed\s+the\s+result\s+in\s+(\d+)/);

  assert.equal(models.length, 2);
  assert.ok(rows.every((row) => row.counts.length === models.length), "a row has a count for each model");
  assert.ok(stated, "the README no longer states its totals in the sentence this reads");
  assert.ok(changed, "the README no longer states how many pairs changed in the sentence this reads");
  assert.equal(sum("with"), Number(stated[1]));
  assert.equal(sum("without"), Number(stated[3]));
  assert.equal(cells.length * 20, Number(stated[2]));
  assert.equal(cells.length, Number(changed[1]));
  assert.equal(cells.filter((c) => c.significant).length, Number(changed[2]));
});

test("the find demo loads the plugin's own modules, and only node:path from outside them, which the page maps", () => {
  const { files, outside } = moduleClosure("lib/find.mjs");
  const map = JSON.parse(TEMPLATE.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? "null");
  const stand = readFileSync(join(ROOT, "site", map?.imports?.["node:path"] ?? "missing"), "utf8");
  const asked = new Set(
    files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:path["']/g)])
      .flatMap((m) => m[1].split(",").map((entry) => entry.trim().split(/\s+as\s+/)[0]))
      .filter(Boolean)
  );

  assert.ok(files.length > 1, "find.mjs is read with what it imports");
  assert.deepEqual(outside, ["node:path"]);
  assert.deepEqual(Object.keys(map.imports), outside);
  assert.ok(asked.size > 0, "no name was read off an import of node:path");
  for (const name of asked) assert.match(stand, new RegExp(`export const ${name}\\b`), `the stand-in does not offer ${name}`);
});

test("a placeholder nothing fills is refused, and braces a block holds are left as they are", () => {
  const read = () => "## H\n\n```\n{{kept}} <tag>\n```\n";

  assert.throws(() => fillPage("{{nope}}", {}, read), /\{\{nope\}\}/);
  assert.throws(() => fillPage('{{block X.md "H" 1}}', {}, read), /no fenced block 1/);
  assert.equal(fillPage('<code>{{block X.md "H" 0}}</code> {{a}}', { a: "b" }, read), "<code>{{kept}} &#60;tag&#62;</code> b");
});

test("a build writes the page filled in, the find modules byte for byte, and every local file the page names", (t) => {
  const out = join(scratch(t), "site");
  const built = buildSite({ out, index: INDEX, commit: COMMIT });
  const page = readFileSync(join(out, "index.html"), "utf8");
  const local = [...page.matchAll(/\b(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)].map((m) => m[1]);

  assert.doesNotMatch(page, /\{\{/);
  assert.match(page, new RegExp(`data-commit="${COMMIT}"`));
  assert.ok(built.modules.includes("find.mjs"));
  for (const name of built.modules) assert.deepEqual(readFileSync(join(out, "lib", name)), readFileSync(join(ANATOMIYA, "lib", name)), name);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "data", "index.json"), "utf8")), INDEX);
  assert.ok(local.length >= 3, `read only ${local.length} local paths`);
  for (const rel of [...local, "node-path.js", "social-preview.png"]) assert.ok(existsSync(join(out, rel)), rel);

  // A second build replaces the first, which it wrote.
  buildSite({ out, index: { ...INDEX, count: 2 }, commit: COMMIT });
  assert.equal(JSON.parse(readFileSync(join(out, "data", "index.json"), "utf8")).count, 2);
});

test("a build leaves alone a directory it did not write", (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, "keep.txt"), "mine");

  assert.throws(() => buildSite({ out: dir, index: INDEX, commit: COMMIT }), /was not written by this script/);
  assert.equal(readFileSync(join(dir, "keep.txt"), "utf8"), "mine");
});

test("the page loads no script or style from another origin", () => {
  const foreign = [...TEMPLATE.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(https?:[^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !url.startsWith("https://crisnahine.github.io/anatomiya/"));

  assert.deepEqual(foreign, []);
});
