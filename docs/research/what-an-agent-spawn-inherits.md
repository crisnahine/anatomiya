# What an Agent-tool spawn inherits, and what can change it

Research notes, August 2026. Companion to `one-model-one-effort.md`, which established what settles the
effort of a session, and to `what-a-hook-payload-carries.md`, which established what a hook is handed.
This one answers the question those two leave open: when the Agent tool spawns a subagent, what does
that spawn's effort, model and context come from, and which of those a person or a plugin can move.

Issue #131 makes a set of measured claims about exactly that. It was written from a live session on
this build. Every claim below was re-checked against the build rather than against the issue, and the
issue is wrong in three places, all of them consequences rather than readings. The readings it quotes
are correct, verbatim, on 2.1.251.

Every claim carries its source, in the three kinds the companion notes use: **read**, a string or a
function recovered from the installed build with its byte offset; **run**, a command and its output on
this machine, today; **doc**, a first-party page, quoted, with its URL.

The build read and run against is **Claude Code 2.1.251**, the file
`<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes, a Mach-O arm64 executable with its
JavaScript readable inside. Offsets are into that file and are one build's addresses; the identifiers
are minified and change between builds. Every `run` is a headless `claude -p` against
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

**read**, offset 160,980,291, the spawn generator, and offset 160,983,231, the layers it builds:

```js
async function*Bb({agentDefinition:e,promptMessages:t,toolUseContext:r,canUseTool:o,isAsync:u,
  canShowPermissionPrompts:d,forkContextMessages:_,querySource:C,forkOrigin:A,spawnedBySkill:x,
  spawnedByForkedSkill:M,override:F,model:U,maxTurns:B,...}){
  ...
  fs=[{kind:"model",mainLoopModel:mn},...e.effort!==void 0?[{kind:"effort",effort:e.effort}]:[]],
```

`e` is the resolved agent definition. `e.effort` is its frontmatter `effort:` line. The list `fs` is
then handed to the child whole, **read**, offset 160,989,641:

```js
gs=kan(r,{options:di,session:ht,agentId:Sn,isBackgroundAgent:u,agentType:e.agentType,...,
  permissionLayers:fs,shareSetAppState:!u,...})
```

`permissionLayers:fs`, not `[...r.permissionLayers, ...fs]`. The parent's layers do not carry into the
child. Whatever the parent accumulated (a `/effort` in the session, a skill that pushed one) is gone at
the boundary.

### What reads that layer

**read**, offsets 158,548,009 and 158,548,102, unchanged from what the issue quotes:

```js
function Djt(e){let o;if(!e)return o;for(let t of e)if(t.kind==="effort")o=t.effort;return o}
function tu(e){return Djt(e.permissionLayers)??il(e.getAppState(),c(e))}
```

`Djt` takes the last effort layer. Since `fs` holds at most one, the frontmatter effort is the answer
outright. When there is none, `il` runs. **read**, offset 156,651,852:

```js
function il(e,o){let t=e.sessionEffort??F;switch(t.kind){
  case"level":return t.value;
  case"default":return;
  case"inherit":if(e.settingsEffortTable===void 0)return;
    if(!W(e.settingsEffortTable))return e.settingsEffortTable.default;
    return G(e.settingsEffortTable,o??e.mainLoopModelForSession??e.mainLoopModel??el())}}
```

`sessionEffort` is the session-wide resolution the companion note documented: `CLAUDE_CODE_EFFORT_LEVEL`,
then `--effort`, then settings `ultracode`, then `modelSettings.<model>.effortLevel`, then `effortLevel`,
then the model's catalog `default_effort`. The child's `getAppState` is a wrapper over the parent's that
overrides only `toolPermissionContext`, so the child sees the parent's `sessionEffort`.

**One detail worth having.** The second argument to `il` is `c(e)`, which walks the child's own
permission layers for a `kind:"model"` entry. That entry always exists, because `fs` always puts one
there. So `settingsEffortTable`, which is the `modelSettings` per-model effort table, is looked up
against the **subagent's** resolved model, not the session's. Anyone running
`CLAUDE_CODE_SUBAGENT_MODEL` alongside a `modelSettings` table is picking the row by the subagent model.

### The precedence chain, in order

| Rank | Source | Evidence |
|---|---|---|
| 1 | agent definition `effort:` | `Djt(fs)` finds the layer the spawn built from `e.effort` |
| 2 | `sessionEffort` at kind `level` | `--effort`, `/effort`, `CLAUDE_CODE_EFFORT_LEVEL`, settings `effortLevel` |
| 3 | `settingsEffortTable` row for the **child's** model | `il`, kind `inherit`, `G(table, o)` |
| 4 | `settingsEffortTable.default` | `il`, kind `inherit`, no row |
| 5 | the model's catalog `default_effort` | downstream of `tu`, per `one-model-one-effort.md` |

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

**read**, offset 161,212,865, the Skill tool's return:

```js
if(Ce!==void 0)nn.push({kind:"effort",effort:Ce});
return F=!0,{data:{...},newMessages:en,...nn.length>0&&{contextLayers:nn}}
```

A skill whose own frontmatter carries an `effort:` pushes a second effort layer while it is active, and
`Djt` takes the last one. So a subagent pinned to `medium` that invokes a skill declaring `xhigh` runs
that skill's turns at `xhigh`. Read, not run.

**Verdict on claim 1: VERIFIED.** The identifiers `Djt` and `il` are exactly as the issue quotes them
and are still there on 2.1.251.

## 2. Whether any hook event can reach it

### The two schemas the issue names

**read**, offset 155,759,285, the `SubagentStart` input:

```js
QQ=m(()=>Ee().and(f({hook_event_name:N("SubagentStart"),agent_id:i(),agent_type:i()})))
```

**read**, offset 155,767,841, its output:

```js
UJ=m(()=>f({hookEventName:N("SubagentStart"),additionalContext:i().optional()}))
```

**read**, offset 155,766,285, the `PreToolUse` output:

```js
vJ=m(()=>f({hookEventName:N("PreToolUse"),permissionDecision:xQ().optional(),
  permissionDecisionReason:i().optional(),updatedInput:De(i(),_e()).optional(),
  additionalContext:i().optional()}))
```

All three match the issue byte for byte, identifiers included.

### Every event, not just those two

The issue checked two of them and stated a universal. Here is the whole set. The build defines **33**
input schemas and **22** output schemas; the eleven events with no output schema can only answer with an
exit code and the shared envelope.

The shared envelope, **read**, offset 155,771,943, is the same for every event:

```js
JJ=m(()=>f({continue:q().optional(),suppressOutput:q().optional(),stopReason:i().optional(),
  decision:ie(["approve","block"]).optional(),systemMessage:i().optional(),
  terminalSequence:i().optional().describe(...),reason:i().optional(),
  hookSpecificOutput:dt([vJ(),wJ(),PJ(),DJ(),IJ(),NJ(),xJ(),UJ(),zJ(),HJ(),FJ(),VJ(),GJ(),KJ(),jJ(),
    WJ(),ZJ(),e5(),YJ(),XJ(),t5(),QJ()]).optional()}))
```

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

It does not. **read**, offset 161,617,898, the validator behind the permission-handler path:

```js
function bUn(e,t){let r=e.safeParse(t);if(r.success)return null;
  let o=r.error.issues.filter((u)=>u.code!=="unrecognized_keys");
  return o.length>0?o:null}
```

And **read**, offset 160,222,121, the `PreToolUse` path, which does the same filtering inline:

```js
if(W.updatedInput!==void 0){
  let z=t.inputSchema.safeParse(W.updatedInput),
      me=z.success?[]:z.error.issues.filter((fe)=>fe.code!=="unrecognized_keys");
  if(!z.success&&me.length>0){ ... behavior:"deny" ... }}
```

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

**read**, offset 155,752,284, the base every hook input extends:

```js
Ee=m(()=>f({session_id:i(),transcript_path:i(),cwd:i(),prompt_id:i().optional()...,
  permission_mode:i().optional(),
  agent_id:i().optional().describe("Subagent identifier. Present only when the hook fires from within
    a subagent (e.g., a tool called by an AgentTool worker). Absent for the main thread, even in
    --agent sessions. Use this field (not agent_type) to distinguish subagent calls from main-thread
    calls."),
  agent_type:i().optional().describe('Agent type name (e.g., "general-purpose", "code-reviewer")...'),
  effort:f({level:i().describe('Active effort level for the current turn (e.g., "low", "medium",
    "high", "xhigh", "max"), after any silent downgrade for the selected model. Also exposed to hook
    commands and Bash as the CLAUDE_EFFORT env var.')}).optional().describe("Reasoning effort applied
    to the current turn. ... Present for hooks that fire within a tool-use context (PreToolUse,
    PostToolUse, Stop, SubagentStop, etc.) on a model that supports the effort parameter; absent for
    session-lifecycle hooks and models without effort support.")}))
```

Three things a check can use, all free: `agent_id` says whether the call came from inside a spawn,
`agent_type` says which one, and `effort.level` says what it is running at, after any model clamp. The
`CLAUDE_EFFORT` variable is the same value handed to hook commands and to Bash. That is the measurement
in section 1, and it means a plugin can tell a session whether its shadow files are actually taking
effect, without parsing anything.

## 3. The Agent tool's input schema

**read**, offsets 161,105,895, 161,107,290 and 161,108,642, the three schemas in order:

```js
var vxn=m(()=>f({
  description:i().describe("A short (3-5 word) description of the task"),
  prompt:i().describe("The task for the agent to perform"),
  subagent_type:i().optional().describe("The type of specialized agent to use for this task"),
  model:ie(["sonnet","opus","haiku","fable"]).optional().describe(`Optional model override for this
    agent. Takes precedence over the agent definition's model frontmatter and the configured default
    subagent model. ...`),
  run_in_background:q().optional().describe(...)}));

Exn=m(()=>{let e=f({name:...,team_name:...("Deprecated; ignored."),
    mode:yir().optional().describe("Deprecated; ignored. Subagents inherit the parent session's
      permission mode; agent-definition frontmatter may override it.")});
  return vxn().merge(e).extend({
    isolation:ie(["worktree","remote"]).optional().describe(...),
    cwd:i().optional().describe(...)})});

cln=m(()=>{let e=Exn().omit({cwd:!0});return $d()||TG()?e.omit({run_in_background:!0}):e})
```

The full field set is `description`, `prompt`, `subagent_type`, `model`, `run_in_background`, `name`,
`team_name`, `mode`, `isolation`, `cwd`. Ten, of which two are documented as deprecated and ignored and
two are removed by the served variant depending on session shape. The issue lists five and misses
`run_in_background`, `name`, `team_name`, `mode` and `cwd`. That does not change its point: there is no
`effort`.

The `model` enum is worth noting on its own. It is `["sonnet","opus","haiku","fable"]`, four family
aliases and nothing else. A caller cannot pass a full model id through the tool, and cannot pass the
`[1m]` suffix. The description confirms the model precedence read in section 6: "Takes precedence over
the agent definition's model frontmatter and the configured default subagent model."

The tool description visible in a live session lists `description`, `prompt`, `subagent_type`, `model`
and `isolation`, which is `cln` with `$d()||TG()` true, so `run_in_background` is dropped as well as
`cwd`. Consistent.

**Verdict on claim 3: VERIFIED** on the substance, with the field list corrected.

## 4. What the frontmatter schema accepts

There are two schemas and one of them is not a schema at all.

### The declared one

**read**, offset 159,666,233, the agent frontmatter schema, every key with its own description:

```js
S9t=m(()=>f({
  name:uu().describe("Agent identifier. Required — this is how the Agent tool and `--agent` flag address it."),
  description:uu().describe("When to use this agent. Required — shown in the Agent tool listing."),
  model:uu().optional().describe("Model override for this agent. Use `inherit` to match the spawning conversation."),
  tools:lE().optional().describe("Tools available to this agent. Replaces the default set."),
  disallowedTools:lE().optional().describe("Tools removed from the default set. Ignored if `tools` is set."),
  color:uu().optional().describe("@internal — display color in the agents UI"),
  effort:uu().optional().describe("Thinking effort: `low`, `medium`, `high`, `max`, or an integer."),
  permissionMode:uu().optional().describe("Permission mode the agent runs in."),
  mcpServers:_e().optional().describe("MCP servers to connect when this agent runs."),
  hooks:_e().optional().describe("Hooks registered while this agent runs."),
  maxTurns:dt([v(),i(),dS()]).optional().describe("Maximum conversation turns before the agent stops."),
  skills:lE().optional().describe("Skills preloaded for this agent."),
  initialPrompt:uu().optional().describe("Auto-submitted first message when this agent runs as the main
    session (via `--agent` or settings). Not read when spawned as a subagent."),
  memory:uu().optional().describe("Memory scope: `user`, `project`, or `local`."),
  background:cE().optional().describe("If true, the agent runs in the background by default."),
  isolation:uu().optional().describe("Filesystem isolation: `worktree` runs in a temporary git worktree."),
  observer:uu().optional().describe("Agent type auto-spawned as a background observer whenever this agent runs."),
  observerMessage:uu().optional().describe("Supplemental postamble appended (after the harness-owned
    default) to each activity digest sent to the observer."),
  observeSubagents:cE().optional().describe("If false, subagents this agent spawns do not inherit its
    observer. Defaults to true."),
  experimental:f({cacheTtl:uu().optional().describe(...)}).loose().nullable().optional()
    .describe("Experimental per-agent options; unknown keys are ignored.")}))
```

Twenty keys. No `omitClaudeMd`. No `appendSystemPrompt`.

**doc** agrees on seventeen of them. [Subagents](https://code.claude.com/docs/en/sub-agents) documents
`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`,
`mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`,
`experimental`. The three the build accepts and the page does not list are `observer`,
`observerMessage` and `observeSubagents`. Note that `color` is documented on the page while the schema
marks it `@internal`, so the `@internal` marker is not a reliable read of what is public.

**doc**, the `effort` row, in full: "Effort level when this subagent is active. Overrides the session
effort level." That is the same statement as section 1, from the other side.

### The one that actually runs

`S9t` is never used to load an agent. **read**, offset 160,492,405, `ngr`, the function that turns a
markdown file into an agent definition, reads the frontmatter object field by field by hand:

```js
if(uE("agent",r),!_||typeof _!=="string")return n(`Agent file ${e} is missing required 'description' in frontmatter`),null;
...
let pe=r.effort,ge=pe!==void 0?xk(pe):void 0;
if(pe!==void 0&&ge===void 0)n(`Agent file ${e} has invalid effort '${pe}'. Valid options: ${Uh.join(", ")} or an integer`);
...
return{baseDir:t,agentType:d,whenToUse:_,...Fe!==void 0&&{tools:Fe},...We!==void 0&&{disallowedTools:We},
  ...,getSystemPrompt:(dn)=>{...},source:u,filename:Be,filePath:e,
  ...C&&typeof C==="string"&&ef.includes(C)&&{color:C},...x!==void 0&&{model:x},
  ...ge!==void 0&&{effort:ge},...Oe&&{permissionMode:Ce},...Pe!==void 0&&{maxTurns:Pe},
  ...Ie!==void 0&&{cacheTtl:Ie},...F&&{background:F},...W&&{memory:W},...fe&&{isolation:fe},
  ...en!==void 0&&{observer:en},...Pt!==void 0&&{observerMessage:Pt},...lt!==void 0&&{observeSubagents:lt}}
```

The returned object is an explicit allowlist. `omitClaudeMd` and `appendSystemPrompt` are not read and
could not be set even if the schema allowed them.

`Uh` is **read**, offset 156,646,394: `Uh=["low","medium","high","xhigh","max"]`. The parser is `xk`,
**read**, offset 156,649,719, which lowercases, applies an alias table, and falls back to
`parseInt`. So `effort: Medium` works and so does an integer, and neither is documented.

There is a third schema, **read**, offset 160,485,754, `Lnt`, which validates agents declared inside
`settings.json` rather than as files. Same key set as `ngr` reads, no `name` (the record key supplies
it), and it is a plain object rather than a strict one.

**Verdict on claim 4: VERIFIED.** Neither key is accepted, from the declared schema and from the parse
site both.

### Which built-ins set them

**read**, offset 160,484,308, the built-in roster:

```js
function _ee(){let e=EZ();if(e==="none")return[];
  if(e==="coordinator"){...return o()}
  let t=[MB];
  if(!Dr())t.push(xnt);
  if(!iMe()){let{CLAUDE_AGENT:o}=import.meta.require("/$bunfs/root/chunk-5gtk87p8.js");t.push(o)}
  if(pI())t.push(lb,I2);
  if(CZ())t.push(Kxe);
  if(a.CLAUDE_CODE_ENTRYPOINT!=="sdk-ts"&&...!=="sdk-py"&&...!=="sdk-cli")t.push(Pnt);
  return t}
```

| Definition | `agentType` | offset | `omitClaudeMd` | `appendSystemPrompt` | `model` |
|---|---|---|---|---|---|
| `MB` | `general-purpose` | 160,469,389 | no | no | none, so inherit |
| `xnt` | `statusline-setup` | 160,479,999 | no | no | `sonnet` |
| `zae` | `claude` | 164,948,223 | no | **yes** | none |
| `lb` | `Explore` | 159,228,062 | **yes** | no | `inherit`, then `N8` |
| `I2` | `Plan` | 159,231,157 | **yes** | no | `inherit` |
| `Kxe` | a web-reading agent (`agentType:Dc`, an imported constant I did not resolve) | 160,482,179 | **yes** | no | `inherit` |
| `Pnt` | `claude-code-guide` | 160,465,396 | no | no | none |
| `COMMENT_ANALYST_AGENT` | `comment-thread-analyst` | 180,290,623 | **yes** | no | none |

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
more than the built-in, and that gap is the tool set, not the memory file: the built-in carries
`disallowedTools:[yt,Si,Wh,Kt,ar,mc]` and my one-line shadow declared none, so it loads six more tool
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

The reading that explains it: **read**, offset 160,981,623, the strip, and offset 160,990,614, the only
place its result is consumed:

```js
zn=e.omitClaudeMd&&!F?.userContext,{claudeMd:br,...Nr}=jn,Lr=zn?Nr:jn,
{gitStatus:wn,...Qn}=Tn,mr=e.agentType==="Explore"||e.agentType==="Plan"?Qn:Tn,
...
if(ge){let lr=[...hn];Ki=lr,ge({systemPrompt:In,userContext:Lr,systemContext:mr,toolUseContext:gs,
  forkContextMessages:hn,stickyBetas:Ga,agentCacheTtlOverride:e.cacheTtl},()=>lr)}
```

`Lr` (the user context minus `claudeMd`) and `mr` (the system context minus `gitStatus`) appear exactly
once each in the whole spawn generator, as arguments to `ge`, which is the destructured
`onCacheSafeParams` callback. Every call site passes it a parameter of `makeStream`, and its name says
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

**read**, offset 160,495,839:

```js
function K_n({mainThreadAgentDefinition:e,toolUseContext:t,customSystemPrompt:r,defaultSystemPrompt:o,
  appendSystemPrompt:u,overrideSystemPrompt:d,skillsPersistencePrompt:_,analysisOnly:C}){
  ...
  if(A&&e?.appendSystemPrompt)return{prompt:pi([...x,A,..._?[_]:[],...u?[u]:[]]),servesDefault:M};
  return{prompt:pi([...A?[A]:x,..._?[_]:[],...u?[u]:[]]),servesDefault:!A&&M}}
```

The parameter is `mainThreadAgentDefinition`. This is the `--agent` path, where an agent definition
becomes the session's own prompt. The spawn path builds its prompt elsewhere, **read**, offset
160,997,235:

```js
function FRn(e,t,r,o){try{let u=await bLe(e,t.storageV5),
  d=e.getSystemPrompt({toolUseContext:t,primedAgentMemory:u});return await zH([d],r,o)}
  catch(u){return zH([vKe],r,o)}}
```

One prompt, no append branch. So when `claude` is spawned through the Agent tool its prompt replaces
rather than appends already, and a shadow loses nothing. When it is the main-thread agent under
`--agent`, the shadow genuinely cannot reproduce the append. Read, not run: I did not exercise
`--agent claude`.

There is a separate append that does apply to spawns, gated twice. **read**, offset 160,981,000 region:

```js
In=!Ee&&!F?.isolatedContext&&Me(process.env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT)
   &&r.options.appendSubagentSystemPrompt?pi([...xn,r.options.appendSubagentSystemPrompt]):xn
```

That is the `--append-subagent-system-prompt` option behind `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`.
It appends the same text to every spawn, so it is not a per-type lever, but it is the one supported way
to add text to a subagent's system prompt without writing a definition.

## 5. The `gitStatus` omission

**read**, offset 160,981,717, exactly as the issue quotes it:

```js
{gitStatus:wn,...Qn}=Tn,mr=e.agentType==="Explore"||e.agentType==="Plan"?Qn:Tn
```

**Verdict on claim 5: VERIFIED as a reading.** The test is the name string, not the source. `e` is the
resolved definition, and nothing in that expression asks whether it came from the built-in roster or from
a file on disk. A user-authored `~/.claude/agents/Explore.md` or `<repo>/.claude/agents/Explore.md`
takes this branch, because its `agentType` is the string `Explore`.

**The consequence is smaller than the issue states.** `mr` is the same value as `Lr` in section 4: it
is read once, as the `systemContext` argument to `onCacheSafeParams`. So the branch does not remove
gitStatus from what the spawn receives, it removes it from a cache-warming payload. Saying "gitStatus
omission does survive" is true in the narrow sense that the branch still fires for a shadow, but there
is no context saving on either side of it to survive.

Two practical notes fall out. Naming a shadow `Explore` changes what the build does with it, so a
generator must not assume names are inert. And a shadow named anything else, say `Explore-medium`, takes
the other branch, which on this build makes no observable difference but is a behaviour difference
nonetheless.

## 6. `CLAUDE_CODE_SUBAGENT_MODEL`

**read**, offset 160,444,993:

```js
function s7(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL;return e&&e!=="inherit"?e:"inherit"}
```

**read**, offset 160,445,908, the resolver that reports which layer won:

```js
function mnt(e,t,r,o,u,d){if(d===void 0)return q0(e,t,r,o,u);
  let _,C=q0(e,t,r,o,(W,z,me)=>{_=me,u?.(W,z)}),A=s7(),
  [x,M]=r?r==="inherit"?[t,"inherit"]:[r,"tool"]
        :e&&e!=="inherit"?[e,"frontmatter"]
        :e!=="inherit"&&A!=="inherit"?[A,"env"]
        :[t,"inherit"],
  ...
  B={source:c(d),precedence:c(M),...}}
```

The build names its own precedence labels: `tool`, `frontmatter`, `env`, `inherit`. `r` is the Agent
tool's `model` parameter, `e` is the agent definition's model as filtered by `N8`, `A` is the
environment variable, `t` is the parent's model. `q0`, **read**, offset 160,445,078, applies the same
order to the value actually used.

`N8`, **read**, offset 159,228,250, is a special case worth knowing about:

```js
function N8(e,t){if(e.agentType!==lb.agentType||e.source!=="built-in")return e.model;
  if(a.CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP)return"inherit";
  return iKt(t)?gUe:"inherit"}
```

It caps the **built-in** Explore's model to `opus` when the parent is above it, and it is scoped by both
name and source. A user-authored `Explore.md` fails `e.source!=="built-in"` and returns `e.model`
unchanged. So a shadow of Explore is not subject to the cap, which is the one place where shadowing a
built-in gives you back a lever rather than taking one away.

**Verdict on claim 6: VERIFIED.** The environment variable exists, it is read by `s7`, and it sits at
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

**read**, offset 159,224,660, the Explore prompt:

```js
function rKt(){let e=as(),t=e?Qe:Bt,r=Ny()&&e,
  o=r?`- Use \`find\` via ${Qe} for broad file pattern matching`:`- Use ${ti} for broad file pattern matching`,
  u=r?`- Use \`grep\` via ${Qe} for searching file contents with regex`:`- Use ${Xo} for searching file contents with regex`;
  return`You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. ...
```

**read**, offset 159,228,571, the Plan prompt, same shape:

```js
function aKt(){let e=as(),t=e?Qe:Bt,r=Ny()&&e;
  return`You are a software architect and planning specialist for Claude Code. ...
```

**read**, offset 160,467,902, the general-purpose prompt:

```js
function A_n(){return`${"You are an agent for Claude Code, Anthropic's official CLI for Claude. Given
the user's message, you should use the tools available to complete the task. Complete the task fully—
don't gold-plate, but don't leave it half-done."} When you complete the task, respond with a concise
report ...
```

Three things follow, and they answer the question the issue's offsets were standing in for.

**The text has holes.** `${Qe}`, `${ti}`, `${Xo}` are tool-name identifiers substituted at runtime. A
byte range copied out of the bundle contains the literal `${Qe}`, not the tool name a reader would see.

**The text has branches.** `as()` and `Ny()` are runtime predicates. Two of the three prompts emit
different lines depending on them, so there is no single correct answer to extract; there are at least
two per prompt and no way to know from the bytes which one a given session gets.

**The bundler splits literals.** `A_n` opens with `${"You are an agent for Claude Code..."}`, a string
constant interpolated into the template rather than being part of it. That is exactly the observation
behind the issue's "general-purpose is not stored adjacently at all" and its non-UTF-8 byte at a fixed
offset into the other two: those are template-part boundary markers, not prompt content.

So the honest answer to "could a script reliably extract these across builds" is no, and it would still
be no if the offsets were stable, because there is no contiguous region holding the finished string. The
issue's recommendation of a live extraction is right, and it is right for this reason rather than for
the fragility of offsets. Its caveat about an agent declining to print its instructions is the real
cost, and its instruction to cut at `Messages from the agent that launched you` is the right boundary:
that sentence is in the harness postamble, not the agent body.

**Verdict on claim 7: the offsets are correct and worthless, and the underlying question resolves
against extraction.**

## 8. Where agent files are read from, and what wins

Three functions, in order.

**Which directories.** **read**, offset 159,671,313, `I9t`, called with `e="agents"`:

```js
async function I9t(e,t,r){let o=Date.now(),
  u=Rw(be(),e),                                   // <config dir>/agents
  d=Rw(ib(),".claude",e),                         // <managed settings dir>/.claude/agents
  _=await vG(e,t),                                // every <dir>/.claude/agents from cwd up to home
  C=new Set(await Promise.all(_.map(...))),
  A=e==="agents"?te(await Promise.all(Km().map(async(Ie)=>{                 // agents only:
      let Be=Rw($fe(Ie),".claude",e);return await Nfe(Be).catch(()=>Be)})))  // additional working
    .filter((Ie)=>!C.has($p(Ie))):[],                                        // directories
  ...
  [B,W,z,me]=await Promise.all([
    sP(d,r).then(...({...Be,baseDir:d,source:"policySettings"})),
    _o("userSettings")&&!F?(...).then(...({...Be,baseDir:u,source:"userSettings"})):[],
    U?Promise.all(_.map((Ie)=>sP(Ie,r).then(...({...Fe,baseDir:Ie,source:"projectSettings"})))):[],
    U?Promise.all(A.map((Ie)=>sP(Ie,r).then(...({...Fe,baseDir:Ie,source:"projectSettings",
        fromAdditionalDirectory:!0})))):[]]),
```

`vG`, **read**, offset 159,670,852, walks up from the working directory and stops at the home
directory, pushing each `<dir>/.claude/agents` that exists. Files are found by ripgrep or by a recursive
walk, `*.md`, following symlinks, so subfolders of `.claude/agents/` count. Duplicate inodes across
sources are dropped, keeping the first, with a debug line naming the source that already loaded it.

**The user directory follows `CLAUDE_CONFIG_DIR`.** **read**, offset 154,121,873:

```js
function s(){return process.env.CLAUDE_CONFIG_DIR}
var be=si(()=>(s()??i(g(),".claude")).normalize("NFC"),s);
```

So the user-level agents directory is `$CLAUDE_CONFIG_DIR/agents`, not
`$CLAUDE_CONFIG_DIR/.claude/agents`, and it is `~/.claude/agents` when the variable is unset. The
operator is `??`, not `||`, so a variable set to the empty string is taken literally rather than falling
back. Read, not run. A check that resolves the user directory must read the variable; the plugin's own
`settingsFor` in `plugins/ultracode-anywhere/hooks/upstream.mjs` already does the same thing for
`settings.json`, with `||` rather than `??`, which differs only on the empty-string case.

**Which one wins.** **read**, offset 160,486,837:

```js
function Sye(e){
  let t=e.filter((M)=>M.source==="built-in"),
      r=e.filter((M)=>M.source==="plugin"),
      o=e.filter((M)=>M.source==="userSettings"),
      d=[...e.filter((M)=>M.source==="projectSettings"&&M.fromAdditionalDirectory),
         ...e.filter((M)=>M.source==="projectSettings"&&!M.fromAdditionalDirectory).sort(S6)],
      _=e.filter((M)=>M.source==="policySettings"),
      C=e.filter((M)=>M.source==="flagSettings"),
      A=[t,r,o,d,C,_],x=new Map;
  for(let M of A)for(let F of M)x.set(F.agentType,F);
  return Array.from(x.values()).sort((M,F)=>M.agentType.localeCompare(F.agentType))}
```

A `Map` keyed on `agentType`, filled group by group, so the last group to write a key wins. The order
of `A` is the precedence, lowest first:

| Rank | `source` | Where it comes from |
|---|---|---|
| 6, lowest | `built-in` | the roster in `_ee()` |
| 5 | `plugin` | a plugin's `agents/` directory |
| 4 | `userSettings` | `$CLAUDE_CONFIG_DIR/agents` or `~/.claude/agents` |
| 3 | `projectSettings` | `<dir>/.claude/agents` walking up from cwd, plus additional working directories |
| 2 | `flagSettings` | the `--agents` CLI flag |
| 1, highest | `policySettings` | managed settings |

**doc** agrees, with the same six rows in the same order:
[Subagents](https://code.claude.com/docs/en/sub-agents) gives "Managed settings" priority 1, "`--agents`
CLI flag" 2, "`.claude/agents/`" 3, "`~/.claude/agents/`" 4, "Plugin's `agents/` directory" 5. Built-in
is not in the page's table; the code puts it below plugins.

**Within the project group, the deepest directory wins.** `S6` sorts by the number of path separators in
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

**One thing the build will not tell you.** Duplicate-name reporting, **read**, offset 160,487,646,
`egr`, groups on `source + baseDir + agentType`. So two files with the same name in the same directory
produce a `[agents] Duplicate agent name ...` line, and a user file shadowed by a project file produces
nothing at all. Cross-scope shadowing is silent.

## 9. What the build does with an unknown frontmatter key

It loads the agent, ignores the key, and records one telemetry event. Nothing is printed and nothing is
refused.

The strict schema exists and is used for exactly one thing. **read**, offset 159,669,062:

```js
w9t={skill:m(()=>_9t().strict()),agent:m(()=>S9t().strict()),"output-style":m(()=>b9t().strict())};
```

**read**, offset 159,669,269, its only consumer:

```js
function uE(e,t){try{let r=w9t[e]().safeParse(t);
  if(r.success)return;
  for(let o of r.error.issues)
    if(o.code==="unrecognized_keys")for(let u of o.keys)RGe("tengu_frontmatter_shadow_unknown_key",e,u);
    else{let u=String(o.path[0]??"");RGe("tengu_frontmatter_shadow_mismatch",e,`${u}:${o.code}`)}
}catch{}}
```

**read**, offset 159,669,161, what `RGe` does:

```js
function RGe(e,t,r){if(!pc().claim(`frontmatter_shadow:${e}:${t}:${r}`))return;s(e,{surface:c(t),detail:r})}
```

`s` is the telemetry emitter and `pc().claim` deduplicates, so each distinct unknown key fires once. The
name the build gives the whole mechanism is "frontmatter shadow", which is what it is: a schema run in
parallel with the real parser to find out what people write, with no authority over loading.

`ngr` calls it and discards the result. **read**, offset 160,492,405 again, the comma operator making
this explicit:

```js
if(uE("agent",r),!_||typeof _!=="string")return n(`Agent file ${e} is missing required 'description' in frontmatter`),null;
```

`uE` returns `undefined` always; it runs for its side effect. The parse then proceeds through the
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
episodic-memory:search-conversations
Explore
general-purpose
Plan
probe-unknown-key
statusline-setup
superpowers-chrome:browser-user
```

It loaded, it is addressable, and the session printed no warning.

**So provenance can live in the file.** Two ways, and the difference between them is only the telemetry
event:

- A top-level key such as `builtAgainst: 2.1.251`. Accepted, ignored, one
  `tengu_frontmatter_shadow_unknown_key` event per key per session.
- `experimental: { builtAgainst: "2.1.251" }`. The `experimental` object is declared `.loose()` with the
  description "Experimental per-agent options; unknown keys are ignored", so no event fires at all. The
  reader, **read**, offset 156,722,117, takes only one key out of it:

  ```js
  function TWt(e){let t=e.experimental;if(typeof t!=="object"||t===null)return;
    let r=Object.entries(t).find(([o])=>h(o)==="cachettl")?.[1];return xfe.find((o)=>o===r)}
  ```

Both work today. The top-level form is the more honest one to a human reader and the more likely to
break if the build ever hardens `uE` into a refusal; the `experimental` form is explicitly documented as
a place unknown keys are ignored, so it is the safer bet across builds. Neither is a contract.

The alternative, keeping provenance outside the frontmatter, has one thing going for it that neither of
these does: a comment in the markdown body is read by the agent itself, and a sidecar file is read by
nobody. A key in the frontmatter is read by nothing and costs one telemetry event. If the point is for a
check to read it back, the frontmatter is the right place, because the check is reading the file anyway
and the build will not object.

## 10. What I could not verify

- **The route by which CLAUDE.md reaches a subagent.** Measured, it arrives. The strip in section 4
  feeds only `onCacheSafeParams`, and I did not follow the attachment builders (`F$t`, `$$t`, `U$t` at
  offsets 162,099,434, 162,099,892 and 162,100,169) far enough to name the one that carries memory. So
  "the built-in Explore loads CLAUDE.md" is a run, and "`omitClaudeMd` does nothing but shape a cache
  payload" is a read that the run is consistent with, not a proof.
- **User-level against project-level shadowing, by run.** Testing it means either writing into the
  user's home or moving `CLAUDE_CONFIG_DIR`, which relocates credentials as well. I ran the
  project-depth case instead. The cross-scope order is read off `Sye` and confirmed by **doc**, and
  those two agree, but no measurement of mine backs it.
- **`--agent claude` and the `appendSystemPrompt` branch.** Read only. I did not run a main-thread
  session under an agent definition, so the claim that a shadow of `claude` loses the append on that
  path and only on that path is untested.
- **`policySettings` and `flagSettings`.** Neither was exercised. Their position in `Sye` is read.
- **`Dc`, the web-reading agent's type name.** It is an imported constant from another chunk and I did
  not resolve it. Its definition `Kxe` is at offset 160,482,179 and it does set `omitClaudeMd`.
- **An integer `effort:`.** `xk` accepts one and the schema documents it. Not run, and not documented
  upstream.
- **Whether `CLAUDE_CONFIG_DIR=""` really takes the empty string.** The `??` is read off
  offset 154,121,873. Not run.
- **Whether any of this survives 2.1.252.** Every identifier here is minified and every offset is one
  build's address. The behaviour has held across at least the two builds this note and its companions
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

Pulling the actionable parts together, for the `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT` notice the issue
asks for.

**It can find the files.** Look in `$CLAUDE_CONFIG_DIR/agents` or `~/.claude/agents`, and in every
`<dir>/.claude/agents` from the working directory up to the home directory, recursing into subfolders.
Report the winner by the order in section 8, deepest project directory first, and say which file won
when more than one matches, because the build itself will not say so across scopes.

**It can read the `effort:` line without a schema.** The parse is case-folded through `xk` against
`["low","medium","high","xhigh","max"]` or an integer. Anything else produces a warning line from the
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
