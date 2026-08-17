# One line in the overview that makes an agent look instead of guess

Research notes, August 2026. The always-loaded overview (`.claude/rules/anatomiya-overview.md`,
rendered by `renderOverview` in `lib/render.mjs`) carries one behavioural line today: "Read a file
before editing it: these notes load when you read, not when you grep." The question here is what a
second line should say so that the agent working in a scanned repository digs into the code and
says what it could not check, instead of guessing, and what a single line can be expected to do at
all. Every claim below is traced to the source that owns it: the vendor's own prompting page, the
paper, or this repository's own files. Each carries an evidence label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product
- **folklore**: widely reported by practitioners, not yet measured

## Summary

Two vendors publish wording for exactly this behaviour, and they agree on the shape. OpenAI's
GPT-4.1 guide gives a "tool-calling" reminder ("If you are not sure about file content or codebase
structure ... use your tools to read files and gather the relevant information: do NOT guess or make
up an answer") and reports that it, together with a persistence and a planning reminder, raised
their internal SWE-bench Verified score by close to 20% (measured, but for the three lines as a
bundle, on GPT-4.1, in their harness). Anthropic's current prompting page gives an
`investigate_before_answering` block ("Never speculate about code you have not opened ... read
relevant files BEFORE answering questions about the codebase") and a `default_to_action` block that
says to use "tools to discover any missing details instead of guessing" (vendor claim, no number).
Anthropic's hallucination page adds the other half: give the model explicit permission to say it
does not know (vendor claim). The Fable 5 page reports that telling the model to report only what
it can point to evidence for "nearly eliminated fabricated status reports" (vendor claim with an
internal test behind it).

The limits are as well documented as the wording. Compliance with a rules-file instruction decays
about 5.6% in odds per generated function within a session (measured); repository overviews as a
genre do not raise task success, though explicit instructions in them are followed (measured);
Kalai et al. argue that guessing is rewarded at training and evaluation time, so a prompt shifts
the balance but does not remove the incentive, and "Search (and reasoning) are not panaceas"
(measured framework, no prompt-only number); and Anthropic warns that eagerness and verification
prompts written for older models over-trigger on Opus 4.5 and later (vendor claim). One line moves the
model toward reading and admitting; it does not make it verify every claim, and it does not reach
a subagent that never opens a file.

Recommended line:

    When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.

## What each first-party source says to write

### OpenAI, GPT-4.1 prompting guide (2025)

The guide names three "agentic reminders" and quotes them verbatim
([developers.openai.com/cookbook/examples/gpt4-1_prompting_guide, 2025](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)):

- Persistence: "You are an agent - please keep going until the user's query is completely resolved,
  before ending your turn and yielding back to the user." The guide says this "prevents it from
  prematurely yielding control back to the user."
- Tool-calling: "If you are not sure about file content or codebase structure pertaining to the
  user's request, use your tools to read files and gather the relevant information: do NOT guess or
  make up an answer." The guide says this "encourages the model to make full use of its tools, and
  reduces its likelihood of hallucinating or guessing an answer."
- Planning: "You MUST plan extensively before each function call, and reflect extensively on the
  outcomes of the previous function calls."

Effect: "these three instructions transform the model from a chatbot-like state into a much more
'eager' agent" and "increased our internal SWE-bench Verified score by close to 20%." Planning alone
is credited with 4%. The tool-calling line is not measured on its own. **Measured** for the bundle,
on GPT-4.1 in OpenAI's harness. Two more lines from the same page matter for a rules file: "a single
sentence firmly and unequivocally clarifying your desired behavior is almost always sufficient to
steer the model on course" and, for long prompts, "place your instructions at both the beginning
and end of the provided context." **Vendor claim.**

The GPT-5 guide keeps the tool-calling line nearly word for word ("If you are not sure about
information pertaining to the user's request, use your tools to read files and gather the relevant
information: do NOT guess or make up an answer"), adds "Always verify your changes extremely
thoroughly", and shows both directions of eagerness: "Never stop or hand back to the user when you
encounter uncertainty" on one side, "Bias strongly towards providing a correct answer as quickly as
possible, even if it might not be fully correct" and "an absolute maximum of 2 tool calls" on the
other. It also warns that "poorly-constructed prompts containing contradictory or vague instructions
can be more damaging to GPT-5 than to other models"
([developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide, 2025](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)).
**Vendor claim.**

### Anthropic, prompting best practices (current page, covers Claude 4.x through Fable 5)

Four blocks on this page bear directly on the question
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices);
the old `claude-4-best-practices` URL redirects here).

Minimizing hallucinations in agentic coding, sample prompt, quoted in full:

    <investigate_before_answering>
    Never speculate about code you have not opened. If the user references a specific file,
    you MUST read the file before answering. Make sure to investigate and read relevant
    files BEFORE answering questions about the codebase. Never make any claims about code
    before investigating unless you are certain of the correct answer - give grounded and
    hallucination-free answers.
    </investigate_before_answering>

Proactive action, sample prompt: "By default, implement changes rather than only suggesting them.
If the user's intent is unclear, infer the most useful likely action and proceed, using tools to
discover any missing details instead of guessing." The page's framing: "Claude's latest models are
trained for precise instruction following and benefit from explicit direction to use specific
tools. If you say 'can you suggest some changes,' Claude will sometimes provide suggestions rather
than implementing them."

Parallel tool calls, last sentence of the sample: "Never use placeholders or guess missing
parameters in tool calls."

Self-check: "Append something like 'Before you finish, verify your answer against [test
criteria].' This catches errors reliably, especially for coding and math. Claude Opus 5 is the
exception: it verifies its own work well without explicit instruction, and verification
instructions carried over from prompts tuned for earlier models can cause over-verification."

