# Test shapes the support rule's lists lack

Date: 2026-10-11. `isTestFile` in `plugins/anatomiya/lib/layout.mjs` reads a file that exports
something and declares no case as support, even where its address says test. A case is what
`TEST_CALLS` (`describe`, `it`, `test`, `cy`) names at the top level of a JavaScript file, or what
`MINITEST_SUPERCLASSES` and the RSpec words name in a Ruby one. This is how many files across both
corpora carry a case shape those lists lack.

## Method

Each of the 60 repositories (35 in `anatomiya-corpus`, 25 in `anatomiya-corpus-langs`) was copied
with `cp -Rc`, collected and parsed with the tool's own `collect` and `parseAll`, and dropped.
Nothing was scanned in place and nothing was written into a copy.

- Flipped: a file `isTestFile` answers false for, and true for once its `exports` are emptied.
  These are the files the export clause decides.
- Wider: a file under any test tree (`underTestTree`), read, exporting, with no `testCalls` and no
  `testRunner`, whatever its name.
- For both, every expression-statement call that takes a function argument, by its callee chain
  (`Deno.test`, `suite`, `vi.mock`), at the top level or nested in a function.
- Ruby: every collected `.rb` file whose `class X < Base` names a base ending `Test`, `TestCase` or
  `Spec` that `MINITEST_SUPERCLASSES` does not end. Then `git grep` over each original checkout for
  `Deno.test(`, `Test::Unit::TestCase`, `MiniTest::Test`, `MiniTest::Unit::TestCase` and
  `Minitest::Unit::TestCase`, to see what the collector leaves out.

## Results

| question | files |
|---|---|
| flipped by the export clause | 328 (303 `js`, 25 `jsx`) |
| of those, a top-level call shape missing from `TEST_CALLS` that declares a case | 0 |
| `Deno.test(` in any tracked file | 2, both Deno type declarations in supabase (`lib.deno.d.ts`), no test |
| collected Ruby file inheriting `Test::Unit::TestCase` or a `MiniTest::` base | 0 |
| tracked file naming `Test::Unit::TestCase` | 131, all in discourse's `plugins/discourse-events/vendor/holidays`, which `collect` drops as vendored |
| tracked file naming a `MiniTest::` or `Minitest::Unit::TestCase` base | 0 |

The only top-level calls with a function argument in the 328 flipped files are `vi.mock`, in 2
(canvas-lms `mockedDependenciesShims.ts`, element-plus `table-test-common.ts`): mocks, not cases.
The files holding nested `it`, `describe` or `beforeEach` are helpers that define shared cases for
other files to call: canvas-lms `shared_form_cases.tsx` and `datetime/__tests__/helpers.js`, react
`devtools-shared/src/__tests__/utils.js` and `ReactDOMServerIntegrationTestUtils.js`.

The collected Ruby files with a test-looking base not on the list: 27 `ViewComponent::TestCase`, 22
`ApplicationSystemTestCase`, 4 `ComponentTestCase`, 5 `TestCase`, 1 each of `PresenterTestCase`,
`PublishingApiAssociatedDocumentsTest`, `BaseTest` and `Beaker::TestCase`. Every one already reads
as a test. Seven do not read as tests, and none is one: Homebrew's `test_bot` classes inherit its
own `Test` (5), `head_software_spec.rb` inherits `SoftwareSpec`, and rubocop's `spec_runner.rake`
inherits `TestQueue::TestFramework::RSpec`.

Wider, for shapes the scanned trees hold outside the export clause's reach: vscode's `suite` (28
files, every one named `.test.ts` or `.test.tsx` and so a test by its name), `ssuite` and
`ssuite.optional` (2, `.stest.ts`), `flakySuite` (1, `diskFileService.integrationTest.ts`),
angular's `runInEachFileSystem` (3, all `_spec.ts`), and appsmith and the react-front-end's
`Cypress.Commands.add` (7, support files).
