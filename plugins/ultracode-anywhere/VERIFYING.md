# Re-checking this against a build

This plugin has no API to hold Claude Code to. It restates a system-reminder whose id, cadence and
opt-in contract were read out of one build, so the only thing that keeps it honest is redoing that
reading. The `SessionStart` check does the cheap half on every session; this is the half a person
does, and it takes a few minutes.

It was last worked whole against **2.1.270**, on 2026-09-13, which is the version
`CALIBRATED_AGAINST` in `hooks/upstream.mjs` names. Move that string when you have worked this list
on a newer build, and nothing else in this file or the README may name a build that is not it:
`test/upstream.test.mjs` fails on one that does.

A patch bump is not cosmetic, and the plugin says nothing about a single one. `behind` used to
compare major and minor only, so three patch releases went by with the constant naming the first of
them and no session ever saying so, and the last two of those builds were the same size to the byte
and differed in 176,881,324 of them. It waits for a run of ten now, which is late on purpose and is
not sized to that drift: three patches would still pass in silence. The build updates itself, a line
on every update is a line nobody reads, and what the wait buys is a bound on how far the gap can
grow. Silence at startup means nobody has been nagged yet, not that nothing moved. Work this list on
any bump you care about.

No older build is named anywhere in this file or the README, on purpose: a version that sits in the
prose is one nobody re-reads, and every one of them was wrong by the time anyone looked. State the
fact without the number, the way the paragraph above does.

Run every command below from this file's own directory, `plugins/ultracode-anywhere/`: the
`./hooks/...` specifiers are the plugin's own and resolve to nothing from the repository root. Work
the list in order. Step 2 sets `$BUILD`, which is absolute and survives; step 4 defines `$d` and
`capture` and moves the shell out of this directory for good, so step 5 runs on what step 4 left and
a return to step 1 or step 2 needs a `cd` back.

The build is 202 MB, so the reads below find a fixed string with `/usr/bin/grep -a -b -o` and cut
around its offset. A pattern with a wide `.{n}` context is refused by the stock macOS `grep` above
255 and takes minutes on any `grep`.

Spell it `/usr/bin/grep`, as every recipe below does. A `ugrep` or GNU shim on `PATH` reads PCRE
classes the stock one does not, so a recipe written under a shim can find nothing under the real one
and say so by printing nothing, which reads as a claim that no longer holds. Two recipes here were
already broken that way.

## 1. The names are still in the build

```sh
node -e 'import("./hooks/upstream.mjs").then(m => console.log(m.drift({ cli: m.cliPath() })))'
```

`missing: []` means every string the premise rests on is still there and the gate is still spelled
as flag, call and effort against `"xhigh"`. This is what the session check runs. The gate pattern
accepts the spellings a minifier chooses between, and a build where it reads differently is named
as having dropped the gate, so read it yourself in step 2 before believing either answer.

## 2. The gate is still a conjunct

Step 1 checks the shape mechanically. Read it yourself too, since a regex knows nothing about
meaning:

```sh
BUILD="$(node -e 'import("./hooks/upstream.mjs").then(m=>console.log(m.cliPath()))')"
/usr/bin/grep -a -o -b 'function [A-Za-z_$]*([^)]*){return [^{}]*{[^{}]*}[^}]*"xhigh"[^}]*}' "$BUILD"
```

The inner `{[^{}]*}` is what lets the body carry the `{turnEffort:r}` object it now passes. Without
it the pattern cannot reach past that brace, and the run prints a different function,
`function tw(e){return eu()&&(e===void 0||Ez(e)&&Yye("xhigh",e))}`, which reads as the gate having
been respelled when it has not.

What has to be true: the reminder is emitted only when the resolved effort is `xhigh`, and that
`xhigh` is one conjunct of the condition rather than something the reminder text itself sets. If
the reminder has become the thing that raises effort, this plugin is doing more than it claims and
the README has to change.

On 2.1.270 the command above prints exactly one line,
`167791529:function GC(e,o,n,r){return n===!0&&lu()&&Ew(e,o,{turnEffort:r})==="xhigh"}`.
No name in it moved from the build before. Names have moved between builds, `fC` to `GC`, `eu` to
`lu` and `NA` to `Ew`, which is why the check reads the shape of the code, since names move. The
arguments have moved between builds too: a fourth parameter is threaded through and passed as
`{turnEffort:r}`, so the pattern's old 24-character bound on an argument list was 18 full
with six to spare. It is generous now, and the tight part of the pattern is the three conjuncts and
the comparison, which is where the premise actually lives.

