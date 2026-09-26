# When a hook can refresh the map

Research notes, September 2026. The question is what happens, in order, when a plugin wants the map it
wrote under `.claude/rules/` to stay fresh without a person running a scan. It has five parts: when the
overview and `CLAUDE.md` are read and how long that read holds; when an area file is read; how a plugin
gets a file watched; what `async: true` does to a command hook; and what a synchronous hook's timeout
kills and waits for.

Every claim carries its source, in the three kinds the companion notes use: **read**, a string or a
function recovered from the installed build with its byte offset; **run**, a command and its output on
this machine; **doc**, a first-party page quoted with its URL.

The build is **Claude Code 2.1.283**, `/opt/claude-code/bin/claude` (the target of
`/opt/node22/bin/claude`), 241,556,664 bytes, an x86-64 ELF compiled with Bun whose JavaScript is
readable in place. Offsets are into that file and are one build's addresses; identifiers are minified
and several names repeat across chunks, so each offset below is the one in scope. The docs were fetched
as Markdown on 2026-09-26 from `https://code.claude.com/docs/en/{hooks,memory,plugins-reference}.md`.

Only one live run was made. The isolated config directory that the plan relied on did not keep the run
away from credentials (see Experiments), so the rest is read from the build. Two experiments that do not
start Claude Code fill in some of the gaps.

## Summary

At startup, the walk that reads `CLAUDE.md` and the unconditional rules (the overview among them) is not
ordered after SessionStart. In `-p` it starts right after `setup()`, before the SessionStart hooks are
spawned. In an interactive session the hooks are started first and the walk starts when the REPL mounts
(read, not run). In the one run, the walk finished 4 ms after the SessionStart hook's last line and
before that hook's output was parsed. The walk's result is memoized per session. The first turn waits
for SessionStart in both modes and then reuses the memo, so an overview that a SessionStart hook rewrites
is not what that session loaded.

The memo is dropped by compaction, `/clear`, `directory_added`, `policy_refresh`, `settings_sync` and a
directory move that starts a fresh session. All of these also re-read the files from disk.
`account_change`, `policy_verdict` and `hooks_invalidate` drop the memo but rebuild it from the cached
walk. A command hook can cause none of them.

Area files behave differently. They are read from disk, with no cache, in the attachment pass after the
first Read of a matching file in each context window. Once delivered, a later rewrite reaches the model
only as the "changed on disk" notice.

A plugin's own `FileChanged` matcher adds nothing to the watch list, because the list is built from
settings and agent hooks only. A plugin gets a watch by returning absolute `watchPaths` from
SessionStart. Its `hooks.json` FileChanged handlers then run, matched against the changed file's
basename. The watcher is a bundled chokidar 4 on `fs.watch`. It waits for 500 ms of stability, excludes
nothing under `.git/`, and re-arms when git replaces a file by rename.

`async: true` hooks run detached in their own session, and their configured timeout is only logged.
`-p` teardown kills them with SIGTERM to the process group and SIGKILL 1.5 s later. Nothing in the build
kills them when an interactive session exits.

A synchronous hook's timeout sends SIGTERM to its process group and every descendant, then SIGKILL
1.5 s later. But the runner resolves when stdio closes, not when the process exits, and it disarms the
timeout as soon as the shell exits. So a detached grandchild that still holds stdout keeps the hook
running with no timeout left.

---

## 1. When CLAUDE.md and the overview are read, and how long the read holds

### The read is memoized per session, twice over

**read**, offset 203,912,710, the user context, which carries the `claudeMd` block:

```js
function cE(e,n,r){let s=cL(e);if(s.userContext===void 0){let g=zk.of(e),h=++g.userContextBuildsStarted;
  wIo();let S=eCn(e,n,r);s.userContext=S.then(({blocks:w,claudeMd:M,pluginInstructionFiles:F})=>{…return w}),
  s.userContextMemoryFiles=S.then(…),s.userContextInstructionFiles=S.then(…),QSe(e)}return s.userContext}
```

`eCn` (203,914,186) builds it from `uS(e,!1,n)`, the walk over instruction files, which has its own
per-session memo (203,899,624):

```js
function uS(e,n=!1,r,s){let g=WA(e),h=g.files.get(n);if(!h)h=GEn(e.root,g,jse.of(e),n,r,s),g.files.set(n,h);return h}
```

`GEn` (203,900,668) reads, for the working directory and each ancestor, `CLAUDE.md`,
`.claude/CLAUDE.md`, `.claude/rules/` with `conditionalRule:!1`, and `CLAUDE.local.md`, plus the
managed and user layers. At its end it fires `InstructionsLoaded` for each file it loaded, without
awaiting. It does so only when `zEn` (203,905,479) reports a pending load reason and `MLn`
(205,549,063) finds a handler registered. `MLn` looks at settings, agent and registered hooks, so plugin
handlers count, but only if they are registered by the time the walk ends.

### `-p`: the walk starts before SessionStart is spawned

**read**, offset 212,231,143, in the main action straight after `setup()`, where `Te()` is
`!isInteractive()`:

```js
if(Te()){…if(!OA())mve(fe);if(!OA()){if(!aWt(Boolean(o.continue||o.resume)))cE(fe,E,C)}Idn()}
```

**read**, offset 212,466,602, the print runner starting the SessionStart hooks later:

```js
let zt=performance.now(),vt=e.continue||e.resume||Mt||Yt||OA()?void 0:
  vre(Me,{kind:"session-start",source:"startup",storageV5:r.storageV5,credentials:r.credentials})
```

`vre` reaches `Z4` (205,027,949), which loads plugin hooks with `L8` and then runs the handlers. The
initial messages wait for it (**read**, 221,897,507):

```js
return{messages:await(s.sessionStartHooksPromise??vre(e,{kind:"session-start",source:"startup",…}))}
```

