import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copiesDir, copyNameFor, loadedTiers, recordLoaded, syncCopies } from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";
import { holdStatePath } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import {
  decideAgent,
  decidePrompt,
  decideRoutine,
  decideSkill,
  decideWorkflow,
  gateReason,
  promptAnswer,
  toolAnswer,
} from "../plugins/ultracode-anywhere/hooks/hold-rules.mjs";
import { MARK } from "../plugins/ultracode-anywhere/hooks/hold-workflows.mjs";
import { agentText, listing, probeLog, runStages, world, write } from "./hold-fixtures.mjs";
import { needsPosixPermissions } from "./platform.mjs";

/** A hand-made copy of the definition in `file`, where the sync would put it. */
function copyOfFile(env, agentType, file, level = "medium") {
  const name = copyNameFor({ agentType, file }, level);
  write(join(copiesDir(env), `${name}.md`), agentText({ name, description: "d", effort: level, "ultracode-anywhere-copy-of-file": JSON.stringify(file) }));
  return name;
}

/** A world holding the agents most cases route between. */
function fixture(t) {
  const w = world(t);
  const { cfg, plugin, project, env } = w;
  w.slowCopy = copyOfFile(env, "slow", write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" })));
  write(join(cfg, "agents", "fast.md"), agentText({ name: "fast", description: "d", effort: "med" }));
  write(join(cfg, "agents", "orphan.md"), agentText({ name: "orphan", description: "d" }));
  write(join(cfg, "agents", "Explore.md"), agentText({ name: "Explore", description: "d", effort: "medium" }));
  w.verifierCopy = copyOfFile(env, "kit:verifier", write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d" })));
  write(join(project, ".claude", "agents", "slow.md"), agentText({ name: "slow", description: "project copy", effort: "medium" }));
  write(join(plugin, "workflows", "sweep.js"), 'export const meta = { name: "sweep", description: "x" }\nreturn await agent("go", { effort: "high" })\n');
  w.ctx = (root = w.root, extra = {}) => ({ env, root, cwd: root, session: "s-1", level: "medium", ...extra });
  recordLoaded(env, "s-1", w.root);
  return w;
}

// --- Agent calls -----------------------------------------------------------------

test("an Agent call routes to a definition at the level or is refused", (t) => {
  const { project, ctx, slowCopy, verifierCopy } = fixture(t);

  assert.equal(decideAgent({ subagent_type: "fast" }, ctx()), null, "med is medium");
  assert.equal(decideAgent({ subagent_type: "Explore" }, ctx()), null);
  assert.equal(decideAgent({ subagent_type: "slow", prompt: "p" }, ctx()).updatedInput.subagent_type, slowCopy);
  assert.equal(decideAgent({ subagent_type: "slow" }, ctx(project)), null, "the project's own definition at medium answers there");
  assert.equal(decideAgent({ subagent_type: "kit:verifier" }, ctx()).updatedInput.subagent_type, verifierCopy);
  assert.equal(decideAgent({ subagent_type: "verifier" }, ctx()).updatedInput.subagent_type, verifierCopy);
  assert.match(decideAgent({ subagent_type: "orphan" }, ctx()).deny, /has no copy held to medium/);
  assert.match(decideAgent({ subagent_type: "Plan" }, ctx()).deny, /has no copy held to medium/);
  assert.match(decideAgent({ subagent_type: "fork" }, ctx()).deny, /fork/);
  assert.match(decideAgent({ subagent_type: "nobody" }, ctx()).deny, /No agent definition named nobody/);
});

test("an Agent call always names its type, drops its model, and keeps a remote agent on this machine", (t) => {
  const { root, cfg, ctx } = fixture(t);

  assert.match(decideAgent({ prompt: "p" }, ctx()).deny, /general-purpose would not run at medium/, "a built-in with no shadow at the level cannot be held");
  assert.doesNotMatch(decideAgent({ prompt: "p" }, ctx()).deny, /or general-purpose/, "general-purpose is refused the same way until its shadow is loaded");
  write(join(cfg, "agents", "general-purpose.md"), agentText({ name: "general-purpose", description: "d", effort: "medium", "ultracode-anywhere-shadow-of": "9.9.9" }));
  assert.equal(decideAgent({ prompt: "p" }, ctx()).updatedInput.subagent_type, "general-purpose");
  assert.equal(decideAgent({ subagent_type: "fast", model: "sonnet" }, ctx()).updatedInput.model, undefined);
  assert.equal("isolation" in decideAgent({ subagent_type: "fast", isolation: "remote" }, ctx()).updatedInput, false);
  mkdirSync(join(root, "repo", ".git"), { recursive: true });
  assert.equal(decideAgent({ subagent_type: "fast", isolation: "remote" }, ctx(join(root, "repo"))).updatedInput.isolation, "worktree");
  assert.equal(decideAgent({ subagent_type: "fast", isolation: "worktree" }, ctx()), null, "a local worktree is left as asked");
});

test("an Agent call that would start a teammate is refused", (t) => {
  const { ctx } = fixture(t);

  assert.match(decideAgent({ subagent_type: "fast", name: "helper" }, ctx()).deny, /teammate/);
  assert.equal(decideAgent({ subagent_type: "fast", name: "" }, ctx()), null);
});

test("a project's agent off the level is refused with what to set in it, and a user's agent is routed to its copy", (t) => {
  const { cfg, root, project, env } = world(t);
  const userFile = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "user", effort: "xhigh" }, "USER"));
  write(join(project, ".claude", "agents", "slow.md"), agentText({ name: "slow", description: "project", effort: "xhigh" }, "PROJECT"));
  syncCopies({ env, level: "medium" });

  assert.match(decideAgent({ subagent_type: "slow" }, { env, root: project, level: "medium" }).deny, /The project's agent slow runs at xhigh effort.*Set `effort: medium` in its file/);
  assert.equal(decideAgent({ subagent_type: "slow" }, { env, root, level: "medium" }).updatedInput.subagent_type, copyNameFor({ agentType: "slow", file: userFile }, "medium"));
});

