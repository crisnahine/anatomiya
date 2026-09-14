import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileSync } from "node:fs";

import { PLUGIN, RESOLVABLE, SCRIPT_MOST, catalogueLine, metaIn, shippedHere, shippedIn } from "../plugins/ultracode-anywhere/hooks/catalogue.mjs";

import { ULTRACODE } from "../scripts/plugins.mjs";

/** A script whose body is beside the point: every case here is about the meta. */
const withMeta = (meta) => `${meta}\n\nphase('A')\nawait agent('x')\n`;

/** The shape a shipped workflow's meta has, with one field swapped per case. */
const meta = (body) => withMeta(`export const meta = ${body}`);

test("the three fields a catalogue entry is made of are read off the meta", () => {
  const read = metaIn(
    meta(`{
  name: 'review',
  description: 'Review the changes',
  whenToUse: 'When there is a diff to read',
}`),
  );
  assert.deepEqual(read, { name: "review", description: "Review the changes", whenToUse: "When there is a diff to read" });
});

test("a meta that is not the first statement is not this plugin's to describe", () => {
  assert.equal(metaIn(`const x = 1\nexport const meta = { name: 'a', description: 'b' }\n`), null);
});

test("comments before and inside the meta are not statements and do not stop the read", () => {
  const read = metaIn(
    `// what this does\n/* and why */\nexport const meta = {\n  // the name\n  name: 'a', /* inline */ description: 'b',\n}\n`,
  );
  assert.deepEqual(read, { name: "a", description: "b", whenToUse: null });
});

test("an apostrophe inside a double-quoted description does not end it", () => {
  assert.equal(metaIn(meta(`{ name: 'a', description: "the repo's own diff" }`)).description, "the repo's own diff");
});

test("an escaped quote inside a string does not end it", () => {
  assert.equal(metaIn(meta(`{ name: 'a', description: 'say \\'no\\' twice' }`)).description, "say 'no' twice");
});

test("an escape stands for what it names, not for the letter after the backslash", () => {
  assert.equal(metaIn(meta(`{ name: 'a', description: 'one\\ntwo\\ttabbed' }`)).description, "one\ntwo\ttabbed");
});

test("a name or description that is not a non-empty string is what the build refuses, so this does too", () => {
  assert.equal(metaIn(meta(`{ description: 'b' }`)), null);
  assert.equal(metaIn(meta(`{ name: '', description: 'b' }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: '' }`)), null);
  assert.equal(metaIn(meta(`{ name: 3, description: 'b' }`)), null);
});

test("every non-literal the build names is refused here, rather than read as something else", () => {
  // Each case is the meta's own first statement: prefixing one with a
  // declaration would have it refused for not being first, which is a
  // different rule and would pass whatever the grammar below did.
  for (const body of [
    `{ name: NAME, description: 'b' }`,
    `{ name: String('a'), description: 'b' }`,
    `{ name: \`a\${1}\`, description: 'b' }`,
    `{ ...spread, name: 'a', description: 'b' }`,
    `{ ['na' + 'me']: 'a', description: 'b' }`,
    `{ name() { return 'a' }, description: 'b' }`,
    `{ name: 'a', description: 'b', phases: [, { title: 'A' }] }`,
  ]) {
    assert.equal(metaIn(meta(body)), null, body);
  }
});

