# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Seven more languages are read: Python, PHP, Go, Java, C#, Rust and Kotlin, through tree-sitter,
which makes three parser engines. The script blocks of Vue and Svelte files are read as well,
`scan --targets cursor,copilot` writes the same map for Cursor and GitHub Copilot, and the type
checker reads a root `tsconfig.base.json` where a repository has no root `tsconfig.json`.

No map written by 0.13.4 comes out the same from this version. Scanned with both on the 35 corpus
repositories, which are JavaScript, TypeScript and Ruby, every overview differs in the "Not covered"
line for files in a language the map does not read: 22 gain the line and 13 print another count. 80 of
6,947 area files gain a clause such as `, in .rb files` on a claim line. The number of claims
stated is the same on 26 of the 35. The other nine also hold components or files of the seven
languages and gain slots or areas for them: react gains nine areas over its Rust crates, and
vscode, at 500 areas in both versions, drops six areas and gains six, four of them over the Rust
of its `cli`, and goes from 1,798 claims stated to 1,784.

### Added

- Python, PHP, Go, Java, C#, Rust and Kotlin. tree-sitter joins oxc and prism, which makes three
  parser engines, and reads `.py`, `.php`, `.go`, `.java`, `.cs`, `.rs`, `.kt` and `.kts` files
  through seven grammars the plugin carries. In 0.13.4 a scan of such a repository wrote a layout
  section and no area: flask got `83 files hold a language this map does not read (83 .py)`. This
  version adds areas, test files and namesake tests counted by the language's own naming, and the
  dimensions of the `Three dimensions` entry in this list. Expect mostly counts, and a claim only
  where a directory is consistent: a scan of fastapi states 1 of 82 claims, hugo 0 of 102, ktor 0
  of 133 and tokio 14 of 33.
- Test files and namesake tests in those seven languages. A test file is found by what the
  language's own tool collects: `_test.go`; `test_*.py`, `*_test.py` and `conftest.py`; under a
  test tree, `*Test`, `*Tests` and `*IT` for Java and Kotlin, `*Tests` and `*Test` for C# and
  `*Test.php` for PHP; a `.rs` file directly under a crate's `tests`. A test tree is `test`,
  `tests` and what the language's build names one: a Gradle source set ending in `Test`, a .NET
  project named `X.Tests` or `X.Test`, a `Test` or `Tests` directory in PHP. The tests line names
  the runner: `389 go test specs`, `505 of 522 pytest specs under tests`, `38 of 40 xunit specs
  under test/Serilog.Tests`. A directory named exactly `tests` prints as `tests/` on its own
  line, since the tests line is labelled `tests`. A namesake test is matched inside the language, across the layout its build
  uses: `55 of 152 .kt files under okhttp/src/commonJvmAndroid/kotlin/okhttp3 have a namesake
  test`, `28 of 113 .cs files under src/Serilog have a namesake test`. A Rust file that holds its
  own `#[test]` functions is asked for no namesake and is counted apart: `0 of 56 .rs files under
  crates have a namesake test; 34 hold their own tests`. A Python package is asked for a test of
  its directory's name, `flask/json/__init__.py` for `tests/test_json.py`. A C# test project is
  paired by name only (`Serilog.Tests` with `Serilog`), so a project tested from one named for
  another is not credited, and a test paired with one source file is credited to no other file
  of that name.
- Three dimensions over the languages a tree-sitter grammar reads, measured on three repositories
  per language and asked only of the languages whose repositories differ:
  `public functions carry a doc comment` in Python, PHP, Go, Java, C#, Rust and Kotlin and
  `functions declare what they return` in Python and PHP, each of which may state its inverse
  where an area writes the other way; `exception handlers use the error they caught` in PHP and
  Java. A function row passes over every file the layout counts as a test. The doc comment row
  counts no constructor and no entry point (`main`), and in Go no method golint asks no comment
  of: `Error`, `Read`, `ServeHTTP`, `String`, `Write`, `Unwrap`, and `Len`, `Less` and `Swap` on
  a type that has all three. The handler row reads a Java clause that names what it caught
  `ignored` as binding nothing, as `_` binds nothing. A finding of these rows names the class
  beside the method, `Views.run`. Not shipped: the handler row in Python, where all
  three repositories read 1.0000, a language default; the handler row in Kotlin and C#, whose
  repositories did not differ by 0.15; how functions are named, which read over 0.94 in all
  fifteen repositories; and whether an import names what it takes, a default in Python and Java,
  short of the spread in Rust, and in Kotlin a rule ktlint already enforces by default.
- What is not read in those seven. A grammar reads less than its language, and a file one cannot
  read is left out of every count and counted on a line of its own: `82 files could not be read by
  this tool's grammar. That is a syntax error or syntax the grammar does not cover; the files may
  be fine.` Measured on three repositories per language, that is under 1% of the lines of every
  Python, PHP, Go, Java and Rust repository, 4.35% of serilog's C#, and 1.32% to 7.88% of the
  Kotlin ones, which use syntax newer than the grammar. A C# file with `#if` inside an expression
  is read with the first branch of each conditional kept, and the scan says how many: `7 files
  were read with one branch of each #if; the other branches were not read`. None of the seven gets
  the type checker, the "most imported from here" lines or the end-of-turn reuse check, and a
  `.pyi` stub is not read. The notice before a test file is written, and the finding `check`
  reports for a test placed where its siblings have none, read a test by its language's own name
  in six of the seven, and hold it to a directory of its own project where the build has
  projects. A Rust test has no name, so no `.rs` file is asked. Asked of the 5,727 test files of
  those languages that 60 repositories already hold, as if each had just been added, it reports
  none. A file of the seven that its grammar cannot finish in 5 seconds is counted as crashed and
  is not tried again; the case measured is Kotlin.
- Three runtime dependencies, where 0.13.4 had two. The new one is `web-tree-sitter`: JavaScript
  and one WebAssembly module, with no dependency and no install script. The seven grammars ship
  inside the plugin as `.wasm` files, 12 MB in all, each a copy of the file in its grammar's npm
  package, and `plugins/anatomiya/grammars/grammars.json` records the package, the version and the
  SHA-256 of each. Nothing is downloaded for them. An install whose `node_modules` is older than
  this version does not hold the package: `/anatomiya:doctor` prints `tree-sitter absent:
  web-tree-sitter did not load` with the command, and `/anatomiya:setup` installs it. Until then a
  scan maps every other language, says no file of these seven was read, and refuses a repository
  that holds nothing else.
- `doctor` prints a line for tree-sitter with the grammars that load, `tree-sitter 0.27.0 ok
  (grammars: 7 of 7)`, and names a grammar file that does not: `grammars: 6 of 7, kotlin.wasm did
  not load`. The fix for that is to reinstall the plugin, since no package install writes a
  grammar file. A scan says no file of that one language was read and reads the rest. `setup`
  prints the same line for it, installs nothing for it and exits non-zero.
- `check` says so when a C# file was read with one branch of each `#if`: the caveat
  `head-one-branch` names the file, once, and its findings are about the branch that was read.
- Vue and Svelte. The `<script>` blocks of a `.vue` or `.svelte` file are read by the parser that
  reads JavaScript and counted by the JavaScript dimensions that hold for a component: 24 for Vue
  and 24 for Svelte, of 28. A file may hold two blocks (`<script>` and `<script setup>`, or
  Svelte's module and instance scripts), and they are read as one program. `lang="ts"` picks
  TypeScript, and the lines `check` reports are the file's own. The scanner that finds the blocks
  agreed with each framework's compiler on 4,100 of 4,100 Vue files and 8,047 of 8,048 Svelte
  files. The one it misses is a top-level script with a space before it, which reads as a
  component with no script.
- Three dimensions are not asked of a component, because the answer is in its template:
  `module-level bindings are const`, `optional values are read with ?.` and `imports used only as
  types are marked import type`. `failure is returned, not thrown` is not asked of Vue, and `a
  module that exports a hook exports one` is not asked of Svelte. A Svelte prop (`export let`) is
  not read as an exported name or function, and a PascalCase function in a Vue script is not read
  as a function name.
- A component's template and style block are not read, and the overview's "Not covered" section
  says so for a repository that holds one: `of 17 .vue and .svelte files only the script block is
  read; the template is not`.
- A component is never counted as a test file, since no runner collects one: a `.vue` file under
  `__tests__` is a fixture of the tests there, and is not asked for a namesake test either.
- Component files learn their own filename class, apart from the modules beside them:
  `component files here are named PascalCase`.
- `$lib/` in a SvelteKit project resolves to the importer's own `src/lib` for "most imported from
  here": 4,210 of 4,213 such imports on one measured repository, where 0.13.4 resolved none. No
  `svelte.config.js` is read, so a project that repoints the alias resolves nothing through it.
  `@/`, `~/`, `#/` and `src/` written in a component resolve the same way, inside the component's
  own project and its `src`, and credit nothing where no directory above the component holds the
  file: a Vue package's `@/components/ui/button` is not counted as an importer of another
  package's `button.tsx`.
- The end-of-turn reuse check asks about a component: the lines its script added and no others. An
  edit to a template or a style block asks nothing.
- `scan --targets cursor,copilot` writes the same map for Cursor and GitHub Copilot as well:
  `.cursor/rules/anatomiya-*.mdc` and `.github/instructions/anatomiya-*.instructions.md`, an
  overview and one file per area in each, with the frontmatter that tool reads. It is off unless
  asked for. A target stays on for every later scan, and for the background refresh, while its
  `anatomiya-overview` file is in its directory, and nothing else stores the choice. `--targets`
  names the whole set: `--targets cursor` drops Copilot, and `--targets claude` turns both off and
  removes the files this tool wrote there. The scan prints one group of lines per directory
  (`wrote 4 files under .cursor/rules for Cursor`), `doctor` prints a line for a target that is on,
  `check` audits its directory, and `pin` leaves its generated files out of the clean-tree test. In
  a clone that brings a committed overview, the first plain scan says on that line which file
  switched the target on and that `scan --targets claude` switches it off, and `--format json`
  carries the file as `switchedOnBy`.
- In those two directories a scan never writes over a file it did not write, and writes through no
  link: `.cursor`, `.cursor/rules`, `.github` and `.github/instructions` each have to be a real
  directory of the repository, or not exist yet. A scan that names a target it cannot write as asked
  refuses, says which file or link is in the way, and writes nothing anywhere. A target that is
  merely on leaves such an entry where it is and says how many it left. A name that differs from one
  of the map's only in letter case counts as taken, unless the directory lists both spellings. A map
  file that is locked or read-only stops the scan with a sentence that names it, and every file
  already replaced is put back.
- Cursor and Copilot read looser patterns than Claude Code, and the files say so. A brace set is
  written as one pattern per extension and a negation is left out, since neither reader that was
  run takes one and the other Copilot surfaces document none, so an area file can attach for files
  the area excluded and names them in a closing line. A Copilot file adds that VS Code matches its
  patterns under any parent directory. An area none of whose patterns can be written for a tool has
  no file there, and the scan says how many.
- What those two copies are not. Delivery is not measured in either tool: for Cursor it was read
  from the code of the 3.20.21 app and not seen in a running one, and for Copilot the files were run
  through VS Code 1.140.0's parser and nothing else. So their overviews say what each area's file
  is and not when it arrives. Both overviews load on every turn in tools none of this plugin's
  hooks runs in, and a directory's name reaches them as its words: SECURITY.md says what to read
  before committing one. The hooks are Claude Code's, so neither tool
  gets the echo, the notice before a write, the reuse check or a refresh of its own. VS Code already
  reads `.claude/rules/`, so with the Copilot target on it is offered each area twice. Codex is not
  written for.
- The record names the files written for each target under an optional `targets` key, present only
  where a target is on. The schema stays 19, so a build that does not know the key reads the record
  as 0.13.4 does.
- Two more exclude lines in the README, `.cursor/rules/anatomiya-*.mdc` and
  `.github/instructions/anatomiya-*.instructions.md`, which match nothing until a target is on.

### Changed

- The "Not covered" line for files in a language this map does not read knows 24 more extensions,
  among them `.erb`, `.haml`, `.css`, `.scss`, `.html`, `.sh` and `.sql`, so a repository holding
  them gains the line or a longer one. `.py`, `.php`, `.go`, `.java`, `.cs`, `.rs`, `.kt` and
  `.kts` leave the line, since those files are read. mastodon gains `469 files hold a language this
  map does not read (310 .haml, 91 .scss, 47 .erb, 10 .css, 8 .sql, 3 .html)`. Where the overview
  already sat at its 40 lines, one root folds into the roster's last line to pay for it.
- A claim says which files it was counted over where its area holds three or more files the
  dimension is never asked of: `module-level bindings are const, in .ts files` beside `.vue`
  files, and `rescue blocks use the error they caught, in .rb files` beside `.js` ones. This
  changes existing maps. On the 35 corpus repositories, 85 of 6,947 area files carry the clause,
  on 573 lines in all, most of them where Ruby sits beside JavaScript: 277 in discourse and 96 in
  decidim. One or two files of another language earn no clause, so a count there leaves them out
  without saying so. The clause joins a line and adds none, and 21 of the 35 carry no clause.
- A directory whose components sit beside modules counts their namesake tests apart: `85 of 745
  .ts files have a namesake test; 81 of 164 .vue files have a namesake test`, on the root line,
  the tests line and an area's kinds line, whichever of the two the directory holds more of. The
  smaller of the two is counted on the line where the directory holds three or more of it or a
  test credits one of its files, so ten components beside one `index.ts` print one count. The
  count over the first extension does not move. A test answers one component of its stem where
  the repository holds several: the one under the test's own directory, or the one it imports. A
  docs example named like a packaged component is not credited with that package's test.
- A file whose engine or grammar was not there is counted once in the scan summary, on the line
  that says why: `246 files: prism reported no version: install Ruby 3.4 or newer, ...`. 0.13.4
  printed `246 files crashed the parser` for the same files and gave the reason on a line with no
  count, which read as a second fault. `scan --format json` changes with it: where an engine was
  missing the answer gains an `unanswered` key that counts those files by language,
  `{"ruby": 8}`, and `unexamined` holds no `8 files crashed the parser` for them.
- The type checker reads a root `tsconfig.base.json` where a repository has no root
  `tsconfig.json`, which is how a workspace with one config per package keeps its path aliases.
  Read on the compiler's defaults, every import through an alias resolved to nothing: of eight such
  repositories measured, three read `degraded` in 0.13.4 and read `ok` in this version (79.9% to
  84.9%, 68.9% to 91.7% and 76.7% to 85.5% of type lookups resolved). A base that resolves under
  the floor reads `low-resolution`, as any config that was read does. A root with neither file
  runs on the defaults, as in 0.13.4: one of five measured resolves that way, so nothing is
  skipped for the missing file. Plain JavaScript beside a `tsconfig.base.json` is checked, as it
  is beside a `tsconfig.json`.
- A background refresh does not run the type checker where the last scan measured it as
  `degraded` and nothing it reads has moved since: this version, the repository's packages, where
  `typescript` resolves, and the name and bytes of the root config. The refresh carries the
  measured verdict instead. A refresh after a commit measured 4.3s with the checker and 1.2s
  without on eslint, 8.8s and 2.8s on react, 13.6s and 2.3s on prisma, and 21.1s and 3.8s on Ghost,
  with peak memory of 808 MB to 2.7 GB against 160 to 242 MB. On those four the verdict was the
  same 50 commits earlier, within 0.3 points. A map written that way says
  `type-checked claims are not counted: 61% of type lookups resolved when measured 2026-10-07
  (low-resolution)` in the overview, and those three words and the day are all that differ from
  the map the measuring scan wrote: on eslint and Ghost the other 29 and 283 rule files are the
  same bytes. `/anatomiya:scan` always
  runs the checker, and a checker that reads `ok` runs on every refresh, as in 0.13.4. A
  repository whose code changes lift it over the floor stays `degraded` until someone runs the
  scan. The record's `semantic` gains `carried`, `measuredAt` and `measuredUnder`, and the schema
  stays 19.
- A type checker that reads `degraded` prints no count for its claims, whether this scan measured
  it or a refresh carried the verdict. 0.13.4 printed `a call chain stays inside one type: no
  convention. 298 of 586 sites (degraded-semantic)` in each area; those lines are gone, the
  record holds no slot for them, and the overview says `type-checked claims are not counted: 61%
  of type lookups resolved (low-resolution)` where it said `are counts only`. The counts came
  from a checker that resolved too few types to be believed. eslint's map prints 24 lines fewer
  over 24 area files. Ghost's loses 257 such lines over 257 area files and prints 241 fewer in
  all, since an area at its line budget shows another row in the room; 277 of its area files
  change. A checker that reads `ok` is not touched.
- A repository that commits its map sees "What lives where" change once, on its first scan with
  this version: the map's own files are left out of it, which is the Fixed entry that opens `The
  layout counted the map`.

### Fixed

- The layout counted the map as part of the repository it describes. Where `.claude/rules/anatomiya-*.md`
  or a file of `.claude/anatomiya/` is committed, "What lives where" counted those files, so the
  overview written before the commit and the one written after it differed with no source change.
  On a copy of Homebrew/brew with the 58 files of its map committed, the second scan added
  `- .claude/rules: 58 .md` and dropped an area from the Areas list to make room. The map's own
  files are left out by name: the overview and area files in `.claude/rules`, `.cursor/rules` and
  `.github/instructions`, and every file under `.claude/anatomiya/` that is not source. A map
  committed through a linked `.claude/rules` is left out where git tracks it, and one under a
  directory spelled in another case, `.Cursor/Rules` for instance, where git reports that the
  volume folds case. A hand-written file under one of those exact names is left out with it.
- The overview's sentence about a directory with no test precedent prints only where such a
  directory has a line in the same section. A root the line budget folded away could put it there
  alone, so it read as being about the directories that were printed. Against 0.13.4 it is gone
  from four of the 35 measured repositories. On prisma and next.js that release printed it with
  the directory that armed it folded. On backstage and vscode that directory
  (`docs-ui/src/app/components`, `src/vscode-dts`) had a line in that release and is folded in
  this version, so the sentence goes with it. A repository that prints an untested directory
  keeps it, and fastlane gains it for `screengrab`, whose Java this version reads: `1 of 19 has a
  namesake test`.
- A name that opens with a number and a dot prints whole. `check --base 13.x` printed `base x`.
  In a map, a path whose first directory opens that way lost its head: on a repository that
  keeps code under `3.2/app`, "What lives where" printed `2/app: 5 .js`, and the directory got no
  area file, counted instead under `a name no glob can spell`. This version prints `3.2/app` and
  writes its area. The encoder took the number for the marker of a numbered list, which it is
  only before a space or at the end of the value. A path that opens with anything else was never
  cut: `src/pages/404.vue` printed whole.
- `check` put a Ruby finding on the wrong line where a branch wrote a class above another whose
  method has the same name and breaks the same claim: two classes each with a `run` that swallows
  its `rescue`, and the report named the older class's line, which the branch never touched. A
  Ruby finding inside a method of a class is matched to that class and prints it beside the
  method, `Importer#run`, where 0.13.4 printed `run`. JavaScript has the same misplacement for
  two classes in one file with a method of the same name, and this version does not fix it.
- `check` judged a file renamed from a name that is no source against its old text. `notes.txt`
  renamed to `notes.js` with nothing edited was parsed as JavaScript at the merge base, every site
  in it was taken for one the base already held, and nothing was reported. Where the text was not
  JavaScript, a `.txt` renamed to `.rb`, the file was skipped with a false `did not parse at the
  merge base`. A file that was no source at the base is new to the map, and this version checks
  it as an added file: every site in it is the branch's.

## [0.13.4] - 2026-10-07

Hooks, scans and checks take less time and give the same answers, byte for byte, with two
exceptions listed below: the map a scan leaves when a `ruby` child dies mid-run can differ, and the
type checker refuses a path that leaves the repository through a link. The numbers below are medians
measured against 0.13.3 on one machine, under the same load for both.

### Added

- `.claude/anatomiya/layout.json`, written beside `facts.json` by every scan, holds the record's
  layout on its own, stamped with the size and mtime of the record it was taken from. The notice,
  the end-of-turn check and the refresh read it instead of parsing the whole record, and read the
  record wherever the stamp does not match. The README's `.worktreeinclude` list names it too,
  which saves time only where the copy keeps the record's mtime.

### Changed

- A hook loads only the modules its verb uses: 12 for the echo, 24 at most for the notice, 20 for
  the end-of-turn check and 27 for the refresh, where every hook loaded 65. The echo went from 65ms
  to 39ms, the notice from 68ms to 43ms, the end-of-turn check from 108ms to 90ms and the refresh
  from 69ms to 45ms, against 26ms for bare node. On microsoft/vscode, whose record is 10 MB, the
  notice went from 90ms to 41ms with the layout file.
- `scan` walks each JavaScript and TypeScript tree once for every dimension instead of once per
  dimension: 9.2 walks a file where it was 50.8 on a large front end, counting every walk of a
  file's tree or a subtree in it. The baseline's git reads now run beside the parse. This
  repository's scan went from 697ms to 490ms.
- `scan` reads Ruby in worker threads, one per `ruby` child, that parse and walk the trees and send
  back counts, so the parent no longer reads or walks a Ruby tree; `check` still gets the trees of
  the files a diff touched. The Ruby dimensions and facets share one walk of each tree: 5.5 walks a
  file where it was 22.5. A large Ruby corpus is still read by up to four children, never more than
  the machine's cores less one. On a large Rails API the parse phase went from 3,378ms to 1,820ms.
  Its scan, timed on the command line, went from 3,900ms to 2,260ms, and its peak memory rose 16%,
  from 178 MB to 207 MB, for the threads' heaps; discourse's scan went from 13.8s to 7.6s. When a
  `ruby` child dies mid-run, which files it charges follows the byte balance of the batches, so the
  degraded map can differ from 0.13.3's.
- `check` resolves HEAD once, runs its independent git reads side by side and asks git once per
  commit sha: 25 git calls to 20 on a two-file branch here, and that check went from 422ms to
  285ms.
- The type checker's compiler host answers each path once per build: 24,781 stats where it was
  107,928 on a large front end, and the checker there went from 12.2s to 11.8s.

### Fixed

- The type checker decides whether a path stays inside the repository on the path the system will
  open. A `..` after a link (`src/up/../x` with `up -> ..`) was checked as text and could read a
  file outside the repository; it is now taken from where the link leads and refused.
- Off Windows a backslash is an ordinary filename character, but the type checker's containment
  check split on it, so a link named `src/x\..\y` was checked as `src/y` and could read a file outside the
  repository. It now splits on `/` alone there, and on Windows it checks the path as text, the way
  Windows opens it.

## [0.13.3] - 2026-10-06

The docs catch up with Claude Code 2.1.288, which loads an area file after a Write or Edit as well as
on a read, and the A/B harness test passes on 2.1.290. The map itself is unchanged.

### Changed

- The README, `docs/how-it-works.md`, A44 and H1 say that from Claude Code 2.1.288 an area file loads
  after a Write or Edit lands in its area, as well as on a read, and so do the code comments that
  had said only a read loads it. The write notice keeps its job: it names the one finding for that path, and it
  still speaks for a path no area glob reaches and for a worktree with no map of its own. The
  evidence is in `docs/research/what-changed-between-2-1-286-and-2-1-290.md`.

### Fixed in the tests themselves

- `test/ab.test.mjs` rules on the name Claude Code 2.1.290 adds to its string table with the next
  entry's length byte on the end (`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENTN`). The name
  the build reads was already scrubbed.
- The pool test that compares a parse over the memory ceiling with the same parse under the default
  ceiling lifts the five-second clock on both, so the clock cannot fail either parse. Under coverage
  on a loaded runner the second parse ran past it, 5.3s on CI, and the test took that as the ceiling
  failing it.

## [0.13.2] - 2026-10-05

Scans of large repositories take about 40% less time and write the same map, byte for byte: across
35 measured repositories the whole set went from 429s to 262s.

### Changed

- `scan` is faster on large repositories, with the same map: the history read runs beside the parse,
  and so does the type checker wherever a core is spare, Ruby is read by up to four children instead
  of one, the checker's compiler host stops re-walking `realpath` for a path it already answered,
  the memory guard's `ps` no longer holds the parent between files, and the Ruby walk tracks the
  enclosing method and class as it descends instead of searching for them at every node.
- `--help`, the README and the scan command say the checker costs about 6x a plain scan on the
  2,600-file repository they measure, down from 8x. A scan that fails while the checker runs beside
  it now stops the checker instead of waiting for it.

### Fixed

- The growth tests size each timed side from warmed calls. The first call runs unoptimised and
  measured twice as slow, so each side ran about 120ms instead of 250ms, and Windows counts CPU
  time in 15.6ms steps: a linear ratio read 3.32 on a Windows runner against its bound of 3.

## [0.13.1] - 2026-10-01

Plain JavaScript stops paying for a type checker that cannot answer there, and the corpus runs can
finally see the checker at all.

### Changed

- `scan` leaves the type checker off in plain JavaScript: no `tsconfig.json` at the root and no
  `.ts`, `.tsx`, `.mts` or `.cts` file other than a declaration file. There it ran on the compiler's
  defaults and resolved 25% to 39% on three installed repositories, so every type-checked claim
  closed after paying the checker's time on every scan and refresh. The facts record says
  `plain-javascript`, and adding a `tsconfig.json` later is a reason for the background refresh to
  rescan. A `jsconfig.json` does not turn it back on: the checker reads only `tsconfig.json`.
- Dependabot no longer bumps `ignore`. It is the oracle the tests hold an area's `paths` against,
  standing in for how Claude Code reads them, and Claude Code 2.1.286 still bundles 7.0.5. From
  7.0.7 on it handles brackets, backslashes and blank lines differently, so a bump would test
  against a reader Claude Code does not run.

### Added

- The corpus runs see the type checker. `scripts/e2e-corpus.mjs` copies every `node_modules` a
  corpus repository has installed into its clone, and both it and `scripts/measure-layout.mjs` print
  what the checker answered per repository. `measure-layout.mjs` also prints a per-area
  `law_of_demeter` table, so a facts diff between two builds shows a type-checked slot that moved.
  The from-zero run fails a repository whose install was copied in and whose checker still reads
  `no-dependencies`.

### Fixed in the tests themselves

- `test/ab.test.mjs` rules on the two names Claude Code 2.1.286 adds to its string table with the
  next entry's length byte on the end (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORTE`,
  `CLAUDE_CODE_SKIP_MODEL_ACCESS_MEMORYE`). The names the build reads were already ruled on.
