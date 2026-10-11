# The largest file a scan writes, and the bound on what it reads to put back

Date: 2026-10-11. `PUT_BACK_MOST` in `plugins/anatomiya/lib/facts.mjs` is the most a scan reads whole
to put a file back if its write fails. It is 64 MiB, the bound every command reads a record to
(`RECORD_MOST`), so a scan reads whole no more than any command reads. A rule file or another tool's
file past it refuses the scan; the store's `facts.json` and `layout.json` past it are replaced without
being read and never put back, since no command reads such a record. DECISIONS A113 cites this file.

## Method

Every repository of `anatomiya-corpus` (35) and `anatomiya-corpus-langs` (25) was copied with
`cp -Rc` into a scratch directory, one at a time, and scanned with `scan --targets cursor,copilot`,
so all three directories were written. The copy was scanned twice from a fresh copy each time:
once with v0.14.0 (`eac5b08`) and once with the branch build. Every file written under
`.claude/rules`, `.claude/anatomiya`, `.cursor/rules` and `.github/instructions` was kept and
measured. `calcom/cal.diy` refuses `--targets cursor` (its `.cursor/rules` is a link) on both
builds, so it was scanned once more with `--targets copilot` to measure it.

## The largest file of each kind

| file | bytes | repository |
|---|---|---|
| `facts.json` | 10,197,729 (9.73 MiB) | microsoft/vscode |
| `layout.json` | 7,781 | TryGhost/Ghost |
| a rule file, any of the three directories | 151,986 | vercel/next.js (`.github/instructions`) |

The bound, 64 MiB, is more than six times the largest file the corpus writes. The last column of
the next table was taken with a bound of 128 MiB, ten times 9.73 MiB rounded up to a power of two,
which refused in every directory.

## Identity

All 60 repositories wrote the same files with the same bytes on both builds, with `scannedAt`,
`durationMs`, `measuredAt`, the layout file's `record` stamp, `refresh.json`'s `at` and `stamp`,
and `semantic.measuredUnder` masked. The last two are build digests.

## Peak resident memory with a 600 MB file

A 600 MB sparse file at one name, on a copy of this repository at `eac5b08` with a map written,
then a plain scan (`/usr/bin/time -l`, one run each, a loaded machine):

| file at the name | v0.14.0 | the 128 MiB cut, which refused at every name |
|---|---|---|
| none | 98 MB, writes | 95 MB, writes |
| `.claude/rules/anatomiya-overview.md` | 682 MB, replaces it | 107 MB, refuses |
| `.claude/anatomiya/facts.json` | 807 MB, replaces it | 100 MB, refuses |
| `.claude/anatomiya/layout.json` | 807 MB, replaces it | 96 MB, refuses |

## The same, with the bound at 64 MiB (the 0.15.0 train head, 195f620)

A git repository made from the head's own tree, scanned once to write a map, then a 600 MB sparse
file at one name and a plain scan under `/usr/bin/time -l`, one run each, at a load of 11 to 13:

| file at the name | exit | peak resident | what the scan says |
|---|---|---|---|
| none | 0 | 109 MB | writes |
| `.claude/rules/anatomiya-overview.md` | 1 | 116 MB | `".claude/rules/anatomiya-overview.md" is 629145600 bytes, past the 64 MiB a scan reads to put a file back, so nothing was written: move or delete it and scan again` |
| `.claude/anatomiya/facts.json` | 0 | 117 MB | `".claude/anatomiya/facts.json" was 629145600 bytes, past the 64 MiB any command reads of a record, so it was replaced without being read`, and writes |
| `.claude/anatomiya/layout.json` | 0 | 111 MB | the same line for `layout.json`, and writes |
