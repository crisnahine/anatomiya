# Written invalid inputs for Java, C#, Rust and Kotlin

Date: 2026-10-11. Build: commit `c4fa060`, a checkout with no change of its own. The
corpus pass of `2026-10-08-reference-parsers.md` found no file of these four languages that the
grammar reads and the language's own parser rejects. That says the twelve repositories held no
broken file. It does not say what a grammar does with one. This pass writes the broken files, as
B63 did for Python, PHP and Go, and then looks for their shapes in real repositories.

## The question

For each written input, two answers:

1. The language's own parser's, syntax only: does it reject the text?
2. The grammar's: does `parseTreeFile` read it with no error?

An input enters the count only when the parser rejects it. Of those, the ones the grammar reads are
the one-sided gate of B63 at work: text the language refuses and the tool counts.

## Method

### The inputs

One construct per input, each a file of one to seven lines. Most are a valid class or function
with one line made wrong; the rest are a top-level line or two. They were written before either
parser was run, and every candidate the parser accepted is listed apart and left out of the count.
Rust inputs are parsed at edition 2021, apart from `gen-as-name-2024.rs` at 2024. Kotlin files are
named `.kt`, so a top-level statement is not a script. The generator, `gen.mjs`, holds every text.

### The grammar's verdict

Each input read as UTF-8 and handed to `parseTreeFile` in
`plugins/anatomiya/lib/tree-sitter-file.mjs` with its file name and language id and no option set,
so a C# file gets B64's retries as a scan would. `ok: true` is read. Runtime and grammars as
`grammars.json` records them: `web-tree-sitter` 0.27.0, `tree-sitter-java` 0.23.5,
`tree-sitter-c-sharp` 0.23.5, `tree-sitter-rust` 0.24.0,
`@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0, on Node 22.

### The parsers

The four drivers of `2026-10-08-reference-parsers.md`, copied from it unchanged and run the same
way: `linux/arm64`, one container at a time, the inputs mounted read-only and the network off for
every run but the C# restore and build.

| language | image | digest | parser |
|---|---|---|---|
| Java | `eclipse-temurin:25-jdk` | `sha256:8c0a84ea11c8f6ed52600fc19f1040121f2a162998e9f50a5faebbbad9172dcc` | javac of Temurin 25.0.4.1, `JavacTask.parse()`, level 25 |
| Kotlin | `eclipse-temurin:25-jdk` | the same | `kotlin-compiler-embeddable` 2.4.21 PSI parser (jar SHA-256 `ef19419c...1f02`, the same file) |
| Rust | `rust:1.99.0-slim` | `sha256:2752b332db73fdbb7dc576f06c82ed1f312005784ef913d7e04a28f5f55dc581` | rustc 1.99.0 (b940084d7 2026-09-28), `-Zparse-crate-root-only` |
| C# | `mcr.microsoft.com/dotnet/sdk:10.0.401` | `sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317` | Roslyn 5.9.0, `CSharpSyntaxTree.ParseText`, latest (C# 14), no symbol defined |

The Rust digest is the one `docker image inspect` gave for the pull of the same tag; it differs
from the one the 2026-10-08 file records, and `rustc -V` prints the same build.

## The counts

| language | written | rejected by the parser | rejected and read clean by the grammar | accepted by the parser, left out |
|---|---|---|---|---|
| Java | 26 | 24 | 16 | 2 |
| C# | 34 | 25 | 8 | 9 |
| Rust | 25 | 21 | 9 | 4 |
| Kotlin | 33 | 25 | 4 | 8 |
| **all four** | 118 | 95 | 37 | 23 |

Kotlin had 35 candidates. Two the parser rejected and the grammar left unread, `val x = 1 ?:` and
`x = = 1`, were dropped to hold the set at 25; each repeats a shape already in it.

Beside B63's: Python 15 of 20, PHP 11 of 18, Go 6 of 15. Over the seven languages the grammars
read 69 of 148 rejected inputs with no error, 68 with B63's Python `match` input set aside.

## Rejected and read clean, by input

The first diagnostic of the parser is quoted as it printed it.

### Java, 16 of 24

| input | text | javac |
|---|---|---|
| `const-as-name` | `int const = 1;` | `compiler.err.expected` (`<identifier> expected`) |
| `goto-statement` | `goto x;` | `compiler.err.illegal.start.of.expr` |
| `declaration-as-if-body` | `if (true) int x = 1;` | `compiler.err.variable.not.allowed` |
| `declaration-after-label` | `l: int x = 1;` | `compiler.err.variable.not.allowed` |
| `expression-not-statement` | `1 + 2;` | `compiler.err.not.stmt` |
| `lambda-as-statement` | `x -> 1;` | `compiler.err.not.stmt` |
| `method-reference-as-statement` | `a::b;` | `compiler.err.not.stmt` |
| `var-compound-declaration` | `var x = 1, y = 2;` | `compiler.err.restricted.type.not.allowed.compound` |
| `var-array-type` | `var[] x = null;` | `compiler.err.restricted.type.not.allowed.array` |
| `varargs-not-last` | `void f(int... a, int b) {}` | `compiler.err.varargs.must.be.last` |
| `repeated-modifier` | `public public void f() {}` | `compiler.err.repeated.modifier` |
| `record-instance-field` | `record R(int x) { int y; }` | `compiler.err.record.cannot.declare.instance.fields` |
| `two-package-clauses` | `package a;` then `package b;` | `compiler.err.expected4` |
| `illegal-string-escape` | `"a\qb"` | `compiler.err.illegal.esc.char` |
| `two-char-literal` | `'ab'` | `compiler.err.unclosed.char.lit` |
| `text-block-same-line` | `"""abc"""` | `compiler.err.illegal.text.block.open` |

Read by neither: a missing `;`, `extends B, C`, `try {}` alone, `new int[2] {1, 2}`, `''`, `0x`,
`1_`, `08`.

### C#, 8 of 25

| input | text | Roslyn |
|---|---|---|
| `using-after-member` | `namespace N {}` then `using System;` | CS1529 |
| `goto-without-label` | `goto;` | CS1001 `Identifier expected` |
| `return-return` | `return return;` | CS1525 `Invalid expression term 'return'` |
| `define-after-token` | `class A {}` then `#define X` | CS1032 |
| `unclosed-region` | `#region R` with no `#endregion` | CS1038 |
| `error-directive` | `#error stop` | CS1029 |
| `line-directive-not-number` | `#line abc` | CS1576 |
| `if-directive-bad-expression` | `#if (` ... `#endif` | CS1517 |

