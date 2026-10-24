# What a public launch rests on

Research notes, 2026-10-24. The repository `crisnahine/anatomiya` is public and about to be announced.
Three questions decide what it should look like on that day: what Anthropic's terms say about text or
code read out of an installed Claude Code build, who can still read an issue or pull request body after
it is edited, and what GitHub and OpenSSF expect a public repository to have. No legal opinion is given.
Where a page is silent, this note says so.

Every claim carries its source, in two kinds:

- **doc**: a first-party page or file, quoted, with its URL
- **run**: a command and its output on 2026-10-24, read-only. No call here wrote to GitHub or anywhere
  else.

Every page was read on 2026-10-24. Anthropic's legal pages were fetched as HTML and read as text.
GitHub's docs were read through `https://docs.github.com/api/article/body?pathname=<page path>`, which
returns the article's Markdown. The installed Claude Code is 2.1.310, a native build, so its npm
package `@anthropic-ai/claude-code@2.1.310` was fetched with `npm pack` to read the files it ships.

## Summary

| # | Question | Answer | This repository |
|---|---|---|---|
| 1 | Do Anthropic's terms let text or code from the Claude Code build appear in an MIT repository? | No clause grants it. Both terms that govern Claude Code restrict reverse engineering; the consumer terms add "reduce our Services to human-readable form". No page speaks of quoting a prompt or a string | Fourteen research notes and `docs/plugin-contract.md` quoted the build. The change this note shipped with describes it in them instead, and `check:docs` refuses a byte offset into a build (G17) |
| 2 | Who sees an edited body's earlier versions, and can they be removed? | Anyone with read access, so anyone, on a public repository. The author or anyone with write access can delete a revision, in the web UI. No API mutation deletes one, and none deletes a pull request | 15 issues hold 32 edit records and 15 pull requests hold 43; none was deleted |
| 3 | What does launch expect, and is it here? | Community files, a security policy with a working private channel, a code of conduct with a real contact, topics, and Scorecard's file and settings checks | Private vulnerability reporting was off while `SECURITY.md` sent reporters to its form, and the code of conduct held a TODO for its contact. Both are fixed in the change this note shipped with. No topics |

## 1. Anthropic's terms on Claude Code's code and prompts

### Which terms govern Claude Code

- **run** `npm pack @anthropic-ai/claude-code@2.1.310`: the package holds `bin/claude.exe`,
  `cli-wrapper.cjs`, `install.cjs`, `sdk-tools.d.ts`, `package.json`, `README.md` and `LICENSE.md`.
  `npm view @anthropic-ai/claude-code license` prints `SEE LICENSE IN README.md`.
- **doc** `LICENSE.md` in that package, whole: "© Anthropic PBC. All rights reserved. Use is subject to
  the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance."
- **doc** `LICENSE.md` in `anthropics/claude-code` at `318b7e6`, whole: "© Anthropic PBC. All rights
  reserved. Use is subject to Anthropic's [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)."
  The package's `README.md` points at the same Commercial Terms and the Privacy Policy.
- **doc** Legal and compliance, https://code.claude.com/docs/en/legal-and-compliance, under "License":
  "Your use of Claude Code is subject to: Commercial Terms of Service - for Team, Enterprise, and Claude
  API users; Consumer Terms of Service - for Free, Pro, and Max users". Under "Acceptable use": "Claude
  Code usage is subject to the Anthropic Usage Policy." The page's own footer: "Use is subject to
  applicable Anthropic Terms of Service."

So which clause binds depends on how the person signs in. Both are quoted.

### Commercial Terms (effective Jun 17, 2025)

- **doc** https://www.anthropic.com/legal/commercial-terms, the opening paragraph: the terms "govern
  Customer's use of Anthropic API keys and any other Anthropic offerings that references these Terms,
  as well as all related Anthropic tools, documentation and services (the "Services")."
