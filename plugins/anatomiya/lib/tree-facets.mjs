/**
 * What one file read through tree-sitter says about itself: whether a test
 * runner would collect it, which one, and whether it holds anything at all.
 *
 * The evidence is what the file imports or is annotated with, as it is for a
 * JavaScript file, never where it sits or what it is called. A name is a claim
 * the layout weighs with the rest of the repository; this is the file's own.
 */
import { SHAPES } from "./tree-shapes.mjs";
import { fieldOf, nameOf, walkTree } from "./tree-walk.mjs";

const JVM_CASES = new Map(["Test", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate"].map((name) => [name, null]));
const JVM_IMPORTS = [
  [/^org\.junit\./, "junit"],
  [/^org\.testng\./, "testng"],
];

/**
 * Per language, how a file declares a case and names what runs it.
 *
 * `imports` reads a runner off an import path. `marks` is the annotations that
 * declare a case, each with the runner it names where the annotation alone
 * says and null where the import has to. `named` is a function name that is a
 * case only beside its runner's import: `def test_connection` is ordinary code
 * in a file that imports no runner.
 */
const RUNNERS = {
  python: {
    // `unittest.mock` is what a pytest file imports from it, so it names nothing.
    imports: [
      [/(^|\.)pytest(\.|$)/, "pytest"],
      [/(^|\.)unittest(\.(?!mock)|$)/, "unittest"],
    ],
    named: /^test/,
  },
  php: { imports: [[/^PHPUnit\./, "phpunit"]], marks: new Map([["Test", null]]), named: /^test/ },
  go: { imports: [[/(^|\.)testing(\.|$)/, "go test"]], named: /^(Test|Benchmark|Fuzz|Example)/ },
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
  },
  rust: { marks: new Map([["test", "cargo test"]]) },
  kotlin: { imports: [[/^kotlin\.test(\.|$)/, "kotlin.test"], ...JVM_IMPORTS], marks: JVM_CASES },
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
 */
function importPaths(node, imported) {
  const isName = typeof imported === "string" ? (n) => n.field === imported : (n) => imported?.includes(n.type) === true;
  const shared = [];
  const names = [];
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (n !== node && isName(n)) names.push(leaves(n));
    else if (!n.children.length) shared.push(n.text);
    else for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
  }
  return names.length ? names.map((own) => [...shared, ...own].join(".")) : [shared.join(".")];
}

/** `{ testRunner, testCalls }` for one plain tree, and `empty: true` where it holds no statement or declaration. */
export function treeFacets(program, lang) {
  const shapes = SHAPES[lang];
  const rules = RUNNERS[lang];
  const of = (key) => new Set(shapes[key] ?? []);
  const [fns, imports, annotations, args, mods, calls, comments, headers] = ["fn", "import", "annotation", "args", "mod", "call", "comment", "header"].map(of);

  const imported = [];
  let marked = false;
  let markedBy = null;
  let named = false;
  let called = false;

  walkTree(program, (node, ctx) => {
    if (imports.has(node.type)) imported.push(...importPaths(node, shapes.imported));
    else if (annotations.has(node.type)) {
      const name = leaves(node, args).at(-1);
      // A Rust file's own unit tests sit in a module of it, and the file is still source.
      if (rules.marks?.has(name) && !ctx.ancestors.some((above) => mods.has(above.type))) {
        marked = true;
        markedBy ??= rules.marks.get(name);
      }
    } else if (fns.has(node.type)) named ||= rules.named?.test(nameOf(node) ?? "") === true;
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

  const cases = marked || (named && runner !== null);
  const empty = program.children.every((child) => comments.has(child.type) || headers.has(child.type));
  return {
    testRunner: markedBy ?? (cases ? runner : null) ?? (called ? "pest" : null),
    testCalls: cases || called,
    // Absent unless true, as the other two engines send it.
    ...(empty ? { empty: true } : {}),
  };
}
