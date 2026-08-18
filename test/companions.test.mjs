import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions, namesakeIndex } from "../lib/companions.mjs";

const file = (rel) => ({ rel });

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
    { rel: "spec/models/foo_spec.rb", dir: "spec/models", bare: "models" },
  ]);
});
