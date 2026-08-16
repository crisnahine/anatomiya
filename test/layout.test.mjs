import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions } from "../lib/companions.mjs";
import { isTestFile, layoutFacts, layoutRoots, minRootFiles, runnerOf, testsLine } from "../lib/layout.mjs";

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
    assert.equal(isTestFile(rel, null), true, rel);
  }
  assert.equal(isTestFile("src/a.ts", null), false);
  assert.equal(isTestFile("src/latest/a.ts", null), false);
});

test("a file that imports a runner is a test file wherever it sits", () => {
  assert.equal(isTestFile("src/components/Foo.tsx", { testRunner: "vitest" }), true);
  assert.equal(isTestFile("src/components/Foo.tsx", { testCalls: true }), true);
  assert.equal(isTestFile("src/components/Foo.tsx", { testRunner: null, testCalls: false }), false);
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

// The shape of empire-flippers/client, scaled down: JSX pages and components,
// a handful of named sibling modules, four vitest files beside the Cypress suite.
const client = () => [
  ...files(44, (i) => file(`src/pages/P${i}.tsx`, "jsx", { jsx: true, inlineHelpers: 0 })),
  ...files(30, (i) => file(`src/components/C${i}.tsx`, "jsx", { jsx: true, inlineHelpers: i < 8 ? 1 : 0 })),
  ...["a/types", "b/types", "c/types", "a/schema", "b/schema", "a/utils"].map((m) =>
    file(`src/components/${m}.ts`, "js", { jsx: false, inlineHelpers: 0 })),
  ...files(4, (i) => file(`src/components/w${i}/__tests__/W${i}.test.tsx`, "jsx", { testRunner: "vitest" })),
  ...files(20, (i) => file(`cypress/integration/x${i}.spec.js`, "js")),
];

test("the layout record counts each root's extensions, tests, namesakes and helpers", () => {
  const facts = layoutFacts(client(), {});

  assert.deepEqual(Object.keys(facts), ["size", "minFiles", "roots", "more", "tests"]);
  assert.equal(facts.size, 104);
  assert.equal(facts.minFiles, 3);
  assert.deepEqual(paths(facts.roots), ["src/pages", "src/components", "cypress/integration"]);
  assert.deepEqual(facts.more, { roots: 0, files: 0 });
  assert.deepEqual(facts.tests, [
    { runner: "cypress", root: "cypress/integration", files: 20 },
    { runner: "vitest", root: "src/components", files: 4 },
  ]);

  assert.deepEqual(facts.roots[1], {
    path: "src/components",
    files: 40,
    source: 40,
    exts: [[".tsx", 34], [".ts", 6]],
    other: 0,
    jsx: 30,
    jsxExt: ".tsx",
    tests: [{ runner: "vitest", files: 4, sub: "__tests__" }],
    testRoot: false,
    companions: { with: 0, of: 36, root: null },
    helpers: { siblingModules: 6, stems: ["types", "schema", "utils"], inlineFiles: 8 },
  });
});

test("a root that is mostly tests carries no namesake or helper count", () => {
  const facts = layoutFacts(client(), {});
  const cypress = facts.roots[2];

  assert.equal(cypress.testRoot, true);
  assert.deepEqual(cypress.tests, [{ runner: "cypress", files: 20, sub: null }]);
  assert.equal("companions" in cypress, false);
  assert.equal("helpers" in cypress, false);
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
