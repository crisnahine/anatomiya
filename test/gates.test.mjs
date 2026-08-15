import { test } from "node:test";
import assert from "node:assert/strict";
import * as reduce from "../lib/reduce.mjs";
import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";

const { applyGates, verdictFor, blockedFor, GATES } = reduce;

/**
 * A dimension's per-file shape as the reducer leaves it, built from per-file
 * candidate counts so a fixture states the distribution it means rather than a
 * derived number.
 */
function spread(candidatesPerFile, conformingPerFile = candidatesPerFile) {
  const candidates = candidatesPerFile.reduce((a, b) => a + b, 0);
  let sumSq = 0;
  let top = { candidates: 0, conforming: 0 };
  candidatesPerFile.forEach((n, i) => {
    sumSq += (n / candidates) ** 2;
    if (n > top.candidates) top = { candidates: n, conforming: conformingPerFile[i] };
  });
  return {
    candidates,
    conforming: conformingPerFile.reduce((a, b) => a + b, 0),
    effectiveFiles: candidates ? 1 / sumSq : 0,
    top,
  };
}

const dim = (o) => ({
  key: "k", claim: "c", precision: "precise",
  applicability: 10,
  files: ["a/1.ts", "a/2.ts", "b/3.ts"],
  ...spread([12, 12, 12, 12, 12]),
  exceptions: [], moreExceptions: 0, ...o,
});
const ctx = (o) => ({ authors: 3, areaFileCount: 12, areaDirCount: 2, ...o });

const paths = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? `a/${i}.ts` : `b/${i}.ts`));

test("a clean dimension states a directive", () => {
  const r = applyGates(dim(), ctx());
  assert.equal(r.directive, true);
  assert.equal(r.gate, null);
});

/* --- the evidence gate --- */

test("a perfect record needs thirty-five sites before it may be stated", () => {
  // The whole behavioural claim of the bound: 34 of 34 is below 0.90 and 35 of
  // 35 is above it. Moving z moves this floor (1.645 puts it at 25 sites,
  // 2.576 at 60), and re-adding a candidate floor hides it.
  assert.equal(Number(reduce.wilsonLower(34, 34).toFixed(4)), 0.8985);
  assert.equal(Number(reduce.wilsonLower(35, 35).toFixed(4)), 0.9011);
  assert.ok(reduce.wilsonLower(34, 34) < GATES.minRatio);
  assert.ok(reduce.wilsonLower(35, 35) >= GATES.minRatio);
  assert.equal(GATES.z, 1.96);
  assert.equal(GATES.minCandidates, undefined, "no floor below 35 can ever fire");
});

test("no dimension clears the evidence gate while failing the ninety percent definition", () => {
  // A sign flip, a dropped margin term or an epsilon of slack would state
  // conventions the repository provably does not have. The k = 0 early return
  // is pinned here too: the general form leaves 2e-17 there, a hair above the
  // ratio the bound may never exceed.
  let lowestStated = 1;
  for (let n = 1; n <= 300; n++) {
    for (let k = 0; k <= n; k++) {
      const bound = reduce.wilsonLower(k, n);
      assert.ok(bound <= k / n, `${k}/${n} bound ${bound} above its own ratio`);
      if (bound >= GATES.minRatio) {
        assert.ok(k / n >= GATES.minRatio, `${k}/${n} cleared the bound below 0.90`);
        lowestStated = Math.min(lowestStated, k / n);
      }
    }
  }
  assert.ok(lowestStated > GATES.minRatio, "the boundary itself is never reachable");
  assert.equal(reduce.wilsonLower(0, 11), 0);
});

test("a repository at exactly ninety percent conformance never states a convention, at any size", () => {
  // The bound converges to 0.90 from below forever, so volume cannot buy a
  // sloppy repository in. This is the invariant that must not move.
  const wide = applyGates(dim({ ...spread([3000, 3000, 3000, 1000], [2700, 2700, 2700, 900]) }), ctx());
  assert.equal(wide.ratio, 0.9);
  assert.equal(wide.directive, false);
  assert.equal(wide.gate, "evidence");

  const wider = applyGates(
    dim({ ...spread([300000, 300000, 300000, 100000], [270000, 270000, 270000, 90000]) }),
    ctx()
  );
  assert.equal(wider.ratio, 0.9);
  assert.equal(wider.directive, false);
  assert.equal(wider.gate, "evidence");
});

test("six perfect sites are counts, not a convention", () => {
  // The case the change exists to fix: 6 of 6 passed the old candidate floor at
  // ratio 1.00 while the true rate could plausibly be 0.61.
  const r = applyGates(dim({ ...spread([2, 2, 2]) }), ctx());
  assert.equal(r.ratio, 1);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "evidence");
  assert.equal(Number(r.bound.toFixed(4)), 0.6097);
});

test("the same conformance rate states at two hundred sites and is suppressed at twenty", () => {
  // Two identical ratios with opposite verdicts is the whole behaviour bought
  // here. A gate reading only the point ratio passes both or fails both.
  const many = applyGates(
    dim({ ...spread([40, 40, 40, 40, 40], [38, 38, 38, 38, 38]) }),
    ctx()
  );
  const few = applyGates(dim({ ...spread([4, 4, 4, 4, 4], [4, 4, 4, 4, 3]) }), ctx());

  assert.equal(many.ratio, 0.95);
  assert.equal(few.ratio, 0.95);
  assert.equal(many.directive, true);
  assert.equal(many.gate, null);
  assert.equal(few.directive, false);
  assert.equal(few.gate, "evidence");
  assert.equal(Number(many.bound.toFixed(4)), 0.9104);
  assert.equal(Number(few.bound.toFixed(4)), 0.7639);
});

