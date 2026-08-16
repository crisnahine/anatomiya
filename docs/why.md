# Why

The longer argument. What the problem is, what was measured, what the measurements cost the design,
and what three rejected specifications taught.

## The problem

An agent writing code in your repository has no memory of the last review. The conventions it needs
are usually not written down anywhere, because they are not rules anyone decided. They are what the
existing code happens to do. A reviewer sees the mismatch, writes a comment, the agent fixes it, and
the next task starts from zero again.

The obvious fix is a hand-written `CONVENTIONS.md`. It fails in a specific way: nobody can tell
whether a line in it is still true. "We always return a result object" is a claim about the
codebase, and once written it is never checked again. It drifts, and a drifted convention file is
worse than none, because an agent will follow it.

So the tool writes counts instead of rules. `67 of 73 sites across 69 of 122 files` is checkable,
it goes stale visibly rather than silently, and a reader can disagree with it by looking.

That much is a design idea. The question worth answering first was whether it is worth building at
all.

## What was measured

Measurement came before the code. The headline is unflattering and it is the reason the README
reads the way it does.

| Corpus | Size | Question | Result |
|---|---|---|---|
| One company's review history | 4,616 comments | share plausibly preventable by a counted conventions map | 8.5% |
| Ten public repositories | 3,015 comments | same, hand-classified per repository | 8% to 15% |
| Defect subset of the ten-repo corpus | 317 comments | same, restricted to comments about defects | 1 comment, 0.3% |
| Ten public repositories, per pull request | pull-request level | round-trip effect of removing the preventable comments | median 12% saving; 3.6% went reviewed to silent |
| Convention glossary | 237 entries | which candidate rules have a denominator at all | 87 Tier A |

Each of those numbers has a caveat attached, and the caveats matter more than the numbers.

**8.5% is one company and one review culture.** The classification was done by one person, and
"plausibly preventable" is a judgement call with a soft boundary. Read it as the right order of
magnitude, not a constant.

**The comment corpus can only see what got through review.** It cannot see the code that was never
written badly because the author already knew the convention. The measurement therefore bounds the
review-comment effect and says nothing about the pre-review effect, which is the effect this tool
is actually aiming at. That effect is unmeasured, not disproven. It is also why the success
criterion in the build contract is a with-map against without-map diff on real tasks, and
explicitly not a review-comment count.

**The preventable comments are the cheap ones.** They drew fewer replies than average, and about a
quarter of them were formatting nits. So 8.5% of the comment count is less than 8.5% of the review
effort. A tool that removes only cheap comments removes only cheap comments.

**Removing a partial set does not remove a round-trip.** Preventable and unpreventable comments land
on the same pull request. In the company corpus, 93.5% of pull requests were unaffected: they had at
least one comment the map could not have prevented, so they still came back. Across the ten public
repositories the median round-trip saving was 12%, and only 3.6% of pull requests went from
reviewed to silent.

**It does not catch bugs.** One defect comment out of 317 was preventable by a conventions map.
Nine of the ten repositories scored zero. This is the single number that most cleanly kills a claim
the tool would otherwise be tempted to make, so it is stated in the README rather than here.

### The one strong signal, labelled honestly

The three repositories with heavy agent-authored pull requests scored the top three preventable
shares in the ten-repo measurement.

That grouping was made after seeing the results. It is post-hoc, n is 3, and there was no controlled
comparison against matched repositories with human-authored pull requests. Its own author flagged it
as a grouping with a mechanism rather than a statistical result, and that is exactly how it should
be read.

The mechanism is the part worth taking seriously. A human contributor learns a convention once and
then stops earning comments about it. An agent does not: it starts every task with no memory of the
last review, so it re-earns the same comment indefinitely. In that setting the preventable share is
not a fixed 8.5% of the review load, it is a recurring tax, and a counted map is the only thing in
the loop that remembers. Mechanical per-pull-request obligations behave the same way. A missing
changeset file or newsfragment is a comment that gets written again on the next pull request, by the
same reviewer, about the same thing.

This is the case to build for. It is a hypothesis, and the way to settle it is the with-map against
without-map task diff, not more comment classification.

## What the measurements changed

Every row here is a design that was in a specification and got replaced because a probe contradicted
it. The reference in the last column is the numbered decision in `DECISIONS.md`, and that file's
status column is what the code does today. The middle column is the decision the measurement forced,
not a claim that it is built: three rows below are marked where the two differ.

