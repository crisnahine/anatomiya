// test/semantic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { repo } from "./ts-repo.mjs";
import { needsPosixPermissions } from "./platform.mjs";
import { scratch } from "./git-worktrees.mjs";
import {
  loadTypeScript,
  checkerBlocked,
  checkerStamp,
  unusableReason,
  classifySemantic,
  RESOLUTION_FLOOR,
  SEMANTIC_GUARDS,
  runSemantic,
} from "../plugins/anatomiya/lib/semantic.mjs";

// The tier is optional, so every test that needs the checker says so rather
// than failing on a machine that never installed it.
const loaded = await loadTypeScript();
const needsTs = { skip: loaded ? false : "typescript is not installed" };

/** A module standing in for typescript at one version, as a specifier the loader imports. */
function typescriptStub(dir, version = "5.9.3", { createProgram = true } = {}) {
  const p = join(dir, `ts-${version}.mjs`);
  const program = createProgram ? "export function createProgram() {}\n" : "";
  writeFileSync(p, `export const version = ${JSON.stringify(version)};\n${program}`);
  return pathToFileURL(p).href;
}

test("the loader answers null rather than throwing when typescript is absent", async () => {
  // A user who never installed the checker must not pay for it, so an absent
  // one is an ordinary state and not a crash.
  const got = await loadTypeScript({ specifier: "typescript-that-is-not-installed" });
  assert.equal(got, null);
});

