# What an Agent-tool spawn inherits, and what can change it

Research notes, August 2026. Companion to `one-model-one-effort.md`, which established what settles the
effort of a session, and to `what-a-hook-payload-carries.md`, which established what a hook is handed.
This one answers the question those two leave open: when the Agent tool spawns a subagent, what does
that spawn's effort, model and context come from, and which of those a person or a plugin can move.

Issue #131 makes a set of measured claims about exactly that. It was written from a live session on
this build. Every claim below was re-checked against the build rather than against the issue, and the
issue is wrong in three places, all of them consequences rather than readings. The readings it quotes
are correct, verbatim, on 2.1.251.

Every claim carries its source, in the three kinds the companion notes use: **read**, behaviour read
from the installed build, described here rather than quoted; **run**, a command and its output on
this machine, today; **doc**, a first-party page, quoted, with its URL.

The build read and run against is **Claude Code 2.1.251**, the file
`<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes, a Mach-O arm64 executable with its
JavaScript readable inside. The build's internals are minified and move between builds, so this note
names each part by what it does. Every `run` is a headless `claude -p` against
`claude-opus-5[1m]` with a throwaway `--settings` file, `--strict-mcp-config` and
`--no-session-persistence`, in a scratch directory.

## Summary

**A spawn's effort comes from one place and one place only: the agent definition's `effort` field.**
The build turns it into a permission layer at spawn time and nothing downstream of the definition can
add another. There is no tool parameter, no settings key, no subagent-specific environment variable,
and no hook output field. The issue is right, and it is right for a stronger reason than it gives: the
child's permission layers are not the parent's plus something, they are exactly the two-element list
the spawn builds.

**No hook event can reach it.** All 33 hook events the build defines were enumerated, along with the 22
that have a structured output schema. Not one output field touches effort. The reverse is true and
useful: the shared hook input carries `effort.level` on every tool event, so a hook can *read* a spawn's
effort and check that a shadow file took, which is what a staleness check actually needs.

**Three of the issue's consequences do not hold.** Writing an unknown key into `updatedInput` does not
fail schema validation, it is filtered out and the call proceeds. The built-in `Explore` already loads
CLAUDE.md on this build despite setting `omitClaudeMd`, so a hand-written shadow of it costs nothing on
that axis. And the `gitStatus` omission keyed on the name string feeds a cache-warming callback, not
the request, so it is not an omission from the spawn's context either.

**The built-in prompts cannot be extracted from the bundle by a script.** Not because the byte offsets
move, though they do, but because the prompts are not stored as text. They are functions with runtime
branches and interpolated identifiers, assembled at call time. There is no byte range holding the
string an agent actually receives.

For the two questions the shadow-file check needs answered: a project `.claude/agents/` beats a user
one, `CLAUDE_CONFIG_DIR` does move the user one, and an unknown frontmatter key is silently accepted,
so provenance can live inside the file.

## 1. What settles a spawn's effort

### The spawn builds its own permission layers, and one of them is the effort

**read** from the build, the spawn generator takes the resolved agent definition and builds a list
of at most two layers: always a `model` layer holding the spawn's model, and an `effort` layer only
when the definition has an effort, holding the definition's frontmatter `effort:` value. That list is
then handed to the child whole, as the child's permission layers.

It is the child's whole list, not appended to the parent's. The parent's layers do not carry into the
child. Whatever the parent accumulated (a `/effort` in the session, a skill that pushed one) is gone at
the boundary.

### What reads that layer

**read** from the build, unchanged from what the issue quotes: the effort reader walks a context's
permission layers and keeps the last `effort` layer it finds. The effort getter asks it first and
falls back to the session resolver only when it finds none.

Since the spawn's list holds at most one effort layer, the frontmatter effort is the answer outright.
When there is none, the session resolver runs. **read** from the build, it switches on the kind of the
session's effort: at `level` it answers that value, at `default` it answers nothing, and at `inherit`
it reads the `modelSettings` per-model effort table, answering nothing when there is no table, and
otherwise either the table's default or the row for the model it is handed (falling back to the
session's main-loop model).

The session's effort is the session-wide resolution the companion note documented: `CLAUDE_CODE_EFFORT_LEVEL`,
then `--effort`, then settings `ultracode`, then `modelSettings.<model>.effortLevel`, then `effortLevel`,
then the model's catalog `default_effort`. The child's view of app state is a wrapper over the parent's
that overrides only the tool permission context, so the child sees the parent's session effort.

**One detail worth having.** The model the session resolver is handed comes from the child's own
permission layers, from their `model` entry. That entry always exists, because the spawn always puts
one there. So the `modelSettings` per-model effort table is looked up
against the **subagent's** resolved model, not the session's. Anyone running
`CLAUDE_CODE_SUBAGENT_MODEL` alongside a `modelSettings` table is picking the row by the subagent model.

### The precedence chain, in order

| Rank | Source | Evidence |
|---|---|---|
| 1 | agent definition `effort:` | the effort reader finds the layer the spawn built from the definition |
| 2 | session effort at kind `level` | `--effort`, `/effort`, `CLAUDE_CODE_EFFORT_LEVEL`, settings `effortLevel` |
| 3 | `modelSettings` effort row for the **child's** model | the session resolver, kind `inherit`, row lookup |
| 4 | the `modelSettings` effort table's default | the session resolver, kind `inherit`, no row |
| 5 | the model's catalog `default_effort` | downstream of the effort getter, per `one-model-one-effort.md` |

No tool parameter sits above rank 1, and no environment variable sits between 1 and 2. `--effort` on the
CLI cannot single out subagents: it moves the whole session.

### Measured

**run**, a project agent `effprobe` with `effort: low`, a session at `--effort xhigh`, and a
`PreToolUse` hook with matcher `*` writing the payload's `agent_type` and `effort` to a file:

```
{"ev":"PreToolUse","tool":"Agent","effort":{"level":"xhigh"}}
{"ev":"PreToolUse","tool":"Bash","effort":{"level":"xhigh"}}
{"ev":"PreToolUse","tool":"Bash","agent_id":"a67dd1efaa239ed72","agent_type":"effprobe","effort":{"level":"low"}}
```

The discriminating control, same file with the `effort:` line deleted, same session flags:

```
{"ev":"PreToolUse","tool":"Agent","effort":{"level":"xhigh"}}
{"ev":"PreToolUse","tool":"Bash","agent_type":"effprobe","effort":{"level":"xhigh"}}
```

Frontmatter `effort: low` beat `--effort xhigh` on the spawn while the main thread stayed at `xhigh`.
Without the line, the spawn ran at the session's level.

This is a cheaper probe than asking a spawned agent to report its own effort, and it does not depend on
the model being honest about itself. Two spawns of a one-line agent, one `PreToolUse` hook, no reading
of transcripts. It is the shape a staleness check should use.

### One thing can move it after the spawn

**read** from the build, the Skill tool's return pushes an `effort` layer onto the context layers it
hands back when the skill declares an effort.

A skill whose own frontmatter carries an `effort:` pushes a second effort layer while it is active, and
the effort reader takes the last one. So a subagent pinned to `medium` that invokes a skill declaring `xhigh` runs
that skill's turns at `xhigh`. Read, not run.

**Verdict on claim 1: VERIFIED.** The effort reader and the session resolver are exactly as the issue
quotes them and are still there on 2.1.251.

## 2. Whether any hook event can reach it

### The two schemas the issue names

**read** from the build: the `SubagentStart` input is the shared hook input plus `hook_event_name`,
`agent_id` and `agent_type`. Its output takes `hookEventName` and an optional `additionalContext`,
nothing else. The `PreToolUse` output takes `hookEventName` and four optional fields:
`permissionDecision`, `permissionDecisionReason`, `updatedInput` (a record of arbitrary values) and
`additionalContext`.

All three match the issue's quotes byte for byte.

### Every event, not just those two

The issue checked two of them and stated a universal. Here is the whole set. The build defines **33**
input schemas and **22** output schemas; the eleven events with no output schema can only answer with an
exit code and the shared envelope.

The shared envelope, **read** from the build, is the same for every event: optional `continue`,
`suppressOutput`, `stopReason`, `decision` (`approve` or `block`), `systemMessage`,
`terminalSequence`, `reason`, and `hookSpecificOutput`, which is a union of the 22 per-event output
schemas.

Nothing in the envelope names a model, an effort or a permission layer. The 22 members of the union:

| Event | Output fields | Reaches effort |
|---|---|---|
| `PreToolUse` | `permissionDecision`, `permissionDecisionReason`, `updatedInput`, `additionalContext` | no, see below |
| `UserPromptSubmit` | `additionalContext`, `sessionTitle`, `suppressOriginalPrompt` | no |
| `UserPromptExpansion` | `additionalContext`, `suppressOriginalPrompt` | no |
| `SessionStart` | `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills` | no |
| `Setup` | `additionalContext` | no |
| `PreModelSwitch` | `permissionDecision`, `permissionDecisionReason` | no, and it gates a switch rather than choosing one |
| `PostModelSwitch` | `additionalContext` | no |
| `SubagentStart` | `additionalContext` | no |
| `PostToolUse` | `additionalContext`, `classifierContext`, `updatedToolOutput`, `updatedMCPToolOutput` | no, and it is after the fact |
| `PostToolBatch` | `additionalContext` | no |
| `PostToolUseFailure` | `additionalContext` | no |
| `Stop` | `additionalContext` | no |
| `SubagentStop` | `additionalContext` | no |
| `PermissionDenied` | `retry` | no |
| `Notification` | `additionalContext` | no |
| `PermissionRequest` | `decision.behavior` allow with `updatedInput`, `updatedPermissions`; or deny with `message`, `interrupt` | no, see below |
| `CwdChanged` | `watchPaths` | no |
| `FileChanged` | `watchPaths` | no |
| `MessageDisplay` | `displayContent` | no, display only |
| `Elicitation` | `action`, `content` | no |
| `ElicitationResult` | `action`, `content` | no |
| `WorktreeCreate` | `worktreePath` | no |

The eleven with input but no output schema, which therefore cannot return anything but the envelope:
`StopFailure`, `PreCompact`, `PostCompact`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`,
`ConfigChange`, `InstructionsLoaded`, `WorktreeRemove`, `DirectoryAdded`, `SessionEnd`.

