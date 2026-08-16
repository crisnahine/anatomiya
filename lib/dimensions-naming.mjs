/**
 * Naming claims, learned rather than declared: the class is the plurality of
 * this repository's own sites, so the same row states kebab-case in one
 * repository and PascalCase in another.
 *
 * The corpus rows ask about filenames and need no parser; the reducer composes
 * them the way it composes pairings. The AST rows run in the worker like every
 * other dimension. Nothing here imports the registry, because the registry
 * imports this file.
 */
import { walk, isFunctionLike } from "./walk.mjs";
import { fileStem } from "./dimensions-capability.mjs";

export const CLASSES = ["camelCase", "PascalCase", "kebab-case", "snake_case"];

/**
 * One word's class, or null where the classes cannot disagree about it.
 *
 * A single lowercase word (`index`, `utils`) matches every class at once, so it
 * votes for none of them: counting it as any one class would let a directory
 * full of single words state a convention no filename ever expressed.
 */
export function classifyWord(word) {
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(word)) return "kebab-case";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(word)) return "snake_case";
  // Every character class here is disjoint from its neighbour, so no run
  // splits two ways: an identifier is repository-controlled input, and the
  // ambiguous `(?:[A-Z][a-zA-Z0-9]*)+` this replaces measured six seconds on
  // twenty-eight characters.
  if (/^[a-z][a-zA-Z0-9]*$/.test(word) && /[A-Z]/.test(word)) return "camelCase";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(word)) return "PascalCase";
  return null;
}

/** One spelling of the template fill, shared by the reducer and the check. */
export const fillClass = (claim, cls) => claim.replace("<style>", cls);

/**
 * The stem's class. A bare filename has no extension to cut and is not a site.
 *
 * A leading digit run and its separator are cut first: a Rails migration is
 * `20260816120000_add_bad_column.rb`, and read whole the timestamp made every
 * name in db/migrate mixed, so conforming names classified and the realistic
 * violating shape, timestamp plus a Pascal stem, was the one the check could
 * not see. Digits inside a word stay part of it (`v2Client`).
 */
export function classifyBasename(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const stem = fileStem(rel);
  if (stem === base) return null;
  const named = stem.replace(/^\d+[-_]/, "");
  return /^\d+$/.test(named) ? null : classifyWord(named);
}

export const NAMING_CORPUS = [
  {
    key: "file_naming_case",
    kind: "corpus",
    tier: "syntactic",
    learnedClasses: true,
    claim: "files here are named <style>",
    counterClaim: null, // the other side is another class, which the learning already picks
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file whose stem spells one of the four naming classes; a single lowercase word and a bare filename match every class and are not sites",
      blind: null,
    },
    langs: ["js", "jsx", "ruby"],
    classify: classifyBasename,
  },
];

export const NAMING_AST = [
  {
    key: "function_naming_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "functions are named <style>",
    counterClaim: null, // the other side is another class, which the learning already picks
    precision: "precise",
    applicabilityPredicate: {
      // Module level only, matching function_style's altitude: a method answers
      // to its class's convention, which is a different sentence.
      sites: "a file declaring a module-level function, or binding one to a module-level variable, under a name that spells a naming class",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (ctx.enclosing !== null) return;
        let name = null;
        if (n.type === "FunctionDeclaration" && n.id) name = n.id.name;
        if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && n.init && isFunctionLike(n.init)) {
          name = n.id.name;
        }
        const cls = name && classifyWord(name);
        // The id node rides along so the check can point at the declaration
        // rather than line 1; the worker strips nodes before IPC either way.
        if (cls) add({ node: n.id, conforming: false, where: name, class: cls });
      });
    },
  },
  {
    key: "exported_symbol_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "exported names are <style>",
    counterClaim: null,
    // A type-only export is a site as written, and the Flow retry deletes the
    // whole statement, so a stripped file holds no answer for this row.
    blindWhenStripped: true,
    precision: "precise",
    applicabilityPredicate: {
      sites: "an export statement declaring or renaming a binding whose name spells a naming class; a default export carries no name and is not a site",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const site = (name, node) => {
        const cls = typeof name === "string" && classifyWord(name);
        if (cls) add({ node, conforming: false, where: name, class: cls });
      };
      walk(program, (n) => {
        if (n.type !== "ExportNamedDeclaration") return;
        const d = n.declaration;
        if (d?.type === "VariableDeclaration") {
          for (const decl of d.declarations) if (decl.id?.type === "Identifier") site(decl.id.name, decl.id);
        } else if (d?.id?.name) {
          site(d.id.name, d.id);
        }
        // The exported name is the site: `export { foo as bar }` puts `bar` in
        // the module's surface, and `foo` stays this file's own business.
        for (const s of n.specifiers || []) site(s.exported?.name ?? s.exported?.value, s.exported);
      });
    },
  },
];
