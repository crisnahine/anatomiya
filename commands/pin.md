---
description: Accept the current file population as the baseline the map is measured against
---

Pin the baseline, but only when the user asked for it.

1. Run the pin. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" pin .
   ```

   Add `--dry-run` to print the delta and write nothing.

2. Report what came back:
   - the commit it pinned, and the previous one if there was a pin already
   - how many files enter the baseline population and how many leave it
   - the areas it lists, and for each one the files that left. A file leaving is a file whose
     claims are no longer counted at the baseline

3. Then run the scan again. The pin decides which population the gates read, so the map on disk is
   still measured against the old one until it is rebuilt:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" scan .
   ```

4. Never run this because a check reported findings, and never suggest it while a branch is under
   review. The pin says which files a human accepted as the population every claim is counted over.
   Re-pinning during review moves the bar to include the branch's own code, which turns the agent's
   output into the evidence for the agent's claims. It is a human's call, made unprompted.

Before the first pin the scan measures against the current working tree, and no check finding can
exceed FIX. That is the weaker mode, not a broken one.

If the pin exits non-zero, show its output and stop. A capped corpus refuses to pin, because a
partial population recorded as the whole one is the one error this file cannot be recovered from.
