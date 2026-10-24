# What a repeated hook context costs: no dedupe, 213k tokens in one session, and the three ways out

Research notes, September 2026. The `echo` verb re-injects the whole repository map as
`additionalContext` on `UserPromptSubmit`, `PostToolUse` and `PostToolUseFailure`, so on every tool
call. `DECISIONS.md` row A24 gives the reason: recency, plus a read timestamp the model can check.
This note asks what that costs and whether the build gives anything back for free: a dedupe, a cache,
a `once` flag, a way to know the text is already in the window.

The short answer is that the build dedupes nothing, and the three cheap levers it does hand over are
the `if` gate on a handler, the `PostToolBatch` event, and a `SessionStart` with `source: "compact"`.

Every claim below carries its source, in the three kinds the companion notes use: **read**, behaviour
read from the installed build, described here rather than quoted; **run**, a captured payload or
a command and its output on this machine today; **doc**, a first-party page quoted with its URL.

The build read and run against is **Claude Code 2.1.280**, the file
`<home>/.local/share/claude/versions/2.1.280`, 217,254,576 bytes. What it does is one build's
behaviour. Every `run` is a headless `claude -p` session against
`claude-haiku-4-5-20251001` under `--permission-mode bypassPermissions`, in a throwaway project
directory under the session scratchpad, with the hooks in that directory's own
`.claude/settings.json` rather than `--settings`.

## Summary

Nothing dedupes. Four byte-identical copies of one `additionalContext` string were delivered in one
short session and the model counted all four. Each copy is its own transcript entry, its own
attachment, and its own `<system-reminder>` block in the request.

The cost is measurable and it is large. One real session in this repository
(`20b342f5-...jsonl`, 4,582 entries) carries **468 repository-map deliveries, 850,824 characters, about
213,000 tokens**. That is one map, delivered 468 times, at roughly 455 tokens a copy.

`once` exists as a handler option and does not apply here. It is in the schema, the docs say it is
"ignored in settings files", and a measured `"once": true` on a `PostToolUse` handler fired three
times out of three.

The levers that do exist: the `if` field filters by permission-rule syntax before the hook process is
spawned at all, and it works (measured: one fire out of three reads); `PostToolBatch` fires once per
batch instead of once per tool and accepts `additionalContext`; and `SessionStart` re-fires after a
compaction with `source: "compact"`, which is the supported way to put the map back after the window
is cut. `PostCompact` cannot do it: it has an input schema and no `hookSpecificOutput` schema at all.

Compaction drops almost everything. At the one boundary measured, **1 of 213** prior map deliveries
was inside the preserved segment. The other 212 were paid for and thrown away.

## 1. No dedupe, and what a delivery looks like in the transcript

**run**. One session, three `Read` calls, one `UserPromptSubmit` hook and one `PostToolUse` hook, both
returning the identical string `ANATOMIYA-MARKER-OTTER: the repository map says src holds 3 files.`
The prompt asked the model to list every marker it was shown and say how many separate times. Its
answer, verbatim:

```
1. **"ANATOMIYA-MARKER-BADGER: session start context."**: 1 time
2. **"ANATOMIYA-MARKER-OTTER: the repository map says src holds 3 files."**: 4 times

The second marker appeared once in the UserPromptSubmit hook before your prompt, and then again
three times in PostToolUse:Read hooks, once after each file read.
```

Four identical copies, four times in the window. There is no collapsing, no "as above", no cache key.

### The transcript entry

**run**, from that session's JSONL. One `additionalContext` is one `attachment` entry:

```json
{
  "parentUuid": "d056f7dc-a327-48d1-8d51-bb5853f42b15",
  "isSidechain": false,
  "attachment": {
    "type": "hook_additional_context",
    "content": ["ANATOMIYA-MARKER-OTTER: the repository map says src holds 3 files."],
    "hookName": "PostToolUse:Read",
    "toolUseID": "toolu_01AXn2g5huGHdbkN2H8Mf2sr",
    "hookEvent": "PostToolUse"
  },
  "type": "attachment",
  "uuid": "274c4bd1-aa24-4b5c-8519-5d8993553efa",
  "timestamp": "2026-09-23T07:02:13.611Z",
  "rendered": [
    { "content": "<system-reminder>\nPostToolUse:Read hook additional context: ANATOMIYA-MARKER-OTTER: the repository map says src holds 3 files.\n</system-reminder>" }
  ],
  "userType": "external",
  "entrypoint": "sdk-cli",
  "cwd": "/private/tmp/.../cap/work",
  "sessionId": "4ce06f36-7982-4f74-aac6-4dcfd4e23c92",
  "version": "2.1.280",
  "gitBranch": "HEAD"
}
```

