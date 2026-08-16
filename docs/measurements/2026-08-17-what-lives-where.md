# What lives where, on 35 repositories

Date: 2026-08-17. Corpus acceptance for the `## What lives where` section of the overview, and
for the two sibling roster lines and the five learned rows that print beside it.

`scripts/measure-layout.mjs <corpusDir>` runs it. For every child of the corpus directory that is
a git repository it scans twice in this process, renders the overview twice, and writes nothing
into the repository. The `files` argument the overview is handed is the one `writeMap` builds: the
uncovered split, and the audit of whatever is already sitting in `.claude/rules/`, so cal.diy's 44
hand-written rule files cost the section the same budget they cost in a real scan.

Then every number the section prints is recounted by the script from its own `git ls-files` pass,
filtered the way the corpus filters, plus the facets of its own parse. The classification
predicates are imported from `layout.mjs` rather than copied, because a test file is a test file by
one definition and a second one here would measure the disagreement rather than the counts. What
the recount owns is the summation, the root subsets and the reading back of the printed line, which
is where a wrong number comes from.

Per repository the script asserts:

1. neither scan throws, and the overview is at most 40 lines;
2. the two overviews are byte-identical;
3. the section is there, with at least one root line or the truncation notice;
4. every root path exists on disk;
5. every printed count equals the recount, clause by clause: the extension counts and the `other`
   remainder, the runner groups and the sub-directory each names, the namesake pair and its root,
   the sibling-module and inline-helper counts, the fold line, and each group of the tests line.
   The root lines and the fold together have to account for every tracked file.

## Result

35 of 35, after the seven tuning changes below. The first run cleared 1 to 4 mechanically on 34 of
them and read wrong on most.

Re-run after the whole-branch review's two roster fixes, which is the run recorded here: 35 of 35
again, no number in the table moved, and eleven root lines on nine repositories dropped a
sibling-module count by 1 to 10.

One byte-stability failure, on appsmith, in the first of seven full runs: `## Not covered` moved
between the two scans. It did not reproduce in six later full runs or in four solo runs of that
repository. The parse pool kills a worker batch at 5 s of wall clock, so under the load of a
35-repository run a batch can be charged as crashed and the count of unexamined files moves with
it. Not a layout finding: it is the one wall-clock guard left in the tool, and `limits.mjs`
already records that a size cap is deterministic and a timeout is not. Worth its own issue.

## The runs

`tracked` is the layout corpus, every tracked file the corpus filters keep, source or not.
`roots` and `folded` are what the section printed and what its fold line reported. The five
learned rows count slots stated across every area of the repository, by the renderer's own
partition, so a row the model writes by default is not counted as stated. `imports` and `reused`
are how many areas printed each roster line.

| repo | tracked | roots | folded | testGroups | principles | extends_base | class_base | module_include | interface_prefix | type_alias_prefix | imports | reused | seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Homebrew__brew | 2501 | 3 | 0 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13.4 |
| TryGhost__Ghost | 7940 | 5 | 0 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 142 | 87 | 13.5 |
| alphagov__whitehall | 2621 | 7 | 8 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 7.6 |
| angular__angular | 8522 | 7 | 11 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 93 | 103 | 12.9 |
| appsmithorg__appsmith | 13087 | 3 | 0 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 126 | 128 | 13.9 |
| babel__babel | 2303 | 7 | 10 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 26 | 16 | 4.9 |
| backstage__backstage | 11781 | 7 | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 186 | 99 | 14.7 |
| calcom__cal.diy | 7372 | 7 | 4 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 122 | 60 | 9.1 |
| chef__chef | 2281 | 7 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11.1 |
| consul__consul | 6025 | 7 | 2 | 1 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 7.0 |
| decidim__decidim | 11467 | 7 | 18 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 4 | 5 | 19.1 |
| diaspora__diaspora | 1921 | 7 | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4.6 |
| discourse__discourse | 23263 | 7 | 5 | 6 | 1 | 1 | 3 | 1 | 0 | 0 | 75 | 12 | 62.2 |
| empire-flippers__api | 8986 | 7 | 2 | 2 | 1 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 18.3 |
| empire-flippers__client | 2999 | 7 | 3 | 2 | 2 | 0 | 0 | 0 | 6 | 0 | 86 | 44 | 4.7 |
| errbit__errbit | 529 | 7 | 7 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.1 |
| eslint__eslint | 1533 | 7 | 10 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 7 | 4.2 |
| fastlane__fastlane | 2136 | 7 | 7 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 6.9 |
| forem__forem | 6425 | 7 | 6 | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 14 | 7 | 14.4 |
| huginn__huginn | 729 | 7 | 9 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2.6 |
| instructure__canvas-lms | 21913 | 7 | 8 | 4 | 2 | 0 | 1 | 0 | 0 | 0 | 148 | 129 | 98.9 |
| mastodon__mastodon | 9846 | 7 | 5 | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 20 | 23 | 11.0 |
| microsoft__vscode | 15712 | 4 | 0 | 6 | 2 | 0 | 0 | 0 | 14 | 0 | 164 | 90 | 56.1 |
| openfoodfoundation__openfoodnetwork | 3882 | 7 | 7 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 9.8 |
| opf__openproject | 22498 | 7 | 8 | 3 | 1 | 0 | 1 | 0 | 0 | 0 | 22 | 7 | 45.9 |
| prisma__prisma | 6154 | 7 | 7 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 115 | 76 | 9.1 |
| publiclab__plots2 | 860 | 7 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2.4 |
| puppetlabs__puppet | 2466 | 7 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15.6 |
| react__react | 2969 | 7 | 18 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 16 | 34 | 8.9 |
| rubocop__rubocop | 2155 | 7 | 2 | 2 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 8.4 |
| storybookjs__storybook | 7597 | 5 | 0 | 7 | 2 | 0 | 0 | 0 | 0 | 0 | 75 | 77 | 11.6 |
| supabase__supabase | 16751 | 4 | 0 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 198 | 157 | 15.0 |
| typeorm__typeorm | 3542 | 7 | 0 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 8 | 25 | 4.6 |
| vercel__next.js | 28490 | 7 | 2 | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 28 | 58 | 30.0 |
| webpack__webpack | 14364 | 3 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 15 | 18 | 8.9 |

## Tuning, and why

Seven changes out of the corpus runs, then two more out of the whole-branch review after them.
Each has a test that fails before it and passes after. The three numbers the design left open are
unchanged, and so is the shell list: the floor is still
`max(3, ceil(0.01 * N))`, the wrapper share is still 0.8, the budget is still 7 root lines, and
the five shell names are the same five words.

### 1. The tests line names where most of a runner's files are

Was: the shortest directory prefix every one of that runner's files shares. Now: the deepest
directory holding at least the wrapper share of them, and no directory at all when that turns out
to be the repository root.

28 of the 35 repositories printed at least one `under .`, because one file outside the tree the
rest sit in collapses a strict prefix to nothing. angular read `1448 test files under .` and the
client read `106 Cypress specs under .`, which is the clause failing at the only job it has.

No new number. The bar is `WRAPPER_SHARE`, which is already measured and is the same question the
roots ask: a child holding four fifths of a directory stands in for it.

### 2. A test root is counted by runner, not by everything sitting in it

Was: `<root>: <every file under it> <top runner> specs`. Now: up to two runner groups and the
rest as `and k other`, the shape the extension clause already has.