So in `-p` the walk is kicked off first, SessionStart second, and the first request waits for
SessionStart. The request then takes its context from `cE`, which returns the promise already made.

**run**, the one session (commands under Experiments), milliseconds from launch:

| +ms | what |
|---|---|
| 393 | `setup()` completed (debug log); per the read above, the walk starts here |
| 450 | `Registered 10 hooks from 2 plugins` (debug log) |
| 470 | SessionStart hook's first line |
| 481 | SessionStart hook's last line |
| 485, 486 | `InstructionsLoaded`, `load_reason: session_start`, for `CLAUDE.md` and `.claude/rules/uncond.md` |
| 491 | SessionStart output parsed (debug log) |
| 565 | `[engine] turn 1 start` |
| 603 | `[API REQUEST] /v1/messages` |

The walk had finished by 485 ms, while the SessionStart hook's output was still being read. Neither
waited for the other. A hook that rewrote a rule inside those 15 ms would have raced the walk, and a
hook that takes longer than a few tens of milliseconds, as any real scan does, loses the race. The
first request went out after both. The transcript holds the context as an `instructions` attachment
listing the two files with the contents they had at launch; the path-scoped `scoped.md` was not among
them.

### Interactive: SessionStart starts first, the walk starts at mount (read, not run)

**read**, offset 212,241,131, in the main action:

```js
let Va=Gt||At||Vo||z||o.continue||o.resume?void 0:
  brt("head",(s)=>vre(fe,{kind:"session-start",source:"startup",…}))
```

It is not awaited. It is handed on as `sessionStartHooks:Va` (212,246,458) and becomes the REPL's
pending hook set. When the REPL renders (218,512,334), `let A=tO(o,l);f$r(),E4r(h,R,k);`, and `E4r`
reaches `mXn` (212,206,707): `if(r)cE(e,o,n);Sc(e,o)`. The memo is therefore created at mount, while
the hooks run. The REPL's `onInit` (223,956,527) calls `uS` too, and seeds each loaded file into the
read-file state with `seedMemoryFile` (223,779,973), which matters for section 2.

The first prompt waits for the hooks (**read**, 224,863,771, with the method at 224,842,203):

```js
let nn=E?this.awaitSessionStartHooks(M.signal):void 0;if(nn)await nn;
```

and then collects its context with `Promise.all([…,cE(Xo.session,Xo.storageV5,Xo.credentials),…])`
(224,868,531). That is the promise created at mount.

