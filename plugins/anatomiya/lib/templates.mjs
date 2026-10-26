/**
 * View templates whose code is in another language's syntax: ERB for Ruby and
 * Razor for C#. No scan reads them, and the end-of-turn reuse check does, since
 * a view is where a copy of a helper's logic is most often written: a line rule
 * per kind says which lines hold code and which are markup alone.
 */

const KINDS = [
  ["erb", /\.erb$/],
  ["razor", /\.(?:cshtml|razor)$/],
];

/** Which template kind a path is, or null where it is none. */
export function templateOf(path) {
  return KINDS.find(([, ext]) => ext.test(path))?.[0] ?? null;
}

/**
 * ERB: the text between `<%` and `%>` is Ruby, `<%#` opens a comment and `<%%` is a literal `<%`.
 * A line holding any Ruby asks, and a tag never closed holds Ruby to the end of the file.
 */
function erb(source) {
  const asks = new Array(source.split("\n").length).fill(false);
  let state = "markup";
  let row = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\n") row++;
    else if (state === "markup") {
      if (c !== "<" || source[i + 1] !== "%") continue;
      if (source[i + 2] === "%") i += 2;
      else if (source[i + 2] === "#") [state, i] = ["comment", i + 2];
      else [state, asks[row], i] = ["code", true, i + 1];
    } else if (c === "%" && source[i + 1] === ">") [state, i] = ["markup", i + 1];
    else if (state === "code" && c.trim() !== "") asks[row] = true;
  }
  return asks;
}

// A directive that names a type, a namespace or a route, and runs nothing. `@using (` is a statement.
const RAZOR_DIRECTIVE = /^\s*@(?:model|using(?!\s*\()|page|layout|inherits|namespace|inject|implements|attribute|addTagHelper|removeTagHelper|tagHelperPrefix|rendermode|typeparam)\b/;
// A block of C#: `@{`, `@code {` and `@functions {`.
const RAZOR_BLOCK = /(?<![\w@])@(?:code\s*|functions\s*)?\{/;
// Razor reads `@` as code only after a character that cannot end a word, so an e-mail address is text and `@@` a literal `@`.
const RAZOR_CODE = /(?<![\w@.])@(?![@*])[A-Za-z_(]/;

const braces = (text) => (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0);

/** Razor: a line asks where it holds a transition to C# or sits in a block of it, through the brace that closes the block. */
function razor(source) {
  const lines = source.split("\n");
  const asks = new Array(lines.length).fill(false);
  let depth = 0;
  let comment = false;
  for (const [i, raw] of lines.entries()) {
    // `@* ... *@` is a comment, which may run over lines.
    let line = "";
    for (let at = 0; at < raw.length; ) {
      if (comment) {
        const end = raw.indexOf("*@", at);
        if (end === -1) at = raw.length;
        else [comment, at] = [false, end + 2];
      } else {
        const start = raw.indexOf("@*", at);
        if (start === -1) [line, at] = [line + raw.slice(at), raw.length];
        else [line, comment, at] = [line + raw.slice(at, start), true, start + 2];
      }
    }
    if (line.trim() === "") continue;
    if (depth > 0) {
      asks[i] = true;
      depth = Math.max(0, depth + braces(line));
    } else if (RAZOR_DIRECTIVE.test(line)) continue;
    else if (RAZOR_BLOCK.test(line)) {
      asks[i] = true;
      const opened = line.slice(line.search(RAZOR_BLOCK));
      depth = Math.max(0, braces(opened));
    } else if (RAZOR_CODE.test(line)) asks[i] = true;
  }
  return asks;
}

const RULES = { erb, razor };

/** Which of a template's lines hold no code, one entry per line: true where the line asks nothing. */
export function templateInertLines(kind, source) {
  return RULES[kind](source).map((asks) => !asks);
}
