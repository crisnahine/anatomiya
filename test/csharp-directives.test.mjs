import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { withOneBranch } from "../plugins/anatomiya/lib/csharp-directives.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

/** The lines of the blanked text that still hold anything, trimmed. */
const kept = (source) => withOneBranch(source).text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Same length, every line break where it was, and nothing but spaces where the text differs. */
function assertInPlace(source, text) {
  assert.equal(text.length, source.length);
  for (let i = 0; i < source.length; i++) {
    if (text[i] === source[i]) continue;
    assert.equal(text[i], " ", `offset ${i} became ${JSON.stringify(text[i])}`);
    assert.ok(source[i] !== "\n" && source[i] !== "\r", `a line break at ${i} was blanked`);
  }
}

test("a source with no directive has nothing to blank", () => {
  assert.equal(withOneBranch("class A { }\n"), null);
  assert.equal(withOneBranch(""), null);
  assert.equal(withOneBranch("class A { string s = \"#if X\"; }\n"), null);
});

test("the first branch of a conditional is kept, and every other branch and every directive line is blanked", () => {
  const source = "a();\n#if X\nb();\n#elif Y\nc();\n#else\nd();\n#endif\ne();\n";
  const out = withOneBranch(source);

  assert.equal(out.text, "a();\n     \nb();\n       \n    \n     \n    \n      \ne();\n");
  assert.equal(out.dropped, true);
});

test("a conditional with one branch loses nothing but its directive lines, and says so", () => {
  const out = withOneBranch("class A : B\n#if X\n    , C\n#endif\n{ }\n");

  assert.equal(out.text, "class A : B\n     \n    , C\n      \n{ }\n");
  assert.equal(out.dropped, false);
});

test("a branch holding only blank lines is not a branch that went unread", () => {
  assert.equal(withOneBranch("#if X\na();\n#else\n\n   \n#endif\n").dropped, false);
});

test("the blanked text keeps its length and its line breaks on CRLF input", () => {
  const source = "a();\r\n  #if X\r\nb();\r\n#else\r\nc();\r\nd();\r\n#endif\r\ne();\r\n";
  const { text } = withOneBranch(source);

  assertInPlace(source, text);
  assert.equal(text, "a();\r\n       \r\nb();\r\n     \r\n    \r\n    \r\n      \r\ne();\r\n");
});

test("an astral character in a blanked branch becomes as many spaces as it has UTF-16 units", () => {
  const source = '#if X\nvar a = "\u{1F600}";\n#else\nvar b = "\u{1F600}\u{1F680}";\n#endif\nvar c = "\u{1F600}";\n';
  const { text } = withOneBranch(source);

  assertInPlace(source, text);
  assert.equal(text.indexOf("var c"), source.indexOf("var c"));
  assert.deepEqual(kept(source), ['var a = "\u{1F600}";', 'var c = "\u{1F600}";']);
});

test("a nested conditional is resolved inside the branch that is kept and blanked whole inside one that is not", () => {
  const source = [
    "#if A",
    "#if B",
    "one();",
    "#else",
    "two();",
    "#endif",
    "#elif C",
    "#if D",
    "three();",
    "#endif",
    "#else",
    "four();",
    "#endif",
    "five();",
    "",
  ].join("\n");
  const out = withOneBranch(source);

  assertInPlace(source, out.text);
  assert.deepEqual(kept(source), ["one();", "five();"]);
  assert.equal(out.dropped, true);
});

test("every directive that is not a conditional is blanked where it stands", () => {
  const source = "#region R\n#pragma warning disable 618\n#nullable enable\n#define X\n#undef X\n#line 1\n#error e\n#warning w\na();\n#endregion\n";

  assert.deepEqual(kept(source), ["a();"]);
  assert.equal(withOneBranch(source).dropped, false);
});

test("a directive is found behind leading spaces and tabs, with spaces after its #, and on a last line with no line break", () => {
  assert.deepEqual(kept("\t  #if X\na();\n \t# endif\nb();"), ["a();", "b();"]);
  assert.equal(withOneBranch("class A { }\n#pragma warning restore 618").text, `class A { }\n${" ".repeat(27)}`);
});

test("a # that does not open its line, or a word that is no directive, is left alone", () => {
  assert.equal(withOneBranch("var a = b; #pragma warning disable\nf(); #region R\n"), null);
  assert.equal(withOneBranch("#regional\n#lines\n#r \"x.dll\"\n#!shebang\n"), null);
});

test("a directive-looking line inside a verbatim string is the string's text", () => {
  const source = 'var s = @"\n#if X\n  ""quoted""\n#endif\n";\n#if Y\na();\n#endif\n';
  const { text } = withOneBranch(source);

  assert.ok(text.startsWith('var s = @"\n#if X\n  ""quoted""\n#endif\n";\n'));
  assert.deepEqual(text.slice(source.indexOf("#if Y")).split("\n"), ["     ", "a();", "      ", ""]);
});

