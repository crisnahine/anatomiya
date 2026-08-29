# Changelog

All notable changes to `ultracode-anywhere` are documented here. It shares a repository with
`anatomiya` and nothing else, so it moves on its own version and this file is its own. Releases are
tagged `ultracode-anywhere-vx.y.z`; anatomiya's bare `vx.y.z` tags do not carry this plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ULTRACODE_ANYWHERE_STAGE_EFFORT=<level>` names the level the fan-out should run at: the reminder
  then asks for `opts.effort` at that level on every workflow stage, and for it to be left out of a
  stage checking or judging another stage's work, which is what makes that one run at the session's
  level. `opts.effort` is the only lever a
  caller has on a stage, since the built-in definition a stage gets carries no effort and the Agent
  tool takes no effort argument, so a session wanting its fan-out cheaper than its main loop has
  nothing but the reminder text to say it with. Unset, the text is the one-level paragraph it always
  was: leave `opts.effort` alone. The levels are `low`, `medium`, `high`, `xhigh` and `max`, read past case and
  surrounding spaces, and the answer put into the text is the list's own spelling rather than what
  the variable held. The text names a level and not a direction, because `--effort` and `/effort`
  write nothing to `settings.json` and the hook cannot read the session's own level to say which way
  it points. A30, A43 and now A47.
- A session opens with a line naming a `ULTRACODE_ANYWHERE_STAGE_EFFORT` that is not a level, and
  what the levels are. An unreadable cadence costs a refresher its place and says nothing; this one
  costs a session the whole saving it was turned on for, and costs it silently. A setting holding
  anything but a plain word is counted rather than quoted back, since a project's own
  `settings.json` sets `env` and this text is on its way into a system-reminder.
- `hooks/effort.mjs`, holding the level list and the reader, because both hooks need them and
  neither may import the other's entry point.
- A case that fails when a switch the hooks read is not in the README, or a switch the README names
  is read by nothing. Read off the shipped files rather than listed in the case, so the next one is
  covered by having been added.
- `test/effort.test.mjs` reads the five level names out of whatever build is installed and skips
  where there is none, since a level renamed upstream would cost a user their setting in silence.
  `VERIFYING.md` gains a step for the other half a person has to read: that the spawn builder still
  pushes an effort layer only where the agent definition carries one, that `workflow-subagent`
  still carries neither effort nor model and cannot be shadowed, and that the Agent tool's schema
  still has no `effort`.

### Fixed

- The default reminder said "Every subagent and every workflow stage runs at that same level, so
  leave `opts.effort` alone", which is false for a spawn whose own agent definition carries an
  `effort:`. The same overclaim was corrected in the other paragraph before this branch found it in
  this one, and this branch's own README is what made the two contradict. It says "unless its own
  definition sets one" now, which moves the default text from 1236 characters to 1271 and a 30-turn
  session from 1424 to 1459.

### Changed

- The README says what `CLAUDE_CODE_SUBAGENT_MODEL` does, beside the concurrent-cap note it already
  carried. It is the model half of the same question, it is a real subagent-only seam upstream that
  reaches workflow stages, and it needs nothing from this plugin. There is no such variable for
  effort, which is why the switch above is a sentence of text rather than a setting.
- The same section names the settings route to a subagent's effort, `modelSettings` keyed by the
  model a spawn resolves to, and the three things that make it worth knowing about rather than
  using: the row is keyed by a model rather than by who is spawning, so with no
  `CLAUDE_CODE_SUBAGENT_MODEL` split it takes the main loop down with it; its validator takes four
  level names where `opts.effort` takes five; and a level pinned by `--effort` or `/effort` is read
  in front of it. `VERIFYING.md` step 7 carries the greps and the capture that check all three.
- It also names the one case where a stage has a definition of its own: a script that passes
  `agentType` resolves a registered agent, and an `effort:` in that file's frontmatter sets the
  stage's level with no `opts.effort` in sight. `opts.effort` still wins where both are present, so
  the reminder's instruction holds and only its reason narrows.

## [0.2.1] - 2026-08-29

A payload one byte over the bound, or one long enough to run past it, answered as
though nothing had arrived. The reader that closes it is held character for
character against the other plugin's copy.

### Fixed

- A hook answers a payload larger than the megabyte it reads, and one with
  anything after the closing brace. `JSON.parse` reads a document or nothing, so
  a prompt long enough to run past the cap, or a payload one byte over, answered
  as though nothing had arrived: no `cwd`, no `source`, no session id, and the
  turn counter started again from one. Where the parse refuses, the members that
  can still be read are taken from the text: string members, at the top level and
  inside `tool_input`, whole, and short enough to be a path rather than a file's
  contents. anatomiya holds the same reader for the same reason neither plugin
  can import the other's file, and `test/hook-contract.test.mjs` refuses any
  payload the two answer differently.

## [0.2.0] - 2026-08-29

`VERIFYING.md` was worked whole against Claude Code 2.1.241. The premise holds: the gate is still one
conjunct, the four markers are still there, the Workflow tool still counts a standing ultracode mode
as its explicit opt-in, and the cadence constant is still 10. Every name inside the gate moved,
which is what the shape check is for.

### Added

- The version line fires on a run of ten patch releases past the calibrated build, as well as on a
  minor or a major. Three patch releases went by with the constant naming the first of them and
  no session ever saying so; a single patch is still noise, since the build updates itself, and no
  machine can notice either way, since a CI runner has no Claude Code to read.
- A case that fails when the code and the current docs name different Claude Code builds. It reads
  every file under `hooks/`, the README and `VERIFYING.md`, counts a version that ends a sentence,
  and lets the plugin's own version, a `^` or `~` range and an address through.
