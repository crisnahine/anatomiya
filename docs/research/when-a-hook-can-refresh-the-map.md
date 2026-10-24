# When a hook can refresh the map

Research notes, September 2026. The question is what happens, in order, when a plugin wants the map it
wrote under `.claude/rules/` to stay fresh without a person running a scan. It has five parts: when the
overview and `CLAUDE.md` are read and how long that read holds; when an area file is read; how a plugin
gets a file watched; what `async: true` does to a command hook; and what a synchronous hook's timeout
kills and waits for.

Every claim carries its source, in the three kinds the companion notes use: **read**, behaviour read
from the installed build, described here rather than quoted; **run**, a command and its output on
this machine; **doc**, a first-party page quoted with its URL.

The build is **Claude Code 2.1.283**, `/opt/claude-code/bin/claude` (the target of
`/opt/node22/bin/claude`), 241,556,664 bytes, an x86-64 ELF compiled with Bun whose JavaScript is
readable in place. What is read from it holds for that one build. The docs were fetched
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

**read** from the build: the user context, which carries the `claudeMd` block, is built once per
session and kept as a promise, and every later caller gets that same promise. It is built from the walk
over instruction files, which has its own per-session memo.

The walk reads, for the working directory and each ancestor, `CLAUDE.md`, `.claude/CLAUDE.md`, the
unconditional rules in `.claude/rules/`, and `CLAUDE.local.md`, plus the managed and user layers. At its
end it fires `InstructionsLoaded` for each file it loaded, without awaiting. It does so only when a load
reason is pending and a handler is registered. That check looks at settings, agent and registered
hooks, so plugin handlers count, but only if they are registered by the time the walk ends.

### `-p`: the walk starts before SessionStart is spawned

**read** from the build: in the main action, straight after `setup()`, a non-interactive run that is
not continuing or resuming starts building the user context. The print runner starts the SessionStart
hooks later, with `source` `startup`, again unless the run continues or resumes. The SessionStart path
loads plugin hooks and then runs the handlers, and the initial messages wait for it (**read**).

So in `-p` the walk is kicked off first, SessionStart second, and the first request waits for
SessionStart. The request then takes its context from the user-context builder, which returns the
promise already made.

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

**read** from the build: in the main action, an interactive session starts the SessionStart hooks
with `source` `startup`, unless it continues or resumes, and does not await them. They are handed on
as the REPL's pending hook set. When the REPL renders, its mount step starts building the user context.
The memo is therefore created at mount, while the hooks run. The REPL's init step runs the walk too,
and seeds each loaded file into the read-file state, which matters for section 2.

The first prompt waits for the hooks (**read**), and then collects its context, the user context among
it, from the promise created at mount.