Five things a reader can use:

- `type` is `attachment`; `attachment.type` is `hook_additional_context`.
- `attachment.content` is an **array**, not a string. Several hooks on one event merge into one
  attachment: the `SessionStart` entry in the same session carried two hooks' texts in one array.
- `attachment.hookName` is `"<Event>:<matcher target>"`, so `PostToolUse:Read`, `UserPromptSubmit`,
  `SessionStart:compact`. That is the field to key a scan on.
- `attachment.toolUseID` is the real `toolu_...` id on a tool event, and a synthetic
  `hook-<uuid>` on `UserPromptSubmit`.
- `rendered[0].content` is the exact text the model sees: the string wrapped in
  `<system-reminder>` with a `<Event>:<tool> hook additional context: ` prefix. That prefix is
  counted against the budget too.

### The bill, on a real session

**run**, `~/.claude/projects/<this repository's project directory>/20b342f5-a6b9-45d1-99fa-d40b62889448.jsonl`,
10,380,040 bytes, 4,582 entries, an ordinary working session in this repository on 2026-09-02:

| measured | value |
|---|---|
| `hook_additional_context` attachments containing `repository-map` | 468 |
| total characters delivered | 850,824 |
| average per delivery | 1,818 characters |
| approximate tokens, at 4 characters per token | ~213,000 |

Counted with a walk of the JSONL, not estimated. The map itself is about 455 tokens; the 500 in the
brief is the right order. What the brief does not say is that the session paid it 468 times.

## 2. `once`, `suppressOutput`, and every other sticky-sounding field

### `once` is real, and does nothing in a settings file

**read**, inside the shared command-handler schema. `once`, `async` and `asyncRewake` are optional
booleans side by side. The schema describes `once` as running the hook a single time and then removing
it, `async` as running it in the background without blocking, and `asyncRewake` as running it in the
background and waking the model when it exits 2, which implies `async`.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), the handler field table:

> `once` | no | If `true`, removes hook after first successful run. Only honored for hooks in skill
> frontmatter; ignored in settings files and agent frontmatter

**run**, the measurement, because "ignored" is worth checking. One project `.claude/settings.json`
with three `PostToolUse` handlers on `"matcher": "*"`, one carrying `"once": true`, one plain, one
carrying an `if`. One session, three `Read` calls:

| handler | fires |
|---|---|
| `"once": true` | 3 |
| plain | 3 |
| `"if": "Read(**/b.txt)"` | 1, and `tool_input.file_path` was `.../src/b.txt` |

`once` changed nothing. A plugin's `hooks.json` is a settings file for this purpose, so it is not a
route this plugin can take.

### `suppressOutput` is about the terminal, not the model

**read**, the common (non-event-specific) hook output schema. Its optional fields include `continue`,
`suppressOutput`, `stopReason`, `decision` (`approve` or `block`), `systemMessage`, `terminalSequence`
(a terminal escape sequence such as a desktop notification) and `reason`.

`suppressOutput` sits beside `terminalSequence` and `systemMessage`, both display-side. Nothing in the schema or
the docs makes it a context field, and nothing anywhere in the output union carries a dedupe key, a
content hash, a TTL, or a "replace my previous context" verb. That was searched for and not found.

### What each event's output actually allows

**read**, the whole `hookSpecificOutput` union. For the events this plugin touches, every field is
optional apart from `hookEventName`:

| `hookEventName` | fields |
|---|---|
| `UserPromptSubmit` | `additionalContext`, `sessionTitle`, `suppressOriginalPrompt` |
| `SessionStart` | `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills` |
| `PostToolUse` | `additionalContext`, `classifierContext`, `updatedToolOutput`, `updatedMCPToolOutput` |
| `PostToolUseFailure` | `additionalContext` |
| `PostToolBatch` | `additionalContext` |
| `Stop` | `additionalContext` |
| `SubagentStop` | `additionalContext` |

and there is **no `PostCompact` entry in that union at all**. A search for an output entry keyed on
`PostCompact` found none. The only place the build pins an event name to `PostCompact` is the *input*
schema. So `PostCompact` reads a payload and cannot answer with context.

