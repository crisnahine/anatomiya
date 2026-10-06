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
  const hits = collectHits(program, [{ key: "late", visitor: throwsLate }, ...asVisitors]);
  assert.deepEqual(hits, collectHits(program, asRuns));
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
