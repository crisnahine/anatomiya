---
description: Scan this repository and write down what each directory already does
---

Run the scan and report what it found.

1. Run the scanner. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" scan .
   ```

   Add `--dry-run` if the user wants to see what would change before anything is written. Nothing
   is written under that flag, so the map on disk is still the previous one.

2. Report what came back, in this order:
   - how many files and areas, and how long it took
   - how many claims were stated, and how many printed as counts only
   - which population the gates read: the baseline line names the pinned commit, or says no
     baseline is pinned. Unpinned means the claims are measured against the current working tree
     and no later check finding can exceed FIX
   - whether only part of the corpus was read. That line means every directive was suppressed, so
     the run is counts over an arbitrary subset, not a scan of the repository. No repository size
     causes it
   - what it could not cover: files in no area, files that crashed the parser, files that failed to
     parse, files over the per-file size cap, and history git could not read, which fails the author
     gate on every claim
   - how many files it wrote, or would write, and how many area files it removed
   - whether any file in `.claude/rules/` was not written by this tool, since those also reach the
     agent. The scanner prints a count and no names; `ls .claude/rules` names them

   Report only the lines it printed. A line the scanner left out is zero, not a number to guess at.

3. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session, which turns the map off for the
   very session that just built it. Use `cat` or `head` through Bash if you need to show one.

4. Tell the user that a session already running still holds the previous map. A rewritten context
   file does not re-attach mid-session; a fresh session picks up the new one.

If the scanner exits non-zero, show its output and stop. Do not guess at what it found.
