# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `lib/parse.mjs` drives both parsers and decides once what an unread file means. The scan and the
  check each drove them separately, so the four causes were computed on one path and none of them on
  the other, and every fix to the reconciliation had to be made twice. The engine split, the scratch
  directory a caller holding blobs rather than files needed, and the per-dimension loop that was
  copied into both bridges all sit behind one entry point now. One guarantee that was previously
  written out twice: a dimension that throws on an odd tree costs its own count and not the file.

## [0.1.8] - 2026-08-15

An architecture pass over the pipeline's seams, and the ten defects it found on the way. Every one is
a place two modules held one piece of knowledge and had already drifted apart, and seven of them are
the same failure: reporting a clean result for work that never ran.

### Fixed

- `check` reported that it found nothing when it could not parse anything. With no `node_modules` it
  emitted one caveat per file and exited 0, which the command file tells the agent means the check
  ran; `scan` had raised the install error since 0.1.6, on the same condition, from the same parse
  record. Both commands now fail with the same message.
- `check` folded four different reasons a file went unexamined into one sentence. Syntax the parser
  rejected is the branch's own code to go and look at; a file this tool could not read is not. The
  scan has named the two apart since 0.1.6.
- `check` ran every Rails claim on repositories holding no Rails. It never asked which frameworks the
  corpus shows, so `zone_aware_time` reached a plain-Ruby branch as a NIT, which is the measured
  symptom that C8 was written to stop and that the scan stopped in 0.1.6.
- A pattern with no `*.` in it lost its leading `**` to the encoder's markdown-bullet rule, so a
  `Rakefile` delivery glob rendered as `/Rakefile` and matched nothing.
- The CLI summary and the overview each spelled the size cap their own way, under a comment claiming
  the two could not drift. One builder now writes both, which also groups the four unexamined-file
  lines together in the summary: the size-cap line used to print after the unread-history line and
  now prints with its siblings.
- A diff git refused to produce came back as an empty change list, so `check` examined no file,
  raised no finding and said nothing about it, which renders exactly like a branch that broke
  nothing. Both the changed-file list and the added-line ranges now report it. Base resolution and
  the pending-edits listing still read their output unguarded, which is what keeps F15 `partial`.
- A missing `ruby` looked exactly like a repository full of files that crash: `ruby.mjs` never
  marked an absent interpreter, so the guard above, which reads that flag, could not see it and a
  Ruby-only branch still reported that it found nothing. Both parser bridges now draw the same line
  between an install problem and a bad file, which fixes the same hole in `scan`.
- The framework probe could refuse the whole run. Listing the corpus throws when git will not answer,
  and that was the first read in `check` that could stop a report rather than qualify it. It now
  reads the answer the scan already stored in the map, so a mapped repository does no work at all,
  and a corpus that will not list costs the framework's claims and a caveat instead of the run.
- With a map from a newer schema, the report printed `capped by this run: no map on disk` above a
  note saying the map is a schema this build cannot read. The first was false and pointed at the
  wrong fix.

### Changed

- One git runner, in `lib/git.mjs`, carrying the timeout and the byte cap for the buffered reads in
  `baseline.mjs` and `check.mjs`. There were four runners, with three different timeouts and one with
  none at all; `corpus.mjs` still keeps its own, and the streamed reads are untouched by design. The
  `--name-status -z` record grammar was three hand-rolled state machines and is now one parser.
- `lib/facts.mjs` owns the machine record's shape: the schema version, reading it, and which of a
  dimension's two sentences an area was handed. The version lived in the writer, the rule for reading
  an older record was copied into two modules, and the reader never looked at the version at all. It
  does now, and refuses a version past its own rather than reading unknown fields positionally.
- One slot's verdict is assembled in one place. The gate battery, the population blocks and the
  invariant that a blocked slot closes *both* of its sides were spread across three modules, and
  nothing short of a full repository could reach the assembly to test it.
- Measuring the baseline moved behind the baseline module's own seam, with the parser and the
  reducer handed in. The scan was reaching into the population record's internals to do it.

### Removed

- `lib/forge.mjs`, a `gh` measurement helper that shipped in the package and was imported by nothing.
  It was the only code in the published plugin that touched the network.

## [0.1.7] - 2026-08-14

Measured against 35 public and private repositories, 186,917 tracked source files. Nine issues, each
with the measurement that forced it in `DECISIONS.md`.

### Fixed

