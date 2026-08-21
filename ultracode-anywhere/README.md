# ultracode-anywhere

Keeps ultracode's standing Workflow orchestration on at any effort level.

## Why

In Claude Code the ultracode gate is one predicate:

```js
function Mae(model, effort, flag) { return flag === true && ZL() && zZ(model, effort) === "xhigh" }
```

The `xhigh` term is a conjunct, not a side effect, so dropping to `medium` turns the mode off.
What it gates is exactly one thing that reaches the model: the `ultra_effort_enter`
system-reminder. The Workflow tool itself is gated only on `enableWorkflows` and carries no
effort term, so the tool stays available at every level.

A wire-level diff of `ultracode:true` at xhigh against `effortLevel:medium` plus this plugin
shows two differing lines in the whole request: the session id, and `output_config.effort`.
Same system prompt, same 91 tool definitions, same Workflow tool description.

This plugin restates the reminder on every prompt, so the mode holds at whatever level is set.

## Requires

`~/.claude/settings.json` must NOT contain `"ultracode": true`. While that key is true the effort
resolver returns `"xhigh"` unconditionally and `effortLevel` is ignored. Set `effortLevel`
instead, and keep `"enableWorkflows": true`.

## Behavior

Full text on turn 1 and every 10th, a one-line refresher in between, mirroring the built-in
cadence. About 125 tokens on a full turn, appended after the user message so the cache prefix is
untouched. Skips loop, schedule and system wakeups.

## Switches

- `ULTRACODE_ANYWHERE=0 claude` turns it off for one session.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every fire with its stdin payload.

## Not restored

Native ultracode also bypasses the concurrent-subagent cap. At any other level the cap applies at
its default of 20. Raise it with `"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }` if a
workflow ever gets refused.

Workflow subagents inherit the session effort, so a medium session is medium all the way down.
Pass `opts.effort` on the stages that need depth.
