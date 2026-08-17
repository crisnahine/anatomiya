# From zero, on 36 repositories

Date: 2026-08-17. End-to-end acceptance for the shipped command line: `scan`, `pin` and `check` run
as processes against a fresh clone that has never been scanned, and the files they leave on disk are
read back and asserted.

`node scripts/e2e-corpus.mjs <corpusDir> <scratchDir>` runs it, and `npm run e2e:corpus -- <corpusDir>
<scratchDir>` is the same thing. `--only <a,b>` runs those repositories rather than every child, and
it is an error with nothing after it rather than a silent run of all of them. The scratch directory
has to be empty and outside the corpus, either way round: the run clones into it and removes each
clone by name, so an overlap is a write into the corpus or a removal of it, and both exit 2 before
anything is made.

It is the sibling of `scripts/measure-layout.mjs` and deliberately not the same run: the
layout harness imports `scan` and calls it in process, which never touches argument parsing, exit
codes, the summary lines, the writer, the pin file or the check. Those are the surface a user meets,
and this is what exercises them.

Every child of the corpus directory that is a git repository is cloned with `git clone --local`,
which hardlinks the object store, and the clone is removed again in a `finally`, so the scratch
directory ends empty and the corpus is never written to. This tool's own repository runs last, as
the 36th.

## The flow, per repository

1. Clone what is checked out. A clone with no commit is recorded and skipped.
2. `scan <clone>`, which must exit 0. Its summary lines are parsed and every file it wrote is read
   back.
3. `scan <clone>` again. Every generated file must be byte-identical to the first run, and the
   summary must match it except for the duration (A5).
4. `pin <clone>`, which must exit 0 and leave `.claude/anatomiya/baseline.json`, then a third
   `scan`, whose baseline line must name the commit that was pinned.
5. `check <clone>` on the clean tree. Findings never set the exit code, so a non-zero exit here is
   a check that could not run, and a missing merge base is a caveat rather than a failure.
6. A branch `e2e/probe` carrying one committed file built to break a row the map actually stated,
   then `check <clone> --base <default branch>`. At least one finding has to name that file.
7. `rm -rf` the clone, in a `finally`, and again if the first attempt fails.

## The probe

The plan is read out of `.claude/anatomiya/facts.json` after the pin, which is the record the check
itself reads. The first area holding a stated `file_naming_case`, `extends_base` or `class_base`
with a learned class gets one new file in the area's own commonest extension:

- `file_naming_case` gets a filename spelling the opposite class, `ZzProbeFile.rb` in a snake_case
  directory or `zz_probe_file.ts` in a PascalCase one, with an inert one-line body.
- `extends_base` and `class_base` get a class extending `NotTheBase`, under the filename `zzprobe`,
  which is a single lowercase word and therefore votes for no naming class at all. Without that the
  finding read back would be the naming row's rather than the one the probe set out to break.

A repository that states none of the three gets a `.md` file instead and has to draw zero findings,
because markdown is not source and nothing about it is claimed.

A probe path that already exists is a failed assertion and the row ends there, unwritten. The clone
is a copy and nothing reaches the corpus either way, but a probe body written over a real file would
measure the check against a file this harness wrote rather than against the repository's own.

## What each column asserts

| column | what it is, and what fails on it |
|---|---|
| files, areas | the first two numbers of the summary's head line; a missing head line is a failure |
| stated | stated slots over every slot, off the claims line, by the renderer's own partition |
| roots | one string of three numbers, `roots/imports/reused`: root lines printed, then areas carrying a non-null `imports` and a non-null `reused`. Null is an area with no static import surface, which was never asked, so it is not folded together with an area that was asked and imports nothing. A run that never reached the record prints a dash for the last two rather than a shorter column |
| wrote | the write line's count, which is asserted to be the number of files in `.claude/rules/` |
| stable | the second scan wrote the same bytes and the same summary as the first |
| pin | `pin` exited 0, wrote the baseline, and the scan after it named the pinned sha |
| clean | findings on the clean tree, and the check exited 0 |
| probe | a finding named the probe file, and which row it broke; `n.a.` is a repository stating none of the three, which then has to draw zero findings |
| seconds | the whole flow: clone, three scans, a pin, two checks and the removal |

Alongside the table, every run asserts that `.claude/rules/anatomiya-overview.md` exists, holds
`## What lives where` or the truncation notice, and comes to at most 40 lines; that every
`anatomiya-area-*.md` carries a `paths` pattern, since a file without one loads on every turn; and
that `facts.json` is schema 11 with a `layout` at the top and `kinds` on every area.

The line bound is measured the way the tool documents it and the way `test/cli.test.mjs` already
measures it: over the body past the frontmatter, with the `paths` list exempt and the rest of the
file held to 40 lines once the extra patterns are discounted. A glob dropped to save a line
mis-delivers the whole file, so the list is delivery rather than content. 17 of the 35 hold an area
whose `paths` list alone runs past forty lines; every one of their bodies came in under the bound.

