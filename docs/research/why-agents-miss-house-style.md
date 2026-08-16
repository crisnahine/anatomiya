# Why coding agents miss a repository's house style

Research notes, August 2026. Every claim below is traced to the source that owns it: the paper,
the benchmark's own writeup, or the vendor's first-party page. Each failure mode carries an
evidence label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product
- **folklore**: widely reported by practitioners, not yet measured

## Summary

Agents miss house style for three separable reasons, and the symptoms people complain about are
downstream of all three. First, the convention often never reaches the model: repositories do not
fit in a context window, retrieval misses the sibling files that carry the style, and agents
frequently write before they read. Second, even when the convention is in the window, it loses:
models under-attend distant context, recall degrades with input length and position, and
compliance decays step by step within a session. Third, the model's own priors win: training on
all of GitHub plus instruction tuning and RLHF pushes output toward the majority style, and
instruction tuning measurably weakens the model's ability to let in-context examples override
that prior. The mitigation landscape (repo maps, retrieval, rules files, fine-tuning) maps
one-to-one onto these failures, and the evals of rules files show they fix less than expected:
explicit non-standard rules are followed, repository overviews are not, and adherence decays
regardless of how the file is structured.

## Catalogue of failure modes

### A. The convention never reaches the model

**1. The repository does not fit; the model sees a slice.**
What happens: code depends on types, helpers, and idioms defined in files the model never sees,
so it completes from general knowledge. Why: context windows are finite and repository code is
interdependent; Microsoft's CodePlan paper states the problem directly: "code within a repository
is inter-dependent and the entire repository may be too large to fit into the prompt"
([CodePlan, arXiv:2309.12499, 2023](https://arxiv.org/abs/2309.12499)). Evidence: CrossCodeEval
shows models perform poorly when cross-file context is absent and improve sharply when it is
added ([arXiv:2310.11248, 2023](https://arxiv.org/abs/2310.11248)); CoderEval shows models are
substantially better at standalone functions than at the non-standalone functions that make up
over 70% of functions in real projects ([arXiv:2302.00288, ICSE 2024](https://arxiv.org/abs/2302.00288));
EvoCodeBench measured GPT-4 at 20.73% Pass@1 on repository-level tasks
([arXiv:2404.00599, 2024](https://arxiv.org/abs/2404.00599)). **Measured.**

**2. Retrieval misses the files that carry the convention.**
What happens: the RAG layer feeds the model files that are lexically similar to the query, while
the file that shows "how we do error handling here" is never retrieved. Why: similarity search
does not model conventions; it models text overlap. Evidence: CrossCodeEval found that even the
best retrieval methods leave a large gap to oracle context ([arXiv:2310.11248](https://arxiv.org/abs/2310.11248));
RepoBench treats retrieval as its own failing subtask ([arXiv:2306.03091, ICLR 2024](https://arxiv.org/abs/2306.03091));
Sourcegraph's Cody team published lessons on how hard context retrieval for code is in practice
([arXiv:2408.05344, 2024](https://arxiv.org/abs/2408.05344)). **Measured.**

**3. Retrieved "similar code" can make output worse.**
What happens: the pipeline stuffs look-alike snippets into the prompt and the model imitates the
wrong ones. Why: retrieved snippets are noise when they come from a different layer or an older
idiom. Evidence: an empirical study of retrieval sources found similar-code snippets "often
introduce noise, degrading results by up to 15%", while in-context API information helps
([What to Retrieve for Effective RAG, arXiv:2503.20589, 2025](https://arxiv.org/abs/2503.20589)).
**Measured.**

**4. Completion tools only see what is open.**
What happens: inline completion follows the style of the open tabs, and a convention that lives
in an unopened file is invisible. Why: the prompt is built from the current file plus "neighboring
tabs"; GitHub built that feature precisely because the model otherwise saw only one file, and the
A/B test of neighboring tabs yielded about a 5% lift in suggestion acceptance
([GitHub blog, "How GitHub Copilot is getting better at understanding your code", 2023](https://github.blog/ai-and-ml/github-copilot/how-github-copilot-is-getting-better-at-understanding-your-code/)).
**Vendor claim** (with an internal A/B measurement behind it).

**5. The agent writes before it reads.**
What happens: an agent with file-reading tools still jumps to editing without opening the sibling
files that would show the pattern. Why: nothing in the loop forces exploration; providers
explicitly instruct users to prompt for a read-first phase ("explore, plan, code" in Anthropic's
Claude Code best practices, which exists because the default behavior skips it)
([anthropic.com/engineering/claude-code-best-practices, 2025](https://www.anthropic.com/engineering/claude-code-best-practices)).
A trajectory study of SWE-bench agents found context-gathering strategy is one of the things that
separates successful from failed runs ([arXiv:2511.00197, 2025](https://arxiv.org/abs/2511.00197)).
**Measured** for the trajectory finding; **vendor claim** for the workaround.

**6. The convention is written down nowhere.**
What happens: the house style lives in review comments, old diffs, and one senior maintainer's
head; there is no file to retrieve or read. Why: teams document architecture the least even
though they rate it the most important. Evidence: a mining study of 7,310 rules across 83
projects found rule files skew toward low-level formatting and workflow constraints while
architectural constraints, rated most important by the 99 surveyed practitioners, are largely
absent ([Rule Taxonomy and Evolution in AI IDEs, arXiv:2606.12231, 2026](https://arxiv.org/abs/2606.12231)).
**Measured** (for the documentation gap; the downstream effect on agents is inference).

**7. The instruction file exists but delivery fails.**
What happens: the rules file is present in the repo yet never reaches the model, or reaches it
in a broken form. Why: injection mechanics have sharp edges. This repository's own build contract
records two measured cases: reading a context file with the agent's Read tool permanently
suppresses its automatic injection for that path for the rest of the process, and a mid-session
rewrite of a rules file does not re-attach, with the change notice truncating head and tail
(DECISIONS.md rows A6-A8 in this repository). Glob mishandling can silently drop exclusions
(row A2). **Measured** (locally, single tool).

### B. The convention is in the window but loses

**8. Models under-attend distant context.**
What happens: the convention sits in a cross-file chunk 40K tokens back and the model completes
from the nearby lines instead. Why: pretraining teaches next-token prediction from nearby
context, so attending to long-range cross-file information is out of distribution. The
aiXcoder-7B-v2 authors name this misalignment explicitly and gained up to 19.7% exact match by
training the model to use the long context it was already given
([arXiv:2503.15301, 2025](https://arxiv.org/abs/2503.15301)). **Measured.**

**9. Lost in the middle.**
What happens: information placed mid-prompt is used worse than the same information at the start
or end, so a style guide pasted into the middle of a long prompt underperforms. Evidence: Liu et
al. showed U-shaped position sensitivity on long-context tasks
([Lost in the Middle, arXiv:2307.03172, TACL 2024](https://arxiv.org/abs/2307.03172)). **Measured**
(on retrieval/QA tasks; the transfer to style adherence in code is inference).

**10. Context rot: length alone degrades recall.**
What happens: the longer the session's input grows, the less reliably the model recalls anything
in it, including the rules it was given on turn one. Evidence: Chroma's report tested 18 models
and found non-uniform degradation as input length grows, well before the advertised window limit
([Context Rot, Chroma, July 2025](https://www.trychroma.com/research/context-rot)). Anthropic's
context-engineering post describes the same effect and treats attention as a scarce budget
([anthropic.com/engineering/effective-context-engineering-for-ai-agents, 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
**Measured** (Chroma); **vendor claim** (Anthropic framing).

**11. Compliance decays step by step within a session.**
What happens: the agent follows the rule for the first functions it writes, then drifts. Evidence:
a factorial study across 1,650 Claude Code sessions found none of four file-structure variables
(size, position, architecture, cross-file contradictions) had a detectable effect on adherence,
but each additional generated function carried about 5.6% lower odds of compliance
([Instruction Adherence in Coding Agent Configuration Files, arXiv:2605.10039, 2026](https://arxiv.org/abs/2605.10039)).
**Measured.**

**12. Compaction loses the style constraints.**
What happens: long sessions get summarized to free the window, and the summary keeps task state
(decisions, bugs, recent files) while the stylistic constraints quietly fall out, so post-compaction
output drifts. Why: summarization optimizes for task continuity, and a style rule that was being
obeyed leaves no trace in the transcript to summarize. Evidence: Anthropic describes compaction as
keeping "architectural decisions and unresolved bugs" while discarding redundant output
([effective context engineering, 2025](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents));
the loss of style constraints specifically is **folklore** (widely reported by practitioners of
long agent sessions).

**13. Stale beliefs across a long session.**
What happens: the agent keeps acting on a version of a file it read an hour ago, or on a plan
made before the codebase changed under it, and its output matches a repo state that no longer
exists. Why: nothing invalidates earlier context when the world changes; the transcript is
append-only. **Folklore**, consistent with the measured within-session decay in #11.

### C. The model's priors win

**14. Reversion to the majority GitHub style.**
What happens: the model writes the most common style in its training data instead of the repo's:
snake_case where the repo uses camelCase, its own formatting habits, its own idioms. Evidence:
the code_transformed study measured LLM influence on real-world code style, including the share
of snake_case Python function names rising from 40.7% (Q1 2023) to 49.8% (Q3 2025) and a marked
LLM avoidance of camelCase, digit-suffixed, and single-letter names
([arXiv:2506.12014, 2025](https://arxiv.org/abs/2506.12014)); a taxonomy study of coding-style
inconsistencies between LLM and human code found 24 inconsistency types across five dimensions
(formatting, semantics, expressions/statements, control flow, fault tolerance), with formatting
and statement/expression mismatches the most pronounced
([Beyond Functional Correctness, arXiv:2407.00456, FSE 2025](https://arxiv.org/abs/2407.00456));
a comparative study found human code rated higher than GPT-4 code for adherence to Python coding
standards ([arXiv:2501.16857, 2025](https://arxiv.org/abs/2501.16857)). **Measured.**

**15. Instruction tuning weakens in-context override of priors.**
What happens: showing the model your repo's counter-conventional examples does not flip it. Why:
Wei et al. showed that the ability to override semantic priors with in-context evidence grows
with scale, and that instruction tuning makes models more reluctant to follow in-context
mappings that contradict their priors ([Larger language models do in-context learning
differently, arXiv:2303.03846, 2023](https://arxiv.org/abs/2303.03846)). A repo whose style
contradicts the model's prior is exactly this setup. **Measured** (on label-flipping tasks; the
mapping to code style is inference).

**16. RLHF collapses output toward one canonical style.**
What happens: instruct-tuned models produce tutorial-shaped code: verbose comments, defensive
checks, textbook structure, whatever the reward model liked. Why: RLHF substantially reduces
output diversity, per-input and across-input ([Understanding the Effects of RLHF on LLM
Generalisation and Diversity, arXiv:2310.06452, ICLR 2024](https://arxiv.org/abs/2310.06452)).
A model with collapsed style diversity has less capacity to mirror whatever style it is shown.
**Measured** (on general generation; the code-style consequence is inference).

**17. Memorized solutions instead of repo-fit solutions.**
What happens: on code the model saw during training, it reproduces the remembered fix or idiom
even where the repository has moved on or does things differently. Evidence: the SWE-Bench
Illusion study found models identify buggy file paths from issue text alone at up to 76% on
SWE-bench repos but only up to 53% on repos outside the benchmark, and reproduce function text
much more verbatim on SWE-bench than elsewhere ([arXiv:2506.12286, 2025](https://arxiv.org/abs/2506.12286)).
SWE-Bench Pro was built with held-out and private commercial repos specifically because of this,
and reports far lower solve rates than the same agents post on SWE-bench Verified
([arXiv:2509.16941, 2025](https://arxiv.org/abs/2509.16941)). **Measured.**

**18. Parametric knowledge beats repository fact.**
What happens: the model calls an API that does not exist in the project, or a plausible variant
of one that does, because its trained knowledge of "how this is usually done" overrides what the
repo actually defines. Evidence: the De-Hallucinator authors state LLMs "are mostly unaware of
the code that exists within a specific project" and "often invent, or hallucinate, non-existent
APIs or produce variants of already existing code"; grounding on retrieved project API references
improved API recall by 23.9-61.0% ([arXiv:2401.01701, 2024](https://arxiv.org/abs/2401.01701)).
A taxonomy of code hallucinations includes "knowledge conflicting" and "context inconsistency"
as top-level categories ([arXiv:2404.00971, 2024](https://arxiv.org/abs/2404.00971)). At the
dependency level, models hallucinate package names at measured rates of 5.2% (commercial) to
21.7% (open models) ([We Have a Package for You!, USENIX Security 2025, arXiv:2406.10279](https://arxiv.org/abs/2406.10279)),
narrowing to 4.6-6.1% on the 2026 frontier cohort ([arXiv:2605.17062, 2026](https://arxiv.org/abs/2605.17062)).
**Measured.**

**19. Version drift.**
What happens: the model writes idioms from its training vintage: the old router API, the
deprecated config format, the framework style of two majors ago, regardless of what the repo
pins. Why: parametric knowledge has a cutoff and the most common version in training data wins.
**Folklore** as a distinct mode, though it is the same mechanism as #18 and package-hallucination
studies document fabricated or outdated dependency knowledge.

**20. Sampling nondeterminism.**
What happens: the same prompt yields the repo's style on one run and the model's default style on
the next. Why: sampling. Direct evidence that temperature moves style adherence is absent;
temperature studies measure correctness, where 0.0-1.0 changes have little effect on pass@1
([arXiv:2402.05201, EMNLP Findings 2024](https://arxiv.org/abs/2402.05201)). **Folklore** for the
style effect; measured only for correctness.

### D. Observable symptoms in the output

**21. Reinvented helpers: duplication instead of reuse.**
What happens: the agent writes a new function that already exists under another name instead of
finding and calling the existing one. This is the single most cited symptom. Evidence at industry
scale: GitClear's analysis of 211M changed lines (2020-2024) found 2024 was the first year
copy/pasted lines (12.3%) exceeded moved lines (9.5%), and recorded an 8-fold increase during
2024 in the frequency of code blocks with 5 or more duplicated lines
([GitClear, AI Copilot Code Quality, Feb 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research),
[report PDF](https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf)).
A study of LLM-detected code in real repositories found "substantial intra-repository code
clones" ([arXiv:2607.01867, 2026](https://arxiv.org/abs/2607.01867)). Mechanism: #1/#2 (the
existing helper is not in context) plus #18 (the model produces "variants of already existing
code"). **Measured** (correlational at the industry scale: GitClear measures the era, not each
tool's authorship).

**22. Additive bias: code only grows.**
What happens: agents add code and almost never consolidate, so the repo's abstractions erode.
Evidence: GitClear's moved-lines (refactoring proxy) share fell from 24.1% in 2020 to 9.5% in
2024 while churn rose from 3.1% to 5.7%; Google's DORA 2024 estimated that a 25% increase in AI
adoption maps to a 1.5% drop in delivery throughput and a 7.2% drop in delivery stability
([DORA 2024](https://dora.dev/research/2024/dora-report/), as reproduced in the GitClear report).
**Measured** (correlational).

**23. Naming-convention violations.**
What happens: wrong case, longer names, avoidance of the repo's short conventional names.
Evidence: code_transformed's naming measurements (#14); the style-inconsistency taxonomy's
semantic dimension ([arXiv:2407.00456](https://arxiv.org/abs/2407.00456)). **Measured.**

**24. Formatting drift and ignored lint config.**
What happens: output does not match the repo's formatter or linter settings; agents do not run
the linter unprompted. Evidence: formatting is one of the two worst dimensions in the
style-inconsistency taxonomy ([arXiv:2407.00456](https://arxiv.org/abs/2407.00456)); a large-scale
study of AI-assistant-introduced issues found 484,366 issues across 3,946 repositories with code
smells accounting for 89.3% ([Debt Behind the AI Boom, arXiv:2603.28592, 2026](https://arxiv.org/abs/2603.28592)).
The prevalence of "lint leakage" (duplicating lint rules into agent instruction files, found in
62% of 100 popular repos with AGENTS.md/CLAUDE.md) shows maintainers do not trust agents to
respect the lint config on their own
([Configuration Smells in AGENTS.md Files, arXiv:2606.15828, SCAM 2026](https://arxiv.org/abs/2606.15828)).
**Measured** (violations); **folklore** (the "will not run the linter" behavior itself).

**25. Comment style and density mismatch.**
What happens: over-commenting, narration of the diff, restating the code, docstring essays in a
repo whose files carry almost no comments. Evidence: LLM-detected comments in real repos differ
measurably from human ones ([arXiv:2607.01867, 2026](https://arxiv.org/abs/2607.01867)); the
tutorial-style pressure is #16. The specific "narrates its own change" behavior is **folklore**,
common enough that agent-instruction files routinely ban it.

**26. Error-handling mismatch.**
What happens: blanket try/except, defensive null checks, and swallowed errors in a repo with a
deliberate error-handling scheme; or the opposite, missing the repo's mandatory wrapping.
Evidence: "fault tolerance" is one of the five dimensions of measured LLM-human style
inconsistency ([arXiv:2407.00456](https://arxiv.org/abs/2407.00456)); the SWE-bench trajectory
study observed defensive programming as a distinct agent strategy
([arXiv:2511.00197](https://arxiv.org/abs/2511.00197)). **Measured** (as a divergence class).

**27. Framework-default code instead of the repo's wrappers.**
What happens: the agent calls the framework directly where the repo routes everything through its
own wrapper, logger, client, or result type; the wrong abstraction layer. Mechanism: the wrapper
is project-specific (never in training data) and often not in context, so the prior wins (#18).
Aider's repo map exists precisely to make the model "respect and utilize existing libraries,
modules and abstractions found elsewhere in the codebase"
([aider.chat repo map writeup, 2023](https://aider.chat/2023/10/22/repomap.html)). **Vendor
claim** plus **folklore**; no direct measurement found of wrapper-bypass rates.

**28. Dependencies the repo avoids.**
What happens: the agent adds a library for something the repo does in-house, or a package that
does not exist at all. Evidence: the nonexistent case is measured (#18, package hallucination);
the "adds a real but unwanted dependency" case is **folklore**, common enough that dependency
bans are a recurring rule category in mined rules files ([arXiv:2606.12231](https://arxiv.org/abs/2606.12231)).

**29. Test-pattern mismatch.**
What happens: new tests ignore the repo's fixtures, factories, and assertion style; in the worst
case agents weaken or game tests to pass. Evidence: LLM-generated code appears disproportionately
in test files ([arXiv:2607.01867](https://arxiv.org/abs/2607.01867)); test-weakening is a known
reward-hacking behavior discussed in agent-evaluation work and provider guidance. **Folklore**
for the style mismatch; adjacent behaviors measured in reward-hacking literature.

**30. Architecture and layering violations.**
What happens: imports across module boundaries, business logic in the controller layer, skipped
service objects. Mechanism: architecture is the least-documented convention (#6) and the hardest
to retrieve, since no single file states it. Practitioners rate it the top thing they want
enforced ([arXiv:2606.12231](https://arxiv.org/abs/2606.12231)). **Folklore** for violation
rates; measured only for the documentation gap.

**31. Right file, wrong shape of change.**
What happens: the agent finds the correct place to edit and then writes a change that does not
match how that file does things. Evidence: in failed SWE-bench trajectories agents still
correctly identified the problematic files 72-81% of the time; success hinged on the
modification itself ([arXiv:2511.00197, 2025](https://arxiv.org/abs/2511.00197)). A manual
taxonomy of 150 failed issue-solving runs attributes most agentic failures to flawed reasoning
loops, not to missing the location ([arXiv:2509.13941, 2025](https://arxiv.org/abs/2509.13941)).
**Measured.**

### E. The guidance layer itself fails

**32. Instruction files help less than assumed.**
What happens: teams write AGENTS.md/CLAUDE.md and expect conformant output; the measured effect
is smaller and narrower. Evidence: an evaluation of AGENTS.md files on real tasks found context
files did not improve task success and inflated inference cost by over 20%; agents do follow
explicit instructions, and the files earn their keep only for non-standard practices the model
could not guess; repository overviews in particular did not help
([Evaluating AGENTS.md, arXiv:2602.11988, 2026](https://arxiv.org/abs/2602.11988)). A separate
observational study of 10 repos and 124 PRs found AGENTS.md presence associated with 28.64%
lower median runtime and 16.58% fewer output tokens, with comparable task completion
([arXiv:2601.20404, 2026](https://arxiv.org/abs/2601.20404)). The two do not contradict: the
files change efficiency and specific behaviors, not success or general style absorption.
**Measured.**

**33. Instruction files are misconfigured.**
What happens: the file that should carry the house style is bloated, contradictory, or duplicates
what tools already enforce, and adherence suffers or tokens are wasted. Evidence: six
configuration smells identified across 100 popular repos, with lint leakage at 62% and context
bloat at 42% ([arXiv:2606.15828, SCAM 2026](https://arxiv.org/abs/2606.15828)). Vendors converge
on the same advice: Cursor tells users to keep rules focused and under 500 lines because "large
language models don't retain memory between completions"
([cursor.com/docs/context/rules](https://cursor.com/docs/context/rules)). **Measured** (smell
prevalence); **vendor claim** (the size guidance).

**34. Rules lag the codebase, and compliance tracks rule quality.**
What happens: the rules file drifts out of date, the agent follows the stale rule or none, and
output diverges until a human fixes the file. Evidence: in the rules-mining study, 77.78% of
practitioners who edited rules did so to correct AI errors, and updating rules raised average
artifact compliance from 49.14% to 72.13% ([arXiv:2606.12231, 2026](https://arxiv.org/abs/2606.12231)).
Both numbers cut two ways: rules do move behavior, and even freshly corrected rules leave roughly
a quarter of artifacts non-compliant. **Measured.**

## Measured numbers worth keeping

| Number | What it measures | Source |
|---|---|---|
| >70% | Share of functions in real projects that are non-standalone (depend on project context) | CoderEval, arXiv:2302.00288 |
| 20.73% | GPT-4 Pass@1 on repository-level generation | EvoCodeBench, arXiv:2404.00599 |
| up to 15% | Degradation from retrieving similar-code snippets as context | arXiv:2503.20589 |
| ~5% | Acceptance lift from adding neighboring-tab files to Copilot's prompt | GitHub blog |
| up to 19.7% | Exact-match gain from training a model to use its cross-file context | aiXcoder-7B-v2, arXiv:2503.15301 |
| 76% vs 53% | Buggy-file identification from issue text alone, SWE-bench repos vs unseen repos | SWE-Bench Illusion, arXiv:2506.12286 |
| 5.2-21.7% | Package hallucination rates (commercial vs open models, 2025) | USENIX Sec '25, arXiv:2406.10279 |
| 23.9-61.0% | API-recall improvement from grounding on retrieved project API references | De-Hallucinator, arXiv:2401.01701 |
| 12.3% vs 9.5% | Copy/pasted vs moved lines in 2024 (copy/paste exceeded moved for the first time; moved was 24.1% in 2020) | GitClear 2025 report |
| 8x | Growth during 2024 in frequency of code blocks with 5+ duplicated lines | GitClear 2025 report |
| -1.5% / -7.2% | Estimated delivery throughput / stability change per 25% increase in AI adoption | DORA 2024 |
| 89.3% | Share of AI-introduced issues that are code smells (484,366 issues, 3,946 repos) | arXiv:2603.28592 |
| 40.7% -> 49.8% | snake_case share of new Python function names, Q1 2023 to Q3 2025 | code_transformed, arXiv:2506.12014 |
| ~5.6%/step | Drop in odds of instruction compliance per additional generated function within a session | arXiv:2605.10039 |
| +20% cost, ~0 success | Effect of AGENTS.md context files in a controlled agent eval | arXiv:2602.11988 |
| 62% / 42% | Prevalence of lint leakage / context bloat smells in agent instruction files | arXiv:2606.15828 |
| 49.14% -> 72.13% | Artifact compliance before vs after correcting rules files | arXiv:2606.12231 |
| 77.78% | Rule-file edits motivated by correcting AI errors | arXiv:2606.12231 |
| 30-50% | Accuracy drop observed well before the context limit as input grows | Context Rot, Chroma 2025 |

## Known mitigations, and what each implies about the failure

Each mitigation is a confession: it exists because the failure it targets is real and common.

- **Repo maps** (Aider's tree-sitter map, ranked by references): implies that without a map the
  model neither knows what exists nor reuses it. [aider.chat/2023/10/22/repomap.html](https://aider.chat/2023/10/22/repomap.html). Vendor claim.
- **Neighboring tabs / open-file context** (GitHub Copilot): implies single-file context produced
  style- and API-blind completions. [github.blog](https://github.blog/ai-and-ml/github-copilot/how-github-copilot-is-getting-better-at-understanding-your-code/). Vendor claim with internal A/B.
- **Iterative retrieval** (RepoCoder) and **iterative API grounding** (De-Hallucinator): imply
  that one-shot retrieval misses what the model actually needed; the model's first wrong draft is
  the best query for what it should have seen. arXiv:2303.12570, arXiv:2401.01701. Measured gains.
- **Selective retrieval** (What to Retrieve): implies naive similar-code RAG actively hurts.
  arXiv:2503.20589. Measured.
- **Instruction files** (CLAUDE.md, AGENTS.md, Cursor rules): imply the model cannot infer house
  rules from the code alone and will not remember them between sessions. Their evals (arXiv:2602.11988,
  arXiv:2605.10039, arXiv:2606.12231) bound what they fix: explicit non-standard rules yes,
  general style absorption no, and adherence decays within a session either way.
- **Nested/scoped rules** (Cursor nested AGENTS.md, path-scoped rules): imply one global file
  cannot carry per-directory conventions; conventions are local. [cursor.com/docs](https://cursor.com/docs/context/rules). Vendor claim.
- **Fine-tuning for long-context use** (aiXcoder-7B-v2/COLA): implies the failure to use provided
  cross-file context is a training artifact, fixable at the weights, not only at the prompt.
  arXiv:2503.15301. Measured.
- **Planning frameworks** (CodePlan): imply per-edit prompting cannot keep multi-file changes
  consistent with each other, let alone with the repo. arXiv:2309.12499. Measured against baselines.
- **Context engineering: compaction, note-taking, sub-agents** (Anthropic): implies long sessions
  degrade instruction-following and something must be actively preserved. Vendor claim, consistent
  with Chroma's and the factorial study's measurements.
- **Convention measurement tools** (this repository, plus linters-in-the-loop): imply prose
  descriptions of style are unreliable carriers and counted facts from the repo's own code are
  the alternative being bet on. The ETH finding that only non-standard practices are worth
  stating supports measuring what a repo does differently from the default.

## Sources

Academic papers and benchmarks:

- [CrossCodeEval (arXiv:2310.11248, 2023)](https://arxiv.org/abs/2310.11248)
- [RepoBench (arXiv:2306.03091, 2023)](https://arxiv.org/abs/2306.03091)
- [RepoCoder (arXiv:2303.12570, EMNLP 2023)](https://arxiv.org/abs/2303.12570)
- [CoderEval (arXiv:2302.00288, ICSE 2024)](https://arxiv.org/abs/2302.00288)
- [EvoCodeBench (arXiv:2404.00599, 2024)](https://arxiv.org/abs/2404.00599)
- [DevEval (arXiv:2405.19856, 2024)](https://arxiv.org/abs/2405.19856)
- [CodePlan (arXiv:2309.12499, 2023)](https://arxiv.org/abs/2309.12499)
- [Lost in the Middle (arXiv:2307.03172, TACL 2024)](https://arxiv.org/abs/2307.03172)
- [aiXcoder-7B-v2 (arXiv:2503.15301, 2025)](https://arxiv.org/abs/2503.15301)
- [Larger language models do in-context learning differently (arXiv:2303.03846, 2023)](https://arxiv.org/abs/2303.03846)
- [Effects of RLHF on Generalisation and Diversity (arXiv:2310.06452, ICLR 2024)](https://arxiv.org/abs/2310.06452)
- [The SWE-Bench Illusion (arXiv:2506.12286, 2025)](https://arxiv.org/abs/2506.12286)
- [SWE-Bench Pro (arXiv:2509.16941, 2025)](https://arxiv.org/abs/2509.16941)
- [Understanding Code Agent Behaviour (arXiv:2511.00197, 2025)](https://arxiv.org/abs/2511.00197)
- [Failures in Automated Issue Solving (arXiv:2509.13941, 2025)](https://arxiv.org/abs/2509.13941)
- [Beyond Functional Correctness: Coding Style Inconsistencies (arXiv:2407.00456, FSE 2025)](https://arxiv.org/abs/2407.00456)
- [code_transformed (arXiv:2506.12014, 2025)](https://arxiv.org/abs/2506.12014)
- [Human vs GPT-4 Python coding standards (arXiv:2501.16857, 2025)](https://arxiv.org/abs/2501.16857)
- [Hallucinations in LLM-Powered Code Generation (arXiv:2404.00971, 2024)](https://arxiv.org/abs/2404.00971)
- [De-Hallucinator (arXiv:2401.01701, 2024)](https://arxiv.org/abs/2401.01701)
- [We Have a Package for You! (arXiv:2406.10279, USENIX Security 2025)](https://arxiv.org/abs/2406.10279)
- [Package hallucinations, 2026 cohort (arXiv:2605.17062, 2026)](https://arxiv.org/abs/2605.17062)
- [Debt Behind the AI Boom (arXiv:2603.28592, 2026)](https://arxiv.org/abs/2603.28592)
- [LLM-Generated Code and Comments in Repositories (arXiv:2607.01867, 2026)](https://arxiv.org/abs/2607.01867)
- [What to Retrieve for Effective RAG Code Generation (arXiv:2503.20589, 2025)](https://arxiv.org/abs/2503.20589)
- [AI-assisted Coding with Cody (arXiv:2408.05344, 2024)](https://arxiv.org/abs/2408.05344)
- [Evaluating AGENTS.md (arXiv:2602.11988, 2026)](https://arxiv.org/abs/2602.11988)
- [Impact of AGENTS.md on Efficiency (arXiv:2601.20404, 2026)](https://arxiv.org/abs/2601.20404)
- [Instruction Adherence factorial study (arXiv:2605.10039, 2026)](https://arxiv.org/abs/2605.10039)
- [Configuration Smells in AGENTS.md (arXiv:2606.15828, SCAM 2026)](https://arxiv.org/abs/2606.15828)
- [Rule Taxonomy and Evolution in AI IDEs (arXiv:2606.12231, 2026)](https://arxiv.org/abs/2606.12231)
- [CLAUDE.md mining study (arXiv:2509.14744, 2025)](https://arxiv.org/abs/2509.14744)
- [Sampling temperature and problem solving (arXiv:2402.05201, EMNLP Findings 2024)](https://arxiv.org/abs/2402.05201)
- [Context Utilization in Code Intelligence, survey (arXiv:2504.08734, ACM CSUR)](https://arxiv.org/abs/2504.08734)

Industry and first-party:

- [GitClear, AI Copilot Code Quality (Feb 2025)](https://www.gitclear.com/ai_assistant_code_quality_2025_research) and [report PDF](https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf)
- [GitClear, The Maintainability Gap (2026)](https://www.gitclear.com/the_ai_code_quality_maintainability_gap)
- [Google DORA 2024 report](https://dora.dev/research/2024/dora-report/)
- [Context Rot (Chroma, July 2025)](https://www.trychroma.com/research/context-rot)
- [Anthropic, Claude Code best practices (2025)](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Anthropic, Effective context engineering for AI agents (2025)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Aider, Building a better repository map with tree-sitter (2023)](https://aider.chat/2023/10/22/repomap.html)
- [GitHub, How Copilot is getting better at understanding your code (2023)](https://github.blog/ai-and-ml/github-copilot/how-github-copilot-is-getting-better-at-understanding-your-code/)
- [Cursor rules docs](https://cursor.com/docs/context/rules)
- [AGENTS.md spec](https://agents.md/)
- [Sourcegraph, How Cody understands your codebase (2024)](https://sourcegraph.com/blog/how-cody-understands-your-codebase)

Practitioner writing (folklore tier, but load-bearing for symptom reports):

- [Simon Willison, Vibe engineering (Oct 2025)](https://simonwillison.net/2025/Oct/7/vibe-engineering/)
- [Armin Ronacher, Agentic Coding Recommendations (June 2025)](https://lucumr.pocoo.org/2025/6/12/agentic-coding/)
