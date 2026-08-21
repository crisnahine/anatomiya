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
already says `102 Cypress specs under cypress/integration; 7 vitest under src`. Before it edits a
file, the directory's own numbers are in context: which style the siblings use, how consistently,
and out of how many.

## Quick start

Needs Node 22 or newer. Ruby dimensions also want Ruby 3.4 or newer on `PATH` (the first release
shipping `prism` 1.x as a default gem). Linux, macOS and Windows run the suite and an end-to-end
scan, pin and check on every commit.

```
/plugin marketplace add crisnahine/anatomiya
/plugin install anatomiya@crisnahine
```

The marketplace lists a second plugin, `ultracode-anywhere`, which shares this repository and
nothing else: no code here imports it and the npm package excludes it. It keeps Claude Code's
standing Workflow orchestration on at any effort level, and its own README says what it does and
does not restore. Installing `anatomiya` does not install it.

`/plugin install` copies the files and does not install anything, and the scanner has two runtime
dependencies, `oxc-parser` and `flow-remove-types`. Install them once:

```
/anatomiya:setup
```

That runs `npm install` in the plugin's own directory. It is the only command that installs
anything and the only one that reaches a package registry: `/anatomiya:scan`, `/anatomiya:check`
and `/anatomiya:pin` never call it. Outside Claude Code it is `node bin/anatomiya.mjs setup`. On
Windows it prints the npm command for you to run by hand, because npm ships there as a batch file
and nothing here spawns a shell. `/anatomiya:doctor` says which engines answered and what to do
about one that did not.

Or skip the plugin and run it from a clone:

```
git clone https://github.com/crisnahine/anatomiya
cd anatomiya && npm install
node bin/anatomiya.mjs scan /path/to/your/repo
```

Then, in the repository you want mapped:

```
/anatomiya:scan
```

It writes `.claude/rules/anatomiya-overview.md`, one file per area beside it, and
`.claude/anatomiya/facts.json`. Pass `--dry-run` to see the plan without writing anything.

To keep the map out of git:

```
exclude="$(git rev-parse --git-common-dir)/info/exclude"
echo '.claude/rules/anatomiya-*.md' >> "$exclude"
echo '.claude/anatomiya/' >> "$exclude"
```

`--git-common-dir` rather than `.git`, because inside a linked worktree `.git` is a file holding a
pointer. The common dir is shared, so one set of lines covers every worktree.

Those two lines are everything a scan leaves behind. The hook that re-delivers the map after every
turn and every tool call is declared by the plugin, in its own `hooks/hooks.json`, so nothing is
written into your settings. Versions 0.2.4 through 0.2.6 did write one into
`.claude/settings.local.json`, where the plugin path it names is never substituted and Claude Code
refuses the hook by name on every prompt; a scan takes that entry out when it finds one, and leaves
everything else in the file alone.

> [!NOTE]
> A session that is already running still holds the old map. Restart to pick up the new one.

## What it prints

A real run against a 2,468 file React and TypeScript repository, on a laptop:

```
2468 files, 127 areas, 1568ms, root /Users/me/code/app
114 of 1507 claims stated, the rest print as counts
baseline 67dacc6c, 0 files changed since origin/HEAD
205 files in no area
wrote 128 files
```

### The overview, loaded on every turn

`.claude/rules/anatomiya-overview.md` has no `paths` key, so it is in context before the agent
reads or writes anything. Trimmed from its 127 area lines:

```markdown
---
generator: anatomiya
---

# Repository map

Facts counted from this repository's own code, per directory.
A claim states how many sites conform out of how many were eligible.

Read a file before editing it: these notes load when you read, not when you grep.
When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.

## Areas (127)

- cypress/integration — 39 files, 1 stated
- src/components — 170 files, 2 stated
- src/components/base — 122 files, 2 stated
- src/hooks — 55 files, 2 stated

...

## Not covered

- 205 source files sit in no area (too few per directory)
- memory, GC and I/O behaviour: runtime only, nothing static to count
```

### What lives where

The overview's first section says where things already live: which kinds of files each directory
holds, how they are tested, and what the directory extracts versus inlines. This is the
`empire-flippers/client` section from the 35-repository acceptance run in
[docs/measurements/2026-08-17-what-lives-where.md](docs/measurements/2026-08-17-what-lives-where.md),
verbatim:

