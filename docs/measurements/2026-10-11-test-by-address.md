# Tests by address, and a root answering a test of another family

Measured 2026-10-11 on copies of both corpora (`anatomiya-corpus`, 35 repositories, and
`anatomiya-corpus-langs`, 25), base eac5b08 against the build that reads support files under a test
tree and holds a root to the test's own family, with the same parse and the same layout functions
the scan uses. DECISIONS H53, H54 and H55 cite these numbers.

## Files a test only by a `__tests__` segment or by the mirror

`isTestFile` reached its last two claims, and answered yes, for 645 files in 14 repositories. Each
was classified by its parse facets and a sample of each repository was read by hand.

| Repository | By address | Mirror | `__tests__` | Exports | Ruby | Still a test | Test files |
|---|---|---|---|---|---|---|---|
| alphagov/whitehall | 2 | 2 | 0 | 0 | 2 | 0 | 645 -> 643 |
| appsmithorg/appsmith | 1 | 0 | 1 | 1 | 0 | 0 | 1647 -> 1646 |
| calcom/cal.diy | 8 | 0 | 8 | 8 | 0 | 0 | 556 -> 548 |
| discourse/discourse | 6 | 6 | 0 | 0 | 6 | 0 | 4127 -> 4121 |
| element-plus/element-plus | 3 | 0 | 3 | 3 | 0 | 0 | 167 -> 164 |
| eslint/eslint | 294 | 294 | 0 | 0 | 0 | 294 | 367 -> 367 |
| forem/forem | 3 | 0 | 3 | 3 | 0 | 0 | 1547 -> 1544 |
| instructure/canvas-lms | 115 | 0 | 115 | 114 | 0 | 1 | 6611 -> 6497 |
| opf/openproject | 2 | 2 | 0 | 0 | 2 | 0 | 4210 -> 4208 |
| prisma/prisma | 1 | 1 | 0 | 1 | 0 | 0 | 1641 -> 1640 |
| react/react | 188 | 0 | 188 | 180 | 0 | 8 | 592 -> 412 |
| rubocop/rubocop | 1 | 1 | 0 | 0 | 1 | 0 | 765 -> 764 |
| storybookjs/storybook | 1 | 0 | 1 | 1 | 0 | 0 | 838 -> 837 |
| vuejs/vitepress | 20 | 0 | 20 | 17 | 0 | 3 | 73 -> 56 |
| total | 645 | 306 | 339 | 328 | 11 | 306 | |

The 328 that export something: fixtures, helpers, mocks, drivers, data and configs, every one
(`fixtures.ts`, `test-utils.ts`, `GradeInputDriver.js`, `vitest.config.ts`, react-devtools'
144 compiled hook sources, vitepress's e2e site `config.ts` and `theme/index.ts`). None is a test.

The 11 Ruby files: `test/support/*_helpers.rb`, `spec/support/helpers.rb`, page objects under
`spec/system/page_objects`, `spec/fabricators`, `spec/factories`, `spec/core_ext/string.rb`. None
is a test. The Ruby parse names rspec, minitest and beaker, so a file it read with no case is
support.

The 306 that stay: eslint's 294 mirrored rule tests (RuleTester at the top level, no export), and 12
JavaScript files that export nothing: one real test (react's `NoRefAccessInRender-tests.ts`, calling
a local `testRule`), and 11 files that are not tests, which the rule does not reach: 7 declaration
files, 2 setup files, 1 shim and 1 build script.

Every namesake count that moved, all of them false credits from a support file:

- alphagov/whitehall `features`: 2 of 96 to 0 of 96
  (`test/support/configurable_document_type_helper.rb` and `i18n_helpers.rb` mirrored
  `features/support`)
- vuejs/vitepress `docs`: 3 of 10 to 0 of 10, and `template`: 2 of 2 to 0 of 2 (the e2e site's
  `.vitepress/config.ts` and `theme/index.ts`)

Other moves are the tests line and runner groups by the counts above. The sibling-module count is
held to the namesake count's producers, so the support files leave it too (canvas-lms `ui` stays at
2332); holding it there also drops every empty file and every file under a test tree it held on
base, which moves 27 roots in 14 repositories. react's
`packages/react-devtools-shared/src/hooks/__tests__/__source__/__compiled__` line reads `144 .js, 67
.map` for `144 test files and 67 other`.

