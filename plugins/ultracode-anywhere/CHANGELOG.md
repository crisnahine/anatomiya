# Changelog

All notable changes to `ultracode-anywhere` are documented here. It shares a repository with
`anatomiya` and nothing else, so it moves on its own version and this file is its own. Releases are
tagged `ultracode-anywhere-vx.y.z`; anatomiya's bare `vx.y.z` tags do not carry this plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-09-14

0.9.1 fixes what testing 0.9.0 against the installed Claude Code 2.1.270 turned up: a live battery
of hook calls, two runs of the plugin's own `review` workflow, a `hunt` for docs the code no longer
matched, measurements of the build itself, and review rounds over every fix. The self-check now
judges a probe's main loop against a run of the same build with the plugin switched off, where 0.9.0
expected the level the settings named and read a `modelSettings` level at the held level as a
lowered main loop, which refused every spawn. The spawn hold now refuses in cases it missed: a
switch or a redirect in the `.claude/settings.local.json` Claude Code reads at a project's git root,
a project that sets `CLAUDE_PROJECT_DIR`, an exported `CLAUDE_CODE_EFFORT_LEVEL` the preload hid
from the hooks, and a typed slash command inside a prompt over a megabyte. The preload decides the
level for each directory the way the shim does. The self-check stops leaving its probes' records
behind, passes with the environment scrub on, and retries a failed capture on the same 30-minute
pause as a failed check. `hunt` stops counting one instance twice and stops spending its rounds on a
candidate its judges cannot decide.

### Fixed

- A self-check no longer leaves its probe sessions' records among the ones the hold keeps for real
  sessions. Each run added about twenty, and they stayed for a month. A probe now keeps its record
  inside its own check, which is removed when the check ends.
- With `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` on, the build forces the default permission mode, so the
  self-check's shell and workflow probes were refused their tools and the check failed every 30
  minutes without ever passing. The probes now allow the tools they call, by name.
- A project whose settings set `ULTRACODE_ANYWHERE_PROJECT_DIR` now refuses every spawn, like the
  other variables the hold reads to find its settings.
- The preload reads the directories the shim reads, the one it runs in included, and holds a node
  program's `claude` wherever the shim would hold one typed in the same shell.
- A call whose payload is larger than the megabyte the hold reads is refused as unchecked when it
  starts a spawn or comes from a subagent or a `claude` started from the shell, where it was
  reported as a spawn that got past the hold, or rewritten without its prompt. A prompt that large
  is blocked when it opens with a slash, where a typed command in one ran unchecked.
- Settings from the user, the project and the local file merge the way Claude Code merges them,
  objects key by key and arrays joined without repeats, so a project's `env` or `modelSettings` no
  longer hides the user's `CLAUDE_CODE_EFFORT_LEVEL` or `maxEffortLevel` from the hold.
- A quoted frontmatter value no longer takes in a trailing comment that holds the same quote, and a
  key written quoted or with a space before its colon counts as that key, both where an agent's
  effort is read and where a plugin agent's copy drops `permissionMode`, `hooks` and `mcpServers`.
- A workflow's name is read from its meta literal, so a `name:` inside another member's text no
  longer registers it under that name.
- A remote stage runs with no isolation outside a git repository, the way a remote Agent call
  already did.
- A session start whose `CLAUDE_ENV_FILE` cannot be written still starts upkeep.
- The retired `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT` line is said once, where it came back at every
  start, compaction and clear.
- Removing a `maxEffortLevel` cap or an exported `CLAUDE_CODE_EFFORT_LEVEL` reruns the self-check at
  the next session start, where spawns stayed refused for half an hour.
- An exported `CLAUDE_CODE_EFFORT_LEVEL` refuses spawns in a session whose `NODE_OPTIONS` names the
  preload. The preload runs in the hooks' own processes too and set the held level over the
  session's value before they read it. It now keeps the value it replaced in
  `ULTRACODE_ANYWHERE_REPLACED_EFFORT`.
