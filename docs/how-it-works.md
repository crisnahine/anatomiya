# How it works

A mechanical walkthrough. The goal is that you can read this and predict roughly what the tool will
print on your repository before you run it.

The pipeline: collect the corpus, discover areas, parse every file in a pool of child processes,
fold parse results into per-area counts, apply gates, render, write.

## 1. The corpus

The file list comes from `git ls-files -z`, NUL-delimited, and nothing else.

Tracked files only, because a filesystem walk picks up `.env`, `master.key`, an `.npmrc` with a
token and a `.git/config` with credentials in the remote URL, and a sample path or a quoted line
then leaves the machine. `-z` rather than a newline split, because git permits newlines inside a
path and a newline split turns one hostile filename into two corpus entries.

| Filter | Value |
|---|---|
| Source extensions | `.ts .mts .cts .tsx .js .jsx .mjs .cjs .rb .rake .gemspec .jbuilder` |
| Source filenames | `Rakefile`, `Gemfile`, `config.ru`, matched whole so a `Gemfile.lock` is not one |
| Denied outright | `.git/`, `.env*`, `*.pem *.key *.p12 *.pfx *.jks *.keystore`, `.claude/settings.local.json`, `id_rsa`, `id_ed25519`, `.netrc`, `.npmrc` |
| Excluded directories | `node_modules`, `vendor`, `.yarn`, `fixture`, `fixtures` and any `<word>_fixture(s)`, `__fixtures__`, `snapshot`, `snapshots`, `__snapshots__`, `test_cases`, `testdata`, `test-data`, `golden`, `goldens` and their `-test(s)` or `_test(s)` compounds (`golden-test`), `__mocks__`, `mocks`, `cases` and a camelCase word ending in `Cases` (`configCases`), `dist`, `coverage`, `.next`, and `build` unless a `src` directory sits above it. Not `examples`: 8,967 paths in a 35-repository corpus match it and much of that is maintained code |
| Caps | none on the repository; 1 MB per file, which skips a bundle or a compiled file and says so. Measured across 35 repositories, no hand-written source exceeds 850 KB, and every file between 1 and 4 MB sat at the parse timeout boundary, flipping between crashed and parsed with machine load |

Fixture and vendor directories are excluded because that code is deliberately unidiomatic. In one
measured repository, 18 of 85 discovered areas were fixture directories, and a map that teaches a
parser test's intentional anti-patterns as house style is worse than no map.

Every path is then confined to the repository: lexical containment first because it costs nothing,
then `realpath` on both sides because `resolve()` normalises `..` but never follows a symlink and
`readFile` does. It fails closed, and the resolved path is what gets read, not the unresolved one.

One file is read once however many index entries name it. A repository committed from Linux can hold
`a.ts` and `A.ts`, or one name in NFC and NFD, and a filesystem that folds case or Unicode form
checks out one file for both, so both names read it and its sites counted twice. Where two entries
fold to one name and open one file, the spelling every directory on its path lists is kept, down to
a directory's own case. A byte-for-byte listing beats one that matches only up to Unicode form, since
macOS lists a decomposed name on disk under the composed one git records. The other is counted as unreadable, since the working tree does not hold that entry's own blob.

A corpus that comes back empty is asked one more question: how many source files the working tree
holds that are untracked, from a second `git ls-files --others --exclude-standard` through the same
filters. It is the difference between a repository with nothing in it and one whose first commit has
not landed, and only the second has anything to do about it. The count reaches the summary line and
the overview; it is not asked at all when the corpus is non-empty, because the answer changes
nothing there.

A corpus only partly read is marked truncated, and a truncated corpus **suppresses every directive**.
Counting over an arbitrary subset and rendering it like a complete scan is worse than reporting
nothing, so the overview says so and prints counts only. No repository size can set it; the Ruby
stream's per-line guard can.

## 2. Area discovery

An area is a directory. There is no table of known roots.

Both bounds scale with the corpus rather than sitting at a fixed number, because a floor that is
right for a 200-file repository leaves a 12-file one with no area at all and a 100,000-file one with
areas of noise.

| Bound | Value | Effect |
|---|---|---|
| floor | `clamp(round(sqrt(N) / 6), 3, 8)` | a directory holding fewer source files folds into the nearest ancestor that clears the floor on its own |
| ceiling | `clamp(ceil(N / 16), 120, 500)` | a budget backstop reading "the average area holds at least sixteen files", never a size rule |

The layout is taken from the pinned corpus size where there is one. The floor is a step function, so
one added file would otherwise re-partition the repository and every area would read as a population
change against a pin that knew the old layout.

Counts are cumulative up the tree, so a directory with 3 direct files and 20 in its subtree is a
real area rather than being folded away.

The repository root is never a fold target. Everything that reaches the root has nothing in common,
and a claim computed over that describes no code anyone works on. Files with nowhere to go are
reported as uncovered in the overview instead. On the 2,468 file repository the README's overview
comes from, that was about 8% of its files (the README prints the count). Expect a larger share on a tree with many small leaf directories, and much less on a flat one.

Above the ceiling the smallest areas fold into the nearest ancestor that is itself an area, smallest
first, until the count fits. Where no ancestor is an area, which happens whenever a directory holds
only subdirectories, the parent is created rather than the files dropped: leaving it alone orphaned
76,000 of 100,000 files on a measured repository. The repository root is still never a target.

Raising the ceiling is not free coverage. Taking it to 1,000 split a measured 2,468-file repository
into 209 smaller areas and dropped stated claims from 194 to 143, because a smaller area holds fewer
candidates and more of them fail the gates.

Each area gets the globs for the delivery channel's `paths` key, built from the languages present,
for example `src/components/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}`. A directory holding a file whose
name carries no extension, such as a `Rakefile`, gets one more pattern per such name, emitted per
cover entry so a negation cuts it out of a foreign subtree too. A glob may never end in a bare `/**`. The
matcher strips a trailing `/**` before matching, so `app/**` becomes `app`, gitignore semantics then
forbid re-including anything beneath it, and an exclusion written against that pattern silently does
nothing. There is an assertion in the code rather than a comment.

The globs match the files the area's counts were taken over, and no others. One recursive glob from
the area root does not: a deeper directory that became its own area is still under it, and the
ancestor's directive then reaches a directory whose own counts were suppressed by a gate, measured
over a population that directory is not part of. So an area that does not hold its whole subtree
emits either one glob per directory it holds files in, or one recursive glob and a negation per
foreign subtree, whichever is shorter. A foreign subtree is usually a deeper area; it is also the
files the ceiling left uncovered, since `capCount` can host an area at a directory whose own files
were already orphaned. Measured on a 5,495-file Rails repository, 156 areas: 298 patterns in total,
37 areas changed, 119 unchanged on the single recursive glob, 21 patterns in the largest list.

The files the corpus left out are foreign too: tracked source under an excluded directory, and
generated files. The cover was built from the counted files alone, so a `fixtures/` or `test_cases/`
inside an area read as part of a subtree it wholly owned, and its one recursive glob delivered the
area's sentences to exactly the code G7 keeps out of the counts: angular's compliance area counted 8
files and reached 2,017 under `test_cases`. The left-out files a pattern of the area could spell are
walked as foreign files now. A generated file beside counted ones is cut out by its own name. An
excluded directory is cut out by its name once, at any depth (`!src/comp/**/fixtures/**/*.ts`), since
every file under that name is left out wherever it sits; prisma keeps a `_fixture/` beside each of 102
tests, and one negation per directory made a 106-pattern list in a 40-line file. Where the name also
sits on a counted file's path, as `build` can under `src`, the directory is cut out by its path
instead. A left-out file never makes a subtree the area otherwise holds whole read as shared: the
glob stays recursive and carries the negation, so a directory added under the area after the scan
is still reached. Measured on seven corpus repositories, the areas reach 0 left-out files, down from 2,017 on
angular, 1,707 on react and 591 on prisma, for 67 more patterns (2,716 to 2,783).

A directory whose name holds glob syntax cannot root an area or be named by a pattern. That includes a
comma: Claude Code splits each `paths` entry on the commas outside a brace before it expands braces
and matches with gitignore rules, so `x,y/**/*.rb` reads as `x` and `y/**/*.rb`.

The area id is the first 8 hex of `sha256(path)`, which is what makes `anatomiya-area-<id>.md` a
stable filename across scans.

## 3. The parse pool

One module drives both parsers and reads what comes back. The scan and the check each used to do
that themselves, which meant each decided separately what an unread file means, and only one of them
ever decided it.

Which parser reads a file is declared, not spelled. `plugins/anatomiya/lib/langs.mjs` holds one declaration per
language: its extensions, its extensionless filenames, the scratch extension a path-less blob is
written under, the grammar route per real extension, the dialect the retry may strip, the
capabilities its callers ask about, how its tree nodes are addressed (`positions`: UTF-16 offsets
or line numbers), and the name of the engine that hosts it. The seam routes each
batch by that declaration, so nothing past it names a language or an engine. The registry is a leaf
the parser child can read, which is what lets the corpus filter, the delivery globs, the grammar
choice and the retry all take the same facts from one place; a wrong declaration fails at import,
never mid-scan.

JavaScript and TypeScript are parsed by `oxc-parser`. It runs in a pool of warm child processes,
one parse per message. Never in-process, never in a worker thread. The worker itself is a thin
shell over `plugins/anatomiya/lib/parse-file.mjs`: the body that picks the grammar, runs the retry and answers the
counts is an in-process module tests cross without a fork, and the shell keeps only the read, the
reply and the BigInt fallback.

The reason is not speed, though the pool is also faster (8,463 to 10,563 files/sec against 3,058
in-process). It is that `parseSync` raised an uncatchable SIGSEGV on deeply nested input. A
`try/catch` does not see it, a worker thread does not contain it, and no static pre-screen predicted
which files would do it. A process boundary is the only thing that contains a segfault.

Warm matters: a process per file pays fork cost on every file. A respawn after a crash costs about a
millisecond, so a poison file costs one file rather than the run. The crash arrives at the child's
`exit` handler, the file is charged as a parse failure, the worker is replaced, and the scan
continues.

A `.js`, `.jsx`, `.mjs` or `.cjs` file the parser rejects is retried once with its Flow types
stripped, because oxc refuses Flow by name and a Flow file is not a broken one. react is written in
Flow: 287 of its 2,277 files were charged as rejected before, and 2 are now. The strip replaces
types with whitespace, so the length in UTF-16 code units does not move and every offset still
lands where it does in the source, which is the unit oxc counts in. A retry that still reports errors leaves the file rejected, since the retry may not turn a
genuine syntax error into a clean parse. The `.ts` family is not retried, because Flow is not legal
there.

A retried file has its annotations blanked, so five claims go unanswered for it: the two that ask
about the annotation itself; `relative imports carry the file extension`, whose sites include the
`import type` statements the strip deletes outright; `exported names are <style>`, whose sites
include type-only exports the strip deletes the same way; and `exported functions carry a doc
comment`, whose comment gap the scan and the check would otherwise measure against two different
strings. The file is left out of those five denominators as well, because a file nobody asked is
not a file that declined. Every claim that
reads code is answered as usual. If `flow-remove-types` is not installed at all the retry cannot
run, and the scan and the check both say so by name rather than leaving a pile of rejected files
with no explanation.

A file is unexamined in four ways, and the scan names them apart because the reader's next move
differs: it crashed the parser, the parser rejected its syntax, this tool could not read it, or it
was over the size cap. The second is new in this shape. Both parsers recover from a syntax error and
hand back a tree, oxc to an almost empty one and prism to one holding nodes nobody wrote, and
counting either moves the denominator without moving the code. So a parse reporting errors answers
`ok: false` and contributes no sites, which is what every other unexamined file already gets.
prism is asked to parse as the interpreter it runs on (as 3.3, its oldest grammar, on an older
one), because by default it parses as the newest Ruby it knows, and `a[0, k: 1] = 2`, valid until
3.4, read as a syntax error on Ruby 3.3.

Where a language's parser answered for **no** file at all, that language is decided on its own. An
area holding any file of it is held: its file is neither rewritten nor removed, and its record is
carried into the new facts, because the run cannot say what it holds and its areas would otherwise
count nothing and be deleted as gone. Everything else is written, and the summary and the overview
name the language, why none of it was read, and the remedy. An engine that is not installed is the
same case, so a TypeScript repository whose only Ruby is a Gemfile still gets its map on a machine
with no Ruby. Only a run that read no file of any language writes nothing and removes nothing, and
creates no `.claude` directory it would have written into; where a missing engine is the reason, the
scan refuses with that engine's remedy instead. A file skipped for its size never reached the parser,
so it counts neither way: one generated bundle beside a missing engine used to read as an answer,
and the scan removed every area of that language. The check draws the same line: it names the files it
could not read and the engine's remedy, and refuses only a change with nothing else in it to read. A
syntax error is none of this: the parser ran and answered.

Why a run went blind is asked of the engine rather than guessed. An engine that reported a version
ran, so the files are what failed; one that reported none is the install, and its line carries that
engine's own remedy. Guessing was measured wrong on a real machine: with `ruby` on `PATH` and no
`prism`, one sentence naming a missing interpreter was the wrong answer, and no version anywhere on
screen said so. An engine this tool's own clock stopped before it could report a version is neither:
parse workers that never said ready, or a Ruby child silent past its idle window on both attempts,
are named with that cause and no install remedy, since `doctor` reports that install as fine.