While you are there, the cap:

```sh
for at in $(/usr/bin/grep -a -b -o 'Concurrent subagent limit reached' "$BUILD" | cut -d: -f1); do
  tail -c +$((at - 400)) "$BUILD" | head -c 440; echo; echo ---
done
```

Every hit, since more than one carries that sentence and only one of them is the code: the others
sit in a data section that holds the message text with nothing around it. The one you want shows
whether the same predicate still returns before the refusal, which is what the README says lifts the
cap for native ultracode and not here. On 2.1.270 a second early return sits above it,
`if(H("tengu_amber_kestrel",!1))return`, a flag Anthropic sets: turned on it lifts the cap for
every session on that build, and the README says so.

## 3. The Workflow tool still carries no effort term

The tool is gated on `enableWorkflows`. Read its description in a live session:

```
/context
```

What has to be true: the tool is present at `effortLevel: medium`, and its description still says a
standing ultracode mode counts as the explicit opt-in it otherwise refuses to act without. That
sentence is the fourth marker, and it is the one the whole plugin leans on.

Step 4 answers the same question without a person reading a panel, and answers it about the request
that actually went out, so run that one if you are doing only one of the two.

## 4. The wire-level diff

The strongest check, and the one the claim in the README rests on. Two requests, captured off the
socket, at everything-else-equal.

Nothing leaves the machine: the stand-in below logs the request and answers it itself, so no tokens
are spent and no traffic reaches Anthropic. It is a POSIX shell recipe; on Windows, Git Bash runs it.
Everything it writes goes in one directory `mktemp` made, for the reason A28 moved this plugin's own
state out of the temporary directory: a predictable path there is one another account can create
first, and what lands here is the whole system prompt.

```sh
d=$(mktemp -d)
cat > "$d/capture.mjs" <<'EOF'
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
const [out, portFile] = process.argv.slice(2);
const SSE = [
  ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "capture", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
  ["message_stop", { type: "message_stop" }],
];
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    appendFileSync(out, JSON.stringify({ url: req.url, body: Buffer.concat(chunks).toString("utf8") }) + "\n");
    if (req.url.includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"input_tokens":100}'); }
    if (req.url.includes("/v1/messages")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [event, data] of SSE) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
// Port 0, so the kernel picks one nothing else holds and the run cannot send a
// request carrying its own auth header to whatever owns a number written here.
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
EOF

capture() {                       # capture <file>: start the stand-in, export its address
  rm -f "$d/port"
  node "$d/capture.mjs" "$1" "$d/port" & echo $! > "$d/pid"
  until [ -s "$d/port" ]; do sleep 0.1; done
  export ANTHROPIC_BASE_URL="http://127.0.0.1:$(cat "$d/port")"
}

mkdir -p "$d/wire" && cd "$d/wire"
capture "$d/A.jsonl"
ULTRACODE_ANYWHERE_STATE="$d/state-a" ULTRACODE_ANYWHERE_CAP_NOTICE=0 \
  claude -p ping --strict-mcp-config --effort medium \
  --session-id 11111111-1111-4111-8111-111111111111 --no-session-persistence < /dev/null
kill "$(cat "$d/pid")"
```

Then the other side:

```sh
capture "$d/B.jsonl"
ULTRACODE_ANYWHERE=0 claude -p ping --strict-mcp-config \
  --effort xhigh --settings '{"ultracode":true}' \
  --session-id 11111111-1111-4111-8111-111111111111 --no-session-persistence < /dev/null
kill "$(cat "$d/pid")"
```

Every switch there earns its place. `--strict-mcp-config` and the fixed session id are what make the
two comparable: MCP servers finish connecting at different moments and change the tool count, and the
session id reaches the request inside `metadata.user_id`, which also carries a device id derived from
the config directory. The state directory keeps the probe out of the
counters a real session is keeping, and it is fresh on the side that keeps any, since a second turn of a fixed
session id is owed nothing at all and a rerun over a used one captures no reminder to compare.
`ULTRACODE_ANYWHERE_CAP_NOTICE=0` drops the one-time cap line, which a state directory with no
`.cap-said` in it would otherwise put on the plugin's side and nowhere else. `ULTRACODE_ANYWHERE=0`
on the second run is what keeps the plugin from saying which setting silenced it, which would be a
third difference. Two more it cannot switch off. Move `CALIBRATED_AGAINST` to the installed build
before running this step, or the version line lands on the plugin's side alone and reads as a third
leaf, deterministically, on exactly the builds anybody runs this for. And check your own settings
first: `"ultracode": true`, `"enableWorkflows": false`, `"disableWorkflows": true` or
`CLAUDE_CODE_WORKFLOWS=false` in the user or project file silences the prompt hook, and the two
requests then differ in `output_config.effort` alone, which reads as a confirmation of the claim
this replaced. `--settings '{"ultracode":true}'` is the load-bearing one and the least documented:
it is what produces the native side, and if a build renames that key this step stops working with no
error that says why.