test("the ratio gate reports the repository's habit and the evidence gate reports the sample", () => {
  // Two opposite diagnoses that must never print the same word: "your code is
  // inconsistent" against "your code is consistent but there is not much of
  // it". The ratio gate is arithmetically dominated by the bound, so this is
  // the only test that can prove it is still there, and that it reports first.
  const habit = applyGates(dim({ ...spread([50, 50, 50, 50], [43, 43, 42, 42]) }), ctx());
  assert.equal(habit.ratio, 0.85);
  assert.equal(habit.directive, false);
  assert.equal(habit.gate, "ratio");

  const sample = applyGates(dim({ ...spread([50, 50, 50, 50], [45, 45, 45, 45]) }), ctx());
  assert.equal(sample.ratio, 0.9);
  assert.equal(sample.directive, false);
  assert.equal(sample.gate, "evidence");
  assert.equal(Number(sample.bound.toFixed(4)), 0.8506);
});

test("no candidates at all states nothing, and divides by nothing", () => {
  // Reachable through a baseline that measured no sites. A NaN bound would
  // still suppress the directive, but it serialises to null in facts.json.
  assert.equal(reduce.wilsonLower(0, 0), 0);
  assert.equal(Number.isFinite(reduce.wilsonLower(0, 0)), true);

  const r = applyGates(dim({ candidates: 0, conforming: 0 }), ctx());
  assert.equal(r.ratio, 0);
  assert.equal(r.bound, 0);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "ratio", "the definition reports before the evidence does");
});

test("one site is not a convention", () => {
  // Several smoothing alternatives special-case small n toward optimism. A
  // single conforming site reading as a repository-wide convention is the most
  // embarrassing output available.
  assert.equal(Number(reduce.wilsonLower(1, 1).toFixed(4)), 0.2065);

  const r = applyGates(dim({ ...spread([1]) }), ctx());
  assert.equal(r.directive, false);
  assert.equal(r.gate, "evidence");
});

test("a conforming count above the candidate count fails closed with a finite number", () => {
  // Without the clamp on p, the variance term goes negative, sqrt returns NaN
  // and facts.json stores null for a field the check reads. The directive still
  // fails closed, which is why the bug would survive review.
  assert.equal(Number(reduce.wilsonLower(21, 20).toFixed(4)), 0.8389);
  assert.equal(Number.isFinite(reduce.wilsonLower(21, 20)), true);

  const r = applyGates(dim({ candidates: 20, conforming: 21 }), ctx());
  assert.equal(Number.isFinite(r.bound), true);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "evidence");
});

test("the evidence gate reads the baseline population and not today's counts", () => {
  // An agent that just wrote thirty conforming sites would otherwise push its
  // own work over the evidence line and then be judged against it (D6).
  const r = applyGates(dim(), ctx({ baseline: { candidates: 30, conforming: 30 } }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "evidence");
  assert.equal(Number(r.bound.toFixed(4)), 0.8865, "the pinned pair, not today's 60 of 60");
});

/* --- the concentration gate --- */

test("the reducer counts how many files the evidence is worth, not which file is largest", () => {
  const rels = ["a/0.ts", "a/1.ts", "a/2.ts", "a/3.ts"];
  const counts = [24, 12, 10, 2];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel, i) => ({
    rel,
    ok: true,
    hits: { swallowed_error: Array.from({ length: counts[i] }, () => ({ conforming: true })) },
  }));

  const d = reduce.reduceArea(area, parsed).find((x) => x.key === "swallowed_error");

  assert.equal(d.candidates, 48);
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 2.7961);
  assert.deepEqual(d.top, { candidates: 24, conforming: 24 });
  assert.equal(d.largestFileShare, undefined, "the share the count replaces");
});

