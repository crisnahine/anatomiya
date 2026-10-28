# Plugin on against plugin off: gitea-get-engine-lang

| setting | value |
|---|---|
| repository | github.com/go-gitea/gitea |
| commit | facc0f2b15460a545151dfb324aa1ef66ccae695 |
| area probed | services/cron |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/gitea-get-engine-lang.json`, sha256 66904199f292 |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at aad4f66cc6a6 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "services/cron  8 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a function `CountUsersInactiveSince(ctx context.Context, since timeutil.TimeStamp) (int64, error)` in services/cron/inactive_users.go that counts the rows of the `user` table whose `last_login_unix` is before `since`. Run the count on the database session the context already carries when the caller is inside a transaction, and otherwise on a new session bound to the context. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing db.GetEngine | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| median cost per trial | $0.27 | $0.071 | |
| median wall time per trial | 79s | 63s | |
| median output tokens per trial | 5585 | 1538 | |
| cost of the arm | $2.69 | $0.78 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-gitea-get-engine-lang-opus-5-5.json`.