If `claude` refuses to start against `ANTHROPIC_BASE_URL`, give it `ANTHROPIC_API_KEY=stand-in` as
well. The stand-in never looks at the header.

Take the `/v1/messages` body whose model is the main-loop one and whose session id is that one, since
a background agent may hit the same socket, and walk the two objects leaf by leaf rather than
diffing the text: a request is one enormous line per string, so a line diff says two lines differ and
not which fields.

What has to be true: the system prompt is identical and so is every tool definition, the Workflow
tool's description included, with the reminder in the trailing context block either way. On 2.1.270
that holds: same system prompt, and every tool definition byte for byte, this plugin's 3035
characters or the built-in's 308. Most of the difference is the catalogue of shipped workflows,
which the built-in has no equivalent of; `ULTRACODE_ANYWHERE_CATALOGUE=0` takes this side to 1266
and is the fairer comparison of the reminder alone. Run the same-side control first or none of it is
evidence: two side-A runs sharing a `CLAUDE_CONFIG_DIR` differ in zero leaves, and a pair that does
not is a harness artefact before it is a build change.

Those two figures are this plugin's own text and nothing else, which is what `test/standing-
ultracode.test.mjs` holds them to by reading `contextFor(1).length`. Measuring them off the block as
it arrives instead reads high by whatever else answered `UserPromptSubmit` on that machine: a
re-measurement here came back 198 characters over on both, which was another installed hook's
contribution rather than a build change, and the test is what caught it. Count the plugin's text,
then find it inside the block. Where it lands inside that block depends on what else answers
`UserPromptSubmit`, so run both sides from the same directory or another plugin's hook moves with
you.

They differ in three places on this build, not two. The reminder text and `output_config.effort` are
the two the plugin is about. The third is the native side's alone: `"ultracode": true` also injects
the whole `workflow-authoring` skill into the user message, a command block of 136 characters and a
body of about 17,000, and appends a newline to the prompt. The body is a template the build fills in
at send time, so the exact figure moves with what it interpolates as well as with the build, and the
count is only comparable across builds where the next reader counts it the same way: summing the
template's own chunks and skipping its nine balanced `${...}` slots, 2.1.270's string is 16,588
characters before interpolation, the same as the build before by this method, and the body that
actually goes out is 16,966. A count of 16,930 recorded here earlier did not reproduce by this method
on either build, so it has been dropped. Earlier builds were
counted here without the method being written down, so those figures are not comparable with these
and have been dropped rather than carried forward. The effort level is not what does it, which two
control runs settle: against a plain `--effort xhigh` with no `ultracode` key, the two sides differ
in the reminder and the effort and nowhere else. It is not new to this build either, since an earlier
one does the same. Nothing this plugin can write reaches a skill load, so this is a difference it
cannot close, and the README says so rather than claiming a two-leaf diff it no longer has.

A further leaf is not a finding until it repeats. Some tool definitions sit behind remote flags whose
value differs between two launches minutes apart, and one pair here came back with `ScheduleWakeup`
carrying a `noop` parameter on the second side and not the first, description and schema both, on a
pair otherwise identical. Nothing this plugin does can reach a tool definition. Run each side twice
and count only a leaf that differs both times. Then say which in the README rather than leaving the
claim standing.

Two differences are the harness rather than the build, and a fresh `CLAUDE_CONFIG_DIR` per side is
what produces both: `metadata.user_id` carries a device id derived from that directory, and `system[2]`
carries the transcript path. Share one config directory between the two sides and they collapse.
A same-side control run, twice through one side, is what tells a harness artifact from a real
difference.

## 5. The prompt payload carries `source`, or does not yet

The wakeup skip reads `source` off the `UserPromptSubmit` payload. The schema declares the field and
2.1.270 does not send it outside Anthropic. Ask the hook itself what it was handed, which beats
reading the builder:

```sh
capture "$d/probe.jsonl"
ULTRACODE_ANYWHERE_DEBUG="$d/hook.log" ULTRACODE_ANYWHERE_STATE="$d/hook-state" \
  claude -p ping --strict-mcp-config --no-session-persistence < /dev/null
