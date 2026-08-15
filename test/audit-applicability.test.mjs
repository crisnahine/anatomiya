import { test } from "node:test";
import assert from "node:assert/strict";

import { shareTable, NARROW_AND_PRECISE } from "../scripts/audit-applicability.mjs";

/**
 * The audit reads what a scan already wrote, so its fixtures are facts records
 * rather than repositories.
 *
 * `langFileCount` is the denominator the applicability gate itself uses: the
 * files the dimension could speak about, not every file in the area. Reading
 * `fileCount` instead would call every Ruby row narrow in a mixed area.
 */
const facts = (areas) => ({ areas });

test("a map written before the denominator was stored is refused, not read as empty", () => {
  // The failure this codebase keeps closing: a read that could not be performed
  // must be told apart from one that found nothing (B13, F13, F15). A schema-4
  // map carries every slot and no `langFileCount`, and folding that into an
  // empty table reports a repository with no dimensions.
  const { rows, denominatorless } = shareTable([
    facts([{ path: "a", fileCount: 40, dimensions: [{ key: "k", applicability: 5 }] }]),
  ]);

  assert.deepEqual(rows, []);
  assert.equal(denominatorless, 1, "the slot was there and its denominator was not");
});

test("the share is applicability over the files the dimension could speak about", () => {
  const { rows, denominatorless } = shareTable([
    facts([{ path: "a", fileCount: 100, dimensions: [{ key: "k", applicability: 5, langFileCount: 20 }] }]),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].med, 0.25);
  assert.equal(denominatorless, 0);
});

test("an area whose dimension could speak about no file is not a share of zero", () => {
  // Dividing by the area's file count would report 0.00 and flag a predicate
  // that was never asked anything.
  const { rows } = shareTable([
    facts([{ path: "a", fileCount: 40, dimensions: [{ key: "k", applicability: 0, langFileCount: 0 }] }]),
  ]);

  assert.deepEqual(rows, []);
});

test("shares from several repositories fold into one row per dimension", () => {
  const { rows } = shareTable([
    facts([{ path: "a", fileCount: 10, dimensions: [{ key: "k", applicability: 1, langFileCount: 10 }] }]),
    facts([{ path: "b", fileCount: 10, dimensions: [{ key: "k", applicability: 9, langFileCount: 10 }] }]),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].areas, 2);
  assert.equal(rows[0].min, 0.1);
  assert.equal(rows[0].max, 0.9);
  assert.equal(rows[0].med, 0.5);
});

test("rows sort narrowest first, because that is the end worth reading", () => {
  const { rows } = shareTable([
    facts([
      {
        path: "a",
        fileCount: 10,
        dimensions: [
          { key: "wide", applicability: 9, langFileCount: 10 },
          { key: "narrow", applicability: 1, langFileCount: 10 },
        ],
      },
    ]),
  ]);

  assert.deepEqual(rows.map((r) => r.key), ["narrow", "wide"]);
});

test("a narrow predicate that claims to be precise is the one flagged", () => {
  // A low share is not a defect on its own: `zone_aware_time` speaks about the
  // files that read a clock, and most files do not. It is a defect when the row
  // also says `precise`, which claims it sees every site there is.
  const { rows } = shareTable([
    facts([
      {
        path: "a",
        fileCount: 40,
        dimensions: [
          { key: "swallowed_error", applicability: 1, langFileCount: 40 },
          { key: "error_shape", applicability: 1, langFileCount: 40 },
        ],
      },
    ]),
  ]);

  const flagged = Object.fromEntries(rows.map((r) => [r.key, r.note]));
  assert.equal(flagged.swallowed_error, NARROW_AND_PRECISE, "a precise row at a 0.025 share is the C2 case");
  assert.equal(flagged.error_shape, "", "a partial row already says it under-counts");
});
