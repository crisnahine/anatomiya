import { test } from "node:test";
import assert from "node:assert/strict";

import { REGISTRY, REGISTRY_KEYS, rowsOfKind, rowsForLangs, rowByKey, assertUniqueKeys } from "../plugins/anatomiya/lib/registry.mjs";
import { ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";
import { dimensionsFor } from "../plugins/anatomiya/lib/walk.mjs";
import { PAIRINGS, pairingsFor } from "../plugins/anatomiya/lib/pairing.mjs";
import { NAMING_CORPUS } from "../plugins/anatomiya/lib/dimensions-naming.mjs";

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
      dimensionsFor([lang], { rows: ALL_DIMENSIONS }).length +
      pairingsFor([lang]).length +
      rowsOfKind("corpus").filter((r) => r.langs.includes(lang)).length;

    assert.equal(rowsForLangs([lang]).length, spelled, lang);
  }
});

test("the type-checked tier is never listed, so nobody is handed a claim needing a checker", () => {
  // The same rule `dimensionsFor` carries.
  const semantic = REGISTRY.filter((r) => r.tier === "semantic");
  assert.ok(semantic.length > 0, "there is a tier to leave out");

  const keys = new Set(rowsForLangs(["js", "jsx", "ruby"]).map((r) => r.key));
  for (const row of semantic) assert.equal(keys.has(row.key), false, row.key);
});

test("the registry is frozen", () => {
  assert.ok(Object.isFrozen(REGISTRY));
});

test("a key two lists both declare refuses to load", () => {
  // The battery runs over a list and cannot see across three of them, so the
  // collision it is blind to is the one asked here.
  assert.throws(() => assertUniqueKeys([{ key: "twin" }, { key: "twin" }]), /registry declares twin twice/);
});

test("a kind nobody declares refuses rather than answering with no rows", () => {
  assert.throws(() => rowsOfKind("corpora"), /registry holds no kind "corpora"/);
});

// One question asked of several engines, one key per engine because one key is one predicate (C14, C59, C62, C72).
const SIBLINGS = {
  error: {
    keys: ["swallowed_error", "rescue_uses_error", "caught_error_used"],
    // Each language's own word for the handler.
    said: ["catch blocks use the error they caught", "rescue blocks use the error they caught", "exception handlers use the error they caught"],
  },
  segment: { keys: ["url_segment_case", "route_segment_case", "endpoint_segment_case"] },
  base: {
    keys: ["extends_base", "class_base", "class_inherits"],
    // JavaScript writes `extends`; Ruby and the tree-sitter languages inherit.
    said: ["classes here extend <style>", "classes here inherit <style>", "classes here inherit <style>"],
  },
  logger: {
    keys: ["route_logging", "logger_over_puts", "logger_over_print"],
    // JavaScript's row asks for the repository's own logger, the others for any logger over the language's print (C14, C70).
    said: ["logging goes through the repository's own logger, not the console", "output goes through a logger, not puts", "output goes through a logger, not print"],
  },
  network: {
    keys: ["route_network", "http_through_client"],
    // Each language's own direct call.
    said: ["network calls go through the repository's own client, not fetch directly", "HTTP goes through the repository's own client, not Net::HTTP"],
  },
  returns: {
    keys: ["explicit_return_type", "declared_return_type"],
    // Python and PHP mark no export, so every named function is a site; the other side is a defect in TypeScript and a habit in Python and PHP (C53).
    said: ["exported functions declare their return type", "functions declare what they return"],
    // The JavaScript row's other side is a defect (`REFUSED` in test/fixtures/counter-pins.mjs); Python's and PHP's cleared the bar (C53).
    against: [null, "functions declare no return type"],
  },
  doc: {
    keys: ["doc_comment_style", "public_doc_comment"],
    // Each language's own rule for what is public (C50); the JavaScript counter-claim also stops tutorial-style comments.
    said: ["exported functions and classes carry a doc comment", "public functions carry a doc comment"],
    against: ["code here explains itself; exported functions and classes carry no doc comment", "public functions carry no doc comment"],
  },
};

test("a question several engines ask is asked of each language by one row", () => {
  for (const [concept, { keys }] of Object.entries(SIBLINGS)) {
    const asked = keys.flatMap((key) => rowByKey(key).langs);
    assert.equal(new Set(asked).size, asked.length, `${concept}: ${asked.join(", ")}`);
  }
});

test("siblings learn alike and say alike, and every sentence that differs is written down here", () => {
  for (const [concept, { keys, said, against }] of Object.entries(SIBLINGS)) {
    const rows = keys.map(rowByKey);
    assert.equal(new Set(rows.map((r) => Boolean(r.learnedClasses))).size, 1, `${concept}: learned and fixed rows`);
    const claims = rows.map((r) => r.claim);
    // A set that says one sentence holds no list; one that says several holds each, so an edit to one sibling alone fails.
    if (said === undefined) assert.equal(new Set(claims).size, 1, `${concept}: ${claims.join(" | ")}`);
    else assert.deepEqual(claims, said, concept);
    // A counter-claim ships only where it was measured (C6), so a set that states the other side anywhere holds every sibling's.
    const counters = rows.map((r) => r.counterClaim);
    if (against === undefined) assert.deepEqual(counters, keys.map(() => null), concept);
    else assert.deepEqual(counters, against, concept);
  }
});
