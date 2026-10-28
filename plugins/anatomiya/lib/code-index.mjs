/**
 * The code index: every definition the scan read, with where it is, what it
 * takes, the sentence that documents it and how many other files import it,
 * kept beside the map and asked by `anatomiya find`.
 *
 * Written by the scan and read by nothing on a hook's path: a session asks it
 * when it is about to write a function, which is the moment a grep over the
 * whole repository costs the most turns.
 */
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { printableOnly } from "./encode.mjs";
import { isTestFile } from "./layout.mjs";
import { byCode } from "./paths.mjs";
import { INDEX_FILE, resolveInside, STORE_DIR } from "./rules.mjs";
import { reuseIndex } from "./siblings.mjs";
import { stemWords } from "./stems.mjs";
import { DOC_MOST, PARAMS_MOST, SYMBOL_KINDS } from "./symbols.mjs";
import { atomic, quietUnlink, READ_MOST, recordBytes } from "./store.mjs";

const INDEX_SCHEMA = 1;

// Past this a file is not the one this wrote, and is not read.
const INDEX_MOST = READ_MOST;
const UNZIPPED_MOST = 4 * INDEX_MOST;

// What a subagent reads in one call: twelve hits and one call per idea cost its search more tokens
// than no index at all, six and three calls cost a third less (A124).
const FIND_SHOWN = 6;

