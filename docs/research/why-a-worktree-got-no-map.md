# Why a worktree got no map

Read off Claude Code's published docs, the installed 2.1.280 build, `git help worktree` on
git 2.54.0, and fixtures built under `mktemp -d`. Every claim below names where it came from.
Written 2026-09-23 against the code of that day. Code is named by function, and
`mainCheckoutOf` lives in `plugins/anatomiya/lib/worktree.mjs`.

## Summary

1. Claude Code loads `CLAUDE.md` and `.claude/rules/*.md` from cwd and its ancestors, and it
   deliberately skips any ancestor that is in the main checkout but not in the worktree. The
   2.1.280 build carries a named pair of functions for exactly that exclusion. So a linked
   worktree of a repository that gitignores `/.claude` gets no rules and no CLAUDE.md, by
   design, not by accident.
2. The read-through that does exist covers `.claude/skills`, `.claude/agents` and
   `.claude/commands` only, and `.claude/settings.local.json` for saved approvals. Not rules,
   not CLAUDE.md, not arbitrary files.
3. `.worktreeinclude` is the documented first-party route, and it does reach `.claude/rules/...`
   and `.claude/anatomiya/facts.json`. Its limit is that it only runs for worktrees Claude Code
   creates with git. Four of ef-client's five live worktrees were made by hand, so it would not
   have covered them. It is worth recommending alongside the hook fix, not instead of it.
4. Plugin hooks do fire inside subagents, with `cwd` following the subagent into its own
   worktree. That is the "sometimes": the same session, the same plugin, silence only on the
   calls that happened inside a worktree.
5. `mainCheckoutOf` matches git for the normal case, including `worktree.useRelativePaths`
   (measured). It disagrees with git in two places, both named below; one is deliberate and
   documented in its own comment, one is not.
6. The precedent rule's silence on `src/components` is real and reproduced. When this was
   written the case against raising the floor was that `__tests__` is the shape ef-client's few
   unit tests take; section 4 ends with the corpus measurement taken afterwards, and the floor
   was raised on it.

---

## 1. Where Claude Code loads rules and CLAUDE.md from in a linked worktree

### The documented rule is cwd and its ancestors, with no worktree clause

> Claude Code loads `CLAUDE.md` and `CLAUDE.local.md` from your current working directory and
> every directory above it.

Source: https://code.claude.com/docs/en/memory, "How CLAUDE.md files load"

Rules load the same way: "Place markdown files in your project's `.claude/rules/` directory"
(same page, "Set up rules"). Nothing on that page says a worktree reads the main checkout.

The only worktree mentions on the memory page point the other way. On `CLAUDE.local.md`:

> If you work across multiple git worktrees of the same repository, a gitignored
> `CLAUDE.local.md` only exists in the worktree where you created it. To share personal
> instructions across worktrees, import a file from your home directory instead

Source: same page, "Import additional files"

And the one thing that *is* shared per repository is auto memory, not rules:

> Each project gets its own memory directory at `~/.claude/projects/<project>/memory/`. The
> `<project>` path is derived from the git repository, so all worktrees and subdirectories
> within the same repo share one auto memory directory.

Source: same page, "Auto memory"

### The build actively excludes the main checkout

Strings from `~/.local/share/claude/versions/2.1.280` (extracted with `strings -n 8`, searched
with python) carry a pair of helpers in the same chunk as the `claudemd:` and
`rules entry stat failed` log lines:

```js
function Y8e(e){let n=Un(e),r=Ur(e);
  return n!==null&&r!==null&&Bp(n)!==Bp(r)&&Gd(n,r)?{worktreeRoot:n,mainRepoRoot:r}:null}
function X8e(e,n){return n!==null&&Gd(e,n.mainRepoRoot)&&!Gd(e,n.worktreeRoot)}
```

`Y8e(cwd)` answers `{worktreeRoot, mainRepoRoot}` when the two differ and the worktree is under
the main repo. `X8e(dir, that)` answers true for a directory that is under the main repo and
*not* under the worktree. Three call sites use it, all in the memory loader:

- the CLAUDE.md ancestor walk: `let nr=X8e($n,Be), bn=Xe&&!nr`: `project` is forced false for
  such a level, so `CLAUDE.md` and `.claude/CLAUDE.md` there are not read;
- the rules walk: `for(let he of y.reverse()){if(X8e(he,M))continue; ...}`: the level is skipped
  outright;
