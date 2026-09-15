# One Stop-hook reason that makes an agent find the existing function

Research notes, September 2026. A Stop hook can block the end of a turn once and hand the model a
`reason`. The question here is what that reason should say so that Claude (claude-opus-5 on Claude
Code 2.1.272) checks every function its change adds for an existing function in the repository that
does the same job, reuses it, and does not miss one. It also covers what no wording can do. Every claim
below is traced to the source that owns it: the vendor's page, the shipped build, or the paper. Each
carries an evidence label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product
- **folklore**: widely reported by practitioners, not yet measured

Build strings are quoted from `/Users/crisn/.local/share/claude/versions/2.1.272` (210,702,192
bytes), read as latin1 with byte offsets into that file. The build writes its dashes as the escape
`\u2014`, and the quotes below keep the escape as written. Their presence is **measured** locally. What
they mean is **vendor claim**, because Anthropic publishes no page for them.

The starting point, measured in this session at n=1 per case (local data, not proof): the current
reason, "Before you finish, check what this change adds (<files>). For every function it adds, search
the repository for an existing one that does the same job, even under another name or written
differently. If one exists, call it and delete the new one. If none does, finish without changing
anything.", removed an exact copy and a behaviour-equal rewrite on a 2-file fixture and left a new
function alone. On a clone of this repository (281 files, about 1471 top-level functions) it replaced
a rewrite of `extOf` with `extOf` plus `tally` and left a new `editDistance` alone. With no hook the
copies stayed. Every case had a well-named target and one duplicate per change, so the miss rate on
hard cases is unknown.

## Summary

The reason reaches the model as a meta user message whose text is `Stop hook feedback:` then a newline
then the reason (build, below). Nothing wraps it in instructions of its own, so the reason is the
whole prompt for that pass.

Anthropic ships wording for exactly this check, and it is not a Stop-hook sentence. The built-in
`/simplify` and `/code-review` prompts carry a "Reuse" angle: "Flag new code that re-implements
something the codebase already has", "Grep shared/utility modules and files adjacent to the change",
"and name the existing helper to call instead". `/simplify` hands that angle to a separate agent with
the diff, then applies the fixes in the main session. The shipped design has two parts: a named search
scope, and a reader that did not write the code (vendor claim).

The sources on the three levers in the session's draft:

- **Enumerate every item.** Measured work backs decomposition into per-item checks: Chain-of-Verification
  roughly doubled precision on list answers and TICK's checklists raised agreement and generation
  scores. None of it is on code reuse. The same literature says a long list degrades: compliance odds
  drop about 5.6% per generated function in Claude Code sessions, and instruction-following falls with
  density. So the list is better supplied by the hook than recalled by the model.
- **Search by behaviour, not only by name.** Duplicates that agents actually leave are semantic (Type-4)
  clones, measured at 1.87 times the human rate in agent pull requests. Type-4 is also the class GPT-3.5
  and GPT-4 detect worst even when shown both functions. A name search cannot find them. Whether a
  "search by key calls and return value" instruction closes that gap has no measurement.
- **Written evidence per item.** Vendor guidance favours showing evidence over asserting success. The
  cost is also first-party: Anthropic says verification instructions cause over-verification on
  Opus 5.

The strongest measured lever is the one the draft leaves out: an independent checker. Intrinsic
self-correction without external feedback lowered GPT-4's scores on all three benchmarks Huang et al.
tested. Self-critique collapsed on formal tasks where a sound external verifier gained. CoVe's variants
that cannot see the draft beat the one that can. Anthropic's Fable 5 page says fresh-context verifier
subagents "tend to outperform self-critique". The Opus 5 page says the opposite for verification
subagents in general. That conflict is unresolved and has to be measured, not argued.

The ceiling: no source reports a prompt that reaches zero misses on any detection task. The model's
own ability to judge two functions as the same is the upper bound, and it is weakest on the hard cases
this hook exists for. A reason can raise recall. It cannot certify it.

Measured locally on four hard cases in this repository (below): candidate C, which hands the search to one fresh-context subagent, passed 24 of 24 with no miss and no wrong merge. Every inline wording, Anthropic's shipped Reuse sentence included, passed 9 or 10 of 12. C costs about 1.8 times as much per run, and it still spawns a subagent on a change with no code.

## How the reason is delivered

**The docs.** The hooks reference, Stop decision control: "`reason` | Required when `decision` is
`"block"`. Tells Claude why it should continue". On loops: "The `stop_hook_active` field is `true` when
Claude Code is already continuing as a result of a stop hook. Check this value or process the
transcript to avoid blocking on a condition that will never resolve. Claude Code overrides the hook and
ends the turn after 8 consecutive blocks." And the alternative channel: "Use `additionalContext` when
the hook is working as designed and giving Claude guidance, such as "run the test suite before
finishing". It keeps the conversation going through the same loop protections as `decision: "block"`
... but the transcript labels it `Stop hook feedback` and no hook error notification is shown"
([code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)). **Vendor claim.** The page
gives no advice on how to word a reason.

