import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PRINCIPLE_NAMES } from "../lib/dimensions.mjs";
import { REGISTRY } from "../lib/registry.mjs";
import { readIntake } from "../scripts/check-docs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const intake = readIntake(readFileSync(join(root, "docs/dimension-intake.md"), "utf8"));
const shipped = REGISTRY;

test("the table parses with no structural problem", () => {
  assert.deepEqual(intake.problems, []);
  assert.ok(intake.rows.length > 40, "the table holds the shipped rows and the dropped ones");
});

test("every shipped dimension has exactly one intake row, marked shipped", () => {
  // A dimension that ships without an intake row is a dimension nobody decided
  // to build: the collapse, the rename and the drop were never asked about it.
  for (const d of shipped) {
    const rows = intake.rows.filter((r) => r.key === d.key);
    assert.equal(rows.length, 1, `${d.key} has ${rows.length} intake rows`);
    assert.equal(rows[0].status, "shipped", `${d.key} ships but its intake row says ${rows[0].status}`);
  }
});

test("nothing shipped was dropped", () => {
  const dropped = new Set(intake.rows.filter((r) => r.status === "dropped").map((r) => r.key));
  for (const d of shipped) assert.equal(dropped.has(d.key), false, `${d.key} ships and is also marked dropped`);
});

test("no glossary entry is absorbed by two keys", () => {
  // Two rows claiming one entry is the duplication the collapse exists to stop:
  // they print the same three numbers twice under two names, and every coverage
  // count taken from the result is inflated.
  const owner = new Map();
  for (const r of intake.rows) {
    for (const entry of r.absorbs) {
      const previous = owner.get(entry);
      assert.equal(previous, undefined, `"${entry}" is absorbed by both ${previous} and ${r.key ?? "a dropped row"}`);
      owner.set(entry, r.key ?? "a dropped row");
    }
  }
});

test("no rendered sentence carries a principle's name", () => {
  // A ratio next to "Postel's Law" reads as an endorsement of the principle
  // rather than as a count of sites. The claim is what the agent reads, so the
  // claim is what this checks.
  for (const d of shipped) {
    for (const sentence of [d.claim, d.counterClaim].filter(Boolean)) {
      for (const name of PRINCIPLE_NAMES) {
        assert.equal(
          sentence.toLowerCase().includes(name.toLowerCase()),
          false,
          `${d.key} renders "${sentence}", which names the principle "${name}"`
        );
      }
    }
  }
});

test("a dropped row and a renamed row both carry a reason", () => {
  for (const r of intake.rows) {
    if (r.status === "dropped") {
      assert.ok(r.why.length > 10, `a dropped row for "${r.absorbs.join("; ")}" gives no reason`);
    }
    if (r.renamedFrom !== "-") assert.ok(r.why.length > 10, `${r.key} was renamed and gives no reason`);
  }
});

test("every planned row says which entries it absorbs", () => {
  // A planned row with no entries is a row invented here rather than taken from
  // the audit, and the point of the table is to record where each one came from.
  for (const r of intake.rows.filter((x) => x.status === "planned")) {
    assert.ok(r.absorbs.length >= 1, `${r.key} is planned and absorbs nothing`);
  }
});

test("the parser reports a row it cannot read instead of dropping it", () => {
  // A row with the wrong cell count or an unknown status is a row somebody
  // edited by hand and got wrong. Skipping it silently means the key it names
  // is simply absent, and the "ships with no intake row" claim then fires
  // somewhere far from the actual mistake.
  const table = [
    "| key | absorbs | renamed from | status | why |",
    "|---|---|---|---|---|",
    "| good | An entry | - | shipped | |",
    "| short | An entry | - | shipped |",
    "| odd_status | An entry | - | maybe | |",
  ].join("\n");

  const { rows, problems } = readIntake(table);

  assert.deepEqual(rows.map((r) => r.key), ["good"]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /4 cells, not 5/);
  assert.match(problems[1], /odd_status has status "maybe"/);
});

test("the parser says so when there is no table at all", () => {
  const { rows, problems } = readIntake("# Dimension intake\n\nnothing here yet\n");
  assert.deepEqual(rows, []);
  assert.match(problems[0], /no table header row/);
});

test("the parser reads the columns it promises", () => {
  const table = [
    "| key | absorbs | renamed from | status | why |",
    "|---|---|---|---|---|",
    "| one | A; B ; C | Old Name | planned | a reason long enough to count |",
    "| - | D | - | dropped | no denominator anywhere |",
  ].join("\n");

  const { rows, problems } = readIntake(table);

  assert.deepEqual(problems, []);
  assert.deepEqual(rows[0], {
    key: "one",
    absorbs: ["A", "B", "C"],
    renamedFrom: "Old Name",
    status: "planned",
    why: "a reason long enough to count",
  });
  assert.equal(rows[1].key, null, "a dropped row names no key");
  assert.deepEqual(rows[1].absorbs, ["D"]);
});