test("with no transcript to read, an Agent call is held to the agents recorded as its session started, and a session with no record is refused", (t) => {
  const { cfg, root, env } = world(t);
  const call = (session) => toolAnswer({ tool_name: "Agent", tool_input: { subagent_type: "general-purpose" }, cwd: root, session_id: session }, env);
  recordLoaded(env, "before", root);
  write(join(cfg, "agents", "general-purpose.md"), agentText({ name: "general-purpose", description: "d", effort: "medium", "ultracode-anywhere-shadow-of": "9.9.9" }));
  recordLoaded(env, "after", root);

  assert.match(call("before").hookSpecificOutput.permissionDecisionReason, /general-purpose would not run at medium/, "the shadow was written after that session's record");
  assert.deepEqual(call("after"), {});
  assert.match(call("unrecorded").hookSpecificOutput.permissionDecisionReason, /not recorded when it started.*Start a new session/);
  assert.match(call(undefined).hookSpecificOutput.permissionDecisionReason, /Start a new session/);
});

test("an Agent call and a forked skill are held to the agents the transcript lists, a copy upkeep wrote after the record among them", (t) => {
  const { plugin, root, env, transcript } = world(t);
  const verifier = write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d" }));
  recordLoaded(env, "s-1", root);
  syncCopies({ env, level: "medium" });
  const copy = copyNameFor({ agentType: "kit:verifier", file: verifier }, "medium");
  write(join(plugin, "skills", "light", "SKILL.md"), agentText({ name: "light", description: "d", context: "fork", agent: copy }));
  const answer = (tool_name, tool_input, transcriptPath) => toolAnswer({ tool_name, tool_input, cwd: root, session_id: "s-1", ...(transcriptPath && { transcript_path: transcriptPath }) }, env).hookSpecificOutput;

  assert.match(answer("Agent", { subagent_type: "kit:verifier" }).permissionDecisionReason, /has no copy held to medium/, "the record alone predates the copy");
  assert.match(answer("Skill", { skill: "kit:light" }).permissionDecisionReason, new RegExp(`forks into ${copy}`));
  listing(transcript, { added: ["kit:verifier", copy], initial: true });
  assert.equal(answer("Agent", { subagent_type: "kit:verifier" }, transcript).updatedInput.subagent_type, copy);
  assert.equal(answer("Skill", { skill: "kit:light" }, transcript), undefined);
});

