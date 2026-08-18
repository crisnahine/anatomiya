import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXT_BY_LANG,
  ENGINES,
  MISSING_STRIPPER,
  mayHoldFlow,
  LANGUAGES,
  declOf,
  engineOf,
  language,
  grammarFor,
  langHas,
  assertRegistry,
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
  // A basename that is only a known extension is that extension's language,
  // exactly as the old anchored regexes read it: a tracked `.rb` went to prism
  // and moving it to the fallback engine moved the map.
  assert.equal(language(".rb"), "ruby");
  assert.equal(language("src/.tsx"), "jsx");
  // An unowned dotfile still falls back.
  assert.equal(language(".eslintrc"), "js");
  assert.equal(language(".env"), "js");
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

test("an undeclared id refuses loudly", () => {
  assert.throws(() => declOf("python"), /python/);
});

test("a declaration with positions no reader understands refuses to load", () => {
  const bad = LANGUAGES.map((l) =>
    l.id === "ruby" ? { ...l, positions: { offsets: "utf8", lines: true } } : l
  );
  assert.throws(() => assertRegistry(bad), /utf8/);
});

test("the engine table declares exactly the engines the languages route to", () => {
  assert.deepEqual(Object.keys(ENGINES).sort(), [...new Set(LANGUAGES.map((l) => l.engine))].sort());
  // Keyed by its own id, so a caller holding a row can name it and a caller
  // holding a name can look it up.
  for (const [id, engine] of Object.entries(ENGINES)) assert.equal(engine.id, id, id);
});

test("every engine says what runs it and what to do when it is not there", () => {
  // The two facts the readiness probe branches on. A row missing either was
  // the whole defect: an absent Ruby was answered with the npm sentence.
  for (const engine of Object.values(ENGINES)) {
    assert.ok(engine.host === "node" || engine.host === "interpreter", `${engine.id} hosts nowhere`);
    assert.equal(typeof engine.remedy, "string", engine.id);
    assert.ok(engine.remedy.length > 0, `${engine.id} declares an empty remedy`);
  }
});

test("a declaration naming an engine the table does not hold refuses to load", () => {
  const bad = LANGUAGES.map((l) => (l.id === "ruby" ? { ...l, engine: "treesitter" } : l));
  assert.throws(() => assertRegistry(bad), /ruby names no declared engine: treesitter/);
});

test("the engine a language routes to is read off its declaration", () => {
  assert.equal(engineOf("js"), "oxc");
  assert.equal(engineOf("jsx"), "oxc");
  assert.equal(engineOf("ruby"), "prism");
  assert.throws(() => engineOf("python"), /python/);
});

test("the sentence for an absent stripper names the module the engine declares", () => {
  // Two printers said this, word for word, and a third would have been a third
  // copy. The module name is the declaration's, so it cannot drift from it.
  const stripper = ENGINES.oxc.extras.find((e) => e.role === "stripper");
  assert.ok(MISSING_STRIPPER.startsWith(`${stripper.module} is not installed`), MISSING_STRIPPER);
});

test("capabilities are the closed pair, declared per language", () => {
  assert.equal(langHas("js", "semantic"), true);
  assert.equal(langHas("js", "importGraph"), true);
  assert.equal(langHas("jsx", "importGraph"), true);
  assert.equal(langHas("ruby", "semantic"), false);
  assert.equal(langHas("ruby", "importGraph"), false);
});
