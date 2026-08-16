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
import { encode } from "./encode.mjs";

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
 * The sentence a learned row states, from the class its sites voted for.
 *
 * Two rules the template alone cannot carry. A class read off the repository's
 * own source is text an attacker writes, and it lands in a file the agent
 * loads, so it is encoded here rather than at every render site. And `none` is
 * an absence rather than a value: filling it in renders "named with a none
 * prefix", so a row that can learn it writes the absence out in full.
 */
export function claimFor(dim, cls) {
  if (cls === "none" && dim.noneClaim) return dim.noneClaim;
  return fillClass(dim.claim, dim.learnedFromSource ? encode(cls) : cls);
}

/**
 * The class a declared type name's prefix votes for.
 *
 * The second capital is what separates a prefix from a word: `IComment` votes
 * `I`, and `IO` and `IOStream` are acronyms that vote for no prefix at all.
 */
export function prefixClass(name) {
  const m = /^([A-Z])[A-Z][a-z]/.exec(name || "");
  return m ? m[1] : "none";
}

/** A superclass's written name: `B`, or the dotted `React.Component`. */
function superName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression" || node.computed) return null;
  const object = superName(node.object);
  const property = node.property && node.property.type === "Identifier" ? node.property.name : null;
  return object && property ? `${object}.${property}` : null;
}

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
  {
    key: "extends_base",
    tier: "syntactic",
    learnedClasses: true,
    // The class is a name out of the repository's own source rather than one of
    // a closed set, so the sentence it fills is encoded before it is rendered.
    learnedFromSource: true,
    claim: "classes here extend <style>",
    counterClaim: null, // the other side is another base, which the learning already picks
    precision: "precise",
    applicabilityPredicate: {
      sites: "a class declaration or class expression naming a superclass, written as an identifier or as a dotted member expression; a class naming none is not a site",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "ClassDeclaration" && n.type !== "ClassExpression") return;
        const base = superName(n.superClass);
        // A computed superclass is an expression, and its written form names no
        // base anybody could extend on purpose.
        if (!base) return;
        add({ node: n.id ?? n, conforming: false, where: n.id?.name ?? null, class: base });
      });
    },
  },
  {
    key: "interface_prefix",
    tier: "syntactic",
    learnedClasses: true,
    claim: "interfaces are named with a <style> prefix",
    noneClaim: "interfaces carry no prefix",
    counterClaim: null, // the other side is another prefix, or none, and both are classes the learning picks
    // The Flow retry blanks an interface declaration whole, so a stripped file
    // holds no answer here rather than an interface nobody prefixed.
    blindWhenStripped: true,
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file declaring a TypeScript interface, whose name votes for its prefix letter or for carrying none",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "TSInterfaceDeclaration" || !n.id) return;
        add({ node: n.id, conforming: false, where: n.id.name, class: prefixClass(n.id.name) });
      });
    },
  },
  {
    key: "type_alias_prefix",
    tier: "syntactic",
    learnedClasses: true,
    claim: "type aliases are named with a <style> prefix",
    noneClaim: "type aliases carry no prefix",
    counterClaim: null, // the other side is another prefix, or none, and both are classes the learning picks
    blindWhenStripped: true,
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file declaring a TypeScript type alias, whose name votes for its prefix letter or for carrying none",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "TSTypeAliasDeclaration" || !n.id) return;
        add({ node: n.id, conforming: false, where: n.id.name, class: prefixClass(n.id.name) });
      });
    },
  },
];
