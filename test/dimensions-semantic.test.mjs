import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScript } from "../plugins/anatomiya/lib/semantic.mjs";
import { runSemantic } from "../plugins/anatomiya/lib/semantic.mjs";
import { SEMANTIC_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-semantic.mjs";

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

test("a chain through a dependency's types is resolved, not read as one type", needsTs, async () => {
  // The confinement compared the path TypeScript asked for against the root as
  // given, and TypeScript asks through realpath. On macOS /tmp is a symlink, so
  // every read of a file the compiler discovered itself was refused, every
  // import resolved to any, and every chain read as conforming: the tier
  // answered 0% resolution and stated nothing, everywhere.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-dep-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"), `{"compilerOptions":{"strict":true,"module":"commonjs"}}`);
    mkdirSync(join(dir, "node_modules/dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules/dep/package.json"), `{"name":"dep","version":"1.0.0","types":"index.d.ts"}`);
    writeFileSync(
      join(dir, "node_modules/dep/index.d.ts"),
      "export declare class Thing { inner(): Inner }\nexport declare class Inner { go(): string }\n"
    );
    writeFileSync(
      join(dir, "a.ts"),
      `import { Thing } from "dep"\nexport function f(t: Thing) {\n  return t.inner().go()\n}\n`
    );

    const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }]);
    const hits = r.records.get("a.ts")?.hits?.law_of_demeter ?? [];

    assert.ok(r.typedResolutionRate > 0.5, `types did not resolve: rate ${r.typedResolutionRate}`);
    assert.equal(r.status, "ok", `the tier reported ${r.reason}`);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].conforming, false, "Thing, Inner and string are three types");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a chain is still a chain through a non-null assertion or parentheses", needsTs, async () => {
  // `this.model!.getState().update()` is routine under strictNullChecks, and
  // the walk stopped dead at the TSNonNullExpression: the chain collected one
  // receiver, was never counted, and both candidates and violations
  // under-reported with nothing saying so. The same wrapper blindness C11 fixed
  // on the syntactic side, inside the tier's only dimension.
  const decls = [
    "class Inner { go(): string { return '' } }",
    "class Thing { inner(): Inner { return new Inner() }\n  maybe?: Inner }",
  ].join("\n");

  const plain = await counts(`${decls}\nexport function f(t: Thing) { return t.inner().go() }`);
  assert.deepEqual(plain, { candidates: 1, conforming: 0 }, "Thing, Inner and string are three types");

  for (const [label, body] of Object.entries({
    "non-null": "export function f(t: Thing) { return t.maybe!.go() }",
    parens: "export function f(t: Thing) { return (t.inner()).go() }",
    both: "export function f(t: Thing) { return (t.maybe!).go() }",
  })) {
    const r = await counts(`${decls}\n${body}`);
    assert.equal(r.candidates, 1, `${label}: the chain was not counted at all`);
  }
});

test("a wrapped chain is counted once, and a wrapped callee is still a link", needsTs, async () => {
  // Two shapes the first fix did not reach. `(a.b().c())!.d()` is one chain,
  // and markChain has to unwrap or the inner one is visited again and counted
  // twice. `c.go!()` wraps the callee rather than the receiver, which is the
  // other side of the same walk.
  const decls = ["class C { go(): D { return new D() } }", "class D { end(): string { return '' } }"].join("\n");

  const nested = await counts(`${decls}\nexport function f(c: C) { return (c.go().end())!.trim() }`);
  assert.deepEqual(nested, { candidates: 1, conforming: 0 }, "the inner chain was counted a second time");

  const callee = await counts(`${decls}\nexport function f(c: C) { return c.go!().end() }`);
  assert.deepEqual(callee, { candidates: 1, conforming: 0 }, "a wrapped callee dropped the chain");
});