| Guard | Value | Enforced |
|---|---|---|
| File size | 1 MB | checked with `stat` before the file is dispatched |
| Wall time | 5s | `SIGKILL` from the parent; a file killed while other parses were in flight is retried once after the queue drains, with no other parse in flight, and one killed while it already ran alone is charged on that attempt, which is every kill in a one-worker pool (a one-file batch, or a machine with 2 or fewer CPUs) |
| Resident memory | 1 GB | polled every 25ms, starting 250ms after the file goes in flight: read from `/proc/<pid>/status` on Linux, from `/bin/ps` on macOS and the BSDs, and not enforced on Windows, where the wall clock is what stops a runaway parse |
| Worker start | 20s | `SIGKILL` from the parent for a worker that has not said ready; five such workers fail the pool, and its queued files are charged as crashed |

Pool size is `min(8, cpus - 1)`. The memory grace period exists so a normal parse never pays for the
polling.

The dimensions run in the worker, not in the parent. They are 85% of the scan's CPU (1.57ms per file
against 0.27ms to parse), and running them in the parent left that 85% on one core: throughput
stopped improving past four workers on an eleven-core machine. It also keeps the tree out of the IPC
channel, where an AST serialises to about 16x the source it came from and the parent pays to decode
all of it. What crosses is a conforming flag and a scope name per site. The check asks for the tree
as well, since it reports line numbers, and it only ever parses the files one diff touched.

The facets are a second walk over the same tree, and they stay one because the cost was measured
rather than assumed: stubbed to a constant, eslint's 1,489 files parse 40ms faster out of 1.45s.
That is 0.03ms a file and under 3% of the run, against a shared visitor hook every dimension and
every reader of them would have to be written around.

Two things the parser publishes are taken rather than reimplemented. It can hand its tree across
from Rust without building it through a serialisation step, which measured 3.06x on the parse itself
(279ms to 91ms over 1,200 files) and found the same 11,751 sites with a byte-identical JSON encoding;
it is asked for through `rawTransferSupported()` rather than assumed, because the flag is still
experimental upstream. Its deserializer recurses in JavaScript and runs out of stack near 3,000
operands in one expression, which a generated string table reaches, so a file that overflows it is
parsed again with the plain transfer, that file only. A process refused the raw transfer's 6 GiB
reservation drops it for every later file. And it publishes, for all 165 node types it emits, which properties hold
children. The walk used to enumerate each node instead, which pushed every string and number onto
its work stack too: 63% of a measured corpus was scalars pushed and discarded one iteration later.
Reading the published table visits the same 630,000 nodes 2.5x faster, with `Object.keys` left as
the fallback for a type the table does not know, which no measured file produced.

Two rules apply to every parser result. First, offsets are never used to index a buffer read from
disk: `oxc` reports offsets in UTF-16 code units and `prism` reports them in UTF-8 bytes, 5.4% of
real files are non-ASCII, and the failure is silent corruption rather than a crash. Any slice comes
from the same in-memory string the parser was handed. Second, the walk is outermost-first, which
gives containment collapse for free: a nested match is visited after the node containing it, so the
outer one wins with no dedup pass. Overlapping matches in real code are nested, not duplicate, and a
range hash catches none of them.

Ruby is parsed by `prism`, which is safe in-process, so it needs no pool. But `prism` runs in Ruby,
so there is a process boundary anyway, and it is a streaming one: `spawn`, one JSON object per line,
parsed as it arrives. Buffering it through `execFile` threw `RangeError: Invalid string length` from
inside Node's own exit handler, with `maxBuffer` set far above the output size, and no error was
attributable to any file. Paths arrive on stdin as NUL-delimited pairs, never in argv. The Ruby
process runs with `--disable-gems` and with `RUBYOPT`, `RUBYLIB` and `GEM_HOME` dropped, because
each of those can inject a `-r` into a process about to be pointed at repository files. Its `PATH`
keeps only absolute entries: the command is looked up on the child's own `PATH`, and an empty or
relative entry resolves against its working directory, the temp directory, where another local
user's `ruby` ran as the person scanning on a machine with a trailing colon and no Ruby. The timeout
is 15s of **silence** rather than a whole-run limit, because a large repository legitimately runs
for minutes and what a hung parse looks like is silence; behind it sits a wall clock sized to the
number of files handed over, since a child that answers one file every fourteen seconds keeps the
idle timer happy and never ends.

A child either of those timers killed is spawned once more, for the files that never answered and no
others, and only what is still unanswered after that is charged. Both timers measure the machine
rather than the files, and a file charged as crashed in one scan and parsed in the next moves the
always-loaded overview, which is the same reason a JavaScript parse the pool's own clock killed is
tried once more, alone, after the queue drains, when it died beside other parses. A child that exited on its own, a missing interpreter and a fatal from the
script are charged on the first attempt: a second child answers those the same way at twice the
cost. Every record says which attempt answered it.

Every child this tool runs, the pool's parse workers, the Ruby stream and the type checker that
`--deep` asks for, goes through one supervisor that owns the spawn, the bounded stderr, the two
clocks and the kill. The numbers stay with the bridge that measured them and only the shape is
shared, because three hand-written copies of one battery had drifted into three stderr caps that
each overshot by a chunk and one bridge holding a single re-armed timeout where the other two held
an idle window and a wall clock.

The checker builds one program over every JavaScript and TypeScript file, then measures the share
of property accesses whose receiver resolved to a real type. Under 0.80 the tier is degraded and its
claims print as counts only (B8). The share is taken over files in an area the map describes,
because those are the only files a claim is counted over: one untyped minified bundle in no area
took a repository whose own code resolved fully down to 3% and read as a broken tsconfig, and a
directory of bundles that was discovered and then dropped for counting nothing did the same. Each
file's share comes back on its own, so the scan sums it once the areas are folded. A repository
with no area is measured over every file, and areas holding no checked file (a Ruby app beside a
directory of bundles) have no rate and stay ok. Files outside the areas are still in the
program and still lend their types. A `node_modules` whose real path leaves the repository
is not read (B9), so dependencies linked in from elsewhere resolve as absent ones do.

## 4. Dimensions and the three numbers

A dimension is one claim about one area. 49 ship, the filename row included: 28 for JavaScript, 33 reachable in JSX, and 16 that speak Ruby, plus the one type-checked row, which sits in the total and reaches a scan only with --deep. Each
is defined by three quantities, not one.

| Quantity | Meaning |
|---|---|
| `applicability` | files that could participate in the claim at all, that is, files holding at least one candidate site |
| `candidates` | sites inside those files where the construct appears |
| `conforming` | candidates matching the positive pattern |

The ratio is `conforming / candidates`. Counting conforming files instead of conforming sites was
measured flipping 10 of 39 verdicts, in both directions: it hid real conventions and it manufactured
false ones.

`applicability` is rendered beside the eligible files, the area's files in the dimension's languages
that it could read, on every stated line, because that is the only thing a human can audit a predicate with. A wrongly narrow predicate produces a ratio of 1.0
over a small candidate set and reads as a strong convention; `12 of 12 sites across 3 of 20 files`
reads as what it is.

Where a predicate declines a construct the claim's own sentence names, the stated line says so in
one clause:

```
a prop spread lands on a component, not on a host element
  46 of 46 sites across 5 of 6 files, 5 authors
  not counted: a spread onto a host element of a rest binding or a call's return, which has no prop names to write instead
```

Only under a claim that is perfect and lists no exception, named or counted. The `except` list is what teaches a reader
that a miss gets named, so a bare `N of N` reads as "there is no counter-example in these files",
which is stronger than anything the tool measured, and a credited file holding what looks like one
is what makes a reader stop trusting the map.

One row carries no such clause and owes a count instead, on the line that already carries its counts:

```
files here are named snake_case
  1525 of 1525 sites across 1525 of 1532 files, 3 names spelling no class, 6 authors
```

The filename row votes with a stem's class and the check enforces over the site, so a stem spelling none of
the four is a site with no vote: it leaves the printed population while the check still measures a
new file against the sentence. `across 1525 of 1532 files` cannot say that, because it mixes those
sites with the files that are no site at all. A stem of capitals alone is that case in a module, the
SCREAMING spelling of `DEBUG.ts`, and no site at all in a file that holds JSX, where React reads
`SBA.jsx` holding `SBA` as the acronym component it is.

It does not borrow the words `not counted`: those belong to the clause above, which names forms the
predicate declines and the check therefore never enforces. These names are the opposite, still
measured against the sentence. It goes on the counts line because a line of its own is one of forty. Measured on vscode, six of 500
areas sit at the bound and three of those state the row, and on its own line the disclosure pushed a
stated directive out of one of them, which also capped that slot at FIX in the check. A disclosure
that costs a convention is a bad trade. It also needs no perfect claim to earn its place: a declined
site never reaches the `except` list, so that list teaches a reader nothing about it.

Each dimension also carries a precision. A `precise` predicate sees every site it claims to see. A
`partial` one under-counts applicability in cases the parser cannot see, which is the dangerous
direction, so a partial dimension prints a warning on its line and can never reach the top severity
in `check`.

| Key | Precision | Languages | Claim |
|---|---|---|---|
| `swallowed_error` | precise | js, jsx | catch blocks use the error they caught |
| `module_state_const` | precise | js, jsx | module-level bindings are const |
| `function_style` | precise | js, jsx | module-level functions are declared with function, not assigned as arrows |
| `import_extension` | precise | js, jsx | relative imports carry the file extension |
| `nullish_default` | precise | js, jsx | defaults are taken with `??`, not `\|\|` |
| `hook_per_module` | partial | js, jsx | a module that exports a hook exports one |
| `test_call_style` | precise | js, jsx | test cases are declared with `test()`, not `it()` |
| `error_shape` | partial | js, jsx | failure is returned, not thrown |
| `async_error_handling` | partial | js, jsx | async functions handle their own failures |
| `optional_chaining` | partial | js, jsx | optional values are read with `?.` |
| `explicit_return_type` | partial | js, jsx | exported functions declare their return type |
| `type_only_import` | partial | js, jsx | imports used only as types are marked `import type` |
| `non_null_assertion` | partial | js, jsx | possibly-absent values are read with `?.`, not asserted with `!` |
| `absent_is_null` | partial | js, jsx | an absent value is returned as null, not undefined |
| `iterate_with_for_of` | partial | js, jsx | collections are iterated with `for...of`, not `.forEach` |
| `assertion_style` | partial | js, jsx | assertions are written with `expect()` |
| `hook_call_style` | precise | jsx | React's hooks are called by their bare name, not through React. |
| `handler_is_named` | precise | jsx | an event handler prop is given a named function, not an inline arrow |
| `spread_on_component` | precise | jsx | a prop spread lands on a component, not on a host element |
| `text_translated` | partial | jsx | user-visible text goes through the translation layer |
| `handler_memoised` | partial | jsx | a handler passed to a child is wrapped in `useCallback` |
| `rescue_uses_error` | precise | ruby | rescue blocks use the error they caught |
| `keyword_params` | precise | ruby | methods taking three or more arguments name them with keywords |
| `zone_aware_time` | precise | ruby | times are read and built through the application time zone |
| `record_lookup` | partial | ruby | a record that may be missing is fetched with `find_by` and checked, not fetched with one that raises |
| `model_callbacks` | partial | ruby | models keep behaviour out of lifecycle callbacks |
| `service_result_shape` | partial | ruby | service entry points do not raise, directly or through a bang call like `update!` |
| `migration_reversible` | partial | ruby | migrations declare `change`, not `up` and `down` |
| `migration_schema_only` | partial | ruby | migrations change the schema and leave the data alone |
| `column_null_declared` | partial | ruby | a column on a table the migration creates is declared `null: false` |
| `table_primary_key_declared` | partial | ruby | new tables declare their primary key type |
| `reference_foreign_key` | partial | ruby | reference columns declare their foreign key |
| `function_naming_case` | precise | js, jsx | functions are named `<style>`, learned |
| `exported_symbol_case` | precise | js, jsx | exported names are `<style>`, learned |
| `exported_class_case` | precise | js, jsx | exported classes are named `<style>`, learned |
| `exported_type_case` | precise | js, jsx | exported types are named `<style>`, learned |
| `extends_base` | precise | js, jsx | classes here extend `<style>`, learned |
| `interface_prefix` | precise | js, jsx | interfaces are named with a `<style>` prefix, learned |
| `type_alias_prefix` | precise | js, jsx | type aliases are named with a `<style>` prefix, learned |
| `doc_comment_style` | partial | js, jsx | exported functions carry a doc comment |
| `route_logging` | partial | js, jsx | logging goes through the repository's own logger, not the console |
| `route_network` | partial | js, jsx | network calls go through the repository's own client, not fetch directly |
| `route_env` | partial | js, jsx | environment reads go through the repository's own config module, not process.env |
| `logger_over_puts` | partial | ruby | output goes through a logger, not puts |
| `http_through_client` | partial | ruby | HTTP goes through the repository's own client, not `Net::HTTP` |
| `class_base` | precise | ruby | classes here inherit `<style>`, learned |
| `module_include` | precise | ruby | classes here include `<style>`, learned |

The five JSX rows are the ones that make the JSX total 33 rather than 28: a `.tsx` or `.jsx` file is
counted by every `js` dimension as well as these. The five migration rows are Rails and count as
Ruby, which is what takes Ruby from 11 to 16.

