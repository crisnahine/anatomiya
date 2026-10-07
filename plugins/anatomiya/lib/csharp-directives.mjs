/**
 * A C# source with one branch of each conditional left standing.
 *
 * The grammar reads a directive around whole statements and whole members and
 * nowhere else, and `#if` is written inside base lists, parameter lists, call
 * chains and initializers. Every directive line is blanked, and of each
 * `#if` to `#endif` every branch but the first. Blanked means spaces, line
 * breaks kept, so the text keeps its length and every offset and line a parser
 * reports on it is the file's own. A leaf: it is handed a string and loads
 * nothing.
 */

const DIRECTIVE = /^#[ \t]*(if|elif|else|endif|region|endregion|pragma|nullable|define|undef|line|error|warning)\b/;

const blank = (text) => text.replace(/[^\n\r]/g, " ");

function lineEnd(source, at) {
  let end = at;
  while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
  return end;
}

/** The offset just past the string whose opening quote is at `quote`. */
function stringEnd(source, quote) {
  const n = source.length;
  const before = source[quote - 1];
  // Asked before the quotes are counted: `@"""a""` is the verbatim text `"a"`, and no raw string.
  if (before === "@" || (before === "$" && source[quote - 2] === "@")) {
    for (let i = quote + 1; i < n; i++) {
      if (source[i] !== '"') continue;
      if (source[i + 1] !== '"') return i + 1;
      i++;
    }
    return n;
  }
  let run = 1;
  while (source[quote + run] === '"') run++;
  if (run >= 3) {
    const close = source.indexOf('"'.repeat(run), quote + run);
    if (close === -1) return n;
    let end = close + run;
    while (source[end] === '"') end++;
    return end;
  }
  for (let i = quote + 1; i < n; i++) {
    const ch = source[i];
    if (ch === "\\") i++;
    else if (ch === '"') return i + 1;
    else if (ch === "\n" || ch === "\r") return i;
  }
  return n;
}

/** The offset just past a character literal at `at`, or past its quote alone where it is none. */
function charEnd(source, at) {
  if (source[at + 1] === "\\") {
    // The longest is `'\U0010FFFF'`, 12 units: a search with no bound walks the line once per literal.
    for (let i = at + 2; i < at + 12; i++) {
      const ch = source[i];
      if (ch === undefined || ch === "\n" || ch === "\r") break;
      if (ch === "'" && i > at + 2) return i + 1;
    }
    return at + 1;
  }
  return source[at + 2] === "'" ? at + 3 : at + 1;
}

/**
 * Every directive line as `{ start, end, word }`, the line break left out.
 *
 * A directive opens its line. One inside a comment or a verbatim or raw string
 * is that string's text, so this reads as much of C# as tells those apart.
 */
function directives(source) {
  const found = [];
  const n = source.length;
  let opensLine = true;
  let i = 0;
  while (i < n) {
    const ch = source[i];
    if (ch === "\n" || ch === "\r") opensLine = true;
    else if (ch === "#" && opensLine) {
      const end = lineEnd(source, i);
      const word = DIRECTIVE.exec(source.slice(i, end))?.[1];
      if (word) found.push({ start: i, end, word });
      i = end;
      continue;
    } else if (ch !== " " && ch !== "\t" && !(ch === "\uFEFF" && i === 0)) {
      opensLine = false;
      const next = source[i + 1];
      let past = i + 1;
      if (ch === '"') past = stringEnd(source, i);
      else if (ch === "'") past = charEnd(source, i);
      else if (ch === "/" && next === "/") past = lineEnd(source, i);
      else if (ch === "/" && next === "*") {
        const close = source.indexOf("*/", i + 2);
        past = close === -1 ? n : close + 2;
      }
      i = past;
      continue;
    }
    i++;
  }
  return found;
}

/**
 * `{ text, dropped }`: the source with its directives blanked, and whether a
 * branch holding anything went with them. Null where there is no directive to
 * blank or the conditionals do not balance.
 */
export function withOneBranch(source) {
  const spans = [];
  const open = [];
  let dropped = false;
  for (const mark of directives(source)) {
    spans.push([mark.start, mark.end]);
    if (mark.word === "if") open.push([mark]);
    if (mark.word !== "elif" && mark.word !== "else" && mark.word !== "endif") continue;
    if (!open.length) return null;
    const marks = open[open.length - 1];
    marks.push(mark);
    if (mark.word !== "endif") continue;
    open.pop();
    for (let branch = 1; branch < marks.length - 1; branch++) {
      const [start, end] = [marks[branch].end, marks[branch + 1].start];
      spans.push([start, end]);
      dropped ||= /\S/.test(source.slice(start, end));
    }
  }
  if (!spans.length || open.length) return null;

  // A conditional inside a blanked branch adds spans the branch already covers.
  spans.sort((a, b) => a[0] - b[0]);
  let text = "";
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    text += source.slice(at, from) + blank(source.slice(from, end));
    at = end;
  }
  return { text: text + source.slice(at), dropped };
}
