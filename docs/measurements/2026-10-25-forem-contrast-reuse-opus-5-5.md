# Plugin on against plugin off: forem-contrast-reuse

| setting | value |
|---|---|
| repository | github.com/forem/forem |
| commit | b5237b126cf27bd3897086e7811e33f7872ec444 |
| area probed | app/javascript |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/forem-contrast-reuse.json`, sha256 8fd5b36f329e |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/javascript  112 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a Preact component `ColorContrastWarning` in app/javascript/tags/ColorContrastWarning.jsx. It takes `textColor` and `backgroundColor` props, both six-digit hex colors such as "#1a2b3c", and renders a short warning, "These colors are hard to read together", when their contrast ratio is below 4.5:1, the WCAG AA level for normal text. It renders nothing otherwise. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing contrast helper | 20 of 20 (1.00, 95% 0.84 to 1.00) | 6 of 20 (0.30, 95% 0.15 to 0.52) | below 0.001 |
| it writes no luminance formula of its own | 20 of 20 (1.00, 95% 0.84 to 1.00) | 6 of 20 (0.30, 95% 0.15 to 0.52) | below 0.001 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 6 of 20 (0.30, 95% 0.15 to 0.52) | below 0.001 |
| median cost per trial | $0.32 | $0.17 | |
| median wall time per trial | 74s | 58s | |
| median output tokens per trial | 5065 | 3868 | |
| cost of the arm | $6.49 | $3.34 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-25-forem-contrast-reuse-opus-5-5.json`.
