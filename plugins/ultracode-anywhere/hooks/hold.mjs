#!/usr/bin/env node
/**
 * The spawn hold's two hooks: `spawn-tool` on PreToolUse and `spawn-prompt` on
 * UserPromptSubmit (A81).
 *
 * The switch is read before anything of the hold is imported. This runs on
 * every tool call for everyone with the plugin enabled, and a session that never
 * turned the hold on should pay for a node start and nothing more. Once on, the
 * hold is imported inside the boundary below, so a file that fails to load
 * refuses what the hold exists to refuse, where an exit Claude Code does not
 * read as a refusal would let it through.
 */
import { namesSwitch, projectRoot, switchEnv } from "./hold-switch.mjs";
import { fieldsIn, invokedAs, parsePayload, readStdin, readWhole, respondWith } from "./hook-io.mjs";

/** The tools that start a spawn or a cloud session, which a hold that could not decide refuses. */
const SPAWN_TOOLS = new Set(["Agent", "Task", "Workflow", "Skill", "RemoteTrigger"]);

/** Why a payload the hold could not read whole is refused. */
const UNREAD = "its payload is over the megabyte the hold reads or is not JSON, so it was not read whole. Split a write or a prompt that large";

/** What this hook answers for one payload: an empty object, a decision, or the refusal a broken hold owes. */
export async function answer(verb, stdin, env = process.env) {
  const event = parsePayload(stdin);
  if (!switchedOn(env, event)) return {};
  // A partial read has no level, and a rewrite from it drops what it never read.
  if (!readWhole(event)) return refusal(verb, stdin, env, UNREAD);
  try {
    const rules = await import("./hold-rules.mjs");
    if (verb === "spawn-tool") return rules.toolAnswer(event, env);
    if (verb === "spawn-prompt") return rules.promptAnswer(event, env);
    return {};
  } catch (err) {
    return refusal(verb, stdin, env, err);
  }
}

/** Whether anything names the switch where the hold reads it, read without loading the hold. */
export function switchedOn(env = process.env, event = {}, accountHome = null) {
  const cwd = typeof event?.cwd === "string" ? event.cwd : "";
  return namesSwitch(switchEnv(env, { root: projectRoot(env, cwd), accountHome }));
}

/**
 * What a hold that could not decide owes a call, read off the raw payload.
 *
 * A spawn tool, a subagent's call and a child session's call are refused, and a
 * prompt that may open with a slash command is blocked. The main session's other
 * calls go through, since refusing those would lock the session out of every
 * tool, the ones it needs to fix this included.
 */
export function refusal(verb, stdin, env, err) {
  const fields = fieldsIn(String(stdin ?? ""));
  const why = `The spawn hold could not check this call, so it is refused: ${String(err?.message ?? err).split("\n")[0].slice(0, 200)}`;
  if (verb === "spawn-tool") {
    const held = SPAWN_TOOLS.has(fields.tool_name) || typeof fields.agent_id === "string" || env.ULTRACODE_ANYWHERE_HELD_CHILD === "1";
    return held ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {};
  }
  if (verb === "spawn-prompt" && opensWithSlash(fields.prompt ?? promptCut(stdin))) return { decision: "block", reason: why };
  return {};
}

/** How a prompt the read stopped inside opens: the build sends the prompt last, so closing its string reads the start back. */
function promptCut(stdin) {
  const text = String(stdin ?? "").replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(^|[^\\])((?:\\\\)*)\\$/, "$1$2");
  try {
    const value = JSON.parse(`${text}"}`);
    return typeof value?.prompt === "string" ? value.prompt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a prompt may open with a slash command: nothing but marks, symbols
 * and spaces before its first slash. Wider than the build's own reading, which
 * trims whitespace alone, since this decides only what a broken hold blocks.
 */
export function opensWithSlash(prompt) {
  return typeof prompt === "string" && /^[^\p{L}\p{N}]*\//u.test(prompt);
}

if (invokedAs(import.meta.url)) {
  respondWith(await answer(process.argv[2], await readStdin()));
}
