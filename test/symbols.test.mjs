import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commentAbove, docLine, lineAt, lineStarts, paramsText } from "../plugins/anatomiya/lib/symbols.mjs";
import { parseFile } from "../plugins/anatomiya/lib/parse-file.mjs";
import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { parseRuby } from "../plugins/anatomiya/lib/ruby.mjs";
import { needsRuby } from "./ruby-available.mjs";

test("a line is found for an offset, the first and the last included", () => {
  const starts = lineStarts("ab\ncd\n\nef");
  assert.deepEqual(starts, [0, 3, 6, 7]);
  assert.deepEqual([0, 2, 3, 6, 7, 8].map((at) => lineAt(starts, at)), [1, 1, 2, 3, 4, 4]);
});

test("the comment right above a line is read past attributes, and a blank line or code ends it", () => {
  const source = "x = 1\n// one\n// two\n@Deco()\nfn()\n\n// far\n\nfn2()\n";
  const starts = lineStarts(source);
  assert.equal(commentAbove(source, starts, 5), "// one\n// two");
  assert.equal(commentAbove(source, starts, 9), null);
  assert.equal(commentAbove(source, starts, 1), null);
});

test("a hash opens a comment only where the language says so", () => {
  const source = "class A {\n  #count = 0;\n  inc() {}\n}\n";
  assert.equal(commentAbove(source, lineStarts(source), 3), null);
  const python = "# Counts.\ndef count():\n";
  assert.equal(commentAbove(python, lineStarts(python), 2, true), "# Counts.");
});

test("a doc comment is cut to its first sentence, without markers, tags or pragmas", () => {
  assert.equal(docLine("/**\n * Compare two URLs. Ignores the hash.\n * @param a first\n */"), "Compare two URLs.");
  assert.equal(docLine("/// <summary>\n/// Generates a comb guid.\n/// </summary>"), "Generates a comb guid.");
  assert.equal(docLine("// eslint-disable-next-line\n// Keyed by page"), "Keyed by page");
  assert.equal(docLine('"""Return the engine.\n\n    Args:\n        ctx: x\n    """'), "Return the engine.");
  assert.equal(docLine("# frozen_string_literal: true"), null);
  assert.equal(docLine("// @ts-ignore"), null);
  assert.equal(docLine(null), null);
  assert.equal(docLine(`// ${"word ".repeat(40)}`).length, 60);
  // A docstring in single quotes, and one with a prefix, are read without them.
  assert.equal(docLine('"Single quoted doc."'), "Single quoted doc.");
  assert.equal(docLine('R"""Raw doc. More."""'), "Raw doc.");
  assert.equal(docLine("u'''Unicode doc.'''"), "Unicode doc.");
});

test("an inner doc comment documents the module it sits in, not the item below it", () => {
  const rust = "//! Crate docs.\nfn main() {}\n";
  assert.equal(commentAbove(rust, lineStarts(rust), 2), null);
  const banner = "/*! Library v1 | MIT */\nexport function f() {}\n";
  assert.equal(commentAbove(banner, lineStarts(banner), 2), null);
  // The item's own doc below the module's is still the item's.
  const both = "//! Crate.\n/// Doc of f.\nfn f() {}\n";
  assert.equal(commentAbove(both, lineStarts(both), 3), "/// Doc of f.");
});

test("a Flow file's parameters are read as written, not as the stripper blanked them", async () => {
  const r = await parseFile("// @flow\n/** Adds. */\nexport function add(a: number, b: number): number { return a + b; }\n", "src/add.js", "js");
  assert.deepEqual(r.facets.symbols, [["add", "fn", 3, null, "(a: number, b: number)", "Adds."]]);
});

test("a parameter list is one line, capped, and null where nothing was written", () => {
  assert.equal(paramsText("(a,\n    b = 1)"), "(a, b = 1)");
  assert.equal(paramsText("   "), null);
  assert.equal(paramsText(null), null);
  assert.equal(paramsText(`(${"a, ".repeat(50)})`).length, 80);
});

