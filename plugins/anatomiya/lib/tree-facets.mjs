/**
 * What one file read through tree-sitter says about itself: whether a test
 * runner would collect it, which one, and whether it holds anything at all.
 *
 * The evidence is what the file imports, is annotated with and declares. Its
 * path is read only where the language's own tool collects by it: `go test`
 * builds `_test.go` and nothing else, cargo a file under `tests`, and pytest a
 * `test_*.py` that imports nothing from pytest at all.
 */
import { coveredStem, isTestTree } from "./test-shape.mjs";
import { SHAPES } from "./tree-shapes.mjs";
import { fieldOf, nameOf, walkTree } from "./tree-walk.mjs";

const JVM_CASES = new Map(["Test", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate"].map((name) => [name, null]));
const JVM_IMPORTS = [
  [/^org\.junit\./, "junit"],
  [/^org\.testng\./, "testng"],
];

const stemAt = (rel) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
const dirsAt = (rel) => rel.split("/").slice(0, -1);

// The layout's own two questions, asked of a path: a family is its language's id for all seven.
const namedTest = (lang) => (rel) => coveredStem(stemAt(rel), lang) !== null;
const inTestTree = (lang) => (rel) => dirsAt(rel).some((segment) => isTestTree(segment, lang));

/**
 * Per language, how a file declares a case and names what runs it.
 *
 * `imports` reads a runner off the module an import names, anchored at its
 * first segment: `from app import unittest` imports no runner. `marks` is the
 * annotations that declare a case, each with the runner it names where the
 * annotation alone says and null where the import has to. `named` is a
 * function name that is a case only beside its runner's import, a base class
 * matching `base`, or a path the runner collects by, which `claims` answers:
 * `def test_connection` is ordinary code anywhere else. `unimported` is the
 * runner such a case has when nothing in the file imports one.
 */
const RUNNERS = {
  python: {
    // `unittest.mock` is what a pytest file imports from it, so it names nothing. Django's cases are unittest's.
    imports: [
      [/^pytest(\.|$)/, "pytest"],
      [/^unittest(\.(?!mock(\.|$))|$)/, "unittest"],
      [/^django\.test(\.|$)/, "unittest"],
    ],
    named: /^test/,
    // pytest's fixtures are functions too, and a conftest names one `test_client`.
    notCase: "fixture",
    // Measured on django: 1,382 files under `tests` wear no test name and 252 of them hold cases, every `tests.py` among them.
    claims: (rel) => namedTest("python")(rel) || inTestTree("python")(rel),
    // A function at file level, or a class nothing made, is only pytest's to collect.
    unimported: (plain) => (plain ? "pytest" : "unittest"),
  },
  php: {
    imports: [[/^PHPUnit\./, "phpunit"]],
    marks: new Map([["Test", null]]),
    named: /^test/,
    // Slim and composer extend a `TestCase` of their own, so 206 of their 214 test files import nothing of PHPUnit's.
    base: /TestCase$/,
    claims: (rel) => namedTest("php")(rel) && inTestTree("php")(rel),
    unimported: () => "phpunit",
    calls: inTestTree("php"),
  },
  // The compiler's rule and not an import's: 11 files in caddy and hugo declare `func Test` or `func Fuzz` outside a `_test.go`, and `go test` runs none.
  go: { named: /^(Test|Benchmark|Fuzz|Example)/, claims: namedTest("go"), unimported: () => "go test", collectedByName: true },
  java: { imports: JVM_IMPORTS, marks: JVM_CASES },
  // C# names its runner on the case: a project-wide `global using` leaves a test file importing nothing.
  csharp: {
    marks: new Map([
      ["Fact", "xunit"],
      ["Theory", "xunit"],
      ["Test", "nunit"],
      ["TestCase", "nunit"],
      ["TestCaseSource", "nunit"],
      ["TestMethod", "mstest"],
      ["DataTestMethod", "mstest"],
    ]),
    // `[Fact]` is the class `FactAttribute`, and either spelling compiles.
    markSuffix: "Attribute",
    alias: (node) => (node.children.length > 1 ? fieldOf(node, "name") : null),
  },
  rust: {
    marks: new Map([["test", "cargo test"]]),
    // cargo collects a file under `tests`; tokio splits a module's unit tests into a `tests.rs` beside it, 5 files and 5 holding cases.
    claims: (rel) => dirsAt(rel).includes("tests") || stemAt(rel) === "tests",
    inline: true,
  },
  kotlin: {
    imports: [[/^kotlin\.test(\.|$)/, "kotlin.test"], ...JVM_IMPORTS],
    marks: JVM_CASES,
    // `import a.B as C` has no field for `C`: it is the child after the `as` token.
    alias: (node) => (node.tokens?.includes("as") ? node.children.at(-1) : null),
  },
};

// Pest declares a case by calling one of these at file level, and imports nothing to do it.
const PEST_CALLS = new Set(["it", "test"]);

const NONE = new Set();

/** The text of every leaf under a node in source order, passing over the subtrees of the given types. */
function leaves(node, except = NONE) {
  const out = [];
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (!n.children.length) out.push(n.text);
    else for (let i = n.children.length - 1; i >= 0; i--) if (!except.has(n.children[i].type)) work.push(n.children[i]);
  }
  return out;
}

const lastSegment = (path) => path.slice(path.lastIndexOf(".") + 1);

/**
 * One dotted path per name an import brings in. `imported` is what marks a
 * name where one statement can list several, a field or node types: joined
 * into one path, `from unittest import mock, TestCase` read as `unittest.mock`.
 * The name an import is renamed to is no part of where it came from.
 */
function importPaths(node, imported, alias) {
  const isName = typeof imported === "string" ? (n) => n.field === imported : (n) => imported?.includes(n.type) === true;
  const renamed = (n) => n === alias || n.field === "alias";
  const own = (name) => {
    const out = [];
    const work = [name];
    while (work.length) {
      const n = work.pop();
      if (renamed(n)) continue;
      if (!n.children.length) out.push(n.text);
      else for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
    }
    return out;
  };
  const shared = [];
  const names = [];
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (renamed(n)) continue;
    if (n !== node && isName(n)) names.push(own(n));
    else if (!n.children.length) shared.push(n.text);
    else for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
  }
  return names.length ? names.map((name) => [...shared, ...name].join(".")) : [shared.join(".")];
}

