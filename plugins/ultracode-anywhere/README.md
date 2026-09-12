# ultracode-anywhere

Ships the orchestration instead of asking for it: three workflows you run by name, the agent types
they spawn, and the reminder that keeps the Workflow tool in play at any effort level.

## Install

```
/plugin marketplace add crisnahine/anatomiya
/plugin install ultracode-anywhere@crisnahine
```

It is its own plugin: installing `anatomiya` from the same marketplace does not install this one.
Restart the session afterwards, since workflows and agent types are read once at startup.

## What it ships

Three orchestrations live under `workflows/`. Claude Code loads a plugin's workflows and resolves
each under `<plugin>:<name>`, so they are called like this:

```
Workflow({ name: 'ultracode-anywhere:review', args: 'the staged diff' })
```

| name | what it does | when |
| --- | --- | --- |
| `ultracode-anywhere:review` | six readers, one per dimension, then three lenses try to refute each finding before it is reported, up to twenty-four of them | there is a diff, a branch or a file to review |
| `ultracode-anywhere:understand` | readers fan out over the areas of an unfamiliar codebase, one synthesis merges them into a map | before changing code nobody in the session has read |
| `ultracode-anywhere:hunt` | rounds of finders, each searching a different way, until two rounds running turn up nothing new | the question is "find them all" and nobody knows the count |

Each is a file. It was written once, it is gated in CI, and it runs the same way every time. That is
the whole difference from a script the model improvises on the turn it needs one: the fan-out width,
the vote arithmetic, the early exits and the caps are the same today as they were last week, and
`test/workflows.test.mjs` drives each one against fake agents to prove it.

Four agent types live under `agents/` and are what those workflows spawn: `finder`, `reader`,
`verifier` and `synthesist`. Each carries its own tool refusals and its own prompt, and what effort
a stage runs at is decided by these files rather than by a request the model may or may not honour.
`finder` and `reader` name `effort: medium`, since they are the wide, cheap half. `verifier` and
`synthesist` name no effort at all, which is how a spawn keeps the session's own level: the stages
that check and merge must not be the cheap ones.

## Why the reminder is still here

In Claude Code the ultracode gate is one predicate:

```js
function fC(e,n,o,r){ return o===!0 && eu() && NA(e,n,{turnEffort:r})==="xhigh" }
```

The `xhigh` term is a conjunct, not a side effect, so dropping to `medium` turns the mode off.
What it gates is exactly one thing that reaches the model: the `ultra_effort_enter`
system-reminder. The Workflow tool itself is gated on `enableWorkflows`, on the plan and policy
around it, and on no effort term at all, so wherever the tool is available it stays available at
every level.

A wire-level diff of `ultracode:true` at xhigh against `effortLevel:medium` plus this plugin, with
the session id held fixed and the same prompt in the same directory, differs in three places: the
reminder text itself, `output_config.effort`, and the `workflow-authoring` skill the native side
loads into the user message. The system prompt is identical, and so is every one of the 24 tool
definitions, the Workflow tool's included. The reminder is the difference the plugin exists to make,
the effort is the one it deliberately leaves alone, and the skill is the one it cannot reach. Against
a plain `--effort xhigh` with no `ultracode` key the diff is two leaves, so the flag is what loads the
skill and not the level. `VERIFYING.md` has the recipe.

## Why the catalogue is not optional

Claude Code loads a plugin's workflows and then never mentions them. The hook that would append a
listing to the Workflow tool's description is a stub, `function ke(){return}`, and its sibling
`function ct(){return""}` is appended to the tool's prompt and description. The only place a
workflow name reaches the model is the error raised when one fails to resolve:

```js
return { error: `Workflow "${e.name}" not found. Available: ${o || "(none)"}` }
```

So a shipped workflow is loadable, resolvable, and unreachable unless something names it. This
plugin's prompt hook is that something: the opening text lists what is shipped and when each applies,
and the refresher keeps the names in view. Turn the listing off with
`ULTRACODE_ANYWHERE_CATALOGUE=0` and the workflows are still installed, still resolvable by name, and
nothing in the session will tell the model they are there.

