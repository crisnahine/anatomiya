import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, utimesSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import * as check from "../plugins/ultracode-anywhere/hooks/hold-check.mjs";
import { syncCopies } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { checksDir, holdStatePath, verifiedRecord } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import { SHIM_MARKER } from "../plugins/ultracode-anywhere/hooks/hold-shim.mjs";
import { hostEnv } from "./host-env.mjs";
import { agentText, world, write } from "./hold-fixtures.mjs";
import { needsShebang, needsUnreadableDirs } from "./platform.mjs";

const FAKE = fileURLToPath(new URL("./hold-fake-claude.mjs", import.meta.url));
// A path under a file, where no directory can ever stand, so this machine's managed settings decide nothing in a run.
const NO_POLICY = join(FAKE, "no-managed-policy");
const TARGET = { level: "medium", model: "claude-opus-5[1m]", family: "claude-opus-5", context1m: true };

const row = (over) => ({ subagent: false, isMain: false, conversation: "", model: "claude-opus-5", effort: "medium", context1m: true, results: [], ...over });
const main = (over) => row({ isMain: true, effort: "xhigh", ...over });
const spawn = (over) => row({ subagent: true, ...over });
const refusal = (text) => ({ is_error: true, content: text });
/** A control run that ran the main loop on every model at `levels`. */
const everyModelAt = (levels) => ({ get: () => levels });
const judge = (probes, target = TARGET) => check.evaluate(probes, { controlLevels: everyModelAt(["xhigh"]), target });
const verdict = ({ leaks, infra }) => ({ leaks, infra });

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

