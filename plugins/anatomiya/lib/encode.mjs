/**
 * The encoder every repository-controlled value passes through before it is
 * rendered into a file the agent loads.
 *
 * Allowlist, not denylist. A denylist over control characters misses bidi
 * overrides and zero-width joiners, which are category Cf rather than Cc, and
 * JSON.stringify does not escape those either. One filename carrying U+202E
 * reverses the visual order of the rest of the line.
 */

const MAX = 200;

// A path is capped shorter than a sentence, because it is rendered on a line
// that carries a line number and a claim beside it.
const PATH_MAX = 120;

// The alphabets whose letters share shapes. A word (a run of letters between
// separators, dots and digits) spelled in two of them is the homoglyph F3
// refuses (`раyments`, a Cyrillic `а` in a Latin word); a word in one of them,
// or in any other script, is a name somebody
// wrote in their own language, and refusing those left a repository written in
// Russian, Greek or Japanese with a placeholder in its overview and no area.
//
// Armenian and Cherokee are on the list for the same reason: `օ` (U+0585) is a
// Latin `o` and `Ꭺ` (U+13AA) a Latin `A`, and `src/cօnfig.ts` rendered as the
// file it is not.
const LOOKALIKE = [
  /\p{Script=Latin}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Armenian}/u,
  /\p{Script=Cherokee}/u,
];

const mixesLookalikes = (word) => LOOKALIKE.filter((re) => re.test(word)).length > 1;

// `форма.ts` is two words: the name in Cyrillic and the extension in Latin.
const WORD_BREAK = /[^\p{L}\p{M}]+/u;

// Anything but letters, marks, numbers, punctuation, symbols and the plain
// space, which covers Cc, Cf, Co, Cs and Zl/Zp. A lone surrogate is a code
// point under the `u` flag, so it matches here too. A control character or a
// newline breaks the line a value is written on, and a bidi override or a
// zero-width joiner reorders or hides what it says; `JSON.stringify` escapes
// neither of the last two.
const UNPRINTABLE = /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/gu;

// What renders as nothing and is not a format character, so the allowlist above
// keeps it: variation selectors (U+FE00-FE0F, U+E0100-E01EF) and the combining
// grapheme joiner are marks, the Hangul fillers (U+115F, U+1160, U+3164,
// U+FFA0) are letters. A payload of them rode invisibly inside one grapheme.
// Removed outright rather than spaced: they sit inside a word, and a space
// there would split it. The format characters among them keep becoming a
// space, which is what they always did.
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}--\p{Cf}]/gv;

// A grapheme holds any number of marks, so a cap on graphemes alone bounded
// nothing: five of them came back as 1,000,001 code units. Eight code points is
// a base and seven more, which is the longest conjunct a script writes
// (Devanagari क्ष्म्य is seven), and the whole value is held to four code units
// a grapheme on top of that.
const CLUSTER_MOST = 8;
const UNITS_PER_GRAPHEME = 4;

