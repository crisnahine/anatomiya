# What a hook payload carries: the path key per tool, the cwd, and what Bash hides

Research notes, August 2026. Companion to `what-a-pretooluse-hook-can-do.md`, which established what a
`PreToolUse` hook may do with what it is handed. This one establishes what it is handed, on both tool
events, for every tool that could name a place on disk. Issue #123 says both of this plugin's hooks
resolve the repository by walking up from the working directory, and proposes resolving from the path
the call is about instead. The issue names its own load-bearing unknown:

> The Read tool's own input key is `file_path`, so `PostToolUse` should carry it for reads too, though
> I did not capture a real read payload off the wire and that is worth confirming before building on
> it.

**Confirmed.** A real `Read` payload carries `tool_input.file_path` on `PreToolUse` and on
`PostToolUse`, byte for byte the same string.

Every claim below carries its source, in the companion note's three kinds: **read**, a string or a
function recovered from the installed build with its byte offset; **run**, a captured payload or a
command and its output on this machine, today; **doc**, a first-party page, quoted, with its URL.

The build read and run against is **Claude Code 2.1.251**, the file
`<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes. Offsets are into that file and are
one build's addresses. Every `run` is a headless `claude -p` session with a throwaway `--settings`
file, in `/tmp/hookcap/work`, against `claude-opus-5[1m]` at `--effort medium` under
`--permission-mode bypassPermissions`.

One note on finding the build: `cliPath()` in `plugins/ultracode-anywhere/hooks/upstream.mjs` answers
`CLAUDE_CODE_EXECPATH` first, which inside a running session is the build that session started on. It
answered 2.1.250 here while `claude --version` said 2.1.251, so the reads below name the version file
directly.

## Summary

A path-first resolution can serve five tools and no others. `Read`, `Write` and `Edit` spell their
target `tool_input.file_path`. `NotebookEdit` spells it `notebook_path`. `Glob` and `Grep` spell a
directory `tool_input.path`, and it is optional. Everything else carries nothing that names a place on
disk: `Bash` carries only the command text, `Agent` carries a prompt, `WebFetch` carries a URL,
`ToolSearch` carries a query. `TodoWrite` is not a tool on this build at all.

The path is not guaranteed absolute. A relative one was made to arrive and it worked: the tool resolved
it against the payload's own `cwd` and the hook saw the raw relative string on `PostToolUse`. Nothing
between the model's tool call and the hook normalises `tool_input`.

The `cwd` field is not the session's start directory and not the tool's target. It follows the agent,
and a `cd` in one Bash call moves it for every tool call after that one, including Read, Write and
Edit. That is the mechanism behind issue #123's report, and it is documented behaviour rather than a
bug.

`PostToolUse` carries two fields `PreToolUse` does not, `tool_response` and `duration_ms`. `PreToolUse`
carries nothing `PostToolUse` lacks.

## 1. Which tools carry a path, and under exactly what key

**run**, one `PreToolUse` and one `PostToolUse` hook, both `"matcher": "*"`, both appending stdin to a
file. Three sessions. Every row below was captured; nothing is inferred from the schema alone.

| Tool | key in `tool_input` | what it names | on both events |
|---|---|---|---|
| `Read` | `file_path` | one file | yes |
| `Write` | `file_path` | one file, usually not there yet | yes |
| `Edit` | `file_path` | one file | yes |
| `NotebookEdit` | `notebook_path` | one file | yes |
| `Glob` | `path`, optional | a directory | yes |
| `Grep` | `path`, optional | a file or a directory | yes |
| `Bash` | none | see section 6 | n/a |
| `Agent` (the `Task` tool's real name) | none | `description`, `prompt`, `subagent_type`, `run_in_background` | n/a |
| `WebFetch` | none | `url`, `prompt` | n/a |
| `ToolSearch` | none | `query`, `max_results` | n/a |
| `TodoWrite` | not a tool on this build | | |

`Task` is an alias. **read**, offset 154,672,753, the build's own rename table, right under the string
`// Version: 2.1.251`:

```js
var i={Task:"Agent",KillShell:"TaskStop",KillBash:"TaskStop",AgentOutputTool:"TaskOutput",
       BashOutputTool:"TaskOutput",AgentOutput:"TaskOutput",BashOutput:"TaskOutput",
       ListPeers:"ListAgents",Brief:"SendUserMessage",ListMcpResources:"ListMcpResourcesTool",
       ReadMcpResource:"ReadMcpResourceTool",ReadMcpResourceDir:"ReadMcpResourceDirTool"};
function Vd(e){return Object.hasOwn(i,e)?i[e]:e}
```

`tool_name` in the payload is the new name, `Agent`. The alias runs on the matcher side, so a matcher
of `"Task"` still fires on it, but a reader keyed on `tool_name` must expect `Agent`.

`TodoWrite` is absent from the roster. **run**, a session asked to name every tool it had listed 13
loaded (`Agent, Bash, Edit, Glob, Grep, ListAgents, Read, ReportFindings, ScheduleWakeup, Skill,
ToolSearch, Workflow, Write`) and 19 deferred behind `ToolSearch`, `NotebookEdit`, `WebFetch` and
`WebSearch` among them. No `TodoWrite` in either, and `ToolSearch` with `select:TodoWrite` found
nothing. The string is still in the bundle. Read it as a name the build knows, not a tool that fires.

This contradicts nothing in the companion note, which measured `Write`, `Edit` and `NotebookEdit` on
2.1.250 and found the same two keys. It extends it: `Read` behaves as `Write` and `Edit` do, and
`TARGET_KEY` in `plugins/anatomiya/lib/hook.mjs` is right as far as it goes.

## 2. The path is not always absolute

The tool schemas ask for absolute. **read**, offset 162,025,996, the `Read` input schema:

```js
ot({file_path:i().describe("The absolute path to the file to read"), offset:..., limit:...})
```

and offset 161,299,722, `NotebookEdit`: `"The absolute path to the Jupyter notebook file to edit (must
be absolute, not relative)"`. Asking is not enforcing. Two runs show it.

First, nothing normalises `tool_input` on the way to the hook. **run**, a `Glob` call the model spelled
`/tmp/hookcap/work/src` while the payload's own `cwd` read `/private/tmp/hookcap/work`. On macOS `/tmp`
is a link to `/private/tmp`, so those are one directory spelled two ways, and the hook was handed the
model's spelling: `"path": "/tmp/hookcap/work/src"`.

Second, a relative path was made to arrive and it worked. **run**, a `PreToolUse` hook returning
`permissionDecision: "allow"` with `updatedInput: {"file_path": "src/b.txt"}` against a `Read` the
model had spelled absolutely. The read succeeded, it read `src/b.txt` under the payload's `cwd`, and
the `PostToolUse` hook was handed the relative string in both places:

```json
"tool_input": { "file_path": "src/b.txt" },
"tool_response": { "type": "text",
  "file": { "filePath": "src/b.txt", "content": "zeta eta theta\n", ... } }
```

So the tool resolves a relative path against the payload's `cwd`, and the hook sees the string as
written. A hook that requires `isAbsolute` before it answers is silent on that call rather than wrong,
which is the safe direction, but it is silent.

Three attempts to make the model itself send a relative path failed: it expanded `src/b.txt` every
time, once to `/private/tmp/...`, its own resolution of the `cwd` it had been told about. A model-sent
relative path was not observed.

## 3. The payload does carry a working directory, and it follows the agent

`cwd` is in every payload, on both events. It is neither the session's start directory nor the tool's
target.

**read**, offset 162,169,545, the base of every hook payload, and offset 154,838,700, where its `cwd`
argument comes from:

```js
return{session_id:e.id,transcript_path:om(e.id),cwd:t,prompt_id:$J()??void 0,
       permission_mode:r,agent_id:o?.agentId,agent_type:u,effort:C}
```

```js
var e=new AsyncLocalStorage;
function JRn(t){let r=e.getStore();if(r)r.cwd=tr(t);else rie(t)}
function QRn(){return e.getStore()?.cwd??xw()}
function ee(){try{return QRn()}catch{return Se()}}
```

