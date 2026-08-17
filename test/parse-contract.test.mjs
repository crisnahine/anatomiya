import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAll } from "../lib/parse.mjs";
import { LANGUAGES } from "../lib/langs.mjs";
import { walkRuby } from "../lib/ruby-walk.mjs";
import { needsRuby } from "./ruby-available.mjs";

/**
 * The record contract, held against every declared language through `parseAll`
 * alone. A new language enrolls itself by being declared: these tests iterate
 * the registry, so an adapter that answers a different shape fails here before
 * any caller meets it.
 */
const FIXTURES = {
  js: {
    ok: "export const a = 1;\n",
    rejected: "function f( {\n",
  },
  jsx: {
    ok: 'export const el = <div a="1" />;\n',
    // Legal in .ts and not in .tsx, so the source that parses under the js
    // declaration's grammar is this declaration's rejected fixture (B14).
    rejected: "const x = <string>window.name;\nexport const y = x;\n",
  },
  ruby: {
    ok: "class A\n  def b\n    1\n  end\nend\n",
    rejected: "def broken(\n",
  },
};

const optsFor = (decl) => (decl.engine === "prism" ? needsRuby : {});

for (const decl of LANGUAGES) {
  const fixture = FIXTURES[decl.id];

  test(`${decl.id}: an ok record carries the counts-mode contract`, optsFor(decl), async () => {
    const rel = `src/ok.${decl.exts[0]}`;
    const { records, tallies } = await parseAll([{ rel, source: fixture.ok, lang: decl.id }]);
    assert.equal(records.size, 1);
    assert.equal(tallies.ok, 1);
    const r = records.get(rel);
    assert.equal(r.kind, "ok");
    assert.ok(r.hits && typeof r.hits === "object", "counts mode promises hits");
    assert.ok(!r.program, "counts mode does not promise a tree");
    assert.ok(r.facets, "every ok record carries facets");
    assert.ok(r.facets.testRunner === null || typeof r.facets.testRunner === "string");
    assert.equal(typeof r.facets.testCalls, "boolean");
    assert.notEqual(r.stripped, true, "a plain file is never stripped");
    assert.ok(r.attempts === 1 || r.attempts === 2);
  });

  test(`${decl.id}: rejected syntax answers ok false with its error count and no sites`, optsFor(decl), async () => {
    const rel = `src/bad.${decl.exts[0]}`;
    const { records, tallies } = await parseAll([{ rel, source: fixture.rejected, lang: decl.id }]);
    const r = records.get(rel);
    assert.equal(r.kind, "rejected");
    assert.equal(r.ok, false);
    assert.ok(r.errors > 0);
    assert.ok(!r.hits);
    assert.equal(tallies.rejected, 1);
  });

  test(`${decl.id}: the size guard answers oversize without a parse`, optsFor(decl), async () => {
    const rel = `src/big.${decl.exts[0]}`;
    const { records, tallies } = await parseAll([{ rel, source: fixture.ok, lang: decl.id }], {
      guards: { [decl.id]: { maxBytes: 1 } },
    });
    assert.equal(records.get(rel).kind, "oversize");
    assert.equal(tallies.oversize, 1);
  });

  test(`${decl.id}: tree mode returns the program shaped as declared`, optsFor(decl), async () => {
    const rel = `src/tree.${decl.exts[0]}`;
    const { records } = await parseAll([{ rel, source: fixture.ok, lang: decl.id }], { withProgram: true });
    const r = records.get(rel);
    assert.equal(r.kind, "ok");
    assert.ok(r.program, "tree mode promises the program");
    if (decl.positions.offsets === "utf16") {
      const first = r.program.body?.[0];
      assert.equal(typeof first?.start, "number", "an offsets language addresses by code units");
      assert.ok(Array.isArray(r.comments), "the oxc side carries its comment channel");
    } else {
      let line = null;
      walkRuby(r.program, (n) => {
        if (line === null && typeof n.line === "number") line = n.line;
      });
      assert.equal(typeof line, "number", "a lines language addresses by line");
    }
  });

  for (const name of decl.filenames) {
    test(`${decl.id}: ${name} parses under its declared language`, optsFor(decl), async () => {
      const { records } = await parseAll([{ rel: name, source: 'source "https://rubygems.org"\n', lang: decl.id }]);
      assert.equal(records.get(name).kind, "ok");
    });
  }
}

test("one call answers a mixed batch, every rel exactly once", needsRuby, async () => {
  const files = LANGUAGES.map((d) => ({ rel: `m/${d.id}.${d.exts[0]}`, source: FIXTURES[d.id].ok, lang: d.id }));
  const { records, tallies } = await parseAll(files);
  assert.equal(records.size, files.length);
  assert.equal(tallies.ok, files.length);
  const sum = Object.values(tallies).reduce((a, b) => a + b, 0);
  assert.equal(sum, records.size, "tallies sum to the records");
});

test("an undeclared language refuses before any engine starts", async () => {
  await assert.rejects(parseAll([{ rel: "a.py", source: "x = 1\n", lang: "python" }]), /python/);
});
