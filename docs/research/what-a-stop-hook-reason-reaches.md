# What a Stop hook reason reaches: the whole text, as a meta user turn, and nothing at all on a timeout

Research notes, October 2026. The reuse check is a `Stop` hook (`plugins/anatomiya/hooks/hooks.json`,
`"timeout": 15`) that answers `{"decision":"block","reason":"..."}`. Its tests assume the transcript
records that answer as a meta user message whose content is `Stop hook feedback:\n<reason>`
(`test/reuse.test.mjs`, `test/transcript.test.mjs`, the `FEEDBACK` constant in
`plugins/anatomiya/lib/reuse.mjs`). This note checks that assumption on the current build, and finds
out what happens to a long reason and to a slow hook.

**Confirmed, with one addition.** A block reason lands in the transcript exactly as the tests expect,
whole, with no length cap: a 12,909-character, 151-line reason arrived byte for byte. On this build
the same reason also goes to the model a second time, as a system turn that names the hook's command.
A hook that runs past its timeout is sent SIGTERM, its output is thrown away, and the turn ends as if
the hook had allowed the stop. Neither the model nor the transcript's message stream says anything
about it.

Every claim below carries its source, in the kinds the sibling notes use: **read**, behaviour read
from the installed build, with the minified snippet quoted and the literal that finds it; **run**, a
captured session on this machine, today; **doc**, a first-party page, quoted, with its URL.

The build read and run against is **Claude Code 2.1.312**, the file
`<home>/.local/share/claude/versions/2.1.312`, 275,988,512 bytes; `claude --version` said `2.1.312`.
Every `run` is a headless `claude -p` session in a fresh git repository under `$TMPDIR`, with
`--settings <file>` registering one Stop hook script, `--setting-sources project` so no user setting
or installed plugin loads, `--strict-mcp-config`, and `--model claude-haiku-5-5`. Three sessions were
run, costing $0.0116, $0.0035 and $0.0014 as reported by `--output-format json`.

The bundle reads use `LC_ALL=C grep -a -b -o -F '<literal>'` to find a byte offset and `dd` to read a
few kilobytes around it, the same recipe as `what-a-pretooluse-hook-can-do.md`.

## Summary

| Question | Answer on 2.1.312 | Source |
|---|---|---|
| What the transcript records for a block | a `user` record, `isMeta: true`, content `Stop hook feedback:\n<reason>`, then a `hook_blocking_error` attachment and a `stop_hook_summary` system record | read, run |
| What the model is sent | that meta user turn, plus a system turn `Stop hook blocking error from command: "<command>": <reason>` | read, run |
| Is the reason cut | no; 2,589 and 12,909 characters arrived whole, so did 151 lines | run |
| What the reason is changed by | only `<` before `system-reminder`, and a trailing lone `<`, become `&lt;` | read |
| `timeout` units and default | seconds; absent means 600 seconds | read, run, doc |
| A hook past its timeout | SIGTERM at the timeout, output discarded, no block, turn ends | run, read, doc |
| A hook that exits 1 | no block, turn ends; its stderr is shown to the user, never to the model | run, read, doc |
| stderr from a hook that exits 0 | recorded nowhere | run, doc |

## 1. How a block reaches the model

### The transcript record is the one the tests assume

**read**. The build builds the text with a two-part template. Literal `` hook feedback:`` finds it:

```js
var T7r=` hook feedback:
`,JZo=["Stop","TeammateIdle","TaskCreated","TaskCompleted"];function acr(e,n){return`${e}${T7r}${n}`}
```

and its Stop caller, found by searching for `acr(`:

```js
function i1t(e){return acr("Stop",zC(e.blockingError))}
```

The Stop loop turns every blocking result into a meta user message. Literal `content:i1t(` finds it:

```js
if(ve.blockingError){let Oe=Ie({content:i1t(ve.blockingError),isMeta:!0});Be.push(Oe),yield Oe,gt=!0;
... else Xt.push(ve.blockingError.blockingError),Oo=!0}
```

`Be` is the list of messages the continued turn is built from, so this message is what the next
request carries. `Xt` becomes `hookErrors` on the `stop_hook_summary` record (section 4).

**run**, session 1. The first Stop call blocked with a 2,589-character, 31-line reason. The transcript
recorded, in this order:

- line 23: `type: "user"`, `isMeta: true`, `message.role: "user"`, content length 2,609, starting
  `Stop hook feedback:\nALPHA line 001` and ending `ALPHA-END`. 2,609 is 2,589 plus the 20 characters
  of `Stop hook feedback:\n`.
- line 24: `attachment` of type `hook_blocking_error`, `hookEvent: "Stop"`, carrying
  `blockingError: { blockingError: <reason>, command: <the hook's command> }`.
