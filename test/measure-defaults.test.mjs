import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { countSides, decideDefault, mergeTable } from "../scripts/measure-defaults.mjs";
import { needsShebang } from "./platform.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_ANSWER = JSON.stringify({
  is_error: false,
  result: "wrote it",
  modelUsage: { "claude-opus-5[1m]": { contextWindow: 1000000, canonicalModel: "claude-opus-5" } },
});

const record = (hits) => ({ ok: true, hits });
const flags = (n, conforming) => Array.from({ length: n }, () => ({ conforming, where: null }));

test("countSides tallies conforming as the claim side and the rest as the counter", () => {
  const records = new Map([
    ["a.ts", record({ nullish_default: [...flags(3, true), ...flags(1, false)] })],
    ["b.ts", record({ nullish_default: flags(2, true), swallowed_error: flags(4, false) })],
    ["c.ts", { ok: false, hits: { nullish_default: flags(9, true) } }],
  ]);
  const sides = countSides(records);
  assert.deepEqual(sides.get("nullish_default"), { claim: 5, counter: 1 });
  assert.deepEqual(sides.get("swallowed_error"), { claim: 0, counter: 4 });
  assert.equal(sides.has("c"), false, "an unread file contributes nothing");
});

test("a side needs 0.8 of at least 20 sites", () => {
  assert.equal(decideDefault({ claim: 18, counter: 2 }), "claim");
  assert.equal(decideDefault({ claim: 2, counter: 18 }), "counter");
  assert.equal(decideDefault({ claim: 15, counter: 4 }), "none", "19 sites is under the evidence floor");
  assert.equal(decideDefault({ claim: 15, counter: 5 }), "none", "0.75 is under the share floor");
  assert.equal(decideDefault({ claim: 0, counter: 0 }), "none");
});

test("a measured entry is not overwritten unless forced", () => {
  const measured = {
    default: "claim",
    provenance: { method: "measured", model: "m0", date: "2026-01-01", samples: 9, sideCounts: { claim: 20, counter: 0 } },
  };
  const seed = { default: "none", provenance: { method: "literature", source: "seed: unmeasured" } };
  const incoming = {
    default: "counter",
    provenance: { method: "measured", model: "m1", date: "2026-08-16", samples: 5, sideCounts: { claim: 0, counter: 20 } },
  };

  const kept = mergeTable({ a: measured, b: seed }, { a: incoming, b: incoming });
  assert.equal(kept.a.provenance.model, "m0", "the earlier measurement stands");
  assert.equal(kept.b.provenance.model, "m1", "a seed always yields to a measurement");

  const forced = mergeTable({ a: measured }, { a: incoming }, { force: true });
  assert.equal(forced.a.provenance.model, "m1");
});

test("a learned-class dimension measures its class, never a side", async () => {
  const { countClasses, decideDefaultClass } = await import("../scripts/measure-defaults.mjs");
  const cls = (c, n) => Array.from({ length: n }, () => ({ conforming: false, class: c }));
  const records = new Map([
    ["a.ts", { ok: true, hits: { function_naming_case: [...cls("camelCase", 15), ...cls("snake_case", 2)] } }],
    ["b.ts", { ok: true, hits: { function_naming_case: cls("camelCase", 8) } }],
  ]);
  const classes = countClasses(records);
  assert.deepEqual(classes.get("function_naming_case"), { camelCase: 23, snake_case: 2 });
  assert.equal(decideDefaultClass({ camelCase: 23, snake_case: 2 }), "camelCase");
  assert.equal(decideDefaultClass({ camelCase: 12, snake_case: 2 }), null, "under 20 sites is unmeasured");
  assert.equal(decideDefaultClass({ camelCase: 14, snake_case: 7 }), null, "under 0.8 share is no default");
});

test("countSides skips a learned-class hit, whose flag is a placeholder", async () => {
  const records = new Map([
    ["a.ts", { ok: true, hits: { k: [{ conforming: false, class: "camelCase" }, { conforming: false }] } }],
  ]);
  assert.deepEqual(countSides(records).get("k"), { claim: 0, counter: 1 });
});

