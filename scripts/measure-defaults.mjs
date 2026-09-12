#!/usr/bin/env node
/**
 * Measure which side of each dimension the model writes unprompted, and write
 * the answer into plugins/anatomiya/lib/model-defaults.json with its provenance.
 *
 * Run by hand, never in CI: it spends model calls. The tasks are neutral
 * generation prompts that never name a convention, the outputs are parsed by
 * the same predicates the scan uses, and the same sites are the sideCounts, so
 * the harness's number and the table's number are the same number by
 * construction (the G5 principle).
 *
 * The trials run through the same headless CLI the A/B uses, on purpose: the
 * maps are read by agents inside that harness, so the default worth filtering
 * on is the agent as deployed, harness prompt included. A construct the shared
 * prompts never elicit stays under the 20-site floor and reads none, which
 * fails open: the dimension keeps stating.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invokedAs } from "./entry.mjs";
import { ANATOMIYA } from "./plugins.mjs";
import { ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";
import { parseAll } from "../plugins/anatomiya/lib/parse.mjs";
import { language } from "../plugins/anatomiya/lib/langs.mjs";
import { classifyBasename } from "../plugins/anatomiya/lib/dimensions-naming.mjs";
import { runTrial, CLAUDE_DEFAULTS } from "./ab/run.mjs";
import { conflictingSettings, engineFor, engineRan } from "./ab/engine.mjs";
import { settingsFor } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";

const TABLE_PATH = join(ANATOMIYA, "lib", "model-defaults.json");

/**
 * Neutral generation tasks. A handful of prompts whose outputs, parsed once,
 * feed every dimension at once: what construct appears is the model's choice,
 * which is the thing being measured.
 */
const TASKS = [
  {
    id: "js-service",
    prompt:
      "In this empty project, create src/orders.ts: a module that loads order records from a JSON file path given in options, a function fetching one order by id which may be absent, a function summing totals over a list of orders, and handling for a load that can fail. Plain TypeScript, no dependencies.",
  },
  {
    id: "js-cli",
    prompt:
      "In this empty project, create src/config.js and src/main.js for a small Node CLI that reads settings with fallbacks for missing fields from an options object, iterates input lines, and reports progress. No dependencies.",
  },
  {
    id: "jsx-component",
    prompt:
      "In this empty project, create src/OrderList.tsx: a React component rendering a list of orders with a click handler per row and a heading showing the count. Assume React 18 is installed.",
  },
  {
    id: "js-tests",
    prompt:
      "In this empty project, create src/math.ts with two small pure exported functions and test/math.test.ts covering them. Assume vitest is installed.",
  },
  {
    id: "ruby-service",
    prompt:
      "In this empty project, create app/services/order_importer.rb: a Ruby service class that reads rows from a CSV path, looks up a record by id which may be absent, and handles a read failure. Plain Ruby.",
  },
  {
    id: "ruby-migration",
    prompt:
      "In this empty Rails project, create db/migrate/20260101000000_create_orders.rb: an ActiveRecord migration adding an orders table with a user reference, a total column and a status column.",
  },
];

/**
 * Conforming sites are the claim side; the rest are the counter side. A hit
 * carrying a class is a learned-class vote whose flag is a placeholder the
 * reducer overwrites, so it is not a side at all.
 */
export function countSides(records) {
  const sides = new Map();
  for (const r of records.values()) {
    if (!r.ok || !r.hits) continue;
    for (const [key, hits] of Object.entries(r.hits)) {
      const s = sides.get(key) ?? { claim: 0, counter: 0 };
      let any = false;
      for (const h of hits) {
        if (h.class) continue;
        any = true;
        h.conforming ? s.claim++ : s.counter++;
      }
      if (any || sides.has(key)) sides.set(key, s);
    }
  }
  return sides;
}

/** Class votes per learned-class dimension. */
export function countClasses(records) {
  const out = new Map();
  for (const r of records.values()) {
    if (!r.ok || !r.hits) continue;
    for (const [key, hits] of Object.entries(r.hits)) {
      for (const h of hits) {
        if (!h.class) continue;
        const tally = out.get(key) ?? {};
        tally[h.class] = (tally[h.class] || 0) + 1;
        out.set(key, tally);
      }
    }
  }
  return out;
}

/** The model's class at 0.8 of at least 20 sites, or null. */
export function decideDefaultClass(tally) {
  const entries = Object.entries(tally);
  const total = entries.reduce((n, [, c]) => n + c, 0);
  if (total < 20) return null;
  const [top, count] = entries.sort((a, b) => b[1] - a[1])[0];
  return count / total >= 0.8 ? top : null;
}

// A row whose class is a constant out of the repository's own source votes for
// names like ApplicationController, and the table is validated against the
// closed naming vocabulary, so writing one there fails every later scan.
const FROM_SOURCE = new Set(ALL_DIMENSIONS.filter((d) => d.learnedFromSource).map((d) => d.key));

/** The class this row may carry in the table, or null. */
export const decideTableClass = (key, tally) => (FROM_SOURCE.has(key) ? null : decideDefaultClass(tally));

