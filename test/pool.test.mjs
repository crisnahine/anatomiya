import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths, needsShebang } from "./platform.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, rssOf, GUARDS } from "../lib/pool.mjs";

function file(dir, name, body) {
  const abs = join(dir, name);
  writeFileSync(abs, body);
  return { rel: name, abs, lang: name.endsWith("tsx") ? "jsx" : "js" };
}

// A failed assertion must not leave forked workers behind: node --test waits on
// the child processes and the run hangs instead of reporting the failure.
async function withPool(opts, body) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-pool-"));
  const pool = createPool(opts);
  try {
    await body(pool, dir);
  } finally {
    await pool.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a file that kills the parser costs one file, not the run", async () => {
  await withPool({ size: 2 }, async (pool, dir) => {
    const good1 = file(dir, "a.ts", "export const a = 1\n");
    // Deep nesting is what was measured taking oxc down with an uncatchable
    // SIGSEGV from inside parseSync.
    const bomb = file(dir, "bomb.ts", "const x = " + "[".repeat(60000) + "1" + "]".repeat(60000) + "\n");
    const good2 = file(dir, "b.ts", "export function b() { return 2 }\n");

    const [r1, rb, r2] = await Promise.all([pool.parse(good1), pool.parse(bomb), pool.parse(good2)]);

    assert.equal(r1.ok, true, "a healthy file before the bomb still parses");
    assert.equal(r2.ok, true, "a healthy file after the bomb still parses");
    assert.equal(rb.ok, false, "the bomb is charged as a failure");
    // Without this the test still passes if oxc merely throws, which would no
    // longer be a test of process containment.
    assert.equal(rb.crashed, true, "the bomb died uncatchably, the process boundary caught it");
    assert.equal(rb.attempts, 1, "a file that killed the worker itself is poison, and gets one attempt");
    assert.equal(rb.rel, bomb.rel, "the failure is keyed by the file that caused it");

    // The pool must still be usable afterwards.
    const after = await pool.parse(file(dir, "c.ts", "export const c = 3\n"));
    assert.equal(after.ok, true, "the pool recovered");
  });
});

test("a parse the wall clock killed is tried again before it is charged", async (t) => {
  // The flake A5 exists to stop: on a 35-repository run the same file was
  // charged as crashed in one scan and parsed in the next, and the unexamined
  // count moved the always-loaded overview. A guard of 1ms kills every parse,
  // so what is under test is the second attempt, not the first one's timing.
  const was = GUARDS.timeoutMs;
  GUARDS.timeoutMs = 1;
  t.after(() => {
    GUARDS.timeoutMs = was;
  });

  await withPool({ size: 1 }, async (pool, dir) => {
    const r = await pool.parse(file(dir, "slow.ts", "export const s = 1\n"));

    assert.equal(r.ok, false);
    assert.equal(r.crashed, true, "a file the pool never read is charged, not dropped");
    assert.equal(r.attempts, 2, "the timed-out file went back on the queue once");
    assert.match(r.error, /twice/, "the error says the retry ran out too");
  });
});

test("a parse that answered is charged to one attempt", async () => {
  await withPool({ size: 1 }, async (pool, dir) => {
    const r = await pool.parse(file(dir, "fast.ts", "export const f = 1\n"));

    assert.equal(r.ok, true);
    assert.equal(r.attempts, 1);
  });
});

test("JSX in a .js file is parsed, not charged as a syntax error", async () => {
  // The worker named every file the extension did not call jsx `f.ts`, where
  // `<div` opens a type assertion. oxc recovers, the dimensions walk the
  // wreckage, and nothing reports it: 727 of react/react's 2,296 files and
  // 3,924 of next.js's 21,358 are counted this way.
  await withPool({ size: 1 }, async (pool, dir) => {
    const src = [
      "import React from 'react'",
      "",
      "export function Row({ label, onPick }) {",
      '  return <div className="wrap"><button onClick={onPick}>{label}</button></div>',
      "}",
      "",
    ].join("\n");

    const r = await pool.parse(file(dir, "Row.js", src));

    assert.equal(r.ok, true);
    assert.equal(r.errors, 0, "JSX is syntax here, not an error");
    assert.equal(r.hits.function_style.length, 1, "the declaration is counted, not lost with the tree");
  });
});

