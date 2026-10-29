/**
 * The `find` command: the definitions the last scan indexed that best answer
 * some words, as lines to print and as hits (H60). Apart from `commands.mjs`
 * so the arm loads the index reader and the query side and not the scan behind
 * the other commands: the reuse check's reason sends the subagent here up to
 * three times per ask (A124), and the arm's load is pinned by
 * `test/modules.test.mjs`.
 */
import { gitRoot } from "./corpus.mjs";
import { printableOnly } from "./encode.mjs";
import { findSymbols, formatHit, queryWords } from "./find.mjs";
import { indexRefused, usableIndex } from "./index-home.mjs";

/** The doctor's word for a checkout with no index. */
export const noIndex = (root) => (indexRefused(root) ? "none; the last scan could not write one, past the size a scan writes" : "none; the next scan or refresh writes one");

/**
 * The definitions the last scan indexed that best answer `words`, as lines to
 * print and as hits. The index is the last scan's, so a function written since
 * is not in it, and the first line says so.
 */
export async function runFind(cwd, words) {
  const root = await gitRoot(cwd);
  const index = usableIndex(root)?.index ?? null;
  if (index === null) {
    const line = indexRefused(root)
      ? "The last scan could not write a code index: it was past the size a scan writes, and another scan would not write one either."
      : "No code index here yet: run `anatomiya scan` in this repository first.";
    return { indexed: false, hits: [], lines: [line] };
  }
  const asked = printableOnly(words.join(" "));
  if (queryWords(words).length === 0) return { indexed: true, hits: [], lines: [`"${asked}" holds no word to look up: a letter alone or a word like "the" is in nearly every name.`] };
  const hits = findSymbols(index, words);
  if (hits.length === 0) {
    return { indexed: true, hits, lines: [`No definition among the ${index.count} the last scan indexed matches "${asked}". Code written since that scan is not in it.`] };
  }
  const head = `The ${hits.length} of ${index.count} indexed definitions closest to "${asked}", as of the last scan:`;
  return { indexed: true, hits, lines: [head, ...hits.map(formatHit)] };
}