Every sibling-module count that moved, base to the producer definition, each cause counted file by
file (the old definition over the new build, less `isProducer`). "Net" rows: the support rule also
put some files back into the count, so there the column is the files taken out under a test tree
less the files put back.

| Repository | Root | Base | Now | Under a test tree | Empty file |
|---|---|---|---|---|---|
| TryGhost/Ghost | koenig | 310 | 297 | 13 (`kg-default-nodes/test/test-utils`) | 0 |
| TryGhost/Ghost | apps/ember-admin | 551 | 538 | 11 (`tests/helpers`) | 2 |
| TryGhost/Ghost | apps/shade | 23 | 22 | 1 (`test/.eslintrc.cjs`) | 0 |
| TryGhost/Ghost | apps/portal | 38 | 36 | 2 | 0 |
| angular/angular | adev/shared-docs | 173 | 164 | 9 (extraction `test` fixtures) | 0 |
| appsmithorg/appsmith | app/client | 2974 | 2826 | 147 (`cypress/` 94, `test/` 40, `tests/` 13: support and fixtures) | 1 |
| backstage/backstage | plugins | 2590 | 2587 | 2 (`src/tests/performance/lib`) | 1 |
| calcom/cal.diy | apps/web | 279 | 274 | 5 (`test/jest-setup.js` and kin) | 0 |
| calcom/cal.diy | packages/features | 697 | 695 | 1 net | 1 |
| calcom/cal.diy | packages/app-store | 648 | 646 | 2 net | 0 |
| element-plus/element-plus | packages/components | 749 | 745 | 0 net | 4 |
| react-front-end | src/utils | 59 | 58 | 0 | 1 (`metrics.js`) |
| microsoft/vscode | extensions | 2621 | 2256 | 353 (`src/test` helpers) | 12 |
| prisma/prisma | examples | 236 | 231 | 5 | 0 |
| react/react | compiler | 238 | 237 | 0 net | 1 |
| react/react | scripts | 148 | 144 | 0 | 4 (`scripts/flow/*.js`) |
| storybookjs/storybook | code | 2174 | 2156 | 12 (`manager-api/tests`, `src/test`) | 6 |
| storybookjs/storybook | test-storybooks | 89 | 82 | 4 | 3 |
| supabase/supabase | apps/studio | 1709 | 1701 | 7 (`tests/` mocks) | 1 |
| supabase/supabase | examples | 259 | 251 | 6 | 2 |
| supabase/supabase | apps/docs | 238 | 237 | 1 (`spec/sections`) | 0 |
| vercel/next.js | test | 2767 | none, the clause goes | 2743 (the test apps) | 24 |
| vercel/next.js | turbopack/crates | 1554 | 51 | 1476 (crate `tests` inputs) | 27 |
| vercel/next.js | examples | 730 | 727 | 3 (`cypress/support`) | 0 |
| vercel/next.js | packages/next-codemod/transforms/__testfixtures__ | 202 | 195 | 0 | 7 |
| vercel/next.js | crates | 188 | 1 | 175 (`tests/errors` fixtures) | 12 |
| webpack/webpack | examples | 448 | 444 | 0 | 4 |

With the support rule and the family hold alone, the other 47 repositories wrote byte-identical
files, times masked. With the sibling-module change, 39 are.

## A root answering a test of another family

Every tracked test path (`isTestPath`) of all 60 repositories, 46,820 of them, was asked through
`precedentFindings` as if a branch had just added it, with "already holds a test" answered by
another tracked test in the same directory, as H38 was measured.

Base: 5 findings, in 2 repositories. With roots held to the test's own family: the same 5 paths.
None appears and none goes. One reason's count changed, from the fixture fix above, not this one:
whitehall `features/support/govuk_test.rb` reads `features: 0 of 96` for `2 of 96`.

So no real repository in either corpus loses a right finding or gains one; the cross-family answer
is reached only by a contrived shape.
