import { test } from "node:test";
import assert from "node:assert/strict";
import { byCode } from "../plugins/anatomiya/lib/paths.mjs";

import { baseOf, dirOf, extOf, stemOf, withoutExtension } from "../plugins/anatomiya/lib/paths.mjs";

test("the basename is everything after the last slash", () => {
  assert.equal(baseOf("src/components/Foo.tsx"), "Foo.tsx");
  assert.equal(baseOf("Rakefile"), "Rakefile");
});

test("the directory is empty at the top level, never a dot", () => {
  assert.equal(dirOf("src/components/Foo.tsx"), "src/components");
  assert.equal(dirOf("Rakefile"), "");
});

test("a dotfile is a name with no extension, on both halves of the split", () => {
  // The three copies this consolidates all answered it this way, and the roster
  // reads both halves of one file: `.env` counts under `(none)` beside a
  // Rakefile, and its stem is the whole name, so a `.env.test` never reads as
  // the namesake of a file called `.env`.
  assert.equal(extOf(".env"), "(none)");
  assert.equal(stemOf(".env"), ".env");
  assert.equal(withoutExtension(".env"), ".env", "stripping the leading dot leaves no name at all");
});

test("the extension is everything from the last dot of the basename", () => {
  assert.equal(extOf("src/components/Foo.tsx"), ".tsx");
  assert.equal(extOf("Rakefile"), "(none)");
  assert.equal(extOf("src/a.b/Rakefile"), "(none)", "a dot in a directory is not this file's extension");
});

test("the stem is the basename without that extension", () => {
  assert.equal(stemOf("src/components/Foo.test.tsx"), "Foo.test");
  assert.equal(stemOf("app/models/user.rb"), "user");
  assert.equal(stemOf("Rakefile"), "Rakefile");
});

test("only an extension in the basename is stripped", () => {
  assert.equal(withoutExtension("src/components/Foo.tsx"), "src/components/Foo");
  assert.equal(withoutExtension("src/a.b/Rakefile"), "src/a.b/Rakefile");
  assert.equal(withoutExtension("app/models/user.rb"), "app/models/user");
});

test("the three splits agree about where a declaration file's extension starts", () => {
  // Left to the one-dot rule, this answers `packages/types/index.d`, which no
  // longer ends in `/index`, and the sibling index stops resolving a directory
  // through its own entry file.
  // Written out rather than recomputed from `dirOf` and `stemOf`: reading the
  // expectation off the same module the assertion tests leaves a loop that
  // passes whenever all three move together, which is exactly the drift the
  // shared split exists to prevent.
  assert.equal(withoutExtension("packages/types/index.d.ts"), "packages/types/index");
  assert.equal(withoutExtension("src/types/image.d.ts"), "src/types/image");
  assert.equal(withoutExtension("src/abcd.ts"), "src/abcd", "a stem merely ending in d is not a declaration");
  assert.equal(withoutExtension("src/types/image.d.js"), "src/types/image.d", "JavaScript has no declaration file");
  assert.equal(withoutExtension("Rakefile"), "Rakefile");
  assert.equal(withoutExtension(".env"), ".env");
});

test("a TypeScript declaration file's extension is the whole .d.ts suffix", () => {
  assert.equal(extOf("src/types/image.d.ts"), ".d.ts");
  assert.equal(extOf("src/types/image.d.mts"), ".d.mts");
  assert.equal(extOf("src/types/image.d.cts"), ".d.cts");
  // Declarations are a TypeScript idiom; a plain .ts keeps its one-dot rule.
  assert.equal(extOf("src/abcd.ts"), ".ts", "a stem that merely ends in d is not a declaration");
  assert.equal(extOf("src/types/image.d.js"), ".js", "JavaScript has no declaration file of its own");
});

test("a declaration file's stem drops the whole .d.ts suffix, not just the last dot", () => {
  assert.equal(stemOf("src/types/image.d.ts"), "image");
  assert.equal(stemOf("src/types/image.d.mts"), "image");
  assert.equal(stemOf("src/types/image.d.cts"), "image");
  assert.equal(stemOf("src/abcd.ts"), "abcd");
  assert.equal(stemOf("src/types/image.d.js"), "image.d");
});

test("a tie that decides a printed name is broken by code point, the same on every host", () => {
  // `localeCompare` orders case by whatever ICU tables the host was built
  // with; three modules carried this comparator privately and a fourth still
  // called `localeCompare` on a name that lands in a finding.
  assert.deepEqual(["b", "B", "a", "A"].sort(byCode), ["A", "B", "a", "b"]);
  assert.equal(byCode("x", "x"), 0);
});
