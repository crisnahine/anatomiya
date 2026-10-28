/**
 * What every engine's facets say a file defines, in one shape: the index's
 * rows, read by `code-index.mjs`. A leaf, since the parser children read it.
 *
 * A symbol is `[name, kind, line, container, params, doc]`. `kind` is one of
 * `SYMBOL_KINDS`, `container` the class, module or type a method sits in or null,
 * `params` the parameter list as written, and `doc` the first sentence of the
 * comment or docstring that documents it. The text pieces are read off the
 * source by line, the same way in every language.
 */

/** What a definition can be: `module` is Ruby's, and `const` is Go's and Rust's constants and statics. */
export const SYMBOL_KINDS = Object.freeze(["fn", "method", "class", "module", "type", "const"]);

// Long enough for a signature a reader decides on, short enough that a hit stays one line.
export const PARAMS_MOST = 80;
export const DOC_MOST = 60;

/** The offset each line starts at, so a line is found for an offset without a scan from the top. */
export function lineStarts(source) {
  const starts = [0];
  for (let at = source.indexOf("\n"); at !== -1; at = source.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** The 1-based line holding an offset. */
export function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const cut = (text, most) => (text.length > most ? `${text.slice(0, most - 3).trimEnd()}...` : text);

/** A parameter list on one line, capped, or null where it is empty. */
export function paramsText(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text === "" ? null : cut(text, PARAMS_MOST);
}

// An annotation, a decorator or an attribute stands between a declaration and its doc comment.
const ATTRIBUTE = /^\s*(?:@|#\[|#!\[|\[)/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;
const INNER = /^\s*(?:\/\/!|\/\*!)/;
// Only where `#` opens a comment: elsewhere it is a private field, a directive or an attribute.
const HASH_COMMENT = /^\s*#(?![[!])/;

/**
 * The comment lines that end right above `line`, past any attribute between,
 * joined as written; null where the line above is blank or code. `hash` says
 * the language comments with `#`.
 */
export function commentAbove(source, starts, line, hash = false) {
  const lines = [];
  for (let at = line - 1; at >= 1; at--) {
    const text = source.slice(starts[at - 1], at < starts.length ? starts[at] - 1 : source.length).replace(/\r$/, "");
    // `//!` and `/*!` document the module they open, or keep a license: never the item below.
    if (INNER.test(text)) break;
    if (COMMENT.test(text) || (hash && HASH_COMMENT.test(text))) lines.unshift(text);
    else if (ATTRIBUTE.test(text) && lines.length === 0) continue;
    else break;
  }
  return lines.length ? lines.join("\n") : null;
}

// What a tool reads out of a comment, which documents nothing.
const PRAGMA = /^(?:=begin\b|=end\b|eslint|@ts-|@(?:no)?flow\b|@format\b|@jsx\b|rubocop:|frozen_string_literal|prettier-ignore|istanbul |c8 |noqa|type: ?ignore|pylint:|nolint|go:|-\*-|region\b|endregion\b|#region|#endregion|<\/?summary>$)/i;

/** The first sentence a comment or docstring carries, without its markers or tags, capped; null where it says nothing. */
export function docLine(raw) {
  if (typeof raw !== "string") return null;
  const words = [];
  // A docstring's quotes and its prefix, as `"doc"`, `R"""doc"""` or `u'''doc'''` write them.
  const unquoted = raw.trim().replace(/^[rRuUbBfF]{0,2}("""|'''|"|')([\s\S]*?)\1$/, "$2");
  for (const line of unquoted.split("\n")) {
    let text = line
      .trim()
      .replace(/^(?:\/\*\*|\/\*!?|\*\/|\/\/[/!]?|#+|\*|"""|'''|r""")\s?/, "")
      .replace(/(?:\*\/|"""|''')$/, "")
      .replace(/<\/?(?:summary|remarks|para)>/g, "")
      .trim();
    if (text.startsWith("*")) text = text.slice(1).trim();
    if (text === "" || PRAGMA.test(text)) {
      if (words.length) break;
      continue;
    }
    // A tag block (`@param`, `:param`, `# Arguments`) starts where the summary ended.
    if (/^(?:@\w|:\w+[ :]|Args:|Arguments|Returns?:|Parameters)/.test(text)) break;
    words.push(text);
    if (/[.!?]$/.test(text)) break;
  }
  const joined = words.join(" ");
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(joined)?.[1] ?? joined;
  return sentence === "" ? null : cut(sentence, DOC_MOST);
}

/** One symbol, with the absent parts as null. */
export const symbol = (name, kind, line, container = null, params = null, doc = null) => [name, kind, line, container, params, doc];
