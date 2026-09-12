/**
 * What this plugin ships to orchestrate with, read off the files that ship it.
 *
 * A plugin workflow loads and resolves under `<plugin>:<meta.name>`, and nothing
 * upstream ever tells the model it is there: the hook that would append a
 * listing to the Workflow tool's description is a stub, and the only place a
 * name reaches the model is the error raised when one does not resolve. So the
 * catalogue is the half of the feature that makes the other half reachable.
 *
 * The meta is read here rather than held as a list, because a list is a second
 * place for one fact and the sentence a model reads would drift from the files
 * it describes. The plugin carries no dependencies, so this is a scanner over
 * the pure-literal grammar the build itself fast-paths when it reads a
 * plugin workflow with `validateBody:false`. `scripts/workflow-lint.mjs` holds
 * every answer here against a real parse, which is what keeps a hand-written
 * reader honest.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

import { readIfFile } from "./hook-io.mjs";

/** Where the loader looks for this plugin's workflows when the manifest names nowhere else. */
export const WORKFLOWS_DIR = "workflows";

/**
 * This plugin's own name, which is the prefix every shipped name resolves under.
 *
 * Here rather than in each hook: both build the same sentence, and a name
 * spelled twice is a name that can differ in one place. It has to match the
 * manifest, and `test/catalogue.test.mjs` reads the manifest to say so.
 */
export const PLUGIN = "ultracode-anywhere";

/**
 * The size the loader skips a workflow at rather than truncating it.
 *
 * Held here because this is where a file is read for the catalogue: without it
 * the read stops at hook-io's own megabyte, and the sentence would name a
 * workflow the loader passed over for being too big. `scripts/workflow-lint.mjs`
 * re-exports this rather than spelling it again.
 */
export const SCRIPT_MOST = 524_288;

/**
 * The shipped catalogue, found beside this file rather than beside the caller.
 *
 * Both hooks need the same directory and neither may import the other, so the
 * lookup lives with the reader that uses it.
 */
export function shippedHere() {
  return shippedIn(join(dirname(fileURLToPath(import.meta.url)), "..", WORKFLOWS_DIR));
}

/**
 * A name the tool can resolve and a code span can hold.
 *
 * The sentence quotes a name inside backticks and the model passes it back as
 * `Workflow({name})`, so a name carrying a backtick, a line break or a quote
 * breaks out of both. Refused rather than escaped: a workflow nobody can name
 * is not one to advertise. Exported because the gate has to refuse the same
 * names before one ships, and a second spelling of the class would be a name
 * one of them accepts and the other drops in silence.
 */
