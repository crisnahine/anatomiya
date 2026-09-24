// scripts/ab/args.mjs
/**
 * The harness's argument gate, answered before anything is spent.
 *
 * Refused here rather than thirty model calls in: a typo in an effort level or
 * a flag nobody declared costs nothing at the door and a whole batch past it.
 */
import { readArgv } from "../entry.mjs";
import { CLAUDE_DEFAULTS } from "./run.mjs";
import { engineFor } from "./engine.mjs";

export const USAGE = `usage: node scripts/ab.mjs --repo <path> --task <file> [options]

  --repo <path>      the repository to measure, scanned and pinned in place
  --task <file>      a file holding the prompt both arms are given
  --trials <n>       trials per arm (default 10)
  --model <name>     model for every trial (default ${CLAUDE_DEFAULTS.model}); quote it, since
                     the bracketed suffix is a glob in most shells
  --effort <level>   effort for every trial (default ${CLAUDE_DEFAULTS.effort})
  --out <path>       where to write the result (default docs/measurements/<repo>.md)
  --min-headroom <r> refuse below this (default 0.05)
  --key <dimension>  measure this claim rather than the top-ranked one
  --area <path>      measure in this area rather than the top-ranked one
`;

const OPTIONS = Object.fromEntries(
  ["repo", "task", "trials", "model", "effort", "out", "min-headroom", "key", "area"].map((k) => [k, { type: "string" }])
);

/**
 * The run's arguments, with the model and the effort folded into one engine,
 * or `{ error }` naming the first thing refused.
 */
export function parseArgs(argv) {
  const read = readArgv(argv, OPTIONS);
  if (read.error) return read;
  const { trials = "10", "min-headroom": headroom = "0.05", ...named } = read.values;
  const out = {
    model: CLAUDE_DEFAULTS.model,
    effort: CLAUDE_DEFAULTS.effort,
    ...named,
    trials: Number(trials),
    minHeadroom: Number(headroom),
  };
  if (!out.repo || !out.task) return { error: "both --repo and --task are required" };
  if (!Number.isInteger(out.trials) || out.trials < 1) return { error: "--trials takes a positive integer" };
  // NaN compares false against every headroom, which is the floor switched off.
  if (!(out.minHeadroom >= 0 && out.minHeadroom <= 1)) return { error: "--min-headroom takes a number from 0 to 1" };
  const engine = engineFor(out);
  if (engine.error) return { error: engine.error };
  const { model, effort, ...rest } = out;
  return { ...rest, engine };
}
