/**
 * View templates whose code is in another language's syntax, and the markup of
 * a component: no scan reads either, and the end-of-turn reuse check does, since
 * a view is where a copy of a helper's logic is most often written. A rule per
 * kind says which lines hold code and which are markup alone. A line longer
 * than the rules read by pattern (`LINE_READ`) asks unread, as it does under
 * them: a minified line is a megabyte, and the rules run inside the stop's
 * budget. ERB's is read a character at a time, which costs no more on a long
 * line. A file not read by its deadline asks on every line that is not blank.
 */
import { assertKeyed, EXTRACTORS } from "./langs.mjs";
import { LINE_READ } from "./limits.mjs";

const KINDS = [
  // A configuration file run through ERB is no view, and no helper answers one.
  [null, /\.ya?ml\.erb$/],
  // EJS writes ERB's tags.
  ["erb", /\.(?:erb|ejs)$/],
  ["razor", /\.(?:cshtml|razor)$/],
  ["haml", /\.haml$/],
  ["slim", /\.slim$/],
  // A plain `.html` file is anybody's: Angular, Vue, Django or markup alone, and no one rule reads all of them.
  // Twig and Nunjucks write Jinja's tags.
  ["jinja", /\.(?:jinja2?|j2|twig|njk)$/],
  ["gotmpl", /\.(?:tmpl|gotmpl|gohtml)$/],
];

// A rule reads the clock once in this many lines or tags: one costs microseconds.
const CLOCK_EVERY = 64;

/** Whether `deadline` has passed, asked of the clock on the first call and once in `CLOCK_EVERY` after. */
function clockFor(deadline) {
  let left = 1;
  return () => {
    if (--left > 0) return false;
    left = CLOCK_EVERY;
    return performance.now() > deadline;
  };
}

