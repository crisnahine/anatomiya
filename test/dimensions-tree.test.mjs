import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";
import { TREE_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-tree.mjs";
import { declOf, engineOf } from "../plugins/anatomiya/lib/langs.mjs";
import { isTestFile, mirroredTests } from "../plugins/anatomiya/lib/layout.mjs";
import { withOneBranch } from "../plugins/anatomiya/lib/csharp-directives.mjs";
import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { TREE_DECLINED } from "./declined-fixtures.mjs";

/**
 * Every source goes through `parseTreeFile` in counts mode, which is the body
 * the worker hosts: a hit read here has crossed `collectHits`, so a field a row
 * adds and the crossing drops reads as missing here too.
 */
async function hits(key, lang, source, rel = `src/a.${declOf(lang).exts[0]}`) {
  const r = await parseTreeFile(source, rel, lang);
  assert.equal(r.ok, true, `${lang} source did not parse: ${JSON.stringify(source)}`);
  return r.hits[key] ?? [];
}

const TEST_FILES = {
  python: ["tests/test_a.py", "import pytest\n\n\ndef test_a():\n    pass\n\n\ndef helper():\n    pass\n"],
  php: [
    "tests/ATest.php",
    "<?php\nuse PHPUnit\\Framework\\TestCase;\n\nclass ATest extends TestCase\n{\n    public function testA() {}\n\n    public function helper() {}\n}\n",
  ],
  go: ["a_test.go", 'package a\n\nimport "testing"\n\nfunc TestA(t *testing.T) {}\n\nfunc Helper() {}\n'],
  java: ["src/test/java/ATest.java", "import org.junit.Test;\n\nclass ATest {\n    @Test\n    public void a() {}\n}\n"],
  csharp: ["tests/ATests.cs", "class ATests\n{\n    [Fact]\n    public void A() { }\n}\n"],
  rust: ["tests/a.rs", "#[test]\nfn works() {}\n\npub fn helper() {}\n"],
  kotlin: ["src/test/kotlin/ATest.kt", "import kotlin.test.Test\n\nclass ATest {\n    @Test\n    fun a() {}\n}\n"],
};

/**
 * Per row and language: each source beside what its sites must answer, in
 * source order. `true` and `false` are conforming, and an empty list is a
 * source that holds the neighbouring construct and no site.
 */
const CASES = {
  caught_error_used: {
    php: [
      ["<?php\ntry { a(); } catch (E $e) { log($e); }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { throw $e; }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { throw new F(); }\n", [true]],
      ["<?php\ntry { a(); } catch (E) { throw new F(); }\n", []],
      ['<?php\ntry { a(); } catch (E $e) { return "failed: $e"; }\n', [true]],
      ["<?php\ntry { a(); } catch (E $e) { $f = fn () => $e; }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { }\n", [false]],
      ["<?php\ntry { a(); } catch (A | B $e) { /* ignored */ }\n", [false]],
      ["<?php\ntry { a(); } catch (E $e) { log($x->e); }\n", [false]],
      // A static property is spelled with the variable's own sigil and reads no variable.
      ["<?php\ntry { a(); } catch (E $e) { A::$e; static::$e = null; self::$e++; }\n", [false]],
      // So is a property an anonymous class declares.
      ["<?php\ntry { a(); } catch (E $e) { $o = new class { static $e; }; }\n", [false]],
      ["<?php\ntry { a(); } catch (E $e) { $o = new class { public $e = 1; private int $f; }; }\n", [false]],
      ["<?php\ntry { a(); } catch (E $e) { $o = new class($e) { public $e; }; }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { log($x->$e); }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { log(A::$$e); }\n", [true]],
      ["<?php\ntry { a(); } catch (E $e) { log($e::$count); }\n", [true]],
      ["<?php\ntry { a(); } catch (A | B) { return null; }\n", []],
      // PHP has its own way to bind nothing, so the word is a name like any other there.
      ["<?php\ntry { a(); } catch (E $ignored) { }\n", [false]],
      ["<?php\ntry { a(); } finally { b(); }\n", []],
    ],
    java: [
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { log(e); }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (final E e) { throw e; }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { throw new F(); }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { run(() -> log(e)); }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E | F e) { }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) {\n            // ignored\n        } catch (F e) { b(e); }\n    }\n}\n", [false, true]],
      // A method and a field of that name are not the error.
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { x.e(); y.e = 1; e(); }\n    }\n}\n", [false]],
      // Nor is an annotation's argument name, or a label and the statements that jump to it.
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { @B(e = 1) int x; }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { e: for (;;) { break e; } }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { e: while (true) { continue e; } }\n    }\n}\n", [false]],
      // Nor is the method a reference names, a case's constant, or an annotation's one argument: none of the three can be a caught variable.
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { run(A::e); }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { run(this::e); run(A::<T>e); }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { switch (k) { case e: break; } }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { int n = switch (k) { case e -> 1; default -> 2; }; }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { @B(e) int x = 0; }\n    }\n}\n", [false]],
      // What a reference is taken from is read, and so is what a switch turns on.
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { run(e::getMessage); }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { switch (e.code()) { case e: break; } }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { @B(v = e) int x; }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { e: for (;;) { log(e); break e; } }\n    }\n}\n", [true]],
      ["class A {\n    void m() {\n        try { a(); } catch (E e) { return; }\n    }\n}\n", [false]],
      // An unnamed variable binds nothing: the clause names a type alone.
      ["class A {\n    void m() {\n        try { a(); } catch (E _) { return; }\n    }\n}\n", []],
      // A handler that names what it caught `ignored` has said it binds nothing, as `_` says it.
      ["class A {\n    void m() {\n        try { a(); } catch (InterruptedException ignored) { }\n    }\n}\n", []],
      ["class A {\n    void m() {\n        try { a(); } catch (final E ignored) { return; } catch (F ignore) { } catch (G expected) { } catch (H Ignored) { }\n    }\n}\n", [false, false, false]],
      // Restoring the interrupt flag reads nothing of the error.
      ["class A {\n    void m() {\n        try { a(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }\n    }\n}\n", [false]],
      ["class A {\n    void m() {\n        try { a(); } finally { }\n    }\n}\n", []],
    ],
  },

  public_doc_comment: {
    python: [
      ['def run():\n    """Run it."""\n    return 1\n', [true]],
      ["class A:\n    def go(self):\n        # why, said before the docstring\n        'Go.' \"Now.\"\n", [true]],
      ["def run():\n    return 1\n", [false]],
      ["class A:\n    def go(self):\n        # not a docstring\n        return 1\n", [false]],
      ['def run():\n    x = 1\n    """Too late to be one."""\n', [false]],
      ["def _hidden():\n    pass\n", []],
      ["class A:\n    def __init__(self):\n        pass\n", []],
      ['def outer():\n    """Outer."""\n    def inner():\n        pass\n', [true]],
      // A stub of an overload set and a property's setter take their documentation from the one that carries it.
      ["import typing as t\n\n\n@t.overload\ndef run(a: int) -> int: ...\n@t.overload\ndef run(a: str) -> str: ...\ndef run(a):\n    return a\n", [false]],
      ['class A:\n    @property\n    def size(self):\n        """Size."""\n        return 1\n\n    @size.setter\n    def size(self, value):\n        pass\n\n    @size.deleter\n    def size(self):\n        pass\n', [true]],
      ["@register(overload)\ndef run():\n    pass\n", [false]],
      // Python makes a docstring of a plain string only, raw or not.
      ['def run():\n    f"doc {x}"\n', [false]],
      ['def run():\n    b"bytes"\n', [false]],
      ['def run():\n    "Runs " f"{x}."\n', [false]],
      ['def run():\n    r"""Matches \\d."""\n', [true]],
      // Parentheses around the string change nothing to Python; a tuple of one string is no string.
      ['def run():\n    ("Runs.")\n', [true]],
      ['def run():\n    (("Runs " "it."))\n', [true]],
      ['def run():\n    (  # why\n        "Runs."\n    )\n', [true]],
      ['def run():\n    ("Runs.",)\n', [false]],
      ['def run():\n    (f"Runs {x}.")\n', [false]],
      // A function written under a condition is not one the module plainly holds.
      ["if FAST:\n    def run():\n        pass\n", []],
    ],
    php: [
      ["<?php\n/** Adds. */\nfunction add() {}\n", [true]],
      ["<?php\nclass A\n{\n    /**\n     * Adds.\n     */\n    #[Pure]\n    public function add() {}\n}\n", [true]],
      ["<?php\n// adds\nfunction add() {}\n", [false]],
      ["<?php\nclass A\n{\n    /* adds */\n    function add() {}\n}\n", [false]],
      // An empty block comment opens on the same three characters and documents nothing.
      ["<?php\n/**/\nfunction add() {}\n", [false]],
      ["<?php\nclass A\n{\n    private function add() {}\n\n    protected function sub() {}\n}\n", []],
      // PHP reads a keyword without its case.
      ["<?php\nclass A\n{\n    PRIVATE function add() {}\n\n    Protected Function sub() {}\n}\n", []],
      ["<?php\nclass A\n{\n    /** Adds. */\n    PUBLIC Static function add() {}\n}\n", [true]],
      ["<?php\n$a = new class {\n    public function add() {}\n};\n", []],
      ["<?php\nif (!function_exists('add')) {\n    function add() {}\n}\n", []],
      ["<?php\nnamespace A {\n    function add() {}\n}\n", [false]],
      // A constructor and a destructor are no site in any language, and PHP reads a method's name without its case.
      ["<?php\nclass A\n{\n    public function __construct() {}\n\n    public function __destruct() {}\n\n    public function __Construct2() {}\n}\n", [false]],
    ],
    go: [
      ["package a\n\n// Run runs.\nfunc Run() {}\n", [true]],
      ["package a\n\n// It does not open on the name, and go doc shows it all the same.\nfunc (t T) Run() {}\n", [true]],
      ["package a\n\n// Run runs.\n//go:noinline\nfunc Run() {}\n", [true]],
      ["package a\n\nfunc Run() {}\n", [false]],
      ["package a\n\n// A note about the file.\n\nfunc Run() {}\n", [false]],
      ["package a\n\n//go:noinline\nfunc Run() {}\n", [false]],
      ["package a\n\n//export Run\nfunc Run() {}\n", [false]],
      ["package a\n\n//line a.go:1\nfunc Run() {}\n", [false]],
      ["package a\n\n//extern run\nfunc Run() {}\n", [false]],
      ["package a\n\nvar limit = 1 // the cap\nfunc Run() {}\n", [false]],
      ["package a\n\nfunc run() {}\n\nfunc (t T) do() {}\n", []],
      // A capitalised method of a type nobody outside the package can name is no part of what the package offers.
      ["package a\n\nfunc (binding) Bind() {}\n\nfunc (b *binding) Name() {}\n\nfunc (s *set[T]) Add(v T) {}\n", []],
      ["package a\n\n// Add adds.\nfunc (s *Set[t]) Add(v t) {}\n", [true]],
      // A method that satisfies a standard interface says what it does by its name, and golint asks no comment of it.
      ['package a\n\nfunc (t T) String() string { return "" }\n\nfunc (t *T) Error() string { return "" }\n\nfunc (t T) Unwrap() error { return nil }\n', []],
      ["package a\n\nfunc (t T) Read(p []byte) (int, error) { return 0, nil }\n\nfunc (t T) Write(p []byte) (int, error) { return 0, nil }\n\nfunc (t T) ServeHTTP(w W, r *R) {}\n", []],
      // The name alone is not the interface: a function of that name is offered as any other is.
      ['package a\n\nfunc String() string { return "" }\n\nfunc (t T) Strings() []string { return nil }\n', [false, false]],
      // Sorting is three methods, and a type holding all three in the file is sortable.
      ["package a\n\nfunc (s S) Len() int { return 0 }\n\nfunc (s S) Less(i, j int) bool { return false }\n\nfunc (s *S) Swap(i, j int) {}\n", []],
      ["package a\n\nfunc (s S) Len() int { return 0 }\n\nfunc (s S) Less(i, j int) bool { return false }\n\nfunc (q Q) Swap(i, j int) {}\n", [false, false, false]],
      ["package a\n\nfunc main() {}\n\nfunc init() {}\n", []],
    ],
    java: [
      ["class A {\n    /** Runs. */\n    @Deprecated\n    public void run() {}\n}\n", [true]],
      ["interface A {\n    /** Runs. */\n    void run();\n}\n", [true]],
      ["enum E {\n    X;\n\n    /** Runs. */\n    public void run() {}\n\n    public void walk() {}\n}\n", [true, false]],
      ["class A {\n    // runs\n    public void run() {}\n}\n", [false]],
      ["class A {\n    /* runs */\n    public void run() {}\n}\n", [false]],
      ["class A {\n    /**/\n    public void run() {}\n}\n", [false]],
      ["interface A {\n    void run();\n}\n", [false]],
      ["class A {\n    void run() {}\n\n    private void walk() {}\n\n    protected void crawl() {}\n}\n", []],
      ["class A {\n    @Override\n    public String toString() { return \"\"; }\n}\n", []],
      ["class A {\n    Runnable r = new Runnable() {\n        public void run() {}\n    };\n}\n", []],
      ["enum E {\n    X {\n        public void run() {}\n    };\n}\n", []],
      ["class A {\n    void m() {\n        class Local {\n            public void run() {}\n        }\n    }\n}\n", []],
      // An interface's method is public with no modifier, and a private one is the interface's own helper.
      ["interface A {\n    private void help() {}\n\n    default void run() { help(); }\n\n    static void make() {}\n}\n", [false, false]],
      // The runtime calls the entry point and nobody looks its documentation up.
      ["public class A {\n    public static void main(String[] args) {}\n}\n", []],
      ["public class A {\n    public void main(String[] args) {}\n}\n", [false]],
    ],
    csharp: [
      ["class A\n{\n    /// <summary>Runs.</summary>\n    [Obsolete]\n    public void Run() { }\n}\n", [true]],
      ["class A\n{\n    /** Runs. */\n    public void Run() { }\n}\n", [true]],
      ["class A\n{\n    /// <summary>\n    /// Runs.\n    /// </summary>\n    public void Run() { }\n}\n", [true]],
      ["interface IA\n{\n    /// <summary>Runs.</summary>\n    void Run();\n}\n", [true]],
      // A directive line between the comment and the method does not unattach the comment.
      ["class A\n{\n    /// <summary>Runs.</summary>\n#pragma warning disable CS0618\n    public void Run() { }\n}\n", [true]],
      ["class A\n{\n#region Running\n    /// <summary>Runs.</summary>\n#nullable enable\n    public void Run() { }\n#endregion\n    public void Walk() { }\n}\n", [true, false]],
      ["class A\n{\n#if NET\n    /// <summary>Runs.</summary>\n    public void Run() { }\n#else\n    public void Walk() { }\n#endif\n}\n", [true, false]],
      // A comment above a conditional documents the member the conditional opens on, and no other member of it.
      ["class A\n{\n    /// <summary>Runs.</summary>\n#if DEBUG\n    public void Run() { }\n#endif\n}\n", [true]],
      ["class A\n{\n    /// <summary>Runs.</summary>\n#if NET\n#if DEBUG\n    [Obsolete]\n    public void Run() { }\n#endif\n    public void Walk() { }\n#endif\n}\n", [true, false]],
      ["class A\n{\n    /// <summary>Counts.</summary>\n#if NET\n    int count;\n    public void Run() { }\n#endif\n}\n", [false]],
      ["class A\n{\n    /// <summary>Runs.</summary>\n\n#if A\n#elif B\n    public void Run() { }\n#else\n    public void Walk() { }\n#endif\n}\n", [false, false]],
      ["class A\n{\n    // runs\n#if DEBUG\n    public void Run() { }\n#endif\n}\n", [false]],
      ["class A\n{\n    //// Not a doc comment: four slashes.\n    public void Run() { }\n}\n", [false]],
      ["interface IA\n{\n    internal void Run();\n}\n", []],
      ["void Run() { }\n\nRun();\n", []],
      ["class A\n{\n    // runs\n    public void Run() { }\n}\n", [false]],
      ["interface IA\n{\n    void Run();\n}\n", [false]],
      ["class A\n{\n    void Run() { }\n\n    internal void Walk() { }\n\n    protected void Crawl() { }\n}\n", []],
      ["class A\n{\n    public override string ToString() { return \"\"; }\n}\n", []],
      ["class A\n{\n    void M()\n    {\n        void Local() { }\n    }\n}\n", []],
      ["class A\n{\n    public static void Main(string[] args) { }\n\n    public A() { }\n}\n", []],
      ["class A\n{\n    public void Main() { }\n\n    public static void main() { }\n}\n", [false, false]],
    ],
    rust: [
      ["/// Runs.\n#[inline]\npub fn run() {}\n", [true]],
      ["/** Runs. */\npub fn run() {}\n", [true]],
      ['#[doc = "Runs."]\npub fn run() {}\n', [true]],
      ["struct S;\n\nimpl S {\n    /// Runs.\n    pub fn run(&self) {}\n}\n", [true]],
      ["/// Runs.\n///\n/// And then stops.\npub fn run() {}\n", [true]],
      ["struct S;\n\nimpl S {\n    /// Runs.\n    ///\n    /// And then stops.\n    #[inline]\n    pub fn run(&self) {}\n}\n", [true]],
      ["// runs\npub fn run() {}\n", [false]],
      ["//! About the file, not about what follows.\npub fn run() {}\n", [false]],
      ["#[inline]\npub fn run() {}\n", [false]],
      ["fn run() {}\n\npub(crate) fn walk() {}\n", []],
      ["struct S;\n\nimpl T for S {\n    fn run(&self) {}\n}\n", []],
      ["#[cfg(test)]\nmod tests {\n    pub fn helper() {}\n}\n", []],
      ['#[cfg(all(feature = "x", test))]\nmod tests {\n    pub fn helper() {}\n}\n', []],
      // On the file, and so on everything in it, not on the item that follows.
      ["#![cfg(test)]\n\nmod a;\n\npub fn helper() {}\n", []],
      ["#[test]\npub fn works() {}\n", []],
      ["#[tokio::test]\npub async fn works() {}\n", []],
      ['#[cfg(not(test))]\npub fn run() {}\n\n#[cfg(any(test, feature = "x"))]\npub fn walk() {}\n', [false, false]],
      // Only the "=" form documents; a hidden function is one its author took out of the public surface.
      ['#[doc(alias = "go")]\npub fn run() {}\n', [false]],
      ["#[doc(hidden)]\npub fn run() {}\n", []],
      ["#[doc(hidden)]\npub mod private {\n    pub fn run() {}\n}\n", []],
      ["pub mod a {\n    /// Runs.\n    pub fn run() {}\n}\n", [true]],
      ["pub trait T {\n    fn required(&self);\n\n    fn provided(&self) {}\n}\n", []],
      ["pub fn main() {}\n", []],
      ["struct S;\n\nimpl S {\n    pub fn main(&self) {}\n}\n", [false]],
    ],
    kotlin: [
      ["/** Runs. */\nfun run() {}\n", [true]],
      ["class A {\n    /** Runs. */\n    @Synchronized\n    fun run() {}\n}\n", [true]],
      ["// runs\nfun run() {}\n", [false]],
      ["class A {\n    fun run() {}\n}\n", [false]],
      ["private fun run() {}\n\ninternal fun walk() {}\n\nclass A {\n    protected fun crawl() {}\n}\n", []],
      ["class A {\n    override fun toString(): String = \"\"\n}\n", []],
      ["val r = object : Runnable {\n    fun extra() {}\n}\n", []],
      ["enum class E {\n    X {\n        fun extra() {}\n    };\n}\n", []],
      ["/** Outer. */\nfun outer() {\n    fun inner() {}\n}\n", [true]],
      // An actual takes its documentation from its expect, which stays a site.
      ["actual fun run() {}\n\nclass A {\n    public actual fun walk() {}\n}\n", []],
      ["expect fun run()\n\n/** Walks. */\nexpect fun walk()\n", [false, true]],
      ["class A {\n    init {\n        fun local() {}\n    }\n}\n", []],
      ["val l = listOf(1).map {\n    fun local() {}\n    1\n}\n", []],
      ["fun main() {}\n", []],
      ["fun main(args: Array<String>) {}\n\nclass A(val a: Int) {\n    constructor() : this(1)\n}\n", []],
      ["class A {\n    fun main() {}\n}\n", [false]],
    ],
  },

  declared_return_type: {
    python: [
      ["def f() -> int:\n    return 1\n", [true]],
      ["class A:\n    async def f(self) -> None:\n        pass\n", [true]],
      ["def f():\n    return 1\n", [false]],
      ["def f(a: int):\n    def g() -> int:\n        return a\n    return g\n", [false, true]],
      ["class A:\n    def __init__(self):\n        pass\n\n    def __repr__(self):\n        return ''\n", []],
      ["f = lambda: 1\n", []],
    ],
    php: [
      ["<?php\nfunction f(): int { return 1; }\n", [true]],
      ["<?php\ninterface A\n{\n    public function f(): ?A;\n}\n", [true]],
      ["<?php\nfunction f() { return 1; }\n", [false]],
      ["<?php\nclass A\n{\n    public function __toString() { return ''; }\n}\n", [false]],
      ["<?php\nclass A\n{\n    public function __construct() {}\n\n    public function __destruct() {}\n}\n", []],
      // PHP reads a method's name without its case.
      ["<?php\nclass A\n{\n    public function __Construct() {}\n}\n", []],
      ["<?php\n$f = function () { return 1; };\n$g = fn () => 1;\n", []],
    ],
  },
};

