# The type checker and the root config

Dates: 2026-10-07 and 2026-10-08. What the type checker resolves on a repository with no root
`tsconfig.json`, whether anything readable without running it tells a root that degrades from one
that resolves, and what a degraded checker costs on a scan and on a refresh. DECISIONS B7 and B8
and the 0.14.0 section of the changelog draw on these tables.

The checker reads `ok` at 0.80 of type lookups resolved or more, and `degraded` under it.

## 1. Thirteen repositories with no root `tsconfig.json`

Measured 2026-10-07. Each repository was cloned, its dependencies were installed, and it was
scanned twice with the build of that day: once with the root
`tsconfig.base.json` left unread, which is what 0.13.4 does, and once with it read. The rate is the
share of type lookups that resolved, as the scan's record gives it in `semantic.typedResolutionRate`.

Eslint, prisma, react and Ghost are corpus clones and are measured again in sections 3 and 5. The
other nine clones were not kept and their commit ids were not recorded, so those nine rows cannot
be run again from this file.

| repository | root config | base unread | base read |
|---|---|---|---|
| nx-dotnet/nx-dotnet | base only | 89.6% ok | 97.6% ok |
| jscutlery/devkit | base only | 83.6% ok | 84.9% ok |
| nxext/nx-extensions | base only | 79.9% degraded | 84.9% ok |
| stefanoslig/angular-ngrx-nx-realworld-example-app | base only | 68.9% degraded | 91.7% ok |
| analogjs/analog | base only | 76.7% degraded | 85.5% ok |
| tomalaforge/angular-challenges | base only | 70.7% degraded | 71.1% degraded |
| eslint | base only | 59.1% degraded | 60.9% degraded |
| prisma | base only | 63.1% degraded | 65.9% degraded |
| react | neither | 60.2% degraded | |
| Ghost | neither | 54.9% degraded | |
| immich | neither | 34.2% degraded | |
| cloudflare/workers-sdk | neither | 82.9% ok | |
| formbricks | neither | `tier-failed`: the checker's child aborted after 3,370 of 4,099 files | |

Of the eight roots with a base and no `tsconfig.json`, reading the base takes three from degraded
to ok, two were ok without it, and three stay degraded. Of the five with neither file, one resolves
on the compiler's defaults.

## 2. Whether the base declares `paths`

Read 2026-10-08 for the eight base-only repositories, from each one's default branch through the
GitHub contents API (`gh api repos/<owner>/<repo>/contents/tsconfig.base.json`), with comments and
trailing commas stripped before `JSON.parse`. The rate is section 1's, with the base read.

| repository | `paths` entries in the base | rate | verdict |
|---|---|---|---|
| nx-dotnet/nx-dotnet | 10 | 97.6% | ok |
| jscutlery/devkit | 7 | 84.9% | ok |
| nxext/nx-extensions | 10 | 84.9% | ok |
| analogjs/analog | 28 | 85.5% | ok |
| stefanoslig/angular-ngrx-nx-realworld-example-app | 20 | 91.7% | ok |
| tomalaforge/angular-challenges | 23 | 71.1% | degraded |
| eslint/eslint | none | 60.9% | degraded |
| prisma/prisma | none (it extends `@repo/tsconfig/base`) | 65.9% | degraded |

Six declare `paths`: the five that resolve and one that does not. The two that declare none both
degrade. The file was read a day after the rates were measured and from the default branch, so a
base edited in between would not show here.

Not measured: a base-only root that declares no `paths` and is not a workspace, such as a
single-package repository with several build configs.

## 3. The four corpus repositories that degrade, at two commits

Measured 2026-10-08 on a copy of each corpus clone, dependencies installed: three scans with the
checker and three with it switched off at HEAD, then one scan with the checker 50 commits back on
the same `node_modules`. Times are the scan's own, in milliseconds.

| repository | HEAD | rate at HEAD | with the checker | without | 50 commits back | rate there |
|---|---|---|---|---|---|---|
| eslint | `dc1e7a84` | 60.94% `low-resolution` | 4,424, 4,154, 4,199 | 935, 1,000, 955 | `784dfbe9`, 19 days earlier | 60.94% |
| prisma | `4df1c997c` | 65.86% `low-resolution` | 14,281, 13,457, 13,470 | 2,030, 2,043, 1,993 | `82b5aaf9d`, 6 days | 65.58% |
| react | `beef6d60f` | 60.19% `no-tsconfig` | 9,245, 8,691, 8,605 | 2,467, 2,469, 2,480 | `689a4fa44`, 25 days | 60.28% |
| Ghost | `407e032dc7` | 54.94% `no-tsconfig` | 21,575, 23,101, 25,316 | 3,799, 4,993, 3,717 | `cd1110c8b5`, 15 hours | 54.74% |

The reason is the same at both commits on all four, and the largest move is 0.28 points. The
median with the checker less the median without is 3.2s on eslint, 11.4s on prisma, 6.2s on react
and 19.3s on Ghost.

## 4. Static facts, on seven corpus repositories

Read 2026-10-08 from the four that degrade and from three that read ok through a root
`tsconfig.json` (mastodon 83.5%, webpack 91.6%, typeorm 96.8%). "Checked files" are the files the
checker would read, and "TypeScript" the ones whose extension carries types, declaration files left
out.

| repository | verdict | checked files | TypeScript | share | `tsconfig.json` files below the root | root config | `paths` in it | workspace file |
|---|---|---|---|---|---|---|---|---|
| eslint | degraded | 853 | 3 | 0.4% | 4 | `tsconfig.base.json` | no | `workspaces` in `package.json` |
| prisma | degraded | 3,647 | 3,555 | 97.5% | 85 | `tsconfig.base.json` | no | `pnpm-workspace.yaml` |
| react | degraded | 2,277 | 242 | 10.6% | 16 | none | | `workspaces` in `package.json` |
| Ghost | degraded | 5,963 | 2,844 | 47.7% | 44 | none | | `pnpm-workspace.yaml` |
| mastodon | ok | 904 | 707 | 78.2% | 1 | `tsconfig.json` | yes | `workspaces` in `package.json` |
| webpack | ok | 1,502 | 6 | 0.4% | 24 | `tsconfig.json` | no | none |
| typeorm | ok | 3,347 | 3,340 | 99.8% | 4 | `tsconfig.json` | no | none |

No column separates the four from the three. The three that read ok all hold a root
`tsconfig.json`, so they are not roots of the shape sections 1 and 2 are about.

## 5. A refresh with the checker run, and with its verdict carried

Measured 2026-10-08 on the same four copies. A scan by hand, then for each timing an empty commit
and the refresh worker run in the foreground, three times with the verdict carried and three with
the checker run. Wall time and peak resident memory, median of three.

| repository | checker run | verdict carried |
|---|---|---|
| eslint | 4.4s, 808 MB | 1.2s, 160 MB |
| react | 8.9s, 1,421 MB | 2.8s, 208 MB |
| prisma | 13.9s, 2,132 MB | 2.3s, 211 MB |
| Ghost | 21.2s, 2,681 MB | 3.8s, 243 MB |

The map a refresh writes with the verdict carried differs from the one the measuring scan wrote
in one line of the overview, which gains `when measured` and the day: 1 of 30 map files on eslint,
1 of 284 on Ghost, 1 of 193 on prisma and 1 of 132 on react, with the record's `areas` equal. That run's overview printed the day alone; the scan has printed `UTC` after the day since.
