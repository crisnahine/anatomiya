import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { CALIBRATED_AGAINST, MARKERS, MIN_BUNDLE } from "../ultracode-anywhere/hooks/upstream.mjs";
import { notice } from "../ultracode-anywhere/hooks/session-start.mjs";

const HOOK = fileURLToPath(new URL("../ultracode-anywhere/hooks/session-start.mjs", import.meta.url));

function tree(t, { bundle = MARKERS.join("\n"), settings = null } = {}) {
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

  assert.equal(notice({ cli: t1.cli, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } }), null);
});

test("a build that dropped a marker is reported at the start of the session, once", (t) => {
  const t1 = tree(t, { bundle: MARKERS.slice(1).join("\n") });

  const said = notice({ cli: t1.cli, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } });

  assert.match(said, new RegExp(MARKERS[0]));
  assert.match(said, /ultracode-anywhere/);
  assert.match(said, /check the plugin|may no longer/i);
});

test("settings that make the plugin redundant are reported too, and named", (t) => {
  const t1 = tree(t, { settings: { ultracode: true } });

  assert.match(notice({ cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), /"ultracode": true/);
});

test("a machine with no build to read is not warned about", (t) => {
  const t1 = tree(t);

  assert.equal(notice({ cli: null, state: t1.state, env: { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } }), null);
});

test("the hook prints one SessionStart object and nothing when there is nothing to say", (t) => {
  const t1 = tree(t, { bundle: MARKERS.slice(1).join("\n") });
  const fire = (env) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", source: "startup", cwd: t1.dir }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: t1.config, CLAUDE_CODE_ENTRYPOINT_PATH: env, ULTRACODE_ANYWHERE_STATE: t1.state, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" },
    });

  const drifted = fire(t1.cli);
  assert.equal(drifted.status, 0);
  assert.equal(drifted.stderr, "");
  const out = JSON.parse(drifted.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, new RegExp(MARKERS[0]));

  writeFileSync(t1.cli, MARKERS.join("\n"));
  const clean = fire(t1.cli);
  assert.equal(clean.stdout, "");
  assert.equal(clean.status, 0);
});

test("the plugin declares the session hook it ships", () => {
  const declared = JSON.parse(readFileSync(fileURLToPath(new URL("../ultracode-anywhere/hooks/hooks.json", import.meta.url)), "utf8"));
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
  writeFileSync(cli, MARKERS.join("\n"));
  truncateSync(cli, MIN_BUNDLE + 1);
  mkdirSync(join(dir, "config"), { recursive: true });

  const said = notice({ cli, state: join(dir, "state"), env: { CLAUDE_CONFIG_DIR: join(dir, "config"), ULTRACODE_ANYWHERE_CAP_NOTICE: "0" } });

  assert.match(said, /99\.9\.9/);
  assert.match(said, new RegExp(CALIBRATED_AGAINST.replace(/\./g, "\\.")));
});

test("the subagent cap this mode does not lift is named once, with the setting that lifts it", (t) => {
  const t1 = tree(t, { settings: { effortLevel: "medium" } });

  const said = notice({ cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state });

  assert.match(said, /CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS/);
  assert.equal(notice({ cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), null, "and never again on this machine");
});

test("a cap already raised is not mentioned", (t) => {
  const t1 = tree(t, { settings: { env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "40" } } });

  assert.equal(notice({ cli: t1.cli, env: { CLAUDE_CONFIG_DIR: t1.config }, state: t1.state }), null);
});

test("the build is read once per build, not once per session", (t) => {
  // Reading a 321 MB binary is 180 ms, and a session pays it for nothing when
  // the answer is the one the last session already computed.
  const t1 = tree(t);
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };

  notice({ cli: t1.cli, state: t1.state, env });
  const before = statSync(t1.cli).atimeMs;
  notice({ cli: t1.cli, state: t1.state, env });

  assert.equal(existsSync(join(t1.state, ".drift")), true, "the answer is kept beside the counters");
  assert.equal(statSync(t1.cli).atimeMs, before, "and the build is not opened again");
});

test("a build that changed under the same path is read again", (t) => {
  const t1 = tree(t);
  const env = { CLAUDE_CONFIG_DIR: t1.config, ULTRACODE_ANYWHERE_CAP_NOTICE: "0" };
  assert.equal(notice({ cli: t1.cli, state: t1.state, env }), null);

  writeFileSync(t1.cli, MARKERS.slice(1).join("\n"));
  truncateSync(t1.cli, MIN_BUNDLE + 2);

  assert.match(notice({ cli: t1.cli, state: t1.state, env }), new RegExp(MARKERS[0]));
});
