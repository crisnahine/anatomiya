import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { copiesDir, syncCopies } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { holdStatePath, preloadPath } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import * as upkeep from "../plugins/ultracode-anywhere/hooks/hold-upkeep.mjs";
import { hostEnv } from "./host-env.mjs";
import { agentText, world, write } from "./hold-fixtures.mjs";
import { ownState, stateDirFor } from "../plugins/ultracode-anywhere/hooks/counters.mjs";
import { needsPosixPermissions, needsShebang } from "./platform.mjs";

const FAKE = fileURLToPath(new URL("./hold-fake-claude.mjs", import.meta.url));
const UPKEEP = fileURLToPath(new URL("../plugins/ultracode-anywhere/hooks/hold-upkeep.mjs", import.meta.url));

// --- the built-in listing ------------------------------------------------------------

test("the listing gives each built-in its description and tools", () => {
  const body = { messages: [{ content: [{ type: "text", text: "Available agent types for the Agent tool:\n- Plan: Plans work (with care). (Tools: All tools except Agent, Edit)\n- kit:checker: Checks. (Tools: Read)\n- statusline-setup: Status line. (Tools: Read, Edit)\n\nWhen you launch" }] }] };

  assert.deepEqual(upkeep.listingEntries(body), [
    { type: "Plan", description: "Plans work (with care).", tools: "All tools except Agent, Edit" },
    { type: "kit:checker", description: "Checks.", tools: "Read" },
    { type: "statusline-setup", description: "Status line.", tools: "Read, Edit" },
  ]);
  assert.deepEqual(upkeep.listingEntries({ messages: [] }), []);
  assert.deepEqual(upkeep.listingEntries(undefined), []);
});

test("capturing the built-ins writes a shadow of each at the level, from the prompt the build sent it", async (t) => {
  const held = world(t);
  const { cfg } = held;
  const env = { ...hostEnv(), ...held.env };

  const lines = await upkeep.syncShadows({ env, version: "2.1.999", stamp: "s", level: "medium", binary: process.execPath, binaryArgs: [FAKE] });
  assert.deepEqual(lines.sort(), ["Plan: written from 2.1.999", "general-purpose: written from 2.1.999"]);
  const plan = readFileSync(join(cfg, "agents", "Plan.md"), "utf8");
  assert.match(plan, /^effort: medium$/m);
  assert.match(plan, /The prompt of Plan\./);
  assert.doesNotMatch(plan, /Messages from the agent that launched you/);
  assert.deepEqual(JSON.parse(readFileSync(holdStatePath(env, "builtin-types.json"), "utf8")), ["general-purpose", "Plan"]);
  assert.equal(JSON.parse(readFileSync(holdStatePath(env, "shadows.json"), "utf8")).stamp, "s");
});

test("a capture whose listing cannot be read writes nothing, and a file of the user's own is kept", async (t) => {
  const { cfg, env } = world(t);
  write(join(cfg, "agents", "Plan.md"), "---\nname: Plan\ndescription: mine\n---\nMINE\n");

  const lines = await upkeep.syncShadows({ env, version: "2.1.999", stamp: "s", level: "medium", binary: process.execPath, binaryArgs: [FAKE] });
  assert.ok(lines.includes("Plan: kept, a file of the user's own is there"));
  assert.match(readFileSync(join(cfg, "agents", "Plan.md"), "utf8"), /MINE/);

  const nothing = await upkeep.syncShadows({ env, version: "2.1.999", stamp: "s", level: "medium", binary: join(cfg, "no-such-claude") });
  assert.deepEqual(nothing, ["shadows: the listing could not be read, so nothing was written"]);
});

// --- stamps, lock and schedule -------------------------------------------------------

