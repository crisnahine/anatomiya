/**
 * The language registry: every fact a language owns, declared once.
 *
 * A leaf on purpose. `corpus.mjs` used to own the extension table, and it
 * reaches git, so the parser child could not read it without dragging git into
 * all eight processes. The child answered by carrying its own copies, the
 * extension list first and the grammar choice after it, and each copy is the
 * drift this module exists to remove: an extension, a bare filename, a scratch
 * name, a grammar route and a dialect declared below are in scope for the
 * corpus, the delivery globs, the parser child and the retry at once.
 *
 * `engine` is a name, never an import. A declaration the child reads must not
 * reach the module that spawns processes, so which host runs a language is
 * data here and a table in `parse.mjs`, the one module that may import both.
 */

/**
 * The engines the declarations route to: what hosts each one, what it is
 * called, and what a person does when it is not there.
 *
 * Data, like the declarations below, and for the same reason: the forked child
 * reads this module, so which host runs an engine is a name here and a call in
 * `parse.mjs`. The remedy lives here rather than at the printer that needed
 * one, because there were three printers and two of them said npm, which
 * cannot install an interpreter.
 *
 * `rejects` is what it means when the engine answers that a file is broken.
 * oxc and prism are their languages' own parsers, so it is the file's syntax.
 * A tree-sitter grammar covers less than its language: measured, it rejects a
 * correct C# file with `#if` inside an expression, so it is the grammar's reach.
 */
export const ENGINES = Object.freeze({
  oxc:   { id: "oxc",   host: "node",        module: "oxc-parser",     extras: [{ module: "flow-remove-types", role: "stripper" }], remedy: "node bin/anatomiya.mjs setup in the plugin directory", rejects: "syntax" },
  prism: { id: "prism", host: "interpreter", command: "ruby",          floor: "1.0.0", remedy: "install Ruby 3.4 or newer, which ships prism 1.x, or run gem install prism on the Ruby you have, and put ruby on PATH", rejects: "syntax" },
  "tree-sitter": { id: "tree-sitter", host: "node", module: "web-tree-sitter", remedy: "node bin/anatomiya.mjs setup in the plugin directory", rejects: "grammar" },
});

const STRIPPER = ENGINES.oxc.extras.find((e) => e.role === "stripper");

/**
 * The one sentence for a dialect stripper that is not installed.
 *
 * The scan summary and the check both print it, word for word, and copied
 * sentences in this repository have drifted before. The module is the
 * declaration's, so the sentence cannot name a dependency nothing loads.
 */
export const MISSING_STRIPPER = `${STRIPPER.module} is not installed, so a file written in Flow is rejected rather than read`;

const js = {
  id: "js",
  // The one declaration a source-shaped path falls back to when nothing claims
  // it, stated here so it is a decision rather than a dangling else.
  fallback: true,
  engine: "oxc",
  // What a test of this language may be written in. Finer than the engine,
  // which hosts a family only until it hosts two.
  family: "js",
  embedded: null,
  exts: ["ts", "mts", "cts", "js", "mjs", "cjs"],
  filenames: [],
  scratchExt: "ts",
  // The grammar follows the file's real extension, never the language: JSX is
  // legal in a `.js` file, and `<string>x` is legal in `.ts` and not in `.tsx`.
  grammars: { byExtension: { ts: "ts", mts: "ts", cts: "ts" }, default: "tsx" },
  // Flow lives in the untyped half of the family: a rejected `.ts` file is
  // broken rather than written in a dialect, and blanking it would hide the error.
  dialect: { exts: ["js", "mjs", "cjs"] },
  // Only these ever run under Node's own CommonJS function wrapper, which is
  // what makes a top-level `return` legal there. `.mjs` is always ESM by
  // Node's own rule regardless of package.json, and TypeScript rejects a
  // top-level `return` as source before any module format is chosen, so
  // neither carries the dialect a rejected file here might really be.
  commonjs: { exts: ["js", "cjs"] },
  // The half of the family that can carry a type annotation at all. A `.js`
  // file parses under the tsx grammar here, so nothing downstream can tell the
  // two apart, and a row whose whole question is the annotation would count a
  // confident zero on every plain JavaScript file.
  typed: { exts: ["ts", "mts", "cts"] },
  capabilities: { semantic: true, importGraph: true },
  positions: { offsets: "utf16", lines: false },
};

const jsx = {
  id: "jsx",
  fallback: false,
  engine: "oxc",
  family: "js",
  embedded: null,
  exts: ["tsx", "jsx"],
  filenames: [],
  scratchExt: "tsx",
  grammars: { byExtension: {}, default: "tsx" },
  dialect: { exts: ["jsx"] },
  // Raw JSX cannot run under Node at all without a transform first, so it is
  // never the CommonJS wrapper's own dialect.
  commonjs: null,
  typed: { exts: ["tsx"] },
  capabilities: { semantic: true, importGraph: true },
  positions: { offsets: "utf16", lines: false },
};

