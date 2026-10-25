# The plugin on against the plugin off: eight tasks, two models

Date: 2026-10-25. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.310.

## In short

Four of the eight tasks ask for code an existing helper in the repository already does. Over those
four, on both models, 145 of 160 sessions with the plugin called the helper the repository already
had, and 31 of 160 without it did. The other four tasks ask for a habit the neighbouring files already
show; both models followed it with or without the plugin, so the plugin changed nothing there. Every
task cost more with the plugin, 1.4 to 3.1 times as much at the median.

## Method

- Eight tasks in four public repositories, each fixed in a scenario file under
  `scripts/ab/scenarios/` with its commit, its prompt and its checks.
- They ran as two batches. The first five scenario files were written before their first trial and
  have not changed since, but the repository cannot show that order, because those files and their
  results arrived in one change. The three `*-reuse` scenarios were committed in `dc937294` before
  their first session. Each result page prints the sha256 of the file it was scored by, which a
  reader can compare with the file in the tree.
- The three reuse tasks were chosen after the first batch: they test the one kind of task where the
  first batch saw the plugin change the outcome, a helper the repository already has in another
  directory. Their prompts never name the helper, and their checks were fixed before any of their
  sessions ran.
- Two arms per task. Arm A runs Claude Code with this plugin and its map; arm B runs with neither.
  Both get the same prompt at the same commit, with Read, Write, Edit, Glob, Grep, Bash and the
  subagent tool, at most 40 turns and 20 minutes. Each arm sits alone in its own temporary directory
  at the repository's own name, is reset to the commit before every trial, and loads none of the
  operator's own settings, plugins or MCP servers.
- In the first batch each arm was a shared clone whose `origin` and reflog named the checkout that
  holds the map. In the second each arm was a local clone with no remote, whose reflog still named
  it. In both, a session could reach the operator's `gh` login, which four rubocop sessions, two on
  each model, say they used to credit their changelog entry. None of the 320 sessions without the
  plugin mentions the map in its answer or wrote a file under `.claude/`. The harness now removes the
  reflog and logs `gh` out (G18).
- The arms alternate, A then B, 20 trials each. Before any trial, arm A has to name the map's area
  for a file and arm B has to answer that it was given none, or the run stops.
- A check counts only trials that did the task (every `did` check held) and gave it something to
  judge. Each arm reports the Wilson score interval at 95%, and the arms are compared with Fisher's
  exact test, two-sided. Cost and tokens are what the CLI reported for each trial, the plugin's
  hooks and any subagent included.
- Time is not compared. The CLI's `duration_ms` and `num_turns` cover only the stretch after the
  last background notification: a session that waited 25 seconds on a background task reported
  1.6 seconds and one turn, against 32.7 seconds on the harness's clock, while its cost and tokens
  covered the whole session. The first batch used those two fields, so they were dropped from its
  records. The second batch was timed by the harness, but its six runs shared one machine, so its
  task pages print a wall time that says little about the plugin.
- Models: `claude-opus-5-5` at medium effort, then `claude-haiku-5-5` at medium effort as a separate
  batch of every task. Both are outside the engine G11 pins for the dimension harness
  (`claude-opus-5[1m]`), chosen because they are the models in use when this ran, and each is its own
  batch, never joined with another's, as G11 requires of any other engine.

## Results: Claude Opus 5.5