Two fields deserve the closer look, because both rewrite a call rather than commenting on one:
`PreToolUse.updatedInput` and `PermissionRequest.decision.updatedInput`. Both are validated against the
tool's own input schema, and the Agent tool's schema has no effort field (section 3). So the conclusion
holds. The `updatedPermissions` field on `PermissionRequest` is a permission-rule list, not a permission
layer, and carries no effort.

**Verdict on claim 2: VERIFIED.** No hook event can set a spawn's effort on this build.

### The sub-claim that is wrong: an unknown key does not fail validation

The issue says:

> Writing an `effort` key in would fail validation: `updatedInput for <tool> failed schema validation`.

It does not. **read** from the build, the validator behind the permission-handler path parses
`updatedInput` against the tool's input schema and, when that fails, drops every issue whose code is
`unrecognized_keys` before deciding whether anything is left to report. The `PreToolUse` path does the
same filtering inline, and denies the call only when issues remain after it.

Both sites drop `unrecognized_keys` issues before deciding. An extra key is not an error, it is
discarded.

**run**, a `PreToolUse` hook on `Bash` returning `permissionDecision:"allow"` with
`updatedInput:{...tool_input, effort:"low", builtAgainst:"2.1.251"}`:

```
$ claude -p "Run the bash command: echo PROBE_OK" ...
PROBE_OK
```

