# Contributing

Read `DECISIONS.md` first. It is 103 numbered rows, each one a measurement or a review finding reduced
to the decision it forces on the code. It is the build contract, and most questions you will have
about why something is shaped the way it is are answered there in one line.

## Setup and tests

Node 22 or newer. ES modules, `.mjs` everywhere. Two runtime dependencies, `oxc-parser` and
`flow-remove-types`, the second loaded the first time a `.js`-family file is rejected. Ruby
dimensions need `prism` 1.x, a default gem on Ruby 3.4 and up, so a system Ruby is
usually enough. If you do not have Ruby, the Ruby tests skip and the rest still run.

```sh
npm install
node --test 'test/**/*.test.mjs'
```

`npm test` runs the same thing. A single file while you are working on it:

```sh
node --test test/encode.test.mjs
```

No test framework, no mocks, no fixtures generated at runtime. `node:test` and `node:assert` only.
Tests that need a repository build one in a temp directory with real `git init` and real commits,
because half the behaviour under test is git behaviour.

Run the tool against a real repository before you send anything:

```sh
node bin/anatomiya.mjs scan /path/to/some/repo --dry-run
```

`--dry-run` prints the plan and writes nothing.

## Comments

Comments say why. Never what.

The code in `lib/` is dense with reasoning and thin on narration, and that is the target. A comment
earns its place when it carries a measurement, a gotcha that bit someone, an invariant a future
editor would otherwise break, or the reason an obvious approach was rejected. Look at
`lib/corpus.mjs` and `lib/pool.mjs` for the density to aim for.

Match the surrounding density. Some files here carry a long block at the top and almost nothing
after it. Do not sprinkle line comments through a file whose siblings have none.

Do not write:

- restatements of the line below
- section labels (`// Constants`, `// Helpers`, banner bars)
- ticket references, PR numbers, or "as discussed"
- narration of the change (`// changed from X`, `// new`)
- planning leftovers (`// TODO: confirm with someone`, `// for now`)

Do write the thing that stops the next person undoing the work:

```js
// Measured: oxc reports UTF-16 code units and prism reports UTF-8 bytes, and
// 5.4% of real files are non-ASCII. Slicing the disk buffer corrupts silently.
```

## Every non-obvious decision traces to a row in DECISIONS.md

This is the rule that keeps the repository from drifting back into guesses.

If you write code whose shape is not obvious from reading it, there must be a row in `DECISIONS.md`
that says why, and the code comment should be a short version of that row rather than a pointer to
it. Comments do not cite decision ids; git history carries provenance.

If there is no row yet, add one. A row needs three things:

| # | Decision | Why | Status |
|---|---|---|---|

The `Why` column is where the work is. "It seemed cleaner" is not a why. A measurement, a probe that
overturned an assumption, or a concrete failure you reproduced is a why. Numbers beat adjectives:
"271x faster, 0.84s against 103s" is a why; "much faster" is not.

The `Status` column says what the code does today, not what it should do. `todo`, `partial` with the
file name, or `**done**` with the file name. Moving a row from `todo` to `done` is part of the change
that does it.

Changing an existing row means saying what new evidence overturned the old one. Rows are not opinions
and they do not get edited because a new implementation would be tidier.

## Adding a dimension

Start at `docs/dimension-intake.md`, not at the registry. A row goes in the table before it goes in
the code: which glossary entries the key answers, what it is renamed from if its own name would read
as a verdict beside a ratio, and whether it has a denominator at all. `npm run check:docs` fails if a
shipped key has no row there, and `lib/dimensions.mjs` refuses to load a claim that names a
principle. (G2, G3, G4)

A dimension is one counted claim about one area. It carries three numbers, never one:

- `applicability` files holding at least one candidate site. Not files that could hold one: a site
  the predicate cannot see is a file that does not count, which is why a narrow predicate has to be
  audited against the area's file count rather than trusted
- `candidates` sites inside those files where the construct appears
- `conforming` candidates matching the positive pattern

The ratio is `conforming / candidates`. Counting files instead of sites was measured flipping 10 of
39 verdicts, in both directions. It hides real conventions and it manufactures false ones.

A dimension whose claim belongs to a framework carries `framework: "rails"`, and is offered only
where the corpus shows that framework (C8). Mark one only where the predicate cannot see its own
context from a single file: `model_callbacks` and the migrations already gate on an `ActiveRecord`
superclass and need nothing, while `zone_aware_time` cannot tell Rails from plain Ruby by looking at
`Time.now`.

Where the code goes:

- `lib/dimensions.mjs` core JS and TS dimensions, plus the `ALL_DIMENSIONS` registry and
  `dimensionsFor()`. A dimension not reachable from here does not ship, whichever file defines it
