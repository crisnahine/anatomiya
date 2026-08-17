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

35 of 35, after the first seven tuning changes below. The first run cleared 1 to 4 mechanically on
34 of them and read wrong on most.

Re-run after the whole-branch review's two roster fixes: 35 of 35 again, no number in the table
moved, and eleven root lines on nine repositories dropped a sibling-module count by 1 to 10.

Re-run again after the second review's Ruby facet fix: 35 of 35, no number in the table moved, and
six Ruby repositories dropped test counts (change 10 below).

Re-run again after the two follow-ups this document's own list of wrong readings named: 35 of 35,
no number in the table moved, and 23 repositories moved a namesake clause (changes 11 and 12
below). The first full run of that pair found a stale copy in the harness rather than in the tool:
the renderer took the singular verb for a count of one in an earlier change and the recount kept
spelling the plural, so babel's true `1 of 95 has a namesake test` read back as a failure. The verb
comes off the renderer now.

Re-run again after the mixin fix and the CommonJS one, which is the run recorded here: 35 of 35,
and the only column that moved is `module_include`, on discourse, empire-flippers/api and forem
(changes 13 and 14 below). The 35 rendered sections are byte-identical to the previous run's.

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
| Homebrew__brew | 2501 | 3 | 0 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14.9 |
| TryGhost__Ghost | 7940 | 5 | 0 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 142 | 87 | 14.8 |
| alphagov__whitehall | 2621 | 7 | 8 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 8.2 |
| angular__angular | 8522 | 7 | 11 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 93 | 103 | 13.8 |
| appsmithorg__appsmith | 13087 | 3 | 0 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 126 | 128 | 14.9 |
| babel__babel | 2303 | 7 | 10 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 26 | 16 | 5.5 |
| backstage__backstage | 11781 | 7 | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 186 | 99 | 15.2 |
| calcom__cal.diy | 7372 | 7 | 4 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 122 | 60 | 9.2 |
| chef__chef | 2281 | 7 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11.5 |
| consul__consul | 6025 | 7 | 2 | 1 | 1 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 7.3 |
| decidim__decidim | 11467 | 7 | 18 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 4 | 5 | 20.9 |
| diaspora__diaspora | 1921 | 7 | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4.9 |
| discourse__discourse | 23263 | 7 | 5 | 6 | 1 | 1 | 3 | 2 | 0 | 0 | 75 | 12 | 67.4 |
| empire-flippers__api | 8986 | 7 | 2 | 2 | 1 | 0 | 7 | 3 | 0 | 0 | 0 | 0 | 18.9 |
| empire-flippers__client | 2999 | 7 | 3 | 2 | 2 | 0 | 0 | 0 | 6 | 0 | 86 | 44 | 5.3 |
| errbit__errbit | 529 | 7 | 7 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.1 |
| eslint__eslint | 1533 | 7 | 10 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 7 | 4.4 |
| fastlane__fastlane | 2136 | 7 | 7 | 2 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 7.2 |
| forem__forem | 6425 | 7 | 6 | 3 | 2 | 0 | 1 | 1 | 0 | 0 | 14 | 7 | 15.1 |
| huginn__huginn | 729 | 7 | 9 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2.8 |
| instructure__canvas-lms | 21913 | 7 | 8 | 4 | 2 | 0 | 1 | 0 | 0 | 0 | 148 | 129 | 103.5 |
| mastodon__mastodon | 9846 | 7 | 5 | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 20 | 23 | 12.3 |
| microsoft__vscode | 15712 | 4 | 0 | 6 | 2 | 0 | 0 | 0 | 14 | 0 | 164 | 90 | 58.7 |
| openfoodfoundation__openfoodnetwork | 3882 | 7 | 7 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 1 | 10.7 |
| opf__openproject | 22498 | 7 | 8 | 3 | 1 | 0 | 1 | 0 | 0 | 0 | 22 | 7 | 51.3 |
| prisma__prisma | 6154 | 7 | 7 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 115 | 76 | 9.8 |
| publiclab__plots2 | 860 | 7 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2.6 |
| puppetlabs__puppet | 2466 | 7 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 17.1 |
| react__react | 2969 | 7 | 18 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 16 | 34 | 9.8 |
| rubocop__rubocop | 2155 | 7 | 2 | 2 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 9.8 |
| storybookjs__storybook | 7597 | 5 | 0 | 7 | 2 | 0 | 0 | 0 | 0 | 0 | 75 | 77 | 13.4 |
| supabase__supabase | 16751 | 4 | 0 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 198 | 157 | 16.8 |
| typeorm__typeorm | 3542 | 7 | 0 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 8 | 25 | 5.5 |
| vercel__next.js | 28490 | 7 | 2 | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 28 | 58 | 32.4 |
| webpack__webpack | 14364 | 3 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 15 | 18 | 9.9 |

## Tuning, and why

Seven changes out of the corpus runs, then two more out of the first whole-branch review, one out
of the second, two against the clauses the list below this one named as reading wrong, and two that
this document's own audit section asked for. Each has a test that fails before it and passes after. The three numbers the design left open are
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

### 10. A Ruby test DSL call inside a method declares no case

Was: a `describe`, `context`, `feature`, `it`, `test` or `shared_examples` call with a block made
the file a spec wherever it sat. Now it counts only outside every method, which is the altitude the
JavaScript half already read off `ctx.enclosing`. A class or module body still counts, because that
is where RSpec's own describes sit.

errbit's `spec/support/macros.rb` is the shape: two plain methods, `it_requires_authentication` and
`it_requires_admin_privileges`, whose bodies call `context` and `it` so a real spec can call the
method. It is the macro, not the spec, and it read as one RSpec spec. whitehall has eleven of them
under `test/support` and `test/integration`.

Six repositories moved and every one of them downward: whitehall's tests line 111 to 101 test
files, puppet 771 to 767 across two groups, openproject 4039 to 4036 RSpec specs, chef 696 to 694,
canvas-lms 2971 to 2970, errbit 101 to 100. puppet also gained a namesake, 632 of 1008 to 633 of
1009, because a file that stopped being a test went back to being one of the files a test answers.
Nothing else in any section moved and no number in the table above changed.

### 11. The namesake tail is asked a second time with the tree names dropped

Was: a test answers a source file when its directory ends with the source's tail under the root.
Now that rule first, unchanged, and where it finds nothing the same equal-or-endsWith rule over
both sides with every `app`, `lib`, `src`, `spec`, `test`, `tests` and `__tests__` segment dropped.

A repository that splits a source tree from a spec tree writes the same path on both halves and
only the word for the tree differs, so the whole tail can never match:
`modules/budgets/app/models/budget.rb` is answered by `modules/budgets/spec/models/budget_spec.rb`,
and `src/vs/base/common/foo.ts` by `src/vs/base/test/common/foo.test.ts`. Only those seven names
drop, which is what keeps `spec/support/user.rb` from answering `app/models/user.rb`: `support`
against `models` is still there to compare.

| repository | root | was | now |
|---|---|---|---|
| discourse | `plugins` | 0 of 2655 | 725 of 2655 |
| openproject | `modules` | 0 of 2623 | 662 of 2623 |
| vscode | `src/vs` | 5 of 6555 under `src/vs` | 1043 of 6555 |
| canvas-lms | `ui` | 0 of 2361 | 1241 of 2361 |
| decidim | `decidim-core` | 6 of 1233 | 257 of 1233 |
| webpack | `examples` | 0 of 453 | 1 of 453 under `test` |

23 of the 35 moved a clause, and decidim's other six engines moved with `decidim-core`:
8 of 271 to 98, 10 of 261 to 93, 8 of 263 to 51, 2 of 225 to 72, 3 of 226 to 33,
4 of 197 to 41. fastlane's seven roots went from 3, 0, 1, 1, 0, 1 and 0 to 28, 87, 27, 22, 15, 9
and 6. The tests line follows the root it nouns, so discourse now reads
`725 of 2655 .rb files have a namesake test` where it read 0.

A mirrored match votes for the tree the two paths part on, `modules/budgets/spec` and
`src/vs/base/test`, rather than for the prefix a whole-tail match strips. A top vote holding under
half the matched files names no root and the clause prints without `under`, because a repository
with one `__tests__` per component directory has an answer for every file and no one place to name:
that is canvas-lms's `ui` and vscode's `src/vs`. It also took `under` off five roots whose old vote
had been won outright on one to three matches: angular's `packages/compiler-cli` had been naming
`packages/core/schematics/migrations/signal-migration/test/golden-test` on one, and Ghost's
`ghost/core` `apps/announcement-bar` on three.

### 12. A root inside a test tree is not asked about its fixtures

A root whose path is, or sits under, a top-level `test`, `tests`, `spec`, `cypress`, `e2e` or
`__tests__` prints no namesake clause. Its extension and runner clauses stay.

webpack's `test` is 12,645 files of which 2,607 are tests, so it does not clear the half that makes
a test root and printed `1 of 7858 has a namesake test under test` over the fixture modules those
2,607 tests run on. A namesake test for a fixture is not a thing. Seven roots on seven repositories
dropped the clause: webpack `test` (1 of 7858), next.js `test` (3 of 4958), typeorm `test` (0 of
1803), vscode `test` (0 of 58), prisma `test/integration/test` (0 of 348), rubocop `spec/support`
(0 of 22) and puppet `spec/lib` (1 of 37).

