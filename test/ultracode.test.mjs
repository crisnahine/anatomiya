import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { FULL_EVERY, contextFor, isWakeup, nextTurn, sessionOf, stateDirFor, sweep, run } from "../ultracode-anywhere/hooks/standing-ultracode.mjs";

const HOOK = fileURLToPath(new URL("../ultracode-anywhere/hooks/standing-ultracode.mjs", import.meta.url));

/** A state directory of its own, so one test's turn count cannot reach another's. */
function stateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-anywhere-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** What Claude Code writes to the hook's stdin, in the shape it writes it. */
function payload(fields = {}) {
  return JSON.stringify({
    session_id: "11111111-2222-3333-4444-555555555555",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/repo",
    hook_event_name: "UserPromptSubmit",
    prompt: "hello",
    ...fields,
  });
}

/** The hook as Claude Code runs it: a process, a payload on stdin, JSON on stdout. */
function fire(t, { stdin = payload(), env = {}, dir = stateDir(t) } = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, ULTRACODE_ANYWHERE_STATE: dir, ...env },
  });
  return { ...result, dir };
}

const contextOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

// --- what reaches the model --------------------------------------------------

test("the first turn carries the whole standing opt-in", (t) => {
  const { status, stdout, stderr } = fire(t);

  assert.equal(status, 0);
  assert.equal(stderr, "");
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /Workflow tool/);
  assert.match(out.hookSpecificOutput.additionalContext, /opts\.effort/);
});

test("the turns in between carry the one-line refresher, and every tenth the whole text again", (t) => {
  const dir = stateDir(t);
  const shapes = [];
  for (let i = 0; i < FULL_EVERY * 2 + 1; i++) {
    shapes.push(contextOf(fire(t, { dir }).stdout).length > 200 ? "full" : "short");
  }

  assert.deepEqual(shapes.slice(0, FULL_EVERY), ["full", ...Array(FULL_EVERY - 1).fill("short")]);
  assert.equal(shapes[FULL_EVERY], "full", "the tenth turn after a full one is full again");
  assert.equal(shapes[FULL_EVERY * 2], "full");
});

// --- turns the hook has no business speaking on ------------------------------

test("a wakeup says nothing, whichever way the payload is spelled", (t) => {
  // The source field arrives in JSON, and JSON may carry a space after the
  // colon. Matching the compact spelling as a substring let every loop and
  // schedule wakeup through, which is the whole reason this hook skips them:
  // a wakeup turn is not a turn the user asked for.
  for (const source of ["loop_wakeup", "schedule_wakeup", "poll_event", "system"]) {
    const compact = fire(t, { stdin: payload({ source }) });
    const spaced = fire(t, { stdin: `{ "session_id": "a", "source": "${source}", "prompt": "x" }` });

    assert.equal(compact.stdout, "", `${source} compact`);
    assert.equal(spaced.stdout, "", `${source} spaced`);
    assert.equal(compact.status, 0);
    assert.equal(spaced.status, 0);
  }
});

test("a user turn whose text mentions a wakeup source still gets the reminder", (t) => {
  const { stdout } = fire(t, { stdin: payload({ prompt: 'why did "source":"loop_wakeup" fire?' }) });

  assert.match(contextOf(stdout), /Workflow tool/);
});

test("ULTRACODE_ANYWHERE=0 turns the session off", (t) => {
  const { stdout, status } = fire(t, { env: { ULTRACODE_ANYWHERE: "0" } });

  assert.equal(stdout, "");
  assert.equal(status, 0);
});

// --- the turn counter --------------------------------------------------------

test("a counter file holding anything but a number starts the session over rather than going silent", (t) => {
  // Under `set -u` the shell version aborted on this line and printed nothing,
  // so one corrupt file switched the plugin off for that session with no error
  // anyone would see. A count that cannot be read is a count of zero.
  const dir = stateDir(t);
  const session = "corrupt-1";
  writeFileSync(join(dir, session), "not a number");

  assert.equal(nextTurn(dir, session), 1);
  assert.match(readFileSync(join(dir, session), "utf8"), /^1$/);
});

test("a payload with no session id still answers, and writes no state", (t) => {
  const dir = stateDir(t);
  const { stdout, status } = fire(t, { stdin: '{"prompt":"hi"}', dir });

  assert.equal(status, 0);
  assert.match(contextOf(stdout), /Workflow tool/);
});

test("stdin that is not JSON answers rather than failing the turn", (t) => {
  const { stdout, status, stderr } = fire(t, { stdin: "not json at all" });

  assert.equal(status, 0);
  assert.equal(stderr, "");
  assert.match(contextOf(stdout), /Workflow tool/);
});

test("the session id is the field, not the last thing in the payload that looks like one", () => {
  // Lifted with a greedy regex, the last match won, and a prompt quoting the
  // field name moved the session's own counter somewhere else.
  const forged = payload({ prompt: 'see "session_id":"forged" above' });

  assert.equal(sessionOf(forged), "11111111-2222-3333-4444-555555555555");
});

