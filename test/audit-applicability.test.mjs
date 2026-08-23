import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "audit-applicability.mjs");

import { shareTable, readRecords, NARROW_AND_PRECISE } from "../scripts/audit-applicability.mjs";
import { FACTS_SCHEMA } from "../plugins/anatomiya/lib/facts.mjs";

function withFiles(byName) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-audit-"));
  const paths = [];
  for (const [name, body] of Object.entries(byName)) {
    const p = join(dir, name);
    writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
    paths.push(p);
  }
  return { dir, paths, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

const record = (areas) => ({ schema: FACTS_SCHEMA, areas });
const oneSlot = [{ path: "a", fileCount: 10, dimensions: [{ key: "k", applicability: 5, langFileCount: 10 }] }];

/**
 * The exit code is the contract a CI job reads, so it is asserted rather than
 * checked by hand: a partial read that exits 0 is the clean-looking summary the
 * whole refusal exists to prevent.
 */
function runScript(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("a map the audit could not measure exits non-zero, whichever way it could not", () => {
  const f = withFiles({
    "notfacts.json": {},
    "future.json": { schema: FACTS_SCHEMA + 1, areas: oneSlot },
    "old.json": { schema: 4, areas: [{ path: "a", fileCount: 10, dimensions: [{ key: "k", applicability: 5 }] }] },
    "good.json": record(oneSlot),
  });
  try {
    const [notfacts, future, old, good] = f.paths;

    assert.equal(runScript([good]).code, 0, "a map it could read exits clean");
    assert.equal(runScript([notfacts]).code, 1);
    assert.equal(runScript([future]).code, 1);
    assert.equal(runScript([old]).code, 1, "every slot carried no denominator");
    // The one that read clean on its own: a good map alongside an old one used
    // to swallow the old one's slots and still exit 0.
    assert.equal(runScript([good, old]).code, 1, "a partial read is not a clean run");
    assert.equal(runScript(["/tmp/anatomiya-no-such-map.json"]).code, 1);
  } finally {
    f.dispose();
  }
});

test("the summary counts the maps the table was computed over, not the ones on the command line", () => {
  const f = withFiles({ "good.json": record(oneSlot), "bad.json": {} });
  try {
    assert.match(runScript(f.paths).err, /over 1 repositories/);
  } finally {
    f.dispose();
  }
});

test("with no argument it says how to be called", () => {
  const r = runScript([]);
  assert.equal(r.code, 2);
  assert.match(r.err, /usage: /);
});

test("a file that is not a facts record is refused rather than measured", () => {
  // The same rule the map reader follows: a record this build cannot make sense
  // of is refused, never read field by field. Read as an empty table it is
  // indistinguishable from a repository with no dimensions in it.
  const f = withFiles({ "notfacts.json": {} });
  try {
    const { records, problems } = readRecords(f.paths);
    assert.deepEqual(records, []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /notfacts\.json/);
  } finally {
    f.dispose();
  }
});

test("a record from a schema this build has not heard of is refused", () => {
  const f = withFiles({ "future.json": { schema: FACTS_SCHEMA + 1, areas: oneSlot } });
  try {
    const { records, problems } = readRecords(f.paths);
    assert.deepEqual(records, []);
    assert.match(problems[0], new RegExp(`reads 1 to ${FACTS_SCHEMA}`));
  } finally {
    f.dispose();
  }
});

test("a path that cannot be read names itself instead of throwing", () => {
  const { records, problems } = readRecords(["/tmp/anatomiya-no-such-map.json"]);

  assert.deepEqual(records, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /anatomiya-no-such-map\.json/);
});

test("a readable record is kept beside the ones that were refused", () => {
  const f = withFiles({ "good.json": record(oneSlot), "bad.json": {} });
  try {
    const { records, problems } = readRecords(f.paths);
    assert.equal(records.length, 1, "the good map still counts");
    assert.equal(problems.length, 1, "and the bad one is named");
  } finally {
    f.dispose();
  }
});

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

test("a slot with no language files of its own falls back to the area, the way the gate does", () => {
  // `applyGates` divides by `dim.langFileCount || areaFileCount`, so a slot with
  // no count of its own is still gated, against the area. Dropping it here made
  // the row the gate suppressed as narrow invisible in the table meant to find
  // narrow rows.
  const { rows } = shareTable([
    facts([{ path: "a", fileCount: 40, dimensions: [{ key: "k", applicability: 10, langFileCount: 0 }] }]),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].med, 0.25);
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