test("an angle-bracket assertion in a .ts file still parses", async () => {
  // The other half of the same choice. `<string>x` is legal TypeScript and a
  // syntax error under the JSX grammar, so the filename has to follow the
  // extension rather than always asking for the JSX-capable one.
  await withPool({ size: 1 }, async (pool, dir) => {
    const src = 'declare const raw: unknown\nexport const name = <string>raw\n';

    const r = await pool.parse(file(dir, "assert.ts", src));

    assert.equal(r.ok, true);
    assert.equal(r.errors, 0, "the assertion is syntax here, not an error");
  });
});

test("a file over the size cap is skipped without being read", async () => {
  await withPool({ size: 1 }, async (pool, dir) => {
    const big = file(dir, "big.ts", "//" + "x".repeat(5 * 1024 * 1024) + "\n");
    const r = await pool.parse(big);

    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(r.program, undefined, "nothing was parsed");

    // A skip must not consume the only worker.
    const after = await pool.parse(file(dir, "small.ts", "export const s = 1\n"));
    assert.equal(after.ok, true);
  });
});

test("offsets index the same string the parser was given", async () => {
  // The tree only crosses the channel for a pool that asked for it: the scan
  // reads counts, and only the check needs nodes to report a line.
  await withPool({ size: 1, withProgram: true }, async (pool, dir) => {
    // Non-ASCII before the declaration is what makes a byte index drift: oxc
    // counts UTF-16 code units, a Buffer counts bytes.
    const src = 'const emoji = "🚀🚀🚀 héllo"\nexport function target() { return 1 }\n';
    const r = await pool.parse(file(dir, "u.ts", src));

    assert.equal(r.ok, true);
    const fn = r.program.body.find((n) => n.type === "ExportNamedDeclaration");
    assert.ok(fn, "found the export");
    const sliced = src.slice(fn.start, fn.end);
    assert.match(sliced, /^export function target/, "string slice lands on the declaration");
    assert.equal(r.length, src.length, "the reported length is the string's, not the file's bytes");
  });
});

test("a file that cannot be read resolves instead of throwing", async () => {
  await withPool({ size: 1 }, async (pool, dir) => {
    const gone = { rel: "gone.ts", abs: join(dir, "gone.ts"), lang: "js" };
    const r = await pool.parse(gone);

    assert.equal(r.ok, false);
    assert.equal(r.rel, "gone.ts");
    assert.equal(r.error, "unreadable");

    const after = await pool.parse(file(dir, "d.ts", "export const d = 4\n"));
    assert.equal(after.ok, true, "a missing file did not consume a worker");
  });
});

test("a hostile filename reaches the parser as a path, not as an argument", needsPosixPaths, async () => {
  await withPool({ size: 1 }, async (pool, dir) => {
    // The path travels over IPC, never through a shell or an argv, so a newline
    // and a leading dash are ordinary characters.
    const newline = file(dir, "a\nb.ts", "export const a = 1\n");
    const dash = file(dir, "-r.ts", "export const b = 2\n");

    const [rn, rd] = await Promise.all([pool.parse(newline), pool.parse(dash)]);

    assert.equal(rn.ok, true);
    assert.equal(rn.rel, "a\nb.ts", "the key survives the round trip intact");
    assert.equal(rd.ok, true);
    assert.equal(rd.rel, "-r.ts");
  });
});

test("a bigint literal survives the IPC channel", async () => {
  await withPool({ size: 1, withProgram: true }, async (pool, dir) => {
    // The AST holds a real BigInt for this, and the channel serialises with
    // JSON, which throws on one.
    const r = await pool.parse(file(dir, "n.ts", "const n = 9007199254740993n\n"));

    assert.equal(r.ok, true, "a bigint literal is not charged as a parse failure");
    assert.equal(r.program.body.length, 1);
  });
});