And the counterweight, twice on the same page: "Claude Opus 4.5 and Claude Opus 4.6 are also more
responsive to the system prompt than previous models. If your prompts were designed to reduce
undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any
aggressive language. Where you might have said 'CRITICAL: You MUST use this tool when...', you can
use more normal prompting like 'Use this tool when...'" and, in the migration list, "Tune
anti-laziness prompting: If your prompts previously encouraged the model to be more thorough or use
tools more aggressively, dial back that guidance." All **vendor claim**; no numbers on the page.

### Anthropic, reduce hallucinations

"Allow Claude to say 'I don't know': Explicitly give Claude permission to admit uncertainty. This
simple technique can drastically reduce false information." Sample wording: "If you're unsure about
any aspect or if the report lacks necessary information, say 'I don't have enough information to
confidently assess this.'" Also "Verify with citations ... If it can't find a quote, it must
retract the claim", and the closing note that these techniques "don't eliminate them entirely"
([platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).
**Vendor claim.**

### Anthropic, prompting Claude Fable 5 and Claude Opus 5

The Fable 5 page has the closest thing to a measured first-party result for the "do not make things
up" axis. Under "Ground progress claims during long runs": "In Anthropic's testing, this nearly
eliminated fabricated status reports even on tasks designed to elicit them", with the wording
"Before reporting progress, audit each claim against a tool result from this session. Only report
work you can point to evidence for; if something is not yet verified, say so explicitly."
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)).
**Vendor claim** with an internal test behind it; no number published. The same page: "you can
steer most behaviors with a brief instruction rather than enumerating each behavior by name", and
"Skills developed for prior models are often too prescriptive for Claude Fable 5 and can degrade
output quality." Early stopping is listed as rare, with the fix "a 'continue' or 'go ahead and do
it end to end' suffices."

The Opus 5 page says the opposite of the persistence-and-verify reflex: "Claude Opus 5 verifies its
own work without being told to. If your prompt contains explicit verification instructions ...
remove them: instructions like these cause over-verification", and "Avoid instructing re-checks it
already performs ('double-check your answer,' 're-verify before responding')"
([platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)).
**Vendor claim.** For a line that has to serve whichever model the user runs, this argues for
"read, grep, run" (gathering) over "double-check" (re-verifying).

### Anthropic, Claude Code docs

Best practices: "Claude stops when the work looks done. Without a check it can run, 'looks done' is
the only signal available ... Give Claude something that produces a pass or fail, and the loop
closes on its own." And: "Have Claude show evidence rather than asserting success: the test output,
the command it ran and what it returned." On CLAUDE.md wording: "keep it short and human-readable",
"Bloated CLAUDE.md files cause Claude to ignore your actual instructions!", and "You can tune
instructions by adding emphasis (e.g., 'IMPORTANT' or 'YOU MUST') to improve adherence"
([code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)). The
memory page: rules without `paths` "are loaded at launch with the same priority as
`.claude/CLAUDE.md`"; "The more specific and concise your instructions, the more consistently
Claude follows them"; "write instructions that are concrete enough to verify"; and "CLAUDE.md
content is delivered as a user message after the system prompt ... there's no guarantee of strict
compliance" ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)). Subagents
receive "every level of the CLAUDE.md hierarchy the main conversation loads, including ... project
rules", except the built-in Explore and Plan agents, which skip it
([code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)). All **vendor
claim**.