Both hook builders pass `ee()` as that argument, so `cwd` is a per-agent value with a setter. Something
calls the setter.

**run**, the decisive capture. One session, one tool call per row, only the working directory changing:

| # | tool | `tool_input` | `cwd` in the payload |
|---|---|---|---|
| 3 | Bash | `grep -rn "needle" /tmp/hookcap/work/lib` | `/private/tmp/hookcap/work` |
| 4 | Bash | `cd /tmp/hookcap/work/src && pwd` | `/private/tmp/hookcap/work` |
| 5 | Bash | `pwd` | `/private/tmp/hookcap/work/src` |
| 6 | Write | `/tmp/hookcap/work/new.txt` | `/private/tmp/hookcap/work/src` |
| 7 | Edit | `/tmp/hookcap/work/src/a.txt` | `/private/tmp/hookcap/work/src` |
| 8 | Read | `/tmp/hookcap/work/src/a.txt` | `/private/tmp/hookcap/work/src` |
| 9 | NotebookEdit | `/tmp/hookcap/work/note.ipynb` | `/private/tmp/hookcap/work/src` |

One `cd` in a Bash call moved `cwd` for every payload after it, whatever the tool. The session never
left `/private/tmp/hookcap/work`; the Write at row 6 wrote a file at the top of that tree while the
payload said the agent was one directory down.

