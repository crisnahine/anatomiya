// test/tsconfig.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "../lib/semantic.mjs";
import { repo } from "./ts-repo.mjs";
import {
  readConfig,
  FORCED_OPTIONS,
  confinedCompilerHost,
  toTsPath,
  within,
  contains,
  realpathOf,
} from "../lib/tsconfig.mjs";

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

test("a path handed to TypeScript carries no backslash, whatever platform built it", () => {
  // TypeScript normalises every path it holds to forward slashes and then
  // asserts the two forms are equal, so a backslash path crashes it with a
  // Debug Failure the moment a config has an error to report. Windows-only, and
  // it took CI red on both Windows legs to find.
  //
  // Driven with a Windows-shaped path rather than one this machine built: `sep`
  // is already "/" here, so a test over a real local path passes without the
  // fix and proves nothing. That is what the first version of this test did.
  assert.equal(toTsPath("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\x\\tsconfig.json"),
               "C:/Users/RUNNER~1/AppData/Local/Temp/x/tsconfig.json");
  assert.equal(toTsPath("/tmp/x/tsconfig.json"), "/tmp/x/tsconfig.json", "a POSIX path is left alone");
  assert.equal(toTsPath("D:\\a\\anatomiya"), "D:/a/anatomiya");
});

test("readConfig hands both TypeScript entry points a normalised path", needsTs, () => {
  const dir = repo({ "tsconfig.json": `{"compilerOptions":{"target":"not-a-target"}}`, "a.ts": "export const a = 1" });
  try {
    const seen = [];
    const spy = {
      ...ts,
      parseConfigFileTextToJson(path, text) {
        seen.push(path);
        return ts.parseConfigFileTextToJson(path, text);
      },
      parseJsonConfigFileContent(config, host, basePath, existing, configName) {
        seen.push(basePath, configName);
        return ts.parseJsonConfigFileContent(config, host, basePath, existing, configName);
      },
    };

    const r = readConfig(spy, dir);

    assert.equal(r.status, "degraded", "the fixture has to reach the error path, or nothing was handed over");
    assert.ok(seen.length >= 3, "both entry points were expected to be called");
    for (const p of seen) assert.equal(p, toTsPath(p), `${p} was not normalised before TypeScript saw it`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path on another drive is outside, not inside", needsTs, () => {
  // `relative` between two Windows drives answers an absolute path, which does
  // not start with "..", so a bare startsWith check reads D:\secrets as inside
  // C:\...\typescript\lib. insideRoot already guards for this and the compiler
  // host's own check did not. Driven through path.win32 so it holds here.
  const rel = win32.relative("C:\\plugin\\node_modules\\typescript\\lib", "D:\\secrets\\x.ts");
  assert.equal(rel.startsWith(".."), false, "this is why the bare check let it through");
  assert.equal(within(rel), false, "a path on another drive is not contained");

  assert.equal(within(win32.relative("C:\\a\\lib", "C:\\a\\lib\\lib.d.ts")), true);
  assert.equal(within(win32.relative("C:\\a\\lib", "C:\\a\\other\\x.ts")), false);
});

test("containment folds case on Windows and does not on POSIX", () => {
  // Windows is case-insensitive, so the same file reached through two spellings
  // is one file there and two here. Folding on POSIX would make /repo/Secrets
  // and /repo/secrets the same path, and they are not.
  assert.equal(contains("/repo", "/repo/src/a.ts", "linux"), true);
  assert.equal(contains("/repo", "/other/a.ts", "linux"), false);
  assert.equal(contains("/repo", "/REPO/a.ts", "linux"), false, "POSIX keeps the two apart");

  assert.equal(contains("/repo", "/REPO/a.ts", "win32"), true, "Windows reaches the same file either way");
  assert.equal(contains("/repo", "/other/a.ts", "win32"), false);
});

test("the realpath used is the one that expands a Windows short name", () => {
  // tmpdir() on a runner answers C:\Users\RUNNER~1\..., and the compiler
  // resolves the same file to the long form. Comparing those two refused every
  // file it discovered for itself, which is 0% resolution with nothing wrong.
  assert.equal(typeof realpathOf, "function");
  const here = fileURLToPath(new URL(".", import.meta.url));
  assert.equal(realpathOf(here).replace(/[/\\]$/, ""), realpathSync(here).replace(/[/\\]$/, ""));
  // A path that is not there resolves rather than throwing: module resolution
  // probes far more candidates than exist.
  assert.equal(typeof realpathOf(join(here, "no-such-file")), "string");
});
