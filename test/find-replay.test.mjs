import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RANKING } from "../plugins/anatomiya/lib/find.mjs";
import { QUERIES, replay, report } from "../scripts/find-replay.mjs";

// The recorded queries over the definitions of each repository's index that hold one of its words, in
// the files of each query's six best hits and of its helper. Smaller than a whole index, so its
// scores are its own: 0.798 against 0.882 over the whole indexes on 0.20.0.
const SAMPLE = JSON.parse(readFileSync(new URL("./find-sample.json", import.meta.url), "utf8"));
const indexes = new Map(Object.entries(SAMPLE.indexes));

test("today's ranking holds the sample's floor", () => {
  const result = replay(indexes, SAMPLE.queries);
  assert.ok(result.meanReciprocalRank >= 0.79, `MRR ${result.meanReciprocalRank}`);
  assert.ok(result.shown >= 18, `${result.shown} of 19 in the six find prints`);
});

test("a ranking that drops the name's weight falls below it, so the floor can fail", () => {
  const result = replay(indexes, SAMPLE.queries, { ...RANKING, name: 0 });
  assert.ok(result.meanReciprocalRank < 0.79, `MRR ${result.meanReciprocalRank}`);
});

test("a rank past the hits find prints counts nothing toward the mean, and is still reported", () => {
  const index = { schema: 1, count: 7, files: [["a.ts", 0, Array.from({ length: 7 }, (_, i) => [`parseUrl${"x".repeat(i)}`, "fn", i + 1, null, null, null, 6 - i])]] };
  const result = replay(new Map([["r", index]]), [{ repository: "r", query: "parse url", helper: "parseUrlxxxxxx" }]);
  assert.equal(result.ranks[0].rank, 7);
  assert.equal(result.meanReciprocalRank, 0);
  assert.equal(result.shown, 0);
});

test("the report names each query's rank and every repository it was given no index for", () => {
  const lines = report(replay(indexes, [...SAMPLE.queries.slice(0, 1), { repository: "nowhere", query: "x y", helper: "z" }]));
  assert.match(lines[0], /^atuin\tuuid v7\tuuid_v7\t1$/);
  assert.match(lines.at(-2), /^MRR 1\.000, first 1 of 1, top three 1 of 1, shown 1 of 1$/);
  assert.equal(lines.at(-1), "left out, no index given: nowhere");
});

test("the sample asks the recorded queries", () => {
  const { queries } = JSON.parse(readFileSync(QUERIES, "utf8"));
  assert.deepEqual(SAMPLE.queries, queries.map(({ repository, query, helper }) => ({ repository, query, helper })));
});
