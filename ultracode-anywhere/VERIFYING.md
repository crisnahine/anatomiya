# Re-checking this against a build

This plugin has no API to hold Claude Code to. It restates a system-reminder whose id, cadence and
opt-in contract were read out of one build, so the only thing that keeps it honest is redoing that
reading. The `SessionStart` check does the cheap half on every session; this is the half a person
does, and it takes a few minutes.

It was last done against **2.1.238**, which is the version `CALIBRATED_AGAINST` in
`hooks/upstream.mjs` names. Move that string when you have worked this list on a newer build.

## 1. The names are still in the build

```sh
node -e 'import("./hooks/upstream.mjs").then(m => console.log(m.drift({ cli: m.cliPath() })))'
```

`missing: []` means every string the premise rests on is still there. This is what the session
check runs. It proves the names survived, not that the gate around them still reads the same way.

## 2. The gate is still a conjunct

Find the predicate in the build and read it:

```sh
strings "$(node -e 'import("./hooks/upstream.mjs").then(m=>console.log(m.cliPath()))')" \
  | grep -n 'ultra_effort_enter' | head
```

What has to be true: the reminder is emitted only when the resolved effort is `xhigh`, and that
`xhigh` is one conjunct of the condition rather than something the reminder text itself sets. If
the reminder has become the thing that raises effort, this plugin is doing more than it claims and
the README has to change.

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

## 5. What a re-check changes

- `CALIBRATED_AGAINST` in `hooks/upstream.mjs`, and the version in this file.
- `MARKERS` there, if a string moved and the premise still holds under a new spelling.
- The README, if any claim in it is no longer what the diff shows: the site count, the character
  counts, and the timing figures are all measurements of one build on one machine.
- The cadence in `FULL_EVERY`, if `TURNS_BETWEEN_MAINTENANCE` moved.

If the premise no longer holds at all, the honest change is to remove the plugin from the
marketplace rather than to loosen the check until it passes.
