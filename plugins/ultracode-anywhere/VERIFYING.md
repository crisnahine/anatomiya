# Re-checking this against a build

This plugin has no API to hold Claude Code to. It restates a system-reminder whose id, cadence and
opt-in contract were read out of one build, so the only thing that keeps it honest is redoing that
reading. The `SessionStart` check does the cheap half on every session; this is the half a person
does, and it takes a few minutes.

It was last worked whole against **2.1.241**, on 2026-08-24, which is the version
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

The build is 325 MB, so the reads below find a fixed string with `grep -a -b -o` and cut around
its offset. A pattern with a wide `.{n}` context is refused by the stock macOS `grep` above 255 and
takes minutes on any `grep`.

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
grep -a -o 'function [A-Za-z_$]*([^)]*){return [^}]*"xhigh"[^}]*}' "$BUILD" | head
```

What has to be true: the reminder is emitted only when the resolved effort is `xhigh`, and that
`xhigh` is one conjunct of the condition rather than something the reminder text itself sets. If
the reminder has become the thing that raises effort, this plugin is doing more than it claims and
the README has to change.

On 2.1.241 it reads `function Ale(e,t,r){return r===!0&&gH()&&kQ(e,t)==="xhigh"}`. Every name in it
moved from the build this was first read off, which is why the check reads a shape.

While you are there, the cap:

```sh
for at in $(grep -a -b -o 'Concurrent subagent limit reached' "$BUILD" | cut -d: -f1); do
  tail -c +$((at - 400)) "$BUILD" | head -c 440; echo; echo ---
done
```

Every hit, since more than one carries that sentence and only one of them is the code: the others
sit in a data section that holds the message text with nothing around it. The one you want shows
whether the same predicate still returns before the refusal, which is what the README says lifts the
cap for native ultracode and not here. On 2.1.241 a second early return sits above it,
`if(nt("tengu_amber_kestrel",!1))return`, a flag Anthropic sets: turned on it lifts the cap for
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
session id reaches the request in `metadata.user_id`. The state directory keeps the probe out of the
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

What has to be true: they differ in the reminder text and in `output_config.effort`, and nowhere
else. On 2.1.241 that is what they do: same system prompt, same 25 tool definitions, the Workflow
tool's description included, with the reminder in the trailing context block either way, this
plugin's 1266 characters or the built-in's 288. Where it lands inside that block depends on what else
answers `UserPromptSubmit`, so run both sides from the same directory or another plugin's hook moves
with you.

A third leaf is not a finding until it repeats. Some tool definitions sit behind remote flags whose
value differs between two launches minutes apart, and one pair here came back with `ScheduleWakeup`
carrying a `noop` parameter on the second side and not the first, description and schema both, on a
pair otherwise identical. Nothing this plugin does can reach a tool definition. Run each side twice
and count only a leaf that differs both times. Then say which in the README rather than leaving the
claim standing.

## 5. The prompt payload carries `source`, or does not yet

The wakeup skip reads `source` off the `UserPromptSubmit` payload. The schema declares the field and
2.1.241 does not send it outside Anthropic. Ask the hook itself what it was handed, which beats
reading the builder:

```sh
capture "$d/probe.jsonl"
ULTRACODE_ANYWHERE_DEBUG="$d/hook.log" ULTRACODE_ANYWHERE_STATE="$d/hook-state" \
  claude -p ping --strict-mcp-config --no-session-persistence < /dev/null
kill "$(cat "$d/pid")"
cat "$d/hook.log"
```

On 2.1.241 the payload holds `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`hook_event_name` and `prompt`, and no `source`. The stand-in from step 4 is what keeps this probe
from spending a real turn on the real API, and the state directory keeps it out of the counters a
real session is keeping.

The builder says the same thing, if you would rather read it than run it:

```sh
for at in $(grep -a -b -o 'hook_event_name:"UserPromptSubmit",prompt' "$BUILD" | cut -d: -f1); do
  tail -c +$((at - 40)) "$BUILD" | head -c 200; echo
done
```

What has to be true for the skip to work: the object literal carries `source:` where 2.1.241 spells
`...!1`. Until it does, the README says a wakeup is a turn like any other; the day it does, move
that sentence.

## 6. The reminder re-enters after a compaction

```sh
at=$(grep -a -b -o 'ultra_effort_enter"){n="enter"' "$BUILD" | head -1 | cut -d: -f1)
tail -c +$((at - 400)) "$BUILD" | head -c 1000; echo
```

What has to be true: the function walks the messages back to the last `ultra_effort_enter` or
`ultra_effort_exit` attachment, sends the whole text when it finds none, and the sparse line once
`TURNS_BETWEEN_MAINTENANCE` user turns have passed. A compaction leaves no attachment to find, which
is why the `SessionStart` hook starts the counter over on `compact` and `clear`.

On 2.1.241 the turns it counts are user messages that are neither meta nor a tool result, which is
the same set of turns a prompt hook fires on: a tool result never fires one. The constant is still
10, through `CLAUDE_CODE_JUNIPER_SUNDIAL`, then the `tengu_juniper_sundial` flag, then
`TURNS_BETWEEN_MAINTENANCE`.

## 7. A workflow stage still has no effort but the one a script passes

`ULTRACODE_ANYWHERE_STAGE_EFFORT` exists because `opts.effort` is the only lever a caller has on a
workflow stage, and the reminder says so in as many words. Three things have to hold, and a build
where any one of them moves is a build where that sentence is wrong.

```sh
grep -a -o -b 'kind:"effort"' "$BUILD"
grep -a -o -b 'agentType:"workflow-subagent"' "$BUILD" | head -1
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
grep -a -o 'effortLevel:[A-Za-z_$][A-Za-z0-9_$]*(\["low","medium","high","xhigh"\])' "$BUILD" | head
grep -a -o -b 'modelSettings' "$BUILD" | head -3
grep -a -o -b 'sessionEffort' "$BUILD" | head -3
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

## 8. What a re-check changes

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
  `grep -a -o '\["low","medium","high","xhigh","max"\]' "$BUILD"`, and read `--effort`'s own
  validator beside it: the tool takes an integer effort as well, and this switch deliberately does
  not.
- `WAKEUP_SOURCES` in `hooks/standing-ultracode.mjs`, if the `source` enum moved.
- The README, if any claim in it is no longer what the diff shows: the site count, the character
  counts, the bundle size and the timing figures are all measurements of one build on one machine.
- The cadence in `FULL_EVERY`, if `TURNS_BETWEEN_MAINTENANCE` moved.

If the premise no longer holds at all, the honest change is to remove the plugin from the
marketplace rather than to loosen the check until it passes.