The three `route_` rows ask whether a cross-cutting concern goes through the repository's own
module. The wrapper is learned per file from its relative imports whose filename, up to its first
dot, is nothing but the vocabulary (log, logger, logging; client, http, api, request, fetcher;
config, env, settings), so `./apiClient` and `./HTTPClient` are wrappers and `./settingsSlice` is
not, and the direct forms
are a closed table (console calls, fetch and axios, process.env reads). Each row is offered only where at
least three examined files already route through a wrapper (C14), so a repository that logs to
the console on purpose, or one holding a config.ts nobody imports, never carries a line that can
only read zero. The Ruby `http_through_client` row reads a verb-shaped call as going through the
client when the receiver's name ends in that network vocabulary, since the last word is what the
receiver is: `ApiClient.get`, `HttpClientV2.get` and `http_client.post` do, `OauthClientStore.fetch` and
`request_params.delete` do not. A receiver naming redis, cache, memcache or dalli talks to a store,
so `redis_client.get` does not either.

A row marked "learned" carries a template rather than a fixed sentence. Its sites vote with the
naming class they spell, the plurality class becomes the sentence, and a tie learns nothing and
produces no slot. One more such row, `file_naming_case`, asks about filenames: it needs no parser,
so the reducer composes it the way it composes the obligations. A learned class that has moved
since the pin closes the slot (`learned-moved`) until a human re-pins, because the pinned counts
answer a different sentence than today's. The filename row has one candidate per file, so on its own
sample an area needs 35 classifiable filenames to state it; in smaller areas it may still state on
the rest of the repository's record for the same class, and where the repository does not hold the
claim either it feeds the check's learned enforcement and prints as counts, which is the gate
working rather than a bug.

Three of the learned naming rows narrow their population to one kind of file before they learn:
whichever of "holds JSX" or "does not" holds more of the row's sites. A React directory holds
`UserCard.tsx` beside `formatDate.ts`, and pooled, the area learns PascalCase off the components and
calls every correctly camelCase helper a violation of a convention nobody holds. The other kind is
left unjudged rather than split into a second slot: measured across three repositories and three
rows, splitting produced two stating halves in none of nine cases, because halving the sample kills
both sides of the evidence gate.

Five learned rows vote with a name rather than with one of the four naming classes. `extends_base`
and `class_base` take the plurality superclass a directory's classes name, `module_include` the
plurality module its class and module bodies mix in directly, counted once per body so a class
including two modules is one site rather than two the learned module can never both answer. A class
body that mixes in nothing is a site as well, since the forgotten include is the violation that
actually happens; a module mixing in nothing is namespacing, a subclass may be handed the mixin by
its base, and a class inside a class is that class's helper, so none of those three is a site.
Nor is a body that prepends or extends a constant, or a reopening of a class that declares a mixin
elsewhere in the file: both declared one by another route. Sidekiq defines `Worker = Job`, so
`Sidekiq::Worker` and `Sidekiq::Job` vote and conform as one module, in the map and in the check,
and the claim names whichever spelling the directory writes more.
`interface_prefix` and `type_alias_prefix` take the leading capital a declared type name carries
before a second capital, where
`IComment` votes `I` and `Comment` votes for no prefix at all. A name opening on three or more
capitals reads both ways, `IOStream` being an acronym and `IEFLogon` being `I` on the `EFLogon` in
the directory of the same name, so it votes for neither and is not a site; nor does a name that is
nothing but two capitals, `IO` being the same two readings with nothing to separate them. Only `I`,
`T` and `E` vote as a prefix, and not where the name opens on a mixed-case acronym ending with its
word (`IDs`, `IPv4`, `ETag`): `OAuthToken` would otherwise vote `O`, so any other capital-capital-lower
opening votes for neither too. The first three learn a
name out of the repository's own source, so it goes through the encoder where the sentence is
filled rather than at each place the sentence is rendered. The last two can learn an absence, which
renders as `interfaces carry no prefix` rather than being filled into the template, and which is
the model default, so a repository that prefixes nothing prints counts and a prefixed one states.
A filled prefix takes the article its letter is read with, `an I prefix` and `a T prefix`. An
interface that merges into a name declared elsewhere is not an `interface_prefix` site, since
prefixing it stops the merge: one inside `declare global`, `declare module` or a namespace, and one
at the top level of a declaration file with no import or export, which is global the same way.
Whether a learned class may be enforced is asked of the row and not of the four classes, or the
check would state all five in the map and enforce none of them.

A dimension that finds zero sites in an area produces no slot at all. The area file only lists
dimensions that appeared.

Each dimension also states, in words, which files could have participated at all, and what its
predicate cannot see where it is partial. `applicability` is otherwise whatever the predicate
happened to emit, so one seeing a tenth of its own construct produces a ratio of 1.00 over four
files and reads as a strong convention with nothing on the page to contradict it. The sentence is
checked when the registry loads, and every row carries witness sources: the ones the sentence says
are applicable, and the neighbouring constructs that must not count. Where a sentence names several
forms, each one the code treats differently gets a source, because one source proves the sentence
names something and nothing more. Where the predicate recognises its construct through a closed
table of names, every member of that table is driven through it as well, since a table shrinking
changes no shape and quietly narrows which repositories the dimension can speak about at all.

`npm run audit:applicability` reads scanned repositories back and ranks every dimension by how much
of an area it speaks for, which is how a narrow predicate is found before somebody reads the map
rather than after. A low share is not a defect on its own: measured across express, sidekiq,
vuejs/core and mastodon, every flagged row named a construct that is simply rare.

## 5. The gates

A dimension may state a directive only if it clears every gate. Otherwise its counts print with the
name of the gate that stopped it.

| Gate | Threshold | Why here |
|---|---|---|
| `ratio` | `conforming / candidates >= 0.90` | the gate that survived measurement elsewhere; an earlier spec loosened it to 0.80 with no argument |
| `evidence` | the Wilson 95% lower bound on the same counts reaches `0.90`, **or** the rest of the repository's bound for this dimension and learned class does and this area's own upper bound reaches the rate it borrows | the ratio asks what this sample did; the bound asks whether the true rate can be trusted there. A perfect record needs 35 sites to hold 0.90, which is why there is no separate minimum on `candidates`, and why a perfectly consistent nine-file directory could never speak about a claim the repository holds at 0.987 across 2,152 sites. The prior is leave-one-out, so nothing is its own evidence, and it is built only from slots no other condition has closed. The second clause is what stops a large mediocre area inheriting a strong repository's confidence: 900 of 1000 tops out at 0.917 and cannot borrow 0.988 |
| `concentration` | the sites are worth `>= 3` files by inverse-Simpson count, **and** the ratio still reaches 0.90 with the largest file dropped; where files tie for the largest, the one dropped is the one worst for the side being judged, so a rename cannot move the verdict | 200 sites in one file plus one each in 13 others gives 14 files at ratio 1.0 and clears any file-count floor. Ten one-site files with one violator stated the claim when the violator sorted first and withheld it otherwise. A share of the candidates cannot answer this either: at two files the largest share is at least 0.5 by arithmetic, and at fifty files no share ever fires however lopsided the spread is |
| `applicability` | `applicability >= max(R, min(ceil(0.25 * F), 3R))`, where `R = ceil(sqrt(F))` and `F` is the files the dimension can speak about | the stricter of two floors, because each is wrong alone. The root asks for more than a quarter below sixteen files, where a quarter of a small directory is one or two files. The share holds above it: on its own the root asked 11 files of 120, and a measured 120-file area where 11 files used `?.` and 109 read absent values without it stated the claim over all 120. The share is capped at three roots because it grows with the area while the risk it guards does not: on a single 1,531-file `db/migrate` it asked for 383 files, which made any construct rarer than a quarter of the directory unstateable however perfect. The first area size where the cap changes the answer is 157, above every area the share was measured on |
| `authors` | `>= min(2, distinct authors in the repository)` distinct authors over the files carrying the stated side's matches, and `>= 2` where the clone holds only a window of history | one person's habit is not a convention, but one author is not a thin team either: it is the whole team, and there is no second opinion being withheld. That reasoning needs the whole history to stand on: a `--depth=1` checkout, which is what `actions/checkout` does by default, holds one author whatever the team is, so the bar derived from it collapses and the map states more than a full clone does |
| `directories` | `>= 2` distinct directories, **only when the area spans more than one directory** | applied unconditionally this blocked 124 of 170 measured slots, because area discovery finds leaf directories and a leaf directory holds one |

Gates are evaluated in that order and the **first** failure is the one recorded and printed. So
`no convention. 0 of 133 sites (ratio)` means ratio failed first, not that ratio was the only
failure. Where git could not be read at all, the author gate is recorded as `history-unread` rather
than as a team of zero. Where git answered but held only part of the history, the counts stand as a
floor rather than as the team, and the overview and the terminal both say so. How much of the
history there is goes on the terminal alone, since the overview owes byte-stability and a
fixed-depth boundary moves under it.

The whole battery runs once per side. The three numerators move between the claim and its inverse,
and so does the author count: how many files the sites are spread over and how much of the area the
construct reaches are facts about where the sites are, but who wrote them is a fact about the side.
Each side counts the authors of the files carrying its own sites, so a person whose only file breaks
the habit is not a second author of it, and a line names the authors of the side it prints, stated
or not. A slot no side states still prints the side most of its sites take, so its `(authors k of
n)` is that side's count: `facts.json` stores `counterAuthors` beside `authors` for that. The
terminal's count of claims held on the author gate reads the same side, or it named fewer than the
map printed.

