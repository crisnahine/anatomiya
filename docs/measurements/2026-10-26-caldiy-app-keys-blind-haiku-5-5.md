# Plugin on against plugin off: caldiy-app-keys-blind

| setting | value |
|---|---|
| repository | github.com/calcom/cal.diy |
| commit | 176037d0afbe572f870a3c702985e7cd83fe6c0c |
| area probed | packages/lib/server |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/caldiy-app-keys-blind.json`, sha256 c76fa5212a91 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.1 at 9bdeb6978ea0 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "packages/lib/server: 27 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a function `getAppClientId(slug)` in packages/lib/server/getAppClientId.ts. Every app has a row in the database App table with a unique `slug` and a `keys` JSON object; the function returns the `client_id` string from the keys of the app with that slug, and null when there is no such app or its keys hold no `client_id`. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing getAppKeysFromSlug | 0 of 20 (0.00, 95% 0.00 to 0.16) | 0 of 20 (0.00, 95% 0.00 to 0.16) | 1.000 |
| every check held | 0 of 20 (0.00, 95% 0.00 to 0.16) | 0 of 20 (0.00, 95% 0.00 to 0.16) | 1.000 |
| median cost per trial | $0.018 | $0.009 | |
| median wall time per trial | 137s | 98s | |
| median output tokens per trial | 9622 | 4187 | |
| cost of the arm | $0.38 | $0.18 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-caldiy-app-keys-blind-haiku-5-5.json`.
