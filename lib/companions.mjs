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
 *
 * Where neither reading answers, the candidate is asked one last question: does
 * it import the producer outright. A nested source answered by a flat test root
 * is indistinguishable by path from a decoy that merely shares a stem, so the
 * evidence has to come from the file rather than from where it sits.
 */

import { language } from "./langs.mjs";
import { dirOf, stemOf, withoutExtension } from "./paths.mjs";
import { NAMESAKE_SUFFIXES, TREE } from "./test-shape.mjs";

const namesakeStem = (rel) => {
  const stem = stemOf(rel);
  for (const suffix of NAMESAKE_SUFFIXES) {
    if (stem.length > suffix.length && stem.endsWith(suffix)) return stem.slice(0, -suffix.length);
  }
  return stem;
};

// Where the file sits under its own root. An empty tail is a file directly in
// the root, with no suffix beneath it to match a candidate against.
const tailOf = (rel, rootPath) => {
  const dir = dirOf(rel);
  if (rootPath === "" || rootPath === ".") return dir;
  if (dir === rootPath) return "";
  return dir.startsWith(`${rootPath}/`) ? dir.slice(rootPath.length + 1) : dir;
};

const withoutTree = (dir) => dir.split("/").filter((seg) => !TREE.has(seg)).join("/");

/**
 * The repository-relative path a relative import names, spelled exactly as the
 * specifier spelled it.
 *
 * `siblings.mjs` resolves a specifier too, against the corpus, and this does not
 * call it on purpose: that one needs the whole file set, and a caller that has
 * none would silently answer no rather than fail, which is how an overview and
 * an area file come to disagree about the same files. It also resolves a bare
 * specifier through a tail index, which here would let a dependency name a file
 * that happens to share its tail. Kept textual, so every caller answers alike.
 *
 * The extension is kept rather than dropped. Dropping it is what lets `./parser`
 * answer `parser.ts`, and the caller asks for both spellings to get that; doing
 * it here instead would also let `./defaults.json` answer `defaults.mjs`, so a
 * module would be credited with a test that only reads the table beside it.
 *
 * Null for anything that leaves the tree or is not relative at all: a bare
 * package name is a dependency, and `../..` above the root is not a file this
 * corpus holds.
 */
