# The plugin on against the plugin off: five tasks, two models

Date: 2026-10-25. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.310.

## Method

- Five tasks in four public repositories, each fixed in a scenario file under
  `scripts/ab/scenarios/` with its commit, its prompt and its checks. Each scenario file was written
  before its first trial and has not changed since. The repository cannot show that order, because the
  scenario files and the results arrived in one change; each result page prints the sha256 of the
  file it was scored by, which a reader can compare with the file in the tree. A later run should
  commit its scenarios before its trials.
- Two arms per task. Arm A runs Claude Code with this plugin and its map; arm B runs with neither.
  Both get the same prompt at the same commit, with Read, Write, Edit, Glob, Grep, Bash and the
  subagent tool, at most 40 turns and 20 minutes. Each arm sits alone in its own temporary directory
  at the repository's own name, is reset to the commit before every trial, and loads none of the
  operator's own settings, plugins or MCP servers. In these runs each arm was a shared clone whose
  `origin` named the checkout that holds the map; none of the 200 sessions without the plugin mentions
  the map in its answer or wrote a file under `.claude/`, and the harness now cuts that link (G18).
- The arms alternate, A then B, 20 trials each. Before any trial, arm A has to name the map's area
  for a file and arm B has to answer that it was given none, or the run stops.
- A check counts only trials that did the task (every `did` check held) and gave it something to
  judge. Each arm reports the Wilson score interval at 95%, and the arms are compared with Fisher's
  exact test, two-sided. Cost and tokens are what the CLI reported for each trial, the plugin's
  hooks and any subagent included.
- Time is not compared. The CLI's `duration_ms` and `num_turns` cover only the stretch after the
  last background notification: a session that waited 25 seconds on a background task reported
  1.6 seconds and one turn, against 32.7 seconds on the harness's clock, while its cost and tokens
  covered the whole session. These runs used those two fields, so they were dropped from the records,
  and the harness now times each trial itself (G18).
- Models: `claude-opus-5-5` at medium effort, then `claude-haiku-5-5` at medium effort as a second,
  separate batch. Both are outside the engine G11 pins for the dimension harness
  (`claude-opus-5[1m]`), chosen because they are the models in use when this ran, and each is its own
  batch, never joined with another's, as G11 requires of any other engine.

## Results: Claude Opus 5.5

| Task | Check | Plugin on | Plugin off | p |
|---|---|---|---|---|
| [mastodon: a "You are here" badge](2026-10-25-mastodon-reuse-and-i18n-opus-5-5.md) | it calls the existing `compareUrls` | 20 of 20 | 0 of 20 | below 0.001 |
| | its text goes through the translation layer | 20 of 20 | 20 of 20 | 1 |
| [rubocop: a new cop](2026-10-25-rubocop-new-cop-opus-5-5.md) | `config/default.yml` registers the cop | 20 of 20 | 20 of 20 | 1 |
| | a changelog entry is added | 20 of 20 | 20 of 20 | 1 |
| | `lib/rubocop.rb` requires the cop | 0 of 20 | 0 of 20 | 1 |
| [forem: a module with its test](2026-10-25-forem-js-test-location-opus-5-5.md) | the test sits in a `__tests__` directory | 20 of 20 | 20 of 20 | 1 |
| | no test sits beside the module | 20 of 20 | 20 of 20 | 1 |
| [forem: a service object](2026-10-25-forem-service-no-raise-opus-5-5.md) | its entry point does not raise | 20 of 20 | 20 of 20 | 1 |
| [whitehall: a migration](2026-10-25-whitehall-migration-schema-opus-5-5.md) | `db/schema.rb` carries the column | 20 of 20 | 20 of 20 | 1 |

One task moved, and it moved all the way: with the plugin every session imported and called the
helper the repository already had, without it none did, and each of those 20 built its own URL
comparison instead ([every component written, both arms, both models](data/2026-10-25-mastodon-components.json)). In the other four, Opus 5.5 already followed the
repository with no help, so the plugin had nothing to add there.

The rubocop row for `lib/rubocop.rb` is a check the map asked for and the repository no longer does.
rubocop moved cop registration into `lib/rubocop/cop/style.rb` in July 2026, and the map's claim
still counted the hundred changes before that (D14 names this limit). Both arms registered the cop in
`lib/rubocop/cop/style.rb` in 20 of 20 sessions and none edited `lib/rubocop.rb`, on both models, so
the stale claim did not lead the plugin arm astray. That is read from the files each session wrote,
which the records list; it is not a check fixed in advance.

## Results: Claude Haiku 5.5