No denial, no warning, the command ran. So the door is not locked, it is missing. A hook that writes an
`effort` key into an Agent call is not refused; the key simply never reaches anything. That is worse
than a refusal for anyone building on it, because the failure is silent.

### The direction that does work: a hook can read the effort

**read** from the build, the base every hook input extends carries `session_id`, `transcript_path`,
`cwd`, an optional `prompt_id`, `permission_mode`, and three optional fields with their own
descriptions. `agent_id` is present only when the hook fires from inside a subagent, absent on the
main thread even in `--agent` sessions, and is the field to tell the two apart by. `agent_type` is the
agent type's name. `effort.level` is the active effort for the current turn after any silent
downgrade for the selected model, also exported to hook commands and Bash as `CLAUDE_EFFORT`; `effort`
is present for hooks that fire in a tool-use context on a model that supports effort, and absent for
session-lifecycle hooks.

Three things a check can use, all free: `agent_id` says whether the call came from inside a spawn,
`agent_type` says which one, and `effort.level` says what it is running at, after any model clamp. The
`CLAUDE_EFFORT` variable is the same value handed to hook commands and to Bash. That is the measurement
in section 1, and it means a plugin can tell a session whether its shadow files are actually taking
effect, without parsing anything.

## 3. The Agent tool's input schema

**read** from the build, three schemas in order. The base holds `description`, `prompt`, an optional
`subagent_type`, an optional `model` and an optional `run_in_background`. The second merges in `name`,
`team_name` and `mode`, the last two described as deprecated and ignored (subagents take the parent's
permission mode, which frontmatter may override), and adds `isolation` (`worktree` or `remote`) and
`cwd`. The third is the variant actually served: it always drops `cwd`, and also drops
`run_in_background` when either of two session-shape checks is true.

The full field set is `description`, `prompt`, `subagent_type`, `model`, `run_in_background`, `name`,
`team_name`, `mode`, `isolation`, `cwd`. Ten, of which two are documented as deprecated and ignored and
two are removed by the served variant depending on session shape. The issue lists five and misses
`run_in_background`, `name`, `team_name`, `mode` and `cwd`. That does not change its point: there is no
`effort`.

The `model` enum is worth noting on its own. It takes `sonnet`, `opus`, `haiku` or `fable`, four family
aliases and nothing else. A caller cannot pass a full model id through the tool, and cannot pass the
`[1m]` suffix. The parameter's own description confirms the model precedence read in section 6: it
says the parameter outranks both the definition's frontmatter model and the configured default
subagent model.

The tool description visible in a live session lists `description`, `prompt`, `subagent_type`, `model`
and `isolation`, which is the served variant with a session-shape check true, so `run_in_background`
is dropped as well as `cwd`. Consistent.

**Verdict on claim 3: VERIFIED** on the substance, with the field list corrected.

## 4. What the frontmatter schema accepts

There are two schemas and one of them is not a schema at all.

### The declared one

