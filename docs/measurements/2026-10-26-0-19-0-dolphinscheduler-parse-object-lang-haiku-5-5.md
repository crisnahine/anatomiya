# Plugin on against plugin off: dolphinscheduler-parse-object-lang

| setting | value |
|---|---|
| repository | github.com/apache/dolphinscheduler |
| commit | 89817f16f69b30ae3a12631f4f96653e1d3c96ce |
| area probed | dolphinscheduler-api/src/main/java/org/apache/dolphinscheduler/api/dto |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/dolphinscheduler-parse-object-lang.json`, sha256 84e82b3eb8c6 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "dolphinscheduler-api/src/main/java/org/apache/dolphinscheduler/api/dto 27 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a class `ScheduleParamReader` in dolphinscheduler-api/src/main/java/org/apache/dolphinscheduler/api/dto/ScheduleParamReader.java with a static method `read(String json)` that turns a schedule's JSON text into a `ScheduleParam`. It returns null for null or empty text, ignores properties the class does not have, and throws an `IllegalArgumentException` naming the text and the target class when the text does not parse. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 1 of 20 | 6 of 20 | |
| trials that did the task | 19 of 20 (0.95, 95% 0.76 to 0.99) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing JSONUtils.parseObject | 19 of 19 (1.00, 95% 0.83 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 19 of 19 (1.00, 95% 0.83 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| median cost per trial | $0.013 | $0.005 | |
| median wall time per trial | 65s | 526s | |
| median output tokens per trial | 8968 | 2888 | |
| cost of the arm | $0.26 | $0.075 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-dolphinscheduler-parse-object-lang-haiku-5-5.json`.
