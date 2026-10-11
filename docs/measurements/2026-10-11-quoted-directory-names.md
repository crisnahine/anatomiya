# Which directory names the map quotes

Measured 2026-10-11 on both corpora (35 + 25 repositories), copies scanned in scratch, base build
`eac5b08` against the branch that quotes a name.

## The candidate sets

Every directory that holds a tracked file, 100,221 of them across the 60 repositories, asked which
name segment each candidate set would quote:

| Set: quote a name holding | distinct (repository, segment) | characters that tripped it |
|---|---|---|
| a space | 102 | space |
| a space or a quote | 102 | space (no tracked directory name holds `"`) |
| anything but letters, marks, numbers and `._/-` | 459 | space, `[ ]` 219, `@` 76, `( )` 74, `+` 27, `=` 22, `#` 9, `%` 6, `{ }` 4, `$` 3, `&`, `~` |
| the same plus `@+$` | 408 | space, `[ ]`, `( )`, `=`, `#`, `%`, `{ }`, `&`, `~` |
| anything but ASCII letters, digits and `._/-` | 465 | the above plus the CJK and umlaut names |

The 102 names with a space read as words: babel's CLI fixtures (`dir --out-dir --watch with external
dependencies`), fastlane's `with spaces` and `Target Support Files`, jellyfin's `Test Data`,
vscode's `üm laut汉语`. The rest of the wider sets are ordinary paths: Next.js `[slug]` and
`(group)`, `@scope` packages, SvelteKit `+page`, supabase's `$ref`.

## What the maps print

The scan prints a directory name on 8,217 lines across the 60 maps (root lines, area headings,
area listings). How many each set would quote:

| Set | lines quoted | repositories |
|---|---|---|
| a space or a quote | 0 | 0 |
| letters, marks, numbers and `._/-` | 18 | 3 (prisma `@prisma`, Next.js `@modal` `@babel` `@edge-runtime`, supabase `$ref` `$slug`) |
| ASCII `._/-` | 18 | the same 3 |

None of the 102 names with a space reaches a map: each sits under a fixture tree that folds.

## Identity

Base and branch wrote 8,231 files each (7,979 rule files, 200,276 lines). With `scannedAt`, `at`,
`stamp`, `mtimeMs`, `measuredAt` and `measuredUnder` masked, every file is byte-identical in all 60
repositories.
