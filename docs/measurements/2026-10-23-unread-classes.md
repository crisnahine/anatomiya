# The unread classes, measured against the bar

Date: 2026-10-23. Issues #239 to #243 asked, class by class, whether what no row reads holds a
per-repository convention a row could state. DECISIONS C62 to C66 and `docs/dimension-intake.md`
draw on these tables. One class shipped, `endpoint_segment_case` (C62); every other was refused.

## Method

- Corpora: C35 (35 repositories), LANGS (25) and APPS (25), 85 in all. Every probe ran read-only
  against a frozen copy of the working tree, importing the tool's own `collect`, `isCorpusPath`,
  `isDenied`, `isExcludedDir`, `namesATestFile`, `underTestTree`, `discover`, `areaOwner`,
  `classifyWord`, `pathSites` and gate arithmetic, so a probe's filters and word classes are the
  tool's. Git ran with `GIT_NO_LAZY_FETCH=1`. No model was called by a probe.
- A repository "holds" a class where it has 20 or more sites and one side takes 0.90 of them. The
  spread is the highest top-side ratio less the lowest, over repositories with 20 sites. The bar
  (`CONTRIBUTING.md`) asks for one repository under 0.90 and a spread of 0.15; for a learned class,
  a stated class that differs between repositories reads as the spread (C67).
- eff is the inverse Simpson file count the concentration gate uses. "Gated area" means an area
  with 20 sites at a Wilson bound of 0.90, the applicability floor met and eff 3; the author gate
  was not run in the probes, so a gated area is an upper bound. The slot tables for #239 and #240
  are the tool's own scan, author gate included.
- Where the numbers cleared the bar, sessions with no map asked an agent to write the construct in a
  holding repository, on `claude-opus-5[1m]` at `medium` (G11), Claude Code 2.1.308, `claude -p`
  with Read, Write, Edit, Glob and Grep, 15 turns at most, in a fresh clone holding no
  `.claude/rules` and no `.claude/anatomiya`. A trial is scored on what it wrote.

The probe scripts and their raw output were kept in a scratch directory and are not in the
repository; each section names what was counted, which is enough to write one again.

## 1. URL paths in the tree-sitter languages (#239, C62)

The research probe, per language, over repositories with 20 or more literal path words:

| Language | Repositories with 20 sites | Holders by side | Under 0.90 | Verdict |
|---|---|---|---|---|
| Python | netbox 244 (kebab-case 1.000), healthchecks 61 (snake_case 1.000), fastapi 31 (kebab-case, 22 in `docs_src`), mealie 21 (kebab-case) | kebab-case 3, snake_case 1 | none | shipped |
| Java | thingsboard 431 (camelCase 0.965), dolphinscheduler 114 (kebab-case 0.912), mall 82 (camelCase 1.000), appsmith 55 (kebab-case 0.709) | camelCase 2, kebab-case 1 | appsmith | shipped |
| C# | bitwarden 241 (kebab-case 0.992), jellyfin 140 (PascalCase 1.000) | kebab-case 1, PascalCase 1 | none (nopCommerce 0.857 on 14) | shipped |
| Rust | vaultwarden 121 (kebab-case 0.942), lemmy 29 (snake_case 1.000) | kebab-case 1, snake_case 1 | none | shipped |
| PHP | firefly-iii 138, monica 115, BookStack 72, koel 40 | kebab-case 3, camelCase 1 | none | refused: every route file sits in `routes/`, 2 or 3 files under the area floor, so 365 sites land in no area |
| Go | gitea 154 (snake_case 0.545) | none | gitea | refused: one repository, and the gin and chi apps write single words (photoprism 0 sites in 183 declarations, gotify 0 in 62) |
| Kotlin | ktor 34 (kebab-case 0.941, 22 in a test fixture tree) | kebab-case 1 | none | refused: no application reaches 20 sites, and 60 of 368 literal paths (16.3%) sit in files the grammar rejects |

The row as built, scanned for real on local clones of the 16 repositories with sites (slots read
from `facts.json`). Of the first 12 it reads the probe's sites exactly in 10, bitwarden 239 of 241
(2 in doc-comment examples) and nopCommerce 0 of 14 (all `MapControllerRoute(pattern: ...)`, a form
not read).