The docs say so in as many words (**doc**,
[Hooks reference](https://code.claude.com/docs/en/hooks)):

> **`cwd` follows Claude**: the `cwd` field in the hook's input JSON is the worktree root after Claude
> enters a worktree, and the new directory after Claude runs `cd`. Read it when a hook needs to know
> which directory Claude is working in.

and, in the common input fields, `cwd: Current working directory when the hook is invoked`. That is the
whole of issue #123's mechanism, stated upstream. `cwd` answers where the agent is, not what the call
is about, and a `cd` separates the two inside a single repository, never mind two side by side.

One more thing to hold: `cwd` came back realpath'd, `/private/tmp/...`, while every `tool_input` path
kept the model's `/tmp/...`. A comparison between the two has to resolve both sides.
`plugins/anatomiya/lib/hook.mjs` already does that in `resolveLinks`, for the reason recorded there.

## 4. The envelope, and what each event adds

**read**, offsets 160,227,645 and 160,228,284, the two builders, side by side:

```js
let F={...Ea(o.session,ee(),u,o),hook_event_name:"PreToolUse",
       tool_name:e,tool_input:r,tool_use_id:t};
let M={...Ea(u.session,ee(),d,u),hook_event_name:"PostToolUse",
       tool_name:e,tool_input:r,tool_response:o,tool_use_id:t,duration_ms:A};
// and a third this plugin also wires, at offset 160,228,746:
let M={...Ea(u.session,ee(),_,u),hook_event_name:"PostToolUseFailure",
       tool_name:e,tool_input:r,tool_use_id:t,error:o,is_interrupt:d,duration_ms:x};
```

So the field set, all of it confirmed by capture except where marked:

- Both events: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`,
  `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`.
- Both events, in a subagent only: `agent_id`, `agent_type`. Captured from an `Explore` subagent's
  `Bash` call: `agent_id: "ab56e3dc0de2d9b72"`, `agent_type: "Explore"`. `session_id` and
  `transcript_path` stay the parent's, and `cwd` is inherited from the parent at spawn time.
- `PostToolUse` only: `tool_response`, `duration_ms`.
- `PreToolUse` only: nothing.
- `PostToolUseFailure` (**read** only, not captured): `error`, `is_interrupt`, `duration_ms`, and no
  `tool_response`.

`tool_response` is per tool, and for the file tools it names the path a second time:

| Tool | `tool_response` shape |
|---|---|
| `Read` | `{type, file:{filePath, content, numLines, startLine, totalLines}}` |
| `Write` | `{type, filePath, content, structuredPatch, originalFile, userModified}` |
| `Edit` | `{filePath, oldString, newString, originalFile, structuredPatch, userModified, replaceAll}` |
| `NotebookEdit` | `{new_source, old_source, cell_type, language, edit_mode, cell_id, error, notebook_path, original_file}` |
| `Bash` | `{stdout, stderr, interrupted, isImage, noOutputExpected}` |
| `WebFetch` | `{bytes, code, codeText, result, durationMs, url}` |
| `Agent` | `{status, prompt, agentId, agentType, content, ...}` |

The path in `tool_response` is the same string as in `tool_input`, unresolved. It adds nothing a
path-first reader does not already have from `tool_input`, and it is only there after the fact.

## 5. Glob and Grep

**read**, offset 161,036,037, the `Glob` schema:

```js
ot({pattern:i().describe("The glob pattern to match files against"),
    path:i().optional().describe('The directory to search in. If not specified, the current working
    directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter
    "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path
    if provided.')})
```

and offset 161,039,588, the `Grep` schema:

```js
ot({pattern:i().describe("The regular expression pattern to search for in file contents"),
    path:i().optional().describe("File or directory to search in (rg PATH). Defaults to current
    working directory."), glob:..., output_mode:..., ...})
```

Three facts a fix has to hold apart:

1. The key is `path` on both, not `file_path`.
2. `Glob`'s `path` is a directory. `Grep`'s may be a file **or** a directory. Its own text says so, and
   it is passed through to `rg` as `PATH`. So a reader that calls `dirname` on it, the way it would for
   a write target, drops a level on every `Grep` aimed at a directory.
3. It is optional on both, and when it is omitted the tool falls back to the working directory. So this
   is exactly the case where the payload names no place and the `cwd` fallback is the only answer, and
   the fallback is then correct rather than a guess.

Both were captured with the key spelled `path`:

```json
{ "tool_name": "Glob", "tool_input": { "pattern": "*.txt", "path": "/tmp/hookcap/work/src" } }
{ "tool_name": "Grep", "tool_input": { "pattern": "needle", "path": "/tmp/hookcap/work/lib",
                                       "output_mode": "content" } }
```

## 6. Bash carries the command and nothing else

**read**, offset 162,988,343, the whole `Bash` input schema:

```js
ot({command:i().refine(e$,Ucr).describe("The command to execute"),
    timeout:NL(v().optional()), description:i().optional(),
    run_in_background:Yb(q().optional()), dangerouslyDisableSandbox:Yb(q().optional()), ...!1,
    _simulatedSedEdit:f({filePath:i(),newContent:i(),baseHash:i().optional()}).optional()
      .describe("Internal: pre-computed sed edit result from preview"),
    ...eEe()})
```

`eEe` is `function eEe(){return{}}` (**read**, offset 156,847,682), so it adds nothing. Captured
payloads carried `command` and `description` and nothing else.

There is no working directory in the input. The shell's directory reaches the hook through the
envelope's `cwd`, and section 3 shows that for `Bash` that value is exactly right: it is the shell's
own directory and it updates after a `cd` runs. `Bash` is the one tool where a cwd-first resolution is
correct by construction.

That is also the whole of what a `Bash` payload gives. The answer to this repository's earlier finding
that a model writing with `cat > file <<EOF` never reaches a `Write` matcher: **nothing in a `Bash`
payload locates that write.** `tool_input` holds the command text and a human description.
`tool_response` holds `stdout`, `stderr`, `interrupted`, `isImage`, `noOutputExpected`, and no file
list, no exit code, no directory. The only way to a path is to parse the command string, and a path
inside it may be relative to a `cwd` that a `cd` earlier in the same string has already moved.

One field is worth naming and not relying on: `_simulatedSedEdit` carries a `filePath`. It is marked
`Internal: pre-computed sed edit result from preview` and appeared in no capture here.

## The raw payloads

**run**. Captured verbatim by a hook whose whole body is an append of stdin. Paths under the account's
home are shown as `<home>`; every other path is the scratch fixture at `/tmp/hookcap`. Nothing else is
redacted and there is no credential in any of them.

`Read`, `PreToolUse` and `PostToolUse`, the same call:

```json
{ "session_id": "5cf00ab7-c65c-415a-9fc9-0247cae71f8d",
  "transcript_path": "<home>/.claude/projects/-private-tmp-hookcap-work/5cf00ab7-...jsonl",
  "cwd": "/private/tmp/hookcap/work", "prompt_id": "ed2e7a01-3df9-4b67-a101-2d56e9d6d2ca",
  "permission_mode": "bypassPermissions", "effort": { "level": "medium" },
  "hook_event_name": "PreToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "/tmp/hookcap/work/src/a.txt" },
  "tool_use_id": "toolu_01BxbyPydb2k2boz9tAuy3cp" }
```

```json
{ "session_id": "5cf00ab7-c65c-415a-9fc9-0247cae71f8d",
  "transcript_path": "<home>/.claude/projects/-private-tmp-hookcap-work/5cf00ab7-...jsonl",
  "cwd": "/private/tmp/hookcap/work", "prompt_id": "ed2e7a01-3df9-4b67-a101-2d56e9d6d2ca",
  "permission_mode": "bypassPermissions", "effort": { "level": "medium" },
  "hook_event_name": "PostToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "/tmp/hookcap/work/src/a.txt" },
  "tool_response": { "type": "text",
    "file": { "filePath": "/tmp/hookcap/work/src/a.txt",
              "content": "alpha beta gamma\ndelta epsilon\n",
              "numLines": 3, "startLine": 1, "totalLines": 3 } },
  "tool_use_id": "toolu_01BxbyPydb2k2boz9tAuy3cp", "duration_ms": 1 }
```

The `Glob` and `Grep` `tool_input` objects are quoted verbatim in section 5; their envelopes matched
the `Read` one above, at `cwd` `/private/tmp/hookcap/work`.

`Bash`, the `cd` and the call after it, showing the move. The `cd` fires its own hook at the old `cwd`
and its `PostToolUse` at the new one:

```json
{ "cwd": "/private/tmp/hookcap/work", "hook_event_name": "PreToolUse", "tool_name": "Bash",
  "tool_input": { "command": "cd /tmp/hookcap/work/src && pwd",
                  "description": "cd to src and print working directory" },
  "tool_use_id": "toolu_012Gx8soAdC1brZXo1pr1twx" }
{ "cwd": "/private/tmp/hookcap/work/src", "hook_event_name": "PostToolUse", "tool_name": "Bash",
  "tool_input": { "command": "cd /tmp/hookcap/work/src && pwd",
                  "description": "cd to src and print working directory" },
  "tool_response": { "stdout": "/tmp/hookcap/work/src", "stderr": "", "interrupted": false,
                     "isImage": false, "noOutputExpected": false },
  "tool_use_id": "toolu_012Gx8soAdC1brZXo1pr1twx", "duration_ms": 24 }
{ "cwd": "/private/tmp/hookcap/work/src", "hook_event_name": "PreToolUse", "tool_name": "Bash",
  "tool_input": { "command": "pwd", "description": "Print working directory" },
  "tool_use_id": "toolu_01Qpfcp7YEoATXoEVnmJgSJW" }
```

`Write`, `NotebookEdit`, `WebFetch`, `Agent`, all `PreToolUse`, all with `cwd`
`/private/tmp/hookcap/work/src` after that `cd`:

```json
{ "tool_name": "Write", "tool_input": { "file_path": "/tmp/hookcap/work/new.txt", "content": "hello\n" } }
{ "tool_name": "NotebookEdit", "tool_input": { "notebook_path": "/tmp/hookcap/work/note.ipynb",
                                               "cell_id": "c1", "new_source": "print(2)" } }
{ "tool_name": "WebFetch", "tool_input": { "url": "https://example.com", "prompt": "what is the title" } }
{ "tool_name": "Agent", "tool_input": { "description": "Run pwd via Bash",
    "prompt": "run pwd via Bash then stop", "subagent_type": "Explore", "run_in_background": false } }
```

A subagent's `Bash`, showing the two extra fields, with the parent's `session_id` and
`transcript_path` unchanged:

```json
{ "cwd": "/private/tmp/hookcap/work/src", "permission_mode": "bypassPermissions",
  "agent_id": "ab56e3dc0de2d9b72", "agent_type": "Explore", "effort": { "level": "medium" },
  "hook_event_name": "PreToolUse", "tool_name": "Bash",
  "tool_input": { "command": "pwd", "description": "Print working directory" },
  "tool_use_id": "toolu_01LhXFbBaxesVRjL5n1JukjU" }
```

The relative `Read`, `PostToolUse`, from the run where a hook rewrote the input:

```json
{ "cwd": "/private/tmp/hookcap/work", "hook_event_name": "PostToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "src/b.txt" },
  "tool_response": { "type": "text",
    "file": { "filePath": "src/b.txt", "content": "zeta eta theta\n",
              "numLines": 2, "startLine": 1, "totalLines": 2 } },
  "tool_use_id": "toolu_013ESRmY1gGefa2SvAHBjhN9", "duration_ms": 2 }
```

## What is a documented contract

On [https://code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks): the common input
fields, `cwd`, `prompt_id`, `permission_mode`, `effort`, `agent_id` and `agent_type` among them; that
`cwd` follows Claude into a worktree and after a `cd`; that `PostToolUse` carries `tool_response`; and
the `PreToolUse` input example, with `tool_input` and `tool_use_id`.

## What is one build's behaviour

Every path key per tool; the docs never name `file_path`, `notebook_path` or `path`, and never say
whether a path in `tool_input` is absolute. That `tool_input` reaches the hook unnormalised, links and
all, and that a relative `file_path` is accepted and resolved against `cwd`. `duration_ms` on both post
events. That `Task` is `Agent` in `tool_name`, and the rest of the rename table. That `TodoWrite` is
not offered. Every `tool_response` shape.

## What could not be established

- **A model-sent relative path.** Three runs asked for one and the model expanded it every time. The
  relative payload here came from a hook's `updatedInput`. Relative is reachable; how often a model
  sends one on its own was not measured.
- **`Grep` with a file rather than a directory as `path`**, and **`Glob` or `Grep` with `path`
  omitted.** Both are in the schema; only the directory case was captured.
- **`PostToolUseFailure`.** Read out of the build, never fired in a capture, so `error` and
  `is_interrupt` were not seen on the wire.
- **`_simulatedSedEdit` on `Bash`.** In the schema, in no capture.
- **`MultiEdit`.** Not offered in any session here, same as the companion note found on 2.1.250.
- **Whether the hook process's own `process.cwd()` equals the payload's `cwd`.** The companion note
  says the spawn uses the project directory. Not re-measured; every hook here wrote to absolute paths.
- **Windows.** Every run was macOS.

## Reproducing this

One throwaway hook, one settings file, one headless run.

```sh
mkdir -p /tmp/hookcap/out /tmp/hookcap/work/src
printf 'alpha beta gamma\n' > /tmp/hookcap/work/src/a.txt
cat > /tmp/hookcap/hook.mjs <<'EOF'
import { appendFileSync } from "node:fs";
let d = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { d += c; });
process.stdin.on("end", () => { appendFileSync(process.argv[2], d + "\n"); process.stdout.write("{}"); });
EOF
cat > /tmp/hookcap/settings.json <<'EOF'
{"hooks":{
 "PreToolUse":[{"matcher":"*","hooks":[{"type":"command",
   "command":"node /tmp/hookcap/hook.mjs /tmp/hookcap/out/pre.jsonl","timeout":20}]}],
 "PostToolUse":[{"matcher":"*","hooks":[{"type":"command",
   "command":"node /tmp/hookcap/hook.mjs /tmp/hookcap/out/post.jsonl","timeout":20}]}]
}}
EOF
cd /tmp/hookcap/work && claude --model 'claude-opus-5[1m]' --effort medium \
  --permission-mode bypassPermissions --settings /tmp/hookcap/settings.json \
  --strict-mcp-config --no-session-persistence \
  -p 'Read /tmp/hookcap/work/src/a.txt. Then Bash: cd /tmp/hookcap/work/src && pwd.
      Then Bash: pwd. Then Write /tmp/hookcap/work/new.txt containing hello. Then stop.' < /dev/null
```

Two things the runs here needed. `Glob`, `Grep` and `NotebookEdit` may be deferred behind `ToolSearch`
on an account with many plugins, and naming them in `--allowedTools` was what got `Glob` and `Grep` to
fire. To force a relative path, have the `PreToolUse` hook answer `{"hookSpecificOutput":
{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"file_path":"src/b.txt"}}}`
and read the `PostToolUse` payload.

The bundle reads use `LC_ALL=C grep -a -b -o` for a fixed string, then
`tail -c +$((offset-N)) | head -c M` around the hit. The file is 197 MB and a wide context pattern is
refused by the stock macOS `grep`.

## Sources

First-party documentation:

- [Anthropic, Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

The installed build, `<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes. Named sites: the
tool rename table and `Vd` at 154,672,753 and 154,673,083; the cwd store, its setter `JRn` and its
reader `ee` at 154,838,700; the base payload builder at 162,169,545; the `PreToolUse` builder `Tye` at
160,227,645; the `PostToolUse` builder `b3e` at 160,228,284; the `PostToolUseFailure` builder at
160,228,746; the `Glob` schema at 161,036,037; the `Grep` schema at 161,039,588; the `Read` schema at
162,025,996; the `NotebookEdit` schema at 161,299,722; the `Bash` schema at 162,988,343; `eEe` at
156,847,682.

This repository:

- `docs/research/what-a-pretooluse-hook-can-do.md` (the companion note, 2.1.250),
  `plugins/anatomiya/lib/hook.mjs` (`TARGET_KEY`, `resolveLinks`, `targetIn`),
  `plugins/anatomiya/hooks/hooks.json`, `plugins/ultracode-anywhere/VERIFYING.md` (the wire-capture
  recipe this reuses), `DECISIONS.md` row A44, issue #123.

## What this means for issue #123

The evidence permits this and no more.

**A path-first resolution can serve five tools.** `Read`, `Write` and `Edit` through
`tool_input.file_path`; `NotebookEdit` through `notebook_path`; `Glob` and `Grep` through `path`. That
covers every tool call that names a place on disk on this build. The issue's unknown is settled:
`Read` carries `file_path` on `PostToolUse`, which is the event the echo hook runs on, so the hook that
today answers from the working directory is holding the right answer on every read.

**It cannot serve the rest.** `Bash`, `Agent`, `WebFetch` and `ToolSearch` carry no path, and for
`Bash` there is nothing anywhere in the payload, input or response, that says which file a
`cat > file` touched. Those calls have only `cwd`. There is no third channel to find. Tools this
capture never fired, `Skill` and `Workflow` among them, were not measured either way.

**`cwd` stays the fallback, and it is not always wrong.** For `Bash` it is the shell's own directory
and it is the correct base. For a `Glob` or `Grep` with `path` omitted it is what the tool itself uses,
so it is again correct. It is wrong only where the payload names a place and the fallback ignores it,
which is the case the issue reports.

**Three things a fix has to hold apart.** The key differs per tool, so one key reads nothing for the
others. `Glob` and `Grep` name a directory, not a file, and `Grep`'s may be a file, so neither can be
handed to a `dirname` written for a write target. And the path may be relative: a reader that requires
`isAbsolute` before it will answer falls back to `cwd` without saying so, which is safe and silent.

**One thing to note about the working tree.** `plugins/anatomiya/lib/hook.mjs` and `commands.mjs`
already carry an uncommitted `aboutDir(payload) ?? cwd` on both hooks. It reads
`tool_input.file_path` only and requires it absolute, so on this build it covers `Read`, `Write` and
`Edit`, and falls back to `cwd` for `NotebookEdit`, `Glob`, `Grep` and a relative path. That is a
correct subset, not a complete one, and the gap is the four rows above.