**doc**, [hooks reference](https://code.claude.com/docs/en/hooks), SessionStart:

> When you start an interactive session, resume a conversation at launch with `--continue` or
> `--resume`, or run `/clear`, SessionStart hooks run in the background. You can type right away, and a
> conversation you resumed appears without waiting for the hooks. Claude's first response still waits
> for the hooks to finish, so their context reaches Claude.

The docs agree about the wait. They do not say that the instruction files are read alongside the hooks.
SessionStart's output schema (202,083,855) offers `reloadSkills`, "Re-scan skill and command
directories after SessionStart hooks complete". The docs give the reason: "Skill discovery normally runs
before SessionStart hooks finish". There is no field that does the same for instructions.

### What drops the memo, and which drops re-read the disk

**read**, offset 203,916,067:

```js
function cC(e,n){if(CZe(),n==="account_change")JEn();let r=zk.peek(e);if(!r)return;
  for(let s of r.byId.values()){let g=s.userContext!==void 0;if(s.userContext=void 0,
  s.userContextMemoryFiles=void 0,s.userContextInstructionFiles=void 0,g)s.refreshReason=n}QSe(e)}
```

`cC` clears the user context only. The walk's memo is cleared separately by `lC` (203,905,618), or by
`WAt` (203,905,759), which also re-arms the `InstructionsLoaded` reason. A `cC` without an `lC` rebuilds
the context from the walk already held, so nothing is read from disk. Every call site of `cC` in the
build:

| reason | site | what triggers it | walk cleared too |
|---|---|---|---|
| `compaction` | 205,186,263 (`kie`), 216,916,623 (`/compact`) | auto or manual compaction | yes, `_Ze("compact")` beside it |
| (clear) | `rir` 215,653,883 | `/clear`: `GJt`, then `kie`, then `WAt(t,"session_start")` | yes |
| `directory_added` | 216,324,926, 221,796,241 | `/add-dir`, `--add-dir`, the SDK's `register_repo_root` | yes, `lC` first |
| `policy_refresh` | 212,460,478 | managed `CLAUDE.md`, managed rules or related policy settings change | yes, `lC` first |
| `settings_sync` | 231,105,224 | settings applied from the user's machine ("Applied settings from your machine") | yes, `clearMemoryFiles` beside it |
| (directory move) | 230,680,851 | a directory move that starts a fresh session (`tengu_cd_command`) | yes, `WAt`, `GJt`, then `cE` again |
| `account_change` | 215,313,154 | login, logout, account switch | no |
| `policy_verdict` | 203,914,526 | a project-context policy verdict arriving | no |
| `hooks_invalidate` | 221,761,623 (headless), 225,131,740 (REPL) | `refreshContext()` on the in-process hook-module API | no |

`hooks_invalidate` is not reachable from a command hook. It is the `refreshContext` member of the host
object handed to in-process hook modules; the debug log shows one such module, `agents-md@builtin`,
loaded `native`. A `hooks.json` command has no path to it. Nothing in the SessionStart path (`Z4`)
calls `cC` or `lC`.

A few sites clear the walk without clearing the context: `EnterWorktree` (210,821,761), `ExitWorktree`
(210,827,250), `/memory` (233,163,830), and `register_repo_root` with `reload_claude_md` (221,794,889).
What reaches the model after those was not traced.

When the context is rebuilt, what is sent is a delta. **read**, `Dco`, offset 203,388,889:

```js
function Dco(e,n){if(!n)return e.length===0?void 0:{files:e.slice()};
  let r=e.filter((h)=>{let S=n.get(h.path);return!S||S.content!==h.content||S.type!==h.type}),…;
  if(r.length===0&&g.length===0)return;return{files:r,…g.length>0&&{removed:g},changed:!0}}
```

The files are compared with what the window was last told (`qHn`, 203,388,534). Only the differing
files go out, marked `changed`, with the refresh reason attached (`Er`, 211,025,804). How often that
comparison runs per turn was not traced: the search for its call sites was refused by this session's
permission checks.

**doc**, [memory](https://code.claude.com/docs/en/memory):

> Project-root CLAUDE.md survives compaction: after `/compact`, Claude re-reads it from disk and
> re-injects it into the session. Nested CLAUDE.md files in subdirectories and rules with `paths:`
> frontmatter reload as Claude reads files they apply to.

The build goes further than "project-root": `_Ze("compact")` throws the whole walk away, so every
eagerly loaded file is re-read. This matches `DECISIONS.md` rows A8 and A17.

---

## 2. Area files: read at the matching Read, once per context window

**read**, offset 204,133,178, inside the Read tool: `let ze=g.nestedMemoryAttachmentTriggers;if(ze&&!ze.includes(De))ze.push(De);`.
The file's path becomes a trigger. The attachment pass that follows the tool call (`H4o`, 206,437,250,
`Ba("nested_memory",()=>TKt(ye,g))` beside `Ba("changed_files",…)` at 206,440,722) runs `TKt`
(206,469,063), which hands each trigger to `BKt` (206,463,164). For the file just read, `BKt` collects:

- the managed and user conditional rules (`bZe`);
- for each directory between the working directory and the file: `CLAUDE.md`, `.claude/CLAUDE.md`,
  `CLAUDE.local.md`, and both kinds of rule (`_Mn`);
- for the working directory and each ancestor: the conditional rules in `.claude/rules/` (`wZe`,
  203,908,320, then `Q9`, 203,908,481).

`Q9` calls `vMe` (203,895,786) with `conditionalRule:!0`. `vMe` does a `readdir` of the rules
directory, recursing into subdirectories, and reads every `.md` through `k8` (203,895,159) and `qSe`
(203,892,827), which is a plain read with a 4 MiB cap. Neither function keeps a cache. `Q9` then keeps
the files whose `paths` globs match the read file's path relative to the project.

So the file is read from disk at that moment. A rewrite that lands before the Read's attachment pass is
what the model gets.

What stops it being read again is a per-window latch. **read**, `pUe`, offset 206,462,314:

```js
for(let S of e){if(n.loadedNestedMemoryPaths?.[S.path])continue;if(!n.readFileState.has(S.path)){
  let w=s?.get(S.path)?.content===S.content.trim();if(!w)g.push({type:"nested_memory",path:S.path,…});
  if(n.loadedNestedMemoryPaths)n.loadedNestedMemoryPaths[S.path]=!0;let M=await _Nn(S,!0,n.storageV5);
  if(n.readFileState.set(S.path,{content:…,timestamp:M,…,seededFromContext:!0,keepContent:!0}),w)continue;
  if(h&&g6o(S.type)){let F=S.globs?"path_glob_match":S.parent?"include":"nested_traversal";GQt(…)}}}
```

A path already delivered, or already in the read-file state, is skipped. `DECISIONS.md` row A7 records
the second case from the outside: opening a rules file with the Read tool suppresses its injection. The
latch and the read-file state are both emptied at compaction (205,104,726, 205,108,089, 205,138,385,
205,144,341), so the next matching Read delivers the file afresh.

A rewrite after delivery reaches the model by a different route. **read**, `w6o`, offset 206,467,632:
for every read-file-state entry without an offset or limit, if the file's mtime is newer than the stored
timestamp, the build re-reads it and emits `edited_text_file` with a diff snippet. The snippet comes from
`Ryo` (202,892,508): hunks with 8 lines of context, truncated. All snippets in one pass share a budget of
16,384 characters (`b6o`, 206,467,618). What the model reads (**read**, 207,109,421):

```js
edited_text_file:(e)=>{let n=`Note: ${vc(e.filename)} changed on disk since you last read it. That's
  usually deliberate, so take it as the current state rather than reverting it; …`
```

`DECISIONS.md` row A6 measured this truncation from the outside. Delivered area files carry their load
timestamp, so they are in scope. In an interactive session, the eagerly loaded files are seeded into
the same state at mount (section 1), so a later rewrite of the overview would take this route too. That
is read, not run. No equivalent seeding was found on the `-p` path.

**run**: at session start, `InstructionsLoaded` fired for `CLAUDE.md` and `uncond.md` only. The
path-scoped `scoped.md` was not loaded. No Read happened in that run, so the lazy load was not observed.

---

## 3. Watching files: SessionStart `watchPaths`, FileChanged, CwdChanged

### One watcher, created in `setup()`, from settings only

**read**, offset 227,693,861, in `setup()`, in both modes:
`if(!Yn()){let e=performance.now();dpo(o,n,E),Zo("setup_file_watcher_ms",…)}`. `Yn()` is true in a
remote workspace, where no watcher is made at all. `dpo` is `initialize` on the manager `Xxn`
(204,064,760). The static list comes from `ge` (204,065,034):

```js
function ge(De){let Ne=(De??y5())?.FileChanged??[],We=Hh()?[]:F_e()?.FileChanged??[],$e=[...Ne,...We],ze=[];
  for(let tt of $e){if(!tt.matcher)continue;for(let _t of tt.matcher.split("|").map((Et)=>Et.trim())){
  if(!_t)continue;ze.push(Vxn(_t)?_t:Yxn(n,_t))}}let ft=D([...ze,...r]),Xe=ft.filter((tt)=>!nI(tt));…return Xe}
```

`y5()` (199,503,744) is the snapshot of hooks from settings files. Its builder (199,502,752) returns
`Vn().hooks`, the merged settings, with no plugins. `F_e()` is the main-thread agent's frontmatter
hooks. Plugin hooks live elsewhere, in `gN()`, as entries carrying `pluginRoot`. **A plugin's
FileChanged matcher is never turned into a watched path.** Each matcher segment is kept as-is if
absolute and otherwise joined to the working directory. `r` holds the dynamic paths. The only filter
drops UNC paths (`nI`); nothing excludes `.git/`.

### Dynamic paths: SessionStart, FileChanged and CwdChanged output

**read**, offset 205,030,262, at the end of `Z4`: every SessionStart handler's
`hookSpecificOutput.watchPaths` is pooled and handed over with `if(…Ie.length>0)Htt(Ie)`. This covers
plugin handlers too, because `Z4` loads plugin hooks before running them. `Htt` is `updateWatchPaths`
(204,066,423):

```js
function Ee(De){if(!g)return;let Ne=De.slice().sort();
  if(Ne.length===s.length&&Ne.every((We,$e)=>We===s[$e]))return;r=De,s=Ne,xe()}
```

The new list replaces the old dynamic list; it is not merged into it. `xe()` closes the watcher and opens
a new one on the static list plus the dynamic one. `g` is set at the top of `initialize` before any
early return, so a session with no FileChanged matchers still accepts `watchPaths`. The paths are not
resolved against anything. The schema describes them as "Absolute paths to watch for FileChanged hooks"
(202,087,948), and a relative one is handed to the watcher as spelled.

The same replacement applies to a FileChanged handler that returns `watchPaths`
(`if($e.length>0)Ee($e)` in the change handler) and to CwdChanged. CwdChanged replaces the list
unconditionally with whatever its handlers return, an empty list included (`r=ft.watchPaths`, in `Ie`
at 204,066,630).

### CwdChanged is gated on settings hooks

**read**, `Ie`, offset 204,066,630, the only caller of `executeCwdChangedHooks` (`Hbr` is called at
204,066,868 and nowhere else):

```js
async function Ie(De,Ne){if(De===Ne)return;let We=y5(),$e=Hh()?void 0:F_e();
  if(!((We?.CwdChanged?.length??0)>0||(We?.FileChanged?.length??0)>0||($e?.CwdChanged?.length??0)>0||
  ($e?.FileChanged?.length??0)>0))return;n=Ne,…let ft=await Hbr(…);r=ft.watchPaths,…if(g)xe()}
```

If no settings file or agent frontmatter defines CwdChanged or FileChanged, a `cd` fires no CwdChanged
hook at all, a plugin's included. If one does, every CwdChanged handler runs, plugins' too, and their
combined `watchPaths` become the whole dynamic list. That wipes a list a plugin set at SessionStart
unless the plugin's CwdChanged handler returns it again.

### The watcher, its debounce, and `.git/`

**read**, offset 204,065,503:

```js
e=lb.watch(De,{persistent:!0,ignoreInitial:!0,awaitWriteFinish:{stabilityThreshold:500,pollInterval:200},
  ignorePermissionErrors:!0}),e.on("change",…),e.on("add",…),e.on("unlink",…)
```

`lb` (199,486,410) is a bundled chokidar 4: it has the `CHOKIDAR_USEPOLLING` and `CHOKIDAR_INTERVAL`
switches and the readdirp walker. It watches with `fs.watch` (imported `watch as It` from `fs`), and
polls only on IBM i (`if(st)i.usePolling=!0`, 199,479,244, where `st` is `xt()==="OS400"`) or when the
environment asks for it. `awaitWriteFinish` holds each event until the file's size has been unchanged
for 500 ms, checking every 200 ms. That is the only debounce; the build adds none of its own.
`ignoreInitial` means registering a path fires nothing.

A file replaced by rename is followed. **read**, offset 199,472,571, in chokidar's file handler:

```js
if((Ft||At||St)&&n.ino!==l.ino){this.fsw._closeFile(t),n=l;let E=this._watchWithNodeFs(t,o);…}
```

On macOS, Linux and FreeBSD, an inode change closes the old watch and opens a new one on the new file.
Nothing on the path excludes `<gitdir>/HEAD` or `<gitdir>/logs/HEAD`, so both can be watched. What git
does to them is measured under Experiments. In brief: `HEAD` is replaced only when the branch changes,
and `logs/HEAD` is appended in place on every movement of HEAD.

### What a change fires, and with what payload

**read**, offset 204,065,983, the watcher's change handler, the only caller of
`executeFileChangedHooks`:

```js
function ve(De,Ne){t(`FileChanged: ${Ne} ${De}`),Mbr({id:Y(),project:{…}},De,Ne,{…}).then(({results:We,
  watchPaths:$e,systemMessages:ze})=>{…if($e.length>0)Ee($e);for(let ft of ze)M?.(ft,!1);…})}
```

`Mbr` (205,449,087) builds `{…common fields, hook_event_name:"FileChanged", file_path, event}`, with
`event` one of `change`, `add` or `unlink` and `file_path` the path as registered. It runs through
`IDt` (205,448,673), which calls `BA()` ("Invalidating session environment cache") when any handler
ran, and through `BR`, which skips everything when workspace trust is not accepted (`Tie`, 205,469,734).
The handlers come from `Y$` (205,504,825) over `WEe` (201,583,454):

```js
return[...y5()?.[e]??[],...t?[]:F_e()?.[e]??[],...n.filter((o)=>!(t&&("pluginRoot"in o)&&!i?.has(o.pluginId))…)]
```

`n` is `gN()`, the registered hooks, plugins included. **A plugin's FileChanged handlers run on any
watched path's change**; only their matchers are missing from the list. The FileChanged output schema
(202,087,948) holds `watchPaths` alone. `systemMessage` goes to the terminal, and the build has no
route from a FileChanged hook to the model.

The matcher is compared with the changed file's basename (`case"FileChanged":return xRo(e.file_path)`
in `dLt`, 205,489,816, where `xRo` is `path.basename`, 203,791,844). The comparison is `zIe`
(205,492,126). FileChanged is not in the set that allows `-`, space and `,`, so a matcher made only of
letters, digits, `_` and `|` is split on `|` and compared exactly. Anything else goes through
`new RegExp(matcher).test(basename)`, which is unanchored. An omitted matcher, or `*`, runs for every
file. `<gitdir>/HEAD` and `<gitdir>/logs/HEAD` share the basename `HEAD`.