test("two measured batches of the same model accumulate instead of replacing", async () => {
  const { accumulate } = await import("../scripts/measure-defaults.mjs");
  const a = {
    default: "none",
    provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 18, sideCounts: { claim: 12, counter: 0 } },
  };
  const b = {
    default: "none",
    provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 11, sideCounts: { claim: 9, counter: 1 } },
  };
  const merged = accumulate(a, b);
  assert.deepEqual(merged.provenance.sideCounts, { claim: 21, counter: 1 });
  assert.equal(merged.provenance.samples, 29);
  assert.equal(merged.default, "claim", "21 of 22 clears the floor neither batch cleared alone");

  const c = { default: "none", provenance: { method: "measured", model: "OTHER", samples: 3, sideCounts: { claim: 2, counter: 0 } } };
  assert.equal(accumulate(a, c), null, "a different model is a different question");

  const classes = accumulate(
    { default: "none", class: "camelCase", provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { camelCase: 44, PascalCase: 2 } } },
    { default: "none", provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { camelCase: 10 } } }
  );
  assert.deepEqual(classes.provenance.classCounts, { camelCase: 54, PascalCase: 2 });
  assert.equal(classes.class, "camelCase");
});

test("a class read out of repository text is never written to the table", async () => {
  const { accumulate, decideTableClass } = await import("../scripts/measure-defaults.mjs");

  assert.equal(decideTableClass("function_naming_case", { camelCase: 23, snake_case: 2 }), "camelCase");
  assert.equal(
    decideTableClass("class_base", { ApplicationController: 23, Base: 2 }),
    null,
    "the table's vocabulary is the naming classes, and a superclass name is not one"
  );

  const counts = (n) => ({
    default: "none",
    provenance: { method: "measured", model: "m", samples: 3, sideCounts: null, classCounts: { ApplicationController: n } },
  });

  assert.equal("class" in accumulate(counts(20), counts(10), "class_base"), false, "and two runs do not add one");
});

test("two measured batches of the same model at different efforts are two questions, not one", async () => {
  // The guard read the model and nothing else, so a medium batch and an xhigh
  // batch summed into one tally that claimed 60 samples of a run that never
  // happened.
  const { accumulate } = await import("../scripts/measure-defaults.mjs");
  const batch = (effort, claim) => ({
    default: "none",
    provenance: { method: "measured", model: "m", effort, date: "2026-08-16", samples: 30, sideCounts: { claim, counter: 0 } },
  });

  assert.equal(accumulate(batch("medium", 12), batch("xhigh", 9)), null);

  const same = accumulate(batch("medium", 12), batch("medium", 9));
  assert.deepEqual(same.provenance.sideCounts, { claim: 21, counter: 0 });
  assert.equal(same.provenance.effort, "medium", "and the merged entry still says which effort it stands on");
});

test("a batch whose effort nobody recorded never merges with one that did", async () => {
  // Every entry measured before the effort was pinned carries no effort at all.
  // Reading that absence as the pinned level would date those runs to a setting
  // they may not have run at, which is a record nobody can check.
  const { accumulate } = await import("../scripts/measure-defaults.mjs");
  const legacy = {
    default: "claim",
    provenance: { method: "measured", model: "m", date: "2026-08-16", samples: 30, sideCounts: { claim: 23, counter: 0 } },
  };
  const pinned = {
    default: "claim",
    provenance: { method: "measured", model: "m", effort: "medium", date: "2026-08-28", samples: 30, sideCounts: { claim: 20, counter: 0 } },
  };

  assert.equal(accumulate(legacy, pinned), null);
});

/**
 * A run of the measure script against a `claude` that writes one known file.
 *
 * Running the real one costs a model call per sample and answers differently
 * each time; what these cases are about is what the script records and what it
 * says when it refuses, both of which a fixed output settles.
 */
function measuring(t, held = {}) {
  const base = mkdtempSync(join(tmpdir(), "anatomiya-measuring-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  mkdirSync(bin);
  const stub = join(bin, "claude");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      "cat > orders.ts <<'EOF'",
      "export function load(o: Opts) {",
      '  const path = o.path ?? "./orders.json";',
      "  try { return read(path); } catch (e) { report(e); return null; }",
      "}",
      "EOF",
      // The answer a real trial gives back under `--output-format json`, which
      // is where the engine that served it is read from.
      "cat <<'JSON'",
      `${ENGINE_ANSWER}`,
      "JSON",
      "",
    ].join("\n")
  );
  chmodSync(stub, 0o755);
  const table = join(base, "table.json");
  writeFileSync(table, `${JSON.stringify(held, null, 2)}\n`);
  // A config directory of its own, so the suite answers for the script rather
  // than for whatever the machine running it has set. The engine gate reads the
  // settings Claude Code reads, and this machine's own name a level.
  const config = join(base, "config");
  mkdirSync(config);

  const run = (...extra) => {
    const r = spawnSync(
      process.execPath,
      [join(root, "scripts", "measure-defaults.mjs"), "--samples", "1", "--tasks", "js-service", "--out", table, "--dry", ...extra],
      { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: config, PATH: [bin, "/usr/bin", "/bin"].join(":") } }
    );
    return { status: r.status, table: JSON.parse(r.stdout), said: r.stderr };
  };
  return { run };
}

