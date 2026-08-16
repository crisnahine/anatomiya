# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Five learned rows, so a map says what a new file in this directory is expected to sit on.
  `extends_base` and `class_base` learn the superclass a directory's classes name, `module_include`
  the module its class and module bodies mix in, and `interface_prefix` and `type_alias_prefix` the
  letter its declared type names carry. The first three learn a name out of the repository's own
  source, so the sentence is encoded before it is rendered. The last two can learn that there is no
  prefix at all, which is what a model writes unprompted, so a repository that prefixes nothing
  prints counts and a prefixed one states.

### Fixed

- The encoder strips `--!>` as well as `-->`: parsers close a comment on either, so a
  repository-controlled value holding the first could close a comment the renderer never opened.
- A rule file's head is opened first and typed on the handle it is read from, so a path swapped
  between a stat and an open cannot hand the type test one file and the read another. A fifo is
  opened non-blocking so it cannot hold the open, and a shape the platform refuses to open at all
  (a directory on Windows, a socket anywhere) is typed on the path with nothing read after it, and
  still occupies its name. Two CodeQL alerts that predate 0.1.12.

## [0.1.12] - 2026-08-16

The map now says only what a repository does differently from what the model writes anyway, and it
grew the claim families reviewers actually fight about. Ten of the shipped claims are things the
model does unprompted (measured, thirty runs through the deployed harness); those still count and
still enforce, but they no longer spend a line of always-loaded context. Nine new rows ship: three
that learn a naming class from the repository's own files, functions and exports; one that says
whether exported functions carry a doc comment, with a real counter side; and five that ask whether
logging, network and environment reads route through the repository's own module. A layering
dimension was probed on four repositories and refused at this tool's own evidence bar, with the
numbers.

The per-file size cap moved from 4 MB to 1 MB, because a 35-repository sweep found the 1 to 4 MB
band holds only bundles and compiled output sitting at the parse timeout, flipping between crashed
and parsed with machine load, and each flip moved the always-loaded overview. Five review loops
over the branch found two defects the tests had passed around: a facts-sourced value reaching a
rendered claim unencoded, and the class-default filter reading a registry marker the reducer never
carried. Both are pinned by tests that go through the real path.

Closes #33.

### Added

- A model-defaults table, `lib/model-defaults.json`. A stated side the model already writes
  unprompted renders as a counts line, `matches model default`, never as a directive; the check
  enforces it unchanged from `facts.json`. Entries carry provenance and an unmeasured entry fails
  open. `scripts/measure-defaults.mjs` writes the table by parsing the model's own output through
  the scan's predicates. Facts schema is 10.
- Learned-class naming rows: `file_naming_case`, `function_naming_case` and
  `exported_symbol_case`. The class is the plurality of the area's own sites, a tie learns
  nothing, and a class that moved since the pin closes the slot (`learned-moved`) until a human
  re-pins. The check enforces the stored class, and a new file breaking the area's filename
  class is a finding.
- `doc_comment_style`, with a real counter side: repositories that document their export surface
  state the claim, and repositories whose code explains itself state the counter, which is the
  directive that stops tutorial-style over-commenting. The parse worker now hands each
  dimension the tree's comments and the exact string it parsed.
- Capability routing rows: `route_logging`, `route_network`, `route_env` (JS), and
  `logger_over_puts`, `http_through_client` (Ruby). The wrapper is learned per file from
  imports or receivers named in the category vocabulary; each row is offered only where at
  least three files already route through one, so a repository that logs to the console on
  purpose never carries a line that can only read zero.
- A second A/B on vscode, this time on a claim with headroom that the model-defaults table does
  not filter: `docs/measurements/2026-08-16-vscode-nonnull-2.md`. The arms differ (0.818 with the
  map against 0.000 without, over 4 and 1 scored files), read with its own small-sample caveat.
- A third A/B on the new family, `exported names are PascalCase` in a vscode protocol area:
  `docs/measurements/2026-08-16-vscode-symbols.md`. A null result about the task, which asked
  for constants and functions where the learned class is PascalCase, and a working record that
  the harness scores a learned row against the map's class rather than the file's own vote.
- The research catalogue this work answers: `docs/research/why-agents-miss-house-style.md`, 34
  failure modes with a primary source and an evidence label each, and
  `docs/measurements/2026-08-16-new-row-variance.md`, the per-repository variance record for the
  nine new rows.

### Fixed

- A Rails migration's timestamp prefix is cut before its stem is classified (#33). Read whole,
  `20260816120000_AddBadColumn.rb` classified as nothing, so conforming migration names counted on
  scan and the realistic violating shape was the one the check could not see. Now the Pascal stem
  is a MUST-FIX against a stated snake_case area with a clean baseline.
- The per-file size cap is 1 MB, down from 4 MB. A 35-repository sweep found no hand-written
  source above 850 KB and every file in the 1 to 4 MB band a bundle, compiled output or a perf
  fixture sitting at the 5 s parse timeout boundary, flipping between crashed and parsed with
  machine load; each flip moved the always-loaded overview (A5). A size cap is deterministic
  where a wall-clock timeout is not. `.yarn` is excluded from the corpus outright for the same
  reason.

### Decided against

- An import-direction (layering) dimension. Probed on four repositories: a require() repository
  is invisible to an import-statement site, and at this tool's own Wilson gate 0 of 4 put even a
  third of their area pairs over the bar. `docs/measurements/2026-08-16-layering-probe.md`.

## [0.1.11] - 2026-08-16

Flow, so a repository oxc refuses by name is read rather than charged as broken: react goes from 287
rejected files and 36 stated claims to 2 and 79. An opt-in `typescript` checker behind
`scan --deep`, with one dimension and a degraded mode that says which of two things went wrong. A
committed intake table for what became a dimension, what collapsed into one, and what has no
denominator and never ships. And one command for the only success measure this tool accepts, with
the first measurement it took committed beside it.

Every row the build contract carried as `todo` is closed, which is all seventy-eight of them.

Four counting bugs came out of asking a different question: parse one file twice, once with its
annotations blanked, and see which dimensions disagree. That comparison is a test now, so a
dimension that answers two ways for one file fails CI. A further eight came from a review of the
work above, and the two worst were both a test passing for the wrong reason.

### Added