The last two are rejected by the grammar as written and read after B64's retry blanks the
directive lines; nothing is dropped, so the record carries no `oneBranch`. The other six are read
as written.

Read by neither: a missing `;`, `int x = 1 2;`, `''`, `'ab'`, `"a\qb"`, `0x`, `1_`, an unclosed
`@"`, an unclosed `$"{`, `new;`, `: B, {}`, a second `else`, `foreach (var x)`, `enum E { A B }`, a
stray `}`, `#if X` with no `#endif`, `#endif` with no `#if`.

### Rust, 9 of 21

| input | text | rustc |
|---|---|---|
| `chained-comparison` | `a < b < c;` | comparison operators cannot be chained |
| `cast-then-less-than` | `x as u8 < y` | `<` is interpreted as a start of generic arguments |
| `qualifiers-out-of-order` | `async const fn f() {}` | expected one of `extern`, `fn`, `safe`, or `unsafe` |
| `async-as-name` | `let async = 1;` (2021) | expected identifier, found keyword `async` |
| `try-as-name` | `let try = 1;` (2021) | expected identifier, found reserved keyword `try` |
| `gen-as-name-2024` | `let gen = 2;` (2024) | expected identifier, found reserved keyword `gen` |
| `illegal-string-escape` | `"\q"` | unknown character escape |
| `empty-char-literal` | `''` | empty character literal |
| `non-ascii-byte-string` | `b"é"` | non-ASCII character in byte string literal |

Read by neither: a missing `;`, `pub pub`, `'ab'`, `0x`, `0b102`, an unclosed `r#"`, a field or a
match arm with no comma, `if x return;`, `else if {}`, `fn f() -> {}`, `x += = 2`.

### Kotlin, 4 of 25

