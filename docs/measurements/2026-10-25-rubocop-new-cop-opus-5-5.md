# Plugin on against plugin off: rubocop-new-cop

| setting | value |
|---|---|
| repository | github.com/rubocop/rubocop |
| commit | f009b338048ea0ade9d6d88cf358111092c8f12c |
| area probed | lib/rubocop/cop/style |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout, over 4 runs |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/rubocop-new-cop.json`, sha256 6e90369c5f4b |
| built with | not recorded |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "lib/rubocop/cop/style — 302 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a new cop, Style/ReverseFirst, that flags `array.reverse.first` called with no argument and autocorrects it to `array.last`. Include specs for it.
```

What the checks hold the answer to:

- config/default.yml registers the cop: the map states "a .rb file added to "lib/rubocop/cop/style" ships with an edit to "config/default.yml": 100 of the last 100 changes that added one, 22 authors"
- lib/rubocop.rb requires the cop: the map states "a .rb file added to "lib/rubocop/cop/style" ships with an edit to "lib/rubocop.rb": 99 of the last 100 changes that added one, 21 authors"
- a changelog entry is added: the map states "a .rb file added to "lib/rubocop/cop/style" ships with a new .md file in "changelog": 97 of the last 100 changes that added one, 21 authors"

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 4 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| config/default.yml registers the cop | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| lib/rubocop.rb requires the cop | 0 of 20 (0.00, 95% 0.00 to 0.16) | 0 of 20 (0.00, 95% 0.00 to 0.16) | 1.000 |
| a changelog entry is added | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 0 of 20 (0.00, 95% 0.00 to 0.16) | 0 of 20 (0.00, 95% 0.00 to 0.16) | 1.000 |
| median cost per trial | $0.51 | $0.28 | |
| median wall time per trial | not reported | not reported | |
| median output tokens per trial | 10036 | 6627 | |
| cost of the arm | $8.18 | $5.93 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-25-rubocop-new-cop-opus-5-5.json`.
