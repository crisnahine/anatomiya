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
 *
 * The tail is asked twice, whole and then with the tree names dropped, because
 * a repository that splits a source tree from a spec tree writes the same path
 * on both sides of the split and the two differ only in the word for the tree.
 */

import { dirOf, stemOf } from "./paths.mjs";

// The five ways a test file spells the name of the file it covers.
const NAMESAKE_SUFFIXES = ["_spec", "_test", ".test", ".spec", ".cy"];

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
 * The seven directory names that say which half of a split a path is on rather
 * than what sits in it. Dropping them leaves the shape the two halves share:
 * `budgets/app/models` and `modules/budgets/spec/models` both come down to
 * `budgets/models`.
 *
 * A closed list of tree words, not a rule about test directories: `support` is
 * left in place, so `spec/support/user.rb` still answers no `app/models/user.rb`.
 */
const TREE = new Set(["app", "lib", "src", "spec", "test", "tests", "__tests__"]);

const withoutTree = (dir) => dir.split("/").filter((seg) => !TREE.has(seg)).join("/");

// The same equal-or-endsWith rule the whole tail is asked, on what is left of
// both sides once the tree names are gone.
const mirrors = (flat, bare) => flat === bare || flat.endsWith(`/${bare}`);

// What a whole-tail match votes for: the test directory with the tail it shares
// with the source cut off it.
const wholeRoot = (dir, tail) =>
  tail === "" ? dir : dir.slice(0, Math.max(0, dir.length - tail.length - 1));

/**
 * The tree the mirror crossed: the test directory cut after the segment where
 * it stops sharing a prefix with the source, when that segment is a tree name.
 *
 * `modules/budgets/app/models` against `modules/budgets/spec/models` names
 * `modules/budgets/spec`; `src/vs/base/common` against `src/vs/base/test/common`
 * names `src/vs/base/test`. Null where the two part on an ordinary name, since
 * a vote for that directory would name a place neither side keeps tests in.
 */
function mirrorRoot(sourceDir, testDir) {
  const source = sourceDir.split("/");
  const test = testDir.split("/");
  let i = 0;
  while (i < source.length && i < test.length && source[i] === test[i]) i++;
  return i < test.length && TREE.has(test[i]) ? test.slice(0, i + 1).join("/") : null;
}

/**
 * The test files by the stem each one answers, built once over the whole corpus
 * because a scan asks the question per root and the map never differs.
 *
 * The directory and its tree-less form are stored beside the path: both are a
 * split and a rejoin of the whole path, and they were being recomputed once per
 * source file that reached the same candidate.
 *
 * Sorted by path, because a source file two candidates answer votes for the
 * first of them that names a tree and the corpus order is the filesystem's.
 */
export function namesakeIndex(testFiles) {
  const byStem = new Map();
  for (const t of testFiles) {
    const stem = namesakeStem(t.rel);
    if (!byStem.has(stem)) byStem.set(stem, []);
    const dir = dirOf(t.rel);
    byStem.get(stem).push({ rel: t.rel, dir, bare: withoutTree(dir) });
  }
  // By code unit, the comparator the learned class already sorts with: this
  // order picks the root that gets rendered, and `localeCompare` orders case by
  // whatever ICU tables the host was built with.
  for (const candidates of byStem.values()) candidates.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return byStem;
}

/**
 * `{ with, of, root }`: how many of the root's source files have a namesake
 * test, out of how many, and the directory prefix the most namesakes share.
 *
 * The root is a count of votes rather than the first match, so one file in the
 * wrong place cannot move the whole answer, and null when nothing matched: a
 * repository with no companion of this shape is not told where it keeps them.
 * Null too where the top vote is under half the matched files, because a
 * repository with one `__tests__` per component directory has an answer for
 * every file and no one place to name.
 */
export function namesakeCompanions(sourceFiles, testFiles, rootPath = "", byStem = namesakeIndex(testFiles)) {
  const votes = new Map();
  let answered = 0;
  for (const f of sourceFiles) {
    const tail = tailOf(f.rel, rootPath);
    const bare = withoutTree(tail);
    let matched = false;
    let prefix = null;
    for (const t of byStem.get(stemOf(f.rel)) ?? []) {
      const whole = tail === "" || t.dir === tail || t.dir.endsWith(`/${tail}`);
      if (!whole && (bare === "" || !mirrors(t.bare, bare))) continue;
      matched = true;
      // The first candidate that names a tree, not the first that matches: a
      // mirror parting on an ordinary name votes for nothing, and stopping
      // there threw away a vote the next candidate was going to cast.
      prefix = whole ? wholeRoot(t.dir, tail) : mirrorRoot(dirOf(f.rel), t.dir);
      if (prefix !== null) break;
    }
    if (!matched) continue;
    // One vote per answered source file, so the top vote and the count it is
    // halved against below are counts of the same thing. A repository holding
    // both a `spec` and a `test` tree answers some files from each.
    answered++;
    if (prefix !== null) votes.set(prefix, (votes.get(prefix) ?? 0) + 1);
  }

  // Null where the votes name the repository root, and null where they split:
  // "under ." is not a place and neither is a directory most of the matches
  // disagree with, so the renderer drops the clause rather than print one.
  // Code units, not locale: the tie decides a rendered root, and ICU differs by machine.
  const [top] = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const agreed = top !== undefined && top[1] * 2 >= answered;
  return { with: answered, of: sourceFiles.length, root: agreed ? top[0] || null : null };
}
