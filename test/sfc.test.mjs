import { test } from "node:test";
import assert from "node:assert/strict";

import { scriptBlocks, blankOutside } from "../plugins/anatomiya/lib/sfc.mjs";

// What the scanner kept, with each range read back out of the source.
const read = (source, kind) => {
  const { blocks, unterminated } = scriptBlocks(source, kind);
  assert.equal(unterminated, false, source);
  return blocks.map((b) => ({ body: source.slice(b.start, b.end), lang: b.lang, role: b.role }));
};
const js = (body, role = "instance") => ({ body, lang: "js", role });
const ts = (body, role = "instance") => ({ body, lang: "ts", role });

test("vue: only a top-level script is a block, not one in a template or a comment", () => {
  assert.deepEqual(read("<template><script>x</script></template><script>y</script>", "vue"), [
    js("y"),
  ]);
  assert.deepEqual(read("<template><script>x</script></template>", "vue"), []);
  // The inner end tag closes the inner template, so the script is still inside.
  assert.deepEqual(
    read(
      '<template><template v-if="a">b</template><script>x</script></template><script>y</script>',
      "vue"
    ),
    [js("y")]
  );
  assert.deepEqual(read("<!-- <script>x</script> -->\n<script>y</script>", "vue"), [js("y")]);
  assert.deepEqual(
    read("<template><!-- </template><script>x</script> --></template><script>y</script>", "vue"),
    [js("y")]
  );
  // A pug template is raw text: the `<template>` written in it opens nothing.
  assert.deepEqual(
    read('<template lang="pug">\n<template>\n</template>\n<script>y</script>', "vue"),
    [js("y")]
  );
  // `<Script>` is a custom block, and raw text to its own end tag.
  assert.deepEqual(read("<Script>a</Script><docs><script>x</script></docs>", "vue"), []);
});

test("vue: a template is passed over to its own end tag, whatever it holds", () => {
  const afterTemplate = (inside, attrs = "") =>
    read(`<template${attrs}>${inside}</template><script>y</script>`, "vue");
  const y = [js("y")];
  assert.deepEqual(afterTemplate('{{ "</template><script>x</script>" }}'), y);
  // An interpolation that never closes takes the rest of the file with it.
  assert.deepEqual(afterTemplate("{{ a"), []);
  for (const raw of ["script", "style", "textarea", "title"]) {
    assert.deepEqual(afterTemplate(`<${raw}></template><script>x</script></${raw}>`), y, raw);
  }
  assert.deepEqual(afterTemplate("<template />"), y);
  assert.deepEqual(afterTemplate("<TEMPLATE></template><script>x</script></TEMPLATE>"), y);
  assert.deepEqual(afterTemplate("<template></TEMPLATE>"), y);
  for (const attrs of [' lang="html"', " lang"]) {
    assert.deepEqual(afterTemplate("<template></template><script>x</script>", attrs), y, attrs);
  }
  // A `<` that opens no tag is text, in a template and outside one.
  assert.deepEqual(afterTemplate("a < b "), y);
  assert.deepEqual(read("a < b\n<script>y</script>", "vue"), y);
  assert.deepEqual(read("<docs/><script>y</script>", "vue"), y);
  // A tag or a raw element in it that never ends takes the rest of the file too.
  assert.deepEqual(afterTemplate('<p class="a'), []);
  assert.deepEqual(afterTemplate("<textarea>"), []);
});

test("vue: the open tag is read with its quotes, so it ends at the last >", () => {
  const source =
    '<script setup lang="ts" generic="T extends Record<string, unknown>">\nconst a = 1\n</script>';
  assert.deepEqual(read(source, "vue"), [ts("\nconst a = 1\n", "setup")]);
  assert.deepEqual(read("<script generic='A extends B<C>' lang=ts>a</script>", "vue"), [ts("a")]);
  assert.deepEqual(read('<script lang = "ts">a</script>', "vue"), [ts("a")]);
  // The compiler keeps the last of two.
  assert.deepEqual(read('<script lang="ts" lang="js">a</script>', "vue"), [js("a")]);
});

test("vue: a newline may follow <script before the attributes", () => {
  assert.deepEqual(read('<script\n  setup\n  lang="ts"\n>\nconst a = 1\n</script>', "vue"), [
    ts("\nconst a = 1\n", "setup"),
  ]);
  assert.deepEqual(read("<script\r\n>a</script>", "vue"), [js("a")]);
  assert.deepEqual(read("<script\fsetup>a</script>", "vue"), [js("a", "setup")]);
});