- The growth tests collect garbage before each timed side. `process.cpuUsage` counts the
  collector's threads, so a linear judge read 3.0 to 3.16 on CI runners, past its bound of 3, and
  failed three times on macOS and Windows. It now reads 2.0 to 2.4, and a quadratic one still reads
  3.7 to 3.9.

## [0.13.0] - 2026-10-01

The type checker no longer waits for a flag. `scan` runs it wherever the repository's own
dependencies are installed, records why it stayed off where they are not, and the background refresh
follows suit. A pinned repository now gets type-checked claims too, measured against the pinned files
that have not changed since the pin.

### Changed

- `scan` runs the TypeScript checker on its own when it can resolve types: the optional `typescript`
  5.x is installed and the repository's own `node_modules` is on disk inside it. `--deep` is no
  longer an option and is refused with a sentence saying so. A repository without its dependencies
  installed leaves the checker off, and the facts record says why. The background refresh decides
  the same way, and installing or removing the dependencies after a scan is now a reason for it to
  rescan.
- A pinned repository no longer closes every type-checked claim. An area whose checked files are
  unchanged since the pin is measured against them; an area holding one that changed is still
  closed, so an edit cannot take a violation out of the baseline. On a pinned 2,588-file repository
  all 119 `law_of_demeter` slots had read `semantic-unbaselined`; with no file changed since the
  pin, 115 now read `ratio` and 4 `evidence`.
- A scan that runs the checker costs more: 17.4s against 2.2s on that repository, and the checker
  process was measured at 880 MB resident. The background refresh pays it too.

## [0.12.0] - 2026-09-30

`check` gets quieter where it was wrong and more exact where it was vague. It stops reporting a
function's untouched declaration after an edit inside its body, a subclass of a base the branch
itself adds, and `Sidekiq::Job` in a directory that writes `Sidekiq::Worker`, and every finding it
caps at FIX names the cause. Several Ruby and JavaScript rows stop counting sites their sentence
does not describe, so fewer directories state a habit they do not have. A scan that fails while
writing keeps the previous map, an area's rules no longer reach fixtures and generated files the
scan left out, and the background refresh and reuse check now work in a session started one
directory above your checkouts.

### Fixed

- A deeply nested file is read in time linear in its depth. The rows asked every enclosing node at
  every node, so a generated chain of 30,000 operands took 7 seconds to read and a chain past about
  15,000 hit the timeout twice and was charged as crashed. It now takes about half a second, and the
  records for 23,139 corpus files are unchanged.
- `check` no longer reports a function's or class's untouched declaration as newly introduced when
  the branch only edited inside its body. One added line in an existing function raised
  `function_style` FIX and `doc_comment_style` / `explicit_return_type` findings on the declaration
  line. The site identity now leaves function and class bodies out, and a signature edit is still a
  new site.
- `check` no longer reports `class_base` on subclasses of a base class the branch itself adds, when
  that base inherits the learned class in the same area. The map already counted them as conforming.
  A class the branch moves off the learned base now stops carrying its subclasses in the check.
- `check` judges a learned base or mixin the way the map does. A superclass or mixin written bare
  inside a namespace resolves as in the map, so `module Api::V1` with `class Qbo < BaseController`
  is no longer a finding under a learned `Api::V1::BaseController`.
- `module_include` treated `Sidekiq::Worker` and `Sidekiq::Job` as two modules, so `check` gave a
  MUST-FIX to a worker including `Sidekiq::Job` in a directory that writes `Sidekiq::Worker`. The
  two spellings now vote and conform as one, and the map names the one the directory writes more.
- A finding `check` caps at FIX names the cap that applied. A run with no pin used to say "stale map
  or no merge base" on every finding. It now says "no baseline pinned", or whichever cause applied.
- A claim whose block the area file dropped, but whose sentence the notice still prints, now reads
  "the area file names this claim without its counts" instead of "had no room to state this claim".
- The `check` header counts files the branch deleted, as in `1 changed file (1 removed)`, and the
  JSON record lists them as `removed`. A branch that only dropped a spec used to print "0 changed
  files" above a finding about that spec.
- `check --base <name>` on a branch whose name looks like a commit id, such as `7812` or `facade`,
  is refused as the branch's own tip like any other name. It used to compare the branch with itself
  and print 0 changed files at exit 0. The tip's own sha is still a base.
- `check --base <name>` where a tag and a branch share the name is refused, and the refusal names
  both refs. It used to take the tag without a word, or blame the branch's own tip for it.
- `check` reports a `facts.json` that does not parse, such as one with merge-conflict markers, as
  `map-unreadable` ("the map on disk does not parse as JSON"). It used to report it as no map on
  disk.
- An all-caps component file such as `SBA.jsx` is no longer a MUST-FIX against "files here are named
  PascalCase". In a file that holds JSX a capitals-only name is an acronym component. Outside JSX it
  is still counted, as `DEBUG.ts` is.
- The file-to-file obligations count a companion only where the tests line would count it as a test.
  A RuboCop cop named `*_test.rb` outside every test tree no longer opens a "ships with a test" row
  in an RSpec-only repository, and a spec commented out top to bottom no longer credits its
  producer, in the map or in `check`. "N with a namesake elsewhere in the tree" now needs a spec
  with the producer's own path, not only its file name: on one Rails repository it went from 142
  over 44 lines to 0.
- The concentration gate no longer depends on which of several equally large files sorts first.
  Among files tied for the most sites, the leave-one-out drops the one worst for the side being
  judged, so renaming a file can no longer turn "no convention (concentration)" into a stated claim
  with every count unchanged.
- `service_result_shape` said service entry points "return their failure instead of raising" over
  entry points that fail through an unrescued `update!`, `save!` or `run!`, and over entry points
  with no failure path at all. Those bang calls now count as raising unless a rescue guards them,
  and the sentence now reads "service entry points do not raise, directly or through a bang call
  like update!".
- `migration_reversible` no longer counts a migration whose `change` holds a command Rails cannot
  invert (`change_column`, readable DDL through `execute` or `exec_query`, `remove_column` with no
  type, `drop_table` with no block, the from:/to:-less and name-only forms, their `change_table` and
  `send` spellings), so a correct up/down migration is no longer told to declare `change`. A row
  rewrite through a scoped ActiveStorage, ActionText or ActiveRecord model, through a model handed
  to one of the migration's own methods, a local, a multiple assignment, an iterated array or a
  batch block, or through `exec_update`, `exec_delete`, `exec_insert`, `connection.exec_query` or a
  bare `update`/`delete`/`insert` SQL string now counts as data work on `migration_schema_only` and
  leaves `migration_reversible`. A framework constant named only for its table or columns, and a
  constant passed as an option value, stay schema-only.
- `logger_over_puts` counted logger setters such as `level=` and `formatter=` as output, so a
  directory that only configured its logger read as logging through it. Only output calls count now.
- `http_through_client` counted `HTTParty::Error.new` and `HTTParty::CookieHash.new` as direct HTTP
  calls, and counted a Ruby call as going through the repository's client when any word of the
  receiver's name was a client word. A library's error, exception and cookie classes are no longer
  sites, and the receiver's name has to end in the client vocabulary, so `OauthClientStore.fetch`,
  `RequestStore.delete` and `request_params.delete` no longer state that HTTP goes through a client
  in a repository that makes no HTTP calls.
- A top-level interface in a declaration file with no import or export is global and merges like one
  in `declare global`, so `interface_prefix` no longer asks for `interface Window` there to be
  renamed `IWindow`.
- `function_naming_case` and `exported_symbol_case` no longer judge a binding typed `React.FC`,
  `FC`, `FunctionComponent` or `ComponentType`, or a function the same file calls with `new` or
  gives a `.prototype`. They are components and constructors, and the rename these rows asked for
  broke them.
