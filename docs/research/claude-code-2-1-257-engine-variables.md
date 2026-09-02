# Two engine-shaped variables 2.1.257 added: what they do, and whether a trial keeps them

Research notes, September 2026. `test/ab.test.mjs` scans the installed Claude Code build for every
environment variable shaped like a model, an effort or a thinking budget, and fails on one
`scripts/ab/engine.mjs` has not ruled on. On build 2.1.257 it fails naming exactly two:
`CLAUDE_CODE_MODEL_CATALOG_URL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. This note is the ruling the
test is asking for.

Every claim below carries its source, in the three kinds the earlier note
(`docs/research/one-model-one-effort.md`) uses:

- **read**: a string or a function recovered from the installed build, with its byte offset
- **run**: a command and its output on this machine, today
- **doc**: a first-party page, quoted, with its URL

The build read against is **Claude Code 2.1.257**, the file
`/Users/crisn/.local/share/claude/versions/2.1.257`, 199,011,264 bytes (`claude --version` prints
`2.1.257 (Claude Code)`). Three older builds are still installed and are used below to date each
variable: 2.1.250, 2.1.251 and 2.1.252. Anything read out of those files is one build's spelling,
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
is no longer only compared and logged. In `primary` mode the build says in its own words that "the
served list replaces the compiled picker for this session", and the fetched rows are installed as the
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

It is declared as a boolean, next to the rest of the engine variables. **read**, offset 156,950,163,
the schema module, trimmed to the two declarations that matter:

```js
CLAUDE_CODE_SUBAGENT_MODEL:()=>IR,CLAUDE_CODE_SUBAGENT_MODEL_FORCE:()=>UR,
...
IR=I.str(),UR=I.bool()
```

The model it forces to is read by one helper. **read**, offset 163,180,000:

```js
function fV(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL;return e&&e!=="inherit"?e:"inherit"}
```

Five sites read the flag, and they cover every way a child gets a model.

The subagent and teammate resolvers drop the requested model outright. **read**, offsets 176,280,792
and 176,281,221:

```js
function re(n,e){if(a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)n=void 0;if(n==="inherit")return F(e);...}
function H(n,e,o="tool"){if(a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)n=void 0;let i=re(n,e),_=fV(),...}
```

`n` is the requested model, from the Agent tool call or the agent definition. Setting it to `void 0`
sends the resolver down the `fV()` path instead.

The inherit cap is dropped with it. **read**, offset 163,180,103:

```js
function nbn(e,n){let r=typeof e==="object",o=r?e.inheritCap:e;
  if(!a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)return[o,n];
  return[r&&fV()==="inherit"?o:void 0,n==="inherit"?"inherit":void 0]}
```

The Agent tool's own schema loses the parameter. **read**, offset 163,905,249:

```js
Lfn=m(()=>{let e=jAo().omit({cwd:!0}),n=Ll()||tV()?e.omit({run_in_background:!0}):e;
  return a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE?n.omit({model:!0}):n})
```

Workflow agents are handled separately and log the refusal. **read**, offset 172,610,689:

```js
if(I?.model!==void 0&&a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)
  t(`Workflow agent model "${I.model}" ignored: CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set`),I.model=void 0;
