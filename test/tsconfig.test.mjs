// test/tsconfig.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "../plugins/anatomiya/lib/semantic.mjs";
import { repo } from "./ts-repo.mjs";
import {
  readConfig,
  CONFIG_NAME,
  FORCED_OPTIONS,
  confinedCompilerHost,
  confinedParseHost,
  insideRoot,
  toTsPath,
  within,
  contains,
  walkingRealpath,
  opened,
} from "../plugins/anatomiya/lib/tsconfig.mjs";

import { needsSymlinks } from "./platform.mjs";

const loaded = await loadTypeScript();
const ts = loaded?.ts;
const needsTs = { skip: ts ? false : "typescript is not installed" };

test("a repository with no tsconfig runs on the compiler's defaults and says it had none", needsTs, () => {
  const dir = repo({ "a.ts": "export const a = 1" });
  try {
    const r = readConfig(ts, dir);
    // Not broken, and not degraded before anything was measured: `tsc` runs
    // on these same defaults there, and the resolution rate decides.
    assert.equal(r.status, "ok");
    assert.equal(r.reason, "no-tsconfig");
    // It still runs. Refusing would make every untyped repository silent.
    assert.equal(typeof r.options, "object");
    assert.equal(r.options.noEmit, true, "the forced options hold on the defaults too");
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

test("a solution-style root's reference leaving the repository is refused and reported", needsTs, () => {
  // The referenced project is a path the repository writes, the same as an
  // `extends`, so it is read under the same confinement rather than opened.
  const dir = repo({ "tsconfig.json": `{"files":[],"references":[{"path":"../../outside"}]}` });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "degraded");
    assert.equal(r.reason, "reference-escaped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a root that holds files of its own is read as itself, references or not", needsTs, () => {
  // Only the shape that builds nothing itself hands its options over: a root
  // with an include is a project, and its references are its dependencies.
  const dir = repo({
    "tsconfig.json": `{"compilerOptions":{"strict":true},"include":["src"],"references":[{"path":"./lib"}]}`,
    "lib/tsconfig.json": `{"compilerOptions":{"strict":false,"jsx":"react-jsx"}}`,
  });
  try {
    const r = readConfig(ts, dir);
    assert.equal(r.status, "ok");
    assert.equal(r.options.strict, true);
    assert.equal(r.options.jsx, undefined);
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
    // The names are written out rather than walked off the constant: read from
    // there, a key deleted from it stops being checked, which is the one change
    // that turns a forced option back on.
    assert.deepEqual(Object.keys(FORCED_OPTIONS).sort(), [
      "composite",
      "declaration",
      "declarationDir",
      "declarationMap",
      "emitDeclarationOnly",
      "incremental",
      "noEmit",
      "outDir",
      "outFile",
      "sourceMap",
      "tsBuildInfoFile",
    ]);
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
    // Against a literal rather than against `toTsPath`, which is the function
    // under test and is the identity on posix, so the comparison held for any
    // path, normalised or not. What is checkable here is that the two entry
    // points were handed one spelling of one directory: TypeScript normalises
    // every path it holds and then asserts the two forms are equal, so two
    // spellings is the `Debug Failure` this exists to avoid.
    for (const p of seen) assert.doesNotMatch(p, /\\/, `${p} reached TypeScript with a backslash in it`);
    const dirs = new Set(seen.map((p) => (p.endsWith(CONFIG_NAME) ? p.slice(0, -CONFIG_NAME.length - 1) : p)));
    assert.equal(dirs.size, 1, `two spellings of one directory reached TypeScript: ${[...dirs].join(" and ")}`);
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

// --- the confinement, without the checker ------------------------------------
//
// Every case above needs TypeScript installed, so on a runner without it this
// whole file skipped and the confinement it is about went unmeasured: the
// module sat at 71.4% of functions and a per-file floor caught it. These take
// the module as the argument it already is, so they run everywhere.

/**
 * The corner of `ts.sys` these hosts wrap.
 *
 * The two builders take the module as an argument, so a stand-in here is the
 * dependency they were written to be handed rather than a stub of the thing
 * under test. It records what reached the far side, which is the whole question:
 * a host that refuses a path and reads it anyway refuses nothing.
 */
function sys(files = {}) {
  const reached = [];
  return {
    reached,
    sys: {
      useCaseSensitiveFileNames: true,
      newLine: "\n",
      fileExists: (p) => {
        reached.push(`exists ${p}`);
        return p in files;
      },
      readFile: (p) => {
        reached.push(`read ${p}`);
        return files[p];
      },
      getCurrentDirectory: () => "/",
    },
    getDefaultLibFileName: () => "lib.d.ts",
  };
}

/** A real directory, resolved, since containment is asked of the filesystem. */
function tree(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-tsconfig-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a path above the root is outside it, and one at the root is inside", (t) => {
  const dir = tree(t);
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");

  assert.equal(insideRoot(dir, join(dir, "a.ts")), true);
  assert.equal(insideRoot(dir, dir), true, "the root is inside itself");
  assert.equal(insideRoot(dir, join(dir, "..", "b.ts")), false);
  // Spelled as text rather than through `join`, which collapses the steps
  // before the function sees them: built that way the two arguments are one
  // string and the case is the line above it with a different message. What
  // this one catches and that one cannot is a containment test written as a
  // prefix comparison, which reads this path as inside the root it climbs out
  // of. Removing the `resolve` calls is not that defect: `relative` normalises
  // its own arguments, so the two spellings answer alike without them.
  assert.equal(insideRoot(dir, `${dir}/sub/../../b.ts`), false, "and the steps are resolved first");
});

test("a link out of the tree is outside it, however it is spelled", needsSymlinks, (t) => {
  // Lexical containment costs nothing and is not containment: the checker's own
  // reads follow links, so a name inside the root pointing out of it is a read
  // outside the root.
  const dir = tree(t);
  const away = tree(t);
  writeFileSync(join(away, "secret.ts"), "export const secret = 1;\n");
  symlinkSync(away, join(dir, "out"));

  assert.equal(insideRoot(dir, join(dir, "out", "secret.ts")), false);
});

test("the parse host reads inside the root and records what asked to leave it", (t) => {
  // `extends` arrives through `readFile`, so this one rule covers the whole
  // chain a config can pull in.
  const dir = tree(t);
  const inside = join(dir, "tsconfig.json");
  writeFileSync(inside, "{}\n");
  const outside = join(dir, "..", "elsewhere.json");
  const { sys: fake, reached } = sys({ [inside]: "{}" });
  const escaped = [];

  const host = confinedParseHost({ sys: fake }, dir, escaped);

  assert.equal(host.readFile(inside), "{}");
  assert.equal(host.readFile(outside), undefined, "a path outside the root is not read");
  assert.deepEqual(escaped, [outside], "and the attempt is recorded rather than passed over");
  assert.deepEqual(reached, [`read ${inside}`], "the far side never saw the outside path");
});

test("the parse host lists no directory, so the file list stays the caller's", (t) => {
  // `include` and `exclude` select from what `readDirectory` answers. Answering
  // nothing is what forces the program to the rootNames the scan passes in.
  const dir = tree(t);

  assert.deepEqual(confinedParseHost({ sys: sys().sys }, dir, []).readDirectory(), []);
});

test("the parse host answers no for a file outside the root without asking", (t) => {
  const dir = tree(t);
  const inside = join(dir, "a.ts");
  writeFileSync(inside, "export const a = 1;\n");
  const { sys: fake, reached } = sys({ [inside]: "x" });

  const host = confinedParseHost({ sys: fake }, dir, []);

  assert.equal(host.fileExists(inside), true);
  assert.equal(host.fileExists(join(dir, "..", "b.ts")), false);
  assert.deepEqual(reached, [`exists ${inside}`]);
});

/**
 * `confinedCompilerHost` wraps whatever `createCompilerHost` returns, so the
 * stand-in has to answer that too. Every method records the path it was given,
 * which is how a refusal is told from a read that happened anyway.
 */
function compiler(files = {}) {
  const { sys: fake, reached } = sys(files);
  return {
    reached,
    ts: {
      sys: { ...fake, getExecutingFilePath: () => "/nowhere/typescript/lib/typescript.js" },
      createCompilerHost: () => ({
        fileExists: (p) => { reached.push(`exists ${p}`); return p in files; },
        readFile: (p) => { reached.push(`read ${p}`); return files[p]; },
        getSourceFile: (p) => { reached.push(`source ${p}`); return files[p] === undefined ? undefined : { fileName: p }; },
        directoryExists: (p) => { reached.push(`isdir ${p}`); return true; },
        getDirectories: (p) => { reached.push(`dirs ${p}`); return ["sub"]; },
        readDirectory: (p) => { reached.push(`list ${p}`); return [join(p, "a.ts")]; },
        writeFile: (p) => { reached.push(`WROTE ${p}`); },
        realpath: (p) => { reached.push(`real ${p}`); return p; },
        getCurrentDirectory: () => "/nowhere",
      }),
    },
  };
}

test("every read the compiler host offers refuses a path outside the root", (t) => {
  // Five methods, one rule. A guard on `readFile` alone leaves `getSourceFile`
  // to hand the checker the file it just refused to read.
  const dir = tree(t);
  const inside = join(dir, "a.ts");
  writeFileSync(inside, "export const a = 1;\n");
  const outside = join(dir, "..", "b.ts");
  const { ts, reached } = compiler({ [inside]: "export const a = 1;", [outside]: "export const b = 2;" });

  const host = confinedCompilerHost(ts, dir, {});

  assert.equal(host.readFile(inside), "export const a = 1;");
  assert.equal(host.fileExists(inside), true);
  assert.deepEqual(host.getSourceFile(inside), { fileName: inside });

  assert.equal(host.readFile(outside), undefined);
  assert.equal(host.fileExists(outside), false);
  assert.equal(host.getSourceFile(outside), undefined);
  assert.deepEqual(host.getDirectories(outside), []);
  assert.deepEqual(host.readDirectory(outside), []);
  assert.deepEqual(reached.filter((r) => r.includes("b.ts")), [], "the far side saw a path the host had refused");
});

test("the compiler host refuses a link out of the tree on every ask, not only the first", needsSymlinks, (t) => {
  // It remembers each path's answer for the build, so a second ask must get the
  // same refusal and never fall through to the far side.
  const dir = tree(t);
  const away = tree(t);
  writeFileSync(join(away, "secret.ts"), "export const secret = 1;\n");
  symlinkSync(away, join(dir, "out"));
  const via = join(dir, "out", "secret.ts");
  const inside = join(dir, "a.ts");
  writeFileSync(inside, "export const a = 1;\n");
  const { ts, reached } = compiler({ [via]: "export const secret = 1;", [inside]: "export const a = 1;" });

  const host = confinedCompilerHost(ts, dir, {});

  for (let ask = 0; ask < 2; ask++) {
    assert.equal(host.fileExists(via), false);
    assert.equal(host.readFile(via), undefined);
    assert.equal(host.getSourceFile(via), undefined);
    assert.equal(host.readFile(inside), "export const a = 1;");
  }
  assert.deepEqual(reached.filter((r) => r.includes("secret")), [], "the far side saw a path the host had refused");
});

test("the compiler host answers for the root it was given, and writes nothing", (t) => {
  // A checker asked for a program can be asked to emit one, and this runs over
  // somebody else's repository. `noEmit` already says so; this is the second
  // lock, and it is the one that holds when a caller passes options of its own.
  const dir = tree(t);
  const { ts, reached } = compiler();

  const host = confinedCompilerHost(ts, dir, {});

  assert.equal(host.getCurrentDirectory(), dir, "the checker resolves against the tree being scanned");
  assert.equal(host.writeFile(join(dir, "out.js"), "anything"), undefined);
  assert.deepEqual(reached.filter((r) => r.startsWith("WROTE")), [], "a write reached the wrapped host");
});

test("the compiler host asks the disk once per path and question for one build", (t) => {
  // Module resolution probes the same candidates from every importing file:
  // on empire-flippers client 107,928 stats landed on 24,737 paths.
  const dir = tree(t);
  const inside = join(dir, "a.ts");
  const missing = join(dir, "gone.ts");
  const { ts, reached } = compiler({ [inside]: "export const a = 1;" });

  const host = confinedCompilerHost(ts, dir, {});
  for (let ask = 0; ask < 3; ask++) {
    assert.equal(host.fileExists(inside), true);
    assert.equal(host.fileExists(missing), false);
    assert.equal(host.directoryExists(dir), true);
    assert.equal(host.realpath(inside), inside);
    assert.deepEqual(host.getDirectories(dir), ["sub"]);
  }

  assert.deepEqual(reached.sort(), [
    `dirs ${dir}`,
    `exists ${missing}`,
    `exists ${inside}`,
    `isdir ${dir}`,
    `real ${inside}`,
  ].sort());
});

test("the containment walk resolves each directory once, not once per path under it", async (t) => {
  // `realpathSync` lstats every directory above its argument again, and the
  // walk asks it of every directory it enters: 20,816 calls on ef-client.
  const dir = tree(t);
  const deep = join(dir, "a", "b", "c");
  mkdirSync(deep, { recursive: true });
  const names = ["one.ts", "two.ts", "three.ts"];
  for (const name of names) writeFileSync(join(deep, name), "export {};\n");
  const { ts } = compiler(Object.fromEntries(names.map((n) => [join(deep, n), "export {};"])));
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.realpathSync;
  const asked = [];
  fs.realpathSync = Object.assign((p, ...rest) => {
    asked.push(String(p));
    return real(p, ...rest);
  }, { native: real.native });
  syncBuiltinESMExports();
  try {
    const host = confinedCompilerHost(ts, dir, {});
    for (const name of names) assert.equal(host.readFile(join(deep, name)), "export {};");
  } finally {
    fs.realpathSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(asked.filter((p) => p.startsWith(dir)), [], "a directory inside the tree was walked again");
});

test("the walking realpath answers what realpathSync answers for a step back through a link", needsSymlinks, (t) => {
  // realpathSync drops `link/..` as text before it reads a link; resolving the
  // link first lands in the parent of wherever it points.
  const dir = tree(t);
  mkdirSync(join(dir, "away", "deep"), { recursive: true });
  symlinkSync(join(dir, "away", "deep"), join(dir, "link"));
  const asked = `${dir}/link/../away`;

  assert.equal(walkingRealpath()(asked), realpathSync(asked));
});

test("the compiler host refuses a step back through a link that leaves the root", needsSymlinks, (t) => {
  // The host opens the path as written and the OS takes `..` from where `up`
  // leads, while the string reads as `src/outside` inside the root.
  const parent = tree(t);
  const dir = join(parent, "repo");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(parent, "outside"));
  writeFileSync(join(parent, "outside", "secret.ts"), "export const secret = 1;\n");
  symlinkSync("..", join(dir, "src", "up"));
  const via = `${dir}/src/up/../outside/secret.ts`;
  const inside = `${dir}/src/up/src/..`;
  const { ts, reached } = compiler({ [via]: "export const secret = 1;" });

  const host = confinedCompilerHost(ts, dir, {});

  assert.equal(host.readFile(via), undefined);
  assert.equal(host.fileExists(via), false);
  assert.equal(host.getSourceFile(via), undefined);
  assert.deepEqual(reached.filter((r) => r.includes("secret")), [], "the far side saw a path the host had refused");
  assert.deepEqual(host.getDirectories(inside), ["sub"], "a step back that stays inside is still read");
});

test("a step back is taken where each platform's open takes it", () => {
  // POSIX steps up from where the link leads; Windows collapses `..` as text
  // before it opens anything, so a link resolved first checks a path it never opens.
  const links = { "/repo/src/in": "/repo/deep/a/b/c", "C:\\repo\\src\\in": "C:\\repo\\deep\\a\\b\\c" };
  const realpath = (p) => links[p] ?? p;

  assert.equal(opened("/repo/src/in/../../../y", realpath, "linux"), "/repo/deep/y");
  assert.equal(opened("C:\\repo\\src\\in\\..\\..\\..\\y", realpath, "win32"), "C:\\y");
  assert.equal(opened("C:/repo/src/in/../../../y", realpath, "win32"), "C:\\y");
});

test("a backslash in a POSIX name is a character, not a step back", { skip: process.platform === "win32" ? "the name cannot exist on Windows" : needsSymlinks.skip }, (t) => {
  // Split on both separators, a link named `x\..\y` read as `src/y`, a file
  // that is not there, and the host opened the link to the file beside the root.
  const parent = tree(t);
  const dir = join(parent, "repo");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(parent, "outside"));
  writeFileSync(join(parent, "outside", "secret.ts"), "export const secret = 1;\n");
  const via = `${dir}/src/x\\..\\y`;
  symlinkSync(join(parent, "outside", "secret.ts"), via);
  const named = `${dir}/src/a\\..\\b.ts`;
  writeFileSync(named, "export const b = 1;\n");
  const { ts, reached } = compiler({ [via]: "export const secret = 1;", [named]: "export const b = 1;" });

  assert.equal(insideRoot(dir, via), false);
  const host = confinedCompilerHost(ts, dir, {});
  assert.equal(host.readFile(via), undefined);
  assert.equal(host.fileExists(via), false);
  assert.deepEqual(reached.filter((r) => r.includes("x\\")), [], "the far side saw a path the host had refused");
  assert.equal(host.readFile(named), "export const b = 1;", "a file inside with that name is still read");
});

test("a list of directories the host remembers cannot be changed by the caller", (t) => {
  const dir = tree(t);
  const { ts } = compiler();
  const host = confinedCompilerHost(ts, dir, {});

  host.getDirectories(dir).push("planted");
  assert.deepEqual(host.getDirectories(dir), ["sub"]);
});

test("two builds never share what the disk said", (t) => {
  // The tree is fixed for one build, not for the process: a second scan in the
  // same process has to see a file the first one did not.
  const dir = tree(t);
  const later = join(dir, "later.ts");
  const files = {};
  const { ts, reached } = compiler(files);

  assert.equal(confinedCompilerHost(ts, dir, {}).fileExists(later), false);
  files[later] = "export const later = 1;";
  assert.equal(confinedCompilerHost(ts, dir, {}).fileExists(later), true);
  assert.deepEqual(reached, [`exists ${later}`, `exists ${later}`]);
});

test("the compiler host reads its own type library, which does not live in the tree", (t) => {
  // The lib files ship beside the TypeScript module, so a rule that only knew
  // the repository refused every one of them and every import resolved to
  // `any`, which is the tier reporting 0% while working perfectly.
  const dir = tree(t);
  const lib = "/nowhere/typescript/lib/lib.es5.d.ts";
  const { ts } = compiler({ [lib]: "declare const x: number;" });

  assert.equal(confinedCompilerHost(ts, dir, {}).readFile(lib), "declare const x: number;");
});

test("two Windows drives have no relative path between them, and that is not containment", () => {
  // `relative` answers an absolute path there, which does not start with ".."
  // and read as inside on the one platform singled out for special handling.
  assert.equal(within(""), true);
  assert.equal(within("sub/a.ts"), true);
  assert.equal(within("../a.ts"), false);
  assert.equal(within("/etc/passwd"), false);
  assert.equal(within("D:\\other\\a.ts"), false);
});

test("a directory whose name starts with two dots is inside, not above", (t) => {
  // `rel.startsWith("..")` read `..base/tsconfig.json` as a step above the
  // root, so an `extends` into a directory of that name was refused as
  // escaped and the whole tier degraded. Only `..` as a whole segment climbs.
  assert.equal(within("..base/tsconfig.json"), true);
  assert.equal(within("..base\\tsconfig.json"), true);
  assert.equal(within(".."), false);
  assert.equal(within("..\\a.ts"), false);
  const dir = tree(t);
  mkdirSync(join(dir, "..base"));
  writeFileSync(join(dir, "..base", "a.ts"), "export const a = 1;\n");
  assert.equal(insideRoot(dir, join(dir, "..base", "a.ts")), true);
  assert.equal(insideRoot(dir, join(dir, "..")), false);
});

test("a root tsconfig that is a link out of the repository is refused, not followed", { skip: needsTs.skip || needsSymlinks.skip }, () => {
  // The root config was read with the host's own readFile, before anything
  // confined it, so a committed `tsconfig.json` linking to a file outside the
  // repository was opened and its options handed to the checker.
  const away = repo({ "tsconfig.json": `{"compilerOptions":{"strict":true}}` });
  const dir = repo({ "a.ts": "export const a = 1;\n" });
  try {
    symlinkSync(join(away, "tsconfig.json"), join(dir, "tsconfig.json"));
    const r = readConfig(ts, dir);
    assert.equal(r.status, "degraded");
    assert.equal(r.reason, "config-escaped");
    assert.notEqual(r.options.strict, true, "nothing the outside file says reaches the checker");
    assert.equal(r.options.noEmit, true, "and the forced options still hold");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

test("containment folds case on Windows and nowhere else", () => {
  // Its filesystem is case-insensitive, so one file reached through two
  // spellings is one file there and two here.
  assert.equal(contains("C:\\repo", "C:\\REPO\\src\\a.ts", "win32"), true);
  assert.equal(contains("C:\\repo", "D:\\repo\\a.ts", "win32"), false, "another drive is not inside this one");
  assert.equal(contains("/repo", "/repo/Secrets/a.ts", "linux"), true);
  assert.equal(contains("/repo", "/REPO/a.ts", "linux"), false, "and two spellings are two paths here");
});

test("a path handed to TypeScript carries forward slashes on either platform", () => {
  // It normalises every path it holds and then asserts the two forms are equal,
  // so backslashes crash it the moment a config has an error to report.
  assert.equal(toTsPath("C:\\repo\\src\\a.ts"), "C:/repo/src/a.ts");
  assert.equal(toTsPath("/repo/src/a.ts"), "/repo/src/a.ts");
});
