# What Cursor and Copilot read

Research notes, October 2026. The question is what a rule file has to look like for Cursor and for
GitHub Copilot to take it, which patterns each reader matches as written, and what is known about
when a file reaches the model. DECISIONS A102 to A106 rest on this note.

Every claim carries its source, in three kinds:

- **read**: a string or a function recovered from an installed application, with its byte offset
- **run**: code cut out of an installed application and run on its own, or a script run against this
  repository's build
- **doc**: a first-party page, quoted, with its URL

What was read, on 2026-10-07:

| product | version | where |
|---|---|---|
| Cursor | 3.20.21, commit `f09fca384ceca23f7bf21f9c23655b162641d740`, built 2026-09-13 | the application's `extensions/cursor-agent-exec/dist/main.js` (EXEC, 10,078,679 bytes) and `out/vs/workbench/workbench.desktop.main.js` (WB, 38,264,999 bytes) |
| VS Code | 1.140.0, commit `07f806f999227108933c2e30515b26eecc1fda74`, built 2026-09-30 | `out/vs/workbench/workbench.desktop.main.js` (VSW, 20,024,455 bytes) |
| Copilot Chat | 0.68.0, the extension built into that VS Code | `extensions/copilot/dist/extension.js` (CPX, 19,679,291 bytes) |

Offsets are byte offsets into those files (`EXEC@7243264`). Identifiers are minified and change
between builds, so an offset is one build's address. Nothing was launched or signed in to. Only
client code was read: what Cursor's servers do to a prompt is not visible from it.

The documentation was fetched on 2026-10-07:

- Cursor: https://cursor.com/docs/rules.md, and the 270 pages https://cursor.com/llms.txt lists,
  searched for `.mdc`, `alwaysApply`, `globs` and `.cursor/rules`.
- GitHub: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  and https://docs.github.com/en/copilot/reference/custom-instructions-support
- VS Code: https://code.visualstudio.com/docs/agent-customization/custom-instructions, and
  `microsoft/vscode` at commit `26e0111cea3247abadfdd27f991a15a6a13f1c85`,
  `src/vs/workbench/contrib/chat/common/promptSyntax/computeAutomaticInstructions.ts`.
- Codex: https://learn.chatgpt.com/docs/agent-configuration/agents-md

## 1. Cursor does not read `.claude/rules`

**read**: the string `.claude/rules` appears 0 times in 8 files of the client: EXEC, WB, the bundles of `cursor-agent-host`, `cursor-local-agent-runtime`,
`cursor-agent-worker`, `cursor-retrieval` and `cursor-always-local`, and `out/main.js`. Its walk of
`.claude/**` classifies only `SKILL.md` under `.claude/skills` and `.md` under `.claude/agents`
(EXEC@7234289). `.github/instructions` has 0 hits in the same eight.

**read**: the rule walk asks for `**/*.mdc` under `.cursor/rules` (EXEC@7253800), so a plain `.md`
there is not read.

## 2. How Cursor reads an `.mdc` file

**read**: a hand-written line reader, no YAML (EXEC@7243264). It cuts each line at its first colon,
keeps a key it does not know and reads nothing from it, and ends the frontmatter at any `---`.

**read**: `globs` is split on commas outside braces, each part trimmed (EXEC@8952537).

**read**: matching is minimatch with `{ dot: true }` and no other option, against the path relative
to the directory that holds `.cursor/rules` (EXEC@2183081). Nothing is put in front of a pattern. A
backslash in a pattern is turned into a slash first.

**run**: the reader, the splitter and the bundled minimatch were cut out of EXEC by offset and run.

| pattern | matched | did not match |
|---|---|---|
| `**/*.rb` | `a.rb`, `lib/a.rb`, `.hid/a.rb` | |
| `src/**/*.ts` | `src/a.ts`, `src/x/a.ts` | `SRC/a.ts` |
| `src/**/*.{ts,tsx}` | `src/a.ts`, `src/x/a.ts`, `src/x/a.tsx` | |
| `!test/**` | all 13 sample paths outside `test/` | the three under `test/` |
| `src/**/*.ts,!test/**` | the same 13 paths | the three under `test/` |

