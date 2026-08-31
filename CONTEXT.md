# anatomiya

Counts what a repository's own code already does, directory by directory, and states only what the counts
support. The vocabulary below separates what is measured from what is said, because the whole design turns
on that line.

## Language

### What ships

The words above the tool: this repository is a marketplace holding two plugins, and every sentence
about that was written ad hoc until these entries existed.

**Marketplace**:
The listing at `.claude-plugin/marketplace.json`, and the repository it is the root of. It installs
nothing itself; it says where each plugin is.
_Avoid_: registry, catalogue, repo

**Plugin**:
One thing a person installs, with its own manifest, its own version, its own changelog and its own
tag. Two of them live here, and they share the repository and nothing else: nothing either one
ships imports the other, though this repository's own tests read both, and neither is released by
the other's tag.
_Avoid_: package, module, extension

**Plugin root**:
The directory a plugin's own paths are relative to, and the only place its hooks may name a file.
Each plugin's is its own directory under `plugins/`, and what installs is that directory whole, which
is why the shipped set has to be stated rather than seen.
_Avoid_: base, install directory

**Shipped set**:
The files that belong to a plugin rather than to how it is built, named by `package.json` `files`
and read back through `npm pack`. Every file the loader starts from, and everything those reach,
has to be in it.
_Avoid_: bundle, artifact, distribution

**Payload**:
The JSON object Claude Code writes to a hook's stdin. A hook answers one object on stdout, or
nothing, and exits 0 whatever happened: a hook that fails interrupts the run it exists to help. The
**event** is the field inside it naming why the hook fired, which is a different thing and keeps its
own name.
_Avoid_: input, message, calling the whole payload an event

**Shadow**:
A markdown agent file standing in for a built-in agent type, holding a copy of that type's system
prompt so a spawn of it can be given a setting the built-in has no way to take. Nothing in it says
which build the copy was taken from.
_Avoid_: override, custom agent, subagent definition

### The corpus and its shape

**Corpus**:
Every tracked source file this repository will be counted over: what is left after the deny list, the
excluded directories, paths that escape the repository, and files a generator wrote. The counts of where
files live are taken over a wider set, every tracked file whether source or not.
_Avoid_: codebase, file list, tree

**Area**:
A directory holding enough source files to be counted as a unit, together with the files beneath it that
no deeper area claimed.
_Avoid_: module, package, folder, scope

**Root**:
A directory the "what lives where" counts give a line to, together with the files under it that no other
root took. A different unit from an area: it is counted over every tracked file rather than source alone,
and it says nothing about which area a file belongs to.
_Avoid_: top-level directory, folder, package, area

**Namesake test**:
A test file that answers one source file by carrying its stem. It says that file is tested, and nothing
about where its root keeps its tests.
_Avoid_: unit test, matching spec, paired test, sibling test

**Uncovered**:
A source file that no area holds, either because discovery found nowhere to put it, or because the area
holding it counted nothing. The map prints the two apart, since the reader's next move differs.
_Avoid_: unmapped, skipped, excluded

**Unexamined**:
A corpus file that contributed no sites, and which of the four reasons it was: **crashed** the
parser, **rejected** as syntax the parser would not take, **oversize** past the per-file cap, or
**unreadable**, meaning this tool or the filesystem could not produce it. A file that was examined
is **ok**. The reader's next move differs for each, which is why one word will not do: rejected
syntax is the repository's own code, and a crash is this tool's.
_Avoid_: failed, skipped, error, broken

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
A candidate matching the sentence the slot states. Where the stated sentence is the counter-claim, that
is the candidates matching the counter-claim, not the claim.
_Avoid_: passing, valid, correct, compliant

**Declined**:
A site whose class the row could not read, so it holds no vote either way. It sits outside both the
candidates and the eligible files, which is why the counts line discloses it on its own.
_Avoid_: skipped, ignored, excluded