- A self-check run from a terminal no longer makes the next session start run every probe again.
- The refusal over a `CLAUDE_CODE_EFFORT_LEVEL` off the level says to remove it, where it offered
  `unset`, which is refused too.
- The notice for a self-check that could not finish carries the command to run it again.
- A killed self-check's directory is removed with the hold off, or with no build version read, too.
  A session in a project whose own settings switch the hold off, or move what it reads, leaves it to
  a session elsewhere.
- `ULTRACODE_ANYWHERE_EVERY` is read past surrounding spaces and past four digits.
- A `CLAUDE_CODE_EFFORT_LEVEL` the build cannot read, such as one with a trailing space, no longer
  refuses every spawn. `unset`, `auto` and a number still do, since the build drops a spawn's own
  effort for each.
- The self-check judges a probe's main loop against a run of the same build with this plugin
  switched off, where it expected the level the settings named. A `modelSettings` entry, a cap, a
  policy or a launch default that put the main loop at the held level read as lowered and refused
  every spawn. A main-loop leak the last run recorded stays only for a probe whose main loop this
  run could not judge, and only while it names the level held now: a probe that was skipped, failed
  or never reached the stand-in, one whose main requests carry no effort, one on a model the control
  never ran, or every probe at the held level when the control finds no id to switch this plugin
  off, still loads it, or never reaches the stand-in. A main loop the run saw at a known effort off
  the held level counts as judged. A run whose settings send requests elsewhere keeps the last
  leaks, leaving out a main-loop leak that names another level. The session start gives a failed
  control's reason beside the leak, and the self-check says when a main loop went unjudged.
  Main-loop leaks in a record from 0.9.0 refuse no spawn, since no control judged them.
- A policy drop-in in a folder below `managed-settings.d`, or named with a leading dot, no longer
  stops the self-check's probes as routing requests elsewhere, since Claude Code does not read it.
- Turning `ultracode` on or off in the user's settings reruns the self-check at the next session
  start.
- A spawn off the level is still recorded as a leak when a probe's directory cannot be removed.
- A capture that left a built-in agent without its shadow waits 30 minutes before it runs again, as
  does one that could not read the listing, which is reported at the next session start.
- A new process that reuses an exited process's id no longer inherits its loaded-agent record.
- A project whose settings set `CLAUDE_PROJECT_DIR` or `ULTRACODE_ANYWHERE_REPLACED_EFFORT`, or set
  `CLAUDE_CODE_SUBAGENT_MODEL` while the user's own settings name none beside the switch, refuses
  every spawn.
- A session started below its git root read a project's settings only in its own directory, while
  Claude Code also reads `.claude/settings.local.json` at the git root, or at the main repository
  for a linked worktree. A switch, a redirect, `ULTRACODE_ANYWHERE_STATE`,
  `ULTRACODE_ANYWHERE_DEBUG` or an enabled plugin set there went unseen. The hooks, the shim and the
  preload now read that file too, by the build's rule: not at the home directory, not on Windows,
  and only where this account owns the root, its `.git` and its `.claude`. The home is compared by
  real path, and a home with no real path reads no root file, as Claude Code decides it.
- A project that moves the hold's state has nothing written there, the tripwire's marks included.
- A `claude` the shim refuses for a `--setting-sources` list without `user`, such as
  `project,local`, now names that list, where it only said how many characters it would not quote
  back.
- The prompt and session hooks read a project's `enableWorkflows`, `disableWorkflows` and
  `ultracode` at the project root Claude Code names, wherever the session has moved since.
- `ULTRACODE_ANYWHERE_DEBUG` and `ULTRACODE_ANYWHERE_STATE` set in a project's own settings are
  ignored, so a cloned repository cannot have prompts logged to a file it names or counters written
  into its working tree.
- A session start no longer reports an unreadable `ULTRACODE_ANYWHERE_STAGE_EFFORT` while the spawn
  hold sets that switch aside.
- The counter sweep starts at a different place each turn, so an old counter behind 500 entries it
  cannot remove is still forgotten.
