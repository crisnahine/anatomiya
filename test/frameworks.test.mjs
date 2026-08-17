import { test } from "node:test";
import assert from "node:assert/strict";

import { FRAMEWORKS, FRAMEWORK_NAMES, couldSignal } from "../lib/frameworks.mjs";
import { frameworksIn } from "../lib/corpus.mjs";

const files = (rels, lang) => rels.map((rel) => ({ rel, lang }));

test("the set is honest: two profiles both report from one corpus", () => {
  // The old fold broke on the first hit behind a language gate, so no corpus
  // could ever show two frameworks, whatever the Set signature promised.
  const second = { name: "probe", lang: "js", shape: /(^|\/)probe\.config\.js$/ };
  const both = frameworksIn(
    [...files(["app/models/user.rb"], "ruby"), ...files(["probe.config.js"], "js")],
    [...FRAMEWORKS, second]
  );
  assert.deepEqual([...both].sort(), ["probe", "rails"]);
});

test("a profile's signal is asked only of its own language", () => {
  assert.deepEqual([...frameworksIn(files(["app/models/user.js"], "js"))], []);
});

test("the closed name set is what the dimension field is held to", () => {
  assert.deepEqual([...FRAMEWORK_NAMES], ["rails"]);
  assert.ok(couldSignal("ruby"));
  assert.ok(!couldSignal("js"));
});
