# The reference parsers for Java, C#, Rust and Kotlin over the corpus

Date: 2026-10-08. Build: commit `8efafd6`, read from a `git archive` copy. The measuring machine
holds no compiler for any of these four languages (DECISIONS B60), so each language's own parser was
run in a container over the files a scan reads, in both directions. DECISIONS B59, B60 and B63
state what it found.

## The question

For every file of the four languages in three repositories each, two answers:

1. The grammar's: did `parseTreeFile` read the file, or leave it unread?
2. The language's own parser's, syntax only: does it accept the text, or reject it?

Joined per file that gives four cells. Read and accepted is the ordinary case. Unread and accepted
is the grammar's loss. Read and rejected is the one-sided gate of B63: a file the tool counts and
its language refuses. Unread and rejected is a broken file, left out as it should be.

## Method

### The grammar's verdict

The files are the ones `collect` in `corpus.mjs` returns for each repository, kept where their
language is one of the four. Each is read as UTF-8 and handed to `parseTreeFile` in
`plugins/anatomiya/lib/tree-sitter-file.mjs`, the function the worker calls, with no option set. A
record with `ok: true` is read, any other is unread. Runtime: `web-tree-sitter` 0.27.0 on Node
22.22.3. Grammars, as `grammars.json` records them: `tree-sitter-java` 0.23.5,
`tree-sitter-c-sharp` 0.23.5, `tree-sitter-rust` 0.24.0, `@tree-sitter-grammars/tree-sitter-kotlin`
1.1.0.

For C# the same grammar was also asked about the text as written and about the text with a line
break appended, to say which of B64's three attempts read each file.

### The repositories

| language | repository | commit |
|---|---|---|
| Java | apache/commons-lang | `682a8ff5cddfeedecb98f62ac7c8d94b5ff65f33` |
| Java | junit-team/junit5 | `47bbcd1f19ec23fc9b357bd4893fd9d40ef8df89` |
| Java | google/gson | `845664ba1c307e6c1910d07cfed2f622e0ad8df1` |
| C# | jellyfin/jellyfin | `32efb47601d3ce4174f61a66181d9e4665288c92` |
| C# | serilog/serilog | `bebc7719004f76187ae72e64ce138ec2540f2070` |
| C# | JamesNK/Newtonsoft.Json | `52fa3aef1f2cadcd3a3f874251eddc98d3efbbaa` |
| Rust | BurntSushi/ripgrep | `3fce3b5bb0236da2df6d99672afb8a719642eca7` |
| Rust | tokio-rs/tokio | `16b1f9d2cfbdcab4966cdb80da0416786e8feeef` |
| Rust | serde-rs/serde | `6693a89cca77e0151437da1c7f890090b9ebf04c` |
| Kotlin | square/okhttp | `42e5888d45623662c138ed27e80ea28bbe0aa5cc` |
| Kotlin | ktorio/ktor | `f76c50da18f6b284ce4ae7b4e84bed4c9aea5ce0` |
| Kotlin | Kotlin/kotlinx.serialization | `938b86dd400a3a75f390009052e72569b947fc2a` |

Every working tree was clean. The corpus was mounted read-only into each container, and no build
script, wrapper or project file from it was run: each driver reads source files as data.

### The parsers

All images are `linux/arm64`, one container at a time. Each driver takes a list of paths, a root and
an output file, and writes one line per file: the path, `A` or `R`, and for a rejection the line,
the code and the text of the first diagnostic.

| language | image | digest | parser |
|---|---|---|---|
| Java | `eclipse-temurin:25-jdk` | `sha256:8c0a84ea11c8f6ed52600fc19f1040121f2a162998e9f50a5faebbbad9172dcc` | javac of Temurin 25.0.4.1, `JavacTask.parse()` |
| Kotlin | `eclipse-temurin:25-jdk` | the same | `kotlin-compiler-embeddable` 2.4.21, its PSI parser |
| Rust | `rust:1.99.0-slim` | `sha256:24e632c09342c20abf8312cf4f61430a911c01ed3a5e4c02b87292b1c39c5273` | rustc 1.99.0 (b940084d7 2026-09-28), `-Zparse-crate-root-only` |
| C# | `mcr.microsoft.com/dotnet/sdk:10.0.401` | `sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317` | Roslyn, `Microsoft.CodeAnalysis.CSharp` 5.9.0, `CSharpSyntaxTree.ParseText` |

**Java.** One `JavacTask` per file, `parse()` and nothing after it, so no symbol is entered or
attributed. Diagnostics of kind `ERROR` count. Run with `java P.java <list> <root> <out>`, with the
network off. The language level is the JDK's default, 25. The pass was repeated with
`--enable-preview --release 25`, `--release 21` and `--release 17`.

