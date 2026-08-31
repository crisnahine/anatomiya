# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**. One `CONTEXT.md` at the repo root, and `DECISIONS.md` in place of `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root. The glossary, and nothing else: what each term IS, with the synonyms
  to avoid.
- **`DECISIONS.md`** at the repo root. The decision record. This repo does not use `docs/adr/`; every
  decision that would be an ADR elsewhere is a row here. Read the sections that touch the area you are
  about to work in.
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

Each row is `| # | Decision | Why | Status |`.

- **`#`** is the stable id, for example `B10`, `E4`, `F5`. Cite decisions by that id.
- **`Why`** is the evidence the decision rests on, usually a measurement. A row whose `Why` names a number
  was settled by a probe, not by preference.
- **`Status`** is **what the code does today**, not what it should do. `done` means shipped, often with the
  owning module named. `partial` means shipped in some paths and not others, and the cell says which.
  `todo` means not built.

A `partial` or `todo` row is a known gap, not a defect to report as news. A `done` row the code no longer
honours **is** a defect, and worth surfacing.

## File structure

```
/
├── CONTEXT.md          ← the glossary
├── DECISIONS.md        ← the decision record, sections A to H
├── docs/
│   ├── how-it-works.md
│   ├── why.md
│   └── agents/         ← this directory: how skills read the repo
├── plugins/
│   ├── anatomiya/      ← bin/, lib/, commands/, hooks/
│   └── ultracode-anywhere/
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

If your output contradicts a `DECISIONS.md` row, surface it explicitly rather than silently overriding.
Cite the row id:

> _Contradicts B2 (oxc runs in child processes, never in-process), but worth reopening because…_

A row's `Why` is usually a measurement. Contradicting it means either the measurement no longer holds or
the situation changed, and saying which is the argument.
