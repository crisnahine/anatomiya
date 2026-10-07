# anatomiya

Counts what your repository already does, directory by directory, and puts those counts where a
coding agent reads them, so the agent writes your code the way your team writes it instead of
guessing.

anatomiya is a [Claude Code](https://claude.com/claude-code) plugin and a plain CLI. It parses your
tracked source, counts conventions per directory, and writes the result into `.claude/rules/`: an
overview that loads on every turn, and one file per directory that loads when the agent opens a
file there. `anatomiya check` then tells a branch which of those counted conventions it broke.

It does not write opinions. Every line it emits is a count with a denominator, taken from your own
code, and it only states a rule when the count clears every gate. When a count fails a gate, the
count still prints and the rule does not.

## The problem it works on

A coding agent has no memory of your last review. It writes a vitest file in a repository with 102
Cypress specs and 4 vitest files, extracts a helper module in a directory that inlines helpers, or
names a class off the majority style of GitHub instead of yours. A reviewer catches it, the next
session does it again. The research behind this failure class is collected in
[docs/research/why-agents-miss-house-style.md](docs/research/why-agents-miss-house-style.md):
conventions rarely reach the model, and when they do, prose rules decay while counted facts hold.

anatomiya is the denominator the agent lacked. Before it writes a test, the always-loaded overview
already says `102 of 103 Cypress specs under cypress/integration; 7 vitest under src`. Before it edits a
file, the directory's own numbers are in context: which style the siblings use, how consistently,
and out of how many.

## Quick start

Needs Node 22 or newer: on an older one `/anatomiya:doctor` names the version it found, every
other command refuses with the same sentence before it does any work, and the hooks answer with
nothing, so the map is neither delivered nor refreshed but no session is interrupted. Ruby dimensions also want
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
files under `plugins/anatomiya/grammars/`: Python, PHP, Go, Java, C#, Rust and Kotlin. Nothing is downloaded for them.
Each file is a copy of the one in its grammar's npm package, and `plugins/anatomiya/grammars/grammars.json` records
the package, the version and the SHA-256 of each.

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
`.claude/anatomiya/facts.json`, and `layout.json` beside it. Pass `--dry-run` to see the plan
without writing anything.

To keep the map out of git:

```
exclude="$(git rev-parse --git-common-dir)/info/exclude"
echo '.claude/rules/anatomiya-*.md' >> "$exclude"
echo '.claude/anatomiya/' >> "$exclude"
```

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

The two exclude lines, with the first naming a linked rules directory's target, are everything a scan
leaves behind. Four hooks are declared by the plugin, in its own
`hooks/hooks.json`, so nothing is written into your settings. The refresh keeps the map current, and
is described under [Staying current](#staying-current). The echo re-delivers the map after a turn or
a tool call when the context window does not already hold that same map. The notice runs before a
`Write`, an `Edit` or a `NotebookEdit`, and speaks only for a path where a test is going into a
directory whose kind of file has no test of its own anywhere: silent on every other write, which is
nearly all of them. It informs and never refuses. The reuse check runs when a turn ends, and only after a turn that added source
code: it asks, once per change, for one subagent to look for an existing function the new code could
call instead, and a session with no subagent tool to run that search itself. A migration, a schema
dump such as `db/schema.rb`, a generated file, and a file whose added lines hold nothing a function could be written with
are not asked about. `check` asks the same question of a whole branch, as `test_precedent`. Versions 0.2.4
through 0.2.6 did write one into `.claude/settings.local.json`, where the plugin path it names is never
substituted and Claude Code refuses the hook by name on every prompt; a scan takes that entry out when
it finds one, and leaves everything else in the file alone.

> [!NOTE]
> A session that is already running holds the overview it started with, and gets a changed one
> handed to it on its next prompt or tool call. A new session, a compaction or `/clear` loads the new
> one outright.

### Staying current

After the first `/anatomiya:scan` in a checkout, you do not run it again. At the start of every
session, and whenever HEAD moves (a checkout, a commit, a pull, a merge, a reset), the plugin starts
a background refresh that rescans only when something the map depends on changed: the commit, the
tracked files, the pin, this plugin's version, whether the repository holds packages, or where
`typescript` resolves. It watches the reflog, or, where there is none, the reftable backend's table
list or the index, so a repository created without a reflog or on reftable refreshes on every move
too. The hook returns at once and the scan runs detached, so nothing waits on it. Each rescan
decides on its own whether to run the type checker, the same way `/anatomiya:scan` does. It leaves
alone a checkout with no map of its own, a map, pin or refresh file committed to the repository, and
a repository in the middle of a merge or rebase. When a rescan fails it keeps the previous map,
tries again after half an hour or once the checkout moves, and the delivered map says the refresh
failed until one succeeds. A committed map's `.claude/anatomiya/layout.json` comes along but does
nothing after a clone: it names the committing checkout's record file, so the hooks read the record.

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
not hold its first pin. When the pin stops following for one of those reasons while the checkout
sits on the tip, or because git could not say, each session you start or resume opens with one line
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
React and TypeScript repository, on a 4-CPU Linux container, with the root path shortened:

```
693 files, 38 areas, 3409ms, root /Users/me/code/excalidraw
engines: oxc 0.149.0
87 of 716 claims stated, 48 match the model default, the rest print as counts
layout: 7 roots, 3 folded, tests: 96 of 98 test files under packages, 35 of 43 vitest under packages/excalidraw; roster lines: 14 areas with imports, 18 with reuse
no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. Inside Claude Code the plugin's background refresh pins one when this checkout sits on the tip of origin's default branch with nothing uncommitted, or `/anatomiya:pin` takes one by hand
15 files in no area: at the repository root, under the per-directory floor, or under a name no glob can spell
wrote 39 files
a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or /clear loads the whole map
```

### The overview, loaded on every turn

`.claude/rules/anatomiya-overview.md` has no `paths` key, so it is in context before the agent
reads or writes anything. This one and the area file below are from a 2,468 file React and
TypeScript repository, trimmed from its 127 area lines:

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

## Areas (127)

- cypress/integration — 39 files, 1 stated
- src/components — 170 files, 2 stated
- src/components/base — 122 files, 2 stated
- src/hooks — 55 files, 2 stated

...

## Not covered

- 205 source files sit in no area (at the repository root, under the per-directory floor, or under a name no glob can spell)
- memory, GC and I/O behaviour: runtime only, nothing static to count
```

### What lives where

The overview's first section says where things already live: which kinds of files each directory
holds, how they are tested, and what the directory extracts versus inlines. This is the
`empire-flippers/client` section, rendered by this version from the 35-repository acceptance corpus
first measured in
[docs/measurements/2026-08-17-what-lives-where.md](docs/measurements/2026-08-17-what-lives-where.md):

```markdown
## What lives where

- src/pages: 1003 .tsx (JSX), 188 .ts and 71 other; 2 vitest specs under __tests__; 0 of 1003 have a namesake test; 186 sibling modules named types/schema/mapper; 214 of 979 JSX files inline a helper
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 has a namesake test; 66 sibling modules named index/schema/types; 117 of 481 JSX files inline a helper
- src/queries: 314 .ts, 1 .tsx; 0 of 314 have a namesake test
- cypress/integration: 102 Cypress specs
- src/hooks: 47 .tsx (JSX), 23 .ts; 0 of 47 have a namesake test; 23 sibling modules named mapper; 6 of 32 JSX files inline a helper
- src/utils: 52 .ts, 10 .js and 5 other; 2 of 3 vitest specs under __tests__; 3 of 51 have a namesake test, 2 under src/utils/__tests__; 59 sibling modules; 0 of 1 JSX file inline a helper
- and 4 more directories holding 397 files, 91 files in 19 directories too small for a line of their own, and 20 at the repository root
- tests: 102 Cypress specs under cypress/integration; 7 vitest under src; 0 of 1003 .tsx files under src/pages have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
An instruction to always write a test does not override a directory with no test precedent. Put the test where the siblings put theirs, or leave it out and say which rule you followed.
```

Two vitest specs beside 102 Cypress specs is the denominator an agent writing the next test needs,
and it is why the section counts rather than naming a preferred runner. The sentences at the
bottom carry no number of their own, because the numbers are the lines above them.

### One area file, in full

An area file carries a `paths` key, so it loads when the agent reads a file underneath it, or from
Claude Code 2.1.288 once it has written or edited one there:

```markdown
---
generator: anatomiya
paths:
  - "src/components/base/**/*.{cjs,js,jsx,mjs,ts,tsx}"
---

# src/components/base  122 files

module-level bindings are const
  307 of 307 sites across 117 of 122 files, 13 authors

exported functions declare their return type
  67 of 74 sites across 70 of 122 files, 12 authors  (partial: some sites are not visible statically)
  except "src/components/base/AdminContainer.jsx"
  except "src/components/base/SelectListing.tsx"
  except "src/components/base/SelectTaskTemplateAutocreateTemplateOrModule.tsx"
  and 4 more

catch blocks use the error they caught: no convention. 2 of 2 sites (evidence)
failure is returned, not thrown: no convention. 0 of 1 site (ratio)
optional values are read with ?.: no convention. 5 of 96 sites (ratio)
module-level functions are declared with function, not assigned as arrows: no convention. 3 of 132 sites (ratio)
imports used only as types are marked import type: no convention. 2 of 71 sites (ratio)
relative imports carry the file extension: no convention. 0 of 132 sites (ratio)
defaults are taken with ??, not ||: no convention. 4 of 30 sites (ratio)
possibly-absent values are read with ?., not asserted with !: no convention. 121 of 121 sites (applicability)
an absent value is returned as null, not undefined: no convention. 3 of 5 sites (ratio)
collections are iterated with for...of, not .forEach: no convention. 2 of 9 sites (ratio)
```

Two claims stated out of twelve counted. That ratio is normal and it is the design working: on this
repository 114 of 1,507 slots cleared the gates. The rest print as one line of counts each, which
is what a reader needs to tell "we have no convention here" from "the tool missed it".

## What a claim means

`67 of 74 sites across 70 of 122 files` is not a style rule. It is a count, and the denominators
are the point.

| Number | Name | Means |
|---|---|---|
| 67 | conforming | sites that match the pattern |
| 74 | candidates | sites in this area where the construct appears at all |
| 70 | applicability | files holding at least one candidate |
| 122 | eligible files | files in the area written in the dimension's languages, less any whose syntax it could not read |

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

## What it measures

58 dimensions ship: 28 for JavaScript, 33 reachable in JSX, 25 for Ruby. Each is one claim about
one area, with a precision marker where the predicate cannot see every site. Among them:

- **Syntax habits**: error handling, `??` vs `||`, `?.` vs `!`, `import type`, hooks, handlers,
  translation calls, Rails migrations and callbacks, and the rest of the registry in
  [docs/how-it-works.md](docs/how-it-works.md).
- **Learned rows**: naming classes for files, functions and exports, interface and type prefixes,
  the base class and the included mixin, learned from the area's own plurality rather than declared.
- **9 file-to-file obligations**: a model ships with its spec, a rake task with its spec, learned
  from where the repository actually keeps its companions.
- **The layout roster**: the "What lives where" section above, counted over every tracked file.
- **Wrapper routing**: whether logging, HTTP and environment reads go through the repository's own
  module, offered only where the repository has adopted one.

A claim states only when it clears every gate: ratio at least 0.90, a Wilson lower bound on the
same counts, evidence spread over enough files and authors, and a pinned baseline population so an
agent's own output cannot raise the bar it is judged against. Gates and thresholds are in
[docs/how-it-works.md](docs/how-it-works.md); the reasons they sit where they sit are in
[DECISIONS.md](DECISIONS.md).

## The commands

| Command | What it does |
|---|---|
| `/anatomiya:scan` | Walks tracked source, counts every dimension per directory, applies the gates, rewrites the map, and reports what it could not cover: files in no area, files that failed to parse, files over the size cap, and any file in `.claude/rules/` it did not write. |
| `/anatomiya:check` | Reports which stated conventions the branch broke, as MUST-FIX, FIX or NIT. The base side is the merge base; the side being judged is the working tree, so it answers before you commit. |
| `/anatomiya:pin` | Accepts the current file population as the baseline the gates read, and prints which files enter and leave it. Without one, every claim is measured against the working tree and no finding can exceed FIX. |
| `/anatomiya:doctor` | Says whether each engine this parses with is installed, with the version it answered and, for one that is not ready, what to do about it. Exits 0 either way. |
| `/anatomiya:setup` | Installs the node-hosted engine's dependencies in the plugin's own directory. The only command that installs anything or reaches a package registry, and no other one runs it. On Windows it prints the command to run by hand. |

The three that read a repository take `--format json`, which prints the same answer as a record
rather than as lines, for a CI job or another tool to read. `check` also takes `--format github`,
which prints one annotation per finding.

`check` blocks nothing. MUST-FIX means the baseline population held zero violations of that claim,
so this branch is the first. Severity caps at FIX whenever the map is stale, the predicate is
partial, there was no merge base, or the area file never delivered the claim to that file in full,
so a clean run under a cap is a weaker signal rather than a clean bill. Each finding says which cap
applied.

## How it is tested

Every counting rule is measured before it ships, on a 35-repository public corpus (react, vscode,
discourse, rails applications, monorepos). Two acceptance runs are committed as
[docs/measurements](docs/measurements): the layout harness re-derives every printed number
independently on all 35, and `npm run e2e:corpus` drives the shipped CLI from a fresh clone of each
repository through scan, a byte-identical rescan, pin, check, and a synthetic violation the check
must catch. The unit suite runs under `node --test` with enforced coverage floors, and CI runs it on
Linux, macOS and Windows. The number of tests is not written down here: `node --test` prints it on
every run, and a case that skipped for a reason the run could have avoided, such as a temp directory
too long for the unix socket one fixture binds, fails the run rather than quietly lowering it.

## Limits

Read this section before deciding.

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
checkout can each carry a copy of its overview: up to one per call, once per context window and per
map. Inside the checkout the prompt delivers it first and the batch adds none.

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

**JavaScript, TypeScript and Ruby, nothing else.** A Python, Go or Rust repository gets an overview
with a layout section and no claims in it. One of the 58 needs the type checker and is the only
thing the type checker adds: `a call chain stays inside one type`. The scan runs the checker on its
own when the optional `typescript` 5.x dependency is installed, the scanned repository's own
dependencies are on disk inside it (a `node_modules` linked in from elsewhere is not read and counts
as no dependencies), and the repository has a root `tsconfig.json`, a root `tsconfig.base.json`
where there is none, or a TypeScript source file that is not a declaration file, and leaves it off
otherwise. Plain JavaScript run on the compiler's
defaults resolved 25% to 39% on three installed repositories, too little to state anything, and a
`jsconfig.json` does not count. It costs: a scan with it measured about 5x a plain one on a
3,800-file repository and about 10x on a 2,600-file one, and the checker is whole-program, so it
cannot be narrowed to the files you changed. The map says when the checker answered badly.

**Small directories are not covered.** A directory needs `clamp(round(sqrt(N) / 6), 3, 8)` source
files to be an area. On the excalidraw run above, 15 of 693 files sat in no area, and 205 of 2,468
on the repository the overview comes from, and the overview says so on every scan. The 9 file-to-file obligations are the newest part: a repository that keeps its
companions somewhere unusual scores zero against a habit it plainly has, which is why the count of
companions found elsewhere prints beside the ratio.

**Who gets the most out of it**: repositories where a meaningful share of pull requests are
agent-authored, with many directories and mechanical per-file obligations. A solo repository is not
held back by the author gate: where the whole history has one author there is no second opinion to
wait for, so every claim that clears the other gates is stated, and the overview says it is that
author's practice. A team repository still needs two authors behind a habit before stating it. The
full numbers and their caveats are in [docs/why.md](docs/why.md).

## Learn more

- [docs/plugin-contract.md](docs/plugin-contract.md) is what Claude Code requires of a plugin and a
  marketplace, read against the documentation and the CLI itself, with a source per claim and the
  version it was true of.
- [DECISIONS.md](DECISIONS.md) is the build contract: 263 numbered decisions, each with the
  measurement or the review finding that forced it. Why a threshold is where it is, why the parser
  runs in child processes, why no hook carries the map on its own: that is the file.
- [docs/why.md](docs/why.md) is the longer argument and the full numbers.
- [docs/how-it-works.md](docs/how-it-works.md) is the mechanical walkthrough, close enough to
  predict what the tool prints on your repository before you run it.

## Development

```
npm install --ignore-scripts
node --test 'test/**/*.test.mjs'
```

ES modules, `.mjs`, Node 22 or newer, three runtime dependencies.