test("the self-check runs again when a setting that decides a spawn changes, and an unrelated key leaves it alone", (t) => {
  const { cfg, env } = world(t);
  const settings = (value) => write(join(cfg, "settings.json"), JSON.stringify(value));
  const base = { enabledPlugins: { "kit@m": true }, hooks: {} };
  settings({ ...base, feedbackSurveyState: 1 });
  const before = upkeep.configStamp(env);

  settings({ ...base, feedbackSurveyState: 2 });
  assert.equal(upkeep.configStamp(env), before);
  for (const changed of [{ hooks: { PreToolUse: [] } }, { effortLevel: "high" }, { model: "sonnet" }, { modelSettings: { opus: {} } }, { disableAllHooks: true }, { env: { A: "1" } }]) {
    settings({ ...base, ...changed });
    assert.notEqual(upkeep.configStamp(env), before, JSON.stringify(changed));
  }
  settings({ ...base, feedbackSurveyState: 1 });
  assert.notEqual(upkeep.configStamp({ ...env, CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-5" }), before, "the environment the hold reads counts too");
  assert.notEqual(upkeep.configStamp(env), upkeep.pluginStamp(env));
});

test("the plugin stamp moves with an install, an enabled flag or a user skill, and not with a timestamp", (t) => {
  const { cfg, plugin, env } = world(t);
  const before = upkeep.pluginStamp(env);

  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "kit@m": [{ installPath: plugin, version: "1.0.0", lastUpdated: "later" }] } }));
  assert.equal(upkeep.pluginStamp(env), before);
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "kit@m": [{ installPath: plugin, version: "1.0.1" }] } }));
  assert.notEqual(upkeep.pluginStamp(env), before);
  const moved = upkeep.pluginStamp(env);
  write(join(cfg, "skills", "mine", "SKILL.md"), agentText({ name: "mine", description: "d" }));
  assert.notEqual(upkeep.pluginStamp(env), moved);
});

test("only one run holds the lock, a run never removes a lock it did not take, and a stale lock is taken over", (t) => {
  const { env } = world(t);
  const first = upkeep.acquireLock(env);

  assert.ok(first);
  assert.equal(upkeep.acquireLock(env), null);
  upkeep.releaseLock(env, "someone-else");
  assert.equal(upkeep.acquireLock(env), null, "the holder's lock survives another run's release");
  upkeep.releaseLock(env, first);
  assert.ok(upkeep.acquireLock(env));
  const old = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(holdStatePath(env, "lock"), old, old);
  assert.ok(upkeep.acquireLock(env), "an hour-old lock belongs to a run that died");
  assert.equal(upkeep.acquireLock({ HOME: "", USERPROFILE: "", CLAUDE_CONFIG_DIR: "" }), null, "no state directory, no lock");
});

test("the first write the hold makes creates its state directory for this account alone, so the lock can be taken there", needsPosixPermissions, (t) => {
  const { root, env } = world(t);
  const fresh = { ...env, ULTRACODE_ANYWHERE_STATE: join(root, "fresh-state") };

  upkeep.writePreload(fresh);
  assert.equal(ownState(stateDirFor(fresh)), true, "a state directory other accounts can read is one the counters and the lock refuse");
  assert.ok(upkeep.acquireLock(fresh));
});

test("a failed self-check is retried after a pause, and a passing one only when the build or the stamp moves", () => {
  const now = Date.parse("2026-09-13T12:00:00Z");
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

  assert.equal(upkeep.needsVerify(null, "1.0.0", "s", now), true);
  assert.equal(upkeep.needsVerify({ version: "1.0.0", stamp: "s", ok: true, at: at(600) }, "1.0.0", "s", now), false);
  assert.equal(upkeep.needsVerify({ version: "1.0.0", stamp: "s", ok: true, at: at(1) }, "1.0.1", "s", now), true);
  assert.equal(upkeep.needsVerify({ version: "1.0.0", stamp: "s", ok: true, at: at(1) }, "1.0.0", "t", now), true);
  assert.equal(upkeep.needsVerify({ version: "1.0.0", stamp: "s", ok: false, at: at(5) }, "1.0.0", "s", now), false);
  assert.equal(upkeep.needsVerify({ version: "1.0.0", stamp: "s", ok: false, at: at(45) }, "1.0.0", "s", now), true);
});

