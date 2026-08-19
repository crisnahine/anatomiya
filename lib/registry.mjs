/**
 * The three lists of rows as one registry, assembled and checked in one place.
 *
 * A row is declared in `ALL_DIMENSIONS`, in `PAIRINGS` or in `NAMING_CORPUS`,
 * and every reader that wanted more than one of them spelled the union itself,
 * each a different subset: a reader that missed a list read a shorter registry
 * without a word, and a fourth list would have to be added to all of them.
 * Asking here for rows of a kind, or for one key, is the one place instead.
 *
 * The load battery runs here rather than beside each list, once over the whole
 * union: `stampKind` writes the kind in place, and a row read through this
 * module is stamped whichever list declared it.
 *
 * The parse worker must not reach this module. It runs `dimensionsFor` off
 * `dimensions.mjs`, has no program to run an obligation or a filename row
 * against, and eight forked children pay for whatever it imports.
 */
import { ALL_DIMENSIONS, assertRegistryRows, KINDS } from "./dimensions.mjs";
import { PAIRINGS } from "./pairing.mjs";
import { NAMING_CORPUS } from "./dimensions-naming.mjs";

/**
 * One key, one row: the question the battery cannot ask, because it runs over
 * a list and this is about two of them. Two rows under one key print the same
 * three numbers twice, and a reader looking the key up reads whichever of them
 * it reached first.
 */
export function assertUniqueKeys(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.key)) throw new Error(`registry declares ${row.key} twice`);
    seen.add(row.key);
  }
  return rows;
}

export const REGISTRY = Object.freeze(
  assertUniqueKeys(assertRegistryRows([...ALL_DIMENSIONS, ...PAIRINGS, ...NAMING_CORPUS]))
);

const BY_KEY = new Map(REGISTRY.map((row) => [row.key, row]));

export const REGISTRY_KEYS = new Set(BY_KEY.keys());

const BY_KIND = new Map(KINDS.map((kind) => [kind, Object.freeze(REGISTRY.filter((row) => row.kind === kind))]));

/** The rows counted one way: a tree walk, a fold over the corpus, or a companion match. */
export function rowsOfKind(kind) {
  const rows = BY_KIND.get(kind);
  // A misspelled kind answering with no rows is a reader switched off in silence.
  if (!rows) throw new Error(`registry holds no kind ${JSON.stringify(kind)}, only ${KINDS.join(", ")}`);
  return rows;
}

/**
 * Every row that speaks one of these languages, whichever list declared it.
 *
 * The tier is opt-in, the same rule `dimensionsFor` carries: a caller that does
 * not ask for it must never be handed a claim that needs a checker nobody ran.
 * That filter is why this had no readers and three views of the registry were
 * being added together instead.
 */
export function rowsForLangs(langs, { tier = "syntactic" } = {}) {
  return REGISTRY.filter(
    (row) => row.langs.some((l) => langs.includes(l)) && (tier === "all" || row.tier === tier)
  );
}

/** The row under this key, or null. */
export function rowByKey(key) {
  return BY_KEY.get(key) ?? null;
}