- Prefix claims read "named with an I prefix" and "an E prefix" instead of "a I" and "a E".
- `error_shape` no longer counts a returned object with an `error` key as a returned failure when it
  also carries keys a result is not made of, such as a view-model hook's `{ label, error, disabled
  }`, or when `getDerivedStateFromError` returns it. An area of such hooks no longer states "failure
  is returned, not thrown" and flags ordinary throws.
- A counts line for a partial dimension now carries the same `(partial: some sites are not visible
  statically)` warning the stated block carries. The overview's claim line now says what `no
  convention` and the gate in parentheses mean, without taking a line from the roster.
- A counts line shown on its counter side printed the claim side's author count, so one author's 40
  sites read `(authors 0 of 2)`. It now prints the side it shows, `facts.json` stores
  `counterAuthors` (schema 19), and the shallow-clone note counts the author-gated claims the map
  actually prints.
- The overview's roster clauses now print over what they counted. The helper facet reads `0 of 1 JSX
  file inline a helper`. Sibling modules are named only by stems that repeat. A namesake root named
  by a majority says how many sit there (`4 of 8 have a namesake test, 3 under
  src/utils/__tests__`). The fold line says `too small for a line of their own` instead of reusing
  "floor". A relative or alias import ending in `/` now resolves to the directory's index in the
  reuse counts.
- The test precedent line in the PreToolUse notice and in `/anatomiya:check` names the extension its
  count covers (`src/hooks: 0 of 5 .tsx files have a namesake test`), and the overview's tests line
  nouns its count with that same extension.
- An area's `paths` list no longer reaches the fixture, `test_cases` and generated files the scan
  left out of its counts, so their conventions stop loading on files they were never measured on.
  angular's compliance area counted 8 files and delivered to 2,017. The first scan after upgrading
  rewrites the area files this changes.
- A directory with a comma in its name no longer roots an area. Claude Code splits each `paths`
  entry on commas before it matches, so `x,y/**/*.rb` reached none of the area's own files and every
  file under any `x` or `y`. The directory now folds into a parent whose name a pattern can spell,
  or is reported as uncovered.
- A scan that fails while writing the map (a read-only `.claude/rules`, a full disk, a file held
  open on Windows) leaves the previous `facts.json` and rule files as they were, instead of new
  facts beside the old map, which `check` then called fresh. The background refresh keeps the
  previous map the same way.
- `scan` reads a file once when two tracked paths differ only in case or Unicode form and the
  filesystem (macOS, Windows) checks them out as one file. It keeps the name on disk and reports the
  other as a file that could not be read, instead of counting that file's sites twice.
- `scan --format json` prints the whole repository root and rule file names, the same root its text
  line and `check --format json` print, instead of cutting a root past 120 characters or replacing a
  mixed-script one with a placeholder. `pin --format json` no longer caps its file paths either, so
  two long paths in one directory stay two.
- A tracked file over the size cap no longer hides a missing parser engine. With `oxc-parser` absent
  and one 1 MiB bundle in the repository, the scan exited 0 and removed every JavaScript area file.
  It now refuses with the engine's remedy and keeps the map, as it already did without the bundle.
- A Ruby file whose name starts with `-`, such as `-weird.rb`, is now parsed. It was reported as
  over the size cap.
- A generated JavaScript or TypeScript file with a long expression chain (3,000 or more operands),
  or a flat body of about 116,000 statements, is parsed. It was reported as a file that could not be
  parsed, because the fast raw parser transfer ran out of stack. The same file is now parsed again
  without it.
- A scan whose parser workers never start, or whose Ruby child goes silent before it says ready,
  names that stall instead of telling you to run setup or install Ruby for an engine `doctor`
  reports as installed. The line reads, for example, `oxc was stopped by its own clock before it
  answered: no ready answer in 20000ms`.
- A file the 5 second parse clock killed is retried once, alone, after every other file has parsed,
  as documented. It used to be retried alongside other parses, so under heavy load near-1 MB files
  failed again and an area could drop out of the map between scans of unchanged source.
- `scan --deep` takes its resolution rate over files in an area, so one untyped minified bundle in
  no area no longer marks a repository whose own code resolves as `low-resolution`.
- `scan --deep` with a `typescript` of another major on the resolution path names its version and
  says `--deep needs typescript 5.x`, as `doctor` does, instead of saying it is not installed.
- `pin` refuses a population that makes no area, naming the files that sit in none. It pinned
  `areas: []`, which held back every area made after it.
- `pin` refuses in a sparse checkout that leaves tracked files out of the tree. It pinned the
  in-cone half of HEAD under HEAD's sha.
- `pin` mid-merge says to finish or abort the merge. It said to commit or stash, and git refuses a
  stash with a conflict in the index.
- `pin` names the repository root it pinned (`wrote ..., root <path>`, and `root` in `--format
  json`), as `scan` does.
- `scan --dry-run` and `pin --dry-run` refuse a store directory this process cannot write, by name.
  They said "would write", and the real run died on a raw `EACCES` naming a temp file.
- The automatic pin follows a teammate's commit that a `git worktree add` was started on. The empty
  reflog entry git writes for the new worktree's HEAD read as a commit made here, and held the pin
  for as long as the worktree stood.
- A hold found only because a commit carries this clone's committer identity now says that, not that
  the commit "was made in this clone". The hold record says which match fired (`by`: `reflog` or
  `identity`).
- A map committed through a `.claude/rules -> ../agents/rules` link is recognised as committed. The
  background refresh no longer rewrites it on every move of HEAD, and `pin` no longer refuses the
  tree because a scan rewrote it. The README now says to name the link's target in the first exclude
  line.
- A session started in the directory that holds your checkouts, with no map of its own, now
  refreshes and watches each mapped checkout directly below it, and the reuse check asks about each
  one's change, naming files from where the session started. Before, both hooks answered nothing
  there, so a pull or commit in a child checkout never refreshed its map. A directory with more than
  eight mapped checkouts side by side is left as before.
- The reuse check no longer stops a turn that only added a migration, a schema dump such as
  `db/schema.rb`, a generated file, or lines that define nothing callable: comments, imports,
  `export ... from`, `require`, constants bound to plain literals (numbers, strings, booleans, nil,
  and arrays or hashes of them), and closing brackets. Any other added line is still checked,
  including a function built by a call such as `debounce(save, 300)`, an alias, a styled component,
  and Rails `enum` or `store_accessor`. So is code that merely lives under a `migrations` directory,
  such as a schematics or a migration runner.
- The reuse check's ask now tells a session with no subagent tool to run the search itself, instead
  of asking for a tool it does not have.
- The A/B harness keeps its arms apart and its trials independent. Every trial starts from the
  measured commit, with the map in one arm only. The arms are shared clones instead of linked
  worktrees, so the hooks no longer hand the no-map arm its main checkout's map, which made every
  run abort at the probe for anyone with the plugin enabled. A trial is limited to its own tools
  with `--tools`, and loads the arm's project settings and this repository's plugin but nothing from
  the operator's `~/.claude`. A trial cut short by the turn cap is scored on the files it wrote, and
  the result counts those trials per arm. A naming row narrowed to one kind of file is scored only
  over that kind. The refusal to measure names the rule that fired and the best claim's numbers.
- The linearity tests for the introduced-site judge, the frontmatter ownership reader and the
  encoder no longer fail on a busy runner. Each compares the time at n and 2n instead of checking a
  fixed number of milliseconds, and each still fails when the old quadratic code is put back. The
  picomatch cross-check that skipped on every CI leg is gone: the render tests' own glob matcher
  refuses any pattern syntax it would read differently from picomatch, and those tests run
  everywhere.
- `docs/how-it-works.md` said every unmeasured model-defaults entry fails open. The side does, but
  `interface_prefix` and `type_alias_prefix` are seeded with a hand-set class `none`, so a
  repository that prefixes nothing prints counts for them. The walkthrough names the two, and a test
  holds the unmeasured classes to them.
- The release checklist said to replace the `[Unreleased]` link ref. Releases keep it and add one
  for the new version, and `check:docs` now refuses a changelog missing either definition.
- `plugins/anatomiya/commands/pin.md` no longer tells the agent a capped corpus refuses to pin. The
  corpus has no cap.
- The hooks section of `docs/how-it-works.md` says all four hooks, not all three, and says where
  `refresh` starts its walk.

- `check --base` refuses the branch's own name spelled in another case, or typed in another Unicode
  form, on a filesystem that folds it (macOS, Windows), where it used to compare the branch with
  itself and exit 0 clean.
- A map or pin file that is on disk but cannot be opened is reported as unreadable, not as missing.
  A linked worktree whose own pin cannot be opened no longer falls back to its main checkout's pin.
- doctor and `scan --deep` no longer tell a typescript 5.x that is missing createProgram that it
  needs 5.x. They now say it does not export createProgram.
- The namesake-elsewhere count no longer credits a model sitting directly under `app/models` with an
  unrelated spec that shares its file name (a request spec named `vote_spec.rb`). A misplaced spec
  under a `models` directory still counts.
- `check` flags a branch that comments out a model's whole spec, the same way it already flagged
  deleting that spec.
- `migration_schema_only` and `migration_reversible` no longer read `revert CreateWidgets`, or a
  class-level `include Mastodon::MigrationHelpers`, as a migration that rewrites rows. Five of
  mastodon's schema-only migrations had dropped out of both rows this way, and `check` gave a FIX to
  a plain `revert` migration.
- `migration_reversible` reads `remove_column :t, :a, if_exists: true`, `drop_table :t, if_exists:
  true` and a drop_table of several tables as irreversible, as Rails 8 does, so `check` stops
  telling those up/down migrations to declare `change`.
- `http_through_client` no longer counts hand-built `Faraday::ConnectionFailed` or
  `RestClient::Exceptions::*` errors as direct HTTP calls.
- `http_through_client` no longer reads a Redis, cache, memcache, Dalli or database client
  (`db_client`, `pg_client`, `Mongo::Client`) as the repository's HTTP client, so a repository with
  no HTTP stops stating that its HTTP goes through one.
- A component annotated through an aliased React namespace (`R.FC` under `import * as R from
  "react"`) is no longer asked to be renamed in camelCase.
- `pin` during a merge with no conflicts says to finish or abort the merge. It said to commit or
  stash, and a stash throws away the merge in progress.
- `migration_schema_only` reads a model handed to a helper inside a class-level block, such as
  `define_method(:up) { backfill(User) }`, as a migration that rewrites rows.
- `pin` with unmerged paths and no merge in progress says to resolve them or abort the operation
  that left them. It used to say to abort a merge git had not started.
- `check` no longer says a model lost its spec when that spec was only added to the index (with `git
  add` or `git add -N`) and then deleted without ever being committed.
- `pin` and the refresh keep their own pathspecs when `GIT_LITERAL_PATHSPECS`,
  `GIT_NOGLOB_PATHSPECS`, `GIT_GLOB_PATHSPECS` or `GIT_ICASE_PATHSPECS` is set. Before, git read the
  pin's `.claude` exclude as a literal filename, so the pin refused over the tool's own map.
- `pin`, `scan` and `check` read the root `.gitattributes` from the index when the index marks it
  skip-worktree or assume-unchanged, a sparse checkout that leaves it out included. Before, a copy
  edited or deleted under one of those bits decided which files counted as `linguist-generated`, so
  generated directories could become areas.
- The reuse Stop hook no longer asks about a `linguist-generated` file when a sparse checkout or
  skip-worktree hides the root `.gitattributes` from the working tree. It reads the index copy the
  way `check` does, beside its status read, so it still makes two git reads in a row.
- `migration_reversible` now refuses every command ActiveRecord 8.1's CommandRecorder cannot invert,
  not just the first list: `add_enum_value`, and `drop_enum` or `drop_virtual_table` with no values.
  It also refuses `remove_check_constraint`, `remove_exclusion_constraint` or
  `remove_unique_constraint` with only a name, `rename_enum_value` without `from:` and `to:`, and
  `add_unique_constraint` with `using_index:`. The `change_table` spellings of the refused commands
  count too (`t.change_default`, `t.remove_index` and the rest). A correct up/down migration using
  one of these no longer gets "migrations declare change, not up and down".
- Both migration rows now read the same code: the methods Rails runs plus the migration's own
  helpers they call, whether by name, through `self.`, `method(:x)` or `send(:x)`. So a
  `change_column` inside a helper that `change` calls is no longer counted as reversible.
- An area's `paths` no longer reaches a source file whose extension or bare name is in another case
  (`app/Legacy.RB`, `lib/Old.JS`, `RAKEFILE`). Claude Code's matcher folds case and the corpus does
  not count such a file, so it is now cut out by name, the same way generated files are.
- A directory whose name differs from a sibling's only in case no longer roots an area. Claude Code
  matches `paths` with case folded, so `src/**` was also delivered to `Src/`. Both twins now fold
  into their parent, and at the repository root they are reported as uncovered.
- Area `paths` put every negation after every positive pattern. A negation that would also cut one
  of the area's own files by case is dropped, so an area never loses its own files to a case-folded
  cut.
- `check` reads a file added in another case as delivered, the way Claude Code does.

### Changed

- The A/B harness now reports a trial that finishes and writes nothing. The log line quotes the
  first line of the model's answer as the reason, and the result document counts these trials per
  arm in a new "trials that finished and wrote nothing" row.
- The delivery tests read a rendered `paths` list through the `ignore` package, which Claude Code
  matches rule paths with. It is now a root dev dependency pinned at 7.0.5, so CI runs it. They used
  to read through two hand-rolled models that disagreed with Claude Code on a trailing `/**`, on
  case and on a backslash.
- The severity table in docs/how-it-works.md now quotes each reason `check` prints, including the
  borrowed-prior cap ("N of M baseline sites here, on a claim the rest of the repository carries"),
  and `npm run check:docs` fails when a reason in `check.mjs` has no quote in its row.
- `scripts/ab.mjs` no longer refuses to start over engine variables in the operator's
  `~/.claude/settings.json`: its trials pass `--setting-sources project,local` and never load that
  file. `measure-defaults` keeps the check, since its trials still read it.
- `zone_aware_time` now reads "times are read and built through the application time zone", since it
  counts `Time.parse` and `Time.zone.at` as well as clock reads.
- The usage text, `scan.md` and the README give a deep scan's cost as measured, about 3x a plain
  scan, instead of 26x, and say that dependencies must sit on disk inside the repository: a
  `node_modules` linked in from elsewhere reads as not installed.
- The severity table in `docs/how-it-works.md`, the check command and the README list every FIX cap
  `check` applies, with the reason each prints.
- README Limits and `docs/how-it-works.md` say that a session started one directory above a checkout
  can get one copy of its overview per call in its first parallel batch, once per context window and
  per map.
- `docs/releasing.md` says which supply-chain job gates a merge. `dependency review` is required,
  since it fails only on what a pull request adds. The runtime audit stays advisory, since an
  upstream advisory against an existing dependency would block unrelated pull requests.

## [0.11.1] - 2026-09-30

The JavaScript parser moves to `oxc-parser` 0.151.0. Scanned under both parsers, 34 of the 35
corpus repositories get the same rules files, and react gets one area with fewer count lines. The
plugin lockfile a Dependabot branch regenerates now passes ci on Node 24, which it never did, and
Dependabot stops proposing TypeScript 7.

### Changed

- `oxc-parser` 0.151.0 and `flow-remove-types` 2.333.0. Every corpus repository was scanned under
  0.149.0 and 0.151.0. 34 of 35 get the same rules files, and their records differ only in the
  engine version they name. In react, one Flow file,
  `packages/scheduler/src/forks/SchedulerPostTask.js`, no longer parses as TypeScript: 0.151.0
  refuses a return type on a constructor, as TypeScript does. It now goes through the Flow stripper
  like react's other Flow files, the rows that cannot read a stripped file stop counting it, and its
  area loses four count lines while a fifth drops from 4 sites to 1.
- Dependabot no longer proposes a new major version of `typescript`. `--deep` needs major 5: 7 is the
  Go port with no JS API, so the bump only switched the checker off. Dependabot had proposed it three
  times.

### Fixed

- The plugin lockfile regenerated on a Dependabot branch now passes ci on Node 24 as well as Node 22.
  npm 11 keeps a `libc` field that npm 10 drops, so the two wrote different lockfiles from one
  Dependabot root lockfile. The field is left out of what npm is handed, and npm 10, 11 and 12 now
  write the same file.

## [0.11.0] - 2026-09-30

The map keeps itself current. After the first `scan` in a checkout, a background refresh rescans at
the start of every session and whenever HEAD moves, and the pin follows `origin`'s default branch when
a fetch or a pull brought its tip and no commit it would accept was made in this clone. A repository's
own `.git/config` can no longer make a read run a command. The rest is about a hundred fixes from a
line review of `check`, the pin, the Ruby parser and the dimension rows.

### Added

- A map built with `--deep` is kept current too, rebuilt with the type checker the way it was built.
- A linked worktree with no pin of its own reads its main checkout's, so `check` there no longer caps
  every finding at FIX in a repository that has a pin.
- Each automatic pin records what it accepted in `.claude/anatomiya/refresh.json`: the commit it
  moved from and to, and how many files entered and left the population.
- The map keeps itself current. After the first `scan` in a checkout, a background refresh rescans
  at the start of every session and whenever HEAD moves, and only when the commit, the tracked
  files, the pin or the plugin version changed. The hook returns at once and the scan runs detached.
  It leaves alone a checkout with no map of its own, a map committed to the repository, and a
  repository mid-merge or mid-rebase, and keeps the previous map when a rescan fails. A refresh that
  failed is said once in the delivered map, with `/anatomiya:scan` as the way to see why.
- The pin follows the remote default branch: when the checkout sits on the tip of `origin`'s default
  branch with nothing uncommitted, the refresh moves the pin forward to it. A feature branch, an
  unpushed commit, a commit this clone pushed straight onto the default branch (however it got
  there), an edited or staged file, a repository with no remote, and a clone that keeps no reflog
  never pin. A branch merged through a pull request's merge commit is pinned once pulled.

### Fixed

- Git LFS installed for one repository only (`git lfs install --local`) keeps working: the standard
  `git-lfs` filter commands are the one repository-configured command left to run, since they run
  the user's own installed `git-lfs`.
- On git's reftable backend the automatic pin never followed: a reftable clone writes the remote-tracking
  ref an entry with no message, which read as a commit made in this clone. Remote-tracking refs'
  entries are no longer read as commits made here. Verified on git 2.51, where the whole suite passes.
- A Dependabot bump of a runtime dependency no longer fails ci until somebody regenerates the plugin's
  lockfile: `.github/workflows/dependabot-lock.yml` regenerates it on the Dependabot branch, pushes it,
  and starts ci on the new commit.
- A repository's own `.git/config` can no longer make a read run a command: its filter drivers,
  ssh command, credential helpers, askpass, `git://` proxy, alternate-refs command, upload-pack and
  signature program, and those of its submodules, are replaced for every git call, while your own
  global settings for the same keys keep working.
- A partial clone's lazy fetch, on `check`'s read of the merge base, still ran an upload-pack the
  repository's own config named. For such a repository that fetch is not made, and the object reads
  as missing.
- A repository could still run a command through Git LFS, which reads the repository's config and
  runs an extension or transfer command named there. A repository naming one gets no `git-lfs` at
  all, your global filter included.
- A lock file the repository shipped as a link to `/dev/zero` hung every refresh worker with its
  memory growing, and one stamped in the future held every refresh. The lock is read bounded, and a
  future stamp is stale.
- The first automatic pin was held for good for anyone who had pushed straight to the default branch
  from another machine before the clone existed, and a pin whose commit git had collected (a
  squash-merged branch) held with a line blaming a commit made here. Both now pin.
- `git fetch origin main:main` read as this clone moving the tracking ref, and held the pin, while
  `git fetch --refmap=...` putting another branch into the tracking ref was followed.
- A repository committing the refresh's lock, or any other file under `.claude/anatomiya/`, had it
  removed by the refresh, and `pin` then refused the tree. Such a checkout is left alone.
- A move landing while another refresh held the lock waited for the next move. The holder now runs
  once more.
- A linked worktree on reftable missed a commit on its detached HEAD until the next session.
- `check` on macOS parsed one of two paths spelling an accented name two ways with the other's
  contents.
- The automatic pin could still accept this clone's own commit once its reflog record was gone: a
  worktree removed with its branch (how Claude Code's worktrees end), or, past a pin, entries expired by `gc`.
  A commit whose committer is this clone's own identity is now held too. A commit subject starting
  "Fast-forward" or a branch named with parentheses no longer reads as a fast-forward or a rebase step.
- A copied project's `.claude/` in a subdirectory made the refresh scan the enclosing repository,
  which never opted in, and write a map at its root.
- In a repository scanned before its first commit, the refresh stopped for the rest of the session
  after that commit.
- A tracked `.claude/rules` link to another checkout delivered that checkout's map as this one's.
- A backslash in a POSIX filename was read as a directory separator by the pre-write notice.
- A failed refresh's half-hour retry clock restarted whenever what the pin decided changed.
- `check | head` and the like no longer end with an EPIPE stack trace.
- `type_only_import` no longer asks for `import type React` in a file holding JSX, which the classic
  runtime compiles to `React.createElement`; a `@jsx` or `@jsxFrag` pragma's factory counts the same.
- `module_state_const` no longer asks for `const` in place of `using` or `await using`, which would
  drop the disposal.
- `import_extension` no longer counts imports of PDFs, web manifests, templates, message catalogues,
  3D models, SQL, shaders, videos, `.proto`, `.jsonc`, `.coffee` or `.es6` files, or `./dir/..`, as
  source imports missing their extension, and reads `./x.JS` as carrying one.
- `function_style` no longer counts the implementation of a default-exported overload set.
- `explicit_return_type` no longer flags an overload implementation whose signatures all declare a
  return type.
- `hook_per_module` counts a default-exported hook.
- `assertion_style` counts `expect.soft(x)` and `expect.poll(fn)` as expect assertions.
- `iterate_with_for_of` no longer counts `_.forEach(obj, fn)`, `React.Children.forEach`,
  `async.forEach` or any other library forEach that takes the collection as an argument.
- `doc_comment_style` no longer reads a TODO, FIXME, XXX or HACK note, or a license header, above an
  export as its doc comment.
- `swallowed_error` no longer reads `catch (e) { items.forEach((e) => log(e)) }` as using the caught
  error: a nested binding of the same name hides it.
- An import whose name merely contains a routing word (`./settingsSlice`, `./request-utils`,
  `./api-errors`) is no longer taken for the repository's config module or client, so every access
  through it stops counting as a routed read.
- `API.ts`, `APIClient.ts` and `HTTPClient.ts` are recognised as the repository's client: an
  acronym in a filename is one word, not one word per letter.
- An export made by `forwardRef(ButtonInner)`, `memo(CardImpl)`, `lazy(() => import(...))` or
  `dynamic(() => import(...))` is a component, and is no longer asked to follow the helpers' naming.
- `handler_memoised` judges a handler by the innermost binding of its name, not the last one read.
- A lowercase filename with an accent (`café.ts`) is no longer reported as spelling no naming class,
  and `OAuthToken`, `ETag` and `IDs` no longer vote for an `O`, `E` or `I` type-name prefix.
- With `--deep`, `.js` files are read by the type checker, so `law_of_demeter` no longer counts them
  in its denominator while never looking at them.
- A tsconfig `extends` into a directory whose name starts with two dots (`..base/`) is no longer
  refused as leaving the repository, and a root `tsconfig.json` linking out of it is refused.
- A parser worker that starts and never says it is ready is killed after 20 seconds, and a pool no
  worker becomes ready in reports its files as crashed rather than waiting forever.
- A directory named `@(lib)`, `x+(y)`, `(ab)` or `a\b` no longer becomes an area whose `paths`
  matches nothing or another directory: its files fold into the nearest ancestor, like other glob
  syntax.
- Files in no area are no longer all blamed on "too few per directory": the line names the three
  causes, the repository root, the per-directory floor, and a directory name no glob can spell.
- The overview's tests line names a root that counts only one level's files as
  `lib (files at this level)`, not `lib`, which read as the whole subtree.
- A count of one reads as one on the overview and the scan summary: `1 file holds`, `1 file says a
  generator wrote it`, `this tool leaves it`, `0 of 1 site`, `1 matches the model default`,
  `1 area file removed`, and no `file(s)` left on either.
- The scan summary prints the repository root with unprintable characters replaced and only the
  first line of an unreadable history's error, encoded, as `--format json` already did, so neither
  can add a line of its own.
- An overview with no area says no directory became one instead of a bare `## Areas (0)`, and a
  one-author repository no longer says "every claim below" over no claims.
- A blobless clone whose remote is not named `origin` reads its history offline instead of
  reporting it unread.
- The author of the first commit counts even where `log.showRoot` is set to false.
- `module_include` tells `class A::Worker` from `class B::Worker` in one file, so a forgotten
  include in one is no longer hidden by the other's.
- An `include` inside `class << self` is no longer counted as an include into the class, for
  `module_include` and for the Sidekiq worker check.
- A bare `rescue` that reads `$!` or `$ERROR_INFO` counts as using the error.
- `doctor` reports a `ruby` that cannot run at all (an rbenv shim with no version selected) as the
  interpreter's failure, with its own error, rather than as a missing prism.
- A prism installed with `gem install --user-install` under `XDG_DATA_HOME` is found.
- `setup --dry-run` with nothing to install no longer also prints an npm command it would run.
- A migration's `execute` is read as data work when its SQL starts with a comment or is a `MERGE`.
- A Ruby file holding `1e400` or a binary-encoded string is parsed instead of reported unread.
- prism parses with the grammar of the Ruby it runs on, so code that Ruby accepts (such as
  `a[0, k: 1] = 2` before 3.4) is no longer reported as a syntax error.
- `check` on a shallow clone that already holds the base branch (`--no-single-branch`, or a
  `fetch --depth=1 origin main`) finds the base its merge commit names, and otherwise says to fetch
  the history, rather than examining nothing.
- `check` on a shallow clone finds a remote default branch named something other than main or master.
- `check --base` refuses `HEAD~0`, and a branch's own name on a branch with commits of its own,
  rather than comparing the branch with itself and reporting it clean.
- `check` reports a companion moved in the working tree to a name it does not count, such as
  `thing_spec.rb.bak`, as missing, as it already did once the move was committed.
- `check` no longer reports a test renamed within its own directory as a test with no precedent.
- `check` judges a file holding tens of thousands of sites in seconds rather than half a minute.
- `check` reports a site added above a renamed function where it was added, not on the renamed one.
- `check`'s header and `base.sha` name the base branch's own tip; `base.mergeBase` is the fork point.
- `check` skips a submodule whose path looks like a source file rather than naming it unreadable.
- `check` reads the base side of two files whose paths differ only in case as two files on a
  case-insensitive filesystem, rather than one overwriting the other.
- `check` treats a branch's moves as moves past git's default rename limit, and says so
  (`renames-skipped`) past its own, rather than charging moved code as new.
- A scan run during an unresolved merge counted each conflicted file two or three times, once per
  stage git lists it at. Each path now counts once.
- A `.gitattributes` `linguist-generated` pattern with a leading slash (`/gen/**`) excluded nothing,
  and one with no slash (`schema.ts`) matched only at the repository root. Both now match where git
  matches them.
- An area file's `most imported from here` line no longer lists a namespace import as an empty name,
  and names a default import for its module (`user (default)`) rather than printing `default`.
- A tracked file the scan could not read (a directory it may not enter, a name that is not UTF-8, a
  file deleted since the commit) was left out without a word. The scan summary now says how many.
- Folding areas to fit the area ceiling could leave a larger area's files uncovered while a smaller
  area it had just created survived. Areas are now folded strictly smallest first.
- A test file holding only table-driven cases (`test.each(...)(...)`, `describe.each(...)(...)`) lost
  its runner label, and a minitest file written in the `describe`/`it` spec style was labelled RSpec.
- A repository created without a reflog, or on git's reftable backend, refreshed only on a checkout:
  nothing appended to the `logs/HEAD` the hook watched. It now watches the index there, or the
  reftable table list, so a commit or a pull refreshes the map as it does everywhere else.
- When the automatic pin stops following (a commit made in this clone on the default branch, a tip
  this clone pushed, a tip with no record of how it moved, a question git could not answer), each
  session you start or resume opens with one line in the terminal saying so, until a pin by hand, or
  a refresh that no longer holds it, ends it; a compaction or a clear inside the session does not
  repeat it. It is recorded in
  `refresh.json` too, and never reaches the model.
- The end-of-turn check asks git for the reflog where it is not a file (reftable), so a turn that
  committed everything it wrote is still asked about there.
- A refresh worker whose lock had been taken over no longer deletes the new holder's lock.
- A rule file opening with `---` and repeating `generator: anatomiya` without closing the fence took
  seconds to recognise as not ours (50 s for a 1 MB overview, past the hook's timeout). It is now
  read in one pass.
- Variation selectors, the combining grapheme joiner and the Hangul fillers no longer ride invisibly
  through the encoder, and a value capped at a few graphemes can no longer come out a million
  characters long.
- A path mixing Armenian or Cherokee letters into a Latin word (`src/cօnfig.ts`) is refused as a
  look-alike, as Cyrillic and Greek already were.
- `.claude/anatomiya` linked anywhere outside the repository's own `.claude` (into `.git/hooks`, say),
  and `.claude/rules` linked out of the repository or into its git directory, are refused by `scan`
  and `pin` rather than written through, and a `facts.json` or `baseline.json` linked out of the
  repository is no longer read. A `.claude/rules` linked to a shared rules directory elsewhere in the
  repository (`.claude/rules -> ../agents/rules`) is still written through.
- A map directory linked to a file is refused by its own name, saying it is a link, rather than by
  the name of the file it points at: `.claude/rules -> ../README.md` said to remove the README.
- `pin --dry-run` and `scan --dry-run` refuse by name a store, pin or record the write could not get
  past, where they said "would write" and the real run died on `ENOTDIR`, `EEXIST` or `EISDIR`.
- A committed `facts.json` whose held area carried a malformed dimension took the scan down; such an
  area is no longer carried.
- A pin naming a corpus size that is not a count of its files (`-5`) is refused as unreadable,
  instead of making every one-file directory an area.
- A write that fails part way, on a full disk, no longer leaves its temporary file beside the map.
- A guard named after an inherited property (`toString`) is refused like any other unknown guard.
- A prerelease of an engine's floor version (`1.0.0.rc1`, `1.0.0-rc.1`) no longer counts as meeting
  the floor.
- A repository's own `.git/config` can no longer make the git reads run a command through
  `core.fsmonitor` or a hook.
- `pin` asks again, once the file list is read, whether HEAD and the tree still match: a commit or a
  `git add` landing while a large index was read put files into a pin labelled with the commit
  checked before.
- A linked worktree reading its main checkout's map now hears when that checkout's automatic refresh
  failed.
- On a blobless partial clone with the branch checked out directly, `check` skipped every changed
  file as unreadable at the merge base and reported nothing. It now fetches those blobs from the
  clone's own remote; every other read still refuses to reach the network.
- A scan run by hand clears a failed automatic refresh, which the delivered map kept reporting, and
  the next refresh no longer rescans a checkout that has not moved.
- The one remedy still naming a bare `anatomiya scan .` (a worktree with no map) now names
  `/anatomiya:scan`.
- On a Ruby with no `prism` at all (2.7 to 3.2 before `gem install prism`), `check` reported nothing
  found and `scan` wrote nothing, with no remedy: every file read as crashing the parser. Both now
  refuse with the Ruby remedy, as they do when `ruby` is absent.
- The checkout path the delivered map names can no longer carry a newline or a bidi override into
  the session's context.
- A repository whose directories are named in Russian, Greek, Japanese or any one script got no area
  and an overview of `<path with mixed scripts>` placeholders. Only a word that mixes look-alike
  alphabets (`раyments`, a Cyrillic `а` in a Latin word) is refused now.
- Listing the installed `prism` gems no longer loads the newest installed `json` gem, whose failure
  silently kept an older Ruby on its too-old default parser.
- Two refresh workers started within milliseconds of each other could both run: the lock file was
  created empty and filled in after, and the second read the empty one as abandoned.
- In an Angular or NestJS repository, the environment, logging and network conventions stopped
  seeing a wrapper named the way those frameworks name files (`./config.service`, `./env.constants`):
  any dotted suffix was read as an asset's extension. They now use the same list of asset formats as
  the import-extension convention, so a source import is a source import in both.
- The automatic pin could follow a remote-tracking ref this clone had moved itself, by `git push` or
  `git update-ref`, and so accept the agent's own commits as the population everything is judged
  against. It now follows a tip only when a fetch or a pull brought it, and never one HEAD moved away
  from while it was being judged.
- The background refresh rewrote a `baseline.json` the repository commits, leaving a change in
  `git status` nobody made. A committed pin is now left alone like a committed map.
- The refresh ran for any file another plugin had asked Claude Code to watch, and its answer
  replaced that plugin's watch with its own. It now answers only for the files that say this
  checkout's `HEAD` moved: its reflog, or where there is none the index, or reftable's `tables.list`.
- A refresh that failed once, for a reason of the machine's rather than the checkout's, was not tried
  again until the next commit. It is retried after half an hour.
- On a very large repository the refresh never ran: the index it hashes was read whole and gave up
  past 64 MB. It is streamed.
- `check` examined nothing on the checkout `actions/checkout` makes for a pull request, one depth-1
  fetch of the merge ref, and printed 0 MUST-FIX, 0 FIX, 0 NIT on every pull request. A base that is
  one of the merge commit's own parents is now taken as the merge base, and a shallow clone that
  still reaches none says to fetch the history (`fetch-depth: 0`).
- On a shallow clone where the base commit could be fetched, every finding was capped at FIX under
  "cannot resolve origin/main", one line below a header naming origin/main as the base. Staleness is
  now measured against the commit the run compared against.
- A file the branch committed and then deleted before committing again got a MUST-FIX on a file
  that no longer existed, and one moved with `git mv` was skipped with a false "could not read at
  the merge base", its new violations with it. A path deleted or moved away in the tree is no longer
  judged, and a move of a file the branch added is judged as the addition it is.
- `check` judged generated files the map never counted (an `@generated` header, or
  `linguist-generated` in `.gitattributes`), so a branch that regenerated a client got a MUST-FIX per
  site in code nobody writes by hand. They are left out of the check the way the scan leaves them out.
- With two identical sites in one file, a branch that added the new one above the old one was
  reported at the old one: wrong line, wrong function, and an annotation on code the branch never
  touched. Every Ruby rescue added above a swallowing one was misplaced this way.
- A `.ts` file renamed to `.tsx`, or back, was skipped whole with a false "did not parse at the
  merge base": its old version was parsed with the new name's grammar. It is parsed as the file it was.
- Deleting a spec on a branch and leaving its model alone passed clean against a map stating "a
  model ships with a spec", while a one-line edit to the model was flagged. A producer whose
  companion the branch removed, committed or not, is now held to the obligation.
- A new file staged with `git add -N` was skipped with a false "could not read at the merge base".
  It is judged as the addition it is.
- With `diff.renames` or `status.renames` turned off, an uncommitted `git mv` read as a deletion and
  an addition, and every violation the moved file already held was reported at MUST-FIX against
  whoever moved it. The check asks for rename detection itself.
- A file over the 1 MiB cap was reported as one `check` could not read, under `head-unreadable`,
  which points at git or the disk. It is named as past the size cap, under `head-oversize`.
- A file its area's globs miss by type, such as a `.tsx` in an area of `.ts` files, was capped with
  a reason naming a directory above the one it sits in. The reason names the type the area file
  does not reach.
- A symlinked source file answered two ways by commit state: committed, `check` parsed the link's
  own text and blamed syntax the parser rejected; uncommitted, it charged the target's sites a second
  time under the link's name. A link is left out of the check.
- `check` rewrote the paths it reported, in every format: one over 120 characters came out ending
  in `…`, and one in a non-Latin script as "<path with mixed scripts, N chars>", in the JSON record
  and the GitHub `file=` property as well, so the annotation could not be placed and the file could
  not be opened. A path is now the file's own, with only what breaks or reorders a line removed.
- The end-of-turn check blocked every turn, a question included, when the session's transcript
  could not be read, over files left changed before the session began, and it never stopped: what it
  had already asked is read back from that transcript too. A stop with no readable transcript now
  asks nothing.
- Mid-merge, the end-of-turn check named the other branch's code as the turn's added functions and
  asked for the copy to be deleted. It asks nothing while a merge, a cherry-pick, a revert or a rebase
  is unfinished.
- A scan took out any hook in `.claude/settings.local.json` whose command held `anatomiya.mjs` and
  then `echo`, including an echo wired by hand to a clone's absolute path, which works, and somebody's
  own `echo-stats`, and said this tool had written them. It now takes out only the
  `${CLAUDE_PLUGIN_ROOT}` entry 0.2.4 through 0.2.6 wrote.
- `scan --dry-run` said the old settings hook "was taken out" over a file it had not touched. It now
  says the hook would be taken out.
- The echoed map told the model to run `anatomiya scan .` when it looked stale, a command nothing
  installs, so following it ended in "command not found". It now names `/anatomiya:scan`, in a
  worktree too, and so does the README.
- An echoed map said only that it was counted from "this repository", so a session reading files
  in two checkouts held two maps it could not tell apart. It now names the checkout it was counted at.
- In a vendored copy of a scanned project, whose record sits below the git root, the end-of-turn
  check named an unchanged file and missed the real edit. It no longer reads a change against a
  record that is not at its checkout's root.
- A tracked symlink to a source file inside the repository was read as source. Every site in its
  target counted twice. An uncommitted edit to the target also moved the pinned baseline the branch is
  measured against, because the link itself had not changed since the pin. A symlink is now left out
  of the map wherever it points, and its target is counted where it is tracked.
- An area file for a directory with a non-Latin name, or with a path longer than 120 characters, was
  written with a `paths` pattern that could never match it (`<path with mixed scripts, 14 chars>/**`,
  `.../w…/**`), so its rules never loaded and nothing said so. Such a directory no longer gets an
  area of its own. Its files join the nearest parent directory whose name can be written as is, and
  are reported as uncovered where no such parent exists below the repository root.
- In TypeScript written for Node16 or NodeNext, which puts `.js` on every relative import, every
  area was missing its "Most imported from here" line, because `../utils/format.js` was never matched
  to `format.ts`. Such an import now names the source it is compiled from, and so does an alias
  like `@/utils/format.js`.
- With a regular file at `.claude/rules`, `.claude` or `.claude/anatomiya`, `scan --dry-run` said it
  would write the map, and the real `scan` then failed with a raw `EEXIST` or `ENOTDIR`. Both now
  refuse, name the file in the way and say to remove it.
- On Node 20 or 21, `scan` died halfway with `Map.groupBy is not a function`, which names neither
  Node nor a fix, while `doctor` called every engine ok. Nothing enforces the Node 22 the plugin
  declares, and Claude Code's own installer needs no Node, so the `node` on `PATH` can be any version.
  `doctor` now starts with a row for the Node it runs on and the fix. Every other command refuses an
  older Node with that sentence before it does any work, and the hooks answer nothing and exit 0.
- A worktree Claude Code made from the README's `.worktreeinclude` got the map but not the pin, so
  `check` there capped every finding at FIX with "no baseline pinned" in a repository that had one.
  The recipe now copies `.claude/anatomiya/baseline.json` as well.
- `pin` accepted an empty population with exit 0 when the source had never been committed, and every
  area the first commit then made stated nothing until somebody pinned again. It now refuses, a dry
  run included, and counts the untracked source the way the scan does.
- A re-pin counted a file that only moved to another area as one file entering the population and
  one leaving it, and listed it as leaving, so a floor step that re-partitioned a repository
  reported departures that never happened. Entering and leaving are now counted over the whole
  population, and a move is reported as a move beside the areas it crossed.
- A pin that would not load, whether a merge left conflict markers in it or a newer build wrote it,
  read as no pin: the scan and the check said "no baseline pinned" and `pin` printed a first pin over
  it. Each now says the pin on disk could not be read and why, and `pin` says it is replacing it.
  Claims still drop to counts, as before.
- `pin` could still be taken mid-merge when the conflict was in a tracked source file under
  `.claude/`, recording that file once per merge stage and a corpus larger than the tree. It now
  refuses while any path in the index is unmerged.
- A repository using SHA-256 object names could not be pinned (`pin` said it had no commit) and
  `check` could read none of its files. Object names of up to 64 digits are accepted now.
- On a partial clone, reading a pinned file fetched it from the remote, which nothing here may do
  unasked, and with the remote gone every pinned file came back unread. Missing objects are now
  reported missing instead of fetched.
- `pin` listed a staged, edited, deleted or conflicted file against a commit that did not hold it,
  and every later scan closed that area as a population change for as long as the pin stood. It now
  refuses while tracked files differ from HEAD, dry run included, and says to commit or stash first.
- Ruby specs written after the pin could read as the baseline's own habit. The baseline reuses
  today's record for every file unchanged since the pin, and that record carried today's answer to
  "does this have its spec"; where the pinned tree had no spec of that shape, the answer stayed, and
  a branch was held to a convention its own agent had just started. The answer is now worked out
  over the pinned tree alone.
- A scan could write outside the repository through a symlink planted where its temporary file
  went. Each file was written to `<name>.tmp-<pid>` beside its destination with a write that
  follows a link, so a repository shipping that name as a tracked symlink had the map's bytes
  written wherever it pointed. The temporary name is now unpredictable and created exclusively, which
  refuses any entry already there.
- A Ruby whose `prism` is too old read as every Ruby file crashing the parser: `scan` exited 0,
  withheld the whole map, JavaScript areas included, and named no remedy. It now fails the way a
  missing interpreter does, with the remedy.
- A branch cut before the pin read every file the default branch added since as missing, and closed
  each area those files were in. Those files were never on the branch, and no longer count as gone.
- Ruby before 3.4 could not be used at all. Ruby 3.3 ships `prism` 0.19, which the parser refuses
  because it spells the fields the dimensions read differently, and `gem install prism` did not
  help: the parser runs with gems disabled and only ever saw the default. It now asks which prism
  gems the interpreter holds and, when the default is older than 1.0, loads the newest installed
  one past it, so `gem install prism` is the whole remedy on any Ruby from 2.7. `doctor` reports the
  prism that will actually parse, and says to run `gem install prism` as well as to upgrade Ruby.
  An interpreter whose own prism is new enough loads exactly what it did before.
- `pin` wrote `baseline.json` through a `.claude` symlinked out of the repository, which a clone can
  carry as a tracked link, and every later `scan` and `check` read the pinned population from
  there. The map and its record already refused such a link. The pin now resolves the same way:
  `pin` refuses it, a dry run included, and a pin read through it is treated as no pin.
- Under an address-space limit (`ulimit -v`, as on some shared and CI hosts) or strict overcommit,
  every JavaScript and TypeScript file came back unreadable, and the scan wrote an overview of zero
  areas and removed every correct area file. The parser's fast transfer reserves 6 GiB before it
  reads anything; refused, it now parses the same tree the plain way.
- A parser worker that could not be forked, under a `TMPDIR` that had been cleaned up, at a
  process limit or out of file descriptors, took `scan` down with Node's "Unhandled 'error' event"
  stack. It now fails as a parser that never started, and that run writes nothing and removes
  nothing, where a parser worker that would not start used to leave the scan removing every area file.
- `scan --deep` on a repository with no root `tsconfig.json`, such as an Nx-style monorepo with
  `tsconfig.base.json` and one config per package, printed every type-checked claim as counts only
  beside "100% of type lookups resolved". The checker runs on the compiler's defaults there and is
  judged by what resolved.
- `scan --deep` on Vite's react-ts layout, whose root `tsconfig.json` builds nothing and names
  `tsconfig.app.json`, ran the checker without the `@/` alias and resolved 77%, so every
  type-checked claim printed as counts only. A root like that is read through the project it names
  first.
- `setup` reported success when npm answered "up to date" and the parser still did not load, as it
  does with `optional=false` in npm's config, which leaves out oxc's native binding, and `doctor`
  kept sending the user back to `setup`. `setup` now installs optional dependencies whatever npm's
  config says, asks the engines again afterwards, and fails naming any that still does not load.
- A `typescript` 4.x in a `node_modules` above the plugin, such as one in the home directory, read
  as `ok` in `doctor` and `nothing to install` in `setup`, while `scan --deep` refused it as not
  installed. `doctor` now says `--deep` needs 5.x, and `setup` installs it.
- The parser's memory ceiling stood down without a word where `ps` is not installed, as in
  `node:*-slim` images, and `scan .` could run a `ps` committed to the scanned repository when
  `PATH` held an empty entry. Linux reads worker memory from `/proc`, and elsewhere the guard runs
  `/bin/ps`.
- A TypeScript repository with one Gemfile or Rakefile (the React Native template ships one) got no
  map at all on a machine without a usable Ruby: `scan` exited 1 on `spawn ruby ENOENT`, or wrote
  nothing under a Ruby with no prism, and `check` refused a branch that touched the Gemfile beside a
  `.ts` file. A language no file of which was read now costs only its own files. The rest of the map
  is written, an area holding that language keeps what the last scan that could read it wrote, and
  the summary, the overview and a new `engine-missing` check caveat name the language, why, and the
  remedy. Only a run that read nothing at all still writes nothing.
- With an empty or relative entry in `PATH` (a trailing colon is the common one) and no Ruby
  installed, `doctor`, `scan` and the background refresh ran a `ruby` any other local user had left
  in the shared temp directory, as the person scanning. Ruby is now looked up in `PATH`'s absolute
  directories only, and a probe that answered no version is no longer reported as ok.
- A Ruby file holding a long `elsif` chain, method chain or `+` expression, about 98 deep, was
  reported as a file that could not be parsed though prism found no error in it: its tree ran past
  the JSON encoder's default nesting cap of 100 on the way out of the parser. It is read now.
- After a Ruby upgrade that kept the old gem directory, a prism built for the old Ruby was put on the
  load path, failed to load, and `doctor` said prism was not installed. A listed prism is now proved
  to load before the parser is handed it, and otherwise the next one that loads answers, which is
  the accurate "older than 1.0.0" when only the default does.
- A route file whose name a framework's router decides (`[id].tsx`, `[...slug].tsx`, `_app.tsx`,
  `_document.tsx`, `$postId.tsx`, `+page.ts`) is no longer a site for `file_naming_case`, so `check`
  stops telling the agent to rename a Next.js, Remix or SvelteKit route to kebab-case. An underscore
  on a stem of more than one word (`_tmpProbe.ts`) is still counted.
- A React component kept in a `.js` file now gets the JSX rows. Before, the scan labelled the file
  "(JSX)" but stated none of the five JSX conventions for it, and `check` enforced none. A `.js`
  file with no JSX stays out of those rows' denominator, the same as a `.ts` file.
- Ruby models that register `after_create_commit`, `after_update_commit`, `after_destroy_commit` or
  `after_save_commit` count as registering lifecycle callbacks. Before, a model directory built on
  them read "models keep behaviour out of lifecycle callbacks", the wrong way round.
- Direct calls to Ruby HTTP gems (RestClient, HTTPClient, HTTParty, Faraday, Excon, Typhoeus, HTTP,
  HTTPX) count as bypassing the repository's own client, the way Net::HTTP already did. Before,
  RestClient and HTTPClient counted as the repository's own client because of their names.
- `Time.local`, `Time.parse` and `Time.at` count against reading time through the application zone,
  as the `Time.zone` forms already counted for it. Before, a directory using both halves stated a
  perfect convention.
- `fail` counts as raising, both for a service entry point and for a rescue that re-raises, and a
  rescue that binds the error to an instance variable and reads it counts as using the error.
- A second author whose only file broke a habit counted as the habit's second pair of hands, so one
  person's practice was stated as the directory's convention with "2 authors" beside it. Each side
  of a claim now counts the authors of the files carrying its own sites.
- One person committing under two addresses that the repository's `.mailmap` already maps to one
  identity, or under one address typed in two cases, counted as two authors and cleared the author
  gate alone. Authors are now read through `.mailmap` and compared without case.
- `scan` and `pin` ended by telling you to restart a running session, and `/anatomiya:scan` and
  `/anatomiya:pin` had the agent pass that on, although a running session gets a changed overview on
  its next prompt or tool call. The line and the command files now say so, and say that a new
  session, a compaction or `/clear` loads the whole map.
- The README said a solo repository states very little because a habit needs a second author. With
  one author in the whole history the bar is one, and every claim that clears the other gates is
  stated as that author's practice. The README now says so.
- The README's sample run showed a baseline line and an orphan line in wording `scan` no longer
  prints, and none of the engines, layout or running-session lines it does. It is now a fresh run on
  a public repository and is checked against the printer. Two counts in the docs that had drifted
  (the dimension total and the JSX total) are now checked too.
- A misspelled verb or a refused option in a command file passed every gate and would have failed
  every run of that command. `check:docs` now parses each documented invocation with the CLI's own
  argument rules.
- Every command that takes a path said `not a git repository` whatever went wrong: for a file inside
  a repository, a path that does not exist, a machine with no git on PATH, and a checkout git refused
  to read (dubious ownership in a container). A file now picks the repository it is in, and the
  others say `no such directory`, `git is not on PATH`, or git's own words, `safe.directory` fix
  included.
- The end-of-turn reuse check never ran on a turn that committed what it wrote, because it read only
  the working tree against HEAD. The commits a turn makes after its last checkout, pull or reset are
  now read from the reflog and checked with what it left uncommitted, with no file written and
  nothing asked twice.
- `check` snippets dropped `|` and backticks, so the finding `defaults are taken with ??, not ||`
  quoted its own site as `x.n 0` and a union type lost its bar. A snippet now shows the code as
  written, with only line breaks and bidi or zero-width characters refused.
- `npm test` failed four permission-denial cases when run as root, the default in most containers.
  They now skip with the reason, since root reads past every mode bit and the denial cannot happen.
- A class documented above its decorators, the way NestJS writes `/** doc */ @Injectable() export
  class`, read as undocumented, so a directory of documented services stated "exported functions
  carry no doc comment" and `check` flagged a documented function added beside them. A doc comment
  above the decorators now belongs to the class, as TypeScript and JSDoc attach it.
- An extensionless import of a file with a dotted stem (`./user.service`, `./app.module`,
  `../dto/create-user.dto`) was read as an asset import and left out of `import_extension`, so a
  directory where a third of the relative imports carried `.js` stated "relative imports carry the
  file extension" at 40 of 40, and `check` never flagged the missing `.js` that Node16 and NodeNext
  refuse. Only stylesheets, images, fonts, media, data and the other formats a bundler is handed by
  full name are assets now, and any other relative import counts.
- The constructor parameter types of a decorated class, such as a NestJS service, counted as imports
  used only as types, so the map named correct dependency-injection imports as exceptions and
  `check` asked a new `@Injectable()` service for `import type`, which compiles and leaves Nest
  unable to resolve the dependency at runtime. A type that decorator metadata emits as a value is
  now read as a value.
- An async function whose only `try` had a `finally` and no `catch` counted as handling its own
  failures, so a directory of lock and cleanup helpers that caught nothing stated "async functions
  handle their own failures" as a directive. Only a `try` with a `catch` counts now.
- A directory of ES5 `var name = function () {}` module functions was told "module-level functions
  are assigned as arrow consts, not declared with function", a directive to bring in arrows and
  `const` it held neither of. The sentence now says what the row counts: "module-level functions are
  assigned to variables, not declared with function".
- A plain JavaScript repository that uses `?.` stated "possibly-absent values are read with ?., not
  asserted with !", though `!` is a syntax error outside TypeScript and `check` could never enforce
  it. A `.js` or `.mjs` file is now left out of `non_null_assertion`, as it already was out of the
  other rows that need type syntax.
- `return void f()`, which runs the call and returns, counted as returning `undefined` for an absent
  value, so it was named as the exception to "an absent value is returned as null, not undefined"
  and `check` would have asked for a `return null` that changes nothing. Only `void` over a literal,
  the old `void 0`, counts now.
- A name of capitals alone read as PascalCase. A Next.js `app/api` directory of routes exporting
  `GET` and `POST` stated "functions are named PascalCase" and `check` asked for its one camelCase
  helper to be renamed, and a constants module of `export const DEBUG` stated "exported names are
  PascalCase". A word of capitals alone now spells no case, and `URLParser` still reads as
  PascalCase.
- A stylesheet named for settings (`./SettingsPanel.module.css`) was taken for the repository's own
  config module, so a directory of components importing their CSS modules stated "environment reads
  go through the repository's own config module, not process.env" in a repository holding no config
  module. Only an import of a source module can stand for the repository's own config, logger or
  HTTP client now. A stylesheet, a JSON file or an image cannot.
- A component exported through `forwardRef`, `memo` or `styled` voted in `exported_symbol_case` as a
  plain export, so a components directory stated "exported names are camelCase" with its one
  `forwardRef` field as the exception, and `check` asked for a new `TextInput = forwardRef(...)` to
  be renamed `textInput`. Such a component is left out of the vote, as a plain component already
  was.
- A Ruby model inheriting another model of its directory (`class Admin < User`, single-table
  inheritance) was the exception to "models inherit ApplicationRecord", and `check` told the agent
  to break the hierarchy. A class whose chain of parents, through the classes its area declares,
  reaches the learned base now conforms, in the map and in the check.
- On a machine with no `node` on `PATH`, which Claude Code's own installer does not need, every hook
  failed with `node: not found` on every prompt and tool call, and nothing said why. The README now
  states that the hooks need `node` on `PATH` and what its absence looks like.
- With no pin, `scan` ended by saying "`anatomiya pin` accepts one", a command nothing installs, and
  said nothing of the pin the background refresh takes. It now says a pin is taken on its own when
  the checkout sits on the tip of origin's default branch with nothing uncommitted, and names
  `/anatomiya:pin` for one by hand.

## [0.10.2] - 2026-09-24

Two machines could render two different maps of one repository, because the list the overview names
areas from was ordered by the host's locale, and a fifo in the working tree, or where the map's record
or the pin belongs, could hang `check` and `scan` with nothing printed. Every list is ordered by UTF-16
code unit now, and every read of a path the repository controls opens without waiting and measures its
cap in bytes on disk.

### Fixed

- The overview could name different areas on two machines scanning the same repository. It lists
  areas in order until its line budget runs out, and that order came from the host's locale, so
  under `sv_SE` an area named `är` sorted after `zoo` and under `en_US` before it. Every list the map,
  the pin and `check` print is now ordered by UTF-16 code unit. A repository with upper-case or non-ASCII
  directory names sees its area lines reorder once, the same way on every machine.
- `check` hung with nothing printed when a file the branch changed had become a fifo, and `scan` and
  `check` did the same on a fifo where the map's record or the pin belongs. Those reads now open
  without waiting and skip anything that is not a regular file, the way the hooks already did.
  `scan` no longer hands the parser a tracked path that has become a fifo, where it waited out the
  parse watchdog and was then reported as a file that crashed the parser. The record and the pin are
  read up to 64 MB on disk, far past any map this writes; `check` names a record past that rather than
  reading it as a repository nobody scanned, and a pin past it reads as no pin.

## [0.10.1] - 2026-09-23

The hooks were silent in every linked worktree of a repository that ignores `.claude/`, which is
where a session goes to do its work, and one namesake test in a large source root was enough to keep
the notice quiet for all of it. A worktree with no map of its own now hears its main checkout's
counts under that checkout's name, and a root needs three namesake tests before testing counts as
its habit.

### Fixed

- A linked worktree with no map of its own was handed nothing by the hooks, which is every worktree
  of a repository that ignores `.claude/`, and so the place a session branches off to do its work
  wrote tests where the map said none go. The echo, the notice and the end-of-turn check now answer
  there from the main checkout's map and record, labelled as the main checkout's counts rather than
  this worktree's, and a write or a change is still read from the worktree's own files. Only a
  worktree git registered in the main repository is followed: a copied or forged `.git` file, a
  submodule, and a git directory not named `.git` (bare, `--separate-git-dir`, or symlinked
  elsewhere) still hear nothing. The echo says the area files the map names are in the main
  checkout, since a worktree never loads them, and `check` there names the main checkout in its
  no-map caveat rather than borrowing counts it would compare the branch against.
- One or two namesake tests no longer mark a whole source root as tested. A root needs three, the floor
  its producers already take, before the notice treats testing as its habit: one namesake among 517
  files had silenced it for every test written under that root. Across the 40,701 test files the
  corpus already holds, this adds three findings. Where a root holds one or two, the counts line no
  longer says the tests it names are none of them a namesake.

## [0.10.0] - 2026-09-23

The map used to arrive after every turn and every tool call, and Claude Code keeps every copy, so a
long session carried hundreds of identical maps. It arrives once per context window now, and again
when the map changes, a compaction starts a new window, or the last copy is far enough back that
recency needs it.

### Changed

- The hook that re-delivers the map now does it once per context window instead of on every turn and
  every tool call. It reads the end of the session's transcript and stays silent while that holds the
  same map with no compaction after it; a changed map, a compaction, or a copy more than 256 KiB of
  transcript back is delivered again, and a subagent or workflow stage is answered from its own
  transcript. On 3,502 local transcripts, 94.0% of deliveries had repeated the one before (A92).

### Added

- `scripts/measure-echo.mjs`, which replays that rule over a transcript store and prints how many
  deliveries repeated, how many the rule keeps, and how many transcript bytes a context token costs.

## [0.9.0] - 2026-09-23

The marketplace listed two plugins that shared a repository and nothing else. It lists one now, and
what is left is the scanner, its tooling and its gates. The one piece anatomiya's own measurement
harness read from the second plugin moved beside the harness, and the two gates whose rule rested on
there being two plugins were rewritten to rest on what a plugin root holds instead.

### Removed

- The second plugin this marketplace listed, `ultracode-anywhere`, and everything that served it: its
  directory, its tests, `scripts/workflow-lint.mjs` and the workflow harness under `test/`, its
  release entry and tag pattern, its coverage scope, its decision rows, and the prose that named it.
  The marketplace lists one plugin now and the bare `v` tag is the only one that releases anything.

### Changed

- `settingsFor` and the reader that finds the installed Claude Code build live in
  `scripts/claude-build.mjs`, which is what the measurement harness and its suite read; they used to
  sit inside the removed plugin.
- A plugin's release problems are reported against its `.claude-plugin/plugin.json` rather than its
  `package.json`: node reads that file while resolving the plugin's own dependencies and refuses to
  start on one that is not an object, so a gate naming it could never print the sentence.
- The docs gate exempts the two paths the plugin contract names, `.claude-plugin/plugin.json` and
  `hooks/hooks.json`, instead of inferring the exemption from two plugins holding the same tail. The
  exemption is the plugin's own copy rather than the name, so a file with one of those tails that
  moves anywhere else is still reported.

## [0.8.0] - 2026-09-15

A third hook: at the end of a turn that added source code in a scanned repository, anatomiya asks once
per file for one subagent to look for an existing function the new code could call instead. The
wording is the only one measured passing every hard case, 24 of 24, and the added-lines diff it
shares with `check` no longer runs a repository's diff driver or loses lines to its diff config.

### Added

- A `Stop` hook asks, once per change, for a turn that added source code in a scanned repository to
  be checked for existing functions before it ends. The reason hands the search to one subagent:
  measured on four hard cases it passed 24 of 24, where every wording the model answered inline
  passed 9 or 10 of 12 and no hook left every duplicate in place. It costs about 1.8 times a turn
  that changed source code, stays silent on a change with no added source line, and writes nothing.
  Each file is asked about once as it stands, the fix a check makes is recorded rather than asked
  about again on the next turn, and a file already changed before the session began is left alone.
  `docs/research/one-line-that-finds-the-existing-function.md` holds the measurements.

### Fixed

- The added-lines diff `check` reads runs with `--no-ext-diff`, `--no-textconv`, `--no-color`, fixed
  `a/` and `b/` prefixes and a closing `--`. A diff driver or text conversion named in a repository's own
  git config is no longer run, and `diff.mnemonicPrefix`, `diff.dstPrefix`, `color.ui=always`, a
  tracked file named `HEAD`, a quoted file name or an added line starting with `++` no longer hide
  added lines.

## [0.7.0] - 2026-09-02

Thirteen findings of a deep-module audit, every one a fact with two owners or an interface nobody
read, closed as one owner each: the site shape both workers build, the paths a hook names, the
roster nouns the recount reads back, the guard bag every bridge reads, the checker's job, the
exported rim, and nine smaller ones. No count, claim or map moved: the check, the scan and a deep
scan of an oracle repository are byte identical across the two builds after every commit.

### Fixed

- The A/B harness threw `ReferenceError: label is not defined` on every run that
  reached its result document, after every trial had been paid for: two
  bindings had moved inside the `try` around the trials while the two lines
  that write the document stayed outside it. The harness now runs as one
  guarded `main`, and a guard in `test/modules.test.mjs` refuses a binding
  declared inside a block and read outside it, in every source file.
  `--min-headroom` refuses a value it cannot compare, which used to switch the
  floor off for the whole batch, and a repository with no `origin` no longer
  prints git's complaint about it.
- The harness probed an arm with the first `.rb`, `.ts`, `.tsx`, `.js` or `.jsx`
  file under the target area, a hand-kept list that missed every `.mjs`
  repository, this one included. It asks the corpus's own predicates now.
- The harness scrubs three engine-shaped variables build 2.1.257 reads:
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, and the served model catalog's switch and
  URL, `CLAUDE_CODE_MODEL_CATALOG` and `CLAUDE_CODE_MODEL_CATALOG_URL`, since
  that build installs the fetched catalog in place of the compiled model list
  rather than logging it. `docs/research/claude-code-2-1-257-engine-variables.md`
  holds the read.
- The session-start and standing-ultracode cases handed the hook the host's
  own `CLAUDE_*` and `ULTRACODE_ANYWHERE*` settings, so they failed on a
  machine running the plugin; `test/host-env.mjs` takes those out for every
  spawn.

### Changed

- The fields a site carries across the worker boundary are one table, `HIT_FIELDS` in
  `walk.mjs`, and both workers build their sites from it. A test reads every field the reducer
  takes off a site and holds it to the table (B36).
- The roster nouns the layout recount reads back are the renderer's own exports; the recount
  spells none (H41).
- One function in `scripts/validate.mjs` reads the paths a text names as
  `${CLAUDE_PLUGIN_ROOT}/...`, and the shipped-set gate and the hook test take theirs from it. A
  bare path ends at a subshell's parenthesis or a backtick in both gates now (A49).
- The Ruby hit's `node` and a call's argument list are built in `ruby-walk.mjs` and imported by
  both Ruby registries (C36).
- The check words the filename row's claim through `claimFor`, the row's owner, and holds no
  template rule of its own (C37).
- Each parse bridge and the checker read a guard bag through one rule, `guardsOver` in
  `limits.mjs`: a name the defaults do not carry is refused before anything is spawned, and a
  partial bag keeps the other defaults (B37).
- `parseRuby` no longer carries the `parsed`, `crashed` and `skipped` counters or the
  `onFile` streaming mode; the results are the record (B38).
- The checker's worker is a shell over `semantic-job.mjs`, whose `runJob` and
  `measureResolution` are reached in process by a namesake test (B39).
- Twenty-nine exported names nobody read outside their own file are private, and a guard holds
  every export to a reader (A50).
- The binary's verbs are one table, each carrying its own arm; a verb added to the table
  with no arm no longer falls through to a scan (A51).
- The corpus harness fails a run whose layout line it could not read the roots count
  off, exempting the truncation sentence, which both harnesses now read off
  `render-layout.mjs` rather than spelling for themselves (A52).
- The docs gate is a function, `checkDocs`, so importing a reader from it runs nothing
  (A53).
- A test holds the two ultracode hooks' silence to one answer over the three states that decide it
  (A54).
- The lock gate's npm argv is one exported list, read back through a stub npm: offline under
  `--check`, online for a write (B40).
- One callee reader in `dimensions-jsx.mjs`, answering a name or null (C38).
- The witness gate drives `RUBY_ERROR`, `FRAMEWORK` and `EFFECT_HOOKS` through their
  rows, with a control per table (C39).
- A tie that decides which name is rendered is broken by code point through one `byCode` in
  `paths.mjs`; `precedent.mjs` broke one by locale (H42).
- `repoAuthorCount` and `isPerson` live in `authors.mjs`, and `baseline.mjs` carries one
  docblock per entry point, naming all three (a move and a docblock, with no row of
  their own).
- The sites a branch introduced are decided in
  `plugins/anatomiya/lib/introduced.mjs`, a leaf the check alone imports:
  `newlyIntroduced` takes both revisions and the area and answers the sites
  with their identities, and `siteIdentity` and `bodyIdentity` spell the
  identity rule four other test files had pinned by comment. The check's output
  is byte for byte what it was.
- The harness's argument gate and result document live in `scripts/ab/args.mjs`
  and `scripts/ab/render.mjs`, and an arm's trials are summed in
  `scripts/ab/score.mjs`, so a test reaches each without spawning a run, and
  one case runs the whole harness from an empty repository with the model
  stubbed.
- `isCorpusPath` in `corpus.mjs` is the one spelling of whether a path is
  corpus, over the same rule list `collect` classifies by; the check, the
  notice and the harness's probe read it instead of composing the three
  predicates by hand.

## [0.6.0] - 2026-08-31

The glossary said eleven things the code does not do, and one of them reached a reader: an area file
printed "5589 of 5589 sites" for a number the word it used put at zero. Nothing had ever read that
file, which is how they got there.

### Fixed

- Eleven `CONTEXT.md` entries said something the code does not do. `Conforming` was
  the one that reached a reader: it read "a candidate matching the positive
  pattern" while a counter-stated slot prints the candidates matching the
  counter-claim, so an area file said "5589 of 5589 sites" for a number the
  glossary's own word put at 0. `Corpus`, `Uncovered`, `Stated`, `Counts`,
  `Exception`, `Drift`, `Staleness`, `Map`, `Finding` and `Newly introduced` were
  each narrower or wider than what they name. Seven words a reader meets and could
  not look up were added: `Root`, `Namesake test`, `Eligible files`, `Declined`,
  `Principle`, `Author` and `Notice`.
- Three sites called the whole hook payload an "event", which the glossary refuses
  by name, since the event is one field inside the payload.

### Changed

- The scan summary names the pin as the point drift is measured from and puts the
  base ref in parentheses, which is the spelling the check report already used. One
  number had two sentences.

### Added

- `npm run check:docs` reads `CONTEXT.md`. Every entry has to be whole, and
  `Unexamined` has to name every outcome the parser counts a file as, which the
  tally and the check now read off one list. Shape and one closed set only: whether
  an entry is still true is not mechanically checkable, and stays a reader's to
  hold.

## [0.5.0] - 2026-08-29

Every version since 0.3.0 installed with no parser in it, and both hooks could be
silenced for a whole session by a directory the payload never named.

### Fixed

- The plugin ships its own `package-lock.json`, so `/plugin install` installs its
  dependencies again. Claude Code does that itself: it reads the plugin root and
  runs `npm ci --ignore-scripts` there, at a 60 second cap, where a `package.json`
  and a lockfile sit together, and passes over a root holding the manifest alone
  with nothing logged. 0.3.0 moved the plugin out of the repository root and left
  the marketplace's lockfile behind, one directory up and invisible to the loader,
  so every version from then on needed `/anatomiya:setup` before it could read a
  line of JavaScript. On a repository holding none, nothing ever said so.
- A hook answers a payload larger than the megabyte it reads, and one with
  anything after the closing brace. `JSON.parse` reads a document or nothing, so a
  complete payload followed by one stray byte answered the same as no payload at
  all. Where it refuses, the members that can still be read are taken from the
  text: string members, at the top level and inside `tool_input`, whole, and short
  enough to be a path rather than a file's contents. A `Write` of a generated file
  and a `Read` of a minified bundle both used to cost the turn its map over four
  short fields sitting in the first hundred bytes.
- A hook whose own directory has been removed answers off the payload instead of
  going quiet. `process.cwd()` refuses once that directory is unlinked, which
  `git worktree remove` does to a session sitting in one, and it was read before
  the payload, so the throw reached the guard that answers the empty object. Every
  hook is a fresh process, so the map never came back for the rest of that session
  while every payload was still naming live paths.
- `doctor` leads with one line where nothing is installed anywhere above the
  plugin, rather than naming the engines that are absent for that one reason. An
  install that ran and stopped short is left to the rows, which say which engine
  is missing, and so is a checkout whose packages are hoisted to a directory
  above: asked only about the one beside the manifest, this told a contributor
  nothing was installed and pointed at a place that will never hold it.
- `doctor` and `setup` no longer ask where the process is. They answer about this
  installation and take no path, so a directory removed under them decided
  nothing they say, and they failed on it anyway. The verbs that do walk a tree
  now say what happened and what to do about it instead of failing inside a git
  call. They cannot name the directory: it is the one thing that can no longer
  be read.
- The A/B harness rules on `CLAUDE_CODE_MODEL_CATALOG`, which Claude Code 2.1.251
  added. It is an off switch for a catalog that is compared against the model and
  window the CLI already resolved and then logged, never applied, so it cannot
  make two arms run different engines and it is left alone. The gate that reads
  the build for engine-shaped names had been failing on it.

### Added

- `npm run lock:plugin` builds the plugin's lockfile from the marketplace's own
  resolutions rather than resolving afresh, and `npm run validate` refuses one
  that differs, one that is missing where dependencies are declared, one whose
  lockfile is a kind the install will not read, and any package the two lockfiles
  resolve differently. Two lockfiles for one dependency set drift the moment npm
  resolves a range to something newer, and then the suite is green against a
  parser nobody running the plugin has.
- A CI leg copies the tracked plugin files, runs the loader's own install command
  on them and asks `doctor` what answered. Nothing else here would notice: every
  other job installs from the marketplace root's lockfile.
- Both plugins' copies of the payload reader are held together character for
  character, as well as by the answers they give. The behavioural case can only
  catch a drift some payload in its list reaches, and three got past it while it
  was the only one: a whitespace character added to one copy, a bound moved, and
  a scan stepping by two.

## [0.4.2] - 2026-08-29

Both hooks answered from where the shell happened to be rather than from what the
call was about, so two checkouts sitting side by side served each other's map.

### Fixed

- A hook answers from the repository the tool call is about. Resolving by walking
  up from the working directory is right going up and blind sideways: the walk
  stops at the first map it finds, and the boundary that would have caught this
  sits under the other checkout, which the walk never visits. Two checkouts under
  one parent handed each other's roster and directives to the agent, under the
  line saying they were counted from this repository's own code. The write-time
  notice was the sharper half, since it was holding the full path already and
  measured it as outside whichever root the shell had landed in, so it said
  nothing at all about a write it had located. Decision H40, issue #123.
- Five tools name a place and all five are read: `Read`, `Write` and `Edit` under
  `file_path`, `NotebookEdit` under `notebook_path`, `Glob` and `Grep` under
  `path`, which on those two is a directory rather than a file. One walk covers
  the three shapes: a file answers with its parent, a directory with itself, and
  a path a write is inventing with the nearest ancestor that exists. Taking the
  parent of a directory would have been the same bug again, since a `Glob` at a
  repository root would then answer from the directory holding every checkout.
- A call naming a file in no checkout at all leaves the session's own map standing rather than
  blanking it. Reading a system file, a dependency or another project's source is ordinary, and
  answering nothing there takes the map off a turn that had one before. A call that does have a
  checkout is answered by that checkout even when the answer is silence, so a nested repository with
  no map, and one whose map is empty, are not handed the enclosing checkout's counts.
- A path longer than any filesystem can hold names no place and is refused before the walk. The walk
  costs a stat and a copy per segment, and a payload inside the megabyte a hook reads held 400,000 of
  them and took 7.8 seconds against the 5 its declaration asks for, so the turn lost its map and a
  process burnt the budget, before every tool call.
- The working directory a hook falls back to is the one the payload carries, not
  the one its own process was started in. Measured on 2.1.251, that field follows
  the agent: one `cd` in a shell call moves it for every payload after, and
  nothing tells the hook. A path spelled relative is read against that same
  directory, because the tool read it against that one and nothing normalises the
  input on the way here.

## [0.4.1] - 2026-08-29

Two reads that decided whether a finding printed, both answering a question they
had not been able to ask.

### Fixed

- A directory nobody can list is no longer read as a directory holding no test.
  `readdir` failing answered no, so a `spec/mailers` at mode 111 was reported as
  holding no other test with a sibling spec in it the whole time. Only a
  directory that is not there answers no now; anything else answers that it does
  hold one, which is the direction C33 settled.
- The same question is answered from what git tracks rather than off the disk,
  which is the population every other reader here counts. One ignored
  `scratch_spec.rb` in a directory read as a test habit and silenced the rule
  for every file in it: four findings became none. A listing that fails answers
  the same way an unreadable directory does. The write-time notice still reads
  the directory, since a `git ls-files` per write is a subprocess per write, so
  it is the quieter of the two where a stray file sits there and the check
  catches what it let past.

## [0.4.0] - 2026-08-29

Every rule until now asked whether a file's contents matched its directory's claims, which a file that
creates its own directory answers with itself: it is the only member, it conforms, every time. So the
one case guaranteed to pass was the one where a convention was most likely broken. `check` now asks
the prior question, whether a test the change added belongs where it was put, and a second hook asks
it before the file is written rather than after. The map says which way that goes when a testing rule
says otherwise. Asked of every test file that already exists in 35 repositories, on the reasoning that
a mature repository put them where it meant to, the rule finds two.

The measurement harness ran at one model and whatever effort the machine happened to be set to, and
recorded the model alone. It now runs at one named engine, `claude-opus-5[1m]` at `medium`, states
both on the command line, takes the variables and the one settings rung that outrank those
flags out of the way, and reads the answer back so the record is the engine that served the batch
rather than the one it asked for. The `ultracode-anywhere` reminder stops asking for a second effort
on some workflow stages. Measurements taken before this release name no effort and no window, so they
do not merge with ones taken after it.

### Fixed

- `test/session-start.test.mjs` no longer reads the machine's installed Claude Code. Its second half
  rewrote the fixture build without truncating it back to a bundle's size, so the file stopped being a
  candidate, the walk fell through to the real `claude`, and the case passed only while that build sat
  inside the calibrated run of patches. It went red on 2.1.251 having never tested what it claimed.
- Every measurement trial now names its effort as well as its model, and both are recorded. The
  harness said each setting was fixed rather than inherited and named only the model, so the effort
  came from whatever the machine was set to. Claude Code 2.1.250 reads `CLAUDE_CODE_EFFORT_LEVEL`
  ahead of the session's own effort and says so in its own words, "CLAUDE_CODE_EFFORT_LEVEL overrides
  effort for this session", and more variables move the model, the thinking budget or the
  context window the same way. Decision G11.
- A held measurement no longer accumulates with a batch run at another effort. The guard read the
  model alone, so a medium batch and an xhigh batch summed into one tally claiming 60 samples of a
  run that never happened. An entry from before the effort was recorded carries none, and that
  absence matches no batch that names one; `--force` replaces it with one that says. A refusal prints
  which half of the engine it disagreed on, since the trials are paid for by the time it fires,
  grouped by the engine in the way rather than one line per key. The model string moved as well,
  from `claude-opus-5` to `claude-opus-5[1m]`, so all 24 measured rows in the shipped table refuse on
  both halves and keep the older engine's answer until somebody re-measures them with `--force`.
  Decision G11.
- `scripts/measure-defaults.mjs` reads the table it is about to write before it spends a trial. An
  `--out` naming a file it could not read spent every call in the batch and then died on the open.
- A run served by a model it did not ask for records both: the substitute under `model`, and what was
  asked for under `asked`, so the table and the result file carry it rather than the console alone.
- `--tasks` naming no task it knows is refused by name. It ran zero trials and then reported "no
  parseable output was produced", which names a cause that never happened.
- A refusal between building the arms and removing them no longer leaves two worktrees registered in
  the repository under measurement. `die` exits the process, and an exit skips the `finally` that
  removes them, so those refusals throw instead.
- `scripts/measure-defaults.mjs` refuses a flag left without its value. `--effort` standing last in
  argv read as no value at all, the pinned level filled in for it, and the batch ran at a level
  nobody asked for; `--tasks` in the same place threw on `undefined.split`.

### Added

- `check` asks whether a file the change added belongs where it was put, not only whether its contents
  match. Every other rule asks the second question, so a file that creates its own directory is the
  only member of it and conforms with itself: `spec/mailers/cim_share_mailer_spec.rb`, in a repository
  whose four mailers have no specs, was examined and produced nothing. A test added where the source
  root it covers has three or more producers and none of them with a namesake test, and whose own
  directory holds no other test, is a FIX, dropping to NIT only where no comparison against a base
  could be made. That last condition is the nearest evidence there is, and what "already" means
  differs between the two callers: nothing the write-time notice can see came from the write it is
  about, so it excludes only the target, while a check excludes everything the same change brought,
  or three of four specs landing in one invented directory are excused by the first. A test relocated into such a directory
  counts as one arriving there, read off the path its base version comes from rather than off the
  status letter, which spells one move two ways: `R` from the diff and `M` with an `orig` from a
  working tree where the move is staged and not yet committed, which is the state a run before the
  commit is asked in. Four guards keep it quiet where the counts cannot carry a verdict: a repository
  that pairs no tests anywhere, a source root holding three or more tests of its own, a root recorded
  for the files at one level whose record says nothing about its subtree, and a path tail more than one
  root answers to where any of them is already paired. A test file is held to a source extension as
  well as to its name, so a `.snap`, a `.sql` and a `tsconfig.test.json` are not tests. Asked of every
  existing test file in all 35 corpus repositories, on the reasoning that a mature repository put them
  where it meant to, the rule finds 2, both in the repository it was written for. The finding names
  the tests a directory does hold rather than the ratio alone, and says what was counted, "Nothing here
  was matched to a test by name", rather than a conclusion the count cannot carry. Decision H38,
  issue #120.
- A second hook, on `PreToolUse` for `Write`, `Edit` and `NotebookEdit`, answering for the one path that
  call is about: whether a test is going where its kind of file has no test precedent. Silent on every
  other write, which is nearly all of them. The claims used to arrive only after the file existed, and an
  area's own file loads only when something in that area is read, so the directory nobody read said
  nothing at the moment its path was chosen. It informs and never refuses: `deny` and `ask` are the only
  answers that stop a path being chosen, and the rule behind the notice rests on a namesake match that
  can read a tested directory as untested. It answers only for a path nothing is at yet, since an
  `Edit` names a file that exists every time and repeating the block on each edit of the same spec is
  the unchanged banner it exists instead of. Decision A44, issue #119.
- The map states which way the conflict goes, where a directory has producers and no tests: "An
  instruction to always write a test does not override a directory with no test precedent." A count and
  an imperative read in the same voice, and the imperative wins unless the map says otherwise.
  Decision H39.
- The precedent finding names the tests a directory does hold, not only the ratio. `0 of 1003 have a
  namesake test` never spoke about `__tests__/helper.test.ts`, because that is not a namesake, so it
  forbade nothing; it now reads `0 with a namesake test; 2 vitest specs under __tests__, none of them
  a namesake`. A directory holding three or more such tests has a habit and is left alone. Decision
  H38.
- Every trial asks for `--output-format json` and reads `modelUsage` back, so provenance and the A/B
  result file carry the model that served the batch and the context window it got, rather than the
  flags that asked for them. Nothing else can confirm the 1M half: the `[1m]` suffix never reaches the
  wire, it becomes the `context-1m-2025-08-07` beta header. Trials reporting two engines are refused
  rather than written up as one, and a batch that reported none records the request and says so.
- `CLAUDE_CODE_NO_MODEL_FALLBACK` is set for every trial. The build substitutes another model when the
  chosen one is refused, in its own words "model substitution is disabled" when this is set, so
  without it a trial could answer from a substitute and be recorded under the pinned name.
- A run refuses to start when a settings `env` entry names one of them. No environment scrub
  reaches a settings file, since the child reads its own after it starts, and `settings.env` is the
  one rung above the flags a trial passes: measured on 2.1.250, `--effort` beats `ultracode: true`,
  `modelSettings` and `effortLevel`. The machine this was written on carries `effortLevel: "medium"`
  beside `modelSettings["claude-opus-5"].effortLevel: "xhigh"`, which is what the old harness ran at,
  since it passed no effort at all.
- Both settings files are taken out of each arm. `settings.env` sits above the CLI flag, and an arm is
  a worktree of the repository under measurement, so a checked-in settings file naming
  `CLAUDE_CODE_EFFORT_LEVEL` chose the engine that measured it. `--setting-sources ''` is not the
  answer: measured on 2.1.250, it removes the map as well.
- `--effort` on `scripts/ab.mjs` and `scripts/measure-defaults.mjs`, refused at the door for a level
  the CLI does not take rather than 30 trials in. The A/B result file gains an effort row, rendered
  from the engine that ran rather than from the argument that asked for it.
- A test that reads the installed Claude Code for every environment variable shaped like a model, an
  effort or a thinking budget, and fails on one the scrub list has not ruled on. The list is written
  against one build and the build gains variables every release; left alone it becomes a guess while
  every row still says medium. Names deliberately kept are listed with their reason.
- A test that reads the installed Claude Code for the model id and the effort vocabulary the harness
  pins, and skips where no build is installed. A pinned model id outlives no release on its own; the
  CLI refuses an unknown one at the first trial, and this says it at `npm test` instead.

## [0.3.3] - 2026-08-24

Eight defects: the six on the tracker, all found by reading maps this tool had already written and
counting what they claimed against what the repositories hold, and two more the review rounds found
in the fixes for them. Three are a sentence saying more than it counted; three are a test file
credited to a file it does not cover; one is a name charged with violating the convention it already
carries; and one is the tool trusting a git history that was only a window. The facts record moves to
schema 18, and every map is regenerated on the next scan, so counts from before this release and
after it are not comparable line for line.

### Fixed

- The line that says what did not print carries a clause per population instead of one number. It
  counted the folded directories and then printed their files plus every file under no directory at
  all, so this repository's own map read `and 1 more directory holding 21 files` over a folded root
  holding 3, and a Rails map charged 164 files in `config`, `lib/tasks/archived` and 25 other
  directories to `public` and `app/views`. The repository root is named apart from the directories
  under the floor, because it never took the floor test and holds 17 of that map's 164. Decision H32.
- A runner group says how many of itself sit under the directory the vote named. The vote needs only
  a strict majority, so `8 RSpec specs under admin` named 5 of the 8; five of the ten such clauses
  across two maps were wrong this way, the worst at 6 of 11. The tests line has printed the honest
  pair since 0.2.x and the sibling clause never did. Decision H33.
- A declared type name opening on three or more capitals votes for neither a prefix nor none, and is
  a site of neither prefix row. `IEFLogon` is `I` on the `EFLogon` in the directory of the same name
  and was charged with violating the `I` prefix it carries, so the only way to comply was to write
  `IIEFLogon`; in an area stating the row at N of N, `IAPIResponse` reached MUST-FIX while
  `IApiResponse` beside it conformed. The same miscount named two files with no violations in them as
  the area's exceptions, which waved through anything added to either. Decision C35.
- A shallow clone can no longer move the author gate. `git log` answers on one and its answer is true
  about a window nobody chose: at `--depth=1`, which is what `actions/checkout` does by default, every
  slot read one author, the bar collapsed to one and the map stated 484 claims where the full clone
  states 465, then told the reader a fifteen-author repository has one author. At `--depth=503` the
  same repository lost 82 conventions and gained none. Nothing on any surface said the clone was
  shallow. The bar now holds at two, both surfaces say the history was truncated, and a depth-1
  checkout prints every claim as a count. How much of the window there is goes to the terminal
  alone: the overview owes byte-stability between scans of unchanged source, and a fixed-depth
  boundary slides forward with every commit that lands upstream. Decision D11.
- The empty-tail mirror is asked in both directions. `app/mcp` is a Rails autoload root, so stripping
  the tree words left `mcp/mcp` against `mcp` and every file sitting directly there read untested:
  `0 of 13`, `0 of 11`, `0 of 8` where the specs exist and describe the right constants. Measured
  over the whole corpus, 6,849 areas of which 4,886 carry a companion count: 24 gain on this row's
  own account, every one hand-verified, and none drops. Decision H34.
- A Ruby file named `_spec.rb` or `_test.rb` is a test only where a test tree above it agrees. A
  RuboCop cop named for the `Rails.env.test?` guard it enforces printed a test group of its own in
  the file that loads every turn, telling a reader to mirror a shape the repository does not have.
  The dotted and hyphen forms still answer on the name alone. Decision H35.
- The scan summary spells a runner, its unit and its count the way every other surface does. It read
  `1 test files under lib/rubocop/custom_cops` beside `1 test file` in the file it summarises, and
  `1369 rspec` where the map said `1368 of 1369 RSpec specs`. Decision H36.
- A test file is evidence about a source file only where the two run on one engine. The rule was
  written on one branch, the bare-basename pair at the top of two trees, and every other path to a
  match went without it. mastodon keeps a `spec/models` of Ruby specs beside a `spec/javascript` of
  TypeScript tests and a model of each name in both, so the mirror credited each with the other's
  files. Six areas across the corpus were carrying such a credit and none is left: discourse charged
  four directories of `.gjs` components to Ruby system specs, one of them naming
  `plugins/chat/spec/system` as the place its JavaScript is tested. Found by the corpus, not by a
  test: the suite was green on both directions of it. Decision H37.

### Changed

- The facts record is schema 18. `layout.more` keeps its three populations apart, and the record
  carries `authors` at all for the first time, with what the clone holds: the gates have always read
  it and nothing on disk held it, so no reader could ask why a claim printed as a count.

## [0.3.2] - 2026-08-24

The map already said what a repository does and told the agent to go and look. It never told the
agent to follow what it found. A third fixed sentence on the overview head says so, and says to
finish the change instead of handing back a suggestion. It costs one line: on a repository already at
the bound, one area name moves out of the listing and into the trailer.

### Added

- A third fixed sentence on the overview head: when a change is asked for, follow what this
  repository already does and carry it through instead of stopping at a suggestion. The counts
  state the practice, and nothing until now told the agent to follow it and finish. Sources in
  `docs/research/one-line-that-finishes-in-house-style.md`; decision A42.

### Changed

- The documented cost of the echoed map reads roughly 500 tokens per turn and per tool call, and
  about 150,000 over a 300-call session. The head grew by a sentence; the figure moved by arithmetic
  off that, not by a second count.

## [0.3.1] - 2026-08-24

A stated claim now says how many of its own sites it could not vote on, where there are any. The
filename row is the one place the two halves of the tool disagree by construction: the scan votes
with a stem's class and the check enforces over the site, so a stem spelling none of the four
classes left the printed population while a new file there was still measured against the sentence.
Found on a Rails map of 159 areas, where it was the only disagreement to survive a re-count of every
stated claim. Nothing was miscounted, which is why the fix carries a number rather than correcting
one, and the number sits on the counts line so no area trades a convention for it.

### Added

- A stated filename claim now says how many names its own classifier held no vote for, where there
  are any: `1525 of 1525 sites across 1525 of 1532 files, 3 names spelling no class, 6 authors`. The
  row votes with a stem's
  class and the check enforces over the site, so a stem spelling none of the four leaves the printed
  population while a new file is still measured against the sentence. Found on a Rails map of 159
  areas, where `db/migrate` printed `1525 of 1525 sites across 1525 of 1532 files` over three
  double-underscore migrations, and the seven-file gap could not say which of those were sites at
  all. It was the only disagreement to survive a re-count of every stated claim in that map. The
  count sits on the counts line rather than on one of its own, so the 135 areas with nothing to
  disclose say nothing and no area trades a directive for it: on vscode the separate line pushed a
  stated convention out of an area at the forty-line bound, which also capped that slot at FIX in
  the check. It needs no perfect claim either, since a declined site never reaches the `except`
  list (#109, A41). One area the count cannot reach:
  a directory where every naming site is declined states no claim at all, so there is no block to
  hang it on, while the check still measures a new file there against an ancestor's sentence.

  The record moves to schema 17 to carry the count. An older record still reads; a build before this
  one reading a schema-17 record says so and enforces nothing from it, so scan again after upgrading.

### Fixed

- Measurements of the installed Claude Code build had gone stale in the contract while
  `ultracode-anywhere` was re-calibrated: the bundle is 325 MB rather than 321, the scan of it takes
  about 200 ms rather than 170, and the gate's shape has now held across a fourth build.
- The release checklist asked whether `VERIFYING.md` names a build, which a test now answers. What
  it cannot answer, and the checklist now says, is whether anybody re-read one, and it names the
  three places that carry a build with no case reading them.
- A case that reads a number back out of a README failed on a rewrapped paragraph, since it matched
  the spaces rather than the words. Prose gets rewrapped; a sentence that moved across a line break
  is not a number that changed.

## [0.3.0] - 2026-08-23

The marketplace holds two plugins, and this is the release that says so in the places that decide
what ships and what is released. Each plugin now has its own tag, its own changelog and its own
coverage floor; the shipped set is stated and checked rather than inferred from the tree; and the
one contract the two plugins share is held by a test that runs both of them as processes rather
than by a copy of the code.

### Fixed


- A hook whose reader went away mid-write exited 1. The write raises EPIPE on the stream rather than
  from the call, so the guard at the boundary never saw it and node turned it into an uncaught
  exception: five runs out of five, on every turn and every tool call for the life of that session.
- A gate reached through an absolute path holding a symlink ran everything and said nothing. The
  guard compared `import.meta.url`, which is always resolved, against `process.argv[1]`, which is
  whatever the caller typed. It was found and fixed twice before and left standing in seven scripts,
  one of which writes to `plugins/anatomiya/lib/model-defaults.json` when it is imported unguarded.
- The manifest check let a plugin's whole hook declaration vanish without a word: the hook check
  returns without a problem when the file it was going to read is not there. A listed plugin now has
  to install something, whether that is hooks, commands, agents, skills or an MCP server.
- `package.json` `files` omitted `hooks/`, which is where the loader looks for the hooks this plugin
  installs, and its `.claude-plugin/` entry shipped `marketplace.json` along with the manifest, which
  belongs to the marketplace rather than to the plugin. Nothing read the list, so neither error could
  surface.
- The shipped-set gate exempted every one of its own starting points from the check it exists for.
  The exemption had been written for the two files that have a check of their own, and widening the
  starting points from those two to all five loadable kinds carried it along: `files` could drop
  `commands/` whole and the gate still printed success. It also read each kind only where the
  convention puts it, so a manifest pointing one somewhere else left those files unread.
- anatomiya could declare `{"hooks": {}}` and pass. What was required was the file, and a file
  is not a hook; the root is also the one plugin skipped by the check that asks whether a plugin
  installs anything, so nothing else was left to notice.
- The coverage job's summary was empty on exactly the runs it exists for: the scope lines printed on
  the way out of a clean run only, and the job picked them out of the run's own output by a pattern,
  which any line a test printed could forge and which left every per-file shortfall out. The script
  writes the summary to a file the job asks for and prints.
- `scripts/coverage.mjs` runs a suite of its own, and node marks its runner's children in the
  environment, so a run started from inside a suite had its reporters overridden and wrote no
  record at all.
- `check-docs` said the same missing changelog twice, in two wordings, one of which printed the
  file's path twice on one line.
- A mistyped option was taken as the value of the one before it, so `--notes --notes-file x.md`
  wrote the notes to a file named `--notes-file` and the release step read the empty one it meant.
- A path written into a command file's prose ran to the full stop, and the stop was read as part of
  the filename, so the gate reported a file the plugin has as one it does not.
- A fifo at `.claude/settings.local.json` held `anatomiya scan` for ever with nothing printed. The
  read typed nothing and bounded nothing, in the module whose own docstring states the opposite rule
  and whose `readHead` implements it. That path is also what every scan reads, so a large file at it
  was the cost of every scan.
- The release workflow's copy of the suite step could go green having run no test at all: `ci` refuses
  an empty file list and this one, the workflow whose result cannot be taken back, did not. It also
  had no `timeout-minutes`, so a hanging test would have held the runner for six hours.
- The two plugins answered differently for one payload: past the megabyte cap, anatomiya threw the
  whole thing away and the second plugin kept the capped prefix. A whole payload followed by padding
  cost that turn its map on one side and not the other. Both keep the prefix now, and the contract
  test holds them to one answer. The second plugin's own half of that is in its own changelog, which
  is what its tag ships.
- A command file that is a symlink was walked by neither branch of the directory walk, and npm drops
  one from the tarball too, so it went unshipped and unreported at once.
- A `.DS_Store` in a command directory was read as a thing the plugin loads, which turned every macOS
  checkout red.
- The shipped-set gate took a typed option as the directory to scan, and reported the resulting spawn
  failure as npm not being installed.
- `--summary -x` was taken as a path and wrote a dash-named file; the guard knew two dashes.
- `--notes` given twice silently dropped the first path, and a notes path that could not be written
  printed a stack trace.
- The manifest gate refused a plugin that moves its hook declaration for a file it does not need, and
  left the hooks it does declare unchecked.
- `check-docs` read four documents unguarded, so a missing README died on a stack 44 lines before the
  check that would have named it, and took this module's own test file down with it at load.

- The release resolver read the marketplace root's version whenever the lockfile carried no entry
  for the plugin being released. Both directions were wrong: a tag went out against a lockfile that
  says nothing about that plugin, and a correct release was refused as soon as the root's version
  and the plugin's had drifted apart. Only the member's entry is read now, and a lockfile with no
  entry for the plugin says nothing rather than lending it a version, which includes an entry that
  is present and is not an object, where the read threw a stack after the tag was pushed.
- A path a manifest names was checked only where it was spelled with a leading `./`. The loader
  resolves `hooks/hooks.json` and `./hooks/hooks.json` alike, so the same missing file passed under
  one spelling and failed under the other, and a plugin whose only declaration was the bare spelling
  installed as nothing with every gate green.
- Only the first hook declaration a manifest lists was read. The loader merges them, so a second
  file's hooks were never checked at all, and a declaration pointing out of the plugin was read and
  reported on as though it were that plugin's, naming a path outside the plugin root.
- A plugin with no `package.json` could carry `.claude-plugin/marketplace.json`. That check read the
  `files` list, and the plugin that has no list is the one that ships its directory whole, so the
  file that belongs to the marketplace went with it and nothing said so.
- The shipped-set gate walked whatever a marketplace source pointed at, including a directory
  outside the marketplace. `validate.mjs` reports the source itself, so what this added was a second
  report about a tree that is nobody's plugin.
- `scripts/ab.mjs` could not run past its argument gate: the move replaced its path constant with
  `BINARY` and never imported it. Nothing caught it, because the usage line three statements earlier
  is what every run of it reached.
- A note written while reading an installed build carried this machine's home directory into the
  repository nine times. The net under the generated measurements has caught that since the first
  A/B result, and it looks only there, so a hand-written document walked straight past it. Every
  committed document is now checked, for this machine's own home rather than for the shape of a home
  directory, since a hand-written one may spell a placeholder and the README's `/Users/me/code/app`
  is how the output is shown to a reader.
- `--notes -x` wrote the release notes to a file named `-x` and exited 0, so the workflow step that
  reads them found nothing after the tag was already pushed. The guard knew two dashes; the sibling
  gate in `coverage.mjs` refuses one and its comment states this as the reason it does.
- The two plugins' readers answered differently for a payload of exactly the cap: the second cut a
  character off a string nothing had split. No pipe can deliver the input that separates them, since
  a lone surrogate is not UTF-8, so this is the copies agreeing rather than a payload that behaved
  differently.
- `docs/plugin-contract.md` closed with a section describing the repository as it was before the move
  it argued for, including a claim with teeth: that a lockfile sits at the plugin root, so Claude
  Code installs the parser automatically. It does not, and four other documents said so correctly.
  The measured facts are kept and put in the tense they belong to.
- The two plugins' changelogs each hold their own plugin's entries. Three fixes inside
  `plugins/ultracode-anywhere/` were written into anatomiya's, where no `ultracode-anywhere-v` tag
  will ever read them.
- The build contract said the plugin root is the repository root in one row and that neither plugin
  sits there in another, both in the same release; the glossary entry added with them said the first.
  The rule in that row outlived its premise and now says so.
- The release checklist told a releaser to move two lockfile versions "and both are read". Neither is:
  the entry that decides a release is the plugin's own, under its workspace path.
- Windows took a typed option as a plugin root and exited 0. The refusal that says npm cannot be
  spawned there ran before the argument check, so `--help` was refused on every platform but the one
  that answered it silently. A typo is a typo everywhere, and it is read first now.
- A tag pattern's placeholder was substituted with a replace that takes the first star of however
  many there are, while the resolver reads the last one as the boundary. With one star per pattern
  the two agreed by luck; a pattern carrying two would have been filled in one place and matched
  from another. The shape is a rule now, refused where it is read, and pinned.
### Fixed in the tests themselves


The tests are the thing that says any of the above is true, so a defect in one is a defect. A round
aimed only at them found these.

- Two cases could hang their whole file with nothing printed: `node --test` has no per-case timeout,
  and a blocking synchronous read stops the event loop before the reporter flushes, so the passing
  cases go with it. Every spawn that could wait now carries a bound, at both levels of the nested
  runner `scripts/coverage.mjs` drives.
- A case asserting that path steps are resolved handed the function under test the same string twice:
  `join` collapses `sub/../..` before the call. Spelled as text, the steps reach the function.
- A case checking that a path reaches TypeScript without backslashes used the function under test as
  its own oracle, and on POSIX that function is the identity.
- A fixture wrote a sibling of its plugin into the shared temp root under a fixed name, where it
  survived every run and two concurrent runs collided on it.
- A case picked which message to expect by reading the constant it was checking.
- The seam check between the two plugins looked up `lib/` in a list that spells it `lib`, so it read
  no file at all, and its own guard measured the list being non-empty rather than the loop having a
  body.
- Nine release cases spawned the command with no working directory of their own. A regression in that
  module writes a file, and one already had: a file literally named `--notes-file` in the repository
  root, from the case whose purpose is to prove that cannot happen.
- The tag resolver's ordering had no test and none was possible: the table it read was fixed and no
  two of its patterns overlap. It takes the table as an argument now, so a case can build the overlap,
  and what is pinned is the property that makes resolution safe rather than the line written to
  enforce it.
- A kind the manifest named as an empty list dropped the conventional path with it, and the whole
  kind went unwalked. `validate.mjs` reads the same value as naming nothing, so two gates gave one
  manifest key opposite answers.
- The shipped-set walk read files outside the plugin. Everything it reached was held to the root and
  the starting points were not, so a manifest naming `../` had it reading whatever sits beside the
  plugin; naming `.` made every file in the repository a starting point, `.git` included.
- A manifest that would not parse turned the gate back to the conventional paths in silence, which
  is silence about every kind it moved.
- A manifest that moves the hook declaration left the gate naming a leftover file as the one the
  loader reads.
- anatomiya's own changelog going missing threw a stack trace 200 lines before the sentence
  that names it, because the guard added for the plugin beside it covered half the table.
- A plugin with a missing changelog and a missing version was told about the changelog only.
- A released heading that lost its brackets passed, leaving the link definition under it dangling.
- A version that is a string but not a version reached the tag resolver, and the reader was told a
  tag namespace was unclaimed while the fault was a field in another file.
- The coverage summary reported a scope holding no files as 100% of everything, at the top of the
  report for a run whose own shortfall two lines down said nothing had been measured.

- The rule that keeps a plugin path spelled in one module missed the two spellings anyone would
  write: `"./plugins/anatomiya"`, and the path handed to `join` a segment at a time. Its comment
  stripper was the other half, deleting from a regular expression holding `//` to the end of the
  file, so the rule read an empty file and stated that nothing was wrong with it. Both now go
  through one scanner that tells a regular expression from a comment and a template's code from its
  text, and that scanner is driven directly by a case of its own.