```java
import com.sun.source.util.JavacTask;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.tools.*;

// usage: java P.java <list> <root> <out.tsv> [javac options...]
// Each file through javac's own parser, stopped before enter and attribution.
public class P {
  public static void main(String[] a) throws Exception {
    JavaCompiler c = ToolProvider.getSystemJavaCompiler();
    List<String> opts = new ArrayList<>(List.of("-proc:none", "-encoding", "UTF-8"));
    opts.addAll(Arrays.asList(a).subList(3, a.length));
    StringBuilder out = new StringBuilder();
    for (String rel : Files.readAllLines(Path.of(a[0]))) {
      DiagnosticCollector<JavaFileObject> d = new DiagnosticCollector<>();
      try (StandardJavaFileManager fm = c.getStandardFileManager(d, Locale.ROOT, StandardCharsets.UTF_8)) {
        JavacTask t = (JavacTask) c.getTask(null, fm, d, opts, null, fm.getJavaFileObjects(Path.of(a[1], rel)));
        t.parse();
      } catch (Throwable e) {
        out.append(rel).append("\tR\t0\tthrew\t").append(String.valueOf(e).replaceAll("\\s+", " ")).append('\n');
        continue;
      }
      Diagnostic<? extends JavaFileObject> first = null;
      int errors = 0;
      for (Diagnostic<? extends JavaFileObject> x : d.getDiagnostics())
        if (x.getKind() == Diagnostic.Kind.ERROR) { errors++; if (first == null) first = x; }
      if (first == null) out.append(rel).append("\tA\n");
      else out.append(rel).append("\tR\t").append(first.getLineNumber()).append('\t').append(first.getCode()).append('\t')
          .append(first.getMessage(Locale.ROOT).replaceAll("\\s+", " ")).append("\t").append(errors).append('\n');
    }
    Files.writeString(Path.of(a[2]), out);
  }
}
```

**Kotlin.** No `kotlinc` flag was used. The driver is Java over `kotlin-compiler-embeddable`: it
builds a `KotlinCoreEnvironment`, makes a `KtFile` from each file's text through `PsiFileFactory`,
and collects `PsiErrorElement`s. A file with none is accepted. The file keeps its name, so a `.kts`
file is parsed as a script. The jars came from Maven Central into the work directory:
`kotlin-compiler-embeddable`, `kotlin-build-tools-api`, `kotlin-stdlib`, `kotlin-script-runtime`
and `kotlin-daemon-embeddable` at 2.4.21, `kotlin-reflect` 1.6.10, `kotlinx-coroutines-core-jvm`
1.8.0 and `annotations` 13.0, which is what the compiler's own pom names. 2.4.21 was the newest
version on Maven Central with no qualifier. Run with `java -cp 'klib/*' K.java <list> <root> <out>`,
with the network off. SHA-256 of the compiler jar:
`ef19419c765e7ac8404465fa026ca8fc4dbb8a822de0fc79aa53c8dce29f1d02`.

```java
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.jetbrains.kotlin.cli.jvm.compiler.EnvironmentConfigFiles;
import org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment;
import org.jetbrains.kotlin.com.intellij.openapi.Disposable;
import org.jetbrains.kotlin.com.intellij.openapi.util.Disposer;
import org.jetbrains.kotlin.com.intellij.openapi.util.text.StringUtil;
import org.jetbrains.kotlin.com.intellij.psi.PsiErrorElement;
import org.jetbrains.kotlin.com.intellij.psi.PsiFile;
import org.jetbrains.kotlin.com.intellij.psi.PsiFileFactory;
import org.jetbrains.kotlin.com.intellij.psi.util.PsiTreeUtil;
import org.jetbrains.kotlin.config.CompilerConfiguration;
import org.jetbrains.kotlin.idea.KotlinLanguage;

// usage: java -cp 'klib/*' K.java <list> <root> <out.tsv>
// Each file through the compiler's PSI parser: a KtFile is built from the text and its PsiErrorElements collected.
public class K {
  public static void main(String[] a) throws Exception {
    Disposable d = Disposer.newDisposable();
    CompilerConfiguration cfg = new CompilerConfiguration();
    // 2.4 asks for the store compiler plugins register into, and none is loaded here.
    org.jetbrains.kotlin.cli.FrontendConfigurationKeysKt.setExtensionsStorage(cfg, new org.jetbrains.kotlin.compiler.plugin.CompilerPluginRegistrar.ExtensionStorage());
    KotlinCoreEnvironment env = KotlinCoreEnvironment.createForProduction(d, cfg, EnvironmentConfigFiles.JVM_CONFIG_FILES);
    PsiFileFactory factory = PsiFileFactory.getInstance(env.getProject());
    StringBuilder out = new StringBuilder();
    for (String rel : Files.readAllLines(Path.of(a[0]))) {
      try {
        // The compiler reads a file with its line breaks made `\n`, and a BOM dropped.
        String text = StringUtil.convertLineSeparators(new String(Files.readAllBytes(Path.of(a[1], rel)), StandardCharsets.UTF_8));
        if (text.startsWith("﻿")) text = text.substring(1);
        // The name carries the extension: a `.kts` file is parsed as a script.
        PsiFile file = factory.createFileFromText(rel.substring(rel.lastIndexOf('/') + 1), KotlinLanguage.INSTANCE, text);
        Collection<PsiErrorElement> errors = PsiTreeUtil.collectElementsOfType(file, PsiErrorElement.class);
        if (errors.isEmpty()) { out.append(rel).append("\tA\n"); continue; }
        PsiErrorElement first = Collections.min(errors, Comparator.comparingInt(e -> e.getTextRange().getStartOffset()));
        int at = first.getTextRange().getStartOffset();
        long line = text.substring(0, at).chars().filter(c -> c == '\n').count() + 1;
        out.append(rel).append("\tR\t").append(line).append("\tPsiErrorElement\t").append(first.getErrorDescription().replaceAll("\\s+", " ")).append('\t').append(errors.size()).append('\n');
      } catch (Throwable e) {
        out.append(rel).append("\tR\t0\tthrew\t").append(String.valueOf(e).replaceAll("\\s+", " ")).append('\n');
      }
    }
    Files.writeString(Path.of(a[2]), out);
    Disposer.dispose(d);
  }
}
```

