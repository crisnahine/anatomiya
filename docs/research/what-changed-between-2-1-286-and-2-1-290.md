# What changed between 2.1.286 and 2.1.290

Research notes, October 2026. The question is which Claude Code and model changes since anatomiya was
last calibrated break it, weaken it, or open a better path, and whether any part of its design should
change. The range read in full is 2.1.286 to 2.1.290, the build installed now. Releases 2.1.250 to
2.1.285 were scanned for the topics anatomiya depends on, and only items the earlier notes in this
directory do not already settle are listed.

Every claim carries its source, in the three kinds the companion notes use:

- **read**: a string or a function recovered from an installed build, with its byte offset
- **run**: a command and its output on this machine, on 2026-10-06
- **doc**: a first-party page, quoted, with its URL

The builds read are **Claude Code 2.1.290**, `~/.local/share/claude/versions/2.1.290`,
233,260,816 bytes (`claude --version` prints `2.1.290 (Claude Code)`), and, for comparison,
**2.1.286** (225,167,728 bytes), **2.1.287** and **2.1.289**, all still on disk in the same
directory. Offsets are into the 2.1.290 file unless a line says otherwise. Identifiers are minified and
change between builds, so an offset is one build's address.

The changelog was read from the copy Claude Code keeps at `~/.claude/cache/changelog.md` (fetched
2026-10-06 07:39 local). **run**: `curl` of
`https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` returns the same text,
including the 2.1.288 line quoted in section 1. Docs were fetched as Markdown on 2026-10-05 23:50 UTC
from `https://code.claude.com/docs/en/*.md` and `https://platform.claude.com/docs/en/*.md`. No live
Claude Code session was started for this note.

## Summary

**Nothing has to change in the shipped plugin for 2.1.290.** Every wire detail anatomiya's hooks
depend on reads the same in 2.1.290 as in 2.1.286: the hook event list, the common payload envelope
and its field order, the Stop payload, the transcript entries the echo and the reuse check parse, and
the `npm ci` an install runs. `test/claude-build.test.mjs` and `test/hook-contract.test.mjs` pass 47
of 47 against 2.1.290. One repository test fails: `test/ab.test.mjs` finds one engine-shaped name it
has not ruled on, and the name is a string-table artifact of a variable the harness already scrubs. One
row in `KEPT` fixes it.

**Should change:**

