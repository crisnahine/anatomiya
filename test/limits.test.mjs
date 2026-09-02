import { test } from "node:test";
import assert from "node:assert/strict";
import { guardsOver } from "../plugins/anatomiya/lib/limits.mjs";

test("a bag is read over a bridge's defaults by one rule", () => {
  // Three bridges each spelled this: a name the defaults do not carry refused
  // by engine, an explicit undefined never erasing a default, and the defaults
  // themselves left untouched.
  const defaults = { idleMs: 15_000, maxBytes: 1024 };

  assert.deepEqual(guardsOver(defaults, { idleMs: 50 }, "prism"), { idleMs: 50, maxBytes: 1024 });
  assert.deepEqual(guardsOver(defaults, { idleMs: undefined }, "prism"), defaults);
  assert.deepEqual(guardsOver(defaults, null, "prism"), defaults);
  assert.notEqual(guardsOver(defaults, null, "prism"), defaults, "a copy, so a caller cannot move a default");
  assert.throws(() => guardsOver(defaults, { idleMS: 50 }, "prism"), /idleMS is not one of the prism guards: idleMs, maxBytes/);
  assert.deepEqual(defaults, { idleMs: 15_000, maxBytes: 1024 });
});
