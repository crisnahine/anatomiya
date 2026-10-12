#!/usr/bin/env node
/**
 * How many changed tree-sitter files and hunks the reuse check's line rule
 * leaves out, and whether any of them added something callable, measured as
 * A91 measured the oxc and prism rules: over each repository's last non-merge
 * commits, the hunks `diff -U0` gives a file and the rule's answer on the file
 * as that commit left it.
 *
 * The oracle re-parses every file holding a hunk the rule left out, a file
 * asked about for another hunk included, and names what a line of such a hunk
 * may define, build or compute: a function, a class, an accessor, a lambda, a
 * call, an object creation, an interpolation or a conditional holding a token
 * on an added line, a string on one that holds more than its own text, and a
 * binding that starts on one whose value holds anything but literals or whose
 * target, pattern, type or modifiers hold anything but names, types and
 * literals. It charges each token to the nodes above it, up to the statement
 * or member it belongs to. It is written apart from the rule's own walk: it
 * shares the table's literal kinds and none of the rule's lists of names,
 * types, string parts and signs, which it tells by how grammars spell them
 * and by a literal's own text. So the rule cannot pass by agreeing with
 * itself. Read-only: git is asked, nothing is checked out.
 *
 * usage: node scripts/measure-inert.mjs [--commits N] [--samples N] <repository> [<repository> ...]
 */
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

import { invokedAs, readArgv } from "./entry.mjs";
import { addedRanges } from "../plugins/anatomiya/lib/changeset.mjs";
import { corpusByName } from "../plugins/anatomiya/lib/corpus.mjs";
import { inertLinesOf, REUSE_PARSE_MS } from "../plugins/anatomiya/lib/inert.mjs";
import { engineOf, language } from "../plugins/anatomiya/lib/langs.mjs";
import { MAX_FILE_BYTES } from "../plugins/anatomiya/lib/limits.mjs";
import { ONE_OFF } from "../plugins/anatomiya/lib/reuse.mjs";
import { SHAPES } from "../plugins/anatomiya/lib/tree-shapes.mjs";
import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";

// Past the shapes the plugin reads: what makes or runs a callable, per grammar.
export const ORACLE = {
  python: ["lambda", "call", "conditional_expression", "list_comprehension", "dictionary_comprehension", "set_comprehension", "generator_expression"],
  php: ["property_hook", "anonymous_function", "arrow_function", "function_call_expression", "member_call_expression", "scoped_call_expression", "object_creation_expression", "conditional_expression"],
  go: ["func_literal", "call_expression"],
  java: ["lambda_expression", "method_reference", "method_invocation", "object_creation_expression", "ternary_expression", "template_expression"],
  csharp: ["accessor_declaration", "lambda_expression", "anonymous_method_expression", "invocation_expression", "object_creation_expression", "implicit_object_creation_expression", "conditional_expression", "interpolated_string_expression"],
  rust: ["closure_expression", "call_expression", "macro_invocation", "struct_expression", "if_expression", "match_expression"],
  kotlin: ["getter", "setter", "secondary_constructor", "anonymous_initializer", "lambda_literal", "anonymous_function", "call_expression", "if_expression", "when_expression", "object_literal"],
};

// What holds statements or members: a token on an added line is charged to the nodes between it
// and the statement or member it belongs to, so a constant added to a class body is not the class.
export const CONTAINERS = {
  python: ["module", "block"],
  php: ["program", "compound_statement", "declaration_list", "enum_declaration_list"],
  go: ["source_file", "statement_list", "field_declaration_list"],
  java: ["program", "block", "class_body", "interface_body", "annotation_type_body", "enum_body", "enum_body_declarations"],
  // A conditional around whole members holds them as a body does, so a `using` added inside one is not the conditional.
  csharp: ["compilation_unit", "declaration_list", "block", "preproc_if", "preproc_elif", "preproc_else"],
  rust: ["source_file", "declaration_list", "block"],
  kotlin: ["source_file", "class_body", "enum_class_body", "block", "lambda_literal"],
};

const defining = (lang) => {
  const s = SHAPES[lang];
  return [...s.fn, ...s.cls, ...(s.wrap ?? []), ...(s.scope ?? []), ...s.annotation];
};

// A closing bracket, a separator or the end of a conditional: a line of these alone opens nothing.
const CLOSING = /^(?:[)\]};,]|#endif)$/;

// The binding that may repeat the one above it or count off its place in a group, and the counter's node.
export const COUNTED = { go: { const_spec: "iota" } };

// What a literal value may hold below its own node: the parts of a string, a
// number's sign, the members of a collection.
const LITERAL_PARTS =
  /^(?:string_(?:start|end|content|fragment|literal_content)|character_literal_content|multiline_string_fragment|escape_(?:sequence|interpolation)|interpreted_string_literal_content|raw_string_(?:literal_content|start|content|end)|nowdoc_(?:body|string)|heredoc_(?:start|end)|comment|line_comment|block_comment)$/;

