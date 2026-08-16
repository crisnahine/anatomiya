import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import { EXTRA_DIMENSIONS } from "../lib/dimensions-extra.mjs";
import { dimensionsFor, ALL_DIMENSIONS } from "../lib/dimensions.mjs";

const dim = (key) => EXTRA_DIMENSIONS.find((d) => d.key === key);

function hits(key, src) {
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  dim(key).run(program, (h) => out.push(h));
  return out;
}

const counts = (key, src) => {
  const h = hits(key, src);
  return { candidates: h.length, conforming: h.filter((x) => x.conforming).length };
};

// --- function_style ---

test("a module-level function declaration conforms and an arrow const does not", () => {
  const r = counts("function_style", `
    function a() {}
    const b = () => {}
    export const c = async () => {}
  `);
  assert.deepEqual(r, { candidates: 3, conforming: 1 });
});

test("a callback nested inside a function is not a module-level declaration", () => {
  const r = counts("function_style", `function a() { const inner = () => {} }`);
  assert.equal(r.candidates, 1, "only the outer declaration counts");
});

test("a function expression assigned to a const is the same violation as an arrow", () => {
  const r = counts("function_style", `const f = function () {}`);
  assert.deepEqual(r, { candidates: 1, conforming: 0 });
});

test("a file declaring no functions contributes nothing", () => {
  assert.equal(hits("function_style", `export const limit = 10`).length, 0);
});

test("a class declaration is not a function site", () => {
  assert.equal(hits("function_style", `class K { m() {} }`).length, 0);
});

// --- explicit_return_type ---

test("an annotated export conforms whether the type sits on the arrow or the binding", () => {
  const r = counts("explicit_return_type", `
    export function a(): string { return "" }
    export const b = (): string => ""
    export const c: Handler = () => ""
    export function d() { return "" }
    export const e = () => ""
  `);
  assert.equal(r.candidates, 5);
  assert.equal(r.conforming, 3);
});

test("a default export is a boundary too, declared or arrow", () => {
  assert.deepEqual(counts("explicit_return_type", `export default function a() { return 1 }`), {
    candidates: 1,
    conforming: 0,
  });
  assert.deepEqual(counts("explicit_return_type", `export default (): string => ""`), {
    candidates: 1,
    conforming: 1,
  });
});

test("an unexported function is not a boundary", () => {
  assert.equal(hits("explicit_return_type", `function a() { return 1 }`).length, 0);
});

test("a file exporting no functions contributes nothing", () => {
  assert.equal(hits("explicit_return_type", `export const limit = 10`).length, 0);
});

// --- type_only_import ---

test("an import used only in type position is a candidate, and import type conforms", () => {
  const r = counts("type_only_import", `
    import type { A } from "./a"
    import { B } from "./b"
    let x: A
    let y: B
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 1 });
});

test("a name also read as a value is not a type-only import", () => {
  const r = counts("type_only_import", `
    import { B } from "./b"
    let y: B
    const z = new B()
  `);
  assert.equal(r.candidates, 0, "B is a value here, so import type would break it");
});

test("an `x as Foo` cast still counts as a value read of x", () => {
  const r = counts("type_only_import", `
    import { B } from "./b"
    let t: B
    const z = B as unknown
  `);
  assert.equal(r.candidates, 0);
});

test("a re-exported name is read as a value, so the import is not type-only", () => {
  const r = counts("type_only_import", `
    import { B } from "./b"
    let t: B
    export { B }
  `);
  assert.equal(r.candidates, 0);
});

test("a file with no imports contributes nothing", () => {
  assert.equal(hits("type_only_import", `export const a = 1`).length, 0);
});

// --- import_extension ---

test("a relative import with a source extension conforms and a bare one does not", () => {
  const r = counts("import_extension", `
    import { a } from "./a.mjs"
    import { b } from "./b"
    import { c } from "node:fs"
  `);
  assert.equal(r.candidates, 2, "a bare package specifier is not relative");
  assert.equal(r.conforming, 1);
});

test("a stylesheet import is not an extension choice anyone made", () => {
  const r = counts("import_extension", `import "./styles.scss"`);
  assert.equal(r.candidates, 0);
});

test("a re-export carries the same extension choice as an import", () => {
  const r = counts("import_extension", `
    export { a } from "./a"
    export * from "./b.mjs"
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 1 });
});

