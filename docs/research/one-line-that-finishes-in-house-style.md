# One line in the overview that makes an agent finish the work in this repository's shape

Research notes, August 2026. The always-loaded overview (`.claude/rules/anatomiya-overview.md`,
rendered by `renderOverview` in `plugins/anatomiya/lib/render.mjs`) carries two behavioural lines
today: "Read a file before editing it: these notes load when you read, not when you grep." and
"When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you
could not verify." The question here is what a third line should say so that the agent implements
instead of suggesting, carries the work through, and writes in the shape this repository already
uses instead of its own defaults, and what a single constant line can be expected to do at all.
Every claim below is traced to the source that owns it: the vendor's own page, the vendor's own
shipped product, the paper, or this repository's files. Each carries an evidence label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product
- **folklore**: widely reported by practitioners, not yet measured

## Summary

The two halves of this line stand on different ground, and the recommendation reflects that.

The proactive half has first-party wording and a clear gap to fill. Anthropic's prompting page
ships a `default_to_action` sample prompt whose first sentence is "By default, implement changes
rather than only suggesting them", and frames it with the reason: "If you say 'can you suggest some
changes,' Claude will sometimes provide suggestions rather than implementing them" (vendor claim,
no number). The Opus 5 page adds the completion half, "Finish the whole task, and stop short of
actions that are clearly beyond what was asked" (vendor claim). Nothing in the harness says this by
default: a strings dump of Claude Code 2.1.241 contains no "Do what has been asked", no
"nothing more, nothing less", and no proactivity instruction in the user-facing system prompt
blocks (measured locally, one build, an absence).

The convention half is already said, twice, by things the agent is holding anyway. Claude Code
2.1.241's own system prompt contains "Write code that reads like the surrounding code: match its
comment density, naming, and idiom." (measured locally in the shipped binary). And this repository's
overview already derives up to two roster sentences of exactly that kind: "Match sibling test shape;
skip tests where siblings have none." and "Match directory granularity; don't extract into a sibling
module what the directory's files inline." (`plugins/anatomiya/lib/principles.mjs` lines 5 to 16).
So a third line that only says "follow the conventions" buys a duplicate in wording. What it buys
is delivery: the sentence sits at the top of the file whose body is those counts, so the practice it
names has a denominator under it. Alternate 3 below puts the pointer into the words and is rejected
for it, so this half rests on where the line is and the proactive half is what the line says.

The measured case that the gap is real is strong, and none of it is about prompting. Senior
SWE-bench scores patches on "codebase practice alignment (style consistency, pattern adherence,
library usage, abstraction level, documentation fit)" and reports Claude Opus 5 at 62.1% solve rate
against 34.7% "tasteful" solve rate (measured). NITR finds 13.3% of outcomes pass every functional
test and fail the structural oracle (measured). SlopCodeBench finds agent code 2.3 times more
verbose and 2.0 times more eroded than 473 human Python repositories (measured). The one number any
of them puts on a fix is SlopCodeBench's: "Explicit quality guidance reduces initial verbosity and
erosion by up to a third, without affecting degradation rates" (measured). That is guidance inside
the task, moving the code an agent writes first; nothing measures a constant line in a rules file
moving what it conforms to.

The counterweight is measured too. OverEager-Gen puts the overeager-action rate for permissive
agent frameworks at 5.4% to 27.7%, Claude Code among them, and reports that
"stripping consent multiplies the overeager rate on every shared base model (Delta in [11.9, 17.2] pp)"
(measured). Anthropic says in two places that anti-laziness
and tool-eagerness prompting written for earlier models now overtriggers (vendor claim). A line that
pushes toward action on every turn, in a file with no task in it, is the one part of this that can
make things worse.

Recommended line:

    When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion.

## What each first-party source says to write

### Anthropic, prompting best practices (current page, covers Claude 4.x through Fable 5)

Four blocks on this page bear on the question
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).