```markdown
## What lives where

- src/pages: 1003 .tsx (JSX), 188 .ts and 71 other; 2 vitest specs under __tests__; 0 of 1003 have a namesake test; 186 sibling modules named types/schema/mapper; 214 files inline a helper
- src/components: 504 .tsx (JSX), 65 .ts and 106 other; 2 vitest specs; 1 of 504 has a namesake test; 66 sibling modules named index/schema/types; 117 files inline a helper
- src/queries: 314 .ts, 1 .tsx; 0 of 314 have a namesake test
- cypress/integration: 102 Cypress specs
- src/hooks: 47 .tsx (JSX), 23 .ts; 0 of 47 have a namesake test; 23 sibling modules named mapper/payoutContext/schema; 6 files inline a helper
- src/utils: 53 .ts, 10 .js and 4 other; 3 vitest specs under __tests__; 4 of 52 have a namesake test under src/utils/__tests__; 60 sibling modules named assert/balanceTransaction/buyerProfileValidation; 0 files inline a helper
- src/layouts: 42 .tsx (JSX), 11 .jpg and 21 other; 0 of 42 have a namesake test; 6 sibling modules named constants/utils/hooks; 4 files inline a helper
- and 3 more directories holding 434 files
- tests: 103 Cypress specs under cypress/integration; 7 vitest under src; 0 of 1003 .tsx files have a namesake test

Match sibling test shape; skip tests where siblings have none.
Match directory granularity; don't extract into a sibling module what the directory's files inline.
```

Two vitest specs beside 102 Cypress specs is the denominator an agent writing the next test needs,
and it is why the section counts rather than naming a preferred runner. The two sentences at the
bottom carry no number of their own, because the numbers are the lines above them.

### One area file, in full

An area file carries a `paths` key, so it loads only when the agent reads a file underneath it:

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
failure is returned, not thrown: no convention. 0 of 1 sites (ratio)
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
| 122 | file count | source files in the area |

The first pair says how consistent the habit is. The second says how much of the area the claim can
speak for at all. Both are needed, because a predicate that only recognises 3 of 20 files will
cheerfully print `12 of 12 sites` and read like an iron law. Printing `3 of 20 files` next to it is
the only thing that lets a human catch a wrongly narrow predicate.

Ratios are over sites, never over files. Counting files instead was measured flipping 10 of 39
verdicts, in both directions: it hid real conventions and it manufactured false ones.

A line ending in `no convention. 4 of 30 sites (ratio)` means the gate named in the parentheses
stopped the claim. A line ending in `(matches model default)` cleared every gate but is also what
the model writes unprompted, so it spends no directive line; `check` still enforces it at full
severity. A claim reading `files here are named kebab-case` learned its class from the area's own
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
partial, or there was no merge base, so a clean run under a cap is a weaker signal rather than a
clean bill.

## How it is tested

Every counting rule is measured before it ships, on a 35-repository public corpus (react, vscode,
discourse, rails applications, monorepos). Two acceptance runs are committed as
[docs/measurements](docs/measurements): the layout harness re-derives every printed number
independently on all 35, and `npm run e2e:corpus` drives the shipped CLI from a fresh clone of each
repository through scan, a byte-identical rescan, pin, check, and a synthetic violation the check
must catch. The unit suite runs under `node --test` with enforced coverage floors, and CI runs it on
Linux, macOS and Windows. The number of tests is not written down here: `node --test` prints it on
every run.

## Limits

Read this section before deciding.

**The map loads when the agent reads a file, and only then.** A `paths` rule attaches on a Read
tool call or an `@file` mention. It does not load on grep, on glob, on `cat` through bash, or on an
edit with no prior read. An agent that greps its way to a line and edits it never sees the area
file; the overview, which has no `paths` key, is the one part that always loads. That is a real
ceiling on coverage, not a rough edge.

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
phase of a fan-out that it costs.

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
with a layout section and no claims in it. One of the 57 needs the type checker and is the only
thing `scan --deep` adds: `a call chain stays inside one type`. It is off by default because the
checker was measured about 26x slower than the parse and whole-program, so it cannot be narrowed to
the files you changed; `--deep` needs the optional `typescript` dependency and the scanned
repository's own dependencies on disk, and says on the map when the checker answered badly.

**Small directories are not covered.** A directory needs `clamp(round(sqrt(N) / 6), 3, 8)` source
files to be an area. On the example above, 205 of 2,468 files sat in no area, and the overview says
so on every scan. The 9 file-to-file obligations are the newest part: a repository that keeps its
companions somewhere unusual scores zero against a habit it plainly has, which is why the count of
companions found elsewhere prints beside the ratio.

**Who gets the most out of it**: repositories where a meaningful share of pull requests are
agent-authored, with many directories and mechanical per-file obligations. A solo repository with
no shared habit to count states very little, by design: one person's habit still needs the author
gate's second opinion. The full numbers and their caveats are in [docs/why.md](docs/why.md).

## Learn more

- [DECISIONS.md](DECISIONS.md) is the build contract: 160 numbered decisions, each with the
  measurement or the review finding that forced it. Why a threshold is where it is, why the parser
  runs in child processes, why there is no hook: that is the file.
- [docs/why.md](docs/why.md) is the longer argument and the full numbers.
- [docs/how-it-works.md](docs/how-it-works.md) is the mechanical walkthrough, close enough to
  predict what the tool prints on your repository before you run it.

## Development

```
npm install
node --test 'test/**/*.test.mjs'
```

ES modules, `.mjs`, Node 22 or newer, two runtime dependencies.
