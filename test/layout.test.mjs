import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions } from "../lib/companions.mjs";
import { isTestFile, layoutFacts, layoutRoots, minRootFiles, runnerOf, testsLine } from "../lib/layout.mjs";
import { roster } from "../lib/layout-scan.mjs";

const file = (rel, lang = null, facets = null) => ({ rel, lang, facets });
const files = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const paths = (roots) => roots.map((r) => r.path);

test("the root floor is one percent of the corpus and never below three", () => {
  assert.equal(minRootFiles(2486), 25);
  assert.equal(minRootFiles(100), 3);
});

test("a name or a directory the table does not know still names a test file", () => {
  for (const rel of [
    "src/a.test.ts",
    "src/a.spec.js",
    "src/a.cy.ts",
    "src/__tests__/a.ts",
    "spec/a_spec.rb",
    "test/a_test.rb",
    "cypress/integration/a.js",
    "e2e/a.js",
    "tests/a.js",
  ]) {
    assert.equal(isTestFile(file(rel, "js")), true, rel);
  }
  assert.equal(isTestFile(file("src/a.ts", "js")), false);
  assert.equal(isTestFile(file("src/latest/a.ts", "js")), false);
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

  assert.deepEqual(testsLine(corpus), [{ runner: "cypress", root: "cypress/integration", files: 4 }]);
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
  assert.deepEqual(more, { roots: 0, files: 1 });
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
  assert.deepEqual(more, { roots: 5, files: 50 });
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
  assert.deepEqual(more, { roots: 0, files: 0 });
});

test("a monorepo descends past packages and past each package's own shell", () => {
  const corpus = files(12, (i) => i + 1).flatMap((n) => [
    ...files(3, (i) => file(`packages/p${n}/src/f${i}.ts`, "js")),
    ...(n <= 2 ? [file(`packages/p${n}/src/x.test.ts`, "js", { testRunner: "vitest" })] : []),
  ]);

  const { roots, more } = layoutRoots(corpus, { minFiles: minRootFiles(corpus.length) });

  assert.equal(roots.length, 7);
  assert.deepEqual(paths(roots).slice(0, 2), ["packages/p1/src", "packages/p2/src"]);
  assert.deepEqual(more, { roots: 5, files: 15 });
  assert.deepEqual(testsLine(corpus), [{ runner: "vitest", root: "packages", files: 2 }]);
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
  const source = [file("app/models/edition/foo.rb", "ruby")];
  const tests = [file("spec/models/edition/foo_spec.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), { with: 1, of: 1, root: "spec/models" });
});

test("a namesake in another subtree answers nothing", () => {
  const source = [file("app/models/edition/foo.rb", "ruby")];
  const tests = [file("spec/services/foo_spec.rb", "ruby")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), { with: 0, of: 1, root: null });
});

test("a test directory beside the file is the root the namesakes share", () => {
  const source = [file("src/components/Foo.tsx", "jsx")];
  const tests = [file("src/components/__tests__/Foo.test.tsx", "jsx")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 1,
    of: 1,
    root: "src/components/__tests__",
  });
});

test("a colocated spec is a namesake, whatever suffix it spells", () => {
  const source = [file("src/components/Foo.tsx", "jsx")];
  const tests = [file("src/components/Foo.cy.ts", "js")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 1,
    of: 1,
    root: "src/components",
  });
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
    { runner: "cypress", root: "cypress/integration", files: 102 },
    { runner: "vitest", root: "src", files: 4 },
  ]);
});

test("two runners at one count order by name, whichever file arrived first", () => {
  const corpus = [
    ...files(3, (i) => file(`src/m${i}.test.js`, "js", { testRunner: "mocha" })),
    ...files(3, (i) => file(`src/j${i}.test.js`, "js", { testRunner: "jest" })),
  ];
  const expected = [
    { runner: "jest", root: "src", files: 3 },
    { runner: "mocha", root: "src", files: 3 },
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
  assert.deepEqual(facts.more, { roots: 0, files: 0 });
  assert.deepEqual(facts.tests, [
    { runner: "cypress", root: "cypress/integration", files: 102 },
    { runner: "vitest", root: "src/components", files: 4 },
  ]);

  assert.deepEqual(facts.roots[1], {
    path: "src/components",
    files: 616,
    source: 573,
    exts: [[".tsx", 508], [".ts", 65]],
    other: 43,
    jsx: 504,
    jsxExt: ".tsx",
    tests: [{ runner: "vitest", files: 4, sub: "__tests__" }],
    testRoot: false,
    // The denominator is the extension the line printed, so `0 of 504` sits
    // beside `504 .tsx` and counts the files the reader can see.
    companions: { with: 0, of: 504, root: null },
    helpers: { siblingModules: 65, stems: ["types", "schema", "utils"], inlineFiles: 35 },
  });
});

test("a root that is mostly tests carries no namesake or helper count", () => {
  const facts = layoutFacts(client(), {});
  const cypress = facts.roots[2];

  assert.equal(cypress.testRoot, true);
  assert.deepEqual(cypress.tests, [{ runner: "cypress", files: 102, sub: null }]);
  assert.equal("companions" in cypress, false);
  assert.equal("helpers" in cypress, false);
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
    more: { roots: 0, files: 0 },
    tests: [],
  });
});

test("a test file named after the file it covers is a namesake with no suffix at all", () => {
  const source = [file("src/components/Foo.tsx", "jsx")];
  const tests = [file("src/components/__tests__/Foo.ts", "js")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 1,
    of: 1,
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
  assert.deepEqual(layout.more, { roots: 0, files: 0 });
  assert.ok(roster({ ...args, truncated: false }).layout.roots.length > 0, "and the flag is what does it");
});