The tests line nouns the first root that has a clause, so webpack's now reads `8 of 651 .js files
have a namesake test` off `lib`, next.js's `3 of 1943` off `turbopack/crates` and typeorm's
`0 of 90` off `src/driver`. That is the line doing its job: the denominator is a directory that
produces code rather than one that exercises it.

### 13. The mixin row counts a class body once, however many modules it includes

Was: one site per included constant. Now: one site per class or module body, conforming when any of
its includes names the learned module. A learned row may declare `groupedSites`; `class_base` names
one superclass per class and stays per site.

This is the issue the audit section below named, and it is what a threshold that fails closed looks
like. A Rails worker includes `Sidekiq::Worker` and one more module, so per constant the row could
not pass 0.5 whatever the directory did: empire-flippers/api `app/workers/workers` read 125 of 234
and `app/workers/cronjobs` 70 of 140, which is exactly one half. Grouped they read 125 of 125 and
70 of 70, and both state.

Seven areas of four repositories state the row where two of two did before: three of
empire-flippers/api's worker directories, discourse's `plugins/chat/app/services/chat` (46 of 46)
and `plugins/discourse-workflows/app/services/discourse_workflows` (45 of 45), forem's `app/workers`
(88 of 88), and fastlane's `spaceship/lib/spaceship/connect_api/models`, which already did. In the
table at the top of this file `module_include` moves on discourse (1 to 2),
empire-flippers/api (0 to 3) and forem (0 to 1). Nothing else in the table moves, and no rendered
section moves at all: this row is a directive, not a layout count.

### 14. A CommonJS file's exports are read off its assignments

Was: the parser's static ESM record only. Now that, plus `module.exports = { a, b }`,
`module.exports = fn`, `module.exports = function () {}`, `exports.name = ...` and
`module.exports.name = ...`. A repository written in `require` reported no exports at all, so every
module-level function in it read as a private helper.

The object at the end of a chain is the one that is published, so `module.exports = exports = { a }`
hands out `a`. An accessor in that object is not an export name: it is read through the object
rather than defined under that name in the file, and the usual shape is a lazy `require`.

No repository's helper count moved. The clause that spends the facet is `N files inline a helper`,
and `inlineFiles` counts JSX files only, so the fix can move a printed number only for a JSX file
that publishes through `module.exports`, and the corpus holds none. The 35 sections are
byte-identical to the previous run's, and the `imports` and `reused` columns are unchanged. The
record is correct now where it was wrong; what reads it is narrow enough that nothing here saw the
difference.

## What still reads wrong, and why it was left

**Three signals now, and a repository can still spell a test in a fourth way.** The name, the
runner import or a top-level call, the `__tests__` directory, and the mirror cover the 35. They are
a closed set, and a repository whose tests are named for neither the runner nor the file they
cover, sitting in a directory named for neither, would go uncounted. That is the trade the
directory rule was making the other way round, and the harness is what would find the next case.

**The mirrored tail drops seven names and no others.** Change 11 reads a split the two halves spell
with `app` against `spec` or `src` against `test`. A repository that spells its tree with a word
outside those seven, or that renames the file as well as the directory, still reads zero, and the
list grows only by measurement: a wider one starts matching on the basename, which is the loose
rule the tail rule was chosen over. The count beside it on the same line already says the tests are
there.

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

**One match can still name a namesake root.** mastodon prints `1 of 429 has a namesake test under
app/javascript/mastodon/components/__tests__`, react `1 of 148 ... under
scripts/error-codes/__tests__`, webpack `1 of 453 ... under test`. Change 11's half rule refuses a
root most of the matches disagree with, and one match agrees with itself.

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

The bar a new dimension has to clear asks for the counts per repository and refuses a summary
(CONTRIBUTING, steps 2 and 3). So the harness prints one table per row: a line for every area that
carried a candidate site, capped at the five biggest per repository, since a repository with sixty
leaf areas holding one class each is not what the bar is asking about. `stated` says whether the
area was handed the sentence, and names the gate that stopped it when it was not. A gate of
`model default` is an area that passed every gate and prints counts anyway, because the model
writes that side unprompted.

The stated counts in the table at the top of this file are over every area; these tables see only
the five biggest per repository, so a row stated on a small area is not on the line below it.

### extends_base

| repo | area | applicability | langFileCount | candidates | conforming | ratio | learned | stated |
|---|---|---|---|---|---|---|---|---|
| TryGhost__Ghost | apps/ember-admin/app/components | 100 | 112 | 103 | 86 | 0.835 | Component | no (ratio) |
| TryGhost__Ghost | apps/ember-admin/app/services | 35 | 40 | 47 | 31 | 0.660 | Service | no (ratio) |
| TryGhost__Ghost | ghost/core/core/server/data/seeders/importers | 41 | 43 | 41 | 41 | 1.000 | TableImporter | yes |
| TryGhost__Ghost | apps/ember-admin/app/routes | 28 | 30 | 29 | 15 | 0.517 | AuthenticatedRoute | no (ratio) |
| TryGhost__Ghost | e2e/helpers/pages/admin | 23 | 37 | 28 | 19 | 0.679 | AdminPage | no (ratio) |
| angular__angular | packages/core/test/acceptance | 25 | 75 | 244 | 64 | 0.262 | SuperDirective | no (ratio) |
| angular__angular | packages/upgrade/static/test/integration | 6 | 10 | 86 | 86 | 1.000 | UpgradeComponent | no (concentration) |
| angular__angular | packages/compiler/src/typecheck/ops | 20 | 25 | 33 | 28 | 0.848 | TcbOp | no (ratio) |
| angular__angular | packages/forms/src/directives | 22 | 31 | 31 | 7 | 0.226 | AbstractValidatorDirective | no (ratio) |
| angular__angular | packages/compiler/src/template/pipeline/ir/src | 1 | 10 | 29 | 28 | 0.966 | ExpressionBase | no (evidence) |
| appsmithorg__appsmith | app/client/src/components/propertyControls | 55 | 74 | 58 | 51 | 0.879 | BaseControl | no (ratio) |
| appsmithorg__appsmith | app/client/src/widgets | 56 | 192 | 56 | 38 | 0.679 | BaseWidget | no (ratio) |
| appsmithorg__appsmith | app/client/src/components/formControls | 23 | 40 | 25 | 22 | 0.880 | BaseControl | no (ratio) |
| appsmithorg__appsmith | app/client/src/api | 11 | 34 | 11 | 9 | 0.818 | Api | no (ratio) |
| appsmithorg__appsmith | app/client/src/entities | 7 | 45 | 11 | 4 | 0.364 | AppEngineApiError | no (ratio) |
| babel__babel | packages/babel-parser/src/plugins | 8 | 9 | 10 | 6 | 0.600 | superClass | no (ratio) |
| babel__babel | packages/babel-plugin-transform-regenerator/src/regenerator | 1 | 7 | 7 | 7 | 1.000 | Entry | no (evidence) |
| babel__babel | eslint/babel-eslint-parser/src | 3 | 17 | 6 | 2 | 0.333 | OriginalReferencer | no (ratio) |
| babel__babel | packages/babel-plugin-transform-regenerator/test/regenerator-fixtures | 2 | 14 | 2 | 2 | 1.000 | A | no (evidence) |
| babel__babel | packages/babel-core/src | 1 | 14 | 1 | 1 | 1.000 | Error | no (evidence) |
| backstage__backstage | packages/errors/src/errors | 4 | 9 | 13 | 10 | 0.769 | CustomErrorBase | no (ratio) |
| backstage__backstage | packages/backend-openapi-utils/src/schema | 2 | 11 | 7 | 3 | 0.429 | BaseParameterParser | no (ratio) |
| backstage__backstage | plugins/techdocs-node/src/stages/publish | 3 | 18 | 5 | 2 | 0.400 | ContainerClient | no (ratio) |
| backstage__backstage | plugins/events-node/src/api | 3 | 12 | 3 | 2 | 0.667 | EventRouter | no (ratio) |
| backstage__backstage | packages/frontend-plugin-api/src/components | 2 | 13 | 2 | 2 | 1.000 | Component | no (evidence) |
| calcom__cal.diy | packages/emails/templates | 50 | 51 | 50 | 25 | 0.500 | BaseEmail | no (ratio) |
| calcom__cal.diy | packages/platform/types/event-types/event-types_2024_06_14 | 3 | 8 | 28 | 2 | 0.071 | BaseEventTypeOutput_2024_06_14 | no (ratio) |
| calcom__cal.diy | packages/lib | 10 | 209 | 25 | 11 | 0.440 | Tasker | no (ratio) |
| calcom__cal.diy | packages/platform/types/bookings/2024-08-13/inputs | 3 | 17 | 10 | 2 | 0.200 | BaseBookingAttendee | no (ratio) |
| calcom__cal.diy | packages/sms/attendee | 9 | 9 | 9 | 9 | 1.000 | SMSManager | no (evidence) |
| decidim__decidim | decidim-core/app/packs/src/decidim/controllers | 29 | 56 | 29 | 29 | 1.000 | Controller | no (evidence) |
| decidim__decidim | decidim-admin/app/packs/src/decidim/admin | 3 | 37 | 3 | 3 | 1.000 | Controller | no (evidence) |
| decidim__decidim | decidim-core/app/packs/src/decidim/map | 3 | 10 | 3 | 3 | 1.000 | MapController | no (evidence) |
| decidim__decidim | decidim-comments/app/packs/src/decidim/comments | 2 | 8 | 2 | 2 | 1.000 | Controller | no (evidence) |
| decidim__decidim | decidim-assemblies/app | 1 | 6 | 1 | 1 | 1.000 | Controller | no (evidence) |
| discourse__discourse | frontend/discourse/tests/unit/lib | 10 | 106 | 120 | 69 | 0.575 | Component | no (ratio) |
| discourse__discourse | frontend/discourse/admin/routes | 118 | 119 | 118 | 78 | 0.661 | DiscourseRoute | no (ratio) |
| discourse__discourse | frontend/discourse/app/routes | 100 | 105 | 103 | 77 | 0.748 | DiscourseRoute | no (ratio) |
| discourse__discourse | frontend/discourse/admin/controllers | 74 | 74 | 74 | 60 | 0.811 | Controller | no (ratio) |
| discourse__discourse | frontend/discourse/tests/unit/lib/blocks | 5 | 13 | 73 | 64 | 0.877 | Component | no (ratio) |
| empire-flippers__client | src/components | 1 | 148 | 1 | 1 | 1.000 | React.Component | no (evidence) |
| empire-flippers__client | src/components/base | 1 | 122 | 1 | 1 | 1.000 | React.Component | no (evidence) |
| empire-flippers__client | src/router | 1 | 8 | 1 | 1 | 1.000 | React.Component | no (evidence) |
| eslint__eslint | lib/languages/js/source-code/token-store | 9 | 13 | 9 | 5 | 0.556 | Cursor | no (ratio) |
| eslint__eslint | lib/config | 3 | 5 | 6 | 5 | 0.833 | Error | no (ratio) |
| eslint__eslint | lib/linter/code-path-analysis | 1 | 7 | 5 | 5 | 1.000 | LoopContextBase | no (evidence) |
| eslint__eslint | lib | 1 | 16 | 4 | 4 | 1.000 | Error | no (evidence) |
| eslint__eslint | lib/rules/utils | 1 | 7 | 1 | 1 | 1.000 | Map | no (evidence) |
| forem__forem | app/javascript/admin/controllers | 22 | 22 | 22 | 19 | 0.864 | Controller | no (ratio) |
| forem__forem | app/javascript | 8 | 112 | 8 | 7 | 0.875 | Component | no (ratio) |
| forem__forem | app/javascript/onboarding/components | 7 | 17 | 7 | 7 | 1.000 | Component | no (evidence) |
| forem__forem | app/javascript/listings | 3 | 15 | 3 | 3 | 1.000 | Component | no (evidence) |
| forem__forem | app/javascript/listings/components | 1 | 16 | 1 | 1 | 1.000 | Component | no (evidence) |
| huginn__huginn | app/assets/javascripts/components | 1 | 6 | 1 | 1 | 1.000 | PlainJsonEditor | no (evidence) |
| instructure__canvas-lms | ui/features | 81 | 966 | 83 | 37 | 0.446 | React.Component | no (ratio) |
| instructure__canvas-lms | ui/shared | 49 | 753 | 52 | 23 | 0.442 | React.Component | no (ratio) |
| instructure__canvas-lms | ui/shared/planner/components | 28 | 89 | 28 | 23 | 0.821 | Component | no (ratio) |
| instructure__canvas-lms | ui/features/external_apps/react/components | 27 | 38 | 27 | 27 | 1.000 | React.Component | no (evidence) |
| instructure__canvas-lms | ui/features/gradebook/react/default_gradebook/components | 17 | 54 | 17 | 11 | 0.647 | React.Component | no (ratio) |
| mastodon__mastodon | app/javascript/mastodon/components | 22 | 167 | 26 | 18 | 0.692 | PureComponent | no (ratio) |
| mastodon__mastodon | app/javascript/mastodon/features | 23 | 94 | 23 | 12 | 0.522 | PureComponent | no (ratio) |
| mastodon__mastodon | app/javascript/mastodon/features/compose/components | 5 | 20 | 8 | 5 | 0.625 | PureComponent | no (ratio) |
| mastodon__mastodon | app/javascript/mastodon/features/notifications/components | 7 | 16 | 7 | 4 | 0.571 | PureComponent | no (ratio) |
| mastodon__mastodon | app/javascript/mastodon/features/report | 6 | 8 | 6 | 6 | 1.000 | PureComponent | no (evidence) |
| microsoft__vscode | src/vs/workbench/contrib | 123 | 203 | 274 | 117 | 0.427 | Action2 | no (ratio) |
| microsoft__vscode | src/vs/editor/contrib | 79 | 151 | 250 | 75 | 0.300 | EditorAction | no (ratio) |
| microsoft__vscode | src/vs/workbench/browser/parts/editor | 34 | 43 | 203 | 77 | 0.379 | Action2 | no (ratio) |
| microsoft__vscode | src/vs/workbench/contrib/chat/browser/actions | 32 | 37 | 178 | 142 | 0.798 | Action2 | no (ratio) |
| microsoft__vscode | src/vs/platform | 104 | 280 | 168 | 71 | 0.423 | Disposable | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/webpacker/controllers | 65 | 69 | 65 | 53 | 0.815 | Controller | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/components | 8 | 8 | 8 | 5 | 0.625 | Controller | no (ratio) |
| opf__openproject | frontend/src/stimulus/controllers/dynamic | 76 | 98 | 76 | 68 | 0.895 | Controller | no (ratio) |
| opf__openproject | frontend/src/app/core/apiv3/endpoints | 50 | 51 | 50 | 18 | 0.360 | ApiV3ResourceCollection | no (ratio) |
| opf__openproject | frontend/src/app/features/hal/resources | 44 | 48 | 45 | 39 | 0.867 | HalResource | no (ratio) |
| opf__openproject | frontend/src/app/features/work-packages/components | 36 | 82 | 37 | 20 | 0.541 | UntilDestroyedMixin | no (ratio) |
| opf__openproject | frontend/src/app/shared/components/fields/display/field-types | 35 | 42 | 35 | 21 | 0.600 | DisplayField | no (ratio) |
| prisma__prisma | packages/3-targets/3-targets/postgres/src/core | 11 | 32 | 80 | 30 | 0.375 | PostgresCodecDescriptor | no (ratio) |
| prisma__prisma | packages/2-sql/4-lanes/relational-core/src/ast | 4 | 9 | 59 | 22 | 0.373 | Expression | no (ratio) |
| prisma__prisma | packages/3-targets/3-targets/postgres/src/core/migrations | 3 | 23 | 36 | 33 | 0.917 | PostgresOpFactoryCallNode | no (evidence) |
| prisma__prisma | packages/3-targets/3-targets/sqlite/src/core | 6 | 21 | 24 | 9 | 0.375 | SqliteCodecDescriptor | no (ratio) |
| prisma__prisma | packages/1-framework/1-core/framework-components/test | 9 | 52 | 20 | 8 | 0.400 | RuntimeCore | no (ratio) |
| react__react | packages/react-dom/src/__tests__ | 63 | 133 | 610 | 607 | 0.995 | React.Component | yes |
| react__react | packages/react-reconciler/src/__tests__ | 46 | 77 | 335 | 308 | 0.919 | React.Component | no (evidence) |
| react__react | packages/react/src/__tests__ | 18 | 31 | 196 | 191 | 0.974 | React.Component | no (directories) |
| react__react | scripts/bench/benchmarks | 1 | 10 | 183 | 183 | 1.000 | React.Component | no (concentration) |
| react__react | packages/react-devtools-shared/src/__tests__ | 7 | 45 | 28 | 27 | 0.964 | React.Component | no (evidence) |
| storybookjs__storybook | code/core/src | 5 | 41 | 99 | 98 | 0.990 | StorybookError | no (concentration) |
| storybookjs__storybook | code/addons/docs/src/blocks/controls/react-editable-json-tree | 2 | 10 | 7 | 7 | 1.000 | Component | no (evidence) |
| storybookjs__storybook | code/core/src/common/js-package-manager | 5 | 23 | 5 | 5 | 1.000 | JsPackageManager | no (evidence) |
| storybookjs__storybook | code/frameworks/angular-vite/src/client/renderer/utils | 2 | 9 | 5 | 2 | 0.400 | BarComponent | no (ratio) |
| storybookjs__storybook | code/renderers/web-components/template | 5 | 11 | 5 | 5 | 1.000 | LitElement | no (evidence) |
| supabase__supabase | apps/studio/public/monaco-editor/vs/language | 6 | 7 | 104 | 43 | 0.413 | x | no (ratio) |
| supabase__supabase | apps/studio/public/monaco-editor/vs | 1 | 9 | 24 | 7 | 0.292 | Error | no (ratio) |
| supabase__supabase | apps/studio/components/layouts/TableEditorLayout | 1 | 10 | 11 | 10 | 0.909 | ExportAllRowsErrorFamily | no (evidence) |
| supabase__supabase | apps/docs/app/api | 1 | 15 | 6 | 4 | 0.667 | Error | no (ratio) |
| supabase__supabase | packages/ai-commands/src | 1 | 8 | 5 | 4 | 0.800 | ApplicationError | no (ratio) |
| typeorm__typeorm | src/driver | 25 | 65 | 119 | 14 | 0.118 | MongoAPIError | no (ratio) |
| typeorm__typeorm | test/github-issues | 59 | 958 | 61 | 30 | 0.492 | BaseEntity | no (ratio) |
| typeorm__typeorm | src/error | 60 | 61 | 60 | 59 | 0.983 | TypeORMError | yes |
| typeorm__typeorm | test/functional/table-inheritance/single-table | 10 | 19 | 10 | 8 | 0.800 | Person | no (ratio) |
| typeorm__typeorm | test/functional/cascades | 9 | 69 | 9 | 5 | 0.556 | BaseEntity | no (ratio) |
| vercel__next.js | packages/next/src/compiled | 45 | 160 | 407 | 52 | 0.128 | te | no (ratio) |
| vercel__next.js | packages/next/src/compiled/@edge-runtime/primitives | 4 | 19 | 121 | 42 | 0.347 | UndiciError | no (ratio) |
| vercel__next.js | turbopack/crates/turbopack-tests/tests/execution/webpack/inner-graph | 5 | 57 | 37 | 10 | 0.270 | Foo | no (ratio) |
| vercel__next.js | packages/next-codemod/transforms/__testfixtures__/url-to-withrouter | 36 | 40 | 36 | 36 | 1.000 | React.Component | yes |
| vercel__next.js | packages/next/src/server | 24 | 191 | 33 | 6 | 0.182 | Normalizers | no (ratio) |
| webpack__webpack | lib/dependencies | 102 | 139 | 105 | 33 | 0.314 | ModuleDependency | no (ratio) |
| webpack__webpack | lib/runtime | 36 | 37 | 37 | 20 | 0.541 | RuntimeModule | no (ratio) |
| webpack__webpack | test/cases/inner-graph/extend-class2 | 3 | 8 | 35 | 10 | 0.286 | Foo | no (ratio) |
| webpack__webpack | lib/errors | 28 | 29 | 28 | 25 | 0.893 | WebpackError | no (ratio) |
| webpack__webpack | test/cases/inner-graph/extend-class | 9 | 17 | 21 | 5 | 0.238 | Error | no (ratio) |

### class_base

| repo | area | applicability | langFileCount | candidates | conforming | ratio | learned | stated |
|---|---|---|---|---|---|---|---|---|
| Homebrew__brew | Library/Homebrew | 71 | 220 | 183 | 47 | 0.257 | RuntimeError | no (ratio) |
| Homebrew__brew | Library/Homebrew/rubocops | 52 | 55 | 98 | 71 | 0.724 | FormulaCop | no (ratio) |
| Homebrew__brew | Library/Homebrew/cmd | 76 | 77 | 81 | 75 | 0.926 | AbstractCommand | no (evidence) |
| Homebrew__brew | Library/Homebrew/dev-cmd | 60 | 60 | 65 | 60 | 0.923 | AbstractCommand | no (evidence) |
| Homebrew__brew | Library/Homebrew/cask/artifact | 40 | 41 | 44 | 17 | 0.386 | Moved | no (ratio) |
| alphagov__whitehall | test/unit/app/models | 139 | 139 | 145 | 141 | 0.972 | ActiveSupport::TestCase | yes |
| alphagov__whitehall | app/models | 128 | 160 | 135 | 92 | 0.681 | ApplicationRecord | no (ratio) |
| alphagov__whitehall | test/unit/app/presenters/publishing_api | 41 | 41 | 127 | 74 | 0.583 | ActiveSupport::TestCase | no (ratio) |
| alphagov__whitehall | test/functional/admin | 94 | 94 | 98 | 97 | 0.990 | ActionController::TestCase | yes |
| alphagov__whitehall | app/controllers/admin | 94 | 95 | 94 | 74 | 0.787 | Admin::BaseController | no (ratio) |
| chef__chef | lib/chef | 38 | 146 | 242 | 95 | 0.393 | RuntimeError | no (ratio) |
| chef__chef | lib/chef/resource | 186 | 196 | 187 | 130 | 0.695 | Chef::Resource | no (ratio) |
| chef__chef | spec/integration/recipes | 5 | 14 | 52 | 31 | 0.596 | BaseThingy | no (ratio) |
| chef__chef | lib/chef/provider | 47 | 50 | 47 | 23 | 0.489 | Chef::Provider | no (ratio) |
| chef__chef | lib/chef/provider/package | 36 | 40 | 41 | 32 | 0.780 | Chef::Provider::Package | no (ratio) |
| consul__consul | app/models | 73 | 101 | 73 | 67 | 0.918 | ApplicationRecord | no (evidence) |
| consul__consul | app/controllers/admin | 70 | 70 | 70 | 52 | 0.743 | Admin::BaseController | no (ratio) |
| consul__consul | app/components | 62 | 66 | 62 | 61 | 0.984 | ApplicationComponent | yes |
| consul__consul | app/components/admin | 60 | 60 | 60 | 60 | 1.000 | ApplicationComponent | yes |
| consul__consul | app/controllers | 45 | 45 | 46 | 36 | 0.783 | ApplicationController | no (ratio) |
| decidim__decidim | decidim-core/app/cells/decidim | 85 | 85 | 85 | 71 | 0.835 | Decidim::ViewModel | no (ratio) |
| decidim__decidim | decidim-core/app/models/decidim | 66 | 68 | 69 | 54 | 0.783 | ApplicationRecord | no (ratio) |
| decidim__decidim | decidim-admin/app/commands/decidim/admin | 68 | 68 | 68 | 40 | 0.588 | Decidim::Command | no (ratio) |
| decidim__decidim | decidim-core/db/migrate | 41 | 255 | 56 | 55 | 0.982 | ApplicationRecord | no (applicability) |
| decidim__decidim | decidim-core/app/controllers/decidim | 52 | 52 | 53 | 37 | 0.698 | Decidim::ApplicationController | no (ratio) |
| diaspora__diaspora | app/models | 46 | 49 | 50 | 43 | 0.860 | ApplicationRecord | no (ratio) |
| diaspora__diaspora | app/controllers | 41 | 41 | 41 | 35 | 0.854 | ApplicationController | no (ratio) |
| diaspora__diaspora | app/workers | 32 | 33 | 33 | 26 | 0.788 | BaseWorker | no (ratio) |
| diaspora__diaspora | db/migrate | 15 | 49 | 29 | 29 | 1.000 | ApplicationRecord | no (evidence) |
| diaspora__diaspora | app/presenters | 17 | 25 | 17 | 17 | 1.000 | BasePresenter | no (evidence) |
| discourse__discourse | app/models | 267 | 301 | 290 | 217 | 0.748 | ActiveRecord::Base | no (ratio) |
| discourse__discourse | app/serializers | 226 | 229 | 239 | 170 | 0.711 | ApplicationSerializer | no (ratio) |
| discourse__discourse | lib | 99 | 384 | 155 | 48 | 0.310 | StandardError | no (ratio) |
| discourse__discourse | app/jobs/scheduled | 107 | 107 | 107 | 107 | 1.000 | Jobs::Scheduled | yes |
| discourse__discourse | spec/system/page_objects/pages | 94 | 95 | 106 | 81 | 0.764 | PageObjects::Pages::Base | no (ratio) |
| empire-flippers__api | app/models | 129 | 129 | 130 | 124 | 0.954 | ApplicationRecord | yes |
| empire-flippers__api | app/services/models/listings | 122 | 150 | 122 | 122 | 1.000 | ActiveInteraction::Base | yes |
| empire-flippers__api | app/services/models | 116 | 143 | 116 | 116 | 1.000 | ActiveInteraction::Base | yes |
| empire-flippers__api | app/services/api/v1 | 79 | 81 | 79 | 79 | 1.000 | ActiveInteraction::Base | yes |
| empire-flippers__api | app/controllers/api/v1 | 65 | 65 | 65 | 55 | 0.846 | Api::V1::BaseController | no (ratio) |
| errbit__errbit | app/controllers | 12 | 13 | 13 | 9 | 0.692 | ApplicationController | no (ratio) |
| errbit__errbit | app/decorators | 8 | 8 | 8 | 8 | 1.000 | Draper::Decorator | no (evidence) |
| errbit__errbit | app/models/notification_services | 6 | 6 | 6 | 6 | 1.000 | NotificationService | no (evidence) |
| errbit__errbit | app/controllers/api/v1 | 4 | 4 | 4 | 4 | 1.000 | ApplicationController | no (evidence) |
| errbit__errbit | app/jobs | 3 | 3 | 3 | 2 | 0.667 | ApplicationJob | no (ratio) |
| fastlane__fastlane | fastlane/lib/fastlane/actions | 234 | 234 | 240 | 215 | 0.896 | Action | no (ratio) |
| fastlane__fastlane | spaceship/lib/spaceship/tunes | 42 | 53 | 44 | 38 | 0.864 | TunesBase | no (ratio) |
| fastlane__fastlane | spaceship/lib/spaceship | 5 | 23 | 23 | 14 | 0.609 | BasicPreferredInfoError | no (ratio) |
| fastlane__fastlane | trainer/lib/trainer | 1 | 8 | 16 | 10 | 0.625 | AbstractObject | no (ratio) |
| fastlane__fastlane | fastlane_core/lib/fastlane_core/ui | 8 | 13 | 15 | 4 | 0.267 | FastlaneException | no (ratio) |
| forem__forem | app/models | 126 | 142 | 132 | 119 | 0.902 | ApplicationRecord | no (evidence) |
| forem__forem | app/controllers | 105 | 105 | 107 | 93 | 0.869 | ApplicationController | no (ratio) |
| forem__forem | app/liquid_tags | 77 | 83 | 78 | 62 | 0.795 | LiquidTagBase | no (ratio) |
| forem__forem | app/controllers/admin | 56 | 56 | 56 | 55 | 0.982 | Admin::ApplicationController | yes |
| forem__forem | app/policies | 37 | 40 | 41 | 36 | 0.878 | ApplicationPolicy | no (ratio) |
| huginn__huginn | app/models/agents | 75 | 75 | 90 | 75 | 0.833 | Agent | no (ratio) |
| huginn__huginn | app/controllers | 17 | 18 | 17 | 14 | 0.824 | ApplicationController | no (ratio) |
| huginn__huginn | lib | 11 | 24 | 16 | 7 | 0.438 | Faraday::Middleware | no (ratio) |
| huginn__huginn | app/models | 10 | 10 | 12 | 10 | 0.833 | ActiveRecord::Base | no (ratio) |
| huginn__huginn | spec/concerns | 7 | 7 | 9 | 6 | 0.667 | Agent | no (ratio) |
| instructure__canvas-lms | app/models | 303 | 413 | 359 | 260 | 0.724 | ApplicationRecord | no (ratio) |
| instructure__canvas-lms | app/graphql/types | 182 | 182 | 268 | 149 | 0.556 | ApplicationObjectType | no (ratio) |
| instructure__canvas-lms | app/controllers | 242 | 261 | 250 | 225 | 0.900 | ApplicationController | no (evidence) |
| instructure__canvas-lms | app/graphql/mutations | 110 | 110 | 138 | 75 | 0.543 | Mutations::BaseMutation | no (ratio) |
| instructure__canvas-lms | lib | 64 | 259 | 104 | 30 | 0.288 | StandardError | no (ratio) |
| mastodon__mastodon | app/models | 129 | 156 | 136 | 110 | 0.809 | ApplicationRecord | no (ratio) |
| mastodon__mastodon | app/serializers/rest | 67 | 67 | 80 | 70 | 0.875 | ActiveModel::Serializer | no (ratio) |
| mastodon__mastodon | db/post_migrate | 16 | 80 | 77 | 77 | 1.000 | ApplicationRecord | no (applicability) |
| mastodon__mastodon | app/services | 68 | 79 | 74 | 67 | 0.905 | BaseService | no (evidence) |
| mastodon__mastodon | app/controllers/admin | 70 | 70 | 70 | 34 | 0.486 | BaseController | no (ratio) |
| microsoft__vscode | extensions/vscode-colorize-tests/test/colorize-fixtures | 1 | 1 | 1 | 1 | 1.000 | MsRestAzure::AzureServiceClient | no (evidence) |
| openfoodfoundation__openfoodnetwork | db/migrate | 31 | 262 | 59 | 40 | 0.678 | ActiveRecord::Base | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/models | 52 | 54 | 52 | 38 | 0.731 | ApplicationRecord | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/serializers/api/admin | 45 | 45 | 50 | 43 | 0.860 | ActiveModel::Serializer | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/models/spree | 47 | 55 | 49 | 37 | 0.755 | ApplicationRecord | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/serializers/api | 40 | 41 | 40 | 35 | 0.875 | ActiveModel::Serializer | no (ratio) |
| opf__openproject | app/services | 169 | 250 | 176 | 30 | 0.170 | BaseServices::SetAttributes | no (ratio) |
| opf__openproject | lib/api/v3 | 150 | 170 | 150 | 60 | 0.400 | API::OpenProjectAPI | no (ratio) |
| opf__openproject | app/models | 143 | 243 | 146 | 93 | 0.637 | ApplicationRecord | no (ratio) |
| opf__openproject | app/contracts | 143 | 155 | 143 | 65 | 0.455 | BaseContract | no (ratio) |
| opf__openproject | modules | 140 | 212 | 140 | 27 | 0.193 | Tables::Base | no (ratio) |
| publiclab__plots2 | test/functional | 29 | 29 | 29 | 25 | 0.862 | ActionController::TestCase | no (ratio) |
| publiclab__plots2 | app/controllers | 27 | 27 | 27 | 26 | 0.963 | ApplicationController | no (evidence) |
| publiclab__plots2 | app/models | 23 | 24 | 25 | 15 | 0.600 | ApplicationRecord | no (ratio) |
| publiclab__plots2 | test/unit | 23 | 23 | 23 | 18 | 0.783 | ActiveSupport::TestCase | no (ratio) |
| publiclab__plots2 | test/system | 21 | 21 | 21 | 21 | 1.000 | ApplicationSystemTestCase | no (evidence) |
| puppetlabs__puppet | lib/puppet/pops | 15 | 36 | 117 | 22 | 0.188 | Expression | no (ratio) |
| puppetlabs__puppet | lib/puppet | 40 | 145 | 90 | 18 | 0.200 | Error | no (ratio) |
| puppetlabs__puppet | lib/puppet/pops/types | 23 | 36 | 85 | 19 | 0.224 | PAnyType | no (ratio) |
| puppetlabs__puppet | lib/puppet/indirector | 50 | 58 | 50 | 14 | 0.280 | Puppet::Indirector::Terminus | no (ratio) |
| puppetlabs__puppet | lib/puppet/util | 24 | 91 | 46 | 5 | 0.109 | Puppet::Error | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/style | 299 | 302 | 301 | 299 | 0.993 | Base | no (directories) |
| rubocop__rubocop | lib/rubocop/cop/lint | 157 | 158 | 157 | 157 | 1.000 | Base | no (directories) |
| rubocop__rubocop | lib/rubocop/cop/layout | 100 | 100 | 100 | 100 | 1.000 | Base | yes |
| rubocop__rubocop | lib/rubocop/cop/internal_affairs | 40 | 42 | 40 | 39 | 0.975 | Base | no (evidence) |
| rubocop__rubocop | lib/rubocop/cop/naming | 19 | 19 | 19 | 19 | 1.000 | Base | no (evidence) |

### module_include

| repo | area | applicability | langFileCount | candidates | conforming | ratio | learned | stated |
|---|---|---|---|---|---|---|---|---|
| Homebrew__brew | Library/Homebrew | 57 | 220 | 66 | 47 | 0.712 | Utils::Output::Mixin | no (ratio) |
| Homebrew__brew | Library/Homebrew/cmd | 23 | 77 | 23 | 13 | 0.565 | ShellCommand | no (ratio) |
| Homebrew__brew | Library/Homebrew/unpack_strategy | 20 | 35 | 21 | 21 | 1.000 | UnpackStrategy | no (evidence) |
| Homebrew__brew | Library/Homebrew/rubocops/cask | 19 | 26 | 19 | 12 | 0.632 | CaskHelp | no (ratio) |
| Homebrew__brew | Library/Homebrew/dev-cmd | 17 | 60 | 17 | 10 | 0.588 | SystemCommand::Mixin | no (ratio) |
| alphagov__whitehall | app/models | 68 | 160 | 69 | 14 | 0.203 | PublishesToPublishingApi | no (ratio) |
| alphagov__whitehall | test/unit/app/models | 25 | 139 | 29 | 13 | 0.448 | ActionDispatch::TestProcess | no (ratio) |
| alphagov__whitehall | app/presenters/publishing_api | 25 | 40 | 28 | 22 | 0.786 | GovspeakHelper | no (ratio) |
| alphagov__whitehall | test/functional/admin | 25 | 94 | 25 | 12 | 0.480 | TaxonomyHelper | no (ratio) |
| alphagov__whitehall | app/controllers/admin | 18 | 95 | 18 | 8 | 0.444 | TranslationControllerConcern | no (ratio) |
| chef__chef | lib/chef | 46 | 146 | 49 | 15 | 0.306 | Chef::Mixin::ParamsValidate | no (ratio) |
| chef__chef | lib/chef/resource | 41 | 196 | 41 | 8 | 0.195 | Chef::Mixin::OpenSSLHelper | no (ratio) |
| chef__chef | spec/unit/mixin | 13 | 28 | 20 | 3 | 0.150 | Chef::Mixin::Properties | no (ratio) |
| chef__chef | lib/chef/win32 | 16 | 23 | 18 | 6 | 0.333 | Chef::Mixin::WideString | no (ratio) |
| chef__chef | chef-utils/lib/chef-utils/dsl | 15 | 15 | 15 | 13 | 0.867 | Internal | no (ratio) |
| consul__consul | app/models | 39 | 101 | 39 | 12 | 0.308 | Globalizable | no (ratio) |
| consul__consul | app/components/admin | 23 | 60 | 23 | 15 | 0.652 | Header | no (ratio) |
| consul__consul | app/controllers | 13 | 45 | 13 | 9 | 0.692 | FeatureFlags | no (ratio) |
| consul__consul | app/components/admin/budgets_wizard | 8 | 15 | 8 | 8 | 1.000 | Header | no (evidence) |
| consul__consul | app/components/sdg_management | 8 | 10 | 8 | 7 | 0.875 | Header | no (ratio) |
| decidim__decidim | decidim-core/lib/decidim | 45 | 204 | 45 | 13 | 0.289 | Decidim::AttributeObject::Model | no (ratio) |
| decidim__decidim | decidim-core/app/models/decidim | 39 | 68 | 39 | 15 | 0.385 | Decidim::TranslatableResource | no (ratio) |
| decidim__decidim | decidim-core/app/cells/decidim | 38 | 85 | 38 | 13 | 0.342 | Cell::ViewModel::Partial | no (ratio) |
| decidim__decidim | decidim-core/app/controllers/decidim | 34 | 52 | 34 | 11 | 0.324 | FormFactory | no (ratio) |
| decidim__decidim | decidim-admin/app/controllers/decidim/admin | 33 | 56 | 33 | 6 | 0.182 | Decidim::Admin::Concerns::HasTabbedMenu | no (ratio) |
| diaspora__diaspora | app/models | 22 | 49 | 22 | 15 | 0.682 | Diaspora::Federated::Base | no (ratio) |
| diaspora__diaspora | app/controllers/api/v1 | 5 | 16 | 5 | 2 | 0.400 | PostsHelper | no (ratio) |
| diaspora__diaspora | app/controllers | 3 | 41 | 4 | 2 | 0.500 | ApplicationHelper | no (ratio) |
| diaspora__diaspora | lib | 4 | 15 | 4 | 3 | 0.750 | Diaspora::Logging | no (ratio) |
| diaspora__diaspora | lib/archive_importer | 4 | 7 | 4 | 4 | 1.000 | Diaspora::Logging | no (evidence) |
| discourse__discourse | app/models | 66 | 301 | 69 | 11 | 0.159 | ActiveModel::Serialization | no (ratio) |
| discourse__discourse | lib/onebox/engine | 69 | 73 | 69 | 64 | 0.928 | Engine | no (evidence) |
| discourse__discourse | plugins/chat/app/services/chat | 46 | 54 | 46 | 46 | 1.000 | Service::Base | yes |
| discourse__discourse | plugins/discourse-workflows/app/services/discourse_workflows | 45 | 53 | 45 | 45 | 1.000 | Service::Base | yes |
| discourse__discourse | app/services | 44 | 127 | 44 | 38 | 0.864 | Service::Base | no (ratio) |
| empire-flippers__api | app/workers/workers | 125 | 125 | 125 | 125 | 1.000 | Sidekiq::Worker | yes |
| empire-flippers__api | app/workers/cronjobs | 70 | 70 | 70 | 70 | 1.000 | Sidekiq::Worker | yes |
| empire-flippers__api | app/workers/workers/listings | 38 | 38 | 38 | 38 | 1.000 | Sidekiq::Worker | yes |
| empire-flippers__api | app/models | 31 | 129 | 31 | 20 | 0.645 | ActiveModel::Dirty | no (ratio) |
| empire-flippers__api | app/workers/workers/amazon_sp | 25 | 25 | 25 | 25 | 1.000 | Sidekiq::Worker | no (evidence) |
| errbit__errbit | app/models | 13 | 14 | 13 | 12 | 0.923 | Mongoid::Document | no (evidence) |
| errbit__errbit | app/controllers | 3 | 13 | 3 | 2 | 0.667 | ProblemsSearcher | no (ratio) |
| fastlane__fastlane | spaceship/lib/spaceship/connect_api/models | 71 | 71 | 71 | 71 | 1.000 | Spaceship::ConnectAPI::Model | yes |
| fastlane__fastlane | trainer/lib/trainer/xcresult | 3 | 6 | 3 | 2 | 0.667 | TestCaseAttributes | no (ratio) |
| fastlane__fastlane | fastlane_core/spec | 2 | 47 | 2 | 2 | 1.000 | Commander::Methods | no (evidence) |
| fastlane__fastlane | cert | 1 | 8 | 1 | 1 | 1.000 | Commander::Methods | no (evidence) |
| fastlane__fastlane | credentials_manager | 1 | 7 | 1 | 1 | 1.000 | Commander::Methods | no (evidence) |
| forem__forem | app/workers | 87 | 95 | 88 | 88 | 1.000 | Sidekiq::Job | yes |
| forem__forem | app/liquid_tags | 19 | 83 | 19 | 9 | 0.474 | ActionView::Helpers::SanitizeHelper | no (ratio) |
| forem__forem | app/models | 17 | 142 | 18 | 6 | 0.333 | AlgoliaSearchable | no (ratio) |
| forem__forem | app/workers/articles | 16 | 17 | 16 | 16 | 1.000 | Sidekiq::Job | no (evidence) |
| forem__forem | app/workers/notifications | 16 | 16 | 16 | 16 | 1.000 | Sidekiq::Job | no (evidence) |
| huginn__huginn | app/models/agents | 50 | 75 | 51 | 16 | 0.314 | FormConfigurable | no (ratio) |
| huginn__huginn | app/concerns | 9 | 27 | 9 | 7 | 0.778 | Oauthable | no (ratio) |
| huginn__huginn | lib | 4 | 24 | 9 | 6 | 0.667 | SAXMachine | no (ratio) |
| huginn__huginn | app/controllers | 5 | 18 | 5 | 4 | 0.800 | SortableTable | no (ratio) |
| huginn__huginn | app/models | 4 | 10 | 4 | 3 | 0.750 | JsonSerializedField | no (ratio) |
| instructure__canvas-lms | app/controllers | 162 | 261 | 163 | 30 | 0.184 | HorizonMode | no (ratio) |
| instructure__canvas-lms | app/models | 157 | 413 | 159 | 74 | 0.465 | Workflow | no (ratio) |
| instructure__canvas-lms | lib/api/v1 | 104 | 115 | 104 | 89 | 0.856 | Api::V1::Json | no (ratio) |
| instructure__canvas-lms | spec/selenium | 29 | 192 | 29 | 28 | 0.966 | SeleniumDependencies | no (evidence) |
| instructure__canvas-lms | lib/cc | 26 | 53 | 27 | 10 | 0.370 | CC::CCHelper | no (ratio) |
| mastodon__mastodon | app/workers | 67 | 75 | 67 | 63 | 0.940 | Sidekiq::Worker | no (evidence) |
| mastodon__mastodon | app/models | 61 | 156 | 61 | 24 | 0.393 | Paginable | no (ratio) |
| mastodon__mastodon | app/services | 44 | 79 | 44 | 25 | 0.568 | Payloadable | no (ratio) |
| mastodon__mastodon | app/controllers | 25 | 48 | 25 | 9 | 0.360 | Authorization | no (ratio) |
| mastodon__mastodon | db/post_migrate | 22 | 80 | 22 | 18 | 0.818 | Mastodon::MigrationHelpers | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/models/spree | 14 | 55 | 14 | 3 | 0.214 | CalculatedAdjustments | no (ratio) |
| openfoodfoundation__openfoodnetwork | lib/tasks/sample_data | 13 | 15 | 13 | 13 | 1.000 | Logging | no (evidence) |
| openfoodfoundation__openfoodnetwork | app/mailers | 8 | 11 | 8 | 7 | 0.875 | I18nHelper | no (ratio) |
| openfoodfoundation__openfoodnetwork | app/controllers/api/v0 | 7 | 20 | 7 | 3 | 0.429 | PaginationData | no (ratio) |
| openfoodfoundation__openfoodnetwork | lib/reporting/reports/enterprise_fee_summary/data_representations | 7 | 8 | 7 | 4 | 0.571 | UsingEnterpriseFee | no (ratio) |
| opf__openproject | app/components | 76 | 135 | 76 | 53 | 0.697 | OpPrimer::ComponentHelpers | no (ratio) |
| opf__openproject | app/controllers | 50 | 87 | 50 | 24 | 0.480 | OpTurbo::ComponentStream | no (ratio) |
| opf__openproject | lib/api/v3 | 49 | 170 | 49 | 20 | 0.408 | API::Decorators::LinkedResource | no (ratio) |
| opf__openproject | app/models | 44 | 243 | 44 | 21 | 0.477 | Scopes::Scoped | no (ratio) |
| opf__openproject | app/models/queries/work_packages/filter | 32 | 66 | 32 | 10 | 0.313 | Queries::WorkPackages::Filter::FilterOnDirectedRelationsMixin | no (ratio) |
| publiclab__plots2 | test/functional | 7 | 29 | 7 | 4 | 0.571 | ActiveJob::TestHelper | no (ratio) |
| publiclab__plots2 | app/mailers | 6 | 6 | 6 | 6 | 1.000 | ApplicationHelper | no (evidence) |
| publiclab__plots2 | test/integration | 3 | 14 | 3 | 3 | 1.000 | ActiveJob::TestHelper | no (evidence) |
| publiclab__plots2 | test/integration/incoming_mail_parsing_test | 3 | 3 | 3 | 3 | 1.000 | ActiveJob::TestHelper | no (evidence) |
| publiclab__plots2 | test/unit | 3 | 23 | 3 | 2 | 0.667 | ActiveJob::TestHelper | no (ratio) |
| puppetlabs__puppet | lib/puppet | 36 | 145 | 43 | 8 | 0.186 | Puppet::Util | no (ratio) |
| puppetlabs__puppet | lib/puppet/util | 22 | 91 | 29 | 8 | 0.276 | Puppet::Util | no (ratio) |
| puppetlabs__puppet | benchmarks | 20 | 24 | 20 | 20 | 1.000 | FileUtils | no (evidence) |
| puppetlabs__puppet | lib/puppet/pops/types | 12 | 36 | 19 | 5 | 0.263 | Enumerable | no (ratio) |
| puppetlabs__puppet | spec/unit/pops/types | 18 | 25 | 19 | 15 | 0.789 | PuppetSpec::Compiler | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/style | 205 | 302 | 209 | 107 | 0.512 | RangeHelp | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/layout | 95 | 100 | 95 | 49 | 0.516 | RangeHelp | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/lint | 63 | 158 | 63 | 28 | 0.444 | RangeHelp | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/mixin | 18 | 81 | 19 | 8 | 0.421 | RangeHelp | no (ratio) |
| rubocop__rubocop | lib/rubocop/cop/internal_affairs | 12 | 42 | 12 | 11 | 0.917 | RangeHelp | no (evidence) |

### interface_prefix

| repo | area | applicability | langFileCount | candidates | conforming | ratio | learned | stated |
|---|---|---|---|---|---|---|---|---|
| TryGhost__Ghost | apps/admin-x-framework/src/api | 35 | 43 | 73 | 73 | 1.000 | none | no (model default) |
| TryGhost__Ghost | apps/shade/src/components/ui | 34 | 122 | 65 | 65 | 1.000 | none | no (model default) |
| TryGhost__Ghost | koenig/kg-default-nodes/src/nodes | 26 | 74 | 61 | 61 | 1.000 | none | no (model default) |
| TryGhost__Ghost | apps/shade/src/components/patterns | 12 | 28 | 47 | 47 | 1.000 | none | no (model default) |
| TryGhost__Ghost | ghost/core/core/server/services/gifts | 8 | 20 | 35 | 35 | 1.000 | none | no (model default) |
| angular__angular | packages/compiler/src/template/pipeline/ir/src | 7 | 10 | 88 | 88 | 1.000 | none | no (concentration) |
| angular__angular | packages/core/src | 20 | 75 | 78 | 78 | 1.000 | none | no (model default) |
| angular__angular | packages/compiler/src | 14 | 36 | 57 | 57 | 1.000 | none | no (model default) |
| angular__angular | packages/core/src/render3/interfaces | 11 | 21 | 57 | 31 | 0.544 | none | no (ratio) |
| angular__angular | adev/shared-docs/pipeline/api-gen/rendering | 5 | 17 | 55 | 55 | 1.000 | none | no (concentration) |
| appsmithorg__appsmith | app/client/src/widgets | 91 | 192 | 161 | 161 | 1.000 | none | no (model default) |
| appsmithorg__appsmith | app/client/src/actions | 20 | 56 | 91 | 91 | 1.000 | none | no (model default) |
| appsmithorg__appsmith | app/client/src/entities | 15 | 45 | 83 | 82 | 0.988 | none | no (model default) |
| appsmithorg__appsmith | app/client/src/ce | 16 | 30 | 79 | 78 | 0.987 | none | no (model default) |
| appsmithorg__appsmith | app/client/src/components/propertyControls | 51 | 74 | 77 | 77 | 1.000 | none | no (model default) |
| babel__babel | packages/babel-types/src | 1 | 22 | 269 | 269 | 1.000 | none | no (concentration) |
| babel__babel | packages | 47 | 282 | 59 | 59 | 1.000 | none | no (applicability) |
| babel__babel | packages/babel-parser/src | 4 | 10 | 37 | 37 | 1.000 | none | no (concentration) |
| babel__babel | packages/babel-traverse/src | 4 | 12 | 10 | 10 | 1.000 | none | no (evidence) |
| babel__babel | packages/babel-helpers/src/helpers | 8 | 95 | 9 | 9 | 1.000 | none | no (evidence) |
| backstage__backstage | packages/ui/src/components | 41 | 211 | 62 | 62 | 1.000 | none | no (applicability) |
| backstage__backstage | packages/catalog-client/src/schema/openapi/generated/models | 41 | 43 | 41 | 41 | 1.000 | none | no (model default) |
| backstage__backstage | plugins/bitbucket-cloud-common/src | 3 | 9 | 41 | 41 | 1.000 | none | no (concentration) |
| backstage__backstage | plugins/catalog-backend/src/schema/openapi/generated/models | 41 | 43 | 41 | 41 | 1.000 | none | no (model default) |
| backstage__backstage | plugins/scaffolder-backend/src/schema/openapi/generated/models | 40 | 47 | 40 | 40 | 1.000 | none | no (model default) |
| calcom__cal.diy | packages/features/webhooks/lib | 12 | 33 | 65 | 51 | 0.785 | none | no (ratio) |
| calcom__cal.diy | packages/features | 26 | 117 | 41 | 29 | 0.707 | none | no (ratio) |
| calcom__cal.diy | packages/types | 15 | 30 | 40 | 39 | 0.975 | none | no (evidence) |
| calcom__cal.diy | packages/features/watchlist/lib | 12 | 27 | 34 | 27 | 0.794 | none | no (ratio) |
| calcom__cal.diy | packages/lib | 14 | 209 | 30 | 21 | 0.700 | none | no (ratio) |
| discourse__discourse | frontend/discourse/app/lib/blocks/-internals | 16 | 25 | 48 | 48 | 1.000 | none | no (model default) |
| discourse__discourse | frontend/discourse/app/lib | 7 | 272 | 45 | 45 | 1.000 | none | no (applicability) |
| discourse__discourse | frontend/discourse/float-kit | 5 | 16 | 11 | 11 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/blocks/conditions | 7 | 8 | 10 | 10 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/static | 2 | 26 | 9 | 9 | 1.000 | none | no (evidence) |
| empire-flippers__client | src/queries | 138 | 141 | 276 | 274 | 0.993 | I | yes |
| empire-flippers__client | src/components | 102 | 148 | 167 | 156 | 0.934 | I | no (evidence) |
| empire-flippers__client | src/queries/admin | 68 | 70 | 133 | 133 | 1.000 | I | yes |
| empire-flippers__client | src/components/TaskList/tasks | 64 | 75 | 122 | 122 | 1.000 | I | yes |
| empire-flippers__client | src/components/base | 64 | 122 | 92 | 91 | 0.989 | I | yes |
| eslint__eslint | lib/types | 2 | 4 | 50 | 50 | 1.000 | none | no (concentration) |
| eslint__eslint | tests/lib | 1 | 19 | 2 | 2 | 1.000 | none | no (evidence) |
| instructure__canvas-lms | ui/features | 169 | 966 | 306 | 304 | 0.993 | none | no (applicability) |
| instructure__canvas-lms | ui/shared | 51 | 753 | 95 | 92 | 0.968 | none | no (applicability) |
| instructure__canvas-lms | ui/features/course_paces/react/components | 26 | 61 | 63 | 63 | 1.000 | none | no (model default) |
| instructure__canvas-lms | ui/shared/global/env | 37 | 39 | 55 | 55 | 1.000 | none | no (model default) |
| instructure__canvas-lms | ui/shared/assignments/react | 18 | 47 | 52 | 52 | 1.000 | none | no (directories) |
| mastodon__mastodon | app/javascript/mastodon/api_types | 21 | 21 | 87 | 87 | 1.000 | none | no (model default) |
| mastodon__mastodon | app/javascript/mastodon/components | 58 | 167 | 74 | 74 | 1.000 | none | no (model default) |
| mastodon__mastodon | app/javascript/mastodon/models | 10 | 17 | 32 | 32 | 1.000 | none | no (evidence) |
| mastodon__mastodon | app/javascript/mastodon/reducers | 17 | 43 | 32 | 32 | 1.000 | none | no (evidence) |
| mastodon__mastodon | app/javascript/mastodon/features | 17 | 94 | 24 | 23 | 0.958 | none | no (evidence) |
| microsoft__vscode | src/vscode-dts | 136 | 177 | 727 | 727 | 1.000 | none | no (model default) |
| microsoft__vscode | src/vs/platform | 139 | 280 | 577 | 527 | 0.913 | I | no (evidence) |
| microsoft__vscode | src/vs/workbench/api/common | 64 | 120 | 566 | 298 | 0.527 | none | no (ratio) |
| microsoft__vscode | src/vs/workbench/contrib/chat/common | 49 | 70 | 431 | 420 | 0.974 | I | yes |
| microsoft__vscode | src/vs/platform/agentHost/common/state/protocol | 29 | 48 | 313 | 313 | 1.000 | none | no (model default) |
| opf__openproject | frontend/src/app/core/state | 33 | 57 | 65 | 46 | 0.708 | I | no (ratio) |
| opf__openproject | frontend/src/app/features/hal/resources | 24 | 48 | 48 | 44 | 0.917 | none | no (evidence) |
| opf__openproject | frontend/src/app/shared/components | 22 | 132 | 40 | 35 | 0.875 | none | no (ratio) |
| opf__openproject | frontend/src/app/features/hal | 7 | 23 | 19 | 18 | 0.947 | none | no (evidence) |
| opf__openproject | frontend/src/app/features/work-packages/components | 11 | 82 | 18 | 17 | 0.944 | none | no (evidence) |
| prisma__prisma | packages/1-framework/1-core/framework-components/src/control | 15 | 18 | 81 | 81 | 1.000 | none | no (model default) |
| prisma__prisma | packages/1-framework/1-core/framework-components/src/shared | 13 | 17 | 81 | 81 | 1.000 | none | no (model default) |
| prisma__prisma | packages/3-extensions/sql-orm-client/src | 15 | 32 | 51 | 51 | 1.000 | none | no (directories) |
| prisma__prisma | packages/1-framework/3-tooling/cli/src/control-api/operations | 20 | 29 | 45 | 45 | 1.000 | none | no (model default) |
| prisma__prisma | packages/1-framework/3-tooling/migration/src | 19 | 33 | 38 | 38 | 1.000 | none | no (model default) |
| react__react | compiler/packages/babel-plugin-react-compiler/src | 2 | 16 | 94 | 93 | 0.989 | none | no (concentration) |
| react__react | compiler/packages | 3 | 18 | 14 | 14 | 1.000 | none | no (evidence) |
| react__react | compiler/scripts | 4 | 19 | 11 | 11 | 1.000 | none | no (evidence) |
| react__react | packages/eslint-plugin-react-hooks/src | 1 | 18 | 10 | 10 | 1.000 | none | no (evidence) |
| react__react | compiler/packages/react-mcp-server | 1 | 8 | 5 | 5 | 1.000 | none | no (evidence) |
| storybookjs__storybook | code/core/src/types/modules | 11 | 21 | 103 | 103 | 1.000 | none | no (model default) |
| storybookjs__storybook | scripts/eval/lib | 10 | 29 | 42 | 42 | 1.000 | none | no (model default) |
| storybookjs__storybook | code/core/src/components/components | 27 | 66 | 40 | 40 | 1.000 | none | no (model default) |
| storybookjs__storybook | code/core/src/csf | 6 | 13 | 34 | 33 | 0.971 | none | no (evidence) |
| storybookjs__storybook | code/core/src | 9 | 41 | 31 | 31 | 1.000 | none | no (evidence) |
| supabase__supabase | packages/common | 5 | 38 | 214 | 214 | 1.000 | none | no (concentration) |
| supabase__supabase | apps/studio/components/ui | 79 | 140 | 91 | 91 | 1.000 | none | no (model default) |
| supabase__supabase | apps/www/components | 58 | 114 | 80 | 80 | 1.000 | none | no (model default) |
| supabase__supabase | packages/ui-patterns/src | 39 | 87 | 65 | 65 | 1.000 | none | no (model default) |
| supabase__supabase | apps/docs/features/docs | 16 | 35 | 62 | 43 | 0.694 | none | no (ratio) |
| typeorm__typeorm | src/driver | 28 | 65 | 201 | 201 | 1.000 | none | no (concentration) |
| typeorm__typeorm | src/decorator/options | 26 | 26 | 26 | 26 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/metadata-args | 21 | 23 | 21 | 21 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/subscriber/event | 11 | 11 | 13 | 13 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/entity-schema | 10 | 15 | 10 | 10 | 1.000 | none | no (evidence) |
| vercel__next.js | packages/next/src/server | 32 | 191 | 74 | 74 | 1.000 | none | no (applicability) |
| vercel__next.js | examples | 35 | 1091 | 43 | 41 | 0.953 | none | no (evidence) |
| vercel__next.js | packages/next/src/server/app-render | 11 | 97 | 41 | 41 | 1.000 | none | no (applicability) |
| vercel__next.js | packages/next | 12 | 121 | 40 | 40 | 1.000 | none | no (applicability) |
| vercel__next.js | packages/next/src/server/dev | 9 | 33 | 36 | 36 | 1.000 | none | no (concentration) |
| webpack__webpack | declarations/plugins | 24 | 25 | 51 | 51 | 1.000 | none | no (model default) |
| webpack__webpack | test/configCases/typescript | 2 | 70 | 2 | 2 | 1.000 | none | no (evidence) |
| webpack__webpack | examples | 1 | 329 | 1 | 1 | 1.000 | none | no (evidence) |

### type_alias_prefix

| repo | area | applicability | langFileCount | candidates | conforming | ratio | learned | stated |
|---|---|---|---|---|---|---|---|---|
| TryGhost__Ghost | apps/admin-x-framework/src/api | 33 | 43 | 131 | 131 | 1.000 | none | no (model default) |
| TryGhost__Ghost | apps/shade/src/components/ui | 77 | 122 | 84 | 84 | 1.000 | none | no (model default) |
| TryGhost__Ghost | ghost/core/core/server/services | 20 | 181 | 75 | 75 | 1.000 | none | no (applicability) |
| TryGhost__Ghost | apps/shade/src/components/patterns | 22 | 28 | 44 | 44 | 1.000 | none | no (model default) |
| TryGhost__Ghost | ghost/core/core/server/services/machine-payments | 9 | 12 | 39 | 39 | 1.000 | none | no (authors) |
| angular__angular | packages/forms/test | 4 | 12 | 124 | 124 | 1.000 | none | no (concentration) |
| angular__angular | packages/core/src/render3/interfaces | 10 | 21 | 62 | 52 | 0.839 | none | no (ratio) |
| angular__angular | packages/router/src | 12 | 44 | 54 | 54 | 1.000 | none | no (model default) |
| angular__angular | packages/core/src | 12 | 75 | 34 | 34 | 1.000 | none | no (evidence) |
| angular__angular | packages/forms/src | 6 | 12 | 28 | 28 | 1.000 | none | no (evidence) |
| appsmithorg__appsmith | app/client/packages/design-system/ads/src | 43 | 239 | 88 | 88 | 1.000 | none | no (applicability) |
| appsmithorg__appsmith | app/client/src/workers/Evaluation/fns | 12 | 24 | 50 | 47 | 0.940 | T | no (evidence) |
| appsmithorg__appsmith | app/client/src/git/requests | 32 | 65 | 45 | 45 | 1.000 | none | no (model default) |
| appsmithorg__appsmith | app/client/packages/design-system/widgets/src/components | 34 | 176 | 37 | 37 | 1.000 | none | no (applicability) |
| appsmithorg__appsmith | app/client/src/widgets | 23 | 192 | 35 | 35 | 1.000 | none | no (applicability) |
| babel__babel | packages/babel-types/src | 7 | 22 | 73 | 72 | 0.986 | none | no (concentration) |
| babel__babel | packages/babel-core/src/config | 14 | 21 | 71 | 71 | 1.000 | none | no (model default) |
| babel__babel | packages/babel-parser/src | 8 | 10 | 60 | 60 | 1.000 | none | no (model default) |
| babel__babel | packages | 33 | 282 | 53 | 53 | 1.000 | none | no (applicability) |
| babel__babel | packages/babel-traverse/src/path | 11 | 20 | 27 | 27 | 1.000 | none | no (evidence) |
| backstage__backstage | packages/backend-openapi-utils/src/types | 7 | 8 | 74 | 74 | 1.000 | none | no (model default) |
| backstage__backstage | packages/frontend-plugin-api/src/apis/definitions | 18 | 24 | 69 | 64 | 0.928 | none | no (evidence) |
| backstage__backstage | packages/ui/src/components | 42 | 211 | 68 | 68 | 1.000 | none | no (applicability) |
| backstage__backstage | packages/core-components/src/components | 36 | 129 | 67 | 66 | 0.985 | none | no (model default) |
| backstage__backstage | packages/core-components/src/layout | 23 | 59 | 52 | 52 | 1.000 | none | no (model default) |
| calcom__cal.diy | packages/ui/components | 40 | 142 | 82 | 79 | 0.963 | none | no (evidence) |
| calcom__cal.diy | packages/lib | 39 | 209 | 81 | 80 | 0.988 | none | no (applicability) |
| calcom__cal.diy | packages/features/bookings/lib | 29 | 73 | 77 | 77 | 1.000 | none | no (model default) |
| calcom__cal.diy | packages/types | 20 | 30 | 76 | 75 | 0.987 | none | no (model default) |
| calcom__cal.diy | packages/features | 34 | 117 | 75 | 72 | 0.960 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/lib | 6 | 272 | 23 | 23 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/lib/blocks/-internals | 6 | 25 | 13 | 13 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/float-kit | 3 | 16 | 9 | 9 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/blocks/conditions | 2 | 8 | 3 | 3 | 1.000 | none | no (evidence) |
| discourse__discourse | frontend/discourse/app/static | 2 | 26 | 2 | 2 | 1.000 | none | no (evidence) |
| empire-flippers__client | src/components/base | 10 | 122 | 18 | 17 | 0.944 | T | no (evidence) |
| empire-flippers__client | src/components | 11 | 148 | 13 | 9 | 0.692 | T | no (ratio) |
| empire-flippers__client | src/types | 5 | 39 | 12 | 9 | 0.750 | T | no (ratio) |
| empire-flippers__client | src/components/Calendar | 1 | 12 | 8 | 7 | 0.875 | T | no (ratio) |
| empire-flippers__client | src/hooks | 5 | 51 | 7 | 4 | 0.571 | T | no (ratio) |
| eslint__eslint | lib/types | 2 | 4 | 62 | 62 | 1.000 | none | no (concentration) |
| eslint__eslint | tests/lib | 1 | 19 | 1 | 1 | 1.000 | none | no (evidence) |
| instructure__canvas-lms | ui/features | 106 | 966 | 213 | 213 | 1.000 | none | no (applicability) |
| instructure__canvas-lms | ui/shared | 79 | 753 | 148 | 148 | 1.000 | none | no (applicability) |
| instructure__canvas-lms | ui/features/lti_registrations/manage | 41 | 68 | 80 | 80 | 1.000 | none | no (model default) |
| instructure__canvas-lms | ui | 4 | 14 | 78 | 78 | 1.000 | none | no (concentration) |
| instructure__canvas-lms | ui/shared/grading | 14 | 48 | 73 | 73 | 1.000 | none | no (model default) |
| mastodon__mastodon | app/javascript/mastodon/components | 49 | 167 | 71 | 71 | 1.000 | none | no (model default) |
| mastodon__mastodon | app/javascript/mastodon/models | 14 | 17 | 49 | 49 | 1.000 | none | no (model default) |
| mastodon__mastodon | app/javascript/mastodon/api_types | 14 | 21 | 27 | 27 | 1.000 | none | no (evidence) |
| mastodon__mastodon | app/javascript/mastodon/features/emoji | 6 | 23 | 23 | 23 | 1.000 | none | no (evidence) |
| mastodon__mastodon | app/javascript/mastodon/components/form_fields | 18 | 25 | 18 | 18 | 1.000 | none | no (evidence) |
| microsoft__vscode | src/vs/platform/agentHost/node/codex/protocol/generated/v2 | 602 | 603 | 602 | 602 | 1.000 | none | no (authors) |
| microsoft__vscode | src/vs/workbench/api/common | 31 | 120 | 131 | 89 | 0.679 | none | no (ratio) |
| microsoft__vscode | extensions/copilot/src/platform | 44 | 223 | 124 | 115 | 0.927 | none | no (evidence) |
| microsoft__vscode | src/vs/base/common | 38 | 120 | 120 | 110 | 0.917 | none | no (evidence) |
| microsoft__vscode | src/vs/platform | 58 | 280 | 110 | 88 | 0.800 | none | no (ratio) |
| opf__openproject | frontend/src/app/shared/components | 14 | 132 | 18 | 17 | 0.944 | none | no (evidence) |
| opf__openproject | frontend/src/app/shared/helpers | 5 | 40 | 14 | 14 | 1.000 | none | no (evidence) |
| opf__openproject | frontend/src/app/features/work-packages/components | 9 | 82 | 10 | 10 | 1.000 | none | no (evidence) |
| opf__openproject | frontend/src/stimulus/controllers/dynamic | 6 | 98 | 9 | 9 | 1.000 | none | no (evidence) |
| opf__openproject | frontend/src/stimulus/controllers/dynamic/sortable-lists | 5 | 12 | 8 | 8 | 1.000 | none | no (evidence) |
| prisma__prisma | test/integration/test/ports/prisma/functional | 111 | 321 | 1622 | 1622 | 1.000 | none | no (model default) |
| prisma__prisma | test/integration/test/ports/prisma/functional/relation-mode-gh-1-to-1/_fixture | 16 | 24 | 248 | 248 | 1.000 | none | no (model default) |
| prisma__prisma | test/integration/test/ports/prisma/functional/relation-mode-gh-1-to-n/_fixture | 16 | 24 | 248 | 248 | 1.000 | none | no (model default) |
| prisma__prisma | packages/3-extensions/sql-orm-client/test | 31 | 71 | 235 | 235 | 1.000 | none | no (model default) |
| prisma__prisma | packages/2-sql/2-authoring/contract-ts/src | 13 | 17 | 227 | 227 | 1.000 | none | no (directories) |
| react__react | compiler/packages/babel-plugin-react-compiler/src/HIR | 20 | 30 | 195 | 191 | 0.979 | none | no (concentration) |
| react__react | packages/react-devtools-shared/src/devtools/views/Components | 40 | 48 | 95 | 95 | 1.000 | none | no (model default) |
| react__react | packages/react-reconciler/src | 27 | 65 | 50 | 50 | 1.000 | none | no (directories) |
| react__react | compiler/packages/babel-plugin-react-compiler/src | 7 | 16 | 44 | 44 | 1.000 | none | no (model default) |
| react__react | packages/react-devtools-shared/src | 9 | 23 | 44 | 44 | 1.000 | none | no (concentration) |
| storybookjs__storybook | code/core/src/types/modules | 11 | 21 | 123 | 123 | 1.000 | none | no (model default) |
| storybookjs__storybook | code/core/src/shared/open-service | 20 | 45 | 120 | 120 | 1.000 | none | no (model default) |
| storybookjs__storybook | agent-eval/evals | 58 | 118 | 61 | 61 | 1.000 | none | no (authors) |
| storybookjs__storybook | code/core/src/csf | 6 | 13 | 60 | 58 | 0.967 | none | no (evidence) |
| storybookjs__storybook | code/renderers/vue3/src | 12 | 25 | 54 | 54 | 1.000 | none | no (model default) |
| supabase__supabase | apps/studio/data | 190 | 260 | 555 | 521 | 0.939 | none | no (model default) |
| supabase__supabase | apps/studio/data/database | 29 | 31 | 107 | 107 | 1.000 | none | no (model default) |
| supabase__supabase | apps/studio/data/storage | 35 | 40 | 101 | 101 | 1.000 | none | no (model default) |
| supabase__supabase | apps/studio/data/organizations | 30 | 33 | 84 | 84 | 1.000 | none | no (model default) |
| supabase__supabase | apps/studio/data/replication | 26 | 31 | 78 | 78 | 1.000 | none | no (model default) |
| typeorm__typeorm | src/driver | 4 | 65 | 144 | 144 | 1.000 | none | no (concentration) |
| typeorm__typeorm | src/driver/types | 8 | 12 | 26 | 26 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/find-options | 8 | 14 | 13 | 13 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/common | 8 | 9 | 9 | 9 | 1.000 | none | no (evidence) |
| typeorm__typeorm | src/metadata/types | 9 | 10 | 9 | 9 | 1.000 | none | no (evidence) |
| vercel__next.js | packages/next/src/server | 47 | 191 | 151 | 150 | 0.993 | none | no (applicability) |
| vercel__next.js | packages/next/src/lib/metadata | 13 | 29 | 142 | 142 | 1.000 | none | no (model default) |
| vercel__next.js | packages/next/src/server/app-render | 36 | 97 | 133 | 133 | 1.000 | none | no (model default) |
| vercel__next.js | packages/next/src/shared/lib | 27 | 110 | 129 | 129 | 1.000 | none | no (applicability) |
| vercel__next.js | turbopack/crates | 15 | 71 | 93 | 93 | 1.000 | none | no (applicability) |
| webpack__webpack | declarations/plugins | 14 | 25 | 52 | 52 | 1.000 | none | no (model default) |
| webpack__webpack | test/configCases/typescript | 4 | 70 | 4 | 4 | 1.000 | none | no (evidence) |
| webpack__webpack | test/configCases/library | 2 | 138 | 3 | 3 | 1.000 | none | no (evidence) |
| webpack__webpack | test/configCases/typescript/basic | 1 | 8 | 1 | 1 | 1.000 | none | no (evidence) |

All five spread, which is what step 3 asks. The ratio is a point ratio over the area's own sites,
so the 0.90 in each sentence is the gate the ratio has to clear before any interval is computed.

- **extends_base** spreads from 0.071 to 1.000 over 111 areas of 24 repositories, 73 of them under
  0.90, and it states on one area each of Ghost, discourse, react, typeorm and next.js.
- **class_base** spreads from 0.109 to 1.000 over 96 areas of 20 repositories, 65 of them under
  0.90, and it states on 19 areas of nine Ruby repositories, seven of those empire-flippers/api's.
- **module_include** spreads from 0.150 to 1.000 over 92 areas of 19 repositories, 66 of them under
  0.90, and it states on 7 areas of four repositories: three of empire-flippers/api's worker
  directories, two of discourse's service directories, forem's `app/workers` and fastlane's
  `spaceship` models. Before change 13 it stated on two, for the reason that change records.
- **interface_prefix** spreads from 0.527 to 1.000 over 95 areas of 20 repositories, 9 of them
  under 0.90, and it states on 14 areas of vscode and 6 of the client. 33 more areas cleared every
  gate and print counts because `none` is what the model writes anyway.
- **type_alias_prefix** spreads from 0.571 to 1.000 over 96 areas of 20 repositories, 7 of them
  under 0.90, and it states nowhere: 33 areas cleared the gates and every one of them learned
  `none`, which is the model default.

Nothing stating `type_alias_prefix` is the row working rather than the row broken. A `T` prefix on a
type alias is rare, `none` is the model default for the row, and a repository that prefixes nothing
prints counts instead of a sentence nobody needs.

`module_include` was the finding this audit was for, and change 13 above is what came of it. The row
counted include sites rather than class bodies, so on empire-flippers/api, where every worker
includes `Sidekiq::Worker` and one more module, `app/workers/workers` scored 125 of 234 and
`app/workers/cronjobs` exactly one half. Two includes per class pinned it there whatever the
repository did. The counts line kept printing throughout, which is what made the threshold
auditable and what let this section find it.

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
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 has a namesake test under cypress/integration/components; 66 sibling modules named index/schema/types; 117 files inline a helper
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

- test: 40 node:test specs and 4 other
- lib: 42 .mjs, 1 .json; 29 of 42 have a namesake test under test
- scripts: 12 .mjs; 4 of 12 have a namesake test under test
- docs: 15 .md
- .github: 5 .yml, 3 .md
- commands: 3 .md
- and 17 more files in directories under the floor
- tests: 40 node:test specs under test; 29 of 42 .mjs files have a namesake test

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

- ghost/core: 2093 .js, 384 .ts and 192 other; 806 test files; 20 vitest specs; 1 chai spec under public; 4 of 1396 have a namesake test
- apps: 914 .tsx (JSX), 751 .js and 1575 other; 231 vitest specs; 119 test files; 113 mocha specs; 31 playwright specs under e2e; 11 chai specs under editor; 33 of 738 have a namesake test under apps; 1014 sibling modules named index/eslint.config/vite.config; 321 files inline a helper
- koenig: 484 .ts, 287 .tsx (JSX) and 236 other; 109 test files; 60 playwright specs; 15 vitest specs under unit; 44 of 304 have a namesake test; 325 sibling modules named index/eslint.config/vitest.config; 87 files inline a helper
- e2e: 98 playwright specs, 64 test files and 139 other
- packages/i18n/locales: 311 .json
- and 412 more files in directories under the floor
- tests: 1099 test files; 278 vitest under apps; 189 playwright; and 3 more; 4 of 1396 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## alphagov__whitehall

```
## What lives where