whitehall's `test/` holds 766 files of which 538 are minitest specs, so the root line said 766 and
the tests line four lines below it said 538. The same disagreement on chef (1122 against 696),
empire-flippers/api (1469 against 1334), typeorm (2757 against 2080), webpack (12645 against
10667) and eleven more. One directory, one always-loaded section, two numbers.

### 3. A descent that names nothing keeps the directory

webpack's `lib` is 652 files: 117 at that level and the rest spread over children, none of them
clearing the 144-file floor. The shell rule descended into it, nothing below it earned a line, and
webpack's whole source disappeared from a map that named `test` and `examples`. supabase lost its
`packages` the same way, 880 files.

Now a directory that is descended into and produces no root gets its own line. It costs nothing
where descent worked, and it bought: webpack `lib` (651 .js, 8 of them with a namesake test),
supabase `packages/ui-patterns/src` and `packages/ui`, backstage `packages/core-app-api/src`,
canvas-lms `lib` (463 of 808 with a namesake test under spec/lib), mastodon `app/lib` (119 of
167), empire-flippers/api `app/mcp/mcp` (41 of 93), eslint `lib/languages/js`.

### 4. A directory named after tests does not make its files tests

Was: a file under a `test`, `tests`, `spec`, `cypress` or `e2e` segment was a test file whatever
was in it. Now the three signals are the facets (`testRunner` or `testCalls`), a test-shaped
basename (`.test.`, `.spec.`, `.cy.`, `_spec.rb`, `_test.rb`), and a `__tests__` directory.
`runnerOf` keeps its cypress-by-directory rule, for files that are tests.

A repository keeps its factories, fixtures, page objects and support code in the same tree as its
specs, so the directory fallback charged all of it to the runner and the roster's own denominator
went wrong: `136 test files under spec/factories` on empire-flippers/api, `spec/support: 22 test
files` on rubocop, `20 test files` on Homebrew where 5 exist, 1,979 fixture modules under
webpack's `test/cases`, 337 parser inputs under babel's `packages/*/test`. `__tests__` stays
because nothing but a test is ever put in one.

It also moves the namesake denominators the other way, which is the same correction seen from the
other side: chef's `lib/chef` reads 499 of 797 where it read 494 of 792, canvas-lms `lib` 463 of
808, empire-flippers/api `app/services` 1046 of 1575.

### 5. `def test_*` needs the class or the file to agree

Was: a method named `test_*` inside any class made the file minitest. Now it counts only when the
class inherits a minitest base, or the file is `_test.rb` or sits under a `test` directory.

`def test_connection` is ordinary Ruby: a service exposes one, a client pings with one. It printed
`app/services: 6 minitest specs` on empire-flippers/api and `lib (files at this level): 3 minitest
specs` on discourse, in directories holding no test at all. `rubyFacets` takes the path as a second
argument for it, from the record `ruby.mjs` already has.

### 6. `qunit`, and the hyphen

`lib/facets.mjs` gains `qunit` in `TEST_RUNNER_MODULES`, the closed table that grows exactly this
way. `lib/layout.mjs` accepts `-test.` and `-spec.` in the basename rule beside the dotted forms.

Both are discourse, which writes its Ember tests as `login-test.js` importing `test` from `qunit`
and calling it inside an `acceptance(...)` block, so nothing at the top level and nothing in the
name reached it. Change 4 had taken its whole JavaScript side to zero. It now reads `456 qunit
specs` on `frontend/discourse` and `217 qunit specs` on `plugins`, and the runner is named where
the old directory rule could only say `test files`.

### 7. A file in a test tree that mirrors a source file is that file's test

New in `lib/layout.mjs`: `mirroredTests(files)` returns the files under a top-level `test`, `tests`
or `spec` directory whose path, with that directory stripped, tail-matches a source path outside
it. `isTestFile` takes the set as a second argument, `layoutFacts` builds it once over the corpus
and `roster` builds it once for the area kinds, so the pure signature stays testable from a
literal array.

eslint is the whole reason. Its rule tests are `tests/lib/rules/no-var.js`, named exactly like the
`lib/rules/no-var.js` they cover, driving `RuleTester` with no runner import, no top-level
`describe` and no suffix. Nothing in the file says what it is; the tree does, and it says it in the
shape `companions.mjs` already reads, one directory down and in reverse. `lib/rules` reads `301 of
305 have a namesake test under tests/lib/rules` where change 4 alone had left it at 9 of 305.

A single segment left after stripping is refused: it would be a bare basename matching whatever
happens to share it, which is the reason `siblings.mjs` refuses one.

### 8. A file the parse never reached is no sibling module

`helperFacet` read a missing `jsx` facet as "not a component", so every file the parse never got to
counted as a sibling module beside the JSX. It now requires facets to be there at all.

Eleven root lines on nine repositories moved, every one of them a sibling-module count and every
one downward: Ghost's `koenig` 326 to 325, vscode's `extensions` 2648 to 2644, next.js's
`turbopack/crates` 2097 to 2087 and two more of its roots, canvas-lms's `ui` 2419 to 2417,
supabase's `apps` 2252 to 2250, react, appsmith, storybook and webpack one each. Nothing else in
any section moved and no number in the table above changed.

### 9. A namesake root of `.` names nowhere

`namesakeCompanions` answered `"."` where the votes named the repository root, which the renderer
then printed as `under .`. It answers null now and the clause is dropped, the same as the tests
line already does. The one root that really is the repository root, a flat repository's, prints as
`(repository root)` rather than as a full stop.

Neither case occurs in this corpus: no repository here is one flat directory, and none printed a
namesake `under .`. The corpus is the evidence that the fix costs nothing, not the reason for it.

## What still reads wrong, and why it was left

**A test directory that is mostly fixtures is a source root, and its namesake clause is true and
noisy.** webpack's `test/` is 12,645 files of which 2,607 are tests, so it no longer clears the
half that makes a test root and prints `10418 .js, 814 .css and 1413 other; 2607 test files; 1 of
7858 have a namesake test under test`. The first two clauses are the most accurate the section has
ever been about that directory. The third is a true count of a question nobody asked: those 7,858
are the inputs the 2,607 tests run on, and a namesake test for a fixture is not a thing. Same
shape on typeorm's `test/` and next.js's. Suppressing it needs a rule for "this root is a test
tree even though under half of it parses as a test", which is a fourth definition of a test
directory and worth measuring on its own rather than bolting on here.

**Three signals now, and a repository can still spell a test in a fourth way.** The name, the
runner import or a top-level call, the `__tests__` directory, and the mirror cover the 35. They are
a closed set, and a repository whose tests are named for neither the runner nor the file they
cover, sitting in a directory named for neither, would go uncounted. That is the trade the
directory rule was making the other way round, and the harness is what would find the next case.

**The namesake clause reads zero above a source-and-spec split.** discourse prints
`plugins: ... 1675 RSpec specs; 217 qunit specs; ... 0 of 2655 have a namesake test`, openproject
the same shape on `modules` at 0 of 2623, vscode `src/vs: 1670 test files; 5 of 6555`, canvas-lms
`ui: 3235 test files under __tests__; 0 of 2361`, and decidim's seven engines read 6 of 1219 and
lower. The namesake match is
on the path tail, so `modules/budgets/app/models/budget.rb` is answered only by a test whose
directory ends in `budgets/app/models`, and the test that exists sits in `budgets/spec/models`.
Every rule that would count it is a guess about how a repository spells its test tree, and the
loosest of them, matching on the basename alone, is what the tail rule was chosen over. The count
beside it on the same line already says the tests are there. Worth its own issue with this
harness to judge a candidate rule against.

