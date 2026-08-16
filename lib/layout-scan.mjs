/**
 * The roster a scan hands to the record: what `layout.mjs` counts, over the
 * corpus a real scan holds.
 *
 * Its own module because neither neighbour wants it. `layout.mjs` is pure over
 * a list of layout files and knows nothing about a parse or a truncated corpus,
 * and `scan.mjs` is already the longest orchestration here.
 */

import { isTestFile, layoutFacts, minRootFiles, mirroredTests, rootFacts } from "./layout.mjs";
import { principleKeys } from "./principles.mjs";

/**
 * The whole-repository roster, and the same counts for one area on demand.
 *
 * The corpus is every tracked file, source and not: a directory holding forty
 * `.md` files is a fact about where things live. Nothing extra is parsed for
 * it, so a file the parse never reached carries no facets and is counted by
 * extension alone.
 *
 * `kinds` is a closure rather than a second entry point because the namesake
 * lookup it needs is over the whole corpus, and rebuilding that per area is the
 * one shape of this that does not scale.
 */
export function roster({ files, others, records, truncated }) {
  const corpus = [
    ...files.map((f) => ({ rel: f.rel, lang: f.lang, facets: records.get(f.rel)?.facets ?? null })),
    ...others.map((o) => ({ rel: o.rel, lang: null, facets: null })),
  ];
  const byRel = new Map(corpus.map((f) => [f.rel, f]));
  // The mirror is a fact about the whole corpus, so an area asks the index the
  // roster built rather than rebuilding one over its own files, where the
  // source half of every pair sits outside.
  const mirrored = mirroredTests(corpus);
  const testFiles = corpus.filter((f) => isTestFile(f, mirrored));

  return {
    layout: truncated ? notCounted(corpus) : counted(corpus, mirrored),
    kinds: (area) =>
      rootFacts(
        { path: area.path, files: area.files.map((f) => byRel.get(f.rel)) },
        corpus,
        testFiles,
        mirrored
      ),
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
function counted(corpus, mirrored) {
  const facts = layoutFacts(corpus, { mirrored });
  return { ...facts, principles: principleKeys(facts), truncated: false };
}
