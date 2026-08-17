/**
 * One parse pass, and one reading of what came back.
 *
 * The scan and the check each drove the parsers themselves, which meant each
 * one decided separately what an unread file means. Only the scan ever decided
 * it, so every fix to the reconciliation had to be made twice and the second
 * one kept being missed: a check with no `node_modules` reported that it found
 * nothing, and a file whose syntax was rejected read as one this tool could not
 * open. B13, B15 and A13 are all bugs in exactly this seam.
 *
 * What crosses the seam is one record per file carrying its `kind`, decided
 * here and nowhere else. Which engine reads a file is the registry's to say:
 * a declaration names its engine and this module holds the one table from
 * names to hosts, so a caller neither knows the engines exist nor can name
 * one. Every ok record carries `facets` with `{ testRunner, testCalls }` and,
 * in counts mode, `hits`; tree mode promises `program` instead, and neither
 * mode promises the other's field. `stripped`, `noStripper` and `comments`
 * exist only where a declaration's dialect or side channel does. An engine
 * whose install is absent marks every affected record `missingParser`; that
 * the oxc records then classify unreadable while prism's classify crashed is
 * a documented per-adapter fact the conformance suite pins, not a contract.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPool, defaultPoolSize } from "./pool.mjs";
import { parseRuby } from "./ruby.mjs";
import { dimensionsFor } from "./dimensions.mjs";
import { declOf, LANGUAGES } from "./langs.mjs";

/**
 * The four ways a file goes unexamined, plus the one way it does not.
 *
 * Order matters. A file over the cap never reached the parser, and a crash is
 * charged before anything the child managed to say, because a child that died
 * did not answer. Syntax the parser rejected is last of the failures, because
 * it is the only one where the parser answered at all.
 */
function classify(r) {
  if (r.skipped) return "oversize";
  if (r.crashed) return "crashed";
  if (r.ok) return "ok";
  if (r.errors) return "rejected";
  return "unreadable";
}

/**
 * Somewhere for an in-memory source to live while the parser reads it.
 *
 * The parser runs out of process, because an oxc segfault is not catchable, and
 * it takes a path. A caller holding bytes rather than files should not have to
 * know that, and the one that did know it is the one that then classified
 * nothing it got back. The scratch name takes the declaration's extension, so
 * the blob routes to the grammar its language declared (B14).
 */
function materialise(files) {
  const held = files.filter((f) => typeof f.source === "string" && !f.abs);
  if (held.length === 0) return { files, dispose: () => {} };

  const dir = mkdtempSync(join(tmpdir(), "anatomiya-parse-"));
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  const byRel = new Map();
  // The writes are guarded from the moment the directory exists. Left outside,
  // a throwing write escapes before this function returns anything to clean up
  // with, and the directory and its blobs stay in the temp directory.
  try {
    for (const [i, f] of held.entries()) {
      const abs = join(dir, `${i}.${declOf(f.lang).scratchExt}`);
      writeFileSync(abs, f.source);
      byRel.set(f.rel, abs);
    }
  } catch (err) {
    dispose();
    throw err;
  }

  return {
    files: files.map((f) => (byRel.has(f.rel) ? { ...f, abs: byRel.get(f.rel) } : f)),
    dispose,
  };
}

/**
 * How many parser processes to fork for this many files.
 *
 * Never more workers than files: a check examines the handful a diff touched,
 * and forking the machine's whole pool to parse one of them pays fork cost for
 * nothing. B10 measured throughput flat past four workers on eleven cores, so
 * the machine's own bound is the other half.
 */
export function poolSizeFor(fileCount) {
  return Math.max(1, Math.min(defaultPoolSize(), fileCount));
}

/**
 * The guard overrides one engine's batch inherits from the bag.
 *
 * Keyed by language id, so a test names an engine as data rather than the
 * signature naming one. Languages sharing an engine merge in registry order,
 * and a key an input never uses moves nothing.
 */
function guardsFor(bag, files) {
  if (!bag) return null;
  const ids = new Set(files.map((f) => f.lang));
  let merged = null;
  for (const decl of LANGUAGES) {
    if (ids.has(decl.id) && bag[decl.id]) merged = { ...(merged ?? {}), ...bag[decl.id] };
  }
  return merged;
}

// oxc runs in a pool of warm child processes because `parseSync` can raise an
// uncatchable SIGSEGV, and a process boundary is the only thing that contains
// one (B2).
async function runOxc(files, { withProgram, guards }) {
  const pool = createPool({ size: poolSizeFor(files.length), withProgram, guards });
  try {
    return { results: await Promise.all(files.map((f) => pool.parse(f))), truncated: false };
  } finally {
    await pool.close();
  }
}