test("a definition written mid-session in a higher tier does not hide the one the session started with", (t) => {
  const { cfg, project, env, transcript } = world(t);
  const foo = write(join(cfg, "agents", "foo.md"), agentText({ name: "foo", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", project);
  syncCopies({ env, level: "medium" });
  const fooCopy = copyNameFor({ agentType: "foo", file: foo }, "medium");
  listing(transcript, { added: ["foo", fooCopy], initial: true });
  write(join(project, ".claude", "agents", "foo.md"), agentText({ name: "foo", description: "d", effort: "medium" }));

  const decided = decideAgent({ subagent_type: "foo" }, { env, root: project, level: "medium", tiers: loadedTiers(env, "s-1", { root: project, transcriptPath: transcript }) });
  assert.equal(decided.updatedInput.subagent_type, fooCopy);
});

test("a built-in whose shadow was written after the record is refused until a new session records it", (t) => {
  const { cfg, root, env, transcript } = world(t);
  recordLoaded(env, "s-1", root);
  write(join(cfg, "agents", "general-purpose.md"), agentText({ name: "general-purpose", description: "d", effort: "medium", "ultracode-anywhere-shadow-of": "9.9.9" }));
  listing(transcript, { added: ["general-purpose"], initial: true });

  const decided = decideAgent({ prompt: "p" }, { env, root, level: "medium", tiers: loadedTiers(env, "s-1", { root, transcriptPath: transcript }) });
  assert.match(decided.deny, /general-purpose would not run at medium.*start a new session/);
});

test("a forked skill is checked against the agents recorded as its session started, and a session with no record is refused", (t) => {
  const { cfg, plugin, root, env } = world(t);
  write(join(plugin, "skills", "light", "SKILL.md"), agentText({ name: "light", description: "d", context: "fork" }));
  recordLoaded(env, "s-1", root);
  write(join(cfg, "agents", "general-purpose.md"), agentText({ name: "general-purpose", description: "d", effort: "medium", "ultracode-anywhere-shadow-of": "9.9.9" }));
  const skill = (session) => toolAnswer({ tool_name: "Skill", tool_input: { skill: "kit:light" }, cwd: root, session_id: session }, env);

  assert.match(skill("s-1").hookSpecificOutput.permissionDecisionReason, /forks into general-purpose, which would not run at medium/);
  assert.match(skill("unrecorded").hookSpecificOutput.permissionDecisionReason, /not recorded when it started/);
  recordLoaded(env, "s-2", root);
  assert.deepEqual(skill("s-2"), {});
});

test("a Workflow call carrying a script as well as a path or a name keeps only the script it was held to", (t) => {
  const { ctx } = fixture(t);
  const script = 'export const meta = { name: "w", description: "d" }\nreturn await agent("a", { effort: "high" })\n';

  const decided = decideWorkflow({ script, scriptPath: "/elsewhere.js", name: "kit:sweep" }, ctx());
  assert.equal("scriptPath" in decided.updatedInput, false);
  assert.equal("name" in decided.updatedInput, false);
});

test("a copy the call is routed to must be the definition its name resolves to", (t) => {
  const { root, slowCopy, ctx } = fixture(t);
  write(join(root, ".claude", "agents", "impostor.md"), agentText({ name: slowCopy, description: "d", effort: "medium" }));

  assert.match(decideAgent({ subagent_type: "slow" }, ctx()).deny, /is not the copy/);
});

test("two definitions of one type in one tier that disagree on effort are held by the one off the level", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "a.md"), agentText({ name: "twin", description: "d", effort: "medium" }));
  const off = write(join(cfg, "agents", "b.md"), agentText({ name: "twin", description: "d", effort: "xhigh" }));
  syncCopies({ env, level: "medium" });

  assert.equal(decideAgent({ subagent_type: "twin" }, { env, root, level: "medium" }).updatedInput.subagent_type, copyNameFor({ agentType: "twin", file: off }, "medium"));
});

// --- Workflow calls --------------------------------------------------------------

