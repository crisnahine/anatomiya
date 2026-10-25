# Plugin on against plugin off: whitehall-migration-schema

| setting | value |
|---|---|
| repository | github.com/alphagov/whitehall |
| commit | 44848361bcf7f8871c716ac6e5f8f6211416a1a7 |
| area probed | db/migrate |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/whitehall-migration-schema.json`, sha256 d10ad6d7cfbc |
| built with | not recorded |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "db/migrate, 140 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a database migration that adds a nullable string column `external_reference` to the `organisations` table.
```

What the checks hold the answer to:

- db/schema.rb carries the column: the map states "a .rb file added to "db/migrate" ships with an edit to "db/schema.rb": 97 of the last 100 changes that added one, 21 authors"

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| db/schema.rb carries the column | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.10 | $0.056 | |
| median wall time per trial | not reported | not reported | |
| median output tokens per trial | 1786 | 1275 | |
| cost of the arm | $2.07 | $1.23 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-25-whitehall-migration-schema-opus-5-5.json`.
