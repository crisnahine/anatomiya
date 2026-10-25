# What a claim of effect rests on

Research notes, 2026-10-25. anatomiya is about to be announced, and an announcement invites the
question "does it work?". Three questions decide what may honestly be said and how the front page
should look. First, what measured work says about repository context files (AGENTS.md, CLAUDE.md,
Cursor rules, Copilot instructions) and whether they change what a coding agent writes. Second, how a
with/without A/B of a coding-agent aid has to be run and reported before an engineering audience will
believe it. Third, what GitHub renders in a README, and what widely used developer-tool READMEs put
on the first screen.

Every claim carries its source and one of four labels:

- **measured**: an empirical result with numbers
- **vendor claim**: a first-party statement by a tool maker about its own product
- **doc**: a first-party page quoted with its URL
- **folklore**: widely reported, not measured

Papers were read on arxiv.org (the HTML version where one exists, the PDF otherwise). Statistics
pages were read on NIST's own site. GitHub's docs were read through
`https://docs.github.com/api/article/body?pathname=<page path>`, which returns the article's Markdown.
READMEs were read with `gh api repos/<owner>/<repo>/readme`, raw and as GitHub's rendered HTML. Every
read was on 2026-10-25, and none wrote anything anywhere. Where a source is silent, this note says so.

## Summary

| # | Question | Answer | What it means here |
|---|---|---|---|
| 1 | Do context files change agent output? | On task pass rate, no measured study finds a significant gain from a static file: Gloaguen et al. (p = 0.21 for developer files, p = 0.87 and 0.37 for generated ones) and Khatri (bounded to 10 to 15 pp) both report nulls, while cost rises about 20% in the first. On following what the file says, yes and strongly: tools named in the file get used, a marker annotation goes from 0% to about 68%, and a stale file wins over the code in 90.1% of choices | No paper measures counted conventions with a denominator. anatomiya may claim the agent reads and follows what it delivers, which is measured for files in general. It may not claim better pass rates, or better style conformance, until it measures them itself |
| 2 | How to run a credible A/B? | Pre-register task, scorer and stopping rule; isolate each trial; pair arms on the same task and alternate them; report counts with Wilson intervals and an exact or matched-pairs test; report tokens and time beside the effect. 0.3 vs 0.7 needs 24 to 29 trials per arm, 0.5 vs 0.8 needs 39 to 45, and task variance means more tasks beat more repeats | The repository's own A/Bs ran 10 trials per arm on one famous repository. At that size only a gap of about 0.7 can be told from noise |
| 3 | What does GitHub render, and what goes above the fold? | `<picture>` with `prefers-color-scheme` sources is documented and kept; `align`, `width` and `height` survive the sanitizer in practice but no doc lists them; alerts and Mermaid are documented; `#gh-dark-mode-only` was announced in 2021 and is no longer in the docs; SVG animation inside `<img>` is not addressed by any GitHub page | 7 of 8 READMEs read open with a logo or name, a one-line pitch and badges (codex has no badges); 2 (uv, ruff) put a benchmark chart there with the workload named under it; 4 show a demo image or screenshot; the one speed claim with no method behind it is a bun badge that links to a tweet |

## 1. Do repository context files change what a coding agent writes?

### Evaluating AGENTS.md (arXiv:2602.11988, v3, 29 Sep 2026)

Gloaguen, Mündler-Sasahara, Müller, Raychev and Vechev (ETH Zurich, LogicStar.ai).

- Benchmarks: SWE-bench Lite, "300 tasks sourced from GitHub issues across 11 popular Python
  repositories, none containing developer-provided context files", and a new CTXbench, "138 instances
  from 12 repositories, all containing developer-provided context files" (Section 4.1, Datasets).
- Agents and models: "Claude Code [3] with Sonnet-4.5 [5], Codex [26] with GPT-5.2 and GPT-5.1 mini
  [32], and Qwen Code [28] with Qwen3-30b-coder [34]", temperature 0 except Qwen, and "We sample
  completions for each agent once" (Section 4.1, Coding Agents).
- Arms: no context file, an LLM-generated one made with each agent's own init command, and the
  developer-committed one (Section 4.1, Settings).
- Success measure: "the portion of instances for which the agent produces a patch that leads to all
  tests passing" (Section 4.1, Metrics). Cost is the LLM inference bill in USD.
- **measured** Effect on pass rate, Table 3 (two-sided Cochran-Mantel-Haenszel): None vs LLM p = 0.87
  on SWE-bench and 0.37 on CTXbench, None vs Dev p = 0.21, LLM vs Dev p = 0.038. Section 4.2: "the
  average resolution rate is reduced by 0.5% and 2% on average on SWE-bench and CTXbench" with
  generated files, and developer files "improve agent performance by 2.4% on average (p=21%)".
  Table 5 gives per-model rates with standard errors, for example Sonnet-4.5 on CTXbench 73.2 +/- 3.8
  without a file and 70.3 +/- 3.9 with the developer's file. (Table 5 in v3 labels the CTXbench rows
  "Plan-Bench"; the caption says the table holds SWE-bench and CTXbench.)
