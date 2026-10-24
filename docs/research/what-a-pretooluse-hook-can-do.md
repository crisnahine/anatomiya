# What a PreToolUse hook can do: the payload, the verdict, and what happens when it breaks

Research notes, August 2026. Issues #119 and #120 both propose the same new surface: a `PreToolUse`
matcher on `Write|Edit|NotebookEdit` that says what a directory already holds, and passes a verdict,
at the moment a path is chosen. Before any of that is built, this note establishes what the installed
build actually gives a hook on that event and what it does with what the hook prints back.

Every claim below carries its source. Three kinds appear:

- **read**: behaviour read from the installed Claude Code build, described here rather than quoted
- **run**: a command and its output on this machine, today
- **doc**: a first-party page, quoted, with its URL

The build read and run against is **Claude Code 2.1.250**, the file
`~/.local/share/claude/versions/2.1.250`, 206,479,552 bytes. What it does is one build's behaviour, not
another's. Every `run` below is a headless `claude -p` session with a
throwaway `--settings` file, in a temp directory, against `claude-opus-5` at `--effort low`.

## Summary

A `PreToolUse` hook can do everything issues #119 and #120 need, and one thing they did not ask for.

It receives the target path. Write and Edit put it in `tool_input.file_path`; NotebookEdit puts it in
`tool_input.notebook_path`. There is no single key.

It can add text the model reads, through the same `hookSpecificOutput.additionalContext` the plugin
already uses on `UserPromptSubmit`. The text lands as a `hook_additional_context` attachment placed
after the tool call and before the tool result, so the model reads it on its next turn, alongside the
result of the write it just did. Context alone does not stop a write. It informs what comes next.

To stop a write, the hook returns `permissionDecision`. `deny` blocks it and hands the model the
reason as the tool error. `ask` sends it through the permission pipeline. Both were measured. A hook
can also return `updatedInput` and rewrite the path out from under the model, which works and is
worth naming as a hazard rather than a feature.

On failure the build is generous in exactly the direction this plugin's rule wants. A hook that
crashes, times out, or prints junk lets the write through and says nothing. Only exit code 2, and only
an explicit `deny` or `ask`, stop anything. The one way to break a run by accident is to exit 2.

The matcher `"Write|Edit|NotebookEdit"` is not a regex on this build. It matches a fast path that
splits on `|` and compares exact strings, case sensitive. A matcher of `"write"` never fires.

## 1. The payload

### Three captured payloads, verbatim

**run**. A `PreToolUse` hook registered on `Write|Edit|NotebookEdit` whose command is
`sh -c 'cat > <file>'`, then one headless session per tool. Nothing is redacted; there is no
credential in any of them.

Write:

```json
{
  "session_id": "a8371397-866e-4cfc-864c-d4d61197826c",
  "transcript_path": "<home>/.claude/projects/-private-tmp-pretooluse-cap-work/a8371397-866e-4cfc-864c-d4d61197826c.jsonl",
  "cwd": "/private/tmp/pretooluse-cap/work",
  "prompt_id": "e0545205-67d0-4640-8110-dda2d36abf39",
  "permission_mode": "default",
  "effort": { "level": "low" },
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/private/tmp/pretooluse-cap/work/hello.txt",
    "content": "hi\n"
  },
  "tool_use_id": "toolu_01CRWo3rsZWwEkcQ7c5Mv2PJ"
}
```

Edit:

```json
{
  "session_id": "3d95b296-d1b0-4c53-8220-7283993661ee",
  "transcript_path": "<home>/.claude/projects/-private-tmp-pretooluse-cap-work/3d95b296-d1b0-4c53-8220-7283993661ee.jsonl",
  "cwd": "/private/tmp/pretooluse-cap/work",
  "prompt_id": "4b511057-21ff-48fc-809f-bb744ec86843",
  "permission_mode": "default",
  "effort": { "level": "low" },
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/private/tmp/pretooluse-cap/work/edit-me.txt",
    "old_string": "alpha beta gamma",
    "new_string": "alpha delta gamma",
    "replace_all": false
  },
  "tool_use_id": "toolu_01CLhdDzzgRv2GoxeH1i2GYp"
}
```

NotebookEdit:

