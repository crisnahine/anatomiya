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
Same system prompt, the same tool definitions, the same Workflow tool description.

This plugin restates that reminder, so the mode holds at whatever level is set.

## What it does not do

It restores an instruction, not a thinking budget. The session's effort level is whatever
`effortLevel` says, and no text a hook adds changes it: the model is told to orchestrate, and it
orchestrates at the depth that level buys. The reminder says so in as many words, so a model
reading it does not report itself as running at xhigh. If depth is what you are after, raise
`effortLevel`; this plugin is orthogonal to it, and stacking the two is the combination it exists
for.

It does not lift the concurrent-subagent cap, and no reminder can. Native ultracode does lift it,
which the build says in as many words:

```js
let vt = kbp(); if (l.taskRegistry.getConcurrentSubagents() < vt) return;
...
if (Mae(l.rootToolSurface.mainLoopModel, NR(Zt), Zt.ultracode)) return;
... "Concurrent subagent limit reached"
function kbp() { return V.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? ZmS }   // ZmS = 20
```

The refusal returns early when that predicate holds, and the predicate reads the session's own
`ultracode` flag, which nothing a hook writes can set. So the cap stays at 20 here. Raise it
yourself in `settings.json` with `"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }`; the
first session on a machine that has not says so once.

Workflow subagents inherit the session effort, so a medium session is medium all the way down.
The reminder tells the model to pass `opts.effort` on the stages that need the depth, which is the
one depth lever a prompt does control.

## What it costs

One short-lived `node` process per prompt, 29 to 34 ms of it over ten runs on the machine this was
measured on. What reaches the model is 1224 characters on the first turn, 94 on every tenth after
that, and nothing on the rest, appended after the user message so the cache prefix is untouched.
Over a 30-turn session that is 1412 characters in total, the opening text plus two refreshers. A
payload that names no session, or a state directory this cannot use, reads every turn as the first
one, and a 30-turn session then costs 30 opening texts instead. The reminder is the cheap half
either way.

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
| subagent cap | lifted, by the same predicate | left at 20, since no reminder reaches it |
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

`/effort ultracode` inside a running session writes nothing to `settings.json`, so a session
switched that way mid-flight gets both reminders until it ends. Setting it in `settings.json` is
what this reads.

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

Three of those four are names and one is a sentence. The fifth thing it checks is the gate itself,
as a shape rather than a name: the build ships as a compiled binary but its JavaScript is readable
inside, and the predicate is one minified function whose names change between builds and whose
shape does not.

```js
function Mae(e,t,r){return r===!0&&ZL()&&zZ(e,t)==="xhigh"}
```

What the premise needs is that `"xhigh"` is a conjunct there rather than something the reminder
sets, so the check matches a three-argument function returning a flag, a call and an effort
comparison against `"xhigh"`. A build that stops requiring it is a build this plugin no longer
describes, whatever names survive.

A proximity test was tried first and dropped on evidence: `xhigh` appears nowhere within 20,000
characters of any of the 14 `ultra_effort_enter` sites, so it would have failed on the build it was
calibrated against. Reading the predicate is what replaced it.

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
180 ms on the first turn, then 30, against a hook timeout of 5 seconds.

`test/upstream.test.mjs` runs the same check against whatever is installed on the machine running
the suite, and skips where there is none.

## Behaviour

The whole text opens the session, a one-line refresher comes back every tenth turn after that, and
every turn in between says nothing, which is the shape of the thing being mirrored. Skips loop,
schedule, poll and system wakeups, which are turns the user did not type.

The hook runs through `node`, which Claude Code brings with it, so it fires the same on a machine
with no shell. It counts a session's turns in a file named for that session under
`~/.claude/ultracode-anywhere/` (or whatever `CLAUDE_CONFIG_DIR` names), beside the rest of this
account's own Claude Code state, and forgets counters a week after their last turn. Anything it cannot
read or write costs the session its cadence, not its reminder: the turn still gets the full text,
which is the safe direction to fail in. A payload naming no session reads as a first turn every
time, for the same reason.

The state directory is the hook's alone. It is refused unless it is a real directory this account
owns with no access for anyone else. That check was written when this state lived under `/tmp`,
where a predictable path is one another account can create first; the state moved out of there, and
the check stayed for the switch below and for a machine with no home directory to write into. Inside it, a file is only removed when its name is a plain word and its contents
are a count, and a file standing where a counter would go, holding anything else, is left alone
rather than written over. Two dotfiles live there too and are never swept: what the build check
last answered, and whether the cap line has been said. A directory it refuses costs the cadence,
and the cap line then comes back every session rather than once.

## Switches

- `ULTRACODE_ANYWHERE=0 claude` turns it off for one session.
- `ULTRACODE_ANYWHERE_EVERY=25 claude` puts more turns between refreshers. Anything unreadable, or
  zero, falls back to 10.
- `ULTRACODE_ANYWHERE_REFRESHER=0 claude` drops the refresher, leaving the opening text and
  silence.
- `ULTRACODE_ANYWHERE_FULL=repeat claude` brings the whole text back on the cadence instead of the
  one-line refresher, for a session long enough to lose it.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every prompt the hook fires on, its stdin
  payload, and what silenced it when something did. The session hook writes nothing there.
- `ULTRACODE_ANYWHERE_STRICT=1 claude` stays quiet for the session on a build that no longer
  carries what this plugin mirrors.
- `ULTRACODE_ANYWHERE_CAP_NOTICE=0 claude` stops the one-time line about the concurrent-subagent
  cap.
- `ULTRACODE_ANYWHERE_STATE=/some/dir claude` keeps the turn counters somewhere other than
  `~/.claude/ultracode-anywhere/`. The directory is the hook's alone, and it has to be one this
  account owns with mode `0700`, which is what the hook creates for itself. A directory made by hand under the usual umask is `0755` and is
  refused, which costs the cadence: every turn then carries the full text.