- **measured** Cost, Section 4.2: generated files lead "to a significant (p-value < 0.001%) cost
  increase of 20% and 23% on average". Developer files raise cost "at most 19%". Table 6
  (stratified permutation tests) finds every step and cost increase significant.
- **measured** Instructions are followed. Section 4.3: "uv is used 1.6 times per instance on average
  when mentioned in the context files, compared to fewer than 0.01 times when it is not mentioned".
  The paper concludes "the absence of improvements when using context files is not due to a lack of
  instruction-following capabilities".
- **measured** Overviews do not help. Section 4.3: "the context files do not meaningfully reduce
  this metric" (steps until the agent first touches a file the real patch changed), and "We conclude
  that context files are not effective at providing a repository overview." Appendix B, Table 7:
  removing the overview section from GPT-5.2's generated file moves CTXbench accuracy from 68.12% to
  62.32% (p = 0.15), not significant.
- **measured** Redundancy explains part of it. Appendix B: with all documentation removed,
  "LLM-generated context files not only consistently improve performance by 2.7 % on average, but
  also outperform developer-written ones".
- **measured** Contamination checked. Appendix B: splitting CTXbench by each model's knowledge
  cutoff shows "no significant or consistent difference between pre- and post-cutoff instance
  success rates".
- On content, the abstract: "context files are useful for specifying non-standard coding
  practices". The introduction: human-written files "should only include instructions required for
  coding agents that are not already present in the README (e.g., specific conventions or
  non-functional requirements)". That sentence is a recommendation. The paper never scores style or
  convention conformance, so it does not measure it.
- Limitations (Section 5): Python only, and "other aspects of coding agent performance, such as code
  efficiency [14] and security [10]" are left to future work.

### On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents (arXiv:2601.20404, v2)

Lulla et al.

- Setup: "10 repositories and 124 pull requests", one agent, "gpt-5.2-codex", "under two
  conditions: with and without an AGENTS.md file" (abstract; Section 3.1.1). PRs are at most 100
  lines and 5 files, and task text is generated by gpt-oss-120b from the diff (Sections 3.1.3, 3.1.5).
  The design is paired per task.
- Success measure: none. Section 3.1.8 puts an evaluation of output quality, "e.g., the semantic
  correctness or the functional equivalence to the merged PR", "beyond the scope of this paper". A manual sanity check of 50 outputs looked only for "non-empty,
  non-trivial code changes".
- **measured** Table 1 (Wilcoxon signed-rank, p < 0.05 marked): median wall-clock time 98.57 s
  without, 70.34 s with (28.64% lower). Mean output tokens 5,744.81 without, 4,591.46 with (20.08%
  lower). Median total tokens rise 1.29% (223,707 vs 226,582), not marked significant. No intervals
  are given.
- Section 5 says the explanation for the speedup is speculation: "we speculate that some of the
  efficiency gains reported in this paper arise because AGENTS.md files describe repository
  structure and conventions upfront".

### Instruction Adherence in Coding Agent Configuration Files (arXiv:2605.10039, v1, 11 May 2026)

McMillan (HxAI Australia). PDF only.

- Setup (abstract): "1,650 Claude Code CLI sessions (16,050 function-level observations) on two
  TypeScript codebases, three frontier models (primarily Sonnet 4.6 ...)" and five tasks. Four
  manipulated variables: file size 25 to 500 lines, instruction position, file architecture, and a
  conflicting instruction. 50 runs per condition (Section 6).
- Success measure: compliance with one instruction, a `// @tracked` comment as each function's first
  line, detected by AST (Section 6: "an annotation-insertion rate").
- **measured** Structure does not matter here. Abstract: "None of the four structural variables or
  three two-way interactions in the design produces a detectable contrast after multiple-testing
  correction." Size and conflict nulls have "BF10 between 0.05 and 0.10".
- **measured** The file itself matters a great deal. Section 4.3: the no-file baseline "produced 0
  compliant functions out of 524 across 50 runs (ICR = 0.0%; Wilson 95% upper bound 0.73%)", against
  67.7% with the file (n = 529), "Cohen's |h| = 1.93".
- **measured** Compliance falls within a session. Section 4.6: "OR = 0.944, 95% Wald CI [0.937,
  0.951]" per extra function generated. The abstract says it "was identified during analysis rather
  than pre-specified", and the slope is "non-monotonic rather than a constant per-step effect".
