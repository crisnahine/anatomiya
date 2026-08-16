/**
 * What one file says about itself: what it pulls in, what it hands out, and
 * which vocabulary it is written in.
 *
 * Not a dimension. A dimension asks whether a site conforms to what the rest of
 * the repository does, and every answer here is about this file alone, so
 * nothing is compared, gated or counted against a denominator. A directory's
 * purpose is a claim about what its files import and export together, and that
 * question needs the raw answers before any of them are pooled.
 *
 * Asked where each tree already is, for the same reason the dimensions are: the
 * JavaScript tree never crosses the process boundary and the Ruby bridge drops
 * its own the moment it has answered, so there is no second pass to run this
 * in. What is kept is this object, a few strings per file.
 */
import { walk, isFunctionLike } from "./walk.mjs";
import { walkRuby, constName } from "./ruby-walk.mjs";

/**
 * The module that names a test runner, and the runner it names.
 *
 * The import is the evidence, not the path: a repository can put its tests in
 * `test/`, beside the source, or in neither, and a `*.spec.tsx` under `src/` is
 * ordinary in one repository and unheard of in the next. What a test file
 * always does is import the thing that runs it.
 */
export const TEST_RUNNER_MODULES = new Map([
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
]);

// The globals a runner injects, for the file that imports nothing because its
// runner puts these in scope: mocha and jest both do, and cypress only does.
const TEST_CALLS = new Set(["describe", "it", "test", "cy"]);

const isRelative = (m) => m.startsWith("./") || m.startsWith("../") || m === "." || m === "..";

// oxc spells a string literal `Literal`, and the other spelling is what every
// Babel-shaped tree calls the same node.
const stringValue = (n) =>
  n && (n.type === "Literal" || n.type === "StringLiteral") && typeof n.value === "string"
    ? n.value
    : null;

/**
 * `program` for the walk, `module` for the parser's own record of the imports
 * and exports it saw. The record is already built and was being discarded.
 */
export function jsFacets({ program, module: mod }) {
  const imports = [];
  for (const s of mod?.staticImports ?? []) {
    const names = s.entries.map((e) =>
      e.importName.kind === "Default"
        ? "default"
        : e.importName.kind === "NamespaceObject"
          ? "*"
          : e.importName.name
    );
    imports.push({ module: s.moduleRequest.value, names, relative: isRelative(s.moduleRequest.value) });
  }

  const exports = [];
  // What a name is exported as, and what it is called here, are different
  // questions: `export { a as b }` publishes `b` and shadows the local `a`,
  // which is the name an unexported helper has to be told apart from.
  const exportedLocals = new Set();
  for (const s of mod?.staticExports ?? []) {
    for (const e of s.entries) {
      if (e.exportName.kind === "Default") exports.push("default");
      else if (e.exportName.kind === "Name" && e.exportName.name) exports.push(e.exportName.name);
      if (e.localName?.name) exportedLocals.add(e.localName.name);
    }
  }

  let jsx = false;
  let testCalls = false;
  let inlineHelpers = 0;

  walk(program, (n, ctx) => {
    if (n.type === "JSXElement" || n.type === "JSXFragment") jsx = true;
    // Everything below is a claim about the module's own top level, and
    // `enclosing` is null there and nowhere else.
    if (ctx.enclosing !== null) return;

    if (n.type === "VariableDeclarator" && n.init?.type === "CallExpression" && n.init.callee?.name === "require") {
      const m = stringValue(n.init.arguments?.[0]);
      if (m !== null) {
        const names =
          n.id.type === "ObjectPattern" ? n.id.properties.map((p) => p.key?.name).filter(Boolean) : ["default"];
        imports.push({ module: m, names, relative: isRelative(m) });
      }
    }

    if (n.type === "ExpressionStatement" && n.expression?.type === "CallExpression") {
      const c = n.expression.callee;
      const name = c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" ? c.object?.name : null;
      if (TEST_CALLS.has(name)) testCalls = true;
    }

    if (n.type === "FunctionDeclaration" && n.id && !exportedLocals.has(n.id.name)) inlineHelpers++;
    if (
      n.type === "VariableDeclarator" &&
      n.id?.type === "Identifier" &&
      n.init &&
      isFunctionLike(n.init) &&
      !exportedLocals.has(n.id.name)
    ) {
      inlineHelpers++;
    }
  });

  let testRunner = null;
  for (const i of imports) {
    if (TEST_RUNNER_MODULES.has(i.module)) {
      testRunner = TEST_RUNNER_MODULES.get(i.module);
      break;
    }
  }

  return { jsx, imports, exports, testRunner, testCalls, inlineHelpers };
}