**The tests-line directory is a majority, not a set.** eslint prints `359 test files under
tests/lib/rules` where 301 of them are, rubocop `764 RSpec specs under spec/rubocop/cop` where 680
are, appsmith `835 Cypress specs under app/client/cypress/e2e/Regression/ClientSide`. At the 0.8
bar one file in five may sit somewhere else. The alternative, saying nothing, reads worse.

**The helper facet's three stems are build config in a monorepo root.** Ghost prints `1014
sibling modules named index/eslint.config/vite.config`, react `242 sibling modules named
index/tsup.config/types.d`, next.js `757 sibling modules named next.config/index/postcss.config`.
The count is right and the names are not what a reader should copy. No rule separates
`vite.config.ts` from `user.service.ts` without a vocabulary of kinds, and this tool ships none.

**A fixture directory can take a root line.** react spends two of its seven on
`packages/react-devtools-shared/src/hooks/__tests__/__source__/__compiled__` and
`packages/react-dom/src/__tests__`. They are two of its largest directories by source count and
the sort has no notion of a fixture.

**One match can name a namesake root.** angular prints `1 of 498 have a namesake test under
packages/core/schematics/migrations/signal-migration/test/golden-test`. The root is a vote and a
single match wins it outright.

**Files with no extension group under `(none)`.** chef reads `chef-utils: 37 .rb, 4 (none) and 2
other`. A Rakefile and a Gemfile are counted and named by the only thing they share.

## The five learned rows, and the applicability audit

`npm run audit:applicability` takes facts records rather than a corpus directory, so the run wrote
one per repository under its own scratch directory and audited those. 54 dimensions over 35
repositories, 9 worth opening.

| key | precision | areas | median | min | max | flagged |
|---|---|---|---|---|---|---|
| extends_base | precise | 1176 | 0.173 | 0.002 | 1.000 | narrow and precise |
| type_alias_prefix | precise | 2562 | 0.190 | 0.004 | 1.000 | narrow and precise |
| interface_prefix | precise | 2508 | 0.222 | 0.002 | 1.000 | narrow and precise |
| module_include | precise | 717 | 0.229 | 0.007 | 1.000 | narrow and precise |
| class_base | precise | 1071 | 0.848 | 0.001 | 1.000 | |

Four of the five are flagged narrow, and all four name a construct that is simply rare among the
files of its language: most TypeScript files declare no interface and no type alias, and most
classes extend nothing. `class_base` sits at 0.848 because it is only asked of files that hold a
class at all. The audit ranks rows to open rather than deciding anything, and none of these four
is a predicate reaching for the wrong files.

What the corpus states is thin: `class_base` on 7 areas of empire-flippers/api, 3 of discourse, 2
each of whitehall and consul; `interface_prefix` on 14 areas of vscode and 6 of the client;
`extends_base` on one area each of five repositories; `module_include` on one area each of
discourse and fastlane. Nothing states `type_alias_prefix` anywhere, and that is the row working
rather than the row broken: a `T` prefix on a type alias is rare, `none` is the model default for
the row, and a repository that prefixes nothing prints counts instead of a sentence nobody needs.

`module_include` deserves an issue. On empire-flippers/api every worker includes `Sidekiq::Worker`
and one more module, and the row counts include sites rather than classes, so the second include
in each class is a site the learned base can never answer. `app/workers/workers` scores 125 of 234,
which is 0.534, and `app/workers/cronjobs` 70 of 140, which is exactly one half. Two includes per
class pin the row there whatever the repository does, and a third would push it lower; either way
it sits far under the 0.90 gate and the ratio gate suppresses it everywhere. The counts line still
prints, which is what makes the threshold auditable, and this is the audit finding it.

`class_base` = `ApplicationController` for `app/controllers` is a question the api does not have
the shape to be asked. There is no `app/controllers` area in the partition: discovery found
`app/controllers/api/v1`, 65 files, and `app/controllers/api/v1/admin`, 36. Nor is
`ApplicationController` the base either of them uses. The row is learned from what the classes
actually inherit, and that is `Api::V1::BaseController` under `api/v1` and
`Api::V1::Admin::BaseController` under `api/v1/admin`, which is the row working: a learned base is
the repository's, not a framework's default.

Neither is stated, and two different gates stop them. `api/v1` scores 55 of 65, a point ratio of
0.846, which is under `minRatio` and fails on the ratio alone before any interval is computed: ten
of its controllers inherit something else. `api/v1/admin` scores 33 of 36, a point ratio of 0.917
that clears `minRatio` and whose Wilson lower bound does not, so the evidence gate takes it. Both
print as counts, which is what the suppressed side is for. `class_base` is stated on 7 areas of
this repository, `app/models` at `ApplicationRecord` 124 of 130 and `app/services/api/v1` at
`ActiveInteraction::Base` 79 of 79 among them.

## The PR 4096 probe

Read-only on the corpus copy of empire-flippers/client, at the commit it is checked out at. No
branch, no patch: the corpus repositories are read-only for this harness, so the brief's
branch-apply-check step was not run, and what the spec's acceptance asks for, the overview section
carrying the Cypress-against-vitest denominator and the `src/components` helper facet, is met by
the section quoted below.

The overview section:

```
## What lives where

- src/pages: 1003 .tsx (JSX), 188 .ts and 71 other; 2 vitest specs under __tests__; 0 of 1003 have a namesake test; 186 sibling modules named types/schema/mapper; 214 files inline a helper
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 have a namesake test under cypress/integration/components; 66 sibling modules named index/schema/types; 117 files inline a helper
- src/queries: 314 .ts, 1 .tsx; 0 of 314 have a namesake test
- cypress/integration: 102 Cypress specs
- src/hooks: 47 .tsx (JSX), 23 .ts; 0 of 47 have a namesake test; 23 sibling modules named mapper/payoutContext/schema; 6 files inline a helper
- src/utils: 53 .ts, 10 .js and 4 other; 3 vitest specs under __tests__; 4 of 52 have a namesake test under src/utils/__tests__; 60 sibling modules named assert/balanceTransaction/buyerProfileValidation; 0 files inline a helper
- src/layouts: 42 .tsx (JSX), 11 .jpg and 21 other; 0 of 42 have a namesake test; 6 sibling modules named constants/utils/hooks; 4 files inline a helper
- and 3 more directories holding 434 files
- tests: 103 Cypress specs under cypress/integration; 7 vitest under src; 0 of 1003 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

The `src/components` area file, rendered from the same scan:

```
---
generator: anatomiya
paths:
  - "src/components/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/Admin/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/BuyNowPopup/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/Calendar/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/Submenu/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/TaskList/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/TicketSidebar/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/UniversalOnboarding/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/UnlockPopup/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/base/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/buttons/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/forms/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/offers/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
  - "!src/components/popups/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
---

# src/components  148 files

module-level functions are assigned as arrow consts, not declared with function
  162 of 162 sites across 115 of 148 files, 11 authors

imports used only as types are imported without the type marker
  146 of 150 sites across 99 of 148 files, 11 authors  (partial: some sites are not visible statically)
  except "src/components/DougnutChart.tsx"
  except "src/components/HorizontalBarChart.tsx"
  except "src/components/LineChart.tsx"
  and 1 more

relative imports are written without the file extension
  91 of 91 sites across 57 of 148 files, 11 authors

possibly-absent values are read with ?., not asserted with !
  137 of 137 sites across 46 of 148 files, 11 authors  (partial: some sites are not visible statically)

and 25 more not shown here, 3 of them stated
```

