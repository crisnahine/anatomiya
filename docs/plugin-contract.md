# The plugin marketplace contract

What Claude Code actually requires of `.claude-plugin/marketplace.json` and `plugins/<name>/.claude-plugin/plugin.json`,
as of CLI 2.1.241 and the documentation served on 2026-08-23, except where a line names the build it
was measured on. This page is not on the plugin's re-check list, so it ages where `VERIFYING.md` does
not.

Every claim below carries its source. Three kinds of source were used, and nothing else:

| Source | How it is cited |
|---|---|
| Anthropic's documentation | The `.md` URL, its section heading, and the line number in the raw Markdown fetched 2026-08-23 |
| The installed CLI binary | `~/.local/share/claude/versions/2.1.241`, plus the exact symbol or string found in it |
| Behaviour of `claude plugin validate` | The fixture and the verbatim output |

The docs moved: `docs.claude.com/en/docs/claude-code/plugins` returns `301` to
`code.claude.com/docs/en/plugins`. The canonical spec is a third page, `plugins-reference`, which the
task's URL list did not name and which is where most of the contract actually lives.

The line numbers are from the raw Markdown (`curl -sL https://code.claude.com/docs/en/<page>.md`), not from
the rendered page. Fetching the same URL through a summarising reader produced a manifest schema that
disagrees with the raw page in several places, so the raw Markdown is what is quoted here.

## 1. `.claude-plugin/marketplace.json`

### Required fields