- test: 538 minitest specs, 82 test files and 146 other
- app/models: 238 .rb, 7 .json; 140 of 238 have a namesake test under test/unit/app/models
- db: 223 .rb, 2 .csv and 3 other; 0 of 223 have a namesake test
- features: 96 .rb, 55 .feature; 1 test file under support; 2 of 95 have a namesake test under test
- app/controllers/admin: 95 .rb; 91 of 95 have a namesake test under test/functional/admin
- app/presenters/publishing_api: 66 .rb; 61 of 66 have a namesake test under test/unit/app/presenters/publishing_api
- app/helpers: 52 .rb; 31 of 52 have a namesake test under test/unit/app/helpers
- and 8 more directories holding 1018 files
- tests: 538 minitest specs under test; 101 test files under test; 5 RSpec under test/unit/app/helpers; 140 of 238 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## angular__angular

```
## What lives where

- packages/core: 1086 .ts, 82 .bazel and 84 other; 268 test files; 71 of 818 have a namesake test under packages/core/test
- adev/src/content: 612 .ts, 384 .md and 837 other; 24 test files under src; 7 of 588 have a namesake test under adev/src/content
- packages/compiler-cli: 535 .ts, 118 .bazel and 28 other; 37 test files under test; 25 of 498 have a namesake test
- packages/compiler: 292 .ts, 8 .bazel and 4 other; 50 test files; 29 of 242 have a namesake test under packages/compiler/test
- packages/zone.js: 215 .ts, 38 .js and 65 other; 103 test files; 1 vitest spec under vitest; 14 of 117 have a namesake test under packages/zone.js/test
- devtools/projects: 256 .ts, 106 .bazel and 150 other; 68 test files; 61 of 188 have a namesake test under devtools/projects
- adev/shared-docs: 136 .mts, 86 .ts and 230 other; 51 test files; 6 of 105 have a namesake test; 173 sibling modules named index/builder/defaults; 3 files inline a helper
- and 11 more directories holding 3170 files
- tests: 1006 test files; 10 Cypress under devtools/cypress/integration; 1 vitest under packages/zone.js/test/vitest; 71 of 818 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## appsmithorg__appsmith

```
## What lives where

