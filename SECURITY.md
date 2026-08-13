# Security

anatomiya reads a git repository it did not write, and produces files that a coding agent loads into
its context automatically. Both halves of that sentence are the threat model.

If you ever run this on a clone, the input is attacker controlled. The output lands in
`.claude/rules/`, where the agent reads it without being asked. So the tool sits between an untrusted
corpus and a channel that has the agent's attention by default.

The findings in this file were reproduced as working exploits while the tool was designed. They are
not a checklist copied from somewhere. The decisions they forced are section F of `DECISIONS.md`, and
the status column there is what the code does today. This file does not claim more than that column
does. Known gaps are listed near the bottom, with names.

## What the attacker controls

Everything under the repository root: file contents, file names, directory names, symlink targets,
git history, commit subjects, author emails, `.claude/rules/`, and every configuration file an
analysis tool might read on the way past.

What is worth taking: the machine running the scan, secrets in the working tree and the environment,
and the agent's context.

There are two boundaries. Untrusted bytes coming into the process, and untrusted text going out into
a file the agent will load.

## Findings and what the code does about them

### Repository configuration is a code execution primitive

Most analysis CLIs read configuration from the repository they are pointed at, and for several of
them that configuration is code:

- `.dependency-cruiser.js` is a JavaScript module the tool imports. Importing it runs it.
- A `.rubocop.yml` `require:` key loads Ruby from the repository. Worse, a `.rubocop` args file is
  shell-split into argv before any config handling happens, so no rubocop flag closes it. There is no
  "disable config" option that runs early enough.
- An `sgconfig.yml` `customLanguages` entry is a `dlopen` of a shared object the repository supplies.

This is why anatomiya ships no third-party analysis CLI and calls parsers as libraries instead.
`oxc-parser` is the only runtime dependency. Ruby files go through `prism`, which is a default gem,
in a child started as `ruby --disable-gems -e <script>` with `RUBYOPT`, `RUBYLIB` and `GEM_HOME`
dropped from its environment, because each of those can inject a `-r` into a process about to be
pointed at repository files. The parser child gets `PATH` and `LANG` and nothing else.

### The working directory is the control that contains those tools

For anything that does read repository configuration, the flag surface is not what decides whether
the config loads. The current working directory is. A tool told to analyse `/repo` while running in
`/repo` picks up `/repo`'s config; the same tool running elsewhere usually does not.

So the Ruby parser child runs with `cwd` set to the system temp directory, not the repository. A
relative read inside that child cannot reach a repository file the parent did not hand it. Files are
handed to it over stdin as NUL delimited pairs.

### Git paths are hostile argv

Git permits newlines and leading dashes in tracked paths. Both were tested.

A tracked file named `--instruction-file-path=.git/config`, passed positionally to another tool,
caused that tool to read the repository's git config and send its contents off the machine. The
filename was the whole exploit.

The rules that came out of that:

- Arguments after `--`, so a path can never be read as an option.
- Reject a path that starts with `-` rather than trying to escape it. `lib/ruby.mjs` drops such
  files with `suspicious path` before they are queued.
- Keep repository-controlled strings out of argv when there is any other channel. Paths reach the
  Ruby parser on stdin, not the command line, which closes the whole class instead of filtering it.
- `git ls-files -z`, split on NUL. A newline split would turn one hostile filename into two corpus
  entries.
- Never a shell. `execFile`, `spawn` and `fork` only, always with an argument array.

Where a path still has to reach git, it goes inside a revision argument after a validated sha
(`git cat-file blob <sha>:<path>`), so it cannot present as an option. Shas are validated against
`/^[0-9a-f]{7,40}$/` before use, because the pin file that carries them is a repository-controlled
input like any other, and a ref is rejected if it starts with `-`.

### Everything rendered goes through one allowlist encoder

`lib/encode.mjs` is the only way a repository-controlled value reaches a generated file. It is an
allowlist, not a denylist, and that distinction is the finding.

A denylist over control characters misses bidi overrides and zero-width joiners. Those are Unicode
category Cf, not Cc, so an ASCII control filter passes them untouched, and `JSON.stringify` does not
escape them either. One filename carrying U+202E reverses the visual order of the rest of the line
in the rendered file, which is enough to make a directive read as its own opposite.

The encoder normalises to NFKC, keeps only letters, marks, numbers, punctuation, symbols and the
plain space, rejects a path that mixes scripts (Latin against Cyrillic homoglyphs), strips markdown
structure that would let a value become syntax (`|`, `---`, `<!--`, `-->`, backtick runs, a leading
block marker), caps on grapheme clusters before quoting rather than after, and emits paths JSON
quoted.

Every repository-controlled value goes through it: paths, area names, author names and emails, commit
subjects, branch names, and matched source text.

### The corpus is tracked files only

A working tree holds more than the repository does. `.env`, a Rails `master.key`, an `.npmrc` with a
publish token, `.git/config` with credentials in the remote URL, private keys. A filesystem walk
picks up all of them, and then a sample path or a quoted line carries one into a rendered file.

So the corpus is `git ls-files -z` and never a directory walk, with a deny list applied on top
(`.git/`, `.env*`, `*.pem|key|p12|pfx|jks|keystore`, `.claude/settings.local.json`, `id_rsa`,
`id_ed25519`, `.netrc`, `.npmrc`). Only source extensions survive. Each surviving path is confined to
the repository twice: lexically first because it is free, then `realpath` on both sides because
`resolve()` normalises `..` but never follows a symlink, and `readFile` does. The resolved path is
what gets read, so the check and the read cannot disagree.

