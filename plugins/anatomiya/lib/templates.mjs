/**
 * View templates whose code is in another language's syntax, and the markup of
 * a component: no scan reads either, and the end-of-turn reuse check does, since
 * a view is where a copy of a helper's logic is most often written. A line rule
 * per kind says which lines hold code and which are markup alone. A line longer
 * than the line rules read (`LINE_READ`) asks unread, as it does under them: a
 * minified line is a megabyte, and the rules run inside the stop's budget.
 */
import { LINE_READ } from "./limits.mjs";

const KINDS = [
  ["erb", /\.erb$/],
  ["razor", /\.(?:cshtml|razor)$/],
  ["haml", /\.haml$/],
  ["slim", /\.slim$/],
  // A plain `.html` file is anybody's: Angular, Vue, Django or markup alone, and no one rule reads all of them.
  ["jinja", /\.(?:jinja2?|j2)$/],
  ["gotmpl", /\.(?:tmpl|gotmpl)$/],
];

/** Which template kind a path is, or null where it is none. */
export function templateOf(path) {
  return KINDS.find(([, ext]) => ext.test(path))?.[0] ?? null;
}

// An expression that computes: a call, an operator, an assignment, a pipe to a filter. A name read
// as it is, `user.name`, computes nothing a helper could.
const COMPUTES = /[()+*/%<>!=?&|]|\s-\s/;

/**
 * ERB: the text between `<%` and `%>` is Ruby, `<%#` opens a comment and `<%%` is a literal `<%`.
 * A line holding any Ruby asks, and a tag never closed holds Ruby to the end of the file. ERB ends a
 * tag at the first `%>`, inside a Ruby string or not, and so does this.
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
// What opens a block of C#: `@{`, `@code` and `@functions`, and a statement whose body is a block.
const RAZOR_BLOCK = /(?<![\w@])@(?:\{|(?:code|functions|if|foreach|for|while|switch|lock|try|do)\b|using\s*\()/;
// The statements that go on from a block just closed.
const RAZOR_GOES_ON = /^\s*(?:\}\s*)?(?:else|catch|finally)\b/;
// Razor reads `@` as code only after a character that cannot end a word, so an e-mail address is text and `@@` a literal `@`.
const RAZOR_CODE = /(?<![\w@.])@(?![@*])[A-Za-z_(]/;
// A C# string, whose braces open and close nothing.
const CS_STRING = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

const braces = (text) => {
  const code = text.replace(CS_STRING, '""');
  return (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
};

// A line of braces alone opens or closes a block and computes nothing.
const BRACES_ONLY = /^[{}\s]+$/;

/**
 * Razor: a line asks where it holds a transition to C#, or sits in a block of C# and is no markup,
 * through the brace that closes the block; `@*` opens a comment, which may run over lines.
 */
function razor(source) {
  const lines = source.split("\n");
  const asks = new Array(lines.length).fill(false);
  let depth = 0;
  let comment = false;
  // A statement seen whose `{` is on a later line, and a block just closed that an `else` may go on from.
  let opening = false;
  let closed = false;
  for (const [i, raw] of lines.entries()) {
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
    const text = line.trim();
    if (text === "") continue;
    if (line.length > LINE_READ) {
      asks[i] = true;
      continue;
    }
    if (depth > 0) {
      // Markup and `@:` text inside a block are no C#, and their braces open and close nothing.
      const markup = text.startsWith("<") || text.startsWith("@:");
      asks[i] = !BRACES_ONLY.test(text) && (!markup || RAZOR_CODE.test(line));
      if (!markup) depth = Math.max(0, depth + braces(line));
      closed = depth === 0;
      continue;
    }
    if (opening && text.startsWith("{")) {
      depth = Math.max(0, braces(line));
      opening = false;
      continue;
    }
    opening = false;
    const block = RAZOR_BLOCK.exec(line);
    if (RAZOR_DIRECTIVE.test(line) && block === null) {
      closed = false;
      continue;
    }
    if (block !== null || (closed && RAZOR_GOES_ON.test(line))) {
      asks[i] = true;
      const from = block === null ? line : line.slice(block.index);
      if (from.includes("{")) depth = Math.max(0, braces(from));
      else opening = true;
    } else if (RAZOR_CODE.test(line)) asks[i] = true;
    closed = false;
  }
  return asks;
}

