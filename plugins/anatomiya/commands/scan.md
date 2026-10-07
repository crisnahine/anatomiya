---
description: Scan this repository and write down what each directory already does
---

Run the scan and report what it found.

After the first scan in a checkout the map keeps itself current: a background refresh rescans at the
start of each session and whenever HEAD moves. Run this when the user asks for it, or to see the report.

1. Run the scanner. Use Bash, and use the plugin's own copy:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" scan .
   ```

   Add `--dry-run` if the user wants to see what would change before anything is written. Nothing
   is written under that flag, so the map on disk is still the previous one.

   If the user asks for the map in Cursor or GitHub Copilot as well, name them once:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" scan . --targets cursor,copilot
   ```

   The same map is then also written under `.cursor/rules/` and `.github/instructions/`, and every
   later scan keeps writing a target that is on, which it is while its `anatomiya-overview` file
   is there, so do not pass the flag again. `--targets` names
   the whole set: `--targets cursor` leaves Copilot out, and `--targets claude` turns both off and
   removes the files this tool wrote there. Pass it only when the user asks for a target to be
   added or dropped. If the scan refuses over a file or a link in one of those directories, show
   the sentence and stop: it wrote nothing anywhere.

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
   - files this tool's grammar could not read, in Python, PHP, Go, Java, C#, Rust or Kotlin. The
     line says that is a syntax error or syntax the grammar does not cover, so do not tell the user
     those files are broken. And C# files read with one branch of each `#if`
   - a language it read no file of, with the reason and the remedy on the line after it. The rest
     of the map is still written, and the areas holding that language keep what the last scan that
     could read it wrote
   - how many files it wrote, or would write, and how many area files it removed
   - one group of lines per other directory, where one is involved: how many files it wrote under
     `.cursor/rules` or `.github/instructions`, how many it removed there, that the directory is
     off now, how many areas have no file there because no pattern of theirs can be given to that
     tool, how many entries named `anatomiya-*` there it neither wrote nor removed, and a
     directory it could not read, with the reason and what to do about it
   - every file in `.claude/rules/` this tool did not write, since those also reach the agent on
     every turn. The scanner names them one per line, and names separately any file carrying our
     frontmatter that no map lists, which it leaves alone rather than removing

   Report only the lines it printed. A line the scanner left out is zero, not a number to guess at.

3. **Do not open the generated files with the Read tool.** Reading a context file permanently
   suppresses its automatic injection for the rest of the session, which turns the map off for the
   very session that just built it. Use `cat` or `head` through Bash if you need to show one.

4. Tell the user what reaches a session already running: it gets the new overview on its next
   prompt or tool call. An area file it has already read keeps its old counts until the window is
   rebuilt: a new session, a compaction or `/clear` loads the whole map.

If the scanner exits non-zero, show its output and stop. Do not guess at what it found.

If the reason line says an engine was stopped by its own clock before it answered, the install is
not the cause, so do not run setup. Say that the parser stalled on this machine and that a scan on a
quieter machine, or with whatever blocked its startup removed, is the next move.

If it says a parser engine is not installed, run the readiness probe:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" doctor
```

For a node-hosted engine (`oxc`, or `tree-sitter` reported absent),
`node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" setup` installs it.
Tell the user first that setup runs npm in the plugin's own directory, which is the only command
here that installs anything. Any other engine carries its own remedy on its doctor line, and npm
cannot install an interpreter. A grammar file that did not load is the plugin's own file, so its
remedy is to reinstall the plugin and setup does not help. Then run the scan again.

### The type checker

The scan runs the TypeScript checker on its own when the optional `typescript` 5.x dependency is
installed, the repository's own dependencies are on disk inside it, and it has a root
`tsconfig.json`, a root `tsconfig.base.json` where there is none, or a TypeScript source file that
is not a declaration file. A `node_modules` linked
in from outside the repository is not read, so it counts as no dependencies, and a `jsconfig.json`
does not count as a config. Missing any of these, the scan leaves the checker off and records why in
`semantic.reason`; plain JavaScript reads `plain-javascript`. With it, a scan measured about 5x a
plain one on a 3,800-file repository and about 10x on a 2,600-file one, and it cannot be narrowed to
the files that changed. A scan you run always runs it. A background refresh does not where the
last run measured the checker as degraded and the plugin version, the packages and the root config
are unchanged: it carries that verdict, the record says so in `semantic.carried` with
`semantic.measuredAt`, and the overview adds the day it was measured. A degraded checker's claims
are not counted either way, so the area files are the ones your scan wrote. On a pinned repository a type-checked claim is measured against its area's
pinned files, and stays closed in an area where a checked file changed since the pin. The share of
type lookups that resolved is taken over files in the areas the map describes, so a vendored bundle
outside them does not lower it.
