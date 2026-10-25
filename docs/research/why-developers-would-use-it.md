# Why a developer would use it, and why one would not

Research notes, 2026-10-25. anatomiya scans a repository and writes per-directory rule files that
Claude Code (and Cursor and Copilot) load; it adds a notice before a new file that breaks a
ship-together habit or test placement, an end-of-turn search for an existing function the new code
duplicates, a background refresh, and a `check` that reports what a branch broke against its merge
base without blocking anything. This note asks why developers would adopt a tool like that, and what
would make them drop it. Five questions: what primary surveys say about AI coding tools, what
maintainers say about AI-written pull requests, what makes developer tools spread, which other tools
give an agent repository context, and what follows for anatomiya.

What anatomiya does was read from `plugins/anatomiya/hooks/hooks.json` (SessionStart and FileChanged
refresh, UserPromptSubmit and PostToolUse echo, PreToolUse notice on Write, Edit and NotebookEdit,
Stop runs `reuse`), `plugins/anatomiya/lib/targets.mjs` (`.cursor/rules/*.mdc` with `globs:`,
`.github/instructions/*.instructions.md` with `applyTo:`) and `plugins/anatomiya/bin/anatomiya.mjs`.
The repository's own on/off numbers are from `docs/measurements/2026-10-25-plugin-on-off.md` and
`docs/measurements/2026-10-25-mastodon-reuse-and-i18n-opus-5-5.md`.

Every claim carries its source and one of four labels:

- **measured**: an empirical result with numbers
- **vendor claim**: a first-party statement by a tool maker about its own product
- **doc**: a first-party page quoted with its URL
- **folklore**: widely reported, not measured

Surveys were read on the publishers' own pages. Papers were read on arxiv.org (HTML where it exists,
the abstract page otherwise). Project policies were read as raw files from the projects' own
repositories. Tool docs were read on each vendor's docs site, READMEs with `gh api`. Every read was on
2026-10-25 and none wrote anything anywhere. Where a source is silent, this note says so.

## Summary

| # | Question | Answer | What it means here |
|---|---|---|---|
| 1 | What do developers say about AI coding tools? | Use is near universal (Stack Overflow: 47.1% daily; JetBrains: 85% regularly; DORA: 90% at work) but trust is low: 3.1% "highly trust" output, 45.7% distrust it, 30% of DORA respondents have little or no trust in AI code. The top frustration is "almost right, but not quite" at 66%. JetBrains lists "lack of context awareness" and "limited understanding of complex code" among the top five concerns. DORA names AI-accessible internal data as one of seven capabilities that amplify AI | The pain anatomiya targets is the one developers name most. No survey asks about house conventions by that name, so the link from "almost right" to "does not match this codebase" is an inference |
| 2 | What do maintainers say about AI pull requests? | Agent PRs merge less often than human ones (AIDev-pop: 76.8% human against 38.2% to 65.3% per agent), and the reasons are mostly duplicates, CI failures and silence, not style. Style and formatting is 10.3% of inline review comments on agent PRs; agent PRs show 1.87 times the redundancy of human PRs. Project policies (LLVM, curl, Ghostty, the Linux kernel) all put the review burden on the human and say AI code must meet the normal coding standards | A tool that makes agent code look like the codebase answers a real, measured complaint (redundancy) and a stated policy (follow our standards). It does not answer the larger rejection reasons (duplicates, CI, abandonment) |
| 3 | What makes developer tools spread? | Measured: security or privacy concerns are the number 1 reason developers drop a tool, prohibitive pricing number 2; an easy API is the number 1 reason they become fans. Google's static-analysis work: tools must sit in the workflow, stay under about 10% effective false positives, and prove impact with data. Zero config as a cause of spread is a stated philosophy (Prettier), not a measurement. Speed as a cause is folklore with a strong vendor anecdote (ruff) | Local-only, no config, low noise and a printed denominator line up with the measured items. Cost per session is the measured weak point |
| 4 | What else gives an agent repository context? | Hand-written or model-written instruction files (CLAUDE.md `/init`, Cursor rules, Copilot instructions, AGENTS.md generators), retrieval over an index (aider repo map, Augment, Greptile), memories learned from chat (Windsurf/Devin, CodeRabbit learnings) | anatomiya is the one that counts conventions from the code and git history with a threshold and a denominator, and writes the result into the files the other tools already read. Most others either ask a model to describe the code or retrieve code at question time |
| 5 | Reasons and objections | See section 5 | The single strongest reason is a measured 209 of 280 against 53 of 280 sessions reusing an existing helper; the single strongest objection is the measured 1.4 to 3.8 times cost per session with no change in five of eleven tasks |