| Task | Check | Plugin on | Plugin off | p |
|---|---|---|---|---|
| [mastodon: a "You are here" badge](2026-10-25-mastodon-reuse-and-i18n-opus-5-5.md) | it calls the existing `compareUrls` | 20 of 20 | 0 of 20 | below 0.001 |
| | its text goes through the translation layer | 20 of 20 | 20 of 20 | 1 |
| [forem: a contrast warning](2026-10-25-forem-contrast-reuse-opus-5-5.md) | it calls the existing contrast helper | 20 of 20 | 6 of 20 | below 0.001 |
| | it writes no luminance formula of its own | 20 of 20 | 6 of 20 | below 0.001 |
| [whitehall: an external link helper](2026-10-25-whitehall-external-link-reuse-opus-5-5.md) | it calls the existing `is_external?` | 20 of 20 | 0 of 20 | below 0.001 |
| | it compares no hosts itself | 20 of 20 | 0 of 20 | below 0.001 |
| [mastodon: a link policy](2026-10-25-mastodon-local-url-reuse-opus-5-5.md) | it calls the existing `TagManager#local_url?` | 20 of 20 | 15 of 20 | 0.047 |
| | it reads no configured domain itself | 20 of 20 | 15 of 20 | 0.047 |
| [rubocop: a new cop](2026-10-25-rubocop-new-cop-opus-5-5.md) | `config/default.yml` registers the cop | 20 of 20 | 20 of 20 | 1 |
| | a changelog entry is added | 20 of 20 | 20 of 20 | 1 |
| | `lib/rubocop.rb` requires the cop | 0 of 20 | 0 of 20 | 1 |
| [forem: a module with its test](2026-10-25-forem-js-test-location-opus-5-5.md) | the test sits in a `__tests__` directory | 20 of 20 | 20 of 20 | 1 |
| | no test sits beside the module | 20 of 20 | 20 of 20 | 1 |
| [forem: a service object](2026-10-25-forem-service-no-raise-opus-5-5.md) | its entry point does not raise | 20 of 20 | 20 of 20 | 1 |
| [whitehall: a migration](2026-10-25-whitehall-migration-schema-opus-5-5.md) | `db/schema.rb` carries the column | 20 of 20 | 20 of 20 | 1 |

With the plugin, every session in all four reuse tasks called the helper the repository already
had. Without it, none did in mastodon's badge or whitehall's link helper, 6 of 20 did in forem, and
15 of 20 did in mastodon's link policy. Each of the 20 badge sessions without the plugin built its own
URL comparison instead ([every component written, both arms, both models](data/2026-10-25-mastodon-components.json)),
and 14 of the 20 forem sessions without it wrote the WCAG luminance formula out by hand. In the other
four tasks, Opus 5.5 already followed the repository with no help, so the plugin had nothing to add
there.

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
| [forem: a contrast warning](2026-10-25-forem-contrast-reuse-haiku-5-5.md) | it calls the existing contrast helper | 20 of 20 | 7 of 20 | below 0.001 |
| | it writes no luminance formula of its own | 20 of 20 | 7 of 20 | below 0.001 |
| [whitehall: an external link helper](2026-10-25-whitehall-external-link-reuse-haiku-5-5.md) | it calls the existing `is_external?` | 19 of 20 | 1 of 20 | below 0.001 |
| | it compares no hosts itself | 19 of 20 | 10 of 20 | 0.003 |
| [mastodon: a link policy](2026-10-25-mastodon-local-url-reuse-haiku-5-5.md) | it calls the existing `TagManager#local_url?` | 6 of 20 | 2 of 20 | 0.235 |
| | it reads no configured domain itself | 13 of 20 | 2 of 20 | below 0.001 |
| [rubocop: a new cop](2026-10-25-rubocop-new-cop-haiku-5-5.md) | `config/default.yml` registers the cop | 20 of 20 | 20 of 20 | 1 |
| | a changelog entry is added | 17 of 20 | 15 of 20 | 0.695 |
| | `lib/rubocop.rb` requires the cop | 0 of 20 | 0 of 20 | 1 |
| [forem: a module with its test](2026-10-25-forem-js-test-location-haiku-5-5.md) | the test sits in a `__tests__` directory | 20 of 20 | 20 of 20 | 1 |
| | no test sits beside the module | 20 of 20 | 20 of 20 | 1 |
| [forem: a service object](2026-10-25-forem-service-no-raise-haiku-5-5.md) | its entry point does not raise | 20 of 20 | 20 of 20 | 1 |
| [whitehall: a migration](2026-10-25-whitehall-migration-schema-haiku-5-5.md) | `db/schema.rb` carries the column | 20 of 20 | 20 of 20 | 1 |

The smaller model repeats the pattern in three of the four reuse tasks. The fourth, mastodon's link
policy, is the one result here that this many sessions cannot separate: 6 of 20 against 2 of 20 on
the check fixed in advance. The rubocop changelog check is the other place the two models differ,
and at 17 against 15 it cannot tell the arms apart either.

## What it cost

