import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { holdStatePath, holdTarget } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import { lastAssistantModel, logLine, subagentModel, subagentTranscripts, verdict } from "../plugins/ultracode-anywhere/hooks/hold-tripwire.mjs";
import { world, write } from "./hold-fixtures.mjs";

const assistant = (model, text = "") => `${JSON.stringify({ type: "assistant", message: { model, content: text ? [{ type: "text", text }] : [] } })}\n`;

function judge(event, env) {
  return verdict(event, { env, target: holdTarget(env) });
}

test("the main session's own calls are never judged", (t) => {
  const { env } = world(t);

  assert.equal(judge({ tool_name: "Bash", effort: { level: "xhigh" } }, env), "allow");
});

test("a subagent at the level acts, and one at any other level or at none is stopped", (t) => {
  const { env } = world(t);

  assert.equal(judge({ tool_name: "Bash", agent_id: "a1", effort: { level: "medium" } }, env), "allow");
  assert.match(judge({ tool_name: "Bash", agent_id: "a1", effort: { level: "xhigh" } }, env), /This subagent is running at xhigh effort, and every spawned agent must run at medium/);
  assert.match(judge({ tool_name: "Bash", agent_id: "a1" }, env), /running at an unknown effort/);
  assert.match(judge({ tool_name: "Bash", agent_id: "a1", effort: { level: "low" } }, env), /low/, "below the level is not the level either");
});

test("a subagent's own tool input cannot vouch for its effort", (t) => {
  const { env } = world(t);

  assert.notEqual(judge({ agent_id: "a1", effort: { level: "xhigh" }, tool_name: "mcp__x__y", tool_input: { effort: { level: "medium" } } }, env), "allow");
});

test("inside a claude started from a held session's shell, every call is judged against its own transcript", (t) => {
  const { root, env } = world(t);
  const child = { ...env, ULTRACODE_ANYWHERE_HELD_CHILD: "1" };
  const transcript = (model) => write(join(root, `${model}.jsonl`), `${JSON.stringify({ type: "user", message: { content: "hi" } })}\n${assistant(model)}`);

  assert.match(judge({ tool_name: "Bash", effort: { level: "xhigh" } }, child), /This claude, started from another session's shell, is running at xhigh/);
  assert.match(judge({ tool_name: "Bash", effort: { level: "medium" }, transcript_path: transcript("claude-sonnet-5") }, child), /is running claude-sonnet-5, and every spawned agent must run claude-opus-5/);
  assert.equal(judge({ tool_name: "Bash", effort: { level: "medium" }, transcript_path: transcript("claude-opus-5") }, child), "allow");
});

test("a subagent must be on the held model as its own transcript records it", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  const said = (model) => write(join(root, "session", "subagents", "agent-a1.jsonl"), assistant(model));
  const call = { tool_name: "Bash", agent_id: "a1", effort: { level: "medium" }, transcript_path: session };

  said("claude-sonnet-5");
  assert.match(judge(call, env), /claude-sonnet-5/);
  said("claude-opus-5");
  assert.equal(judge(call, env), "allow");
});

test("a workflow stage's transcript sits one level deeper, under its run", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  write(join(root, "session", "subagents", "workflows", "wf_run1", "agent-stage1.jsonl"), assistant("claude-sonnet-5"));

  assert.deepEqual(subagentTranscripts({ agent_id: "stage1", transcript_path: session }), [
    join(root, "session", "subagents", "agent-stage1.jsonl"),
    join(root, "session", "subagents", "workflows", "wf_run1", "agent-stage1.jsonl"),
  ]);
  assert.match(judge({ tool_name: "Bash", agent_id: "stage1", effort: { level: "medium" }, transcript_path: session }, env), /claude-sonnet-5/);
  assert.deepEqual(subagentTranscripts({ agent_id: "../x", transcript_path: session }), [], "an agent id is a file name here, and nothing else");
  assert.deepEqual(subagentTranscripts({ agent_id: "a1" }), []);
});