**read** from the build, the agent frontmatter schema declares these keys, each with its own
description: `name` and `description` (both required), then optional `model`, `tools`,
`disallowedTools`, `color`, `effort`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`,
`initialPrompt`, `memory`, `background`, `isolation`, `observer`, `observerMessage`,
`observeSubagents`, and `experimental`. The `color` description marks it internal. The `effort`
description allows named levels or an integer. `experimental` is a loose object holding an optional
`cacheTtl`, and its description says unknown keys in it are ignored.

Twenty keys. No `omitClaudeMd`. No `appendSystemPrompt`.

**doc** agrees on seventeen of them. [Subagents](https://code.claude.com/docs/en/sub-agents) documents
`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`,
`mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`,
`experimental`. The three the build accepts and the page does not list are `observer`,
`observerMessage` and `observeSubagents`. Note that `color` is documented on the page while the schema
marks it internal, so that marker is not a reliable read of what is public.

**doc**, the `effort` row, in full: "Effort level when this subagent is active. Overrides the session
effort level." That is the same statement as section 1, from the other side.

### The one that actually runs

The declared schema is never used to load an agent. **read** from the build, the file parser, the
function that turns a markdown file into an agent definition, reads the frontmatter object field by
field by hand. It runs the strict schema check of section 9 for its side effect, refuses a file with no
string `description` with a warning, runs `effort` through the effort parser and warns when that
yields nothing, and returns an object built from an explicit list: base directory, agent type,
when-to-use text, tools, disallowed tools, a system prompt getter, source, file name and path, color
(only from a known palette), model, effort, permission mode, max turns, cache TTL, background, memory,
isolation, observer, observer message and observe-subagents.

The returned object is an explicit allowlist. `omitClaudeMd` and `appendSystemPrompt` are not read and
could not be set even if the schema allowed them.

The valid effort names, **read** from the build, are `low`, `medium`, `high`, `xhigh` and `max`. The
effort parser, **read**, lowercases, applies an alias table, and falls back to `parseInt`. So
`effort: Medium` works and so does an integer, and neither is documented.

There is a third schema, **read** from the build, which validates agents declared inside
`settings.json` rather than as files. Same key set as the file parser reads, no `name` (the record key supplies
it), and it is a plain object rather than a strict one.

**Verdict on claim 4: VERIFIED.** Neither key is accepted, from the declared schema and from the parse
site both.

### Which built-ins set them

**read** from the build, the built-in roster: empty when built-ins are switched off, a separate set in
coordinator mode, and otherwise `general-purpose` always, then `statusline-setup`, the `claude`
catch-all (loaded from another chunk), `Explore` and `Plan` behind one runtime check, the web-reading agent behind
its own, and `claude-code-guide` unless `CLAUDE_CODE_ENTRYPOINT` names one of the SDKs.

| `agentType` | `omitClaudeMd` | `appendSystemPrompt` | `model` |
|---|---|---|---|
| `general-purpose` | no | no | none, so inherit |
| `statusline-setup` | no | no | `sonnet` |
| `claude` | no | **yes** | none |
| `Explore` | **yes** | no | `inherit`, then the Explore model cap (section 6) |
| `Plan` | **yes** | no | `inherit` |
| a web-reading agent (its type name is an imported constant I did not resolve) | **yes** | no | `inherit` |
| `claude-code-guide` | no | no | none |
| `comment-thread-analyst` | **yes** | no | none |

So `appendSystemPrompt` is set by exactly one definition, the `claude` catch-all, as the issue says.
`omitClaudeMd` is set by four, not two. Explore and Plan are the two a person is likely to shadow, so
the issue's list is not wrong for its purpose, but a check that enumerates built-ins should expect four.

### The consequence the issue draws from `omitClaudeMd` does not hold

The issue says:

> `omitClaudeMd`. The built-in `Explore` and `Plan` set it; a shadow cannot, so both start loading
> CLAUDE.md. On a repo with a large one that is real added input on every spawn, working against the
> saving the switch is for.

Measured, that is not what happens, because the built-in already loads it.

**run**, three scratch directories, each spawning `Explore` with the prompt "Reply with the single word
PONG. Use no tools.", with a `PostToolUse` hook on `Agent` recording the tool response's own usage
numbers. Two hold an identical 138,106-byte CLAUDE.md; one holds none. The third also carries a
project-level `.claude/agents/Explore.md` shadowing the built-in.

| Cell | CLAUDE.md | Explore | `totalTokens` |
|---|---|---|---|
| `none` | absent | built-in | 27,255 |
| `big` | 138,106 bytes | built-in | 73,176 |
| `bigshadow` | 138,106 bytes | project shadow | 74,169 |

The built-in Explore paid 45,921 tokens for the CLAUDE.md it is supposed to omit. The shadow paid 993
more than the built-in, and that gap is the tool set, not the memory file: the built-in carries a
`disallowedTools` list of six tools and my one-line shadow declared none, so it loads six more tool
definitions.

A second **run** says the same thing without token arithmetic. A project CLAUDE.md holding a passphrase,
and the subagent's own report captured off the `PostToolUse` payload rather than relayed by the parent
(the parent has the file in its own context and will answer from it if asked to relay):

```
prompt: Without using any tools at all, answer in one line: what is the project passphrase?
        If your context does not contain one, answer NONE.
