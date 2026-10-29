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
 * usage: node scripts/find-replay.mjs [--queries <file>] [--ranking '<json>'] <name>=<checkout> [<name>=<checkout> ...]
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { queries: { type: "string" }, ranking: { type: "string" } } });
  const pairs = positionals.map((arg) => arg.split("="));
  if (pairs.length === 0 || pairs.some((p) => p.length !== 2 || p[0] === "" || p[1] === "")) {
    console.error("usage: node scripts/find-replay.mjs [--queries <file>] [--ranking '<json>'] <name>=<checkout> [<name>=<checkout> ...]");
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
  const ranking = { ...RANKING, ...(values.ranking ? JSON.parse(values.ranking) : {}) };
  const { queries } = JSON.parse(readFileSync(values.queries ?? QUERIES, "utf8"));
  for (const line of report(replay(indexes, queries, ranking))) console.log(line);
}
