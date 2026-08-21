import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { MARKERS, MIN_BUNDLE } from "../ultracode-anywhere/hooks/upstream.mjs";

import { FULL_EVERY, contextFor, isWakeup, run } from "../ultracode-anywhere/hooks/standing-ultracode.mjs";

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

/** A config directory holding the settings Claude Code would read. */
function configWith(t, settings) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  return dir;
}

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

test("the whole text lands once, then a one-line refresher every tenth turn and silence between", (t) => {
  // The built-in says it once and keeps a short line every tenth turn after.
  // Repeating the full text on a cadence, or a refresher on every turn, is
  // louder than the thing being mirrored and is paid for on every prompt.
  const dir = stateDir(t);
  const shapes = [];
  for (let i = 0; i < FULL_EVERY * 2 + 1; i++) {
    const out = fire(t, { dir }).stdout;
    shapes.push(out === "" ? "-" : contextOf(out).length > 200 ? "F" : "s");
  }

  assert.equal(shapes.join(""), `F${"-".repeat(FULL_EVERY - 1)}s${"-".repeat(FULL_EVERY - 1)}s`);
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

test("a session id that is not a plain file name is refused by the turn a process actually takes", (t) => {
  const dir = stateDir(t);

  assert.equal(fire(t, { stdin: payload({ session_id: "../escape" }), dir }).status, 0);

  assert.deepEqual(readdirSync(dir), [], "a name that is not a file name is not made into one");
  assert.equal(existsSync(join(dir, "..", "escape")), false);
});

// --- the pieces --------------------------------------------------------------

test("isWakeup reads the parsed source, not the raw text", () => {
  assert.equal(isWakeup({ source: "loop_wakeup" }), true);
  assert.equal(isWakeup({ source: "startup" }), false);
  assert.equal(isWakeup({}), false);
});

test("contextFor opens with the whole text and answers nothing between refreshers", () => {
  assert.equal(contextFor(1).length > 200, true);
  assert.equal(contextFor(2), null);
  assert.equal(contextFor(FULL_EVERY + 1).length < 200, true, "the tenth turn after the first is the short line");
  assert.equal(contextFor(FULL_EVERY + 1), contextFor(FULL_EVERY * 2 + 1));
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

test("the README states the size of what the hook adds, and states it correctly", () => {
  // A number in the file that explains the plugin is the one nobody re-measures.
  const readme = readFileSync(fileURLToPath(new URL("../ultracode-anywhere/README.md", import.meta.url)), "utf8");
  const stated = readme.match(/(\d+) characters on the first turn, (\d+) on every tenth/);
  const session = readme.match(/Over a (\d+)-turn session that is (\d+) characters in total/);

  assert.ok(stated, "the README says how much a turn costs");
  assert.equal(Number(stated[1]), contextFor(1).length);
  assert.equal(Number(stated[2]), contextFor(FULL_EVERY + 1).length);

  assert.ok(session, "and how much a session costs, which is the number that decides anything");
  let total = 0;
  for (let turn = 1; turn <= Number(session[1]); turn++) total += (contextFor(turn) ?? "").length;
  assert.equal(Number(session[2]), total);
});

// --- the cadence the README describes ----------------------------------------

test("the full text comes back every tenth turn, the number the built-in uses", () => {
  assert.equal(FULL_EVERY, 10);
});

test("the turn a payload belongs to is the one its session field names", (t) => {
  // Read with a greedy match, the last thing in the payload that looked like a
  // session id won, and a prompt could write one. Driven through the process,
  // because the fix has to live on the path a turn actually takes.
  const dir = stateDir(t);
  const first = fire(t, { dir, stdin: payload({ session_id: "the-real-one" }) });

  const second = fire(t, { dir, stdin: payload({ session_id: "the-real-one", prompt: 'see "session_id":"forged"' }) });

  assert.match(contextOf(first.stdout), /Workflow tool/);
  assert.equal(second.stdout, "", "the second turn of one session is a quiet one");
  assert.deepEqual(readdirSync(dir), ["the-real-one"], "and the counter it moved is the session's own");
});

// --- what the reminder asks for ----------------------------------------------

test("the reminder names the work that should stay solo, not only the work that should orchestrate", () => {
  // "Use the Workflow tool on every substantive task" with no floor under it
  // buys a fan-out for a one-line edit. The floor is the expensive half to get
  // wrong, so it is stated on the full turn and on the refresher.
  assert.match(contextFor(1), /one file|single file|mechanical/i);
  assert.match(contextFor(1), /answer|read back/i);
  assert.match(contextFor(FULL_EVERY + 1), /worth it/i);
});

test("the reminder says what it does not restore, so the model does not read it as xhigh", () => {
  assert.match(contextFor(1), /effort level is unchanged|not raise|does not raise/i);
});

// --- the cadence a user can set ----------------------------------------------

test("how often the refresher comes back can be set, and a bad setting falls back to the default", (t) => {
  const dir = stateDir(t);
  const shapesFor = (env, session) => {
    const shapes = [];
    for (let i = 0; i < 6; i++) {
      const said = run({ stdin: payload({ session_id: session }), env, state: dir });
      shapes.push(said === null ? "-" : said.length > 200 ? "F" : "s");
    }
    return shapes.join("");
  };

  assert.equal(shapesFor({ ULTRACODE_ANYWHERE_EVERY: "3" }, "every-3"), "F--s--");
  assert.equal(shapesFor({ ULTRACODE_ANYWHERE_EVERY: "nonsense" }, "bad"), "F-----", "an unreadable setting is the default");
  assert.equal(shapesFor({ ULTRACODE_ANYWHERE_EVERY: "1" }, "loud"), "Fsssss", "a refresher every turn is a setting");
});

test("the refresher can be turned off, leaving the opening text and silence", (t) => {
  const dir = stateDir(t);
  const env = { ULTRACODE_ANYWHERE_EVERY: "3", ULTRACODE_ANYWHERE_REFRESHER: "0" };
  const shapes = [];
  for (let i = 0; i < 6; i++) shapes.push(run({ stdin: payload({ session_id: "quiet" }), env, state: dir }));

  assert.deepEqual(shapes.map((s) => (s === null ? "-" : "F")).join(""), "F-----");
});

test("the whole text can be brought back on the cadence, for a session that wants it repeated", (t) => {
  const dir = stateDir(t);
  const env = { ULTRACODE_ANYWHERE_EVERY: "3", ULTRACODE_ANYWHERE_FULL: "repeat" };
  const shapes = [];
  for (let i = 0; i < 7; i++) {
    const said = run({ stdin: payload({ session_id: "repeat" }), env, state: dir });
    shapes.push(said === null ? "-" : said.length > 200 ? "F" : "s");
  }

  assert.equal(shapes.join(""), "F--F--F");
});

// --- sessions where this hook has nothing to add ------------------------------

test("a session whose settings already force ultracode says nothing, rather than saying it twice", (t) => {
  // With `"ultracode": true` the effort resolver answers xhigh whatever
  // effortLevel says, and the built-in reminder fires on its own. A second copy
  // is tokens for nothing.
  const dir = stateDir(t);
  const config = configWith(t, { ultracode: true });

  assert.equal(run({ stdin: payload(), env: { CLAUDE_CONFIG_DIR: config }, state: dir }), null);
  assert.deepEqual(readdirSync(dir), [], "and it does not count a turn it did not speak on");
});

test("a session with the Workflow tool switched off says nothing, since there is no tool to point at", (t) => {
  const config = configWith(t, { enableWorkflows: false });

  assert.equal(run({ stdin: payload(), env: { CLAUDE_CONFIG_DIR: config }, state: stateDir(t) }), null);
});

test("a session that only sets an effort level is the ordinary case and still gets the reminder", (t) => {
  const config = configWith(t, { effortLevel: "medium", enableWorkflows: true });

  assert.match(run({ stdin: payload(), env: { CLAUDE_CONFIG_DIR: config }, state: stateDir(t) }), /Workflow tool/);
});

// --- the model still decides, so the reminder says how to decide --------------

test("the reminder asks for the reason before the fan-out, in the same breath as the tool", () => {
  assert.match(contextFor(1), /name what the fan-out buys/i);
});

test("strict mode goes quiet on a build that no longer carries what the plugin mirrors", (t) => {
  // Off by default: on a build that moved, a reminder nobody reads costs
  // tokens, and going silent costs the mode to anyone who wanted it on. Strict
  // is for whoever would rather have the mode off than have it pretend.
  const dir = stateDir(t);
  const cli = join(dir, "moved-build");
  writeFileSync(cli, "a build carrying none of the names this plugin mirrors");
  truncateSync(cli, MIN_BUNDLE + 1);
  const env = { CLAUDE_CODE_ENTRYPOINT_PATH: cli, CLAUDE_CONFIG_DIR: configWith(t, {}) };

  assert.match(run({ stdin: payload(), env, state: dir }), /Workflow tool/, "loud by default");
  assert.equal(run({ stdin: payload(), env: { ...env, ULTRACODE_ANYWHERE_STRICT: "1" }, state: dir }), null);
});

test("strict mode still speaks where the build is the one this was calibrated against", (t) => {
  const dir = stateDir(t);
  const cli = join(dir, "current-build");
  writeFileSync(cli, MARKERS.join("\n"));
  truncateSync(cli, MIN_BUNDLE + 1);

  const said = run({
    stdin: payload(),
    env: { CLAUDE_CODE_ENTRYPOINT_PATH: cli, CLAUDE_CONFIG_DIR: configWith(t, {}), ULTRACODE_ANYWHERE_STRICT: "1" },
    state: dir,
  });

  assert.match(said, /Workflow tool/);
});
