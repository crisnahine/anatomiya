import { test } from "node:test";
import assert from "node:assert/strict";

import { countSides, decideDefault, mergeTable } from "../scripts/measure-defaults.mjs";

const record = (hits) => ({ ok: true, hits });
const flags = (n, conforming) => Array.from({ length: n }, () => ({ conforming, where: null }));

test("countSides tallies conforming as the claim side and the rest as the counter", () => {
  const records = new Map([
    ["a.ts", record({ nullish_default: [...flags(3, true), ...flags(1, false)] })],
    ["b.ts", record({ nullish_default: flags(2, true), swallowed_error: flags(4, false) })],
    ["c.ts", { ok: false, hits: { nullish_default: flags(9, true) } }],
  ]);
  const sides = countSides(records);
  assert.deepEqual(sides.get("nullish_default"), { claim: 5, counter: 1 });
  assert.deepEqual(sides.get("swallowed_error"), { claim: 0, counter: 4 });
  assert.equal(sides.has("c"), false, "an unread file contributes nothing");
});

test("a side needs 0.8 of at least 20 sites", () => {
  assert.equal(decideDefault({ claim: 18, counter: 2 }), "claim");
  assert.equal(decideDefault({ claim: 2, counter: 18 }), "counter");
  assert.equal(decideDefault({ claim: 15, counter: 4 }), "none", "19 sites is under the evidence floor");
  assert.equal(decideDefault({ claim: 15, counter: 5 }), "none", "0.75 is under the share floor");
  assert.equal(decideDefault({ claim: 0, counter: 0 }), "none");
});

test("a measured entry is not overwritten unless forced", () => {
  const measured = {
    default: "claim",
    provenance: { method: "measured", model: "m0", date: "2026-01-01", samples: 9, sideCounts: { claim: 20, counter: 0 } },
  };
  const seed = { default: "none", provenance: { method: "literature", source: "seed: unmeasured" } };
  const incoming = {
    default: "counter",
    provenance: { method: "measured", model: "m1", date: "2026-08-16", samples: 5, sideCounts: { claim: 0, counter: 20 } },
  };

  const kept = mergeTable({ a: measured, b: seed }, { a: incoming, b: incoming });
  assert.equal(kept.a.provenance.model, "m0", "the earlier measurement stands");
  assert.equal(kept.b.provenance.model, "m1", "a seed always yields to a measurement");

  const forced = mergeTable({ a: measured }, { a: incoming }, { force: true });
  assert.equal(forced.a.provenance.model, "m1");
});

test("a learned-class dimension measures its class, never a side", async () => {
  const { countClasses, decideDefaultClass } = await import("../scripts/measure-defaults.mjs");
  const cls = (c, n) => Array.from({ length: n }, () => ({ conforming: false, class: c }));
  const records = new Map([
    ["a.ts", { ok: true, hits: { function_naming_case: [...cls("camelCase", 15), ...cls("snake_case", 2)] } }],
    ["b.ts", { ok: true, hits: { function_naming_case: cls("camelCase", 8) } }],
  ]);
  const classes = countClasses(records);
  assert.deepEqual(classes.get("function_naming_case"), { camelCase: 23, snake_case: 2 });
  assert.equal(decideDefaultClass({ camelCase: 23, snake_case: 2 }), "camelCase");
  assert.equal(decideDefaultClass({ camelCase: 12, snake_case: 2 }), null, "under 20 sites is unmeasured");
  assert.equal(decideDefaultClass({ camelCase: 14, snake_case: 7 }), null, "under 0.8 share is no default");
});

test("countSides skips a learned-class hit, whose flag is a placeholder", async () => {
  const records = new Map([
    ["a.ts", { ok: true, hits: { k: [{ conforming: false, class: "camelCase" }, { conforming: false }] } }],
  ]);
  assert.deepEqual(countSides(records).get("k"), { claim: 0, counter: 1 });
});

test("two measured batches of the same model accumulate instead of replacing", async () => {
  const { accumulate } = await import("../scripts/measure-defaults.mjs");
  const a = {
    default: "none",
    provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 18, sideCounts: { claim: 12, counter: 0 } },
  };
  const b = {
    default: "none",
    provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 11, sideCounts: { claim: 9, counter: 1 } },
  };
  const merged = accumulate(a, b);
  assert.deepEqual(merged.provenance.sideCounts, { claim: 21, counter: 1 });
  assert.equal(merged.provenance.samples, 29);
  assert.equal(merged.default, "claim", "21 of 22 clears the floor neither batch cleared alone");

  const c = { default: "none", provenance: { method: "measured", model: "OTHER", samples: 3, sideCounts: { claim: 2, counter: 0 } } };
  assert.equal(accumulate(a, c), null, "a different model is a different question");

  const classes = accumulate(
    { default: "none", class: "camelCase", provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { camelCase: 44, PascalCase: 2 } } },
    { default: "none", provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { camelCase: 10 } } }
  );
  assert.deepEqual(classes.provenance.classCounts, { camelCase: 54, PascalCase: 2 });
  assert.equal(classes.class, "camelCase");
});

test("a class read out of repository text is never written to the table", async () => {
  const { accumulate, decideTableClass } = await import("../scripts/measure-defaults.mjs");

  assert.equal(decideTableClass("function_naming_case", { camelCase: 23, snake_case: 2 }), "camelCase");
  assert.equal(
    decideTableClass("class_base", { ApplicationController: 23, Base: 2 }),
    null,
    "the table's vocabulary is the naming classes, and a superclass name is not one"
  );

  const counts = (n) => ({
    default: "none",
    provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { ApplicationController: n } },
  });

  assert.equal("class" in accumulate(counts(20), counts(10), "class_base"), false, "and two runs do not add one");
});