```json
{
  "session_id": "13100479-08dc-44e9-b188-6149560db818",
  "transcript_path": "<home>/.claude/projects/-private-tmp-pretooluse-cap-work/13100479-08dc-44e9-b188-6149560db818.jsonl",
  "cwd": "/private/tmp/pretooluse-cap/work",
  "prompt_id": "84533ce4-14fb-4562-a9da-c85cf66da22c",
  "permission_mode": "default",
  "effort": { "level": "low" },
  "hook_event_name": "PreToolUse",
  "tool_name": "NotebookEdit",
  "tool_input": {
    "notebook_path": "/tmp/pretooluse-cap/work/note.ipynb",
    "cell_id": "c1",
    "new_source": "print('new')"
  },
  "tool_use_id": "toolu_01NEsW2b8GN8hCVJuypVgpJz"
}
```

### The path key is per tool, and the path is not normalised

Write and Edit carry `tool_input.file_path`. NotebookEdit carries `tool_input.notebook_path`. Any
reader that assumes one key reads nothing for the other tool.

The NotebookEdit capture is worth a second look. `cwd` is `/private/tmp/pretooluse-cap/work` and
`notebook_path` is `/tmp/pretooluse-cap/work/note.ipynb`. On macOS `/tmp` is a link to `/private/tmp`,
so those are the same file, spelled two ways. The build hands the hook the string the model wrote, not
a resolved path. A hook that compares the path against a repository root has to resolve it itself.

Every path captured here was absolute, and the Write tool's own schema asks for an absolute path
(**read**). Nothing in the hook payload guarantees it. Treat
a relative path as possible and resolve against `cwd`.

### Where the common fields come from

**read**. One function builds the base of every hook payload: the session id, the transcript path, the
working directory, the prompt id, the permission mode, the agent id and type when there is an agent,
and the effort. The PreToolUse caller spreads that base and adds the event name, the tool name, the
tool input and the tool use id.

So the field set is fixed: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`agent_id`, `agent_type`, `effort`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`.
`agent_id` and `agent_type` were absent from all three captures because these ran in a main loop; the
docs say they appear "only in subagents" and "only with `--agent` or in subagents" (**doc**,
[Hooks reference](https://code.claude.com/docs/en/hooks)).

`permission_mode` takes `default|plan|acceptEdits|auto|dontAsk|bypassPermissions` (**doc**, same page).

## 2. Adding context the model reads

### `additionalContext` is supported on PreToolUse, with the same shape

**read**. The build's output schema for the event takes `hookEventName` set to `PreToolUse`, and four
optional fields: `permissionDecision` from the decision enum, `permissionDecisionReason` and
`additionalContext` as strings, and `updatedInput` as an object.

**run**. A hook whose whole stdout is one line:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"anatomiya says: the magic word for this session is ZEBRA42. Repeat it in your final answer."}}
```

Prompt: "Create a file note.txt ... Then, in your final answer, state the magic word if anything told
you one, otherwise say NO-MAGIC-WORD." The model answered:

```
Nahimo na ang `note.txt` sa `/private/tmp/pt2/w-ctx2/`, sulod ang "hi".

Magic word: ZEBRA42
```

The text reaches the model. It is delivered as its own attachment, not folded into the tool result.

### When the model reads it: after the write, in the next turn

**run**, the transcript of that session, entries in file order:

```
[13] TOOL_USE Write {"file_path": "/private/tmp/pt2/w-ctx2/note.txt", "content": "hi\n"}
[14] hook_success        {"hookName":"PreToolUse:Write","content":"","stdout":"{...}","exitCode":0,"durationMs":540}
[15] hook_additional_context {"content":["anatomiya says: the magic word ... ZEBRA42 ..."],
                              "hookName":"PreToolUse:Write","hookEvent":"PreToolUse"}
[16] TOOL_RESULT        "File created successfully at: /private/tmp/pt2/w-ctx2/note.txt ..."
[20] TEXT               "... Magic word: ZEBRA42"
```

The hook runs before the write. The text it returns is placed after the tool call and before the tool
result, and the model reads the whole batch on its next turn. So the claim is written down before the
file exists and read after it exists.

That is the load-bearing nuance for issue #119. Moving the delivery from `PostToolUse` to `PreToolUse`
does not make the model read a claim before it picks a path. It changes what the claim is about, from
"whatever the map says" to "this directory, this file", and it makes the claim arrive attached to the
write rather than in a banner. To stop a write before it happens, the hook has to decide, not narrate.

