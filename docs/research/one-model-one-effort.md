# Pinning one model and one effort: what the string is, and what actually decides it

Research notes, August 2026. This repository runs headless `claude` trials to measure what a map does
to generated code, and it names a model in more than one place. The question here is what exact pair
to pin, and what else has to be held still so that a run measures the map rather than the machine it
ran on.

Every claim below carries its source. Three kinds appear:

- **read**: behaviour read from the installed Claude Code build, described here rather than quoted
- **run**: a command and its output on this machine, today
- **doc**: a first-party page, quoted, with its URL

The build read and run against is **Claude Code 2.1.250**, the file
`<home>/.local/share/claude/versions/2.1.250`, 206,479,552 bytes (`claude --version` prints
`2.1.250 (Claude Code)`; `ls -la ~/.local/share/claude/versions/` gives the size). Anything read out
of that file is one build's behaviour, not a promise.

## Summary

The pair to pin is `claude-opus-5[1m]` for the model and `medium` for the effort, and pinning both is
not optional if a measurement is meant to repeat. This note backs decision G11, which pins the pair for
the measurement harness, and decision A43, which stops the `ultracode-anywhere` reminder asking for a
second effort on some workflow stages.

`claude-opus-5[1m]` is a real, accepted string in this build. It is not a model id on the wire: Claude
Code strips the `[1m]` before the request and adds the `context-1m-2025-08-07` beta header instead.
The wire model is `claude-opus-5` either way (**run**, below). The suffix is a Claude Code convention,
not an API one, and the API docs never mention it.

`medium` is one of five levels the CLI accepts, and it is the only part of the pair that a machine can
silently change under you. The resolver reads an environment variable first, then the CLI flag, then
settings, then the model's own default of `high`. On this machine, `claude -p ... --model claude-opus-5`
with no effort flag resolves to `xhigh`, not `high`, because `~/.claude/settings.json` carries a
per-model entry (**run**, p11). A harness that passes `--model` and not `--effort` is measuring two
variables.

Neither half is a contract that will hold for years. The model id is safe for about a year (Opus 5
retires "not sooner than July 24, 2027", **doc**). The `[1m]` suffix, the `effortLevel` and
`modelSettings` settings keys, and the precedence order are Claude Code behaviour: some documented,
one (`modelSettings`) not documented at all and gated on a remote flag. Pin a default in one place and
let a flag override it.

## 1. The model id

### `claude-opus-5` is the API id, and its window is already 1M

**doc**, [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview), the
comparison table row for Claude Opus 5:

| Row | Value |
|---|---|
| Claude API ID | `claude-opus-5` |
| Claude API alias | `claude-opus-5` |
| Default effort | `high` |
| Context window | 1M tokens |
| Max output | 128K tokens |
| Reliable knowledge cutoff | May 2026 |
| Retirement | Not sooner than July 24, 2027 |

The same page says "Every Claude model ID is a pinned snapshot, including the dateless IDs used from
the 4.6 generation on." So `claude-opus-5` is already a pin; there is no dated form to prefer.

### The build carries the same numbers, plus a capability list

**read** from the build's hand-maintained model catalog, the entry for Opus 5 gives the family as
opus, the knowledge cutoff as May 2026, `claude-opus-4-8` as the fallback on third-party providers, a
1M window that is native to the model and also reachable through the 1M beta and the `[1m]` suffix,
64000 output tokens by default with an upper bound of 128000, and a default effort of `high`. Its
capability list includes effort, `max` effort, `xhigh` effort, adaptive thinking and fast mode. It also
carries a per-level effort cost index.

Two things worth keeping. The catalog marks the 1M window as the model's own, not something the
suffix buys on the first-party API. And the cost index puts `medium` at 0.76 of `high`, `low` at 0.67,
`xhigh` at 1.6 and `max` at 1.7, which is the build's own estimate of what a level costs.

### The full list of model ids this build accepts

**read** from the build: 17 full model ids, from `claude-3-5-haiku` through the 4.x Opus, Sonnet and
Haiku ids to the 5 generation (`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`,
`claude-mythos-5`). Next to that list sit the aliases: `sonnet`, `opus`, `haiku`, `fable`, `best`,
`opusplan`, and `sonnet[1m]`, `opus[1m]` and `fable[1m]`.