The driver was first run on five written inputs: a top-level statement in a `.kts` file (accepted),
the same statement in a `.kt` file (rejected, `Expecting a top level declaration`), `fun f( {`
(rejected, `Expecting ')'`), a file holding a named context parameter, a `$$"` string and a `when`
guard (accepted), and a file with `\r\n` line breaks (accepted).

**Rust.** `rustfmt` was not used: on a stable toolchain it follows each `mod name;` into the next
file. `rustc -Zparse-crate-root-only` parses the one file and stops. The flag is unstable, and a
stable `rustc` takes it with `RUSTC_BOOTSTRAP=1`. The edition is the one the file's crate names:
the nearest `Cargo.toml` above the file with a `[package]` table, and the workspace root's
`[workspace.package]` where that says `edition.workspace = true`. That gave 2024 for all 110 files
of ripgrep and 2021 for all 808 of tokio and all 208 of serde. Run with the network off.

```sh
#!/bin/sh
# usage: rust.sh <edition-and-path list> <root> <out.tsv>
# Each file through rustc's own parser and nothing after it: -Zparse-crate-root-only, which a stable toolchain takes with RUSTC_BOOTSTRAP=1.
tab=$(printf '\t')
: > "$3"
while IFS="$tab" read -r ed rel; do
  out=$(RUSTC_BOOTSTRAP=1 rustc -Zparse-crate-root-only --crate-name u4 --edition "$ed" --error-format=short "$2/$rel" 2>&1)
  if [ $? -eq 0 ]; then printf '%s\tA\t%s\n' "$rel" "$ed" >> "$3"
  else printf '%s\tR\t%s\t%s\n' "$rel" "$ed" "$(printf '%s\n' "$out" | grep -m1 'error' | cut -c1-300)" >> "$3"; fi
done < "$1"
```

The script was first run on four written inputs: `fn f( {` (rejected, an unclosed delimiter); a
file with a `mod` that does not exist, a macro call over `x y z`, a type that does not exist and
`async gen 1` inside a `#[cfg(any())]` function (rejected, and only for the `async gen`); and
`let gen = 2;` at edition 2024 (rejected, a reserved keyword) and at 2021 (accepted). So a missing
module, a type error and the tokens of a macro call do not reject a file, code a `cfg` switches off
is still parsed, and the edition decides.

**C#.** `CSharpSyntaxTree.ParseText` with `LanguageVersion.Latest`, which this Roslyn maps to C# 14,
and no preprocessor symbol defined. Diagnostics of severity error from `tree.GetDiagnostics()`
count, which are the syntax tree's own. The project restores one package,
`Microsoft.CodeAnalysis.CSharp` at `5.*`, which resolved to 5.9.0. The restore used the network.
A second pass, the `named` argument, defines every symbol a file's own `#if` and `#elif` lines
name, so the first branch of each plain `#if X` is the one parsed.

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="5.*" />
  </ItemGroup>
</Project>
```

```csharp
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

