/**
 * Whether a file this change added belongs where it was put.
 *
 * Every other rule here asks whether a file's contents match its directory's
 * claims. A file that creates its own directory is the only member of it and
 * conforms with itself, every time, so the one case guaranteed to pass is the
 * one where a convention was most likely broken. This asks the prior question
 * instead, and answers it from counts the scan already took (H38).
 */
import { byCode, dirOf, extOf } from "./paths.mjs";
import { FAMILY_TEST_NAMES, RUBY_TEST_NAME, TEST_DIRS, TEST_NAME, TEST_ROOTS, namesATest, pairedWith, sitsWhereItsToolReads, withoutTree } from "./test-shape.mjs";
import { isCorpusPath } from "./corpus.mjs";
import { familyOf, language } from "./langs.mjs";
import { LEVEL_ONLY_LABEL } from "./layout.mjs";
import { namesakeClause, pathText, testsParts } from "./render-layout.mjs";
import { encode, locator } from "./encode.mjs";
import { PRECEDENT_FLOOR } from "./principles.mjs";

/** Whether a root pairs enough of its files with tests to call that its habit. */
function pairsTests(r) {
  return (r?.companions?.with ?? 0) >= PRECEDENT_FLOOR;
}

/** Whether a root has precedent of its own, a file that holds its own tests counted as tested where it sits. */
function hasPrecedent(r) {
  return (r?.companions?.with ?? 0) + (r?.companions?.inline ?? 0) >= PRECEDENT_FLOOR;
}

// The family whose own spelling of a test name a path is read by, or null where the JavaScript and Ruby spellings read it.
const namedFamily = (rel) => {
  const family = familyOf(language(rel));
  return FAMILY_TEST_NAMES[family] ? family : null;
};

/**
 * Whether this path names a test file, in its language's spelling: the two
 * JavaScript and Ruby share, or the one its own tool collects by. Rust has no
 * name, cargo collecting by place, so no `.rs` path is one.
 *
 * Held to a source extension as well as to the name, because the name alone
 * admits `Component.test.tsx.snap`, `seed.test.sql`, `button.test.png` and
 * `tsconfig.test.json`, all measured in the corpus. A snapshot is written by a
 * test rather than being one, and none of them is a file whose placement this
 * has anything to say about.
 *
 * Held to the same population every other reader counts, too. This is asked of
 * names off the disk as well as of paths out of a diff, and a directory holding
 * one ignored `scratch_spec.rb` was reading as a directory with a test habit:
 * four findings became none.
 */
export function isTestPath(rel) {
  if (!isCorpusPath(rel)) return false;
  const family = namedFamily(rel);
  return family === null ? TEST_NAME.test(rel) || RUBY_TEST_NAME.test(rel) : namesATest(rel, family);
}

/**
 * The part of a test's path that names what it tests.
 *
 * `spec/mailers/cim_share_mailer_spec.rb` is about `mailers`, and
 * `src/pages/Foo/__tests__/bar.test.ts` is about `src/pages/Foo`. The tree word
 * goes because it names where tests live rather than what they cover, which is
 * the same reason `companionRoot` drops it going the other way.
 */