The catalog and the aliases sit in the same part of the build as the `[1m]` helpers. The alias table
maps `opus` to `claude-opus-5` on first party, Bedrock and Vertex, and to `claude-opus-4-6` on Foundry,
which is why an alias is not a pin: it moves per provider and per release.

### `[1m]` is real, and it is a suffix, not an id

**read** from the build, two string helpers decide it. One strips a trailing `[1m]` from a model
string, ignoring case. The other strips every `[1m]` or `[2m]` anywhere in it.

The window lookup, also **read**, works like this. A model string carrying `[1m]` gets a 1M local
window, unless `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set. So does one whose request already carries the
`context-1m-2025-08-07` beta, and so does a model with a native 1M window on a provider that serves it.
The lookup's last fallback is a default of 200000.

That `claude-opus-5[1m]` is a string the build knows by name is settled by **read**: the router that
picks a refusal fallback compares the model against `claude-opus-5` and `claude-opus-5[1m]` as two
exact strings.

### What the suffix does on the wire

**run**. The recipe is the one already written down in
`plugins/ultracode-anywhere/VERIFYING.md` step 4: a local HTTP stand-in on `127.0.0.1` answers
`/v1/messages` itself, so nothing leaves the machine and no tokens are spent. It was extended to log
request headers as well as bodies.

`claude -p ping --model 'claude-opus-5[1m]' --effort medium --strict-mcp-config --no-session-persistence`
produced one `/v1/messages?beta=true` request:

```
anthropic-beta: claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,
  thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,
  mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24,fallback-credit-2026-06-01
