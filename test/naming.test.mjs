import { test } from "node:test";
import assert from "node:assert/strict";

import { collectHits } from "../lib/walk.mjs";
import { learnClass, verdictFor } from "../lib/reduce.mjs";

/* --- hits carry a class only when the dimension gives one --- */

test("collectHits keeps a hit's class and omits the key otherwise", () => {
  const dim = {
    key: "k",
    run(_program, add) {
      add({ conforming: true, where: null, class: "kebab-case" });
      add({ conforming: false, where: null });
    },
  };
  const hits = collectHits({ type: "Program", body: [] }, [dim]);
  assert.equal(hits.k[0].class, "kebab-case");
  assert.equal("class" in hits.k[1], false);
});

/* --- the majority class --- */

const sites = (cls, n) => Array.from({ length: n }, () => ({ conforming: false, class: cls }));

test("learnClass answers the plurality class", () => {
  const perFile = new Map([
    ["a.ts", sites("kebab-case", 3)],
    ["b.ts", [...sites("kebab-case", 2), ...sites("camelCase", 1)]],
  ]);
  assert.equal(learnClass(perFile), "kebab-case");
});

test("a tie learns nothing", () => {
  const perFile = new Map([
    ["a.ts", sites("kebab-case", 2)],
    ["b.ts", sites("camelCase", 2)],
  ]);
  assert.equal(learnClass(perFile), null);
});

test("a hit with no class does not vote", () => {
  const perFile = new Map([["a.ts", [...sites("snake_case", 1), { conforming: false }]]]);
  assert.equal(learnClass(perFile), "snake_case");
});

/* --- the learned class moving since the pin closes the slot --- */

const gatedDim = (o = {}) => ({
  key: "k", claim: "c", precision: "precise",
  applicability: 10, langFileCount: 12,
  candidates: 60, conforming: 60,
  effectiveFiles: 5, top: { candidates: 12, conforming: 12 },
  files: ["a/1.ts", "a/2.ts", "b/3.ts", "a/4.ts", "b/5.ts"],
  exceptions: [], moreExceptions: 0, ...o,
});

test("a learned class that moved since the pin states nothing", () => {
  const r = verdictFor(gatedDim({ learned: "kebab-case" }), {
    baselineDim: gatedDim({ learned: "camelCase" }),
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.states, null);
  assert.equal(r.directive, false);
  assert.equal(r.gate, "learned-moved");
  assert.equal(r.counterGate, "learned-moved");
});

test("a learned class that held since the pin states as usual", () => {
  const r = verdictFor(gatedDim({ learned: "kebab-case" }), {
    baselineDim: gatedDim({ learned: "kebab-case" }),
    current: { fileCount: 12, dirCount: 2 },
    authors: 3,
  });
  assert.equal(r.states, "claim");
  assert.equal(r.gate, null);
});

/* --- file naming, classified from the basename --- */

test("classifyBasename tells the four classes apart and refuses the ambiguous", async () => {
  const { classifyBasename } = await import("../lib/dimensions-naming.mjs");
  assert.equal(classifyBasename("src/user-profile.ts"), "kebab-case");
  assert.equal(classifyBasename("src/userProfile.ts"), "camelCase");
  assert.equal(classifyBasename("src/UserProfile.tsx"), "PascalCase");
  assert.equal(classifyBasename("app/models/user_profile.rb"), "snake_case");
  assert.equal(classifyBasename("src/index.ts"), null, "a single lowercase word matches every class");
  assert.equal(classifyBasename("Rakefile"), null, "a bare filename is its own convention");
  assert.equal(classifyBasename("src/OrderList.stories.tsx"), "PascalCase", "only the stem is read");
});

test("an area of mostly kebab files states the learned class over every classifiable file", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const rels = [
    "src/user-profile.ts", "src/order-list.ts", "src/data-store.ts", "src/api-client.ts",
    "src/form-input.ts", "src/nav-bar.ts", "src/date-utils.ts", "src/error-page.ts",
    "src/big-table.ts", "src/oneOff.ts",
  ];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));
  const dims = reduceArea(area, parsed);
  const slot = dims.find((d) => d.key === "file_naming_case");
  assert.ok(slot, "the corpus dimension produced a slot");
  assert.equal(slot.learned, "kebab-case");
  assert.equal(slot.claim, "files here are named kebab-case");
  assert.equal(slot.candidates, 10);
  assert.equal(slot.conforming, 9);
  assert.equal(slot.applicability, 10);
  assert.equal(slot.exceptions[0].path, "src/oneOff.ts");
});

test("a naming tie produces no slot at all", async () => {
  const { reduceArea } = await import("../lib/reduce.mjs");
  const rels = ["src/user-profile.ts", "src/orderList.ts"];
  const area = { langs: ["js"], files: rels.map((rel) => ({ rel, lang: "js" })) };
  const parsed = rels.map((rel) => ({ rel, ok: true, hits: {} }));
  assert.equal(reduceArea(area, parsed).find((d) => d.key === "file_naming_case"), undefined);
});
