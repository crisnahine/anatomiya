# The blind replication: three tasks picked by a rule

Date: 2026-10-26. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.310.

## Why it exists

Three of the four reuse tasks in [the 2026-10-25 runs](2026-10-25-plugin-on-off.md) were chosen after
the first had shown the plugin pays where a task needs a helper the repository already has. This run
takes the choosing away: [a rule](2026-10-26-blind-replication-rule.md), committed in `17219f51`
before any map was opened, picked the repositories, the helpers and the new file's place. Its one
amendment and its picks were committed in `f55a7820`, and the three scenario files in `b6e8dc52`, all
before the first session.

## Results

20 sessions per arm, the same harness, tools and limits as 2026-10-25. The check fixed in advance:
the new file imports the helper and calls it.

| Task | Helper | Opus 5.5 with / without | p | Haiku 5.5 with / without | p |
|---|---|---|---|---|---|
| eslint: a linter test | `unIndent` | [6 / 0](2026-10-26-eslint-unindent-blind-opus-5-5.md) | 0.020 | [18 / 0](2026-10-26-eslint-unindent-blind-haiku-5-5.md) | below 0.001 |
| openfoodnetwork: a Stimulus controller | `showHttpError` | [20 / 19](2026-10-26-openfoodnetwork-http-error-blind-opus-5-5.md) | 1 | [20 / 3](2026-10-26-openfoodnetwork-http-error-blind-haiku-5-5.md) | below 0.001 |
| cal.diy: an app key reader | `getAppKeysFromSlug` | [0 / 0](2026-10-26-caldiy-app-keys-blind-opus-5-5.md) | 1 | [0 / 0](2026-10-26-caldiy-app-keys-blind-haiku-5-5.md) | 1 |

Over the three, 64 of 120 sessions with the plugin called the helper and 22 of 120 without it did.
Three of the six task and model pairs differ at p below 0.05, and in none did the arm without the
plugin do better. Together with the four reuse tasks of 2026-10-25, it is 209 of 280 against 53 of
280.

## Reading each one

- **openfoodnetwork.** On Opus both arms found `showHttpError`, 20 against 19. The prompt names the
  translation keys the helper uses, and the amendment put the new file in an area where a
  neighbouring controller already imports it; both made the helper easy to find without a map. On
  Haiku the plugin took it from 3 of 20 to 20 of 20.
- **eslint.** `unIndent` strips leading spaces only (`line.match(/ */u)`), and eslint indents with
  tabs. All 14 Opus answers with the plugin that did not call it name `unIndent` or the reuse search,
  and all 14 give the tab indentation as the reason they kept a helper of their own. The check fixed in
  advance counts those as misses, so the result stays 6 against 0. On Haiku it is 18 against 0. No
  session without the plugin called it, on either model.
- **cal.diy.** 0 against 0 on both models. 39 of the 40 answers with the plugin say the end-of-turn
  check ran and found no existing function doing what the new `getAppClientId` does, and that is true:
  `getAppKeysFromSlug` does one step of it, loading an app's keys by its slug. The sessions wrote the
  database query inside `getAppClientId` itself, all 40 of them, so there was no separate copy for the
  check to match.
  The reuse check finds a function that duplicates a function the turn wrote, and misses a helper
  that would replace part of one.

## What it cost

| Task | Opus 5.5, on / off | Ratio | Haiku 5.5, on / off | Ratio |
|---|---|---|---|---|
| eslint | $0.35 / $0.11 | 3.3 | $0.019 / $0.006 | 3.2 |
| openfoodnetwork | $0.27 / $0.081 | 3.3 | $0.012 / $0.004 | 3.1 |
| cal.diy | $0.39 / $0.10 | 3.8 | $0.018 / $0.009 | 2.0 |

Median cost per session; the ratio is of the two medians before rounding. These three ran higher than
the 2026-10-25 tasks, up to 3.8 times as much.

## How it ran

- The harness built a map-less arm from a local clone with no remote and no reflog, and ran trials
  with no GitHub login and with `DISABLE_AUTOUPDATER=1`. Each page's "built with" row names the build.
- The two cal.diy runs first stopped before their first trial: cal.diy tracks `.claude/rules` as a
  link to `agents/rules`, and the harness could not copy the map onto that link. `9bdeb697` installs
  the map wherever the link points, and both runs were started again from scratch on that build. No
  session had run.
- None of the 120 sessions without the plugin mentions the map in its answer or wrote a file under
  `.claude/`, and none of the three repositories ignores that directory.
- The file each session wrote is published whole in the three `data/2026-10-26-*-blind-files.json`.