model: claude-opus-5
output_config: {"effort":"medium"}
max_tokens: 64000
thinking: {"type":"adaptive","display":"omitted"}
```

The suffix never reaches the API. The docs say the same in the third-party pinning section: "Claude
Code strips the suffix before sending the model ID to your provider"
([Model configuration](https://code.claude.com/docs/en/model-config)).

### Where `[1m]` is accepted, measured

Each row is one headless run against the stand-in, with `CLAUDE_CONFIG_DIR` pointed at a directory
holding `{}` unless the row says otherwise.

| # | invocation | wire model | `output_config` | `context-1m` beta |
|---|---|---|---|---|
| p1 | `--model claude-opus-5` | `claude-opus-5` | `{"effort":"high"}` | no |
| p3 | `--model 'claude-opus-5[1m]'` | `claude-opus-5` | `{"effort":"high"}` | yes |
| p4 | `--model 'opus[1m]' --effort medium` | `claude-opus-5` | `{"effort":"medium"}` | yes |
| p19 | settings `{"model":"claude-opus-5[1m]","effortLevel":"medium"}` | `claude-opus-5` | `{"effort":"medium"}` | yes |
| p20 | `ANTHROPIC_MODEL='claude-opus-5[1m]' --effort medium` | `claude-opus-5` | `{"effort":"medium"}` | yes |
| p22 | as p19, plus `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` | `claude-opus-5` | `{"effort":"medium"}` | no |
| p18 | `--model claude-opus-9` (via an agent definition) | `claude-opus-9` | `{"effort":"high"}` | no |

So the suffix is accepted by the `--model` flag, by the settings `model` key, by `ANTHROPIC_MODEL`, and
by an agent definition's `model` field. It is refused nowhere. `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` turns
it off, which matches the window lookup above.

p18 also settles what happens to an id the build does not know: it is passed through to the API
unchanged, with a diagnostic on stderr, not refused:

```
"claude-opus-9" is not a model this version of Claude Code recognizes, so auto-compact will keep this
session within 200k tokens (the context window it assumes). If the model accepts more, append [1m] to
the model name for 1M; ...
```

The docs agree: the recognition check "doesn't cover the `--model` flag, the `ANTHROPIC_MODEL`
environment variable, or the `model` setting; a mistyped value there produces ... on the first request
instead" ([Model configuration](https://code.claude.com/docs/en/model-config)).

### Where `[1m]` is not accepted

The Agent tool's `model` parameter takes family aliases only. **read** from the build, the parameter
is an optional choice of `sonnet`, `opus`, `haiku` or `fable`. Its description says it overrides the
agent definition's `model` frontmatter, falls back to that frontmatter or to the parent's model when
omitted, and is ignored for a fork.

There is no way to write `claude-opus-5[1m]` in an Agent tool call. A subagent reaches that string only
through its definition's frontmatter, through `CLAUDE_CODE_SUBAGENT_MODEL`, or by inheriting it from
the parent.

### Whether the suffix is worth carrying at all

On the first-party API it changes nothing about which model answers and nothing about the window the
API allows: Opus 5 is natively 1M ("On the Anthropic API, Fable 5, Sonnet 5, and Opus 4.7 and later
always run with the 1M window", [Model configuration](https://code.claude.com/docs/en/model-config)).
The build reaches the same 1M through the native-window branch of the window lookup above, without
the suffix, when the base URL is first-party.

It earns its place in two other places. Behind a gateway or a custom `ANTHROPIC_BASE_URL`, Claude Code
cannot confirm the window, and the suffix is what selects it: "when `ANTHROPIC_BASE_URL` points at a
gateway, Claude Code can't verify 1M support. To use the full window, select Sonnet 5 (1M context) in
the model picker, which maps to `sonnet[1m]`." And on Pro-tier accounts, Opus at 1M is a plan question
("On Max, Team, and Enterprise plans ... Opus is automatically upgraded to 1M context with no
additional configuration"; on Pro it "Requires usage credits"), so the suffix states the intent rather
than inheriting whatever the tier gives. Same page.

Carrying it costs one beta header and nothing else, measured. It states the window the trial expects
instead of inheriting it from the plan and the base URL.

## 2. Effort

### The CLI accepts five levels, plus two words that are not levels

**run**, `claude --help`:

```
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
```

**read** from the build: the level list is exactly those five, in that order. `--effort` also takes
two strings that are not in that list. The flag parser maps `med` to `medium` and `ultracode` to
`xhigh`, after trimming and lowercasing. Anything else it cannot place produces a warning that names
the five valid values, and the run goes on at the default effort.

Confirmed by **run**:

| invocation | `output_config` on the wire | stderr |
|---|---|---|
| `--effort medium` | `{"effort":"medium"}` | none |
| `--effort med` | `{"effort":"medium"}` | none |
| `--effort ultracode` | `{"effort":"xhigh"}` | none |
| `--effort max` | `{"effort":"max"}` | none |
| `--effort banana` | `{"effort":"high"}` | `Warning: Unknown --effort value 'banana' ... Valid values: low, medium, high, xhigh, max.` |

The last row matters for a harness: a typo does not fail the run, it silently uses the model default.

### `/effort` accepts seven words

**run**, in print mode, which the command supports:

```
$ claude -p "/effort"        -> Usage: /effort <low|medium|high|xhigh|max|ultracode|auto>
$ claude -p "/effort medium" -> Set effort level to medium (this session only): Balanced approach ...
$ claude -p "/effort auto"   -> Effort level set to auto (this session only)
$ claude -p "/effort banana" -> Invalid argument: banana. Valid options are: low, medium, high, xhigh, max, ultracode, auto
```

**read** from the build, the hint is built from the levels the organisation allows for the current
model, so a capped account sees a shorter list.

### The settings key is `effortLevel`, and it refuses `max`

**read** from the build, the settings reader takes the `--effort` value first if there is one. Failing
that, `ultracode: true` in settings gives `xhigh`. Failing that, it takes `effortLevel`, but only when
it is `low`, `medium`, `high` or `xhigh`. Any other value, `max` included, is dropped.

**doc** agrees: "**Settings**: set `effortLevel` to `low`, `medium`, `high`, or `xhigh` in your settings
file. `max` isn't accepted here, and `ultracode` has its own `ultracode` key"
([Model configuration](https://code.claude.com/docs/en/model-config)).

There is a second, undocumented settings key. **read** from the build: when a remote feature flag is
on and settings do not set `ultracode: true`, the settings reader also builds a per-model table from
`modelSettings`, taking each entry's `effortLevel`.

`modelSettings` is a per-model effort table, gated on that remote flag, absent from the settings
reference. It works on this machine: **run** p6, with settings
`{"modelSettings":{"claude-opus-5":{"effortLevel":"xhigh"}}}` and no `--effort`, sent
`{"effort":"xhigh"}`. **read** from the build, the table's keys are canonicalised with the `[1m]`
stripped, so one entry covers both spellings of the model.

### The resolver

Earlier notes in this repository name the resolver and a sibling gate by their 2.1.241 minified
names. In 2.1.250 both functions carry different names. **read** from the build, the gate returns true
only when its flag argument is true, a second check passes, and the resolver answers `xhigh`. That is
the same shape the `GATE` regex in `plugins/ultracode-anywhere/hooks/upstream.mjs` matches, so that
check still passes on this build.

The resolver itself, **read** from the build, takes a model and an effort:

1. Returns nothing at all when the model has no `effort` capability. The check reads the catalog's
   capability list, with a hard list of older ids that never have it.
2. Otherwise the value is the first of: `CLAUDE_CODE_EFFORT_LEVEL` (set to `unset` or `auto`, it makes
   the resolver return nothing unless a launch pin applies), then the model's own `default_effort` if the model is under a launch pin, then the effort
   passed in, then the model's `default_effort`, which is `high` when the catalog has none.
3. Then it clamps. A level is first lowered to the organisation's cap for this model, if there is one.
   `max` drops to `high` on a model without the `max` effort capability. `xhigh` drops to `high` on a
   model without the `xhigh` capability.

Answers to the four questions asked of the resolver:

- **Which models clamp.** Any model whose catalog capabilities lack `xhigh` or `max` effort.
  Measured: `--model claude-sonnet-4-6 --effort xhigh` sent `{"effort":"high"}` (**run**, p14), which is
  what the catalog predicts, since Sonnet 4.6's entry lists effort and `max` effort but not `xhigh`. **doc**
  states the rule: "If you set a level the active model does not support, Claude Code falls back to the
  highest supported level at or below the one you set. For example, `xhigh` runs as `high` on Opus 4.6."
- **Is `medium` valid.** Yes, on every model that supports effort. It is never lowered by a capability
  check, since only `max` and `xhigh` have a step-down branch. It can still be lowered by an
  organisation cap set below it. On a model with no effort capability it is not clamped, it is dropped:
  `--model claude-haiku-4-5 --effort medium` sent no `output_config` at all (**run**, p15).
- **Can a model id force an effort regardless of the flag.** Yes, for three ids. The launch pin holds
  Opus 4.7, Opus 4.8 and Fable 5 at their own `default_effort`, ahead of the effort passed in, until the
  pin is released, each by its own setting. Passing `--effort` releases it: the build clears the pin
  whenever the CLI parses a level. **doc**:
  "When you first run Fable 5, Opus 4.8, or Opus 4.7, Claude Code applies that model's default effort
  even if you previously set a different level for another model, and holds it across sessions until you
  make an explicit effort choice ... Opus 5 has no such hold: a level you previously set carries over."
  Opus 5 is not in the launch pin's list, so the pin does not apply to the pair being chosen here.
- **Does `[1m]` change the resolution.** No. `--model claude-opus-5` and `--model 'claude-opus-5[1m]'`
  with no effort flag both resolved to `high` (**run**, p1 and p3); both with `--effort medium` resolved
  to `medium` (**run**, p2 and the header capture above).

### One more input the resolver takes: a number

The parser behind both `--effort` and `CLAUDE_CODE_EFFORT_LEVEL` accepts an integer as well as a level
name (**read** from the build). The agent-file loader says so out loud: its warning for a bad `effort`
value lists the five levels and adds that an integer is also valid (**read**). Numeric effort is not
documented and was not exercised here.

## 3. Headless runs

### What settles the effort when no flag is passed

The order, read off the settings reader and the resolver above and confirmed by running each rung:

| rung | source | measured |
|---|---|---|
| 1 | `CLAUDE_CODE_EFFORT_LEVEL` | p8: `CLAUDE_CODE_EFFORT_LEVEL=low --effort medium` sent `{"effort":"low"}` |
| 2 | `--effort` on the CLI | p2: `--effort medium` with empty settings sent `{"effort":"medium"}` |
| 3 | settings `ultracode: true` | p7: `{"ultracode":true}` plus `--effort medium` sent `{"effort":"medium"}`, so the flag wins over it |
| 4 | settings `modelSettings.<model>.effortLevel` | p6: sent `{"effort":"xhigh"}` with no flag |
| 5 | settings `effortLevel` | p5: sent `{"effort":"medium"}` with no flag |
| 6 | the model's catalog `default_effort` | p1: sent `{"effort":"high"}` with empty settings and no flag |

**doc** states rungs 1, 2 and 6 the same way: "The environment variable takes precedence over all other
methods, then your configured level, then the model default"
([Model configuration](https://code.claude.com/docs/en/model-config)).

There is no hard default in the sense of a constant in the CLI. The default is the model's own
`default_effort` from the catalog, which for `claude-opus-5` is `high`.

### The uncontrolled variable, measured on this machine

**run**, p11, with no `CLAUDE_CONFIG_DIR` override so the real `~/.claude/settings.json` applies:

```
claude -p ping --model claude-opus-5 --strict-mcp-config --no-session-persistence
  -> model=claude-opus-5 output_config={"effort":"xhigh"}
