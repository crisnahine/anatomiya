# Re-checking this against a build

This plugin has no API to hold Claude Code to. It restates a system-reminder whose id, cadence and
opt-in contract were read out of one build, so the only thing that keeps it honest is redoing that
reading. The `SessionStart` check does the cheap half on every session; this is the half a person
does, and it takes a few minutes.

It was last done against **2.1.238**, which is the version `CALIBRATED_AGAINST` in
`hooks/upstream.mjs` names. Move that string when you have worked this list on a newer build.

Sections 1, 2, 5 and 6 were re-read against **2.1.240** on 2026-08-23 and hold: the four markers and
the gate shape are there, the `UserPromptSubmit` payload still spells `...!1` where `source:` would
go, and the reminder still walks back to the last attachment. Sections 3 and 4 were not: they need a
live session and a recorded request, which no command here can stand in for. `CALIBRATED_AGAINST`
stays at 2.1.238 because it names a list worked whole, and `behind` reads major and minor only, so a
patch bump raises nothing either way.

Run every command below from this file's own directory, `plugins/ultracode-anywhere/`: the
`./hooks/...` specifiers are the plugin's own and resolve to nothing from the repository root.

The build is 321 MB, so the reads below find a fixed string with `grep -a -b -o` and cut around
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

While you are there, the cap:

```sh
at=$(grep -a -b -o 'Concurrent subagent limit reached' "$BUILD" | head -1 | cut -d: -f1)
tail -c +$((at - 300)) "$BUILD" | head -c 340; echo
```

It shows whether the same predicate still returns before the refusal, which is what the README says
lifts the cap for native ultracode and not here.

## 3. The Workflow tool still carries no effort term

The tool is gated on `enableWorkflows`. Read its description in a live session:

```
/context
```

What has to be true: the tool is present at `effortLevel: medium`, and its description still says a
standing ultracode mode counts as the explicit opt-in it otherwise refuses to act without. That
sentence is the fourth marker, and it is the one the whole plugin leans on.

## 4. The wire-level diff

The strongest check, and the one that produced the claim in the README. Record one request at
`ultracode: true` with the effort resolving to xhigh, and one at `effortLevel: medium` with this
plugin installed. Diff them.

What has to be true: the two differ only in the session id and `output_config.effort`. Same system
prompt, same tool definitions, same Workflow tool description. If a third line differs, say which
one in the README rather than leaving the claim standing.

## 5. The prompt payload carries `source`, or does not yet

The wakeup skip reads `source` off the `UserPromptSubmit` payload. The schema declares it and 2.1.238
does not send it outside Anthropic:

```sh
for at in $(grep -a -b -o 'hook_event_name:"UserPromptSubmit",prompt' "$BUILD" | cut -d: -f1); do
  tail -c +$((at - 40)) "$BUILD" | head -c 200; echo
done
```

What has to be true for the skip to work: the object literal carries `source:` where 2.1.238 spells
`...!1`. Until it does, the README says a wakeup is a turn like any other; the day it does, move
that sentence.

## 6. The reminder re-enters after a compaction

```sh
at=$(grep -a -b -o 'ultra_effort_enter"){n="enter"' "$BUILD" | head -1 | cut -d: -f1)
tail -c +$((at - 130)) "$BUILD" | head -c 760; echo
```

What has to be true: the function walks the messages back to the last `ultra_effort_enter` or
`ultra_effort_exit` attachment, sends the whole text when it finds none, and the sparse line once
`TURNS_BETWEEN_MAINTENANCE` user turns have passed. A compaction leaves no attachment to find, which
is why the `SessionStart` hook starts the counter over on `compact` and `clear`.

## 7. What a re-check changes

- `CALIBRATED_AGAINST` in `hooks/upstream.mjs`, and the version in this file.
- `MARKERS` there, if a string moved and the premise still holds under a new spelling.
- `GATE` there, if the predicate is spelled in a way the pattern does not accept and still reads as
  flag, call, effort against `"xhigh"`.
- `WAKEUP_SOURCES` in `hooks/standing-ultracode.mjs`, if the `source` enum moved.
- The README, if any claim in it is no longer what the diff shows: the site count, the character
  counts, and the timing figures are all measurements of one build on one machine.
- The cadence in `FULL_EVERY`, if `TURNS_BETWEEN_MAINTENANCE` moved.

If the premise no longer holds at all, the honest change is to remove the plugin from the
marketplace rather than to loosen the check until it passes.