/** A side is the default at 0.8 of at least 20 sites; anything less is none. */
export function decideDefault({ claim, counter }) {
  const total = claim + counter;
  if (total < 20) return "none";
  if (claim / total >= 0.8) return "claim";
  if (counter / total >= 0.8) return "counter";
  return "none";
}

/**
 * Two measured batches of the same engine answer one question, so their counts
 * sum and the decision is retaken over the union: 19 sites and 10 sites are 29,
 * which can clear the floor neither batch cleared alone. A different model is a
 * different question and never merges, and so is a different effort: the same
 * model at medium and at xhigh writes different code. So is a different context
 * window, which the model string cannot tell apart: `claude-opus-5[1m]` is the
 * id whether the long window was granted or refused, and only the answer says
 * which.
 *
 * An entry measured before the effort was recorded carries none, and that
 * absence never matches a batch that names one. Reading it as the pinned level
 * would date those runs to a setting nobody can check they ran at; `--force`
 * replaces such an entry with one that says. Two entries that both name none
 * still merge, which is what they did before any of them named one, and no run
 * produces such a pair now: every batch this writes names its effort.
 */
export function accumulate(a, b, key = null) {
  const pa = a.provenance;
  const pb = b.provenance;
  if (pa.method !== "measured" || pb.method !== "measured") return null;
  if (pa.model !== pb.model || pa.effort !== pb.effort || pa.contextWindow !== pb.contextWindow) return null;
  const sum = (x, y) => {
    if (!x && !y) return null;
    const out = { ...(x || {}) };
    for (const [k, n] of Object.entries(y || {})) out[k] = (out[k] || 0) + n;
    return out;
  };
  const sideCounts = sum(pa.sideCounts, pb.sideCounts);
  const classCounts = sum(pa.classCounts, pb.classCounts);
  const cls = classCounts ? decideTableClass(key, classCounts) : null;
  return {
    default: sideCounts ? decideDefault(sideCounts) : "none",
    ...(cls ? { class: cls } : {}),
    provenance: {
      method: "measured",
      model: pa.model,
      ...(pa.effort ? { effort: pa.effort } : {}),
      ...(pa.contextWindow ? { contextWindow: pa.contextWindow } : {}),
      date: pb.date ?? pa.date,
      samples: (pa.samples || 0) + (pb.samples || 0),
      sideCounts,
      ...(classCounts ? { classCounts } : {}),
    },
  };
}

/** A held measurement's engine, in the words a refusal reports it in. */
const engineOf = (p) =>
  `${p.model} at ${p.effort ?? "an effort nobody recorded"}` +
  (p.contextWindow ? ` in a ${p.contextWindow} window` : "");

// Enough keys to recognise the group by, short of printing a table's worth of
// them: the names are in the file the run just read.
const NAMED_KEYS = 3;

/**
 * What this run measured but will not merge, grouped by the engine in the way.
 *
 * Refusing is the safe answer and the expensive one: the trials are paid for by
 * the time it fires, so a run that changes nothing has to say why or it reads as
 * a run that found nothing. Grouped rather than one line per key because the
 * whole table usually holds one engine: the 24 measured rows shipped so far are
 * all `claude-opus-5` with no effort, and naming each of them separately is 24
 * lines carrying one fact.
 */
export function refusedLines(existing, measured, engine, { force = false } = {}) {
  if (force) return [];
  const thisRun = engineOf(engine);
  const groups = new Map();
  for (const [key, held] of Object.entries(existing)) {
    if (!measured[key] || held.provenance?.method !== "measured") continue;
    const was = engineOf(held.provenance);
    if (was === thisRun) continue;
    groups.set(was, [...(groups.get(was) ?? []), key]);
  }
  return [...groups].map(([was, keys]) => {
    const rest = keys.length - NAMED_KEYS;
    const named = rest > 0 ? `${keys.slice(0, NAMED_KEYS).join(", ")} and ${rest} more` : keys.join(", ");
    const [count, stands] = keys.length === 1 ? ["1 key holds", "it stands"] : [`${keys.length} keys hold`, "they stand"];
    return `${count} a measurement of ${was}, and this run is ${thisRun}, so ${stands} (--force replaces): ${named}`;
  });
}

/**
 * A measured entry accumulates with a new measurement of the same model, yields
 * wholesale only to --force, and everything else yields to a measurement.
 */
export function mergeTable(existing, incoming, { force = false } = {}) {
  const out = { ...existing };
  for (const [key, entry] of Object.entries(incoming)) {
    const held = existing[key];
    if (held && held.provenance?.method === "measured" && entry.provenance?.method === "measured" && !force) {
      out[key] = accumulate(held, entry, key) ?? held;
      continue;
    }
    if (!force && held && held.provenance?.method === "measured") continue;
    out[key] = entry;
  }
  return out;
}

const TAKES_A_VALUE = new Map([
  ["--samples", (out, v) => { out.samples = Number(v); }],
  ["--model", (out, v) => { out.model = v; }],
  ["--effort", (out, v) => { out.effort = v; }],
  ["--out", (out, v) => { out.out = v; }],
  ["--tasks", (out, v) => { out.tasks = v.split(","); }],
]);

