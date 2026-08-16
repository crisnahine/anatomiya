# Per-repository variance of the nine new rows

Date: 2026-08-16. The CONTRIBUTING bar for a new dimension: per-repository ratios, at least one
repository below the 0.90 gate, and a spread of at least 0.15 between the highest and lowest.
Measured over ten corpus repositories (vscode, webpack, storybook, eslint, backstage, calcom,
mastodon, discourse, forem, brew), aggregate ratio per repository = summed conforming over summed
candidates across every area that produced a slot. The Ruby routing rows were re-measured after
the verb table landed, on the four Ruby repositories.

| key | repos with sites | spread | low | high | below 0.90 |
|---|---|---|---|---|---|
| file_naming_case | 10 | 0.118 | 0.882 | 1.000 | 3 |
| function_naming_case | 9 | 0.122 | 0.874 | 0.996 | 5 |
| exported_symbol_case | 9 | 0.160 | 0.750 | 0.910 | 8 |
| doc_comment_style | 9 | 0.913 | 0.087 | 1.000 | 8 |
| route_logging | 7 | 0.246 | 0.000 | 0.246 | 7 |
| route_network | 7 | 0.878 | 0.000 | 0.878 | 7 |
| route_env | 5 | 0.626 | 0.065 | 0.691 | 5 |
| logger_over_puts | 3 | 0.442 | 0.217 | 0.659 | 3 |
| http_through_client | 4 | 0.393 | 0.607 | 1.000 | 2 |

Every row has repositories below the gate. Seven of nine clear the 0.15 spread outright.

The two that sit under it, `file_naming_case` (0.118) and `function_naming_case` (0.122), are the
learned-class rows, and the aggregate is the wrong lens for them: the class itself is decided per
area, so a repository that names its components PascalCase and its utilities kebab-case scores
high against both learned classes at once while carrying exactly the divergence the row exists to
state. The variance these rows carry lives in which class an area learns, not in the conformance
to it; the sub-0.90 repositories (three and five of them) show the claim is still violable where
it is stated.

Before the verb table, `http_through_client` measured 0.016 of spread at ratios 0.984 to 1.000,
because a Rails model named Client turned its every `find` and `update` into a conforming site.
The closed verb list dropped its candidates from thousands to tens and opened the spread to
0.393, which is the measured record of why the verb table exists.