- **measured** Task matters more than structure. Table 4: ICR 45.1% on T4 (modify existing code) and
  71.3% on T5 (write new code), "the largest within-codebase contrast in the data".
- Limitations (Section 6): single-turn `--print` mode only, one trivial marker, "the absolute ICR
  values are not portable to other markers", and other agents are not covered.

### Stale Instruction Files Override the Code in Coding Agents (arXiv:2610.30571, v1, Oct 2026)

Xu and Wu. The closest measured work to what anatomiya does, because it sets a written convention
against the convention the code already uses.

- Setup (Section 4): 40 synthetic Python projects with 3 to 8 modules each, 16 kinds of convention
  choice (print vs logging and the like), each kind in both directions. "Claude Code 2.1.302 with
  Claude Sonnet 5.5 and Codex CLI 0.163.0 with GPT-6 Sol", 2 runs per project, agent and condition,
  "giving 320 runs". A script classifies each choice. The conflict-judge criterion "was fixed before
  the first run" (Section 10).
- **measured** Section 5.1: "Without the sentence, 90.1% of choices (649 of 720) matched the stale
  file and 4.2% matched the existing code." Section 5.2: Claude Code "named the conflict in its final
  reply in 79 of 80 runs, and in those runs 86.2% of its choices still matched the file".
- **measured** Section 5.3: with one user-level sentence giving existing code precedence, "91.4% of
  choices (658 of 720) matched the existing code, 87.2 percentage points more than without it (95%
  interval 83.6 to 90.9, from resamples of projects)".
- **measured** Section 5.4: without the sentence Codex CLI rewrote existing code in 20 of 80 runs,
  and the project's own tests "failed in 17 of the 20 runs". Section 5.5: tests passed in 89.4% of
  runs without the sentence and in all 160 with it.
- Scope (Section 8): synthetic projects, Python only, single unattended runs, two agents.

### Guardrails Beat Guidance (arXiv:2604.11088, v2)

Zhang, Wang, Cui et al.

- Setup: "679 rule files (25,532 rules)" scraped from GitHub, "over 5,000 agent runs of Claude Code
  with Claude Opus 4.6 on SWE-bench Verified" (abstract). Tasks were screened to 58 "discriminative"
  ones "solved 1 or 2 out of 3 times, i.e., 30-70% baseline pass rate" (Section 5, Experimental
  Setup).
  Total API cost "approximately $2,000".