- The build check keeps enough text across a read boundary for the longest gate its pattern matches.
- A workflow meta with a negative number as a key is no longer listed.
- `review` verifies one claim once whether its file is written with a leading `./` or not, tells
  its report that findings sharing a location may be one defect, and its verdict counts the
  verified findings when the report stage fails.
- `hunt` counts an instance once per location once it is kept, so a second instance on that line
  that only another answer names is not counted, and it drops a held-over candidate there before
  judging it again. `./a.js:3` and `a.js:3` are one location. It gives up on a candidate after two
  rounds without enough judges where it ran to its round ceiling, and records which lens cast each
  vote. Its third lens is renamed from `is-new` to `evidence`, so judge labels change. Handed a
  scope and no quarry, it says the quarry goes in `looking_for`.

## [0.9.0] - 2026-09-13

Until now the plugin could ask the stages of a workflow the model writes to run at a level, and
nothing reached an Agent call, a forked skill or a `claude` started from the shell. 0.9.0 adds a
switch that holds every spawned agent to one level on one model while the main session keeps its
own, refuses what it cannot hold, and proves the hold against the installed build before trusting
it. It is off unless your own settings turn it on.

### Added

- An opt-in hold on every agent a session spawns. With `ULTRACODE_ANYWHERE_SPAWN_EFFORT` naming a level
  and three settings the README lists, every Agent call, workflow stage, bundled review and `claude`
  started from the session's shell runs at that level on the model `CLAUDE_CODE_SUBAGENT_MODEL` names,
  and so does a `claude` a node program inside the session starts once `NODE_OPTIONS` requires the
  preload, while the main session keeps its own model and effort. A forked skill off the level is
  refused, as is any spawn it cannot hold, and a tripwire stops a subagent whose level or model moved.
  A project's own agent off the level is refused with the `effort:` line to set in its file, as is one
  of a plugin only a project's settings turn on, and only the user's own settings turn the hold on.
  Off by default, and a session with it off pays one node start per tool call and per prompt, which
  answers before loading anything. DECISIONS A81.
- A self-check that proves the hold against the installed build: 17 probe sessions against a local
  stand-in for the API, run in the background when the build, the plugins or a deciding setting moves.
  A spawn it saw off the level refuses every spawn on that build until a run passes, and the session
  says which probe leaked. User or managed-policy settings that send requests to another endpoint or
  provider start no probe, and the check says so. `node hooks/hold-upkeep.mjs --verify` runs it by
  hand. DECISIONS A82.
- A preload for `NODE_OPTIONS` that holds a `claude` started by a node program inside a session, kept
  beside the configuration, out of the plugin's own directory and its state, so an update, an
  uninstall or a reset of the turn counters cannot leave `NODE_OPTIONS` naming a file that is gone.
  DECISIONS A83.

### Changed

- With the hold on, the reminder says every spawn runs at the held level on the held model, the
  checking stage included, in place of the text that tells a stage to pass or leave out
  `opts.effort`. `ULTRACODE_ANYWHERE_STAGE_EFFORT` is set aside while the hold is on.
- The session notice speaks with `ULTRACODE_ANYWHERE=0` set when the hold has something to say, since
  the hold keeps refusing with the reminder off.
- Re-calibrated against Claude Code 2.1.270, every recipe in `VERIFYING.md` worked. The premise holds,
  and the gate is spelled exactly as it was on the build before. The `workflowsPath` recipe was
  respelled, since the object it writes to is renamed, and the offset of the invalid-effort message
  moved. One figure was dropped: the injected skill's template count recorded earlier did not reproduce
  by the method written beside it.

## [0.8.0] - 2026-09-13

0.7.0 said the session's permission mode is the only thing that decides whether a stage told to read
can write, and gave nobody a way to see which mode they were in. The reminder now says so, on the
turns it already speaks, and only for the modes that were measured letting the write land.

### Added

