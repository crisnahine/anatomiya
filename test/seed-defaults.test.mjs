import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seedEntry, seedTable } from "../scripts/seed-defaults.mjs";
import { assertModelDefaults } from "../plugins/anatomiya/lib/model-defaults.mjs";
import { REGISTRY_KEYS } from "../plugins/anatomiya/lib/registry.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

test("a key with no entry is seeded and a key that has one is left as it stands", () => {
  const measured = { default: "claim", provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 30, sideCounts: { claim: 24, counter: 0 } } };

  const { table, added } = seedTable({ a: measured }, ["a", "b"]);

  assert.deepEqual(added, ["b"]);
  assert.equal(table.a, measured, "a held entry is the same entry, never rewritten");
  assert.deepEqual(table.b, seedEntry());
});

test("seeding a table that is already whole adds nothing", () => {
  // The idempotence the checker's remedy rests on: an author told to run the
  // seeder has to be able to run it on a table that is already complete.
  const once = seedTable({}, ["a", "b"]).table;

  const twice = seedTable(once, ["a", "b"]);

  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.table, once);
});

test("a key spelling a name every object inherits is still seeded", () => {
  // `"constructor" in {}` is true, so a row named after one would read as held
  // and never be written.
  const { table, added } = seedTable({}, ["constructor"]);

  assert.deepEqual(added, ["constructor"]);
  assert.deepEqual(table.constructor, seedEntry());
});

test("the seeded table is one the loader accepts, and every seeded row reads none", () => {
  const { table } = seedTable({}, [...REGISTRY_KEYS]);

  assertModelDefaults(new Map(Object.entries(table)), REGISTRY_KEYS);
  for (const key of REGISTRY_KEYS) assert.equal(table[key].default, "none", key);
});

test("the shipped table is already whole, so the seeder is a no-op on it", () => {
  // `git diff --quiet` on the table after a run is the same claim, with a
  // working tree to read it from.
  const table = JSON.parse(readFileSync(join(ANATOMIYA, "lib", "model-defaults.json"), "utf8"));

  assert.deepEqual(seedTable(table, [...REGISTRY_KEYS]).added, []);
});
