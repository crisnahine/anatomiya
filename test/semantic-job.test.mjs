// test/semantic-job.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./ts-repo.mjs";
import { loadTypeScript } from "../plugins/anatomiya/lib/semantic.mjs";
import { measureResolution, runJob } from "../plugins/anatomiya/lib/semantic-job.mjs";

const loaded = await loadTypeScript();
const needsTs = { skip: loaded ? false : "typescript is not installed" };

/** Every message the job sent, in order. */
async function sent(job, opts) {
  const out = [];
  await runJob(job, (m) => out.push(m), opts);
  return out;
}

/** The last answer the job gave for each file, which is the one a reader keeps. */
const answered = (out) => Object.fromEntries(out.filter((m) => m.rel).map((m) => [m.rel, m.hits]));

const config = `{"compilerOptions":{"strict":true}}`;

test("a checker that is not installed is one message, and the job ends there", async () => {
  // Ungated: the loader is handed in, so this runs where typescript is absent.
  assert.deepEqual(await sent({ root: "/nowhere", files: [] }, { load: async () => null }), [
    { error: "typescript is not installed" },
  ]);
});

test("the job answers built, each file's sites, each file's hits and done, in that order", needsTs, async () => {
  const dir = repo({
    "tsconfig.json": config,
    "a.ts": `export class B { v() { return 1 } }\nexport class A { b = new B(); go() { return this.b.v() } }`,
  });
  try {
    const out = await sent({ root: dir, files: [{ rel: "a.ts", abs: join(dir, "a.ts") }] });
    assert.deepEqual(out.map((m) => Object.keys(m)[0]), ["built", "rel", "sited", "rel", "done"]);
    assert.equal(out[0].config.status, "ok");
    assert.equal(out[1].rel, "a.ts");
    assert.deepEqual(out[1].resolution, { resolved: 2, total: 2 });
    assert.ok(out[1].hits && typeof out[1].hits === "object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file is answered with the one type-checked row there is", needsTs, async () => {
  const dir = repo({ "tsconfig.json": config, "a.ts": `export const x = " a ".trim().toLowerCase();` });
  try {
    const out = await sent({ root: dir, files: [{ rel: "a.ts", abs: join(dir, "a.ts") }] });
    assert.deepEqual(Object.keys(answered(out)["a.ts"]), ["law_of_demeter"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolution counts every property access and credits only the typed ones", needsTs, async () => {
  // `x.a` and `x.a.b` read off `any`; the two off a string literal resolve.
  // A file the program never had is skipped, not counted as unresolved.
  const dir = repo({ "tsconfig.json": config, "a.ts": `declare const x: any;\nexport const y = x.a.b;\nexport const z = " a ".trim().length;` });
  try {
    const { ts } = loaded;
    const program = ts.createProgram({ rootNames: [join(dir, "a.ts")], options: { strict: true } });
    const files = [{ rel: "a.ts", abs: join(dir, "a.ts") }, { rel: "gone.ts", abs: join(dir, "gone.ts") }];
    assert.deepEqual(measureResolution(ts, program, program.getTypeChecker(), files), { resolved: 2, total: 4 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each file carries its own resolution, so the reader can take the rate over the files it counts", needsTs, async () => {
  // A minified bundle in no area pulled a repository whose own code resolved
  // fully down to 3% and read as low-resolution. It still lends its types to
  // the program; the scan leaves it out of the sum.
  const dir = repo({
    "tsconfig.json": config,
    "a.ts": `export const x = " a ".trim().toLowerCase();`,
    "game.min.js": `function f(a,b){return a.x.y+b.z}function g(a,b){return a.x.y+b.z}`,
  });
  try {
    const files = [{ rel: "a.ts", abs: join(dir, "a.ts") }, { rel: "game.min.js", abs: join(dir, "game.min.js") }];
    const byRel = Object.fromEntries((await sent({ root: dir, files })).filter((m) => m.rel).map((m) => [m.rel, m.resolution]));
    assert.deepEqual(byRel, { "a.ts": { resolved: 2, total: 2 }, "game.min.js": { resolved: 0, total: 6 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("whatever the job throws on is one error message, not a dead channel", needsTs, async () => {
  const out = await sent({ root: "/nowhere", files: null });
  assert.equal(out.length, 1);
  assert.match(out[0].error, /null/);
});

test("a .js file handed to the job is held by the program whatever the tsconfig says", needsTs, async () => {
  // The scan hands the checker every js and jsx file, and law_of_demeter's
  // denominator counts them all, but without allowJs the program never held a
  // .js file: a repository of six .ts and six .js files measured applicability
  // 6 over a langFileCount of 12, so the row read as narrow on files it never
  // looked at. Held, not checked: checkJs stays off, so a .js file is read
  // for its types and never charged a diagnostic.
  const dir = repo({
    "tsconfig.json": config,
    "a.ts": `export const x = " a ".trim().toLowerCase();`,
    "b.js": `export const y = " b ".trim().toLowerCase();`,
  });
  try {
    const files = [{ rel: "a.ts", abs: join(dir, "a.ts") }, { rel: "b.js", abs: join(dir, "b.js") }];
    const out = await sent({ root: dir, files });
    assert.deepEqual(Object.keys(answered(out)), ["a.ts", "b.js"]);
    const b = out.findLast((m) => m.rel === "b.js");
    assert.deepEqual(Object.keys(b.hits), ["law_of_demeter"]);
    assert.deepEqual(b.resolution, { resolved: 2, total: 2 }, "the .js file's accesses are measured too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A typescript whose checker throws when a row asks it to print a type, which the resolution walk never does. */
const throwingOnTypeNames = async () => ({
  ts: {
    ...loaded.ts,
    createProgram(given) {
      const program = loaded.ts.createProgram(given);
      const checker = Object.create(program.getTypeChecker(), {
        typeToString: { value: () => { throw new Error("no name for this type"); } },
      });
      return Object.create(program, { getTypeChecker: { value: () => checker } });
    },
  },
});

const chained = `export const x = " a ".trim().toLowerCase();`;

test("a row that throws on a file drops its own key there, and the file is still answered", needsTs, async () => {
  const dir = repo({ "tsconfig.json": config, "a.ts": chained });
  try {
    const out = await sent({ root: dir, files: [{ rel: "a.ts", abs: join(dir, "a.ts") }] }, { load: throwingOnTypeNames });
    assert.deepEqual(answered(out), { "a.ts": {} });
    assert.deepEqual(out.findLast((m) => m.rel).resolution, { resolved: 2, total: 2 });
    assert.deepEqual(out.at(-1), { done: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refused config sends site stubs and no checker hits", needsTs, async () => {
  // Two types in one chain, which the checker counts against the claim. A
  // refused config drops every type-checked row, so only where a site is
  // matters, and the checker is not asked.
  const dir = repo({
    "tsconfig.json": "{ this is not json",
    "a.ts": `class B { v() { return 1 } }\nclass A { b() { return new B() } }\nexport const n = new A().b().v();`,
    "b.ts": `export const plain = 1;`,
  });
  try {
    const files = [{ rel: "a.ts", abs: join(dir, "a.ts") }, { rel: "b.ts", abs: join(dir, "b.ts") }];
    const out = await sent({ root: dir, files }, { load: throwingOnTypeNames });
    assert.equal(out[0].config.status, "degraded");
    assert.deepEqual(answered(out), { "a.ts": { law_of_demeter: [{ conforming: true, where: null }] }, "b.ts": {} });
    assert.deepEqual(out.map((m) => Object.keys(m)[0]), ["built", "rel", "rel", "done"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const twoTypes = `class B { v() { return 1 } }\nclass A { b() { return new B() } }\nexport const n = new A().b().v();`;
const stub = { law_of_demeter: [{ conforming: true, where: null }] };

test("every file's resolution and sites are answered before any row is walked", needsTs, async () => {
  const dir = repo({ "tsconfig.json": config, "a.ts": twoTypes, "b.ts": `export const plain = 1;` });
  try {
    const files = [{ rel: "a.ts", abs: join(dir, "a.ts") }, { rel: "b.ts", abs: join(dir, "b.ts") }];
    const out = await sent({ root: dir, files });
    assert.deepEqual(out.map((m) => Object.keys(m)[0]), ["built", "rel", "rel", "sited", "rel", "rel", "done"]);
    assert.deepEqual(out.slice(1, 3), [
      { rel: "a.ts", hits: {}, resolution: { resolved: 2, total: 2 }, sites: stub },
      { rel: "b.ts", hits: {}, resolution: { resolved: 0, total: 0 }, sites: {} },
    ]);
    assert.deepEqual(out.slice(4, 6), [
      { rel: "a.ts", hits: { law_of_demeter: [{ conforming: false, where: null }] }, resolution: { resolved: 2, total: 2 } },
      { rel: "b.ts", hits: {}, resolution: { resolved: 0, total: 0 } },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
