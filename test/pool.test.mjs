import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPathControl, needsPosixPaths, needsShebang, needsTmpdirVariable } from "./platform.mjs";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, defaultPoolSize, rssOf, GUARDS } from "../plugins/anatomiya/lib/pool.mjs";
import { pathToFileURL } from "node:url";

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
    // On a fast machine the bomb dies by itself (one attempt, poison); on a
    // loaded runner the wall clock kills it first, and a timer kill beside
    // another parse is retried once by design. Which happened is in the error, so the pin follows it.
    if (rb.error.includes("timed out twice")) {
      assert.equal(rb.attempts, 2, "a wall-clock kill was retried once, then charged");
    } else {
      assert.equal(rb.attempts, 1, "a file that killed the worker itself is poison, and gets one attempt");
    }
    assert.equal(rb.rel, bomb.rel, "the failure is keyed by the file that caused it");

    // The pool must still be usable afterwards.
    const after = await pool.parse(file(dir, "c.ts", "export const c = 3\n"));
    assert.equal(after.ok, true, "the pool recovered");
  });
});

test("a parse the wall clock killed while it ran alone is charged without a retry", async () => {
  // The retry offers a parse with nothing beside it (B3). One that already had
  // that and was killed would only spend the clock again: retries run one at a
  // time, so each such file added its whole timeout to the scan. A 1ms guard
  // kills every parse of a file this large, and a tiny file here raced the timer
  // against a warm worker's sub-millisecond parse. The body stays under the
  // size cap.
  const big = Array.from({ length: 30000 }, (_, i) => `export const s${i} = ${i}`).join("\n") + "\n";

  await withPool({ size: 1, guards: { timeoutMs: 1 } }, async (pool, dir) => {
    const r = await pool.parse(file(dir, "slow.ts", big));

    assert.equal(r.ok, false);
    assert.equal(r.crashed, true, "a file the pool never read is charged, not dropped");
    assert.equal(r.attempts, 1, "a parse that ran alone is not run alone again");
    assert.match(r.error, /timed out/);
  });
});

function answered(log) {
  if (!existsSync(log)) return 0;
  return new Set(readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("end ")).map((l) => l.split(" ")[3])).size;
}

