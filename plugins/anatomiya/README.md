# anatomiya

Counts what your code already does, directory by directory, and writes those counts into
`.claude/rules/` where a coding agent picks them up when it reads a file there. Asked with
`scan --targets cursor,copilot`, it writes the same counts for Cursor and GitHub Copilot too.

This directory is the plugin. It is what a marketplace install copies: the manifest, the binary, the
library it runs, the command files, the hook declaration and the grammars, plus the `package.json` and
`package-lock.json` its dependencies are installed from, the license and this file. The repository
around it is the marketplace, the test suite and the gates, and none of
that ships.

## Install

```
/plugin marketplace add crisnahine/anatomiya
/plugin install anatomiya@crisnahine
```

The scanner has three runtime dependencies, `oxc-parser`, `flow-remove-types` and
`web-tree-sitter`, and `/plugin
install` installs them: Claude Code runs `npm ci --ignore-scripts` in a plugin's own directory when
it finds a lockfile there, and this plugin ships one. `web-tree-sitter` is the WebAssembly runtime
for the seven grammars under `grammars/`, which ship as `.wasm` files and are not downloaded:
Python, PHP, Go, Java, C#, Rust and Kotlin.

Where nothing was installed, `/anatomiya:doctor` says so in its first line; where an install ran and
stopped short, its engine lines say which one did not load. `/anatomiya:setup` answers both, and it
is the only command that reaches a package registry. A grammar file that does not load is named on
the `tree-sitter` line, and the fix for that is to reinstall the plugin. Outside Claude Code it is
`node bin/anatomiya.mjs setup`, run from this plugin's own directory.

## What it does

`/anatomiya:scan` counts, `/anatomiya:pin` records a baseline, `/anatomiya:check` reports what moved
against it, and `/anatomiya:doctor` says what is installed. Every count is measured from the tree
rather than assumed, and a claim states how many sites conform out of how many were eligible.

The full account lives in the marketplace repository, and the links are absolute because this file
installs into a directory the rest of it does not follow to:
[`README.md`](https://github.com/crisnahine/anatomiya/blob/main/README.md) for the user-facing view,
[`docs/how-it-works.md`](https://github.com/crisnahine/anatomiya/blob/main/docs/how-it-works.md) for
the pipeline, and [`DECISIONS.md`](https://github.com/crisnahine/anatomiya/blob/main/DECISIONS.md)
for what was decided and why.