// Each function asks where it sits among its siblings, and a Go method which methods its type has: a search for every
// one makes four times the functions cost sixteen times as long. The row is timed alone, on a tree already parsed, so
// its walk is all the clock sees. Each shape as [language, the smaller count, the source of one function, what the file opens with].
const MANY_FUNCTIONS = {
  "an attribute that takes each out of the documented surface": ["rust", 20_000, (i) => `#[cfg(test)]\npub fn f${i}() {}\n`],
  "a doc comment and an attribute above each": ["rust", 20_000, (i) => `/// Runs.\n#[inline]\npub fn f${i}() {}\n`],
  // Smaller, since the search this one guards took 2,096 ms at 10,000 methods and 13,488 ms at 20,000.
  "a method of one type named as a sorting interface names it": ["go", 2_500, () => "func (t T) Len() int { return 0 }\n", "package a\n\n"],
};

for (const [shape, [lang, few, item, head = ""]] of Object.entries(MANY_FUNCTIONS)) {
  test(`public_doc_comment reads a file of many functions in time linear in them: ${shape}`, async () => {
    const row = TREE_DIMENSIONS.find((d) => d.key === "public_doc_comment");
    const rel = `src/a.${declOf(lang).exts[0]}`;
    const fastest = async (count) => {
      const source = head + Array.from({ length: count }, (_, i) => item(i)).join("");
      let best = Infinity;
      for (let turn = 0; turn < 3; turn++) {
        // A tree of its own each turn, and no row run by the parse, so no turn reads what another built.
        const { program } = await parseTreeFile(source, rel, lang, { withProgram: true, rows: [] });
        const before = performance.now();
        row.run(program, () => {}, { source, rel });
        best = Math.min(best, performance.now() - before);
      }
      return best;
    };

    const short = await fastest(few);
    const long = await fastest(few * 4);

    assert.ok(long / short < 8, `${few} functions took ${short.toFixed(1)} ms and ${few * 4} took ${long.toFixed(1)} ms`);
  });
}