| Measured | Decision it forced | Ref |
|---|---|---|
| Counting conforming *files* instead of conforming *sites* flipped 10 of 39 verdicts, in both directions | Ratio is over candidate sites; applicability is carried and rendered separately | C1, C3 |
| An unconditional "two directories" gate blocked 124 of 170 slots, because area discovery finds leaf directories and a leaf directory holds one | The directory gate applies only when the area spans more than one directory | D4 |
| `git blame` per file took 103s against 0.84s for one `git log` pass, agreed 99.6% to 100%, and one repository-wide formatter commit reassigned every line to the formatter | Authors come from a single `git log -M` pass, never from blame | D5 |
| `oxc-parser` raised an uncatchable SIGSEGV from inside `parseSync` at nesting depth. A worker thread did not contain it, and no static pre-screen predicted it. The child-process pool also measured 8,463 to 10,563 files/sec against 3,058 in-process | Parsing runs in a pool of warm child processes | B2 |
| `oxc` reports offsets in UTF-16 code units, `prism` in UTF-8 bytes, and 5.4% of real files are non-ASCII | Never index a disk buffer with a parser-reported offset; slice the same in-memory string the parser was handed | B5 |
| Reading a context file with the Read tool permanently suppressed its automatic injection for that path, for the rest of the process | The plugin never opens its own output with Read; the commands use `cat` | A7 |
| A rewritten context file does not re-attach mid-session, and the change notice truncates head and tail, so a mid-file edit reaches the model in neither copy | Generated files stay short, and the scan prints a restart notice | A6, A8 |
| A fixed table of area roots put 41% of one real repository's source in no area, and split `scripts/lib` from its larger sibling `scripts/hooks` for no stateable reason | Any directory holding enough source is an area candidate | see `lib/areas.mjs` |
| Scanning per area cost 3 to 4.4x for nothing | One whole-corpus pass, attributed to areas in the reducer | see `lib/scan.mjs` |
| An 85-area index costs about 1.2k tokens, a 977-area index about 15.8k | An area ceiling, smallest folded upward into a real parent directory; the overview summarises its listing past 200 | see `lib/areas.mjs` |
| Raising the area ceiling to 1,000 split a 2,468-file repository into 209 areas and dropped stated claims from 194 to 143, because a smaller area holds fewer candidates | The ceiling is `clamp(ceil(N / 16), 120, 500)`, a budget backstop reading "the average area holds at least sixteen files" rather than a size rule. Coverage on a large tree comes from folding into parent directories, which took a 100,000-file repository from 76,000 uncovered files to none | see `lib/areas.mjs` |
| A 50,000-file corpus cap did not trim a tail: it suppressed every directive in the map, so a repository one file over the line stated nothing | No cap on repository size. The same 100,000-file repository went from 0 of 720 claims to 480 of 720 | B11 |
| The `typescript@5` checker ran 26x slower, is whole-program (narrowing the file set drove unresolved types from 3.1% to 36.2%), and bought 5 additional entries | A semantic tier would be opt-in and never the default. **Not built:** `typescript` is not a dependency and no flag reaches it | B7 |
| A tracked file named `--instruction-file-path=.git/config` exfiltrated a secret through a subprocess argv | Every subprocess: `execFile`, arguments after `--`, reject paths starting with `-`. **Partial:** no path reaches a positional argument today, but the rule is not applied at every call site | F5 |
| `execFile` threw `RangeError: Invalid string length` from inside Node's own exit handler, with `maxBuffer` set far above the output size | Subprocess output is streamed, never buffered. **Partial:** every read that grows with the repository streams; the ones that ask for a single blob or ref still buffer | F6 |
| 18 of 85 areas in one measured repository were fixture directories | Fixture, vendor, dist and build directories are excluded from the corpus | see `lib/corpus.mjs` |
| Bidi controls and zero-width joiners are Unicode category Cf, so they pass an ASCII control filter, and `JSON.stringify` does not escape them either | One encoder, allowlist not denylist, applied to every repository-controlled value | F3, F4 |
| A hook was measured being flagged as prompt injection | No hooks, at all | see `DECISIONS.md` |

The pattern across the table: nearly every replaced design was reasonable on paper, and lost to one
cheap probe against a real repository.

## Three rejected designs

Three full specifications were written and audited before this code existed. All three were
rejected. The reasons are worth writing down because they are the same class of mistake each time.

The third was put through a five-lens verification that returned 26 blocking findings. A sample,
each of which is now a numbered decision:

- The spec said "never delete a file lacking our frontmatter key" and "remove any unknown
  `anatomiya-*` file" in adjacent sentences. Two rules, contradictory, about one file. The decision
  is now that removal requires all three of the prefix, the key, and being known to the scan (A3).
- It promised an applicability floor and gave it no number, no gate, no storage, and no test. A
  promised floor with no number is not a floor (C4).
- Its concentration guard was `files_conforming >= 3`, which does not block the case the spec itself
  gave as its motivation: 200 candidate sites in one file plus one each in 13 others gives 14 files
  at ratio 1.0, and every gate passes. The guard is now the inverse-Simpson count of how many files
  the evidence is worth, plus the ratio recomputed with the largest file dropped. A share of the
  candidates was the first replacement and it does not work either: at two files the largest share is
  at least 0.5 by arithmetic, and at fifty files no share ever fires however lopsided the spread (D3).
- It defined the three counts and never said which population the gate reads, current or baseline.
  Those give different answers whenever the agent has been editing (D6).
- It claimed the parsing libraries read no repository configuration. Its own evidence section
  falsified that: the semantic tier reads the repository's `tsconfig.json` (B9).
- It dropped symlink confinement to one sentence about symlinked *directories*, which exempts
  symlinked files (F2).
- It suggested re-pinning the baseline at the moment a branch is under review, which is the moment a
  re-pin launders exactly the violation being reviewed. Re-pin is now a separate human action the
  tool never suggests (E5).

The first specification loosened the conformance gate from the measured 0.90 to 0.80 and gave no
argument for it (D1).

The instructive part is not any single error. It is that a specification which states a threshold
without naming the population it reads, or promises a floor without a number, or gives a guard that
fails its own motivating example, reads perfectly well and does not survive contact with a
repository. Three audits cost days. Building any of the three would have cost weeks and produced a
tool that quietly stated wrong conventions, which is the one failure mode that is worse than
producing nothing.

## What is deliberately absent

- **No hooks.** Worst-trusted channel, highest complexity, and measured being flagged as prompt
  injection.
- **No MCP server.** There is nothing to expose.
- **No skill.** It would spend resident context describing the tool instead of the repository.
- **No health score or grade.** It changes nothing about the next line of code.
- **No restating what the linter already enforces.**
- **No bug-catching claim.** One of 317.

## Further reading

[`DECISIONS.md`](../DECISIONS.md) is the build contract: 75 numbered decisions with the finding
behind each. [`how-it-works.md`](how-it-works.md) is the mechanical walkthrough.