test("a Workflow call is rewritten whether inline, by path or by plugin name", async (t) => {
  const { root, transcript, ctx } = fixture(t);
  const at = ctx(root, { transcriptPath: transcript });

  const inline = decideWorkflow({ script: 'export const meta = { name: "i", description: "d" }\nreturn 1', args: { a: 1 } }, at);
  assert.ok(inline.updatedInput.script.includes(MARK));
  assert.deepEqual(inline.updatedInput.args, { a: 1 });

  const named = decideWorkflow({ name: "kit:sweep" }, at).updatedInput;
  assert.equal(named.name, undefined);
  assert.deepEqual((await runStages(named.script)).map((o) => o.effort), ["medium"]);

  writeFileSync(join(root, "wf.js"), 'export const meta = { name: "f", description: "d" }\nreturn 1');
  const byPath = decideWorkflow({ scriptPath: "wf.js" }, at).updatedInput;
  assert.ok(byPath.script.includes(MARK));
  assert.equal(byPath.scriptPath, undefined);

  assert.match(decideWorkflow({ name: "kit:missing" }, at).deny, /Could not find the script for workflow kit:missing/);
  assert.equal(readdirSync(join(transcript.replace(/\.jsonl$/, ""), "workflows", "ultracode-anywhere")).length, 1);
});

test("a Workflow call the hook cannot rewrite is refused", (t) => {
  const { root, transcript, ctx } = fixture(t);
  const at = ctx(root, { transcriptPath: transcript });

  assert.match(decideWorkflow({ script: "return await agent('a', { effort: 'xhigh' })" }, at).deny, /meta/);
  assert.match(decideWorkflow({ scriptPath: join(root, "missing.js") }, at).deny, /could not be read/);
  assert.match(decideWorkflow({ resumeFromRunId: "wf_abc" }, at).deny, /names no script, scriptPath or name/);
});

test("a script that already carries the prelude for this level is left as it is", (t) => {
  const { root, transcript, ctx } = fixture(t);
  const at = ctx(root, { transcriptPath: transcript });
  const once = decideWorkflow({ script: 'export const meta = { name: "i", description: "d" }\nreturn 1' }, at).updatedInput.script;

  assert.equal(decideWorkflow({ script: once }, at), null);
});

// --- RemoteTrigger ---------------------------------------------------------------

test("a routine call that would start or change a cloud session is refused, and one that reads routines goes through", () => {
  for (const action of ["create", "update", "run", "create_webhook_trigger", "something-new", undefined]) {
    assert.match(decideRoutine({ action }).deny, /cloud/, String(action));
  }
  for (const action of ["list", "get", "list_runs", "get_run_log"]) assert.equal(decideRoutine({ action }), null, action);
});

// --- Skills ----------------------------------------------------------------------

test("a forked skill off the level is refused, and one at the level or inline goes through", (t) => {
  const { plugin, ctx } = fixture(t);
  write(join(plugin, "skills", "heavy", "SKILL.md"), agentText({ name: "heavy", description: "d", context: "fork", effort: "high" }));
  write(join(plugin, "skills", "light", "SKILL.md"), agentText({ name: "light", description: "d", context: "fork" }));
  write(join(plugin, "skills", "via", "SKILL.md"), agentText({ name: "via", description: "d", context: "fork", agent: "kit:verifier" }));
  write(join(plugin, "skills", "onto", "SKILL.md"), agentText({ name: "onto", description: "d", context: "fork", agent: "fast" }));
  write(join(plugin, "skills", "inline", "SKILL.md"), agentText({ name: "inline", description: "d", effort: "high" }));
  write(join(plugin, "skills", "same", "SKILL.md"), agentText({ name: "same", description: "d", context: "fork", effort: "medium", model: "inherit" }));
  write(join(plugin, "skills", "cheap", "SKILL.md"), agentText({ name: "cheap", description: "d", context: "fork", effort: "medium", model: "sonnet" }));

  assert.match(decideSkill({ skill: "kit:heavy" }, ctx()).deny, /runs as a forked subagent at high effort, and every spawn must run at medium/);
  assert.match(decideSkill({ skill: "kit:via" }, ctx()).deny, /forks into kit:verifier/);
  assert.equal(decideSkill({ skill: "kit:onto" }, ctx()), null, "its agent is at the level already");
  assert.match(decideSkill({ skill: "kit:light" }, ctx()).deny, /forks into general-purpose/, "no shadow of general-purpose in this config");
  assert.equal(decideSkill({ skill: "kit:inline" }, ctx()), null);
  assert.match(decideSkill({ skill: "kit:same" }, ctx()).deny, /inherit/);
  assert.equal(decideSkill({ skill: "kit:cheap" }, ctx()), null, "the forced subagent model replaces a skill's own");
  assert.equal(decideSkill({ skill: "nobody:knows" }, ctx()), null);
});