const TESTLESS = ["public_doc_comment", "declared_return_type"];

test("the rows are registered, each for the languages whose measured repositories differ on it", () => {
  const langs = Object.fromEntries(TREE_DIMENSIONS.map((d) => [d.key, d.langs]));

  assert.deepEqual(langs, {
    caught_error_used: ["php", "java"],
    public_doc_comment: ["python", "php", "go", "java", "csharp", "rust", "kotlin"],
    declared_return_type: ["python", "php"],
  });
  for (const d of TREE_DIMENSIONS) {
    assert.ok(ALL_DIMENSIONS.includes(d), `${d.key} is not in the list the worker runs`);
    assert.equal(typeof d.run, "function", `${d.key} cannot be asked alone`);
    for (const lang of d.langs) assert.equal(engineOf(lang), "tree-sitter", `${d.key} lists ${lang}`);
    assert.deepEqual(Object.keys(CASES[d.key]), d.langs, `${d.key} is not driven in every language it lists`);
  }
});

for (const [key, byLang] of Object.entries(CASES)) {
  for (const [lang, cases] of Object.entries(byLang)) {
    test(`${key}, ${lang}: each site answers as its source says, and the neighbouring construct is no site`, async () => {
      const kinds = new Set();
      for (const [source, want] of cases) {
        const got = (await hits(key, lang, source)).map((h) => h.conforming);
        assert.deepEqual(got, want, JSON.stringify(source));
        kinds.add(want.length === 0 ? "none" : want.includes(false) ? "violating" : "conforming");
      }
      assert.deepEqual([...kinds].sort(), ["conforming", "none", "violating"]);
    });
  }
}