- `lib/dimensions-extra.mjs` the rest of the JS and TS set
- `lib/dimensions-jsx.mjs` the React surface, `langs: ["jsx"]` only
- `lib/dimensions-ruby.mjs` Ruby, walking prism nodes through `walkRuby`
- `lib/dimensions-rails.mjs` Rails schema and migrations, also prism
- `lib/pairing.mjs` file-to-file obligations and the `PAIRINGS` registry. These are the one class not
  reachable from `ALL_DIMENSIONS`, because the parse worker runs that list and an obligation has no
  program to run against. `reduceArea` composes both registries

The shape:

```js
{
  key: "swallowed_error",
  claim: "catch blocks use the error they caught",
  counterClaim: null, // discarding the error is an absence, not a style anyone picked
  precision: "precise",
  applicabilityPredicate: {
    sites: "a file holding at least one catch clause, whether or not it binds the error",
    blind: null,
  },
  langs: ["js", "jsx"],
  run(program, add) {
    // one add() per candidate site, conforming decided per site
  },
}
```

A file-to-file obligation is the same three numbers with the site defined differently: the site is
the file, so `candidates` equals `applicability` and `conforming` counts the producers whose companion
exists. It carries no `run`; the shape is a directory pair:

```js
{
  key: "model_spec",
  kind: "pairing",
  claim: "a model ships with a spec",
  counterClaim: null,
  precision: "precise",
  applicabilityPredicate: {
    sites: "a .rb file anywhere under app/models whose own name does not end in _spec.rb, once the repository is seen using that suffix at all",
    blind: null,
  },
  langs: ["ruby"],
  from: "app/models",
  to: "spec/models",
  ext: ".rb",
  companionSuffix: "_spec.rb",
}
```

Three rules are particular to this class. A repository is only asked the question for a companion
suffix it actually uses, because producers exist whatever the repository tests with and a row that
can only read zero is a false statement rather than a measurement.

`to` is the declared pair, and it is a prior rather than an answer. The root is learned from the
corpus by asking each producer which file ends with its own path tail, and the declared pair stands
where the evidence ties or finds nothing (C9). Measured on alphagov/whitehall, whose model tests sit
under `test/unit/app/models`: the app/models area read 0 of 160 against the declared `test/models`
and reads 117 of 160 against the root it actually uses. A tie learns nothing, or an obligation is
decided by whichever filename sorts first.

And every such row carries `companionsElsewhere`, the producers whose companion is missing where the
predicate looks but whose namesake exists elsewhere. It is the number that separates "this
repository has no such habit" from "the predicate is looking in the wrong place", which is what made
the learned root worth building.

`counterClaim` is not optional. It is the sentence an area is handed when it consistently does the
opposite, and it is hand-written because a machine negation names nothing for the agent to write and
because writing the inverse out loud is where an inverse that is really a defect becomes visible.
Where the other side is a defect rather than a style, the value is an explicit `null` with the reason
beside it. An absent key is not a third state, and `npm run check:docs` fails on one.

`claim` is rendered to the agent, so write it as a statement about the code, not a verdict about the
repository. A rendered `1.0` next to a principle's name reads as a philosophical endorsement instead
of a measurement.

`precision` is `precise` or `partial`. Mark it `partial` when the predicate under-counts applicability
in cases the parser cannot see, for example a `throw` inside a helper the caller wraps. That is the
dangerous direction, so a `partial` dimension can never reach top severity. Guessing `precise` to get
a stronger directive is the worst thing you can do here.

`run` calls `add({ node, conforming, where })` once per site. `where` is the enclosing declaration
name, used to make an exception readable. A file that produces no hits is not applicable and drops
out of `applicability` on its own, which is why `run` must not `add` for files where the construct
never appears.

Then register it so `dimensionsFor()` returns it for the languages it claims, and add tests. Every
dimension needs at least a conforming case, a violating case, and one case that must not be counted
at all. That third one is where the bugs live: a property key that spells the same name as a
binding, a rethrow inside a catch, an inner arrow whose `try` sits inside the outer function's byte
range.

A dimension with no writable applicability predicate does not ship, and the predicate is a field
rather than advice. Every row carries:

```js
applicabilityPredicate: {
  sites: "a file holding at least one catch clause, whether or not it binds the error",
  blind: null,
},
```

`sites` says which files could participate at all. Write it from the `run` body, not from the claim:
the claim says what conforming means, this says what applicable means. `blind` is what the predicate
cannot see, and it is tied to `precision` so the marker and the reason cannot disagree. A `partial`
row needs a sentence there; a `precise` row spells `null`. An absent key is not a third state, and
`assertApplicability` refuses the whole registry at load over one.