- the nested-directory walk: `cwdLevelDirs: h.filter((w)=>!X8e(w,y))`.

This matters because Claude Code's own default worktree location is *inside* the repository:

> By default, the worktree is created under `.claude/worktrees/<name>/` at your repository root

Source: https://code.claude.com/docs/en/worktrees, "Start Claude in a worktree"

Without `X8e`, walking up from `.claude/worktrees/foo` would reach the main checkout root and
load its rules. `X8e` is what stops that. So the answer to "does it ever read them from the
main checkout" is no, and the no is deliberate. For a worktree placed *outside* the repository
(ef-client's `.worktrees/` siblings and the scratchpad ones, listed in section 2), the main
checkout is not an ancestor at all, so it is never a candidate.

### What is shared

The worktrees page lists exactly what reads through, and rules are not on the list:

> **Untracked skills, agents, and commands**: when the worktree checkout has no `.claude/skills`
> directory at its root, for example because your `.claude/skills` is gitignored, Claude Code
> loads the main checkout's project skills in the worktree session. [...] The same read-through
> covers `.claude/agents` and `.claude/commands`. For skills, the read-through requires Claude
> Code v2.1.277 or later.

> **Permission approvals**: choosing "Yes, and don't ask again" for a Bash command in a worktree
> session saves the rule to the main checkout's `.claude/settings.local.json` [...] Before
> v2.1.211, an approval granted in a worktree was saved inside that worktree

Source: https://code.claude.com/docs/en/worktrees, "What worktrees share with the main checkout"

That confirms the `settings.local.json` behaviour noted for 2.1.270 in this repo's memory, and
bounds it: settings-local for approvals, skills/agents/commands for untracked config. Rules,
CLAUDE.md, and anything under `.claude/anatomiya/` are outside the list.

### Does creating a worktree copy gitignored files? Yes, if you ask for it

`--worktree`, `EnterWorktree` and `isolation: "worktree"` all check out tracked files only, and
the docs say so plainly:

> A worktree is a fresh checkout, so untracked files like `.env` or `.env.local` from your main
> repository are not present. To copy them automatically when Claude creates a worktree, add a
> `.worktreeinclude` file to your project root.
>
> The file uses `.gitignore` syntax. Only files that match a pattern and are also gitignored are
> copied, so tracked files are never duplicated.

Source: https://code.claude.com/docs/en/worktrees, "Copy gitignored files into worktrees"

It reaches inside a wholly ignored directory, which is exactly ef-client's case
(`.gitignore:56` is `/.claude`):

> If you write a pattern that starts with `**/` and the files you want are inside a directory
> that is gitignored as a whole, Claude Code copies them only when that directory itself matches
> the pattern, or when the first name after the `**/` is one of the names in the directory's
> path. For example, if you write `**/.claude/skills/*.md`, that first name is `.claude`, so
> Claude Code copies the matching files out of an ignored `.claude/` directory.

Source: same section

The name is real in the build: `strings` on 2.1.280 returns `.worktreeinclude`,
`Skipping .worktreeinclude copy: realpath(`, `Skipping symlink in .worktreeinclude: `,
`Skipping .worktreeinclude entry: destination escapes worktree via committed symlink: ` and
` files from .worktreeinclude: `.

Two limits before recommending it:

- **Scope.** "This applies to every worktree Claude Code creates with git: `--worktree`
  worktrees, subagent worktrees, and parallel sessions in the desktop app" (same section). A
  worktree made with `git worktree add` gets nothing. With a `WorktreeCreate` hook it is "not
  processed" at all (same page, "Non-git version control").
- **Staleness.** A copy is a copy. The worktree then holds a map counted from the main
  checkout's tree at the moment the worktree was made, with no label saying so, which is the
  thing `echoContext`'s borrowed stamp exists to say (`plugins/anatomiya/lib/hook.mjs`).

ef-client has no `.worktreeinclude` today (`ls -a ~/Documents/Projects/empire-flippers/client`
matches nothing containing "worktree"). Four of its five worktrees were not created by Claude
Code with git, so adding one would cover future `--worktree` and `isolation: worktree` sessions
and nothing that exists now. Recommend it as a complement: it gives the worktree its own
`.claude/` for everything, including skills, agents and settings; the hook fix gives a labelled
answer in the worktrees nobody remembers to configure.

Suggested content, if the team wants it:

```text
**/.claude/rules/anatomiya-*.md
**/.claude/anatomiya/facts.json
```

The `**/` form is the one the docs give for a wholly ignored directory; this exact file was
later run through `claude -w` on 2.1.280 and copied the two anatomiya paths and nothing else
from `.claude/`.

---

## 2. Do plugin hooks fire for subagent tool calls, and what cwd do they get?

Yes, and the cwd follows the subagent.

> Hooks from settings files, managed policy settings, and plugins run inside subagents. When a
> subagent calls a tool, tool events such as `PreToolUse` and `PostToolUse` fire the same
> configured hooks as in the main conversation.

Source: https://code.claude.com/docs/en/hooks

On cwd in a worktree, the hooks page and the worktrees page say the same thing twice:

> **`${CLAUDE_PROJECT_DIR}` stays put**: it still points at the project root where the session
> started [...]
> **`cwd` follows Claude**: the `cwd` field in the hook's input JSON is the worktree root after
> Claude enters a worktree, and the new directory after Claude runs `cd`.

Source: https://code.claude.com/docs/en/hooks, and https://code.claude.com/docs/en/worktrees,
"Ask Claude to create a worktree"

And on subagents in their own worktrees:

> The same enforcement covers every subagent Claude spawns from the isolated session. [...]
> Subagents that run in their own worktree carry the same checks.

Source: https://code.claude.com/docs/en/worktrees, "How Claude Code enforces isolation"

`transcript_path` is the session's transcript, with `agent_id` naming the subagent:

> `agent_id`: "Unique identifier for the subagent. Present only when the hook fires inside a
> subagent call. Use this to distinguish subagent hook calls from main-thread calls."

Source: https://code.claude.com/docs/en/hooks, common input fields

`windowOf` in `plugins/anatomiya/lib/hook.mjs` already reads that pair and resolves the
subagent's own window under `<transcript>/subagents/agent-<id>.jsonl`, so the once-per-window
suppression is not what went quiet.

**This is the "sometimes".** The hook fires on every call. `cwd` is the worktree for calls made
inside one and the main checkout for calls made outside it, in the same session, from the same
plugin. So a session that spawns an `isolation: worktree` subagent, or that runs
`EnterWorktree` partway through, sees the map on some tool calls and `{}` on others, with no
error and nothing in the transcript to explain the difference. Reproduced directly: with a
`git worktree add`ed checkout of a repository whose `.claude` is gitignored, the `notice` hook
answered `{}` and `echoContext` answered `null` (fixture in section 3).

ef-client is living this. `git worktree list` in
`~/Documents/Projects/empire-flippers/client` today:

```
/Users/crisn/Documents/Projects/empire-flippers/client                          [production]
/private/tmp/claude-502/.../scratchpad/stg-client                                 [stg-7642-cypress]
/private/tmp/claude-502/.../scratchpad/wt-client                                  [EF-7642-implement-an-loi-builder]
/Users/crisn/Documents/Projects/empire-flippers/.worktrees/client-7768          [EF-7768-account-lookup-add-recaptcha]
/Users/crisn/Documents/Projects/empire-flippers/.worktrees/client-staging-7768  [staging]
```

Four linked worktrees, all outside the repository, none with a `.claude/` of its own, all of
them silent before the fix.

---

## 3. git worktree internals, and whether `mainCheckoutOf` matches them

### What git writes

Fixture, `mktemp -d`, git 2.54.0 (Apple Git-157), `git init main && git worktree add ../wt -b b1`:

```
wt/.git                       →  gitdir: /.../main/.git/worktrees/wt
main/.git/worktrees/wt/gitdir →  /.../wt/.git
main/.git/worktrees/wt/commondir → ../..
ls main/.git/worktrees/wt     →  HEAD ORIG_HEAD commondir gitdir index logs refs
ls -a ../wt                   →  .git .gitignore f      (no .claude)
```

`git -C ../wt rev-parse --git-dir --git-common-dir --show-toplevel` answers
`/.../main/.git/worktrees/wt`, `/.../main/.git`, `/.../wt`.

The semantics match `git help gitrepository-layout`: the worktree's `.git` is a file whose
single line is `gitdir: <path to $GIT_DIR/worktrees/<id>>`; `commondir` holds the path (relative
to that directory) of the shared git directory; `gitdir` holds the path of the `.git` file that
points back here. The back-pointer is what makes the link two-way, and what
`mainCheckoutOf` uses to refuse a forged registration.

### Relative paths

`git help worktree`:

> `--relative-paths`, `--no-relative-paths`
>  Link worktrees using relative paths or absolute paths (default). Overrides the
>  `worktree.useRelativePaths` config option

> `worktree.useRelativePaths`
>  Link worktrees using relative paths (when "true") or absolute paths (when "false"). [...]
>  Defaults to "false".
>  Note that setting `worktree.useRelativePaths` to "true" implies enabling the
>  `extensions.relativeWorktrees` config [...] thus making it incompatible with older versions of
>  Git.

Measured on the same git:

```
A-rel/.git                     →  gitdir: ../A/.git/worktrees/A-rel
A/.git/worktrees/A-rel/gitdir  →  ../../../../A-rel/.git
A/.git/worktrees/A-rel/commondir → ../..
```

Both sides are relative, each to its own containing directory. `mainCheckoutOf` resolves them
with `resolve(at, gitdir)` and `resolve(own, back.head.trim())`
(`mainCheckoutOf` in `plugins/anatomiya/lib/worktree.mjs`), which is the right base for each, so relative
worktrees work. Confirmed end to end by calling `echoContext` and `ownLayout` on the fixture:

```
A-rel   echo= "Counted from the main checkout at /.../A, not this worktree..."   layout.from= /.../A
A-abs   echo= "Counted from the main checkout at /.../A, not this worktree..."   layout.from= /.../A
A       echo= "Counted from this repository's own code..."                     layout.from= null
```

A relative-path fixture now pins this in `test/worktree.test.mjs`.

### Where the guards agree with git

- **Submodule.** Its git directory is `$GIT_DIR/modules/<name>` and has no `commondir`, so
  `common.kind !== "file"` and the function returns null. Correct: a submodule has no main
  worktree in the worktree sense.
- **Bare repository.** `git clone --bare A B.git && git worktree add ../B-wt`: `commondir`
  resolves to `B.git`, `basename` is not `.git`, so null. `echoContext('$T/B-wt')` returned
  `NULL`. Correct: a bare repository has no checkout to borrow from.
- **Forged registration.** The back-pointer check
  (`realpathOrNull(resolve(own, back.head.trim())) !== realpathOrNull(marker)` → null) means a
  copied `.git` file, or one shipped beside a registration naming another repository, reaches
  nothing. Matches git, which also treats a worktree whose `gitdir` no longer points back as
  broken (`git worktree prune`).

### Where they disagree with git

**`--separate-git-dir`, and it is deliberate.** `git init --separate-git-dir=$T/Sgit S` puts
`gitdir: /.../Sgit` in `S/.git`. A worktree of it has `commondir` resolving to `/.../Sgit`, whose
basename is `Sgit`, so `mainCheckoutOf` returns null, and `echoContext('$T/S-wt')` answered
`NULL` even though `S` holds a map. Git, meanwhile, resolves `S`: `git -C S rev-parse
--show-toplevel` answers `/.../S`. The code's own comment names this
(`mainCheckoutOf` in `plugins/anatomiya/lib/worktree.mjs`): naming that checkout would mean reading `core.worktree`
out of git config, which is a config parse on every tool call. Right call; the cost is a class of
repository that never borrows. Note git itself is odd here: `git worktree list` prints the main
worktree's path as `/.../Sgit`, the git directory, not `/.../S`.

**`core.worktree` on an ordinary `.git`, and this one is not documented.** Set
`core.worktree = $T/elsewhere` in a normal repository `M` that has a worktree `W`:

```
git -C M rev-parse --show-toplevel   →  /.../elsewhere
git -C M worktree list               →  /.../M  [main]     /.../W  [w1]
echoContext('$T/W')                  →  "Counted from the main checkout at /.../M ..."
```

Git resolves the main working tree to `/.../elsewhere`; `mainCheckoutOf` answers `/.../M`. So the
borrowed map is the map of `M`, which is the directory `git worktree list` names and the one a
developer actually has on disk, but it is not the tree git would operate on. Low severity, and
Claude Code refuses to adopt such a directory as an isolation worktree anyway:

> git resolves its working tree to the main checkout through a `core.worktree` redirect. From
> such a directory, an ordinary git command such as `git reset --hard` would act on the main
> checkout instead of the worktree.

Source: https://code.claude.com/docs/en/worktrees, "Claude Code refuses to use a worktree"

Worth one line in the comment beside the `--separate-git-dir` note, not worth a config read.

**A symlinked `$GIT_DIR/worktrees`.** The location guard compared a realpath with a path that was
not resolved again, so a `.git/worktrees` behind a link failed closed. Behind that sat a second
fault: `commondir` holds `../..`, and git reads
it against the registration as spelled, so resolving it against the registration's realpath
landed outside the repository. Both files are now read against the spelled path and only the
location compare is made on realpaths, pinned by a test that moves the registrations behind a link.

---

## 4. The precedent rule: is "any namesake makes it tested" right?

### What the code does

`coveredRoot` in `plugins/anatomiya/lib/precedent.mjs` finds the source roots a test's tail
matches, and before this change one line of it was the whole question:

```js
if (matches.some((r) => r.companions.with > 0)) return null;
```

One namesake anywhere under the root silences the rule for the entire root. `testsAnything`
in `precedentFindings` was the same predicate one level up, for the whole repository: a repository with a
single namesake pair anywhere is a repository with test precedent everywhere.

`PRECEDENT_FLOOR = 3` already existed and was applied twice, but to different counts:
`covered.companions.of < PRECEDENT_FLOOR` (the root must hold 3 files) and
`testFilesHeld(covered) >= PRECEDENT_FLOOR` (a root holding 3+ tests that pair with nothing is a
root whose habit is simply not namesakes). Neither floor was applied to `with`.

### Reproduced on ef-client

Called against `~/Documents/Projects/empire-flippers/client/.claude/anatomiya/facts.json`
(schema 18, 7 roots) with no code changes:

```
src/components/Foo/__tests__/Foo.test.tsx  =>  null
src/components/__tests__/x.test.ts         =>  null
src/pages/__tests__/y.test.ts              =>  "anatomiya: ... src/pages: 1023 files, 0 with a
                                                namesake test; elsewhere in it 2 vitest specs
                                                under __tests__, none of them a namesake."
src/utils/__tests__/z.test.ts              =>  null
```

The roots:

| root | testRoot | companions with/of | tests held |
| --- | --- | --- | --- |
| `src/pages` | no | 0 / 1023 | 2 vitest, under `__tests__` |
| `src/components` | no | **1 / 517** | 2 vitest, no common subdir |
| `src/queries` | no | 0 / 331 | none |
| `cypress/integration` | yes | n/a | 108 cypress |
| `src/utils` | no | 4 / 60 | 4 vitest, under `__tests__` |
| `src/hooks` | no | 0 / 47 | none |
| `src/layouts` | no | 0 / 42 | none |

So `src/components` is the only root in ef-client with `0 < with < 3`, and it holds 517 files.
That is the silence the investigation found, confirmed.

### What a threshold would change

Changing that line to `r.companions.with >= PRECEDENT_FLOOR` flips exactly the roots with
`0 < with < 3`. Measured:

| repository | eligible roots | `with == 0` | `with` 1 or 2 | `with >= 3` | files in the flipping roots |
| --- | --- | --- | --- | --- | --- |
| ef-client | 6 | 4 | **1** (`src/components` 1/517) | 1 | 517 |
| microsoft/vscode (corpus) | 3 | 1 | 0 | 2 | 0 |
| anatomiya itself | 2 | 0 | 0 | 2 (46/57, 15/25) | 0 |

vscode's three roots are `src/vs` 1043/6498, `extensions` 313/2522, `src/vscode-dts` 0/177,
nothing near the boundary. anatomiya's own two are far above it.

A ratio threshold would behave the same on this evidence and is worse to defend: 1/517 is 0.19%,
313/2522 is 12.4%, 1043/6498 is 16%. There is no repository here that sits between, so a ratio
buys nothing a count does not, and it introduces a second number nobody can check by eye.
`testsAnything` would need the same treatment or the root-level change is reachable only in
repositories that already pair three namesakes somewhere.

**Corpus caveat.** Of 35 repositories under `~/Documents/Projects/anatomiya-corpus/`, exactly
one carries a record on disk: `microsoft__vscode/.claude/anatomiya/facts.json`. Twelve more have
a `.claude/` with rules or skills, none with an `anatomiya/` directory. So the corpus answered
one repository, not 35, and the table above is the whole measurement. Re-running the scan across
the corpus would be the way to widen it, and that is a corpus run, not a reading.

### The finding that argues against changing it

The report says agents create `__tests__` directories against house style. anatomiya's counts
say `__tests__` **is** the house style in ef-client's `src/`:

```
src/components/Calendar/__tests__/Store.test.ts
src/components/forms/utils/tests/pickDeep.test.js
src/pages/Marketplace/Controller/utils/__tests__/mergePersistedColumns.test.ts
src/pages/MyAccount/Controller/sections/Perks/__tests__/perks.test.ts
src/utils/__tests__/currencyLabel.test.ts
src/utils/__tests__/yup.test.js
src/utils/__tests__/humps.test.js
src/utils/deepmerge.test.ts
```

Six of the eight tests under `src/` are inside a `__tests__` directory; `pickDeep.test.js` sits
in `forms/utils/tests/` and `deepmerge.test.ts` beside its source. `src/utils` has `root: "src/utils/__tests__"` recorded in the
facts, which is anatomiya saying so itself. The single namesake that silences `src/components`
is `Store.test.ts` beside `Store.ts`, and it is inside `Calendar/__tests__`.

So on ef-client, raising the floor would make the notice fire on writes that follow what the
repository already does, in the largest root it has. The notice already fires on `src/pages`,
where the counts line honestly reports "2 vitest specs under `__tests__`" and the closing
sentence then says "Put it where the siblings put theirs", which, read against those two specs,
is where the agent was already putting it.

Three things follow, in order of what I would do:

1. Ask the ef-client team what they actually saw. The report and the counts disagree, and the
   counts are checkable. It may be the api repo (Rails, `spec/`), or co-location that a person
   wants and the tree does not yet show.
2. The `src/components` silence is a real gap in the rule and worth fixing on its own merits,
   for a repository where the one namesake is the outlier rather than the pattern. Do not ship
   it as the fix for this report.
3. If it does ship, the sentence needs work too: "Put it where the siblings put theirs" should
   not follow a counts line that just named a `__tests__` directory as where the siblings put
   theirs.

Neither the rule nor the floor was changed while writing this.

### Measured afterwards, and what was decided

The corpus caveat above was closed by scanning all 35 corpus repositories in memory from a frozen
copy of the plugin and asking the rule about every test file each one already tracks, 40,701 in
all. A mature repository put its tests where it meant to, so every hit is a candidate false
positive. With `some(with > 0)` the rule fired on 2, both in ef-client's `src/pages`. With a floor
of three namesakes it fired on 5: those 2, the 2 tests in ef-client's `src/components`, and
`features/support/govuk_test.rb` in alphagov/whitehall, a Cucumber support file whose name reads
as a test. Thirteen roots in eleven repositories flipped, and no other existing test was touched.

The floor shipped. The notice's question is whether a test belongs in a root at all, and 1 of 517
answers that the same way 0 of 1023 does; the shape the few tests take is what the counts line
already reports. The closing sentence the notice prints is unchanged: it is measured wording
(H39), and rewording it is a trial, not an edit.

---

## Sources

- https://code.claude.com/docs/en/memory: CLAUDE.md and `.claude/rules/` discovery, path-scoped
  rules, auto memory scope, the worktree note on `CLAUDE.local.md`
- https://code.claude.com/docs/en/worktrees: `--worktree`, `EnterWorktree`,
  `isolation: worktree`, `.worktreeinclude`, what worktrees share, isolation checks, refusals
- https://code.claude.com/docs/en/hooks: hooks in subagents, `cwd` / `transcript_path` /
  `agent_id`, `WorktreeCreate` / `WorktreeRemove`
- `~/.local/share/claude/versions/2.1.280`: `strings -n 8`, then python regex for call sites
  (`Y8e`, `X8e`, `.worktreeinclude`, `tengu_worktree_*`)
- `git help worktree`, `git help gitrepository-layout`, git 2.54.0 (Apple Git-157)
- Fixtures under `mktemp -d`: plain worktree, `--relative-paths`, `--separate-git-dir`, bare
  clone, `core.worktree` redirect; `echoContext` / `ownLayout` / `noticeFor` called directly
- `plugins/anatomiya/lib/worktree.mjs` (`mainCheckoutOf`), `plugins/anatomiya/lib/hook.mjs` (`ownMap`, `ownLayout`, `echoContext`,
  `windowOf`), `plugins/anatomiya/lib/precedent.mjs`, `DECISIONS.md` row A24
- `~/Documents/Projects/empire-flippers/client/.claude/anatomiya/facts.json`,
  `~/Documents/Projects/anatomiya-corpus/microsoft__vscode/.claude/anatomiya/facts.json`