- A `.js`-family file oxc rejects is retried with its Flow types stripped. oxc refuses Flow by name,
  and react is written in it: 287 of its 2,277 files were charged as syntax the parser rejected, so
  their sites counted nowhere and the areas holding them closed as a population that moved. Now 2
  are rejected and the repository states 78 claims instead of 65. The stripper replaces types with
  whitespace rather than removing them, so the length in UTF-16 code units does not move and every
  offset still lands where it does in the source, which is the unit oxc counts in. It is loaded the first time a
  `.js`-family file is rejected, so a repository whose JavaScript all parses never pays the ~13 MB
  it costs. A rejected file may be Flow or may simply be broken, and telling those apart is what the
  retry is for, so it cannot be what decides whether to load. react goes from 287 rejected files and
  36 stated claims to 2 and 79. (B19)

- A tree that came back from that retry no longer answers the rows that depend on the annotations,
  and each such row says so on itself. The retry blanks the annotations, so `exported functions
  declare their return type` read 0 of 1213 on react where the truth is 986, and the check printed
  `FIX` beside a line that declares one, quoting the annotation in its own snippet. `import type`
  statements are sites of the extension claim and the stripper deletes them outright, so a stripped
  file read as more conformant than it is: react writes 309 of them and not one carries an
  extension. All three readers drop such a row together, and the file leaves that row's denominator,
  because a file nobody asked is not a file that declined. (B20)

- A missing `flow-remove-types` is named on screen instead of showing up as unreadable files. The
  dependency arrived after the plugin did, so a `node_modules` older than it loads the parser, cannot
  run the retry, and charges every Flow file to the rejected count with nothing connecting the two.
  Both the scan summary and the check caveats say which dependency is absent. (B19)

- An opt-in second tier behind `--deep`: the `typescript@5` checker, one dimension, and a degraded
  mode that says so. `typescript` is an optional dependency and never a runtime one, pinned inside
  major 5 because 7 is the Go port with no JS API and a range admitting it would turn `--deep` into a
  silent no-op. One child process for the whole corpus, because the checker is whole-program:
  narrowing the file set was measured saving 3% of the time and driving unresolved types from 3.1% to
  36.2%. Every dimension declares which tier answers it, and the default caller is offered the
  syntactic one, so a claim that needs a checker nobody ran cannot reach a map. (B7)

- `a call chain stays inside one type`, the one dimension the checker buys. Measured on three real
  repositories: 0.212 on a client app whose dependencies are installed and where the tier resolved
  0.895, 0.366 on typeorm and 0.797 on supabase. That spread is 0.585 and every one of them is under
  0.90, which is the bar `CONTRIBUTING.md` sets. `partial`, because a receiver whose type did not
  resolve is not counted as a distinct type, so an unresolved chain reads as conforming and
  under-counts rather than inventing violations. (B7)

- A degraded checker states nothing and says which of two things went wrong: a `tsconfig.json` that
  could not be read keeps its own reason, and one that read cleanly while type resolution fell under
  0.80 reports `low-resolution`. It closes its own rows and no syntactic one. The tier's real
  requirement turned out to be unlike anything else here, and the measurement is what found it: it
  needs the repository's own dependencies on disk. typeorm reported a config error because it extends
  `@tsconfig/node20` and the clone has no `node_modules`; supabase resolved 29% across a monorepo for
  the same reason. (B8)

- The repository's own `tsconfig.json` is read through a host confined to the repository, so an
  `extends` pointing outside it is refused and reported rather than followed. The file list is the
  corpus rather than the config's globs, every option that writes to disk is forced off, and the lib
  files come from the plugin's own `typescript` rather than the repository's, which can ship one of
  its own. (B9)

- A check whose map holds a type-checked claim says so on its own line, instead of reading like a
  branch that broke nothing. `--deep` is a scan option only: the checker is whole-program, so a check
  would have to build the corpus at two revisions to answer with it. (B7)

- One committed intake table for what became a dimension, what collapsed into one, what was renamed
  so a ratio does not read as a verdict, and what has no denominator and never ships. The collapses
  were a finding in a document this repository does not hold, which is a finding nobody can act on
  twice. Writing it found two the audit did not. A claim naming a principle now refuses to load at
  all. (G2, G3, G4)

- `scripts/ab.mjs`, one command for the only success measure this tool accepts: two worktrees off one
  commit, one holding the map, injection verified in both arms before any trial runs, and every
  written file scored by the dimension's own predicate rather than by a regex written for one task.
  It refuses to run where the best stated claim has no headroom, because the one A/B done by hand
  scored 10 of 10 in both arms and measured a ceiling. (G5)

### Fixed

- A cast no longer hides the value it wraps. `return null as any` is a return of null and was not
  counted as one, which react writes 24 times and vscode 20; `x ?? ([] as Foo[])` is a default taken
  with `??` and was not counted either. `satisfies`, `!`, `<T>x` and parentheses wrap the same way.
  Found by counting one file twice, once with its annotations blanked, and asking which dimensions
  disagreed. (C11)

- `declare const x: number` is no longer counted as module state, and neither is a binding inside a
  namespace or an ambient module. Neither binds anything at run time. (C12)

- A file whose types were stripped no longer sits in the denominator of the rows it was never asked.
  A directory of ten plain files and ten Flow files rendered `10 of 10 sites across 10 of 20 files`,
  which reads as half the directory declining a convention that was never measured there. Facts
  schema 7.

- The Flow retry no longer carries its own list of file extensions. It is derived from the one the
  corpus uses, so an extension added there is in scope for both at once rather than entering the
  corpus and never being retried.

- Every dimension states which files could participate in its claim, and what its predicate cannot
  see where it is partial. `applicability` was whatever `run` happened to emit, so a predicate
  seeing a tenth of its own construct produced a ratio of 1.00 over four files and read as a strong
  convention. The two fields are tied to `precision`, so the marker and the reason cannot disagree,
  and the registry refuses to load over a row that carries neither. (C2)
- Witness sources per dimension, driven through the same parse the scan uses: the ones the declared
  sentence says are applicable, and the neighbouring constructs that must not count. A new row with
  no witness fails the completeness test, and where a sentence promises a count, the count is
  asserted. (C2)
- Every member of every closed table a predicate recognises its construct through is driven through
  that predicate: React's hooks, the translation modules, elements and calls, the test-runner
  modifiers, the column types, the reference calls and the model base classes. The witness pairs
  cannot see a table shrink, because losing a name changes no shape: dropping `next-intl` from the
  module list makes every file in such a repository inapplicable and every other test stays green.
  The expected members are written out in the test rather than read from the table, since an
  expectation taken from the code agrees with it by construction. (C2)
- `scripts/audit-applicability.mjs` reads one or more `facts.json` files and prints the applicability
  share per dimension, flagging any `precise` row whose median sits under a quarter. Measured across
  express, sidekiq, vuejs/core and mastodon: of the 37 rows that produced a slot in any of them, 6
  flag, and each names a construct that is simply rare. Which rows produce a slot depends on which
  repositories are asked, so the four are named. A flag is a prompt to open the row, not a verdict.
  (C2)


