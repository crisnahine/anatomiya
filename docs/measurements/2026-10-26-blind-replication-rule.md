# How the replication picks its tasks

Date: 2026-10-26. Written and committed before any map below was opened, so the tasks it yields are
not chosen by the person who has seen how the plugin did.

The 2026-10-25 runs found the plugin changed the outcome when a task needed code the repository
already had in another directory, and three of those four tasks were chosen after the first one had
shown it. This replication picks its repositories, its helpers and its checks by the rule below, runs
them the same way, and reports every result.

## The rule

1. **Repositories.** Go down the acceptance corpus table in `docs/measurements/corpus.md`, in its
   order. Skip a private repository and the four the 2026-10-25 runs used (whitehall, forem,
   mastodon, rubocop). Skip a repository holding 10,000 tracked files or more, since a trial there
   spends its turns finding its way. Take the first three that pass step 2.
2. **Helpers.** Clone the repository at the commit the table names and run `scan` from this
   repository. From every area file, collect each name in a "most imported from here" line with its
   importing-file count. Keep a name that the code defines as a function: a `function` declaration or
   a `const` bound to an arrow or function expression, exported from a file inside that area. Drop
   classes, components (a name that returns JSX), types, hooks (a name starting with `use`) and
   constants. Take the name with the most importing files; break a tie by the name's alphabetical
   order. A repository with no such name fails this step.
3. **The task.** Ask for one small new file, in an area that holds no file importing the helper,
   doing what the helper does as one part of a feature. Describe the behaviour the helper's own code
   implements, in plain words, and never name the helper, its file or its directory. Keep the prompt
   to the shape of the 2026-10-25 prompts: the path of the new file, what it exports, the behaviour,
   and "Keep it small."
4. **The checks.** `did`: the new file exists. Check: the new file imports the helper by name from
   its module and calls it, as a pattern over the file. Nothing else is scored in advance.
5. **The runs.** Each scenario file is committed before its first session. 20 sessions per arm on
   `claude-opus-5-5` at medium effort and again on `claude-haiku-5-5` at medium effort, with the same
   harness, the same tools and the same limits as 2026-10-25. Every result is published, whatever it
   shows.

## Where the rule leaves judgement

Step 3 is written by someone who has seen the helper, so the prompt's wording is a choice. Its
limits are the ones above: no name, no file, no directory, the helper's behaviour and nothing more.
The prompts are published with the scenarios, so a reader can judge whether one gives the answer
away.

## Amendment, before any scenario was written

Applying the rule left openfoodnetwork's helper, `showHttpError`, with no area that holds no
importer and where a new file could import an ES module: the only such area is
`app/assets/javascripts/admin`, served by Sprockets. Where step 3 finds no such area, the new file
goes in the area holding the fewest importing files that can import the helper, breaking a tie by the
area's path in alphabetical order. This makes the task easier for the arm without the plugin, since a
neighbouring file may show the import, so it cannot favour the plugin.

What the rule picked, before any trial:

| Repository | Passed step 1 and 2 after skipping | Helper (importing files) | New file's area |
|---|---|---|---|
| cal.diy | angular, appsmith, babel, backstage (10,000 files or more) | `getAppKeysFromSlug` (51) | `packages/lib/server` |
| eslint | chef, consul, diaspora, errbit (no "most imported" line) | `unIndent` (11) | `tests/lib/linter` |
| openfoodnetwork | fastlane, brew, huginn (no "most imported" line) | `showHttpError` (6) | `app/components` (1 importer; the amendment) |

Dropped on the way, by step 2: cal.diy's `TrpcSessionUser` (a type), `http` (an object built by an
immediately called function), `PrismaModule` and `UsersModule` (classes) and `test` (bound to a call);
eslint's `tester`, `utils` and `rules` (a class and two objects).
