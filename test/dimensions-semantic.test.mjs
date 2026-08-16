import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScript } from "../lib/semantic.mjs";
import { runSemantic } from "../lib/semantic.mjs";
import { SEMANTIC_DIMENSIONS } from "../lib/dimensions-semantic.mjs";

const loaded = await loadTypeScript();
const needsTs = { skip: loaded ? false : "typescript is not installed" };

async function counts(src) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-lod-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), `{"compilerOptions":{"strict":true}}`);
    writeFileSync(join(dir, "a.ts"), src);
    const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], {
      keys: ["law_of_demeter"],
    });
    const hits = r.records.get("a.ts")?.hits?.law_of_demeter ?? [];
    return { candidates: hits.length, conforming: hits.filter((h) => h.conforming).length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a chain over one type is not a violation", needsTs, async () => {
  // Literal widening is load-bearing: without it the two string literals are
  // two distinct types and every string chain in every repository is a
  // violation.
  assert.deepEqual(await counts(`export const x = " a ".trim().toLowerCase()`), {
    candidates: 1,
    conforming: 1,
  });
});

test("a chain across three types is a violation", needsTs, async () => {
  const src = `
    class A { doX() { return 1 } }
    class B { getA() { return new A() } }
    class C { getB() { return new B() } }
    export const y = new C().getB().getA().doX()
  `;
  assert.deepEqual(await counts(src), { candidates: 1, conforming: 0 });
});

test("a chain over one class repeated is not a violation", needsTs, async () => {
  const src = `
    class Q { self(): Q { return this } end(): number { return 1 } }
    export const z = new Q().self().self().end()
  `;
  assert.deepEqual(await counts(src), { candidates: 1, conforming: 1 });
});

test("a single call is not a candidate at all", needsTs, async () => {
  // The third case, which is where the bugs live: depth 1 is every call in
  // every file, and counting it makes the denominator the language.
  assert.deepEqual(await counts(`export const w = [1, 2].length`), { candidates: 0, conforming: 0 });
});

test("a nested chain is counted once, outermost", needsTs, async () => {
  const src = `
    class A { doX() { return 1 } }
    class B { getA() { return new A() } }
    export const v = new B().getA().doX()
  `;
  const r = await counts(src);
  assert.equal(r.candidates, 1, "the inner chain is contained by the outer one");
});

test("every semantic dimension is witnessed here", () => {
  // The syntactic harness in `applicability.test.mjs` drives its rows through a
  // parse and cannot reach these, so this file carries the same completeness
  // rule for the tier it does cover. Written out rather than derived, since an
  // expectation taken from the registry agrees with it by construction.
  const witnessed = ["law_of_demeter"];

  assert.deepEqual(
    SEMANTIC_DIMENSIONS.map((d) => d.key).sort(),
    witnessed.slice().sort(),
    "a semantic dimension without a witness ships a predicate nobody proved"
  );
});