- Section D.4, Use Restrictions: "Customer may not and must not attempt to (a) access the Services to
  build a competing product or service, including to train competing AI models or resell the Services
  except as expressly approved by Anthropic; (b) reverse engineer or duplicate the Services; or (c)
  support any third party's attempt at any of the conduct restricted in this sentence."
- Section F, Intellectual Property, whole: "Except as expressly stated in these Terms, these Terms do not
  grant either party any rights to the other's content or intellectual property, by implication or
  otherwise."
- Section B gives the customer its Outputs: "Customer (a) retains all rights to its Inputs, and (b) owns
  its Outputs." Section I.3.a lets Anthropic suspend access where a user breaks D.4, and K.2 makes the
  customer indemnify Anthropic for claims tied to "use of the Services in violation of ... Section D.4".

### Consumer Terms (effective Oct 8, 2025)

- **doc** https://www.anthropic.com/legal/consumer-terms, the opening paragraph: the terms govern
  "Claude.ai, Claude Pro, and other products and services that we may offer for individuals, along with
  any associated apps, software, and websites (together, our "Services")."
- Section 3, Use of our Services, the items that bear on this question: "You may not access or use, or
  help another person to access or use, our Services in the following ways: ... To decompile, reverse
  engineer, disassemble, or otherwise reduce our Services to human-readable form, except when these
  restrictions are prohibited by applicable law. To crawl, scrape, or otherwise harvest data or
  information from our Services other than as permitted under these Terms. ... To infringe,
  misappropriate, or violate intellectual property or other legal rights". The section closes: "You
  also must not abuse, harm, interfere with, or disrupt our Services, including, for example, ...
  bypassing any of our systems or protective measures."
- Section 9, Software: "Anthropic Software may include open source software. In the event of any
  conflict between these Terms and any other Anthropic or third-party terms applicable to any portion
  of Anthropic Software, such as open-source license terms, such other terms will control as to that
  portion of the Anthropic Software and to the extent of the conflict."
- Section 10, Ownership of the Services: "We and our Providers retain all of our respective rights,
  title, and interest, including intellectual property rights, in and to the Services. Other than the
  rights of access and use expressly granted in our Terms, our Terms do not grant you any right, title,
  or interest in or to our Services."

### Usage Policy (the page shows "Effective Nov 12, 2026")

- **doc** https://www.anthropic.com/legal/aup: it "applies to anyone who submits inputs to Anthropic's
  products or services ... This includes individuals using our apps (such as Claude.ai and Claude
  Code)". Under "Do Not Abuse Our Platform": "Intentionally bypass or interfere with capabilities,
  restrictions, or guardrails established within our products, including by circumvention of the
  account sign-up or log-in process or by instructing the model to produce harmful outputs (e.g.,
  jailbreaking or prompt injection), without prior authorization from Anthropic", and "Use outputs to
  train an AI model (e.g., "model scraping" or "model distillation") without prior authorization from
  Anthropic".
- The Usage Policy has no clause on reverse engineering, decompiling, copying code, or extracting a
  system prompt. The effective date it shows is later than the day it was read; its version history was
  not read.

### What the text says, and where it is silent

- No page read grants a right to copy, publish or redistribute Claude Code's code or its prompts. Both
  `LICENSE.md` files say "All rights reserved", and both sets of terms say they grant no intellectual
  property right beyond use.
- Commercial D.4 restricts "reverse engineer or duplicate the Services". Consumer Section 3 restricts
  "decompile, reverse engineer, disassemble, or otherwise reduce our Services to human-readable form",
  with an exception "when these restrictions are prohibited by applicable law". Both define Services to
  take in software and tools.
- Silent: no page says whether reading strings out of an installed build is reverse engineering, whether
  a short quotation of a prompt or an identifier is duplicating, or anything about publishing such a
  quotation. No page names prompts at all. Consumer Section 9 says open source parts of Anthropic
  Software follow their own licenses, and no page says which parts of Claude Code those are.
