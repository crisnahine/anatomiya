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

const js = {
  id: "js",
  // The one declaration a source-shaped path falls back to when nothing claims
  // it, stated here so it is a decision rather than a dangling else.
  fallback: true,
  engine: "oxc",
  exts: ["ts", "mts", "cts", "js", "mjs", "cjs"],
  filenames: [],
  scratchExt: "ts",
  // The grammar follows the file's real extension, never the language: JSX is
  // legal in a `.js` file, and `<string>x` is legal in `.ts` and not in `.tsx`.
  grammars: { byExtension: { ts: "ts", mts: "ts", cts: "ts" }, default: "tsx" },
  // Flow lives in the untyped half of the family: a rejected `.ts` file is
  // broken rather than written in a dialect, and blanking it would hide the error.
  dialect: { exts: ["js", "mjs", "cjs"] },
  capabilities: { semantic: true, importGraph: true },
  positions: { offsets: "utf16", lines: false },
};

const jsx = {
  id: "jsx",
  fallback: false,
  engine: "oxc",
  exts: ["tsx", "jsx"],
  filenames: [],
  scratchExt: "tsx",
  grammars: { byExtension: {}, default: "tsx" },
  dialect: { exts: ["jsx"] },
  capabilities: { semantic: true, importGraph: true },
  positions: { offsets: "utf16", lines: false },
};

const ruby = {
  id: "ruby",
  fallback: false,
  engine: "prism",
  exts: ["rb", "rake", "gemspec", "jbuilder"],
  // Ruby whose filename does not carry the language, matched whole so a
  // Gemfile.lock is not a Gemfile. `.rbi` is deliberately absent: a Sorbet
  // signature describes types rather than anything anyone wrote.
  filenames: ["Rakefile", "Gemfile", "config.ru"],
  scratchExt: "rb",
  grammars: { byExtension: {}, default: "rb" },
  dialect: null,
  capabilities: { semantic: false, importGraph: false },
  positions: { offsets: null, lines: true },
};

const freeze = (decl) => {
  Object.freeze(decl.exts);
  Object.freeze(decl.filenames);
  Object.freeze(decl.grammars.byExtension);
  Object.freeze(decl.grammars);
  if (decl.dialect) {
    Object.freeze(decl.dialect.exts);
    Object.freeze(decl.dialect);
  }
  Object.freeze(decl.capabilities);
  Object.freeze(decl.positions);
  return Object.freeze(decl);
};

export const LANGUAGES = Object.freeze([js, jsx, ruby].map(freeze));

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

export const EXT_BY_LANG = Object.freeze(Object.fromEntries(LANGUAGES.map((l) => [l.id, l.exts])));

const extIn = (path) => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : "";
};

/** The language a path is counted under: extension first, then whole filename, then the fallback. */
export function language(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const byExt = EXT_TO_ID.get(base.slice(dot + 1));
    if (byExt) return byExt;
  }
  return FILENAME_TO_ID.get(base) ?? FALLBACK;
}

/** The grammar the engine is asked for, decided by the file's real extension (B14). */
export function grammarFor(id, rel) {
  const decl = declOf(id);
  return decl.grammars.byExtension[extIn(rel)] ?? decl.grammars.default;
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

/**
 * A wrong declaration fails at import, never mid-scan. Each rule closes a way
 * a registry entry could silently mis-route files: two owners for one
 * extension, a scratch name another language claims, a grammar or dialect
 * route for an extension the declaration does not own.
 */
function assertRegistry(langs) {
  const ids = new Set();
  const extOwner = new Map();
  const nameOwner = new Map();
  let fallbacks = 0;

  for (const decl of langs) {
    if (ids.has(decl.id)) throw new Error(`two declarations name ${decl.id}`);
    ids.add(decl.id);
    if (decl.fallback) fallbacks++;
    if (decl.engine !== "oxc" && decl.engine !== "prism") {
      throw new Error(`${decl.id} names no declared engine: ${decl.engine}`);
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
  }

  if (fallbacks !== 1) throw new Error(`${fallbacks} declarations claim the fallback; exactly one may`);
  for (const decl of langs) {
    const back = language(`x.${decl.scratchExt}`);
    if (back !== decl.id) throw new Error(`${decl.id}'s scratch extension .${decl.scratchExt} routes to ${back}`);
  }
}

assertRegistry(LANGUAGES);