function testedTail(rel) {
  // A family with a build of its own names its trees its own way: a Gradle source set, a `.Tests` project, a package under `java`.
  const family = namedFamily(rel);
  if (family !== null) return withoutTree(dirOf(rel), family);
  const parts = rel.split("/").slice(0, -1).filter((p) => !TEST_DIRS.has(p));
  return (TEST_ROOTS.has(parts[0]) ? parts.slice(1) : parts).join("/");
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

// Every count the reason prints, as a number: a record is a file a repository can commit, and a count that is text prints as written.
const countsAreNumbers = (r) =>
  isCount(r.companions.with) && isCount(r.companions.of) && (r.companions.inline === undefined || isCount(r.companions.inline)) &&
  Array.isArray(r.tests ?? []) && (r.tests ?? []).every((t) => isCount(t?.files) && (t.under === undefined || isCount(t.under)));

/**
 * The source root this test's placement is judged against, or null.
 *
 * Matched on the tail rather than the whole path, so `spec/mailers` reaches
 * `app/mailers` without either naming the other. The tail is shortened a
 * segment at a time, because a root is a folded directory and a test sits under
 * whichever leaf it is about: `spec/services/nda_agreements` is about
 * `app/services`, and `src/pages/Listing/__tests__` is about `src/pages`, which
 * is the directory the miss this rule was written for was in.
 *
 * A tail more than one root answers to is answered by none of them where any
 * one already has precedent (`hasPrecedent`). Longest is not
 * nearest: a repository with `app/mailers` specced beside an engine's own
 * untested `app/mailers` told a spec sitting with its four siblings that it had
 * no precedent, off the longer name, which is a directory it has nothing to do
 * with. Where they are all untested the verdict is the same whichever it is, so
 * the one with the most producers speaks, since that is the strongest count
 * that is true.
 *
 * Where the language's layout pairs the test's directory with a project, only a
 * root of that project answers: a PHP `tests/Cache` is about the `src/Cache`
 * beside it, and a `Cache` in another tree is not its to answer for.
 *
 * Answered with the directories the answer turns on, each with the family its
 * root counts: a tail shortened past directories is a test of something under
 * them, and where the change made one of them and put source of that family
 * under it, the package has no habit yet and the files of the directory above
 * it are another directory's. Every directory on the way is asked, not the
 * test's own alone: a package's test can sit in a `tests` of its own, which
 * holds none of the source, and asking only there holds a new package to its
 * parent's ratio.
 */
function coveredRoot(rel, roots) {
  const parts = testedTail(rel).split("/").filter(Boolean);
  const family = namedFamily(rel);
  const inProject = family === null ? null : pairedWith(dirOf(rel), family);
  // A root recorded for one level counts nothing its children hold, so its zero
  // says the level is untested and never the directory. React's
  // `react-reconciler/src` reads 0 of 81 with 78 tests in the `__tests__`
  // directly beneath it, and the rule told all 78 they had no precedent.
  //
  // The shape is asked for as well as the version, since a record can carry a
  // schema this build knows and still hold a root that is not one; the hook's
  // never-fail catch is a floor rather than the answer.
  const eligible = roots.filter(
    (r) =>
      !r?.testRoot && typeof r?.dir === "string" && typeof r?.path === "string" && r?.companions && !r.path.endsWith(LEVEL_ONLY_LABEL) &&
      countsAreNumbers(r) &&
      (inProject === null || inProject(r.dir))
  );
  for (let end = parts.length; end > 0; end -= 1) {
    const tail = parts.slice(0, end).join("/");
    const matches = eligible.filter((r) => r.dir === tail || r.dir.endsWith(`/${tail}`));
    if (matches.length === 0) continue;
    if (matches.some(hasPrecedent)) return null;
    const below = parts.slice(end);
    // The family a root counts, or the test's own where the map recorded no extension for it.
    const counted = (r) => familyOf(language(`x${r.companions.ext ?? extOf(rel)}`));
    // Every directory from the root down to the test's own, nearest the root first: a package's `tests` holds none of its source.
    const turnsOn = matches.flatMap((r) => below.map((_, i) => ({ dir: [r.dir, ...below.slice(0, i + 1)].join("/"), family: counted(r) })));
    return { root: matches.sort((a, b) => b.companions.of - a.companions.of || byCode(a.dir, b.dir))[0], turnsOn };
  }
  return null;
}

/**
 * What the counts support, which is less than "there is no test here".
 *
 * The namesake match is case sensitive, so five Cypress specs named
 * `thing0.cy.js` beside `Thing0.tsx` are five tests this reads as none. The
 * zero is true as a statement about the match and false as a statement about
 * the directory, and the sentence says which of the two it is.
 */
const PRECEDENT_COUNTED = "Nothing here was matched to a test by name.";

/** The claim this rule states, in the voice every other claim is written in. */
const PRECEDENT_CLAIM = "a test goes where this kind of file's tests already go";

const PRECEDENT_KEY = "test_precedent";

/**
 * What the counts say about a source root, naming the tests it does hold.
 *
 * The ratio alone is what got walked through: `0 of 1003 have a namesake test`
 * does not literally forbid a `__tests__/helper.test.ts`, because that is not a
 * namesake and the sentence only ever spoke about namesakes. So the tests that
 * are there are named in the same clause as the zero, in the words the overview
 * already uses for them.
 */
function countsLine(dir, root) {
  const withTest = root.companions.with;
  const here = testsParts(root.tests ?? []);
  // "Elsewhere", because the guard above has already established that the
  // directory this file is going into holds none. Without the word the clause
  // reads as precedent for the very write it is refusing.
  const namesakes = withTest === 0 ? ", none of them a namesake" : "";
  const held = here.length > 0 ? `; elsewhere in it ${here.join(", ")}${namesakes}` : "";
  // The count is over one extension, nouned the way the overview's tests line
  // nouns it, or a mixed directory reads as smaller than it is. A map that did
  // not record the extension names one only where the root has no other: the
  // first of several can be a .png.
  const ext = root.companions.ext ?? (root.exts?.length === 1 ? root.exts[0][0] : null);
  const counted = namesakeClause({ ...root.companions, root: null }, ext ? `${encode(ext)} file` : "file");
  return `${pathText(dir)} holds no other test; ${pathText(root.dir)}: ${counted}${held}`;
}

/**
 * Test files a source root holds, its subtree included, whatever they are named.
 *
 * The subtree comes with the field: an ordinary root's `tests` already counts
 * what its children hold, which is why the roots that do not are refused a
 * segment above rather than added up here.
 */
const testFilesHeld = (root) => (root.tests ?? []).reduce((n, t) => n + t.files, 0);

/**
 * Files this change added that its own directory has no precedent for.
 *
 * Only where the repository tests something: a first test in a repository that
 * has none is a beginning, not a deviation, and there is nothing for it to
 * depart from.
 *
 * FIX rather than MUST-FIX, and never higher: where the siblings put their
 * tests is a question with more than one defensible answer. NIT only where no
 * comparison against a base could be made, since that comparison is the whole
 * of what says a file arrived.
 *
 * `holdsTest` answers whether a directory already holds a test that this change
 * did not bring. A caller that cannot tell says nothing, which leaves the rule
 * where it was before the question was asked.
 *
 * `turnsOn` on a finding is the directories it does not stand for where the
 * change made one of them for source of the family beside it (`coveredRoot`).
 * Only a caller holding the change and its base can tell, so it is handed the
 * question and the finding is stated as if none was.
 *
 * Nothing is said of a test that sits where its language's own tool reads it
 * from and nowhere else (`sitsWhereItsToolReads`): the first test of a Go
 * package has no other directory to go to, so "where the siblings put theirs"
 * is where it already is.
 */
export function precedentFindings(arrived, roots, { fresh = true, holdsTest = () => false } = {}) {
  // A repository that pairs no tests anywhere has no habit to have departed
  // from, and a zero there is the absence of a practice rather than a breach of
  // one. It is also the first thing a repository adopting tests would trip.
  const testsAnything = roots.some(pairsTests);
  if (!testsAnything) return [];

  const found = [];
  for (const file of arrived) {
    const rel = typeof file === "string" ? file : file.path;
    if (!isTestPath(rel) || sitsWhereItsToolReads(dirOf(rel), namedFamily(rel))) continue;
    // The nearest evidence there is, and the half of issue 120's own sentence
    // this rule was missing: a test landing beside tests is following them,
    // whatever the root's ratio says a level or two up. The caller answers it,
    // because the two that ask differ on what "already" means: nothing the
    // notice can see is from the write it is about, and a check has to leave
    // out everything the same change brought.
    if (holdsTest(dirOf(rel))) continue;
    const { root: covered, turnsOn } = coveredRoot(rel, roots) ?? {};
    if (!covered) continue;
    if (covered.companions.of < PRECEDENT_FLOOR) continue;
    // Tests under the root that pair with nothing are still tests. The same
    // floor read from the other side: two of them is a directory that has not
    // said anything, and four hundred is one whose habit is simply not
    // namesakes, where "no precedent" would be the false half of a true count.
    if (testFilesHeld(covered) >= PRECEDENT_FLOOR) continue;
    const counts = countsLine(dirOf(rel), covered);
    found.push({
      severity: fresh ? "FIX" : "NIT",
      reason: fresh ? counts : `${counts}; this run could not establish which files the change added`,
      companion: null,
      path: rel,
      oldPath: typeof file === "string" ? null : (file.oldPath ?? null),
      // The site is the path, so there is no line to point at.
      line: 1,
      // The source root, which is a layout directory rather than one of the
      // areas the counted rows name: nothing else answers for a file whose own
      // directory the change invented, and the roster path is the one a reader
      // can go and look at.
      area: covered.path,
      dimension: PRECEDENT_KEY,
      claim: PRECEDENT_CLAIM,
      precision: "precise",
      where: null,
      snippet: null,
      turnsOn,
    });
  }
  return found;
}

/**
 * What to say before a file is written, or null where there is nothing to say.
 *
 * The claims a repository states reach an agent on `PostToolUse`, which is
 * after the file exists, and an area's own file loads when something in that
 * area is read, or from Claude Code 2.1.288 once a Write or Edit there has
 * landed, never before. A directory nobody read is the blind spot, and it is
 * exactly where a convention gets broken: the path is chosen with none of its
 * counts in front of the reader.
 *
 * Null for the ordinary write, which is nearly all of them. An unchanged block
 * on every result is anti-signal: the session this was written for was handed
 * the same overview over a hundred times and still put a spec where no sibling
 * had one, because the clause that mattered had scrolled past ninety-nine
 * times already (A44).
 */
export function noticeFor(rel, layout, { holdsTest, from = null } = {}) {
  const [finding] = precedentFindings([rel], layout?.roots ?? [], holdsTest ? { holdsTest } : {});
  if (!finding) return null;
  return [
    `anatomiya: ${pathText(rel)}`,
    `  ${finding.reason}.`,
    `  ${PRECEDENT_COUNTED} Put it where the siblings put theirs, or leave it out and say which rule you followed.`,
    // A worktree with no map of its own is answered from its main checkout's, named as the path it is opened by.
    ...(from === null ? [] : [`  Counted from this repository's main checkout at ${locator(from)}, not this worktree.`]),
  ].join("\n");
}
