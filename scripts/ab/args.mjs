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
  --frozen <sha>     scan, pin and load the plugin built at this commit, not the working tree's
`;

const OPTIONS = Object.fromEntries(
  ["repo", "task", "trials", "model", "effort", "out", "min-headroom", "key", "area", "frozen"].map((k) => [k, { type: "string" }])
);

/** The scenario run's help, printed under any refusal of its arguments. */
export const SCENARIO_USAGE = `usage: node scripts/ab-scenario.mjs --repo <path> --scenario <file> [options]

  --repo <path>      a clone at the scenario's commit, scanned and pinned in place
  --scenario <file>  the task and its checks (scripts/ab/scenarios/)
  --trials <n>       trials per arm (default 10)
  --model <name>     model for every trial (default ${CLAUDE_DEFAULTS.model}); quote it
  --effort <level>   effort for every trial (default ${CLAUDE_DEFAULTS.effort})
  --out <path>       the result (default docs/measurements/<scenario>.md)
  --data <path>      every trial's checks and cost (default docs/measurements/data/<scenario>.json)
  --raw <path>       every trial's written files too, to score again without a rerun
  --from-raw <path>  score kept raw records instead of running trials; give it once per
                     run to join several runs of one scenario (no --repo then)
  --frozen <sha>     scan, pin and load the plugin built at this commit, not the working tree's
`;

const SCENARIO_OPTIONS = {
  ...Object.fromEntries(["repo", "scenario", "trials", "model", "effort", "out", "data", "raw", "frozen"].map((k) => [k, { type: "string" }])),
  "from-raw": { type: "string", multiple: true },
};

/** The scenario run's arguments, refused the way `parseArgs` refuses the dimension run's. */
export function parseScenarioArgs(argv) {
  const read = readArgv(argv, SCENARIO_OPTIONS);
  if (read.error) return read;
  const { trials = "10", model = CLAUDE_DEFAULTS.model, effort = CLAUDE_DEFAULTS.effort, "from-raw": fromRaw, ...named } = read.values;
  if (fromRaw) return named.scenario ? { ...named, fromRaw } : { error: "--scenario is required" };
  if (!named.repo || !named.scenario) return { error: "both --repo and --scenario are required" };
  const count = Number(trials);
  if (!Number.isInteger(count) || count < 1) return { error: "--trials takes a positive integer" };
  const engine = engineFor({ model, effort });
  if (engine.error) return { error: engine.error };
  return { ...named, trials: count, engine };
}

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