- line 25: `system` record, subtype `stop_hook_summary`, with the reason in `hookErrors`.

The record shape the plugin's tests build (`{ type: "user", isMeta: true, message: { role: "user",
content: "Stop hook feedback:\n" + reason } }`) matches line 23 field for field.

### The model also gets a system turn with the same reason

**read**. The `hook_blocking_error` attachment has a renderer of its own. Literal
`hook blocking error from command` finds it:

```js
hook_blocking_error:(e)=>[Ie({content:JOe(`${e.hookName} hook blocking error from command: "${e.blockingError.command}": ${e.blockingError.blockingError}`),isMeta:!0})],
```

In the Stop loop the attachment joins `Be` only behind a gate:

```js
if(yield ve.message,Ys(ve.message)&&Fr())Be.push(ve.message);
```

where `function Ys(e){return e.type==="attachment"&&e.attachment.type==="hook_blocking_error"}` and
`function Fr(){return Fp()&&k(Rm,!0)}` (literal `function Fr(){`). `k(Rm,!0)`
reads as a feature flag that defaults to on; what `Fp()` tests was not traced.

**run**. On this account the gate was on. In all three sessions the transcript holds an
`api-request-blob` record, written just before each continued request, whose message is
`role: "system"` with text `Stop hook blocking error from command: "node <path>/block.mjs <path>/out":
ALPHA line 001 ...ALPHA-END`, whole. The matching `api-request` record lists three hashes in its
`tail`, and that blob is the third. So the continued request carries the meta user turn and this
system turn, and the reason is sent twice.

One check points the other way and is weak. In session 3 the reason told the model to copy, verbatim,
every turn it had received since its last reply. Haiku quoted only the user turn
`Stop hook feedback:\nDELTA-7. ...` and called it "the only message". A small model's account of its
own context is not proof. The request record is stronger evidence. Which of the two hashes in the
tail is the meta user turn could not be shown, because the hash scheme is not a plain SHA-256 of the
message JSON.

### `stop_hook_active` and the loop cap

**run**. The payloads captured in session 1 had `stop_hook_active: false` on the first Stop call and
`true` on the second and third.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), Stop input:

> Claude Code applies an 8-consecutive-continuation cap: after stop hooks have continued the turn
> eight times in a row, Claude Code overrides the next block and ends the turn. The count of
> consecutive continuations resets each time Claude calls a tool. To raise the cap, set
> `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.

## 2. Length limits

### A local hook's reason is not capped

**run**, session 1. The second Stop call blocked with a 12,909-character, 151-line reason. The whole
stdout line was 13,091 characters. The transcript's meta user message was 12,929 characters
(12,909 plus the prefix), 152 lines, ending `BRAVO-END`. The system-turn blob carried the reason to
`BRAVO-END` as well, and the model's reply named "150 lines labeled `BRAVO line 001` through
`BRAVO line 150`, ending in `BRAVO-END`". Nothing was spilled to a file.

**read**, the only change made to the text. Literal `function zC(e){return crt(`
and `function crt(`:

```js
function zC(e){return crt(e).replace(/<(?=\s*(?:\/\s*)?$)/,"&lt;")}
function crt(e){return e.replaceAll(/<(?=\s*(?:\/\s*)?system-reminder\b)/gi,"&lt;")}
```

So a `<system-reminder>` tag inside a reason reaches the model as `&lt;system-reminder>`, and a
trailing lone `<` becomes `&lt;`. Nothing else is touched.

### Where the docs' 10,000-character cap applies, and where it does not

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), JSON output:

> A hook's `additionalContext`, `systemMessage`, and `initialUserMessage` strings, and its plain
> stdout, are capped at 10,000 characters
>
> **Over the limit**: Claude Code saves the output to a file in the session directory and replaces
> it with the file path and a preview of up to the first 2,000 characters.

`reason` is not in that list, and the run above passed 13,091 characters of JSON stdout without a
spill. **read**: in the hook runner, `additionalContext` and `systemMessage` pass through an
`await U_e(...)` call before they are yielded, and `blockingError` is yielded with no such call
(literal `if(ls.blockingError)yield{blockingError:ls.blockingError`). The
two agree: the cap is on the fields the docs name, and a block reason skips it.

### A 2,000-character cap exists, on a different path

**read**. Literal `reason:2000,stopReason:2000` finds a table:

```js
var iL={reason:2000,stopReason:2000,systemMessage:4000,additionalContext:8000,permissionDecisionReason:2000},Q_=200,aL={reason:20,stopReason:20,systemMessage:20,additionalContext:Q_,permissionDecisionReason:20};
function Br(e,n,r){if(typeof r!=="string")return;if(e.options.personal===!0)return r;let{text:s,truncated:h}=eUo(r,iL[n],aL[n]);...}
```

