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
  prism: { '"': /"(?:[^"\\#]|\\.)*"/y, "'": /'(?:[^'\\]|\\.)*'/y },
};
const NAME = { oxc: String.raw`(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:\s*[\w$.<>[\]|&, ]+?)?`, prism: String.raw`[A-Za-z_]\w*` };
const INERT = {
  oxc: {
    bind: new RegExp(String.raw`^${NAME.oxc}\s*=\s*(?:\0(?:\s+as\s+const)?\s*;?|([[{]))$`),
    other: new RegExp(
      String.raw`^(?:import\s+(?:type\s+)?(?:[\w$\s,{}*\0]+?\s+from\s+)?\0|export\s+(?:type\s+)?[\w$\s,{}*]+?\s+from\s+\0|(?:(?:const|let|var)\s+(?:[\w$]+|\{[\w$\s,:]*\})\s*=\s*)?require\(\0\)(?:\.[\w$]+)?|\0|[\]})]+(?:\s*as\s+const)?\s*[,;]?)\s*;?$`
    ),
    block: /^(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{$/,
    blockEnd: /^\}\s*from\s+\0\s*;?$/,
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
      // A block comment this did not see open may end in it, with code after the end.
      if (line.includes("*/", i)) return { code: null, open: null };
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
        // Odd quotes leave a string running on; a closed one this does not read is no literal.
        const odd = line.slice(i).split(c).length % 2 === 0;
        return { code: null, open: odd && (engine === "prism" || c === "`") ? c : null };
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

/**
 * Which of a file's lines provably define nothing callable, blank ones
 * included. A file not read by `deadline` asks about every other line.
 */
function inertLines(engine, lines, deadline) {
  const rule = INERT[engine];
  const unread = () => lines.map((line) => line.trim() === "");
  const inert = unread();
  let open = null;
  let depth = 0;
  let due = 0;
  for (let i = 0; i < lines.length; i++) {
    // By line number and not by count, since a braced import moves `i` on by its length.
    if (i >= due) {
      if (performance.now() > deadline) return unread();
      due = i + CLOCK_LINES;
    }
    const line = lines[i];
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
      continue;
    }
    if (inert[i]) continue;
    if (line.length > LINE_READ) {
      depth = 0;
      continue;
    }
    if (engine === "prism") {
      if (line.startsWith("=begin")) {
        [inert[i], open] = [true, "=end"];
        continue;
      }
      const heredoc = /<<[~-]?(["'`]?)([A-Za-z_]\w*)\1/.exec(line);
      if (heredoc !== null) {
        [open, depth] = [`<<${heredoc[2]}`, 0];
        continue;
      }
    }
    const { code, open: left } = reduce(engine, line);
    open = left;
    if (code === null) {
      depth = 0;
      continue;
    }
    if (code === "") inert[i] = true;
    else if (depth > 0 && rule.member.test(code)) {
      inert[i] = true;
      depth += code.split(/[[{]/).length - code.split(/[\]}]/).length;
    } else if (rule.other.test(code)) {
      inert[i] = true;
      depth = Math.max(0, depth - (code.split(/[\]}]/).length - 1));
    } else {
      const bound = rule.bind.exec(code);
      depth = bound?.[1] ? 1 : 0;
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
  return inert;
}

const byLine = ({ engine, source, deadline }) => inertLines(engine, source.split("\n"), deadline);

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
