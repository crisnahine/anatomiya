/**
 * Which of a file's lines provably define nothing callable: the one question
 * the end-of-turn reuse check asks a parser or a lexer (A91).
 *
 * oxc and prism files are read by a line rule per engine, which needs no
 * parse. Tree-sitter files are parsed in this process by an adapter loaded on
 * the first one a stop reaches, so a JavaScript or Ruby stop never loads it.
 * Every answer is a list with one entry per line, true where the line asks
 * nothing; null says no rule reads the file, and it is not asked about.
 */
import { LINE_READ } from "./limits.mjs";

/**
 * How long reading the changed files of one stop may take, all of them
 * together: the line rules over its JavaScript and Ruby files, and for its
 * tree-sitter files the first load of the runtime and of each grammar, every
 * parse and every walk of a parsed tree. A file that does not fit asks about
 * every line.
 *
 * A line rule costs microseconds a line, so it meets the deadline only on a
 * file built to be slow.
 *
 * One run stands behind the number: parse plus walk of the three largest
 * files of each of the seven tree-sitter languages in the 25 repositories of
 * the language corpus, 21 files of 68 to 451 KiB, each read once to warm and
 * then timed five times. They took 34 to 875 ms at the median and 1,018 ms at
 * most, at a load average of 34 to 35: at that load the largest file ran out
 * the budget in one read of five, and asks whole when it does.
 */
export const REUSE_PARSE_MS = 1000;