That is 2,000 characters and 20 lines for `reason`. It runs inside `S_e`, and `Br` returns the text
untouched when `options.personal` is true. The callers of `S_e` (search `S_e(`) are the path for a
hook from the user's own files under a restricted-config mode, which passes `personal:!0`, and paths
that answer for a hook served to a cloud session from this machine (`registry.recordHit`,
`cloud template`, `[remote-tools]`). The 2.1.250 note found the same table and judged it the device
path. **run** settles it for a local command hook: 2,589 characters over 31 lines, and 12,909 over
151, both arrived whole. A reason from a hook that runs under remote control of a cloud session would
be cut to 2,000 characters and 20 lines. That case was not run.

## 3. The timeout

### Seconds, default 600

**read**, the command branch of the hook runner. Literal `Fo.timeout?Math.min(` :

```js
let Ya=Fo.timeout?Math.min(GB(Fo)?VM(Fo,b):Fo.timeout*1000,Bd):b
```

`b` comes from `timeoutMs:b=Hp` in the same function, and `var Hp=600000`. So a
set `timeout` is seconds times 1000, an absent one is 600,000 ms. `Bd` is an upper clamp; a
`Bd=2147483647` exists in the bundle but that it is this `Bd` was not shown.

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks), common fields:

> `timeout` | no | Seconds before canceling. ... Defaults: 600 for `command`, `http`, and
> `mcp_tool`; 30 for `prompt`; 60 for `agent`. Claude Code lowers the `command`, `http`, and
> `mcp_tool` default to 30 on `UserPromptSubmit`, `PreModelSwitch`, and `PostModelSwitch` ...

Stop is not in the lowered list.

### Past the timeout: SIGTERM, output dropped, the stop goes ahead

**run**, session 2. Two Stop hooks on the same matcher. One records its start, traps SIGTERM to
record the signal, and after 20 seconds would print `{"decision":"block","reason":"CHARLIE late
block"}`, under `"timeout": 3`. The other writes two lines to stderr and exits 1. Results:

- the slow hook got SIGTERM 2,978 ms after it started; it never reached its print
- the transcript recorded `hook_cancelled`, `hookEvent: "Stop"`, `timedOut: true`,
  `timeoutMs: 3000`, `durationMs: 3026`
- no meta user message, no `hook_blocking_error`; `num_turns: 1`, result `ok`
- the session took 7 seconds end to end, so the turn waited for the slow hook to be cancelled before
  ending

**read**, the Stop loop skips a timed-out result before it looks for a block:

```js
if(ve.timedOut){if(dt&&ve.hook?.prompt===dt.condition)St="cancelled",p("goal_met","evaluator_timeout");continue}
```

