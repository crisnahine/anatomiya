# What a migration's SQL, a nested route and a lock's clock rest on

Research notes, October 2026. Five fixes in anatomiya 0.17.0 change how a fact outside this
repository is read: the SQL a Rails migration hands its database, a route on a class nested in
another, the rename lines `git diff --name-status` prints, how a file is replaced, and how a lock's
timestamp is judged. Each claim below names where it comes from:

- **doc**: a first-party page, quoted, with its URL
- **read**: a first-party source file, with what to search for in it

Every page and file was read on 2026-10-24, from the branch head named. Line numbers drift; the
quoted text is what to search for.

## A migration's SQL, under three databases

A Rails migration does not say which database it runs on, so `migration_schema_only` and
`migration_reversible` read its SQL under the rules of PostgreSQL, MySQL and SQLite, and a statement
any of the three would run counts. Where the three disagree:

| Construct | PostgreSQL | MySQL | SQLite |
|---|---|---|---|
| `/* a /* b */ c */` | nests, ends after `c */` | ends after `b */` | ends after `b */` |
| `--x` | a comment | not one: `--` needs a space or a control character after it | a comment |
| `#` to the line's end | an operator character | a comment | not a comment |
| `\'` inside `'...'` | a backslash then the end of the string (9.1 and later) | an escaped quote | a backslash then the end of the string |
| `` `name` `` | not a quote | an identifier quote | an identifier quote |
| `/*! ... */` | a comment | SQL that runs | a comment |
| `$tag$ ... $tag$` | a string | not a string | not a string |
| `E'...'` | a string with backslash escapes | not one | not one |

- **doc** PostgreSQL 18, Lexical Structure, https://www.postgresql.org/docs/current/sql-syntax-lexical.html:
  block comments "nest, as specified in the SQL standard but unlike C"; a dollar quote's tag "follows
  the same rules as an unquoted identifier, except that it cannot contain a dollar sign"; "A dollar
  sign ($) followed by digits is used to represent a positional parameter"; "A dollar-quoted string
  that follows a keyword or identifier must be separated from it by whitespace"; an escape string is
  "the letter E (upper or lower case) just before the opening single quote", where "a single quote
  can be included ... by writing \'".
- **read** `src/backend/parser/scan.l` (postgres master): `dolq_start [A-Za-z\200-\377_]`, so a tag
  cannot start with a digit; `xcdepth` counts nested comments; the closing delimiter is an exact
  `strcmp` against the opening one.
- **doc** https://www.postgresql.org/docs/current/runtime-config-compatible.html:
  `standard_conforming_strings` "Beginning in PostgreSQL 9.1, the default is on"; the devel page:
  "Beginning in PostgreSQL 19, this parameter is always on".
- **doc** MySQL 8.4, https://dev.mysql.com/doc/refman/8.4/en/comments.html: "From a # character to
  the end of the line"; "the -- (double-dash) comment style requires the second dash to be followed
  by at least one whitespace or control character"; "Nested comments are not supported"; `/*!`
  content "MySQL Server parses and executes ... as it would any other SQL statement".
- **doc** MySQL 8.4, https://dev.mysql.com/doc/refman/8.4/en/string-literals.html: backslash
  sequences have special meaning "unless the NO_BACKSLASH_ESCAPES SQL mode is enabled", which the
  8.4 default `sql_mode` does not include.
- **doc** SQLite, https://www.sqlite.org/lang_comment.html: "Comments do not nest"; an unclosed `/*`
  runs "until the end of input". https://www.sqlite.org/lang_expr.html: "C-style escapes using the
  backslash character are not supported".

A dollar quote or an `E''` string is PostgreSQL's alone, so a statement that holds one is read
under PostgreSQL's rules only. A PostgreSQL `DO` block's body is PL/pgSQL, whose statements follow
`BEGIN`, `THEN`, `ELSE` and `LOOP`.

## A route on a class nested in another

