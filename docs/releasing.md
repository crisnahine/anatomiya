# Releasing

This marketplace holds two plugins that ship apart. Work the list for the one you are releasing.

| plugin | tag | manifests | changelog |
| --- | --- | --- | --- |
| `anatomiya` | `vx.y.z` | `plugins/anatomiya/package.json`, `plugins/anatomiya/.claude-plugin/plugin.json`, `package-lock.json` | `CHANGELOG.md` |
| `ultracode-anywhere` | `ultracode-anywhere-vx.y.z` | `plugins/ultracode-anywhere/.claude-plugin/plugin.json` | `plugins/ultracode-anywhere/CHANGELOG.md` |

The table lives in `scripts/release.mjs` and a test holds this copy of it to that one. The workflow
fires on both tag shapes and refuses a tag whose manifests disagree with it or whose changelog has no
section of its own, naming which. What it cannot tell you is what to do about it, which is what the
rest of this page is for.

`v0.1.9` was released by hand four seconds before its own workflow run started, so the run went red
on a release that already existed. Push the tag and let the workflow make the release.

## Before the version moves

- [ ] `npm test` passes locally.
- [ ] `npm run check:docs` passes. It is the mechanical half of this list: for every plugin, the
      version agreement across its manifests and a changelog section for the version it carries,
      plus an `## [Unreleased]` heading in each changelog. For anatomiya it also reads the dimension
      and decision-row counts in `README.md`, `docs/why.md` and `CONTRIBUTING.md`, the runtime
      dependency set in `README.md` and `SECURITY.md`, the gate table, the command list, and every
      shipped key having an intake row.
- [ ] `npm run validate` passes. Two checks: the manifests, and the shipped set. The second reads
      `package.json` `files` through `npm pack --dry-run` and holds it against every file the hooks
      and command files actually reach.
- [ ] `npm run coverage` passes its floors. It reads them off an lcov record rather than off the
      total, so the second plugin's five files are each held to one: an aggregate over a scope says
      nothing about one file inside it, whichever scope it is drawn around.
- [ ] CI is green on the branch. Check it, do not assume: a suite that passes here can fail there
      over `init.defaultBranch`, path separators, or 8.3 short names, and all three have.
- [ ] The corpus run reports no findings, for a change that touches counting.

## The version

Move only the manifests of the plugin you are releasing. The two version numbers answer to different
upstreams and are not meant to move together.

- [ ] The manifests in the table above. `package-lock.json` carries the plugin's version under its own
      workspace path (`npm install --package-lock-only` writes it), and that entry is the one read:
      the two at the top of the lockfile are the marketplace root's and decide nothing here.
- [ ] That plugin's changelog: rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, **and put an
      empty `## [Unreleased]` back above it**. `check:docs` reads that heading and fails without it.
- [ ] The link refs at the bottom of that changelog: replace the `[Unreleased]` compare link with
      `[x.y.z]: .../compare/<previous tag>...<this tag>`.
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
- [ ] For `ultracode-anywhere`: `VERIFYING.md` names the build the premise was last re-checked
      against, and its `README.md` states what it does and does not restore.

## Tag and confirm

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
