---
description: Install what this plugin's own parser needs, in the plugin's own directory
---

Install the node-hosted engine's dependencies, and nothing else.

1. Say this to the user before running anything: setup runs `npm install` in the plugin's own
   directory, which is the one command here that reaches the network. `scan`, `check` and `pin`
   never run it.

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

If setup exits non-zero, show its output and stop. It says which of the two happened: npm was not
found at all, or npm ran and failed, and the second one carries npm's own words.
