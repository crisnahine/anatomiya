/**
 * One file, parsed in this process: the body the fork shell hosts.
 *
 * The pool forks a shell around this module because an oxc segfault is not
 * catchable and a process boundary is the only thing that contains one (B2).
 * The body lives apart from the shell so tests and the pool cross the same
 * seam: every decision here, the grammar route, the dialect retry, which rows
 * a stripped file answers, was reachable only through a fork before, and four
 * measured incidents lived in it untested.
 */
import { createRequire } from "node:module";

import { dimensionsFor } from "./dimensions.mjs";
import { collectHits } from "./walk.mjs";
import { jsFacets } from "./facets.mjs";
import { rawTransferAllowed } from "./limits.mjs";
import { ENGINES, grammarFor, mayHoldFlow, mayBeCommonJS } from "./langs.mjs";

let parseSync = null;
let stripFlow = null;

// oxc's own text for a `return` outside a function body; there is no error
// code to switch on instead. Node wraps every CommonJS module in a function
// before running it, which is what makes the statement legal there, and
// reproducing that wrapper would nest the whole tree a level deep and break
// every walker that reads `program.body` as the module's own statements. The
// fix goes the other way: blank each reported `return` keyword in place, the
// same length so no offset moves, and only where every error in the file is
// this one shape. Any other error means the file is genuinely broken.
const TOP_LEVEL_RETURN = "A 'return' statement can only be used within a function body.";

function withoutTopLevelReturns(source, errors) {
  // The caller only reaches here with a non-empty errors array.
  if (!errors.every((e) => e.message === TOP_LEVEL_RETURN)) return null;
  let patched = source;
  for (const err of errors) {
    const span = err.labels?.[0];
    if (!span || patched.slice(span.start, span.end) !== "return") return null;
    patched = patched.slice(0, span.start) + " ".repeat(span.end - span.start) + patched.slice(span.end);
  }
  return patched;
}

/** The engine this body runs. The shell names it on its ready message, so a version has an owner. */
export const ENGINE = ENGINES.oxc.id;

/**
 * Which parser is installed, read from its own manifest.
 *
 * From the manifest rather than from the module, because the parser itself is
 * loaded on the first file that needs it and a repository with no JavaScript in
 * it never pays that import. `oxc-parser` exports no version of its own either
 * way. Absent is null, which the first parse then reports as the missing
 * install it is.
 */
export const ENGINE_VERSION = readVersion();

function readVersion() {
  try {
    return createRequire(import.meta.url)(`${ENGINES.oxc.module}/package.json`).version ?? null;
  } catch {
    return null;
  }
}

/**
 * The parser can hand its tree straight across from Rust instead of building it
 * through a serialisation step. Measured 3.06x on the parse itself, 279ms to
 * 91ms over 1,200 files, with the same 11,751 sites found and a byte-identical
 * JSON encoding, so it is safe for the check path that ships the tree over IPC.
 * Not every platform has it, and the flag is still experimental upstream, so it
 * is asked for rather than assumed.
 */
let parseOptions = { sourceType: "module" };

async function ensureParser() {
  if (parseSync) return parseSync;
  try {
    const oxc = await import("oxc-parser");
    parseSync = oxc.parseSync;
    if (rawTransferAllowed() && oxc.rawTransferSupported?.()) {
      parseOptions = { ...parseOptions, experimentalRawTransfer: true };
    }
  } catch (err) {
    // Distinguished from a parse failure by the caller: an absent dependency is
    // every file in the repository, and reporting it per file as "failed to
    // parse" describes a broken repository instead of a broken install.
    const e = new Error(`oxc-parser is not installed: ${err && err.message}`);
    e.missingParser = true;
    throw e;
  }
  return parseSync;
}

/**
 * The Flow stripper, loaded the first time a file needs it and never before.
 *
 * It reaches `hermes-parser` and costs about 13 MB resident, which every worker
 * would pay on every repository if this were a top-level import. Loaded on the
 * first `.js`-family file the parser rejects, which is a file that may be Flow
 * and may simply be broken: telling those apart is what the retry is for, so it
 * cannot be the thing that decides whether to load. A repository whose
 * JavaScript all parses never loads this at all.
 *
 * Absent, the retry is skipped and the file stays rejected, which is what it
 * was before the retry existed.
 */
async function ensureStripper() {
  if (stripFlow !== null) return stripFlow;
  try {
    const mod = await import("flow-remove-types");
    stripFlow = mod.default ?? mod;
  } catch {
    stripFlow = false;
  }
  return stripFlow;
}

