#!/usr/bin/env node
/**
 * Splits the one-table decision record into the index and a file per row, and
 * writes neither unless the two rebuild the table byte for byte.
 *
 * usage: node scripts/split-decisions.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DECISIONS_DIR, INDEX_HEAD, ROW, TABLE_HEAD, cellsOf, rebuild, shortStatus } from "./decisions.mjs";
import { invokedAs } from "./entry.mjs";
import { ROOT } from "./plugins.mjs";

// The space after a sentence's end, and a code span whole so a full stop inside one breaks nothing.
const BREAK = /`[^`]*`|(?<=[.?!][)"'*`]{0,2}) (?=[A-Z`"'(*[\d])/g;
const sentences = (cell) => cell.replace(BREAK, (found) => (found === " " ? "\n" : found));
const under = (heading, body) => (body === "" ? `${heading}\n\n` : `${heading}\n\n${body}\n\n`);

/** The index and the row files a one-table record splits into. Proves nothing: `convert` does. */
export function split(original) {
  if (!original.includes(TABLE_HEAD)) throw new Error("DECISIONS.md holds no table of four-cell rows to split");
  const files = new Map();
  let section = null;
  const index = original.split("\n").map((line) => {
    section = /^## (.+)$/.exec(line)?.[1] ?? section;
    if (line === TABLE_HEAD) return INDEX_HEAD;
    const id = ROW.exec(line)?.[1];
    if (!id) return line;
    const cells = cellsOf(line);
    if (cells.length !== 4) throw new Error(`row ${id} has ${cells.length} cells, not 4`);
    const [decision, why, status] = cells.slice(1).map((cell) => cell.trim().replaceAll("\\|", "|"));
    files.set(id, `# ${id}\n\nSection: ${section}\n\n${under("## Decision", decision)}${under("## Why", sentences(why))}## Status\n\n${sentences(status)}\n`);
    return `| ${id} |${cells[1]}| ${shortStatus(status)} | [${id}](${DECISIONS_DIR}/${id}.md) |`;
  });
  return { index: index.join("\n"), files };
}

/** Writes the split under a checkout and answers the proof's line, or throws with nothing written. */
export function convert(root) {
  const path = join(root, "DECISIONS.md");
  const original = readFileSync(path, "utf8");
  const { index, files } = split(original);
  const was = original.split("\n");
  const stray = rebuild(index, files).split("\n").findIndex((line, i) => line !== was[i]);
  if (stray !== -1) throw new Error(`row ${ROW.exec(was[stray])?.[1]} does not rebuild to the line it was (line ${stray + 1}), so nothing was written`);
  mkdirSync(join(root, DECISIONS_DIR), { recursive: true });
  for (const [id, text] of files) writeFileSync(join(root, DECISIONS_DIR, `${id}.md`), text);
  writeFileSync(path, index);
  return `${files.size} rows, ${Buffer.byteLength(original)} bytes: the index and the row files rebuild DECISIONS.md identical, byte for byte`;
}

if (invokedAs(import.meta.url)) {
  try {
    console.log(convert(ROOT));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
