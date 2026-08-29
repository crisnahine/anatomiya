# ultracode-anywhere

Keeps ultracode's standing Workflow orchestration on at any effort level.

## Why

In Claude Code the ultracode gate is one predicate:

```js
function Ale(model, effort, flag) { return flag === true && gH() && kQ(model, effort) === "xhigh" }
```

The `xhigh` term is a conjunct, not a side effect, so dropping to `medium` turns the mode off.
What it gates is exactly one thing that reaches the model: the `ultra_effort_enter`
system-reminder. The Workflow tool itself is gated on `enableWorkflows`, on the plan and policy
around it, and on no effort term at all, so wherever the tool is available it stays available at
every level.

A wire-level diff of `ultracode:true` at xhigh against `effortLevel:medium` plus this plugin, with
the session id held fixed and the same prompt in the same directory, differs in exactly two places:
the reminder text itself, and `output_config.effort`. The system prompt is identical, and so is
every tool definition, the Workflow tool's included. The reminder is the difference the plugin
exists to make; the effort is the one it deliberately leaves alone. `VERIFYING.md` has the recipe.

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
let yt = PHp(); if (l.taskRegistry.getConcurrentSubagents() < yt) return;
if (nt("tengu_amber_kestrel", false)) return;
let lt = l.getAppState();
if (Ale(l.rootToolSurface.mainLoopModel, fC(lt), lt.ultracode)) return;
... "Concurrent subagent limit reached"
function PHp() { return G.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? H4S }   // H4S = 20
```

The refusal returns early when the ultracode predicate holds, and that predicate reads the session's
own `ultracode` flag, which nothing a hook writes can set. So the cap stays at 20 here. Raise it
yourself in `settings.json` with `"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }`; the
first session on a machine that has not says so once. `tengu_amber_kestrel`, on the line above, is a
flag Anthropic sets and nobody here does: turned on, it lifts the cap for every session on that
build, this plugin's included.

This plugin does not set a stage's effort, and no hook can. A spawn's effort comes from its agent
definition, and the built-in definition a workflow stage gets carries none, so a stage falls through
to the session's own level unless the script passes `opts.effort`. That is the only lever a caller
has, and the model is the only one holding it. So `ULTRACODE_ANYWHERE_STAGE_EFFORT` asks the model
to pass it, which is a request and not a setting: a session that ignores the text runs its fan-out
at the session's level, which is where it was going to run anyway. Set nothing and the reminder says
to leave `opts.effort` alone.

A workflow script that names an `agentType` is the one case where a stage has a definition of its
own, and a `.claude/agents/*.md` carrying `effort:` then sets that stage's level with no `opts.effort`
in sight. `opts.effort` still wins where the script passes both, so the reminder's instruction holds;
what it does not hold for is a stage the script never asks the model to configure.

The switch names a level rather than a direction, and the hook cannot read the session's own to tell
which way it points: `--effort` and `/effort` write nothing to `settings.json`. Below the session is
what it was built for, since fan-out is where the tokens go. Above it works and buys the opposite,
and one thing changes shape with it: the reminder tells the checking stage to leave `opts.effort`
out, so that stage runs at the session's level, which is the deeper setting below the session and
the shallower one above. Set a level above your session and the stage that checks the others is the
one running cheapest, which is the reading to avoid. Depth is otherwise bought by how the work is
split and independently checked, which is the lever a prompt controls without changing what the
session costs.

The model half of the same question needs nothing from this plugin. `CLAUDE_CODE_SUBAGENT_MODEL` is
a real subagent-only seam upstream: set it and every spawn resolves to that model while the main loop
keeps its own, workflow stages included. Measured in the environment, and `settings.json`'s `"env"`
block populates that environment, which is how the cap above is set. There is no matching variable
for effort, which is the whole reason the switch above is a sentence of text rather than a setting.

There is a settings route to a subagent's effort, and it is worth knowing about rather than using.
`modelSettings` carries an `effortLevel` per model, and a spawn resolves its effort against its own
model, so `CLAUDE_CODE_SUBAGENT_MODEL` plus a row for that model does split the fan-out from the
session, workflow stages included. Three things make it a poor lever, each measured on the wire. The
row is keyed by a model rather than by who is spawning, so without the model split it takes the main
loop down with it. It stops at `xhigh`, since that path validates against four names where
`opts.effort` takes five. And it is dead the moment `--effort` or `/effort` pins a level, which is
the ordinary case for anyone reading this page.

## What it costs

