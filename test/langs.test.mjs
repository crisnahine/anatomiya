import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXT_BY_LANG,
  ENGINES,
  MISSING_STRIPPER,
  mayHoldFlow,
  mayBeCommonJS,
  mayHoldDirectives,
  LANGUAGES,
  declOf,
  engineOf,
  language,
  grammarFor,
  langHas,
  assertRegistry,
  familyOf,
  embeddedIn,
  placeTestsOf,
  exportLetIsProp,
  templateMountsByName,
  EXTRACTORS,
  assertKeyed,
  hostedBy,
} from "../plugins/anatomiya/lib/langs.mjs";

import { scriptBlocks } from "../plugins/anatomiya/lib/script-blocks.mjs";

const TREE_SITTER = ["python", "php", "go", "java", "csharp", "rust", "kotlin"];

test("a language tree-sitter reads declares its extensions, one grammar named after it, and nothing it cannot answer", () => {
  const EXTS = { python: ["py"], php: ["php"], go: ["go"], java: ["java"], csharp: ["cs"], rust: ["rs"], kotlin: ["kt", "kts"] };
  for (const id of TREE_SITTER) {
    const decl = declOf(id);
    assert.deepEqual(decl.exts, EXTS[id], id);
    assert.deepEqual(decl.filenames, [], id);
    assert.equal(decl.fallback, false, id);
    for (const ext of decl.exts) assert.equal(grammarFor(id, `src/a.${ext}`), id, `.${ext}`);
    assert.deepEqual(decl.positions, { offsets: "utf16", lines: false }, id);
    assert.equal(langHas(id, "semantic"), false, id);
    assert.equal(langHas(id, "importGraph"), false, id);
    assert.equal(decl.dialect, null, id);
    assert.equal(decl.commonjs, null, id);
    assert.equal(decl.typed, null, id);
  }
  // A stub describes types rather than anything anyone wrote.
  assert.equal(language("src/a.pyi"), "js");
  assert.deepEqual(ENGINES["tree-sitter"], {
    id: "tree-sitter",
    host: "node",
    module: "web-tree-sitter",
    remedy: "node bin/anatomiya.mjs setup in the plugin directory",
    rejects: "grammar",
  });
});

test("an engine says what its rejecting a file means: the language's own parser, or a grammar that covers less", () => {
  assert.deepEqual(Object.fromEntries(Object.values(ENGINES).map((e) => [e.id, e.rejects])), { oxc: "syntax", prism: "syntax", "tree-sitter": "grammar" });
});

test("only C# is retried with one branch of its conditionals, and the retry is asked of the path", () => {
  for (const decl of LANGUAGES) assert.deepEqual(decl.directives, decl.id === "csharp" ? { exts: ["cs"] } : null, decl.id);
  assert.equal(Object.isFrozen(declOf("csharp").directives) && Object.isFrozen(declOf("csharp").directives.exts), true);
  assert.equal(mayHoldDirectives("src/A.cs"), true);
  for (const decl of LANGUAGES.filter((l) => l.id !== "csharp")) {
    for (const ext of decl.exts) assert.equal(mayHoldDirectives(`src/a.${ext}`), false, `.${ext}`);
  }
  assert.equal(mayHoldDirectives("src/A.cs.orig"), false);
  assert.equal(mayHoldFlow("src/A.cs"), false, "one dialect's extensions are not another's");
});

test("a declaration retrying directives for an extension it does not own, or on an engine with no such retry, refuses to load", () => {
  const unowned = LANGUAGES.map((l) => (l.id === "csharp" ? { ...l, directives: { exts: ["rs"] } } : l));
  assert.throws(() => assertRegistry(unowned), /csharp retries directives for \.rs, which it does not own/);
  const elsewhere = LANGUAGES.map((l) => (l.id === "ruby" ? { ...l, directives: { exts: ["rb"] } } : l));
  assert.throws(() => assertRegistry(elsewhere), /ruby retries directives, which only tree-sitter does, and routes to prism/);
});