const HELD_AT_XHIGH = {
  nullish_default: {
    default: "claim",
    provenance: {
      method: "measured", model: "claude-opus-5[1m]", effort: "xhigh",
      date: "2026-08-16", samples: 30, sideCounts: { claim: 40, counter: 0 },
    },
  },
};

test("a measured entry records the engine that produced it, not just the model", needsShebang, (t) => {
  // The merge guard can only refuse a mismatch the record carries. Provenance
  // named the model alone, so every entry was silent about the effort it was
  // measured at and the guard had nothing to read.
  const { run } = measuring(t);

  const { status, table } = run();

  assert.equal(status, 0);
  const entries = Object.values(table);
  assert.ok(entries.length > 0, "the stub wrote nothing the parse counted");
  for (const entry of entries) {
    assert.equal(entry.provenance.model, "claude-opus-5[1m]");
    assert.equal(entry.provenance.effort, "medium");
    assert.equal(entry.provenance.contextWindow, 1000000, "the window the answer reported, not the one the id asked for");
  }
});

test("a held entry measured at another effort stands, and the new batch does not join it", needsShebang, (t) => {
  const { run } = measuring(t, HELD_AT_XHIGH);

  const { table } = run();

  assert.deepEqual(table.nullish_default.provenance, HELD_AT_XHIGH.nullish_default.provenance);
});

test("and the run says which half of the engine it refused on", needsShebang, (t) => {
  // The refusal is the safe answer and the expensive one: the trials are paid
  // for by the time it fires. A run that changes nothing and says nothing reads
  // as a run that found nothing.
  const { run } = measuring(t, HELD_AT_XHIGH);

  const { said } = run();

  assert.match(
    said,
    /1 key holds a measurement of claude-opus-5\[1m\] at xhigh, and this run is claude-opus-5\[1m\] at medium in a 1000000 window, so it stands \(--force replaces\): nullish_default/,
    said
  );
});

test("--force replaces a held entry measured at another effort", needsShebang, (t) => {
  const { run } = measuring(t, HELD_AT_XHIGH);

  const { table } = run("--force");

  assert.equal(table.nullish_default.provenance.effort, "medium");
});

test("an effort the CLI does not take is refused before a single trial is spent", () => {
  // Refused in parseArgs, so it needs no stub and reaches no model: the whole
  // point is that a typo costs nothing rather than a batch.
  const r = spawnSync(process.execPath, [join(root, "scripts", "measure-defaults.mjs"), "--effort", "med"], {
    encoding: "utf8",
  });

  assert.equal(r.status, 2);
  assert.match(r.stderr, /--effort takes one of low, medium, high, xhigh, max, not "med"/);
});

test("the keys a run refuses are grouped by the engine they hold, not listed one per line", async () => {
  // The pinned model moved from claude-opus-5 to claude-opus-5[1m], so all 24
  // measured rows in the shipped table refuse on the model half as well as the
  // effort half. One line per key is 24 lines saying the same thing.
  const { refusedLines } = await import("../scripts/measure-defaults.mjs");
  const old = (n) => ({ default: "claim", provenance: { method: "measured", model: "claude-opus-5", samples: n, sideCounts: { claim: 30, counter: 0 } } });
  const existing = { a: old(30), b: old(30), c: old(30), d: old(30) };
  const measured = { a: {}, b: {}, c: {}, d: {} };

  const lines = refusedLines(existing, measured, { model: "claude-opus-5[1m]", effort: "medium" });

  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^4 keys hold a measurement of claude-opus-5 at an effort nobody recorded/);
  assert.match(lines[0], /this run is claude-opus-5\[1m\] at medium/);
  assert.match(lines[0], /--force replaces/);
  assert.match(lines[0], /a, b, c and 1 more$/);
});