shadow Explore  -> {"type":"text","text":"ZQ7MARKER4417"}
built-in Explore-> {"type":"text","text":"ZQ7MARKER4417"}
```

The reading that explains it, **read** from the build: when the definition sets `omitClaudeMd` and the
spawn's override supplies no user context of its own, the spawn generator makes a copy of the user
context without `claudeMd`. When the agent type is `Explore` or `Plan`, it makes a copy of the system
context without `gitStatus`.

Those two copies (the user context minus `claudeMd` and the system context minus `gitStatus`) are
used exactly once each in the whole spawn generator, as arguments to the `onCacheSafeParams`
callback. Every call site passes it a parameter of `makeStream`, and its name says
what it is for. The request itself is built from the unstripped values and from the attachments pushed
onto the message list after them.

I did not pin down the route by which CLAUDE.md reaches the subagent, so treat the mechanism as
unconfirmed. The measurement is not in doubt: 45,921 tokens landed in a built-in that sets
`omitClaudeMd`.

**What this means for a shadow.** On this build, shadowing `Explore` or `Plan` costs nothing on the
CLAUDE.md axis, because the built-in was never saving anything. It still costs the tool set if the
shadow forgets `disallowedTools`, which is worth writing into any shadow generated by hand.

### The consequence the issue draws from `appendSystemPrompt` is about the other path

The issue says a shadow of the `claude` catch-all cannot be covered at all, because the built-in appends
to the base prompt and a markdown file replaces. That is true where `appendSystemPrompt` is read, and
that is not the Agent-tool path.

**read** from the build, the function that assembles the main-thread system prompt takes the
main-thread agent definition. When that definition sets `appendSystemPrompt`, it puts the agent's
prompt after the default prompt; otherwise the agent's prompt replaces the default.

Its input is the main-thread agent definition. This is the `--agent` path, where an agent definition
becomes the session's own prompt. The spawn path builds its prompt elsewhere, **read** from the build:
it calls the definition's own prompt getter, with the agent's memory primed, and falls back to a
default prompt if that throws.

One prompt, no append branch. So when `claude` is spawned through the Agent tool its prompt replaces
rather than appends already, and a shadow loses nothing. When it is the main-thread agent under
`--agent`, the shadow genuinely cannot reproduce the append. Read, not run: I did not exercise
`--agent claude`.

There is a separate append that does apply to spawns, gated twice. **read** from the build, the spawn
generator appends the session's subagent append text to the spawn's prompt only when
`CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` is set, the text is present, the spawn is not in an
isolated context, and one more runtime check passes.

That is the `--append-subagent-system-prompt` option behind `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`.
It appends the same text to every spawn, so it is not a per-type lever, but it is the one supported way
to add text to a subagent's system prompt without writing a definition.

## 5. The `gitStatus` omission

**read** from the build, exactly as the issue describes it: the spawn generator drops `gitStatus` from
the system context when the definition's `agentType` is `Explore` or `Plan`.

**Verdict on claim 5: VERIFIED as a reading.** The test is the name string, not the source. The test
runs on the resolved definition, and nothing in it asks whether it came from the built-in roster or from
a file on disk. A user-authored `~/.claude/agents/Explore.md` or `<repo>/.claude/agents/Explore.md`
takes this branch, because its `agentType` is the string `Explore`.

**The consequence is smaller than the issue states.** The stripped system context goes the same way as
the stripped user context in section 4: it is read once, as the `systemContext` argument to `onCacheSafeParams`. So the branch does not remove
gitStatus from what the spawn receives, it removes it from a cache-warming payload. Saying "gitStatus
omission does survive" is true in the narrow sense that the branch still fires for a shadow, but there
is no context saving on either side of it to survive.

Two practical notes fall out. Naming a shadow `Explore` changes what the build does with it, so a
generator must not assume names are inert. And a shadow named anything else, say `Explore-medium`, takes
the other branch, which on this build makes no observable difference but is a behaviour difference
nonetheless.

## 6. `CLAUDE_CODE_SUBAGENT_MODEL`

**read** from the build, one small function reads the variable and answers its value when it is set
to anything other than `inherit`, and `inherit` otherwise.

**read** from the build, the resolver that reports which layer won picks, in order: the Agent tool's
`model` parameter, labelled `tool` (a parameter of `inherit` means the parent's model, labelled
`inherit`); the definition's model, after the Explore cap below, when it is set and not `inherit`,
labelled `frontmatter`; the environment variable when it is not `inherit` and the definition's model
is not `inherit` either, labelled `env`; and otherwise the parent's model, labelled `inherit`.

The build names its own precedence labels: `tool`, `frontmatter`, `env`, `inherit`. A sibling
function, **read**, applies the same order to the value actually used.

The Explore model cap, **read** from the build, is a special case worth knowing about. It applies only
to a definition whose type is `Explore` and whose source is `built-in`; any other definition keeps its
own model. With `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` set it answers `inherit`. Otherwise it
answers the capped model when the parent's model is above it, and `inherit` when not.

It caps the **built-in** Explore's model to `opus` when the parent is above it, and it is scoped by both
name and source. A user-authored `Explore.md` fails the source test and keeps its own model
unchanged. So a shadow of Explore is not subject to the cap, which is the one place where shadowing a
built-in gives you back a lever rather than taking one away.

**Verdict on claim 6: VERIFIED.** The environment variable exists, it is read by that one function, and it sits at
rank 3 of 4: tool parameter, then frontmatter, then the variable, then inheriting the parent. The
issue's line "a `model:` line there would quietly kill the env var for those types" is correct.

The half of the pair that does not exist: there is no `CLAUDE_CODE_SUBAGENT_EFFORT`. The build's whole
set of effort-bearing variable names, **read**, one pass over the bundle, is
`CLAUDE_CODE_EFFORT_LEVEL` (session-wide), `CLAUDE_EFFORT` (exported to hooks and Bash, read-only) and
`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`. The subagent-scoped names are `CLAUDE_CODE_SUBAGENT_MODEL`,
`CLAUDE_CODE_SUBAGENT_CACHE_EVICT`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`,
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`,
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_FORK_SUBAGENT`,
`CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`, `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`,
`CLAUDE_CODE_CCR_LAZY_SUBAGENT_HYDRATE` and `CLAUDE_SUBAGENT_BG_SHELL_MAX_MS`. Model, cache, count,
depth, text and prompt are all covered. Effort is not.