## 1. What developers say about AI coding tools

### Stack Overflow Developer Survey 2025, AI section

From https://survey.stackoverflow.co/2025/ai.

- **measured** Use: "Do you currently use AI tools in your development process?" Daily 47.1%,
  weekly 17.7%, monthly or less 13.7%, no but plan to 5.3%, no and do not plan to 16.2%.
  Professional developers: 50.6% daily.
- **measured** Favorability: very favorable 22.9% and favorable 36.8% (about 60%), unfavorable
  10.8%, very unfavorable 9.6%.
- **measured** Trust: "How much do you trust the accuracy of the output from AI tools as part of
  your development workflow?" Highly trust 3.1%, somewhat trust 29.6%, somewhat distrust 26.1%,
  highly distrust 19.6%. For experienced developers the chart gives highly trust 2.5% and highly
  distrust 20.7%; the page text gives 2.6% and 20%, so the page disagrees with itself.
- **measured** Frustrations (select all): "AI solutions that are almost right, but not quite" 66%;
  "Debugging AI-generated code is more time-consuming" 45.2%; "It's hard to understand how or why
  the code works" 16.3%.
- **measured** Agents: 14.1% use AI agents daily, 9% weekly, 37.9% do not plan to. Among
  statements about agents, 57.1% strongly agree and 29.8% somewhat agree with the accuracy concern,
  56.1% and 25.3% with the security and privacy concern.
- **measured** People stay in the loop: "When I don't trust AI's answers" is the top reason to still
  ask a person (75.3%); 4.3% say they will not need help from people.
- The page has no item worded as "lack of codebase context". The nearest is the workflow row
  "Learning about a codebase", where 39.4% do not plan to use AI.

### JetBrains State of Developer Ecosystem 2025

