import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { repo } from "./ts-repo.mjs";
import { needsRuby } from "./ruby-available.mjs";
import { parseAll } from "../lib/parse.mjs";
import { MINITEST_SUPERCLASSES, TEST_RUNNER_MODULES } from "../lib/facets.mjs";
import { language } from "../lib/langs.mjs";

/**
 * What a file says about itself, beside what the dimensions counted in it.
 *
 * A facet is not a convention: nothing here is conforming or violating, and
 * nothing is compared against the repository. It is the handful of answers a
 * later pass needs to say what a directory is for, computed where the tree
 * already is because the tree does not cross the process boundary.
 */

// Driven through `parseAll`, which is the seam the scan and the check both use:
// the facets are computed in the worker, so asking the function directly would
// not prove they ever reach a record.
const list = (dir, files) => files.map((rel) => ({ rel, abs: join(dir, rel), lang: language(rel) }));

test("jsFacets reads imports, exports, jsx, runner and inline helpers", async (t) => {
  const dir = repo({
    "a.tsx": `import React, { useState } from "react"\nimport * as U from "~/utils/user"\nimport type { T } from "./t"\nconst { x } = require("./cjs")\nexport const foo = () => 1\nfunction bar() {}\nconst baz = () => 2\nexport default function Comp() { return <div/> }\n`,
    "b.test.ts": `import { describe, it, expect } from "vitest"\ndescribe("b", () => { it("x", () => { expect(1).toBe(1) }) })\n`,
    "c.js": `const chai = require("chai")\ndescribe("c", function () {})\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["a.tsx", "b.test.ts", "c.js"]));

  const a = records.get("a.tsx").facets;
  assert.equal(a.jsx, true);
  assert.deepEqual(a.imports, [
    { module: "react", names: ["default", "useState"], relative: false },
    { module: "~/utils/user", names: ["*"], relative: false },
    { module: "./t", names: ["T"], relative: true },
    { module: "./cjs", names: ["x"], relative: true },
  ]);
  assert.deepEqual(a.exports, ["foo", "default"]);
  assert.equal(a.testRunner, null);
  assert.equal(a.inlineHelpers, 2, "bar and baz; foo and Comp are exported");

  assert.equal(records.get("b.test.ts").facets.testRunner, "vitest");
  assert.equal(records.get("b.test.ts").facets.testCalls, true);

  const c = records.get("c.js").facets;
  assert.equal(c.testRunner, "chai");
  assert.equal(c.testCalls, true);
});

/**
 * What a CommonJS file hands out, which the parser's static export record does
 * not hold.
 *
 * The record is the ESM one, so a repository written in `require` reported
 * `exports: []` for every file and counted every module-level function as an
 * inline helper. Both are what the reuse line and the helper count read, so a
 * whole directory read as private plumbing nobody imports.
 */
test("a CommonJS file's exports are read off its assignments", async (t) => {
  const dir = repo({
    "obj.js": `function a() {}\nfunction b() {}\nfunction hidden() {}\nmodule.exports = { a, top: b, run() {} }\n`,
    "one.js": `function run() {}\nmodule.exports = run\n`,
    "anon.js": `module.exports = function () {}\n`,
    "klass.js": `module.exports = class Widget {}\n`,
    "named.js": `function make() {}\nexports.make = make\nmodule.exports.other = () => 1\nfunction hidden() {}\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = ["obj.js", "one.js", "anon.js", "klass.js", "named.js"];
  const { records } = await parseAll(list(dir, rels));
  const facets = (rel) => records.get(rel).facets;

  assert.deepEqual(facets("obj.js").exports, ["a", "top", "run"]);
  assert.equal(facets("obj.js").inlineHelpers, 1, "hidden alone; a and b are handed out");
  assert.deepEqual(facets("one.js").exports, ["default"]);
  assert.equal(facets("one.js").inlineHelpers, 0, "the file is the function it assigns");
  assert.deepEqual(facets("anon.js").exports, ["default"]);
  assert.deepEqual(facets("klass.js").exports, ["default"]);
  assert.deepEqual(facets("named.js").exports, ["make", "other"]);
  assert.equal(facets("named.js").inlineHelpers, 1, "make is exported, hidden is not");
});

test("a chained CommonJS assignment hands out the object at the end of the chain", async (t) => {
  // `module.exports = exports = {...}` is how a file keeps both names pointing
  // at the same object, and reading only the outer right-hand side saw an
  // assignment rather than an object and published nothing.
  const dir = repo({
    "chain.js": `function a() {}\nfunction hidden() {}\nmodule.exports = exports = { a, b: 2 }\n`,
    "lazy.js": `function plain() {}\nmodule.exports = { get other() { return require("./other") }, plain }\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["chain.js", "lazy.js"]));
  const facets = (rel) => records.get(rel).facets;

  assert.deepEqual(facets("chain.js").exports, ["a", "b"]);
  assert.equal(facets("chain.js").inlineHelpers, 1, "hidden alone; a is handed out");
  assert.deepEqual(facets("lazy.js").exports, ["plain"], "a getter names no binding of this file's own");
});

test("a file whose Flow types were stripped still answers its facets", async (t) => {
  // The retry parses a blanked copy, so the module record the facets read is
  // that parse's own. The stripper deletes `import type` outright, which costs
  // this file one import and nothing else.
  const dir = repo({
    "flow.js": [
      "// @flow",
      'import type { Opts } from "./opts"',
      'import { run } from "./run"',
      "type Exact = {| n: string |}",
      "export function greet(o: Exact): string { return run(o.n) }",
      "function helper() { return 1 }",
      "",
    ].join("\n"),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["flow.js"]));
  const r = records.get("flow.js");

  assert.equal(r.kind, "ok");
  assert.equal(r.stripped, true, "the retry has to have fired, or this asserts nothing");
  assert.deepEqual(r.facets.imports, [{ module: "./run", names: ["run"], relative: true }]);
  assert.deepEqual(r.facets.exports, ["greet"]);
  assert.equal(r.facets.inlineHelpers, 1);
  assert.equal(r.facets.jsx, false);
});

test("rubyFacets says which test runner a file speaks", needsRuby, async (t) => {
  // Neither engine can read the runner off the path: `spec/` and `test/` are
  // conventions a repository may hold either way round, and a Rails app puts
  // its RSpec files under `spec/` while its generators write `test/`. What a
  // file always carries is the DSL it is written in.
  const dir = repo({
    "spec/a_spec.rb": `RSpec.describe Foo do\n  it "x" do\n  end\nend\n`,
    "test/b_test.rb": `class BTest < ActiveSupport::TestCase\n  def test_x\n  end\nend\n`,
    "app/models/c.rb": `class C < ApplicationRecord\nend\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = ["spec/a_spec.rb", "test/b_test.rb", "app/models/c.rb"];
  const { records } = await parseAll(list(dir, rels));

  assert.equal(records.get("spec/a_spec.rb").facets.testRunner, "rspec");
  assert.equal(records.get("spec/a_spec.rb").facets.testCalls, true);
  assert.equal(records.get("test/b_test.rb").facets.testRunner, "minitest");
  assert.equal(records.get("test/b_test.rb").facets.testCalls, true);
  assert.equal(records.get("app/models/c.rb").facets.testRunner, null);
  assert.equal(records.get("app/models/c.rb").facets.testCalls, false);
});

/**
 * Every module the runner table recognises, and the runner it maps to.
 *
 * Written out here rather than read from `TEST_RUNNER_MODULES`, for the reason
 * `test/applicability.test.mjs` writes its closed tables out: an expectation
 * read from the table agrees with the table by construction and can never
 * disagree with it. A table is one shape, so dropping `qunit` from it makes
 * every Ember repository's tests read as source and changes no shape any other
 * test here can see.
 *
 * The comparison runs both ways. Driving each member through a real parse shows
 * the table did not shrink; the equality below shows it did not grow, which is
 * where somebody decides whether a new name belongs.
 */
const RUNNER_TABLE = [
  ["vitest", "vitest"],
  ["jest", "jest"],
  ["@jest/globals", "jest"],
  ["mocha", "mocha"],
  ["chai", "chai"],
  ["ava", "ava"],
  ["tap", "tap"],
  ["node:test", "node:test"],
  ["cypress", "cypress"],
  ["qunit", "qunit"],
  ["@playwright/test", "playwright"],
  ["playwright", "playwright"],
];

test("every module the runner table names is read off a real import", async (t) => {
  const files = Object.fromEntries(
    RUNNER_TABLE.map(([module], i) => [
      `m${i}.test.js`,
      `import * as runner from "${module}"\ndescribe("x", () => {\n  it("y", () => {})\n})\n`,
    ])
  );
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = Object.keys(files);
  const { records } = await parseAll(list(dir, rels));

  assert.deepEqual(
    rels.map((rel) => [RUNNER_TABLE[Number(rel.slice(1, rel.indexOf(".")))][0], records.get(rel).facets.testRunner]),
    RUNNER_TABLE
  );
});

test("the runner table holds exactly the modules driven through it", () => {
  assert.deepEqual([...TEST_RUNNER_MODULES], RUNNER_TABLE, "a module was added to the table or lost from it");
});

test("a runner the table names is read off the import, qunit included", async (t) => {
  // Ember nests `test(...)` a level inside `acceptance(...)`, never at the
  // file's own top level, so nothing here is a top-level case the way
  // `describe`/`it` usually are; the runner still needs the import.
  const dir = repo({
    "tests/acceptance/login-test.js": `import { test } from "qunit"\nacceptance("Login", function () {\n  test("x", function (assert) { assert.ok(true) })\n})\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["tests/acceptance/login-test.js"]));

  assert.equal(records.get("tests/acceptance/login-test.js").facets.testRunner, "qunit");
});

test("a type-only import does not set the test runner", async (t) => {
  // oxc marks each specifier `isType`, for `import type { X }` and for a
  // per-specifier `type` modifier; neither one ever runs, so neither can be
  // what runs the file. `mixed.spec.ts` still counts: `test` is a value
  // entry in the same statement as the type-only one.
  const dir = repo({
    "setup.ts": `import type { ProvidedContext } from "vitest"\nexport const ctx = 1\n`,
    "mixed.spec.ts": `import { test, type TestInfo } from "@playwright/test"\ntest("x", (info: TestInfo) => {})\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["setup.ts", "mixed.spec.ts"]));

  const setup = records.get("setup.ts").facets;
  assert.equal(setup.testRunner, null, "the only import of vitest here is type-only");
  assert.equal(setup.testCalls, false);
  assert.deepEqual(
    setup.imports,
    [{ module: "vitest", names: ["ProvidedContext"], relative: false }],
    "the import still shows what the file references, type or not"
  );

  assert.equal(
    records.get("mixed.spec.ts").facets.testRunner,
    "playwright",
    "test is a value entry in the same import statement"
  );
});

test("an import alone does not set the test runner without a declared case", async (t) => {
  const dir = repo({
    "cypress.config.ts": `import { defineConfig } from "cypress"\nexport default defineConfig({ e2e: {} })\n`,
    "page.ts": `import { Page } from "@playwright/test"\nexport class LoginPage {\n  page: Page\n  constructor(page: Page) { this.page = page }\n  async open() { await this.page.goto("/login") }\n}\n`,
    "no-import.cy.js": `describe("login", () => {\n  it("works", () => {\n    cy.visit("/login")\n  })\n})\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = ["cypress.config.ts", "page.ts", "no-import.cy.js"];
  const { records } = await parseAll(list(dir, rels));

  const config = records.get("cypress.config.ts").facets;
  assert.equal(config.testRunner, null, "defineConfig is called, not a case declared");
  assert.equal(config.testCalls, false);

  assert.equal(
    records.get("page.ts").facets.testRunner,
    null,
    "Page is a helper import, no case anywhere in the file"
  );

  const spec = records.get("no-import.cy.js").facets;
  assert.equal(spec.testRunner, null, "cypress is never imported, so nothing names the runner");
  assert.equal(spec.testCalls, true, "describe/it/cy still declare the case without an import");
});

/**
 * Every base class that makes a Ruby file minitest, spelled out for the same
 * reason `RUNNER_TABLE` is: an expectation read from the table agrees with it
 * by construction. Twelve: beside `Minitest::Test` and `ActiveSupport::TestCase`,
 * an integration, controller, job, mailer, view and system test each name
 * their own, and so do ActionCable's three and ActionMailbox's.
 */
const MINITEST_TABLE = [
  "Minitest::Test",
  "ActiveSupport::TestCase",
  "ActionDispatch::IntegrationTest",
  "ActionController::TestCase",
  "ActiveJob::TestCase",
  "ActionMailer::TestCase",
  "ActionView::TestCase",
  "ActionDispatch::SystemTestCase",
  "ActionCable::TestCase",
  "ActionCable::Channel::TestCase",
  "ActionCable::Connection::TestCase",
  "ActionMailbox::TestCase",
];

test("every minitest base class the table names is read off a real class", needsRuby, async (t) => {
  const files = Object.fromEntries(
    MINITEST_TABLE.map((base, i) => [`app/models/m${i}.rb`, `class M${i} < ${base}\nend\n`])
  );
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = Object.keys(files);
  const { records } = await parseAll(list(dir, rels));

  assert.deepEqual(
    rels.map((rel) => records.get(rel).facets.testRunner),
    MINITEST_TABLE.map(() => "minitest")
  );
});

test("the minitest base table holds exactly the classes driven through it", () => {
  assert.deepEqual(MINITEST_SUPERCLASSES, MINITEST_TABLE, "a base class was added to the table or lost from it");
});

test("a method named test_ in an ordinary class is not a minitest case", needsRuby, async (t) => {
  // `def test_connection` is ordinary Ruby: a service exposes it, a client
  // pings with it. Counting it made empire-flippers/api read
  // `app/services: 6 minitest specs` and discourse `lib: 3 minitest specs`.
  // The signal is the base class or the file's own shape, never the method
  // name on its own.
  const dir = repo({
    "app/services/webhook.rb": `class Webhook\n  def test_connection\n  end\nend\n`,
    "test/webhook_test.rb": `class WebhookTest\n  def test_connection\n  end\nend\n`,
    "app/models/probe.rb": `class Probe < ActiveSupport::TestCase\n  def test_x\n  end\nend\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = ["app/services/webhook.rb", "test/webhook_test.rb", "app/models/probe.rb"];
  const { records } = await parseAll(list(dir, rels));

  assert.equal(records.get("app/services/webhook.rb").facets.testRunner, null);
  assert.equal(records.get("app/services/webhook.rb").facets.testCalls, false);
  assert.equal(records.get("test/webhook_test.rb").facets.testRunner, "minitest", "the file says so itself");
  assert.equal(records.get("app/models/probe.rb").facets.testRunner, "minitest", "the base class says so");
});

test("a DSL call inside a method is not a case the file declares", needsRuby, async (t) => {
  // The Ruby half of the JS half's top-level rule. A page object writes
  // `context "..." do` inside a method to name a step, and only a body that
  // declares its cases outside every method is declaring a suite. A class or
  // module body is where RSpec's own describes sit, so it stays a site.
  const dir = repo({
    "app/pages/page.rb": `class Page\n  def open\n    context "x" do\n    end\n  end\nend\n`,
    "spec/foo_spec.rb": `RSpec.describe Foo do\n  it "x" do\n  end\nend\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const rels = ["app/pages/page.rb", "spec/foo_spec.rb"];
  const { records } = await parseAll(list(dir, rels));

  assert.equal(records.get("app/pages/page.rb").facets.testRunner, null);
  assert.equal(records.get("app/pages/page.rb").facets.testCalls, false);
  assert.equal(records.get("spec/foo_spec.rb").facets.testRunner, "rspec");
  assert.equal(records.get("spec/foo_spec.rb").facets.testCalls, true);
});

test("an ordinary call named like the DSL is not one, without a block", needsRuby, async (t) => {
  // `context`, `it` and `feature` are ordinary Ruby method names: an Interactor
  // service reads `context.amount` in every one of its files, and typing those
  // as specs would put a runner on the whole service directory. Every call the
  // DSL makes takes a block and an attribute read never does.
  const dir = repo({
    "app/services/charge.rb": `class Charge\n  include Interactor\n\n  def call\n    context.amount = 100\n  end\nend\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["app/services/charge.rb"]));
  const r = records.get("app/services/charge.rb");

  assert.equal(r.kind, "ok");
  assert.equal(r.facets.testRunner, null);
  assert.equal(r.facets.testCalls, false);
});