test("every forked skill that answers to a name must run at the level, whichever is found first", (t) => {
  const { cfg, project, ctx } = fixture(t);
  write(join(cfg, "skills", "deploy", "SKILL.md"), agentText({ name: "deploy", description: "d", context: "fork", effort: "medium" }));
  write(join(project, ".claude", "skills", "deploy", "SKILL.md"), agentText({ name: "deploy", description: "d", context: "fork", effort: "xhigh" }));

  assert.match(decideSkill({ skill: "deploy" }, ctx(project)).deny, /xhigh/);
  assert.match(decidePrompt("/deploy now", ctx(project)).block, /xhigh/);
});

test("the bundled code review forks at the level, whatever effort it was asked for", (t) => {
  const { ctx } = fixture(t);
  const review = (skill, args) => decideSkill({ skill, ...(args === undefined ? {} : { args }) }, ctx());

  assert.equal(review("code-review", "high src/auth").updatedInput.args, "medium src/auth");
  assert.equal(review("review", "ultra").updatedInput.args, "medium");
  assert.equal(review("code-review").updatedInput.args, "medium");
  assert.equal(review("code-review", "src/auth").updatedInput.args, "medium src/auth");
  assert.equal(review("code-review", "--fix Xhigh src").updatedInput.args, "medium --fix src", "the effort word sits after the flags the review drops");
  assert.equal(review("code-review", "medium src/auth"), null);
  assert.match(review("ultrareview").deny, /cloud/);
});

test("/code-review and /review are held even when a skill of your own takes the name", (t) => {
  const { cfg, project, ctx } = fixture(t);
  const own = write(join(project, ".claude", "skills", "code-review", "SKILL.md"), agentText({ name: "code-review", description: "d" }));
  write(join(cfg, "skills", "review", "SKILL.md"), "A skill with no frontmatter.\n");

  assert.match(decidePrompt("/code-review xhigh", ctx(project)).block, /xhigh/);
  assert.equal(decideSkill({ skill: "code-review", args: "xhigh" }, ctx(project)).updatedInput.args, "medium");
  assert.match(decidePrompt("/review xhigh", ctx(project)).block, /xhigh/);
  writeFileSync(own, agentText({ name: "code-review", description: "d", context: "fork", effort: "high" }));
  assert.match(decideSkill({ skill: "code-review", args: "medium" }, ctx(project)).deny, /high/);
});

// --- typed prompts ---------------------------------------------------------------