**Eligible files**:
The examined files a dimension could have spoken about at all: the ones written in its languages, less
any whose syntax it could not read. The denominator applicability is printed and gated against.
_Avoid_: candidates, area files, corpus

**Applicability**:
How many files in an area hold at least one candidate. Fewer than the eligible files it prints against,
since a site the predicate cannot see is a file that does not count.
_Avoid_: coverage, reach, eligibility

**Precision**:
Whether a dimension's predicate sees every site it speaks about (precise), or under-counts in cases
nothing static can see (partial).
_Avoid_: accuracy, confidence, reliability

**Exception**:
A file holding sites that break the stated sentence, exempt because the sentence was told with its sites
already outside it. The line names up to three and counts the rest, and the check honours the ones the
baseline held as well, so being exempt is not the same as being named.
_Avoid_: violation, offender, failure

### What gets said

**Directive**:
The one sentence an area is told about a dimension, whichever of the two sides it states.
_Avoid_: rule, convention, instruction

**Principle**:
A sentence in the overview about how to read the counts rather than about any one file. No dimension
states it and no area owns it, which is what separates it from a directive.
_Avoid_: directive, rule, guideline, claim

**Stated**:
Which of a slot's two sentences the gates settled on, or neither. The map's own "N stated" is a smaller
number: it counts only the slots rendered as directives, leaving out those whose side the model already
writes unprompted.
_Avoid_: passed, enabled, active

**Gate**:
A named condition a slot must clear before it may state anything. The first one to fail is the one
recorded and printed.
_Avoid_: threshold, check, filter, guard

**Author**:
A person the history shows in an area's files, counted across the names those files used to carry. One
is a habit rather than a convention, so a slot clears a bar of them before it may state anything, and
the number prints on the sentence it let through.
_Avoid_: committer, contributor, owner

**Counts**:
The numbers a slot prints. A slot no gate let speak prints them with the name of the gate that stopped
it; a slot that stated a sentence prints them beside it.
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
How many files inside mapped areas the base has moved since the commit it shares with the pin, counting
only those whose contents differ from the pin as well. Never measured to the branch tip, or a large
branch would silence its own findings.
_Avoid_: churn, delta, divergence

**Staleness**:
The verdict that this run cannot tell a new site from an old one well enough to be trusted at full
severity: drift past the threshold, or no map, no pin, no reachable base, an empty pinned population, or
a truncated scan. It caps severity and never refuses to run.
_Avoid_: expiry, invalidation, rot

### What reaches the agent

**Map**:
Everything a scan writes for the agent to read: the overview, and one area file per area that counted
anything, whether or not it states a sentence.
_Avoid_: report, output, docs, rules

**Overview**:
The one map file with no path scope, so it loads on every turn. Byte-stable between scans of unchanged
source.
_Avoid_: index, summary, README

**Area file**:
A map file scoped to one area's glob, so it loads when a file in that area is read.
_Avoid_: rule file, doc, context file

**Notice**:
The one sentence handed to the agent before a file is written, saying where that kind of file's tests
already go. No scan wrote it: it is composed for the path in hand, and no area file carries it.
_Avoid_: warning, hint, directive, message

**Facts**:
The machine record of every slot, gated or not, including which side was stated. The map is derivable from
it, and the check reads it rather than reading the map.
_Avoid_: cache, state, database, store

### The check

**Finding**:
One site a branch introduced that the check reports, whether or not a directive was stated over it. The
severity says which. One rule answers for a path rather than for a site.
_Avoid_: violation, error, issue, offence

**Newly introduced**:
Present at the branch tip and absent at the merge base, matched by content rather than by position, so a
rename or an added import forges nothing. With no merge base to compare against, the run falls back to
the lines added since the oldest commit the clone holds, which is positional, and says so.
_Avoid_: new, added, changed

**Severity**:
How far a finding is trusted, from a site nothing was counted about, up to a site whose area's baseline
was perfect.
_Avoid_: priority, level, confidence
