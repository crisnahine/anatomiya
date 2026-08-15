import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

/**
 * Who imports whom, inside `lib/` only. Node's own modules and the one npm
 * dependency are not part of this repository's shape.
 */
function graph() {
  const edges = new Map();
  for (const file of readdirSync(LIB).filter((f) => f.endsWith(".mjs"))) {
    const src = readFileSync(join(LIB, file), "utf8");
    // Every spelling that closes a cycle, not just the one this repo writes
    // most: a bare `import "./x.mjs"` runs the module for its side effects and
    // a dynamic `import("./x.mjs")` is the form `parse-worker.mjs` already uses.
    // A cycle through either would pass a check that only knew `from`.
    const local = [...src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']\.\/([^"']+\.mjs)["']/g)].map((m) => m[1]);
    edges.set(file, [...new Set(local)]);
  }
  return edges;
}

test("no module in lib imports its way back to itself", () => {
  // A cycle loads under ESM hoisting, so nothing fails at run time and the
  // first symptom is a module reading a half-initialised binding from a
  // partner that is still evaluating. `ruby.mjs` carried a comment refusing an
  // import for exactly this reason, and the comment was deleted in the same
  // change that took the import.
  const edges = graph();
  const cycles = [];

  // Reset per root, so the report names every cycle rather than the first one
  // reached. A shared set stops the walk at a module some earlier root already
  // passed through, which is enough to fail the gate but not to fix it.
  let seen = new Set();
  const walk = (file, path) => {
    const at = path.indexOf(file);
    if (at !== -1) return void cycles.push([...path.slice(at), file].join(" -> "));
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of edges.get(file) || []) walk(next, [...path, file]);
  };
  for (const file of edges.keys()) {
    seen = new Set();
    walk(file, []);
  }

  assert.deepEqual([...new Set(cycles)], []);
});
