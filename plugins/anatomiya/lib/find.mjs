/**
 * The query side of the code index: how `find` splits the words it is asked,
 * weighs each, and ranks the definitions an index lists. Apart from
 * `code-index.mjs`, which builds and writes the index with the scan's imports,
 * so the Stop hook can ask it without loading those.
 */
import { printableOnly } from "./encode.mjs";
import { byCode } from "./paths.mjs";
import { stemWords } from "./stems.mjs";

/**
 * How `find` weighs a match: a word in the name, the class, the doc sentence or the path; how much the
 * files importing a definition add, as `1 + reach * log2(1 + importers)`; what a match in a test is
 * worth; and how many hits it prints. Six, because twelve hits and one call per idea cost a subagent's
 * search more tokens than no index at all, and six and three calls a third less (A124).
 * `scripts/find-replay.mjs` scores a set against the recorded queries (H60).
 */
export const RANKING = Object.freeze({ name: 3, container: 2, doc: 1, path: 1, reach: 0.15, test: 0.5, shown: 6 });

// One word to a search however it ends: `urls` finds `compareUrl`, `indentation` finds `indent`.
const SUFFIXES = ["ations", "ation", "ings", "ing", "ers", "er", "ed", "es", "e", "s"];
function foldOnce(word) {
  // `properties` and `retried` are `property` and `retry`; a word ending in y keeps it, so `factory` is no `factor`.
  if (/[^aeiou]ie[sd]$/.test(word) && word.length >= 5) return `${word.slice(0, -3)}y`;
  for (const suffix of SUFFIXES) if (word.endsWith(suffix) && word.length - suffix.length >= 3 && !word.endsWith("ss")) return word.slice(0, -suffix.length);
  return word;
}
// Twice, so a word and its plural meet whichever ending each took: `statuses` and `status` both fold to `statu`.
const fold = (word) => foldOnce(foldOnce(word));
const wordsOf = (text) => (text ? stemWords(text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/ /g, "_")).map(fold) : []);
// A name is also its words run together, which is how a person types one: `unindent` finds `unIndent`.
const nameWords = (name) => [...wordsOf(name), fold(name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))];
const pathTerms = (rel) => wordsOf(rel.replace(/\.[^/.]+$/, "").replace(/\//g, " "));

// Words a sentence carries and no name means: in a doc they match nearly everything. Folded as a query word is.
const FILLER = new Set(["the", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "from", "at", "as", "is", "it", "this", "that", "its", "into"].map(fold));

/** The query's words, split as a name is, so `compareUrls`, `compare urls` and `compare_urls` ask the same; a letter alone or a filler word asks nothing. */
export const queryWords = (words) => [...new Set(words.flatMap(wordsOf).filter((word) => !/^\p{L}$/u.test(word) && !FILLER.has(word)))];

/**
 * Each asked word's weight: the rarer it is among the definitions, by every place a
 * match is scored, the more it says. A session asks in a sentence's words, and
 * unweighed, `new` or `id` in a hundred names buries `uuid` in one, and `the` in
 * every doc outweighs both.
 */
function weightsOf(index, asked) {
  const seen = new Map([...asked].map((w) => [w, 0]));
  let total = 0;
  for (const [, , symbols] of index.files) {
    for (const [name, , , container, , doc] of symbols) {
      total++;
      if (!mayHold(`${name} ${container ?? ""} ${doc ?? ""}`, asked)) continue;
      for (const w of new Set([...nameWords(name), ...wordsOf(container), ...wordsOf(doc)])) if (seen.has(w)) seen.set(w, seen.get(w) + 1);
    }
  }
  return new Map([...seen].map(([w, n]) => [w, Math.log(1 + total / (1 + n))]));
}

// Text holding none of the asked words cannot match one, since a folded word, less a `y` it took for
// `ies`, starts the word it came from; so it is passed over before it is split, most of a query's time.
const mayHold = (text, asked) => {
  const lower = text.toLowerCase();
  // With its separators taken out too, for the name run together.
  const joined = lower.replace(/[^\p{L}\p{N}]/gu, "");
  return asked.some((w) => {
    const start = w.endsWith("y") ? w.slice(0, -1) : w;
    return lower.includes(start) || joined.includes(start);
  });
};

/**
 * The definitions that best answer `words`: each asked word, by its weight, counts
 * in the best place it matches, three in the name, two in its class, one in its
 * doc sentence or its path, so a word said in three places is still one word. The
 * more files import a definition the more its match weighs, and a test's half as
 * much. A word only the path holds finds nothing. Ties go to the one more files
 * import, then by path and line.
 */
export function findSymbols(index, words, ranking = RANKING) {
  if (Object.keys(RANKING).some((k) => typeof ranking[k] !== "number")) throw new TypeError("a ranking names every weight RANKING does");
  const asked = queryWords(words);
  if (asked.length === 0) return [];
  const weight = weightsOf(index, asked);
  const hits = [];
  for (const [rel, test, symbols] of index.files) {
    let inPath = null;
    for (const [name, kind, line, container, params, doc, importers] of symbols) {
      if (!mayHold(`${name} ${container ?? ""} ${doc ?? ""}`, asked)) continue;
      const places = [[new Set(nameWords(name)), ranking.name], [new Set(wordsOf(container)), ranking.container], [new Set(wordsOf(doc)), ranking.doc]];
      let score = 0;
      let matched = false;
      inPath ??= new Set(pathTerms(rel));
      for (const w of asked) {
        const best = Math.max(...places.map(([set, at]) => (set.has(w) ? at : 0)));
        matched ||= best > 0;
        score += Math.max(best, inPath.has(w) ? ranking.path : 0) * weight.get(w);
      }
      // What a repository already leans on is the helper to call: at 0.15, 4 importers weigh a match 1.35 times, 19 1.65, 252 2.2.
      const reach = 1 + ranking.reach * Math.log2(1 + importers);
      // A test names what it tests, so it matches every word of the helper it covers; it ranks behind that helper.
      if (matched) hits.push({ name, kind, line, container, params, doc, importers, rel, test: test === 1, score: score * reach * (test === 1 ? ranking.test : 1) });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.importers - a.importers || byCode(a.rel, b.rel) || a.line - b.line)
    .slice(0, ranking.shown)
    .map(printable);
}

// Each piece is the repository's own text, a comment's or a committed index's, and reaches a terminal, a
// transcript or a JSON reader: none may carry a control or a direction character.
const printable = (hit) => ({
  ...hit,
  ...Object.fromEntries(["name", "rel", "container", "params", "doc"].map((key) => [key, typeof hit[key] === "string" ? printableOnly(hit[key]) : hit[key]])),
});

/** One line per hit, as `find` prints it. */
export function formatHit(h) {
  const what = h.container ? `${h.kind} of ${h.container}` : h.kind;
  const importedBy = h.importers > 0 ? `, ${h.importers} ${h.importers === 1 ? "file imports" : "files import"} it` : "";
  return `${h.name}${h.params ?? ""}  ${h.rel}:${h.line}  ${what}${importedBy}${h.test ? ", in a test file" : ""}${h.doc ? `  - ${h.doc}` : ""}`;
}