// HAML and Slim: a line of Ruby (`-`), an output line (`=`, `==`, `~`, `!=`, `&=`), a tag whose
// content is output, an attribute bound to Ruby, and an interpolation.
// A HAML `{ }` attribute hash is Ruby, and so is an attribute in `( )` or Slim's `[ ]` whose value is unquoted.
const HAML_CODE = /^\s*(?:-(?!#)|[=~]|[!&]=)|^\s*[%.#][\w.#:-]*(?:\{[^}]*\}|\([^)]*\))?\s*[=~]|^\s*[%.#][\w.#:-]*\{|^\s*[%.#][\w.#:-]*\([^)]*\w=(?!["'])|#\{/;
const SLIM_CODE = /^\s*(?:-|==?)|^\s*[\w.#:-]+(?:\[[^\]]*\]|\([^)]*\))?\s*==?\s|^\s*[\w.#:-]+[[(][^\])]*\w=(?!["'])|^\s*[\w.#:-]+.*\s[\w:-]+=(?!["'])\S|#\{/;
const SLIM_COMMENT = /^\s*\/(?!\S*\s*=)/;

/** HAML: `-#` opens a comment, and every other line is read on its own. */
const haml = (source) => source.split("\n").map((line) => line.length > LINE_READ || (!/^\s*-#/.test(line) && HAML_CODE.test(line)));

/** Slim: `/` opens a comment, and every other line is read on its own. */
const slim = (source) => source.split("\n").map((line) => line.length > LINE_READ || (!SLIM_COMMENT.test(line) && SLIM_CODE.test(line)));

/** Jinja: an expression `{{ }}` or a statement `{% %}` asks where it computes; `{# #}` is a comment. */
const jinja = (source) =>
  source.split("\n").map(
    (line) =>
      line.length > LINE_READ ||
      [...line.replace(/\{#[\s\S]*?#\}|\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g, "").matchAll(/\{\{([\s\S]*?)\}\}|\{%-?([\s\S]*?)-?%\}/g)].some((m) => COMPUTES.test(m[1] ?? m[2]))
  );

// What a Go template action may hold and compute nothing with: its own keywords and its literals.
const GO_KEYWORDS = new Set(["if", "else", "end", "range", "with", "define", "template", "block", "break", "continue", "nil", "true", "false"]);

/** A Go template: an action asks where it calls a function, which it writes as a bare word, `printf`, `gt`, `and`. */
const gotmpl = (source) =>
  source.split("\n").map((line) => line.length > LINE_READ ||
    [...line.matchAll(/\{\{-?([\s\S]*?)-?\}\}/g)].some(({ 1: action }) => {
      if (action.trim().startsWith("/*")) return false;
      const words = action.replace(/"(?:[^"\\]|\\.)*"|`[^`]*`/g, "").match(/(?<![.$\w])[A-Za-z_]\w*/g) ?? [];
      return words.some((word) => !GO_KEYWORDS.has(word)) || /\|/.test(action);
    })
  );

const RULES = { erb, razor, haml, slim, jinja, gotmpl };

/** Which of a template's lines hold no code, one entry per line: true where the line asks nothing. */
export function templateInertLines(kind, source) {
  return RULES[kind](source).map((asks) => !asks);
}

// What a component's markup computes inline that a helper could: arithmetic on a number, a method
// called with a number (`toFixed(2)`, `slice(0, 20)`), and a string built with `+`. A name, a call
// with names alone, a comparison and `n++` ask nothing: bindings write those everywhere, and the
// component's own logic is in its script, which is read whole.
const COMPONENT_COMPUTES = /\d\s*[+*/%-]|[+*/%-]\s*\d|\w\s*\(\s*\d|['"`]\s*\+|\+\s*['"`]/;

// Where a component's markup binds an expression: Vue's interpolation and its bound attributes, and
// Svelte's braces, a block tag's `{#if ...}` among them.
const MARKUP_EXPRESSIONS = {
  vue: [/\{\{([\s\S]*?)\}\}/g, /(?:^|\s)(?::[\w.-]+|v-[\w:.-]+|@[\w.-]+)="([^"]*)"/g],
  svelte: [/\{[#:@/]?(?:if|each|await|key|else|html|debug|const|render)?\s*([^{}]*)\}/g],
};

/**
 * Which lines of a component's markup hold an expression that computes inline, one entry per line:
 * true where the line asks. The script and style blocks are no markup and answer false here, since the
 * script is read by its own rule.
 */
export function markupCodeLines(kind, source) {
  let inside = null;
  return source.split("\n").map((line) => {
    if (inside !== null) {
      if (line.includes(`</${inside}`)) inside = null;
      return false;
    }
    const opened = /<(script|style)\b/.exec(line);
    if (opened) {
      if (!line.includes(`</${opened[1]}`)) inside = opened[1];
      return false;
    }
    if (line.length > LINE_READ) return true;
    return MARKUP_EXPRESSIONS[kind].some((pattern) => [...line.matchAll(pattern)].some((m) => COMPONENT_COMPUTES.test(m[1])));
  });
}
