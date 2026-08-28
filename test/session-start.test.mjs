import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { needsRemovableCwd } from "./platform.mjs";
import { CALIBRATED_AGAINST, MARKERS, MIN_BUNDLE } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";
import { notice } from "../plugins/ultracode-anywhere/hooks/session-start.mjs";
import { run } from "../plugins/ultracode-anywhere/hooks/standing-ultracode.mjs";
import { nextTurn } from "../plugins/ultracode-anywhere/hooks/counters.mjs";

/** What a build carries: the four names, and the gate the reminder is emitted under. */
const whole = () => `function Mae(e,t,r){return r===!0&&ZL()&&zZ(e,t)==="xhigh"}\n${MARKERS.join("\n")}`;

const HOOK = fileURLToPath(new URL("../plugins/ultracode-anywhere/hooks/session-start.mjs", import.meta.url));

function tree(t, { bundle = whole(), settings = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, "cli.js");
  writeFileSync(cli, bundle);
  truncateSync(cli, MIN_BUNDLE + 1);
  mkdirSync(join(dir, "config"), { recursive: true });
  if (settings) writeFileSync(join(dir, "config", "settings.json"), JSON.stringify(settings));
  return { dir, cli, config: join(dir, "config"), state: join(dir, "state") };
}

test("a session where everything lines up is told nothing", (t) => {
  const t1 = tree(t, { settings: { effortLevel: "medium" } });

  assert.equal(notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } }), null);
});

test("a build that dropped a marker is reported at the start of the session, once", (t) => {
  const t1 = tree(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });

  const said = notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } });

  assert.match(said, new RegExp(MARKERS[0]));
  assert.match(said, /ultracode-anywhere/);
  assert.match(said, /check the plugin|may no longer/i);
});

test("settings that make the plugin redundant are reported too, and named", (t) => {
  const t1 = tree(t, { settings: { ultracode: true } });

  assert.match(notice({ cwd: t1.dir, cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), /"ultracode": true/);
});

test("a machine with no build to read is not warned about", (t) => {
  const t1 = tree(t);

  assert.equal(notice({ cwd: t1.dir, cli: null, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } }), null);
});

test("the hook prints one SessionStart object and nothing when there is nothing to say", (t) => {
  const t1 = tree(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });
  const fire = (env) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", source: "startup", cwd: t1.dir }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: t1.config, CLAUDE_CODE_EXECPATH: env, ULTRACODE_ANYWHERE_STATE: t1.state, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" },
    });

  const drifted = fire(t1.cli);
  assert.equal(drifted.status, 0);
  assert.equal(drifted.stderr, "");
  const out = JSON.parse(drifted.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, new RegExp(MARKERS[0]));

  // Truncated back to a bundle's size, the way `tree` writes one. Left short,
  // the file stops being a candidate, the walk falls through to the machine's
  // real `claude`, and this read the installed build instead of the fixture:
  // silent only while that build sat inside the calibrated run of patches, and
  // a version notice the moment it did not.
  writeFileSync(t1.cli, whole());
  truncateSync(t1.cli, MIN_BUNDLE + 1);
  const clean = fire(t1.cli);
  assert.equal(clean.stdout, "");
  assert.equal(clean.status, 0);
});

test("the plugin declares the session hook it ships", () => {
  const declared = JSON.parse(readFileSync(fileURLToPath(new URL("../plugins/ultracode-anywhere/hooks/hooks.json", import.meta.url)), "utf8"));
  const commands = declared.hooks.SessionStart.flatMap((g) => g.hooks).map((h) => h.command);

  assert.deepEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"']);
});

// --- the build nobody checked this against ------------------------------------

test("a build whose minor differs from the calibrated one is named at the start of the session", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const versions = join(dir, ".local", "share", "claude", "versions");
  mkdirSync(versions, { recursive: true });
  const cli = join(versions, "99.9.9");
  writeFileSync(cli, whole());
  truncateSync(cli, MIN_BUNDLE + 1);
  mkdirSync(join(dir, "config"), { recursive: true });

  const said = notice({ cwd: dir, cli, state: join(dir, "state"), env: { CLAUDE_CONFIG_DIR: join(dir, "config"), ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } });

  assert.match(said, /99\.9\.9/);
  assert.equal(said.includes(CALIBRATED_AGAINST), true, "and the version it was checked against");
});