---

## 4. `async: true` command hooks

**read**, `q$`, offset 205,480,260, the command runner. Every form of the spawn passes
`detached:dn` with `dn=!ze` (205,483,777), so on macOS and Linux each hook starts a new session. Then,
at 205,484,639:

```js
if((e.async||e.asyncRewake&&Eo)&&!ye){let qo=`async_hook_${Wn.pid}`;…Wn.stdin.write(s+`\n`,"utf8"),
  Wn.stdin.end()…if(pr=!0,QDt({processId:qo,…,shellCommand:Do,asyncResponse:{async:!0,asyncTimeout:Un},…}))
  return{stdout:"",stderr:"",output:"",status:0,backgrounded:!0}}
```

`ye` is `forceSyncExecution`, which overrides `async`. `Eo` limits `asyncRewake` to interactive sessions
(or a second flag not traced). `QDt` (205,468,507) calls `shellCommand.background(…,{skipSpill:!0})`.
In the shell-command class `vpe` (203,352,106), `background` calls `#R()`, which clears the timeout timer
and the abort listener. `OJe` (203,873,814) then registers the hook:

```js
function OJe({processId:e,…}){let F=r.asyncTimeout||15000;
  t(`Hooks: Registering async hook ${e} (${s}) with timeout ${F}ms`);…W.register({processId:e,…,shellCommand:S,…})}
```