export const RESOLVABLE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The declaration this reads, and the only statement that may come before the body. */
const OPENS = /^export[ \t\r\n]+const[ \t\r\n]+meta[ \t\r\n]*=[ \t\r\n]*(?=\{)/;

/**
 * What may not follow the literal: another declarator.
 *
 * The build requires exactly one and skips a file with two. A second one always
 * opens with a comma, so that is the whole test, and it is asked after the
 * whitespace and comments rather than on the literal's own line: a comma can sit
 * on the next line or behind a comment, and a check reading one line reads `\r`
 * on a CRLF checkout as something other than the end of it.
 */
const ANOTHER = ",";

/** Keys a meta literal may not carry, read off the build's own refusal set. */
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The meta a workflow script declares, or null for anything this cannot read
 * whole.
 *
 * Null rather than a partial answer at every refusal: what this feeds is a
 * sentence telling the model a workflow exists and when to reach for it, and a
 * half-read meta names a workflow whose description is wrong. A file this
 * refuses is a file the lint fails on, so the refusal is loud somewhere.
 */
export function metaIn(text) {
  const source = String(text ?? "");
  const from = afterComments(source, 0);
  const opens = OPENS.exec(source.slice(from));
  if (!opens) return null;

  let read;
  try {
    read = readObject(source, from + opens[0].length);
  } catch {
    // Anything the grammar below refuses: an identifier, a call, a spread, an
    // interpolation, a key this may not carry.
    return null;
  }

  // `export const meta = {…}, second = 1` is two declarators, and the build
  // requires exactly one: it skips such a file, so reading it would advertise a
  // workflow nobody can run.
  if (source[afterComments(source, read.end)] === ANOTHER) return null;

  const { name, description, whenToUse } = read.value;
  if (!isText(name) || !isText(description)) return null;
  return { name, description, whenToUse: isText(whenToUse) ? whenToUse : null };
}

/** Whether a value is a string with something in it, which is what the build requires. */
const isText = (value) => typeof value === "string" && value.length > 0;

/**
 * Every workflow this plugin ships, by name.
 *
 * Sorted, because the sentence built from this goes into a prompt: a listing
 * ordered by whatever the filesystem answered would differ between machines
 * and between runs on one machine, and a prompt that changes for no reason
 * costs a cache prefix and reads as a change to anyone diffing two sessions.
 *
 * A file whose meta this cannot read is passed over rather than thrown on. The
 * build does the same, and a hook may not fail a turn over a file somebody else
 * put in the directory.
 *
 * The listing is a parameter because the order it answers in is the thing the
 * sort exists to make not matter, and this filesystem answers sorted: a case
 * that cannot hand it an unsorted listing cannot see the tie-break work.
 */
export function shippedIn(dir, { list = readdirSync } = {}) {
  let entries;
  try {
    entries = list(dir);
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.endsWith(".js")) continue;
    const meta = metaIn(readIfFile(join(dir, entry), SCRIPT_MOST));

    // A name outside this class is one the sentence cannot quote and the tool
    // cannot resolve, so naming it would point the model at nothing.
    if (meta && RESOLVABLE.test(meta.name)) found.push({ file: entry, meta });
  }
  // `localeCompare` is not a total order: two distinct names can collate equal,
  // and the tie then fell to whatever `readdir` answered, which differs between
  // machines. The code-unit order breaks it, and the file name breaks that.
  return found.sort((a, b) => a.meta.name.localeCompare(b.meta.name, "en") || order(a.meta.name, b.meta.name) || order(a.file, b.file));
}

/**
 * The paragraph that tells the model these exist, or null where none do.
 *
 * It names each one the way the tool resolves it, `<plugin>:<name>`, since a
 * bare name answers "not found" and the model has no listing to correct itself
 * against.
 *
 * Directive rather than a menu, and that is the whole point of the plugin: a
 * shipped workflow has been written once, gated, and run the same way every
 * time, where a script improvised this turn has been none of those. So running
 * one is the default for work of its shape and writing a fresh script for that
 * shape is the exception. It stops short of telling the model to ignore what it
 * has been told elsewhere, because a hook cannot do that and text claiming
 * otherwise only teaches a reader to discount the rest.
 */
export function catalogueLine(shipped, plugin) {
  if (!Array.isArray(shipped) || shipped.length === 0) return null;
  const entries = shipped.map(({ meta }) => `- \`${plugin}:${meta.name}\`: ${meta.whenToUse ?? meta.description}`);
  const count = shipped.length === 1 ? "One orchestration ships" : `${shipped.length} orchestrations ship`;
  return (
    `${count} with this plugin, already written, gated and tested. Nothing else in this session will mention ` +
    `them: Claude Code loads a plugin's workflows but never lists them, so this is the only notice you get.\n\n` +
    `${entries.join("\n")}\n\n` +
    `When the work in front of you is one of those shapes, run it by name with ` +
    `Workflow({name: '${plugin}:<name>', args: <what to work on>}) rather than writing a script of your own. ` +
    `Each already does the fan-out, the independent checking and the merge, so an improvised script for the same ` +
    `shape is a worse copy of one that is known to work. Write your own for work none of them covers, and stay ` +
    `solo for work that earns no fan-out at all.`
  );
}