- Not covered by these terms: the Claude Code documentation at code.claude.com is a separate question.
  Its footer says use "is subject to applicable Anthropic Terms of Service". A link to a page is a
  citation; this note read nothing on copying the docs' text.

## 2. Edited issue and pull request bodies

- **doc** Tracking changes in a comment,
  https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment:
  "Anyone with read access to a repository can view a comment's edit history." And: "Comment authors and
  anyone with write access to a repository can delete sensitive information from a comment's edit
  history. When you delete sensitive information from the comment's edit history, the person who made
  the edit and when they made the edit is still visible in the comment history but the content of the
  edit is no longer available." The steps are in the web UI: **edited**, pick the edit, **Options**,
  **Delete revision from history**, which deletes "the diff that shows the content being added". On
  limits: "A 100-edit maximum applies to issues, issue comments, pull requests, pull request review
  comments, and commit comments ... the original content and the most recent 99 edits are always
  preserved."
- **doc** Deleting an issue,
  https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue:
  "People with admin permissions in a repository can permanently delete an issue from a repository."
  "The only account that can delete issues in a repository owned by a personal account is that
  account." "When visiting the URL of a deleted issue, collaborators will see a message stating that the
  web page can't be found (but they can use the API to determine that it was deleted)."
- **doc** REST, Get an issue, https://docs.github.com/en/rest/issues/issues: "If the issue was deleted
  from a repository where the authenticated user has read access, the API returns a 410 Gone status."
  So a deleted issue leaves a number that answers 410, and its content is gone from GitHub's own pages.
  Copies already taken elsewhere are out of GitHub's reach.
- **doc** GraphQL reference, Issues, https://docs.github.com/en/graphql/reference/issues: `Issue` and
  `PullRequest` carry "`userContentEdits` (UserContentEditConnection): A list of edits to this content",
  and `deleteIssue` "Deletes an Issue object."
- **doc** GraphQL reference, Users, https://docs.github.com/en/graphql/reference/users,
  `UserContentEdit`: fields `diff` ("A summary of the changes for this edit"), `editor`, `editedAt`,
  `deletedAt` ("Identifies the date and time when the object was deleted") and `deletedBy`.
- **run** schema introspection, `gh api graphql` on `__schema { mutationType { fields { name } } }`:
  there is `deleteIssue`, `deleteIssueComment`, `deletePullRequestReview`,
  `deletePullRequestReviewComment` and `minimizeComment`. There is no `deletePullRequest` and no
  mutation that deletes a `UserContentEdit`. The REST issue object (`gh api
  repos/crisnahine/anatomiya/issues/250 --jq keys`) has `body` and no edit history field.
- **doc** Removing sensitive data from a repository,
  https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository,
  on pull requests: "you can permanently remove cached views and references to the sensitive data in
  pull requests on GitHub by contacting us through the GitHub Support portal", and "GitHub Support won't
  remove non-sensitive data". That page is about commits, not bodies; no page read says how to remove a
  pull request itself.

So on a public repository every earlier version of an edited body is readable by anyone, through the
**edited** menu or `userContentEdits.diff`. Only deleting each revision in the web UI, by its author or
someone with write access, removes the content, and the editor and time stay. An issue can be deleted
by the owning account. A pull request cannot be deleted from the API, and no docs page read offers a way.

- **run** `userContentEdits` counted over every issue and pull request of `crisnahine/anatomiya`
  (165 issues, 85 pull requests): 15 issues hold 32 edit records and 15 pull requests hold 43. None has a
  `deletedAt`. One sampled pull request's two records carry diffs of 3200 and 2635 characters, so the old
  text is there in full, not a stub. Issue comments and review comments were not counted.

## 3. What a public repository is expected to have at launch

### GitHub's community profile

- **doc** About community profiles for public repositories,
  https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories:
  the checklist "checks to see if a project includes recommended community health files, such as
  README, CODE_OF_CONDUCT, LICENSE, or CONTRIBUTING, in a supported location". Issue templates count
  only if they sit "in the `.github/ISSUE_TEMPLATE` folder and contain valid `name:` and `about:` keys in
  the YAML frontmatter".
