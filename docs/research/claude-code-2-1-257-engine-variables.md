# Two engine-shaped variables 2.1.257 added: what they do, and whether a trial keeps them

Research notes, September 2026. `test/ab.test.mjs` scans the installed Claude Code build for every
environment variable shaped like a model, an effort or a thinking budget, and fails on one
`scripts/ab/engine.mjs` has not ruled on. On build 2.1.257 it fails naming exactly two:
`CLAUDE_CODE_MODEL_CATALOG_URL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. This note is the ruling the
test is asking for.

Every claim below carries its source, in the three kinds the earlier note
(`docs/research/one-model-one-effort.md`) uses:

- **read**: behaviour read from the installed build, described here rather than quoted
- **run**: a command and its output on this machine, today
- **doc**: a first-party page, quoted, with its URL

The build read against is **Claude Code 2.1.257**, the file
`<home>/.local/share/claude/versions/2.1.257`, 199,011,264 bytes (`claude --version` prints
`2.1.257 (Claude Code)`). Three older builds are still installed and are used below to date each
variable: 2.1.250, 2.1.251 and 2.1.252. Anything read out of those files is one build's behaviour,
not a promise.

## Summary

Both variables go in `OVERRIDES`. Neither is a keep.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is a boolean. When it is set, the build throws away the model a
subagent, teammate or workflow agent was spawned with and runs it on `CLAUDE_CODE_SUBAGENT_MODEL`, or
on the parent's model when that is unset. It also removes the `model` parameter from the Agent tool's
schema and rewrites two prompt strings. It plainly decides which model serves a child of a trial, and
it changes the tool surface the trial's own model sees, so two arms measured on machines that differ
on it are not comparable.

`CLAUDE_CODE_MODEL_CATALOG_URL` is a string: the URL of the signed model-catalog document the session
fetches, default `https://downloads.claude.ai/model-catalog/v1/catalog.json`. On 2.1.257 the catalog
is no longer only compared and logged. In primary mode the build logs that the served list
replaces the compiled model picker for the session, and the fetched rows are installed as the
live catalog that every model-row lookup reads. Rows carry the id, the family, the context window and
the output cap. A trial pinned to `claude-opus-5[1m]` can therefore be served under a different row
than another trial, and merely having the variable set changes a model-availability answer before any
fetch happens. Scrub it.

The same read makes the existing `KEPT` entry for `CLAUDE_CODE_MODEL_CATALOG` stale. That row was
written against 2.1.251 and says the catalog is "compared and logged, never applied", with a note that
it goes stale "if a later build ever applies the catalog rather than logging it". 2.1.257 is that
build. Section 3 has the evidence.

Neither new variable touches effort. Both touch which model answers.

## 1. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`

### The documentation

