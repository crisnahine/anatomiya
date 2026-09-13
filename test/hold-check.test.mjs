import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import * as check from "../plugins/ultracode-anywhere/hooks/hold-check.mjs";
import { syncCopies } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { checksDir, holdStatePath } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import { SHIM_MARKER } from "../plugins/ultracode-anywhere/hooks/hold-shim.mjs";
import { hostEnv } from "./host-env.mjs";
import { agentText, world, write } from "./hold-fixtures.mjs";
import { needsShebang } from "./platform.mjs";

const FAKE = fileURLToPath(new URL("./hold-fake-claude.mjs", import.meta.url));
const TARGET = { level: "medium", model: "claude-opus-5[1m]", family: "claude-opus-5", context1m: true };

const row = (over) => ({ subagent: false, isMain: false, conversation: "", model: "claude-opus-5", effort: "medium", context1m: true, results: [], ...over });
const main = (over) => row({ isMain: true, effort: "xhigh", ...over });
const spawn = (over) => row({ subagent: true, ...over });
const refusal = (text) => ({ is_error: true, content: text });
const judge = (probes, target = TARGET) => check.evaluate(probes, { expectedMain: "xhigh", target });

async function gone(pid) {
  for (let at = 0; at < 40; at++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(50);
  }
  return false;
}

// --- the probe's surroundings ------------------------------------------------------

