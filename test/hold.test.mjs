import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { recordLoaded } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { opensWithSlash, refusal, switchedOn } from "../plugins/ultracode-anywhere/hooks/hold.mjs";
import { hostEnv } from "./host-env.mjs";
import { agentText, probeLog, world, write } from "./hold-fixtures.mjs";
import { needsPosixPaths } from "./platform.mjs";

const HOOKS = fileURLToPath(new URL("../plugins/ultracode-anywhere/hooks/", import.meta.url));

/** One run of the entry the way Claude Code runs it: node, the file, the verb, a payload on stdin. */
function fire(entry, verb, payload, env) {
  const result = spawnSync(process.execPath, [entry, verb], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...hostEnv(), ...env },
    timeout: 30000,
  });
  return { status: result.status, stderr: result.stderr, answer: result.stdout ? JSON.parse(result.stdout) : null };
}

/** The hooks directory copied somewhere a case may break a file in. */
function brokenCopy(t, file, text) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-hold-broken-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(HOOKS, dir, { recursive: true });
  writeFileSync(join(dir, file), text);
  return join(dir, "hold.mjs");
}

test("with the switch unset the entry answers an empty object and decides nothing", (t) => {
  const { root, env } = world(t);
  const off = { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" };

  assert.deepEqual(fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Agent", tool_input: { subagent_type: "fork" }, cwd: root }, off), { status: 0, stderr: "", answer: {} });
  assert.deepEqual(fire(join(HOOKS, "hold.mjs"), "spawn-prompt", { prompt: "/ultrareview", cwd: root }, off).answer, {});
});

test("a hold the user's own settings turn on is decided where a project's settings blank the switch", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true }, env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));

  const answer = fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Agent", tool_input: { subagent_type: "fork" }, cwd: root }, { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }).answer;
  assert.equal(answer.hookSpecificOutput.permissionDecision, "deny");
});

test("with the switch set the entry routes, refuses and blocks through the rules", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "fast.md"), agentText({ name: "fast", description: "d", effort: "medium" }));
  recordLoaded(env, "s-1", root);

  assert.equal(fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Agent", tool_input: { subagent_type: "fork" }, cwd: root, session_id: "s-1" }, env).answer.hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Agent", tool_input: { subagent_type: "fast" }, cwd: root, session_id: "s-1" }, env).answer, {});
  assert.equal(fire(join(HOOKS, "hold.mjs"), "spawn-prompt", { prompt: "/ultrareview", cwd: root }, env).answer.decision, "block");
  assert.deepEqual(fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Bash", agent_id: "a1", effort: { level: "xhigh" }, cwd: root }, env).answer.hookSpecificOutput.permissionDecision, "deny");
});