- Success measure: SWE-bench Verified pass.
- **measured** Every rule condition beats the 50.0% no-rule baseline "by 6.9-13.8pp, yet no
  condition is significantly different from any other (Cochran's Q=4.70, p=0.697)". "No individual
  McNemar comparison reaches p<0.05 at n=58; the headline rests on direction, not magnitude." Random
  rules match curated rules (both 63.8%, Figure 1).
- **measured** Table 1, per-rule ablation on 35 tasks: "Follow code style" is classed as distorting
  (removal helps, p = .180). Only "No unrelated refactor" is individually significant (p = .016), and
  the authors say it "would not survive a strict multiple-comparison correction".
- Limitations: "our McNemar tests detect ~15pp paired effects". The measure is pass rate, so "follow
  code style" hurting means it cost passes. Nothing here scores whether style was followed.

### Do Context Files Help Coding Agents? (arXiv:2607.27250, v1)

Khatri.

- Setup: Claude Code (claude-sonnet-4-6) and Codex CLI (gpt-5.5), "17 real tasks from 3
  repositories", three injection strategies (none, always-on, retrieved on demand), 3 repeats, "288
  evaluated runs with gold-test evaluation" (abstract; Section 3.4).
- **measured** Table 1: Claude 53.3% (24/45) with no context and 55.6% (25/45) always-on; Codex 58.8%
  (30/51) and 56.9% (29/51). Omnibus permutation p = 1.000 and 0.66. TOST bounds every pairwise
  difference "to < 10pp for Claude and < 15pp for Codex", which the author calls "not a powered
  equivalence claim given n=15-17 clusters" (Section 4.1).
- **measured** One process effect survives (Section 4.2): on the one repository whose AGENTS.md warns
  the full suite takes over 20 minutes, Claude's blind full-suite runs fall "none 3.67 -> always_on
  2.44 -> selective 1.67", reported as exploratory.
- Section 5.1 gives the reason for the null: "agents fail on implementation skill ... not missing
  repository knowledge that a context file could supply".

### Other 2025 to 2026 work that measures conformance

- **measured** SWE-CC (arXiv:2610.06193, Truong et al.): 823 machine-checkable policies from the
  documentation of 12 repositories, 500 tasks from SWE-bench Verified, four LLMs under two scaffolds.
  Abstract: agents "still violate 43.1% of applicable project policies". Section 1: with the policies
  placed in context in advance, "agents gain an 8.75% compliance rate on average". Section 4: language
  and framework style policies see the highest native compliance, which "changes minimally when
  guidelines are provided (+1.7%)", because "pre-trained models naturally adopt idiomatic code
  formatting". That is a measured hint that generic style is already in the model and
  repository-specific rules are where a file can add something.
- **measured** ContextCov (arXiv:2603.00822, Sharma): on SWE-bench Lite (300 tasks), compiling
  AGENTS.md rules into executable checks reaches "88.3% constraint compliance (vs. 67.0% and 50.3%)"
  for prompt-only and reflection baselines (abstract). No intervals in the abstract.
- **measured** Probe-and-refine (arXiv:2606.20512, Shepard and Albrecht): guidance tuned by probes
  reaches "33.0% mean resolve rate vs. 28.3% for the static knowledge base ... and 25.5% for an
  unguided baseline (p < 0.001 for both probe-and-refine contrasts)" with one open model, and "the
  improvement comes from coverage rather than precision" (abstract).
- **measured** Instructions-as-Code (arXiv:2606.13449, Arabat and Sayagh): observational, 15,549
  agentic PRs in 148 projects, before and after an instruction file. "27.7% of the projects increased
  their merge rate by at least 20%, while 26.35% decreased it" (abstract). No control arm.
- **measured** Learning to Commit (arXiv:2603.26664) scores "code-style consistency" on future PRs of
  one repository, but the abstract gives no number.

### Where no measured work exists

No paper found measures a file of counted conventions (a count with a denominator per directory)
against a file of prose rules, or against no file, on whether new code matches the repository's own
majority. The nearest are SWE-CC (prose policies, checked by function), McMillan (one artificial
marker) and Xu and Wu (one convention per choice, synthetic projects). No paper measures
convention conformance on a non-Python, non-TypeScript repository. No paper measures a multi-turn
session where the rules reload when a file is opened, which is how anatomiya delivers its area files.

## 2. How to run and report a with/without A/B

### How many trials per arm

- **doc** NIST/SEMATECH e-Handbook, 7.2.4.2 "Sample sizes required",
  https://www.itl.nist.gov/div898/handbook/prc/section2/prc242.htm, gives the one-sample form "the
  normal approximation is used for this derivation". The two-sample form below is the standard
  extension with a pooled variance under the null hypothesis.
- **measured** (computed for this note, Python standard library, alpha 0.05 two-sided, power 0.8):

  | Pass rates | Normal approximation | With continuity correction | Fisher's exact, smallest n with power >= 0.8 |
  |---|---|---|---|
  | 0.3 vs 0.7 | 24 per arm | 29 per arm | 29 per arm (power 0.814) |
  | 0.5 vs 0.8 | 39 per arm | 45 per arm | 44 per arm (power 0.802) |

  At the normal-approximation size, Fisher's exact test has power 0.75 (0.3 vs 0.7, n = 24) and
  0.73 (0.5 vs 0.8, n = 39), so plan on the exact column when Fisher is the test. Power was
  computed by enumerating every outcome of two binomials and summing those where the two-sided
  Fisher p-value (sum of tables no more likely than the observed one) is at most 0.05.
- **measured** Khatri, Section 4.5, gives the agent-specific lesson: at 17 tasks and 3 repeats "even
  a large Delta=30 pp effect is caught only 57% of the time", "Detecting Delta=10 pp at 80% power
  requires ~120-200 tasks", and "Task-level variance dominates: scaling requires more tasks, not more
  repeats."
- **doc** Miller, "Adding Error Bars to Evals" (arXiv:2411.00640, Anthropic), Section 5: if the
  number of questions is fixed, "consumers can calculate the Minimum Detectable Effect and decide
  whether the eval is worth running."

### Which test and which interval

- **doc** NIST e-Handbook 7.2.4.1 "Confidence intervals",
  https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm: the Wilson method is "recommended
  by Brown, Cai and DasGupta (2001) and Agresti and Coull (1998)", "recommended by Agresti and Coull
  for virtually all combinations of n and p", and "the lower limit cannot be negative. That is not
  true for the confidence expression most frequently used". Worked here: 7 of 10 gives a Wilson 95%
  interval of 0.40 to 0.89, and 0 of 50 gives 0.00 to 0.07.
- **doc** NIST e-Handbook 7.3.3,
  https://www.itl.nist.gov/div898/handbook/prc/section3/prc33.htm: "The Fisher Exact Probability Test
  is an excellent nonparametric technique for analyzing discrete data ... when the two independent
  samples are small in size." The page's own procedure is one-tailed and says that for a two-tailed
  test the p-value "must be doubled", so a report should say which two-sided rule it used.
- When both arms run the same tasks, the arms are paired, and an unmatched-pairs test throws that away.
  **doc** Miller, Section 4.2: "We therefore recommend using the paired version of the standard error
  estimate wherever practicable", and the conclusion asks reports to "include pairwise differences,
  pairwise standard errors, and score correlations". Section 2.2: when items come in groups (several
  trials of one task, several tasks from one repository), "clustered standard errors can be over 3X
  larger than naive standard errors" (Table 4). The papers above use matched-pairs tests: Cochran-Mantel-
  Haenszel stratified by instance (Gloaguen, Table 3), McNemar (Zhang, Table 1; Gloaguen, Table 7),
  Wilcoxon signed-rank (Lulla, Table 1), a task-clustered bootstrap (Khatri, Section 3.6), and a
  project-resampled interval (Xu and Wu, Section 5.3).