- **doc** REST community metrics, https://docs.github.com/en/rest/metrics/community: "The
  health_percentage score is defined as a percentage of how many of the recommended community health
  files are present."
- **run** `gh api repos/crisnahine/anatomiya/community/profile`: `health_percentage` 100; code of
  conduct, contributing, license (MIT), readme and pull request template found; `issue_template` is
  `null`, although `main` holds `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`, each with
  `name:` and `about:`. Why the API answers `null` was not settled; the web checklist was not looked at.
  The response's `documentation` is `https://github.com/crisnahine/anatomiya/tree/master/docs`, while the
  default branch is `main`. Where GitHub takes that link from was not found.

### Private vulnerability reporting and the security policy

- **doc** Configuring private vulnerability reporting for a repository,
  https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository:
  "Owners and administrators of public repositories can allow security researchers to report
  vulnerabilities securely in the repository by enabling private vulnerability reporting." It is turned
  on in Settings, "Advanced Security", "Private vulnerability reporting", **Enable**. "When private
  vulnerability reporting is enabled, security researchers see a **Report a vulnerability** button on the
  repository's "Advisories" page". A `.github/VULNERABILITY_REPORT.yml` customizes the form; by default
  it asks for "a summary, details, proof of concept, and impact statement".
- **doc** Privately reporting a security vulnerability,
  https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability:
  "Private vulnerability reporting is separate from a repository's `SECURITY.md` file. You can only
  report vulnerabilities privately for repositories where this feature is enabled." And: "If the
  repository doesn't have private vulnerability reporting enabled, you need to initiate the reporting
  process by following the instructions in the security policy for the repository, or by creating an
  issue asking the maintainers for a preferred security contact."
- **doc** REST repositories, https://docs.github.com/en/rest/repos/repos: "Check if private
  vulnerability reporting is enabled for a repository", `GET /repos/{owner}/{repo}/private-vulnerability-reporting`;
  `PUT` enables it and `DELETE` disables it.
- **run** `gh api repos/crisnahine/anatomiya/private-vulnerability-reporting`: `{"enabled":false}`.
- **run** `curl` of `https://github.com/crisnahine/anatomiya/security/advisories/new` without a session:
  302 to the sign-in page. What a signed-in stranger sees there while the feature is off was not seen;
  the doc above says no private report can be made.
- `SECURITY.md`, "Reporting a vulnerability": "Use GitHub's private advisory form:
  <https://github.com/crisnahine/anatomiya/security/advisories/new>", with a first reply in 7 days and an
  assessment within 30. Its fallback after 7 days is a public issue with no details. It names no email.

### Code of conduct

- **doc** Contributor Covenant 2.1, https://www.contributor-covenant.org/version/2/1/code_of_conduct/,
  "Enforcement": "Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to
  the community leaders responsible for enforcement at [INSERT CONTACT METHOD]. All complaints will be
  reviewed and investigated promptly and fairly."
- **run** `gh api 'repos/crisnahine/anatomiya/contents/CODE_OF_CONDUCT.md?ref=main'`, line 63:
  "**TODO: FILL IN A REAL CONTACT ADDRESS BEFORE PUBLISHING THIS REPOSITORY**." The working tree on
  `open-source-cleanup` replaces it with a personal email address, uncommitted. The rest of the file is
  the 2.1 text.

### Description, topics and features

- **doc** Classifying your repository with topics,
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics:
  topics "help other people find and contribute to your project"; "Use lowercase letters, numbers, and
  hyphens. Use 50 characters or less. Add no more than 20 topics."
- **doc** Changing access permissions for wikis,
  https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis:
  "Only repository collaborators can edit a public repository's wiki by default".
- **run** `gh api repos/crisnahine/anatomiya --jq '{description, topics, homepage, has_wiki,
  has_discussions, ...}'`: a description is set, `topics` is `[]`, `homepage` is `null`, `has_wiki` and
  `has_projects` are `true`, `has_discussions` is `false`, `has_issues` is `true`. The wiki URL redirects
  (302), so it has no pages. Secret scanning, push protection and Dependabot security updates are on.