- app/client: 3661 .ts, 2926 .svg and 3734 other; 835 Cypress specs; 554 test files; 12 playwright specs; 1 jest spec under ctl; 228 of 2888 have a namesake test under app/client; 2982 sibling modules named index/types/constants; 504 files inline a helper
- app/server: 2077 .java, 169 .json and 128 other
- deploy: 54 .sh, 32 .yaml and 105 other; 1 vitest spec under tests
- and 201 more files in directories under the floor
- tests: 835 Cypress specs under app/client/cypress/e2e/Regression/ClientSide; 554 test files under app/client/src; 12 playwright under app/client/playwright; and 2 more; 228 of 2888 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## babel__babel

```
## What lives where

- packages/babel-helpers: 93 .ts, 37 .js and 17 other; 1 test file under unittests; 0 of 93 have a namesake test
- packages/babel-types: 95 .ts, 20 .js and 4 other; 20 test files; 1 of 95 has a namesake test under packages/babel-types/test
- packages/babel-parser/test/expressions/esprima: 109 .js, 109 .json and 1 other; 0 of 109 have a namesake test
- packages/babel-runtime-corejs3/helpers/esm: 95 .js, 1 .json; 2 of 95 have a namesake test under packages/babel-plugin-transform-regenerator/test
- packages/babel-core: 54 .ts, 22 .js and 4 other; 20 test files under test; 0 of 53 have a namesake test
- eslint: 34 .ts, 21 .js and 18 other; 10 test files; 1 of 34 has a namesake test under eslint/babel-eslint-parser/test
- packages/babel-traverse: 36 .ts, 19 .js and 4 other; 18 test files under test; 1 of 35 has a namesake test under packages/babel-traverse/test
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

- apps: 969 .ts, 595 .tsx (JSX) and 478 other; 66 test files; 65 vitest specs; 51 playwright specs under playwright; 2 jest specs under v2; 36 of 802 have a namesake test under apps; 810 sibling modules named route/[trpc]/index; 142 files inline a helper
- packages/features: 901 .ts, 64 .tsx (JSX) and 16 other; 199 vitest specs; 3 test files under __tests__; 136 of 703 have a namesake test under packages/features; 703 sibling modules named types/index/tokens; 17 files inline a helper
- packages/app-store: 680 .ts, 184 .json and 699 other; 33 vitest specs; 2 playwright specs under tests; 1 test file under __tests__; 25 of 647 have a namesake test under packages/app-store; 647 sibling modules named index/add/zod; 5 files inline a helper
- packages/trpc/server/routers/viewer: 345 .ts, 20 .tsx; 26 vitest specs; 22 of 319 have a namesake test under packages/trpc/server/routers/viewer
- packages/platform: 267 .ts, 81 .tsx (JSX) and 59 other; 6 playwright specs; 3 vitest specs under __tests__; 1 test file under tests; 3 of 258 have a namesake test; 266 sibling modules named index/types/permissions; 16 files inline a helper
- packages/ui/components: 140 .tsx (JSX), 63 .ts and 14 other; 26 vitest specs; 8 test files; 9 of 108 have a namesake test under packages/ui/components; 62 sibling modules named index/types/dateRangeLogic; 24 files inline a helper
- packages/lib (files at this level): 146 .ts, 4 .json and 4 other; 22 vitest specs; 21 of 124 have a namesake test under packages/lib; 124 sibling modules named array/availability/buildCalEventFromBooking; 1 file inlines a helper
- and 4 more directories holding 1643 files
- tests: 431 vitest specs under packages; 79 test files under apps; 72 playwright; and 1 more; 36 of 802 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## chef__chef

```
## What lives where

