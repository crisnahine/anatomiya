# What an import names in each language

Research notes, October 2026. The question is what each language's import statement names, how
that name maps to a file in the repository, and which tree-sitter nodes hold it, so that the
"most imported from here" line can be extended past JavaScript and TypeScript. Today the line is
built by `mostImported` in `plugins/anatomiya/lib/siblings.mjs`. It resolves an import specifier
with `specifierToFile`, which matches the specifier as a path tail against every source file path
with its extension dropped (`tailIndex`). The target languages are Python, Java, Kotlin, Rust, PHP,
Go, C# and Ruby, plus the code embedded in Blade and ERB templates.

Every claim carries its source, in three kinds:

- **code**: a file and line in this repository at `c95c1b71`
- **run**: a sample file parsed on this machine today, named with its command shape
- **doc**: a first-party page or source file, with its URL

The grammar runs used the `.wasm` files this plugin ships under `plugins/anatomiya/grammars/`,
loaded with the repository's own `web-tree-sitter` 0.27.1, and a throwaway `dump.mjs` that prints
every node with its field name. The field tables come from each grammar's `src/node-types.json`
in `node_modules/`, at the exact version `grammars/grammars.json` pins:

| id | package | version |
|---|---|---|
| python | `tree-sitter-python` | 0.25.0 |
| php | `tree-sitter-php` | 0.24.2 |
| go | `tree-sitter-go` | 0.25.0 |
| java | `tree-sitter-java` | 0.23.5 |
| csharp | `tree-sitter-c-sharp` | 0.23.5 |
| rust | `tree-sitter-rust` | 0.24.0 |
| kotlin | `@tree-sitter-grammars/tree-sitter-kotlin` | 1.1.0 |

The Ruby run used prism 1.9.0, the version installed for Ruby 3.4.9 on this machine, and its own
`config.yml`. The probes were throwaway and are not kept.

## Summary

Five things in this note change the design more than the rest.

1. In four of the eight languages the import does not name a file. A Go import names a package
   directory. A C# `using` names a namespace, which is not a path. A Kotlin import of a top-level
   function names a package, and any file in that package may hold the function. A Ruby file under
   Rails imports nothing at all: the reference `Foo::BarBaz` is the import. For these, a tail match
   on the import alone cannot find the file. The resolver needs a second index, from declared
   name to file.
2. Three grammars hide a meaning-changing keyword in an anonymous token, with no field and no named
   node: Java's `static`, C#'s `static` and `global`, and Kotlin's `.*`. A walker that reads only
   named children reads `import static a.B.c` as `import a.B.c`, and `import a.b.*` as `import
   a.b`. PHP is the exception: its `function` and `const` sit in a `type` field.
3. In Python and Rust, the last segment of an import may be a module or a name inside one.
   `from a.b import c` binds either the file `a/b/c.py` or the name `c` from `a/b.py` or
   `a/b/__init__.py`. `use crate::a::b` binds either `src/a/b.rs` or the item `b` from `src/a.rs`.
   Only a file listing tells which.
4. The path prefix that leads to the file is not the head of the specifier in PHP, Go and Rust. A
   Laravel class `App\Models\User` sits in `app/Models/User.php`: the `App\` prefix maps to a
   lowercase directory through `composer.json`. A Go path starts with the module path from
   `go.mod`. A Rust `crate::` path starts at `src/`, and another workspace crate is named with `_`
   where its directory and manifest say `-`.
5. Rails `concerns` directories are separate autoload roots, not collapsed directories:
   `app/models/concerns/geolocatable.rb` defines `Geolocatable`. Every directory under `app/` is a
   root too, so `app/models/user.rb` defines `User`, not `Models::User`.

## Python

### Forms

**doc** [Python reference 7.11, the import statement](https://docs.python.org/3/reference/simple_stmts.html#the-import-statement)
gives the grammar:

```
import_stmt:     ["lazy"] "import" module ["as" identifier] ("," module ["as" identifier])*
                 | ["lazy"] "from" relative_module "import" identifier ["as" identifier]
                 ("," identifier ["as" identifier])*
                 | ["lazy"] "from" relative_module "import" "(" identifier ["as" identifier]
                 ("," identifier ["as" identifier])* [","] ")"
                 | "from" relative_module "import" "*"