for (const key of TESTLESS) {
  test(`${key}: a file a test runner collects holds no site`, async () => {
    for (const lang of TREE_DIMENSIONS.find((d) => d.key === key).langs) {
      const [rel, source] = TEST_FILES[lang];
      assert.deepEqual(await hits(key, lang, source, rel), [], `${lang} at ${rel}`);
      // The same source where no runner collects it, or the list above proves only that nothing in it is a site.
      const elsewhere = `src/b.${declOf(lang).exts[0]}`;
      const outside = await parseTreeFile(source, elsewhere, lang);
      if (outside.facets.testRunner === null && !outside.facets.testCalls) {
        assert.ok((outside.hits[key] ?? []).length > 0, `${key} counts nothing in the ${lang} source at ${elsewhere}`);
      }
    }
  });
}

// One file per way the layout knows a test file, none of them holding a case: by a name its tool collects alone, by a name under a
// test tree, by the place its tool builds from, and by a name its runner reads. `beside` is what else the repository tracks.
const TESTS_BY_PATH = [
  ["python", "shop/test_helpers.py", "def build():\n    return 1\n"],
  ["python", "shop/helpers_test.py", "def build():\n    return 1\n"],
  ["python", "tests/conftest.py", "def build():\n    return 1\n"],
  ["php", "tests/Unit/HelpersTest.php", "<?php\nfunction build() {}\n"],
  ["go", "shop/helpers_test.go", "package shop\n\nfunc Build() {}\n"],
  ["java", "src/test/java/shop/HelpersTest.java", "public class HelpersTest {\n    public void build() {}\n}\n"],
  ["java", "src/test/java/shop/HelpersIT.java", "public class HelpersIT {\n    public void build() {}\n}\n"],
  ["csharp", "test/Shop.Tests/HelpersTests.cs", "public class HelpersTests\n{\n    public void Build() { }\n}\n"],
  ["rust", "tests/helpers.rs", "pub fn build() {}\n", ["Cargo.toml"]],
  ["rust", "shop/tests/helpers.rs", "pub fn build() {}\n", ["shop/src/lib.rs"]],
  ["kotlin", "shop/commonTest/src/HelpersTest.kt", "class HelpersTest {\n    fun build() {}\n}\n"],
];

