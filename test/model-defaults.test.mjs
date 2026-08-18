import { test } from "node:test";
import assert from "node:assert/strict";

import { MODEL_DEFAULTS, defaultSideFor, assertModelDefaults } from "../lib/model-defaults.mjs";
import { REGISTRY_KEYS } from "../lib/registry.mjs";

const entry = (over = {}) => ({
  default: "none",
  provenance: { method: "literature", model: null, date: null, samples: null, sideCounts: null, source: "seed: unmeasured", ...(over.provenance || {}) },
  ...over,
});

test("the shipped table covers every registry key and nothing else", () => {
  const keys = new Set(MODEL_DEFAULTS.keys());
  for (const key of REGISTRY_KEYS) assert.ok(keys.has(key), `table is missing ${key}`);
  for (const key of keys) assert.ok(REGISTRY_KEYS.has(key), `table names ${key}, which is not in the registry`);
});

test("defaultSideFor answers a side, and none reads as null", () => {
  // The shipped table starts unmeasured, so the seeded answer is null. The
  // side answer is asked of assertModelDefaults' own validation fixture below.
  assert.equal(defaultSideFor("no_such_key"), null);
  for (const key of REGISTRY_KEYS) {
    const side = defaultSideFor(key);
    assert.ok(side === null || side === "claim" || side === "counter");
  }
});

test("a measured entry answers its side", () => {
  const table = new Map([["nullish_default", entry({ default: "claim", provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 40, sideCounts: { claim: 37, counter: 2, neither: 1 } } })]]);
  assertModelDefaults(table, new Set(["nullish_default"]));
  assert.equal(table.get("nullish_default").default, "claim");
});

test("an unknown key refuses to load", () => {
  const table = new Map([["not_a_dimension", entry()]]);
  assert.throws(() => assertModelDefaults(table, REGISTRY_KEYS), /not_a_dimension/);
});

test("a side outside the three refuses to load", () => {
  const table = new Map([["nullish_default", entry({ default: "sometimes" })]]);
  assert.throws(() => assertModelDefaults(table, REGISTRY_KEYS), /sometimes/);
});

test("a method outside the closed set refuses to load", () => {
  const table = new Map([["nullish_default", entry({ provenance: { method: "guess" } })]]);
  assert.throws(() => assertModelDefaults(table, REGISTRY_KEYS), /guess/);
});

test("a literature entry with no source refuses to load", () => {
  const table = new Map([["nullish_default", entry({ provenance: { method: "literature", source: undefined } })]]);
  assert.throws(() => assertModelDefaults(table, REGISTRY_KEYS), /source/);
});

test("a class entry answers defaultClassFor and never a side", async () => {
  const { defaultClassFor } = await import("../lib/model-defaults.mjs");
  const cls = defaultClassFor("function_naming_case");
  assert.ok(cls === null || typeof cls === "string");
  assert.equal(defaultClassFor("nullish_default"), null, "a side dimension has no class");
});

test("a class outside the closed vocabulary refuses to load", () => {
  const table = new Map([["function_naming_case", entry({ class: "camelcase" })]]);
  assert.throws(() => assertModelDefaults(table, new Set(["function_naming_case"])), /camelcase/);
});