- The release fixtures built a lockfile with no member entry, which is not the shape the repository
  has, and a case asserted the fallback that shape needed. The fixture carries the member now, and
  the fallback is gone with it.
- A case that skipped for a reason the run could have chosen otherwise reported nothing: under a
  temp directory too long for the socket one fixture binds, the suite was green with that case
  never run. A guard the platform refuses still skips, since the case can never run there, but one
  this run's own configuration refuses now fails and says what to set.
- `test/check-docs.test.mjs` asked git for the repository's own files at module scope with no guard,
  so in a tree that is not a checkout the file died at import and 25 of its 33 cases stopped running
  with nothing said. The module it tests answers that same question with `[]` on purpose. The three
  cases that need a checkout now skip and say why, and the other 31 run.
- The gate's list of the documents it reads unguarded was four short of the reads below it, while
  its own docstring said it was every one. A missing `SECURITY.md` or `docs/measurements/` answered
  with a stack rather than the sentence naming the file.
- The rule that lets a changelog keep the paths its releases had was anchored at the repository
  root, so the second plugin's changelog was held to today's tree instead.
- The document sweep went quiet on the tree that most needs it. A tail matching two files was passed
  over so the spelling both plugins share would not be rewritten to one of them, and a copy of the
  repository sitting inside it, a worktree git has stopped tracking or an unpacked archive, gives
  every moved path a second match: the whole check switched itself off with nothing said. Only the
  two the plugins genuinely share are quiet now, and any other tail matching twice is named with the
  files it matched.