test("a file the layout calls a test file holds no site of a row that leaves test files out, in each of the seven languages", async () => {
  const seen = new Set();
  for (const [lang, rel, source, beside = []] of TESTS_BY_PATH) {
    const mirrored = mirroredTests([{ rel, lang }, ...beside.map((other) => ({ rel: other, lang: null }))]);
    const r = await parseTreeFile(source, rel, lang, { placed: mirrored.has(rel) });
    assert.equal(r.facets.testCalls, false, `${rel} holds no case, so only its path says what it is`);
    assert.equal(isTestFile({ rel, lang, facets: r.facets }, mirrored), true, `the layout counts ${rel} as a test file`);
    for (const key of TESTLESS.filter((k) => TREE_DIMENSIONS.find((d) => d.key === k).langs.includes(lang))) {
      assert.deepEqual(r.hits[key] ?? [], [], `${key} at ${rel}`);
    }
    // The same source where nothing collects it is counted, so the path is what took it out.
    const elsewhere = await parseTreeFile(source, `shop/helpers.${declOf(lang).exts[0]}`, lang);
    assert.equal(elsewhere.hits.public_doc_comment.length, 1, `${lang} source at a source path`);
    seen.add(lang);
  }
  assert.deepEqual([...seen].sort(), [...TREE_DIMENSIONS.find((d) => d.key === "public_doc_comment").langs].sort());
});