// The only lines a hunk may hold and still ask nothing, per engine: a comment,
// an import, a name bound to a literal or a member of one, and a closing
// bracket. Anything else may define something callable, so it asks.
const V = "\0";
const KEY = { oxc: String.raw`(?:[A-Za-z_$][\w$]*|\0|\[\0\])\s*:\s*`, prism: String.raw`(?:[A-Za-z_]\w*[?!]?:\s*|\0:?\s*=>\s*|\0:\s*)` };
const LITERAL = {
  oxc: /(?<![\w$.])-?(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?(?![\w$])|(?<![\w$.])(?:true|false|null|undefined)(?![\w$])/g,
  prism:
    /%[wi](?:\[[^\]]*\]|\([^)]*\))|(?<![\w:]):[A-Za-z_]\w*[?!=]?|(?<![\w.])-?(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?![\w])|(?<![\w.:])(?:true|false|nil)(?![\w?!])/g,
};
const STRING = {
  oxc: { '"': /"(?:[^"\\]|\\.)*"/y, "'": /'(?:[^'\\]|\\.)*'/y, "`": /`(?:[^`\\$]|\\.)*`/y },
  // An interpolation in single quotes is text in plain code and runs inside a literal spread over lines, which this does not track.
  prism: { '"': /"(?:[^"\\#]|\\.)*"/y, "'": /'(?:[^'\\#]|\\.|#(?!\{))*'/y },
};
const NAME = { oxc: String.raw`(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:\s*[\w$.<>[\]|&, ]+?)?`, prism: String.raw`[A-Za-z_]\w*` };
const INERT = {
  oxc: {
    bind: new RegExp(String.raw`^${NAME.oxc}\s*=\s*(?:\0(?:\s+as\s+const)?\s*;?|([[{]))$`),
    other: new RegExp(
      String.raw`^(?:import\s+(?:type\s+)?(?:[\w$\s,{}*\0]+?\s+from\s+)?\0|export\s+(?:type\s+)?[\w$\s,{}*]+?\s+from\s+\0|(?:(?:const|let|var)\s+(?:[\w$]+|\{[\w$\s,:]*\})\s*=\s*)?require\(\0\)(?:\.[\w$]+)?|\0|[\]})]+(?:\s*as\s+const[\])]*)?\s*[,;]?)\s*;?$`
    ),
    block: /^(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{$/,
    blockEnd: /^\}\s*from\s+\0\s*;?$/,
    // A list or an object opened as an argument, after `(` or `,`: the line calls and asks, its members are data.
    call: /[(,]\s*((?:[[{]\s*)+)$/,
  },
  prism: {
    bind: new RegExp(String.raw`^${NAME.prism}\s*=\s*(?:\0(?:\.freeze)?|([[{]))$`),
    other: /^(?:require(?:_relative)?(?:\s+\0|\s*\(\s*\0\s*\))|(?:end|[\]})]+)(?:\.freeze)?,?)$/,
  },
};
for (const [engine, rule] of Object.entries(INERT)) {
  const member = String.raw`(?:${KEY[engine]})?\0`;
  const list = String.raw`\s*(?:${member}\s*,\s*)*(?:${member}\s*,?\s*)?`;
  rule.collection = new RegExp(String.raw`\[${list}\]|\{${list}\}`, "g");
  rule.member = new RegExp(String.raw`^(?:[\]}]+\s*,\s*)?(?:${KEY[engine]})?(?:\0|[[{])\s*,?$`);
}

// A line rule reads the clock once in this many lines: a line costs microseconds.
const CLOCK_LINES = 64;

// A name inside a braced import or re-export, or a blank line between them.
const BLOCK_NAME = /^$|^(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?\s*,?$/;

/**
 * A line with its strings, numbers and literal collections each read as one
 * value and its comment dropped, or what it leaves open: a block comment, a
 * string or a heredoc that runs on to a later line.
 */
function reduce(engine, line) {
  const strings = STRING[engine];
  let out = "";
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (engine === "prism" && c === "#") {
      // Inside a regex or a percent literal spread over lines it is no comment, and an interpolation runs.
      if (line.includes("#{", i)) return { code: null, open: null };
      break;
    }
    if (engine === "oxc" && c === "/" && line[i + 1] === "/") {
      // A block comment this did not see open may end in it, with code after the end. And behind code it may
      // stand inside a regex, where a template literal opened after it on the line would be lost.
      if (line.includes("*/", i) || (out.trim() !== "" && line.includes("`", i))) return { code: null, open: null };
      break;
    }
    if (engine === "oxc" && c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        // After code it may be a regex's `/` and its quantifier, which opens nothing. One `{` alone
        // starts no regex, and JSX opens its comments behind one.
        if (!/^\s*\{?\s*$/.test(out)) return { code: null, open: null };
        return { code: "", open: "*/" };
      }
      i = end + 2;
      out += " ";
      continue;
    }
    if (c in strings) {
      const re = strings[c];
      re.lastIndex = i;
      if (!re.test(line)) {
        // A closed string this does not read is no literal. A JavaScript quote runs on only behind a
        // backslash that ends the line; any other string does where its quotes are odd.
        const runsOn = engine === "oxc" && c !== "`" ? /\\\r?$/.test(line) : line.slice(i).split(c).length % 2 === 0;
        return { code: null, open: runsOn ? c : null };
      }
      out += V;
      i = re.lastIndex;
      continue;
    }
    out += c;
    i++;
  }
  // One character per run of whitespace, so no pattern has a run to split between two of its parts.
  // A run that held anything but spaces stays a tab: a type is read over spaces alone.
  let code = out.replace(LITERAL[engine], V).trim().replace(/\s{2,}/g, (run) => (/[^ ]/.test(run) ? "\t" : " "));
  const { collection } = INERT[engine];
  for (let before = ""; before !== code; ) [before, code] = [code, code.replace(collection, V)];
  return { code, open: null };
}

// A line that opens like a comment and holds an expression in braces, other than a doc comment. In JSX
// children `//` and `/*` are text, so the braces run: measured, 3 lines of excalidraw's .tsx and .jsx files
// hold one, and every one is a real comment, which is the false ask this costs.
const JSX_TEXT = /^\s*(?:\/\/|\/\*(?!\*)).*\{[^}\s][^}]*\}/;

// A closing tag or a self-closing one: a `.js` file that holds JSX.
const JSX_TAG = /<\/[A-Za-z]|\/>/;

/**
 * Which of a file's lines provably define nothing callable, blank ones
 * included. A file not read by `deadline` asks about every other line.
 * `jsx` says the file may hold JSX, where text can begin like a comment.
 */
