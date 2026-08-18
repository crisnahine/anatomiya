import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedChild, absentInterpreter, retryOnce } from "../lib/child.mjs";

const dir = mkdtempSync(join(tmpdir(), "anatomiya-child-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const STDIO = ["ignore", "ignore", "pipe", "ipc"];

function child(name, body) {
  const abs = join(dir, `${name}.mjs`);
  writeFileSync(abs, body);
  return abs;
}

// `close` rather than `exit`: the stderr the child wrote is still in the pipe
// when it exits, and what is under test is how much of it was kept.
const closed = (proc) => new Promise((resolve) => proc.once("close", (code, signal) => resolve({ code, signal })));

test("a child that floods stderr fills the cap and no more", async () => {
  const path = child("loud", 'process.stderr.write("x".repeat(10 * 1024))\n');
  const sup = guardedChild({ kind: "fork", modulePath: path, stdio: STDIO, stderrBytes: 2048 });

  await closed(sup.child);
  sup.settle();

  assert.equal(sup.stderr().length, 2048, "10 KB arrived in one chunk and the cap held");
  assert.equal(sup.killedBy(), null, "a child that ended by itself was not killed");
});

test("a child that never ends is killed by the wall clock, once", async () => {
  const path = child("sleeper", "setTimeout(() => {}, 60_000)\n");
  const fired = [];
  const sup = guardedChild({
    kind: "fork",
    modulePath: path,
    stdio: STDIO,
    stderrBytes: 2048,
    wallMs: 200,
    onTimeout: (reason) => fired.push(reason),
  });

  const { signal } = await closed(sup.child);
  sup.settle();

  assert.deepEqual(fired, ["wall"], "the caller is told once, before the kill");
  assert.equal(sup.killedBy(), "wall");
  assert.equal(signal, "SIGKILL");
});

test("a child that answers once and then goes quiet is killed by the idle clock", async () => {
  // The window is measured from the last answer, not from the spawn: a child
  // still handing back results is working, however long the run has taken.
  const path = child("quiet", "process.send({ answered: true })\nsetTimeout(() => {}, 60_000)\n");
  const fired = [];
  const sup = guardedChild({
    kind: "fork",
    modulePath: path,
    stdio: STDIO,
    stderrBytes: 2048,
    idleMs: 200,
    onTimeout: (reason) => fired.push(reason),
  });

  let answers = 0;
  sup.child.on("message", () => {
    answers++;
    sup.touch();
  });
  sup.touch();

  await closed(sup.child);
  sup.settle();

  assert.equal(answers, 1, "the answer arrived before the silence that killed it");
  assert.deepEqual(fired, ["idle"]);
  assert.equal(sup.killedBy(), "idle");
});

test("a spawn that found no interpreter is told apart from one that ran and failed", () => {
  // An interpreter that is not there is every file at once and an install
  // problem; anything else is one run that went wrong.
  assert.equal(absentInterpreter({ code: "ENOENT" }), true);
  assert.equal(absentInterpreter({ code: "EACCES" }), false);
  assert.equal(absentInterpreter(new Error("spawn failed")), false);
  assert.equal(absentInterpreter(null), false);
});

test("a job is marked for one more attempt and never for a third", () => {
  const job = { retried: false };

  assert.equal(retryOnce(job), true);
  assert.equal(job.retried, true, "the mark is on the job, so whoever charges it reads two attempts");
  assert.equal(retryOnce(job), false, "a second kill is charged rather than queued again");
});
