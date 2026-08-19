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

/**
 * Which of the three exported-name populations a declaration belongs to.
 *
 * A class keeps a row of its own rather than joining the other two: it is the
 * one declaration a naming convention treats as PascalCase that also survives
 * the Flow retry with its name intact, so folding it into either sibling would
 * make that sibling's `blindWhenStripped` a lie for the sites it borrowed. An
 * unrecognised shape, such as a namespace, speaks for none of the three rather
 * than guessing.
 */
function exportedPopulation(d) {
  if (d.type === "ClassDeclaration") return "class";
  if (d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction") return "value";
  if (d.type === "TSInterfaceDeclaration" || d.type === "TSTypeAliasDeclaration" || d.type === "TSEnumDeclaration") {
    return "type";
  }
  return null;
}

/**
 * Every named export's site, with the population that judges it.
 *
 * A real `export` statement is a top-level statement, never a nested one, so
 * this reads `program.body` directly rather than walking the whole tree: the
 * one shape that puts an `ExportNamedDeclaration` inside another node is a
 * Flow or TypeScript ambient module (`declare module "x" { export ... }`),
 * which is type-only scaffolding for a dependency the retry deletes whole, and
 * a site counted inside it would move once the retry ran. A default export is
 * read when it names what it declares, since one class per file exported that
 * way is the ordinary shape for a component, and an anonymous one binds no name
 * to check. A specifier (`export { foo as bar }`) renames a
 * binding declared elsewhere, and telling apart a renamed class from a
 * renamed constant means resolving that binding, which this pass does not do,
 * so a specifier answers none of the three rows rather than guessing which
 * one.
 */
function exportedSites(program) {
  const out = [];
  for (const n of program.body) {
    // A default export usually names what it declares, and one class per file
    // exported that way is the ordinary shape for a component. Skipping the
    // whole statement left a repository of them speaking through whichever
    // single file happened to use a named export instead.
    if (n.type === "ExportDefaultDeclaration") {
      const d = n.declaration;
      const population = d?.id?.name ? exportedPopulation(d) : null;
      if (population) out.push({ node: d.id, name: d.id.name, population });
      continue;
    }
    if (n.type !== "ExportNamedDeclaration") continue;
    const d = n.declaration;
    if (d?.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id?.type !== "Identifier") continue;
        const population = decl.init?.type === "ClassExpression" ? "class" : "value";
        out.push({ node: decl.id, name: decl.id.name, population });
      }
    } else if (d?.id?.name) {
      const population = exportedPopulation(d);
      if (population) out.push({ node: d.id, name: d.id.name, population });
    }
  }
  return out;
}

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
    precision: "precise",
    applicabilityPredicate: {
      sites: "an export statement declaring a function, or a variable not bound to a class expression, under a name that spells a naming class; an anonymous default export carries no name, and a renaming specifier is not resolved to a declaration, so neither is a site",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      for (const s of exportedSites(program)) {
        if (s.population !== "value") continue;
        const cls = classifyWord(s.name);
        if (cls) add({ node: s.node, conforming: false, where: s.name, class: cls });
      }
    },
  },
  {
    key: "exported_class_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "exported classes are named <style>",
    counterClaim: null,
    precision: "precise",
    applicabilityPredicate: {
      sites: "an export statement declaring a class, or a variable bound to a class expression, under a name that spells a naming class; an anonymous default export carries no name, and a renaming specifier is not resolved to a declaration, so neither is a site",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      for (const s of exportedSites(program)) {
        if (s.population !== "class") continue;
        const cls = classifyWord(s.name);
        if (cls) add({ node: s.node, conforming: false, where: s.name, class: cls });
      }
    },
  },
  {
    key: "exported_type_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "exported types are named <style>",
    counterClaim: null,
    // An interface, a type alias and an enum are pure type syntax: the Flow
    // retry deletes the whole declaration, unlike a class or a function, whose
    // name survives with only its annotations blanked.
    blindWhenStripped: true,
    precision: "precise",
    applicabilityPredicate: {
      sites: "an export statement declaring an interface, a type alias, or an enum, under a name that spells a naming class; an anonymous default export carries no name, and a renaming specifier is not resolved to a declaration, so neither is a site",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      for (const s of exportedSites(program)) {
        if (s.population !== "type") continue;
        const cls = classifyWord(s.name);
        if (cls) add({ node: s.node, conforming: false, where: s.name, class: cls });
      }
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
      sites: "a TypeScript interface declaration, whose name votes for its prefix letter or for carrying none",
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
      sites: "a TypeScript type alias declaration, whose name votes for its prefix letter or for carrying none",
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
