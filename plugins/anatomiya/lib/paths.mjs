/**
 * The slices of a repository-relative path every roster module takes.
 *
 * Kept here rather than three copies because they are read together: a rule
 * that matches on the basename and a rule that matches on the directory have to
 * agree on where one ends, and one copy drifting is a file counted twice.
 *
 * String slicing rather than `node:path`, since a corpus path is always posix
 * and `dirname` answers "." at the top level, which is a directory name no
 * repository has.
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
 * Order by code point, for every tie that decides a name a reader sees.
 *
 * `localeCompare` orders case by whatever ICU tables the host was built with,
 * so two machines rendered two maps from one repository. Four modules carried
 * this privately or spelled it inline, and a fifth broke its tie by locale.
 */
export const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
