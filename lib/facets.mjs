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
import { MINITEST_NAME } from "./test-shape.mjs";

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
 * The left-hand side of a CommonJS export, or null for any other assignment.
 *
 * `module.exports` answers the empty string, because what it publishes is
 * decided by the right-hand side rather than by the name; `exports.foo` and
 * `module.exports.foo` answer `foo`. A computed member spells an expression and
 * names nothing this can read.
 */
function cjsTarget(node) {
  if (!node || node.type !== "MemberExpression" || node.computed) return null;
  const name = node.property?.name ?? null;
  const o = node.object;
  if (o?.type === "Identifier" && o.name === "module" && name === "exports") return "";
  if (o?.type === "Identifier" && o.name === "exports" && name) return name;
  if (cjsTarget(o) === "" && name) return name;
  return null;
}

const ANONYMOUS_VALUE = new Set(["FunctionExpression", "ArrowFunctionExpression", "ClassExpression"]);

/**
 * The names one CommonJS assignment publishes, and the locals it publishes them
 * from.
 *
 * The two are different questions here for the reason they are in ESM:
 * `module.exports = { public: helper }` hands out `public` and spends the local
 * `helper`, which is the name an unexported helper has to be told apart from.
 * A right-hand side this cannot name, `module.exports = require("./x")` or a
 * call, publishes nothing rather than a guess.
 */
function takeCjsExport(node, exports, exportedLocals) {
  if (node.operator !== "=") return;
  const target = cjsTarget(node.left);
  if (target === null) return;
  // `module.exports = exports = {...}` points both names at one object, and
  // what it publishes is at the end of the chain rather than beside the first.
  let right = node.right;
  while (right?.type === "AssignmentExpression" && right.operator === "=") right = right.right;

  if (target !== "") {
    exports.push(target);
    if (right?.type === "Identifier") exportedLocals.add(right.name);
    return;
  }

  if (right?.type === "ObjectExpression") {
    for (const p of right.properties ?? []) {
      if (p.computed || (p.type !== "Property" && p.type !== "ObjectProperty")) continue;
      // An accessor is read through the object rather than defined under that
      // name here, and the usual shape is a lazy `require` whose export belongs
      // to the module it names.
      if (p.kind === "get" || p.kind === "set") continue;
      const key = p.key?.name ?? (typeof p.key?.value === "string" ? p.key.value : null);
      if (key === null) continue;
      exports.push(key);
      if (p.value?.type === "Identifier") exportedLocals.add(p.value.name);
    }
    return;
  }

  // Whatever a file assigns whole is what importing it gives you, which is what
  // `default` names on the other side of the same question.
  if (right?.type === "Identifier") {
    exports.push("default");
    exportedLocals.add(right.name);
  } else if (right && ANONYMOUS_VALUE.has(right.type)) {
    exports.push("default");
  }
}

/**
 * `program` for the walk, `module` for the parser's own record of the imports
 * and exports it saw. The record is already built and was being discarded.
 *
 * Its own walk, rather than a visitor folded into the dimensions': stubbed to a
 * constant, eslint's 1,489 files parse 40ms faster out of 1.45s, so the second
 * walk is under 3% and the shared hook would cost more to read than it saves.
 */
export function jsFacets({ program, module: mod }) {
  const imports = [];
  // Which of the entries above still run: a statement where every specifier is
  // `isType` (an `import type`, or every named specifier carrying `type`)
  // never reaches the runtime, so it can never be what runs the file, even
  // though it still belongs on the imports list a reader sees.
  const valueImports = new Set();
  for (const s of mod?.staticImports ?? []) {
    const names = s.entries.map((e) =>
      e.importName.kind === "Default"
        ? "default"
        : e.importName.kind === "NamespaceObject"
          ? "*"
          : e.importName.name
    );
    const entry = { module: s.moduleRequest.value, names, relative: isRelative(s.moduleRequest.value) };
    imports.push(entry);
    if (s.entries.length === 0 || s.entries.some((e) => !e.isType)) valueImports.add(entry);
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
  // Whether a runner's own word is called anywhere, not just at the top level:
  // Ember nests `test(...)` one level inside `acceptance(...)`, and that still
  // declares a case. `testCalls` below stays top-level-only, the claim it has
  // always been; this is the looser question the runner label now needs
  // answered before an import edge alone can set it.
  let declaresTest = false;
  // Names, not a count: a `module.exports = { helper }` sits at the foot of the
  // file and the function it publishes was walked past long before it.
  const helpers = [];

  walk(program, (n, ctx) => {
    if (n.type === "JSXElement" || n.type === "JSXFragment") jsx = true;

    if (n.type === "ExpressionStatement" && n.expression?.type === "CallExpression") {
      const c = n.expression.callee;
      const name = c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" ? c.object?.name : null;
      if (TEST_CALLS.has(name)) {
        declaresTest = true;
        if (ctx.enclosing === null) testCalls = true;
      }
    }

    // Everything below is a claim about the module's own top level, and
    // `enclosing` is null there and nowhere else.
    if (ctx.enclosing !== null) return;

    if (n.type === "VariableDeclarator" && n.init?.type === "CallExpression" && n.init.callee?.name === "require") {
      const m = stringValue(n.init.arguments?.[0]);
      if (m !== null) {
        const names =
          n.id.type === "ObjectPattern" ? n.id.properties.map((p) => p.key?.name).filter(Boolean) : ["default"];
        const entry = { module: m, names, relative: isRelative(m) };
        imports.push(entry);
        valueImports.add(entry);
      }
    }

    if (n.type === "ExpressionStatement" && n.expression?.type === "AssignmentExpression") {
      takeCjsExport(n.expression, exports, exportedLocals);
    }

    if (n.type === "FunctionDeclaration" && n.id) helpers.push(n.id.name);
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && n.init && isFunctionLike(n.init)) {
      helpers.push(n.id.name);
    }
  });

  const inlineHelpers = helpers.filter((name) => !exportedLocals.has(name)).length;

  // An import edge alone used to be enough: a config file importing
  // `defineConfig`, or a page object importing only a type, took the runner's
  // label with no case anywhere in the file. Requiring `declaresTest` costs
  // nothing a real spec had, since every runner's own words are exactly what
  // `TEST_CALLS` already looks for.
  let testRunner = null;
  if (declaresTest) {
    for (const i of imports) {
      if (!valueImports.has(i) || !TEST_RUNNER_MODULES.has(i.module)) continue;
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
 * `Rails::` or an application prefix still lands. Twelve: beside
 * `Minitest::Test` and `ActiveSupport::TestCase`, an integration, controller,
 * job, mailer, view and system test each name their own, and so do
 * ActionCable's three and ActionMailbox's.
 */
export const MINITEST_SUPERCLASSES = [
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
  if (MINITEST_NAME.test(path)) return true;
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
