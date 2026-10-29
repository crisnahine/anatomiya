import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";

import { asks, walk, collectHits, FILE_FIELDS, fileContext, fromVisitor, whereOf } from "../plugins/anatomiya/lib/walk.mjs";
import { doublingRatio, LINEAR } from "./growth.mjs";

const { program } = parseSync(
  "f.ts",
  "function a() { b(); c(d); }\nconst e = () => f(g);\nclass H { m() { i(); } }\n",
  { sourceType: "module" }
);

// Two visitors of different shapes: one adds as it walks, the other holds its
// sites until the walk is over, the way a row needing the whole file does.
const calls = (program, add) => ({
  node(n, ctx) {
    if (n.type === "CallExpression") add({ conforming: true, where: ctx.fn ? "fn" : null });
  },
});
const identifiers = (program, add) => {
  const seen = [];
  return {
    node(n) {
      if (n.type === "Identifier") seen.push(n.name);
    },
    done() {
      for (const name of seen) add({ conforming: name < "e", where: name });
    },
  };
};
const program1 = (program, add) => add({ conforming: false, where: program.type });

// The same three rows, each walking for itself.
const asRuns = [
  { key: "calls", run: fromVisitor(calls) },
  { key: "identifiers", run: fromVisitor(identifiers) },
  { key: "program", run: program1 },
];

// Only the visitor: a row carrying both is visited, so a run that answers
// differently would show up as a difference here.
const asVisitors = [
  { key: "calls", visitor: calls, run: () => { throw new Error("visited rows are not run"); } },
  { key: "identifiers", visitor: identifiers },
  { key: "program", run: program1 },
];

test("visitor rows beside a run row produce exactly what three run rows do", () => {
  const expected = collectHits(program, asRuns);
  assert.ok(expected.calls.length > 3 && expected.identifiers.length > 5, "the fixture has sites to compare");
  assert.deepEqual(collectHits(program, asVisitors), expected);
  assert.deepEqual(Object.keys(collectHits(program, asVisitors)), ["calls", "identifiers", "program"]);
});

test("fromVisitor walks the tree itself, in walk order", () => {
  const names = [];
  walk(program, (n) => n.type === "Identifier" && names.push(n.name));
  const out = [];
  fromVisitor(identifiers)(program, (h) => out.push(h.where));
  assert.deepEqual(out, names);
});

test("a visitor that throws on its third node loses its sites and no other row's", () => {
  const throwsLate = (program, add) => {
    let n = 0;
    return {
      node() {
        add({ conforming: true, where: null });
        if (++n === 3) throw new Error("an odd node");
      },
    };
  };
  // Right after the throwing row, so its own call for the node that threw is
  // the one a careless removal from the live list would skip.
  const everyNode = (program, add) => ({
    node(n) {
      add({ conforming: true, where: n.type });
    },
  });
  const hits = collectHits(program, [
    { key: "late", visitor: throwsLate },
    { key: "every", visitor: everyNode },
    ...asVisitors,
  ]);
  assert.deepEqual(hits, collectHits(program, [{ key: "every", run: fromVisitor(everyNode) }, ...asRuns]));
});

test("a throw while making a visitor or in its done costs that row only", () => {
  const throwsMaking = (program, add) => {
    add({ conforming: true, where: null });
    throw new Error("no visitor");
  };
  const throwsDone = (program, add) => ({
    node() {
      add({ conforming: true, where: null });
    },
    done() {
      throw new Error("no answer");
    },
  });
  const hits = collectHits(program, [
    { key: "making", visitor: throwsMaking },
    ...asVisitors,
    { key: "done", visitor: throwsDone },
  ]);
  assert.deepEqual(hits, collectHits(program, asRuns));
});

test("a walk that throws costs the visitor rows their sites, never the run rows or the caller", () => {
  // A recursive walker overflows on a deep enough tree, and the throw comes
  // from the walk itself rather than from any one visitor.
  const overflows = (tree, visit) => {
    let n = 0;
    walk(tree, (node, ctx) => {
      if (++n === 5) throw new RangeError("Maximum call stack size exceeded");
      visit(node, ctx);
    });
  };
  assert.deepEqual(collectHits(program, asVisitors, {}, { walker: overflows }), { program: [{ conforming: false, where: "Program" }] });
});

