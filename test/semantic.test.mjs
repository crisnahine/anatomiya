// test/semantic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTypeScript, notInstalledMessage } from "../lib/semantic.mjs";

test("the loader answers null rather than throwing when typescript is absent", async () => {
  // A user who never asked for --deep must not pay for this dependency, so an
  // absent one is an ordinary state and not a crash.
  const got = await loadTypeScript({ specifier: "typescript-that-is-not-installed" });
  assert.equal(got, null);
});

test("the loader answers the module and its version when it is there", async () => {
  const got = await loadTypeScript();
  if (got === null) return; // the optional dependency is not installed here
  assert.equal(typeof got.ts.createProgram, "function");
  assert.match(got.version, /^5\./, "the range is pinned to major 5");
});

test("the refusal names the install command and the flag that needs it", () => {
  const m = notInstalledMessage();
  assert.match(m, /--deep/);
  assert.match(m, /npm install/);
});
