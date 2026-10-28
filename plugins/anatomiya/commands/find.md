---
description: List the functions, classes and types this repository already has that match some words, before writing a new one
argument-hint: <words>
---

Look the words up in the code index the last scan wrote, and report what it found.

1. Run it from the repository. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" find '$ARGUMENTS'
   ```

   Keep the words inside the single quotes, which stop a shell reading `?` or `*` in a name such
   as `local_url?` as a pattern; take out any single quote the words hold. Pass the words a
   function doing the job would be named or documented with: `compare urls`,
   `uuid v7`, `parse json object`. A name in any casing is split into its words, so `compareUrls`
   and `compare_urls` ask the same.

2. Report the lines it printed. Each hit is the name with its parameters, `path:line`, its kind
   and the class it belongs to, how many other files import it, and the first sentence of its doc.
   More importers means more of the repository already depends on it.

3. Read the file at the line of any hit that might do the job before deciding. The index is of
   the last commit a scan read, so a function written or changed since is not in it, and in a
   linked worktree it is the main checkout's, so a hit may name another branch's line. Words
   nobody used in a name or a doc find nothing: grep for the calls the job makes as well.

If it says there is no index yet, `/anatomiya:scan` writes one.