const STRUCTURAL = [
  /-{3,}/g,      // a markdown rule or a frontmatter fence
  /~{3,}/g,      // the other fence character, which backticks alone miss
  /<!--/g,
  /--!?>/g,      // parsers close a comment on --!> as well as -->
  /`{1,}/g,      // code fences and inline code
  /\|/g,         // a markdown table cell boundary
];

// A block-level marker only bites in the first position of a line, so it is
// stripped there rather than everywhere: "issue #42" survives intact.
const BLOCK_MARKER = /^(?:[#>*+-]+|\d+[.)])\s*/;

// Built on the first cap: most hook processes import this module and never cap.
let graphemes = null;
const segmenter = () => (graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" }));

/** Strip anything that is not printable, then collapse runs of spaces. */
export function printableOnly(s) {
  return s.replace(UNPRINTABLE, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Cap on grapheme clusters rather than code units, so a cap never splits a
 * surrogate pair or separates a combining mark from its base. Runs BEFORE
 * quoting: truncating after quoting can drop the closing quote and turn the
 * value into structure.
 */
function capGraphemes(s, max) {
  const out = [];
  const budget = max * UNITS_PER_GRAPHEME;
  let units = 0;
  for (const { segment } of segmenter().segment(s)) {
    const kept = firstCodePoints(segment, CLUSTER_MOST);
    if (out.length >= max || units + kept.length > budget) return out.join("") + "…";
    out.push(kept);
    units += kept.length;
    if (kept.length < segment.length) return out.join("") + "…";
  }
  return out.join("");
}

/** The first `n` code points of a string, without spreading the whole of it. */
function firstCodePoints(s, n) {
  let at = 0;
  for (let i = 0; i < n && at < s.length; i++) at += s.codePointAt(at) > 0xffff ? 2 : 1;
  return s.slice(0, at);
}

/** Everything the encoder removes, before anything is capped or quoted. */
function neutralise(value) {
  // An absent value still has to come through, so it becomes the empty string
  // rather than returning early: a path is always quoted, empty or not.
  let s = value == null ? "" : String(value).normalize("NFKC");
  s = printableOnly(s.replace(INVISIBLE, ""));
  for (const re of STRUCTURAL) s = s.replace(re, " ");
  s = s.replace(/ {2,}/g, " ").trim();

  // Until it stops matching: one pass over "# > policy" leaves "> policy",
  // which opens a block just as readily.
  for (let prev = null; s !== prev; ) {
    prev = s;
    s = s.replace(BLOCK_MARKER, "").trim();
  }

  // A setext underline is a whole line of "=", and every encoded value is
  // rendered on its own line, so such a value promotes the line above it to a
  // heading. Anchored, since "a === b" underlines nothing.
  if (/^=+$/.test(s)) return "";
  return s;
}

/**
 * A path with everything the encoder removes gone, and no quoting.
 *
 * Apart from `encodePath` because the quoting is one surface's need rather
 * than what makes the value safe: a writer that carries a path in a field of
 * its own would have to strip the quotes back off.
 */
export function sanitisePath(p) {
  const s = neutralise(p);
  // A rejected path leaks none of itself, so the marker is the whole value and
  // the cap has nothing to do.
  if (s && s.split(WORD_BREAK).some(mixesLookalikes)) return `<path with mixed scripts, ${[...s].length} chars>`;
  return capGraphemes(s, PATH_MAX);
}

// The whole marker, both ends anchored. Matched by its opening words alone, a
// filename a repository can spell takes the branch below that adds quotes
// without escaping what is inside them, so the name closes its own quoting.
const MIXED_MARKER = /^<path with mixed scripts, \d+ chars>$/;

/** A sanitised path, quoted for the line a reader sees it on. */
export function quotePath(s) {
  return MIXED_MARKER.test(s) ? `"${s}"` : JSON.stringify(s);
}

/** Encode a repository-controlled scalar for rendering; `encodePath` for a path. */
export function encode(value, { max = MAX } = {}) {
  return capGraphemes(neutralise(value), max);
}

/** A path, which is refused outright where it mixes scripts. */
export const encodePath = (p) => quotePath(sanitisePath(p));

/**
 * The first real line of a subprocess's own output, so a failure names its own
 * cause without carrying a whole log into an error message.
 *
 * Bare, and the caller writes its own punctuation: a helper that sometimes
 * glues a separator on is one a caller cannot place in a sentence.
 *
 * Capped, because a parser that dies mid-write emits one enormous line and
 * nothing about a line bounds its length.
 *
 * It does not encode. Everything else this module exports neutralises
 * repository-controlled text; this narrows a subprocess's own output, and a
 * caller that puts the result somewhere a reader parses still owes it `encode`.
 */
export function firstLine(text) {
  const line = String(text || "").split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 200) : "";
}

/**
 * A path as the locator it is, with only the unprintable characters refused,
 * one for one, so nothing else about it moves.
 *
 * Not through the display encoder. Every writer that uses it hands the path to
 * something that opens the file: GitHub places an annotation by it, a JSON
 * reader joins a finding back to it, the agent opens the one the text names,
 * and the echo names the checkout a map was counted in, whose area files are
 * read there. The encoder's cap and its script rule are for text a file
 * loads, and here they ended a long monorepo path in `…` and put a
 * placeholder in place of a Japanese directory, neither of which anything can
 * open.
 */
export const locator = (p) => String(p ?? "").replace(UNPRINTABLE, " ");
