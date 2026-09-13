/**
 * The spawn hold's self-check (A81).
 *
 * Probe sessions of the installed build run against this machine's own
 * configuration, each trying one way a spawn could get past the hold, and talk
 * to a local stand-in for the Messages API. The stand-in reads the model and
 * effort off the wire, the one place neither can be misreported, and a spawn it
 * saw off the level is a leak every later spawn on that build is refused over.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, delimiter, join } from "node:path";

import { sameLevel } from "./effort.mjs";
import { copyOf, pluginDefs, syncCopies } from "./hold-agents.mjs";
import { SCRATCH, checksDir, holdGaps, holdStatePath, holdTarget, preloadPath, sameFamily } from "./hold-config.mjs";
import { filesIn, plainLine, readJson, writeWhole } from "./hold-files.mjs";
import { shellQuoted } from "./hold-session.mjs";
import { isRunnable, isShim, realClaudeOn } from "./hold-shim.mjs";
import { configDirFor, readIfFile, realOf } from "./hook-io.mjs";
import { isOff, settingsFor } from "./upstream.mjs";

/** What a probe's own prompt carries, so the stand-in can tell its main loop from anything it starts. */
export const MARKER = "ULTRACODE-HOLD-PROBE-MAIN";

/** What the prompt of a claude that a probe starts from its shell carries. */
export const CHILD_MARKER = "ULTRACODE-HOLD-PROBE-CHILD";

/** The prefix of the agent, skill and workflow a probe's project holds. */
const PROBE_NAME = "ultracode-hold-check";

/** What the hook's refusal of a skill or a typed command off the level says. */
const SKILL_REFUSAL = "must run at";

const PROBE_TIMEOUT_MS = 150_000;
const KILL_GRACE_MS = 5000;
const PROBES_AT_ONCE = 4;

/** How old a check directory is before a later run takes it for one a killed run left, the age a stale lock is taken over at. */
const LEFT_BEHIND_MS = 30 * 60 * 1000;
const OUTPUT_MOST = 64 * 1024;

/**
 * Variables a session sets for what it starts, which a probe started the way a
 * terminal starts one must not inherit, and the ones that send requests to
 * another provider, past the stand-in.
 */
const SESSION_NAMES = new Set([
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_EFFORT",
  "CLAUDE_ENV_FILE",
  "CLAUDE_PID",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CSD_CLAUDE_BIN",
  "ULTRACODE_ANYWHERE_HELD_CHILD",
]);
const SESSION_PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_BRIDGE_", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_MESSAGING_", "CLAUDE_CODE_SESSION", "CLAUDE_PLUGIN_", "ULTRACODE_ANYWHERE_HOLD_CHECK"];

/**
 * The environment a probe starts with: `base` without what a session sets for
 * its children and without any shim on PATH, then `extra`.
 */
export function probeEnv(base = process.env, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (SESSION_NAMES.has(name) || SESSION_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    env[name] = value;
  }
  for (const key of ["PATH", "Path"]) {
    if (typeof env[key] === "string") env[key] = env[key].split(delimiter).filter((dir) => dir && !isShim(join(dir, "claude"))).join(delimiter);
  }
  return { ...env, ...extra };
}

/**
 * The claude a probe runs: the build running this session, else the first on
 * PATH that is no copy of the shim. An install that runs under a JavaScript
 * runtime reports the runtime as its exec path, which is no claude to start.
 */
export function realClaude(env = process.env) {
  const exec = env.CLAUDE_CODE_EXECPATH;
  if (exec && isRunnable(exec) && !/^(node|bun)(\.exe)?$/i.test(basename(exec))) return exec;
  return realClaudeOn(env) ?? "claude";
}

/** A fresh directory of the self-check's own inside the hold's state, the one place a hook believes a probe's log. */
export function scratchIn(env = process.env) {
  const checks = checksDir(env);
  if (!checks) throw new Error("this machine has no state directory for the self-check to work in");
  mkdirSync(checks, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(checks, SCRATCH));
}

/** The build a binary says it is, for a run started outside a session, or "". */
export function claudeVersion(binary, env = process.env, binaryArgs = []) {
  const run = spawnSync(binary, [...binaryArgs, "--version"], { encoding: "utf8", timeout: 20_000, windowsHide: true, env: probeEnv(env) });
  return /^(\d+\.\d+\.\d+)/.exec(String(run.stdout ?? "").trim())?.[1] ?? "";
}