test("during a self-check the entry logs each call before it answers", (t) => {
  const { root, env } = world(t);
  const log = probeLog(env);
  const probe = { ...env, ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: log, ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" };

  fire(join(HOOKS, "hold.mjs"), "spawn-tool", { tool_name: "Read", effort: { level: "xhigh" }, cwd: root }, probe);
  assert.equal(readFileSync(log, "utf8"), "main xhigh none\n");
});

test("a hold that cannot load refuses spawn tools, subagents and child sessions, and lets the main session work", (t) => {
  const { root, env } = world(t);
  const entry = brokenCopy(t, "hold-rules.mjs", "export const = ;");
  const refused = (payload, extra = {}) => fire(entry, "spawn-tool", { cwd: root, ...payload }, { ...env, ...extra }).answer;

  assert.match(refused({ tool_name: "Agent", tool_input: {} }).hookSpecificOutput.permissionDecisionReason, /The spawn hold could not check this call, so it is refused/);
  assert.equal(refused({ tool_name: "Workflow" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(refused({ tool_name: "Bash", agent_id: "a1" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(refused({ tool_name: "Bash" }, { ULTRACODE_ANYWHERE_HELD_CHILD: "1" }).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(refused({ tool_name: "Bash" }), {}, "the main session's own call goes through");
});

test("a hold that cannot load blocks a prompt that may open with a slash command, and lets any other through", (t) => {
  const { root, env } = world(t);
  const entry = brokenCopy(t, "hold-rules.mjs", "export const = ;");
  const answered = (prompt) => fire(entry, "spawn-prompt", { prompt, cwd: root }, env).answer;

  assert.equal(answered("/code-review high").decision, "block");
  assert.equal(answered("\f\uFEFF /kit:heavy").decision, "block");
  assert.deepEqual(answered("hello /code-review"), {});
  assert.deepEqual(answered("Проверь /etc/hosts"), {}, "a word in any script before the slash is a word");
});

test("a payload that cannot be read at all is still answered", (t) => {
  const { env } = world(t);

  for (const verb of ["spawn-tool", "spawn-prompt"]) {
    const run = fire(join(HOOKS, "hold.mjs"), verb, "{not json", env);
    assert.equal(run.status, 0, verb);
    assert.equal(run.stderr, "", verb);
    assert.deepEqual(run.answer, {}, verb);
  }
});

test("an entry reached through a symlinked plugin directory still decides", needsPosixPaths, (t) => {
  const { root, env } = world(t);
  const link = join(mkdtempSync(join(tmpdir(), "ultracode-hold-link-")), "hooks");
  t.after(() => rmSync(join(link, ".."), { recursive: true, force: true }));
  symlinkSync(HOOKS, link);

  assert.equal(fire(join(link, "hold.mjs"), "spawn-tool", { tool_name: "Agent", tool_input: { subagent_type: "fork" }, cwd: root }, env).answer.hookSpecificOutput.permissionDecision, "deny");
});

test("the refusal a broken hold gives is decided from the raw payload and the verb alone", () => {
  const err = new Error("boom");

  assert.deepEqual(refusal("spawn-tool", JSON.stringify({ tool_name: "Read" }), {}, err), {});
  assert.match(refusal("spawn-tool", JSON.stringify({ tool_name: "Skill" }), {}, err).hookSpecificOutput.permissionDecisionReason, /boom/);
  assert.equal(refusal("spawn-prompt", JSON.stringify({ prompt: "/x" }), {}, err).decision, "block");
  assert.deepEqual(refusal("spawn-prompt", "", {}, err), {});
  assert.deepEqual(refusal("something-else", "{}", {}, err), {});
});

test("a prompt may open with a slash command when nothing but marks and spaces come before its first slash", () => {
  for (const prompt of ["/x", "  /x", "\n\t/x", "\uFEFF/x", "\u00A0\u2028/x", "~/notes", "(/tmp)", "🔥 /fix"]) {
    assert.equal(opensWithSlash(prompt), true, JSON.stringify(prompt));
  }
  for (const prompt of ["hello /x", "a/b", "Проверь /etc", "日本語 /src", "1/2 done", "", null, 42]) {
    assert.equal(opensWithSlash(prompt), false, JSON.stringify(prompt));
  }
});

test("the plugin declares the tool hook on every tool call and the prompt hook, each through node with a bound", () => {
  const declared = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8")).hooks;
  const commandsOf = (event) => (declared[event] ?? []).flatMap((group) => group.hooks.map((hook) => ({ matcher: group.matcher, ...hook })));

  const tool = commandsOf("PreToolUse").filter((hook) => hook.command.includes("hold.mjs"));
  assert.deepEqual(tool.map((hook) => [hook.matcher, hook.command]), [[undefined, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/hold.mjs" spawn-tool']], "no matcher, so a tool the hold does not know yet is still read");
  const prompt = commandsOf("UserPromptSubmit").filter((hook) => hook.command.includes("hold.mjs"));
  assert.deepEqual(prompt.map((hook) => hook.command), ['node "${CLAUDE_PLUGIN_ROOT}/hooks/hold.mjs" spawn-prompt']);
  for (const hook of [...tool, ...prompt]) assert.ok(hook.timeout >= 10, `${hook.command} waits on transcripts and files, so it needs a bound past the default`);
});

test("a project that moves the home away from the user's settings does not switch the hold off", (t) => {
  const { cfg, home, root, project, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));
  const moved = { ...env, HOME: join(root, "elsewhere"), USERPROFILE: join(root, "elsewhere"), CLAUDE_CONFIG_DIR: "", ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" };

  assert.equal(switchedOn(moved, { cwd: project }, home), false, "no project names the move, so nothing else is read");
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { HOME: join(root, "elsewhere") } }));
  assert.equal(switchedOn(moved, { cwd: project }, home), true);
  assert.equal(switchedOn({ ...moved, CLAUDE_PROJECT_DIR: project }, { cwd: root }, home), true, "the project is the session's, wherever the call runs");
});

test("the account's own home is read off the account, whatever HOME a project sets", () => {
  const code = `import(${JSON.stringify(pathToFileURL(join(HOOKS, "hold-switch.mjs")).href)}).then((m) => process.stdout.write(m.accountHome()))`;

  const run = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...hostEnv(), HOME: "/nowhere", USERPROFILE: "/nowhere" } });
  assert.notEqual(run.stdout, "/nowhere");
  assert.ok(existsSync(run.stdout), "the account's home is a directory that is there");
});

test("a project that moves the configuration directory to one of its own cannot turn the hold on from there", (t) => {
  const { cfg, home, project, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ env: {} }));
  const theirs = join(project, "cfg");
  write(join(theirs, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" } }));
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_CONFIG_DIR: theirs } }));

  assert.equal(switchedOn({ ...env, CLAUDE_CONFIG_DIR: theirs, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }, { cwd: project }, home), false);
});

test("a project that moves the home keeps the switch a user's own CLAUDE_CONFIG_DIR names, since the project did not set that one", (t) => {
  const { home, root, project, env } = world(t);
  const own = join(root, "own-config");
  write(join(own, "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "medium" } }));
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { HOME: join(project, "elsewhere") } }));

  assert.equal(switchedOn({ ...env, CLAUDE_CONFIG_DIR: own }, { cwd: project }, home), true);
});
