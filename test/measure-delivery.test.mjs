import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkOutput,
  eventOf,
  parseArgs,
  sessionOf,
  summarize,
  tableOf,
} from "../scripts/measure-delivery.mjs";

const OVERVIEW = "/repo/.claude/rules/anatomiya-overview.md";
const LIB = "/repo/.claude/rules/anatomiya-area-76b5a357.md";
const TEST = "/repo/.claude/rules/anatomiya-area-9f86d081.md";

const delivery = (path, globs = ["lib/**/*.mjs"], over = {}) => ({
  type: "attachment",
  attachment: { type: "nested_memory", path, content: { path, type: "Project", globs } },
  ...over,
});

const compact = () => ({ type: "system", subtype: "compact_boundary" });

/** The events of one session, in the order a transcript holds them. */
const events = (entries) => entries.map(eventOf).filter((e) => e !== null);

test("a delivery is read off the attachment, with the globs that scoped it", () => {
  assert.deepEqual(eventOf(delivery(LIB)), {
    kind: "delivery",
    path: LIB,
    scoped: true,
    sidechain: false,
  });
});

test("a rule file with no paths key is delivered unscoped", () => {
  assert.equal(eventOf(delivery(OVERVIEW, [])).scoped, false);
});

test("both shapes of a compaction boundary are one event", () => {
  assert.deepEqual(eventOf(compact()), { kind: "compact" });
  assert.deepEqual(eventOf({ isCompactSummary: true, type: "user" }), { kind: "compact" });
});

// The first cut of this measurement counted every line mentioning a rule
// filename, and `ls .claude/rules` in a bash result read as eight deliveries.
test("a tool result that merely names a rule file is not a delivery", () => {
  const listing = {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: `${LIB}\n${TEST}\n` }] },
  };
  assert.equal(eventOf(listing), null);
});

test("a path delivered once is not a repeat", () => {
  const seen = sessionOf(events([delivery(LIB), delivery(TEST)]));

  assert.equal(seen.deliveries, 2);
  assert.deepEqual(seen.repeats, []);
});

test("a path delivered again after a compaction is a reload the compaction caused", () => {
  const seen = sessionOf(events([delivery(LIB), delivery(TEST), compact(), delivery(LIB)]));

  assert.equal(seen.compacts, 1);
  assert.deepEqual(seen.repeats, [{ path: LIB, after: "compact" }]);
  assert.equal(seen.reloadedAfterCompact, 1);
});

test("a path delivered again with no compaction between is counted apart", () => {
  const seen = sessionOf(events([delivery(LIB), delivery(LIB)]));

  assert.deepEqual(seen.repeats, [{ path: LIB, after: "other" }]);
  assert.equal(seen.reloadedAfterCompact, 0);
});

// A subagent gets its own window, so its delivery is not evidence about the
// main thread's dedup either way.
test("a subagent's delivery is counted apart from the main thread's", () => {
  const seen = sessionOf(events([delivery(LIB), delivery(LIB, ["lib/**/*.mjs"], { isSidechain: true })]));

  assert.equal(seen.deliveries, 1);
  assert.equal(seen.sidechain, 1);
  assert.deepEqual(seen.repeats, []);
});

test("only a compaction that follows a delivery can be one this measurement saw", () => {
  const seen = sessionOf(events([compact(), delivery(LIB)]));

  assert.equal(seen.compactedAfterDelivery, false);
  assert.equal(sessionOf(events([delivery(LIB), compact()])).compactedAfterDelivery, true);
});

test("the summary adds the sessions up and counts the ones that carried a delivery", () => {
  const withRepeat = sessionOf(events([delivery(LIB), compact(), delivery(LIB)]));
  const quiet = sessionOf(events([delivery(TEST)]));
  const empty = sessionOf([]);

  const total = summarize([withRepeat, quiet, empty]);

  assert.equal(total.sessions, 3);
  assert.equal(total.sessionsWithDelivery, 2);
  assert.equal(total.deliveries, 3);
  assert.equal(total.repeats, 1);
  assert.equal(total.repeatsAfterCompact, 1);
  assert.equal(total.sessionsCompactedAfterDelivery, 1);
  assert.equal(total.sessionsReloadedAfterCompact, 1);
});

test("a table prints a row per session and nothing for a column no row carries", () => {
  const md = tableOf([{ session: "abc", deliveries: 2 }], ["session", "deliveries"]);

  assert.equal(md.split("\n").length, 3);
  assert.match(md, /\| session \| deliveries \|/);
  assert.match(md, /\| abc \| 2 \|/);
});

test("the transcript directory is required and an unknown option is refused", () => {
  assert.match(parseArgs([]).error, /transcript directory/);
  assert.match(parseArgs(["--nope"]).error, /unknown option/);
  assert.match(parseArgs(["dir", "--md"]).error, /--md needs a value/);
  assert.deepEqual(parseArgs(["dir", "--match", "anatomiya-area"]).match, "anatomiya-area");
});

test("an existing --md target is refused unless the run says it meant it", () => {
  assert.match(checkOutput("out.md", false, true), /already there/);
  assert.equal(checkOutput("out.md", true, true), null);
  assert.equal(checkOutput("out.md", false, false), null);
  assert.equal(checkOutput(null, false, true), null);
});
