/**
 * The code index: every definition the scan read, with where it is, what it
 * takes, the sentence that documents it and how many other files import it,
 * kept beside the map and asked by `anatomiya find`.
 *
 * Written by the scan; `index-home.mjs` reads it back and `find.mjs` ranks what
 * it lists, so a session asks it when it is about to write a function, which is
 * the moment a grep over the whole repository costs the most turns.
 */
import { gzipSync } from "node:zlib";

import { isTestFile } from "./test-shape.mjs";
import { byCode } from "./paths.mjs";
import { creditOf, reuseIndex } from "./siblings.mjs";
import { INDEX_MOST, INDEX_SCHEMA, indexPath, UNZIPPED_MOST } from "./index-home.mjs";
import { atomic, quietUnlink } from "./store.mjs";


/**
 * The index over a scan's `files` and their records: `{ schema, count, files: [[rel, test, symbols]] }`,
 * each symbol `symbols.mjs`'s shape with its importer count last. A file of a
 * language in `unread`, which this scan had no engine for, keeps its rows from `previous`.
 */
export function buildIndex(files, records, corpusRels, own = null, { previous = null, unread = [] } = {}) {
  const byFile = reuseIndex(records, corpusRels, own);
  const kept = new Map(unread.length > 0 ? (previous?.files ?? []).map((row) => [row[0], row]) : []);
  const out = [];
  let count = 0;
  for (const { rel, lang } of files) {
    const record = records.get(rel);
    const symbols = record?.facets?.symbols;
    // Its importer counts are the last scan's until a scan with the engine reads the file again.
    if (!record?.ok && unread.includes(lang) && kept.has(rel)) {
      out.push(kept.get(rel));
      count += kept.get(rel)[2].length;
      continue;
    }
    if (!record?.ok || !symbols?.length) continue;
    const importers = creditOf(symbols, byFile.get(rel), rel).files.map((files) => files.size);
    const test = isTestFile({ rel, lang, facets: record.facets }) ? 1 : 0;
    // Two definitions on one line both see the comment above it, and it documents the first.
    out.push([rel, test, symbols.map(([name, kind, line, container, params, doc], i) => {
      const [, , above, , , aboveDoc] = symbols[i - 1] ?? [];
      return [name, kind, line, container, params, i > 0 && line === above && doc === aboveDoc ? null : doc, importers[i]];
    })]);
    count += symbols.length;
  }
  out.sort((a, b) => byCode(a[0], b[0]));
  return { schema: INDEX_SCHEMA, count, files: out };
}

/** Write the index into the map's store; one that cannot be written leaves no index, not the last one. */
export function saveIndex(root, index) {
  const path = indexPath(root);
  if (path === null) return false;
  try {
    const text = JSON.stringify(index);
    // Past what `readIndex` takes, zipped or unzipped, a written index would read as none forever.
    const tooLarge = () => new RangeError("the code index is past what find reads");
    if (Buffer.byteLength(text) > UNZIPPED_MOST) throw tooLarge();
    const body = gzipSync(text);
    if (body.length > INDEX_MOST) throw tooLarge();
    atomic(path, body);
    return true;
  } catch (err) {
    // An index too large for one string keeps none, as a full disk does; anything else is a bug here.
    if (!(err instanceof RangeError) && (typeof err?.code !== "string" || err.code.startsWith("ERR_"))) throw err;
    // The one there was an older scan's, and `find` would answer from it as the last.
    quietUnlink(path);
    return false;
  }
}
