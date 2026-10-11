# The echo window in conversation bytes

2026-10-11, Claude Code 2.1.292 to 2.1.296, this machine's transcript store, read-only.

The echo's window counts the bytes of records the model reads after a delivery: `user` and
`assistant` records, and attachments carrying `rendered` other than `instructions`, the CLAUDE.md
files one session's context held at its head, seen there and not traced in the bundle (`windowBytes`
in `plugins/anatomiya/lib/hook.mjs`). A92's 9.0 bytes per token counted every record, so the unit
moved and the ratio was taken again.

## Method

`bytesPerToken` as `scripts/measure-echo.mjs` defines it: transcript bytes between the first and the
last main-thread assistant turn, over the growth in input plus cache tokens across them. Taken over
main-thread transcripts modified in the last 30 days whose every record is 2.1.292 or later and
whose context grew by at least 50k tokens: 34 sessions. Both counts on the same 34.

## Result

| Bytes counted | p10 | median | p90 |
|---|---|---|---|
| every record (A92's unit) | 6.75 | 8.70 | 13.10 |
| what the model reads (the window's unit) | 5.69 | 6.57 | 10.79 |

Leaving `instructions` out as well gives the same figures to two decimals: those records sit before
the first assistant turn the ratio starts from.

`ECHO_WINDOW_BYTES` is 192 KiB (196,608 bytes), which keeps A92's distance in tokens: about 29.9k
tokens at the median, against A92's 29k, and 34.6k at the p10. Left at 256 KiB it would have been
about 40k and 46k.

## A delivery the old count re-sent

One subagent session on 2.1.296: the first delivery ended at offset 267,197, and the hook at offset
569,042 delivered again, 301,845 bytes on. 78,191 of them were one `prompt_snapshot`. The window's
count of the same stretch is under 223,654, so the echo stays silent.

## The replay over the whole store

`node scripts/measure-echo.mjs ~/.claude/projects`, run with the base build (c4fa060), with the
branch's first commit, and with the branch's head. 4,327 transcripts holding 46,351 deliveries
(40,860 repeats of the one before); the head's run, a few minutes later, saw 4,328, 46,370 and
40,870:

| Build | Deliveries the rule keeps | Bytes per token, p10 | median | sessions |
|---|---|---|---|---|
| base, every record counted | 10,028 | 7.23 | 9.23 | 229 |
| records the model reads, 256 KiB (first commit) | 7,878 | 5.82 | 7.16 | 229 |
| records the model reads less `instructions`, 192 KiB (0.15.0) | 9,267 | 5.79 | 7.14 | 229 |

The store holds transcripts from every build since 2.1.233, and builds before 2.1.263 write no
`rendered`, so their attachments count for nothing here. The replay cannot see claims: a parallel
batch's extra copies are only in the live rule.