`F` is used in that log line and nowhere else. **The configured timeout of an `async: true` hook is
logged, not enforced.**

- **stdout and stderr** stay attached to pipes, and the build accumulates them. When the process has
  completed, the next check (`LJe`, 203,875,516, run as attachments are gathered) parses the stdout
  lines that start with `{` for the first object without `async` (`DJe`, 203,874,704). That response is
  delivered on a later turn. The docs name its `additionalContext` and `systemMessage`.
- **`-p` teardown** calls `await Ldo()` (221,779,994). `Ldo` (203,878,183) runs `kill()` on every async
  hook not yet completed and finalizes it as `cancelled`. `kill()` is the routine described in
  section 5: SIGTERM to the group and its descendants, then SIGKILL after 1,500 ms.
- **Interactive exit**: `Ldo` has no other caller. The exit sweep `IJt` (203,350,279) kills only shell
  commands whose status is `running`, and a backgrounded hook's status is `backgrounded`. Nothing in
  the build kills an async hook when an interactive session ends. The hook leads its own session with no
  controlling terminal, so the terminal's hangup does not reach it either. Read, not run.
- **`asyncRewake`** skips `background()`, so its timer stays armed. On exit code 2 it queues a
  notification that wakes the model.

**run**: the async SessionStart hook was declared with `"timeout": 2`. The debug log reads
`Registering async hook async_hook_27888 (SessionStart:startup) with timeout 2000ms` at +461 ms. Its
process group was 27888, its session 27888. At +2059 ms, straight after the turn ended, the build
logged it `cancelled`. The hook's TERM trap wrote its line at +2070 ms, and the stream event was
`"outcome":"cancelled","exit_code":1,"output":"async-tick-1\n"`. The SessionEnd hook followed at
+3573 ms, 1.5 s later, which matches the SIGKILL backstop. Teardown came before the 2 s would have run
out, so the run alone does not show that the timeout is unenforced; the read and the docs do.

---

## 5. A synchronous hook's timeout, and what the runner waits for

The timeout is `hook.timeout * 1000` or the event's default (**read**, 205,519,829:
`let vr=Sn.timeout?Sn.timeout*1000:S,{signal:yr,cleanup:kr}=Ro(h,{timeoutMs:vr})`). The default
command timeout is `Fa=600000` (205,430,778); the docs list the per-event exceptions. The runner passes
`yr` to the shell-command class as its abort signal, together with the same number as that class's own
timer. Either one ends in `#E` (203,352,106):

```js
#E(e){this.#e="killed";let n=this.#r?.pid;if(this.#k(e??DU),!n||n<=1)return Promise.resolve();
  let r=mb(n,"SIGTERM"),s=new Promise((h)=>{…V=setTimeout(()=>{w=!0,…;try{process.kill(-n,"SIGKILL")}catch{}
  Promise.all([W.then(()=>s3n(M,"SIGKILL")),mb(n,"SIGKILL")]).finally(h)},Rtn);…})
```

`mb` (198,505,584) first lists the hook's descendants by walking `ps` output from its pid. It then sends
the signal to `-pid` (the process group), falling back to the pid, and then to each listed descendant.
The constants sit at 203,350,035: `DU=137, aze=143, Rtn=1500, Atn=100`. So a timeout is **SIGTERM to
the process group and to every descendant still parented under the hook, then SIGKILL to the group and
those descendants after 1,500 ms** if any is still alive (checked every 100 ms). A child that has
double-forked away from the hook's parentage and left the group is outside both lists.

What the runner waits for is **stdio close, not exit**. **read**, 205,486,938:

```js
let Gr=new Promise((qo)=>{let ir=null;Wn.on("close",(Wr)=>{ir=Wr??1,Promise.all([jr,vr]).then(()=>{qo({…})})})})
```

