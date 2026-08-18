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

/** Every module in `lib/` this one can reach, itself included. */
function reachedFrom(entry, edges = graph()) {
  const reached = new Set();
  const walk = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const next of edges.get(file) || []) walk(next);
  };
  walk(entry);
  return reached;
}

test("no module the parse worker reaches imports node:child_process", () => {
  // Every JS parse child loads `dimensions.mjs` for the registry, and the two
  // Ruby dimension files took their walkers from `ruby.mjs`, the module that
  // spawns Ruby. That put the spawn machinery and the inline prism script into
  // all eight forked workers, which is the exact cost `langs.mjs` and
  // `limits.mjs` exist to avoid. `ruby-walk.mjs` is the importable leaf.
  const offenders = [...reachedFrom("parse-worker.mjs")].filter((file) =>
    /from\s*["']node:child_process["']/.test(readFileSync(join(LIB, file), "utf8"))
  );
  assert.deepEqual(offenders, []);
});

test("the parse worker does not reach the registry", () => {
  // The worker runs the tree rows off `dimensionsFor` and nothing else: an
  // obligation has no program to run against and a filename row answers off
  // the corpus, so composing all three in eight forked children buys nothing.
  assert.equal(reachedFrom("parse-worker.mjs").has("registry.mjs"), false);
});

test("a module that branches on a row's kind loads the registry that stamps it", () => {
  // `stampKind` writes the field in place while the registry is assembled, so
  // a reader that never loads it reads undefined off a tree row and takes the
  // other branch without a word. `dimensions.mjs` writes the stamp and
  // `registry.mjs` runs it, which is where both of them read the field.
  const offenders = [];
  for (const [file, imports] of graph()) {
    if (file === "dimensions.mjs" || file === "registry.mjs") continue;
    if (!/\b(?:d|dim|dimension|row)\.kind\b/.test(readFileSync(join(LIB, file), "utf8"))) continue;
    if (!imports.includes("registry.mjs")) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

/**
 * The bodies of the named exports in one lib module, keyed by name.
 *
 * Read from source, because what is under test is which runner a function
 * reaches for, and both runners answer the same values.
 */
function bodies(file) {
  const src = readFileSync(join(LIB, file), "utf8");
  const out = new Map();
  for (const m of src.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) {
    const start = m.index;
    const next = src.slice(start + 1).search(/^(?:export )?(?:async )?function \w+\(/m);
    out.set(m[1], next === -1 ? src.slice(start) : src.slice(start, start + 1 + next));
  }
  return out;
}

test("every git read that grows with the repository is streamed, never buffered", () => {
  // Measured: `execFile` throws `RangeError: Invalid string length` from
  // inside Node's own exit handler, `maxBuffer` does not protect against it,
  // and V8 caps any string at 0x1fffffe8 bytes. Both runners answer the same
  // values on a small repository, so the only thing that says which one a
  // function used is the call it makes.
  const git = bodies("git.mjs");
  const check = bodies("check.mjs");

  for (const [name, body] of [
    ["filesAt", git.get("filesAt")],
    ["pathSet", git.get("pathSet")],
    ["changedSinceWorktree", git.get("changedSinceWorktree")],
    ["diffRange", git.get("diffRange")],
    ["changedFiles", check.get("changedFiles")],
  ]) {
    assert.ok(body, `${name} is not a named function any more`);
    assert.doesNotMatch(body, /gitBuffered\(/, `${name} buffers a listing that grows with the repository`);
  }
});

test("the bounded git reads stay on the buffered runner", () => {
  // The split is real rather than incidental: a blob, a ref and one sha are
  // bounded by what they are, and streaming them buys nothing.
  const git = bodies("git.mjs");

  for (const name of ["showBlob", "headSha", "mergeBase", "shaReachable"]) {
    assert.match(git.get(name), /gitBuffered\(/, `${name} left the runner it belongs on`);
  }
});

/**
 * The names the roster module defines, wherever they are read.
 *
 * `render.mjs` re-exported four of them so its own callers could keep taking
 * them from there, which is two homes for one name: a reader who greps for
 * `plural` finds the definition, the pass-through and importers of each, and
 * nothing says which is the one to add the next name beside.
 */
const ROSTER_NAMES = ["kindsLine", "layoutSummary", "namesakeClause", "plural", "renderLayout", "ROOT_LABEL"];

function sourceFiles() {
  return ["bin", "lib", "scripts", "test"].flatMap((dir) =>
    readdirSync(join(LIB, "..", dir), { recursive: true })
      .filter((name) => typeof name === "string" && name.endsWith(".mjs"))
      .map((name) => join(dir, name))
  );
}

test("a roster name is taken from the module that defines it and from no other", () => {
  const wrong = [];
  for (const rel of sourceFiles()) {
    const src = readFileSync(join(LIB, "..", rel), "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const taken = names.filter((n) => ROSTER_NAMES.includes(n));
      if (taken.length > 0 && !m[2].endsWith("render-layout.mjs")) wrong.push(`${rel}: ${taken.join(", ")} from ${m[2]}`);
    }
  }

  assert.deepEqual(wrong, []);
});