## Result

36 of 36, in 1,012 seconds. Every repository was byte-stable across two scans, pinned, and reported
zero findings on its clean tree. 33 probes broke `file_naming_case`, react's broke `extends_base`,
and errbit and this repository state none of the three rows, so both got the markdown probe and drew
the zero findings it has to draw.

This repository's own row was re-run alone, with `--only anatomiya`, after the harness grew the
directory guard and the write-line assertion: 1 of 1, and the row below is that run. It is two files
and one stated claim larger than the full run's, because the harness and its test were not yet
committed when that one went. The other 35 rows are the full run's.

## The runs

| repo | files | areas | stated | roots | wrote | stable | pin | clean | probe | seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| alphagov__whitehall | 1878 | 60 | 13/305 | 7/5/5 | 61 | yes | ok | 0 | yes file_naming_case | 12.5 |
| angular__angular | 5126 | 301 | 169/4560 | 7/301/301 | 302 | yes | ok | 0 | yes file_naming_case | 26.5 |
| appsmithorg__appsmith | 6642 | 346 | 149/5249 | 3/346/346 | 347 | yes | ok | 0 | yes file_naming_case | 26.1 |
| babel__babel | 1369 | 66 | 20/876 | 7/66/66 | 67 | yes | ok | 0 | yes file_naming_case | 17.8 |
| backstage__backstage | 7607 | 425 | 179/7871 | 7/425/425 | 426 | yes | ok | 0 | yes file_naming_case | 30.0 |
| calcom__cal.diy | 4987 | 260 | 107/4624 | 7/260/260 | 261 | yes | ok | 0 | yes file_naming_case | 17.8 |
| chef__chef | 1815 | 70 | 9/245 | 7/0/0 | 71 | yes | ok | 0 | yes file_naming_case | 21.0 |
| consul__consul | 2405 | 78 | 19/290 | 7/2/2 | 79 | yes | ok | 0 | yes file_naming_case | 11.2 |
| decidim__decidim | 7189 | 338 | 33/1548 | 7/36/36 | 339 | yes | ok | 0 | yes file_naming_case | 27.1 |
| diaspora__diaspora | 1135 | 64 | 7/299 | 7/16/16 | 65 | yes | ok | 0 | yes file_naming_case | 7.8 |
| discourse__discourse | 13965 | 447 | 128/3277 | 7/150/150 | 448 | yes | ok | 0 | yes file_naming_case | 82.7 |
| empire-flippers__api | 5518 | 156 | 42/853 | 7/0/0 | 157 | yes | ok | 0 | yes file_naming_case | 28.9 |
| empire-flippers__client | 2486 | 127 | 72/2149 | 7/127/127 | 128 | yes | ok | 0 | yes file_naming_case | 7.9 |
| errbit__errbit | 252 | 32 | 0/71 | 7/2/2 | 33 | yes | ok | 0 | n.a. | 2.4 |
| eslint__eslint | 853 | 29 | 6/261 | 7/29/29 | 30 | yes | ok | 0 | yes file_naming_case | 6.6 |
| fastlane__fastlane | 1285 | 54 | 7/219 | 7/0/0 | 55 | yes | ok | 0 | yes file_naming_case | 10.4 |
| forem__forem | 4687 | 124 | 38/847 | 7/30/30 | 125 | yes | ok | 0 | yes file_naming_case | 56.1 |
| Homebrew__brew | 1658 | 57 | 5/165 | 3/0/0 | 58 | yes | ok | 0 | yes file_naming_case | 27.9 |
| huginn__huginn | 482 | 26 | 4/141 | 7/3/3 | 27 | yes | ok | 0 | yes file_naming_case | 4.3 |
| instructure__canvas-lms | 16803 | 497 | 317/7504 | 7/353/353 | 498 | yes | ok | 0 | yes file_naming_case | 139.3 |
| mastodon__mastodon | 4176 | 129 | 81/1128 | 7/36/36 | 130 | yes | ok | 0 | yes file_naming_case | 19.2 |
| microsoft__vscode | 12215 | 500 | 923/9816 | 4/500/500 | 501 | yes | ok | 0 | yes file_naming_case | 87.7 |
| openfoodfoundation__openfoodnetwork | 2244 | 84 | 11/411 | 7/8/8 | 85 | yes | ok | 0 | yes file_naming_case | 16.4 |
| opf__openproject | 13044 | 500 | 101/2965 | 7/64/64 | 501 | yes | ok | 0 | yes file_naming_case | 75.9 |
| prisma__prisma | 3972 | 199 | 186/3303 | 7/199/199 | 200 | yes | ok | 0 | yes file_naming_case | 14.1 |
| publiclab__plots2 | 432 | 28 | 1/121 | 7/7/7 | 29 | yes | ok | 0 | yes file_naming_case | 4.3 |
| puppetlabs__puppet | 2125 | 89 | 6/314 | 7/0/0 | 90 | yes | ok | 0 | yes file_naming_case | 20.3 |
| react__react | 2277 | 122 | 38/1633 | 7/122/122 | 123 | yes | ok | 0 | yes extends_base | 15.9 |
| rubocop__rubocop | 1741 | 34 | 11/105 | 7/0/0 | 35 | yes | ok | 0 | yes file_naming_case | 11.5 |
| storybookjs__storybook | 4687 | 257 | 136/4651 | 5/257/257 | 258 | yes | ok | 0 | yes file_naming_case | 29.7 |
| supabase__supabase | 7765 | 385 | 137/7147 | 4/385/385 | 386 | yes | ok | 0 | yes file_naming_case | 38.9 |
| TryGhost__Ghost | 5963 | 283 | 127/4334 | 5/283/283 | 284 | yes | ok | 0 | yes file_naming_case | 27.2 |
| typeorm__typeorm | 3347 | 120 | 96/1229 | 7/120/120 | 121 | yes | ok | 0 | yes file_naming_case | 7.9 |
| vercel__next.js | 21368 | 500 | 97/6298 | 7/500/500 | 501 | yes | ok | 0 | yes file_naming_case | 57.3 |
| webpack__webpack | 11925 | 393 | 14/2722 | 3/393/393 | 394 | yes | ok | 0 | yes file_naming_case | 18.1 |
| anatomiya | 101 | 4 | 9/63 | 6/4/4 | 5 | yes | ok | 0 | n.a. | 3.4 |

