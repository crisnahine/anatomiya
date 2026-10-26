# Plugin on against plugin off: kotlinconf-preview-helper-lang

| setting | value |
|---|---|
| repository | github.com/JetBrains/kotlinconf-app |
| commit | 907ce238e1ffe2472991eeb2d2bfa386bdb4ea8f |
| area probed | app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/kotlinconf-preview-helper-lang.json`, sha256 9611a97f2a16 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36, with uncommitted changes |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens — 39 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a composable `EmptyListMessage(text: String)` in app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens/EmptyListMessage.kt that shows the text centred, and a light and dark preview of it. The preview shows the message inside the app theme, on the theme's main background, in a column with 8 dp of padding and 8 dp between items. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing PreviewHelper | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.45 | $0.14 | |
| median wall time per trial | 103s | 42s | |
| median output tokens per trial | 8187 | 2608 | |
| cost of the arm | $8.77 | $2.92 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-kotlinconf-preview-helper-lang-opus-5-5.json`.
