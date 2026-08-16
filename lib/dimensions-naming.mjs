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
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+$/.test(word)) return "camelCase";
  if (/^[A-Z][a-zA-Z0-9]*$/.test(word)) return "PascalCase";
  return null;
}

/** The stem's class. A bare filename has no extension to cut and is not a site. */
export function classifyBasename(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  if (dot <= 0) return null;
  return classifyWord(base.slice(0, dot));
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
