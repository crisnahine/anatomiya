# anatomiya build contract

Every row is a finding that survived review or a probe that overturned an assumption, reduced to the
decision it forces on the code. This replaces the v1/v2/v3 specs as the thing to build against; those
are history. Status is what the code does **today**, not what it should do.

Sources: five-lens verification of v3 (26 blocking findings), six empirical probes, a ten-repo
public measurement, a 4,616-comment classification, and a 237-entry glossary re-audit.

---

## A. Delivery

| # | Decision | Why | Status |
|---|---|---|---|
| A1 | Write to `.claude/rules/anatomiya-*.md` | Measured: reaches subagents, negation works, central so one exclude line hides it, and a writer bug cannot destroy a hand-written `CLAUDE.md` | partial |
| A2 | Never end a `paths` glob in a bare `/**` | Measured: the matcher strips `/**`, so `["app/**","!app/vendor/**"]` becomes `["app","!app/vendor"]` and the exclusion silently fails | **done** `areas.mjs` |
| A3 | Ownership = filename prefix AND `generator: anatomiya` frontmatter AND known to `facts.json`. All three, or leave it alone | v3 said "never delete a file lacking the key" and "remove any unknown `anatomiya-*`" in adjacent sentences | partial |
| A4 | The overview enumerates every file we generated, and the check reports any other file in `.claude/rules/` as unattributed context | `.claude/rules/` is a *repository* directory. A cloned repo can ship a rule file with no `paths` key that loads unconditionally from the moment of clone, in our house style, forever | partial: the check names them (`check.mjs`), the overview prints a count and not the list |
| A5 | Overview must be byte-stable across scans with no source change | The token economics only work on a cached read. No timestamps, no counts that move per commit, no filesystem-order dependence | partial |
| A6 | Each generated file stays under ~40 lines | Measured: a mid-session rewrite does not re-attach; the change notice truncates head and tail, so a mid-file edit reaches the model in neither copy | partial |
| A7 | The plugin never opens its own rules files with the Read tool; use `cat` | Measured: reading a context file permanently suppresses its automatic injection for that path for the rest of the process | partial |
| A8 | Print one line after a scan: a running session holds the old map, restart to pick up the new one | Measured, same cause as A6 | partial |

## B. Engine

| # | Decision | Why | Status |
|---|---|---|---|
| B1 | `oxc-parser` for JS/TS, `prism` for Ruby, as the syntactic tier | Measured 4,153 and 6,867 files/sec, enclosing scope free from the walk | **done** |
| B2 | `oxc` runs in a pool of warm **child processes**, never in-process, never worker threads | Measured: uncatchable SIGSEGV from inside `parseSync` at nesting depth, a worker thread does not contain it, and no static pre-screen predicts it. The pool is also *faster*: 8,463-10,563 files/sec vs 3,058 | **done** |
| B3 | Guards per file: 4 MB size, 5s timeout, 1 GB RSS polled after 250ms in flight | Measured; no V8 heap flag caps it | **done** |
| B4 | `prism` stays in-process with an explicit `rescue SystemStackError` | Measured safe | **done** `ruby.mjs` — prism runs in Ruby, so one subprocess and no pool is what "in-process" can mean here |
| B5 | **Never index a disk buffer with a parser-reported offset.** Slice the same in-memory string handed to the parser | Measured: `oxc` reports UTF-16 code units, `prism` reports UTF-8 bytes, 5.4% of real files are non-ASCII. Silent corruption, worse than the crashes | **done** |
| B6 | Containment collapse, keyed within one file | Measured: overlapping matches are *nested*, not duplicate. A range hash catches none of it. Offsets are not comparable across files | **done** |
| B7 | `typescript@5` checker is a second tier, opt-in via `--deep`, never the default. Pin major 5 | Measured: 26x slower, whole-program (narrowing the file set drives unresolved types from 3.1% to 36.2%), and it buys 5 entries. `typescript@7` is the Go port with no JS API | todo |
| B8 | A broken `tsconfig.json` is detected and reported as degraded mode | Measured: typed resolution drops 89.5% to 39.8% silently | todo |
| B9 | The semantic tier reads repository-authored `tsconfig.json`, so the "libraries read no repository configuration" claim is false. Confine `extends`, force the root file list to the corpus, resolve our own deps from the plugin root | The v3 claim was untagged and its own evidence section falsified it | todo |
| B10 | **Dimensions run in the worker; only counts cross IPC.** The tree comes back only for the check, which needs line numbers, and only for the files a diff touched | Measured: the walks are 85% of the scan's CPU (1.57ms/file against 0.27ms to parse) and running them in the parent left that 85% on one core, so pool throughput stopped improving past 4 workers on 11 cores. The reply for an 18 KB file went 278,261 bytes to 649 | **done** |
| B11 | **No cap on repository size**: not file count, not total bytes, not cumulative Ruby output. Per-file guards only | The 50,000-file cap did not trim a tail, it set `truncated`, which suppresses every directive in the map. Measured on a synthetic 100,000-file repository: 50,000 files seen and 0 of 720 claims stated, against 100,000 files and 480 of 720 now | **done** |
| B12 | The baseline reads only files that differ from the pinned commit; the rest reuse the corpus parse | Measured: the baseline stage was 6,875ms of an 8,768ms scan, re-reading through one `git cat-file` per file, on a repository where nothing had changed. Now 90ms | **done** |
| B13 | A missing parser dependency fails the scan, and a file that answered `ok: false` is counted apart from one that crashed | Measured: with no `node_modules`, every file failed to parse, was charged as parsed, and the CLI printed a clean empty map and exited 0. `/plugin install` does not run `npm install`, so that was the first run a marketplace user got | **done** |