test("a verbatim string that opens with an escaped quote is not read as a raw string", () => {
  // `@"""a""` is the verbatim text `"a"`: read as a raw string it never closes, and every directive after it is lost.
  const source = 'var s = @"""a"" b";\n#if X\na();\n#else\nb();\n#endif\n';

  assert.deepEqual(kept(source), ['var s = @"""a"" b";', "a();"]);
  assert.deepEqual(kept('var s = $@"""{a}"" b";\n#if X\na();\n#endif\n'), ['var s = $@"""{a}"" b";', "a();"]);
});

test("a directive-looking line inside a raw string is the string's text, whatever the quote count", () => {
  for (const quotes of ['"""', '""""']) {
    const literal = `var s = ${quotes}\n#if X\n  "in" ""here""\n#endif\n  ${quotes};\n`;
    const source = `${literal}#if Y\na();\n#else\nb();\n#endif\n`;
    const { text } = withOneBranch(source);

    assert.ok(text.startsWith(literal), quotes);
    assert.deepEqual(text.slice(literal.length).split("\n").map((line) => line.trim()).filter(Boolean), ["a();"], quotes);
  }
  assert.equal(withOneBranch('var s = $"""\n#if {x}\n""";\n'), null);
});

test("a directive-looking line inside a block comment is the comment's text", () => {
  assert.equal(withOneBranch("/*\n#if X\n#endif\n*/\nclass A { }\n"), null);
});

test("a quote in a character literal, a comment or an ordinary string opens no string", () => {
  const source = "var a = '\"';\nvar b = '\\'';\n// it's \"quoted\n/* \" */\nvar c = \"a \\\" b\";\nvar d = \"unterminated\n#if X\nx();\n#else\ny();\n#endif\n";

  assert.deepEqual(kept(source).slice(-1), ["x();"]);
  assert.equal(withOneBranch(source).dropped, true);
  // Each of these would open a verbatim string that runs past the directives below it.
  for (const line of ['// a path like @"C:', 'var s = "\\"@";', "var c = '@'; var q = '\"';"]) {
    assert.deepEqual(kept(`${line}\n#if X\na();\n#endif\n`), [line, "a();"], line);
  }
  // And these would close the verbatim string the directive-looking lines sit in.
  assert.equal(withOneBranch("F('\"', @\"\n#if X\n#endif\n\");\n"), null);
  assert.equal(withOneBranch("F('\\'', '\"', @\"\n#if X\n#endif\n\");\n"), null);
});

test("an escaped character literal ends at its quote on the same line, twelve units at most from where it opened", () => {
  // Read short of its quote, the longest escape leaves that quote to open a literal, and the verbatim string is closed early.
  assert.equal(withOneBranch("F('\\U0001F600','\"', @\"\n#if X\n#endif\n\");\n"), null);
  // And `'\''` read as closed by its second quote leaves the third to do the same.
  assert.equal(withOneBranch("F('\\'','\"', @\"\n#if X\n#endif\n\");\n"), null);
  for (const eol of ["\n", "\r\n"]) {
    assert.deepEqual(kept(`var a = '\\${eol}#if X'${eol}a();${eol}#endif${eol}`), ["var a = '\\", "a();"], JSON.stringify(eol));
  }
  assert.equal(withOneBranch("#if X\n#endif\nvar a = '\\").text, "     \n      \nvar a = '\\");
});

test("a byte order mark before a first-line directive is leading white space, and stays where it was", () => {
  const source = "\uFEFF#if X\na();\n#else\nb();\n#endif\n";
  const out = withOneBranch(source);

  assert.equal(out.text, "\uFEFF     \na();\n     \n    \n      \n");
  assert.equal(out.dropped, true);
  assert.equal(withOneBranch("a();\n\uFEFF#if X\n#endif\n"), null);
});

// One line of about 1 MB each. A scan to the line's end per literal took 19 s on 400 KB of the first.
for (const token of ["'\\u0041'", "'\\n'", '"a"', '@"a"', "/* */"]) {
  test(`a long line of ${token} is blanked in time that grows with its length`, () => {
    const tail = "\n#if X\na();\n#else\nb();\n#endif\n";
    const source = token.repeat(Math.ceil(1_000_000 / token.length)) + tail;
    // Three runs, each bounded: a slow path has shown only once the engine had optimised the function.
    for (let run = 0; run < 3; run++) {
      const from = performance.now();
      const out = withOneBranch(source);
      const took = performance.now() - from;
      assert.equal(out.text, source.slice(0, -tail.length) + "\n     \na();\n     \n    \n      \n");
      assert.ok(took < 2000, `run ${run + 1}: ${Math.round(took)} ms`);
    }
  });
}

test("conditionals that do not balance are not guessed at", () => {
  assert.equal(withOneBranch("#if X\na();\n"), null);
  assert.equal(withOneBranch("a();\n#endif\n"), null);
  assert.equal(withOneBranch("#else\na();\n#endif\n"), null);
  assert.equal(withOneBranch("#elif X\n"), null);
});

test("the module is a leaf: it imports nothing", () => {
  const src = readFileSync(join(ANATOMIYA, "lib", "csharp-directives.mjs"), "utf8");
  assert.equal(/^\s*import[\s("'{*]|\brequire\s*\(/m.test(src), false);
});
