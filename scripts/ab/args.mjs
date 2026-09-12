// scripts/ab/args.mjs
/**
 * The harness's argument gate, answered before anything is spent.
 *
 * Refused here rather than thirty model calls in: a typo in an effort level or
 * a flag nobody declared costs nothing at the door and a whole batch past it.
 */
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

/**
 * The run's arguments, with the model and the effort folded into one engine,
 * or `{ error }` naming the first thing refused.
 */
export function parseArgs(argv) {
  const out = { trials: 10, model: CLAUDE_DEFAULTS.model, effort: CLAUDE_DEFAULTS.effort, minHeadroom: 0.05 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return { error: `${flag} takes a value` };
    switch (flag) {
      case "--repo": out.repo = value; break;
      case "--task": out.task = value; break;
      case "--trials": out.trials = Number(value); break;
      case "--model": out.model = value; break;
      case "--effort": out.effort = value; break;
      case "--out": out.out = value; break;
      case "--min-headroom": out.minHeadroom = Number(value); break;
      case "--key": out.key = value; break;
      case "--area": out.area = value; break;
      default: return { error: `unknown option ${flag}` };
    }
  }
  if (!out.repo || !out.task) return { error: "both --repo and --task are required" };
  if (!Number.isInteger(out.trials) || out.trials < 1) return { error: "--trials takes a positive integer" };
  // NaN compares false against every headroom, which is the floor switched off.
  if (!(out.minHeadroom >= 0 && out.minHeadroom <= 1)) return { error: "--min-headroom takes a number from 0 to 1" };
  const engine = engineFor(out);
  if (engine.error) return { error: engine.error };
  const { model, effort, ...rest } = out;
  return { ...rest, engine };
}
