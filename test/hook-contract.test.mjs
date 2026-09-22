import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ANATOMIYA } from "../scripts/plugins.mjs";
import { fieldsIn } from "../plugins/anatomiya/lib/hook.mjs";
import { hostEnv } from "./host-env.mjs";

/**
 * The wire contract every hook this plugin ships answers: the payload read, the
 * megabyte cap, the wall-clock bound and the one-object answer.
 *
 * Driven through the plugin's own `hooks/hooks.json`, so a command that is
 * renamed or added is covered without this file being edited.
 */
const PLUGINS = [
  { plugin: "anatomiya", root: ANATOMIYA },
];

/**
 * How long a hook has when it declares no timeout of its own.
 *
 * Ten minutes for a command hook, and thirty seconds where the event lowers it,
 * which `UserPromptSubmit` does and the other three events this plugin declares
 * do not (`docs/plugin-contract.md`, read off the binary). No hook here should
 * be anywhere near either. Every command the plugin declares carries a timeout
 * today, so this is what a new one would be held to until it declares its own.
 */
const UNDECLARED = 5;

/** Every command a plugin declares, with the loader's variable substituted. */
function commandsOf({ plugin, root }) {
  const declared = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
  const found = [];
  for (const [event, groups] of Object.entries(declared.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== "command") continue;
        found.push({
          plugin,
          event,
          // The bound the hook is held to here is the one it asks Claude Code
          // for, read off the same declaration the loader reads. A hook that
          // declares none is held to `UNDECLARED` instead, which is this
          // suite's number and not the harness's minute. Whether it declared
          // one is carried rather than inferred from the number: the fallback
          // and the number four of these hooks declare are both 5.
          declares: typeof hook.timeout === "number",
          // Two kinds of hook, and the difference is the point rather than an
          // accident. Most re-deliver on every turn, so they always have
          // something to say. `notice` answers for one write target and is
          // silent otherwise, because an unchanged block on every result is
          // what trained the reader to skip the clause that mattered (A44).
          // Listed rather than inferred, and speaking is the default: a fourth
          // verb that is silent fails this suite until it says so, where one
          // that speaks would have been exempted without anybody noticing.
          speaksAlways: !SOMETIMES_SILENT.has(hook.command.trim().split(/\s+/).pop()),
          timeout: typeof hook.timeout === "number" ? hook.timeout : UNDECLARED,
          command: hook.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root.replace(/[\\/]$/, "")),
        });
      }
    }
  }
  return found;
}

/**
 * The verbs that answer only when they have something to say: `notice` when the
 * counts do (A44), and `reuse` when a turn added source code nobody has checked
 * (A91).
 */
const SOMETIMES_SILENT = new Set(["notice", "reuse"]);

const DECLARED = PLUGINS.flatMap(commandsOf);

/**
 * A directory nothing else in this account reaches, so what a hook answers is
 * the tree written below and nothing the machine running this happens to hold.
 */
function elsewhere(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // With a map here, anatomiya's hooks answer a real object rather than the
  // empty one they answer for an unscanned directory, so the assertions below
  // are about an answer rather than about its absence.
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "rules", "anatomiya-overview.md"),
    "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- lib: 3 .mjs\n",
  );
  // The host's own Claude Code settings are taken out rather than listed: the
  // plugin names no variable today, and a hook that starts reading one would
  // otherwise be told what this machine happens to have set. The three that
  // name a place are pointed here.
  const env = hostEnv();
  for (const name of ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE"]) env[name] = dir;
  return { dir, env };
}

/** One hook run, with the test holding both pipes. */
function fire(t, { command, event, timeout }, { write = true, payload = null, dropReader = false } = {}) {
  const waitMs = timeout * 1000;
  const { dir, env } = elsewhere(t);
  const child = spawn(command, {
    cwd: dir,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});

  if (dropReader) child.stdout.destroy();
  if (write) child.stdin.end(payload ?? JSON.stringify({ hook_event_name: event, cwd: dir, session_id: "contract" }));

  let timer;
  return Promise.race([
    new Promise((r) => child.on("close", (code) => r({ code, stdout, stderr }))),
    new Promise((r) => { timer = setTimeout(() => r({ code: "hung", stdout, stderr }), waitMs); }),
  ]).then((result) => {
    // Cleared, or the timer keeps the runner alive for the whole bound after
    // the child has already answered, on every case in this file.
    clearTimeout(timer);
    if (result.code === "hung") child.kill("SIGKILL");
    child.stdin.destroy();
    return result;
  });
}

/** The one thing a hook may put on stdout: nothing, or a single JSON object. */
function answered({ code, stdout, stderr }, where) {
  assert.equal(code, 0, `${where} exited ${code}: ${stderr}`);
  assert.equal(stderr, "", `${where} wrote to stderr: ${stderr}`);
  if (stdout.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    assert.fail(`${where} wrote something that is not one JSON document: ${err.message}\n${stdout.slice(0, 200)}`);
  }
  assert.equal(typeof parsed, "object", `${where} answered ${typeof parsed}`);
  assert.notEqual(parsed, null, `${where} answered null`);
  return parsed;
}