```

Two prompt strings change with it, which matters because they are text the trial's own model reads.
**read**, offset 163,899,051, inside the Agent tool description:

```js
in its definition (\`.claude/agents/*.md\` frontmatter, or the SDK \`agents\` option)${
  a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE?"":"; the `model` parameter here overrides the definition for this one call"}.
```

and **read**, offset 160,049,245, in the coordinator prompt:

```js
f=a.CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL||a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE
  ?"- The model parameter is ignored on this session. Do not set it."
  :"- Omit the model parameter so workers i..."
```

The workflow-authoring reference is built from it too (**read**, offset 176,085,774,
`function ain(){let e=a.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;return\`# Workflow authoring reference...`).

The build treats the name as model configuration in three of its own lists, which is a second opinion
worth recording. **read**, offset 157,440,143, the set stripped out of a settings `env` block next to
`model`, `fallbackModel` and `modelPicker`:

```js
var Tg=new Set([...,"CLAUDE_CODE_AUTO_MODE_MODEL","CLAUDE_CODE_BG_CLASSIFIER_MODEL",
  "CLAUDE_CONTEXT_COLLAPSE_MODEL","CLAUDE_CODE_SUBAGENT_MODEL_FORCE"]);
```

It also sits in the provider-env allowlist for persisted jobs (**read**, offset 160,453,006,
`d9t=new Set(["CLAUDE_CODE_SUBAGENT_MODEL_FORCE"])`, kept only when truthy) and in the list of names
forwarded to a spawned child process (**read**, offset 176,279,857, immediately after
`"CLAUDE_CODE_SUBAGENT_MODEL"`). That last one is the reason a scrub is worth anything: the parent's
value reaches the child.

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
model variable gone and the force flag left in place, `fV()` returns `"inherit"` and children would
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

It is a string, declared beside `CLAUDE_CODE_MODEL_CATALOG`. **read**, offset 156,950,163:

```js
CLAUDE_CODE_MODEL_CATALOG:()=>fR,CLAUDE_CODE_MODEL_CATALOG_URL:()=>KR,
...
fR=I.str(),KR=I.str()
```

It names the catalog document to fetch. **read**, offset 169,962,646:

```js
function Ap(w=Pp()){return w.url??kb(a.CLAUDE_CODE_MODEL_CATALOG_URL)}
function Tp(){let w=Ap();if(w===void 0)return!1;try{return Wl(new URL(w))==="file"}catch{return!1}}
function kb(w){let T=w?.trim();return T?T:void 0}
function Gi(){let w=Pp(),T=Ap(w)??wp,I;try{I=new URL(T)}catch{
  return t("[publishedCatalog] configured catalog URL is not a URL; published path off"),{ok:!1,reason:"invalid_url"}}
  ...}
```

`Pp()` is the managed-policy source, which is refused unless it comes from an admin policy origin.
The environment variable is the fallback under it, and `wp` is the default when neither is set:
**read**, `var wp="https://downloads.claude.ai/model-catalog/v1/catalog.json"`. A `file:` URL is an
accepted scheme on the environment path (`Tp()` above tests for exactly that, with no policy-origin
check), so the variable can also point the catalog at a local file.

The document is signature-checked, so an arbitrary URL cannot inject arbitrary rows. **read**, offset
169,969,000 area:

```js
function wb(w,T){if(w==="hosted"||T.publicKey===void 0)return{kind:"compiled_roots",roots:Li};
  if(T.url===void 0)return t("[publishedCatalog] a managed catalog public key is set but no managed catalog URL is; the env-named URL verifies against the compiled roots only"),{kind:"compiled_roots",roots:Li};...}
```

The env-named URL verifies against the compiled trust roots. That is a security property, not a
determinism one. A signed document served from a different URL, an older signed document, or a pinned
`file:` copy all pass and all can differ from what the default URL serves right now.

### What the build does with the fetched catalog

This is the half the ruling turns on. On 2.1.257 the rows are applied, not merely logged.

**read**, offset 169,977,036, the end of the published-catalog primary path:

```js
if(MEn(Ee,ue?.fetchedAt),Pe==="seed")g("model_catalog_published","seed",O);
else if(I)g("model_catalog_published","remote_settings_unconfirmed");else y("model_catalog_published");
t(`[publishedCatalog] primary: using ${Pe} rows (${uS(Ee).length} rows via ${we})`)
```

and, next to it, the served-catalog path, which states the effect in the build's own words
(**read**, offset 169,991,289):

```js
LEn(oe,O?.fetchedAt),y("model_catalog_primary"),
t(`[servedCatalog] primary: using served rows (${uS(oe).length} rows via ${z}, fetched ${...}s ago); the served list replaces the compiled picker for this session`)
```

Both installers write into the same slot. **read**, same chunk:

```js
function LEn(e,n){YD({catalog:e,source:e===null?"fallback":"served",fetchedAt:n})}
function MEn(e,n){YD({catalog:e,source:e===null?"fallback":"published",fetchedAt:n})}
function YD(e){let n=ho();if(n.servedCatalogActive=e,n.servedCatalogDeactivatedRows=void 0,
  n.familySpellingVerdicts.clear(),e.catalog!==null)jJ(qK(e.catalog))}
```

`servedCatalogActive` is what every catalog lookup reads:

```js
function vR(){let e=ho();if(e.servedCatalogSuppressDepth>0)return null;
  let n=e.servedCatalogActive?.catalog??null;if(n!==null&&!mp())return null;return n}
function $x(e){let n=vR();return n===null?void 0:aJe(n)[e]}
function Yx(e){let n=vR();if(n===null)return!1;let r=Zu(e);return vme(n).some((o)=>Zu(o.id)===r)}
```

`$x` is a row lookup keyed by model id, and `Yx` answers whether an id is in the live catalog at all.
The rows are the same shape as the baked-in ones the earlier note recorded: `id`, `family`,
`context:{window,native_1m,...}`, `max_output_tokens`, `capabilities`, `default_effort`. So the
catalog decides which ids exist, which family each belongs to, and what window and output cap each
carries. That is what "a trial pinned to one id could be served by a different one" means in practice:
the pin is a string, and the catalog is what the string resolves against.

Setting the variable at all also changes an availability answer before any fetch. **read**, offset
158,482,777, inside the per-model enabled check:

```js
if(zK())return d();
if(Ap()){if(iL(pJe,r))return!1;if(!rL())return d()}
return o(NP().flatMap(...))
```

`Ap()` here is the same accessor as above, so its only input on a machine with no admin policy is the
environment variable. A trial that exports it takes a different branch than one that does not,
whatever the network did.

### Was it in 2.1.251?

No, and neither was the applying behaviour. **run**, per build:

| Build | `CLAUDE_CODE_MODEL_CATALOG_URL` | `CLAUDE_CODE_MODEL_CATALOG` | `primary: using ` | `replaces the compiled picker` |
|---|---|---|---|---|
| 2.1.250 | 0 | 0 | 0 | 0 |
| 2.1.251 | 0 | 3 | 0 | 0 |
| 2.1.252 | 0 | 3 | 0 | 0 |
| 2.1.257 | 4 | 3 | 4 | 6 |

Two facts in one table. The URL variable is new in 2.1.257, and so is the whole published-and-applied
path. On 2.1.251, the build the current `KEPT` row was read against, there was no `primary: using`
line and no "replaces the compiled picker" line anywhere in the bundle.

### Recommendation: OVERRIDES

Add to `OVERRIDES`. The reasoning is one step longer than the subagent one, so it is worth stating
whole:

1. The variable names the catalog document a session fetches.
2. In `primary` mode the fetched rows replace the compiled model list for that session.
3. Every model lookup, including "does this id exist" and "what window does it have", reads that list.
4. So two arms pointed at two documents can resolve the same pinned id to different rows, and one arm
   with the variable set takes a different availability branch than one without, even offline.

The gate chain means this often does nothing: the mode comes from a remote flag (`tengu_delegated_quail`),
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

The read was redone. 2.1.257 applies it. The consumer is `YD`/`vR` above, and the build says
"the served list replaces the compiled picker for this session" in a log line that does not exist in
2.1.251 or 2.1.252. The condition the comment named has fired.

That makes `CLAUDE_CODE_MODEL_CATALOG` an off switch for a mechanism that now changes model
resolution. Two arms disagreeing on it disagree on whether the compiled catalog or a fetched one is in
force. It belongs in `OVERRIDES` alongside the URL, and the pair should move together: scrubbing the
URL while keeping the switch leaves the default URL live, which is the same mechanism with one less
knob.

The gate itself is unchanged in shape. **read**, offset 70,357,000 area:

```js
function ss({skipEssentialTrafficGate:w=!1}={}){if(mo(a.CLAUDE_CODE_MODEL_CATALOG))return"env_off";
  if(fo())return"bare";if(!w&&vt())return"essential_traffic";if(a.ANTHROPIC_UNIX_SOCKET)return"unix_socket";
  if(!mp())return"not_first_party";if(!wt())return"not_claude_ai_auth";if(Op()===null)return"no_org";
  let T=Lp();if(T.accountUuid===null)return T.reason;if(!Ft("allow_model_catalog"))return"policy";return null}
function Fr(){if(ss()!==null)return"off";return Lr()}
function Bb(w){...switch(w.mode){case"shadow":return"shadow";case"primary":return"primary";default:return"off"}}
```

`mo()` is the falsey-string helper, so `0`, `false`, `no` and `off` all mean off, exactly as the
existing comment says. What changed is not the gate. It is what happens past it.

### Engine-shaped names the regex does not catch

Worth a ruling from the harness author, because the scan cannot raise them. These sit in the same
schema module as the two new variables and clearly bear on model selection, but none contains
`MODEL`, `EFFORT` or `THINKING`, so the test is blind to them. **read**, offset 156,950,163, the same
export block:

- `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`,
  `CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS`
- `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP`
- `CLAUDE_CODE_3P_PROBE_WROTE_OPUS_DEFAULT`, `CLAUDE_CODE_3P_PROBE_WROTE_SONNET_DEFAULT`
- `CLAUDE_CONTEXT_COLLAPSE`
- `CLAUDE_CODE_ORGANIZATION_UUID`, read by `Op()` in the catalog gate above

**run**: every one of these has the same match count in 2.1.252 and 2.1.257, so none is new and none
of them is why the test started failing. They are listed here as candidates, not as a claim that any
of them moves an engine. Ruling on them means either widening the regex, which the existing comment
already warns costs false positives such as `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION`, or reading each
one the way the two above were read. `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` looks the most likely
to matter, since the Explore subagent's model cap is exactly the kind of thing that decides what a
child runs on, and `nbn` above shows the cap and the force flag interacting.

## What could not be established

- **Whether `tengu_delegated_quail` is on for this account.** The mode comes from a remote flag. Nothing
  here reads it, and no trial was run with catalog logging on to see which mode it lands in. The ruling
  above deliberately does not depend on the answer: a scrub costs nothing when the mode is `off`, and
  the flag can flip between two batches without anything local changing.
- **What a published catalog row actually replaces at request time.** `$x` and `Yx` are read as the
  lookups, and the build's own log line says the list replaces the compiled picker. Whether a row can
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

Every bundle read is a fixed-string offset lookup followed by a windowed read, which is the recipe the
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

- `/Users/crisn/.local/share/claude/versions/2.1.257`, 199,011,264 bytes. Every offset cited above is
  into this file and is meaningless against any other build.
- `/Users/crisn/.local/share/claude/versions/2.1.252`, 197,220,928 bytes, and `2.1.251`,
  197,171,680 bytes, and `2.1.250`, 206,479,552 bytes, read only for per-name match counts.

This repository:

- `scripts/ab/engine.mjs`, which holds `OVERRIDES`, `FAMILIES` and `PINS`
- `test/ab.test.mjs`, which holds `KEPT` and the scan this note answers
- `docs/research/one-model-one-effort.md`, the earlier note, read against 2.1.250
- `DECISIONS.md` row G11, the decision both files implement
