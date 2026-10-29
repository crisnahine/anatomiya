#!/usr/bin/env node
/**
 * How well `find` ranks the helper each recorded query was after, with today's
 * weights or another set: the rank of the helper, the mean reciprocal rank over
 * the queries, and how many were first, in the top three and in the six `find`
 * prints. A rank past what `find` prints counts nothing toward the mean (H60).
 *
 * Each repository's index is the one a scan wrote into its checkout; a query on
 * a repository not given is left out and named.
 *
 * `--sweep` scores every set of the grid H60 records instead, and says how
 * many score above today's weights and how many the same.
 *
 * usage: node scripts/find-replay.mjs [--queries <file>] [--ranking '<json>' | --sweep] <name>=<checkout> [<name>=<checkout> ...]
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { findSymbols, RANKING } from "../plugins/anatomiya/lib/find.mjs";
import { readIndex } from "../plugins/anatomiya/lib/index-home.mjs";
import { invokedAs } from "./entry.mjs";

const ROOT = join(import.meta.dirname, "..");
export const QUERIES = join(ROOT, "docs", "measurements", "data", "2026-10-28-find.json");

/** The rank of `helper` among every hit `words` finds, or null where it is not among them. */
function rankOf(index, words, helper, ranking) {
  const at = findSymbols(index, words, { ...ranking, shown: Infinity }).findIndex((hit) => hit.name === helper);
  return at === -1 ? null : at + 1;
}

/**
 * Each query's rank over the index of its repository, and the scores over all of them.
 * `indexes` maps a repository's name to its read index; `queries` are `{ repository, query, helper }`.
 */
export function replay(indexes, queries, ranking = RANKING) {
  const asked = queries.filter((q) => indexes.has(q.repository));
  const ranks = asked.map((q) => ({ ...q, rank: rankOf(indexes.get(q.repository), q.query.split(/\s+/), q.helper, ranking) }));
  const within = (most) => ranks.filter((r) => r.rank !== null && r.rank <= most).length;
  const shown = ranks.map((r) => (r.rank !== null && r.rank <= ranking.shown ? 1 / r.rank : 0));
  return {
    ranks,
    left: queries.filter((q) => !indexes.has(q.repository)).map((q) => q.repository),
    meanReciprocalRank: ranks.length ? Number((shown.reduce((a, b) => a + b, 0) / ranks.length).toFixed(3)) : 0,
    first: within(1),
    topThree: within(3),
    shown: within(ranking.shown),
  };
}

// The weight sets H60 swept, each name's values beside today's; every other weight stays at today's.
export const GRID = { name: [2, 3, 4], container: [1, 2, 3], doc: [0.5, 1, 2], path: [0.5, 1], reach: [0, 0.1, 0.15, 0.2, 0.3], test: [0.25, 0.5, 0.75] };

/** Every set `grid` spans, scored: how many there are, today's own score, and how many score above it or the same, today's included. */
export function sweep(indexes, queries, grid = GRID) {
  const sets = Object.entries(grid).reduce((all, [key, values]) => all.flatMap((set) => values.map((v) => ({ ...set, [key]: v }))), [{ ...RANKING }]);
  const today = replay(indexes, queries);
  const scores = sets.map((ranking) => replay(indexes, queries, ranking).meanReciprocalRank);
  return {
    sets: sets.length,
    today,
    higher: scores.filter((m) => m > today.meanReciprocalRank).length,
    same: scores.filter((m) => m === today.meanReciprocalRank).length,
  };
}

/** One line per query and one for the scores, as the measurement page prints them. */
export function report(result) {
  const lines = result.ranks.map((r) => `${r.repository}\t${r.query}\t${r.helper}\t${r.rank ?? "-"}`);
  const of = result.ranks.length;
  lines.push(`MRR ${result.meanReciprocalRank.toFixed(3)}, first ${result.first} of ${of}, top three ${result.topThree} of ${of}, shown ${result.shown} of ${of}`);
  const left = [...new Set(result.left)];
  if (left.length) lines.push(`left out, no index given: ${left.join(", ")}`);
  return lines;
}

if (invokedAs(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { queries: { type: "string" }, ranking: { type: "string" }, sweep: { type: "boolean" } } });
  const pairs = positionals.map((arg) => arg.split("="));
  if (pairs.length === 0 || pairs.some((p) => p.length !== 2 || p[0] === "" || p[1] === "")) {
    console.error("usage: node scripts/find-replay.mjs [--queries <file>] [--ranking '<json>' | --sweep] <name>=<checkout> [<name>=<checkout> ...]");
    process.exit(2);
  }
  if (values.sweep && values.ranking) {
    console.error("--sweep scores the grid H60 records, so it takes no --ranking");
    process.exit(2);
  }
  const indexes = new Map();
  for (const [name, checkout] of pairs) {
    const index = readIndex(resolve(checkout));
    if (index === null) {
      console.error(`${name}: no code index in ${checkout}; run \`anatomiya scan\` there first`);
      process.exit(1);
    }
    indexes.set(name, index);
  }
  const { queries } = JSON.parse(readFileSync(values.queries ?? QUERIES, "utf8"));
  if (values.sweep) {
    const swept = sweep(indexes, queries);
    console.log(`${swept.sets} weight sets: ${swept.higher} score above today's ${swept.today.meanReciprocalRank.toFixed(3)} and ${swept.same} the same, today's among them`);
  } else {
    const ranking = { ...RANKING, ...(values.ranking ? JSON.parse(values.ranking) : {}) };
    for (const line of report(replay(indexes, queries, ranking))) console.log(line);
  }
}
