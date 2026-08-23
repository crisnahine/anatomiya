#!/usr/bin/env node
/**
 * What the delivery channel did, counted off the sessions it ran in.
 *
 * The map reaches an agent as Claude Code nested memory: the overview carries no
 * `paths` key and loads unconditionally, an area file carries one and loads when
 * a matching file is read. A6, A7 and A8 all rest on how long one of those
 * deliveries lasts, and until this script there was nothing counting it.
 *
 * A transcript records a delivery as an attachment entry, so a session that has
 * already run can be asked what it received and when. Every number here comes
 * from that entry and from the compaction boundaries around it, never from the
 * rendered file on disk: what the tool wrote and what the session got are the
 * two things this is here to tell apart.
 *
 * Read-only over the transcript store. Nothing is written except the `--md`
 * target, and only when asked for.
 */
import { createReadStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

import { invokedAs } from "./entry.mjs";

// What Claude Code calls the channel. A rule file and a nested CLAUDE.md arrive
// through the same one, which is why this counts both and splits them by whether
// the delivery carried globs.
const DELIVERY = "nested_memory";

// A line that cannot hold one of the two events is never parsed: the store runs
// to gigabytes and most of it is tool output.
const CANDIDATE = [DELIVERY, "compact_boundary", '"isCompactSummary":true'];

/**
 * The event a transcript entry is, or null when it is neither.
 *
 * Matched on the attachment rather than on the filename, because a bash result
 * listing `.claude/rules/` names every file in it and the first cut of this
 * counted those as deliveries.
 */
export function eventOf(entry) {
  if (entry.isCompactSummary === true || entry.subtype === "compact_boundary") return { kind: "compact" };
  if (entry.type !== "attachment" || entry.attachment?.type !== DELIVERY) return null;
  return {
    kind: "delivery",
    path: entry.attachment.path,
    scoped: (entry.attachment.content?.globs ?? []).length > 0,
    sidechain: entry.isSidechain === true,
  };
}

/**
 * One session's deliveries, and what sat between a path and its repeat.
 *
 * A repeat is the whole question. The delivery is deduped against the context
 * window rather than latched for the session, so a path arriving twice means the
 * window was rebuilt in between, and a compaction boundary in the gap is the
 * cause this can name.
 */
export function sessionOf(events) {
  const seen = new Map();
  const out = {
    deliveries: 0,
    sidechain: 0,
    scoped: 0,
    unscoped: 0,
    compacts: 0,
    repeats: [],
    reloadedAfterCompact: 0,
    compactedAfterDelivery: false,
  };

  for (const event of events) {
    if (event.kind === "compact") {
      out.compacts++;
      if (out.deliveries > 0) out.compactedAfterDelivery = true;
      continue;
    }
    // A subagent runs in its own window, so its delivery says nothing about the
    // main thread's dedup and is counted where it cannot be mistaken for one.
    if (event.sidechain) {
      out.sidechain++;
      continue;
    }
    out.deliveries++;
    if (event.scoped) out.scoped++;
    else out.unscoped++;

    if (seen.has(event.path)) {
      const after = out.compacts > seen.get(event.path) ? "compact" : "other";
      out.repeats.push({ path: event.path, after });
      if (after === "compact") out.reloadedAfterCompact++;
    }
    seen.set(event.path, out.compacts);
  }
  return out;
}

/** Every session added up, plus the counts that are per session rather than per delivery. */
export function summarize(sessions) {
  const out = {
    sessions: sessions.length,
    sessionsWithDelivery: 0,
    deliveries: 0,
    scoped: 0,
    unscoped: 0,
    sidechain: 0,
    repeats: 0,
    repeatsAfterCompact: 0,
    sessionsCompactedAfterDelivery: 0,
    sessionsReloadedAfterCompact: 0,
  };
  for (const s of sessions) {
    if (s.deliveries > 0) out.sessionsWithDelivery++;
    out.deliveries += s.deliveries;
    out.scoped += s.scoped;
    out.unscoped += s.unscoped;
    out.sidechain += s.sidechain;
    out.repeats += s.repeats.length;
    out.repeatsAfterCompact += s.reloadedAfterCompact;
    if (s.compactedAfterDelivery) out.sessionsCompactedAfterDelivery++;
    if (s.reloadedAfterCompact > 0) out.sessionsReloadedAfterCompact++;
  }
  return out;
}

export function tableOf(rows, columns) {
  const out = [`| ${columns.join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${columns.map((c) => r[c] ?? "-").join(" | ")} |`);
  return out.join("\n");
}

// --- reading the store ------------------------------------------------------

/** Every `.jsonl` under the store, session transcripts and subagent ones alike. */
function transcripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...transcripts(path));
    else if (entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

async function eventsIn(file, match) {
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  const out = [];
  for await (const line of reader) {
    if (!CANDIDATE.some((needle) => line.includes(needle))) continue;
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      // A transcript is appended to while a session runs, so the last line of a
      // live one is routinely half-written. Skipping it costs one event.
      continue;
    }
    const event = eventOf(entry);
    if (event === null) continue;
    if (event.kind === "delivery" && match !== null && !event.path.includes(match)) continue;
    out.push(event);
  }
  return out;
}

