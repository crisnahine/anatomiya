import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installedVersion, manifestVersion, olderThan } from "../plugins/anatomiya/lib/version.mjs";
import { ROOT } from "../scripts/plugins.mjs";

test("a prerelease of the floor version is older than the floor", () => {
  // Measured: `1.0.0.rc1` and `1.0.0-rc.1` both met a 1.0.0 floor. Split on the
  // dot, the first read as 1.0.0 with a part that is not a number, and the
  // second as 1.0.0.1, which is past it. A release candidate comes before the
  // release it is a candidate for, in RubyGems' spelling and in semver's.
  for (const pre of ["1.0.0.rc1", "1.0.0-rc.1", "1.0.0.pre", "1.0.0-alpha", "1.0.0.beta.2"]) {
    assert.equal(olderThan(pre, "1.0.0"), true, pre);
    assert.equal(olderThan("1.0.0", pre), false, `1.0.0 against ${pre}`);
  }
  // A prerelease of a later version is past the floor, and one of an earlier
  // version is below it.
  assert.equal(olderThan("1.1.0.rc1", "1.0.0"), false);
  assert.equal(olderThan("0.30.0-rc.1", "1.0.0"), true);
  // Two candidates of one version are ordered by their numbers.
  assert.equal(olderThan("1.0.0.rc1", "1.0.0.rc2"), true);
  assert.equal(olderThan("1.0.0.rc10", "1.0.0.rc9"), false);
  // Build metadata is not a prerelease.
  assert.equal(olderThan("1.0.0+build.5", "1.0.0"), false);
  // A fourth number is a later version, not a candidate.
  assert.equal(olderThan("1.0.0.1", "1.0.0"), false);
});

test("a manifest's version is read for the package it names, and null for another's, a missing one or one that cannot be parsed", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-manifest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (text) => writeFileSync(join(dir, "package.json"), text);

  assert.equal(manifestVersion(dir, "tree-sitter-go"), null, "no manifest");
  write(JSON.stringify({ name: "tree-sitter-go", version: "0.25.0" }));
  assert.equal(manifestVersion(dir, "tree-sitter-go"), "0.25.0");
  assert.equal(manifestVersion(dir, "tree-sitter-rust"), null, "another package's manifest");
  assert.equal(manifestVersion(dir), "0.25.0", "asked for no package by name, it is whichever the directory holds");
  write(JSON.stringify({ name: "tree-sitter-go" }));
  assert.equal(manifestVersion(dir, "tree-sitter-go"), null, "no version stated");
  write("{");
  assert.equal(manifestVersion(dir, "tree-sitter-go"), null);
  assert.equal(manifestVersion(dir), null);
  assert.equal(installedVersion("oxc-parser"), manifestVersion(join(ROOT, "node_modules", "oxc-parser"), "oxc-parser"));
});