Authors come from one `git log -M --no-merges --name-status` pass, unioning rename chains, and
`-M100%` on a partial clone (`extensions.partialClone` set, or any remote's `promisor` flag, not
only `origin`'s). `-M` scores similarity, which needs blob content a
`--filter=blob:none` clone does not hold, so it fetches from the promisor one round trip at a time:
33 of 35 measured clones could not answer at all. `-M100%` matches on blob OID, which the trees
already carry, and loses only rename-with-edit. Never
`git blame`. One pass takes 0.03s to 0.84s regardless of file count against 103s for per-file blame
on an eight-year repository, and the two agree 99.6% to 100%. Blame is also wrong rather than merely
slow: one repository-wide formatter commit reassigns every line to the formatter, and the author
gate then fails on files that genuinely have three contributors. `-M` follows renames, which fixed a
wrong gate failure on 6.3% of files.

A repository with no history yields no authors, which means the author gate blocks everything. That
is the expected result on a fresh `git init`, not a bug.

Counts print whether or not a directive fires. That is what makes a badly set threshold cost one
sentence instead of a wrong convention, and it is why the gates can be set conservatively.

One more filter sits after the gates and touches only the rendering. A stated side the model
already writes unprompted prints as a counts line, `matches model default`, never as a directive:
context files measurably pay only for what a model would not do anyway, so the directive lines are
for what this repository does differently. The claim is still stated in `facts.json` and the check
enforces it at full severity, because a model drifts off its own defaults as a session grows.
Which side a model writes comes from `plugins/anatomiya/lib/model-defaults.json`, a committed table with provenance
per entry, written by `scripts/measure-defaults.mjs` from the model's own output parsed through
the same predicates the scan uses. A learned row's default is a class rather than a side:
"functions are named camelCase" in JavaScript is exactly what the model writes anyway, so a
learned class equal to the model's own renders as counts too. An unmeasured entry reads `none`
and fails open: the dimension keeps stating. That holds for the side. A class is read as written,
whatever the provenance method says, and two seeded entries carry one set by hand:
`interface_prefix` and `type_alias_prefix` hold the class `none`, since no prefix is what the model
writes, so a repository that prefixes nothing prints counts for them though neither was measured.

Each entry names the engine it was measured at, and two engines never merge into one tally. The 24
measured entries shipped so far say `claude-opus-5` and name no effort, which is the engine the
harness ran before it pinned one; it now runs `claude-opus-5[1m]` at `medium`. So a fresh run
refuses all 24, says so in one line, and leaves them standing. They stay the older engine's answer
until someone re-measures them with `--force`, which replaces rather than adds. Reading their silence
about effort as `medium` would date them to a setting nobody can check they ran at.

## 6. The baseline and `pin`

Every gate reads the **baseline** population, not today's files. The counts from today print beside
it and decide nothing, or an agent that adds conforming sites raises the bar it is judged against.

`anatomiya pin` writes `.claude/anatomiya/baseline.json`: the commit, and the file list each area
held at that commit. The file list is the whole point. A baseline recomputed by running today's
glob against the old commit re-selects only the files that are still there, so moving the violating
files into a new directory lifts the ratio to 1.00 with every other guard still holding. It stores
no counts, because stored counts are the numbers the guard exists to verify.

The scan then reads those files at that commit with `git cat-file blob`, never from the working
tree, parses them through the same pool, and gates on what it finds.

It reads only the files that actually differ. `git diff --name-only <sha>` names them; anything
tracked and absent from that list has the same bytes in the working tree as at the pinned commit, so
the corpus pass already parsed exactly the content the baseline asks about. Reading it again costs
one `git cat-file` process per file, which measured 6.9s against 1.4s to parse the entire corpus, on
a repository where nothing had changed. A rename is treated as changed, because the two paths are
two different files as far as the corpus map is concerned.

Five conditions stop a directive before any gate is consulted:

| Condition | Meaning |
|---|---|
| `unreachable` | the pinned commit is gone from this clone, usually a squash-merge. Every claim drops to counts, and stored counts are never fallen back on |
| `population-change` | a pinned file is no longer in this area, or would not come back or parse. Suppressed until a human re-pins |
| `postdates-baseline` | nothing in this area, or nothing this dimension counts, existed at the pin. Greenfield directories are where agents write most, and there the baseline would be the agent's own output at 100% |
| `semantic-unbaselined` | a type-checked claim on a pinned repository. The checker does not run over the pinned blobs and `pin --deep` is refused, so there is nothing at the pin to compare against and the counts print without a directive. Not the same as a greenfield directory, which is why it has its own name |
| `corpus-truncated` | the scan hit a cap and answered for a subset of the repository |

A rename map from `git diff --find-renames` is carried into the lookup, so a renamed directory finds
its own baseline instead of reading as greenfield.

Without a pin the scan measures against the current working tree and says so, and no check finding
can exceed FIX. Re-pinning is a separate command that prints the population delta and nothing else.
The plugin never suggests it: the moment a re-pin looks most warranted is the moment the agent's own
output is largest, and a suggestion there launders it.

## 7. How the map reaches the agent

Output goes to `.claude/rules/`, which is a context directory the agent loads from.

| File | `paths` key | Loads |
|---|---|---|
| `anatomiya-overview.md` | none | every turn, and again from disk after a compaction |
| `anatomiya-area-<id>.md` | the area glob | when a file under that glob is read, once per context window |

There is a second delivery beside that one, declared by the plugin rather than installed by a scan: a
hook that echoes the overview back after a turn or a tool call, stamped with the moment it was read,
whenever the context window does not already hold that same map (A92). A scan writes nothing outside
`.claude/rules/` and `.claude/anatomiya/`; what it does to a repository's own settings is take out the
entry an older version put there. The table above is what the platform loads; the hook is what keeps it
recent. A run three hundred tool calls deep was working from a copy handed to it at the start, and
nothing said when that copy was read, so a map that had drifted from the code looked exactly like one
that had not.

It is deliberately an addition rather than a replacement. "What is deliberately not built" refuses a hook
as *the* channel, on complexity and on being flagged as prompt injection, and the 10-to-40% adherence
that refusal cites was measured on a hook standing in for the always-loaded file. Here the 100% channel
is untouched and nothing depends on the weaker one. The echoed text is descriptive rather than
imperative for the same reason, and it says outright that the code outranks it.

Four hooks run, on different events and answering different questions. `anatomiya refresh` fires on
`SessionStart` and `FileChanged` and keeps the map current (below). `anatomiya echo` fires on
`UserPromptSubmit`, `PostToolUse` and `PostToolUseFailure` and re-delivers the map. `anatomiya notice`
fires on `PreToolUse` for `Write`, `Edit` and `NotebookEdit`, and answers for the one path that call is
about: whether a test is being put where its kind of file has no test precedent. It is silent otherwise,
which is most writes. That silence is the point rather than a saving. A session was handed the same
overview more than a hundred times and still put a spec in a directory whose siblings had none, because
the clause that mattered had scrolled past a hundred times with everything else; an unchanged block on
every result is what teaches a reader to skip it.

The notice informs and never refuses. Measured on 2.1.250: a `PreToolUse` hook can return
`permissionDecision: "deny"` or `"ask"`, and only those stop a path being chosen, but the rule behind
this notice rests on a namesake match that reads a tested directory as untested where the names differ
in case. Refusing on a count that can be wrong stalls real work, so it says its piece and lets the write
through. The text reaches the model on its next turn, after that write and before the next one, which is
what makes it worth saying at all when a session is creating twelve files rather than one.

A root counts as testing its files once three of them have a namesake test, the same floor its producers
take before its silence counts. One is an outlier: on a front end, one namesake among 517 files kept the
notice quiet for every test written under that root while the 1,023-file root beside it, with none, was
answered. Asked of the 40,701 test files that already exist across the corpus, the floor adds three
findings, two of them in that root.

`anatomiya reuse` fires on `Stop`, at the end of a turn, and speaks only where the turn left source
lines nothing has checked against the repository: a scanned repository, a changed file the corpus
counts, and at least one added line, in a file written since the session began. It answers `decision: "block"` with one reason, which asks the
model to give one subagent the diff and the added lines and to call any existing function that does
the same job in place of the copy. That wording is the only one measured passing every hard case, 24
of 24, where every wording the model answered inline passed 9 or 10 of 12 (A91). It stops no tool and
no write: the block asks for one more pass, and a stop the hook already continued is let through. The
reason ends in a mark for each changed source file, taken over its content, and a file whose mark the
session's transcript already holds is not named again. The stop right after the hook's own block
records what the check left in a `systemMessage`, which the transcript keeps, so the check's own fix
is not asked about on the next turn, and the hook writes nothing a later `git status` would report.

Some changed source holds nothing anybody would reuse, and is not asked about: a migration, whose name
starts with a number right under a `migrate` or `migrations` directory or a `<name>_migrate` one such as
Rails' `db/cache_migrate`, a schema dump (`db/schema.rb`
or `db/<name>_schema.rb`), and whatever else the corpus refuses past the path, which is a generated
file and a link, the same rule `check` applies to its changed files. Only the file right under the
directory counts as a migration, because code nested deeper under a `migrations` segment was measured
on the corpus as ordinary library code: angular's schematics, prisma's `core/migrations`,
openproject's `db/migrate/tables`. The reason ends by telling a session with no subagent tool to run
the search itself. The Stop payload carries no tool list, and without that sentence a headless run
with no `Agent` tool answered the ask with "No such tool" and spent a turn on it.

A Stop payload names no file, so a session started in the directory holding several checkouts, which
has no map of its own, reads each mapped checkout directly below it instead, and names their files
from where the session stands (`api/src/x.ts`). A file's mark is taken over its checkout and its path
inside it, so a session that later moves into that checkout is not asked about it again, and the same
file copied into a sibling checkout is.

All four are absent from the usage block and from `commands/` on purpose: no person runs them and no
agent should. Each reads the payload on stdin, answers with one JSON object, and answers `{}` and exits
0 on every failure path, because a hook that exits non-zero interrupts the session it exists to help.
All four walk up to find what they answer from, the rendered map for `echo` and the recorded counts
for the other three. `refresh` starts from the payload's working directory, since its events name no
tool call. The other three start from the place the tool call is about rather than from where the
session's shell happens to be. Measured on 2.1.251, five tools name that place: `Read`, `Write` and
`Edit` under `file_path`, `NotebookEdit` under `notebook_path`, and `Glob` and `Grep` under `path`, which
is a directory rather than a file on those two. Where the payload names none, `Bash` and `Agent` among
them, the payload's own working directory answers, and that field follows the agent: one `cd` in a
shell call moves it for every payload after, and nothing tells the hook's process. A path spelled
relative is read against that same directory, because the tool read it against that one and nothing
normalises the input on the way here. Resolving from the shell instead served two checkouts sitting
side by side each other's map, under the line saying it was counted from this repository's own code. The walk ends at a repository boundary: anything named `.git` is where one
checkout's counts stop being about the code under it, so a level carrying that marker and nothing of
its own answers nothing rather than reaching past it. What it is looking for is asked for before the
boundary at each level, so a checkout that was scanned still answers from anywhere below its own
root, whichever shape its marker takes. Measured: a worktree under `.claude/worktrees/`, which is
where a session that branches off puts one, was handed the main checkout's map, stamped as read just
now, on a branch it had never been counted over.

A linked worktree is the one boundary the walk looks past, and only where the worktree has no map of
its own. A repository that ignores `.claude/` gives every worktree nothing, since a worktree carries
only what is tracked, and the silence cost more than a borrowed count: on a front end whose four
worktrees all had no map, a session working in one put a spec into a `__tests__` directory the main
checkout's notice names as having no precedent. So the hooks read the main checkout's map and record,
and say so: the echo is stamped as counted from the main checkout at its path, not this worktree, and
says the area files it names are there, since Claude Code loads no rule file from the main checkout
into a worktree; the notice ends with the same. A write is still judged against the worktree's own
files, and the end-of-turn check asks about the worktree's own change, taking the record as its gate
and printing no counts. `check` does not borrow, because it compares a branch against counts of its
own: in such a worktree its no-map caveat names the main checkout and says to scan the worktree. The
main checkout is found from the files `git worktree add` writes, not by asking git, and only where the
registration sits in the main repository's `worktrees/` and points back at this marker: a copied `.git`
file, one shipped beside a forged registration, a submodule, and a git directory not named `.git`
(bare, `--separate-git-dir`, or symlinked elsewhere) keep the silence. A worktree that was scanned
answers with its own map.

Both reads are bounded and typed rather than plain, for the reason the map's is: a named pipe at
either path never returns, and the record is the whole count of a repository, measured at 9,957,450
bytes on microsoft/vscode, so the bound the rendered map is held to would have silenced the notice on
exactly the repositories where a directory nobody read is easiest to miss.

The payload itself is read to a megabyte and no further, because a hook runs on every tool call and
the writer decides the size. What that megabyte holds is then read twice over. `JSON.parse` first,
which is the whole document or nothing: a complete payload followed by one stray byte answers the
same as no payload at all. Where that refuses, the members that can still be read are taken from the
text directly, and only those: string members, only at the top level and inside `tool_input`, only
ones whose closing quote the reader actually reached, only ones short enough to be a path rather
than a file's contents, and a member said twice reading as the last one said it, which is what the
parser would have answered for the same document. Every value it does answer is decoded by `JSON.parse` on that value's own
token, so escapes and surrogate pairs stay the parser's business. The grammar is read rather than
matched, because the bulk being stepped over is a file's own text: a reader that found `"cwd"`
inside one would answer another repository's path for a live write, and nothing here looks inside a
string. What this buys is the ordinary large call. A `Write` of a generated file carries it in
`tool_input.content` and a `Read` of a minified bundle carries it back in `tool_response`, and both
used to cost the turn its map over a payload whose four short fields were sitting in the first
hundred bytes.

A plugin's hook may only run a file inside its own root, so a second plugin needing this reader
would hold a copy of it rather than import this one, and `test/hook-contract.test.mjs` is where the
two would be driven against one list of payloads and refused on any they answered differently.

Neither hook needs to know where its own process is. `process.cwd()` refuses with ENOENT once the
directory a session started in is unlinked, which `git worktree remove` does to a session sitting in
one, and every hook after that is a fresh process, so a session would go quiet for the rest of its
life while every payload still named live paths. The entry point reads it defensively for the hooks
and lets the absent answer through; both readers already take a payload with no base at all. The
other commands need a real directory to walk, and say what happened and to give
a path. They cannot name the directory, which is the one thing that can no
longer be read.

The notice answers only for a path nothing is at yet. An `Edit` names a file that exists every time
and a `Write` over one is a rewrite, so the path was chosen turns ago; repeating the same block on
each edit of the same spec is the unchanged banner the notice exists instead of. The payload's path
and the repository root are both resolved through their links before they are compared: the root
arrives resolved and `resolve` follows none, so a payload carrying `/tmp/x` against a root reading
`/private/tmp/x` read as another repository's file and the hook said nothing at all.

The working directory is resolved through its links before any of that, since one reached through a
link walks the link's own parents and steps around every boundary beneath it, and the marker is
read without following one, since a marker pointing at a target that has gone is still a marker. A
level that cannot be resolved or cannot be looked at answers no map rather than throwing: every
failure path here has to end in `{}` and exit 0, and this one runs on every turn and every tool
call.

Three things this does not do, each named rather than probed for, since the cost is per tool call:
a directory named `.git` that is somebody's fixture reads as a boundary, a nested repository in
another version control system carries no marker to stop at, and the map itself is opened through
its links, so a `.claude` symlinked out of the checkout is read and echoed. The last is the one
that differs from the write side, which refuses it (A25): writing outside the repository destroys
what this tool does not own, while refusing to read there would break anyone keeping `.claude` in
their dotfiles.

The entry is the plugin's own, in `hooks/hooks.json`, and no repository's settings are written at
all. `${CLAUDE_PLUGIN_ROOT}` is substituted only there: written into a repository's settings it is
not substituted, and Claude Code refuses the hook by name on every prompt and every tool call for
the life of that session, which is what 0.2.4 through 0.2.6 shipped. A plugin hook runs in every
session the plugin is installed for, with no way to scope it to one repository, so the scoping is
the hook's own job: it walks up from the working directory for a map, and a session with none gets
`{}`. The refresh and the end-of-turn check also look one level down when the walk up finds nothing,
since their payloads name no file (below and above). That answer costs one node process and almost nothing else: three runs on one laptop put the median
at 73ms, 104ms and 237ms, and which `node` is on `PATH` moves it more than anything the tool does. It is
paid per turn and per tool call.

The map it echoes has to be one this tool wrote, which is A3's rule arriving on the read side. The file is
read through the same bounded reader the audit uses, so a named pipe at that path does not hang the session
and a file far larger than any map this writes is refused rather than echoed whole. A file at that path
carrying somebody else's frontmatter does not stop the walk either: it goes past to the repository's own map
above. Two of A3's three facts are checkable here and the third is not, since `facts.json` belongs to a scan
rather than to a session, so a file anyone writes carrying `generator: anatomiya` is still echoed.

A scan takes the old entry out of `.claude/settings.local.json` when it finds one, on any of the
spellings that shipped, and leaves everything else in that file alone: permission lists, other
people's hooks, and an event that still holds one. The file goes only when it holds nothing else.
That read is contained by F2 like every write, so a settings file symlinked out of the repository is
refused rather than followed, and a refusal is a printed line rather than a failed scan.

