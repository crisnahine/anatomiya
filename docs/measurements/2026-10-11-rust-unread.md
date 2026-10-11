# Rust files the vendored grammar leaves unread

Date: 2026-10-11. Build: commit `eac5b08`, a checkout with no change of its own.
`2026-10-11-invalid-inputs.md` found, on the way to another question, 23 Rust files that rustc
accepts at their crate's edition and that the vendored `tree-sitter-rust` leaves unread: 22 in
vercel/next.js (29,073 of its 299,363 Rust lines, 9.71%) and 1 in microsoft/vscode. B63's "Rust 0 of
1,126" holds for the three repositories it names. This file says why each of the 23 is unread, and
whether any newer release of the grammar reads them.

## The question

1. For each of the 23 files: which construct makes the grammar reject it?
2. Is any grammar the plugin vendors behind its newest release on npm, and what did each newer
   release add?
3. For Rust: does the newest release `web-tree-sitter` 0.27.0 can load read the 23, does it leave
   unread any file 0.24.0 reads, and which map lines move under it?

## Method

### Classing the 23

The method of `2026-10-08-reference-parsers.md`. Each file was read by the grammar to find its ERROR
and MISSING nodes, the construct at each was named, and a rewrite was written per construct. Each
rewrite was applied to the file alone, then all together, then all but one, and each result handed
to `parseTreeFile` in `plugins/anatomiya/lib/tree-sitter-file.mjs` with no option but `grammars`. A
file needs a rewrite when, with every other rewrite applied, the grammar still cannot read it.

| rewrite | what it does |
|---|---|
| `box` | `box ` taken out of a pattern |
| field attribute | an attribute line taken out where a field of a struct pattern follows |
| `raw` as a name | `&raw` made `&raw_` where `const` or `mut` does not follow |
| `unsafe extern` | `unsafe` taken out before `extern "..." {` |

The 23 files as written, the 23 rewritten and nine written inputs of one construct each then went
through rustc in a container, as `2026-10-08-reference-parsers.md` runs it: `rust:1.99.0-slim`,
digest `sha256:2752b332db73fdbb7dc576f06c82ed1f312005784ef913d7e04a28f5f55dc581` (the digest
`2026-10-11-invalid-inputs.md` records), rustc 1.99.0 (b940084d7 2026-09-28),
`-Zparse-crate-root-only`, network off, each file at its crate's edition. vscode's file is at 2021,
next.js's at 2024, the written inputs at 2024.

### Newer releases

`npm view <package> dist-tags versions time` for each of the seven grammar packages and for
`web-tree-sitter`, and `gh release list` on each grammar's repository. For Rust, the release notes
and the commits between tags were read, and the release assets `tree-sitter-rust.wasm` of v0.24.1
and v0.24.2 were downloaded and loaded by `web-tree-sitter` 0.27.0.

### The corpus

Every Rust file `collect` in `corpus.mjs` returns, in every repository of both corpora that holds
one: microsoft/vscode, react, supabase and vercel/next.js of `anatomiya-corpus`, ripgrep, ktor,
serde and tokio of `anatomiya-corpus-langs`. 2,357 files. Each was handed to `parseTreeFile` with
`withProgram` set, once per grammar, and the two records compared as JSON text: verdict, hits,
facets and the copied tree.

Maps: each of the eight repositories was copied with `cp -Rc` and scanned by the base build, then
copied fresh and scanned by a build that differs only in `rust.wasm`: a `git archive` of `eac5b08`
with v0.24.2's asset put in place of the package file and `node scripts/grammars.mjs` run to vendor
it. Every file the scan wrote under `.claude/` was compared, times masked. The machine's one-minute
load stayed above 12 for the 20 minutes the run waited, and it ran at 19 to 40.

## The 23 files, by construct

| files | construct | rewrite | stable Rust | example |
|---|---|---|---|---|
| 12 | `box` in a pattern | `box` | no: `#![feature(box_patterns)]`, nightly | next.js `turbopack/crates/turbopack-trace-server/src/self_time_tree.rs:138` `if let Some(box SelfTimeChildren {` |
| 9 | an attribute on a field of a struct pattern | field attribute | yes | next.js `turbopack/crates/turbo-persistence/src/static_sorted_file_builder.rs:802` `#[cfg(debug_assertions)]` before `small_block_id,` in `if let ValueRef::PendingSmall {` |
| 3 | `raw` as a name after `&` | `raw` as a name | yes | vscode `cli/src/tunnels/agent_host_registry.rs:488` `serde_json::from_str(&raw)` |
| 2 | an `unsafe extern` block | `unsafe extern` | yes, and required at edition 2024 | next.js `turbopack/crates/turbo-tasks/src/event.rs:320` `unsafe extern "C" {` |

3 files need two (`box` and a field attribute): `turbo-tasks-backend/src/backend/mod.rs`,
`backend/operation/aggregation_update.rs` and `backend/operation/invalidate.rs`. So the classes sum
to 26. With every rewrite applied the grammar reads all 23, and rustc accepts all 23 rewritten texts
as it accepts all 23 as written.

