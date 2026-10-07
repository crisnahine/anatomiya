/**
 * The fork shell for the tree-sitter engine: read the file, hand it to the
 * body, send back what it said.
 *
 * Forked for a different reason than oxc's shell is. Nothing here segfaults,
 * but a wasm heap that reaches its cap fails every later parse in the process,
 * and a new process is the only thing that recovers. Everything the parse
 * decides lives in `tree-sitter-file.mjs`; what stays here is hosting.
 */
import { readFileSync } from "node:fs";

import { ENGINE, ENGINE_VERSION, ensureRuntime, failure, parseTreeFile } from "./tree-sitter-file.mjs";

process.on("message", async ({ rel, abs, lang, withProgram = false }) => {
  let payload;
  try {
    // One string for the parser and for every offset it reports, as in the oxc shell.
    payload = await parseTreeFile(readFileSync(abs, "utf8"), rel, lang, { withProgram });
  } catch (err) {
    payload = failure(rel, err);
  }
  try {
    process.send(payload);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    // The channel serialises with JSON, which recurses and runs out of stack on
    // a tree nested a few thousand levels deep. Only tree mode sends one. No
    // error count, because the file is not broken: it could not be carried.
    process.send({ rel, ok: false, error: "the tree is too deep to send" });
  }
});

// Started before the first file so no file's clock pays for it. A runtime that
// is not installed still answers ready, with no version: thrown here it would
// read as a worker that will not start, and each file says which install is missing.
const loaded = await ensureRuntime().then(
  () => true,
  () => false,
);
process.send({ ready: true, engine: ENGINE, version: loaded ? ENGINE_VERSION : null });
