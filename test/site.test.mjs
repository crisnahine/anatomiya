import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildSite, fencedBlocks, fillPage, moduleClosure, resultRows } from "../scripts/site.mjs";
import { ANATOMIYA, ROOT } from "../scripts/plugins.mjs";
import { removeTree } from "./platform.mjs";

const README = readFileSync(join(ROOT, "README.md"), "utf8");
const USAGE = readFileSync(join(ROOT, "docs", "usage.md"), "utf8");
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

test("a second reuse table naming its models in another order is refused", () => {
  const table = (head) => [`| Task | What was checked | ${head} |`, "|---|---|---|---|", "| a: one | calls `x` | **20 / 0** | 20 / 19 |"];
  const readme = ["", "## The whole test, ties included", "", ...table("Opus 5.5 with / without | Haiku 5.5 with / without"), "", ...table("Haiku 5.5 with / without | Opus 5.5 with / without"), "", "Where the habit could be seen", ""].join("\n");

  assert.throws(() => resultRows(readme), /two orders/);
});

test("every number the page types is one the README or the usage guide states, and Plate 1's lines are the usage guide's", () => {
  // The examples, the chart and the counts are filled in at build time; this holds the numbers written into the prose.
  const sources = `${README}\n${USAGE}`;
  const text = TEMPLATE
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/<i aria-hidden="true">\d+<\/i>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, " ");
  const numbers = [...new Set(text.match(/\d+(?:[.,]\d+)*/g))];
  const plate = [...TEMPLATE.matchAll(/<span class="row[^"]*">(.*?)<\/span>/g)].map((m) =>
    m[1].replace(/<i aria-hidden="true">\d+<\/i>/g, "").replace(/<[^>]+>/g, "")
  );

  assert.ok(numbers.length > 20, `read only ${numbers.length} numbers off the page`);
  assert.deepEqual(numbers.filter((n) => !sources.includes(n)), []);
  assert.equal(plate.length, 8);
  assert.deepEqual(plate.filter((line) => !USAGE.includes(line)), []);
});

test("the find demo loads the plugin's own modules, and only node:path from outside them, which the page maps", () => {
  const { files, outside } = moduleClosure("lib/find.mjs");
  const map = JSON.parse(TEMPLATE.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? "null");
  const stand = readFileSync(join(ROOT, "site", map?.imports?.["node:path"] ?? "missing"), "utf8");
  const clauses = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/import\s+([^;]*?)\s+from\s*["']node:path["']/g)].map((m) => m[1].trim()));
  const asked = new Set(clauses.flatMap((clause) => clause.replace(/[{}]/g, "").split(",").map((entry) => entry.trim().split(/\s+as\s+/)[0])).filter(Boolean));

  assert.ok(files.length > 1, "find.mjs is read with what it imports");
  assert.deepEqual(outside, ["node:path"]);
  assert.deepEqual(Object.keys(map.imports), outside);
  assert.ok(clauses.length > 0, "no import of node:path was read");
  // A default or namespace import links against exports the stand-in does not have.
  assert.deepEqual(clauses.filter((clause) => !clause.startsWith("{")), []);
  for (const name of asked) assert.match(stand, new RegExp(`export const ${name}\\b`), `the stand-in does not offer ${name}`);
});

test("the modules the find demo loads name no global a browser lacks", () => {
  const { files } = moduleClosure("lib/find.mjs");
  const uses = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (!/^\s*(?:\/\/|\*|\/\*)/.test(line) && /\b(?:process|Buffer)\s*\.|\brequire\s*\(|\b__(?:dirname|filename)\b/.test(line) ? [`${basename(file)}:${i + 1}`] : []))
  );

  assert.deepEqual(uses, []);
});

test("a placeholder nothing fills is refused, braces a block holds are left as they are, and a diff's lines are marked", () => {
  const read = () => "## H\n\n```\n{{kept}} <tag>\n```\n\n```diff\n-gone\n+added\n same\n```\n";

  assert.throws(() => fillPage("{{nope}}", {}, read), /\{\{nope\}\}/);
  assert.throws(() => fillPage('{{block X.md "H" 2}}', {}, read), /no fenced block 2/);
  assert.equal(fillPage('<code>{{block X.md "H" 0}}</code> {{a}}', { a: "b" }, read), "<code>{{kept}} &#60;tag&#62;</code> b");
  assert.equal(fillPage('{{block X.md "H" 1}}', {}, read), '<span class="del">-gone</span>\n<span class="add">+added</span>\n same');
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
  for (const rel of [...local, "node-path.mjs", "social-preview.png"]) assert.ok(existsSync(join(out, rel)), rel);

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
