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
| Excluded directories | `node_modules`, `vendor`, `.yarn`, `fixtures`, `__fixtures__`, `__snapshots__`, `test_cases`, `testdata`, `test-data`, `golden`, `goldens`, `__mocks__`, `mocks`, `dist`, `build`, `coverage`, `.next`. Not `examples`: 8,967 paths in a 35-repository corpus match it and much of that is maintained code |
| Caps | none on the repository; 1 MB per file, which skips a bundle or a compiled file and says so. Measured across 35 repositories, no hand-written source exceeds 850 KB, and every file between 1 and 4 MB sat at the parse timeout boundary, flipping between crashed and parsed with machine load |

Fixture and vendor directories are excluded because that code is deliberately unidiomatic. In one
measured repository, 18 of 85 discovered areas were fixture directories, and a map that teaches a
parser test's intentional anti-patterns as house style is worse than no map.

Every path is then confined to the repository: lexical containment first because it costs nothing,
then `realpath` on both sides because `resolve()` normalises `..` but never follows a symlink and
`readFile` does. It fails closed, and the resolved path is what gets read, not the unresolved one.

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
reported as uncovered in the overview instead. On a 2,468 file repository that was 196 files, about
8%. Expect a larger share on a tree with many small leaf directories, and much less on a flat one.

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

The area id is the first 8 hex of `sha256(path)`, which is what makes `anatomiya-area-<id>.md` a
stable filename across scans.

## 3. The parse pool

One module drives both parsers and reads what comes back. The scan and the check each used to do
that themselves, which meant each decided separately what an unread file means, and only one of them
ever decided it.

JavaScript and TypeScript are parsed by `oxc-parser`. It runs in a pool of warm child processes,
one parse per message. Never in-process, never in a worker thread.

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

Where a language's parser answered for **no** file at all, which is what a missing interpreter looks
like, the scan writes nothing and removes nothing. A blind run's areas all count nothing and would
otherwise be deleted as gone. A syntax error is not that: the parser ran and answered.

| Guard | Value | Enforced |
|---|---|---|
| File size | 1 MB | checked with `stat` before the file is dispatched |
| Wall time | 5s | `SIGKILL` from the parent |
| Resident memory | 1 GB | polled every 25ms via `ps`, starting 250ms after the file goes in flight |

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
experimental upstream. And it publishes, for all 165 node types it emits, which properties hold
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
each of those can inject a `-r` into a process about to be pointed at repository files. The timeout
is 15s of **silence** rather than a whole-run limit, because a large repository legitimately runs
for minutes and what a hung parse looks like is silence; behind it sits a wall clock sized to the
number of files handed over, since a child that answers one file every fourteen seconds keeps the
idle timer happy and never ends.

A child either of those timers killed is spawned once more, for the files that never answered and no
others, and only what is still unanswered after that is charged. Both timers measure the machine
rather than the files, and a file charged as crashed in one scan and parsed in the next moves the
always-loaded overview, which is the same reason a JavaScript parse the pool's own clock killed goes
back on the queue once. A child that exited on its own, a missing interpreter and a fatal from the
script are charged on the first attempt: a second child answers those the same way at twice the
cost. Every record says which attempt answered it.

## 4. Dimensions and the three numbers

A dimension is one claim about one area. 46 ship, the filename row included: 25 for JavaScript, 30 reachable in JSX, and 16 that speak Ruby, plus the one type-checked row, which sits in the total and reaches a scan only with --deep. Each
is defined by three quantities, not one.

| Quantity | Meaning |
|---|---|
| `applicability` | files that could participate in the claim at all, that is, files holding at least one candidate site |
| `candidates` | sites inside those files where the construct appears |
| `conforming` | candidates matching the positive pattern |

The ratio is `conforming / candidates`. Counting conforming files instead of conforming sites was
measured flipping 10 of 39 verdicts, in both directions: it hid real conventions and it manufactured
false ones.