// A component file: markup holding at most two script blocks, which are all
// that is read. `embedded` names whose rules find them. The grammar is the
// block's own `lang` and the type syntax is the tag's to say, so no extension
// routes either, and the checker is handed paths it could not open.
const component = (id) => ({
  id,
  fallback: false,
  engine: "oxc",
  family: "js",
  embedded: id,
  exts: [id],
  filenames: [],
  scratchExt: id,
  grammars: { byExtension: {}, default: "tsx" },
  dialect: null,
  commonjs: null,
  typed: null,
  capabilities: { semantic: false, importGraph: true },
  positions: { offsets: "utf16", lines: false },
});

const vue = component("vue");
const svelte = component("svelte");

const ruby = {
  id: "ruby",
  fallback: false,
  engine: "prism",
  family: "ruby",
  embedded: null,
  exts: ["rb", "rake", "gemspec", "jbuilder"],
  // Ruby whose filename does not carry the language, matched whole so a
  // Gemfile.lock is not a Gemfile. `.rbi` is deliberately absent: a Sorbet
  // signature describes types rather than anything anyone wrote.
  filenames: ["Rakefile", "Gemfile", "config.ru"],
  scratchExt: "rb",
  grammars: { byExtension: {}, default: "rb" },
  dialect: null,
  commonjs: null,
  typed: null,
  capabilities: { semantic: false, importGraph: false },
  positions: { offsets: null, lines: true },
};

// A language tree-sitter reads whole, through the one grammar file named after
// its id. The family is its own: a Go test is no test of a Python file.
const grammar = (id, exts) => ({
  id,
  fallback: false,
  engine: "tree-sitter",
  family: id,
  embedded: null,
  exts,
  filenames: [],
  scratchExt: exts[0],
  grammars: { byExtension: {}, default: id },
  dialect: null,
  commonjs: null,
  typed: null,
  capabilities: { semantic: false, importGraph: false },
  positions: { offsets: "utf16", lines: false },
});

// `.pyi` is deliberately absent, as `.rbi` is: a stub describes types rather
// than anything anyone wrote.
const python = grammar("python", ["py"]);
const php = grammar("php", ["php"]);
const go = grammar("go", ["go"]);
const java = grammar("java", ["java"]);
const csharp = grammar("csharp", ["cs"]);
const rust = grammar("rust", ["rs"]);
const kotlin = grammar("kotlin", ["kt", "kts"]);

const freeze = (decl) => {
  Object.freeze(decl.exts);
  Object.freeze(decl.filenames);
  Object.freeze(decl.grammars.byExtension);
  Object.freeze(decl.grammars);
  if (decl.dialect) {
    Object.freeze(decl.dialect.exts);
    Object.freeze(decl.dialect);
  }
  if (decl.commonjs) {
    Object.freeze(decl.commonjs.exts);
    Object.freeze(decl.commonjs);
  }
  if (decl.typed) {
    Object.freeze(decl.typed.exts);
    Object.freeze(decl.typed);
  }
  Object.freeze(decl.capabilities);
  Object.freeze(decl.positions);
  return Object.freeze(decl);
};

// The extractors `sfc.mjs` implements, which is what `embedded` may name.
const EXTRACTORS = ["vue", "svelte"];

export const LANGUAGES = Object.freeze([js, jsx, vue, svelte, ruby, python, php, go, java, csharp, rust, kotlin].map(freeze));

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
const EXT_TO_ID = new Map(LANGUAGES.flatMap((l) => l.exts.map((e) => [e, l.id])));
const FILENAME_TO_ID = new Map(LANGUAGES.flatMap((l) => l.filenames.map((n) => [n, l.id])));
const FALLBACK = LANGUAGES.find((l) => l.fallback).id;

/** The declaration behind an id. An unknown id past the corpus is a bug, so it throws by name. */
export function declOf(id) {
  const decl = BY_ID.get(id);
  if (!decl) throw new Error(`no language declaration for ${id}`);
  return decl;
}

/** The engine a language routes to. A name, never an import: the child reads this too. */
export function engineOf(id) {
  return declOf(id).engine;
}

/** The family a language belongs to: what a test of it may be written in. */
export const familyOf = (id) => declOf(id).family;

/** Whose rules find a language's script blocks, or null where the file is the script. */
export const embeddedIn = (id) => declOf(id).embedded;

export const EXT_BY_LANG = Object.freeze(Object.fromEntries(LANGUAGES.map((l) => [l.id, l.exts])));