/** A total order over two strings, by code unit. */
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Where a run of whitespace and comments ends, since neither is a statement. */
function afterComments(text, at) {
  let i = at;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      if (end < 0) return text.length;
      i = end + 1;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return text.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

/** One object literal, answering its value and where it ended. */
function readObject(text, at) {
  let i = afterComments(text, at);
  if (text[i] !== "{") throw new Error("not an object");
  i = afterComments(text, i + 1);

  const value = {};
  if (text[i] === "}") return { value, end: i + 1 };
  for (;;) {
    const key = readKey(text, i);
    // The build refuses these outright rather than dropping them, and a reader
    // that dropped one would answer a meta the build never accepted.
    if (RESERVED.has(key.value)) throw new Error("reserved key");
    i = afterComments(text, key.end);
    if (text[i] !== ":") throw new Error("not a plain property");
    const read = readValue(text, i + 1);
    // Defined rather than assigned: a plain assignment to a key that names an
    // accessor on Object.prototype runs the setter instead of making a
    // property, which is the same reason `hook-io.mjs` defines its own.
    Object.defineProperty(value, key.value, { value: read.value, writable: true, enumerable: true, configurable: true });
    i = afterComments(text, read.end);
    if (text[i] === ",") {
      i = afterComments(text, i + 1);
      if (text[i] === "}") return { value, end: i + 1 };
      continue;
    }
    if (text[i] === "}") return { value, end: i + 1 };
    throw new Error("unterminated object");
  }
}

/** One array literal, answering its value and where it ended. */
function readArray(text, at) {
  let i = afterComments(text, at + 1);
  const value = [];
  if (text[i] === "]") return { value, end: i + 1 };
  for (;;) {
    // A hole needs no case of its own: `readValue` is what stands at the
    // comma, and a comma is not a literal. The build names sparse arrays in a
    // refusal of its own, and a guard here mirroring it never once changed the
    // answer.
    const read = readValue(text, i);
    value.push(read.value);
    i = afterComments(text, read.end);
    if (text[i] === ",") {
      i = afterComments(text, i + 1);
      if (text[i] === "]") return { value, end: i + 1 };
      continue;
    }
    if (text[i] === "]") return { value, end: i + 1 };
    throw new Error("unterminated array");
  }
}

const KEY = /^[A-Za-z_$][A-Za-z0-9_$]*/;

/** A property name: bare or quoted, and never computed. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

function readKey(text, at) {
  const i = afterComments(text, at);
  if (text[i] === '"' || text[i] === "'") return readString(text, i);
  const bare = KEY.exec(text.slice(i));
  if (bare) return { value: bare[0], end: i + bare[0].length };
  // A numeric key is a key: the build reads any literal one as
  // `String(value)`, so refusing it here drops a workflow the loader reads.
  const number = NUMBER.exec(text.slice(i));
  if (number) return { value: String(Number(number[0])), end: i + number[0].length };
  // `[expr]` is a computed key and `...x` a spread, both refused upstream.
  throw new Error("computed or unsupported key");
}

/** One literal value of any shape the meta grammar allows. */
function readValue(text, at) {
  const i = afterComments(text, at);
  const c = text[i];
  if (c === '"' || c === "'") return readString(text, i);
  if (c === "`") return readTemplate(text, i);
  if (c === "{") return readObject(text, i);
  if (c === "[") return readArray(text, i);
  if (text.startsWith("true", i)) return { value: true, end: i + 4 };
  if (text.startsWith("false", i)) return { value: false, end: i + 5 };
  if (text.startsWith("null", i)) return { value: null, end: i + 4 };
  const number = NUMBER.exec(text.slice(i));
  // A leading `-` is the one unary the build allows, and only on a number.
  if (number) return { value: Number(number[0]), end: i + number[0].length };
  // An identifier, a call, anything with a name in it: not a literal.
  throw new Error("not a literal");
}

/**
 * One quoted string, decoded.
 *
 * The escapes are read here rather than handed to `JSON.parse`, because a
 * single-quoted string is not JSON and the meta blocks people write use single
 * quotes throughout.
 */
function readString(text, at) {
  const quote = text[at];
  let out = "";
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      const read = readEscape(text, i + 1);
      out += read.value;
      i = read.end - 1;
      continue;
    }
    if (c === quote) return { value: out, end: i + 1 };
    // A line feed or a carriage return ends a quoted string for the parser too,
    // and a reader that carried one read a meta no build would accept. The two
    // separators are not in that set: a string literal has been allowed to hold
    // U+2028 and U+2029 since ES2019, so refusing them here would drop a
    // workflow the build loads.
    if (c === "\n" || c === "\r") break;
    out += c;
  }
  throw new Error("unterminated string");
}