A delivery is roughly 500 tokens, and until A92 one was made on every turn and every tool call, so a
session making 300 calls spent about 150,000 on it. Claude Code keeps every copy. The hook now reads the
last 256 KiB of the session's transcript first and stays silent when that tail holds a delivery of the
same map with no compaction after it. Each map carries a `digest` of its body, so a re-scan is delivered
on the next call, and a copy further back than the window is delivered again, about every 29k tokens of
context in a typical session. A subagent or a workflow stage is answered from its own transcript.
Anything the hook cannot read answers with a delivery, which is the old behaviour. Parallel tool
calls in one batch each run before any of the batch's deliveries is written, so none sees the
others', and the worst case is one copy per call. Inside a mapped checkout the prompt has already
delivered the map before the first batch, and the batch adds none. A session started one directory
above the checkout has no map on the prompt, which names no file, so its first batch into that
checkout reaches the worst case, once per context window and per map: measured on 2.1.285, five
parallel reads gave four copies from the parent and one from inside the checkout.
`scripts/measure-echo.mjs` replays the rule over a transcript store: on 3,502 local transcripts it kept
7,857 of 65,977 deliveries. The measurements behind the rule are in
`docs/research/what-a-repeated-hook-context-costs.md`. There is still no flag; this tool ships no
options.

That last row is the ceiling on the whole design. A `paths` rule attaches when the agent uses the
Read tool on a matching file or when an `@file` mention names it. It does not attach on grep, on
glob, on `cat` through bash, or on an edit with no prior read.

