import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { recordLoaded } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { opensWithSlash, refusal, switchedOn } from "../plugins/ultracode-anywhere/hooks/hold.mjs";
import { projectNamesSwitch, projectRedirects } from "../plugins/ultracode-anywhere/hooks/hold-switch.mjs";
import { hostEnv } from "./host-env.mjs";
import { agentText, probeLog, repoWithSub, world, write } from "./hold-fixtures.mjs";
import { needsGitRootLocalSettings, needsPosixPaths } from "./platform.mjs";

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

test("a payload the entry could not read whole is refused as unchecked, never as a spawn past the hold and never rewritten from what was read", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "fast.md"), agentText({ name: "fast", description: "d", effort: "medium" }));
  recordLoaded(env, "s-1", root);
  const big = "x".repeat(1100 * 1024);
  const answered = (verb, payload) => fire(join(HOOKS, "hold.mjs"), verb, { session_id: "s-1", cwd: root, ...payload }, env).answer;
  const reason = (answer) => answer.hookSpecificOutput?.permissionDecisionReason ?? "";

  const written = answered("spawn-tool", { agent_id: "a1", effort: { level: "medium" }, tool_name: "Write", tool_input: { file_path: "/tmp/x", content: big } });
  assert.match(reason(written), /megabyte/);
  assert.doesNotMatch(reason(written), /got past the spawn hold/);
  const spawn = answered("spawn-tool", { effort: { level: "xhigh" }, tool_name: "Agent", tool_input: { description: "d", subagent_type: "fast", model: "sonnet", prompt: big } });
  assert.equal(spawn.hookSpecificOutput?.updatedInput, undefined);
  assert.equal(spawn.hookSpecificOutput?.permissionDecision, "deny");
  assert.deepEqual(answered("spawn-tool", { effort: { level: "xhigh" }, tool_name: "Write", tool_input: { file_path: "/tmp/x", content: big } }), {}, "the main session's own large write goes on");
  assert.equal(answered("spawn-prompt", { prompt: `/code-review max ${big}` }).decision, "block", "a typed command the read cut off is one the hold never checked");
  assert.deepEqual(answered("spawn-prompt", { prompt: `please read this log ${big}` }), {}, "a long prompt that opens with no slash goes on");
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
  // The build sends the prompt last, so a payload cut at the megabyte is cut inside it.
  const cut = (prompt, at) => JSON.stringify({ cwd: "/r", prompt }).slice(0, at);
  assert.equal(refusal("spawn-prompt", cut(`/x${"y".repeat(50)}`, 30), {}, err).decision, "block", "a prompt the read cut off still shows how it opens");
  assert.equal(refusal("spawn-prompt", cut("/a\\b", 25), {}, err).decision, "block", "cut in the middle of an escape");
  assert.equal(refusal("spawn-prompt", '{"cwd":"/r","prompt":"/\\u00e9 more"}'.slice(0, 27), {}, err).decision, "block", "cut inside a unicode escape");
  assert.deepEqual(refusal("spawn-prompt", cut(`hello ${"y".repeat(50)}`, 30), {}, err), {});
  const nested = `{"cwd":"/r","prompt":"/x go","meta":{"notes":"${"y".repeat(50)}`;
  assert.equal(refusal("spawn-prompt", nested, {}, err).decision, "block", "a field after the prompt that holds an object still leaves the prompt's opening to read");
  assert.equal(refusal("spawn-prompt", `{"cwd":"/r","prompt":"/x \\"quoted\\" go","tail":[1,2`, {}, err).decision, "block", "an escaped quote inside the prompt does not end it");
  assert.deepEqual(refusal("spawn-prompt", `{"cwd":"/r","prompt":"hello /x","meta":{"notes":"${"y".repeat(50)}`, {}, err), {}, "a prompt that opens with a word goes on");
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

test("a switch or a redirect the git root's local settings set counts for a session below the root", needsGitRootLocalSettings, (t) => {
  const { cfg, home, project, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ env: {} }));
  write(join(home, "work", ".git", "HEAD"), "ref: refs/heads/main\n");
  write(join(home, "work", ".claude", "settings.local.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low", HOME: join(project, "elsewhere") } }));

  assert.equal(projectNamesSwitch(project), true);
  assert.deepEqual(projectRedirects(project), ["HOME"]);
  assert.equal(switchedOn({ ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "low" }, { cwd: project }, home), false);
});

test("the account's own home is read off the account, whatever HOME a project sets", () => {
  const code = `import(${JSON.stringify(pathToFileURL(join(HOOKS, "hook-io.mjs")).href)}).then((m) => process.stdout.write(m.accountHome()))`;

  const run = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...hostEnv(), HOME: "/nowhere", USERPROFILE: "/nowhere" } });
  assert.notEqual(run.stdout, "/nowhere");
  assert.ok(existsSync(run.stdout), "the account's home is a directory that is there");
});

test("a project whose root local settings set the variable the preload writes is refused from a directory below it", needsGitRootLocalSettings, (t) => {
  const { repo, sub } = repoWithSub(t);
  write(join(repo, ".claude", "settings.local.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_REPLACED_EFFORT: "high" } }));

  assert.deepEqual(projectRedirects(sub), ["ULTRACODE_ANYWHERE_REPLACED_EFFORT"]);
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
