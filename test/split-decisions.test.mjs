import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { convert, split } from "../scripts/split-decisions.mjs";
import { rebuild } from "../scripts/decisions.mjs";

const table = (...rows) => ["# contract", "", "## B. Engine", "", "| # | Decision | Why | Status |", "|---|---|---|---|", ...rows, "", "## Not built", "", "- nothing", ""].join("\n");

const TABLE = table(
  "| B1 | One. | | partial: half of it |",
  "",
  "| B2 | An `a \\|\\| b` chain is one site. | The first sentence. The second, with `x. Y \\| z` in it (see B1). \"Quoted.\" Then 3 of 4. | **done** `walk.mjs` (`a`). Guarded by `walk.test.mjs`. |"
);

test("a table splits into an index of short rows and one file per row, a sentence to a line", () => {
  const { index, files } = split(TABLE);

  assert.equal(
    index,
    [
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
      "## Not built",
      "",
      "- nothing",
      "",
    ].join("\n")
  );
  assert.deepEqual([...files.keys()], ["B1", "B2"]);
  assert.equal(files.get("B1"), "# B1\n\nSection: B. Engine\n\n## Decision\n\nOne.\n\n## Why\n\n## Status\n\npartial: half of it\n");
  assert.equal(
    files.get("B2"),
    [
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
      "The second, with `x. Y | z` in it (see B1).",
      "\"Quoted.\"",
      "Then 3 of 4.",
      "",
      "## Status",
      "",
      "**done** `walk.mjs` (`a`).",
      "Guarded by `walk.test.mjs`.",
      "",
    ].join("\n")
  );
  assert.equal(rebuild(index, files), TABLE);
});

test("a row the split cannot put back byte for byte is refused, and nothing is written", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-split-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // An empty Why spelled with two spaces: the file holds no cell to say which spelling it was.
  const twoSpaces = table("| B1 | One. | | **done** |", "| B2 | Two. |  | **done** |");
  writeFileSync(join(dir, "DECISIONS.md"), twoSpaces);

  assert.throws(() => convert(dir), /row B2 does not rebuild to the line it was/);
  assert.equal(readFileSync(join(dir, "DECISIONS.md"), "utf8"), twoSpaces);
  assert.equal(existsSync(join(dir, "docs")), false);
});

test("a row with a cell too many or too few is refused by name", () => {
  assert.throws(() => split(table("| B1 | One `a || b`. | why | **done** |")), /row B1 has 6 cells, not 4/);
});

test("a record that is already an index is refused, so a second run cannot split the index", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-split-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { index } = split(TABLE);
  writeFileSync(join(dir, "DECISIONS.md"), index);

  assert.throws(() => convert(dir), /holds no table of four-cell rows to split/);
  assert.equal(existsSync(join(dir, "docs")), false);
});

test("a record that rebuilds is written as the index and its files, and says how much it proved", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-split-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "DECISIONS.md"), TABLE);

  const proof = convert(dir);

  assert.equal(proof, `2 rows, ${Buffer.byteLength(TABLE)} bytes: the index and the row files rebuild DECISIONS.md identical, byte for byte`);
  assert.equal(readFileSync(join(dir, "DECISIONS.md"), "utf8"), split(TABLE).index);
  assert.equal(readFileSync(join(dir, "docs", "decisions", "B2.md"), "utf8"), split(TABLE).files.get("B2"));
});