### Plain stdout does not reach the model on this event

**run**. Same test, hook prints one plain line and exits 0:

```
anatomiya says: the magic word for this session is QUOKKA77. Repeat it in your final answer.
```

The model answered `NO-MAGIC-WORD`. The transcript holds the text as a `hook_success` attachment with
`content` set to the stdout, so it is recorded, and the model did not report it when asked to report
every hook text it was shown.

The build's own `/hooks` menu text agrees (**read**, the PreToolUse entry). It says the command gets
the tool call's arguments as JSON, that at exit 0 neither stdout nor stderr is shown, that exit 2 shows
stderr to the model and blocks the call, and that any other exit code shows stderr to the user only and
lets the call go ahead.

Compare `UserPromptSubmit`, three entries further on in the same table, where the entry says stdout at
exit 0 is shown to the model. The plugin's existing echo hook can get away with plain stdout on that event. A PreToolUse
hook cannot. It has to return JSON.

### Stdout must be JSON and nothing else

This one cost a run. The first attempt printed a plain line, then the JSON, and the model answered
`NO-MAGIC-WORD` even though the JSON was right there in the stdout the transcript recorded.

**read**, the stdout parser. It trims the output, then treats it as plain text, with only a debug log
line, if it does not start with `{`, if it does not end with `}`, or if it holds more than one JSON
document.

Three ways to lose the whole payload without an error: print anything before the `{`, truncate the
JSON, or print more than one JSON document. Each is a silent downgrade to plain text, and plain text
on this event goes nowhere.

## 3. Blocking and asking

### The four values, three of them documented

**read**. The enum the schema uses has four values: `allow`, `deny`, `ask` and `defer`.

The docs list three (**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), the PreToolUse
Decision Control section):

> The `permissionDecision` field accepts these values:
> * `"allow"`: permits the tool call to proceed
> * `"deny"`: blocks the tool call
> * `"ask"`: prompts the user for permission

`defer` is in the build's enum, and the function that maps hook JSON to a decision has a case for it
that sets the permission behaviour to `defer` (**read**). It appears in no documentation found. Do not use it.

### What each one did, measured

**run**, one headless session per decision, prompt: "Create a file note.txt in the current directory
containing the word hi. Report in English: whether it was created and at what exact path, and verbatim
every reason, hook text or extra context you were shown. Do not retry more than once."

| Hook returns | File created | What the model got | `toolDenialKind` |
|---|---|---|---|
| `deny` with reason | no | tool result, `is_error: true`, content is the reason verbatim | `permission-rule` |
| `ask` with reason | no | tool result, `is_error: true`, content is the reason verbatim | `user-rejected` |
| `allow` with `updatedInput` | yes, at the rewritten path | normal success result naming the rewritten path | none |
| exit 2 with stderr | no | tool result, `is_error: true`, `PreToolUse:Write hook error: [<command>]: <stderr>` | `permission-rule` |
| exit 1 with stderr | yes | nothing | none |

The deny reason arrives word for word. The model's answer to the deny run:

```
Dili nako mahimo. Gi-block ang Write sa `/private/tmp/pt2/w-deny/note.txt`, ug ang exact nga rason nga gihatag:

"DENY-REASON-NARWHAL: this directory has no precedent for that file."
```

`ask` was run headless, where there is no user to answer the prompt, and it came back as a rejection
with `toolDenialKind: "user-rejected"`. The interactive prompt was not tested. In a headless run, `ask`
is `deny` with a different label.

### `deny` and `additionalContext` both arrive, and they are separate

