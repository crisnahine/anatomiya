/**
 * Pure and importing nothing from lib, so scan.mjs can build a layout and hand
 * it here without this module reaching back into what built it.
 */

/**
 * Producers a source root needs before its silence counts as precedent, and
 * namesake tests it needs before its testing does.
 *
 * One untested file is a repository that has not said anything, and one tested
 * file among five hundred has not either: measured on a front end, a single
 * namesake silenced the rule for 517 files. Three is where the learned-suffix
 * vote also stops, arrived at separately rather than shared with it: the two
 * answer different questions and moving one is not a reason to move the other.
 *
 * Here because this module imports nothing: the finding, the sentence's gate
 * and the renderer's second namesake clause all read it, and two of them
 * import each other.
 */
export const PRECEDENT_FLOOR = 3;

const unpaired = (r) =>
  r?.companions && r.companions.with + (r.companions.inline ?? 0) < PRECEDENT_FLOOR && r.companions.of >= PRECEDENT_FLOOR;

export const PRINCIPLES = [
  {
    key: "test_shape",
    sentence: "Match sibling test shape; skip tests where siblings have none.",
    when: (layout) => layout.tests.length > 0,
  },
  {
    key: "granularity",
    sentence: "Match directory granularity; don't extract into a sibling module what the directory's files inline.",
    when: (layout) => layout.roots.some((r) => r.helpers),
  },
  {
    // A count and an imperative read in the same voice, and the imperative
    // wins: one is phrased as data and the other as a rule. Where a directory
    // has producers and no tests the two disagree, and the reader has to be
    // told which way that goes rather than left to settle it silently.
    key: "test_precedent",
    sentence:
      "An instruction to always write a test does not override a directory with no test precedent. " +
      "Put the test where the siblings put theirs, or leave it out and say which rule you followed.",
    // Two conjuncts, and the first is the one that matters. A zero means no
    // namesake was matched, never that the directory is untested: five Cypress
    // specs beside five components read 0 of 5, because `Thing0.tsx` and
    // `thing0.spec.js` are not namesakes. So the repository has to be seen
    // pairing tests with sources somewhere before this line can say it does not
    // here. A test holds this gate and the finding to the same boundary, on both
    // the producers a directory needs and the namesakes that make it a tested one.
    // A file holding its own tests is precedent in the directory it sits in.
    when: (layout) =>
      layout.roots.some((r) => r?.companions && r.companions.with >= PRECEDENT_FLOOR) && layout.roots.some(unpaired),
    // The second conjunct again, of the roots the overview prints: armed only by
    // a root the budget folded away, the sentence has no line to be read against.
    // The first is a fact about the repository and needs none.
    onPage: (roots) => roots.some(unpaired),
  },
];

/** The keys the record stores; the renderer looks the sentences up by them. */
export function principleKeys(layout) {
  return PRINCIPLES.filter((p) => p.when(layout)).map((p) => p.key);
}