1. **Area files now also load on Write and Edit (2.1.288).** Before 2.1.288 only a Read or an
   `@file` mention loaded them ("previously only Read loaded them", in the changelog's words). Now a
   Write or Edit inside an area loads that area's file too, after the write. Several places in this
   repository said an area file loads only on a read. Those are corrected, and the overview's own
   lines, which never said "only", are left as they are. The reason the `notice` hook gives for
   existing is narrower than it was. The notice still carries something the area file does not, so
   it stays.
2. **The model every measurement was taken on is no longer the current one.** The reuse wording's 24
   of 24 and the A/B harness pin are both on `claude-opus-5`. The served catalog now lists Opus 5 under
   "overflow", and `claude-opus-5-5` is the first entry and the docs' recommended starting point. Opus
   5.5 defaults to `medium`, and Anthropic says it matched or beat Opus 5 at `high` on agentic coding.
   The reuse result has to be re-measured on Opus 5.5 before it can be cited as current.

**Can wait, and should be watched:**

3. **Claude Mods (2.1.287)** are a new plugin surface: in-process JavaScript hooks that can add
   context to a prompt, rewrite system-prompt sections, see each attachment Claude Code adds, observe
   compaction, and choose a subagent's model. They could replace the transcript reading behind the
   echo's once-per-window rule. They do not replace the settings hooks today: they are off under
   `--bare`, `--safe-mode`, `disableAllHooks`, organization policy and a remote switch, they need
   2.1.287, and their file API stops at 4 MiB, which one measured record already exceeds.
4. **A remote flag can switch off project rules.** 2.1.286 to 2.1.290 all carry `tengu_paper_halyard`.
   When it is on, Project and Local memory, which is where `.claude/rules/anatomiya-*.md` sits, is
   filtered out at startup and at the nested load. It is off for this account. If it ever turns on,
   the echo hook is the only channel left, which is one more reason to keep it.
5. **A plugin-shipped agent for the reuse search** has been possible since 2.1.271 (`omitClaudeMd`)
   and works with effort and model pins. It would let the Stop reason name the search agent instead of
   leaving model, effort and tools to whatever the session has. It changes a measured wording, so it
   is an experiment to run first.

## 1. Path-scoped rules now load on Write and Edit

**doc**, changelog, 2.1.288:

> Fixed path-scoped `.claude/rules` and nested CLAUDE.md files not loading when Write or Edit creates
> or changes a file in their scope (previously only Read loaded them)

**doc**, [Memory](https://code.claude.com/docs/en/memory), "Path-specific rules":

> Path-scoped rules trigger when Claude uses the Read, Write, or Edit tool on a file matching the
> pattern, not on every tool use.

**read**, the two new call sites. Both push the written path onto the same trigger list the Read tool
fills, after the write has succeeded and after the "staged for review" early return:

- offset 190,566,700, the Write tool:
  `...remedy:{kind:"staged_for_review",path:Y?.path??W}};if(r.remoteCall===void 0)ioe(r.nestedMemoryAttachmentTriggers,W);`
- offset 193,862,099, the Edit tool:
  `...remedy:{kind:"staged_for_review",path:ke?.path??he}};if(n.remoteCall===void 0)ioe(n.nestedMemoryAttachmentTriggers,he)`
- offset 190,514,509, the helper: `function ioe(e,n){if(e&&!e.includes(n))e.push(n)}`
- offset 193,263,075, the Read tool's own push, unchanged: `let Xe=g.nestedMemoryAttachmentTriggers;if(Xe&&!Xe.includes(Ne))Xe.push(Ne);`

**run**: a regex for `<name>(<x>.nestedMemoryAttachmentTriggers,<y>)` finds both sites in 2.1.289
and 2.1.290 and none in 2.1.286 or 2.1.287. NotebookEdit has no such site, so a notebook write still loads
nothing.

**read**, offset 193,354,959: the list is drained in the attachment pass
(`Al("nested_memory",()=>Cln(...))`, `Cln` at 193,389,498), the same pass
`docs/research/when-a-hook-can-refresh-the-map.md` traced for Read. So the area file arrives with
the next request after the write, never before it.

What this does to anatomiya:

- **The blind spot `notice` was built for is smaller.** `plugins/anatomiya/lib/precedent.mjs:227`
  said "an area's own file loads only when something in that area is read. A directory nobody read
  is the blind spot". From 2.1.288, the first Write into an unread area loads that area's file at
  the same moment the notice's text arrives: on the next request, after the write. What the notice
  still adds is the one finding about this path, worded as an instruction, where the area file
  states counts for the whole directory. The notice also still covers what the native load does not:
  a path that no area glob delivers to, and a worktree with no map of its own. Its matcher holds
  NotebookEdit too, but `.ipynb` is not an extension a test file is held to, so a notebook gets no
  notice today (`plugins/anatomiya/lib/hook.mjs:249`). Whether the area file now makes the notice
  redundant on the paths both cover takes a measurement to settle.
- **Prose in this repository said read was the only trigger.** **run**, `grep` over `plugins`,
  `scripts`, `test`, `docs`, `README.md`, `CONTEXT.md`, `DECISIONS.md`:
  - Exclusive claims, now false and corrected with this note:
    `plugins/anatomiya/lib/precedent.mjs:227`, `test/precedent.test.mjs:158`, `README.md:274` and
    the Limits section, the load table, the ceiling paragraph and section 7b in
    `docs/how-it-works.md`, `scripts/ab/arms.mjs:161-163`, and A44 and H1 in `DECISIONS.md`.
  - Claims that name the read without saying "only", still true on every build and left as they are:
    `plugins/anatomiya/lib/render.mjs:766-767`, "loaded when you read one of its files", in the
    always-loaded overview and pinned by `test/render.test.mjs`; `CONTEXT.md:239`; and the
    descriptions in `plugins/anatomiya/README.md:4`, `plugins/anatomiya/package.json:6` and
    `plugins/anatomiya/.claude-plugin/plugin.json:4`. The overview line also points the agent at the
    one trigger that loads the counts before a write, and changing it changes every generated map.
  - `plugins/anatomiya/lib/render.mjs:648`, "Read a file before editing it: these notes load when you
    read, not when you grep.", is still good advice: reading first is what puts the counts in front
    of the model before the write. Its second clause is incomplete now. It is a measured line
    (`docs/research/one-line-that-stops-guessing.md`), so a reword needs the same measurement.
- **Older builds still behave the old way.** Anything that states the new behaviour should say "from
  2.1.288".

**doc**, changelog, 2.1.288, a related fix that helps the measurement side: "rules and nested
CLAUDE.md files loaded on file access now also report effort" in `InstructionsLoaded`, and that hook
now carries `agent_id` and `agent_type` for a subagent's loads. **doc**,
[Hooks](https://code.claude.com/docs/en/hooks), `InstructionsLoaded` input: `load_reason` is one of
`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`. A harness could count
area-file deliveries per window with this hook and stop inferring them from transcripts.

## 2. What did not change in the hook wire contract

**read**, the event list, identical in both builds (2.1.286 and 2.1.290):
`["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification","UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop","StopFailure","SubagentStart","SubagentStop","PreCompact","PostCompact","PreModelSwitch","PostModelSwitch","PermissionRequest","PermissionDenied","Setup","TeammateIdle","TaskCreated","TaskCompleted","Elicitation","ElicitationResult","ConfigChange","WorktreeCreate","WorktreeRemove","InstructionsLoaded","CwdChanged","FileChanged","DirectoryAdded","MessageDisplay"]`.
No settings-hook event was added or removed in the range.

**read**, the common envelope, offset 192,684,587 (`yd`, 2.1.290) against 185,940,288 (`kc`,
2.1.286): both return
`{session_id,transcript_path,cwd,scratchpad_dir,prompt_id,permission_mode,agent_id,agent_type,effort}`
in that order. `cwd` is still in front of the bulk, which `test/hook-contract.test.mjs` "the fields
these hooks read come before the bulk" depends on.

**read**, the Stop payload, offset 192,673,065 (2.1.290) against 185,930,064 (2.1.286): both build
`{...envelope,hook_event_name:"Stop",stop_hook_active,last_assistant_message,...}`. There is still no
tool list in it, so the reuse reason's last sentence ("If this session has no subagent tool, run that
search yourself.") is still needed.

**run**, string counts of the transcript markers the hooks parse, 2.1.286 then 2.1.290:
`compact_boundary` 38 and 40, `hook_additional_context` 19 and 23, `hook_system_message` 14 and 16,
`agent_listing_delta` 8 and 9. All still present.

**run**, the echo's once-per-window rule (A92) observed live in this research session's own subagent
transcript on 2.1.290: 83 tool calls, 6 map deliveries, 1,961,334 bytes. The gaps between
deliveries were 262.6 KiB and 313.3 KiB, each over the 256 KiB window, so every repeat was the
designed one and none was a dedup failure. A research session that reads large files moves through
the window fast, since each large result is stored in the transcript.

**doc**, [Hooks](https://code.claude.com/docs/en/hooks), JSON output: `additionalContext` is still
capped at 10,000 characters per field, and a longer value is saved to a file with a 2,000-character
preview. The 2,000-character cap shared across hooks on one call applies to `classifierContext` only,
which anatomiya does not send.

Changelog items in the range that touch hooks and do not affect anatomiya, each checked against what
the hooks do:

- 2.1.288: PreToolUse hooks whose matching fails, or whose tool input cannot be serialized, now block
  the call instead of being skipped. `notice` uses a plain `Write|Edit|NotebookEdit` matcher.
- 2.1.290: permission rules now re-apply after a PreToolUse hook rewrites input. `notice` rewrites
  nothing.
- 2.1.290: "Changed plugin hooks so long text is clipped and logged instead of being refused or
  dropped silently." Every other "plugin hooks" line in the 2.1.287 to 2.1.290 entries is about mods,
  so this reads as the mods' hooks. Not verified against the build.
- 2.1.290: an async Stop hook with an unquoted path looped. anatomiya's Stop hook is synchronous and
  quotes `${CLAUDE_PLUGIN_ROOT}`.
- 2.1.285: a synchronous hook no longer hangs on a background child that holds its output open.
  `plugins/anatomiya/lib/refresh.mjs:154-159` starts its worker detached with `stdio: "ignore"` and
  `unref()`, so it was never exposed.
- 2.1.286: API 400s after a hook returned a non-string. anatomiya returns strings.

## 3. Plugin install and dependencies

**doc**, changelog, 2.1.286: "Changed plugin installs to refuse npm sources that are git repositories
or folders, and to install plugin dependencies only from registry packages."

**run**: all 28 entries in `plugins/anatomiya/package-lock.json` resolve to
`https://registry.npmjs.org/`. None is a git or folder source, so the rule refuses nothing anatomiya
ships.

**read**, offset 193,623,622: the install command is unchanged from 2.1.286 (offset 187,263,520
there): `["ci","--ignore-scripts","--workspaces=false","--no-audit","--no-fund"]` with a 60,000 ms
limit, chosen by the lockfile found beside the manifest. `docs/research/what-a-hook-reads-and-what-an-install-runs.md`
still holds.

**doc**, changelog, 2.1.287: "Improved plugin listings to note when a plugin's dependencies were not
installed, and updating a plugin now retries an install that did not finish." This helps anatomiya:
a failed `oxc-parser` install now shows in `/plugin` without anyone running `/anatomiya:doctor`.

## 4. Models and the pinned pair

**doc**, [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview):

| | Fable 5.1 | Opus 5.5 | Sonnet 5.5 | Haiku 4.5 |
|---|---|---|---|---|
| API ID | `claude-fable-5-1` | `claude-opus-5-5` | `claude-sonnet-5-5` | `claude-haiku-4-5-20251001` |
| Default effort | `high` | `medium` | `high` | Not supported |
| Context window | 1M | 1M | 1M | 200K |
| Retirement | Not sooner than September 1, 2027 | Not sooner than September 22, 2027 | Not sooner than September 28, 2027 | Not sooner than October 15, 2026 |

"If you're unsure which model to use, start with Claude Opus 5.5". Claude Opus 5 is listed under
"Legacy models (still available)".

**doc**, [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations):
`claude-opus-5`, Active, "Not sooner than July 24, 2027". The pinned id still works.

**run**, `~/.claude/cache/model-catalog/80d543a6-...-cc.json`, the catalog Claude Code was served
(fetched 2026-10-06): the "main" section lists `claude-opus-5-5`, `claude-fable-5-1`,
`claude-sonnet-5-5`, `claude-haiku-4-5-20251001` in that order, with "Recommended" on `medium` for
Opus 5.5 and on `high` for Fable 5.1. `claude-opus-5` and `claude-sonnet-5` are in "overflow".

**doc**, [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5):

> In Anthropic's testing, at its default `medium` effort the model matched or beat Claude Opus 5 at
> `high` effort on such tasks, in fewer steps

and

> Claude Opus 5.5 resists indirect prompt injection, meaning instructions that arrive through tool
> results, web pages, and on-screen or browser content, better than any earlier Opus model.

**doc**, [Migrating to Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide):
"Set `effort` explicitly: the default is `medium`, where Claude Opus 5's is `high`", and on Opus 5.5
thinking cannot be disabled.

What this means for each pin:

- **The `reuse` Stop hook pins no model and no effort.** `plugins/anatomiya/lib/reuse.mjs:227-233`
  asks for "one subagent" and names neither. The search runs on whatever the session's Agent tool
  resolves, which on a default install is now Opus 5.5 at `medium`. What is pinned is the measurement
  behind the wording: DECISIONS A91 says "The wording was measured on claude-opus-5 at medium effort",
  under 2.1.272. Opus 5.5 at the same level is a stronger engine, so the 24 of 24 is unlikely to fall.
  But the reason text is an instruction arriving through a hook, and Opus 5.5 is documented as more
  wary of instructions that arrive from outside the user. Hook context is not a tool result, so the
  guide does not cover it directly. Neither direction is measured. Re-run the 24 hard cases on
  `claude-opus-5-5` before citing the number as current.
- **The A/B harness pin** in `scripts/ab/engine.mjs` (`{ model: "claude-opus-5[1m]", effort: "medium" }`,
  asserted in `test/ab.test.mjs`) still runs. It now measures a legacy model against a default that
  is one generation newer. `[1m]` buys nothing on either: **doc**,
  [Model configuration](https://code.claude.com/docs/en/model-config), says `sonnet[1m]` has "No
  effect when `sonnet` already resolves to Sonnet 5.5 or Sonnet 5 with their native 1M window", and
  the overview table gives Opus 5.5 a 1M window. Whether the harness moves to `claude-opus-5-5` is a
  decision about comparability. Every earlier result was taken on Opus 5, and a changed engine makes
  old and new results incomparable, the way a changed predicate already did for maps.
- **Effort.** `medium` is now both the harness pin and Opus 5.5's own default, so a session that sets
  no level runs the reuse search at the measured level. This machine's user settings force `medium`
  anyway, so a live check here cannot tell the two apart.

**run**, the one failing repository test. `node --test test/ab.test.mjs`: 57 of 58 pass. The failure
is "the build carries no engine-shaped variable this run has not decided about", naming
`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENTN`. **run**:
`overridesEngine("CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT")` is `true` (it is
`scripts/ab/engine.mjs:50`), and the same name with a trailing `N` is `false`. **read**, offset
78,396,956: the string table stores the name followed by the next entry's length byte `N`, the same
artifact `KEPT` already lists for `CLAUDE_CODE_EFFORT_LEVEL_` (2.1.285) and two `...E` names
(2.1.286). **run**: the variable itself is present in 2.1.286, 2.1.287, 2.1.289 and 2.1.290 (6 hits
each), so only the byte after it moved. **read**, offset 74,407,642, what it does: "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1
restores the previous wait-for-the-API behavior", in a message about the context window assumed for
a model Claude Code does not recognize. The scrub is right. The test needs one `KEPT` row.

## 5. Claude Mods

**doc**, changelog, 2.1.287: "Added Claude Mods: plugins may now modify deeper behavior".

**doc**, [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview): "A mod's handlers are
functions that run inside Claude Code instead" of a shell command, and "Mods are on by default. In the
terminal, use Claude Code v2.1.287 or later."

**doc**, [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference), "Files":
`hooks/hooks.json` holds `modules`, "an array with one path ... to the hooks module", and "Can also
hold settings hooks under `hooks`". A mod can sit in anatomiya's existing `hooks.json` beside the
current entries.

Events that touch what anatomiya builds by hand, all from that reference page:

| Mod event | What a hook can return | What anatomiya does by hand today |
|---|---|---|
| `prompt.submit` | `next({ ...e, context })` | `echo` on `UserPromptSubmit` |
| `prompt.section`, `prompt.compose` | `{ text }`, `{ sections }` | the overview as an unconditional rule |
| `prompt.attachment` | `{ text }` or `{ text: null }`; `e.type` names the kind | nothing: anatomiya cannot see when an area file is attached |
| `session.compact` | `{ skip: reason }` | `echoEvent` reads `compact_boundary` off the transcript tail |
| `tool.call` | `next(e)`, `{ deny }`, `{ result }`; the result can be rewritten after `await next(e)` | `notice` on `PreToolUse`, `echo` on `PostToolUse` |
| `agent.spawn` | `next({ ...e, model })` | nothing: the reuse search runs on the inherited model |
| `classic.<Event>` | the settings hook's own stdin | all four commands |

What a mod would let anatomiya delete: the echo's once-per-window rule (A92) reads the last 256 KiB
of a transcript, finds the window a subagent or workflow stage writes to (`windowOf`,
`inWorkflowRun`), and parses JSON lines (`echoEvent`, `heldIn`, all in
`plugins/anatomiya/lib/hook.mjs:565-631`). A mod keeps variables across hooks in one process ("a mod's
hooks share the variables in its file"), so "delivered in this window" is one value per agent id,
cleared on `session.compact` and on `session.end` with reason `clear`. No transcript is read.

Why not now, each from the docs above:

- **Reach.** "The settings and flags that stop installed mods, such as `disableAllHooks`, `--bare`,
  and `--safe-mode`, don't stop built-in mods", so they do stop anatomiya's. `allowManagedModsOnly`
  stops a user-installed mod in an organization. The built-in authoring plugin loads "Unless Anthropic
  has turned installed mods off remotely", so a remote switch exists. A settings hook needs none of
  this to run.
- **Version floor.** 2.1.287. The settings hooks work on every build the plugin already supports.
- **The file API.** "A hook calls the mods API. A hook has no other way to do those things", and
  `$.fs.read` is capped at "4 MiB for one file". `docs/how-it-works.md` measures the record at
  9,957,450 bytes on microsoft/vscode. A mod would have to shell out to `node` through
  `$.process.run`, which brings back the process cost a mod was meant to remove.
- **Time.** A mod hook gets 10 seconds; anatomiya's Stop hook declares 15.
- **Two delivery paths.** A mod that adds context while the settings hook also runs would deliver the
  map twice. The mod would have to own the delivery wherever it loads and hand it to the settings hook
  wherever it does not, and that hand-off is a new place for the two to disagree.

`prompt.attachment` is the one event with no settings-hook equivalent. It would let anatomiya see each
`nested_memory` attachment and know which area files a window holds. That is useful for measurement,
and `InstructionsLoaded` (section 1) already gives most of it without a mod.

## 6. A remote switch over project rules

**read**, offset 190,493,654 (`rQn`) and 190,493,254 (`J1r`), the startup memory filter:
`if((e.type==="Project"||e.type==="Local")&&k("tengu_paper_halyard",!1))return!1;`

**read**, offset 193,380,766 (`qln`), the nested load that delivers area files:
`M=k("tengu_paper_halyard",!1);for await(let W of jTr(...))h.push(...await Eln(W.filter((V)=>!M||V.type!=="Project"&&V.type!=="Local"),...))`

`k(name,false)` reads a remote feature flag with `false` as the default. When it is on, both the
unconditional overview and every path-scoped area file under `.claude/rules/` are dropped, since both
are Project memory. **run**: the flag is in 2.1.286, 2.1.287, 2.1.289 and 2.1.290 (3 hits each), and
it is absent from the 818 cached flags in `~/.claude.json` (`cachedGrowthBookFeatures`), so it is off
for this account. The same function takes a second path, `Xne.peek(n.session)?.readFor`, which reads
like a provider that takes over instruction loading. Where that provider comes from was not traced.

Nothing to change. It is a reason to keep the echo hook as the second channel and not fold it into the
rules, and the one-line test for it is cheap: a cached-flags check in `/anatomiya:doctor` could say
"project rules are switched off for this account" if it ever turns on.

## 7. Subagents and worktrees

**doc**, changelog, 2.1.271: "Added `omitClaudeMd` to agent frontmatter and `--agents` JSON, letting
custom and plugin subagents run without user, project and local CLAUDE.md files". **doc**,
[Subagents](https://code.claude.com/docs/en/sub-agents): plugin subagents support `model`, `effort`,
`tools`, `disallowedTools` and `omitClaudeMd`, and "plugin subagents don't support the `hooks`,
`mcpServers`, or `permissionMode` frontmatter fields". **doc**, changelog, 2.1.288: "a plugin-defined
agent spawned by name now runs with its own prompt, tools, disallowedTools and effort instead of the
defaults" (agent teams). `docs/research/what-an-agent-spawn-inherits.md` (2.1.251) found the loader
did not read `omitClaudeMd`. That predates 2.1.271 and should not be cited for current builds.

This opens a path for the reuse check: ship `plugins/anatomiya/agents/<name>.md` with a pinned model,
`effort: medium`, read-only tools, and the search instructions in its prompt, and have the Stop reason
name that agent type. The search would then run on the measured engine whatever the session is set
to. What it costs: the reason changes, so A91's 24 of 24 no longer covers it. Under
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (2.1.257) the agent's model is overridden anyway. A session whose
plugin agents are filtered out would get a reason naming an agent it does not have. And with
`omitClaudeMd` the search agent would also lose the map, which it may need to find the shared module.
Worth a measurement before any change.

**doc**, [Worktrees](https://code.claude.com/docs/en/worktrees):

> A subagent in its own worktree takes the instruction files it starts with from your main
> conversation, not from its worktree. When that worktree is in the default location under
> `.claude/worktrees/`, the subagent also doesn't load the `CLAUDE.md` file or `.claude/rules/`
> directory at the worktree's root as it reads files there

**doc**, changelog, 2.1.286: "Fixed subagents spawned with worktree isolation loading the project
CLAUDE.md and its imports a second time from the worktree copy on their first file read". **read**,
offset 193,378,464 (`Gln`): the nested walk computes a `checkoutTargetPath` for a file inside a linked
worktree, separate from the file's own path. Read together, these suggest a worktree-isolated subagent
gets the main checkout's unconditional rules (the overview) from its parent. That would make part of
anatomiya's worktree wording ("Claude Code loads no rule file from the main checkout into a worktree",
`docs/how-it-works.md`) wrong for this one case, the isolated subagent. Whether the main checkout's
path-scoped area files load for files the subagent reads in its worktree is not settled by reading.
It needs one live run.

## 8. Earlier releases, 2.1.250 to 2.1.285, not yet in the notes here

Only items that touch anatomiya and are not already written up in this directory or in DECISIONS:

- 2.1.274: "Fixed Stop prompt hooks re-sending their whole prompt on every block". Prompt-type hooks
  only. anatomiya's Stop hook is a command.
- 2.1.259: "Fixed blocking Stop hooks causing the turn after a block to lose the model's reasoning
  from that turn". This came before the 2.1.272 reuse measurement, so A91's numbers already include it.
- 2.1.277: "in a project with no CLAUDE.md, Claude Code reads AGENTS.md instead". It does not change
  `.claude/rules/` loading.
- 2.1.283: `/doctor prompt-audit` audits "CLAUDE.md files, skills, agents and commands for prompting
  patterns written for older models". It could be pointed at the rendered map and at
  `plugins/anatomiya/commands/*.md`. Not run here, because it is a model call.
- 2.1.284: "Fixed rules symlinked into `.claude/rules` from outside the project being skipped without
  ever showing the external-imports approval prompt". anatomiya writes real files there (A1, A25).

## Recommended changes, ranked

1. **Rule on the new artifact name.** Add
   `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENTN` to `KEPT` in `test/ab.test.mjs`, in the
   same form as the 2.1.285 and 2.1.286 rows. Adds one row. Deletes nothing. Turns
   `node --test test/ab.test.mjs` green on 2.1.290.
2. **Say that Write and Edit load area files too, from 2.1.288.** Done with this note, at the
   exclusive claims section 1 lists. The overview lines (`render.mjs:648` and `766-767`), the
   glossary and the plugin descriptions are left: none says "only", and a reword of overview text
   changes every map and needs its own measurement.
3. **Re-measure the reuse wording on Opus 5.5.** Re-run the 24 hard cases from
   `docs/research/one-line-that-finds-the-existing-function.md` on `claude-opus-5-5` at `medium`, then
   update A91 and the README number with the result and the build. Adds a results section. Deletes
   nothing unless a wording loses.
4. **Decide the harness pin.** Either move `ENGINE` in `scripts/ab/engine.mjs` to `claude-opus-5-5`
   (the `[1m]` suffix adds nothing on a native 1M model), with the assertions in `test/ab.test.mjs`,
   or keep Opus 5 for comparability and write down why in `docs/research/one-model-one-effort.md`.
   Opus 5 stays callable until at least July 24, 2027.
5. **Measure what the notice adds now.** On the corpus, count first writes into an area nobody has
   read where the notice speaks, and check whether the area file that now arrives with them carries
   the same finding. Keep `notice` either way for paths no glob delivers to and for worktrees. If
   the overlap is total on the paths both cover, the notice can go quiet there, which is A44's own
   goal of saying less.
6. **Try a plugin agent for the reuse search.** Add `plugins/anatomiya/agents/<name>.md` (model,
   `effort: medium`, read-only tools), name it in `reuseReason`, and measure against A91. Adds one
   file and one validated path in `scripts/validate.mjs`. It loses the measured wording until the
   new one is measured.
7. **Watch, no code:** mods (section 5), `tengu_paper_halyard` (section 6), and one live run of a
   worktree-isolated subagent to settle section 7's wording. If the flag ever matters, a cached-flags
   line in `/anatomiya:doctor` is the cheapest guard.

## What could not be verified, and why

- **When a Write-triggered area file is attached** was read, not run. The trigger is pushed after the
  write and drained in the attachment pass, so it should arrive with the next request. No session was
  started, because this note is not allowed to use the account's credentials.
- **Whether the 2.1.290 "plugin hooks ... clipped" line touches settings-hook `additionalContext`.**
  The changelog groups it with mods, and the hooks doc still describes the 10,000-character
  save-to-file rule. The build was not traced for it.
- **What `tengu_paper_halyard` is for**, and what sets `readFor`. Only the gate and the filter were
  read. The flag's purpose is not documented.
- **Worktree-isolated subagents and area files** (section 7) need a live run.
- **How Opus 5.5 treats a Stop hook's block reason** is unmeasured. The prompting guide speaks about
  tool results, web pages and pasted text, not hook output.
- **Teammate transcripts.** 2.1.290 changed an in-process teammate's `agent_id` in Agent results. The
  changelog names Agent results, not hook payloads, and where a teammate's transcript is written was
  not checked, so whether `windowOf` finds it is unknown.
- **Mods' remote switch.** The docs mention that Anthropic can turn installed mods off remotely. The
  flag name and its current value were not looked up.
- **Releases 2.1.250 to 2.1.285 were read for anatomiya's topics only**, by keyword over the
  changelog. 2.1.286 to 2.1.290 were read in full.
