# The rows that were measured and not shipped

Date: 2026-10-07. Four questions were measured over the seven languages a tree-sitter grammar reads
and refused: how a function is named, whether an import names what it takes, whether a handler uses
the error it caught (in the three languages the shipped row leaves out), and how a file is named.
DECISIONS C51, C52, C54 and H52 and `docs/dimension-intake.md` draw on these tables.

The rows for naming and imports were removed from the tree after this measurement, and so were the
handler row's Python, Kotlin and C# shapes. Nothing in the repository counts their sites, so these
tables cannot be run again from it and this file is the record. The filename shares in section 4
are the exception: the row is in the tree, asked of none of the seven.

How it was taken: one script read each repository in place through the build's own `collect`,
`parseAll`, `discover` and `reduceArea`, on the build of 2026-10-07 that held all five candidate
rows. A ratio is conforming sites over candidate sites, summed over a repository's areas. Three
repositories per language, 21 in all: django, flask and fastapi; laravel, composer and Slim; caddy,
gin and hugo; commons-lang, junit5 and gson; jellyfin, serilog and Newtonsoft.Json; ripgrep, tokio
and serde; okhttp, ktor and kotlinx.serialization. The commit each clone sat at was not recorded.

The bar a row has to clear to be asked of a language: one of its three repositories under 0.90, and
0.15 or more between the lowest and the highest.

## 1. How a function is named (C54)

Sites are the functions and methods an author named. A site conforms when it is in its area's
commonest case class. Go and Rust were not measured.

| language | repository | areas | sites | conforming | ratio | lowest area | areas stating it |
|---|---|---|---|---|---|---|---|
| Python | django | 87 | 6,179 | 6,135 | 0.9929 | 0.5526 | 38 of 87 |
| Python | flask | 10 | 288 | 288 | 1.0000 | 1.0000 | 1 of 10 |
| Python | fastapi | 38 | 956 | 946 | 0.9895 | 0.9545 | 2 of 38 |
| PHP | laravel | 96 | 9,149 | 9,143 | 0.9993 | 0.9483 | 56 of 96 |
| PHP | composer | 28 | 2,188 | 2,188 | 1.0000 | 1.0000 | 18 of 28 |
| PHP | Slim | 9 | 224 | 224 | 1.0000 | 1.0000 | 5 of 9 |
| Java | commons-lang | 19 | 2,535 | 2,535 | 1.0000 | 1.0000 | 6 of 19 |
| Java | junit5 | 59 | 3,065 | 3,065 | 1.0000 | 1.0000 | 11 of 65 |
| Java | gson | 11 | 496 | 496 | 1.0000 | 1.0000 | 4 of 11 |
| Kotlin | okhttp | 45 | 1,447 | 1,445 | 0.9986 | 0.8750 | 14 of 49 |
| Kotlin | ktor | 138 | 3,903 | 3,783 | 0.9693 | 0.5143 | 65 of 138 |
| Kotlin | kotlinx.serialization | 37 | 1,061 | 1,007 | 0.9491 | 0.6038 | 9 of 37 |
| C# | jellyfin | 82 | 5,471 | 5,471 | 1.0000 | 1.0000 | 50 of 82 |
| C# | serilog | 20 | 815 | 815 | 1.0000 | 1.0000 | 8 of 20 |
| C# | Newtonsoft.Json | 13 | 2,333 | 2,333 | 1.0000 | 1.0000 | 5 of 13 |

In every table of this shape `areas` counts the areas where the row was asked of that line's
language, and `areas stating it` is taken over every area of the repository the row was asked in,
whatever the language. The two differ where a repository holds a second language the row was asked
of: junit5 has 6 Kotlin areas beside its 59 Java ones, okhttp 4 Java areas beside its 45 Kotlin
ones, and in section 2 ktor one Rust area beside its 157 Kotlin ones.

| language | lowest | highest | spread | one under 0.90 | spread of 0.15 |
|---|---|---|---|---|---|
| Python | 0.9895 | 1.0000 | 0.0105 | no | no |
| PHP | 0.9993 | 1.0000 | 0.0007 | no | no |
| Java | 1.0000 | 1.0000 | 0.0000 | no | no |
| Kotlin | 0.9491 | 0.9986 | 0.0495 | no | no |
| C# | 1.0000 | 1.0000 | 0.0000 | no | no |

No repository is under 0.90 and the widest spread is Kotlin's 0.0495. No language clears either
half of the bar.

