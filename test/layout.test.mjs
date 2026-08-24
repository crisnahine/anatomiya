import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions, namesakeIndex } from "../plugins/anatomiya/lib/companions.mjs";
import {
  isStoryFile,
  isTestFile,
  layoutFacts,
  layoutIndexes,
  layoutRoots,
  minRootFiles,
  mirroredTests,
  rootFacts,
  runnerOf,
  tally,
  testsLine,
  underTestTree,
} from "../plugins/anatomiya/lib/layout.mjs";
import { roster } from "../plugins/anatomiya/lib/layout-scan.mjs";

const file = (rel, lang = null, facets = null) => ({ rel, lang, facets });
const files = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const paths = (roots) => roots.map((r) => r.path);

test("the root floor is one percent of the corpus and never below three", () => {
  assert.equal(minRootFiles(2486), 25);
  assert.equal(minRootFiles(100), 3);
});

test("a name the table does not know still names a test file", () => {
  for (const rel of [
    "src/a.test.ts",
    "src/a.spec.js",
    "src/a.cy.ts",
    "src/__tests__/a.ts",
    "spec/a_spec.rb",
    "test/a_test.rb",
  ]) {
    assert.equal(isTestFile(file(rel, "js")), true, rel);
  }
  assert.equal(isTestFile(file("src/a.ts", "js")), false);
  assert.equal(isTestFile(file("src/latest/a.ts", "js")), false);
});

test("a name spelled with a hyphen is a test name too", () => {
  // discourse writes its Ember tests as `login-test.js`, which is the dotted
  // convention with the other separator.
  assert.equal(isTestFile(file("tests/acceptance/login-test.js", "js")), true);
  assert.equal(isTestFile(file("src/checkout-spec.ts", "js")), true);
  assert.equal(isTestFile(file("src/latest-thing.ts", "js")), false);
});

test("a file in a test tree that mirrors a source file is that file's test", () => {
  // eslint names `tests/lib/rules/no-var.js` after the `lib/rules/no-var.js`
  // it covers and drives RuleTester, so nothing in the file says what it is.
  // The tree does: strip the test root and it is the source path.
  const corpus = [
    file("lib/rules/no-var.js", "js"),
    file("tests/lib/rules/no-var.js", "js"),
    file("tests/data/no-var.js", "js"),
    file("test/no-var.js", "js"),
    file("test/cases/foo/lib.js", "js"),
  ];
  const mirrored = mirroredTests(corpus);

  assert.equal(isTestFile(corpus[1], mirrored), true);
  assert.equal(isTestFile(corpus[2], mirrored), false, "a different position mirrors nothing");
  assert.equal(isTestFile(corpus[3], mirrored), false, "a bare basename is not a mirror");
  assert.equal(isTestFile(corpus[4], mirrored), false, "nothing outside the test tree answers to it");
});

test("the roster counts against the mirror index it is handed, and builds none of its own", () => {
  // The scan builds it once over the corpus and the area kinds read the same
  // one, so the record has to take it rather than walk the tree again.
  const corpus = [file("src/a.ts", "js"), file("src/b.ts", "js"), file("src/c.ts", "js")];

  assert.deepEqual(layoutFacts(corpus).tests, [], "nothing here mirrors anything");
  assert.deepEqual(layoutFacts(corpus, { indexes: layoutIndexes(corpus, new Set(["src/a.ts"])) }).tests, [
    { runner: "test files", root: "src", files: 1, under: 1 },
  ]);
});

test("a directory called test does not make what sits in it a test", () => {
  // The directory holds the support code as well as the specs. Counting all of
  // it read `136 test files under spec/factories` on empire-flippers/api,
  // `spec/support: 22 test files` on rubocop, and 1,979 fixture modules under
  // webpack's `test/cases`.
  assert.equal(isTestFile(file("spec/factories/users.rb", "ruby")), false);
  assert.equal(isTestFile(file("cypress/support/commands.js", "js")), false);
  assert.equal(isTestFile(file("test/foo.js", "js")), false);
  assert.equal(isTestFile(file("test/cases/foo/lib.js", "js", { testCalls: false })), false);

  assert.equal(isTestFile(file("spec/support/shared.rb", "ruby", { testCalls: true })), true);
  assert.equal(isTestFile(file("test/cases/foo/index.js", "js", { testCalls: true })), true);
});

test("a file this tool does not parse is not a spec, wherever it sits", () => {
  // Twenty screenshots under `cypress/` made the tests line read 24 specs over
  // 4, and the roster exists to be the denominator rather than to invent one.
  assert.equal(isTestFile(file("cypress/screenshots/login.png")), false);
  assert.equal(isTestFile(file("spec/support/rows.yml")), false);
  assert.equal(isTestFile(file("test/data/rows.txt")), false);
  assert.equal(isTestFile(file("cypress/integration/a.spec.js", "js")), true, "the spec beside them still counts");
});

