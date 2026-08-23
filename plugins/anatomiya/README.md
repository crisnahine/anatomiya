# anatomiya

Counts what your code already does, directory by directory, and writes those counts into
`.claude/rules/` where a coding agent picks them up when it reads a file there.

This directory is the plugin. It is what a marketplace install copies, and it holds only what the
plugin loads: the manifest, the binary, the library it runs, the command files and the hook
declaration. The repository around it is the marketplace, the test suite and the gates, and none of
that ships.

## Install

```
/plugin marketplace add crisnahine/anatomiya
/plugin install anatomiya@crisnahine
/anatomiya:setup
```

`/plugin install` copies these files and installs nothing. The scanner has two runtime dependencies,
`oxc-parser` and `flow-remove-types`, and `/anatomiya:setup` is what installs them: it is the only
command that reaches a package registry. Outside Claude Code it is `node bin/anatomiya.mjs setup`,
run from this plugin's own directory.

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
