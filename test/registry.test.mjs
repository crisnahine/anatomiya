import { test } from "node:test";
import assert from "node:assert/strict";

import { REGISTRY, REGISTRY_KEYS, rowsOfKind, rowsForLangs, rowByKey, assertUniqueKeys } from "../lib/registry.mjs";
import { ALL_DIMENSIONS, dimensionsFor } from "../lib/dimensions.mjs";
import { PAIRINGS, pairingsFor } from "../lib/pairing.mjs";
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

test("rowsForLangs is the union its readers used to spell by hand", () => {
  // The docs checker added three views of the registry together, once per
  // language, which is the pattern this module exists to stop. They did not
  // meet because this one had no tier filter and every real reader needs one.
  for (const lang of ["js", "jsx", "ruby"]) {
    const spelled =
      dimensionsFor([lang]).length +
      pairingsFor([lang]).length +
      rowsOfKind("corpus").filter((r) => r.langs.includes(lang)).length;

    assert.equal(rowsForLangs([lang]).length, spelled, lang);
  }
});

test("the tier is opt-in here too, so nobody is handed a claim needing a checker", () => {
  // The same rule `dimensionsFor` carries: a caller that does not ask for the
  // type-checked tier must never be handed one of its rows.
  const semantic = REGISTRY.filter((r) => r.tier === "semantic");
  assert.ok(semantic.length > 0, "there is a tier to leave out");

  const keys = new Set(rowsForLangs(["js", "jsx", "ruby"]).map((r) => r.key));
  for (const row of semantic) assert.equal(keys.has(row.key), false, row.key);

  const all = new Set(rowsForLangs(["js", "jsx", "ruby"], { tier: "all" }).map((r) => r.key));
  for (const row of semantic) assert.equal(all.has(row.key), true, row.key);
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