The framing, under "Tool usage": "Claude's latest models are trained for precise instruction
following and benefit from explicit direction to use specific tools. If you say 'can you suggest
some changes,' Claude will sometimes provide suggestions rather than implementing them, even if
making changes might be what you intended."

The proactive-action sample prompt, quoted in full:

    <default_to_action>
    By default, implement changes rather than only suggesting them. If the user's intent is
    unclear, infer the most useful likely action and proceed, using tools to discover any
    missing details instead of guessing. Try to infer the user's intent about whether a tool
    call (e.g., file edit or read) is intended or not, and act accordingly.
    </default_to_action>

The same page ships the opposite block, `do_not_act_before_instructions` ("Do not jump into
implementation or change files unless clearly instructed to make changes"), for products that want
the other default. The axis is two-directional and the page takes no position on which end is right.

And the counterweight, in three places. "Claude Opus 4.5 and Claude Opus 4.6 are also more
responsive to the system prompt than previous models. If your prompts were designed to reduce
undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any
aggressive language. Where you might have said 'CRITICAL: You MUST use this tool when...', you can
use more normal prompting like 'Use this tool when...'." Under overthinking: "Remove over-prompting.
Tools that undertriggered in previous models are likely to trigger appropriately now. Instructions
like 'If in doubt, use [tool]' will cause overtriggering." And in the migration list: "Tune
anti-laziness prompting: If your prompts previously encouraged the model to be more thorough or use
tools more aggressively, dial back that guidance. Claude 4.6 models are more proactive and may
overtrigger on instructions that were needed for previous models."

The page's overeagerness section points the other way, at scope: the models "have a tendency to
overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility
that wasn't requested", with a sample whose first bullet is "Scope: Don't add features, refactor
code, or make 'improvements' beyond what was asked." All **vendor claim**; no numbers on the page.

### Anthropic, prompting Claude Fable 5 and Claude Opus 5

The Fable 5 page is the clearest first-party statement that a short instruction beats an enumerated
one, which is the whole design constraint here: "Instruction-following is improved enough that you
can steer most behaviors with a brief instruction rather than enumerating each behavior by name."
It also says where the pause belongs: "Pause for the user only when the work genuinely requires
them: a destructive or irreversible action, a real scope change, or input that only they can
provide. If you hit one of these, ask and end the turn, rather than ending on a promise." And it
states the boundary the proactive half must respect: "When the user is describing a problem, asking
a question, or thinking out loud rather than requesting a change, the deliverable is your
assessment. Report your findings and stop. Don't apply a fix until they ask for one."
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)).
The page also warns off carried-over prescription: "Skills developed for prior models are often too
prescriptive for Claude Fable 5 and can degrade output quality." **Vendor claim.**

The Opus 5 page carries the completion clause and the scope guard in one sample: "Deliver what was
asked, at the scope intended. Make routine judgment calls yourself, and check in only when different
readings of the request would lead to materially different work. If the request seems mistaken or a
better approach exists, say so in a sentence and continue with the task as asked rather than quietly
narrowing, widening, or transforming it. Finish the whole task, and stop short of actions that are
clearly beyond what was asked." The same page reports the model already completes work without being
pushed: "It completes full tasks rather than leaving stubs or placeholders, and it performs best when
given the complete task specification up front and left to run." And it says to delete verification
prompting: "If your prompt contains explicit verification instructions ... remove them: instructions
like these cause over-verification on Claude Opus 5"
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)).
**Vendor claim.**

Neither page says anything about matching an existing codebase's style. That absence is itself
useful: on current models the vendor treats house style as a thing you supply, not a behaviour you
prompt for.

### Anthropic, Claude Code docs

The best-practices page has the closest thing to first-party wording for the convention half, and it
is a prompt for a human to type, not a rule for a file. Under "Provide specific context in your
prompts", the row "Reference existing patterns", quoted in full:

> look at how existing widgets are implemented on the home page to understand the patterns.
> HotDogWidget.php is a good example. follow the pattern to implement a new calendar widget that lets
> the user select a month and paginate forwards/backwards to pick a year. build from scratch without
> libraries other than the ones already used in the codebase.

The same page's CLAUDE.md table is the sharper guidance for what belongs in an always-loaded file.
Include: "Code style rules that differ from defaults". Exclude: "Standard language conventions Claude
already knows" and "Anything Claude can figure out by reading code". Plus the size rule: "Keep it
concise. For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it.
Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" And on emphasis: "If Claude
keeps skipping one instruction, add emphasis such as 'IMPORTANT' to that line alone. If you emphasize
many lines, none of them stands out."
([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)).

The memory page adds the delivery facts and the wording standard. Rules without `paths` "are loaded
at launch with the same priority as `.claude/CLAUDE.md`". "The more specific and concise your
instructions, the more consistently Claude follows them." "Specificity: write instructions that are
concrete enough to verify." And the ceiling: "CLAUDE.md content is delivered as a user message after
the system prompt, not as part of the system prompt itself. Claude reads it and tries to follow it,
but there's no guarantee of strict compliance, especially for vague or conflicting instructions."
The page also describes what the `/doctor` trim check keeps and cuts: "it cuts content Claude can
derive from the codebase, such as directory layouts, dependency lists, and architecture overviews,
and keeps pitfalls, rationale, and conventions that differ from tool defaults"
([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)). All **vendor claim**.

That last sentence is a warning aimed squarely at this file. An overview of counted layout is the
kind of content the vendor's own checkup proposes cutting; what it says to keep is conventions that
differ from tool defaults, which is what this map's stated rows are and what the new line should
point at.

### Claude Code 2.1.241 itself, which is a product surface and not a doc page

The strongest verbatim precedent for the convention half is not on any documentation page. It is in
the shipped Claude Code binary, in the block that composes the user-facing system prompt. From
`strings` over `~/.local/share/claude/versions/2.1.241`, appearing twice in the coding-agent branch
of that block:

> Write code that reads like the surrounding code: match its comment density, naming, and idiom.

Immediately after it, in the same block: "Only write a code comment to state a constraint the code
itself can't show, never to say where it came from, what the next line does, or why your change is
correct". The built-in plan subagent's prompt carries the exploration form of the same idea: "Find
existing patterns and conventions using `find`, `grep`" and "Follow existing patterns where
appropriate".

**Measured** locally, in the sense that the strings are in the binary this machine runs; **vendor
claim** as to what they mean, since Anthropic publishes no page stating this wording. Two limits
worth naming. The strings are a build artifact, so their presence is solid and their exact assembly
at runtime is not something this note verified. And the same dump found no counterpart on the
proactive side: `grep` for "Do what has been asked", "nothing more, nothing less", and
"rather than only suggesting" returns nothing, and every "proactiv" hit is a tool description, a
settings key, or telemetry. Absence in a strings dump is weaker evidence than presence, but it is
the same method for both halves and it points one way.

The practical consequence: on Claude Code, a new overview line saying "match the surrounding code"
would restate a sentence the model is already holding, on every turn, from a higher-priority
position. A new line saying "implement rather than suggest" would not.

### OpenAI, GPT-4.1 and GPT-5 prompting guides

The GPT-4.1 guide's persistence reminder is the measured wording for the proactive half: "You are an
agent - please keep going until the user's query is completely resolved, before ending your turn and
yielding back to the user." The guide says the three reminders together "increased our internal
SWE-bench Verified score by close to 20%"
([developers.openai.com/cookbook/examples/gpt4-1_prompting_guide, 2025](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)).
**Measured** for the bundle, on GPT-4.1, in OpenAI's harness; the persistence line is not measured
alone. Two more sentences from the same page shape the form: "if model behavior is different from
what you expect, a single sentence firmly and unambiguously clarifying your desired behavior is
almost always sufficient", and "GPT-4.1 tends to follow the one closer to the end of the prompt" when
instructions conflict. **Vendor claim.**