`jr` and `vr` are the `end` events of stdout and stderr. The result is `Promise.race([Ur,Gr,kr])`, where
`Ur` is used only for the JSON `{"async":true}` handshake and `kr` only for a spawn error. Meanwhile
`vpe` listens for `exit`, not `close`: `this.#r.once("exit",this.#b.bind(this))`. The exit handler
resolves the class's own result and calls `#R()`, which clears the timer and removes the abort listener.

Put together: a shell that exits while a grandchild still holds the inherited stdout or stderr leaves
the hook pending. From the moment the shell exits, neither timeout path can kill anything, because both
have been disarmed. The hook ends when the grandchild closes those descriptors. If the grandchild stays
in the hook's process group and the timeout fires **before** the shell exits, the group kill takes it
along. On SessionStart the pending hook holds up the first turn, in `-p` with no way out. Interactively,
Esc takes the prompt back and the hook keeps running (**doc**, hooks reference).

**run** (a reconstruction in Node 22 of exactly that wait: detached spawn, piped stdio, resolve on
`close`, timer cleared on `exit`; see Experiments):

```
A  shell exits, setsid grandchild keeps stdout      7 ms exit (timer cleared)   3009 ms close
B  same grandchild, stdio sent to /dev/null         9 ms exit                      9 ms close
C  shell itself outlives the 1000 ms timeout     1006 ms SIGTERM to group       1008 ms close
```

The build runs on Bun, not Node. The reconstruction shows the semantics the code relies on; it does not
show Bun reproducing them.

---

## Experiments

### Run 1, the only Claude Code run, and why it was the only one

A throwaway project was set up with `CLAUDE.md`, an unconditional `.claude/rules/uncond.md`, a
`.claude/rules/scoped.md` with `paths: ["src/**"]`, a `src/a.ts` and a git repository. A probe plugin
was loaded with `--plugin-dir`. Its `hooks/hooks.json` declared:

- a synchronous SessionStart hook (`"timeout": 30`) that logs and prints `additionalContext`;
- an async SessionStart hook (`"async": true, "timeout": 2`) that ticks once a second and traps
  TERM, HUP and PIPE;
- `InstructionsLoaded`;
- `FileChanged` with matcher `HEAD|watched.txt|uncond.md`;
- `CwdChanged`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd`.

Every handler runs `log.sh LABEL`, which appends one JSON line holding `date +%s.%N`, its pid, ppid,
pgid and sid, and the payload.

```sh
cd <scratch>/runs/e0-noauth/proj
env -i PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin HOME=<mktemp -d> CLAUDE_CONFIG_DIR=<mktemp -d> \
  TERM=xterm LANG=C.UTF-8 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 \
  PROBE_LOG=<scratch>/runs/e0-noauth/hooks.jsonl PROBE_ASYNC_SECS=4 \
  timeout 60 claude -p hi --plugin-dir <scratch>/probe --debug-file <scratch>/runs/e0-noauth/debug.txt \
    --output-format stream-json --verbose --include-hook-events --permission-mode default < /dev/null
```

The plan expected authentication to fail. It did not: the build also reads credentials the hosting
environment provides at fixed paths outside both `HOME` and `CLAUDE_CONFIG_DIR`, so an empty config
directory and `env -i` do not make a run free of credentials on a hosted machine. The turn reached the
live API. Nothing but the binary read those credentials, and nothing here looked at them.

Keeping the binary away from those credentials was not pursued. No further Claude Code run
was made. A local stand-in for the Messages API and a
SessionStart hook that rewrites the three memory files had been prepared for the rewrite race, the
lazy load and the `watchPaths` run. They were never started.

Trimmed output, milliseconds from launch, merging the hook log and the debug log:

```
   +ms  source  line
   393  debug   [STARTUP] setup() completed in 19ms
   450  debug   Registered 10 hooks from 2 plugins
   461  debug   Hooks: Registering async hook async_hook_27888 (SessionStart:startup) with timeout 2000ms
   470  hook    SS-begin     SessionStart source=startup     pgid 27886 sid 27886
   471  hook    ASYNC-begin  SessionStart source=startup     pgid 27888 sid 27888
   481  hook    SS-end
   485  hook    IL  session_start  Project  <proj>/CLAUDE.md               pgid 27911 sid 27911
   486  hook    IL  session_start  Project  <proj>/.claude/rules/uncond.md pgid 27913 sid 27913
   491  debug   Hook SessionStart:startup (SessionStart) success: {"hookSpecificOutput":{…"SS-CONTEXT-MARKER"}}
   550  hook    UPS  UserPromptSubmit
   565  debug   [engine] turn 1 start
   603  debug   [API REQUEST] /v1/messages
  2047  hook    STOP
  2053  debug   [engine] turn 1 end (turns=1 … stop=end_turn resultLen=28)
  2059  debug   "Hook SessionStart:startup (SessionStart) cancelled:\nasync-tick-1"
  2070  hook    ASYNC-got-TERM                               pgid 27888 sid 27888
  3573  hook    END  SessionEnd
  3595  exit    code 0
```

Each hook's shell leads its own session: in every row the pgid equals the sid, and neither is Claude
Code's. The transcript holds a `hook_additional_context` entry for SessionStart, then, at turn start,
an `instructions` attachment:

```json
{ "type": "instructions",
  "files": [ { "path": "<run>/proj/CLAUDE.md", "type": "Project", "content": "# Project\nCLAUDEMD-VERSION-A" },
             { "path": "<run>/proj/.claude/rules/uncond.md", "type": "Project", "content": "# Uncond\nUNCOND-VERSION-A" } ] }