- JSX in a `.js` file was handed to the TypeScript grammar, where `<div` opens a type assertion. 727
  of react/react's 2,296 files and 3,924 of next.js's 21,358 were counted from a recovered tree, and
  nothing reported it. The parser buffer is now named after the file's real extension. react goes
  from 51 stated claims to 66, and its `assertion_style` count from 906 sites to 13,737. Always
  asking for the JSX grammar is not the fix: `<string>x` is legal in `.ts` and a syntax error in
  `.tsx`.
- Both parser bridges computed a syntax-error count that nothing read, so a file the parser rejected
  was charged as examined and its recovery walked as if it were the file. oxc recovers to an almost
  empty program and silently drops sites out of the denominator; prism recovers further and answered
  a *conforming* site from a method with no body. Such a file is now unread, and reported as its own
  line on both surfaces.
- A file uncovered because its area counted nothing was reported as "too few per directory", which
  was only ever true of a directory below the floor. A scan with no ruby printed that sentence beside
  "202 files could not be parsed". The two causes are named apart.
- `git log -M` scores similarity, which needs blob content a `--filter=blob:none` clone does not
  hold, so the author pass fetched from the promisor one round trip at a time. 33 of 35 measured
  clones could not answer at all and reported history unread. A partial clone now uses `-M100%` and
  refuses to lazy-fetch: 40 seconds and no history becomes 386ms, 8,527 files and 333 authors. A full
  clone is untouched.
- A run whose parser never answered for a whole language deleted the map it could not rebuild.
  `env -i PATH=/usr/bin:/bin` on a Rails repository removed three correct area files in the same run
  that reported it could not read them. Such a run now writes nothing, removes nothing, and says
  which language went unread.

### Added

- `.mts`, `.cts`, `Rakefile`, `Gemfile`, `config.ru`, `*.gemspec` and `*.jbuilder`: 803 files in the
  corpus that both parsers already read and nothing counted. `.rbi` stays out, because a Sorbet
  signature describes types rather than anything anyone wrote. An area holding a file whose name
  carries no extension gets one delivery pattern per such name, so it is not counted and then never
  delivered.
- `test_cases`, `testdata`, `test-data`, `golden`, `goldens`, `__mocks__` and `mocks` to the excluded
  directories: 2,218 files across the corpus. angular keeps 2,010 files of golden compiler output
  under `test_cases`, which was 55 of its 339 areas and every one of its 476 unparseable files.
  `examples` is deliberately left in, at 8,967 paths, because much of it is maintained code.
- A dimension may declare the framework its claim belongs to, and is offered only where the corpus
  shows that framework. `zone_aware_time` has no counter-claim, so off-Rails it could only ever print
  zero, and did: 123 sites on Homebrew, 197 on puppet, 97 on fastlane, 96 on chef, plus a NIT
  delivered onto a plain-Ruby branch. 141 such slots are gone. The signal is `app/models/`,
  `db/migrate/` or `config/application.rb` in the corpus, which separates 14 Rails repositories from
  5 plain across the 19 measured.

### Changed

- A file-to-file obligation learns its companion root from the corpus instead of declaring it.
  alphagov/whitehall keeps model tests under `test/unit/app/models` and read `0 of 160 sites, 117
  with a namesake elsewhere in the tree`; it now reads `117 of 160 sites`. discourse answers its
  controllers in `spec/requests`, which no hardcoded pair reaches. The declared pair remains the
  prior: a tie learns nothing, and where no companion lines up at all it stands unchanged, which is
  what keeps the honest zero for a repository that writes specs and none for its models.

## [0.1.6] - 2026-08-14

### Added

- File-to-file obligations: a dimension whose site is the file, asking whether a file of one shape
  ships with its companion. Nine ship, all Ruby: a model, service, job, worker, controller,
  serializer or rake task with its spec, and a model or job with its minitest test. They are counted
  over the corpus and need no parser, so a companion that fails to parse still answers.
- A companion audit beside every obligation, because a ratio of zero has two meanings. Measured on
  alphagov/whitehall: the `app/models` area scores 0 of 160 while 117 of those models have a test one
  directory deeper. Without it the row reads "this repository does not test its models".
- A repository is asked an obligation only for a companion suffix it uses. Producers exist whatever it
  tests with, so counting the RSpec and the minitest row together put a line that can only read zero
  into every Rails map.
- `check` reports an obligation the branch broke. It iterated dimensions that run against a parsed
  program, and an obligation has none, so a stated claim it could not run came back clean.

### Changed

- `scripts/check-docs.mjs` counts obligations, and reads only the unreleased section of this file.
  A released entry states the number that shipped in it and stays true; reading the whole changelog
  made every past release a claim about today, so the first number that ever changed failed three
  entries that were correct.