test("a visitor riding the walk is fed every node without any row, and keeps its own throw", () => {
  let walks = 0;
  const spy = (tree, visit) => {
    walks++;
    walk(tree, visit);
  };
  const types = [];
  let answered = 0;
  const rider = { node: (n) => types.push(n.type), done: () => answered++ };
  assert.deepEqual(collectHits(program, [], {}, { walker: spy, also: [rider] }), {});
  assert.equal(walks, 1);
  assert.equal(answered, 0, "its done is its caller's to call");
  const alone = [];
  walk(program, (n) => alone.push(n.type));
  assert.deepEqual(types, alone);
  assert.equal(rider.error, undefined);

  let fed = 0;
  const odd = new Error("an odd node");
  const throwing = { node: () => { if (++fed === 3) throw odd; } };
  assert.deepEqual(collectHits(program, asVisitors, {}, { also: [throwing] }), collectHits(program, asRuns));
  assert.equal(throwing.error, odd);
  assert.equal(fed, 3, "fed no more nodes after its throw");

  const overflow = new RangeError("Maximum call stack size exceeded");
  const stranded = { node() {} };
  collectHits(program, [], {}, { walker: () => { throw overflow; }, also: [stranded] });
  assert.equal(stranded.error, overflow);
});

test("one walk serves every visitor row, and none is taken without one", () => {
  let walks = 0;
  const spy = (tree, visit) => {
    walks++;
    walk(tree, visit);
  };
  const many = [1, 2, 3, 4, 5].map((i) => ({ key: `calls${i}`, visitor: calls }));
  const hits = collectHits(program, [...many, { key: "program", run: program1 }], {}, { walker: spy });
  assert.equal(walks, 1);
  assert.equal(Object.keys(hits).length, 6);
  for (let i = 1; i <= 5; i++) assert.equal(hits[`calls${i}`].length, hits.calls1.length);

  walks = 0;
  collectHits(program, [{ key: "program", run: program1 }], {}, { walker: spy });
  assert.equal(walks, 0);
});

test("a visitor is handed the extras", () => {
  const probe = (program, add, extra) => ({
    node() {},
    done() {
      add({ conforming: extra.marker === true });
    },
  });
  assert.equal(collectHits(program, [{ key: "probe", visitor: probe }], { marker: true }).probe[0].conforming, true);
});

test("a visitor row that found nothing gets no entry", () => {
  const quiet = () => ({ node() {} });
  assert.deepEqual(collectHits(program, [{ key: "quiet", visitor: quiet }]), {});
});

/* --- every shipped row on the shared walk --- */

const ROWS_SOURCE = `
import React, { useCallback, useState } from "react";
import type { Props } from "./types";
import { Thing, Other } from "./things";
import log from "./logger";
import { get } from "./api-client";
import axios from "axios";
import config from "./config";
const PORT = process.env.PORT || 3000;
let counter = 0;
export function useOne(): number { return counter++; }
export const helper = (opts: Props) => opts.value ?? null;
function overloaded(a: string): string;
function overloaded(a: number): number;
function overloaded(a: any) { return a; }
export async function load(params) {
  try { await fetch(params.url); } catch (e) { log.info(e); throw e; }
  return { ok: true, data: axios.get(config.api.host) };
}
export default function Widget({ items, ...rest }: Props) {
  const [n, setN] = useState(0);
  const onClick = useCallback(() => setN(n + 1), [n]);
  const onHover = () => console.log(n);
  React.useEffect(() => { return undefined; }, []);
  items.forEach((i) => get(i));
  for (const i of items) new Thing(i!.id);
  return <div {...rest} onClick={onClick} onMouseOver={onHover}><Other {...items} />Hello there</div>;
}
export class Base extends React.Component {}
export interface IShape { x: number }
export type TPoint = { x: Other };
test("a case", () => { expect(Widget).toBeDefined(); assert.ok(1); });
`;