`applicability` is rendered beside the area's file count on every stated line, because that is the
only thing a human can audit a predicate with. A wrongly narrow predicate produces a ratio of 1.0
over a small candidate set and reads as a strong convention; `12 of 12 sites across 3 of 20 files`
reads as what it is.

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
| `zone_aware_time` | precise | ruby | the current time is read through the application time zone |
| `record_lookup` | partial | ruby | records are fetched with `find_by` and checked, not `find` |
| `model_callbacks` | partial | ruby | models keep behaviour out of lifecycle callbacks |
| `service_result_shape` | partial | ruby | service entry points return their failure instead of raising |
| `migration_reversible` | partial | ruby | migrations declare `change`, not `up` and `down` |
| `migration_schema_only` | partial | ruby | migrations change the schema and leave the data alone |
| `column_null_declared` | partial | ruby | new columns are declared `null: false` |
| `table_primary_key_declared` | partial | ruby | new tables declare their primary key type |
| `reference_foreign_key` | partial | ruby | reference columns declare their foreign key |
| `function_naming_case` | precise | js, jsx | functions are named `<style>`, learned |
| `exported_symbol_case` | precise | js, jsx | exported names are `<style>`, learned |
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

The five JSX rows are the ones that make the JSX total 30 rather than 25: a `.tsx` or `.jsx` file is
counted by every `js` dimension as well as these. The five migration rows are Rails and count as
Ruby, which is what takes Ruby from 11 to 16.

The three `route_` rows ask whether a cross-cutting concern goes through the repository's own
module. The wrapper is learned per file from its relative imports, by filename vocabulary (log,
logger, logging; client, http, api, request, fetcher; config, env, settings), and the direct forms
are a closed table (console calls, fetch and axios, process.env reads). Each row is offered only where at
least three examined files already route through a wrapper (C14), so a repository that logs to
the console on purpose, or one holding a config.ts nobody imports, never carries a line that can
only read zero.

A row marked "learned" carries a template rather than a fixed sentence. Its sites vote with the
naming class they spell, the plurality class becomes the sentence, and a tie learns nothing and
produces no slot. One more such row, `file_naming_case`, asks about filenames: it needs no parser,
so the reducer composes it the way it composes the obligations. A learned class that has moved
since the pin closes the slot (`learned-moved`) until a human re-pins, because the pinned counts
answer a different sentence than today's. The filename row has one candidate per file, so under
the evidence gate an area needs 35 classifiable filenames to state it; in smaller areas the row
feeds the check's learned enforcement and prints as counts, which is the gate working rather than
a bug.

Five learned rows vote with a name rather than with one of the four naming classes. `extends_base`
and `class_base` take the plurality superclass a directory's classes name, `module_include` the
plurality module its class and module bodies mix in directly, counted once per body so a class
including two modules is one site rather than two the learned module can never both answer, and
`interface_prefix` and
`type_alias_prefix` the leading capital a declared type name carries before a second capital, where
`IComment` votes `I` while `Comment` and `IO` vote for no prefix at all. The first three learn a
name out of the repository's own source, so it goes through the encoder where the sentence is
filled rather than at each place the sentence is rendered. The last two can learn an absence, which
renders as `interfaces carry no prefix` rather than being filled into the template, and which is
the model default, so a repository that prefixes nothing prints counts and a prefixed one states.
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
| `evidence` | the Wilson 95% lower bound on the same counts also reaches `0.90` | the ratio asks what this sample did; the bound asks whether the true rate can be trusted there. A perfect record needs 35 sites to hold 0.90, which is why there is no separate minimum on `candidates` |
| `concentration` | the sites are worth `>= 3` files by inverse-Simpson count, **and** the ratio still reaches 0.90 with the largest file dropped | 200 sites in one file plus one each in 13 others gives 14 files at ratio 1.0 and clears any file-count floor. A share of the candidates cannot answer this either: at two files the largest share is at least 0.5 by arithmetic, and at fifty files no share ever fires however lopsided the spread is |
| `applicability` | `applicability >= max(ceil(sqrt(F)), ceil(0.25 * F))`, where `F` is the files the dimension can speak about | the stricter of two floors, because each is wrong alone. The root asks for more than a quarter below sixteen files, where a quarter of a small directory is one or two files. The share holds above it: on its own the root asked 11 files of 120, and a measured 120-file area where 11 files used `?.` and 109 read absent values without it stated the claim over all 120 |
| `authors` | `>= min(2, distinct authors in the repository)` distinct authors over the files carrying the counted matches | one person's habit is not a convention, but one author is not a thin team either: it is the whole team, and there is no second opinion being withheld |
| `directories` | `>= 2` distinct directories, **only when the area spans more than one directory** | applied unconditionally this blocked 124 of 170 measured slots, because area discovery finds leaf directories and a leaf directory holds one |

