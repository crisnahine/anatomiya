# Test kinds spelled as a dotted segment of their own

Measured 2026-10-11 over both corpora, 60 repositories (35 in `anatomiya-corpus`, 25 in
`anatomiya-corpus-langs`), by `git ls-files` on every repository and by `isTestFile` on copies of the
four that hold a candidate.

## The population

Every tracked file whose basename holds a dotted segment ending in `test` (any case) before its
extension, the first segment excepted: 16,435. `TEST_NAME` at 50ec65a already reads 16,200 of them
(`.test.`, `-test.` and the like). The other 235:

| segment | files | repository | runner collects it | `isTestFile` at 50ec65a |
| --- | --- | --- | --- | --- |
| `.unittest.js` | 102 | webpack | jest `testMatch` | 102 test (top-level `describe`) |
| `.longtest.js` | 11 | webpack | jest `testMatch` | 9 test, 2 not (`describeCases` wrapper) |
| `.basictest.js` | 6 | webpack | jest `testMatch` | 4 test, 2 not (`describeCases` wrapper) |
| `.spectest.js` | 3 | webpack | jest `testMatch` | 3 test |
| `.stest.ts` | 53 | vscode | copilot simulation `ssuite` | 0 test |
| `.integrationTest.ts` | 50 | vscode | `suite` / `flakySuite` | 0 test |
| `.releaseTest.ts` | 1 | vscode | `suite` | 0 test |
| `.unittest.js.snap`, `.basictest.js.snap` | 5 | webpack | snapshot, written by a test | no language, never a test |
| `.vitest.tsx` | 1 | element-plus | vitest, under `__tests__` | test (runner import) |
| `.vitest.js` | 1 | canvas-lms | `eslint.config.vitest.js`, a config | not a test |
| `.vitest.json` | 1 | element-plus | `tsconfig.vitest.json` | no language |
| `.latest.md` | 1 | fastlane | `CHANGELOG.latest.md` | no language |

Real tests by name: 226. Of them 108 did not read as tests: 4 webpack and all 104 vscode.

The first segment (`latest.ts`, `contest.ts`, `conftest.py`, `vitest.config.ts`, `configtest.js`)
holds 7,167 tracked names, most of them `_test.go`, `-test.js` and other forms a rule already reads;
the bare words are English (`latest`, `contest`) or a tool's own config (`conftest`, `vitest`), so
no first-segment shape is narrow enough.

## The shape

`\.(?:unit|basic|long|spec|s)test\.` and `\.(?:integration|release)Test\.`: the seven segments, as
spelled. It takes all 226 and none of the other 9. A wider `\.[a-z]+test\.` takes
`eslint.config.vitest.js`; `\.[a-z]+Test\.` takes nothing else in the corpus but would read a
helper such as `a.baseTest.ts` as a test.

## What moved

Scanned base and new build on the four copies, written files compared with times masked.

- element-plus, canvas-lms: identical.
- webpack: `test` root 159 to 163 test files (95 to 91 other); the tests line 159 of 160 to 163 of
  164. No namesake count moved.
- vscode: `src/vs` 1669 to 1720 test files, namesakes 1418 to 1420 of 6217; `extensions` 159 to 212
  test files under test, namesakes 374 to 377 of 2174; the tests line 1669 of 1867 to 1720 of 1971;
  per-area `kinds` lines move with them: four areas that printed 0 test files now print a test
  group, and one more gains a second group. The five new namesakes
  are `fileSearch.ts` and `rawSearchService.ts` (their `.integrationTest.ts`), and
  `devContainerConfigGenerator.ts`, `gitCommitMessageGenerator.ts`,
  `settingsEditorSearchResultsSelector.ts` (their `.stest.ts`); `findFilesTool.tsx` gains one in the
  JSX clause.
- The other 56 repositories hold no tracked file the new alternatives match, so their maps cannot move.