- The reminder now names the session's permission mode when that mode lets a stage write through a
  shell redirect, which 0.7.0 documented and left the operator no way to notice. Said for
  `acceptEdits`, `bypassPermissions` and `auto`, each measured landing the write; silent for
  `default` and `dontAsk`, each measured refusing it; silent for `plan`, which nobody could
  establish either way. It rides the reminder's own cadence rather than being said once, because
  the mode changes on any turn and `SessionStart` is handed no mode at all.
  `ULTRACODE_ANYWHERE_MODE_NOTICE=0` drops the line and leaves the rest. DECISIONS A80.

### Changed

- Re-calibrated against Claude Code 2.1.269, every recipe in `VERIFYING.md` worked rather than the
  constant moved. The premise holds: the gate is still one conjunct, now
  `function GC(e,o,n,r){return n===!0&&lu()&&Ew(e,o,{turnEffort:r})==="xhigh"}` with every name
  moved again; the cap's second early return is still above the refusal; a plugin agent's `effort:`
  is still read and `permissionMode`, `hooks` and `mcpServers` are still the three it may not set; a
  stage still runs at the level its agent file names, measured off the socket at six finders on
  `medium` and three verifiers on `high`. Numbers that moved are in the file. One figure was dropped
  rather than carried: the injected skill's character count was recorded without saying how it was
  counted, so the old and new numbers are not comparable, and the method is now written beside it.

## [0.7.0] - 2026-09-12

A stage told to read and report could open a worktree, schedule a run, stop somebody else's or
message another session, and it can still write through a shell redirect. The first half is now
refused. The second cannot be refused from here, so the README says so and names the one thing that
does decide it, which is the session's own permission mode.

### Changed

- The four agent types refuse eight more tools: `EnterWorktree`, `ExitWorktree`, `DesignSync`,
  `CronCreate`, `CronDelete`, `PushNotification`, `SendMessage` and `TaskStop`. A stage whose prompt
  says to read and report could open a worktree, schedule a run, stop somebody else's or message
  another session, and none of it appears in the report it is judged by.

### Fixed

- The README now says what a stage's refusals do not cover. They take away the tools that write and
  leave `Bash`, so a shell redirect is a write nothing in the plugin sees: measured, a
  stage run under `acceptEdits` or `bypassPermissions` writes into the working directory, and the
  same redirect is refused under `default` with every read still working. `bashCommandClamp` was
  built for this and was measured not doing it, so it is not shipped; DECISIONS A79 carries the runs.

- The README said `node` was something Claude Code brings with it. It is not: the CLI is a compiled
  binary and ships none, so on a machine without node on `PATH` both hooks die with
  `sh: node: command not found` and the session loses its reminder and its notice. The requirement
  is now stated where someone installing reads it.

## [0.6.0] - 2026-09-12

The plugin stops asking for orchestration and starts shipping it. Three workflows resolve by name,
four agent types carry the effort and the tool refusals their stages need, and the reminder now
lists what is shipped, because Claude Code loads a plugin's workflows and then tells nobody they
exist. Re-calibrated against 2.1.268 along the way.

### Added

- `workflows/review.js`, `workflows/understand.js` and `workflows/hunt.js`, resolving as
  `ultracode-anywhere:review`, `:understand` and `:hunt`. Each is a distinct control flow rather than
  a task: dimensions with adversarial verification, readers with one synthesis, and rounds that stop
  after two turn up nothing new. The scripts are `.js` because the loader recognises `.mjs`, `.cjs`
  and `.ts` and refuses all three, which makes them the one exception to `.mjs` everywhere else here.
- `agents/finder.md`, `reader.md`, `verifier.md` and `synthesist.md`. A plugin agent is reachable as
  a `subagent_type` under `<plugin>:<name>` and its frontmatter `effort:` is read when a workflow
  stage names it, so a stage's depth is now a line in a file rather than a request in a reminder.
  `finder` and `reader` name `medium`; `verifier` and `synthesist` name none, so the stages that
  check and merge run at the session's own level. All four refuse `Write`, `Edit` and `NotebookEdit`.