test("a probe allows the tools it calls, so settings that force the default permission mode still let it run them", async (t) => {
  const { root, env: held } = world(t);
  const script = write(join(root, "print-args.mjs"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));");

  const args = JSON.parse((await check.runProbe({ plan: {}, base: { ...hostEnv(), ...held }, binary: process.execPath, binaryArgs: [script], env: {}, timeoutMs: 20000 })).output);
  const allowed = String(args[args.indexOf("--allowedTools") + 1] ?? "").split(",");
  for (const tool of ["Agent", "Bash", "Skill", "Workflow"]) assert.ok(allowed.includes(tool), `${tool} is not allowed in ${JSON.stringify(args)}`);
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

test("what a probe saw survives a cleanup that fails, so a spawn off the level is still a leak", needsUnreadableDirs, async (t) => {
  const { root, env } = world(t);
  const script = write(
    join(root, "spawns-and-locks.mjs"),
    `import { chmodSync, mkdirSync } from "node:fs";
const prompt = process.argv[process.argv.indexOf("-p") + 1];
const post = (system) => fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-opus-5", system, messages: [{ role: "user", content: prompt }], tools: [{ name: "Bash" }], output_config: { effort: "xhigh" } }) }).then((res) => res.text());
await post("x");
await post("cc_is_subagent=true;");
mkdirSync("locked/inner", { recursive: true });
chmodSync("locked", 0o500);
`,
  );
  const unlock = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "locked") chmodSync(join(dir, entry.name), 0o700);
      else unlock(join(dir, entry.name));
    }
  };
  const run = { base: { ...hostEnv(), ...env }, binary: process.execPath, binaryArgs: [script], timeoutMs: 20000 };

  try {
    const { seen } = await check.runProbe({ ...run, plan: {} });
    assert.equal(seen.filter((row) => row.subagent).length, 1);
    const state = await check.verify({ managedDir: NO_POLICY, env: run.base, version: "2.1.999", stamp: "s", binary: run.binary, binaryArgs: run.binaryArgs, timeoutMs: run.timeoutMs });
    assert.ok(state.leaks.includes("built-in agent: a spawn ran at claude-opus-5/xhigh"));
  } finally {
    unlock(checksDir(env));
  }
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
  const unmeasured = check.evaluate([{ name: "built-in agent", seen: [main({ effort: "medium" }), main({ effort: "medium" }), spawn({})] }], { controlLevels: new Map(), target: TARGET });
  assert.deepEqual(unmeasured.leaks, [], "a main loop no control ran on that model is not judged");
  assert.ok(unmeasured.infra.includes("main loop: built-in agent ran on claude-opus-5, which the control run never ran, so it was not judged"), "the line names no probe first, since its spawns were judged");
  const twoModels = check.evaluate([{ name: "built-in agent", seen: [main({ effort: "medium" }), main({ effort: "medium", model: "claude-sonnet-5" })] }], { controlLevels: new Map(), target: TARGET });
  assert.ok(twoModels.infra.includes("main loop: built-in agent ran on claude-opus-5 or claude-sonnet-5, which the control run never ran, so it was not judged"), "each model the control never ran is named once");
  const noControl = check.evaluate([{ name: "built-in agent", seen: [main({ effort: "medium" }), spawn({})] }], { controlLevels: null, target: TARGET });
  assert.deepEqual(verdict(noControl), { leaks: [], infra: [] }, "with no control measured, evaluate judges no main loop and adds no line of its own");
  const judgedOf = (seen, controlLevels = everyModelAt(["xhigh"]), extra = {}) => check.evaluate([{ name: "p", seen, ...extra }], { controlLevels, target: TARGET }).judgedMain;
  assert.deepEqual(judgedOf([main({ effort: "medium" })]), ["p"], "a main loop at the held level on a model the control measured is judged");
  assert.deepEqual(judgedOf([main({ effort: "xhigh" })], null), ["p"], "a main loop off the held level is judged with no control at all");
  assert.deepEqual(judgedOf([main({ effort: null })], null), [], "a main loop at no known level is not judged");
  const noEffort = check.evaluate([{ name: "p", seen: [main({ effort: null })] }], { controlLevels: everyModelAt(["xhigh"]), target: TARGET });
  assert.ok(noEffort.infra.includes("main loop: p sent no effort, so it was not judged"), "a main loop that went unjudged for want of an effort says so");
  assert.deepEqual(judgedOf([main({ effort: "medium" })], new Map()), [], "a main loop on a model the control never ran is not judged");
  assert.deepEqual(judgedOf([main({ effort: "medium" })], null), [], "a main loop at the held level with no control is not judged");
  assert.deepEqual(judgedOf([], undefined, { skip: "no copy" }), [], "a skipped probe is not judged");
  assert.deepEqual(judgedOf([], undefined, { failed: "it threw" }), [], "a probe that could not run is not judged");
  assert.deepEqual(judgedOf([spawn({ effort: "medium" })]), [], "a probe whose session never reached the stand-in is not judged");
  assert.deepEqual(judgedOf([main({ effort: null }), main({ effort: "xhigh" })], null), ["p"], "a known effort off the held level is judged beside a row with none");
  const opusOnly = new Map([["claude-opus-5", ["xhigh"]]]);
  assert.deepEqual(judgedOf([main({ effort: "xhigh", model: "claude-sonnet-5" })], opusOnly), ["p"], "a main loop off the held level is judged whichever model it ran on");
  const offOnOther = check.evaluate([{ name: "p", seen: [main({ effort: "xhigh", model: "claude-sonnet-5" })] }], { controlLevels: opusOnly, target: TARGET });
  assert.deepEqual(offOnOther.infra.filter((line) => line.startsWith("main loop:")), [], "only a main loop at the held level asks the control about its model");
});

test("a main loop the user's settings pin through CLAUDE_CODE_EFFORT_LEVEL is not lowered, since the control run is pinned the same way", async (t) => {
  const { root, cfg, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "ultracode-anywhere@m": true }, effortLevel: "xhigh", env: { CLAUDE_CODE_EFFORT_LEVEL: "medium" } }));
  // The build applies the settings' env before it picks the main loop's level, so this stand-in does too.
  const script = write(
    join(root, "pinned-main.mjs"),
    `import { readFileSync } from "node:fs";
const level = JSON.parse(readFileSync(process.env.CLAUDE_CONFIG_DIR + "/settings.json", "utf8")).env.CLAUDE_CODE_EFFORT_LEVEL;
const prompt = process.argv[process.argv.indexOf("-p") + 1];
await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-opus-5", system: "x", messages: [{ role: "user", content: prompt }], tools: [{ name: "Agent" }], output_config: { effort: level } }) }).then((res) => res.text());
`,
  );

  const state = await check.verify({ managedDir: NO_POLICY, env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [script], timeoutMs: 20000 });
  assert.deepEqual(state.leaks.filter((leak) => leak.includes("main loop")), []);
  assert.deepEqual(state.infra.filter((line) => line.startsWith("control:")), [], "the control ran, so the main loop was judged");
});