Two of these are worth naming for later work. `PostToolUse.updatedToolOutput` replaces the tool output
before the model sees it (**read**, same block), which is a way to fold a claim into the result rather
than add a block beside it. And `SessionStart.reloadSkills`, which re-scans the skill and command
directories once the `SessionStart` hooks finish.

### `PostToolBatch`: one delivery per batch instead of per tool

**read**, the input schema. It extends the common base with `hook_event_name` set to `PostToolBatch`
and a `tool_calls` array. Its own description says the event fires once after every call in a batch has
resolved and before the next model request, and contrasts it with `PostToolUse`, which fires per tool
and may run concurrently for parallel calls.

Each entry in `tool_calls` carries `tool_name`, `tool_input`, `tool_use_id` and an optional
`tool_response`, so the batch payload names every call in it. Read, not run: no `PostToolBatch` payload was captured here.

## 3. Every field on every payload this plugin sees, on 2.1.280

**read**, the common base that every hook input extends. `session_id`, `transcript_path` and `cwd` are
always there. The rest are optional, and the build's field descriptions say this about them:

- `prompt_id` ties a user prompt to every event that follows until the next prompt, and is absent
  until the process sees its first user input.
- `permission_mode` has no description.
- `agent_id` is present only when the hook fires inside a subagent, absent on the main thread even in
  an `--agent` session, and is the field to use, not `agent_type`, to tell subagent calls from
  main-thread calls.
- `agent_type` is present inside a subagent, beside `agent_id`, and also on the main thread of a
  session started with `--agent`, without `agent_id`.
