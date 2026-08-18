import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsRuby } from "./ruby-available.mjs";
import { installWithoutStripper, FLOW_SOURCE } from "./no-stripper.mjs";

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

test("a parse says which engine answered it, and at what version", async () => {
  // The parser child has always reported its version on the ready message and
  // the bridge has always reported prism's. Both were dropped before anything
  // could read them, so a map could not say which build produced its counts.
  const out = await parseAll([{ rel: "a.ts", source: "export const a = 1\n", lang: "js" }]);

  assert.match(out.engines.oxc.version, /^\d+\.\d+\.\d+/);
  assert.deepEqual(out.missingEngines, []);
  // An engine no file routed to never ran, which is a different fact from one
  // that ran and reported nothing.
  assert.equal(out.engines.prism, undefined);
});

test("the Ruby bridge reports its own engine's version the same way", needsRuby, async () => {
  const out = await parseAll([{ rel: "a.rb", source: "class A\nend\n", lang: "ruby" }]);

  assert.match(out.engines.prism.version, /^\d+\.\d+/);
});

test("an interpreter that is not there names its own engine and no other", async (t) => {
  // The remedy is built from this: npm cannot install Ruby, and the scan told
  // the reader to run npm because nothing said which engine was missing.
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
  });
  process.env.PATH = "";

  const out = await parseAll([{ rel: "a.rb", source: "class A\nend\n", lang: "ruby" }]);

  assert.deepEqual(out.missingEngines, ["prism"]);
  assert.match(out.missingParser, /ruby/);
  assert.equal(out.engines.prism.version, null, "the child never started, so it reported no version");
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
  const out = await parseAll([write(d, "big.ts", `const x = "${"a".repeat(1024 * 1024)}"\n`)]);

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

test("stripping Flow moves no offset, whatever alphabet the file is written in", async () => {
  // B5 is about the unit: oxc reports offsets in UTF-16 code units and the
  // walkers slice the same in-memory string, so that is the length the strip
  // has to preserve. The byte length can move and does not matter, because
  // nothing indexes bytes: `Cafe\u0301` is five code units and six bytes, and five
  // spaces are five of each.
  //
  // The retry has to actually fire for any of that to be under test, and a .js
  // file is handed to the TypeScript grammar, which accepts most of what Flow
  // writes. Only Flow-only syntax reaches the stripper, so that is what the
  // fixture holds: an earlier version of this test used a plain type alias,
  // parsed clean as TypeScript, and asserted the invariant against a tree that
  // had never been stripped.
  const source = [
    "// @flow",
    "// \u65e5\u672c\u8a9e\u306e\u30b3\u30e1\u30f3\u30c8",
    "type Opts = {| name: string |}",
    'const emoji = "\ud83c\udf89\ud83c\udf89"',
    "export function greet(o: Opts): string {",
    "  try { return o.name + emoji } catch (e) { }",
    "}",
    "const after_the_unicode = 1",
    "export { after_the_unicode }",
  ].join("\n");

  const { records } = await parseAll([{ rel: "unicode.js", source, lang: "js" }], { withProgram: true });
  const r = records.get("unicode.js");

  assert.equal(r.kind, "ok");
  assert.equal(r.stripped, true, "the retry has to have fired, or this asserts nothing");
  assert.equal(r.length, source.length, "the reported length is the source's own, not the stripped one");
  assert.ok(r.hits.swallowed_error?.length >= 1);

  // The offsets are the whole point. Every one of them sits after two lines of
  // non-ASCII and after the type the stripper removed, and the walkers slice
  // the source the parser never saw. A stripper that deleted the annotations
  // instead of blanking them would leave each of these pointing short.
  const marker = r.program.body
    .flatMap((n) => n.declarations ?? [])
    .find((d) => d.id?.name === "after_the_unicode");
  assert.ok(marker, "the fixture lost its marker");
  assert.equal(
    source.slice(marker.start, marker.end),
    "after_the_unicode = 1",
    "an offset off the stripped tree no longer lands on its own text in the source"
  );
});

test("a dimension that reads type syntax says nothing about a file whose types were stripped", async () => {
  // The retry hands the walkers a tree with the annotations blanked out. Two
  // dimensions ask about exactly those annotations, so on a Flow file they read
  // the opposite of the source: measured on react, `explicit_return_type` said
  // 0 of 1213 where the truth is 986, and three areas lost a claim they had
  // earned. B15's own argument, turned around: a tree that is not the file
  // moves the denominator without moving the code.
  const source = [
    "// @flow",
    'import type { Node } from "react"',
    "type Options = {| name: string |}",
    "export function describe(opts: Options): string { return opts.name }",
    "export function other(): number { return 1 }",
  ].join("\n");

  const { records } = await parseAll([{ rel: "flow.js", source, lang: "js" }]);
  const r = records.get("flow.js");

  assert.equal(r.kind, "ok", "the file is still read");
  assert.equal(r.hits.explicit_return_type, undefined, "it declares return types this tree cannot see");
  assert.equal(r.hits.type_only_import, undefined, "and a type-only import this tree cannot see");
  assert.ok(r.hits.function_style?.length >= 1, "the dimensions that read code still answer");
});

test("a file that needed no retry still answers the type dimensions", async () => {
  // The exclusion is about the stripped tree, not about the extension: a plain
  // TypeScript file in the same repository must still be asked.
  const source = "export function f(): number { return 1 }\n";

  const { records } = await parseAll([{ rel: "plain.ts", source, lang: "js" }]);

  assert.equal(records.get("plain.ts").hits.explicit_return_type?.length, 1);
});

