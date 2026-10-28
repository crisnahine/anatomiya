# Plugin on against plugin off: mastodon-local-url-reuse

| setting | value |
|---|---|
| repository | github.com/mastodon/mastodon |
| commit | 3f5c32f43f57751f994919335cf7b065c53044d1 |
| area probed | app/lib |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/mastodon-local-url-reuse.json`, sha256 2efc200a4416 |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at e7246fe02ce9, with uncommitted changes |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/lib 94 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a class `LinkPolicy` in app/lib/link_policy.rb with a class method `external?(url)`. It returns false when the URL points to this server, port included, and true when it points anywhere else. A URL that cannot be parsed counts as external. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing TagManager#local_url? | 10 of 20 (0.50, 95% 0.30 to 0.70) | 0 of 20 (0.00, 95% 0.00 to 0.16) | below 0.001 |
| it reads no configured domain itself | 18 of 20 (0.90, 95% 0.70 to 0.97) | 1 of 20 (0.05, 95% 0.01 to 0.24) | below 0.001 |
| every check held | 9 of 20 (0.45, 95% 0.26 to 0.66) | 0 of 20 (0.00, 95% 0.00 to 0.16) | 0.001 |
| median cost per trial | $0.017 | $0.004 | |
| median wall time per trial | 137s | 31s | |
| median output tokens per trial | 14258 | 4111 | |
| cost of the arm | $0.35 | $0.081 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-mastodon-local-url-reuse-haiku-5-5.json`.
