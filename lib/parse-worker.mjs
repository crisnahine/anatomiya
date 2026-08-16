/**
 * One file per message, in a child process: parse it, then answer the
 * dimensions about it.
 *
 * This runs as a separate process rather than in the scanner because
 * oxc-parser can segfault from inside parseSync on deeply nested input, the
 * crash is not catchable, and a worker thread does not contain it either: the
 * host exits with 132. No static pre-screen predicts it, since a file with no
 * bracket nesting at all also crashed. So the process boundary is the only
 * containment, and it happens to be faster than parsing in-process anyway.
 *
 * The dimensions run HERE rather than in the parent because they are 85% of the
 * scan's CPU work (1.57ms per file against 0.27ms to parse), and running them
 * in the parent left that 85% on one core: measured pool throughput stopped
 * improving past four workers on an eleven-core machine. Answering here also
 * keeps the AST out of the IPC channel, where it serialises to 16x the size of
 * the source it came from and the parent pays to decode all of it. What crosses
 * now is a conforming flag and a name per site.
 */
import { readFileSync } from "node:fs";
import { dimensionsFor } from "./dimensions.mjs";
import { collectHits } from "./walk.mjs";
import { rawTransferAllowed } from "./limits.mjs";
import { mayHoldFlow } from "./langs.mjs";

let parseSync = null;
let stripFlow = null;

/**
 * Flow only ever appears in the .js family: it is not legal in the .ts family,
 * and a `.tsx` file is TypeScript by definition.
 */

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

process.on("message", async (job) => {
  const { rel, abs, lang, withProgram = false } = job;
  try {
    const parse = await ensureParser();

    // Read once, hand the parser this exact string, and let the caller slice
    // the same string. oxc reports offsets in UTF-16 code units while a disk
    // buffer is bytes, so indexing a Buffer with a parser offset drifts by one
    // per non-ASCII character earlier in the file. 5.4% of real files are
    // affected and nothing reports it.
    const source = readFileSync(abs, "utf8");
    // The real extension, not the language: JSX is legal in a .js file and the
    // TypeScript grammar reads `<div` there as a type assertion. The two
    // grammars disagree in one other place, `<string>x`, which is legal in .ts
    // and not in .tsx, so this cannot simply always ask for JSX.
    const filename = /\.(ts|mts|cts)$/.test(rel) ? "f.ts" : "f.tsx";
    const result = parse(filename, source, parseOptions);

    // A recovered tree is not the file. oxc answers a syntax error by returning
    // whatever it could salvage, which is usually far less than was written, so
    // counting it moves the denominator without moving what anyone can read.
    // Reported as unread, which is what every other unreadable file gets.
    let tree = result;
    let noStripper = false;
    if ((result.errors || []).length && mayHoldFlow(rel)) {
      // oxc refuses Flow by name, and react is written in it: 287 of its 2,277
      // files were charged as syntax nobody could read. The stripper replaces
      // types with whitespace rather than removing them, so the length in
      // UTF-16 code units does not move and every offset still lands where it
      // does in the source. That is the unit oxc counts in and the unit a JS
      // string is indexed by, which is what lets the same walkers and the same
      // reported nodes stand. The byte length can move and never
      // mattered: nothing here indexes bytes.
      const strip = await ensureStripper();
      // Absent, not broken: the file stays rejected either way, and only this
      // says which of the two it was.
      if (!strip) noStripper = true;
      if (strip) {
        try {
          const blanked = strip(source, { all: true }).toString();
          const retried = parse(filename, blanked, parseOptions);
          if ((retried.errors || []).length === 0) tree = retried;
        } catch {
          // A file the stripper cannot read either is a file nobody can read.
        }
      }
    }

    const errors = (tree.errors || []).length;
    if (errors) {
      process.send({ rel, ok: false, error: `${errors} syntax error(s)`, errors, noStripper });
      return;
    }

    // A tree that came back from the retry has its annotations blanked out, so
    // the two dimensions whose question IS the annotation can only answer it
    // wrongly. They are dropped for that file rather than counting a confident
    // zero; every dimension that reads code is unaffected.
    const stripped = tree !== result;
    const dims = dimensionsFor([lang]).filter((d) => !stripped || !d.blindWhenStripped);

    const payload = {
      rel,
      ok: true,
      hits: collectHits(tree.program, dims),
      errors,
      stripped,
      length: source.length,
    };

    // Only the check path asks for the tree, and only for the handful of files
    // a diff touched: it reports line numbers, which need the nodes. The parser
    // also returns a module record of imports and exports; nothing reads it, and
    // it was being serialised across the channel on every one of those files.
    if (withProgram) payload.program = tree.program;

    try {
      process.send(payload);
    } catch {
      // The IPC channel serialises with JSON, which throws on the BigInt a
      // bigint literal puts in the AST. Without the retry every file holding
      // one is charged as a parse failure.
      process.send(jsonSafe(payload));
    }
  } catch (err) {
    process.send({
      rel,
      ok: false,
      error: String(err && err.message ? err.message : err),
      missingParser: err && err.missingParser === true,
    });
  }
});

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}

process.send({ ready: true });