```

### Experiment 2, what git does to the files under `.git/` (no Claude Code)

git 2.43.0, `git init -q -b main` and one empty commit, then four moves, with `stat -c %i`, `stat -c %s`
and the first bytes of each file:

```
after 2nd commit on main    HEAD ino=1991042 (same)    logs/HEAD ino=1991266 size 129→248   refs/heads/main ino=1991234→1991362
after checkout -b feature   HEAD ino=1991378 (new)     logs/HEAD ino=1991266 size 248→416   refs/heads/main unchanged
after checkout main         HEAD ino=1991234 (new)     logs/HEAD ino=1991266 size 416→584
after reset --hard HEAD~1   HEAD ino=1991234 (same)    logs/HEAD ino=1991266 size 584→738   refs/heads/main ino=1991362→1991410
```

`HEAD` holds `ref: refs/heads/<branch>` and changes only on a branch switch, where git replaces it by
rename. A commit or a reset leaves it untouched. `logs/HEAD` keeps its inode and grows on all four. It
exists only while reflogs are on, which is the default outside a bare repository. In a linked worktree
both files sit under `.git/worktrees/<id>/`, which is what `git rev-parse --absolute-git-dir` prints
there.

### Experiment 3, the wait in section 5, reconstructed in Node (no Claude Code)

`closewait.mjs` spawns `sh -c CMD` with `detached: true` and three pipes. It writes a payload to stdin,
arms a 1,000 ms timer that sends SIGTERM to `-pid`, clears the timer on `exit`, and prints `exit`,
stdout `end` and `close`:

```
$ node closewait.mjs 'cat >/dev/null; setsid sleep 3 & echo "{}"' 1000
     6 ms stdout: {}
     7 ms exit code=0 sig=null (timer cleared)
  3009 ms stdout end
  3009 ms close code=0  <- hook result resolves here
$ node closewait.mjs 'cat >/dev/null; setsid sleep 3 >/dev/null 2>&1 </dev/null & echo "{}"' 1000
     7 ms stdout: {}
     8 ms stdout end
     9 ms exit code=0 sig=null (timer cleared)
     9 ms close code=0  <- hook result resolves here
$ node closewait.mjs 'cat >/dev/null; sleep 3 & wait; echo "{}"' 1000
  1006 ms timeout fired: SIGTERM to group -15444
  1008 ms stdout end
  1008 ms exit code=null sig=SIGTERM (timer cleared)
  1008 ms close code=null  <- hook result resolves here
