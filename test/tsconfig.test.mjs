// test/tsconfig.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { loadTypeScript } from "../lib/semantic.mjs";
import { repo } from "./ts-repo.mjs";
import { readConfig, FORCED_OPTIONS, confinedCompilerHost } from "../lib/tsconfig.mjs";

const loaded = await loadTypeScript();
const ts = loaded?.ts;
const needsTs = { skip: ts ? false : "typescript is not installed" };

test("a repository with no tsconfig is degraded, not broken", needsTs, () => {
  const dir = repo({ "a.ts": "export const a = 1" });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "degraded");
    assert.equal(r.reason, "no-tsconfig");
    // Degraded still runs. Refusing would make every untyped repository silent.
    assert.equal(typeof r.options, "object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tsconfig that does not parse is degraded with its own reason", needsTs, () => {
  const dir = repo({ "tsconfig.json": "{ this is not json" });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.reason, "unparseable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("comments and trailing commas are legal in a tsconfig and parse cleanly", needsTs, () => {
  const dir = repo({
    "tsconfig.json": `{
      // a comment is legal here and JSON.parse would reject it
      "compilerOptions": { "strict": true, },
    }`,
  });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "ok");
    assert.equal(r.options.strict, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an extends pointing outside the repository is refused and reported", needsTs, () => {
  const dir = repo({ "tsconfig.json": `{"extends":"../../outside/tsconfig.json"}` });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "degraded");
    assert.equal(r.reason, "extends-escaped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an extends inside the repository is followed", needsTs, () => {
  const dir = repo({
    "base/tsconfig.json": `{"compilerOptions":{"strict":true}}`,
    "tsconfig.json": `{"extends":"./base/tsconfig.json"}`,
  });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "ok");
    assert.equal(r.options.strict, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every option that would write to disk is forced off", needsTs, () => {
  const dir = repo({
    "tsconfig.json": `{"compilerOptions":{
      "outDir":"out","declaration":true,"composite":true,"incremental":true,
      "tsBuildInfoFile":"x.tsbuildinfo","noEmit":false
    }}`,
  });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.options.noEmit, true);
    assert.equal(r.options.composite, false);
    assert.equal(r.options.incremental, false);
    assert.equal(r.options.declaration, false);
    assert.equal(r.options.outDir, undefined);
    assert.equal(r.options.tsBuildInfoFile, undefined);
    for (const key of Object.keys(FORCED_OPTIONS)) {
      assert.deepEqual(r.options[key], FORCED_OPTIONS[key], `${key} was not forced`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("include and exclude decide nothing: the host lists no directory", needsTs, () => {
  const dir = repo({
    "tsconfig.json": `{"include":["src/**/*"],"exclude":["src/skip"]}`,
    "src/a.ts": "export const a = 1",
  });
  try {
    const r = readConfig(ts, dir);
    // The corpus is the file list. A config that could add or drop files would
    // count over a population the rest of the tool never saw.
    assert.deepEqual(r.fileNames, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a genuinely broken option is still degraded, unlike an empty file list", needsTs, () => {
  // The no-inputs diagnostic fires on every config whose globs this tool is
  // about to override, so it cannot mean "broken". A real option error still
  // has to, or B8's whole point is lost.
  const dir = repo({ "tsconfig.json": `{"compilerOptions":{"target":"not-a-target"}}`, "a.ts": "export const a = 1" });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "degraded");
    assert.equal(r.reason, "config-errors");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a config whose globs match nothing is still ok, because the file list is forced", needsTs, () => {
  const dir = repo({ "tsconfig.json": `{"include":["does-not-exist/**/*.ts"]}` });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "ok", `a config with no matching inputs read as ${r.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the compiler host refuses a read outside the repository and outside the lib dir", needsTs, () => {
  const dir = repo({ "a.ts": "export const a = 1" });
  try {
    const host = confinedCompilerHost(ts, dir, ts.getDefaultCompilerOptions());
    assert.equal(host.fileExists(join(dir, "a.ts")), true, "inside the repository is readable");
    assert.equal(host.fileExists("/etc/hosts"), false, "outside is not");
    // The default lib has to stay readable or nothing resolves at all, and it
    // comes from the plugin's own typescript rather than the repository's.
    // `getDefaultLibFileName` answers with the full path, not a bare name.
    const lib = host.getDefaultLibFileName(ts.getDefaultCompilerOptions());
    assert.ok(isAbsolute(lib), "the host answers with a path, not a name");
    assert.equal(host.fileExists(lib), true, "the plugin's own lib files stay readable");
    assert.match(lib, /node_modules[/\\]typescript[/\\]lib/, "and it is the plugin's own, not the repository's");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