`files` is the corpus the scan counted, which is tracked source only, so it is smaller than the
`tracked` column in the layout measurement: that one counts every tracked file the corpus filter
keeps, source or not.

## The summary lines, as printed

The third scan, the one measured against the pin. The root path is the scratch clone and is written
here as `<scratch>`.

empire-flippers__client:

```
2486 files, 127 areas, 2148ms, root <scratch>/empire-flippers__client
72 of 2149 claims stated, 67 match the model default, the rest print as counts
layout: 7 roots, 3 folded, tests: 103 cypress under cypress/integration, 7 vitest under src; roster lines: 86 areas with imports, 44 with reuse
baseline 897ee5d9, 0 files changed since origin/HEAD
206 files in no area: too few per directory
wrote 128 files
a session already running still holds the old map; restart to pick it up
```

empire-flippers__api:

```
5518 files, 156 areas, 7000ms, root <scratch>/empire-flippers__api
42 of 853 claims stated, the rest print as counts
layout: 7 roots, 2 folded, tests: 1334 rspec under spec, 2 test files; roster lines: 0 areas with imports, 0 with reuse
baseline 804aa468, 0 files changed since origin/HEAD
49 files in no area: too few per directory
wrote 157 files
a session already running still holds the old map; restart to pick it up
```

anatomiya:

```
101 files, 4 areas, 516ms, root <scratch>/anatomiya
9 of 63 claims stated, 6 match the model default, the rest print as counts
layout: 6 roots, 0 folded, tests: 41 node:test under test; roster lines: 2 areas with imports, 1 with reuse
baseline 4c8a6097, 0 files changed since origin/HEAD
1 file in no area: too few per directory
wrote 5 files
a session already running still holds the old map; restart to pick it up
```

The api's roster lines read 0 and 0 because the roster is read off static imports and that
repository is Ruby. The client's 67 slots matching the model default are stated and enforced; they
render as counts, and the harness counts them the same way the renderer partitions them.

## What failed, and what was done about it

**The removal raced git's own collector.** The first full run died on the first repository with
`ENOTEMPTY` from `rmSync` over whitehall's clone, and it took the whole run with it because the
throw came out of the `finally`. `git commit` starts a detached `gc --auto`, and on a repository
with 39,480 commits it was still writing into `.git/` while the walk was unlinking. A harness
defect, not a tool one. The clone now sets `gc.auto=0` and `maintenance.auto=false` right after it
is made, the removal retries, and a removal that still fails is recorded as a finding about this
harness rather than being allowed to abandon the other 35.

No tool defect was found. Nothing in `lib/` changed for this run.

**One assertion was written to the documented bound rather than to the literal one.** The task's
"at most 40 lines" is 40 body lines past the frontmatter, with the `paths` list exempt, which is
what `MAX_LINES` bounds and what `test/cli.test.mjs` already asserts. Reading it as 40 lines of file
would have failed 17 repositories on the one thing the writer is documented to run past, and
loosening it to the file length would have stopped measuring the body at all.

## What this does not cover

- `--deep`. The type checker needs the repository's own dependencies installed, and a clone has
  none of them.
- A repository with no commits, a detached HEAD, or a shallow clone. All 35 corpus repositories sit
  on a branch with full history, so the skip path and the shallow-clone caveat are covered by unit
  tests and not by this run.
- The findings themselves beyond the one the probe plants. This run asserts that a stated row fires
  on a file built to break it and that a clean tree fires nothing; what every other row does on a
  real branch is what `check`'s own tests measure.