// Where a user may define an operator a built-in type lacks, a sign and its literal by their text: a
// number that is not unsigned after `-` or `+`, a boolean after `!`. Any other pair is a call.
const OWN_SIGN = {
  kotlin: /^(?:[-+]\s*(?![^]*u.?$)[\d.](?:[\w.]|e[-+])*|!\s*(?:true|false))$/i,
  csharp: /^(?:[-+]\s*(?![^]*(?:u.?|lu)$)[\d.](?:[\w.]|e[-+])*|[-+~]\s*'(?:[^'\\]|\\[^]+)'|~\s*\d\w*|!\s*(?:true|false))$/i,
};

// How the seven grammars spell a name, a type, a modifier and a pattern of names. Every node under one
// is read too, and nothing that calls or runs is spelt this way.
const NAMING =
  /(?:^|_)(?:identifier|name|type|modifiers?|specifier|lifetime|dimensions|wildcard|scope|pattern)$|^(?:type_arguments|type_argument_list|type_parameter|type_projection|type_elem|variable_declaration|multi_variable_declaration|crate|self|super)$/;

// What a target, an annotation or a struct type is made of where its grammar spells one as neither a name nor a type.
export const ACCESS = {
  python: ["attribute", "subscript", "ellipsis"],
  php: ["member_access_expression", "subscript_expression", "scoped_property_access_expression"],
  go: ["field_declaration_list", "field_declaration"],
};

// The node that joins types where it stands under `within`, read by its text: any operator in it but `|` computes.
export const UNION = { python: { node: "binary_operator", within: "type" } };
const COMPUTES = /[-+*/%@&^<>~]/;

/**
 * Every node that may add something callable and holds a token on an added
 * line, as `{ line, type, text }`: a definition, a call, a lambda, a
 * conditional or an interpolation between the token and the statement or
 * member it belongs to, so a call's added argument counts and a constant
 * added inside a class body does not count for the class. A token inside a
 * comment or a string's text is no token here, and an interpolation counts on
 * any added line it spans.
 *
 * An added line holding only closing brackets and separators is not charged:
 * A91's rule calls a closing bracket inert for every engine, since such a line
 * starts no definition and no call, and it is what a removed argument or a
 * removed body leaves behind. A bracket beside anything else is charged, the
 * last line of a string spread over lines included.
 *
 * A string counts on any added line it spans where it holds a named node that
 * is no part of a string's text, in a target and in an argument alike.
 *
 * A binding counts where it starts on an added line and its value holds a
 * named node of a type no literal list names, or it carries a block to run
 * when it does not match. A `COUNTED` binding with no value is no hit, and one
 * with a value is read by its leaves: each a literal or the counter. Outside
 * its value, a binding counts where a node is no literal and is not spelt as
 * a name, a type, a modifier or a pattern: in its target, its type, the type
 * of a composite literal, and the modifiers and type its declaration holds.
 *
 * A sign on a literal counts with them where `OWN_SIGN` has the language and
 * the text is not a pair it spells.
 */