This is the shape issues #119 and #120 want, so it was measured on its own. **run**, one hook returning
both:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"DENY-REASON-NARWHAL: no precedent here.","additionalContext":"EXTRA-CONTEXT-IBEX: src/pages holds 1003 files and 2 test files."}}
```

Transcript:

```
[14] TOOL_USE Write {"file_path": "/private/tmp/pt2/w-denyctx/note.txt", ...}
[15] hook_additional_context {"content":["EXTRA-CONTEXT-IBEX: src/pages holds 1003 files and 2 test files."]}
[16] TOOL_RESULT is_error=True: "DENY-REASON-NARWHAL: no precedent here."   toolDenialKind=permission-rule
```

and the model reported both, under separate headings, and noticed that the counted fact was about a
directory unrelated to the file it had been blocked from writing. A verdict and its evidence can travel
together. They have to agree with each other, because the model reads them side by side.

### Where a reason surfaces

To the model, in the tool result. Both `deny` and `ask` were reported back verbatim by the model in
runs that asked it to quote everything it saw. It also lands in the transcript, which is where a user
looking at the session sees it. **read**, the mapper: on `deny` it sets the behaviour to deny and builds
the blocking error from `permissionDecisionReason`, then the top-level `reason`, then a fixed fallback. So the reason is the block message, and the fallback when it is missing is the literal string
`Blocked by hook`.

### An allow is not the last word

**read**, the function that takes the hook's decision into the permission pipeline. A hook `deny`
returns at once. A hook `allow` or `ask` is then checked against the configured rules: a matching deny
rule overrides it, a matching ask rule or safety check sends it through the full permission pipeline,
and an `allow` from a host that requires `canUseTool` still goes to `canUseTool`.

A hook's `allow` is a vote, and a deny rule, an ask rule, or a host that requires `canUseTool` all beat
it. A hook's `deny` is final.

### `updatedInput` works, and is a hazard

**run**. A hook that returns `permissionDecision: "allow"` plus
`updatedInput: {"file_path": ".../moved.txt", "content": "rewritten by hook\n"}` against a model call
that asked to write `note.txt` with `hi`. The file written was `moved.txt` with the hook's content. The
model's own report:

```
**Was `note.txt` created?** No. It does not exist.
**What exists instead:** `/private/tmp/pt2/w-rewrite/moved.txt`, 18 bytes, containing `rewritten by hook`...
Note the mismatch: I passed `note.txt`, the result claims `moved.txt`, and it claims success while
telling me not to verify. Both the path and the content were changed out from under t...
```

The rewrite is honoured with `allow` or `ask`, or on its own with no decision (**read**: the hook runner
keeps `updatedInput` when the behaviour is `allow` or `ask`, and passes it on by itself when there is no
behaviour at all). It is not honoured alongside `deny`, which needs no input.

Silently relocating a file the model asked to write leaves the model holding a false belief about its
own work. If this repository ever wants relocation, say so in `additionalContext` and let the model do
it, rather than doing it behind the model's back.

## 4. Cost and failure

### Once per tool call

**run**. A hook that appends one line to a log, one session that wrote three files. Three lines. Three
files. The docs put the same thing in words: it fires "on every tool call inside the agentic loop",
except `EndConversation` (**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks)).

Sibling hooks on the same event run at the same time: "All matching hooks run in parallel. If you
define the same handler in more than one settings file, it runs once. A plugin's or skill's copy of the
same handler stays separate." (**doc**, same page.)

### The timeout field is seconds, and the default is 600

**read**, inside the spawn function: a set `timeout` is multiplied by 1000, and an absent one falls back
to a default of 600,000 milliseconds. So an absent `timeout` means ten minutes.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), the handler field table:

> `timeout` | no | Seconds before canceling. Claude Code doesn't enforce it on a command hook you run
> with `async: true`. Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for
> `agent`. `UserPromptSubmit` lowers the `command`, `http`, and `mcp_tool` default to 30

The plugin's existing hooks all set `"timeout": 5`. That is the right instinct and it is not the
default.

### Every failure mode lets the write through

**run**, one session each, all with the same prompt, all with `--allowedTools Write`:

| Hook behaviour | Tool call | Transcript record | Model told |
|---|---|---|---|
| exit 1, stderr text | proceeds, file created | `hook_non_blocking_error`, `stderr: "Failed with non-blocking status code: STDERR-TOKEN-BADGER: hook broke"` | nothing |
| stdout is truncated JSON, exit 0 | proceeds, file created | treated as plain text, `hook_success` | nothing |
| stdout is valid JSON that fails schema, exit 0 | proceeds, file created | `hook_non_blocking_error` carrying `Hook JSON output validation failed - continue: expected boolean, received string` and the whole expected schema | nothing reported |
| hook sleeps 12s under `"timeout": 2` | proceeds, file created | `hook_cancelled`, `timedOut: true`, `timeoutMs: 2000`, `durationMs: 2014` | nothing |
| exit 2, stderr text | blocked, file not created | tool result with `is_error: true` | the stderr, verbatim |

The build's own rule, again (**read**, the `/hooks` menu text): exit 2 blocks; every other non-zero exit
shows stderr to the user only and continues.

That is the answer to the plugin's own rule that a hook must never break the run it exists to help. A
`PreToolUse` hook satisfies it by never exiting 2 and never returning `deny` or `ask` unless it means
to. Everything else it can get wrong is absorbed. A crash, a missing interpreter, a bad JSON payload, a
scan that takes too long: all of them let the write happen and cost the model nothing.

The one silent cost is that a hook which is wrong in a way that still parses is not detectable from
inside the hook. A hook that stops emitting `additionalContext` because a field name changed upstream
would go on exiting 0 forever.

### What the hook is given to run in

**read**, the spawn: the process gets the session environment plus
`CLAUDE_PROJECT_DIR`, and, for a plugin hook, `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`. Its `cwd`
is the project directory, not the tool's target directory. Referencing `${CLAUDE_PLUGIN_ROOT}` from a
hook that is not a plugin hook throws with a named error, which is how the plugin's existing hooks are
already wired.

## 5. Matchers

### `"Write|Edit|NotebookEdit"` is a literal list, not a regex

**read**, the two matcher functions, the fast path and the fallback that calls it. Reading them in
order:

- `"*"`, `""`, or no matcher at all matches every tool. Checked first, so `*` never reaches the regex
  compiler.
- A matcher made only of letters, digits, `_`, `|`, and (on the tool events, which include PreToolUse)
  comma, space and `-`, takes the fast path: split on `|` or `,`, trim, compare exact strings. So
  `"Write|Edit|NotebookEdit"` is three exact names.
- Anything else is `new RegExp(matcher)` and an unanchored `.test`. `^Notebook` and `mcp__memory__.*`
  work; a matcher with a syntax error logs an invalid-regex debug line and matches nothing.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), the matcher table, which says the
same thing:

> | `"*"`, `""`, or omitted | Match all | fires on every occurrence of the event |
> | Only letters, digits, `_`, `-`, spaces, `,`, and `\|` | Exact string, or list of exact strings
> separated by `\|` or `,` with optional surrounding whitespace | `Bash` matches only the Bash tool;
> `Edit\|Write` and `Edit, Write` each match either tool exactly |
> | Contains any other character | JavaScript regular expression, unanchored | `^Notebook` matches any
> tool whose name starts with `Notebook` |

The plugin's current `hooks.json` uses `"matcher": "*"` on its two Post events. That is the documented
match-all and it is safe.

### Matching is case sensitive

**run**. A matcher of `"write"`, lowercase, on `PreToolUse`, pointed at a hook that appends to a log
file. One session that wrote a file. The log file was never created: the hook never fired.

The build has no case folding anywhere on that path. The one lookup each name goes through (**read**)
is an alias map for a handful of renamed tools (`ReadMcpResource` to `ReadMcpResourceTool` and
similar), which returns the name unchanged when it is not in the map. It is not a normaliser.

### The file-writing tool names on this build

**read**. The build keeps its own set of four names, used to decide whether a tool call touched a file:
`Write`, `Edit`, `MultiEdit` and `NotebookEdit`.

`MultiEdit` is still named in the build, in that set and in a separate tool-name list.
It was not offered as a tool in any session run for this note, and no separate tool description for it
was found. Treat it as a name the build still recognises rather than a tool that will appear. Including
it in a matcher costs nothing and guards against it coming back.

## 6. Longevity

### What is a documented contract

All of it is on one page,
[https://code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks):

- the `PreToolUse` event, that it fires before the tool and can block it
- the stdin field names, including `prompt_id`, `permission_mode`, `tool_input`, `tool_use_id`,
  `agent_id`, `agent_type`, `effort`
- `hookSpecificOutput.permissionDecision` with `allow`, `deny`, `ask`, and
  `permissionDecisionReason`, `additionalContext`, `updatedInput`
- exit 0 reads JSON, exit 2 blocks, other non-zero codes continue
- the matcher table, all three rows
- `timeout` in seconds, default 600
- hooks run in parallel, and the same handler in two settings files runs once

### What is one build's behaviour

- `defer` as a fourth `permissionDecision`. In the enum, in the mapper, in no documentation.
- The exact wording of a block message, `PreToolUse:Write hook error: [<command>]: <stderr>`, and the
  `toolDenialKind` values `permission-rule` and `user-rejected`.
- That `additionalContext` is delivered as its own attachment placed between the tool call and the
  tool result rather than merged into either.
- That plain stdout at exit 0 is recorded but not shown to the model. The build's `/hooks` text and the
  docs' exit-code table both say this, so it is close to documented; what is not documented is that the
  text is still written to the transcript.
- That stdout not starting with `{`, or not ending with `}`, downgrades the whole payload to plain
  text with no error anywhere.
- That `ask` in a headless run resolves to a rejection rather than an error or a hang.
- That NotebookEdit hands over the path unresolved.

### What would break silently

Ranked by how quietly it would fail:

1. **`additionalContext` stops being honoured on `PreToolUse`.** The hook goes on exiting 0. Nothing in
   the hook's own output says the text was dropped. Every session looks healthy and the plugin says
   nothing. This is the same failure class as the calibration drift already recorded in
   `plugins/ultracode-anywhere/hooks/upstream.mjs`, and the same answer applies: read the installed
   build for the shape, and say so when it is gone.
2. **A stray line before the JSON.** A `console.log` in a dependency, a Node deprecation warning on
   stdout, a shell wrapper that echoes. The payload becomes plain text and vanishes. This is a
   self-inflicted version of the same silence, and it is the one most likely to happen during
   development.
3. **A new file-writing tool, or a renamed path key.** A matcher listing three names would not fire for
   a fourth tool; a reader keyed on `file_path` would find nothing in a payload that spells it
   differently, as NotebookEdit already does. Both fail by saying nothing.
4. **The default timeout drops.** A scan that takes longer than the new default is cancelled and the
   claim is lost, with a `hook_cancelled` record the model never reads. The plugin already sets its own
   timeout, so this only bites if a value is removed.
5. **The matcher fast path changes.** Low risk: `Write|Edit|NotebookEdit` behaves the same whether it
   is split on `|` or compiled as a regex, because the alternation means the same thing both ways.

## What this means for this repository

- Both issues are buildable on `PreToolUse` as it stands. #119 wants directory claims plus a verdict at
  write time; the payload carries the path, `additionalContext` carries the claims, and
  `permissionDecision` carries the verdict. #120 wants an existence rule; the same hook is where a
  directory that a change invents is visible for the first time.
- The claims still arrive after the write unless the hook decides. This is the fact that changes the
  design. `additionalContext` alone moves a claim from a banner to the write it is about, which is a
  real gain, but it does not stop the write. Issue #119's example output reads like something the model
  sees before choosing a path. It will see it just after.
- `deny` plus `additionalContext` is the pairing that does what #119 describes, and both halves reach
  the model in the same batch. The verdict has to be one the plugin is willing to enforce, because the
  model cannot get around it: in the exit-2 run it retried once and then stopped and asked for the hook
  to be changed. A false DEVIATES stalls real work.
- The plugin's rule that a hook must never break the run survives contact with this event, on one
  condition: never exit 2, and never emit `deny` or `ask` from a code path that can be wrong. Every
  other failure, including a crash, is already absorbed by the build.
- Keep the existing `"timeout": 5`. The default is 600 seconds.
- The matcher to write is `"Write|Edit|NotebookEdit"`, or `"Write|Edit|MultiEdit|NotebookEdit"` to
  cover the name the build still knows. Do not lowercase it. Do not reach for a regex.
- Resolve the path in the hook. It may be spelled through a link, it is not guaranteed absolute, and
  the key it lives under depends on the tool.
- Print one JSON object and nothing else. Any preamble on stdout throws the payload away without a
  word.

## What could not be established

- **Whether the truncation caps apply to a local command hook.** A table in the build sets
  `additionalContext` to 8000 characters and 200 lines and `permissionDecisionReason` to 2000
  characters and 20 lines. The same chunk drops `updatedInput`, `allow` and `defer` on `PreToolUse`,
  which the main path plainly honours, and it sits beside strings about serving a machine's hooks to a
  cloud session. So that chunk is very likely the device-hooks path, not this one. No cap was measured
  on a local hook. Anything relying on a long `additionalContext` should be measured before it is
  relied on.
- **The interactive `ask` prompt.** `ask` was only run headless, where it came back as a rejection
  labelled `user-rejected`. What a user sees, and whether the `permissionDecisionReason` is what the
  prompt shows them, was not tested.
- **A subagent's payload.** `agent_id` and `agent_type` are in the payload builder and in the docs, and
  neither appeared in any capture here because all three ran in a main loop. Not measured.
- **Whether `MultiEdit` is a live tool.** Its name is in the build's own file-writing set and in a
  tool-name list. No tool description for it was found and it was never offered in any session run
  here. Read as a name still recognised, not as a tool confirmed present.
- **What `defer` does.** It is in the enum and the mapper turns it into a defer behaviour, and the
  aggregation ranks it between `deny` and `ask`. No run used it and no documentation covers it.
- **Whether the `hook_success` attachment is genuinely hidden from the model.** Two runs asked the
  model to report every hook text it had been shown and it reported neither the plain stdout nor the
  non-blocking error, and the build's own text says stdout is not shown at exit 0. That is behaviour,
  not structure. The attachment is in the transcript either way.
- **Windows.** Every run was macOS. The spawn code has separate branches for PowerShell, Git Bash and
  backslash rewriting, and none of them were exercised.
- **A second matching hook on the same event.** Only one PreToolUse hook was registered at a time (plus
  whatever this account's own settings already carry on other events). The precedence read out of the
  build is deny over defer over ask over allow, first `allow` wins, but two competing hooks were not
  run against each other.

## Reproducing this

The capture is one throwaway settings file and one headless run per case. Nothing leaves the machine
beyond the model call itself, and each prompt is a few tokens.

```sh
mkdir -p /tmp/cap/out /tmp/cap/work
cat > /tmp/cap/hook.sh <<'EOF'
#!/bin/sh
cat > /tmp/cap/out/pre.json
exit 0
EOF
chmod +x /tmp/cap/hook.sh
cat > /tmp/cap/settings.json <<'EOF'
{"hooks":{"PreToolUse":[{"matcher":"Write|Edit|NotebookEdit",
  "hooks":[{"type":"command","command":"/tmp/cap/hook.sh","timeout":10}]}]}}
