# Plugin on against plugin off: forem-service-no-raise

| setting | value |
|---|---|
| repository | github.com/forem/forem |
| commit | b5237b126cf27bd3897086e7811e33f7872ec444 |
| area probed | app/services |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/forem-service-no-raise.json`, sha256 cb4ca7d9ca01 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/services: 167 files (area map); 304 .rb (repository map)", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a service object, `Comments::Hider`, in app/services/comments/hider.rb. Its class method `call(comment)` hides the comment the way a post's author hides one, by setting `hidden_by_commentable_user` to true. The caller needs to be able to tell whether it worked.
```

What the checks hold the answer to:

- its entry point does not raise: the map states "service entry points do not raise, directly or through a bang call like update!: 141 of 147 sites across 91 of 167 files, 59 authors"

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| its entry point does not raise | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.011 | $0.005 | |
| median wall time per trial | not reported | not reported | |
| median output tokens per trial | 7407 | 3279 | |
| cost of the arm | $0.22 | $0.11 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. The interval is the Wilson score interval at 95%. A p below 0.05 is a
difference this many trials can tell from chance. A p above it means this run cannot tell, which is
not a finding that the arms are the same. Cost and tokens are what the CLI reported for each trial,
the plugin's hooks and any subagent they started included; wall time is the harness's own clock.

Every trial's files, checks and cost are in `docs/measurements/data/2026-10-25-forem-service-no-raise-haiku-5-5.json`.
