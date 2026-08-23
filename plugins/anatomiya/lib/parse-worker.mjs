/**
 * The fork shell: read the file, hand it to the body, send back what it said.
 *
 * The pool forks this file because an oxc segfault is not catchable and a
 * process boundary is the only thing that contains one (B2). Everything the
 * parse decides lives in `parse-file.mjs`, which tests cross in-process; what
 * stays here is hosting: the read, the IPC reply, and the BigInt fallback.
 * Counts cross the channel and trees only when asked, because an AST
 * serialises to about 16x the source it came from (B10).
 */
import { readFileSync } from "node:fs";

import { ENGINE, ENGINE_VERSION, parseFile } from "./parse-file.mjs";

process.on("message", async ({ rel, abs, lang, withProgram = false }) => {
  try {
    // Read once, hand the parser this exact string, and let the caller slice
    // the same string. oxc reports offsets in UTF-16 code units while a disk
    // buffer is bytes, so indexing a Buffer with a parser offset drifts by one
    // per non-ASCII character earlier in the file. 5.4% of real files are
    // affected and nothing reports it.
    const source = readFileSync(abs, "utf8");
    const payload = await parseFile(source, rel, lang, { withProgram });
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

// The version rides the ready message because it is the one thing this shell
// can say before it has been handed a file, and every worker answers the same.
process.send({ ready: true, engine: ENGINE, version: ENGINE_VERSION });