module:          (identifier ".")* identifier
relative_module: "."* module | "."+
```

| form | names the module | names the symbol |
|---|---|---|
| `import a.b.c` | `a.b.c` | none; the caller writes `a.b.c.f` |
| `import a.b as ab` | `a.b` | none; the caller writes `ab.f` |
| `from a.b import c, d as e` | `a.b` | `c`, `d` (`e` is the local name) |
| `from a.b import (c, d)` | `a.b` | `c`, `d` |
| `from a.b import *` | `a.b` | every public name, or `__all__` |
| `from . import x` | the importer's own package | `x` |
| `from ..a import b` | `a` in the parent package | `b` |
| `from __future__ import annotations` | a compiler directive | none |

**doc** [Python reference 5.7, package relative imports](https://docs.python.org/3/reference/import.html#package-relative-imports):
"A single leading dot indicates a relative import, starting with the current package. Two or more
leading dots indicate a relative import to the parent(s) of the current package, one level per dot
after the first."

The `lazy` keyword is in the reference's current grammar. **run**: `lazy import a.b` parsed with
the shipped grammar gives an `ERROR` node holding `lazy`, then a normal `import_statement`. The
import is still read.

### Module to file

**doc** [Python reference 5.2.1, regular packages](https://docs.python.org/3/reference/import.html#regular-packages):
"A regular package is typically implemented as a directory containing an `__init__.py` file."
[5.2.2, namespace packages](https://docs.python.org/3/reference/import.html#namespace-packages):
"With namespace packages, there is no `parent/__init__.py` file."

So `a.b` is one of three things on disk: `a/b.py`, `a/b/__init__.py`, or a directory `a/b/` with no
`__init__.py`. The first two are files a tail can match once `__init__` is treated like the
`index` that `tailIndex` already handles (**code** `siblings.mjs:310`). The third is a directory and
answers no file.

The head of the dotted name is the package, not a path from the repository root. **doc**
[Python Packaging, src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/):
the src layout puts the import package in a `src/` subdirectory, so `a.b` lives at `src/a/b.py`.
A tail match handles both layouts without knowing which.

A single-segment module, `import utils`, is a top-level module in a flat layout. `specifierToFile`
returns null for any tail without a `/` (**code** `siblings.mjs:129`), so as written it would drop
every such import. The same rule drops a Go package at the module root and a Rust `crate::a`.

### Nodes

**run** and **doc** `tree-sitter-python` 0.25.0 `src/node-types.json`:

| node | fields | children |
|---|---|---|
| `import_statement` | `name` (many, required): `dotted_name` or `aliased_import` | |
| `import_from_statement` | `module_name` (required): `dotted_name` or `relative_import`; `name` (many): `dotted_name` or `aliased_import` | `wildcard_import` |
| `aliased_import` | `name`: `dotted_name`; `alias`: `identifier` | |
| `relative_import` | | `import_prefix`, `dotted_name` |
| `future_import_statement` | `name` (many) | |

`import_prefix` is a leaf whose text is the dots, `"."` or `".."`. `wildcard_import` is a named
leaf `*`. The plugin already lists these three statement types and the `name` and `alias` fields
(**code** `tree-shapes.mjs:16-17`, `:29`).

## Java

### Forms

**doc** [JLS SE 21, 7.5](https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html#jls-7.5)
lists four kinds:

| form | JLS | names | symbol |
|---|---|---|---|
| `import a.b.C;` | 7.5.1 single-type | the type `a.b.C` | `C` |
| `import a.b.*;` | 7.5.2 type-import-on-demand | the package `a.b`, or a type | every accessible type |
| `import static a.b.C.m;` | 7.5.3 single-static | the type `a.b.C` | the static member `m` |
| `import static a.b.C.*;` | 7.5.4 static-import-on-demand | the type `a.b.C` | every static member |

Java has no import alias.

### Module to file

**doc** [JLS 7.2](https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html#jls-7.2): an
implementation may "transform a package name into a pathname by concatenating the components of the
package name, placing a file name separator (directory indicator) between adjacent components."
[JLS 7.6](https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html#jls-7.6): the host
"may choose to enforce" that a class referred to from other compilation units, or declared
`public`, is in a file named after it, and "the source code for a `public` class `wet.sprocket.Toad`
would be found in a file `Toad.java` in the directory `wet/sprocket`."

So `import a.b.C` maps to the tail `a/b/C`, which matches `src/main/java/a/b/C.java`. That holds for
top-level types. A nested type, `import a.b.C.Inner`, has the tail `a/b/C/Inner`, which is no file;
the file is the longest prefix that is one, `a/b/C`. A static import's last segment is a member,
so its file is the tail without that segment. The on-demand forms name a directory or a type and
no single symbol.

### Nodes

**run** and **doc** `tree-sitter-java` 0.23.5 `grammar.js:841-847`:

```js
import_declaration: $ => seq(
  'import',
  optional('static'),
  $._name,
  optional(seq('.', $.asterisk)),
  ';',
),
```

`import_declaration` has no fields. Its named children are one `scoped_identifier` or `identifier`
and an optional `asterisk`. `scoped_identifier` nests with fields `scope` and `name`. **`static`
is an anonymous token**: in the run, `import static com.ex.util.Strings.join;` and an ordinary
`import com.ex.util.Strings.join;` give the same named tree, and only the token list tells them
apart.

## Kotlin

### Forms

**doc** [Kotlin, packages and imports](https://kotlinlang.org/docs/packages.html):

| form | names | symbol |
|---|---|---|
| `import org.example.Message` | a class | `Message` |
| `import org.example.*` | a package, class or object scope | every named entity in it |
| `import org.test.Message as TestMessage` | a class | `Message`, bound as `TestMessage` |
| `import org.example.printMessage` | a package | a top-level function |
| `import org.example.VERSION` | a package | a top-level property |
| `import org.example.Config.loadSettings` | an object `Config` | its member |
| `import org.example.Color.RED` | an enum `Color` | its constant |

The page: "The `import` keyword is not limited to classes. You can import any of the following
entities", then lists top-level functions and properties, object members and enum constants.

### Module to file

**doc** [Kotlin coding conventions, directory structure](https://kotlinlang.org/docs/coding-conventions.html#directory-structure):
"the recommended directory structure follows the package structure with the common root package
omitted ... files in `org.example.kotlin.network.socket` should be in the `network/socket`
subdirectory of the source root." And
[source file names](https://kotlinlang.org/docs/coding-conventions.html#source-file-names): a file
holding a single class "should be the same as the name of the class", but "If a file contains
multiple classes, or only top-level declarations, choose a name describing what the file contains".

Two consequences. The full dotted tail may not exist on disk, because the common root is dropped by
convention: `org.example.kotlin.network.Socket` can be `network/Socket.kt`. And an import of a
top-level function names its package, never its file: `import a.b.foo` may be answered by any
`.kt` file in the directory of package `a.b`. The file is found by which one declares `foo`.

### Nodes

**run** and **doc** `@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0 `grammar.js:139-147`:

```js
import: $ => seq(
  'import',
  $.qualified_identifier,
  optional(choice(
    seq('.', '*'),
    seq('as', $.identifier),
  )),
  optional(';'),
),
```

`import` has no fields. `qualified_identifier` is a flat list of `identifier` children, not a
nested tree. **The `.*` of a wildcard is two anonymous tokens**: `import com.ex.util.*` and
`import com.ex.util` give the same named tree. The alias is a bare `identifier` after an anonymous
`as`. The plugin already reads it that way (**code** `tree-shapes.mjs:331-333`,
`tree-facets.mjs:96-97`).

## Rust

### Forms

**doc** [Rust reference, use declarations](https://doc.rust-lang.org/reference/items/use-declarations.html):

```
UseTree →
    ( SimplePath? :: )? *
  | ( SimplePath? :: )? { ( UseTree ( , UseTree )* ,? )? }
  | SimplePath ( as ( IDENTIFIER | _ ) )?
```

| form | path | binds |
|---|---|---|
| `use std::io;` | `std::io` | `io` |
| `use crate::a::{b, c::d};` | `crate::a` | `b` and `d` |
| `use a::{self, b as c};` | `a` | `a` itself and `b` as `c` |
| `use self::m::N as M;` | `self::m::N` | `N` as `M` |
| `use super::*;` | the parent module | every public item |
| `pub use crate::x::Y;` | `crate::x::Y` | `Y`, re-exported |
| `use foo_bar::Baz;` | another crate | `Baz` |
| `use T as _;` | `T` | nothing; brings a trait's methods in |

The reference: "`self` ... means the current module of the parent segment, or the current module
if there is no parent segment", and "a `use` declaration can be public, if qualified by the `pub`
keyword. Such a `use` declaration serves to _re-export_ a name." Since the 2018 edition, "`use`
declarations can specify an external crate dependency the same way `extern crate` can," and names
not starting with `crate`, `self` or `super` are "relative to the current scope."

### Module to file

**doc** [Rust reference, module source filenames](https://doc.rust-lang.org/reference/items/modules.html#module-source-filenames):

| module path | file |
|---|---|
| `crate` | `lib.rs` |
| `crate::util` | `util.rs` or `util/mod.rs` |
| `crate::util::config` | `util/config.rs` |

"It is not allowed to have both `util.rs` and `util/mod.rs`." A `#[path = "foo.rs"]` attribute on
the `mod` overrides the mapping, and only the declaring file says so.

**doc** [Cargo targets](https://doc.rust-lang.org/cargo/reference/cargo-targets.html#library):
the library "filename defaults to `src/lib.rs`, and the name of the library defaults to the name of
the package, with any dashes replaced with underscores"; a binary's "source can be `src/main.rs`".

So `crate::a::b` maps to the tail `src/a/b` (or `src/a/b/mod`), anchored at the importer's own
crate root, which is the nearest ancestor holding `Cargo.toml`. `self::` and `super::` depend on the
importer's own file: in `src/a/b.rs` `self` is `crate::a::b` and its children sit in `src/a/b/`; in
`src/a/mod.rs` `self` is `crate::a`. A first segment that is another workspace crate, `foo_bar`,
maps to the member whose `Cargo.toml` names `foo-bar` or `foo_bar`, then its `src/lib.rs`.

The last segment may be a module or an item inside one: `use crate::a::b` binds `src/a/b.rs` if it
exists and the item `b` from `src/a.rs` otherwise. A `pub use` makes a module answer for names
declared elsewhere, so the file that holds a name and the file the import names can differ by
design.

### Nodes

**run** and **doc** `tree-sitter-rust` 0.24.0 `src/node-types.json`, rules at `grammar.js:619-660`:

| node | fields | children |
|---|---|---|
| `use_declaration` | `argument` (required): one of `scoped_identifier`, `identifier`, `scoped_use_list`, `use_as_clause`, `use_list`, `use_wildcard`, `crate`, `self`, `super`, `metavariable` | `visibility_modifier` |
| `scoped_identifier` | `path`, `name` | |
| `scoped_use_list` | `path`, `list` (required): `use_list` | |
| `use_list` | | any use tree, nested |
| `use_as_clause` | `path`, `alias` | |
| `use_wildcard` | | the path before `::*` |
| `extern_crate_declaration` | `name`, `alias` | `crate`, `visibility_modifier` |
| `mod_item` | `name`, `body` | `visibility_modifier` |

`crate`, `self` and `super` are named leaf nodes. `pub` arrives as a `visibility_modifier` child of
`use_declaration`, so a re-export is visible. A leading `::std` is a `scoped_identifier` with no
`path` field. A `mod_item` with no `body` is the declaration that loads a file.

## PHP

### Forms

**doc** [PHP manual, using namespaces: aliasing and importing](https://www.php.net/manual/en/language.namespaces.importing.php):

```php
use My\Full\Classname as Another;
use My\Full\NSname;
use ArrayObject;
use function My\Full\functionName;
use function My\Full\functionName as func;
use const My\Full\CONSTANT;
use some\namespace\{ClassA, ClassB, ClassC as C};
use function some\namespace\{fn_a, fn_b, fn_c};
use const some\namespace\{ConstA, ConstB, ConstC};
```

The last segment is the symbol: a class, interface, trait, enum or namespace by default, a function
after `function`, a constant after `const`. The manual: a leading backslash "is unnecessary and not
recommended, as import names must be fully qualified."

### Module to file

**doc** [PSR-4, section 2](https://www.php-fig.org/psr/psr-4/): a namespace prefix "corresponds to at
least one 'base directory'"; the sub-namespace names after it "correspond to a subdirectory ... in
which the namespace separators represent directory separators"; "The terminating class name
corresponds to a file name ending in `.php`", and both "MUST match the case".

**doc** [Composer schema, autoload psr-4](https://getcomposer.org/doc/04-schema.md#psr-4): the
prefix to directory map lives in `composer.json`, for example `"Monolog\\": "src/"`, with an empty
prefix as a fallback and an array for several directories. Laravel's skeleton maps `"App\\":
"app/"` (**doc** [laravel/laravel `composer.json`](https://github.com/laravel/laravel/blob/12.x/composer.json)).

So `App\Models\User` sits at `app/Models/User.php`. The tail `App/Models/User` matches nothing,
because the prefix maps to a lowercase directory. Dropping the prefix, or reading `composer.json`,
gives `Models/User`, which matches. PSR-4 covers classes only. A `use function` or `use const`
names a symbol in a file that Composer loads through `files` (**doc** same page, "files"), and
nothing maps its namespace to a path.

### Nodes

**run** and **doc** `tree-sitter-php` 0.24.2 `common/define-grammar.js:247-297`:

| node | fields | children |
|---|---|---|
| `namespace_use_declaration` | `type`: `function` or `const`; `body`: `namespace_use_group` | `namespace_use_clause` (many), or one `namespace_name` before a group |
| `namespace_use_clause` | `type`: `function` or `const`; `alias`: `name` | one `name` or `qualified_name` |
| `namespace_use_group` | | `namespace_use_clause` (many) |
| `qualified_name` | `prefix`: `namespace_name` and the `\` tokens | `name` |
| `namespace_name` | | `name` (many) |

The `type` field sits on the clause for `use function A\f;` and on the declaration for a group,
`use function A\{f, g};`. Inside a group each clause holds a bare `name`, and the prefix is the
declaration's `namespace_name`.

## Go

### Forms

**doc** [Go spec, import declarations](https://go.dev/ref/spec#Import_declarations):

```
ImportDecl = "import" ( ImportSpec | "(" { ImportSpec ";" } ")" ) .
ImportSpec = [ "." | PackageName ] ImportPath .
```

"If the PackageName is omitted, it defaults to the identifier specified in the package clause of
the imported package." The spec's table:

| import | local name of `Sin` |
|---|---|
| `import "lib/math"` | `math.Sin` |
| `import m "lib/math"` | `m.Sin` |
| `import . "lib/math"` | `Sin` |
| `import _ "lib/math"` | none; imported for side effects |

The import names no symbol. **doc** [Go spec, qualified identifiers](https://go.dev/ref/spec#Qualified_identifiers):
"A qualified identifier accesses an identifier in a different package, which must be imported."
The symbols a file uses are the selector expressions `pkg.Name` in its body.

### Module to file

**doc** [Go modules reference](https://go.dev/ref/mod#modules-overview): "A package path is the
module path joined with the subdirectory containing the package (relative to the module root)."
The module path is the `module` directive in `go.mod`. A package is a directory: "At least one file
with the `.go` extension must be present in a directory for it to be considered a package."
From version 2 on, "module paths must have a major version suffix like `/v2`."

So `example.com/m/internal/util` under a `go.mod` saying `module example.com/m` is the directory
`internal/util`, and every `.go` file in it holds part of the package. A tail match on the full path
fails, because the host and module path are not directories. The default qualifier is the package
clause's name, which need not be the last path segment: under a `/v2` module it is not.

### Nodes

**run** and **doc** `tree-sitter-go` 0.25.0 `grammar.js:140-155`:

| node | fields | children |
|---|---|---|
| `import_declaration` | | `import_spec` or `import_spec_list` |
| `import_spec_list` | | `import_spec` (many) |
| `import_spec` | `name`: `package_identifier`, `dot` or `blank_identifier`; `path` (required): `interpreted_string_literal` or `raw_string_literal` | |

The path text is in the literal's `interpreted_string_literal_content` child. A use is a
`selector_expression` with fields `operand` (an `identifier`, the package name) and `field` (a
`field_identifier`, the symbol).

## C\#

### Forms

**doc** [C# reference, the using directive](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-directive):

| form | names | symbol |
|---|---|---|
| `using System.Text;` | a namespace | every type in it |
| `using Project = PC.MyCompany.Project;` | a namespace or a type | the alias |
| `using static System.Math;` | a type | its static members and nested types |
| `global using Foo.Bar;` | a namespace, for every file in the project | every type in it |

"In its basic form, the `using` directive imports all the types from a single namespace." The
`global` modifier "has the same effect as adding the same `using` directive to every source file in
your project", and the SDK adds implicit global usings for common namespaces.

### Module to file

**doc** [Namespaces and using directives](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/namespaces):
"The namespace name typically mirrors the folder structure of your project. For example, types in
a `Services/Payments` folder often belong to the `MyApp.Services.Payments` namespace." Typically,
not always: one namespace spans many files and folders, and a file may declare more than one. The
link from a type to its file is a convention enforced only by analyzers, for example
[IDE0130, namespace does not match folder structure](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ide0130)
and StyleCop's [SA1649, file name must match first type name](https://github.com/DotNetAnalyzers/StyleCopAnalyzers/blob/master/documentation/SA1649.md).
A `partial` class may sit in several files.

So a `using` names no file and no symbol. The symbols are type names in the body, and the file is
the one that declares the type, usually named after it. A global using leaves a file with no
import at all, which the plugin already notes for test runners (**code** `tree-facets.mjs:72`).

### Nodes

**run** and **doc** `tree-sitter-c-sharp` 0.23.5 `grammar.js:190-204`:

```js
using_directive: $ => seq(
  optional('global'),
  'using',
  choice(
    seq(optional('unsafe'), field('name', $.identifier), '=', $.type),
    seq(repeat(choice('static', 'unsafe')), $._name),
  ),
```

`using_directive` has one field, `name`, the alias. The target is an unfielded child: an
`identifier` or a `qualified_name` with fields `qualifier` and `name`. **`global` and `static` are
anonymous tokens**: `using static Foo.Bar.Util;` and `using Foo.Bar.Util;` give the same named tree.
A use in the body is a `member_access_expression` with fields `expression` and `name`.

## Ruby and Rails

### Forms

Plain Ruby loads files with `require "a/b"` (searched on the load path) and `require_relative
"../c"` (relative to the calling file). **run** prism 1.9.0: both parse as a `CallNode` with no
receiver, `name` `:require` or `:require_relative`, and an `ArgumentsNode` holding a `StringNode`
whose `unescaped` is the path.

Under Rails, application code does not require its own files. **doc** [Rails guide, autoloading,
config.autoload_paths](https://github.com/rails/rails/blob/d5c10191684c845d4ddb53587d3a2965270369fc/guides/source/autoloading_and_reloading_constants.md):
for `app/helpers/users_helper.rb`, "you do not need (and should not write) a `require` call for
it". The reference to the constant is the import.

### Constant to file

**doc** [Zeitwerk README, file structure](https://github.com/fxn/zeitwerk/blob/7e6dc10fcfc0ec174bec2c7a6ec19594d1b4579e/README.md#file-structure):

```
lib/my_gem.rb         -> MyGem
lib/my_gem/foo.rb     -> MyGem::Foo
lib/my_gem/bar_baz.rb -> MyGem::BarBaz
lib/my_gem/woo/zoo.rb -> MyGem::Woo::Zoo
```

- Root directories: "Every directory configured with `push_dir` is called a _root directory_, and
  they represent _root namespaces_", and by default that namespace is `Object`, so
  `models/user.rb` is `User`.
- Nested roots: "in frameworks like Rails, both `app/models` and `app/models/concerns` belong to the
  autoload paths ... `app/models/concerns/geolocatable.rb` should define `Geolocatable`, not
  `Concerns::Geolocatable`." Concerns are nested roots, not collapsed directories.
- Implicit namespaces: "Zeitwerk automatically creates modules on your behalf for directories
  without a corresponding Ruby file": `app/controllers/admin/users_controller.rb` is
  `Admin::UsersController`.
- Collapsing: `loader.collapse("#{__dir__}/booking/actions")` makes
  `booking/actions/create.rb` define `Booking::Create`. An app opts in; nothing is collapsed by
  default.
- Inflection: the basename is camelized (`users_controller` to `UsersController`, per the Rails
  guide), and acronyms are per-app overrides such as `"html_parser" => "HTMLParser"`.

**doc** the same Rails guide: the autoload paths are "all the subdirectories of `app` that exist
when the application boots, except for `assets`, `javascript`, and `views`", plus engines' paths
and anything pushed to `config.autoload_paths`; `lib` is added only by `config.autoload_lib`.
Railties declares this as `paths.add "app", eager_load: true, glob: "{*,*/concerns}", exclude:
["assets", javascript_path]` (**doc** [`railties/lib/rails/engine/configuration.rb:82-84`](https://github.com/rails/rails/blob/d5c10191684c845d4ddb53587d3a2965270369fc/railties/lib/rails/engine/configuration.rb#L82-L84)).

So `Foo::BarBaz` maps to the tail `foo/bar_baz` under any autoload root: `app/models/foo/bar_baz.rb`,
`app/services/foo/bar_baz.rb`, `app/models/concerns/foo/bar_baz.rb`. A constant `Foo` with no file
may be an implicit namespace, a directory.

A reference is resolved lexically before it reaches the autoloader. **doc** [Ruby docs, modules and
classes, constants](https://docs.ruby-lang.org/en/master/syntax/modules_and_classes_rdoc.html):
"Accessible constants are different depending on the module nesting", with `Module.nesting` inside
`module A; module B` being `[A::B, A]`. So `BarBaz` written inside `module Foo` is `Foo::BarBaz`,
and the written text alone undercounts the path.

### Nodes

**run** prism 1.9.0, `Prism.parse` and `pp`, with field definitions from **doc** prism's
`config.yml` at 1.9.0 (`ConstantPathNode` line 2114, `ConstantReadNode` 2245, `CallNode` 1458):

`Foo::BarBaz.call`:

```
CallNode name: :call
  receiver: ConstantPathNode name: :BarBaz
    parent: ConstantReadNode name: :Foo
```

`TagManager.instance.local_url?(x)`:

```
CallNode name: :local_url?
  receiver: CallNode name: :instance
    receiver: ConstantReadNode name: :TagManager
```

`::Top::X` is a `ConstantPathNode` whose innermost `parent` is nil: "It will be `nil` when the
constant lookup is at the root of the module tree." The symbol a caller uses is the `CallNode`
`name` whose receiver is the constant; for `TagManager.instance.local_url?` that is `instance`, and
`local_url?` is called on what it returns.

The plugin already serializes prism nodes as their type without `_node` (**code** `ruby.mjs:266`)
and joins a constant path into `Foo::Bar` (**code** `ruby-walk.mjs:146`, `constName`).

## Templates

### Blade

**doc** [Laravel 12.x Blade docs](https://laravel.com/docs/12.x/blade): "Blade template files use
the `.blade.php` file extension and are typically stored in the `resources/views` directory."
The view factory registers `'blade.php' => 'blade'` before `'php' => 'php'` (**doc**
[`View/Factory.php:65-70`](https://github.com/laravel/framework/blob/3f732656b1b97de366bce8ed147077ed11e25248/src/Illuminate/View/Factory.php#L65-L70)).

The syntax, from `BladeCompiler.php` and its concerns at `3f732656` on the 12.x branch
(**doc** [`src/Illuminate/View/Compilers/`](https://github.com/laravel/framework/tree/3f732656b1b97de366bce8ed147077ed11e25248/src/Illuminate/View/Compilers)):

| syntax | holds | source |
|---|---|---|
| `{{ expr }}` | a PHP expression, escaped | `$contentTags = ['{{', '}}']`, `BladeCompiler.php:112`; pattern `/(@)?{{\s*(.+?)\s*}}(\r?\n)?/s`, `CompilesEchos.php:91` |
| `{!! expr !!}` | a PHP expression, raw | `$rawTags`, `BladeCompiler.php:105`; `CompilesEchos.php:70` |
| `{{{ expr }}}` | a PHP expression, escaped | `$escapedTags`, `BladeCompiler.php:119` |
| `{{-- text --}}` | a comment, removed first | `CompilesComments.php`, `/{{--(.*?)--}}/s` |
| `@{{ text }}` | literal `{{ text }}`, for a JS framework | the optional `(@)?` in each echo pattern |
| `@@if` | literal `@if` | `compileStatement`, `BladeCompiler.php:658-659` |
| `@php ... @endphp` | a block of PHP statements | `storePhpBlocks`, `/(?<!@)@php(.*?)@endphp/s`, `BladeCompiler.php:424-429` |
| `@php($x = 1)` | one PHP statement | `CompilesRawPhp.php:13-16` |
| `@verbatim ... @endverbatim` | literal text, no Blade | `storeVerbatimBlocks`, `BladeCompiler.php:411-416` |
| `@name(expr)` | a directive whose argument is PHP | `compileStatements`, `/\B@(@?\w+(?:::\w+)?)([ \t]*)(\( ( [\S\s]*? ) \))?/x`, `BladeCompiler.php:543` |
| `@use('App\Models\Flight', 'Alias')` | a PHP `use` | `CompilesUseStatements.php`, emits `<?php use \App\Models\Flight as Alias; ?>` |

Directives with a PHP expression argument include `@if`, `@elseif`, `@unless`, `@isset`, `@empty`,
`@for`, `@foreach`, `@forelse`, `@while`, `@switch`, `@case`, `@continue(...)`, `@break(...)`,
`@include('view', [...])`, `@class([...])`, `@style([...])`, `@selected(...)` and `@json(...)`.
The argument runs to the parenthesis that balances, not the first `)` (`BladeCompiler.php:559-576`).
A `@word` that names no directive is left as written (`BladeCompiler.php:664-665`), so an e-mail
address survives.

Order matters for a reader. `@verbatim` and `@php` blocks are stored first, then comments are
removed, then component tags are compiled (`BladeCompiler.php:285-292`). After that the template
goes through PHP's own tokenizer, and only `T_INLINE_HTML` tokens are compiled
(`BladeCompiler.php:301-302`, `507-515`). A `<?php ... ?>` block already in the file is plain PHP
and Blade never touches it.

`@use` is the one Blade form that is an import. Its argument takes the PHP `use` shapes, groups and
`function` and `const` included (**doc** the Blade docs, "Raw PHP").

The shipped PHP grammar reads a `.blade.php` file as PHP: everything outside `<?php ?>` is a `text`
node (**code** `tree-shapes.mjs:79-81`). A class named inside `{{ }}` or `@if(...)` is not in any
PHP node.

### ERB

**doc** [Ruby ERB docs](https://docs.ruby-lang.org/en/master/ERB.html) and the `erb` 6.0.7 gem
source (`lib/erb.rb`, `lib/erb/compiler.rb`):

| syntax | holds | source |
|---|---|---|
| `<% code %>` | Ruby statements | "Execution tags" |
| `<%= expr %>` | a Ruby expression, its value output | "Expression tags" |
| `<%# text %>` | a comment, omitted | "Comment tags"; "the beginning of the tag must be `'<%#'`, not `'<% #'`" |
| `<%%` and `%%>` | literal `<%` and `%>` | `DEFAULT_STAGS = %w(<%% <%= <%# <%)`, `DEFAULT_ETAGS = %w(%%> %>)`, `compiler.rb:101-102`, `356-357`, `367-368` |
| `<%-` and `-%>` | as `<%` and `%>`, trimming the line | `trim_mode: '-'`, `erb.rb:449-466` |
| `% code` at line start | a Ruby line | `trim_mode: '%'`, `erb.rb:404-426` |

Rails renders `.erb` with Erubi, not the stdlib `ERB` (**doc** [`actionview/lib/action_view/template/handlers/erb.rb`](https://github.com/rails/rails/blob/d5c10191684c845d4ddb53587d3a2965270369fc/actionview/lib/action_view/template/handlers/erb.rb),
`erb_trim_mode` default `"-"` at line 16). Erubi's tag pattern is
`/<%(={1,2}|-|\#|%)?(.*?)([-=])?%>([ \t]*\r?\n)?/m` (**doc** [`erubi/lib/erubi.rb:53`](https://github.com/jeremyevans/erubi/blob/master/lib/erubi.rb#L53)),
so Rails also has `<%== expr %>`, output without escaping (`erb/erubi.rb:52`). `<%%` is a literal
in Erubi too (`erubi.rb:190-191`).

**doc** [Rails guide, Action View overview, templates](https://github.com/rails/rails/blob/d5c10191684c845d4ddb53587d3a2965270369fc/guides/source/action_view_overview.md):
"Rails uses the file extension to determine the view's format and templating system. For example,
a file with a `.html.erb` extension uses ERB." The handler is the last extension and the format the
one before it: `.html.erb`, `.text.erb`, `.js.erb`, `.json.erb`, and `.turbo_stream.erb`, a format
turbo-rails registers as `Mime::Type.register "text/vnd.turbo-stream.html", :turbo_stream`
(**doc** [`turbo-rails/lib/turbo/engine.rb:77`](https://github.com/hotwired/turbo-rails/blob/main/lib/turbo/engine.rb#L77)).
A bare `.erb` file outside `app/views`, such as a generator template, is also ERB.

## What this means for the resolver

The current resolver emits one specifier and a list of names, and looks the specifier up as a path
tail. Per language, the specifier to emit and where the tail lookup goes wrong:

**Python.** Absolute: `a.b.c` becomes the tail `a/b/c`; names from `from ... import`. Relative: join
the dots onto the importer's directory, one dot for its own directory, each more dot one level up,
then the dotted rest. Index `__init__` as a directory's file. Wrong where: the last segment is a
submodule, not a name (`from a import b` with `a/b.py` present, so try `a/b` before `a`); a single
segment (`import utils`) is dropped by the `/` rule today; a namespace package has no file; and
`import a.b` names no symbol, so the names are the `a.b.X` attributes used in the body.

**Java.** `a/b/C` from `import a.b.C`; for `import static a.b.C.m`, the tail `a/b/C` and the name
`m`. Read the anonymous `static` token, or a static import reads as a type `m` in a directory `C`.
Wrong where: a nested type (`a/b/C/Inner`, use the longest prefix that is a file), and on-demand
imports, which name a directory and no symbol.

**Kotlin.** `a/b/C` for a class. Wrong where: a top-level function or property, which names a
package directory and needs the file that declares it; a source tree that omits the common root
package, so try shorter tails; and wildcards, which the named tree cannot tell from a plain import.

**Rust.** Expand the use tree into one path per leaf, then anchor `crate::` at the importer's crate
`src/`, `self::` and `super::` at the importer's module (which differs between `a.rs` and
`a/mod.rs`), and a first segment naming a workspace crate at that crate's `src/lib.rs`, `-` read
as `_`. Index `mod` as a directory's file and `lib` and `main` as the crate's. Wrong where: the last
segment is an item, not a module (try the full path, then drop one segment); `#[path]`; `pub use`
re-exports, where the module named is not the file that declares the name; and a first segment
that is an external crate.

**PHP.** `Models/User` from `App\Models\User`, the composer prefix replaced by its directory, or the
prefix segment dropped and matched as a tail; the name is the last segment, or the alias's
original. Read `type` on the clause and the declaration. Wrong where: case (PSR-4 is case-exact,
the prefix directory is often lowercase); `use function` and `use const`, which no autoload maps;
and a namespace imported to be used as `NS\Class`, whose last segment is a namespace.

**Go.** The import path with the `go.mod` module path stripped, as a directory; the names are the
`field` of each `selector_expression` whose `operand` is the import's local name. Wrong where: the
tail is a directory, so the resolver needs every file in it or the one declaring the symbol; a dot
import, whose names are bare; a blank import, which has none; and the default local name, which is
the package clause's, not the last path segment.

**C#.** No path from the `using`. The specifier is each type name the body uses, and the file is the
one declaring that type, usually `TypeName.cs`. Read the anonymous `static` and `global` tokens.
Wrong where: everything a path tail assumes, since a namespace is not a directory by rule; partial
classes; global and implicit usings that leave nothing in the file.

**Ruby.** Each `ConstantReadNode` or `ConstantPathNode` outside a definition, underscored per
segment: `Foo::BarBaz` becomes `foo/bar_baz`, matched under the autoload roots; the name is the
`CallNode` `name` whose receiver is the constant. `require_relative` is a relative path; `require`
under `lib/` is a tail. Wrong where: lexical nesting makes the written path shorter than the real
one; acronym inflections; collapsed directories; a constant defined beside its parent in one file;
and a tail that two roots share. `app/models/report.rb` and `app/serializers/report.rb` both map
to `Report`, and Zeitwerk loads the first root's file and ignores the other: "the constant `Foo` is
autoloaded from the first one, and the rest of the files are not evaluated" (**doc** Zeitwerk
README, [shadowed files](https://github.com/fxn/zeitwerk/blob/7e6dc10fcfc0ec174bec2c7a6ec19594d1b4579e/README.md#shadowed-files)).
A tail index that marks the pair ambiguous drops it, which is the safe answer.

**Templates.** Blade's code sits in `{{ }}`, `{!! !!}`, `@php ... @endphp` and directive arguments,
after comments and `@verbatim` are removed; only `@use` is an import, and the rest are references
like any PHP body. ERB's code sits in `<% %>`, `<%= %>` and `<%== %>`, with `<%#` and `<%%` skipped.
A template's references need the code extracted and parsed before any of the above applies.