/**
 * Parse one source string and answer the per-file record, pre-classify.
 *
 * `stripper` is a defined-only test override for the lazy dialect stripper,
 * the same shape the Ruby guards take: `false` is an install without it, and
 * absent is the real lazy load.
 */
export async function parseFile(source, rel, lang, { withProgram = false, stripper } = {}) {
  const parse = await ensureParser();

  // The real extension, not the language: JSX is legal in a .js file and the
  // TypeScript grammar reads `<div` there as a type assertion, so the two
  // grammars are chosen by extension (B14), on the route the registry declares.
  const filename = `f.${grammarFor(lang, rel)}`;
  const result = parse(filename, source, parseOptions);

  // A recovered tree is not the file. oxc answers a syntax error by returning
  // whatever it could salvage, which is usually far less than was written, so
  // counting it moves the denominator without moving what anyone can read.
  let tree = result;
  // The string the tree describes. The retry parses the blanked copy, and a
  // row slicing between offsets must slice the string its tree came from.
  let parsedSource = source;
  let noStripper = false;
  // Asked of the path, not of the language the caller claimed: Flow lives in
  // files by extension, and a `.jsx` rel handed in under the `js` id is still
  // a file the retry exists for.
  if ((result.errors || []).length && mayHoldFlow(rel)) {
    // oxc refuses Flow by name, and react is written in it: 287 of its 2,277
    // files were charged as syntax nobody could read. The stripper replaces
    // types with whitespace rather than removing them, so the length in
    // UTF-16 code units does not move and every offset still lands where it
    // does in the source. That is the unit oxc counts in and the unit a JS
    // string is indexed by, which is what lets the same walkers and the same
    // reported nodes stand.
    const strip = stripper !== undefined ? stripper : await ensureStripper();
    if (strip) {
      try {
        const blanked = strip(source, { all: true }).toString();
        const retried = parse(filename, blanked, parseOptions);
        if ((retried.errors || []).length === 0) {
          tree = retried;
          parsedSource = blanked;
        }
      } catch {
        // A file the stripper cannot read either is a file nobody can read.
      }
    } else {
      // Absent, not broken: the file stays rejected either way, and only this
      // tells the caller which of the two it was.
      noStripper = true;
    }
  }

  // A tree that came back from the Flow retry has its annotations blanked
  // out, and the rows that depend on them can only answer wrongly: two ask
  // about the annotation itself, and the third counts import statements the
  // stripper deletes outright. Read here, before the CommonJS retry below,
  // so a file that retry recovers keeps every row: it blanks a keyword, not
  // a type, and nothing it touches is blind.
  const stripped = tree !== result;

  // Retry only on failure and only where the dialect could apply, so a file
  // that already parsed pays nothing extra.
  if (tree === result && (result.errors || []).length && mayBeCommonJS(rel)) {
    const patched = withoutTopLevelReturns(source, result.errors);
    if (patched !== null) {
      const retried = parse(filename, patched, parseOptions);
      if ((retried.errors || []).length === 0) {
        tree = retried;
        parsedSource = patched;
      }
    }
  }

  const errors = (tree.errors || []).length;
  if (errors) return { rel, ok: false, error: `${errors} syntax error(s)`, errors, noStripper };

  const dims = dimensionsFor([lang]).filter((d) => !stripped || !d.blindWhenStripped);

  const payload = {
    rel,
    ok: true,
    hits: collectHits(tree.program, dims, { comments: tree.comments ?? [], source: parsedSource }),
    // Read here rather than in the parent because the tree stays here. The
    // module record is the tree's, so a stripped file answers off the retry's
    // parse and reports the imports the stripper left standing.
    facets: jsFacets({ program: tree.program, module: tree.module }),
    errors,
    stripped,
    // The source's own UTF-16 length, which the stripped copy must equal: this
    // is the one field a test can hold the offset-preserving strip against.
    length: source.length,
  };

  // Only the check path asks for the tree, and only for the handful of files
  // a diff touched: it reports line numbers, which need the nodes. The module
  // record stays here whatever the caller asked for: the facets are what
  // anyone wanted from it, and they are a fraction of its size.
  if (withProgram) {
    payload.program = tree.program;
    // A caller walking the tree itself still needs the tree's side channel,
    // or a comment-reading row answers "no comments" for every file.
    payload.comments = tree.comments ?? [];
  }

  return payload;
}