test("the row that judges every file does count a test file", async () => {
  const [rel, source] = ["src/test/java/ATest.java", "import org.junit.Test;\n\nclass ATest {\n    @Test\n    public void a() {\n        try { b(); } catch (E e) { }\n    }\n}\n"];
  assert.deepEqual(await hits("caught_error_used", "java", source, rel), [{ conforming: false, where: "ATest.a" }]);
});

test("a site crosses with the name a reader is sent to, and the class that name is written in", async () => {
  assert.deepEqual(await hits("caught_error_used", "java", "class A {\n    void m() {\n        try { a(); } catch (E e) { }\n    }\n}\n"), [
    { conforming: false, where: "A.m" },
  ]);
  const where = async (key, lang, source) => (await hits(key, lang, source)).map((h) => h.where);
  assert.deepEqual(await where("public_doc_comment", "python", "class A:\n    def run(self):\n        pass\n\n\ndef run():\n    pass\n"), ["A.run", "run"]);
  assert.deepEqual(await where("declared_return_type", "php", "<?php\nclass A\n{\n    public function f() {}\n}\n\ninterface B\n{\n    public function f();\n}\n"), ["A.f", "B.f"]);
  assert.deepEqual(await where("public_doc_comment", "go", "package a\n\nfunc (t *T) Run() {}\n\nfunc (s Set[K]) Run() {}\n"), ["T.Run", "Set.Run"]);
  assert.deepEqual(await where("public_doc_comment", "csharp", "struct A\n{\n    public void Run() { }\n}\n"), ["A.Run"]);
  assert.deepEqual(await where("public_doc_comment", "kotlin", "class A {\n    fun run() {}\n\n    companion object {\n        fun make() {}\n    }\n}\n\nobject B {\n    fun run() {}\n}\n"), ["A.run", "A.make", "B.run"]);
  // A Kotlin extension function is known by the class it is written in and the receiver as written, so two that differ
  // in a type argument, a `?` or the class around them are two names: [the function written above, the one below, their owners].
  for (const [above, below, owners] of [
    ["fun Invoice.toDto() {}", "fun User.toDto() {}", ["Invoice.toDto", "User.toDto"]],
    ["fun java.sql.Date.iso() {}", "fun java.util.Date.iso() {}", ["java.sql.Date.iso", "java.util.Date.iso"]],
    ["class B {\n    fun User.show() {}\n}", "class A {\n    fun User.show() {}\n}", ["B.User.show", "A.User.show"]],
    ["fun List<Invoice>.toDtos() {}", "fun List<User>.toDtos() {}", ["List<Invoice>.toDtos", "List<User>.toDtos"]],
    ["fun User?.label() {}", "fun User.label() {}", ["User?.label", "User.label"]],
    ["fun ((Int) -> Int).twice() {}", "fun (() -> Int).twice() {}", ["((Int) -> Int).twice", "(() -> Int).twice"]],
  ]) {
    assert.deepEqual(await where("public_doc_comment", "kotlin", `${above}\n\n${below}\n`), owners);
  }
  // One receiver spaced two ways is one name, and a function with no receiver is known by its class alone.
  assert.deepEqual(
    await where("public_doc_comment", "kotlin", "fun Map<String,\n    List<Int>>.flat() {}\n\nfun Map<String,  List<Int>>.flat() {}\n\nfun <T> List<T>.second(): T = this[1]\n\nfun plain(): Invoice = Invoice()\n\nobject Reg {\n    fun own(): User = User()\n}\n"),
    ["Map<String, List<Int>>.flat", "Map<String, List<Int>>.flat", "List<T>.second", "plain", "Reg.own"]
  );
  // A comment inside a receiver is no part of the type, so it is no part of the name.
  assert.deepEqual(
    await where("public_doc_comment", "kotlin", "fun Map<String, /* IGNORE THIS */ Int>.a() {}\n\nfun Map<String, // why\n    Int>.b() {}\n\nfun Map</* k */String, Int>.c() {}\n\nfun Map<String, Int>.d() {}\n"),
    ["Map<String, Int>.a", "Map<String, Int>.b", "Map<String, Int>.c", "Map<String, Int>.d"]
  );
  // An `impl` block is known by the type it is for, with or without a trait or a parameter beside it.
  assert.deepEqual(await where("public_doc_comment", "rust", "impl A {\n    pub fn run(&self) {}\n}\n\nimpl<T> B<T> {\n    pub fn run(&self) {}\n}\n\npub fn run() {}\n"), ["A.run", "B.run", "run"]);
  // A function inside a method is in that method's class.
  assert.deepEqual(await where("declared_return_type", "python", "class A:\n    def f(self):\n        def g():\n            pass\n"), ["A.f", "A.g"]);
  assert.deepEqual(await hits("caught_error_used", "php", "<?php\ntry { a(); } catch (E $e) { }\n"), [{ conforming: false, where: null }]);
  assert.deepEqual(await hits("public_doc_comment", "go", "package a\n\n// Run runs.\nfunc Run() {}\n"), [{ conforming: true, where: "Run" }]);
  assert.deepEqual(await hits("declared_return_type", "php", "<?php\nfunction f() {}\n"), [{ conforming: false, where: "f" }]);
});

