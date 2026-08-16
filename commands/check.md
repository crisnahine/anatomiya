---
description: Check this branch against what the repository already does, before anyone reviews it
---

Run the check and report what it found.

1. Run the checker. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" check .
   ```

   Add `--base <ref>` when the branch targets something other than the remote's default branch.
   Left alone it tries `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`.

2. Report what came back, in this order:
   - the base ref it resolved, and how many files this branch changed against it
   - every MUST-FIX, then every FIX: path, line, and the claim the site broke
   - the NIT count, listed one by one only if the user asks
   - every `note:` line it printed, and the capped-severity line above them: no map on disk, no
     merge base, a shallow clone, files with uncommitted edits it could not see, files it
     could not read or parse
   - any file in `.claude/rules/` this tool did not write, and any carrying our frontmatter that
     the map on disk does not name, since both reach the agent on every turn

3. MUST-FIX means the baseline population held zero violations of that claim, so this branch is the
   first. Nothing is blocked by it: fix the site, or say which exception it falls under. Severity
   caps at FIX whenever the map is stale, the predicate is partial, or there was no merge base, so a
   run with no MUST-FIX under a cap is a weaker signal rather than a clean bill. A repository with
   no baseline pinned caps every finding at FIX for the same reason: there is no accepted population
   that says this site is the first of its kind.

4. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session, which turns the map off for the
   session that is using it. Use `cat` or `head` through Bash if you need to show one.

5. If the map is stale, report the reason alongside the findings. Staleness caps severity, it does
   not stop the run, so the findings still stand as FIX. Do not suggest re-pinning the baseline: the
   moment a branch is under review is the moment a re-pin launders it, and that call is a human's to
   make unprompted.

Findings never set the exit code. A non-zero exit means the check could not run: show its output and
stop, and do not guess at what it found.

### The type checker

`--deep` adds the TypeScript checker. It is off by default because it was measured about 26x
slower than the parse and cannot be narrowed to the files that changed. It needs the optional
`typescript` dependency and the repository's own dependencies installed; without them it says
so on the map rather than printing a clean-looking count.

If the map holds a type-checked claim and you run without `--deep`, the report says how many
were not measured. A report with no findings does not mean those were clean.