function importedPath(fromDir, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  // A loader suffix names the same file: `./worker.ts?worker` is Vite's, and
  // `?raw` is every bundler's. Cut at the first of either, since a real path
  // holds neither character.
  const cut = specifier.search(/[?#]/);
  const named = cut === -1 ? specifier : specifier.slice(0, cut);
  // A trailing slash is a directory, which resolves through its own index file.
  // Nothing here is resolved against the filesystem, so it names no file rather
  // than naming the sibling module that happens to share the directory's name.
  if (named.endsWith("/")) return null;
  const segments = fromDir === "" ? [] : fromDir.split("/");
  for (const part of named.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(part);
  }
  return segments.length === 0 ? null : segments.join("/");
}

/**
 * What one test file says it covers: every repository file its own relative
 * imports name.
 *
 * A test that imports the file it is named after has said so in the one place
 * a guess cannot be wrong. Empty for a file the parse never reached, which is
 * the same silence every other dimension keeps about an unexamined file.
 */
// The extensions a specifier wears when the file it names is written in
// another. TypeScript under NodeNext requires the compiled spelling, so
// `../src/parser.js` is how a spec names `src/parser.ts`, and refusing it
// missed the dominant modern spelling. No other extension is stripped: a
// `./defaults.json` beside a `defaults.mjs` is the table, not the module.
const COMPILED = new Set([".js", ".jsx", ".mjs", ".cjs"]);

function coversOf(t) {
  const out = new Set();
  for (const i of t.facets?.imports ?? []) {
    const path = importedPath(dirOf(t.rel), i.module);
    if (path === null) continue;
    out.add(path);
    const stem = withoutExtension(path);
    if (stem !== path && COMPILED.has(path.slice(stem.length))) out.add(stem);
  }
  return out;
}

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
 * source file that reached the same candidate. `covers` is the same trade for
 * the import edge, resolved once here rather than per source file asking.
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
    byStem.get(stem).push({ rel: t.rel, dir, bare: withoutTree(dir), covers: coversOf(t) });
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
 * every file and no one place to name, and null where a single file answered,
 * which names wherever that one file's test happens to sit.
 */
export function namesakeCompanions(sourceFiles, testFiles, rootPath = "", byStem = namesakeIndex(testFiles)) {
  const votes = new Map();
  let answered = 0;
  for (const f of sourceFiles) {
    const fDir = dirOf(f.rel);
    const tail = tailOf(f.rel, rootPath);
    const bare = withoutTree(tail);
    // An empty tail has no suffix to mirror, so the root's own directory
    // stands in for it: a candidate still has to mirror that, or both sides
    // have to sit at the top of the tree. That second half is the flat
    // repository, `scripts/x.mjs` answered by `test/x.test.mjs`, which the
    // first misses because `scripts` is nobody's tree word: this repository
    // pairs 8 of its 15 that way. What the two share is the top of the tree
    // and not the shape below it, so a test root that files by type answers
    // too. Top level on both sides is what keeps it from reaching a package,
    // where `apps/www` answered by a repository-wide `test/`, or a top-level
    // script answered by one package's own tests, is the shape a monorepo
    // keeps beside the package instead.
    const rootBare = tail === "" ? withoutTree(fDir) : null;
    const flatPair = tail === "" && !fDir.includes("/");
    // The two spellings an import may use for this file: with its extension, and
    // without, which is how TypeScript and every bundler write it. Split once
    // here rather than once per candidate that shares the stem.
    const noExtension = withoutExtension(f.rel);
    let matched = false;
    let prefix = null;
    // Where a test is kept, for a match no shared structure named. Held back
    // rather than taken: the edge proves the file is tested and says nothing
    // about where this root keeps its tests, and a foreign integration test
    // that sorted earlier took the whole line off the real spec tree.
    let kept = null;
    for (const t of byStem.get(stemOf(f.rel)) ?? []) {
      // Two files at the top of the tree share a stem and nothing else, so this
      // branch asks the one question the nested path never had to: the
      // directories part first there, and here they do not. A JS script is not
      // answered by a Ruby spec of the same name.
      const topLevel = flatPair && TREE.has(t.dir.split("/")[0]) && language(t.rel) === language(f.rel);
      const whole =
        tail === ""
          ? mirrors(t.bare, rootBare) || topLevel
          : t.dir === tail || t.dir.endsWith(`/${tail}`);
      // A test that imports this very file has named what it covers, so it
      // answers where the tail cannot: the two sides of a split tree agree on a
      // path here rather than on a shape. Asked only where the tail said no, so
      // a repository whose layout already answers keeps the root it votes for.
      const covered = !whole && (t.covers.has(f.rel) || t.covers.has(noExtension));
      if (!whole && !covered && (bare === "" || !mirrors(t.bare, bare))) continue;
      matched = true;
      // The first candidate that names a tree, not the first that matches: a
      // mirror parting on an ordinary name votes for nothing, and stopping
      // there threw away a vote the next candidate was going to cast. An import
      // match is the exception and always names one, since the file it points at
      // is not a guess to be improved on by the next candidate.
      prefix = whole ? wholeRoot(t.dir, tail) : mirrorRoot(fDir, t.dir);
      if (prefix !== null) break;
      if (covered && kept === null) kept = t.dir;
    }
    if (!matched) continue;
    // One vote per answered source file, so the top vote and the count it is
    // halved against below are counts of the same thing. A repository holding
    // both a `spec` and a `test` tree answers some files from each.
    answered++;
    const vote = prefix ?? kept;
    if (vote !== null) votes.set(vote, (votes.get(vote) ?? 0) + 1);
  }

  // Null where the votes name the repository root, and null where they split:
  // "under ." is not a place and neither is a directory most of the matches
  // disagree with, so the renderer drops the clause rather than print one.
  // Code units, not locale: the tie decides a rendered root, and ICU differs by machine.
  const [top] = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  // One answered file agrees with itself, so the half rule cannot refuse it and
  // the name is whatever that file happens to touch: react's one answered file
  // named a compiled fixture bundle. The counts stay, the place goes.
  const agreed = answered > 1 && top !== undefined && top[1] * 2 >= answered;
  return { with: answered, of: sourceFiles.length, root: agreed ? top[0] || null : null };
}