The GPT-5 guide keeps the persistence line and adds the convention half in its code-editing
guidance: "Keep changes consistent with the style of the existing codebase. Changes should be minimal
and focused on the task." and "Every component and page should be modular and reusable. Avoid
duplication by factoring repeated UI patterns into components." It also carries the warning that
applies to putting a third behavioural line in a file that loads every turn: "poorly-constructed
prompts containing contradictory or vague instructions can be more damaging to GPT-5 than to other
models, as it expends reasoning tokens searching for a way to reconcile the contradictions"
([developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide, 2025](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)).
**Vendor claim.**

Both vendors, then, publish the same two clauses: keep going until it is done, and stay in the shape
the codebase already has. Neither publishes a number for either clause on its own.

## What one line can and cannot do

**The convention half is already in the room twice, so it can only add a pointer.** Claude Code
2.1.241's system prompt says "Write code that reads like the surrounding code: match its comment
density, naming, and idiom" (measured locally), and the overview itself already prints up to two
derived sentences of the same kind from `principles.mjs`: "Match sibling test shape; skip tests where
siblings have none." and "Match directory granularity; don't extract into a sibling module what the
directory's files inline." Those two are gated on counts the scan actually made
(`docs/how-it-works.md` line 887). A constant line repeating the generic instruction is the
"lint leakage" smell, found in 62% of the files across 100 popular repositories with an
AGENTS.md or CLAUDE.md ([arXiv:2606.15828, SCAM 2026](https://arxiv.org/abs/2606.15828)) and the
"Anything Claude can figure out by reading code" row of the vendor's own exclude table. What is left
for the new line is a place to say it from: printed at the head of the file whose body is those
counts. **Vendor claim** plus **measured** for the smell
prevalence.

**The gap the convention half aims at is measured, and it is large.** Senior SWE-bench grades
patches with a two-judge panel "along two axes: relative code quality (minimality, approach, hygiene,
fluency, craftsmanship) and codebase practice alignment (style consistency, pattern adherence,
library usage, abstraction level, documentation fit)", with alignment required to "score above 2 out
of 5". Claude Opus 5 posts 62.1% solve rate and 34.7% tasteful solve rate; Claude Fable 5 and
GPT-5.6 Sol post 53.7% and 34.7% ([Snorkel AI, Senior SWE-bench, 2026](https://snorkel.ai/leaderboard/senior-swe-bench/)).
NITR reports "64/483 outcomes (13.3%) pass all functional tests yet fail the structural oracle", with
an average solve rate of 36.2% across 23 configurations
([arXiv:2603.27745, 2026](https://arxiv.org/abs/2603.27745)). SlopCodeBench measures the drift over
time: "structural erosion rising in 77% of trajectories and verbosity in 75.5%", and "compared to 473
open-source Python repositories, agent code is 2.3x more verbose and 2.0x more eroded"
([arXiv:2603.24755, 2026](https://arxiv.org/abs/2603.24755)). **Measured**, all three. None of them
measures a prompt line, so the size of the gap is not evidence that a line closes any of it.

**No measured work found ties a rules-file line to convention conformance.** The searches behind this
note turned up benchmarks that score alignment (above) and studies that count the divergence
(`docs/research/why-agents-miss-house-style.md`, failure modes 14, 23 to 27, 29), but no study that
holds a repository fixed and measures conformance with and without an instruction telling the agent
to conform. The nearest measured thing is SlopCodeBench's intervention, quoted in the summary: quality
guidance given inside the task cuts initial verbosity and erosion by up to a third and leaves the
degradation rate alone. It is not this line: it is task-time guidance, its outcome is verbosity and
structure, and its own result says the improvement does not hold as the work goes on. The convention
half of this line rests on vendor wording and on the size of the gap, and on no measured effect of
its own. Saying so beats dressing the folklore up.

**Repository overviews as a genre do not raise task success; explicit non-standard instructions are
followed.** The AGENTS.md eval found "providing context files does not generally improve task success
rates, while increasing inference cost by over 20% on average", that "instructions in the context
files are well followed by coding agents", that "repository overviews, although popular and
recommended by model providers, are not helpful", and that the files earn their keep for "specifying
non-standard coding practices" ([arXiv:2602.11988, 2026](https://arxiv.org/abs/2602.11988)).
**Measured.** The anatomiya overview is an overview by genre and a rules file by delivery; the new
line is an explicit instruction, so it sits in the followed bucket, and the finding is a direct
argument for anchoring it to the non-default counts instead of to generic advice.

**Rules move behaviour, decay within the session, and still leave a quarter non-compliant.** Across
1,650 Claude Code sessions, none of size, position, architecture, or cross-file contradictions moved
adherence detectably, and each additional generated function carried about 5.6% lower odds of
compliance ([arXiv:2605.10039, 2026](https://arxiv.org/abs/2605.10039)). Correcting rules raised
artifact compliance from 49.14% to 72.13%
([arXiv:2606.12231, 2026](https://arxiv.org/abs/2606.12231)). **Measured**, both. A style rule read
at launch is weakest at function twenty, which is exactly where drift shows.

**The proactive half has a measured cost, and this harness is in the expensive class.**
OverEager-Gen benchmarks scope expansion on benign tasks across 500 scenarios and about 7,500 runs:
"a permissive cluster (Claude Code, Codex CLI, Gemini CLI) runs at 5.4-27.7% while the ask-to-continue
framework (OpenHands) sits at 0.2-4.5%", and "stripping the consent declaration alone raises the
overeager rate from 0.0% to 17.1% on paired scenarios"
([arXiv:2605.18583, 2026](https://arxiv.org/abs/2605.18583)). **Measured.** The lesson for wording is
not that the line is unsafe; it is that scope language is load-bearing enough to move the rate by
double digits, so a line pushing toward action should carry its own trigger clause instead of standing
unconditional.

**Shouting is not free, and the file loads for whatever model the user runs.** "IMPORTANT" raises
adherence per the Claude Code best-practices page, and the same vendor says aggressive tool language
overtriggers on Opus 4.5 and later, and that anti-laziness prompting should be dialled back. The
overview has no way to know which model is reading it. **Vendor claim**, both directions.

**The line cannot make the claims underneath correct.** Everything it points at is a count this tool
made. `docs/research/why-agents-miss-house-style.md` failure mode 34 records what happens when a
rules file lags the code: the agent follows the stale rule. The overview's own answer to that is the
delivered preamble, "Where this and the code disagree, the code is right and the map is stale", and
the read-first line already in the head. The new line inherits both and adds no protection of its
own.

**One head line costs one area line, measured on this repository.** Rendering the current
`.claude/anatomiya/facts.json` through `renderOverview` with one extra head string keeps the file at
40 lines and folds one named area into the trailing count: the `test` area's line (75 files, 4
stated) disappears, and the trailer goes from "and 2 more areas" to "and 3 more areas". The
worst-case sweep in `test/render.test.mjs` reports the same worst value, 40 of 40, with and without
the line, at 1 area and 7 roots. **Measured**, in a scratch clone, on this repository's own scan.

## Recommended line

    When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion.

22 words, one sentence, no counts, no dates, no task reference. It reads as a rule about the code, in
the same conditional voice as the line above it. Phrase by phrase:

- "When a change is asked for": the trigger clause, and the whole answer to the measured
  over-eagerness risk. Anthropic's own boundary wording is "When the user is describing a problem,
  asking a question, or thinking out loud rather than requesting a change, the deliverable is your
  assessment" (Fable 5 page), and OverEager-Gen reports that "stripping consent
  multiplies the overeager rate on every shared base model (Delta in [11.9, 17.2] pp)". A conditional also mirrors the head's existing "When unsure what this code
  does", so the two behavioural lines read as a pair of triggers instead of a pile of orders.
- "follow what this repository already does": the convention half. Its wording alone adds nothing
  that is not already said: Claude Code says "match its comment density, naming, and idiom" about
  the code in view, and this map already derives "Match sibling test shape" with counts behind it.
  What the half adds is where it is said. Printed at the top of the file whose body is the counts,
  "what this repository already does" has those counts under it instead of being a sentiment, and it
  is the "conventions that differ from tool defaults" the vendor's own trim check says to keep, and
  the "non-standard coding practices" the AGENTS.md eval found context files are actually good for.
  The limit of that argument: most stated directives live in the area files, and the head is not in
  them. So what sits under this sentence is the overview's own counts, and the area files are reached
  by the read-before-editing line above.
- "and carry it through": the completion clause, in the vendor's own register. Anthropic Opus 5:
  "Finish the whole task, and stop short of actions that are clearly beyond what was asked." It is
  the survivable form of OpenAI's persistence reminder: scoped to the change that was asked for,
  instead of the unbounded "keep going until the user's query is completely resolved" that Anthropic
  now says to dial back.
- "instead of stopping at a suggestion": the shape of Anthropic's `default_to_action` ("implement
  changes rather than only suggesting them"), and the failure mode the same page names as real on
  current models. "instead of" and not the source's "rather than", for the idiom the line above it
  already uses in "instead of guessing". Stated once, in the calm register the same page asks for.

What it deliberately leaves out. No "tee up the next step": nothing first-party supports it, the
Fable 5 page says the opposite for the un-asked case ("Report your findings and stop"), and an
always-loaded file cannot tell an interactive session from an autonomous one. No "verify" or
"double-check", which the Opus 5 page says to remove. No emphasis word: "IMPORTANT" would raise
adherence for this line at the cost of the two above it, per the best-practices page's own "If you
emphasize many lines, none of them stands out". No mention of tests, comments or naming, all of which
the derived sentences and the area files already carry with counts behind them.

## Alternates

Each is one line, constant, and traceable to the same sources; each trades something.

1. Vendor-verbatim, proactivity first, 18 words:

       By default, implement changes rather than only suggesting them, in the shape this repository's own files already use.

   Trade-off: the first clause is Anthropic's `default_to_action` almost word for word, which is the
   closest thing to authority this half has. It carries no trigger clause, so on a question-only turn
   it argues for editing, which is the case the Fable 5 page singles out and the behaviour
   OverEager-Gen measures at 5.4 to 27.7% on this class of harness. "By default" also reads as prompt
   scaffolding instead of as a rule about the code, unlike the two lines above it.

2. Short, no trigger clause, 17 words:

       Follow what this repository already does, and carry a change through instead of stopping at a suggestion.

   Trade-off: cheapest of the three and keeps both halves. The scoping survives only in the indefinite
   "a change", which is a weaker guard than a clause, and the measured swing from scope wording is the
   reason to want the stronger one. Reads slightly better than the recommendation; carries slightly
   less.

3. Anchored hardest to the counts, 18 words:

       Prefer the practice counted below to the one you would write by default, and carry the change through.

   Trade-off: says the one thing nothing else in the stack says, and says it about the model's own
   prior, which is failure mode 14 in `why-agents-miss-house-style.md` and the mechanism behind the
   Senior SWE-bench alignment gap. It reads like documentation of this tool instead of a rule about
   the code, and "counted below" goes half-wrong the moment the interesting counts are in an area file
   instead of in the overview.

## Where it goes

`plugins/anatomiya/lib/render.mjs`, `renderOverview` (line 649), in the `head` array declared at line
650, appended after the existing "When unsure what this code does" string at line 664 and before the
`""` at line 665. Order matters for one test: `test/render.test.mjs` line 349 asserts that the line
directly above the "When unsure" sentence is the read-before-editing line, so the new string must go
after it, not between the two.

Rendering constraints it has to satisfy, all three verified against the code:

- **Constant.** The comment above the function (lines 643 to 648) states it: the overview "must be
  byte-stable between scans with no source change ... So no timestamp, no duration, no counts that
  drift" (DECISIONS.md A5, line 20). Every candidate above is a literal string, so it holds.
- **One line.** `MAX_LINES` is 40 (`render.mjs` line 29, DECISIONS.md A6, line 21). The head is paid
  first; the roster gets `MAX_LINES - head.length - fixed.length - 2 - listings` (line 702) and the
  two listings share `Math.max(2, MAX_LINES - head.length - fixed.length)` (line 711). So one more
  head line takes one line from the section or the area listing on any repository at the bound. The
  render joins with `"\n"` and never wraps, so the cost is one line whatever the sentence's length.
- **Calm and imperative.** No "IMPORTANT", no "YOU MUST", one sentence, same voice as the two lines
  above.

Measured cost, from a scratch clone of this repository at the current HEAD with one extra head string
in place:

- `node --test test/render.test.mjs`: 156 of 156 pass.
- `node --test test/cli.test.mjs test/write.test.mjs`: 77 pass, 16 fail, identical with and without
  the line. Those 16 fail in a fresh clone with no parser dependencies installed, so those 16 come from the
  clone's baseline.
- The roster, not the area listing, is what a head line reaches first: `renderOverview` budgets
  `renderLayout` at `MAX_LINES - head.length - fixed.length - 2 - listings` and gives the area
  listing what is left. Measured on this repository and on synthetic shapes from 7 to 40 roots and
  2 to 200 areas, with 0 to 6 foreign rule files, the line that went was a named area every time.
  The one shape where the roster pays is the worst-case sweep's, which renders every optional head
  line at once: there this line takes the roster under its frame and the section drops whole. That
  shape is not reachable, because `scan.mjs` counts untracked source files only when it found no
  tracked ones, and a truncation needs many. The sweep now varies the two apart and holds the
  roster over the reachable half. `test/scan.test.mjs` pins that premise in both directions: a scan
  that counted tracked source reports no untracked count, and a scan that found none is not
  truncated. Without them the sweep's scoping would rest on a scan-level invariant nothing enforced.
- The echoed map costs more per delivery. Measured on this repository, the overview goes from 1424
  to 1521 bytes, so about 24 tokens net of the area line it displaced. `docs/how-it-works.md` and
  A24 state the cost for the 2,468-file repository in `README.md`, which is not on this machine, so
  their "roughly 480" becomes "roughly 500" by the same arithmetic and not by a second measurement.
- Worst-case sweep: worst = 40 lines against `MAX_LINES` 40, unchanged by the line, at 1 area and
  7 roots.
- On this repository's own `facts.json`: file stays at 40 lines, the `test` area's line (75 files, 4
  stated) folds away, and the trailer goes from "and 2 more areas" to "and 3 more areas".

Tests that touch the overview. Line numbers are as they stood before this change and the file has
moved since; the titles are what to grep for:

- `test/render.test.mjs:335` "the overview is byte-stable across scans of unchanged source" (A5).
  Holds for a constant string.
- `test/render.test.mjs:349` "the overview tells the agent to read, grep or run the code when unsure,
  and to say what it could not verify". The one position-sensitive assertion: it checks
  `lines[at - 1]` is the read-before-editing sentence. Appending after the "When unsure" line keeps
  it green; inserting between them breaks it. A companion test for the new line belongs beside this
  one, in its shape.
- `test/render.test.mjs:361` "a repository with more areas than the overview lists summarises the
  tail", and `:384`, `:405` on the same listing. They compute room from `head.length`, so a constant
  extra line keeps them green.
- `test/render.test.mjs:879` "the overview stays inside the bound however many areas state something"
  and "the overview holds the bound when every area states something".
- `test/render.test.mjs:1052` "the overview holds its bound over every section that can grow, not just
  the areas", the worst-case sweep. Its `worst <= MAX_LINES` assertion sits after every loop.
- `test/render.test.mjs:1462` asserts `both[12]` is "Match sibling test shape ...", but on
  `renderLayout` output instead of on the overview, so a head line does not shift it. Same for the
  other index assertions in that file.
- `test/cli.test.mjs:113` "the CLI summary and the overview word an unexamined file the same way", and
  the overview reads at `:233` and `:366`. All match on content instead of position.
- `test/write.test.mjs:901` byte-stability across two scans (A5).
- `test/corpus.test.mjs:916` "area discovery does not depend on the order the files arrived in", the
  ordering half of A5.

Docs and samples that go stale, none of them mechanically checked (`scripts/check-docs.mjs` counts
numbers instead of reading English):

- `README.md` lines 127 and 128 reproduce the overview head verbatim; the sample needs the third
  line. The second sample at lines 152 to 170 is roster-only and is unaffected.
- `docs/how-it-works.md` lines 612 to 618 say "The overview head carries two fixed sentences beside
  the counts" and then names both. That becomes three, and the paragraph should point at this file
  the way it points at `one-line-that-stops-guessing.md`.
- `DECISIONS.md` needs its own row for the new line, in the shape of A16 (line 31), which is the row
  that owns the existing "When unsure" sentence and cites its research note.

All of these shipped with the line, in the same change.

## Sources

First-party prompting and product docs:

- [Anthropic, Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Anthropic, Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
- [Anthropic, Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [Anthropic, Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic, Claude Code memory and rules](https://code.claude.com/docs/en/memory)
- [Anthropic, Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- Claude Code 2.1.241, shipped binary at `~/.local/share/claude/versions/2.1.241`, read with
  `strings`. The user-facing system-prompt block and the built-in plan subagent prompt. Not a
  documentation page; quoted as a product surface.
- [OpenAI, GPT-4.1 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)
- [OpenAI, GPT-5 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)

Papers and benchmarks:

- [Overeager Coding Agents: Measuring Out-of-Scope Actions on Benign Tasks (arXiv:2605.18583, 2026)](https://arxiv.org/abs/2605.18583)
- [Needle in the Repo: Maintainability in AI-Generated Repository Edits (arXiv:2603.27745, 2026)](https://arxiv.org/abs/2603.27745)
- [SlopCodeBench (arXiv:2603.24755, 2026)](https://arxiv.org/abs/2603.24755)
- [Senior SWE-bench leaderboard (Snorkel AI, 2026)](https://snorkel.ai/leaderboard/senior-swe-bench/)
- [Evaluating AGENTS.md (arXiv:2602.11988, 2026)](https://arxiv.org/abs/2602.11988)
- [Instruction Adherence factorial study (arXiv:2605.10039, 2026)](https://arxiv.org/abs/2605.10039)
- [Rule Taxonomy and Evolution in AI IDEs (arXiv:2606.12231, 2026)](https://arxiv.org/abs/2606.12231)
- [Configuration Smells in AGENTS.md (arXiv:2606.15828, SCAM 2026)](https://arxiv.org/abs/2606.15828)
- [Understanding Code Agent Behaviour (arXiv:2511.00197, 2025)](https://arxiv.org/abs/2511.00197)

This repository:

- `plugins/anatomiya/lib/render.mjs` (`renderOverview` line 649, head array line 650, `MAX_LINES`
  line 29, and the two budgets in `renderOverview`), `plugins/anatomiya/lib/principles.mjs` (the two derived
  sentences), `DECISIONS.md` (A5, A6, A16), `docs/how-it-works.md` (the head paragraph at 612, the
  sentence table at 887), `README.md` (the overview sample at 127),
  `docs/research/one-line-that-stops-guessing.md` (the sibling note this one follows),
  `docs/research/why-agents-miss-house-style.md` (failure modes 5, 14, 21, 23 to 27, 29, 32, 34).
