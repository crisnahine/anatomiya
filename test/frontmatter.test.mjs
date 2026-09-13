import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frontmatter, readFrontmatter } from "../plugins/ultracode-anywhere/hooks/frontmatter.mjs";

test("the top-level keys come back as plain scalars", () => {
  const read = frontmatter("---\nname: slow\ndescription: Reads a lot.\neffort: xhigh\n---\nThe body.\n");

  assert.deepEqual(read.fields, { name: "slow", description: "Reads a lot.", effort: "xhigh" });
  assert.equal(read.head, "name: slow\ndescription: Reads a lot.\neffort: xhigh");
  assert.equal(read.body, "The body.\n");
});

test("a file with no frontmatter reads as none", () => {
  assert.equal(frontmatter("# Just a heading\n"), null);
  assert.equal(frontmatter("---\nname: never closed\n"), null);
});

test("a block scalar, a folded one and a continued plain value are read whole", () => {
  assert.equal(frontmatter("---\nname: slow\ndescription:\n  Reads a lot,\n  slowly.\neffort: xhigh\n---\nbody\n").fields.description, "Reads a lot, slowly.");
  assert.equal(frontmatter("---\ndescription: |\n  one\n  two\n---\n").fields.description, "one\ntwo");
  assert.equal(frontmatter("---\ndescription: >-\n  one\n\n  two\n---\n").fields.description, "one two");
});

test("a byte order mark, CRLF line ends and a comment do not change a value", () => {
  const read = frontmatter("\uFEFF---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n# note\r\neffort: 'high' # why\r\n---\r\nbody");

  assert.equal(read.fields.effort, "high");
  assert.equal(read.fields.description, "one\ntwo");
  assert.equal(frontmatter("---\neffort: high # the reason\n---\n").fields.effort, "high");
});

test("quoted scalars read their own escapes and fold a line break to a space", () => {
  assert.equal(frontmatter('---\nname: a\ndescription: "first\n  second"\n---\n').fields.description, "first second");
  assert.equal(frontmatter('---\ndescription: "tab\\there \\"q\\""\n---\n').fields.description, 'tab\there "q"');
  assert.equal(frontmatter('---\ndescription: "a # not a comment"\n---\n').fields.description, "a # not a comment");
  assert.equal(frontmatter("---\ndescription: 'it''s'\n---\n").fields.description, "it's");
  assert.equal(frontmatter('---\ndescription: "\\x41 is YAML only"\n---\n').fields.description, "\\x41 is YAML only", "an escape JSON does not know is kept as written");
});

test("a file that cannot be read has no frontmatter, and one that can is read", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-frontmatter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.md"), "---\nname: a\n---\n");
  mkdirSync(join(dir, "folder.md"));

  assert.equal(readFrontmatter(join(dir, "a.md")).fields.name, "a");
  assert.equal(readFrontmatter(join(dir, "folder.md")), null);
  assert.equal(readFrontmatter(join(dir, "missing.md")), null);
});
