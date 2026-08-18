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

test("a supervisor with no stderr cap refuses instead of collecting nothing", () => {
  // `text.length < undefined` is false, so an omitted cap keeps no stderr at
  // all and every death before the first answer loses its cause.
  const path = child("unread", "process.stderr.write('boom')\n");

  assert.throws(() => guardedChild({ kind: "fork", modulePath: path, stdio: STDIO }), /stderrBytes/);
});

test("a kind this supervisor does not know refuses instead of spawning nothing", () => {
  // Twelve fields and a discriminated union: a misspelled `kind` fell through
  // to the spawn branch with `command` undefined, so the error named the wrong
  // thing two lines from a module that refuses a missing stderr cap out loud.
  const path = child("unknown-kind", "process.exit(0)\n");

  assert.throws(
    () => guardedChild({ kind: "forked", modulePath: path, stdio: STDIO, stderrBytes: 64 }),
    /forked/
  );
});

test("the stderr cap stops on a character boundary, never inside one", async () => {
  // The cap counts UTF-16 code units and an astral character is two of them,
  // so cutting on the count alone hands back a lone surrogate no earlier path
  // could produce (B5).
  const path = child("astral", 'process.stderr.write("a" + "\\u{1F600}".repeat(4))\n');
  const sup = guardedChild({ kind: "fork", modulePath: path, stdio: STDIO, stderrBytes: 4 });

  await closed(sup.child);
  sup.settle();

  assert.equal(sup.stderr(), "a\u{1F600}", "the half character the cap landed on was dropped");
});

test("a forked child is handed the environment its caller scrubbed", async () => {
  // The spawn branch has always taken one. A fork caller that scrubs an
  // environment and silently gets the parent's is the failure this closes.
  const path = child("env", "process.stderr.write(String(process.env.ANATOMIYA_HANDED))\n");
  const sup = guardedChild({
    kind: "fork",
    modulePath: path,
    stdio: STDIO,
    stderrBytes: 64,
    env: { ...process.env, ANATOMIYA_HANDED: "over" },
  });

  await closed(sup.child);
  sup.settle();

  assert.equal(sup.stderr(), "over");
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

  // Armed by the answer, never before the spawn: a window opened here has to
  // cover the child loading Node too, and under load the boot alone outruns it.
  let answers = 0;
  sup.child.on("message", () => {
    answers++;
    sup.touch();
  });

  await closed(sup.child);
  sup.settle();

  assert.equal(answers, 1, "the answer arrived before the silence that killed it");
  assert.deepEqual(fired, ["idle"]);
  assert.equal(sup.killedBy(), "idle");
});

test("a child that keeps answering outlives the window between its answers", async () => {
  // The re-arm is the whole idle clock. Armed once and never again, it is a
  // wall clock wearing the other name, and a Ruby corpus that takes longer than
  // one window dies mid-run with every file after the kill uncounted. Every
  // stub in the suites that exercise this answers inside one window, so nothing
  // else here can tell the two apart.
  const path = child(
    "steady",
    "let n = 0\n" +
      "const tick = () => {\n" +
      "  process.send({ n: ++n })\n" +
      "  if (n < 6) setTimeout(tick, 60)\n" +
      "  else process.exit(0)\n" +
      "}\n" +
      "tick()\n"
  );
  const fired = [];
  const sup = guardedChild({
    kind: "fork",
    modulePath: path,
    stdio: STDIO,
    stderrBytes: 2048,
    idleMs: 150,
    onTimeout: (reason) => fired.push(reason),
  });

  let answers = 0;
  sup.child.on("message", () => {
    answers++;
    sup.touch();
  });

  const { code } = await closed(sup.child);
  sup.settle();

  assert.equal(answers, 6, "every answer arrived");
  assert.deepEqual(fired, [], "a child still answering was never called idle");
  assert.equal(sup.killedBy(), null);
  assert.equal(code, 0);
});

test("a child under both clocks is killed by one of them and never by both", async () => {
  // The Ruby bridge is the caller that arms both, and nothing armed the pair
  // together: the clock that did not fire has to be dropped by the one that
  // did, or the caller hears a second reason for a child that is already gone.
  const path = child("both", "process.send({ answered: true })\nsetTimeout(() => {}, 60_000)\n");
  const fired = [];
  const sup = guardedChild({
    kind: "fork",
    modulePath: path,
    stdio: STDIO,
    stderrBytes: 2048,
    idleMs: 120,
    wallMs: 240,
    onTimeout: (reason) => fired.push(reason),
  });
  sup.child.on("message", () => sup.touch());

  await closed(sup.child);
  // Past the wall clock, with the child already dead: the surviving timer is
  // only visible after the window it would have fired in.
  await new Promise((resolve) => setTimeout(resolve, 250));
  sup.settle();

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