A session already running native ultracode gets the listing too, from the `SessionStart` notice.
The prompt hook stands aside there, and the built-in reminder it stands aside for says nothing about
a plugin's workflows, so without that the users most likely to want these would be the ones who never
hear of them.

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
let Yo = qur(); if (n.taskRegistry.getConcurrentSubagents() < Yo) return;
if (H("tengu_amber_kestrel", !1)) return;
let xa = n.getAppState();
if (fC(n.rootToolSurface.mainLoopModel, ul(xa), xa.ultracode)) return;
... "Concurrent subagent limit reached"
function qur() { return a.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? J }   // J = 20
```

The refusal returns early when the ultracode predicate holds, and that predicate reads the session's
own `ultracode` flag, which nothing a hook writes can set. So the cap stays at 20 here. Raise it
yourself in `settings.json` with `"env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }`; the
first session on a machine that has not says so once. `tengu_amber_kestrel`, on the line above, is a
flag Anthropic sets and nobody here does: turned on, it lifts the cap for every session on that
build, this plugin's included.

It does not outrank anything. A plugin's strongest lever is context injected at `SessionStart` and
on every prompt, which is what this uses. That text sits alongside the system prompt and your own
`CLAUDE.md` rather than above them, and nothing in the plugin surface changes that: there is no
manifest key, no hook field and no settings entry that makes a plugin's instructions win an
argument. A plugin's own `settings.json` is honoured for two keys, `agent` and `subagentStatusLine`,
and neither is one. The catalogue is written to be directive about the work it covers and to stop
there, because text that told the model to disregard its other instructions would be a promise the
hook cannot keep and would teach a reader to discount the rest of it.

Your own `.claude/workflows/` outranks this plugin's where the two use one name, deliberately. The
build merges the lists built-in first, then plugin, then `~/.claude/workflows`, then the nearest
`.claude/workflows` walking up from the working directory, and a later entry of the same name wins.
An override that does not parse is refused in favour of the shipped copy, which is the safe
direction.

In practice the two rarely meet, because a plugin's workflow is registered under
`<plugin>:<meta.name>` and yours under its bare `meta.name`. A repository that writes its own
`review` gets `review` beside `ultracode-anywhere:review`, and both are callable; replacing the
shipped one means naming yours `ultracode-anywhere:review` exactly.

This plugin does not set a stage's effort from the reminder, and no hook can. What it does instead is
ship the agent types its own workflows spawn, each carrying `effort:` in its frontmatter, which the
build reads when a stage names an `agentType`. That is a file rather than a request, and it is the
whole reason the shipped workflows pass no `opts.effort` at all.

`ULTRACODE_ANYWHERE_STAGE_EFFORT` remains for the other case: a script the model writes itself has no
agent definition to read, so the level there can only be asked for. It is a request and not a
setting: a session that ignores the text runs its fan-out at the session's level, which is where it
was going to run anyway. Set nothing and the reminder says to leave `opts.effort` alone.

The switch names a level rather than a direction, and the hook cannot read the session's own to tell
which way it points: `--effort` and `/effort` write nothing to `settings.json`. Below the session is
what it was built for, since fan-out is where the tokens go. Above it works and buys the opposite,
and one thing changes shape with it: the reminder tells the checking stage to leave `opts.effort`
out, so that stage runs at the session's level, which is the deeper setting below the session and
the shallower one above. Set a level above your session and the stage that checks the others is the
one running cheapest, which is the reading to avoid.

It does not load the `workflow-authoring` skill, and native ultracode does. That is the third leaf
of the wire diff: `"ultracode": true` puts the whole reference into the user message, a command block
and about sixteen thousand characters of body, so a native session starts holding the script API,
the resume rules and the worked examples that the reminder's own text points at. Nothing a hook
writes can load a skill. The reminder points at the Workflow tool's own description instead, which
names the skill and says to load it before writing a script, so a session that wants it in context
can ask for it by name. A session running a shipped workflow needs less of it: the script is already
written.

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
measured on, most of which is node starting: bare `node` on the same machine is 23. What reaches the
model is 3035 characters on the first turn, 217 on every tenth after that, and nothing on the rest,
appended after the user message so the cache prefix is untouched. Over a 30-turn session that is
3469 characters in total, the opening text plus two refreshers.

