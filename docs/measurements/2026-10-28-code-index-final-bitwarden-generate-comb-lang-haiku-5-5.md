# Plugin on against plugin off: bitwarden-generate-comb-lang

| setting | value |
|---|---|
| repository | github.com/bitwarden/server |
| commit | 8fb62cff78af0b5fa6c7bc3b02abe7c8e9d881e3 |
| area probed | src/Core/Models/Data |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 10, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/bitwarden-generate-comb-lang.json`, sha256 4a01ede95cba |
| built with | claude 2.1.312 (Claude Code), anatomiya 0.19.0 at 4bb0227b577f |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "src/Core/Models/Data: 11 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a record `ImportBatch` in src/Core/Models/Data/ImportBatch.cs with `Guid Id`, `Guid UserId` and `DateTime CreationDate`, and a static method `Create(Guid userId)` that sets `CreationDate` to the current UTC time and `Id` to a new database id. Database ids must sort roughly in creation order on SQL Server, so the id carries the current UTC date and time in its last six bytes, in the byte order SQL Server compares, to keep inserts from fragmenting the index. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 10 | 0 of 10 | |
| trials that did the task | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| it calls the existing CoreHelpers.GenerateComb or the CombGuid.Generate it delegates to | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| every check held | 10 of 10 (1.00, 95% 0.72 to 1.00) | 10 of 10 (1.00, 95% 0.72 to 1.00) | 1.000 |
| median cost per trial | $0.018 | $0.008 | |
| median wall time per trial | 87s | 51s | |
| median output tokens per trial | 11882 | 5288 | |
| cost of the arm | $0.17 | $0.081 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `data/2026-10-28-code-index-final-bitwarden-generate-comb-lang-haiku-5-5.json`.
