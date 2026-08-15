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
 * A low share is never a verdict. `zone_aware_time` speaks about the files that
 * read a clock, and most files do not, so the table ranks rows to open rather
 * than deciding anything: a `precise` row is flagged because it claims to see
 * every site there is, which makes a narrow one worth reading. Measured across
 * four repositories, every flagged row named a construct that is simply rare.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { PAIRINGS } from "../lib/pairing.mjs";
import { schemaProblem } from "../lib/facts.mjs";

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
        // The denominator the applicability gate itself reads, fallback and
        // all: the files this dimension could speak about, or the area's own
        // count where it has none. A Ruby row counted against a mixed area's
        // JavaScript files reads as narrow when it was simply never asked, and
        // dropping a slot with no count of its own hid the rows the gate had
        // already suppressed as narrow from the table meant to find them.
        if (d.langFileCount === undefined) {
          denominatorless++;
          continue;
        }
        const denominator = d.langFileCount || area.fileCount || 0;
        if (!denominator) continue;
        if (!shares.has(d.key)) shares.set(d.key, []);
        shares.get(d.key).push(d.applicability / denominator);
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
        // Folded rather than spread: `Math.min(...xs)` passes one argument per
        // area, and enough repositories turns a range into a stack overflow.
        min: xs.reduce((a, b) => (b < a ? b : a), Infinity),
        max: xs.reduce((a, b) => (b > a ? b : a), -Infinity),
        note: precision === "precise" && med < NARROW ? NARROW_AND_PRECISE : "",
      };
    })
    .sort((a, b) => a.med - b.med || a.key.localeCompare(b.key));

  return { rows, denominatorless };
}

/**
 * The records this audit may measure, and the paths it refused.
 *
 * A record this build cannot make sense of is refused rather than read field by
 * field, which is the rule the map reader already follows: read as an empty
 * table, a file that is not a facts record at all is indistinguishable from a
 * repository with no dimensions in it. A path that will not open names itself,
 * because with several on the command line an errno says nothing about which.
 */
export function readRecords(paths) {
  const records = [];
  const problems = [];

  for (const path of paths) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${path} could not be read: ${err && err.message ? err.message : err}`);
      continue;
    }
    const problem = schemaProblem(parsed);
    if (problem) problems.push(`${path} was not measured: ${problem.why}`);
    else records.push(parsed);
  }

  return { records, problems };
}

function main(paths) {
  if (paths.length === 0) {
    console.error("usage: node scripts/audit-applicability.mjs <facts.json> [<facts.json> ...]");
    process.exit(2);
  }

  const { records, problems } = readRecords(paths);
  for (const p of problems) console.error(p);

  const { rows, denominatorless } = shareTable(records);

  if (denominatorless) {
    console.error(
      `${denominatorless} slot(s) carry no langFileCount, so their share could not be computed: ` +
        `these maps predate facts schema 5, and scanning again with this build stores it`
    );
  }

  console.log(["key", "precision", "areas", "median", "min", "max", "note"].join("\t"));
  for (const r of rows) {
    console.log(
      [r.key, r.precision, r.areas, r.med.toFixed(3), r.min.toFixed(3), r.max.toFixed(3), r.note].join("\t")
    );
  }
  const flagged = rows.filter((r) => r.note).length;
  // The count the table was actually computed over, never the count on the
  // command line: a caller reading it as reach is told how many maps
  // contributed, and a partial read is a non-zero exit rather than a summary
  // that reads clean.
  console.error(`${rows.length} dimensions over ${records.length} repositories, ${flagged} worth opening`);
  if (problems.length || denominatorless) process.exit(1);
}

// Guarded, because the tests import `shareTable` from here and an unguarded
// `process.exit` would end the test run instead of the script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
