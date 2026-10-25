# Plugin on against plugin off: forem-js-test-location

| setting | value |
|---|---|
| repository | github.com/forem/forem |
| commit | b5237b126cf27bd3897086e7811e33f7872ec444 |
| area probed | app/javascript |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/forem-js-test-location.json`, sha256 4af1b031f56a |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/javascript: 321 .jsx (JSX), 297 .js and 33 other (651 files)", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a small module in a new directory, app/javascript/readingTime/, exporting `formatReadingTime(minutes)`: it returns "1 min read" for anything up to one minute and "N min read" otherwise, with N rounded up. Add a unit test for it.
```

What the checks hold the answer to:

- the test sits in a __tests__ directory: the map states "app/javascript: 143 of 149 test files under __tests__"

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| the test sits in a __tests__ directory | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| no test sits beside the module | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.012 | $0.004 | |
| median wall time per trial | not reported | not reported | |
| median output tokens per trial | 8424 | 2914 | |
| cost of the arm | $0.23 | $0.077 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-25-forem-js-test-location-haiku-5-5.json`.
