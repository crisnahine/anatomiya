/**
 * How many files in one directory have a test file of their own name.
 *
 * `pairing.mjs` asks the same question as an obligation, from a declared pair of
 * directories and one companion suffix. This asks it as a count, over whatever
 * root the layout found and whatever the repository spells its tests with, so a
 * repository that answers none of its workers reads `0 of 496` rather than
 * saying nothing.
 *
 * The match is on the path tail rather than the basename, as `companionRoot`
 * learns its root: `app/models/edition/foo.rb` is answered by
 * `spec/models/edition/foo_spec.rb` and not by `spec/services/foo_spec.rb`, and
 * the basename collisions a large repository is full of never arise.
 */

// The five ways a test file spells the name of the file it covers.
const NAMESAKE_SUFFIXES = ["_spec", "_test", ".test", ".spec", ".cy"];

const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

// A leading dot is the whole name of a dotfile, not the start of an extension.
export const stemOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

const namesakeStem = (rel) => {
  const stem = stemOf(rel);
  for (const suffix of NAMESAKE_SUFFIXES) {
    if (stem.length > suffix.length && stem.endsWith(suffix)) return stem.slice(0, -suffix.length);
  }
  return stem;
};

// Where the file sits under its own root. An empty tail is a file directly in
// the root, which any directory answers.
const tailOf = (rel, rootPath) => {
  const dir = dirOf(rel);
  if (rootPath === "" || rootPath === ".") return dir;
  if (dir === rootPath) return "";
  return dir.startsWith(`${rootPath}/`) ? dir.slice(rootPath.length + 1) : dir;
};

/**
 * `{ with, of, root }`: how many of the root's source files have a namesake
 * test, out of how many, and the directory prefix the most namesakes share.
 *
 * The root is a count of votes rather than the first match, so one file in the
 * wrong place cannot move the whole answer, and null when nothing matched: a
 * repository with no companion of this shape is not told where it keeps them.
 */
export function namesakeCompanions(sourceFiles, testFiles, rootPath = "") {
  const byStem = new Map();
  for (const t of testFiles) {
    const stem = namesakeStem(t.rel);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(t.rel);
  }

  const votes = new Map();
  let answered = 0;
  for (const f of sourceFiles) {
    const tail = tailOf(f.rel, rootPath);
    let matched = false;
    for (const rel of byStem.get(stemOf(f.rel)) ?? []) {
      const dir = dirOf(rel);
      if (tail !== "" && dir !== tail && !dir.endsWith(`/${tail}`)) continue;
      matched = true;
      const prefix = tail === "" ? dir : dir.slice(0, Math.max(0, dir.length - tail.length - 1));
      votes.set(prefix, (votes.get(prefix) ?? 0) + 1);
    }
    if (matched) answered++;
  }

  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { with: answered, of: sourceFiles.length, root: ranked.length === 0 ? null : ranked[0][0] || "." };
}
