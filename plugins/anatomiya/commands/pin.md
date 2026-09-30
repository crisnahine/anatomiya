---
description: Accept the current file population as the baseline the map is measured against
---

Pin the baseline, but only when the user asked for it.

Where the repository has a remote, the pin already follows its default branch on its own: whenever
the checkout sits on that branch's tip with nothing uncommitted, that tip arrived by an ordinary fetch
or pull, and no commit this clone made sits on its line, the background refresh moves the pin there.
It never follows a map or pin the repository commits. This command is for a repository with no
remote, for a commit pushed straight to the default branch, or for a user accepting a population by
hand.

1. Run the pin. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" pin .
   ```

   Add `--dry-run` to print the delta and write nothing.

2. Report what came back:
   - the repository root it pinned, from the `wrote` line: a path inside a repository pins the whole
     of it
   - the commit it pinned, and the previous one if there was a pin already. Where the pin on disk
     could not be read, say that it was replaced and why: a merge conflict in it, or a newer build's
     pin, is the user's to know about
   - how many files enter the baseline population and how many leave it, and how many only moved
     between areas
   - the areas it lists, and for each one the files that left. A file leaving is a file whose
     claims are no longer counted at the baseline. A file that moved is still counted, in its new
     area

3. Then run the scan again. The pin decides which population the gates read, so the map on disk is
   still measured against the old one until it is rebuilt:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" scan .
   ```

4. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session, which turns the map off for the
   very session that just rebuilt it. Use `cat` or `head` through Bash if you need to show one.

5. Tell the user what reaches a session already running: it gets the new overview on its next
   prompt or tool call. An area file it has already read keeps its old counts until the window is
   rebuilt: a new session, a compaction or `/clear` loads the whole map.

6. Never run this because a check reported findings, and never suggest it while a branch is under
   review. The pin says which files a human accepted as the population every claim is counted over.
   Re-pinning during review moves the bar to include the branch's own code, which turns the agent's
   output into the evidence for the agent's claims. It is a human's call, made unprompted.

Before the first pin the scan measures against the current working tree, and no check finding can
exceed FIX. That is the weaker mode, not a broken one.

If the pin exits non-zero, show its output and stop, and relay the remedy it names without acting on
it yourself. It refuses while tracked files differ from HEAD, since the pin records HEAD and the files
it holds (commit or stash them), mid-merge (finish or abort the merge), with unmerged paths left by a
rebase, cherry-pick or stash pop (resolve them, or abort what left them), and in a sparse checkout that
leaves tracked source out of the tree. A population that makes no area refuses too, since it would hold
back every area made after it, and so does a store this process cannot write or enter.