/**
 * What one request tells the check. Claude Code marks every request a subagent
 * makes in its billing header, and asks for the 1M context window as a beta.
 */
export function classify(body, headers = {}) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const subagent = JSON.stringify(body?.system ?? "").includes("cc_is_subagent=true");
  const conversation = JSON.stringify(messages);
  return {
    subagent,
    isMain: !subagent && conversation.includes(MARKER),
    conversation,
    model: body?.model,
    effort: body?.output_config?.effort ?? null,
    context1m: String(headers["anthropic-beta"] ?? "").split(",").some((beta) => beta.trim().startsWith("context-1m")),
    tools: Array.isArray(body?.tools) ? body.tools.length : 0,
    results: messages.flatMap((message) => (Array.isArray(message?.content) ? message.content.filter((block) => block?.type === "tool_result") : [])),
    body,
  };
}

/** One streamed reply. It names the model asked for, since transcripts record it and the tripwire reads them. */
function reply(res, model, block, stop) {
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const text = block.type === "text";
  res.writeHead(200, { "content-type": "text/event-stream" });
  event("message_start", { type: "message_start", message: { id: "msg_stand_in", type: "message", role: "assistant", model: model ?? "stand-in", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  event("content_block_start", { type: "content_block_start", index: 0, content_block: text ? { type: "text", text: "" } : { ...block, input: {} } });
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: text ? { type: "text_delta", text: block.text } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
  event("content_block_stop", { type: "content_block_stop", index: 0 });
  event("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  event("message_stop", { type: "message_stop" });
  res.end();
}

/**
 * The stand-in: it answers the main loop once with `plan.main`, any other loop
 * that offers tools once per request with `plan.child`, and everything else with
 * text, keeping every request that offered tools.
 */
function standIn(plan) {
  return new Promise((ready, fail) => {
    const seen = [];
    let mainSent = false;
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          // Counted as a request that offered nothing.
        }
        if (!req.url.includes("/v1/messages") || req.url.includes("count_tokens")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(req.url.includes("count_tokens") ? '{"input_tokens":1}' : "{}");
          return;
        }
        const row = classify(body, req.headers);
        if (row.tools > 0) seen.push(row);
        const fresh = row.tools > 0 && row.results.length === 0;
        if (fresh && row.isMain && !mainSent && plan.main) {
          mainSent = true;
          reply(res, body.model, { type: "tool_use", id: "toolu_main", name: plan.main.tool, input: plan.main.input }, "tool_use");
        } else if (fresh && !row.isMain && plan.child) {
          reply(res, body.model, { type: "tool_use", id: `toolu_child${seen.length}`, name: plan.child.tool, input: plan.child.input }, "tool_use");
        } else {
          reply(res, body.model, { type: "text", text: "ok" }, "end_turn");
        }
      });
    });
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () =>
      ready({
        port: server.address().port,
        seen,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    );
  });
}

/** Signals everything a probe started, which runs in a process group of its own. */
function stopGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    // Windows hands an exited process's id to the next one, so only a probe still running is killed there.
    else if (child.exitCode === null && child.signalCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // Gone already.
  }
}