- Four fixtures were rewritten by a path sweep into paths this repository has, and each stopped
  testing what its name says while staying green: a module specifier in a synthetic corpus that made
  one importer two, a `bin` on a fixture PATH, a scanned repository's own source directory, and a
  comment about NodeNext resolution. The rule that invited it now says what it cannot see, which is a
  string routed through the constant that was never a path of ours.
- The case for the gate reaching no registry asserted on the list the module exports and not on what
  npm was handed, so a call site spelling its own argv passed it. A stub npm records what it gets.
- A case measured the hook's answer against the timeout the race it was inside had already capped,
  so nothing could fail it: the read could be raised to 4.8 of the 5 seconds declared and stay green.
  The two numbers are held to each other now, each read from where it lives.
- The one case named for Windows ran the success path everywhere else and asserted that, so the whole
  refusal branch could go with it green. It is guarded to the platform the refusal happens on.
- A case asserting a dangling link definition carried the inverse of its own message.
- Three documents in this change disagreed about the timeout a hook with no declaration gets: ten
  minutes for a command hook, thirty seconds where `UserPromptSubmit` lowers it, and neither of the
  two that said a minute. That is read off the binary in `docs/plugin-contract.md`.
- The `[Unreleased]` section carried two `### Changed` headings, which the release body would have
  shipped twice, and three disagreeing counts of how many files the move touched. A count nothing
  checks is a count that drifts; the fact that one module holds the path is what is said instead.