```

The same command with an empty settings directory resolves to `high` (p1). The difference comes from
two keys in this account's user settings:

```json
"effortLevel": "medium",
"modelSettings": { "claude-fable-5": {"effortLevel":"xhigh"}, "claude-opus-5": {"effortLevel":"xhigh"} }
```

So `--model claude-opus-5` alone is not a stated engine. It is `high` on a fresh machine, `xhigh` here,
and whatever a contributor's own settings say elsewhere. Two arms measured on two machines, or on one
machine before and after someone runs `/effort`, are not comparable.

### The variables to name

**read** from the build's own list of environment variables, these concern model and effort:
`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`,
`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, and the `_NAME`, `_DESCRIPTION` and
`_SUPPORTED_CAPABILITIES` variant of each, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_CUSTOM_MODEL_OPTION`
(and its `_NAME`, `_DESCRIPTION` and `_SUPPORTED_CAPABILITIES`), `CLAUDE_CODE_SUBAGENT_MODEL`,
`CLAUDE_CODE_AUTO_MODE_MODEL`, `CLAUDE_CODE_BG_CLASSIFIER_MODEL`, `CLAUDE_CONTEXT_COLLAPSE_MODEL`,
`CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`,
`CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT`, `CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT`,
`CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP`, `CLAUDE_CODE_NO_MODEL_FALLBACK` and
`FALLBACK_FOR_ALL_PRIMARY_MODELS`.

Three more reach the same two decisions without the word MODEL or EFFORT in the name, and a scrubber
built on that shape will miss all three:

- `CLAUDE_CODE_DISABLE_1M_CONTEXT` drops the `context-1m` beta and holds the session to a 200K local
  window (**run**, p22, and **read**, the window lookup above).
- `ANTHROPIC_BETAS` can add `context-1m-2025-08-07` by hand: **read** from the build, it splits that
  variable on commas and checks the trimmed entries for the 1M beta.
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` change when a trial compacts,
  which changes what the model saw.