/** One self-check run where each probe's main loop sends `probe` and the control sends `control`: a level, "unset" for no effort, or "none" for no request, with a spawn at `spawnAt` when given. */
async function mainLoopRun(t, { settings = {}, level = "medium", probe = level, control = probe, controlModel = "claude-opus-5", controlSays = "", controlToolsSay = "", spawnAt = null, previous = null } = {}) {
  const { root, cfg, env } = world(t, { level });
  if (previous) write(holdStatePath(env, "verified.json"), JSON.stringify(previous));
  const log = join(root, "control.log");
  const script = write(
    join(root, "main.mjs"),
    `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1];
const isControl = args.some((arg) => arg.includes("enabledPlugins"));
if (isControl) appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, nodeOptions: process.env.NODE_OPTIONS ?? null }) + "\\n");
const effort = isControl ? ${JSON.stringify(control)} : ${JSON.stringify(probe)};
const model = isControl ? ${JSON.stringify(controlModel)} : "claude-opus-5";
const content = isControl ? prompt + ${JSON.stringify(controlSays)} : prompt;
const post = (body) => fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", body: JSON.stringify(body) }).then((res) => res.text());
if (effort !== "none") await post({ model, system: "x", messages: [{ role: "user", content }], tools: [{ name: "Agent", description: isControl ? ${JSON.stringify(controlToolsSay)} : "" }], ...(effort === "unset" ? {} : { output_config: { effort } }) });
if (!isControl && ${JSON.stringify(spawnAt)}) await post({ model: "claude-opus-5", system: "cc_is_subagent=true", messages: [{ role: "user", content: "child" }], tools: [{ name: "Read" }], output_config: { effort: ${JSON.stringify(spawnAt)} } });
`,
  );
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "ultracode-anywhere@m": true }, ...settings }));
  const state = await check.verify({ managedDir: NO_POLICY, env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [script], timeoutMs: 20000 });
  const controls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { env, state, leaks: state.leaks, mainLeaks: state.leaks.filter((leak) => leak.includes(": the main loop was lowered to ")), controlInfra: state.infra.filter((line) => line.startsWith("control:")), infra: state.infra, controls };
}

test("a run judges the main loop against a control run of the same build with this plugin switched off and no preload", async (t) => {
  const lowered = await mainLoopRun(t, { control: "xhigh", probe: "medium" });
  assert.notDeepEqual(lowered.mainLeaks, [], "a main loop at the held level, where the control ran at xhigh, is lowered");
  assert.equal(lowered.state.mainLoopJudge, "control", "the record carries the mark a later run keeps its main-loop leaks by");
  assert.equal(lowered.controls.length, 1);
  const flag = lowered.controls[0].args;
  assert.deepEqual(JSON.parse(flag[flag.indexOf("--settings") + 1]), { enabledPlugins: { "ultracode-anywhere@m": false } });
  assert.equal(lowered.controls[0].nodeOptions, "");
  const settled = await mainLoopRun(t, { level: "high", settings: { modelSettings: { "us.anthropic.claude-sonnet-5-v1:0": { effortLevel: "low" } } } });
  assert.deepEqual(settled.mainLeaks, [], "a main loop the control also ran at the held level is not lowered, whatever the settings say");
});

