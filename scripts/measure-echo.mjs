#!/usr/bin/env node
/**
 * How often the echo hook repeated itself, how many of those deliveries the
 * once-per-window rule keeps, and how many transcript bytes a context token
 * costs, counted off the sessions it ran in (A92). Bytes are those of the
 * records the model reads, which is what the window counts.
 *
 * A repeat is a delivery whose map equals the one before it with no compaction
 * between. The replay asks the echo's own `heldIn` at each delivery, over the
 * tail a call would have read there: at most `ECHO_READ_MOST` bytes of the
 * transcript up to that line, with the deliveries the rule drops left out. It
 * differs in one place: maps written before A92 carry no digest, so they are
 * compared by body, with the opening tag left out because it holds the timestamp.
 *
 * Read-only over the transcript store.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

import { invokedAs } from "./entry.mjs";
import { transcripts } from "./measure-delivery.mjs";
import { ECHO_READ_MOST, ECHO_WINDOW_BYTES, heldIn } from "../plugins/anatomiya/lib/echo.mjs";
import { echoEvent, windowBytes } from "../plugins/anatomiya/lib/transcript.mjs";

const OPENING = /^<repository-map[^>]*>/;

// A session that grew its context by less than this says little about the
// ratio: a few long tool results dominate it.
const RATIO_SPAN_TOKENS = 50000;

/** The echo's counts over one transcript's lines, in the order it holds them. */
export function replayEcho(lines, window = ECHO_WINDOW_BYTES) {
  const out = { made: 0, repeats: 0, kept: 0 };
  // The transcript as it would read had the rule run: every line, less the deliveries it drops.
  const kept = [];
  const sizes = [];
  let total = 0;
  let previous = null;
  for (const line of lines) {
    const event = echoEvent(line);
    if (event === "compact") previous = null;
    const maps = Array.isArray(event) ? event.filter((text) => OPENING.test(text)) : [];
    let dropped = 0;
    if (maps.length > 0) {
      const tail = tailBefore(kept, sizes, total);
      for (const text of maps) {
        const body = text.replace(OPENING, "");
        out.made++;
        if (body === previous) out.repeats++;
        previous = body;
        if (heldIn(tail, (t) => OPENING.test(t) && t.replace(OPENING, "") === body, { window })) dropped++;
        else out.kept++;
      }
    }
    // A line that also carries a text the rule keeps stays whole, held copies included.
    if (dropped > 0 && dropped === event.length) continue;
    kept.push(`${line}\n`);
    sizes.push(Buffer.byteLength(kept.at(-1)));
    total += sizes.at(-1);
  }
  return out;
}

/** The last `ECHO_READ_MOST` bytes of the kept lines, cut mid-line where they fall, as the hook's read cuts them. */
function tailBefore(kept, sizes, total) {
  let from = kept.length;
  let bytes = 0;
  while (from > 0 && bytes < ECHO_READ_MOST) bytes += sizes[--from];
  const text = kept.slice(from).join("");
  const cut = bytes > ECHO_READ_MOST ? Buffer.from(text).subarray(bytes - ECHO_READ_MOST).toString("utf8") : text;
  return { end: total, lines: () => cut.split("\n") };
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
    offset += windowBytes(line);
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