// usage: u4 <list> <root> <out.tsv> [named]
// Each file through Roslyn's parser alone: the latest language version, no preprocessor symbol defined,
// and the diagnostics of severity error the syntax tree itself holds.
var options = new CSharpParseOptions(LanguageVersion.Latest);
var output = new StringBuilder();
Console.Error.WriteLine($"Roslyn {typeof(CSharpSyntaxTree).Assembly.GetName().Version}, latest maps to {LanguageVersionFacts.MapSpecifiedToEffectiveVersion(LanguageVersion.Latest)}");
foreach (var rel in File.ReadAllLines(args[0]))
{
    using var stream = File.OpenRead(Path.Combine(args[1], rel));
    var tree = CSharpSyntaxTree.ParseText(SourceText.From(stream), options, rel);
    var root = tree.GetRoot();
    if (args.Length > 3)
    {
        // A second reading: every symbol the file's own #if and #elif lines name is defined, so the first branch of each is the one parsed.
        var named = root.DescendantTrivia(descendIntoTrivia: true)
            .Where(t => t.IsKind(SyntaxKind.IfDirectiveTrivia) || t.IsKind(SyntaxKind.ElifDirectiveTrivia))
            .SelectMany(t => t.GetStructure()!.DescendantTokens().Where(k => k.IsKind(SyntaxKind.IdentifierToken)).Select(k => k.ValueText)).Distinct();
        stream.Position = 0;
        tree = CSharpSyntaxTree.ParseText(SourceText.From(stream), options.WithPreprocessorSymbols(named), rel);
        root = tree.GetRoot();
    }
    var ifs = root.DescendantTrivia(descendIntoTrivia: true).Count(t => t.IsKind(SyntaxKind.IfDirectiveTrivia));
    var errors = tree.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).OrderBy(d => d.Location.SourceSpan.Start).ToList();
    if (errors.Count == 0) { output.Append($"{rel}\tA\t{ifs}\n"); continue; }
    var first = errors[0];
    var line = first.Location.GetLineSpan().StartLinePosition.Line + 1;
    var said = string.Join(" ", first.GetMessage().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    output.Append($"{rel}\tR\t{ifs}\t{line}\t{first.Id}\t{said}\t{errors.Count}\n");
}
File.WriteAllText(args[2], output.ToString());
```

The program was first run on two written inputs: `class A { void F( { } }` (rejected, CS1026), and
a file whose `#if NET8_0` branch is broken and whose `#else` branch holds a collection expression,
a call on a name that does not exist and a `#pragma` on a last line with no line break (accepted
with no symbol defined, rejected with `NET8_0` defined).

## The four cells

| language | repository | files | read and accepted | unread and accepted | read and rejected | unread and rejected | unread lines | lines | share of lines |
|---|---|---|---|---|---|---|---|---|---|
| Java | apache/commons-lang | 629 | 628 | 1 | 0 | 0 | 50 | 207,908 | 0.02% |
| Java | junit-team/junit5 | 1,792 | 1,786 | 6 | 0 | 0 | 2,216 | 228,033 | 0.97% |
| Java | google/gson | 264 | 264 | 0 | 0 | 0 | 0 | 57,126 | 0.00% |
| Java | **all three** | 2,685 | 2,678 | 7 | 0 | 0 | 2,266 | 493,067 | 0.46% |
| C# | jellyfin/jellyfin | 2,247 | 2,246 | 1 | 0 | 0 | 122 | 365,430 | 0.03% |
| C# | serilog/serilog | 216 | 215 | 1 | 0 | 0 | 1,078 | 24,776 | 4.35% |
| C# | JamesNK/Newtonsoft.Json | 951 | 951 | 0 | 0 | 0 | 0 | 197,496 | 0.00% |
| C# | **all three** | 3,414 | 3,412 | 2 | 0 | 0 | 1,200 | 587,702 | 0.20% |
| Rust | BurntSushi/ripgrep | 110 | 110 | 0 | 0 | 0 | 0 | 56,386 | 0.00% |
| Rust | tokio-rs/tokio | 808 | 808 | 0 | 0 | 0 | 0 | 186,265 | 0.00% |
| Rust | serde-rs/serde | 208 | 208 | 0 | 0 | 0 | 0 | 42,623 | 0.00% |
| Rust | **all three** | 1,126 | 1,126 | 0 | 0 | 0 | 0 | 285,274 | 0.00% |
| Kotlin | square/okhttp | 617 | 610 | 7 | 0 | 0 | 11,235 | 142,575 | 7.88% |
| Kotlin | ktorio/ktor | 2,596 | 2,514 | 82 | 0 | 0 | 20,436 | 301,139 | 6.79% |
| Kotlin | Kotlin/kotlinx.serialization | 720 | 715 | 5 | 0 | 0 | 926 | 70,249 | 1.32% |
| Kotlin | **all three** | 3,933 | 3,839 | 94 | 0 | 0 | 32,597 | 513,963 | 6.34% |

Over the 11,158 files: 11,055 read and accepted, 103 unread and accepted, 0 read and rejected,
0 unread and rejected. No parser rejected any file, at the language level and symbols named above.

### Read and rejected

None, in any of the four languages.

At an older Java level the cell is not empty. With `--release 21` javac rejects 8 files of junit5:
4 for `import module`, which the grammar leaves unread, and 4 for an unnamed variable `_`, which
the grammar reads. With `--release 17` it rejects 10: those 8, and 2 more the grammar reads, for a
pattern in a `switch` and a deconstruction pattern. With `--enable-preview --release 25` it accepts
all 2,685, as it does with no option. So no file needs a preview feature, and 4 need level 25.

### Unread and rejected

None.

## Unread and accepted, by construct

A class here is a rewrite. Each unread file was rewritten at one construct and read again by the
grammar: a file belongs to a class when the rewrite of that construct is what lets the grammar read
it. The example lines are from the files as written.

### Java, 7 files

Each rewrite was applied alone to the file and the result handed to `parseTreeFile`.

| files | construct | rewrite | example |
|---|---|---|---|
| 4 | `import module` | the line taken out | junit5 `platform-tooling-support-tests/projects/junit-start/compact/JUnitRun.java:11` `import module org.junit.start;` |
| 2 | a type annotation on a varargs parameter | the annotation before `...` taken out | junit5 `junit-platform-commons/src/main/java/org/junit/platform/commons/util/ClassUtils.java:68` `public static String nullSafeToString(@Nullable Class<?> @Nullable... classes) {` |
| 1 | a NUL character, inside a string literal | each NUL made a space | commons-lang `src/test/java/org/apache/commons/lang3/ClassUtilsOssFuzzTest.java:39` |

The other three `import module` files are `compact/JUnitRunClass.java`,
`modular/p/JUnitRunModule.java` and `modular/p/MultiplicationTests.java` under the same directory,
and the other varargs file is `ReflectionUtils.java` beside `ClassUtils.java`, at line 848.

### C#, 2 files

| files | construct | rewrite | example |
|---|---|---|---|
| 2 | a collection expression | `[a, b]` made `new[] { a, b }` | jellyfin `MediaBrowser.MediaEncoding/Subtitles/SubtitleEditParser.cs:105` `subtitleFormatTypes[extension] = [type];` and serilog `test/Serilog.Tests/MethodOverloadConventionTests.cs:286` `testMethod.Invoke(this, [method]);` |

In jellyfin's file it is the right side of an assignment. In serilog's it is an argument of a call,
at lines 286 and 719, and the file holds `#if` as well: the grammar rejects it as written, and
after the blanking of B64 those two lines are the only ERROR nodes left.

How the grammar came to read the C# files, which is B64's count:

| repository | files | read as written | read after a line break was appended | read after directives were blanked, nothing dropped | read with one branch kept | unread |
|---|---|---|---|---|---|---|
| jellyfin/jellyfin | 2,247 | 2,246 | 0 | 0 | 0 | 1 |
| serilog/serilog | 216 | 198 | 0 | 10 | 7 | 1 |
| JamesNK/Newtonsoft.Json | 951 | 885 | 23 | 12 | 31 | 0 |

Read as written the grammar rejects 85 files: 1 of jellyfin, 18 of serilog (27.71% of its lines)
and 66 of Newtonsoft.Json (25.85% of its lines). Roslyn accepts all 85, with no symbol defined and
with each file's named symbols defined. 577 files hold `#if`, counted from Roslyn's own directive
nodes: 43 of serilog, 534 of Newtonsoft.Json, none of jellyfin.

### Rust

No file is unread.

### Kotlin, 94 files

Every rewrite in the table was applied to each file together, and the grammar then read all 94.
A file needs a rewrite when, with every rewrite but that one applied, the grammar still cannot read
it. 91 files need one rewrite and 3 need two, so the counts sum to 97. The 94 rewritten texts were
then given to the Kotlin parser, which accepted all 94: each rewrite turned Kotlin into Kotlin.

| files | okhttp | ktor | kotlinx.serialization | construct | rewrite | example |
|---|---|---|---|---|---|---|
| 27 | 0 | 27 | 0 | a named context parameter before a declaration | the clause taken out | `oidc/OidcSessionRefresh.kt:18` `context(ctx: RoutingContext)` |
| 16 | 1 | 15 | 0 | `get` or `set` opening the line after a local declaration | `this.` put before it | `freemarker/FreeMarkerTest.kt:38` `get("/") {` |
| 11 | 0 | 11 | 0 | a `$$"` string | the literal made `""` | `reflect/AbstractSchemaInferenceTest.kt:137` `$$"""` |
| 10 | 1 | 9 | 0 | a primary constructor on the line after the class header | the line break before it made a space | `engine/EmbeddedServer.posix.kt:17` `>` |
| 6 | 0 | 2 | 4 | `dynamic` as a type or a name | the word renamed | `json/DynamicPolymorphismTest.kt:314` `private inline fun fieldsCount(dynamic: dynamic): Int {` |
| 5 | 1 | 4 | 0 | an annotation before `get` or `set` | the annotation taken out | `darwin/DarwinClientEngineConfig.kt:36` `@Deprecated(` |
| 5 | 0 | 5 | 0 | a `when` guard | the `if` and its condition taken out | `sessions/SessionSerializerReflection.kt:207` `!is List<*> if value is Iterable<*> -> coerceType(type, value.toList())` |
| 5 | 0 | 5 | 0 | a context clause inside a function type | the clause taken out | `ir/IrCodeGenUtils.kt:35` `bodyGen: context(LambdaBuilderContext) () -> Unit = {}` |
| 2 | 2 | 0 | 0 | `open` as a name | the word renamed where `(`, `.` or `=` follows | `platform/Android10Platform.kt:110` `CloseGuard().apply { open(closer) }` |
| 2 | 2 | 0 | 0 | a name that begins `in` and a digit | the name renamed | `okhttp3/URLConnectionTest.kt:1681` `val in1 = response1.body.byteStream()` |
| 2 | 0 | 2 | 0 | a raw string that closes on four or more quotes | closed on three | `tests/LoggingMockedTests.kt:163` `"""Content-Disposition: form-data; name="file"; file; name=""; filename=""""",` |
| 2 | 0 | 2 | 0 | `suspend` before a lambda | `suspend` made `run` | `tests/HttpClientTest.kt:124` `val block = suspend {` |
| 1 | 0 | 1 | 0 | `enum` as a name | the word renamed where no `class` follows | `model/Attributes.kt:55` `enum,` |
| 1 | 0 | 1 | 0 | `suspend` before a parenthesised function type | `suspend` taken out | `jwt/JWTAuth.kt:182` `private val verifier: suspend ((HttpAuthHeader) -> JWTVerifier?) = config.verifier` |
| 1 | 0 | 1 | 0 | a lambda that begins with a parenthesised callee | the parentheses taken out | `auth/FormAuth.kt:40` `val principal = credentials?.let { (authenticationFunction)(call, it) }` |
| 1 | 0 | 0 | 1 | a NUL character | made a space | `json/SpecConformanceTest.kt:49` `* ["a\0a"], n_string_unescaped_crtl_char.json // p.3` |

Three of the examples need the lines around them. The `get("/") {` of `FreeMarkerTest.kt` stands
level with a `val` on the line before, and the grammar takes it for that property's getter. The
`>` of `EmbeddedServer.posix.kt` closes the class's type parameters, and `actual constructor(`
opens the next line. The `@Deprecated(` of `DarwinClientEngineConfig.kt` runs over five lines and
ends before `set(value)`.

The three files that need two: `HttpClientTest.kt` under `ktor-client-tests/jvm/src` (`get` after a
local declaration, and `suspend` before a lambda), `IrCodeGenUtils.kt` (a named context parameter,
and a context clause in a function type) and `ReferenceOr.kt` (a `$$"` string, and `dynamic`).

Where the unread lines sit. okhttp: all 11,235 are in 7 files, none of which holds a context
parameter or a `$$"` string. Two test files, `URLConnectionTest.kt` (4,544 lines) and
`CacheTest.kt` (4,260), are 8,804 of them, each unread for a local named `in1` or `in2`. ktor: the
42 files that need a context clause or a `$$"` string hold 9,189 lines, 3.05% of the repository,
and the other 40 hold 11,247 lines, 3.73%. kotlinx.serialization: 4 of its 5 files are unread for
`dynamic` and 1 for a NUL character in a comment.

For ten of the sixteen classes a written input of one to four lines holding the construct alone
is unread by the grammar and accepted by the Kotlin parser. For five (the primary constructor,
`dynamic`, the annotated accessor, the raw string and `enum`) the short input written here was read
by the grammar, so in those five the class is named by the rewrite on the real files and the
smallest form that breaks the grammar was not found. A comment holding a NUL character is unread by
the grammar as a two-line input, and the parser's answer for it is the real file's.

The files, each with the constructs it needs:

| repository | file | lines | needs |
|---|---|---|---|
| okhttp | `mockwebserver/src/main/kotlin/mockwebserver3/MockWebServer.kt` | 1,299 | an annotation before `get` or `set` |
| okhttp | `okhttp/src/androidMain/kotlin/okhttp3/internal/platform/Android10Platform.kt` | 151 | `open` as a name |
| okhttp | `okhttp/src/androidMain/kotlin/okhttp3/internal/platform/android/Android17SocketAdapter.kt` | 106 | a primary constructor on the line after the class header |
| okhttp | `okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/http2/Http2Stream.kt` | 742 | `open` as a name |
| okhttp | `okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/http2/Settings.kt` | 133 | `get` or `set` opening the line after a local declaration |
| okhttp | `okhttp/src/jvmTest/kotlin/okhttp3/CacheTest.kt` | 4,260 | a name that begins `in` and a digit |
| okhttp | `okhttp/src/jvmTest/kotlin/okhttp3/URLConnectionTest.kt` | 4,544 | a name that begins `in` and a digit |
| ktor | `build-logic/src/main/kotlin/ktorbuild/internal/Problems.kt` | 55 | a named context parameter before a declaration |
| ktor | `build-logic/src/main/kotlin/ktorbuild/targets/KtorTargets.kt` | 416 | a named context parameter before a declaration |
| ktor | `ktor-client/ktor-client-apache/jvm/src/io/ktor/client/engine/apache/ApacheHttpRequest.kt` | 70 | a `when` guard |
| ktor | `ktor-client/ktor-client-apache5/jvm/src/io/ktor/client/engine/apache5/ApacheHttpRequest.kt` | 78 | a `when` guard |
| ktor | `ktor-client/ktor-client-core/common/src/io/ktor/client/request/HttpRequest.kt` | 441 | an annotation before `get` or `set` |
| ktor | `ktor-client/ktor-client-darwin-legacy/darwin/src/io/ktor/client/engine/darwin/DarwinLegacyClientEngineConfig.kt` | 152 | an annotation before `get` or `set` |
| ktor | `ktor-client/ktor-client-darwin/darwin/src/io/ktor/client/engine/darwin/DarwinClientEngineConfig.kt` | 163 | an annotation before `get` or `set` |
| ktor | `ktor-client/ktor-client-tests/common/test/io/ktor/client/tests/LoggingMockedTests.kt` | 371 | a raw string that closes on four or more quotes |
| ktor | `ktor-client/ktor-client-tests/jvm/src/io/ktor/client/tests/HttpClientTest.kt` | 209 | `get` or `set` opening the line after a local declaration; `suspend` before a lambda |
| ktor | `ktor-client/ktor-client-webrtc/common/test/io/ktor/client/webrtc/utils/ConnectionUtils.kt` | 122 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/fir/OpenApiAnalysisExtension.kt` | 98 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/CallDescribeTransformer.kt` | 306 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/IrCallHandlerInference.kt` | 23 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/IrCodeGenUtils.kt` | 248 | a named context parameter before a declaration; a context clause inside a function type |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/IrCodeReadUtils.kt` | 91 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/IrDescribeGenerator.kt` | 31 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/generators/GeneralDescribeExpressionGenerator.kt` | 84 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/generators/MediaTypeContentGenerator.kt` | 175 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/generators/ResponsesGenerator.kt` | 65 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/inference/CallRespondInference.kt` | 75 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/inference/MediaTypeContentUtils.kt` | 126 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/inference/ParameterInference.kt` | 109 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/ir/inference/ResourceRouteCallInference.kt` | 180 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/model/Attributes.kt` | 60 | `enum` as a name |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/routing/LocalReference.kt` | 56 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/routing/RouteCall.kt` | 60 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/routing/SourceCoordinates.kt` | 30 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/src/io/ktor/openapi/routing/TypeReference.kt` | 78 | a named context parameter before a declaration |
| ktor | `ktor-compiler-plugin/test-fixtures/io/ktor/compiler/services/KtorOpenApiTestAdditionalSources.kt` | 62 | a `$$"` string |
| ktor | `ktor-http/common/test/io/ktor/tests/http/CommonHeadersTest.kt` | 482 | a raw string that closes on four or more quotes |
| ktor | `ktor-io/jvm/src/io/ktor/utils/io/charsets/CharsetJVM.kt` | 103 | a primary constructor on the line after the class header |
| ktor | `ktor-io/jvm/src/io/ktor/utils/io/pool/DefaultPool.kt` | 110 | a primary constructor on the line after the class header |
| ktor | `ktor-io/web/src/io/ktor/utils/io/pool/DefaultPool.kt` | 48 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-config-yaml/jvm/test/YamlConfigTestJvm.kt` | 87 | a `$$"` string |
| ktor | `ktor-server/ktor-server-config-yaml/jvmAndPosix/src/io/ktor/server/config/yaml/YamlConfig.kt` | 249 | a `$$"` string |
| ktor | `ktor-server/ktor-server-config-yaml/jvmAndPosix/test/YamlConfigTest.kt` | 650 | a `$$"` string |
| ktor | `ktor-server/ktor-server-config-yaml/posix/test/YamlConfigTestNix.kt` | 108 | a `$$"` string |
| ktor | `ktor-server/ktor-server-core/common/src/io/ktor/server/response/ResponseType.kt` | 28 | an annotation before `get` or `set` |
| ktor | `ktor-server/ktor-server-core/jvm/src/io/ktor/server/engine/EmbeddedServerJvm.kt` | 590 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-core/jvm/src/io/ktor/server/http/content/StaticContent.kt` | 1,476 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-core/posix/src/io/ktor/server/engine/EmbeddedServer.posix.kt` | 118 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-core/web/src/io/ktor/server/engine/EmbeddedServer.web.kt` | 116 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-netty/jvm/src/io/ktor/server/netty/http1/NettyHttp1Handler.kt` | 357 | a `when` guard |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-jwt/jvm/src/io/ktor/server/auth/jwt/JWTAuth.kt` | 448 | `suspend` before a parenthesised function type |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-oidc/jvm/src/io/ktor/server/auth/oidc/OidcBearer.kt` | 230 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-oidc/jvm/src/io/ktor/server/auth/oidc/OidcOAuth.kt` | 118 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-oidc/jvm/src/io/ktor/server/auth/oidc/OidcProvider.kt` | 325 | a context clause inside a function type |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-oidc/jvm/src/io/ktor/server/auth/oidc/OidcSessionRefresh.kt` | 121 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth-oidc/jvm/src/io/ktor/server/auth/oidc/OidcTokens.kt` | 427 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/AuthenticationScheme.kt` | 265 | a context clause inside a function type |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/AuthenticationSchemeWithRoles.kt` | 173 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/FormAuth.kt` | 176 | a lambda that begins with a parenthesised callee |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/OAuthFlow.kt` | 672 | a context clause inside a function type |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/PrincipalContext.kt` | 226 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/RouteBuilders.kt` | 278 | a context clause inside a function type |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-auth/common/src/io/ktor/server/auth/SessionAuthenticationScheme.kt` | 172 | a named context parameter before a declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-freemarker/jvm/test/io/ktor/tests/freemarker/FreeMarkerTest.kt` | 234 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-jte/jvm/test/io/ktor/tests/jte/JteTest.kt` | 257 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-routing-openapi/common/src/io/ktor/server/routing/openapi/OpenApiRoutes.kt` | 407 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-sessions/common/src/io/ktor/server/sessions/SessionsBuilder.kt` | 532 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-sessions/jvm/src/io/ktor/server/sessions/SessionSerializerReflection.kt` | 519 | a `when` guard |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-sse/common/test/io/ktor/server/sse/ServerSentEventsTest.kt` | 427 | `dynamic` as a type or a name |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-thymeleaf/jvm/test/io/ktor/server/thymeleaf/ThymeleafTest.kt` | 329 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-velocity/jvm/test/io/ktor/tests/velocity/VelocityTest.kt` | 190 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-plugins/ktor-server-velocity/jvm/test/io/ktor/tests/velocity/VelocityToolsTest.kt` | 182 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-servlet-jakarta/jvm/src/io/ktor/server/servlet/jakarta/WebResources.kt` | 103 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-servlet/jvm/src/io/ktor/server/servlet/WebResources.kt` | 102 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-test-base/posix/src/io/ktor/server/test/base/EngineTestBaseNix.kt` | 170 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-test-base/web/src/io/ktor/server/test/base/EngineTestBase.web.kt` | 184 | a primary constructor on the line after the class header |
| ktor | `ktor-server/ktor-server-test-host/jvm/test/TestApplicationTestJvm.kt` | 390 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-server/ktor-server-test-suites/common/src/io/ktor/server/testing/suites/HttpServerCommonTestSuite.kt` | 917 | a `$$"` string |
| ktor | `ktor-server/ktor-server-tests/common/test/io/ktor/tests/server/routing/RoutingTracingTest.kt` | 339 | a `$$"` string |
| ktor | `ktor-shared/ktor-openapi-schema/common/src/io/ktor/openapi/JsonSchema.kt` | 597 | a `$$"` string |
| ktor | `ktor-shared/ktor-openapi-schema/common/src/io/ktor/openapi/ReferenceOr.kt` | 146 | a `$$"` string; `dynamic` as a type or a name |
| ktor | `ktor-shared/ktor-openapi-schema/jvm/src/io/ktor/openapi/JsonSchemaInference.jvm.kt` | 143 | a `$$"` string |
| ktor | `ktor-shared/ktor-openapi-schema/ktor-openapi-schema-reflect/jvm/test/io/ktor/openapi/reflect/AbstractSchemaInferenceTest.kt` | 456 | a `$$"` string |
| ktor | `ktor-shared/ktor-serialization/ktor-serialization-jackson/jvm/test/ServerJacksonTest.kt` | 206 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-shared/ktor-serialization/ktor-serialization-jackson3/jvm/test/ServerJacksonTest.kt` | 207 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-test-server/src/main/kotlin/test/server/tests/ServerSentEvents.kt` | 274 | `get` or `set` opening the line after a local declaration |
| ktor | `ktor-utils/common/src/io/ktor/util/pipeline/Pipeline.kt` | 537 | a `when` guard |
| ktor | `ktor-utils/common/test/io/ktor/util/PipelineContractsTest.kt` | 327 | `suspend` before a lambda |
| ktor | `ktor-utils/jvm/src/io/ktor/util/NIO.kt` | 74 | `get` or `set` opening the line after a local declaration |
| kotlinx.serialization | `formats/json-tests/jsTest/src/kotlinx/serialization/json/DynamicPolymorphismTest.kt` | 324 | `dynamic` as a type or a name |
| kotlinx.serialization | `formats/json-tests/jsTest/src/kotlinx/serialization/json/DynamicToLongTest.kt` | 60 | `dynamic` as a type or a name |
| kotlinx.serialization | `formats/json-tests/jvmTest/src/kotlinx/serialization/json/SpecConformanceTest.kt` | 130 | a NUL character |
| kotlinx.serialization | `formats/json/jsMain/src/kotlinx/serialization/json/Dynamics.kt` | 72 | `dynamic` as a type or a name |
| kotlinx.serialization | `formats/json/jsMain/src/kotlinx/serialization/json/internal/DynamicDecoders.kt` | 340 | `dynamic` as a type or a name |

## What this pass does not show

- **A C# symbol set.** A file was parsed with no symbol defined and with every symbol its own
  directives name defined. What a project file defines for a build is not read, so a branch only
  some other combination switches on was parsed by nothing here. With no symbol defined Roslyn
  parses the `#else` side of a plain `#if`, where the grammar's retry keeps the first branch.
- **Macro expansion in Rust.** `rustc` stopped after parsing the one file. The inside of a macro
  call is checked as tokens with matched delimiters and no further, no macro is expanded, and no
  `mod name;` is followed.
- **A Kotlin language version.** The PSI parser takes no language version: it accepted a named
  context parameter, a `$$"` string and a `when` guard with no flag. Whether 2.4.21 compiles each
  file without an opt-in is decided after parsing and was not asked. A diagnostic the compiler
  raises outside `PsiErrorElement` is not counted.
- **A Java level per project.** Every file was parsed at 25. The level each build file sets was not
  read. At 21 the read and rejected cell holds 4 files.
- **Anything past syntax.** No import was resolved and no type checked, in any of the four.
- **Invalid text the grammar reads clean.** The corpus held none for these four languages, which
  says the repositories hold no broken file and says nothing about what the grammars would do with
  one. Two written Kotlin inputs, `val x = 1 #` and `val x = 1 \\ 2`, are rejected by the Kotlin
  parser and read by the grammar with no error. No set of written invalid inputs was run for the
  four, as B63 records one for Python, PHP and Go.
- **Other repositories.** Three per language, at the commits above.
