import { test } from "node:test";
import assert from "node:assert/strict";

import { baseOf, dirOf, withoutExtension } from "../lib/paths.mjs";

test("the basename is everything after the last slash", () => {
  assert.equal(baseOf("src/components/Foo.tsx"), "Foo.tsx");
  assert.equal(baseOf("Rakefile"), "Rakefile");
});

test("the directory is empty at the top level, never a dot", () => {
  assert.equal(dirOf("src/components/Foo.tsx"), "src/components");
  assert.equal(dirOf("Rakefile"), "");
});

test("only an extension in the basename is stripped", () => {
  assert.equal(withoutExtension("src/components/Foo.tsx"), "src/components/Foo");
  assert.equal(withoutExtension("src/a.b/Rakefile"), "src/a.b/Rakefile");
  assert.equal(withoutExtension("app/models/user.rb"), "app/models/user");
});