From the JetBrains Research post
https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/ (24,534 developers,
April to June 2025, per https://devecosystem-2025.jetbrains.com/). The report's own AI page renders
its percentages as images, so only the post's numbers are quoted.

- **measured** "85% of developers regularly use AI tools for coding and development, and 62% rely
  on at least one AI coding assistant, agent, or code editor."
- **measured** "Nearly nine out of ten developers save at least an hour every week, and one in five
  saves eight hours or more."
- **measured** The top five concerns, unranked by share in the post: "The inconsistent quality of
  AI-generated code", "AI tools' limited understanding of complex code and logic", "Privacy and
  security risks", "The potential negative impact on their own coding and development skills", "AI's
  lack of context awareness". The post gives no percentage for any of them.
- Developers want to delegate boilerplate and documentation, and "prefer to stay in charge of
  creative and complex tasks, like debugging or designing application logic".

### GitHub Octoverse 2025

From https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/.

- **measured** "nearly 80% of new developers on GitHub use GitHub Copilot within their first week."
- **measured** Copilot coding agent created "1+ million pull requests" between May and September
  2025. The post gives no merged count.
- **vendor claim** "72.6% of developers who use Copilot code review said it improved their
  effectiveness", with no sample size given.
- The post calls its AI numbers "observational signals rather than causal claims". It does not
  mention AGENTS.md or instruction files, and makes no statement about trust.

### Google DORA 2025

From https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report and
https://dora.dev/capabilities/.

- **measured** "90% of survey respondents report using AI at work." "More than 80% believe it has
  increased their productivity." "30% report little or no trust in the code generated by AI."
- **measured** AI adoption now has "a positive relationship" with delivery throughput, and "does
  continue to have a negative relationship with software delivery stability". The blog gives no
  effect sizes.
- **doc** The DORA AI Capabilities Model's seven capabilities, as tagged on dora.dev: AI-accessible
  internal data, clear and communicated AI stance, healthy data ecosystems, platform engineering,
  user-centric focus, version control, working in small batches.
- **measured** On AI-accessible internal data (https://dora.dev/capabilities/ai-accessible-internal-data/):
  "giving teams AI tools that can access internal data directly amplifies the positive impact of AI
  adoption", "serving as a statistically significant multiplier for individual effectiveness and
  code quality". The page does not give the coefficient.
- **doc** The headline framing: "AI doesn't fix a team; it amplifies what's already there."

### A vendor survey on context

Qodo, 2025 State of AI Code Quality, https://www.qodo.ai/reports/state-of-ai-code-quality/, 609
developers. Qodo sells an AI review tool, so the numbers are a vendor's survey.

- **vendor claim** 65% say AI "misses relevant context" during refactoring, about 60% during test
  generation and review.
- **vendor claim** Developers who get inconsistent output are 1.5 times more likely to name "code not
  in line with team standards" as a top frustration.

### Reading across the four

The "almost right" number (66%) and "lack of context awareness" are the two items closest to what
anatomiya addresses. Neither survey connects them to house conventions in so many words; that
connection is this note's inference. Trust is the constraint every survey agrees on: 3.1% highly
trust, 30% little or no trust, and the main reason to ask a person is distrust of the AI answer. A
tool that adds model output on top (the end-of-turn reuse subagent) will be read through that lens.

## 2. What maintainers and reviewers say about AI-written pull requests

### Project policies

- **doc** LLVM, `llvm/docs/AIToolPolicy.md`
  (https://github.com/llvm/llvm-project/blob/main/llvm/docs/AIToolPolicy.md): "there must be a
  human in the loop"; "Contributors must read and review all LLM-generated code or text before they
  ask other project members"; contributors should "label contributions that contain substantial
  amounts of tool-generated content". It names "extractive contributions", where review costs more
  than the change is worth: "a contribution should be worth more to the project than the time it
  takes to review it."
- **doc** curl, `docs/CONTRIBUTE.md` (https://github.com/curl/curl/blob/master/docs/CONTRIBUTE.md):
  "A basic rule of thumb is that if someone can spot that the contribution was made with the help of
  AI, you have more work to do." And: "We can accept code written with the help of AI into the
  project, but the code must still follow coding standards, be written clearly, be documented,
  feature test cases and adhere to all the normal requirements we have."
- **doc** Ghostty, `AI_POLICY.md` (https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md):
  all AI use must be disclosed; "The human-in-the-loop must fully understand all code"; low-effort
  work "puts the burden of validation on the maintainer". It also says "Ghostty is written with
  plenty of AI assistance" and the policy is "not due to an anti-AI stance".
- **doc** Linux kernel, `Documentation/process/coding-assistants.rst`
  (https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst): AI
  tools "should follow the standard kernel development process", listing `coding-style.rst` first
  among the documents; "AI agents MUST NOT add Signed-off-by tags"; the human takes "full
  responsibility for the contribution".
- **doc** QEMU, `docs/devel/code-provenance.rst`
  (https://github.com/qemu/qemu/blob/master/docs/devel/code-provenance.rst): the project will
  "DECLINE any contributions which are believed to include or derive from AI generated content",
  because "the copyright and license status of the output is ill-defined". The reason is legal, not
  quality, and no context tool changes it.

The shared line is that AI code is held to the project's normal standards and the human carries the
review. curl's "if someone can spot that the contribution was made with the help of AI" is the
clearest statement of the bar anatomiya aims at.

### Measured studies of agent pull requests

- **measured** Li, Zhang and Hassan, The Rise of AI Teammates in SE 3.0 (arXiv:2507.15003, v1, July
  2025). AIDev holds 456,535 agent PRs from 61,453 repositories. On AIDev-pop (repositories over 500
  stars, 7,122 agent PRs) Table 5 gives acceptance of 76.8% for humans against 65.3% Codex, 52.5%
  Claude Code, 51.4% Cursor, 48.9% Devin, 38.2% Copilot. The paper's own text gives 64% and 35% for
  Codex and Copilot, so table and text disagree. The abstract: agent PRs are "accepted less
  frequently" and "structurally simpler".
- **measured** Ehsani et al., Where Do AI Coding Agents Fail? (arXiv:2601.15195, v1, Jan 2026, MSR
  '26). Of 33,596 agent PRs in AIDev-pop, 71.48% merged (Codex 82.59%, Cursor 65.22%, Claude Code
  59.04%, Devin 53.76%, Copilot 43.04%). Of 562 rejected PRs categorized: reviewer abandonment 38%,
  duplicate PRs 23%, CI or test failure 17%, unwanted features 4%, incorrect implementation 3%. Each
  extra failed CI check cut the odds of merge by about 15%. "Misalignment" (1%) means ignoring a
  reviewer's instruction, not repository style.
- **measured** Nakashima et al., Why Agentic-PRs Get Rejected (arXiv:2602.04226, v1, Feb 2026). In
  their sample 69.0% of rejected agent PRs and 62.4% of human ones carry no clear reviewer feedback.
  Seven reasons occur only for agent PRs, each 1.5% or less, including "No confidence in
  AI-generated code" (0.2%) and "Too large" (1.5%). Style or convention is not a category.
- **measured** Haider and Zimmermann, Understanding Dominant Themes in Reviewing Agentic AI-authored
  Code (arXiv:2601.19287, v1, Jan 2026, MSR '26). Over 19,007 inline comments on 3,162 agent PRs:
  feature and implementation 38.5% of comments, refactoring and simplification 14%, documentation
  11.4%, styling and formatting 10.3% ("readability and consistency"), reverts 10%.
- **measured** Huang et al., More Code, Less Reuse (arXiv:2601.21276, Jan 2026, MSR 2026). Over 3,858
  PRs in Python repositories above 500 stars: "LLM Agents frequently disregard code reuse
  opportunities". The worst-case similarity of a new function to an existing one averages 0.2867
  for agents and 0.1532 for humans, about 1.87 times (Mann-Whitney p < 0.001). Reviewers "tend to
  express more neutral or positive emotions towards AI-generated contributions", so "the
  surface-level plausibility of AI code masks redundancy".
- **measured** Takerngsaksiri, Duong and Barnett, Who Finishes the Job? (arXiv:2609.26847, v2, Sep
  2026). Over 6,774 merged agent PRs against 5,044 human PRs from the same repositories, merged
  agent PRs draw verified follow-up fixes at 1.62 times the odds of human ones.
- **measured** Lin et al., Is Agentic Code Review Helpful? (arXiv:2607.03316, v2, Jul 2026). Of
  31,073 CodeRabbit review comments across 239 repositories, 36.4% were accepted, 7.3% led to
  discussion and 56.3% were rejected, mainly as false positives, redundant, out of scope, or
  misaligned "with developer intent and coding practices".

### What this says about conventions

Style and convention are a real but minor share of what reviewers say about agent code (10.3% of
inline comments) and are not a named reason for rejection in either rejection taxonomy. The larger
measured problem that matches anatomiya is redundancy: agents write a new function where one exists,
and reviewers do not notice (Huang et al.). The mastodon `compareUrls` result is that exact case.
The largest rejection reasons (abandonment, duplicate PRs, CI failures) are outside anything a
context tool touches.

## 3. What makes developer tools spread

### Measured

- **measured** Stack Overflow 2025, Work section
  (https://survey.stackoverflow.co/2025/work#4-how-you-lose-interest-in-tech-tools), ranked by about
  34,000 respondents. Reasons to drop a tool: 1 security or privacy concerns, 2 prohibitive pricing,
  3 better alternatives, 4 poor usability, 5 inefficient or time-costly; "Lack of AI or AI agents"
  ranks 9 of 10. Reasons to become a fan: 1 easy-to-use API, 2 complete API, 3 reputation for quality, 4 reliability and low latency, 5 manageable costs, 6
  connected to an open-source project; "AI integration or AI Agent capabilities" ranks 9.
- **measured** Johnson, Song, Murphy-Hill and Bowdidge, Why Don't Software Developers Use Static
  Analysis Tools to Find Bugs? (ICSE 2013, https://research.google/pubs/pub43477/). Twenty
  developer interviews; all thought the tools useful, and false positives and the way warnings are
  shown were among the barriers.
- **measured** and **doc** Sadowski et al., Lessons from Building Static Analysis Tools at Google
  (CACM 61(4), 2018, https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/).
  - Reasons engineers ignore tools: "Not integrated", "takes too long to run", "Not actionable",
    "Not trustworthy", "Not manifest in practice", "Too expensive to fix", "Warnings not
    understood".
  - The FindBugs dashboard "saw little use because a bug dashboard was outside the developers'
    usual workflow". In a 2009 fixit, 16% of 3,954 reviewed warnings were fixed.
  - Code-review checks must "Produce less than 10% effective false positives". Tricorder disables an
    analyzer when the "Not useful" share passes 10%. A footnote says the 10% figure "was initially
    chosen by the first author somewhat arbitrarily".
  - "Developers, not tool authors, will determine and act on a tool's perceived false-positive
    rate." "Engineers working on static analysis must demonstrate impact through hard data." "If a
    tool wastes developer time with false positives and low-priority issues, developers will lose
    faith and ignore results."
  - Per-user customization "caused discrepancies within and across teams and resulted in declining
    use of tools", so Tricorder allows configuration only per project.
- **measured** Lin et al. (above): 56.3% of an AI reviewer's comments were rejected. That is the
  noise level a new AI-flavoured reviewer is compared with.

### Stated by tool makers

- **doc** Zero config. Prettier's option philosophy
  (https://github.com/prettier/prettier/blob/main/docs/option-philosophy.md): "By far the biggest
  reason for adopting Prettier is to stop all the ongoing debates over styles", and "The debates over
  styles just turn into debates over which Prettier options to use." This is the maintainers'
  account of why it spread, not a measurement.
- **vendor claim** Speed and drop-in parity. ruff's README
  (https://github.com/astral-sh/ruff) leads with "10-100x faster than existing linters" over a chart
  captioned "Linting the CPython codebase from scratch", and "Drop-in parity with Flake8, isort, and
  Black". The README does not attribute adoption to speed.
- **vendor claim** Works with existing files. https://agents.md/ says AGENTS.md is used by "over 60k
  open-source projects" and lists more than 20 tools that read it.

### Folklore

- "Developers adopt the fastest tool." Widely repeated around ruff and uv; no source read here
  measures speed as the cause of adoption. The measured nearby items are "Reliability and low
  latency" (rank 4 of reasons to be a fan) and "Inefficient or time-costly" (rank 5 of reasons to
  drop).
- "Zero config wins." The Prettier statement is the maintainers' reasoning. The measured near
  neighbour is "Poor usability" at rank 4 of reasons to drop.
- "A demo or benchmark on the README drives adoption." Common practice (see the README survey in
  `what-proof-of-effect-rests-on.md`); no measured source read here.

## 4. Tools that give a coding agent repository context

Each line is from the tool's own docs or README. Differences are stated against anatomiya as read from
its code.

- **Claude Code `/init` and CLAUDE.md** (https://code.claude.com/docs/en/memory). `/init` has
  "Claude analyzes your codebase and creates a file with build commands, test instructions, and
  project conventions it discovers". Path-scoped `.claude/rules/` files "load only when Claude works
  with matching files". The docs advise "target under 200 lines per CLAUDE.md file". Difference: a
  model writes `/init`'s file once and a person maintains it; anatomiya writes `.claude/rules/` files
  by counting, states each claim with its denominator, and refreshes on checkout, pull and commit.
- **Cursor rules** (https://cursor.com/docs/context/rules). `.mdc` files in `.cursor/rules` with
  four modes (Always Apply, Apply Intelligently, Apply to Specific Files, Apply Manually) and
  `globs`; `/create-rule` makes a rule from a description; AGENTS.md is read in root and
  subdirectories. Difference: Cursor provides the container and a model-written rule from a
  description; anatomiya fills the same container (`.cursor/rules/*.mdc` with `globs:`) from counts.
- **GitHub Copilot custom instructions**
  (https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).
  `.github/copilot-instructions.md`, path-specific `.github/instructions/*.instructions.md` with
  `applyTo`, AGENTS.md, CLAUDE.md or GEMINI.md; "you can ask Copilot cloud agent to generate one for
  you"; instructions are used by Copilot code review by default. Difference: as with Cursor,
  anatomiya writes into this format from counts. Copilot's review reads the instructions; anatomiya's
  `check` is a local report.
- **aider repo map** (https://aider.chat/docs/repomap.html). "a concise map of your whole git
  repository" with key symbols, chosen by "a graph ranking algorithm" over file dependencies, sized
  by `--map-tokens` (default 1k). Difference: aider ranks what exists for the current chat; it does
  not state habits, test placement or co-change.
- **Augment Code Context Engine** (https://www.augmentcode.com/context-engine). **vendor claim**
  "Augment semantically indexes and maps your code", including commit history and "How your team
  actually builds, so agents reuse instead of reinvent", and claims 33% lower spend than Claude Code
  on Terminal Bench 2.0. The page does not say where indexing runs. Difference: retrieval at question
  time from an index; anatomiya writes static, reviewable files and runs no service.
- **Sourcegraph Cody and Amp**
  (https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans,
  https://ampcode.com/docs/customize/agents-md). Cody Free and Pro ended on July 23, 2025 with Amp as
  the stated successor. Amp "offers to generate an `AGENTS.md` file for you if none exists", loads
  subtree AGENTS.md files when the agent reads a file there, and supports `globs`. Difference: a
  model-generated file; anatomiya's is counted.
- **Windsurf memories, now Devin Desktop** (https://docs.devin.ai/desktop/cascade/memories). Cascade
  "can automatically generate and store memories"; they are "not committed to your repository" and
  "apply to the legacy Cascade agent only". Rules live in `.devin/rules` or `.windsurf/rules`, and
  AGENTS.md goes through the same engine. Difference: memories are learned from chat and kept per
  workspace; anatomiya derives facts from the code and commits nothing on its own.
- **CodeRabbit learnings** (https://docs.coderabbit.ai/knowledge-base/learnings). Learnings are made
  from natural-language feedback in PR comments, scoped to a repository or organization, and used
  "as additional context or instructions" for later review comments. Difference: a hosted reviewer
  learning from what people say; anatomiya counts what the code does and runs before review.
- **Greptile** (https://www.greptile.com/docs/introduction). "builds a complete graph of your
  codebase", reviews every PR "with full context", learns from reactions and replies, and can be
  self-hosted. Difference: a PR reviewer with its own index; anatomiya's `check` is a local diff
  report that blocks nothing.
- **Open-source AGENTS.md generators, 2026.** GenerateAgents.md
  (https://github.com/originalankur/GenerateAgents.md, MIT, 258 stars) runs an LLM over the tree with
  "Git history-based anti-pattern deduction" and needs a provider API key. agentsmith
  (https://github.com/jpoindexter/agentsmith, MIT) "scans your codebase" and writes AGENTS.md with
  counts of components, hooks and tokens. agents-md-generator
  (https://github.com/nushey/agents-md-generator, MIT) is an MCP server that parses with tree-sitter
  and hands the analysis to the client model to write the file. Difference: these produce one file
  per run; none of their READMEs describes a threshold, a denominator, per-directory files, hooks or a
  branch check.

What is distinctive about anatomiya in this list, stated as fact rather than ranking: counting with a
stated denominator and a Wilson bound; dropping habits the model already follows to counts; git
co-change; writing into all three formats at once; a hook before the write and a search after the
turn; and no network of its own outside `setup`. What others have that anatomiya does not: semantic
retrieval across repositories (Augment, Greptile), learning from reviewer feedback (CodeRabbit,
Greptile), hosted PR review (Copilot, CodeRabbit, Greptile), and editors and agents of their own.

## 5. Reasons to choose it, and objections

### Five reasons

1. **It stops the agent rewriting a helper that exists.** Over seven tasks in six repositories,
   three of them picked by a rule fixed in advance, 209 of 280 sessions with the plugin called the
   helper the repository already had, and 53 of 280 without it did
   (`docs/measurements/2026-10-26-blind-replication.md`); in mastodon, Opus 5.5 called `compareUrls` in 20 of 20 sessions with the
   plugin and 0 of 20 without (`docs/measurements/2026-10-25-plugin-on-off.md`). This is the redundancy Huang
   et al. measured at 1.87 times human levels and reviewers did not catch.
2. **It answers "almost right" with this repository's own facts.** 66% of developers name "almost
   right, but not quite" as a frustration (Stack Overflow 2025) and JetBrains lists lack of context
   awareness in the top five concerns. DORA measures internal data access as a multiplier for code
   quality. anatomiya delivers per-directory facts where Claude Code loads them.
3. **It stays on the machine.** Security or privacy is the number 1 reason developers drop a tool
   (Stack Overflow 2025, Work), and about 81% of respondents agree with a security and privacy concern about AI agents. The scan,
   hooks and `check` send nothing; only `setup` reaches npm. The reuse search is a Claude Code
   subagent, so it goes wherever the session already goes.
4. **It is built to be quiet and to show its denominator.** Google's rule of under 10% effective
   false positives and "demonstrate impact through hard data" (Sadowski et al.), against an AI
   reviewer whose comments were rejected 56.3% of the time (Lin et al.). anatomiya states a habit
   only at 0.90 with a Wilson bound, prints counts, and turns already-followed habits into counts.
   `check` blocks nothing.
5. **It fills the files the other tools already read.** AGENTS.md is in over 60k projects (vendor
   claim) and Cursor, Copilot and Claude Code each read their own rule format. anatomiya writes
   `.claude/rules`, `.cursor/rules/*.mdc` and `.github/instructions/*.instructions.md` from one scan,
   which matches "Easy-to-use API" at rank 1 of reasons to be a fan.

### Five objections

1. **It costs more, and changed nothing in five of eleven tasks.** Median cost per session rose 1.4 to 3.8
   times across eleven tasks on two models, and in five of them the model did the same with or without
   the plugin (`docs/measurements/2026-10-25-plugin-on-off.md` and the blind replication). Prohibitive pricing is the number 2
   reason to drop a tool (Stack Overflow 2025). The run does not separate the map's cost from the
   end-of-turn reuse subagent's.
2. **Context files do not move pass rates in published work.** Gloaguen et al. found no significant
   gain from context files on task success, with cost up about 20%; see
   `what-proof-of-effect-rests-on.md`. A skeptic will ask why this file is different, and the
   repository's own evidence is the four reuse tasks, three of them chosen after the first had shown
   it.
3. **Conventions are not what gets agent PRs rejected.** Abandonment (38%), duplicates (23%) and CI
   failures (17%) lead (Ehsani et al.); style is 10.3% of review comments (Haider and Zimmermann).
   A team whose pain is review volume or CI will not see that pain shrink.
4. **The model is getting it right already.** In four of eight measured tasks both models followed
   the convention with or without the plugin. Frontier models improve every release, so the gap
   the tool fills may narrow. The plugin itself already turns such habits into counts.
5. **It is more machinery to trust in a low-trust setting.** Only 3.1% highly trust AI output (Stack
   Overflow 2025). The plugin adds hooks on seven Claude Code events, a background refresh, generated files in three
   tool formats, and a subagent that reads each turn's new code. Per Sadowski et al., one wrong
   notice costs trust faster than many right ones earn it, and the stale-file study in
   `what-proof-of-effect-rests-on.md` shows a stale written convention beats the code in 90.1% of
   choices, so a map that falls behind does harm, not just nothing.

## What could not be read

- The JetBrains report's AI page shows its percentages as images, so the concern shares are missing;
  only the research post's ordered list is quoted.
- The full DORA 2025 report and AI Capabilities Model report (PDFs behind a Google Cloud form) were
  not read; the numbers above are from the Google Cloud blog and dora.dev pages.
- Gentoo's AI policy page returned HTTP 500.
- Augment's docs page for the Context Engine returned 404; its marketing page was read instead and
  does not say where indexing runs.
- No primary source was found that measures speed, zero config or a README demo as a cause of
  developer-tool adoption.

## Sources

Surveys:

- [Stack Overflow Developer Survey 2025, AI](https://survey.stackoverflow.co/2025/ai)
- [Stack Overflow Developer Survey 2025, Work (technology purchases)](https://survey.stackoverflow.co/2025/work#4-how-you-lose-interest-in-tech-tools)
- [JetBrains Research, The State of Developer Ecosystem 2025 (2025-10)](https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/)
- [JetBrains, State of Developer Ecosystem 2025 report](https://devecosystem-2025.jetbrains.com/)
- [GitHub, Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)
- [Google Cloud, Announcing the 2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
- [DORA, Capabilities](https://dora.dev/capabilities/)
- [DORA, AI-accessible internal data](https://dora.dev/capabilities/ai-accessible-internal-data/)
- [Qodo, 2025 State of AI Code Quality](https://www.qodo.ai/reports/state-of-ai-code-quality/)

Papers:

- [Li, Zhang and Hassan, The Rise of AI Teammates in Software Engineering 3.0 (arXiv:2507.15003, 2025)](https://arxiv.org/abs/2507.15003)
- [Ehsani et al., Where Do AI Coding Agents Fail? (arXiv:2601.15195, 2026)](https://arxiv.org/abs/2601.15195)
- [Nakashima et al., Why Agentic-PRs Get Rejected (arXiv:2602.04226, 2026)](https://arxiv.org/abs/2602.04226)
- [Haider and Zimmermann, Understanding Dominant Themes in Reviewing Agentic AI-authored Code (arXiv:2601.19287, 2026)](https://arxiv.org/abs/2601.19287)
- [Huang et al., More Code, Less Reuse (arXiv:2601.21276, 2026)](https://arxiv.org/abs/2601.21276)
- [Takerngsaksiri, Duong and Barnett, Who Finishes the Job? (arXiv:2609.26847, 2026)](https://arxiv.org/abs/2609.26847)
- [Lin et al., Is Agentic Code Review Helpful? (arXiv:2607.03316, 2026)](https://arxiv.org/abs/2607.03316)
- [Johnson et al., Why Don't Software Developers Use Static Analysis Tools to Find Bugs? (ICSE 2013)](https://research.google/pubs/pub43477/)
- [Sadowski et al., Lessons from Building Static Analysis Tools at Google (CACM 2018)](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/)

Project policies:

- [LLVM, AI Tool Use Policy](https://github.com/llvm/llvm-project/blob/main/llvm/docs/AIToolPolicy.md)
- [curl, CONTRIBUTE.md](https://github.com/curl/curl/blob/master/docs/CONTRIBUTE.md)
- [Ghostty, AI_POLICY.md](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md)
- [Linux kernel, AI Coding Assistants](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst)
- [QEMU, Code provenance](https://github.com/qemu/qemu/blob/master/docs/devel/code-provenance.rst)

Tools:

- [Claude Code, How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Cursor, Rules](https://cursor.com/docs/context/rules)
- [GitHub, Adding repository custom instructions for Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [aider, Repository map](https://aider.chat/docs/repomap.html)
- [Augment Code, Context Engine](https://www.augmentcode.com/context-engine)
- [Sourcegraph, Changes to Cody Free, Pro and Enterprise Starter plans](https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans)
- [Amp, AGENTS.md](https://ampcode.com/docs/customize/agents-md)
- [Devin Desktop (formerly Windsurf), Cascade memories](https://docs.devin.ai/desktop/cascade/memories)
- [CodeRabbit, Learnings](https://docs.coderabbit.ai/knowledge-base/learnings)
- [Greptile, Introduction](https://www.greptile.com/docs/introduction)
- [AGENTS.md](https://agents.md/)
- [GenerateAgents.md](https://github.com/originalankur/GenerateAgents.md)
- [agentsmith](https://github.com/jpoindexter/agentsmith)
- [agents-md-generator](https://github.com/nushey/agents-md-generator)
- [Prettier, Option Philosophy](https://github.com/prettier/prettier/blob/main/docs/option-philosophy.md)
- [ruff README](https://github.com/astral-sh/ruff)