test("the plugin declares at least one command, or this file proves nothing", () => {
  for (const { plugin } of PLUGINS) {
    assert.ok(DECLARED.some((declared) => declared.plugin === plugin), `${plugin} declares no command hook`);
  }
});

test("the fields these hooks read come before the bulk, which is what makes the cut survivable", () => {
  // The megabyte is read from the left, so recovering anything from a payload
  // larger than it rests on where the build puts each field.
  // `docs/research/what-a-hook-payload-carries.md` records the order 2.1.251
  // builds one in: the envelope first, then `hook_event_name`, `tool_name`,
  // `tool_input`, and only then `tool_response`. Every short field these hooks
  // read is in front of the cargo.
  //
  // Stated as a case rather than left in a comment because nothing else would
  // notice it changing. A build that moved `tool_response` ahead of `cwd` would
  // return both hooks to silence on every large write, with every other case
  // here still green, and the first sign would be a map that stopped arriving.
  const cargo = "y".repeat(2 * 1024 * 1024);
  const envelope = { session_id: "abc", cwd: "/repo", hook_event_name: "PostToolUse", tool_name: "Read" };
  const asBuilt = JSON.stringify({ ...envelope, tool_input: { file_path: "/repo/a.ts" }, tool_response: { content: cargo } });
  const bulkFirst = JSON.stringify({ tool_response: { content: cargo }, ...envelope, tool_input: { file_path: "/repo/a.ts" } });

  const read = (text) => fieldsIn(text.slice(0, 1024 * 1024));

  assert.equal(read(asBuilt).cwd, "/repo", "the order this build writes keeps every field in front of the cut");
  assert.equal(read(asBuilt).tool_input?.file_path, "/repo/a.ts");
  assert.equal(read(bulkFirst).cwd, undefined, "and an order that put the cargo first would put them past it");
});

test("every command asks Claude Code for a bound of its own", () => {
  // Without one the harness allows ten minutes for `PostToolUse`,
  // `PostToolUseFailure` and `SessionStart`, and thirty seconds for
  // `UserPromptSubmit`: ten minutes of a session held by a hook that has
  // nothing to say. `UNDECLARED` is what this file would hold such a hook to;
  // this is what keeps it unused.
  const silent = DECLARED.filter((d) => !d.declares).map((d) => `${d.plugin} ${d.event}`);

  assert.deepEqual(silent, [], "a hook declaring no timeout is one Claude Code will wait its event's default for");
});

for (const declared of DECLARED) {
  const where = `${declared.plugin} ${declared.event}`;

  test(`${where} answers an ordinary payload with one object and nothing else`, async (t) => {
    const parsed = answered(await fire(t, declared), where);

    assert.notEqual(parsed, null, `${where} answered with something that is not one object`);
    if (!declared.speaksAlways) {
      // The ordinary payload names no write target, and a hook that speaks only
      // about a target it was given has nothing to say about this one. An empty
      // object is the whole answer, and it is the right one.
      assert.deepEqual(parsed, {}, `${where} spoke about a payload that named no file`);
      return;
    }
    assert.equal(parsed.hookSpecificOutput.hookEventName, declared.event);
    assert.equal(typeof parsed.hookSpecificOutput.additionalContext, "string");
  });

  test(`${where} answers a payload that is not JSON rather than failing`, async (t) => {
    answered(await fire(t, declared, { payload: "{not json" }), where);
  });

  test(`${where} answers a payload far larger than a real one, and echoes none of it`, async (t) => {
    // The cap itself is measured in `test/hook.test.mjs`. What this holds is
    // that a hook neither fails on one nor hands the padding back.
    const pad = "x".repeat(3 * 1024 * 1024);
    const result = await fire(t, declared, { payload: `{"hook_event_name":"${declared.event}","pad":"${pad}"}` });

    answered(result, where);
    assert.doesNotMatch(result.stdout, /xxxxxxxxxx/, `${where} echoed the payload back`);
  });

  test(`${where} gives up on a pipe that stays open and empty, inside the timeout it declares`, async (t) => {
    // Nothing is written and the handle is never closed, which is a caller that
    // has opened the pipe and not decided what to say yet. Claude Code kills a
    // hook at the timeout the declaration asks for, so a hook still waiting at
    // that point has spent the whole of it and answered nothing.
    const result = await fire(t, declared, { write: false });

    assert.notEqual(result.code, "hung", `${where} was still holding an empty pipe after ${declared.timeout}s`);
    answered(result, where);
  });

  test(`${where} exits 0 when its reader goes away before it answers`, async (t) => {
    const result = await fire(t, declared, { dropReader: true });

    assert.equal(result.code, 0, `${where} exited ${result.code}: ${result.stderr}`);
    assert.equal(result.stderr, "", `${where} wrote to stderr: ${result.stderr}`);
  });
}
