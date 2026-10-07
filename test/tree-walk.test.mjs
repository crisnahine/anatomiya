import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Language, Parser } from "web-tree-sitter";

import { copyTree, fieldOf, nameFieldOf, nameOf, site, walkTree } from "../plugins/anatomiya/lib/tree-walk.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";
import * as SAMPLES from "./tree-samples.mjs";

await Parser.init();
const LANGUAGES = new Map();

async function parserFor(lang) {
  if (!LANGUAGES.has(lang)) LANGUAGES.set(lang, await Language.load(join(ANATOMIYA, "grammars", `${lang}.wasm`)));
  const parser = new Parser();
  parser.setLanguage(LANGUAGES.get(lang));
  return parser;
}

/** The plain copy of one source, taken as the engine will take it: the wasm tree is gone before anything reads the copy. */
async function plain(lang, source, { broken = false } = {}) {
  const parser = await parserFor(lang);
  const tree = parser.parse(source);
  try {
    assert.equal(tree.rootNode.hasError, broken, `${lang} sample: ${tree.rootNode.toString()}`);
    return copyTree(tree, source, lang);
  } finally {
    tree.delete();
    parser.delete();
  }
}

function collect(program) {
  const seen = [];
  walkTree(program, (node) => seen.push(node));
  return seen;
}

const firstOf = (program, type) => collect(program).find((node) => node.type === type);

test("a Python tree is copied with its types, its fields and offsets that slice the source", async () => {
  const source = "# 😀 an astral character, two UTF-16 units\ndef named(a):\n    return a\n\nx = 1\n";
  const program = await plain("python", source);

  assert.equal(program.type, "module");
  assert.equal(program.lang, "python");
  assert.equal(program.start, 0);
  assert.equal(program.end, source.length);
  assert.deepEqual(program.children.map((node) => node.type), ["comment", "function_definition", "expression_statement"]);

  const fn = program.children[1];
  assert.equal(fieldOf(fn, "name").text, "named");
  assert.equal(nameOf(fn), "named");
  assert.equal(source.slice(fn.start, fn.end), "def named(a):\n    return a");
  assert.equal(fn.line, 2);
  assert.equal(program.children[2].line, 5);
  assert.equal(fieldOf(fn, "body").field, "body");
  assert.equal("field" in fn, false, "a node that fills no field of its parent carries none");
});

/** Each named node's line as the live tree reports it beside the line its copy carries, and the types that start on a line break. */
async function linesOf(lang, source) {
  const parser = await parserFor(lang);
  const tree = parser.parse(source);
  const reported = [];
  const onBreak = [];
  try {
    const cursor = tree.walk();
    walk: for (;;) {
      if (cursor.nodeIsNamed) {
        reported.push(cursor.startPosition.row + 1);
        if (source[cursor.startIndex] === "\n" || source[cursor.startIndex] === "\r") onBreak.push(cursor.nodeType);
        if (cursor.gotoFirstChild()) continue;
      }
      while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) break walk;
    }
    return { reported, onBreak, lines: collect(copyTree(tree, source, lang)).map((node) => node.line) };
  } finally {
    tree.delete();
    parser.delete();
  }
}

test("every node's line is the one the parser reports, across CRLF, blank lines and a string that spans several", async () => {
  const source = 'import os\r\n\r\n"""a\nb 😀\nc"""\n\n\nclass A:\n    def f(self):\n        x = [\n            1,\n            2,\n        ]\n        return x\n';
  const { reported, lines } = await linesOf("python", source);

  assert.ok(lines.length > 20, `read ${lines.length} nodes`);
  assert.equal(Math.max(...lines), 14);
  assert.deepEqual(lines, reported);
});

// What each sample holds that starts on the line break ending the line before it.
const ON_BREAK = {
  python: "block",
  php: "heredoc_body",
  go: "raw_string_literal_content",
  java: "multiline_string_fragment",
  csharp: "raw_string_content",
  rust: "string_content",
  kotlin: "string_content",
};

