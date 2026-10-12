# What a parse child loads before its first file

2026-10-11, macOS arm64, Node 22.22.3. The base build is eac5b08; the head build is eac5b08 with
the change of 8842be06, which moves the five base oxc rows and `dimensionsFor` into
`dimensions-base.mjs` and has each engine body name its own row tables.

## Method

A fresh `node --expose-gc` process per sample imports one engine body and nothing else, after a
`gc()`, then runs `gc()` again. Recorded per sample: the import's wall time, the heap used after
minus the heap used before, and the heap used after. Base and head alternate, 25 samples each per
body. The figures are medians.

The machine was shared with other jobs: the one-minute load stayed above 12 for the 20 minutes
waited, and was 21.4 at the start and 25.0 at the end. The times move with that load; the heap
figures do not.

## Result

| body | build | import ms | heap added MB | heap after MB |
| --- | --- | --- | --- | --- |
| `parse-file.mjs` (JavaScript child) | base | 31.49 | 1.923 | 5.220 |
| `parse-file.mjs` (JavaScript child) | head | 25.00 | 1.420 | 4.717 |
| `tree-sitter-file.mjs` | base | 23.76 | 1.944 | 5.241 |
| `tree-sitter-file.mjs` | head | 19.62 | 1.504 | 4.801 |

A JavaScript child holds 0.50 MB less after load and a tree-sitter child 0.44 MB less. Neither loads
`dimensions.mjs`, so neither loads the other engines' rows or their walks.

In 0.15.0 `dimensionsFor` sits in `walk.mjs`, beside the walk, and not in
`dimensions-base.mjs`. Every child loads `walk.mjs` already, through the rows it runs, so 0.15.0's
JavaScript children load the same modules as the head build's, and its tree-sitter children one
fewer: `dimensions-base.mjs`, which they loaded only for `dimensionsFor`. DECISIONS B69 cites these
figures.

## Maps

Fifteen corpus repositories scanned with both builds, each from a fresh clone, every written file
compared with times, `mtimeMs`, the refresh `stamp`, `measuredUnder` and the scanned root's path
masked: errbit, huginn, vitepress, shadcn-svelte, flask, gin, ripgrep, gson, okhttp, serilog, Slim,
kotlinx.serialization, element-plus, the react-front-end and eslint. JavaScript, TypeScript,
Ruby, Vue, Svelte, Python, Go, Rust, Java, Kotlin, C# and PHP. Every file is byte-identical.