test("a typed code review off the level is stopped, including one that would reuse a stored effort", (t) => {
  const { cfg, ctx } = fixture(t);
  const prompt = (text) => decidePrompt(text, ctx());

  assert.match(prompt("/code-review high src/").block, /Type \/code-review medium src\//);
  assert.match(prompt("/code-review ultra").block, /cloud/);
  assert.equal(prompt("/code-review medium src/"), null);
  assert.equal(prompt("/code-review --fix med src/"), null);
  assert.match(prompt("/code-review src/").block, /the session's effort/);
  write(join(cfg, "..", ".claude.json"), JSON.stringify({ codeReviewLastEffort: "medium" }));
  assert.match(prompt("/code-review src/").block, /the session's effort/, "the global config sits beside the config directory only without CLAUDE_CONFIG_DIR");
  write(join(cfg, ".claude.json"), JSON.stringify({ codeReviewLastEffort: "medium" }));
  assert.equal(prompt("/review src/"), null);
  write(join(cfg, ".claude.json"), JSON.stringify({ codeReviewLastEffort: "high" }));
  assert.match(prompt("/review src/").block, /high effort, the last one used/);
  assert.match(prompt("/ultrareview 123").block, /cloud/);
});

test("inside a claude started from a held session's shell, /model and /effort are stopped", (t) => {
  const { env, root } = fixture(t);

  assert.equal(decidePrompt("/effort high", { env, root, level: "medium" }), null, "the main session may change its own");
  const child = { env: { ...env, ULTRACODE_ANYWHERE_HELD_CHILD: "1" }, root, level: "medium" };
  assert.match(decidePrompt("/effort high", child).block, /medium/);
  assert.match(decidePrompt("/model sonnet", child).block, /medium/);
});

test("a forked skill typed as a command is stopped, and only a prompt that opens with one counts", (t) => {
  const { plugin, ctx } = fixture(t);
  write(join(plugin, "skills", "heavy", "SKILL.md"), agentText({ name: "heavy", description: "d", context: "fork", effort: "high" }));

  assert.match(decidePrompt("/kit:heavy on these files", ctx()).block, /high/);
  assert.match(decidePrompt("  \n/kit:heavy", ctx()).block, /high/);
  assert.equal(decidePrompt("please run /kit:heavy later", ctx()), null);
  assert.equal(decidePrompt("/unknown-command", ctx()), null);
  assert.equal(decidePrompt("plain text", ctx()), null);
  assert.equal(decidePrompt(undefined, ctx()), null);
});

// --- the gate --------------------------------------------------------------------

test("a main-loop leak from a record no control run judged refuses nothing, and one a control judged refuses", (t) => {
  const { env } = fixture(t);
  const at = { ...env, CLAUDE_CODE_EXECPATH: "/versions/9.9.9" };
  const lowered = "fork: the main loop was lowered to medium";
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: [lowered], infra: [] }));
  assert.equal(gateReason(at), null, "a main-loop leak no control run judged refuses nothing");
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: [lowered, "x broke"], infra: [] }));
  assert.doesNotMatch(gateReason(at), /lowered/);
  assert.match(gateReason(at), /x broke/, "its other leaks still refuse");
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: [lowered], infra: [], mainLoopJudge: "settings" }));
  assert.equal(gateReason(at), null, "a mark with any value but the control's is not trusted");
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: [lowered], infra: [], mainLoopJudge: "control" }));
  assert.match(gateReason(at), /fork: the main loop was lowered to medium/);
});