test("a probe runs like a session started from a terminal: no parent session, no forced level, no shim", (t) => {
  const { root } = world(t);
  const shimDir = join(root, "shim");
  chmodSync(write(join(shimDir, "claude"), `#!/usr/bin/env node\n// ${SHIM_MARKER}\n`), 0o755);

  const env = check.probeEnv(
    { PATH: [shimDir, "/usr/bin"].join(delimiter), CLAUDE_CODE_EFFORT_LEVEL: "medium", CLAUDECODE: "1", ANTHROPIC_MODEL: "x", ULTRACODE_ANYWHERE_HELD_CHILD: "1", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: "/x", CLAUDE_ENV_FILE: "/y", CSD_CLAUDE_BIN: "/z", HOME: root, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" },
    { ANTHROPIC_API_KEY: "k" },
  );
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: root, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium", ANTHROPIC_API_KEY: "k" });
});

test("the claude a probe runs is the running build, never the node or bun an install runs under, else the one on PATH", (t) => {
  const { root } = world(t);
  const real = join(root, "real");
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  chmodSync(write(join(real, name), "#!/bin/sh\n"), 0o755);
  const build = write(join(root, "versions", "2.1.999"), "binary");
  chmodSync(build, 0o755);

  assert.equal(check.realClaude({ CLAUDE_CODE_EXECPATH: build, PATH: "" }), build);
  assert.equal(check.realClaude({ CLAUDE_CODE_EXECPATH: process.execPath, PATH: real }), join(real, name));
  assert.equal(check.realClaude({ CLAUDE_CODE_EXECPATH: join(root, "missing"), PATH: "" }), "claude");
});

test("the build a probe runs is read off its own --version", async (t) => {
  assert.equal(check.claudeVersion(process.execPath, hostEnv(), [FAKE]), "2.1.999");
  assert.equal(check.claudeVersion(join(world(t).root, "missing"), hostEnv()), "");
});

// --- running a probe ----------------------------------------------------------------

test("a probe asks the build to send nothing but the requests the stand-in answers", async (t) => {
  const { root, env: held } = world(t);
  const script = write(join(root, "print-env.mjs"), 'process.stdout.write(String(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC));');

  assert.equal((await check.runProbe({ plan: {}, base: { ...hostEnv(), ...held }, binary: process.execPath, binaryArgs: [script], env: {}, timeoutMs: 20000 })).output, "1");
});

test("the node probe leaves the preload as the only thing that can set the child's level and model", () => {
  const probe = check.probeList({ project: "/p", pluginAgent: null, binary: "claude", level: "medium", preload: true }).find((p) => p.name === "claude started by a node process");

  assert.match(probe.plan.main.input.command, /env -u CLAUDE_CODE_EFFORT_LEVEL -u ANTHROPIC_MODEL node/);
});

test("a probe whose binary cannot start comes back empty instead of throwing", async (t) => {
  const { env } = world(t);
  assert.deepEqual(await check.runProbe({ plan: {}, base: { ...hostEnv(), ...env }, binary: "/nonexistent/claude", timeoutMs: 5000, env: {} }), { seen: [], output: "" });
});

test("a probe talks to its stand-in: the main loop is answered with the plan's tool call and a spawn with text", async (t) => {
  const { root, env: held } = world(t);
  const project = join(root, "work");
  mkdirSync(project, { recursive: true });

  const { seen, output } = await check.runProbe({ plan: { main: check.agentPlan("general-purpose") }, base: { ...hostEnv(), ...held }, binary: process.execPath, binaryArgs: [FAKE], cwd: project, env: {}, timeoutMs: 20000 });
  assert.match(output, /saw a tool call/);
  assert.deepEqual(seen.map((r) => [r.isMain, r.subagent, r.effort, r.context1m]), [[true, false, "xhigh", true], [false, true, "medium", true], [true, false, "xhigh", true]]);
  assert.equal(seen[2].results.length, 1);
});

test("a probe that ignores its timeout is killed with everything it started", needsShebang, async (t) => {
  const { root, env: held } = world(t);
  const pids = join(root, "pids");
  const bin = write(join(root, "stubborn"), `#!/bin/sh\nsleep 30 &\necho $! > '${pids}'\ntrap '' TERM\nsleep 20\n`);
  chmodSync(bin, 0o755);

  const started = Date.now();
  await check.runProbe({ plan: {}, base: { ...hostEnv(), ...held }, binary: bin, timeoutMs: 2000, env: {} });
  assert.ok(Date.now() - started < 12000);
  assert.ok(existsSync(pids), "the probe script never ran before its timeout");
  assert.ok(await gone(Number(readFileSync(pids, "utf8"))), "the grandchild holding its output open is gone too");
});

test("a probe leaves no process running once its session exits, and no session folder", needsShebang, async (t) => {
  const { root, cfg, env } = world(t);
  const pids = join(root, "pids");
  const bin = write(join(root, "leaves-one"), `#!/bin/sh\nsleep 30 > /dev/null 2>&1 &\necho $! > '${pids}'\nmkdir -p "$CLAUDE_CONFIG_DIR/projects/$(pwd -P | sed 's/[^a-zA-Z0-9]/-/g')"\n`);
  chmodSync(bin, 0o755);

  await check.runProbe({ plan: {}, base: { ...hostEnv(), ...env }, binary: bin, timeoutMs: 10000 });
  assert.ok(await gone(Number(readFileSync(pids, "utf8"))));
  assert.deepEqual(readdirSync(join(cfg, "projects")), []);
});

test("a probe run in its caller's directory leaves that directory's session folder to the caller, since other probes share it", needsShebang, async (t) => {
  const { root, cfg } = world(t);
  const bin = write(join(root, "makes-one"), `#!/bin/sh\nmkdir -p "$CLAUDE_CONFIG_DIR/projects/$(pwd -P | sed 's/[^a-zA-Z0-9]/-/g')"\n`);
  chmodSync(bin, 0o755);
  const cwd = join(mkdtempSync(join(root, "ultracode-hold-check-")), "project");
  mkdirSync(cwd);

  await check.runProbe({ plan: {}, base: hostEnv(), binary: bin, cwd, timeoutMs: 10000, env: { CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(readdirSync(join(cfg, "projects")).length, 1);
});

// --- what the stand-in saw ----------------------------------------------------------

test("a request is a spawn when Claude Code marks it as a subagent, whatever its prompt says", () => {
  const body = (subagent, text) => ({ system: [{ type: "text", text: `x-anthropic-billing-header: cc_version=2.1.270;${subagent ? " cc_is_subagent=true;" : ""}` }], messages: [{ role: "user", content: text }], tools: [{}] });

  assert.equal(check.classify(body(true, `${check.MARKER} inherited`)).subagent, true);
  assert.equal(check.classify(body(false, `${check.MARKER} ping`)).isMain, true);
  assert.equal(check.classify(body(false, `${check.CHILD_MARKER} ping`)).isMain, false);
  assert.equal(check.classify(body(true, "x"), { "anthropic-beta": "a, context-1m-2025-08-07" }).context1m, true);
  assert.equal(check.classify({}).tools, 0);
});

test("a spawn off the level or on another model is a leak, and a probe that never ran is infra", () => {
  const { leaks, infra } = judge([
    { name: "built-in agent", seen: [main({}), spawn({ effort: "xhigh" })] },
    { name: "workflow stage", seen: [main({}), spawn({ model: "claude-sonnet-5" })] },
    { name: "nested workflow", seen: [] },
  ]);

  assert.deepEqual(leaks, ["built-in agent: a spawn ran at claude-opus-5/xhigh", "workflow stage: a spawn ran at claude-sonnet-5/medium"]);
  assert.deepEqual(infra, ["nested workflow: the probe session never reached the stand-in"]);
});

test("a spawn sent without the 1M beta is a leak only where the held model asks for 1M", () => {
  const probe = [{ name: "built-in agent", seen: [main({}), spawn({ context1m: false })] }];

  assert.match(judge(probe).leaks.join(), /1M/);
  assert.deepEqual(judge(probe, { ...TARGET, model: "claude-opus-5", context1m: false }).leaks, []);
});

test("the main loop lowered to the level is a leak, unless the probe picked the main loop's own model and level", () => {
  assert.match(judge([{ name: "built-in agent", seen: [main({ effort: "medium" }), spawn({})] }]).leaks.join(), /main loop/);
  assert.deepEqual(judge([{ name: "inherit", ownMain: true, seen: [main({ effort: "medium", model: "claude-sonnet-5" }), spawn({})] }]).leaks, []);
});

test("a probe that expects a refusal passes only on the hook's own words, and fails when it spawned", () => {
  const probe = (seen) => ({ name: "fork", expect: { refused: "cannot be held to" }, seen });

  assert.deepEqual(judge([probe([main({ results: [refusal("A fork ... cannot be held to medium.")] })])]).leaks, []);
  assert.match(judge([probe([main({ results: [refusal("No agent definition named fork was found")] })])]).leaks.join(), /fork: the hook did not refuse it/);
  assert.match(judge([probe([main({ results: [refusal([{ type: "text", text: "cannot be held to" }])] }), spawn({})])]).leaks.join(), /fork: it spawned/);
});

test("a typed command the hook must block passes on its words in the output, and leaks if it spawned", () => {
  const probe = (seen, output) => ({ name: "slash command", expect: { blocked: "must run at" }, seen, output });

  assert.deepEqual(judge([probe([], "Prompt blocked: every spawn must run at medium.")]), { leaks: [], infra: [] });
  assert.match(judge([probe([spawn({ effort: "xhigh" })], "")]).leaks.join(), /slash command: the typed command was not blocked/);
  assert.match(judge([probe([], "")]).infra.join(), /slash command: the typed command was neither blocked nor run/);
});

test("the tripwire probe passes only when its subagent off the level was refused a tool call", () => {
  const probe = (results, seen = null) => ({ name: "tripwire", expect: { tripwire: "running at xhigh effort" }, seen: seen ?? [main({}), spawn({ effort: "xhigh", results })] });

  assert.deepEqual(judge([probe([refusal("This subagent is running at xhigh effort, and ...")])]), { leaks: [], infra: [] });
  assert.match(judge([probe([])]).leaks.join(), /tripwire: a subagent off the level was not stopped/);
  assert.match(judge([probe([], [main({})])]).infra.join(), /tripwire: no spawn reached the stand-in/);
});

test("a shell-started child must reach the stand-in itself", () => {
  const probe = (conversation) => ({ name: "shell", expect: { child: check.CHILD_MARKER }, seen: [main({}), spawn({ subagent: false, conversation })] });

  assert.deepEqual(judge([probe(`${check.CHILD_MARKER} ping`)]), { leaks: [], infra: [] });
  assert.match(judge([probe("something else")]).infra.join(), /child session never reached/);
});

test("a probe whose spawn makes a tool call must show the tripwire reading that spawn's level and model", () => {
  const probe = (lines) => ({ name: "workflow stage", callsTools: true, seen: [main({}), spawn({})], lines });

  assert.deepEqual(judge([probe(["main xhigh none", "child medium claude-opus-5"])]), { leaks: [], infra: [] });
  assert.match(judge([probe(["main xhigh none"])]).infra.join(), /workflow stage: the tripwire saw no subagent tool call/);
  assert.match(judge([probe(["child medium none"])]).infra.join(), /workflow stage: the tripwire could not read the subagent's model/);
  assert.match(judge([probe(["child medium claude-opus-5", "child xhigh none"])]).leaks.join(), /workflow stage: the tripwire saw child xhigh none/);
  assert.match(judge([probe(["child medium claude-sonnet-5"])]).leaks.join(), /claude-sonnet-5/);
  assert.deepEqual(judge([{ name: "skipped", skip: "no plugin agent", seen: [] }]), { leaks: [], infra: [] });
});

// --- carrying a leak ----------------------------------------------------------------

test("a leak stays for a probe that could not run cleanly, and goes once it runs clean or no longer exists", () => {
  const leak = { version: "1.0.0", ok: false, leaks: ["plugin agent: a spawn ran at claude-opus-5/xhigh"], infra: [] };
  const clean = { version: "1.0.0", ok: false, leaks: [], infra: ["built-in agent: no spawn reached the stand-in"], details: {} };

  assert.deepEqual(check.carryLeaks(leak, clean).leaks, [], "the leaking probe came back clean");
  const unsure = { ...clean, infra: ["plugin agent: the probe session never reached the stand-in"] };
  assert.deepEqual(check.carryLeaks(leak, unsure).leaks, leak.leaks);
  assert.equal(check.carryLeaks(leak, unsure).ok, false);
  assert.deepEqual(check.carryLeaks(leak, { ...unsure, version: "1.0.1" }).leaks, [], "another build starts over");
  assert.deepEqual(check.carryLeaks(null, unsure), unsure);
  const again = { ...unsure, leaks: ["plugin agent: a spawn ran at claude-opus-5/xhigh"] };
  assert.deepEqual(check.carryLeaks(leak, again).leaks, leak.leaks, "a leak found again is not listed twice");
});

// --- the probes -----------------------------------------------------------------------

test("every probe keeps one name across runs, and a probe that cannot run here is listed as skipped", () => {
  const list = (over) => check.probeList({ project: "/p", pluginAgent: "kit:x", binary: "claude", level: "medium", preload: true, ...over });
  const names = list().map((p) => p.name);

  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 17);
  assert.deepEqual(list({ pluginAgent: null, preload: false }).map((p) => p.name), names);
  assert.equal(list().find((p) => p.name === "plugin agent").plan.main.input.subagent_type, "kit:x");
  assert.match(list({ pluginAgent: null }).find((p) => p.name === "plugin agent").skip, /no enabled plugin agent/);
  assert.match(list({ preload: false }).find((p) => p.name === "claude started by a node process").skip, /NODE_OPTIONS/);
  assert.match(list().find((p) => p.name === "project agent off the level").expect.refused, /in its file/, "a project's agent is refused, never copied");
  assert.match(JSON.stringify(list({ level: "xhigh" })), /"high"/, "at xhigh the probes ask for another level than the held one");
  assert.doesNotMatch(JSON.stringify(list({ level: "medium" })), /\bmedium\b/);
  assert.match(JSON.stringify(list({ family: "claude-sonnet-5" })), /"opus"/, "a session on the held family proves nothing about inheriting another");
});

test("what each probe saw is kept by name, a skipped one and the agent it used included", () => {
  const details = check.detailsOf([
    { name: "plugin agent", agent: "kit:x", seen: [main({}), spawn({})], lines: ["child medium claude-opus-5"] },
    { name: "claude started by a node process", skip: "no preload", seen: [], lines: [] },
  ]);

  assert.deepEqual(details, {
    "plugin agent": { agent: "kit:x", main: { "claude-opus-5/xhigh": 1 }, spawns: { "claude-opus-5/medium": 1 }, tripwire: { "child medium claude-opus-5": 1 } },
    "claude started by a node process": { skipped: "no preload" },
  });
});

test("the plugin probe picks an enabled plugin agent off the level that has its copy, and nothing else", (t) => {
  const { cfg, root, plugin, env } = world(t);
  write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d", effort: "high" }));
  assert.equal(check.pluginAgentForProbe(env, "medium"), null, "no copy yet");

  syncCopies({ env, level: "medium" });
  assert.equal(check.pluginAgentForProbe(env, "medium"), "kit:verifier");
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": false } }));
  assert.equal(check.pluginAgentForProbe(env, "medium"), null);
});

// --- a whole run ---------------------------------------------------------------------

test("a run records every probe, the settings the hold cannot do without, and what it could not finish", async (t) => {
  const { env } = world(t);
  const gap = { ...hostEnv(), ...env, CLAUDE_CODE_FORK_SUBAGENT: "1" };

  const state = await check.verify({ env: gap, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.equal(state.version, "2.1.999");
  assert.equal(state.ok, false);
  assert.ok(state.leaks.some((leak) => /^settings: CLAUDE_CODE_FORK_SUBAGENT is not 0/.test(leak)));
  assert.equal(Object.keys(state.details).length, 17);
  assert.deepEqual(JSON.parse(readFileSync(holdStatePath(env, "verified.json"), "utf8")).version, "2.1.999");
});

test("a run with the hold off records nothing and says why", async (t) => {
  const { env } = world(t);

  const state = await check.verify({ env: { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE] });
  assert.match(state.error, /not on/);
  assert.equal(existsSync(holdStatePath(env, "verified.json")), false);
});

test("a spawn on a model that only shares the held family's prefix is a leak", () => {
  assert.match(judge([{ name: "built-in agent", seen: [main({}), spawn({ model: "claude-opus-5-1" })] }]).leaks.join(), /claude-opus-5-1\/medium/);
});

test("a probe without a project of its own runs in a directory the self-check made inside the hold's state", async (t) => {
  const { root, env } = world(t);
  const script = write(join(root, "print-cwd.mjs"), "process.stdout.write(process.cwd());");

  const { output } = await check.runProbe({ plan: {}, base: { ...hostEnv(), ...env }, binary: process.execPath, binaryArgs: [script], timeoutMs: 20000 });
  assert.equal(realpathSync(dirname(output)), realpathSync(checksDir(env)));
});

test("a run whose user settings send requests somewhere else starts no probe and says why", async (t) => {
  const { cfg, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true }, env: { ANTHROPIC_BASE_URL: "https://proxy.example" } }));
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "2.1.999", ok: false, leaks: ["fork: it spawned instead of being refused"], infra: [] }));

  const state = await check.verify({ env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.match(state.infra.join(), /ANTHROPIC_BASE_URL/);
  assert.deepEqual(state.details, {});
  assert.deepEqual(state.leaks, ["fork: it spawned instead of being refused"], "a run that proved nothing keeps the last leak");
});

test("a leak stays for a probe that was skipped, since a skipped probe proved nothing either", () => {
  const leak = { version: "1.0.0", ok: false, leaks: ["plugin agent: a spawn ran at claude-opus-5/xhigh"], infra: [] };
  const skipped = { version: "1.0.0", ok: true, leaks: [], infra: [], details: { "plugin agent": { skipped: "no copy yet" } } };

  assert.deepEqual(check.carryLeaks(leak, skipped).leaks, leak.leaks);
  assert.equal(check.carryLeaks(leak, skipped).ok, false);
});

test("a probe leaves out the variables that would send it to another provider", () => {
  assert.deepEqual(check.probeEnv({ PATH: "", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_USE_FOUNDRY: "1" }, {}), { PATH: "" });
});

test("a project folder is named the way the build names it, with a long directory cut at 200 characters and a hash of its path", () => {
  assert.equal(check.projectFolderName("/tmp/ultracode-hold-check-short"), "-tmp-ultracode-hold-check-short");
  assert.equal(
    check.projectFolderName(`/work/ultracode-hold-check-abc123/${"deep/".repeat(40)}`),
    "-work-ultracode-hold-check-abc123-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-deep-d-2419qp",
  );
});

test("a probe in a directory long enough for the build to cut its folder name leaves no session folder either", needsShebang, async (t) => {
  const { root, cfg, env } = world(t);
  const made = join(root, "made");
  // The build's own naming, copied off 2.1.270, so the folder is the one a real session leaves.
  const script = `const fs=require("fs"),path=require("path");const p=fs.realpathSync(process.cwd());let h=0;for(let i=0;i<p.length;i++)h=(h<<5)-h+p.charCodeAt(i)|0;const n=p.replace(/[^a-zA-Z0-9]/g,"-");const name=n.length<=200?n:n.slice(0,200)+"-"+Math.abs(h).toString(36);fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR,"projects",name),{recursive:true});fs.writeFileSync(${JSON.stringify(made)},name)`;
  const bin = write(join(root, "long-one"), `#!/bin/sh\nexec "${process.execPath}" -e '${script}'\n`);
  chmodSync(bin, 0o755);
  const state = join(root, ...Array(12).fill("a-long-directory"));
  mkdirSync(state, { recursive: true, mode: 0o700 });

  await check.runProbe({ plan: {}, base: { ...hostEnv(), ...env, ULTRACODE_ANYWHERE_STATE: state }, binary: bin, timeoutMs: 20000 });
  assert.ok(readFileSync(made, "utf8").length > 200, "the build would have cut this name");
  assert.deepEqual(readdirSync(join(cfg, "projects")), []);
});

test("a probe that throws is that probe's failure, and a leak the last run recorded on this build stays", async (t) => {
  const { env } = world(t);
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "2.1.999", ok: false, leaks: ["fork: it spawned instead of being refused"], infra: [] }));

  const state = await check.verify({ env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: "bad\0claude", timeoutMs: 5000 });
  assert.ok(state.leaks.includes("fork: it spawned instead of being refused"));
  assert.match(state.infra.join("\n"), /^fork: the probe could not run/m);
});

