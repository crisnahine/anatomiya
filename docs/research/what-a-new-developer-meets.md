# What a new developer meets

Research notes, 2026-10-25. anatomiya exists because a developer who joins a new company wants his
coding agent to write in the repository's house style from day one, and finds that neither he nor
the agent knows that style yet. Four questions decide what the README may say about that. First,
what measured research says slows a developer who is new to a codebase. Second, how much of code
review is about conventions, maintainability and fit rather than defects. Third, whether a
newcomer's changes draw more review on style, or take longer to land. Fourth, what coding-agent
vendors say about repository context, and what studies of agent-written pull requests measure.

Every claim carries its source and one of four labels:

- **measured**: an empirical result with numbers
- **vendor claim**: a first-party statement by a tool maker about its own product
- **doc**: a first-party page quoted with its URL
- **folklore**: widely reported, not measured

Papers were read in full from the copy the authors or their institution host (arXiv, the author's
or the lab's own site, a university repository), and through the Internet Archive where the host
refused the connection. The Claude Code docs were read as Markdown from `code.claude.com`. GitHub's
docs were read through `https://docs.github.com/api/article/body?pathname=<page path>`. Every read
was on 2026-10-25, and none wrote anything anywhere. Where a source is silent, this note says so.

## Summary

| # | Question | Answer | What it means here |
|---|---|---|---|
| 1 | What slows a newcomer? | Finding their way in the code and its tacit rules, more than the language or the tools. Steinmacher's diaries: "difficulties finding their way in the code" were reported by the control and portal groups alike, and architecture, code and artifact-finding barriers showed in 32 of 46 diaries. Dagenais: the low-level design was "often the least documented", and "knowledge about the structures and cultures is often tacit". Rastogi (Microsoft, 411 survey answers): lack of documentation raises time to first check-in, and new hires asked for "companywide coding standards" | The knowledge a newcomer lacks is the knowledge an agent lacks: what this codebase does and where things go. None of these studies measures conventions as a separate barrier with a count |
| 2 | How much of review is about fit? | About three quarters. Mantyla and Lassenius: "75 percent of defects found during the review do not affect the visible functionality". Beller et al.: "the similar 75:25 ratio of maintainability-related to functional problems" in two open-source projects. Bacchelli and Bird: "code improvements" are the largest comment category at 165 of 570 (29%), defects 78 (14%). Sadowski et al.: Google requires every change to be authored or reviewed by someone with readability for its language | Most of what reviewers fix is the kind of thing a house-style map can name before the review |
| 3 | Do newcomers draw more of it? | Yes, where measured. Google developers in their first year "typically have more than twice as many comments per change". Rejected pull requests are less similar to the project's own code (entropy 4.35 vs 4.18 bits per token, p < 0.01, Cohen's D 0.61), and similarity to the project rises with experience (D = 1.11). Peripheral developers wait "2 - 19 times (or 12 - 96 hours) longer". Integrators rank "style conformance" first among quality signals | The review cost of not knowing the house style is measured, and it falls as the author learns it |
| 4 | What do agents and vendors say? | Both vendors tell users to write conventions into a file (**vendor claim**). Anthropic says such files are "context, not enforced configuration". GitHub lists a style-guide instruction among those that "may not have the intended results". Measured on agent pull requests: 50 of 214 revised Claude Code PRs (23.4%) took style revisions and 58 (27.1%) took refactoring; on a larger set, style and formatting was 10.3% of review comments and refactoring 14% | Agents show the newcomer's pattern: work that runs but does not yet look like the repository |

## 1. What slows a developer who is new to a codebase?

### Steinmacher et al., the barriers line of work (2015 to 2016)

- Systematic review: Steinmacher, Silva, Gerosa and Redmiles, "A systematic literature review on the
  barriers faced by newcomers to open source software projects", Information and Software Technology
  59 (2015). Read as its abstract only (the journal copy is closed access). The abstract on the
  author institution's page reports 291 studies screened, 20 primary studies, and 15 barriers in five
  categories: social interaction, newcomers' previous knowledge, finding a way to start,
  documentation, and technical hurdles. It also says few studies looked in depth at code-related
  problems.
