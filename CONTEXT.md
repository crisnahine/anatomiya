# anatomiya

Counts what a repository's own code already does, directory by directory, and states only what the counts
support. The vocabulary below separates what is measured from what is said, because the whole design turns
on that line.

## Language

### What ships

The words above the tool: this repository is a marketplace holding one plugin, and every sentence
about that was written ad hoc until these entries existed.

**Marketplace**:
The listing at `.claude-plugin/marketplace.json`, and the repository it is the root of. It installs
nothing itself; it says where each plugin is.
_Avoid_: registry, catalogue, repo

**Plugin**:
One thing a person installs, with its own manifest, its own version, its own changelog and its own
tag. One lives here. A second would share the repository and nothing else: a plugin's hook may only
run a file inside its own root, so neither could import the other, and each is released by its own
tag alone.
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

**Context window**:
What one conversation holds right now: the session's own, or a subagent's, which starts empty. A
compaction starts a new one. Its transcript is the record of it, and the echo reads that record to
tell whether the map it would deliver is already in there, by the map's `digest`.
_Avoid_: session, calling a subagent's window the session's

**Shadow**:
A markdown agent file standing in for a built-in agent type, holding a copy of that type's system
prompt so a spawn of it can be given a setting the built-in has no way to take. Nothing in it says
which build the copy was taken from.
_Avoid_: override, custom agent, subagent definition

### The corpus and its shape

**Corpus**:
Every tracked source file this repository will be counted over: what is left after the deny list, the
excluded directories, paths that escape the repository or are not a regular file in the working tree,
files a generator wrote, and a second index entry for a file already counted under a name that differs
only in case or Unicode form. The counts of where files live are taken over a wider set, every tracked file
whether source or not.
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

**Fold**:
What happens to files whose directory gets no unit of its own. A directory too small to be an area,
or pushed out at the **area ceiling**, folds into the nearest area above it, and its files are
counted there. A root the overview has no line left for folds into the roster's last line, which
counts the directories and files it took: `and 7 more directories holding 252 files`.
_Avoid_: merged, collapsed, hidden, dropped

**Area ceiling**:
The most areas one map may hold: a sixteenth of the source files, never under 120 and never over
500. Past it the smallest areas fold first, by file count alone, whatever language they hold and
whatever they state.
_Avoid_: area limit, area budget, cap

**Engine**:
One of the three parser engines a language is routed to: `oxc` for JavaScript, TypeScript and a
component's script blocks, `prism` for Ruby, and `tree-sitter` for Python, PHP, Go, Java, C#, Rust
and Kotlin. A language names its engine in its declaration, and `doctor` prints a line for each.
The word has a second meaning: the model and effort a measurement trial ran at.
_Avoid_: parser (for the three as a set), backend, family

**Grammar**:
The `.wasm` file `tree-sitter` reads one language through: one per language, named after the
language's id, shipped in the plugin's `grammars/` directory. It reads less than the language's own
compiler does, so a file it cannot read is **unread** and not evidence of a syntax error. Under
`oxc` the word is the dialect a file's extension picks (`ts`, `tsx`, a declaration file), which
is a setting and no file.
_Avoid_: parser, language pack, syntax file

**Component**:
A `.vue` or `.svelte` file: markup holding at most two script blocks. Its script is counted, by the
dimensions that list its framework, and its template and style are not read. It is never a test
file, wherever it sits. The word also names what a `.tsx` or `.jsx` file renders, as in `a prop
spread lands on a component`. Such a file is a JSX file to every count here, and nothing else in
this entry applies to it.
_Avoid_: single-file component, SFC, view

**Script block**:
The body of one `<script>` tag in a component, found by its framework's own rules. It is the only
part of a component that is parsed, and a component's two blocks are read as one program at the
file's own lines.
_Avoid_: script tag, script section, inline script

**Family**:
The languages a test may be written in and still answer a source file of another: JavaScript,
TypeScript, JSX, Vue and Svelte are one family, Ruby is another, and Python, PHP, Go, Java, C#,
Rust and Kotlin are each a family of one. A test never answers a file of another family.
_Avoid_: engine, ecosystem, stack

**Test tree**:
A directory whose name puts what is under it among the tests: `test`, `tests`, `spec`,
`__tests__`, `cypress` and `e2e` for every family, and what a family's own build names one,
which is a Gradle source set ending in `Test`, a .NET project named `X.Tests` or `X.Test`, and
a `Test` or `Tests` directory in PHP. Sitting in one does not make a file a test: its name does,
or in Rust its place directly under a crate's `tests`, or a `#[test]` in it with a `tests`
directory anywhere above it.
_Avoid_: test folder, test root, spec directory

