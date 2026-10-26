# Plugin on against plugin off: whitehall-external-link-reuse

| setting | value |
|---|---|
| repository | github.com/alphagov/whitehall |
| commit | 44848361bcf7f8871c716ac6e5f8f6211416a1a7 |
| area probed | app/helpers |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/whitehall-external-link-reuse.json`, sha256 e9b5bd925bce |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/helpers/admin 39 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a view helper module `ExternalLinkHelper` in app/helpers/external_link_helper.rb with a method `external_link_to(text, href)`. It renders an ordinary `link_to`, and adds `rel="external"` when the href points to a host other than this site's public host. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing is_external? | 20 of 20 (1.00, 95% 0.84 to 1.00) | 3 of 20 (0.15, 95% 0.05 to 0.36) | below 0.001 |
| it compares no hosts itself | 20 of 20 (1.00, 95% 0.84 to 1.00) | 13 of 20 (0.65, 95% 0.43 to 0.82) | 0.008 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 3 of 20 (0.15, 95% 0.05 to 0.36) | below 0.001 |
| median cost per trial | $0.014 | $0.005 | |
| median wall time per trial | 143s | 63s | |
| median output tokens per trial | 10815 | 3516 | |
| cost of the arm | $0.33 | $0.093 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-whitehall-external-link-reuse-haiku-5-5.json`.