- A finding nobody could check is reported as such rather than dropped or counted as refuted.
  `review` returns it in `unverified`; `hunt` puts a candidate its judges did not answer for back on
  the queue and names what is left in `unjudged`, because counting a dead judge as a rejection hides
  an instance nobody looked at. A run that verified nothing says so rather than reporting what a
  synthesis made of an empty list, and a run whose finders came back with nothing says that too
  rather than "nothing found". The same rule covers a stage that answered nothing: `hunt` counts the
  angles that came back empty as `silent` and will not call itself `exhausted` while any did, since
  a sweep that never ran is not a sweep that found nothing; `understand` returns the areas its cap
  left unread as `skipped`, and says when a survey came back with nothing readable rather than
  reporting that it proposed no areas.
- The report stage is handed each verifier's lens, whether it refuted the finding and any correction
  it wrote, rather than three verdict strings under one word; and it is handed what each finder said
  it covered, since it is the stage asked what nobody covered.
- The catalogue: the opening text and the refresher name every shipped workflow by the name the tool
  resolves. Nothing upstream does this. The hook that would append a listing to the Workflow tool's
  description is `function ke(){return}` and its sibling is `function ct(){return""}`, so the only
  place a name otherwise reaches the model is the error raised when one fails to resolve. A session
  already on native ultracode gets the listing from the `SessionStart` notice instead, since the
  prompt hook stands aside there and the built-in reminder says nothing about a plugin's workflows.
- `ULTRACODE_ANYWHERE_CATALOGUE=0` drops the listing and keeps the reminder.
- `scripts/workflow-lint.mjs`, run by CI and by `npm run validate`, and available on its own as
  `npm run lint:workflows`. It holds every shipped script to the rules the loader enforces in
  silence: `export const meta` first, one declarator, a pure literal; `name` and `description`
  non-empty; under 524,288 bytes and named `.js`; a body that compiles as an async function body;
  only the eleven globals the sandbox injects; no `Date.now`, bare `new Date()` or `Math.random`,
  and no `with`, `import()`, `await using` or `__wRg$` identifier; a `meta.phases` entry per
  `phase()` call and back, and no entry the build would drop without a word; an `agentType` this
  plugin ships; no two files declaring one `meta.name`; a `meta.name` the catalogue sentence can
  quote, since a name outside that class loads and is then named in no session at all; and the
  plugin's own dependency-free reader answering what a real parse answers, with the strict-mode
  early errors reported so the two cannot agree on a decode no engine performs. A file that breaks
  one is skipped by the loader with a warning nobody reads, so the gate is the only thing between a
  typo and a workflow that silently does not exist.

### Removed

- `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT`, along with the module that wrote agent files under it. The
  plugin ships the four agent types now, each carrying its own `effort:`, so there is nothing for the
  switch to set. A session that still has it in `settings.json` is told so once at startup rather
  than left with a setting that quietly does nothing.

### Changed

- Re-calibrated against Claude Code 2.1.268. The gate still holds and still reads as a conjunct,
  now spelled `function fC(e,n,o,r){return o===!0&&eu()&&NA(e,n,{turnEffort:r})==="xhigh"}` at offset
  162,832,197. Its argument list grew a fourth parameter passed as `{turnEffort:r}`, which filled 18
  of the 24 characters the drift pattern allowed: six characters of headroom is a coincidence, not a
  bound, so the pattern is generous about arguments now and tight about the three conjuncts and the
  comparison, which is where the premise lives.
- `scripts/validate.mjs` reads eight loadable kinds rather than five. `workflows`, `outputStyles` and
  `lspServers` were missing, so a plugin whose only behaviour was a workflows directory read as one
  that installs nothing.

### Removed

- `hooks/shadows.mjs` and `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT`. Both existed to report on agent files
  a reader was expected to hand-write, because the plugin could not write them. It ships them now, so
  the module, the switch and 939 lines of tests for them are gone. The agent files it ships are its
  own types rather than copies of built-in prompts, so none of the freezing that made shadowing a bad
  trade applies.

## [0.5.0] - 2026-09-02