Three, and validation fails without any of them
([plugin-marketplaces.md, "Required fields", L159-163](https://code.claude.com/docs/en/plugin-marketplaces.md)).

| Field | Type | What it does |
|---|---|---|
| `name` | string | Marketplace identifier, kebab-case, no spaces. Public-facing: it is the part after `@` in `plugin@marketplace`. One marketplace per name per user; adding a second with the same name replaces the first |
| `owner` | object | Maintainer information |
| `plugins` | array | The catalog |

`owner` requires `name`; `email` and `url` are optional (L173-177).

`owner` being genuinely required, not merely documented as required, was confirmed by removing it:

```
❯ owner: Invalid input: expected object, received undefined
✘ Validation failed
```

A set of marketplace names is reserved for Anthropic and is re-checked on every load, not only when the
marketplace is added, so a name can become reserved under an already-registered marketplace and stop it
loading (L165-169). The list includes `claude-plugins-official`, `anthropic-plugins`, `agent-skills`,
`first-party-plugins` and `healthcare`, and a regex blocks names that impersonate those. The same reserved
strings appear in the binary alongside the pattern
`(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|...)`.

### Optional fields

From L181-190:

| Field | Type | What it does |
|---|---|---|
| `$schema` | string | Editor autocomplete only. Ignored at load time |
| `description` | string | Shown when browsing |
| `version` | string | Version of the manifest itself, not of any plugin |
| `metadata.pluginRoot` | string | Directory that bare source names resolve under. Needs 2.1.239+ |
| `allowCrossMarketplaceDependenciesOn` | array | Marketplaces whose plugins this one's plugins may depend on. Anything else is blocked at install |
| `renames` | object | Former plugin name to current name, or to `null` if removed. Migrates existing users. Needs 2.1.193+ |

`description` and `version` are also accepted under `metadata` for backward compatibility (L190).

### The `plugins` array entry shape

Two required fields, `name` and `source` (L198-201). Beyond those, an entry may carry
**any field from the plugin manifest schema** plus five marketplace-only fields: `source`, `category`,
`tags`, `strict`, `relevance` (L194). So `description`, `version`, `author`, `commands`, `hooks`,
`mcpServers`, `lspServers`, `skills`, `agents`, `displayName`, `keywords`, `metadata`, `homepage`,
`repository`, `license` and `defaultEnabled` are all legal in a marketplace entry (L207-233).

`strict` is the field worth knowing (L637-649):

| Value | Behaviour |
|---|---|
| `true` (default) | `plugin.json` is the authority. The marketplace entry supplements it, and the two are merged |
| `false` | The marketplace entry is the entire definition. A `plugin.json` that also declares components is a conflict and the plugin fails to load |

`defaultEnabled` in the marketplace entry beats `defaultEnabled` in `plugin.json` (L222). `version` goes the
other way: `plugin.json` wins
([plugins-reference.md, "Metadata fields", L502](https://code.claude.com/docs/en/plugins-reference.md)).

### What `source` accepts

All seven forms, from L241-249. A relative path is the only one that is a bare string; the rest are objects
with a discriminating inner `source` key.

| Form | Shape | Fields | Notes |
|---|---|---|---|
| Relative path | string, `"./my-plugin"` | none | Directory inside the marketplace repository |
| `github` | object | `repo`, `ref?`, `sha?` | GitHub shorthand, `owner/repo` |
| `url` | object | `url`, `ref?`, `sha?` | Any git URL |
| `git-subdir` | object | `url`, `path`, `ref?`, `sha?` | Sparse partial clone of one subdirectory |
| `npm` | object | `package`, `version?`, `registry?` | Installed with `npm install` |
| `archive` | object | `url`, `sha256?` | Zip over HTTPS, no git or npm needed. Needs 2.1.224+ |
| `command` | object | `command`, `timeout?`, `mode?` | Directory produced by running a local command, re-run once per session. Needs 2.1.229+ |

Three things about relative paths (L243, L285-289):

- They resolve against the **marketplace root**, the directory that contains `.claude-plugin/`, not against
  `.claude-plugin/` itself.
- They must start with `./`, unless `metadata.pluginRoot` is set, which turns a **bare single-segment name**
  such as `"formatter"` into `<pluginRoot>/formatter`. A name containing a `/` is not a bare name and still
  needs the prefix.
- `../` is refused. "Don't use `../` to reference paths outside the marketplace root" (L285).

When both `ref` and `sha` are set on a git-based source, `sha` wins and is fetched directly (L260-262).

A marketplace added by direct URL to the `marketplace.json` file downloads only that one file, so every
relative-path entry in it fails to install (L291-293 and the troubleshooting section at L1343-1355). Relative
paths require a git-based or local-directory marketplace.

### May a plugin's source be the repository root, `"./"`?

Yes. This is documented, not merely tolerated, and it has one documented consequence.

The marketplaces page addresses the case directly under "Advanced plugin entries" (L628-635):

> When several plugin entries share one `skills/` folder at the marketplace root (`source: "./"`), list
> specific subdirectories instead so each entry loads only its own skills [...] With a marketplace-root
> `source`, the listed paths are the complete set for that entry, and other directories in the shared
> `skills/` folder don't load. Listing `./skills/` itself, or the plugin root, keeps the full scan. If none
> of the listed paths exist, the default scan runs instead.

So a root-sourced entry **inverts the `skills` rule**. Everywhere else `skills` adds to the default
`skills/` scan; under a marketplace-root source, naming subdirectories replaces it. The same exception is
written into the CLI's own schema description, recovered from the binary:

> Path to a skill directory, relative to the plugin root ("." / "./" denote the plugin root itself). Loaded
> in addition to the skills/ directory (except: for a marketplace entry whose source resolves to the
> marketplace root, declaring a specific subdirectory replaces the skills/ scan).

Confirmed by validating a two-plugin fixture, one entry at `"./"` and one at `"./second"`:

```
✔ Validation passed with warnings      (the only warning was a missing marketplace description)
```

The cost is not in validation, it is in what gets copied. See section 5.

## 2. `plugins/<name>/.claude-plugin/plugin.json`

### The manifest is optional

"The manifest is optional. If omitted, Claude Code auto-discovers components in default locations and
derives the plugin name from the directory name"
([plugins-reference.md, "Plugin manifest schema", L420](https://code.claude.com/docs/en/plugins-reference.md)).

If present, `name` is the only required field (L460). Kebab-case, no spaces. It is what namespaces every
component: agent `agent-creator` in plugin `plugin-dev` appears as `plugin-dev:agent-creator` (L466-468).
The binary enforces `^[a-z0-9](?:[a-z0-9._-]*[a-z0-9_-])?$` and rejects empty names, spaces, and path
separators with dedicated messages.

When a marketplace entry lists the plugin under a different name, **the marketplace entry name wins** for
`enabledPlugins` keys and `/plugin` (L464).

### Metadata fields

L500-510. None required.

| Field | Type | What it does |
|---|---|---|
| `$schema` | string | Editor autocomplete. Ignored at load time |
| `displayName` | string | UI label. Falls back to `name`. May contain spaces and any casing. Never used for namespacing or lookup |
| `version` | string | Semantic version. Setting it pins the plugin; see section 6 |
| `description` | string | What the plugin provides |
| `author` | object | `name` required, `email` and `url` optional |
| `homepage` | string | Documentation URL |
| `repository` | string | Source URL |
| `license` | string | SPDX identifier |
| `keywords` | array | Discovery tags |
| `metadata` | object | Free-form, for the author's own use. Claude Code never reads it. A non-object value is ignored with a warning. Before 2.1.222 the key was treated as unrecognised |
| `defaultEnabled` | boolean | Whether the plugin starts enabled when the user has set nothing. Default `true`. Needs 2.1.154+ |

Also legal, though not metadata: `userConfig`, `channels` and `dependencies` (L537-539).

### The loadable kinds: the list of five is not complete

The question asked whether hooks, commands, agents, skills and mcpServers is the complete and current set.
It is not. The current set is **eleven** manifest-nameable kinds plus two directories that need no key.

From the component path fields table (L525-539) and the file locations reference (L890-904):

| Kind | Manifest key | Default path when the key is absent | String or array? | Default behaviour when the key is present |
|---|---|---|---|---|
| Skills | `skills` | `skills/` | string or array | **Adds** to the default scan (except at a marketplace root) |
| Commands | `commands` | `commands/` | string or array | **Replaces** the default |
| Agents | `agents` | `agents/` | string or array | **Replaces** |
| Workflows | `workflows` | `workflows/` | string or array | **Replaces** |
| Output styles | `outputStyles` | `output-styles/` | string or array | **Replaces** |
| Themes | `experimental.themes` | `themes/` | string or array | **Replaces** |
| Monitors | `experimental.monitors` | `monitors/monitors.json` | string or array | **Replaces** |
| Hooks | `hooks` | `hooks/hooks.json` | string, array or object | **Merges** |
| MCP servers | `mcpServers` | `.mcp.json` | string, array or object | **Merges** |
| LSP servers | `lspServers` | `.lsp.json` | string, array or object | **Merges** |
| Executables | none | `bin/` | not nameable | Added to the Bash tool's `PATH` while the plugin is enabled |
| Default settings | none | `settings.json` | not nameable | Only the `agent` and `subagentStatusLine` keys are honoured |

Two of these are experimental. `themes` and `monitors` "have a manifest schema that may change between
releases"; declaring them at the top level still works but warns, and a future release will require the
`experimental.` prefix (L541-543).

`bin/` and `settings.json` have no manifest key at all. They are pure convention: put files there and they
load. `bin/` is the one that changes what a shell command means, since its contents become bare commands in
every Bash call while the plugin is enabled (L903).

A `CLAUDE.md` at the plugin root is **not** loaded as project context (L886). Instructions have to ship as a
skill.

The three merge behaviours are not decoration. "When the manifest specifies `commands`, the default
`commands/` directory is not scanned. To keep the default and add more, list it explicitly:
`"commands": ["./commands/", "./extras/"]`" (L639). Claude Code warns about the ignored folder in
`claude plugin list` and the `/plugin` detail view, unless the manifest path points into the default folder,
which names it explicitly (L643).

### String or array

Every path field accepts either (L651: "Multiple paths can be specified as arrays"). The three merge-rule
fields additionally accept an object, which is the config inline rather than a path to it (L531-534).

The CLI's schema, read out of the binary, shows `mcpServers` accepting more forms than the docs table lists:
a path string, an MCPB or DXT bundle path or URL, an inline map keyed by server name, or an array mixing all
three. The binary carries the messages `MCPB file path must end with .mcpb or .dxt` and
`Path to MCPB file relative to plugin root`. The `.mcpb`/`.dxt` form is not in the docs table.

The same schema shows `commands` entries may be **objects**, not only path strings, with keys
`source` (a file path) or `content` (inline Markdown, and "Command must have either "source" (file path) or
"content" (inline markdown), but not both"), plus `description`, `argument-hint`, `model` and
`allowed-tools`. The docs describe `commands` only as `string|array`.

### Paths pointing outside the plugin root

**Refused, at two levels.** Not undefined behaviour.

The rule: "All paths must be relative to the plugin root and start with `./`, except that the `skills` field
also accepts `"."`" (L647). Both `"."` and `"./"` mean the plugin root itself, and `"."` failed validation
before 2.1.221, so `"./"` is the portable spelling (L648-649).

Validated with `"agents": "../outside/agents"`:

```
❯ agents: Invalid input
❯ agents[0]: Path contains ".." which could be a path traversal attempt: ../outside/agents
✘ Validation failed
```

The binary carries the matching runtime message:
`Paths in plugin.json must not use ".." to reference files outside the plugin directory`.

There is a second, independent reason it cannot work: the plugin is **copied** into
`~/.claude/plugins/cache`, so files outside its directory are simply not there (L813-815). Even if the path
validated, it would resolve to nothing.

The documented escape hatch is a symlink, and only inside the same marketplace (L817-831):

| Symlink target | What happens when the plugin is cached |
|---|---|
| Inside the plugin's own directory | Preserved as a relative symlink |
| Elsewhere in the same marketplace | **Dereferenced**, the target's content is copied in its place |
| Outside the marketplace | Skipped, for security |

For `--plugin-dir`, a local path, or a `command` source in copy mode, only the first case survives; all
others are skipped (L825).

### Unrecognized fields

Ignored, deliberately, so one file can double as a VS Code, Cursor, npm or MCPB manifest (L470-476).
`claude plugin validate` reports them as warnings and suggests a correction when a field is one or two
characters off a real one. A plugin with only such warnings still passes and still loads (L478-481).

A **recognised** field with the wrong type is different: most fields make the plugin fail to load, while
`experimental` and `metadata` ignore a non-object value with a warning (L483-486). `--strict` turns warnings
into errors (L488-490).

### What real manifests actually declare

65 `plugin.json` files under `~/.claude/plugins/cache`, top-level keys counted:

| Key | Count of 65 |
|---|---|
| `name`, `version`, `description` | 65 |
| `license`, `author` | 64 |
| `keywords` | 63 |
| `repository` | 62 |
| `homepage` | 61 |
| `mcpServers` | 6 |
| `$schema` | 3 |
| `agents` | 2 |
| `skills` | 1 |
| everything else | 0 |

The manifest is metadata in practice. Not one of the 65 declares `hooks`, `commands`, `workflows`,
`outputStyles`, `lspServers`, `userConfig`, `dependencies`, `defaultEnabled` or `experimental`. Component
path fields exist to override the default layout, and almost nobody overrides it.

The three `$schema` values are all `https://json.schemastore.org/claude-code-plugin-manifest.json`, which is
SchemaStore, a third party, not Anthropic. It resolves (HTTP 200).

## 3. `${CLAUDE_PLUGIN_ROOT}`

There are three variables, not one:
`${CLAUDE_PLUGIN_ROOT}` (the plugin's install directory), `${CLAUDE_PLUGIN_DATA}` (a persistent directory
that survives updates, at `~/.claude/plugins/data/{id}/`), and `${CLAUDE_PROJECT_DIR}` (the project root)
(L677-681).

The implementation is one function in the binary, and it substitutes all three together:

```js
function _1e(e,t){let r=(o)=>o,n=e.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,()=>r(t.path));
if(n=n.replace(/\$\{CLAUDE_PROJECT_DIR\}/g,()=>r(fl())),t.source){let o=t.source;
n=n.replace(/\$\{CLAUDE_PLUGIN_DATA\}/g,()=>r(Bgt(o)))}return n}
```

Whether a given field is substituted is therefore a question of whether the loader passes that field through
`_1e`. Each surface, answered separately.

### Hook commands: yes

L688, "Hook and monitor commands: anywhere the placeholder appears". True of both forms. Exec form
substitutes into `command` and into each element of `args` as a plain string, with no shell involved, so
apostrophes, `$` and backticks pass through verbatim
([hooks.md, "Exec form and shell form", L460](https://code.claude.com/docs/en/hooks.md)). Shell form
substitutes into the one `command` string, which is then handed to a shell, so each placeholder needs double
quotes (L462, L596).

### Command Markdown files: yes

The docs table says only "Skill and agent content" (L687), which reads as though flat `commands/*.md` files
are excluded. They are not. The binary handles both through one function, and the branch label proves the
scope:

```js
u=$me(a.description,e),u=c??Stt(l,i?"Plugin skill":"Plugin command"),
p=Gq.dirname(t.filePath),f=(Y)=>{let W=_1e(Y,{path:o,source:r});
if(s.isSkillMode)W=W.replace(/\$\{CLAUDE_SKILL_DIR\}/g,()=>p);return W}
```

The `"Plugin skill" : "Plugin command"` ternary is the same code path for both. `_1e` runs either way. The
same closure is applied to the `allowed-tools` frontmatter value, so the variable resolves in frontmatter as
well as body text. `${CLAUDE_SKILL_DIR}` is a fourth variable that exists **only** in skill mode and is not
in the documented table.

### Skill files: yes

L687, "Skill and agent content: anywhere the placeholder appears". Same code path as above.

### Agent files: yes

L687. The binary shows agent bodies going through the same helper:
`C=_1e(u.trim(),{path:o,source:n})`, followed by a `userConfig` substitution pass.

### Inside `plugin.json` itself: split, and this is the trap

Two different answers depending on which key.

**Inline hook, MCP and LSP configs declared in the manifest: yes.** The `hooks`, `mcpServers` and
`lspServers` keys accept an object, and that object is the same shape the loader substitutes anywhere else.
The marketplaces page shows exactly this, a `${CLAUDE_PLUGIN_ROOT}` inside an inline `hooks` block and an
inline `mcpServers` block in a marketplace entry, and says "use this variable in hook commands and MCP server
configs" (plugin-marketplaces.md L591-608, L617).

**Manifest path fields: no.** `commands`, `agents`, `skills`, `workflows`, `outputStyles` and the
`experimental.*` paths are validated as relative paths that must begin with `./`, so a value beginning with
`${` fails before any substitution is attempted. Validated with
`"commands": "${CLAUDE_PLUGIN_ROOT}/commands"` against a directory that exists:

```
❯ commands: Invalid input
❯ commands: Path not found: ${CLAUDE_PLUGIN_ROOT}/commands. The runtime loader will report this as a load failure.
✘ Validation failed
```

The literal, unsubstituted string appears in the error. The variable is never expanded there, and the
message states the runtime loader fails the same way. Path fields are already relative to the plugin root,
so the variable is redundant as well as refused.

### In the environment of a spawned hook process: yes

All three are exported. L683: "All three are exported as environment variables to hook processes and to MCP
and LSP server subprocesses."

The hooks page repeats it for both hook forms: "both export them as the environment variables
`CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA` on the spawned process, so a script can
read `process.env.CLAUDE_PLUGIN_ROOT` regardless of how it was launched" (hooks.md L487).

The binary shows the environment being assembled:

```js
F={...nO(),...uir(o),CLAUDE_PROJECT_DIR:k(A)}, ...
if(u){if(F.CLAUDE_PLUGIN_ROOT=k(u),d)F.CLAUDE_PLUGIN_DATA=k(Bgt(d))}
if(Object.assign(F,oph(d)),x)for(let[xe,Fe]of Object.entries(x)){
let Ye=xe.replace(/[^A-Za-z0-9_]/g,"_").toUpperCase();F[`CLAUDE_PLUGIN_OPTION_${Ye}`]=String(Fe)}
```

`CLAUDE_PLUGIN_ROOT` is set only when the hook belongs to a plugin (`if(u)`), and `CLAUDE_PLUGIN_DATA` only
when the plugin has a source. `userConfig` values arrive as `CLAUDE_PLUGIN_OPTION_<KEY>` in the same
environment. Monitor processes are the exception: they do not get the `CLAUDE_PLUGIN_OPTION_*` variables
(plugins-reference.md L319).

### Summary

| Surface | Substituted inline? | Source |
|---|---|---|
| Hook `command` and `args` | yes | plugins-reference L688, hooks L460-462 |
| Monitor `command` | yes | plugins-reference L688, L317 |
| Skill content and frontmatter | yes | plugins-reference L687, binary `_1e` call site |
| Command Markdown content | yes | binary, `"Plugin skill" : "Plugin command"` branch |
| Agent content | yes | plugins-reference L687, binary `_1e(u.trim(), ...)` |
| MCP stdio `command`, `args`, `env` | yes | plugins-reference L689 |
| MCP http/sse/ws `url`, `headers`, `headersHelper` | yes | plugins-reference L690 |
| LSP `command`, `args`, `env`, `workspaceFolder` | yes | plugins-reference L691 |
| Inline `hooks` / `mcpServers` / `lspServers` in plugin.json | yes | plugin-marketplaces L591-617 |
| Manifest path fields in plugin.json | **no, refused** | `claude plugin validate` output above |
| Environment of a spawned hook | **yes, as a real env var** | plugins-reference L683, hooks L487, binary |

One caveat worth carrying: `${CLAUDE_PLUGIN_ROOT}` changes on every plugin update, and the old directory
stays on disk only for a grace period. Never write state there; that is what `${CLAUDE_PLUGIN_DATA}` is for
(L712). When a plugin updates mid-session, hooks and servers keep using the old path until `/reload-plugins`;
monitors need a full restart (L714).

## 4. Hooks

### The event names

Thirty, from the plugin hooks table (plugins-reference.md L104-136). Plugin hooks respond to the same events
as user-defined hooks (L102).

`SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`,
`PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`,
`SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`,
`InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`,
`WorktreeRemove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`, `SessionEnd`.

A few are easy to misread. `FileChanged` uses `matcher` for **filenames**, not tool names (L129).
`WorktreeCreate` and `WorktreeRemove` replace default git behaviour (L130-131). `InstructionsLoaded` fires
both at session start and when a `CLAUDE.md` or `.claude/rules/*.md` loads lazily mid-session (L125), which
is the event a repository-map plugin would hang off.

### The shape of `hooks/hooks.json`

A top-level `hooks` object keyed by event name. Each event holds an array of **matcher groups**, and each
group holds an inner `hooks` array of **handlers** (L84-100). An optional top-level `description` string is
allowed alongside `hooks` (hooks.md L623, L629).

```json
{
  "description": "Automatic code formatting",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh", "args": [], "timeout": 30 }
        ]
      }
    ]
  }
}
```

The format is identical to the `hooks` object in `settings.json`, which is why migrating is a copy
([plugins.md, "Migrate hooks"](https://code.claude.com/docs/en/plugins.md)). Plugin hooks merge with user and
project hooks when the plugin is enabled (hooks.md L623).

Handler fields common to all five types (hooks.md L418-424): `type` (required), `if`, `timeout`,
`statusMessage`, `once`. `once` is honoured only in skill frontmatter and is ignored in settings files and
plugin manifests. `if` is evaluated only on the five tool events; on any other event **a handler with `if`
set never runs** (L421), which is a silent way to disable a hook.

Command handlers add `command` (required), `args`, `async`, `asyncRewake` and `shell` (L446-452). Presence of
`args` is what selects exec form over shell form (L458).

A plugin hook targeting the plugin's own bundled MCP server must use scoped names: matchers and `if` take
`mcp__plugin_<plugin-name>_<server-name>__<tool>`, and an `mcp_tool` hook's `server` field takes
`plugin:<plugin-name>:<server-name>`. "A matcher written against the bare server key never fires"
(plugins-reference.md L146).

### `timeout`

Seconds before the hook is cancelled (hooks.md L422). The defaults are per type and then adjusted per event:

| Type | Default | Event overrides |
|---|---|---|
| `command`, `http`, `mcp_tool` | **600 seconds** | `UserPromptSubmit` lowers it to 30; `MessageDisplay` to 10; `SessionEnd` hooks share a 1.5-second budget |
| `prompt` | 30 seconds | |
| `agent` | 60 seconds | |

The 600-second default is in the binary as `var eb=600000` (milliseconds), applied at
`D=e.timeout?e.timeout*1000:eb`. So `timeout` is read in seconds and multiplied by 1000, and the fallback is
600000 ms.

Two traps. First, a timed-out `command`, `http` or `mcp_tool` hook is cancelled, **its output is discarded,
and it renders no decision**; on `PreToolUse` the tool call proceeds through the normal permission flow. "Don't
count on a stalled hook to act as a gate" (L824-826). Second, on `SessionEnd`, a per-hook `timeout` raises the
shared budget only when it is set in a settings file: "Timeouts set on plugin-provided hooks don't raise the
budget" (L3028). A plugin cannot buy itself more time at session end.

### May a hook run a file outside its own plugin root?

**Yes.** This is the asymmetry in the contract, and it is worth stating plainly because section 2 says the
opposite about manifest paths.

Manifest path fields are validated and refuse `..`. A hook `command` is an opaque string handed to a shell,
or an executable name handed to `spawn`. Nothing validates where it points. A fixture with both an absolute
path outside the plugin and a `../../` in `args`:

```json
{"type":"command","command":"/usr/bin/env bash /etc/outside.sh"},
{"type":"command","command":"bash","args":["../../escape.sh"]}
```

```
✔ Validation passed
```

No error, no warning. The docs support this reading rather than contradicting it: `${CLAUDE_PROJECT_DIR}`
exists precisely so a hook can run a script in the user's project rather than in the plugin (hooks.md L585,
L600-618), which is by definition outside the plugin root. Handlers "run in the current directory with Claude
Code's environment" (L412).

The practical limit is not policy but packaging: a script bundled *with* the plugin has to be inside the
plugin, because only the plugin directory is copied to the cache. Reaching outside is permitted and will run
whatever is there on the user's machine.

### A hook whose `type` the loader does not know

**Rejected at validation, and the rejection takes the whole file with it.** `type` is a closed enum of
exactly five values: `"command"`, `"http"`, `"mcp_tool"`, `"prompt"`, `"agent"` (hooks.md L420, and
plugins-reference.md L138-144).

A fixture whose first handler used `"type": "telepathy"` and whose second was a valid `command` handler:

```
Validating hooks: .../hooks/hooks.json
✘ Found 1 error:
  ❯ hooks.PostToolUse.0.hooks.0.type: Invalid input
✘ Validation failed
```

The error path is precise down to the handler index. It is a schema rejection, not a skip: the valid sibling
handler in the same group does not rescue the file. Treat an unknown `type` as a load failure for the
plugin's hooks, not as a hook that quietly does nothing.

### The stdout contract

What a hook may write, from hooks.md L761-820.

**Exit 0.** Success, and the intended code when printing JSON for structured control. How stdout is read
depends on its **first non-whitespace character** (L771-774):

- starts with `{`: parsed as JSON; if it is not valid JSON, treated as plain text
- anything else: plain text, and this explicitly includes a JSON array or a quoted JSON string

For most events plain-text stdout goes to the debug log only. The three exceptions where stdout becomes
context Claude can see are `UserPromptSubmit`, `UserPromptExpansion` and `SessionStart` (L769).

Stderr on exit 0 goes to the debug log only, never the transcript, and Claude never sees it (L778).

**Exit 2.** A blocking error, and the only exit code that blocks through the code alone. It blocks whether or
not JSON is printed, and a JSON `permissionDecision` of `"allow"` cannot override it (L782). The blocking
message is the reason from the JSON when there is one, and stderr otherwise (L784). What the block does
varies by event: `PreToolUse` blocks the call, `UserPromptSubmit` rejects the prompt.

**Any other non-zero exit.** Does **not** block on its own, and this is the part that bites (L804-812,
L818-820):

- with a schema-valid JSON object, the exit code is **ignored entirely** and the JSON alone decides
- with a schema-invalid JSON object, a non-blocking error; the action proceeds
- with plain-text or empty stdout, a non-blocking error; the action proceeds and the transcript shows
  `Failed with non-blocking status code:` plus the first line of stderr

The documentation is explicit that exit 1, the conventional Unix failure code, is non-blocking: "If your hook
is meant to enforce a policy, use `exit 2`" (L819). The one exception is `WorktreeCreate`, where any non-zero
exit aborts creation.

A hook that cannot start at all lands in the same non-blocking bucket. A mistyped path gives exit 127 and the
same notice, which "leaves the gate silently disabled" (L816). Worth watching for on a policy hook's first run.

Claude Code reads JSON from stdout on **every** exit code, not only 0 (L763). Exit 2's block is the single
outcome JSON cannot override.

## 5. Multi-plugin repositories

### What the documentation actually says

Less than you would want. Three statements, and that is the whole of it.

1. **Publishing several plugins under one marketplace name means one `marketplace.json`.** "Each user can
   register only one marketplace per name [...] To publish multiple plugins under one marketplace name, list
   them all in a single `marketplace.json`" (plugin-marketplaces.md L161).
2. **Sharing files between plugins in one repository is a solved problem, and the solution is a symlink.**
   This is the closest the documentation comes to a code-sharing convention, and it is explicit
   (plugins-reference.md L817-831). A symlink whose target resolves elsewhere in the **same marketplace** is
   dereferenced and the content copied into the cache. The stated use case is "a meta-plugin's `skills/`
   directory link to skills defined by other plugins in the marketplace". Outside the marketplace, skipped.
   The example given is `ln -s ../../shared-plugin/skills/foo ./skills/foo`, and on Windows it needs
   `mklink /D` from an elevated prompt or Developer Mode.
3. **Several entries may share one `skills/` folder at the marketplace root**, with the replace-not-add
   consequence quoted in section 1 (plugin-marketplaces.md L628-635).

### What the documentation does not say

Stating this plainly rather than inferring it, as asked.

- **There is no documented convention for where each plugin's directory lives.** No rule, no
  recommendation, no example layout for a repository holding more than one plugin. The `metadata.pluginRoot`
  field (L186, L287-289) implies a shared parent directory is expected enough to deserve a shorthand, but the
  documentation never says to use one, and never names it.
- **There is no documented rule about whether plugins in one repository may share code.** The symlink
  mechanism above is documented as a file-sharing mechanism for skills; nothing addresses shared libraries,
  a shared `package.json`, or a shared `lib/`. Note that the Node dependency install is per-plugin-root: it
  runs only when "the plugin's root directory contains both a `package.json` and a supported lockfile"
  (L788), so a lockfile at the repository root is not seen by a plugin in a subdirectory.
- **There is no documented convention for versioning or releasing several plugins from one repository.** No
  guidance on whether to version them in lockstep or independently, no tagging scheme, nothing about
  releasing them together. The only versioning advice is per-plugin: follow semver and keep a `CHANGELOG.md`
  (L1320).

### What Anthropic's own multi-plugin repository does

Not documentation, and not binding, but it is a first-party artifact and it is the only concrete answer to
"where does each plugin's directory live". Read from the local clone at
`~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`.

286 plugin entries. Source forms:

| Form | Count |
|---|---|
| `url` object | 150 |
| `git-subdir` object | 83 |
| relative path string | 53 |

Of the 53 relative paths, **every one is nested**: 38 under `./plugins/`, 15 under `./external_plugins/`.
**Zero use `"./"`.** Anthropic does not put a plugin at its own marketplace root, even though the feature is
documented and supported.

Versions in that one marketplace are mixed freely. Only 14 of 286 entries carry a `version` in the
marketplace entry, and among the in-repo plugins' own manifests the values sit side by side without a common
scheme: `claude-security` 0.10.2, `security-guidance` 2.0.7, `code-simplifier` 1.0.0, `claude-code-setup`
1.0.0, and a large number with no `version` at all (`agent-sdk-dev`, `code-review`, `feature-dev`,
`plugin-dev`, `skill-creator` and others). Lockstep versioning is not what Anthropic does.

The marketplace also uses `renames`, and declares
`"$schema": "https://anthropic.com/claude-code/marketplace.schema.json"`.

## 6. Version and release

### What the loader does with `version`

It is the **cache key**. "Claude Code uses the plugin's version as the cache key that determines whether an
update is available. When you run `/plugin update` or auto-update fires, Claude Code computes the current
version and skips the update if it matches what's already installed" (plugins-reference.md L1300).

Resolution order, first one set wins, for every source type except `command` (L1302-1308):

1. `version` in the plugin's `plugin.json`
2. `version` in the plugin's marketplace entry
3. the git commit SHA of the plugin's source, for `github`, `url`, `git-subdir`, and relative-path sources in
   a git-hosted marketplace
4. the SHA-256 digest for `archive` sources, shortened to 12 characters
5. `unknown`, for `npm` sources and local directories not in a git repository

`command` sources ignore both `version` fields and always hash what the command produced, either a
12-character content hash alone or appended as `<version>-<hash>` (L1310).

### Is it semver-checked?

**No.** The schema describes it as "Semantic version (e.g., 1.2.3) following semver.org specification", and
the documentation advises semver, but nothing enforces it: "If you use explicit versions, follow semantic
versioning" (L1320) is advice, not a rule. The version behaves as an **opaque string** whose only job is
equality comparison against the installed one. Anthropic's own marketplace carries entries with no version at
all, which the resolution order handles by falling through to the commit SHA.

The consequence is the one that catches people: setting `version` **pins** the plugin. "Users get updates only
when you bump this field. Pushing new commits without bumping it has no effect, and `/plugin update` reports
"already at the latest version"" (L1316). Omitting `version` entirely gives commit-SHA versioning, where every
pushed commit is an update (L1317).

### Is it used for cache keying?

Yes, structurally, on disk. Each version is its own directory,
"grouped by marketplace and plugin and named for the resolved version" (L776). Verified locally:

```
~/.claude/plugins/cache/crisnahine/anatomiya/0.2.13/
~/.claude/plugins/cache/crisnahine/ultracode-anywhere/0.1.0/
```

`<cache>/<marketplace>/<plugin>/<version>/`. Two plugins from one marketplace occupy two independent trees.

The old version directory is not deleted at once. It is marked orphaned and swept roughly 14 days later, so
concurrent sessions that already loaded it keep running (L778). The sweep only runs while at least one plugin
is installed. Glob and Grep skip orphaned directories (L782).

### Does anything break if two plugins in one marketplace carry different versions?

**No.** Versions are per plugin, never per marketplace. Three independent confirmations:

- The cache path includes the plugin name **above** the version, so there is no shared version slot to
  collide over.
- `~/.claude/plugins/installed_plugins.json` records a separate `version`, `installedAt`,
  `lastUpdated` and `gitCommitSha` per plugin ID, and currently holds 15 plugins across 3 marketplaces at 15
  different versions.
- Anthropic's own marketplace ships 286 plugins with mixed and mostly absent versions, as counted in
  section 5.

The marketplace's own top-level `version` field is "Marketplace manifest version"
(plugin-marketplaces.md L185), the version of the catalog file, unrelated to any plugin's version.

One real coupling does exist, and it is not the version field. When two plugins share one source tree, they
share a **commit SHA**, so if both omit `version` they both re-version on every commit to the repository,
including commits that touched only the other plugin. Pinning `version` in each `plugin.json` is what
decouples them.

## What this repository does that the contract does not require

Read from this repository's own `.claude-plugin/marketplace.json`,
`plugins/anatomiya/.claude-plugin/plugin.json`,
`plugins/ultracode-anywhere/.claude-plugin/plugin.json` and `plugins/anatomiya/hooks/hooks.json`.

**Each plugin is a directory under `plugins/`, and neither is the repository.** `anatomiya` is
`"source": "./plugins/anatomiya"` and `ultracode-anywhere` is `"source": "./plugins/ultracode-anywhere"`.
That is what this section used to record the other way round, and the measurement is why it changed:
`anatomiya` was `"source": "./"`, which the contract permits (section 1) and Anthropic's own marketplace
never does, and what landed in the cache was verified on disk at
`~/.claude/plugins/cache/crisnahine/anatomiya/0.2.13/` as the entire repository, including `test/`
(72 entries), `docs/`, `scripts/`, `node_modules/`, `DECISIONS.md` at 246 KB, `CHANGELOG.md` at 124 KB, and
the sibling plugin itself, so a user who installed both held two copies of one of them. A source naming a
directory copies that directory, which is the fix and is now what each entry does.

**Both plugins pin an explicit `version`, at different values** (0.3.0 and 0.1.1), and the
marketplace itself has none: it publishes nothing, so a number there is one more thing to keep in
step and one more thing to mistake for a plugin's. Not required, and the
mixed values are fine (section 6). Because they share one commit SHA, pinning is what keeps a commit to one
plugin from re-versioning the other.

**Hooks use shell form with a quoted variable and a 5-second timeout.** `plugins/anatomiya/hooks/hooks.json`
runs `node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo` on three events and the same binary's `notice`
verb on `PreToolUse`, both with `"timeout": 5`. The quoting is what shell
form requires (section 3), so this is correct as written. Two things are worth knowing rather than fixing:
exec form with `args` is what the documentation prefers for any hook that references a path placeholder
(hooks.md L458, L596), and 5 seconds is a deliberate reduction from the 600-second default.

**`PostToolUse` and `PostToolUseFailure` use `"matcher": "*"`.** Not required; omitting `matcher` also matches
everything, as the `UserPromptSubmit` entry in the same file does.

**`PreToolUse` matches `"Write|Edit|NotebookEdit"`.** Read as a list of names rather than as a pattern:
measured on 2.1.250, a matcher holding only names and pipes takes a fast path that splits on `|` or `,`
and compares exact strings, and only a matcher carrying some other character is compiled as an unanchored
regular expression. The comparison is case sensitive, so `"write"` matches nothing.

**Components sit in `commands/`, not `skills/`.** The anatomiya plugin has `bin/`, `commands/` and `hooks/`
and no `skills/` directory. Both load, but the documentation calls `commands/` "Skills as flat Markdown
files" and says "Use `skills/` for new plugins" (plugins-reference.md L894).

**`bin/` is populated.** Its contents become bare commands on the Bash tool's `PATH` for every session where
the plugin is enabled (L903). Nothing in the manifest declares this and nothing warns about it.

**No lockfile sits at either plugin root**, so the automatic `npm ci --ignore-scripts` (L788-803) never runs
for either: the install is per-plugin-root, and this repository keeps its single lockfile at the marketplace
root because the plugins are npm workspaces. `/anatomiya:setup` is what installs the parser, which is what
the README has always said. Under the previous layout the plugin root was the repository root, the lockfile
was there, and the `node_modules/` seen in the cache directory above was that automatic install.

**Neither manifest declares a single component path field.** Both are pure metadata, which matches 59 of the
65 manifests surveyed in section 2.

## What could not be verified

**The first-party JSON schema does not resolve.** Anthropic's own marketplace declares
`"$schema": "https://anthropic.com/claude-code/marketplace.schema.json"`. Fetching it returns **HTTP 404**
(it redirects to `www.anthropic.com` and serves the marketing 404 page). The same is true of
`https://anthropic.com/claude-code/plugin.schema.json`. No Anthropic-hosted JSON schema for either manifest
could be retrieved. The only schema that resolves is
`https://json.schemastore.org/claude-code-plugin-manifest.json` (HTTP 200), used by 3 of the 65 installed
manifests, and SchemaStore is a third party, so it was not treated as authoritative here.

**No bundled schema or type file ships with the CLI.** `claude` is a single Mach-O executable
(`~/.local/share/claude/versions/2.1.241`, 325 MB, arm64). There is no package directory, no
`node_modules`, no `.d.ts`, no `.schema.json` alongside it. The schema quoted in this document was recovered
by running `strings` over that binary, which yields the minified loader source and the Zod schema
descriptions. That is a primary source, but it is a compiled artifact read indirectly, and identifier names
in it are minified (`_1e`, `eb`, `ymv`), so a future build can rename them.

**Whether `${CLAUDE_PLUGIN_ROOT}` is substituted in a `commands/*.md` file is inferred from the binary, not
stated in the docs.** The documented table lists only "Skill and agent content" (plugins-reference.md L687).
The binary shows one code path serving both, labelled `"Plugin skill" : "Plugin command"`. This was not
confirmed by executing a command file end to end.

**The runtime behaviour of an unknown hook `type` was tested through `claude plugin validate`, not through a
live session.** Validation rejects it with a precise error path. Whether the runtime loader skips only the
bad handler or refuses the whole file was not observed directly; the docs say a recognised field with a wrong
type makes "the plugin fails to load" (L485), which points the same way but is a statement about manifest
fields, not about `hooks.json`.

**The 30-event list is what the plugins reference publishes.** The reference calls it the same set as
user-defined hooks (L102). The hooks page documents each event in its own section, and those sections were
not enumerated one by one to confirm the count matches exactly. The WebFetch summary of the same reference
page claimed "and 20+ more" events, which the raw Markdown does not say; that summary was discarded.

**Nothing here was verified against Windows.** Several rules are platform-specific: exec form needs a real
executable and cannot spawn `.cmd` or `.bat` shims (hooks.md L465), shell form falls back to PowerShell when
Git Bash is absent (L462), and marketplace symlinks need `mklink /D` (plugins-reference.md L827). All testing
was on macOS (Darwin 25.5.0).

**Version-pinning behaviour was read, not exercised.** The claim that setting `version` stops users receiving
updates until it is bumped comes from L1316 and from the cache layout on disk. No update cycle was run to
watch `/plugin update` report "already at the latest version".
