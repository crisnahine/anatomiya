# Plugin on against plugin off: bookstack-system-role-lang

| setting | value |
|---|---|
| repository | github.com/BookStackApp/BookStack |
| commit | 045c6a98cac21ea86906674bb91d01f375460db6 |
| area probed | app/Activity/Notifications |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/bookstack-system-role-lang.json`, sha256 86c5b7f88e0f |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/Activity/Notifications: 16 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a class `AdminRecipients` in app/Activity/Notifications/AdminRecipients.php with a method `get()` that returns the users who hold the role whose `system_name` is `admin`, or an empty collection when there is no such role. Look the role up by its system name only once per request and reuse it after that. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing Role::getSystemRole | 20 of 20 (1.00, 95% 0.84 to 1.00) | 19 of 20 (0.95, 95% 0.76 to 0.99) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 19 of 20 (0.95, 95% 0.76 to 0.99) | 1.000 |
| median cost per trial | $0.010 | $0.003 | |
| median wall time per trial | 60s | 23s | |
| median output tokens per trial | 8056 | 2469 | |
| cost of the arm | $0.23 | $0.064 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-bookstack-system-role-lang-haiku-5-5.json`.
