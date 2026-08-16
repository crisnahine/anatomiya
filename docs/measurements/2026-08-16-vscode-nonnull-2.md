# A/B: github.com/microsoft/vscode at a589bb73

| setting | value |
|---|---|
| repository | github.com/microsoft/vscode |
| commit | a589bb7374a445b49cf5a7abaa1d8448d246e2e5 |
| area | src/vs/workbench/contrib/chat/browser |
| claim | possibly-absent values are read with ?., not asserted with ! |
| baseline | 736 of 797, ratio 0.923 |
| headroom | 0.077 |
| model | claude-opus-5 |
| trials per arm | 10 |
| tools | Read, Write, Glob, Grep |
| max turns | 12 |

Injection: arm A answered "src/vs/workbench/contrib/chat/browser — 102 files", arm B answered "NONE".

| measure | with map | no map |
|---|---|---|
| trials that wrote a file | 4/10 | 1/10 |
| files scored | 4 | 1 |
| sites conforming | 9 of 11 (0.818) | 0 of 2 (0.000) |
| trials with a violating site | 1 | 1 |

## Reading this

**The arms differ: 0.818 against 0.000.** The run with the map produced the conforming form more
often than the run without it. Read it against the trial counts above rather than on its own: a
handful of files is a handful of files, and the arms have to have written comparable numbers of
them before the ratio carries anything.

Scored by non_null_assertion's own predicate through the same reducer the scan uses, so the number above and
the number the map states are the same number. Files the dimension found no site in are not counted
in either arm, because a trial that wrote something unrelated is not evidence either way.