The denominator and the helper facet reach the agent, and they reach it through the overview
rather than through the area file. The overview is the file that loads before any Read or Write,
and its `src/components` line carries both halves of the review that started this: 2 vitest specs
against 102 Cypress specs under `cypress/integration` on the tests line, and 66 sibling modules
beside 117 files that inline a helper, with the granularity sentence under them. The area file
carries neither: 14 delivery globs and four stated directives fill its 40 lines, and the `kinds`
line and both roster lines are dropped, which is the drop order working as designed. The counts
are measured either way. `most files here import: styled-components (69%)` is 98 of the 142
importing files, and `most imported from here` would have led with `Warning` at 36 importers.
`interface_prefix` is not stated on `src/components`: 156 of 167 interfaces carry the `I`, whose
Wilson lower bound is under the 0.90 gate, so it prints as a count. It is stated on
`src/components/base` at 91 of 92, and on five more of the client's areas.

## anatomiya itself

```
## What lives where

- test: 39 node:test specs and 4 other
- lib: 41 .mjs, 1 .json; 29 of 41 have a namesake test under test
- scripts: 12 .mjs; 3 of 12 have a namesake test under test
- docs: 14 .md
- .github: 5 .yml, 3 .md
- commands: 3 .md
- and 17 more files in directories under the floor
- tests: 39 node:test specs under test; 29 of 41 .mjs files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## The 35 sections

Each is the `## What lives where` block of that repository's overview, verbatim, from the run the
table above records.

## Homebrew__brew

```
## What lives where

- Library/Homebrew: 1651 .rb, 317 .rbi and 336 other; 657 RSpec specs; 8 test files; 1 minitest spec under helper; 515 of 985 have a namesake test under Library/Homebrew/test
- docs: 85 .md, 11 .yml and 19 other
- .github: 32 .yml, 2 .md and 6 other
- and 42 more files in directories under the floor
- tests: 657 RSpec specs under Library/Homebrew/test; 8 test files under Library/Homebrew; 1 minitest under Library/Homebrew/test/support/helper; 515 of 985 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## TryGhost__Ghost

```
## What lives where

- ghost/core: 2093 .js, 384 .ts and 192 other; 806 test files; 20 vitest specs; 1 chai spec under public; 3 of 1396 have a namesake test under apps/announcement-bar
- apps: 914 .tsx (JSX), 751 .js and 1575 other; 231 vitest specs; 119 test files; 113 mocha specs; 31 playwright specs under e2e; 11 chai specs under editor; 33 of 738 have a namesake test under apps; 1014 sibling modules named index/eslint.config/vite.config; 321 files inline a helper
- koenig: 484 .ts, 287 .tsx (JSX) and 236 other; 109 test files; 60 playwright specs; 15 vitest specs under unit; 0 of 304 have a namesake test; 325 sibling modules named index/eslint.config/vitest.config; 87 files inline a helper
- e2e: 98 playwright specs, 64 test files and 139 other
- packages/i18n/locales: 311 .json
- and 412 more files in directories under the floor
- tests: 1099 test files; 278 vitest under apps; 189 playwright; and 3 more; 3 of 1396 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## alphagov__whitehall

```
## What lives where

- test: 538 minitest specs, 92 test files and 136 other
- app/models: 238 .rb, 7 .json; 140 of 238 have a namesake test under test/unit/app/models
- db: 223 .rb, 2 .csv and 3 other; 0 of 223 have a namesake test
- features: 96 .rb, 55 .feature; 1 test file under support; 2 of 95 have a namesake test under test
- app/controllers/admin: 95 .rb; 91 of 95 have a namesake test under test/functional/admin
- app/presenters/publishing_api: 66 .rb; 61 of 66 have a namesake test under test/unit/app/presenters/publishing_api
- app/helpers: 52 .rb; 31 of 52 have a namesake test under test/unit/app/helpers
- and 8 more directories holding 1018 files
- tests: 538 minitest specs under test; 111 test files under test; 5 RSpec under test/unit/app/helpers; 140 of 238 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## angular__angular

```
## What lives where

- packages/core: 1086 .ts, 82 .bazel and 84 other; 268 test files; 13 of 818 have a namesake test under packages/core
- adev/src/content: 612 .ts, 384 .md and 837 other; 24 test files under src; 7 of 588 have a namesake test under adev/src/content
- packages/compiler-cli: 535 .ts, 118 .bazel and 28 other; 37 test files under test; 1 of 498 have a namesake test under packages/core/schematics/migrations/signal-migration/test/golden-test
- packages/compiler: 292 .ts, 8 .bazel and 4 other; 50 test files; 2 of 242 have a namesake test under packages/core/schematics/migrations/signal-migration/test/golden-test
- packages/zone.js: 215 .ts, 38 .js and 65 other; 103 test files; 1 vitest spec under vitest; 1 of 117 have a namesake test under packages/zone.js/test/common
- devtools/projects: 256 .ts, 106 .bazel and 150 other; 68 test files; 61 of 188 have a namesake test under devtools/projects
- adev/shared-docs: 136 .mts, 86 .ts and 230 other; 51 test files; 0 of 105 have a namesake test; 173 sibling modules named index/builder/defaults; 3 files inline a helper
- and 11 more directories holding 3170 files
- tests: 1006 test files; 10 Cypress under devtools/cypress/integration; 1 vitest under packages/zone.js/test/vitest; 13 of 818 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## appsmithorg__appsmith

```
## What lives where

- app/client: 3661 .ts, 2926 .svg and 3734 other; 835 Cypress specs; 554 test files; 12 playwright specs; 1 jest spec under ctl; 191 of 2888 have a namesake test under app/client; 2982 sibling modules named index/types/constants; 504 files inline a helper
- app/server: 2077 .java, 169 .json and 128 other
- deploy: 54 .sh, 32 .yaml and 105 other; 1 vitest spec under tests
- and 201 more files in directories under the floor
- tests: 835 Cypress specs under app/client/cypress/e2e/Regression/ClientSide; 554 test files under app/client/src; 12 playwright under app/client/playwright; and 2 more; 191 of 2888 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## babel__babel

```
## What lives where

- packages/babel-helpers: 93 .ts, 37 .js and 17 other; 1 test file under unittests; 0 of 93 have a namesake test
- packages/babel-types: 95 .ts, 20 .js and 4 other; 20 test files; 0 of 95 have a namesake test
- packages/babel-parser/test/expressions/esprima: 109 .js, 109 .json and 1 other; 0 of 109 have a namesake test
- packages/babel-runtime-corejs3/helpers/esm: 95 .js, 1 .json; 2 of 95 have a namesake test under packages/babel-plugin-transform-regenerator/test
- packages/babel-core: 54 .ts, 22 .js and 4 other; 20 test files under test; 0 of 53 have a namesake test
- eslint: 34 .ts, 21 .js and 18 other; 10 test files; 0 of 34 have a namesake test
- packages/babel-traverse: 36 .ts, 19 .js and 4 other; 18 test files under test; 0 of 35 have a namesake test
- and 10 more directories holding 1510 files
- tests: 150 test files under packages; 2 jest; 1 node:test under test/esm; 0 of 93 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## backstage__backstage

