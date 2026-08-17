import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXT_BY_LANG,
  mayHoldFlow,
  LANGUAGES,
  declOf,
  language,
  grammarFor,
  mayRetryDialect,
  langHas,
} from "../lib/langs.mjs";

test("the Flow retry covers every JavaScript extension the corpus accepts", () => {
  // The retry used to carry its own list of extensions, so adding one to the
  // table above left it silently uncovered: the file entered the corpus, oxc
  // rejected it, and nothing retried it. The expectation here is written out
  // rather than derived, so the two cannot drift together.
  const TYPESCRIPT = new Set(["ts", "mts", "cts", "tsx"]);

  for (const ext of [...EXT_BY_LANG.js, ...EXT_BY_LANG.jsx]) {
    assert.equal(mayHoldFlow(`src/a.${ext}`), !TYPESCRIPT.has(ext), `.${ext}`);
  }
});

test("Flow is not looked for outside the JavaScript family", () => {
  for (const ext of EXT_BY_LANG.ruby) assert.equal(mayHoldFlow(`app/a.${ext}`), false, `.${ext}`);
  assert.equal(mayHoldFlow("README.md"), false);
  // The extension is the end of the name, not a substring of it.
  assert.equal(mayHoldFlow("src/a.js.snap"), false);
});

test("the registry declares three languages, frozen, in engine-group order", () => {
  assert.deepEqual(
    LANGUAGES.map((l) => l.id),
    ["js", "jsx", "ruby"]
  );
  for (const decl of LANGUAGES) assert.ok(Object.isFrozen(decl), decl.id);
});

test("language answers by extension, then whole filename, then the fallback", () => {
  for (const decl of LANGUAGES) {
    for (const ext of decl.exts) assert.equal(language(`src/a.${ext}`), decl.id, `.${ext}`);
    for (const name of decl.filenames) {
      assert.equal(language(name), decl.id, name);
      assert.equal(language(`sub/${name}`), decl.id, `sub/${name}`);
    }
  }
  // Matched whole, so a lockfile is not its Gemfile.
  assert.equal(language("Gemfile.lock"), "js");
  // The fallback is a declared fact, not a dangling else.
  assert.deepEqual(
    LANGUAGES.filter((l) => l.fallback).map((l) => l.id),
    ["js"]
  );
});

test("the grammar follows the real extension, never the language", () => {
  for (const ext of ["ts", "mts", "cts"]) assert.equal(grammarFor("js", `a.${ext}`), "ts", `.${ext}`);
  for (const ext of ["js", "mjs", "cjs"]) assert.equal(grammarFor("js", `a.${ext}`), "tsx", `.${ext}`);
  assert.equal(grammarFor("jsx", "a.tsx"), "tsx");
  assert.equal(grammarFor("jsx", "a.jsx"), "tsx");
  assert.equal(grammarFor("ruby", "a.rb"), "rb");
  // The check hands rels under a revision prefix; the extension still decides.
  assert.equal(grammarFor("js", "head:src/x.ts"), "ts");
});

test("a scratch name routes back to its own declaration", () => {
  for (const decl of LANGUAGES) assert.equal(language(`x.${decl.scratchExt}`), decl.id, decl.id);
});

test("the dialect retry answers the old table, asked through the registry", () => {
  for (const ext of [...EXT_BY_LANG.js, ...EXT_BY_LANG.jsx]) {
    const path = `src/a.${ext}`;
    assert.equal(mayRetryDialect(language(path), path), mayHoldFlow(path), `.${ext}`);
  }
  assert.equal(mayRetryDialect("ruby", "app/a.rb"), false);
  assert.equal(mayRetryDialect("js", "src/a.js.snap"), false);
});

test("an undeclared id refuses loudly", () => {
  assert.throws(() => declOf("python"), /python/);
});

test("capabilities are the closed pair, declared per language", () => {
  assert.equal(langHas("js", "semantic"), true);
  assert.equal(langHas("js", "importGraph"), true);
  assert.equal(langHas("jsx", "importGraph"), true);
  assert.equal(langHas("ruby", "semantic"), false);
  assert.equal(langHas("ruby", "importGraph"), false);
});