- `effort` is an object with a `level`. It is present for hooks that fire in a tool-use context
  (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop` and others) on a model that takes the effort
  parameter, and absent on session-lifecycle hooks and on models without effort support.

and the per-event additions (**read**), with `?` marking an optional field:

| event | adds |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `mcp_server?` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms?`, `mcp_server?` |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt?`, `duration_ms?`, `mcp_server?` |
| `SessionStart` | `source` (`startup`, `resume`, `clear`, `compact` or `fork`), `agent_type?`, `model?`, `session_title?`, `seconds_since_last_response?`, `context_tokens?` |
| `PreCompact` | `trigger` (`manual` or `auto`), `custom_instructions` (nullable) |
| `PostCompact` | `trigger` (`manual` or `auto`), `compact_summary` |

The build describes `duration_ms` as the tool's run time in milliseconds, not counting permission
prompts or hooks.

### Captured, so the optional fields are settled

**run**, four payloads from this machine today.

`PostToolUse`, main thread, haiku. Note what is **absent**: no `effort` (haiku takes no effort
parameter), no `agent_id`, no `agent_type`, no `mcp_server`:

```json
{ "session_id": "4ce06f36-7982-4f74-aac6-4dcfd4e23c92",
  "transcript_path": "<home>/.claude/projects/-private-tmp-…-cap-work/4ce06f36-….jsonl",
  "cwd": "/private/tmp/…/cap/work", "prompt_id": "ac17d39e-78b3-4d3c-93c9-9df2fba10bbb",
  "permission_mode": "bypassPermissions", "hook_event_name": "PostToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "/private/tmp/…/cap/work/src/a.txt" },
  "tool_use_id": "toolu_01AXn2g5huGHdbkN2H8Mf2sr", "duration_ms": 1 }
```

`PostToolUse`, the same session's `Bash` call *inside* an `Explore` subagent, keys listed in full:

```
['agent_id', 'agent_type', 'cwd', 'duration_ms', 'effort', 'hook_event_name', 'permission_mode',
 'prompt_id', 'session_id', 'tool_input', 'tool_name', 'tool_use_id', 'transcript_path']
agent_id = "a2a5e51b650fabbcb"   agent_type = "Explore"   effort = {"level": "medium"}
```

and the `Agent` tool call that spawned it, on the main thread, in the same file:

```
['cwd', 'duration_ms', 'hook_event_name', 'permission_mode', 'prompt_id', 'session_id',
 'tool_input', 'tool_name', 'tool_use_id', 'transcript_path']
agent_id = None   agent_type = None   effort = None
```

**So yes: a `PostToolUse` hook can tell it runs inside a subagent.** `agent_id` present means
subagent, absent means main thread, and the build's own field description says to key on that field
and not on `agent_type`, because `agent_type` is also set on the main thread of an `--agent` session.
`session_id` and `transcript_path` stay the parent's in both, so neither distinguishes anything.

`SessionStart`. Five fields and no more; no `prompt_id`, no `permission_mode`, no `effort`:

```json
{ "session_id": "4ce06f36-…", "transcript_path": "<home>/.claude/projects/…/4ce06f36-….jsonl",
  "cwd": "/private/tmp/…/cap/work", "hook_event_name": "SessionStart", "source": "startup" }
```

`Stop`, with two fields worth having:

```json
{ "session_id": "4ce06f36-…", "transcript_path": "…", "cwd": "/private/tmp/…/cap/work",
  "prompt_id": "ac17d39e-…", "permission_mode": "bypassPermissions",
  "hook_event_name": "Stop", "stop_hook_active": false,
  "last_assistant_message": "Here are all the extra context notes or marker strings I was shown:\n\n1. …",
  "background_tasks": [], "session_crons": [] }
```

`SubagentStop` adds `agent_id`, `agent_transcript_path`, `agent_type`, and carries `effort`:

```json
{ "session_id": "99ad39b9-…", "transcript_path": "…", "cwd": "…", "prompt_id": "85ee5e1f-…",
  "permission_mode": "bypassPermissions", "agent_id": "a2a5e51b650fabbcb", "agent_type": "Explore",
  "effort": {"level": "medium"}, "hook_event_name": "SubagentStop", "stop_hook_active": false,
  "agent_transcript_path": "…" }
```

**read**, the builder that makes both. It confirms the field set, and that `last_assistant_message`
is the last assistant message's text content, joined with newlines and trimmed, rather than a whole
message object. Both events get the common base, `stop_hook_active`, `last_assistant_message`,
`background_tasks` and `session_crons`. `SubagentStop` adds `agent_id`, `agent_transcript_path` and
`agent_type`.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), on why that field is there and the
transcript is not the answer:

> The transcript file is written asynchronously and may lag the in-memory conversation, so it may not
> yet include the current turn's most recent messages when a hook fires. Hooks that need the final
> assistant text of the current turn should use `last_assistant_message` on Stop and SubagentStop
> instead of reading the transcript

That matters directly to `reuse.mjs`, which reads its own marks back out of the transcript tail.

### The Stop block cap

**read**, the stop-hook loop. It reads the cap from `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, falling back to
8, and once the count of consecutive blocks passes the cap it ends the turn with a warning to the user.
The warning names the count, tells Stop and SubagentStop hooks to check `stop_hook_active` and return
success while it is true, and names the env var that raises the limit.

**Default 8.** Set it to `0` and the cap is off entirely, since the check only applies when the cap is
above 0. The counter is consecutive blocks within a turn; the warning is the one the user sees. The env var
appears in no first-party documentation found.

## 4. Knowing the map is already in the window

There is no build-side flag for it. There are two records in the transcript that answer it, and both
are cheap to read from the tail.

### The delivery marker is the attachment itself

Every delivery is an `attachment` entry with `attachment.type === "hook_additional_context"` and
`attachment.hookName` naming the event. A hook that wants to know whether it already delivered can
scan the tail for its own text (or its own sentinel, the way `reuse.mjs` already scans for
`anatomiya reuse check`), plus a `timestamp` and the `uuid`.

### The compaction boundary

**run**, a real boundary from `20b342f5-...jsonl`, entry 2,104 of 4,582:

```json
{ "parentUuid": null, "logicalParentUuid": "e0387d28-cb57-4063-8b8e-a42b605f86e3",
  "isSidechain": false, "type": "system", "subtype": "compact_boundary",
  "content": "Conversation compacted", "level": "info",
  "compactMetadata": {
    "trigger": "auto", "preTokens": 1001122, "postTokens": 34649,
    "cumulativeDroppedTokens": 966473, "durationMs": 111899,
    "preservedSegment": { "headUuid": "78986ed9-…", "anchorUuid": "98995c23-…",
                          "tailUuid": "e0387d28-…" },
    "preservedMessages": { "anchorUuid": "98995c23-…",
      "uuids": [ 9 uuids ], "allUuids": [ 12 uuids ] } },
  "uuid": "00d829a2-f162-4692-851c-ad62d5a85ab6",
  "timestamp": "2026-09-02T02:16:20.715Z", "userType": "external", "entrypoint": "cli",
  "cwd": "<checkout>" }
```

So `type: "system"`, `subtype: "compact_boundary"`, and `compactMetadata.preservedMessages.allUuids`
is the exact list of entries that survived. A hook comparing its last delivery's `uuid` against that
list gets a yes-or-no answer with no guessing.

Measured on that boundary: of the **213** map deliveries before it, **1** was preserved (the one at
entry 2,094, ten entries back). 212 deliveries were paid for and dropped. 966,473 tokens went with
them.

### After a compaction, `SessionStart` fires again

**run**, the same file, the entries right after the boundary at 2,104:

```
2105 user
2106 attachment  file
2107 attachment  file
2108 attachment  compact_file_reference
2111 attachment  invoked_skills
2112 attachment  deferred_tools_delta
2115 attachment  hook_success            hookName "SessionStart:compact"
2116 attachment  hook_success            hookName "SessionStart:compact"
2117 attachment  hook_additional_context hookName "SessionStart"
```

That is the whole answer to "does SessionStart context reach the model after compaction". It does:
the event re-fires with `source: "compact"`, and its `additionalContext` lands on the far side of the
boundary, where the model reads it.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks): the `SessionStart` matcher "filters
on how the session started: `"startup"`, `"resume"`, `"clear"`, `"compact"`, `"fork"`", which matches
the build's enum exactly. So `{"matcher": "compact", ...}` is a supported, documented way to register
a handler that runs only after a compaction.

