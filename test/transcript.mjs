/**
 * Session transcripts and the fields of their entries that this repository's
 * readers look at, as Claude Code 2.1.296 writes them
 * (`docs/research/what-a-2-1-296-transcript-holds.md`).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A session transcript outside any repository, one JSON entry per line, removed after the test. */
export function transcript(t, entries = []) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return path;
}

/**
 * The entry Claude Code writes for a hook's `additionalContext`. Every build
 * from 2.1.263 on adds `rendered`, which makes it count in the window; it is
 * asked for, so a test chooses whether its entry adds to the window's bytes.
 */
export const delivered = (text, { rendered = false } = {}) => ({
  type: "attachment",
  attachment: { type: "hook_additional_context", content: [text] },
  ...(rendered ? { rendered: [{ content: text }], renderedRole: "system" } : {}),
});

/** The entry Claude Code writes where a compaction starts a new window. */
export const compact = () => ({ type: "system", subtype: "compact_boundary", content: "Conversation compacted" });

/** A user entry whose content is `bytes` characters, which pushes everything before it at least that far back. */
export const filler = (bytes) => ({ type: "user", message: { content: "x".repeat(bytes) } });

/** The system prompt the build keeps for itself before a call, which no model reads. */
export const snapshot = (bytes) => ({ type: "attachment", attachment: { type: "prompt_snapshot", systemPrompt: ["x".repeat(bytes)] } });

/** The CLAUDE.md files, rendered as user text but placed at the head of the context. */
export const instructions = (text) => ({
  type: "attachment",
  attachment: { type: "instructions", files: [{ path: "CLAUDE.md", type: "Project", content: text }] },
  rendered: [{ content: text }],
  renderedRole: "user",
});

/** A prompt a person wrote, stamped when it arrived. */
export const prompted = (at = new Date(), content = "go") => ({ type: "user", timestamp: at.toISOString(), message: { role: "user", content } });

/**
 * One tool call: the call stamped when it streams, its result when it returns.
 * A call run in the background returns at once, and a `notification` ends it.
 */
export const toolCall = (id, from, to, { name = "Bash" } = {}) => [
  { type: "assistant", timestamp: new Date(from).toISOString(), message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] } },
  { type: "user", timestamp: new Date(to).toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "done" }] } },
];

/**
 * A background call's completion, in one of the three records it is written
 * as: `queue` when it is enqueued, `attachment` or `user` when it is handed to
 * the model.
 */
export function notification(id, at, shape = "queue") {
  const content = `<task-notification>\n<task-id>task-${id}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
  const timestamp = new Date(at).toISOString();
  if (shape === "queue") return { type: "queue-operation", operation: "enqueue", timestamp, content };
  if (shape === "attachment") return { type: "attachment", timestamp, attachment: { type: "queued_command", prompt: content, origin: { kind: "task-notification" }, timestamp } };
  return { type: "user", isMeta: true, timestamp, message: { role: "user", content } };
}