for (const [lang, type] of Object.entries(ON_BREAK)) {
  test(`a ${lang} node that starts on a line break is on the line that break ends, with LF and with CRLF`, async () => {
    for (const source of [SAMPLES[lang], SAMPLES[lang].replaceAll("\n", "\r\n")]) {
      const { reported, onBreak, lines } = await linesOf(lang, source);

      assert.ok(onBreak.includes(type), `${lang} nodes on a line break: ${onBreak}`);
      assert.deepEqual(lines, reported);
    }
  });
}

test("a file that opens with blank lines has a root that starts where its first node does, on that node's line", async () => {
  const program = await plain("php", "\n\n<p>\n<?php\necho 1;\n");

  assert.deepEqual([program.start, program.line], [2, 3]);
  assert.deepEqual(program.children.map((node) => [node.type, node.start, node.line]), [["text", 2, 3], ["php_tag", 6, 4], ["echo_statement", 12, 5]]);
});

test("a file that is one long line has its newlines searched for once, not once per node", async () => {
  const source = `x = [${"1, ".repeat(2000)}1]\n`;
  const parser = await parserFor("python");
  const tree = parser.parse(source);
  let scanned = 0;
  // The copy reads the source through these two calls only, so a stand-in can count what a search walked over.
  const counting = {
    indexOf(needle, from = 0) {
      const at = source.indexOf(needle, from);
      scanned += (at === -1 ? source.length : at) - from + 1;
      return at;
    },
    slice: (start, end) => source.slice(start, end),
  };
  let copied;
  try {
    copied = copyTree(tree, counting, "python");
  } finally {
    tree.delete();
    parser.delete();
  }

  assert.ok(collect(copied).length > 2000);
  assert.ok(scanned <= 2 * source.length, `searched ${scanned} units of a ${source.length} unit source`);
});

test("children are the named nodes in order, comments among them, and no token is copied", async () => {
  const source = "class A {\n    // why\n    int f(int a, int b) { return a + b; }\n}\n";
  const program = await plain("java", source);
  const body = fieldOf(program.children[0], "body");

  assert.deepEqual(body.children.map((node) => node.type), ["line_comment", "method_declaration"]);
  assert.equal(body.children[0].text, "// why");
  const types = new Set(collect(program).map((node) => node.type));
  for (const token of ["{", "}", "(", ")", ";", "+", "class", "return", ","]) assert.equal(types.has(token), false, token);
  assert.deepEqual(
    fieldOf(body.children[1], "parameters").children.map((param) => nameOf(param)),
    ["a", "b"]
  );
});

test("text is on a node with no named child and on no other, cut at 256 UTF-16 units", async () => {
  const long = "a".repeat(300);
  const source = `${long} = 1\nshort = "s"\nf()\n`;
  const program = await plain("python", source);

  for (const node of collect(program)) {
    assert.equal("text" in node, node.children.length === 0, `${node.type} at ${node.start}`);
    if ("text" in node) assert.equal(node.text, source.slice(node.start, Math.min(node.end, node.start + 256)));
  }
  const name = firstOf(program, "identifier");
  assert.equal(name.end - name.start, 300);
  assert.equal(name.text.length, 256);
  // A node whose children are all tokens is a leaf here, and reads as its own text.
  assert.equal(firstOf(program, "argument_list").text, "()");
});

test("a field that repeats is read by its first, and one that is absent reads as null", async () => {
  const program = await plain("python", "from y import a, b\nimport z\n");
  const [from, bare] = program.children;

  assert.equal(fieldOf(from, "name").children[0].text, "a", "the first of a field that repeats");
  assert.equal(fieldOf(from, "module_name").children[0].text, "y");
  assert.equal(fieldOf(bare, "module_name"), null);
  assert.equal(nameOf(from), null, "a dotted name is not a leaf, so it has no text of its own");
});

test("a site carries the type, the name, the line and both offsets", async () => {
  const source = "\n\nfunc Top() {}\n";
  const program = await plain("go", `package p${source}`);
  const fn = firstOf(program, "function_declaration");

  assert.deepEqual(site(fn), { type: "function_declaration", name: "Top", line: 3, start: 11, end: 24 });
  assert.deepEqual(site(program), { type: "source_file", name: null, line: 1, start: 0, end: 25 });
});

