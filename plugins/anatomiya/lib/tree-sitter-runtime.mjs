/**
 * The tree-sitter runtime and one parser per grammar, loaded once per process
 * and shared by everything here that parses: a scan's worker through
 * `tree-sitter-file.mjs`, and the reuse check's line rule, which must not load
 * the walker or a dimension to read a stop's files (A91).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { encode } from "./encode.mjs";
import { declOf, ENGINES } from "./langs.mjs";

const DECLARED = ENGINES["tree-sitter"];


// The grammars ship in the plugin, beside `lib/`, and no install writes them.
export const GRAMMARS = fileURLToPath(new URL("../grammars/", import.meta.url));

let runtime = null;
// One parser per grammar file for the life of the process: a warm worker pays each load once.
// A file that did not load holds its error here, whatever stopped it, for the life of the process:
// one that could not be read off the disk is remembered like one that does not instantiate, and is not tried
// again. Loaded again for every file, a grammar that instantiates and then fails took 2.9 GB in
// 1,500 files, since nothing frees an instance.
const parsers = new Map();

// The most a grammar file or the manifest beside them is read at. The largest grammar shipped is 5.4 MB and the
// manifest 1.8 kB: six times the one and thirty-six times the other, so a later grammar fits and a file that is
// neither is never held in memory.
export const GRAMMAR_MOST_BYTES = 32 * 1024 * 1024;
export const MANIFEST_MOST_BYTES = 64 * 1024;

/**
 * The bytes of an entry that is a regular file of at most `most` bytes, or null for any other: a directory, a fifo, a
 * device, a link, a file past the bound. A missing or unreadable one throws as the read it is.
 *
 * Typed on the handle that is read, so the file typed is the file read. `O_NONBLOCK` keeps a fifo from holding the
 * open and `O_NOFOLLOW` refuses a link out of the directory; both are absent on Windows and fold to 0.
 */
export function shippedBytes(path, most) {
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

export async function parserFor(grammar, dir, lang) {
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
 * One file parsed for the lines it holds: `{ tree }`, which the caller
 * deletes, `{ rejected }` where the grammar reports an error, `{ timedOut }`
 * where `cancel` said stop, or null where the runtime or the grammar is
 * missing. `grammars` is a test override.
 *
 * `cancel` is asked through the runtime's progress callback while the parse
 * runs, so a stop's budget holds inside one large file too.
 */
export async function parseForLines(source, lang, { cancel, grammars = GRAMMARS }) {
  let parser;
  try {
    parser = await parserFor(declOf(lang).grammars.default, grammars, lang);
  } catch (err) {
    if (err?.missingParser) return null;
    throw err;
  }
  if (cancel()) return { timedOut: true };
  const tree = parser.parse(source, null, { progressCallback: () => cancel() });
  if (tree === null) {
    // A cancelled parse is resumed by the next call on this parser unless it is reset.
    parser.reset();
    return { timedOut: true };
  }
  if (!tree.rootNode.hasError) return { tree };
  tree.delete();
  return { rejected: true };
}
