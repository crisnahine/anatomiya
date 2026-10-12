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

/** The engines a rule reads. A language routed anywhere else asks nothing. */
export const INERT_ENGINES = ["oxc", "prism", "tree-sitter"];

/**
 * How long the tree-sitter parses of one stop may take, all of them together.
 *
 * The largest files under the size the parser reads parse in 350 to 450 ms, so
 * one such file fits, and the stop still answers inside the timeout the hook
 * declares. A file reached after it is asked about unread.
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

// A name inside a braced import or re-export, or a blank line between them.
const BLOCK_NAME = /^$|^(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?\s*,?$/;

// Past this a line asks unread, which bounds what each search costs.
const LINE_READ = 400;

/**
 * A line with its strings, numbers and literal collections each read as one
 * value and its comment dropped, or what it leaves open: a block comment, a
 * string or a heredoc that runs on to a later line.
 */
function reduce(engine, line) {
  const strings = STRING[engine];
  let out = "";
  let open = null;
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if ((engine === "prism" && c === "#") || (engine === "oxc" && c === "/" && line[i + 1] === "/")) break;
    if (engine === "oxc" && c === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        open = "*/";
        break;
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
  let code = out.replace(LITERAL[engine], V).trim();
  const { collection } = INERT[engine];
  for (let before = ""; before !== code; ) [before, code] = [code, code.replace(collection, V)];
  return { code, open };
}

/** Which of a file's lines provably define nothing callable, blank ones included. */
function inertLines(engine, lines) {
  const rule = INERT[engine];
  const inert = lines.map((line) => line.trim() === "");
  let open = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open !== null) {
      // Inside a comment is inert; inside a string or a heredoc is not a literal this reads.
      const comment = open === "*/" || open === "=end";
      const closed = open === "=end" ? line.startsWith("=end") : open.startsWith("<<") ? line.trim() === open.slice(2) : line.includes(open);
      if (comment) inert[i] = !closed || line.slice(line.indexOf(open) + open.length).trim() === "";
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

/**
 * The lines of one file that define nothing callable, or null where no rule
 * reads it. `deadline` is the moment on `performance.now()`'s clock past
 * which a parse stops and its file asks; `grammars` is a test override.
 */
export async function inertLinesOf({ engine, lang, source, deadline, grammars }) {
  if (engine in INERT) return inertLines(engine, source.split("\n"));
  if (engine !== "tree-sitter") return null;
  const { treeInertLines } = await import("./inert-tree.mjs");
  return treeInertLines(source, lang, deadline, { grammars });
}
