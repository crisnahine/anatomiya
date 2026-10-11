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
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { dimensionsFor } from "./dimensions.mjs";
import { encode } from "./encode.mjs";
import { collectHits } from "./walk.mjs";
import { withOneBranch } from "./csharp-directives.mjs";
import { ENGINES, declOf, grammarFor, hostedBy, mayHoldDirectives } from "./langs.mjs";
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

/**
 * How long a rejected file may have taken, one more parse as long as its first included, for a retry to be worth starting.
 *
 * The pool stops a parse at 5 seconds and charges it as a crash, where a rejected file is only unread. A megabyte of
 * broken methods takes 1.2 seconds a parse on a quiet machine, so its three parses end at 3.7: a second under the
 * pool's clock leaves room for the read and the reply, and every file that ends well inside it keeps all three.
 */
export const RETRY_BUDGET_MS = 4_000;

// The most a grammar file or the manifest beside them is read at. The largest grammar shipped is 5.4 MB and the
// manifest 1.8 kB: six times the one and thirty-six times the other, so a later grammar fits and a file that is
// neither is never held in memory.
const GRAMMAR_MOST_BYTES = 32 * 1024 * 1024;
const MANIFEST_MOST_BYTES = 64 * 1024;

/**
 * The bytes of an entry that is a regular file of at most `most` bytes, or null for any other: a directory, a fifo, a
 * device, a link, a file past the bound. A missing or unreadable one throws as the read it is.
 *
 * Typed on the handle that is read, so the file typed is the file read. `O_NONBLOCK` keeps a fifo from holding the
 * open and `O_NOFOLLOW` refuses a link out of the directory; both are absent on Windows and fold to 0.
 */
