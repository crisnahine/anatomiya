# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**. One `CONTEXT.md` at the repo root, and `DECISIONS.md` with `docs/decisions/` in
place of `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root. The glossary, and nothing else: what each term IS, with the synonyms
  to avoid.
- **`DECISIONS.md`** at the repo root. The index of the decision record. This repo does not use
  `docs/adr/`; every decision that would be an ADR elsewhere is a row here. Read the sections that touch
  the area you are about to work in.
- **`docs/decisions/<id>.md`**, one file per row, holding the row's full text. Open the files of the
  rows your work touches. Do not read the directory whole: it is about 800 KB.
- **`docs/how-it-works.md`**, the mechanical walkthrough of the pipeline. Useful when a decision row's
  `Why` assumes you know the stage it names.

Both root files always exist and are always in scope.

## How to read DECISIONS.md

One table per section, one row per decision:

| Section | Covers                                     |
| ------- | ------------------------------------------ |
| A       | Delivery: how the map reaches the agent    |
| B       | Engine: parsers, pool, guards, IPC         |
| C       | The counted-claim model                    |
| D       | Gates                                      |
| E       | Baseline and drift                         |
| F       | Safety                                     |
| G       | Scope                                      |
| H       | Layout: where a new file goes              |

The closing `What is deliberately not built` is prose rather than rows. Read it before proposing a
channel or a dependency this repo already refused.

Each row of the index is `| # | Decision | Status | File |`, on one line.

- **`#`** is the stable id, for example `B10`, `E4`, `F5`. Cite decisions by that id.
- **`Decision`** is the decision, whole.
- **`Status`** is one of three words: `done` where the row's Status opens with `**done**`, `partial`
  where it opens with `partial`, `todo` where it opens with `todo`.
- **`File`** links to `docs/decisions/<id>.md`.

So `grep -n "B10" DECISIONS.md` answers with the row and every row that cites it in its Decision, a
line each.

## How to read a row file

`docs/decisions/<id>.md` is `# <id>`, a `Section:` line, then three headings:

- **`## Decision`** is the same text as the index holds.
- **`## Why`** is the evidence the decision rests on, usually a measurement, one sentence per line. A row
  whose `Why` names a number was settled by a probe, not by preference. A few rows have none.
- **`## Status`** is **what the code does today**, not what it should do, one sentence per line.
  `**done**` means shipped, often with the owning module named. `partial` means shipped in some paths
  and not others, and the text says which. `todo` means not built.

`grep -rn "<word>" docs/decisions` answers with the sentences that hold the word, each under its row's
file name. `node scripts/decisions.mjs` prints the whole record as one table, a row per line.

`npm run check:docs` holds the two to each other: every row has a file and every file a row, and the
section, the Decision and the short status agree. `CONTRIBUTING.md` says how to add a row and how to
change one.

A `partial` or `todo` row is a known gap, not a defect to report as news. A `done` row the code no longer
honours **is** a defect, and worth surfacing.

## File structure

```
/
├── CONTEXT.md          ← the glossary
├── DECISIONS.md        ← the index of the decision record, sections A to H
├── docs/
│   ├── how-it-works.md
│   ├── why.md
│   ├── decisions/      ← one file per row: its Decision, Why and Status
│   └── agents/         ← this directory: how skills read the repo
├── plugins/
│   └── anatomiya/      ← bin/, lib/, commands/, hooks/
├── scripts/
└── test/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test
name), use the term as `CONTEXT.md` defines it, and not a word on its `_Avoid_` line.

Two terms in the code are known to disagree with the glossary, so read them with care:

- `directive` in the code sometimes means the claim side alone. In the glossary it is either stated
  sentence, which is what every doc, the README and the CLI mean by it.
- `baseline` appears at three levels of one result tree. The glossary splits it: **Pin** is what a human
  accepted, **Population** is one area's slice of it, **Baseline** is the counts measured there.

If the concept you need is in neither file, that's a signal. Either you're inventing language the project
does not use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a row, surface it explicitly rather than silently overriding. Read the row's
file first, since the Why is there and not in the index. Cite the row id:

> _Contradicts B2 (oxc runs in child processes, never in-process), but worth reopening because…_

A row's `Why` is usually a measurement. Contradicting it means either the measurement no longer holds or
the situation changed, and saying which is the argument.
