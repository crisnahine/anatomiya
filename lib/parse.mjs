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
 * here and nowhere else.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPool, defaultPoolSize } from "./pool.mjs";
import { parseRuby } from "./ruby.mjs";
import { dimensionsFor } from "./dimensions.mjs";

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
 * The extension the parser routes on, for a source that has no path of its own.
 *
 * Never the language: JSX is legal in a `.js` file and the TypeScript grammar
 * reads `<div` there as a type assertion, so the two grammars are chosen by
 * extension (B14). A blob written under a generated name carries nothing else.
 */
function scratchExt(lang) {
  if (lang === "ruby") return "rb";
  return lang === "jsx" ? "tsx" : "ts";
}

/**
 * Somewhere for an in-memory source to live while the parser reads it.
 *
 * The parser runs out of process, because an oxc segfault is not catchable, and
 * it takes a path. A caller holding bytes rather than files should not have to
 * know that, and the one that did know it is the one that then classified
 * nothing it got back.
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
      const abs = join(dir, `${i}.${scratchExt(f.lang)}`);
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
 * Parse a file set and answer one record per file, keyed by `rel`.
 *
 * A file arrives either as a path (`abs`) or as bytes (`source`), and a caller
 * holding bytes needs nothing else: somewhere to put them is this module's
 * problem, because the parser runs out of process and reads from a path.
 *
 * `withProgram` asks for the tree, and it is the whole question rather than an
 * extra: a caller that wants trees does its own walking, so the Ruby bridge is
 * asked for no dimensions at all and no record carries `hits`. Wanting both at
 * once is not offered, because prism drops each tree as soon as the dimensions
 * have answered it and holding them made the parent carry the whole corpus.
 *
 * `frameworks` filters the Ruby dimensions to the ones this repository could
 * satisfy (C8), and is read only when the counts are what was asked for.
 */
export async function parseAll(input, { withProgram = false, rubyGuards = null, frameworks } = {}) {
  const held = materialise(input);
  try {
    return await run(held.files, { withProgram, rubyGuards, frameworks });
  } finally {
    held.dispose();
  }
}

async function run(files, { withProgram, rubyGuards, frameworks }) {
  const records = new Map();
  const tallies = { ok: 0, rejected: 0, unreadable: 0, oversize: 0, crashed: 0 };
  let missingParser = null;
  let truncated = false;

  const take = (r) => {
    const kind = classify(r);
    tallies[kind]++;
    // An absent parser is every file at once, and an install problem rather
    // than a repository whose files cannot be read. Both bridges report it.
    if (r.missingParser && !missingParser) missingParser = r.error;
    records.set(r.rel, { ...r, kind });
  };

  const js = files.filter((f) => f.lang !== "ruby");
  const ruby = files.filter((f) => f.lang === "ruby");

  // oxc runs in a pool of warm child processes because `parseSync` can raise an
  // uncatchable SIGSEGV, and a process boundary is the only thing that contains
  // one (B2).
  if (js.length) {
    const pool = createPool({ size: poolSizeFor(js.length), withProgram });
    try {
      for (const r of await Promise.all(js.map((f) => pool.parse(f)))) take(r);
    } finally {
      await pool.close();
    }
  }

  // prism is safe in-process, so it needs no pool; it runs in Ruby, so there is
  // a process boundary anyway and it is a streamed one (B4).
  if (ruby.length) {
    const out = await parseRuby(ruby, {
      // Asking for the counts and asking for the tree are the same question
      // with opposite answers: the bridge drops each tree as soon as it has
      // answered the dimensions, because holding them made the parent carry the
      // whole corpus at once. A caller that reports line numbers wants the tree
      // and walks it itself.
      dimensions: withProgram ? [] : dimensionsFor(["ruby"], { frameworks }),
      ...(rubyGuards ? { guards: rubyGuards } : {}),
    });
    for (const r of out.results) take(r);
    // A Ruby run that hit its output or line cap answered for part of the
    // corpus, which carries the same whole-map suppression the file cap does.
    truncated = truncated || out.truncated;
  }

  return { records, tallies, truncated, missingParser };
}