- spec: 655 RSpec specs, 4 test files and 463 other
- lib/chef: 797 .rb, 12 .erb and 2 other; 499 of 797 have a namesake test under spec/unit
- kitchen-tests: 66 .rb, 6 .yml and 16 other; 19 RSpec specs; 0 of 47 have a namesake test
- chef-utils: 37 .rb, 4 (none) and 2 other; 14 RSpec specs under dsl; 0 of 23 have a namesake test
- chef-config: 20 .rb, 3 (none) and 1 other; 6 RSpec specs under unit; 0 of 14 have a namesake test
- .expeditor: 17 .sh, 11 .ps1 and 13 other
- docs/dev: 39 .md
- and 1 more directory holding 113 files
- tests: 694 RSpec specs under spec; 5 test files under spec/unit; 499 of 797 .rb files have a namesake test

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

- decidim-core: 1917 .rb, 379 .erb and 547 other; 684 RSpec specs; 57 test files; 257 of 1233 have a namesake test under decidim-core/spec
- decidim-admin: 482 .rb, 184 .erb and 159 other; 211 RSpec specs; 3 test files; 98 of 271 have a namesake test under decidim-admin/spec
- decidim-proposals: 466 .rb, 86 .erb and 109 other; 205 RSpec specs; 93 of 261 have a namesake test under decidim-proposals/spec
- decidim-meetings: 443 .rb, 100 .erb and 110 other; 180 RSpec specs; 1 test file under public_participants; 51 of 263 have a namesake test under decidim-meetings/spec
- decidim-initiatives: 374 .rb, 83 .yml and 93 other; 149 RSpec specs; 72 of 225 have a namesake test under decidim-initiatives/spec
- decidim-participatory_processes: 367 .rb, 83 .yml and 63 other; 141 RSpec specs; 33 of 226 have a namesake test under decidim-participatory_processes/spec
- decidim-conferences: 356 .rb, 83 .yml and 87 other; 159 RSpec specs; 41 of 197 have a namesake test under decidim-conferences/spec
- and 18 more directories holding 4896 files
- tests: 2610 RSpec specs; 68 test files under decidim-core/app/packs/src/decidim; 257 of 1233 .rb files have a namesake test

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