```
## What lives where

- plugins: 3099 .ts, 1075 .tsx (JSX) and 1360 other; 1049 test files; 685 of 2431 have a namesake test under plugins; 2667 sibling modules named index/.eslintrc/types; 229 files inline a helper
- packages/ui/src/components: 151 .ts, 142 .tsx (JSX) and 50 other; 9 test files; 3 of 151 have a namesake test under packages/ui/src/components; 151 sibling modules named types/definition/index; 34 files inline a helper
- packages/backend-defaults/src/entrypoints: 213 .ts; 76 test files; 73 of 137 have a namesake test under packages/backend-defaults/src/entrypoints
- packages/core-components/src/components: 140 .tsx (JSX), 44 .ts and 5 other; 43 test files; 38 of 101 have a namesake test under packages/core-components/src/components; 40 sibling modules named index/types/AnsiProcessor; 28 files inline a helper
- packages/core-app-api/src: 144 .ts, 37 .tsx (JSX); 61 test files; 40 of 106 have a namesake test under packages/core-app-api/src; 106 sibling modules named index/types/AlertApiForwarder; 14 files inline a helper
- packages/catalog-model: 161 .ts, 51 .yaml and 24 other; 62 test files; 63 of 99 have a namesake test under packages/catalog-model
- docs-ui/src/app/components: 72 .tsx (JSX), 57 .ts and 44 other; 0 of 72 have a namesake test; 57 sibling modules named snippets/props-definition; 1 file inlines a helper
- and 5 more directories holding 4912 files
- tests: 1711 test files; 10 playwright under packages; 685 of 2431 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## calcom__cal.diy

```
## What lives where

- apps: 969 .ts, 595 .tsx (JSX) and 478 other; 66 test files; 65 vitest specs; 51 playwright specs under playwright; 2 jest specs under v2; 26 of 802 have a namesake test under apps; 810 sibling modules named route/[trpc]/index; 142 files inline a helper
- packages/features: 901 .ts, 64 .tsx (JSX) and 16 other; 199 vitest specs; 3 test files under __tests__; 105 of 703 have a namesake test under packages/features; 703 sibling modules named types/index/tokens; 17 files inline a helper
- packages/app-store: 680 .ts, 184 .json and 699 other; 33 vitest specs; 2 playwright specs under tests; 1 test file under __tests__; 17 of 647 have a namesake test under packages/app-store; 647 sibling modules named index/add/zod; 5 files inline a helper
- packages/trpc/server/routers/viewer: 345 .ts, 20 .tsx; 26 vitest specs; 21 of 319 have a namesake test under packages/trpc/server/routers/viewer
- packages/platform: 267 .ts, 81 .tsx (JSX) and 59 other; 6 playwright specs; 3 vitest specs under __tests__; 1 test file under tests; 1 of 258 have a namesake test under packages/platform; 266 sibling modules named index/types/permissions; 16 files inline a helper
- packages/ui/components: 140 .tsx (JSX), 63 .ts and 14 other; 26 vitest specs; 8 test files; 9 of 108 have a namesake test under packages/ui/components; 62 sibling modules named index/types/dateRangeLogic; 24 files inline a helper
- packages/lib (files at this level): 146 .ts, 4 .json and 4 other; 22 vitest specs; 21 of 124 have a namesake test under packages/lib; 124 sibling modules named array/availability/buildCalEventFromBooking; 1 file inlines a helper
- and 4 more directories holding 1643 files
- tests: 431 vitest specs under packages; 79 test files under apps; 72 playwright; and 1 more; 26 of 802 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## chef__chef

```
## What lives where

- spec: 657 RSpec specs, 4 test files and 461 other
- lib/chef: 797 .rb, 12 .erb and 2 other; 499 of 797 have a namesake test under spec/unit
- kitchen-tests: 66 .rb, 6 .yml and 16 other; 19 RSpec specs; 0 of 47 have a namesake test
- chef-utils: 37 .rb, 4 (none) and 2 other; 14 RSpec specs under dsl; 0 of 23 have a namesake test
- chef-config: 20 .rb, 3 (none) and 1 other; 6 RSpec specs under unit; 0 of 14 have a namesake test
- .expeditor: 17 .sh, 11 .ps1 and 13 other
- docs/dev: 39 .md
- and 1 more directory holding 113 files
- tests: 696 RSpec specs under spec; 5 test files under spec/unit; 499 of 797 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## consul__consul

```
## What lives where

- spec: 683 RSpec specs and 59 other
- db/migrate: 605 .rb; 0 of 605 have a namesake test
- app/components: 324 .rb, 315 .erb and 1 other; 179 of 324 have a namesake test under spec/components
- app/controllers: 227 .rb, 2 (none); 80 of 227 have a namesake test under spec/controllers
- app/models: 195 .rb, 4 (none); 128 of 195 have a namesake test under spec/models
- app/assets: 197 .scss, 71 .js and 103 other
- config/locales: 2025 .yml, 1 (none)
- and 2 more directories holding 1213 files
- tests: 683 RSpec specs under spec; 0 of 605 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## decidim__decidim

```
## What lives where

- decidim-core: 1917 .rb, 379 .erb and 547 other; 684 RSpec specs; 57 test files; 6 of 1233 have a namesake test under decidim-core/spec
- decidim-admin: 482 .rb, 184 .erb and 159 other; 211 RSpec specs; 3 test files; 8 of 271 have a namesake test under decidim-admin/spec
- decidim-proposals: 466 .rb, 86 .erb and 109 other; 205 RSpec specs; 10 of 261 have a namesake test under decidim-proposals/spec
- decidim-meetings: 443 .rb, 100 .erb and 110 other; 180 RSpec specs; 1 test file under public_participants; 8 of 263 have a namesake test under decidim-meetings/spec
- decidim-initiatives: 374 .rb, 83 .yml and 93 other; 149 RSpec specs; 2 of 225 have a namesake test under decidim-initiatives/spec
- decidim-participatory_processes: 367 .rb, 83 .yml and 63 other; 141 RSpec specs; 3 of 226 have a namesake test under decidim-participatory_processes/spec
- decidim-conferences: 356 .rb, 83 .yml and 87 other; 159 RSpec specs; 4 of 197 have a namesake test under decidim-conferences/spec
- and 18 more directories holding 4896 files
- tests: 2610 RSpec specs; 68 test files under decidim-core/app/packs/src/decidim; 6 of 1233 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## diaspora__diaspora

```
## What lives where

- spec: 317 RSpec specs, 103 test files and 20 other
- app/assets: 149 .js, 92 .scss and 70 other; 80 of 149 have a namesake test under spec
- app/controllers: 64 .rb; 44 of 64 have a namesake test under spec/controllers
- app/models: 61 .rb; 48 of 61 have a namesake test under spec/models
- config: 263 .yml, 59 .rb and 5 other
- db/migrate: 49 .rb; 0 of 49 have a namesake test
- app/workers: 48 .rb; 7 of 48 have a namesake test under spec/workers
- and 5 more directories holding 621 files
- tests: 317 RSpec specs under spec; 103 test files under spec/javascripts/app; 80 of 149 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## discourse__discourse

