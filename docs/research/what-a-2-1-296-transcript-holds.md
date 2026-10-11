# What a 2.1.296 transcript holds

Read on 2026-10-11, read-only, from the transcripts under `~/.claude/projects/*/` and the build at
`~/.local/share/claude/versions/2.1.296` (`scripts/claude-build.mjs` finds it). Only record types,
keys, sizes and timestamps were read out; no content. The scripts that read them sit outside the
repository and print counts.

## Which records the model reads

Every record is one JSON line. Two families, told apart by their first key:

- Message records start with `parentUuid`: `user`, `assistant`, `attachment` and `system`
  (774k, 447k, 275k and 10k lines over 40 days of transcripts).
- Bookkeeping records start with `type` and never reach the model: `queue-operation`,
  `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `ai-title`, `custom-title`, `agent-name`,
  `file-history-snapshot`, `file-history-delta`, `cost-state`, `pr-link`, `bridge-session`,
  `worktree-state` and a few rarer ones. `queue-operation` is the large one: 1.8 MB over the six
  2.1.296 sessions of the last three days.

Among attachments, the build itself says which the model reads. In the bundle, `r7` computes
`rendered` for an attachment by converting it to messages and sets it only when the conversion yields
some (`if(n===void 0)return{}`); `renderedRole` is `user` or `system` beside it. A second set, `jUn`,
names the attachments the build strips from the message list before a forked agent sees it:
`prompt_snapshot`, `prompt_render_point`, `deferred_tools_record`.

Counted over 14 days of transcripts (4,376 files):

| Attachment | With `rendered` | Without |
|---|---|---|
| `prompt_snapshot` | 0 | 7,819 |
| `deferred_tools_record` | 0 | 11,140 |
| `hook_success` | 617 | 128,368 |
| `credential_org`, `command_permissions`, `structured_output`, `goal_status` | 0 | all |
| `hook_additional_context` | 8,600 | 0 since 2.1.263 |
| `instructions` (the CLAUDE.md files) | all on 2.1.296 | 0 |

`rendered` first appears on 2.1.263: `hook_additional_context` carries it on every line from 2.1.263
on and on none from 2.1.233, 2.1.241 or 2.1.260.

A rendered attachment holds its text twice, once under `attachment` and once under `rendered`:
`instructions` lines total 1,111,599 bytes against 554,880 of `rendered`, `hook_additional_context`
435,006 against 193,126.

## Where `instructions` sits

The CLAUDE.md files are an `instructions` attachment with `renderedRole: "user"`, written after the
prompt they precede. In this session's own transcript the prompt is record 0 and `instructions`
record 7, while in the context the model was handed the CLAUDE.md text came before the prompt. So the
build places user-role attachments ahead of the turn's prompt when it renders: the 129 KB the issue
counts after the prompt's delivery sits before it in the window. Seen in one session's context, not
traced in the bundle.

## A delivery pushed out by a snapshot, on 2.1.296

This session's own transcript (a subagent): the first delivery ended at offset 267,197; the next
call's hook read at offset 569,042 and delivered again, 301,845 bytes later. Of those, 78,191 were
one `prompt_snapshot`. Without it the distance was 223,654, inside the 262,144-byte window.

## Bytes per context token, counting only what the model reads

`bytesPerToken` as `scripts/measure-echo.mjs` defines it (first to last main-thread assistant turn,
input plus cache tokens), over the 34 main-thread transcripts whose every record is 2.1.292 or later
and whose context grew by 50k tokens or more, from the last 30 days:

| Bytes counted | p10 | median | p90 |
|---|---|---|---|
| every record | 6.75 | 8.70 | 13.10 |
| user, assistant and rendered attachments | 5.69 | 6.57 | 10.79 |

A92's 9.0 was every record. Counting only what the model reads, 256 KiB would be about 40k tokens at the
median and 46k at the p10.

## Tool calls carry timestamps, one call per record

Over 680 transcripts on 2.1.292 or later (14 days): 19,377 `tool_use` blocks and 19,373
`tool_result` blocks, every one in a record with a `timestamp`. Every result pairs with a use and
none is stamped before it. The four uses with no result are calls that never returned. No assistant
record holds more than one `tool_use`, so a call's start is its record's timestamp.

## A parallel batch

Made on purpose in this session: three Bash calls in one message, a 1-second sleep, a 2-second sleep
and an echo.

| Record | Timestamp |
|---|---|
| `tool_use` 1 | 04:51:11.692 |
| `tool_use` 2 | 04:51:12.200 |
| `tool_use` 3 | 04:51:12.583 |
| `tool_result` 3, then its `hook_success` (PostToolUse) | 12.809, 12.809 |
| `tool_result` 1, then its `hook_success` | 12.887, 12.886 |
| `tool_result` 2, then its `hook_success` | 14.386, 14.386 |

Each call is stamped as it streams and runs from there: call 1's result came 1.195 s after its
`tool_use`, for a 1-second sleep. Results land in the order calls finish. Each PostToolUse hook's
record is stamped a millisecond before its own result's and written after it, so a hook reads a
transcript holding neither its own result nor any sibling's hook output that has not landed yet. A
`hook_additional_context` record carries the `toolUseID` of the call whose hook wrote it.

## A call run in the background

267 `run_in_background` Bash calls and 34 Agent calls over 14 days. The `tool_result` comes back 102
to 317 ms after the `tool_use`, carrying `toolUseResult.backgroundTaskId`. The completion is a
`<task-notification>` naming the call in `<tool-use-id>` and carrying `<status>` (completed, failed
or killed), written as:

- a `queue-operation` with `operation: "enqueue"`, when it is queued, and
- a `queued_command` attachment (`origin.kind: "task-notification"` where `origin` is present), or a
  `user` record whose content is the string, when it is handed to the model.

263 of the 267 Bash calls have a later record naming their task. Over 2,624 completions with both,
the notification's record is stamped after the enqueue by a median 11 ms, 74 ms at p90, 15.7 s at
p99 and far longer at worst: it waits for the model's turn. `attachment.timestamp` on the
notification equals the record's own in all 2,347 checked, so it is the hand-over time, not the end.
