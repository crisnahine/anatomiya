# The code index, `find` in the reuse check, and a check that asked twice

Date: 2026-10-28. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.312. Model Claude Haiku 5.5
at medium effort, alternating, each session from a clean checkout: 10 per arm for the builds on the way,
20 for the build that ships.

## What was measured

Four of the 0.19.0 reuse tasks, chosen for cost: the two where the arm with anatomiya missed most
(mastodon's link policy at 11 of 20, eslint at 17 of 20), gitea, where the arm without did better,
and atuin, the Rust task. Three builds ran, each frozen as a copy before its first session:

| build | what it held |
|---|---|
| first | the index, and one sentence naming `find` appended to the measured reason |
| second | `find` in place of the grep sentence (A124) |
| third | the second, and A125: a turn the check's background result opens is the check's own fix |

## Results

| task | first | second | third | 0.19.0 (Claude Code 2.1.310, 20 per arm) |
|---|---|---|---|---|
| atuin `uuid_v7` | 10/10, $0.0170 | not run | 10/10, $0.0135 | 19/20, $0.0169 |
| eslint `unIndent` | 9/10, $0.0207 | 10/10, $0.0242 | 9/10, $0.0193 | 17/20, $0.0199 |
| gitea `db.GetEngine` | 9/10, $0.0135 | 9/10, $0.0137 | 10/10, $0.0123 | 18/20, $0.0114 |
| mastodon `TagManager#local_url?` | 6/10, $0.0228 | 4/10, $0.0249 | 8/10, $0.0160 | 11/20, $0.0175 |

Sessions with anatomiya that called the helper, and the mean cost of one. Every build's sessions are in
`data/2026-10-28-code-index-first-*`, `data/2026-10-28-code-index-second-*` and, for the third,
`data/2026-10-28-code-index-<task>-haiku-5-5.json`. The arm without anatomiya
called it 0, 0, 10 and 0 of 10 times on the third build, as on 0.19.0. Each third-build task has its own
page beside this one, `2026-10-28-code-index-<task>-haiku-5-5.md`, with every session in `data/`.

On the third build, 37 of 40 sessions called the helper, against 65 of 80 on 0.19.0, and the mean
session cost $0.0153 against $0.0164. Ten sessions per arm cannot tell those apart from chance, and the
two runs sit on different Claude Code builds, so this says the third build held the 0.19.0 result at
about its cost, not that it improved it.

## The build that ships, twenty per arm

The final tree, after every review round, frozen as a copy and run on all four tasks at 20 sessions per
arm on the same Claude Code 2.1.312:

| task | with anatomiya | mean cost | without | 0.19.0 with |
|---|---|---|---|---|
| atuin `uuid_v7` | 20/20 | $0.0133 | 0/20 | 19/20, $0.0169 |
| eslint `unIndent` | 20/20 | $0.0197 | 0/20 | 17/20, $0.0199 |
| gitea `db.GetEngine` | 18/20 | $0.0124 | 20/20 | 18/20, $0.0114 |
| mastodon `TagManager#local_url?` | 9/20 | $0.0173 | 0/20 | 11/20, $0.0175 |

67 of 80 sessions called the helper, against 65 of 80 on 0.19.0, and the mean of the task means is
$0.0157 against $0.0164. No task's difference from 0.19.0 is one twenty sessions can tell from chance,
mastodon's 9 against 11 included, so this says the shipped build holds the 0.19.0 result at a little
less cost. The claude.ai usage limit ended the last four atuin trials and the last two eslint trials of
each arm before they finished; every trial from the first one it ended was dropped in both arms and run
again on the same frozen build, and the two runs joined with `--from-raw`.

Mastodon's check asks for one helper, `TagManager#local_url?`, and a session can reach for another that
also exists. Read off the `app/lib/link_policy.rb` each session left, 19 of 20 sessions on this build
called an existing `TagManager` helper: 9 `local_url?` and passed, 1 `local_url?` beside a domain read of
its own, 4 `ActivityPub::TagManager#local_uri?` and 5 another `TagManager` method; 1 wrote its own host
comparison. On 0.19.0 it was 18 of 20 (11, 5 and 2), with 2 writing their own. The 9 against 11 is which
of two existing helpers a session picked, not whether it reused one. Each task's page is
`2026-10-28-code-index-final-<task>-haiku-5-5.md`, with every session in
`data/2026-10-28-code-index-final-<task>-haiku-5-5.json`.

## One task per language, on the build after the PR review

The five per-language tasks of 0.19.0 not run above, on the tree after the PR review's fixes (commit
4bb0227b), frozen as a copy, Haiku 5.5 at 10 sessions per arm on Claude Code 2.1.312:

| task | with anatomiya | mean cost | without | 0.19.0 with (20 per arm) |
|---|---|---|---|---|
| CTFd `admins_only` (Python) | 10/10 | $0.0228 | 8/10 | 20/20, $0.0245 |
| BookStack `Role::getSystemRole` (PHP) | 10/10 | $0.0106 | 9/10 | 20/20, $0.0115 |
| DolphinScheduler `JSONUtils.parseObject` (Java) | 10/10 | $0.0148 | 10/10 | 19/20, $0.0135 |
| Bitwarden `CoreHelpers.GenerateComb` (C#) | 10/10 | $0.0172 | 10/10 | 20/20, $0.0178 |
| KotlinConf `PreviewHelper` (Kotlin) | 10/10 | $0.0176 | 9/10 | 20/20, $0.0183 |

50 of 50 sessions with anatomiya called the helper the repository had, against 46 of 50 without, at
less than 0.19.0 cost on four of the five. With the four tasks above, all nine languages the plugin reads
were run on this branch. Each task's page is `2026-10-28-code-index-final-<task>-haiku-5-5.md`.

## Opus 5.5 on the four tasks

The same four tasks on the final tree (commit aad4f66c), frozen as a copy, Claude Opus 5.5 at medium
effort, 10 sessions per arm on Claude Code 2.1.312:

| task | with anatomiya | mean cost | without | 0.19.0 with (20 per arm) |
|---|---|---|---|---|
| atuin `uuid_v7` | 10/10 | $0.3769 | 0/10 | 20/20, $0.3900 |
| eslint `unIndent` | 10/10 | $0.4117 | 1/10 | 17/20, $0.4866 |
| gitea `db.GetEngine` | 10/10 | $0.2693 | 10/10 | 20/20, $0.3124 |
| mastodon `TagManager#local_url?` | 10/10 | $0.3012 | 5/10 | 20/20, $0.3366 |

40 of 40 sessions with anatomiya called the helper, against 16 of 40 without and 77 of 80 on 0.19.0,
and each task cost less than on 0.19.0: $0.3398 a session against $0.3814 over the four, 11% less.
Each task's page is `2026-10-28-code-index-final-<task>-opus-5-5.md`.

## How many hits, and how many calls

The third build printed twelve hits and asked for one call per idea, and its subagent spent more tokens
than a check with no index. Two more builds ran on the same Claude Code, on mastodon's link policy and
eslint, 10 sessions per arm, each frozen before its first session:

| build | hits | mean session cost | subagent fresh input, median | subagent output, median | subagent tool calls |
|---|---|---|---|---|---|
| no index in the reason (A123 wording, A125) | 16/20 | $0.0171 | 43,410 and 68,801 | 11,487 and 17,006 | 8 and 10 |
| third: twelve hits, one call per idea | 17/20 | $0.0177 | 56,336 and 57,195 | 13,069 and 14,001 | 7.5 and 7.5 |
| shipped: six hits, at most three calls | 18/20 | $0.0164 | 33,145 and 37,955 | 7,594 and 11,689 | 6 and 6.5 |

Each pair is eslint, then mastodon. Hits are summed over both tasks and cost is the mean of the two
tasks' means. Every session is in `data/2026-10-28-code-index-no-finder-*`, `data/2026-10-28-code-index-shipped-*`
and the third build's files, and the token medians in `data/2026-10-28-reuse-search-tokens.json`, read off
the usage Claude Code records on every subagent turn. The shipped build is the third with `find` printing
six hits, its doc sentence capped at 60 characters, and the reason asking for at most three calls.

## Why the first two builds cost more

The first two builds cost more than 0.19.0 on three of four tasks, and the reason was not the index.
Read off every captured session (a script over the transcripts Claude Code keeps per trial, recorded in
`data/2026-10-28-background-subagents.json`), 15 of 19 mastodon sessions on the first two builds ran
two or more subagents, against 27 of 174 on 0.19.0. Claude Code 2.1.312 runs a subagent in the
background by default: 81 of 101 sessions saw a task notification, against 261 of 1,020 on 2.1.310. The check's search returned as a
notification, which opens a turn of its own; the session wrote its fix there, and the stop after it
read the fix as new work and asked again. A125 records that turn instead. Replayed on a captured
mastodon transcript cut at the stop that asked again, the rule reads it as the check's own, and on the
third build 40 of 40 sessions across the four tasks ran one search.

## What changed in the tree after the runs

The twenty-per-arm run above is of the final tree, so nothing below is missing from it. The shipped build was first measured on two of the four tasks. Before it, review fixes landed in
seven plugin files that the third build's sessions did not see: `find` counts each word once in its
best place (19 queries, mean reciprocal rank 0.794 to 0.833, H60), an index that is the right schema
and the wrong shape is read row by row, A125 counts only the calls launched before the person's next
prompt, the refresh asks for an index beside its stamp rather than in it, and a class field holding a
function is indexed as a method. After it, two changes with no change in what they answer: the line
lookup `introduced.mjs` kept for itself now calls the one in `symbols.mjs`, and A125 reads a task
notification through `transcript.mjs`, as the call clock does.

## The index itself

The ranking queries, their ranks under each variant, the scale numbers and the sample output the README
prints are in `data/2026-10-28-find.json`; the corpus runs in `data/2026-10-28-e2e-corpus-shallow.txt`
and `data/2026-10-28-e2e-corpus-full-history.txt`.

On django, 39,257 definitions made a 633 KB index. Writing it costs a scan 0.16 seconds there, 1.79 to 1.95, and 0.13 on gitea, 2.12 to 2.25, the median of three warm scans each, wall to wall, against 0.19.0 on the same machine. One `find` over about 206,000 definitions (gitea's
index nine times under other paths) took 281 ms. The 21 repositories of the language measurements,
and this repository, scanned with the build and passed `e2e-corpus`, 22 of 22, stable on a second scan; six of them with their full
history (flask, Slim, gson, serilog, ripgrep, kotlinx.serialization) asked `class_inherits` and
`logger_over_print` in their areas, and stated neither, each held by its evidence or ratio gate
(`data/2026-10-28-tree-rows-full-history.txt`).

## What this does not show

- Opus 5.5 ran the four tasks at 10 sessions per arm, not the five per-language ones.
- The first three builds ran ten sessions per arm; the build that ships ran twenty. The 0.19.0 numbers
  are twenty per arm on Claude Code 2.1.310, one release before the 2.1.312 every run here used.
- The eval queries for `find` were written by the author after the first ranking was seen.