## 7. Whether the built-in prompts can be extracted from the bundle

Not by a script, and the reason is not the offsets.

The three prompts are not stored as text. They are functions that build their text at call time.

**read** from the build: the Explore prompt is a function that first evaluates two runtime predicates,
picks a tool name for each of its search lines from them, and then returns a template string with
those names interpolated. The Plan prompt is a function of the same shape. The general-purpose prompt
is a function returning a template whose opening sentences are a separate string constant
interpolated into it.

Three things follow, and they answer the question the issue's offsets were standing in for.

**The text has holes.** The tool names are identifiers substituted at runtime. A byte range copied out
of the bundle contains the placeholder expression, not the tool name a reader would see.

**The text has branches.** The two predicates are evaluated at runtime. Two of the three prompts emit
different lines depending on them, so there is no single correct answer to extract; there are at least
two per prompt and no way to know from the bytes which one a given session gets.

**The bundler splits literals.** The general-purpose prompt opens with its first sentences as a string
constant interpolated into the template rather than being part of it. That is exactly the observation
behind the issue's "general-purpose is not stored adjacently at all" and its non-UTF-8 byte at a fixed
offset into the other two: those are template-part boundary markers, not prompt content.

So the honest answer to "could a script reliably extract these across builds" is no, and it would still
be no if the offsets were stable, because there is no contiguous region holding the finished string. The
issue's recommendation of a live extraction is right, and it is right for this reason rather than for
the fragility of offsets. Its caveat about an agent declining to print its instructions is the real
cost, and its instruction to cut at the sentence that opens the harness's note about messages from the
launching agent is the right boundary: that sentence is in the harness postamble, not the agent body.

**Verdict on claim 7: the offsets are correct and worthless, and the underlying question resolves
against extraction.**

## 8. Where agent files are read from, and what wins

Three functions, in order.

**Which directories.** **read** from the build, the function that collects agent directories, called
for `agents`, gathers four places: `<config dir>/agents`; `<managed settings dir>/.claude/agents`;
every `<dir>/.claude/agents` from the working directory up to home; and, for agents only,
`.claude/agents` under each additional working directory, minus any already found. It loads them with
sources `policySettings`, `userSettings` (only when user settings are enabled), `projectSettings`, and
`projectSettings` marked as coming from an additional directory.

The walk, **read** from the build, goes up from the working directory and stops at the home
directory, pushing each `<dir>/.claude/agents` that exists. Files are found by ripgrep or by a recursive
walk, `*.md`, following symlinks, so subfolders of `.claude/agents/` count. Duplicate inodes across
sources are dropped, keeping the first, with a debug line naming the source that already loaded it.

**The user directory follows `CLAUDE_CONFIG_DIR`.** **read** from the build, the config directory is
`CLAUDE_CONFIG_DIR` when that is set, else `.claude` under the home directory, chosen with `??` and
normalized to NFC.

So the user-level agents directory is `$CLAUDE_CONFIG_DIR/agents`, not
`$CLAUDE_CONFIG_DIR/.claude/agents`, and it is `~/.claude/agents` when the variable is unset. The
operator is `??`, not `||`, so a variable set to the empty string is taken literally rather than falling
back. Read, not run. A check that resolves the user directory must read the variable; the plugin's own
`settingsFor` in `plugins/ultracode-anywhere/hooks/upstream.mjs` already does the same thing for
`settings.json`, with `||` rather than `??`, which differs only on the empty-string case.