```
## What lives where

- plugins: 4330 .rb, 4072 .yml and 2758 other; 1675 RSpec specs; 217 qunit specs; 1 test file under routes; 0 of 2655 have a namesake test
- spec: 1680 RSpec specs, 7 test files and 498 other
- frontend/discourse: 1907 .js, 1678 .gjs and 167 other; 456 qunit specs; 9 test files; 1 of 1448 have a namesake test under plugins/discourse-ai/spec/lib/agents/tool_runner
- db/migrate: 1735 .rb, 1 .json; 7 of 1735 have a namesake test under spec/db/migrate
- migrations: 392 .rb, 11 (none) and 24 other; 72 RSpec specs; 0 of 320 have a namesake test
- app/models: 379 .rb; 209 of 379 have a namesake test under spec/models
- lib (files at this level): 253 .rb; 186 of 253 have a namesake test under spec/lib
- and 5 more directories holding 3371 files
- tests: 3432 RSpec specs; 674 qunit; 18 test files; and 3 more; 0 of 2655 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## empire-flippers__api

```
## What lives where

- app/services: 1575 .rb; 1046 of 1575 have a namesake test under spec/services
- db/migrate: 1525 .rb; 0 of 1525 have a namesake test
- spec: 1333 RSpec specs, 1 test file and 135 other
- app/workers: 496 .rb; 0 of 496 have a namesake test
- app/models: 166 .rb, 1 (none); 50 of 166 have a namesake test under spec/models
- app/controllers/api/v1: 101 .rb; 98 of 101 have a namesake test under spec/controllers/api/v1
- app/mcp/mcp: 93 .rb; 41 of 93 have a namesake test under spec/mcp
- and 2 more directories holding 3560 files
- tests: 1334 RSpec specs under spec; 2 test files; 1046 of 1575 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## empire-flippers__client

```
## What lives where

- src/pages: 1003 .tsx (JSX), 188 .ts and 71 other; 2 vitest specs under __tests__; 0 of 1003 have a namesake test; 186 sibling modules named types/schema/mapper; 214 files inline a helper
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 have a namesake test under cypress/integration/components; 66 sibling modules named index/schema/types; 117 files inline a helper
- src/queries: 314 .ts, 1 .tsx; 0 of 314 have a namesake test
- cypress/integration: 102 Cypress specs
- src/hooks: 47 .tsx (JSX), 23 .ts; 0 of 47 have a namesake test; 23 sibling modules named mapper/payoutContext/schema; 6 files inline a helper
- src/utils: 53 .ts, 10 .js and 4 other; 3 vitest specs under __tests__; 4 of 52 have a namesake test under src/utils/__tests__; 60 sibling modules named assert/balanceTransaction/buyerProfileValidation; 0 files inline a helper
- src/layouts: 42 .tsx (JSX), 11 .jpg and 21 other; 0 of 42 have a namesake test; 6 sibling modules named constants/utils/hooks; 4 files inline a helper
- and 3 more directories holding 434 files
- tests: 103 Cypress specs under cypress/integration; 7 vitest under src; 0 of 1003 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## errbit__errbit

```
## What lives where

- spec: 101 RSpec specs, 1 test file and 32 other
- config: 31 .rb, 6 .yml; 2 of 31 have a namesake test under spec
- app/models: 20 .rb; 18 of 20 have a namesake test under spec/models
- app/controllers: 18 .rb; 16 of 18 have a namesake test under spec/controllers
- app/decorators: 8 .rb; 8 of 8 have a namesake test under spec/decorators
- app/helpers: 8 .rb; 4 of 8 have a namesake test under spec/helpers
- app/interactors: 7 .rb; 7 of 7 have a namesake test under spec/interactors
- and 7 more directories holding 297 files
- tests: 101 RSpec specs under spec; 1 test file under spec/models; 2 of 31 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## eslint__eslint

```
## What lives where

- lib/rules: 305 .js; 301 of 305 have a namesake test under tests/lib/rules
- tests/lib/rules: 301 test files
- tools: 17 .js, 3 .mjs and 3 other; 6 of 17 have a namesake test under tests/tools
- lib/linter: 20 .js; 17 of 20 have a namesake test under tests/lib/linter
- lib/shared: 19 .js; 11 of 19 have a namesake test under tests/lib/shared
- messages: 18 .js; 0 of 18 have a namesake test
- lib/languages/js: 17 .js; 1 of 17 have a namesake test under tests/lib/languages/js
- and 10 more directories holding 830 files
- tests: 359 test files under tests/lib/rules; 8 chai under tests; 1 Cypress; 301 of 305 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## fastlane__fastlane

```
## What lives where

- fastlane: 504 .rb, 53 .png and 134 other; 194 RSpec specs under actions_specs; 3 of 310 have a namesake test under fastlane/spec
- spaceship: 312 .rb, 9 .md and 10 other; 104 RSpec specs; 2 test files under tunes; 0 of 206 have a namesake test
- fastlane_core: 107 .rb, 7 .json and 6 other; 45 RSpec specs under spec; 1 of 62 have a namesake test under fastlane
- match: 52 .rb, 4 .gif and 8 other; 21 RSpec specs under spec; 1 of 31 have a namesake test under fastlane
- deliver: 41 .rb, 7 .mp4 and 13 other; 15 RSpec specs under spec; 0 of 26 have a namesake test
- snapshot: 36 .rb, 22 .json and 58 other; 9 RSpec specs under spec; 1 of 27 have a namesake test under fastlane
- precheck: 28 .rb, 2 .md and 5 other; 7 RSpec specs under rules; 0 of 21 have a namesake test
- and 7 more directories holding 718 files
- tests: 449 RSpec specs; 2 test files under spaceship/spec/tunes; 3 of 310 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## forem__forem

```
## What lives where

- spec: 1271 RSpec specs and 131 other
- db/migrate: 949 .rb; 0 of 949 have a namesake test
- app/javascript: 321 .jsx (JSX), 297 .js and 33 other; 152 test files under __tests__; 0 of 240 have a namesake test; 220 sibling modules named index/actions/actionsPanel; 71 files inline a helper
- app/services: 304 .rb; 266 of 304 have a namesake test under spec/services
- app/controllers: 264 .rb, 1 (none); 14 of 264 have a namesake test under spec/requests
- app/models: 166 .rb, 1 .md and 1 other; 134 of 166 have a namesake test under spec/models
- app/workers: 157 .rb; 139 of 157 have a namesake test under spec/workers
- and 6 more directories holding 2529 files
- tests: 1271 RSpec specs under spec; 153 test files under app/javascript; 127 Cypress under cypress/e2e/seededFlows; 0 of 949 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## huginn__huginn

```
## What lives where

- spec: 155 RSpec specs and 49 other
- app/models/agents: 75 .rb; 75 of 75 have a namesake test under spec/models/agents
- db/migrate: 71 .rb; 2 of 71 have a namesake test under spec/migrations
- config: 35 .rb, 4 .yml; 1 of 35 have a namesake test under spec
- app/concerns: 27 .rb; 13 of 27 have a namesake test under spec/concerns
- lib (files at this level): 19 .rb; 16 of 19 have a namesake test under spec/lib
- app/assets: 18 .js, 6 .scss and 5 other; 0 of 18 have a namesake test
- and 9 more directories holding 265 files
- tests: 155 RSpec specs under spec; 75 of 75 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## instructure__canvas-lms