test("a control that proves nothing clears no main-loop leak the last run recorded, and one that ran clears it", async (t) => {
  const previous = { version: "2.1.999", ok: false, leaks: ["fork: the main loop was lowered to medium", "fork: it spawned instead of being refused", "gone probe: the main loop was lowered to medium", "built-in agent: the main loop was lowered to medium", "plugin agent: the main loop was lowered to medium", "remote agent: the main loop was lowered to high"], infra: [], mainLoopJudge: "control" };
  const run = await mainLoopRun(t, { control: "none", probe: "medium", previous });
  assert.ok(run.mainLeaks.includes("fork: the main loop was lowered to medium"));
  assert.match(run.state.controlWhy, /never reached the stand-in/, "the record carries the reason a session start gives beside a kept leak");
  assert.ok(verifiedRecord(run.env).leaks.includes("fork: the main loop was lowered to medium"), "the kept leak survives the record's own reader, so the gate still refuses over it");
  assert.ok(run.state.details["plugin agent"]?.skipped, "the fixture has no plugin agent to drive, so that probe is skipped");
  assert.ok(run.mainLeaks.includes("built-in agent: the main loop was lowered to medium") && run.mainLeaks.includes("plugin agent: the main loop was lowered to medium"));
  assert.ok(!run.mainLeaks.includes("remote agent: the main loop was lowered to high"), "a leak naming a level the hold no longer holds is not kept");
  const unknown = await mainLoopRun(t, { control: "none", probe: "unset", previous });
  assert.ok(unknown.mainLeaks.includes("fork: the main loop was lowered to medium"), "a main loop whose requests carry no effort was not seen off the held level");
  const offLevel = await mainLoopRun(t, { control: "none", probe: "xhigh", spawnAt: "medium", previous });
  assert.ok(!offLevel.mainLeaks.includes("fork: the main loop was lowered to medium"), "a probe this run saw with its main loop off the held level cannot have been lowered to it, so its kept leak goes");
  assert.ok(!offLevel.mainLeaks.includes("built-in agent: the main loop was lowered to medium"), "a probe's own infrastructure line brings back no main-loop leak its run judged");
  assert.ok(offLevel.mainLeaks.includes("plugin agent: the main loop was lowered to medium"), "a skipped probe proved nothing about its main loop");
  assert.ok(!run.mainLeaks.includes("gone probe: the main loop was lowered to medium"), "a leak whose probe no longer runs has nothing left to clear it, so it goes");
  assert.ok(!run.leaks.includes("fork: it spawned instead of being refused"), "only main-loop leaks are kept, and a spawn leak this run did not see goes");
  const before = await mainLoopRun(t, { control: "none", probe: "medium", previous: { ...previous, mainLoopJudge: undefined } });
  assert.deepEqual(before.mainLeaks, [], "a record no control judged, as 0.9.0 wrote, gives no main-loop leak to keep");
  const measured = await mainLoopRun(t, { control: "medium", probe: "medium", previous });
  assert.ok(!measured.mainLeaks.includes("fork: the main loop was lowered to medium"), "a main loop the control also ran at the held level clears the recorded leak");
  assert.ok(!measured.mainLeaks.includes("built-in agent: the main loop was lowered to medium"), "a probe's own infrastructure line brings back no main-loop leak its run judged clean");
});

test("a control that still lists this plugin's agents, or finds no id to switch off, judges nothing, says why and keeps the last main-loop leaks", async (t) => {
  const previous = { version: "2.1.999", ok: false, leaks: ["fork: the main loop was lowered to medium", "fork: it spawned instead of being refused", "gone probe: the main loop was lowered to medium"], infra: [], mainLoopJudge: "control" };
  const loaded = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlSays: "\n- ultracode-anywhere:finder: Reads code. (Tools: Read)", previous });
  assert.deepEqual(loaded.mainLeaks, ["fork: the main loop was lowered to medium"], "a control that kept the plugin on measured nothing about it");
  assert.match(loaded.controlInfra.join(), /still loaded this plugin/);
  const unnamed = await mainLoopRun(t, { control: "xhigh", probe: "medium", settings: { enabledPlugins: { "kit@m": true } }, previous });
  assert.deepEqual(unnamed.mainLeaks, ["fork: the main loop was lowered to medium"]);
  assert.match(unnamed.controlInfra.join(), /under no id, so the control could not switch it off/);
});

test("a control that lists this plugin's agents in a tool's description is still loaded, wherever a later build puts the listing", async (t) => {
  const run = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlToolsSay: "Launches agents.\n- ultracode-anywhere:finder: Reads code. (Tools: Read)" });
  assert.match(run.controlInfra.join(), /still loaded this plugin/);
  assert.deepEqual(run.mainLeaks, []);
});

test("a control whose messages name this plugin in prose or in a bullet of their own still judges the main loop", async (t) => {
  const run = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlSays: "\nAlways run ultracode-anywhere:review on a diff. ultracode-anywhere:finder: reads code (Tools: Read)." });
  assert.deepEqual(run.controlInfra, []);
  assert.notDeepEqual(run.mainLeaks, []);
  const bullet = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlSays: "\n- ultracode-anywhere:review: run it on every diff\n- Explore: Fast agent. (Tools: Read)\n- ultracode-anywhere:finder: reads code" });
  assert.deepEqual(bullet.controlInfra, [], "a line in the listing's shape with no tools at its end is no listing");
  assert.notDeepEqual(bullet.mainLeaks, []);
});