- The raw parser transfer is no longer asked for on Windows. oxc allocates a 6 GiB buffer per parsing
  operation, `rawTransferSupported()` never asks which platform it is on, this pool runs up to eight
  workers at once, and Windows both commits at allocation and is the one platform where the pool's
  memory guard stands down. The parser answers the same tree without the flag. (B18)

- `service_result_shape` refused every receiver, so `def self.call` was not a service entry point at
  all. That is the commonest Ruby service form, and the ratio was stated over whichever subset of a
  repository writes instance entry points instead. `def self.` counts now, the way the migration
  rows already counted it. (C2)
- Any pinned file this tool could not read suppressed its whole area as a population change, so a
  permanent blind spot read as a population that moved. React is written in Flow, which oxc does not
  take: 287 of its files never parse at either revision, and 507 of its 986 slots were closed for
  it. The current pass already leaves such a file out of its counts, so the two passes disagreed
  about what an unreadable file means. React now states 65 claims instead of 36, webpack 92 instead
  of 80, next.js 172 instead of 162. A file that has become readable since the pin still closes the
  area, because the baseline is then missing sites today can see. (E8)
- The rendered line divided by the area's file count while the gate divided by the files the
  dimension could speak about, so the number a reader audits a narrow predicate with was not the
  number that decided it. Wrong in a mixed-language area before any of this: a Ruby claim read "5 of
  10 files" where five were all it could ever speak for. (C3)
- The applicability gate divided a numerator over parsed files by a denominator over every file of
  the language, so a repository holding syntax this tool does not take read as one full of narrow
  predicates. Measured across 35 repositories: react is written in Flow, 287 of its 2,277 files are
  rejected, and its stated claims go from 36 to 65 once the denominator counts only what was
  examined. Webpack 80 to 92, next.js 162 to 172. (C4)
- Every first scan of a repository reported `.claude/rules/` as a directory it could not list.
  `readdir` answers ENOENT the same way it answers a permission failure, and the bare catch treated
  the two alike, so every first run reported a broken install rather than an empty one. Not-there is
  an answer; could-not-read is not. (A4)
- A count of one wore a plural. Measured over 35 repositories: seven printed "1 files hold syntax
  the parser rejected", on the scan summary and in the file that loads on every turn. The two
  surfaces read one sentence for the count they share, so they cannot agree with the number and
  disagree with each other. (A4)
- The facts record dropped two numbers the rendered map prints, so the map was not derivable from
  the record the check reads in its place: the count behind "and N more", and the namesake count an
  obligation renders as "N with a namesake elsewhere in the tree". Found by scanning 35 repositories
  and looking for a rendered line the record could not reproduce: 1,158 slots on one repository
  printed a full exception list with no count of what was left out. (C7)
- The facts record dropped `langFileCount`, the files a dimension can speak about, so the share that
  separates a narrow predicate from a rare construct shaped the gate and was then unreadable from
  disk. Schema 5. A map written before it carries every count and no denominator, and the audit now
  says how many slots it could not measure and exits non-zero, rather than printing the empty table
  that reads as a repository with no dimensions in it. (C3)

## [0.1.10] - 2026-08-15

Every row the build contract still carried as partial, closed, except the one blocked on a document
that is not in this repository. Ten of them, and each was the same shape: a decision enforced at the
call sites that happened to exist, rather than by the code.

Reviewing that work against a hostile repository then found seven more of the same shape in rows
already marked done, four of them reproduced end to end, and closing those is most of what follows.

### Fixed

- The writer removed a file on two of the three facts ownership needs. `facts.json` was the third
  and nobody read it, so a file an older build wrote, or anything left behind by a wiped store, was
  deleted by the next scan. The map on disk is read before the new one replaces it, and no readable
  map now makes nothing removable rather than everything. (A3)
- The check called anything without our filename prefix unattributed, which both missed a
  hand-written `anatomiya-notes.md` and lumped our own leftovers in with somebody else's context.
  Three-fact ownership decides it now, in one module both surfaces read, and "we did not write this"
  is reported apart from "we wrote this and no map names it". (A3, A4)
- Nothing bounded a generated file's length. Thirteen stated JavaScript claims already clear forty
  lines, which is the point past which a mid-session rewrite reaches the model in neither the head
  nor the tail of its change notice. An area file now drops its suppressed counts before its stated
  directives and says how many of each kind did not fit; the overview's area listing takes whatever
  the rest of the file leaves. The `paths` list is exempt, since a glob dropped to save a line
  mis-delivers the whole file, so the bound is measured over what a reader reads: across 35
  repositories, 17 hold an area whose cover alone runs past forty lines, the worst at 170 patterns,
  and every one of those bodies came to ten lines or fewer. (A6)