| Task | Opus 5.5, on / off | Ratio | Haiku 5.5, on / off | Ratio |
|---|---|---|---|---|
| mastodon badge | $0.35 / $0.12 | 3.0 | $0.014 / $0.006 | 2.5 |
| forem contrast warning | $0.32 / $0.17 | 1.9 | $0.017 / $0.007 | 2.4 |
| whitehall link helper | $0.27 / $0.092 | 2.9 | $0.011 / $0.005 | 2.5 |
| mastodon link policy | $0.28 / $0.11 | 2.5 | $0.013 / $0.004 | 3.1 |
| rubocop | $0.51 / $0.28 | 1.8 | $0.025 / $0.017 | 1.4 |
| forem module | $0.29 / $0.12 | 2.5 | $0.012 / $0.004 | 3.0 |
| forem service | $0.28 / $0.15 | 1.9 | $0.011 / $0.005 | 2.2 |
| whitehall migration | $0.10 / $0.056 | 1.9 | $0.004 / $0.003 | 1.4 |

Median cost per session. The ratio is of the two medians before rounding.

Every task cost more with the plugin, 1.4 to 3.1 times as much. The whitehall migration task adds
only a migration and a schema edit, which the end-of-turn reuse check skips, and it still cost 1.9
times as much on Opus and 1.4 times on Haiku, so the map and the other hooks cost something on their
own. In the tasks that add code, where one subagent searches for an existing function, the ratio ran
up to 3.1. This run does not separate the two.

Four of the twenty Opus rubocop sessions with the plugin reached the 20-minute clock after the task
was done, while the machine also ran other jobs (load average 18 to 58, read from `uptime` during
the runs), so they reported no cost and that arm's median is over 16. None without the plugin did.

## Exploratory findings

These were read from the records after the runs and were not fixed in advance. They suggest checks for
a next run; they are not results of this one. Each record keeps the files a session wrote and the
first 2,000 characters of its answer, so every line below can be checked against the `data/` files
named `2026-10-25-*`. Where an answer quoted the home directory or the account name of the machine the
runs were on, the record has `~` or `@<user>` in its place.

- mastodon link policy, Haiku 5.5: 6 more sessions with the plugin called
  `ActivityPub::TagManager#local_uri?`, an existing helper built on the same `TagManager` domain
  checks, and 1 called `TagManager#local_domain?` and `#web_domain?` directly. Counting any existing `TagManager`
  helper, it is 13 of 20 with the plugin against 2 of 20 without. The check fixed in advance named
  `local_url?` alone, so the result above stays 6 against 2.
- whitehall link helper, Haiku 5.5: "it compares no hosts itself" passed 10 sessions without the
  plugin, and 9 of them compared the link's host with `Plek.website_root` instead, without the word
  `public_host` the check looks for. The check that matters, whether
  `is_external?` is called, is 19 against 1.
- forem module: every one of the 20 answers with the plugin named the existing reading-time code
  (`ReadingTime.jsx`, `ItemListItem.jsx` or `buildArticleHTML.js`), against 9 of 20 without.
- mastodon badge: 5 of the 20 Opus sessions with the plugin extended `compareUrls` with an optional
  `base` argument for relative links instead of writing a second function, so the check that reads
  the import counts a helper those 5 had changed.
- mastodon badge: 10 of the 20 Opus answers with the plugin say the session first wrote its own
  comparison and then removed it for `compareUrls`, for example "I found an existing helper that
  already did my URL comparison, so I removed my copy and the badge uses it now." A copy written and
  then replaced is the sequence the end-of-turn reuse search asks for; the other 10 do not say how
  they found it.

## What this does not show

- Whether the code passes the repository's tests. The checks read what was written, and no trial's
  dependencies were installed.
- How often a real task needs a helper the repository already has. Four of the eight tasks were built
  around one, three of them chosen after the first batch had shown that is where the plugin pays.
- Anything about long sessions, other models, or a team's own repository. Each task is one scenario
  at one commit.
- Whether a model has seen these public repositories while training. Where it has, the arm without
  the plugin gains from it too, and in mastodon's badge that arm still found `compareUrls` in none of
  20.

## Rerun it

```
node scripts/ab-scenario.mjs --repo <a clone at the scenario's commit> \
  --scenario scripts/ab/scenarios/mastodon-reuse-and-i18n.json --model claude-opus-5-5 --trials 20
```

Each scenario names its commit. A slow task can run as several workers on separate clones and be
joined with `--from-raw`, which is how the rubocop task ran.
