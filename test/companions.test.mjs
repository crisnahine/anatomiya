import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions, namesakeIndex } from "../lib/companions.mjs";

const file = (rel) => ({ rel });
// A test file that names what it covers. The specifiers are what the parser
// records for a real file, relative to the test's own directory.
const imports = (rel, modules) => ({
  rel,
  facets: { imports: modules.map((module) => ({ module, names: [], relative: true })) },
});

test("a same-stem spec in an unrelated directory is not credited", () => {
  // puppet: lib/puppet/network.rb has no test anywhere. A decoy spec planted at
  // spec/unit/totally_unrelated/network_spec.rb, whose body describes something
  // with no relation to Puppet::Network, must not move the count.
  const source = [file("lib/puppet/network.rb")];
  const decoy = [file("spec/unit/totally_unrelated/network_spec.rb")];

  assert.deepEqual(namesakeCompanions(source, [], "lib/puppet"), { with: 0, of: 1, root: null });
  assert.deepEqual(namesakeCompanions(source, decoy, "lib/puppet"), { with: 0, of: 1, root: null });
});

test("many packages defining the same basename credit only the one with a real spec", () => {
  // openproject: 24 of 30 engines define Engine < Rails::Engine and exactly one,
  // backlogs, has a real engine_spec.rb. costs and github_integration must not
  // be credited via backlogs' spec merely for sharing the stem "engine".
  const backlogs = [
    file("modules/backlogs/lib/backlogs/engine.rb"),
    file("modules/backlogs/lib/backlogs/version.rb"),
  ];
  const tests = [
    file("modules/backlogs/spec/backlogs/engine_spec.rb"),
    file("modules/backlogs/spec/backlogs/version_spec.rb"),
  ];

  assert.deepEqual(namesakeCompanions(backlogs, tests, "modules/backlogs/lib/backlogs"), {
    with: 2,
    of: 2,
    root: "modules/backlogs/spec/backlogs",
  });

  const costsEngine = [file("modules/costs/lib/costs/engine.rb")];
  assert.deepEqual(namesakeCompanions(costsEngine, tests, "modules/costs/lib/costs"), {
    with: 0,
    of: 1,
    root: null,
  });
});

test("a same-stem file in another language is not credited", () => {
  // plots2 credits cable.js, a WebSocket consumer, with a server-side
  // cable_test.rb: the two share a stem and nothing else.
  const source = [file("app/assets/javascripts/channels/cable.js")];
  const tests = [file("test/models/cable_test.rb")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/assets/javascripts/channels"), {
    with: 0,
    of: 1,
    root: null,
  });
});

test("a bare top-level test directory does not answer every root's producers", () => {
  // Before this fix an empty tail matched unconditionally, so any same-stem
  // file anywhere, including a bare test/ directory with no structural
  // relation to the root, was credited. A bare tree-word directory still has
  // to mirror the root it is credited to.
  const source = [file("apps/www/Page0.tsx"), file("apps/www/Page1.tsx")];
  const tests = [file("test/Page0.test.tsx"), file("test/Page1.test.tsx")];

  assert.deepEqual(namesakeCompanions(source, tests, "apps/www"), { with: 0, of: 2, root: null });
});

test("the overview and an area file agree about the same files", () => {
  // huginn: app/assets/javascripts/components stated "2 of 6", crediting
  // form_configurable.js and utils.js with unrelated RSpec files, while the
  // same files scoped under app/assets (non-empty tail) correctly read "0 of
  // 18". Both evaluations must agree.
  const files = [
    file("app/assets/javascripts/components/form_configurable.js"),
    file("app/assets/javascripts/components/utils.js"),
  ];
  const tests = [file("spec/concerns/form_configurable_spec.rb"), file("spec/lib/utils_spec.rb")];

  const coarse = namesakeCompanions(files, tests, "app/assets");
  const fine = namesakeCompanions(files, tests, "app/assets/javascripts/components");

  assert.deepEqual(coarse, { with: 0, of: 2, root: null });
  assert.deepEqual(fine, { with: 0, of: 2, root: null });
});