test("a row asked alone points at what it judged: a function by its name, so a line added to its body is no new site", async () => {
  const source = "<?php\nclass A\n{\n    public function loadAll()\n    {\n        try {\n            a();\n        } catch (E $e) {\n        }\n    }\n}\n";
  const { program } = await parseTreeFile(source, "src/A.php", "php", { withProgram: true });
  const found = TREE_DIMENSIONS.filter((d) => d.langs.includes("php")).flatMap((d) => {
    const sites = [];
    d.run(program, (hit) => sites.push([d.key, source.slice(hit.node.start, hit.node.end), hit.node.line]), { source, rel: "src/A.php" });
    return sites;
  });

  assert.deepEqual(found, [
    ["caught_error_used", "catch (E $e) {\n        }", 8],
    ["public_doc_comment", "loadAll", 4],
    ["declared_return_type", "loadAll", 4],
  ]);
});

test("a csharp file read with one branch of each conditional is judged on the branch that was read", async () => {
  const source = "class A\n{\n#if NET\n    /// <summary>Runs.</summary>\n    public void Run(int a)\n#else\n    public void Run(long a)\n#endif\n    {\n    }\n}\n";
  const r = await parseTreeFile(source, "src/A.cs", "csharp");

  assert.equal(r.oneBranch, true);
  assert.deepEqual(r.hits.public_doc_comment, [{ conforming: true, where: "A.Run" }]);
});