| input | text | Kotlin parser |
|---|---|---|
| `hash-after-expression` | `val x = 1 #` | Property getter or setter expected |
| `backslash-operator` | `val x = 1 \ 2` | Property getter or setter expected |
| `adjacent-strings` | `val x = "a" "b"` | Property getter or setter expected |
| `top-level-statement-kt` | `println(1)` in a `.kt` file | Expecting a top level declaration |

The first two are the inputs the 2026-10-08 file named. Read by neither: two statements or two
properties on one line, `a b`, `1 @ 2`, `1L L`, `val x =`, `val x: = 1`, `1 +`, `x?.`, `class A :
{}`, `(val x: Int,, ...)`, `import a.b.*.c`, two `package` lines, `init` with no block,
`typealias = Int`, `if { }`, `for (i in)`, `do {}`, `try { 1 }` alone, `when` with no comma, `enum
class E { A B }`.

## The classes

The 37 fall in five kinds. Each is a rule the language's own parser applies and the grammar's
rules do not state.

| kind | Java | C# | Rust | Kotlin | what the grammar does |
|---|---|---|---|---|---|
| a token the lexer refuses: an escape, a char or byte literal, a text block opener, a stray character | 3 | 0 | 3 | 2 | its token pattern is wider than the lexer's |
| a reserved word used as a name | 2 | 0 | 3 | 0 | `goto`, `const`, `async`, `try`, `gen` are names to it |
| a statement, declaration or expression in a place or form the language forbids | 5 | 2 | 0 | 2 | the rule lists the construct without the place |
| a combination the parser checks after it builds the node: repeated modifier, `var` limits, varargs last, record field, chained comparison, qualifier order, a cast before `<` | 5 | 0 | 3 | 0 | no rule states the combination |
| a file-level order or a preprocessor rule: two `package` lines, `using` after a member, `#define` after a token, an unclosed `#region`, `#error`, a bad `#line` or `#if` | 1 | 6 | 0 | 0 | directives are trivia, and the order of top-level items is free |

`adjacent-strings` and `println(1)` in a `.kt` file count under place: the grammar takes `"b"` for a
second top-level item, and a call for one. `goto;` and `return return;` count there for C#.

## Accepted by the parser, left out

23 candidates the parser accepted, so they say nothing about the gate. Most are rules a later pass
of the compiler applies, which no syntax-only driver runs.

| language | input | grammar |
|---|---|---|
| Java | `switch` mixing `case 1 ->` and `case 2:` | unread |
| Java | `yield 1;` outside a `switch` | read |
| C# | `public public`, `1 + 2;`, `x => 1;`, `if (true) int x = 1;`, `var x = 1, y = 2;`, `params` before another parameter, `new int[2] {1}`, two file-scoped namespaces, a file-scoped then a block namespace | `1 + 2;` and `x => 1;` unread, the other seven read |
| Rust | `1u7`, `fn f<T, 'a>()`, `fn f(self)`, an `extern` block function with a body | `1u7` unread, the other three read |
| Kotlin | `''`, `'ab'`, `0x`, `"a\qb"`, `public public`, `vararg` with no name, `val (a, b)` with no initializer, `1 = 2` | `''`, `'ab'`, `0x` and `vararg` unread, the other four read |

Roslyn's parser is the widest of the four: 9 of its 34 candidates were left to the binder. The
Kotlin parser leaves malformed character and number literals to a later pass.

## The shapes in real repositories

Two searches. The second is the one that decides.

### By text

One `rg` pattern per class over both corpora (`shapes.sh`), lines that open a comment left out.
Every hit was valid code: the text sat in a string, a raw string, a text block, or a JSON or regex
literal (`"""` closing a text block, `\p{Any}` in an `r"..."`, `'name':'v1'` inside a Java
string). A second pass with tighter patterns (more than one `package` line in a file, `#region`
and `#endregion` counts that differ, a `using` directive after a type declaration, a call at the
start of a line of a `.kt` file other than `context(`) found none. A text pattern cannot say a
file is broken; it only says where to look.

### By parser, over the corpus repositories the 2026-10-08 pass did not run

The 2026-10-08 pass ran the parsers over the twelve repositories of `anatomiya-corpus-langs` that
hold these languages and found nothing read and rejected. Eight repositories of
`anatomiya-corpus` hold files of the four too. Their files, as `collect` returns them, went through
`parseTreeFile` and through the same four drivers, the corpus mounted read-only. Rust editions
were taken from each file's crate as the 2026-10-08 file describes: 1,129 files at 2024 and 94 at
2021.