/**
 * `{ testRunner, testCalls }` for one plain tree at one path, `inlineTests: true`
 * where a source file holds its own cases, and `empty: true` where it holds no
 * statement or declaration.
 */
export function treeFacets(program, lang, rel = "") {
  const shapes = SHAPES[lang];
  const rules = RUNNERS[lang];
  const of = (key) => new Set(shapes[key] ?? []);
  const [fns, imports, annotations, args, calls, comments, headers, bases] = [
    "fn", "import", "annotation", "args", "call", "comment", "header", "base",
  ].map(of);
  const claimed = rules.claims?.(rel) === true;

  const imported = [];
  const aliases = new Map();
  const notCases = new Set();
  let marked = false;
  let markedBy = null;
  let named = false;
  // A case nothing made: a function at file level, or a method of a class with no base.
  let plain = false;
  let based = false;
  let called = false;

  walkTree(program, (node, ctx) => {
    if (imports.has(node.type)) {
      const alias = rules.alias?.(node) ?? null;
      const paths = importPaths(node, shapes.imported, alias);
      imported.push(...paths);
      if (alias) aliases.set(alias.text, lastSegment(paths[0]));
    } else if (annotations.has(node.type)) {
      const written = leaves(node, args);
      if (rules.notCase && written.includes(rules.notCase)) notCases.add(ctx.ancestors.at(-1));
      let name = aliases.get(written.at(-1)) ?? written.at(-1);
      if (rules.markSuffix && !rules.marks.has(name) && name?.endsWith(rules.markSuffix)) name = name.slice(0, -rules.markSuffix.length);
      if (rules.marks?.has(name)) {
        marked = true;
        markedBy ??= rules.marks.get(name);
      }
    } else if (fns.has(node.type)) {
      // A function inside a function is collected by nothing.
      if (ctx.fn === null && rules.named?.test(nameOf(node) ?? "") === true && !notCases.has(ctx.ancestors.at(-1))) {
        named = true;
        plain ||= !(shapes.bases && ctx.cls && fieldOf(ctx.cls, shapes.bases));
      }
    } else if (bases.has(node.type)) based ||= rules.base?.test(leaves(node).at(-1) ?? "") === true;
    else if (calls.has(node.type) && ctx.enclosing === null) called ||= PEST_CALLS.has(fieldOf(node, shapes.callee)?.text);
  });

  // The import the case annotation came from decides before any other: a
  // Kotlin file takes `org.junit.Test` and its assertions from `kotlin.test`.
  const ordered = [...imported.filter((path) => rules.marks?.has(lastSegment(path))), ...imported];
  let runner = null;
  for (const path of ordered) {
    runner = (rules.imports ?? []).find(([pattern]) => pattern.test(path))?.[1] ?? null;
    if (runner) break;
  }

  const empty = program.children.every((child) => comments.has(child.type) || headers.has(child.type));
  // Cases cargo does not collect from here are the file's own, in a module of it or beside its code, and the file stays source.
  const inline = rules.inline === true && marked && !claimed;
  if (inline) marked = false;
  // Where the name is the collector's whole rule, what the name collects is the runner's with or without a case in it.
  const collected = rules.collectedByName === true && claimed && !empty;
  const cases = marked || (named && (runner !== null || based || claimed));
  const pest = called && rules.calls?.(rel) === true;
  const unimported = cases || collected ? (rules.unimported?.(plain) ?? null) : null;
  return {
    testRunner: (marked ? markedBy : null) ?? (cases ? runner : null) ?? unimported ?? (pest ? "pest" : null),
    testCalls: cases || pest,
    // Absent unless true, as the other two engines send `empty`.
    ...(inline ? { inlineTests: true } : {}),
    ...(empty ? { empty: true } : {}),
  };
}