```

---

## What the docs say and where they are wrong or silent

- **SessionStart and instruction loading.** The hooks page says the first response waits for
  SessionStart, and the build agrees. The docs say nothing about the instruction files being read
  alongside the hooks and memoized, so nothing tells a hook author that files it writes miss the
  session that ran it. The docs do say this about skills, which is why `reloadSkills` exists. There is
  no equivalent for instructions.
- **Compaction.** The memory page says "Project-root CLAUDE.md survives compaction: … Claude re-reads it
  from disk". The build re-reads every eagerly loaded file, not only the root one. The docs are narrower
  than the build, not wrong.
- **Mid-session edits.** The memory page is silent on what happens when an instruction file changes
  while a session runs. The build's answer is: nothing for the loaded context until a drop listed in
  section 1, and a truncated change notice for any file in the read-file state.
- **FileChanged watch list.** The hooks page says "the value is split on `|` and each segment is
  registered as a literal filename in the working directory". The build keeps an absolute segment
  absolute. It also builds the list from settings files and agent frontmatter only. The plugins page
  says "When a plugin is enabled, its hooks merge with your user and project hooks", which holds for
  running the handlers but not for the watch list. Neither page mentions the gap.
- **CwdChanged.** The hooks page says it "doesn't support matchers and fires on every occurrence". In
  the build it fires only when a settings file or the main agent's frontmatter defines CwdChanged or
  FileChanged. A plugin's CwdChanged hook alone never fires. **Contradicted.**
- **`watchPaths`.** Documented as "Array of absolute paths. Replaces the current dynamic watch list",
  which agrees with the build. The docs are silent that a relative path is not resolved, and that a
  CwdChanged run replaces the list set at SessionStart.
- **Debounce and `.git/`.** Not documented. The build waits for 500 ms of size stability and excludes
  nothing under `.git/`.
- **InstructionsLoaded.** "It runs asynchronously for observability purposes" agrees with the build,
  which does not await it. The docs are silent that a handler which is not yet registered when the walk
  ends misses that walk's `session_start` events.
- **Async hooks.** "Claude Code doesn't enforce `timeout` on it", "still enforces `timeout` on a hook
  you run with `asyncRewake`", and "kills any async hook still running at teardown and finalizes it
  with outcome `cancelled`" all agree with the build, and the last was run. The docs are silent on
  interactive exit, where the build kills nothing, and on the signals.
- **Timeouts.** "Claude Code cancels a `command` … hook that reaches its `timeout`, discarding the
  hook's output" is silent on the signals: SIGTERM to the group and its descendants, SIGKILL 1.5 s
  later. It is also silent on the case where a surviving child holds the hook's stdout, and there the
  timeout does not end the hook. **Incomplete in a way that matters.**
- **Process isolation.** "On macOS and Linux, command hooks run in their own session without a
  controlling terminal" agrees with the build (`detached: true`) and with the run (pgid equals sid).

---

## What this means for an automatic refresh

- **A scan in SessionStart refreshes the next session, not this one.** The overview this session loads
  was read alongside the hook and memoized. After a SessionStart scan, the new overview reaches the model
  only at compaction or `/clear`, or through the truncated change notice. Returning the counts as
  SessionStart `additionalContext` would reach the first turn, since that turn waits. But it puts a
  second copy of the overview in the window, which is the cost A17 rejected.
- **Area files are the part a rewrite can reach mid-session.** Each is read fresh at its first matching
  Read in a window, and a later rewrite arrives as a change notice. So a refresh should rewrite only the
  area files whose content changed, keep them short (A6), and keep writing by rename, as `write.mjs`
  already does.
- **A plugin gets a watch only from its own SessionStart output.** That output should carry the
  absolute `<gitdir>/logs/HEAD`, from `git rev-parse --absolute-git-dir`, which is also right in a linked
  worktree. `HEAD` misses commits and resets. A `hooks.json` FileChanged group with no matcher, or
  `HEAD`, then runs. Any FileChanged output must return the whole list or none, because output replaces
  the list. A user's settings-level CwdChanged or FileChanged hook can wipe the list on `cd`. A remote
  workspace has no watcher.
- **FileChanged can only rewrite files.** It has no route to the model, so the refresh is seen through
  the change notice on area files and at the next reload of the overview.
- **Never leave a child holding the hook's stdout or stderr.** If a scan must outlive its hook, start it
  with `setsid` and all three streams redirected. Otherwise the hook stays pending with its timeout
  disarmed, and on SessionStart the first turn waits with it. A scan run with `async: true` is killed at
  `-p` teardown and survives an interactive exit. Either way it has to tolerate being killed mid-write.

## What could not be established

- **Anything after Run 1.** The rewrite race at startup, the lazy load of an area file and its change
  notice, a `watchPaths` round trip through `.git/logs/HEAD`, and a plugin FileChanged handler firing
  were all prepared and not run, for the reason given under Experiments.
- **The interactive path.** Its ordering, the change notice for a seeded overview, and async hooks
  surviving exit are all read, not run.
- **How often the instructions comparison (`Dco`) runs.** The search for its call sites was refused.
- **Bun's behaviour.** The stdio-close wait was reconstructed in Node, not in Bun.
- **`[fs.watch probe] verdict: delivers`.** The build probes `fs.watch` at startup (+804 ms here).
  What it does on another verdict was not read.
- **Whether `-p` seeds the eagerly loaded files into the read-file state.** No seeding was found on that
  path; its absence was not proven.

## Sources

First-party documentation, fetched 2026-09-26:

- [Hooks reference](https://code.claude.com/docs/en/hooks): SessionStart (the background run and the
  wait), SessionStart decision control (`watchPaths`, `reloadSkills`), InstructionsLoaded, FileChanged,
  CwdChanged, Timeouts, Run hooks in the background, the statement that command hooks run in their own
  session
- [Memory](https://code.claude.com/docs/en/memory): load at launch, path-specific rules, instructions
  after `/compact`
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference): `hooks`, merging with
  `hooks/hooks.json`

The installed build, `/opt/claude-code/bin/claude`, 2.1.283, 241,556,664 bytes. Read with
`LC_ALL=C grep -a -o -b -F '<literal>'` for offsets, then `tail -c +N | head -c M`. Named sites:

- **The context memo and the walk**: `cE` 203,912,710, `eCn` 203,914,186, `uS` 203,899,624,
  `GEn` 203,900,668, `zEn` 203,905,479, `lC` 203,905,618, `WAt` 203,905,759, `cC` 203,916,067,
  `MLn` 205,549,063, `GQt` 205,449,194.
- **Startup**: the `-p` kick-off 212,231,143, the interactive SessionStart start 212,241,131, the print
  runner's 212,466,602, the initial-messages wait 221,897,507, the REPL mount 218,512,334 and `mXn`
  212,206,707, `onInit` 223,956,527, `seedMemoryFile` 223,779,973, `awaitSessionStartHooks` 224,842,203
  and its use at 224,863,771, the per-turn context 224,868,531.
- **Invalidations**: the invalidation sites in the table in section 1; `Dco` 203,388,889, `qHn`
  203,388,534, `Er` 211,025,804.
- **Area files**: the Read trigger 204,133,178, `H4o` 206,437,250, `TKt` 206,469,063, `BKt` 206,463,164,
  `pUe` 206,462,314, `wZe` 203,908,320, `Q9` 203,908,481, `vMe` 203,895,786, `k8` 203,895,159, `qSe`
  203,892,827, the latch reset at compaction 205,104,726; `w6o` 206,467,632, `b6o` 206,467,618, `Ryo`
  202,892,508, the `edited_text_file` text 207,109,421.
- **Watching**: `setup()`'s `dpo` 227,693,861, the manager `Xxn` 204,064,760, `ge` 204,065,034,
  `lb.watch` 204,065,503, `Ee` 204,066,423, `Ie` 204,066,630, `Hbr` 204,066,868, `Mbr` 204,065,983 and
  205,449,087, `IDt` 205,448,673, `Z4` 205,027,949 with `Htt` at 205,030,262, `y5` 199,503,744 and its
  builder 199,502,752, `WEe` 201,583,454, `Y$` 205,504,825, `dLt` 205,489,816, `zIe` 205,492,126, the
  FileChanged output schema 202,087,948, chokidar `lb` 199,486,410, its polling switch 199,479,244 and
  its inode re-watch 199,472,571.
- **Running hooks**: `q$` 205,480,260, `detached:dn` 205,483,777, the async branch 205,484,639, the
  close wait 205,486,938, the executor timeout 205,519,829, `Fa=600000` 205,430,778, `vpe` 203,352,106,
  `mb` 198,505,584, the kill constants 203,350,035, `IJt` 203,350,279, `QDt` 205,468,507, `OJe`
  203,873,814, `DJe` 203,874,704, `LJe` 203,875,516, `Ldo` 203,878,183 and its only call 221,779,994.

This repository: `DECISIONS.md` rows A6, A7, A8, A17, A24 and A92;
`plugins/anatomiya/hooks/hooks.json`; `plugins/anatomiya/lib/write.mjs`; the companion notes
`docs/research/what-a-repeated-hook-context-costs.md`, `docs/research/what-a-hook-payload-carries.md` and
`docs/research/why-a-worktree-got-no-map.md`.