## [0.1.5] - 2026-08-14

An area's `paths` now matches the files its counts were taken over, and no others. Every area file
is rewritten by the next scan; `facts.json` moves to schema 3, where `glob` becomes `globs`.

### Fixed

- An ancestor area's glob matched its descendants, so a claim a deeper area had been refused was
  delivered to it anyway. `app/workers/workers/**` matched `app/workers/workers/google`, whose own
  area measured the same dimension at 14 of 22 and was suppressed by the ratio gate; the ancestor's
  directive, counted over 125 files that do not include any of google's, arrived on every read there
  and contradicted it. The gates decide where a claim may be stated and the delivery channel was
  walking around them. An area sharing a root with a deeper area now emits either one glob per
  directory it holds files in, or one recursive glob and a negation per foreign subtree, whichever is
  shorter. Measured on a 5,495-file Rails repository, 156 areas: 37 areas over-reached, by 2,425
  files in the worst case; the rewritten map is exact on all 857,220 file-area pairs, costs 298
  patterns in total, and leaves the other 119 areas on the single glob they had before.
- A file that no area holds no longer receives an ancestor's directives either. That covers the two
  ways a file ends up uncovered: every directory above it fell below the floor, and the area ceiling
  hosting an area at a directory whose own files were already orphaned. Checked over every layout of
  0 to 2 files across a six-directory tree, at every floor from 1 to 3 and every ceiling from 1 to 4:
  8,736 layouts, 102,815 file-area pairs, none mismatched.
- The README's line for keeping the map out of git failed inside a linked worktree, where `.git` is a
  file holding a gitdir pointer and `.git/info/exclude` is not a path. It now writes to
  `$(git rev-parse --git-common-dir)/info/exclude`, which is shared by the main checkout and every
  linked worktree.

### Changed

- `scan` prints the root it resolved to. A path argument picks the repository and not a subtree,
  because `git rev-parse --show-toplevel` resolves any path inside a repository to its root, so
  `scan ./packages/api` in a monorepo maps the monorepo. That is what areas, the pin and the baseline
  need; the output just never said so.
- A scan of a repository with no tracked source says how many source files are untracked, in the
  summary and in the overview. The corpus is tracked files by design, and a repository whose first
  commit has not landed used to get an empty map, exit 0 and an overview reporting that 0 files were
  uncovered. The count applies every filter the corpus does, since it is printed beside an
  instruction to commit those files and scan again.
- `npm run check:docs` checks the number of rows in `DECISIONS.md` against the three files that state
  it, and rejects a duplicate row number. All three had drifted apart.
- Rendering an area with no `paths` glob throws instead of writing one. Measured: a `paths` key with
  no pattern under it loads the file on every turn, which is the opposite of what an area file is.

## [0.1.4] - 2026-08-14

### Changed

- The overview names only the areas that state something, at every repository size. It used to name
  every area below 200 and apply that rule only above the limit. Measured on a 5,489-file Rails repo,
  143 of 151 areas stated nothing, so 89% of a file that loads on every turn carried a directory name
  and a file count `ls` already gives. Rebuilt at that shape the listing is 1,030 bytes against 8,576.
  Nothing moves out of reach: a counts-only area keeps its own path-scoped file, which still loads
  when one of its files is read, and the `## Areas (n)` heading still counts every area.

## [0.1.3] - 2026-08-14

`check` now says when it read nothing. Repositories with a dirty working tree at the moment the
command runs, which is most of them, get a `note:` line they did not get before.

### Fixed

- `check` reported a clean result for work that was still only in the working tree, and the caveat
  written to describe exactly that could never fire for it. The dirty set was intersected with the
  committed diff, so a path had to be committed before it could be called uncommitted. Untracked and
  staged-but-uncommitted work now produces the note, which is the state a branch is usually in when
  `check` runs.
- A rename counted twice and under a name three characters short. `status --porcelain -z` writes the
  origin path as a bare field after the record, and reading it as another record both double-counted
  the rename and mangled the path. The intersection had been hiding this.

## [0.1.2] - 2026-08-14

Documentation only. No behaviour changed, and the shipped files are the README, the changelog and
`DECISIONS.md`.

### Fixed