test("every JS row answers the same on the shared walk as walking alone, with a frozen ctx", async () => {
  const { ALL_DIMENSIONS } = await import("../plugins/anatomiya/lib/dimensions.mjs");
  const { dimensionsFor } = await import("../plugins/anatomiya/lib/walk.mjs");
  await import("../plugins/anatomiya/lib/registry.mjs");
  const rows = dimensionsFor(["js", "jsx"], { rows: ALL_DIMENSIONS });
  const { program, comments } = parseSync("f.tsx", ROWS_SOURCE, { sourceType: "module" });
  const extra = { comments, source: ROWS_SOURCE, rel: "src/widget.tsx" };

  const alone = collectHits(program, rows.map((d) => ({ key: d.key, run: d.run })), extra);
  // A visitor that writes to the ctx it shares with every other row throws
  // here, and loses its sites. The arrays are frozen copies, since the walk's
  // own are live and a frozen ctx alone still lets a visitor push onto them.
  const frozen = (tree, visit) =>
    walk(tree, (node, ctx) =>
      visit(node, Object.freeze({ ...ctx, stack: Object.freeze([...ctx.stack]), ancestors: Object.freeze([...ctx.ancestors]) }))
    );
  const shared = collectHits(program, rows, extra, { walker: frozen });

  assert.deepEqual(shared, alone);
  const visiting = rows.filter((d) => d.visitor).map((d) => d.key);
  const silent = visiting.filter((k) => !shared[k]);
  assert.ok(silent.length <= 3, `the fixture should reach most visitor rows; silent: ${silent.join(", ")}`);
});

test("a site's name carries the named class around its declaration, and only one around it", () => {
  const names = (src) => {
    const out = [];
    walk(parseSync("a.ts", src, { sourceType: "module" }).program, (n, ctx) => {
      if (n.type === "CatchClause") out.push(whereOf(ctx.enclosing, ctx));
    });
    return out;
  };

  assert.deepEqual(names(`class A { run() { try {} catch {} } }`), ["A.run"]);
  assert.deepEqual(names(`class A { run = () => { try {} catch {} } }`), ["A.run"]);
  assert.deepEqual(names(`class A { run() { function inner() { try {} catch {} } } }`), ["inner"], "only a class's own members carry its name");
  assert.deepEqual(names(`class A { run() { const inner = () => { try {} catch {} } } }`), ["inner"]);
  assert.deepEqual(names(`class A { run = () => { function inner() { try {} catch {} } } }`), ["inner"]);
  assert.deepEqual(names(`function run() { try {} catch {} }`), ["run"]);
  assert.deepEqual(names(`const A = class { run() { try {} catch {} } }`), ["A.run"], "a class expression bound to a name is that name");
  assert.deepEqual(names(`const A = class { static { try {} catch {} } }`), ["A"]);
  assert.deepEqual(names(`list.push(class { run() { try {} catch {} } })`), ["run"], "an unbound class names nothing");
  assert.deepEqual(names(`class A { static { try {} catch {} } }`), ["A"], "the class is the declaration, not its own owner");
  assert.deepEqual(names(`class A { static { function run() { try {} catch {} } } run() { try {} catch {} } }`), ["run", "A.run"], "a function in a static block is not a member");
  assert.deepEqual(names(`class A { api = { run() { try {} catch {} } }; run() { try {} catch {} } }`), ["run", "A.run"], "nor is a method of a field's object literal");
  assert.deepEqual(names(`class A { [k] = class { run() { try {} catch {} } } }`), ["A.run"], "an unnamed class held by a member names its members after the class around it");
  assert.deepEqual(names(`class O { m() { class I { run() { try {} catch {} } } } }`), ["I.run"], "the innermost class");
  assert.deepEqual(names(`function f() { class C {} try {} catch {} }`), ["f"], "a class closed before the site is not around it");
  assert.deepEqual(names(`class A { run() { list.map(() => { try {} catch {} }) } }`), ["A.run"], "an unnamed callback takes the method around it");
  assert.deepEqual(names(`function run() { go().then(function () { try {} catch {} }) }`), ["run"]);
  assert.deepEqual(names(`list.forEach(() => { try {} catch {} })`), [null], "a callback with nothing named around it names nothing");
});