/** A template literal, which is a string only while it interpolates nothing. */
function readTemplate(text, at) {
  let out = "";
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      const read = readEscape(text, i + 1);
      out += read.value;
      i = read.end - 1;
      continue;
    }
    if (c === "$" && text[i + 1] === "{") throw new Error("template interpolation");
    if (c === "`") return { value: out, end: i + 1 };
    // A template normalises its line endings: the parser reads CRLF as one
    // newline, so carrying the pair through makes this reader and the parse
    // disagree about the same file on a CRLF checkout.
    if (c === "\r") {
      out += "\n";
      if (text[i + 1] === "\n") i++;
      continue;
    }
    out += c;
  }
  throw new Error("unterminated template");
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };

/** What one backslash escape stands for, and where it ends. */
function readEscape(text, at) {
  const c = text[at];
  if (c === undefined) throw new Error("unterminated escape");
  if (c === "u") {
    if (text[at + 1] === "{") {
      const close = text.indexOf("}", at + 2);
      if (close < 0) throw new Error("unterminated escape");
      // Hex and nothing else, which is what the build's own escape pattern
      // requires. `Number.parseInt` stops at the first character it cannot use,
      // so it reads `\u{41zz}` as `A` and answers a meta for a file no parser
      // will load.
      const digits = text.slice(at + 2, close);
      if (!/^[0-9a-fA-F]+$/.test(digits)) throw new Error("bad escape");
      const code = Number.parseInt(digits, 16);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new Error("bad escape");
      return { value: String.fromCodePoint(code), end: close + 1 };
    }
    return { value: codeUnit(text.slice(at + 1, at + 5)), end: at + 5 };
  }
  if (c === "x") return { value: codeUnit(text.slice(at + 1, at + 3)), end: at + 3 };
  // A line continuation carries nothing, and it is any line terminator: on a
  // CRLF file it is two characters, and reading one leaves the other to end the
  // string. Every other escape stands for the character itself, which is what
  // the quote and backslash cases need.
  if (c === "\r") return { value: "", end: at + (text[at + 1] === "\n" ? 2 : 1) };
  if (c === "\n" || c === "\u2028" || c === "\u2029") return { value: "", end: at + 1 };
  // Every workflow file is a module and every module is strict, so the legacy
  // escapes are a SyntaxError rather than a character: `\\8` and `\\9` outright, and
  // any octal, `\\0` with a digit behind it included. Decoded here they would
  // answer a meta for a file no parser accepts.
  if (c >= "1" && c <= "9") throw new Error("legacy escape refused in strict mode");
  if (c === "0" && text[at + 1] >= "0" && text[at + 1] <= "9") throw new Error("legacy octal escape refused in strict mode");
  return { value: ESCAPES[c] ?? c, end: at + 1 };
}

function codeUnit(digits) {
  if (!/^[0-9a-fA-F]+$/.test(digits)) throw new Error("bad escape");
  return String.fromCharCode(Number.parseInt(digits, 16));
}
