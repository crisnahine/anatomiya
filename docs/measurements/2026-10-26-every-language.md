# 0.19.0: the reuse tasks again, and one per language

Date: 2026-10-26. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.310. Plugin build:
`a71f5dec`, see [How it ran](#how-it-ran).

## Why it exists

[The blind replication](2026-10-26-blind-replication.md) left two gaps. Most sessions that missed a
helper had named it, then kept a copy because it fell short on one case (eslint's tabs, mastodon's
`local_uri?`), and every task measured so far was JavaScript, TypeScript or Ruby, the only languages
with a helper line on their area files. 0.19.0 changes the reuse check's reason to ask for the closest
function and for the part of the job it does (A123), reads view templates, Blade and JSX text that
held code and asked nothing (A122, B80, B81), and gives every language the helper line (H58, H59).

This run measures that build three ways, each fixed before its first session:

- The seven reuse tasks of the chart again, with cal.diy's new file moved to `apps/web/lib`, where
  the import is allowed ([amendment 2](2026-10-26-blind-replication-rule.md)).
- One task per tree-sitter language, picked by [a rule](2026-10-26-language-replication-rule.md)
  committed before any of its repositories was scanned for it.
- One trap: the user hands over the exact code to add, and the repository holds a look-alike helper
  that answers differently on a dotfile. A reuse check that pushes too hard would change what the
  user asked for.

## Results

20 sessions per arm, alternating, each from a clean checkout. The checks were fixed in the scenario
files before the first session: the new file imports the helper and calls it.

The seven reuse tasks:

| Task | Helper | Opus 5.5 with / without | p | Haiku 5.5 with / without | p |
|---|---|---|---|---|---|
| mastodon: a "You are here" badge | `compareUrls` | [20 / 0](2026-10-26-0-19-0-mastodon-reuse-and-i18n-opus-5-5.md) | below 0.001 | [20 / 0](2026-10-26-0-19-0-mastodon-reuse-and-i18n-haiku-5-5.md) | below 0.001 |
| forem: a contrast warning | its WCAG contrast helper | [20 / 2](2026-10-26-0-19-0-forem-contrast-reuse-opus-5-5.md) | below 0.001 | [20 / 10](2026-10-26-0-19-0-forem-contrast-reuse-haiku-5-5.md) | below 0.001 |
| whitehall: an external link helper | `is_external?` | [20 / 1](2026-10-26-0-19-0-whitehall-external-link-reuse-opus-5-5.md) | below 0.001 | [20 / 3](2026-10-26-0-19-0-whitehall-external-link-reuse-haiku-5-5.md) | below 0.001 |
| mastodon: a link policy | `TagManager#local_url?` | [20 / 15](2026-10-26-0-19-0-mastodon-local-url-reuse-opus-5-5.md) | 0.047 | [11 / 1](2026-10-26-0-19-0-mastodon-local-url-reuse-haiku-5-5.md) | 0.001 |
| eslint: a linter test | `unIndent` | [17 / 1](2026-10-26-0-19-0-eslint-unindent-blind-opus-5-5.md) | below 0.001 | [17 / 0](2026-10-26-0-19-0-eslint-unindent-blind-haiku-5-5.md) | below 0.001 |
| openfoodnetwork: a Stimulus controller | `showHttpError` | [20 / 19](2026-10-26-0-19-0-openfoodnetwork-http-error-blind-opus-5-5.md) | 1 | [20 / 7](2026-10-26-0-19-0-openfoodnetwork-http-error-blind-haiku-5-5.md) | below 0.001 |
| cal.diy: an app key reader | `getAppKeysFromSlug` | [20 / 9](2026-10-26-0-19-0-caldiy-app-keys-allowed-opus-5-5.md) | below 0.001 | [20 / 0](2026-10-26-0-19-0-caldiy-app-keys-allowed-haiku-5-5.md) | below 0.001 |

One task per language, picked by the rule:

| Language | Task | Helper | Opus 5.5 with / without | p | Haiku 5.5 with / without | p |
|---|---|---|---|---|---|---|
| Python | CTFd: an admin report route | `admins_only` | [20 / 20](2026-10-26-0-19-0-ctfd-admins-only-lang-opus-5-5.md) | 1 | [20 / 17](2026-10-26-0-19-0-ctfd-admins-only-lang-haiku-5-5.md) | 0.231 |
| PHP | BookStack: the admin role's users | `Role::getSystemRole` | [20 / 2](2026-10-26-0-19-0-bookstack-system-role-lang-opus-5-5.md) | below 0.001 | [20 / 19](2026-10-26-0-19-0-bookstack-system-role-lang-haiku-5-5.md) | 1 |
| Go | gitea: a count of inactive users | `db.GetEngine` | [20 / 20](2026-10-26-0-19-0-gitea-get-engine-lang-opus-5-5.md) | 1 | [18 / 20](2026-10-26-0-19-0-gitea-get-engine-lang-haiku-5-5.md) | 0.487 |
| Java | DolphinScheduler: a schedule reader | `JSONUtils.parseObject` | [20 / 20](2026-10-26-0-19-0-dolphinscheduler-parse-object-lang-opus-5-5.md) | 1 | [19 / 20](2026-10-26-0-19-0-dolphinscheduler-parse-object-lang-haiku-5-5.md) | 1 |
| C# | Bitwarden: an import batch record | `CoreHelpers.GenerateComb` | [20 / 20](2026-10-26-0-19-0-bitwarden-generate-comb-lang-opus-5-5.md) | 1 | [20 / 20](2026-10-26-0-19-0-bitwarden-generate-comb-lang-haiku-5-5.md) | 1 |
| Rust | atuin: a script run's id | `uuid_v7` | [20 / 5](2026-10-26-0-19-0-atuin-uuid-v7-lang-opus-5-5.md) | below 0.001 | [20 / 0](2026-10-26-0-19-0-atuin-uuid-v7-lang-haiku-5-5.md) | below 0.001 |
| Kotlin | KotlinConf: an empty list message | `PreviewHelper` | [20 / 20](2026-10-26-0-19-0-kotlinconf-preview-helper-lang-opus-5-5.md) | 1 | [20 / 20](2026-10-26-0-19-0-kotlinconf-preview-helper-lang-haiku-5-5.md) | 1 |

Over the seven reuse tasks, 265 of 280 sessions with the plugin called the helper and 68 of 280
without it did; over the seven language tasks, 277 of 280 against 223 of 280. Together, 542 of 560
against 291 of 560, and 16 of the 28 task and model pairs differ at p below 0.05, none of them in
favour of the arm without the plugin.

The p is Fisher's exact test, two-sided. One DolphinScheduler session with the plugin on Haiku did
not write the file and is counted out of 19.

## Reading the misses

- **eslint.** 17 of 20 on both models, against 6 and 18 before. Of the six misses, two use
  `stripIndent` from `common-tags`, a package eslint already depends on, and four keep a helper of
  their own; three of those four name `unIndent` and give eslint's tab indentation as the reason, as
  all 14 Opus misses did before.
- **mastodon's link policy on Haiku.** 11 of 20, against 6 before. Of the nine misses, five call
  `TagManager#local_uri?`, the method beside `local_url?` in the same class, two build on
  `TagManager`'s `local_domain` and `web_domain`, and two read the configured domain themselves. Six
  of the nine name `local_url?` in their answer.
- **gitea on Haiku.** The one task where the arm without the plugin did better, 20 against 18, and
  too close to call. Both misses replaced the direct `db.GetEngine` call with `db.Count[T]` from
  `models/db/list.go`, the repository's own generic counter, which calls `GetEngine` itself. The
  check fixed in advance counts that as a miss.
- **DolphinScheduler on Haiku.** One session with the plugin wrote no file and is left out.

## Where the plugin changed nothing

On seven of the fourteen language pairs both arms called the helper 20 times of 20: CTFd, gitea and
DolphinScheduler on Opus, and Bitwarden and KotlinConf on both models. The rule picks the helper the
most files import, and in those repositories it is the idiom: gitea calls `db.GetEngine` from 246
files and Bitwarden builds every id with `CoreHelpers.GenerateComb`. A model writing a new file there
follows the files beside it, with or without a map, and the plugin adds only its cost. BookStack and
CTFd on Haiku are near it too, at 19 and 17 without it, and DolphinScheduler on Haiku is 19 with
against 20 without.

## The trap

The prompt hands over `extLower`, eight lines that lowercase a file name's extension, and asks for
it in `scripts/ext-lower.mjs` of this repository, where `paths.mjs` already holds `extOf` and
`baseOf`. `extOf` answers differently: it keeps the dot and the case, and it reads `.env` as a name
with no extension. The check fixed in advance is that the file still exports `extLower`, which every
session in both arms did. What each `extLower` returns was scored after the runs, against the code
the prompt gave, on eleven inputs: `a/b.TXT`, `.env`, `x.d.ts`, `Rakefile`, `a/B.PNG`, `a.b/c`,
`dir.v2/file`, `noext`, the empty path, `a/.gitignore` and `a/b.tar.gz`. Those inputs were not committed
before the first session, so this part is a reading and not a check fixed in advance.

- Without the plugin, 20 of 20 files are the prompt's code and answer as it does.
- With it, 6 of 20 keep the prompt's code with no import, 13 call `baseOf` for the file name and
  answer as the prompt's code does, and 1 rebuilt `extLower` on `extOf` and now answers `""` for `.env` and
  `.gitignore` and `d.ts` for `x.d.ts`. That session said so in its answer: "the file no longer matches
  what you asked for in two cases".

One session in 20 changed what the user asked for, and told them. The reason asks to fit the new code
to an existing function or extend it; it does not say that code the user wrote out is the
specification, and this session read it as an invitation. A median session with the plugin cost
$0.48 here against $0.018 without it, 27 times as much, because the end-of-turn search ran on a turn
that only pasted code.

## What it cost

| | Opus 5.5, on / off | Haiku 5.5, on / off |
|---|---|---|
| mastodon: a badge | $0.40 / $0.11 | $0.026 / $0.005 |
| forem: a contrast warning | $0.40 / $0.18 | $0.018 / $0.007 |
| whitehall: an external link helper | $0.32 / $0.067 | $0.014 / $0.005 |
| mastodon: a link policy | $0.34 / $0.095 | $0.014 / $0.004 |
| eslint: a linter test | $0.50 / $0.12 | $0.020 / $0.006 |
| openfoodnetwork: a Stimulus controller | $0.31 / $0.081 | $0.014 / $0.004 |
| cal.diy: an app key reader | $0.40 / $0.12 | $0.029 / $0.009 |
| CTFd (Python) | $0.39 / $0.10 | $0.023 / $0.009 |
| BookStack (PHP) | $0.29 / $0.078 | $0.010 / $0.003 |
| gitea (Go) | $0.31 / $0.075 | $0.011 / $0.004 |
| DolphinScheduler (Java) | $0.36 / $0.12 | $0.013 / $0.005 |
| Bitwarden (C#) | $0.33 / $0.12 | $0.017 / $0.008 |
| atuin (Rust) | $0.39 / $0.11 | $0.015 / $0.004 |
| KotlinConf (Kotlin) | $0.45 / $0.13 | $0.018 / $0.007 |

Median cost per session. The ratio of the two medians runs from 2.0 to 5.5 across the 28 task and
model pairs, and Haiku's, a few cents against a few tenths of a cent, move the most. The trap's, 27,
is above all of them.

## How it ran

- The plugin these sessions ran is the commit published as `a71f5dec`. The run pages name it
  `b94dd31e`, which was its name before the branch's author line was corrected and every commit on it
  renamed; the two hold the same tree, `7c62dd16`. Nothing in `plugins/` changed between them.
- After this run, two review rounds changed how the helper line resolves some names (H58, H59) and
  how some template and Blade lines are read (A122, B80). Scanned at each task's commit with both
  builds, 14 of the 15 probed areas get the same area file and the same overview from the build that
  ships as from the one measured. The 15th is whitehall's `app/helpers`, whose helper line lost
  `govspeak_to_html (28 files)` and `default_update_type (13)`, since a Rails helper's bare calls are
  no longer counted; `is_external?`, the helper its task needs, is in neither line.
- Two Haiku runs, forem and cal.diy, ended part way: a session had installed a package tree into its
  arm, and removing it took `git clean` past the harness's one-minute clock on a machine running
  eight runs at once. `8f1f96de` gives that step ten minutes. Both runs were started again from their
  first trial, and every run started after the fix names its build "with uncommitted changes": the
  harness file, and nothing under `plugins/`.
- The harness built a map-less arm from a local clone with no remote and no reflog. None of the 580
  sessions without the plugin mentions the map in its answer or wrote a file under `.claude/`. With
  it, the plugin's own background refresh rewrote the map in 34 sessions, which is the plugin at
  work and no file the session wrote.
- Sessions on both arms ran package installs and builds as they chose: Maven compiles in
  DolphinScheduler and `npm install` in the JavaScript repositories, and four Bitwarden sessions
  without the plugin say they installed the .NET SDK into the home directory of the machine running
  the harness. The harness gives a session a shell and no sandbox.
- The file each session wrote is in `data/2026-10-26-0-19-0-<task>-files.json`, and every trial's
  answer, checks and cost in `data/2026-10-26-0-19-0-<task>-<model>.json`.

## What it does not show

- Fourteen tasks in thirteen repositories, each at one commit. A language with one task is one
  repository's idiom, not the language's.
- The checks name one helper. A session that called another of the repository's functions doing the
  same job, as gitea's two misses did, counts as a miss.
- Where both arms reach 20, the run says the model found the helper without the plugin, not that the
  plugin does nothing in that language.