test("a check directory a killed run left behind goes at the next run, with its session folders, and a fresh one stays", (t) => {
  const { cfg, env } = world(t);
  const left = join(checksDir(env), "ultracode-hold-check-left01");
  mkdirSync(join(left, "project"), { recursive: true });
  const folders = [left, join(left, "project")].map((dir) => join(cfg, "projects", check.projectFolderName(realpathSync(dir))));
  for (const folder of folders) mkdirSync(folder, { recursive: true });
  const old = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(left, old, old);
  const fresh = join(checksDir(env), "ultracode-hold-check-fresh1");
  mkdirSync(fresh);

  check.pruneChecks(env);
  assert.equal(existsSync(left), false);
  assert.deepEqual(folders.filter((folder) => existsSync(folder)), []);
  assert.equal(existsSync(fresh), true, "a directory a running check may still use stays");
});

test("settings a managed policy sets route requests too, so they start no probe either", (t) => {
  const { root, env } = world(t);
  const managed = join(root, "managed");
  write(join(managed, "managed-settings.d", "10-gateway.json"), JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://gateway.example" } }));

  assert.deepEqual(check.routedAway(env, managed), ["ANTHROPIC_BASE_URL"]);
  write(join(managed, "managed-settings.json"), JSON.stringify({ env: { CLAUDE_CODE_USE_BEDROCK: "1" } }));
  assert.deepEqual(check.routedAway(env, managed), ["ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK"]);
  assert.deepEqual(check.routedAway(env, join(root, "none")), []);
});