test("the raw-transfer guard called with no argument reads this platform", () => {
  // The worker calls it with no argument, so the default is the only form
  // production uses and it was the only form nothing covered. Dropping the
  // default leaves `undefined !== "win32"`, which is true, and raw transfer
  // turns back on for the platform it was disabled for.
  const real = process.platform;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    assert.equal(rawTransferAllowed(), false);
  } finally {
    Object.defineProperty(process, "platform", { value: real, configurable: true });
  }
});

test("a Flow file with no @flow pragma is read too", async () => {
  // Most Flow in the wild carries the pragma and some does not. The stripper
  // skips an unmarked file unless it is told to read everything, and a file it
  // skips comes back with the same syntax oxc already rejected.
  const source = [
    "type Opts = {| name: string |}",
    "export function greet(o: Opts): string { return o.name }",
  ].join("\n");

  const { records } = await parseAll([{ rel: "nopragma.js", source, lang: "js" }]);
  const r = records.get("nopragma.js");

  assert.equal(r.kind, "ok", `an unmarked Flow file came back ${r.kind}`);
  assert.equal(r.stripped, true);
});

test("the retry reaches every extension that can hold Flow", async () => {
  // Flow is not confined to .js. Narrowing the test to .js and .jsx leaves a
  // .mjs or .cjs file rejected, which is the state this whole retry exists to
  // get out of.
  const source = [
    "// @flow",
    "type Opts = {| name: string |}",
    "export function greet(o: Opts): string { return o.name }",
  ].join("\n");

  for (const rel of ["a.js", "b.jsx", "c.mjs", "d.cjs"]) {
    const { records } = await parseAll([{ rel, source, lang: "js" }]);
    assert.equal(records.get(rel).kind, "ok", `${rel} was rejected rather than retried`);
  }
});

test("a scan whose node_modules predates the stripper says which dependency is missing", async (t) => {
  // The retry cannot run, so every Flow file is charged as unreadable and
  // nothing on screen connects the count to its cause. On react that is 286
  // files and 13 claims that quietly stop being stated.
  const home = installWithoutStripper(t);

  const repo = mkdtempSync(join(tmpdir(), "anatomiya-flowrepo-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  mkdirSync(join(repo, "src"), { recursive: true });
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(repo, "src", `f${i}.js`), `export const v${i} = ${i}\n`);
  }
  writeFileSync(join(repo, "src", "flowed.js"), FLOW_SOURCE + "\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");

  const out = execFileSync(process.execPath, [join(home, "bin", "anatomiya.mjs"), "scan", repo], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(out, /holds? syntax the parser rejected/, `the Flow file was expected to be rejected here:\n${out}`);
  assert.match(out, /flow-remove-types is not installed/, `nothing named the missing dependency:\n${out}`);
});

test("a stripped file says nothing about its imports either", async () => {
  // The stripper deletes `import type {X} from './y'`, and those are sites of
  // the extension claim: react writes 309 of them and not one carries an
  // extension, so a stripped file reports only the imports that survived and
  // its conformance reads higher than the file's. The dimensions that do not
  // depend on the annotations still answer.
  const source = [
    "// @flow",
    "import type {Opts} from './opts'",
    "import {run} from './run'",
    "type Exact = {| n: string |}",
    "export function greet(o: Exact): string {",
    "  const fallback = o.n ?? 'x'",
    "  return run(fallback)",
    "}",
  ].join("\n");

  const { records } = await parseAll([{ rel: "flow.js", source, lang: "js" }]);
  const r = records.get("flow.js");

  assert.equal(r.kind, "ok");
  assert.equal(r.stripped, true, "the retry has to have fired, or this asserts nothing");
  for (const key of ["import_extension", "explicit_return_type", "type_only_import"]) {
    assert.equal(r.hits[key], undefined, `${key} answered off a tree with the types deleted`);
  }
  assert.equal(r.hits.nullish_default?.length, 1, "a dimension that reads code still answers");
});

test("a multi-line annotation leaves the line numbers where they were", async () => {
  // The check prints line numbers off this tree. Blanking preserves offsets
  // only if it preserves the newlines inside a type that spans several lines;
  // a stripper that collapsed them would move every line below it, and the
  // check would name the wrong one.
  const source = [
    "// @flow",
    "type Opts = {|",
    "  name: string,",
    "  size: number,",
    "|}",
    "export function greet(",
    "  o: Opts,",
    "): string {",
    "  return o.name",
    "}",
    "const marker = 1",
    "export { marker }",
  ].join("\n");

  const { records } = await parseAll([{ rel: "multiline.js", source, lang: "js" }], { withProgram: true });
  const r = records.get("multiline.js");

  assert.equal(r.stripped, true, "the retry has to have fired, or this asserts nothing");
  const marker = r.program.body.flatMap((n) => n.declarations ?? []).find((d) => d.id?.name === "marker");
  assert.ok(marker, "the fixture lost its marker");
  assert.equal(source.slice(0, marker.start).split("\n").length, 11, "the marker is on line 11 of the source");
});

test("withProgram also hands back the comments the tree carries", async () => {
  const { records } = await parseAll(
    [{ rel: "c.ts", lang: "js", source: "/** doc */\nexport function a() {}\n" }],
    { withProgram: true }
  );
  const r = records.get("c.ts");
  assert.equal(r.ok, true);
  assert.equal(r.comments.length, 1);
});

test("the per-file cap sits under the parse timeout on any load, at one megabyte", () => {
  // Measured across a 35-repository corpus: no hand-written source file
  // exceeds 850 KB (vscode.d.ts at 725 KB is the largest), while every file
  // between 1 and 4 MB is a bundle, compiled output or a perf fixture, and
  // those sit at the 5 s parse timeout boundary, flipping between crashed and
  // parsed with machine load. Each flip moves the always-loaded overview (A5).
  assert.equal(MAX_FILE_BYTES, 1024 * 1024);
});
