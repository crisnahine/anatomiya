# How the language replication picks its tasks

Date: 2026-10-26. Written and committed before any repository below was scanned for it, so the tasks it
yields are not chosen by the person who has seen how the plugin did on them.

Every reuse task measured before this one was JavaScript, TypeScript or Ruby, because the rule that
picked them read the "most imported from here" line, and only JavaScript areas had one. From this
release every language the plugin reads has that line. This rule picks one task per tree-sitter
language, runs them the way the earlier tasks ran, and reports every result.

## The rule

1. **Repositories.** For each of Python, PHP, Go, Java, C#, Rust and Kotlin, go down the applications
   corpus table in `docs/measurements/corpus.md`, in its order, at the commit it names. Take the first
   repository whose tracked source files are mostly that language, that holds fewer than 10,000 tracked
   files, and that passes step 2.
2. **Helpers.** Run `scan` from this repository at the commit that adds this rule's scenarios. From
   every area file, collect each name in a "most imported from here" line with its importing-file
   count. Keep a name that is a function or a method the area's own code defines: a Python `def`, a Go
   `func` (written `package.Func`), a static or companion method or a top-level function in Java,
   Kotlin, C# or PHP (written `Class.method`, `Class::method` or `function`), and a Rust `fn`. Drop
   classes, interfaces, types, constants, support files, and a name whose file is under a test
   directory. Take the name with the most importing files; break a tie by the name's alphabetical
   order. A repository with no such name fails this step.
3. **The task.** Ask for one small new file, in an area that holds no file importing the helper, where
   the language's own build and the repository's lint let the new file import it: the same module,
   crate, project or package graph as files that already import the helper's module. Describe the
   behaviour the helper's own code implements, as one part of a feature, in plain words, and never
   name the helper, its file or its directory. Keep the prompt to the shape of the earlier prompts: the
   path of the new file, what it defines, the behaviour, and "Keep it small."
4. **The checks.** `did`: the new file exists. Check: the new file names the helper and calls it, as
   a pattern over the file, written for the language (an import or a `use` where the language needs
   one). Nothing else is scored in advance.
5. **The runs.** Each scenario file is committed before its first session. 20 sessions per arm on
   `claude-opus-5-5` at medium effort and again on `claude-haiku-5-5` at medium effort, with the same
   harness, tools and limits as the 2026-10-25 and 2026-10-26 runs. Every result is published, whatever
   it shows.

## Where the rule leaves judgement

Step 3 is written by someone who has seen the helper, so the prompt's wording and the new file's area
are choices, within the limits above. The prompts are published with the scenarios, so a reader can
judge whether one gives the answer away.