One harness fact changes how load-bearing the existing line is. The Edit tool's read-before-edit
check now accepts a Bash `cat`, `head`, `sed -n`, `grep` or `rg` on a single file as the read
([code.claude.com/docs/en/tools-reference](https://code.claude.com/docs/en/tools-reference)), and
none of those attach a `paths` rule. So the harness lets an agent grep its way to a line and edit
it, and the only thing steering it to a Read, which is what loads the area file, is the sentence
already in the overview. **Vendor claim** for the harness behaviour; the injection ceiling is
this repository's own measurement (`README.md` Limits, `docs/how-it-works.md`, `DECISIONS.md` A7).

### OpenAI, "Why Language Models Hallucinate" (Kalai, Nachum, Vempala, Zhang, 2025)

The paper's claim is about incentives, not wording: "language models hallucinate because the
training and evaluation procedures reward guessing over acknowledging uncertainty", and under
binary grading "IDK-type responses are maximally penalized while an overconfident 'best guess' is
optimal" ([arXiv:2509.04664, 2025](https://arxiv.org/abs/2509.04664)). Its one prompt-level
proposal is an explicit confidence target appended to the question: "Answer only if you are > t
confident, since mistakes are penalized t/(1 - t) points, while correct answers receive 1 point,
and an answer of 'I don't know' receives 0 points." Whether current models honour such a target
("behavioral calibration") is left open: "Existing models may or may not exhibit behavioral
calibration." And on tools: "Search (and reasoning) are not panaceas ... the binary grading system
itself still rewards guessing whenever search fails to yield a confident answer." **Measured**
framework, no measured prompt-only effect. The GPT-5 system card shows what moved the needle at
the training level: on SimpleQA (no web) OpenAI o4-mini scores 0.24 accuracy with a 0.75
hallucination rate, gpt-5-thinking-mini 0.22 with 0.26, which the card attributes to "significant
improvement in abstention behavior" ([cdn.openai.com/gpt-5-system-card.pdf, Table 8, 2025](https://cdn.openai.com/gpt-5-system-card.pdf)).
**Measured**, and a training result: the abstention was trained in, not prompted in.

## What one line can and cannot do

**It will be read, and explicit instructions are followed.** The AGENTS.md eval found "instructions
in the context files are well followed by coding agents" and that "context files are useful for
specifying non-standard coding practices"; the same eval found "repository overviews, although
popular and recommended by model providers, are not helpful" for task success and cost over 20%
more ([arXiv:2602.11988, 2026](https://arxiv.org/abs/2602.11988)). The anatomiya overview is an
overview by genre and a rules file by delivery. The new line is an explicit instruction, so it sits
in the followed bucket; the measured "followed" was for coding practices, not for epistemic
behaviour, so transfer is inference. **Measured** for the finding, inference for the transfer.

**Adherence decays within the session no matter how the file is written.** Across 1,650 Claude Code
sessions, none of size, position, architecture, or contradictions moved adherence detectably, and
each additional generated function carried about 5.6% lower odds of compliance
([arXiv:2605.10039, 2026](https://arxiv.org/abs/2605.10039)). A line read at launch is weakest
exactly when the session is long enough for guessing to matter. **Measured.**

**Rules move behaviour, and still leave a quarter non-compliant.** Correcting rules raised
artifact compliance from 49.14% to 72.13% ([arXiv:2606.12231, 2026](https://arxiv.org/abs/2606.12231)).
**Measured.**

**Context-gathering separates success from failure, so steering it is worth a line.** In SWE-bench
trajectories the context-gathering strategy is one of the things that separates successful from
failed runs, and failed runs still found the right file 72-81% of the time
([arXiv:2511.00197, 2025](https://arxiv.org/abs/2511.00197)). **Measured.**

**Delivery has holes the line cannot close.** The overview reaches the main session and custom
subagents at launch (vendor claim above). The path-scoped area files it points at do not reach a
subagent that explores through Bash only: in the 2026-08-16 real-session run on the EF api repo,
the worker's exploration subagents made 54 `cat`/`grep` calls and zero Reads, so no area file
attached in any of them (the maintainer's session note of 2026-08-16, `anatomiya-real-session-test`
in auto memory, local, single session). **Measured** locally. A line saying "read it" is the
cheapest available nudge toward the tool call that does attach them, and nothing more.

**The measured 20% is not this line, not this model, not alone.** OpenAI's number is for three
lines together, on GPT-4.1, in a harness built for it. No first-party page publishes a
Claude-specific number for the same wording, and Anthropic's own pages say the eagerness half of
that bundle now over-triggers. **Measured** with narrow scope.

**The guessing incentive is upstream of the prompt.** Kalai et al. place it in training and
evaluation; the abstention gains in the GPT-5 system card came from training. A line can grant
permission to say "not verified" (Anthropic's advice) and name the tools to use first (both
vendors' advice); it cannot make an unverified claim cost anything. **Measured** framework.

**Fake structure and shouting are not free.** "IMPORTANT"/"YOU MUST" raises adherence per the Claude
Code docs, and the same vendor says aggressive tool language over-triggers on Opus 4.5 and later.
The overview loads on every turn for every model the user might run, so the calmer form is the
safer default. **Vendor claim**, both directions.

## Recommended line

    When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.

23 words, one sentence, no counts, no dates, no task reference. It reads as a rule about the map's
own subject (the code), in the same voice as the existing line. Phrase by phrase:

- "When unsure what this code does": the trigger clause of OpenAI's tool-calling reminder ("If you
  are not sure about file content or codebase structure"), which is the only wording here with a
  measured result behind it, and of Anthropic's `default_to_action` ("If the user's intent is
  unclear ... using tools to discover any missing details"). Conditional, so it does not tell an
  already-eager model to gather more on routine work, which the Fable 5 and Opus 4.x pages warn
  against.
- "read it": OpenAI's "use your tools to read files"; Anthropic's "you MUST read the file before
  answering" and "Never speculate about code you have not opened". In this repository "read"
  also means the Read tool, which is the one call that attaches the sibling `anatomiya-area-*.md`
  files (`docs/how-it-works.md`, `README.md` Limits). It comes first in the list for that reason.
- "grep it, or run it": OpenAI's "gather the relevant information"; Anthropic Claude Code's "Give
  Claude a check it can run: tests, a build" and "show evidence rather than asserting success".
  Naming the three tools the agent already has is the "concrete enough to verify" form the memory
  page asks for, and it covers the maintainer's "digging codes, find a way" without a persistence
  clause.
- "instead of guessing": Anthropic's exact words in `default_to_action`; OpenAI's "do NOT guess or
  make up an answer". Stated once, in the calm register both vendors now recommend.
- "and say what you could not verify": Anthropic's "Allow Claude to say 'I don't know'"; the Fable
  5 wording "if something is not yet verified, say so explicitly", which Anthropic reports nearly
  eliminated fabricated status reports; and the abstention option Kalai et al. say must be on the
  table or guessing dominates. This is the half that turns "no hallucination" from a wish into a
  permitted output.

What it deliberately leaves out: a persistence clause ("keep going until resolved"). That is the
one part of OpenAI's bundle Anthropic now says to dial back on current models, it cannot be scoped
to a task in a file that loads on every turn, and in an interactive session it pushes past the
points where stopping to ask is the right move. It also leaves out "double-check" and "verify your
work", which the Opus 5 page says to remove. Proactivity is carried by naming the actions.

## Alternates

Each is one line, stable, and traceable to the same sources; each trades something.

1. Persistence first (OpenAI-shaped), 25 words:

       Keep going until the task is done; when unsure, read, grep, or run the code instead of guessing, and say what you could not verify.

   Trade-off: carries the one clause with a measured bundle behind it that Anthropic says now
   over-triggers on Opus 4.5 and later; in an interactive session it argues against pausing where a
   pause is right; and it holds two ideas, which the memory page's "one topic per file" advice and
   the GPT-5 guide's warning about instructions the model must reconcile both count against.

2. Anthropic-strict, 23 words:

       Never claim what code does before opening it: read it, grep it, or run the tests, and say what you did not verify.

   Trade-off: closest to `investigate_before_answering` verbatim, and the "Never" register is what
   the same vendor now says to dial back. Names tests explicitly, which is the check most repos
   have and the Claude Code docs favour, at the cost of "run it" for scripts and CLIs.

3. Shortest, 17 words:

       Unsure? Read, grep, or run the code instead of guessing, and say what you could not verify.

   Trade-off: cheapest on every turn; loses the "file content or codebase structure" specificity
   that the measured line carried, and the question opener sits oddly next to the existing
   imperative line.

## Where it goes

`lib/render.mjs`, `renderOverview`, in the `head` array next to the existing "Read a file before
editing it" line (line 301 at the time of writing). The comment above the function states the
constraint: the overview "must be byte-stable between scans with no source change ... So no
timestamp, no duration, no counts that drift" (DECISIONS.md A5). Every candidate above is a
constant string, so it holds. It also has to be one line, because the file is bounded at
`MAX_LINES` (40, A6) and the area listing gets whatever the head and tail leave: adding one head
line takes one line from the area listing on a repository large enough to hit the bound.

Tests. No test in `test/` asserts the existing directive string; `grep -rn "Read a file before
editing" test/` returns nothing. What does touch the overview:

- `test/render.test.mjs`: "the overview is byte-stable across scans of unchanged source" (around
  line 310), the bound tests "a repository with more areas than the overview lists summarises the
  tail" (around 324), "the overview holds the bound when every area states something" (around 902),
  and the worst-case sweep ending in `assert.ok(worst <= MAX_LINES ...)` (around 1011). These
  compute room from `head.length`, so a constant extra line keeps them green; they would need
  updating only if the new line pushed a fixture past the bound, which the sweep would report.
- `test/cli.test.mjs`: "the CLI summary and the overview word an unexamined file the same way"
  (around line 123) and the body-line bound near line 292 (`<= 40`). Same reasoning.
- `test/corpus.test.mjs` around line 807: byte-stability across two real scans (A5). Holds for a
  constant line.
- `README.md` line 119 reproduces the overview verbatim, so the sample there goes stale and should
  carry the new line too. Not a test, and `npm run check:docs` counts numbers rather than reading
  English (`docs/releasing.md`), so it is a by-hand item.

Not edited here; listed so the change can be made in one pass.

## Sources

First-party prompting and product docs:

- [OpenAI, GPT-4.1 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)
- [OpenAI, GPT-5 prompting guide (2025)](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
- [OpenAI, GPT-5 system card, Table 8 SimpleQA (2025)](https://cdn.openai.com/gpt-5-system-card.pdf)
- [Anthropic, Prompting best practices (current; former Claude 4 best practices URL redirects here)](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Anthropic, Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
- [Anthropic, Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)
- [Anthropic, Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [Anthropic, Claude Code best practices (the anthropic.com/engineering URL redirects here)](https://code.claude.com/docs/en/best-practices)
- [Anthropic, Claude Code memory and rules](https://code.claude.com/docs/en/memory)
- [Anthropic, Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Anthropic, Claude Code tools reference (Edit tool read-before-edit)](https://code.claude.com/docs/en/tools-reference)
- [Anthropic, How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)

Papers:

- [Why Language Models Hallucinate (arXiv:2509.04664, 2025)](https://arxiv.org/abs/2509.04664)
- [Evaluating AGENTS.md (arXiv:2602.11988, 2026)](https://arxiv.org/abs/2602.11988)
- [Instruction Adherence factorial study (arXiv:2605.10039, 2026)](https://arxiv.org/abs/2605.10039)
- [Rule Taxonomy and Evolution in AI IDEs (arXiv:2606.12231, 2026)](https://arxiv.org/abs/2606.12231)
- [Understanding Code Agent Behaviour (arXiv:2511.00197, 2025)](https://arxiv.org/abs/2511.00197)

This repository:

- `lib/render.mjs` (`renderOverview`, `MAX_LINES`), `DECISIONS.md` (A5, A6, A7), `docs/how-it-works.md`
  (delivery table and the three rendering constraints), `README.md` (Limits, overview sample),
  `docs/research/why-agents-miss-house-style.md` (failure modes 5, 7, 11, 32-34).