**doc**, [Claude Code environment variables](https://code.claude.com/docs/en/env-vars), the row for
the variable, verbatim:

> `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` | Set to `1` to force one model onto subagents, teammates, and
> workflow agents. [Choose a model](/docs/en/sub-agents#choose-a-model) says which model that is.
> Requires Claude Code v2.1.257 or later

**doc**, [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), under "Choose a model":

> Set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` to run subagents, teammates, and workflow agents on
> `CLAUDE_CODE_SUBAGENT_MODEL` whatever model their definition or invocation names, the built-in
> Explore and Plan definitions included. A fork, and a skill that runs in a subagent with
> `model: inherit`, still run on the main conversation's model. When you haven't set
> `CLAUDE_CODE_SUBAGENT_MODEL`, subagents, teammates, and workflow agents run on the main
> conversation's model, and the built-in Explore subagent keeps its model cap.

The `CLAUDE_CODE_SUBAGENT_MODEL` row is updated to match: "Two sources take precedence over it: a
model Claude passes when it spawns the agent, and a `model` field in the agent's definition, including
`inherit`. To change that, set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`."

### What the build does

It is declared as a boolean, next to the rest of the engine variables, in the module that declares
every environment variable the build reads. `CLAUDE_CODE_SUBAGENT_MODEL` beside it is a string.

**read**: the model it forces to comes from one helper, which returns `CLAUDE_CODE_SUBAGENT_MODEL`
when it is set to anything but `inherit`, and `inherit` otherwise.

Five sites read the flag, and they cover every way a child gets a model.

**read**: the subagent and teammate model resolvers both start by discarding the requested model,
the one from the Agent tool call or the agent definition, when the flag is set. With no requested
model, the resolver falls through to the forced-model helper above.

**read**: the inherit cap is dropped with it. The code that pairs an agent's inherit cap with its
requested model returns both unchanged when the flag is off. When it is on, it keeps the cap only if
the forced-model helper answers `inherit`, and keeps the requested model only if that was `inherit`.

**read**: the Agent tool's own input schema loses the `model` parameter when the flag is set.

**read**: workflow agents are handled separately. A workflow agent that names a model has the model
cleared, and the build logs that the model was ignored because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is
set.

Two prompt strings change with it, which matters because they are text the trial's own model reads.

**read**: the Agent tool description, where it says a model can be set in the agent's definition,
adds a clause that the call's `model` parameter overrides the definition for that one call. With the
flag set, the clause is left out.

**read**: the coordinator prompt normally tells the model to omit the model parameter for workers.
With the flag set, or with `CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL` set, it says instead
that the model parameter is ignored in this session and must not be set.

**read**: the workflow-authoring reference is built from the flag too.

The build treats the name as model configuration in three of its own lists, which is a second opinion
worth recording. **read**: it is in the set of names stripped out of a settings `env` block next to
`model`, `fallbackModel` and `modelPicker`, beside `CLAUDE_CODE_AUTO_MODE_MODEL`,
`CLAUDE_CODE_BG_CLASSIFIER_MODEL` and `CLAUDE_CONTEXT_COLLAPSE_MODEL`.

It also sits in the provider-env allowlist for persisted jobs (**read**, as the only name in that
list, kept only when truthy) and in the list of names forwarded to a spawned child process (**read**,
immediately after `CLAUDE_CODE_SUBAGENT_MODEL`). That last one is the reason a scrub is worth
anything: the parent's value reaches the child.

### Was it in 2.1.251?

No. **run**, counting fixed-string matches per build:

| Build | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` |
|---|---|
| 2.1.250 | 0 |
| 2.1.251 | 0 |
| 2.1.252 | 0 |
| 2.1.257 | 16 |

The doc row agrees: "Requires Claude Code v2.1.257 or later." The harness was last calibrated against
2.1.251, so this is new since then and nothing in `engine.mjs` could have anticipated it.

### Recommendation: OVERRIDES

Add to `OVERRIDES` in `scripts/ab/engine.mjs`. The test is whether the variable can change which model
or effort serves a trial or a subagent a trial spawns, and this one is the plainest possible yes: it
exists to override a child's model.

Scrubbing it is still needed even though `CLAUDE_CODE_SUBAGENT_MODEL` is already scrubbed. With the
model variable gone and the force flag left in place, the forced-model helper answers `inherit` and children would
inherit the pinned model, which sounds harmless. It is not: the flag independently removes `model`
from the Agent tool schema and rewrites the tool description and the coordinator prompt. Two arms, one
on a machine that exports it and one that does not, would hand their models different tools and
different instructions. That is a second variable inside a one-variable experiment.

## 2. `CLAUDE_CODE_MODEL_CATALOG_URL`

### The documentation

Undocumented. **run**, fetched today: `https://code.claude.com/docs/en/env-vars.md` (479,462 bytes)
and `https://code.claude.com/docs/en/model-config.md` (103,869 bytes) contain zero occurrences of
`MODEL_CATALOG`. Neither `CLAUDE_CODE_MODEL_CATALOG_URL` nor `CLAUDE_CODE_MODEL_CATALOG` appears on
either page. The build is the only source for what follows.

### What the build does

It is a string, declared beside `CLAUDE_CODE_MODEL_CATALOG` in the same module.

**read**: it names the catalog document to fetch. The catalog URL accessor answers the managed-policy
source first, which is refused unless it comes from an admin policy origin. The environment variable,
trimmed, is the fallback under it, and the default URL above is used when neither is set. A URL that
does not parse turns the published path off, with a log line saying so.

A `file:` URL is an accepted scheme on the environment path. A separate check tests for exactly that
scheme, with no policy-origin check, so the variable can also point the catalog at a local file.

**read**: the document is signature-checked, so an arbitrary URL cannot inject arbitrary rows. Unless
a managed catalog public key and a managed catalog URL are both set, the document verifies against
the trust roots compiled into the build. A managed key with no managed URL logs that the env-named URL
verifies against the compiled roots only.

The env-named URL verifies against the compiled trust roots. That is a security property, not a
determinism one. A signed document served from a different URL, an older signed document, or a pinned
`file:` copy all pass and all can differ from what the default URL serves right now.

### What the build does with the fetched catalog

This is the half the ruling turns on. On 2.1.257 the rows are applied, not merely logged.

**read**: at the end of the published-catalog primary path, the build installs the fetched rows,
records a `model_catalog_published` event, and logs how many rows it is using in primary mode. Next
to it, the served-catalog path does the same with served rows and states the effect in its log line:
the served list replaces the compiled picker for the session.

**read**: both installers write into the same slot. Each records the catalog, its source (served,
published, or a fallback when the catalog is null) and its fetch time as the active served catalog,
clears the cached family-spelling verdicts, and, when the catalog is not null, loads its rows.

**read**: that active catalog is what every catalog lookup reads. The lookup returns nothing while a
suppress counter is raised or when the provider is not first party, and otherwise returns the active
catalog. Two functions sit on it: a row lookup keyed by model id, and a check of whether an id is in
the live catalog at all.

The rows are the same shape as the baked-in ones the earlier note recorded: the model id, its family,
its context window (including whether the window is a native 1M one), its output token cap, its
capabilities and its default effort. So the
catalog decides which ids exist, which family each belongs to, and what window and output cap each
carries. That is what "a trial pinned to one id could be served by a different one" means in practice:
the pin is a string, and the catalog is what the string resolves against.

Setting the variable at all also changes an availability answer before any fetch. **read**: inside
the per-model enabled check, a branch runs only when the catalog URL accessor above returns a value,
and it can answer that the model is not enabled, or return early, before the normal list check runs.

The accessor's only input on a machine with no admin policy is the
environment variable. A trial that exports it takes a different branch than one that does not,
whatever the network did.

### Was it in 2.1.251?

No, and neither was the applying behaviour. **run**, per build:

| Build | `CLAUDE_CODE_MODEL_CATALOG_URL` | `CLAUDE_CODE_MODEL_CATALOG` | the primary-mode log line | the replaces-the-picker log line |
|---|---|---|---|---|
| 2.1.250 | 0 | 0 | 0 | 0 |
| 2.1.251 | 0 | 3 | 0 | 0 |
| 2.1.252 | 0 | 3 | 0 | 0 |
| 2.1.257 | 4 | 3 | 4 | 6 |

Two facts in one table. The URL variable is new in 2.1.257, and so is the whole published-and-applied
path. On 2.1.251, the build the current `KEPT` row was read against, there was no primary-mode log line
and no replaces-the-picker log line anywhere in the bundle.

### Recommendation: OVERRIDES

Add to `OVERRIDES`. The reasoning is one step longer than the subagent one, so it is worth stating
whole:

1. The variable names the catalog document a session fetches.
2. In `primary` mode the fetched rows replace the compiled model list for that session.
3. Every model lookup, including "does this id exist" and "what window does it have", reads that list.
4. So two arms pointed at two documents can resolve the same pinned id to different rows, and one arm
   with the variable set takes a different availability branch than one without, even offline.

The gate chain means this often does nothing: the mode comes from a remote feature flag,
the org has to be entitled, and `CLAUDE_CODE_MODEL_CATALOG` can switch the whole thing off. But "often
does nothing" is not the bar. The bar is whether any value of the variable can make two arms run
different engines, and here it can, silently, with the flag flip happening server-side between two
batches measured a week apart.

## 3. What else the scan found

### The whole diff, so nothing is being ruled on in isolation

**run**, the test's own regex applied to two builds:

```sh
grep -oaE '\b(ANTHROPIC|CLAUDE|CLAUDE_CODE|MAX|DISABLE|FALLBACK)_[A-Z0-9_]*(MODEL|EFFORT|THINKING)[A-Z0-9_]*\b' <build> | sort -u
```

2.1.252 yields 45 distinct names, 2.1.257 yields 47, and the diff is exactly the two names above.
Nothing else engine-shaped appeared, disappeared or was respelled between those builds. The other 45
are already covered by `OVERRIDES`, `FAMILIES` or `KEPT`, which is why the test names only these two.

### The `CLAUDE_CODE_MODEL_CATALOG` keep is stale on this build

This is the finding that needs a ruling beyond the two the test named. The `KEPT` entry in
`test/ab.test.mjs` reads:

> `"an off switch for a catalog that is compared and logged, never applied"`

with a comment that ends: "if a later build ever applies the catalog rather than logging it, this row
goes stale with nothing here to notice, and the read to redo is the consumer of that mode."

The read was redone. 2.1.257 applies it. The consumer is the catalog installer and lookup above, and the build says
the served list replaces the compiled picker for the session in a log line that does not exist in
2.1.251 or 2.1.252. The condition the comment named has fired.

That makes `CLAUDE_CODE_MODEL_CATALOG` an off switch for a mechanism that now changes model
resolution. Two arms disagreeing on it disagree on whether the compiled catalog or a fetched one is in
force. It belongs in `OVERRIDES` alongside the URL, and the pair should move together: scrubbing the
URL while keeping the switch leaves the default URL live, which is the same mechanism with one less
knob.

The gate itself is unchanged in shape. **read**: the gate turns the catalog off when
`CLAUDE_CODE_MODEL_CATALOG` holds a false value, in bare mode, when only essential traffic is
allowed, when `ANTHROPIC_UNIX_SOCKET` is set, when the provider is not first party, when the auth is
not claude.ai, when there is no organization or account, and when policy does not allow the model
catalog. Past the gate the mode is read from the remote flag and is shadow, primary or off.

A false value is any of `0`, `false`, `no` and `off`, exactly as the
existing comment says. What changed is not the gate. It is what happens past it.

### Engine-shaped names the regex does not catch

Worth a ruling from the harness author, because the scan cannot raise them. These sit in the same
schema module as the two new variables and clearly bear on model selection, but none contains
`MODEL`, `EFFORT` or `THINKING`, so the test is blind to them. **read**, the same
module that declares them:

- `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`,
  `CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS`
- `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP`
- `CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT`, `CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT`
- `CLAUDE_CONTEXT_COLLAPSE`
- `CLAUDE_CODE_ORGANIZATION_UUID`, read by the organization check in the catalog gate above

**run**: every one of these has the same match count in 2.1.252 and 2.1.257, so none is new and none
of them is why the test started failing. They are listed here as candidates, not as a claim that any
of them moves an engine. Ruling on them means either widening the regex, which the existing comment
already warns costs false positives such as `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`, or reading each
one the way the two above were read. `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` looks the most likely
to matter, since the Explore subagent's model cap is exactly the kind of thing that decides what a
child runs on, and the inherit-cap code above shows the cap and the force flag interacting.

## What could not be established

- **Whether the remote catalog flag is on for this account.** The mode comes from a remote flag. Nothing
  here reads it, and no trial was run with catalog logging on to see which mode it lands in. The ruling
  above deliberately does not depend on the answer: a scrub costs nothing when the mode is `off`, and
  the flag can flip between two batches without anything local changing.
- **What a published catalog row actually replaces at request time.** The row lookup and the id check are
  read as the lookups, and the build's own log line says the list replaces the compiled picker. Whether a row can
  change the wire model id for an already-pinned id, as opposed to only the window, the cap and whether
  the id is offered at all, was not traced end to end. It does not change the ruling, because "the id is
  not offered" already routes into the substitution path that `CLAUDE_CODE_NO_MODEL_FALLBACK` exists to
  refuse.
- **`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` observed on a real spawn.** The five sites are read from the
  build and cross-checked against two doc pages that agree with them. No subagent was spawned with the
  flag set to watch a child's `modelUsage`, for the same reason the earlier note gives: the local
  stand-in cannot make the model emit an Agent tool call.
- **Whether a scrub reaches a child at all.** `engineEnv` cleans the environment the trial process is
  started with. Both new names appear in the build's own child-process forwarding list, so a value the
  trial does not hold cannot be forwarded. A value arriving from a settings file is a different route,
  and `conflictingSettings` already refuses on any name `overridesEngine` matches, so adding these two
  to `OVERRIDES` extends that refusal for free.

## Reproducing this

Every bundle read is a fixed-string lookup followed by a windowed read, which is the recipe the
earlier note gives. The file is 199 MB, so nothing reads it whole:

```sh
CLI=~/.local/share/claude/versions/2.1.257
grep -oab 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE' "$CLI"          # offsets
dd if="$CLI" bs=1 skip=$((OFFSET-110)) count=250 2>/dev/null # the code around one
```

A wide `.{n}` context pattern also works and is slower:

```sh
grep -oa '.\{600\}CLAUDE_CODE_MODEL_CATALOG_URL.\{600\}' "$CLI"
```

The per-build counts in the tables are `grep -oac '<name>' <build>` over the four installed versions.
The 45-versus-47 diff is the test's own regex piped through `sort -u` on 2.1.252 and 2.1.257 and
`diff`ed.

The documentation checks are `curl -sL https://code.claude.com/docs/en/env-vars.md` and the same for
`model-config.md` and `sub-agents.md`, then `grep` for `CATALOG`, `SUBAGENT` and `EFFORT`. The `.md`
suffix is what serves the source rather than the rendered page.

## Sources

First-party documentation:

- [Anthropic, Claude Code environment variables](https://code.claude.com/docs/en/env-vars)
- [Anthropic, Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Anthropic, Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Anthropic, Claude Code settings](https://code.claude.com/docs/en/settings)

The installed builds:

- `<home>/.local/share/claude/versions/2.1.257`, 199,011,264 bytes. Every **read** above is from
  this file and may not hold for any other build.
- `<home>/.local/share/claude/versions/2.1.252`, 197,220,928 bytes, and `2.1.251`,
  197,171,680 bytes, and `2.1.250`, 206,479,552 bytes, read only for per-name match counts.

This repository:

- `scripts/ab/engine.mjs`, which holds `OVERRIDES`, `FAMILIES` and `PINS`
- `test/ab.test.mjs`, which holds `KEPT` and the scan this note answers
- `docs/research/one-model-one-effort.md`, the earlier note, read against 2.1.250
- `DECISIONS.md` row G11, the decision both files implement