- The barriers model: Steinmacher, Conte, Gerosa and Redmiles, "Social Barriers Faced by Newcomers
  Placing Their First Contribution in Open Source Software Projects", CSCW 2015. **measured** (abstract):
  "We defined a conceptual model composed of 58 barriers including 13 social barriers." The sources
  were "a systematic literature review; open question responses gathered from OSS projects'
  contributors; students contributing to OSS projects; and semi-structured interviews with 36
  developers from 14 different projects."
- The model put to use: Steinmacher, Conte, Treude and Gerosa, "Overcoming Open Source Project Entry
  Barriers with a Portal for Newcomers", ICSE 2016, with 65 students keeping diaries. Section 3: the
  technical hurdles category splits into "code/architectural hurdles, change request hurdles, and
  local environment setup hurdles". The portal's section for them links to "code search engines,
  code standards, and code related documentation".
- **measured** (Section 5.1, "Technical: barriers are still there, in both cases"): "Issues with
  workspace setup and difficulties finding their way in the code were widely reported by both the
  control and portal groups." And: "difficulty understanding the architecture/code structure,
  understanding the code, problems finding the correct artifact to fix an issue, and many barriers
  inside the local environment setup hurdles category were also evident and prominently represented
  in the diaries (in 32 out of 46)." Finding the artifacts to change was "evidenced in 21 diaries".
- **measured** The portal, which gave guidance but no tool for the code, "was not effective in
  lowering technical barriers" (abstract).

### Dagenais et al., "Moving into a New Software Project Landscape" (ICSE 2010)

Dagenais, Ossher, Bellamy, Robillard and de Vries (McGill University, IBM Research).

- Method: a grounded theory study, "18 developers and team leaders across 18 projects at IBM", most
  of them "experienced developers who had recently joined an ongoing project", each joined "in the
  prior 1 to 12 months" (Sections 1 and 2.2). Seven were re-interviewed to check the findings.
- **measured** Low-level design (Section 3.1): "The majority of tasks given to newcomers dealt with
  the intricacies of the low-level design and the runtime behavior". This feature "was often the
  least documented, not even a simple overview was available, so newcomers had to ask technical
  questions, actively search for code examples, and rely on trial and error, a time-consuming
  activity."
- **measured** Technology was not the hard part (Section 3.1): "participants did not encounter
  significant difficulties while learning new technologies".
- **measured** Tacit knowledge (Section 4): "Because knowledge about the structures and cultures is
  often tacit, newcomers must rely on landscape features such as rich communication with team
  members or the trails and signposts left by them, such as detailed source and bug history and code
  examples." Examples were found "mostly in the product's code", and newcomers "typically copied
  example code and modified it."
- **measured** Section 4.2, "Tacit Knowledge": "much of the knowledge that must be acquired is not
  recorded explicitly." The four aids that cut across all three factors were "previous experience,
  examples, mentor and questions to colleagues". 12 of the 18 had "efficient" and "pleasant"
  integration.
- Conventions appear once, for source control: "informal conventions (e.g., provide the bug number in
  the commit comment)" (Section 3.2). Coding style is not a named landscape feature.

### Begel and Simon, "Novice Software Developers, All Over Again" (ICER 2008)

Begel (Microsoft Research) and Simon (UC San Diego).

- Method: "eight developers newly hired by Microsoft between one and seven months before the start
  of the study", college graduates with little prior industry experience. "Each subject was observed
  for 6-11 hours over 2, 2-week periods" (Section 3.1). Tasks were tagged from time-stamped logs.
- **measured** Section 4.1: "Most of our NSDs spend a large portion of their time in communication
  tasks." Two subjects "spent more time on documentation than anything else", reading "to try to
  understand their team's code".