Gates are evaluated in that order and the **first** failure is the one recorded and printed. So
`no convention. 0 of 133 sites (ratio)` means ratio failed first, not that ratio was the only
failure. Where git could not be read at all, the author gate is recorded as `history-unread` rather
than as a team of zero.

The whole battery runs once per side. Only the three numerators move between the claim and its
inverse: how many files the sites are spread over, how much of the area the construct reaches, and
who wrote it are facts about where the sites are, not about which way they point.

Authors come from one `git log -M --no-merges --name-status` pass, unioning rename chains, and
`-M100%` where `remote.origin.promisor` is set. `-M` scores similarity, which needs blob content a
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
Which side a model writes comes from `lib/model-defaults.json`, a committed table with provenance
per entry, written by `scripts/measure-defaults.mjs` from the model's own output parsed through
the same predicates the scan uses. A learned row's default is a class rather than a side:
"functions are named camelCase" in JavaScript is exactly what the model writes anyway, so a
learned class equal to the model's own renders as counts too. An unmeasured entry reads `none`
and fails open: the dimension keeps stating.

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

Four conditions stop a directive before any gate is consulted:

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
| `anatomiya-overview.md` | none | every turn |
| `anatomiya-area-<id>.md` | the area glob | when a file under that glob is read |

That last row is the ceiling on the whole design. A `paths` rule attaches when the agent uses the
Read tool on a matching file or when an `@file` mention names it. It does not attach on grep, on
glob, on `cat` through bash, or on an edit with no prior read.

The overview head carries two fixed sentences beside the counts. "Read a file before editing it:
these notes load when you read, not when you grep" is that ceiling said to the agent. "When unsure
what this code does, read it, grep it, or run it instead of guessing, and say what you could not
verify" is the one line here that is not a count: it names the tools the agent already has and
permits the abstention, which is what keeps a guess from being written down as a fact. Its
sources and the alternatives it was chosen over are in
`docs/research/one-line-that-stops-guessing.md` (A16). Both are constant, so A5 holds.

Writes are atomic: temp file in the same directory, then rename, so a crash never leaves half a
context file. `.claude/anatomiya/facts.json` is written first and holds every count, gated or not,
so no rendered file exists that is not derivable from facts on disk. It carries a schema version,
and the check refuses a version past the one it knows rather than reading the fields positionally:
an older record is readable and is read, a newer one is a shape this build has never seen. A run that read no file of a
language writes neither, for the same reason: keeping the rendered files while replacing the facts
they came from breaks exactly that invariant.

Three constraints shape the rendering:

- **The overview must be byte-stable between scans with no source change.** The token economics only
  work on a cached read, so there is no timestamp, no duration, and no count that moves per commit.
- **Each generated file stays under 40 lines.** A rewritten context file does not re-attach inside a
  live session, and the change notice truncates head and tail, so a long file loses its middle in
  both copies. This is also why the scan prints a line telling you to restart. It is a bound the
  renderer holds rather than a hope about how many dimensions an area has: an area file drops its
  suppressed counts before its stated directives and says how many did not fit, and the overview's
  area listing gets whatever the rest of that file leaves. The `paths` list is exempt, because a
  glob dropped to save a line mis-delivers the whole file.
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
directories, so both are checked. The scan fails closed; the check reports it as a caveat, because
refusing a branch at review time is the blocking behaviour this design rejects.

Files in there are read by their head, one megabyte at most, and only when the opened handle is a
regular file. The ownership test is a regex anchored at byte zero, so the rest was never the
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
pipes), rejects mixed-script paths as probable homoglyphs, caps on grapheme clusters before quoting,
and emits paths JSON-quoted.

The claim text is the one rendered string that does not go through it, because it is this tool's own
sentence rather than a repository-controlled value. It used to: the encoder strips `|` as a table
boundary, so "defaults are taken with ??, not ||" rendered as "defaults are taken with ??, not" in
every JavaScript area of every repository. Line breaks are still collapsed, and a test pins the
registry to sentences that need nothing more than that.

## 7b. What lives where

