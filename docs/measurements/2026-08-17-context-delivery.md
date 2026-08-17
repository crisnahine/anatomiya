# How long one delivery lasts, over 12,500 sessions

Date: 2026-08-17. What the delivery channel actually did, counted off the sessions it ran in rather
than off the files the tool wrote.

`scripts/measure-delivery.mjs <transcriptDir>` runs it, over a Claude Code transcript store,
usually `~/.claude/projects`. It reads nothing from `.claude/rules/`: the whole point is to tell
what the tool wrote apart from what a session received.

The map arrives as Claude Code **nested memory**. The overview carries no `paths` key and loads
unconditionally; an area file carries one and loads when a matching file is read. A transcript
records each arrival as an entry whose `attachment.type` is `nested_memory`, carrying the path, the
globs from the file's `paths:` frontmatter, and the body as delivered. So a session that has
already run can be asked what it got and when.

Matching is on that attachment and on nothing else. The first cut of this counted every line
holding a rule filename, and a bash result listing `.claude/rules/` read as eight deliveries.

## What was in question

Issue #44 measured that a delivery happens once and concluded two things from it: that the counts
sit at their delivery turn and decay from there, and that compaction is terminal, since the attach
had already happened and no later read could bring it back. The second one decides whether the tool
needs a re-delivery channel at all, and nothing here had counted it.

## Result

Over 12,500 transcripts:

| | all instruction files | `--match anatomiya` |
|---|---|---|
| sessions holding a delivery | 334 | 94 |
| deliveries, main thread | 912 | 169 |
| of those, path-scoped | 436 | 148 |
| deliveries into a subagent | 12 | 8 |
| a path delivered more than once | 84 | 6 |
| with a compaction between the two | 46 | 6 |
| sessions that compacted after a delivery | 12 | 2 |
| of those, ones that got a path back | 9 | 2 |

**Compaction is not terminal.** A path-scoped rule is deduped against the context window, not
latched for the session, so a rebuilt window rebuilds the set. Of the 12 sessions that compacted
after taking a delivery, 9 took the same path again afterwards. On anatomiya's own files, all 6
repeats had a compaction between them.

The 38 repeats with no compaction between them sit in sessions resumed after a long idle: same
session id, same client version, and a gap of about five and a half hours across the boundary in
the clearest one. The script counts those as `other` rather than naming a cause it cannot see in
the entry.

Two cases on the client version in use, both worth naming because they are the whole finding:

- `fd17e5a3` (this repository, 2026-08-16, v2.1.233) took `CLAUDE.md` and the overview back at the
  compaction boundary, then `anatomiya-area-9f86d081.md` about 200 entries later and
  `anatomiya-area-76b5a357.md` about 380 entries after that, each on a read that matched.
- `6c9a958d` (the Rails API map, 2026-08-15, v2.1.233) took `CLAUDE.md` and the overview back
  directly after the boundary, and read no matching file afterwards, so no area file returned.

That split is the mechanism: the unscoped file comes back at the boundary, the scoped one comes
back on the next read that matches it.

## The vendor's own account

Claude Code documents the same thing, which is worth recording beside the count because the count
is one machine's history and the documentation is the contract
([context window](https://code.claude.com/docs/en/context-window#what-survives-compaction),
[memory](https://code.claude.com/docs/en/memory#instructions-seem-lost-after-compact)):

| Mechanism | After compaction |
|---|---|
| Project-root CLAUDE.md and unscoped rules | Re-injected from disk |
| Rules with `paths:` frontmatter | Lost until a matching file is read again |
| Nested CLAUDE.md in subdirectories | Lost until a file in that subdirectory is read again |

"Re-injected from disk" is the part A8 did not have. A session that compacts after a re-scan gets
the new overview, not the one it started with, without being restarted. The restart line stays
right, because no session can be told to compact.

The `InstructionsLoaded` hook carries the same fact in its input: `load_reason` takes the values
`session_start`, `nested_traversal`, `path_glob_match`, `include` and `compact`, and the
documentation says the `compact` value "fires when instruction files are re-loaded after a
compaction event" ([hooks](https://code.claude.com/docs/en/hooks#instructionsloaded)).

## What this does not settle

**Decay inside one window stands.** Between two rebuilds the counts are delivered once, at whatever
turn the first matching read happened, and every later turn moves the work further from them. No
`SessionStart` matcher reaches that, since it fires at a boundary and this is the stretch between
boundaries.

**How often it bites is not measured here.** 12 of 334 sessions compacted after a delivery, which
says compaction is rare in this history, not that it is rare in a long session on a large
repository. The sessions in this store are mostly short.

**The trigger set is not settled.** 160 of the 912 deliveries have a `Bash` call as the entry
before them and a handful have `Edit` or `Write`, against `docs/how-it-works.md` saying a read or an
`@file` mention and nothing else. A controlled probe, a bash command naming a file that matched an
undelivered area glob in a project the session had already visited, delivered nothing. The likely
reading is first touch of a directory the session had not visited yet, which discovers that
directory's memory set. Not proven, and this script does not attribute a trigger.

**Subagents are counted apart and thinly.** 12 deliveries in this store arrived in a sidechain. A
subagent gets its own window, so its delivery is not evidence about the main thread either way.