test("vue: the body ends at the first </script in any case, strings unread", () => {
  assert.deepEqual(read('<script>const a = "</script>"; b</script>', "vue"), [js('const a = "')]);
  assert.deepEqual(read("<script>a</SCRIPT >", "vue"), [js("a")]);
  assert.deepEqual(read("<script>a</script\n>", "vue"), [js("a")]);
  assert.deepEqual(read("<script>a</script/>b</script>", "vue"), [js("a</script/>b")]);
  assert.deepEqual(read("<script>a</scripts>b</script>", "vue"), [js("a</scripts>b")]);
  assert.deepEqual(read("<script>a</scr>b</script>", "vue"), [js("a</scr>b")]);
  assert.deepEqual(read("<script>a</script ", "vue"), [js("a")]);
  // An open tag written in a string opens nothing: the body is raw text.
  assert.deepEqual(read('<script>const s = "<script setup>"</script>', "vue"), [
    js('const s = "<script setup>"'),
  ]);
});

test("vue: the first setup script and the first plain one are kept, in file order", () => {
  assert.deepEqual(read("<script setup>a</script>\n<script>b</script>", "vue"), [
    js("a", "setup"),
    js("b"),
  ]);
  assert.deepEqual(read("<script>b</script>\n<script setup>a</script>", "vue"), [
    js("b"),
    js("a", "setup"),
  ]);
  assert.deepEqual(read("<script>a</script><script>b</script>", "vue"), [js("a")]);
  assert.deepEqual(
    read("<script setup>a</script><script setup>b</script><script>c</script>", "vue"),
    [js("a", "setup"), js("c")]
  );
  // An empty value is still the attribute, and a bound one is a directive.
  assert.deepEqual(read('<script setup="">a</script>', "vue"), [js("a", "setup")]);
  assert.deepEqual(read('<script :setup="x">a</script>', "vue"), [js("a")]);
});

test("vue: lang is per block, absent is js, and any other value is not read", () => {
  assert.deepEqual(read('<script lang="ts">a</script><script setup>b</script>', "vue"), [
    ts("a"),
    js("b", "setup"),
  ]);
  for (const lang of ["js", "jsx", "ts", "tsx"]) {
    assert.deepEqual(read(`<script lang="${lang}">a</script>`, "vue"), [
      { body: "a", lang, role: "instance" },
    ]);
  }
  assert.deepEqual(read('<script lang="">a</script>', "vue"), [js("a")]);
  assert.deepEqual(read("<script lang>a</script>", "vue"), [js("a")]);
  assert.deepEqual(read('<script :lang="ts">a</script>', "vue"), [js("a")]);
  for (const lang of ["gleam", "coffee", "TS", "typescript"]) {
    assert.deepEqual(read(`<script lang="${lang}">a</script>`, "vue"), [], lang);
  }
  // The unread block still holds its kind's one place.
  assert.deepEqual(read('<script lang="gleam">a</script><script>b</script>', "vue"), []);
});

test("vue: a whitespace-only body is dropped, and so is a block with src", () => {
  assert.deepEqual(read("<script>\n  \n</script>", "vue"), []);
  assert.deepEqual(read("<script setup />", "vue"), []);
  // Dropped before the first of a kind is chosen, so the next one is read.
  assert.deepEqual(read("<script></script><script>a</script>", "vue"), [js("a")]);
  assert.deepEqual(read('<script src="./x.js"></script>', "vue"), []);
  assert.deepEqual(read('<script src="./x.js" />', "vue"), []);
  assert.deepEqual(read('<script src="./x.js">a</script>', "vue"), []);
  // A block with src is the file's plain script, so a later one is a duplicate.
  assert.deepEqual(read('<script src="./x.js"></script><script>a</script>', "vue"), []);
  assert.deepEqual(read('<script src="./x.js"></script><script setup>a</script>', "vue"), [
    js("a", "setup"),
  ]);
});

test("svelte: comments and style bodies are skipped", () => {
  assert.deepEqual(read("<!--\n<script>x</script>\n-->\n<script>y</script>", "svelte"), [js("y")]);
  assert.deepEqual(
    read("<style>\n<script>x</script>\n</style >\n<script>y</script>", "svelte"),
    [js("y")]
  );
  assert.deepEqual(read("<style>\n<script>x</script>\n</style>", "svelte"), []);
  assert.deepEqual(read("<!-- a\n<script>y</script>", "svelte"), []);
  assert.deepEqual(read("<script-view>\n</script-view>\n<styles>\n<script>y</script>", "svelte"), [
    js("y"),
  ]);
});