/** The folder Claude Code keeps a directory's sessions in: every other character a hyphen, and a name past 200 characters cut there with a hash of the path after it. */
export function projectFolderName(dir) {
  const name = dir.replace(/[^a-zA-Z0-9]/g, "-");
  if (name.length <= 200) return name;
  let hash = 0;
  for (let at = 0; at < dir.length; at++) hash = ((hash << 5) - hash + dir.charCodeAt(at)) | 0;
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

/** Removes the check directories, and their probes' session folders, that a run killed before its own cleanup left behind. */
export function pruneChecks(env = process.env, now = Date.now()) {
  const checks = checksDir(env);
  let names = [];
  try {
    names = readdirSync(checks).filter((name) => name.startsWith(SCRATCH));
  } catch {
    return;
  }
  const config = configDirFor(probeEnv(env));
  for (const name of names) {
    const dir = join(checks, name);
    try {
      if (now - statSync(dir).mtimeMs <= LEFT_BEHIND_MS) continue;
      forgetSession(join(dir, "project"), config);
      forgetSession(dir, config);
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Another run removed it first.
    }
  }
}

/** A probe session leaves a project folder named after its directory, even with persistence off. */
function forgetSession(workDir, config) {
  if (!config) return;
  for (const dir of new Set([workDir, realOf(workDir)])) {
    if (!dir.replace(/[^a-zA-Z0-9]/g, "-").includes(SCRATCH)) continue;
    try {
      rmSync(join(config, "projects", projectFolderName(dir)), { recursive: true, force: true });
    } catch {
      // A folder left behind costs disk and nothing else, so the probe's result still stands.
    }
  }
}

/**
 * Runs one probe session in print mode against a fresh stand-in, answering what
 * the stand-in saw and what the session printed. `base` is the environment the
 * probe starts from and `env` what it adds.
 */
export async function runProbe({ plan = {}, cwd, env = {}, base = process.env, binary = realClaude(base), binaryArgs = [], timeoutMs = PROBE_TIMEOUT_MS, prompt = `${MARKER} ping`, args = [], persist = false }) {
  const workDir = cwd ?? scratchIn(base);
  const flags = [...binaryArgs, "-p", prompt, "--strict-mcp-config", "--dangerously-skip-permissions", ...(persist ? [] : ["--no-session-persistence"]), ...args];
  let api = null;
  let output = "";
  try {
    api = await standIn(plan);
    const childEnv = probeEnv(base, { ANTHROPIC_API_KEY: "stand-in", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ...env });
    await new Promise((done) => {
      let finished = false;
      let timer;
      const child = spawn(binary, flags, { cwd: workDir, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stopGroup(child, "SIGKILL");
        child.stdout?.destroy();
        child.stderr?.destroy();
        done();
      };
      const collect = (chunk) => {
        if (output.length < OUTPUT_MOST) output += chunk;
      };
      child.stdout?.setEncoding("utf8").on("data", collect);
      child.stderr?.setEncoding("utf8").on("data", collect);
      // A probe that ignores the signal, or leaves a child holding its output open, must not hold up the check.
      timer = setTimeout(() => {
        stopGroup(child, "SIGTERM");
        timer = setTimeout(finish, KILL_GRACE_MS);
      }, timeoutMs);
      child.on("error", finish);
      child.on("close", finish);
    });
  } finally {
    api?.close();
    // A directory the caller named may be shared with probes still running, so its session folder is the caller's to remove.
    if (!cwd) {
      forgetSession(workDir, configDirFor(probeEnv(base, env)));
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  return { seen: api.seen, output };
}

/** An agent off the level of a plugin the user's settings turn on, whose copy is in place, which is what the plugin probe needs, or null. */
export function pluginAgentForProbe(env = process.env, level) {
  return pluginDefs(env).find((def) => !sameLevel(def.effort, level) && copyOf(def, level, env))?.agentType ?? null;
}

function describe(rows) {
  return rows.map((row) => `${row.model}/${row.effort}`).join(", ");
}

function contentText(content) {
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function refusedIn(rows, words) {
  return rows.some((row) => row.results.some((result) => result.is_error && contentText(result.content).includes(words)));
}

/**
 * The leaks and the infrastructure failures in what the probes saw.
 *
 * A leak is a spawn off the held level or model, the main loop lowered to it, or
 * a refusal the hooks did not make. Anything that only kept a probe from running
 * is infrastructure, which proves nothing either way.
 */
export function evaluate(probes, { expectedMain, target }) {
  const leaks = [];
  const infra = [];
  const offTarget = (row) => row.effort !== target.level || !sameFamily(row.model, target.family);
  for (const { name, skip, failed, seen = [], output = "", lines = [], expect = {}, ownMain = false, callsTools = false } of probes) {
    if (skip) continue;
    if (failed) {
      infra.push(`${name}: the probe could not run: ${failed}`);
      continue;
    }
    const main = seen.filter((row) => row.isMain);
    const spawns = seen.filter((row) => !row.isMain);
    if (expect.blocked) {
      if (spawns.length > 0) leaks.push(`${name}: the typed command was not blocked and spawned at ${describe(spawns)}`);
      else if (!output.includes(expect.blocked)) infra.push(`${name}: the typed command was neither blocked nor run`);
      continue;
    }
    if (main.length === 0) {
      infra.push(`${name}: the probe session never reached the stand-in`);
      continue;
    }
    if (!ownMain && expectedMain && !sameLevel(expectedMain, target.level) && main.some((row) => row.effort === target.level)) {
      leaks.push(`${name}: the main loop was lowered to ${target.level}`);
    }
    if (expect.tripwire) {
      if (spawns.length === 0) infra.push(`${name}: no spawn reached the stand-in`);
      else if (!refusedIn(spawns, expect.tripwire)) leaks.push(`${name}: a subagent off the level was not stopped`);
      continue;
    }
    const off = spawns.filter(offTarget);
    if (off.length > 0) leaks.push(`${name}: a spawn ran at ${describe(off)}`);
    if (target.context1m && spawns.some((row) => row.context1m === false)) leaks.push(`${name}: a spawn was sent without the 1M context beta`);
    if (expect.refused) {
      if (spawns.length > 0) leaks.push(`${name}: it spawned instead of being refused`);
      if (!refusedIn(main, expect.refused)) leaks.push(`${name}: the hook did not refuse it`);
      continue;
    }
    if (spawns.length === 0) infra.push(`${name}: no spawn reached the stand-in`);
    else if (expect.child && !spawns.some((row) => row.conversation.includes(expect.child))) infra.push(`${name}: the child session never reached the stand-in`);

    const children = lines.filter((line) => line.startsWith("child ")).map((line) => {
      const [, level, model = "none"] = line.split(" ");
      return { line, level, model };
    });
    const strays = children.filter((child) => child.level !== target.level || (child.model !== "none" && !sameFamily(child.model, target.family)));
    if (strays.length > 0) leaks.push(`${name}: the tripwire saw ${strays.map((child) => child.line).join(", ")}`);
    else if (callsTools && children.length === 0) infra.push(`${name}: the tripwire saw no subagent tool call, so its payload fields may have moved`);
    else if (callsTools && !children.some((child) => sameFamily(child.model, target.family))) {
      infra.push(`${name}: the tripwire could not read the subagent's model from its transcript, so the transcript layout may have moved`);
    }
  }
  return { leaks, infra };
}

function probeOf(finding) {
  return finding.slice(0, finding.indexOf(": "));
}

/**
 * The next record with the last one's leaks carried over where they still stand.
 *
 * A run that could not finish a probe proves nothing about it, so that probe's
 * last leak on this build stays. A leak from a probe that ran clean, or that no
 * longer exists, goes.
 */
export function carryLeaks(previous, next) {
  if (previous?.version !== next.version || !Array.isArray(previous?.leaks) || previous.leaks.length === 0) return next;
  const skipped = Object.entries(next.details ?? {}).filter(([, detail]) => detail?.skipped !== undefined);
  const unsure = new Set([...(next.infra ?? []).map(probeOf), ...skipped.map(([name]) => name)]);
  const found = new Set(next.leaks);
  const kept = previous.leaks.filter((leak) => typeof leak === "string" && !found.has(leak) && unsure.has(probeOf(leak)));
  return kept.length > 0 ? { ...next, ok: false, leaks: [...next.leaks, ...kept] } : next;
}

/** An Agent call a stand-in hands a probe's main loop. */
export function agentPlan(type, extra = {}) {
  return { tool: "Agent", input: { description: "self-check", prompt: "say ok", subagent_type: type, run_in_background: false, ...extra } };
}

function bashPlan(command) {
  return { tool: "Bash", input: { command, description: "self-check" } };
}

function workflowPlan(body) {
  return { tool: "Workflow", input: { script: `export const meta = { name: "${PROBE_NAME}", description: "self-check" }\n${body}` } };
}

function shellChild(bin, off) {
  return `${bin} -p '${CHILD_MARKER} ping' --model haiku --effort ${off} --strict-mcp-config --no-session-persistence < /dev/null`;
}

// The binary is named outright and the shell's level and model are cleared, so only the preload can hold this child.
function nodeChild(binary, off) {
  return `ULTRACODE_HOLD_PROBE_CLAUDE=${shellQuoted(binary)} env -u CLAUDE_CODE_EFFORT_LEVEL -u ANTHROPIC_MODEL node -e 'require("child_process").execFileSync(process.env.ULTRACODE_HOLD_PROBE_CLAUDE, ["-p", "${CHILD_MARKER} ping", "--effort", "${off}", "--strict-mcp-config", "--no-session-persistence"], { stdio: "ignore" })'`;
}

/** A level other than the held one, for a probe to ask for. */
function otherThan(level) {
  return level === "xhigh" ? "high" : "xhigh";
}

/**
 * Every probe, under a name that stays the same from run to run, since a
 * recorded leak clears only when a probe of the same name runs clean.
 */
export function probeList({ project, pluginAgent, binary, level, family = "", preload }) {
  const off = otherThan(level);
  const slow = `${PROBE_NAME}-slow`;
  return [
    { name: "built-in agent", persist: true, callsTools: true, plan: { main: agentPlan("general-purpose"), child: bashPlan("true") } },
    { name: "Agent call with no type", plan: { main: agentPlan(undefined) } },
    pluginAgent
      ? { name: "plugin agent", agent: pluginAgent, plan: { main: agentPlan(pluginAgent) } }
      : { name: "plugin agent", skip: "no enabled plugin agent off the level has its copy yet" },
    { name: "project agent off the level", cwd: project, expect: { refused: "in its file" }, plan: { main: agentPlan(slow) } },
    { name: "remote agent", cwd: project, plan: { main: agentPlan("general-purpose", { isolation: "remote" }) } },
    { name: "workflow stage asking for another level", persist: true, callsTools: true, plan: { main: workflowPlan(`return await agent("say ok", { label: "s", effort: "${off}" })`), child: bashPlan("true") } },
    { name: "workflow stage inheriting another model", ownMain: true, args: ["--model", family.includes("sonnet") ? "opus" : "sonnet"], plan: { main: workflowPlan('return await agent("say ok", { label: "s", model: "inherit" })') } },
    { name: "nested workflow", cwd: project, plan: { main: workflowPlan(`return await workflow("${PROBE_NAME}-child")`) } },
    { name: "forked skill off the level", cwd: project, expect: { refused: SKILL_REFUSAL }, plan: { main: { tool: "Skill", input: { skill: `${PROBE_NAME}-heavy` } } } },
    { name: "forked skill typed as a command", cwd: project, prompt: `/${PROBE_NAME}-heavy ${MARKER}`, expect: { blocked: SKILL_REFUSAL } },
    { name: "code review asking for another level", plan: { main: { tool: "Skill", input: { skill: "code-review", args: off } } } },
    { name: "code review typed with another level", prompt: `/code-review ${off} ${MARKER}`, expect: { blocked: SKILL_REFUSAL } },
    { name: "claude started from the shell", expect: { child: CHILD_MARKER }, plan: { main: bashPlan(shellChild("claude", off)) } },
    { name: "session driver worker", expect: { child: CHILD_MARKER }, plan: { main: bashPlan(shellChild('"$CSD_CLAUDE_BIN"', off)) } },
    preload
      ? { name: "claude started by a node process", expect: { child: CHILD_MARKER }, plan: { main: bashPlan(nodeChild(binary, off)) } }
      : { name: "claude started by a node process", skip: "NODE_OPTIONS does not require the hold's preload, so a claude a node program starts is not held" },
    { name: "fork", expect: { refused: "cannot be held to" }, plan: { main: agentPlan("fork") } },
    { name: "subagent past the routing", cwd: project, expect: { tripwire: `running at ${off} effort` }, env: { ULTRACODE_ANYWHERE_HOLD_CHECK_UNROUTED: "1" }, plan: { main: agentPlan(slow), child: bashPlan("true") } },
  ];
}

function countEach(keys) {
  return keys.reduce((counts, key) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 }), {});
}

function modelsAndLevels(rows) {
  return countEach(rows.map((row) => `${row.model}/${row.effort}`));
}

/** What each probe saw, by name, a skipped probe included. */
export function detailsOf(results) {
  return Object.fromEntries(
    results.map((result) => [
      result.name,
      result.skip
        ? { skipped: result.skip }
        : { ...(result.agent && { agent: result.agent }), main: modelsAndLevels(result.seen.filter((row) => row.isMain)), spawns: modelsAndLevels(result.seen.filter((row) => !row.isMain)), tripwire: countEach(result.lines) },
    ]),
  );
}

/** One throwaway project holding every definition the probes need off the level. */
function probeProject(scratch, off) {
  const project = join(scratch, "project");
  const put = (path, text) => writeWhole(join(project, ".claude", path), text);
  put(`workflows/${PROBE_NAME}-child.js`, `export const meta = { name: "${PROBE_NAME}-child", description: "self-check" }\nreturn await agent("say ok", { label: "nested", effort: "${off}" })\n`);
  put(`agents/${PROBE_NAME}-slow.md`, `---\nname: ${PROBE_NAME}-slow\ndescription: A self-check agent off the level.\neffort: ${off}\n---\nSay ok.\n`);
  put(`skills/${PROBE_NAME}-heavy/SKILL.md`, `---\nname: ${PROBE_NAME}-heavy\ndescription: A self-check skill off the level.\ncontext: fork\neffort: ${off}\n---\nSay ok.\n`);
  return project;
}

/** Where a managed policy keeps its settings, the directory the build reads on each platform. */
function managedSettingsDir(platform = process.platform) {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  return platform === "win32" ? "C:\\Program Files\\ClaudeCode" : "/etc/claude-code";
}

/** The settings `env` names, the user's and a managed policy's, that send a session's requests past a probe's stand-in. */
export function routedAway(env = process.env, managedDir = managedSettingsDir()) {
  const files = [join(managedDir, "managed-settings.json"), ...filesIn(join(managedDir, "managed-settings.d"), ".json")];
  const names = new Set();
  for (const named of [settingsFor(env).env, ...files.map((file) => readJson(file, null)?.env)]) {
    if (!named || typeof named !== "object") continue;
    for (const [name, value] of Object.entries(named)) {
      if (/^ANTHROPIC_(\w+_)?BASE_URL$|^CLAUDE_CODE_USE_/.test(name) && String(value ?? "").trim() !== "" && !isOff(value)) names.add(name);
    }
  }
  return [...names].sort();
}

/** The probe leaks the last run recorded on this build, which a run that proved nothing keeps. */
function lastProbeLeaks(env, version) {
  const last = readJson(holdStatePath(env, "verified.json"), null);
  return last?.version === version && Array.isArray(last.leaks) ? last.leaks.filter((leak) => typeof leak === "string" && !leak.startsWith("settings: ")) : [];
}

/** Writes the next record over the last, its leaks carried where they still stand. */
function record(env, next) {
  const file = holdStatePath(env, "verified.json");
  const state = carryLeaks(readJson(file, null), { ...next, ok: next.leaks.length === 0 && next.infra.length === 0, at: new Date().toISOString() });
  if (file) writeWhole(file, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function linesOf(path) {
  return readIfFile(path).split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Runs every probe against this build and records what it found for `version`.
 *
 * A setting the hold cannot do without is recorded as a leak too, since every
 * probe past it proves less than it seems to. User settings that send requests
 * elsewhere start no probe, which would reach that service instead of the
 * stand-in, and the last leaks on this build stay. A run that throws records
 * nothing, so the last record stands.
 */
export async function verify({ env = process.env, version, stamp, binary = realClaude(env), binaryArgs = [], timeoutMs = PROBE_TIMEOUT_MS }) {
  const target = holdTarget(env);
  if (!target) return { version, ok: false, error: "the spawn hold is not on, since ULTRACODE_ANYWHERE_SPAWN_EFFORT names no level" };
  const required = holdGaps(env).required.map((gap) => `settings: ${gap}`);
  const routed = routedAway(env);
  if (routed.length > 0) {
    const infra = [`probes: the settings set ${routed.join(" and ")}, which would send a probe's requests past its local stand-in, so none ran`];
    return record(env, { version, stamp, leaks: [...required, ...lastProbeLeaks(env, version)], infra, details: {} });
  }

  const scratch = scratchIn(env);
  try {
    const project = probeProject(scratch, otherThan(target.level));
    const preload = preloadPath(env);
    const preloaded = Boolean(preload) && existsSync(preload) && !holdGaps(env, { preload }).recommended.some((gap) => gap.startsWith("NODE_OPTIONS"));
    syncCopies({ env, level: target.level });
    const probes = probeList({ project, pluginAgent: pluginAgentForProbe(env, target.level), binary, level: target.level, family: target.family, preload: preloaded }).map((probe, at) => ({
      ...probe,
      log: join(scratch, `tripwire-${at}.log`),
    }));
    for (const probe of probes) writeFileSync(probe.log, "");
    const results = await inBatches(probes, PROBES_AT_ONCE, async (probe) => {
      if (probe.skip) return { ...probe, seen: [], output: "", lines: [] };
      try {
        const run = await runProbe({ ...probe, base: env, binary, binaryArgs, timeoutMs, env: { ...probe.env, ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: probe.log } });
        return { ...probe, ...run, lines: linesOf(probe.log) };
      } catch (err) {
        return { ...probe, seen: [], output: "", lines: [], failed: plainLine(err?.message ?? err) };
      }
    });

    const found = evaluate(results, { expectedMain: settingsFor(env).effortLevel, target });
    return record(env, { version, stamp, leaks: [...new Set([...required, ...found.leaks])], infra: found.infra, details: detailsOf(results) });
  } finally {
    forgetSession(join(scratch, "project"), configDirFor(probeEnv(env)));
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Runs `run` over `items` at most `size` at a time, answering the results in order. */
export async function inBatches(items, size, run) {
  const out = [];
  for (let at = 0; at < items.length; at += size) out.push(...(await Promise.all(items.slice(at, at + size).map(run))));
  return out;
}