- Eight cases spawned the real release command with the previous version spelled into them. Seven
  refuse at the argument gate and passed whatever the manifests said; the eighth reads them, and it
  went red on the release this list is meant to be worked before. The tag is read off the plugin's
  own manifest now, and a rule refuses any test that spells the version this repository carries: a
  fixture that happens to match it passes for a reason that is about to change.
- Three rules compared a path built with the host's separator against one spelled with slashes, so on
  Windows the module allowed to hold the plugin path was reported as breaking its own rule, the
  filter for what the plugin ships matched nothing, and a changelog case matched no message. The
  listing answers in slashes on every platform now.
- A case matching the workflow file anchored on a bare newline, and a checkout that converts them
  made the whole match fail, which the case reported as the job no longer running the script.
- Two coverage cases built a module specifier out of a filesystem path. A path is a specifier only
  where it starts with a slash, so on Windows `D:\a\...` was read as a package name, the throwaway
  suite failed to load, and the run reported nothing about any scope. They import a `file://` URL
  now, and a run that says nothing about its scopes quotes whichever handle it said why on.
### Changed


- Neither plugin sits at the repository root any more. The root is the marketplace and the tooling;
  each plugin is a directory under `plugins/` with its own manifest and its own package, and the
  marketplace names it there. A `source` of `"./"` copies the whole repository into the plugin
  cache: on one machine that install held `test/`, `docs/`, `node_modules/`, 370 KB of markdown and
  a complete copy of the other plugin, so installing both left the second one there twice.
- The gates lost their special case with it. `scripts/validate.mjs` had three tests for "is this the
  plugin at the root" and a root-only requirement; all of them are gone, both plugins are read by
  one path, and the plugin whose hooks are required is named on the marketplace rather than inferred
  from where it sits. `scripts/shipped.mjs` answers for every plugin the marketplace lists.
- Where a plugin lives is written once, in `scripts/plugins.mjs`, which the suite and the gates both
  read. It was spelled by hand in file after file, and the move had to find every one; the rule in
  `test/modules.test.mjs` is what keeps it to one place now.
- The plugins are npm workspaces, so one install at the marketplace root serves both the suite and
  the plugin's own code. `/anatomiya:setup` is still what installs a plugin somebody has installed,
  which is what the README has always said.
- The shipped-set gate answers about every plugin the marketplace lists. It used to take the one
  directory it sat in; then, briefly, only the ones with a `package.json` of their own, which is one
  of the two here. A plugin without one has no list to hold against what it loads, and its files
  still name paths, so the walk runs either way and only the comparison is skipped.
- A workspace lockfile carries the marketplace root's version and each member's under its own path.
  The release gate read the root's, which no plugin release moves: it refused a correct tree, and it
  let the member's own entry drift to a version nothing else in the repository held.
- Four scripts kept a path table the move did not touch, so `npm run scan`, the defaults seeder, the
  defaults measurement and the A/B harness could not start. The seeder is the remedy another gate
  prints to whoever tripped it.
- The plugin's `files` named a `LICENSE` and a `README.md` it did not have. Under the old layout the
  marketplace root's copies travelled into the cache with everything else; under this one nothing
  does, and npm passes over an entry naming a path that is not there without a word.
- The release tag namespace is per plugin: `vx.y.z` still releases anatomiya, and
  `ultracode-anywhere-vx.y.z` releases the second plugin. No tag already pushed changes meaning.
- `scripts/coverage.mjs` reads the floors off an lcov record instead of the total node prints, and
  holds each of the second plugin's five files to one of its own. A floor over a whole scope cannot
  see one file inside it: `hook-io.mjs` sat under the branch floor both when the aggregate spanned
  the whole suite and when it was scoped to that plugin alone.
- Every anatomiya hook declares a five second timeout. They declared none, so the harness default
  applied to a hook whose own read gives up after two seconds: thirty seconds on `UserPromptSubmit`
  and ten minutes on the other two.
- `plugins/anatomiya/lib/hook.mjs` is anatomiya's whole side of the hook contract now: the payload read moved there
  from `plugins/anatomiya/bin/anatomiya.mjs`, and both writes go through one guarded `respond`.
- `docs/releasing.md` is a two-plugin checklist, and the incident it cites is the right one:
  `v0.1.9` was released by hand four seconds before its own workflow run started.
### Added


- `docs/plugin-contract.md`, which reads what Claude Code requires of a plugin and a marketplace
  against the documentation and the CLI itself, one source per claim, and closes with what this
  repository does that the contract does not require and what could not be verified. The finding that
  changes anything is A40: a marketplace entry whose source is the repository root is copied whole
  into the plugin cache, sibling plugin included.
- Eleven cases in `test/tsconfig.test.mjs` that need no TypeScript installed. Every case that file
  already held is behind `needsTs`, so on a runner without it the whole file skipped and the module
  measured 71.4% of functions, which the new per-file floor caught. The new cases hand the two host
  builders the module they already take as an argument, and cover the parse host, the compiler
  host's five reads, the write lock, the type library that lives outside the tree on purpose, and
  the Windows drive case that `relative` answers with an absolute path.
- A per-file coverage floor over `lib/`, with `dimensions-semantic.mjs` named as an exception rather
  than the floor lowered to admit it. It caught `tsconfig.mjs` on its first run.
- `--summary <path>` on `scripts/coverage.mjs`, which the CI job now reads instead of grepping.
- `scripts/shipped.mjs`, which reads what the package would ship through `npm pack --dry-run --json
  --offline` and holds it against every file the hook declaration and the command files reach.
  Wired into `npm run validate` and into the `plugin manifests` job.
- `scripts/release.mjs`, which decides which plugin a tag releases, checks every manifest that
  plugin owns against it, and pulls the notes from that plugin's own changelog. The release workflow
  runs it instead of the shell it grew out of, and `check:docs` runs the same call on every branch,
  so a version that passes there is a version that will tag.
- `scripts/entry.mjs`, one guard for every script, with a test that walks the tree and refuses the
  spelling it replaces.
- `test/hook-contract.test.mjs`, which runs every command both plugins declare as a real process and
  holds them to one answer: exit 0, nothing on stderr, and either nothing or a single JSON object on
  stdout, whatever the payload and whether or not anybody is still reading.

- A gate over every document this repository commits: a path spelled in prose that is gone from
  where it is spelled, and is one file here now, is named with where it went. The move left 45 of
  them across the contributor guide, the security notes, the build contract and the walkthrough, and
  nothing read a path the way the number checks already read a count. A path that matches nothing
  here belongs to the repositories this tool scans and is left alone, and one both plugins hold is
  the relative spelling their own manifests use.
- A rule that a name this repository's own module offers is imported where it is used. `BINARY` was
  used in a script that never imported it, and the sentence that would have caught it did not exist.
- A rule that every spelling of the binary outside the modules that can import a constant, the
  package scripts and the workflow steps, agrees with the module that holds it. There are eight, and
  the move had to find them all with nothing to list them.

## [0.2.13] - 2026-08-22

Five reports and the three misreads found beside them, all one sentence: an option is the value
Rails reads for it, and a fact this tool could not read is evidence for nothing. Every figure below is counted by the row's own walk over the
35-repository corpus, whose 7,902 migration files hold 8,268 column sites, 1,732 `create_table`
sites, 1,758 reference calls and 511 foreign-key statements. Reference sites go from 1,655 to 1,638
and conforming from 1,186 to 1,185; the column and `create_table` rows do not move at all.

### Fixed

- An option key this tool cannot read makes the whole options list unreadable, the way a `**` splat
  already does. `t.string :name, key => false` was read as a column that declared nothing and counted
  as a violation, while the same fact written `t.string :name, **opts` declines the site: one shape
  convicted and the other declined, and `check` grades against the conviction. A constant key and an
  interpolated symbol read the same way, and `create_table` and `add_reference` carried it too, so a
  `null: false`, an `id:` or a `foreign_key: true` behind such a key was charged as absent. The three
  rows that read an options list decline it now, which under-counts the population instead, and
  `N of N sites across X of Y files` already reports that.
- A reference is judged against a foreign key the migration declares apart only where that key can be
  matched to it, on the table it is added to and on the column it covers. A statement naming either
  through something with no literal to read was dropped, so the reference it may cover read as a
  column with no key at all; one whose `column:` could not be read was worse, matching by the plural
  of the reference name and crediting a reference it may never have covered. Such a statement answers
  for nothing now, and blocks the reference it might be the key for, but only that one: a key on
  `editor_id` is not a reference on `author_id` whatever table it was added to, and a key added to
  another table it could read is nobody's here, so only the unread fact blocks anything. 2 of the 511
  statements in the corpus hide one of those facts, both in one openproject migration, and the
  references in that class declare their keys inline, which is evidence on the site itself and still
  counts.