test("a method of an object literal bound to a name carries that name, through a call and a nested object", () => {
  const names = (src) => {
    const out = [];
    walk(parseSync("a.ts", src, { sourceType: "module" }).program, (n, ctx) => {
      if (n.type === "CatchClause") out.push(whereOf(ctx.enclosing, ctx));
    });
    return out;
  };

  assert.deepEqual(names(`const api = { run() { try {} catch {} } }`), ["api.run"]);
  assert.deepEqual(names(`export const api = { run: () => { try {} catch {} } }`), ["api.run"]);
  assert.deepEqual(names(`const api = { run() { list.forEach(() => { try {} catch {} }) } }`), ["api.run"]);
  assert.deepEqual(names(`const C = defineComponent({ methods: { run() { try {} catch {} } } })`), ["C.run"]);
  assert.deepEqual(names(`export default { methods: { run() { try {} catch {} } } }`), ["run"], "no binding, the method's own name");
  assert.deepEqual(names(`export default defineComponent({ methods: { run() { try {} catch {} } } })`), ["run"]);
  assert.deepEqual(names(`const api = ({ run() { try {} catch {} } }) as const`), ["api.run"]);
  assert.deepEqual(names(`const api = { run() { try {} catch {} } } satisfies Api`), ["api.run"]);
  assert.deepEqual(names(`const api = { [run]() { try {} catch {} } }`), [null], "a computed key names nothing");
  assert.deepEqual(names(`const api = { run }; function run() { try {} catch {} }`), ["run"]);
  assert.deepEqual(names(`const api = { run() { try {} catch {} } }.run`), ["run"], "a member read off the literal is not the literal");
  assert.deepEqual(names(`const go = ({ run() { try {} catch {} } }).run()`), ["run"], "nor is a call on it");
  assert.deepEqual(names(`const run = () => { try {} catch {} }`), ["run"], "a function bound directly is its own name");
  assert.deepEqual(names(`class A { m() { const api = { run() { try {} catch {} } } } }`), ["api.run"], "the innermost owner");
  assert.deepEqual(names(`const api = make(() => ({ run() { try {} catch {} } }))`), ["run"], "a function between them breaks the binding");
  assert.deepEqual(names(`const vm = new Vue({ methods: { run() { try {} catch {} } } })`), ["vm.run"]);
  assert.deepEqual(names(`const api = await make({ run() { try {} catch {} } })`), ["api.run"]);
  assert.deepEqual(names(`const api = cond ? { run() { try {} catch {} } } : null`), ["api.run"], "through a conditional, as through a call");
  assert.deepEqual(names(`const api = base || { run() { try {} catch {} } }`), ["api.run"]);
  assert.deepEqual(names(`const api = base ?? { run() { try {} catch {} } }`), ["api.run"]);
  assert.deepEqual(names(`const api = ok && { run() { try {} catch {} } }`), ["api.run"]);
});

test("a site's name costs the same at any depth of nested callbacks", () => {
  const read = (n) => {
    const src = "class A { run() {\n" + "g(() => { try {} catch {}\n".repeat(n) + "})".repeat(n) + "\n} }\n";
    const { program } = parseSync("a.ts", src, { sourceType: "module" });
    return () => {
      let named = 0;
      walk(program, (node, ctx) => {
        if (node.type === "CatchClause" && whereOf(ctx.enclosing, ctx) === "A.run") named++;
      });
      assert.equal(named, n);
    };
  };
  const ratio = doublingRatio(read, 600);
  assert.ok(ratio < LINEAR, `twice the depth took ${ratio.toFixed(2)} times as long`);
});

test("a site's name costs the same at any depth of every nesting shape", () => {
  // Each shape: its source, the function type counted, the name each one gets, and how many per level.
  const shapes = {
    alternating: [(n) => "const f = () => { g(() => {\n".repeat(n) + "}) }".repeat(n) + "\n", "ArrowFunctionExpression", "f", 2],
    named: [(n) => "function f() {\n".repeat(n) + "}".repeat(n) + "\n", "FunctionDeclaration", "f", 1],
    classes: [(n) => "export default " + "class extends B { m() { return 0,\n".repeat(n) + "1" + " } }".repeat(n) + ";\n", "FunctionExpression", "m", 1],
    objects: [(n) => "const api = " + "{ m() {}, c:\n".repeat(n) + "1" + "}".repeat(n) + ";\n", "FunctionExpression", "api.m", 1],
    calls: [(n) => "const api = " + "make({ m() {}, c:\n".repeat(n) + "1" + "})".repeat(n) + ";\n", "FunctionExpression", "api.m", 1],
  };
  for (const [shape, [source, type, name, per]] of Object.entries(shapes)) {
    const read = (n) => {
      const { program, errors } = parseSync("a.ts", source(n), { sourceType: "module" });
      assert.deepEqual(errors, [], shape);
      return () => {
        let named = 0;
        walk(program, (node, ctx) => {
          if (node.type === type && whereOf(node, ctx) === name) named++;
        });
        assert.equal(named, per * n, shape);
      };
    };
    // `alternating` nests two functions a level, and the parser's own stack ends short of 2,000 of its levels on macOS.
    const ratio = doublingRatio(read, 600);
    assert.ok(ratio < LINEAR, `${shape}: twice the depth took ${ratio.toFixed(2)} times as long`);
  }
});