Four module-level names nobody read outside their own file are private, and a test holds the two
hooks' silence to one answer. Nothing a session sees changed.

### Changed

- `FILES_MOST`, `GATE`, `CONFLICTS` and `PATCHES_BEFORE_STALE` are private to the files that use
  them; a guard in the marketplace's suite holds every export to a reader. The sweep's bound is
  pinned by behaviour: two thousand files are read and the next one stops it.
- A test holds the prompt hook's silence and the session notice's `quiet` to one answer over the
  three states that decide them: a plain session, a conflict in settings, and strict mode on a
  build that moved.

## [0.4.0] - 2026-08-31

The other half of the effort question, the one the Agent tool asks. Nothing can set it, so this
reports instead: whether the agent files that would give a spawn the level you asked for are there,
carry it, and were written since the build they copy.

### Added

- `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT=<level>` covers the Agent-tool half of the question the stage
  switch answers for workflows. It is a report and not a setting: nothing is written, generated or
  repaired. A spawn's effort comes from its agent definition, so the one lever is an agent file's
  `effort:`, and covering a built-in type means keeping a copy of that type's system prompt in the
  file. The copy is what rots, silently: it is frozen at the build it was taken from and an upgrade
  moves the original. The session now opens by saying which of `general-purpose`, `Explore` and
  `Plan` no file names, which have a file the build refuses for want of a `description:`, which name
  no effort, which name another level, and which were last written before the build now installed.
  Silence means all three are named at the level asked for by a file newer than the build, or that
  the build's own age could not be read.
- An agent file is keyed on its frontmatter `name:` and never on its filename, which is how the
  build keys one: `Explore.md` naming something else is that other agent and leaves the built-in
  alone, and `anything.md` naming `Plan` is the file a spawn of `Plan` reads. Every
  `.claude/agents` from the working directory up to the home is read, deepest first and subfolders
  included, then the user's own, and a file behind a symlink counts because the build follows one.
  A build whose age cannot be read leaves the age unanswered rather than reported as fine, and a
  search that hit its own bound says how many files it read rather than reporting an absence it
  never established. The line names the file it read for each type, since a type can have a
  candidate in every `.claude/agents` up the tree.

### Changed

- The README says what the Agent-tool half costs, which it did not: that no hook event reaches a
  spawn's effort, that `PreToolUse` cannot carry one because the Agent tool's input has no such
  field, and the two things a markdown file cannot carry whatever it holds. `omitClaudeMd` is set by
  the built-in `Explore` and `Plan` and is not a frontmatter key, so a copy of either starts loading
  `CLAUDE.md`; `appendSystemPrompt` is set by the `claude` catch-all, so that one cannot be copied at
  all and is left alone. `VERIFYING.md` gains a step with the greps for all three.

### Fixed

- One rule for where Claude Code keeps its configuration, in `hooks/hook-io.mjs`, where two files
  had a copy each. The rule that a home named and empty is no home rather than the process's own was
  written out twice and is now written once.

## [0.3.0] - 2026-08-30

A session can name one effort level for its whole fan-out, which is the one thing `opts.effort`
reaches and nothing else does. Re-calibrated against the build that ships today, with two recipes
that had been finding nothing repaired and a wire claim corrected from two leaves to three.

### Added

- `ULTRACODE_ANYWHERE_STAGE_EFFORT=<level>` names the level the fan-out should run at: the reminder
  then asks for `opts.effort` at that level on every workflow stage, and for it to be left out of a
  stage checking or judging another stage's work, which is what makes that one run at the session's
  level where its own definition sets none. `opts.effort` is the only lever a caller has on a stage,
  since the built-in definition a stage gets carries no effort and the Agent tool takes no effort
  argument, so a session wanting its fan-out cheaper than its main loop has nothing but the reminder
  text to say it with. Unset, the text is the one-level paragraph it always was: leave `opts.effort`
  alone. The levels are `low`, `medium`, `high`, `xhigh` and `max`, read past case and surrounding
  spaces, and the answer put into the text is the list's own spelling rather than what the variable
  held. The text names a level and not a direction, because `--effort` and `/effort` write nothing
  to `settings.json` and the hook cannot read the session's own level to say which way it points.
  A30, A43 and now A47.
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

