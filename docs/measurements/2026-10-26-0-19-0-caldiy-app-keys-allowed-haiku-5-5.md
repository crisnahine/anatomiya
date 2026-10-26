# Plugin on against plugin off: caldiy-app-keys-allowed

| setting | value |
|---|---|
| repository | github.com/calcom/cal.diy |
| commit | 176037d0afbe572f870a3c702985e7cd83fe6c0c |
| area probed | apps/web/lib |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/caldiy-app-keys-allowed.json`, sha256 059cca3b7bbc |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36, with uncommitted changes |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "apps/web/lib: 57 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a function `getAppClientId(slug)` in apps/web/lib/getAppClientId.ts. Every app has a row in the database App table with a unique `slug` and a `keys` JSON object; the function returns the `client_id` string from the keys of the app with that slug, and null when there is no such app or its keys hold no `client_id`. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 1 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing getAppKeysFromSlug | 20 of 20 (1.00, 95% 0.84 to 1.00) | 0 of 20 (0.00, 95% 0.00 to 0.16) | below 0.001 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 0 of 20 (0.00, 95% 0.00 to 0.16) | below 0.001 |
| median cost per trial | $0.029 | $0.009 | |
| median wall time per trial | 172s | 325s | |
| median output tokens per trial | 15215 | 4286 | |
| cost of the arm | $0.57 | $0.19 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-caldiy-app-keys-allowed-haiku-5-5.json`.
