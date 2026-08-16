import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsRuby } from "./ruby-available.mjs";

import { parseAll, poolSizeFor } from "../lib/parse.mjs";
import { GUARDS } from "../lib/pool.mjs";
import { RUBY_GUARDS } from "../lib/ruby.mjs";
import { MAX_FILE_BYTES, rawTransferAllowed } from "../lib/limits.mjs";

// One reading of "this file went unexamined", for both callers: the scan
// computed the four causes and the check computed none of them, so every fix to
// the reconciliation had to be made twice. These cases ask the classification
// directly rather than through a repository.

function dir(t) {
  const d = mkdtempSync(join(tmpdir(), "anatomiya-parse-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function write(d, rel, body) {
  const abs = join(d, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
  return { rel, abs, lang: "js" };
}

test("a file the parser read is ok, and carries what the dimensions found in it", async (t) => {
  const d = dir(t);
  const out = await parseAll([write(d, "a.ts", "export const a = 1\nexport const b = 2\n")]);

  const record = out.records.get("a.ts");
  assert.equal(record.kind, "ok");
  assert.equal(record.ok, true);
  assert.ok(record.hits.module_state_const, "the dimensions ran on it");
});

test("a file whose syntax the parser rejected is its own kind of unread", async (t) => {
  // The parser answered, and the answer was that this is not the file anyone
  // wrote. Counting its recovery moves the denominator without moving the code.
  const d = dir(t);
  const out = await parseAll([write(d, "bad.ts", "export const a = 1\nfoo(\n")]);

  assert.equal(out.records.get("bad.ts").kind, "rejected");
  assert.equal(out.tallies.rejected, 1);
  assert.equal(out.tallies.unreadable, 0, "a rejected file is not one this tool could not read");
});

test("a file this tool could not read at all is a different kind from a rejected one", async (t) => {
  // The reader's next move differs: rejected syntax is the repository's own
  // code, and this is the filesystem or this tool.
  const d = dir(t);
  const out = await parseAll([{ rel: "gone.ts", abs: join(d, "gone.ts"), lang: "js" }]);

  assert.equal(out.records.get("gone.ts").kind, "unreadable");
  assert.equal(out.tallies.unreadable, 1);
  assert.equal(out.tallies.rejected, 0);
});

test("a Ruby file comes back in the same shape as a JavaScript one", needsRuby, async (t) => {
  // Two engines, one record. The caller used to reconcile them: the pool
  // answers per file and prism answers on a stream, and each caller wrote its
  // own loop over the difference.
  const d = dir(t);
  const rb = { rel: "a.rb", abs: join(d, "a.rb"), lang: "ruby" };
  writeFileSync(rb.abs, "def a(one:, two:, three:)\n  1\nend\n");

  const out = await parseAll([write(d, "a.ts", "export const a = 1\n"), rb]);

  assert.equal(out.records.get("a.ts").kind, "ok");
  assert.equal(out.records.get("a.rb").kind, "ok");
  assert.ok(out.records.get("a.rb").hits.keyword_params, "and the dimensions ran on it");
});

test("Ruby the parser rejected is the same kind of unread as JavaScript it rejected", needsRuby, async (t) => {
  // A braced class body is valid JavaScript and not valid Ruby, so a `.rb` file
  // holding one is `ok` if it reached the wrong engine and `rejected` if it
  // reached prism. Ruby that is broken in both languages proves nothing here,
  // and an arrow function is not the discriminator it looks like: prism reads
  // `const f = () => {}` as a method call taking a hash.
  const d = dir(t);
  const rb = { rel: "bad.rb", abs: join(d, "bad.rb"), lang: "ruby" };
  writeFileSync(rb.abs, "class A { b() {} }\n");

  const out = await parseAll([rb]);

  assert.equal(out.records.get("bad.rb").kind, "rejected");
});

test("a source held in memory is parsed without the caller finding it a path", async () => {
  // The check reads its versions out of git rather than off disk, and the
  // parser reads from a path because it runs in another process. Somewhere to
  // put the bytes was the caller's problem, and the caller that had it was the
  // one that then classified nothing.
  const out = await parseAll([{ rel: "head:src/a.ts", source: "export const a = 1\n", lang: "js" }], {
    withProgram: true,
  });

  const record = out.records.get("head:src/a.ts");
  assert.equal(record.kind, "ok");
  assert.ok(record.program, "and the tree comes back when the caller asks for it");
});

test("an in-memory source is parsed by the grammar its language names", needsRuby, async () => {
  // The key is not a filename, so nothing else carries the language across. A
  // `.rb` blob handed to the JavaScript grammar would read as rejected syntax.
  const out = await parseAll([{ rel: "base:app/a.rb", source: "def a\n  1\nend\n", lang: "ruby" }]);

  assert.equal(out.records.get("base:app/a.rb").kind, "ok");
});

test("a Ruby tree survives for the caller that asked for one", needsRuby, async () => {
  // The Ruby bridge drops the tree the moment it has answered the dimensions,
  // because holding every tree made the parent carry the whole corpus at once.
  // So asking for the tree and asking for the counts are the same question with
  // opposite answers, and a caller reporting line numbers needs the tree.
  const out = await parseAll([{ rel: "a.rb", source: "def a\n  1\nend\n", lang: "ruby" }], {
    withProgram: true,
  });

  assert.ok(out.records.get("a.rb").program, "no tree, no line number to report a finding on");
});

test("a file over the size cap is named apart from one that failed", async (t) => {
  // Checked with `stat` before the file is dispatched, so nothing reads these
  // bytes. It is a generated or minified file, which is nobody's to fix.
  const d = dir(t);
  const out = await parseAll([write(d, "big.ts", `const x = "${"a".repeat(4 * 1024 * 1024)}"\n`)]);

  assert.equal(out.records.get("big.ts").kind, "oversize");
  assert.equal(out.tallies.oversize, 1);
});

test("no more parser processes are forked than there are files to parse", () => {
  // A check examines the files one diff touched, which is usually one or two.
  // The pool's default is min(8, cpus-1), so a one-file check forked eight
  // child processes to parse one file. The old check capped at four and the
  // cap was lost in the move; B10's measurement says throughput stops
  // improving past four workers on eleven cores anyway.
  assert.equal(poolSizeFor(1), 1);
  assert.equal(poolSizeFor(2), 2);
  assert.ok(poolSizeFor(500) > 1, "a whole corpus still gets the machine's pool");
  assert.equal(poolSizeFor(500), poolSizeFor(10_000), "and is bounded by the machine, not the corpus");
});

test("every reader gives up on a file at the same size, so one file is never both parsed and refused", () => {
  // Drift between the two parser guards splits one file's fate by which engine
  // is asking. Every blob read takes the same ceiling from `showBlob`, so the
  // two skips are what is left to keep in step.
  assert.equal(GUARDS.maxBytes, MAX_FILE_BYTES);
  assert.equal(RUBY_GUARDS.maxBytes, MAX_FILE_BYTES);
});

test("raw transfer is refused on the platform that cannot overcommit", () => {
  // oxc allocates a 6 GiB buffer per parsing operation to get 4 GiB alignment.
  // Most of its pages are never touched, so on a system that overcommits it
  // costs virtual address space and nothing else. Windows commits at
  // allocation, this pool runs up to eight workers each doing it, and the
  // pool's own memory guard is the one thing that stands down there because
  // there is no `ps`. `rawTransferSupported()` tests pointer width and the Node
  // version and never asks which platform it is on.
  assert.equal(rawTransferAllowed("linux"), true);
  assert.equal(rawTransferAllowed("darwin"), true);
  assert.equal(rawTransferAllowed("win32"), false);
});

test("a Flow-typed file is read, not charged as syntax the parser rejected", async () => {
  // React is written in Flow, which oxc rejects by name: 287 of its 2,277 files
  // were unexamined for it, and the sites in them counted nowhere. Flow only
  // ever appears in the .js family, so the retry is scoped there.
  const source = [
    "// @flow",
    "import type { Node } from 'react'",
    "type Props = {| name: string |}",
    "export function greet(p: Props): string {",
    "  try { return p.name } catch (e) { }",
    "}",
  ].join("\n");

  const { records, tallies } = await parseAll([{ rel: "flow.js", source, lang: "js" }]);
  const r = records.get("flow.js");

  assert.equal(r.kind, "ok", `Flow file came back ${r.kind}: ${r.error ?? ""}`);
  assert.equal(tallies.rejected, 0);
  assert.ok(r.hits.swallowed_error?.length >= 1, "and its sites are counted");
});

test("a file that is broken rather than Flow is still rejected", async () => {
  // The retry must not turn a genuine syntax error into a clean parse: a
  // recovered tree is not the file, which is why a rejected parse contributes
  // nothing in the first place.
  const { records } = await parseAll([{ rel: "broken.js", source: "export function ( {{{ )", lang: "js" }]);

  assert.equal(records.get("broken.js").kind, "rejected");
});
