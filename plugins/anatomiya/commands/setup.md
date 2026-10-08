---
description: Install what this plugin's own parser needs, in the plugin's own directory
---

Install the packages the node-hosted engines load, and nothing else: `oxc-parser` and
`flow-remove-types` for JavaScript and TypeScript, `web-tree-sitter` for Python, PHP, Go, Java, C#,
Rust and Kotlin, and the optional `typescript`.

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

4. Then run `/anatomiya:doctor` to see what answers now. A zero exit says npm succeeded and every
   engine npm provides loads afterwards, not that every engine is ready: npm cannot install Ruby, so
   an interpreter line stays whatever it was. Nor can it put back a grammar file: those ship in the
   plugin's own directory, so a `tree-sitter` line that names a `.wasm` file that did not load or
   is not the file the plugin shipped, or names `grammars.json`, is fixed by reinstalling the
   plugin, and setup run for it prints that line, installs nothing for it, and ends non-zero.

5. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session. Use `cat` or `head` through
   Bash if you need to show one.

Setup ends one of nine ways, and its output says which. Show the output, then do what the ending
asks:

Exit 0:

- `nothing to install: ...` and no other line. Every package is there. Say so and stop; run
  nothing else.
- `not installed: ...` then `would run npm install ...`. This was `--dry-run`. Show the command and
  the directory, and run nothing.
- `not installed: ...`, `ran npm install ...`, and a last line that says to run `/anatomiya:scan`
  again. The install ran and every engine it provides loads. Pass that last line on: a map written
  before the install is as it was, so offer to run `/anatomiya:scan` in this repository, and tell
  the user to do the same in any other repository they have a map in.

Exit non-zero. Stop after each; do not run setup again unless the ending says to:

- A `tree-sitter` line naming a `.wasm` file that did not load or is not the file the plugin
  shipped, or naming `grammars.json`, with or without an install before it. A grammar file ships
  in the plugin and no install writes one. Tell the user to reinstall the plugin, as the line says.
- `npm on Windows is a batch file ...` and `run it yourself: ...`. Nothing here spawns a shell.
  Give the user the printed command and the directory to run it in.
- `npm was not found; ...`. Tell the user to install Node.js 22 with npm, then run setup again.
- `... failed`, with npm's own words under it. Show what npm said; the fix is in those words
  (the network, a proxy, a permission), and it is the user's to make.
- `... did not finish within N minutes`. The install was stopped by its own clock. Say so, and
  offer to run setup once more.
- `npm finished, and still not loading: ...` or `npm finished, and whether the engines load now
  could not be asked: ...`. npm exited 0 and an engine is still not ready. Show the line, then run
  `/anatomiya:doctor` for that engine's own reason.
