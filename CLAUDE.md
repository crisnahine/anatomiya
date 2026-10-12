# anatomiya

Start with `DECISIONS.md` for what was decided, and `docs/how-it-works.md` for how the pipeline runs.
`README.md` is the user-facing view.

`DECISIONS.md` is an index: one short line per row. A row's Why and Status are in
`docs/decisions/<id>.md`, so grep the index for the row, then read that one file.

## Agent skills

### Issue tracker

Issues live as GitHub issues at `crisnahine/anatomiya`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. `DECISIONS.md` and `docs/decisions/` stand in for `docs/adr/`, and `CONTEXT.md` at the root
is the glossary.
See `docs/agents/domain.md`.
