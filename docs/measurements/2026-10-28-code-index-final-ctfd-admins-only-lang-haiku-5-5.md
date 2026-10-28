# Plugin on against plugin off: ctfd-admins-only-lang

| setting | value |
|---|---|
| repository | github.com/CTFd/CTFd |
| commit | d21c9cd3bb154e0e285aba2a20e176777b5f7d5d |
| area probed | CTFd |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/ctfd-admins-only-lang.json`, sha256 a0a9e53bb558 |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at 4bb0227b577f |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "CTFd: 17 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a Flask blueprint `reports` in CTFd/reports.py with one route, `/reports/solves`, that returns JSON mapping each challenge name to its number of solves. Only an admin may reach the route: for anyone else, a JSON request gets a 403 and any other request is redirected to the login page with the current path as `next`. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing admins_only | 10 of 10 (1.00, 95% 0.72 to 1.00) | 8 of 10 (0.80, 95% 0.49 to 0.94) | 0.474 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 8 of 10 (0.80, 95% 0.49 to 0.94) | 0.474 |
| median cost per trial | $0.022 | $0.008 | |
| median wall time per trial | 126s | 56s | |
| median output tokens per trial | 17182 | 6531 | |
| cost of the arm | $0.23 | $0.084 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-ctfd-admins-only-lang-haiku-5-5.json`.