### Reading the tail is bounded, and this repository already does it

**run**, the transcripts in this project directory: largest 12,471,978 bytes, second 10,380,040, with
an average line of 2,265 bytes and a single longest line of 121,454. `~/.claude/projects` holds 7.0 GB
in total. So a whole-file parse is not free, and a tail read is.

`readTail(path, bytes)` in `plugins/anatomiya/lib/rules.mjs` already does the bounded read: `open`,
`fstat`, `read` the last `min(bytes, size)` bytes, close, and return `null` on any error.
`reuse.mjs` uses it at 64 MB, which for these files is the whole file; a marker scan wants far less.
Two deliveries plus a boundary sit within a few hundred kilobytes on any session measured here.

One caveat the docs state and this note repeats: the transcript is written asynchronously and lags the
in-memory conversation, so the last entry or two may be missing when a hook fires.

### `PreCompact` and `PostCompact`

**read**, the two runners:

- `PreCompact` input `{trigger, custom_instructions}`. Its **stdout is used**: the successful,
  non-blocking hooks' trimmed output is joined and returned as `newCustomInstructions`, which becomes
  the compaction's instructions. A `PreCompact` hook can also block, and the runner collects
  `blockedBy`.
- `PostCompact` input `{trigger, compact_summary}`, where `compact_summary` is the summary the
  compaction produced. Its runner returns only `userDisplayMessage`. There is no
  `PostCompact` entry in the `hookSpecificOutput` union, so it cannot return `additionalContext`.

The post-compaction injection route is `SessionStart` with `source: "compact"`, not `PostCompact`.

## 5. The `if` gate

**read**. `if` is an optional string field of the shared command-handler schema, beside `timeout` and
`once`. The build describes it as a permission rule that the tool call has to match for the hook to
run, so that no hook process is spawned for a call that does not match.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), the handler table:

> `if` | no | Permission rule syntax to filter when hook runs (e.g., `"Bash(git *)"`, `"Edit(*.ts)"`)
> - tool events only

**run**, measured above: `"if": "Read(**/b.txt)"` on a `"matcher": "*"` handler fired once across
three `Read` calls, on the matching file only. Not spawning the hook is the load-bearing part: this is
cheaper than a hook that starts, decides it has nothing to say, and exits.

## What is a documented contract