test("the subagent cap this mode does not lift is named once, with the setting that lifts it", (t) => {
  const t1 = tree(t, { settings: { effortLevel: "medium" } });

  const said = notice({ cwd: t1.dir, cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state });

  assert.match(said, /CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS/);
  assert.equal(notice({ cwd: t1.dir, cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), null, "and never again on this machine");
});

test("a cap already raised is not mentioned", (t) => {
  const t1 = tree(t, { settings: { env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "40" } } });

  assert.equal(notice({ cwd: t1.dir, cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), null);
});

test("the build is read once per build, not once per session", (t) => {
  // Reading a 325 MB binary is a few hundred milliseconds, and a session pays
  // it for nothing when the answer is the one the last session computed. A
  // second session that read the build again would write the answer again,
  // and the kept file's own timestamp says whether it did. The build's access
  // time said nothing: macOS and a `relatime` mount leave it alone on a
  // second read either way.
  const t1 = tree(t);
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };

  notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env });
  const kept = join(t1.state, ".drift");
  assert.equal(existsSync(kept), true, "the answer is kept beside the counters");
  const before = statSync(kept).mtimeMs;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env });

  assert.equal(statSync(kept).mtimeMs, before, "and the answer is not computed and written again");
});

test("a resumed session is not told again what its transcript already holds", (t) => {
  // The drift, version and conflict lines are said at the start of a session.
  // A resume brings the transcript back with them in it; a compaction or a
  // clear empties the context, so those say them again.
  const t1 = tree(t, { bundle: `${whole()}`.replace(MARKERS[0], ""), settings: { ultracode: true } });
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };
  const at = (source) => notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env, source, session: "s" });

  assert.match(at("startup"), /ultracode/);
  assert.equal(at("resume"), null);
  assert.match(at("compact"), /ultracode/, "a compaction emptied the context, so it is said again");
  assert.match(at("clear"), /ultracode/);
});

test("a build that changed under the same path is read again", (t) => {
  const t1 = tree(t);
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };
  assert.equal(notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env }), null);

  writeFileSync(t1.cli, MARKERS.slice(1).join("\n"));
  truncateSync(t1.cli, MIN_BUNDLE + 2);

  assert.match(notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env }), new RegExp(MARKERS[0]));
});

test("the switch that turns the plugin off for a session turns off both its hooks", (t) => {
  const t1 = tree(t, { bundle: `${whole()}`.replace(MARKERS[0], ""), settings: { ultracode: true } });

  assert.equal(notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE: "0" } }), null);
  assert.equal(existsSync(t1.state), false, "and it writes nothing on the way");
});

test("a session started from a directory that is no longer there still starts", needsRemovableCwd, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-session-gone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gone = join(dir, "gone");
  mkdirSync(gone, { recursive: true });

  const run = spawnSync("/bin/sh", ["-c", `cd "${gone}" && rm -rf "${gone}" && exec "${process.execPath}" "${HOOK}"`], {
    input: "",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, "config"), HOME: dir, ULTRACODE_ANYWHERE_STATE: join(dir, "state") },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
});

// --- the switches the build reads before enableWorkflows ----------------------

test("a session with workflows disabled is told which switch did it", (t) => {
  const t1 = tree(t, { settings: { disableWorkflows: true } });
  assert.match(notice({ cwd: t1.dir, cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), /"disableWorkflows": true/);

  const t2 = tree(t);
  assert.match(
    notice({ cwd: t2.dir, cli: t2.cli, env: { CLAUDE_CONFIG_DIR: t2.config, CLAUDE_CODE_DISABLE_WORKFLOWS: "1" }, state: t2.state }),
    /CLAUDE_CODE_DISABLE_WORKFLOWS/,
  );
});

// --- a compaction starts the cadence over -------------------------------------

test("a compaction starts the cadence over, since the text it opened with is gone from the context", (t) => {
  // The native reminder walks the messages back to its last attachment and
  // sends the whole text again once a compaction has taken it. A counter that
  // kept climbing left a compacted session with the refresher alone.
  const t1 = tree(t);
  const session = "11111111-2222-3333-4444-555555555555";
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };
  const turn = () => run({ stdin: JSON.stringify({ session_id: session, cwd: t1.dir, prompt: "hi" }), env, state: t1.state });

  assert.match(turn(), /Workflow tool/);
  assert.equal(turn(), null);
  notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env, source: "compact", session });
  assert.match(turn(), /Workflow tool/, "the first turn after a compaction opens with the whole text again");
  assert.equal(turn(), null);
});

test("a session resumed keeps its count, since its context kept the text", (t) => {
  const t1 = tree(t);
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };
  nextTurn(t1.state, "s");

  notice({ cwd: t1.dir, cli: t1.cli, state: t1.state, env, source: "resume", session: "s" });

  assert.equal(nextTurn(t1.state, "s"), 2);
});

test("the hook reads the compaction off its payload", (t) => {
  const t1 = tree(t);
  for (let i = 0; i < 7; i++) nextTurn(t1.state, "s");

  const fired = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", source: "compact", cwd: t1.dir }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: t1.config, CLAUDE_CODE_EXECPATH: t1.cli, ULTRACODE_ANYWHERE_STATE: t1.state, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" },
  });

  assert.equal(fired.status, 0, fired.stderr);
  assert.equal(nextTurn(t1.state, "s"), 1, "the next prompt is the first turn again");
});
