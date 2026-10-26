# How the language replication picks its tasks

Date: 2026-10-26. Written and committed before any repository below was scanned for it, so the tasks it
yields are not chosen by the person who has seen how the plugin did on them.

Every reuse task measured before this one was JavaScript, TypeScript or Ruby, because the rule that
picked them read the "most imported from here" line, and only JavaScript areas had one. From this
release every language the plugin reads has that line. This rule picks one task per tree-sitter
language, runs them the way the earlier tasks ran, and reports every result.

## The rule

1. **Repositories.** For each of Python, PHP, Go, Java, C#, Rust and Kotlin, go down the applications
   corpus table in `docs/measurements/corpus.md`, in its order, at the commit it names. Take the first
   repository whose tracked source files are mostly that language, that holds fewer than 10,000 tracked
   files, and that passes step 2.
2. **Helpers.** Run `scan` from this repository at the commit that adds this rule's scenarios. From
   every area file, collect each name in a "most imported from here" line with its importing-file
   count. Keep a name that is a function or a method the area's own code defines: a Python `def`, a Go
   `func` (written `package.Func`), a static or companion method or a top-level function in Java,
   Kotlin, C# or PHP (written `Class.method`, `Class::method` or `function`), and a Rust `fn`. Drop
   classes, interfaces, types, constants, support files, and a name whose file is under a test
   directory. Take the name with the most importing files; break a tie by the name's alphabetical
   order. A repository with no such name fails this step.
3. **The task.** Ask for one small new file, in an area that holds no file importing the helper, where
   the language's own build and the repository's lint let the new file import it: the same module,
   crate, project or package graph as files that already import the helper's module. Describe the
   behaviour the helper's own code implements, as one part of a feature, in plain words, and never
   name the helper, its file or its directory. Keep the prompt to the shape of the earlier prompts: the
   path of the new file, what it defines, the behaviour, and "Keep it small."
4. **The checks.** `did`: the new file exists. Check: the new file names the helper and calls it, as
   a pattern over the file, written for the language (an import or a `use` where the language needs
   one). Nothing else is scored in advance.
5. **The runs.** Each scenario file is committed before its first session. 20 sessions per arm on
   `claude-opus-5-5` at medium effort and again on `claude-haiku-5-5` at medium effort, with the same
   harness, tools and limits as the 2026-10-25 and 2026-10-26 runs. Every result is published, whatever
   it shows.

## Where the rule leaves judgement

Step 3 is written by someone who has seen the helper, so the prompt's wording and the new file's area
are choices, within the limits above. The prompts are published with the scenarios, so a reader can
judge whether one gives the answer away.

## What the rule picked

Applied on 2026-10-26, before any session ran. Each repository was fetched at the table's commit, and
`scan` ran from this repository at `ff504b1e`, the build of that day before this release's second
round of reference readers; the rule's step 2 says the commit that adds the scenarios, and the picks
were made on the one before it. Step 1 counted tracked files by extension. In every
language the first repository of that language in the table passed steps 1 and 2, so no repository
was skipped for failing a step. The ones passed over were of another language.

| Language | Repository | Passed steps 1 and 2 after skipping | Helper (importing files) | New file's area |
|---|---|---|---|---|
| Python | CTFd | none | `admins_only` (38) | `CTFd` |
| PHP | BookStack | none | `Role::getSystemRole` (11) | `app/Activity/Notifications` |
| Go | gitea | none | `db.GetEngine` (246) | `services/cron` |
| Java | dolphinscheduler | none | `JSONUtils.parseObject` (203) | `dolphinscheduler-api/src/main/java/org/apache/dolphinscheduler/api/dto` |
| C# | bitwarden/server | none | `CoreHelpers.GenerateComb` (63) | `src/Core/Models/Data` |
| Rust | atuin | none | `uuid_v7` (19) | `crates/atuin-scripts/src` |
| Kotlin | kotlinconf-app | none | `PreviewHelper` (38) | `app/shared/src/commonMain/kotlin/org/jetbrains/kotlinconf/screens` |

Dropped on the way, by step 2:

- CTFd: `create_ctfd`, `destroy_ctfd`, `login_as_user`, `register_user` and `gen_challenge` (under
  `tests`), `Users` (a class) and `db` (an object). `admins_only` and `set_config` tie at 38, and
  `admins_only` comes first.
- BookStack: the 33 names above 11 are classes, and so are `BookQueries`, `TrashCan` and `Webhook` at
  11.
- gitea: `unittest.AssertExistsAndLoadBean` (349) lives in `models/unittest`, a package of test
  fixtures that every function of takes a test handle. It was read as a test directory. This is a
  judgement: the directory is not called `test` or `tests`.
- dolphinscheduler: `JSONUtils` and `User` (classes) and `DbType` (an enum).
- bitwarden/server: the 15 names above 63 are enums, classes and exceptions. `GlobalSettings`, a
  class, ties at 63.
- atuin: `Settings`, `HistoryId`, `History`, `SqliteStore` and `Sqlite` (types), `fl` (a macro),
  `paseto_v4` (a module), and `RehydrateSession` (a struct tied at 19).
- kotlinconf-app: `KotlinConfTheme` (59) names both an object and a function. The importing files
  read the object's colors and type, and only two files call the function, so it was dropped as an
  object.

Only names in a file of the target language were read. CTFd and BookStack also list JavaScript and
TypeScript names, which this rule does not ask for.

### Why each area allows the import

**CTFd.** The new file `CTFd/reports.py` sits in the package's top-level area, beside the other
blueprints (`scoreboard.py`, `users.py`). It is in the same `CTFd` Python package as
`CTFd/admin/notifications.py`, which imports the decorator from `CTFd.utils.decorators`. No linter
setting restricts imports inside the package.

**BookStack.** The new class `app/Activity/Notifications/AdminRecipients.php` is under `app/`, which
`composer.json` maps to the `BookStack\` namespace, the same autoload as `app/Users/UserRepo.php` and
`app/Permissions/EntityPermissionEvaluator.php`, which call the method.

**gitea.** The repository is one Go module, `gitea.dev`. `services/user` and `services/repository`
already import `gitea.dev/models/db`. The depguard rules in `.golangci.yml` forbid that package only
under `modelmigration`, so `services/cron` may import it.

**dolphinscheduler.** The new class is in the `dolphinscheduler-api` Maven module, whose `pom.xml`
depends on `dolphinscheduler-common`, where the method lives. Files in the same module, such as
`api/permission/TaskSubWorkflowPermissionChecker.java`, already call it.

**bitwarden/server.** The new record is in the `Core` project, the same project as `CoreHelpers`, and
`src/Core/AdminConsole/Entities/Group.cs` in that project calls the method. The method is marked
`[Obsolete]` in favour of `CombGuid.Generate()`, but `.editorconfig` sets CS0618 to `suggestion`, so
calling it does not break the build under `TreatWarningsAsErrors`.

**atuin.** `crates/atuin-scripts/Cargo.toml` depends on `atuin-common`, which exports
`utils::uuid_v7` publicly, as `atuin-ai` and `atuin-client` already use it. No entry in `clippy.toml`
forbids it or `Uuid::now_v7`. The new module also needs a `mod` line in the crate's `lib.rs`.

**kotlinconf-app.** The `app:shared` Gradle module declares `api(project(":app:ui-components"))` in
`commonMain`, where `PreviewHelper` is a public top-level function, and it already has the Compose
tooling preview dependency. Every current caller is inside `app:ui-components`.

### What a reader should know before the runs

- bitwarden/server: `GenerateComb` is one line that calls `CombGuid.Generate()`, and its `[Obsolete]`
  note says to call that instead. Amended before any session: the check also counts a call to
  `CombGuid.Generate()`, since a session that follows the note reuses the same code. It counts a call
  anywhere in the new file, with or without a `using`, since the `Core` project reaches
  `Bit.Core.Utilities` from its own namespaces without one.
- atuin: `uuid_v7` is one line, `Uuid::now_v7()`. A session that calls that directly fails the check.
- kotlinconf-app: the helper is a preview wrapper, so the task asks for a preview.
