// test/semantic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { repo } from "./ts-repo.mjs";
import {
  loadTypeScript,
  notInstalledMessage,
  classifySemantic,
  RESOLUTION_FLOOR,
  SEMANTIC_GUARDS,
  runSemantic,
} from "../lib/semantic.mjs";

// The tier is optional, so every test that needs the checker says so rather
// than failing on a machine that never installed it.
const loaded = await loadTypeScript();
const needsTs = { skip: loaded ? false : "typescript is not installed" };

test("the loader answers null rather than throwing when typescript is absent", async () => {
  // A user who never asked for --deep must not pay for this dependency, so an
  // absent one is an ordinary state and not a crash.
  const got = await loadTypeScript({ specifier: "typescript-that-is-not-installed" });
  assert.equal(got, null);
});

test("the loader answers the module and its version when it is there", async () => {
  const got = await loadTypeScript();
  if (got === null) return; // the optional dependency is not installed here
  assert.equal(typeof got.ts.createProgram, "function");
  assert.match(got.version, /^5\./, "the range is pinned to major 5");
});

test("the refusal names the install command and the flag that needs it", () => {
  const m = notInstalledMessage();
  assert.match(m, /--deep/);
  assert.match(m, /npm install/);
});

test("a clean config with a high resolution rate is not degraded", () => {
  const r = classifySemantic({ config: { status: "ok", reason: null }, resolution: { resolved: 895, total: 1000 } });
  assert.equal(r.status, "ok");
  assert.equal(r.reason, null);
  assert.equal(Math.round(r.typedResolutionRate * 1000) / 1000, 0.895);
});

test("a config that could not be read is degraded and keeps its own reason", () => {
  const r = classifySemantic({
    config: { status: "degraded", reason: "extends-escaped" },
    resolution: { resolved: 895, total: 1000 },
  });
  assert.equal(r.status, "degraded");
  assert.equal(r.reason, "extends-escaped");
});

test("a clean config whose types mostly did not resolve is degraded on the rate", () => {
  // The measured shape of a broken tsconfig: it parses, and resolution falls
  // from 89.5% to 39.8% with nothing saying so.
  const r = classifySemantic({ config: { status: "ok", reason: null }, resolution: { resolved: 398, total: 1000 } });
  assert.equal(r.status, "degraded");
  assert.equal(r.reason, "low-resolution");
});

test("no property access at all is not evidence of a broken config", () => {
  const r = classifySemantic({ config: { status: "ok", reason: null }, resolution: { resolved: 0, total: 0 } });
  assert.equal(r.status, "ok");
  assert.equal(r.typedResolutionRate, null);
});

test("the floor is stated rather than buried", () => {
  assert.equal(RESOLUTION_FLOOR, 0.8);
  assert.equal(typeof SEMANTIC_GUARDS.idleMs, "number");
  assert.equal(typeof SEMANTIC_GUARDS.buildMs, "number");
});

test("the tier answers a real file and reports a resolution rate", needsTs, async () => {
  const dir = repo({
    "tsconfig.json": `{"compilerOptions":{"strict":true}}`,
    "a.ts": `export class B { v() { return 1 } }\nexport class A { b = new B(); go() { return this.b.v() } }`,
  });
  try {
    const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }]);
    assert.equal(r.error, null);
    assert.equal(r.status, "ok");
    assert.ok(r.typedResolutionRate === null || r.typedResolutionRate > 0.5);
    assert.ok(r.records.has("a.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a checker outside major 5 is refused, because 7 has no JS API", async (t) => {
  // The range in package.json may never widen past major 5: typescript@7 is the
  // Go port and publishes no JS API, so a range that admits it turns --deep into
  // a silent no-op the day it publishes. Refusing here is what turns that into
  // the same named refusal an absent checker gets.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-tsver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const stub = (version) => {
    const p = join(dir, `ts-${version}.mjs`);
    writeFileSync(p, `export const version = ${JSON.stringify(version)};\nexport function createProgram() {}\n`);
    return pathToFileURL(p).href;
  };

  assert.equal(await loadTypeScript({ specifier: stub("7.0.0") }), null, "the Go port is refused");
  assert.equal(await loadTypeScript({ specifier: stub("6.1.2") }), null, "so is anything else off major 5");

  const ok = await loadTypeScript({ specifier: stub("5.9.3") });
  assert.equal(ok?.version, "5.9.3");
});

test("a checker that dies partway through is a failure, not a clean partial answer", async (t) => {
  // The exit handler read any death after `built` as success, so a worker
  // OOM-killed halfway (it was measured at 880 MB resident) resolved 'ok' with
  // half the corpus in `records`, and the map rendered type-checked claims
  // measured over a fraction of it with nothing saying so. That is the silent
  // partial answer B8 exists to refuse.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-halfdead-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = join(dir, "half-dead.mjs");
  writeFileSync(
    worker,
    [
      "process.send({ ready: true });",
      "process.on('message', () => {",
      "  process.send({ built: true, resolution: { resolved: 90, total: 100 }, config: { status: 'ok', reason: null } });",
      "  process.send({ rel: 'a.ts', hits: {} });",
      "  setTimeout(() => process.exit(137), 20);",
      "});",
    ].join("\n")
  );

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], { workerPath: worker });

  assert.equal(r.status, "degraded", "a half-finished run reported its partial counts as ok");
  assert.match(String(r.error ?? ""), /before it finished/);
});

test("a checker that cannot start degrades the tier instead of crashing the scan", async (t) => {
  // fork emits 'error' on EMFILE or EAGAIN, and nothing listened for it, so an
  // unhandled 'error' event became an uncaughtException and took the whole
  // scan down, losing the syntactic pass that had already finished.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nostart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], {
    workerPath: join(dir, "does-not-exist.mjs"),
  });

  assert.equal(r.status, "degraded");
  assert.equal(r.records.size, 0);
  assert.ok(r.error, "the tier has to say why it could not run");
});