export function oracleHits(tree, lang, added) {
  const s = SHAPES[lang];
  const flagged = new Set(defining(lang));
  const computing = new Set(ORACLE[lang]);
  const literalish = new Set([...s.literal, ...s.unary, ...s.collection, ...(s.word ?? [])]);
  const onAddedRow = (row) => added.some(([from, to]) => row + 1 >= from && row + 1 <= to);
  const containers = new Set(CONTAINERS[lang]);
  const charged = new Map();
  const quiet = new Set([...s.comment, ...s.literal]);
  const tokens = [];
  // The added rows that hold anything but closing brackets and separators.
  const opening = new Set();
  for (const todo = [[tree.rootNode, false]]; todo.length > 0; ) {
    const [node, inside] = todo.pop();
    if (node.childCount > 0) {
      for (const child of node.children) if (child) todo.push([child, inside || quiet.has(node.type)]);
      continue;
    }
    if (s.comment.includes(node.type)) continue;
    if (node.isNamed || !CLOSING.test(node.type)) {
      // A string spread over lines is on every row its text reaches, so none where it ends at a line's start.
      const last = node.endPosition.column === 0 ? node.endPosition.row - 1 : node.endPosition.row;
      for (let row = node.startPosition.row; row <= Math.max(last, node.startPosition.row); row++) if (onAddedRow(row)) opening.add(row);
    }
    // A token inside a string's text is no token here.
    if (!inside && onAddedRow(node.startPosition.row)) tokens.push(node);
  }
  for (const node of tokens) {
    // A line of closing brackets alone starts no definition and no call (A91).
    if (!opening.has(node.startPosition.row)) continue;
    for (let up = node.parent; up !== null; up = up.parent) {
      if (flagged.has(up.type) || computing.has(up.type)) charged.set(up.id, up);
      if (containers.has(up.type) || (up.parent !== null && containers.has(up.parent.type))) break;
    }
  }
  const spansAdded = (node) => added.some(([from, to]) => node.startPosition.row + 1 <= to && node.endPosition.row + 1 >= from);
  const hits = [];
  const ownSign = (n) => !s.unary.includes(n.type) || !OWN_SIGN[lang] || OWN_SIGN[lang].test(n.text);
  const plain = (n) => (literalish.has(n.type) && ownSign(n)) || LITERAL_PARTS.test(n.type) || (s.word?.includes(n.type) && /^(?:true|false|null)$/.test(n.text));
  const firstOdd = (top) => {
    for (const todo = [top]; todo.length > 0; ) {
      const n = todo.pop();
      if (!plain(n)) return n;
      // What a composite literal builds is named by its type, which is read as a type.
      const typed = s.collectionType && s.collection.includes(n.type) ? n.childForFieldName(s.collectionType) : null;
      const odd = typed ? unnamed(typed) : null;
      if (odd !== null) return odd;
      for (const child of n.namedChildren) if (child && child.id !== typed?.id) todo.push(child);
    }
    return null;
  };
  const access = new Set(ACCESS[lang] ?? []);
  const joinsTypes = (n) => {
    if (n.type !== UNION[lang]?.node || COMPUTES.test(n.text)) return false;
    for (let up = n.parent; up !== null; up = up.parent) if (up.type === UNION[lang].within) return true;
    return false;
  };
  // The first node of a subtree that is no literal and is not spelt as a name or a type.
  function unnamed(top) {
    for (const todo = [top]; todo.length > 0; ) {
      const n = todo.pop();
      if (!joinsTypes(n) && !NAMING.test(n.type) && !access.has(n.type) && !plain(n)) return n;
      for (const child of n.namedChildren) if (child) todo.push(child);
    }
    return null;
  }
  const beside = (node, kept, what) => {
    for (const child of node.namedChildren) {
      const odd = child && !kept(child) ? unnamed(child) : null;
      if (odd !== null) hit(node, `${what} holding ${odd.type}`);
    }
  };
  const foreign = (top) => {
    for (const todo = [...top.namedChildren]; todo.length > 0; ) {
      const n = todo.pop();
      if (n === null) continue;
      if (!LITERAL_PARTS.test(n.type) && !s.literal.includes(n.type)) return n;
      todo.push(...n.namedChildren);
    }
    return null;
  };
  // Read apart from `firstOdd`, by the leaves alone: whatever joins them, a name among them is a hit.
  const oddLeaf = (top, counter) => {
    for (const todo = [top]; todo.length > 0; ) {
      const n = todo.pop();
      if (n.namedChildCount === 0 && n.type !== counter && !plain(n)) return n;
      for (const child of n.namedChildren) if (child) todo.push(child);
    }
    return null;
  };
  const insideString = (node) => {
    for (let up = node.parent; up !== null; up = up.parent) if (s.literal.includes(up.type)) return true;
    return false;
  };
  const hit = (node, why) => hits.push({ line: node.startPosition.row + 1, type: why, text: node.text.split("\n")[0].slice(0, 120) });
  const stack = [tree.rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (s.literal.includes(node.type) && spansAdded(node)) {
      const odd = foreign(node);
      if (odd !== null) hit(node, `string holding ${odd.type}`);
    }
    if (charged.has(node.id)) hit(node, node.type);
    // An interpolation sits inside a string's text, so it counts on any added line it spans; a PHP variable is one only inside a string.
    else if (s.interpolation?.includes(node.type) && spansAdded(node) && insideString(node)) hit(node, `interpolation ${node.type}`);
    else if (s.bareInterpolation?.includes(node.type) && node.text === "$" && spansAdded(node)) hit(node, "bare interpolation");
    else if (onAddedRow(node.startPosition.row)) {
      if (s.binding.includes(node.type)) {
        const own = s.value ? node.childForFieldName(s.value) : null;
        const counter = COUNTED[lang]?.[node.type];
        const value = own ?? (counter ? null : node.lastNamedChild);
        const odd = value === null ? null : counter ? oddLeaf(value, counter) : firstOdd(value);
        if (odd !== null) hit(node, `binding to ${odd.type}`);
        else if (s.alternative && node.childForFieldName(s.alternative) !== null) hit(node, "binding with an alternative");
        beside(node, (child) => child.id === value?.id, "binding");
      } else if (s.declaration?.includes(node.type)) {
        beside(node, (child) => s.binding.includes(child.type) || s.declaration.includes(child.type), "declaration");
      }
    }
    for (const child of node.namedChildren) if (child) stack.push(child);
  }
  return hits;
}

const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

