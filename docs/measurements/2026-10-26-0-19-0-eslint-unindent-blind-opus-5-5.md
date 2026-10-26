# Plugin on against plugin off: eslint-unindent-blind

| setting | value |
|---|---|
| repository | github.com/eslint/eslint |
| commit | dc1e7a8416937edefe04cf836ee202a6fc03bedd |
| area probed | tests/lib/linter |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/eslint-unindent-blind.json`, sha256 a8deaec49556 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "tests/lib/linter: 12 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a test file tests/lib/linter/report-location.js that checks `Linter#verify` reports a `no-undef` problem at the line and column where an undefined name appears in a multi-line source. Write each source as an indented template literal inside the test, and strip the indentation its lines share before passing it to the linter, so the reported line and column match the source as written. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing unIndent | 17 of 20 (0.85, 95% 0.64 to 0.95) | 1 of 20 (0.05, 95% 0.01 to 0.24) | below 0.001 |
| every check held | 17 of 20 (0.85, 95% 0.64 to 0.95) | 1 of 20 (0.05, 95% 0.01 to 0.24) | below 0.001 |
| median cost per trial | $0.50 | $0.12 | |
| median wall time per trial | 153s | 87s | |
| median output tokens per trial | 12249 | 2762 | |
| cost of the arm | $9.73 | $2.38 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-eslint-unindent-blind-opus-5-5.json`.