- The gate table in `docs/how-it-works.md` described gates the code stopped reading. There is no
  `candidates >= 6` gate: the Wilson bound subsumed it, and at 0.90 a perfect record needs 35 sites.
  `concentration` is the inverse-Simpson count of files plus the ratio with the largest file dropped,
  not a share of candidates. `applicability` is the stricter of a square root and a quarter of the
  files the dimension can speak about, not the quarter alone. The `authors` bar is `min(2, repository
  authors)`. `evidence` and `history-unread` were missing entirely.
- `DECISIONS.md` rows C4, D2 and D3 stated the thresholds the specification promised rather than the
  ones the gates read, which is the one thing that file's status column exists to prevent.
- The encoder section claimed the claim text goes through the encoder. It stopped, because stripping
  `|` rendered "defaults are taken with ??, not ||" as "defaults are taken with ??, not" in every
  JavaScript area of every repository. The README sample still showed that truncated output.
- The dimension table in `docs/how-it-works.md` listed 21 of the 31 dimensions that ship, missing the
  five React ones and the five Rails migration ones.
- The area floor and ceiling are step functions of the corpus size, not the fixed 5 and 120 the
  README and `docs/why.md` described.
- `CONTRIBUTING.md` gave a dimension template with no `counterClaim`, which `npm run check:docs`
  rejects, and named three of the five registry files.
- Counts of the rows in `DECISIONS.md` (48, now 54), the supported version in `SECURITY.md`, the
  command count in the README, and the `CHANGELOG` compare links for 0.1.1.

### Added

- `CONTEXT.md`, the glossary. It splits three words that each carried more than one meaning in the
  code: `directive` is any stated sentence, and `Pin`, `Population` and `Baseline` are the three
  things previously all called baseline.
- `CLAUDE.md` and `docs/agents/`, which record where issues live, the triage label vocabulary, and
  that `DECISIONS.md` stands in for `docs/adr/`.

## [0.1.1] - 2026-08-14

### Fixed

- Ruby 3.4 is the floor, not 3.3. The parser child rejects `prism` below 1.0 by version, because a
  rescue chain links through `consequent` rather than `subsequent` there and a constant path through
  `child` rather than `name`. Nothing raises; every Ruby count comes back zero. Ruby 3.3 ships
  `prism` 0.19, so the documented requirement was wrong for every user who met it.
- The Ruby child carries `%SystemRoot%` on Windows. A replaced environment without it cannot start
  a side-by-side assembly, so the interpreter never ran and the whole Ruby tier was unreachable.
- The repository root is resolved to a real native path in `gitRoot`. git prints forward slashes on
  Windows and can print a short 8.3 form where the filesystem holds a long one, and every path
  downstream is joined against this value and compared with it.
- The resident-memory guard stands down on Windows, where there is no `ps`, instead of failing to
  read one. A runaway parse is caught by the five-second timeout there. `wmic`, which is what the
  usual replacement shells out to, is removed in Windows 11 25H2.

### Added

- Windows is tested rather than declared out of scope: the suite on Node 22 and 24, and an
  end-to-end `scan`, `pin` and `check` against a real repository, alongside Linux and macOS.
- The overview's byte-stability across two scans of unchanged source is checked end to end, not only
  in a renderer unit test.
- Coverage is measured and enforced at 95% lines, 87% branches, 95% functions.
- A documentation check that compares every claim the prose makes which the code also makes: the
  dimension counts, the gate names, the command surface, and the version across three files.
- CodeQL with the `security-extended` suite, dependency review on pull requests, a runtime `npm
  audit`, a check that installing runs no scripts, and an OpenSSF Scorecard.

## [0.1.0] - 2026-08-13

First release. `DECISIONS.md` is the build contract and records which decisions are complete and
which are partial; several listed there are not implemented yet.

### Added

- `scan`: one pass over the repository that groups tracked source files into per-directory areas,
  counts a fixed set of claims in each area, and writes the result to `.claude/rules/anatomiya-*.md`
  plus a machine copy at `.claude/anatomiya/facts.json`. Files are written to a temp path and
  renamed, so a crash cannot leave half a file.
- `pin`: accepts the current file population as the baseline every gate reads, and prints which
  files enter and leave it. Without one, claims are measured against the working tree and no `check`
  finding can exceed FIX.
- `check`: which counted conventions the current branch broke. Changed files come from a three-dot
  diff against the merge base, findings are matched between HEAD and the merge base by content
  fingerprint so pre-existing violations are not reported as new, and severity is MUST-FIX, FIX or
  NIT. Nothing blocks; a stale map or a missing merge base caps severity at FIX rather than refusing
  to run.