- Area discovery's independence from the order the corpus arrived in held by accident. `git
  ls-files` answers sorted, so nothing established that the always-loaded overview does not rewrite
  itself when a filter or a cache reorders the file list. (A5)
- A dimension that forgot `precision`, or spelled it `"Precise"`, was silently capped below top
  severity by the same comparison a deliberate `partial` is, and read in the map as a claim nobody
  marked. The registry refuses one at load. The obligations were the case in point: they are not in
  `ALL_DIMENSIONS`, and every per-file precision test had missed them. (C5)
- Four git reads that grow with the repository were still buffered, where `execFile` throws
  `RangeError: Invalid string length` from inside Node's own exit handler and `maxBuffer` does not
  protect: `ls-tree -r`, the worktree diff, the range diff, and the check's own changed-file list,
  which lists every path there is on a branch off a distant base. The `--name-status -z` grammar has
  a streaming reader beside the buffered parse, and both are one reading of what a rename's three
  fields mean. (F6)
- `--` is not universal in git: `rev-parse`, `cat-file`, `merge-base`, `config` and `status` do not
  take it, so a repository-controlled value in one of those argument positions rested on whichever
  predicate was meant to have caught it. Every git call now checks its arguments against a closed
  list of the flags this tool actually passes, so a ref, a sha or a path beginning with a dash
  refuses the call instead of reaching git. (F5)
- The memory guard's own `ps` ran with no timeout, through `execFileSync`, which blocks the parent's
  event loop: a `ps` that never returned was the guard becoming the hang it exists to prevent. The
  Ruby bridge timed silence and not the wall clock, so a child answering one file every fourteen
  seconds never finished. Both parser bridges now also run outside the repository, and git carries
  an environment that refuses a credential prompt. (F5)
- A caller overriding one Ruby guard replaced the whole object, leaving every guard it did not name
  undefined. A timer set from one of those fires at once rather than never. Surfaced by the wall
  clock above, which is the first guard added since the callers were written. (F5)
- `commands/pin.md` runs a scan in its own step three and carried neither the rule against opening
  the generated files with the Read tool nor the note that a running session keeps the old map. The
  pin command says both now, and the CLI prints the restart line where it sends you off to scan.
  (A7, A8)
- **A tracked symlink at `.claude` moved every write, every removal and `facts.json` outside the
  repository.** Git mode 120000 survives a clone, and `join` normalises `..` while following no
  link, so lexical containment was not containment. Reproduced: the map written into a sibling
  directory, that directory's filenames named in the always-loaded overview, and one of its
  `anatomiya-*.md` files removed by the next scan. F2 had been applied to the corpus read and to
  nothing else, which is the half that only reads. Both directories are resolved component by
  component now, before anything is written; a dangling link is refused rather than created
  through. The scan fails closed and the check reports, since refusing a branch is the blocking
  behaviour this design rejects. (F2)
- **A file in `.claude/rules/` was read whole to run a regex anchored at byte zero.** A tracked
  symlink to a 400 MB blob took peak resident size to 1.2 GB; pointed at `/dev/zero` the read never
  returned. Now the first 8 KB, and only when the entry is a regular file: a directory named
  `x.md` throws `EISDIR` on open and a fifo blocks on it. Measured after: 61 MB, and `/dev/zero`
  completes. (F17)
- **A directory named `anatomiya-overview.md` failed every scan with an errno.** That name is
  fixed, so a repository can spell it, and `rename` refuses the shapes `open` does. It is reported
  as the condition it is, before a dry run answers as well as before a write. (F17)
- The overview named a file the same run wrote over. A hand-written file taking a generated name is
  replaced, because that name is ours by construction, and calling it a file this tool did not
  write was false about a file that no longer existed. It also moved the overview between two scans
  of unchanged source, which is the one thing it may never do. (A5)
- The overview ran one line past its bound whenever every area stated something and they still did
  not all fit: the trailing count reserved its line only for areas that were never eligible. (A6)
- The check listed every rule file it found, into the context of the agent reading the report, and
  the scan printed one unencoded line per file: a filename carrying a newline printed as two raw
  lines, where `commands/scan.md` tells the agent to report the lines the scanner printed. Both are
  encoded and bounded now, like the overview already was. (F17, F4)
- `filesAt` answered an empty set for a listing git refused to produce. An empty set is a real
  answer meaning "no files", and the obligation reads it as "no companion exists anywhere", so
  every changed producer on a branch owed a file sitting right there, at MUST-FIX where the map
  states the obligation. It answers `null` now, as the diff and the worktree listing already did,
  and both callers treat that as a question left unanswered. Predates this change; the streaming
  work put a comment two functions above it stating the opposite rule. (F15)
- `readFacts` was left out of the containment fix its writing half got, so a check read and
  enforced `facts.json` from outside the repository through the same link, while the same run
  reported it had not looked at that directory. (F2)
- The type test that stopped `/dev/zero` used `lstat`, which also refused a symlink to a real
  `.md`. Claude loads one on every turn exactly like a regular file, and it went missing from the
  scan, the check and the overview at once; a symlink holding a generated name failed the scan
  outright, where the atomic replace had always worked on it. `stat` follows the link and still
  answers false for a directory, a fifo and `/dev/zero`. (F17)
- **A rule file this tool could not open was reported as somebody else's.** `readHead` answered an
  empty string for an unreadable file, which put it through the frontmatter test as if it had been
  read. Reproduced: a mode-000 area file of this tool's own came back foreign, the always-loaded
  overview said so, and it could never re-enter the removable set, so a stale map for a deleted
  directory loaded forever. Ownership nobody checked is not asserted now: unreadable is its own
  answer, reported on all three surfaces and never removed. (F17)
- A rules directory that could not be listed was reported as one holding nothing foreign, the same
  lie the symlink branch was added to refuse. It earns a caveat now. (F17)
- The overview told the reader to "scan again to clear them" about files scanning is what leaves
  alone. Two of the three facts ownership needs is not ownership, so this tool will not remove
  them, and the always-loaded file may not promise a fix it refuses to apply. (A3, A4)
- The check read the file list at HEAD on the scan's clock rather than its own, 120s against the
  30s every other read in that phase carries. (F5)
- The overview was budgeted against its area listing alone, while the listing of rule files this
  tool did not write was rendered after it and unbounded. A repository with enough of both put the
  always-loaded file eight lines past its bound. Both listings share what the fixed sections leave
  now, each keeps at least one line, and 52,416 rendered combinations hold at forty. (A6)
- The head cap that stopped a 400 MB read was first set at 8 KB, which is smaller than this tool's
  own frontmatter: an area's `paths` list is one line per pattern, and canvas-lms generates a
  14 KB file. Its closing fence fell past the head, so the scan called its own output a file it had
  not written, never removed it, and named it in the overview as somebody else's. Sized by what we
  write now, and pinned by a test that renders a 220-pattern cover. (F17)
- `--dry-run` reported a file "was replaced" and area files "removed" for work it had not done. The
  removal line carried that slip before this change. (A8)
- The overview listed files this tool wrote under the sentence "Any other file there was not
  written by this tool". Each kind keeps its own sentence, because only one is true of each and the
  reader's next move differs. (A4)
- `git` ran with no restriction on the transports it may use. The check's shallow path is the one
  place this tool talks to a remote, and it reads the repository's own `.git/config` to do it,
  where an `ext::` URL is a shell command. (F5)

### Changed

- The overview names the other `.md` files in `.claude/rules/` instead of only counting its own. The
  contract asked for the enumeration on the other side, every file we generated, so any other is
  identifiable by absence; measured against A9 that is about 4 KB of hex filenames added back to the
  file that loads on every turn, on the repositories where nothing is wrong. Naming the others is
  the same guarantee at no cost when clean, it names the file a reader would otherwise have to go
  and find, and it arrives in the file loading beside it. The scan prints them one per line too,
  where it used to print a count and no names. (A4)
- Every filename a scan plans is checked to be a bare `anatomiya-*.md` before anything is created,
  so an area id carrying a separator refuses the whole write. It held because the id is a digest;
  now it holds whether or not it stays one. (A1)
- `.claude/rules/` has one owner, `lib/rules.mjs`. The prefix, the frontmatter test, the filename
  rule and the directory audit lived across the renderer, the writer and the check, and the writer
  and the check disagreed in the direction that deletes.

## [0.1.9] - 2026-08-15

An architecture pass over the seams the 0.1.8 pass left open, and the six defects the moves surfaced
on the way. Every change is a place two modules still held one piece of knowledge; every defect is
one the move made visible rather than one it introduced.

### Fixed

- The baseline pass dropped its own truncation flag, so F7's whole-map suppression covered one of
  the two corpus reads. The baseline materialises blobs from the pinned commit and parses them a
  second time, and the Ruby bridge hits its per-line guard there exactly as it does on the working
  tree. A scan that answered for part of a population still stated directives over the rest of the
  map, with `suppressAll` false.
- A directory whose own name is glob syntax, which a repository may legally have, broke the pattern
  that was supposed to name it. `app/**` reached the whole tree as a glob, and passed through the
  encoder it lost its leading `*` run to the markdown bullet rule and matched nothing. Neither is
  deliverable, so such a directory no longer roots an area and no cover names it; its files fold into
  an ancestor that can be spelled, whose recursive tail still reaches them.
- The check read a file's content with `git show <rev>:<path>`, which prints a tree listing for a
  path that has become a directory. It reads blobs through the same `cat-file blob` the baseline
  uses, so the object type is asserted rather than assumed.
- An overview whose areas all carried counts and stated nothing read "Areas (3)", named none of
  them, and then offered "and 3 more areas". More than which? The listing is deliberately limited to
  areas that state something, so naming none of them is the ordinary case for a repository before
  any convention is measured, not an edge. One area now reads "1 area".

### Changed

- `lib/git.mjs` is now every git call this tool makes, not most of them. `corpus.mjs` and
  `authors.mjs` each ran their own `spawn` with their own guards, so a second streamed entry point
  sits beside the buffered one and both carry the same battery. It bounds a single record, which
  neither hand-rolled reader did: output carrying no delimiter grew one buffer until it hit the
  string limit streaming exists to avoid. `git status --porcelain -z` was a fourth NUL grammar read
  by hand in the check, and is read here now. The deepest-area-owner rule and the first-line-of-stderr
  helper each had copies that could disagree about one file's fate, and now have one owner apiece;
  the 4 MB per-file ceiling four readers share is in `lib/limits.mjs`, a leaf, so no parse worker
  loads the corpus and a git runner to learn one number. The owner rule's two copies had already drifted: the baseline's compared
  path lengths, which scores the repository root at 1, so a one-character area path could never
  displace it.
- `lib/baseline.mjs` offers the scan two entry points, `resolve` and `measure`. It offered five, and
  the order they had to be called in was written down nowhere; the scan then read four record shapes
  back out of them to assemble one answer. Its git plumbing moved to `lib/git.mjs`, which is where
  the check was already going for the same base ref.
- `verdictFor` in `lib/reduce.mjs` decides what closes a slot, rather than being handed the answer.
  The gate battery and the both-sides invariant were already there; what was still split is the
  ordering, which lived across the baseline's population blocks and a `suppression` helper in the
  scan. Every gate-and-population interaction is now asked of the function directly rather than of a
  repository, so F7's whole-map suppression keeps one end-to-end test and the rest is table-driven.
- `lib/facts.mjs` owns the machine record end to end: it already held the schema, the reader and the
  polarity decision, and now holds the writer and the per-dimension projection that lived in
  `write.mjs`. The check's own tests fabricated a record at `schema: 1` while the writer emitted 3,
  so `readFacts`' main path was only ever tested against a shape nothing produced; they write through
  `writeFacts` now.
- An area carries its `paths` patterns in the two halves they are composed from, `dir` and `tail`,
  rather than joined and taken apart again by a second reading of the grammar in the renderer. The
  emitted patterns do not change. The facts schema is 4 for it.
- A parse of in-memory sources left its scratch directory behind when a write into it threw. The
  whole pass is wrapped now, so the directory goes whether or not the writes finish.
- The parser pool forks no more workers than there are files to parse. A check examines the handful
  a diff touched, and forking the machine's whole pool for one of them paid fork cost for nothing.
- `lib/parse.mjs` drives both parsers and decides once what an unread file means. The scan and the
  check each drove them separately, so the four causes were computed on one path and none of them on
  the other, and every fix to the reconciliation had to be made twice. The engine split, the scratch
  directory a caller holding blobs rather than files needed, and the per-dimension loop that was
  copied into both bridges all sit behind one entry point now. One guarantee that was previously
  written out twice: a dimension that throws on an odd tree costs its own count and not the file.

## [0.1.8] - 2026-08-15

An architecture pass over the pipeline's seams, and the ten defects it found on the way. Every one is
a place two modules held one piece of knowledge and had already drifted apart, and seven of them are
the same failure: reporting a clean result for work that never ran.

### Fixed

- `check` reported that it found nothing when it could not parse anything. With no `node_modules` it
  emitted one caveat per file and exited 0, which the command file tells the agent means the check
  ran; `scan` had raised the install error since 0.1.6, on the same condition, from the same parse
  record. Both commands now fail with the same message.
- `check` folded four different reasons a file went unexamined into one sentence. Syntax the parser
  rejected is the branch's own code to go and look at; a file this tool could not read is not. The
  scan has named the two apart since 0.1.6.
- `check` ran every Rails claim on repositories holding no Rails. It never asked which frameworks the
  corpus shows, so `zone_aware_time` reached a plain-Ruby branch as a NIT, which is the measured
  symptom that C8 was written to stop and that the scan stopped in 0.1.6.
- A pattern with no `*.` in it lost its leading `**` to the encoder's markdown-bullet rule, so a
  `Rakefile` delivery glob rendered as `/Rakefile` and matched nothing.
- The CLI summary and the overview each spelled the size cap their own way, under a comment claiming
  the two could not drift. One builder now writes both, which also groups the four unexamined-file
  lines together in the summary: the size-cap line used to print after the unread-history line and
  now prints with its siblings.
- A diff git refused to produce came back as an empty change list, so `check` examined no file,
  raised no finding and said nothing about it, which renders exactly like a branch that broke
  nothing. Both the changed-file list and the added-line ranges now report it. Base resolution and
  the pending-edits listing still read their output unguarded, which is what keeps F15 `partial`.
- A missing `ruby` looked exactly like a repository full of files that crash: `ruby.mjs` never
  marked an absent interpreter, so the guard above, which reads that flag, could not see it and a
  Ruby-only branch still reported that it found nothing. Both parser bridges now draw the same line
  between an install problem and a bad file, which fixes the same hole in `scan`.
- The framework probe could refuse the whole run. Listing the corpus throws when git will not answer,
  and that was the first read in `check` that could stop a report rather than qualify it. It now
  reads the answer the scan already stored in the map, so a mapped repository does no work at all,
  and a corpus that will not list costs the framework's claims and a caveat instead of the run.
- With a map from a newer schema, the report printed `capped by this run: no map on disk` above a
  note saying the map is a schema this build cannot read. The first was false and pointed at the
  wrong fix.

### Changed

- One git runner, in `lib/git.mjs`, carrying the timeout and the byte cap for the buffered reads in
  `baseline.mjs` and `check.mjs`. There were four runners, with three different timeouts and one with
  none at all; `corpus.mjs` still keeps its own, and the streamed reads are untouched by design. The
  `--name-status -z` record grammar was three hand-rolled state machines and is now one parser.
- `lib/facts.mjs` owns the machine record's shape: the schema version, reading it, and which of a
  dimension's two sentences an area was handed. The version lived in the writer, the rule for reading
  an older record was copied into two modules, and the reader never looked at the version at all. It
  does now, and refuses a version past its own rather than reading unknown fields positionally.
- One slot's verdict is assembled in one place. The gate battery, the population blocks and the
  invariant that a blocked slot closes *both* of its sides were spread across three modules, and
  nothing short of a full repository could reach the assembly to test it.
- Measuring the baseline moved behind the baseline module's own seam, with the parser and the
  reducer handed in. The scan was reaching into the population record's internals to do it.

### Removed

- `lib/forge.mjs`, a `gh` measurement helper that shipped in the package and was imported by nothing.
  It was the only code in the published plugin that touched the network.

## [0.1.7] - 2026-08-14

Measured against 35 public and private repositories, 186,917 tracked source files. Nine issues, each
with the measurement that forced it in `DECISIONS.md`.

### Fixed

- JSX in a `.js` file was handed to the TypeScript grammar, where `<div` opens a type assertion. 727
  of react/react's 2,296 files and 3,924 of next.js's 21,358 were counted from a recovered tree, and
  nothing reported it. The parser buffer is now named after the file's real extension. react goes
  from 51 stated claims to 66, and its `assertion_style` count from 906 sites to 13,737. Always
  asking for the JSX grammar is not the fix: `<string>x` is legal in `.ts` and a syntax error in
  `.tsx`.
- Both parser bridges computed a syntax-error count that nothing read, so a file the parser rejected
  was charged as examined and its recovery walked as if it were the file. oxc recovers to an almost
  empty program and silently drops sites out of the denominator; prism recovers further and answered
  a *conforming* site from a method with no body. Such a file is now unread, and reported as its own
  line on both surfaces.
- A file uncovered because its area counted nothing was reported as "too few per directory", which
  was only ever true of a directory below the floor. A scan with no ruby printed that sentence beside
  "202 files could not be parsed". The two causes are named apart.
- `git log -M` scores similarity, which needs blob content a `--filter=blob:none` clone does not
  hold, so the author pass fetched from the promisor one round trip at a time. 33 of 35 measured
  clones could not answer at all and reported history unread. A partial clone now uses `-M100%` and
  refuses to lazy-fetch: 40 seconds and no history becomes 386ms, 8,527 files and 333 authors. A full
  clone is untouched.
- A run whose parser never answered for a whole language deleted the map it could not rebuild.
  `env -i PATH=/usr/bin:/bin` on a Rails repository removed three correct area files in the same run
  that reported it could not read them. Such a run now writes nothing, removes nothing, and says
  which language went unread.

### Added

- `.mts`, `.cts`, `Rakefile`, `Gemfile`, `config.ru`, `*.gemspec` and `*.jbuilder`: 803 files in the
  corpus that both parsers already read and nothing counted. `.rbi` stays out, because a Sorbet
  signature describes types rather than anything anyone wrote. An area holding a file whose name
  carries no extension gets one delivery pattern per such name, so it is not counted and then never
  delivered.
- `test_cases`, `testdata`, `test-data`, `golden`, `goldens`, `__mocks__` and `mocks` to the excluded
  directories: 2,218 files across the corpus. angular keeps 2,010 files of golden compiler output
  under `test_cases`, which was 55 of its 339 areas and every one of its 476 unparseable files.
  `examples` is deliberately left in, at 8,967 paths, because much of it is maintained code.
- A dimension may declare the framework its claim belongs to, and is offered only where the corpus
  shows that framework. `zone_aware_time` has no counter-claim, so off-Rails it could only ever print
  zero, and did: 123 sites on Homebrew, 197 on puppet, 97 on fastlane, 96 on chef, plus a NIT
  delivered onto a plain-Ruby branch. 141 such slots are gone. The signal is `app/models/`,
  `db/migrate/` or `config/application.rb` in the corpus, which separates 14 Rails repositories from
  5 plain across the 19 measured.

### Changed

- A file-to-file obligation learns its companion root from the corpus instead of declaring it.
  alphagov/whitehall keeps model tests under `test/unit/app/models` and read `0 of 160 sites, 117
  with a namesake elsewhere in the tree`; it now reads `117 of 160 sites`. discourse answers its
  controllers in `spec/requests`, which no hardcoded pair reaches. The declared pair remains the
  prior: a tie learns nothing, and where no companion lines up at all it stands unchanged, which is
  what keeps the honest zero for a repository that writes specs and none for its models.

## [0.1.6] - 2026-08-14

### Added

- File-to-file obligations: a dimension whose site is the file, asking whether a file of one shape
  ships with its companion. Nine ship, all Ruby: a model, service, job, worker, controller,
  serializer or rake task with its spec, and a model or job with its minitest test. They are counted
  over the corpus and need no parser, so a companion that fails to parse still answers.
- A companion audit beside every obligation, because a ratio of zero has two meanings. Measured on
  alphagov/whitehall: the `app/models` area scores 0 of 160 while 117 of those models have a test one
  directory deeper. Without it the row reads "this repository does not test its models".
- A repository is asked an obligation only for a companion suffix it uses. Producers exist whatever it
  tests with, so counting the RSpec and the minitest row together put a line that can only read zero
  into every Rails map.
- `check` reports an obligation the branch broke. It iterated dimensions that run against a parsed
  program, and an obligation has none, so a stated claim it could not run came back clean.

### Changed

- `scripts/check-docs.mjs` counts obligations, and reads only the unreleased section of this file.
  A released entry states the number that shipped in it and stays true; reading the whole changelog
  made every past release a claim about today, so the first number that ever changed failed three
  entries that were correct.

## [0.1.5] - 2026-08-14

An area's `paths` now matches the files its counts were taken over, and no others. Every area file
is rewritten by the next scan; `facts.json` moves to schema 3, where `glob` becomes `globs`.

### Fixed

- An ancestor area's glob matched its descendants, so a claim a deeper area had been refused was
  delivered to it anyway. `app/workers/workers/**` matched `app/workers/workers/google`, whose own
  area measured the same dimension at 14 of 22 and was suppressed by the ratio gate; the ancestor's
  directive, counted over 125 files that do not include any of google's, arrived on every read there
  and contradicted it. The gates decide where a claim may be stated and the delivery channel was
  walking around them. An area sharing a root with a deeper area now emits either one glob per
  directory it holds files in, or one recursive glob and a negation per foreign subtree, whichever is
  shorter. Measured on a 5,495-file Rails repository, 156 areas: 37 areas over-reached, by 2,425
  files in the worst case; the rewritten map is exact on all 857,220 file-area pairs, costs 298
  patterns in total, and leaves the other 119 areas on the single glob they had before.
- A file that no area holds no longer receives an ancestor's directives either. That covers the two
  ways a file ends up uncovered: every directory above it fell below the floor, and the area ceiling
  hosting an area at a directory whose own files were already orphaned. Checked over every layout of
  0 to 2 files across a six-directory tree, at every floor from 1 to 3 and every ceiling from 1 to 4:
  8,736 layouts, 102,815 file-area pairs, none mismatched.
- The README's line for keeping the map out of git failed inside a linked worktree, where `.git` is a
  file holding a gitdir pointer and `.git/info/exclude` is not a path. It now writes to
  `$(git rev-parse --git-common-dir)/info/exclude`, which is shared by the main checkout and every
  linked worktree.

### Changed

- `scan` prints the root it resolved to. A path argument picks the repository and not a subtree,
  because `git rev-parse --show-toplevel` resolves any path inside a repository to its root, so
  `scan ./packages/api` in a monorepo maps the monorepo. That is what areas, the pin and the baseline
  need; the output just never said so.
- A scan of a repository with no tracked source says how many source files are untracked, in the
  summary and in the overview. The corpus is tracked files by design, and a repository whose first
  commit has not landed used to get an empty map, exit 0 and an overview reporting that 0 files were
  uncovered. The count applies every filter the corpus does, since it is printed beside an
  instruction to commit those files and scan again.
- `npm run check:docs` checks the number of rows in `DECISIONS.md` against the three files that state
  it, and rejects a duplicate row number. All three had drifted apart.
- Rendering an area with no `paths` glob throws instead of writing one. Measured: a `paths` key with
  no pattern under it loads the file on every turn, which is the opposite of what an area file is.

## [0.1.4] - 2026-08-14

### Changed

- The overview names only the areas that state something, at every repository size. It used to name
  every area below 200 and apply that rule only above the limit. Measured on a 5,489-file Rails repo,
  143 of 151 areas stated nothing, so 89% of a file that loads on every turn carried a directory name
  and a file count `ls` already gives. Rebuilt at that shape the listing is 1,030 bytes against 8,576.
  Nothing moves out of reach: a counts-only area keeps its own path-scoped file, which still loads
  when one of its files is read, and the `## Areas (n)` heading still counts every area.

## [0.1.3] - 2026-08-14

`check` now says when it read nothing. Repositories with a dirty working tree at the moment the
command runs, which is most of them, get a `note:` line they did not get before.

### Fixed

- `check` reported a clean result for work that was still only in the working tree, and the caveat
  written to describe exactly that could never fire for it. The dirty set was intersected with the
  committed diff, so a path had to be committed before it could be called uncommitted. Untracked and
  staged-but-uncommitted work now produces the note, which is the state a branch is usually in when
  `check` runs.
- A rename counted twice and under a name three characters short. `status --porcelain -z` writes the
  origin path as a bare field after the record, and reading it as another record both double-counted
  the rename and mangled the path. The intersection had been hiding this.

## [0.1.2] - 2026-08-14

Documentation only. No behaviour changed, and the shipped files are the README, the changelog and
`DECISIONS.md`.

### Fixed

- The gate table in `docs/how-it-works.md` described gates the code stopped reading. There is no
  `candidates >= 6` gate: the Wilson bound subsumed it, and at 0.90 a perfect record needs 35 sites.
  `concentration` is the inverse-Simpson count of files plus the ratio with the largest file dropped,
  not a share of candidates. `applicability` is the stricter of a square root and a quarter of the
  files the dimension can speak about, not the quarter alone. The `authors` bar is `min(2, repository
  authors)`. `evidence` and `history-unread` were missing entirely.
- `DECISIONS.md` rows C4, D2 and D3 stated the thresholds the specification promised rather than the
  ones the gates read, which is the one thing that file's status column exists to prevent.
- The encoder section claimed the claim text goes through the encoder. It stopped, because stripping
  `|` rendered "defaults are taken with ??, not ||" as "defaults are taken with ??, not" in every
  JavaScript area of every repository. The README sample still showed that truncated output.
- The dimension table in `docs/how-it-works.md` listed 21 of the 31 dimensions that ship, missing the
  five React ones and the five Rails migration ones.
- The area floor and ceiling are step functions of the corpus size, not the fixed 5 and 120 the
  README and `docs/why.md` described.
- `CONTRIBUTING.md` gave a dimension template with no `counterClaim`, which `npm run check:docs`
  rejects, and named three of the five registry files.
- Counts of the rows in `DECISIONS.md` (48, now 54), the supported version in `SECURITY.md`, the
  command count in the README, and the `CHANGELOG` compare links for 0.1.1.

### Added

- `CONTEXT.md`, the glossary. It splits three words that each carried more than one meaning in the
  code: `directive` is any stated sentence, and `Pin`, `Population` and `Baseline` are the three
  things previously all called baseline.
- `CLAUDE.md` and `docs/agents/`, which record where issues live, the triage label vocabulary, and
  that `DECISIONS.md` stands in for `docs/adr/`.

## [0.1.1] - 2026-08-14

### Fixed

- Ruby 3.4 is the floor, not 3.3. The parser child rejects `prism` below 1.0 by version, because a
  rescue chain links through `consequent` rather than `subsequent` there and a constant path through
  `child` rather than `name`. Nothing raises; every Ruby count comes back zero. Ruby 3.3 ships
  `prism` 0.19, so the documented requirement was wrong for every user who met it.
- The Ruby child carries `%SystemRoot%` on Windows. A replaced environment without it cannot start
  a side-by-side assembly, so the interpreter never ran and the whole Ruby tier was unreachable.
- The repository root is resolved to a real native path in `gitRoot`. git prints forward slashes on
  Windows and can print a short 8.3 form where the filesystem holds a long one, and every path
  downstream is joined against this value and compared with it.
- The resident-memory guard stands down on Windows, where there is no `ps`, instead of failing to
  read one. A runaway parse is caught by the five-second timeout there. `wmic`, which is what the
  usual replacement shells out to, is removed in Windows 11 25H2.

### Added

- Windows is tested rather than declared out of scope: the suite on Node 22 and 24, and an
  end-to-end `scan`, `pin` and `check` against a real repository, alongside Linux and macOS.
- The overview's byte-stability across two scans of unchanged source is checked end to end, not only
  in a renderer unit test.
- Coverage is measured and enforced at 95% lines, 87% branches, 95% functions.
- A documentation check that compares every claim the prose makes which the code also makes: the
  dimension counts, the gate names, the command surface, and the version across three files.
- CodeQL with the `security-extended` suite, dependency review on pull requests, a runtime `npm
  audit`, a check that installing runs no scripts, and an OpenSSF Scorecard.

## [0.1.0] - 2026-08-13

First release. `DECISIONS.md` is the build contract and records which decisions are complete and
which are partial; several listed there are not implemented yet.

### Added

- `scan`: one pass over the repository that groups tracked source files into per-directory areas,
  counts a fixed set of claims in each area, and writes the result to `.claude/rules/anatomiya-*.md`
  plus a machine copy at `.claude/anatomiya/facts.json`. Files are written to a temp path and
  renamed, so a crash cannot leave half a file.
- `pin`: accepts the current file population as the baseline every gate reads, and prints which
  files enter and leave it. Without one, claims are measured against the working tree and no `check`
  finding can exceed FIX.
- `check`: which counted conventions the current branch broke. Changed files come from a three-dot
  diff against the merge base, findings are matched between HEAD and the merge base by content
  fingerprint so pre-existing violations are not reported as new, and severity is MUST-FIX, FIX or
  NIT. Nothing blocks; a stale map or a missing merge base caps severity at FIX rather than refusing
  to run.
- The counted-claim model. Every claim carries `applicability` (files where the construct appears),
  `candidates` (sites in those files) and `conforming`. The ratio is over candidates, never over
  file count, and applicability is printed beside the area's file count so a wrongly narrow
  predicate is visible. Counting conforming *files* instead of *sites* was measured flipping 10 of
  39 verdicts, in both directions.
- Gates that decide whether a claim is stated as a directive, all but the first relative to the
  repository being scanned: the conforming rate is at or above 0.90; the Wilson 95% lower bound on
  the same counts also reaches 0.90, so a perfect record needs 35 sites before it may be stated; the
  sites are worth at least 3 files by inverse-Simpson count and the rate survives dropping the
  largest file; the predicate applies to at least the greater of a square root and a quarter of the
  area; and the area carries two distinct authors, or one where the repository has only one. A gated
  claim still prints its counts and the name of the gate that stopped it. 0.90 is fixed and does not
  move with the repository: it is the definition of a convention, and a bar that adapted would let a
  repository with weak habits manufacture the evidence it is then judged against.
- Inverse conventions. A repository that consistently does the opposite of a claim has a convention,
  not an absence, and 12 of the 31 dimensions may state theirs. The other 19 may not, each for a
  recorded reason: the inverse is an absence, a defect, flat everywhere, or resting on a predicate
  too weak to trust twice. A stated inverse clears the same 0.90 and the same evidence bound on its
  own side, and `check` enforces whichever sentence the area was handed.
- 31 dimensions: 15 for JavaScript, 20 reachable in JSX, 11 for Ruby. 12 are marked `precise` and 19
  `partial`, and a partial dimension can never reach top severity. They cover error handling, absent
  values, typing, module and import shape, test style, Rails models and services, the React surface,
  and Rails schema and migrations.
- JavaScript and TypeScript parsing through `oxc-parser` in a pool of warm child processes, with a
  4 MB file cap, a 5 s timeout and a 1 GB RSS poll per file. A parser crash costs one file and the
  worker is replaced. The dimensions run inside the worker and only counts cross the channel: they
  are 85% of the scan's CPU, and running them in the parent held throughput to 2.8x on eleven cores
  however many workers ran.
- Ruby parsing through `prism` in a streaming subprocess: paths on stdin, one JSON object per line,
  an idle timeout rather than a whole-run one, and a stripped environment so `RUBYOPT` cannot inject
  a `-r`.
- Corpus collection from `git ls-files -z`: tracked files only, NUL-split, deny list for secrets,
  vendor and fixture directories excluded, lexical plus realpath containment on every path. No cap
  on repository size; a synthetic 100,000-file repository scans in about 9 seconds.
- One encoder for every repository-controlled value that reaches a generated file: printable
  allowlist, NFKC, mixed-script paths rejected, markdown structure stripped, capped on grapheme
  clusters before quoting.
- Author counts from a single `git log -M --no-merges --name-status` pass, read off the stream,
  instead of per-file `git blame`. History git could not read is reported rather than counted as
  zero authors.
- Baseline pinning in `.claude/anatomiya/baseline.json`: per-area file lists at a pinned sha, read
  back with `git cat-file` only for the files that differ from the working tree, sha reachability
  checked before use, and a printed population delta on re-pin.
- Three slash commands, `/anatomiya:scan`, `/anatomiya:check` and `/anatomiya:pin`, all of which read
  generated files with `cat` rather than the Read tool, because reading a context file suppresses its
  automatic injection for the rest of the session.
- The overview file is byte-stable between scans with no source change: no timestamps, no durations,
  no counts that move per commit.
- Plugin and marketplace manifests under `.claude-plugin/`, and `npm run validate` to check they
  parse and that the directory holds nothing else.

### Known limits

- The map loads when the agent reads a file or an `@file` mention names it. It does not load on
  grep, glob, `cat` through bash, or an edit with no prior read.
- JavaScript, TypeScript and Ruby only. `.erb` and other templates never reach a parser.
- Most slots print as counts rather than stating. Across ten measured repositories, 333 of 3,847
  dimension slots stated anything at all, which is the gates working rather than failing.
- No hooks, no MCP server, no skill, no score or grade. `DECISIONS.md` records why.
- No claim that this catches defects. Measured across ten repositories, 1 of 317 defect review
  comments was preventable by a conventions map.

[0.1.12]: https://github.com/crisnahine/anatomiya/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/crisnahine/anatomiya/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/crisnahine/anatomiya/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/crisnahine/anatomiya/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/crisnahine/anatomiya/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/crisnahine/anatomiya/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/crisnahine/anatomiya/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/crisnahine/anatomiya/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/crisnahine/anatomiya/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/crisnahine/anatomiya/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/crisnahine/anatomiya/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/crisnahine/anatomiya/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.1.0