test("svelte: the first module script and the first instance script are kept", () => {
  assert.deepEqual(
    read('<script context="module">a</script>\n<script>b</script>\n<script>c</script>', "svelte"),
    [js("a", "module"), js("b")]
  );
  assert.deepEqual(
    read("<script>b</script>\n<script module>a</script>\n<script module>c</script>", "svelte"),
    [js("b"), js("a", "module")]
  );
  assert.deepEqual(read('<script context="other">a</script>', "svelte"), [js("a")]);
  assert.deepEqual(
    read('<script generics="T extends Record<string, unknown>" module>a</script>', "svelte"),
    [js("a", "module")]
  );
});

test("svelte: the end tag is lower-case </script, optional whitespace, then >", () => {
  assert.deepEqual(read("<script>a</script >", "svelte"), [js("a")]);
  assert.deepEqual(read("<script>a</script\n>", "svelte"), [js("a")]);
  assert.deepEqual(read("<script>a</script\u00a0>", "svelte"), [js("a")]);
  assert.deepEqual(read("<script>a</SCRIPT>b</script foo>c</script>", "svelte"), [
    js("a</SCRIPT>b</script foo>c"),
  ]);
  assert.deepEqual(read('<script>const s = "<script>"</script>', "svelte"), [
    js('const s = "<script>"'),
  ]);
  assert.deepEqual(scriptBlocks("<script>a</SCRIPT>", "svelte"), {
    blocks: [],
    unterminated: true,
  });
});

test("svelte: the first script tag that states a lang decides for every block", () => {
  assert.deepEqual(read('<script module lang="ts">a</script>\n<script>b</script>', "svelte"), [
    ts("a", "module"),
    ts("b"),
  ]);
  assert.deepEqual(read('<script>b</script>\n<script module lang="ts">a</script>', "svelte"), [
    ts("b"),
    ts("a", "module"),
  ]);
  assert.deepEqual(read("<script lang=ts>a</script>", "svelte"), [ts("a")]);
  for (const lang of ["typescript", "TS", "tsx", "js"]) {
    assert.deepEqual(
      read(`<script module lang="${lang}">a</script>\n<script lang="ts">b</script>`, "svelte"),
      [js("a", "module"), js("b")],
      lang
    );
  }
  assert.deepEqual(read('<!-- <script lang="ts"> -->\n<script>a</script>', "svelte"), [js("a")]);
  // The compiler's flag does not know where a tag sits, or count an empty value.
  assert.deepEqual(
    read('<div><script lang="ts">x</script></div>\n<script>y</script>', "svelte"),
    [ts("y")]
  );
  assert.deepEqual(
    read('<script lang="">a</script>\n<script module lang="ts">b</script>', "svelte"),
    [ts("a"), ts("b", "module")]
  );
});

test("svelte: only a script at the start of its line is a block, and an empty one is", () => {
  assert.deepEqual(read("<p>hi</p><script>let a = 1</script>", "svelte"), []);
  assert.deepEqual(read("{@html `<script>x</script>`}\n<script>y</script>", "svelte"), [js("y")]);
  assert.deepEqual(read("<svelte:head><script>x</script></svelte:head>", "svelte"), []);
  // Indented is how a formatter leaves a script nested in an element.
  assert.deepEqual(read("<p>hi</p>\n  \t<script>a</script>", "svelte"), []);
  assert.deepEqual(read(" <script>a</script>", "svelte"), []);
  assert.deepEqual(read("<div>\n\t<script>x</script>\n</div>", "svelte"), []);
  // The one refused is read to its own end tag and no further.
  assert.deepEqual(
    read("<svelte:head>\n  <script>x</script>\n</svelte:head>\n<script>y</script>", "svelte"),
    [js("y")]
  );
  assert.deepEqual(read("<p>a</p><script>\n<script>x</script>", "svelte"), []);
  assert.deepEqual(read("<p>hi</p>\r\n<script>a</script>", "svelte"), [js("a")]);
  // A comment, a style block and the other script cannot hold a nested one.
  assert.deepEqual(read("<!-- note --><script>a</script>", "svelte"), [js("a")]);
  assert.deepEqual(read("<style>a{}</style><script>a</script>", "svelte"), [js("a")]);
  assert.deepEqual(read("<script module>a</script><script>b</script>", "svelte"), [
    js("a", "module"),
    js("b"),
  ]);
  assert.deepEqual(read("<!-- note --> <script>a</script>", "svelte"), []);
  // A BOM opening the file is not markup, and the offsets stay the caller's own.
  assert.deepEqual(scriptBlocks("\uFEFF<script>a</script>", "svelte").blocks, [
    { start: 9, end: 10, lang: "js", role: "instance" },
  ]);
  assert.deepEqual(read("<p>a</p>\n\uFEFF<script>a</script>", "svelte"), []);

  const { blocks } = scriptBlocks("<script></script><p>hi</p>", "svelte");
  assert.deepEqual(blocks, [{ start: 8, end: 8, lang: "js", role: "instance" }]);
  assert.deepEqual(read("<script>\n</script>", "svelte"), [js("\n")]);
  // A self-closing script has no body, so the next end tag is not its own.
  assert.deepEqual(read("<script />\n<script>y</script>", "svelte"), [js("y")]);
});