```
## What lives where

- ui: 3609 .tsx (JSX), 1865 .js and 4601 other; 3235 test files under __tests__; 110 vitest specs under __tests__; 2 jest specs under test-utils; 0 of 2361 have a namesake test; 2417 sibling modules named index/types/utils; 1506 files inline a helper
- spec: 2732 RSpec specs, 1 test file and 473 other
- gems: 687 .rb, 180 .json and 397 other; 239 RSpec specs; 0 of 448 have a namesake test
- lib: 808 .rb, 20 .rake and 22 other; 463 of 808 have a namesake test under spec/lib
- app/models: 688 .rb; 516 of 688 have a namesake test under spec/models
- packages/canvas-rce/src/rce/plugins: 163 .jsx (JSX), 154 .js and 136 other; 188 test files under __tests__; 0 of 83 have a namesake test; 152 sibling modules named plugin/index/utils; 67 files inline a helper
- app/graphql: 390 .rb, 5 .md; 232 of 390 have a namesake test under spec/graphql
- and 8 more directories holding 4982 files
- tests: 3519 test files under ui; 2971 RSpec under spec; 125 vitest under ui; and 1 more; 0 of 2361 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## mastodon__mastodon

```
## What lives where

- spec: 1099 RSpec specs and 141 other
- app/javascript: 432 .tsx (JSX), 341 .svg and 775 other; 24 test files; 2 vitest specs; 0 of 429 have a namesake test; 325 sibling modules named index/accounts/notifications; 177 files inline a helper
- db/migrate: 535 .rb; 0 of 535 have a namesake test
- app/controllers: 338 .rb; 37 of 338 have a namesake test under spec/controllers
- app/models: 248 .rb; 150 of 248 have a namesake test under spec/models
- app/lib: 167 .rb; 119 of 167 have a namesake test under spec/lib
- app/serializers: 144 .rb; 84 of 144 have a namesake test under spec/serializers
- and 5 more directories holding 5626 files
- tests: 1099 RSpec specs under spec; 24 test files under app/javascript/mastodon; 2 vitest under app/javascript/mastodon; 0 of 429 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## microsoft__vscode

```
## What lives where

- src/vs: 8225 .ts, 430 .css and 675 other; 1670 test files; 5 of 6555 have a namesake test under src/vs
- extensions: 3165 .ts, 1066 .json and 1190 other; 406 vitest specs under test; 150 test files under test; 77 mocha specs; 16 node:test specs under test; 7 chai specs under test; 1 playwright spec under test; 13 of 2549 have a namesake test under extensions; 2644 sibling modules named index/esbuild/utils; 47 files inline a helper
- src/vscode-dts: 177 .ts, 1 .md; 0 of 177 have a namesake test
- test: 116 .ts, 32 .json and 53 other; 33 test files; 22 playwright specs under src; 10 mocha specs; 0 of 58 have a namesake test
- and 582 more files in directories under the floor
- tests: 1858 test files under src/vs; 406 vitest under extensions/copilot/src; 87 mocha under extensions; and 3 more; 5 of 6555 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## openfoodfoundation__openfoodnetwork

```
## What lives where

- spec: 655 RSpec specs, 31 test files and 193 other
- db/migrate: 262 .rb; 6 of 262 have a namesake test under spec/migrations
- app/models: 175 .rb, 1 (none); 100 of 175 have a namesake test under spec/models
- engines: 162 .rb, 6 .js and 18 other; 60 RSpec specs; 0 of 102 have a namesake test
- app/controllers: 144 .rb; 88 of 144 have a namesake test under spec/controllers
- app/services: 121 .rb; 84 of 121 have a namesake test under spec/services
- app/webpacker: 186 .scss, 87 .js and 71 other
- and 7 more directories holding 1770 files
- tests: 715 RSpec specs under spec; 32 test files under spec/javascripts; 6 of 262 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## opf__openproject

```
## What lives where

- modules: 4029 .rb, 2982 .yml and 771 other; 1406 RSpec specs; 8 test files; 0 of 2623 have a namesake test
- spec: 2633 RSpec specs, 5 test files and 469 other
- app/models: 988 .rb, 5 .yml and 4 other; 423 of 988 have a namesake test under spec/models
- app/components: 574 .rb, 412 .erb and 55 other; 168 of 574 have a namesake test under spec/components
- frontend/src/app/features: 527 .ts, 121 .html and 54 other; 22 test files; 2 vitest specs; 24 of 503 have a namesake test under frontend/src/app/features
- app/services: 479 .rb; 263 of 479 have a namesake test under spec/services
- lib/api/v3: 442 .rb; 137 of 442 have a namesake test under spec/lib/api/v3
- and 8 more directories holding 7948 files
- tests: 4039 RSpec specs; 106 test files under frontend/src; 73 vitest under frontend/src; 0 of 2623 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## prisma__prisma

```
## What lives where

- packages/1-framework: 839 .ts, 57 .json and 115 other; 318 vitest specs under test; 2 test files under shared; 0 of 519 have a namesake test
- test/integration/test: 686 .ts, 199 .md and 326 other; 338 vitest specs; 0 of 348 have a namesake test
- packages/2-sql: 562 .ts, 37 .json and 28 other; 273 vitest specs under test; 0 of 289 have a namesake test
- packages/3-targets: 533 .ts, 25 .json and 14 other; 268 vitest specs under test; 0 of 265 have a namesake test
- packages/3-extensions: 377 .ts, 49 .json and 22 other; 177 vitest specs under test; 0 of 200 have a namesake test
- examples: 311 .ts, 95 .json and 133 other; 46 vitest specs under test; 1 test file under test; 0 of 265 have a namesake test; 268 sibling modules named contract.d/prisma.config/db; 7 files inline a helper
- packages/2-mongo-family: 305 .ts, 42 .json and 19 other; 128 vitest specs under test; 0 of 177 have a namesake test
- and 7 more directories holding 1380 files
- tests: 1626 vitest specs; 28 node:test under scripts; 4 test files; 0 of 519 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## publiclab__plots2

```
## What lives where

- test: 75 minitest specs, 34 test files and 3 other
- db/migrate: 103 .rb, 1 .unused; 0 of 103 have a namesake test
- app/assets: 45 .js, 22 .css and 13 other; 3 of 45 have a namesake test under spec
- config: 37 .rb, 22 .yml and 11 other; 1 of 37 have a namesake test under test/integration
- app/models: 28 .rb; 12 of 28 have a namesake test under test/unit
- app/controllers: 27 .rb; 25 of 27 have a namesake test under test/functional
- app/helpers: 16 .rb; 9 of 16 have a namesake test under test/unit/helpers
- and 6 more directories holding 423 files
- tests: 75 minitest specs under test; 37 test files under test; 0 of 103 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## puppetlabs__puppet

```
## What lives where

- lib/puppet: 1009 .rb, 5 .erb and 4 other; 1 test file under util; 632 of 1008 have a namesake test under spec/unit
- spec/unit: 676 RSpec specs, 4 test files and 5 other
- acceptance: 255 .rb, 59 (none) and 12 other; 3 RSpec specs under acceptance; 2 test files under windows; 3 of 250 have a namesake test under acceptance
- spec/integration: 69 RSpec specs
- spec/lib: 38 .rb; 2 RSpec specs; 1 of 36 have a namesake test under spec/lib
- benchmarks: 49 .erb, 24 (none) and 34 other
- references: 40 .md
- and 183 more files in directories under the floor
- tests: 764 RSpec specs under spec/unit; 7 test files; 632 of 1008 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## react__react

