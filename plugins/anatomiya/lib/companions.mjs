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
import { dirOf, extOf, stemOf, withoutExtension } from "./paths.mjs";
import {
  LEARNED_SUFFIX_FLOOR,
  LEARNED_SUFFIX_SHARE,
  NAMESAKE_SUFFIXES,
  startsAtSeparator,
  TEST_TREES,
  TREE,
} from "./test-shape.mjs";

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
  const parts = named.split("/");
  // `./x/.` and `./x/..` are the same directory the trailing slash names, spelt
  // with the segment instead of an empty one.
  const last = parts[parts.length - 1];
  if (last === "." || last === "..") return null;
  const segments = fromDir === "" ? [] : fromDir.split("/");
  for (const part of parts) {
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
// What a compiled specifier is written for. TypeScript under NodeNext requires
// the emitted extension, so `../src/parser.js` is how a spec names
// `src/parser.ts`, and refusing it missed the dominant modern spelling.
//
// The source spellings are named rather than the extension dropped: dropping it
// let one `./foo.js` answer `foo.json` and `foo.css` too, crediting a module
// with a test that reads the table beside it.
const SOURCE_OF = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

// What a specifier carrying no extension can resolve to. A bare `../src/parser`
// is the module, never the stylesheet, the table or the declaration file that
// share its name: without this the stem answered every one of them, and only
// the single-extension population one caller happens to build kept them out.
const RESOLVABLE = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

function coversOf(t) {
  const out = new Set();
  for (const i of t.facets?.imports ?? []) {
    const path = importedPath(dirOf(t.rel), i.module);
    if (path === null) continue;
    out.add(path);
    const stem = withoutExtension(path);
    for (const ext of SOURCE_OF[path.slice(stem.length)] ?? []) out.add(stem + ext);
  }
  return out;
}

// Whether a test directory sits inside the root being counted, which is what
// separates a suite kept beside the code from one kept at the top of the tree.
const inside = (dir, rootPath) => rootPath !== "" && rootPath !== "." && dir.startsWith(`${rootPath}/`);

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
 * What each test directory adds to the name of the file it covers, beyond the
 * suffix that already says it is a test.
 *
 * A repository is free to call `address.rb`'s spec `address_model_spec.rb`, and
 * a rule that only knows `_spec` reads half such a directory as untested. The
 * extra is learned rather than listed: it is whatever the directory's own files
 * put between the covered name and the test suffix, kept only where enough of
 * them agree, so one `user_membership_spec.rb` teaches nothing.
 *
 * Per directory, because that is the population the share is a share of, and it
 * is where a spelling is actually held to: the corpus as a whole is not a place
 * anybody names a file in.
 */
function learnStemExtras(byStem, sourceFiles) {
  // Keyed by language as well as by name: `index.js` and `index_spec.rb` share
  // a stem and nothing else, and a Ruby spec is not a JavaScript module's test.
  const stems = new Set(sourceFiles.map((f) => `${language(f.rel)}\u0000${stemOf(f.rel)}`));
  const perDir = new Map();
  const dirTotals = new Map();
  for (const candidates of byStem.values()) {
    for (const t of candidates) {
      dirTotals.set(t.dir, (dirTotals.get(t.dir) ?? 0) + 1);
      const stem = namesakeStem(t.rel);
      const lang = language(t.rel);
      if (stems.has(`${lang}\u0000${stem}`)) continue;
      // The longest covered name this one extends, so `address_model` offers
      // `_model` for `address` rather than `_address_model` for nothing.
      for (let i = stem.length - 1; i > 0; i--) {
        if (!stems.has(`${lang}\u0000${stem.slice(0, i)}`)) continue;
        const extra = stem.slice(i);
        if (!startsAtSeparator(extra)) break;
        // Keyed with the language it was learned in, so a directory holding two
        // does not lend one's spelling to the other.
        const key = `${lang}\u0000${extra}`;
        if (!perDir.has(t.dir)) perDir.set(t.dir, new Map());
        const seen = perDir.get(t.dir);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        break;
      }
    }
  }

  const learned = new Map();
  for (const [dir, seen] of perDir) {
    const bar = Math.max(LEARNED_SUFFIX_FLOOR, LEARNED_SUFFIX_SHARE * (dirTotals.get(dir) ?? 0));
    const kept = [...seen].filter(([, n]) => n >= bar).map(([extra]) => extra);
    if (kept.length) learned.set(dir, kept);
  }
  return learned;
}

/**
 * How many trailing segments two directories share, once the tree words are
 * gone. `services/shopify/reports` shares three with itself and one with
 * `services/stripe/reports`.
 */
function sharedTail(a, b) {
  const x = a === "" ? [] : a.split("/");
  const y = b === "" ? [] : b.split("/");
  let n = 0;
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++;
  return n;
}

/**
 * The one source file each test file answers, decided over the whole corpus.
 *
 * A spec is written for one file. Asked per root, with only that root's sources
 * in hand, the question cannot see that another directory already owns the
 * answer: `app/services/stripe/reports/generate.rb` has no spec at all, and
 * `spec/services/shopify/reports/generate_spec.rb`, which describes
 * `Shopify::Reports::Generate`, was credited to it because the tail below the
 * area root is `reports` on both sides. The kinds line then said 15 where the
 * pairing claim, which mirrors the whole path, said 13, in one generated file.
 *
 * The import edge decides it outright where there is one: a test that imports
 * the file has named what it covers. Otherwise the closest structural match
 * wins, counted in shared trailing segments, and a tie is left unowned rather
 * than broken on a name, which is the posture `companionRoot` already takes.
 * Unowned is what every candidate is when no source list is handed in, so a
 * caller that has no corpus asks exactly the question it used to.
 */
function assignOwners(byStem, sourceFiles) {
  // Keyed by language as well as by name, the way `learnStemExtras` is: a Ruby
  // spec is not a JavaScript module's test, and letting one own the other's
  // stem took the spec off the file it was structurally written for.
  const sourcesByStem = new Map();
  for (const f of sourceFiles) {
    const key = `${language(f.rel)}\u0000${stemOf(f.rel)}`;
    if (!sourcesByStem.has(key)) sourcesByStem.set(key, []);
    sourcesByStem.get(key).push(f);
  }

  for (const [stem, candidates] of byStem) {
    for (const t of candidates) {
      // Per candidate, not per bucket: one stem holds every language that
      // spells it, so `foo_spec.rb` and `foo.test.js` sit together and each has
      // to be read against the sources of its own language.
      const sources = sourcesByStem.get(`${language(t.rel)}\u0000${stem}`);
      if (!sources || sources.length < 2) continue;
      // Structure decides, the import edge breaks a tie, and where the two
      // disagree nothing is decided.
      //
      // Both orders were tried and each has a counter-example the other gets
      // right. Taken outright the edge moved a spec off the file in its own
      // directory onto a same-stem module it named as a stub; used only as a
      // tiebreak it discarded an explicit import whenever any structural noise
      // separated the candidates. The corpus settles neither: no repository in
      // it holds the shape. So the disagreement is left unowned, which is this
      // file's posture everywhere else, and costs at worst the false positive
      // the whole pass exists to remove rather than the false negative that
      // would retire a real test.
      let best = -1;
      let winners = [];
      for (const f of sources) {
        const n = sharedTail(t.bare, withoutTree(dirOf(f.rel)));
        if (n > best) {
          best = n;
          winners = [f.rel];
        } else if (n === best) winners.push(f.rel);
      }
      const imported = sources
        .filter((f) => t.covers.has(f.rel) || t.covers.has(withoutExtension(f.rel)))
        .map((f) => f.rel);
      if (winners.length === 1) {
        // A test that imports one file and mirrors another has said two things.
        if (imported.length === 0 || imported.includes(winners[0])) t.owner = winners[0];
        continue;
      }
      if (imported.length === 1 && winners.includes(imported[0])) t.owner = imported[0];
    }
  }
}

/**
 * Register each candidate under the name it covers as well as under its own, so
 * a directory writing `address_model_spec.rb` answers `address.rb` without any
 * other reading having to know about it.
 *
 * A record of its own per name, not the same object under a second key: one
 * file answers two names here, and ownership is decided per name. Sharing one
 * object let whichever name was settled last overwrite the other, and the file
 * whose own name the spec spells read untested.
 */
function registerLearnedSpellings(byStem, sourceFiles) {
  for (const [dir, extras] of learnStemExtras(byStem, sourceFiles)) {
    for (const candidates of [...byStem.values()]) {
      for (const t of candidates) {
        if (t.dir !== dir) continue;
        const stem = namesakeStem(t.rel);
        for (const key of extras) {
          const [lang, extra] = key.split("\u0000");
          if (language(t.rel) !== lang) continue;
          if (!stem.endsWith(extra) || stem.length === extra.length) continue;
          const covered = stem.slice(0, -extra.length);
          if (!byStem.has(covered)) byStem.set(covered, []);
          const bucket = byStem.get(covered);
          if (bucket.some((c) => c.rel === t.rel)) continue;
          bucket.push({ ...t });
        }
      }
    }
  }
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
 * first of them that names a tree and the corpus order is the filesystem's. It
 * is the order and not the rule: where only the import edge answers, a suite
 * inside the root being counted is preferred over one outside it, whatever the
 * path order.
 */
export function namesakeIndex(testFiles, sourceFiles = null) {
  const byStem = new Map();
  for (const t of testFiles) {
    const stem = namesakeStem(t.rel);
    if (!byStem.has(stem)) byStem.set(stem, []);
    const dir = dirOf(t.rel);
    // `owner` is null until the corpus decides one, never absent: an absent key
    // would make "nobody asked" and "nobody owns it" the same reading.
    byStem.get(stem).push({ rel: t.rel, dir, bare: withoutTree(dir), covers: coversOf(t), owner: null });
  }
  if (sourceFiles !== null) registerLearnedSpellings(byStem, sourceFiles);
  // By code unit, the comparator the learned class already sorts with: this
  // order picks the root that gets rendered, and `localeCompare` orders case by
  // whatever ICU tables the host was built with.
  for (const candidates of byStem.values()) candidates.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  if (sourceFiles !== null) assignOwners(byStem, sourceFiles);
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
    // The tail with the tree words dropped, falling back to the whole
    // directory's when that leaves nothing. A tail that is only tree words is
    // the most ordinary layout there is: at `packages/foo` the tail of
    // `packages/foo/src/parser.ts` is `src`, and refusing every candidate for
    // want of a shape read the package 0 of 2 where `packages` above it and
    // `packages/foo/src` below it both read 2 of 2. One file, three roots,
    // three answers, and the middle one wrong.
    const bare = withoutTree(tail) || withoutTree(dirOf(f.rel));
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
    // Whether anything structural answered at all, even where what it named was
    // the repository itself. That is a colocated test, and the place to print
    // for it is none: handing the line to a second suite that merely imports
    // the file names a directory the repository does not keep these tests in.
    let structural = false;
    // Where a test is kept, for a match no shared structure named. Held back
    // rather than taken: the edge proves the file is tested and says nothing
    // about where this root keeps its tests, and a foreign integration test
    // that sorted earlier took the whole line off the real spec tree.
    //
    // A suite inside the root wins over one outside it, whatever the path order.
    // Neither is structural here, so both are true and only one is the answer a
    // reader wanted: `e2e` beat `pkg/hooks/__spec__` on the letter `e`.
    // Measured over the corpus: five roots print a root that came from the edge
    // at all, one of those has two directories reached that way, and none has
    // one inside the root. The corpus holds no case, so this changes no line it
    // prints and settles a shape it does not contain.
    let kept = null;
    for (const t of byStem.get(stemOf(f.rel)) ?? []) {
      // Another source in the corpus is the one this test was written for, so
      // it is not evidence about this file however the two paths line up.
      if (t.owner !== null && t.owner !== f.rel) continue;
      // Two files at the top of the tree share a stem and nothing else, so this
      // branch asks the one question the nested path never had to: the
      // directories part first there, and here they do not. A JS script is not
      // answered by a Ruby spec of the same name.
      const topLevel = flatPair && TREE.has(t.dir.split("/")[0]) && language(t.rel) === language(f.rel);
      // The same mirror, asked the other way round. `mirrors` is one-directional
      // and the empty-tail arm only ever asked whether the candidate ends in the
      // root, so a root whose tree-less form is longer than the test tree's
      // never matched: `app/mcp` is a Rails autoload root, `withoutTree` leaves
      // `mcp/mcp` against `mcp`, and every file sitting directly there read
      // untested while the same files read tested one segment up.
      //
      // Held two ways, because H18 measured the unguarded match at 668 false
      // matches on openproject, 43.5% of everything it found. `tail === ""` is
      // load-bearing rather than tidy: `rootBare` is null on the nested path and
      // the reversed call puts it in the receiver position, so without it this
      // throws on every repository. And the candidate's own top segment has to
      // be a tree the repository keeps tests in, or any deeper directory that
      // happens to share a tail answers.
      const rootMirror =
        tail === "" &&
        (mirrors(t.bare, rootBare) ||
          (t.bare !== "" && TEST_TREES.has(t.dir.split("/")[0]) && mirrors(rootBare, t.bare)));
      const whole =
        tail === "" ? rootMirror || topLevel : t.dir === tail || t.dir.endsWith(`/${tail}`);
      // A test that imports this very file has named what it covers, so it
      // answers where the tail cannot: the two sides of a split tree agree on a
      // path here rather than on a shape. Asked only where the tail said no, so
      // a repository whose layout already answers keeps the root it votes for.
      const covered =
        !whole &&
        (t.covers.has(f.rel) || (RESOLVABLE.has(extOf(f.rel)) && t.covers.has(noExtension)));
      const mirrored = !whole && bare !== "" && mirrors(t.bare, bare);
      if (!whole && !mirrored && !covered) continue;
      matched = true;
      // The first candidate that names a place, not the first that matches: a
      // mirror parting on an ordinary name names none, and stopping there threw
      // away a vote the next candidate was going to cast.
      if (whole || mirrored) {
        const named = whole ? wholeRoot(t.dir, tail) : mirrorRoot(fDir, t.dir);
        if (named !== null) {
          structural = true;
          if (named) {
            prefix = named;
            break;
          }
        }
      } else if (kept === null || (!inside(kept, rootPath) && inside(t.dir, rootPath))) kept = t.dir;
    }
    if (!matched) continue;
    // One vote per answered source file, so the top vote and the count it is
    // halved against below are counts of the same thing. A repository holding
    // both a `spec` and a `test` tree answers some files from each.
    answered++;
    // Structure that named nothing has still answered, so the edge does not get
    // to name a place in its stead.
    const vote = prefix ?? (structural ? null : kept);
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