Then add the witness pair in `test/applicability.test.mjs`: the sources your sentence says are
applicable, and the neighbouring construct that must not count. A row with no witness fails the
completeness test, and a sentence the code disagrees with fails the other two.

`applicable` is a list, and the length is the point. Where your sentence names several forms, write
one source per form the code treats differently: two call shapes, two node types, two spellings.

Where the predicate recognises its construct through a closed table of names, every member of that
table gets driven through it: in the witness list where the members are few, and in `TABLES` where
they are not. Either way the members are written out in the test rather than read from the table. A table is one shape, so the witness pairs never notice it shrinking: dropping
`next-intl` from the module list makes every file in such a repository inapplicable and changes no
shape at all. An expectation read from the table would agree with the table by construction and
could never disagree with it, which is why the list is spelled out. One source proves the sentence names something and nothing more:
narrowing `optional_chaining` from six receiver names to one under-counts its applicability sixfold
and a single `opts` witness stays green straight through it. Where the sentence promises a count,
say the count, since a non-zero assertion proves nothing about it:

```js
applicable: [{ source: `<Child {...p} {...q} />`, sites: 2 }],
```

`inapplicable` is a list too, and each exclusion your sentence names earns one, by the same rule. Writing the
applicable half and finding it hard is itself the answer: a predicate nobody can demonstrate is one
nobody can audit.

The share is auditable across repositories rather than by eye, one line at a time:

```sh
npm run audit:applicability -- /path/to/repo/.claude/anatomiya/facts.json ...
```

It flags any `precise` row whose median `applicability / langFileCount` sits under 0.25, falling back
to the area's own file count where a slot has none, which is what the gate divides by. A flag is a
prompt to open the row, never a verdict: measured across four repositories, all six flagged rows
named a construct that is simply rare. The share is not what finds an under-counting predicate. It
cannot separate one from a rare construct, and the one under-count found so far was caught by a
witness, on a row the share never flagged.

## The bar a new dimension has to clear

**A dimension is only worth shipping if repositories genuinely differ on it.**

This is the bar that gets missed, so here is the case that produced it. `module_state_const` shipped,
and on a real repository it scored 620 out of 620. Not because that repository has a strong
convention about module-level bindings, but because `const` at module level is what the language
pushes you towards. The dimension measured a language default. It stated a directive that cannot be
violated, taught the agent nothing, and spent always-loaded context doing it. Every generated file
stays under about 40 lines for measured reasons, so a wasted line is a real cost.

A directive an agent could not have broken is worse than no directive. It burns context and it
teaches the reader that the map states obvious things, which is how a map stops being read.

So before a dimension is accepted:

1. **Run it on at least two real repositories** other than this one. Real means not written for the
   test, with history and more than one author.
2. **Report the numbers per repository** in the pull request: `applicability`, `candidates`,
   `conforming`, `ratio`, and the area they came from. Not a summary, the actual counts.
3. **The ratios must spread.** At least one repository must land below the 0.90 gate, and the spread
   between the highest and lowest ratio must be at least 0.15. If every repository sits at or near
   1.0, the dimension is a language default and it does not ship, however sensible the claim sounds.
   The 0.15 is a working threshold set to make the test bite, not a measured constant; if you think
   it is wrong, argue it with numbers and move it in `DECISIONS.md`.
4. **Sanity check the applicability predicate.** A wrongly narrow predicate gives ratio 1.0 over a
   small candidate set and reads as a strong convention. Compare `applicability` against the area's
   file count and be suspicious of anything under a quarter.
5. **Check it is not the linter's job.** If ESLint or RuboCop already fails the build on it, the map
   restating it is noise. The map is for what the linter does not enforce.

A claim that reads well and scores 1.0 everywhere is the failure mode this bar exists to catch. Kill
it early. Rejecting a dimension is a good outcome and worth a row in `DECISIONS.md` explaining what
the measurement showed, so nobody proposes it again.

## Pull requests

Keep the diff to one thing. Say what you measured and what the numbers were. If a change touches
anything in section F of `DECISIONS.md`, say how you tested that the property still holds, because
those are the rows where a plausible-looking refactor quietly removes a control.

No attribution boilerplate in commits, code, or documentation. No tool or vendor footers, no
generated-by banners, no co-author trailers.

## Releases

`docs/releasing.md` is the list. Work it top to bottom rather than from memory: the version lives in
four places, the changelog has to keep a heading the checker reads, and the tag is what actually
releases. `0.1.10` shipped with no tag because none of that was written down.