**The build.** The JSON mapper turns a block decision into a blocking error whose text is the reason
(offset 177,588,949, function `Vke`):

```js
case"block":U.permissionBehavior="deny",U.blockingError={blockingError:e.reason||"Blocked by hook",command:n};break;
```

The Stop path frames it (offset 168,864,004 and 177,624,989):

```js
var Xun=` hook feedback:
`,OVn=["Stop","TeammateIdle","TaskCreated","TaskCompleted"];function oUt(e,n){return`${e}${Xun}${n}`}
function tst(e){return oUt("Stop",e.blockingError)}
```

and the stop-hook loop sends it as a meta message (offset 175,641,643 region):

```js
if(_n.blockingError){let Pn=Ae({content:tst(_n.blockingError),isMeta:!0});Je.push(Pn),yield Pn,ir=!0;
```

So the model reads exactly `Stop hook feedback:\n<reason>`. **Measured** locally, one build, read not
run. That is the byte string, not a claim about how the message is rendered to the API. What follows
from it: the model gets no framing sentence around the reason, so the reason has to carry its own
trigger, scope, and exit condition.

## Anthropic's own shipped wording for this check

### The Reuse angle in `/simplify` and `/code-review`

The angle is a constant (offset 181,317,590):

```js
ue=`Flag new code that re-implements something the codebase
already has \u2014 Grep shared/utility modules and files adjacent to the change,
and name the existing helper to call instead.
`
```

In `/simplify` (offset 181,455,195 region) it sits under `### Reuse` inside "Launch **4 independent
review agents** via the ${_t} tool, all in a single message so they run concurrently. Pass each agent
the diff and one of the four angles below. Each returns its findings with `file`, `line`, a one-line
`summary`, and the concrete cost (what is duplicated, wasted, or harder to maintain)." Phase 2: "Wait
for all four agents to complete, dedup findings that point at the same line or mechanism, and fix each
remaining one directly. Skip any finding whose fix would change intended behavior, require changes well
outside the reviewed diff, or that you judge to be a false positive". The fallback when the agent tool
is missing: "Work through all four angles below yourself, in this same context, in one pass \u2014 do
not skip an angle for lack of fan-out."

In `/code-review` (offset 181,335,091 region) the same text follows "The angles above hunt for bugs;
this one and the next two hunt for cleanup in the changed code." That prompt runs "**10 independent
finder angles**", each surfacing "**up to 8 candidate findings**", and says "This is recall mode \u2014 a
single non-REFUTED vote carries the finding. Do NOT drop on uncertainty."

The low-effort `/code-review` shows the ceiling of a diff-only pass: "Also flag \u2014 still from the hunk
alone \u2014 new code that duplicates an existing helper visible in the diff context" under "One tool
call: read the unified diff ... No subagents, no full-file reads."

What the shipped wording does and does not say:

- It scopes the search by place ("shared/utility modules and files adjacent to the change"), not by
  behaviour.
- It asks for a named answer ("name the existing helper"), which is a per-finding evidence rule.
- It does not enumerate the added functions. It hands the diff to the reader.
- It separates finding from fixing, and puts the finding in a reader that did not write the code.

**Measured** that the strings are in the build; **vendor claim** as to design intent. No published
number says how often this angle misses.

### Other reuse wording in the build

Plan mode, final plan (offset 177,767,042): "Reference existing functions and utilities you found that
should be reused, with their file paths". The remote planning reminder (offset 207,655,014): "Read the
relevant code, understand how the pieces fit, look for existing functions and patterns you can reuse
instead of proposing new ones". The coding-agent system prompt (offset 75,908,276): "Write code that
reads like the surrounding code: match its comment density, naming, and idiom." Nearby (offset
75,917,648): "Don't add features, refactor, or introduce abstractions beyond what the task requires. A
bug fix doesn't need surrounding cleanup; a one-shot operation doesn't need a helper." and (offset
75,920,032) "Prefer editing existing files to creating new ones." No sentence in the main system prompt
tells the model to search for an existing function before writing one. **Measured** presence and
absence in one build; absence in a string search is weaker evidence than presence.

## What the prompting guides say

### Anthropic

The prompting best-practices page on emphasis: "Claude Opus 4.5 and Claude Opus 4.6 are also more
responsive to the system prompt than previous models. If your prompts were designed to reduce
undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any
aggressive language. Where you might have said "CRITICAL: You MUST use this tool when...", you can use
more normal prompting like "Use this tool when..."." On why: "Providing context or motivation behind
your instructions, such as explaining to Claude why such behavior is important, can help Claude better
understand your goals and deliver more targeted responses." On self-checks: "Append something like
"Before you finish, verify your answer against [test criteria]." This catches errors reliably,
especially for coding and math. Claude Opus 5 is the exception: it verifies its own work well without
explicit instruction, and verification instructions carried over from prompts tuned for earlier models
can cause over-verification"
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
**Vendor claim**, no numbers.