test("a bundler query is not part of the file name", () => {
  assert.deepEqual(counts("import_extension", `import a from "./a.js?raw"`), {
    candidates: 1,
    conforming: 1,
  });
  assert.equal(hits("import_extension", `import "./icon.svg?react"`).length, 0);
});

test("a directory specifier has no name to carry an extension", () => {
  assert.equal(hits("import_extension", `import a from "./dir/"`).length, 0);
  assert.equal(hits("import_extension", `import a from ".."`).length, 0);
});

test("a file with no relative imports contributes nothing", () => {
  assert.equal(hits("import_extension", `import { a } from "react"`).length, 0);
});

// --- nullish_default ---

test("a literal default taken with ?? conforms and with || does not", () => {
  const r = counts("nullish_default", `
    const a = x ?? 0
    const b = y || "fallback"
    const c = z || []
  `);
  assert.equal(r.candidates, 3);
  assert.equal(r.conforming, 1);
});

test("a fallback to a call is not a default value", () => {
  const r = counts("nullish_default", `const a = x || compute()`);
  assert.equal(r.candidates, 0, "the two operators are not interchangeable there");
});

test("a file with no logical defaults contributes nothing", () => {
  assert.equal(hits("nullish_default", `const a = x && y`).length, 0);
});

// --- non_null_assertion ---

test("an optional read conforms and a non-null assertion does not", () => {
  const r = counts("non_null_assertion", `
    const a = user?.name
    const b = user!.name
  `);
  assert.equal(r.candidates, 2);
  assert.equal(r.conforming, 1);
});

test("a plain member read is neither form", () => {
  assert.equal(hits("non_null_assertion", `const a = user.name`).length, 0);
});

// --- absent_is_null ---

test("returning null conforms and returning undefined does not", () => {
  // `c` is a guard clause, not a third answer to the question: a bare `return`
  // says "stop here", and counting it built the opposite convention out of
  // early returns.
  const r = counts("absent_is_null", `
    function a(x) { if (!x) return null; return x }
    function b(x) { if (!x) return undefined; return x }
    function c(x) { if (!x) return; return x }
  `);
  assert.equal(r.candidates, 2);
  assert.equal(r.conforming, 1);
});

test("a bare return in a function that returns no values is control flow", () => {
  const r = counts("absent_is_null", `function a(x) { if (!x) return; log(x) }`);
  assert.equal(r.candidates, 0);
});