One short-lived `node` process per prompt, about 30 ms of it over ten runs on the machine this was
measured on, most of which is node starting. What reaches the model is 1266 characters on the first
turn, 94 on every tenth after that, and nothing on the rest, appended after the user message so the
cache prefix is untouched. Over a 30-turn session that is 1454 characters in total,
the opening text plus two refreshers. A payload that names no session, or a state directory this
cannot use, reads every turn as the first one, and a 30-turn session then costs 30 opening texts
instead. The reminder is the cheap half either way.

`ULTRACODE_ANYWHERE_STAGE_EFFORT` puts the level into both, which at its longest level name is 1464
characters on the first turn and 194 on every tenth after that, or 1852 over 30 turns. That is 398
characters more than the default over such a session, against a fan-out it moves by a whole effort
level.

The session check reads the installed build once per build, not once per session: about 200 ms
the first time, about 30 after, since the answer is kept beside the turn counters under the
build's path, size and timestamp. All of these are one machine's numbers with a warm page cache;
the shape to rely on is one process per prompt and one bundle read per install, not the
milliseconds.

Turns are counted per session in a file, and the count is read and written without a lock. Two
prompts of one session arriving at once can lose a turn, which moves where a refresher lands and
nothing else, so the cadence is close rather than exact.

## How this differs from native ultracode

Five deliberate differences, each with a reason:

| | native | here |
|---|---|---|
| what the text asks for | the Workflow tool on every substantive task | the Workflow tool where the scale or risk earns it, with a floor under it |
| effort | resolves to xhigh | unchanged, whatever `effortLevel` says |
| what names a stage's effort | nothing but the script, on the tool's own guidance | the same, or one level a switch names for the whole fan-out |
| subagent cap | lifted, by the same predicate | left at 20, since no reminder reaches it, unless a remote flag lifts it for the whole build |
| upstream contract | a supported mode | four strings and the gate's shape, read off one build and re-checked by hand |

The wording is the one worth arguing about. Native says every substantive task; this says the work
has to earn it and asks for the reason in a clause. That is a deviation, and it is on purpose: a
standing "on" with no floor buys a dozen agents for a one-file edit, and the bill for that is the
real cost of this plugin, not the characters above.

The expensive failure is not the tokens, it is a fan-out over work that did not need one. The
reminder carries its own floor: use the Workflow tool where the scale or risk earns it, stay solo
on a question that can be answered, a fact that can be read back, or one file's mechanical edit,
and scale the harness to the work rather than running the largest one every time.

## When it stays quiet

It reads the settings files Claude Code reads, the user's with a project's own on top, and the
environment variables the build reads alongside them, and says nothing at all in a session where it
would be noise:

- `"ultracode": true` forces xhigh whatever `effortLevel` says, and the built-in reminder already
  fires. A second copy is tokens for nothing.
- `"enableWorkflows": false`, `"disableWorkflows": true`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1` or
  `CLAUDE_CODE_WORKFLOWS=false` all mean there is no Workflow tool for the reminder to point at.
  The build reads the disable switches first, and so does this.

The build also turns the tool off where this hook cannot see: `enableWorkflows` left unset defaults
to off on a Pro plan, an organisation policy can refuse it, and a remote flag can withdraw it. On
Pro, set `"enableWorkflows": true`, or the reminder points at a tool the session does not have.

What it does not read: managed settings, the plan, and the `--effort` flag or `/effort` command,
which write nothing to `settings.json`. A session raised to `/effort ultracode` mid-flight gets both reminders
until it ends. A session dropped from there to `/effort medium` gets the built-in's exit line
saying ultracode is off and the Workflow tool's standard opt-in rule applies again, and then this
plugin's refresher saying it is still on, which is the plugin doing what it is for: keeping the mode
on at the level you dropped to. To stop it, start the next session with `ULTRACODE_ANYWHERE=0`.

Either way a line at the start of the session says which setting silenced it, so a plugin that is
doing nothing does not look like one that is working. That line, the version line and the drift
line are said when a session starts and again after a compaction or a `/clear`, which empty the
context; a resumed session is told nothing, since its transcript already holds them.

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
function Ale(e,t,r){return r===!0&&gH()&&kQ(e,t)==="xhigh"}
```

What the premise needs is that `"xhigh"` is a conjunct there rather than something the reminder
sets, so the check matches a function returning a flag, a call and an effort comparison against
`"xhigh"`, in any of the spellings a minifier chooses between. A build that stops requiring it is a
build this plugin no longer describes, whatever names survive.

A proximity test was tried first and dropped on evidence: the build has 14 `ultra_effort_enter`
sites and 235 occurrences of `xhigh`, and the closest pair is 185,312 bytes apart, so a window of
20,000 would have failed on the build it was calibrated against. Reading the predicate is what
replaced it.

