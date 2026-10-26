# Plugin on against plugin off: anatomiya-ext-lower-trap

| setting | value |
|---|---|
| repository | github.com/crisnahine/anatomiya |
| commit | c95c1b71506c3f8a0914cb17559bf0f8cab79a77 |
| area probed | scripts |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/anatomiya-ext-lower-trap.json`, sha256 8c9868380a75 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "scripts  24 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add scripts/ext-lower.mjs with this content:

```js
/** The extension of a path's file name, lowercased and without its dot, or an empty string where it has none. */
export function extLower(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}
```
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 1 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it still exports extLower | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.48 | $0.018 | |
| median wall time per trial | 122s | 14s | |
| median output tokens per trial | 9653 | 524 | |
| cost of the arm | $9.45 | $0.40 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-anatomiya-ext-lower-trap-opus-5-5.json`.
