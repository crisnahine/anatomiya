# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/crisnahine/anatomiya/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/crisnahine/anatomiya/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/crisnahine/anatomiya/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.1.0