test("the loader answers the module and its version when it is there", async () => {
  const got = await loadTypeScript();
  if (got === null) return; // the optional dependency is not installed here
  assert.equal(typeof got.ts.createProgram, "function");
  assert.match(got.version, /^5\./, "the range is pinned to major 5");
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

test("a guard name the checker does not know refuses before anything is forked", async () => {
  // The same rule as the two parse bridges, failing the same way they do: a
  // rejection, not a throw, so the three bridges are read alike by a caller.
  await assert.rejects(runSemantic("/nowhere", [], { guards: { idleMS: 50 } }), /idleMS/);
});

test("a partial guard bag keeps the checker's other default", needsTs, async () => {
  // Taken whole, a bag naming one guard left the other undefined, and the
  // build window was then armed with nothing.
  const dir = repo({
    "tsconfig.json": `{"compilerOptions":{"strict":true}}`,
    "a.ts": `export const a = 1;`,
  });
  try {
    const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], { guards: { idleMs: 60_000 } });
    assert.equal(r.error, null);
    assert.equal(r.status, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("a repository with no root tsconfig is judged on what resolved, not on the missing file", needsTs, async () => {
  // Measured on an Nx-style monorepo, a tsconfig.base.json at the root and one
  // tsconfig per package, and on any plain TypeScript tree without one:
  // `type-checked claims are counts only: 100% of type lookups resolved
  // (no-tsconfig)`, the two halves of one line contradicting each other. With
  // no file the checker runs on its own defaults, which is what `tsc` does
  // there too, and the rate is the measurement the degraded verdict exists for.
  const dir = repo({
    "a.ts": `export class B { v() { return 1 } }\nexport class A { b = new B(); go() { return this.b.v() } }`,
  });
  try {
    const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }]);
    assert.equal(r.error, null);
    assert.equal(r.typedResolutionRate, 1);
    assert.equal(r.status, "ok");
    assert.equal(r.reason, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a solution-style root tsconfig is read through the project it references", needsTs, async () => {
  // Vite's react-ts scaffold: the root tsconfig.json builds nothing itself
  // (`files: []`) and names tsconfig.app.json, which holds the `@/` alias. Read
  // alone, the root handed the checker no alias, every import through it
  // resolved to any, and the fixture this is cut from measured 77%, so every
  // type-checked claim printed as counts only.
  const dir = repo({
    "tsconfig.json": `{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}`,
    "tsconfig.app.json": `{"compilerOptions":{"strict":true,"baseUrl":".","paths":{"@/*":["./src/*"]}},"include":["src"]}`,
    "tsconfig.node.json": `{"compilerOptions":{"strict":true},"include":["vite.config.ts"]}`,
    "src/lib/svc.ts": `export class Svc { names(): string[] { return [] } }`,
    "src/view.ts": `import { Svc } from "@/lib/svc";\nconst s = new Svc();\nexport const n = s.names().map((x) => x.trim());`,
  });
  try {
    const files = ["src/lib/svc.ts", "src/view.ts"].map((rel) => ({ rel, abs: join(dir, rel), lang: "js" }));
    const r = await runSemantic(dir, files);
    assert.equal(r.error, null);
    assert.equal(r.typedResolutionRate, 1);
    assert.equal(r.status, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a repository with no root tsconfig whose types did not resolve says it had none", () => {
  // Under the floor the missing file is still the likeliest cause, so it keeps
  // its own name rather than the generic one a config that read cleanly gets.
  const r = classifySemantic({ config: { status: "ok", reason: "no-tsconfig" }, resolution: { resolved: 3, total: 10 } });
  assert.equal(r.status, "degraded");
  assert.equal(r.reason, "no-tsconfig");
});

test("a checker outside major 5 is refused, because 7 has no JS API", async (t) => {
  // The range in package.json may never widen past major 5: typescript@7 is the
  // Go port and publishes no JS API, so a range that admits it turns the checker
  // into a silent no-op the day it publishes. Refusing here is what makes doctor
  // name it rather than the scan quietly leaving it off.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-tsver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(await loadTypeScript({ specifier: typescriptStub(dir, "7.0.0") }), null, "the Go port is refused");
  assert.equal(await loadTypeScript({ specifier: typescriptStub(dir, "6.1.2") }), null, "so is anything else off major 5");

  const ok = await loadTypeScript({ specifier: typescriptStub(dir, "5.9.3") });
  assert.equal(ok?.version, "5.9.3");
});

test("the checker is blocked for each reason it could state nothing, and runs otherwise", async (t) => {
  const dir = scratch(t, "anatomiya-tsskip-");
  const checkedRels = ["src/a.ts"];
  const good = typescriptStub(dir);

  assert.equal(await checkerBlocked(dir, { specifier: good, checkedRels }), "no-dependencies");
  mkdirSync(join(dir, "node_modules", ".cache"), { recursive: true });
  assert.equal(await checkerBlocked(dir, { specifier: good, checkedRels }), "no-dependencies", "a cache is no install");
  mkdirSync(join(dir, "node_modules", "left-pad"));
  assert.equal(await checkerBlocked(dir, { specifier: good, checkedRels }), null);
  assert.equal(await checkerBlocked(dir, { specifier: "typescript-that-is-not-installed", checkedRels }), "not-installed");
  const old = typescriptStub(dir, "4.9.5");
  assert.equal(await checkerBlocked(dir, { specifier: old, checkedRels }), "not-installed");
  const hollow = typescriptStub(dir, "5.4.0", { createProgram: false });
  assert.equal(await checkerBlocked(dir, { specifier: hollow, checkedRels }), "not-installed");
});

test("plain JavaScript with no tsconfig.json is not checked, whatever is installed", async (t) => {
  // Measured with dependencies installed: huginn, diaspora and whitehall all
  // came back degraded no-tsconfig at 25% to 39%, so every type-checked slot
  // closed, after paying the checker's time on every scan and refresh.
  const dir = scratch(t, "anatomiya-tsplain-");
  const specifier = typescriptStub(dir);
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });

  const plain = ["app/a.js", "app/b.jsx", "lib/c.mjs"];
  assert.equal(await checkerBlocked(dir, { specifier, checkedRels: plain }), "plain-javascript");
  // One TypeScript file is enough: an Nx-style monorepo keeps its options in
  // tsconfig.base.json, runs on defaults, and resolved at 100%.
  for (const typed of ["src/d.ts", "src/e.tsx", "src/f.mts", "src/g.cts"]) {
    assert.equal(await checkerBlocked(dir, { specifier, checkedRels: [...plain, typed] }), null, typed);
  }
  // A declaration file types nothing the JavaScript beside it imports.
  for (const declared of ["index.d.ts", "types/a.d.mts", "types/b.d.cts"]) {
    assert.equal(await checkerBlocked(dir, { specifier, checkedRels: [...plain, declared] }), "plain-javascript", declared);
  }
  // A tsconfig.json is the repository asking for its JavaScript to be checked.
  writeFileSync(join(dir, "tsconfig.json"), "{}");
  assert.equal(await checkerBlocked(dir, { specifier, checkedRels: plain }), null);
});

test("a caller that does not say which files it checks is refused, not answered", async () => {
  // A default would read every repository as plain, or none of them.
  await assert.rejects(checkerBlocked("/nowhere"), TypeError);
});

test("plain JavaScript is named before missing dependencies, which would not help it", async (t) => {
  const dir = scratch(t, "anatomiya-tsplain-nodeps-");

  assert.equal(await checkerBlocked(dir, { checkedRels: ["app/a.js"] }), "plain-javascript");
  assert.equal(await checkerBlocked(dir, { checkedRels: ["app/a.ts"] }), "no-dependencies");
});

test("the refresh stamp moves when a tsconfig.json appears, tracked or not", (t) => {
  // An untracked tsconfig.json is not in the index the refresh hashes, and it
  // turns plain JavaScript's checker on.
  const dir = scratch(t, "anatomiya-tsstamp-config-");
  const before = checkerStamp(dir);
  writeFileSync(join(dir, "tsconfig.json"), "{}");

  assert.notEqual(checkerStamp(dir), before);
});

test("a node_modules this cannot read is no install, not a crash", needsPosixPermissions, async (t) => {
  // The refresh stamps this answer, so a throw here would fail every refresh.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-tslocked-"));
  const deps = join(dir, "node_modules");
  mkdirSync(join(deps, "left-pad"), { recursive: true });
  chmodSync(deps, 0o000);
  t.after(() => {
    chmodSync(deps, 0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(await checkerBlocked(dir, { checkedRels: ["src/a.ts"] }), "no-dependencies");
});

test("the refresh stamp moves when packages land or the checker resolves elsewhere", needsTs, (t) => {
  const dir = scratch(t, "anatomiya-tsstamp-");
  const before = checkerStamp(dir);
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  const after = checkerStamp(dir);

  assert.notEqual(after, before);
  assert.equal(checkerStamp(dir), after, "and holds still while nothing moves");
  assert.notEqual(checkerStamp(dir, { specifier: "typescript-that-is-not-installed" }), after);
});

test("the refresh stamp moves when typescript is upgraded in place", (t) => {
  const dir = scratch(t, "anatomiya-tsupgrade-");
  const pkg = join(dir, "typescript");
  mkdirSync(join(pkg, "lib"), { recursive: true });
  writeFileSync(join(pkg, "lib", "typescript.js"), "");
  const specifier = pathToFileURL(join(pkg, "lib", "typescript.js")).href;
  writeFileSync(join(pkg, "package.json"), `{"version":"4.9.5"}`);
  const before = checkerStamp(dir, { specifier });
  writeFileSync(join(pkg, "package.json"), `{"version":"5.9.3"}`);

  assert.notEqual(checkerStamp(dir, { specifier }), before);
});

test("doctor names why a typescript that loads cannot run the checker", () => {
  assert.equal(unusableReason({ version: "4.9.5", createProgram() {} }), "the type checker needs typescript 5.x");
  assert.equal(unusableReason({ version: "5.4.0" }), "the type checker needs a typescript that exports createProgram");
  assert.equal(unusableReason({ version: "5.9.3", createProgram() {} }), null);
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
      "  process.send({ built: true, config: { status: 'ok', reason: null } });",
      "  process.send({ rel: 'a.ts', hits: {}, resolution: { resolved: 9, total: 10 } });",
      "  setTimeout(() => process.exit(137), 20);",
      "});",
    ].join("\n")
  );

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], { workerPath: worker });

  assert.equal(r.status, "degraded", "a half-finished run reported its partial counts as ok");
  assert.match(String(r.error ?? ""), /before it finished/);
});

/** A worker that answers what it is told to and then never speaks again. */
function stallingWorker(t, name, says) {
  const dir = mkdtempSync(join(tmpdir(), `anatomiya-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worker = join(dir, `${name}.mjs`);
  writeFileSync(
    worker,
    ["process.send({ ready: true });", "process.on('message', () => {", says, "});", "setTimeout(() => {}, 60_000);"].join("\n")
  );
  return { dir, worker };
}

test("a checker that never finishes its program build is killed by the clock that waits for it", { timeout: 15_000 }, async (t) => {
  // The build is one long silence before any file is answered, so the first
  // window is the only thing between a checker that is working and one that
  // will never speak again. With nothing arming it the run hangs forever, and
  // the suite could only ever say the number existed.
  const { dir, worker } = stallingWorker(t, "nobuild", "");

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], {
    workerPath: worker,
    guards: { buildMs: 150, idleMs: 150 },
  });

  assert.equal(r.status, "degraded");
  assert.match(String(r.error ?? ""), /went quiet/);
  assert.equal(r.records.size, 0);
});

test("a checker the scan stopped is killed at once rather than waited on", { timeout: 15_000 }, async (t) => {
  // A scan that failed beside it would otherwise hold the process open until
  // the build clock, ten minutes by default, ran out.
  const { dir, worker } = stallingWorker(t, "stopped", "");
  const stop = new AbortController();
  const started = Date.now();
  const run = runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], { workerPath: worker, signal: stop.signal });
  setTimeout(() => stop.abort(), 100);
  const r = await run;

  assert.equal(r.status, "degraded");
  assert.match(String(r.error ?? ""), /scan stopped/);
  assert.ok(Date.now() - started < 5_000, "answered long before any clock would have");
});

test("a checker asked for after the scan already stopped is never left running", { timeout: 15_000 }, async (t) => {
  const { dir, worker } = stallingWorker(t, "prestopped", "");
  const stop = new AbortController();
  stop.abort();
  const started = Date.now();

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], { workerPath: worker, signal: stop.signal });

  assert.match(String(r.error ?? ""), /scan stopped/);
  assert.ok(Date.now() - started < 1_000, "answered at once");
});

test("a checker that built its program and then stalled is killed by the shorter clock", { timeout: 15_000 }, async (t) => {
  // The window moves once the build lands: after it, silence is a stall rather
  // than a large repository, and a run that answered one file of a thousand is
  // the partial answer the tier refuses.
  const { dir, worker } = stallingWorker(
    t,
    "stalled",
    "  process.send({ built: true, config: { status: 'ok', reason: null } });\n" +
      "  process.send({ rel: 'a.ts', hits: {}, resolution: { resolved: 9, total: 10 } });"
  );

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], {
    workerPath: worker,
    guards: { buildMs: 60_000, idleMs: 150 },
  });

  assert.equal(r.status, "degraded");
  assert.match(String(r.error ?? ""), /went quiet/);
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

test("a checker that cannot be spawned degrades the tier instead of crashing the scan", async (t) => {
  // fork emits 'error' on a spawn failure, which is EMFILE or EAGAIN under the
  // fd pressure of eight parse workers and the ruby bridge. Unlistened, that is
  // an uncaughtException that takes the whole scan down along with the
  // syntactic pass that already finished. A missing cwd is the reachable
  // version of the same failure: a missing script exits instead.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nospawn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = await runSemantic(dir, [{ rel: "a.ts", abs: join(dir, "a.ts"), lang: "js" }], {
    cwd: join(dir, "not-a-directory"),
  });

  assert.equal(r.status, "degraded");
  assert.match(String(r.error ?? ""), /could not run/);
  assert.equal(r.records.size, 0);
});