kill "$(cat "$d/pid")"
cat "$d/hook.log"
```

On 2.1.270 the payload holds `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`hook_event_name` and `prompt`, and no `source`. The literal carries `session_title` as well, which a
named session sends and an unnamed one does not, and the `source` enum has grown to `user`, `sdk`,
`system`, `loop_wakeup`, `schedule_wakeup` and `poll_event`. Only the last four are turns to skip.

The stand-in from step 4 is what keeps this probe from spending a real turn on the real API, and the
state directory keeps it out of the counters a real session is keeping.

The builder says the same thing, if you would rather read it than run it:

```sh
for at in $(/usr/bin/grep -a -b -o 'hook_event_name:"UserPromptSubmit",prompt' "$BUILD" | cut -d: -f1); do
  tail -c +$((at - 40)) "$BUILD" | head -c 200; echo
done
```

What has to be true for the skip to work: the object literal carries `source:` where 2.1.270 spells
`...!1`.

While you are in that schema, the effort field beside it. The build hands a hook `effort`, and a
`CLAUDE_EFFORT` variable with it, only for one that fires inside a tool-use context, and says so:
"Present for hooks that fire within a tool-use context (PreToolUse, PostToolUse, Stop, SubagentStop,
etc.) ...; absent for session-lifecycle hooks". Both hooks here are the second kind, which is why the
reminder names a level and never a direction. A probe that finds `CLAUDE_EFFORT` set is reading the
environment of the session that launched it, not the session the hook belongs to: strip it and run
again. The day a `UserPromptSubmit` payload carries `effort`, the hook can read the session's own
level, and `loweredTo` in `hooks/standing-ultracode.mjs` can say which direction it is going. Until it does, the README says a wakeup is a turn like any other; the day it does, move
that sentence.

## 6. The reminder re-enters after a compaction

```sh
at=$(/usr/bin/grep -a -b -o 'ultra_effort_enter"){[a-zA-Z_$]*="enter"' "$BUILD" | head -1 | cut -d: -f1)
tail -c +$((at - 900)) "$BUILD" | head -c 2000; echo
```

The identifier is a class, not a name: this recipe pinned `n="enter"` and found nothing the moment the
minifier chose `o`. It exits 1 and prints nothing, and `tail` then dies on an empty offset, which is
the loudest this failure gets.

What has to be true: the function walks the messages back to the last `ultra_effort_enter` or
`ultra_effort_exit` attachment, sends the whole text when it finds none, and the sparse line once
`TURNS_BETWEEN_MAINTENANCE` user turns have passed. A compaction leaves no attachment to find, which
is why the `SessionStart` hook starts the counter over on `compact` and `clear`.

On 2.1.270 the turns it counts are user messages that are neither meta nor a tool result, which is
the same set of turns a prompt hook fires on: a tool result never fires one. The constant is still
10, but the chain is four steps now rather than three: `CLAUDE_CODE_JUNIPER_SUNDIAL`, then a
gate-config read of `tengu_juniper_sundial`, then the flag of that name, then
`TURNS_BETWEEN_MAINTENANCE`.

## 7. A workflow stage still has no effort but the one a script passes

`ULTRACODE_ANYWHERE_STAGE_EFFORT` exists because `opts.effort` is the only lever a caller has on a
workflow stage, and the reminder says so in as many words. Three things have to hold, and a build
where any one of them moves is a build where that sentence is wrong.

```sh
/usr/bin/grep -a -o -b 'kind:"effort"' "$BUILD"
/usr/bin/grep -a -o -b 'agentType:"workflow-subagent"' "$BUILD" | head -1
```

Take the offset from each and read around it with `tail -c +$((at - 400)) "$BUILD" | head -c 900`.

What has to be true:

- The spawn builder pushes a `{kind:"effort"}` permission layer **only** where the agent definition
  carries an `effort` of its own, and the resolver falls through to the parent's own state when
  there is no such layer. One minifier's spelling of that is
  `[{kind:"model",mainLoopModel:...},...e.effort!==void 0?[{kind:"effort",effort:e.effort}]:[]]`,
  and what matters is the ternary rather than the names.
- The `workflow-subagent` definition carries neither `effort` nor `model`, and nothing registers it,
  so no `.claude/agents/*.md` can shadow it the way one can shadow `general-purpose`. It is the
  definition a stage gets when the script names no `agentType`; a script that names one resolves a
  registered definition instead, and an `effort:` in that file's frontmatter then sets the stage's
  level. `opts.effort` still wins where both are present, which is why the reminder's instruction
  holds either way and only its reason narrows.