test("JavaScript: module-level functions, classes and their methods, and types; nothing a function holds", async () => {
  const source = [
    "/** Compare two URLs. */",
    "export function compareUrls(a, b) {",
    "  function inner() {}",
    "  return a === b;",
    "}",
    "// Keyed by page.",
    "export const toKey = (href) => href;",
    "export class Store {",
    "  #count = 0;",
    "  /** Bumps it. */",
    "  inc(by = 1) { return by; }",
    "  get size() { return 1; }",
    "}",
    "export interface Props { a: string }",
  ].join("\n");
  const r = await parseFile(source, "src/a.ts", "js");
  assert.deepEqual(r.facets.symbols, [
    ["compareUrls", "fn", 2, null, "(a, b)", "Compare two URLs."],
    ["toKey", "fn", 7, null, "(href)", "Keyed by page."],
    ["Store", "class", 8, null, null, null],
    ["inc", "method", 11, "Store", "(by = 1)", "Bumps it."],
    ["Props", "type", 14, null, null, null],
  ]);
});

test("a function a class field holds is a method of the class, and a field holding a value is not", async () => {
  const source = "export class Panel {\n  count = 0;\n  /** Opens it. */\n  handleOpen = (event) => event;\n  static make = function (x) { return x; };\n  [key]() {}\n  #hidden(a) {}\n  #inner = () => 1;\n}\n";
  const r = await parseFile(source, "src/panel.ts", "js");
  assert.deepEqual(r.facets.symbols, [
    ["Panel", "class", 1, null, null, null],
    ["handleOpen", "method", 4, "Panel", "(event)", "Opens it."],
    ["make", "method", 5, "Panel", "(x)", null],
  ]);
});

test("CommonJS: a function assigned to exports is a definition, and one assigned elsewhere is not", async () => {
  const source = "// Strips it.\nexports.unIndent = function (s) {};\nmodule.exports.trim = (s) => s;\nfoo.bar = function () {};\nmodule.exports = {};\n";
  const r = await parseFile(source, "lib/a.js", "js");
  assert.deepEqual(r.facets.symbols, [
    ["unIndent", "fn", 2, null, "(s)", "Strips it."],
    ["trim", "fn", 3, null, "(s)", null],
  ]);
});

test("a component's script block is indexed at the lines of the file", async () => {
  const r = await parseFile('<template><div/></template>\n<script setup lang="ts">\n// Formats.\nfunction fmt(d) { return d }\n</script>\n', "src/A.vue", "vue");
  assert.deepEqual(r.facets.symbols, [["fmt", "fn", 4, null, "(d)", "Formats."]]);
});