function parseArgs(argv) {
  const out = { samples: 3, model: CLAUDE_DEFAULTS.model, effort: CLAUDE_DEFAULTS.effort, out: TABLE_PATH, force: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--force") out.force = true;
    else if (flag === "--dry") out.dry = true;
    else if (!TAKES_A_VALUE.has(flag)) return { error: `unknown option ${flag}` };
    else if (argv[i + 1] === undefined) return { error: `${flag} takes a value` };
    else TAKES_A_VALUE.get(flag)(out, argv[++i]);
  }
  if (!Number.isInteger(out.samples) || out.samples < 1) return { error: "--samples takes a positive integer" };
  const unknown = (out.tasks ?? []).filter((id) => !TASKS.some((t) => t.id === id));
  if (unknown.length) return { error: `--tasks names no task this knows: ${unknown.join(", ")}` };
  const engine = engineFor(out);
  if (engine.error) return { error: engine.error };
  // Read here rather than after the batch: a path that cannot be read spent
  // every call first and then died on the open with nothing to show for them.
  let held;
  try {
    held = JSON.parse(readFileSync(out.out, "utf8"));
  } catch (err) {
    return { error: `--out names a table this cannot read: ${err.message}` };
  }
  // `null`, a number and an array all parse. Each one reached the merge and
  // threw there, after the batch was paid for.
  if (!held || typeof held !== "object" || Array.isArray(held)) {
    return { error: `--out names a table this cannot read: ${JSON.stringify(held)} is not a table of entries` };
  }
  const { model, effort, ...rest } = out;
  return { ...rest, engine, held };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }

  const inForce = conflictingSettings(settingsFor(process.env), args.engine);
  if (inForce) {
    console.error(inForce);
    process.exit(2);
  }

  const tasks = TASKS.filter((t) => !args.tasks || args.tasks.includes(t.id));
  const outputs = [];
  const trials = [];
  let runs = 0;
  for (const task of tasks) {
    for (let i = 0; i < args.samples; i++) {
      const dir = mkdtempSync(join(tmpdir(), "anatomiya-measure-"));
      try {
        const trial = await runTrial(dir, task.prompt, args.engine);
        trials.push(trial);
        if (!trial.ok && trial.reason) {
          console.error(`${task.id}#${i}: ${trial.reason}`);
          if (trial.reason.includes("not on PATH")) process.exit(1);
          continue;
        }
        let contributed = false;
        for (const f of trial.wrote) {
          // `language` answers "js" for anything, so the extension filter is
          // what keeps a README out of the parse.
          if (!/\.(ts|mts|cts|tsx|js|jsx|mjs|cjs|rb|rake)$/.test(f.rel)) continue;
          outputs.push({ rel: `${task.id}-${i}/${f.rel}`, lang: language(f.rel), source: f.source });
          contributed = true;
        }
        // A trial that wrote nothing parseable contributed no sites, and
        // counting it would overstate the evidence behind every entry.
        if (contributed) runs++;
        console.error(`${task.id}#${i}: ${trial.wrote.length} file(s)`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  if (!outputs.length) {
    console.error("no parseable output was produced, so nothing was measured");
    process.exit(1);
  }

  // What the flags asked for is a request; this is what the answers reported.
  const ran = engineRan(args.engine, trials);
  if (ran.error) {
    console.error(ran.error);
    process.exit(1);
  }
  if (ran.note) console.error(ran.note);

  const { records } = await parseAll(outputs, { frameworks: ["rails"] });
  const sides = countSides(records);
  const classes = countClasses(records);
  // The filename row is a corpus dimension with no worker hits, so its votes
  // come straight off the names the model chose.
  const fileTally = {};
  for (const o of outputs) {
    const cls = classifyBasename(o.rel);
    if (cls) fileTally[cls] = (fileTally[cls] || 0) + 1;
  }
  if (Object.keys(fileTally).length) classes.set("file_naming_case", fileTally);

  const date = new Date().toISOString().slice(0, 10);
  const measured = {};
  for (const [key, sideCounts] of sides) {
    if (sideCounts.claim + sideCounts.counter === 0) continue;
    measured[key] = {
      default: decideDefault(sideCounts),
      provenance: { method: "measured", ...ran.engine, date, samples: runs, sideCounts },
    };
  }
  for (const [key, tally] of classes) {
    const cls = decideTableClass(key, tally);
    measured[key] = {
      default: "none",
      ...(cls ? { class: cls } : {}),
      provenance: { method: "measured", ...ran.engine, date, samples: runs, sideCounts: null, classCounts: tally },
    };
  }

  const existing = args.held;
  for (const line of refusedLines(existing, measured, ran.engine, { force: args.force })) console.error(line);
  const merged = mergeTable(existing, measured, { force: args.force });
  const body = JSON.stringify(merged, null, 2) + "\n";
  if (args.dry) {
    process.stdout.write(body);
  } else {
    writeFileSync(args.out, body);
    console.error(`wrote ${Object.keys(measured).length} measured entr(y|ies) over ${runs} run(s) to ${args.out}`);
  }
}

if (invokedAs(import.meta.url)) {
  await main();
}
