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
];

// One gate, asked twice: the record stores the keys and the rendered section
// prints the sentences, and a second copy of the condition is one that drifts.
const grounded = (layout) => PRINCIPLES.filter((p) => p.when(layout));

/** The keys the record stores. */
export function principleKeys(layout) {
  return grounded(layout).map((p) => p.key);
}

export function principlesFor(layout) {
  return grounded(layout).map((p) => p.sentence);
}