| repository | commit | language | files | read and accepted | unread and accepted | read and rejected | unread and rejected |
|---|---|---|---|---|---|---|---|
| appsmithorg/appsmith | `33ec552` | Java | 2,077 | 2,077 | 0 | 0 | 0 |
| fastlane/fastlane | `38d0ec4` | Java | 22 | 22 | 0 | 0 | 0 |
| microsoft/vscode | `a589bb7` | Java | 2 | 2 | 0 | 0 | 0 |
| microsoft/vscode | `a589bb7` | C# | 2 | 1 | 0 | **1** | 0 |
| microsoft/vscode | `a589bb7` | Rust | 87 | 84 | 1 | **1** | 1 |
| `react__react` | `beef6d6` | Rust | 120 | 120 | 0 | 0 | 0 |
| supabase/supabase | `18dc7e9` | Kotlin | 58 | 58 | 0 | 0 | 0 |
| supabase/supabase | `18dc7e9` | Rust | 1 | 1 | 0 | 0 | 0 |
| vercel/next.js | `c77d3f4` | Rust | 1,015 | 993 | 22 | 0 | 0 |
| **all eight** | | | 3,384 | 3,358 | 23 | 2 | 1 |

instructure/canvas-lms and puppetlabs/puppet hold one and three files of these extensions that
`collect` does not return as source. Commits are abbreviated; each working tree was clean.

The two read and rejected:

- vscode `extensions/vscode-colorize-tests/test/colorize-fixtures/test-166781.rs`, a syntax
  colouring fixture of six lines that opens with `let _ = b"\` at the top level. rustc: `expected
  item, found keyword let`. The Rust grammar's `source_file` takes a statement where the language
  takes only an item.
- vscode `extensions/copilot/test/scenarios/test-explain/functions.cs`, a test-scenario snippet:
  two methods at the top level, each with `public`, then a call. Roslyn: CS0106, `The modifier
  'public' is not valid for this item`. C# allows a local function among top-level statements, and
  no access modifier on one; the grammar takes the modifier.

Neither is code meant to compile: one is input to a colouriser test, the other a prompt for a
model. Both are read with no site for any row: a top-level method is no member of a type, and
neither file holds anything else a row asks about. What they add to the map is two files to their
directories' counts.

The unread and rejected one is the colouriser's `test-6611.rs`, a function with no parameter list.

The two classes are not in the written set, and they are one kind: a statement or a declaration
at the top level of a file whose language takes only items there. The written set's Kotlin
`println(1)` in a `.kt` file is the same kind.

### Unread and accepted, as found on the way

Not the question of this file, and not classed. vscode's `cli/src/tunnels/agent_host_registry.rs`
(1,592 lines) and 22 files of next.js, 29,073 of its 299,363 Rust lines (9.71%), are accepted by
rustc at edition 2024 and left unread by the Rust grammar. 7 of the 22 hold a `let` chain
(`&& let`). B63's "Rust 0 of 1,126" holds for the three repositories it names.

## What this pass does not show

- **Inputs beyond one construct.** Each input holds one fault. A file with two faults, one the
  grammar sees, is unread whatever the other is.
- **Which parse errors are syntax.** The count follows each driver: javac's `parse()`, Roslyn's
  syntax tree diagnostics, rustc stopped after parsing, and the Kotlin `PsiErrorElement`s. A rule
  each compiler applies later, such as Roslyn's CS0201 for `1 + 2;`, is no rejection here.
- **A Java level other than 25, and a C# symbol set.** As in the 2026-10-08 file.
- **Repositories beyond the twenty.** Twelve from the 2026-10-08 pass and eight here.
- **The lines column.** Lines here are the file's text split on `\n`; the 2026-10-08 file does not
  say how it counted, so its line totals and these may differ by one per file.

## Reproducing

Everything lives in a scratch directory outside the repository: `gen.mjs` writes the
inputs, `grammar.mjs <worktree>` the grammar's verdicts, the four drivers are the 2026-10-08
file's, `survey.mjs <worktree> <out> <repo>...` lists and reads a repository's files, and
`shapes.sh` holds the text searches.
