# anatomiya

anatomiya counts what a repository actually does, per directory, and writes those counts into
`.claude/rules/`, where a coding agent picks them up when it opens a file in that directory. They do
not load on a grep, on a glob, or on an edit with no prior read. That ceiling is measured, and it is
the first thing under [Limits](#limits).

It does not write opinions. Every line it emits is a count with a denominator, taken from your own
tracked source, and it only states a rule when that count clears every gate. When a count fails a
gate, the count still prints and the rule does not.

## Who it is for

| Gets the most out of it | Gets the least |
|---|---|
| Repositories where a meaningful share of pull requests are agent-authored | Repositories where review is mostly product copy, design disagreement, or prose |
| Repositories with mechanical per-pull-request obligations: a changeset file, a newsfragment, a paired migration | Repositories with one or two authors and no shared habit to count, where the author gate blocks most of the map |
| Large JavaScript, TypeScript or Ruby trees with many directories | Anything not JavaScript, TypeScript or Ruby, which gets an empty map |

The agent-authored case is the strongest thing in the measurements and it is also the weakest
claim. Across ten public repositories, the three with heavy agent-authored pull requests scored the
top three preventable shares. That grouping was made after looking at the results, so it is a
hypothesis with a mechanism behind it, not a statistical finding. The mechanism: an agent has no
memory of the last review, so it re-earns the same comment every time, and a counted map is the
only thing in the loop that does remember. Full numbers and caveats in [docs/why.md](docs/why.md).

One correction to that table before you trust it. The per-pull-request obligations are what makes a
repository's preventable share high in the measurement. Nine of the 40 dimensions that ship today are
file-to-file obligations, so a model without its spec is counted; a changeset file, which is owed per
pull request rather than per file, is not. Those repositories are the ones the design is aimed at,
not the ones it already serves fully.

## Install

Needs Node 22 or newer. Ruby dimensions also want Ruby 3.4 or newer on `PATH`, which is the first
release shipping `prism` 1.x as a default gem; 3.3 ships 0.19 and is rejected by version.

| Platform | State |
|---|---|
| Linux | the suite and an end-to-end scan, pin and check run on every commit |
| macOS | the same |
| Windows | the same, with one guard less: there is no `ps`, so a runaway parse is caught by the five-second timeout rather than by the memory poll |

Windows is tested, not assumed. Two things had to change for it: a replaced environment needs a valid
`%SystemRoot%` before an interpreter will start, and the repository root is resolved to a native path
because git prints forward slashes there. The hostile-filename defences are untestable on Windows,
which forbids a newline in a filename outright, and those tests skip with that reason on the page. Without it, Ruby files are reported as unexamined rather than guessed at.

```
/plugin marketplace add crisnahine/anatomiya
/plugin install anatomiya@crisnahine
```

The scanner has one runtime dependency, `oxc-parser`. Install it once in the plugin directory:

```
npm install --omit=dev
```

Or skip the plugin and run it from a clone:

```
git clone https://github.com/crisnahine/anatomiya
cd anatomiya && npm install
node bin/anatomiya.mjs scan /path/to/your/repo
```

### First run

In the repository you want mapped:

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

`--git-common-dir` rather than `.git`, because inside a linked worktree `.git` is
a file holding a pointer and `.git/info/exclude` is not a path. The common dir is
shared, so one pair of lines covers the main checkout and every worktree.

A session that is already running still holds the old map. Restart to pick up the new one.

## What it prints

A real run against a 2,468 file React and TypeScript repository, on a laptop:

```
2468 files, 127 areas, 1568ms, root /Users/me/code/app
114 of 1507 claims stated, the rest print as counts
baseline 67dacc6c, 0 files changed since origin/HEAD
205 files in no area
wrote 128 files
```

`.claude/rules/anatomiya-overview.md` has no `paths` key, so it loads on every turn. Trimmed here
from its 127 area lines:

```markdown
---
generator: anatomiya
---

# Repository map

Facts counted from this repository's own code, per directory.
A claim states how many sites conform out of how many were eligible.

Read a file before editing it: these notes load when you read, not when you grep.

## Areas (127)

- cypress/integration — 39 files, 1 stated
- cypress/integration/admin — 11 files, 0 stated
- cypress/integration/login — 10 files, 2 stated
- src — 41 files, 1 stated
- src/components — 170 files, 2 stated
- src/components/base — 122 files, 2 stated
- src/hooks — 55 files, 2 stated
- src/queries — 109 files, 1 stated
- src/utils — 65 files, 1 stated

...

## Not covered

- 205 source files sit in no area (too few per directory)
- memory, GC and I/O behaviour: runtime only, nothing static to count

Generated files: 128 under .claude/rules/anatomiya-*.md
Any other file there was not written by this tool.
```

One area file, printed in full. It carries a `paths` key, so it loads only when the agent reads a
file underneath it:

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
repository 114 of 1,507 slots cleared the gates. The rest print as one line of counts each,
which is what a reader needs to tell "we have no convention here" from "the tool missed it".

## What a claim means

`67 of 74 sites across 70 of 122 files` is not a style rule. It is a count, and the denominators
are the point.

| Number | Name | Means |
|---|---|---|
| 67 | conforming | sites that match the pattern |
| 74 | candidates | sites in this area where the construct appears at all |
| 70 | applicability | files holding at least one candidate |
| 122 | file count | source files in the area |

Read `31 of 44 sites across 12 of 20 files` as two separate facts. First: of the 44 places in this
area where the construct appears, 31 follow the pattern. Second: those 44 places live in 12 of the
area's 20 files.

The first pair says how consistent the habit is. The second says how much of the area the claim can
speak for at all. Both are needed, because a predicate that only recognises 3 of 20 files will
cheerfully print `12 of 12 sites` and read like an iron law. Printing `3 of 20 files` next to it is
the only thing that lets a human catch a wrongly narrow predicate.

Ratios are over sites, never over files. Counting files instead was measured flipping 10 of 39
verdicts, in both directions: it hid real conventions and it manufactured false ones.

A line ending in `no convention. 4 of 30 sites (ratio)` means the gate named in the parentheses
stopped the claim. The counts print anyway, so a badly set threshold costs one sentence rather than
a wrong rule.

## The three commands

| Command | What it does |
|---|---|
| `/anatomiya:scan` | Walks tracked source, counts every dimension per directory, applies the gates, rewrites the map, and reports what it could not cover: files in no area, files that failed to parse, files over the size cap, and any file in `.claude/rules/` it did not write. |
| `/anatomiya:check` | Diffs the branch against its merge base and reports which stated conventions the branch broke, as MUST-FIX, FIX or NIT. |
| `/anatomiya:pin` | Accepts the current file population as the baseline the gates read, and prints which files enter and leave it. Without one, every claim is measured against the working tree and no finding can exceed FIX. |

`check` blocks nothing. MUST-FIX means the baseline population held zero violations of that claim,
so this branch is the first. Severity caps at FIX whenever the map is stale, the predicate is
partial, or there was no merge base, so a clean run under a cap is a weaker signal rather than a
clean bill. A repository with no baseline pinned caps every finding at FIX, because nothing has
accepted a population that would make a site the first of its kind. `/anatomiya:pin` accepts one.

## Limits

Read this section before deciding.

**The map loads when the agent reads a file, and only then.** A `paths` rule attaches on a Read tool
call or an `@file` mention. It does not load on grep, on glob, on `cat` through bash, or on an edit
with no prior read. An agent that greps its way to a line and edits it never sees the map. That is a
real ceiling on coverage, not a rough edge.

**The measured preventable share is 8% to 15% of human review comments.** That is from 4,616 review
comments at one company and 3,015 from ten public repositories, hand-classified. It is not 8% to 15%
of review effort. Those are the cheapest comments in the corpus: they draw fewer replies than
average, and about a quarter of them are formatting nits.

**Removing some comments does not remove a review round-trip.** Preventable and unpreventable
comments land on the same pull request, so the pull request still comes back. Median round-trip
saving across ten repositories: 12%. Share of pull requests that went from reviewed to silent: 3.6%.

**It does not catch bugs.** Of 317 defect comments measured across ten repositories, 1 was
preventable by a conventions map. That is 0.3%, and nine of the ten repositories scored zero. Any
claim that this finds bugs earlier is false.

**It does not replace a linter.** A linter has an enforcement path. This has none: nothing it writes
blocks a commit, a push, or a merge, and `check` reports rather than fails. If your linter already
enforces a rule, the map restating it is waste, not defence in depth.

**JavaScript, TypeScript and Ruby, nothing else.** 40 dimensions ship: 15 for JavaScript, 20 reachable
in JSX, 20 for Ruby.
A Python, Go or Rust repository gets an overview with no claims in it.

**Nine file-to-file obligations, and they are the newest and least settled part.** They ask whether a
file of one shape ships with its companion: a model with its spec, a rake task with its spec. The
predicate is a directory pair, so a repository that keeps its model tests somewhere else scores zero
against a habit it plainly has. Measured on alphagov/whitehall, the `app/models` area scores 0 of 160
while 117 of those models have a test one directory deeper. That is why the count of companions found
elsewhere prints beside the ratio, and why a zero here means "read the audit" rather than "no habit".

**Files in small directories are not covered.** Both bounds scale with the corpus rather than sitting
at a fixed number. A directory needs `clamp(round(sqrt(N) / 6), 3, 8)` source files to be an area, so
3 in a small repository and 8 from about 2,000 files up. On the example above, which was at the floor
of 8, 196 of 2,468 files, about 8%, sat in no area at all, and the overview says so on every scan.
The area count is capped at `clamp(ceil(N / 16), 120, 500)`, which is 155 on that repository: raising
it to 1,000 was tried and split the same repository into 209 smaller areas, dropping stated claims
from 194 to 143, because a smaller area holds fewer candidates and more of them fail the gates.
Directories over the cap fold into their parent rather than being dropped, so repository size does
not cost coverage.

## Why it works the way it does

[`DECISIONS.md`](DECISIONS.md) is the build contract: 68 numbered decisions, each with the
measurement or the review finding that forced it. If you want to know why a threshold is where it
is, why the parser runs in child processes, or why there is no hook, that is the file.

[`docs/why.md`](docs/why.md) is the longer argument and the full numbers.
[`docs/how-it-works.md`](docs/how-it-works.md) is the mechanical walkthrough.

## Development

```
npm install
node --test 'test/**/*.test.mjs'
```

ES modules, `.mjs`, Node 22 or newer, one runtime dependency.

## License

MIT.