`CLAUDE_CONFIG_DIR` decides which settings file is read at all, and so decides rungs 3 to 5 above.

## 4. Subagents and workflows

### The child's model

**read** from the build, the subagent model resolver, with a telemetry twin naming each rung, takes
the first of these. `CLAUDE_CODE_SUBAGENT_MODEL`, unless it is `inherit`. Then the Agent tool call's
`model` argument, where `inherit` means the parent's model. Then the agent definition's frontmatter
model. Then the parent's model, which is also the default when nothing is set. The telemetry labels
the rung `env`, `tool`, `frontmatter` or `inherit`, in that order. **doc** repeats it as a four-step
list on [Subagents](https://code.claude.com/docs/en/sub-agents), and the env var's own row says it
"overrides the per-invocation `model` parameter and the subagent definition's `model` frontmatter. Set
to `inherit` to use normal model resolution instead."

One step in that resolver is worth knowing before pinning anything. **read** from the build: when a
subagent's model is an Opus that supports the 1M beta, the string has no `[1m]` yet, and the session
is first-party with 1M available, Claude Code appends `[1m]` itself. A subagent asking for `opus` gets
`opus[1m]`.

### When the child asks for a model the account cannot use

**read** from the build: when a subagent's model is not in the `availableModels` allowlist, the build
logs a warning and either uses the newest allowed model in the same family or inherits the parent's
model. For an agent that owns the whole session, the warning says the session model is kept.

So a blocked family alias steps down to the newest permitted version of that family; any other blocked
value falls back to the inherited model. The request is not failed. **doc**
([Model configuration](https://code.claude.com/docs/en/model-config), Restrict model selection) says the
same and lists every surface the allowlist covers, the Agent tool's `model` parameter and
`CLAUDE_CODE_SUBAGENT_MODEL` included.

Note this is the allowlist, not the account's entitlements. An unrecognised id is not caught here at
all: it goes to the API (**run**, p18).

### The child's effort

A subagent inherits the session effort. Two things can override it.

An agent definition can carry an `effort` field. **read** from the build, the agent-file loader parses
it with the same parser as `--effort`, and warns when the value is neither one of the five levels nor
an integer.

**doc**, [Subagents](https://code.claude.com/docs/en/sub-agents): "`effort` ... Effort level when this
subagent is active. Overrides the session effort level. Default: inherits from session. Options: `low`,
`medium`, `high`, `xhigh`, `max`; available levels depend on the model."

A workflow stage can carry `opts.effort`. **read** from the Workflow tool's own script-API text in the
build: `opts.effort` overrides the reasoning effort for that one agent call and takes the five levels;
leaving it out inherits the session effort. The text steers cheap mechanical stages to `low` and keeps
the higher levels for the hardest verify or judge stages.

The same passage tells the model to leave `opts.model` out by default, since the agent then inherits
the resolved session model, which it calls almost always right.

**doc** puts frontmatter effort in the precedence chain: "Frontmatter effort applies when that skill or
subagent is active, overriding the session level but not the environment variable"
([Model configuration](https://code.claude.com/docs/en/model-config)).

One caveat that follows from section 2 rather than from any doc: a child running a different model
resolves its effort through the same per-model settings table, so a `modelSettings` entry for that model
can give a child a different level than the parent even when nothing overrides anything.

## 5. Longevity

Sorted by how long each part can be trusted.

**Contract, safe to hard-code.** The model id `claude-opus-5` is a pinned snapshot with a published
retirement floor of July 24, 2027. The five effort level names, and `output_config.effort` as the API
shape, are documented API surface: "The effort parameter is available on all supported models with no
beta header required"
([Effort](https://platform.claude.com/docs/en/build-with-claude/effort)). `high` as Opus 5's API default
is documented on two pages.

**Documented Claude Code behaviour, stable across a release line but not a promise.** The `--effort`
flag and its five values; the `--model` flag; `effortLevel` in settings with `max` refused; the
precedence order env var, then configured level, then model default; `CLAUDE_CODE_EFFORT_LEVEL` and
`CLAUDE_CODE_SUBAGENT_MODEL`; the `[1m]` suffix on aliases and full names, and the fact that it is
stripped before the request. All of these are on
[Model configuration](https://code.claude.com/docs/en/model-config) and
[CLI reference](https://code.claude.com/docs/en/cli-reference), which also carry a running list of
version-gated changes ("Passing `ultracode` to the `--effort` flag ... requires Claude Code v2.1.203 or
later"; "Opus 5 requires Claude Code v2.1.219 or later"; "Before v2.1.223, Claude Code held only Sonnet
5, Opus 4.8, and Opus 5 sessions to 200K"). Those notes are the evidence that this layer moves.

**One build's snapshot, not to be relied on.** The minified names of the resolver, its gate and their
helpers: every one of them differed between 2.1.241 and 2.1.250. The baked catalog is hand-maintained
per release and is also refreshed from the API's model list at runtime, with a handler for a failed
fetch (**read**), so the cost index, `default_effort` and the capability list can change without a
Claude Code release. `modelSettings` is undocumented and gated on a remote flag Anthropic sets.
Numeric effort values are undocumented.

The practical reading: pin `{ model: "claude-opus-5[1m]", effort: "medium" }` as one named default in
one file, keep `--model` and `--effort` overrides, refuse an effort that is not one of the five before
spending a batch to find out, and re-run the probes in this note against a new build rather than
assuming.

## What this means for this repository

The working tree already carries the change this note was commissioned to check
(`scripts/ab/engine.mjs`, added; `scripts/ab/run.mjs`, `scripts/ab.mjs`,
`scripts/measure-defaults.mjs`, modified). Against the facts above:

- `ENGINE = { model: "claude-opus-5[1m]", effort: "medium" }` is a valid pair. Both halves are accepted
  and both reach the request, one as a beta header and one as `output_config.effort`.
- `EFFORT_LEVELS = ["low","medium","high","xhigh","max"]` matches the build's level list, `claude --help`,
  and the docs, in that order.
- Refusing an unrecognised level in `engineFor` before the batch runs is worth the code: the CLI
  answers a typo with a warning on stderr and the model default, so without the check a run would
  record an effort nothing honoured.
- Passing `--effort` explicitly is what closes the p11 hole: the CLI flag beats both `effortLevel` and
  `modelSettings`, measured.
- `engineEnv` scrubbed two regexes when this note was first written, which covered rung 1 and the alias
  variables and missed the thinking and context families. It now carries the names read off this
  build, plus one shape for the `ANTHROPIC_DEFAULT_<alias>_MODEL` family. The names were widened on the
  evidence in this note: a shape wide enough for `MAX_THINKING_TOKENS` also takes
  `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`, which a Bedrock run needs.
- A settings file still outranks the flag, and no environment scrub reaches it. `settings.env` lands on
  rung 1, so a user, project or local settings file naming `CLAUDE_CODE_EFFORT_LEVEL` decides the trial.
  `--setting-sources ''` looks like the answer and is not: measured on 2.1.250, an arm holding
  `.claude/rules/` with a `paths` frontmatter answered `7` with the sources loaded and `NONE` without,
  so excluding them removes the map the experiment exists to install. The answer this repository took
  instead is decision G11, in two halves. A run refuses to start when a settings `env` entry names
  one of those names, and on nothing else: rung 1 is the only one above the flags a trial passes, and
  the table above measures `--effort` beating rungs 3, 4 and 5. And both settings files are taken out
  of each arm, which leaves the rules directory where it is.
- `plugins/ultracode-anywhere/hooks/standing-ultracode.mjs` now tells the model to leave `opts.effort`
  alone, which is decision A43. That is consistent with the build: omitting `opts.effort` inherits the session effort, which is
  exactly the pinned level. The one thing it does not reach is the subagent resolver step that appends `[1m]` to an Opus
  subagent's model on its own, so a child may run at 1M whether or not anything asked for it.
- `plugins/ultracode-anywhere/hooks/upstream.mjs` names `CALIBRATED_AGAINST = "2.1.241"`. The installed
  build is 2.1.250, nine patches on, one short of the `PATCHES_BEFORE_STALE` floor of 10. The gate it
  looks for is still there under a new minified name, and the `GATE` regex accepts it.

### What `modelUsage` reports back (run)

`claude -p "..." --model 'claude-opus-5[1m]' --effort medium --output-format json`, on 2.1.250, this
machine, today:

```json
"modelUsage": {
  "claude-opus-5[1m]": {
    "inputTokens": 2, "outputTokens": 4,
    "contextWindow": 1000000, "maxOutputTokens": 64000,
    "canonicalModel": "claude-opus-5", "provider": "firstParty", "costBasis": "list"
  }
}
```

Two things settle here. The key is the spelling that was asked for, suffix and all, with the canonical
id beside it as a field, so a lookup by the asked id finds it. And `contextWindow` is the only place
the long window is visible at all: the suffix never reaches the wire. A trial that hits its turn cap
also lists a second, smaller model for its own housekeeping, which is why the lookup is by name rather
than by size.

## What could not be established

- **Whether a future build might key `modelUsage` by the canonical id instead.** One sample says it
  keys by the asked spelling. `answerIn` falls back to the busiest model by output tokens if the
  lookup misses, so a build that changed this would record a model rather than nothing, but it would
  be the wrong one on a trial that wrote little.
- **Whether the `context-1m-2025-08-07` beta changes anything for Opus 5 on the first-party API.** The
  header goes out (measured), and Opus 5 is natively 1M (documented), so the header is at best
  redundant there. Nothing was found that says the API treats a native-1M model differently with the
  beta present. This would need a real request to the real API, which these probes deliberately avoided.
- **What `[2m]` is.** One of the build's string helpers strips `[2m]` as well as `[1m]`, so the build knows a second suffix. No `[2m]` model
  string, catalog field or doc mention was found. Read as dead code or as forward-looking; not verified.
- **Numeric effort.** The effort parser accepts an integer and the agent-loader warning advertises it. No probe was
  run with one, and no documentation covers it. The scale, the clamping and whether it reaches
  `output_config` are all unknown.
- **A real Agent-tool subagent's request.** The subagent model and effort resolution in section 4 is read
  from the build and cross-checked against the docs. It was not captured on the wire, because the local
  stand-in cannot make the model emit an Agent tool call. The one child-shaped thing measured is
  `--agent`, which sets the session's own model: p16 showed an agent definition with
  `model: "claude-opus-5[1m]"` producing the 1M beta, and its `effort: "medium"` not reaching the main
  loop, which is consistent with frontmatter effort applying to a spawned agent rather than to a session
  started under `--agent`, but is not proof of it.
- **Whether the remote flag behind `modelSettings` is on for anyone else.** `modelSettings` worked here. It is a remote
  flag; another account or another day may not have it. Treat a `modelSettings` entry as something that
  may or may not apply, never as a control.
- **Organisation effort caps.** The resolver clamps to `maxEffortLevel` from a per-model org list. This account
  has no cap, so the clamp branch was never exercised. Documented behaviour only.
- **Third-party providers.** Every probe ran against a first-party-shaped base URL. Bedrock, Vertex,
  Foundry and gateway behaviour for both `[1m]` and effort is read from the catalog's `native_1m_3p`
  fields and the docs, not measured.

## Reproducing this

The wire capture is the recipe already in `plugins/ultracode-anywhere/VERIFYING.md` step 4, with the
stand-in extended to record `req.headers` next to the body. Each probe is one line:

```sh
CLAUDE_CONFIG_DIR=<a dir holding one settings.json> \
ANTHROPIC_BASE_URL=http://127.0.0.1:<port> ANTHROPIC_API_KEY=stand-in \
  claude -p ping --strict-mcp-config --no-session-persistence --model <m> --effort <e> < /dev/null
```

then read `model`, `output_config` and the `anthropic-beta` header off the captured `/v1/messages` body.
Nothing leaves the machine and no tokens are spent.

The bundle reads use `plugins/ultracode-anywhere/hooks/upstream.mjs` to find the build (`cliPath()`),
then a chunked scan: the file is 206 MB, so a fixed-string `grep -a -b -o` plus a windowed read around
the offset is the cheap way, and a wide `.{n}` context pattern is refused by the stock macOS `grep` and
takes minutes on any other.

## Sources

First-party documentation:

- [Anthropic, Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic, Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Anthropic, Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Anthropic, Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Anthropic, Claude Code settings reference](https://code.claude.com/docs/en/settings-reference)
- [Anthropic, Claude Code subagents](https://code.claude.com/docs/en/sub-agents)

The installed build:

- `<home>/.local/share/claude/versions/2.1.250`, 206,479,552 bytes. What is read from it above is
  described, not quoted, and holds for that one build.

This repository:

- `plugins/ultracode-anywhere/hooks/upstream.mjs` (`cliPath`, `GATE`, `CALIBRATED_AGAINST`, `MIN_BUNDLE`),
  `plugins/ultracode-anywhere/VERIFYING.md` (the wire-capture recipe this note reuses),
  `scripts/ab/engine.mjs`, `scripts/ab/run.mjs`, `scripts/measure-defaults.mjs`.

## Addendum, 2026-09-22

`plugins/ultracode-anywhere/` was removed from this repository. The build reader this note
cites (`cliPath`, `MIN_BUNDLE`, `settingsFor`) lives at `scripts/claude-build.mjs` now; the
paths above are where it sat when the measurements were taken.
