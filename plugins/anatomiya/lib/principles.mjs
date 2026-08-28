/**
 * Pure and importing nothing from lib, so scan.mjs can build a layout and hand
 * it here without this module reaching back into what built it.
 */
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
    // here. The floor is spelled rather than imported because this module reads
    // nothing from lib; a test holds the two to the same boundary.
    when: (layout) =>
      layout.roots.some((r) => r?.companions && r.companions.with > 0) &&
      layout.roots.some((r) => r?.companions && r.companions.with === 0 && r.companions.of >= 3),
  },
];

/** The keys the record stores; the renderer looks the sentences up by them. */
export function principleKeys(layout) {
  return PRINCIPLES.filter((p) => p.when(layout)).map((p) => p.key);
}
