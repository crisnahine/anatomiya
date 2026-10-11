# Releasing

This marketplace holds one plugin. It carries its own version, its own changelog and its own tag,
and a change that puts a body under `## [Unreleased]` is a release.

| plugin | tag | manifests | changelog |
| --- | --- | --- | --- |
| `anatomiya` | `vx.y.z` | `plugins/anatomiya/.claude-plugin/plugin.json`, `plugins/anatomiya/package.json`, `package-lock.json`, `plugins/anatomiya/package-lock.json` | `CHANGELOG.md` |

The table lives in `scripts/release.mjs` and a test holds this copy of it to that one. The workflow
fires on the tag shape and refuses a tag whose manifests disagree with it or whose changelog has no
section of its own, naming which. What it cannot tell you is what to do about it, which is what the
rest of this page is for.

`v0.1.9` was released by hand four seconds before its own workflow run started, so the run went red
on a release that already existed. Push the tag and let the workflow make the release.

## Before the version moves

- [ ] `npm test` passes locally.
- [ ] `npm run check:docs` passes. It is the mechanical half of this list: for every plugin, the
      version agreement across its manifests and a changelog section for the version it carries,
      plus an `## [Unreleased]` heading in each changelog and a link definition for it and for the
      version the manifests carry. For anatomiya it also reads the dimension and decision-row counts
      in `README.md`, `docs/why.md` and `CONTRIBUTING.md`, the runtime dependency set in `README.md`
      and `SECURITY.md`, the gate table, the command list, and every shipped key having an intake
      row. Run it in a checkout: it asks git for the tracked files, and where git cannot list them,
      as in a `git archive` copy, it exits 1 with two lines, the refusal and a count of one claim,
      and checks nothing.
- [ ] `npm run validate` passes. Four checks, in the order `package.json` runs them: the manifests
      (`scripts/validate.mjs`), the shipped set (`scripts/shipped.mjs`), the plugin's own lockfile
      (`scripts/plugin-lock.mjs --check`), and the grammar files (`scripts/grammars.mjs --check`).
      The second reads `package.json` `files` through `npm pack --dry-run` and holds it
      against every file the hooks and command files actually reach. The third rebuilds
      `plugins/anatomiya/package-lock.json` from the marketplace's resolutions and refuses one that
      differs, since Claude Code installs a plugin's dependencies from the lockfile beside its
      manifest and a plugin with none installs nothing at all. `npm run lock:plugin` writes it. On
      Windows it says why it did not run and passes, the way the shipped-set check does and for the
      same reason: both spawn npm, which is a batch file there. The Linux job is where either one
      actually gates. The fourth holds each `.wasm` file under `plugins/anatomiya/grammars/` to the
      SHA-256 in `grammars.json` and to the installed package's file, and each grammar's version to
      the root lockfile's.
- [ ] `npm run coverage` passes its floors. It reads them off an lcov record rather than off the
      total, so the files in a scope are each held to one: an aggregate over a scope says nothing
      about one file inside it, whichever scope it is drawn around.
- [ ] The line-ending pass shows nothing new. It runs the suite as a Windows runner checks it out:
      clone the checkout with `git -c core.autocrlf=true clone`, copy `node_modules` into the clone,
      write a file holding `[core]` and `autocrlf = true`, and run every test file in the clone one
      at a time with `GIT_CONFIG_SYSTEM` pointing at that file, so every `git init` a test makes
      converts line endings too. `git ls-files --eol` there lists the tracked text as `w/crlf` and
      the seven grammars as `w/-text`. It catches a test that reads a tracked file as text and
      compares bytes, offsets or a multi-line match. One file fails under that override on macOS
      and is no finding: `test/git.test.mjs`, in `a submodule's filter driver never runs through
      the superproject's status`, because the override replaces the machine's own system git
      config. That test is skipped on Windows. Why the clone stands in for the runner, and what
      Windows does with a held file, a process id and a name in another case, is read from the
      owners' pages and source in `docs/research/what-windows-does-with-a-name-a-lock-and-a-pid.md`.
- [ ] CI is green on the branch. Check it, do not assume: a suite that passes here can fail there
      over `init.defaultBranch`, path separators, or 8.3 short names, and all three have.
- [ ] The corpus run reports no findings, for a change that touches counting. Leave the checkout
      alone while it runs: it shells out to the binary in the working tree per repository, so a file
      edited mid-run puts two builds in one report and the failures it invents cannot be reproduced.

## The version

Move only the manifests of the plugin you are releasing. The two version numbers answer to different
upstreams and are not meant to move together.

- [ ] The manifests in the table above. `package-lock.json` carries the plugin's version under its own
      workspace path (`npm install --package-lock-only` writes it), and that entry is the one read:
      the two at the top of the lockfile are the marketplace root's and decide nothing here.
- [ ] For anatomiya, `npm run lock:plugin` after the version moves. The plugin's own lockfile carries
      that version twice, and `npm run validate` refuses a stale one, so this is caught rather than
      shipped; running it here saves the round trip.
- [ ] That plugin's changelog: rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, **and put an
      empty `## [Unreleased]` back above it**. `check:docs` reads that heading and fails without it.
- [ ] The link refs at the bottom of that changelog: keep `[Unreleased]` and retarget it to
      `.../compare/<this tag>...HEAD`, then add `[x.y.z]: .../compare/<previous tag>...<this tag>`
      under it. `check:docs` refuses a changelog missing either one.
- [ ] A summary paragraph under the new heading. The release body is that section, unedited.
- [ ] `node scripts/release.mjs <tag>` answers with the plugin, the version and a line count. That is
      the same call the workflow makes, so a tag it accepts here is a tag that will release.

## Prose the code has outgrown

`check:docs` catches the counted numbers. It does not read English, so these are by hand:

- [ ] `README.md` and `docs/how-it-works.md` describe every flag the CLI now takes, and none it does
      not. A flag documented and then refused is worse than one never mentioned.
- [ ] `commands/*.md` match the CLI. The agent reads these, not `--help`.
- [ ] `SECURITY.md` names the current dependency set and says nothing about a tier that now ships.
- [ ] `DECISIONS.md` has no `todo` row that this release actually closed, and every `**done**` note
      names the symbols that exist today.
- [ ] Merge to `main` and pull it.
- [ ] `git tag -a <tag> -m "<version>"` then `git push origin <tag>`, with the tag from the table.
      The tag is what releases; a merge alone does not, and a release made by hand turns the run red.
- [ ] The release workflow went green.
- [ ] `gh release view <tag>` shows a published, non-draft release with the changelog section as its
      body and the plugin name in its title.
- [ ] Close the issues the release closed. A comma list of `Closes #1, #2` only closes the first;
      GitHub needs the keyword per issue.

## When a job is added

Branch protection lists the CI contexts a pull request has to clear, by name. A new job produces a
new context, and until it is added to that list it runs without being able to block a merge. Adding
one is a repository setting, not a file in here.

The two supply-chain jobs in `.github/workflows/supply-chain.yml` are a deliberate split.
`dependency review` is required: it compares against the base, so it fails only on what the pull
request adds. `audit the installed tree` stays advisory: it audits the whole tree, so a new upstream
advisory against a dependency already here would fail every pull request after it, including ones
that touch no dependency. It still runs on every push to `main` and weekly, which is where a red
audit gets seen. `openssf scorecard` never runs on a pull request, so it has no context to require.
