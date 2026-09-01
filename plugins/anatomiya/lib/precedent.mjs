/**
 * Whether a file this change added belongs where it was put.
 *
 * Every other rule here asks whether a file's contents match its directory's
 * claims. A file that creates its own directory is the only member of it and
 * conforms with itself, every time, so the one case guaranteed to pass is the
 * one where a convention was most likely broken. This asks the prior question
 * instead, and answers it from counts the scan already took (H38).
 */
import { RUBY_TEST_NAME, TEST_DIRS, TEST_NAME, TEST_ROOTS } from "./test-shape.mjs";
import { isCorpusPath } from "./corpus.mjs";
import { LEVEL_ONLY_LABEL } from "./layout.mjs";
import { testsParts } from "./render-layout.mjs";

/**
 * Producers a source root needs before its silence counts as precedent.
 *
 * One untested file is a repository that has not said anything. Three is where
 * the learned-suffix vote also stops, arrived at separately rather than shared
 * with it: the two answer different questions and moving one is not a reason to
 * move the other.
 */
export const PRECEDENT_FLOOR = 3;

/**
 * Whether this path names a test file, in either language's spelling.
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
  return isCorpusPath(rel) && (TEST_NAME.test(rel) || RUBY_TEST_NAME.test(rel));
}

/**
 * The part of a test's path that names what it tests.
 *
 * `spec/mailers/cim_share_mailer_spec.rb` is about `mailers`, and
 * `src/pages/Foo/__tests__/bar.test.ts` is about `src/pages/Foo`. The tree word
 * goes because it names where tests live rather than what they cover, which is
 * the same reason `companionRoot` drops it going the other way.
 */
export function testedTail(rel) {
  const parts = rel.split("/").slice(0, -1).filter((p) => !TEST_DIRS.has(p));
  return (TEST_ROOTS.has(parts[0]) ? parts.slice(1) : parts).join("/");
}

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
 * one is already paired. Longest is not nearest: a repository with `app/mailers`
 * specced beside an engine's own untested `app/mailers` told a spec sitting
 * with its four siblings that it had no precedent, off the longer name, which
 * is a directory it has nothing to do with. Where they are all untested the
 * verdict is the same whichever it is, so the one with the most producers
 * speaks, since that is the strongest count that is true.
 */
export function coveredRoot(rel, roots) {
  const parts = testedTail(rel).split("/").filter(Boolean);
  // A root recorded for one level counts nothing its children hold, so its zero
  // says the level is untested and never the directory. React's
  // `react-reconciler/src` reads 0 of 81 with 78 tests in the `__tests__`
  // directly beneath it, and the rule told all 78 they had no precedent.
  //
  // The shape is asked for as well as the version, since a record can carry a
  // schema this build knows and still hold a root that is not one; the hook's
  // never-fail catch is a floor rather than the answer.
  const eligible = roots.filter(
    (r) => !r?.testRoot && typeof r?.dir === "string" && typeof r?.path === "string" && r?.companions && !r.path.endsWith(LEVEL_ONLY_LABEL)
  );
  for (let end = parts.length; end > 0; end -= 1) {
    const tail = parts.slice(0, end).join("/");
    const matches = eligible.filter((r) => r.dir === tail || r.dir.endsWith(`/${tail}`));
    if (matches.length === 0) continue;
    if (matches.some((r) => r.companions.with > 0)) return null;
    return matches.sort((a, b) => b.companions.of - a.companions.of || a.dir.localeCompare(b.dir))[0];
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
export const PRECEDENT_CLAIM = "a test goes where this kind of file's tests already go";

export const PRECEDENT_KEY = "test_precedent";

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
  const { with: withTest, of } = root.companions;
  const here = testsParts(root.tests ?? []);
  // "Elsewhere", because the guard above has already established that the
  // directory this file is going into holds none. Without the word the clause
  // reads as precedent for the very write it is refusing.
  const held = here.length > 0 ? `; elsewhere in it ${here.join(", ")}, none of them a namesake` : "";
  return `${dir} holds no other test; ${root.dir}: ${of} files, ${withTest} with a namesake test${held}`;
}

/** The directory a path sits in, or "" at the repository root. */
const dirOf = (rel) => rel.slice(0, Math.max(0, rel.lastIndexOf("/")));

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
 */
export function precedentFindings(arrived, roots, { fresh = true, holdsTest = () => false } = {}) {
  // A repository that pairs no tests anywhere has no habit to have departed
  // from, and a zero there is the absence of a practice rather than a breach of
  // one. It is also the first thing a repository adopting tests would trip.
  const testsAnything = roots.some((r) => r?.companions && r.companions.with > 0);
  if (!testsAnything) return [];

  const found = [];
  for (const file of arrived) {
    const rel = typeof file === "string" ? file : file.path;
    if (!isTestPath(rel)) continue;
    // The nearest evidence there is, and the half of issue 120's own sentence
    // this rule was missing: a test landing beside tests is following them,
    // whatever the root's ratio says a level or two up. The caller answers it,
    // because the two that ask differ on what "already" means: nothing the
    // notice can see is from the write it is about, and a check has to leave
    // out everything the same change brought.
    if (holdsTest(dirOf(rel))) continue;
    const covered = coveredRoot(rel, roots);
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
    });
  }
  return found;
}

/**
 * What to say before a file is written, or null where there is nothing to say.
 *
 * The claims a repository states reach an agent on `PostToolUse`, which is
 * after the file exists, and an area's own file loads only when something in
 * that area is read. A directory nobody read is the blind spot, and it is
 * exactly where a convention gets broken: the path is chosen with none of its
 * counts in front of the reader.
 *
 * Null for the ordinary write, which is nearly all of them. An unchanged block
 * on every result is anti-signal: the session this was written for was handed
 * the same overview over a hundred times and still put a spec where no sibling
 * had one, because the clause that mattered had scrolled past ninety-nine
 * times already (A44).
 */
export function noticeFor(rel, layout, { holdsTest } = {}) {
  const [finding] = precedentFindings([rel], layout?.roots ?? [], holdsTest ? { holdsTest } : {});
  if (!finding) return null;
  return [
    `anatomiya: ${rel}`,
    `  ${finding.reason}.`,
    `  ${PRECEDENT_COUNTED} Put it where the siblings put theirs, or leave it out and say which rule you followed.`,
  ].join("\n");
}