## C. The counted-claim model

| # | Decision | Why | Status |
|---|---|---|---|
| C1 | Every dimension carries `applicability`, `candidates`, `conforming`. Ratio over **candidates**, never over file count | Measured: file-counting flips 10 of 39 verdicts, in both directions. It hides real conventions *and* manufactures false ones | **done** |
| C2 | A dimension with no writable applicability predicate does not ship | 8 of 8 were writable; 3 of them under-count applicability, which is the dangerous direction | todo |
| C3 | Render `applicability` beside the area file count on every line | A wrongly narrow predicate gives ratio 1.0 over a small set and reads as a strong convention. This is the only thing a human can audit it with | **done** |
| C4 | Applicability floor: the stricter of two, `applicability >= max(ceil(sqrt(F)), ceil(0.25 * F))`, where `F` is the files the dimension can speak about | v3 promised this floor and gave it no number, no gate, no storage, no test. Each floor alone is wrong: the root asks for more than a quarter below sixteen files, where a quarter of a small directory is one or two files, and the share is what holds above it. Measured: the root alone asked 11 files of 120, and a 120-file area where 11 files used `?.` and 109 read absent values without it stated the claim over all 120 | **done** `reduce.mjs` (`GATES.minApplicabilityShare`, gate name `applicability`) |
| C5 | Dimensions carry `precision: precise \| partial`. A `partial` dimension can never reach top severity | 3 of 8 measured predicates are partial | partial |
| C6 | A dimension may state its inverse only where it carries a hand-written `counterClaim`. Refusal is an explicit `null`, never an absent key. Both sides run the same gate battery, and every gate but the three numerators is polarity-free | 144 dimension slots across ten repositories hold a strong inverse and state nothing. A machine negation names nothing for the agent to write, and writing the sentence out loud is where an inverse that is really a defect becomes visible. 13 of 32 dimensions are eligible; a counter needs the same measured cross-repository spread the claim does | **done** `reduce.mjs` (`judge`), `render.mjs` (`statedSide`), `check.mjs`, `write.mjs` (facts schema 2) |

## D. Gates

| # | Decision | Why | Status |
|---|---|---|---|
| D1 | `conforming / candidates >= 0.90` | The measured gate elsewhere; v1 loosened it to 0.80 with no argument | **done** |
| D2 | `candidates >= 6` | | **done**, and subsumed. D1's Wilson bound is the only count floor the gates read: at 0.90 a perfect record needs 35 sites, so a separate minimum of 6 can never bind. It is `reduce.mjs`'s `evidence` check, and no `GATES` entry spells this number |
| D3 | **The sites are worth at least 3 files by inverse-Simpson count, and the ratio still reaches 0.90 with the largest file dropped** | v3's `files_conforming >= 3` does not block its own motivating case: 200 candidates in one file plus one each in 13 others gives 14 files, ratio 1.0, and every gate passes. The share of candidates this row first proposed cannot answer it either: at two files the largest share is at least 0.5 by arithmetic, and at fifty files no share ever fires however lopsided the spread is. The effective-file count answers concentration and the leave-one-out ratio is what sees a large file holding the rest of the area over 0.90 | **done** `reduce.mjs` (`GATES.minEffectiveFiles`, gate name `concentration`) |
| D4 | `distinct authors >= 2`, counted over files carrying conforming matches, **only when the area holds more than one directory** | Measured twice independently: the unconditional directory gate blocks 124 of 170 slots because area discovery finds leaf directories and a leaf directory has one directory | **done** |
| D5 | Authors from **one** `git log -M --name-status --format=%ae` pass, unioning rename chains. Never `git blame` | Measured: 271x faster (0.84s vs 103s), agrees 99.6-100%, and one formatter commit collapses per-site blame to a single author | **done** `authors.mjs` |
| D6 | All gates read the **baseline** population; "current also holds" prints but never gates | v3 defined the triple and never said which population the gate reads | **done** |
| D7 | Counts print whether or not a directive fires, and `gate` records which one suppressed it | Makes a wrong threshold cost one sentence | **done** |

## E. Baseline and drift

