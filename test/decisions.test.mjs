import { test } from "node:test";
import assert from "node:assert/strict";

import { indexRows, readRowFile, rebuild, shortStatus } from "../scripts/decisions.mjs";

const B2 = [
  "# B2",
  "",
  "Section: B. Engine",
  "",
  "## Decision",
  "",
  "An `a || b` chain is one site.",
  "",
  "## Why",
  "",
  "The first sentence.",
  "The second, with `x | y` in it.",
  "",
  "## Status",
  "",
  "**done** `walk.mjs` (`a`).",
  "Guarded by `walk.test.mjs`.",
  "",
].join("\n");

const B2_READ = {
  id: "B2",
  section: "B. Engine",
  decision: "An `a || b` chain is one site.",
  why: "The first sentence. The second, with `x | y` in it.",
  status: "**done** `walk.mjs` (`a`). Guarded by `walk.test.mjs`.",
};

test("a row file reads to its id, its section and the text under its three headings, each on one line", () => {
  assert.deepEqual(readRowFile(B2), B2_READ);
});

test("a row file with nothing under Why reads an empty cell, and one checked out with CRLF reads the same", () => {
  const empty = B2.replace("The first sentence.\nThe second, with `x | y` in it.\n\n", "");

  assert.equal(readRowFile(empty).why, "");
  assert.deepEqual(readRowFile(B2.replaceAll("\n", "\r\n")), B2_READ);
});

test("a row file reads as what it looks like: a space at a line's end and a byte order mark are not text", () => {
  assert.deepEqual(readRowFile(B2.replace("# B2", "# B2 ")), B2_READ);
  assert.deepEqual(readRowFile(B2.replace("## Why", "## Why\t")), B2_READ);
  assert.deepEqual(readRowFile(B2.replace("Section: B. Engine", "Section: B. Engine  ")), B2_READ);
  assert.deepEqual(readRowFile(B2.replace("one site.", "one site. ").replace("The first sentence.", "The first sentence. ")), B2_READ);
  assert.deepEqual(readRowFile(`\uFEFF${B2}`), B2_READ);
});

test("a space or a byte order mark at the start of a cell's line is not text either", () => {
  assert.deepEqual(readRowFile(B2.replace("An `a || b`", " An `a || b`")), B2_READ);
  assert.deepEqual(readRowFile(B2.replace("The second,", "\t The second,")), B2_READ);
  assert.deepEqual(readRowFile(B2.replace("Guarded by", "\uFEFFGuarded by")), B2_READ);
  assert.equal(readRowFile(B2.replace("## Why", " ## Why")), null, "an indented heading is still not one");
});

test("a row file whose lines end with a bare carriage return reads the same", () => {
  assert.deepEqual(readRowFile(B2.replaceAll("\n", "\r")), B2_READ);
});

test("a file missing a heading, or carrying them out of order, is no row file", () => {
  assert.equal(readRowFile(B2.replace("## Why", "## Reason")), null);
  assert.equal(readRowFile(B2.replace("## Why", "## Status").replace(/## Status(?![\s\S]*## Status)/, "## Why")), null);
  assert.equal(readRowFile(B2.replace("Section: B. Engine\n", "")), null);
  assert.equal(readRowFile(""), null);
});

test("a file holding one of the three headings twice is no row file", () => {
  assert.equal(readRowFile(`${B2}\n## Status\n\ntodo\n`), null);
  assert.equal(readRowFile(B2.replace("one site.", "one site.\n## Why\nand more.")), null);
  assert.equal(readRowFile(B2.replace("## Decision", "## Decision\n\n## Decision")), null);
});

test("a file with two Section lines, or headed by no row id, is no row file", () => {
  assert.equal(readRowFile(B2.replace("Section: B. Engine", "Section: B. Engine\nSection: B. Engine")), null);
  assert.equal(readRowFile(B2.replace("# B2", "# Engine")), null);
});

test("the short status is the one of the three openings a Status has, and nothing where it has none", () => {
  assert.equal(shortStatus("**done** `walk.mjs`"), "done");
  assert.equal(shortStatus("partial: the scan path only, in `scan.mjs`"), "partial");
  assert.equal(shortStatus("todo"), "todo");
  assert.equal(shortStatus("see https://example.com: nothing here yet"), null);
  assert.equal(shortStatus("done `walk.mjs`"), null);
  assert.equal(shortStatus("partially there"), null);
  assert.equal(shortStatus(""), null);
});

const B1 = "# B1\n\nSection: B. Engine\n\n## Decision\n\nOne.\n\n## Why\n\n## Status\n\npartial: half of it\n";

const INDEX = [
  "# contract",
  "",
  "## B. Engine",
  "",
  "| # | Decision | Status | File |",
  "|---|---|---|---|",
  "| B1 | One. | partial | [B1](docs/decisions/B1.md) |",
  "",
  "| B2 | An `a \\|\\| b` chain is one site. | done | [B2](docs/decisions/B2.md) |",
  "",
  "## What is not built",
  "",
  "- nothing",
  "",
].join("\n");

const TABLE = [
  "# contract",
  "",
  "## B. Engine",
  "",
  "| # | Decision | Why | Status |",
  "|---|---|---|---|",
  "| B1 | One. | | partial: half of it |",
  "",
  "| B2 | An `a \\|\\| b` chain is one site. | The first sentence. The second, with `x \\| y` in it. | **done** `walk.mjs` (`a`). Guarded by `walk.test.mjs`. |",
  "",
  "## What is not built",
  "",
  "- nothing",
  "",
].join("\n");

test("an index row reads to its id, the section it sits under, its decision as written, its short status and its file", () => {
  const read = [
    { id: "B1", section: "B. Engine", decision: "One.", status: "partial", file: "docs/decisions/B1.md", cells: 4, line: 7 },
    { id: "B2", section: "B. Engine", decision: "An `a \\|\\| b` chain is one site.", status: "done", file: "docs/decisions/B2.md", cells: 4, line: 9 },
  ];
  assert.deepEqual(indexRows(INDEX), read);
  assert.deepEqual(indexRows(INDEX.replaceAll("\n", "\r\n")), read, "and a CRLF checkout reads the same");
});

test("an index row whose last cell is no link names no file, and one split by a bare pipe counts the cells it has", () => {
  assert.equal(indexRows(INDEX.replace("[B1](docs/decisions/B1.md)", "B1.md"))[0].file, null);
  assert.equal(indexRows(INDEX.replace("| One. |", "| One `a || b`. |"))[0].cells, 6);
});

test("the index and the row files rebuild the record as one table, every other line as it was", () => {
  const files = new Map([["B1", B1], ["B2", B2]]);

  assert.equal(rebuild(INDEX, files), TABLE);
  const crlf = (text) => text.replaceAll("\n", "\r\n");
  assert.equal(rebuild(crlf(INDEX), new Map([["B1", crlf(B1)], ["B2", crlf(B2)]])), crlf(TABLE));
});

test("a row with no file to read its cells from stops the rebuild, and names the row", () => {
  assert.throws(() => rebuild(INDEX, new Map([["B1", B1]])), /row B2 has no file/);
  assert.throws(() => rebuild(INDEX, new Map([["B1", B1], ["B2", "not a row file"]])), /row B2 has no file/);
});
