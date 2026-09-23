#!/usr/bin/env node
/**
 * How often the echo hook repeated itself, how many of those deliveries the
 * once-per-window rule keeps, and how many transcript bytes a context token
 * costs, counted off the sessions it ran in (A92).
 *
 * A repeat is a delivery whose map equals the one before it with no compaction
 * between. The replay applies the rule `heldIn` applies at run time, reading
 * each line through the hook's own `echoEvent`: a map is kept unless the same
 * map was kept within the window and no compaction came after it. It differs
 * in one place: maps written before A92 carry no digest, so they are compared
 * by body, with the opening tag left out because it holds the timestamp.
 *
 * Read-only over the transcript store.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

import { invokedAs } from "./entry.mjs";
import { transcripts } from "./measure-delivery.mjs";
import { ECHO_WINDOW_BYTES, echoEvent } from "../plugins/anatomiya/lib/hook.mjs";

const OPENING = /^<repository-map[^>]*>/;

// A session that grew its context by less than this says little about the
// ratio: a few long tool results dominate it.
const RATIO_SPAN_TOKENS = 50000;

/** The echo's counts over one transcript's lines, in the order it holds them. */
export function replayEcho(lines, window = ECHO_WINDOW_BYTES) {
  const out = { made: 0, repeats: 0, kept: 0 };
  let offset = 0;
  let previous = null;
  let held = [];
  for (const line of lines) {
    const at = offset;
    offset += Buffer.byteLength(line) + 1;
    const event = echoEvent(line);
    if (event === null) continue;
    if (event === "compact") {
      previous = null;
      held = [];
      continue;
    }
    for (const text of event) {
      if (!OPENING.test(text)) continue;
      const body = text.replace(OPENING, "");
      out.made++;
      if (body === previous) out.repeats++;
      previous = body;
      if (held.some((h) => h.body === body && at - h.at <= window)) continue;
      out.kept++;
      held.push({ body, at });
    }
  }
  return out;
}

/**
 * Transcript bytes written per token of context, from the first main-thread
 * turn to the last, or null where the context grew by less than `span` tokens.
 */
export function bytesPerToken(lines, span = RATIO_SPAN_TOKENS) {
  let offset = 0;
  let first = null;
  let last = null;
  for (const line of lines) {
    offset += Buffer.byteLength(line) + 1;
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.type === "assistant" && entry.isSidechain !== true ? entry.message?.usage : null;
    if (!usage) continue;
    const tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    first ??= { offset, tokens };
    last = { offset, tokens };
  }
  if (first === null || last.tokens - first.tokens < Math.max(span, 1)) return null;
  return (last.offset - first.offset) / (last.tokens - first.tokens);
}

const quantile = (sorted, q) => sorted[Math.floor(q * (sorted.length - 1))];

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/measure-echo.mjs <transcriptDir>");
    process.exit(2);
  }
  if (!existsSync(dir)) {
    console.error(`no such directory: ${dir}`);
    process.exit(2);
  }
  if (!statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(2);
  }
  const total = { transcripts: 0, made: 0, repeats: 0, kept: 0 };
  const ratios = [];
  for (const file of transcripts(dir)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    const counts = text.includes("<repository-map") ? replayEcho(lines) : { made: 0 };
    if (counts.made > 0) {
      total.transcripts++;
      for (const key of ["made", "repeats", "kept"]) total[key] += counts[key];
    }
    const ratio = bytesPerToken(lines);
    if (ratio !== null) ratios.push(ratio);
  }
  ratios.sort((a, b) => a - b);
  const bytes = ratios.length === 0 ? null : { sessions: ratios.length, p10: quantile(ratios, 0.1), median: quantile(ratios, 0.5) };
  console.log(JSON.stringify({ ...total, bytesPerToken: bytes }));
}

if (invokedAs(import.meta.url)) {
  main();
}
