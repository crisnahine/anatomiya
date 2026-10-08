# The script-block scanner against each framework's compiler

Dates: 2026-10-07 and 2026-10-08. `scriptBlocks` in `plugins/anatomiya/lib/script-blocks.mjs` finds
the `<script>` blocks of a `.vue` or `.svelte` file with no compiler installed. This is how often
it answers what the framework's own compiler answers. DECISIONS B52 and the 0.14.0 section of the
changelog cite the totals.

## Method

A script walks a repository for `.vue` or `.svelte` files, skipping `node_modules`, and for each
file asks the compiler and the scanner for the script blocks. A file agrees when both give the same
set of blocks, each compared on where its body starts and ends and on its `lang`.

- Vue: `parse` from `@vue/compiler-sfc` 3.5.43. The compiler's `script` and `scriptSetup` blocks
  are kept where they carry no `src` and their `lang` is absent or one of `js`, `jsx`, `ts`, `tsx`,
  which is what the scanner reads. An absent `lang` is compared as `js`.
- Svelte: `parse` from `svelte/compiler` 5.57.2 with `modern: true`. The compiler's `instance` and
  `module` scripts are compared, and the `lang` is `ts` where the first `<script>` that states a
  `lang` says `ts`, which is the compiler's own rule. A file the compiler throws on is left out and
  counted apart.

The run of 2026-10-07 also compared which of the two blocks each was (`setup` or plain,
`instance` or `module`). The scanner returns no such field as of 2026-10-08, so that day's run
compares range and `lang` alone.

## 2026-10-07: every repository

| kind | repositories | files | wrong |
|---|---|---|---|
| Vue | vitepress, element-plus, directus, vuejs/language-tools, vuetify, vue-element-admin, nuxt and vuejs/core at `4ab865a` | 4,100 | 0 |
| Svelte | sveltejs/kit, sveltejs/svelte.dev, huntabyte/shadcn-svelte | 3,586 | 0 |
| Svelte | the tests of sveltejs/svelte at `10fdca7` | 4,462, with 106 more the compiler throws on | 1 |

The one file is `packages/svelte/tests/runtime-runes/samples/proxy-coercive-assignment-warning/main.svelte`:
a top-level script with one space before it, which the scanner reads as a component with no
script. Over the Svelte files that is 8,047 of 8,048.

The same day the scanner's rule for a Svelte `<script` was measured three ways on the 4,462 test
components: the rule as shipped, where nothing but a comment, a style block or an accepted script
may precede it on its line, misses 1; allowing an indent misses 5; no line rule misses 8.

## 2026-10-08: the repositories still on disk, at this build

Five of the Vue repositories and svelte.dev were not on disk, so 3,004 of the Vue files and 557 of
the Svelte ones were not run again.

| kind | repository | files | blocks | wrong | compiler throws |
|---|---|---|---|---|---|
| Vue | vuejs/core at `4ab865a` | 11 | 4 | 0 | 0 |
| Vue | vitepress | 76 | 69 | 0 | 0 |
| Vue | element-plus | 1,009 | 772 | 0 | 0 |
| Svelte | sveltejs/kit | 1,015 | 546 | 0 | 1 |
| Svelte | shadcn-svelte | 2,014 | 2,028 | 0 | 0 |
| Svelte | the tests of sveltejs/svelte at `10fdca7` | 4,462 | 3,601 | 1 | 106 |

1,096 Vue files and 7,491 Svelte files, and the one file wrong is the same file.

## A block with no `lang`

Counted 2026-10-08 with the scanner, on the four component repositories of the corpus: the
components that hold a script, and those with a block read on the route a `.js` file takes because
no `<script>` in the file states a `lang` of `ts`.

| repository | components | with a script | with a block read as JavaScript |
|---|---|---|---|
| vitepress | 76 | 68 | 0 |
| element-plus | 1,009 | 772 | 0 |
| sveltejs/kit | 1,016 | 545 | 479 |
| shadcn-svelte | 2,014 | 1,983 | 10 |

How many of those blocks hold a type annotation, which Vue's compiler rejects under a bare
`<script>`, was not counted.
