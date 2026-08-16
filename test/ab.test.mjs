// test/ab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankAreas } from "../scripts/ab/pick.mjs";
import { scoreFile } from "../scripts/ab/score.mjs";
import { readingFor } from "../scripts/ab/read.mjs";

const facts = {
  areas: [
    {
      path: "app/services",
      fileCount: 40,
      dimensions: [
        { key: "service_result_shape", claim: "service entry points return their failure instead of raising",
          directive: true, states: "claim", candidates: 145, conforming: 140 },
      ],
    },
    {
      path: "app/models",
      fileCount: 128,
      dimensions: [
        { key: "zone_aware_time", claim: "the current time is read through the application time zone",
          directive: true, states: "claim", candidates: 200, conforming: 200 },
      ],
    },
    {
      path: "lib",
      fileCount: 24,
      dimensions: [
        { key: "nullish_default", claim: "defaults are taken with ??, not ||",
          directive: false, states: null, candidates: 116, conforming: 52 },
      ],
    },
  ],
};

test("a stated claim at 1.0 has no headroom and ranks last", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked.at(-1).key, "zone_aware_time");
  assert.equal(ranked.at(-1).headroom, 0);
});

test("a stated claim below 1.0 ranks first", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked[0].key, "service_result_shape");
  assert.ok(ranked[0].headroom > 0.03 && ranked[0].headroom < 0.04);
});

test("a suppressed dimension is not a candidate: the map never told the agent anything", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked.some((r) => r.key === "nullish_default"), false);
});

test("a facts record whose every stated claim is perfect answers that there is no headroom", () => {
  const perfect = { areas: [facts.areas[1]] };
  const ranked = rankAreas(perfect, { minCandidates: 20 });
  assert.equal(ranked.filter((r) => r.headroom > 0).length, 0);
});

test("a claim with too few sites is dropped: one site is not a measurable arm", () => {
  const thin = { areas: [{ path: "x", fileCount: 3, dimensions: [
    { key: "k", claim: "c", directive: true, states: "claim", candidates: 4, conforming: 3 },
  ] }] };
  assert.deepEqual(rankAreas(thin, { minCandidates: 20 }), []);
});
// append to test/ab.test.mjs

test("a written file is scored by the dimension's own predicate, not by a grep", async () => {
  const conforming = `export function f() { try { a() } catch (e) { log(e) } }`;
  const violating = `export function f() { try { a() } catch (e) { } }`;

  const good = await scoreFile({ rel: "new.ts", source: conforming, lang: "js" }, { key: "swallowed_error" });
  const bad = await scoreFile({ rel: "new.ts", source: violating, lang: "js" }, { key: "swallowed_error" });

  assert.deepEqual(good, { candidates: 1, conforming: 1, ratio: 1 });
  assert.deepEqual(bad, { candidates: 1, conforming: 0, ratio: 0 });
});

test("a file the dimension has nothing to say about scores null, not zero", async () => {
  // Zero and "the construct never appeared" are different outcomes, and folding
  // them puts a trial that wrote an unrelated file into the failing bucket.
  const r = await scoreFile({ rel: "new.ts", source: `export const a = 1`, lang: "js" }, { key: "swallowed_error" });
  assert.equal(r, null);
});

test("the claim text comes from the registry, since the record does not store it", () => {
  // facts.json stores counts, not sentences: a stored dimension carries key,
  // ratio and gate and no claim at all. Passing that straight through put the
  // word "undefined" in the result file where the claim belongs.
  const stored = {
    areas: [
      {
        path: "src/vs/workbench",
        fileCount: 52,
        dimensions: [{ key: "non_null_assertion", directive: true, states: "claim", candidates: 797, conforming: 736 }],
      },
    ],
  };

  const [top] = rankAreas(stored, { minCandidates: 20 });

  assert.equal(top.claim, "possibly-absent values are read with ?., not asserted with !");
});

test("a key the registry does not know says so instead of saying undefined", () => {
  const stored = {
    areas: [{ path: "x", fileCount: 9, dimensions: [{ key: "gone_away", directive: true, states: "claim", candidates: 40, conforming: 30 }] }],
  };

  const [top] = rankAreas(stored, { minCandidates: 20 });

  assert.equal(top.claim, "gone_away");
});

test("a result where both arms scored perfectly says so instead of leaving it to the reader", () => {
  // The first A/B ever run scored 10 of 10 in both arms and was written up as a
  // null result about the map. It was a null result about the task. A file that
  // does not say which of those it is invites the same mistake again.
  const both = readingFor({ a: { candidates: 15, conforming: 15 }, b: { candidates: 9, conforming: 9 } }, 0.077);
  assert.match(both, /both arms wrote conforming code every time/i);

  const moved = readingFor({ a: { candidates: 15, conforming: 15 }, b: { candidates: 9, conforming: 6 } }, 0.077);
  assert.doesNotMatch(moved, /both arms wrote conforming code every time/i);
  assert.match(moved, /1\.000 against 0\.667/);

  const nothing = readingFor({ a: { candidates: 0, conforming: 0 }, b: { candidates: 0, conforming: 0 } }, 0.077);
  assert.match(nothing, /neither arm wrote a site this claim counts/i);
});
