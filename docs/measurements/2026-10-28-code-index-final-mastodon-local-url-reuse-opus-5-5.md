# Plugin on against plugin off: mastodon-local-url-reuse

| setting | value |
|---|---|
| repository | github.com/mastodon/mastodon |
| commit | 3f5c32f43f57751f994919335cf7b065c53044d1 |
| area probed | app/lib |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/mastodon-local-url-reuse.json`, sha256 2efc200a4416 |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at aad4f66cc6a6 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/lib 94 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a class `LinkPolicy` in app/lib/link_policy.rb with a class method `external?(url)`. It returns false when the URL points to this server, port included, and true when it points anywhere else. A URL that cannot be parsed counts as external. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing TagManager#local_url? | 10 of 10 (1.00, 95% 0.72 to 1.00) | 5 of 10 (0.50, 95% 0.24 to 0.76) | 0.033 |
| it reads no configured domain itself | 10 of 10 (1.00, 95% 0.72 to 1.00) | 5 of 10 (0.50, 95% 0.24 to 0.76) | 0.033 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 5 of 10 (0.50, 95% 0.24 to 0.76) | 0.033 |
| median cost per trial | $0.30 | $0.10 | |
| median wall time per trial | 86s | 43s | |
| median output tokens per trial | 6283 | 2056 | |
| cost of the arm | $3.01 | $1.05 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-mastodon-local-url-reuse-opus-5-5.json`.