/**
 * The Ruby test DSLs, which is what a `.rb` file carries instead of an import.
 *
 * Ruby names its runner in the Gemfile and reaches it through `spec_helper`,
 * so there is no per-file import to read the way there is in JavaScript. What
 * every test file does carry is the vocabulary it declares its cases in.
 */
const RSPEC_CALLS = new Set(["describe", "context", "feature", "shared_examples", "it"]);

// `test "x" do` is how Rails and minitest declare a case without a `def`.
const RUBY_TEST_CALLS = new Set([...RSPEC_CALLS, "test"]);

/**
 * The base classes a minitest file inherits, matched on the tail so a
 * `Rails::` or an application prefix still lands. Six because Rails ships six:
 * beside `Minitest::Test` and `ActiveSupport::TestCase`, an integration,
 * controller, job and mailer test each name their own.
 */
export const MINITEST_SUPERCLASSES = [
  "Minitest::Test",
  "ActiveSupport::TestCase",
  "ActionDispatch::IntegrationTest",
  "ActionController::TestCase",
  "ActiveJob::TestCase",
  "ActionMailer::TestCase",
];

const isMinitestClass = (node) =>
  node?.t === "class" && MINITEST_SUPERCLASSES.some((s) => (constName(node.superclass) ?? "").endsWith(s));

/**
 * Whether the file's own path claims it is a minitest file.
 *
 * The second half of the `def test_*` rule, and the reason it needs one:
 * `def test_connection` is ordinary Ruby, and a service that exposes one is not
 * a test. Measured, it put `6 minitest specs` on empire-flippers/api's
 * `app/services` and `3` on discourse's `lib`. Minitest's own convention is the
 * `_test.rb` suffix under `test/`, so a file wearing either is taken at its
 * word and one wearing neither has to say so in its base class.
 */
const minitestByPath = (rel) => {
  const path = String(rel ?? "");
  if (/(^|\/)[^/]*_test\.rb$/.test(path)) return true;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return dir !== "" && dir.split("/").includes("test");
};

export function rubyFacets(program, rel = "") {
  let rspec = false;
  let minitest = false;
  let testCalls = false;

  walkRuby(program, (n, ctx) => {
    // Inside a `def` the call runs when that method does and declares no case:
    // errbit writes its spec macros as plain methods holding `context ... do`.
    // A class or module body is where RSpec's own describes sit and stays a site.
    if (n.t === "call" && n.block && ctx.def === null && RUBY_TEST_CALLS.has(n.name)) {
      // The block is what separates the DSL from a method that happens to share
      // its name: every one of these declares a case and so takes one, while an
      // Interactor service reads `context.amount` in each of its files and a
      // page object calls `feature`. A receiver other than `RSpec` is somebody
      // else's method for the same reason.
      const bare = !n.receiver || constName(n.receiver) === "RSpec";
      if (bare) {
        testCalls = true;
        if (RSPEC_CALLS.has(n.name)) rspec = true;
      }
    }
    if (isMinitestClass(n)) minitest = true;
    // The method name alone says nothing, so the class it is in or the file it
    // is in has to say the rest.
    if (n.t === "def" && n.name?.startsWith("test_") && ctx.cls) {
      if (isMinitestClass(ctx.cls) || minitestByPath(rel)) {
        minitest = true;
        testCalls = true;
      }
    }
  });

  // The superclass wins over the calls, because shoulda-context writes
  // `context` blocks inside an `ActiveSupport::TestCase` and that file is
  // minitest whatever vocabulary its bodies are in.
  return { testRunner: minitest ? "minitest" : rspec ? "rspec" : null, testCalls };
}