The catalogue is most of that. Without it the opening text is 1266 characters, so listing three
workflows costs 1769 on the first turn and takes the refresher from 94 to 217. That is the price of
the only sentence in the session that says the workflows exist, and `ULTRACODE_ANYWHERE_CATALOGUE=0`
buys it back for anyone who would rather name them by hand.

A payload that names no session, or a state directory this cannot use, reads every turn as the first
one, and a 30-turn session then costs 30 opening texts instead. The reminder is the cheap half
either way: one run of `ultracode-anywhere:review` spawns up to 79 agents, six finders plus three
verifiers for each of at most twenty-four findings plus one synthesis.

`ULTRACODE_ANYWHERE_STAGE_EFFORT` puts the level into both, which at its longest level name is 3233
characters on the first turn and 317 on every tenth after that, or 3867 over 30 turns. That is 398
characters more than the default over such a session, against a fan-out it moves by a whole effort
level.

The session check reads the installed build once per build, not once per session: about 150 ms the
first time on a warm page cache, about 30 after, since the answer is kept beside the turn counters
under the build's path, size and timestamp. All of these are one machine's numbers with a warm page cache;
the shape to rely on is one process per prompt and one bundle read per install, not the
milliseconds.

Reading the shipped workflows for the catalogue is one directory listing and three file reads of a
few kilobytes each, and it happens only on the turns the text goes out: the cadence is decided
before the read, so nine prompts in ten read nothing at all. A session whose turns cannot be counted
reads every turn as the first one and pays the read on each of them.
`ULTRACODE_ANYWHERE_CATALOGUE=0` skips it entirely.

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

