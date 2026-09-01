import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import { EXTRA_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-extra.mjs";
import { dimensionsFor, ALL_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions.mjs";

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

// introduced.mjs slices the parsed source with node.start/node.end and keys the
// identity on node.type, so a hit missing any of the three reports a site with
// no text and an unstable identity.
test("every hit carries a typed node with offsets into the parsed source", () => {
  const src = `
    import type { A } from "./a.ts"
    import { B } from "./b"
    export const useThing = () => 1
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

// --- doc_comment_style ---

const docHits = (src) => {
  const { program, comments } = parseSync("f.tsx", src, { sourceType: "module" });
  const out = [];
  dim("doc_comment_style").run(program, (h) => out.push(h), { comments, source: src });
  return out;
};

test("an exported declaration with a comment directly above conforms", () => {
  const h = docHits(`/** doc */\nexport function a() {}\nexport function b() {}`);
  assert.equal(h.length, 2);
  assert.equal(h.filter((x) => x.conforming).length, 1);
});

test("a line comment and a blank line still attach", () => {
  const h = docHits(`// what b is for\n\nexport const b = () => {}`);
  assert.deepEqual(h.map((x) => x.conforming), [true]);
});

test("every exported form is a site: function, class, const function, default", () => {
  const h = docHits(`
    export function a() {}
    export class B {}
    export const c = () => {}
    export default function d() {}
  `);
  assert.equal(h.length, 4);
});

test("an unexported function and an exported plain value are not sites", () => {
  const h = docHits(`function a() {}\nexport const limit = 3;`);
  assert.equal(h.length, 0);
});

test("a trailing comment on the previous statement does not attach to the next", () => {
  const h = docHits(`export function a() {} // about a\nexport function b() {}`);
  assert.deepEqual(h.map((x) => x.conforming), [false, false]);
});

test("collectHits hands the extras through to the dimension", async () => {
  const { collectHits } = await import("../plugins/anatomiya/lib/walk.mjs");
  const probe = {
    key: "probe",
    run(_program, add, extra) {
      add({ conforming: extra?.marker === true });
    },
  };
  const hits = collectHits({ type: "Program", body: [] }, [probe], { marker: true });
  assert.equal(hits.probe[0].conforming, true);
});

/* --- an overload set has no arrow form (#53) --- */

test("an overload set is not a function-style site, because it has no arrow form", () => {
  // Overload signatures attach only to a function declaration, so the finding
  // asked for a form the language does not have. A 280-of-280 area is real:
  // nobody has needed overloads yet, so the first person who does is told their
  // only available syntax is the first violation in the area's history.
  const r = counts("function_style", `
    export function tmpP311(x: string): string;
    export function tmpP311(x: number): number;
    export function tmpP311(x: string | number): string | number { return x }
  `);
  assert.deepEqual(r, { candidates: 0, conforming: 0 });
});

test("a declaration with no signature above it counts exactly as before", () => {
  const r = counts("function_style", `
    function a(x: string): string;
    function a(x: any): any { return x }
    function b() { return 1 }
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 1 }, "only b is a site");
});

test("a signature whose implementation is not the next statement leaves that declaration a site", () => {
  // TS2391 requires the implementation to immediately follow its signatures, so
  // adjacency is the language's own rule rather than an approximation of it.
  const r = counts("function_style", `
    function a(x: string): string;
    const noise = 1
    function a2(x: any): any { return x }
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 1 }, "a2 carries no signatures");
});

/* --- a directive is not documentation (#52) --- */

test("a tool directive above an export is not a doc comment", () => {
  // None of these is documentation. The first silences a lint rule, the second
  // acknowledges a type gap the compiler enforces, the third is a compiler
  // directive. An agent that obeys the finding deletes a directive and breaks
  // the build, or un-silences a rule CI enforces.
  const each = [
    `// eslint-disable-next-line import/prefer-default-export\nexport const a = (): number => 1`,
    `// @ts-expect-error upstream types lag the runtime\nexport const b = (): number => 1`,
    `/// <reference types="node" />\nexport const c = (): number => 1`,
    `/* eslint-disable no-console */\nexport const d = (): number => 1`,
    `// @ts-nocheck\nexport const e = (): number => 1`,
    `// #region helpers\nexport const f = (): number => 1`,
    `// prettier-ignore\nexport const g = (): number => 1`,
    `/* istanbul ignore next */\nexport const h = (): number => 1`,
  ];

  for (const src of each) {
    assert.deepEqual(docHits(src).map((x) => x.conforming), [false], src.split("\n")[0]);
  }
});

test("a real doc comment above a directive still documents the export", () => {
  // The run is walked upward through the directives it steps over, or a doc
  // comment sitting above an `eslint-disable-next-line` would stop attaching.
  const h = docHits(`/** what a does */\n// eslint-disable-next-line no-console\nexport const a = (): number => 1`);
  assert.deepEqual(h.map((x) => x.conforming), [true]);
});

test("a directive above a doc comment leaves the doc comment attached", () => {
  const h = docHits(`// eslint-disable-next-line no-console\n/** what a does */\nexport const a = (): number => 1`);
  assert.deepEqual(h.map((x) => x.conforming), [true]);
});

test("commented-out code still counts as a doc comment", () => {
  // Harder to recognise than a directive, and the issue leaves it counted.
  const h = docHits(`// export function fake() {}\nexport const a = (): number => 1`);
  assert.deepEqual(h.map((x) => x.conforming), [true]);
});

test("a trailing comment on another statement does not document the export below it", () => {
  const h = docHits(`const x = 1 // note\nexport const a = (): number => 1`);
  assert.deepEqual(h.map((x) => x.conforming), [false]);
});

/* --- an assertion with no ?. form is not a site (#77 row 1) --- */

test("an assertion with no member read or call after it has no ?. form", () => {
  // `x?` is TS1109: Expression expected. There is no optional form of a bare
  // assertion, so the finding asks for something the language does not have.
  assert.equal(hits("non_null_assertion", `export function f(x?: string) { return x! }`).length, 0);
  assert.equal(hits("non_null_assertion", `export function f(x?: any) { g(x!) }`).length, 0);
});

test("an assertion in a position the grammar refuses an optional chain is not a site", () => {
  // `?.` is illegal on an assignment target (TS2779) and in a `new` callee
  // ("Invalid optional chain from new expression").
  for (const src of [
    `export function g(o?: any) { o!.r = 3 }`,
    `export function g(o?: any) { o!.a.b = 3 }`,
    `export function g(o?: any) { o!.r += 1 }`,
    `export function g(o?: any) { o!.r++ }`,
    `export function h(m?: any) { return new m!.C() }`,
    `export function h(m?: any) { return new m!() }`,
    `export function h(o?: any) { [o!.y] = [2] }`,
    `export function h(o?: any, q?: any) { ({ a: o!.x } = q) }`,
    "export function h(q?: any) { q!.tag`s` }",
    `export function h(o?: any, xs?: any) { for (o!.a of xs) {} }`,
  ]) {
    assert.equal(hits("non_null_assertion", src).length, 0, src);
  }
});

test("every shape ?. really replaces is still a site", () => {
  for (const src of [
    `export function f(o?: any) { return o!.r }`,
    `export function f(o?: any, i = 0) { return o![i] }`,
    `export function f(o?: any) { return o!() }`,
    `export function f(o?: any) { return o!.a.b }`,
    `export function f(o?: any) { const x = { a: o!.r }; return x }`,
    `export function f(o?: any) { delete o!.r }`,
  ]) {
    assert.deepEqual(counts("non_null_assertion", src), { candidates: 1, conforming: 0 }, src);
  }
});

/* --- a component read as JSX is a value read (#77 row 4) --- */

test("a component read as a JSX element is a value read, not a type-only import", () => {
  // `valueReads` matches Identifier and a JSX element name is a JSXIdentifier,
  // so a component used in JSX plus once in a type position read as type-only.
  // Obeying gives TS1361: cannot be used as a value because it was imported
  // using import type.
  for (const src of [
    `import { Button } from "./b";\ntype P = { b: Button };\nexport const X = (p: P) => <Button {...p} />`,
    `import { Menu } from "./m";\ntype P = { m: Menu };\nexport const X = (p: P) => <Menu.Item {...p} />`,
    `import { Box } from "./b";\ntype P = Box;\nexport const X = (p: P) => <Box>hi</Box>`,
  ]) {
    assert.equal(hits("type_only_import", src).length, 0, src);
  }
});

test("an attribute name spelling an imported type is not a value read", () => {
  assert.deepEqual(
    counts(
      "type_only_import",
      `import { className } from "./c";\nexport const f = (x: className) => <div className="a">{String(x)}</div>`
    ),
    { candidates: 1, conforming: 0 }
  );
});

/* --- a mixed chain cannot be flipped one operator at a time (#77 row 5) --- */

test("an unparenthesised mixed chain cannot be flipped one operator at a time", () => {
  // `a || b ?? {}` is TS5076: '||' and '??' operations cannot be mixed without
  // parentheses, and adding them changes the expression. This is the one live
  // row of the nine that is `precise` and can reach MUST-FIX.
  assert.equal(hits("nullish_default", `const x = a || b || {}`).length, 0, "the left mixes");
  assert.equal(hits("nullish_default", `const x = a && b || {}`).length, 0, "the left mixes");
  assert.equal(hits("nullish_default", `const x = a || {} || b`).length, 0, "the parent mixes");
});

test("a chain somebody already bracketed is still a site", () => {
  assert.deepEqual(counts("nullish_default", `const q = (a || b) ?? {}`), { candidates: 1, conforming: 1 });
  assert.deepEqual(counts("nullish_default", `const r = a ?? (b || {})`), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("nullish_default", `const s = a || 0`), { candidates: 1, conforming: 0 });
});

/* --- a function that cannot return a value has no other side to choose (#77 row 6) --- */

test("a void annotation is left counted, and the reason is written down", () => {
  // `return null` under a void annotation is TS2322, so this site cannot
  // conform. It is still counted on purpose: the annotation is exactly what the
  // Flow retry blanks, so a rule reading it would answer differently on a
  // stripped tree than on the same file unstripped, and a stripped base beside
  // an unstripped head would cancel real findings. The row is `partial`, so it
  // is capped at FIX either way.
  assert.equal(hits("absent_is_null", `function reset(): void { if (a) return; return undefined }`).length, 1);
  const blind = EXTRA_DIMENSIONS.find((d) => d.key === "absent_is_null").applicabilityPredicate.blind;
  assert.match(blind, /void/, blind);
});

test("a React effect may not return null, so its undefined is not the other side", () => {
  // React's own words: "You returned null. If your effect does not require
  // clean up, return undefined."
  for (const hook of ["useEffect", "useLayoutEffect", "useInsertionEffect"]) {
    const src = `const C = () => { ${hook}(() => { if (a) return cleanup; return undefined }, []) }`;
    assert.equal(hits("absent_is_null", src).length, 0, src);
    const dotted = `const C = () => { React.${hook}(() => { if (a) return cleanup; return undefined }, []) }`;
    assert.equal(hits("absent_is_null", dotted).length, 0, dotted);
  }
});

test("an effect callback is not a site on either side of the choice", () => {
  // The exclusion guarded the `undefined` arms only, so a `return null` in an
  // effect landed in the conforming numerator of a row whose own published
  // predicate says an effect callback is not a site at all. React refuses null
  // there, which is the reason the sentence gives, and it argues for both arms.
  for (const body of ["return null", "return undefined", "return"]) {
    const src = `const C = () => { useEffect(() => { ${body} }, []) }`;
    assert.deepEqual(counts("absent_is_null", src), { candidates: 0, conforming: 0 }, src);
  }
  assert.deepEqual(counts("absent_is_null", `const C = () => { useEffect(() => null, []) }`), {
    candidates: 0,
    conforming: 0,
  });
});

test("an ordinary callback that returns a value and an undefined is still judged", () => {
  const src = `const C = () => { onThing(() => { if (a) return cleanup; return undefined }, []) }`;
  assert.deepEqual(counts("absent_is_null", src), { candidates: 1, conforming: 0 });
});

// --- hook_per_module ---

test("a module exporting two hooks is a violation, reported at the second", () => {
  // The site is the module, but the node reported is never the Program: the
  // check fingerprints a finding off the node's own text, so a Program node
  // would make that text the whole file and move the fingerprint on every edit
  // anywhere in it.
  const h = hits("hook_per_module", `
    export const useListings = () => 1
    export function useOwners() { return 2 }
  `);

  assert.equal(h.length, 1);
  assert.equal(h[0].conforming, false);
  assert.equal(h[0].where, "useOwners");
  assert.equal(h[0].node.type, "Identifier");
});

test("a module exporting one hook conforms, and one exporting none is not a site", () => {
  assert.deepEqual(counts("hook_per_module", `export const useListings = () => 1`), {
    candidates: 1,
    conforming: 1,
  });
  assert.equal(hits("hook_per_module", `export const listings = () => 1`).length, 0);
  assert.equal(hits("hook_per_module", `export const User = () => 1`).length, 0, "a component is not a hook");
});

test("a hook that is not exported is nobody else's to call", () => {
  assert.equal(hits("hook_per_module", `const useLocal = () => 1\nexport const useOne = () => 2`).length, 1);
});

test("a hook declared inside a namespace is ambient scaffolding, not a module export", () => {
  const src = `declare module "x" {\n  export const useA: () => number\n  export const useB: () => number\n}\nexport const useOne = () => 1`;
  const h = hits("hook_per_module", src);

  assert.equal(h.length, 1);
  assert.equal(h[0].conforming, true);
});

test("a mid-chain assertion does not carry a write position past the grammar test", () => {
  // `opts.a!.b = 1` is AssignmentExpression > MemberExpression >
  // TSNonNullExpression > MemberExpression, so a walk that only steps through
  // members and calls stops at the `!` and never sees the assignment. Every
  // remedy is still refused: `o?.a!.b = 1` is "Cannot assign to this expression".
  for (const src of [
    `export function g(o?: any) { o!.a!.b = 3 }`,
    `export function g(o?: any) { (o!.a as any).b = 3 }`,
    `export function h(m?: any) { return new (m!.C)() }`,
  ]) {
    assert.equal(hits("non_null_assertion", src).length, 0, src);
  }
});

test("an overload set inside a namespace or a block is not a function-style site either", () => {
  // `overloadImplementations` read `program.body` alone, and a function inside
  // `namespace N { }` has no enclosing declaration, so it was a module-level
  // site the exclusion could not reach: the only syntax an overload set has,
  // reported at MUST-FIX.
  const inNamespace = `namespace N {
    export function f(a: string): void;
    export function f(a: number): void;
    export function f(a: any): void {}
  }`;
  const inBlock = `if (x) {
    function f(a: string): void;
    function f(a: any): void {}
  }`;

  assert.deepEqual(counts("function_style", inNamespace), { candidates: 0, conforming: 0 });
  assert.deepEqual(counts("function_style", inBlock), { candidates: 0, conforming: 0 });
});

test("one hook written as an overload set is one hook", () => {
  // The signatures and the implementation are three exported declarations of
  // one name, and counting them separately made a single hook a violation of
  // the claim that a module exports one.
  const r = counts("hook_per_module", `
    export function useThing(a: string): number;
    export function useThing(a: number): number;
    export function useThing(a: any): number { return 1 }
  `);

  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

test("every directive spelling the table names is recognised", () => {
  // A closed table is only as true as the members somebody wrote a source for,
  // which is the rule `test/applicability.test.mjs` already holds tables to.
  for (const directive of [
    "// eslint-disable-next-line no-console",
    "/* eslint-disable no-console */",
    "// @ts-expect-error x",
    "// @ts-ignore",
    "// @ts-nocheck",
    "// prettier-ignore",
    "// biome-ignore lint/style/noVar: x",
    "/* istanbul ignore next */",
    "/* c8 ignore next */",
    "/* v8 ignore next */",
    "// #region helpers",
    "// #endregion",
    '/// <reference types="node" />',
  ]) {
    const src = `${directive}\nexport const a = (): number => 1`;
    assert.deepEqual(docHits(src).map((x) => x.conforming), [false], directive);
  }
});

test("a hook declared without a body is still the hook this module exports", () => {
  // `export declare function useThing(): number` is a TSDeclareFunction, and a
  // module that publishes one publishes a hook.
  assert.deepEqual(counts("hook_per_module", `export declare function useThing(): number;`), {
    candidates: 1,
    conforming: 1,
  });
  assert.deepEqual(
    counts("hook_per_module", `export declare function useThing(): number;\nexport const useOther = () => 1`),
    { candidates: 1, conforming: 0 }
  );
});