// --- the run ----------------------------------------------------------------

const USAGE = `usage: node scripts/measure-delivery.mjs <transcriptDir> [options]

  <transcriptDir>    a Claude Code transcript store, usually ~/.claude/projects
  --match <text>     count only deliveries whose path holds this text
  --md <path>        write the summary and the per-session table here
  --force            write over the --md path if a file is already there
`;

const VALUE_OPTIONS = ["--md", "--match"];

export function parseArgs(argv) {
  const opts = { dir: null, md: null, match: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      opts.force = true;
      continue;
    }
    if (VALUE_OPTIONS.includes(arg)) {
      if (i + 1 >= argv.length) return { error: `${arg} needs a value after it` };
      opts[arg.slice(2)] = argv[++i];
      continue;
    }
    if (arg.startsWith("-")) return { error: `unknown option: ${arg}` };
    opts.dir = arg;
  }
  if (opts.dir === null) return { error: "the transcript directory is required" };
  return opts;
}

/** Whether the run may write where `--md` points. Same rule the layout bar holds. */
export function checkOutput(path, force, exists) {
  if (path === null || force || !exists) return null;
  return `${path} is already there, and this run writes its --md target whole; pass --force to write over it`;
}

const SESSION_COLUMNS = ["session", "deliveries", "scoped", "unscoped", "compacts", "repeats", "afterCompact"];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`${opts.error}\n\n${USAGE}`);
    process.exit(2);
  }
  const dir = resolve(opts.dir);
  if (!existsSync(dir)) {
    console.error(`no transcript store at ${dir}\n\n${USAGE}`);
    process.exit(2);
  }
  const md = opts.md === null ? null : resolve(opts.md);
  const refused = checkOutput(md, opts.force, md !== null && existsSync(md));
  if (refused) {
    console.error(`${refused}\n\n${USAGE}`);
    process.exit(2);
  }

  const files = transcripts(dir);
  const sessions = [];
  const rows = [];
  for (const file of files) {
    const seen = sessionOf(await eventsIn(file, opts.match));
    sessions.push(seen);
    if (seen.deliveries === 0 && seen.sidechain === 0) continue;
    rows.push({
      session: file.slice(dir.length + 1),
      deliveries: seen.deliveries,
      scoped: seen.scoped,
      unscoped: seen.unscoped,
      compacts: seen.compacts,
      repeats: seen.repeats.length,
      afterCompact: seen.reloadedAfterCompact,
    });
  }

  const total = summarize(sessions);
  rows.sort((a, b) => b.repeats - a.repeats || b.deliveries - a.deliveries);
  const lines = [
    `transcripts read: ${files.length}`,
    ...Object.entries(total).map(([k, v]) => `${k}: ${v}`),
    "",
    tableOf(rows.slice(0, 40), SESSION_COLUMNS),
  ];
  console.log(lines.join("\n"));
  if (md) writeFileSync(md, `${lines.join("\n")}\n`);
}

// Guarded, because the tests import the counters from here and an unguarded run
// would walk a transcript store instead of asserting.
if (invokedAs(import.meta.url)) {
  await main();
}