- `"ultracode": true` resolves effort to xhigh over `effortLevel`, and the built-in reminder fires.
  A second copy is tokens for nothing. One case gets neither reminder: the gate reads the effort the
  session actually resolved to, so a `--effort`, an `/effort` or a model that cannot run xhigh takes
  it below xhigh, the built-in stays silent, and this hook has already gone quiet on the key it can
  see. The line at the start of the session names both, since nothing else can.
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
function fC(e,n,o,r){return o===!0&&eu()&&NA(e,n,{turnEffort:r})==="xhigh"}
```

What the premise needs is that `"xhigh"` is a conjunct there rather than something the reminder
sets, so the check matches a function returning a flag, a call and an effort comparison against
`"xhigh"`, in any of the spellings a minifier chooses between. A build that stops requiring it is a
build this plugin no longer describes, whatever names survive.

A proximity test was tried first and dropped on evidence. On 2.1.268 the build has 9
`ultra_effort_enter` sites and 123 occurrences of `xhigh`. One pair sits 3,548 bytes apart and is
the wrong pair: both are in the compiled binary's string tables, `ultra_effort_enter` beside
`ultra_effort_exit` and `xhigh` beside `effort-level` and `medium`, nowhere near the gate. Every
site in the JavaScript is at least 167,473 bytes from an `xhigh`. So a window tight enough to mean
anything misses the gate, and one wide enough to reach it matches a table of event names. The
distance also moves by a megabyte between builds, which is the deeper reason: reading the predicate
is what replaced it.

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
one per prompt: about 150 ms on the first turn, then about 30, against a hook timeout of 5 seconds.

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
payload says which it is. 2.1.268 declares that `source` field in its hook schema and does not send
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
- `ULTRACODE_ANYWHERE_CATALOGUE=0 claude` drops the listing of shipped workflows and leaves the
  reminder. The workflows stay installed and stay resolvable by name; what goes is the only sentence
  in the session that says so, since Claude Code lists a plugin's workflows nowhere. Worth setting
  if you already know the three names and would rather have the 1769 characters back.
- `ULTRACODE_ANYWHERE_EVERY=25 claude` puts more turns between refreshers. Anything unreadable, or
  zero, falls back to 10.
- `ULTRACODE_ANYWHERE_REFRESHER=0 claude` drops the refresher, leaving the opening text and
  silence.
- `ULTRACODE_ANYWHERE_FULL=repeat claude` brings the whole text back on the cadence instead of the
  one-line refresher, for a session long enough to lose it.
- `ULTRACODE_ANYWHERE_STAGE_EFFORT=medium claude` names the level a workflow the model writes itself
  should run its stages at: `opts.effort` at that level on every stage, and left out of one checking
  or judging another stage's work, which then runs at the session's level. It does not reach the
  workflows this plugin ships, and it is not meant to: those name an `agentType`, and the level comes
  from that agent's own file. Unset, the text is the one above, which says to leave `opts.effort`
  alone. The levels are `low`, `medium`, `high`, `xhigh`, `max`, read past case and surrounding
  spaces; anything else is read as unset, and the session opens with a line saying so rather than
  leaving it to be found on the bill. It reaches a workflow stage and nothing else: a fan-out done
  with the Agent tool runs at the session's level whatever this says, since that tool takes no effort
  argument. Those five and nothing else: `opts.effort` itself also takes `med` and an integer, and
  this switch takes neither, since the text names a level. `VERIFYING.md` step 7 says what the
  integer does upstream, which is another reason.
- `ULTRACODE_ANYWHERE_DEBUG=/tmp/uc.log claude` logs every prompt the hook fires on, its stdin
  payload, and what silenced it when something did. The session hook writes nothing there. A fifo
  nobody is reading, standing at that path, is refused without waiting.
- `ULTRACODE_ANYWHERE_STRICT=1 claude` stays quiet for the session on a build that no longer
  carries what this plugin mirrors.
- `ULTRACODE_ANYWHERE_CAP_NOTICE=0 claude` stops the one-time line about the concurrent-subagent
  cap.
- `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT` is **gone** as of 0.6.0 and sets nothing. It named the level
  for agent files this plugin used to tell you to hand-write; it ships those types itself now, each
  carrying its own `effort:`. The only thing still read here is whether it is set at all: a session
  that has it in `settings.json` is told once that it does nothing and what replaced it, because a
  switch removed in silence is a setting somebody keeps trusting. Remove it, or put `effort:` on an
  agent file of your own.
- `ULTRACODE_ANYWHERE_STATE=/some/dir claude` keeps the turn counters somewhere other than
  `~/.claude/ultracode-anywhere/`. The directory is the hook's alone, and it has to be one this
  account owns with mode `0700`, which is what the hook creates for itself. A directory made by hand
  under the usual umask is `0755` and is refused, which costs the cadence: every turn then carries
  the full text. Spell it absolute: `~` is not expanded here, and a relative path follows each
  process's own directory.

## Changing a shipped workflow

The scripts are plain JavaScript under `workflows/`, and `npm run lint:workflows` holds each one to
the rules the build enforces silently:

- `export const meta = {…}` is the first statement, a `const`, one declarator, and a pure literal
- `name` and `description` are non-empty strings, and no key is `__proto__`, `constructor` or `prototype`
- the file is under 524,288 bytes, and its name ends in `.js`
- the body compiles as an async function body
- every free name it reaches is one of the eleven the sandbox injects or a language name the sandbox
  leaves alone (`LANGUAGE` in `scripts/workflow-lint.mjs`, which is the realm's own list minus what
  the build's hardening deletes and what `codeGeneration: {strings: false}` forbids)
- nothing calls `Date.now()`, bare `new Date()` or `Math.random()`, and nothing uses `with`,
  `import()`, `await using` or an identifier beginning `__wRg$`
- every `phase()` title has an entry in `meta.phases` and every entry is used, and no entry is
  malformed, which the build drops without a word
- every `agentType` is one this plugin ships
- no two files declare the same `meta.name`
- the plugin's own dependency-free reader answers what a real parse answers

A file that breaks any of those is skipped by the loader with a warning in a log nobody opens, so
the gate is the only thing standing between a typo and a workflow that silently does not exist.

Two things catch people. The extension has to be `.js`: the loader recognises `.mjs`, `.cjs` and
`.ts` and refuses all three, which is why these files are the one exception to the `.mjs` everywhere
else in this repository. And the directory is read once per session and never watched, so a script
edited mid-session does not take effect until Claude Code restarts.

`test/workflows.test.mjs` runs each script's real body against fake agents in a context holding only
the eleven injected names, which is how the fan-out width, the vote arithmetic and the early exits
are tested without spending a token.