On [https://code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks): the `SessionStart`
source values including `fork`, and that the matcher filters on them; that `PreCompact` and
`PostCompact` exist and take `manual` / `auto`; the handler fields `if`, `timeout`, `statusMessage`
and `once`, with `once` explicitly "ignored in settings files"; `last_assistant_message` on Stop and
SubagentStop, and the reason (the transcript lags); `agent_id` present only inside a subagent and
`agent_type` also on an `--agent` main thread.

## What is one build's behaviour

That no dedupe exists on `additionalContext`, and the measured count of four copies. The
`hook_additional_context` attachment shape, that `content` is an array, and the `<system-reminder>`
wrapper text in `rendered`. That `once` in a settings file is silently ignored rather than rejected.
That `PostCompact` has no output schema. The `compact_boundary` entry shape and `compactMetadata`.
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` and its default of 8, and that 0 disables the cap. That `Stop`
carries `background_tasks` and `session_crons`. That `PostToolUse` omits `effort` on a model with no
effort parameter.

## What could not be established

- **The token cost as the API counts it.** Every token figure here is characters divided by four. No
  `count_tokens` call was made and no per-request accounting was read.
- **Prompt-cache interaction.** Each new delivery appends to the conversation, so earlier ones should
  be cache reads rather than cache writes on later requests. Not measured. The cumulative input
  figure is real either way; whether it is billed at the write rate or the read rate is not
  established here.
- **`PostToolBatch` on the wire.** Read out of the input and output schemas, never fired in a capture.
  Whether it fires for a single-call "batch", and whether its `additionalContext` lands as one
  attachment, is unmeasured.
- **A compaction run end to end.** The boundary and the post-boundary `SessionStart:compact` come
  from a real session's transcript, not from a capture made for this note. `PreCompact` and
  `PostCompact` payloads were never caught on the wire: both hooks were registered and neither fired,
  because no capture session came near the window.
- **`SessionStart` `source` values `resume`, `clear` and `fork`.** In the enum and in the docs;
  only `startup` and (from the older transcript) `compact` were seen.
- **`updatedToolOutput`.** In the `PostToolUse` output schema, untested.
- **Whether the `if` gate accepts every tool's rule syntax.** One pattern was measured,
  `Read(**/b.txt)`. `Bash(git *)` and `Edit(*.ts)` come from the docs.
- **Windows.** Every run was macOS.

## Reproducing this

```sh
S=/private/tmp/capctx
mkdir -p $S/out $S/work/.claude $S/work/src
printf 'alpha\n' > $S/work/src/a.txt; printf 'beta\n' > $S/work/src/b.txt; printf 'gamma\n' > $S/work/src/c.txt
cat > $S/hook.mjs <<'EOF'
import { appendFileSync } from "node:fs";
let d = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { d += c; });
process.stdin.on("end", () => {
  appendFileSync(process.argv[2], d.trim() + "\n");
  const ev = (() => { try { return JSON.parse(d).hook_event_name; } catch { return "?"; } })();
  const ctx = process.argv[3];
  if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: ctx } }));
  else process.stdout.write("{}");
});
EOF
cat > $S/work/.claude/settings.json <<EOF
{"hooks":{"PostToolUse":[
 {"matcher":"*","hooks":[{"type":"command","command":"node $S/hook.mjs $S/out/once.jsonl 'ONCE-MARKER-QUOLL'","timeout":20,"once":true}]},
 {"matcher":"*","hooks":[{"type":"command","command":"node $S/hook.mjs $S/out/every.jsonl 'EVERY-MARKER-DINGO'","timeout":20}]},
 {"matcher":"*","hooks":[{"type":"command","command":"node $S/hook.mjs $S/out/if.jsonl 'IF-MARKER-TAPIR'","timeout":20,"if":"Read(**/b.txt)"}]}]}}
EOF
cd $S/work && claude --model claude-haiku-4-5-20251001 --permission-mode bypassPermissions \
  --strict-mcp-config -p 'Read src/a.txt, then src/b.txt, then src/c.txt, one Read call each. Then stop.' \
  --output-format json < /dev/null