- **read** `spring-webmvc/.../RequestMappingHandlerMapping.java` (spring-framework main):
  `getMappingForMethod` combines the method's mapping with `createRequestMappingInfo(handlerType)`
  alone, and `createRequestMappingInfo` searches with `SearchStrategy.TYPE_HIERARCHY`, whose
  enclosing-class predicate is `Search.never`. A class's `@RequestMapping` reaches the handlers it
  declares and its subclasses' handlers, never a nested class's.
- **read** `src/Mvc/Mvc.Core/src/Controllers/ControllerFeatureProvider.cs` (dotnet/aspnetcore
  main): "We only consider public top-level classes as controllers. IsPublic returns false for
  nested classes, regardless of visibility modifiers". A nested class's route attributes route
  nothing unless the application replaces the feature provider.

## A rename `git diff --name-status` prints

- **read** `diff.c` (git master), `diff_flush_raw`: the score is printed `"%c%03d%c"`, so a rename
  is `R` and three digits (`R100`, `R086`), then the old path, then the new one; `--name-status`
  shares the printer with `--raw`.
- **doc** `Documentation/config/diff.adoc`: `diff.renames` "Defaults to `true`" and "affects only
  `git diff` Porcelain"; `--no-renames` turns it off "even when the configuration file gives the
  default to do so". anatomiya asks with the flags spelled, never from configuration.

## Replacing a file another reader may open

- **doc** Node.js `doc/api/fs.md`: `'w'`, the default flag of `fs.writeFileSync`, means the file
  is "truncated (if it exists)" at open, so a reader can see it empty or half written.
- **doc** POSIX `rename()`, https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html:
  "a directory entry named new shall remain visible to other threads throughout the renaming
  operation and refer either to the file referred to by new or old".

- **read** `src/win/fs.c` (libuv v1.x): `fs__open` sets `FILE_ATTRIBUTE_READONLY` on a file it
  creates with a mode lacking the write bit and asks `CreateFileW` for the access the flags name;
  `fs__unlink_rmdir` deletes with `FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE`, clearing the
  attribute first where that is not supported, so a read-only file is removed; `fs__access` fails
  `W_OK` on a read-only file with `UV_EPERM`; `fs__rename` is `MoveFileExW(...,
  MOVEFILE_REPLACE_EXISTING)` with nothing of its own for a read-only destination.

So a person's `.claude/settings.local.json` is written to a temporary file beside it and renamed
over it, never written in place. A rename asks only the directory's permission, so a settings file
its owner made read-only is refused first, as a write in place refused it, and a file replaced this
way keeps its exact permission bits: a temporary file's mode decides nothing about the rename on
either system, and a read-only one is still removed.

## A lock stamped ahead of the clock

- **doc** ntpd, https://www.ntp.org/documentation/4.2.8-series/ntpd/: "the time is slewed if the
  offset is less than the step threshold, which is 128 ms by default, and stepped if above".
- **read** `src/timesync/timesyncd-manager.c` (systemd main): `#define NTP_MAX_ADJUST 0.4`, past
  which the clock jumps.
- **doc** Windows Time, https://learn.microsoft.com/en-us/windows-server/networking/windows-time-service/windows-time-service-tools-and-settings:
  `MaxAllowedPhaseOffset` "The default value for stand-alone clients and servers is 1", above which
  "W32Time sets the computer clock directly".
- **read** `lib/lockfile.js` (proper-lockfile 4.1.2): `stat.mtime.getTime() < Date.now() -
  options.stale`, so a lock stamped ahead is never broken early. **read** `src/filelock/_soft.py`
  (filelock main): a soft lock is taken over where `owner_is_stale`, by whether its owner process is
  gone, not by its age.

A clock can step either way at any moment, so a lock's own timestamp says nothing within a step of
now. A lock is judged by whether its process is alive while its stamp is within the stale window of
now, in either direction, and is dead past that window whatever its pid names.

## Not settled

- Whether MySQL runs `/*!` followed by one to four digits: the manual says it is "handled as a
  normal MySQL comment", the 8.4 lexer source lexes it as code. The reading here runs every `/*!`
  body as MySQL SQL, which errs toward counting a statement.
- Which error `MoveFileExW` returns while another process holds the target open, and whether its
  replace is atomic: Microsoft's page says neither.
