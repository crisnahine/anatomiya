# A/B: github.com/microsoft/vscode at a589bb73

| setting | value |
|---|---|
| repository | github.com/microsoft/vscode |
| commit | a589bb7374a445b49cf5a7abaa1d8448d246e2e5 |
| area | src/vs/platform/agentHost/common/state/protocol |
| claim | exported names are PascalCase |
| baseline | 419 of 442, ratio 0.948 |
| headroom | 0.052 |
| model | claude-opus-5 |
| trials per arm | 10 |
| tools | Read, Write, Glob, Grep |
| max turns | 12 |

Injection: arm A answered "src/vs/platform/agentHost/common/state/protocol — 48 files", arm B answered "NONE".

| measure | with map | no map |
|---|---|---|
| trials that wrote a file | 1/10 | 3/10 |
| files scored | 1 | 3 |
| sites conforming | 0 of 2 (0.000) | 3 of 9 (0.333) |
| trials with a violating site | 1 | 3 |

## Reading this

**A null result about the task, not about the map.** The area's learned class is PascalCase
because it exports interfaces and types; the task asked for two constants and two functions,
which a TypeScript author names SCREAMING_SNAKE and camelCase whatever the map says. Neither arm
was ever going to write PascalCase exports for those, so the two ratios below measure the task's
shape, and 1 against 3 scored files carries nothing either way. The instructive part is the
harness: the picker filled the learned sentence and the scorer judged every file against the
map's class rather than its own plurality, which is what a learned row needs. The next run on
this row wants a task that asks for a type or a class.

**The arms differ: 0.000 against 0.333.** The run without the map produced the conforming form more
often than the run with it. Read it against the trial counts above rather than on its own: a
handful of files is a handful of files, and the arms have to have written comparable numbers of
them before the ratio carries anything.

Scored by exported_symbol_case's own predicate through the same reducer the scan uses, so the number above and
the number the map states are the same number. Files the dimension found no site in are not counted
in either arm, because a trial that wrote something unrelated is not evidence either way.