- A null needs its own test. Khatri, Section 2: "Traditional null-hypothesis testing cannot confirm
  the absence of an effect", hence TOST. McMillan backs two of four nulls with Bayes factors and calls
  the other two "failures to reject without Bayes-factor support".

### Order, isolation and pairing

- **doc** NIST e-Handbook 5.7, Glossary of DOE terminology,
  https://www.itl.nist.gov/div898/handbook/pri/section7/pri7.htm: randomization is "A schedule for
  allocating treatment material and for conducting treatment combinations in a DOE such that the
  conditions in one run neither depend on the conditions of the previous run nor predict the
  conditions in the subsequent runs", and "Randomization is necessary for conclusions drawn from the
  experiment to be correct, unambiguous and defensible." For an agent this means the arms interleave
  (A, B, B, A, or a seeded shuffle) so that a rate limit, a cache warming up, an API incident or a
  model rollout on one afternoon lands on both arms, not on one.
- **vendor claim** Anthropic, "Demystifying evals for AI agents" (2026-01-09),
  https://www.anthropic.com/research/demystifying-evals-for-ai-agents, Step 4: "Each trial should be
  "isolated" by starting from a clean environment." and "in some internal evals we observed Claude
  gaining an unfair advantage on some tasks by examining the git history from previous trials." Step
  6: "we do not take eval scores at face value until someone digs into the details of the eval and
  reads some transcripts."
- **measured** McMillan, Section 6: "Claude Code does not expose a sampling seed, so repeated runs of
  the same condition and task produce different outputs", and cache locations under `~/.claude/`
  "were not exhaustively audited". Xu and Wu, Section 10, give each condition its own config directory
  and strip vendor environment variables before each run.
- **measured** Task choice decides whether an effect can show. Zhang: "47% of tasks are always solved
  and 27% never solved regardless of rules, contributing no statistical signal." Khatri, Section 4.3:
  for about 40% of tasks "the agent that would reveal a context effect is not the same agent", so
  screen tasks per agent. This repository's own vscode A/B
  (`docs/measurements/2026-08-16-vscode.md`) hit the same wall: both arms wrote conforming code every
  time, and the note says "A task that cannot separate the arms cannot measure them."

### Pre-registration

- **measured** The one pre-registered study in this area, arXiv:2609.23270 (Dhuri), abstract: "We
  pre-registered hypotheses, refuters, analysis code, and a one-shot generation rule", ran 50 tasks
  through five models "each task twice: bare, and preceded by a 267-word filled specification frame",
  and published "All 500 outputs, prompts, checkers, scoring code, and the pre-registration". Xu and
  Wu fixed the judge's criterion "before the first run".
- The cautionary case is McMillan's largest effect, which the author flags as found during analysis.
  Khatri marks its one surviving process effect as exploratory "rather than the pre-registered
  efficiency-metric family". Both are honest, and both show why a finding found after the fact
  should be reported as a lead for the next run, not as the result.
- What to fix in writing before the first trial: the task text, the repository and commit, the scorer
  (a script, with its version), the arms and the injection method, trials per arm and the stopping
  rule, the test, and what counts as a failed run.

### Contamination

- **doc** SWE-bench (arXiv:2310.06770), Appendix A.1: the benchmark "can simply be updated to produce new
  task instances based on PRs created after any LM's training date", and Table 7 (Section 5) splits
  results "before or after 2023".
- **measured** SWE-rebench (arXiv:2505.20411), Section 1: SWE-bench "has been public since late 2023.
  Models released afterward may have been exposed to its data during training, risking inflated scores
  and confounding generalization with memorization." Its leaderboard marks evaluations "that include
  issues created before a model's release date".
- **measured** Gloaguen's limitations (Section 5): Python's tooling and repository specifics "might be
  present in the models' parametric knowledge, nullifying the effect of context files".