The Opus 5 page: "Claude Opus 5 verifies its own work without being told to. If your prompt contains
explicit verification instructions ("include a final verification step for any non-trivial task," "use
a subagent to verify"), remove them: instructions like these cause over-verification on Claude Opus 5,
and removing them reduces wasted tokens with no loss in quality." On review: "Claude Opus 5 reviews
code with high precision and recall ... If your review prompt says "only report high-severity issues"
or "be conservative," the model may follow that instruction literally and report less; ask it to
report everything and filter in a separate pass instead." On delegation, a sample prompt includes "do
not use subagents to verify or double-check your own work", while the capability list says it has
"effective writer-verifier patterns"
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)).
**Vendor claim.**

The Fable 5 page: "Instruction-following is improved enough that you can steer most behaviors with a
brief instruction rather than enumerating each behavior by name." And, under recommended scaffolding:
"Separate, fresh-context verifier subagents tend to outperform self-critique."
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)).
**Vendor claim**, on a different model from ours. The enumeration line is about listing behaviours in a
prompt. It is not about listing the items a check runs over.

Reduce hallucinations: "Verify with citations: Make Claude's response auditable by having it cite quotes
and sources for each of its claims. You can also have Claude verify each claim by finding a supporting
quote after it generates a response. If it can't find a quote, it must retract the claim." And "while
these techniques significantly reduce hallucinations, they don't eliminate them entirely"
([platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).
**Vendor claim.**

Claude Code best practices: "Have Claude show evidence rather than asserting success". On emphasis: "If
Claude keeps skipping one instruction, add emphasis such as "IMPORTANT" to that line alone. If you
emphasize many lines, none of them stands out." On reuse, a sample prompt: "Use subagents to investigate
how our authentication system handles token refresh, and whether we have any existing OAuth utilities I
should reuse." On review: "A fresh context improves code review since Claude won't be biased toward code
it just wrote", "A reviewer running in a fresh subagent context sees only the diff and the criteria you
give it, not the reasoning that produced the change", and the warning "A reviewer prompted to find gaps
will usually report some, even when the work is sound, because that is what it was asked to do. Chasing
every finding leads to over-engineering"
([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)). **Vendor
claim.**

### OpenAI

GPT-5 guide, in a sample of code-editing rules: "Clarity and Reuse: Every component and page should be
modular and reusable. Avoid duplication by factoring repeated UI patterns into components." In the
SWE-bench style coding guidelines: "Keep changes consistent with the style of the existing codebase.
Changes should be minimal and focused on the task." On emphasis, reporting Cursor's experience with a
`<maximize_context_understanding>` block that said "Be THOROUGH when gathering information": "While
this worked well with older models that needed encouragement to analyze context thoroughly, they found
it counterproductive with GPT-5, which is already naturally introspective and proactive at gathering
context. On smaller tasks, this prompt often caused the model to overuse tools by calling search
repetitively"
([developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide),
text read from the notebook source in `openai/openai-cookbook`). **Vendor claim**, and the "Avoid
duplication" line is about UI components written from scratch, not about finding existing code.

GPT-4.1 guide: "GPT-4.1 is trained to follow instructions more closely and more literally than its
predecessors ... a single sentence firmly and unequivocally clarifying your desired behavior is almost
always sufficient to steer the model on course." The three agentic reminders "increased our internal
SWE-bench Verified score by close to 20%". On long context: "place your instructions at both the
beginning and end of the provided context"
([developers.openai.com/cookbook/examples/gpt4-1_prompting_guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)).
**Measured** for the bundle on GPT-4.1 in OpenAI's harness; **vendor claim** for the rest. Neither
OpenAI guide measures a reuse instruction.

## The gap is real and measured

**Agent pull requests carry more semantic duplication.** On the AIDev dataset (3,858 Python PRs), using
CodeSage-Large embeddings to detect Type-4 clones: "the Average Max Redundancy (AMR) for AI agents is
0.2867, compared to only 0.1532 for humans, representing a nearly 1.87x increase". "Mann-Whitney test
confirms that this difference is statistically significant ( p < 0.001 )." Also: "While traditional
metrics show minimal differences between agentic-PRs and human-PRs, redundancy metric analysis shows code
in agentic-PRs contain significantly more redundancy"
([Huang et al., More Code, Less Reuse, arXiv:2601.21276, 2026](https://arxiv.org/abs/2601.21276)).
**Measured.** Agents are pooled, not broken out by model in the passages read. The duplication that
matters is semantic, not textual, which is the case a name search does not reach.

**Agents miss local helpers even when they follow repo-wide conventions.** SWE Atlas: "Models are also
better at incorporating global repo level Test Suite Conventions, but fail at using the local module
level test utilities, helper methods and patterns." Helper reuse is graded under "Test Bucket
Conventions (Local best-practices like helper function reuse)", which is not must-have and is not used
for the final score ([SWE Atlas, arXiv:2605.08366, 2026](https://arxiv.org/abs/2605.08366)). Models
include Opus 4.7 and Sonnet 4.6 in Claude Code. **Measured**, qualitatively. No per-model reuse rate was
found in the passages read, and it covers test code only.

**LLM-detected code shows intra-repository clones.** "code detected as likely to be generated by LLMs
shows substantial intra-repository code clones"
([Ji et al., arXiv:2607.01867, 2026](https://arxiv.org/abs/2607.01867), accepted to The Journal of
Systems & Software). **Measured**, correlational, detector-based. Re-verified from the abstract page.
The number behind "substantial" was not read.

## Lever 1: enumerate every function

**Per-item verification questions raise precision on list answers.** Chain-of-Verification has the model
"(i) drafts an initial response; then (ii) plans verification questions to fact-check its draft; (iii)
answers those questions independently so the answers are not biased by other responses; and (iv)
generates its final verified response". On Wikidata list questions with Llama 65B, precision went from
0.17 (few-shot) to 0.36 (two-step CoVe), and "a large reduction in the number of hallucinated answers
(negatives: 2.95 to 0.68) while only a relatively small reduction in the number of non-hallucinations
(positives: 0.59 to 0.38)" (Table 1; the paper writes the arrows as arrows)
([Dhuliawala et al., arXiv:2309.11495, 2023](https://arxiv.org/abs/2309.11495)). **Measured**, on
factual list generation with Llama 65B, not on code and not on Opus 5. Note the positives also fell:
per-item checking removed some correct items too. The analogue here is deleting a function that was
genuinely new.

**Checklists improve both judging and generation.** TICK decomposes an instruction into yes/no
questions. Exact agreement with human preferences rose from 46.4% to 52.2%, STICK self-refinement gained
"+7.8%" on LiveBench reasoning, and Best-of-N with STICK "+6.3%" on WildBench
([Cook et al., arXiv:2410.03608, 2024](https://arxiv.org/abs/2410.03608); numbers read from the abstract
page summary, not the paper body). **Measured**, on instruction-following, not on code reuse.

**Long lists decay.** "Each additional function the agent generates is associated with approximately
5.6% lower odds of compliance per step (OR = 0.944)", across 1,650 Claude Code CLI sessions and 16,050
function-level observations, primarily Claude Sonnet 4.6 with Opus 4.6 for cross-model validation
([McMillan, arXiv:2605.10039, 2026](https://arxiv.org/abs/2605.10039)). Re-verified: the
stops-guessing note's 5.6% figure is correct, and it is per generated function, not per checked function.
IFScale: "even the best frontier models only achieve 68% accuracy at the max density of 500
instructions", with a "bias towards earlier instructions"
([Jaroslawicz et al., arXiv:2507.11538, 2025](https://arxiv.org/abs/2507.11538)). **Measured**, both,
on other models and other tasks.

What this means for the reason: asking the model to "list every function this change adds" is two
tasks, recalling the list and checking each item, and the first is where the decay studies say items
drop. The hook already knows the diff. Supplying the names (lever 5) keeps the per-item structure CoVe
and TICK measured and takes the recall step away from the model. That is inference from the sources,
not a measured result on this task.

## Lever 2: search by behaviour, not only by name

**A name search cannot see a Type-4 clone, and a model reading both sides still misjudges them.**
Zhang and Saber tested GPT-3.5 and GPT-4 on BigCloneBench and GPTCloneBench pairs. The abstract page
reports both "struggled significantly with the most complex Type-4 clones" and that accuracy tracked
textual similarity ([arXiv:2407.02402, 2024](https://arxiv.org/abs/2407.02402); read as a summary of the
abstract, not verbatim). Zhu et al.: "although LLMs perform well in CodeNet-related datasets, with
o3-mini achieving a 0.943 F1 score, their performance significantly decreased in BigCloneBench-related
datasets" ([arXiv:2511.01176, 2025](https://arxiv.org/abs/2511.01176)). **Measured**, on older models
and on given pairs, which is easier than finding the pair in a repository.

**The shipped wording scopes by place.** Anthropic's Reuse angle names "shared/utility modules and files
adjacent to the change". It does not name behaviour. **Vendor claim** (build string).

**Behaviour words have no measurement.** No source found tests "search by the calls it makes and what it
returns" against "search by name". The argument for it: the duplicates agents leave are Type-4 (the
AIDev result above), and those share calls and return shapes more often than names. That is
inference. The argument against: a vaguer search instruction invites the tool overuse OpenAI reports for
"Be THOROUGH" and Anthropic reports as over-verification.

## Lever 3: written evidence per item

**Vendor guidance favours it.** "Have Claude show evidence rather than asserting success" (Claude Code
best practices). "If it can't find a quote, it must retract the claim" (reduce hallucinations). Shipped
wording asks for a name: "name the existing helper to call instead". **Vendor claim.**

**The cost is also first-party.** The Opus 5 page says to remove explicit verification instructions
because they "cause over-verification". A per-item written log is a verification instruction by shape.
Claude Code's own warning applies too: a reviewer asked to find gaps "will usually report some, even when
the work is sound". The risk here is a forced "closest existing function" line that nudges the model to
merge functions that only look alike, the positives CoVe lost. **Vendor claim**, no numbers.

**No measurement ties a written trail to recall on this task.** The nearest measured thing is CoVe,
where the verification answers are written out and the gain came mostly from not attending to the draft
(lever 4). So the evidence line is weakly supported on its own and better supported as the output of a
separate reader.

## Lever 4: a separate reader or subagent

**Checking your own output without outside feedback does not help, and can hurt.** Huang et al.: "LLMs
struggle to self-correct their responses without external feedback, and at times, their performance even
degrades after self-correction." Table 3, GPT-4: GSM8K 95.5 standard, 91.5 after round 1, 89.0 after
round 2; CommonSenseQA 82.0, 79.5, 80.0; HotpotQA 49.0, 49.0, 43.0. Prior gains "result from using oracle
labels to guide the self-correction process, and the improvements vanish when oracle labels are not
available." They tried several self-correction prompts: "without the use of oracle labels,
self-correction consistently results in a decrease in performance"
([arXiv:2310.01798, ICLR 2024](https://arxiv.org/abs/2310.01798)). **Measured**, on reasoning QA with
GPT-3.5 and GPT-4, not on tool-using coding agents. A reuse check with Grep is not intrinsic
self-correction: the search results are external feedback. So this result argues against "re-read your
change and decide" and not against "search, then decide".

**Sound external verification gains where self-critique collapses.** Stechly, Valmeekam and Kambhampati
report "significant performance collapse with self-critique and significant performance gains with sound
external verification" for GPT-4 on Game of 24, Graph Coloring and STRIPS planning
([arXiv:2402.08115, 2024](https://arxiv.org/abs/2402.08115); phrase quoted from the abstract as fetched).
**Measured**, formal tasks, GPT-4.

**Not seeing the draft helps.** CoVe: "verifying questions should not attend to the original baseline
response as they may be prone to repeating it (as the joint method can do)", and factored beat joint on
every task (FActScore 60.8 to 63.7). **Measured**, Llama 65B.

**Anthropic is split by model.** Fable 5: "Separate, fresh-context verifier subagents tend to outperform
self-critique." Opus 5: remove "use a subagent to verify", and "do not use subagents to verify or
double-check your own work". Claude Code best practices: "A fresh context improves code review since
Claude won't be biased toward code it just wrote." Anthropic's own `/simplify` fans the Reuse angle out
to a separate agent. **Vendor claim**, conflicting. The Opus 5 advice is about verification in general,
and `/simplify` is Anthropic's own shipped exception for this specific check.

**What a reason cannot guarantee.** A reason can ask for a subagent. It cannot make one run. A Stop hook
with an `agent` handler type exists in the docs' timeout table ("60 for `agent`"), but whether it can
run a reuse search and return a block was not tested for this note.

## Lever 5: the hook supplies the list of added hunks

**The hook has the diff and the model does not have to recall it.** The Stop input carries
`last_assistant_message`, `stop_hook_active` and the transcript path (hooks reference); the hook can
run `git diff -U0` itself and name the added functions. That turns lever 1 from "list every function"
into "check each of these", the per-item shape CoVe and TICK measured, without the recall step the decay
studies say loses items. Inference from the sources, not measured.

**A hunk-only view is not enough to find the original.** The low-effort `/code-review` flags only "new
code that duplicates an existing helper visible in the diff context". The original of a Type-4 clone is
by definition somewhere else. The list of added functions tells the model what to check; it does not do
the search. **Vendor claim** (build string) plus inference.

**The list costs tokens every block.** The hooks page for a local command hook gives no length cap for a
Stop `reason` in the passages read. `what-a-pretooluse-hook-can-do.md` found a 2,000-character cap on
`permissionDecisionReason` in a chunk that is very likely the cloud path, not this one. Not measured
here.

## What one reason cannot do

**It cannot reach zero misses.** No source found reports a prompt that removes misses on any detection
task. Anthropic says its own anti-hallucination techniques "don't eliminate them entirely". The model's
judgement that two functions do the same job is bounded by clone-detection ability, which is weakest on
Type-4 pairs (arXiv:2407.02402, arXiv:2511.01176) and drops across datasets. The hook cannot do better
than the reader it prompts. **Measured** for the detection ceiling on older models; **vendor claim** for
"don't eliminate".

**It cannot make the check independent.** The measured gains in lever 4 come from a checker that did not
produce the answer, or from sound external signals. A reason read by the model that wrote the code gives
neither, except through what its searches return. **Measured** (Huang, Stechly, CoVe).

**It cannot stop per-function decay.** Each generated function lowers compliance odds by about 5.6% in
Claude Code sessions. That is the rate for instructions read at session start. A reason delivered at the
stop point is fresh, which is its advantage, but a change with many added functions is itself a long
list. **Measured** (arXiv:2605.10039), and whether a fresh Stop reason escapes the decay is not measured.

**It cannot tell a real duplicate from a look-alike without risk.** CoVe's per-item checks cut correct
items along with wrong ones (positives 0.59 to 0.38). Claude Code warns that a reviewer asked to find
gaps reports some anyway. The reason needs an explicit way out ("If none does, finish without changing
anything") or it trades misses for wrong merges. **Measured** (CoVe), **vendor claim** (Claude Code).

**It cannot be proven good at n=1 on easy cases.** The session's runs had one well-named duplicate each.
The hard cases (original far away, other vocabulary, other algorithm, one duplicate among several new
functions) are where every source above says recall drops, and none of them has been run.

**Shouting does not buy recall on this model.** Anthropic says to "dial back any aggressive language" on
Opus 4.5 and later. OpenAI reports "Be THOROUGH" was "counterproductive" on GPT-5 and caused repeated
search. Claude Code allows one "IMPORTANT" line if a single instruction keeps being skipped. **Vendor
claim**, all three.

## Candidate wordings to measure

Placeholders in angle brackets are filled by the hook. `<list>` means one entry per added function, as
`name (path:line)`, from `git diff -U0`. Word counts exclude the placeholders. Each keeps the current
reason's exit clause, which the loop warning in the hooks reference ("avoid blocking on a condition that
will never resolve") and CoVe's lost positives both argue for.

### A. Supplied list, behaviour search, no log (56 words)

    Before you finish, check each function this change adds: <list>. For each one, search the repository for an existing function that does the same job, by the calls it makes and what it returns as well as by its name. If one exists, call it and delete the new one. If none does, finish without changing anything.

- "Before you finish": Anthropic's self-check form ("Before you finish, verify your answer against [test
  criteria]") and the current reason's opening, which the local runs showed is acted on.
- "check each function this change adds: <list>": per-item checks (CoVe, TICK), with the list supplied
  so the model does not recall it (arXiv:2605.10039, IFScale).
- "by the calls it makes and what it returns as well as by its name": aimed at Type-4 duplication
  (arXiv:2601.21276), which a name search misses. Unmeasured as wording.
- "If one exists, call it and delete the new one. If none does, finish without changing anything": the
  current reason's action and exit, kept because it is the only part with local runs behind it.

### B. A plus one written line per function (63 words)

    Before you finish, check each function this change adds: <list>. For each one, search the repository by its key calls and what it returns as well as by its name, then write one line: the closest existing function with its file and line, or the searches that found none. If an existing one does the same job, call it and delete the new one.

- Everything in A, plus:
- "write one line: the closest existing function with its file and line, or the searches that found
  none": "show evidence rather than asserting success" (Claude Code), "cite quotes ... If it can't find a
  quote, it must retract the claim" (reduce hallucinations), and "name the existing helper" (the build).
- Risk to watch: over-verification per the Opus 5 page, and forced near matches.
- It drops A's exit sentence to stay short. Measure whether the model still finishes cleanly when nothing
  matches, because the loop cap is 8 blocks.

### C. Fresh-context reader, the `/simplify` shape (58 words)

    Before you finish, give one subagent this change's diff and these added functions: <list>. Have it grep shared and utility modules, files near the change, and code making the same calls, then name any existing function that does the same job. Call each named function and delete the copy it replaces. If it names none, finish without changing anything.

- "give one subagent this change's diff": `/simplify`'s "Pass each agent the diff"; Fable 5 "fresh-context
  verifier subagents tend to outperform self-critique"; Claude Code "won't be biased toward code it just
  wrote"; CoVe factored over joint; Stechly external over self.
- "grep shared and utility modules, files near the change": the shipped Reuse angle's scope, near
  verbatim.
- "and code making the same calls": lever 2, added. Unmeasured.
- "name any existing function": "name the existing helper to call instead".
- "one subagent": the Opus 5 page's "If one subagent can complete the task, use one rather than several".
- Risk to watch: the Opus 5 page says to remove "use a subagent to verify". This is the candidate most
  likely to cost more tokens.

### D. Anthropic's shipped sentence, nearly verbatim (49 words)

    Before you finish, flag new code in this change (<list>) that re-implements something the codebase already has: grep shared/utility modules and files adjacent to the change, and name the existing helper to call instead. Call that helper and delete the new code. If there is none, finish without changing anything.

- The middle clause is the build's Reuse angle word for word, minus the dash.
- It is the control: if A to C cannot beat the vendor's own wording on the hard cases, the extra words
  are not earning their place.

## How to measure them

The same fixtures, n greater than 1 per cell, the four candidates plus the current reason plus no hook,
on claude-opus-5 at a pinned effort. Hard cases only: the original in a distant directory, different
vocabulary (for example `countBy` against a hand-rolled tally), a different algorithm with the same
behaviour, one duplicate among four genuinely new functions, and a look-alike that differs on an edge case
(the false-merge case). Score misses and wrong merges separately, and tokens per run, since Anthropic's
over-verification warning is about cost.

## Measured locally

**Setup.** claude-opus-5 through `claude -p` under Claude Code 2.1.272, run from a session whose
configuration holds every child at medium effort. Each run is a fresh local clone of this repository.
The task prompt is "Add scripts/<case>.mjs with this content:" followed by the code. A Stop hook blocks
once per turn when the tree has changes (it passes when `stop_hook_active` is true) and reads its reason
from a file. `<list>` is filled with the changed hunks as `path:start-end`, not with function names: the
hook has no parser. The scorer runs the new file's exported functions against the original on fixed
inputs. A duplicate case passes when behaviour is unchanged, the file imports the existing function,
and the copy is gone. The trap passes when behaviour is unchanged. The scorer was checked on 8
hand-made files with known answers, and every failure below was read by hand.

**Cases.** All four copies were checked against the originals before any run (0 differences on the
three duplicates; the trap differs on `x.d.ts`, `.env`, `Rakefile` and `a/B.PNG`).

- `name-order`: `compareCodeUnits`, a rewrite of `byCode` (`lib/paths.mjs:63`) in other words, next to
  a genuinely new `sortNames`.
- `label-histogram`: `histogram`, `tally` (`lib/layout.mjs:340`) written with `reduce` instead of a loop.
- `report-format`: `parentPath`, a rewrite of `dirOf` (`lib/paths.mjs:15`), third of four functions,
  the other three genuinely new.
- `ext-lower`: `extLower`, a look-alike of `extOf` that returns no dot, lowercases, returns an empty
  string for none, and ignores `d.ts`. The right answer is to keep it.

**The two session wordings**, beside A to D above:

- v0: "Before you finish, check what this change adds (<files>). For every function it adds, search the
  repository for an existing one that does the same job, even under another name or written
  differently. If one exists, call it and delete the new one. If none does, finish without changing
  anything."
- v1: "Before you finish, list every function this change adds (<files>). For each one, search the
  repository by its key calls and what it returns as well as by its name, then write the closest
  existing function with its file and line, or the searches that found none. If an existing one does
  the same job, call it and delete the new one. If none does, finish without changing anything."

**Results.** P pass, M duplicate kept, W wrong merge, D file deleted. Three trials per case, six for C.
Cost and time are the whole run, task included.

| Wording | name-order | label-histogram | report-format | ext-lower | Pass | Missed | Wrong merge | File deleted | Mean cost | Mean time |
|---|---|---|---|---|---|---|---|---|---|---|
| no hook | MMM | MMM | MMM | PPP | 3/12 | 9 | 0 | 0 | $0.66 | 70s |
| v0 | PDP | PPP | PPP | PPW | 10/12 | 0 | 1 | 1 | $0.89 | 74s |
| v1 | PDP | PPP | MPP | PPP | 10/12 | 1 | 0 | 1 | $0.87 | 78s |
| A | PDP | PPP | PPP | PPW | 10/12 | 0 | 1 | 1 | $0.85 | 72s |
| B | MPP | PPP | PPM | PPP | 10/12 | 2 | 0 | 0 | $0.90 | 77s |
| C | PPPPPP | PPPPPP | PPPPPP | PPPPPP | 24/24 | 0 | 0 | 0 | $1.56 | 136s |
| D | PPP | PPP | PMP | WWP | 9/12 | 1 | 2 | 0 | $0.91 | 109s |

Every C run made an Agent call. **Measured**, local, n as shown.

**What the failures were.**

- Misses: the model searched and reported no counterpart for `compareCodeUnits` (B) or `parentPath`
  (v1, B, D).
- Wrong merges on the trap: `extLower` deleted or rewritten over `extOf` with the claim that the two
  match (v0, A, D twice). They do not: `extOf` keeps the dot, returns `(none)`, reads `d.ts`, and keeps
  case.
- File deleted: `sortNames` judged the same as a `[...names].sort()` found inline in another plugin, and
  the file removed with it (v0, v1, A).
- An earlier round used a task prompt that said "run exactly this command and nothing else". There v1
  deleted the `name-order` file 3 of 3, and one v0 run refused to search, citing the prompt. That round
  is left out of the table. A user instruction that narrows scope can win over the hook.

**Cost on a change with no code.** For a one-line markdown edit, C still spawned a subagent: $1.05 and
68s against $0.48 and 16s with no hook. The hook should fire only when a source file changed.

**What this shows and what it does not.**

- C, the only wording that hands the search to a fresh-context subagent, is the only one with no miss
  and no wrong merge. With 24 runs and no failure, the 95% lower bound on its pass rate is about 88%
  (rule of three). It does not show zero misses.
- It agrees with lever 4 (Huang et al., Stechly et al., CoVe's factored variant, the Fable 5 page,
  `/simplify`) and, for this check on these cases, against the Opus 5 page's general advice to drop
  verification subagents.
- v1's written-evidence line did not raise recall and deleted new code, as CoVe's lost positives warn.
- D, the shipped Reuse sentence used inline without its subagent, had the most wrong merges.
- Four cases, one repository, one language, one model, one effort, and cases written by the same person
  who wrote the hook. A different repository or a larger change may score differently.

## What could not be established

- **A miss rate for any reuse-check wording, from a source.** No paper or vendor page found measures one.
  The local runs above measure four cases in one repository, which is a rate for those cases only.
- **Whether a fresh Stop reason escapes per-function decay.** arXiv:2605.10039 measured instructions in
  configuration files, not hook reasons delivered at the stop point.
- **Verbatim abstracts for arXiv:2402.08115, 2407.02402, 2410.03608 and 2507.11538.** The arXiv API
  returned HTTP 429. The abstract pages were read through a summarising fetch; only phrases the fetch put
  in quotation marks are quoted, and the rest is marked as summary.
- **SWE Atlas per-model reuse numbers.** The passages read state the finding qualitatively.
- **The number behind "substantial intra-repository code clones"** in arXiv:2607.01867. Only the abstract
  was read.
- **An `agent`-type Stop hook doing the search itself.** Named in the docs' timeout table, not tested.
- **The length cap on a Stop `reason` for a local command hook.** Not found and not measured.
- **How the meta message is rendered to the API.** The build string was read, not captured from a live
  request.

## Sources

First-party documentation, fetched 2026-09-15:

- [Anthropic, Claude Code hooks reference](https://code.claude.com/docs/en/hooks) (Stop input, Stop
  decision control)
- [Anthropic, Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic, Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Anthropic, Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [Anthropic, Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
- [Anthropic, Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
- [OpenAI, GPT-5 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide),
  read from `examples/gpt-5/gpt-5_prompting_guide.ipynb` in `openai/openai-cookbook`
- [OpenAI, GPT-4.1 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide),
  read from `examples/gpt4-1_prompting_guide.ipynb` in `openai/openai-cookbook`

The installed build, `/Users/crisn/.local/share/claude/versions/2.1.272`, 210,702,192 bytes:

- JSON mapper `Vke`, `decision:"block"` to `blockingError`: 177,588,949
- `Xun` (" hook feedback:\n") and `oUt`: 168,864,004
- `tst` (Stop framing): 177,624,989
- Stop loop sending the meta message: 175,641,643 region
- Reuse angle constant `ue`: 181,317,590 ("Grep shared/utility modules" at 181,317,665; "name the
  existing helper" at 181,317,731)
- `/code-review` Reuse angle copy and recall-mode text: 181,335,091 to 181,335,339
- `/simplify` prompt with the 4-agent fan-out and inline fallback: 181,455,195 region
- Plan mode "Reference existing functions and utilities": 177,767,042
- Remote planning "look for existing functions and patterns you can reuse": 207,655,014
- System prompt "Write code that reads like the surrounding code": 75,908,276
- System prompt "Don't add features, refactor, or introduce abstractions": 75,917,648
- System prompt "Prefer editing existing files to creating new ones.": 75,920,032

Papers and benchmarks:

- [Large Language Models Cannot Self-Correct Reasoning Yet (Huang et al., arXiv:2310.01798, ICLR 2024)](https://arxiv.org/abs/2310.01798), Table 3 read from the PDF
- [On the Self-Verification Limitations of Large Language Models on Reasoning and Planning Tasks (Stechly, Valmeekam, Kambhampati, arXiv:2402.08115, 2024)](https://arxiv.org/abs/2402.08115)
- [Chain-of-Verification Reduces Hallucination in Large Language Models (Dhuliawala et al., arXiv:2309.11495, 2023)](https://arxiv.org/abs/2309.11495), Table 1 read from the PDF
- [TICKing All the Boxes: Generated Checklists Improve LLM Evaluation and Generation (Cook et al., arXiv:2410.03608, 2024)](https://arxiv.org/abs/2410.03608)
- [How Many Instructions Can LLMs Follow at Once? (Jaroslawicz et al., arXiv:2507.11538, 2025)](https://arxiv.org/abs/2507.11538)
- [Instruction Adherence in Coding Agent Configuration Files (McMillan, arXiv:2605.10039, 2026)](https://arxiv.org/abs/2605.10039)
- [More Code, Less Reuse: Code Quality and Reviewer Sentiment towards AI-generated Pull Requests (Huang et al., arXiv:2601.21276, 2026)](https://arxiv.org/abs/2601.21276), numbers read from the HTML
- [SWE Atlas: Benchmarking Coding Agents Beyond Issue Resolution (arXiv:2605.08366, 2026)](https://arxiv.org/abs/2605.08366), passages read from the HTML
- [An Exploratory Study on LLM-Generated Code and Comments in Code Repositories (Ji et al., arXiv:2607.01867, 2026)](https://arxiv.org/abs/2607.01867)
- [Assessing the Code Clone Detection Capability of Large Language Models (Zhang, Saber, arXiv:2407.02402, 2024)](https://arxiv.org/abs/2407.02402)
- [An Empirical Study of LLM-Based Code Clone Detection (Zhu et al., arXiv:2511.01176, 2025)](https://arxiv.org/abs/2511.01176)

This repository:

- `docs/research/one-line-that-stops-guessing.md` (the 5.6% figure, re-verified above),
  `docs/research/what-a-pretooluse-hook-can-do.md` (the reason-length cap finding, not re-measured),
  `docs/research/why-agents-miss-house-style.md` (failure mode 21; GitClear was not reused here and was
  not re-verified).