test("a property that is not a plain key and value is refused after the required two have been read", () => {
  // The refusal has to outlast a valid `name` and `description`: a reader that
  // stopped at the malformed property and answered what it had already
  // collected would accept a meta the build does not.
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b', shorthand }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b', later() { return 1 } }`)), null);
});

test("a reserved key is refused whole, since the build refuses the meta that carries one", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.equal(metaIn(meta(`{ name: 'a', description: 'b', ${key}: 'x' }`)), null, key);
  }
});

test("a numeric key is a key, and a negative one is refused, since no parser reads that object literal", () => {
  assert.deepEqual(metaIn(meta(`{ 1: 1, name: 'a', description: 'b' }`)), { name: "a", description: "b", whenToUse: null });
  assert.equal(metaIn(meta(`{ -1: 1, name: 'a', description: 'b' }`)), null);
});

test("a template literal with nothing in it to interpolate is a string", () => {
  assert.equal(metaIn(meta("{ name: 'a', description: `plain` }")).description, "plain");
});

/** A workflows directory of this test's own. */
function dirWith(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-catalogue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test("every .js file whose meta reads is shipped, in name order whatever the filesystem said", (t) => {
  // The filenames sort the opposite way from the names inside them, so a
  // listing that simply passed on whatever `readdir` answered is a different
  // answer from this one. Sorting by filename would pass on a directory where
  // the two agree, which is what the first version of this case did.
  const dir = dirWith(t, {
    "a.js": meta(`{ name: 'zulu', description: 'z' }`),
    "m.js": meta(`{ name: 'mike', description: 'm' }`),
    "z.js": meta(`{ name: 'alpha', description: 'a' }`),
  });
  assert.deepEqual(
    shippedIn(dir).map((s) => s.meta.name),
    ["alpha", "mike", "zulu"],
  );
});

test("a file the loader would not read is not one this counts", (t) => {
  const dir = dirWith(t, {
    "good.js": meta(`{ name: 'good', description: 'g' }`),
    "notes.md": "# not a workflow",
    "old.mjs": meta(`{ name: 'old', description: 'o' }`),
    "broken.js": meta(`{ name: nope, description: 'b' }`),
  });
  assert.deepEqual(
    shippedIn(dir).map((s) => s.meta.name),
    ["good"],
  );
});

test("a workflows directory that is not there costs a sentence, not a turn", () => {
  assert.deepEqual(shippedIn(join(tmpdir(), "ultracode-anywhere-no-such-dir")), []);
});

test("the sentence names each workflow the way the tool resolves it", () => {
  const line = catalogueLine([{ meta: { name: "review", description: "d", whenToUse: "when there is a diff" } }], "ultracode-anywhere");
  assert.match(line, /`ultracode-anywhere:review`: when there is a diff/);
});

test("a workflow with no whenToUse is described by the field the build does require", () => {
  const line = catalogueLine([{ meta: { name: "review", description: "reviews things", whenToUse: null } }], "ultracode-anywhere");
  assert.match(line, /`ultracode-anywhere:review`: reviews things/);
});

test("a plugin shipping none says nothing, rather than saying it ships nothing", () => {
  assert.equal(catalogueLine([], "ultracode-anywhere"), null);
});

test("a second declarator is a file the build skips, so it is not one to advertise", () => {
  // `export const meta = {…}, second = 1` has two declarators and the build
  // requires exactly one. Read as a workflow, the catalogue would name one that
  // never loaded, and the model would be told it exists. It has to be refused
  // wherever the comma sits, since a line-based check saw only the first line.
  const META = "export const meta = { name: 'a', description: 'b' }";
  for (const after of [", second = 1\n", "\n, second = 1\n", " /* c */ , second = 1\n", " // c\n, second = 1\n"]) {
    assert.equal(metaIn(META + after), null, JSON.stringify(after));
  }
  for (const after of ["\n\nphase('A')\n", ";\n\nphase('A')\n", " // done\n\nphase('A')\n", " /* done */\n\nphase('A')\n"]) {
    assert.equal(metaIn(META + after)?.name, "a", JSON.stringify(after));
  }
});

test("a file checked out with CRLF line endings reads the same as one with LF", () => {
  // The check that refuses a second declarator used to read the rest of the
  // literal's line, and on a CRLF file that remainder is a lone carriage
  // return. Every shipped workflow read as null, the catalogue went empty, and
  // no case here ran on a CRLF file to notice.
  const lf = "export const meta = {\n  name: 'a',\n  description: 'b',\n}\n\nphase('A')\nawait agent('x')\n";
  assert.deepEqual(metaIn(lf.replace(/\n/g, "\r\n")), metaIn(lf));
  assert.equal(metaIn(lf.replace(/\n/g, "\r\n")).name, "a");
});

test("a line break inside a quoted string ends it for every parser, so it ends it here", () => {
  for (const terminator of ["\r", "\n"]) {
    assert.equal(metaIn(meta(`{ name: 'a${terminator}b', description: 'd' }`)), null, JSON.stringify(terminator));
  }
});

test("the two separators are string content, and a reader that refused them dropped a workflow the build loads", () => {
  // A string literal has been allowed to hold U+2028 and U+2029 since ES2019.
  // Measured against oxc, which is what the gate parses with, and against the
  // engine: both read `'a\u2028b'` as a three-character string. Refusing them
  // made this reader stricter than the build, which drops a workflow that loads.
  for (const separator of ["\u2028", "\u2029"]) {
    assert.deepEqual(metaIn(meta(`{ name: 'a', description: 'd${separator}e' }`)), {
      name: "a",
      description: `d${separator}e`,
      whenToUse: null,
    });
  }
});

test("a legacy escape is refused, since a module is strict and no parser decodes one", () => {
  // Decoded, these answer a meta for a file the build will not compile, and the
  // gate's parser agreed with the decode until it was told to report the
  // strict-mode early errors.
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b\\8c' }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b\\9c' }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: 'oct\\101l' }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b\\01c' }`)), null);
  // `\0` on its own is not an octal escape, and strict mode allows it.
  assert.deepEqual(metaIn(meta(`{ name: 'a', description: 'b\\0c' }`)), { name: "a", description: "b\u0000c", whenToUse: null });
});

test("a name the tool could not resolve, or a code span could not hold, is not advertised", (t) => {
  // The sentence quotes the name in backticks and the model passes it back as
  // the tool's `name`. A backtick or a space in one breaks both.
  const dir = dirWith(t, {
    "tick.js": meta("{ name: 'a`b', description: 'd' }"),
    "space.js": meta(`{ name: 'a b', description: 'd' }`),
    "fine.js": meta(`{ name: 'fine', description: 'd' }`),
  });
  assert.deepEqual(
    shippedIn(dir).map((s) => s.meta.name),
    ["fine"],
  );
});