/** The parts of a qualified name an import or a call writes: `Role.find`, `Admin::Role`, `Role#find`. */
const partsOf = (name) => name.split(/::|[.#]/);

/**
 * How many files other than its own import or call each symbol of a file,
 * off the names `reuseIndex` resolved to it. A call written `Class.method`
 * credits the method of that class and the class; one qualified by a module or
 * a package, `db.GetEngine`, the file's own function of that name, or the one an
 * inline module of that name holds, `util::parse`; a bare name every symbol of that name.
 */
export function importersOf(symbols, byName, rel) {
  const importers = symbols.map(() => new Set());
  // Looked up by name: tried against every symbol, a file of thousands of definitions
  // read each name it is reached by thousands of times.
  const named = new Map();
  const classes = new Map();
  for (const [i, [name, kind]] of symbols.entries()) {
    if (!named.has(name)) named.set(name, []);
    named.get(name).push(i);
    if (kind === "class" || kind === "module" || kind === "type") {
      if (!classes.has(name)) classes.set(name, []);
      classes.get(name).push(i);
    }
  }
  const credit = (i, files) => {
    for (const file of files) if (file !== rel) importers[i].add(file);
  };
  for (const [name, files] of byName ?? []) {
    const parts = partsOf(name);
    const owner = parts.length > 1 ? parts.at(-2) : null;
    for (const i of named.get(parts.at(-1)) ?? []) {
      const container = symbols[i][3];
      if (owner === null || (classes.has(owner) ? owner === container : container === null || container === owner)) credit(i, files);
    }
    for (const part of new Set(parts)) for (const i of classes.get(part) ?? []) credit(i, files);
  }
  return importers.map((files) => files.size);
}

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
    const importers = importersOf(symbols, byFile.get(rel), rel);
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

/** Where the index of the repository at `root` lives, or null where its store is not inside it. */
function indexPath(root) {
  const dir = resolveInside(root, STORE_DIR);
  return dir === null ? null : join(dir, INDEX_FILE);
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

/** The index a scan of this repository wrote, or null where there is none this can read. */
export function readIndex(root) {
  const path = indexPath(root);
  if (path === null) return null;
  try {
    // Typed and read through one handle, a link refused, so the file read is the file checked.
    const bytes = recordBytes(path);
    if (!bytes) return null;
    const index = JSON.parse(gunzipSync(bytes, { maxOutputLength: UNZIPPED_MOST }).toString("utf8"));
    return index?.schema === INDEX_SCHEMA && Array.isArray(index.files) ? wellFormed(index.files) : null;
  } catch {
    return null;
  }
}

const KINDS = new Set(SYMBOL_KINDS);
// No name or path a scan reads runs this long; a committed index's text reaches a subagent's prompt, so it is held to what a scan writes.
const NAME_MOST = 200;
const PATH_MOST = 1024;
const textOf = (value, most) => typeof value === "string" && value.length <= most;
const textOrNull = (value, most) => value === null || textOf(value, most);
const isSymbol = (s) =>
  Array.isArray(s) &&
  s.length === 7 &&
  textOf(s[0], NAME_MOST) &&
  KINDS.has(s[1]) &&
  Number.isInteger(s[2]) &&
  textOrNull(s[3], NAME_MOST) &&
  textOrNull(s[4], PARAMS_MOST) &&
  textOrNull(s[5], DOC_MOST) &&
  Number.isInteger(s[6]);

/**
 * The rows of a read index that have the shape this writes, and the count of them: a copy a repository
 * committed is its own to write, and a row `find` cannot read whole is dropped rather than printed.
 */
function wellFormed(files) {
  const rows = files.flatMap((file) => {
    if (!Array.isArray(file) || !textOf(file[0], PATH_MOST) || (file[1] !== 0 && file[1] !== 1) || !Array.isArray(file[2])) return [];
    const symbols = file[2].filter(isSymbol);
    return symbols.length ? [[file[0], file[1], symbols]] : [];
  });
  return { schema: INDEX_SCHEMA, count: rows.reduce((n, [, , symbols]) => n + symbols.length, 0), files: rows };
}

// One word to a search however it ends: `urls` finds `compareUrl`, `indentation` finds `indent`.
const SUFFIXES = ["ations", "ation", "ings", "ing", "ers", "er", "ed", "es", "e", "s"];
function foldOnce(word) {
  // `properties` and `retried` are `property` and `retry`; a word ending in y keeps it, so `factory` is no `factor`.
  if (/[^aeiou]ie[sd]$/.test(word) && word.length >= 5) return `${word.slice(0, -3)}y`;
  for (const suffix of SUFFIXES) if (word.endsWith(suffix) && word.length - suffix.length >= 3 && !word.endsWith("ss")) return word.slice(0, -suffix.length);
  return word;
}
// Twice, so a word and its plural meet whichever ending each took: `statuses` and `status` both fold to `statu`.
const fold = (word) => foldOnce(foldOnce(word));
const wordsOf = (text) => (text ? stemWords(text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/ /g, "_")).map(fold) : []);
// A name is also its words run together, which is how a person types one: `unindent` finds `unIndent`.
const nameWords = (name) => [...wordsOf(name), fold(name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))];
const pathTerms = (rel) => wordsOf(rel.replace(/\.[^/.]+$/, "").replace(/\//g, " "));

// Words a sentence carries and no name means: in a doc they match nearly everything. Folded as a query word is.
const FILLER = new Set(["the", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "from", "at", "as", "is", "it", "this", "that", "its", "into"].map(fold));

/** The query's words, split as a name is, so `compareUrls`, `compare urls` and `compare_urls` ask the same; a letter alone or a filler word asks nothing. */
export const queryWords = (words) => [...new Set(words.flatMap(wordsOf).filter((word) => !/^\p{L}$/u.test(word) && !FILLER.has(word)))];

// What a repository already leans on is the helper to call: 4 importers weigh a match 1.35 times, 19 1.65, 252 2.2.
const reach = (importers) => 1 + 0.15 * Math.log2(1 + importers);

/**
 * Each asked word's weight: the rarer it is among the definitions, by every place a
 * match is scored, the more it says. A session asks in a sentence's words, and
 * unweighed, `new` or `id` in a hundred names buries `uuid` in one, and `the` in
 * every doc outweighs both.
 */
function weightsOf(index, asked) {
  const seen = new Map([...asked].map((w) => [w, 0]));
  let total = 0;
  for (const [, , symbols] of index.files) {
    for (const [name, , , container, , doc] of symbols) {
      total++;
      if (!mayHold(`${name} ${container ?? ""} ${doc ?? ""}`, asked)) continue;
      for (const w of new Set([...nameWords(name), ...wordsOf(container), ...wordsOf(doc)])) if (seen.has(w)) seen.set(w, seen.get(w) + 1);
    }
  }
  return new Map([...seen].map(([w, n]) => [w, Math.log(1 + total / (1 + n))]));
}

// Text holding none of the asked words cannot match one, since a folded word, less a `y` it took for
// `ies`, starts the word it came from; so it is passed over before it is split, most of a query's time.
const mayHold = (text, asked) => {
  const lower = text.toLowerCase();
  // With its separators taken out too, for the name run together.
  const joined = lower.replace(/[^\p{L}\p{N}]/gu, "");
  return asked.some((w) => {
    const start = w.endsWith("y") ? w.slice(0, -1) : w;
    return lower.includes(start) || joined.includes(start);
  });
};

/**
 * The definitions that best answer `words`: each asked word, by its weight, counts
 * in the best place it matches, three in the name, two in its class, one in its
 * doc sentence or its path, so a word said in three places is still one word. The
 * more files import a definition the more its match weighs, and a test's half as
 * much. A word only the path holds finds nothing. Ties go to the one more files
 * import, then by path and line.
 */
export function findSymbols(index, words) {
  const asked = queryWords(words);
  if (asked.length === 0) return [];
  const weight = weightsOf(index, asked);
  const hits = [];
  for (const [rel, test, symbols] of index.files) {
    let inPath = null;
    for (const [name, kind, line, container, params, doc, importers] of symbols) {
      if (!mayHold(`${name} ${container ?? ""} ${doc ?? ""}`, asked)) continue;
      const places = [[new Set(nameWords(name)), 3], [new Set(wordsOf(container)), 2], [new Set(wordsOf(doc)), 1]];
      let score = 0;
      let matched = false;
      inPath ??= new Set(pathTerms(rel));
      for (const w of asked) {
        const best = Math.max(...places.map(([set, at]) => (set.has(w) ? at : 0)));
        matched ||= best > 0;
        score += Math.max(best, inPath.has(w) ? 1 : 0) * weight.get(w);
      }
      // A test names what it tests, so it matches every word of the helper it covers; it ranks behind that helper.
      if (matched) hits.push({ name, kind, line, container, params, doc, importers, rel, test: test === 1, score: score * reach(importers) * (test === 1 ? 0.5 : 1) });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.importers - a.importers || byCode(a.rel, b.rel) || a.line - b.line)
    .slice(0, FIND_SHOWN)
    .map(printable);
}

// Each piece is the repository's own text, a comment's or a committed index's, and reaches a terminal, a
// transcript or a JSON reader: none may carry a control or a direction character.
const printable = (hit) => ({
  ...hit,
  ...Object.fromEntries(["name", "rel", "container", "params", "doc"].map((key) => [key, typeof hit[key] === "string" ? printableOnly(hit[key]) : hit[key]])),
});

/** One line per hit, as `find` prints it. */
export function formatHit(h) {
  const what = h.container ? `${h.kind} of ${h.container}` : h.kind;
  const importedBy = h.importers > 0 ? `, ${h.importers} ${h.importers === 1 ? "file imports" : "files import"} it` : "";
  return `${h.name}${h.params ?? ""}  ${h.rel}:${h.line}  ${what}${importedBy}${h.test ? ", in a test file" : ""}${h.doc ? `  - ${h.doc}` : ""}`;
}
