# Places given back at the area ceiling

Date: 2026-10-11. The ceiling folds the smallest areas before anything is counted, and the scan then
drops the areas that count nothing. From this build the places those areas held go back to the areas
the fold took last (`giveBack` in `plugins/anatomiya/lib/areas.mjs`), in every scan and every pin.
"Counts nothing" is read off the parse without the checker (`countsNothingIn` in `scan.mjs`): an
area holding a language the checker reads (`js`, `jsx`) is never one, nor is an area held for a
language no file of which was read. DECISIONS A111 cites these numbers, and A112 the pins.

## Method

Each of the 60 repositories in both corpora (35 in `anatomiya-corpus`, 25 in
`anatomiya-corpus-langs`) was copied with `cp -Rc`, one at a time, and handled by the build at
eac5b08 (0.14.0) and by this one, each on a fresh copy.

- Scan: `anatomiya scan --format json` from no map. Every file written under `.claude/` was compared
  with timestamps, `durationMs`, the refresh `stamp`, `mtimeMs` and the checker's `measuredUnder`
  build digest masked.
- Pin: `anatomiya pin` on a fresh copy, `baseline.json` compared byte for byte, wall time taken
  around the command. On this build's copy a scan then ran under the pin.
- On next.js and canvas-lms, in-process: a scan with no pin, then `runPin`, then a scan under the
  pin, comparing the areas each lists and the population status of every area.

Load averages were between 13 and 28 throughout, from other work on the machine.

## What reached the ceiling

Four of 60, all in the first corpus.

| repository | source files | areas before the ceiling | areas, 0.14.0 | this build | claims stated, 0.14.0 | this build | files in no area | in dropped areas |
|---|---|---|---|---|---|---|---|---|
| next.js | 21,250 | 932 | 497 | 500 | 423 | 423 | 1,034 | 73 |
| canvas-lms | 16,803 | 810 | 497 | 498 | 962 | 967 | 795 | 99 |
| vscode | 12,279 | 563 | 500 | 500 | 1,784 | 1,784 | 565 | 0 |
| openproject | 13,044 | 672 | 500 | 500 | 597 | 597 | 533 | 0 |

Claims stated is the summary's `claims.stated`, from a scan with no pin. Files in no area
(`orphaned`) and in dropped areas (`barren`) move on none of the four: every area given back came
out of a kept host.

- next.js: `examples/with-sfcc`, `examples/with-storybook` and `examples/with-supabase/app` (11
  files each) leave `examples` (1,113 to 1,080). Directives in the facts record go from 746 to 748.
- canvas-lms: `ui/features/eportfolio/react/__tests__` (11) leaves its parent. Three areas are
  dropped and only one place comes back: the other two dropped areas hold `js` files, which the
  give-back never counts as empty, so two places stay empty. Directives go from 1,267 to 1,275.
- vscode and openproject drop no area for counting nothing; their maps and pins are byte-identical.

## Pins

| repository | pin, 0.14.0 | this build | areas pinned | areas a scan under the pin lists | population status |
|---|---|---|---|---|---|
| next.js | 8.1s | 14.5s | 503 | 500 | 500 ok |
| canvas-lms | 6.5s | 20.3s | 501 | 498 | 498 ok |
| vscode | 9.4s | 14.3s | 500 (identical) | 500 | |
| openproject | 5.4s | 10.5s | 500 (identical) | 500 | |

A pin at the ceiling parses every source file once without the checker; vscode and openproject pay
the parse and give nothing back. On next.js and canvas-lms the areas a scan with no pin lists are
the areas a scan under the pin lists, in the same order, every one of them pinned and `ok`.

## Every other repository

56 repositories never reach their ceiling. Their scans write byte-identical files once masked, and
their pins are byte-identical, with no parse.

## Order of equal areas

The fold breaks a tie in size by each area's first file under the code-unit order the corpus is
sorted by. Measured on next.js with no area given back, this gives the same partition as the 0.14.0
fold, which took ties in the order the files arrived from git. A tie-break by the area's own path
moved 4 areas of 16 to 30 files out of the map, because a parent then folds before its child.
