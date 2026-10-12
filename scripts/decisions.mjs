#!/usr/bin/env node
/**
 * The decision record's two halves, read: the index `DECISIONS.md` keeps and
 * the file each row's full text lives in.
 *
 * One place, because the docs gate holds the halves to each other and a second
 * reading of either format is a second answer to what a row says.
 *
 * usage: node scripts/decisions.mjs   (prints the record as one table, a row per line)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { invokedAs } from "./entry.mjs";
import { ROOT } from "./plugins.mjs";

/** Where the row files live, one per row, named by the row's number. */
export const DECISIONS_DIR = "docs/decisions";

/** A row's line, in the index and in the one table alike, and the header line that tells the two apart. */
export const ROW = /^\| ([A-H]\d+) \|/;
export const INDEX_HEAD = "| # | Decision | Status | File |";
export const TABLE_HEAD = "| # | Decision | Why | Status |";

/** A line's cells as written. A `|` inside a cell is written `\|`, so a bare one is always a cell's edge. */
export const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1);

/**
 * Every row the index holds, in order: its number, the section heading above
 * it, its Decision cell as written (escapes and all), its short status, the
 * file its last cell links to, how many cells it has, and its line.
 */
export function indexRows(text) {
  const rows = [];
  let section = null;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    section = /^## (.+)$/.exec(line)?.[1] ?? section;
    const id = ROW.exec(line)?.[1];
    if (!id) continue;
    const cells = cellsOf(line).map((cell) => cell.trim());
    const file = /^\[[^\]]*\]\(([^)]+)\)$/.exec(cells[3] ?? "")?.[1] ?? null;
    rows.push({ id, section, decision: cells[1] ?? "", status: cells[2] ?? "", file, cells: cells.length, line: i + 1 });
  }
  return rows;
}

/** What the index says of a Status cell: `done`, or the word the cell opens with before its first colon. */
export const shortStatus = (status) => (status.startsWith("**done**") ? "done" : status.split(":")[0]);

const HEADINGS = ["## Decision", "## Why", "## Status"];

/**
 * A row file's number, section and three cells, or null where the text is not one.
 *
 * Each cell comes back on one line, as a table holds it: the Why is written a
 * sentence per line so a search answers with a sentence, and a line break inside
 * a paragraph is a space to Markdown as well.
 */
export function readRowFile(text) {
  const lines = text.split(/\r?\n/);
  const id = /^# ([A-H]\d+)$/.exec(lines[0])?.[1];
  const at = HEADINGS.map((heading) => lines.indexOf(heading));
  if (!id || at[0] < 0 || at[0] > at[1] || at[1] > at[2]) return null;
  const between = (from, to) => lines.slice(from + 1, to).filter((line) => line.trim() !== "");
  const head = between(0, at[0]);
  const section = /^Section: (.+)$/.exec(head[0])?.[1];
  if (!section || head.length !== 1) return null;
  const [decision, why, status] = [...at, lines.length].slice(1).map((to, i) => between(at[i], to).join(" "));
  return { id, section, decision, why, status };
}

/** A cell's text as a table row has to spell it. */
export const escaped = (text) => text.replaceAll("|", "\\|");

// The one empty cell the record has is spelled `| |`, and every other is padded by a space each side.
const cell = (text) => (text === "" ? " " : ` ${escaped(text)} `);

/**
 * The record as the one table it was before the split: the index line for
 * line, with each row's cells read from its file. `files` is row number to
 * file text. Throws on a row whose file is missing or is not a row file, since
 * a table with a hole in it is not the record.
 */
export function rebuild(index, files) {
  return index
    .split("\n")
    .map((line) => {
      const cr = line.endsWith("\r") ? "\r" : "";
      if (line === INDEX_HEAD + cr) return TABLE_HEAD + cr;
      const id = ROW.exec(line)?.[1];
      if (!id) return line;
      const row = readRowFile(files.get(id) ?? "");
      if (!row) throw new Error(`row ${id} has no file to read its cells from`);
      return `| ${id} |${[row.decision, row.why, row.status].map(cell).join("|")}|${cr}`;
    })
    .join("\n");
}

/** The row files under a checkout, row number to text. */
export function rowFiles(root) {
  const dir = join(root, DECISIONS_DIR);
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(join(dir, f), "utf8")]));
}

if (invokedAs(import.meta.url)) process.stdout.write(rebuild(readFileSync(join(ROOT, "DECISIONS.md"), "utf8"), rowFiles(ROOT)));