function inertLines(engine, lines, deadline, jsx = false) {
  const rule = INERT[engine];
  const unread = () => lines.map((line) => line.trim() === "");
  const inert = unread();
  let open = null;
  let opened = 0;
  let depth = 0;
  // Whether the literal open at `depth` is an argument, where a member may follow a value the line above left callable.
  let called = false;
  // Whether the line before is one this did not read, so what it left open is not known.
  let unseen = false;
  let due = 0;
  for (let i = 0; i < lines.length; i++) {
    // By line number and not by count, since a braced import moves `i` on by its length.
    if (i >= due) {
      if (performance.now() > deadline) return unread();
      due = i + CLOCK_LINES;
    }
    const line = lines[i];
    const blind = unseen;
    unseen = false;
    if (open !== null) {
      // Inside a comment is inert; inside a string or a heredoc is not a literal this reads.
      const comment = open === "*/" || open === "=end";
      const closed = open === "=end" ? line.startsWith("=end") : open.startsWith("<<") ? line.trim() === open.slice(2) : line.includes(open);
      if (comment) {
        // The brace that ends a JSX comment reads as it does on a line of its own.
        const after = closed ? line.slice(line.indexOf(open) + open.length).trim() : "";
        inert[i] = after === "" || after === "}";
        if (after === "}") depth = Math.max(0, depth - 1);
      }
      if (closed) open = null;
      unseen = !inert[i];
      continue;
    }
    if (inert[i]) continue;
    if (line.length > LINE_READ) {
      [depth, unseen] = [0, true];
      continue;
    }
    if (engine === "prism") {
      if (line.startsWith("=begin")) {
        [inert[i], open, opened] = [true, "=end", i];
        continue;
      }
      const heredoc = /<<[~-]?(["'`]?)([A-Za-z_]\w*)\1/.exec(line);
      if (heredoc !== null) {
        [open, depth] = [`<<${heredoc[2]}`, 0];
        continue;
      }
    }
    const reduced = reduce(engine, line);
    // Under a line this did not read, the opening of a comment may be text of what that line left open.
    const { code, open: left } = blind && reduced.open === "*/" ? { code: null, open: null } : reduced;
    [open, opened] = [left, i];
    if (code === null) {
      [depth, unseen] = [0, true];
      continue;
    }
    if (code === "") inert[i] = !(jsx && JSX_TEXT.test(line));
    // In an argument a template on its own line may be tagged by the line above, which calls.
    else if (depth > 0 && rule.member.test(code) && !(called && line.includes("`"))) {
      inert[i] = true;
      depth += code.split(/[[{]/).length - code.split(/[\]}]/).length;
    } else if (rule.other.test(code)) {
      inert[i] = true;
      depth = Math.max(0, depth - (code.split(/[\]}]/).length - 1));
    } else {
      const bound = rule.bind.exec(code);
      const argument = bound === null && !rule.block?.test(code) ? rule.call?.exec(code) : null;
      depth = bound?.[1] ? 1 : (argument?.[1].replace(/\s/g, "").length ?? 0);
      called = Boolean(argument);
      inert[i] = bound !== null;
      if (bound === null && rule.block?.test(code)) {
        // A braced import or re-export spread over lines, read up to its `from`.
        let j = i + 1;
        const names = (k) => reduce(engine, lines[k]).code;
        while (j < lines.length && lines[j].length <= LINE_READ && BLOCK_NAME.test(names(j) ?? "-")) j++;
        if (j < lines.length && rule.blockEnd.test(names(j) ?? "")) {
          for (let k = i; k <= j; k++) inert[k] = true;
          i = j;
        }
      }
    }
  }
  // A comment that never closes was none: text that began like one, with code this did not read under it.
  if (open === "*/" || open === "=end") for (let k = opened; k < lines.length; k++) inert[k] = lines[k].trim() === "";
  return inert;
}

const byLine = ({ engine, lang, source, deadline }) =>
  inertLines(engine, source.split("\n"), deadline, lang === "jsx" || (lang === "js" && JSX_TAG.test(source)));

async function byTree({ lang, source, deadline, grammars }) {
  const { treeInertLines } = await import("./inert-tree.mjs");
  return treeInertLines(source, lang, deadline, { grammars });
}

const READERS = { oxc: byLine, prism: byLine, "tree-sitter": byTree };

/** The engines a rule reads. A language routed anywhere else asks nothing. */
export const INERT_ENGINES = Object.keys(READERS);

/**
 * The lines of one file that define nothing callable, or null where no rule
 * reads it. `deadline` is the moment on `performance.now()`'s clock past
 * which a line rule, a parse or a walk stops and its file asks; `grammars` is
 * a test override.
 */
export async function inertLinesOf(file) {
  return Object.hasOwn(READERS, file.engine) ? READERS[file.engine](file) : null;
}