- The counted-claim model. Every claim carries `applicability` (files where the construct appears),
  `candidates` (sites in those files) and `conforming`. The ratio is over candidates, never over
  file count, and applicability is printed beside the area's file count so a wrongly narrow
  predicate is visible. Counting conforming *files* instead of *sites* was measured flipping 10 of
  39 verdicts, in both directions.
- Gates that decide whether a claim is stated as a directive, all but the first relative to the
  repository being scanned: the conforming rate is at or above 0.90; the Wilson 95% lower bound on
  the same counts also reaches 0.90, so a perfect record needs 35 sites before it may be stated; the
  sites are worth at least 3 files by inverse-Simpson count and the rate survives dropping the
  largest file; the predicate applies to at least the greater of a square root and a quarter of the
  area; and the area carries two distinct authors, or one where the repository has only one. A gated
  claim still prints its counts and the name of the gate that stopped it. 0.90 is fixed and does not
  move with the repository: it is the definition of a convention, and a bar that adapted would let a
  repository with weak habits manufacture the evidence it is then judged against.
- Inverse conventions. A repository that consistently does the opposite of a claim has a convention,
  not an absence, and 12 of the 31 dimensions may state theirs. The other 19 may not, each for a
  recorded reason: the inverse is an absence, a defect, flat everywhere, or resting on a predicate
  too weak to trust twice. A stated inverse clears the same 0.90 and the same evidence bound on its
  own side, and `check` enforces whichever sentence the area was handed.
- 31 dimensions: 15 for JavaScript, 20 reachable in JSX, 11 for Ruby. 12 are marked `precise` and 19
  `partial`, and a partial dimension can never reach top severity. They cover error handling, absent
  values, typing, module and import shape, test style, Rails models and services, the React surface,
  and Rails schema and migrations.
- JavaScript and TypeScript parsing through `oxc-parser` in a pool of warm child processes, with a
  4 MB file cap, a 5 s timeout and a 1 GB RSS poll per file. A parser crash costs one file and the
  worker is replaced. The dimensions run inside the worker and only counts cross the channel: they
  are 85% of the scan's CPU, and running them in the parent held throughput to 2.8x on eleven cores
  however many workers ran.
- Ruby parsing through `prism` in a streaming subprocess: paths on stdin, one JSON object per line,
  an idle timeout rather than a whole-run one, and a stripped environment so `RUBYOPT` cannot inject
  a `-r`.
- Corpus collection from `git ls-files -z`: tracked files only, NUL-split, deny list for secrets,
  vendor and fixture directories excluded, lexical plus realpath containment on every path. No cap
  on repository size; a synthetic 100,000-file repository scans in about 9 seconds.
- One encoder for every repository-controlled value that reaches a generated file: printable
  allowlist, NFKC, mixed-script paths rejected, markdown structure stripped, capped on grapheme
  clusters before quoting.
- Author counts from a single `git log -M --no-merges --name-status` pass, read off the stream,
  instead of per-file `git blame`. History git could not read is reported rather than counted as
  zero authors.
- Baseline pinning in `.claude/anatomiya/baseline.json`: per-area file lists at a pinned sha, read
  back with `git cat-file` only for the files that differ from the working tree, sha reachability
  checked before use, and a printed population delta on re-pin.
- Three slash commands, `/anatomiya:scan`, `/anatomiya:check` and `/anatomiya:pin`, all of which read
  generated files with `cat` rather than the Read tool, because reading a context file suppresses its
  automatic injection for the rest of the session.
- The overview file is byte-stable between scans with no source change: no timestamps, no durations,
  no counts that move per commit.
- Plugin and marketplace manifests under `.claude-plugin/`, and `npm run validate` to check they
  parse and that the directory holds nothing else.

### Known limits

- The map loads when the agent reads a file or an `@file` mention names it. It does not load on
  grep, glob, `cat` through bash, or an edit with no prior read.
- JavaScript, TypeScript and Ruby only. `.erb` and other templates never reach a parser.
- Most slots print as counts rather than stating. Across ten measured repositories, 333 of 3,847
  dimension slots stated anything at all, which is the gates working rather than failing.
- No hooks, no MCP server, no skill, no score or grade. `DECISIONS.md` records why.
- No claim that this catches defects. Measured across ten repositories, 1 of 317 defect review
  comments was preventable by a conventions map.

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/crisnahine/anatomiya/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/crisnahine/anatomiya/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/crisnahine/anatomiya/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/crisnahine/anatomiya/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/crisnahine/anatomiya/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/crisnahine/anatomiya/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/crisnahine/anatomiya/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/crisnahine/anatomiya/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.1.0