EOF
cd /tmp/cap/work && claude -p "Create hello.txt containing hi. Then stop." \
  --settings /tmp/cap/settings.json --allowedTools Write \
  --model claude-opus-5 --effort low --output-format json < /dev/null
```

To read what the model was given rather than what it said, open the `transcript_path` from the captured
payload and walk the JSONL: `tool_use` blocks, `attachment` entries with `hookEvent: "PreToolUse"`, and
the `tool_result` that follows. The attachment types that matter are `hook_success`,
`hook_additional_context`, `hook_non_blocking_error` and `hook_cancelled`.

The bundle reads use `plugins/ultracode-anywhere/hooks/upstream.mjs` to find the build (`cliPath()`),
then `LC_ALL=C grep -a -b -o -F '<literal>'` to find a known string and a seek-and-read of a few
kilobytes around it. The file is 206 MB; a wide context pattern is refused by the stock macOS `grep`.

## Sources

First-party documentation:

- [Anthropic, Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

The installed build:

- `~/.local/share/claude/versions/2.1.250`, 206,479,552 bytes. Sites read, described above rather than
  quoted: the `/hooks` menu event descriptions, the bundled hooks reference, the payload builder, the
  stdout parser, the JSON-to-decision mapper, the spawn and its timeout, the two matcher functions, the
  tool-name alias map, the output schema, the decision enum, the file-writing tool set, the default
  timeout, and the permission handoff.

This repository:

- `plugins/anatomiya/hooks/hooks.json` (the three events wired today),
  `plugins/ultracode-anywhere/hooks/upstream.mjs` (`cliPath`, `MIN_BUNDLE`, the chunked scan this note
  reuses), issues #119 and #120.

## Addendum, 2026-09-22

`plugins/ultracode-anywhere/` was removed from this repository. The build reader this note
cites (`cliPath`, `MIN_BUNDLE`, `settingsFor`) lives at `scripts/claude-build.mjs` now; the
paths above are where it sat when the measurements were taken.
