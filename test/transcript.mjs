/**
 * Session transcripts and the fields of their entries that this repository's
 * readers look at, as Claude Code 2.1.280 writes them.
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

/** The entry Claude Code writes for a hook's `additionalContext`. */
export const delivered = (text) => ({ type: "attachment", attachment: { type: "hook_additional_context", content: [text] } });

/** The entry Claude Code writes where a compaction starts a new window. */
export const compact = () => ({ type: "system", subtype: "compact_boundary", content: "Conversation compacted" });

/** A user entry whose content is `bytes` characters, which pushes everything before it at least that far back. */
export const filler = (bytes) => ({ type: "user", message: { content: "x".repeat(bytes) } });