- The Agent tool's own input schema still has no `effort` parameter. Read it in a live session with
  `/context`, or off the wire in step 4's capture. This is the half the reminder asserts, and it
  asserts the argument and not the level: an agent definition file carries `effort:` and always
  could.

If the first moves, a session can set a stage's effort without the reminder and this switch is
redundant. If the second moves, an agent file can carry it and the README should say so. If the
third moves, drop the sentence about the Agent tool from `loweredTo` in
`hooks/standing-ultracode.mjs`.

Two things `opts.effort` takes that this switch does not, both worth re-reading when the level list
moves. `med` is an alias for `medium` there, and an integer is accepted by the validator and then
does not reach the wire at all: the request goes out with no `output_config`, so a stage handed one
runs at whatever the session was on. That is the second reason the switch takes the five names only,
and the day the integer starts working is the day to reopen the question. `--effort ultracode` is
accepted by the flag and not by `opts.effort`; the two take different vocabularies and are worth
reading apart.

`CLAUDE_CODE_SUBAGENT_MODEL` is the model half of the same question and needs no plugin: it is a
real subagent-only seam that reaches workflow stages too, and the README names it. The README also
names the settings route to a subagent's effort, `modelSettings` keyed by the model a spawn resolves
to, and its three conditions. All three are why it is worth knowing about rather than using, and
none of them is checked by any case here, so re-read them:

```sh
/usr/bin/grep -a -o 'effortLevel:[A-Za-z_$][A-Za-z0-9_$]*(\["low","medium","high","xhigh"\])' "$BUILD" | head
/usr/bin/grep -a -o -b 'modelSettings' "$BUILD" | head -3
/usr/bin/grep -a -o -b 'sessionEffort' "$BUILD" | head -3
```

Character classes here are POSIX, not PCRE: `[\w$]` inside brackets is the literal set backslash, w
and dollar, so a pattern spelling it that way finds nothing and says so by printing nothing, which
reads as a claim that no longer holds. Spell the class out. The first pattern is the only one of the
three that checks a claim rather than an identifier's presence; take the offsets from the other two
and read around them the way step 2 does.

What has to be true for the README's three conditions to hold: the per-model row is keyed by the
model a spawn resolves to rather than by who is spawning, so with no model split it reaches the main
loop as well; its validator takes the four names above where `opts.effort` takes five; and a level
pinned by `--effort` or `/effort` lands in `sessionEffort` and is read in front of the per-model row,
so the route is dead in any session that pinned one.

Step 4's capture is what settles all three, and the integer claim above with them. Run one side with
`--settings '{"effortLevel":"high","modelSettings":{"<model>":{"effortLevel":"low"}}}'` and
`CLAUDE_CODE_SUBAGENT_MODEL` set, point the stand-in's reply at an `Agent` or a `Workflow` tool call
so a subagent actually spawns, and read `output_config.effort` off the subagent's own request rather
than the main loop's.

## 8. The half that ships: workflows and agent types

The plugin ships `workflows/*.js` and `agents/*.md`, and both load through contracts nothing in the
code can check for itself. Each fact below is one the feature stops working without, silently.

### A plugin's own `workflows/` is loaded, and under the name this plugin advertises

```sh
/usr/bin/grep -a -o 'if(.\{1,4\})[A-Za-z_$]*\.workflowsPath=[A-Za-z_$]*(e,"workflows")' "$BUILD"
/usr/bin/grep -a -o 'let [A-Za-z_$]*=`\${[A-Za-z_$]*}:\${[A-Za-z_$]*.meta.name}`' "$BUILD"
```

What has to be true: the loader still builds a path from the plugin's own `workflows` directory, and
the workflow module still registers each file under `<plugin>:<meta.name>`. A build that dropped the
namespacing would resolve these under a bare name and every catalogue entry would answer "not found".

The live check is cheaper and settles it whole:

```sh
mkdir -p /tmp/uc-logs        # without it the build writes a FILE at that path and the glob below matches nothing
CLAUDE_CODE_DEBUG_LOGS_DIR=/tmp/uc-logs claude --debug \
  --plugin-dir "$(git rev-parse --show-toplevel)/plugins/ultracode-anywhere" \
  -p "Reply with the single word: ok" >/dev/null 2>&1
/usr/bin/grep -h 'workflows from plugin\|agents from plugin' /tmp/uc-logs/*.txt
```

