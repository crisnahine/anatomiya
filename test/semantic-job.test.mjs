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

const config = `{"compilerOptions":{"strict":true}}`;

test("a checker that is not installed is one message, and the job ends there", async () => {
  // Ungated: the loader is handed in, so this runs where typescript is absent.
  assert.deepEqual(await sent({ root: "/nowhere", files: [], keys: null }, { load: async () => null }), [
    { error: "typescript is not installed" },
  ]);
});

test("the job answers built, one record per file and done, in that order", needsTs, async () => {
  const dir = repo({
    "tsconfig.json": config,
    "a.ts": `export class B { v() { return 1 } }\nexport class A { b = new B(); go() { return this.b.v() } }`,
  });
  try {
    const out = await sent({ root: dir, files: [{ rel: "a.ts", abs: join(dir, "a.ts") }], keys: null });
    assert.deepEqual(out.map((m) => Object.keys(m)[0]), ["built", "rel", "done"]);
    assert.deepEqual(out[0].resolution, { resolved: 2, total: 2 });
    assert.equal(out[0].config.status, "ok");
    assert.equal(out[1].rel, "a.ts");
    assert.ok(out[1].hits && typeof out[1].hits === "object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a key list narrows the rows a file is answered with", needsTs, async () => {
  const dir = repo({ "tsconfig.json": config, "a.ts": `export const x = " a ".trim().toLowerCase();` });
  try {
    const out = await sent({ root: dir, files: [{ rel: "a.ts", abs: join(dir, "a.ts") }], keys: ["law_of_demeter"] });
    assert.deepEqual(Object.keys(out[1].hits), ["law_of_demeter"]);
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

test("whatever the job throws on is one error message, not a dead channel", needsTs, async () => {
  const out = await sent({ root: "/nowhere", files: null, keys: null });
  assert.equal(out.length, 1);
  assert.match(out[0].error, /null/);
});