test("every file gets a result when there are more files than workers", async () => {
  await withPool({ size: 2 }, async (pool, dir) => {
    const files = Array.from({ length: 12 }, (_, i) => file(dir, `q${i}.ts`, `export const q${i} = ${i}\n`));
    const results = await Promise.all(files.map((f) => pool.parse(f)));

    assert.equal(results.length, 12);
    assert.deepEqual(
      results.map((r) => r.rel),
      files.map((f) => f.rel),
      "each result is the one its caller asked for",
    );
    assert.ok(
      results.every((r) => r.ok),
      "the queue drained without dropping or mixing up a job",
    );
  });
});

test("closing with work outstanding resolves every caller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-pool-"));
  const pool = createPool({ size: 1 });
  try {
    const files = Array.from({ length: 6 }, (_, i) => file(dir, `c${i}.ts`, `export const c${i} = ${i}\n`));
    const pending = files.map((f) => pool.parse(f));

    await pool.close();
    // A queued job that never resolves hangs the scan, so the assertion here is
    // that this settles at all.
    const results = await Promise.all(pending);

    assert.equal(results.length, 6);
    assert.deepEqual(
      results.map((r) => r.rel),
      files.map((f) => f.rel),
    );

    const after = await pool.parse(files[0]);
    assert.equal(after.ok, false);
    assert.equal(after.error, "pool closed");

    await pool.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a flag on the parent that a worker cannot take does not break the pool", async (t) => {
  // `fork` passes the parent's execArgv down. `--input-type=module` is legal on
  // a parent that ran `node -e` and illegal on a child that loads a file, so
  // every worker died before it answered and the whole scan reported
  // "parser worker will not start" with the real reason nowhere in sight.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-execargv-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.ts"), "export const x = 1\n");

  const was = process.execArgv;
  process.execArgv = [...was, "--input-type=module"];
  try {
    const pool = createPool({ size: 1 });
    try {
      const r = await pool.parse({ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" });
      assert.equal(r.ok, true, r.error || "the worker started despite the parent's flag");
    } finally {
      await pool.close();
    }
  } finally {
    process.execArgv = was;
  }
});

test("a worker that dies before answering reports what it printed", async (t) => {
  // The pool pipes the worker's stderr and used to read none of it, so the one
  // place the real cause is written was discarded and every failure read the
  // same. `execArgv` is an option so the condition is reachable from a test.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-stderr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.ts"), "export const x = 1\n");

  const pool = createPool({ size: 1, execArgv: ["--nonsense-flag-that-does-not-exist"] });
  try {
    const r = await pool.parse({ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" });
    assert.equal(r.ok, false);
    assert.match(r.error, /parser worker will not start/);
    assert.match(r.error, /nonsense-flag/, "the worker's own words reach the caller");
  } finally {
    await pool.close();
  }
});

test("a ps that will not return costs the poll its timeout, not the run", needsShebang, () => {
  // F5: every subprocess here carries a timeout, and this one runs through
  // `execFileSync`, which blocks the parent's event loop. Without the timeout
  // the guard that exists to stop a runaway parse becomes the hang.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-ps-"));
  writeFileSync(join(dir, "ps"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;

  const started = Date.now();
  try {
    const out = rssOf([process.pid]);
    const elapsed = Date.now() - started;

    assert.equal(out.size, 0, "a ps that answered nothing reports nothing");
    assert.ok(elapsed < 10_000, `waited ${elapsed}ms on a ps that never returns`);
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the memory poll bounds what it will read back", () => {
  // The same battery every other subprocess carries: a timeout and a byte
  // bound, both named rather than left to the default.
  assert.ok(Number.isFinite(GUARDS.psTimeoutMs) && GUARDS.psTimeoutMs > 0);
  assert.ok(Number.isFinite(GUARDS.psMaxBytes) && GUARDS.psMaxBytes > 0);
});

test("the poll reads a live process's resident size", () => {
  // The guard has to work, not only fail safely: a run whose ps is fine must
  // still get a number back, or the RSS ceiling never fires on anything.
  if (process.platform === "win32") return;

  const out = rssOf([process.pid]);

  assert.ok(out.get(process.pid) > 0, "this process has a resident size");
});