test("the tests line counts specs and not what sits beside them", () => {
  const corpus = [
    ...files(4, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
    ...files(20, (i) => file(`cypress/screenshots/x${i}.png`)),
  ];

  assert.deepEqual(testsLine(corpus), [{ runner: "cypress", root: "cypress/integration", files: 4, under: 4 }]);
});

test("a file that imports a runner is a test file wherever it sits", () => {
  assert.equal(isTestFile(file("src/components/Foo.tsx", "jsx", { testRunner: "vitest" })), true);
  assert.equal(isTestFile(file("src/components/Foo.tsx", "jsx", { testCalls: true })), true);
  assert.equal(isTestFile(file("src/components/Foo.tsx", "jsx", { testRunner: null, testCalls: false })), false);
});

test("the runner is the one the file imports, then the directory, then unnamed", () => {
  assert.equal(runnerOf("spec/a_spec.rb", { testRunner: "rspec" }), "rspec");
  assert.equal(runnerOf("cypress/integration/a.js", { testRunner: "vitest" }), "vitest");
  assert.equal(runnerOf("cypress/integration/a.js", null), "cypress");
  assert.equal(runnerOf("test/a.js", null), "test files");
});

test("a shell name is descended into, and so is a directory one child fills", () => {
  const corpus = [
    ...files(5, (i) => file(`src/components/A${i}.tsx`, "jsx")),
    ...files(5, (i) => file(`src/pages/B${i}.tsx`, "jsx")),
    ...files(5, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
    file("cypress/support/y.js", "js"),
  ];

  const { roots, more } = layoutRoots(corpus, { minFiles: 3 });

  assert.deepEqual(paths(roots), ["cypress/integration", "src/components", "src/pages"]);
  assert.deepEqual(more, { roots: 0, files: 0, floor: { dirs: 1, files: 1, root: 0 } });
});

test("the files a shell holds itself are their own line", () => {
  const corpus = [
    ...files(6, (i) => file(`lib/${"abcdef"[i]}.js`, "js")),
    ...files(3, (i) => file(`lib/deps/x${i}.js`, "js")),
  ];

  const { roots } = layoutRoots(corpus, { minFiles: 3 });

  assert.deepEqual(paths(roots), ["lib (files at this level)", "lib/deps"]);
  assert.equal(roots[0].files.length, 6);
});

test("what does not fit the budget folds into one count, source-poor first", () => {
  const dir = (i) => `d${String(i).padStart(2, "0")}`;
  const corpus = files(12, (i) => i).flatMap((i) =>
    files(10, (j) => (i === 0 ? file(`${dir(i)}/n${j}.md`) : file(`${dir(i)}/n${j}.js`, "js"))));

  const { roots, more } = layoutRoots(corpus, { minFiles: 3, budget: 7 });

  assert.deepEqual(paths(roots), ["d01", "d02", "d03", "d04", "d05", "d06", "d07"]);
  assert.deepEqual(more, { roots: 5, files: 50, floor: { dirs: 0, files: 0, root: 0 } });
});

test("a folded directory and the files under no directory at all are counted apart", () => {
  // The two populations in one sentence. This repository's own map read "and 1
  // more directory holding 21 files" over a folded root holding 3, so 18 of the
  // 21 named a directory that does not hold them.
  const dir = (i) => `d${String(i).padStart(2, "0")}`;
  const corpus = [
    ...files(9, (i) => i + 1).flatMap((i) => files(10, (j) => file(`${dir(i)}/n${j}.js`, "js"))),
    ...files(2, (i) => file(`root${i}.js`, "js")),
    ...files(2, (i) => file(`tiny/a${i}.js`, "js")),
    ...files(2, (i) => file(`other/b${i}.js`, "js")),
  ];

  const { roots, more } = layoutRoots(corpus, { minFiles: 3, budget: 7 });

  assert.deepEqual(paths(roots), ["d01", "d02", "d03", "d04", "d05", "d06", "d07"]);
  assert.deepEqual(more, { roots: 2, files: 20, floor: { dirs: 2, files: 4, root: 2 } });
});

test("a directory holding no source prints after the code, however large", () => {
  const corpus = [
    ...files(3000, (i) => file(`public/img${i}.jpg`)),
    ...files(100, (i) => file(`app/models/m${i}.rb`, "ruby")),
  ];

  const { roots } = layoutRoots(corpus, { minFiles: minRootFiles(corpus.length) });

  assert.deepEqual(paths(roots), ["app/models", "public"]);
});

test("a repository that is one flat directory prints that directory", () => {
  const corpus = files(5, (i) => file(`a${i}.js`, "js"));

  const { roots, more } = layoutRoots(corpus, { minFiles: 3 });

  assert.deepEqual(paths(roots), ["."]);
  assert.deepEqual(more, { roots: 0, files: 0, floor: { dirs: 0, files: 0, root: 0 } });
});

test("a monorepo descends past packages and past each package's own shell", () => {
  const corpus = files(12, (i) => i + 1).flatMap((n) => [
    ...files(3, (i) => file(`packages/p${n}/src/f${i}.ts`, "js")),
    ...(n <= 2 ? [file(`packages/p${n}/src/x.test.ts`, "js", { testRunner: "vitest" })] : []),
  ]);

  const { roots, more } = layoutRoots(corpus, { minFiles: minRootFiles(corpus.length) });

  assert.equal(roots.length, 7);
  assert.deepEqual(paths(roots).slice(0, 2), ["packages/p1/src", "packages/p2/src"]);
  assert.deepEqual(more, { roots: 5, files: 15, floor: { dirs: 0, files: 0, root: 0 } });
  assert.deepEqual(testsLine(corpus), [{ runner: "vitest", root: "packages", files: 2, under: 2 }]);
});

test("apps is a shell name too, so a monorepo's apps/* sites are not one bullet", () => {
  // supabase splits apps/* beside packages/*. packages already descended;
  // apps rolled all seven sites into one bullet and blended studio's real
  // namesake rate with a marketing site, two showcase sites and a docs site.
  const corpus = [
    ...files(10, (i) => file(`apps/studio/f${i}.ts`, "js")),
    ...files(10, (i) => file(`apps/www/f${i}.ts`, "js")),
  ];

  const { roots } = layoutRoots(corpus, { minFiles: 3 });

  assert.deepEqual(paths(roots), ["apps/studio", "apps/www"]);
});

test("a child has to hold four fifths of its parent to stand in for it", () => {
  const parent = (share) => [
    ...files(share, (i) => file(`bundle/deps/d${i}.js`, "js")),
    ...files(100 - share, (i) => file(`bundle/b${i}.js`, "js")),
  ];

  assert.deepEqual(paths(layoutRoots(parent(79), { minFiles: 3 }).roots), ["bundle"]);
  assert.deepEqual(paths(layoutRoots(parent(80), { minFiles: 3 }).roots), [
    "bundle/deps",
    "bundle (files at this level)",
  ]);
});

test("a namesake answers the file whose path tail it shares", () => {
  const source = [file("app/models/edition/foo.rb", "ruby"), file("app/models/edition/bar.rb", "ruby")];
  const tests = [
    file("spec/models/edition/foo_spec.rb", "ruby"),
    file("spec/models/edition/bar_spec.rb", "ruby"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), { with: 2, of: 2, root: "spec/models" });
});

test("a namesake in another subtree answers nothing", () => {
  const source = [file("app/models/edition/foo.rb", "ruby")];
  const tests = [file("spec/services/foo_spec.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), { with: 0, of: 1, root: null });
});

test("an engine's spec tree answers the source tree beside it", () => {
  // openproject's `modules` read 0 of 2623: the tail is `budgets/app/models`
  // and the spec sits in `budgets/spec/models`, so `app` against `spec` is the
  // only thing between them.
  const source = [
    file("modules/budgets/app/models/budget.rb", "ruby"),
    file("modules/budgets/app/models/rate.rb", "ruby"),
  ];
  const tests = [
    file("modules/budgets/spec/models/budget_spec.rb", "ruby"),
    file("modules/budgets/spec/models/rate_spec.rb", "ruby"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "modules"), {
    with: 2,
    of: 2,
    root: "modules/budgets/spec",
  });
});

test("a test tree one directory up the source path answers it", () => {
  // vscode reads `src/vs/base/test/common/foo.test.ts` against
  // `src/vs/base/common/foo.ts`: the tree segment is in the middle of the path
  // rather than at the front of it.
  const source = [file("src/vs/base/common/foo.ts", "js"), file("src/vs/base/common/bar.ts", "js")];
  const tests = [
    file("src/vs/base/test/common/foo.test.ts", "js"),
    file("src/vs/base/test/common/bar.test.ts", "js"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "src/vs"), {
    with: 2,
    of: 2,
    root: "src/vs/base/test",
  });
});

test("a support file of the same name is no namesake", () => {
  // Dropping the tree segments leaves `support` against `models`, which is the
  // whole point of dropping only those: a spec tree's own helpers keep their
  // directory and answer nothing.
  const source = [file("app/models/user.rb", "ruby")];
  const tests = [file("spec/support/user.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 0, of: 1, root: null });
});

test("a mirror that parts on an ordinary name votes for no root", () => {
  // The two paths agree once the tree names are gone, and where they part is
  // `packages` against `integration`. Naming either as the test root would name
  // a directory neither side keeps tests in.
  const source = [file("packages/app/models/foo.rb", "ruby"), file("packages/app/models/bar.rb", "ruby")];
  const tests = [
    file("integration/packages/spec/models/foo_spec.rb", "ruby"),
    file("integration/packages/spec/models/bar_spec.rb", "ruby"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 2, of: 2, root: null });
});

test("a clause resting on one answered file names no root", () => {
  // One match names whatever it happens to touch: react's `packages/react`
  // rests on a single answered file and named a compiled fixture bundle. The
  // counts stand either way, and two files still name where they agree.
  const tests = [file("spec/models/foo_spec.rb", "ruby"), file("spec/models/bar_spec.rb", "ruby")];
  const source = [file("app/models/foo.rb", "ruby"), file("app/models/bar.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source.slice(0, 1), tests, "app/models"), {
    with: 1,
    of: 1,
    root: null,
  });
  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), {
    with: 2,
    of: 2,
    root: "spec/models",
  });
});

test("a root nobody's namesake agrees on names no directory", () => {
  // One `__tests__` per component directory is a real answer and no place: the
  // top vote holds one match of four, so the clause prints without `under`.
  const source = files(4, (i) => file(`ui/f${i}/C.tsx`, "jsx"));
  const tests = files(4, (i) => file(`ui/f${i}/__tests__/C.test.tsx`, "jsx"));

  assert.deepEqual(namesakeCompanions(source, tests, "ui"), { with: 4, of: 4, root: null });
});

test("a test directory beside the file is the root the namesakes share", () => {
  const source = [file("src/components/Foo.tsx", "jsx"), file("src/components/Bar.tsx", "jsx")];
  const tests = [
    file("src/components/__tests__/Foo.test.tsx", "jsx"),
    file("src/components/__tests__/Bar.test.tsx", "jsx"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components/__tests__",
  });
});

test("a colocated spec is a namesake, whatever suffix it spells", () => {
  const source = [file("src/components/Foo.tsx", "jsx"), file("src/components/Bar.tsx", "jsx")];
  const tests = [file("src/components/Foo.cy.ts", "js"), file("src/components/Bar.cy.ts", "js")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components",
  });
});

test("a file two trees both answer votes once, for the first of them", () => {
  // The vote total is halved against the count of answered files, so a file
  // counted once and voting twice compares two different units: `test` would
  // win 2 votes out of 2 answered files here while `spec` answers one of them.
  const source = [file("app/models/foo.rb", "ruby"), file("app/models/bar.rb", "ruby")];
  const tests = [
    file("test/models/foo_test.rb", "ruby"),
    file("spec/models/foo_spec.rb", "ruby"),
    file("test/models/bar_test.rb", "ruby"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), {
    with: 2,
    of: 2,
    root: "spec/models",
  });
});

test("a file votes for the first of its candidates that names a tree at all", () => {
  // The first candidate parts from the source on `aaa`, which is no tree name,
  // so it votes for nothing. Stopping there threw the file's vote away while
  // still counting it answered, and the second candidate names `spec`.
  const source = [file("app/models/user.rb", "ruby"), file("app/models/role.rb", "ruby")];
  const tests = [
    file("aaa/models/lib/user_spec.rb", "ruby"),
    file("spec/models/lib/user_spec.rb", "ruby"),
    file("aaa/models/lib/role_spec.rb", "ruby"),
    file("spec/models/lib/role_spec.rb", "ruby"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 2, of: 2, root: "spec" });
});

test("the candidates sort by code unit, so the vote does not follow the machine's locale", () => {
  // The sort now picks what gets rendered, and `localeCompare` orders case by
  // the ICU tables the host was built with.
  const index = namesakeIndex([file("foo/x.test.ts", "js"), file("Foo/x.test.ts", "js")]);

  assert.deepEqual(
    index.get("x").map((t) => t.rel),
    ["Foo/x.test.ts", "foo/x.test.ts"]
  );
});

test("a case tie in the roster orders by code unit, not by the host's locale", () => {
  // Every sort here picks a line the section prints, and `localeCompare` orders
  // case by whatever ICU tables the host was built with.
  const roots = [
    ...files(3, (i) => file(`Foo/a${i}.js`, "js")),
    ...files(3, (i) => file(`foo/b${i}.js`, "js")),
  ];
  assert.deepEqual(paths(layoutRoots(roots, { minFiles: 3 }).roots), ["Foo", "foo"]);

  assert.deepEqual(tally(["foo", "Foo"]), [["Foo", 1], ["foo", 1]]);

  const specs = [
    ...files(2, (i) => file(`Foo/x${i}.test.js`, "js", { testRunner: "zz" })),
    ...files(2, (i) => file(`foo/y${i}.test.js`, "js", { testRunner: "aa" })),
  ];
  assert.deepEqual(
    testsLine(specs).map((g) => g.root),
    ["Foo", "foo"],
    "the tests line breaks a count tie on the directory"
  );

  const runners = [
    ...files(2, (i) => file(`t/a${i}.test.js`, "js", { testRunner: "Zz" })),
    ...files(2, (i) => file(`t/b${i}.test.js`, "js", { testRunner: "zz" })),
  ];
  assert.deepEqual(
    rootFacts({ path: "t", dir: "t", files: runners }, layoutIndexes(runners)).tests.map((t) => t.runner),
    ["Zz", "zz"]
  );
});

test("the namesake index carries the fields a pair would recompute", () => {
  // `withoutTree` splits and filters the whole path, and it ran once per source
  // file asking rather than once per test file. `covers` is the same trade for
  // the import edge: resolved once here, read once per source file asking.
  const index = namesakeIndex([file("modules/budgets/spec/models/budget_spec.rb", "ruby")]);

  assert.deepEqual(index.get("budget"), [
    {
      rel: "modules/budgets/spec/models/budget_spec.rb",
      dir: "modules/budgets/spec/models",
      bare: "modules/budgets/models",
      covers: new Set(),
      owner: null,
    },
  ]);
});

test("a root whose files have no namesake reads zero of its own size", () => {
  const source = files(3, (i) => file(`app/workers/w${i}.rb`, "ruby"));

  assert.deepEqual(namesakeCompanions(source, [], "app/workers"), { with: 0, of: 3, root: null });
});

test("the tests line groups by runner and names the prefix each shares", () => {
  const corpus = [
    ...files(102, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
    ...files(2, (i) => file(`src/a/__tests__/a${i}.test.ts`, "js", { testRunner: "vitest" })),
    ...files(2, (i) => file(`src/b/__tests__/b${i}.test.ts`, "js", { testRunner: "vitest" })),
    file("src/a/a.ts", "js"),
  ];

  assert.deepEqual(testsLine(corpus), [
    { runner: "cypress", root: "cypress/integration", files: 102, under: 102 },
    { runner: "vitest", root: "src", files: 4, under: 4 },
  ]);
});

test("the tests line names where most of a runner's files are, not what one stray file leaves", () => {
  // Measured on empire-flippers/client: 102 Cypress specs under
  // cypress/integration and 4 elsewhere collapsed the shared prefix to the
  // repository root, and the line read "106 Cypress specs under .".
  const corpus = [
    ...files(102, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
    ...files(4, (i) => file(`src/legacy/y${i}.cy.ts`, "js", { testRunner: "cypress" })),
  ];

  assert.deepEqual(testsLine(corpus), [{ runner: "cypress", root: "cypress/integration", files: 106, under: 102 }]);
});

test("a runner spread across the repository is named without a directory", () => {
  const corpus = [
    ...files(30, (i) => file(`apps/a/test/x${i}.test.ts`, "js", { testRunner: "vitest" })),
    ...files(30, (i) => file(`libs/b/test/y${i}.test.ts`, "js", { testRunner: "vitest" })),
  ];

  assert.deepEqual(testsLine(corpus), [{ runner: "vitest", root: null, files: 60, under: 60 }]);
});

test("a shell whose children all sit under the floor keeps its own line", () => {
  // webpack: 652 files under lib/, 117 of them directly there and no child
  // clearing the floor, so descending dissolved the whole of webpack's source
  // and the map named test/ and examples/ and nothing else.
  const corpus = [
    ...files(1000, (i) => file(`test/t${i}.js`, "js")),
    ...files(117, (i) => file(`lib/l${i}.js`, "js")),
    ...files(8, (i) => i).flatMap((d) => files(60, (i) => file(`lib/d${d}/f${i}.js`, "js"))),
  ];

  const { roots } = layoutRoots(corpus, { minFiles: 144 });

  assert.deepEqual(paths(roots), ["test", "lib"]);
  assert.equal(roots[1].files.length, 597);
});

test("two runners at one count order by name, whichever file arrived first", () => {
  const corpus = [
    ...files(3, (i) => file(`src/m${i}.test.js`, "js", { testRunner: "mocha" })),
    ...files(3, (i) => file(`src/j${i}.test.js`, "js", { testRunner: "jest" })),
  ];
  const expected = [
    { runner: "jest", root: "src", files: 3, under: 3 },
    { runner: "mocha", root: "src", files: 3, under: 3 },
  ];

  assert.deepEqual(testsLine(corpus), expected);
  assert.deepEqual(testsLine([...corpus].reverse()), expected);
});

// The shape of empire-flippers/client, at the numbers the spec recounted by
// hand: JSX pages and components, sibling modules named by role, four vitest
// files beside a Cypress suite.
const client = () => [
  ...files(1003, (i) => file(`src/pages/P${i}.tsx`, "jsx", { jsx: true, inlineHelpers: 0 })),
  ...files(188, (i) => file(`src/pages/u${i}.ts`, "js", { jsx: false, inlineHelpers: 0 })),
  ...files(32, (i) => file(`src/pages/s${i}.scss`)),
  ...files(504, (i) => file(`src/components/C${i}.tsx`, "jsx", { jsx: true, inlineHelpers: i < 35 ? 1 : 0 })),
  ...files(30, (i) => file(`src/components/t${i}/types.ts`, "js", { jsx: false, inlineHelpers: 0 })),
  ...files(20, (i) => file(`src/components/s${i}/schema.ts`, "js", { jsx: false, inlineHelpers: 0 })),
  ...files(15, (i) => file(`src/components/u${i}/utils.ts`, "js", { jsx: false, inlineHelpers: 0 })),
  ...files(43, (i) => file(`src/components/style${i}.scss`)),
  ...files(4, (i) => file(`src/components/w${i}/__tests__/W${i}.test.tsx`, "jsx", { testRunner: "vitest" })),
  ...files(102, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
];

test("the layout record counts each root's extensions, tests, namesakes and helpers", () => {
  const facts = layoutFacts(client(), {});

  assert.deepEqual(Object.keys(facts), ["size", "minFiles", "roots", "more", "tests"]);
  assert.equal(facts.size, 1941);
  assert.equal(facts.minFiles, 20);
  assert.deepEqual(paths(facts.roots), ["src/pages", "src/components", "cypress/integration"]);
  assert.deepEqual(facts.more, { roots: 0, files: 0, floor: { dirs: 0, files: 0, root: 0 } });
  assert.deepEqual(facts.tests, [
    { runner: "cypress", root: "cypress/integration", files: 102, under: 102 },
    { runner: "vitest", root: "src/components", files: 4, under: 4 },
  ]);

  assert.deepEqual(facts.roots[1], {
    path: "src/components",
    dir: "src/components",
    files: 616,
    source: 573,
    exts: [[".tsx", 508], [".ts", 65]],
    other: 43,
    jsx: 504,
    jsxExt: ".tsx",
    tests: [{ runner: "vitest", files: 4, sub: "__tests__", under: 4 }],
    testRoot: false,
    // The denominator is the extension the line printed, so `0 of 504` sits
    // beside `504 .tsx` and counts the files the reader can see.
    companions: { with: 0, of: 504, root: null },
    helpers: { siblingModules: 65, stems: ["types", "schema", "utils"], inlineFiles: 35 },
  });
});

test("the name a directory vote picks carries how many of the group it holds", () => {
  // `8 RSpec specs under admin` named 5. The vote is a strict majority, so the
  // name can speak for as few as half the group plus one, and the count welded
  // to it was the whole group.
  const corpus = [
    file("src/utils/__tests__/humps.test.js", "js", { testRunner: "vitest" }),
    file("src/utils/__tests__/yup.test.js", "js", { testRunner: "vitest" }),
    file("src/utils/deepmerge.test.ts", "js", { testRunner: "vitest" }),
  ];
  const record = rootFacts({ path: "src/utils", dir: "src/utils", files: corpus }, layoutIndexes(corpus));

  assert.deepEqual(record.tests, [{ runner: "vitest", files: 3, sub: "__tests__", under: 2 }]);
});

test("a root that is mostly tests carries no namesake or helper count", () => {
  const facts = layoutFacts(client(), {});
  const cypress = facts.roots[2];

  assert.equal(cypress.testRoot, true);
  assert.deepEqual(cypress.tests, [{ runner: "cypress", files: 102, sub: null, under: 102 }]);
  assert.equal("companions" in cypress, false);
  assert.equal("helpers" in cypress, false);
});

test("a root whose most common extension is not source still finds its producers", () => {
  // supabase's apps/www: .png outcounts .tsx 2179 to 753. Matching only the
  // first of the top two extensions read every producer there as zero, worse
  // than naming none of them at all.
  const corpus = [
    ...files(5, (i) => file(`apps/www/img${i}.png`)),
    ...files(3, (i) => file(`apps/www/Page${i}.tsx`, "jsx")),
    file("apps/www/test/Page0.test.tsx", "jsx", { testRunner: "vitest" }),
    file("apps/www/test/Page1.test.tsx", "jsx", { testRunner: "vitest" }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "apps/www", dir: "apps/www", files: corpus.slice(0, 8) }, indexes);

  assert.deepEqual(record.exts, [[".png", 5], [".tsx", 3]], "the printed line still leads with .png");
  assert.deepEqual(record.companions, { with: 2, of: 3, root: "apps/www/test" });
});

test("a root whose top two extensions are both unparsed asks nothing", () => {
  const corpus = [
    ...files(5, (i) => file(`apps/marketing/img${i}.png`)),
    ...files(3, (i) => file(`apps/marketing/copy${i}.mdx`)),
    file("test/x.test.ts", "js", { testRunner: "vitest" }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "apps/marketing", dir: "apps/marketing", files: corpus.slice(0, 8) }, indexes);

  assert.equal("companions" in record, false);
});

test("a root inside a test tree is not asked whether its fixtures have tests", () => {
  // webpack's `test` is 12,645 files of which 2,607 are tests, so it stays a
  // source root by the half rule and read `1 of 7858 has a namesake test under
  // test`. Those 7,858 are what the tests run on.
  const corpus = [
    ...files(4, (i) => file(`test/cases/foo/lib${i}.js`, "js")),
    file("test/watch.test.js", "js", { testRunner: "jest" }),
    file("test/build.test.js", "js", { testRunner: "jest" }),
    file("lib/watch.js", "js"),
    file("lib/build.js", "js"),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "test", dir: "test", files: corpus.slice(0, 6) }, indexes);

  assert.equal("companions" in record, false);
  assert.deepEqual(record.exts, [[".js", 6]], "and the extension clause stays");
  assert.deepEqual(record.tests, [{ runner: "jest", files: 2, sub: null, under: 2 }], "and the tests clause");

  const outside = rootFacts({ path: "lib", dir: "lib", files: corpus.slice(6) }, indexes);
  assert.deepEqual(outside.companions, { with: 2, of: 2, root: "test" }, "and a root outside is asked");
});

test("a test tree is caught at any segment, not only the first", () => {
  // fastlane nests each gem's own tree one segment down: `gym/spec` never
  // starts with "spec", so the old first-segment check never engaged on any
  // of its 21 sibling gems. decidim nests one four segments down.
  assert.equal(underTestTree("test"), true);
  assert.equal(underTestTree("test/cases/foo"), true);
  assert.equal(underTestTree("gym/spec"), true);
  assert.equal(underTestTree("decidim-dev/lib/decidim/dev/test"), true);
  assert.equal(underTestTree("app/models"), false);
  assert.equal(underTestTree(""), false, "the repository root is not a tree");
});

test("a monorepo's own test tree is not asked either, wherever it nests", () => {
  // fastlane's gym/spec stated "1 of 1 has a namesake test" over a single
  // empty spec_helper.rb, credited by a same-named spec in an unrelated gem.
  const corpus = [
    file("gym/spec/spec_helper.rb", "ruby"),
    file("gym/spec/options_spec.rb", "ruby", { testCalls: true }),
    file("cert/spec/runner_spec.rb", "ruby", { testCalls: true }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "gym/spec", dir: "gym/spec", files: corpus.slice(0, 2) }, indexes);

  assert.equal("companions" in record, false);
});

test("a package's own test tree is not asked either, however deep it nests", () => {
  const corpus = [
    file("decidim-dev/lib/decidim/dev/test/rspec_support/shared.rb", "ruby"),
    file("some-gem/spec/x_spec.rb", "ruby", { testCalls: true }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts(
    { path: "decidim-dev/lib/decidim/dev/test", dir: "decidim-dev/lib/decidim/dev/test", files: corpus.slice(0, 1) },
    indexes
  );

  assert.equal("companions" in record, false);
});

test("the JSX mark is only ever on an extension the line prints", () => {
  const corpus = [
    ...files(50, (i) => file(`web/d${i}.md`)),
    ...files(40, (i) => file(`web/m${i}.ts`, "js", { jsx: false })),
    ...files(10, (i) => file(`web/C${i}.jsx`, "jsx", { jsx: true })),
  ];

  const { roots } = layoutFacts(corpus, {});

  assert.deepEqual(roots[0].exts, [[".md", 50], [".ts", 40]]);
  assert.equal(roots[0].jsxExt, null);
});

test("the JSX mark goes to the first printed extension that is half JSX", () => {
  const corpus = [
    ...files(100, (i) => file(`web/C${i}.tsx`, "jsx", { jsx: i < 40 })),
    ...files(20, (i) => file(`web/h${i}.js`, "js", { jsx: i < 15 })),
  ];

  const { roots } = layoutFacts(corpus, {});

  assert.equal(roots[0].jsxExt, ".js");
});

test("a file whose name carries no extension is counted under a name of its own", () => {
  const corpus = [
    file("Rakefile", "ruby"),
    file("Gemfile", "ruby"),
    ...files(3, (i) => file(`a${i}.rb`, "ruby")),
  ];

  const { roots } = layoutFacts(corpus, {});

  assert.deepEqual(roots[0].exts, [[".rb", 3], ["(none)", 2]]);
  assert.equal(roots[0].other, 0);
});

test("a file the parse never read counts in its extension and in nothing else", () => {
  const corpus = [
    ...files(4, (i) => file(`src/components/C${i}.tsx`, "jsx", { jsx: true, inlineHelpers: 1 })),
    file("src/components/Unread.tsx", "jsx"),
  ];

  const { roots } = layoutFacts(corpus, {});

  assert.deepEqual(roots[0].exts, [[".tsx", 5]]);
  assert.equal(roots[0].files, 5);
  assert.equal(roots[0].jsx, 4);
  assert.equal(roots[0].jsxExt, ".tsx");
});

test("an empty corpus has no root to print", () => {
  assert.deepEqual(layoutFacts([], {}), {
    size: 0,
    minFiles: 3,
    roots: [],
    more: { roots: 0, files: 0, floor: { dirs: 0, files: 0, root: 0 } },
    tests: [],
  });
});

test("a test file named after the file it covers is a namesake with no suffix at all", () => {
  const source = [file("src/components/Foo.tsx", "jsx"), file("src/components/Bar.tsx", "jsx")];
  const tests = [file("src/components/__tests__/Foo.ts", "js"), file("src/components/__tests__/Bar.ts", "js")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components/__tests__",
  });
});

test("a truncated scan keeps the size and counts nothing else", () => {
  // Counts over an arbitrary subset, rendered as a description of the tree, is
  // the failure the truncation rule exists for. The size survives because it is
  // what the notice is about.
  const corpus = files(5, (i) => ({ rel: `src/components/A${i}.tsx`, lang: "jsx" }));
  const args = { files: corpus, others: [{ rel: "README.md" }], records: new Map() };

  const { layout } = roster({ ...args, truncated: true });

  assert.equal(layout.truncated, true);
  assert.equal(layout.size, 6, "every tracked path, source or not");
  assert.equal(layout.roots.length, 0);
  assert.equal(layout.tests.length, 0);
  assert.equal(layout.principles.length, 0);
  assert.deepEqual(layout.more, { roots: 0, files: 0, floor: { dirs: 0, files: 0, root: 0 } });
  assert.ok(roster({ ...args, truncated: false }).layout.roots.length > 0, "and the flag is what does it");
});

test("a truncated scan describes no area's kinds either", () => {
  // The same subset the roster refuses to describe is what an area's own counts
  // would be read off, so the closure answers with nothing rather than counts.
  const corpus = files(5, (i) => ({ rel: `src/components/A${i}.tsx`, lang: "jsx" }));
  const args = { files: corpus, others: [], records: new Map() };
  const area = { path: "src/components", files: corpus };

  assert.equal(roster({ ...args, truncated: true }).kinds(area), null);
  assert.ok(roster({ ...args, truncated: false }).kinds(area).files > 0, "and the flag is what does it");
});

test("a hyphen before cy is a name, not a test shape", () => {
  // `.cy.` is how Cypress spells a spec. `-cy.` is not: it is the tail of an
  // ordinary word, and `legacy-cy.ts` is not a spec.
  assert.equal(isTestFile(file("src/legacy-cy.ts", "js")), false);
  assert.equal(isTestFile(file("src/checkout.cy.ts", "js")), true);
  assert.equal(isTestFile(file("src/checkout-test.js", "js")), true);
  assert.equal(isTestFile(file("src/checkout-spec.js", "js")), true);
});

test("a file the parse never read is no sibling module", () => {
  // An unparsed file has no JSX facet to be false, so counting it as a module
  // charged the granularity sentence with files nothing was read from.
  const unread = [
    file("src/ui/C.tsx", "jsx", { jsx: true, inlineHelpers: 0 }),
    file("src/ui/a.ts", "js"),
    file("src/ui/b.ts", "js"),
  ];

  assert.equal("helpers" in layoutFacts(unread, { minFiles: 3 }).roots[0], false);

  const read = unread.map((f) =>
    f.facets === null ? { ...f, facets: { jsx: false, inlineHelpers: 0 } } : f);

  assert.equal(layoutFacts(read, { minFiles: 3 }).roots[0].helpers.siblingModules, 2);
});

test("a story file is neither a producer, even where its extension leads", () => {
  // storybook's own component-shaped files split by incidental syntax: a
  // `.stories.tsx` reads as literal JSX like any component beside it.
  const corpus = [
    ...files(3, (i) => file(`ui/C${i}.tsx`, "jsx", { jsx: true, inlineHelpers: 0 })),
    file("ui/C0.stories.tsx", "jsx", { jsx: true, inlineHelpers: 0 }),
    file("spec/C0.test.tsx", "jsx", { testRunner: "vitest" }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "ui", dir: "ui", files: corpus.slice(0, 4) }, indexes);

  assert.equal(record.companions.of, 3, "the story file is not counted among the producers");
});

test("a story file is no sibling module either, whatever its incidental syntax", () => {
  // storybook's own overview read "2559 sibling modules named
  // index/types/input.stories", filing its own fixture convention beside
  // private helper functions.
  const corpus = [
    file("ui/Button.tsx", "jsx", { jsx: true, inlineHelpers: 0 }),
    file("ui/Button.stories.ts", "js", { jsx: false, inlineHelpers: 0 }),
    file("ui/utils.ts", "js", { jsx: false, inlineHelpers: 0 }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "ui", dir: "ui", files: corpus }, indexes);

  assert.equal(record.helpers.siblingModules, 1);
  assert.deepEqual(record.helpers.stems, ["utils"]);
});

test("a root's story files are counted and named as their own kind", () => {
  const corpus = [
    file("ui/Button.tsx", "jsx", { jsx: true, inlineHelpers: 0 }),
    file("ui/Button.stories.tsx", "jsx", { jsx: true, inlineHelpers: 0 }),
    file("ui/Button.stories.ts", "js", { jsx: false, inlineHelpers: 0 }),
  ];
  const record = rootFacts({ path: "ui", dir: "ui", files: corpus }, layoutIndexes(corpus));

  assert.equal(record.stories, 2);
});

test("a root with no story files carries no stories count", () => {
  const corpus = [file("ui/Button.tsx", "jsx", { jsx: true, inlineHelpers: 0 })];

  assert.equal("stories" in rootFacts({ path: "ui", dir: "ui", files: corpus }, layoutIndexes(corpus)), false);
});

test("a hyphenated story-like name is not the story convention", () => {
  // Component Story Format is dotted: `Button.stories.tsx`. A file that
  // merely mentions "stories" is an ordinary module.
  assert.equal(isStoryFile("ui/stories-index.ts"), false);
  assert.equal(isStoryFile("ui/Button.stories.tsx"), true);
  assert.equal(isStoryFile("ui/Button.stories.mdx"), true);
});

test("a namesake whose root is the repository root names no directory", () => {
  // "under ." is not a place, and the renderer omits the clause on null.
  const source = [file("a.ts", "js"), file("b.ts", "js")];
  const tests = [file("a.test.ts", "js"), file("b.test.ts", "js")];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 2, of: 2, root: null });
});

test("one root reads the three indexes the corpus was walked for, and rebuilds none", () => {
  // Both callers hold the whole corpus and build all three, so the record takes
  // them as one object rather than as a corpus and a chain of optional
  // arguments it could fall back to rebuilding them from.
  const corpus = [
    file("app/models/foo.rb", "ruby"),
    file("app/models/bar.rb", "ruby"),
    file("app/models/baz.rb", "ruby"),
    file("spec/models/foo_spec.rb", "ruby", { testRunner: "rspec" }),
    file("spec/models/bar_spec.rb", "ruby", { testRunner: "rspec" }),
  ];
  const indexes = layoutIndexes(corpus);

  assert.deepEqual(Object.keys(indexes), ["testFiles", "mirrored", "byStem"]);
  assert.deepEqual(indexes.testFiles.map((f) => f.rel), [
    "spec/models/foo_spec.rb",
    "spec/models/bar_spec.rb",
  ]);

  const root = { path: "app/models", dir: "app/models", files: corpus.slice(0, 3) };

  assert.deepEqual(rootFacts(root, indexes).companions, { with: 2, of: 3, root: "spec/models" });
});

test("a Ruby file named for a test is one only where a test tree also says so", () => {
  // The Ruby form is the one a non-test file wears in earnest. A RuboCop cop
  // named for the `Rails.env.test?` guard it enforces printed a test group of
  // its own in the overview, and Homebrew's `software_spec.rb` is the
  // `SoftwareSpec` class, which has its own `software_spec_spec.rb` under
  // `test/`. Neither declares a case and neither sits in a test tree.
  const read = { testRunner: null, testCalls: false, empty: false };

  assert.equal(isTestFile(file("lib/rubocop/custom_cops/sleep_without_unless_test.rb", "ruby", read)), false);
  assert.equal(isTestFile(file("Library/Homebrew/software_spec.rb", "ruby", read)), false);

  // The address is the corroboration, and every segment of it counts.
  assert.equal(isTestFile(file("spec/models/user_spec.rb", "ruby", read)), true);
  assert.equal(isTestFile(file("test/units/foo_test.rb", "ruby", read)), true);
  assert.equal(isTestFile(file("gems/mygem/spec/foo_spec.rb", "ruby", read)), true);

  // And what the file itself says still answers before its name is read, which
  // is what keeps this from becoming "a test must declare a case" (H29).
  assert.equal(isTestFile(file("shopify/request/rest/shop/get_spec.rb", "ruby", { testCalls: true })), true);

  // The dotted and hyphen forms keep answering on the name alone: discourse
  // writes 4,000 tests as `login-test.js` and nothing else in them says so.
  assert.equal(isTestFile(file("src/checkout-test.js", "js", read)), true);
  assert.equal(isTestFile(file("src/checkout.cy.ts", "js", read)), true);
});

test("the namesake index is built once and read by every root", () => {
  // A scan asks this per root over the same test files, and rebuilding the stem
  // map each time walks the whole corpus again for an answer that cannot differ.
  const tests = [file("spec/models/foo_spec.rb", "ruby"), file("spec/models/bar_spec.rb", "ruby")];
  const index = namesakeIndex(tests);
  const source = [file("app/models/foo.rb", "ruby"), file("app/models/bar.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source, [], "app/models", index), {
    with: 2,
    of: 2,
    root: "spec/models",
  });
});

test("a namesake root tie breaks by code units, not locale", () => {
  // The tie decides a rendered line, so it must not depend on ICU (A5).
  const src = [
    { rel: "app/models/a.rb", lang: "ruby", facets: null },
    { rel: "app/models/b.rb", lang: "ruby", facets: null },
  ];
  const tests = [
    { rel: "Foo/models/a_spec.rb", lang: "ruby", facets: { testRunner: "rspec", testCalls: true } },
    { rel: "foo/models/b_spec.rb", lang: "ruby", facets: { testRunner: "rspec", testCalls: true } },
  ];
  const got = namesakeCompanions(src, tests, "app/models");
  assert.equal(got.root, "Foo/models");
});

test("a spec the parse read and found no case in is not a test file", () => {
  // empire-flippers/api:
  // spec/services/.../one_off/multiple_changes_spec.rb is commented out top to
  // bottom, so the runner collects nothing from it, and it still made
  // app/services/.../multiple_changes.rb read as covered.
  const empty = { testRunner: null, testCalls: false, empty: true };
  assert.equal(isTestFile(file("spec/models/user_spec.rb", "ruby", empty)), false);
  assert.equal(isTestFile(file("src/a.test.ts", "js", empty)), false);

  // A spec holding code stays a test even where the walk sees no case at the
  // top level: vscode nests `test` inside `suite`, and Cypress specs declare
  // their cases in a vocabulary this table does not carry.
  const quiet = { testRunner: null, testCalls: false };
  assert.equal(isTestFile(file("src/vs/base/common/uri.test.ts", "js", quiet)), true);
  // The name still answers where the parse never reached the file.
  assert.equal(isTestFile(file("spec/models/user_spec.rb", "ruby", null)), true);
  // And a file that declares a case is a test whatever it is named.
  assert.equal(
    isTestFile(file("spec/models/user_spec.rb", "ruby", { testRunner: "rspec", testCalls: true })),
    true
  );
});

test("a spec the parse found empty is neither a test nor a file owing one", () => {
  // Counted twice against the repository otherwise: the source it was written
  // for loses its test, and the dead file joins the denominator as a producer.
  const empty = { testRunner: null, testCalls: false, empty: true };
  const corpus = [
    ...files(6, (i) => file(`src/mod${i}.js`, "js", { testRunner: null, testCalls: false })),
    ...files(6, (i) =>
      file(`src/mod${i}.test.js`, "js", i === 1 ? empty : { testRunner: "vitest", testCalls: true })),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "src", dir: "src", files: corpus }, indexes);

  assert.deepEqual(record.companions, { with: 5, of: 6, root: "src" });
});

test("a commented-out source does not hold a spec no root will count", () => {
  // The empty file is not a producer, so no root ever counts it, and letting it
  // win ownership retires the spec: the real file two directories away reads
  // untested and the roster loses the place as well as the count.
  const corpus = [
    file("app/services/foo.rb", "ruby", { testRunner: null, testCalls: false, empty: true }),
    file("lib/foo.rb", "ruby", { testRunner: null, testCalls: false }),
    file("lib/bar.rb", "ruby", { testRunner: null, testCalls: false }),
    file("spec/services/foo_spec.rb", "ruby", { testRunner: "rspec", testCalls: true }),
    file("spec/bar_spec.rb", "ruby", { testRunner: "rspec", testCalls: true }),
  ];
  const indexes = layoutIndexes(corpus);
  const record = rootFacts({ path: "lib", dir: "lib", files: corpus.filter((f) => f.rel.startsWith("lib/")) }, indexes);

  assert.deepEqual(record.companions, { with: 2, of: 2, root: "spec" });
});