wc -l $S/out/*.jsonl
```

Put the hooks in the project directory's own `.claude/settings.json`. A `--settings` file may be
refused by a session hold; the project file is not.

To count what a session spent, walk its JSONL for `type === "attachment"` and
`attachment.type === "hook_additional_context"` and sum `"".join(attachment.content)`. To find the
boundary, look for `subtype === "compact_boundary"` and read
`compactMetadata.preservedMessages.allUuids`.

The build reads use `LC_ALL=C grep -a -b -o -F '<literal>'` to find a known string, then
`tail -c +$((offset-N)) | head -c M` to read a window around it. The file is 217 MB and a wide context pattern is refused by the
stock macOS `grep`. `scripts/claude-build.mjs` holds this repository's build reader.

## Sources

First-party documentation:

- [Anthropic, Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

The installed build, `<home>/.local/share/claude/versions/2.1.280`, 217,254,576 bytes. Sites read,
described above rather than quoted: the common input schema; the per-event input schemas, including
`PostToolBatch`; the `hookSpecificOutput` union and the common output schema; the command-handler
schema with its `if` and `once` fields; the `PreCompact`, `PostCompact` and `SessionStart` runners; the
`Stop` / `SubagentStop` input builder; the stop-hook block cap.

This repository:

- `docs/research/what-a-hook-payload-carries.md` and `docs/research/what-a-pretooluse-hook-can-do.md`
  (the method, and the payload work on 2.1.251 and 2.1.250),
  `docs/research/one-line-that-finds-the-existing-function.md` (the reuse wording this note leaves
  alone), `plugins/anatomiya/hooks/hooks.json`, `plugins/anatomiya/lib/hook.mjs` (`echoContext`),
  `plugins/anatomiya/lib/hook-verbs.mjs` (`runEcho`), `plugins/anatomiya/lib/reuse.mjs`
  (`REUSE_MARK`, `askedMarks`), `plugins/anatomiya/lib/rules.mjs` (`readTail`),
  `DECISIONS.md` row A24.

## What this means for the echo

A24's reason survives: the model does forget, and a re-read timestamp is worth something. What does
not survive is the delivery rate. 468 copies of one 455-token document in one session is not recency,
it is a document pasted into the conversation 468 times, and 212 of the 213 before the last compaction
were dropped unread.

The evidence supports four changes, in the order they pay.

**1. Stop delivering on every tool call. Deliver on a change, or on a schedule.** Nothing in the build
dedupes, so the only dedupe there will ever be is the plugin's own. The hook already knows the map's
content; a hash of the body plus the last delivery found in the transcript tail is enough to answer
"is this map, unchanged, already in this window". Say nothing when the answer is yes. With the
`hook_additional_context` shape now known, that scan is a tail read and a substring test, and
`readTail` is already in the repository doing exactly this job for `reuse.mjs`.

**2. Re-deliver on `SessionStart` with `matcher: "compact"`.** This is the one moment where recency is
genuinely lost, and it is measured: 212 of 213 deliveries went over the boundary, and the build
re-fires `SessionStart` on the far side with `source: "compact"` and puts its `additionalContext`
where the model reads it. One delivery per compaction, in place of hundreds per session. `matcher`
takes `"startup"`, `"resume"`, `"clear"`, `"compact"` and `"fork"`, so `startup|compact|clear` is one
handler covering every window that begins empty. Do not reach for `PostCompact`: it has no output
schema and cannot deliver anything.

**3. Put an `if` on the `PostToolUse` handler for whatever delivery survives.** `if` filters before the
process is spawned, which is cheaper than a hook that wakes up to say nothing. The natural gate is the
write tools, where a stale map actually costs something:
`"if": "Edit(**)"` or per-tool handlers. Measured working, one fire in three.

**4. Consider `PostToolBatch` instead of `PostToolUse`.** It fires exactly once per batch rather than
once per tool, and it accepts `additionalContext`. On a turn with five parallel reads that is one
delivery rather than five, for no behaviour change. Read out of the schema, not yet measured: fire it
once before building on it.

Two smaller things this note settles for the code as it stands.

`reuse.mjs` reads its marks out of the transcript tail, and the docs say the transcript lags the
in-memory conversation. On `Stop` the current turn's last assistant message may not be on disk yet.
`last_assistant_message` is in the payload, measured, and is the field the build itself points at for
this. Where a mark can be written into the assistant's own text, read it from there rather than from
the file.

And a hook can now tell a subagent from the main thread: `agent_id` present means subagent, and the
build's own field description says to key on that and not on `agent_type`. If the map should not be
re-injected into every `Explore` worker's window, that is the one-line test.

## What was built

The first change, as DECISIONS row A92. The echo reads the last 256 KiB of the window's transcript and
stays silent while it holds a delivery of the same map with no `compact_boundary` after it; the map
carries a `digest` of its body, so a re-scan is delivered on the next call; a subagent is answered from
`<session>/subagents/agent-<agent_id>.jsonl`. Live on 2.1.280 the same task went from 9 main and 2
subagent deliveries to 2 and 1.

The other three were not needed for that result. After a compaction the next call finds the boundary
and delivers, and the overview file itself comes back at the boundary, so a `SessionStart` handler would
add a third copy. An `if` gate on the write tools would take recency off every read. `PostToolBatch` is
still unmeasured on the wire, and a live batch of three reads brought no extra copy under A92.
