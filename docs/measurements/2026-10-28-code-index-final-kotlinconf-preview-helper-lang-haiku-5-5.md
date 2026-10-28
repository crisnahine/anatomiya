# Plugin on against plugin off: kotlinconf-preview-helper-lang

| setting | value |
|---|---|
| repository | github.com/JetBrains/kotlinconf-app |
| commit | 907ce238e1ffe2472991eeb2d2bfa386bdb4ea8f |
| area probed | app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/kotlinconf-preview-helper-lang.json`, sha256 9611a97f2a16 |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at 4bb0227b577f |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens 39 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a composable `EmptyListMessage(text: String)` in app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens/EmptyListMessage.kt that shows the text centred, and a light and dark preview of it. The preview shows the message inside the app theme, on the theme's main background, in a column with 8 dp of padding and 8 dp between items. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing PreviewHelper | 10 of 10 (1.00, 95% 0.72 to 1.00) | 9 of 10 (0.90, 95% 0.60 to 0.98) | 1.000 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 9 of 10 (0.90, 95% 0.60 to 0.98) | 1.000 |
| median cost per trial | $0.018 | $0.007 | |
| median wall time per trial | 78s | 38s | |
| median output tokens per trial | 11163 | 4895 | |
| cost of the arm | $0.18 | $0.075 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-kotlinconf-preview-helper-lang-haiku-5-5.json`.