test("an arrow with an expression body returning null still counts", () => {
  const r = counts("absent_is_null", `const a = () => null`);
  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

test("a return inside a method is reported under the method name", () => {
  const h = hits("absent_is_null", `class K { m(x) { if (!x) return undefined; return x } }`);
  assert.deepEqual(h.map((x) => [x.where, x.conforming]), [["m", false]]);
});

test("a value returned by a nested callback does not make the outer function value-returning", () => {
  const r = counts(
    "absent_is_null",
    `function outer(x) { items.map((i) => { return 1 }); if (!x) return; log(x) }`
  );
  assert.equal(r.candidates, 0, "the outer bare return is still control flow");
});

test("a file whose functions always return a value contributes nothing", () => {
  assert.equal(hits("absent_is_null", `function a() { return 1 }`).length, 0);
});

// --- iterate_with_for_of ---

test("for...of conforms and .forEach does not", () => {
  const r = counts("iterate_with_for_of", `
    for (const x of items) use(x)
    items.forEach((x) => use(x))
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 1 });
});

test("a bare forEach identifier call is not an iteration over a collection", () => {
  assert.equal(hits("iterate_with_for_of", `forEach(items, use)`).length, 0);
});

test("a file that iterates nothing contributes nothing", () => {
  assert.equal(hits("iterate_with_for_of", `const a = items.map((x) => x)`).length, 0);
});

// --- test_call_style ---

test("test() conforms, it() does not, and the modifier form counts the same", () => {
  const r = counts("test_call_style", `
    test("a", () => {})
    it("b", () => {})
    test.each([1])("c", () => {})
  `);
  assert.equal(r.candidates, 3);
  assert.equal(r.conforming, 2);
});

test("a regex .test call is not a test case", () => {
  assert.equal(hits("test_call_style", `if (pattern.test(name)) run()`).length, 0);
});

test("a file with no test cases contributes nothing", () => {
  assert.equal(hits("test_call_style", `export const a = 1`).length, 0);
});

// --- assertion_style ---

test("expect() conforms and assert does not, in either of its call shapes", () => {
  const r = counts("assertion_style", `
    expect(a).toBe(1)
    assert.equal(a, 1)
    assert(a)
  `);
  assert.equal(r.candidates, 3);
  assert.equal(r.conforming, 1);
});

test("a file with no assertions contributes nothing", () => {
  assert.equal(hits("assertion_style", `export const a = 1`).length, 0);
});

// --- the shape every dimension has to satisfy ---

test("every extra dimension declares its precision and a readable claim", () => {
  for (const d of EXTRA_DIMENSIONS) {
    assert.ok(["precise", "partial"].includes(d.precision), d.key);
    assert.ok(d.claim && d.claim.length > 10, `${d.key} needs a readable claim`);
    assert.ok(d.langs.length > 0 && typeof d.run === "function", d.key);
  }
});

// check.mjs slices the parsed source with node.start/node.end and fingerprints
// on node.type, so a hit missing any of the three reports a violation with no
// text and an unstable identity.
test("every hit carries a typed node with offsets into the parsed source", () => {
  const src = `
    import type { A } from "./a.ts"
    import { B } from "./b"
    export const handler = (x: A) => {
      const name = x!.name || "anon"
      items.forEach((i) => i)
      for (const i of items) use(i)
      if (!name) return undefined
      return name ?? null
    }
    test("a", () => { expect(1).toBe(1); assert.ok(1) })
    it("b", () => {})
    const legacy = function () { return null }
  `;
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  for (const d of EXTRA_DIMENSIONS) {
    const out = [];
    d.run(program, (h) => out.push(h));
    assert.ok(out.length > 0, `${d.key} matched nothing, so it proves nothing here`);
    for (const h of out) {
      assert.equal(typeof h.conforming, "boolean", d.key);
      assert.ok(h.node && typeof h.node.type === "string", `${d.key} hit carries no node`);
      assert.equal(typeof h.node.start, "number", `${d.key} node has no start offset`);
      assert.equal(typeof h.node.end, "number", `${d.key} node has no end offset`);
      assert.ok(h.where === null || typeof h.where === "string", `${d.key} where`);
    }
  }
});

test("keys are unique, so a reducer can key counts by them", () => {
  const keys = EXTRA_DIMENSIONS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("language selection returns only dimensions claiming that language", () => {
  // Through the one registry the product selects with. A second selector here
  // would let this file pass while the scan picked a different set.
  const ruby = dimensionsFor(["ruby"]).map((d) => d.key);
  for (const d of EXTRA_DIMENSIONS) assert.ok(!ruby.includes(d.key), `${d.key} is a JS or TS claim`);

  const js = dimensionsFor(["js"]).map((d) => d.key);
  for (const d of EXTRA_DIMENSIONS) assert.ok(js.includes(d.key), `${d.key} is selected for js`);
});

test("an area with no languages selects nothing", () => {
  assert.deepEqual(dimensionsFor([]), []);
});

test("a dimension whose inverse loses a capability may not state that inverse", () => {
  // `.forEach` cannot await, cannot break, and cannot return from the enclosing
  // function. One direction is strictly more capable, which is the same shape
  // the registry already refuses on `nullish_default`. Granted, an area of
  // async workers states "iterated with .forEach" and the check then asks for
  // an await loop to be rewritten into the classic bug: the work is not waited
  // on, order is lost, and a throw becomes an unhandled rejection.
  const byKey = Object.fromEntries(ALL_DIMENSIONS.map((d) => [d.key, d]));
  for (const key of ["iterate_with_for_of", "nullish_default", "non_null_assertion"]) {
    assert.equal(byKey[key].counterClaim, null, `${key} must not state its inverse`);
  }
});

test("a bare return is control flow, not a decision about absent values", () => {
  // A guard clause says "stop here", not "an absent value is undefined". Counted
  // as a candidate it builds the opposite convention out of early returns, and
  // on the claim side it would tell an agent to `return null` from a useEffect,
  // which React forbids.
  const guard = hits("absent_is_null", `
    export function find(id) {
      if (!id) return
      if (id < 0) return
      return null
    }
  `);
  assert.equal(guard.length, 1, "only the explicit `return null` is a candidate");
  assert.equal(guard[0].conforming, true);

  const explicit = hits("absent_is_null", `
    export function pick(x) {
      if (!x) return undefined
      return null
    }
  `);
  assert.equal(explicit.length, 2, "an explicit `return undefined` is still a decision");
  assert.equal(explicit.filter((h) => h.conforming).length, 1);
});

test("a cast does not hide the value it wraps", () => {
  // `null as any` is null. The walkers matched on the node type of the returned
  // expression, so a cast around it made the site disappear: react writes
  // `return null as any` 24 times and vscode 20, and every one of them was a
  // conforming site nobody counted. `satisfies` and `!` wrap the same way.
  assert.deepEqual(counts("absent_is_null", "function f() { return null }"), { candidates: 1, conforming: 1 });

  for (const cast of ["null as any", "null satisfies any", "null!", "(null as any)"]) {
    assert.deepEqual(
      counts("absent_is_null", `function f() { return ${cast} }`),
      { candidates: 1, conforming: 1 },
      `return ${cast}`
    );
  }
  for (const cast of ["undefined as any", "undefined satisfies any", "undefined!"]) {
    assert.deepEqual(
      counts("absent_is_null", `function f() { return ${cast} }`),
      { candidates: 1, conforming: 0 },
      `return ${cast}`
    );
  }
  // An expression body is the same choice written the other way.
  assert.deepEqual(counts("absent_is_null", "const f = () => null as any"), { candidates: 1, conforming: 1 });
});

test("a cast does not hide that the right side of a default is a literal", () => {
  // `x ?? ([] as Foo[])` takes a default, and typing the empty array is the
  // ordinary way to write it. Matching on the node type dropped the site.
  assert.deepEqual(counts("nullish_default", "const a = x ?? []"), { candidates: 1, conforming: 1 });

  for (const right of ["[] as Foo[]", "([] as Foo[])", "0 satisfies number", "1!"]) {
    assert.deepEqual(
      counts("nullish_default", `const a = x ?? ${right}`),
      { candidates: 1, conforming: 1 },
      `?? ${right}`
    );
    assert.deepEqual(
      counts("nullish_default", `const a = x || ${right}`),
      { candidates: 1, conforming: 0 },
      `|| ${right}`
    );
  }
  // A call is still a fallback branch, cast or not: the two operators are not
  // interchangeable there and it is not a site.
  assert.deepEqual(counts("nullish_default", "const a = x ?? b() as Foo"), { candidates: 0, conforming: 0 });
});

test("peeling a cast does not blind the dimension whose site is the cast", () => {
  // `!` is what non_null_assertion counts. Unwrapping it everywhere would erase
  // its own sites, so it reads the node before anything peels it.
  assert.deepEqual(counts("non_null_assertion", "const a = x!.y"), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("non_null_assertion", "const a = x?.y"), { candidates: 1, conforming: 1 });
});
