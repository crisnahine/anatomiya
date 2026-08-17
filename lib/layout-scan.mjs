/**
 * The roster a scan hands to the record: what `layout.mjs` counts, over the
 * corpus a real scan holds.
 *
 * Its own module because neither neighbour wants it. `layout.mjs` is pure over
 * a list of layout files and knows nothing about a parse or a truncated corpus,
 * and `scan.mjs` is already the longest orchestration here.
 */

import { layoutFacts, layoutIndexes, minRootFiles, rootFacts } from "./layout.mjs";
import { principleKeys } from "./principles.mjs";

/**
 * The whole-repository roster, and the same counts for one area on demand.
 *
 * The corpus is every tracked file, source and not: a directory holding forty
 * `.md` files is a fact about where things live. Nothing extra is parsed for
 * it, so a file the parse never reached carries no facets and is counted by
 * extension alone.
 *
 * `kinds` is a closure rather than a second entry point because the mirror and
 * namesake indexes it needs are over the whole corpus, and rebuilding those per
 * area is the one shape of this that does not scale.
 */
export function roster({ files, others, records, truncated }) {
  const corpus = [
    ...files.map((f) => ({ rel: f.rel, lang: f.lang, facets: records.get(f.rel)?.facets ?? null })),
    ...others.map((o) => ({ rel: o.rel, lang: null, facets: null })),
  ];
  const byRel = new Map(corpus.map((f) => [f.rel, f]));
  // Facts about the whole corpus, so an area asks the indexes the roster built
  // rather than rebuilding them over its own files, where the source half of
  // every pair sits outside.
  const indexes = layoutIndexes(corpus);

  return {
    layout: truncated ? notCounted(corpus) : counted(corpus, indexes),
    // An area's counts come off the same arbitrary subset the roster refuses to
    // describe, so a truncated scan answers with nothing rather than with them.
    kinds: truncated
      ? () => null
      : (area) => rootFacts({ path: area.path, files: area.files.map((f) => byRel.get(f.rel)) }, indexes),
  };
}

/**
 * Counts over an arbitrary subset, rendered as a description of the tree, is
 * the failure the truncation rule exists for. The size survives because it is
 * what the notice is about.
 */
const notCounted = (corpus) => ({
  size: corpus.length,
  minFiles: minRootFiles(corpus.length),
  roots: [],
  more: { roots: 0, files: 0 },
  tests: [],
  principles: [],
  truncated: true,
});

// The keys, not the sentences: the record stores which principles this
// repository grounds, and the renderer owns how they read.
function counted(corpus, indexes) {
  const facts = layoutFacts(corpus, { indexes });
  return { ...facts, principles: principleKeys(facts), truncated: false };
}