test("one refused key reads as one, and a key this run did not measure is not refused", async () => {
  const { refusedLines } = await import("../scripts/measure-defaults.mjs");
  const held = (effort) => ({ default: "claim", provenance: { method: "measured", model: "m", effort, samples: 9, sideCounts: { claim: 30, counter: 0 } } });
  const existing = { a: held("xhigh"), untouched: held("xhigh"), seeded: { default: "none", provenance: { method: "literature", source: "seed" } } };

  const lines = refusedLines(existing, { a: {}, seeded: {} }, { model: "m", effort: "medium" });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^1 key holds a measurement of m at xhigh/);
  assert.match(lines[0], /so it stands \(--force replaces\): a$/);
});

test("a run of the same engine refuses nothing, and --force refuses nothing", async () => {
  const { refusedLines } = await import("../scripts/measure-defaults.mjs");
  const same = { default: "claim", provenance: { method: "measured", model: "m", effort: "medium", samples: 9, sideCounts: { claim: 30, counter: 0 } } };

  assert.deepEqual(refusedLines({ a: same }, { a: {} }, { model: "m", effort: "medium" }), []);
  assert.deepEqual(refusedLines({ a: same }, { a: {} }, { model: "m", effort: "xhigh" }, { force: true }), []);
});

test("a flag left without its value is refused, not read as the default", () => {
  // `--effort` last in argv made argv[++i] undefined, the pinned level filled in
  // for it, and the batch ran at a level nobody asked for. `--tasks` in the same
  // place threw on undefined.split instead.
  for (const flag of ["--samples", "--model", "--effort", "--out", "--tasks"]) {
    const r = spawnSync(process.execPath, [join(root, "scripts", "measure-defaults.mjs"), flag], { encoding: "utf8" });

    assert.equal(r.status, 2, `${flag}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^\\${flag} takes a value`, "m"), `${flag}: ${r.stderr}`);
  }
});

test("two batches of the same model at different context windows are two questions", async () => {
  // The `[1m]` suffix is in the model string either way, so the model half
  // cannot tell a granted window from a denied one. Only the observation can.
  const { accumulate } = await import("../scripts/measure-defaults.mjs");
  const batch = (contextWindow) => ({
    default: "none",
    provenance: { method: "measured", model: "claude-opus-5[1m]", effort: "medium", contextWindow, samples: 30, sideCounts: { claim: 12, counter: 0 } },
  });

  assert.equal(accumulate(batch(1000000), batch(200000)), null);
  assert.equal(accumulate(batch(1000000), batch(1000000)).provenance.contextWindow, 1000000);
});

test("a table that cannot be read stops the run before it spends a trial", () => {
  // It was read after the batch, so `--out` naming a missing file spent every
  // call and then died on a raw ENOENT with nothing to show for them.
  const r = spawnSync(process.execPath, [join(root, "scripts", "measure-defaults.mjs"), "--out", join(tmpdir(), "anatomiya-no-such-table.json")], { encoding: "utf8" });

  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out names a table this cannot read/);
});

test("a table that is valid JSON but not a table of entries is refused too", () => {
  // `null`, a number and a string all parse, so the read guard passed them and
  // the batch ran; `refusedLines` then threw on Object.entries(null) with every
  // call already spent.
  const base = mkdtempSync(join(tmpdir(), "anatomiya-shape-"));
  for (const body of ["null", "123", '"x"', "[]"]) {
    const table = join(base, "t.json");
    writeFileSync(table, body);
    const r = spawnSync(process.execPath, [join(root, "scripts", "measure-defaults.mjs"), "--out", table], { encoding: "utf8" });

    assert.equal(r.status, 2, `${body}: ${r.stderr}`);
    assert.match(r.stderr, /--out names a table this cannot read/, body);
  }
  rmSync(base, { recursive: true, force: true });
});

test("a --tasks naming no task says that, rather than blaming the output", () => {
  // It ran zero trials and then reported "no parseable output was produced",
  // which names a cause that never happened.
  const r = spawnSync(process.execPath, [join(root, "scripts", "measure-defaults.mjs"), "--tasks", "no-such-task", "--dry"], { encoding: "utf8" });

  assert.equal(r.status, 2);
  assert.match(r.stderr, /--tasks names no task this knows: no-such-task/);
});
