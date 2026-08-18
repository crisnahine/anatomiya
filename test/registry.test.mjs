import { test } from "node:test";
import assert from "node:assert/strict";

import { REGISTRY, REGISTRY_KEYS, rowsOfKind, rowsForLangs, rowByKey, assertUniqueKeys } from "../lib/registry.mjs";
import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { PAIRINGS } from "../lib/pairing.mjs";
import { NAMING_CORPUS } from "../lib/dimensions-naming.mjs";

test("the registry is the union of the three lists, once each", () => {
  assert.equal(REGISTRY.length, ALL_DIMENSIONS.length + PAIRINGS.length + NAMING_CORPUS.length);
  assert.equal(REGISTRY_KEYS.size, REGISTRY.length);
});

test("every row is stamped with a kind and the three views partition the registry", () => {
  const kinds = ["tree", "corpus", "pairing"];
  assert.equal(kinds.reduce((n, k) => n + rowsOfKind(k).length, 0), REGISTRY.length);
  for (const row of REGISTRY) assert.ok(kinds.includes(row.kind), row.key);
});

test("rowsForLangs answers pairings and corpus rows as well as tree rows", () => {
  const ruby = rowsForLangs(["ruby"]);
  assert.ok(ruby.some((r) => r.kind === "pairing"));
  assert.ok(rowsForLangs(["js"]).some((r) => r.kind === "corpus"));
  assert.equal(rowByKey("no_such_row"), null);
  assert.equal(rowByKey("module_include").kind, "tree");
});

test("the registry is frozen", () => {
  assert.ok(Object.isFrozen(REGISTRY));
});

test("a key two lists both declare refuses to load", () => {
  // The battery runs over a list and cannot see across three of them, so the
  // collision it is blind to is the one asked here.
  assert.throws(() => assertUniqueKeys([{ key: "twin" }, { key: "twin" }]), /registry declares twin twice/);
  assert.doesNotThrow(() => assertUniqueKeys(REGISTRY));
});

test("a kind nobody declares refuses rather than answering with no rows", () => {
  assert.throws(() => rowsOfKind("corpora"), /registry holds no kind "corpora"/);
});
