# Plugin on against plugin off: atuin-uuid-v7-lang

| setting | value |
|---|---|
| repository | github.com/atuinsh/atuin |
| commit | 854654ec1ec6d13e0eb2468a6e57b2e2044a2162 |
| area probed | crates/atuin-scripts/src |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/atuin-uuid-v7-lang.json`, sha256 ca62d5793bdf |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at e7246fe02ce9, with uncommitted changes |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "crates/atuin-scripts/src 7 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a module crates/atuin-scripts/src/run.rs defining a struct `ScriptRun` with an `id: Uuid` and the `script_id: Uuid` it ran, and a constructor `ScriptRun::new(script_id: Uuid)` that gives the run a new id that sorts by creation time, a version 7 UUID. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing uuid_v7 | 10 of 10 (1.00, 95% 0.72 to 1.00) | 0 of 10 (0.00, 95% 0.00 to 0.28) | below 0.001 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 0 of 10 (0.00, 95% 0.00 to 0.28) | below 0.001 |
| median cost per trial | $0.013 | $0.004 | |
| median wall time per trial | 167s | 128s | |
| median output tokens per trial | 9457 | 2790 | |
| cost of the arm | $0.14 | $0.038 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-atuin-uuid-v7-lang-haiku-5-5.json`.
