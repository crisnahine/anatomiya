# Using anatomiya

The [README](../README.md) is the short version. This is the whole of it: what the plugin needs,
what a scan writes and where, how the map stays current, what the agent is shown, what each
command does, the other tools it can write for, and where it stops.

## Install and first scan

Needs Node 22 or newer: on an older one `/anatomiya:doctor` names the version it found, every
other command refuses with the same sentence before it does any work, and the hooks answer with
nothing, so the map is neither delivered nor refreshed but no session is interrupted.

Ruby dimensions also want
`ruby` on `PATH` with `prism` 1.x: Ruby 3.4 or newer ships it, and on an older Ruby (2.7 or newer)
`gem install prism` adds it, which the parser then loads in place of the older default. That
`ruby` is whichever answers first in `PATH`'s absolute directories (an empty or relative entry
would resolve against the shared temp directory), started outside the repository and without the
variables a version manager selects by, so a `.ruby-version` or `.tool-versions` in the repository,
or a version `rbenv shell` chose, is not what picks it: an rbenv shim answers with its global Ruby.
A version file is the repository's to write, and asdf reads a `path:` version in one as a directory
to run the interpreter out of, so letting it choose would let the repository run a binary of its
own. To parse with another Ruby, make it the global one or put its `bin` first on `PATH`;
`/anatomiya:doctor` reports the prism the chosen one holds. Without one, the Ruby files go uncounted
and every other language is still mapped: the map and the scan say so and name the remedy, and an
area holding Ruby keeps what the last scan that could read it wrote. Linux, macOS and Windows run
the suite and an end-to-end scan, pin and check on every commit.

The Node has to answer to `node` on the `PATH` Claude Code runs hooks with, and Claude Code's own
installer does not provide one. The hooks run `node` by name through a shell, so on a machine with
none every prompt and tool call reports `node: not found` until Node is installed or the plugin is
disabled. The hooks cannot guard that themselves: the POSIX test that would silence it is a syntax
error in the PowerShell Claude Code falls back to on Windows without Git Bash, where they work today.

```
/plugin marketplace add crisnahine/anatomiya
/plugin install anatomiya@crisnahine
```

The scanner has three runtime dependencies, `oxc-parser`, `flow-remove-types` and
`web-tree-sitter`, and `/plugin
install` installs them for you: Claude Code runs `npm ci --ignore-scripts` in a plugin's own
directory when it finds a lockfile there, and this plugin ships one. There is no setup step in the
ordinary case.

`web-tree-sitter` is the WebAssembly runtime for the seven grammars the plugin carries as `.wasm`
files under `plugins/anatomiya/grammars/`: Python, PHP, Go, Java, C#, Rust and Kotlin. Nothing is downloaded for them, and none of the seven
needs its own toolchain on your machine: Node runs all of them.
Each file is a copy of the one in its grammar's npm package, and `plugins/anatomiya/grammars/grammars.json` records
the package, the version and the SHA-256 of each. `/anatomiya:doctor` loads them, hashes each
against that record, and prints how many passed on its `tree-sitter` line, `grammars: 7 of 7`; one
that does not load, that the runtime turns away by its language version, or that is not the file
the plugin shipped, is named there, and the fix is to reinstall the plugin, since no package install
writes a grammar file.

When nothing was installed, `/anatomiya:doctor` says so in its first line. When an install ran and
stopped short, its engine lines say which one did not load. One command answers both:

```
/anatomiya:setup
```

That runs `npm install` in the plugin's own directory. It is the only command that installs
anything and the only one that reaches a package registry: `/anatomiya:scan`, `/anatomiya:check`
and `/anatomiya:pin` never call it. Outside Claude Code it is `node plugins/anatomiya/bin/anatomiya.mjs setup`. On
Windows it prints the npm command for you to run by hand, because npm ships there as a batch file
and nothing here spawns a shell. `/anatomiya:doctor` says which engines answered and what to do
about one that did not.

Or skip the plugin and run it from a clone:

```
git clone https://github.com/crisnahine/anatomiya
cd anatomiya && npm install --ignore-scripts
node plugins/anatomiya/bin/anatomiya.mjs scan /path/to/your/repo
```

Then, in the repository you want mapped:

```
/anatomiya:scan
```

