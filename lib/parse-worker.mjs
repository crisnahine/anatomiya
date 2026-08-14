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
import { dimensionsFor, collectHits } from "./dimensions.mjs";

let parseSync = null;

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
    if (oxc.rawTransferSupported?.()) parseOptions = { ...parseOptions, experimentalRawTransfer: true };
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
    const errors = (result.errors || []).length;
    if (errors) {
      process.send({ rel, ok: false, error: `${errors} syntax error(s)`, errors });
      return;
    }

    const payload = {
      rel,
      ok: true,
      hits: collectHits(result.program, dimensionsFor([lang])),
      errors,
      length: source.length,
    };

    // Only the check path asks for the tree, and only for the handful of files
    // a diff touched: it reports line numbers, which need the nodes. The parser
    // also returns a module record of imports and exports; nothing reads it, and
    // it was being serialised across the channel on every one of those files.
    if (withProgram) payload.program = result.program;

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
