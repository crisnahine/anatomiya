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

// Scripts we accept in a path or an identifier. A path mixing Latin and
// Cyrillic is almost always a homoglyph attack rather than a real filename.
const LATIN = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;

// Printable: letters, marks, numbers, punctuation, symbols, and the plain
// space. Everything else goes, which covers Cc, Cf, Co, Cs and Zl/Zp.
const PRINTABLE = /[\p{L}\p{M}\p{N}\p{P}\p{S} ]/u;

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

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Strip anything that is not printable, then collapse runs of spaces. */
function printableOnly(s) {
  let out = "";
  for (const ch of s) out += PRINTABLE.test(ch) ? ch : " ";
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Cap on grapheme clusters rather than code units, so a cap never splits a
 * surrogate pair or separates a combining mark from its base. Runs BEFORE
 * quoting: truncating after quoting can drop the closing quote and turn the
 * value into structure.
 */
function capGraphemes(s, max) {
  const out = [];
  for (const { segment } of GRAPHEMES.segment(s)) {
    if (out.length >= max) return out.join("") + "…";
    out.push(segment);
  }
  return out.join("");
}

/** Everything the encoder removes, before anything is capped or quoted. */
function neutralise(value) {
  // An absent value still has to come through, so it becomes the empty string
  // rather than returning early: a path is always quoted, empty or not.
  let s = value == null ? "" : String(value).normalize("NFKC");
  s = printableOnly(s);
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
export function sanitisePath(p, max = PATH_MAX) {
  const s = neutralise(p);
  // A rejected path leaks none of itself, so the marker is the whole value and
  // the cap has nothing to do.
  if (s && !LATIN.test(s)) return `<path with mixed scripts, ${[...s].length} chars>`;
  return capGraphemes(s, max);
}

/** A sanitised path, quoted for the line a reader sees it on. */
export function quotePath(s) {
  return /^<path with mixed scripts/.test(s) ? `"${s}"` : JSON.stringify(s);
}

/**
 * Encode a repository-controlled scalar for rendering.
 * `text` is the general form; `path` additionally rejects mixed scripts.
 */
export function encode(value, { max = MAX, kind = "text" } = {}) {
  if (kind === "path") return quotePath(sanitisePath(value, max));
  return capGraphemes(neutralise(value), max);
}

export const encodePath = (p) => quotePath(sanitisePath(p));

/** True when encoding changed the value, so the caller can report suppression. */
export function wasAltered(value) {
  if (value == null) return false;
  return encode(value) !== String(value).normalize("NFKC").trim();
}

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
