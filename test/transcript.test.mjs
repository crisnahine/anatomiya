import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compact, delivered, filler, instructions, notification, prompted, snapshot, toolCall, transcript } from "./transcript.mjs";
import {
  echoEvent,
  isCompactBoundary,
  isCompaction,
  mayBeCompaction,
  parsed,
  readByModel,
  sessionStartIn,
  toolCallsIn,
  transcriptTail,
  turnOpenersIn,
  turnStartIn,
  windowBytes,
} from "../plugins/anatomiya/lib/transcript.mjs";
import { sessionStart } from "../plugins/anatomiya/lib/reuse.mjs";

const MINUTE = 60 * 1000;

// A session as 2.1.296 writes one: bookkeeping first, a prompt, a call in the
// foreground, one in the background with its completion in each of its three
// records, a hook's block reason, and a later prompt.
function session(t, at = Date.parse("2026-10-11T04:00:00.000Z")) {
  return transcript(t, [
    { type: "permission-mode", permissionMode: "default", sessionId: "s" },
    prompted(new Date(at)),
    instructions("# rules"),
    snapshot(64),
    ...toolCall("fg", at + 1000, at + 2000),
    ...toolCall("bg", at + 3000, at + 3200),
    notification("bg", at + 9000, "queue"),
    notification("bg", at + 9100, "attachment"),
    notification("bg", at + 9200, "user"),
    { type: "user", isMeta: true, message: { role: "user", content: "Stop hook feedback:\nnot yet" } },
    prompted(new Date(at + MINUTE)),
    ...toolCall("open", at + MINUTE + 1000, at + MINUTE + 1500, { name: "Agent" }),
  ]);
}

test("the record readers over a transcript's text name its start, its last prompt and each call's span", (t) => {
  const path = session(t);
  const text = readFileSync(path, "utf8");
  const at = Date.parse("2026-10-11T04:00:00.000Z");

  assert.equal(sessionStart(path), at, "the path reader reads the same head");
  assert.equal(sessionStartIn(text), at, "the first record carrying a timestamp");
  assert.equal(turnStartIn(text), at + MINUTE, "the last prompt, past a block reason and a result");
  const blocked = `${text}${JSON.stringify({ type: "user", isMeta: true, timestamp: new Date(at + MINUTE + 5000).toISOString(), message: { role: "user", content: "Stop hook feedback:\nnot yet" } })}\n`;
  assert.equal(turnStartIn(blocked), at + MINUTE, "a hook's block reason written after the prompt, with a time of its own, is no prompt");
  assert.deepEqual(toolCallsIn(text), [
    { from: at + 1000, to: at + 2000 },
    { from: at + 3000, to: at + 9000 },
    { from: at + MINUTE + 1000, to: at + MINUTE + 1500 },
  ]);
});

test("the turns a run of records opens name the call that opened each, and the subagents it launched", () => {
  const records = [
    prompted(),
    ...toolCall("toolu_check", 0, 1, { name: "Agent" }),
    ...toolCall("toolu_tests", 2, 3),
    notification("toolu_tests", 4, "attachment"),
    notification("toolu_check", 5, "attachment"),
    notification("toolu_check", 6, "user"),
  ];
  const { opened, launched } = turnOpenersIn(records.map((record) => JSON.stringify(record)).join("\n"));
  assert.deepEqual(opened, [null, "toolu_check"], "a person's prompt and the subagent's result; another call's result and a meta record open nothing");
  assert.deepEqual([...launched], ["toolu_check"]);
});

test("a session whose first stamped record is past the head still has a start", (t) => {
  // Measured: an instructions attachment of 167,656 bytes with its stamp past the first 64 KiB. Read only
  // that far, the start was null, and the reuse check answered nothing for the life of the session.
  const at = Date.parse("2026-10-11T04:00:00.000Z");
  const path = transcript(t, [
    { type: "permission-mode", permissionMode: "default", sessionId: "s" },
    { type: "attachment", attachment: { type: "instructions", content: "x".repeat(168 * 1024) }, timestamp: new Date(at).toISOString() },
    prompted(new Date(at + 1000)),
  ]);

  assert.equal(sessionStart(path), at);
});

test("text that cannot be read answers what an unreadable transcript does", () => {
  assert.equal(sessionStartIn(null), null);
  assert.equal(turnStartIn(null), null);
  assert.deepEqual(toolCallsIn(null), []);
  assert.equal(sessionStartIn(""), null);
  assert.equal(turnStartIn("{\"type\":\"user\",\"timesta"), null, "a half-written last line");
});

test("a transcript's tail carries the offset it ends at and its lines", (t) => {
  const path = transcript(t, [prompted(new Date(0)), filler(10)]);
  const whole = readFileSync(path, "utf8");

  const tail = transcriptTail(path, 20);
  assert.equal(tail.end, Buffer.byteLength(whole));
  assert.equal(tail.text, whole.slice(-20));
  assert.deepEqual(tail.lines(), whole.slice(-20).split("\n"));
  assert.equal(transcriptTail(`${path}.missing`, 20), null);
});

// Every record the delivery measurement counts as a compaction. A shape `isCompaction` learns is added here.
const COMPACTIONS = {
  boundary: compact(),
  summary: { type: "user", isCompactSummary: true, message: { content: "summary" } },
  "a boundary under another record type": { type: "user", subtype: "compact_boundary" },
};

test("a compaction is either shape to the delivery measurement, and only the system record to the echo", () => {
  const { boundary, summary } = COMPACTIONS;

  for (const [shape, record] of Object.entries(COMPACTIONS)) assert.equal(isCompaction(record), true, shape);
  assert.equal(isCompactBoundary(boundary), true);
  assert.equal(isCompactBoundary(summary), false);
  assert.equal(isCompactBoundary(COMPACTIONS["a boundary under another record type"]), false, "the echo checks the record type");
  assert.equal(isCompaction(null), false);
  assert.equal(isCompactBoundary(null), false);
});

test("every record counted as a compaction is on a line the measurement's filter lets through", () => {
  // The filter runs before the parse, so a compaction it drops is never counted.
  for (const [shape, record] of Object.entries(COMPACTIONS)) assert.equal(mayBeCompaction(JSON.stringify(record)), true, shape);
  assert.equal(mayBeCompaction(JSON.stringify(filler(64))), false, "and tool output is not parsed for one");
});

test("the window counts what the model reads and nothing the build keeps for itself", () => {
  const line = (entry) => JSON.stringify(entry);
  const read = line(delivered("map", { rendered: true }));

  assert.equal(windowBytes(read), Buffer.byteLength(read) + 1, "a rendered delivery, with its newline");
  assert.equal(windowBytes(line(delivered("map"))), 0, "an unrendered one, as builds before 2.1.263 wrote it");
  assert.equal(windowBytes(line(snapshot(100))), 0);
  assert.equal(windowBytes(line(instructions("# rules"))), 0, "placed at the head of the context");
  assert.equal(windowBytes(line(notification("x", 0, "queue"))), 0);
  assert.equal(windowBytes("{\"type\":\"user\""), 0, "a half-written line");
  assert.equal(readByModel(prompted()), true);
  assert.equal(readByModel(parsed(line(toolCall("x", 0, 1)[0]))), true);
  assert.equal(parsed("not json"), null);
});

test("an echo event is read the same off a rendered delivery as off an unrendered one", () => {
  assert.deepEqual(echoEvent(JSON.stringify(delivered("map", { rendered: true }))), ["map"]);
  assert.deepEqual(echoEvent(JSON.stringify(delivered("map"))), ["map"]);
  assert.equal(echoEvent(JSON.stringify(compact())), "compact");
});