test("once the self-check has recorded a leak on the running build, spawns are refused", (t) => {
  const { root, env } = fixture(t);
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: ["x broke"], infra: [] }));
  const event = { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "fast" }, cwd: root, session_id: "s-1" };
  const at = (extra) => ({ ...env, CLAUDE_CODE_EXECPATH: "/versions/9.9.9", ...extra });

  assert.match(gateReason(at()), /x broke/);
  assert.match(toolAnswer(event, at()).hookSpecificOutput.permissionDecisionReason, /x broke/);
  assert.deepEqual(toolAnswer({ ...event, tool_name: "Read" }, at()), {});
  assert.match(toolAnswer(event, at({ ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" })).hookSpecificOutput.permissionDecisionReason, /x broke/, "the flag and a local base URL alone open nothing");
  const probe = at({ ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: probeLog(env) });
  recordLoaded(probe, "s-1", root);
  assert.deepEqual(toolAnswer(event, probe), {}, "a probe with the check's own log is not gated");
  assert.deepEqual(toolAnswer(event, at({ CLAUDE_CODE_EXECPATH: "/versions/9.9.10" })), {}, "a leak on another build does not gate this one");
  assert.equal(gateReason({ ...env, AI_AGENT: "claude-code_9-9-9_agent" }) !== null, true, "AI_AGENT names the build where the exec path does not");
});

test("only a self-check probe on its local stand-in can turn routing off, to prove the tripwire", (t) => {
  const { root, env, slowCopy } = fixture(t);
  const event = { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "slow" }, cwd: root, session_id: "s-1" };
  const unrouted = { ...env, ULTRACODE_ANYWHERE_HOLD_CHECK_UNROUTED: "1", ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" };

  assert.equal(toolAnswer(event, unrouted).hookSpecificOutput.updatedInput.subagent_type, slowCopy, "a settings file can set these three, so they open nothing");
  assert.deepEqual(toolAnswer(event, { ...unrouted, ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: probeLog(env) }), {});
  const lookalike = write(join(mkdtempSync(join(root, "ultracode-hold-check-")), "tripwire.log"), "");
  assert.equal(toolAnswer(event, { ...unrouted, ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: lookalike }).hookSpecificOutput.updatedInput.subagent_type, slowCopy, "a check-named directory a repository could carry opens nothing outside the temp directory");
  const outside = write(join(root, "not-a-check-dir", "log"), "");
  assert.equal(toolAnswer(event, { ...unrouted, ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: outside }).hookSpecificOutput.updatedInput.subagent_type, slowCopy, "a log outside a directory the check made opens nothing");
});

test("a configuration missing a setting the hold needs refuses spawns and names the setting", (t) => {
  const { root, env, plugin } = fixture(t);
  write(join(plugin, "skills", "heavy", "SKILL.md"), agentText({ name: "heavy", description: "d", context: "fork", effort: "high" }));
  const gap = { ...env, CLAUDE_CODE_FORK_SUBAGENT: "1" };
  const agent = toolAnswer({ tool_name: "Agent", tool_input: { subagent_type: "fast" }, cwd: root }, gap);

  assert.match(agent.hookSpecificOutput.permissionDecisionReason, /CLAUDE_CODE_FORK_SUBAGENT is not 0/);
  assert.match(toolAnswer({ tool_name: "Skill", tool_input: { skill: "code-review", args: "high" }, cwd: root }, gap).hookSpecificOutput.permissionDecisionReason, /CLAUDE_CODE_FORK_SUBAGENT/);
  assert.match(promptAnswer({ prompt: "/code-review", cwd: root }, gap).reason, /CLAUDE_CODE_FORK_SUBAGENT/);
  assert.deepEqual(toolAnswer({ tool_name: "Skill", tool_input: { skill: "kit:inline-or-missing" }, cwd: root }, gap), {}, "a skill that spawns nothing is left alone");
  assert.deepEqual(toolAnswer({ tool_name: "Read", tool_input: {}, cwd: root }, gap), {});
});

// --- the answers -----------------------------------------------------------------

test("the tool answer carries a routed input, a refusal, or nothing, in the shape PreToolUse reads", (t) => {
  const { root, env, slowCopy } = fixture(t);
  const at = (input, tool = "Agent") => toolAnswer({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd: root, session_id: "s-1" }, env);

  assert.deepEqual(at({ subagent_type: "slow", prompt: "p" }), { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { subagent_type: slowCopy, prompt: "p" } } });
  assert.deepEqual(at({ subagent_type: "fork" }).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(at({ subagent_type: "fast" }), {});
  assert.deepEqual(at({ action: "list" }, "RemoteTrigger"), {});
  assert.deepEqual(at({ subagent_type: "slow" }, "Task").hookSpecificOutput.updatedInput.subagent_type, slowCopy, "the old name of the Agent tool is held the same way");
  assert.deepEqual(toolAnswer({ tool_name: "Agent", tool_input: { subagent_type: "slow" }, cwd: root }, { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" }), {}, "with the hold off nothing is decided");
});

test("project agents come from the session's project directory, wherever the call runs", (t) => {
  const { root, project, env } = world(t);
  write(join(project, ".claude", "agents", "local.md"), agentText({ name: "local", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", project);

  const answer = toolAnswer({ tool_name: "Agent", tool_input: { subagent_type: "local" }, cwd: join(root, "somewhere-else"), session_id: "s-1" }, { ...env, CLAUDE_PROJECT_DIR: project });
  assert.match(answer.hookSpecificOutput.permissionDecisionReason, /The project's agent local runs at xhigh effort/);
});

test("the prompt answer blocks in the shape UserPromptSubmit reads, and says nothing otherwise", (t) => {
  const { root, env } = fixture(t);

  assert.deepEqual(promptAnswer({ prompt: "/ultrareview", cwd: root }, env).decision, "block");
  assert.deepEqual(promptAnswer({ prompt: "hello", cwd: root }, env), {});
  assert.deepEqual(promptAnswer({ prompt: "/ultrareview", cwd: root }, { ...env, ULTRACODE_ANYWHERE_SPAWN_EFFORT: "cheap" }), {});
});

test("a copy the call is routed to is checked against every file of its name in the user's agents, whichever sorts first", (t) => {
  const { cfg, slowCopy, ctx } = fixture(t);
  write(join(cfg, "agents", "zzz.md"), agentText({ name: slowCopy, description: "d", effort: "xhigh" }));

  assert.match(decideAgent({ subagent_type: "slow" }, ctx()).deny, /is not the copy/);
});

test("a forked skill's agent is read the way a spawn's is, so a twin off the level refuses it", (t) => {
  const { cfg, plugin, root, env } = world(t);
  write(join(cfg, "agents", "a.md"), agentText({ name: "twin", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "b.md"), agentText({ name: "twin", description: "d", effort: "xhigh" }));
  write(join(plugin, "skills", "pair", "SKILL.md"), agentText({ name: "pair", description: "d", context: "fork", agent: "twin" }));
  recordLoaded(env, "s-t", root);

  assert.match(decideSkill({ skill: "kit:pair" }, { env, root, cwd: root, session: "s-t", level: "medium" }).deny, /forks into twin/);
});

test("a forked skill that names its effort twice is refused, since no one can say which the build takes", (t) => {
  const { plugin, ctx } = fixture(t);
  write(join(plugin, "skills", "twice", "SKILL.md"), "---\nname: twice\ndescription: d\ncontext: fork\neffort: xhigh\neffort: medium\n---\nbody\n");

  assert.match(decideSkill({ skill: "kit:twice" }, ctx()).deny, /an effort it names twice/);
});

test("an agent of a plugin only a project's settings turn on is refused with where to turn it on, since its copy would reach every project", (t) => {
  const { cfg, plugin, project, env } = world(t);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true } }));
  write(join(project, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true } }));
  write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d", effort: "high" }));

  assert.match(decideAgent({ subagent_type: "kit:verifier" }, { env, root: project, level: "medium" }).deny, /only this project's settings turn on/);
});

test("a record in a state directory this account does not own alone is not believed, so its text never reaches the model", needsPosixPermissions, (t) => {
  const { root, env } = fixture(t);
  const loose = join(root, "loose-state");
  write(join(loose, "hold", "verified.json"), JSON.stringify({ version: "9.9.9", ok: false, leaks: ["PLANTED"], infra: [] }));
  chmodSync(loose, 0o755);
  const at = { ...env, ULTRACODE_ANYWHERE_STATE: loose, CLAUDE_CODE_EXECPATH: "/versions/9.9.9" };

  assert.doesNotMatch(gateReason(at) ?? "", /PLANTED/);
  assert.match(gateReason(at) ?? "", /state directory/);
});

test("a project that moves the hold's state has nothing written there, the tripwire's marks included", (t) => {
  const { root, project, env } = world(t);
  const moved = join(project, "st");
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_STATE: moved } }));
  const transcript = write(join(root, "child.jsonl"), "");
  const at = { ...env, ULTRACODE_ANYWHERE_STATE: moved, ULTRACODE_ANYWHERE_HELD_CHILD: "1" };

  assert.deepEqual(toolAnswer({ tool_name: "Read", tool_input: {}, cwd: project, session_id: "s-1", transcript_path: transcript, effort: { level: "medium" } }, at), {});
  assert.equal(existsSync(moved), false);
});

test("a workflow's own stages run in a worktree inside a git repository and with no isolation outside one", (t) => {
  const base = mkdtempSync(join(tmpdir(), "ultracode-isolation-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [plain, repo] = [join(base, "plain"), join(base, "repo")];
  mkdirSync(plain);
  mkdirSync(join(repo, ".git"), { recursive: true });
  // A home above neither, since the walk for a git directory stops at the home.
  const env = { HOME: join(base, "home") };
  const script = 'export const meta = { name: "i", description: "d" }\nreturn 1';

  const outside = decideWorkflow({ script }, { env, root: plain, cwd: plain, level: "medium" }).updatedInput.script;
  const inside = decideWorkflow({ script }, { env, root: repo, cwd: repo, level: "medium" }).updatedInput.script;
  assert.match(outside, /delete o\.isolation/);
  assert.match(inside, /o\.isolation = "worktree"/);
});