**Namesake test**:
A test file that answers one source file by carrying its stem. It says that file is tested, and nothing
about where its root keeps its tests. Always another file: a Rust source file with a `#[test]`
function **holds its own tests**, has no namesake test, and is counted apart from the files asked for one.
A Python package's `__init__.py` is asked for a test of its directory's name, since the file is the package.
A root's count of them, `63 of 243 have a namesake test`, is taken over the files a test could be
written for: source this tool reads that holds something and is no test, no story and no declaration
file, outside every test tree of its family.
_Avoid_: unit test, matching spec, paired test, sibling test

**Holds its own tests**:
Said of a Rust source file with a `#[test]` function in it, in a `mod tests` or beside the code.
The same attribute in a file under a `tests` directory, or in one named `tests.rs`, makes that file
a test file, and it is not said to hold its own tests. A file that does stays a source file, is
asked for no namesake test, and is counted in a clause of its own: `34 hold their own tests`.
_Avoid_: inline test file, self-tested, unit-tested

**Paired test project**:
A test tree the language's build ties to one source tree by name and place: a .NET `X.Tests` or
`X.Test` project with `X`, a Maven or Gradle `src/test` or `<set>Test` source set with what sits
beside it, a PHP `tests` with the `src` or `app` beside it. A test there answers the one source
file of its stem at any depth of the paired tree. Where two source files there carry the stem it
answers neither, and it answers no file of that name outside the pair. A Python `tests`
directory beside a package is paired too, and a test in it answers only the path it mirrors. No
project file is read to find a pair.
_Avoid_: test module, companion project, sibling project

**Test by place**:
A file that is a test because of where it sits, whatever its name and whatever it holds: a `.rs`
file directly under a crate's `tests` directory, which cargo builds as an integration test. A crate
is a directory holding a `Cargo.toml` or a `src`. Rust is the one language with such a rule, and its
declaration states it as `placeTests`.
_Avoid_: positional test, implicit test, integration test file

**One branch**:
How a C# file is read when the grammar rejects it as written and takes it with every preprocessor
directive line blanked and only the first branch of each `#if` kept. The file is examined, its
counts are over the branch that was kept, and the scan and the check say so wherever a blanked
branch held anything.
_Avoid_: stripped, preprocessed, partial parse

**Uncovered**:
A source file that no area holds, either because discovery found nowhere to put it, or because the area
holding it counted nothing. The map prints the two apart, since the reader's next move differs.
_Avoid_: unmapped, skipped, excluded

**Unexamined**:
A corpus file that contributed no sites, and which of the four reasons it was: **crashed** the
parser, **rejected** as syntax the parser would not take, **oversize** past the per-file cap, or
**unreadable**, meaning this tool or the filesystem could not produce it. A file that was examined
is **ok**. The reader's next move differs for each, which is why one word will not do: a crash is
this tool's, and what rejected means is the engine's to say. From `oxc` or `prism` it is a syntax
error in the repository's own code. From a `tree-sitter` grammar the file is **unread**: a syntax
error, or syntax the grammar does not cover, printed on a line of its own as a file this tool's
grammar could not read. Unread is not unreadable.
_Avoid_: failed, skipped, error, broken

**Unread**:
Said of a file one of the seven `tree-sitter` grammars could not read: its tree holds an ERROR or a
MISSING node. The file gives no site and no facet, leaves every denominator, and is counted on a
line of its own. The word says nothing about the file, which may hold a syntax error or syntax the
grammar does not cover. It runs one way only: text the language rejects and the grammar reads clean
is counted like any other file.
_Avoid_: unreadable, unparsed, broken, invalid

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

**Scope clause**:
The words on a claim line that name the files it was counted over, `, in .rb files`. It prints
where the area holds three or more source files of languages the dimension is never asked of, and
it joins the line and adds none. One or two such files earn no clause.
_Avoid_: qualifier, language suffix, filter

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
against: by running `pin`, or by merging to the remote default branch, which the pin follows on its own.
_Avoid_: snapshot, lockfile, baseline