- The build's own spelling of the gate, as a case beside the spellings a minifier chooses between,
  so the next respelling has something to be compared to.

### Changed

- The reminder holds one effort for the whole session, subagents and workflow stages included. It
  used to say to pass `opts.effort` at 'high' or 'xhigh' on the verify, judge and critic stages,
  which is a stage running deeper than the session it belongs to and a cost nobody set. Depth comes
  from how the work is split and independently checked instead. A fifth deliberate deviation from the
  native wording, listed beside the other four. The whole text moves from 1224 characters to 1236 and
  a 30-turn session from 1412 to 1424. Decision A43.
- Calibrated against 2.1.241, read whole rather than in part. The wire-level diff is a repeatable
  recipe now rather than a thing done once by hand, and `VERIFYING.md` carries it: two requests
  captured off a local socket at everything-else-equal, differing in the reminder text and in
  `output_config.effort` and nowhere else. The README said the session id and the effort, which
  understated the one difference the plugin exists to make. The recipe keeps everything it writes in
  a directory `mktemp` made and takes a port from the kernel, for the reason A28 moved this plugin's
  own state out of the temporary directory, and it says that a tool field behind a remote flag can
  differ between two launches, so a third difference counts only when it repeats.
- The `source` field is confirmed absent from a payload caught off the running build, rather than
  inferred from the builder. The wakeup skip still waits for it.
- Measurements re-taken on that build: 325 MB rather than 321, about 30 ms a prompt, about 200 ms for
  the first session after an install, and 185,312 bytes between the closest `xhigh` and any of the 14
  `ultra_effort_enter` sites. That last one is the finding that killed the proximity heuristic,
  measured again on a second build rather than restated: A29 and A31 hold the reading it died on.
- The README names the second early return above the subagent cap, a flag Anthropic sets that lifts
  the cap for every session on the build, and its snippet no longer drops the line that binds the
  state the predicate below reads.

## [0.1.1] - 2026-08-23

Three fixes to the hook wire and one manifest path. Nothing about the premise moved: the four
markers and the gate shape were re-read off Claude Code 2.1.240 and hold, and the payload still
carries no `source`, so a wakeup is a turn like any other.

### Fixed

- A hook handed a pipe that stays open and empty now gives up after two seconds instead of waiting
  inside a blocking read until Claude Code killed it at the timeout it declares. That was five
  seconds of every prompt and fifteen of every session start, spent on a payload that was never
  coming. The read goes through `process.stdin`, which is a libuv pipe that can be released;
  `fs.readSync` and a stream opened on the descriptor both park a threadpool worker inside the
  syscall, where no timer runs and nothing can cancel it.

- The file read decoded each chunk on its own, so a character split across two reads came back as two
  replacement characters. It buffers and decodes once now.
- `respond` added an error listener to stdout on every call, which node warns about at eleven, and
  the warning goes to stderr, which a hook may not write to. It adds one.
- A payload at exactly the cap lost a character. The cap is there to keep a surrogate pair whole, and
  it was applied to a string nothing had split, which is a different answer from the one anatomiya
  gives for the same bytes; the contract between the two is held by `test/hook-contract.test.mjs`.
### Changed

- `readStdin` answers a promise and takes no descriptor. The descriptor was there for tests, and a
  test that drives a handle the plugin never sees proves nothing about the handle it does; the
  cases now drive the child's own stdin.
- The two entry points share one `here`, in the module they already shared.

- `plugin.json` points its `homepage` at the plugin's own directory, which moved under `plugins/`
  when the marketplace stopped holding a plugin at its root.
## [0.1.0] - 2026-08-21

The first release, published as part of anatomiya `0.2.9` before this plugin had a tag namespace of
its own. Claude Code gates its standing Workflow orchestration on `effort === "xhigh"`, and what
that gate controls is one system-reminder rather than the Workflow tool, whose availability carries
no effort term. This plugin restates that reminder on the built-in's own cadence, so the mode holds
wherever `effortLevel` is set, and says out loud what it does not restore.

### Added

- A `UserPromptSubmit` hook that opens the session with the standing opt-in and comes back as one
  line every tenth turn, 1412 characters over a 30-turn session. It runs through `node`, so it
  fires where there is no shell.
- The reminder carries its own floor: name what a fan-out buys, or stay solo. A dozen agents on a
  one-file edit costs more than the tokens the text saves.
- What it restores is the instruction, not the effort level, and the text says so rather than
  leaving a model to report itself as running at xhigh.
- A `SessionStart` check that reads the installed build for the four things the premise rests on
  and for the gate itself, and names anything missing. `ULTRACODE_ANYWHERE_STRICT=1` turns that
  into a switch; `VERIFYING.md` is the list a person works when the version moves.
- Silence where it would be noise: `"ultracode": true` already fires the built-in reminder, and
  `"enableWorkflows": false` leaves no tool to point at. A line says which setting silenced it.
- The concurrent-subagent cap it does not lift, named once per machine, with the setting that lifts
  it and the evidence that native ultracode does.
- Turn counters under `~/.claude/ultracode-anywhere/` rather than the temporary directory, in a
  directory this account owns with no access for anyone else.

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.2.1...HEAD
[0.2.1]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.2.0...ultracode-anywhere-v0.2.1
[0.2.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.1.1...ultracode-anywhere-v0.2.0
[0.1.1]: https://github.com/crisnahine/anatomiya/compare/v0.2.9...ultracode-anywhere-v0.1.1
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.2.9
