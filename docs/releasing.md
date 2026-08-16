# Releasing

Every item here exists because it went wrong or is enforced by something that will fail the release.
Work it top to bottom. The workflow refuses a tag whose manifests disagree, so a half-done release
does not ship, but it also does not tell you which half.

`0.1.10` shipped with no tag at all, which is why the last step is on this list.

## Before the version moves

- [ ] `npm test` passes locally.
- [ ] `npm run check:docs` passes. It is the mechanical half of this list: version agreement between
      `package.json` and `.claude-plugin/plugin.json`, a `CHANGELOG.md` section for that exact
      version, an `## [Unreleased]` heading it can read, the dimension and decision-row counts in
      `README.md`, `docs/why.md` and `CONTRIBUTING.md`, the runtime dependency set in `README.md` and
      `SECURITY.md`, the gate table, the command list, and every shipped key having an intake row.
- [ ] `npm run validate` passes (`plugin.json`, `marketplace.json`).
- [ ] `npm run coverage` passes its floors.
- [ ] CI is green on the branch. Check it, do not assume: a suite that passes here can fail there
      over `init.defaultBranch`, path separators, or 8.3 short names, and all three have.
- [ ] The corpus run reports no findings, for a change that touches counting.

## The version

- [ ] `package.json`
- [ ] `.claude-plugin/plugin.json` (the workflow compares it against the tag and refuses a mismatch)
- [ ] `package-lock.json` (`npm install --package-lock-only`), which carries it twice
- [ ] `CHANGELOG.md`: rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, **and put an empty
      `## [Unreleased]` back above it**. `check-docs` reads that section and fails without the
      heading.
- [ ] `CHANGELOG.md` link refs at the bottom: replace the `[Unreleased]` compare link with
      `[x.y.z]: .../compare/v<previous>...v<this>`.
- [ ] A summary paragraph under the new heading. The release body is that section, unedited.

## Prose the code has outgrown

`check-docs` catches the counted numbers. It does not read English, so these are by hand:

- [ ] `README.md` and `docs/how-it-works.md` describe every flag the CLI now takes, and none it does
      not. A flag documented and then refused is worse than one never mentioned.
- [ ] `commands/*.md` match the CLI. The agent reads these, not `--help`.
- [ ] `SECURITY.md` names the current dependency set and says nothing about a tier that now ships.
- [ ] `DECISIONS.md` has no `todo` row that this release actually closed, and every `**done**` note
      names the symbols that exist today.

## Tag and confirm

- [ ] Merge to `main` and pull it.
- [ ] `git tag -a vx.y.z -m "x.y.z"` then `git push origin vx.y.z`. The tag is what releases; a merge
      alone does not.
- [ ] The release workflow went green.
- [ ] `gh release view vx.y.z` shows a published, non-draft release with the changelog section as its
      body.
- [ ] Close the issues the release closed. A comma list of `Closes #1, #2` only closes the first;
      GitHub needs the keyword per issue.