test("the tokens a node holds are listed only where the table asks for them", async () => {
  const java = await plain("java", "class A {\n    @Override\n    public static void f() {}\n    int g() { return 1; }\n}\n");
  const modifiers = collect(java).filter((node) => node.type === "modifiers");
  assert.equal(modifiers.length, 1);
  assert.deepEqual(modifiers[0].tokens, ["public", "static"]);
  assert.equal("text" in modifiers[0], false, "the annotation is a named child, so the text is not kept");
  assert.equal(collect(java).filter((node) => "tokens" in node).length, 1);

  const kotlin = await plain("kotlin", "import a.b.*\nimport a.b.C\nimport a.b.C as D\n\nfun f() = 1\n");
  assert.deepEqual(
    kotlin.children.filter((node) => node.type === "import").map((node) => node.tokens),
    [["import", ".", "*"], ["import"], ["import", "as"]]
  );
  assert.equal(collect(kotlin).filter((node) => "tokens" in node).length, 3);

  const python = await plain("python", "from x import *\n\ndef f():\n    pass\n");
  assert.equal(collect(python).filter((node) => "tokens" in node).length, 0);
});

test("the copy is plain data: it survives the tree's deletion and a trip through JSON unchanged", async () => {
  const program = await plain("rust", "use a::*;\n\n/// Doc.\npub fn f() -> i32 { 1 }\n");

  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
  for (const node of collect(program)) {
    assert.equal(Object.getPrototypeOf(node), Object.prototype);
    for (const key of Object.keys(node)) assert.ok(["type", "start", "end", "line", "field", "text", "children", "tokens", "lang"].includes(key), key);
  }
  assert.equal(collect(program).filter((node) => "lang" in node).length, 1);
});

test("a tree with an error in it is still copied, since the copy does not decide what is readable", async () => {
  const program = await plain("java", "class A { int f() { return 1 +* ; } }", { broken: true });

  assert.equal(program.type, "program");
  assert.ok(collect(program).some((node) => node.type === "ERROR"));
});

const DEPTH = 200_000;

test("a tree 200,000 levels deep is copied and walked without overflowing the stack", { timeout: 60_000 }, async () => {
  let source = "x = ";
  for (let i = 0; i < DEPTH; i++) source += "(";
  source += "1";
  for (let i = 0; i < DEPTH; i++) source += ")";
  source += "\n";

  const program = await plain("python", source);

  let depth = 0;
  let node = program;
  while (node.children.length) {
    node = node.children.at(-1);
    depth++;
  }
  assert.ok(depth >= DEPTH, `the copy is ${depth} deep`);
  assert.equal(node.type, "integer");
  assert.equal(node.text, "1");

  let visited = 0;
  let deepest = 0;
  walkTree(program, (_, ctx) => {
    visited++;
    if (ctx.ancestors.length > deepest) deepest = ctx.ancestors.length;
  });
  assert.equal(deepest, depth);
  assert.ok(visited > DEPTH, `visited ${visited}`);
});

// One method of one class per language, and the statement inside it the walk is asked about.
const METHODS = {
  python: { source: "class A:\n    def f(self):\n        return 1\n", at: "return_statement", fn: "f", cls: "class_definition" },
  php: { source: "<?php\nclass A {\n    function f() { return 1; }\n}\n", at: "return_statement", fn: "f", cls: "class_declaration" },
  java: { source: "class A {\n    int f() { return 1; }\n}\n", at: "return_statement", fn: "f", cls: "class_declaration" },
  csharp: { source: "class A {\n    int F() { return 1; }\n}\n", at: "return_statement", fn: "F", cls: "class_declaration" },
  rust: { source: "struct A;\n\nimpl A {\n    fn f(&self) -> i32 { return 1; }\n}\n", at: "return_expression", fn: "f", cls: "impl_item" },
  kotlin: { source: "class A {\n    fun f(): Int {\n        return 1\n    }\n}\n", at: "return_expression", fn: "f", cls: "class_declaration" },
  // Go writes a method beside its type, not inside it, so there is no body for it to be in.
  go: { source: "package p\n\ntype A struct{}\n\nfunc (a A) F() int {\n\treturn 1\n}\n", at: "return_statement", fn: "F", cls: null },
};