// --- the preload ----------------------------------------------------------------------

test("the preload sets the held level in a node process inside a session while the switch names one, and nothing otherwise", (t) => {
  const { cfg, env } = world(t);
  const preload = upkeep.writePreload(env);
  const levelIn = (extra) => spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.CLAUDE_CODE_EFFORT_LEVEL))"], { encoding: "utf8", env: { ...hostEnv(), NODE_OPTIONS: "", HOME: join(cfg, "no-home"), USERPROFILE: join(cfg, "no-home"), ...extra } }).stdout;

  assert.equal(preload, join(cfg, "ultracode-anywhere-preload.cjs"), "outside the state directory, which a reset of the turn counters may remove");
  assert.equal(preloadPath(env), preload);
  assert.equal(levelIn({ CLAUDECODE: "1", ULTRACODE_ANYWHERE_SPAWN_EFFORT: " Medium ", CLAUDE_CODE_EFFORT_LEVEL: "high" }), "medium");
  assert.equal(levelIn({ ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium", CLAUDE_CODE_EFFORT_LEVEL: "high" }), "high", "a claude started from a terminal is a main session, an npm install's included");
  assert.equal(levelIn({ CLAUDECODE: "1", CLAUDE_CODE_EFFORT_LEVEL: "high" }), "high");
  assert.equal(levelIn({ CLAUDECODE: "1", ULTRACODE_ANYWHERE_SPAWN_EFFORT: "cheap" }), "undefined");
  assert.doesNotMatch(readFileSync(preload, "utf8"), /require\(\s*["'](?!node:)/, "it needs nothing of the plugin, which can be uninstalled under it");
  const modelIn = (extra) => spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.ANTHROPIC_MODEL))"], { encoding: "utf8", env: { ...hostEnv(), NODE_OPTIONS: "", HOME: join(cfg, "no-home"), USERPROFILE: join(cfg, "no-home"), CLAUDECODE: "1", ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium", ANTHROPIC_MODEL: "claude-haiku-4-5", ...extra } }).stdout;
  assert.equal(modelIn({ CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-5[1m]" }), "claude-opus-5[1m]", "the model too, since a node program's claude reads it from the environment");
  assert.equal(modelIn({ CLAUDE_CODE_SUBAGENT_MODEL: "opus" }), "claude-haiku-4-5", "an alias names no model the hold can compare, so nothing is set");
  write(join(cfg, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));
  assert.equal(levelIn({ CLAUDECODE: "1", CLAUDE_CONFIG_DIR: cfg, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "high" }), "medium", "the user's own settings decide the level, the way the hooks read it");
  const written = statSync(preload).mtimeMs;
  assert.equal(upkeep.writePreload(env), preload);
  assert.equal(statSync(preload).mtimeMs, written, "an unchanged preload is not rewritten");
  assert.equal(upkeep.writePreload({ HOME: "", USERPROFILE: "", CLAUDE_CONFIG_DIR: "" }), null);
});

// --- turning the hold off --------------------------------------------------------------

test("once the user settings no longer turn the hold on, its shadows and copies go, and the preload stays", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  write(join(cfg, "agents", "Plan.md"), "---\nname: Plan\ndescription: d\neffort: medium\nultracode-anywhere-shadow-of: 2.1.999\n---\nx\n");
  syncCopies({ env, level: "medium" });
  write(join(cfg, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));

  assert.deepEqual(upkeep.cleanUp({ ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }), { copies: 0, shadows: 0 }, "the user settings still turn it on");
  write(join(cfg, "settings.json"), JSON.stringify({ env: {} }));
  assert.deepEqual(upkeep.cleanUp(env), { copies: 0, shadows: 0 }, "this session still has it on");
  assert.deepEqual(upkeep.cleanUp({ ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }), { copies: 1, shadows: 1 });
  assert.equal(existsSync(copiesDir(env)), false, "an empty copies folder goes too, so a later session has nothing left to clean");
  assert.equal(existsSync(join(cfg, "agents", "Plan.md")), false);
  assert.equal(existsSync(join(cfg, "agents", "slow.md")), true);
});

// --- the session-start run ---------------------------------------------------------------

test("a session-start run writes the preload, the shadows and the copies, checks the hold, and records it", async (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  await upkeep.refresh({ env, root, version: "2.1.999", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.equal(existsSync(preloadPath(env)), true);
  assert.equal(existsSync(join(cfg, "agents", "general-purpose.md")), true);
  assert.equal(readdirSync(copiesDir(env)).length, 1);
  const verified = JSON.parse(readFileSync(holdStatePath(env, "verified.json"), "utf8"));
  assert.equal(verified.version, "2.1.999");
  assert.equal(verified.stamp, upkeep.configStamp(env));

  const again = await upkeep.refresh({ env, root, version: "2.1.999", binary: join(root, "no-claude"), timeoutMs: 1000, now: Date.parse(verified.at) + 60000 });
  assert.equal(again.verified, false, "a record for this build and stamp is not due again so soon");
});

test("a session-start run with the hold off cleans up and checks nothing", async (t) => {
  const { cfg, env } = world(t);
  write(join(cfg, "agents", "Plan.md"), "---\nname: Plan\ndescription: d\neffort: medium\nultracode-anywhere-shadow-of: 2.1.999\n---\nx\n");

  const done = await upkeep.refresh({ env: { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }, root: cfg, version: "2.1.999", binary: "/nowhere" });
  assert.deepEqual(done, { off: true, cleaned: { copies: 0, shadows: 1 } });
  assert.equal(existsSync(holdStatePath(env, "verified.json")), false);
});

test("upkeep that fails is recorded for the notice, and a later success clears it", async (t) => {
  const { env, root } = world(t);
  upkeep.recordFailure(env, "2.1.999", new Error("installs.map is not a function"));

  assert.deepEqual(JSON.parse(readFileSync(holdStatePath(env, "upkeep.json"), "utf8")).error, "installs.map is not a function");
  await upkeep.refresh({ env, root, version: "2.1.999", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.equal(existsSync(holdStatePath(env, "upkeep.json")), false);
});

// --- the command line -------------------------------------------------------------------

test("a run that cannot tell which build is installed records nothing", (t) => {
  const { env } = world(t);
  const run = (args) => spawnSync(process.execPath, [UPKEEP, ...args], { encoding: "utf8", env: { ...hostEnv(), ...env, PATH: "" } });

  const asked = run(["--verify"]);
  assert.equal(asked.status, 1);
  assert.match(asked.stderr, /which Claude Code build/);
  assert.equal(run(["--session-start"]).status, 0);
  assert.equal(existsSync(holdStatePath(env, "verified.json")), false);
});

test("from a terminal the check runs against the claude on PATH and prints what it found", needsShebang, (t) => {
  const { root, env } = world(t);
  const bin = join(root, "bin");
  chmodSync(write(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`), 0o755);

  const run = spawnSync(process.execPath, [UPKEEP, "--verify", "--cwd", root], { encoding: "utf8", env: { ...hostEnv(), ...env, PATH: `${bin}:/usr/bin:/bin` }, timeout: 300000 });
  assert.match(run.stdout, /^copies: /m);
  assert.match(run.stdout, /self-check FAILED on 2\.1\.999:\n(  .*\n)*  fork: it spawned instead of being refused\n/, "the stand-in claude runs no hooks, so the fork probe is certain to leak");
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(readFileSync(holdStatePath(env, "verified.json"), "utf8")).version, "2.1.999");
});

test("from a terminal the check reads the settings the hold needs out of the user's settings, where a session would have them", needsShebang, (t) => {
  const { cfg, root, env } = world(t);
  const bin = join(root, "bin");
  chmodSync(write(join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`), 0o755);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "ultracode-anywhere@m": true }, env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium", CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-5[1m]", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1", CLAUDE_CODE_FORK_SUBAGENT: "0", CLAUDE_CODE_EFFORT_LEVEL: null } }));
  const terminal = { ...hostEnv(), HOME: env.HOME, USERPROFILE: env.USERPROFILE, CLAUDE_CONFIG_DIR: cfg, ULTRACODE_ANYWHERE_STATE: env.ULTRACODE_ANYWHERE_STATE, PATH: `${bin}:/usr/bin:/bin` };

  spawnSync(process.execPath, [UPKEEP, "--verify", "--cwd", root], { encoding: "utf8", env: terminal, timeout: 300000 });
  const leaks = JSON.parse(readFileSync(holdStatePath(env, "verified.json"), "utf8")).leaks;
  assert.ok(leaks.length > 0, "the stand-in claude still spawns where the hook would refuse");
  assert.deepEqual(leaks.filter((leak) => leak.startsWith("settings:")), []);
});

test("upkeep that fails is recorded as one plain line, since the notice carries it into the session", (t) => {
  const { env } = world(t);
  const escape = String.fromCharCode(27);
  upkeep.recordFailure(env, "2.1.999", new Error(`bad${escape}[31m name ${"x".repeat(400)}\nsecond line`));

  const error = JSON.parse(readFileSync(holdStatePath(env, "upkeep.json"), "utf8")).error;
  assert.equal(error.includes(escape), false);
  assert.equal(error.includes("second line"), false);
  assert.ok(error.length <= 200);
});

test("a project that names the switch leaves the hold off, so what the hold wrote goes even while the session carries the project's value", async (t) => {
  const { cfg, project, env } = world(t);
  write(join(cfg, "agents", "Plan.md"), "---\nname: Plan\ndescription: d\neffort: medium\nultracode-anywhere-shadow-of: 2.1.999\n---\nx\n");
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));

  const done = await upkeep.refresh({ env, root: project, version: "2.1.999", binary: "/nowhere" });
  assert.deepEqual(done, { off: true, cleaned: { copies: 0, shadows: 1 } });
});

test("the preload leaves a node process alone where only a project's settings name the switch, the way the hooks do", (t) => {
  const { cfg, project, env } = world(t);
  const preload = upkeep.writePreload(env);
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" } }));
  const levelIn = (extra) =>
    spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.CLAUDE_CODE_EFFORT_LEVEL))"], {
      encoding: "utf8",
      cwd: project,
      env: { ...hostEnv(), NODE_OPTIONS: "", HOME: join(cfg, "no-home"), USERPROFILE: join(cfg, "no-home"), CLAUDECODE: "1", ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low", ...extra },
    }).stdout;

  assert.equal(levelIn({ CLAUDE_PROJECT_DIR: project }), "undefined");
  assert.equal(levelIn({}), "undefined", "the directory it runs in stands for the project where the session names none");
  assert.equal(levelIn({ CLAUDE_PROJECT_DIR: cfg }), "low", "outside that project the session's value holds");
});

