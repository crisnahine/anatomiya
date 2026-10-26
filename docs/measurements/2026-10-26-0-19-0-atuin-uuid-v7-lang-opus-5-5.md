# Plugin on against plugin off: atuin-uuid-v7-lang

| setting | value |
|---|---|
| repository | github.com/atuinsh/atuin |
| commit | 854654ec1ec6d13e0eb2468a6e57b2e2044a2162 |
| area probed | crates/atuin-scripts/src |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/atuin-uuid-v7-lang.json`, sha256 ca62d5793bdf |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36, with uncommitted changes |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "crates/atuin-scripts/src  7 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a module crates/atuin-scripts/src/run.rs defining a struct `ScriptRun` with an `id: Uuid` and the `script_id: Uuid` it ran, and a constructor `ScriptRun::new(script_id: Uuid)` that gives the run a new id that sorts by creation time, a version 7 UUID. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing uuid_v7 | 20 of 20 (1.00, 95% 0.84 to 1.00) | 5 of 20 (0.25, 95% 0.11 to 0.47) | below 0.001 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 5 of 20 (0.25, 95% 0.11 to 0.47) | below 0.001 |
| median cost per trial | $0.39 | $0.11 | |
| median wall time per trial | 311s | 271s | |
| median output tokens per trial | 7363 | 2452 | |
| cost of the arm | $7.80 | $2.34 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-atuin-uuid-v7-lang-opus-5-5.json`.
