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

const MINITEST_SUPERCLASSES = [
  "Minitest::Test",
  "ActiveSupport::TestCase",
  "ActionDispatch::IntegrationTest",
  "ActionController::TestCase",
  "ActiveJob::TestCase",
  "ActionMailer::TestCase",
];

export function rubyFacets(program) {
  let rspec = false;
  let minitest = false;
  let testCalls = false;

  walkRuby(program, (n, ctx) => {
    if (n.t === "call" && RUBY_TEST_CALLS.has(n.name)) {
      // A receiver other than `RSpec` makes this somebody's method, not the
      // DSL: `page.context` and `RSpec.describe` are both calls named in the
      // set and only one of them says what the file is.
      const bare = !n.receiver || constName(n.receiver) === "RSpec";
      if (bare) {
        testCalls = true;
        if (RSPEC_CALLS.has(n.name)) rspec = true;
      }
    }
    if (n.t === "class" && MINITEST_SUPERCLASSES.some((s) => (constName(n.superclass) ?? "").endsWith(s))) {
      minitest = true;
    }
    if (n.t === "def" && n.name?.startsWith("test_") && ctx.cls) {
      minitest = true;
      testCalls = true;
    }
  });

  // The superclass wins over the calls, because shoulda-context writes
  // `context` blocks inside an `ActiveSupport::TestCase` and that file is
  // minitest whatever vocabulary its bodies are in.
  return { testRunner: minitest ? "minitest" : rspec ? "rspec" : null, testCalls };
}
