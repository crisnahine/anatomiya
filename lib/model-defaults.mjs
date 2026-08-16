/**
 * Which side of each dimension a model writes unprompted, with the provenance
 * of that answer.
 *
 * A claim the model already writes by default spends always-loaded budget
 * saying nothing (measured: context files pay only for non-standard practices),
 * so the renderer drops it to a counts line while the check keeps enforcing it
 * from facts.json. `none` and an absent key both fail open: the dimension is
 * never filtered, so an unmeasured row keeps stating.
 *
 * Validated at load and a bad table fails the scan, the same posture as a
 * missing parser: filtering silently off would quietly regrow the noise this
 * table exists to remove.
 */
import { createRequire } from "node:module";

import { ALL_DIMENSIONS } from "./dimensions.mjs";
import { PAIRINGS } from "./pairing.mjs";
import { CLASSES, NAMING_CORPUS } from "./dimensions-naming.mjs";

const TABLE = createRequire(import.meta.url)("./model-defaults.json");

const SIDES = ["claim", "counter", "none"];
const METHODS = ["measured", "literature", "seed"];

export function assertModelDefaults(table, registryKeys) {
  for (const [key, e] of table) {
    if (!registryKeys.has(key)) {
      throw new Error(`model-defaults names ${key}, which is not a registry dimension`);
    }
    if (!SIDES.includes(e.default)) {
      throw new Error(`model-defaults ${key} declares default ${JSON.stringify(e.default)}, not one of ${SIDES.join(", ")}`);
    }
    // A learned-class dimension's default is a class, not a side, so its side
    // stays `none` and the class rides beside it. Membership in the closed
    // vocabulary is the whole check: a typo'd class would match nothing, which
    // is the filter silently off for that row.
    if ("class" in e && !CLASSES.includes(e.class)) {
      throw new Error(`model-defaults ${key} declares class ${JSON.stringify(e.class)}, not one of ${CLASSES.join(", ")}`);
    }
    const p = e.provenance;
    if (!p || !METHODS.includes(p.method)) {
      throw new Error(`model-defaults ${key} declares method ${JSON.stringify(p && p.method)}, not one of ${METHODS.join(", ")}`);
    }
    if (p.method === "literature" && typeof p.source !== "string") {
      throw new Error(`model-defaults ${key} is a literature entry with no source`);
    }
    if (p.samples !== null && p.samples !== undefined && !Number.isInteger(p.samples)) {
      throw new Error(`model-defaults ${key} declares samples ${JSON.stringify(p.samples)}, which is not a count`);
    }
    if (p.sideCounts !== null && p.sideCounts !== undefined && typeof p.sideCounts !== "object") {
      throw new Error(`model-defaults ${key} declares sideCounts ${JSON.stringify(p.sideCounts)}, which is not a tally`);
    }
  }
  return table;
}

export const MODEL_DEFAULTS = assertModelDefaults(
  new Map(Object.entries(TABLE)),
  new Set([...ALL_DIMENSIONS, ...PAIRINGS, ...NAMING_CORPUS].map((d) => d.key))
);

/** The side the model writes unprompted, or null when no side dominates. */
export function defaultSideFor(key) {
  const e = MODEL_DEFAULTS.get(key);
  if (!e || e.default === "none") return null;
  return e.default;
}

/** The class the model writes unprompted, or null. Only learned rows carry one. */
export function defaultClassFor(key) {
  return MODEL_DEFAULTS.get(key)?.class ?? null;
}