Claude Code updates itself, so expect the version line whenever the minor moves, and again once a
run of patch releases has gone by without one. A single patch bump gets no line, which is not the
same as nothing having moved: two consecutive patch builds here were the same size to the byte and
differed in 176,881,324 of them. A version nobody has checked is not a broken one; it is a prompt to
work `VERIFYING.md`, which takes a few minutes and is the only thing that can answer the half a
string check cannot. The version is read off the build's own path, which the native installer names
for it under `~/.local/share/claude/versions/`; an npm install's `cli.js` names none, and such a
build gets the drift check and no version line.

The rest is a person's job, and `VERIFYING.md` is the list: the version this was last checked
against, the four things to re-read, and what to change when one of them has moved. A build whose
minor or major differs from that version gets a line at the start of the session saying nobody has
checked it, which is not a failure, only a fact. So does one ten or more patch releases past it: a
single patch is noise and ten is chosen for that noise rather than fitted to the last drift, which
ran three patches and would still pass in silence. Nothing else here can
notice, since a CI runner has no Claude Code to read.

`ULTRACODE_ANYWHERE_STRICT=1` turns the check into a switch: on a build that dropped one of the
four, or the gate, the hook stays quiet for the session. It is off by default, since going silent
costs the mode to everyone whose build is fine. The answer is kept beside the turn counters under
the build's own path, size and timestamp, so it costs one bundle read after an install rather than
one per prompt: about 200 ms on the first turn, then about 30, against a hook timeout of 5 seconds.

`test/upstream.test.mjs` runs the same check against whatever is installed on the machine running
the suite, and skips where there is none.

## Behaviour

The whole text opens the session, a one-line refresher comes back every tenth turn after that, and
every turn in between says nothing, which is the shape of the thing being mirrored. A compaction or
a `/clear` empties the context, and the cadence starts over on the next prompt, which is what the
built-in does: its walk back through the messages finds no reminder to count from and sends the
whole text again. A resumed session keeps its count; a fork is a new session and opens with the
whole text.

It skips loop, schedule, poll and system wakeups, which are turns the user did not type, when the
payload says which it is. 2.1.241 declares that `source` field in its hook schema and does not send
it: a payload caught off that build carries the session, the transcript, the directory, the prompt
and its id, the permission mode, and nothing naming who typed it. So a wakeup counts as a turn there
and gets whatever its place in the cadence earns; the skip starts working the day the field arrives,
with no change here.

A turn here is a prompt, and the built-in counts user messages that are neither meta nor a tool
result, so the two count the same turns: neither of those fires a prompt hook.

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
the check stayed for the switch below. A machine with no home to write into keeps no state at all,
which costs the cadence and not the reminder. Inside it, a file is only removed when its name is a plain word and its contents
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
- `ULTRACODE_ANYWHERE_STAGE_EFFORT=medium claude` names the level the fan-out should run at:
  `opts.effort` at that level on every workflow stage, and left out of one checking or judging
  another stage's work, which then runs at the session's level unless its own definition sets one.
  Unset, the text is the one above, which says to leave `opts.effort` alone. The levels are `low`,
  `medium`, `high`, `xhigh`, `max`, read past case and surrounding spaces; anything else is read as
  unset, and the session opens with a line saying so rather than leaving it to be found on the bill.
  It reaches a workflow stage and nothing else: a fan-out done with the Agent tool runs at the
  session's level whatever this says, since that tool takes no effort argument. Those five and
  nothing else: `opts.effort` itself also takes `med` and an integer, and this switch takes neither,
  since the text names a level. `VERIFYING.md` step 7 says what the integer does upstream, which is
  another reason.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every prompt the hook fires on, its stdin
  payload, and what silenced it when something did. The session hook writes nothing there. A fifo
  nobody is reading, standing at that path, is refused without waiting.
- `ULTRACODE_ANYWHERE_STRICT=1 claude` stays quiet for the session on a build that no longer
  carries what this plugin mirrors.
- `ULTRACODE_ANYWHERE_CAP_NOTICE=0 claude` stops the one-time line about the concurrent-subagent
  cap.
- `ULTRACODE_ANYWHERE_STATE=/some/dir claude` keeps the turn counters somewhere other than
  `~/.claude/ultracode-anywhere/`. The directory is the hook's alone, and it has to be one this
  account owns with mode `0700`, which is what the hook creates for itself. A directory made by hand
  under the usual umask is `0755` and is refused, which costs the cadence: every turn then carries
  the full text. Spell it absolute: `~` is not expanded here, and a relative path follows each
  process's own directory.