### OpenSSF Scorecard checks that read files or settings

- **doc** `docs/checks.md` in `ossf/scorecard` at `4777005`:
  - Security-Policy: "looking for a file named `SECURITY.md` (case-insensitive) in a few well-known
    directories", scoring 6 of 10 for "A valid form of an email address to contact for vulnerabilities"
    or "A valid form of a http/https address to support vulnerability reporting", 3 for free text, and 1
    for text matching `vuln`, `disclos` and numbers such as "30 days". It reads the file's text only; no
    clause says it checks that the linked form works.
  - License: "Scorecard uses the GitHub License API for GitHub hosted projects"; 6 for a detected
    `LICENSE`, 3 for top level, 1 for an FSF or OSI license.
  - Branch-Protection: tiers from "Prevent force push" and "Prevent branch deletion" (3/10) up to two
    reviewers and code owner review (9/10). Some settings "require an admin token", "However, all of
    these settings are accessible via Repo Rules."
  - Binary-Artifacts: "whether the project has generated executable (binary) artifacts in the source
    repository". `checks/raw/binary_artifact.go` lists `"wasm": true`.
  - Also file or settings based: Dependency-Update-Tool (a Dependabot config), Dangerous-Workflow,
    Token-Permissions and Pinned-Dependencies (workflow files), SAST, Code-Review (approvals on recent
    changes), Signed-Releases (release assets), Packaging (a publishing workflow), Maintained ("This
    check will only succeed if a GitHub project is >90 days old") and Contributors ("the `Company` field
    on the GitHub user profile for authors of recent commits").
- **run** `.github/workflows/supply-chain.yml` already runs `ossf/scorecard-action` pinned by SHA with
  `publish_results: true`. `https://api.securityscorecards.dev/projects/github.com/crisnahine/anatomiya`
  for `053e170e` at 2026-10-24T10:05:01Z: overall 7.2. Security-Policy 10, License 10, Token-Permissions
  10, Pinned-Dependencies 10, Dependency-Update-Tool 10, SAST 10, Dangerous-Workflow 10, CI-Tests 10,
  Vulnerabilities 10, Fuzzing 10, Contributors 6, Binary-Artifacts 3, Maintained 0, Code-Review 0,
  CII-Best-Practices 0, Branch-Protection -1, Signed-Releases -1, Packaging -1. Branch-Protection's
  reason: "some github tokens can't read classic branch protection rules". Signed-Releases: "no releases
  found" (releases carry no assets). Contributors: "project has 2 contributing companies or
  organizations", read from contributors' public profiles.
- **run** `gh api repos/crisnahine/anatomiya/code-scanning/alerts`: no open alert. Ten Scorecard alerts
  are dismissed as "won't fix" with a reason: seven Binary-Artifacts on
  `plugins/anatomiya/grammars/*.wasm` (vendored, held to their packages' SHA-256 in CI),
  CII-Best-Practices, Code-Review (solo) and Maintained (clears after 2026-11-11).
- **run** `gh api repos/crisnahine/anatomiya/branches/main/protection`: force pushes and deletion off,
  admins enforced, stale reviews dismissed, 13 required checks, 0 required approvals. `gh api
  repos/crisnahine/anatomiya/rulesets`: `[]`.

## What this means for anatomiya, and whether it already does it

Changed before launch, in the change this note shipped with:

- **Private vulnerability reporting is on.** It was off while `SECURITY.md` linked its form, and
  GitHub's page says a private report can be made only where the feature is on, so the one channel
  `SECURITY.md` named led nowhere. Scorecard scored Security-Policy 10 regardless, because it reads the
  file's text.
- **The code of conduct names its contact.** It said TODO. The address is public once it lands, in
  history as well as the file.
- **Edited bodies keep their old text in public.** 15 issues and 15 pull requests had edit history
  before the cleanup, none of it deleted. The bodies the cleanup edited keep their earlier versions,
  readable by anyone until each revision is deleted in the web UI, and a pull request cannot be
  deleted through the API.
- **Text read out of the Claude Code build no longer appears in a document.** Against the clauses in
  section 1, fourteen research notes and `docs/plugin-contract.md` now describe what the build does
  rather than quote it (G17). `scripts/claude-build.mjs` and two tests in `test/ab.test.mjs` still read
  the installed build at test time, on the developer's machine, for strings the A/B harness pins; they
  publish nothing of it.

Worth doing, not blocking:

- Add topics; there are none. Set a homepage if there is one.
- Turn off the wiki and projects if unused. The wiki has no pages and is collaborator-only by default.
- Branch-Protection reads -1 because Scorecard's token cannot read classic rules. Scorecard's own doc
  says the same settings are readable through repository rules; there are none here.
- The community profile answers `issue_template: null` and a `documentation` link on `master`. Both are
  unexplained; look at the web checklist before deciding anything.

Already done: README, LICENSE (MIT, detected by GitHub), CONTRIBUTING, which now links the code of
conduct and the security policy, CODE_OF_CONDUCT (Contributor Covenant 2.1), an issue chooser that
sends a security report to the private form (`.github/ISSUE_TEMPLATE/config.yml`, added with this note), SECURITY.md with timelines, a pull request template, issue templates with `name:` and
`about:`, a Dependabot config, every action pinned by SHA, CodeQL, Scorecard published, secret scanning
with push protection, force push and deletion blocked on `main`, and every dismissed Scorecard alert
carrying its reason.

## Not settled

- Whether reading strings out of an installed build is reverse engineering or duplicating under either
  terms. The text does not say, and no legal reading is offered here.
- What a signed-in visitor sees at `/security/advisories/new` while the feature is off.
- Why the community profile API reports no issue template, and where its `master` documentation link
  comes from.
- The Usage Policy's version history, given the effective date it shows.

## Sources

All read on 2026-10-24.

- Anthropic: `LICENSE.md` and `README.md` in `@anthropic-ai/claude-code@2.1.310` (npm);
  `anthropics/claude-code` `LICENSE.md` at `318b7e6`; https://code.claude.com/docs/en/legal-and-compliance;
  https://www.anthropic.com/legal/commercial-terms; https://www.anthropic.com/legal/consumer-terms;
  https://www.anthropic.com/legal/aup
- GitHub Docs: Tracking changes in a comment; Deleting an issue; Removing sensitive data from a
  repository; REST issues (https://docs.github.com/en/rest/issues/issues); REST repositories
  (https://docs.github.com/en/rest/repos/repos); REST community metrics
  (https://docs.github.com/en/rest/metrics/community); GraphQL reference, Issues and Users; About
  community profiles for public repositories; Configuring private vulnerability reporting for a
  repository; Privately reporting a security vulnerability; Adding a security policy to your repository;
  Classifying your repository with topics; Changing access permissions for wikis; About wikis
- GitHub GraphQL schema, by introspection: `UserContentEdit` and the mutation list
- Contributor Covenant 2.1, https://www.contributor-covenant.org/version/2/1/code_of_conduct/
- OpenSSF: `ossf/scorecard` at `4777005`, `docs/checks.md` and `checks/raw/binary_artifact.go`;
  https://api.securityscorecards.dev/projects/github.com/crisnahine/anatomiya
- This repository, read only: `SECURITY.md`, `CODE_OF_CONDUCT.md` (working tree and `main`),
  `CONTRIBUTING.md`, `LICENSE`, `.github/` (templates, `dependabot.yml`, the four workflows),
  `scripts/claude-build.mjs`; and `gh api` GETs on the repository, its community profile, private
  vulnerability reporting, branch protection, rulesets, code scanning alerts and analyses, and its issues'
  and pull requests' `userContentEdits`