- **measured** Section 4.1, Programming: "we observed NSDs navigating and searching through code",
  which the authors call "a process often difficult for them to effectively manage". And: "In their struggles to understand
  and become conversant with a codebase, they were in a position to appreciate code comments".
- **measured** Section 4.3: newcomers "do not always recognize that they need some information", and
  the authors "observed many cases where a NSD would not recognize that they should seek information
  from a colleague in order to make progress".
- The paper reports time shares only as a chart per subject (Figure 1), not as numbers in the text.
  It says nothing about coding style or conventions.

### Rastogi et al., "Ramp-up Journey of New Hires" (Microsoft, ESEM 2015)

Rastogi, Thummalapenta, Zimmermann, Nagappan and Czerwonka.

- Method: version-control data from "eight large and popular product groups in Microsoft", plus a
  survey of "1,189 software developers with 6 to 13 months of experience" that drew "411 completed
  responses (34.57% response rate)" (Section IV).
- What was measured: time to first check-in, and ramp-up time, defined as "the time required to
  reach the median productivity level of existing employees" in check-ins, lines changed and files
  changed (Section VI). The paper reports both only as shares of the longest time measured, never in
  days or months. Example: across the eight groups, the median new hire takes about 4 to 10% of the
  longest time to first check-in measured (Section V, Figure 3).
- **measured** New hires ramp up on check-in count first, then lines changed, then files changed,
  which the authors read as "making changes to multiple files require broad understanding of the
  task" (Section VI).
- **measured** Section IV, Table II: "267 survey respondents said that lack of proper documentation for the
  project increases the time to first check-in", against 75 who said it decreases it (p < 0.001).
  Section V, Table III: working on legacy code, code with dependencies, and getting access each "moderately
  increases the time to first check-in for majority of product teams."
- **measured** Open answers (Section V): "large size of the code base to study" is among the factors
  named. New hires suggested "applying companywide coding standards, improved code base and
  documentation, easy tools, etc. will increase the productivity of new hires" (Section VII).
- **measured** Section VI: time to first check-in correlates only "negligible to weak" (+0.10 to
  -0.39, Spearman) with ramp-up time after it.

### Ju et al., "A Case Study of Onboarding in Software Teams" (Microsoft, ICSE 2021)

- Method: interviews with "32 developers moving into a new team and 15 engineering managers", checked
  against a developer survey (N = 189) and a manager survey (N = 37).
- **measured** Section IV.A: "New developers need to learn everything about the team: code
  repositories, business values and customers, development tools and processes". "Out of 61 task
  items, 41 (67%) led to learning." Twelve developers named documentation as a source, and they "feel
  frustrated when documentation cannot provide answers."

### Google

The one Google primary on ramp-up found is Green, Jaspan et al., "Developer Productivity for Humans,
Part 5: Onboarding and Ramp-Up", IEEE Software 40 (2023). Its full text sits behind IEEE Xplore and
was not read, so no number from it is used here.

## 2. How much of code review is about conventions, maintainability and fit?

### Mantyla and Lassenius, "What Types of Defects Are Really Discovered in Code Reviews?" (IEEE TSE 35(3), 2009)

- Data: "nine industrial (C/C++) and 23 student (Java) code reviews, detecting 388 and 371 defects,
  respectively" (abstract).
- Definitions (Section 3.1): a functional defect "may cause system failure when the code is executed".
  An evolvability defect "makes the code less compliant with standards, more error-prone, or more
  difficult to modify, extend, or understand."
- **measured** Abstract: "75 percent of defects found during the review do not affect the visible
  functionality of the software."
- **measured** Section 4.1.2, Table 3: with false positives removed, "the share of evolvability
  defects is 77 percent in the industrial review and 85 percent in the student reviews", so "roughly
  four out of five of the true defects identified in the code reviews were evolvability defects."