test("a parse the wall clock killed is retried alone, after the queue drains", async (t) => {
  // The batch a killed parse died in was competing for the machine (B3), so
  // its retry runs with no other parse in flight. Back on the end of the live
  // queue, six near-cap files killed in one burst were retried side by side
  // under load and all six were charged as crashed.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-retry-alone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "log");
  const preload = join(dir, "preload.mjs");
  // The first attempt at a `hang` file never returns, so the clock kills it;
  // every other parse holds its worker a moment, so overlap has room to show.
  writeFileSync(
    preload,
    `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const LOG = ${JSON.stringify(log)};
process.on("message", ({ rel }) => {
  appendFileSync(LOG, "start " + rel + " " + Date.now() + "\\n");
  if (rel.startsWith("hang") && !existsSync(LOG + "." + rel)) {
    writeFileSync(LOG + "." + rel, "");
    for (;;);
  }
  const end = Date.now() + 60;
  while (Date.now() < end);
});
const send = process.send.bind(process);
process.send = (msg, ...rest) => {
  if (msg && msg.rel) appendFileSync(LOG, "end " + msg.rel + " " + Date.now() + " " + process.pid + "\\n");
  return send(msg, ...rest);
};
`,
  );
  const files = ["hang1.ts", "hang2.ts", ...Array.from({ length: 6 }, (_, i) => `n${i}.ts`)].map((name) =>
    file(dir, name, "export const x = 1\n"),
  );

  await withPool({ size: 2, execArgv: ["--import", pathToFileURL(preload).href], guards: { timeoutMs: 1_000 } }, async (pool) => {
    // Both workers answer once first, so the two hang files start side by side:
    // a kill that ran alone is charged without a retry.
    for (let i = 0; answered(log) < 2 && i < 100; i++) {
      await Promise.all([0, 1].map((k) => pool.parse(file(dir, `w${i}-${k}.ts`, "export const w = 1\n"))));
    }
    const results = await Promise.all(files.map((f) => pool.parse(f)));
    for (const rel of ["hang1.ts", "hang2.ts"]) {
      const r = results.find((x) => x.rel === rel);
      assert.equal(r.ok, true, `${rel}: ${r.error}`);
      assert.equal(r.attempts, 2, `${rel} was killed once and answered on its retry`);
    }
  });

  // Each start paired with the end that follows it; a killed attempt has none.
  const spans = [];
  const open = new Map();
  for (const line of readFileSync(log, "utf8").trim().split("\n")) {
    const [what, rel, at] = line.split(" ");
    if (what === "start") open.set(rel, { rel, from: Number(at) });
    else spans.push({ ...open.get(rel), to: Number(at) });
  }
  const retries = spans.filter((s) => s.rel.startsWith("hang"));
  assert.equal(retries.length, 2);
  for (const r of retries) {
    for (const s of spans) {
      if (s === r) continue;
      assert.ok(s.to <= r.from || s.from >= r.to, `${s.rel} ran beside the retry of ${r.rel}`);
    }
  }
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

test("a worker that starts and never says ready is killed on a clock, and the pool fails rather than hangs", async (t) => {
  // A queued file is handed only to a worker that said ready, and nothing
  // timed the wait: a worker stalled in its own startup (a native binding
  // blocked on a network filesystem, a preload that never settles) left every
  // file queued and the scan waiting forever. The stall is reached through
  // `execArgv`: a preload whose top-level await never settles, with a timer
  // holding the process open, is a worker that started and never answers.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-noready-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.ts"), "export const x = 1\n");
  const stall = "data:text/javascript,setInterval(()=>{},1e6);await new Promise(()=>{})";

  const pool = createPool({ size: 1, execArgv: ["--import", stall], guards: { readyTimeoutMs: 300 } });
  try {
    const started = Date.now();
    const r = await pool.parse({ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" });
    assert.equal(r.ok, false);
    assert.equal(r.crashed, true, "no parser answered, which is the crash A13 reads as a blind run");
    assert.match(r.error, /^parser worker will not start: no ready answer in 300ms/);
    assert.ok(Date.now() - started < 10_000, "bounded by the ready clock times the stillborn limit");
  } finally {
    await pool.close();
  }
});

test("a pool given another worker module forks that one and reports its engine", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-stub-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = join(dir, "stub-worker.mjs");
  writeFileSync(
    worker,
    `process.on("message", ({ rel }) => {
  process.send({ rel, ok: true, hits: {}, facets: { testRunner: null, testCalls: false }, errors: 0 });
});
process.send({ ready: true, engine: "stub", version: "1" });
`,
  );
  // Not JavaScript, so an answer of ok came from the stub and not from oxc.
  const files = ["a.py", "b.py", "c.py"].map((name) => file(dir, name, "def f(:\n"));

  const pool = createPool({ size: 2, worker, engine: "stub" });
  try {
    const results = await Promise.all(files.map((f) => pool.parse(f)));

    assert.deepEqual(
      results.map(({ attempts, ...r }) => r),
      files.map((f) => ({ rel: f.rel, ok: true, hits: {}, facets: { testRunner: null, testCalls: false }, errors: 0 })),
    );
    assert.equal(pool.versions.stub, "1");
    assert.equal(pool.versions.oxc, undefined, "no oxc worker was forked");
  } finally {
    await pool.close();
  }
});

test("a worker that says it cannot go on finishes its file and is replaced before it is handed another", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-retire-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = join(dir, "retiring-worker.mjs");
  // After its trap this stub answers nothing, as a parser whose heap is gone would answer nothing true.
  writeFileSync(
    worker,
    `let spent = false;
process.on("message", ({ rel }) => {
  if (spent) return;
  if (rel !== "a.py") return process.send({ rel, ok: true, pid: process.pid });
  spent = true;
  process.send({ rel, ok: false, error: "wasm trap", retire: true, pid: process.pid });
});
process.send({ ready: true, engine: "stub", version: "1" });
`,
  );
  const files = ["a.py", "b.py", "c.py"].map((name) => file(dir, name, "x = 1\n"));

  const pool = createPool({ size: 1, worker, engine: "stub", guards: { timeoutMs: 3_000 } });
  try {
    const [a, b, c] = await Promise.all(files.map((f) => pool.parse(f)));

    assert.deepEqual([a.rel, b.rel, c.rel], ["a.py", "b.py", "c.py"]);
    assert.equal(a.ok, false);
    assert.equal(a.error, "wasm trap", "the file that trapped keeps its own answer");
    assert.equal(b.ok, true);
    assert.equal(c.ok, true);
    for (const r of [a, b, c]) assert.notEqual(r.crashed, true, `${r.rel} is charged to no crash`);
    assert.notEqual(b.pid, a.pid, "the file queued behind the trap went to another process");
    assert.notEqual(c.pid, a.pid);
  } finally {
    await pool.close();
  }
});

test("a guard the pool does not carry is refused under the engine the pool was given", () => {
  assert.throws(() => createPool({ size: 1, engine: "stub", guards: { timeoutMS: 1 } }), /timeoutMS is not one of the stub guards/);
  assert.throws(() => createPool({ size: 1, guards: { timeoutMS: 1 } }), /timeoutMS is not one of the oxc guards/);
});

test("a worker module that does not exist fails the pool as a worker that will not start", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-no-worker-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ["a.ts", "b.ts", "c.ts"].map((name) => file(dir, name, "export const x = 1\n"));

  const pool = createPool({ size: 2, worker: join(dir, "gone-worker.mjs"), engine: "stub" });
  try {
    const results = await Promise.all(files.map((f) => pool.parse(f)));

    for (const r of results) {
      assert.equal(r.ok, false);
      assert.equal(r.crashed, true, "no parser answered, which is a crash on every file");
      assert.match(r.error, /^parser worker will not start: /);
    }
    assert.deepEqual(results.map((r) => r.rel), files.map((f) => f.rel));
    const later = await pool.parse(files[0]);
    assert.equal(later.crashed, true, "a file asked for after the pool broke is charged the same way");
  } finally {
    await pool.close();
  }
  assert.equal((await pool.parse(files[0])).error, "pool closed");
});

test("the ready clock is a guard with a default", () => {
  assert.equal(typeof GUARDS.readyTimeoutMs, "number");
  assert.ok(GUARDS.readyTimeoutMs >= 10_000, "a cold native binding on a slow disk is not a stalled worker");
});

test("a worker that cannot be forked fails the pool with its reason, not an unhandled error", needsTmpdirVariable, async (t) => {
  // A fork that never starts emits 'error' and never 'exit', and the pool
  // listened for 'exit' only: a per-session TMPDIR that had been cleaned up
  // took `scan` down with Node's own "Unhandled 'error' event" stack and exit
  // 1, where a worker dying before it answers was already the one-line
  // "parser worker will not start". EAGAIN at a process limit and EMFILE are
  // the same event with a different code; a missing cwd is the one a test
  // can reach.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nofork-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.ts"), "export const x = 1\n");

  const was = process.env.TMPDIR;
  process.env.TMPDIR = join(dir, "gone");
  try {
    const pool = createPool({ size: 2 });
    try {
      const r = await pool.parse({ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" });
      assert.equal(r.ok, false);
      assert.match(r.error, /^parser worker will not start: .*ENOENT/);
      // No parser ever answered, which is the crash A13 reads as a blind run.
      // Charged as unreadable instead, the scan went on to write an overview
      // of zero areas and remove every correct area file beside it.
      assert.equal(r.crashed, true);
      const later = await pool.parse({ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" });
      assert.equal(later.crashed, true, "a file asked for after the pool broke is charged the same way");
    } finally {
      await pool.close();
    }
  } finally {
    if (was === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = was;
  }
});

test("a ps that will not return costs the poll its timeout, not the run", needsShebang, async () => {
  // F5: every subprocess here carries a timeout. Without it the guard that
  // exists to stop a runaway parse becomes the hang. Handed through the seam
  // rather than PATH, which no longer decides which `ps` runs, and as a
  // platform that polls with one, since Linux reads /proc.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-ps-"));
  writeFileSync(join(dir, "ps"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });

  const started = Date.now();
  try {
    const out = await rssOf([process.pid], GUARDS, { platform: "darwin", ps: join(dir, "ps") });
    const elapsed = Date.now() - started;

    assert.equal(out.size, 0, "a ps that answered nothing reports nothing");
    assert.ok(elapsed < 10_000, `waited ${elapsed}ms on a ps that never returns`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a parse over the memory ceiling is killed and charged, and the same file parses under the default ceiling", async (t) => {
  // Windows has no poll, so the five-second clock is the only guard there.
  if (process.platform === "win32") return t.skip("no resident-size poll on Windows");
  const body = "export const a = [" + Array.from({ length: 40000 }, (_, i) => `{ k${i}: ${i} }`).join(",") + "];\n";

  // The clock is lifted on both pools so it cannot fail either parse: under
  // coverage on a loaded runner the second one has run past 5s.
  await withPool({ size: 1, guards: { timeoutMs: 60_000, rssBytes: 1, rssGraceMs: 0, rssPollMs: 5 } }, async (pool, dir) => {
    const r = await pool.parse(file(dir, "big.js", body));
    assert.equal(r.ok, false, "every worker is over a one-byte ceiling");
    assert.equal(r.crashed, true);
    assert.equal(r.attempts, 1, "a kill for memory is charged, not retried");
  });
  await withPool({ size: 1, guards: { timeoutMs: 60_000 } }, async (pool, dir) => {
    assert.equal((await pool.parse(file(dir, "big.js", body))).ok, true, "so the ceiling is what failed it");
  });
});

test("the memory poll bounds what it will read back", () => {
  // The same battery every other subprocess carries: a timeout and a byte
  // bound, both named rather than left to the default.
  assert.ok(Number.isFinite(GUARDS.psTimeoutMs) && GUARDS.psTimeoutMs > 0);
  assert.ok(Number.isFinite(GUARDS.psMaxBytes) && GUARDS.psMaxBytes > 0);
});

test("the poll reads a live process's resident size", async () => {
  // The guard has to work, not only fail safely: a run whose ps is fine must
  // still get a number back, or the RSS ceiling never fires on anything.
  if (process.platform === "win32") return;

  const out = await rssOf([process.pid]);

  assert.ok(out.get(process.pid) > 0, "this process has a resident size");
});

test("the poll reads a resident size on a machine with no ps on PATH", needsPathControl, async () => {
  // Slim images (node:*-slim and most devcontainers) ship no procps, and the
  // guard shelled out to `ps` through PATH and swallowed the ENOENT: measured,
  // three files a forced 1 MB ceiling killed with `ps` present all parsed with
  // it absent, and nothing said the ceiling had stood down.
  if (process.platform === "win32") return;
  const path = process.env.PATH;
  process.env.PATH = "";
  try {
    const out = await rssOf([process.pid]);

    assert.ok(out.get(process.pid) > 0, "this process has a resident size with nothing on PATH");
  } finally {
    process.env.PATH = path;
  }
});

test("where the poll runs ps, it reads the same resident size", async (t) => {
  // macOS and the BSDs still take this path, and without this case it would
  // run only on the one CI job that is not Linux.
  if (process.platform === "win32" || !existsSync("/bin/ps")) return t.skip("no /bin/ps on this machine");

  const out = await rssOf([process.pid], GUARDS, { platform: "darwin" });

  assert.ok(out.get(process.pid) > 0, "this process has a resident size");
});

test("a ps in the directory the scan runs from is never the one the guard runs", { ...needsPathControl, ...needsShebang }, async (t) => {
  // `scan .` runs from the repository, and an empty PATH entry is the current
  // directory: measured, a `ps` committed to the scanned repository ran as the
  // user, handed the workers' pids, while the guard polled.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-planted-ps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "ps"), `#!/bin/sh\necho ran > ${JSON.stringify(join(dir, "RAN"))}\n`, { mode: 0o755 });
  const path = process.env.PATH;
  const cwd = process.cwd();
  process.env.PATH = ":";
  process.chdir(dir);
  try {
    await rssOf([process.pid]);
  } finally {
    process.chdir(cwd);
    process.env.PATH = path;
  }

  assert.equal(existsSync(join(dir, "RAN")), false, "the repository's own ps ran");
});

test("the default pool is sized off the cores this process may use, not the host's", (t) => {
  // A container limited to two cores still reports every host core in cpus(),
  // and a pool sized off that ran eight workers on two cores.
  t.mock.method(os, "cpus", () => Array.from({ length: 16 }, () => ({})));
  const cores = t.mock.method(os, "availableParallelism", () => 3);
  assert.equal(defaultPoolSize(), 2);
  cores.mock.mockImplementation(() => 1);
  assert.equal(defaultPoolSize(), 1);
  cores.mock.mockImplementation(() => 32);
  assert.equal(defaultPoolSize(), 8);
});
