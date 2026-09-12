import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWorkflow } from "./workflow-harness.mjs";

/**
 * The harness is the oracle every workflow case is decided by, and each of its
 * fidelity claims could be deleted with all of them still green. A harness that
 * is kinder than the sandbox passes a script the session throws on, which is
 * the one failure that cannot be caught anywhere else.
 */

/** A one-line workflow whose body is whatever a case is about. */
function scriptDoing(t, body) {
  const dir = mkdtempSync(join(tmpdir(), "harness-case-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "case.js");
  writeFileSync(
    path,
    `export const meta = {\n  name: 'case',\n  description: 'what this case is about',\n}\n\n${body}\n`,
  );
  return path;
}

/** What a run threw, as a string, or "" where it returned. */
async function threwFrom(path) {
  try {
    await runWorkflow(path);
    return "";
  } catch (err) {
    return String(err?.message ?? err);
  }
}

test("the clock and the coin throw, the way they throw in a session", async (t) => {
  for (const [what, body] of [
    ["Date.now", "return { at: Date.now() }"],
    ["new Date()", "return { at: new Date() }"],
    ["Math.random", "return { n: Math.random() }"],
    ["bare Date()", "return { at: Date() }"],
  ]) {
    assert.match(await threwFrom(scriptDoing(t, body)), /unavailable in workflow scripts/, what);
  }
});

test("the clock shim is the build's, so a script that guards on it takes the same branch here", async (t) => {
  // `Date.now` absent rather than throwing let a script guarded with
  // `typeof Date.now === 'function'` pass the harness and die in a session.
  const run = await runWorkflow(scriptDoing(t, "return { kind: typeof Date.now, ctor: new Date(0).constructor === Date }"));
  assert.equal(run.result.kind, "function");
  // And the constructor route back to a live clock is closed.
  assert.equal(run.result.ctor, true);
});

test("a date the sandbox does allow still works", async (t) => {
  const run = await runWorkflow(scriptDoing(t, "return { year: new Date(0).getUTCFullYear() }"));
  assert.equal(run.result.year, 1970);
});

test("the body runs strict, so a write the build refuses is not silently dropped", async (t) => {
  // The build compiles the body as `(async () => {'use strict'; … })()`. Run as
  // a sloppy function body, a write to a frozen global passed here and threw in
  // a session, and nothing else in the suite could see the difference.
  assert.match(await threwFrom(scriptDoing(t, "budget.total = 5\nreturn { done: true }")), /read only|Cannot assign/i);
});

test("generated code is refused, the way the context refuses it", async (t) => {
  for (const body of ["return { n: new Function('return 7')() }", "return { n: eval('7') }"]) {
    assert.match(await threwFrom(scriptDoing(t, body)), /Code generation|not defined/i, body);
  }
});

test("a global the sandbox does not hold is a ReferenceError here too", async (t) => {
  for (const [what, body] of [
    ["process", "return { cwd: process.cwd() }"],
    ["require", "return { fs: require('node:fs') }"],
    // Deleted by the build's hardening pass rather than absent from the realm.
    ["WeakRef", "return { held: new WeakRef({}) }"],
  ]) {
    assert.match(await threwFrom(scriptDoing(t, body)), /is not defined/, what);
  }
});

test("parallel refuses a promise, because the real one raises a TypeError on it", async (t) => {
  assert.match(await threwFrom(scriptDoing(t, "await parallel([Promise.resolve(1)])\nreturn { done: true }")), /array of functions/);
});

test("a pipeline stage answering null drops the item and skips the rest of its chain", async (t) => {
  // The later stage answers rather than throwing: one that throws is caught and
  // the item drops to null anyway, so the case would pass either way and could
  // not see a harness that ran the rest of the chain on a null.
  const run = await runWorkflow(scriptDoing(t, "const out = await pipeline([1], () => null, () => 'ran past the null')\nreturn { out }"));
  assert.deepEqual(run.result.out, [null]);
});

test("args cross as JSON, so a case cannot hand a script something a session could not", async (t) => {
  // A fixture that is JSON-identical either way cannot see the crossing at all.
  // A function and an undefined do not survive JSON, and a live function handed
  // straight into the context would let a case drive a script no session can.
  const run = await runWorkflow(scriptDoing(t, "return { kinds: Object.keys(args), fn: typeof args.fn, deep: args.when.nested }"), {
    args: { when: { nested: [1, 2] }, fn: () => 7, gone: undefined },
  });
  assert.deepEqual(run.result.kinds, ["when"]);
  assert.equal(run.result.fn, "undefined");
  assert.deepEqual(run.result.deep, [1, 2]);
});