**Hold**:
A pin that has stopped following the remote default branch while the checkout sits on its tip, because
a commit on the way was made in this clone or carries its committer identity, the tip was not brought
by a fetch, or git could not say.
Said to the person in the terminal and never to the agent, and ended by a pin taken by hand or by a
refresh that finds nothing holding it any more. The word is also said of an area: an area holding a
file of a language no parser answered for is held, its file neither rewritten nor removed, until a
scan can read that language.
_Avoid_: block, freeze, lock

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
severity: drift past the threshold, or no map or one that could not be read, no pin, no reachable base,
an empty pinned population, or a truncated scan. It caps severity and never refuses to run.
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

**Target**:
One of the three places a scan can write the map, each for one reader: `claude` for Claude Code,
`cursor` for Cursor and `copilot` for GitHub Copilot. The first is always written. Each of the other
two is written while its own overview, carrying this tool's key, is in its directory, which
`scan --targets` puts there and a clone can bring with it.
_Avoid_: destination, backend, integration, export, format

**Refresh**:
The rescan a detached worker runs on its own when HEAD, the tracked files, the pin or the plugin's
version has moved since the last scan, in a checkout that already holds a map of its own. It follows the pin where it
is safe to, and keeps the previous map when the rescan fails.
_Avoid_: rebuild, sync, auto-scan

**Degraded**:
The verdict on a type checker run that cannot be believed: under 0.80 of its type lookups resolved,
or its config was refused. The map then prints no count for a type-checked claim, and the overview
gives the share that resolved and the reason. The other verdict of a run that finished is `ok`.
_Avoid_: broken, failed, partial, low confidence

**Carried verdict**:
A type checker verdict of `degraded` that a refresh writes again without running the checker. A
scan measured it, and nothing its stamp holds has moved since: this version, where `typescript`
resolves, the size and modification time of `node_modules` and of the install record in it, and the
name and bytes of the root config. The record marks
it `carried` with the moment it was measured, and the overview says the UTC day. Only `degraded` is
carried: an `ok` verdict is measured on every refresh, and a scan run by hand always measures.
_Avoid_: cached verdict, stale verdict, skipped check

**Left alone**:
Said of a Cursor or Copilot copy of the map that a refresh neither writes, removes nor turns off,
because the repository tracks that target's overview file. The rest of the map is written, and the
record keeps the names it had for that copy. A scan run by hand leaves nothing alone.
_Avoid_: held, skipped, frozen, locked

**Stopped**:
Said of a Cursor or Copilot directory that one scan could not write and did not name with
`--targets`: the directory has no write permission, or a file there could not be replaced, removed
or created. Nothing there is written or removed by that scan, and the rest of the map is written.
The summary says so with a remedy, `--format json` carries `unwritable` on that target, and a
refresh lists the directory under `stopped` in `refresh.json` and comes due again on its retry clock
while it stays so. A scan that names the target refuses whole.
_Avoid_: left alone, locked, skipped, failed

**Main checkout**:
The checkout a linked worktree was added from, the one whose `.git` directory holds the worktree's
registration. A worktree with no map of its own is answered from its main checkout's map and facts, and
the text that reaches the agent says so.
_Avoid_: parent repo, primary checkout, origin

**Notice**:
The one sentence handed to the agent before a file is written, saying where that kind of file's tests
already go. No scan wrote it: it is composed for the path in hand, and no area file carries it.
_Avoid_: warning, hint, directive, message

**Facts**:
The machine record of every slot, gated or not, including which side was stated. The map is derivable from
it, and the check reads it rather than reading the map.
_Avoid_: cache, state, database, store

**Layout file**:
The facts' layout written again on its own beside them, stamped with the size and mtime of the facts
file it was taken from, so a hook can read the layout without parsing every count. A stamp that does
not match the facts on disk means it describes some other record, and the facts are read instead.
_Avoid_: index, cache, summary

### The check

**Finding**:
One site a branch introduced that the check reports, whether or not a directive was stated over it. The
severity says which. One rule answers for a path rather than for a site.
_Avoid_: violation, error, issue, offence

**Change set**:
What a branch changed: the committed diff from the merge base, the edits still pending in the working
tree, the renames, and the lines each file gained. The check and the end-of-turn hook read the same
one.
_Avoid_: diff, changes, delta

**Newly introduced**:
Present at the branch tip and absent at the merge base, matched by content rather than by position, so a
rename or an added import forges nothing. With no merge base to compare against, the run falls back to
the lines added since the oldest commit the clone holds, which is positional, and says so.
_Avoid_: new, added, changed

**Severity**:
How far a finding is trusted, from a site nothing was counted about, up to a site whose area's baseline
was perfect.
_Avoid_: priority, level, confidence