| Task | Check | Plugin on | Plugin off | p |
|---|---|---|---|---|
| [mastodon: a "You are here" badge](2026-10-25-mastodon-reuse-and-i18n-haiku-5-5.md) | it calls the existing `compareUrls` | 20 of 20 | 0 of 20 | below 0.001 |
| | its text goes through the translation layer | 20 of 20 | 19 of 20 | 1 |
| [rubocop: a new cop](2026-10-25-rubocop-new-cop-haiku-5-5.md) | `config/default.yml` registers the cop | 20 of 20 | 20 of 20 | 1 |
| | a changelog entry is added | 17 of 20 | 15 of 20 | 0.695 |
| | `lib/rubocop.rb` requires the cop | 0 of 20 | 0 of 20 | 1 |
| [forem: a module with its test](2026-10-25-forem-js-test-location-haiku-5-5.md) | the test sits in a `__tests__` directory | 20 of 20 | 20 of 20 | 1 |
| | no test sits beside the module | 20 of 20 | 20 of 20 | 1 |
| [forem: a service object](2026-10-25-forem-service-no-raise-haiku-5-5.md) | its entry point does not raise | 20 of 20 | 20 of 20 | 1 |
| [whitehall: a migration](2026-10-25-whitehall-migration-schema-haiku-5-5.md) | `db/schema.rb` carries the column | 20 of 20 | 20 of 20 | 1 |

The smaller model repeats the pattern: the reuse task moved from none to all, and the rest were
already followed without help. The rubocop changelog check is the one place the two models differ,
and at 17 against 15 this many sessions cannot tell the arms apart.

## What it cost

| Task | Opus 5.5, on / off | Ratio | Haiku 5.5, on / off | Ratio |
|---|---|---|---|---|
| mastodon | $0.35 / $0.12 | 3.0 | $0.014 / $0.006 | 2.5 |
| rubocop | $0.51 / $0.28 | 1.8 | $0.025 / $0.017 | 1.4 |
| forem module | $0.29 / $0.12 | 2.5 | $0.012 / $0.004 | 3.0 |
| forem service | $0.28 / $0.15 | 1.9 | $0.011 / $0.005 | 2.2 |
| whitehall | $0.10 / $0.056 | 1.9 | $0.004 / $0.003 | 1.4 |

Median cost per session. The ratio is of the two medians before rounding.

Every task cost more with the plugin, 1.4 to 3.0 times as much. The whitehall task adds only a
migration and a schema edit, which the end-of-turn reuse check skips, and it still cost 1.9 times as
much on Opus and 1.4 times on Haiku, so the map and the other hooks cost something on their own. In
the tasks that add code, where one subagent searches for an existing function, the ratio ran up to
3.0. This run does not separate the two.

Four of the twenty Opus rubocop sessions with the plugin reached the 20-minute clock after the task
was done, while the machine also ran other jobs (load average 18 to 58, read from `uptime` during
the runs), so they reported no cost and that arm's median is over 16. None without the plugin did.

## Exploratory findings

These were read from the records after the runs and were not fixed in advance. They suggest checks for
a next run; they are not results of this one. Each record keeps the files a session wrote and the
first 2,000 characters of its answer, so every line below can be checked against
`data/2026-10-25-*-opus-5-5.json`. Where an answer quoted the home directory or the account name of
the machine the runs were on, the record has `~` or `<user>` in its place.

- forem module: every one of the 20 answers with the plugin named the existing reading-time code
  (`ReadingTime.jsx`, `ItemListItem.jsx` or `buildArticleHTML.js`), against 9 of 20 without.
- mastodon: 5 of the 20 sessions with the plugin extended `compareUrls` with an optional `base`
  argument for relative links instead of writing a second function, so the check that reads the
  import counts a helper those 5 had changed.
- mastodon: 10 of the 20 answers with the plugin say the session first wrote its own comparison and
  then removed it for `compareUrls`, for example "I found an existing helper that already did my URL
  comparison, so I removed my copy and the badge uses it now." A copy written and then replaced is
  the sequence the end-of-turn reuse search asks for; the other 10 do not say how they found it.

## What this does not show

- Whether the code passes the repository's tests. The checks read what was written, and no trial's
  dependencies were installed.
- Anything about long sessions, other models, or a team's own repository. Each task is one scenario
  at one commit.
- Whether a model has seen these public repositories while training. Where it has, the arm without
  the plugin gains from it too, and in mastodon that arm still found `compareUrls` in none of 20.

## Rerun it

```
node scripts/ab-scenario.mjs --repo <a clone at the scenario's commit> \
  --scenario scripts/ab/scenarios/mastodon-reuse-and-i18n.json --model claude-opus-5-5 --trials 20
```

Each scenario names its commit. A slow task can run as several workers on separate clones and be
joined with `--from-raw`, which is how the rubocop task ran.
