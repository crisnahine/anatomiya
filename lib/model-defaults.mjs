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

const TABLE = createRequire(import.meta.url)("./model-defaults.json");

const SIDES = ["claim", "counter", "none"];
const METHODS = ["measured", "literature"];

export function assertModelDefaults(table, registryKeys) {
  for (const [key, e] of table) {
    if (!registryKeys.has(key)) {
      throw new Error(`model-defaults names ${key}, which is not a registry dimension`);
    }
    if (!SIDES.includes(e.default)) {
      throw new Error(`model-defaults ${key} declares default ${JSON.stringify(e.default)}, not one of ${SIDES.join(", ")}`);
    }
    const p = e.provenance;
    if (!p || !METHODS.includes(p.method)) {
      throw new Error(`model-defaults ${key} declares method ${JSON.stringify(p && p.method)}, not one of ${METHODS.join(" or ")}`);
    }
    if (p.method === "literature" && typeof p.source !== "string") {
      throw new Error(`model-defaults ${key} is a literature entry with no source`);
    }
  }
  return table;
}

export const MODEL_DEFAULTS = assertModelDefaults(
  new Map(Object.entries(TABLE)),
  new Set([...ALL_DIMENSIONS, ...PAIRINGS].map((d) => d.key))
);

/** The side the model writes unprompted, or null when no side dominates. */
export function defaultSideFor(key) {
  const e = MODEL_DEFAULTS.get(key);
  if (!e || e.default === "none") return null;
  return e.default;
}