The overview carries one more section, above the area listing: which directories this repository
holds, what is in them, how they are tested, and two sentences the counts ground. Every word in it
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
| descend instead of printing | the name is `src`, `lib`, `app`, `packages` or `source`, or one child holds 80% of the directory's files |
| files sitting in a descended directory itself | their own candidate, printed as `lib (files at this level)` |
| a descent that earns no line at all | the directory itself, over everything under it |
| budget | 7 lines, sorted by source files, then total files, then path |

Five shell names, because those are the directory names that say nothing about what is in them;
anything else is a name worth printing. The 80% rule is what makes a Ruby gem's `lib/<gem>` read as
the gem. rubocop prints `lib/rubocop (files at this level): 45 .rb` beside `lib/rubocop/cop`, which
is why a descended directory's own files are a candidate of their own. webpack's `lib` is 652 files
with 117 of them at that level and no child clearing its 144-file floor, so the descent named
nothing, and the map listed `test` and `examples` and never webpack's source at all: that is why a
descent producing no root keeps the directory. A directory under the floor folds into the nearest
root above it, or into `and N more directories holding M files`. Sorting by source files first is
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
names it hands out; and how many module-level functions it defines and does not export.

CommonJS is read as well as ESM, on both halves of that. A top-level `require` is an import, and
`module.exports = { a, b }`, `module.exports = fn` and `exports.name = ...` are names the file hands
out. The parser's static record holds only the ESM ones, so a repository written in `require`
reported no exports at all and every function in it as a private helper.

For Ruby: whether it declares cases in the RSpec vocabulary, inherits a minitest test case, or
defines a `test_` method inside a class. A DSL call counts where it takes a block and sits outside
every method, which is the altitude the JavaScript half reads: inside a `def` the call runs when
that method does, and a page object naming its steps `context "..." do` declares no case. A class
or module body is where RSpec's own describes sit and stays a site. The superclass wins over the
vocabulary, because
shoulda-context writes `context` blocks inside an `ActiveSupport::TestCase` and that file is
minitest whatever its bodies are written in.

A file is a test by its facets, its name or its position, and by nothing else. The facets first: a
known runner import, or a top-level `describe`, `it`, `test` or `cy` call. Then the basename, which
counts when it carries `.test.`, `.spec.`, `.cy.`, `-test.`, `-spec.`, `_spec.rb` or `_test.rb`.
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
        [; <c> of <n> has|have a namesake test[ under <test root>]]
        [; <m> sibling modules named <three stems>; <f> files inline a helper]
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
  `spec/services/foo_spec.rb`. The root the namesakes share is named, by a count of votes rather
  than by the first match. The denominator is the top extension the line already printed, or
  `0 of 620` stands beside `504 .tsx` and counts something the reader cannot see. That extension
  has to be one this tool parses, so a root whose largest is `.png` or `.json` is never asked
  whether its files have tests. Otherwise it prints wherever the repository holds any test file at
  all, so `0 of 40 have a spec` is a line rather than a silence: that is the shape an obligation
  cannot carry, because it treats a missing companion as an absence rather than as a habit.
- The helper facet, JavaScript and JSX roots only: how many non-test `.ts` and `.js` modules sit
  beside the JSX files, the three commonest stems among them, and how many of the JSX files define
  a module-level function they do not export. Both numbers print and no side is chosen.

### The tests line

One line for the whole repository, after the roots. A group per runner, biggest first, at most
three and then `and k more`. Each is named with the deepest directory holding at least the wrapper
share of its files, and with no directory at all when that turns out to be the repository root.
Not the prefix every one of them shares: one file kept outside the tree the rest sit in collapses a
strict prefix to nothing, and 28 of the 35 measured repositories printed at least one `under .`,
which is the clause failing at the only job it has. The
trailing clause takes the first root printed that is not a test directory and has a namesake count,
and nouns it with that root's top extension, so a repository whose tests are all feature-named
end-to-end specs says out loud that `0 of 504 .tsx files have a namesake test`. That clause is what
makes the line a denominator rather than a total.

### The two sentences

Two, each with a gate read from the roster. Neither carries a number of its own; the numbers sit on
the lines above, which is what makes a sentence a reading of the roster rather than a rule.

| Sentence | Prints when |
|---|---|
| Match sibling test shape; skip tests where siblings have none. | the tests line printed |
| Match directory granularity; don't extract into a sibling module what the directory's files inline. | at least one root printed a helper facet |