test("a probe's main loop on a model the control never ran is not judged, and a line says so", async (t) => {
  const run = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlModel: "claude-sonnet-5" });
  assert.deepEqual(run.mainLeaks, []);
  assert.ok(run.infra.some((line) => /^main loop: .+ ran on claude-opus-5, which the control run never ran, so it was not judged$/.test(line)));
  const spawnLeak = "remote agent: a spawn ran at claude-opus-5/xhigh";
  const spawnsClean = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlModel: "claude-sonnet-5", spawnAt: "medium", previous: { version: "2.1.999", ok: false, leaks: [spawnLeak], infra: [], mainLoopJudge: "control" } });
  assert.ok(!spawnsClean.leaks.includes(spawnLeak), "a main loop the control could not judge leaves the probe's spawns judged, so a spawn leak they cleared goes");
  const lowered = "built-in agent: the main loop was lowered to medium";
  const previous = { version: "2.1.999", ok: false, leaks: [lowered], infra: [], mainLoopJudge: "control" };
  const marked = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlModel: "claude-sonnet-5", previous });
  assert.ok(marked.mainLeaks.includes(lowered), "a probe the control could not judge keeps the leak a control judged");
  const unmarked = await mainLoopRun(t, { control: "xhigh", probe: "medium", controlModel: "claude-sonnet-5", previous: { ...previous, mainLoopJudge: undefined } });
  assert.deepEqual(unmarked.mainLeaks, [], "a record no control judged gives no main-loop leak to that probe either");
});

test("a control run that never reaches the stand-in is infrastructure, and no main loop is judged", async (t) => {
  const run = await mainLoopRun(t, { control: "none", probe: "medium" });
  assert.deepEqual(run.mainLeaks, []);
  assert.equal(run.controlInfra.length, 1);
  assert.match(run.controlInfra[0], /, so no main loop at the held level was judged$/, "a main loop seen off the held level is still judged without a control");
});

test("a probe that expects a refusal passes only on the hook's own words, and fails when it spawned", () => {
  const probe = (seen) => ({ name: "fork", expect: { refused: "cannot be held to" }, seen });

  assert.deepEqual(judge([probe([main({ results: [refusal("A fork ... cannot be held to medium.")] })])]).leaks, []);
  assert.match(judge([probe([main({ results: [refusal("No agent definition named fork was found")] })])]).leaks.join(), /fork: the hook did not refuse it/);
  assert.match(judge([probe([main({ results: [refusal([{ type: "text", text: "cannot be held to" }])] }), spawn({})])]).leaks.join(), /fork: it spawned/);
});

test("a typed command the hook must block passes on its words in the output, and leaks if it spawned", () => {
  const probe = (seen, output) => ({ name: "slash command", expect: { blocked: "must run at" }, seen, output });

  assert.deepEqual(verdict(judge([probe([], "Prompt blocked: every spawn must run at medium.")])), { leaks: [], infra: [] });
  assert.match(judge([probe([spawn({ effort: "xhigh" })], "")]).leaks.join(), /slash command: the typed command was not blocked/);
  assert.match(judge([probe([], "")]).infra.join(), /slash command: the typed command was neither blocked nor run/);
});

test("the tripwire probe passes only when its subagent off the level was refused a tool call", () => {
  const probe = (results, seen = null) => ({ name: "tripwire", expect: { tripwire: "running at xhigh effort" }, seen: seen ?? [main({}), spawn({ effort: "xhigh", results })] });

  assert.deepEqual(verdict(judge([probe([refusal("This subagent is running at xhigh effort, and ...")])])), { leaks: [], infra: [] });
  assert.match(judge([probe([])]).leaks.join(), /tripwire: a subagent off the level was not stopped/);
  assert.match(judge([probe([], [main({})])]).infra.join(), /tripwire: no spawn reached the stand-in/);
});

test("a shell-started child must reach the stand-in itself", () => {
  const probe = (conversation) => ({ name: "shell", expect: { child: check.CHILD_MARKER }, seen: [main({}), spawn({ subagent: false, conversation })] });

  assert.deepEqual(verdict(judge([probe(`${check.CHILD_MARKER} ping`)])), { leaks: [], infra: [] });
  assert.match(judge([probe("something else")]).infra.join(), /child session never reached/);
});

