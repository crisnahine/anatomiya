#!/usr/bin/env node
/**
 * How many changed tree-sitter files the reuse check's line rule leaves out,
 * and whether any of them added something callable, measured as A91 measured
 * the oxc and prism rules: over each repository's last non-merge commits, the
 * hunks `diff -U0` gives a file and the rule's answer on the file as that
 * commit left it.
 *
 * The oracle re-parses every file the rule left out and names any node that
 * starts on an added line and defines, builds or computes something: a
 * function, a class, a lambda, a call, an object creation, an interpolation, a
 * conditional, or a binding whose value holds anything but literals. It is a
 * flat scan over node types, written apart from the rule's own walk, so the
 * rule cannot pass by agreeing with itself. Read-only: git is asked, nothing
 * is checked out.
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
  php: ["anonymous_function", "arrow_function", "function_call_expression", "member_call_expression", "scoped_call_expression", "object_creation_expression", "conditional_expression"],
  go: ["func_literal", "call_expression"],
  java: ["lambda_expression", "method_reference", "method_invocation", "object_creation_expression", "ternary_expression", "template_expression"],
  csharp: ["lambda_expression", "anonymous_method_expression", "invocation_expression", "object_creation_expression", "implicit_object_creation_expression", "conditional_expression", "interpolated_string_expression"],
  rust: ["closure_expression", "call_expression", "macro_invocation", "struct_expression", "if_expression", "match_expression"],
  kotlin: ["lambda_literal", "anonymous_function", "call_expression", "if_expression", "when_expression", "object_literal"],
};

const own = (lang) => {
  const s = SHAPES[lang];
  return [...s.fn, ...s.cls, ...(s.wrap ?? []), ...(s.scope ?? []), ...s.annotation, ...ORACLE[lang]];
};

// What a literal value may hold below its own node: the parts of a string, a
// number's sign, the members of a collection.
const LITERAL_PARTS = /^(?:string_(?:start|end|content|fragment|literal_content)|escape_sequence|interpreted_string_literal_content|raw_string_literal_content|comment|line_comment|block_comment)$/;

/**
 * Every node that starts on an added line and may add something callable, as
 * `{ line, type, text }`. A binding counts where its value holds a named node
 * of a type no literal list names.
 */
export function oracleHits(tree, lang, added) {
  const s = SHAPES[lang];
  const flagged = new Set(own(lang));
  const literalish = new Set([...s.literal, ...s.unary, ...s.collection, ...(s.word ?? [])]);
  const onAdded = (row) => added.some(([from, to]) => row + 1 >= from && row + 1 <= to);
  const hits = [];
  const plain = (n) => literalish.has(n.type) || LITERAL_PARTS.test(n.type) || (s.word?.includes(n.type) && /^(?:true|false|null)$/.test(n.text));
  const firstOdd = (top) => {
    for (const todo = [top]; todo.length > 0; ) {
      const n = todo.pop();
      if (!plain(n)) return n;
      // What a composite literal builds is named by its type, which holds no value.
      const typed = s.collectionType && s.collection.includes(n.type) ? n.childForFieldName(s.collectionType) : null;
      for (const child of n.namedChildren) if (child && child.id !== typed?.id) todo.push(child);
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
    if (onAdded(node.startPosition.row)) {
      if (flagged.has(node.type)) hit(node, node.type);
      // A PHP variable is an interpolation only inside a string.
      else if (s.interpolation?.includes(node.type) && insideString(node)) hit(node, `interpolation ${node.type}`);
      else if (s.bareInterpolation?.includes(node.type) && node.text === "$") hit(node, "bare interpolation");
      else if (s.binding.includes(node.type)) {
        const value = (s.value ? node.childForFieldName(s.value) : null) ?? node.lastNamedChild;
        const odd = value === null ? null : firstOdd(value);
        if (odd !== null) hit(node, `binding to ${odd.type}`);
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

/** One repository: per language, the files asked and left out, the oracle's hits, the parse times, and a few left-out files to read. */
export async function measure(root, { commits = 200, samples = 3 } = {}) {
  const byName = await corpusByName(root);
  const shas = git(root, ["log", "--no-merges", `-n${commits}`, "--format=%H %P"]).split("\n").filter(Boolean);
  const langs = {};
  const row = (lang) => (langs[lang] ??= { asked: 0, skipped: 0, unread: 0, rejected: 0, slow: 0, hits: [], times: [], skippedFiles: [] });
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
      const defining = hunks.some(([from, to]) => !inert.slice(from - 1, to).every(Boolean));
      if (defining) {
        r.asked++;
        continue;
      }
      r.skipped++;
      const parsed = await parseForLines(source, lang, { cancel: () => false });
      if (parsed?.tree) {
        try {
          for (const h of oracleHits(parsed.tree, lang, hunks)) r.hits.push({ repo: basename(root), sha: sha.slice(0, 10), path, ...h });
        } finally {
          parsed.tree.delete();
        }
      }
      if (r.skippedFiles.length < samples) {
        const lines = source.split("\n");
        r.skippedFiles.push({ repo: basename(root), sha: sha.slice(0, 10), path, added: hunks.flatMap(([from, to]) => lines.slice(from - 1, to)).slice(0, 12) });
      }
    }
  }
  return { repo: basename(root), commits: shas.length, unreadDiffs, langs };
}

/** Per language over every repository: asked, left out, unread, the oracle's hits and the parse-time distribution. */
export function tally(results) {
  const out = {};
  for (const { langs } of results) {
    for (const [lang, r] of Object.entries(langs)) {
      const t = (out[lang] ??= { asked: 0, skipped: 0, unread: 0, slow: 0, hits: [], times: [], skippedFiles: [] });
      for (const key of ["asked", "skipped", "unread", "slow"]) t[key] += r[key];
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
