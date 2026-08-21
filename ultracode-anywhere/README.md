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

## What it does not do

It restores an instruction, not a thinking budget. The session's effort level is whatever
`effortLevel` says, and no text a hook adds changes it: the model is told to orchestrate, and it
orchestrates at the depth that level buys. The reminder says so in as many words, so a model
reading it does not report itself as running at xhigh.

Native ultracode also bypasses the concurrent-subagent cap, and no reminder can: the cap is read
where the subagent is spawned, not where the model is instructed. At any other level it applies at
its default of 20. Raise it yourself in `settings.json` with
`"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }`. The first session on a machine that has
not says so once, so it is not something to find out when a workflow is refused.

Workflow subagents inherit the session effort, so a medium session is medium all the way down.
The reminder tells the model to pass `opts.effort` on the stages that need the depth, which is the
one depth lever a prompt does control.

## What it costs

26 ms per prompt on the machine this was measured on, one short-lived `node` process, and 1224
characters on a full turn, 94 on the others, appended after the user message so the cache prefix
is untouched. The session check below is 213 ms once per session against a 321 MB build.

The expensive failure is not the tokens, it is a fan-out over work that did not need one. The
reminder carries its own floor: use the Workflow tool where the scale or risk earns it, stay solo
on a question that can be answered, a fact that can be read back, or one file's mechanical edit,
and scale the harness to the work rather than running the largest one every time.

## When it stays quiet

It reads the settings Claude Code reads, the user's with a project's own on top, and says nothing
at all in a session where it would be noise:

- `"ultracode": true` forces xhigh whatever `effortLevel` says, and the built-in reminder already
  fires. A second copy is tokens for nothing.
- `"enableWorkflows": false` means there is no Workflow tool for the reminder to point at.

Either way a line at the start of the session says which setting silenced it, so a plugin that is
doing nothing does not look like one that is working.

## When upstream moves

There is no API here to hold Claude Code to. The premise was read off one build, and nothing stops
that build changing, so the plugin says what it is standing on and checks that much on every
session.

A `SessionStart` check reads the installed Claude Code for the four things the premise rests on:
`ultra_effort_enter`, `enableWorkflows`, `TURNS_BETWEEN_MAINTENANCE`, and the sentence in the
Workflow tool's own description that counts a standing ultracode mode as the explicit opt-in it
otherwise refuses to act without. That last one is the contract this plugin satisfies by restating
the reminder; reworded upstream, the reminder still arrives and means nothing. If a build stops
carrying one, the session opens with a line naming what went missing.

Three of the four are names, one is a sentence, and none of them is the gate itself. A proximity
test on the gate was tried and dropped, because `xhigh` appears nowhere within 20,000 characters of
any of the 15 `ultra_effort_enter` sites in the build this was read off: it would have failed on
the build it was calibrated against. What a static read can prove is that the things named are
still there.

The rest is a person's job, and `VERIFYING.md` is the list: the version this was last checked
against, the four things to re-read, and what to change when one of them has moved. A build whose
minor or major differs from that version gets a line at the start of the session saying nobody has
checked it, which is not a failure, only a fact.

`ULTRACODE_ANYWHERE_STRICT=1` turns the check into a switch: on a build that dropped one of the
four, the hook stays quiet for the session. It is off by default, since going silent costs the mode
to everyone whose build is fine.

`test/upstream.test.mjs` runs the same check against whatever is installed on the machine running
the suite, and skips where there is none.

## Behavior

Full text on turn 1 and every 10th, a one-line refresher in between, mirroring the built-in
cadence. Skips loop, schedule and system wakeups.

The hook runs through `node`, which Claude Code brings with it, so it fires the same on a machine
with no shell. It counts a session's turns in a file named for that session under the temporary
directory, its own per user, and forgets counters a week after their last turn. Anything it cannot
read or write costs the session its cadence, not its reminder: the turn still gets the full text,
which is the safe direction to fail in. A payload naming no session reads as a first turn every
time, for the same reason.

The state directory is the hook's alone. It is refused unless it is a real directory this account
owns with no access for anyone else, since a predictable path under `/tmp` is one another account
can create first, and only files named like a session and holding a count are ever removed from
it.

## Switches

- `ULTRACODE_ANYWHERE=0 claude` turns it off for one session.
- `ULTRACODE_ANYWHERE_EVERY=25 claude` puts more turns between full texts. `0` makes every turn a
  full one; anything unreadable falls back to 10.
- `ULTRACODE_ANYWHERE_REFRESHER=0 claude` drops the one-line refresher, leaving only the full
  turns and nothing in between.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every fire with its stdin payload, and says
  when a setting silenced it.
- `ULTRACODE_ANYWHERE_STRICT=1 claude` stays quiet for the session on a build that no longer
  carries what this plugin mirrors.
- `ULTRACODE_ANYWHERE_CAP_NOTICE=0 claude` stops the one-time line about the concurrent-subagent
  cap.
- `ULTRACODE_ANYWHERE_STATE=/some/dir claude` keeps the turn counters somewhere else. The
  directory is the hook's alone.
