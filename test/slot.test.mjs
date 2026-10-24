import { test } from "node:test";
import assert from "node:assert/strict";
import { isWholeArea, scopeOf, slotRecord, statedSide } from "../plugins/anatomiya/lib/slot.mjs";

const dim = (o) => ({
  key: "k",
  precision: "precise",
  applicability: 6,
  candidates: 60,
  conforming: 60,
  authors: 3,
  authorsRequired: 2,
  ratio: 1,
  bound: 0.94,
  states: "claim",
  directive: true,
  gate: null,
  exceptions: [],
  ...o,
});

/* --- the side a slot states: a plurality is not a majority --- */

test("a plurality of seven does not flip the printed sentence", () => {
  // `handler_is_named` is 799 of 1,055 = 0.757 repo-wide, and in one 7-file
  // area it is 3 of 7 named. The plurality flipped, so that area printed "an
  // event handler prop is given an inline arrow, not a named function" while
  // other areas of the same repository printed the forward claim: one
  // dimension, one run, two directly opposed sentences.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "ratio", candidates: 7, conforming: 3 }),
    counterClaim: "the other way",
    counterGate: "ratio",
  });

  assert.equal(side.side, "claim", "four of seven is a directory with no habit");
  assert.equal(side.conforming, 3);
});

test("a majority the sample can support still flips it", () => {
  // C6's measured case, and the reason "always print the claim" is not the fix:
  // 2 of 61 reports a directory with no habit when it has a very strong one.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "concentration", candidates: 61, conforming: 2 }),
    counterClaim: "the other way",
    counterGate: null,
  });

  assert.equal(side.side, "counter");
  assert.equal(side.conforming, 59);
});

test("a sentence no site here follows is never the one printed", () => {
  // The bound is penalised hardest at small n, so a unanimous counter side of
  // three failed it and the map printed the claim with 0 of 3: the sentence the
  // directory follows zero times, which the check then enforced against files
  // doing what every other file in the directory does. On one measured
  // repository 81 unanimous rows read this way, and one parent and its own
  // child printed directly opposed sentences off the same run.
  const at = (candidates) =>
    statedSide({
      ...dim({ states: null, directive: false, gate: "ratio", candidates, conforming: 0 }),
      counterClaim: "the other way",
      counterGate: "ratio",
    });

  for (const n of [2, 3, 4]) {
    assert.equal(at(n).side, "counter", `${n} of ${n} take the other side`);
    assert.equal(at(n).conforming, n);
  }
});

test("one observation is not a habit, so a single site decides nothing", () => {
  // Without a floor the zero clause flipped a one-site directory against a
  // claim the rest of the repository holds at 94.7%, and its own parent area
  // stated the opposite as a directive: the D9 defect again, at n = 1. Of the
  // 81 unanimous counters on one measured repository, 29 are a single site.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "evidence", candidates: 1, conforming: 0 }),
    counterClaim: "the other way",
    counterGate: "evidence",
  });

  assert.equal(side.side, "claim");
  assert.equal(side.conforming, 0, "the count beside it says how thin this is");
});

test("a claim side holding one site is still a directory with no habit", () => {
  // The floor is zero sites, not a small share: one site each way is mixed, and
  // the plurality rule is what decides it.
  const side = statedSide({
    ...dim({ states: null, directive: false, gate: "ratio", candidates: 4, conforming: 1 }),
    counterClaim: "the other way",
    counterGate: "ratio",
  });

  assert.equal(side.side, "claim");
  assert.equal(side.conforming, 1);
});

test("a side the gates actually stated is never re-decided by the counts", () => {
  const side = statedSide({
    ...dim({ states: "counter", directive: false, gate: "ratio", candidates: 7, conforming: 3 }),
    counterClaim: "the other way",
    counterGate: null,
  });

  assert.equal(side.side, "counter", "the gates decided this, not the plurality");
});

test("the flip needs a majority at ten sites too, and eight of ten is not one", () => {
  const at = (conforming) =>
    statedSide({
      ...dim({ states: null, directive: false, gate: "ratio", candidates: 10, conforming }),
      counterClaim: "the other way",
      counterGate: "ratio",
    }).side;

  assert.equal(at(2), "claim", "eight of ten: the lower bound on the majority is 0.49");
  assert.equal(at(1), "counter", "nine of ten clears a half");
});

/* --- a slot as the record stores it --- */

test("every slot the record writes is whole enough to carry, however many sides it has", () => {
  const counter = { counterClaim: "the other way", counterRatio: 0, counterBound: 0, counterPriorBound: 0, counterGate: null, counterAuthors: 0, counterExceptions: [], moreCounterExceptions: 0 };
  const baseline = { baseline: { candidates: 40, conforming: 39, exceptions: [{ path: "a.ts", count: 1 }], counterExceptions: [] } };
  for (const slot of [dim(), dim(counter), dim({ ...counter, ...baseline }), dim({ scope: [".ts"], declined: 2, companionsElsewhere: 1 })]) {
    const area = { id: "aaaaaaaa", path: "src", globs: [], fileCount: 8, dimensions: [slotRecord(slot)] };
    assert.equal(isWholeArea(area), true, JSON.stringify(slot));
  }
  assert.equal(isWholeArea({ id: "aaaaaaaa", path: "src", fileCount: 8, dimensions: [null] }), false, "a hand edit that broke a slot is not carried");
});

test("a scope a sentence could not name is neither stored nor read", () => {
  const many = Array.from({ length: 17 }, (_, i) => `.e${i}`);
  assert.deepEqual(scopeOf(dim({ scope: [".ts", "Gemfile"] })), [".ts", "Gemfile"]);
  for (const scope of [many, [], [".t s"], [1], null, undefined]) {
    assert.equal(scopeOf(dim({ scope })), null, JSON.stringify(scope));
    assert.equal("scope" in slotRecord(dim({ scope })), false, JSON.stringify(scope));
  }
  assert.deepEqual(slotRecord(dim({ scope: [".ts"] })).scope, [".ts"]);
});