### In an area file

An area file gets the same counts over its own files, on one line under the heading, for example:

```
kinds: 40 .mjs; 0 test files; 28 of 40 have a namesake test
```

and, for JavaScript and JSX areas, two roster lines under the directives:

```
most files here import: styled-components (84%), ~/components/base (61%), formik (60%)
most imported from here: getFullName (42 files), Avatar (31), Timestamp (12)
```

The first counts importing files over the area's import-bearing files, and prints the top three when
at least 5 files import anything and a module clears a 0.60 share. Relative specifiers are skipped,
because a sibling import is a fact about one file rather than a habit the next one should copy, and
so are the packages a framework area cannot be written without: `react`, `react-dom`,
`react/jsx-runtime`, `vue`, `@angular/core`, `svelte`, `next`, matched on the package so every
subpath is runtime too and `next-auth` is not. "This React area imports React" is a line the reader
already has.

The second counts, per name the area's files hand out, how many files outside the area import it,
and prints the top five with 3 or more importers. A specifier is mapped to a file the way
`pairing.mjs` learns a companion root: a relative one resolves against the importer's directory,
anything else is matched on the path tail once a `~/`, `@/`, `#/` or `src/` prefix is cut, and a
tail two files answer resolves to neither rather than to whichever sorted first. No `tsconfig` is
read. Only importers outside the area count: a directory importing its own files is how it is
written, not who depends on it. This is the counted form of "check before creating", and Ruby has
no static import surface, so there is no Ruby line.

### The budget

The section is at most 15 lines: heading, blank, 7 roots, the fold line, the tests line, a blank,
the two sentences, and the blank that closes it. `MAX_LINES` stays 40, and the section takes what is
left after the head, the tail, the `## Areas` heading, and the one line each of the two listings
below it never give up.

It gives way in the order it is read backwards. Root lines fold into the count that was already
there, then that count goes, then the two sentences, then the tests line, and under four lines the
section prints nothing at all: a root line names one directory, and the tests line is the
denominator for all of them.

In an area file the `kinds` line and the two roster lines outlive a suppressed count and give way to
a stated directive, and they are not offered at all when the `paths` cover has already taken the
body budget. A directive is what the file exists to deliver; a description is what makes the next
file fit beside the ones already there.

## 8. `check`

`check` answers one question: which of the conventions the map stated did this branch break.

The diff is three dots against the merge base, never two. Two dots compares the endpoints, so the
moment the base branch moves ahead it lists files other people changed, as reverse deltas, and the
check reports findings in code the author never touched.

"Newly introduced" cannot be derived from one run at HEAD, so the analysis runs twice, at HEAD and
at the merge base, and the two finding sets are differenced by content fingerprint rather than by
position.

Base ref resolution tries `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`, in that
order, or whatever `--base` names. `@{upstream}` is deliberately absent: a pushed feature branch
tracks itself, and the merge base with itself is HEAD. On a shallow clone the base commit is fetched
with `--depth=1`, which costs about 3.65s and 12 MB; `--unshallow` measured 56s and 305 MB and
`--deepen=500` measured the same, so bounded deepening is not offered. When there is still no merge
base, the check degrades to lines added since the oldest commit the clone holds and says so.

Severity, in the order the checks are made:

| Result | When |
|---|---|
| NIT | no convention counted here, or a gate suppressed the one that was |
| FIX | the map is stale, or there was no merge base, or the predicate is partial, or the map already names this file as an exception, or no baseline population was recorded, or the Wilson bound on the baseline counts does not reach 0.90, or the baseline itself was not perfect |
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

## 9. Predicting your own result

Roughly, in order of how much they move the number of stated claims:

- **Directory shape.** Many directories of 8 to 40 source files is the good case. A flat `src/` with
  400 files gives you one area and one set of claims. A directory under the floor, which is 3 in a
  small repository and 8 from about 2,000 files up, folds into its nearest ancestor that clears it,
  and folds into nothing at all if no ancestor does.
- **Git history.** The author gate needs 2 distinct authors on the files carrying the conforming
  matches. A young repository, a solo repository, or a squashed import will state very little.
- **Actual consistency.** The ratio gate is 0.90. Anything your team is 80% consistent about will
  print as counts, not as a claim. On the example repository, 671 of the 834 suppressed slots failed
  on ratio.
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