### `.claude/rules/` is a repository directory

Anyone can put a file there. A clone can ship one, and a rule file with no `paths` key loads into
every session from the moment of clone, before any scan runs, in this tool's house style.

anatomiya cannot stop that. What it does instead is name it. The generated overview enumerates every
file the tool wrote, and a scan reports every other `.md` file it finds in `.claude/rules/` as
unattributed context. Deletion needs all three signals at once: the `anatomiya-` filename prefix, the
`generator: anatomiya` frontmatter key, and being known to `facts.json` from this scan. A file with
the prefix that the tool did not write is reported, never removed.

If you clone an unfamiliar repository, read `.claude/rules/` before you start a session. That is true
whether or not you use this tool.

### Parser crashes are contained by a process boundary

`oxc` can take an uncatchable `SIGSEGV` from inside `parseSync` at sufficient nesting depth. A worker
thread does not contain that, and no static pre-screen predicts it, so parsing runs in a pool of
child processes, one file per message. Per file guards: 4 MB size cap, 5s timeout, 1 GB RSS killed
after a 250ms grace. A poison file costs one file and about a millisecond of respawn, not the run.
The Ruby side streams instead of buffering, with a 15s idle timeout, because silence is what a hung
parse looks like.

This is availability, not confidentiality. A repository can still make a scan slow.

## What this does not defend against

Say the quiet part plainly.

- **A malicious repository can still waste your time.** Caps and timeouts bound the damage, but a
  corpus built to be slow will be slow.
- **The agent still reads the repository.** anatomiya narrows what reaches `.claude/rules/`. It does
  nothing about a prompt injection sitting in a source file, a README, or an issue body that the
  agent reads later.
- **No sandbox.** The scan runs with your user's permissions, your filesystem and your network. There
  is no seccomp, no container, no dropped privileges. If a parser has a memory-safety bug that gets
  past the child process boundary, it runs as you.
- **Dependencies are trusted.** `oxc-parser` from npm, `prism` from your Ruby install, `git`, and
  `ps`. Their supply chain is not something this tool checks.
- **`gh` in `lib/forge.mjs` talks to the network.** It is the measurement helper, not part of `scan`
  or `check`, and nothing in the shipped commands imports it. It uses your existing `gh`
  credentials, reads pull request metadata and comments, and writes nothing. If that matters to you,
  do not run it.
- **No semantic tier ships, so nothing here reads `tsconfig.json`.** A TypeScript-checker tier is
  decisions B7 to B9 in `DECISIONS.md` and all three are `todo`: `typescript` is not a dependency and
  the CLI takes no flag that would reach it. If it is ever built it will read the repository's
  `tsconfig.json`, which would make the "libraries read no repository configuration" claim above
  false for that mode; confining `extends` and forcing the root file list to the corpus are the
  conditions B9 puts on building it.
- **No guarantee the map is correct.** The gates in `lib/reduce.mjs` are thresholds, not proofs. A
  wrong directive is a correctness problem, not a security one, but it is worth knowing that a
  repository can shape its own numbers if it wants to.

## Known gaps in what is described above

These are real and they are tracked in `DECISIONS.md`.

- **F5 is partial.** The `--` separator rule is stated and is not yet applied at every subprocess
  call site. Paths do not currently appear as bare positional arguments anywhere, which is what makes
  today's code hold, but that is a property of the current call sites rather than an enforced
  invariant.
- **F6 is partial.** The three reads that grow with the repository now stream: `git ls-files`, `git
  log`, and the Ruby parser's output. What still buffers through `execFile` is bounded by what it
  asks for, one blob or one ref at a time, in `lib/baseline.mjs`, `lib/check.mjs` and `lib/forge.mjs`.
  A buffered read large enough makes `execFile` throw `RangeError: Invalid string length` from inside
  Node's own exit handler, where `maxBuffer` does not protect and V8 caps any string at 0x1fffffe8
  bytes. The failure is a lost run, not a leak.
- **F7 holds, with one reachable cause.** Reading only part of the corpus sets `truncated`, and every
  directive is then suppressed with the gate `corpus-truncated`, tested end to end. No repository
  size can set it; what can is the Ruby stream's per-line guard.
- **Subprocess environment is not scrubbed everywhere.** The Ruby child gets a minimal environment.
  The git calls inherit yours.

## Reporting a vulnerability

Report privately. Do not open a public issue for a security problem.

Use GitHub's private advisory form:
<https://github.com/crisnahine/anatomiya/security/advisories/new>

Useful in a report: what an attacker controls, the smallest repository that reproduces it, what you
got out of it, and the version or commit you tested. A working proof of concept is welcome and is not
required.

What you can expect, from one maintainer with no paid support behind them:

- A first reply within 7 days.
- An assessment, meaning accepted, needs more information, or not a vulnerability, within 30 days of
  that first reply.
- A fix on the main branch before any public disclosure, and credit in the advisory if you want it.
  Say so if you would rather stay anonymous.

If 7 days pass with no reply, open a public issue that says only that you are waiting on a security
report, with no details in it, and I will pick it up from there.

There is no bug bounty.

## Supported versions

anatomiya is 0.1.0 and pre-1.0. Fixes land on the main branch and there are no backports to older
tags. Run from main if you care about this.