test("a static and an instance method of one name are one place, which is rare enough to leave", () => {
  const out = [];
  const src = `class A { static run() { try {} catch {} } run() { try {} catch {} } }`;
  walk(parseSync("a.ts", src, { sourceType: "module" }).program, (n, ctx) => {
    if (n.type === "CatchClause") out.push(whereOf(ctx.enclosing, ctx));
  });
  assert.deepEqual(out, ["A.run", "A.run"]);
});

test("a row is asked of a file in a language it speaks, unless the strip blinded it or the file cannot carry a type", () => {
  const plain = { langs: ["js", "vue"] };
  const blind = { langs: ["js"], blindWhenStripped: true };
  const typed = { langs: ["js"], needsTypeSyntax: true };
  const jsx = { langs: ["jsx"] };
  const cases = [
    [plain, { lang: "js", rel: "a.js" }, true],
    [plain, { lang: "vue", rel: "a.vue" }, true],
    [plain, { lang: "ruby", rel: "a.rb" }, false],
    [jsx, { lang: "js", rel: "a.js", facets: { jsx: true } }, true],
    [jsx, { lang: "js", rel: "a.js", facets: { jsx: false } }, false],
    [blind, { lang: "js", rel: "a.js", stripped: true }, false],
    [blind, { lang: "js", rel: "a.js", stripped: false }, true],
    [typed, { lang: "js", rel: "a.js" }, false],
    [typed, { lang: "js", rel: "a.ts" }, true],
    [typed, { lang: "js", rel: "a.js", facets: { typed: true } }, true],
  ];
  for (const [row, file, want] of cases) assert.equal(asks(row, file), want, JSON.stringify([row, file]));
});

test("a field a row emits that the boundary does not carry reaches neither the fold nor the check", () => {
  const row = { key: "probe", run: (tree, add) => add({ conforming: 1, novel: "x", node: tree }) };
  assert.deepEqual(collectHits(program, [row]).probe, [{ conforming: true, where: null }]);
  assert.deepEqual(collectHits(program, [row], {}, { keepNode: true }).probe, [{ conforming: true, where: null, node: program }]);
});

test("every bridge hands a row one file context, every field present and null where the bridge has none", () => {
  assert.deepEqual(fileContext({ rel: "a.rb", lang: "ruby" }), { rel: "a.rb", lang: "ruby", source: null, comments: [], facets: null });
  assert.deepEqual(Object.keys(fileContext({ rel: "a.ts", lang: "js", source: "x", comments: [], facets: { empty: true } })), FILE_FIELDS);
});

test("a row declaring outsideTests is handed no node of a test file, and the file stays eligible", () => {
  const { program } = parseSync("a.js", "export const a = 1;\n", { sourceType: "module" });
  const row = (over = {}) => ({ key: "r", outsideTests: true, run: (_program, add) => add({ conforming: true, where: "a" }), ...over });
  const at = (rel, dim) => collectHits(program, [dim], fileContext({ rel, lang: "js" }));
  assert.deepEqual(at("src/a.js", row()), { r: [{ conforming: true, where: "a" }] });
  assert.deepEqual(at("src/a.test.js", row()), {}, "a test by its name");
  assert.deepEqual(at("src/__tests__/a.js", row()), {}, "a test by its directory, the one address `isTestFile` reads without a parse");
  assert.deepEqual(at("test/fixtures/a.js", row()), { r: [{ conforming: true, where: "a" }] }, "a support file under a test tree is read as source");
  assert.deepEqual(at("test/fixtures/a.js", row({ outsideTestTrees: true })), {}, "unless the row keeps off the whole tree");
  assert.deepEqual(collectHits(program, [row()], fileContext({ rel: "src/a.test.js", lang: null })), { r: [{ conforming: true, where: "a" }] }, "no language, no rule");
});
