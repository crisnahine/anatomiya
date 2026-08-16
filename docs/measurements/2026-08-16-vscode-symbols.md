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
| trials that wrote a file | 1/10 | 2/10 |
| files scored | 0 | 0 |
| sites conforming | 0 of 0 (no sites) | 0 of 0 (no sites) |
| trials with a violating site | 0 | 0 |

## Reading this

**Neither arm wrote a site this claim counts.** The trials wrote something, or wrote nothing,
but none of it was the construct this dimension measures, so the run says nothing about the map
either way. Pick a task whose obvious solution lands in the claim's own construct.

Scored by non_null_assertion's own predicate through the same reducer the scan uses, so the number above and
the number the map states are the same number. Files the dimension found no site in are not counted
in either arm, because a trial that wrote something unrelated is not evidence either way.