| Repository | Language | Slots | Sites in slots | Conforming | Stated | Class stated | Gates of the rest |
|---|---|---|---|---|---|---|---|
| bitwarden | C# | 11 | 143 | 143 | 7 | kebab-case | concentration 4 |
| nopCommerce | C# | 0 | 0 | 0 | 0 | - | - |
| jellyfin | C# | 2 | 140 | 140 | 1 | PascalCase | concentration 1 |
| netbox | Python | 13 | 236 | 236 | 10 | kebab-case | applicability 1, concentration 2 |
| healthchecks | Python | 32 | 61 | 61 | 1 | snake_case | concentration 27, authors 4 |
| mealie | Python | 6 | 21 | 21 | 0 | - | evidence 6 |
| thingsboard | Java | 2 | 431 | 417 | 1 | camelCase | evidence 1 |
| dolphinscheduler | Java | 1 | 114 | 104 | 0 | - | evidence 1 (kebab-case 104 of 114) |
| mall | Java | 4 | 82 | 82 | 2 | camelCase | concentration 2 |
| appsmith | Java | 2 | 55 | 39 | 0 | - | ratio 1 (27 of 43), evidence 1 (12 of 12) |
| vaultwarden | Rust | 3 | 121 | 114 | 2 | kebab-case | ratio 1 (6 of 11) |
| lemmy | Rust | 2 | 29 | 29 | 0 | - | evidence 2 (28 of 28 in `crates/api`) |
| fastapi | Python | 6 | 29 | 29 | 0 | - | evidence 6 (21 of 21 in `docs_src`) |
| django | Python | 2 | 6 | 6 | 0 | - | evidence 2 |
| CTFd | Python | 1 | 2 | 2 | 0 | - | evidence 1 |
| eShop | C# | 1 | 1 | 1 | 0 | - | evidence 1 |

Stated areas and the near ones: netbox `dcim` 99 of 99, `extras` 27, `circuits` 22, `ipam` 20,
`core` 16, `vpn` 16, `virtualization` 12, `tenancy` 8, `wireless` 6, each 1 file and stated through
D16's sections; healthchecks `hc/front` 7 of 7; thingsboard `controller` 416 of 430 over 55 of 106
files; mall's two controller areas 53 of 53 and 26 of 26; bitwarden
`src/Api/SecretsManager/Controllers` 40 of 40, `AdminConsole/Controllers` 37 of 37,
`Billing/Controllers` 29 of 29, `src/Api` 14 of 14 and three smaller; jellyfin
`Jellyfin.Api/Controllers` 139 of 139 over 29 of 60 files; vaultwarden `src/api/core` 70 of 72 and
`two_factor` 38 of 38.

Exceptions read word by word, a sample of each: thingsboard's 14 include `device-connectivity` three
times, `gateway-launch`, `docker-compose`, `resolve-approval` and `swagger-ui` (a third-party UI's
own name); dolphinscheduler's `taskCategories`, `taskTypes` twice, `resourceGroups` and 6 more;
vaultwarden's 7 include `vw_static` twice in `src/api/web.rs`. Each is a route path the team
spelled.

A per-area facts diff over the 35-repository corpus against 0.15.6 moves no other row's slot through
this one: the row opens 2 slots in appsmith's Java server, `controllers/ce` 27 of 43 kebab-case
(ratio) and `git` 12 of 12 (evidence), and states neither.

## 2. The URL forms C59 leaves out (#240, C63)

Measured over the JavaScript, TypeScript, Vue and Svelte files of all 85 repositories, the slot
movement by the tool's own scan with the checker off, on the build and on a copy whose
`url_segment_case` also reads the four declaration forms.

| Form | Repositories with a site | Sites | Split | What reading it does |
|---|---|---|---|---|
| React Router 7 `route()`, `prefix()` | 0 | 0 | - | nothing: the 4 files importing `@react-router/dev/routes` export `flatRoutes()` |
| TanStack `createFileRoute` | supabase | 103 | kebab-case 103 | supabase from 1 slot to 18, 2 stated (15 of 15, 4 of 4); the string is the file's own path |
| `path` as an array | mastodon | 2 | snake_case 2 | no slot moves |
| Ember `this.route` | discourse 91, Ghost 1 | 92 | discourse kebab-case 77, snake_case 13, camelCase 1 | discourse 0 slots to 9, 0 stated (admin routes 25 of 37 at the ratio gate, app routes 26 of 27 at evidence) |

File routers (Next.js, SvelteKit, Remix, Nuxt), a directory a route file sits at or below:

| Repository | Router files | Sites | Split | Top side |
|---|---|---|---|---|
| supabase | 586 | 59 | kebab-case 59 | 1.000 |
| next.js | 891 | 22 | kebab-case 20, camelCase 2 | 0.909 |
| cal.diy | 219 | 46 | kebab-case 30, camelCase 16 | 0.652 |
| mealie | 67 | 7 | kebab-case 7 | 1.000 |

No area reaches 20 sites (the largest, cal.diy `apps/web/app`, holds 19). Read by listing the row
states in 0 areas; with each directory its own section, in 2, both supabase's, 12 and 13 sites,
before the author gate.

Links (`to`, `href` starting with `/`): 244 sites in 11 repositories, all kebab-case but mastodon
(snake_case 9, kebab-case 7), canvas-lms (snake_case 5) and forem (snake_case 4). A check-only rule
fires where an area states the URL claim: a measured React front end's `src/router` and its 43 links
all kebab-case, supabase's 93 links all kebab-case against its would-be TanStack claims, mastodon
stating none. 0 firings.

## 3. Non-source files (#241, C64)

| Class | Repositories with 20 sites | Hold, by side | Under the gate | Spread | Sites with a sibling agreeing with it, holders | Sites in a directory holding no source |
|---|---|---|---|---|---|---|
| YAML extension (tool-fixed and Rails-fixed names out) | 35 | 20: `.yml` 18, `.yaml` 2 | 15 | 0.362 (whitehall 1.000, photoprism 0.638) | 1,755 of 1,786 (0.983) | 2,897 of 3,356 (0.863) |
| Markdown stem case | 38 | 25: kebab-case 21, snake_case 3, Title-Kebab 1 | 13 | 0.542 (eslint 1.000, forem 0.458) | 5,460 of 5,497 (0.993) | 7,162 of 7,922 (0.904) |
| Data file stem case | 37 | 19: kebab-case 12, snake_case 7 | 18 | 0.546 (cal.diy 1.000, canvas-lms 0.454) | 4,349 of 4,383 (0.992) | 6,079 of 6,393 (0.951) |
| CSS class, kebab-case and BEM apart | 49 | 27: kebab-case 25, BEM 1, PascalCase 1 | 22 | 0.587 | - | 2,908 of 4,636 stylesheets |
| CSS class, one lowercase-hyphen family | 49 | 40: that family 39, PascalCase 1 (react's devtools) | 9 | 0.587 | - | - |

No repository tracks an `.ls-lint.yml` or a `.remarkrc`, and yamllint and markdownlint have no
file-name rule. The earlier note's YAML count, 21 of 31 holding with 19 `.yml`, kept Rails's own
config names, which Rails reads in no other spelling. Locale key parity was not re-measured: of the
14 repositories the earlier note measured, 9 track `i18n-tasks.yml`, `i18next-parser.config.js` or
`.i18nrc`.

## 4. The other unread classes (#242, C65)

C35 first; "gated" counts areas passing the probe's gates.

| Class | Repositories with 20 sites | Holders by side | Lowest and highest | Spread | Area holders, gated in brackets | Applicability under a quarter | Linter | Verdict |
|---|---|---|---|---|---|---|---|---|
| Directory name case | 30 | 12: snake_case 7, kebab-case 5 | backstage 0.479 PascalCase, babel 1.000 kebab-case | 0.521 | kebab-case 14, snake_case 10, PascalCase 7, camelCase 3 | 8 of 30 | none | sessions |
| Test title opens with "should" (JS and Ruby) | 35 | 17: "does not" 17 | "does not" share: angular 0.149, brew 1.000 | 0.851 | "does not" 33 (29), "should" 16 (10) | 3 of 35 | `RSpec/ExampleWording` for Ruby | sessions, JS |
| Module-level primitive const case (JS) | 22 | 7: SCREAMING_SNAKE 7 | backstage 0.522, mastodon 0.972 | 0.450 | SCREAMING_SNAKE 13 (7), other 7 (1) | 22 of 22 | none | refused |
| Object key case (JS) | 28 | 5: camelCase 5 | consul 0.568, prisma 0.964 | 0.397 | camelCase 25 (22), snake_case 5 (1), PascalCase 5 (2), kebab-case 4 (0) | 2 of 28 | `camelcase` in diaspora | refused |
| i18n key segment case (JS) | 7 | 6: snake_case 5, camelCase 1 | a measured React front end 0.619 PascalCase over 21, backstage 1.000 | 0.381; 0.023 without that one | snake_case 5 (4), camelCase 1 (1) | 6 of 7 | none | sessions |
| i18n key shape | 8 | 7: identifier 5, English text 2 | canvas-lms 0.886, backstage 1.000 | 0.114 | identifier 6 (5), English text 3 (2) | 6 of 8 | none | refused |
| Rails views, full key against lazy | 12 | 8: full 8 | openfoodnetwork 0.601 lazy, whitehall 1.000 full | 0.399 | full 4 (4) | 2 of 12 | none in a view | refused: templates reach no parser and have no area |
| TODO form | JS 17, Ruby 9 | JS 6, Ruby 5 | JS vscode 0.509, webpack 0.979 | JS 0.469, Ruby 0.522 | JS `TODO:` 6 (2), bare 2 (0) | all | `Style/CommentAnnotation` | refused |
| Error message, no final period | JS 20, Ruby 18 | JS 6, Ruby 13, all "no period" | JS next.js 0.556, canvas-lms 0.940 | JS 0.384, Ruby 0.265 | JS period 3 (1, vendored compiled output) | all | revive `error-strings` for Go | refused |

## 5. Wiring and pipeline files (#243, C66)

An i18n key used in code, looked for in the base locale with a mapping per framework (Rails lazy
keys and literal `scope:`, discourse's and diaspora's JS prefixes, react-intl descriptors, i18next
namespaces, backstage's translation refs): of the 33 slots with 20 literal keys, 29 find 0.90 or
more. Of all 67,617 literal sites, 28,322 are not found, 85 of them plainly missing and 28,237 a
mapping the check did not follow; without canvas-lms, whose English file is generated at build,
639 and 554. consul, decidim, forem, mastodon, Ghost and backstage already fail a spec, a CI job or
`tsc` on a missing key.

A migration with a schema edit, through the co-change walk on the 14 Rails repositories in C35:

| Repository | Changes adding a migration (newest 100) | With a schema edit | Claim |
|---|---|---|---|
| whitehall | 100 | 97 | stated, 21 authors |
| consul | 100 | 100 | stated, 8 authors |
| forem | 100 | 99 | stated, 6 authors |
| mastodon `db/migrate` | 100 | 99 | stated, 13 authors |
| mastodon `db/post_migrate` | 42 | 41 | evidence gate |
| openfoodnetwork | 100 | 91 | evidence gate |
| a measured Rails API | 60 | 57 | evidence gate (a shallow checkout) |
| diaspora | 100 | 96 | `exists`: it stopped tracking `db/schema.rb` |
| discourse | 100 | 35 | ratio: `db/structure.sql` tracked again only since 2026-05-14 |
| canvas-lms, openproject, huginn, plots2, decidim, errbit | - | - | no committed schema |

Pipeline files over all 85: GraphQL 13 files in 3 repositories, Prisma 27 in 3; a Dockerfile's
`FROM` pinned by digest in 0 to 5 of each of the 6 repositories with 20 `FROM` lines, a tag
everywhere; the 13 repositories with 20 workflows all `.yml`, 0.9333 to 1.0000. An action's
`uses:` ref pinned to a sha: 56 repositories with 20 refs, 28 hold sha and 26 a tag, 2 split
(bitwarden 0.6449, junit5 0.6842), spread 1.0; 14 of the 28 sha holders name zizmor, pinact,
ratchet or harden-runner in `.github`.

## 6. Sessions

36 trials, one per row below, each scored on the files it wrote. "Matched" counts the trials that
wrote the construct and wrote the repository's side; a trial that ended on the turn cap with nothing
written is no construct. In every trial that wrote one, the agent had globbed or read the siblings
before its first write, except the two marked "nothing read first" or "no data file read first".

| Class | Repository, side | Task | Written | Matched |
|---|---|---|---|---|
| Directory name case | appsmith, PascalCase | an editor panel in its own directory | `pages/Editor/RecentPagesPane/` (turn cap) | yes |
| Directory name case | appsmith, PascalCase | the same | nothing (turn cap) | - |
| Directory name case | appsmith, PascalCase | the same | `pages/Editor/RecentPagesPane/styles.ts` (turn cap) | yes |
| Directory name case | appsmith, PascalCase | a plan table in a new directory under a folder with no subdirectory | `ce/pages/Upgrade/PlanComparison/` (turn cap) | yes |
| Directory name case | appsmith, PascalCase | the editor panel again | `pages/Editor/RecentPagesPane/` (turn cap) | yes |
| "should" titles | angular `packages/common/test/pipes`, "should" | tests for two pipe helpers | `utils_spec.ts`, 7 titles | yes |
| "should" titles | the same | the same | `utils_spec.ts`, 7 titles | yes |
| "should" titles | the same | the same | `utils_spec.ts`, 6 titles | yes |
| i18n key segment case | backstage `plugins/user-settings`, camelCase | a translatable "no email" line | `profileCard.noEmail` | yes |
| i18n key segment case | the same | the same | `profileCard.noEmail` | yes |
| i18n key segment case | the same | the same | `profileCard.noEmail` | yes |
| i18n key shape | Ghost `apps/comments-ui`, English text | a copy-link menu entry and its confirmation | `t('Copy link')`, `t('Link copied')` (turn cap) | yes |
| i18n key shape | the same | the same | nothing (turn cap) | - |
| i18n key shape | the same | the same | nothing (turn cap) | - |
| i18n key shape | the same | a tooltip on the pinned label | `t('This comment was pinned by the publication')` (turn cap) | yes |
| i18n key shape | the same | the same | `t('{publication} pinned this comment')` (turn cap) | yes |
| YAML extension | woodpecker, `.yaml` | a CI pipeline running go vet | `.woodpecker/vet.yaml` | yes |
| YAML extension | the same | an e2e scenario | `e2e/scenarios/fixtures/24_step_when_never_matches.yaml` | yes |
| YAML extension | the same | a package definition for a new binary | `nfpm/exporter.yaml` | yes |
| YAML extension | the same, no sibling | alert rules in a new directory | `contrib/monitoring/woodpecker-alerts.yaml` | yes |
| Markdown stem case | canvas-lms `doc`, snake_case | research and write a doc on job workers | nothing (turn cap) | - |
| Markdown stem case | the same | research and write an API page on ETags | nothing (turn cap) | - |
| Markdown stem case | the same | research and write a doc on feature flags | nothing (turn cap) | - |
| Markdown stem case | the same, no sibling | research and write a runbook in a new directory | `doc/operations/job_queue_backup_runbook.md` (turn cap) | yes |
| Markdown stem case | the same | the job-worker doc, text given | `doc/running_background_job_workers_locally.md` | yes |
| Markdown stem case | the same | the ETag page, text given | `doc/api/conditional_requests.md` | yes |
| Markdown stem case | the same | the feature-flag doc, text given | `doc/adding_a_feature_flag.md` | yes |
| Markdown stem case | the same, no sibling | the runbook, text given | `doc/operations/background_job_queue_backing_up.md`, nothing read first | yes |
| Data file stem case | consul, snake_case | en and es strings for a new feature | `config/locales/{en,es}/local_events.yml` | yes |
| Data file stem case | the same | en strings for an admin screen | `config/locales/en/newsletter_subscriptions.yml` | yes |
| Data file stem case | the same | an API rate limit config | `config/api_rate_limits.yml` | yes |
| Data file stem case | the same, no sibling | demo zones in a new directory | `demo/data/geozones.json`, one word, no site | - |
| Data file stem case | the same, no sibling | demo polling stations | `demo/data/polling_stations.json`, no data file read first | yes |
| Action pinned to a sha | backstage, sha 244 of 244 | a docs link-check workflow | `verify_docs-links.yml`, 3 refs pinned (turn cap) | yes |
| Action pinned to a sha | the same | a weekly dedupe check | `verify_dedupe.yml`, 4 refs pinned | yes |
| Action pinned to a sha | the same | build and upload type declarations | `build_type-declarations.yml`, 5 refs pinned | yes |

No trial wrote the other side. What the trials cannot separate: canvas-lms and consul are Rails
repositories, where snake_case may be the model's own side, and in two of the no-sibling Markdown
and data trials the agent read no sibling first; Ghost's root CLAUDE.md shows English-text keys, and
backstage's tells an agent to match each package's style, both loaded as the project's own
instructions; the three directory trials with siblings that wrote one chose one name, one decision
repeated. Not tried: a workflow needing an action no sibling uses, and a no-sibling Markdown or data
file in a repository outside Rails.
