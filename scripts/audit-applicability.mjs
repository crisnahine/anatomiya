#!/usr/bin/env node
/**
 * Applicability share per dimension, over as many scanned repositories as you
 * hand it.
 *
 * `applicability` renders beside an area's file count because a wrongly narrow
 * predicate gives a ratio of 1.0 over a small candidate set and reads as a
 * strong convention (C3). That check is per line and by eye. This is the same
 * check over every line at once, which is what makes a predicate's narrowness
 * visible before somebody reads the map rather than after.
 *
 * A low share is not a defect on its own: `zone_aware_time` speaks about the
 * files that read a clock, and most files do not. It is a defect when the row
 * also says `precise`, which claims it sees every site there is.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { PAIRINGS } from "../lib/pairing.mjs";

export const NARROW_AND_PRECISE = "narrow and precise: check the predicate";

/** The share below which a precise row is worth opening. */
export const NARROW = 0.25;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function shareTable(factsList) {
  const precisionOf = new Map([...ALL_DIMENSIONS, ...PAIRINGS].map((d) => [d.key, d.precision]));
  const shares = new Map();
  // A slot that is there and whose denominator is not. A map written before
  // schema 5 carries every count and no `langFileCount`, and folding that into
  // an empty table reports a repository with no dimensions in it. Told apart
  // from "read, and there was nothing there", which is the same rule the parse
  // classification and the git reads already follow.
  let denominatorless = 0;

  for (const facts of factsList) {
    for (const area of facts.areas ?? []) {
      for (const d of area.dimensions ?? []) {
        // The denominator the applicability gate itself reads: the files this
        // dimension could speak about, never every file in the area. A Ruby row
        // counted against a mixed area's JavaScript files reads as narrow when
        // it was simply never asked.
        if (d.langFileCount === undefined) {
          denominatorless++;
          continue;
        }
        if (!d.langFileCount) continue;
        if (!shares.has(d.key)) shares.set(d.key, []);
        shares.get(d.key).push(d.applicability / d.langFileCount);
      }
    }
  }

  const rows = [...shares.entries()]
    .map(([key, xs]) => {
      const precision = precisionOf.get(key) ?? "?";
      const med = median(xs);
      return {
        key,
        precision,
        areas: xs.length,
        med,
        min: Math.min(...xs),
        max: Math.max(...xs),
        note: precision === "precise" && med < NARROW ? NARROW_AND_PRECISE : "",
      };
    })
    .sort((a, b) => a.med - b.med || a.key.localeCompare(b.key));

  return { rows, denominatorless };
}

function main(paths) {
  if (paths.length === 0) {
    console.error("usage: node scripts/audit-applicability.mjs <facts.json> [<facts.json> ...]");
    process.exit(2);
  }

  const { rows, denominatorless } = shareTable(paths.map((p) => JSON.parse(readFileSync(p, "utf8"))));

  if (denominatorless) {
    console.error(
      `${denominatorless} slot(s) carry no langFileCount, so their share could not be computed: ` +
        `these maps predate facts schema 5, and scanning again with this build stores it`
    );
    // A map this cannot read is not a repository with no dimensions in it, and
    // a clean empty table says the second.
    if (rows.length === 0) process.exit(1);
  }

  console.log(["key", "precision", "areas", "median", "min", "max", "note"].join("\t"));
  for (const r of rows) {
    console.log(
      [r.key, r.precision, r.areas, r.med.toFixed(3), r.min.toFixed(3), r.max.toFixed(3), r.note].join("\t")
    );
  }
  const flagged = rows.filter((r) => r.note).length;
  console.error(`${rows.length} dimensions over ${paths.length} repositories, ${flagged} worth opening`);
}

// Guarded, because the tests import `shareTable` from here and an unguarded
// `process.exit` would end the test run instead of the script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