```
## What lives where

- compiler: 223 .ts, 120 .rs and 230 other; 24 test files under __tests__; 2 playwright specs; 1 node:test spec under __tests__; 0 of 205 have a namesake test; 242 sibling modules named index/tsup.config/types.d; 8 files inline a helper
- scripts: 161 .js, 6 .md and 29 other; 13 test files under __tests__; 0 of 148 have a namesake test; 149 sibling modules named build/benchmark/index; 0 files inline a helper
- packages/react-devtools-shared/src/devtools/views: 149 .js (JSX), 80 .css; 1 of 149 have a namesake test under packages/react-devtools-inline/__tests__/__e2e__; 27 sibling modules named utils/constants/types; 43 files inline a helper
- packages/react-devtools-shared/src/hooks/__tests__/__source__/__compiled__: 144 test files and 67 other
- packages/react-dom/src/__tests__: 133 test files
- packages/react: 76 .js, 6 .ts and 3 other; 31 test files under __tests__; 1 of 51 have a namesake test under packages/react-devtools-shared/src/hooks/__tests__/__source__; 51 sibling modules named compiler-runtime/index/jsx-dev-runtime; 2 files inline a helper
- packages/react-reconciler/src (files at this level): 82 .js; 1 of 82 have a namesake test under packages/react-reconciler/src/forks
- and 18 more directories holding 1460 files
- tests: 583 test files under packages; 5 playwright; 1 node:test under compiler/apps/playground/__tests__; 0 of 205 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## rubocop__rubocop

```
## What lives where

- lib/rubocop/cop: 803 .rb; 676 of 803 have a namesake test under spec/rubocop/cop
- spec/rubocop/cop: 680 RSpec specs
- lib/rubocop (files at this level): 45 .rb; 32 of 45 have a namesake test under spec/rubocop
- spec/rubocop (files at this level): 33 RSpec specs and 1 other
- spec/support: 28 .rb; 6 RSpec specs; 0 of 22 have a namesake test
- lib/rubocop/formatter: 22 .rb; 21 of 22 have a namesake test under spec/rubocop/formatter
- relnotes: 291 .md
- and 2 more directories holding 252 files
- tests: 764 RSpec specs under spec/rubocop/cop; 1 test file under spec/core_ext; 676 of 803 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## storybookjs__storybook

```
## What lives where

- code: 3104 .ts, 785 .tsx (JSX) and 1607 other; 710 vitest specs; 33 playwright specs under e2e-sandbox; 23 test files under rules; 2 chai specs under test; 1 node:test spec under cli; 544 of 2383 have a namesake test under code; 2559 sibling modules named index/types/input.stories; 250 files inline a helper
- agent-eval: 89 .ts, 78 .tsx and 138 other; 53 vitest specs; 1 of 36 have a namesake test under agent-eval; 48 sibling modules named main/vitest.config/preview; 0 files inline a helper
- scripts: 164 .ts, 8 .js and 20 other; 31 vitest specs; 3 test files under tasks; 1 playwright spec under bench; 23 of 130 have a namesake test under scripts
- test-storybooks: 82 .ts, 51 .tsx (JSX) and 267 other; 8 playwright specs under e2e-tests; 7 vitest specs under tests; 4 test files under stories; 3 Cypress specs; 1 jest spec under stories; 0 of 64 have a namesake test; 99 sibling modules named main/preview/vite.config; 11 files inline a helper
- docs: 684 .md, 183 .mdx and 217 other
- and 120 more files in directories under the floor
- tests: 801 vitest specs under code; 42 playwright; 30 test files; and 4 more; 544 of 2383 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## supabase__supabase

```
## What lives where

- apps: 3874 .tsx (JSX), 3306 .png and 6691 other; 544 vitest specs; 120 of 3698 have a namesake test under apps; 2250 sibling modules named keys/index/route; 844 files inline a helper
- examples: 216 .ts, 174 .png and 1044 other; 11 test files; 6 of 206 have a namesake test under examples; 266 sibling modules named index/next.config/vite.config; 19 files inline a helper
- packages/ui-patterns/src: 134 .tsx (JSX), 68 .ts and 31 other; 21 vitest specs; 11 of 122 have a namesake test under packages/ui-patterns/src; 59 sibling modules named index/types/utils; 37 files inline a helper
- packages/ui: 129 .tsx (JSX), 18 .svg and 27 other; 7 vitest specs; 5 of 123 have a namesake test under packages/ui; 16 sibling modules named index/assets.d/clipboard; 13 files inline a helper
- and 1039 more files in directories under the floor
- tests: 617 vitest specs under apps/studio; 53 playwright under e2e/studio; 11 test files under examples/user-management; and 1 more; 120 of 3698 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## typeorm__typeorm

```
## What lives where

- test: 2748 .ts, 8 .json and 1 other; 667 chai specs; 277 test files; 1 mocha spec under 4956; 0 of 1803 have a namesake test
- src/driver: 90 .ts; 0 of 90 have a namesake test
- packages/codemod: 78 .ts, 5 .json and 6 other; 15 chai specs; 0 of 63 have a namesake test
- src/decorator: 69 .ts; 0 of 69 have a namesake test
- src/error: 61 .ts; 1 of 61 have a namesake test under test/functional/database-schema/custom-constraint-names/index
- src/query-builder: 39 .ts; 1 of 39 have a namesake test under test/functional/database-schema/custom-constraint-names/index
- docs: 76 .md, 12 .svg and 26 other; 4 sibling modules named databases/docusaurus.config/redirects; 2 files inline a helper
- and 323 more files in directories under the floor
- tests: 684 chai specs under test; 277 test files under test; 1 mocha under test/github-issues/4956; 0 of 1803 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## vercel__next.js

```
## What lives where

- test: 4964 .js (JSX), 4402 .tsx and 4149 other; 1851 test files; 67 playwright specs; 3 of 4958 have a namesake test under test; 2828 sibling modules named next.config/route/page; 755 files inline a helper
- turbopack/crates: 2194 .js, 781 .rs and 1472 other; 251 test files under input; 0 of 1943 have a namesake test; 2087 sibling modules named input/index/output; 3 files inline a helper
- examples: 959 .tsx (JSX), 751 .js and 2247 other; 14 test files; 5 vitest specs; 3 Cypress specs under e2e; 3 playwright specs under e2e; 7 of 946 have a namesake test under examples; 756 sibling modules named next.config/index/postcss.config; 97 files inline a helper
- crates/next-custom-transforms/tests: 810 .js, 86 .stderr and 45 other; 0 of 810 have a namesake test; 637 sibling modules named output/input/output-default; 34 files inline a helper
- packages/next/src/compiled: 684 .js, 145 .json and 168 other; 0 of 684 have a namesake test
- packages/next/src/server: 536 .ts, 36 .tsx and 5 other; 78 test files; 76 of 458 have a namesake test under packages/next/src/server; 463 sibling modules named index/utils/types; 5 files inline a helper
- packages/next-codemod/transforms/__testfixtures__: 238 .tsx, 159 .js and 100 other; 0 of 238 have a namesake test; 202 sibling modules named next.config/cloudinary-loader/eslint.config; 14 files inline a helper
- and 2 more directories holding 3559 files
- tests: 2307 test files under test; 79 playwright under test; 29 vitest under evals/evals; and 2 more; 3 of 4958 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## webpack__webpack

```
## What lives where

- test: 10418 .js, 814 .css and 1413 other; 2607 test files; 1 of 7858 have a namesake test under test
- lib: 651 .js, 1 .svg; 8 of 651 have a namesake test under test
- examples: 453 .js, 181 .md and 118 other; 0 of 453 have a namesake test; 450 sibling modules named build/webpack.config/example; 0 files inline a helper
- and 315 more files in directories under the floor
- tests: 2608 test files under test; 1 of 7858 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```