- plugins: 4330 .rb, 4072 .yml and 2758 other; 1675 RSpec specs; 217 qunit specs; 1 test file under routes; 725 of 2655 have a namesake test
- spec: 1680 RSpec specs, 7 test files and 498 other
- frontend/discourse: 1907 .js, 1678 .gjs and 167 other; 456 qunit specs; 9 test files; 14 of 1448 have a namesake test under spec
- db/migrate: 1735 .rb, 1 .json; 7 of 1735 have a namesake test under spec/db/migrate
- migrations: 392 .rb, 11 (none) and 24 other; 72 RSpec specs; 28 of 320 have a namesake test under migrations/tooling/spec
- app/models: 379 .rb; 209 of 379 have a namesake test under spec/models
- lib (files at this level): 253 .rb; 186 of 253 have a namesake test under spec/lib
- and 5 more directories holding 3371 files
- tests: 3432 RSpec specs; 674 qunit; 18 test files; and 3 more; 725 of 2655 .rb files have a namesake test

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
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 has a namesake test under cypress/integration/components; 66 sibling modules named index/schema/types; 117 files inline a helper
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

- spec: 100 RSpec specs, 1 test file and 33 other
- config: 31 .rb, 6 .yml; 2 of 31 have a namesake test under spec
- app/models: 20 .rb; 18 of 20 have a namesake test under spec/models
- app/controllers: 18 .rb; 16 of 18 have a namesake test under spec/controllers
- app/decorators: 8 .rb; 8 of 8 have a namesake test under spec/decorators
- app/helpers: 8 .rb; 4 of 8 have a namesake test under spec/helpers
- app/interactors: 7 .rb; 7 of 7 have a namesake test under spec/interactors
- and 7 more directories holding 297 files
- tests: 100 RSpec specs under spec; 1 test file under spec/models; 2 of 31 .rb files have a namesake test

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
- lib/languages/js: 17 .js; 1 of 17 has a namesake test under tests/lib/languages/js
- and 10 more directories holding 830 files
- tests: 359 test files under tests/lib/rules; 8 chai under tests; 1 Cypress; 301 of 305 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## fastlane__fastlane

