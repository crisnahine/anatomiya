# One checker program per package `tsconfig.json`

Date: 2026-10-11. The checker builds one program from the root config (`tsconfig.json`, else
`tsconfig.base.json`, else the compiler's defaults). Four workspaces that keep their settings per
package read degraded under the 0.80 floor. This asks whether reading each package's own config
lifts them over it, and at what cost. The ruling it was held to: build it only if it lifts at least
one of prisma, react and Ghost over 0.80, with wall time at most three times the root program's and
peak memory inside the checker child's heap bound.

The build measured is commit `eac5b08`, with `typescript` 5.9.3 and Node 22.22.3. The checker child
is forked with no `execArgv`, so its heap bound is V8's default on this machine: 4,144 MB
(`heap_size_limit`, 18 GB of RAM, 11 cores).

## Method

Each repository was cloned out of `~/Documents/Projects/anatomiya-corpus` with `cp -Rc`, its
installed `node_modules` included, and measured one at a time, each mode in its own process.

- The files are what `scan` hands the checker: `collect` over the copy, kept where the language has
  the semantic tier. The rate is the share of property accesses whose receiver resolved, the
  checker's own `measureResolution`, taken over the files in an area (`discover` at the corpus
  size's floor and ceiling), which is the set a claim is counted over.
- Root: one program, `readConfig` on the root and `confinedCompilerHost`, with `allowJs` on and
  `checkJs` off, which is what `semantic-job.mjs` builds.
- Per package: every tracked `tsconfig.json` below the root names a package. Each checked file goes
  to the nearest package above it, and a file under none goes to one program built the root way.
  Each package config is read through the same reader as the root config (`readNamed`), with the
  repository root as the containment boundary for `extends`, references and every compiler read,
  so `extends: "../../tsconfig.base.json"` is followed and nothing outside the tree is. The
  programs are built one after another in one process, each dropped before the next.
- Wall time is the whole run of programs and checks. Peak memory is the process's maximum
  resident set (`/usr/bin/time -l`), and beside it the largest used heap read after a program
  finished. The one-minute load at the start of each run is given beside it: other work shared
  the machine.

## Results

| repository | package configs | root program: rate, wall, peak RSS | per package: programs, rate, wall, peak RSS | wall ratio | load |
|---|---|---|---|---|---|
| prisma | 85 | 65.9%, 17.7s, 2,110 MB | 86, 65.9%, 75.1s, 1,854 MB | 4.25x | 13.8, 13.0 |
| react | 16 | 60.2%, 6.8s, 1,340 MB | 13, 62.4%, 13.2s, 1,811 MB | 1.94x | 15.4, 13.7 |
| Ghost | 44 | 54.9%, 21.1s, 2,484 MB | 44, 63.3%, 52.7s, 2,382 MB | 2.49x | 14.2, 14.9 |
| eslint | 4 | 60.9%, 4.1s, 788 MB | 5, 60.9%, 4.6s, 1,139 MB | 1.12x | 15.6, 16.6 |

The root rates are 65.9%, 60.2%, 54.9% and 60.9%. The largest used
heap after any program was 2,329 MB (prisma, per package) and 2,769 MB (Ghost, root program), both
inside 4,144 MB, and no run ran out. A first prisma root run at a load of 39 to 70 took 63.9s of
wall time for 31s of CPU and was discarded; the figures above are the rerun.

No repository reaches the floor. The per-package config lifts the TypeScript files it governs and
cannot reach the JavaScript that holds most of the population:

| repository | JavaScript files: root, per package | TypeScript files: root, per package |
|---|---|---|
| Ghost | 3,077 files: 52.1%, 53.8% | 2,886 files: 60.9%, 82.5% |
| react | 2,017 files: 55.1%, 55.1% | 260 files: 84.1%, 95.9% |
| prisma | 91 files: 71.4%, 71.4% | 3,556 files: 65.6%, 65.6% |
| eslint | 840 files: 60.6%, 60.6% | 13 files: 99.8%, 99.8% |

In Ghost and react the files under no package config, and the JavaScript inside packages, are what
holds the rate down: react's 1,986 files under no package, its Flow packages among them, resolve
55.3%, and Ghost's 790 under no package resolve 27.7%. Ghost would clear 0.80 only if every
JavaScript file did too.

prisma does not move at all, because its gap is not configuration. Its packages import each other
by name (`@internal/contract/types`), each name links to the package's directory, and the package's
`exports` map points every subpath at `./dist/*.mjs`, which is not built in a checkout. One package
program (`packages/3-targets/6-adapters/postgres`, 38.1% resolved) reports 635 `TS2307` (cannot find
module) diagnostics, every one of the top twelve a workspace package. Per-package programs cost
prisma 4.25 times the wall time and lift its rate by 13 property accesses out of 168,910.

## Ruling

Not built. None of prisma, react and Ghost clears 0.80 (best: Ghost at 63.3%), so the first
condition fails before cost is asked, and prisma's per-package run also fails the wall-time bound.
Memory was never the limit.