test("a transcript whose last line is larger than one read still yields its model, and a missing one yields none", (t) => {
  const { root } = world(t);
  const big = write(join(root, "big.jsonl"), `${assistant("claude-sonnet-5", "x".repeat(600 * 1024))}${JSON.stringify({ type: "user", message: {} })}\n`);

  assert.equal(lastAssistantModel(big), "claude-sonnet-5");
  assert.equal(lastAssistantModel(join(root, "none.jsonl")), null);
  assert.equal(lastAssistantModel(undefined), null);
  assert.equal(lastAssistantModel(write(join(root, "no-model.jsonl"), `${JSON.stringify({ type: "user" })}\nnot json\n`)), null);
});

test("a subagent's transcript that shows up just after its first call is still read", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  const file = join(root, "session", "subagents", "workflows", "wf_2", "agent-late1.jsonl");
  const writer = new Worker(`setTimeout(() => { const fs = require("fs"); fs.mkdirSync(${JSON.stringify(join(file, ".."))}, { recursive: true }); fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(assistant("claude-sonnet-5"))}); }, 300)`, { eval: true });
  t.after(() => writer.terminate());

  assert.equal(existsSync(file), false);
  assert.equal(subagentModel({ agent_id: "late1", transcript_path: session }, env), "claude-sonnet-5");
});

test("a claude started from the shell whose transcript shows up just after its first call is still read", (t) => {
  const { root, env } = world(t);
  write(join(root, "child", ".keep"), "");
  const file = join(root, "child", "session.jsonl");
  const writer = new Worker(`setTimeout(() => require("fs").writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(assistant("claude-sonnet-5"))}), 300)`, { eval: true });
  t.after(() => writer.terminate());

  assert.match(judge({ tool_name: "Bash", session_id: "c-1", effort: { level: "medium" }, transcript_path: file }, { ...env, ULTRACODE_ANYWHERE_HELD_CHILD: "1" }), /claude-sonnet-5/);
});

test("a subagent with no transcript costs a single wait across its calls, and old marks are cleared", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  const old = write(holdStatePath(env, join("waited", "old1")), "");
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
  utimesSync(old, twoDaysAgo, twoDaysAgo);
  const recent = write(holdStatePath(env, join("waited", "recent1")), "");

  assert.equal(subagentModel({ agent_id: "never1", transcript_path: session }, env), null);
  const started = Date.now();
  assert.equal(subagentModel({ agent_id: "never1", transcript_path: session }, env), null);
  assert.ok(Date.now() - started < 1000, "the second call does not wait again");
  assert.deepEqual([existsSync(old), existsSync(recent)], [false, true]);
  assert.equal(subagentModel({ agent_id: "never2", transcript_path: join(root, "no-session.jsonl") }, env), null, "a session that keeps no transcript is not waited on");
});

test("during a self-check the log line names who called, at what effort, on what model", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  write(join(root, "session", "subagents", "agent-a1.jsonl"), assistant("claude-opus-5"));

  assert.equal(logLine({ tool_name: "Bash", effort: { level: "xhigh" } }, env), "main xhigh none\n");
  assert.equal(logLine({ tool_name: "Bash", agent_id: "a1", effort: { level: "medium" }, transcript_path: session }, env), "child medium claude-opus-5\n");
  assert.equal(readFileSync(session, "utf8"), "\n");
});

test("a model sharing the held family's prefix is not the held family", (t) => {
  const { root, env } = world(t);
  const session = write(join(root, "session.jsonl"), "\n");
  write(join(root, "session", "subagents", "agent-a9.jsonl"), assistant("claude-opus-5-1"));

  assert.match(judge({ tool_name: "Bash", agent_id: "a9", effort: { level: "medium" }, transcript_path: session }, env), /claude-opus-5-1/);
});

test("a synthetic line the build writes for an error is not read as the model a transcript records", (t) => {
  const { root } = world(t);
  const file = write(join(root, "t.jsonl"), `${assistant("claude-opus-5")}${JSON.stringify({ type: "assistant", message: { model: "<synthetic>", content: [] } })}\n`);

  assert.equal(lastAssistantModel(file), "claude-opus-5");
});