- A reference on a table this tool cannot read is declined rather than charged, but only where a key
  in the class covers the column it names. canvas-lms holds the shape that decides it: a
  `create_table :"aua_logs_#{index}"` whose `t.references :asset_user_access` the file says in its
  own comment is deliberately left unconstrained, and no statement in that migration covers that
  column, so the violation stands where a blanket decline would have lost it.
- A string key is not the option Rails reads. It looks `options[:null]` up by symbol, so
  `t.string :name, "null" => false` sets nothing and the column is nullable; read as the symbol
  option it credited a column that declared nothing, which states a convention the repository does
  not hold. A string key is skipped now rather than voiding the list, because it is readable and what
  it reads as is not the option.
- A polymorphic reference is one whatever truthy value says so. The exclusion asked for the literal
  `true`, and Rails asks the option: `polymorphic: { limit: 255 }` is the type column's own options
  and `polymorphic: %i[account course]` is the list of types. 26 of the corpus's 129 polymorphic
  references are written one of those two ways, every one in canvas-lms, and each was charged for the
  foreign key ActiveRecord refuses on a polymorphic relation.
- The list form carries a key where its own options declare one. canvas patches
  `TableDefinition#references` to expand `polymorphic: %i[account course]` into one real reference
  per type with `foreign_key:` passed to each, and its own guard is `unless polymorphic.is_a?(Array)`,
  so the hash and the bare `true` fall through to stock ActiveRecord and raise. 10 of the 26 are the
  list form with a key, and excluding them denies a fact that repository's source demonstrates.
- A `foreign_key:` Rails reads as no key is no key. `nil` is falsy and `ReferenceDefinition` adds
  nothing for a falsy value, so `foreign_key: nil` declared none and read as one. `null:` is the one
  option still compared against the literal `false`, because that is what Rails compares it to.
- An option value the source does not decide decides nothing about its site. `null: nullable` may be
  declaring `null: false` and was charged for the option it may be setting; `foreign_key: fk_options`
  may be declaring nothing and was credited, which whitehall writes once. A local, a call, a constant
  or a conditional is now a decline, the way an unreadable key already is.
- A reference is judged against the keys its own direction declares. A column added only on the way
  down does not exist going forward and neither does a key, which the collector already said of the
  key alone, so one direction's evidence was answering for the other's columns. A rollback reference
  is still a site, judged against the rollback's own keys: 8 of the corpus's 1,758 reference calls
  are written in one, and no verdict of theirs moves.

## [0.2.12] - 2026-08-22

Four reports against what an area file says and against what lets it say anything. Three are about
the always-loaded budget: a line that lost to the rows competing beside it, conventions that vanished
behind a bare count, and a reasoning the tool had written down and never printed. The fourth is a
float. Each figure below is measured on the repository the report was filed against and re-measured
over the 35-repository corpus.

### Fixed

- The `kinds:` line comes off an area file's line bound rather than competing inside it. Entered as a
  block it lost to claim rows in exactly the directories holding the most of them: on a measured
  front end the five largest areas were the five missing it, `src/components` at 149 files down to
  `src/pages/admin` at 41, while all 122 smaller areas kept theirs. The line hiding there is the one
  the overview's own directive depends on, since "match sibling test shape" cannot be followed by a
  reader who was never told what the siblings do. It comes out of the body floor as well as the
  bound, so no file grew a line.
- A stated convention the budget cannot print in full is now named, as its sentence alone with no
  counts. On that same map 58 of 127 areas truncated and 36 of them hid 68 stated conventions
  between them, `src/queries/users` hiding 3 of its 12 in a directory of 15 files. A footer that
  says how many directives you are missing without saying which leaves nothing to look up. The
  naming block takes half the body and no more, so an area never spends its whole budget on
  sentences and prints no counts at all.
- A stated claim that is perfect and names no exception says which form its own predicate declined
  to count. `src/components/Calendar` read "46 of 46 sites across 5 of 6 files" while a credited
  file held `<div {...rest} />` three lines above `<ClickableArea {...rest} />`; nothing was
  miscounted, and the line read as false to every reader who checked.
- `wilsonUpper` is held to the two bounds its arithmetic owes: never above one, never below the rate
  it was handed. Unclamped it returned 0.9999999999999998 at 118 of the first 500 sample sizes, and
  the pooled-prior borrow compares it against a rate that is exactly 1 wherever the rest of the
  repository holds a claim without exception. On a measured front end that denied 37 perfect rows at
  n = 12, 20, 21 and 31 while n = 16, 17, 19 and 23 through 26 denied none: the sample size decided,
  not the evidence. The gate is monotone in n now.

## [0.2.11] - 2026-08-22

The map counts what a repository actually writes. Eight reports against the counting, taken
together: a name resolved the way its language resolves it, a spelling learned instead of listed, a
question that answered differently depending on which directory above the file happened to ask it,
and a line that contradicted the line two above it. Each figure below is measured on the repository
the report was filed against and re-measured over the 35-repository corpus.

### Fixed

- A superclass written bare inside its namespace is the class it resolves to. `module Api::V1; class
  Qbo < BaseController` names `Api::V1::BaseController`, and counted as a second class it took a
  59-of-64 convention to 55 of 64: the strongest fact in the largest controller area, inverted. Only
  a bare name resolves, and only against the scopes the declaration is written in, so the compact
  `class Api::V1::Qbo < BaseController` still names the top-level class as Ruby does.
- An obligation learns what its companions are called, not only where they live. A repository
  spelling the majority of `spec/models` as `<name>_model_spec.rb` read 46 of 166 and reads 95: a
  repository that specs 57% of its models was described as one that specs 28%. The roster learns the
  same way per test directory, which puts webpack's `lib/util` at 48 of 75 where it read 0 of 75.
  A spelling has to begin at a separator and be carried by a fifth of its directory, a bar measured
  over the corpus rather than chosen.
- A reference column's foreign key is counted wherever the migration declares it. Read as the inline
  option alone the row said 43 of 76; the block form the repository actually uses, `t.foreign_key`
  beside the `t.references` in one `create_table`, brings it to 72 of 76. A key declared only on the
  way down adds nothing going forward and is not counted.
- One test file answers one source file. `app/services/stripe/reports/generate.rb`, which has no spec
  at all, was credited with Shopify's, because the tail below the area root is `reports` on both
  sides. The kinds line said 15 where the claim under it said 13, in one generated file about the
  same seventeen files; both read 13 now.
- The namesake question answers the same whichever directory above the file asks it. A package whose
  tail is only tree words read 0 of 2 where the directory above it and the directory below it both
  read 2 of 2.
- A spec the parser read and found empty is not a test file and not a file owing one. A spec
  commented out top to bottom made the service beside it read as covered.
- The tests line says how many of a runner's files are under the directory it names, and the namesake
  clause names the directory its denominator was counted over. One overview read `1333 RSpec specs
  under spec` two lines under its own `- spec: 1332 RSpec specs`.
- Where only an import edge answers, a suite inside the root being counted is preferred over one
  outside it, rather than whichever directory sorts first.

## [0.2.10] - 2026-08-22

A file is counted as tested when a test says so. H18 closed a false-match class by requiring the
path tail to line up and left a false negative it could not close from path shape: a source tree
whose tests sit somewhere that mirrors nothing on its side read zero over files that each have a
test. Where the tail cannot answer, the import edge does, because a test that imports the producer
has named what it covers.

### Fixed

- A file whose tests sit in a tree that mirrors nothing on its side is no longer counted as untested.
  The namesake question now reads the import edge where the path cannot carry it: a test that imports
  the producer has named what it covers. This repository's own second plugin read `0 of 5` over five
  files that each have a test; `got` read a false `0 of 20` over `source/core`, and reads a true
  `3 of 20`. Measured old build against new over 12 repositories including every counter-example
  behind H18: 11 are byte-identical and no producer is credited falsely.
- A specifier written the way TypeScript requires under NodeNext, `../src/parser.js` for
  `src/parser.ts`, names that file. A build-tool suffix (`?worker`, `?raw`) is cut. A directory
  import and a bare package name name nothing, so neither can answer for a module beside them.

## [0.2.9] - 2026-08-21

A second plugin in this marketplace, and the manifest check that now reads every plugin the
marketplace lists. Claude Code gates its standing Workflow orchestration on `effort === "xhigh"`,
and what that gate controls is one system-reminder rather than the Workflow tool, whose
availability carries no effort term. `ultracode-anywhere` restates that reminder on the built-in's
own cadence, so the mode holds wherever `effortLevel` is set, and says out loud what it does not
restore.

### Added

- `ultracode-anywhere`, a second plugin. A `UserPromptSubmit` hook opens the session with the
  standing opt-in and comes back as one line every tenth turn, 1412 characters over a 30-turn
  session. It runs through `node`, so it fires where there is no shell.
- The reminder carries its own floor: name what a fan-out buys, or stay solo. A dozen agents on a
  one-file edit costs more than the tokens the text saves.
- What it restores is the instruction, not the effort level, and the text says so rather than
  leaving a model to report itself as running at xhigh.
- A `SessionStart` check reads the installed build for the four things the premise rests on and
  for the gate itself, and names anything missing. `ULTRACODE_ANYWHERE_STRICT=1` turns that into a
  switch; `plugins/ultracode-anywhere/VERIFYING.md` is the list a person works when the version moves.
- It stays quiet where it would be noise: `"ultracode": true` already fires the built-in reminder,
  and `"enableWorkflows": false` leaves no tool to point at. A line says which setting silenced it.
- The concurrent-subagent cap it does not lift is named once per machine, with the setting that
  lifts it and the evidence that native ultracode does.
- It shares the repository and nothing else: no shipped `anatomiya` code imports it and the npm
  package still excludes it. Its tests and coverage run with the suite.

### Changed

- `npm run validate` reads every plugin the marketplace lists, not only the one at the root: each
  plugin's own manifest, the paths that manifest names, and the files its hooks run. The workflow's
  inline copy of those checks is gone, the script is the copy that has tests, and CI runs it.
- Everything the plugin keeps between turns goes through one module, which refuses a state
  directory that is a symlink, is not a directory, or lets other accounts in, and writes without
  following a link standing where a file should be.

### Fixed

- Three review rounds, each against the round before it. A hook reached through a symlinked
  directory did nothing at all and said nothing about it, because the guard compared a resolved
  path against the one the loader spelled; the same equality still sat in `scripts/validate.mjs`,
  which is CI's only manifest gate.
- A repository carrying `.claude/settings.json` as a link to a device could hold a prompt until the
  hook timed out. Every read here is bounded and asks an open handle what it is rather than asking
  the path.
- A file called `claude` earlier on the path that is not a build counted as drift. It counts as no
  evidence now, the build is found through the variable Claude Code sets, and an answer nobody
  could read is not kept.
- A counter slot holding something other than a count is left alone rather than written over, and
  the sweep looks at a bounded number of entries.
- `scripts/validate.mjs` refuses a manifest that parses to `null`, an absolute source, a plugin
  directory symlinked out of the repository, and the same plugin listed twice; it reads every file
  a hook command names, and no longer reads a quoted flag as part of a filename.
- The turn counters live in `~/.claude/ultracode-anywhere/` rather than in the temporary
  directory. The ownership and link checks around them were written to survive a shared `/tmp`;
  keeping state out of it removes that class instead, and the checks stay for the state switch. A
  machine with no home to write into keeps no state, which costs the cadence and not the reminder.
- CI found two more that a laptop could not. Two version files written in the same millisecond are
  a tie, so the build a version-managed install keeps is chosen by version rather than by
  timestamp, which a rollback also gets right. And the read of this plugin's own state refuses a
  link the way its write already did, while the read of a user's `settings.json` still follows one,
  since a dotfiles repository keeps that file behind a link on purpose.
- A fourth review round, five reviewers against the build itself. The wakeup skip reads a `source`
  field 2.1.238 declares and does not send outside Anthropic, so the README now says a wakeup is a
  turn like any other until it arrives. The cadence starts over after a compaction or a `/clear`,
  as the built-in's does, rather than leaving a compacted session with the refresher alone. The
  hook goes quiet on `"disableWorkflows": true`, `CLAUDE_CODE_DISABLE_WORKFLOWS` and
  `CLAUDE_CODE_WORKFLOWS=false`, which the build reads before `enableWorkflows`. The session
  lines are not repeated on a resume. A fifo at the debug path no longer holds every prompt to the
  timeout, since writes open non-blocking the way reads did. The gate pattern accepts the spellings
  a minifier chooses between, the bundle is read once rather than twice, and a file too small to be
  a build is no evidence either way.
- `scripts/validate.mjs` was refusing what the loader installs: an object source naming a remote,
  a prompt-type hook, a bare `.`, and a path that wanders and resolves inside. And it was passing
  what the loader drops: a hook with no `type` or one it does not know, an object source of a kind
  it does not know, a `../` spelling that re-enters the repository, a duplicate name behind a
  remote source, and a link out of the repository under a manifest directory, a declared path or a
  hook file. It reads the loader's own rules now, checks the exec form's `args`, asks for a file
  where a hook names one, holds versions to semver, names a manifest with no name as such, and
  reports a manifest directory that is a file instead of throwing over it. The module that reads
  the build reads a home named and empty the way the counters do, and a session already quiet
  reads no build under strict.
- Tests no longer read the checkout's own `.claude/settings.json` through the process's working
  directory, no longer leave a fixed-name directory under the shared temporary one, no longer patch
  `process.stdout`, and the symlinked-state test holds a count behind the link, so it fails without
  the arm it pins.

### Security

- CodeQL scans what ships: `test/**` is outside the scan, since the remaining alerts traced the
  suite's own `mkdtempSync` fixtures into the plugin's reader (A32).

## [0.2.8] - 2026-08-21

Four defects on the read side of the hook, all found by probing the release that had just shipped, and
none of them reachable before 0.2.7 put that hook in every session rather than only in a scanned
repository. The map it echoes has to be one this tool wrote, read the way the audit already reads a
rule file: bounded, non-blocking, and typed before a byte comes off it.

### Fixed

- The hook echoed whatever sat at the map's path, so a file this tool never wrote reached the model on
  every prompt and every tool call. It asks the frontmatter now, which is the one of A3's three
  ownership facts a session can check.
- A named pipe at that path never returned, which is a session that never returns. A file carrying our
  frontmatter and five megabytes of anything else was read whole and echoed whole. Both go through the
  bounded reader the audit already used.
- A hand-written file at that path in a subdirectory silenced the repository's own map for every
  session under it. The walk goes past it now.