- For an aid that delivers a repository's conventions, contamination works against the aid: if the
  model already knows how microsoft/vscode writes code, the no-map arm already has the map. A famous
  repository makes a null more likely, not less. Two answers: a repository or commit newer than the
  model's cutoff, or a less known repository; and a check of the no-map arm's baseline first (if it
  already conforms near 100%, the task has no room to show an effect).

### Cost beside effect

- **measured** Every context-file study reports cost or time, because the effect can be all cost.
  Gloaguen, Table 2: Sonnet-4.5 on SWE-bench costs $1.30 +/- 0.07 per instance with no file and
  $1.51 +/- 0.08 with a generated one. Lulla reports only tokens and time.
- **vendor claim** Anthropic, "Demystifying evals for AI agents": "latency, token usage, cost per task,
  and error rates can be tracked on a static bank of tasks."
- **measured** Khatri, Section 4.4: Codex "emits exactly 1 turn.completed event per session regardless
  of work performed", so turn counts do not compare across agents. Tool calls, wall time and output
  tokens do.

## 3. What GitHub renders in a README, and what goes above the fold

### What the docs say

- **doc** Basic writing and formatting syntax,
  https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax,
  under "The Picture element": "The `<picture>` HTML element is supported." Under "Images": "GitHub
  supports embedding images into your issues, pull requests, discussions, comments and `.md` files",
  and the page's own example image is an `.svg`.
- **doc** Quickstart for writing on GitHub,
  https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github,
  "Adding an image to suit your visitors": "By using the HTML `<picture>` element with the
  `prefers-color-scheme` media feature, you can add an image that changes depending on whether a
  visitor is using light or dark mode." Its example uses `<source media="(prefers-color-scheme:
  dark)" srcset=...>`, a `light` source, and an `<img>` fallback "in case neither of the other images
  can be matched".
- **doc** `#gh-dark-mode-only`: GitHub Changelog, 2021-11-24,
  https://github.blog/changelog/2021-11-24-specify-theme-context-for-images-in-markdown/: "Appending
  #gh-dark-mode-only or #gh-light-mode-only to the end of an image url will define whether it's only
  shown to viewers using a light or a dark GitHub theme." The 2022-05-19 changelog,
  https://github.blog/changelog/2022-05-19-specify-theme-context-for-images-in-markdown-ga/,
  announces the `<picture>` form. Neither page deprecates the fragment, but no current GitHub Docs
  page mentions it (searched in `github/docs`, which holds only the `<picture>` example). Status:
  undocumented now, not announced as removed. Use `<picture>`.
- **doc** Alerts, same page, under "Alerts": "Five types of alerts are available": `[!NOTE]`,
  `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`. Also: "limit them to one or two per article"
  and "Alerts cannot be nested within other elements."
- **doc** Creating diagrams,
  https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams:
  "You can create diagrams in Markdown using four different syntaxes: mermaid, geoJSON, topoJSON, and
  ASCII STL. Diagram rendering is available in GitHub Issues, GitHub Discussions, pull requests,
  wikis, and Markdown files." The page warns: "You may observe errors if you run a third-party
  Mermaid plugin when using Mermaid syntax on GitHub."
- **doc** Allowed tags and attributes: no GitHub Docs page lists them. The `github/markup` README,
  https://github.com/github/markup, says the HTML is sanitized, "aggressively removing things that
  could harm you and your kin", and names "`script` tags, inline-styles, and `class` or `id`
  attributes". It also says "`markup` itself does no sanitization", so the real list lives in
  GitHub's pipeline, which is not published.
- **measured** What survives, from GitHub's own rendered HTML of four READMEs: `<p align="center">`,
  `<div align="center">`, `<picture align="center">`, `<source media="(prefers-color-scheme: dark)"
  srcset=...>`, `<img ... width="700">` (biome) and `<img height="20" ...>` (bun) all come back
  intact. External image URLs come back rewritten to `camo.githubusercontent.com`.
- **doc** About anonymized URLs,
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls:
  "To host your images, GitHub uses the open-source project Camo", and an image that does not show
  should be checked against "the list of types supported by Camo". That list
  (`atmos/camo`, `mime-types.json`, archived) includes `image/svg+xml` and `image/gif`.
- SVG animation inside `<img>`: no GitHub page addresses it. **doc** The W3C SVG Integration draft
  (First Public Working Draft, 17 April 2014), https://www.w3.org/TR/svg-integration/, Section 3.4
  "Secure animated mode", is for "an SVG document ... used as an animated image that is not allowed
  to resolve external references", with script execution "no" and declarative animation "yes". So
  SMIL and CSS `@keyframes` inside an SVG are meant to play when loaded as an image, and scripts and
  external fonts or images are not. That is browser behaviour, not a GitHub promise, and it was not
  checked in a browser for this note. **folklore**: animated SVG headers play on github.com.