Once is per context window, not per session. A second read in the same area delivers nothing,
because that file is already in the window. A compaction or a resume rebuilds the window and the
map comes back: the overview is re-injected from disk at the boundary, and an area file returns on
the next read that matches it, also from disk, so a session that compacts after a re-scan gets the
new counts rather than the ones it started with. Both halves are the platform's documented
behaviour under [what survives compaction](https://code.claude.com/docs/en/context-window#what-survives-compaction),
and both were counted over 12,500 sessions in
`docs/measurements/2026-08-17-context-delivery.md`: of the twelve that compacted after a delivery,
nine took a path back.

What no rebuild reaches is the stretch between two of them. Inside one window the counts arrive
once, at whatever turn the first matching read happened, and every turn after that is further from
them. `SessionStart` fires at the boundaries, which is the one place this is not a problem.

The Read has to be attempted rather than to succeed. A Read of a path that does not exist attaches
the area file whose glob the path matches, because delivery keys on the path of the attempt. That
falls the right way: an agent checking whether the file it is about to create is already there is
handed the counts for that directory at exactly the moment it is about to write one.

A subagent is reached by the same channel, and where the session was started decides what it gets
before its first Read. With the mapped repository as the working directory the overview arrives on
the subagent's first turn, ahead of any tool call: five subagent transcripts here show `CLAUDE.md`
and `anatomiya-overview.md` delivered at entry, on 2.1.220 and 2.1.233. With the repository one
directory down from where the session started, it is nested rather than root, and nothing arrives
until a file under it is touched. A subagent that only greps and `cat`s never touches one, which is
the exploration phase issue #34 measured going dark, and it is the whole of the gap: a subagent that
Reads is served like the main thread, overview included.

The overview head carries three fixed sentences beside the counts. "Read a file before editing it:
these notes load when you read, not when you grep" is that ceiling said to the agent. "When unsure
what this code does, read it, grep it, or run it instead of guessing, and say what you could not
verify" names the tools the agent already has and permits the abstention, which is what keeps a
guess from being written down as a fact. Its sources and the alternatives it was chosen over are in
`docs/research/one-line-that-stops-guessing.md` (A16). "When a change is asked for, follow what
this repository already does and carry it through instead of stopping at a suggestion" is the only
one about what to do with a change instead of what to read first: the counts below it, and the area
files they point at, say what the practice is, and this says to follow it and finish. It opens on a
trigger clause because removing the equivalent scope guard is measured to move the out-of-scope rate
by double digits;
`docs/research/one-line-that-finishes-in-house-style.md` carries the sources (A42). All three are
constant, so A5 holds. The line above them that says what a claim is also carries the key to every
counts line: `"no convention" means the gate in parentheses stopped it, and its sites may still all
agree`. Without it `no convention. 73 of 73 sites (applicability)` read as a denial of a habit every
site follows, and the gates' meanings lived only in this file and the README. It shares that line
rather than taking its own, so it costs the roster nothing on an overview at its bound.

Writes are atomic: temp file in the same directory, then rename, so a crash never leaves half a
context file. `.claude/anatomiya/facts.json` holds every count, gated or not, and the facts and
the rendered files are replaced as one: every one is written to its temp file before any rename,
the facts are renamed first and stale area files removed last, and a rename or removal that fails
puts back what it had replaced. So no rendered file exists that is not derivable from facts on
disk, and a scan that fails part way does not leave new facts beside the old map for `check` to
call fresh. A process killed between two renames is the one window left. It carries a schema version,
and the check refuses a version past the one it knows rather than reading the fields positionally:
an older record is readable and is read, a newer one is a shape this build has never seen. A run that read no file of a
language writes neither, for the same reason: keeping the rendered files while replacing the facts
they came from breaks exactly that invariant.

Three constraints shape the rendering:

- **The overview must be byte-stable between scans with no source change.** The token economics only
  work on a cached read, so there is no timestamp, no duration, and no count that moves per commit.
- **Each generated file stays under 40 lines.** A rewritten context file does not re-attach inside
  one context window, and the change notice truncates head and tail, so a long file loses its middle
  in both copies. This is also why the scan prints a line saying what reaches a running session: the
  overview on its next prompt or tool call, through the echo's digest, and an area file it already
  read only once a new session, a compaction or `/clear` rebuilds the window. It is a bound the
  renderer holds rather than a hope about how many dimensions an area has: an area file drops its
  suppressed counts before its stated directives and says how many did not fit, and the overview's
  area listing gets whatever the rest of that file leaves. A stated directive the budget cannot
  print in full is still named, as its sentence alone with no counts, because a footer saying how
  many conventions you are missing without saying which is the worst of both. The `paths` list is
  exempt, because a glob dropped to save a line mis-delivers the whole file, and so is the `kinds`
  line, which is taken off the bound before the body divides what is left: entered into the body it
  gave way in exactly the largest directories, which are the ones an agent touches most.
- **The plugin never opens its own output with the Read tool.** Reading a context file permanently
  suppresses its automatic injection for that path for the rest of the process, which would turn the
  map off for the session that just built it. The commands use `cat`.

Ownership needs all three of: the `anatomiya-` filename prefix, a `generator: anatomiya` frontmatter
key, and the map on disk naming the file. All three, or the file is left alone and reported. The
prefix earns its place for one job, which is that a single `$(git rev-parse --git-common-dir)/info/exclude`
line hides every generated file. It is not the ownership test, because a hand-written file can take
that name. Nor is the frontmatter key: an older build wrote files this one knows nothing about, and
a wiped store leaves a directory full of them. The third fact comes from `facts.json`, read before
the new record replaces it, and no readable map means nothing is removable rather than everything.

Both surfaces report what they did not write, and they name it rather than counting it. A file with
somebody else's name, or ours with nobody's frontmatter, is somebody else's context. A file with our
name and our key that no map lists is our own output from a scan whose record is gone, and it is
named apart because re-scanning is what clears it. `.claude/rules/` belongs to the repository, so a
clone can ship a rule file with no `paths` key that loads unconditionally, in this tool's house
style, from the moment of clone. The overview names them too, since it is the file loading beside
them, and says nothing at all when there are none.

Every write lands under `.claude/rules/` as a bare `anatomiya-*.md` name, checked when the plan is
built rather than assumed because an area id is a hex digest today. A name that would resolve
anywhere else refuses the whole write.

That directory and the store are also resolved component by component before anything is written,
and refused when the resolved path leaves the repository. `join` normalises `..` and follows no
link, so lexical containment is not containment: a tracked `.claude -> ../victim`, git mode 120000
and so present in every clone, had the map and `facts.json` written into a directory the repository
does not own, that directory's filenames named in the always-loaded overview, and one of its
`anatomiya-*.md` files removed by the next scan. One link at `.claude` escapes with both
directories, so both are checked. The pin is held to the same rule on both sides: `pin` refuses a
store that resolves outside, a dry run included, and a pin read through such a link is no pin, so a
directory the repository does not own never decides the population the gates read. The scan fails
closed; the check reports it as a caveat, because refusing a branch at review time is the blocking
behaviour this design rejects.

Inside the repository is not the whole rule. `.claude` has to be a real directory, and the store has
to resolve inside it: a committed `.claude/anatomiya -> ../.git/hooks` resolves inside the
repository, and the scan wrote `facts.json` into `.git/hooks` while printing `.claude/...`.
`.claude/rules` may lead elsewhere in the working tree, but never into the git directory:
calcom/cal.diy commits `.claude/rules -> ../agents/rules` to share one rules directory between
agents, and refused, the scan wrote nothing there at all. Git matches no pathspec past a symlink, so a
map written through that link is tracked, ignored and changed only under the link's target. The
refresh's tracked-map guard and the pin's clean-tree test read the map there (`trackedRulesDir`):
spelled as `.claude/rules/...`, a map committed through the link read as untracked and every move of
HEAD rewrote it. Where core.ignorecase is set, both pathspecs carry `icase`, since git keeps the
index spelling and a directory renamed in case outside git is found under neither spelling otherwise.
A link within `.claude` is still followed.
`facts.json` and `baseline.json` are read through the same resolution, their own names included, so
a link at either is not followed out; a write replaces it as an entry. A refusal names the path the
repository spells and says when it is a link, since the resolved name once read "README.md is not a
directory ... remove it" for `.claude/rules -> ../README.md`. The planning half also refuses a
directory at `facts.json` or `baseline.json`, which the rename cannot replace, and a nearest existing
directory on the way that this process cannot write, so a dry run of `scan` or `pin` refuses what the
real run would die on, by the directory's name rather than a raw `EACCES` on a temp file.

Files in there are read by their head, one megabyte at most, and only when the opened handle is a
regular file. The ownership test reads the frontmatter from byte zero a line at a time, and stops at
the first fence after the opening one or at the head, so the rest was never the
question, and read whole a tracked symlink to a large blob took a scan's peak resident size to 1.2
GB, while one pointed at `/dev/zero` never returned. The file is opened first and typed on the
handle it is read from, so a path swapped between a stat and an open cannot hand the type test one
file and the read another; a fifo is opened non-blocking so it cannot hold the open. A directory
named `x.md`, or a socket, is a shape rather than a file, on the platforms that open it and the
ones that refuse, under whatever errno they refuse with; where one holds a name the scan is about to write, which `anatomiya-overview.md`
invites since that name is fixed, it is reported as that condition rather than as an errno out of
the rename.

### The encoder

Every repository-controlled value is encoded before it is rendered: paths, area names, author names,
commit subjects, branch names, and matched source text. Allowlist, not
denylist. It normalises to NFKC, keeps only printable codepoints (which drops Cc, Cf, Co, Cs, Zl and
Zp, and so catches bidi overrides and zero-width joiners that an ASCII control filter and
`JSON.stringify` both miss), strips markdown structure (`---`, comment delimiters, backticks, table
pipes), rejects a word mixing Latin, Cyrillic or Greek letters as a probable homoglyph (a name wholly in one script, any script, is kept), caps on grapheme clusters before quoting,
and emits paths JSON-quoted.

The claim text is the one rendered string that does not go through it, because it is this tool's own
sentence rather than a repository-controlled value. It used to: the encoder strips `|` as a table
boundary, so "defaults are taken with ??, not ||" rendered as "defaults are taken with ??, not" in
every JavaScript area of every repository. Line breaks are still collapsed, and a test pins the
registry to sentences that need nothing more than that.

### Staying current

A map is a snapshot of one working tree, and nothing on disk said which one. `anatomiya refresh`
runs on `SessionStart` and on `FileChanged`, answers with two absolute `watchPaths` in the
checkout's own git directory, `logs/HEAD` and `HEAD`, and starts a detached worker. The reflog is
appended on every move of HEAD, a commit, a merge, a pull or a reset included, where `HEAD` itself is
rewritten only when the branch changes. Plugin `FileChanged` matchers add nothing to the watch list,
so the paths come back from the hook itself, every time, since the list is one list and the last
hook to answer replaces it (`docs/research/when-a-hook-can-refresh-the-map.md`).

Where there is no reflog to watch, something else every move rewrites stands in: on the reftable
backend `reftable/tables.list`, which each ref update rewrites (measured on git 2.51: a commit
replaces the file, and no `logs/` exists at all), and in a files repository created without a reflog
the index, which a commit, a pull, a checkout and a reset all write. The index is the last resort,
since a plain `git status` rewrites it too and each one then costs a worker that finds the stamp
unchanged. A linked worktree on reftable keeps its HEAD and that HEAD's log in a stack of its own,
so its own `reftable/tables.list` is watched beside the shared one. `FileChanged` is matched on
exactly those basenames (`^(HEAD|index|tables\.list)$`), and a change to any file this hook did not
ask for answers nothing, since answering it would replace somebody else's watch.

The worker keeps its state beside `facts.json`. It takes an exclusive lock, read bounded and typed
since the directory can come with the repository, and a worker that finds it taken leaves word for
the holder to run once more after letting go, so a move landing after the holder's last look at HEAD
is not lost. It stamps what a scan depends on (HEAD, the index as `ls-files -s`, the pin's bytes,
the plugin version), and rescans only when the stamp moved. It leaves alone a checkout with no map
of its own (A24), a map, a pin or any other file of the store the repository tracks, and a merge,
rebase, cherry-pick, revert or bisect in progress, and rebuilds a map built with `--deep` with the
checker. A scan that throws writes nothing, so the previous map stays; the same stamp is tried again
only after half an hour, and the echo says the refresh failed until a refresh or a scan run by hand
succeeds. A scan run by hand records its stamp too, so the next refresh has nothing to redo. It has
its own clock. A changed overview reaches a running session through the echo's digest, and an area
file is read from disk the first time its directory is.

A session started above its checkouts, the way a project split into sibling repositories is opened,
has no map at its own directory, and neither `SessionStart` nor `FileChanged` names a path the walk
could start from instead. Where the walk up finds nothing, the hook takes each checkout directly
below that holds a map of its own: it starts a worker for each, names every one's watches in the one
list, and on `FileChanged` starts only the checkout whose git directory the changed file is in. A
`.claude` with no `.git` beside it, a checkout two levels down, and a linked worktree borrowing its
main checkout's map are not taken, and a directory holding more than eight mapped checkouts side by
side takes none: that is a shelf of projects rather than one project, and a worker each at every
session start is nobody's request. A `cd` inside the session cannot move the watch, since
`CwdChanged` reaches only hooks a settings file declares.

The same worker moves the pin, and only onto what the remote default branch holds: HEAD equal to the
first of `origin/HEAD`, `origin/main` or `origin/master` that resolves, or the only remote's `HEAD`
where that remote has another name, with no tracked file edited or staged, and never onto a commit
older than the pin (E11). A branch cut before the pin reads the pinned files the base added after
the fork as never held rather than as missing (E12).

Three more conditions keep a pin honest when nobody is watching it. The tip is followed only when
`git reflog` records its last move as a fetch or a pull that took its refspecs from the remote's
configuration, or records none and the main checkout's first move was the clone onto that same
commit: a push from this clone, a ref written by hand and a fetch from a path or a URL, or into a
destination under the remote-tracking refs, are this clone's own work, and a session can do all
three. A fetch into a local branch (`git fetch origin main:main`) moves the tracking ref by the
remote's configured mapping and is followed; one that replaces that mapping with `--refmap` is not.
Asking git rather than reading `logs/` works on the reftable backend too, and a clone that keeps no
reflog never pins.

A commit this clone made never joins the pin while it sits on the first-parent line from the pin to
the tip, however it reached the remote: a push by URL moves no tracking ref, and a teammate's commit
on top reviews nothing beneath it. Made here is every commit a reflog entry names except the entries
that create none (a clone, a checkout, a reset, a branch, a fetch, a push, the remote's HEAD named,
a fast-forward, a rebase's start and finish, and the empty entry `git worktree add` writes on the new
worktree's HEAD, which reads as plain `HEAD` from inside that worktree, each matched as git writes the
whole entry and never
read from a commit's subject or a branch name), so a spelling git adds later holds the pin rather
than slipping past. The reflog forgets (a removed worktree, a deleted branch, `gc` after 90 days),
so a commit whose committer is this clone's own identity is made here as well: past a pin, anywhere
between it and the tip, and on a first pin only from the moment the clone was made (the mtime of
`.git/description`, or the oldest reflog entry where that file is gone), since a commit the same
person pushed from another machine before the clone existed was made somewhere else, and read over
the whole line it held every first pin for good. A walk git cannot answer holds the pin as unread;
with no committer identity at all only the reflog is asked, since git makes no commit without one. A
pinned commit git no longer holds, its branch merged, deleted and collected, bounds nothing, and the
line is read as for a first pin. A branch merged on the remote with a merge commit sits behind the
second parent and is pinned, the merge being its review.

And the pin is taken at the commit that was judged, or not at all: HEAD and the tree are asked
again once the file list is read, since a commit or a `git add` landing while it was read would
put files into a pin labelled with the commit judged before. What each automatic pin accepted is
written to `refresh.json`.

A pin that stops following while the checkout sits on the tip is held, and `refresh.json` says why
(`held`: a commit made here, a tip this clone moved, a tip with no record of how it moved, a
question git could not answer), at which commit and against which pin; a commit made here also says
what matched it (`by`: `reflog`, or `identity` where only the committer did, and the line then says
the commit carries this clone's git identity rather than that it was made in this clone). A session
started or resumed says so in one line of the terminal (`systemMessage`), built from fixed words and validated commit
ids only; a compaction or a clear inside the session does not repeat it, and a pin taken by hand
since the hold ends it. A session started above its checkouts gets one line per held checkout, each
naming the checkout's directory and saying to pin it from a session inside it, since
`/anatomiya:pin` pins the checkout it runs in. It never enters the model's context: the model is the author E5 keeps from
accepting its own work, and a sentence there naming how to accept it is the suggestion E5 refuses. A
lock is given back only while it is still the worker's own, so a takeover between three workers
never frees a fourth.

## 7b. What lives where

The overview carries one more section, above the area listing: which directories this repository
holds, what is in them, how they are tested, and up to three sentences the counts ground. Every word in it
is counted from the repository, because this tool ships no vocabulary of kinds. A line is labelled
with a directory name and a count is nouned with an extension, so the tests line reads
`0 of 504 .tsx files have a namesake test` rather than calling anything a component.

It goes there and nowhere else because the overview has no `paths` key, so it is loaded before any
Read or Write. That is the one channel that reaches a write path nobody read in first, which is
measured: on a 5,517-file Rails API the exploration phase ran as four subagents and no area file
attached in any of them, the one dissected having made 54 `cat`, `grep` and `head` calls and no Read
at all. The four directories that feature's code landed in never attached one either.

### The layout corpus

Every tracked file, from the same `git ls-files -z` pass and under the same deny list and excluded
directories as section 1, and not only the source extensions: a directory holding 40 `.md` files is
a fact about where things live. Nothing extra is parsed for it, and a file the parse never reached
is counted under its extension and appears in no other count.

It describes the tree as it is rather than the pinned population, because it is counts and never a
directive: a tests line that moves when an agent adds a test file is a true count that flips
nothing. A truncated corpus prints `layout: not counted, the scan was truncated` and no roots.

The scan's own summary carries the same counts unbudgeted, since the block on disk can drop lines
to its budget and the terminal is where the whole count still has to show up:

```
layout: 7 roots, 3 folded, tests: 103 cypress under cypress/integration, 7 vitest under src; roster lines: 86 areas with imports, 44 with reuse
```

### Which directories get a line

There is no table of known roots, the same as area discovery. The walk starts at the repository
root, which is never a root itself except on a repository that is one flat directory.

| Rule | Value |
|---|---|
| floor | a directory needs `max(3, ceil(0.01 * N))` files cumulatively, `N` the corpus size |
| descend instead of printing | the name is `src`, `lib`, `app`, `apps`, `packages` or `source`, or one child holds 80% of the directory's files |
| files sitting in a descended directory itself | their own candidate, printed as `lib (files at this level)` |
| a descent that earns no line at all | the directory itself, over everything under it |
| budget | 7 lines, sorted by source files, then total files, then path |

Six shell names, because those are the directory names that say nothing about what is in them;
anything else is a name worth printing. The 80% rule is what makes a Ruby gem's `lib/<gem>` read as
the gem. rubocop prints `lib/rubocop (files at this level): 45 .rb` beside `lib/rubocop/cop`, which
is why a descended directory's own files are a candidate of their own. webpack's `lib` is 652 files
with 117 of them at that level and no child clearing its 144-file floor, so the descent named
nothing, and the map listed `test` and `examples` and never webpack's source at all: that is why a
descent producing no root keeps the directory. A directory under the floor folds into the nearest
root above it, or into the line that says what did not print. That line carries a clause per
population rather than one number: `and N more directories holding M files`, then the files in
directories too small for a line of their own, then the files sitting at the repository root, which
never took the roster's floor and is not a place either. The clause does not say "floor": the Not
covered line calls the area floor "the per-directory floor", a different and smaller number, and most
files this clause counts do sit in an area. Sorting by source files first is
what keeps an asset or documentation directory from displacing code.

The three numbers scale with the corpus and are tuned by measurement. That is the decision; the
values are the current ones.

### Facets

Per file, the parse worker keeps a few facts it can already see, beside the counts. They cross the
IPC channel with `hits` and are a small object of flags and counts.

For JavaScript and JSX: whether the file holds JSX; the modules it imports and the names it takes
from each; whether it imports a test runner, from a closed table (`vitest`, `jest`,
`@jest/globals`, `mocha`, `chai`, `ava`, `tap`, `node:test`, `cypress`, `qunit`,
`@playwright/test`, `playwright`) or makes a top-level `describe`, `it`, `test` or `cy` call; the
names it hands out; and how many module-level functions it defines and does not export. The call is
named by the identifier its callee chain starts from, so a table-driven `test.each([...])("x", fn)`,
`describe.each` and `it.only.each` with a tagged template are the runner's words too: read one
level deep, a file holding only those lost its runner label while importing vitest.

CommonJS is read as well as ESM, on both halves of that. A top-level `require` is an import, and
`module.exports = { a, b }`, `module.exports = fn` and `exports.name = ...` are names the file hands
out. A chained `module.exports = exports = { a, b }` publishes the object at the end of the chain.
An accessor in that object is deliberately not one of the names: it is read through the object
rather than handed out, and the shape it is nearly always written in is a lazy `require`. A getter
on `module.exports` is reachable at runtime, so that is a narrowing of the facet rather than a rule
about CommonJS. The parser's static record holds only the ESM ones, so a repository written in
`require` reported no exports at all and every function in it as a private helper.

For Ruby: whether it declares cases in the RSpec vocabulary, inherits a minitest test case, or
defines a `test_` method inside a class. A DSL call counts where it takes a block and sits outside
every method, which is the altitude the JavaScript half reads: inside a `def` the call runs when
that method does, and a page object naming its steps `context "..." do` declares no case. A class
or module body is where RSpec's own describes sit and stays a site. The superclass wins over the
vocabulary, because
shoulda-context writes `context` blocks inside an `ActiveSupport::TestCase` and that file is
minitest whatever its bodies are written in. Bare `describe` and `it` are minitest/spec's words as
well as RSpec's, so a file written only in those two is minitest where it says so another way: a
`_test.rb` name or a top-level `test/` directory, or a `require` of `minitest` or anything under it.
A call on `RSpec` itself, or `context`, `feature` or `shared_examples`, is RSpec whatever the path.

A file is a test by its facets, its name or its position, and by nothing else. The facets first: a
known runner import, or a top-level `describe`, `it`, `test` or `cy` call. Then the basename, which
counts when it carries `.test.`, `.spec.`, `.cy.` or `-test.`, `-spec.` on the name alone, and when
it carries `_spec.rb` or `_test.rb` and a test tree above it agrees. The Ruby form is the one a
non-test file wears in earnest: `software_spec.rb` is Homebrew's `SoftwareSpec` class and has its
own `software_spec_spec.rb` under `test/`.
Then a `__tests__` path segment, because nothing but a test is ever put in one. Last, for a source
file under a top-level `test`, `tests` or `spec` directory, a source file outside that tree whose
path the file's own tail mirrors: eslint's `tests/lib/rules/no-var.js` covers `lib/rules/no-var.js`
and says so nowhere but in its path. A file counted by one of the last three prints its runner as
`test files` rather than having one guessed at.

Two things do not make a test file. A directory named `test`, `tests`, `spec`, `cypress` or `e2e`
does not, on its own: those trees hold the factories, fixtures, page objects and support code
beside the specs, and charging all of it to the runner read `136 test files under spec/factories`
on one Rails API and 1,979 fixture modules under webpack's `test/cases`. And a file in no language
this tool parses is never one: twenty screenshots under `cypress/` are not twenty specs, and
counting them made the denominator this section exists to be read 24 over 4.

### What a root line says

Every clause is dropped when it counts nothing.

```
- <root>: <n1> <ext1>[ (JSX)][, <n2> <ext2>][ and <k> other]
        [; <t> <Runner> specs[ under <sub>]]
        [; <c> of <n> has|have a namesake test[, <v>][ under <test root>]]
        [; <m> sibling modules[ named <up to three stems>]; <f> of <j> JSX files inline a helper]
```

- The top two extensions by count, then the rest as `and k other`. `(JSX)` marks the first of the
  two printed whose files are at least half JSX; an extension the line does not print has nothing
  to attach a mark to.
- Tests inside a source root are counted per runner and named with the directory most of them share
  (`under __tests__`), because a `*.test.tsx` beside its component and a `__tests__/` directory are
  two different habits. A root more than half of which is tests prints as `<n> <Runner> specs` and
  nothing else, since its extension counts are the specs themselves.
- Namesakes: how many of the root's files have a test file of the same stem, `foo.rb` with
  `foo_spec.rb` or `foo_test.rb`, `Foo.tsx` with `Foo.test.tsx`, `Foo.spec.tsx` or `Foo.cy.ts`.
  Matched on the path tail the way `pairing.mjs` learns a companion root, so
  `app/models/edition/foo.rb` is answered by `spec/models/edition/foo_spec.rb` and not by
  `spec/services/foo_spec.rb`. The tail is asked twice. Whole first, then with the seven tree names
  (`app`, `lib`, `src`, `spec`, `test`, `tests`, `__tests__`) dropped from both sides, because a
  repository that splits a source tree from a spec tree writes the same path on both halves and
  only the word for the tree differs: `modules/budgets/spec/models/budget_spec.rb` answers
  `modules/budgets/app/models/budget.rb`, and `src/vs/base/test/common/foo.test.ts` answers
  `src/vs/base/common/foo.ts`. Only those seven names drop, so `spec/support/user.rb` still answers
  no `app/models/user.rb`: `support` against `models` is left to compare. One last question is asked of every
  candidate the whole tail refused: whether it imports the producer outright. A test that writes
  `from "../lib/counters.mjs"` has named what it covers, which is evidence a
  path cannot carry, and it is the only thing separating a nested source answered by a flat test
  root from the decoy that looks exactly like it. The stem still has to match, so the sentence
  stays the one it always was, and a specifier that carries an extension has to agree on it: a
  compiled `./foo.js` answers the TypeScript spellings it is emitted from and never the
  `./foo.json` beside them. Nothing is resolved against the filesystem, so a directory reached
  through its own `index` reads as no evidence rather than as a guess, and a language whose tests
  never name what they cover gains nothing here. An edge is evidence that a file is
  tested and none about where a root keeps its tests, so it never wins the trailing `under <root>`
  against shared structure: a root any candidate shares wins it, and the test's own directory is
  named only where no candidate shared one. The root the namesakes
  share is named, by a count of votes rather than by the first match, a mirrored match voting for
  the tree the two paths part on. A file several candidates answer votes once, for the first of them
  by path that names a tree at all: the total is halved against the count of answered files, so a
  file counted once has to vote once, and a mirror parting on an ordinary name leaves the vote to
  the next candidate rather than spending it on nothing. A top vote under half the matched files
  names no root at all, since a repository with one `__tests__` per component directory has an
  answer for every file and no one place to name. Half is enough to name one, so where the top vote
  is fewer than the matched files the count there prints before the name: `4 of 63 have a namesake
  test, 3 under src/utils/__tests__`, the way a runner group prints `2 of 3 vitest specs under
  __tests__`. A root with a `test`, `tests`, `spec`,
  `cypress`, `e2e` or `__tests__` directory anywhere in its path is not asked the question: its
  non-test files are what the tests run on, and webpack's `test` read `1 of 7858 has a namesake
  test under test` over the fixture modules its 2,607 tests exercise. Any segment rather than the
  first, because a monorepo nests each package's own tree under the package name: fastlane's
  `gym/spec` stated `1 of 1 has a namesake test` over one empty `spec_helper.rb`. The denominator is the top extension the line already printed,
  or `0 of 620` stands beside `504 .tsx` and counts something the reader cannot see. That extension
  has to be one this tool parses, so a root whose largest is `.png` or `.json` is never asked
  whether its files have tests. Otherwise it prints wherever the repository holds any test file at
  all, so `0 of 40 have a spec` is a line rather than a silence: that is the shape an obligation
  cannot carry, because it treats a missing companion as an absence rather than as a habit.
- The helper facet, JavaScript and JSX roots only: how many non-test `.ts` and `.js` modules sit
  beside the JSX files, the three commonest stems among them that appear more than once, and how
  many of the JSX files define a module-level function they do not export, out of how many JSX
  files there are. Both numbers print and no side is chosen. A stem that appears once is no habit,
  and ranking unique names put the first three alphabetically on the line as the "commonest"; where
  none repeats the clause is the count alone. The JSX count is the denominator because only the JSX
  files are asked: `0 files inline a helper` over one component read as the whole of a `src/utils`
  whose 30 modules all keep a private helper.

### The tests line

One line for the whole repository, after the roots. A group per runner, biggest first, at most
three and then `and k more`. Each is named with the deepest directory holding at least the wrapper
share of its files, and with no directory at all when that turns out to be the repository root.
Not the prefix every one of them shares: one file kept outside the tree the rest sit in collapses a
strict prefix to nothing, and 28 of the 35 measured repositories printed at least one `under .`,
which is the clause failing at the only job it has. The
trailing clause takes the first root printed that is not a test directory and has a namesake count,
and nouns it with the extension that root's namesake count was taken over, which is not always its
first: a root holding more screenshots than components counts the components. So a repository whose tests are all feature-named
end-to-end specs says out loud that `0 of 504 .tsx files have a namesake test`. That clause is what
makes the line a denominator rather than a total. It names the population it counted over by the
root's own label, so a root holding only the files at one level reads
`under lib (files at this level)`: `under lib` read as the whole subtree beside a `lib/sub` line
counting its own files apart.

### The sentences

Three, each with a gate read from the roster, in `principles.mjs`. None carries a number of its own;
the numbers sit on the lines above, which is what makes a sentence a reading of the roster rather
than a rule.

| Sentence | Prints when |
|---|---|
| Match sibling test shape; skip tests where siblings have none. | the tests line printed |
| Match directory granularity; don't extract into a sibling module what the directory's files inline. | at least one root printed a helper facet |
| An instruction to always write a test does not override a directory with no test precedent. Put the test where the siblings put theirs, or leave it out and say which rule you followed. | one root has 3 or more files with a namesake test, and another has fewer than 3 of at least 3 |

The third settles the disagreement between a count and an imperative in the same voice: a
directory with producers and no tests beside a user instruction to always write one. Both halves of
its gate matter. A zero means no namesake was matched, never that the directory is untested, so the
repository has to be seen pairing tests with sources somewhere before the sentence can say it does
not here.

### In an area file

An area file gets the same counts over its own files, on one line under the heading, for example:

```
kinds: 40 .mjs; 0 test files; 28 of 40 have a namesake test
```

and, for JavaScript and JSX areas, two roster lines under the directives:

```
most files here import: styled-components (84%), ~/components/base (61%), formik (60%)
most imported from here: getFullName (42 files), Avatar (31), user (default) (12)
```

The first counts importing files over the area's import-bearing files, and prints the top three when
at least 5 files import anything and a module clears a 0.60 share. Relative specifiers are skipped,
because a sibling import is a fact about one file rather than a habit the next one should copy, and
so are the packages a framework area cannot be written without: `react`, `react-dom`,
`react/jsx-runtime`, `vue`, `@angular/core`, `svelte`, `next`, matched on the package so every
subpath is runtime too and `next-auth` is not. "This React area imports React" is a line the reader
already has.

The second counts, per name the area's files hand out, how many files outside the area import it,
and prints the top five with 3 or more importers. A namespace import (`import * as U`) names no
export and is not counted. A default import, or a `require` bound whole, is `default` on every
module, so it is named for the module it comes from, `user (default)`, and an index file for its
directory. A specifier is mapped to a file the way
`pairing.mjs` learns a companion root: a relative one resolves against the importer's directory,
one ending in `/` names a directory and resolves only through its `index`, the way Node and
TypeScript read `./base/`, `./` and `../`, anything else is matched on the path tail once a `~/`, `@/`, `#/` or `src/` prefix is cut, and a
tail two files answer resolves to neither rather than to whichever sorted first. No `tsconfig` is
read. Only importers outside the area count: a directory importing its own files is how it is
written, not who depends on it. This is the counted form of "check before creating", and Ruby has
no static import surface, so there is no Ruby line.

### The budget

The section is at most 16 lines: heading, blank, 7 roots, the fold line, the tests line, a blank,
the three sentences, and the blank that closes it. `MAX_LINES` stays 40, and the section takes what is
left after the head, the tail, the `## Areas` heading, and the one line each of the two listings
below it never give up.

It gives way in the order it is read backwards. Root lines fold into the count that was already
there, then that count goes, then the sentences, all of them at once, then the tests line, and under four lines the
section prints nothing at all: a root line names one directory, and the tests line is the
denominator for all of them.

In an area file the `kinds` line and the two roster lines outlive a suppressed count and give way to
a stated directive, and they are not offered at all when the `paths` cover has already taken the
body budget. A directive is what the file exists to deliver; a description is what makes the next
file fit beside the ones already there.

## 8. `check`

`check` answers one question: which of the conventions the map stated did this branch break.

The diff is taken from the merge base, never from the base branch's tip. The tip compared against
HEAD lists, the moment the base branch moves ahead, files other people changed, as reverse deltas,
and the check reports findings in code the author never touched.

"Newly introduced" cannot be derived from one run at HEAD, so the analysis runs twice, at HEAD and
at the merge base, and the two finding sets are differenced by content fingerprint rather than by
position. That grammar is `plugins/anatomiya/lib/introduced.mjs`, one leaf the check alone imports.
The fingerprint reads every function and class body inside the site as empty, because three rows
report a whole declaration: a line added inside a function body is not a new `function_style`,
`explicit_return_type` or `doc_comment_style` site on the declaration that holds it. An edit to the
signature still is. Copies that share a fingerprint are matched by their own text first, then by the
lines around them, then by the function they sit in, and only what is left is matched by count.
Two rows judge what is inside the body, `async_error_handling` and `swallowed_error`, so for them a
copy that stopped conforming shares its fingerprint with one that never did. Their copies are matched
by their place among every copy, conforming or not, that opens on the same line text in the same
function, counted from the top and then from the bottom, and are never matched by count: a handler
that lost its `catch` is not absorbed by another anonymous handler in the same file that never had
one, even where both open on `p.then(async (r) => {` or `} catch (err) {`.

A learned row judges a site the way the fold counted it. A superclass or mixin written bare is
resolved against the nesting it is written in, and a class whose chain of parents reaches the
learned base conforms. The fold follows that chain through every class its area declares, and the
check holds only the files the branch changed, so it reads the chain from two places: the map's
`reaches`, for the classes it did not read, and the classes the branch's own changed files declare
in the same area, which replace what the map recorded for them. The area is the one the pinned map
draws, so a directory the branch adds inside it counts as part of it, even where a rescan would make
it an area of its own. A subclass of a base the branch adds
is not told to skip that base, and a subclass of a class the branch moved off the base is.

The head side is read from the working tree wherever the tree differs from the commit, and a file
that exists only in the tree is examined like any other file this branch added. An agent writes,
checks, fixes, then commits, so the moment the findings are cheapest is the moment the work is not
committed, and a check that answered `0 MUST-FIX` there was answering about a file it had not read.
The run says how many files it read that way, because that many make it unreproducible from git
alone. The base side never moves: it is read with `git cat-file` at the merge base, which is what
keeps an agent's own edits from moving the population it is judged against (E2). A file the branch
deleted has nothing to examine and can still owe a finding, as a dropped spec does, so the header
counts it among the changed files, says how many were removed, and the record lists them as
`removed`, whether the deletion is committed or only in the working tree. A move's old path is not
counted as removed, whatever the new name, and neither is a file added to the index and then deleted,
which no commit ever held.

Base ref resolution tries `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`, in that
order, or whatever `--base` names. `@{upstream}` is deliberately absent: a pushed feature branch
tracks itself, and the merge base with itself is HEAD. A `--base` that names this branch's own tip is
refused like `HEAD` is: an expression such as `HEAD~0`, and the branch's own name wherever the base
the check would pick unasked is somewhere else. Another branch at the same commit, or the commit by
its id, is still a base, and is what a branch holding only uncommitted work is checked against. An id
is a name git resolves to no ref, never a name that happens to be spelled in hex, so a branch called
`7812` or `facade` is refused as its own base like any other, and so is `FEAT`, or `café` typed in
NFD, on a filesystem that folds case or Unicode form, where it opens `feat`'s ref file under a name no ref holds. A name two refs hold, a tag and a
branch both called `release`, is refused naming both: git picks the tag and says so only in a warning
the check never sees. `refs/heads/release` names one. On a
shallow clone the base commit is fetched with `--depth=1`, which costs about 3.65s and 12 MB;
`--unshallow` measured 56s and 305 MB and `--deepen=500` measured the same, so bounded deepening is
not offered. `origin/HEAD` is asked of the remote as its own `HEAD`, so a default branch named
anything is found. A depth-1 clone grafts HEAD as a root, so `merge-base` cannot answer there even
with the base fetched, but HEAD's commit still names its parents, and a base that is one of them is
the merge base: that is the pull request's merge ref the default `actions/checkout` fetches. The
same rescue is asked of a base the shallow clone already holds, as a `--no-single-branch` clone or a
`fetch --depth=1 origin main` leaves it. When there is still no merge base, the check degrades to
lines added since the oldest commit the clone holds and says so, and at depth one that commit is
HEAD, so nothing is examined and the caveat names the fix, `fetch-depth: 0`. The report's
`base.sha` is the base ref's own tip and `base.mergeBase` the fork point the diff is taken from.

The diff and the pending listing set their own rename limit, 7,000, where git's diff default is
1,000: past the limit git lists each move as a deletion and an addition, and every site that came
with a moved file was charged to whoever moved it. A branch past even that is said, as
`renames-skipped`. A submodule is left out of both, since a gitlink is a commit rather than a file.

One rule here is not a dimension and does not come from the registry. `test_precedent` asks whether a
test the change added has any precedent in the source root it covers, rather than whether its contents
match a claim, because a file that creates its own directory is the only member of it and conforms with
itself every time. It carries the same finding shape as any other, `dimension: "test_precedent"` in the
json, so a reader that filters by dimension sees it beside the counted rows; it is not in the dimension
count the documentation checks, since nothing about it is measured per area. What it does and refuses to
do is H38, and the sentence the map states beside it is H39. Its reason, which the `PreToolUse`
notice prints too, gives the root's count in the tests line's words, `src/hooks: 0 of 5 .tsx files
have a namesake test`: the count is over one extension, and a bare `5 files` read as the whole of a
directory holding nine. A map written before the root recorded that extension says `0 of 5 files`
unless the root holds only one, since its most common extension can be a screenshot.

Severity, in the order the checks are made:

| Result | When |
|---|---|
| NIT | no convention counted here, or a gate suppressed the one that was |
| FIX | the area file's 40-line budget dropped the claim's block: "the area file names this claim without its counts" where the notice still prints its sentence, "had no room to state this claim" where it does not; or the run is capped, "capped by this run:" and the cause, which is the stale reason the header prints or no merge base; or the predicate is partial; or the map already names this file as an exception; or no baseline population was recorded; or the claim was stated on the rest of the repository's bound rather than this area's own (D8); or the Wilson bound on the baseline counts does not reach 0.90; or the baseline itself was not perfect. Two caps sit outside that ladder (H24): a file whose area holds no slot for the claim is judged on the nearest enclosing area that states one, "counted in" that area, and a MUST-FIX on a path the owning area's globs never deliver to, such as a new subdirectory under a `dir/*.ext` area, drops to FIX, "counted in" the area or "does not reach" |
| MUST-FIX | all baseline sites conform, so this branch is the first violation |

Baseline counts come from the pinned population, never from the current one, or the agent's own
accumulated output raises the bar it is judged against. Staleness caps severity rather than
refusing: a check that refuses to run at pull-request time is the blocking hook this design rejects,
arriving at the moment it costs the most. Nothing here blocks anything. A changed Ruby file is read
at both revisions and parsed by prism, the same split the scan uses: the map states Ruby claims, so
excluding Ruby here would state conventions and enforce none of them.

The check reads a parse result the way the scan does, because the two used to disagree about what an
unread file means. A missing parser dependency fails the command rather than reporting no findings:
findings never set the exit code here, so a zero exit is exactly the thing the command file tells the
agent to trust. A file whose syntax the parser rejected is named apart from one that could not be read
at all, since the first is the branch's own code and the second is this tool. And a framework's claim
is asked only where the corpus shows that framework, read from the corpus rather than from the map,
because the check runs on repositories that have no map at all.

One answer, three writers. Text is what the agent reads. `--format json` prints the record itself,
schema and caveat codes and all, which is what the acceptance harness and a CI job read rather than
matching sentences nobody promised to keep. `--format github` prints one workflow command per
finding, MUST-FIX as an error, FIX as a warning and NIT as a notice, so a pull request shows each
one on the line it is about; then a warning per caveat carrying its code, one for a capped run, and
one counting the rule files nobody here wrote, because counts alone are what a run with no map and no
readable diff prints and that reads exactly like a branch that broke nothing. Every
repository-controlled value is neutralised before any of the three sees it, and findings set the exit
code in none of them. A path loses only what would break its line or reorder it, a control
character, a newline, a bidi override or a zero-width joiner, and is otherwise the file's own path,
however long and in whatever script, because each writer hands it to something that opens the file;
everything else goes through the encoder.

`--format json` carries the record's own version, so a reader can refuse a shape it does not know
rather than read fields positionally. It is the rule `facts.json` enforces on disk (C10), offered
here to whatever reads the stdout; the scan's and the pin's records carry a version of their own for
the same reason. Their paths go out the same way the check's do: the scan's root and rule file
names and the pin's area and file paths are whole, so the scan record's root is the one its text
line prints and the one `check --format json` gives for the same checkout.

### The caveat codes

A caveat is why a run could not answer in full. The sentence is what a human reads; the code is what
anything else reads, because with prose alone "the diff could not be read" and "one file was read
from the working tree" are told apart by a substring match on wording nobody promised to keep. There
are 28. Most appear at most once in a run; the ones that repeat are named under the table.

| Code | What it means |
|---|---|
| `map-unreadable` | there is a map and none of it was used: the store resolves outside the repository, the file will not open or does not parse as JSON (a committed one that conflicted on a merge), or its schema is past the one this build reads |
| `no-map` | no map on disk, so nothing was stated and nothing can be enforced |
| `no-base-ref` | none of the candidate base refs resolved |
| `no-merge-base` | a base was found and shares no fork point with HEAD, so nothing can be called newly introduced |
| `nothing-examined` | no merge base and no earlier commit either, so no file was looked at |
| `shallow-no-history` | shallow clone: the base commit is present and shares no held history with HEAD |
| `shallow-unfetched` | shallow clone and the base commit could not be fetched |
| `diff-unreadable` | the diff against the base could not be read, so no file was examined |
| `renames-skipped` | the branch moves more files than git will pair up at the rename limit the check sets, 7,000, so a file moved and edited may be judged as new |
| `added-ranges-unreadable` | in the degraded mode, the added-line ranges could not be read, so nothing was attributed to this branch |
| `pending-unlisted` | the working tree's pending edits could not be listed, so only committed content was read |
| `pending-unjudged` | files carry uncommitted edits and there was no base to judge them against |
| `read-from-tree` | files were read from the working tree rather than from a commit, which is what makes the run unreproducible from git alone; the message says how many |
| `frameworks-unknown` | the corpus could not be listed, so no framework's claims were checked |
| `capabilities-unknown` | the corpus could not be listed, so no routing claim was checked |
| `head-unreadable` | a file's head version could not be read, in the tree or at HEAD |
| `base-unreadable` | a file's version at the merge base could not be read, so the file was skipped |
| `head-crashed` | a file crashed the parser at the head side |
| `head-rejected` | the parser rejected a file's syntax at the head side |
| `head-oversize` | a file was past the size cap at the head side |
| `head-unparsed` | a file went unread at the head side for none of the three above: this tool or the filesystem could not produce it |
| `base-unparsed` | a file did not parse at the merge base, so it was skipped |
| `stripper-missing` | `flow-remove-types` is not installed, so a file written in Flow is rejected rather than read |
| `engine-missing` | a parser engine is not installed, so no file of its languages was checked; the message names it and its remedy, and a change with nothing else to read refuses instead |
| `obligations-unchecked` | the file list at HEAD could not be read, so no file-to-file obligation was checked |
| `rules-escaped` | `.claude/rules/` resolves outside the repository, so nothing there was examined |
| `rules-unlisted` | `.claude/rules/` could not be listed |
| `rules-unreadable` | files in `.claude/rules/` could not be read, so whose they are is unknown |

The four head-side unread causes are four codes rather than one because the reader's next move
differs for each: a crash is this tool's, rejected syntax is the branch's own code, the cap is a
generated file, and the fourth is this tool or the filesystem. Each of those four can appear once per
file, and so can `head-unreadable`, `base-unreadable` and `base-unparsed`.

`no-merge-base` is the one code that can appear twice in one run. Resolving the base emits it when a
candidate ref resolves and has no fork point with HEAD, and the run then falls to the added-lines
mode, which emits it again to say what that mode does and does not answer. Where no ref resolved at
all, the first is `no-base-ref` and `no-merge-base` appears once, and on a shallow clone the first is
`shallow-no-history`, which names the fetch that would answer.

## 9. Predicting your own result

Roughly, in order of how much they move the number of stated claims:

- **Directory shape.** Many directories of 8 to 40 source files is the good case. A flat `src/` with
  400 files gives you one area and one set of claims. A directory under the floor, which is 3 in a
  small repository and 8 from about 2,000 files up, folds into its nearest ancestor that clears it,
  and folds into nothing at all if no ancestor does.
- **Git history.** The author gate needs 2 distinct authors on the files carrying the stated
  side's matches, or 1 where the whole history has one author. A young team repository or a squashed
  import will state very little, and so will a shallow clone: the bar cannot be lowered on a window,
  so a `--depth=1` CI checkout states nothing and prints every claim as a count.
- **Actual consistency.** The ratio gate is 0.90. Anything your team is 80% consistent about will
  print as counts, not as a claim. On the example repository, the ratio gate is the one most of the
  slots that did not state failed.
- **Language.** JavaScript, TypeScript and Ruby only.
- **Repository size.** No cap. A 2,468 file repository takes about 1.8 seconds against a pinned
  baseline, a 5,477 file Ruby repository about 6.2, and a synthetic 100,000 file repository about
  9.2. Scaling is close to linear in file count. There was a 50,000 file cap, and hitting it did not
  trim the tail: it suppressed every directive in the map, so a repository one file over the line
  got counts and nothing else. On that 100,000 file repository it reported 50,000 files and stated
  0 of 720 claims; the same repository now states 480 of 720 with every file covered.

The honest expectation: most slots print as counts and a minority state. On the 2,468 file example,
114 of 1,507 slots stated. Across ten measured repositories it is 333 of 3,847, and three of the ten
state nothing at all. If your run states almost everything, look at applicability before believing
it.

Two runs stand behind those numbers: `scripts/e2e-corpus.mjs` drives the shipped CLI from a fresh
clone through scan, pin and check on 35 repositories and this one, and `scripts/measure-layout.mjs`
recounts every number the `## What lives where` section prints, both recorded under
`docs/measurements/`.

## 10. Readiness and setup

`/plugin install` installs a plugin's dependencies itself. Measured on Claude Code 2.1.251: the
loader reads the plugin root with a non-recursive `readdir` and runs `npm ci --ignore-scripts`
there, with a 60 second cap, where a `package.json` and one of `bun.lock`, `bun.lockb`,
`npm-shrinkwrap.json` or `package-lock.json` sit together. `yarn.lock` and `pnpm-lock.yaml` are
refused by name, because their resolution-time hooks run around `--ignore-scripts`. A root holding
the manifest and no lockfile is passed over with nothing logged, and the plugin then installs with
none of its dependencies.

This plugin ships `plugins/anatomiya/package-lock.json` for that reason. It stopped shipping one at
0.3.0, which moved the plugin out of the repository root and left the marketplace's lockfile behind:
every version from then until 0.5.0 installed with no parser, and the first command that needed
one refused with a sentence about `setup` that nobody sees on a repository holding no JavaScript.
`scripts/validate.mjs` refuses a plugin that declares dependencies and ships no lockfile, and
refuses one whose lockfile resolves a package to a version the marketplace's own does not, since
the suite runs against one of those and whoever installs the plugin gets the other.
`scripts/plugin-lock.mjs` builds it from the marketplace's resolutions rather than resolving afresh.

Where that install did not run or did not finish, `doctor` says which of the two it was and `setup`
is what fixes either. A scan is neither of them: a scan that installed on finding a dependency
missing would make every scan an outbound call.

`anatomiya doctor` probes what the parsers need and prints one line each: the version where it
answered, and otherwise what was wrong and what to do about it. The remedy is the engine's own,
because npm cannot install an interpreter and installing Ruby does not install a node module. The
type checker is probed beside the engines and marked optional, since only `--deep` asks for it.
`doctor` exits 0 whatever it found: a non-zero exit would read as a probe that could not run.

The first row is the node the tool itself runs on. Nothing enforces a plugin's `engines` field, and
Claude Code's own installer needs no Node, so the `node` on a user's `PATH` can be anything: on Node
20 a scan died halfway with `Map.groupBy is not a function` while `doctor` called every engine ok.
Every other verb now asks the same question before it does any work. Under the floor `scan`,
`check`, `pin` and `setup` refuse with that row's sentence and exit 1, and a hook answers its empty
object and exits 0, as it does on any failure.

| Row | Host | Ready when | Remedy |
|---|---|---|---|
| `node` | the process itself | its version is 22.0.0 or newer, the floor both manifests declare in `engines` | install Node 22 or newer and put it first on `PATH` |
| `oxc` | node | `oxc-parser` imports | `anatomiya setup` in the plugin directory |
| `flow-remove-types` | node | it imports. A row of its own, and not an engine: it is `oxc`'s dialect stripper, and one absent costs a dialect where the other costs the run | the same install |
| `prism` | the `ruby` interpreter | the interpreter's own prism, or the newest prism gem installed for it when its own is older, answers a version of 1.0.0 or newer. A `ruby` that cannot run `ruby -e 1` at all (an rbenv shim with no version selected exits 127) is reported with its own first line of stderr, not as a missing prism | install Ruby 3.4 or newer, which ships prism 1.x, or run `gem install prism` on the Ruby you have, and put `ruby` on `PATH`; for a `ruby` that does not run, make `ruby -e 1` run first |
| `typescript` | node | it imports at major 5, the one the tier runs on. One of another major is reported by its version, and `scan --deep` refuses it with the same sentence rather than calling it absent. Optional: only `--deep` needs it | the same install |

`anatomiya setup` installs what node hosts, and only that. It runs
`npm install --omit=dev --include=optional --ignore-scripts --no-audit --no-fund` with `cwd` set to
the plugin's own directory, resolved from the module rather than from `process.cwd()`, because every
command runs inside somebody else's tree and installing there would put this tool's dependencies in
it. `--ignore-scripts` is the load-bearing flag: without it a dependency's install script runs
arbitrary code in the plugin directory. `--include=optional` is there because the parser's native
binding is an optional dependency of `oxc-parser`: an npm configured with `optional=false` left it
out and answered "up to date". An exit of 0 is not taken at its word either: setup asks the
node-hosted engines again, in a fresh node because a module that failed to load stays failed in the
process that tried it, and fails naming any that still does not load. It is the only command that installs anything and the only one that
reaches a package registry; `scan`, `check` and `pin` never call it. The only other outbound call
anywhere here is the check's shallow-clone path, which is one `ls-remote` and one `fetch --depth=1`
and nothing else (F5).

Two refusals rather than an attempt. npm that is not on `PATH` is answered with the one sentence that
fixes it, since npm cannot install itself. And on Windows `setup` refuses and hands over the command
instead of spawning: npm ships there as `npm.cmd` with no `npm.exe`, an extension-less spawn resolves
against `.com` and `.exe` only, so the attempt answers ENOENT on a machine that has npm installed,
and running a batch file needs the shell nothing here may use. The refusal prints the same argv and
directory a dry run does, so one spelling of the command survives on every platform.