// Two readers of "the extension", deliberately: this one takes the whole
// path's last dot, which is what the old anchored regexes read for the grammar
// and dialect questions, while `language` reads the basename so a bare
// filename can win. The answers differ only on names neither question is
// asked about, and the split is stated here so it stays a decision.
const extIn = (path) => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : "";
};

/** The language a path is counted under: extension first, then whole filename, then the fallback. */
export function language(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // At zero the whole basename is the extension, and it still owns the file:
  // a tracked `.rb` was Ruby under the old anchored regex, and `isSource`
  // admits it through the same table, so refusing it here split one registry
  // into two answers and moved the file to the fallback engine.
  if (dot >= 0) {
    const byExt = EXT_TO_ID.get(base.slice(dot + 1));
    if (byExt) return byExt;
  }
  return FILENAME_TO_ID.get(base) ?? FALLBACK;
}

/** The grammar the engine is asked for, decided by the file's real extension (B14). */
export function grammarFor(id, rel) {
  const decl = declOf(id);
  const ext = extIn(rel);
  const grammar = decl.grammars.byExtension[ext];
  // An ambient declaration needs its own grammar: plain TS rejects a bare
  // `export const x: string;` that only a `.d.ts` file is allowed to write.
  if (grammar && rel.endsWith(`.d.${ext}`)) return `d.${ext}`;
  return grammar ?? decl.grammars.default;
}

/** A declared capability, read where a caller would otherwise spell a language name. */
export const langHas = (id, capability) => declOf(id).capabilities[capability] === true;

const FLOW_EXT = LANGUAGES.filter((l) => l.dialect).flatMap((l) => l.dialect.exts);
const MAY_HOLD_FLOW = new RegExp(`\\.(${FLOW_EXT.join("|")})$`);

/**
 * Whether a rejected file is worth handing to the Flow stripper.
 *
 * A question about the path alone, derived from the declarations' dialect
 * lists: Flow lives in files by extension, and a `.jsx` rel handed in under
 * the `js` id is still a file the retry exists for.
 */
export const mayHoldFlow = (path) => MAY_HOLD_FLOW.test(path);

const COMMONJS_EXT = LANGUAGES.filter((l) => l.commonjs).flatMap((l) => l.commonjs.exts);
const MAY_BE_COMMONJS = new RegExp(`\\.(${COMMONJS_EXT.join("|")})$`);

/**
 * Whether a rejected file might really be running under Node's own CommonJS
 * wrapper rather than holding broken code, derived the same way `mayHoldFlow`
 * is: from the declarations' own `commonjs` lists, so the retry cannot drift
 * from the extensions the registry says the dialect applies to.
 */
export const mayBeCommonJS = (path) => MAY_BE_COMMONJS.test(path);

const TYPED_EXT = LANGUAGES.filter((l) => l.typed).flatMap((l) => l.typed.exts);
const CARRIES_TYPES = new RegExp(`\\.(${TYPED_EXT.join("|")})$`);

/**
 * Whether this file can carry a type annotation at all: its extension says so,
 * or its own tree already does.
 *
 * `export function f(): number` is a SyntaxError under Node, so a row whose
 * whole question is the annotation has nothing to ask a `.js` file. The
 * extensions come from the declarations' own `typed` lists, the way
 * `mayHoldFlow` and `mayBeCommonJS` are derived.
 *
 * The extension alone is a proxy and it is wrong on Flow. A `.js` file marked
 * `// @flow` declares return types the way a `.ts` file does, and it is parsed
 * here under the same grammar, so a row whose question is the annotation has to
 * ask it there. Measured: on react the extension rule alone took
 * `explicit_return_type` from 73 area slots to 18, and one 36-file directory
 * that is 100% Flow lost a claim it held at 68 of 69.
 */
export const holdsTypeSyntax = (path, facets = null) =>
  CARRIES_TYPES.test(path) || facets?.typed === true;

/**
 * The languages a file's rows are chosen for: its own, and `jsx` as well where
 * a `js` file's tree holds JSX.
 *
 * The same trade as `holdsTypeSyntax`, the other way round: the extension is
 * the proxy and the tree is the fact. JSX is legal in a `.js` file and the
 * grammar already reads it there, so the scan labelled such a file "(JSX)"
 * and no JSX row ever ran on it. CRA-era apps, React Native and many Next.js
 * projects keep every component in `.js`, and their maps stated none of the
 * five JSX conventions while the check enforced none. A `.js` file holding no
 * JSX stays out, which is what keeps the `.ts`-and-helpers dilution the JSX
 * rows declare `jsx` alone for out of their denominator. No facets is the
 * path's answer, the way it is for type syntax.
 */
export const spokenIn = (lang, facets = null) =>
  lang === "js" && facets?.jsx === true ? ["js", "jsx"] : [lang];