- **measured** Section 4.2, Table 4: evolvability splits into documentation ("commenting and naming
  of software elements"), visual representation ("indentation and blank line usage"), and structure.
  "roughly 10 percent of the evolvability defects were visual representation defects", about one
  third of the industrial ones were documentation, and "55 percent" were structure.

### Beller et al., "Modern Code Reviews in Open-Source Projects: Which Problems Do They Fix?" (MSR 2014)

Beller, Bacchelli, Zaidman (TU Delft) and Juergens (CQSE).

- Data: "over 1,400 changes taking place in reviewed code from two OSS projects" (ConQAT and
  GROMACS), classified with Mantyla and Lassenius's scheme. A change with "a functional alteration"
  is functional; otherwise it is "a non-functional evolvability or maintainability change".
- **measured** Abstract: "the similar 75:25 ratio of maintainability-related to functional
  problems". Figure 5 gives evolvability shares of 81% (ConQAT-rand), 75% (ConQAT-100) and 69%
  (GROMACS-rand).
- **measured** Abstract: "7 to 35%" of review comments are discarded and "10 to 22%" of changes are
  not triggered by an explicit review comment (the paper writes both ranges with a dash).
- **measured** Section 4.1: comments are "the single highest change category across all the
  profiles, followed by identifier renamings in ConQAT".

### Bacchelli and Bird, "Expectations, Outcomes, and Challenges of Modern Code Review" (ICSE 2013)

Bacchelli (University of Lugano) and Bird (Microsoft Research).

- Method: 17 developers observed and interviewed across "16 separate product teams", "570 comments"
  from 200 review threads card-sorted, and a survey of "165 managers and 873 programmers"
  (Section I).
- Definition (Section IV.B): "Code improvements are comments or changes about code in terms of
  readability, commenting, consistency, dead code removal, etc., but do not involve correctness or
  defects."
- **measured** Section V: "The most frequent category, with 165 (29%) comments, is 'code
  improvements.'" Of those, "58 on using better code practices, 55 on removing not necessary or
  unused code, and 52 on improving code readability." Defects are "only the fourth most frequent,
  out of nine items, with 78 (14%) comments".
- **measured** Section IV.B: "Most interviewed programmers mentioned that at least one of the
  reviewers involved in each code review takes care of checking whether the code follows the team
  conventions, for example in terms of code formatting and in terms of function and variable
  naming."
- Expectation versus outcome (Section IV.A): "finding defects" is the first motivation for 383
  programmers (44%), and "code improvement" for 337 (39%).

### Sadowski et al., "Modern Code Review: A Case Study at Google" (ICSE-SEIP 2018)

Sadowski, Soderberg, Church, Sipko and Bacchelli.

- Data: 12 interviews, a survey with 44 valid answers, and logs of "approximately 9 million changes
  created by more than 25,000 authors and reviewers from January 2014 until July 2016" with "about
  13 million comments" (Section 3.3).
- **measured** Section 4.2: four expectations, "education, maintaining norms, gatekeeping, and
  accident prevention". "norms refer to an organization preference for a discretionary choice (e.g.,
  formatting or API usage patterns)". Finding 1: "Reviewing was introduced at Google to ensure code
  readability and maintainability."
- **doc** (the company's own description, Section 5.1): "Google defines a concept called
  readability, which was introduced very early on to ensure consistent code style and norms within
  the codebase." A developer earns it once reviewers "are confident the developer understands the
  code style and best practices for a language". "Every change must be either authored or reviewed
  by someone with a readability certification for the language(s) used."
- Section 4.2: maintaining norms "came up between an engineer and those with a different seniority
  (project leads, expert readability reviewers or 'new' team members)".

## 3. Do newcomers' changes draw more review, or take longer to land?

- **measured** Sadowski et al., Section 7.3 and Figure 2: "Developers at Google who have started
  within the past year typically have more than twice as many comments per change." The authors
  read this as reviewers "needing to ask fewer questions as they build familiarity with the
  codebase". The paper does not split those comments by kind.
- **measured** Hellendoorn, Devanbu and Bacchelli, "Will They Like This? Evaluating Code
  Contributions With Language Models" (MSR 2015). Language models trained on each project measure
  how far a pull request's code is from the project's own. Over 22 projects (Section IV, RQ1), "The
  mean entropies of accepted and rejected PRs are 4.18 and 4.35 bits/token respectively", p < 0.01,
  "a moderate effect (0.61)". The abstract: "the less similar changesets are more likely to be
  subject to thorough review." RQ4, on 1,432 PRs from 127 authors: entropy "is significantly lower
  among PRs from contributors with prior experience" (p < 0.01, "a large effect (D = 1.11)"), with
  the largest gap between "one or two prior contributions and contributors with three or more".
- **measured** Gousios, Zaidman, Storey and van Deursen, "Work Practices and Challenges in Pull-Based
  Development: The Integrator's Perspective" (ICSE 2015), 749 integrators surveyed. Figure 2
  (factors integrators examine for quality) ranks "style conformance" first. Section V.C: "One of
  the top priorities for integrators when evaluating pull request quality is conformance." One
  answer (R39) reads conformance as "it matches the project's current style (or at least improve upon
  it)". Integrators "expect the contributed code to cause minor friction with their existing code
  base". Figure 2 shows shares only as bars, so no exact share is given here.
- **measured** Steinmacher, Pinto, Wiese and Gerosa, "Almost There: A Study on Quasi-Contributors in
  Open Source Software Projects" (ICSE 2018). In 21 GitHub projects, "10,099 quasi-contributors,
  about 70% of the total actual contributors, that submitted 12,367 nonaccepted pull-requests"
  (abstract). In their own words (Table 3), the top reasons were "Superseded/duplicated pull
  request" (52) and "Mismatch between developer's and team's vision/opinion" (45); "Guidelines not
  followed" drew 6. Integrators put "Guidelines not followed" second (9 occurrences), and one said
  such guidelines range from "coding style, lack of tests, or messy versioning history".
  "Around 30%" said the rejection demotivated them or stopped them from trying again.
- **measured** Bosu and Carver, "Impact of Developer Reputation on Code Review Outcomes in OSS
  Projects" (ESEM 2014), eight projects, read as its abstract only: core developers "receive quicker
  first feedback", "complete the review process in shorter time", and are "more likely to have their
  code changes accepted". "Peripheral developers may have to wait 2 - 19 times (or 12 - 96 hours)
  longer". Periphery is a network position here, not tenure.

## 4. What agents and their vendors say about repository context

### Claude Code: CLAUDE.md and memory

From `https://code.claude.com/docs/en/memory`:

- **vendor claim** Project `CLAUDE.md` is for "build and test commands, coding standards,
  architectural decisions, naming conventions, and common workflows".
- **vendor claim** "Each Claude Code session begins with a fresh context window." Both memory systems
  "are loaded at the start of every conversation. Claude treats them as context, not enforced
  configuration."
- **vendor claim** "The more specific and concise your instructions, the more consistently Claude
  follows them." Target "under 200 lines per CLAUDE.md file. Longer files consume more context and
  reduce adherence."
- **vendor claim** `/init` "analyzes your codebase and creates a file with build commands, test
  instructions, and project conventions it discovers". Users should "Refine from there with
  instructions Claude wouldn't discover on its own."
- **doc** Subdirectory `CLAUDE.md` files and path-scoped rules load once Claude reads, writes or edits
  a file in that directory, not at launch.

### GitHub Copilot: custom instructions

- **vendor claim** `https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions`:
  repository instructions "Describe the languages, frameworks, tools, architecture, and coding
  conventions used in a project." A listed use is "Coding and testing conventions. Describe naming,
  formatting, testing, error-handling, or documentation standards."
- **vendor claim** Same page: "Always conform to the coding styles defined in styleguide.md in repo
  my-org/my-repo when generating code." is listed among instructions that "may not have the intended
  results" on a large and diverse repository.
- **doc** `https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions`:
  `.github/copilot-instructions.md` applies "to all requests made in the context of a repository",
  and "Instructions are automatically added to requests that you submit to Copilot." Its sample
  prompt for generating the file asks for high-level details "to reduce the amount of searching the
  agent has to do to understand the codebase each time".

### Measured studies of agent-written pull requests

- **measured** Watanabe, Li, Kashiwa, Reid, Iida and Hassan, "On the Use of Agentic Coding: An
  Empirical Study of Pull Requests on GitHub" (arXiv:2509.14745, v3, 9 Feb 2026). 567 Claude Code PRs
  across 157 projects, against 567 human PRs. Table 2: 475 agent PRs merged (83.8%) against 516 human
  PRs (91.0%), a significant gap (chi-squared, p < 0.05). 214 of the 475 (45.1%) were revised before
  merge. Table 4 (share of revised agent PRs): fix 47.7%, docs 29.0%, refactor 27.1%, style 23.4%
  (50 of 214), chore 21.0%, test 16.4%, feat 15.4%, build 14.0%, ci 7.0%, perf 1.4%. Section 4.4 on
  style: "Typical fixes include enforcing naming conventions, correcting formatting, and resolving
  linter warnings", and these "suggest that current agents often underperform on project-specific
  style rules". The implications section recommends "a dedicated guideline file (e.g., CLAUDE.md, supported by Claude
  Code) that includes formatting rules, design principles, and architectural constraints". That is
  the authors' advice, not a measured effect. The share of merged PRs taken without revision did not
  differ significantly (54.9% agent, 58.5% human).
- **measured** Haider and Zimmermann, "Understanding Dominant Themes in Reviewing Agentic AI-authored
  Code" (MSR 2026, arXiv:2601.19287). "19,450 inline review comments spanning 3,177 agent-authored
  PRs" from the AIDev dataset. Section 4, comment level then PR level: feature and implementation
  38.5% and 46.5%; "Restructuring, simplification, and redundancy elimination (refactor, 14% and
  10.4%)"; documentation 11.4% and 10.5%; "Styling and formatting adjustments to ensure better
  readability and consistency (style, 10.3% and 8.5%)". The themes come from a local model (Gemma 3
  12B) checked against one human annotator on 571 comments, so they are model labels, not hand
  labels.
