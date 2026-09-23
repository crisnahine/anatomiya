import { test } from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bytesPerToken, replayEcho } from "../scripts/measure-echo.mjs";
import { compact, delivered, filler } from "./transcript.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "measure-echo.mjs");

const map = (body, at = "2026-09-23T00:00:00.000Z") => `<repository-map delivered="${at}">\n${body}\n</repository-map>`;
const lines = (entries) => entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));

test("a repeat of the same map is counted and not kept, whatever its timestamp", () => {
  const entries = [delivered(map("A", "t1")), delivered(map("A", "t2")), delivered(map("A", "t3"))];
  assert.deepEqual(replayEcho(lines(entries), 1024), { made: 3, repeats: 2, kept: 1 });
});

test("a changed map, a compaction and a delivery past the window are each kept", () => {
  const entries = [delivered(map("A")), delivered(map("B")), compact(), delivered(map("B")), filler(2048), delivered(map("B"))];
  assert.deepEqual(replayEcho(lines(entries), 1024), { made: 4, repeats: 1, kept: 4 });
});

test("text that is not this plugin's delivery is not counted", () => {
  const quoted = { type: "user", message: { content: [{ type: "tool_result", content: map("A") }] } };
  assert.deepEqual(replayEcho(lines([quoted, delivered("PONYTAIL MODE"), "{half a line"]), 1024), { made: 0, repeats: 0, kept: 0 });
});

test("a map the window still holds is not kept again, even with another map between", () => {
  const entries = [delivered(map("A")), delivered(map("B")), delivered(map("A"))];
  assert.deepEqual(replayEcho(lines(entries), 1024), { made: 3, repeats: 0, kept: 2 });
});

test("transcript bytes per context token are read off the assistant's usage, main thread only", () => {
  const turn = (input, cached, sidechain = false) => ({
    type: "assistant",
    isSidechain: sidechain,
    message: { usage: { input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } },
  });
  const entries = [turn(100, 900), filler(9000), turn(100, 1900), turn(100, 5900, true)];
  const text = lines(entries);
  const between = text.slice(1, 3).reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  assert.equal(bytesPerToken(text, 1000), between / 1000);
  assert.equal(bytesPerToken(text, 1001), null, "grew less than asked");
  assert.equal(bytesPerToken(lines([turn(100, 900)]), 1), null, "one turn measures nothing");
});

test("a store that is not a directory is refused with a line and exit 2", () => {
  for (const [store, said] of [["/nonexistent/anatomiya-store", /no such directory/], [SCRIPT, /not a directory/]]) {
    const run = spawnSync(process.execPath, [SCRIPT, store], { encoding: "utf8" });
    assert.equal(run.status, 2, store);
    assert.match(run.stderr, said);
    assert.doesNotMatch(run.stderr, /at .*\.mjs:\d+/, "no stack trace");
  }
});
