import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";

import { walk, collectHits, fromVisitor } from "../plugins/anatomiya/lib/walk.mjs";

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
  assert.deepEqual(collectHits(program, asVisitors, {}, overflows), { program: [{ conforming: false, where: "Program" }] });
});

test("a visitor riding the walk is fed every node without any row, and keeps its own throw", () => {
  let walks = 0;
  const spy = (tree, visit) => {
    walks++;
    walk(tree, visit);
  };
  const types = [];
  const rider = { node: (n) => types.push(n.type) };
  assert.deepEqual(collectHits(program, [], {}, spy, [rider]), {});
  assert.equal(walks, 1);
  const alone = [];
  walk(program, (n) => alone.push(n.type));
  assert.deepEqual(types, alone);
  assert.equal(rider.error, undefined);

  let fed = 0;
  const odd = new Error("an odd node");
  const throwing = { node: () => { if (++fed === 3) throw odd; } };
  assert.deepEqual(collectHits(program, asVisitors, {}, walk, [throwing]), collectHits(program, asRuns));
  assert.equal(throwing.error, odd);
  assert.equal(fed, 3, "fed no more nodes after its throw");

  const overflow = new RangeError("Maximum call stack size exceeded");
  const stranded = { node() {} };
  collectHits(program, [], {}, () => { throw overflow; }, [stranded]);
  assert.equal(stranded.error, overflow);
});

test("one walk serves every visitor row, and none is taken without one", () => {
  let walks = 0;
  const spy = (tree, visit) => {
    walks++;
    walk(tree, visit);
  };
  const many = [1, 2, 3, 4, 5].map((i) => ({ key: `calls${i}`, visitor: calls }));
  const hits = collectHits(program, [...many, { key: "program", run: program1 }], {}, spy);
  assert.equal(walks, 1);
  assert.equal(Object.keys(hits).length, 6);
  for (let i = 1; i <= 5; i++) assert.equal(hits[`calls${i}`].length, hits.calls1.length);

  walks = 0;
  collectHits(program, [{ key: "program", run: program1 }], {}, spy);
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
  const { dimensionsFor } = await import("../plugins/anatomiya/lib/dimensions.mjs");
  await import("../plugins/anatomiya/lib/registry.mjs");
  const rows = dimensionsFor(["js", "jsx"]);
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
  const shared = collectHits(program, rows, extra, frozen);

  assert.deepEqual(shared, alone);
  const visiting = rows.filter((d) => d.visitor).map((d) => d.key);
  const silent = visiting.filter((k) => !shared[k]);
  assert.ok(silent.length <= 3, `the fixture should reach most visitor rows; silent: ${silent.join(", ")}`);
});
