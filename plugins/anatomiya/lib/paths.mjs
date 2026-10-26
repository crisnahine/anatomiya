import { posix, sep as hostSep, win32 } from "node:path";

/**
 * The slices of a repository-relative path every roster module takes.
 *
 * Kept here rather than three copies because they are read together: a rule
 * that matches on the basename and a rule that matches on the directory have to
 * agree on where one ends, and one copy drifting is a file counted twice.
 *
 * The slices are string slicing rather than `node:path`, since a corpus path
 * is always posix and `dirname` answers "." at the top level, which is a
 * directory name no repository has. `escapes` and `folded`, at the end, read a
 * host path and a volume's name comparison instead, and `escapeRe` writes a name
 * as a pattern that matches it alone.
 */

export const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

export const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

// `.d.ts`, `.d.mts` and `.d.cts` name a TypeScript declaration file: two dots
// spelling one extension, not a `.ts` file whose stem happens to end in `d`.
// Read by both halves of the split below, so neither can disagree about
// where the real extension starts.
const DECLARATION_EXTS = new Set(["ts", "mts", "cts"]);

const splitBase = (base) => {
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base, ext: null };
  const tail = base.slice(dot + 1);
  const before = base.lastIndexOf(".", dot - 1);
  if (before > 0 && DECLARATION_EXTS.has(tail) && base.slice(before + 1, dot) === "d") {
    return { stem: base.slice(0, before), ext: `d.${tail}` };
  }
  return { stem: base.slice(0, dot), ext: tail };
};

// Everything from the last dot of the name, or the label a file with none is
// counted under, which on Ruby is a Rakefile. A leading dot is the whole name
// of a dotfile rather than the start of an extension, so `.env` has none.
export const extOf = (rel) => {
  const { ext } = splitBase(baseOf(rel));
  return ext === null ? "(none)" : `.${ext}`;
};

/** What a sentence calls a file's kind: its extension, or its whole name where it has none. */
export const extOrName = (rel) => (extOf(rel).startsWith(".") ? extOf(rel) : baseOf(rel));

// The other half of that split: the name a namesake test is matched on.
export const stemOf = (rel) => splitBase(baseOf(rel)).stem;

// The whole path with that same extension removed. Reads the one split rather
// than counting dots itself: on `index.d.ts` a one-dot rule leaves `index.d`,
// which no longer ends in `/index`, and the sibling index stops resolving a
// directory through its own entry file. A dot in a directory name is not this
// file's extension, and neither is the leading dot of a dotfile.
export const withoutExtension = (rel) => {
  const dir = dirOf(rel);
  const stem = stemOf(rel);
  return dir === "" ? stem : `${dir}/${stem}`;
};

/**
 * Order by UTF-16 code unit, which is what `<` compares, for anything a reader
 * sees or a file records.
 *
 * `localeCompare` orders by the host's locale and ICU tables, so two machines
 * rendered two maps from one repository, and a list the overview cuts to its
 * budget named different areas on each.
 */
export const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whether a `relative()` answer leaves its base, in the grammar whose separator is `sep`.
 *
 * `..` as a whole first segment, so a directory named `..base` is inside. Two
 * Windows drives have no relative path between them and `relative` answers an
 * absolute one. On POSIX a backslash or a `C:` is part of a name.
 */
export const escapes = (rel, sep = hostSep) =>
  rel === ".." || rel.startsWith(`..${sep}`) || (sep === "\\" ? win32 : posix).isAbsolute(rel);

/**
 * What a volume that folds case and Unicode form compares: lower, upper and lower again, so the
 * capital sharp s becomes ß and then ss and the long s folds onto `s`; NFC at both ends puts back
 * what the case maps decompose.
 */
export const folded = (name) => name.normalize("NFC").toLowerCase().toUpperCase().toLowerCase().normalize("NFC");

/** `text` as a pattern matching exactly it, which `RegExp.escape` writes from Node 24. */
export const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The most trailing segments of a path an index keys its tails by: every tail of a path is quadratic
 * in its depth, and the scanned tree sets the depth.
 */
export const TAIL_MOST = 32;

/** Every whole tail of a path, `a/b/c` as `a/b/c`, `b/c` and `c`, from the longest, over its last `TAIL_MOST` segments. */
export function tailsOf(path) {
  const segments = path.split("/");
  const tails = [];
  for (let i = Math.max(0, segments.length - TAIL_MOST); i < segments.length; i++) tails.push(segments.slice(i).join("/"));
  return tails;
}

/** Key a value, or null where a second, different value claims the key: an answer two files give names neither. */
export const claim = (map, key, value) => map.set(key, map.has(key) && map.get(key) !== value ? null : value);