test("the concentration gate blocks one file's habit", () => {
  // D3: 200 sites in one file plus one each in 13 others. 14 files, ratio 1.0,
  // 213 sites clears the bound at 0.9823, and a leave-one-out clause on its own
  // passes it because the remaining 13 sites all conform.
  const d = dim({ ...spread([200, ...Array(13).fill(1)]), applicability: 14, files: paths(14) });
  const r = applyGates(d, ctx({ areaFileCount: 14 }));
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 1.1339);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

test("one file supplying half the sites is not a convention, however many sites it supplies", () => {
  // A fixed share cap passes this on the boundary, exactly 24 of 48. Four files
  // splitting 24/12/10/2 are worth fewer than three files of evidence.
  const d = dim({ ...spread([24, 12, 10, 2]), applicability: 4, langFileCount: 12, files: paths(4) });
  const r = applyGates(d, ctx({ authors: 7, areaFileCount: 12, areaDirCount: 3 }));
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 2.7961);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

test("thirteen files agreeing state a convention even though the largest holds more than half", () => {
  // What decides is how many files the evidence is worth, not how big the
  // largest one is: the share of 0.536 carried here is what the old cap read,
  // and thirteen files agreeing printed as counts because of it.
  const d = dim({
    ...spread([30, 8, 4, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1]),
    largestFileShare: 30 / 56,
    applicability: 13, langFileCount: 13, files: paths(13),
  });
  const r = applyGates(d, ctx({ authors: 7, areaFileCount: 13, areaDirCount: 5 }));
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 3.1235);
  assert.equal(r.directive, true);
  assert.equal(r.gate, null);
});

test("two files never state a convention, however evenly they split their sites", () => {
  // At two files the largest share is at least 0.5 by arithmetic, so the old
  // cap admitted exactly the ties and rejected everything else. 50 of 110
  // two-file slots on the measured repository sat on that knife edge.
  const d = dim({ ...spread([40, 40]), applicability: 2, langFileCount: 4, files: ["a/1.ts", "a/2.ts"] });
  const r = applyGates(d, ctx({ areaFileCount: 4, areaDirCount: 1 }));
  assert.equal(d.effectiveFiles, 2);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

test("the largest file may not hold the area over the ratio bar by itself", () => {
  // Overall ratio 0.945 and every count gate passes. The effective-file count
  // reads 3.64 and clears on its own, so the leave-one-out clause is the only
  // thing that sees the other ten files sitting at 0.89.
  const d = dim({
    ...spread([100, ...Array(10).fill(10)], [100, ...Array(9).fill(9), 8]),
    applicability: 11, langFileCount: 14, files: paths(11),
  });
  const r = applyGates(d, ctx({ areaFileCount: 14, areaDirCount: 6 }));
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 3.6364);
  assert.ok(r.ratio > GATES.minRatio);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

/* --- the applicability gate --- */

test("the applicability floor is the stricter of a root and a quarter share", () => {
  // Each floor is wrong alone. A root asks more than a quarter below sixteen
  // files, where a quarter is one or two files. Above it the root collapses: on
  // its own it asked 11 files of 120, and a measured 120-file area where 11
  // files used `?.` while 109 read absent values without it stated "optional
  // values are read with ?." over the whole directory.
  const floor = (n) => Math.max(Math.ceil(Math.sqrt(n)), Math.ceil(0.25 * n));
  assert.equal(floor(10), 4, "a root is stricter than a quarter on a small area");
  assert.equal(floor(16), 4, "the two meet at sixteen files");
  assert.equal(floor(120), 30, "the share holds where the root would ask for 11");

  const narrow = dim({
    ...spread([10, 10, 10, 10, ...Array(31).fill(5)],
              [10, 10, 10, 10, ...Array(21).fill(5), ...Array(10).fill(4)]),
    applicability: 35, langFileCount: 147, files: paths(35),
  });
  const r = applyGates(narrow, ctx({ authors: 10, areaFileCount: 147, areaDirCount: 16 }));
  assert.equal(r.directive, false, "35 of 147 files is 23.8% and the floor asks 37");
  assert.equal(r.gate, "applicability");
});

test("three of ten files is too narrow even though it is more than a quarter", () => {
  // The 0.25 share asks for 2.5 files here, so it never fires on a small area,
  // which is exactly where a ratio of 1.0 is cheapest to reach.
  const d = dim({ ...spread([20, 20, 20]), applicability: 3, langFileCount: 10, files: paths(3) });
  const r = applyGates(d, ctx({ authors: 4, areaFileCount: 10, areaDirCount: 2 }));
  assert.equal(d.effectiveFiles, 3);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "applicability");
});

test("the applicability floor never loosens as the area grows", () => {
  // Sixteen is where the two floors meet. Below it the root binds, above it the
  // share does, and the floor is monotone in the area size either way. A floor
  // that fell as the area grew is what let 9% of a directory state a rule the
  // agent then obeys over all of it.
  assert.equal(Math.ceil(Math.sqrt(16)), 0.25 * 16);

  const four = dim({ ...spread([15, 15, 15, 15]), applicability: 4, langFileCount: 16, files: paths(4) });
  assert.equal(applyGates(four, ctx({ areaFileCount: 16 })).directive, true);

  const three = dim({ ...spread([20, 20, 20]), applicability: 3, langFileCount: 16, files: paths(3) });
  const r = applyGates(three, ctx({ areaFileCount: 16 }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "applicability");

  const floor = (n) => Math.max(Math.ceil(Math.sqrt(n)), Math.ceil(0.25 * n));
  for (let n = 2; n < 4000; n++) {
    assert.ok(floor(n) >= floor(n - 1), `floor fell between ${n - 1} and ${n}`);
  }
});

test("a narrow applicability predicate is suppressed", () => {
  // 6 of 40 files applicable, all conforming. Ratio 1.0 reads as a strong
  // convention over the 34 files the predicate could not see.
  const r = applyGates(dim({ applicability: 6 }), ctx({ areaFileCount: 40 }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "applicability");
});

test("a dimension whose language has no files in the area states nothing rather than dividing by nothing", () => {
  // The floor of an empty area is 0, and 0 >= 0 is true, so without the
  // explicit denominator guard the empty case becomes a stated directive. The
  // old share rule failed closed here by accident of dividing by zero.
  const d = dim({ ...spread([20, 20, 20]), applicability: 0, langFileCount: 0, files: paths(3) });
  const r = applyGates(d, ctx({ areaFileCount: 0 }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "applicability");
});

test("a mixed area measures applicability over the files the dimension can read", () => {
  // 7 of the area's 8 Ruby files, in an area of 40. Against the area count this
  // reads as a narrow predicate and is suppressed; against the language's files
  // it is the convention it looks like.
  const r = applyGates(dim({ applicability: 7, langFileCount: 8 }), ctx({ areaFileCount: 40 }));
  assert.equal(r.directive, true);
  assert.equal(r.gate, null);
});

/* --- the author gate --- */

test("a one-author repository states its only author's practice as its convention", () => {
  // A fixed 2 asks a repository for something it cannot supply. Measured on
  // repolex: 224 source files, 13 qualifying directories, one author, every
  // dimension of every area suppressed.
  const r = applyGates(dim(), ctx({ authors: 1, repoAuthors: 1 }));
  assert.equal(r.authorsRequired, 1);
  assert.equal(r.directive, true);
  assert.equal(r.gate, null);
});

test("one author cannot make a convention", () => {
  // A second person in the repository restores the requirement. Any rule that
  // reads the area's own author count instead passes every single-author area,
  // which is the one case the gate was written for.
  const r = applyGates(dim(), ctx({ authors: 1, repoAuthors: 2 }));
  assert.equal(r.authorsRequired, 2);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "authors");
});

test("the requirement is the same two hands at seven hundred authors as at three", () => {
  // Every growth term dies here. One step per decade demands 3 at 13 authors,
  // which blocks 16 of the 114 qualifying directories that clear 2 on the
  // measured 2,468-file repository, and all of them have two or three authors.
  assert.equal(reduce.authorsRequired(0), 1);
  assert.equal(reduce.authorsRequired(1), 1);
  assert.equal(reduce.authorsRequired(2), 2);
  assert.equal(reduce.authorsRequired(3), 2);
  assert.equal(reduce.authorsRequired(6), 2);
  assert.equal(reduce.authorsRequired(13), 2);
  assert.equal(reduce.authorsRequired(131), 2);
  assert.equal(reduce.authorsRequired(739), 2);
  assert.equal(reduce.authorsRequired(20000), 2);
});

test("history git could not read is not an author count", () => {
  // An unread log gives every file zero authors, so a broken git prints as a
  // repository whose team is too small, across every area file. The guard is
  // load-bearing on its own: 0 >= null is true.
  const r = applyGates(dim(), ctx({ authors: 0, repoAuthors: null, historyRead: false }));
  assert.equal(r.authorsRequired, null);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "history-unread");
});

test("a repository with no commits is a measured zero, not an unread history", () => {
  // Not hypothetical: files staged with no commit make git log exit 128 while
  // the author reader correctly reports no error.
  const r = applyGates(dim(), ctx({ authors: 0, repoAuthors: 0, historyRead: true }));
  assert.equal(r.authorsRequired, 1);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "authors");
});

test("lowering the bar for a solo repository is not an amnesty for the other gates", () => {
  // The other gates are what stand in for the missing second pair of hands.
  const d = dim({ ...spread([200, ...Array(13).fill(1)]), applicability: 14, files: paths(14) });
  const r = applyGates(d, ctx({ authors: 1, repoAuthors: 1, areaFileCount: 14, areaDirCount: 1 }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

test("the requirement comes from today's history while the evidence comes from the pinned population", () => {
  // Taking the population from the pin for symmetry with D6 would keep the solo
  // bar and the solo wording long after there was a team to disagree.
  const r = applyGates(dim(), ctx({
    authors: 1,
    repoAuthors: 13,
    baseline: { candidates: 60, conforming: 60 },
  }));
  assert.equal(r.authorsRequired, 2);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "authors");
});

/* --- the remaining gates and the baseline --- */

test("a flat area is not blocked by the directory gate", () => {
  // The gate blocked 124 of 170 measured slots when applied unconditionally.
  const flat = dim({ files: ["a/1.ts", "a/2.ts", "a/3.ts"] });
  const r = applyGates(flat, ctx({ areaDirCount: 1 }));
  assert.equal(r.directive, true, "a leaf directory must still be able to state a convention");
});

test("a multi-directory area still needs two directories of evidence", () => {
  const oneDir = dim({ files: ["a/1.ts", "a/2.ts", "a/3.ts"] });
  const r = applyGates(oneDir, ctx({ areaDirCount: 3 }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "directories");
});

test("below the ratio, counts only", () => {
  const r = applyGates(dim({ ...spread([20, 20, 20], [20, 14, 8]) }), ctx());
  assert.equal(r.directive, false);
  assert.equal(r.gate, "ratio");
  assert.equal(r.ratio, 0.7);
});

test("a missing context fails closed rather than throwing", () => {
  const r = applyGates(dim());
  assert.equal(r.directive, false);
  assert.equal(typeof r.gate, "string");
});

test("the gates read the baseline population, not the current one", () => {
  // Clean today, half-conforming at the pin. Gating on today would let an agent
  // that just wrote conforming sites quote itself back as the convention (D6).
  const r = applyGates(dim(), ctx({ baseline: { candidates: 60, conforming: 30 } }));
  assert.equal(r.ratio, 0.5);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "ratio");
});

test("today's exceptions do not suppress a directive the baseline earns", () => {
  const r = applyGates(dim({ ...spread([20, 20, 20], [20, 14, 8]) }),
                       ctx({ baseline: { candidates: 60, conforming: 60 } }));
  assert.equal(r.directive, true);
  assert.equal(r.gate, null);
});

test("a baseline carried on the dimension is read without being passed in", () => {
  // What `facts.json` stores: the baseline rides on the dimension itself.
  const r = applyGates(dim({ baseline: { candidates: 60, conforming: 30 } }), ctx());
  assert.equal(r.gate, "ratio");
});

test("a baseline of counts alone borrows the population-shaped fields", () => {
  // Stored baselines carry two counts and no file list. The applicability gate
  // must still run, off the current pass, rather than seeing zero and blocking
  // every dimension in the repository.
  const r = applyGates(dim({ applicability: 6 }),
                       ctx({ areaFileCount: 40, baseline: { candidates: 60, conforming: 60 } }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "applicability");
});

test("a baseline of counts alone still answers the concentration gate", () => {
  // The missing-data default inverted with the effective-file count: a share of
  // 0 passed the old cap where a count of 0 blocks. A stored baseline carries
  // two counts, so the shape comes from the current pass or the gate is blind
  // to the one file supplying 200 of the 213 sites.
  const d = dim({ ...spread([200, ...Array(13).fill(1)]), applicability: 14, files: paths(14) });
  const r = applyGates(d, ctx({ areaFileCount: 14, baseline: { candidates: 213, conforming: 213 } }));
  assert.equal(r.directive, false);
  assert.equal(r.gate, "concentration");
});

test("the directory gate reads a baseline file list of records", () => {
  // The current pass lists paths, a baseline population lists file records.
  const r = applyGates(dim(), ctx({
    areaDirCount: 3,
    baseline: { candidates: 60, conforming: 60, files: [{ rel: "a/1.ts" }, { rel: "b/2.ts" }] },
  }));
  assert.equal(r.dirs, 2);
  assert.equal(r.directive, true);
});

test("files at the repository root share one directory", () => {
  const r = applyGates(dim({ files: ["x.ts", "y.ts"] }), ctx({ areaDirCount: 2 }));
  assert.equal(r.dirs, 1);
  assert.equal(r.gate, "directories");
});

test("the gate table holds one definition of a convention and no arbitrary floors", () => {
  assert.equal(GATES.minRatio, 0.9);
  assert.equal(GATES.z, 1.96);
  assert.equal(GATES.authorEvidence, 2);
  assert.equal(GATES.minEffectiveFiles, 3);
  // Each of these was a fixed number that did not know how big the repository
  // was. Re-adding one puts a second definition of "convention" in the table.
  assert.equal(GATES.minCandidates, undefined);
  assert.equal(GATES.minAuthors, undefined);
  assert.equal(GATES.maxSingleFileShare, undefined);
  // A share is not a fixed floor: it is already a function of the area's size.
  // What it guards is how much of the area a predicate speaks for, which is a
  // different axis from what fraction of its sites conform.
  assert.equal(GATES.minApplicabilityShare, 0.25);
});

/* --- the inverse --- */

const TEST_CALL = {
  key: "test_call_style",
  claim: "test cases are declared with test(), not it()",
  counterClaim: "test cases are declared with it(), not test()",
};

/* --- the whole verdict, gates and population together --- */

// The inverse-stating fixture above, which is the one that shows a block
// closing the side the gates would otherwise have opened.
const onlyIt = () =>
  dim({
    ...TEST_CALL,
    ...spread([22, 15, 13, 9, 6, 6, 5, 5, 4, 3, 2, 2, 1, 1], Array(14).fill(0)),
    applicability: 14, langFileCount: 14, files: paths(14),
  });

const shape = { fileCount: 14, dirCount: 1 };

test("a blocked slot states neither of its two sentences", () => {
  // Closing `directive` alone left a greenfield or unreachable-baseline area
  // stating its inverse, which is the same directive read off a population
  // nobody accepted (D6, E3, E4). Only the whole verdict can hold this: the
  // gate battery is polarity-free and does not know a population was refused.
  const r = verdictFor(onlyIt(), {
    measured: { gate: null, pinned: shape, dims: [] },
    current: shape,
    authors: 1,
    repoAuthors: 1,
  });

  assert.equal(r.states, null, "the counter would otherwise state here");
  assert.equal(r.directive, false);
  assert.equal(r.gate, "postdates-baseline");
  assert.equal(r.counterGate, "postdates-baseline", "and the inverse is closed by the same condition");
});

test("the gates read the pinned counts and never today's", () => {
  // D6. An agent that adds conforming sites would otherwise raise the bar it is
  // judged against, so a perfect working tree cannot open a gate the pinned
  // population fails.
  const today = dim({ ...spread([12, 12, 12, 12, 12]), applicability: 10, files: paths(5) });
  const pinned = {
    ...spread([12, 12, 12, 12, 12], [6, 6, 6, 6, 6]),
    applicability: 10,
    files: paths(5),
    exceptions: [],
  };

  const r = verdictFor(today, { baselineDim: pinned, current: { fileCount: 12, dirCount: 2 }, authors: 3 });

  assert.equal(r.states, null);
  assert.equal(r.gate, "ratio");
  assert.equal(r.baseline.candidates, 60, "and the pinned counts travel with the verdict");
  assert.equal(r.baseline.conforming, 30);
});

test("with no pin the verdict reads the current population and records no baseline", () => {
  const r = verdictFor(dim({ applicability: 10 }), { current: { fileCount: 12, dirCount: 2 }, authors: 3 });

  assert.equal(r.states, "claim");
  assert.equal(r.baseline, null, "which is what caps the check at FIX");
});

test("a directory that only ever writes it() states the inverse of the test-call convention", () => {
  // repolex tests/synthesizers: 14 files, 94 it() calls, not one test() call.
  // Without the inverse this prints "no convention. 0 of 94 sites (ratio)",
  // which is the tool reporting no habit in the strongest one it will ever see.
  const d = dim({
    ...TEST_CALL,
    ...spread([22, 15, 13, 9, 6, 6, 5, 5, 4, 3, 2, 2, 1, 1], Array(14).fill(0)),
    applicability: 14, langFileCount: 14, files: paths(14),
  });
  const r = applyGates(d, ctx({ authors: 1, repoAuthors: 1, areaFileCount: 14, areaDirCount: 1 }));

  assert.equal(r.states, "counter");
  assert.equal(r.counterGate, null);
  assert.equal(r.gate, "ratio", "the positive's failure is still recorded (D7)");
  assert.equal(r.directive, false);
  assert.equal(r.counterRatio, 1);
  assert.equal(Number(r.counterBound.toFixed(4)), 0.9607);
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 7.9176);
});

test("the two sides can never both state, at any split of any sample size", () => {
  // There is no precedence rule to get wrong, and this proves the evaluation
  // order was never load-bearing. It also catches a counter ratio derived as
  // 1 - ratio drifting from (candidates - conforming) / candidates.
  const flat = (n, k) => dim({
    ...TEST_CALL,
    candidates: n, conforming: k,
    // A spread whose largest file decides nothing, so the leave-one-out on
    // either side is the whole sample and only the ratios move.
    effectiveFiles: 14, top: { candidates: 0, conforming: 0 },
    applicability: 14, langFileCount: 14, files: paths(14),
  });

  let claims = 0;
  let counters = 0;
  for (let n = 1; n <= 300; n++) {
    for (let k = 0; k <= n; k++) {
      const r = applyGates(flat(n, k), ctx({ areaFileCount: 14, areaDirCount: 1 }));
      assert.equal(r.counterRatio, (n - k) / n, `${k}/${n} counter ratio`);
      assert.equal(r.ratio + r.counterRatio, 1, `${k}/${n} ratios do not partition the sites`);
      assert.ok(!(r.gate === null && r.counterGate === null), `${k}/${n} stated both sides`);
      assert.equal(r.directive, r.states === "claim", `${k}/${n} directive left the claim side`);
      if (r.counterRatio >= GATES.minRatio) assert.equal(r.gate, "ratio", `${k}/${n}`);
      if (r.states === "claim") {
        claims++;
        assert.equal(r.gate, null);
        assert.equal(r.counterGate, "ratio");
      }
      if (r.states === "counter") {
        counters++;
        assert.equal(r.counterGate, null);
        assert.equal(r.gate, "ratio");
      }
    }
  }
  assert.ok(claims > 0 && counters > 0, "the sweep states both sides somewhere, or it proves nothing");

  const empty = applyGates(flat(0, 0), ctx({ areaFileCount: 14, areaDirCount: 1 }));
  assert.equal(empty.ratio, 0);
  assert.equal(empty.counterRatio, 0);
  assert.equal(empty.states, null);
  assert.equal(empty.gate, "ratio");
  assert.equal(empty.counterGate, "ratio");
});

test("a directory that reads wall-clock time everywhere states nothing, and the ban is the only thing stopping it", () => {
  // Eight workers, 60 Time.now calls, no Time.current anywhere. Every counter
  // gate passes on these counts, so if the permission is ever derived from the
  // numbers the map tells the agent to read wall-clock time on purpose.
  const counts = spread([12, 10, 9, 8, 7, 6, 5, 3], Array(8).fill(0));
  const shape = { ...counts, applicability: 8, langFileCount: 8, files: paths(8) };
  const at = ctx({ authors: 2, repoAuthors: 4, areaFileCount: 8, areaDirCount: 1 });

  const banned = applyGates(dim({
    key: "zone_aware_time",
    claim: "the current time is read through the application time zone",
    ...shape,
  }), at);

  assert.equal(banned.states, null);
  assert.equal(banned.gate, "ratio");
  assert.equal(banned.counterGate, "one-sided");

  // The same counts under a dimension that carries the string. Only the
  // hand-written sentence separates the two verdicts.
  const allowed = applyGates(dim({ ...TEST_CALL, ...shape }), at);
  assert.equal(allowed.states, "counter");
  assert.equal(allowed.counterGate, null);
  assert.equal(Number(allowed.counterBound.toFixed(4)), 0.9398);
  assert.equal(Number(counts.effectiveFiles.toFixed(4)), 7.0866);
  assert.equal(Math.max(Math.ceil(Math.sqrt(8)), Math.ceil(0.25 * 8)), 3, "against an applicability of 8");
});

test("one file may not hold the inverse over the bar by itself", () => {
  // The exact mirror of the positive side's leave-one-out case, at the same
  // 3.6364 effective files: 189 of 200 sites clears the bound at 0.9042 and the
  // effective-file clause passes on its own, so the leave-one-out is the only
  // thing that sees the other ten files sitting at 0.89.
  const d = dim({
    ...TEST_CALL,
    ...spread([100, ...Array(10).fill(10)], [0, ...Array(9).fill(1), 2]),
    applicability: 11, langFileCount: 14, files: paths(11),
  });
  const r = applyGates(d, ctx({ areaFileCount: 14, areaDirCount: 6 }));

  assert.equal(r.counterRatio, 0.945);
  assert.equal(Number(r.counterBound.toFixed(4)), 0.9042, "the evidence gate passes");
  assert.equal(Number(d.effectiveFiles.toFixed(4)), 3.6364, "the effective-file clause passes");
  assert.equal(r.counterGate, "concentration");
  assert.equal(r.states, null);
});

test("the counter-eligible set is exactly twelve named keys and every counter names what to write", () => {
  // The ban list is a safety decision, not a detection detail. Pinning the set
  // makes a dimension arriving with a counter, or a refused one gaining it in a
  // refactor, cost a reviewed diff instead of being inherited.
  //
  // Refusal is `null`, never an absent key: a dimension that simply never got
  // the field reads as refused, and the registry cannot tell the two apart.
  const eligible = [
    "function_style", "type_only_import", "import_extension", "test_call_style",
    "assertion_style", "absent_is_null",
    "record_lookup", "model_callbacks", "service_result_shape",
    "hook_call_style", "handler_is_named", "handler_memoised",
  ];
  const refused = [
    "swallowed_error", "rescue_uses_error", "zone_aware_time", "non_null_assertion",
    "optional_chaining", "nullish_default", "module_state_const", "keyword_params",
    "explicit_return_type", "error_shape", "async_error_handling",
    // `.forEach` cannot await, break, or return from the enclosing function.
    // Stated as an area's convention, the check asked for an await loop to be
    // rewritten into the classic bug.
    "iterate_with_for_of",
    "spread_on_component", "text_translated",
    "migration_reversible", "migration_schema_only", "column_null_declared",
    "table_primary_key_declared", "reference_foreign_key",
  ];

  const carrying = ALL_DIMENSIONS.filter((d) => typeof d.counterClaim === "string").map((d) => d.key);
  assert.deepEqual(carrying.slice().sort(), eligible.slice().sort());
  assert.equal(eligible.length + refused.length, ALL_DIMENSIONS.length, "a key escaped the classification");

  for (const key of refused) {
    const d = ALL_DIMENSIONS.find((x) => x.key === key);
    assert.ok(d, `${key} left the registry`);
    assert.equal(d.counterClaim, null, `${key} may never state its inverse`);
  }

  for (const d of ALL_DIMENSIONS.filter((x) => typeof x.counterClaim === "string")) {
    assert.equal(typeof d.counterClaim, "string", d.key);
    assert.ok(d.counterClaim.trim().length > 0, d.key);
    assert.notEqual(d.counterClaim, d.claim, d.key);
    // A machine negation names nothing to write. The sentence has to say what
    // the area does, or the agent reads a prohibition and picks a third thing.
    assert.ok(!/^no[t]?\s/i.test(d.counterClaim), `${d.key} states a prohibition, not a directive`);
  }
});

/* --- the verdict, assembled in one place --- */

test("a population nobody accepted closes the slot before a gate is asked", () => {
  // The ordering is the point. The gate battery would pass this dimension on
  // its counts alone, and a directive derived from a population a human never
  // accepted is a convention nobody agreed to (E1, D6).
  const perfect = dim({ ...spread([4, 4, 4, 4]), applicability: 4 });

  const r = verdictFor(perfect, {
    measured: { gate: "population-change", pinned: null, dims: [] },
    current: { fileCount: 4, dirCount: 2 },
    authors: 3,
  });

  assert.equal(r.states, null);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "population-change");
});

test("a block closes both sides, not just the claim", () => {
  // Forcing `directive` alone leaves the area stating its inverse, which is
  // the same directive from the same unaccepted population (D6, E3, E4).
  const mostlyCounter = dim({ ...spread([4, 4, 4, 4], [0, 0, 0, 0]), applicability: 4, counterClaim: "the other way" });

  const r = verdictFor(mostlyCounter, {
    measured: { gate: "unreachable", pinned: null, dims: [] },
    current: { fileCount: 4, dirCount: 2 },
    authors: 3,
  });

  assert.equal(r.states, null);
  assert.equal(r.counterGate, "unreachable");
});

test("a dimension whose sites all postdate the pin is closed by the verdict itself", () => {
  // The scan used to reach into the baseline for this and hand the answer in.
  // Only a whole repository could reach the branch.
  const today = dim({ ...spread([4, 4, 4, 4]), applicability: 4 });

  const r = verdictFor(today, {
    measured: { gate: null, pinned: { fileCount: 4, dirCount: 2 }, dims: [] },
    current: { fileCount: 4, dirCount: 2 },
    authors: 3,
  });

  assert.equal(r.gate, "postdates-baseline");
  assert.equal(r.directive, false);
});

test("a corpus answered for in part states nothing, whatever any slot counted", () => {
  // F7. Counting over an arbitrary subset and rendering it like a complete scan
  // is worse than reporting nothing, and the whole-map suppression outranks
  // every other condition.
  const perfect = dim({ ...spread([4, 4, 4, 4]), applicability: 4 });

  const r = verdictFor(perfect, {
    truncated: true,
    current: { fileCount: 4, dirCount: 2 },
    authors: 3,
  });

  assert.equal(r.gate, "corpus-truncated");
  assert.equal(r.counterGate, "corpus-truncated");
  assert.equal(r.states, null);
});

test("a repository with no pin lets the gates decide, and names no baseline", () => {
  // Counts-only. Charging `postdates-baseline` here would name a pin that does
  // not exist as the reason a slot said nothing.
  const perfect = dim({ ...spread([12, 12, 12, 12, 12]), applicability: 10, files: paths(5) });

  const r = verdictFor(perfect, {
    measured: { gate: null, pinned: null, dims: [] },
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });

  assert.equal(r.gate, null);
  assert.equal(r.states, "claim");
});

test("a verdict handed the wrong record shape refuses it rather than opening every gate", () => {
  // The population record and the measure record are different objects, and one
  // is a field of the other. Passed the inner one, the old reader found no
  // `gate` and no `pinned`, returned null, and let a slot state a directive from
  // a population nobody accepted. Every sibling seam here throws instead.
  const perfect = dim({ ...spread([12, 12, 12, 12, 12]), applicability: 10, files: paths(5) });
  const population = { status: "population-change", directive: false, files: [], missing: [] };

  assert.throws(
    () => verdictFor(perfect, { measured: population, current: { fileCount: 12, dirCount: 2 }, authors: 3 }),
    /measure/
  );
});

test("a dimension whose sites all arrived after the pin states nothing", () => {
  // E4: a ratio over zero baseline sites is the agent's own output measured
  // against itself, so the slot closes before any gate is asked.
  const counted = { gate: null, pinned: { fileCount: 1, dirCount: 1 }, dims: [], population: {} };

  assert.equal(blockedFor(counted, { candidates: 0, conforming: 0 }), "postdates-baseline");
  assert.equal(blockedFor(counted, { candidates: 8, conforming: 8 }), null);
});

test("an area the whole population closed stays closed whatever the dimension counted", () => {
  const changed = { gate: "population-change", pinned: null, dims: [], population: {} };

  assert.equal(blockedFor(changed, { candidates: 8, conforming: 8 }), "population-change");
});

test("a repository with no pin has no baseline to postdate", () => {
  // Counts-only, not greenfield. Charging every dimension `postdates-baseline`
  // here would name a pin that does not exist as the reason.
  const unpinned = { gate: null, pinned: null, dims: [], population: {} };

  assert.equal(blockedFor(unpinned, null), null);
});

test("a file the parser could not read is not a file the dimension could speak about", () => {
  // `applicability` counts files that produced a site, and only an examined file
  // can produce one. Counting every file of the language as the denominator
  // divides a numerator over parsed files by a population that includes files
  // nothing was read from, and the applicability gate then reads a predicate as
  // narrow because the repository holds syntax this tool does not take.
  // Measured: 55 of react's 122 areas hold at least one such file, one of them
  // every file it has.
  const area = {
    path: "src",
    langs: ["js"],
    fileCount: 4,
    files: [
      { rel: "src/a.ts", lang: "js" },
      { rel: "src/b.ts", lang: "js" },
      { rel: "src/c.ts", lang: "js" },
      { rel: "src/d.ts", lang: "js" },
    ],
  };
  const hit = [{ conforming: true, where: null }];
  const parsed = [
    { rel: "src/a.ts", ok: true, hits: { swallowed_error: hit } },
    { rel: "src/b.ts", ok: true, hits: { swallowed_error: hit } },
    // Flow in a .js file, or any syntax the parser rejects: examined, and it
    // answered that it could not read this.
    { rel: "src/c.ts", ok: false, kind: "rejected" },
    { rel: "src/d.ts", ok: false, kind: "crashed" },
  ];

  const [dim] = reduce.reduceArea(area, parsed).filter((d) => d.key === "swallowed_error");

  assert.equal(dim.applicability, 2, "two files produced a site");
  assert.equal(dim.langFileCount, 2, "and two are all this dimension could have spoken about");
});

test("the denominator counts the records handed in, not today's file list", () => {
  // The baseline pass reduces records keyed by the PINNED paths against an area
  // holding today's. Reading the denominator off `area.files` drops every file
  // renamed since the pin, the applicability floor falls with it, and a `git mv`
  // with no content change turns a suppressed claim into a directive the check
  // then enforces. Reproduced end to end: 12 renames took a slot from
  // gate "applicability" to states "claim".
  const area = {
    path: "src",
    langs: ["js"],
    fileCount: 20,
    files: Array.from({ length: 20 }, (_, i) => ({ rel: `src/today${i}.ts`, lang: "js" })),
  };
  const hit = [{ conforming: true, where: null }];
  // What the pinned pass hands in: the same twenty files under their old names.
  const parsed = Array.from({ length: 20 }, (_, i) => ({
    rel: `src/pinned${i}.ts`,
    ok: true,
    hits: i < 4 ? { module_state_const: hit } : {},
  }));

  const [dim] = reduce.reduceArea(area, parsed).filter((d) => d.key === "module_state_const");

  assert.equal(dim.applicability, 4);
  assert.equal(dim.langFileCount, 20, "twenty records were read, whatever they are called today");
});

test("an obligation's denominator is examined files too, because an unread producer answers nothing", () => {
  // `applyPairings` skips a record that is not ok, so an unparsed producer
  // contributes to no pairing site. Keeping it in the denominator is the same
  // split between populations the syntax dimensions were just fixed for.
  const area = {
    path: "app/models",
    langs: ["ruby"],
    fileCount: 4,
    files: ["a", "b", "c", "d"].map((n) => ({ rel: `app/models/${n}.rb`, lang: "ruby" })),
  };
  const hit = [{ conforming: true, elsewhere: false }];
  const parsed = [
    { rel: "app/models/a.rb", ok: true, hits: { model_spec: hit } },
    { rel: "app/models/b.rb", ok: true, hits: { model_spec: hit } },
    { rel: "app/models/c.rb", ok: false, kind: "rejected" },
    { rel: "app/models/d.rb", ok: false, kind: "crashed" },
  ];

  const [dim] = reduce.reduceArea(area, parsed).filter((d) => d.key === "model_spec");

  assert.equal(dim.applicability, 2);
  assert.equal(dim.langFileCount, 2, "two producers were read, and two is what the ratio is over");
});
