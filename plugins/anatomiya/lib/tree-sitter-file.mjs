/**
 * One file, parsed in this process through tree-sitter: the body its fork
 * shell hosts.
 *
 * The parser is wasm, and a wasm tree lives outside the collector's reach: one
 * that is not deleted is never freed, and the heap it sits in is capped and
 * does not shrink. So each tree is copied into plain objects and deleted
 * before anything reads it, and the rows, the facets and the check all read
 * the copy. The body lives apart from the shell for the reason `parse-file.mjs`
 * does: tests and the pool cross the same seam.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { dimensionsFor } from "./dimensions.mjs";
import { collectHits } from "./walk.mjs";
import { withOneBranch } from "./csharp-directives.mjs";
import { ENGINES, LANGUAGES, grammarFor, mayHoldDirectives } from "./langs.mjs";
import { treeFacets } from "./tree-facets.mjs";
import { copyTree, walkTree } from "./tree-walk.mjs";
import { installedVersion } from "./version.mjs";

const DECLARED = ENGINES["tree-sitter"];

/** The engine this body runs. The shell names it on its ready message, so a version has an owner. */
export const ENGINE = DECLARED.id;

/** Which runtime is installed, read from its own manifest; null where it is not. */
export const ENGINE_VERSION = installedVersion(DECLARED.module);

// The grammars ship in the plugin, beside `lib/`, and no install writes them.
const GRAMMARS = fileURLToPath(new URL("../grammars/", import.meta.url));

let runtime = null;
// One parser per grammar file for the life of the process: a warm worker pays each load once.
// A file that did not load holds its error here, whatever stopped it, for the life of the process:
// one that could not be read off the disk is remembered like one that does not instantiate, and is not tried
// again. Loaded again for every file, a grammar that instantiates and then fails took 2.9 GB in
// 1,500 files, since nothing frees an instance.
const parsers = new Map();

const missing = (message, extra = {}) => Object.assign(new Error(message), { missingParser: true }, extra);

/** The runtime, loaded and initialised on first use, or a throw marked as the missing install it is. */
export async function ensureRuntime() {
  if (runtime) return runtime;
  try {
    const loaded = await import("web-tree-sitter");
    await loaded.Parser.init();
    runtime = loaded;
  } catch (err) {
    throw missing(`${DECLARED.module} is not installed: ${err && err.message}`);
  }
  return runtime;
}

async function parserFor(grammar, dir, lang) {
  const key = `${dir}\0${grammar}`;
  const known = parsers.get(key);
  if (known instanceof Error) throw known;
  if (known) return known;
  const { Language, Parser } = await ensureRuntime();
  let parser = null;
  try {
    // Handed the bytes, so the path is read by node and never by the runtime's own loader.
    const language = await Language.load(readFileSync(join(dir, `${grammar}.wasm`)));
    parser = new Parser();
    parser.setLanguage(language);
  } catch (err) {
    parser?.delete();
    // One language's loss, named as the language: every other grammar on this engine still reads its files.
    const lost = missing(`grammars/${grammar}.wasm did not load: ${err && err.message}`, { missingGrammar: lang });
    parsers.set(key, lost);
    throw lost;
  }
  parsers.set(key, parser);
  return parser;
}

/**
 * How many ERROR and MISSING nodes a rejected tree holds, and never fewer than
 * one: a grammar can reject a tree through a token it does not show.
 *
 * Only called on a tree whose root says it has an error, and only a subtree
 * that says the same is entered, so a clean file pays one property read.
 */
function errorsIn(tree) {
  let count = 0;
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      if (node.isError || node.isMissing) count++;
      if (node.hasError && cursor.gotoFirstChild()) continue;
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return Math.max(count, 1);
      }
    }
  } finally {
    cursor.delete();
  }
}

/**
 * Parse one source string and answer the per-file record, pre-classify.
 *
 * `placed` is the caller's word that the language's tool collects this file by
 * where it sits. `grammars` and `rows` are defined-only test overrides: a
 * directory to load grammar files from, and the rows to ask in place of the
 * registry's.
 */
