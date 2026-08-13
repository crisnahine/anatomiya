# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.1.0