On 2.1.270 that prints `Loaded 3 workflows from plugin ultracode-anywhere default directory` and
`Loaded 4 agents from plugin ultracode-anywhere default directory`. A count that dropped is a file
the loader skipped, and it skips in silence.

Then ask the tool itself what it can resolve. The failure path is the only place a workflow name
reaches the model, which makes it the cheapest listing there is:

```sh
claude --plugin-dir "$(git rev-parse --show-toplevel)/plugins/ultracode-anywhere" \
  -p "Call the Workflow tool once with name 'ultracode-anywhere:does-not-exist' and print its error verbatim. Call nothing else."
```

Every shipped name has to appear after `Available:`. On 2.1.270 the answer is
`deep-research, ultracode-anywhere:hunt, ultracode-anywhere:review, ultracode-anywhere:understand`.

### Only `.js` is read

```sh
/usr/bin/grep -a -o 'if(/\\.(mjs|cjs|ts)\$/.test([A-Za-z_$.]*))[A-Za-z_$.]*++' "$BUILD" | head
```

The loader recognises the other three extensions and skips them. That is why these files are the one
exception to `.mjs` everywhere else in this repository. A build that started reading `.mjs` would not
break anything; a build that stopped reading `.js` would break all three, and `npm run lint:workflows`
cannot see it.

### The sandbox still injects eleven names and no more

```sh
/usr/bin/grep -a -o 'for(let\[[A-Za-z_$]*,[A-Za-z_$]*\]of\[\["agent"' "$BUILD" | head -2
/usr/bin/grep -a -c 'Math.random() is unavailable in workflow scripts' "$BUILD"
```

What has to be true: the context is built from `log`, `phase`, `console`, `budget`, `setTimeout` and
`clearTimeout`, with `agent`, `parallel`, `pipeline` and `workflow` defined onto it and `args` parsed
in. `scripts/workflow-lint.mjs` holds every shipped script to exactly that list, and a name added
upstream is a name the lint refuses until somebody adds it here. `test/workflow-lint.test.mjs` states
the eleven rather than reading them off the module, so the list is a claim about the build and not
about itself.

### A plugin agent's `effort:` is honoured

This is the whole reason the shipped workflows pass no `opts.effort`.

```sh
/usr/bin/grep -a -o "has invalid effort '\${[A-Za-z_$]*}'" "$BUILD"
/usr/bin/grep -a -o 'for(let [A-Za-z_$]* of\["permissionMode","hooks","mcpServers"\])' "$BUILD"
```

The first is the build reading the key: on 2.1.270 it sits at offset 171,151,186, inside
`Je=M.effort,et=Je!==void 0?N0(Je):void 0`, which reads `effort` off a plugin agent's frontmatter and
complains where it will not parse. A build that stopped reading it would lose that message. The
second prints the three keys a plugin agent may not set; everything else in the frontmatter is read.

Then check the type resolves at all, which is one spawn:

```sh
claude --plugin-dir "$(git rev-parse --show-toplevel)/plugins/ultracode-anywhere" \
  -p "Use the Agent tool once with subagent_type 'ultracode-anywhere:verifier' and the prompt 'Answer with the single word: resolved'. Print only what it returned."
```

An agent type that does not resolve answers with the list of the ones that do.

Those two establish that the key is read and that the type resolves. Neither reads the level back:
the resolved effort is visible only on the wire, and `--debug` will not do instead, since the debug
log carries no effort field. That was checked on an earlier build, where the word appeared only inside
this plugin's own reminder text, echoed into the log with the rest of the prompt. So read it off the
socket, with step 4's stand-in answering the first request with a `Workflow` tool call so a real run
happens:

```sh
# in the stand-in from step 4, answer by who is asking:
#   the main loop         -> a tool_use for Workflow, {name: 'ultracode-anywhere:review', args: 'one small file'}
#   a "named assignment"  -> a tool_use for StructuredOutput carrying one finding, so the run reaches Verify
#   a "refute one claim"  -> a tool_use for StructuredOutput, {refuted: false, verdict: 'holds'}
#   anything else         -> plain text
capture "$d/stages.jsonl"
claude -p "run it" --strict-mcp-config --effort high --dangerously-skip-permissions \
  --plugin-dir "$(git rev-parse --show-toplevel)/plugins/ultracode-anywhere" \
  --session-id 77777777-7777-4777-8777-777777777777 --no-session-persistence < /dev/null
```