function percentile(sorted, p) {
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * One repository: per language, the files and the hunks asked and left out, the oracle's hits on the
 * hunks left out, the parse times, and a few left-out files to read. `oracle` is a test override.
 */
export async function measure(root, { commits = 200, samples = 3, oracle = oracleHits } = {}) {
  const byName = await corpusByName(root);
  const shas = git(root, ["log", "--no-merges", `-n${commits}`, "--format=%H %P"]).split("\n").filter(Boolean);
  const langs = {};
  const row = (lang) => (langs[lang] ??= { asked: 0, skipped: 0, askedHunks: 0, skippedHunks: 0, unread: 0, rejected: 0, slow: 0, hits: [], times: [], skippedFiles: [] });
  let unreadDiffs = 0;
  for (const line of shas) {
    const [sha, parent] = line.split(" ");
    if (!parent) continue;
    const ranges = await addedRanges(root, parent, sha);
    if (ranges === null) {
      unreadDiffs++;
      continue;
    }
    for (const [path, hunks] of ranges) {
      const lang = language(path);
      if (lang === null || engineOf(lang) !== "tree-sitter") continue;
      if (hunks.length === 0 || !byName(path) || ONE_OFF.test(path)) continue;
      let source;
      try {
        source = git(root, ["show", `${sha}:${path}`]);
      } catch {
        continue;
      }
      if (Buffer.byteLength(source) > MAX_FILE_BYTES) continue;
      const r = row(lang);
      const began = performance.now();
      const inert = await inertLinesOf({ engine: "tree-sitter", lang, source, deadline: Infinity });
      const took = performance.now() - began;
      if (inert === null) {
        r.unread++;
        continue;
      }
      r.times.push(took);
      if (took > REUSE_PARSE_MS) r.slow++;
      const left = hunks.filter(([from, to]) => inert.slice(from - 1, to).every(Boolean));
      r.askedHunks += hunks.length - left.length;
      r.skippedHunks += left.length;
      if (left.length === 0) {
        r.asked++;
        continue;
      }
      const parsed = await parseForLines(source, lang, { cancel: () => false });
      if (parsed?.tree) {
        try {
          for (const h of oracle(parsed.tree, lang, left)) r.hits.push({ repo: basename(root), sha: sha.slice(0, 10), path, ...h });
        } finally {
          parsed.tree.delete();
        }
      }
      if (left.length < hunks.length) {
        r.asked++;
        continue;
      }
      r.skipped++;
      if (r.skippedFiles.length < samples) {
        const lines = source.split("\n");
        r.skippedFiles.push({ repo: basename(root), sha: sha.slice(0, 10), path, added: hunks.flatMap(([from, to]) => lines.slice(from - 1, to)).slice(0, 12) });
      }
    }
  }
  return { repo: basename(root), commits: shas.length, unreadDiffs, langs };
}

/** Per language over every repository: files and hunks asked and left out, unread, the oracle's hits and the parse-time distribution. */
export function tally(results) {
  const out = {};
  for (const { langs } of results) {
    for (const [lang, r] of Object.entries(langs)) {
      const t = (out[lang] ??= { asked: 0, skipped: 0, askedHunks: 0, skippedHunks: 0, unread: 0, slow: 0, hits: [], times: [], skippedFiles: [] });
      for (const key of ["asked", "skipped", "askedHunks", "skippedHunks", "unread", "slow"]) t[key] += r[key];
      t.hits.push(...r.hits);
      t.times.push(...r.times);
      t.skippedFiles.push(...r.skippedFiles);
    }
  }
  for (const t of Object.values(out)) {
    const sorted = t.times.toSorted((a, b) => a - b);
    t.ms = { p50: percentile(sorted, 50), p90: percentile(sorted, 90), p99: percentile(sorted, 99), max: sorted.at(-1) ?? null };
    delete t.times;
  }
  return out;
}

if (invokedAs(import.meta.url)) {
  const argv = readArgv(process.argv.slice(2), { commits: { type: "string", default: "200" }, samples: { type: "string", default: "3" } }, { positionals: true });
  if (argv.error || argv.positionals.length === 0) {
    console.error(argv.error ?? "usage: node scripts/measure-inert.mjs [--commits N] [--samples N] <repository> [<repository> ...]");
    process.exit(2);
  }
  const options = { commits: Number(argv.values.commits), samples: Number(argv.values.samples) };
  const results = [];
  for (const root of argv.positionals) {
    const result = await measure(resolve(root), options);
    results.push(result);
    console.error(`${result.repo}: ${result.commits} commits, ${JSON.stringify(Object.fromEntries(Object.entries(result.langs).map(([l, r]) => [l, `${r.asked} asked, ${r.skipped} left out, ${r.hits.length} hits`])))}`);
  }
  console.log(JSON.stringify(tally(results), null, 2));
}