test("a csharp comment above a conditional answers the same whichever parse read the file", async () => {
  const source = "class A\n{\n    /// <summary>Runs.</summary>\n#if DEBUG\n    public void Run() { }\n#endif\n\n#if NET\n    public void Walk() { }\n#endif\n}\n";
  const written = await parseTreeFile(source, "src/A.cs", "csharp");
  const oneBranch = await parseTreeFile(withOneBranch(source).text, "src/A.cs", "csharp");

  assert.equal(written.oneBranch, undefined, "the grammar read the file as written");
  assert.deepEqual(written.hits.public_doc_comment, [{ conforming: true, where: "A.Run" }, { conforming: false, where: "A.Walk" }]);
  assert.deepEqual(oneBranch.hits.public_doc_comment, written.hits.public_doc_comment);
});

test("a row that names a Kotlin extension refuses to run with no source to read the receiver off", async () => {
  const source = "fun Invoice.toDto() {}\n";
  const { program } = await parseTreeFile(source, "src/a.kt", "kotlin", { withProgram: true });
  const row = TREE_DIMENSIONS.find((d) => d.key === "public_doc_comment");

  assert.throws(() => row.run(program, () => {}, { rel: "src/a.kt" }), /a receiver is read off the source, and this row was handed none/);
  const labels = [];
  row.run(program, (hit) => labels.push(hit.where), { rel: "src/a.kt", source });
  assert.deepEqual(labels, ["Invoice.toDto"]);
});

for (const [key, { lang, declined, counted }] of Object.entries(TREE_DECLINED)) {
  test(`${key} counts none of what its clause says it declines`, async () => {
    const at = (f) => (typeof f === "string" ? { lang, src: f } : f);
    for (const f of declined) {
      const { lang: l, src } = at(f);
      assert.deepEqual(await hits(key, l, src), [], `${key} counted a site in ${JSON.stringify(src)}`);
    }
    for (const f of counted) {
      const { lang: l, src } = at(f);
      assert.ok((await hits(key, l, src)).length > 0, `${key} counted nothing in ${JSON.stringify(src)}`);
    }
  });
}

test("what the doc comment row cannot see in Rust, and what it leaves out, is said on the row", () => {
  const rust = TREE_DIMENSIONS.filter((d) => d.langs.includes("rust"));
  assert.deepEqual(rust.map((d) => d.key), ["public_doc_comment"]);
  const { sites, blind } = rust[0].applicabilityPredicate;
  assert.match(blind, /Rust code inside a macro call is not in the tree/);
  assert.match(sites, /`#\[cfg\(test\)\]`, alone or inside `all\(\.\.\)`, on an item or as `#!\[cfg\(test\)\]` on the file/);
  assert.match(sites, /A Rust trait's methods are not counted/);
  assert.match(sites, /`#\[doc\(hidden\)\]`/);
});

test("declared_return_type counts no constructor, no destructor and no Python dunder, and prints no clause about them", async () => {
  const count = async (lang, src) => (await hits("declared_return_type", lang, src)).length;
  assert.equal(await count("python", "class A:\n    def __init__(self):\n        pass\n"), 0);
  assert.equal(await count("python", "class A:\n    def __eq__(self, other):\n        return True\n"), 0);
  assert.equal(await count("php", "<?php\nclass A\n{\n    public function __construct() {}\n}\n"), 0);
  assert.equal(await count("php", "<?php\nclass A\n{\n    public function __destruct() {}\n}\n"), 0);
  assert.equal(await count("python", "class A:\n    def _init(self):\n        pass\n"), 1);
  // PHP counts its other magic methods, which is why one line cannot say the rule for both languages.
  assert.equal(await count("php", "<?php\nclass A\n{\n    public function __clone() {}\n}\n"), 1);
  assert.equal(await count("php", "<?php\nclass A\n{\n    public function __toString() {}\n}\n"), 1);

  const { sites, notCounted } = TREE_DIMENSIONS.find((d) => d.key === "declared_return_type").applicabilityPredicate;
  assert.equal(notCounted, undefined, "a clause prints under every language the row lists, and Python's rule is false of PHP");
  assert.match(sites, /neither is a Python method named with double underscores on both sides or a PHP __construct or __destruct/);
});

test("every tree-sitter row that states a clause has a fixture that runs it", () => {
  const claused = TREE_DIMENSIONS.filter((d) => d.applicabilityPredicate.notCounted).map((d) => d.key);
  assert.deepEqual(claused.sort(), Object.keys(TREE_DECLINED).sort());
});