```
## What lives where

- fastlane: 504 .rb, 53 .png and 134 other; 194 RSpec specs under actions_specs; 28 of 310 have a namesake test under fastlane/spec
- spaceship: 312 .rb, 9 .md and 10 other; 104 RSpec specs; 2 test files under tunes; 87 of 206 have a namesake test under spaceship/spec
- fastlane_core: 107 .rb, 7 .json and 6 other; 45 RSpec specs under spec; 27 of 62 have a namesake test under fastlane_core/spec
- match: 52 .rb, 4 .gif and 8 other; 21 RSpec specs under spec; 22 of 31 have a namesake test under match/spec
- deliver: 41 .rb, 7 .mp4 and 13 other; 15 RSpec specs under spec; 15 of 26 have a namesake test under deliver/spec
- snapshot: 36 .rb, 22 .json and 58 other; 9 RSpec specs under spec; 9 of 27 have a namesake test under snapshot/spec
- precheck: 28 .rb, 2 .md and 5 other; 7 RSpec specs under rules; 6 of 21 have a namesake test under precheck/spec
- and 7 more directories holding 718 files
- tests: 449 RSpec specs; 2 test files under spaceship/spec/tunes; 28 of 310 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## forem__forem

```
## What lives where

- spec: 1271 RSpec specs and 131 other
- db/migrate: 949 .rb; 0 of 949 have a namesake test
- app/javascript: 321 .jsx (JSX), 297 .js and 33 other; 152 test files under __tests__; 66 of 240 have a namesake test; 220 sibling modules named index/actions/actionsPanel; 71 files inline a helper
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
- config: 35 .rb, 4 .yml; 1 of 35 has a namesake test under spec
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