export async function parseTreeFile(source, rel, lang, { withProgram = false, placed = false, grammars = GRAMMARS, rows } = {}) {
  const parser = await parserFor(grammarFor(lang, rel), grammars, lang);

  let program;
  let tree = parser.parse(source);
  // The string the tree describes: a retried tree is read off the blanked copy, as a Flow file's is.
  let parsed = source;
  let oneBranch = false;
  let ended = false;
  try {
    // Only after a rejection, so a file the grammar reads as written is read whole.
    if (tree.rootNode.hasError && mayHoldDirectives(rel)) {
      const retry = (text) => {
        const retried = parser.parse(text);
        if (retried.rootNode.hasError) {
          retried.delete();
          return false;
        }
        tree.delete();
        tree = retried;
        return true;
      };
      // The grammar wants a line break after a last-line directive. Tried first: it drops nothing and moves no offset.
      ended = !/[\n\r]$/.test(source) && retry(`${source}\n`);
      const kept = ended ? null : withOneBranch(source);
      if (kept && retry(kept.text)) {
        parsed = kept.text;
        oneBranch = kept.dropped;
      }
    }
    // A recovered tree is not the file, for this parser as for oxc: what it
    // salvaged around an error is less than was written, and counting it moves
    // the denominator.
    if (tree.rootNode.hasError) {
      const errors = errorsIn(tree);
      return { rel, ok: false, error: `${errors} syntax error(s)`, errors };
    }
    program = copyTree(tree, parsed, lang);
    // The line break that was added is no part of the file, and a node that spans it would end past the source.
    if (ended) walkTree(program, (node) => void (node.end = Math.min(node.end, source.length)));
  } finally {
    // A node read after this answers wrongly and does not throw, so nothing below touches the tree.
    tree.delete();
  }

  // Read once and handed to the rows, which ask what kind of file this is.
  const facets = treeFacets(program, lang, rel, { placed });
  const payload = {
    rel,
    ok: true,
    hits: collectHits(program, dimensionsFor([lang], rows ? { rows } : {}), { comments: [], source: parsed, rel, facets }, { walker: walkTree }),
    facets,
    errors: 0,
    // The source's, never the root's span: a file that opens with blank lines has a root that starts past them.
    length: source.length,
  };
  // Absent unless true: the other branches of this file's conditionals are text nothing here read.
  if (oneBranch) payload.oneBranch = true;
  if (withProgram) {
    payload.program = program;
    // Absent unless it differs: a row asked of this tree reads the text the tree was read from, never the file as written.
    if (parsed !== source) payload.text = parsed;
    // Comments are nodes of this tree. The channel is the oxc side's, kept so one caller reads both.
    payload.comments = [];
  }
  return payload;
}

/**
 * The reply for a file whose parse threw.
 *
 * A wasm trap is the one the worker does not survive: the heap is at its cap
 * or the module has aborted, and every later parse in the process fails the
 * same way, on a new parser too. `retire` asks the pool for a new process.
 */
export function failure(rel, err) {
  return {
    rel,
    ok: false,
    error: String(err && err.message ? err.message : err),
    missingParser: err?.missingParser === true,
    ...(err?.missingGrammar ? { missingGrammar: err.missingGrammar } : {}),
    ...(err?.name === "RuntimeError" ? { retire: true } : {}),
  };
}

const HOSTED = LANGUAGES.filter((l) => l.engine === ENGINE);

/** Which of the grammars this engine's languages name load here, asked the way a parse asks. */
export async function probeGrammars({ grammars = GRAMMARS } = {}) {
  const absent = [];
  for (const { id, grammars: named } of HOSTED) {
    try {
      await parserFor(named.default, grammars, id);
    } catch {
      absent.push(named.default);
    }
  }
  return { total: HOSTED.length, missing: absent };
}