test("a probe whose spawn makes a tool call must show the tripwire reading that spawn's level and model", () => {
  const probe = (lines) => ({ name: "workflow stage", callsTools: true, seen: [main({}), spawn({})], lines });

  assert.deepEqual(verdict(judge([probe(["main xhigh none", "child medium claude-opus-5"])])), { leaks: [], infra: [] });
  assert.match(judge([probe(["main xhigh none"])]).infra.join(), /workflow stage: the tripwire saw no subagent tool call/);
  assert.match(judge([probe(["child medium none"])]).infra.join(), /workflow stage: the tripwire could not read the subagent's model/);
  assert.match(judge([probe(["child medium claude-opus-5", "child xhigh none"])]).leaks.join(), /workflow stage: the tripwire saw child xhigh none/);
  assert.match(judge([probe(["child medium claude-sonnet-5"])]).leaks.join(), /claude-sonnet-5/);
  assert.deepEqual(verdict(judge([{ name: "skipped", skip: "no plugin agent", seen: [] }])), { leaks: [], infra: [] });
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
  const lowered = { ...leak, leaks: ["plugin agent: the main loop was lowered to medium"] };
  assert.deepEqual(check.carryLeaks(lowered, unsure).leaks, [], "a main-loop leak is carried by verify, which knows whose main loop the run judged");
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

  const state = await check.verify({ managedDir: NO_POLICY, env: gap, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.equal(state.version, "2.1.999");
  assert.equal(state.ok, false);
  assert.ok(state.leaks.some((leak) => /^settings: CLAUDE_CODE_FORK_SUBAGENT is not 0/.test(leak)));
  assert.equal(Object.keys(state.details).length, 17);
  assert.deepEqual(JSON.parse(readFileSync(holdStatePath(env, "verified.json"), "utf8")).version, "2.1.999");
});

test("a run with the hold off records nothing and says why", async (t) => {
  const { env } = world(t);

  const state = await check.verify({ managedDir: NO_POLICY, env: { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE] });
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
  const { cfg, env } = world(t, { level: "medium" });
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true }, env: { ANTHROPIC_BASE_URL: "https://proxy.example" } }));
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "2.1.999", ok: false, leaks: ["fork: it spawned instead of being refused", "fork: the main loop was lowered to medium", "fork: the main loop was lowered to high"], infra: [], mainLoopJudge: "control" }));

  const state = await check.verify({ managedDir: NO_POLICY, env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: process.execPath, binaryArgs: [FAKE], timeoutMs: 20000 });
  assert.match(state.infra.join(), /ANTHROPIC_BASE_URL/);
  assert.deepEqual(state.details, {});
  assert.deepEqual(state.leaks, ["fork: it spawned instead of being refused", "fork: the main loop was lowered to medium"], "a run that proved nothing keeps the last leaks, but a main-loop leak naming another level");
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

  const state = await check.verify({ managedDir: NO_POLICY, env: { ...hostEnv(), ...env }, version: "2.1.999", stamp: "s", binary: "bad\0claude", timeoutMs: 5000 });
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
  const other = join(checksDir(env), "not-a-check");
  mkdirSync(other);
  utimesSync(other, old, old);

  check.pruneChecks(env);
  assert.equal(existsSync(left), false);
  assert.deepEqual(folders.filter((folder) => existsSync(folder)), []);
  assert.equal(existsSync(fresh), true, "a directory a running check may still use stays");
  assert.equal(existsSync(other), true, "only a directory the self-check made is removed");
});

test("a policy drop-in the build skips routes nothing: one in a folder below, or one named with a leading dot", (t) => {
  const { root, env } = world(t);
  const managedDir = join(root, "policy");
  const routes = JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://elsewhere.invalid" } });
  write(join(managedDir, "managed-settings.d", "archive", "10.json"), routes);
  write(join(managedDir, "managed-settings.d", ".old.json"), routes);
  assert.deepEqual(check.routedAway({ ...hostEnv(), ...env }, managedDir), []);
  write(join(managedDir, "managed-settings.d", "20.json"), routes);
  assert.deepEqual(check.routedAway({ ...hostEnv(), ...env }, managedDir), ["ANTHROPIC_BASE_URL"]);
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