for (const [lang, { source, at, fn, cls }] of Object.entries(METHODS)) {
  test(`a statement in a ${lang} method is handed its method and the body that method is in`, async () => {
    const program = await plain(lang, source);
    const seen = [];
    walkTree(program, (node, ctx) => {
      if (node.type !== at) return;
      seen.push({ fn: ctx.fn, cls: ctx.cls, enclosing: ctx.enclosing, stack: [...ctx.stack], ancestors: [...ctx.ancestors] });
    });

    assert.equal(seen.length, 1);
    const [ctx] = seen;
    assert.equal(nameOf(ctx.fn), fn);
    assert.equal(ctx.enclosing, ctx.fn);
    assert.equal(ctx.cls?.type ?? null, cls);
    assert.deepEqual(ctx.stack, cls ? [ctx.cls, ctx.fn] : [ctx.fn]);
    assert.equal(ctx.ancestors[0], program);
    assert.ok(ctx.ancestors.includes(ctx.fn));
    assert.ok(ctx.ancestors.length > ctx.stack.length, "blocks are ancestors and not declarations");
  });
}

test("a declaration is handed what encloses it, never itself, and file level reads as null", async () => {
  const program = await plain("python", "import os\n\nclass A:\n    def f(self):\n        def inner():\n            pass\n\ndef top():\n    pass\n");
  const at = new Map();
  walkTree(program, (node, ctx) => {
    if (node.type === "function_definition" || node.type === "class_definition" || node.type === "import_statement") {
      at.set(nameOf(node) ?? node.type, { fn: ctx.fn && nameOf(ctx.fn), cls: ctx.cls && nameOf(ctx.cls), enclosing: ctx.enclosing && nameOf(ctx.enclosing), depth: ctx.stack.length });
    }
  });

  assert.deepEqual(at.get("import_statement"), { fn: null, cls: null, enclosing: null, depth: 0 });
  assert.deepEqual(at.get("A"), { fn: null, cls: null, enclosing: null, depth: 0 });
  assert.deepEqual(at.get("f"), { fn: null, cls: "A", enclosing: "A", depth: 1 });
  assert.deepEqual(at.get("inner"), { fn: "f", cls: "A", enclosing: "f", depth: 2 });
  assert.deepEqual(at.get("top"), { fn: null, cls: null, enclosing: null, depth: 0 }, "what the class opened is closed again");
});

test("the walk visits every node once, a parent before its children and siblings in source order", async () => {
  const program = await plain("go", 'package p\n\nimport "fmt"\n\n// F does.\nfunc F() { fmt.Println(1) }\n');
  const seen = collect(program);

  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen[0], program);
  const starts = seen.map((node) => node.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  let count = 0;
  for (const work = [program]; work.length; count++) work.push(...work.pop().children);
  assert.equal(seen.length, count);
});

test("a tree of a language the table does not hold is refused, not walked as if nothing in it were a function", () => {
  assert.throws(() => walkTree({ type: "module", start: 0, end: 0, line: 1, children: [], lang: "cobol" }, () => {}), /cobol/);
  assert.throws(() => walkTree({ type: "module", start: 0, end: 0, line: 1, children: [] }, () => {}), /undefined/);
});

test("the walk is handed a tree and loads no parser of its own", () => {
  const src = readFileSync(join(ANATOMIYA, "lib", "tree-walk.mjs"), "utf8");
  const imported = [...src.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  // The registry is a leaf, and the table of node names is data.
  assert.deepEqual(imported, ["./langs.mjs", "./tree-shapes.mjs"]);
});

test("the one field a definition's name sits in is read off the table, and a table naming two is refused", () => {
  assert.equal(nameFieldOf({ go: { name: "name" }, rust: { name: "name" } }), "name");
  assert.throws(
    () => nameFieldOf({ go: { name: "name" }, csharp: { name: "simple_name" } }),
    /^Error: SHAPES names a definition's name field name and simple_name: nameOf reads one$/
  );
});

test("the walk holds the table of node names to the registry where it loads", () => {
  // In a process of its own: an entry is taken out of the table before the walk is first imported, which this file did long ago.
  const lib = (name) => JSON.stringify(pathToFileURL(join(ANATOMIYA, "lib", name)).href);
  const script = `const { SHAPES } = await import(${lib("tree-shapes.mjs")}); delete SHAPES.go; await import(${lib("tree-walk.mjs")});`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /^Error: SHAPES has no entry for go$/m);
});
