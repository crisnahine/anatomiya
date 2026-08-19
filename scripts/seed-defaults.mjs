#!/usr/bin/env node
/**
 * Give every registry key an entry in `lib/model-defaults.json`, unmeasured.
 *
 * The table is one entry per key, and a key with none fails a test far from the
 * row that added it. Writing the entry by hand means writing a provenance
 * record by hand, which is how a row acquires a default nobody measured, so the
 * seed is written here instead: `none` is the answer that fails open, the same
 * answer an absent key gives, and the one `scripts/measure-defaults.mjs`
 * replaces when somebody measures the row.
 *
 * Held entries are never touched, so running this on a whole table changes
 * nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REGISTRY } from "../lib/registry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE_PATH = join(root, "lib", "model-defaults.json");

/** The entry a key nobody has measured carries. */
export const seedEntry = () => ({
  default: "none",
  provenance: { method: "seed", model: null, date: null, samples: null, sideCounts: null },
});

/** The table with an entry for every key, and the keys that had none. */
export function seedTable(table, keys) {
  const out = { ...table };
  const added = [];
  for (const key of keys) {
    // `hasOwn`, because `"constructor" in table` is true of every object and a
    // row named after one would read as held and never be written.
    if (Object.hasOwn(out, key)) continue;
    out[key] = seedEntry();
    added.push(key);
  }
  return { table: out, added };
}

function main() {
  const { table, added } = seedTable(JSON.parse(readFileSync(TABLE_PATH, "utf8")), REGISTRY.map((row) => row.key));
  if (!added.length) {
    console.error("every registry key already has an entry in lib/model-defaults.json");
    return;
  }
  writeFileSync(TABLE_PATH, JSON.stringify(table, null, 2) + "\n");
  console.error(`seeded ${added.length} unmeasured entr${added.length === 1 ? "y" : "ies"} in lib/model-defaults.json: ${added.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
