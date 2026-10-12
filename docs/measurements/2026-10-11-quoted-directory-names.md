# Which directory names the map quotes

Measured 2026-10-11 on both corpora (35 + 25 repositories), copies scanned in scratch, base build
`eac5b08` against the branch that quotes a name.

## The candidate sets

Every name segment of every directory that holds a tracked file, 100,221 directories across the 60
repositories, each distinct (repository, segment) asked once which candidate set would quote it:

| Set: quote a name holding | distinct (repository, segment) | characters that tripped it |
|---|---|---|
| a space | 113 | space |
| a space or a quote | 113 | space (no tracked directory name holds `"`) |
| anything but letters, marks, numbers and `._/-` | 618 | `[ ]` 260, `( )` 136, space 113, `@` 88, `=` 23, `+` 21, `#` 8, `$` 7, `%` 4, `{ }` 3, `~` 2, `&` 1 |
| the same plus `@+$` | 522 | space, `[ ]`, `( )`, `=`, `#`, `%`, `{ }`, `&`, `~` |
| anything but ASCII letters, digits and `._/-` | 624 | the above plus 6 CJK and umlaut names |

The 113 names with a space read as words: babel's CLI fixtures (`dir --out-dir --watch with external
dependencies`), fastlane's `with spaces` and `Target Support Files`, jellyfin's `Test Data`,
vscode's `üm laut汉语`. The rest of the wider sets are ordinary paths: Next.js `[slug]` and
`(group)`, `@scope` packages, SvelteKit `+page`, supabase's `$ref`.

## What the maps print

The scan prints a directory name on 8,217 lines across 59 of the 60 maps (root lines, area
headings, area listings). The count missed cal.diy, whose `.claude/rules` is a link to
`agents/rules`; none of the 259 names its map prints falls in any set below. How many each set
would quote:

| Set | lines quoted | repositories |
|---|---|---|
| a space or a quote | 0 | 0 |
| letters, marks, numbers and `._/-` | 18 | 3 (prisma `@prisma`, Next.js `@modal` `@babel` `@edge-runtime`, supabase `$ref` `$slug`) |
| ASCII `._/-` | 18 | the same 3 |

None of the 113 names with a space reaches a map: each sits under a fixture tree that folds.

## Identity

Base and branch wrote the same 8,232 overview and area files (208,901 lines). With `scannedAt`,
`at`, `stamp`, `mtimeMs`, `measuredAt` and `measuredUnder` masked, every file is byte-identical in
all 60 repositories. cal.diy's 253 were compared in a run of their own, since the first run's copy
did not follow its linked `.claude/rules`.