### What eight READMEs put on the first screen

Read with `gh api repos/<repo>/readme` on 2026-10-25, default branch. Star counts from the same API.

| Repository (stars) | Logo or title | One-line pitch | Badges | Demo image | Install command | Benchmark chart |
|---|---|---|---|---|---|---|
| astral-sh/uv (91k) | `# uv` | "An extremely fast Python package and project manager, written in Rust." | 3 | no | below the fold | yes, `<picture>` light/dark |
| astral-sh/ruff (50k) | `# Ruff` | "An extremely fast Python linter and code formatter, written in Rust." | 6 | no | below the fold | yes, `<picture>` light/dark SVG |
| biomejs/biome (26k) | `<picture>` banner, `width="700"` | "Biome is a performant toolchain for web projects" | 5 | no | below the fold | no, links to a benchmark repo |
| oven-sh/bun (96k) | logo plus `<h1 align="center">` | "Bun is an all-in-one toolkit for JavaScript and TypeScript apps." | 3 | no | commands in the first screen | no |
| anthropics/claude-code (153k) | `# Claude Code` | "Claude Code is an agentic coding tool that lives in your terminal" | 2 | `demo.gif` | yes, right after the GIF | no |
| openai/codex (131k) | bold name in the pitch | "Codex CLI is a coding agent from OpenAI that runs locally on your computer." | 0 | splash PNG, `width="80%"` | yes, the Quickstart | no |
| anomalyco/opencode (221k; `sst/opencode` redirects here) | `<picture>` logo light/dark | "The open source AI coding agent." | 3 | screenshot after 22 language links | yes, after the screenshot | no |
| charmbracelet/crush (29k) | `# Crush` plus logo | "Your new coding bestie, now available in your favourite terminal." | 2 | demo image, `width="800"` | below a feature list | no |

How the two benchmark headlines cite themselves:

- uv: the chart's caption, directly under it, is "Installing Trio's dependencies with a warm cache."
  The first claim in Highlights, "10-100x faster than `pip`", links to `BENCHMARKS.md` in the
  repository. The image's alt text is "Shows a bar chart with benchmark results."
- ruff: the caption is "Linting the CPython codebase from scratch." The first bullet, "10-100x faster
  than existing linters (like Flake8) and formatters (like Black)", has no link on that line.
- biome links "fast formatter" and "performant linter" to `github.com/biomejs/benchmark` sections,
  and "97% compatibility with Prettier" to the challenge that defined it.
- bun carries a badge reading "speed: fast" that links to a tweet. That badge is the one claim of
  speed in the eight with no method behind it.

So the pattern among the two tools that lead with a number is: a chart, and the exact workload in
one line under it. uv also puts the method one link away; ruff does not, on that screen.

## What this means for anatomiya

What it may claim, on the evidence above:

- That agents follow what a context file says. Measured three ways: tools named get used (Gloaguen),
  a marker goes from 0% to about 68% (McMillan), a file wins over the code in 90.1% of choices (Xu and
  Wu).
- That what it delivers is counted from the repository's own code. That is a design fact, and it is
  the one Xu and Wu make matter: a file that disagrees with the code wins. A map that is recounted
  from the code cannot drift the way a hand-written file does, as long as the user rescans.
- Not that it raises pass rates. Two controlled studies find no significant pass-rate gain from a
  static file, and the one positive result (Zhang) is equal for random rules.
- Not that it improves style conformance, until it measures that with a pre-registered A/B. No paper
  measures counted conventions. The repository's own A/Bs are 10 trials per arm on one famous
  repository, which at alpha 0.05 and power 0.8 can only tell apart a gap of about 0.7 (0.1 vs 0.8, Fisher
  exact, computed as in Section 2).

How the README should look, on the evidence above:

- First screen: the name, one plain sentence of what it does, few badges, and one example of what
  it writes (the overview lines already in the README) before any install command.
- A light/dark image goes in `<picture>` with `prefers-color-scheme` sources, not the
  `#gh-dark-mode-only` fragment.
- If an SVG is used, keep it self-contained (no external fonts or images), and do not depend on its
  animation, which GitHub does not document.
- One alert at most. A Mermaid diagram renders if one helps.
- A number in the headline only with the workload under it and the method one link away, the way uv
  does it.

## Sources

Papers:

