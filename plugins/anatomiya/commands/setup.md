---
description: Install what this plugin's own parser needs, in the plugin's own directory
---

Install the node-hosted engine's dependencies, and nothing else.

Claude Code already does this on `/plugin install`, from the lockfile this plugin ships. Reach for
this command where that install did not run or did not finish, which `/anatomiya:doctor` reports two
ways: a first line where nothing was installed at all, and an engine line where one did not load.

1. Say this to the user before running anything: setup runs `npm install` in the plugin's own
   directory, which is the only command here that installs anything or reaches a package
   registry. `scan`, `check` and `pin` never run it.

2. Run it. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" setup
   ```

   Add `--dry-run` to print the command and install nothing.

3. Report what came back: what was not installed, the command it ran, the directory it ran in, and
   what npm said. Nothing is installed into the repository being scanned. It takes no path.

4. Then run `/anatomiya:doctor` to see what answers now. A zero exit says npm succeeded, not that
   every engine is ready: npm cannot install Ruby, so an interpreter line stays whatever it was.

5. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session. Use `cat` or `head` through
   Bash if you need to show one.

If setup exits non-zero, show its output and stop. It says which of the three happened: this is
Windows, where npm is a batch file and nothing here spawns a shell, so the printed command is for
the user to run themselves; npm was not found at all; or npm ran and failed, and that one carries
npm's own words.
