# anatomiya

Counts what a repository's own code already does, directory by directory, and states only what the counts
support. The vocabulary below separates what is measured from what is said, because the whole design turns
on that line.

## Language

### The corpus and its shape

**Corpus**:
Every tracked source file this repository will be counted over, after the deny list and the excluded
directories have been applied.
_Avoid_: codebase, file list, tree

**Area**:
A directory holding enough source files to be counted as a unit, together with the files beneath it that
no deeper area claimed.
_Avoid_: module, package, folder, scope

**Uncovered**:
A source file that no area holds, because every directory above it fell below the floor.
_Avoid_: unmapped, skipped, excluded

### What is counted

**Dimension**:
One yes-or-no question asked of every site of a construct, carrying the sentence to state when the answer
is mostly yes and the sentence to state when it is mostly no.
_Avoid_: rule, check, lint rule, metric

**Claim**:
The sentence a dimension states when its sites conform.
_Avoid_: rule, convention, guideline

**Counter-claim**:
The hand-written inverse sentence, present only where the other side is a style someone chose rather than
a defect. Refusing one is part of the dimension, never an omission.
_Avoid_: negation, inverse rule, anti-pattern

**Slot**:
One dimension applied to one area. The unit that either states a directive or prints as counts.
_Avoid_: entry, row, result, finding

**Candidate**:
One site where a dimension's construct appears. The denominator of every ratio.
_Avoid_: match, occurrence, hit, instance

**Conforming**:
A candidate matching the positive pattern.
_Avoid_: passing, valid, correct, compliant

**Applicability**:
How many files in an area hold at least one candidate. Not how many could hold one, since a site the
predicate cannot see is a file that does not count.
_Avoid_: coverage, reach, eligibility

**Precision**:
Whether a dimension's predicate sees every site it speaks about (precise), or under-counts in cases
nothing static can see (partial).
_Avoid_: accuracy, confidence, reliability

**Exception**:
A file named on a slot's line as holding sites that break the stated sentence. Naming it is also what
exempts it, because the sentence was told with that file's sites already outside it.
_Avoid_: violation, offender, failure

### What gets said

**Directive**:
The one sentence an area is told about a dimension, whichever of the two sides it states.
_Avoid_: rule, convention, instruction

**Stated**:
Which of a slot's two sentences reached the map, or neither.
_Avoid_: passed, enabled, active

**Gate**:
A named condition a slot must clear before it may state anything. The first one to fail is the one
recorded and printed.
_Avoid_: threshold, check, filter, guard

**Counts**:
What a slot prints when no gate lets it state a sentence: the numbers, and the name of the gate that
stopped it.
_Avoid_: stats, metrics, summary

**Truncated**:
The state of a scan that answered for only part of the corpus. It suppresses every directive, because
counting over an arbitrary subset and rendering it as a complete scan is worse than reporting nothing.
_Avoid_: partial, incomplete, capped

### The accepted past

**Pin**:
The commit, and the file list each area held at it, that a human accepted as the thing claims are measured
against.
_Avoid_: snapshot, lockfile, baseline

**Population**:
One area's slice of the pin: the files it held at the pinned commit, followed through renames to the names
they carry today.
_Avoid_: file set, scope, sample

**Baseline**:
The counts a dimension had over a population, read at the pinned commit and never from the working tree.
Every gate reads these. Today's counts print beside them and decide nothing.
_Avoid_: reference, previous run, snapshot

**Drift**:
How many files inside mapped areas changed between the pin and the commit the branch is built on.
_Avoid_: churn, delta, divergence

**Staleness**:
The verdict that drift has grown far enough that the map describes a different repository than the one in
hand. It caps severity and never refuses to run.
_Avoid_: expiry, invalidation, rot

### What reaches the agent

**Map**:
Everything a scan writes for the agent to read: the overview, and one area file per area that states
something.
_Avoid_: report, output, docs, rules

**Overview**:
The one map file with no path scope, so it loads on every turn. Byte-stable between scans of unchanged
source.
_Avoid_: index, summary, README

**Area file**:
A map file scoped to one area's glob, so it loads when a file in that area is read.
_Avoid_: rule file, doc, context file

**Facts**:
The machine record of every slot, gated or not, including which side was stated. The map is derivable from
it, and the check reads it rather than reading the map.
_Avoid_: cache, state, database, store

### The check

**Finding**:
One site a branch introduced that breaks the directive its area was told.
_Avoid_: violation, error, issue, offence

**Newly introduced**:
Present at the branch tip and absent at the merge base, matched by content rather than by position, so a
rename or an added import forges nothing.
_Avoid_: new, added, changed

**Severity**:
How far a finding is trusted, from a site nothing was counted about, up to a site whose area's baseline
was perfect.
_Avoid_: priority, level, confidence
