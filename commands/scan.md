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
   - how much of the layout printed: the root directories that got a line versus the ones that
     folded away, the test groups counted, and how many areas' roster lines state imports or reuse
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
   - every file in `.claude/rules/` this tool did not write, since those also reach the agent on
     every turn. The scanner names them one per line, and names separately any file carrying our
     frontmatter that no map lists, which it leaves alone rather than removing

   Report only the lines it printed. A line the scanner left out is zero, not a number to guess at.

3. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session, which turns the map off for the
   very session that just built it. Use `cat` or `head` through Bash if you need to show one.

4. Tell the user that a session already running still holds the previous map. A rewritten context
   file does not re-attach mid-session; a fresh session picks up the new one.

If the scanner exits non-zero, show its output and stop. Do not guess at what it found.

If it says a parser engine is not installed, run the readiness probe:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" doctor
```

For the node-hosted engine, `node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" setup` installs it.
Tell the user first that setup runs npm in the plugin's own directory, which is the one command
here that reaches the network. Any other engine carries its own remedy on its doctor line, and npm
cannot install an interpreter. Then run the scan again.

### The type checker

`--deep` adds the TypeScript checker. It is off by default because it was measured about 26x
slower than the parse and cannot be narrowed to the files that changed. It needs the optional
`typescript` dependency and the repository's own dependencies installed; without them it says
so on the map rather than printing a clean-looking count.