| # | Decision | Why | Status |
|---|---|---|---|
| E1 | Store the baseline **file list** per area at pin time; compute baseline over that list, not the current glob | Moving violating files into a denied or new directory otherwise re-selects only the conforming ones at the baseline sha, ratio 1.00, every guard held | **done** `baseline.mjs`, `scan.mjs` |
| E2 | Baseline conformance from `git show <sha>:<path>`, never the working tree | Otherwise an agent editing baseline files moves the baseline numbers | **done** `baseline.mjs` |
| E3 | Unreachable baseline sha: verify with `git cat-file -e`, then drop to counts-only until a human re-pins. Never fall back to stored counts | Squash-merge-to-main is the common workflow, not the edge | **done** `baseline.mjs`, `scan.mjs` |
| E4 | An area whose candidates all postdate the baseline emits no directive | Greenfield directories are where agents write most | **done** `baseline.mjs`, `scan.mjs` |
| E5 | Re-pin is a separate command that prints the population delta it is about to accept. The plugin never suggests it | v3 had it suggested at the moment of maximum laundering | **done** `bin/anatomiya.mjs pin`, `commands/pin.md` |
| E6 | Drift is files changed in mapped areas over `<baseline>..<base-ref>`, never `..HEAD` | Over HEAD the branch's own changes count as drift, so severity falls as the change under review grows | **done** `baseline.mjs` (one resolver, `check.mjs` defers to it) |
| E7 | Carry a rename map from `git diff --find-renames` into the baseline lookup | A path hash cannot tell a rename from a delete-plus-add, and at the baseline sha the new path does not exist | **done** `baseline.mjs` |

## F. Safety

| # | Decision | Why | Status |
|---|---|---|---|
| F1 | Corpus is `git ls-files -z`, NUL-split, deny-list applied | Git permits newlines in paths; a newline split turns one hostile filename into two entries | **done** `corpus.mjs` |
| F2 | Lexical containment, then realpath both sides, fail closed, read the resolved path | v3 dropped this to one sentence about symlinked directories, which exempts symlinked files | **done** `corpus.mjs` |
| F3 | One encoder, allowlist not denylist: reject non-printable codepoints, NFKC normalise, reject mixed-script paths, reject `\|`, `---`, comment delimiters, backtick runs; cap **before** quoting, on grapheme clusters; emit paths JSON-quoted | Bidi controls and zero-width joiners are category Cf and pass an ASCII control filter; `JSON.stringify` does not escape them either | **done** |
| F4 | Every repository-controlled value goes through F3: paths, area names, author names, commit subjects, branch names, matched source text | | **done** |
| F13 | History is read off the stream, and history git could not read is told apart from history that is empty, by exit code rather than by message | Measured: buffering put an oversize log in the same silent branch as a repository with no commits. Every file came back with no author, every dimension failed the author gate, and the map stated nothing with nothing to say why | **done** `authors.mjs` |
| F5 | Any subprocess: `execFile`, arguments after `--`, reject paths starting with `-`, cwd outside the repository, no network, timeout, streamed stdout byte cap | Measured: `--` neutralises the whole argv class; a tracked file named `--instruction-file-path=.git/config` exfiltrated a secret without it | partial `forge.mjs` |
| F6 | Never buffer subprocess output; `spawn` plus streamed parsing | Measured: `execFile` throws `RangeError: Invalid string length` inside Node's own exit handler, `maxBuffer` does not protect, V8 caps any string at 0x1fffffe8 bytes | partial. Every read that grows with the repository streams: `corpus.mjs`, `ruby.mjs`, `authors.mjs`. What still buffers asks for one bounded thing at a time: `baseline.mjs`, `check.mjs`, `forge.mjs` |
| F7 | A partly-read corpus sets `truncated` and **suppresses every directive** | Counting over an arbitrary subset and rendering it like a complete scan is worse than reporting nothing | **done** `ruby.mjs`, `scan.mjs`. No repository size can set it (B10); the Ruby per-line guard can, and that path is tested end to end |

## G. Scope

| # | Decision | Why | Status |
|---|---|---|---|
| G1 | Dimensions come from the glossary re-audit's 87 Tier A entries, starting with the 8 proven writable | | partial |
| G2 | **Glossary rows are not dimensions.** Nine collapses found; the largest is Postel's Law + Fail fast + Input validation = one `boundary_input_validation` | | todo |
| G3 | Rename entries whose glossary name would misread as a verdict: `boundary_input_validation` not "Postel's Law", quarantine-rate not "Flaky test" | A rendered `1.0` next to "Postel's Law" reads as a philosophical endorsement rather than a measurement | todo |
| G4 | Entries with no denominator are dropped, however visible. OWASP Top 10 is a findings list, not a counted claim | | todo |
| G5 | Success is measured by a with-map / without-map diff on real tasks, never by review-comment counts | Measured: comment data only sees what got *through* review. Preventable comments are 8.5% of the corpus, the cheapest ones, and 93.5% of PRs are unaffected. The pre-review effect is unmeasured, not disproven | todo |

---

## What is deliberately not built

- **No hooks.** Worst-trusted channel, highest complexity, measured being flagged as prompt injection.
- **No MCP server.** Nothing to expose.
- **No skill.** It would spend resident context describing the tool instead of the repository.
- **No health score or grade.** It changes nothing about the next line of code.
- **No restating what the linter already enforces.**
- **No "catches bugs earlier" claim.** Measured: 1 of 317 defect comments across ten repositories was preventable by a conventions map. Nine of ten repositories scored zero.