It writes `.claude/rules/anatomiya-overview.md`, one file per area beside it,
`.claude/anatomiya/facts.json`, and `layout.json` beside it. It also keeps
`history-authors.gz` and `history-cochange.gz` there: what it read of the history, so the next scan
reads from git only the commits it has not seen. Deleting either costs one full read of the history.
Pass `--dry-run` to see the plan without writing anything. It writes nowhere else unless the map is on for Cursor or GitHub Copilot
as well, which is [Other tools](#other-tools). The one other file a scan can change is
`.claude/settings.local.json`: where it still holds the hook entry versions 0.2.4 to 0.2.6 put
there, the scan takes that entry out.

To keep the map out of git:

```
exclude="$(git rev-parse --git-common-dir)/info/exclude"
echo '.claude/rules/anatomiya-*.md' >> "$exclude"
echo '.claude/anatomiya/' >> "$exclude"
echo '.cursor/rules/anatomiya-*.mdc' >> "$exclude"
echo '.github/instructions/anatomiya-*.instructions.md' >> "$exclude"
```

The last two lines match files that exist only when the Cursor and Copilot targets are turned on,
and do nothing otherwise.

Where `.claude/rules` is a link to a shared directory, such as `.claude/rules -> ../agents/rules`, the
map is written through it, and git sees those files only under the link's target. Name the target in
the first line instead: `echo 'agents/rules/anatomiya-*.md' >> "$exclude"`.

`--git-common-dir` rather than `.git`, because inside a linked worktree `.git` is a file holding a
pointer. The common dir is shared, so one set of lines covers every worktree. A worktree left with no
map of its own this way is handed its main checkout's counts by the hooks, labelled as such; run
`/anatomiya:scan` inside it for counts of its own branch. For worktrees Claude Code creates itself,
a `.worktreeinclude` at the repository root copies the map and the pin in when the worktree is made:

```
**/.claude/rules/anatomiya-*.md
**/.claude/anatomiya/facts.json
**/.claude/anatomiya/layout.json
**/.claude/anatomiya/baseline.json
```

The layout file saves time only where the copy keeps `facts.json`'s modification time. Elsewhere the
hooks read the record, as they would with no layout file.

The pin is the last line because the exclude above hides it along with the map, so the copied map
arrives with the pin it was checked against. A linked worktree with no pin of its own reads its main
checkout's, but only where that checkout can be named: a repository whose git directory is not the
checkout's own `.git` (moved out with `--separate-git-dir`) names none, and without the copied pin
its worktree checks as if nothing had been pinned. That copy is a snapshot
of the main checkout taken at that moment, with nothing saying so, where the hooks' borrowed map
carries its source. `docs/research/why-a-worktree-got-no-map.md` has the sources for both.

A Cursor or Copilot target is on per checkout, so a worktree that arrives without that target's
overview file starts with it off. To carry one in, add its line:

```
**/.cursor/rules/anatomiya-*.mdc
**/.github/instructions/anatomiya-*.instructions.md
```

The four exclude lines under [Install and first scan](#install-and-first-scan), with the first naming a linked rules
directory's target, cover everything a scan leaves behind: the first two on every scan, the last two
only where a target is on.

Four hooks are declared by the plugin, in its own `hooks/hooks.json`, so a scan adds nothing to your
settings. Versions 0.2.4 through 0.2.6 did write a hook entry into `.claude/settings.local.json`,
where the plugin path it names is never substituted and Claude Code refuses the hook by name on
every prompt; a scan takes that entry out when it finds one, and leaves everything else in the file
alone. What the four do:

- **The refresh** keeps the map current, and is described under [Staying current](#staying-current).
- **The echo** hands the overview back after a prompt or a tool call when no copy of that same map
  sits in the last 192 KiB of what the model reads, about 30k tokens at the 6.57 bytes per token A92
  measured, with no compaction since
  (A92). A long session gets it again about every 30k tokens, and a session's first prompt gets one
  beside the copy Claude Code loaded from the rules file, which the echo cannot see since that copy
  is not in the transcript it reads.
- **The notice** runs before a `Write`, an `Edit` or a `NotebookEdit`, and speaks only for a path
  nothing is at yet: where a test is going into a directory whose kind of file has no test of its
  own anywhere, or where the file is of a kind this repository's history adds together with another
  change (`A .rb file added here ships with an edit to "config/default.yml": 100 of the last 100
  changes that added one.`). It is silent on every other write, which is nearly all of them. It
  informs and never refuses. `check` asks the same questions of a whole branch, as
  `test_precedent` and `cochange`.
- **The reuse check** runs when a turn ends, and only after a turn that added source code: it asks,
  once per change, for one subagent to look for an existing function the new code could call
  instead, and a session with no subagent tool to run that search itself. A migration, a schema dump
  such as `db/schema.rb`, a generated file, and a file whose added lines hold nothing a function
  could be written with are not asked about. It reads ten languages and the script blocks of Vue and Svelte
  components: JavaScript, TypeScript and Ruby by a rule over their lines, and Python, PHP, Go, Java, C#, Rust and Kotlin by the file's tree,
  where an added comment, import or name bound to a literal asks nothing and any other added line
  asks. A file counts as the turn's work only when it was last written during one of the session's
  own tool calls, so a file another session or an editor saved in between is not asked about.

> [!NOTE]
> A session that is already running holds the overview it started with, and gets a changed one
> handed to it on its next prompt or tool call. A new session, a compaction or `/clear` loads the new
> one outright.

### Staying current

After the first `/anatomiya:scan` in a checkout, you do not run it again. At the start of every
session, and whenever HEAD moves (a checkout, a commit, a pull, a merge, a reset), the plugin starts
a background refresh that rescans only when something the map depends on changed: the commit, the
tracked files and what is staged, the pin, this plugin's version, whether the repository holds
packages, which root config the type checker reads (`tsconfig.json`, `tsconfig.base.json` or
neither), or where `typescript` resolves and at what version. It watches the reflog, or, where there is none, the reftable backend's table
list or the index, so a repository created without a reflog or on reftable refreshes on every move
too. The hook returns at once and the scan runs detached, so nothing waits on it. Each rescan
decides on its own whether to run the type checker, the same way `/anatomiya:scan` does, with one
exception: where the last scan measured the checker as degraded and nothing it reads has changed
since, the rescan keeps that verdict and does not run it. After a failed run of the checker the
next rescan runs it again, and from the second failed run in a row it keeps that verdict the same
way. It leaves
alone a checkout with no map of its own, a map, pin or refresh file committed to the repository, and
a repository in the middle of a merge or rebase. When a rescan fails it keeps the previous map,
tries again after half an hour or once the checkout moves, and the delivered map says the refresh
failed until one succeeds. A refresh that could not ask git a question before the rescan records
nothing, says nothing, and is tried again the next time the checkout moves or a session starts. A Cursor or Copilot directory a rescan could not write, for a locked file
or a missing write permission, is tried again each half hour for as long as it stays so. A scan run
by hand prints why and ends that retry until the checkout moves. A committed map's `.claude/anatomiya/layout.json` comes along but does
nothing after a clone: it names the committing checkout's record file, so the hooks read the record.

A map written by 0.14.0 or earlier is rewritten by the first scan or refresh of 0.15.0. Its record
always differs, and its overview or area files did on 24 of 60 measured repositories. A committed
map is not refreshed, so scan it by hand and commit the result. Expect:

- fewer test files where a `__tests__` directory, or a test tree that mirrors the source, holds
  fixtures, helpers, mocks or configs: a file there that exports something is no test, and neither
  is a Ruby file there that declares no case;
- a smaller sibling-module count beside a root's components, which counts only the files a test
  could be written for;
- more test files where tests are named by a dotted kind, `.unittest.`, `.integrationTest.` and
  five more;
- a co-change block in an area file, counted in the claims line, where the repository's history
  states one;
- at the area ceiling, a few more areas, given back by areas that count nothing, and under a
  pin 0.14.0 took, only once a pin is next taken;
- a directory name that holds a space or a double quote printed in quotes.

The 0.15.0 section of [CHANGELOG.md](../CHANGELOG.md) has the counts, measured on 60 repositories.

A session started in the directory that holds your checkouts, which has no map of its own, refreshes
and watches each mapped checkout directly below it, and the reuse check reads each one's change,
naming files from where the session started. A directory holding more than eight mapped checkouts
side by side gets neither, and neither does a checkout two levels down.

The pin follows the same way, but only onto commits the team has already accepted: when the checkout
sits exactly on the tip of `origin`'s default branch (or, where a clone's only remote has another
name, that remote's) with nothing uncommitted, and that tip arrived by a fetch or pull rather than
by a push from this clone, a ref written by hand, or a fetch from a path or a URL or into a
remote-tracking ref, the pin moves forward to it. A feature branch, a commit the remote has not
seen, an edited or staged file, a repository with no remote, and a clone that keeps no reflog never
pin. Nor does a commit this clone made that sits on the default branch's own line, however it got
there (`git push`, a push by URL, a teammate's commit on top): that is work pushed straight to the
shared branch, which nobody reviewed. A branch you push and merge through a pull request's merge
commit is pinned once pulled, since the merge is its review; accepting a direct push is
`/anatomiya:pin`, by hand. A commit you pushed from another machine before this clone existed does
not hold its first pin. A refresh that could not ask git for HEAD, the remote's tip, the pinned commit or which
of two pins is newer holds nothing: it ends, and the next one asks again. When the pin stops
following for one of those reasons while the checkout sits on the tip, or because git could not say
how the remote's branch last moved or who made a commit on it, each session you start or resume opens with one line
in your terminal saying why and at which commit, until a pin by hand, or a refresh that no longer
holds it, ends it; it is never put in the model's context, since the model is the author the pin
exists to keep from accepting its own work. Each automatic pin records what it accepted (the commit
it moved from and to, and how many files entered and left the population) in
`.claude/anatomiya/refresh.json`. In a fork workflow, where `origin` is your own fork, its default
branch is what the pin follows, so review there is what makes it accepted. `/anatomiya:pin` is still
there for a repository with no remote, or to accept a population by hand. A branch cut before the
pin does not read the files the default branch added since as missing, and a linked worktree with no
pin of its own reads its main checkout's.

## What it prints

A first run against [excalidraw](https://github.com/excalidraw/excalidraw) at `438d898`, a public
React and TypeScript repository, on an 11-core Apple M3 Pro, with the root path shortened. anatomiya
0.18.0 printed it:

```
693 files, 38 areas, 1225ms, root /Users/me/code/excalidraw
engines: oxc 0.155.0
90 of 715 claims stated, 48 match the model default, the rest print as counts
layout: 7 roots, 3 folded, tests: 96 of 98 test files under packages, 35 of 43 vitest under packages/excalidraw; roster lines: 14 areas with imports, 18 with reuse
no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. Inside Claude Code the plugin's background refresh pins one when this checkout sits on the tip of origin's default branch with nothing uncommitted, or `/anatomiya:pin` takes one by hand
15 files in no area: at the repository root, under the per-directory floor, or under a name no glob can spell
wrote 39 files
a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or /clear loads the whole map
```

The overview and the area file below are from that same run, so anyone can scan `438d898` and
compare them line for line.

### The overview, loaded on every turn

`.claude/rules/anatomiya-overview.md` has no `paths` key, so it is in context before the agent
reads or writes anything. Its "What lives where" section is shown in full under the next heading:

```markdown
---
generator: anatomiya
---

# Repository map

Facts counted from this repository's own code, per directory.
A claim states how many sites conform out of how many were eligible; "no convention" means the gate in parentheses stopped it, and its sites may still all agree.

Read a file before editing it: these notes load when you read, not when you grep.
When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.
When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion.

## What lives where

...

## Areas (38)

- 38 areas, each in its own file, loaded when you read one of its files

## Not covered

- 15 source files sit in no area (at the repository root, under the per-directory floor, or under a name no glob can spell)
- 122 files hold a language this map does not read (84 .scss, 33 .mdx, 3 .css, 2 .html); 128 configuration, data or prose files are counted by extension, and no row reads them (.json, .md, .yml); 2 files say a generator wrote them, so nothing here is counted from them
- memory, GC and I/O behaviour: runtime only, nothing static to count; a string is read only as an import path, JSX text, a doc comment, a quoted object key, a few Rails arguments (migration options, table and column names and SQL, method names, a spec's subject) or the URL path a route declares in JavaScript, Ruby, Python, Java, C# or Rust; i18n keys, CSS classes, event names, messages, links and request paths are not

Generated files: 39 under .claude/rules/anatomiya-*.md
Any other file there was not written by this tool.
```

Not covered is the map saying where it is silent, so a silent map is not read as one that checked.
A file in a language the map has no parser for, a template among them (`.erb`, `.hbs`, `.gjs`), is
named by extension. So is a configuration, data or prose file, which is counted and which no row reads.
The string clause is the same on every repository.

Three lines in every overview's head carry no count: the one that says area files load on a read, the
one that asks the agent to look rather than guess and to say what it could not check, and the one
that asks it to follow what the repository already does and finish the change. The sentences under
"What lives where" are written from the counts above them and appear only where those counts are
present. Each is a fixed sentence the plugin writes in every repository it maps, and each is listed
with its source under [Limits](#limits).

### What lives where

The overview's first section says where things already live: which kinds of files each directory
holds, how they are tested, and what the directory extracts versus inlines. This is excalidraw's,
from the same run; the section was first measured across the acceptance corpus in
[docs/measurements/2026-08-17-what-lives-where.md](measurements/2026-08-17-what-lives-where.md):

```markdown
## What lives where

- packages/excalidraw: 268 .tsx (JSX), 234 .woff2 and 333 other; 33 of 55 test files under tests; 25 of 35 vitest specs under tests; 12 of 200 have a namesake test under packages/excalidraw; 154 sibling modules named index/types/common; 85 of 251 JSX files inline a helper
- packages/element: 69 .ts, 13 .tsx (JSX) and 5 other; 23 of 24 test files under tests; 3 of 5 vitest specs under tests; 26 of 53 have a namesake test, 23 under packages/element/tests; 53 sibling modules; 7 of 12 JSX files inline a helper
- excalidraw-app: 23 .tsx (JSX), 17 .ts and 10 other; 2 test files under tests; 1 vitest spec under tests; 1 of 20 has a namesake test; 19 sibling modules; 5 of 21 JSX files inline a helper
- packages/common: 25 .ts, 3 .json and 3 other; 4 of 6 test files under tests; 1 vitest spec under src; 7 of 19 have a namesake test, 4 under packages/common/tests
- packages/math: 25 .ts, 2 .json and 2 other; 9 test files under tests; 9 of 16 have a namesake test under packages/math/tests
- examples: 10 .tsx (JSX), 7 .json and 21 other; 0 of 10 have a namesake test; 3 sibling modules; 0 of 9 JSX files inline a helper
- and 4 more directories holding 133 files, 36 files in 11 directories too small for a line of their own, and 23 at the repository root
- tests: 96 of 98 test files under packages; 35 of 43 vitest under packages/excalidraw; 12 of 200 .tsx files under packages/excalidraw have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
An instruction to always write a test does not override a directory with no test precedent. Put the test where the siblings put theirs, or leave it out and say which rule you followed.
```

`35 of 43 vitest under packages/excalidraw` and `25 of 35 vitest specs under tests` are the
denominators an agent writing the next test needs: they say where this repository keeps its tests
and how consistently, instead of naming a runner the model would pick anyway.

### One area file, in full

An area file carries a `paths` key, so it loads when the agent reads a file underneath it, or from
Claude Code 2.1.288 once it has written or edited one there:

```markdown
---
generator: anatomiya
paths:
  - "packages/element/tests/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"
---

# packages/element/tests  26 files

kinds: 13 .ts, 13 .tsx (JSX); 23 test files; 3 vitest specs

imports used only as types are marked import type
  78 of 78 sites across 20 of 26 files, 35 authors  (partial: some sites are not visible statically)

relative imports are written without the file extension
  68 of 68 sites across 22 of 26 files, 37 authors
  not counted: a specifier naming a directory, an asset, or a .coffee or .es6 source, and a dynamic import()

possibly-absent values are read with ?., not asserted with !
  178 of 182 sites across 10 of 26 files, 31 authors  (partial: some sites are not visible statically)
  except "packages/element/tests/binding.test.tsx" (2 sites)
  except "packages/element/tests/duplicate.test.tsx" (2 sites)

most files here import: @excalidraw/excalidraw/tests/helpers/api (81%), @excalidraw/common (65%)
failure is returned, not thrown: no convention. 0 of 1 site (ratio)  (partial: some sites are not visible statically)
module-level bindings are const: 59 of 59 sites (matches model default)
async functions handle their own failures: no convention. 0 of 142 sites (ratio)  (partial: some sites are not visible statically)
optional values are read with ?.: no convention. 1 of 2 sites (ratio)  (partial: some sites are not visible statically)
module-level functions are assigned to variables, not declared with function: no convention. 34 of 38 sites (ratio)
defaults are taken with ??, not ||: no convention. 1 of 5 sites (ratio)
collections are iterated with for...of, not .forEach: no convention. 16 of 31 sites (ratio)  (partial: some sites are not visible statically)
test cases are declared with it(), not test(): 538 of 540 sites (matches model default)
assertions are written with expect(): 1947 of 1947 sites (matches model default)  (partial: some sites are not visible statically)
functions in files that hold JSX are named camelCase: 11 of 11 sites (matches model default)
type aliases carry no prefix: no convention. 4 of 4 sites (concentration)
files here that hold no JSX are named camelCase: no convention. 10 of 10 sites (evidence)
```

Three directives out of fifteen counted, and four more that cleared every gate but are what the model
writes unprompted, so they print as counts too. That ratio is normal and it is the design working: on
this run 90 of 715 claims cleared the gates, and 48 of those match the model's default. The rest
print as one line of counts each, which is what a reader needs to tell "we have no convention here"
from "the tool missed it".

## What a claim means

`178 of 182 sites across 10 of 26 files` is not a style rule. It is a count, and the denominators
are the point.

| Number | Name | Means |
|---|---|---|
| 178 | conforming | sites that match the pattern |
| 182 | candidates | sites in this area where the construct appears at all |
| 10 | applicability | files holding at least one candidate |
| 26 | eligible files | files in the area written in the dimension's languages, less any whose syntax it could not read |

The first pair says how consistent the habit is. The second says how much of the area the claim can
speak for at all. Both are needed, because a predicate that only recognises 3 of 20 files will
cheerfully print `12 of 12 sites` and read like an iron law. Printing `3 of 20 files` next to it is
the only thing that lets a human catch a wrongly narrow predicate.

Ratios are over sites, never over files. Counting files instead was measured flipping 10 of 39
verdicts, in both directions: it hid real conventions and it manufactured false ones.

A line ending in `no convention. 4 of 30 sites (ratio)` means the gate named in the parentheses
stopped the claim, and the overview's second line says so to the agent. A line ending in
`(matches model default)` cleared every gate but is also what the model writes unprompted, so it
spends no directive line; `check` still enforces it at full severity. A partial dimension carries
its `(partial: ...)` warning on either kind of line. A claim reading `files here are named kebab-case` learned its class from the area's own
files, so the same row states a different sentence in a different repository.

A claim ending `, in .ts files` was counted over those files alone. The area also holds three or
more files the dimension is never asked of, `.vue` components or Ruby files, and the area file
loads for them too, so the line says which files it speaks for. One or two such files earn no
clause.

## What it measures

66 dimensions ship: 29 for JavaScript, 34 reachable in JSX, 28 for Ruby, and one more for
JavaScript and JSX that needs the type checker. A Vue or Svelte script
block is asked most of the JavaScript ones: 25 for Vue, 25 for Svelte. Four are asked of the
languages a tree-sitter grammar reads, each where measured repositories differ on it: 3 for
Python, 3 for PHP, 1 for Go, 3 for Java, 2 for C#, 2 for Rust, 1 for Kotlin. Each is one claim
about one area, with a precision marker where the predicate cannot see every site. Among them:

- **Syntax habits**: error handling, `??` vs `||`, `?.` vs `!`, `import type`, hooks, handlers,
  translation calls, Rails migrations and callbacks, and the rest of the registry in
  [docs/how-it-works.md](how-it-works.md).
- **Learned rows**: naming classes for files, functions and exports, interface and type prefixes,
  URL path segments a route table, a server or a Rails routes file declares, and those a Python
  decorator or router call, a Spring mapping, an ASP.NET attribute or minimal API, or an actix or
  rocket attribute or router call declares, the base class, the included
  mixin and the strong-parameter call, learned from the area's own plurality rather than declared.
- **9 file-to-file obligations**: a model ships with its spec, a rake task with its spec, learned
  from where the repository actually keeps its companions.
- **What ships together**: for a kind of file the default branch's changes added at least 35 times,
  the one file those changes also edited, or the kind of file they also added, read from the newest
  20,000 first-parent changes up to the pin where there is one. It reads history rather than code,
  so any language can get one, and it is no dimension: of 60 measured repositories, 9 state one, 25
  claims in all.
- **The layout roster**: the "What lives where" section above, counted over every tracked file.
- **Wrapper routing**: whether logging, HTTP and environment reads go through the repository's own
  module, offered only where the repository has adopted one.

A claim states only when it clears every gate: ratio at least 0.90, a Wilson lower bound on the
same counts, evidence spread over enough files and authors, and a pinned baseline population so an
agent's own output cannot raise the bar it is judged against. Gates and thresholds are in
[docs/how-it-works.md](how-it-works.md); the reasons they sit where they sit are in the rows
[DECISIONS.md](../DECISIONS.md) lists.

## The commands

| Command | What it does |
|---|---|
| `/anatomiya:scan` | Walks tracked source, counts every dimension per directory, applies the gates, rewrites the map, and reports what it could not cover: files in no area, files that failed to parse, files over the size cap, and any file in `.claude/rules/` it did not write. With `--targets cursor,copilot` it writes the same map for those tools too ([Other tools](#other-tools)). |
| `/anatomiya:check` | Reports which stated conventions the branch broke, as MUST-FIX or FIX, and as a NIT where it goes against a count the map printed without stating a rule or, for a new test, where the run could not tell what the change added. It also reports a new file whose kind the history adds together with another change the branch does not make. The base side is the merge base; the side being judged is the working tree, so it answers before you commit. |
| `/anatomiya:pin` | Accepts the current file population as the baseline the gates read, and prints which files enter and leave it. Without one, every claim is measured against the working tree and no finding can exceed FIX. |
| `/anatomiya:doctor` | Says whether each engine this parses with is installed, with the version it answered and, for one that is not ready, what to do about it. Exits 0 either way. |
| `/anatomiya:setup` | Installs the packages the two node-hosted engines load, in the plugin's own directory. The grammar files are not packages: they ship in the plugin, and a damaged one is fixed by reinstalling the plugin. The only command that installs anything or reaches a package registry, and no other one runs it. On Windows it prints the command to run by hand. |

The three that read a repository take `--format json`, which prints the same answer as a record
rather than as lines, for a CI job or another tool to read. `check` also takes `--format github`,
which prints one annotation per finding.

`check` blocks nothing. MUST-FIX means the baseline population held zero violations of that claim,
so this branch is the first; for a co-change claim, that every one of the last changes that added
such a file also made the other change. Severity caps at FIX whenever the map is stale, the
predicate is partial, there was no merge base, or the area file never delivered the claim to that
file in full, and a co-change finding also where the history was read from a base branch or HEAD
rather than a pin, where no one area file carries the claim, or where the branch touches more than
40 files. A clean run under a cap is a weaker signal rather than a clean bill. Each finding says
which cap applied.

## Other tools

The same map can be written for Cursor and for GitHub Copilot. It is off until a scan is asked for
it, or a clone brings a committed overview file with it. To ask:

```
node plugins/anatomiya/bin/anatomiya.mjs scan /path/to/your/repo --targets cursor,copilot
```

Inside Claude Code, ask `/anatomiya:scan` for the Cursor or Copilot map and it passes the flag. The
scan then writes two more copies, an overview and one file per area in each, with the frontmatter
that tool reads: `.cursor/rules/anatomiya-*.mdc` for Cursor and
`.github/instructions/anatomiya-*.instructions.md` for Copilot. Name one of the two to get one.

```
wrote 4 files
wrote 4 files under .cursor/rules for Cursor
wrote 4 files under .github/instructions for GitHub Copilot
```

The three copies hold one body: the same directories, sentences, areas and counts. A Cursor or
Copilot overview is two lines longer than the `.claude/rules` one, 42 where that one is 40, for the
line that makes it load on every turn and the line saying a scanner wrote it, and three where an
area has no file there.

You pass the flag once. A target stays on while its `anatomiya-overview` file is in its directory,
so every later scan, and the background refresh, keeps writing it. Nothing else remembers the
choice. A scan stopped part way through turning a target off still leaves it off: the next scan
without `--targets` removes what that one left. The flag names the whole set: `--targets cursor`
drops Copilot, and `--targets claude` turns both off and removes the files this tool wrote there. A
scan that drops a target says so: `removed 4 files under .github/instructions`, then
`.github/instructions is off now`. Deleting a target's overview file by hand turns it off as well,
and the next scan removes the area files beside it. The two directories stay, holding none of this
tool's files. In a clone that brings a committed overview file, the first scan says on that
directory's line which file switched the target on and what switches it off:

```
wrote 3 files under .cursor/rules for Cursor, which .cursor/rules/anatomiya-overview.mdc switched on: `scan --targets claude` switches it off
```

`/anatomiya:doctor`, run inside the repository, prints a line for each target that is on, or `off at
the next scan` for one a killed scan was turning off, or `could not be read` for one the record
names that it cannot read, and a second where its directory holds other entries named `anatomiya-*`.

Both directories are ones people write rules in, so a scan is strict there. It never writes over a
file it did not write: where one sits at a name the map needs, a scan that names the target refuses,
writes nothing anywhere, and says which file to move. It writes through no link: `.cursor`,
`.cursor/rules`, `.github` and `.github/instructions` each have to be a real directory of the
repository, or not exist yet. Your own rule files there are not opened and not reported. Only
entries named `anatomiya-*` are looked at.

A target that is on and whose directory cannot be written does not stop a scan that did not name
it. The scan writes the `.claude/rules` map, leaves that directory as it is and says so:

```
.cursor/rules could not be written (.cursor/rules is not writable), so nothing there was written or removed: fix its permissions, then scan again
```

A scan that names the target refuses.

A file there that is locked or read-only is the same case one level down. A scan that did not name
the target puts back what it had replaced in that directory, writes the `.claude/rules` map and the
other copy, exits 0 and says:

```
.cursor/rules could not be written (.cursor/rules/anatomiya-overview.mdc could not be replaced (EPERM)), so nothing there was written or removed: close what holds it or change its mode, then scan again
```

A scan that names the target stops there and puts back every file it had replaced. A locked file in
`.claude/rules` stops any scan the same way.

The last two exclude lines under [Install and first scan](#install-and-first-scan) keep both copies out of git. To commit
one instead, leave its exclude line out and commit its files. GitHub's documentation says the cloud
agent and code review on GitHub.com read `.github/instructions` from the repository. Nothing here
observed that.

What the background refresh does then depends on which files git tracks:

- **A target's overview file.** The refresh leaves that target's files as the commit has them and
  keeps the other copies current.
- **A target's area files and not its overview.** The refresh rewrites them, so `git status` shows a
  change nobody made. Commit the overview with them.
- **The `.claude/rules` map.** The refresh leaves the repository alone: nothing is rewritten, the
  Cursor and Copilot copies included, whether git tracks those or not.

A scan you run by hand rewrites every copy that is on.

A teammate's clone of a repository that commits a copy holds the files and no record of them: the
record is in `.claude/anatomiya/`, which the exclude lines keep out of git. A plain scan removes an
area file only where the record names it. So in that clone the file of an area that has since gone
stays in the directory as a rule file, and every scan counts it:

```
.cursor/rules holds 1 entry named anatomiya-* that this scan neither wrote nor removed; it was left as it is
```

To clear it, run `scan --targets claude`, which removes every file of this tool from both
directories, then name the targets again.

What a Cursor or Copilot user gets is the map's files, and not the rest of this tool.

**No hooks.** The four hooks are Claude Code's. In Cursor and Copilot nothing hands the overview
back during a long run, nothing speaks before a test is written where none belongs, nothing asks
about reuse when a turn ends, and nothing rescans. Those copies change when a Claude Code session's
refresh, or a scan by hand, rewrites them. Each overview there says under its heading that the code
is right where the two disagree.

**The patterns are looser.** Neither reader that was run takes a pattern that leaves a subtree out,
and the other Copilot surfaces document none, so an area file's patterns can match files the area
excluded, such as a `fixtures` directory under `test`, and its last lines say which. VS Code also
matches a pattern under any parent directory. An area under a directory name one of the tools
cannot be given, one holding a double quote for instance, has no file there, and the scan says how
many areas have none:

```
1 area has no pattern Cursor can be given, so no file under .cursor/rules covers it
```

**VS Code is offered each area twice with the Copilot target on.** VS Code already reads
`.claude/rules/`, so its agent is offered the `.claude/rules` file and the `.github/instructions`
file for the same area. The Copilot target is for the Copilot surfaces that read only
`.github/instructions`.

**Delivery is not measured.** For Cursor it was read from the code of the 3.20.21 app, where an
area's rule goes to the agent the first time it reads a matching file, and it was not watched in a
running Cursor. For Copilot the generated files were run through the parser and matcher of VS Code
1.140.0, and no other Copilot surface was read or run. Both copies are files in the right place and
the right shape. Only the channel into Claude Code is measured.

**Codex is not written for.** By its documentation it reads one `AGENTS.md` per directory, with no
path scoping and 32 KiB for all of them by default, so an area file has no place there.

## How it is tested

Every counting rule is measured before it ships, on a 35-repository acceptance corpus: 33 public
repositories (react, vscode, discourse, rails applications, monorepos) and 2 private ones.
[docs/measurements/corpus.md](measurements/corpus.md) lists every corpus repository with its commit.
Two acceptance runs are committed as [docs/measurements](measurements): the layout harness
re-derives every printed number independently on all 35, and `npm run e2e:corpus` drives the shipped CLI from a fresh clone of each
repository through scan, a byte-identical rescan, pin, check, and a synthetic violation the check
must catch. The unit suite runs under `node --test` with enforced coverage floors, and CI runs it on
Linux, macOS and Windows. The number of tests is not written down here: `node --test` prints it on
every run, and a case that skipped for a reason the run could have avoided, such as a temp directory
too long for the unix socket one fixture binds, fails the run rather than quietly lowering it.

## What it costs

The plugin is free. What a session pays is tokens, in three places:

- The command listing, about 150 tokens on every session, which `claude plugin details
  anatomiya@crisnahine` prints as its always-on cost.
- The overview, which Claude Code loads from `.claude/rules/` at the start of a session, and which the
  echo hands back once 192 KiB of what the model reads, about 30k tokens, holds no copy of it. It was
  2.3 to 3.4 KB on rubocop, forem, mastodon, discourse and excalidraw. A directory's own file loads
  when the agent reads a file there, 0.5 to 2.3 KB at the median on the same five
  ([docs/measurements/2026-10-25-readme-examples.md](measurements/2026-10-25-readme-examples.md)).
- The reuse check, one subagent after each turn that added source code.

Measured over eleven tasks and two models, 20 sessions per arm, the median session with the plugin
cost 1.4 to 3.8 times as much as one without
([docs/measurements/2026-10-25-plugin-on-off.md](measurements/2026-10-25-plugin-on-off.md) and
[the blind replication](measurements/2026-10-26-blind-replication.md)). The task
the reuse check skips still cost 1.9 times as much on Opus 5.5, so the map and the other hooks cost
something on their own.

## Measuring it on your own repository

The README's results come from `scripts/ab-scenario.mjs`, and it runs on any clone. Write a scenario
file like the ones in `scripts/ab/scenarios/`: the commit, a prompt, the checks that say a session did
the task, and the checks that say it did it your repository's way. Commit it before the first trial,
then:

```
node scripts/ab-scenario.mjs --repo <a clone at that commit> --scenario <your scenario> --model <a model> --trials 20
```

Each trial runs `claude -p` with a shell, in a temporary clone of your repository, with your
environment. Run it where an agent with a shell on that code can do no harm: a container, or an
account that holds no credentials beyond the model's. The result page and a record of every trial
land under `docs/measurements/`; `--raw` keeps every written file as well, to score again later with
`--from-raw`.

## Limits

Read this section before deciding.

**Not every line it writes is a count.** The counts are taken from your code. Beside them the plugin
writes a few fixed sentences in every repository it maps, each one listed here with what it rests on:

| Where | The sentence | When | What it rests on |
|---|---|---|---|
| overview head | "Read a file before editing it: these notes load when you read, not when you grep." | always (Cursor and Copilot get their own wording) | how Claude Code attaches a `paths` rule, measured in `docs/research/when-a-hook-can-refresh-the-map.md` |
| overview head | "When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify." | always | vendor wording, measured on no repository here (`docs/research/one-line-that-stops-guessing.md`) |
| overview head | "When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion." | always | Anthropic's `default_to_action` wording, measured on no repository here (`docs/research/one-line-that-finishes-in-house-style.md`). It asks the agent to act rather than suggest |
| What lives where | "Match sibling test shape; skip tests where siblings have none." | where the overview prints a tests line | one review of one repository (H13) |
| What lives where | "Match directory granularity; don't extract into a sibling module what the directory's files inline." | where a root counts helpers | the same review (H13) |
| What lives where | "An instruction to always write a test does not override a directory with no test precedent. Put the test where the siblings put theirs, or leave it out and say which rule you followed." | where the repository pairs tests with sources somewhere and one printed directory has none | a session in which a testing skill's rule won over the counts (H39, H47). It can win over your own instruction |
| before a write | "Put it where the siblings put theirs, or leave it out and say which rule you followed." | a new test file in a directory with no test precedent | the same rows |
| before a write | "Make those changes in the same change, or say why this file does not need them." | a new file of a kind the history ships with a companion | the co-change counts (C55, D14) |
| end of a turn | asks one subagent for an existing function each added function duplicates, to call it and delete the copy | a turn that added source code | measured: 24 of 24 found on four hard cases, 3 of 12 with no hook (A91) |
| every echo | "Where this and the code disagree, the code is right and the map is stale" | each time the echo hands the overview back | the map's own staleness (A24) |

A team that wants different wording, or none, can turn the plugin off for a repository and keep the
map, which is plain files in `.claude/rules/`.

**The model-default table is dated.** A claim that clears every gate but matches what the model
writes unprompted prints as a count rather than a directive (A15). Which claims match was measured on
`claude-opus-5` on 2026-08-16, 12 to 30 samples per row for 24 of the 66 rows, and the rest are
seeded unmeasured. A newer model can differ on any row, so the split between directives and counts
is that engine's.

**The map loads when the agent reads a file, and from 2.1.288 after it writes one.** A `paths` rule
attaches on a Read tool call or an `@file` mention, and from Claude Code 2.1.288 on a Write or Edit
too, once that call has landed. It does not load on grep, on glob, on `cat` through bash, or on a
notebook edit, and on an older build not on an edit with no prior read. From 2.1.288 an agent that
greps its way to a line and edits it sees the area file only after the edit is made, and on an older
build it never does; the overview, which has no `paths` key, is the one part that always loads
first. That is a real ceiling on coverage, not a rough edge.

The Read has to be attempted, not to succeed: a Read of a path that does not exist yet still
attaches the area file for it, so an agent checking whether its target is already there gets the
counts at the moment it is about to write. And one delivery lasts one context window rather than
the session; a compaction or a resume rebuilds the window and the map comes back from disk, the
overview at the boundary and an area file on the next read that matches it.

**A subagent gets the map, and where you started the session decides when.** Run at the mapped
repository's root, the overview reaches a subagent on its first turn, before it reads anything: that
is what five subagent transcripts here show. Run one directory up, with the repository as a
subdirectory, nothing loads until a file under it is touched, so a subagent that only greps and
`cat`s receives nothing at all. Same ceiling as above, one level worse, and it is the exploration
phase of a fan-out that it costs. Started one directory up, the echo has nothing to deliver on the
prompt either, since a prompt names no file, so the first batch of parallel tool calls into a mapped
checkout carries the overview. It carries one copy between its calls where Claude Code gives the
plugin a data directory (`CLAUDE_PLUGIN_DATA`): the first call to deliver leaves a batch claim there
and the others read it. Without one, the batch can carry one copy per call, once per 192 KiB of what
the model reads and per map. Inside the checkout the prompt delivers it first, so the first batch adds none; a batch
that later finds the window run out delivers as above.

**The measured preventable share is 8% to 15% of human review comments.** That is from 4,616 review
comments at one company and 3,015 from ten public repositories, hand-classified. Those are the
cheapest comments in the corpus: they draw fewer replies than average, and about a quarter are
formatting nits. Removing them does not remove a review round-trip: median round-trip saving across
ten repositories was 12%.

**It does not catch bugs.** Of 317 defect comments measured across ten repositories, 1 was
preventable by a conventions map. Any claim that this finds bugs earlier is false.

**It does not replace a linter.** A linter has an enforcement path. This has none: nothing it
writes blocks a commit, a push, or a merge, and `check` reports rather than fails. If your linter
already enforces a rule, the map restating it is waste, not defence in depth.

**JavaScript, TypeScript and Ruby are read in depth, and seven more languages for one to three
dimensions each.** Python, PHP, Go, Java, C#, Rust and Kotlin are read through the seven grammars the plugin
carries. Each gets the layout section, its test files and namesake tests by the language's own
naming, and the rows counted under [What it measures](#what-it-measures). A map of one of them
mostly prints counts and states a claim only where a directory is consistent: a scan of fastapi
states 1 of 82 claims, hugo 0 of 103, ktor 0 of 133 and tokio 14 of 33. A Go package that sits at the
repository root, which is how a Go library is laid out, is an area of its own, named `the repository
root`, whose pattern (`/*.go`) matches the root's `.go` files and none below: gin's map has 4 areas,
40 files in the root one, and its overview says `53 at the repository root` and `2 source files sit
in no area (at the repository root, under the per-directory floor, or under a name no glob can
spell)`. No other language gets one. With `scan --targets cursor,copilot`, Cursor gets that area as
`*.go`, and Copilot gets no file for it, since VS Code matches such a pattern at every depth: the
Copilot overview says `1 area has no pattern GitHub Copilot can be given, so no file here covers it:
the repository root.` None of the seven gets the
type checker or the "most imported from here" lines. The end-of-turn reuse check asks about all
seven, reading each changed file's tree in the hook's own process. The notice before
a test file is written, and the finding `check` reports for one, know a test by its language's naming in six of the seven. Neither says anything of a Go, Java,
Kotlin or C# test that sits in the one place its language's tool reads it from. No `.rs` file is
asked, since cargo collects by place and a Rust test has no name. A file of any other language is not read: "What lives where" counts it, and
"Not covered" counts the ones whose extension it knows, `.c`, `.swift`, `.css` and `.sql` among them.

Each of the seven gets its test files and the layout section. None gets a row on how its identifiers
are named, or an imports row. A row is asked of a language only where three measured repositories of
it differ. For Java, C#, Rust and Kotlin each language's own parser was run in a container over the
same three repositories: every file a grammar could not read in those four is one its compiler
accepts, and no file a grammar read is one its compiler rejects
(`docs/measurements/2026-10-08-reference-parsers.md`, `DECISIONS.md` B60, B63):

| Language | A test file is | Rows asked | Measured or weighed, and not asked |
|---|---|---|---|
| Python | `test_*.py`, `*_test.py`, `conftest.py` | doc comments, return types, URL path words | handlers (1.0000 in all three); naming (0.99 to 1.00); imports (a default) |
| PHP | `*Test.php` under a test tree | doc comments, return types, handlers | naming (1.00); imports (the language has no wildcard form) |
| Go | `_test.go` | doc comments | naming (a name's case is its visibility); imports (a dot import is 1 of 9,863 lines) |
| Java | `*Test`, `*Tests`, `*IT` under a test tree | doc comments, handlers, URL path words | naming (1.0000 in all three); imports (a default) |
| C# | `*Tests`, `*Test` under a test tree | doc comments, URL path words | handlers (repositories differ by 0.10); naming (1.0000); imports (no wildcard form) |
| Rust | a `.rs` file directly under a crate's `tests`; one holding a `#[test]` with a `tests` directory anywhere above it, or named `tests.rs` | doc comments, URL path words | naming (the compiler lints it); imports (repositories differ by 0.10) |
| Kotlin | `*Test`, `*Tests`, `*IT` under a test tree | doc comments | handlers (repositories differ by 0.12); naming (0.95 to 1.00); imports (ktlint's default rule) |

The bar is one repository under 0.90 and a spread of 0.15. No filename claim is asked of any of the
seven, for the same reason. The URL row is learned, so its bar is that the class differs between
repositories of one language: in Python netbox states kebab-case and healthchecks snake_case, and in
Java thingsboard states camelCase where dolphinscheduler holds kebab-case short of the evidence
gate. PHP, Go and Kotlin get no URL row: a Laravel `routes/` directory folds into the root and gets
no area, one measured Go repository holds 20 or more sites, and no Kotlin application does. The
files of rows C50 to C54, C62 and H52 under `docs/decisions/` hold the numbers.

**A grammar reads less than its language.** A file a grammar cannot read is left out of every
count, and the scan and the overview say how many there were: `82 files could not be read by this
tool's grammar` on ktor. Measured on three repositories per language, that is under 1% of the
lines of every Python, PHP, Go, Java and Rust one, 4.35% of serilog's C#, and 1.32% to 7.88% of the
three Kotlin ones, where the grammar misses new syntax (context parameters, `$$` strings) and some
old (a local named `in1`, `get(` on the line after a `val`). A C# file with `#if` inside an
expression is read with the first branch of each conditional kept, and the scan counts those files
too. A Python stub (`.pyi`) is not read.

One of the 66 needs the type checker and is the only
thing the type checker adds: `a call chain stays inside one type`. The scan runs the checker on its
own when the optional `typescript` 5.x dependency is installed, the scanned repository's own
dependencies are on disk inside it (a `node_modules` linked in from elsewhere is not read and counts
as no dependencies), and the repository has a root `tsconfig.json`, a root `tsconfig.base.json`
where there is none, or a TypeScript source file that is not a declaration file, and leaves it off
otherwise. Plain JavaScript run on the compiler's
defaults resolved 25% to 39% on three installed repositories, too little to state anything, and a
`jsconfig.json` does not count.

It costs: on typeorm, where a scan reads 3,347 files, a scan with the checker took 5.6 to 5.7
seconds against 1.3 without it, about 4.5 times, and the checker is whole-program, so it
cannot be narrowed to the files you changed. The map says when the checker answered badly, and
prints no count for this claim then. While that answer stands and the plugin version, the root
config, and the size and modification time of `node_modules` and of the install record in it are
unchanged, a background refresh keeps the answer without running the checker; `/anatomiya:scan` always runs it.
A failed run, such as a checker whose child aborted, is followed by one more run on the next
refresh, and its answer is kept the same way from the second failed run in a row.
An edit to a config the root config extends or references does not end a carried verdict.
An install starts no refresh by itself, so after one the checker is measured by the next refresh a
commit, a checkout or a pull starts, or by a scan you run. On four repositories that read degraded, that
took a refresh from 4.4s to 21.2s down to 1.2s to 3.8s.

**A Vue or Svelte file is read for its script block, never its template.** The `<script>` blocks
of a `.vue` or `.svelte` file go through the same parser as a `.ts` file, and the lines `check`
reports are the file's own. Three dimensions whose answer is in the template are left out for both:
`module-level bindings are const`, `optional values are read with ?.` and `imports used only as
types are marked import type`. `failure is returned, not thrown` is left out for Vue, and `a module
that exports a hook exports one` for Svelte. The five JSX dimensions and the type-checked one are
never asked of a component. Nothing is counted about markup: its directives, its event bindings, or
which components it renders. The overview says so for any repository that holds a `.vue` or `.svelte` file:
`of 17 .vue and .svelte files only the script block is read, not the template`.

**Small directories are not covered.** A directory needs `clamp(round(sqrt(N) / 6), 3, 8)` source
files to be an area. On the excalidraw run above, 15 of 693 files sat in no area, and 208 of 2,468
on the repository the overview comes from, and the overview says so on every scan. The 9 file-to-file obligations are the newest part: a repository that keeps its
companions somewhere unusual scores zero against a habit it plainly has, which is why the count of
companions found elsewhere prints beside the ratio.

**At the area ceiling, a place goes to an area that counts something.** The fold that keeps a large
repository under its area ceiling gives the places of areas that count nothing back to the largest
areas it folded. An area that counts but states nothing still takes a place, and so does one holding
JavaScript or TypeScript that counts nothing, since whether the type checker will count there is not
known when a pin is taken. A pin of a repository at the ceiling parses it once to learn which areas
count nothing, which took 5 to 14 seconds more on the four corpus repositories that reach it, two of
which get places back. Under a pin the partition holds still until a pin is next taken.

**What ships together needs history.** The co-change claims are read from the default branch's
first-parent changes, so a shallow clone, such as a CI checkout at depth one, states none, and a git
older than 2.31 states none either. A kind of file added fewer than 35 times in those changes gets
no claim, so most repositories state none: 51 of 60 measured.

**A git that could not be asked stops the command.** Where a git call ends with no exit code, its
clock run out on a loaded machine or a signal sent to it, `scan`, `pin` and `check` stop, write
nothing and print the question at exit 1: `anatomiya: git could not be asked whether commit <sha> is
still in this repository: git was ended by SIGTERM after 120000 ms`, or the same for `which commit
<ref> names`, `for the merge base of <a> and <b>` and `whether this repository folds case`. The same holds for a
listing, a range or a pinned file: `which files <sha> holds`, `what changed from <sha> to <ref>`,
`which files differ from <sha>`, `for <path> at <sha>`, and for `check`, `whether this clone is
shallow`, `which refs hold the name <base>`, `which parents HEAD's commit records` and `for the
oldest commit this clone holds`. Run it again. Read as git saying no, the first of those dropped a map to counts over a commit that was
still there. A repository git itself cannot open stops them the same way, with git's own text.

**Where it changes what the agent writes**: measured on eleven tasks and two models, it changed the
outcome where the answer lived outside the files next to the change (an existing helper in another
directory: 209 of 280 sessions called it with the plugin, 53 of 280 without, three of the seven tasks
picked by a rule fixed in advance), and not where the
neighbouring files already showed the habit, which both models followed without it
([docs/measurements/2026-10-25-plugin-on-off.md](measurements/2026-10-25-plugin-on-off.md) and
[the blind replication](measurements/2026-10-26-blind-replication.md)). A solo
repository is not held back by the author gate: where the whole history has one author there is no
second opinion to wait for, so every claim that clears the other gates is stated, and the overview
says it is that author's practice. A team repository still needs two authors behind a habit before
stating it.