## 2. Whether an import names what it takes (C52)

Sites are import lines. A site conforms when it names what it imports and takes no wildcard. PHP, C#
and Go were not asked.

| language | repository | areas | sites | conforming | ratio | lowest area | areas stating it |
|---|---|---|---|---|---|---|---|
| Python | django | 116 | 11,677 | 11,642 | 0.9970 | 0.9275 | 79 of 116 |
| Python | flask | 13 | 666 | 666 | 1.0000 | 1.0000 | 7 of 13 |
| Python | fastapi | 63 | 3,920 | 3,920 | 1.0000 | 1.0000 | 3 of 63 |
| Java | commons-lang | 27 | 4,339 | 4,339 | 1.0000 | 1.0000 | 12 of 27 |
| Java | junit5 | 81 | 16,994 | 16,992 | 0.9999 | 0.9500 | 29 of 89 |
| Java | gson | 19 | 2,606 | 2,606 | 1.0000 | 1.0000 | 12 of 19 |
| Kotlin | okhttp | 57 | 6,260 | 6,260 | 1.0000 | 1.0000 | 35 of 61 |
| Kotlin | ktor | 157 | 13,008 | 4,747 | 0.3649 | 0.0000 | 0 of 158 |
| Kotlin | kotlinx.serialization | 56 | 2,562 | 693 | 0.2705 | 0.0000 | 0 of 56 |
| Rust | ripgrep | 18 | 285 | 251 | 0.8807 | 0.6667 | 0 of 18 |
| Rust | tokio | 52 | 4,397 | 4,323 | 0.9832 | 0.9200 | 41 of 52 |
| Rust | serde | 26 | 529 | 483 | 0.9130 | 0.5556 | 2 of 26 |

| language | lowest | highest | spread | one under 0.90 | spread of 0.15 |
|---|---|---|---|---|---|
| Python | 0.9970 | 1.0000 | 0.0030 | no | no |
| Java | 0.9999 | 1.0000 | 0.0001 | no | no |
| Kotlin | 0.2705 | 1.0000 | 0.7295 | yes | yes |
| Rust | 0.8807 | 0.9832 | 0.1025 | yes | no |

Kotlin clears the bar by its letter and was refused for another reason: ktlint's
`no-wildcard-imports` is in its standard rule set, and the areas that stated the claim sit where a
build applies it. C52 quotes the count of those areas from a later build of the same day,
which asked the row of Kotlin alone:

| repository | areas | sites | conforming | ratio | areas stating it |
|---|---|---|---|---|---|
| okhttp | 57 | 6,260 | 6,260 | 1.0000 | 33 of 57 |
| ktor | 157 | 13,008 | 4,747 | 0.3649 | 0 of 157 |
| kotlinx.serialization | 56 | 2,562 | 693 | 0.2705 | 0 of 56 |

The sites and ratios are the same as in the first table, and the stated areas are that build's.

Go's nearest form is the dot import. Counted with `git grep` over the import lines of the three Go
clones on 2026-10-08:

| repository | import lines | dot imports |
|---|---|---|
| caddy | 3,070 | 0 |
| gin | 541 | 0 |
| hugo | 6,252 | 1 |

## 3. Whether a handler uses the error it caught, where the row is not asked (C51)

The row ships for PHP and Java. Python, C# and Kotlin were measured and left out.

| language | repository | sites | conforming | ratio | with generated files left out |
|---|---|---|---|---|---|
| Python | django | 285 | 285 | 1.0000 | 285 of 285, 1.0000 |
| Python | flask | 19 | 19 | 1.0000 | 19 of 19, 1.0000 |
| Python | fastapi | 23 | 23 | 1.0000 | 23 of 23, 1.0000 |
| C# | jellyfin | 442 | 412 | 0.9321 | 412 of 442, 0.9321 |
| C# | serilog | 17 | 17 | 1.0000 | 17 of 17, 1.0000 |
| C# | Newtonsoft.Json | 77 | 69 | 0.8961 | 68 of 76, 0.8947 |

Python reads 1.0000 in all three. C# has one repository under 0.90 and a spread of 0.1039.

Kotlin was read two ways. A `catch (_: E)` names nothing. Counted as a binding the handler does not
use, it is a site; read as a handler with no name, it is none:

| repository | `_` is a site: sites, conforming, ratio | `_` is no site: sites, conforming, ratio |
|---|---|---|
| okhttp | 283, 172, 0.6078 | 222, 171, 0.7703 |
| ktor | 649, 411, 0.6333 | 494, 407, 0.8239 |
| kotlinx.serialization | 37, 24, 0.6486 | 34, 24, 0.7059 |

Spread 0.0409 the first way and 0.1180 the second. All three repositories are under 0.90 both
ways and neither spread reaches 0.15.

## 4. How a file is named (H52)

Share of a repository's filename sites in its commonest case class. The affix a test collector
reads (`_test`, `test_`) and the names a language reads (`__init__`, `__main__`, `package-info`,
`module-info`) are out of the vote. The last column leaves out every file a tool wrote.

| language | repository | sites | commonest class | share | hand-written only: sites, share |
|---|---|---|---|---|---|
| Python | django | 358 | snake_case, 358 | 1.0000 | 358, 1.0000 |
| Python | flask | 9 | snake_case, 9 | 1.0000 | 9, 1.0000 |
| Python | fastapi | 622 | snake_case, 622 | 1.0000 | 622, 1.0000 |
| PHP | laravel | 2,975 | PascalCase, 2,874 | 0.9661 | 2,974, 0.9660 |
| PHP | composer | 538 | PascalCase, 533 | 0.9907 | 538, 0.9907 |
| PHP | Slim | 124 | PascalCase, 124 | 1.0000 | 124, 1.0000 |
| Go | caddy | 57 | snake_case, 57 | 1.0000 | 57, 1.0000 |
| Go | gin | 18 | snake_case, 18 | 1.0000 | 18, 1.0000 |
| Go | hugo | 276 | snake_case, 241 | 0.8732 | 276, 0.8732 |
| Java | commons-lang | 607 | PascalCase, 607 | 1.0000 | 607, 1.0000 |
| Java | junit5 | 1,670 | PascalCase, 1,669 | 0.9994 | 1,670, 0.9994 |
| Java | gson | 256 | PascalCase, 256 | 1.0000 | 256, 1.0000 |
| C# | jellyfin | 2,246 | PascalCase, 2,244 | 0.9991 | 2,187, 0.9995 |
| C# | serilog | 213 | PascalCase, 213 | 1.0000 | 213, 1.0000 |
| C# | Newtonsoft.Json | 948 | PascalCase, 948 | 1.0000 | 945, 1.0000 |
| Rust | ripgrep | 9 | snake_case, 8 | 0.8889 | 9, 0.8889 |
| Rust | tokio | 469 | snake_case, 453 | 0.9659 | 469, 0.9659 |
| Rust | serde | 125 | snake_case, 104 | 0.8320 | 125, 0.8320 |
| Kotlin | okhttp | 550 | PascalCase, 550 | 1.0000 | 550, 1.0000 |
| Kotlin | ktor | 2,313 | PascalCase, 2,306 | 0.9970 | 2,313, 0.9970 |
| Kotlin | kotlinx.serialization | 692 | PascalCase, 549 | 0.7934 | 553, 0.9729 |

| language | lowest, highest and spread |
|---|---|
| Python | 1.0000, 1.0000, 0.0000 |
| PHP | 0.9661, 1.0000, 0.0339 |
| Go | 0.8732, 1.0000, 0.1268 |
| Java | 0.9994, 1.0000, 0.0006 |
| C# | 0.9991, 1.0000, 0.0009 |
| Rust | 0.8320, 0.9659, 0.1339 |
| Kotlin | 0.7934, 1.0000, 0.2066 |

Python, Java, C# and PHP meet neither half of the bar. Go and Rust each have a repository under 0.90
and miss the spread. Kotlin clears it by its letter: 139 kebab-case names in kotlinx.serialization,
and with files a tool wrote left out it reads 0.9729 on 553 sites.

## 5. What was not kept

- The commit of each of the 21 clones on the day of the measurement.
- junit5's stated areas for the imports row over its Kotlin build files (4 of 9, in C52), and the
  count of stated areas inside a project that applies ktlint (31 of 37, with 363 and 276 imports in
  the six areas outside one). They were read off a build configuration and a script's output that
  was not kept.
- hugo's filename share with the test affix left in the vote (0.9625, in H52).
- The share of each repository's files that hold a filename site (12%, 15% and 8%, in H52) follows
  from the site counts in section 4 and each repository's file count: 358 of 2,924 in django, 57 of
  371 in caddy and 9 of 110 in ripgrep.