**Which one wins.** **read** from the build, the merge splits the loaded definitions into groups by
source: built-in, plugin, user, project (additional directories first, then the rest sorted by
depth), flag, policy. It writes them group by group into a `Map` keyed on `agentType`, and returns the
map's values sorted by name.

Filled group by group, so the last group to write a key wins. The group order is the precedence,
lowest first:

| Rank | `source` | Where it comes from |
|---|---|---|
| 6, lowest | `built-in` | the built-in roster |
| 5 | `plugin` | a plugin's `agents/` directory |
| 4 | `userSettings` | `$CLAUDE_CONFIG_DIR/agents` or `~/.claude/agents` |
| 3 | `projectSettings` | `<dir>/.claude/agents` walking up from cwd, plus additional working directories |
| 2 | `flagSettings` | the `--agents` CLI flag |
| 1, highest | `policySettings` | managed settings |

**doc** agrees, with the same six rows in the same order:
[Subagents](https://code.claude.com/docs/en/sub-agents) gives "Managed settings" priority 1, "`--agents`
CLI flag" 2, "`.claude/agents/`" 3, "`~/.claude/agents/`" 4, "Plugin's `agents/` directory" 5. Built-in
is not in the page's table; the code puts it below plugins.

**Within the project group, the deepest directory wins.** The depth sort orders by the number of path separators in
`baseDir`, ascending, so the directory nearest the working directory is written last. Additional
working directories are written before all of them, so they lose to any real project directory.

**run**, two nested `.claude/agents` directories with the same agent name, session started in the inner
one:

```
$ claude -p "Print the exact description string of the agent type named shadowtest, verbatim."
INNER_LEVEL_WINS marker for the inner .claude/agents directory.
```

**doc** says the same and dates it: "As of v2.1.178, when more than one of these nested directories
defines the same `name`, Claude Code uses the definition closest to the working directory."

**A shadow check must look in both places, and prefer the project one.** A user-level
`~/.claude/agents/Explore.md` is dead where a project `.claude/agents/Explore.md` exists. Reporting
"present" from the user directory alone would be wrong in exactly the repositories a person is most
likely to have customised.

**One thing the build will not tell you.** Duplicate-name reporting, **read** from the build, groups on
source, base directory and agent type. So two files with the same name in the same directory produce a
duplicate-name debug line, and a user file shadowed by a project file produces
nothing at all. Cross-scope shadowing is silent.

## 9. What the build does with an unknown frontmatter key

It loads the agent, ignores the key, and records one telemetry event. Nothing is printed and nothing is
refused.

The strict schema exists and is used for exactly one thing. **read** from the build, there is a table
of three strict schemas, one each for skill, agent and output-style frontmatter, each the declared
schema made strict. Its only consumer, the strict check, runs the strict parse and, for each issue,
fires a telemetry event: one per unrecognized key, naming the key, and another for any other mismatch,
naming the field and the issue code. It swallows any error of its own.

The event emitter, **read**, deduplicates on surface, event and detail, so each distinct unknown key
fires once. The build names the whole mechanism a frontmatter shadow, which is what it is: a schema run
in parallel with the real parser to find out what people write, with no authority over loading.

The file parser calls it and discards the result. **read** from the build, the call is the first
operand of a comma expression whose second operand is the `description` check, which makes this
explicit. The strict check returns nothing; it runs for its side effect. The parse then proceeds through the
allowlist quoted in section 4.

**run**, a project agent file carrying two invented keys:

```yaml
---
name: probe-unknown-key
description: A probe agent used to test whether an unknown frontmatter key blocks loading.
effort: medium
builtAgainst: 2.1.251
shadowOf: Explore
---
```

```
$ claude -p "List every agent type available to your Agent tool, one per line, names only."
claude
Explore
general-purpose
Plan
probe-unknown-key
statusline-setup
```

The list also held two agents from other installed plugins, left out here.

It loaded, it is addressable, and the session printed no warning.

**So provenance can live in the file.** Two ways, and the difference between them is only the telemetry
event:

- A top-level key such as `builtAgainst: 2.1.251`. Accepted, ignored, one unknown-key telemetry event
  per key per session.
- `experimental: { builtAgainst: "2.1.251" }`. The `experimental` object is declared loose, and its
  description says unknown keys in it are ignored, so no event fires at all. The reader, **read** from
  the build, takes only one key out of it: `cacheTtl`, matched without regard to case, and kept only
  when its value is one of a known set.

Both work today. The top-level form is the more honest one to a human reader and the more likely to
break if the build ever hardens the strict check into a refusal; the `experimental` form is explicitly documented as
a place unknown keys are ignored, so it is the safer bet across builds. Neither is a contract.

The alternative, keeping provenance outside the frontmatter, has one thing going for it that neither of
these does: a comment in the markdown body is read by the agent itself, and a sidecar file is read by
nobody. A key in the frontmatter is read by nothing and costs one telemetry event. If the point is for a
check to read it back, the frontmatter is the right place, because the check is reading the file anyway
and the build will not object.

## 10. What I could not verify

- **The route by which CLAUDE.md reaches a subagent.** Measured, it arrives. The strip in section 4
  feeds only `onCacheSafeParams`, and I did not follow the three attachment builders far enough to
  name the one that carries memory. So
  "the built-in Explore loads CLAUDE.md" is a run, and "`omitClaudeMd` does nothing but shape a cache
  payload" is a read that the run is consistent with, not a proof.
- **User-level against project-level shadowing, by run.** Testing it means either writing into the
  user's home or moving `CLAUDE_CONFIG_DIR`, which relocates credentials as well. I ran the
  project-depth case instead. The cross-scope order is read off the merge and confirmed by **doc**, and
  those two agree, but no measurement of mine backs it.
- **`--agent claude` and the `appendSystemPrompt` branch.** Read only. I did not run a main-thread
  session under an agent definition, so the claim that a shadow of `claude` loses the append on that
  path and only on that path is untested.
- **`policySettings` and `flagSettings`.** Neither was exercised. Their position in the merge is read.
- **The web-reading agent's type name.** It is an imported constant from another chunk and I did not
  resolve it. Its definition does set `omitClaudeMd`.
- **An integer `effort:`.** The effort parser accepts one and the schema documents it. Not run, and not
  documented upstream.
- **Whether `CLAUDE_CONFIG_DIR=""` really takes the empty string.** The `??` is read, not run.
- **Whether any of this survives 2.1.252.** The build's internals are minified and move between
  builds. The behaviour has held across at least the two builds this note and its companions
  were written against, but the note is a snapshot, not a contract.

## 11. Verdicts

| # | Claim from issue #131 | Verdict |
|---|---|---|
| 1 | Frontmatter `effort:` beats `effortLevel` and `modelSettings` | **VERIFIED**, and it beats everything else too; nothing outranks it |
| 2 | No hook event can set a spawn's effort | **VERIFIED** across all 33 events; the sub-claim that an extra `updatedInput` key fails validation is **REFUTED** |
| 3 | The Agent tool's input schema has no `effort` | **VERIFIED**; the field list in the issue is five of ten |
| 4 | `omitClaudeMd` and `appendSystemPrompt` are not frontmatter keys | **VERIFIED**; four built-ins set `omitClaudeMd`, not two; both stated consequences are **REFUTED** for the Agent-tool path |
| 5 | `gitStatus` omission is keyed by the name string | **VERIFIED** as a reading; the consequence is **REFUTED**, it feeds a cache callback |
| 6 | `CLAUDE_CODE_SUBAGENT_MODEL` covers the model half | **VERIFIED**; precedence is tool, frontmatter, env, inherit, named by the build itself |
| 7 | Byte offsets for the three built-in prompts | correct and not worth recording; extraction from the bundle is **not possible** by a script, for a better reason |

## 12. What a check built on this can and cannot say

> The notice this section designs was built, shipped as `hooks/shadows.mjs` under
> `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT`, and removed again in ultracode-anywhere 0.6.0: the plugin
> ships its own agent types now, each carrying `effort:`, so there is nothing left to report on. The
> reading below is kept because it is the reading, and because the next question about how a spawn
> resolves its agent file starts here (A48, A58).

Pulling the actionable parts together, for the `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT` notice the issue
asks for.

**It can find the files.** Look in `$CLAUDE_CONFIG_DIR/agents` or `~/.claude/agents`, and in every
`<dir>/.claude/agents` from the working directory up to the home directory, recursing into subfolders.
Report the winner by the order in section 8, deepest project directory first, and say which file won
when more than one matches, because the build itself will not say so across scopes.

**It can read the `effort:` line without a schema.** The parse is case-folded through the effort parser
against `low`, `medium`, `high`, `xhigh` and `max`, or an integer. Anything else produces a warning line from the
build and no effort at all, which is the silent-failure case worth naming.

**It can record and read back its own provenance.** A `builtAgainst:` key, top-level or under
`experimental:`, is accepted and ignored. That is the whole of what the issue's staleness ask needs.

**It can verify a shadow actually took, without a model in the loop.** One `PreToolUse` hook, matcher
`*`, reading `agent_type` and `effort.level` off the payload, and one spawn. That is a real end-to-end
check rather than a claim about files.

**It cannot set anything.** Not through a hook, not through a reminder, not through the tool. The model
has no `effort` argument to pass on an Agent call, so the text route that worked for workflow stages is
closed here, and a reminder asking for one would be asking for something that does not exist.

**Two things it should stop warning about.** A shadow of `Explore` or `Plan` does not start loading
CLAUDE.md, because the built-in already does. And a shadow of `claude` spawned through the Agent tool
does not lose an append, because that path never appends. Both are worth a line in a README only if the
line says what is actually true.

## Addendum, 2026-09-22

`plugins/ultracode-anywhere/` was removed from this repository. The build reader this note
cites (`cliPath`, `MIN_BUNDLE`, `settingsFor`) lives at `scripts/claude-build.mjs` now; the
paths above are where it sat when the measurements were taken.