test("names come back in collation order ahead of file order, and a tie in one fixed order", (t) => {
  // The name decides before the file does: `a-b` collates first and lives in
  // the later file. No two distinct names this class resolves collate equal
  // here (every one up to three characters was tried), so the code-unit
  // comparator has no case of its own. The order is written out, since a second
  // call proves nothing: two calls in one process agree whatever the comparator
  // does, and `readdir` answers the same both times.
  const dir = dirWith(t, {
    "b.js": meta(`{ name: 'a-b', description: 'd' }`),
    "a.js": meta(`{ name: 'ab', description: 'd' }`),
  });
  assert.deepEqual(
    shippedIn(dir).map((s) => s.file),
    ["b.js", "a.js"],
  );

  // Two files declaring one name is the tie that reaches the last comparator:
  // the gate refuses to ship it, and the hook still has to order it the same
  // way on every machine rather than however the directory was read. The
  // listing is handed in reversed, because this filesystem answers sorted and a
  // case that takes its order cannot tell a working tie-break from a stable
  // sort over an already-sorted listing.
  const twins = dirWith(t, {
    "second.js": meta(`{ name: 'twin', description: 'd' }`),
    "first.js": meta(`{ name: 'twin', description: 'd' }`),
  });
  const backwards = (dir) => readdirSync(dir).sort().reverse();
  // The listing really is the one handed in: ignored, every assertion below
  // would pass on this filesystem's own sorted answer and prove nothing.
  assert.deepEqual(
    shippedIn(dir, { list: () => ["a.js"] }).map((s) => s.file),
    ["a.js"],
  );
  assert.deepEqual(
    shippedIn(twins, { list: backwards }).map((s) => s.file),
    ["first.js", "second.js"],
  );
  assert.deepEqual(
    shippedIn(dir, { list: backwards }).map((s) => s.file),
    ["b.js", "a.js"],
  );
});

test("a file past the size the loader skips at is not one the catalogue names", (t) => {
  // The read was bounded by hook-io's own megabyte, so the sentence could name
  // a workflow the loader had passed over for being too big: the model is then
  // told to run something that answers "not found".
  const dir = dirWith(t, {
    "big.js": `${meta(`{ name: 'big', description: 'd' }`)}\n// ${"x".repeat(SCRIPT_MOST)}\n`,
    "small.js": meta(`{ name: 'small', description: 'd' }`),
  });
  assert.deepEqual(
    shippedIn(dir).map((s) => s.meta.name),
    ["small"],
  );
});

test("a name the sentence cannot quote is left out of it", (t) => {
  // The class is the hook's, and `scripts/workflow-lint.mjs` refuses the same
  // names before one ships, so this is what the gate is holding the line on.
  for (const name of ["my review", "a`b", "n".repeat(65)]) {
    const dir = dirWith(t, { "one.js": meta(`{ name: ${JSON.stringify(name)}, description: 'd' }`) });
    assert.deepEqual(shippedIn(dir), [], name);
    assert.ok(!RESOLVABLE.test(name), name);
  }
});

test("the prefix the sentence uses is the name the plugin installs under", () => {
  // The catalogue names each workflow `<PLUGIN>:<name>` and the tool resolves
  // on the plugin's manifest name. The two drifting apart would make every
  // entry answer "not found", and nothing else compares them.
  const manifest = JSON.parse(readFileSync(join(ULTRACODE, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(PLUGIN, manifest.name);
});

test("what the plugin ships is what the catalogue names", () => {
  const shipped = shippedHere();
  assert.ok(shipped.length > 0, "the plugin ships no workflows");
  const line = catalogueLine(shipped, PLUGIN);
  for (const { meta } of shipped) assert.match(line, new RegExp(`\`${PLUGIN}:${meta.name}\``));
});

test("a code point escape is hex or it is not an escape, which is what the parser requires", () => {
  // `Number.parseInt` stops at the first character it cannot use, so it read
  // `\\u{41zz}` as `A` and answered a meta for a file no parser loads.
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b\\u{41zz}c' }`)), null);
  assert.equal(metaIn(meta(`{ name: 'a', description: 'b\\u{ 41}c' }`)), null);
  assert.deepEqual(metaIn(meta(`{ name: 'a', description: 'b\\u{41}c' }`)), { name: "a", description: "bAc", whenToUse: null });
});

test("a template's CRLF is one newline here too, since that is what the parser reads", () => {
  // Carried through as two characters, a multi-line template in a meta made
  // this reader and the parse disagree about the same file on a CRLF checkout.
  const read = metaIn(`export const meta = {\r\n  name: 'a',\r\n  description: 'd',\r\n  whenToUse: \`one\r\ntwo\`,\r\n}\r\n`);
  assert.equal(read.whenToUse, "one\ntwo");
});
