// scripts/ab/render.mjs
/**
 * The result documents: the file a reader quotes for a G5 or a G18 measurement.
 *
 * Every number in it is the harness's own, and the engine row is the one the
 * trials reported rather than the one the flags asked for.
 */
import { CLAUDE_DEFAULTS } from "./run.mjs";
import { readingFor } from "./read.mjs";
import { fisherExact, median } from "./checks.mjs";
import { wilsonLower, wilsonUpper } from "../../plugins/anatomiya/lib/gates.mjs";

const pValue = (p) => (p === null ? "n/a" : p < 0.001 ? "below 0.001" : p.toFixed(3));
const reported = (x, shown) => (x === null ? "not reported" : shown(x));

/** Dollars, with a third decimal under ten cents so a cheap trial does not print as $0.00. */
export const money = (x) => reported(x, (v) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`);
const spentOf = (arm, field) => arm.perTrial.map((t) => t.spent?.[field] ?? null);
const sum = (xs) => (xs.some((x) => x !== null) ? xs.reduce((s, x) => s + (x ?? 0), 0) : null);

/** The result document for one scenario: the plugin on in arm A, off in arm B. */
export function renderScenario(r, o) {
  const { scenario: s, a, b } = r;
  const row = (label, x, y) => `| ${label} | ${rate(x.passed, x.of)} | ${rate(y.passed, y.of)} | ${pValue(fisherExact(x.passed, x.of, y.passed, y.of))} |`;
  const cost = (label, field, shown) =>
    `| ${label} | ${reported(median(spentOf(a, field)), shown)} | ${reported(median(spentOf(b, field)), shown)} | |`;
  const claims = s.checks.filter((c) => c.claim).map((c) => `- ${c.name}: the map states "${c.claim}"`);
  return `# Plugin on against plugin off: ${s.name}

| setting | value |
|---|---|
| repository | ${r.label} |
| commit | ${r.sha} |
| area probed | ${s.area} |
| model | ${r.engine.model} |
| effort | ${r.engine.effort} |
| context window | ${r.engine.contextWindow ?? "not reported"} |${r.engine.asked ? `
| asked for | ${r.engine.asked}, which is not what served it |` : ""}
| trials per arm | ${o.trials}, alternating, each from a clean checkout${o.runs > 1 ? `, over ${o.runs} runs` : ""} |
| tools | ${o.tools.join(", ")} |
| max turns | ${o.maxTurns} |
| scenario | \`${o.scenarioPath}\`, sha256 ${o.scenarioSha256.slice(0, 12)} |
| built with | ${r.versions ? `claude ${r.versions.claude ?? "not reported"}, anatomiya ${r.versions.anatomiya}` : "not recorded"} |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "${r.said.a}", arm B answered "${r.said.b}".

The task, given to both arms word for word:

\`\`\`text
${s.prompt}
\`\`\`
${claims.length ? `\nWhat the checks hold the answer to:\n\n${claims.join("\n")}\n` : ""}
| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | ${a.endedEarly} of ${a.trials} | ${b.endedEarly} of ${b.trials} | |
${row("trials that did the task", { passed: a.did, of: a.trials }, { passed: b.did, of: b.trials })}
${s.checks.map((c) => row(c.name, a.checks[c.name], b.checks[c.name])).join("\n")}
${row("every check held", { passed: a.allPassed, of: a.did }, { passed: b.allPassed, of: b.did })}
${cost("median cost per trial", "costUsd", money)}
${cost("median wall time per trial", "wallMs", (x) => `${Math.round(x / 1000)}s`)}
${cost("median output tokens per trial", "outputTokens", (x) => String(Math.round(x)))}
| cost of the arm | ${money(sum(spentOf(a, "costUsd")))} | ${money(sum(spentOf(b, "costUsd")))} | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in \`${o.dataPath}\`.
`;
}

/** `k of n (rate, 95% low to high)` by the Wilson score interval, or `none of 0`. */
export function rate(k, n) {
  if (!n) return "none of 0";
  return `${k} of ${n} (${(k / n).toFixed(2)}, 95% ${wilsonLower(k, n).toFixed(2)} to ${wilsonUpper(k, n).toFixed(2)})`;
}

export function render(r, o) {
  const { target: t, a, b } = r;
  const pct = (x) => (x.candidates ? (x.conforming / x.candidates).toFixed(3) : "no sites");
  return `# A/B: ${r.label} at ${r.sha.slice(0, 8)}

| setting | value |
|---|---|
| repository | ${r.label} |
| commit | ${r.sha} |
| area | ${t.path} |
| claim | ${t.claim} |
| baseline | ${Math.round(t.ratio * t.candidates)} of ${t.candidates}, ratio ${t.ratio.toFixed(3)} |
| headroom | ${t.headroom.toFixed(3)} |
| model | ${r.engine.model} |
| effort | ${r.engine.effort} |
| context window | ${r.engine.contextWindow ?? "not reported"} |${r.engine.asked ? `
| asked for | ${r.engine.asked}, which is not what served it |` : ""}
| trials per arm | ${o.trials} |
| tools | ${CLAUDE_DEFAULTS.tools.join(", ")} |
| max turns | ${CLAUDE_DEFAULTS.maxTurns} |

Injection: arm A answered "${r.said.a}", arm B answered "${r.said.b}".

| measure | with map | no map |
|---|---|---|
| trials that wrote a file | ${a.wroteSomething}/${o.trials} | ${b.wroteSomething}/${o.trials} |
| trials cut short by the turn cap or an error | ${a.endedEarly}/${o.trials} | ${b.endedEarly}/${o.trials} |
| trials that finished and wrote nothing | ${a.wroteNothing}/${o.trials} | ${b.wroteNothing}/${o.trials} |
| files scored | ${a.filesScored} | ${b.filesScored} |
| sites conforming | ${a.conforming} of ${a.candidates} (${pct(a)}) | ${b.conforming} of ${b.candidates} (${pct(b)}) |
| trials with a violating site | ${a.trialsWithAViolation} | ${b.trialsWithAViolation} |

## Reading this

${readingFor({ a, b }, t.headroom)}

Scored by ${t.key}'s own predicate through the same reducer the scan uses, so the number above and
the number the map states are the same number. Files the dimension found no site in are not counted
in either arm, because a trial that wrote something unrelated is not evidence either way.
`;
}