`--dangerously-skip-permissions` is load-bearing here and only here: without it the run's own safety
monitor answers the Workflow call and no stage is ever spawned, so the capture holds two monitor
requests and looks like a workflow that did nothing. The session runs at `high` on purpose, so a
stage carrying `medium` can only have got it from its agent file.

On 2.1.270, grouping the captured requests by their system prompt:

```
  6 x  finder stage      (agents/finder.md says effort: medium)  ->  effort="medium"
  3 x  verifier stage    (agents/verifier.md names none)         ->  effort="high"
  1 x  synthesist stage  (agents/synthesist.md names none)       ->  effort="high"
  3 x  main loop         (--effort high)                         ->  effort="high"
```

Four groups rather than three: the synthesist has a system prompt of its own, and an earlier reading
folded its one request into the main loop's count.

That is the whole claim, read off the socket: the agent file sets the level for the stages that
fan out, and the stage that checks another stage's work runs at the session's level because its file
names none. A build that stopped honouring the frontmatter would show `high` on all nine.

### The catalogue is still the only listing

```sh
/usr/bin/grep -a -c 'Available workflows' "$BUILD"
/usr/bin/grep -a -o 'function [A-Za-z_$]*(){return}' "$BUILD" | head -3
```

The first is 0 and has to stay 0 for the catalogue to be worth its characters: the day Claude Code
lists a plugin's workflows to the model, `ULTRACODE_ANYWHERE_CATALOGUE=0` becomes the sensible
default and the README's cost section is wrong. The second is the stub that would carry such a
listing if it ever stopped being a stub.

## 9. The spawn hold still holds

The hold reads more of the build than the reminder does, so its own check is worked whole on every
re-check. Run it from this directory against a copy of a configuration whose `settings.json` holds
the hold's settings in its `"env"`. From a terminal the check reads that `env` the way a session
would, and it wins over the same variables set on the command line:

```sh
CLAUDE_CONFIG_DIR=/path/to/copy ULTRACODE_ANYWHERE_STATE=/path/to/state \
node hooks/hold-upkeep.mjs --verify
```

It writes copies and shadows into the configuration it runs against and records what it found beside
the turn counters, so point `CLAUDE_CONFIG_DIR` and `ULTRACODE_ANYWHERE_STATE` at a copy where the real
ones should stay as they are. To check a checkout, point that copy's
`plugins/installed_plugins.json` entry for this plugin at it. `self-check passed on` the build means
every probe reached the stand-in and none saw a spawn off the level. Read `details` in the record
anyway: a probe listed as skipped proved nothing.

Each probe rests on something the build does, and a probe reported as unable to finish usually means
one of these moved:

- The Agent tool's listing opens `Available agent types for the Agent tool` with one
  `- type: description (Tools: ...)` line per type. The capture reads the built-in types off it.
- A subagent's system prompt ends before `Messages from the agent that launched you`. The shadow keeps
  what comes before it.
- A subagent's request carries `cc_is_subagent=true` in its billing header and its level in
  `output_config.effort`.
- A `PreToolUse` payload carries `effort.level`, and a subagent's carries `agent_id`. The tripwire
  reads both.
- A subagent's transcript sits under its session's transcript directory, where the tripwire reads the
  model off its last assistant line.
- A hook's environment carries `CLAUDE_PID`, and `/clear` gives the same process a new session id. The
  hold keeps what a session loaded under the process.
- A hook's environment carries `CLAUDE_PROJECT_DIR` and the Bash tool's does not, which is why the
  exports name the session's project in `ULTRACODE_ANYWHERE_PROJECT_DIR` for the shim and the preload.
- `CLAUDE_CODE_SIMPLE` and `CLAUDE_CODE_SAFE_MODE` still stand for `--bare` and `--safe-mode`.
- `CLAUDE_ENV_FILE` reaches a plugin's `SessionStart` hook, and a plugin agent may not set
  `permissionMode`, `hooks` or `mcpServers`, which is why a copy of one leaves them out.
- `CLAUDE_CODE_EFFORT_LEVEL`, in the environment or a settings `env`, outranks an agent's `effort:`,
  and `maxEffortLevel` caps it. Either one off the level refuses every spawn.
- A `--settings` value's `env` outranks a project's settings `env`, which is why the shim hands the
  held level there as well as in the environment.
- A reply the build makes itself is recorded under a bracketed model name, `<synthetic>` on this
  build, which the tripwire reads past.
- A session's project folder is its directory with every character but a letter or a digit made a
  hyphen, and a name past 200 characters is cut there with a base-36 hash of the path after it.
  `projectFolderName` in `hooks/hold-check.mjs` names a probe's folder that way to remove it.
