import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";
import { TREE_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-tree.mjs";
import { declOf, engineOf } from "../plugins/anatomiya/lib/langs.mjs";
import { isTestFile, mirroredTests } from "../plugins/anatomiya/lib/layout.mjs";
import { withOneBranch } from "../plugins/anatomiya/lib/csharp-directives.mjs";
import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { siteIdentity } from "../plugins/anatomiya/lib/introduced.mjs";
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
  logger_over_print: {
    python: [
      ["def f():\n    print('x')\n    logger.info('y')\n    self.log.warning('z')\n    logging.exception('w')\n", [false, true, true, true]],
      ["def f():\n    logger.debug('y')\n", [true]],
      // Configuring a logger writes nothing, and a level on anything else is no logger.
      ["def f():\n    logging.basicConfig(level=1)\n    logger.setLevel(2)\n    flask.info('x')\n", []],
    ],
    php: [
      ["<?php\nfunction f() { echo 'x'; print 'y'; var_dump($a); $this->logger->info('z'); Log::error('e'); }\n", [false, false, false, true, true]],
      ["<?php\nfunction f() { $this->logger->warning('z'); }\n", [true]],
      ["<?php\nfunction f() { $this->logger->setLevel(1); $cache->info('x'); }\n", []],
      // A template's `echo` writes the page; a dump in it is still a dump.
      ["<h1><?php echo htmlspecialchars($title); print $x; var_dump($y); ?></h1>\n", [false]],
      // A closing tag with nothing after it, or a shebang line, is no markup.
      ["<?php\nfunction f() { echo 'a'; var_dump($x); }\n?>\n", [false, false]],
      ["#!/usr/bin/env php\n<?php\necho 'a';\nprint 'b';\n", [false, false]],
    ],
    java: [
      ['class A { void f() { System.out.println(1); System.err.printf("x"); LOG.info("x"); logger.severe("y"); out.println(2); } }\n', [false, false, true, true]],
      ['class A { void f() { log.debug("x"); } }\n', [true]],
      ['class A { void f() { out.println(2); LOG.isDebugEnabled(); } }\n', []],
    ],
    csharp: [
      ['class A { void F() { Console.WriteLine(1); _logger.LogInformation("x"); Log.Error("y"); Debug.WriteLine(2); } }\n', [false, true, true]],
      ['class A { void F() { _logger.LogWarning("x"); } }\n', [true]],
      // Type arguments are no part of the callee, nested ones included.
      ['class A { void F() { _logger.LogInformation<Dictionary<string, List<int>>>("x"); } }\n', [true]],
      ['class A { void F() { Debug.WriteLine(2); _logger.BeginScope("x"); } }\n', []],
    ],
    rust: [
      ['fn f() {\n    println!("x");\n    info!("y");\n    tracing::warn!("z");\n    log::error!("e");\n    dbg!(1);\n    vec![1];\n}\n', [false, true, true, true, false]],
      ['fn f() {\n    tracing::info!("y");\n}\n', [true]],
      ['fn f() {\n    vec![1];\n    format!("x");\n}\n', []],
    ],
    kotlin: [
      ['class A {\n    fun f() {\n        println(1)\n        logger.info { "x" }\n        LOG.warn("z", e)\n        list.info()\n    }\n}\n', [false, true, true]],
      ['class A {\n    fun f() {\n        log.debug("x")\n    }\n}\n', [true]],
      ['class A {\n    fun f() {\n        list.info()\n    }\n}\n', []],
    ],
    go: [
      ['package a\n\nfunc f() {\n\tfmt.Println(1)\n\tlog.Printf("x")\n\tslog.Info("y")\n\tlogger.Error("z")\n\tfmt.Sprintf("w")\n}\n', [false, true, true, true]],
      ['package a\n\nfunc f() {\n\tklog.V(2).Infof("x")\n\tzap.L().Info("y")\n}\n', [true, true]],
      // A chain writes once, at its end, and a field built for a log line writes nothing itself.
      ['package a\n\nfunc f() {\n\tlog.Info().Msg("x")\n\tslog.Info("x", slog.String("k", v), slog.Int("n", 1))\n}\n', [true, true]],
      // zap's package functions build fields, and a receiver a call returns is named by that call.
      ['package a\n\nfunc f() {\n\tlogger.Error("x", zap.Error(err))\n}\n', [true]],
      ['package a\n\nfunc f() {\n\tcaddy.Log().Info("y")\n}\n', [true]],
      // A logger derived from one is still that logger, and klog's structured calls write too.
      ['package a\n\nfunc f() {\n\tlogger.With(zap.String("k", "v")).Info("y")\n\tlogger.Sugar().Infof("x")\n\tklog.InfoS("x")\n\tslog.LogAttrs(ctx, 1, "x")\n\tLog[int]().Info("z")\n}\n', [true, true, true, true, true]],
      // Formatting a string writes nothing, and a method named for a level on anything else is no logger.
      ['package a\n\nfunc f() {\n\tfmt.Sprintf("w")\n\tcache.Info()\n}\n', []],
      // Setting a logger up writes nothing.
      ['package a\n\nfunc f() {\n\tlog.SetFlags(0)\n\tzap.NewProduction()\n\tdefer logger.Sync()\n}\n', []],
    ],
  },
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
    python: [
      ["try:\n    a()\nexcept E as e:\n    log(e)\n", [true]],
      ["try:\n    a()\nexcept (A, B) as e:\n    pass\n", [false]],
      ["try:\n    a()\nexcept E as e:\n    raise\n", [true]],
      ["try:\n    a()\nexcept E as e:\n    raise F() from None\n", [true]],
      ['try:\n    a()\nexcept E as e:\n    return f"failed: {e}"\n', [true]],
      ["try:\n    a()\nexcept E as e:\n    run(lambda: e)\n", [true]],
      // An attribute and a keyword argument of that name are not the error.
      ["try:\n    a()\nexcept E as e:\n    x.e = 1\n    f(e=2)\n", [false]],
      ["try:\n    a()\nexcept E:\n    pass\n", []],
      ["try:\n    a()\nexcept E as _:\n    pass\n", []],
      ["try:\n    a()\nfinally:\n    b()\n", []],
    ],
    csharp: [
      ["class A { void M() { try { a(); } catch (E e) { Log(e); } } }\n", [true]],
      ["class A { void M() { try { a(); } catch (E e) { Log(e.Message); } } }\n", [true]],
      ["class A { void M() { try { a(); } catch (E e) { throw; } } }\n", [true]],
      ["class A { int M() { try { return a(); } catch (E e) { return b ?? throw new F(); } } }\n", [true]],
      // A filter that reads the error has used it.
      ["class A { void M() { try { a(); } catch (E e) when (e.Code == 5) { } } }\n", [true]],
      ["class A { void M() { try { a(); } catch (E e) { } catch (F f) { Log(f); } } }\n", [false, true]],
      // A member and a named argument of that name are not the error.
      ["class A { void M() { try { a(); } catch (E e) { x.e = 1; F(e: 2); } } }\n", [false]],
      // An object initializer's member is not the error; the value assigned to it is.
      ["class A { void M() { try { a(); } catch (E e) { var o = new O { e = 1 }; } } }\n", [false]],
      ["class A { void M() { try { a(); } catch (E e) { var o = new O { Error = e }; } } }\n", [true]],
      // A collection initializer's entries are values, and an indexer's key is read.
      ['class A { void M() { try { a(); } catch (E e) { var l = new List<string> { e.Message + "x" }; } } }\n', [true]],
      ["class A { void M() { try { a(); } catch (E e) { var o = new O { [e] = 1 }; } } }\n", [true]],
      ["class A { void M() { try { a(); } catch (E) { } catch { } } }\n", []],
      ["class A { void M() { try { a(); } catch (E _) { } } }\n", []],
    ],
    kotlin: [
      ["fun m() {\n    try { a() } catch (e: E) { log(e) }\n}\n", [true]],
      ["fun m() {\n    try { a() } catch (e: E) { throw e }\n}\n", [true]],
      ["fun m() {\n    try { a() } catch (e: E) { log(e.message) }\n}\n", [true]],
      ['fun m() {\n    try { a() } catch (e: E) { log("failed: $e") }\n}\n', [true]],
      // Another name that starts with it is not it.
      ['fun m() {\n    try { a() } catch (e: E) { log("failed: $ee $eé") }\n}\n', [false]],
      ["fun m() {\n    try { a() } catch (e: E) { }\n}\n", [false]],
      // A member after a dot or `::` is not the error.
      ["fun m() {\n    try { a() } catch (e: E) { x.e; run(A::e) }\n}\n", [false]],
      ["fun m() {\n    try { a() } catch (_: E) { }\n}\n", []],
      ["fun m() {\n    try { a() } catch (ignored: E) { }\n}\n", []],
      // A named argument's name is not the error; the value after it is.
      ["fun m() {\n    try { a() } catch (error: E) { emit(State(error = null)) }\n}\n", [false]],
      ["fun m() {\n    try { a() } catch (error: E) { emit(State(error = error)) }\n}\n", [true]],
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

// Each function asks where it sits among its siblings, and a search for every one reads every sibling ahead of it:
// twice the functions, four times the reads. A clock does not tell the two apart at 40,000 functions (3.0 to 3.5
// with the search, 1.7 to 2.4 without, on a loaded machine), so the reads are counted. A Go method asks which methods
// its type has, and a search for every one reads every method's name: 2,096 ms at 10,000 methods of one type and
// 13,488 ms at 20,000. Each shape as
// [language, the sites one function makes, its source, what the file opens with, what it closes with].
const MANY_SIBLINGS = {
  "an attribute that takes each out of the documented surface": ["rust", 0, (i) => `#[cfg(test)]\npub fn f${i}() {}\n`],
  "a doc comment and an attribute above each": ["rust", 1, (i) => `/// Runs.\n#[inline]\npub fn f${i}() {}\n`],
  "a conditional that opens on each, under a doc comment": [
    "csharp",
    1,
    (i) => `    /// <summary>Runs.</summary>\n#if DEBUG\n    public void Run${i}() { }\n#endif\n`,
    "class A\n{\n",
    "}\n",
  ],
  "a method of one type named as a sorting interface names it": ["go", 1, () => "func (t T) Len() int { return 0 }\n", "package a\n\n"],
};
const FEW_SIBLINGS = 500;

const docRow = () => TREE_DIMENSIONS.find((d) => d.key === "public_doc_comment");

/** How many times the row reads any node's list of children, over a file of this many functions. */
async function childReads(lang, count, item, head = "", tail = "", row = docRow()) {
  const source = head + Array.from({ length: count }, (_, i) => item(i)).join("") + tail;
  const rel = `src/a.${declOf(lang).exts[0]}`;
  const { program } = await parseTreeFile(source, rel, lang, { withProgram: true, rows: [] });
  let reads = 0;
  const counted = { get: (list, key, self) => (reads++, Reflect.get(list, key, self)) };
  const work = [program];
  while (work.length) {
    const node = work.pop();
    for (const child of node.children) work.push(child);
    node.children = new Proxy(node.children, counted);
  }
  let sites = 0;
  row.run(program, () => sites++, { source, rel });
  return { reads, sites };
}

for (const [shape, [lang, each, item, head, tail]] of Object.entries(MANY_SIBLINGS)) {
  test(`public_doc_comment reads each function's siblings a number of times that does not grow with the file: ${shape}`, async () => {
    const fewer = await childReads(lang, FEW_SIBLINGS, item, head, tail);
    const more = await childReads(lang, 2 * FEW_SIBLINGS, item, head, tail);

    assert.ok(more.reads <= 2 * fewer.reads, `twice the functions read their siblings ${more.reads} times against ${fewer.reads}`);
    // The row read every function: a file it passed over would count as linear too.
    assert.deepEqual([fewer.sites, more.sites], [each * FEW_SIBLINGS, each * 2 * FEW_SIBLINGS]);
  });
}

test("endpoint_segment_case reads each handler's siblings a number of times that does not grow with the file", async () => {
  // Each route attribute looked over every sibling for a test attribute: 10,000 Rust handlers took 30 s.
  const row = TREE_DIMENSIONS.find((d) => d.key === "endpoint_segment_case");
  const item = (i) => `#[get("/saved-items")]\n#[allow(dead_code)]\nfn a${i}() {}\n`;
  const fewer = await childReads("rust", FEW_SIBLINGS, item, "", "", row);
  const more = await childReads("rust", 2 * FEW_SIBLINGS, item, "", "", row);

  assert.ok(more.reads <= 2 * fewer.reads, `twice the handlers read their siblings ${more.reads} times against ${fewer.reads}`);
  assert.deepEqual([fewer.sites, more.sites], [FEW_SIBLINGS, 2 * FEW_SIBLINGS]);
});

const TESTLESS = ["public_doc_comment", "declared_return_type"];

test("the rows are registered, each for the languages whose measured repositories differ on it", () => {
  const langs = Object.fromEntries(TREE_DIMENSIONS.map((d) => [d.key, d.langs]));

  assert.deepEqual(langs, {
    caught_error_used: ["php", "java", "python", "csharp", "kotlin"],
    public_doc_comment: ["python", "php", "go", "java", "csharp", "rust", "kotlin"],
    declared_return_type: ["python", "php"],
    endpoint_segment_case: ["python", "java", "csharp", "rust"],
    class_inherits: ["python", "php", "java", "csharp", "kotlin"],
    logger_over_print: ["python", "php", "java", "csharp", "rust", "kotlin", "go"],
  });
  for (const d of TREE_DIMENSIONS) {
    assert.ok(ALL_DIMENSIONS.includes(d), `${d.key} is not in the list the worker runs`);
    assert.equal(typeof d.run, "function", `${d.key} cannot be asked alone`);
    for (const lang of d.langs) assert.equal(engineOf(lang), "tree-sitter", `${d.key} lists ${lang}`);
    assert.deepEqual(Object.keys((d.learnedClasses ? WORDS : CASES)[d.key]), d.langs, `${d.key} is not driven in every language it lists`);
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

/**
 * Per learned row and language: each source beside the sites it must answer, as `word:class` in source order. An
 * empty list is a source holding the neighbouring construct and no site.
 */
const WORDS = {
  class_inherits: {
    python: [
      ["class A(models.Model, Mixin, metaclass=M):\n    pass\n", ["A:Model"]],
      // `object` names no base anybody chose, and a class naming none is no site.
      ["class A(object):\n    pass\n\n\nclass B:\n    pass\n\n\nclass C(Base[T]):\n    pass\n", ["C:Base"]],
      // Bases spread from a list name none, and typing's Generic and Protocol are no class anybody inherits behaviour from.
      ["class A(*bases):\n    pass\n\n\nclass B(Generic[T], Repo):\n    pass\n\n\nclass C(Protocol):\n    pass\n", ["B:Repo"]],
    ],
    php: [
      ["<?php\nclass A extends \\App\\Http\\Controller implements I {}\nclass B {}\n", ["A:Controller"]],
      // An interface extends interfaces, which is no class it inherits.
      ["<?php\ninterface J extends K {}\n", []],
    ],
    java: [
      ["class A extends p.Base<T> implements I {}\nclass B {}\ninterface C extends D {}\n", ["A:Base"]],
    ],
    csharp: [
      ["class A : Base<T>, IThing {}\nclass B : IThing {}\nclass C {}\n", ["A:Base"]],
    ],
    kotlin: [
      // The one specifier that calls a constructor is the class; an interface is named without parentheses.
      ["class A : p.Base<T>(), Runnable\nclass B : Runnable\nclass C(x: Int) : Base(x)\n", ["A:Base", "C:Base"]],
      // An object declaration inherits as a class does.
      ["object D : Base(), Runnable\nobject E\n", ["D:Base"]],
      ["class F {\n    companion object : Base()\n}\n", ["null:Base"]],
    ],
  },
  endpoint_segment_case: {
    python: [
      ['from django.urls import path, re_path\n\nurlpatterns = [\n    path("saved-searches/<int:pk>/", v),\n    path("audit_logs/", v),\n    re_path(r"^raw_data/$", v),\n]\n', ["saved-searches:kebab-case", "audit_logs:snake_case"]],
      // Without the import a `path` call is anybody's.
      ['urlpatterns = [path("saved-searches/", v)]\n', []],
      ['@router.get("/saved-items/{item_id}")\ndef a():\n    pass\n\n\n@app.route("/user_list", methods=["GET"])\ndef b():\n    pass\n', ["saved-items:kebab-case", "user_list:snake_case"]],
      // A decorator's path must start with `/`, and a client's `.get` is no decorator.
      ['@cache.get("saved-items")\ndef a():\n    pass\n\n\nrequests.get("/saved-items")\n', []],
      ['app.add_url_rule("/audit-logs", view_func=v)\n', ["audit-logs:kebab-case"]],
      ['r = APIRouter(prefix="/api-keys", tags=["x"])\napp.include_router(r, prefix="/team_members")\nbp = Blueprint("admin-panel", __name__, url_prefix="/admin-panel")\n', ["api-keys:kebab-case", "team_members:snake_case", "admin-panel:kebab-case"]],
      ['@router.get(f"/saved-items/{x}")\ndef a():\n    pass\n\n\n@router.get(PREFIX + "/saved-items")\ndef b():\n    pass\n\n\n@router.get("/users/<pk>")\ndef c():\n    pass\n\n\n@router.get("/audit-logs")\ndef d():\n    pass\n', ["audit-logs:kebab-case"]],
      // A comment among the arguments takes no positional slot, and only the first positional is the path.
      ['@router.get(  # the listing\n    "/saved-items"\n)\ndef a():\n    pass\n', ["saved-items:kebab-case"]],
      ['from django.urls import path\n\nurlpatterns = [path("saved-searches/", v, {}, "audit_logs")]\n', ["saved-searches:kebab-case"]],
      ['@router.get("/.well-known/openid-configuration")\ndef a():\n    pass\n', []],
      // FastAPI names the path `path`, Flask names it `rule`.
      ['@router.get(path="/saved-items")\ndef a():\n    pass\n\n\n@bp.route(rule="/user_list")\ndef b():\n    pass\n', ["saved-items:kebab-case", "user_list:snake_case"]],
      // Django names `path`'s path `route`.
      ['from django.urls import path\n\nurlpatterns = [path(route="saved-items/", view=v)]\n', ["saved-items:kebab-case"]],
      ['import django.urls\n\nurlpatterns = [django.urls.path("saved-searches/", v)]\n', ["saved-searches:kebab-case"]],
      // A prefix is only ever passed by its keyword, and a rule that starts with no `/` is some other library's.
      ['r = APIRouter("/team-members")\napp.add_url_rule("audit-logs", view_func=v)\n', []],
    ],
    java: [
      ['@RestController\n@RequestMapping("/api-keys")\nclass A {\n    @GetMapping(value = {"/saved-items", "/auditLogs/{id}"})\n    public void a() {}\n\n    @PostMapping(path = "/team_members")\n    void b() {}\n}\n', ["api-keys:kebab-case", "saved-items:kebab-case", "auditLogs:camelCase", "team_members:snake_case"]],
      ['class A {\n    @org.springframework.web.bind.annotation.DeleteMapping("userList/{id:[0-9]+}")\n    void a() {}\n}\n', ["userList:camelCase"]],
      // A path built from a constant, a method's argument named otherwise, and an annotation that maps no route.
      ['class A {\n    @RequestMapping(value = BASE + "/saved-items", method = RequestMethod.GET)\n    void a() {}\n\n    @GetMapping(produces = "application/json-patch")\n    void b() {}\n\n    @SuppressWarnings("saved-items")\n    void c() {}\n}\n', []],
      ['@RequestMapping("/.well-known")\nclass A {\n    @GetMapping("/openid-configuration")\n    void a() {}\n}\n\nclass B {\n    @GetMapping("/saved-items")\n    void b() {}\n}\n', ["saved-items:kebab-case"]],
      // A Feign client's mappings are another service's routes, called from here.
      ['@FeignClient(name = "x")\ninterface A {\n    @GetMapping("/saved_items")\n    void a();\n}\n\nclass B {\n    @GetMapping("/audit-logs")\n    void b() {}\n}\n', ["audit-logs:kebab-case"]],
      // In any order of its annotations.
      ['@RequestMapping("/user_accounts")\n@FeignClient(name = "x")\ninterface A {\n    @GetMapping("/saved_items")\n    void a();\n}\n\nclass B {\n    @GetMapping("/audit-logs")\n    void b() {}\n}\n', ["audit-logs:kebab-case"]],
      // The service a client names is no path.
      ['@FeignClient("billing-service")\ninterface A {\n    @GetMapping("/saved_items")\n    void a();\n}\n', []],
      // Spring maps a nested class by its own mapping alone, never its enclosing class's.
      ['@RequestMapping("/.well-known")\nclass A {\n    @RestController\n    static class Inner {\n        @GetMapping("/saved-items")\n        void a() {}\n    }\n}\n', ["saved-items:kebab-case"]],
      // And a class nested in a Feign client maps routes of its own.
      ['@FeignClient(name = "x")\ninterface A {\n    @GetMapping("/saved_items")\n    void a();\n\n    @RestController\n    class Inner {\n        @GetMapping("/audit-logs")\n        void b() {}\n    }\n}\n', ["audit-logs:kebab-case"]],
    ],
    csharp: [
      ['[Route("api-keys/[controller]")]\npublic class A : Controller\n{\n    [HttpGet("saved-items/{id:int}"), Authorize]\n    [Route("~/audit_logs", Name = "team-members")]\n    public void B() { }\n\n    [HttpPost(template: "UserList")]\n    public void C() { }\n}\n', ["api-keys:kebab-case", "saved-items:kebab-case", "audit_logs:snake_case", "UserList:PascalCase"]],
      ['class P\n{\n    void M()\n    {\n        var g = app.MapGroup("/team-members");\n        g.MapGet("/saved_items", () => 1);\n    }\n}\n', ["team-members:kebab-case", "saved_items:snake_case"]],
      ['class P\n{\n    [Authorize("saved-items")]\n    void M()\n    {\n        app.MapGet($"/saved-items/{a}", h);\n        app.Get("/saved-items", h);\n        app.MapGet("/audit-logs", h);\n    }\n}\n', ["audit-logs:kebab-case"]],
      // A generic call is named by its method, not its type argument.
      ['class P\n{\n    void M()\n    {\n        app.MapGet<int>("/saved-items", h);\n        app.MapPost<Todo>("/audit_logs", h);\n    }\n}\n', ["saved-items:kebab-case", "audit_logs:snake_case"]],
      ['public class A : Controller\n{\n    [HttpGetAttribute("saved-items")]\n    public void B() { }\n}\n\nclass P\n{\n    void M()\n    {\n        app.MapGet(pattern: "/audit-logs", handler: h);\n    }\n}\n', ["saved-items:kebab-case", "audit-logs:kebab-case"]],
      // ASP.NET Core routes a public top-level class only, so a nested class's attributes declare no route; a call is still one.
      ['public class Outer\n{\n    [Route("api-keys")]\n    public class InnerController : Controller\n    {\n        [HttpGet("saved-items")]\n        public void B() { }\n\n        void M()\n        {\n            app.MapGet("/team-members", h);\n        }\n    }\n}\n', ["team-members:kebab-case"]],
    ],
    rust: [
      ['#[get("/saved-items/<id>")]\nfn a() {}\n\n#[actix_web::post("/audit_logs/{id}")]\nasync fn b() {}\n', ["saved-items:kebab-case", "audit_logs:snake_case"]],
      ['fn r() -> Router {\n    Router::new().route("/team-members", get(h)).nest("/api_keys", x)\n}\n\nfn s() {\n    web::scope("/user-list").service(web::resource("/saved-items"));\n    rocket::build().mount("/two-words", routes![a]);\n}\n', ["api_keys:snake_case", "team-members:kebab-case", "user-list:kebab-case", "saved-items:kebab-case", "two-words:kebab-case"]],
      ['#[get("saved-items")]\nfn a() {}\n\nfn b() {\n    map.get("/saved-items");\n    Router::new().route(PATH, get(h)).route("/audit-logs", get(h));\n}\n', ["audit-logs:kebab-case"]],
      // What a `.well-known` call's own arguments declare is the standard's.
      ['fn r() -> Router {\n    Router::new().nest("/.well-known", Router::new().route("/apple-app", get(h))).route("/team-members", get(h))\n}\n', ["team-members:kebab-case"]],
      // A unit test module's handlers are declared for the test, as a test file's are.
      ['#[cfg(test)]\nmod t {\n    #[get("/saved-items")]\n    fn a() {}\n}\n\n#[get("/audit-logs")]\nfn b() {}\n', ["audit-logs:kebab-case"]],
      // And a handler marked on its own, above or below its route.
      ['#[cfg(test)]\n#[get("/saved-items")]\nfn a() {}\n\n#[get("/audit-logs")]\nfn b() {}\n', ["audit-logs:kebab-case"]],
      ['#[get("/saved-items")]\n#[cfg(test)]\nfn a() {}\n\n#[get("/audit-logs")]\nfn b() {}\n', ["audit-logs:kebab-case"]],
    ],
  },
};

for (const [key, byLang] of Object.entries(WORDS)) {
  for (const [lang, cases] of Object.entries(byLang)) {
    test(`${key}, ${lang}: each word of a declared path answers with its class, and the neighbouring construct is no site`, async () => {
      for (const [source, want] of cases) {
        const got = await hits(key, lang, source);
        assert.deepEqual(got.map((h) => `${h.where}:${h.class}`), want, JSON.stringify(source));
        assert.ok(got.every((h) => h.conforming === false), "a learned site votes with its class");
        // A route table is one file by many hands, so a path's words vote per declaration; a class is its file's.
        if (key === "endpoint_segment_case") assert.ok(got.every((h) => typeof h.section === "string"), "a path's word votes with its section");
      }
    });
  }
}

test("endpoint_segment_case: each route declaration is a section of its own, and a chained call is not the chain", async () => {
  const sections = async (lang, source) => (await hits("endpoint_segment_case", lang, source)).map((h) => h.section);
  const [nest, route] = await sections("rust", 'fn r() -> Router {\n    Router::new().route("/team-members", get(h)).nest("/api-keys", x)\n}\n');
  assert.notEqual(nest, route);
  const [one, two, three] = await sections("java", 'class A {\n    @GetMapping({"/saved-items", "/audit-logs"})\n    void a() {}\n\n    @GetMapping("/team-members")\n    void b() {}\n}\n');
  assert.equal(one, two, "one annotation declares both paths");
  assert.notEqual(two, three);
});

test("endpoint_segment_case: a test file and a file in a test tree hold no site", async () => {
  const route = '@router.get("/saved-items")\ndef a():\n    pass\n';
  assert.equal((await hits("endpoint_segment_case", "python", route, "app/views.py")).length, 1);
  assert.deepEqual(await hits("endpoint_segment_case", "python", route, "app/test_views.py"), []);
  assert.deepEqual(await hits("endpoint_segment_case", "python", route, "tests/support/views.py"), []);
  const controller = 'class A {\n    @GetMapping("/saved-items")\n    void a() {}\n}\n';
  assert.equal((await hits("endpoint_segment_case", "java", controller, "src/main/java/A.java")).length, 1);
  assert.deepEqual(await hits("endpoint_segment_case", "java", controller, "src/test/java/A.java"), []);
  const attribute = 'class A\n{\n    [HttpGet("saved-items")]\n    public void B() { }\n}\n';
  assert.deepEqual(await hits("endpoint_segment_case", "csharp", attribute, "test/Api.Tests/Fake.cs"), []);
  assert.deepEqual(await hits("endpoint_segment_case", "rust", '#[get("/saved-items")]\nfn a() {}\n', "tests/support.rs"), []);
});

test("endpoint_segment_case: a path longer than the tree keeps of a string loses its last word, which may be cut", async () => {
  const path = `/${"x-y/".repeat(70)}`;
  const got = await hits("endpoint_segment_case", "python", `@router.get("${path}")\ndef a():\n    pass\n`);
  // 256 characters hold the slash and 64 whole words; the last of them is read as cut.
  assert.equal(got.length, 63);
});

test("endpoint_segment_case: a site's identity in the check is its path, so a route that moved down the file is no new site", async () => {
  const at = async (source) => {
    const { program } = await parseTreeFile(source, "src/a.py", "python", { withProgram: true });
    const sites = [];
    TREE_DIMENSIONS.find((d) => d.key === "endpoint_segment_case").run(program, (h) => sites.push(siteIdentity("src/a.py", "endpoint_segment_case", h.node, source)), { source, rel: "src/a.py" });
    return sites;
  };
  const route = '@router.get("/saved-items")\ndef a():\n    pass\n';
  assert.deepEqual(await at(route), await at(`import os\n\n\n@router.get("/other")\ndef b():\n    pass\n\n\n${route}`));
});

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
  assert.deepEqual(rust.map((d) => d.key), ["public_doc_comment", "endpoint_segment_case", "logger_over_print"]);
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