next.js pins `nightly-2026-07-29` in `rust-toolchain.toml`, which is how its `box` patterns build.
rustc stopped after parsing accepts a `box` pattern; run to metadata on the stable 1.99.0 it rejects
the same input with E0658, `box pattern syntax is experimental`, which is a feature gate and no
syntax error.

| class | files | lines |
|---|---|---|
| `box` | 12 | 18,620 |
| field attribute | 9 | 15,635 |
| `raw` as a name | 3 | 3,116 |
| `unsafe extern` | 2 | 973 |

A file needing two is counted in both rows. The other files of the three `raw` names are
`turbo-persistence/src/bin/sst_inspect.rs` (`&raw.data`) and
`turbopack-core/src/source_map/structured.rs` (`&raw.to_bytes()`, `&raw`). The other `unsafe extern`
is `turbo-tasks/src/vc/mod.rs`. Both blocks sit inside a function body.

7 of the 22 next.js files hold a `let` chain (`&& let`). None needs a rewrite of one: the vendored
grammar reads `if let Some(x) = a && let Some(y) = b && x > y {}` with no error, and in those files
the error sits at a `box` inside the chain.

### Written inputs

One construct each, three to seven lines, read by each grammar and by rustc at 2024.

| input | 0.24.0 | 0.24.1 | 0.24.2 | rustc |
|---|---|---|---|---|
| `if let Some(box y) = x {}` | unread | unread | unread | accepted |
| `let S { #[cfg(debug_assertions)] a, .. } = s;` | unread | unread | unread | accepted |
| `S { #[cfg(debug_assertions)] a }`, a struct expression | read | read | read | accepted |
| `g(&raw);` | unread | read | read | accepted |
| `let b = &raw.data;` | unread | read | read | accepted |
| `let p = &raw const x;` | read | read | read | accepted |
| `unsafe extern "C" { fn g(); }` inside a function | unread | read | read | accepted |
| the same at the top level | unread | read | read | accepted |
| `if let Some(x) = a && let Some(y) = b && x > y {}` | read | read | read | accepted |

So each class has a short form that breaks the grammar, and an attribute on a field breaks it in a
pattern only.

## Newer releases

Every vendored grammar is at the newest version on npm, and `latest` is the only dist-tag each has.

| package | vendored | newest on npm | newest GitHub release |
|---|---|---|---|
| `tree-sitter-python` | 0.25.0 | 0.25.0 | v0.25.0 |
| `tree-sitter-php` | 0.24.2 | 0.24.2 | v0.25.1 (2026-10-06) |
| `tree-sitter-go` | 0.25.0 | 0.25.0 | v0.25.0 |
| `tree-sitter-java` | 0.23.5 | 0.23.5 | v0.23.5 |
| `tree-sitter-c-sharp` | 0.23.5 | 0.23.5 | v0.23.5 |
| `tree-sitter-rust` | 0.24.0 | 0.24.0 | v0.24.2 (2026-03-27) |
| `@tree-sitter-grammars/tree-sitter-kotlin` | 1.1.0 | 1.1.0 | v1.1.0 |

`web-tree-sitter` is at 0.27.1 on npm (2026-10-08); the plugin pins 0.27.0.

Two grammars have GitHub releases that never reached npm. PHP v0.25.0 lists partial function
application from PHP 8.6, asymmetric visibility in constructor promotion and two scanner fixes, and
v0.25.1 `clone` with arguments; neither was measured here. Rust:

- **v0.24.1** (2026-03-19). Its notes say only where to find the source. The commits since v0.24.0:
  "Raw reference/identifier conflict (#288)", which also makes `foreign_mod_item` take an optional
  `unsafe` in place of an optional visibility and lets `raw` be an identifier; "Parse string
  literals even in with unexpected prefixes (#306)"; a regenerated parser; CI updates.
- **v0.24.2** (2026-03-27). The same notes. One grammar commit: "Fix bad error recovery when
  parsing repeated string literals (#307)", which moves a string's closing quote into the external
  scanner. v0.24.2 is the head of the default branch.

The npm job of the publish workflow failed for both tags (runs 23306701973, 23307534441 and
23667504319), and upstream issue tree-sitter/tree-sitter-rust#318, open since 2026-09-26, says
0.24.2 has not been published. Each release carries `tree-sitter-rust.wasm` as an asset; the source
tarball and the git tree hold no wasm. Both assets report ABI 15 and load in `web-tree-sitter`
0.27.0. The vendored 0.24.0 wasm reports ABI 14 (B61).

Neither `box` patterns nor attributes on pattern fields are in the grammar at v0.24.2. Two open pull
requests add the second (#301 from 2026-02-06 and #319 from 2026-10-05); nothing open adds the
first.

## v0.24.2 over the corpus

| repository | Rust files | lines | unread at 0.24.0 | lines | unread at 0.24.2 | lines |
|---|---|---|---|---|---|---|
| microsoft/vscode | 87 | 29,774 | 2 | 1,618 | 1 | 26 |
| react | 120 | 76,568 | 0 | 0 | 0 | 0 |
| supabase | 1 | 7 | 0 | 0 | 0 | 0 |
| vercel/next.js | 1,015 | 299,363 | 22 | 29,073 | 18 | 26,576 |
| BurntSushi/ripgrep | 110 | 56,496 | 0 | 0 | 0 | 0 |
| ktorio/ktor | 8 | 1,463 | 0 | 0 | 0 | 0 |
| serde-rs/serde | 208 | 42,831 | 0 | 0 | 0 | 0 |
| tokio-rs/tokio | 808 | 187,073 | 0 | 0 | 0 | 0 |
| **all eight** | 2,357 | 693,575 | 24 | 30,691 | 19 | 26,602 |

v0.24.1 gives the same verdict as v0.24.2 on every file. vscode's other unread file is the
colouriser fixture `test-6611.rs`, which rustc rejects (`2026-10-11-invalid-inputs.md`), and it
stays unread. next.js goes from 9.71% of its Rust lines unread to 8.88%.

Five files become read, the five of the `raw` and `unsafe extern` classes: vscode's
`agent_host_registry.rs`, and next.js's `sst_inspect.rs`, `event.rs`, `vc/mod.rs` and
`structured.rs`. No file 0.24.0 reads is unread under v0.24.2. The other 2,352 records are the same
JSON text under both grammars, the copied tree included, so the string-literal changes of #306 and
#307 move no node of any file the corpus holds.

### Maps

ktor, supabase, ripgrep, serde and tokio: every written file identical. react: one line, the
`measuredUnder` stamp of `anatomiya/facts.json`, which hashes the build and so differs between the
two builds whatever they read. vscode and next.js, apart from that stamp:

| repository | file | what moved |
|---|---|---|
| vscode | `rules/anatomiya-overview.md` | "6 files could not be read by this tool's grammar" made 5 |
| vscode | `rules/anatomiya-area-72d5d269.md` (`cli/src/tunnels`) | "0 of 22 have a namesake test; 8 hold their own tests" made 21 and 9; doc comments "66 of 145 sites" made "75 of 155" |
| vscode | `anatomiya/facts.json` | `syntaxErrors` 8 to 7, `rejections.grammar` 6 to 5; the `cli/src/tunnels` row and companions above, with its bounds and exceptions; `priorBound` and `counterPriorBound` of `public_doc_comment` in 8 other areas |
| vscode | `anatomiya/layout.json` | `record.size`, the byte size of the facts file |
| next.js | `rules/anatomiya-overview.md` | 22 made 18 |
| next.js | `rules/anatomiya-area-43729937.md` (`turbopack/crates/turbo-tasks/src`) | "0 of 50 ... 15 hold their own tests" made 49 and 16; doc comments "122 of 196" made "123 of 204" |
| next.js | `rules/anatomiya-area-5bc67ecd.md` (`turbo-tasks/src/vc`) | doc comments "37 of 46" made "54 of 64" |
| next.js | `rules/anatomiya-area-66fecf83.md` (`turbopack-core/src`) | "0 of 50 ... 8 hold their own tests" made 49 and 9; doc comments "243 of 355" made "243 of 361" |
| next.js | `anatomiya/facts.json` | `syntaxErrors` 29 to 25, `rejections.grammar` 22 to 18; the rows above, and `langFileCount` of `turbo-persistence/src` 27 to 28; `priorBound` and `counterPriorBound` of `public_doc_comment` in 25 other areas |
| next.js | `anatomiya/layout.json` | `record.size` |

Every moved line has one cause: a file became read. Each area whose own counts moved holds one of
the five files. The count of files that hold their own tests rises by one in the three areas whose
newly read file holds a `#[cfg(test)]` module, the five files' facets say so, and the namesake
denominator falls by the same one. The `priorBound` lines are the repository's prior for the doc
comment row, which every area of the repository shares, so new sites in one area move it in all. The
areas, `stated` and `orphaned` and `barren` counts of all eight repositories are unchanged.

## What this pass does not show

- **Whether v0.24.2 should ship.** It is not on npm, so the way the repository updates a grammar
  (`npm install` of the package, `npm run lock:plugin`, `node scripts/grammars.mjs`, `--check`)
  cannot reach it: `--check` holds the vendored file to the installed package's file and the
  manifest's version to the lockfile's.
- **Forks.** npm holds republished Rust grammars, `@willbooster/tree-sitter-rust` 2.0.7 among them,
  published by the fork B59 refused for Kotlin. None was measured.
- **PHP v0.25.x**, which is not on npm either.
- **Repositories beyond the eight.** Rust holds 2,357 files over both corpora, and 23 of the 24
  unread are in two repositories.
- **The lines column.** Lines are the text split on `\n`, as in `2026-10-11-invalid-inputs.md`, one
  more than a count of line breaks for each file that ends in one.

## Reproducing

In a scratch directory outside the repository: `errs.mjs` lists ERROR and MISSING nodes per file,
`classify.mjs` applies the rewrites, `survey.mjs` reads every Rust file of the corpus with each
grammar directory, `same.mjs` compares the records whole, `drive.mjs` and `run.sh` scan the copies
with both builds, `rc/` holds the rustc inputs and `rc/out/rustc.tsv` its verdicts, and `rel/` the
two release assets.