**doc**, [Hooks reference](https://code.claude.com/docs/en/hooks):

> Apart from a command hook you run with `async: true`, Claude Code cancels a `command`, `http`, or
> `mcp_tool` hook that reaches its `timeout`, discarding the hook's output, so on most events a
> timed-out hook renders no decision.

and on `onFailure`, which could otherwise turn a failure into a block:

> The field has no effect on these hooks:
>
> * **`Stop`, `SubagentStop`, `TaskCompleted`, and `TeammateIdle` hooks**: exit code 2 on these
>   events sends Claude back to keep working, and Claude can't repair a hook that won't run

Whether Claude Code escalates to SIGKILL for a hook that ignores SIGTERM was not tested. The probe
exited on SIGTERM.

### A non-zero exit other than 2 also allows the stop

**run**, session 2, the second hook: recorded as `hook_non_blocking_error`, `exitCode: 1`,
`stderr: "Failed with non-blocking status code: STDERR-EXIT1 first line\nsecond line"`,
`durationMs: 48`. No block followed.

**doc**, same page: other exit codes are "a non-blocking error ... The action goes ahead", and exit 2
on Stop "Prevents Claude from stopping, continues the conversation", with stderr as the reason:
"A hook that blocks by exiting 2 routes the same way as `reason`". Exit 2 was not run here.

## 4. What stderr and a timeout show, and to whom

### The model sees neither

**read**. In the attachment-to-message table, beside the `hook_blocking_error` renderer quoted above:

```js
hook_cancelled:()=>[],hook_error_during_execution:()=>[],hook_non_blocking_error:()=>[],
```

An empty array means the attachment adds nothing to a request. **run** agrees: session 2 sent no
further request after the hooks ran, and session 1's hook wrote `STDERR-ON-BLOCK-1` to stderr while
exiting 0 with a block, and that string appears nowhere in the transcript. **doc**: "Claude never
sees stderr from a hook that exits 0."

### The user sees errors and blocks as "Stop hook error"

**read**. The terminal renderer for `stop_hook_summary`, found by literal `Stop hook error: `:

```js
let S=Is([...h&&M?[M]:[],...c.map((I)=>`Stop hook error: ${I}`),...g.map((I)=>`Stop hook feedback: ${I}`)].join(`
`),{maxLines:eu});return{kind:"line",row:{tone:c.length>0?"red":h||g.length>0?"gold":"dim",text:`Ran ${d} stop ${d===1?"hook":"hooks"}`,
```

`c` is `hookErrors`. **run**: in session 1 `hookErrors` held each block reason; in session 2 it held
the exit-1 stderr. So a block reason shows to the user as a red `Stop hook error:` line, cut to
`maxLines` for display only, and the summary is hidden only when there are no errors, no context and
no stopped continuation. A timed-out hook adds nothing to `hookErrors`: session 2's list held only the
exit-1 line, so a timeout is silent in the summary. The `/goal` and `additionalContext` route is the
one the renderer labels `Stop hook feedback`, which matches the docs' line that `additionalContext`
"is shown in the transcript as hook feedback rather than a hook error".

## What this means for the reuse check

- **A reason of about 2,000 characters is delivered whole.** So was one of 12,909 characters and 151
  lines. There is no 2,000-character or 20-line cap on a local command hook, and the 10,000-character
  spill does not apply to `reason`. Two costs to know: the model is sent the reason twice on this
  build (the meta user turn and a system turn naming the command), so 2,000 characters cost about
  4,000 in context; and the user sees it as a red `Stop hook error`, not as feedback.
- **The transcript shape the tests build is right for 2.1.312.** `type: "user"`, `isMeta: true`,
  content `Stop hook feedback:\n<reason>`, unchanged except for `&lt;` before `system-reminder`.
  A reason that quotes a `<system-reminder>` tag would not match itself byte for byte afterwards.
- **A hook that runs about 1 second is safe under `"timeout": 15`.** The unit is seconds, so 15 means
  15,000 ms, and every Stop hook on the event runs in parallel; the turn waits for the slowest.
- **A slow index read fails open and silently.** At 15 seconds the hook gets SIGTERM, its stdout is
  discarded, and the turn ends as if no block was asked for. The model is told nothing, the summary
  shows nothing, and the transcript holds only a `hook_cancelled` attachment with `timedOut: true`.
  The user waits the full 15 seconds first. A crash or an exit 1 also allows the stop, and its stderr
  reaches only the user's terminal. Exit 2 is the one failure that blocks, with stderr as the reason.

## What could not be established

- Which hash in the continued request's `tail` is the meta user turn. The system-turn blob is the
  third; the scheme for the other two was not found.
- What `Fp()` tests in the gate that adds the system turn, so whether every account gets the reason
  twice.
- Whether a hook that ignores SIGTERM is later sent SIGKILL.
- A block from a hook run for a cloud session from this machine, where the 2,000-character, 20-line
  table applies.

## Reproduce

```sh
P=$TMPDIR/stopprobe; mkdir -p $P/work $P/out; (cd $P/work && git init -q .)
# block.mjs: count calls in $P/out, print {"decision":"block","reason":...} on the first two, exit 0 silently after
cat > $P/s1.json <<EOF
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node $P/block.mjs $P/out","timeout":15}]}]}}
EOF
cd $P/work && claude -p "Reply with the single word ok." --settings $P/s1.json \
  --setting-sources project --strict-mcp-config --model claude-haiku-5-5 --output-format json < /dev/null
```

Read the result from the `transcript_path` in a captured payload: the `user` records with
`isMeta: true`, the `attachment` records with `hookEvent: "Stop"`, the `stop_hook_summary` system
record, and the `api-request-blob` records that hold what each continued request added.

## Sources

First-party documentation:

- [Anthropic, Claude Code hooks reference](https://code.claude.com/docs/en/hooks), read as
  `https://code.claude.com/docs/en/hooks.md` on 2026-10-29: JSON output and its 10,000-character cap,
  common fields (`timeout`), the timeout and `onFailure` sections, Stop input and Stop decision control

The installed build:

- `<home>/.local/share/claude/versions/2.1.312`, 275,988,512 bytes. Sites quoted above: the
  `hook feedback:` template and `i1t`, the Stop loop's `blockingError` and `timedOut` branches, the
  `hook_blocking_error` renderer and the empty renderers beside it, `Fr`, `zC` and `crt`, the
  `iL`/`aL` cap table and `Br`, the command branch's timeout, and the `stop_hook_summary` renderer

This repository:

- `plugins/anatomiya/hooks/hooks.json` (the Stop hook and its `"timeout": 15`),
  `plugins/anatomiya/lib/reuse.mjs` (`FEEDBACK`), `test/reuse.test.mjs` and
  `test/transcript.test.mjs` (the record shape they build)