- **measured** Ehsani et al., "Where Do AI Coding Agents Fail?" (arXiv:2601.15195, v1, 21 Jan 2026),
  failed agent PRs in AIDev, Table 2: not reviewed 38%, duplicate 23%, CI or test failure 17%,
  unwanted feature 4%. The taxonomy has no style or convention category, so this study is silent on
  the question.
- No study found compares agent PRs with and without a repository context file on the number of
  style comments they draw.

## What this means for anatomiya

What the README may say, on the evidence above:

- That most review findings are about evolvability, not function: about 75:25 in two independent
  studies (Mantyla and Lassenius, Beller et al.), and "code improvements" outnumber defects about two
  to one in Bacchelli and Bird's sample (29% vs 14%).
- That newcomers draw more review and their work is further from the project's own code: twice the
  comments per change in a developer's first year at Google, rejected PRs measurably less like the
  project, and the gap closing with experience.
- That agents show the same pattern: 23.4% of revised Claude Code PRs needed style fixes and 27.1%
  refactoring (Watanabe et al.).
- That the knowledge in question is tacit and lives in the code (Dagenais et al.), which is where
  anatomiya counts it from.
- Not that anatomiya removes these comments. No study above measures a context file's effect on
  style review, and the repository has not measured it either. The vendors' own pages call these
  files context, and GitHub says a style-guide instruction "may not have the intended results".

