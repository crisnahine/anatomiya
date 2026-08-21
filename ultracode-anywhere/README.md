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
reading it does not report itself as running at xhigh. If depth is what you are after, raise
`effortLevel`; this plugin is orthogonal to it, and stacking the two is the combination it exists
for.

It does not change the concurrent-subagent cap, and no reminder can: the cap is read where the
subagent is spawned, not where the model is instructed. It defaults to 20. Whether native ultracode
lifts it is not something this plugin can show you, and it does not claim it: the shipped build is
a compiled binary, so the check below can read strings out of it and nothing around them. What is
true either way is that a workflow refused at 20 is fixed by `settings.json` with
`"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }`, and the first session on a machine that
has not set it says so once.

Workflow subagents inherit the session effort, so a medium session is medium all the way down.
The reminder tells the model to pass `opts.effort` on the stages that need the depth, which is the
one depth lever a prompt does control.

## What it costs

One short-lived `node` process per prompt, 29 to 34 ms of it over ten runs on the machine this was
measured on. What reaches the model is 1224 characters on the first turn, 94 on every tenth after
that, and nothing on the rest, appended after the user message so the cache prefix is untouched.
Over a 30-turn session that is 1412 characters in total, the opening text plus two refreshers.

The session check reads the installed build once per build, not once per session: 180 ms the first
time, 30 ms after that, since the answer is kept beside the turn counters under the build's path,
size and timestamp. All of these are one machine's numbers with a warm page cache; the shape to
rely on is one process per prompt and one bundle read per install, not the milliseconds.

Turns are counted per session in a file, and the count is read and written without a lock. Two
prompts of one session arriving at once can lose a turn, which moves where a refresher lands and
nothing else, so the cadence is close rather than exact.

## How this differs from native ultracode

Four deliberate differences, each with a reason:

| | native | here |
|---|---|---|
| what the text asks for | the Workflow tool on every substantive task | the Workflow tool where the scale or risk earns it, with a floor under it |
| effort | resolves to xhigh | unchanged, whatever `effortLevel` says |
| subagent cap | not something this can read | not changed by this plugin |
| upstream contract | a supported mode | four strings read off one build, re-checked by hand |

The wording is the one worth arguing about. Native says every substantive task; this says the work
has to earn it and asks for the reason in a clause. That is a deviation, and it is on purpose: a
standing "on" with no floor buys a dozen agents for a one-file edit, and the bill for that is the
real cost of this plugin, not the characters above.

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

Three of the four are names, one is a sentence, and none of them is the gate itself. The shipped
build is a compiled binary: the strings sit in its table with no readable logic around them, which
is the reason this is a string check and not a gate check. A proximity test was tried and dropped
on the same evidence, because `xhigh` appears nowhere within 20,000 characters of any of the 14
`ultra_effort_enter` sites in the build this was read off, so it would have failed on the build it
was calibrated against.

Claude Code updates itself, so expect the version line often. A version nobody has checked is not a
broken one; it is a prompt to work `VERIFYING.md`, which takes a few minutes and is the only thing
that can answer the half a string check cannot.

The rest is a person's job, and `VERIFYING.md` is the list: the version this was last checked
against, the four things to re-read, and what to change when one of them has moved. A build whose
minor or major differs from that version gets a line at the start of the session saying nobody has
checked it, which is not a failure, only a fact.

`ULTRACODE_ANYWHERE_STRICT=1` turns the check into a switch: on a build that dropped one of the
four, the hook stays quiet for the session. It is off by default, since going silent costs the mode
to everyone whose build is fine. The answer is kept beside the turn counters under the build's own
path, size and timestamp, so it costs one bundle read after an install rather than one per prompt:
177 ms on the first turn, then 30, against a hook timeout of 5 seconds.

`test/upstream.test.mjs` runs the same check against whatever is installed on the machine running
the suite, and skips where there is none.

## Behavior

The whole text opens the session, a one-line refresher comes back every tenth turn after that, and
every turn in between says nothing, which is the shape of the thing being mirrored. Skips loop,
schedule, poll and system wakeups, which are turns the user did not type.

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
- `ULTRACODE_ANYWHERE_EVERY=25 claude` puts more turns between refreshers. Anything unreadable, or
  zero, falls back to 10.
- `ULTRACODE_ANYWHERE_REFRESHER=0 claude` drops the refresher, leaving the opening text and
  silence.
- `ULTRACODE_ANYWHERE_FULL=repeat claude` brings the whole text back on the cadence instead of the
  one-line refresher, for a session long enough to lose it.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every fire with its stdin payload, and says
  when a setting silenced it.
- `ULTRACODE_ANYWHERE_STRICT=1 claude` stays quiet for the session on a build that no longer
  carries what this plugin mirrors.
- `ULTRACODE_ANYWHERE_CAP_NOTICE=0 claude` stops the one-time line about the concurrent-subagent
  cap.
- `ULTRACODE_ANYWHERE_STATE=/some/dir claude` keeps the turn counters somewhere else. The
  directory is the hook's alone, and it has to be one this account owns with mode `0700`, which is
  what the hook creates for itself. A directory made by hand under the usual umask is `0755` and is
  refused, which costs the cadence: every turn then carries the full text.