// What a rule answers for a file it did not read by its deadline.
const LATE = Symbol("late");

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
function erb(source, late) {
  const asks = new Array(source.split("\n").length).fill(false);
  let state = "markup";
  let row = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\n") {
      row++;
      if (late()) return LATE;
    } else if (state === "markup") {
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
function razor(source, late) {
  const lines = source.split("\n");
  const asks = new Array(lines.length).fill(false);
  let depth = 0;
  let comment = false;
  // A statement seen whose `{` is on a later line, and a block just closed that an `else` may go on from.
  let opening = false;
  let closed = false;
  for (const [i, raw] of lines.entries()) {
    if (late()) return LATE;
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

// HAML: a line of Ruby (`-`), an output line (`=`, `==`, `~`, `!=`, `&=`), a tag whose content is
// output, an attribute bound to Ruby, and an interpolation. A `{ }` attribute hash is Ruby, and so is
// an attribute in `( )` whose value is unquoted.
const HAML_CODE = /^\s*(?:-(?!#)|[=~]|[!&]=)|^\s*[%.#][\w.#:-]*(?:\{[^}]*\}|\([^)]*\))?\s*(?:[=~]|[!&]=)|^\s*[%.#][\w.#:-]*\{|^\s*[%.#][\w.#:-]*\([^)]*\w=(?!["'])|#\{/;

/**
 * The lines a HAML or Slim file runs as Ruby, each read on its own by `asks` but those a Ruby filter
 * holds, HAML's `:ruby` and Slim's `ruby:`, which are Ruby through the last line indented past it,
 * and the line after one of Ruby that ends in a comma, which carries it on.
 */
function indented(source, late, filter, asks) {
  const lines = source.split("\n");
  const out = new Array(lines.length).fill(false);
  let under = null;
  let carried = false;
  for (const [i, line] of lines.entries()) {
    if (late()) return LATE;
    if (line.length > LINE_READ) {
      [out[i], carried] = [true, false];
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (under !== null && (line.trim() === "" || indent > under)) {
      out[i] = line.trim() !== "";
      continue;
    }
    under = filter.test(line) ? indent : null;
    out[i] = under === null && (carried || asks(line));
    carried = out[i] && line.trimEnd().endsWith(",");
  }
  return out;
}

/** HAML: `-#` opens a comment, and every other line is read on its own. */
const haml = (source, late) => indented(source, late, /^\s*:ruby\s*$/, (line) => !/^\s*-#/.test(line) && HAML_CODE.test(line));

// A Slim attribute, `name=value`, whose value is quoted or is Ruby up to the next space.
const SLIM_ATTRIBUTE = /\s*[\w:-]+\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s\])]+)/y;
const SLIM_COMMENT = /^\s*\/(?!\S*\s*=)/;

/**
 * Slim: a line of Ruby (`-`), an output line (`=`, `==`), an interpolation, and a tag with an attribute
 * bound to Ruby or with output after it. A tag's attributes run until the first word that is none, and
 * what follows is its text, `a=b` in it included.
 */
function slimAsks(line) {
  if (SLIM_COMMENT.test(line)) return false;
  if (/^\s*(?:-|==?)/.test(line) || line.includes("#{")) return true;
  const tag = /^\s*[\w.#:-]+/.exec(line);
  if (tag === null) return false;
  let at = tag[0].length;
  const wrapper = { "[": "]", "(": ")" }[line[at]];
  if (wrapper) at++;
  for (;;) {
    SLIM_ATTRIBUTE.lastIndex = at;
    const attribute = SLIM_ATTRIBUTE.exec(line);
    if (attribute === null) break;
    if (!/^["']/.test(attribute[1])) return true;
    at = SLIM_ATTRIBUTE.lastIndex;
  }
  const rest = line.slice(at).trimStart();
  return (wrapper && rest.startsWith(wrapper) ? rest.slice(1).trimStart() : rest).startsWith("=");
}

/** Slim: `/` opens a comment, and every other line is read on its own. */
const slim = (source, late) => indented(source, late, /^\s*ruby:\s*$/, slimAsks);

/**
 * The tags of a Jinja or Go template from offset `from` on, `{ open, from, to, body }`, a tag never
 * closed running to the end. `openers` matches what opens one, and `close` names what closes each.
 */
function* tagsOf(source, openers, close, from = 0) {
  for (let at = from; ; ) {
    openers.lastIndex = at;
    const opened = openers.exec(source);
    if (opened === null) return;
    const closer = close[opened[0]];
    const end = source.indexOf(closer, opened.index + opened[0].length);
    const to = end === -1 ? source.length : end + closer.length;
    yield { open: opened[0], from: opened.index, to, body: source.slice(opened.index + opened[0].length, end === -1 ? source.length : end) };
    if (end === -1) return;
    at = to;
  }
}

/** The lines `asks` says a template's tags hold code on: each line a tag that computes spans, and each line longer than the rules read. */
function byTags(source, late, tags, asks) {
  const lines = source.split("\n");
  const out = lines.map((line) => line.length > LINE_READ);
  let row = 0;
  let seen = 0;
  for (const tag of tags) {
    if (late()) return LATE;
    for (; seen < tag.from; seen++) if (source.charCodeAt(seen) === 10) row++;
    if (!asks(tag)) continue;
    let last = row;
    for (let at = tag.from; at < tag.to; at++) if (source.charCodeAt(at) === 10) last++;
    for (let i = row; i <= last; i++) out[i] ||= lines[i].trim() !== "";
  }
  return out;
}

// What a Jinja tag opens with, and what closes each: a comment, a statement and an expression.
const JINJA_OPENS = /\{[#%{]/g;
const JINJA_CLOSES = { "{#": "#}", "{%": "%}", "{{": "}}" };
const JINJA_RAW = /^-?\s*raw\s*-?$/;
const JINJA_ENDRAW = /\{%-?\s*endraw\s*-?%\}/g;

/** Jinja's tags, a raw block's text passed over whole. */
function* jinjaTags(source) {
  for (let at = 0; ; ) {
    let raw = null;
    for (const tag of tagsOf(source, JINJA_OPENS, JINJA_CLOSES, at)) {
      if (tag.open === "{%" && JINJA_RAW.test(tag.body.trim())) {
        raw = tag;
        break;
      }
      yield tag;
    }
    if (raw === null) return;
    JINJA_ENDRAW.lastIndex = raw.to;
    const end = JINJA_ENDRAW.exec(source);
    if (end === null) return;
    at = end.index + end[0].length;
  }
}

/** Jinja: an expression `{{ }}` or a statement `{% %}` asks where it computes; `{# #}` is a comment. */
const jinja = (source, late) => byTags(source, late, jinjaTags(source), (tag) => tag.open !== "{#" && COMPUTES.test(tag.body));

// What a Go template action may hold and compute nothing with: its own keywords and its literals.
const GO_KEYWORDS = new Set(["if", "else", "end", "range", "with", "define", "template", "block", "break", "continue", "nil", "true", "false"]);
const GO_OPENS = /\{\{/g;
const GO_CLOSES = { "{{": "}}" };

/** A Go template: an action asks where it calls a function, which it writes as a bare word, `printf`, `gt`, `and`. */
const gotmpl = (source, late) =>
  byTags(source, late, tagsOf(source, GO_OPENS, GO_CLOSES), ({ body }) => {
    const action = body.replace(/^-\s|\s-$/g, "");
    if (action.trim().startsWith("/*")) return false;
    const words = action.replace(/"(?:[^"\\]|\\.)*"|`[^`]*`/g, "").match(/(?<![.$\w])[A-Za-z_]\w*/g) ?? [];
    return words.some((word) => !GO_KEYWORDS.has(word)) || /\|/.test(action);
  });

const RULES = { erb, razor, haml, slim, jinja, gotmpl };

// A file not read by its deadline: every line but a blank one asks.
const unread = (source) => source.split("\n").map((line) => line.trim() !== "");

/** Which of a template's lines hold no code, one entry per line: true where the line asks nothing. */
export function templateInertLines(kind, source, deadline = Infinity) {
  const asks = RULES[kind](source, clockFor(deadline));
  return (asks === LATE ? unread(source) : asks).map((ask) => !ask);
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

assertKeyed("MARKUP_EXPRESSIONS", MARKUP_EXPRESSIONS, EXTRACTORS);

/**
 * Which lines of a component's markup hold an expression that computes inline, one entry per line:
 * true where the line asks. The script and style blocks are no markup and answer false here, since the
 * script is read by its own rule.
 */
export function markupCodeLines(kind, source, deadline = Infinity) {
  const late = clockFor(deadline);
  let inside = null;
  let read = true;
  const asks = source.split("\n").map((line) => {
    if (!read || late()) {
      read = false;
      return false;
    }
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
  return read ? asks : unread(source);
}