const TREE = {
  python: [
    "a.py",
    '@decorate\ndef compare_urls(a: str, b: str) -> bool:\n    """Compare two URLs."""\n    def inner(): pass\n    return a == b\n\nclass Repo(Base):\n    # Finds one.\n    def find(self, id):\n        return id\n\n# Doubles it.\ndouble = lambda x, y=2: x * y\nlimit = 3\n',
    [
      ["compare_urls", "fn", 2, null, "(a: str, b: str)", "Compare two URLs."],
      ["Repo", "class", 7, null, null, null],
      ["find", "method", 9, "Repo", "(self, id)", "Finds one."],
      // A lambda bound to a name is a function by that name; any other value is not.
      ["double", "fn", 13, null, "(x, y=2)", "Doubles it."],
    ],
  ],
  go: [
    "a.go",
    "package db\n\n// GetEngine returns the session.\nfunc GetEngine(ctx context.Context) Engine {\n\treturn nil\n}\n\ntype Server struct{}\n\n// Run starts it.\nfunc (s *Server) Run(port int) error { return nil }\n\nconst Max = 3\n\nfunc (l *List[T]) Push(v T) {}\n",
    [
      ["GetEngine", "fn", 4, null, "(ctx context.Context)", "GetEngine returns the session."],
      ["Server", "type", 8, null, null, null],
      ["Run", "method", 11, "Server", "(port int)", "Run starts it."],
      ["Max", "const", 13, null, null, null],
      // A generic receiver's type is the list's, not its parameter's.
      ["Push", "method", 15, "List", "(v T)", null],
    ],
  ],
  java: [
    "A.java",
    "package p;\n\n/** Utilities for JSON. */\npublic class JSONUtils {\n  /**\n   * Parse an object.\n   */\n  @Deprecated\n  public static <T> T parseObject(String s) { return null; }\n\n  /** Makes one. */\n  JSONUtils(int depth) {}\n}\n",
    [
      ["JSONUtils", "class", 4, null, null, "Utilities for JSON."],
      ["parseObject", "method", 8, "JSONUtils", "(String s)", "Parse an object."],
      ["JSONUtils", "method", 12, "JSONUtils", "(int depth)", "Makes one."],
    ],
  ],
  csharp: [
    "A.cs",
    "namespace X;\npublic static class CoreHelpers {\n  /// <summary>\n  /// Generates a comb guid.\n  /// </summary>\n  [Obsolete]\n  public static Guid GenerateComb() { return Guid.Empty; }\n  public CoreHelpers(int seed) {}\n}\n/// <summary>Combines two.</summary>\npublic delegate int Combine(int a, int b);\n",
    [
      ["CoreHelpers", "class", 2, null, null, null],
      ["GenerateComb", "method", 6, "CoreHelpers", "()", "Generates a comb guid."],
      ["CoreHelpers", "method", 8, "CoreHelpers", "(int seed)", null],
      ["Combine", "type", 11, null, "(int a, int b)", "Combines two."],
    ],
  ],
  rust: [
    "a.rs",
    "/// Makes a v7 uuid.\n#[inline]\npub fn uuid_v7() -> Uuid { todo!() }\n\nstruct Db;\nimpl Db {\n    /// Opens it.\n    pub fn open(path: &Path) -> Self { Db }\n}\nimpl<T> Pool<T> {\n    pub fn new(t: T) -> Self { todo!() }\n}\nimpl crate::store::Bar {\n    fn b(&self) {}\n}\nimpl Foo for (A, B) {\n    fn f(&self) {}\n}\n/// Squares it.\nmacro_rules! square {\n    ($x:expr) => { $x * $x };\n}\n",
    [
      ["uuid_v7", "fn", 3, null, "()", "Makes a v7 uuid."],
      ["Db", "type", 5, null, null, null],
      ["open", "method", 8, "Db", "(path: &Path)", "Opens it."],
      ["new", "method", 11, "Pool", "(t: T)", null],
      ["b", "method", 14, "Bar", "(&self)", null],
      // A trait implemented for a tuple names no type of its own.
      ["f", "method", 17, null, "(&self)", null],
      ["square", "fn", 20, null, null, "Squares it."],
    ],
  ],
  kotlin: [
    "A.kt",
    "package p\n\n/** Preview helper. */\nobject PreviewHelper {\n  // Wraps content.\n  fun wrap(content: String): String = content\n}\n\nclass Box(val v: Int) {\n  /** From text. */\n  constructor(text: String) : this(text.length)\n}\n\n/** Ids of users. */\ntypealias Ids = List<Int>\n",
    [
      ["PreviewHelper", "class", 4, null, null, "Preview helper."],
      ["wrap", "method", 6, "PreviewHelper", "(content: String)", "Wraps content."],
      ["Box", "class", 9, null, null, null],
      ["constructor", "method", 11, "Box", "(text: String)", "From text."],
      ["Ids", "type", 15, null, null, "Ids of users."],
    ],
  ],
  php: [
    "A.php",
    "<?php\n\n# Picks one.\nfunction helper($a, $b = 2) { return $a; }\n\nclass Role {\n  /**\n   * Get the system role.\n   */\n  public static function getSystemRole(string $name): Role { return new Role(); }\n}\n",
    [
      ["helper", "fn", 4, null, "($a, $b = 2)", "Picks one."],
      ["Role", "class", 6, null, null, null],
      ["getSystemRole", "method", 10, "Role", "(string $name)", "Get the system role."],
    ],
  ],
};

