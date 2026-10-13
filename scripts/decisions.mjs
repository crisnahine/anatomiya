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

/** Where the row files live, one per row, named by the row's id. */
export const DECISIONS_DIR = "docs/decisions";

/** A row's line, in the index and in the one table alike, and the header line that tells the two apart. */
const ROW = /^\| ([A-H]\d+) \|/;
const INDEX_HEAD = "| # | Decision | Status | File |";
const TABLE_HEAD = "| # | Decision | Why | Status |";

/** A line's cells as written. A `|` inside a cell is written `\|`, so a bare one is always a cell's edge. */
const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1);

/**
 * Every row the index holds, in order: its id, the section heading above
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

/**
 * What the index says of a Status: `done` where it opens with `**done**`,
 * `partial` where it opens with `partial`, `todo` where it opens with `todo`,
 * and null where it opens with none of the three.
 */
export function shortStatus(status) {
  const opens = /^(?:\*\*(done)\*\*|(partial|todo)\b)/.exec(status);
  return opens ? (opens[1] ?? opens[2]) : null;
}

const HEADINGS = ["## Decision", "## Why", "## Status"];

/**
 * A row file's id, its section and the text under its three headings, or null where the text is not one.
 *
 * Each heading's text comes back on one line, as a table's cell holds it: the Why and the Status
 * are written a sentence per line so a search answers with a sentence, and a
 * line break inside a paragraph is a space to Markdown as well.
 *
 * A byte order mark and the whitespace at a line's end are dropped, and so is
 * the whitespace a line under a heading opens with, since a fault in a character nobody
 * can see is a report nobody can act on. A line ends at a CR, an LF or the
 * pair. A heading written twice is refused: the second would read as the text
 * under the first.
 */
export function readRowFile(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/).map((line) => line.trimEnd());
  const id = /^# ([A-H]\d+)$/.exec(lines[0])?.[1];
  const at = HEADINGS.map((heading) => lines.indexOf(heading));
  if (!id || at[0] < 0 || at[0] > at[1] || at[1] > at[2]) return null;
  if (HEADINGS.some((heading, i) => lines.includes(heading, at[i] + 1))) return null;
  const between = (from, to) => lines.slice(from + 1, to).filter((line) => line !== "");
  const head = between(0, at[0]);
  const section = /^Section: (.+)$/.exec(head[0])?.[1];
  if (!section || head.length !== 1) return null;
  const [decision, why, status] = [...at, lines.length].slice(1).map((to, i) => between(at[i], to).map((line) => line.trimStart()).join(" "));
  return { id, section, decision, why, status };
}

/** A cell's text as a table row has to spell it. */
export const escaped = (text) => text.replaceAll("|", "\\|");

// An empty cell is spelled `| |`, and every other is padded by a space each side.
const cell = (text) => (text === "" ? " " : ` ${escaped(text)} `);

/**
 * The record as one table, a whole row on each line: the index line for line,
 * with each row's cells read from its file. `files` is row id to file
 * text. Throws on a row whose file is missing or is not a row file, since a
 * table with a hole in it is not the record.
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

/** The row files under a checkout, row id to text. */
export function rowFiles(root) {
  const dir = join(root, DECISIONS_DIR);
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(join(dir, f), "utf8")]));
}

if (invokedAs(import.meta.url)) process.stdout.write(rebuild(readFileSync(join(ROOT, "DECISIONS.md"), "utf8"), rowFiles(ROOT)));