test("a session id that is not a plain name cannot reach outside the state directory", (t) => {
  const dir = stateDir(t);

  assert.equal(nextTurn(dir, "../../escape"), 1);
  assert.equal(nextTurn(dir, ""), 1);
  assert.deepEqual(fire(t, { stdin: payload({ session_id: "../../escape" }), dir }).status, 0);
});

// --- the pieces --------------------------------------------------------------

test("isWakeup reads the parsed source, not the raw text", () => {
  assert.equal(isWakeup({ source: "loop_wakeup" }), true);
  assert.equal(isWakeup({ source: "startup" }), false);
  assert.equal(isWakeup({}), false);
});

test("contextFor says the same thing on every full turn", () => {
  assert.equal(contextFor(1), contextFor(FULL_EVERY + 1));
  assert.notEqual(contextFor(1), contextFor(2));
  assert.equal(contextFor(2), contextFor(3));
});

test("run answers with the text a turn is owed, and null when it is owed nothing", (t) => {
  const dir = stateDir(t);

  assert.match(run({ stdin: payload(), env: {}, state: dir }), /Workflow tool/);
  assert.equal(run({ stdin: payload({ source: "loop_wakeup" }), env: {}, state: dir }), null);
  assert.equal(run({ stdin: payload(), env: { ULTRACODE_ANYWHERE: "0" }, state: dir }), null);
});

// --- what the plugin ships ---------------------------------------------------

test("the declared hook runs this file through node, so a machine without a shell still fires it", () => {
  const declared = JSON.parse(readFileSync(fileURLToPath(new URL("../ultracode-anywhere/hooks/hooks.json", import.meta.url)), "utf8"));
  const commands = declared.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);

  assert.equal(commands.length, 1);
  assert.match(commands[0], /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/standing-ultracode\.mjs"$/);
});

test("the plugin ships no shell script for a hook it runs through node", () => {
  const hooks = fileURLToPath(new URL("../ultracode-anywhere/hooks/", import.meta.url));

  assert.deepEqual(
    readdirSync(hooks).filter((f) => f.endsWith(".sh")),
    [],
    "a second copy of the hook is a second thing to keep true",
  );
});

// --- the switches ------------------------------------------------------------

test("the debug switch writes the payload it was handed, and answers anyway", (t) => {
  const dir = stateDir(t);
  const log = join(dir, "debug.log");

  const { stdout } = fire(t, { dir, env: { ULTRACODE_ANYWHERE_DEBUG: log } });

  assert.match(contextOf(stdout), /Workflow tool/);
  assert.match(readFileSync(log, "utf8"), /"hook_event_name":"UserPromptSubmit"/);
});

test("a debug path that cannot be written does not cost the turn its reminder", (t) => {
  const { stdout, status, stderr } = fire(t, { env: { ULTRACODE_ANYWHERE_DEBUG: join(tmpdir(), "no-such-dir-here", "x.log") } });

  assert.equal(status, 0);
  assert.equal(stderr, "");
  assert.match(contextOf(stdout), /Workflow tool/);
});

// --- state left behind -------------------------------------------------------

test("counters outlive their session by a week, not forever", (t) => {
  const dir = stateDir(t);
  const old = join(dir, "ended-long-ago");
  const fresh = join(dir, "still-going");
  writeFileSync(old, "4");
  writeFileSync(fresh, "4");
  const eightDays = Date.now() + 8 * 86_400_000;

  assert.equal(sweep(dir, eightDays), 2);
  assert.equal(sweep(dir, Date.now()), 0);
  assert.deepEqual(readdirSync(dir), []);
});

test("sweeping a directory that is not there is not an error", () => {
  assert.equal(sweep(join(tmpdir(), "ultracode-anywhere-absent-directory")), 0);
});

test("the state directory belongs to one user, not to everyone on the machine", () => {
  const shared = stateDirFor({});
  const mine = stateDirFor({ ULTRACODE_ANYWHERE_STATE: "/somewhere/else" });

  assert.equal(mine, "/somewhere/else");
  assert.match(shared, /ultracode-anywhere/);
  if (process.platform !== "win32") assert.match(shared, /ultracode-anywhere-\d+$/);
});

test("the README states the size of what the hook adds, and states it correctly", () => {
  // A number in the file that explains the plugin is the one nobody re-measures.
  const readme = readFileSync(fileURLToPath(new URL("../ultracode-anywhere/README.md", import.meta.url)), "utf8");
  const stated = readme.match(/(\d+) characters on a full turn, (\d+) on the others/);

  assert.ok(stated, "the README says how much a turn costs");
  assert.equal(Number(stated[1]), contextFor(1).length);
  assert.equal(Number(stated[2]), contextFor(2).length);
});