test("a nested corpus is unaffected: the same engine shape one level up stays byte-identical", () => {
  // The tail is non-empty here (`budgets/lib/budgets`), the path openproject
  // measured zero cross-engine leakage over 2,623 producers on. Pinned so the
  // empty-tail fix cannot be the thing that moves it.
  const source = [
    file("modules/budgets/lib/budgets/engine.rb"),
    file("modules/budgets/lib/budgets/railtie.rb"),
  ];
  const tests = [
    file("modules/budgets/spec/budgets/engine_spec.rb"),
    file("modules/budgets/spec/budgets/railtie_spec.rb"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "modules"), {
    with: 2,
    of: 2,
    root: "modules/budgets/spec",
  });
});

test("an empty tail still finds its companion when the whole directory mirrors the root", () => {
  const source = [file("app/models/foo.rb"), file("app/models/bar.rb")];
  const tests = [file("spec/models/foo_spec.rb"), file("spec/models/bar_spec.rb")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), {
    with: 2,
    of: 2,
    root: "spec/models",
  });
});

test("a colocated namesake at an evaluated root is still credited", () => {
  const source = [file("src/components/Foo.tsx"), file("src/components/Bar.tsx")];
  const tests = [file("src/components/Foo.test.tsx"), file("src/components/Bar.test.tsx")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components",
  });
});

test("a bare tree word at the repository root still answers its own files", () => {
  const source = [file("a.ts"), file("b.ts")];
  const tests = [file("a.test.ts"), file("b.test.ts")];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 2, of: 2, root: null });
});

test("a test directory beside the file at an evaluated root is still credited", () => {
  const source = [file("src/components/Foo.tsx"), file("src/components/Bar.tsx")];
  const tests = [
    file("src/components/__tests__/Foo.test.tsx"),
    file("src/components/__tests__/Bar.test.tsx"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components/__tests__",
  });
});

test("namesakeIndex builds the stem map namesakeCompanions is handed", () => {
  const index = namesakeIndex([file("spec/models/foo_spec.rb")]);

  assert.deepEqual(index.get("foo"), [
    { rel: "spec/models/foo_spec.rb", dir: "spec/models", bare: "models", covers: new Set() },
  ]);
});

test("a flat repository still pairs its own top-level roots", () => {
  // This repository's own shape: scripts/measure-layout.mjs is tested by
  // test/measure-layout.test.mjs, and 8 of its 15 scripts pair that way. Both
  // sides sit at the top of the tree, which is what separates this from the
  // decoys above and from a package root answered by a repository-wide test/.
  const scripts = [
    file("scripts/measure-layout.mjs"),
    file("scripts/seed-defaults.mjs"),
    file("scripts/validate.mjs"),
  ];
  const tests = [file("test/measure-layout.test.mjs"), file("test/seed-defaults.test.mjs")];

  assert.deepEqual(namesakeCompanions(scripts, tests, "scripts", namesakeIndex(tests)), {
    with: 2,
    of: 3,
    root: "test",
  });
});

test("a top-level test tree pairs however it files its tests inside itself", () => {
  // Splitting tests by type under the test root is ordinary: test/unit,
  // test/integration. `unit` is nobody's tree word, so requiring the candidate's
  // own directory to reduce to nothing refused a real pair. What both sides
  // share is the top of the tree, not the shape below it.
  const source = [file("scripts/build.mjs"), file("scripts/deploy.mjs"), file("scripts/release.mjs")];
  const typed = [file("test/unit/build.test.mjs"), file("test/unit/deploy.test.mjs")];

  assert.equal(namesakeCompanions(source, typed, "scripts", namesakeIndex(typed)).with, 2);
});

test("a top-level pair still has to be written in the same language", () => {
  // plots2 credited a 17-line WebSocket consumer with a server-side Ruby spec.
  // The nested path never had to ask, since the directories part first; two
  // files at the top of the tree share a stem and nothing else.
  const source = [file("scripts/release.mjs")];
  const other = [file("test/release_spec.rb")];
  const same = [file("test/release.test.mjs")];

  assert.equal(namesakeCompanions(source, other, "scripts", namesakeIndex(other)).with, 0);
  assert.equal(namesakeCompanions(source, same, "scripts", namesakeIndex(same)).with, 1);
});

