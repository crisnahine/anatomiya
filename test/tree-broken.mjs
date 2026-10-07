/**
 * Two sources per language the tree-sitter engine must refuse: one the grammar
 * answers with an ERROR node, and one it answers with a MISSING token.
 */
export const BROKEN = {
  python: { error: "x = (1 + 2\n", missing: "def f(:\n    pass\n" },
  php: { error: "<?php\nfunction f( {\n", missing: "<?php\nfunction f() { return 1 }\n" },
  go: { error: "package a\n\nfunc f( {\n", missing: "package a\n\nfunc f() int { return g(1 }\n" },
  java: { error: "class A { void f() { int x = ; } }\n", missing: "class A { int x = 1 }\n" },
  csharp: { error: "class A { void F( { } }\n", missing: "class A { int x = 1 }\n" },
  rust: { error: "fn f( {\n", missing: "fn f() { let x = 1 }\n" },
  kotlin: { error: "fun f( {\n", missing: "fun f() { g(1 }\n" },
};