// prism is safe in-process, so it needs no pool; it runs in Ruby, so there is
// a process boundary anyway and it is a streamed one (B4).
async function runPrism(files, { withProgram, guards, frameworks }) {
  const langs = [...new Set(files.map((f) => f.lang))];
  const out = await parseRuby(files, {
    // Asking for the counts and asking for the tree are the same question
    // with opposite answers: the bridge drops each tree as soon as it has
    // answered the dimensions, because holding them made the parent carry the
    // whole corpus at once. A caller that reports line numbers wants the tree
    // and walks it itself. The dimension list is the batch's own languages',
    // so no language is named here.
    dimensions: withProgram ? [] : dimensionsFor(langs, { frameworks }),
    ...(guards ? { guards } : {}),
  });
  return { results: out.results, truncated: out.truncated };
}

// Engine name to host, the one table in the one module that may import both
// sides: declarations are leaf data the forked child also reads, and a host
// reaches child_process, so a declaration names its engine and this map is
// where the name becomes a call. A fourth language on an existing engine adds
// no row here; a new engine adds one, deliberately visible.
const ADAPTERS = { oxc: runOxc, prism: runPrism };

// Batch order is the registry's, derived rather than trusted to the table
// above: records insertion order feeds downstream ties, and a new engine
// added to the table out of registry order would silently reorder them.
const ENGINE_ORDER = [...new Set(LANGUAGES.map((l) => l.engine))];
for (const engine of ENGINE_ORDER) {
  // At import, never mid-scan: a declaration naming an engine this table does
  // not host would otherwise become a TypeError halfway through a corpus.
  if (!ADAPTERS[engine]) throw new Error(`the registry names engine ${engine} and no adapter hosts it`);
}

/**
 * Parse a file set and answer one record per file, keyed by `rel`.
 *
 * A file arrives either as a path (`abs`) or as bytes (`source`), and a caller
 * holding bytes needs nothing else: somewhere to put them is this module's
 * problem, because the parser runs out of process and reads from a path.
 *
 * `withProgram` asks for the tree, and it is the whole question rather than an
 * extra: a caller that wants trees does its own walking, and a caller that
 * wants counts gets `hits` and no tree. Wanting both at once is not offered.
 *
 * `guards` is a bag of per-language overrides, `{ ruby: { idleMs: 50 } }`,
 * routed to the engine that hosts each language; languages sharing an engine
 * share the merged result, so a `js` override reaches a `jsx` batch-mate. A
 * key naming no declared language refuses the call rather than moving
 * nothing. `frameworks` filters the framework-gated dimensions (C8) where an
 * engine selects them parent-side; the oxc worker selects its own, which is
 * why a framework row may not be hosted there (the registry refuses one).
 */
export async function parseAll(input, { withProgram = false, guards = null, frameworks } = {}) {
  for (const id of Object.keys(guards ?? {})) declOf(id);
  const held = materialise(input);
  try {
    return await run(held.files, { withProgram, guards, frameworks });
  } finally {
    held.dispose();
  }
}

async function run(files, { withProgram, guards, frameworks }) {
  const records = new Map();
  const tallies = { ok: 0, rejected: 0, unreadable: 0, oversize: 0, crashed: 0 };
  let missingParser = null;
  let missingStripper = false;
  let truncated = false;

  const take = (r) => {
    const kind = classify(r);
    tallies[kind]++;
    // An absent parser is every file at once, and an install problem rather
    // than a repository whose files cannot be read. Both bridges report it.
    if (r.missingParser && !missingParser) missingParser = r.error;
    // One rejected file that could have been retried is enough: the dependency
    // is absent for the whole run, not for that file.
    if (r.noStripper) missingStripper = true;
    records.set(r.rel, { ...r, kind });
  };

  const groups = new Map();
  for (const f of files) {
    const engine = declOf(f.lang).engine;
    if (!groups.has(engine)) groups.set(engine, []);
    groups.get(engine).push(f);
  }

  for (const engine of ENGINE_ORDER) {
    const batch = groups.get(engine);
    if (!batch || batch.length === 0) continue;
    const out = await ADAPTERS[engine](batch, {
      withProgram,
      frameworks,
      guards: guardsFor(guards, batch),
    });
    for (const r of out.results) take(r);
    // A batch that hit its own caps answered for part of the corpus, which
    // carries the same whole-map suppression the file cap does.
    truncated = truncated || out.truncated;
  }

  return { records, tallies, truncated, missingParser, missingStripper };
}
