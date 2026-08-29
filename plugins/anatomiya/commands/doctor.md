---
description: Say which parser engines this installation can run, and what to do about one it cannot
---

Run the readiness probe and report what it said.

1. Run it. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" doctor
   ```

2. Report every line it printed, as it printed them. A line that is not `ok` carries what was
   wrong and what to do about it, and the remedy differs per engine: npm cannot install an
   interpreter, and installing Ruby does not install a node module. Report only the lines it
   printed. It takes no path and answers about this installation, not about any repository.

3. A first line reading `nothing is installed here: ...` is one fault, not one per engine below it:
   Claude Code installs this plugin's dependencies on `/plugin install`, and that install did not
   run or did not finish. Offer `/anatomiya:setup` and say nothing about the engine lines it
   explains.

4. Otherwise, if a node-hosted line says something is not installed, offer `/anatomiya:setup`, and
   say before running it that setup runs npm in the plugin's own directory. For any other engine,
   report the remedy its line carries and stop there: installing an interpreter is the user's call.

5. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session. Use `cat` or `head` through
   Bash if you need to show one.

The probe exits 0 whether or not everything is ready. What it found is on the lines, so a zero exit
is not a clean bill.