for (const [lang, [rel, source, want]] of Object.entries(TREE)) {
  test(`${lang}: each definition no function holds, with its container, parameters and doc sentence`, async () => {
    const r = await parseTreeFile(source, rel, lang, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.facets.symbols, want);
  });
}

test("ruby: methods, classes and modules, a doc that a blank line cuts off left out", needsRuby, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-symbols-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "role.rb"),
    "# frozen_string_literal: true\n\n# License header.\n\nmodule Admin\n  # Finds the system role.\n  class Role < Base\n    # Gets it.\n    def self.get_system_role(name, strict: true)\n      def inner; end\n    end\n  end\nend\n\ndef top_helper(a)\nend\n"
  );
  const { results } = await parseRuby([{ rel: "app/models/role.rb", abs: join(dir, "role.rb") }]);
  assert.deepEqual(results[0].facets.symbols, [
    ["Admin", "module", 5, null, null, null],
    ["Role", "class", 7, "Admin", null, "Finds the system role."],
    ["get_system_role", "method", 9, "Role", "(name, strict: true)", "Gets it."],
    ["top_helper", "fn", 15, null, "(a)", null],
  ]);
});

test("ruby: a doc above `private def` is read, and a file of thousands of documented methods parses at its own pace", needsRuby, async (t) => {
  // Prism's attach_comments! walked every comment against every node: 9,000 documented methods went silent past the child's clock.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-symbols-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.rb"), "class A\n  # Hides it.\n  private def hidden(x) = x\nend\n");
  writeFileSync(join(dir, "big.rb"), Array.from({ length: 9000 }, (_, i) => `# doc ${i}\ndef m${i}(a) # t\nend\n`).join(""));
  const { results } = await parseRuby([
    { rel: "a.rb", abs: join(dir, "a.rb") },
    { rel: "big.rb", abs: join(dir, "big.rb") },
  ]);
  const byRel = new Map(results.map((r) => [r.rel, r]));
  assert.deepEqual(byRel.get("a.rb").facets.symbols, [["A", "class", 1, null, null, null], ["hidden", "method", 3, "A", "(x)", "Hides it."]]);
  const big = byRel.get("big.rb");
  assert.equal(big.ok, true, big.error);
  assert.deepEqual(big.facets.symbols.at(-1), ["m8999", "fn", 26999, null, "(a)", "doc 8999"]);
});

test("ruby: an =begin block documents the method right below it, and a file holding bytes that are no UTF-8 keeps its docs", needsRuby, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-symbols-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "embdoc.rb"), "=begin\nDoc of a.\n=end\ndef a; end\ndef b; end\n");
  writeFileSync(join(dir, "binary.rb"), Buffer.from('# encoding: ascii-8bit\ns = "\xff" # x\n# Doc of z.\ndef z; end\n', "latin1"));
  const { results } = await parseRuby([
    { rel: "embdoc.rb", abs: join(dir, "embdoc.rb") },
    { rel: "binary.rb", abs: join(dir, "binary.rb") },
  ]);
  const byRel = new Map(results.map((r) => [r.rel, r]));
  assert.deepEqual(byRel.get("embdoc.rb").facets.symbols, [["a", "fn", 4, null, "()", "Doc of a."], ["b", "fn", 5, null, "()", null]]);
  assert.deepEqual(byRel.get("binary.rb").facets.symbols, [["z", "fn", 4, null, "()", "Doc of z."]]);
});