- `isOwned` read across the closing fence, so somebody else's frontmatter block with `generator:
  anatomiya` further down came back as ours. That is the direction that deletes: the scan may remove
  what it owns.

### Changed

- A24's cost is stated as a range rather than a figure. Three runs on one laptop gave medians of
  73ms, 104ms and 237ms, and which `node` is on `PATH` moved it more than anything the tool does.

## [0.2.7] - 2026-08-21

One bug, reported from the field, and it is the worst kind this tool can have: the hook a scan
installed does not run, and Claude Code says so on every prompt and every tool call for the life of
the session.

`${CLAUDE_PLUGIN_ROOT}` is substituted only for a hook a plugin declares in its own
`hooks/hooks.json`. Versions 0.2.4 through 0.2.6 wrote it into the scanned repository's
`.claude/settings.local.json` instead, where nothing substitutes it, so every session in a scanned
repository answered a prompt with `UserPromptSubmit hook error: Hook command references
${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`. No test caught it because every
test ran the command directly rather than through the loader.

The plugin declares the hook now. A scan writes nothing into any settings file, which puts it back
inside `.claude/rules/` and `.claude/anatomiya/` where A1 says it belongs, and it takes out the entry
an older version wrote when it finds one, on any spelling that shipped. Permission lists, other
people's hooks and any event still holding one are left exactly as they were; the file goes only
when it holds nothing else.

### Fixed

- The re-delivery hook was installed where its own plugin path is never substituted, so Claude Code
  refused it by name on every prompt and every tool call in every scanned repository.
- A scan takes that entry out of `.claude/settings.local.json` when it finds one, so upgrading
  repairs the repositories the older versions broke.

### Changed

- The documented exclude is two lines rather than three. A scan no longer writes a settings file, so
  there is nothing there to keep out of git.
- `npm run validate` refuses a `hooks/hooks.json` the loader would silently ignore, and one naming a
  file the plugin does not ship. The shape matters: without its top-level `hooks` key the file loads
  nothing and says nothing about it.
- The scan summary says when it took an old hook out, and says it once.

## [0.2.6] - 2026-08-21

Twenty-eight reported defects, worked from the issue tracker. The largest single class, and the one
worth reading first: a predicate that counts a construct whose conforming form does not exist. Eleven
JavaScript and TypeScript rows and five Ruby ones were asking for code that does not compile or does
not run, several at MUST-FIX. An overload set has no arrow form. `const x: T` with no initialiser is
a SyntaxError. An interface inside `declare global` cannot carry a prefix without silently ending the
merge. `o?.r = 3` is TS2779, `a || b ?? {}` is TS5076, and `x?` is TS1109. A React effect may not
return null and React says so in its own words. Ruby refuses to raise a class that is not an
`Exception`, refuses a keyword argument in an index assignment, and refuses a foreign key on a
polymorphic relation. Sidekiq reaches `perform` through a splat of a JSON array, where a splatted
Hash is never keywords, and a job that returns instead of raising is acked as successful. Each of
those is now not a site.

Two gates moved, both measured. The evidence gate may borrow the rest of the repository's record for
the same dimension when this area's own sample is consistent with it, which is what lets a perfect
nine-file directory speak about a claim the repository holds at 0.987 across 2,152 sites; a perfect
small sample of a claim the repository does not hold still stays silent. And the applicability
share stops growing at three roots, so a construct rarer than a quarter of a 1,531-file directory is
no longer unstateable however perfect it is.

Three things the check could not see, it now sees: a filename spelling none of the four naming
classes, a class naming no superclass at all, and a claim whose area holds no slot for it, which is
answered by the nearest enclosing area that states one. Two it should not have said, it stops
saying: an omission on a row the gates suppressed, and a directive the forty-line budget had no room
to print.

The map stops contradicting itself in three places. The module that implements a routing claim is no
longer listed as an exception to its own rule. An abstract base is no longer asked for the spec it
can never have, which was the difference between a claim stating and staying silent. And a
suppressed slot needs a majority the sample can support before it prints the inverse sentence, so
one repository no longer hands two areas two directly opposed sentences about the same dimension.

A learned naming row now learns over one kind of file, and says which kind in the sentence it
delivers. A directory of components beside a directory of helpers was learning PascalCase off the
components and calling every correctly camelCase helper a violation, which was 29 of 55 false
findings in a 982-commit replay.

One new dimension ships, `hook_per_module`, measured across seven repositories at a 0.2022 spread
with two of them under the gate. Seven more were proposed and are recorded in the intake table with
the measurement that refused them.

### Fixed

- Sixteen predicates that counted a construct whose conforming form does not exist, in both engines.
- `class_base` asked an exception subclass to inherit the area's base, and asked the class the area
  learned to inherit itself. 37 of that row's 75 violations on a measured repository.
- A filename spelling none of the four naming classes, and a class naming no superclass at all, were
  not sites, so the omission every stated claim is really about was the one the check could not see.
- A dimension whose area holds no slot for it could never be flagged, however clearly the claim was
  stated one directory up.
- A directive the 40-line budget had no room to print was still enforced at the top severity, and so
  was a counts line for a claim the model states by default.
- The module implementing a routing claim was counted as an exception to its own rule, and the map
  said so on a line the agent reads every turn.
- An abstract base was asked for the spec it can never have, which cost the whole claim its evidence.
- An omission was reported on a row the gates had suppressed, which is a directive out of a count.
- A learned naming row pooled components with helpers, so a correctly camelCase helper in a component
  directory was a violation of a convention nobody holds.
- A suppressed slot printed the inverse sentence off a plurality, so one repository handed two areas
  two directly opposed sentences about the same dimension.
- A component that renders through a ternary or an `&&` was not recognised as one, so it stayed in
  the naming vote and could flip a components directory to camelCase, where the remedy the check
  asked for was a lowercase component name and a host element.
- A claim the owning area's own globs never deliver to a path was still reported at MUST-FIX, on
  every new subdirectory of an area that lists only its own files.
- A suppressed slot printed a sentence no site in the directory follows, whenever every site took
  the other side and the sample was small, and the check then reported conforming code as a
  violation.
- The truncation notice counted only the directive partition, so an area whose dropped lines were
  all model-default claims read "all of them counts" while the check enforced them.
- A file the parser could not read was sorted into a kind by the facts it did not carry, so an
  unread component drew a MUST-FIX rename one line under the caveat saying it went unchecked.
- Drift was measured between the pin and the base ref in either direction, so pinning on a branch
  read the branch's own commits as a map that had moved and capped its own findings. A squash merge
  is not drift either: the base holds the same bytes the pin does.
- The check quoted its own sentence rather than the map's, so a narrowed row was reported under the
  unqualified claim, the one that pools the excluded files back in.
- A file that gained JSX on the branch had its whole base side skipped, so every pre-existing
  violation in it was reported as newly introduced, on lines the diff never touched.
- Only one of the two naming rows excluded components, so the same declaration was still asked for
  a lowercase name by the other sentence.
- A mistyped `--base` was answered with a whole-branch review at exit 0, and `--base HEAD` was
  reported as a base a shallow clone could not fetch.
- The bare command name defaulted to `scan`, which writes.

### Changed

- The evidence gate may clear on the rest of the repository's record for the same dimension, when
  this area's own sample is consistent with it. Measured: stated slots on a 2,486-file front end go
  from 72 to 735, none of them borrowing against a repository rate under 0.90, and the always-loaded
  bytes fall rather than rise.
- The applicability share stops growing at three roots, so a construct rarer than a quarter of a
  1,531-file directory can be stated.
- The summary says when the type-checked tier ran badly, the check says how far the map has drifted
  below the cliff that caps severity, the always-loaded overview no longer carries a count that
  measures the machine, and a first pin counts its areas instead of naming all 127 of them.

## [0.2.5] - 2026-08-20

0.2.5 is one bug, reported from the field: the plugin does nothing useful in a worktree. It did
something worse than nothing. A session working in a worktree, a submodule or a nested repository
below a scanned checkout was handed the enclosing checkout's map, stamped as read just now, against
a branch those counts had never been taken over.

The hook finds the map by walking up from the session's own working directory, and the walk was
lexical, so it went straight past the point where one checkout ends and another begins. It now stops
at a boundary, which is anything named `.git` at a level holding no map of its own. The map is asked
for before the boundary at each level, so a checkout that was itself scanned still answers from
anywhere below its own root, whichever shape its own marker takes. That last part is what keeps the
fix from being a regression: a worktree you have scanned is served its own counts, and only one that
nobody scanned goes quiet.

Two ways around the boundary are closed with it, both the same class as the bug. A working directory
reached through a symlink was walked through the link's own parents rather than the code's, which
steps around every boundary beneath it, and a marker that was a link to a target that had gone read
as no marker at all. The starting directory is now resolved through its links, and the marker is read
without following its last component.

The rest is the guarantee underneath all of it. `echo` runs on every turn and every tool call, and a
hook that exits non-zero interrupts the session it exists to help, so every failure has to end in an
empty object and exit 0. Two did not. A level the walk may not look at refused with EACCES rather
than answering, and `process.cwd()` refuses with ENOENT once the directory a session was started in
is removed, which is what removing a worktree under a live session does. Both exited 1, the second
with a stack from inside Node's own bootstrap, and both would have done it on every turn for the rest
of that session. A level that cannot be resolved or cannot be looked at is now read as a boundary,
and the guarantee is enforced at the process boundary rather than at each site that might throw.

Three things this deliberately does not do, named in `DECISIONS.md` rather than probed for, because
the cost is paid on every tool call: a directory named `.git` that is somebody's fixture reads as a
boundary, a nested repository in another version control system carries no marker to stop at, and the
map itself is opened through its links, so a `.claude` symlinked out of the checkout is read. That
last one differs from the write side on purpose, which refuses it: writing outside the repository
destroys what this tool does not own, while refusing to read there would break anyone who keeps
`.claude` in their dotfiles.

### Fixed

- The echo hook no longer serves an enclosing checkout's map to a session inside a worktree, a
  submodule or a nested repository. Anything named `.git` at a level with no map of its own ends the
  walk, and the map is asked for first, so a scanned checkout still answers from below its own root.
- A working directory reached through a symlink is resolved before the walk, rather than being walked
  through the link's own parents.
- A `.git` marker that is a broken symlink is still a boundary. The probe no longer follows the last
  component.
- `anatomiya echo` answers an empty object and exits 0 when a level cannot be looked at, and when the
  directory the session was started in has been removed. Both exited 1 before, on every turn and
  every tool call for the life of the session.

### Changed

- `realpathOf` moved from `lib/tsconfig.mjs` to `lib/rules.mjs` and gained `realpathOrNull` beside
  it. One spelling of a resolved path for both callers, and the one that has to decide where it is
  no longer falls back to the lexical answer.

## [0.2.4] - 2026-08-19

0.2.4 is one feature: the map stops being something the model was told once. It is put back in front of
the model after every turn and every tool call, stamped with the moment it was read, and a scan installs
that itself so there is nothing to wire.

The always-loaded channel is unchanged and still carries the overview once per turn. What it never
carried is recency. A run three hundred tool calls deep was working from a fact handed to it at the
start, and nothing anywhere said when that fact was read, so a map that had gone stale against the code
looked exactly like one that had not. Both are now on every copy.

"What is deliberately not built" refuses a hook as the delivery channel, and the 10-to-40% adherence it
cites was measured on a hook *instead of* the always-loaded file. This is a hook *on top of* it: the
channel that scored 100% is untouched and nothing depends on the weaker one, so that refusal is scoped
rather than reversed, and it still stands if the hook ever became the only delivery.

The write needed the most care, because it is the first one outside `.claude/rules/` and A1 keeps this
tool there so a writer bug cannot destroy something maintained by hand. It goes to the local settings
scope and never the `settings.json` a team commits; it is contained by F2, so a settings file symlinked
out of the repository is refused rather than followed; it merges around what is already there rather
than replacing it; and a file it cannot parse or cannot merge into is refused rather than overwritten.
A refusal is a reported line, not a thrown error, so a settings file this will not touch cannot fail a
scan that already wrote the whole map.

One number worth knowing before you run it: the echoed map is roughly 480 tokens, on every turn and
every tool call, so a 300-call session spends about 144,000 on it. There is no knob, because this tool
ships no options.

### Added

- A scan installs a hook that puts the map back in front of the model after every turn and every tool
  call, stamped with the moment it was read. Nothing to wire: `anatomiya scan .` writes the map and the
  hook together. The always-loaded channel still carries the overview once per turn and is unchanged;
  what this adds is recency, so a run three hundred tool calls deep is not working from a fact it was
  handed at the start, and a timestamp, so a map that has gone stale against the code reads as stale
  rather than as the current answer. The echoed text is descriptive and says the code outranks it.
  Decisions A24 and A25.
- `anatomiya echo`, the command that hook runs. Deliberately absent from the usage block and from
  `commands/`: no person runs it and no agent should. It reads the hook event on stdin, answers with one
  JSON object, and every failure path answers `{}` and exits 0, because a hook that exits non-zero
  interrupts the session it exists to help.
- `.claude/settings.local.json` joins the documented exclude lines, and `check:docs` now asserts every
  one of them appears in the README. They were spelled there by hand with nothing reading them, so a
  fourth thing written would have left a reader with a dirty `git status` and a document saying
  otherwise.

### Changed

- The hook install writes only the local settings scope, never the `settings.json` a team commits, and
  merges around whatever is already there rather than replacing it. It is contained by F2, so a
  `settings.local.json` symlinked out of the repository is refused rather than followed; it refuses a
  file it cannot parse or cannot merge into rather than overwriting it; and a refusal is reported as a
  line rather than thrown, so a settings file this will not touch cannot fail a scan that already wrote
  the whole map.

## [0.2.3] - 2026-08-19

0.2.3 is what a truth check of the map found. One agent per repository read the real code of 35 open
source projects and judged whether the sentences the map writes are true of them, which is the one
question the test suite cannot ask. Not a single stated directive was wrong about its arithmetic on
any repository. Twenty-one things were wrong about what the arithmetic was counting, or about what
the sentence beside it said, and this release closes all of them.

Three mattered most. The obligation that asks whether new code ships with a test was completely dead
on a monorepo, because the producer path was hardcoded to the repository root while only the
companion path was ever learned: on a 28-gem Rails engine repository, seven of nine obligations
found nothing, the words "ships with a" appeared in none of 339 generated files, and a brand-new
model with no spec passed `check` with nothing to say. The namesake match waived its directory check
for any file sitting at its own area's level, which on one repository made 668 of 1,536 credits
false, 43.5%, and told a reader a class was tested by a spec for a different class in a different
package. And generated, build-output and vendored code reached the enforced tier and was defended
there: `check` asked a hand edit to keep a file stamped `DO NOT EDIT` compliant with a convention
mined from other generated files.

The rest are the same shape at smaller scale: a config file counted as a spec, a type-only import
naming a runner, a story file filed as a private helper, a declaration file parsed as a module, a
whole language present and never mentioned. Every fix carries the repository that measured it.

### Added

- `anatomiya doctor` says whether each engine this parses with is installed, with the version it
  answered and, for one that is not ready, what was wrong and what to do about it. The remedy is
  the engine's own: npm cannot install an interpreter, and installing Ruby does not install a node
  module. It exits 0 whatever it found, because a non-zero exit would read as a probe that could
  not run. Decision B23.
- `anatomiya setup` installs the node-hosted engine's dependencies in the plugin's own directory,
  since `/plugin install` copies the files and does not run `npm install`. It runs
  `npm install --omit=dev --ignore-scripts --no-audit --no-fund` there and nowhere else, and it is
  the only command that installs anything or reaches a package registry: `scan`, `check` and `pin`
  never call it. `--dry-run` prints the command and installs nothing, and on Windows that printed
  command is the whole answer: npm ships there as a batch file, running one needs a shell no
  subprocess here may use, so setup refuses and hands it over. Decisions B23 and F5.
- `--format json` on `scan`, `check` and `pin`, and `--format github` on `check`. json prints the
  same answer as a record, schema and caveat codes and all, so a CI job or another tool reads fields
  rather than matching sentences nobody promised to keep; github prints one workflow command per
  finding, MUST-FIX as an error, FIX as a warning and NIT as a notice, so a pull request shows each
  one on the line it is about, then a warning per caveat carrying its code, one for a capped run, and
  one counting the rule files nobody here wrote. The acceptance harness reads the record instead of
  regex-parsing stdout, and the caveat codes are written down in `docs/how-it-works.md` section 8.
  The writers and the caveat table live in `lib/check-report.mjs`, apart from the pipeline that
  produces the record, so a reader that wants a writer no longer loads a parser and a git runner to
  get one. Every record goes through the encoder before it is serialised, the pin's `added` list
  included, which is printed by its JSON writer and by nothing else. Decisions A20 and F4.
- `npm run defaults:seed` writes an unmeasured `lib/model-defaults.json` entry for any registry key
  that has none, so the table is seeded rather than hand-written. A seeded entry reads `none` and
  fails open, which means the row keeps stating until somebody measures it. Decision A15.
- The overview names a language it has no dimension for. `lib/langs.mjs` declares three, and
  everything else joined the same bucket as images and markdown with nothing in the prose saying so:
  one repository is 2,374 files of Java with a real JUnit suite, another carries its own bundler as
  1,016 Rust files, and the words Rust and cargo appeared in none of its 501 generated files. Counted
  over the whole corpus rather than summed back off the roster, which prints a root's top two
  extensions and folds the rest away and so held 781 of those 1,016. Decision A22.
- A file dropped as generated is named in "Not covered". The drop happens before anything counts, so
  without the row nothing anywhere said the file existed. Decision G10.
- A file whose head says a generator wrote it leaves the corpus, and so does one a root
  `.gitattributes` declares `linguist-generated`. The fixture gates catch code that looks unusual;
  generated code looks ordinary, because it was ordinary somewhere else, and carries the real authors
  of whoever ran the generator. Decision G10.
- Beaker's `test_name "..." do` is a runner of its own: one repository writes 223 acceptance
  scenarios that way and 221 were counted as production code owing a test they already were.
  Decision B29.
- A Component Story Format file is its own kind, kept out of the producer and sibling-module counts.
  One repository's own overview read `2559 sibling modules named index/types/input.stories`, filing
  its most common fixture name beside private helper functions. Decision H22.

### Changed

- `lib/registry.mjs` is the registry: the three declared row lists assembled once, the load battery
  run once over the union, and `rowsOfKind`, `rowsForLangs`, `rowByKey` and `REGISTRY_KEYS` for the
  readers that used to spell that union themselves, ten of them each spelling a different subset of
  it. One key names one row. The parse worker still reaches `dimensionsFor` and nothing more, held
  by a walk of the import graph rather than by convention. Decision C17.
- The reducer and the check are the arbiters of which rows get a slot, so the registry no longer
  refuses a framework row on a language the oxc worker parses and a framework row may live on
  JavaScript. `adoptedCapabilities` is the one reader that selects through nothing, so a row may not
  carry `framework` and `capability` at once: otherwise off-framework hits vote for the capability
  rows the whole repository is then offered. Decisions C8 and C16.
- Each command is one in-process entry answering with a record, and `plugins/anatomiya/bin/anatomiya.mjs` is argv,
  calls, printing and exit codes. Deciding the map and putting it on disk are two calls, so the
  caller that wanted the plan without creating anything no longer derives every rendered body a
  second time, and every refusal fires while the plan is built rather than after it. The wording of
  a printed line lives in one module, because four readers scrape those lines. Decision A19.
- The check report is a record: a schema, 26 coded caveats and one encoder pass over the whole of
  it, so no writer can be the one that missed a repository-controlled value, and the rules audit's
  three fields ride the record rather than being folded into caveat prose. Decision A20.
- Every engine declares its host, its module or command, its version floor and its remedy in one
  table, one probe asks all of them, and a run that answered for no file names the engine that did
  not answer instead of guessing at a missing interpreter. `facts.json` is schema 12 and carries
  which engines answered. A blind run creates no `.claude` directory at all, having written nothing
  into it. Decision B23.
- One supervisor carries the spawn, the bounded stderr, the two clocks and the kill for all three
  bridges: the parse pool, the Ruby stream and the type checker. Every number stays with the bridge
  that measured it and only the shape is shared. Three hand-written copies of one battery had
  drifted into three stderr caps that each overshot by a chunk, and one bridge holding a single
  re-armed timeout where the other two held an idle window and a wall clock. A test fails a bridge
  that guards a child of its own again. Decision B24.
- One reader hands both the check and the baseline the content at a revision, in parallel and onto
  one temporary tree. 80 of the 88 git processes a 40-file check spawned were `cat-file` waiting on
  each other, and on this repository the run goes from about 2.1s to about 1.25s. The base side is
  still read at the merge base, so nothing an agent edits moves the population it is judged
  against. Decision E10.
- `node scripts/check-docs.mjs` lists every site a new registry key has not reached, all of them in
  one run with the move beside each. A row is one edit and its scaffolding is scattered, two sites of
  it in files an author has no reason to open, so the list is the whole list rather than whichever
  failure a run hit first. The counter pins live in one fixture. Two sites it will only ever report:
  the intake row and the counter pin are decisions, and a checker that wrote them would be deciding
  for you. Decisions G2 and C6.
- The measurement scripts read the map's paths from the constants that own them instead of spelling
  `.claude/rules` and `.claude/anatomiya` again, and a test fails a script under `scripts/` that
  hardcodes either.
- An obligation learns its producer root the way it already learned the companion root, scoped to one
  package, and a companion may vote only from inside that package. The repository root is a package
  too, and a package is named by a producer under it rather than by a companion. Decision C18.
- The namesake match asks the same mirror test for a file at its area's own level that it already
  asked for a nested one, with one further shape: both sides at the top of the tree, which is the
  flat repository this tool is itself. Decision H18.
- Exported names are judged per declaration kind. Classes, types and functions carry different and
  equally universal conventions, and pooling them made `check` wrong in both directions on one
  directory: it flagged a correct camelCase function export and passed an incorrect PascalCase one.
  A default export that names what it declares is read, since one class per file is the ordinary
  component shape. Decisions C19 and C20.
- A test runner needs a declared case, not merely an import, and a type-only import decides nothing.
  Config files, page objects and setup hooks were counted as specs; on one repository all twelve
  "playwright specs" were non-tests while the six real ones were missed. Decisions B25 and B26.
- The Rails declarative `test "..." do` macro sets minitest, and asks for the same evidence
  `def test_*` asks for: `test` is an ordinary word, and an in-house rules engine read three
  authorization classes as specs. The minitest base-class list is what a repository has been seen to
  inherit rather than a count of what Rails ships. Decisions B27 and B28.
- A declaration file keeps its own extension end to end and is parsed with its own grammar, and a
  valid CommonJS file using a guarded top-level `return` is retried rather than charged with a syntax
  error. `sourceType: "script"` does not fix that second one and was measured not to. Decisions B32,
  B33 and H17.
- An area's `kinds:` line prints its own leftover and names its runners, the way a root line already
  did. One repository hid a nonzero leftover on 107 of 497 areas. Decisions H19 and H20.
- `apps` joins the shell names a monorepo splits under, and a root whose largest extension is
  screenshots still finds its real producers. Fixed together: separating them would have made two
  sites report zero producers instead of a blend. Decisions H3 and H21.
- A test tree suppresses the namesake question wherever it nests, not only at the repository root.
  Decision H6.
- The fixture exclusion reaches a repository's own compounds. One project spells its fixture cases
  eight ways and none was a whole segment. Decision G8.
- An area's kinds line takes the same floor a directive gets, so an area carved into many children no
  longer prints a bare file count and nothing else. Decision A23.
- `dropped.denied` is a count, matching the three beside it. Decision A21.

### Fixed

- `exported_symbol_case` gives up the exported interface, which resolves the pair that could not both
  be satisfied: obeying the naming FIX produced a prefix MUST-FIX, and no name satisfied both.
  Closes #63.

## [0.2.2] - 2026-08-18

0.2.2 closes two ways the tool answered clean about work it had not looked at. A class that forgot
its `include` was not a site at all, so the map's own strongest reading, every class here carries
this mixin, was the one reading the check could not enforce. And the check read commits, while an
agent writes, checks, fixes and then commits, so the run that mattered most was the run about
content still only in the working tree. Both are counted now, and the second says so on every run
that reads one.

Two review rounds over five reviewer passes found eighteen things in the fixes themselves, of which
the ones worth naming are the forgeries: an uncommitted rename, and a path the index calls an
addition whose committed version is right there, each charging a branch for every site in a file it
had not written. Whether a path has a base version is a question about the merge base, and it is
asked there now.

### Fixed

- `module_include` counts the body that declares nothing, so a class that forgot the include is
  caught rather than invisible. A class body is a site when it includes something, and also when it
  includes nothing, names no superclass and is not nested inside another class. A namespacing
  module, a subclass and a nested helper each have somewhere else to have got the mixin and are not
  sites. A body mixing in nothing has no constants to be told apart by, so it is fingerprinted by
  its own qualified name: otherwise every include-less body in one file is the same site, a new one
  absorbs an older one's finding, and the report names a class the branch never touched. A body that
  prepends or extends a constant, and a reopening of a class that declares a mixin elsewhere in the
  file, both declared one by another route and are not sites either. Measured over
  twelve Ruby repositories: eleven do not move and empire-flippers/api is identical row for row.
  Decision H16, issue #46.

### Changed

- `check` reads the head side from the working tree wherever the tree differs from the commit, and
  examines a file that exists only in the tree. An agent writes, checks, fixes, then commits, so
  the run that used to answer `0 MUST-FIX` about content it had not read now answers about the work
  as it stands, and says how many files it read that way. The base side is still read at a commit,
  so nothing an agent edits can move the population it is judged against, and the tree is read only
  where a merge base exists to judge against it. A pending path is resolved rather than joined, so
  a symlink out of the repository is refused the way the scan already refuses to write through one,
  under the same size bound the committed side reads at, through one open handle so the size that was checked is the size that is read. Whether a pending path has a base version
  is asked of the merge base rather than of the index letter, so `git rm --cached` and a
  delete-then-restore no longer charge the branch for every site in the file. Decision E9, issue #48.
- The two delivery facts that were folklore are written down: a Read that fails still attaches the
  area file its path matched, and a subagent is served by the same channel, with the session's
  working directory deciding what it holds before its first Read. Decision A18, issue #47.

## [0.2.1] - 2026-08-17

0.2.1 changes no count and no rendered byte. It puts a number behind the one word three delivery
decisions rested on. A6, A7 and A8 all say what happens to a context file "in a session", and
nothing had ever measured how long one delivery lasts. It lasts one context window: a compaction or
a resume rebuilds the window and the map comes back from disk, the overview at the boundary and an
area file on the next read that matches it. So the gap the tool cannot reach is the stretch between
two rebuilds, not the tail of a long session, and there is nothing here to build.

### Added

- `scripts/measure-delivery.mjs` counts what the delivery channel did, off a Claude Code transcript
  store rather than off the files a scan wrote. A delivery is read from the attachment entry that
  carries it, so a session that has already run can be asked what it received and when. Decision
  A17, run of record in `docs/measurements/2026-08-17-context-delivery.md`.

### Changed

- A delivery lasts one context window, not one session, and the docs now say so. A compaction or a
  resume rebuilds the window and the map comes back from disk: the overview at the boundary, an
  area file on the next read that matches it. Measured over 12,500 transcripts, 84 paths delivered
  more than once and 46 of those with a compaction between; of the twelve sessions that compacted
  after a delivery, nine took a path back. A6 and A8 keep their bounds and lose the word "session".

## [0.2.0] - 2026-08-17

0.2.0 moves where the knowledge lives and not what a scan prints. Every fact a language owns is one
declaration, every spelling of a test file's name is one module, every registry row carries its
kind, and a framework is a profile. The whole surface is held to byte-identical output on unchanged
repositories, over a six-repository diff harness at every step and the 36-repository from-zero run,
and the overrides the rework found dead now work or refuse.

### Changed

- `lib/langs.mjs` is the language declaration registry: extensions, bare filenames, the scratch
  extension, the grammar route per real extension, the dialect the retry may strip, capabilities,
  node addressing, and the engine name, with load asserts so a wrong declaration fails at import.
  The corpus filter, the delivery globs, the grammar choice and the Flow retry all read it, and a
  basename that is only a known extension keeps its language, exactly as the old anchored regexes
  read it. Decision B21.
- The parse seam routes batches by declared engine and takes a per-language guards bag; nothing
  past it names a language or an engine, and `rubyGuards` is gone. Decision B21.
- The oxc worker is a thin shell over `lib/parse-file.mjs`, so the body that picks the grammar,
  runs the dialect retry and answers the counts has direct in-process tests, and a conformance
  suite holds both engines to one record contract by iterating the registry. Decision B22.
- Every spelling of a test file's name lives in `lib/test-shape.mjs`, with the deliberate
  differences between the spellings pinned beside each other. Decision H15.
- Every registry row carries `kind`, the whole load battery runs over all three row lists,
  pairings included, and the check finds corpus rows by kind rather than by a key literal.
  Decision C15.
- A framework is a profile in `lib/frameworks.mjs`, and `frameworksIn` folds over the profiles as
  a set, so a corpus holding two frameworks can report both. Decision C16.
- The Ruby dimension files import the leaf walker, and a test pins that nothing the parse worker
  reaches imports `node:child_process`. Decision F18.

### Fixed

- A `maxBytes` override handed to the Ruby bridge now reaches the script's own size check; it was
  interpolated from the module constant, so the override never worked. A non-numeric override
  refuses loudly instead of dying inside the child, and a guards key naming no declared language
  refuses instead of moving nothing.
- The memory guard's `ps` timeout and byte cap now honor pool overrides.

## [0.1.13] - 2026-08-17

0.1.13 is the release where the map says where things live, not only how they are written. The
always-loaded overview gains a `## What lives where` section counted over every tracked file; each
area file says what kinds of files it holds, what its files import most, and what the rest of the
repository imports from it; five learned rows state the base class, the mixin and the type-name
prefixes a directory already uses; and the whole surface is accepted twice over a 35-repository
corpus: a harness that re-derives every printed number, and an end-to-end run that drives the
shipped CLI from a fresh clone of each repository through scan, a byte-identical rescan, pin and
check.
### Added

- The overview carries one fixed sentence beside the read-before-editing line: when unsure what the code does, read it, grep it, or run it instead of guessing, and say what you could not verify. Sources in `docs/research/one-line-that-stops-guessing.md`; decision A16.

- A `## What lives where` section on the overview, so a map says where a new file goes before the
  agent has read anything. Up to seven directories, each with what it holds by extension, the test
  runners inside it, how many of its files have a namesake test, and how many sibling modules sit
  beside its components. The directories are chosen by a floor that scales with the corpus rather
  than from a table of known roots, and there is no vocabulary of kinds: a line is labelled with a
  directory name and a count is nouned with an extension. One line under them summarises the
  repository's tests, with the namesake count that makes it a denominator rather than a total, and
  two sentences print where the counts ground them. It rides the always-loaded overview because
  that is the one channel reaching a write path nobody read in first (#34).
- The same counts per area, as a `kinds` line under the heading, and two roster lines beside it:
  the modules most of an area's files import, and the names it hands out that the rest of the
  repository imports most. Both outlive a suppressed count and give way to a stated directive.
  Facts schema is 11.
- Five learned rows, so a map says what a new file in this directory is expected to sit on.
  `extends_base` and `class_base` learn the superclass a directory's classes name, `module_include`
  the module its class and module bodies mix in, and `interface_prefix` and `type_alias_prefix` the
  letter its declared type names carry. The first three learn a name out of the repository's own
  source, so the sentence is encoded before it is rendered. The last two can learn that there is no
  prefix at all, which is what a model writes unprompted, so a repository that prefixes nothing
  prints counts and a prefixed one states.

### Fixed

- A Ruby child killed by the bridge's own idle window or wall clock is spawned once more, for the
  files that never answered and no others, before anything is charged as crashed. Both timers
  measure the machine rather than the files, so the same corpus answered on a quieter run and the
  unexamined count moved the always-loaded overview. A child that exited on its own, a missing
  interpreter and a fatal from the script are still charged on the first attempt, and every Ruby
  record now carries `attempts` the way a pool record does.
- A CommonJS file's exports are read off its assignments, not only off the parser's ESM record:
  `module.exports = { a, b }`, `module.exports = fn`, `module.exports = function () {}`,
  `exports.name = ...` and `module.exports.name = ...`. A repository written in `require` reported
  `exports: []` for every file and counted every module-level function as an inline helper.
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

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/v0.13.4...HEAD
[0.13.4]: https://github.com/crisnahine/anatomiya/compare/v0.13.3...v0.13.4
[0.13.3]: https://github.com/crisnahine/anatomiya/compare/v0.13.2...v0.13.3
[0.13.2]: https://github.com/crisnahine/anatomiya/compare/v0.13.1...v0.13.2
[0.13.1]: https://github.com/crisnahine/anatomiya/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/crisnahine/anatomiya/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/crisnahine/anatomiya/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/crisnahine/anatomiya/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/crisnahine/anatomiya/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/crisnahine/anatomiya/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/crisnahine/anatomiya/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/crisnahine/anatomiya/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/crisnahine/anatomiya/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/crisnahine/anatomiya/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/crisnahine/anatomiya/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/crisnahine/anatomiya/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/crisnahine/anatomiya/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/crisnahine/anatomiya/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/crisnahine/anatomiya/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/crisnahine/anatomiya/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/crisnahine/anatomiya/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/crisnahine/anatomiya/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/crisnahine/anatomiya/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/crisnahine/anatomiya/compare/v0.2.13...v0.3.0
[0.2.13]: https://github.com/crisnahine/anatomiya/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/crisnahine/anatomiya/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/crisnahine/anatomiya/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/crisnahine/anatomiya/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/crisnahine/anatomiya/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/crisnahine/anatomiya/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/crisnahine/anatomiya/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/crisnahine/anatomiya/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/crisnahine/anatomiya/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/crisnahine/anatomiya/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/crisnahine/anatomiya/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/crisnahine/anatomiya/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/crisnahine/anatomiya/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/crisnahine/anatomiya/compare/v0.1.13...v0.2.0
[0.1.13]: https://github.com/crisnahine/anatomiya/compare/v0.1.12...v0.1.13
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
