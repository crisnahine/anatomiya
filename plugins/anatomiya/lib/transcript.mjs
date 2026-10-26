/**
 * What Claude Code's session transcript records say, read in one place: the
 * echo's deliveries and compactions, the bytes the model reads, and the
 * moments the reuse check charges a change to (A91, A92).
 *
 * The readers take text, so a hook that needs several answers off one
 * transcript reads it once. `readTail`, `readTailOf` and `readHead` in
 * `rules.mjs` stay the bounded reads under them.
 */
import { readTailOf } from "./rules.mjs";

/** The last `most` bytes of a transcript, the offset they end at, and their lines; null where it will not read. */
export function transcriptTail(path, most) {
  const tail = readTailOf(path, most);
  if (tail === null) return null;
  let lines = null;
  return { text: tail.text, end: tail.end, lines: () => (lines ??= tail.text.split("\n")) };
}

/** A JSON text as its value, a transcript line as its record, or null for text that is not JSON, a half-written last line among them. */
export function parsed(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The record the echo starts a new window at. */
export const isCompactBoundary = (entry) => entry?.type === "system" && entry.subtype === "compact_boundary";

/**
 * Each record a compaction writes, the boundary and the summary after it: what its raw line holds, and
 * the test of the record once parsed. One row carries both, so a reader that filters lines before it
 * parses them never drops a shape the parsed test accepts.
 */
const COMPACTION_SHAPES = [
  { holds: "compact_boundary", is: (entry) => entry?.subtype === "compact_boundary" },
  { holds: '"isCompactSummary":true', is: (entry) => entry?.isCompactSummary === true },
];

/** Either record a compaction writes, which the delivery measurement counts as one event whatever the record type (A17). */
export const isCompaction = (entry) => COMPACTION_SHAPES.some((shape) => shape.is(entry));

/** Whether a line can hold a record `isCompaction` accepts, asked before the line is parsed. */
export const mayBeCompaction = (line) => COMPACTION_SHAPES.some((shape) => line.includes(shape.holds));

/**
 * What one record says about the echo: "compact" for a compaction boundary,
 * the texts of a hook's `additionalContext` for a delivery, or null.
 */
export function echoEventOf(entry) {
  if (isCompactBoundary(entry)) return "compact";
  if (entry?.type !== "attachment" || entry.attachment?.type !== "hook_additional_context") return null;
  return [].concat(entry.attachment.content ?? []).filter((text) => typeof text === "string");
}

/**
 * `echoEventOf` for one transcript line. Parsed rather than searched, so a
 * tool result quoting a map is not a delivery.
 */
export function echoEvent(line) {
  if (!line.includes("compact_boundary") && !line.includes("hook_additional_context")) return null;
  return echoEventOf(parsed(line));
}

/**
 * Whether the model reads this record.
 *
 * A user or assistant message is read, and an attachment is read where it
 * carries `rendered`, which the build sets only on one that converts into a
 * message. A prompt snapshot, a hook's stdout and every bookkeeping line carry
 * none, and counted they pushed a delivery out within one tool call. The
 * CLAUDE.md files carry it, but the build places them at the head of the
 * context, ahead of the delivery they follow in the transcript.
 */
export const readByModel = (entry) =>
  entry?.type === "user" || entry?.type === "assistant" || (entry?.type === "attachment" && Array.isArray(entry.rendered) && entry.attachment?.type !== "instructions");

/**
 * The bytes one transcript line adds to the window: the whole line and its
 * newline where the model reads it, none where the build wrote it for itself.
 * A caller that has parsed the line already hands its record in.
 */
export function windowBytes(line, entry = parsed(line)) {
  return readByModel(entry) ? Buffer.byteLength(line) + 1 : 0;
}

/**
 * The moment a session's transcript began, off its head, or null where it
 * names none.
 *
 * Its first entry carrying a timestamp, which 2.1.272 writes before the first
 * prompt is answered.
 */
export function sessionStartIn(head) {
  if (typeof head !== "string") return null;
  for (const line of head.split("\n")) {
    const at = /"timestamp":"([^"]+)"/.exec(line);
    const ms = at ? Date.parse(at[1]) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * The moment this turn's prompt arrived, or null where the tail names none.
 *
 * The last user entry that a person wrote: a tool's result and a hook's block
 * reason are written as user entries too, and either would move the turn's
 * start past the commits it made. Read from the end, so a long session parses
 * only the lines after its last prompt.
 */
export function turnStartIn(tail) {
  if (typeof tail !== "string") return null;
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("\"user\"")) continue;
    const entry = parsed(lines[i]);
    if (entry?.type !== "user" || entry.isMeta === true) continue;
    const content = entry.message?.content;
    if (Array.isArray(content) && content.some((part) => part?.type === "tool_result")) continue;
    const ms = Date.parse(entry.timestamp);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// The completion of a call run in the background opens with this tag, and the first id it names is the call it ends.
const NOTIFICATION = "<task-notification>";
const FINISHED_CALL = /<tool-use-id>([^<\s]+)<\/tool-use-id>/;

/**
 * The session's tool calls in this tail, each from the moment its call was
 * written to the moment it returned, or empty where the tail stamps none.
 *
 * A call run in the background returns as it starts, so it runs on to the
 * first record of its completion: the queue entry made as it ended, or the
 * notification where there is no such entry. One with no completion recorded
 * ends at its result, which misses its later writes rather than charging the
 * session with somebody else's.
 */
export function toolCallsIn(tail) {
  if (typeof tail !== "string") return [];
  const started = new Map();
  const returned = new Map();
  const finished = new Map();
  for (const line of tail.split("\n")) {
    if (!line.includes("tool_use") && !line.includes("<tool-use-id>")) continue;
    const entry = parsed(line);
    const ms = Date.parse(entry?.timestamp);
    if (!Number.isFinite(ms)) continue;
    const content = entry.message?.content;
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "tool_use" && typeof part.id === "string") started.set(part.id, ms);
      if (part?.type === "tool_result" && typeof part.tool_use_id === "string") returned.set(part.tool_use_id, ms);
    }
    const notice =
      entry.type === "queue-operation" ? entry.content : entry.attachment?.type === "queued_command" ? entry.attachment.prompt : entry.type === "user" ? content : null;
    // A prompt typed or pasted is queued and recorded the same way, and may quote any call's id.
    const id = typeof notice === "string" && notice.startsWith(NOTIFICATION) ? (notice.match(FINISHED_CALL)?.[1] ?? null) : null;
    if (id !== null) finished.set(id, Math.min(finished.get(id) ?? ms, ms));
  }
  return [...started].flatMap(([id, from]) => (returned.has(id) ? [{ from, to: Math.max(returned.get(id), finished.get(id) ?? 0) }] : []));
}