- Re-calibrated against Claude Code 2.1.251, the whole of `VERIFYING.md` worked rather than the
  cheap half. The premise holds: the gate is still one conjunct, all four markers are still there,
  the Workflow tool still counts a standing ultracode mode as its explicit opt-in, and the cadence
  constant is still 10. Every name inside the gate moved again, which is what the shape check is
  for, and the build's own spelling is kept beside the last one so the next respelling has something
  to compare to. `CALIBRATED_AGAINST` had sat ten patch releases behind, which is exactly the run
  `behind` waits for, so every session on this machine opened with a line saying nobody had checked
  it. That line is the guard working, and the answer to it is the list rather than a wider band.
- Two recipes in `VERIFYING.md` found nothing and said so by printing nothing. The compaction walk
  pinned a minified identifier, `n="enter"`, which the build now spells `o`; it reads a character
  class now. Both are the failure this file is least able to notice, so it says to spell `grep` as
  `/usr/bin/grep`, since a PCRE shim on `PATH` answers where the stock one does not.
- The wire diff is three leaves, not two. `"ultracode": true` also loads the whole
  `workflow-authoring` skill into the user message, about sixteen thousand characters of it, which
  no hook can do. The system prompt and all 24 tool definitions are still identical. Two control
  runs place it on the key rather than on the effort level, and the README says so instead of
  claiming a two-leaf diff it no longer has.
- The line naming `"ultracode": true` said the built-in "already fires", which is false in one real
  case: a `--effort` flag or `/effort` below xhigh beats the key, the gate does not hold, and the
  session gets no reminder from either side. It names both now, since nothing else can tell that
  session.

- The reminder said "Every subagent and every workflow stage runs at that same level, so leave
  `opts.effort` alone", which is false for a spawn whose own agent definition carries an `effort:`.
  It says "unless its own definition sets one" now, the same carve-out the levelled paragraph
  carries, which moves the text from 1236 characters to 1266 and a 30-turn session from 1424 to
  1454.

### Changed

- Measurements re-taken on this build: 197 MB rather than 325, 9 `ultra_effort_enter` sites rather
  than 14 and 115 `xhigh` rather than 235 with the closest pair 168,197 bytes apart rather than
  185,312, the built-in reminder at 308 characters rather than 288, 24 tool definitions rather than
  25. The timings did not move: about 30 ms a prompt against a bare `node` floor of 23, and about
  150 for the session that reads the bundle, then 30. A first pass here read 20 and 90 off a CPU
  timer and an in-process call rather than off the whole process, which is what a user pays, and
  would have replaced two right numbers with two wrong ones. The proximity conclusion is unchanged:
  a 20,000-byte window still fails by a factor of eight.

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

[Unreleased]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.9.1...HEAD
[0.9.1]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.9.0...ultracode-anywhere-v0.9.1
[0.9.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.8.0...ultracode-anywhere-v0.9.0
[0.8.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.7.0...ultracode-anywhere-v0.8.0
[0.7.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.6.0...ultracode-anywhere-v0.7.0
[0.6.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.5.0...ultracode-anywhere-v0.6.0
[0.5.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.4.0...ultracode-anywhere-v0.5.0
[0.4.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.3.0...ultracode-anywhere-v0.4.0
[0.3.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.2.1...ultracode-anywhere-v0.3.0
[0.2.1]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.2.0...ultracode-anywhere-v0.2.1
[0.2.0]: https://github.com/crisnahine/anatomiya/compare/ultracode-anywhere-v0.1.1...ultracode-anywhere-v0.2.0
[0.1.1]: https://github.com/crisnahine/anatomiya/compare/v0.2.9...ultracode-anywhere-v0.1.1
[0.1.0]: https://github.com/crisnahine/anatomiya/releases/tag/v0.2.9