test("a terminal check while another run holds the lock says so and records nothing", (t) => {
  const { root, env } = world(t);
  assert.ok(upkeep.acquireLock(env));

  const run = spawnSync(process.execPath, [UPKEEP, "--verify", "--cwd", root], { encoding: "utf8", env: { ...hostEnv(), ...env, PATH: "", AI_AGENT: "claude-code_2-1-999_agent" }, timeout: 60000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Another upkeep run holds the lock/);
  assert.equal(existsSync(holdStatePath(env, "verified.json")), false);
});

test("a lock whose holder has exited is taken over at once, and one whose holder cannot be told is left alone", (t) => {
  const { env } = world(t);
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;

  write(holdStatePath(env, "lock"), `${exited}-0000`);
  assert.ok(upkeep.acquireLock(env), "a run that died leaves its lock to the next one");
  write(holdStatePath(env, "lock"), "not-a-pid");
  assert.equal(upkeep.acquireLock(env), null);
});

test("the preload reads a project's moved configuration directory past, to the account's own home, the way the hooks do", (t) => {
  const { cfg, project, env } = world(t);
  const preload = upkeep.writePreload(env);
  const theirs = join(project, "cfg");
  write(join(theirs, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" } }));
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_CONFIG_DIR: theirs } }));
  let account = "";
  try {
    account = String(JSON.parse(readFileSync(join(userInfo().homedir, ".claude", "settings.json"), "utf8")).env?.ULTRACODE_ANYWHERE_SPAWN_EFFORT ?? "");
  } catch {
    // An account with no settings of its own names no level.
  }
  if (account.trim().toLowerCase() === "low") return t.skip("this account's own settings hold spawns at low, so the case cannot tell the two apart");

  const run = spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.CLAUDE_CODE_EFFORT_LEVEL))"], {
    encoding: "utf8",
    cwd: project,
    env: { ...hostEnv(), NODE_OPTIONS: "", HOME: join(cfg, "no-home"), USERPROFILE: join(cfg, "no-home"), CLAUDECODE: "1", CLAUDE_CONFIG_DIR: theirs, CLAUDE_PROJECT_DIR: project, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" },
  });
  assert.notEqual(run.stdout, "low");
});