- [Gloaguen et al., Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents? (arXiv:2602.11988, v3, 2026)](https://arxiv.org/abs/2602.11988)
- [Lulla et al., On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents (arXiv:2601.20404, v2, 2026)](https://arxiv.org/abs/2601.20404)
- [McMillan, Instruction Adherence in Coding Agent Configuration Files: A Factorial Study of Four File-Structure Variables (arXiv:2605.10039, 2026)](https://arxiv.org/abs/2605.10039)
- [Xu and Wu, Stale Instruction Files Override the Code in Coding Agents: A One-Sentence Fix (arXiv:2610.30571, 2026)](https://arxiv.org/abs/2610.30571)
- [Zhang et al., Guardrails Beat Guidance: A Large-Scale Study of Rules, Skills, and Persistent Configuration for Coding Agents (arXiv:2604.11088, v2, 2026)](https://arxiv.org/abs/2604.11088)
- [Khatri, Do Context Files Help Coding Agents? A Two-Agent Ablation Study on Real Repositories (arXiv:2607.27250, 2026)](https://arxiv.org/abs/2607.27250)
- [Truong et al., SWE-CC: Benchmarking Repository Policy Compliance for Coding Agents (arXiv:2610.06193, 2026)](https://arxiv.org/abs/2610.06193)
- [Sharma, ContextCov: Deriving and Enforcing Executable Constraints from Agent Instruction Files (arXiv:2603.00822, v2, 2026)](https://arxiv.org/abs/2603.00822)
- [Shepard and Albrecht, Probe-and-Refine Tuning of Repository Guidance for Coding Agents (arXiv:2606.20512, v2, 2026)](https://arxiv.org/abs/2606.20512)
- [Arabat and Sayagh, Toward Instructions-as-Code (arXiv:2606.13449, 2026)](https://arxiv.org/abs/2606.13449)
- [Li et al., Learning to Commit: Generating Organic Pull Requests via Online Repository Memory (arXiv:2603.26664, 2026)](https://arxiv.org/abs/2603.26664)
- [Dhuri, Specification Before Generation: A Pre-Registered, Five-Model Paired Evaluation (arXiv:2609.23270, v2, 2026)](https://arxiv.org/abs/2609.23270)
- [Miller, Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations (arXiv:2411.00640, 2024)](https://arxiv.org/abs/2411.00640)
- [Jimenez et al., SWE-bench: Can Language Models Resolve Real-world GitHub Issues? (arXiv:2310.06770)](https://arxiv.org/abs/2310.06770)
- [Badertdinov et al., SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation (arXiv:2505.20411, 2025)](https://arxiv.org/abs/2505.20411)

Statistics references:

- [NIST/SEMATECH e-Handbook 7.2.4.1, Confidence intervals (Wilson)](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
- [NIST/SEMATECH e-Handbook 7.2.4.2, Sample sizes required](https://www.itl.nist.gov/div898/handbook/prc/section2/prc242.htm)
- [NIST/SEMATECH e-Handbook 7.3.3, Two proportions and the Fisher exact test](https://www.itl.nist.gov/div898/handbook/prc/section3/prc33.htm)
- [NIST/SEMATECH e-Handbook 5.7, Glossary of DOE terminology (randomization)](https://www.itl.nist.gov/div898/handbook/pri/section7/pri7.htm)

Vendor guidance:

- [Anthropic, Demystifying evals for AI agents (2026-01-09)](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)

GitHub and web standards:

- [GitHub Docs, Basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
- [GitHub Docs, Quickstart for writing on GitHub](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github)
- [GitHub Docs, Creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)
- [GitHub Docs, About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)
- [GitHub Changelog, Specify theme context for images in Markdown (2021-11-24)](https://github.blog/changelog/2021-11-24-specify-theme-context-for-images-in-markdown/)
- [GitHub Changelog, Specify theme context for images in Markdown, GA (2022-05-19)](https://github.blog/changelog/2022-05-19-specify-theme-context-for-images-in-markdown-ga/)
- [github/markup README](https://github.com/github/markup)
- [atmos/camo mime-types.json](https://github.com/atmos/camo/blob/master/mime-types.json)
- [W3C, SVG Integration, First Public Working Draft (2014)](https://www.w3.org/TR/svg-integration/)

READMEs read:

- [astral-sh/uv](https://github.com/astral-sh/uv), [astral-sh/ruff](https://github.com/astral-sh/ruff),
  [biomejs/biome](https://github.com/biomejs/biome), [oven-sh/bun](https://github.com/oven-sh/bun),
  [anthropics/claude-code](https://github.com/anthropics/claude-code),
  [openai/codex](https://github.com/openai/codex),
  [anomalyco/opencode](https://github.com/anomalyco/opencode),
  [charmbracelet/crush](https://github.com/charmbracelet/crush)

This repository:

- `docs/measurements/2026-08-16-vscode.md`, `2026-08-16-vscode-nonnull-2.md` and
  `2026-08-16-vscode-symbols.md` (10 trials per arm each), `README.md` (the first screen today).