test("a test tree nested inside a package does not answer a top-level file", () => {
  // The producer is at the top of the tree, so the candidate has to be too: a
  // package's own test directory answers that package, not the repository root.
  const source = [file("scripts/runner.mjs")];
  const packaged = [file("packages/tool/test/runner.test.mjs")];

  assert.equal(namesakeCompanions(source, packaged, "scripts", namesakeIndex(packaged)).with, 0);
});

test("a nested producer is credited by the test of its own name that imports it", () => {
  // This repository's second plugin: the sources sit at
  // ultracode-anywhere/hooks and every test sits flat under test/. The tail
  // `hooks` mirrors nothing on the other side, so path shape alone reads 0 of 5
  // over five files that are each genuinely tested. The import edge is what
  // separates this from the decoys above, which name nothing they cover.
  const names = ["counters", "hook-io", "session-start", "standing-ultracode", "upstream"];
  const source = names.map((n) => file(`ultracode-anywhere/hooks/${n}.mjs`));
  const tests = names.map((n) =>
    imports(`test/${n}.test.mjs`, [`../ultracode-anywhere/hooks/${n}.mjs`]));

  assert.deepEqual(namesakeCompanions(source, tests, "ultracode-anywhere", namesakeIndex(tests)), {
    with: 5,
    of: 5,
    root: "test",
  });
});

test("a test that imports another file of the same stem does not credit this one", () => {
  // The import edge is only evidence for the file it actually names. Two
  // packages holding an index.mjs are answered by the test that imports each,
  // never by the other, which is the openproject engine_spec shape read through
  // the new branch rather than through the tail.
  const source = [file("packages/one/index.mjs"), file("packages/two/index.mjs")];
  const tests = [imports("test/index.test.mjs", ["../packages/one/index.mjs"])];

  assert.deepEqual(namesakeCompanions(source, tests, "packages", namesakeIndex(tests)), {
    with: 1,
    of: 2,
    root: null,
  });
});

test("a bare package specifier names no file in this repository", () => {
  // `import { counters } from "counters"` is a dependency, not the file beside
  // it, and resolving it as a path would credit any file that shares the name.
  const source = [file("ultracode-anywhere/hooks/counters.mjs")];
  const tests = [imports("test/counters.test.mjs", ["counters"])];

  assert.equal(namesakeCompanions(source, tests, "ultracode-anywhere", namesakeIndex(tests)).with, 0);
});

test("an import climbing above the repository root names nothing", () => {
  // Nested, so the top-level pair cannot be what answers it: only the import
  // edge could, and it names a file above the tree that this corpus never held.
  const source = [file("pkg/hooks/counters.mjs")];
  const tests = [imports("test/counters.test.mjs", ["../../outside/counters.mjs"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 0);
});

test("an extension-less specifier answers the file it resolves to", () => {
  // TypeScript and bundler resolution both write the import without the
  // extension, so the two spellings have to reach the same file.
  const source = [file("src/deep/parser.ts")];
  const tests = [imports("test/parser.test.ts", ["../src/deep/parser"])];

  assert.equal(namesakeCompanions(source, tests, "src", namesakeIndex(tests)).with, 1);
});

test("a test naming nothing it covers is still refused by path shape alone", () => {
  // The pinned apps/www decoy, restated with facets present but empty: a parsed
  // file that imports nothing has said nothing, and the tail still governs.
  const source = [file("apps/www/Page0.tsx"), file("apps/www/Page1.tsx")];
  const tests = [imports("test/Page0.test.tsx", []), imports("test/Page1.test.tsx", [])];

  assert.deepEqual(namesakeCompanions(source, tests, "apps/www", namesakeIndex(tests)), {
    with: 0,
    of: 2,
    root: null,
  });
});

test("a data file of the same name is not the module beside it", () => {
  // Dropping the extension to let `./parser` answer `parser.ts` also let
  // `./defaults.json` answer `defaults.mjs`, crediting a module with a test
  // that only ever reads the table next to it.
  // Nested, so only the import edge could answer it, and the edge names the
  // table rather than the module.
  const source = [file("pkg/lib/defaults.mjs")];
  const tests = [imports("test/defaults.test.mjs", ["../pkg/lib/defaults.json"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 0);
});