test("the preload keeps a level a user's own CLAUDE_CONFIG_DIR names where a project moves only the home", (t) => {
  const { root, project, env } = world(t);
  const preload = upkeep.writePreload(env);
  const own = join(root, "own-config");
  write(join(own, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "high" } }));
  const elsewhere = join(project, "elsewhere");
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { HOME: elsewhere } }));

  const run = spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.CLAUDE_CODE_EFFORT_LEVEL))"], {
    encoding: "utf8",
    cwd: project,
    env: { ...hostEnv(), NODE_OPTIONS: "", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: own, CLAUDE_PROJECT_DIR: project, HOME: elsewhere, USERPROFILE: elsewhere },
  });
  assert.equal(run.stdout, "high");
});

test("the preload finds the session's project through the exports, from any directory a node program runs in", (t) => {
  const { cfg, project, env } = world(t);
  const preload = upkeep.writePreload(env);
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" } }));
  const sub = join(project, "src");
  mkdirSync(sub, { recursive: true });

  const run = spawnSync(process.execPath, ["--require", preload, "-e", "process.stdout.write(String(process.env.CLAUDE_CODE_EFFORT_LEVEL))"], {
    encoding: "utf8",
    cwd: sub,
    env: { ...hostEnv(), NODE_OPTIONS: "", HOME: join(cfg, "no-home"), USERPROFILE: join(cfg, "no-home"), CLAUDECODE: "1", ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low", ULTRACODE_ANYWHERE_PROJECT_DIR: project },
  });
  assert.equal(run.stdout, "undefined");
});

test("a terminal check with --cwd reads that directory's project, whatever project a held shell names", (t) => {
  const { root, project, env } = world(t);
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));
  const other = join(root, "other");
  mkdirSync(other, { recursive: true });

  const run = spawnSync(process.execPath, [UPKEEP, "--verify", "--cwd", other], { encoding: "utf8", env: { ...hostEnv(), ...env, PATH: "", AI_AGENT: "claude-code_2-1-999_agent", ULTRACODE_ANYWHERE_PROJECT_DIR: project }, timeout: 120000 });
  assert.doesNotMatch(run.stdout, /The spawn hold is not on/, "the project the shell names is not the one asked about");
});