## Sources

Papers:

- [Steinmacher, Silva, Gerosa and Redmiles, A systematic literature review on the barriers faced by newcomers to open source software projects (IST 59, 2015), abstract](https://experts.nau.edu/en/publications/a-systematic-literature-review-on-the-barriers-faced-by-newcomers/)
- [Steinmacher, Conte, Gerosa and Redmiles, Social Barriers Faced by Newcomers Placing Their First Contribution in Open Source Software Projects (CSCW 2015)](https://doi.org/10.1145/2675133.2675215)
- [Steinmacher, Conte, Treude and Gerosa, Overcoming Open Source Project Entry Barriers with a Portal for Newcomers (ICSE 2016)](https://www.ime.usp.br/~gerosa/papers/ICSE2016.pdf)
- [Dagenais, Ossher, Bellamy, Robillard and de Vries, Moving into a New Software Project Landscape (ICSE 2010)](https://www.cs.mcgill.ca/~martin/papers/icse2010.pdf)
- [Begel and Simon, Novice Software Developers, All Over Again (ICER 2008)](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/icer-begel-2008.pdf)
- [Rastogi, Thummalapenta, Zimmermann, Nagappan and Czerwonka, Ramp-up Journey of New Hires: Tug of War of Aids and Impediments (ESEM 2015)](https://thomas-zimmermann.com/publications/files/rastogi-esem-2015.pdf)
- [Ju, Sajnani, Kelly and Herzig, A Case Study of Onboarding in Software Teams: Tasks and Strategies (ICSE 2021, arXiv:2103.05055)](https://arxiv.org/abs/2103.05055)
- [Green, Jaspan et al., Developer Productivity for Humans, Part 5: Onboarding and Ramp-Up (IEEE Software, 2023), not read in full](https://research.google/pubs/developer-productivity-for-humans-part-5-onboarding-and-ramp-up/)
- [Mantyla and Lassenius, What Types of Defects Are Really Discovered in Code Reviews? (IEEE TSE 35(3), 2009)](https://doi.org/10.1109/TSE.2008.71)
- [Beller, Bacchelli, Zaidman and Juergens, Modern Code Reviews in Open-Source Projects: Which Problems Do They Fix? (MSR 2014)](https://doi.org/10.1145/2597073.2597082)
- [Bacchelli and Bird, Expectations, Outcomes, and Challenges of Modern Code Review (ICSE 2013)](https://www.microsoft.com/en-us/research/?p=164195)
- [Sadowski, Soderberg, Church, Sipko and Bacchelli, Modern Code Review: A Case Study at Google (ICSE-SEIP 2018)](https://research.google/pubs/modern-code-review-a-case-study-at-google/)
- [Hellendoorn, Devanbu and Bacchelli, Will They Like This? Evaluating Code Contributions With Language Models (MSR 2015)](https://doi.org/10.1109/MSR.2015.22)
- [Gousios, Zaidman, Storey and van Deursen, Work Practices and Challenges in Pull-Based Development: The Integrator's Perspective (ICSE 2015)](https://gousios.org/pub/pullreqs-integrators.pdf)
- [Steinmacher, Pinto, Wiese and Gerosa, Almost There: A Study on Quasi-Contributors in Open Source Software Projects (ICSE 2018)](https://www.ime.usp.br/~gerosa/papers/icse2018-Pinto.pdf)
- [Bosu and Carver, Impact of Developer Reputation on Code Review Outcomes in OSS Projects (ESEM 2014), abstract](https://doi.org/10.1145/2652524.2652544)
- [Watanabe et al., On the Use of Agentic Coding: An Empirical Study of Pull Requests on GitHub (arXiv:2509.14745, v3, 2026)](https://arxiv.org/abs/2509.14745)
- [Haider and Zimmermann, Understanding Dominant Themes in Reviewing Agentic AI-authored Code (MSR 2026, arXiv:2601.19287)](https://arxiv.org/abs/2601.19287)
- [Ehsani et al., Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests in GitHub (arXiv:2601.15195, 2026)](https://arxiv.org/abs/2601.15195)

Docs:

- [Claude Code, How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [GitHub Docs, Custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions)
- [GitHub Docs, Adding repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