/**
 * A wrong declaration fails at import, never mid-scan. Each rule closes a way
 * a registry entry could silently mis-route files: two owners for one
 * extension, a scratch name another language claims, a grammar or dialect
 * route for an extension the declaration does not own.
 */
export function assertRegistry(langs) {
  const ids = new Set();
  const extOwner = new Map();
  const nameOwner = new Map();
  let fallbacks = 0;

  for (const decl of langs) {
    if (ids.has(decl.id)) throw new Error(`two declarations name ${decl.id}`);
    ids.add(decl.id);
    if (decl.fallback) fallbacks++;
    if (!ENGINES[decl.engine]) {
      throw new Error(`${decl.id} names no declared engine: ${decl.engine}`);
    }
    if (typeof decl.family !== "string" || !decl.family) throw new Error(`${decl.id} names no family`);
    if (decl.embedded !== null && !EXTRACTORS.includes(decl.embedded)) {
      throw new Error(`${decl.id} names no script extractor: ${decl.embedded}`);
    }
    if (decl.embedded && decl.engine !== ENGINES.oxc.id) {
      throw new Error(`${decl.id} embeds its script, which only oxc reads, and routes to ${decl.engine}`);
    }
    const caps = Object.keys(decl.capabilities).sort().join(",");
    if (caps !== "importGraph,semantic") {
      throw new Error(`${decl.id} declares capabilities off the closed pair: ${caps}`);
    }
    for (const ext of decl.exts) {
      if (extOwner.has(ext)) throw new Error(`.${ext} is declared by ${extOwner.get(ext)} and ${decl.id}`);
      extOwner.set(ext, decl.id);
    }
    for (const name of decl.filenames) {
      if (nameOwner.has(name)) throw new Error(`${name} is declared by ${nameOwner.get(name)} and ${decl.id}`);
      nameOwner.set(name, decl.id);
    }
    for (const ext of Object.keys(decl.grammars.byExtension)) {
      if (!decl.exts.includes(ext)) throw new Error(`${decl.id} routes a grammar for .${ext}, which it does not own`);
    }
    if (decl.dialect) {
      for (const ext of decl.dialect.exts) {
        if (!decl.exts.includes(ext)) throw new Error(`${decl.id} retries a dialect for .${ext}, which it does not own`);
      }
    }
    if (decl.typed) {
      for (const ext of decl.typed.exts) {
        if (!decl.exts.includes(ext)) {
          throw new Error(`${decl.id} declares type syntax for .${ext}, which it does not own`);
        }
      }
    }
    if (decl.commonjs) {
      for (const ext of decl.commonjs.exts) {
        if (!decl.exts.includes(ext)) throw new Error(`${decl.id} retries a commonjs wrapper for .${ext}, which it does not own`);
      }
    }
    if (decl.positions.offsets !== "utf16" && decl.positions.offsets !== null) {
      throw new Error(`${decl.id} declares offsets ${JSON.stringify(decl.positions.offsets)}, which no reader understands`);
    }
    if (typeof decl.positions.lines !== "boolean") {
      throw new Error(`${decl.id} declares no lines fact: say whether its nodes carry one`);
    }
  }

  if (fallbacks !== 1) throw new Error(`${fallbacks} declarations claim the fallback; exactly one may`);
  for (const decl of langs) {
    const back = language(`x.${decl.scratchExt}`);
    if (back !== decl.id) throw new Error(`${decl.id}'s scratch extension .${decl.scratchExt} routes to ${back}`);
  }
}

assertRegistry(LANGUAGES);

// The formats a bundler or a runtime is handed by their full name. A closed
// list rather than "any dotted suffix", because a dotted suffix is just as
// often part of a source file's stem: Angular and NestJS name every file
// `user.service.ts` or `app.module.ts`, and `*.types.ts` and `*.config.ts` are
// everywhere. Read as an asset, `./user.service` left the row, and a directory
// writing 40 of its 120 relative imports with `.js` stated the claim at 40 of
// 40 while the check never flagged the `.js` node16 and nodenext require.
// Shared by every row that has to tell a source import from an asset one
// (`import_extension`, and the capability rows' wrapper bindings), so the two
// cannot drift apart again. The second line is formats a loader plugin hands
// over whole (documents, templates, message catalogues, 3D models, shaders,
// schemas): each read as a source import missing its `.js`, so a directory
// importing `./manual.pdf` beside `./a.js` was told it broke its own rule.
export const ASSET_IMPORT = new RegExp(
  "\\.(css|scss|sass|less|styl|pcss|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|json[5c]?|ya?ml|toml|csv|txt|xml|html|mdx?|vue|svelte|astro|graphql|gql|wasm|node|glsl|wgsl" +
    "|pdf|webmanifest|hbs|ejs|po|properties|glb|gltf|sql|frag|vert|mov|proto)$",
  "i"
);