test("blanking keeps the length and every line break", () => {
  const s =
    "\uFEFF<template>\r\n\t<p>\u{1F600}</p>\r\n</template>\r\n" +
    "<script>\r\nconst a = 1;\r\n</script>\r\n";
  const [{ start: a, end: b }] = scriptBlocks(s, "vue").blocks;
  assert.equal(s.slice(a, b), "\r\nconst a = 1;\r\n");

  const blanked = blankOutside(s, a, b);
  // Split by UTF-16 unit, as offsets count: the astral character is two.
  const breaks = (text) =>
    text.split("").flatMap((c, i) => (c === "\n" || c === "\r" ? [`${i}${c}`] : []));
  assert.equal(blanked.length, s.length);
  assert.deepEqual(breaks(blanked), breaks(s));
  assert.equal(blanked.slice(a, b), s.slice(a, b));
  assert.match(blanked.slice(0, a) + blanked.slice(b), /^[ \r\n]*$/);
});

test("an open script with no end is reported, not guessed", () => {
  for (const kind of ["vue", "svelte"]) {
    const open = ["<script>\nconst a = 1;\n", "<script setup", '<script lang="ts', "<script"];
    for (const source of open) {
      assert.deepEqual(scriptBlocks(source, kind), { blocks: [], unterminated: true }, source);
    }
  }
  // One the rules never read as a block is not an open script.
  assert.equal(scriptBlocks("<template><script>a</template>", "vue").unterminated, false);
  assert.equal(scriptBlocks("<!-- <script>a", "vue").unterminated, false);
  assert.equal(scriptBlocks("<!-- <script>a", "svelte").unterminated, false);
  assert.equal(scriptBlocks("<p>a</p><script>a", "svelte").unterminated, false);
  assert.equal(scriptBlocks('<div class="a', "vue").unterminated, false);
});

// The clock bounds are sized against the quadratic scans they guard, which take
// over 6,000 ms on these inputs; a linear one takes under 150 ms on a busy machine.
// Each input is scanned five times, because a slow path can appear only once the
// engine has optimised the scanner, which is after the first call in a process.
const scanFiveTimes = (source, kind, expected) => {
  for (let scan = 1; scan <= 5; scan++) {
    const before = performance.now();
    const found = read(source, kind);
    const took = performance.now() - before;
    assert.deepEqual(found, expected, kind);
    assert.ok(took < 5000, `${kind} scan ${scan} took ${Math.round(took)} ms`);
  }
};

test("a megabyte of markup is scanned in linear time", () => {
  const markup = "<div>".repeat(200_000);
  assert.equal(markup.length, 1_000_000);
  const script = "<script>const a = 1;</script>";
  scanFiveTimes(`<template>${markup}</template>\n${script}`, "vue", [js("const a = 1;")]);
  scanFiveTimes(`${markup}\n${script}`, "svelte", [js("const a = 1;")]);
});

test("a long tag name costs no more for each end tag it is held against", () => {
  const source = `<${"a".repeat(249_999)}>${"</>".repeat(250_000)}</${"A".repeat(249_999)}>`;
  scanFiveTimes(`${source}\n<script>const a = 1;</script>`, "vue", [js("const a = 1;")]);
});

test("the scanner never throws", () => {
  const component = `<!-- a card -->
<script context="module" lang="ts">
  export const prerender = true;
</script>
<script setup lang="ts" generic="T extends Record<string, unknown>">
import { ref } from "vue";
const open = ref<boolean>(false);
const label = '</' + "script>";
</script>

<template lang="html">
  <template v-if="open">
    <p :title="a < b ? 'x' : \`y\`">{{ open ? "<script>" : "}}" }}</p>
  </template>
  <textarea><template></textarea>
</template>

<style scoped>
.card > p { color: red; }
</style>
`;
  let seed = 1;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const sources = ["", "<", "<script", "<script ", "<!--", "<template><template>"];
  for (let i = 0; i < 200; i++) {
    const from = next(component.length);
    sources.push(component.slice(from, from + 1 + next(component.length - from)));
  }
  for (const kind of ["vue", "svelte"]) {
    for (const source of sources) {
      const { blocks, unterminated } = scriptBlocks(source, kind);
      assert.equal(typeof unterminated, "boolean");
      assert.ok(blocks.length <= 2);
      for (const b of blocks) assert.ok(0 <= b.start && b.start <= b.end && b.end <= source.length);
    }
  }
});
