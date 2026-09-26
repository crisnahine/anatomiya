---
description: Accept the current file population as the baseline the map is measured against
---

Pin the baseline, but only when the user asked for it.

Where the repository has a remote, the pin already follows its default branch on its own: whenever
the checkout sits on that branch's tip with nothing uncommitted, the background refresh moves the pin
there. This command is for a repository with no remote, or for a user accepting a population by hand.

1. Run the pin. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" pin .
   ```

   Add `--dry-run` to print the delta and write nothing.

2. Report what came back:
   - the commit it pinned, and the previous one if there was a pin already
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

5. Tell the user that a session already running still holds the previous map. A rewritten context
   file does not re-attach mid-session; a fresh session picks up the new one.

6. Never run this because a check reported findings, and never suggest it while a branch is under
   review. The pin says which files a human accepted as the population every claim is counted over.
   Re-pinning during review moves the bar to include the branch's own code, which turns the agent's
   output into the evidence for the agent's claims. It is a human's call, made unprompted.

Before the first pin the scan measures against the current working tree, and no check finding can
exceed FIX. That is the weaker mode, not a broken one.

If the pin exits non-zero, show its output and stop. It refuses while tracked files differ from HEAD,
since the pin records HEAD and the files it holds: tell the user to commit or stash them first, and
do not do either yourself. A capped corpus refuses to pin, because a
partial population recorded as the whole one is the one error this file cannot be recovered from.
