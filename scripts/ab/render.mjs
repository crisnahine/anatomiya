// scripts/ab/render.mjs
/**
 * The result document: the file a reader quotes for a G5 measurement.
 *
 * Every number in it is the harness's own, and the engine row is the one the
 * trials reported rather than the one the flags asked for.
 */
import { CLAUDE_DEFAULTS } from "./run.mjs";
import { readingFor } from "./read.mjs";

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