- A managed policy's settings are `managed-settings.json` and the files in `managed-settings.d/` under
  `/Library/Application Support/ClaudeCode` on macOS, `C:\Program Files\ClaudeCode` on Windows and
  `/etc/claude-code` elsewhere. `routedAway` in `hooks/hold-check.mjs` reads their `env` too.

## 10. What a re-check changes

- `CALIBRATED_AGAINST` in `hooks/upstream.mjs`, and every build named in this file and the README.
  Move it before step 4 rather than after, since the session line it silences would otherwise show up
  in the capture as a difference this plugin did not make.
- `MARKERS` there, if a string moved and the premise still holds under a new spelling.
- `GATE` there, if the predicate is spelled in a way the pattern does not accept and still reads as
  flag, call, effort against `"xhigh"`. Add the build's own spelling to the case in
  `test/upstream.test.mjs` that lists them, so the next respelling has something to be compared to.
- `EFFORT_LEVELS` in `hooks/effort.mjs`, if a level was renamed, added or dropped. A rename costs a
  user their `ULTRACODE_ANYWHERE_STAGE_EFFORT` in silence, so `test/effort.test.mjs` reads the five
  out of whatever build is installed and skips where there is none. Read them yourself with
  `/usr/bin/grep -a -o '\["low","medium","high","xhigh","max"\]' "$BUILD"`, and read `--effort`'s own
  validator beside it: the tool takes an integer effort as well, and this switch deliberately does
  not.
- `WAKEUP_SOURCES` in `hooks/standing-ultracode.mjs`, if the `source` enum moved.
- `INJECTED` in `scripts/workflow-lint.mjs`, if the sandbox began injecting a name or stopped
  injecting one. A name it is missing is a shipped workflow that fails on the line that reaches it;
  a name it holds that the sandbox does not is a lint that passes a script nobody can run. Step 8
  has the greps, and `test/workflow-lint.test.mjs` states the eleven rather than reading them off
  the module.
- `RESOLVABLE` in `hooks/catalogue.mjs`, if the class of names the tool resolves widened. It is
  deliberately narrower than whatever the build accepts, since the sentence quotes a name inside
  backticks and hands it back as the tool's `name`.
- The README, if any claim in it is no longer what the diff shows: the site count, the character
  counts, the bundle size and the timing figures are all measurements of one build on one machine.
- The cadence in `FULL_EVERY`, if `TURNS_BETWEEN_MAINTENANCE` moved.
- `PROMPT_END` and `listingEntries` in `hooks/hold-upkeep.mjs`, if the listing or the end of a
  subagent's prompt moved.
- `SESSION_NAMES` and `SESSION_PREFIXES` in `hooks/hold-check.mjs`, if a session sets a new variable
  for what it starts. A probe that inherits one runs as a child of the session that ran the check.
- `HOOKS_OFF` in `hooks/hold-shim.mjs`, if another variable turns the hooks off, and `REDIRECTS` in
  `hooks/hold-switch.mjs`, if another one moves where the settings are read or names the build.
- `PASS_THROUGH`, `DAEMON` and `CLOUD` in `hooks/hold-shim.mjs`, if a subcommand or flag was added
  that starts no session, starts one through a daemon, or starts one in the cloud. `FORCED` and
  `AGENT_FLAGS` there, if a flag was added that sets the model, the effort or the agents, and
  `REFUSED_SETTINGS`, if a settings key was added that decides any of those or the hooks, and
  `LAUNCHERS`, if a Windows install puts another launcher script on PATH.
- `SPAWN_TOOLS` in `hooks/hold.mjs`, if a tool that starts a spawn or a cloud session was added or
  renamed, and `ROUTINE_READS` in `hooks/hold-rules.mjs`, if `RemoteTrigger` gained an action.
- `EFFORT_WORDS` and `REVIEW_FLAGS` in `hooks/hold-rules.mjs`, if the bundled review reads its effort
  word or drops its flags another way.
- `UNLISTED_FIELDS` in `hooks/hold-agents.mjs`, if a built-in carries frontmatter the listing does not
  show, and `DEFAULT_BUILT_IN` there, if the built-in types a session has before any capture moved.
- `WAIT_MS` in `hooks/hold-tripwire.mjs`, if a subagent's transcript is written later than it was.

If the premise no longer holds at all, the honest change is to remove the plugin from the
marketplace rather than to loosen the check until it passes.