test("only Rust has a tool that collects a file as a test by the directory it sits in, and the layout asks the declaration", () => {
  const cargo = { dir: "tests", runner: "cargo test", manifest: "Cargo.toml", sources: "src" };
  for (const decl of LANGUAGES) assert.deepEqual(decl.placeTests, decl.id === "rust" ? cargo : null, decl.id);
  assert.equal(Object.isFrozen(declOf("rust").placeTests), true);
  assert.deepEqual(placeTestsOf("rust"), cargo);
  assert.equal(placeTestsOf("go"), null);
  // B21: the fact, all four parts, is read off the declaration, so the layout spells no language id and no file of cargo's.
  const layout = readFileSync(new URL("../plugins/anatomiya/lib/layout.mjs", import.meta.url), "utf8");
  assert.deepEqual(layout.match(/["'`](?:python|php|go|java|csharp|rust|kotlin|vue|svelte|ruby|js|jsx)["'`]/g), null);
  assert.equal(layout.includes("Cargo.toml"), false);
});

test("a declaration whose place tests name no directory or no runner refuses to load", () => {
  const with_ = (placeTests) => LANGUAGES.map((l) => (l.id === "rust" ? { ...l, placeTests } : l));
  assert.throws(() => assertRegistry(with_({ dir: "tests" })), /rust collects tests by place and names no runner/);
  assert.throws(() => assertRegistry(with_({ dir: "", runner: "cargo test" })), /rust collects tests by place and names no directory/);
  assert.throws(() => assertRegistry(with_(undefined)), /rust does not say whether a tool collects its tests by place/);
  assert.throws(() => assertRegistry(with_({ dir: "tests", runner: "cargo test", sources: "src" })), /rust collects tests by place and names no manifest/);
  assert.throws(() => assertRegistry(with_({ dir: "tests", runner: "cargo test", manifest: "Cargo.toml" })), /rust collects tests by place and names no source directory/);
});

test("what a component's unread markup changes about its script is the declaration's to say, and is asked of the path", () => {
  for (const decl of LANGUAGES) {
    const said = { vue: { propsByExportLet: false, mountsByName: true }, svelte: { propsByExportLet: true, mountsByName: false } }[decl.id] ?? null;
    assert.deepEqual(decl.markup, said, decl.id);
  }
  assert.equal(Object.isFrozen(declOf("vue").markup), true);
  assert.equal(exportLetIsProp("src/Card.svelte"), true);
  assert.equal(templateMountsByName("src/Card.vue"), true);
  for (const rel of ["src/Card.vue", "src/state.svelte.ts", "src/a.ts", "Card.svelte/a.js", ""]) assert.equal(exportLetIsProp(rel), false, rel);
  for (const rel of ["src/Card.svelte", "src/a.tsx", "Card.vue/a.js", ""]) assert.equal(templateMountsByName(rel), false, rel);
  // B21: the two rows that ask spell neither extension.
  for (const module of ["walk.mjs", "dimensions-naming.mjs"]) {
    const src = readFileSync(new URL(`../plugins/anatomiya/lib/${module}`, import.meta.url), "utf8");
    assert.deepEqual(src.match(/\\\.(?:vue|svelte)\$/g), null, module);
  }
});

test("a declaration that does not say what its markup changes, or says it of a file with no markup, refuses to load", () => {
  const with_ = (id, markup) => LANGUAGES.map((l) => (l.id === id ? { ...l, markup } : l));
  assert.throws(() => assertRegistry(with_("svelte", null)), /svelte embeds its script and does not say what its markup changes/);
  assert.throws(() => assertRegistry(with_("svelte", { propsByExportLet: true })), /svelte does not say whether its markup mountsByName/);
  assert.throws(() => assertRegistry(with_("vue", { propsByExportLet: "no", mountsByName: true })), /vue does not say whether its markup propsByExportLet/);
  assert.throws(() => assertRegistry(with_("go", { propsByExportLet: false, mountsByName: false })), /go has no markup to change its script/);
  assert.throws(() => assertRegistry(with_("js", undefined)), /js has no markup to change its script/);
});

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

test("only .js and .cjs may run under Node's own CommonJS wrapper", () => {
  assert.equal(mayBeCommonJS("src/a.js"), true);
  assert.equal(mayBeCommonJS("src/a.cjs"), true);
  // Node always loads .mjs as ESM, whatever a package.json says.
  assert.equal(mayBeCommonJS("src/a.mjs"), false);
  // TypeScript rejects a top-level return as source, before any module format
  // is chosen, so neither .ts nor .tsx can hold the legal version of it.
  assert.equal(mayBeCommonJS("src/a.ts"), false);
  assert.equal(mayBeCommonJS("src/a.tsx"), false);
  assert.equal(mayBeCommonJS("src/a.jsx"), false);
  for (const ext of EXT_BY_LANG.ruby) assert.equal(mayBeCommonJS(`app/a.${ext}`), false, `.${ext}`);
});

test("the registry declares twelve languages, frozen, in engine-group order", () => {
  assert.deepEqual(
    LANGUAGES.map((l) => l.id),
    ["js", "jsx", "vue", "svelte", "ruby", "python", "php", "go", "java", "csharp", "rust", "kotlin"]
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

test("a component file is its own language, and a module named after the framework is not", () => {
  assert.equal(language("src/App.vue"), "vue");
  assert.equal(language("src/routes/+page.svelte"), "svelte");
  // A rune module is plain TypeScript the compiler reads whole: no block to cut.
  assert.equal(language("src/state.svelte.ts"), "js");
  assert.equal(language("src/state.svelte.js"), "js");
});

test("every language names the family a test of it may be written in", () => {
  // The engine was the proxy, and it is one family only while each engine
  // hosts one: a component is tested by a plain `.ts` file, a script is not
  // tested by a Ruby spec.
  for (const id of ["js", "jsx", "vue", "svelte"]) assert.equal(familyOf(id), "js", id);
  assert.equal(familyOf("ruby"), "ruby");
  // Seven languages on one engine, and a Go test is no test of a Python file.
  for (const id of TREE_SITTER) assert.equal(familyOf(id), id, id);
  assert.throws(() => familyOf("swift"), /swift/);
});

test("only the two component languages name a script extractor", () => {
  assert.equal(embeddedIn("vue"), "vue");
  assert.equal(embeddedIn("svelte"), "svelte");
  for (const id of ["js", "jsx", "ruby", ...TREE_SITTER]) assert.equal(embeddedIn(id), null, id);
});

test("a component language retries no dialect and claims no checker", () => {
  for (const id of ["vue", "svelte"]) {
    const decl = declOf(id);
    assert.deepEqual(decl.exts, [id]);
    assert.equal(decl.scratchExt, id);
    assert.equal(decl.fallback, false);
    assert.equal(decl.dialect, null);
    assert.equal(decl.commonjs, null);
    assert.equal(decl.typed, null);
    // The checker is handed paths, and it cannot open one of these.
    assert.equal(langHas(id, "semantic"), false);
    assert.equal(langHas(id, "importGraph"), true);
    assert.equal(mayHoldFlow(`src/A.${id}`), false);
    assert.equal(mayBeCommonJS(`src/A.${id}`), false);
  }
});

test("a declaration with no family refuses to load", () => {
  const bad = LANGUAGES.map((l) => (l.id === "ruby" ? { ...l, family: undefined } : l));
  assert.throws(() => assertRegistry(bad), /ruby names no family/);
});

test("a declaration naming an extractor nothing implements refuses to load", () => {
  const bad = LANGUAGES.map((l) => (l.id === "vue" ? { ...l, embedded: "astro" } : l));
  assert.throws(() => assertRegistry(bad), /vue names no script extractor: astro/);
  const absent = LANGUAGES.map((l) => (l.id === "js" ? { ...l, embedded: undefined } : l));
  assert.throws(() => assertRegistry(absent), /js names no script extractor: undefined/);
});

test("the extractors a declaration may name are the ones the scanner implements, and an unknown one is refused by name", () => {
  assert.deepEqual(EXTRACTORS, ["vue", "svelte"]);
  assert.equal(Object.isFrozen(EXTRACTORS), true);
  for (const kind of EXTRACTORS) assert.deepEqual(scriptBlocks("", kind), { blocks: [], unterminated: false }, kind);
  assert.throws(() => scriptBlocks("<script>a</script>", "astro"), /no script extractor named astro/);
  assert.throws(() => scriptBlocks("<script>a</script>", undefined), /no script extractor named undefined/);
});

test("an embedded language on an engine that cannot read its blocks refuses to load", () => {
  const bad = LANGUAGES.map((l) => (l.id === "svelte" ? { ...l, engine: "prism" } : l));
  assert.throws(() => assertRegistry(bad), /svelte embeds its script, which only oxc reads, and routes to prism/);
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

test("a .d.ts/.d.mts/.d.cts file routes to its own declaration grammar", () => {
  assert.equal(grammarFor("js", "src/a.d.ts"), "d.ts");
  assert.equal(grammarFor("js", "src/a.d.mts"), "d.mts");
  assert.equal(grammarFor("js", "src/a.d.cts"), "d.cts");
  // The check hands rels under a revision prefix; the suffix still decides.
  assert.equal(grammarFor("js", "head:src/a.d.ts"), "d.ts");
  assert.equal(grammarFor("js", "src/abcd.ts"), "ts", "a stem that merely ends in d is not a declaration");
  assert.equal(grammarFor("jsx", "src/a.d.tsx"), "tsx", "jsx has no declaration grammar to route to");
});

test("a scratch name routes back to its own declaration", () => {
  for (const decl of LANGUAGES) assert.equal(language(`x.${decl.scratchExt}`), decl.id, decl.id);
});

test("an undeclared id refuses loudly", () => {
  assert.throws(() => declOf("swift"), /swift/);
});

test("a declaration retrying a commonjs wrapper for an extension it does not own refuses to load", () => {
  const bad = LANGUAGES.map((l) => (l.id === "js" ? { ...l, commonjs: { exts: ["rb"] } } : l));
  assert.throws(() => assertRegistry(bad), /js retries a commonjs wrapper for \.rb, which it does not own/);
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
  assert.equal(engineOf("vue"), "oxc");
  assert.equal(engineOf("svelte"), "oxc");
  assert.equal(engineOf("ruby"), "prism");
  for (const id of TREE_SITTER) assert.equal(engineOf(id), "tree-sitter", id);
  assert.throws(() => engineOf("swift"), /swift/);
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

test("with no facets, type syntax is the path's answer, and only the typed half says yes", async () => {
  // `export function f(): number` is a SyntaxError under Node, so a row whose
  // whole question is the annotation has nothing to ask a plain file.
  const { holdsTypeSyntax } = await import("../plugins/anatomiya/lib/langs.mjs");

  for (const p of ["src/a.ts", "src/a.mts", "src/a.cts", "src/a.tsx", "src/a.d.ts"]) {
    assert.equal(holdsTypeSyntax(p), true, p);
  }
  for (const p of ["src/a.js", "src/a.mjs", "src/a.cjs", "src/a.jsx", "app/a.rb", "Rakefile", "src/ats", ""]) {
    assert.equal(holdsTypeSyntax(p), false, p);
  }
});

test("a language may not declare type syntax for an extension it does not own", async () => {
  const { assertRegistry, LANGUAGES } = await import("../plugins/anatomiya/lib/langs.mjs");
  const decl = { ...LANGUAGES[0], typed: { exts: ["rb"] } };

  assert.throws(() => assertRegistry([decl]), /declares type syntax for \.rb/);
});

test("holdsTypeSyntax takes either answer, the path's or the tree's", async () => {
  const { holdsTypeSyntax } = await import("../plugins/anatomiya/lib/langs.mjs");

  assert.equal(holdsTypeSyntax("src/a.ts"), true, "the extension alone");
  assert.equal(holdsTypeSyntax("src/a.ts", { typed: false }), true, "a .ts file with no annotation can still carry one");
  assert.equal(holdsTypeSyntax("src/a.js", { typed: true }), true, "Flow");
  assert.equal(holdsTypeSyntax("src/a.js", { typed: false }), false);
  assert.equal(holdsTypeSyntax("src/a.js"), false, "no facets is the path's answer");
  assert.equal(holdsTypeSyntax("src/a.js", null), false);
});

test("a .js file whose tree holds JSX speaks JSX too, and only then", async () => {
  // JSX is legal in a `.js` file and the grammar already reads it there, so the
  // extension alone left every component written in `.js` outside the rows
  // that ask about JSX while the scan labelled the same file "(JSX)".
  const { spokenIn } = await import("../plugins/anatomiya/lib/langs.mjs");

  assert.deepEqual(spokenIn("js", { jsx: true }), ["js", "jsx"]);
  assert.deepEqual(spokenIn("js", { jsx: false }), ["js"]);
  assert.deepEqual(spokenIn("js", null), ["js"], "no facets is the path's answer");
  assert.deepEqual(spokenIn("jsx", { jsx: false }), ["jsx"], "a .tsx file stays what its extension says");
  assert.deepEqual(spokenIn("ruby", { jsx: true }), ["ruby"]);
});

test("a table keyed by language is refused where it leaves out a language it is asked about, or holds one it never is", () => {
  assert.deepEqual(hostedBy("tree-sitter"), TREE_SITTER);
  assert.deepEqual(hostedBy("prism"), ["ruby"]);
  assert.doesNotThrow(() => assertKeyed("T", { go: 1, rust: 2 }, ["go", "rust"]));
  assert.throws(() => assertKeyed("T", { go: 1 }, ["go", "rust"]), /^Error: T has no entry for rust$/);
  assert.throws(() => assertKeyed("T", { go: 1, rust: 2, zig: 3 }, ["go", "rust"]), /^Error: T holds zig, which nothing asks it about$/);
  assert.doesNotThrow(() => assertKeyed("T", { rust: 2 }, [], ["go", "rust"]), "a table a language may leave out");
  assert.throws(() => assertKeyed("T", { php: 2 }, [], ["go", "rust"]), /T holds php/);
  // An inherited name is no entry: `RUNNERS.constructor` is not a language.
  assert.throws(() => assertKeyed("T", {}, ["constructor"]), /T has no entry for constructor/);
});