**doc**, [hooks reference](https://code.claude.com/docs/en/hooks), SessionStart:

> When you start an interactive session, resume a conversation at launch with `--continue` or
> `--resume`, or run `/clear`, SessionStart hooks run in the background. You can type right away, and a
> conversation you resumed appears without waiting for the hooks. Claude's first response still waits
> for the hooks to finish, so their context reaches Claude.

The docs agree about the wait. They do not say that the instruction files are read alongside the hooks.
SessionStart's output schema offers `reloadSkills`, which re-scans the skill and command directories
once the SessionStart hooks are done. The docs give the reason: "Skill discovery normally runs
before SessionStart hooks finish". There is no field that does the same for instructions.

### What drops the memo, and which drops re-read the disk

**read** from the build: the context invalidation clears the user context only, and records the
reason on each context it cleared. On `account_change` it takes one extra step first. The walk's memo
is cleared separately, by one of two functions, the second of which also re-arms the
`InstructionsLoaded` reason. An invalidation without a walk clear rebuilds the context from the walk
already held, so nothing is read from disk. Every call site of the invalidation in the build:

| reason | what triggers it | walk cleared too |
|---|---|---|
| `compaction` | auto or manual compaction | yes, compaction throws the walk away beside it |
| (clear) | `/clear`: one step this note does not name, then the compaction routine, then the walk clear that re-arms `session_start` | yes |
| `directory_added` | `/add-dir`, `--add-dir`, the SDK's `register_repo_root` | yes, the walk is cleared first |
| `policy_refresh` | managed `CLAUDE.md`, managed rules or related policy settings change | yes, the walk is cleared first |
| `settings_sync` | settings applied from the user's machine | yes, the memory files are cleared beside it |
| (directory move) | a directory move that starts a fresh session | yes, the walk is cleared, the session reset, and the context built again |
| `account_change` | login, logout, account switch | no |
| `policy_verdict` | a project-context policy verdict arriving | no |
| `hooks_invalidate` | `refreshContext()` on the in-process hook-module API, headless and in the REPL | no |

`hooks_invalidate` is not reachable from a command hook. It is the `refreshContext` member of the host
object handed to in-process hook modules; the debug log shows one such module, `agents-md@builtin`,
loaded `native`. A `hooks.json` command has no path to it. Nothing in the SessionStart path calls the
invalidation or the walk clear.

A few sites clear the walk without clearing the context: `EnterWorktree`, `ExitWorktree`, `/memory`,
and `register_repo_root` with `reload_claude_md`. What reaches the model after those was not traced.

When the context is rebuilt, what is sent is a delta. **read** from the build: each file is compared
with what the window was last told. Only the files whose content or type differ go out, marked
`changed`, with any removed files listed and the refresh reason attached. When nothing differs,
nothing is sent. How often that comparison runs per turn was not traced: the search for its call
sites was refused by this session's permission checks.

**doc**, [memory](https://code.claude.com/docs/en/memory):

> Project-root CLAUDE.md survives compaction: after `/compact`, Claude re-reads it from disk and
> re-injects it into the session. Nested CLAUDE.md files in subdirectories and rules with `paths:`
> frontmatter reload as Claude reads files they apply to.

The build goes further than "project-root": compaction throws the whole walk away, so every eagerly
loaded file is re-read. This matches `DECISIONS.md` rows A8 and A17.

---

## 2. Area files: read at the matching Read, once per context window

**read** from the build: inside the Read tool, the path of the file just read is added, once, to the
window's list of nested-memory triggers. The attachment pass that follows the tool call runs a
nested-memory step beside its changed-files step, and that step hands each trigger to a collector. For
the file just read, it collects:

- the managed and user conditional rules;
- for each directory between the working directory and the file: `CLAUDE.md`, `.claude/CLAUDE.md`,
  `CLAUDE.local.md`, and both kinds of rule;
- for the working directory and each ancestor: the conditional rules in `.claude/rules/`.

The rules loader does a `readdir` of the rules directory, recursing into subdirectories, and reads
every `.md` with a plain read capped at 4 MiB. Nothing on that path keeps a cache. It then keeps the
files whose `paths` globs match the read file's path relative to the project.

So the file is read from disk at that moment. A rewrite that lands before the Read's attachment pass is
what the model gets.

What stops it being read again is a per-window latch. **read** from the build: for each collected file,
a path already delivered in this window, or already in the read-file state, is skipped. Otherwise the
build emits a `nested_memory` attachment, unless the loaded context already holds the same content,
marks the path delivered, and seeds the file into the read-file state with its load timestamp. Only
when the content was not already held, and only for some memory types, is the load then reported, as
`path_glob_match`, `include` or `nested_traversal` by whether a glob, an include or the nested walk
found it.

`DECISIONS.md` row A7 records the second case from the outside: opening a rules file with the Read
tool suppresses its injection. The latch and the read-file state are both emptied at compaction, so the
next matching Read delivers the file afresh.

A rewrite after delivery reaches the model by a different route. **read** from the build: for every
read-file-state entry without an offset or limit, if the file's mtime is newer than the stored
timestamp, the build re-reads it and emits `edited_text_file` with a diff snippet: hunks with 8 lines
of context, truncated. All snippets in one pass share a budget of 16,384 characters. What the model
reads is a short note naming the file as changed on disk since it was last read, which tells it to take
the change as deliberate and as the current state, and not to revert it.

`DECISIONS.md` row A6 measured this truncation from the outside. Delivered area files carry their load
timestamp, so they are in scope. In an interactive session, the eagerly loaded files are seeded into
the same state at mount (section 1), so a later rewrite of the overview would take this route too. That
is read, not run. No equivalent seeding was found on the `-p` path.

**run**: at session start, `InstructionsLoaded` fired for `CLAUDE.md` and `uncond.md` only. The
path-scoped `scoped.md` was not loaded. No Read happened in that run, so the lazy load was not observed.

---

## 3. Watching files: SessionStart `watchPaths`, FileChanged, CwdChanged

### One watcher, created in `setup()`, from settings only

**read** from the build: `setup()`, in both modes, initialises one file-watcher manager and records how
long that took, except in a remote workspace, where no watcher is made at all. The static watch list
comes from the FileChanged hooks in the settings snapshot and, where they apply, the main-thread
agent's frontmatter hooks. Each matcher is split on `|` and trimmed, and an empty segment is skipped.

The settings snapshot is the merged settings' `hooks`, with no plugins. Plugin hooks live elsewhere,
among the registered hooks, as entries that carry their plugin root. **A plugin's FileChanged matcher
is never turned into a watched path.** Each matcher segment is kept as-is if absolute and otherwise
joined to the working directory. The dynamic paths are added to the list. The only filter drops UNC
paths; nothing excludes `.git/`.

### Dynamic paths: SessionStart, FileChanged and CwdChanged output

**read** from the build: at the end of the SessionStart run, every SessionStart handler's
`hookSpecificOutput.watchPaths` is pooled and, when the pool is not empty, handed to the watcher
manager's update. This covers plugin handlers too, because the SessionStart path loads plugin hooks
before running them. The update sorts the new list and stops if it equals the current one.

Otherwise the new list replaces the old dynamic list; it is not merged into it. The watcher is closed
and a new one opened on the static list plus the dynamic one. The manager marks itself ready at the top
of its init, before any early return, so a session with no FileChanged matchers still accepts
`watchPaths`. The paths are not resolved against anything. The output schema describes them as
absolute paths for FileChanged hooks to watch, and a relative one is handed to the watcher as spelled.

The same replacement applies to a FileChanged handler that returns a non-empty `watchPaths`, and to
CwdChanged. CwdChanged replaces the list unconditionally with whatever its handlers return, an empty
list included.

### CwdChanged is gated on settings hooks

**read** from the build: the directory-change handler is the only caller of the CwdChanged runner, and
nothing else calls that runner. It returns early when the directory did not change. It also returns
early unless the settings snapshot or the main agent's frontmatter defines a CwdChanged or a FileChanged
hook. Otherwise it runs the CwdChanged hooks, takes their `watchPaths` as the new dynamic list, and
rebuilds the watcher.

If no settings file or agent frontmatter defines CwdChanged or FileChanged, a `cd` fires no CwdChanged
hook at all, a plugin's included. If one does, every CwdChanged handler runs, plugins' too, and their
combined `watchPaths` become the whole dynamic list. That wipes a list a plugin set at SessionStart
unless the plugin's CwdChanged handler returns it again.

### The watcher, its debounce, and `.git/`

**read** from the build: the watcher is opened `persistent`, with `ignoreInitial`, with
`awaitWriteFinish` at a 500 ms stability threshold and a 200 ms poll interval, and with
`ignorePermissionErrors`. It listens for `change`, `add` and `unlink`.

The watcher is a bundled chokidar 4: it has the `CHOKIDAR_USEPOLLING` and `CHOKIDAR_INTERVAL` switches
and the readdirp walker. It watches with `fs.watch`, and polls only on IBM i or when the environment
asks for it. `awaitWriteFinish` holds each event until the file's size has been unchanged for 500 ms,
checking every 200 ms. That is the only debounce; the build adds none of its own. `ignoreInitial` means
registering a path fires nothing.

A file replaced by rename is followed. **read**, chokidar's file handler in the build: on macOS, Linux
and FreeBSD, an inode change closes the old watch and opens a new one on the new file.
Nothing on the path excludes `<gitdir>/HEAD` or `<gitdir>/logs/HEAD`, so both can be watched. What git
does to them is measured under Experiments. In brief: `HEAD` is replaced only when the branch changes,
and `logs/HEAD` is appended in place on every movement of HEAD.

### What a change fires, and with what payload

**read** from the build: the watcher's change handler is the only caller of the FileChanged runner. It
logs the event and runs the hooks. When they return a non-empty `watchPaths`, it replaces the dynamic
list, and it sends their system messages to the terminal.

The runner builds the common fields plus `hook_event_name: "FileChanged"`, `file_path` and `event`, with
`event` one of `change`, `add` or `unlink` and `file_path` the path as registered. It invalidates the
session environment cache when any handler ran, and skips everything when workspace trust is not
accepted. The handlers are the settings hooks, the main agent's frontmatter hooks where they apply,
and the registered hooks, plugins included.

**A plugin's FileChanged handlers run on any watched path's change**; only their matchers are missing
from the list. The FileChanged output schema holds `watchPaths` alone. `systemMessage` goes to the
terminal, and the build has no route from a FileChanged hook to the model.

The matcher is compared with the changed file's basename (**read**). FileChanged is not in the set of
events whose matchers allow `-`, space and `,`, so a matcher made only of letters, digits, `_` and `|`
is split on `|` and compared exactly. Anything else is compiled as a regular expression and tested
against the basename, unanchored. An omitted matcher, or `*`, runs for every file. `<gitdir>/HEAD` and
`<gitdir>/logs/HEAD` share the basename `HEAD`.

---

## 4. `async: true` command hooks

**read** from the build: every form of the command runner's spawn is detached, so on macOS and Linux
each hook starts a new session. A hook with `async: true`, or with `asyncRewake` in an interactive
session (or under a second condition not traced), takes a separate branch unless
`forceSyncExecution` is set, which overrides `async`. That branch names the process
`async_hook_<pid>`, writes the input to stdin and closes it, backgrounds the shell command, and returns
at once with empty output, status 0 and a mark that it was backgrounded.

Backgrounding, which skips the output spill, clears the shell command's timeout timer and its abort
listener. The registration step that follows reads the hook's `asyncTimeout`, falling back to 15,000 ms,
and uses the value in a debug log line and nowhere else (the run below shows that line). **The
configured timeout of an `async: true` hook is logged, not enforced.**

- **stdout and stderr** stay attached to pipes, and the build accumulates them. When the process has
  completed, the next check, run as attachments are gathered, parses the stdout lines that start with
  `{` for the first object without `async`. That response is delivered on a later turn. The docs name
  its `additionalContext` and `systemMessage`.
- **`-p` teardown** awaits a step that kills every async hook not yet completed and finalizes it as
  `cancelled`. The kill is the routine described in section 5: SIGTERM to the group and its
  descendants, then SIGKILL after 1,500 ms.
- **Interactive exit**: that teardown step has no other caller. The exit sweep kills only shell
  commands whose status is running, and a backgrounded hook's status is backgrounded. Nothing in the
  build kills an async hook when an interactive session ends. The hook leads its own session with no
  controlling terminal, so the terminal's hangup does not reach it either. Read, not run.
- **`asyncRewake`** skips backgrounding, so its timer stays armed. On exit code 2 it queues a
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

The timeout is `hook.timeout * 1000` or the event's default (**read**). The default command timeout is
600,000 ms; the docs list the per-event exceptions. The runner passes the timeout's abort signal to the
shell-command class, together with the same number as that class's own timer. Either one ends in the
class's kill routine. **read** from the build: it marks the command killed and does nothing more when
there is no pid or the pid is 1 or lower. Otherwise it sends SIGTERM, and if anything is still alive
after the grace period it sends SIGKILL to the process group and to the descendants.

The signal helper first lists the hook's descendants by walking `ps` output from its pid. It then sends
the signal to `-pid` (the process group), falling back to the pid, and then to each listed descendant.
The constants are 137 and 143, a 1,500 ms grace period and a 100 ms check. So a timeout is
**SIGTERM to the process group and to every descendant still parented under the hook, then SIGKILL to
the group and those descendants after 1,500 ms** if any is still alive (checked every 100 ms). A child
that has double-forked away from the hook's parentage and left the group is outside both lists.

What the runner waits for is **stdio close, not exit**. **read** from the build: the runner's result
resolves on the child's `close` event, once both stdout and stderr have ended. It races that only
against the JSON `{"async":true}` handshake and a spawn error. Meanwhile the shell-command class
listens for `exit`, not `close`. Its exit handler resolves the class's own result and clears the timer
and the abort listener.

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
- **How often the instructions comparison (the delta in section 1) runs.** The search for its call sites was refused.
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
`LC_ALL=C grep -a -o -b -F '<literal>'` to find a site, then `tail -c +N | head -c M` around it. The
sites are described in sections 1 to 5 by what they do: the context memo and the walk, startup, the
invalidations, area files, watching, and running hooks.

This repository: `DECISIONS.md` rows A6, A7, A8, A17, A24 and A92;
`plugins/anatomiya/hooks/hooks.json`; `plugins/anatomiya/lib/write.mjs`; the companion notes
`docs/research/what-a-repeated-hook-context-costs.md`, `docs/research/what-a-hook-payload-carries.md` and
`docs/research/why-a-worktree-got-no-map.md`.