So a brace set works, matching is case-sensitive, and a leading `!` is a negation joined to the
other patterns by "or": one such entry makes the rule match almost every file, and it subtracts
nothing.

**read**: an `alwaysApply: true` rule is global and its `globs` are ignored (EXEC@7250763).

## 3. How VS Code reads an `.instructions.md` file

**read**: VS Code's own YAML parser (VSW@4172087 to 4192010). `applyTo` has to be one scalar: a
value is returned only where the node's type is `scalar` (VSW@4194328). A key nothing looks up is
parsed and read by nothing.

**read**: `_matches` (VSW@12028446, and the same body in CPX@14090090) splits `applyTo` on commas,
puts `**/` in front of a part that starts with neither `/` nor `**/`, and matches with
`ignoreCase: true` against the path of each file the request carries.

**run**: VS Code's parser and its glob code were cut out of VSW (VSW@3658110 to 3662160) and run.

| question | result |
|---|---|
| a sequence for `applyTo` | parsed as a sequence, so the file has no pattern |
| brace sets | `src/**/*.{ts,tsx}` matched `src/a.ts` and `src/x/a.tsx` |
| a leading `!` | `!test/**` matched 0 of 9 files |
| the `**/` prefix | `src/*.ts` matched `vendor/x/src/a.ts` |
| case | `src/*.ts` matched `SRC/A.TS` |

**read**: VS Code already reads `.claude/rules/*.md` as instructions (VSW@4148664, VSW@4150434) and
joins a rule's `paths` with `, ` into the same pattern string (VSW@4199973). **run**: a
`"!lib/x/**"` entry there becomes `**/!lib/x/**` and matches nothing.

No Copilot surface but VS Code was read or run: not the cloud agent, code review, the CLI, Visual
Studio, JetBrains or Xcode.

## 4. Which Copilot surfaces take a path-specific file

**doc**, GitHub's support reference: path-specific instructions are listed for the cloud agent and
code review on GitHub.com and not for chat there. The how-to page says: "Currently, on GitHub.com,
path-specific custom instructions are only supported for Copilot cloud agent and Copilot code
review."

## 5. When a file reaches the model

Not measured in either tool. What was read:

**read**, Cursor: a rule with `globs` is handed to the agent with the result of its first read of
a matching file (EXEC@3048623), and not on an edit or a write of a file it never read.

**doc**, Cursor: "Auto-attached when a matching file is in context." The page does not say what
"in context" covers for a project rule.

**read**, VS Code source: automatic attach matches `applyTo` against the files attached to the chat
request (`computeAutomaticInstructions.ts` lines 249 to 335), and `**`, `**/*` and `*` attach with
no file. Apart from that the model is given a list of every instruction file with its `applyTo` and
is asked to read the ones that fit: "When modifying or creating files, check for instructions whose
applyTo pattern matches the file path and follow them." So in agent mode a file the agent edits
does not bring its area file in.

Neither tool was run with a generated file to watch it arrive, and the machine this was read on
holds no Copilot CLI and no Cursor command line.

## 6. Codex

**doc**: "Codex includes at most one file per directory", walking from the project root down to
the working directory, and it "stops adding files once the combined size reaches the limit defined
by `project_doc_max_bytes` (32 KiB by default)." The page describes no frontmatter and no pattern
key.

## 7. Runs against this repository's build

Run on 2026-10-07, on the build of that day. The scripts and their outputs are not in this repository, so none of these can be run again from this file.

| what was run | result |
|---|---|
| 300 generated Cursor area files through the reader cut out of Cursor: the patterns it returns against the patterns each `globs` line was written from | 0 mismatches over 1,250 patterns |
| 302 generated Copilot area files through VS Code's parser and splitter | 0 mismatches over 1,262 patterns |
| the `.claude/rules` overview rendered with and without the target argument: 8,192 sets of optional lines, four mixes of other files in the directory, three shapes, untracked files on and off | 393,216 renders, 0 differ |
| each target's overview over the same optional lines | 196,608 combinations, none over its bound: 40, 43 and 43 lines (DECISIONS A103) |
| a write over an existing map with one file-system call failed in turn | 42 of 42 left every file as it was |
| the same write with the process killed before each commit operation, in three scenarios, then a plain scan | 118 kills, no file a person wrote was lost |