function shippedBytes(path, most) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const entry = fstatSync(fd);
    return entry.isFile() && entry.size <= most ? readFileSync(fd) : null;
  } catch (err) {
    // A shape that will not open is typed by its path, and nothing is read after it.
    if (lstatSync(path, { throwIfNoEntry: false })?.isFile() === false) return null;
    throw err;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const missing = (message, extra = {}) => Object.assign(new Error(message), { missingParser: true }, extra);

/** The runtime, loaded and initialised on first use, or a throw marked as the missing install it is. */
export async function ensureRuntime() {
  if (runtime) return runtime;
  try {
    const loaded = await import("web-tree-sitter");
    await loaded.Parser.init();
    runtime = loaded;
  } catch (err) {
    // The loader's own words, which quote what it read: encoded, since a scan and a check print them.
    throw missing(`${DECLARED.module} is not installed: ${encode(err && err.message)}`);
  }
  return runtime;
}

// What a grammar file is that no load was tried of: the words `doctor` has for one whose bytes are another file's.
const NOT_SHIPPED = "is not the file this plugin shipped";

async function parserFor(grammar, dir, lang) {
  const key = `${dir}\0${grammar}`;
  const known = parsers.get(key);
  if (known instanceof Error) throw known;
  if (known) return known;
  const { Language, Parser } = await ensureRuntime();
  let parser = null;
  // One language's loss, named as the language: every other grammar on this engine still reads its files.
  let lost = null;
  try {
    // Handed the bytes, so the path is read by node and never by the runtime's own loader.
    const bytes = shippedBytes(join(dir, `${grammar}.wasm`), GRAMMAR_MOST_BYTES);
    if (bytes === null) {
      lost = missing(`grammars/${grammar}.wasm ${NOT_SHIPPED}`, { missingGrammar: lang, foreignGrammar: true });
    } else {
      const language = await Language.load(bytes);
      parser = new Parser();
      parser.setLanguage(language);
    }
  } catch (err) {
    parser?.delete();
    // A grammar's failure quotes the file, a function name out of it included: encoded, since a scan and a check print it.
    lost = missing(`grammars/${grammar}.wasm did not load: ${encode(err && err.message)}`, { missingGrammar: lang });
  }
  parsers.set(key, lost ?? parser);
  if (lost) throw lost;
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
 * where it sits. `grammars`, `rows` and `now` are defined-only test overrides: a
 * directory to load grammar files from, the rows to ask in place of the
 * registry's, and the clock a retry is weighed on.
 */
export async function parseTreeFile(source, rel, lang, { withProgram = false, placed = false, grammars = GRAMMARS, rows, now = () => performance.now() } = {}) {
  const parser = await parserFor(grammarFor(lang, rel), grammars, lang);

  let program;
  const began = now();
  let tree = parser.parse(source);
  // The string the tree describes: a retried tree is read off the blanked copy, as a Flow file's is.
  let parsed = source;
  let oneBranch = false;
  let ended = false;
  try {
    // Only after a rejection, so a file the grammar reads as written is read whole.
    if (tree.rootNode.hasError && mayHoldDirectives(rel)) {
      const first = now() - began;
      const affordable = () => now() - began + first <= RETRY_BUDGET_MS;
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
      ended = !/[\n\r]$/.test(source) && affordable() && retry(`${source}\n`);
      const kept = ended || !affordable() ? null : withOneBranch(source);
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

const HOSTED = hostedBy(ENGINE);

/** A grammar file's SHA-256, read under the bound a load reads it under; null where it cannot be read or is no such file. */
async function sha256Of(path) {
  // Loaded by the probe, which only `doctor` and `setup` run: no parse hashes anything.
  const { createHash } = await import("node:crypto");
  try {
    const bytes = shippedBytes(path, GRAMMAR_MOST_BYTES);
    return bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

/** The hash the manifest beside the grammar files records for each of them, or null where it is missing, is not a manifest, or records none for one of them. */
function shippedHashes(dir, files) {
  try {
    // An entry that is no file of a manifest's size parses as `null`, which is no list.
    const hashes = new Map(JSON.parse(String(shippedBytes(join(dir, "grammars.json"), MANIFEST_MOST_BYTES))).map((entry) => [entry.file, entry.sha256]));
    return files.every((file) => typeof hashes.get(file) === "string") ? hashes : null;
  } catch {
    return null;
  }
}

// What the runtime says of a grammar built for a language version outside the range it reads.
const REFUSED_VERSION = /Incompatible language version (\d{1,9})\. Compatibility range (\d{1,9}) through (\d{1,9})/;

/**
 * Which of the grammars this engine's languages name can be read with here.
 *
 * `missing` did not load, asked the way a parse asks, and `refused` is those
 * of them the runtime turned away by language version, with the version and
 * the range it reads: numbers only, so nothing a file says is carried. `foreign` loads and is
 * not shown to be the file the plugin shipped: its bytes do not hash to the
 * manifest's entry, or there is no manifest to hold it to, which `manifest`
 * says. A grammar file that loads reads another language's files as syntax
 * errors, and nothing a parse sees tells that from a file nobody could read.
 * An entry that is no regular file, or is larger than any grammar, is foreign
 * too and is never read: a fifo there held `doctor` until it was killed.
 */
export async function probeGrammars({ grammars = GRAMMARS } = {}) {
  const fileOf = (id) => `${declOf(id).grammars.default}.wasm`;
  const shipped = shippedHashes(grammars, HOSTED.map(fileOf));
  const absent = [];
  const refused = [];
  const foreign = [];
  for (const id of HOSTED) {
    const named = declOf(id).grammars.default;
    try {
      await parserFor(named, grammars, id);
    } catch (err) {
      if (err?.foreignGrammar) {
        foreign.push(named);
        continue;
      }
      absent.push(named);
      const said = REFUSED_VERSION.exec(String(err?.message));
      if (said) refused.push({ grammar: named, version: Number(said[1]), reads: [Number(said[2]), Number(said[3])] });
      continue;
    }
    if (!shipped || (await sha256Of(join(grammars, fileOf(id)))) !== shipped.get(fileOf(id))) foreign.push(named);
  }
  return { total: HOSTED.length, missing: absent, foreign, refused, manifest: shipped !== null };
}