- ui: 3609 .tsx (JSX), 1865 .js and 4601 other; 3235 test files under __tests__; 110 vitest specs under __tests__; 2 jest specs under test-utils; 1241 of 2361 have a namesake test; 2417 sibling modules named index/types/utils; 1506 files inline a helper
- spec: 2731 RSpec specs, 1 test file and 474 other
- gems: 687 .rb, 180 .json and 397 other; 239 RSpec specs; 137 of 448 have a namesake test
- lib: 808 .rb, 20 .rake and 22 other; 463 of 808 have a namesake test under spec/lib
- app/models: 688 .rb; 516 of 688 have a namesake test under spec/models
- packages/canvas-rce/src/rce/plugins: 163 .jsx (JSX), 154 .js and 136 other; 188 test files under __tests__; 55 of 83 have a namesake test; 152 sibling modules named plugin/index/utils; 67 files inline a helper
- app/graphql: 390 .rb, 5 .md; 232 of 390 have a namesake test under spec/graphql
- and 8 more directories holding 4982 files
- tests: 3519 test files under ui; 2970 RSpec under spec; 125 vitest under ui; and 1 more; 1241 of 2361 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## mastodon__mastodon

```
## What lives where

- spec: 1099 RSpec specs and 141 other
- app/javascript: 432 .tsx (JSX), 341 .svg and 775 other; 24 test files; 2 vitest specs; 1 of 429 has a namesake test under app/javascript/mastodon/components/__tests__; 325 sibling modules named index/accounts/notifications; 177 files inline a helper
- db/migrate: 535 .rb; 0 of 535 have a namesake test
- app/controllers: 338 .rb; 37 of 338 have a namesake test under spec/controllers
- app/models: 248 .rb; 150 of 248 have a namesake test under spec/models
- app/lib: 167 .rb; 119 of 167 have a namesake test under spec/lib
- app/serializers: 144 .rb; 84 of 144 have a namesake test under spec/serializers
- and 5 more directories holding 5626 files
- tests: 1099 RSpec specs under spec; 24 test files under app/javascript/mastodon; 2 vitest under app/javascript/mastodon; 1 of 429 .tsx files has a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## microsoft__vscode

```
## What lives where

- src/vs: 8225 .ts, 430 .css and 675 other; 1670 test files; 1043 of 6555 have a namesake test
- extensions: 3165 .ts, 1066 .json and 1190 other; 406 vitest specs under test; 150 test files under test; 77 mocha specs; 16 node:test specs under test; 7 chai specs under test; 1 playwright spec under test; 312 of 2549 have a namesake test; 2644 sibling modules named index/esbuild/utils; 47 files inline a helper
- src/vscode-dts: 177 .ts, 1 .md; 0 of 177 have a namesake test
- test: 116 .ts, 32 .json and 53 other; 33 test files; 22 playwright specs under src; 10 mocha specs
- and 582 more files in directories under the floor
- tests: 1858 test files under src/vs; 406 vitest under extensions/copilot/src; 87 mocha under extensions; and 3 more; 1043 of 6555 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## openfoodfoundation__openfoodnetwork

```
## What lives where

- spec: 655 RSpec specs, 31 test files and 193 other
- db/migrate: 262 .rb; 6 of 262 have a namesake test under spec/migrations
- app/models: 175 .rb, 1 (none); 100 of 175 have a namesake test under spec/models
- engines: 162 .rb, 6 .js and 18 other; 60 RSpec specs; 44 of 102 have a namesake test under engines/dfc_provider/spec
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

- modules: 4029 .rb, 2982 .yml and 771 other; 1406 RSpec specs; 8 test files; 662 of 2623 have a namesake test
- spec: 2630 RSpec specs, 5 test files and 472 other
- app/models: 988 .rb, 5 .yml and 4 other; 423 of 988 have a namesake test under spec/models
- app/components: 574 .rb, 412 .erb and 55 other; 168 of 574 have a namesake test under spec/components
- frontend/src/app/features: 527 .ts, 121 .html and 54 other; 22 test files; 2 vitest specs; 24 of 503 have a namesake test under frontend/src/app/features
- app/services: 479 .rb; 263 of 479 have a namesake test under spec/services
- lib/api/v3: 442 .rb; 137 of 442 have a namesake test under spec/lib/api/v3
- and 8 more directories holding 7948 files
- tests: 4036 RSpec specs; 106 test files under frontend/src; 73 vitest under frontend/src; 662 of 2623 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## prisma__prisma

```
## What lives where

- packages/1-framework: 839 .ts, 57 .json and 115 other; 318 vitest specs under test; 2 test files under shared; 140 of 519 have a namesake test
- test/integration/test: 686 .ts, 199 .md and 326 other; 338 vitest specs
- packages/2-sql: 562 .ts, 37 .json and 28 other; 273 vitest specs under test; 40 of 289 have a namesake test
- packages/3-targets: 533 .ts, 25 .json and 14 other; 268 vitest specs under test; 8 of 265 have a namesake test
- packages/3-extensions: 377 .ts, 49 .json and 22 other; 177 vitest specs under test; 30 of 200 have a namesake test under packages/3-extensions/sql-orm-client/test
- examples: 311 .ts, 95 .json and 133 other; 46 vitest specs under test; 1 test file under test; 1 of 265 has a namesake test under examples/retail-store/test; 268 sibling modules named contract.d/prisma.config/db; 7 files inline a helper
- packages/2-mongo-family: 305 .ts, 42 .json and 19 other; 128 vitest specs under test; 37 of 177 have a namesake test
- and 7 more directories holding 1380 files
- tests: 1626 vitest specs; 28 node:test under scripts; 4 test files; 140 of 519 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## publiclab__plots2

```
## What lives where

- test: 75 minitest specs, 34 test files and 3 other
- db/migrate: 103 .rb, 1 .unused; 0 of 103 have a namesake test
- app/assets: 45 .js, 22 .css and 13 other; 3 of 45 have a namesake test under spec
- config: 37 .rb, 22 .yml and 11 other; 1 of 37 has a namesake test under test/integration
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

- lib/puppet: 1009 .rb, 5 .erb and 4 other; 633 of 1009 have a namesake test under spec/unit
- spec/unit: 676 RSpec specs, 4 test files and 5 other
- acceptance: 255 .rb, 59 (none) and 12 other; 3 RSpec specs under acceptance; 2 test files under windows; 7 of 250 have a namesake test under spec
- spec/integration: 69 RSpec specs
- spec/lib: 38 .rb; 1 RSpec spec under matchers
- benchmarks: 49 .erb, 24 (none) and 34 other
- references: 40 .md
- and 183 more files in directories under the floor
- tests: 761 RSpec specs under spec/unit; 6 test files; 633 of 1009 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## react__react

```
## What lives where

- compiler: 223 .ts, 120 .rs and 230 other; 24 test files under __tests__; 2 playwright specs; 1 node:test spec under __tests__; 0 of 205 have a namesake test; 242 sibling modules named index/tsup.config/types.d; 8 files inline a helper
- scripts: 161 .js, 6 .md and 29 other; 13 test files under __tests__; 1 of 148 has a namesake test under scripts/error-codes/__tests__; 149 sibling modules named build/benchmark/index; 0 files inline a helper
- packages/react-devtools-shared/src/devtools/views: 149 .js (JSX), 80 .css; 1 of 149 has a namesake test under packages/react-devtools-inline/__tests__/__e2e__; 27 sibling modules named utils/constants/types; 43 files inline a helper
- packages/react-devtools-shared/src/hooks/__tests__/__source__/__compiled__: 144 test files and 67 other
- packages/react-dom/src/__tests__: 133 test files
- packages/react: 76 .js, 6 .ts and 3 other; 31 test files under __tests__; 1 of 51 has a namesake test under packages/react-devtools-shared/src/hooks/__tests__/__source__; 51 sibling modules named compiler-runtime/index/jsx-dev-runtime; 2 files inline a helper
- packages/react-reconciler/src (files at this level): 82 .js; 1 of 82 has a namesake test under packages/react-reconciler/src/forks
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
- spec/support: 28 .rb; 6 RSpec specs
- lib/rubocop/formatter: 22 .rb; 21 of 22 have a namesake test under spec/rubocop/formatter
- relnotes: 291 .md
- and 2 more directories holding 252 files
- tests: 764 RSpec specs under spec/rubocop/cop; 1 test file under spec/core_ext; 676 of 803 .rb files have a namesake test

Match sibling test shape; skip tests where siblings have none.
```

## storybookjs__storybook

```
## What lives where

- code: 3104 .ts, 785 .tsx (JSX) and 1607 other; 710 vitest specs; 33 playwright specs under e2e-sandbox; 23 test files under rules; 2 chai specs under test; 1 node:test spec under cli; 567 of 2383 have a namesake test under code; 2559 sibling modules named index/types/input.stories; 250 files inline a helper
- agent-eval: 89 .ts, 78 .tsx and 138 other; 53 vitest specs; 1 of 36 has a namesake test under agent-eval; 48 sibling modules named main/vitest.config/preview; 0 files inline a helper
- scripts: 164 .ts, 8 .js and 20 other; 31 vitest specs; 3 test files under tasks; 1 playwright spec under bench; 31 of 130 have a namesake test under scripts
- test-storybooks: 82 .ts, 51 .tsx (JSX) and 267 other; 8 playwright specs under e2e-tests; 7 vitest specs under tests; 4 test files under stories; 3 Cypress specs; 1 jest spec under stories; 0 of 64 have a namesake test; 99 sibling modules named main/preview/vite.config; 11 files inline a helper
- docs: 684 .md, 183 .mdx and 217 other
- and 120 more files in directories under the floor
- tests: 801 vitest specs under code; 42 playwright; 30 test files; and 4 more; 567 of 2383 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## supabase__supabase

```
## What lives where

- apps: 3874 .tsx (JSX), 3306 .png and 6691 other; 544 vitest specs; 147 of 3698 have a namesake test under apps; 2250 sibling modules named keys/index/route; 844 files inline a helper
- examples: 216 .ts, 174 .png and 1044 other; 11 test files; 8 of 206 have a namesake test under examples; 266 sibling modules named index/next.config/vite.config; 19 files inline a helper
- packages/ui-patterns/src: 134 .tsx (JSX), 68 .ts and 31 other; 21 vitest specs; 11 of 122 have a namesake test under packages/ui-patterns/src; 59 sibling modules named index/types/utils; 37 files inline a helper
- packages/ui: 129 .tsx (JSX), 18 .svg and 27 other; 7 vitest specs; 5 of 123 have a namesake test under packages/ui; 16 sibling modules named index/assets.d/clipboard; 13 files inline a helper
- and 1039 more files in directories under the floor
- tests: 617 vitest specs under apps/studio; 53 playwright under e2e/studio; 11 test files under examples/user-management; and 1 more; 147 of 3698 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## typeorm__typeorm

```
## What lives where

- test: 2748 .ts, 8 .json and 1 other; 667 chai specs; 277 test files; 1 mocha spec under 4956
- src/driver: 90 .ts; 0 of 90 have a namesake test
- packages/codemod: 78 .ts, 5 .json and 6 other; 15 chai specs; 9 of 63 have a namesake test under packages/codemod/test
- src/decorator: 69 .ts; 0 of 69 have a namesake test
- src/error: 61 .ts; 1 of 61 has a namesake test under test/functional/database-schema/custom-constraint-names/index
- src/query-builder: 39 .ts; 1 of 39 has a namesake test under test/functional/database-schema/custom-constraint-names/index
- docs: 76 .md, 12 .svg and 26 other; 4 sibling modules named databases/docusaurus.config/redirects; 2 files inline a helper
- and 323 more files in directories under the floor
- tests: 684 chai specs under test; 277 test files under test; 1 mocha under test/github-issues/4956; 0 of 90 .ts files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## vercel__next.js

```
## What lives where

- test: 4964 .js (JSX), 4402 .tsx and 4149 other; 1851 test files; 67 playwright specs; 2828 sibling modules named next.config/route/page; 755 files inline a helper
- turbopack/crates: 2194 .js, 781 .rs and 1472 other; 251 test files under input; 3 of 1943 have a namesake test; 2087 sibling modules named input/index/output; 3 files inline a helper
- examples: 959 .tsx (JSX), 751 .js and 2247 other; 14 test files; 5 vitest specs; 3 Cypress specs under e2e; 3 playwright specs under e2e; 7 of 946 have a namesake test under examples; 756 sibling modules named next.config/index/postcss.config; 97 files inline a helper
- crates/next-custom-transforms/tests: 810 .js, 86 .stderr and 45 other; 0 of 810 have a namesake test; 637 sibling modules named output/input/output-default; 34 files inline a helper
- packages/next/src/compiled: 684 .js, 145 .json and 168 other; 0 of 684 have a namesake test
- packages/next/src/server: 536 .ts, 36 .tsx and 5 other; 78 test files; 77 of 458 have a namesake test under packages/next/src/server; 463 sibling modules named index/utils/types; 5 files inline a helper
- packages/next-codemod/transforms/__testfixtures__: 238 .tsx, 159 .js and 100 other; 0 of 238 have a namesake test; 202 sibling modules named next.config/cloudinary-loader/eslint.config; 14 files inline a helper
- and 2 more directories holding 3559 files
- tests: 2307 test files under test; 79 playwright under test; 29 vitest under evals/evals; and 2 more; 3 of 1943 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

## webpack__webpack

```
## What lives where

- test: 10418 .js, 814 .css and 1413 other; 2607 test files
- lib: 651 .js, 1 .svg; 8 of 651 have a namesake test under test
- examples: 453 .js, 181 .md and 118 other; 1 of 453 has a namesake test under test; 450 sibling modules named build/webpack.config/example; 0 files inline a helper
- and 315 more files in directories under the floor
- tests: 2608 test files under test; 8 of 651 .js files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```
