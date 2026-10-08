import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPathControl, needsPosixPaths, needsPosixPermissions, needsPosixSpecialFiles, needsShebang, needsSymlinks, needsUnreadableDirs } from "./platform.mjs";
import fs, { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installWithoutStripper, FLOW_SOURCE } from "./no-stripper.mjs";
import { addWorktree, git, scratch } from "./git-worktrees.mjs";

import { needsRuby } from "./ruby-available.mjs";
import { check, severityFor, unreadReason, unreadCode } from "../plugins/anatomiya/lib/check.mjs";
import { renamesSkipped } from "../plugins/anatomiya/lib/changeset.mjs";
import { formatReport, formatReportJson, CAVEATS } from "../plugins/anatomiya/lib/check-report.mjs";
import { scan } from "../plugins/anatomiya/lib/scan.mjs";
import { writeMap } from "../plugins/anatomiya/lib/write.mjs";
import { writeFacts } from "../plugins/anatomiya/lib/facts.mjs";
import { renderArea } from "../plugins/anatomiya/lib/render.mjs";
import { buildPin, writePin } from "../plugins/anatomiya/lib/baseline.mjs";
import { collect } from "../plugins/anatomiya/lib/corpus.mjs";
import { discover } from "../plugins/anatomiya/lib/areas.mjs";
import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { runNotice } from "../plugins/anatomiya/lib/hook-verbs.mjs";

// The area record carries a glob in the two halves it is composed from.
const glob = (dir) => ({ negated: false, dir, tail: "**/*.ts" });

/**
 * Every case here builds a real git repository, because the properties under
 * test are properties of the diff: a rename, a line shift, and a base branch
 * that moved ahead are all invisible to a fixture.
 *
 * Cleanup is registered before the build runs, so a failed assertion leaves no
 * temporary repository behind.
 */
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("checkout", "-q", "-b", "main");

  const write = (rel, body) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const commit = (msg) => {
    git("add", "-A");
    git("commit", "-qm", msg);
  };
  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  build({ dir, git, write, commit, read });
  return dir;
}

const swallow = (n) =>
  Array.from({ length: n }, (_, i) => `export function f${i}() { try { go${i}() } catch (e) { } }`).join("\n") + "\n";

const clean = (n) =>
  Array.from({ length: n }, (_, i) => `export function g${i}() { try { go${i}() } catch (e) { log(e) } }`).join("\n") + "\n";

const dim = (o = {}) => ({
  key: "swallowed_error",
  precision: "precise",
  directive: true,
  gate: null,
  applicability: 6,
  candidates: 60,
  conforming: 60,
  exceptions: [],
  baseline: { candidates: 60, conforming: 60, exceptions: [] },
  ...o,
});

/**
 * The two files the check reads: the rendered map's facts, and the pin that
 * says which files the baseline population held. They are separate on disk
 * because the pin stores no counts, so there is nothing to fall back to when
 * its sha goes unreachable.
 */
function facts(dir, { sha, dimensions = [dim()], path = "src", fileCount = 8, pinned = null, areas = null, capabilities = [] } = {}) {
  const store = join(dir, ".claude/anatomiya");
  mkdirSync(store, { recursive: true });
  const mapped = areas
    || [{ id: "aaaaaaaa", path, globs: [glob(path)], fileCount, dimensions }];
  // Through the writer, never hand-built. This fixture used to spell `schema: 1`
  // while the writer emitted 3, so every one of these tests read the check
  // against a shape nothing had produced for two versions.
  writeFacts(dir, {
    root: dir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    corpus: { files: fileCount, frameworks: [], capabilities },
    parse: { parsed: fileCount },
    suppressAll: false,
    areas: mapped,
  });
  if (!sha) return;
  writeFileSync(
    join(store, "baseline.json"),
    JSON.stringify({
      schema: 1,
      sha,
      areas: mapped.map((a) => ({
        id: a.id,
        path: a.path,
        files: pinned || Array.from({ length: fileCount }, (_, i) => `${a.path}/f${i}.ts`),
      })),
    })
  );
}

const sha = (dir, ref = "HEAD") =>
  execFileSync("git", ["rev-parse", ref], { cwd: dir, encoding: "utf8" }).trim();

const forKey = (report, key) => report.findings.filter((f) => f.dimension === key);

/** A caveat is a code and a sentence; these cases are about the sentence. */
const notes = (report) => report.caveats.map((c) => c.message);

/**
 * A "reports nothing" assertion is only worth anything if the file reached the
 * parser. Every one of the negative cases would otherwise pass just as well on
 * a check that skipped the file for being unreadable.
 */
function assertExamined(report, path) {
  assert.ok(
    report.examined.some((c) => c.path === path),
    `${path} was never examined, so the case proves nothing`
  );
  const skipped = notes(report).filter((m) => m.includes(path));
  assert.deepEqual(skipped, [], `${path} was skipped: ${skipped.join("; ")}`);
}

/**
 * A Rails-shaped repository, scanned and pinned for real.
 *
 * The precedent rule reads `layout.roots`, which the hand-built `facts` helper
 * above never writes, so a fixture there proves nothing about the wiring: the
 * counts have to come off a scan of a real tree. That tree is Ruby, so every
 * case on it carries `needsRuby` and skips where the tool would refuse it.
 */
async function railsish(t, { pin = true } = {}) {
  const dir = repo(t, ({ write, commit }) => {
    for (const n of ["admin", "user", "hubspot", "cim_share"]) {
      write(`app/mailers/${n}_mailer.rb`, `class ${n}Mailer < ApplicationMailer\nend\n`);
    }
    for (const n of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
      write(`app/services/${n}.rb`, `class ${n}\nend\n`);
      write(`spec/services/${n}_spec.rb`, `RSpec.describe ${n} do\nend\n`);
    }
    commit("init");
  });
  // A scan that could not read the Ruby writes no map, and the rule then has
  // nothing to answer from: the cases below expecting no finding passed on
  // that alone, with no Ruby on the machine at all.
  const plan = writeMap(await scan(dir), {});
  assert.equal(plan.blind, false, "the scan read the Ruby tree and wrote a map");
  // Pinned as well as scanned: with no pin the map reads stale and every
  // finding caps at NIT, so an unpinned fixture proves nothing about severity.
  if (!pin) return dir;
  const { files } = await collect(dir);
  writePin(dir, buildPin(discover(files), { sha: sha(dir), corpus: files.length }));
  return dir;
}

test("a test added where its own siblings have none is a finding, and one added beside theirs is not", needsRuby, async (t) => {
  // The whole of H38, read off a scan rather than a fixture: `spec/mailers/`
  // did not exist before the change, so every content rule finds the file
  // conforming with itself and only this one asks whether it belongs there.
  const dir = await railsish(t);
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  writeFileSync(join(dir, "spec/services/eta_spec.rb"), "RSpec.describe Eta do\nend\n");
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/cim_share_mailer_spec.rb"), "RSpec.describe CimShareMailer do\nend\n");
  git("add", "-A");
  git("commit", "-qm", "specs");

  const report = await check(dir, { baseRef: base });
  const found = forKey(report, "test_precedent");

  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].path, "spec/mailers/cim_share_mailer_spec.rb");
  assert.equal(found[0].severity, "FIX");
  assert.match(found[0].reason, /app\/mailers: 0 of 4 \.rb files have a namesake test/);
});

// One tested directory and one bare one per language, each in the layout that language's repositories keep, and each a
// root of its own: a module per directory where the build has modules, a project where it has projects.
const PLACED = {
  python: { source: (d, n) => [`src/${d}/m${n}.py`, `def f${n}():\n    return ${n}\n`], spec: (d, n) => [`src/${d}/test_m${n}.py`, `def test_f${n}():\n    assert True\n`] },
  go: { source: (d, n) => [`${d}/m${n}.go`, `package ${d}\n\nfunc F${n}() int { return ${n} }\n`], spec: (d, n) => [`${d}/m${n}_test.go`, `package ${d}\n\nimport "testing"\n\nfunc TestF${n}(t *testing.T) {}\n`] },
  java: {
    source: (d, n) => [`${d}/src/main/java/shop/${d}/M${n}.java`, `package shop.${d};\n\nclass M${n} {\n}\n`],
    spec: (d, n) => [`${d}/src/test/java/shop/${d}/M${n}Test.java`, `package shop.${d};\n\nimport org.junit.jupiter.api.Test;\n\nclass M${n}Test {\n    @Test\n    void runs() {}\n}\n`],
  },
  kotlin: {
    source: (d, n) => [`${d}/src/main/kotlin/shop/${d}/M${n}.kt`, `package shop.${d}\n\nclass M${n}\n`],
    spec: (d, n) => [`${d}/src/test/kotlin/shop/${d}/M${n}Test.kt`, `package shop.${d}\n\nimport kotlin.test.Test\n\nclass M${n}Test {\n    @Test\n    fun runs() {\n    }\n}\n`],
  },
  csharp: {
    source: (d, n) => [`src/${d}/M${n}.cs`, `namespace Shop;\n\npublic class M${n}\n{\n}\n`],
    spec: (d, n) => [`test/${d}.Tests/M${n}Tests.cs`, `namespace Shop.Tests;\n\npublic class M${n}Tests\n{\n    [Fact]\n    public void Runs() {}\n}\n`],
  },
  php: {
    source: (d, n) => [`src/${d}/M${n}.php`, `<?php\n\nclass M${n}\n{\n}\n`],
    spec: (d, n) => [`tests/${d}/M${n}Test.php`, `<?php\n\nclass M${n}Test extends TestCase\n{\n    public function testRuns(): void\n    {\n    }\n}\n`],
  },
};

// Where the language's own tool fixes the one place a test sits, and the fixture's layout is that place.
const FIXED = new Set(["go", "java", "kotlin", "csharp"]);

for (const [lang, { source, spec }] of Object.entries(PLACED)) {
  const title = FIXED.has(lang)
    ? `${lang}: a first test added in the one place its tool reads it from is no finding`
    : `${lang}: a test added where its own siblings have none is a finding, and one added beside theirs is not`;
  test(title, async (t) => {
    const dir = repo(t, ({ write, commit }) => {
      for (let n = 0; n < 5; n++) {
        write(...source("tested", n));
        write(...spec("tested", n));
        write(...source("bare", n));
      }
      commit("init");
    });
    writeMap(await scan(dir), {});
    const { files } = await collect(dir);
    writePin(dir, buildPin(discover(files), { sha: sha(dir), corpus: files.length }));
    const base = sha(dir);
    for (const [rel, body] of [spec("tested", 9), spec("bare", 9)]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-qm", "two tests"], { cwd: dir, stdio: "pipe" });

    const found = forKey(await check(dir, { baseRef: base }), "test_precedent");

    if (FIXED.has(lang)) return assert.deepEqual(found, []);
    assert.deepEqual(found.map((f) => [f.path, f.severity]), [[spec("bare", 9)[0], "FIX"]], JSON.stringify(found));
    assert.match(found[0].reason, /holds no other test; .*bare: 0 of 5 \.\w+ files have a namesake test$/);
  });
}

const five = (make, ...at) => [0, 1, 2, 3, 4].map((n) => make(...at, n));
const goIn = (d, n) => [`${d}/m${n}.go`, `package ${d.split("/").at(-1)}\n\nfunc F${n}() int { return ${n} }\n`];
const goTestIn = (d, n) => [`${d}/m${n}_test.go`, `package ${d.split("/").at(-1)}\n\nimport "testing"\n\nfunc TestF${n}(t *testing.T) {}\n`];
const pyIn = (d, n) => [`${d}/m${n}.py`, `def f${n}():\n    return ${n}\n`];
const pyTestIn = (d, n) => [`${d}/test_m${n}.py`, `def test_f${n}():\n    assert True\n`];
const rustIn = (crate, n) => [`${crate}/src/m${n}.rs`, `pub fn f${n}() -> i32 { ${n} }\n`];
const PY_TEST = "def test_x():\n    assert True\n";
const rbIn = (d, n) => [`${d}/m${n}.rb`, `class M${n}\n  def run\n    ${n}\n  end\nend\n`];
const rbSpecIn = (d, n) => [`${d}/m${n}_spec.rb`, `RSpec.describe M${n} do\n  it "runs" do\n  end\nend\n`];
const jsIn = (d, n) => [`${d}/m${n}.js`, `export function f${n}() {\n  return ${n};\n}\n`];
const jsTestIn = (d, n) => [`${d}/m${n}.test.js`, `import { test } from "node:test";\ntest("f${n}", () => {});\n`];
const RB_TREE = [...five(rbIn, "app/tested"), ...five(rbSpecIn, "spec/tested"), ...five(rbIn, "app/bare")];
const JS_TREE = [...five(jsIn, "src/tested"), ...five(jsTestIn, "src/tested"), ...five(jsIn, "src/bare")];
const PY_TREE = [...five(pyIn, "src/tested"), ...five(pyTestIn, "src/tested"), ...five(pyIn, "src/bare")];
const PHP_TREE = [...five(PLACED.php.source, "Tested"), ...five(PLACED.php.spec, "Tested"), ...five(PLACED.php.source, "Bare"), ["composer.json", "{}\n"]];
const MAVEN_TREE = [...five(PLACED.java.source, "tested"), ...five(PLACED.java.spec, "tested"), ...five(PLACED.java.source, "bare"), ["pom.xml", "<project/>\n"]];
const four = (make, ...at) => [0, 1, 2, 3].map((n) => make(...at, n));
const paths = (files) => files.map(([rel]) => rel);

// A first test, in the shapes a corpus of existing tests cannot hold: [name, the base tree, what the branch adds, the paths found].
const FIRST_TESTS = [
  ["Go: the first test of a package whose sibling package has its own",
    [...five(goIn, "tested"), ...five(goTestIn, "tested"), ...five(goIn, "bare"), ["go.mod", "module x\n"]], [goTestIn("bare", 0)], []],
  ["Go: a new package below an untested one, with its source and its test",
    [...five(goIn, "tested"), ...five(goTestIn, "tested"), ...five(goIn, "bare"), ["go.mod", "module x\n"]], [goIn("bare/fresh", 0), goTestIn("bare/fresh", 0)], []],
  ["Go: a new package below a directory that folds a tested one",
    [...five(goIn, "pkg/tested"), ...five(goTestIn, "pkg/tested"), ...five(goIn, "pkg/bare"), ["go.mod", "module x\n"]], [goIn("pkg/fresh", 0), goTestIn("pkg/fresh", 0)], []],
  ["Maven: a module's first src/test", [...five(PLACED.java.source, "tested"), ...five(PLACED.java.spec, "tested"), ...five(PLACED.java.source, "bare"), ["pom.xml", "<project/>\n"]], [PLACED.java.spec("bare", 0)], []],
  ["C#: a project's first test project",
    [...five(PLACED.csharp.source, "Tested"), ...five(PLACED.csharp.spec, "Tested"), ...five(PLACED.csharp.source, "Bare")], [PLACED.csharp.spec("Bare", 0), ["test/Bare.Tests/Bare.Tests.csproj", "<Project/>\n"]], []],
  ["Python: a first test beside untested code, where the tested package keeps its tests beside its own",
    [...five(pyIn, "src/tested"), ...five(pyTestIn, "src/tested"), ...five(pyIn, "src/bare")], [pyTestIn("src/bare", 0)], ["src/bare/test_m0.py"]],
  ["Python: a package's own tests directory, where tests live in a top-level tree",
    [...five(pyIn, "pkga"), ...five(pyIn, "pkgb"), ...five(pyTestIn, "tests"), ["pkga/__init__.py", ""], ["pkgb/__init__.py", ""]], [["pkgb/tests/test_m0.py", PY_TEST]], []],
  ["Python: one more test in the top-level tree",
    [...five(pyIn, "pkga"), ...five(pyIn, "pkgb"), ...five(pyTestIn, "tests"), ["pkga/__init__.py", ""], ["pkgb/__init__.py", ""]], [["tests/test_other.py", PY_TEST]], []],
  ["Rust: a crate's first tests directory",
    [["Cargo.toml", `[workspace]\nmembers=["a","b"]\n`], ["a/Cargo.toml", `[package]\nname="a"\n`], ["b/Cargo.toml", `[package]\nname="b"\n`], ...five(rustIn, "a"), ...five(rustIn, "b"), ...[0, 1, 2, 3, 4].map((n) => [`a/tests/t${n}.rs`, `#[test]\nfn t${n}() {}\n`])],
    [["b/tests/first.rs", "#[test]\nfn first() {}\n"]], []],
  // The directory the test is about arrives with it, so the untested directory above has said nothing about it.
  ["Python: a new package below an untested one, with its source and its test",
    [...five(pyIn, "src/tested"), ...five(pyTestIn, "src/tested"), ...five(pyIn, "src/bare")], [pyIn("src/bare/fresh", 0), pyTestIn("src/bare/fresh", 0)], [], ["src/bare/fresh/test_m0.py"]],
  ["Python: a first test in a package the base already held below an untested one",
    [...five(pyIn, "src/tested"), ...five(pyTestIn, "src/tested"), ...five(pyIn, "src/bare"), pyIn("src/bare/old", 9)], [pyTestIn("src/bare/old", 9)], ["src/bare/old/test_m9.py"]],
  // A directory holding nothing but the tests the change wrote was made for them, and is the directory this asks about.
  // The notice speaks of the first alone: once that one is written the directory holds a test.
  ["Ruby: four specs in a directory the change invented, with no source directory of its name",
    RB_TREE, four(rbSpecIn, "spec/bare/fresh"), paths(four(rbSpecIn, "spec/bare/fresh")), ["spec/bare/fresh/m0_spec.rb"]],
  ["JavaScript: four tests in a directory the change invented, with no source beside them",
    JS_TREE, four(jsTestIn, "src/bare/fresh/__tests__"), paths(four(jsTestIn, "src/bare/fresh/__tests__")), ["src/bare/fresh/__tests__/m0.test.js"]],
  ["JavaScript: a test and its helper in a directory the change invented",
    JS_TREE, [jsTestIn("src/bare/fresh/__tests__", 0), jsIn("src/bare/fresh/__tests__", 1)], ["src/bare/fresh/__tests__/m0.test.js"]],
  // Beside the test, a file no test could be written for: the directory was still made for the test.
  ["JavaScript: a test beside an empty index in a directory the change invented",
    JS_TREE, [jsTestIn("src/bare/fresh", 0), ["src/bare/fresh/index.js", ""]], ["src/bare/fresh/m0.test.js"]],
  ["JavaScript: a test beside a file in no language this reads, in a directory the change invented",
    JS_TREE, [jsTestIn("src/bare/fresh", 0), ["src/bare/fresh/README.md", "# fresh\n"]], ["src/bare/fresh/m0.test.js"]],
  ["JavaScript: a test beside a declaration file in a directory the change invented",
    JS_TREE, [jsTestIn("src/bare/fresh", 0), ["src/bare/fresh/types.d.ts", "export declare const n: number;\n"]], ["src/bare/fresh/m0.test.js"]],
  ["JavaScript: a test beside a story in a directory the change invented",
    JS_TREE, [jsTestIn("src/bare/fresh", 0), ["src/bare/fresh/m0.stories.js", "export default { title: \"m0\" };\n"]], ["src/bare/fresh/m0.test.js"]],
  ["Python: a test beside the file its runner loads, in a directory the change invented",
    PY_TREE, [pyTestIn("src/bare/fresh", 0), ["src/bare/fresh/conftest.py", "import pytest\n\n@pytest.fixture\ndef client():\n    return 1\n"]], ["src/bare/fresh/test_m0.py"]],
  ["Python: a test alone in a directory the change invented", PY_TREE, [pyTestIn("src/bare/fresh", 0)], ["src/bare/fresh/test_m0.py"]],
  ["PHP: a test for a source directory that exists nowhere", PHP_TREE, [PLACED.php.spec("Bare/Fresh", 0)], ["tests/Bare/Fresh/M0Test.php"]],
  ["Java: a test in a flat directory the build pairs with nothing",
    MAVEN_TREE, [["bare/test/shop/bare/M0Test.java", PLACED.java.spec("bare", 0)[1]]], ["bare/test/shop/bare/M0Test.java"]],
  ["Ruby: a first spec for a directory the base already held", [...RB_TREE, rbIn("app/bare/old", 9)], [rbSpecIn("spec/bare/old", 9)], ["spec/bare/old/m9_spec.rb"]],
  ["Ruby: a new directory with its source and its spec",
    RB_TREE, [rbIn("app/bare/fresh", 0), rbSpecIn("spec/bare/fresh", 0)], [], ["spec/bare/fresh/m0_spec.rb"]],
  ["JavaScript: a new directory with its source and its test",
    JS_TREE, [jsIn("src/bare/fresh", 0), jsTestIn("src/bare/fresh/__tests__", 0)], [], ["src/bare/fresh/__tests__/m0.test.js"]],
  ["Python: a test in a directory the change invented, beside a file of another language and with source added elsewhere",
    PY_TREE, [pyTestIn("src/bare/fresh", 0), jsIn("src/bare/fresh", 1), pyIn("src/tested", 7)], ["src/bare/fresh/test_m0.py"]],
  // git lists the inner directory alone when asked of both, and the outer one is still the base's.
  ["Python: tests for a package the base held and for one inside it, with source added to both",
    [...PY_TREE, pyIn("src/bare/old", 9), pyIn("src/bare/old/deep", 8)],
    [pyIn("src/bare/old", 7), pyIn("src/bare/old/deep", 6), pyTestIn("src/bare/old", 9), pyTestIn("src/bare/old/deep", 8)],
    ["src/bare/old/deep/test_m8.py", "src/bare/old/test_m9.py"], ["src/bare/old/test_m9.py", "src/bare/old/deep/test_m8.py"]],
];

for (const [name, tree, added, found, noticed = found] of FIRST_TESTS) {
  test(`a first test: ${name}`, name.startsWith("Ruby") ? needsRuby : {}, async (t) => {
    const dir = repo(t, ({ write, commit }) => {
      for (const [rel, body] of tree) write(rel, body);
      commit("init");
    });
    writeMap(await scan(dir), {});
    const { files } = await collect(dir);
    writePin(dir, buildPin(discover(files), { sha: sha(dir), corpus: files.length }));
    const base = sha(dir);

    // The notice is asked before each file exists, in the order a session writes them.
    const said = [];
    for (const [rel, body] of added) {
      const write = { hook_event_name: "PreToolUse", tool_name: "Write", cwd: dir, tool_input: { file_path: join(dir, rel) } };
      if ((await runNotice(dir, write)).hookSpecificOutput) said.push(rel);
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-qm", "a first test"], { cwd: dir, stdio: "pipe" });

    const report = forKey(await check(dir, { baseRef: base }), "test_precedent");

    assert.deepEqual(report.map((f) => [f.path, f.severity]), found.map((rel) => [rel, "FIX"]), JSON.stringify(report));
    assert.deepEqual(said, noticed, "the notice before the write");
  });
}

test("a test still sitting in the working tree is asked the same question as a committed one", needsRuby, async (t) => {
  // The whole reason this reads the tree: the answer is wanted before the
  // commit, not after. An addition arrives from `git status` rather than from
  // the diff, and a relocation arrives from it spelled `M` with an `orig`,
  // never `R`, so a rule reading the status letters let the staged move past.
  const dir = await railsish(t);
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/cim_share_mailer_spec.rb"), "RSpec.describe CimShareMailer do\nend\n");
  git("mv", "spec/services/zeta_spec.rb", "spec/mailers/zeta_mailer_spec.rb");

  const found = forKey(await check(dir, { baseRef: base }), "test_precedent");
  const byPath = new Map(found.map((f) => [f.path, f]));

  assert.equal(found.length, 2, JSON.stringify(found));
  assert.equal(byPath.get("spec/mailers/cim_share_mailer_spec.rb").oldPath, null);
  assert.equal(byPath.get("spec/mailers/zeta_mailer_spec.rb").oldPath, "spec/services/zeta_spec.rb");
});

test("an unpinned repository still gets the finding at the ceiling its own header names", needsRuby, async (t) => {
  // What makes this rule cap is the comparison, since that is what says a file
  // arrived; a map with no pin caps at FIX like every other rule and does not
  // stop the diff saying `A`. Reading the two together printed a NIT saying the
  // run could not establish what the change added, on a run that had.
  const dir = await railsish(t, { pin: false });
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/cim_share_mailer_spec.rb"), "RSpec.describe CimShareMailer do\nend\n");
  git("add", "-A");
  git("commit", "-qm", "spec");

  const [found] = forKey(await check(dir, { baseRef: base }), "test_precedent");

  assert.equal(found.severity, "FIX");
  assert.doesNotMatch(found.reason, /could not establish/);
});

test("a change that invents a directory and fills it is not excused by its own first file", needsRuby, async (t) => {
  // What "already holds a test" means differs between the two callers. The
  // hook asks the disk, where nothing yet comes from the write it is about; a
  // check has to leave out everything the same change brought, or three of
  // four specs are excused by the first one landing.
  const dir = await railsish(t);
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  for (const n of ["admin", "user", "hubspot"]) {
    writeFileSync(join(dir, `spec/mailers/${n}_mailer_spec.rb`), `RSpec.describe ${n} do\nend\n`);
  }
  git("add", "-A");
  git("commit", "-qm", "specs");

  const found = forKey(await check(dir, { baseRef: base }), "test_precedent");

  assert.equal(found.length, 3, JSON.stringify(found.map((f) => f.path)));
  for (const f of found) assert.match(f.reason, /^spec\/mailers holds no other test;/);
});

test("an index this cannot read is not a repository with no tests in it", needsRuby, async (t) => {
  // C33 at this reader. What decides whether the finding prints is whether the
  // directory already holds a test, and a listing that failed answers neither
  // yes nor no: printed as no, the run states a fact it never read.
  const dir = await railsish(t);
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/admin_mailer_spec.rb"), "RSpec.describe Admin do\nend\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "first spec");
  const base = sha(dir);

  writeFileSync(join(dir, "spec/mailers/user_mailer_spec.rb"), "RSpec.describe User do\nend\n");
  git("add", "-A");
  git("commit", "-qm", "second spec");
  writeFileSync(join(dir, ".git/index"), "not an index");

  assert.deepEqual(forKey(await check(dir, { baseRef: base }), "test_precedent"), []);
});

test("a file git does not track is not this repository's habit", needsRuby, async (t) => {
  // The only read here that does not come through `git ls-files`, so it was the
  // only one counting build output and scratch files. One ignored
  // `scratch_spec.rb` in the directory silenced the rule for every file in it.
  const dir = await railsish(t);
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "spec/mailers/scratch_spec.rb\n");
  writeFileSync(join(dir, "spec/mailers/scratch_spec.rb"), "RSpec.describe Scratch do\nend\n");
  for (const n of ["admin", "user"]) {
    writeFileSync(join(dir, `spec/mailers/${n}_mailer_spec.rb`), `RSpec.describe ${n} do\nend\n`);
  }
  git("add", "-A");
  git("commit", "-qm", "specs");

  const found = forKey(await check(dir, { baseRef: base }), "test_precedent");

  assert.deepEqual(found.map((f) => f.path).sort(), [
    "spec/mailers/admin_mailer_spec.rb",
    "spec/mailers/user_mailer_spec.rb",
  ]);
});

test("a test landing beside one that was already there is following it", needsRuby, async (t) => {
  // Issue 120 asked for both halves: "a test file in a directory holding no
  // other test file, in a repository whose sibling ratio for that kind is 0 of
  // N". The root's ratio alone flagged a spec that had a sibling right there.
  const dir = await railsish(t);
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/admin_mailer_spec.rb"), "RSpec.describe Admin do\nend\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "first spec");
  const base = sha(dir);

  writeFileSync(join(dir, "spec/mailers/user_mailer_spec.rb"), "RSpec.describe User do\nend\n");
  git("add", "-A");
  git("commit", "-qm", "second spec");

  assert.deepEqual(forKey(await check(dir, { baseRef: base }), "test_precedent"), []);
});

test("a test moved into a directory with no precedent is the same deviation as one written there", needsRuby, async (t) => {
  // git reports a relocation as `R`, so a rule reading only `A` let the move
  // past while refusing the identical file written fresh.
  const dir = await railsish(t);
  const base = sha(dir);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  git("mv", "spec/services/zeta_spec.rb", "spec/mailers/zeta_mailer_spec.rb");
  git("commit", "-qm", "move");

  const [found] = forKey(await check(dir, { baseRef: base }), "test_precedent");

  assert.equal(found.path, "spec/mailers/zeta_mailer_spec.rb");
  assert.equal(found.oldPath, "spec/services/zeta_spec.rb");
});

test("a rename with no content change reports nothing", async (t) => {
  // Keying on path plus line would forge every site in the file: a pure git mv
  // changes the path of all of them and moves none of them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    write("src/other.ts", clean(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    commit("move it");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "compare");
  assertExamined(r, "src/moved.ts");
  assert.deepEqual(r.findings, [], "a move introduces no violation");
});

test("a rename that also adds a violation reports only the new site", async (t) => {
  // The control for the case above: following the rename must not cost the
  // ability to see what the same commit actually introduced.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    write("src/moved.ts", swallow(4));
    commit("move it and add one");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, "three carried sites are absorbed, the fourth is new");
  assert.equal(hits[0].path, "src/moved.ts");
  assert.equal(hits[0].oldPath, "src/legacy.ts");
});

test("an import added above existing violations reports nothing", async (t) => {
  // One added import shifts every line below it. A position key would report
  // three untouched catch blocks as newly written.
  const dir = repo(t, ({ git, write, commit, read }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", `import { go0 } from "./go"\n\n${read("src/a.ts")}`);
    commit("add an import");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/a.ts");
  assert.deepEqual(r.findings, [], "shifted lines are the same sites");
});

test("a base branch that moved ahead contributes no findings", async (t) => {
  // The three-dot diff is the whole point: two dots compares the endpoints and
  // hands the author every file the base branch changed since the fork.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(3));
    write("src/mine.ts", clean(2));
    commit("init");

    git("checkout", "-q", "-b", "work");
    write("src/mine.ts", clean(2) + swallow(1));
    commit("my change");

    git("checkout", "-q", "main");
    write("src/theirs.ts", swallow(4));
    commit("someone else's change");
    git("checkout", "-q", "work");
  });
  facts(dir, { sha: sha(dir, "work") });

  const r = await check(dir, { baseRef: "main" });
  const paths = new Set(r.findings.map((f) => f.path));

  assert.ok(r.findings.length > 0, "the author's own new violation is still reported");
  assert.deepEqual([...paths], ["src/mine.ts"]);
  assert.equal(r.changed.some((c) => c.path === "src/theirs.ts"), false);
});

test("a file the map names as an exception never reaches MUST-FIX", async (t) => {
  // The map told the agent this file is exempt so it would not refactor it.
  // Severity derived from the area ratio alone would flag it forever.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", clean(2));
    write("src/fresh.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/legacy.ts", clean(2) + swallow(1));
    write("src/fresh.ts", clean(2) + swallow(1));
    commit("touch both");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ exceptions: [{ path: "src/legacy.ts", count: 2 }] })],
  });

  const r = await check(dir, { baseRef: "main" });
  const bySeverity = Object.fromEntries(
    forKey(r, "swallowed_error").map((f) => [f.path, f.severity])
  );

  assert.equal(bySeverity["src/legacy.ts"], "FIX");
  assert.equal(bySeverity["src/fresh.ts"], "MUST-FIX", "the control must still be top severity");
});

test("an exception listed under the pre-rename path still exempts the file", async (t) => {
  // The map named the path it saw at scan time. A rename in the change under
  // review must not silently revoke the exemption the map granted.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/renamed.ts");
    write("src/renamed.ts", clean(2) + swallow(1));
    commit("rename and add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ exceptions: [{ path: "src/legacy.ts", count: 2 }] })],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "FIX");
});

test("a partial dimension never reaches MUST-FIX", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a() { return { ok: true } }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", `export function a() { return { ok: true } }\nexport function b() { throw new Error("x") }\n`);
    commit("throw");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({
        key: "error_shape",
        precision: "partial",
        candidates: 60,
        conforming: 60,
        baseline: { candidates: 60, conforming: 60, exceptions: [] },
      }),
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "error_shape");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "FIX", "a predicate that under-counts cannot demand a fix");
});

test("a stale map caps severity instead of stopping the check", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: "0".repeat(40) });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /unreachable/);
  assert.equal(hits.length, 1, "a stale map still reports");
  assert.equal(hits[0].severity, "FIX");
});

test("a map with no pin at all caps severity", async (t) => {
  // Counts with nothing behind them are the agent's own output. Without a pin
  // there is no population that predates the branch.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: null });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /no baseline pinned/);
  assert.equal(hits[0].severity, "FIX");
});

test("a pin that will not load caps severity under its own reason, not as no pin", async (t) => {
  // A committed pin that a merge left conflict markers in capped every finding
  // with "no baseline pinned", in a repository that had one.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: null });
  writeFileSync(join(dir, ".claude/anatomiya/baseline.json"), "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n");

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.stale, true);
  assert.equal(r.staleReason, "the pin on disk could not be read because it does not parse as JSON");
  assert.equal(forKey(r, "swallowed_error")[0].severity, "FIX");
});

test("a dimension a gate suppressed cannot demand anything", async (t) => {
  // The check may only enforce what the map stated. A suppressed dimension is
  // one the map explicitly declined to state.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ directive: false, gate: "authors" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.match(hits[0].reason, /authors/);
});

test("a file in no mapped area is a NIT", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("tools/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("tools/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.equal(hits[0].area, null);
});

test("a dimension the map never counted inside an area is not reported at all", async (t) => {
  // Inside a mapped area the scan recorded every dimension it saw a site of, so
  // a key missing from that list is one the map deliberately said nothing
  // about. Outside every area nothing was measured, which is what the NIT is
  // for, and the same source is written to both places to prove the difference
  // is the map rather than the code.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("tools/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    write("tools/a.ts", clean(2) + swallow(1));
    commit("swallow in both");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    forKey(r, "swallowed_error").map((f) => f.path),
    ["tools/a.ts"]
  );
});

test("the deepest area containing a file supplies its claims", async (t) => {
  // Nested areas both contain the path. Reading the shallower one would judge
  // the file against a convention counted over a different population.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/api/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      {
        id: "bbbbbbbb",
        path: "src/api",
        globs: [glob("src/api")],
        fileCount: 8,
        dimensions: [dim({ directive: false, gate: "authors" })],
      },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].area, "src/api");
  assert.equal(hits[0].severity, "NIT", "the deeper area suppressed this dimension");
});

test("a worktree with no map of its own is pointed at its main checkout's", async (t) => {
  // The hooks borrow the main checkout's counts there; a check a person runs
  // has to compare the branch against a map of its own, so it says where one is.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  const wt = addWorktree(dir, join(scratch(t), "wt"), "work");

  const before = (await check(wt, { baseRef: "main" })).caveats.find((c) => c.code === CAVEATS.NO_MAP);
  assert.equal(before.message, "no map on disk, so nothing was stated and nothing can be enforced", "no map anywhere");

  await writeMap(await scan(dir), {});
  const r = await check(wt, { baseRef: "main" });
  const said = r.caveats.find((c) => c.code === CAVEATS.NO_MAP);

  assert.ok(said, "still no map here");
  assert.ok(said.message.endsWith(`Its main checkout has one: ${realpathSync.native(dir)}`), said.message);
  assert.match(said.message, /run `\/anatomiya:scan` here/);
});

test("the way out of a mapless worktree, and where it leads, survive the report's length cap", async (t) => {
  // Caveats are rendered through a 200-grapheme cap, and a path in front of
  // the instruction cut the instruction off first.
  const parent = scratch(t, "cap-");
  assert.ok(parent.length < 89, "the temp root leaves no room to build the ninety-character case");
  // Ninety characters, a long home directory's worth, whatever the temp root is.
  const main = join(parent, "m".repeat(90 - parent.length - 1));
  mkdirSync(join(main, "src"), { recursive: true });
  writeFileSync(join(main, "src/a.ts"), clean(2));
  git(main, "init", "-q", "-b", "main");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  await writeMap(await scan(main), {});
  const wt = addWorktree(main, join(parent, "wt"), "work");

  const r = await check(wt, { baseRef: "main" });

  // Read out of the JSON rather than searched in it, where a Windows path's
  // backslashes arrive escaped.
  const noMap = JSON.parse(formatReportJson(r)).caveats.find((c) => c.code === CAVEATS.NO_MAP).message;
  for (const rendered of [formatReport(r), noMap]) {
    assert.match(rendered, /run `?\/anatomiya:scan`? here/);
    assert.ok(rendered.includes(main), "and the checkout it names is there whole");
  }

  // Past what the cap leaves, the path loses its tail and the way out stays.
  const deep = join(parent, "d".repeat(150 - parent.length - 1));
  mkdirSync(join(deep, "src"), { recursive: true });
  writeFileSync(join(deep, "src/a.ts"), clean(2));
  git(deep, "init", "-q", "-b", "main");
  git(deep, "add", "-A");
  git(deep, "commit", "-qm", "init");
  await writeMap(await scan(deep), {});
  const far = await check(addWorktree(deep, join(parent, "far"), "work"), { baseRef: "main" });
  assert.match(formatReport(far), /run `?\/anatomiya:scan`? here\. Its main checkout has one: /);
});

test("no map on disk enforces nothing and says so", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.ok(r.caveats.some((c) => c.code === CAVEATS.NO_MAP));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT");
  assert.equal(hits[0].area, null);
});

test("a changed Ruby file is parsed by prism and its new violation is reported", needsRuby, async (t) => {
  // Ruby reaches the check through the same scratch-directory read as oxc, one
  // prism subprocess rather than the pool. Excluding it would state Ruby
  // conventions in the map and enforce none of them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.rb", "def a\n  1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n");
    commit("rescue");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "rescue_uses_error" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(r.changed.some((c) => c.path === "src/a.rb"));
  assert.deepEqual(
    r.examined.map((c) => c.path),
    ["src/a.rb"],
    "a Ruby file in the diff is examined, not skipped"
  );
  assert.ok(
    !notes(r).some((m) => /could not be parsed|not examined/.test(m)),
    `no parse caveat: ${notes(r).join(" | ")}`
  );
  assert.equal(r.findings.length, 1, "the rescue that ignores its error is newly introduced");
  assert.equal(r.findings[0].dimension, "rescue_uses_error");
  assert.equal(r.findings[0].path, "src/a.rb");
  assert.equal(r.findings[0].line, 4, "prism reports a line even with no byte offsets");
});

test("a changed file the parser cannot read is named, not silently skipped", async (t) => {
  // A file that answers `ok: false` is skipped by every loop that walks a
  // program, which is right, and reported by none of them, which is the same
  // silence the scan had: an empty finding list reads as "conforms".
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", "export const a = 1\nfoo(\n");
    commit("break it");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  // Named, whatever the cause turned out to be: the sibling case above pins
  // which sentence each cause gets, this one pins that the file is reported.
  assert.ok(
    notes(r).some((m) => m.includes("src/a.ts")),
    `expected a parse caveat naming the file: ${notes(r).join(" | ")}`
  );
  assert.equal(r.findings.length, 0, "and nothing is claimed about a file nobody could read");
});

test("a diff the check could not read is not reported as a branch that changed nothing", async (t) => {
  // Every git call in the check reads its output without looking at the exit
  // code, so a diff that fails comes back as an empty change list: no file
  // examined, no finding, and a report shaped exactly like a clean branch.
  // The same silence as reporting clean for a file that was never parsed.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(6));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("add a swallow");
  });
  // The base commit object survives, so the base still resolves and every
  // earlier stage succeeds; its tree does not, so the diff cannot be produced.
  const tree = execFileSync("git", ["rev-parse", "main^{tree}"], { cwd: dir, encoding: "utf8" }).trim();
  rmSync(join(dir, ".git", "objects", tree.slice(0, 2), tree.slice(2)));

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.DIFF_UNREADABLE),
    `expected the unread diff to be named: ${notes(r).join(" | ")}`
  );
});

test("a map the scan actually wrote is one the check can enforce", async (t) => {
  // Every other case here hand-writes facts.json, and it hand-wrote a schema
  // the writer had stopped emitting two versions earlier. Nothing ran the
  // writer and the reader against each other, so the two were free to drift.
  const dir = repo(t, ({ write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(8));
    commit("init");
  });

  await writeMap(await scan(dir), {});

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("checkout", "-q", "-b", "work");
  writeFileSync(join(dir, "src", "f0.ts"), clean(8) + swallow(1));
  git("add", "-A");
  git("commit", "-qm", "swallow one");

  const r = await check(dir, { baseRef: "main" });

  const found = forKey(r, "swallowed_error");
  assert.equal(found.length, 1, `expected the written claim to be enforced: ${JSON.stringify(r.findings)}`);
  assert.notEqual(found[0].severity, "NIT", "a NIT here means the map was not read at all");
});

test("facts written by a newer scan are not read as if their shape were known", async (t) => {
  // The reader never looked at the schema it was handed, so a record whose
  // fields had moved would be read positionally and enforce a convention
  // nobody stated. The writer versions this file precisely so the two can
  // disagree out loud.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(6));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("add a swallow");
  });
  const store = join(dir, ".claude/anatomiya");
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(store, "facts.json"),
    JSON.stringify({
      schema: 99,
      areas: [{ id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] }],
    })
  );

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /schema/.test(m)),
    `expected the unreadable map to be named: ${notes(r).join(" | ")}`
  );
  assert.deepEqual(
    r.findings.filter((f) => f.severity !== "NIT"),
    [],
    "and nothing is enforced from a map this reader cannot read"
  );
});

test("a plain-Ruby branch is not asked a Rails question", needsRuby, async (t) => {
  // C8: `zone_aware_time` has no counter-claim, so off-Rails it can only ever
  // read zero, and one of the measured symptoms was a NIT delivered onto a
  // plain-Ruby branch. The scan learned the frameworks from the corpus and
  // stopped offering the dimension; the check never asked, so it still runs
  // every Rails claim against a repository holding none.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/thing.rb", "def a\n  1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("lib/thing.rb", "def a\n  Time.now\nend\n");
    commit("stamp it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    forKey(r, "zone_aware_time"),
    [],
    `no app/models, db/migrate or config/application.rb in this corpus: ${JSON.stringify(r.findings)}`
  );
});

test("a Rails branch is still asked the Rails question", needsRuby, async (t) => {
  // The pair above answers the same way if the fix were to stop offering the
  // dimension anywhere, and nothing else here would notice: the registry tests
  // cover `dimensionsFor`, not what the check does with it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User\n  def a\n    1\n  end\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/user.rb", "class User\n  def a\n    Time.now\n  end\nend\n");
    commit("stamp it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    forKey(r, "zone_aware_time").length,
    1,
    `app/models is the Rails signal: ${JSON.stringify(r.findings)}`
  );
});

test("a file that crashed the parser is named apart from one it merely rejected", async (t) => {
  // The third of the four causes the scan names. A crash is this tool's
  // problem and a syntax error is the file's, so folding them into one
  // sentence points the author at the wrong thing.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    // Deep nesting is the portable way to segfault oxc, which is why the
    // parser runs out of process at all.
    write("src/a.ts", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    commit("nest it");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /crashed/.test(m)),
    `expected the crash to be named: ${notes(r).join(" | ")}`
  );
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.HEAD_CRASHED),
    `and named by its own code: ${JSON.stringify(r.caveats)}`
  );
});

test("a prism too old to read is a missing parser to the check, not Ruby files that crashed", { ...needsShebang, ...needsPathControl }, async (t) => {
  // Ruby 3.3 ships prism 0.19, and the child refuses it before reading a file.
  // Charged per file, the check exited 0 with a "crashed the parser" note per
  // Ruby file and no remedy; the flag is what makes the command refuse with one.
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-old-prism-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, "ruby"),
    `#!/bin/sh
case "$*" in *Gem::Specification*) printf '[]'; exit 0 ;; esac
cat >/dev/null
printf '{"ready":true,"prism":"0.19.0"}\\n{"fatal":"prism 0.19.0 predates the field names this reads"}\\n'
exit 1
`,
    { mode: 0o755 }
  );
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/b.rb", "class B\n  def x\n    go\n  rescue => e\n  end\nend\n");
    commit("b");
  });
  facts(dir, { sha: sha(dir, "main"), path: "app/models", dimensions: [dim({ key: "rescue_uses_error" })] });
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
  });
  process.env.PATH = `${bin}:${path}`;

  const r = await check(dir, { baseRef: "main" });

  assert.match(String(r.parse.missingParser), /prism 0\.19\.0 predates/);
  assert.deepEqual(r.parse.missingEngines, ["prism"]);
});

test("a file the parser rejected is named apart from one this tool could not read", async (t) => {
  // The scan names the two apart because the reader's next move differs: syntax
  // the parser rejected is the branch's own code to go and look at, a file that
  // could not be read at all is this tool or the filesystem. The check folded
  // both into one sentence, so the one the author can act on read as a tool bug.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", "export const a = 1\nfoo(\n");
    commit("break it");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "src",
    dimensions: [dim({ key: "module_state_const" })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    notes(r).some((m) => /syntax/.test(m)),
    `expected the syntax cause to be named: ${notes(r).join(" | ")}`
  );
  // The code carries the same split the sentence does, or a reader that is not
  // a human is back to matching "syntax" against a phrase nobody promised.
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.HEAD_REJECTED),
    `the branch's own code is not this tool crashing: ${JSON.stringify(r.caveats)}`
  );
});

test("a Ruby file whose violation already existed at the base is not reported", async (t) => {
  // The offset-free fingerprint is the only identity a Ruby site has, so the
  // two-run difference has to still cancel an unchanged one.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.rb", "def a\n  begin\n    go\n  rescue => e\n  end\nend\n\ndef b\n  2\nend\n");
    commit("append");
  });
  facts(dir, { sha: sha(dir, "main"), dimensions: [dim({ key: "rescue_uses_error" })] });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((c) => c.path), ["src/a.rb"]);
  assert.deepEqual(r.findings, [], "the rescue was already there");
});

test("a deleted file produces no findings", async (t) => {
  // Its content is in the diff as removals. Reading it at HEAD is impossible
  // and charging the author for what they removed is backwards.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    write("src/keep.ts", clean(1));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("rm", "-q", "src/a.ts");
    commit("delete it");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.changed.map((c) => c.path), []);
  assert.deepEqual(r.findings, []);
});

test("a path containing a newline stays one path", needsPosixPaths, async (t) => {
  // Git permits a newline in a path. A line-split over `--name-status` turns
  // one hostile filename into two entries, and the encoder is what keeps it
  // from breaking the rendered report open.
  const hostile = "src/a\nb.ts";
  const dir = repo(t, ({ git, write, commit }) => {
    write(hostile, clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write(hostile, clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.deepEqual(r.changed.map((c) => c.path), [hostile]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, hostile);

  const rendered = formatReport(r);
  assert.ok(rendered.includes('"src/a b.ts"'), "the path is encoded and quoted");
  assert.equal(rendered.includes(hostile), false, "the raw newline never reaches the report");
});

test("the report names files in .claude/rules this tool did not write", async (t) => {
  // A clone can ship a rule file with no `paths` key that loads from the moment
  // of clone, in our house style, forever.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-overview.md", "---\ngenerator: anatomiya\n---\n\nours\n");
    write(".claude/rules/house.md", "someone else's\n");
    write(".claude/rules/notes.txt", "not a rule file\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, ["house.md"]);
  assert.deepEqual(r.unknown, []);
  assert.ok(formatReport(r).includes("house.md"));
});

test("our own filename with nobody's frontmatter is not ours (A3)", async (t) => {
  // The prefix is a name anyone can type. Two of the three facts is not
  // ownership, and the report is what says so.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-area-deadbeef.md", "# hand-written, our name\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, ["anatomiya-area-deadbeef.md"]);
});

test("our frontmatter with no map naming it is reported apart from a foreign file (A3, A4)", async (t) => {
  // This tool's own output from a scan whose record is gone. It still loads, so
  // it is named; it is not removed, because the map cannot vouch for it.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/anatomiya-area-99999999.md", "---\ngenerator: anatomiya\n---\n\nstale\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, [], "not somebody else's");
  assert.deepEqual(r.unknown, ["anatomiya-area-99999999.md"]);
  const rendered = formatReport(r);
  assert.ok(rendered.includes("the map on disk does not name"));
  assert.ok(rendered.includes("anatomiya-area-99999999.md"));
});

/** One area, scanned for real and written to the targets named, with a branch to check. */
async function mappedFor(t, targets) {
  const dir = repo(t, ({ write, commit }) => {
    for (let i = 0; i < 8; i++) write(`src/f${i}.ts`, clean(2));
    commit("init");
  });
  writeMap(await scan(dir), { targets });
  execFileSync("git", ["checkout", "-q", "-b", "work"], { cwd: dir, stdio: "pipe" });
  return dir;
}

const KEYED = "---\ngenerator: anatomiya\nalwaysApply: false\n---\n\nstale\n";

test("the report names what each other target's directory holds, under that directory's name", async (t) => {
  const dir = await mappedFor(t, ["claude", "cursor"]);
  const at = join(dir, ".cursor", "rules");
  writeFileSync(join(at, "anatomiya-area-deadbeef.mdc"), "# hand-written, our name\n");
  writeFileSync(join(at, "anatomiya-area-99999999.mdc"), KEYED);
  writeFileSync(join(at, "team.mdc"), "# a rule of the team's own\n");

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, [], "the Claude directory's own lists are still its own");
  assert.deepEqual(r.targets, {
    cursor: {
      dir: ".cursor/rules",
      state: "on",
      foreign: ["anatomiya-area-deadbeef.mdc"],
      unknown: ["anatomiya-area-99999999.mdc"],
      rules: { escaped: false, listed: true, unreadable: [] },
    },
  });
  const rendered = formatReport(r);
  assert.ok(rendered.includes('\n1 file(s) in .cursor/rules this tool did not write:\n  "anatomiya-area-deadbeef.mdc"\n'), rendered);
  assert.ok(rendered.includes('\n1 file(s) in .cursor/rules the map on disk does not name:\n  "anatomiya-area-99999999.mdc"\n'), rendered);
  assert.equal(rendered.includes("team.mdc"), false, "a rule under another name is that tool's own");
  assert.deepEqual(JSON.parse(formatReportJson(r)).targets, r.targets);
});

test("a target that is off is not audited, so a check with none on reports what it did", async (t) => {
  const dir = await mappedFor(t, ["claude"]);
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(dir, ".cursor", "rules", "anatomiya-area-deadbeef.mdc"), "# hand-written, our name\n");
  writeFileSync(join(dir, ".cursor", "rules", "anatomiya-overview.mdc"), "# hand-written too, so the target is off\n");

  const r = await check(dir, { baseRef: "main" });

  assert.equal("targets" in r, false);
  assert.equal(formatReport(r).includes(".cursor"), false);
  assert.equal(formatReportJson(r).includes("targets"), false);
});

test("a file that could not be read in another target's directory is a caveat naming that directory", needsPosixPermissions, async (t) => {
  const dir = await mappedFor(t, ["claude", "copilot"]);
  const locked = join(dir, ".github", "instructions", "anatomiya-area-deadbeef.instructions.md");
  writeFileSync(locked, KEYED);
  chmodSync(locked, 0o000);

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.caveats.filter((c) => c.code === CAVEATS.RULES_UNREADABLE),
    [{ code: "rules-unreadable", message: "1 file(s) in .github/instructions could not be read, so whose they are is unknown" }]
  );
  assert.deepEqual(r.targets.copilot.rules.unreadable, ["anatomiya-area-deadbeef.instructions.md"]);
});

test("a target the record names files for and nobody can read now is a caveat naming it and why", needsSymlinks, async (t) => {
  const dir = await mappedFor(t, ["claude", "cursor"]);
  const moved = join(dir, "elsewhere");
  fs.renameSync(join(dir, ".cursor"), moved);
  symlinkSync(moved, join(dir, ".cursor"));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.caveats.filter((c) => c.code === CAVEATS.RULES_UNLISTED),
    [{ code: "rules-unlisted", message: ".cursor/rules could not be read (.cursor is a link), so nothing there was examined" }]
  );
  assert.deepEqual(r.targets, {
    cursor: { dir: ".cursor/rules", state: "unknown", reason: ".cursor is a link", foreign: [], unknown: [], rules: { escaped: false, listed: false, unreadable: [] } },
  });
});

test("a target nobody can read that no record names files for is not the check's to mention", needsSymlinks, async (t) => {
  const dir = await mappedFor(t, ["claude"]);
  symlinkSync(join(dir, "src"), join(dir, ".cursor"));

  const r = await check(dir, { baseRef: "main" });

  assert.equal("targets" in r, false);
  assert.deepEqual(r.caveats.filter((c) => c.code === CAVEATS.RULES_UNLISTED), []);
});

test("a file edited since its commit is read as it stands, not as it was committed", async (t) => {
  // One violation committed, a second added in the tree. The tree is what the
  // agent has in front of it, so it is the side the head is read from.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    write("src/a.ts", clean(2) + swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(r.caveats.some((c) => c.code === CAVEATS.READ_FROM_TREE));
  assert.equal(forKey(r, "swallowed_error").length, 2, "both sites, the committed one and the pending one");
});

// An agent writes, checks, fixes, then commits. Run at the moment the findings
// are cheapest, the check used to answer "0 MUST-FIX, 0 FIX, 0 NIT" and put the
// one line that unsaid it in a caveat.
test("an untracked file is examined, so the check answers before the commit", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/b.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

test("a tracked file edited only in the tree is judged against its base, not read as all new", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    // Two violations at the base, so a head side read as wholly new would
    // report three rather than the one this branch added.
    write("src/a.ts", swallow(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", swallow(3));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(forKey(r, "swallowed_error").length, 1, JSON.stringify(r.findings));
});

test("a file read from the tree is named as read from the tree", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.READ_FROM_TREE),
    `a run that read uncommitted content says so: ${JSON.stringify(r.caveats)}`
  );
});

test("a staged but uncommitted file is examined the same as an unstaged one", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
    git("add", "-A");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/b.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

test("a file added with intent-to-add is examined as the addition it is", async (t) => {
  // `git add -N` puts the letter in the worktree column, ` A`, and only the
  // index column was asked whether a file is new: read as a modification of a
  // file the merge base never held, it was skipped with a false caveat.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/b.ts", swallow(2));
    git("add", "-N", "src/b.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/b.ts");
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

test("a renamed file counts once, and under its own name", async (t) => {
  // `status --porcelain -z` writes a rename as two fields, the new path with a
  // status prefix and the old path bare. Reading the second as another status
  // line both double-counts the rename and mangles the path.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("mv", "src/a.ts", "src/renamed.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  const note = r.caveats.find((c) => c.code === CAVEATS.READ_FROM_TREE);
  assert.ok(note, "the rename is work the check read from the tree");
  assert.match(note.message, /^1 file/, "one file, not two");
});

test("the store the map writes is not counted as pending work", async (t) => {
  // facts.json and the rendered rules are this tool's own output. Counting them
  // would fire the caveat on every clean repository that has been scanned.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    r.caveats.filter((c) => c.code === CAVEATS.READ_FROM_TREE).length,
    0,
    "a clean tree plus an untracked map is not pending work"
  );
  assert.deepEqual(r.examined, [], "the map is not source this branch changed");
});

test("a repository with no commits examines nothing and refuses nothing", async (t) => {
  const dir = repo(t, ({ write }) => {
    write("src/a.ts", swallow(3));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "none");
  assert.deepEqual(r.findings, []);
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.NOTHING_EXAMINED));
  assert.doesNotThrow(() => formatReport(r));
});

test("a repository holding none of the base refs degrades to added lines rather than refusing", async (t) => {
  // The guessed candidate list not resolving is a repository that keeps its
  // trunk somewhere else. A ref somebody typed is a different question, and
  // #51 made that one a refusal.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(r.mode, "added-lines");
  assert.ok(notes(r).some((m) => m.includes("added")), "the caveat must be stated");
  assert.equal(forKey(r, "swallowed_error").length, 1, "the added line is still checked");
});

test("added-lines mode reports only sites on the added lines", async (t) => {
  // Without a base version to difference against, the added-line ranges are the
  // only thing separating what this change wrote from what the file held.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", swallow(3) + swallow(1).replace("f0", "z0"));
    commit("one more");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);
  const hits = forKey(r, "swallowed_error");

  assert.equal(r.mode, "added-lines");
  assert.equal(hits.length, 1, "the three sites the file already held are not the author's");
  assert.equal(hits[0].line, 4);
});

test("added lines cannot reach MUST-FIX either", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(forKey(r, "swallowed_error")[0].severity, "FIX");
});

test("drift is measured to the base ref, never to HEAD", async (t) => {
  // Every mapped file is rewritten on this branch. Measured over HEAD that is
  // 6 of 6 drifted and the map ages itself out, so severity would fall as the
  // change under review grows.
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    for (let i = 1; i < 6; i++) write(`src/f${i}.ts`, clean(3));
    write("src/f0.ts", clean(3) + swallow(1));
    commit("touch everything");
  });
  facts(dir, { sha: sha(dir, "main"), fileCount: 6 });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.stale, false, "the branch cannot age its own map");
  assert.equal(forKey(r, "swallowed_error")[0].severity, "MUST-FIX");
});

test("a base branch that moved past the pin caps severity", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/f${i}.ts`, clean(2));
    commit("pin here");
    for (let i = 1; i < 5; i++) write(`src/f${i}.ts`, clean(4));
    commit("the world moved");

    git("checkout", "-q", "-b", "work");
    write("src/f0.ts", clean(2) + swallow(1));
    commit("my change");
  });
  facts(dir, { sha: sha(dir, "main~1"), fileCount: 6 });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.stale, true);
  assert.match(r.staleReason, /mapped files changed since the pin/);
  assert.equal(forKey(r, "swallowed_error")[0].severity, "FIX");
});

// --- the severity table on its own ---

test("MUST-FIX needs a baseline whose evidence would have cleared the gate that stated it", () => {
  // The check may only enforce at top severity what the scan was willing to
  // state, so both read the same bound. A floor left behind here would enforce
  // as law a claim the scan considered too thin to make.
  const at = (o) => severityFor({ path: "src/a.ts" }, { dim: dim(o) }).severity;

  assert.equal(at({}), "MUST-FIX");
  assert.equal(at({ baseline: { candidates: 20, conforming: 20 } }), "FIX", "twenty perfect sites hold 0.84");
  assert.equal(at({ baseline: { candidates: 5, conforming: 5 } }), "FIX", "five sites is not evidence");
  assert.equal(at({ baseline: { candidates: 20, conforming: 19 } }), "FIX", "not a clean baseline");
  assert.equal(at({ baseline: null }), "FIX", "no baseline recorded");
});

test("severity never reads the current population", () => {
  // The agent's own output accumulates in the current counts. Judging against
  // them lets a branch raise the bar it is measured by.
  const d = dim({ candidates: 400, conforming: 400, baseline: { candidates: 6, conforming: 5 } });
  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d }).severity, "FIX");
});

test("an exception recorded on the baseline population still exempts", () => {
  // Which of the two lists carries the exception is a detail of when the scan
  // saw it. Either one means the map told the agent this file was exempt.
  const d = dim({ exceptions: [], baseline: { candidates: 60, conforming: 60, exceptions: [{ path: "src/a.ts" }] } });
  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d }).severity, "FIX");
  assert.equal(severityFor({ path: "src/b.ts" }, { dim: d }).severity, "MUST-FIX");
});

test("nothing in the table says BLOCK", () => {
  const seen = new Set();
  for (const capped of [null, "no merge base"]) {
    for (const d of [null, dim(), dim({ directive: false }), dim({ precision: "partial" })]) {
      seen.add(severityFor({ path: "src/a.ts" }, { dim: d, capped }).severity);
    }
  }
  assert.deepEqual([...seen].sort(), ["FIX", "MUST-FIX", "NIT"]);
});

test("a finding capped by the run names the cap that applied", () => {
  // One fixed sentence covered every cause, so a run with no pin told the
  // agent the map was stale or had no merge base, and neither was true.
  const d = dim();
  for (const why of ["no baseline pinned", "no merge base", "the pinned baseline commit is unreachable"]) {
    const v = severityFor({ path: "src/a.ts" }, { dim: d, capped: why });
    assert.equal(v.severity, "FIX");
    assert.equal(v.reason, `capped by this run: ${why}`);
  }
});

// --- polarity: the area is checked against the sentence it was handed ---

const counterDim = (o = {}) => ({
  key: "test_call_style",
  precision: "precise",
  directive: false,
  states: "counter",
  gate: "ratio",
  counterGate: null,
  claim: "test cases are declared with test(), not it()",
  counterClaim: "test cases are declared with it(), not test()",
  applicability: 6,
  candidates: 60,
  conforming: 0,
  exceptions: [],
  counterExceptions: [],
  baseline: { candidates: 60, conforming: 0, exceptions: [], counterExceptions: [] },
  ...o,
});

test("an area that states the inverse is checked against the inverse, not against the claim", async (t) => {
  // The rendered file deliberately carries no marker saying which side it is,
  // so a check reading `conforming` unconditionally reports every site the map
  // just told the agent to write and stays silent on the one that broke it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\nit("three", () => {})\ntest("four", () => {})\n`);
    commit("add one of each");
  });
  facts(dir, { sha: sha(dir, "main"), dimensions: [counterDim()] });

  const r = await check(dir, { baseRef: "main" });
  assertExamined(r, "src/a.test.ts");

  const found = forKey(r, "test_call_style");
  assert.equal(found.length, 1, "only the site that broke the stated sentence is reported");
  assert.equal(found[0].claim, "test cases are declared with it(), not test()");
  assert.ok(found[0].snippet.startsWith("test("), `reported ${found[0].snippet}`);
  assert.equal(found[0].severity, "MUST-FIX");
});

test("a suppressed two-sided dimension enforces neither side above NIT", async (t) => {
  // States nothing at all, so both the it() and the test() are sites the map
  // counted and said nothing about.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.test.ts", `it("one", () => {})\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.test.ts", `it("one", () => {})\nit("two", () => {})\ntest("three", () => {})\n`);
    commit("both sides");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [counterDim({ states: null, gate: "ratio", counterGate: "evidence" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "test_call_style");
  assert.ok(found.length > 0, "the counts still reach the check");
  for (const f of found) assert.equal(f.severity, "NIT", f.snippet);
});

test("the severity table reads the stated side's baseline counts and its own exception list", () => {
  // On a counter area the stored pair is the suppressed side. Reading it there
  // turns 0 of 60 into the weakest possible evidence for a sentence the map
  // never stated, and exempts exactly the files that never broke the one it did.
  const at = (o, file = { path: "src/a.ts" }) =>
    severityFor(file, { dim: counterDim(o) }).severity;

  assert.equal(at({}), "MUST-FIX", "60 of 60 counter sites is a clean baseline");
  assert.equal(at({ baseline: { candidates: 60, conforming: 1 } }), "FIX", "one site breaks the inverse");
  assert.equal(
    at({ baseline: { candidates: 60, conforming: 0, counterExceptions: [{ path: "src/a.ts" }] } }),
    "FIX",
    "the counter's own exception list exempts"
  );
  assert.equal(
    at({ baseline: { candidates: 60, conforming: 0, exceptions: [{ path: "src/a.ts" }] } }),
    "MUST-FIX",
    "the claim's exception list is the other side's and exempts nothing here"
  );
});

test("a branch that adds a rake task with no spec breaks a stated obligation", needsRuby, async (t) => {
  // The gap this closes: check iterates dimensions that run against a program,
  // and an obligation has none. A stated claim it cannot run came back clean,
  // which is the shape of the bug 0.1.3 fixed for unread files.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/lonely.rake", "task :lonely do\n  puts 2\nend\n");
    commit("add a task with no spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [
      dim({
        key: "rake_task_spec",
        claim: "a rake task ships with a spec",
        applicability: 60,
        candidates: 60,
        conforming: 60,
        baseline: { candidates: 60, conforming: 60, exceptions: [] },
      }),
    ],
  });

  const report = await check(dir, {});
  const found = forKey(report, "rake_task_spec");

  assert.equal(found.length, 1, `expected one finding, got ${JSON.stringify(report.findings)}`);
  assert.equal(found[0].path, "lib/tasks/lonely.rake");
  assert.equal(found[0].companion, "spec/lib/tasks/lonely_spec.rb");
});

test("a rake task added with its spec in the same commit reports nothing", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/fresh.rake", "task :fresh do\n  puts 2\nend\n");
    write("spec/lib/tasks/fresh_spec.rb", "describe 'fresh' do\nend\n");
    commit("add a task with its spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", claim: "a rake task ships with a spec" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("an obligation the map counted but never stated is not a finding", needsRuby, async (t) => {
  // The same rule every other dimension follows: the check enforces what the
  // map stated. A count the gates suppressed is the map's business.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/lonely.rake", "task :lonely do\n  puts 2\nend\n");
    commit("add a task with no spec");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", directive: false, gate: "ratio" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("a producer the corpus excludes is not held to an obligation", needsRuby, async (t) => {
  // The scan counts over the corpus, which drops fixture and vendor trees. The
  // check takes its producers from the diff, which does not, so a fixture file
  // was measured against a claim the map never counted it in.
  const dir = repo(t, ({ git, write, commit }) => {
    write("lib/tasks/paired.rake", "task :paired do\n  puts 1\nend\n");
    write("spec/lib/tasks/paired_spec.rb", "describe 'paired' do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "feature");
    write("lib/tasks/fixtures/sample.rake", "task :sample do\n  puts 2\nend\n");
    commit("add a fixture rake task");
  });

  facts(dir, {
    sha: sha(dir, "main"),
    path: "lib/tasks",
    fileCount: 60,
    pinned: ["lib/tasks/paired.rake"],
    dimensions: [dim({ key: "rake_task_spec", claim: "a rake task ships with a spec" })],
  });

  assert.deepEqual(forKey(await check(dir, {}), "rake_task_spec"), []);
});

test("a generated file the corpus leaves out is not judged against the map", async (t) => {
  // The scan drops a file stamped as generated, or declared so in
  // `.gitattributes`, and the check filtered by the path alone: a branch that
  // regenerated a client got a MUST-FIX per site in code nobody writes by hand,
  // against claims the map never counted it in.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/client.ts", "// @generated by openapi-generator. DO NOT EDIT.\n" + swallow(1));
    write("src/proto/types.ts", swallow(1));
    write(".gitattributes", "src/proto/** linguist-generated\n");
    // The control: a hand-written file on the same branch is still judged.
    write("src/mine.ts", swallow(1));
    commit("regenerate");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.findings.map((f) => f.path), ["src/mine.ts"]);
  assert.deepEqual(r.examined.map((f) => f.path), ["src/mine.ts"]);
});

test("a symlinked source file is neither parsed nor reported, committed or not", needsPosixPaths, async (t) => {
  // A link is not source: its target is counted where it is tracked. Committed,
  // the link's own text was parsed and named as syntax the parser rejected;
  // uncommitted, the target was read through it and its sites charged again
  // under the link's name. The same file answered two ways by commit state.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("lib/impl.ts", swallow(1));
    commit("init");
    git("checkout", "-q", "-b", "work");
    symlinkSync("../lib/impl.ts", join(root, "src", "committed.ts"));
    commit("link it");
    symlinkSync("../lib/impl.ts", join(root, "src", "pending.ts"));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), []);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(notes(r).filter((m) => /committed\.ts|pending\.ts/.test(m)), []);
});

test("a rules directory linked out of the repository is reported, not examined", async (t) => {
  // The scan refuses to write through such a link. The check has nothing to
  // refuse, so it says what it could not look at: a clean rules directory
  // reported here is the same lie as a clean diff reported for one git would
  // not produce (F15, F2).
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "house.md"), "# theirs\n");

  const dir = repo(t, ({ dir, write, commit }) => {
    write("src/a.ts", clean(2));
    mkdirSync(join(dir, ".claude"), { recursive: true });
    symlinkSync(outside, join(dir, ".claude", "rules"));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.foreign, [], "nothing outside the repository was read");
  assert.ok(
    r.caveats.some((c) => c.code === CAVEATS.RULES_ESCAPED),
    `no caveat said so: ${notes(r).join("; ")}`
  );
});

test("the report counts rule files past a handful rather than naming them all", async (t) => {
  // This report is read by an agent, and a repository holding ten thousand
  // `.md` files in `.claude/rules/` would otherwise spend ten thousand lines of
  // its context saying so.
  const dir = repo(t, ({ dir, write, commit }) => {
    write("src/a.ts", clean(2));
    mkdirSync(join(dir, ".claude/rules"), { recursive: true });
    for (let i = 0; i < 40; i++) writeFileSync(join(dir, ".claude/rules", `theirs-${i}.md`), "# theirs\n");
    commit("init");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const rendered = formatReport(r);

  assert.equal(r.foreign.length, 40, "the count is still the truth");
  assert.ok(rendered.split("\n").filter((l) => /^ {2}"theirs-/.test(l)).length <= 20);
  assert.match(rendered, /^ {2}and 20 more$/m);
});

test("an unreadable tree reports the obligation unchecked instead of failing every producer", async (t) => {
  // Same shape as F13 for history and F15 for the diff: `ls-tree` answering
  // nothing is not a repository with no files. Read as one, every changed model
  // on the branch owes a spec that "does not exist", and a map stating the
  // obligation puts those at MUST-FIX against an author who wrote the spec.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/other.rb", "class Other\nend\n");
    write("spec/models/other_spec.rb", "describe Other do\nend\n");
    commit("both halves, so nothing is owed");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });
  //
  // The unreadable-tree half is pinned at the `filesAt` seam in `git.mjs`, not
  // here: `ls-tree -r HEAD` and `diff base...HEAD` walk the same tree, so no
  // repository state breaks one and leaves the other working. Removing HEAD's
  // tree, or any subtree under it, fails both, and the run then reports the
  // diff instead. What this case pins is the other side of the guard, that a
  // tree git *does* answer still gets its obligations checked.
  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.findings.filter((f) => f.dimension === "model_spec"),
    [],
    "the companion is in the same commit, so nothing is owed"
  );
});

// The companion listing is the tree at HEAD, and the producers now come from
// the working tree, so an author who wrote both halves and committed neither
// owed a spec that was sitting right there beside the model.
test("a companion written but not committed satisfies the obligation", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/other.rb", "class Other\nend\n");
    write("spec/models/other_spec.rb", "describe Other do\nend\n");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.findings.filter((f) => f.dimension === "model_spec"),
    [],
    "both halves are in the tree, so nothing is owed"
  );
});

// A rename's old path is where its base version lives. Read as a file with no
// base, every site in it is new, and a `git mv` before committing reported the
// whole file as this branch's work: the forgery the base side exists to stop.
test("a file renamed but not committed is judged against its old path", async (t) => {
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/legacy.ts", "src/moved.ts");
    // A fourth site, added after the move. Without the old path the base is
    // unreadable and the file is skipped whole, which reports nothing and
    // passes an assertion that only counts the three that predate the branch.
    writeFileSync(join(root, "src", "moved.ts"), swallow(4));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    forKey(r, "swallowed_error").length,
    1,
    `three sites came with the file and one is new: ${JSON.stringify(r.findings)}`
  );
});

test("a move not yet committed is still a move where the user's config turns rename detection off", async (t) => {
  // `diff.renames=false` is a known speed setting for large repositories, and
  // `status` follows it: the move listed as a deletion and an addition, and
  // the three sites that came with the file were charged to whoever moved it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacy.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("config", "diff.renames", "false");
    git("mv", "src/legacy.ts", "src/moved.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/moved.ts");
  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
});

// `--porcelain` defaults to `-unormal`, which collapses an untracked directory
// to one entry ending in `/`. That path is not source, so it was dropped, and
// a new service directory checked before its first commit read clean.
test("a file in a wholly new directory is examined", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/new/deep.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), ["src/new/deep.ts"]);
  assert.equal(forKey(r, "swallowed_error").length, 2, JSON.stringify(r.findings));
});

// The scan refuses to write through a link out of the repository. The check
// reads, so it refuses to read through one: the matched text reaches a report
// the agent then reads back.
test("a pending path that resolves outside the repository is not read", needsPosixPaths, async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "anat-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.ts"), swallow(2));

  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  symlinkSync(join(outside, "secret.ts"), join(dir, "src", "leak.ts"));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
});

// The header counted the two sets and printed the second only when the numbers
// differed, so two changed files and two examined ones read as the same two
// even when one of the examined was never in the diff.
test("the header says what was examined whenever it is not what changed", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(3));
    write("notes.md", "not source\n");
    commit("one source file and one not");
    write("src/untracked.ts", swallow(2));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.changed.length, 2, "the diff carries a source file and a markdown one");
  assert.equal(r.examined.length, 2, "the markdown is not examined, the untracked source is");
  assert.match(formatReport(r), /2 examined/);
});

// The index letter says the path is an addition; whether it has a base version
// is a question about the merge base, and only that question decides whether
// every site in the file is this branch's work.
test("a tracked file unstaged from the index keeps the base version at its path", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("rm", "-q", "--cached", "src/a.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
});

// A staged rename prints `R` and no `D`, so the path it moved away from was
// never counted as gone: a companion renamed out from under its producer still
// read as sitting right there.
test("a companion renamed away in the tree no longer satisfies the obligation", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/thing.rb", "class Thing\n  def name\n  end\nend\n");
    git("mv", "spec/models/thing_spec.rb", "spec/models/renamed_spec.rb");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(
    r.findings.filter((f) => f.dimension === "model_spec").length,
    1,
    `the spec this model owes was moved away: ${JSON.stringify(r.findings)}`
  );
});

// The committed side stops at the file cap, and the two sides disagreeing on
// what is too big is what `limits.mjs` exists to stop. Read through one open
// handle, so the size that was checked is the size that is read.
test("a pending file over the size cap is not read from the tree", async (t) => {
  const dir = repo(t, ({ dir: root, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    writeFileSync(join(root, "src", "big.ts"), `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`);
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
  assert.ok(
    notes(r).includes("src/big.ts exceeded the size cap, so it was not checked"),
    `a file it refused to read is named, not silently dropped: ${JSON.stringify(r.caveats)}`
  );
});

test("a file past the size cap is named as past it, by its own code, committed or not", async (t) => {
  // Both readers stop at the cap the parser skips at, so the parser's own
  // "oversize" answer never arrived and every such file read as one that would
  // not come back: git or disk trouble, where the documented code says a file
  // nobody writes by hand.
  const big = `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`;
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/big.ts", big);
    commit("over the cap");
    writeFileSync(join(root, "src", "copy.ts"), big);
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    r.caveats.filter((c) => c.code === CAVEATS.HEAD_OVERSIZE).map((c) => c.message).sort(),
    ["src/big.ts exceeded the size cap, so it was not checked", "src/copy.ts exceeded the size cap, so it was not checked"],
    JSON.stringify(r.caveats)
  );
  assert.deepEqual(r.caveats.filter((c) => c.code === CAVEATS.HEAD_UNREADABLE), []);
});

// Both committed sides are read in one pass per revision, so which revision a
// blob failed to come back from is a lookup rather than the call that failed.
// The three sentences say which of the three places was looked in, and an agent
// reads them to know whether to fix the file or the run.
test("a committed file that will not come back is named at HEAD", async (t) => {
  // Its object is gone from the store, which nothing but the blob read asks
  // for: the diff lists an added path without opening it, and the tree copy
  // is unchanged, so nothing is read from there.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/lost.ts", swallow(2));
    commit("add it");
    const blob = String(git("rev-parse", "HEAD:src/lost.ts")).trim();
    rmSync(join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(r.findings));
  assert.ok(notes(r).includes("could not read src/lost.ts at HEAD"), JSON.stringify(r.caveats));
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.HEAD_UNREADABLE));
});

test("a base version that will not come back skips the file rather than charging it", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/big.ts", `${swallow(2)}\n// ${"x".repeat(1024 * 1024)}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/big.ts", swallow(3));
    commit("under the cap");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], "every site in it would otherwise read as newly introduced");
  assert.ok(
    notes(r).includes("could not read src/big.ts at the merge base, so src/big.ts was skipped"),
    JSON.stringify(r.caveats)
  );
  assert.ok(r.caveats.some((c) => c.code === CAVEATS.BASE_UNREADABLE));
});

// Both trees are on disk before either is used, so the guard that removes them
// has to be open from the first read: wrapped around the parse alone it left
// the head tree behind whenever the base read or the loop threw.
test("a revision tree does not outlive a check that threw", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", swallow(2));
    commit("second");
  });
  facts(dir, { sha: sha(dir, "main") });

  // The read that fails is whichever one runs while an earlier tree is still
  // on disk, which is the base read: no counting, and nothing to keep in step
  // with the order the reads are made in.
  const made = [];
  const real = fs.mkdtempSync;
  fs.mkdtempSync = (prefix, ...rest) => {
    const ours = String(prefix).includes("anatomiya-revision-");
    if (ours && made.some(existsSync)) throw new Error("no space left on device");
    const out = real(prefix, ...rest);
    if (ours) made.push(out);
    return out;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.mkdtempSync = real;
    syncBuiltinESMExports();
    for (const path of made) rmSync(path, { recursive: true, force: true });
  });

  await assert.rejects(() => check(dir, { baseRef: "main" }), /no space left on device/);

  assert.equal(made.length, 1, "the head read wrote a tree and the base read threw");
  assert.deepEqual(made.filter(existsSync), [], "the tree already on disk was removed on the way out");
});

// `git status` lists a deletion, and a path that is gone cannot be read. It
// reported one file read from the tree and one it could not read, in the same
// run, about the same file.
test("a file deleted in the working tree is not examined", async (t) => {
  const dir = repo(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    write("src/b.ts", clean(2));
    commit("init");
    git("rm", "-q", "src/b.ts");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((f) => f.path), []);
  assert.deepEqual(notes(r).filter((m) => /could not read/.test(m)), []);
});

test("a file the branch committed and then deleted in the tree is not judged", async (t) => {
  // The committed diff still lists it, and its HEAD version was judged: a
  // MUST-FIX on a file that no longer exists, in a run that says it answers
  // for the work as it stands.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("swallow");
    rmSync(join(root, "src/b.ts"));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.examined.map((f) => f.path), []);
});

test("a file the branch added and then moved in the tree is judged as an addition at its new path", async (t) => {
  // The move's `from` names a path that exists at HEAD and not at the merge
  // base, so the base read failed and the moved file, holding the only new
  // violation, was skipped, while the path it left was judged from HEAD.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", swallow(1));
    commit("swallow");
    git("mv", "src/b.ts", "src/c.ts");
    writeFileSync(join(root, "src/c.ts"), clean(1) + "export function h() { try { x() } catch (e) { } }\n");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/c.ts");
  assert.deepEqual(forKey(r, "swallowed_error").map((f) => [f.path, f.line]), [["src/c.ts", 2]]);
});

/** A model and its spec, twice, with the map stating the obligation. */
function pairedModels(t, change) {
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    for (const n of ["thing", "other"]) {
      write(`app/models/${n}.rb`, `class ${n}\nend\n`);
      write(`spec/models/${n}_spec.rb`, `describe ${n} do\nend\n`);
    }
    commit("init");
    git("checkout", "-q", "-b", "work");
    change({ root, git, commit });
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });
  return dir;
}

test("a branch that deletes a companion and leaves its producer alone breaks the obligation", async (t) => {
  // Only producers the branch touched were asked, and a deletion is no file to
  // examine, so dropping an inconvenient spec passed clean while a one-line
  // edit to its model would have been flagged.
  const dir = pairedModels(t, ({ git, commit }) => {
    git("rm", "-q", "spec/models/thing_spec.rb");
    commit("drop the spec");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(
    forKey(r, "model_spec").map((f) => [f.path, f.companion]),
    [["app/models/thing.rb", "spec/models/thing_spec.rb"]]
  );
});

test("the files a branch deleted travel on the report", async (t) => {
  const dir = pairedModels(t, ({ git, commit }) => {
    git("rm", "-q", "spec/models/thing_spec.rb");
    commit("drop the spec");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.removed, ["spec/models/thing_spec.rb"]);
});

test("a file deleted only in the tree travels on the report the way a committed one does", async (t) => {
  // The obligation already read the tree's deletion, so a header saying no
  // file changed sat above a finding about the file this branch removed.
  const dir = pairedModels(t, ({ root, git }) => {
    rmSync(join(root, "spec/models/thing_spec.rb"));
    // A move keeps its file whatever the new name, source or not.
    git("mv", "spec/models/other_spec.rb", "spec/models/other_spec.rb.bak");
    // Moved and then deleted: one file left, under its old name.
    git("mv", "app/models/other.rb", "app/models/gone.rb");
    rmSync(join(root, "app/models/gone.rb"));
    // Added to the index and deleted: never committed anywhere.
    writeFileSync(join(root, "spec/models/zz_spec.rb"), "x\n");
    git("add", "spec/models/zz_spec.rb");
    rmSync(join(root, "spec/models/zz_spec.rb"));
    // The same with intent to add, which git reports as ` D`, and a path no
    // source filter would keep.
    writeFileSync(join(root, "spec/models/yy_spec.rb"), "x\n");
    writeFileSync(join(root, "NOTES.md"), "x\n");
    git("add", "-N", "spec/models/yy_spec.rb", "NOTES.md");
    rmSync(join(root, "spec/models/yy_spec.rb"));
    rmSync(join(root, "NOTES.md"));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual([...r.removed].sort(), ["app/models/other.rb", "spec/models/thing_spec.rb"]);
});

test("a tree deletion is counted once, and for any path a committed one would be", async (t) => {
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("README.md", "hi\n");
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("spec/models/thing_spec.rb", "describe Thing do\n  it {}\nend\n");
    commit("edit the spec");
    rmSync(join(root, "spec/models/thing_spec.rb"));
    rmSync(join(root, "README.md"));
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.changed.map((c) => c.path), ["spec/models/thing_spec.rb"]);
  assert.deepEqual(r.removed, ["README.md"]);
});

test("a companion no commit held, added to the index and deleted, breaks nothing", async (t) => {
  // The branch never touched the model, and committing the same steps leaves
  // no trace, so a finding here would charge it for a file it never had.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    for (const n of ["lone", "bare"]) write(`app/models/${n}.rb`, `class ${n}\nend\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    for (const [n, flags] of [["lone", []], ["bare", ["-N"]]]) {
      write(`spec/models/${n}_spec.rb`, `describe ${n} do\nend\n`);
      git("add", ...flags, `spec/models/${n}_spec.rb`);
      rmSync(join(root, `spec/models/${n}_spec.rb`));
    }
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "model_spec").map((f) => f.path), []);
  assert.deepEqual(r.removed, []);
});

test("a companion deleted in the tree breaks the obligation before it is committed", async (t) => {
  const dir = pairedModels(t, ({ root }) => rmSync(join(root, "spec/models/thing_spec.rb")));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "model_spec").map((f) => f.path), ["app/models/thing.rb"]);
});

test("a producer whose companion the branch never wrote is still reported", async (t) => {
  // The control for the guard above. A `return` that fired on every tree rather
  // than on a missing one would turn the whole obligation off, and every case
  // that asserts nothing was found would pass louder for it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/lonely.rb", "class Lonely\nend\n");
    commit("a model with no spec");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/models",
    dimensions: [dim({ key: "model_spec", directive: true })],
  });

  const r = await check(dir, { baseRef: "main" });
  const owed = r.findings.filter((f) => f.dimension === "model_spec");

  assert.equal(owed.length, 1, `expected the missing spec to be reported: ${JSON.stringify(r.findings)}`);
  assert.equal(owed[0].path, "app/models/lonely.rb");
  // A field of its own rather than part of the reason, so each writer places it.
  assert.equal(owed[0].companion, "spec/models/lonely_spec.rb");
});

test("a file the check could not read names its own cause, in the singular", () => {
  // This surface always names one file, so it always takes the singular verb,
  // and the four causes are four different things to do about it: a crash is
  // this tool's, rejected syntax is the branch's own code, the cap is a
  // generated file nobody writes by hand, and the rest is this tool or the
  // filesystem. Folding any of them into another sends the reader after the
  // wrong thing.
  assert.equal(unreadReason({ kind: "crashed" }), "crashed the parser");
  assert.equal(unreadReason({ kind: "rejected" }), "holds syntax the parser rejected");
  assert.equal(unreadReason({ kind: "oversize" }), "exceeded the size cap");
  assert.equal(unreadReason({ kind: "unreadable" }), "could not be parsed");
  assert.equal(unreadReason(null), "could not be parsed", "no record at all is the same as unreadable");
});

test("a file a grammar could not read is not blamed on the branch's syntax", () => {
  // The record says what its engine's rejection means, so a `.cs` and a `.ts`
  // file in one diff each get their own sentence under the one code.
  const cs = { kind: "rejected", rejects: "grammar" };
  const ts = { kind: "rejected", rejects: "syntax" };
  assert.equal(unreadReason(cs), "could not be read by this tool's grammar");
  assert.equal(unreadReason(ts), "holds syntax the parser rejected");
  assert.equal(unreadCode(cs), unreadCode(ts));
  assert.equal(unreadReason({ kind: "crashed", rejects: "grammar" }), "crashed the parser", "only a rejection has two meanings");
});

test("the four causes carry four codes, so nothing has to read the sentence", () => {
  // The sentence above keeps them apart for a human. One code for all four put
  // every other reader back to matching that prose, which is the substring
  // match the codes exist to end.
  const codes = [
    unreadCode({ kind: "crashed" }),
    unreadCode({ kind: "rejected" }),
    unreadCode({ kind: "oversize" }),
    unreadCode({ kind: "unreadable" }),
  ];

  assert.deepEqual(codes, [
    CAVEATS.HEAD_CRASHED,
    CAVEATS.HEAD_REJECTED,
    CAVEATS.HEAD_OVERSIZE,
    CAVEATS.HEAD_UNPARSED,
  ]);
  assert.equal(new Set(codes).size, 4, "four causes, four codes");
  assert.equal(unreadCode(null), CAVEATS.HEAD_UNPARSED, "no record at all is the same as unreadable");
});


/**
 * A repository whose branch adds a Flow file to an area that states the
 * return-type claim. Flow is not TypeScript, so the parser rejects it and the
 * worker retries with the annotations blanked.
 */
async function flowRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-flow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(): number { return ${i} }\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });
  git("checkout", "-q", "-b", "probe");
  writeFileSync(
    join(dir, "src", "flowed.js"),
    ["// @flow", "type Opts = {| name: string |}", "export function describe(o: Opts): string { return o.name }"].join("\n") + "\n"
  );
  git("add", "-A");
  git("commit", "-qm", "flow");
  return dir;
}

test("the check does not report a type claim against a file whose types were stripped", async (t) => {
  // The check walks the same tree the scan counted, and on a retried file the
  // annotations are blanked. Left alone it prints "exported functions declare
  // their return type" next to a line that declares one.
  const repo = await flowRepo(t);

  const report = await check(repo, { baseRef: "main" });
  const text = formatReport(report);

  assert.doesNotMatch(
    text,
    /exported functions declare their return type/,
    `a claim about annotations, on a file whose annotations were stripped:\n${text}`
  );
});

test("a check that could not load the stripper names the dependency too", async (t) => {
  // The check runs in CI, where nobody watched the scan output, so the caveat
  // has to stand on its own: a Flow file it could not read reads as a broken
  // file rather than a missing dependency.
  const home = installWithoutStripper(t);

  const repo = mkdtempSync(join(tmpdir(), "anatomiya-flowcheck-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  mkdirSync(join(repo, "src"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    writeFileSync(join(repo, "src", `f${i}.ts`), `export function f${i}(): number { return ${i} }\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  execFileSync(process.execPath, [join(home, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" });
  git("checkout", "-q", "-b", "probe");
  writeFileSync(join(repo, "src", "flowed.js"), FLOW_SOURCE + "\n");
  git("add", "-A");
  git("commit", "-qm", "flow");

  // As the record rather than as the lines: what the caveat means to a reader
  // is its code, and the sentence is wording nobody promised to keep.
  const out = execFileSync(
    process.execPath,
    [join(home, "bin", "anatomiya.mjs"), "check", repo, "--base", "main", "--format", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const caveats = JSON.parse(out).caveats;

  assert.ok(
    caveats.some((c) => c.code === CAVEATS.STRIPPER_MISSING),
    `nothing named the missing dependency:\n${out}`
  );
  assert.ok(
    caveats.some((c) => c.code === CAVEATS.HEAD_REJECTED && c.message.includes("src/flowed.js")),
    `the Flow file was expected in the caveats:\n${out}`
  );
});

test("a claim is not silenced by a finding invented off the base's stripped tree", async (t) => {
  // The base side goes through the same retry, so on a Flow file its
  // annotations are blanked too. Asking a blind row about that tree answers for
  // every function in it, and those answers cancel the real ones on the head
  // side: a violation the branch genuinely has is reported as pre-existing and
  // disappears. Asked through `doc_comment_style` rather than
  // `explicit_return_type`, because a plain `.js` file cannot carry a return
  // type at all and no longer answers that row on either side.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-basestrip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `/** doc */\nexport function f${i}(): number {\n  return ${i}\n}\n`);
  }
  // Flow-only syntax, so the base is retried and its annotations blanked.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    ["// @flow", "type O = {| n: string |}", "/** doc */", "export function legacy(o: O) {", "  return o.n", "}"].join("\n") + "\n"
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  git("checkout", "-q", "-b", "migrate");
  // Only the Flow-only syntax goes, so the head parses as written and the base
  // is still stripped. The branch adds one export with no doc comment.
  writeFileSync(
    join(dir, "src", "legacy.js"),
    [
      "// @flow",
      "type O = {n: string}",
      "/** doc */",
      "export function legacy(o: O) {",
      "  return o.n",
      "}",
      "export function bare(o: O) {",
      "  return o.n",
      "}",
    ].join("\n") + "\n"
  );
  git("commit", "-qam", "migrate");

  const out = execFileSync(process.execPath, [bin, "check", dir, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(
    out,
    /exported functions carry a doc comment/,
    `the head file added an undocumented export and nothing said so:\n${out}`
  );
});

test("a map holding a type-checked claim says the check did not enforce it", async (t) => {
  // A check that reports no findings is what the command file tells the agent
  // to trust, so a whole class of claim going unasked has to be said out loud.
  // Same shape as B13 for a missing parser and F15 for an unreadable git, and
  // both of those were real bugs.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-deepcaveat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 14; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `export function f${i}(s: string) {\n  return s.trim().toLowerCase()\n}\n`);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  const bin = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));
  execFileSync(process.execPath, [bin, "scan", dir], { stdio: "pipe" });

  // Plant a stated semantic claim, which is what a scan with the checker would have left.
  const factsPath = join(dir, ".claude/anatomiya/facts.json");
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  facts.areas[0].dimensions.push({
    key: "law_of_demeter",
    tier: "semantic",
    claim: "a call chain stays inside one type",
    precision: "partial",
    applicability: 14,
    langFileCount: 14,
    candidates: 40,
    conforming: 39,
    files: [],
    directive: true,
    states: "claim",
    gate: null,
    exceptions: [],
  });
  writeFileSync(factsPath, JSON.stringify(facts));

  git("checkout", "-q", "-b", "probe");
  writeFileSync(join(dir, "src", "f0.ts"), `export function f0(s: string) {\n  return s.trim()\n}\n`);
  git("commit", "-qam", "probe");

  const out = execFileSync(process.execPath, [bin, "check", dir, "--base", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(out, /type-checked claim is stated in the map and not enforced on a branch/, out);
  assert.match(out, /runs on `anatomiya scan` and not here/, "and it says where the tier does run");
});

/* --- the new claim families at check time --- */

test("the doc-comment claim reads the comments, so a commented export is clean", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `/** a */\nexport function fA() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `/** what b does */\nexport function fB() {}\n`);
    write("src/c.ts", `export function fC() {}\n`);
    commit("add files");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "doc_comment_style", precision: "partial" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assertExamined(report, "src/c.ts");
  const found = forKey(report, "doc_comment_style");
  assert.deepEqual(found.map((f) => f.path), ["src/c.ts"], "only the uncommented export is a finding");
});

test("a learned naming class is enforced as the class the map stored", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function goodName() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `function anotherGood() {}\nfunction bad_name() {}\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "function_naming_case");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].where, "bad_name");
  assert.equal(found[0].line, 2, "the finding points at the declaration, not line 1");
  assert.ok(found[0].snippet.includes("bad_name"), JSON.stringify(found[0].snippet));
});

test("a routing claim is not asked of a repository with no wrapper", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("tools/loose.ts", `console.log("x");\n`);
    commit("add");
  });
  facts(dir, { sha: sha(dir, "main") });
  const report = await check(dir);
  assertExamined(report, "tools/loose.ts");
  assert.deepEqual(forKey(report, "route_logging"), []);
});

test("a new file breaking the area's learned filename class is a finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/orderList.ts", `export const b = 2;\n`);
    write("src/data-store.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/orderList.ts");
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/orderList.ts"]);
  assert.equal(found[0].claim, "files here are named kebab-case");
});

test("a modified file keeping its old name is not a filename finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/legacyName.ts", `export const a = 1;\n`);
    write("src/user-profile.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/legacyName.ts", `export const a = 9;\n`);
    commit("edit");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/legacyName.ts");
  assert.deepEqual(forKey(report, "file_naming_case"), [], "the name predates this branch");
});

test("a hostile learned value in the facts never reaches a claim", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function goodName() {}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", `function fooBar() {}\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "\n# hostile\ninjected" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assert.ok(!JSON.stringify(report.findings).includes("hostile"), "the value is not a class, so it enforces nothing");
  assert.deepEqual(forKey(report, "function_naming_case"), []);
});

test("a learned base class is enforced the way a learned naming class is", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/controllers/users_controller.rb", "class UsersController < ApplicationController\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/controllers/x_controller.rb", "class XController < ActionController::Base\nend\n");
    commit("add");
  });
  const rubyArea = (learned) => [{
    id: "aaaaaaaa",
    path: "app/controllers",
    globs: [{ negated: false, dir: "app/controllers", tail: "**/*.rb" }],
    fileCount: 8,
    dimensions: [dim({ key: "class_base", learned })],
  }];
  facts(dir, { sha: sha(dir, "main"), areas: rubyArea("ApplicationController") });
  const report = await check(dir);
  assertExamined(report, "app/controllers/x_controller.rb");
  assert.deepEqual(notes(report).filter((m) => /schema/.test(m)), [], "the writer's own schema reads clean");
  const found = forKey(report, "class_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/controllers/x_controller.rb");
  assert.equal(found[0].line, 1);
  assert.equal(found[0].claim, "classes here inherit ApplicationController");
});

test("a learned mixin is enforced the way a learned base class is", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User\n  include Auditable\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/order.rb", "class Order\n  include Trackable\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Auditable" })],
    }],
  });
  const report = await check(dir);
  assertExamined(report, "app/models/order.rb");
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/models/order.rb");
  assert.equal(found[0].claim, "classes here include Auditable");
});

// Sidekiq defines `Worker = Job`, so a body including either spelling already
// includes the module the claim names, in both directions.
test("either spelling of Sidekiq's job mixin satisfies a claim learned on the other", needsRuby, async (t) => {
  for (const [learned, written] of [["Sidekiq::Worker", "Sidekiq::Job"], ["Sidekiq::Job", "Sidekiq::Worker"]]) {
    const dir = repo(t, ({ git, write, commit }) => {
      write("app/workers/a_worker.rb", `class AWorker\n  include ${learned}\nend\n`);
      commit("init");
      git("checkout", "-q", "-b", "work");
      write("app/workers/b_worker.rb", `class BWorker\n  include ${written}\nend\n`);
      write("app/workers/c_worker.rb", "class CWorker\n  include Comparable\nend\n");
      commit("add");
    });
    facts(dir, {
      sha: sha(dir, "main"),
      areas: [{
        id: "aaaaaaaa",
        path: "app/workers",
        globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
        fileCount: 8,
        dimensions: [dim({ key: "module_include", learned })],
      }],
    });
    const report = await check(dir);
    assert.deepEqual(forKey(report, "module_include").map((f) => f.path), ["app/workers/c_worker.rb"], learned);
  }
});

// The fold resolves a bare mixin against the body's nesting (C30), so the check
// has to, or a site the map counted as conforming is a finding here.
test("a mixin written relative to its namespace satisfies the scoped name the map learned", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "module Api\n  class User\n    include Api::Auditable\n  end\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/order.rb", "module Api\n  class Order\n    include Auditable\n  end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Api::Auditable" })],
    }],
  });
  const report = await check(dir);
  assertExamined(report, "app/models/order.rb");
  assert.deepEqual(forKey(report, "module_include"), [], JSON.stringify(report.findings));
});

test("a mixin finding fires once per class body, not once per included constant", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    // The shape the row was written for: a worker mixing in the learned module
    // and one more beside it.
    write("app/workers/b_worker.rb", "class BWorker\n  include Sidekiq::Worker\n  include Sidekiq::Throttled::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\nend\n");
    write("app/workers/d_worker.rb", "class DWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.deepEqual(
    found.map((f) => f.path).sort(),
    ["app/workers/c_worker.rb", "app/workers/d_worker.rb"],
    JSON.stringify(report.findings)
  );
});

// The violation an agent actually commits. A new worker that forgets the
// include used to pass clean on the same run that caught `include Comparable`.
test("a body that forgets the include is caught, not only one that includes the wrong module", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/wrong_worker.rb", "class WrongWorker\n  include Comparable\nend\n");
    write("app/workers/bare_worker.rb", "class BareWorker\n  def perform\n  end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.deepEqual(
    found.map((f) => f.path).sort(),
    ["app/workers/bare_worker.rb", "app/workers/wrong_worker.rb"],
    JSON.stringify(report.findings)
  );
});

// A body declaring nothing has no constants to be identified by, so every bare
// body in one file fingerprinted alike and a new one absorbed an older one's
// finding: the report then names a class the branch never touched.
test("a bare body added above two others is the one reported", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/w.rb", "class BWorker\nend\n\nclass CWorker\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/w.rb", "class NewWorker\nend\n\nclass BWorker\nend\n\nclass CWorker\nend\n");
    commit("a third bare body, written first");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "app/workers",
    dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "module_include");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].where, "NewWorker", "the body this branch added, not the one it sat above");
});

test("a rescue written above an old one, in a method of the same name in another class, is reported on the line the branch wrote", needsRuby, async (t) => {
  const cls = (name) => `class ${name}\n  def run\n    go\n  rescue StandardError\n    nil\n  end\nend\n`;
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", cls("A"));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/a.rb", `${cls("B")}\n${cls("A")}`);
    commit("a second class, written first");
  });
  facts(dir, { sha: sha(dir, "main"), path: "app/models", dimensions: [dim({ key: "rescue_uses_error" })] });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "rescue_uses_error").map((f) => [f.line, f.where]), [[4, "B#run"]]);
});

test("a body mixing in a different set of modules is not the body it replaced", needsRuby, async (t) => {
  // The grouped site's identity used to be the include call's own node, which
  // is `call include` for every body in the file, so one new violating body
  // absorbed the one it was written next to.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/w.rb", "class AWorker\n  include Sidekiq::Worker\nend\n\nclass CWorker\n  include Foo::Bar\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/w.rb", "class AWorker\n  include Sidekiq::Worker\nend\n\nclass DWorker\n  include Baz::Qux\nend\n");
    commit("swap the body");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/workers/w.rb");
});

test("reordering the modules a class body includes introduces nothing", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Baz\n  include Foo::Bar\nend\n");
    commit("swap");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  assertExamined(report, "app/workers/c_worker.rb");
  assert.deepEqual(forKey(report, "module_include"), [], JSON.stringify(report.findings));
});

test("a violating body that gains a constant is charged again, and that is accepted", needsRuby, async (t) => {
  // The accepted cost of keying the site on what the body mixes in: adding a
  // module to a body that already violated moves its fingerprint, so the branch
  // is charged for a violation it did not write. The branch did edit the
  // violating body, and the severity is still capped by the baseline rules.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/workers/a_worker.rb", "class AWorker\n  include Sidekiq::Worker\nend\n");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/workers/c_worker.rb", "class CWorker\n  include Foo::Bar\n  include Foo::Baz\nend\n");
    commit("add one module to a body that already violated");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/workers",
      globs: [{ negated: false, dir: "app/workers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "Sidekiq::Worker" })],
    }],
  });
  const report = await check(dir);
  const found = forKey(report, "module_include");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].path, "app/workers/c_worker.rb");
});

test("a learned superclass is enforced the way a learned naming class is", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends React.Component {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "React.Component" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  const found = forKey(report, "extends_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "Widget");
  assert.equal(found[0].claim, "classes here extend React.Component");
});

test("a learned type prefix is enforced on a new interface", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface IThing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface Comment { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "I" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "interface_prefix");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "Comment");
  assert.equal(found[0].claim, "interfaces are named with an I prefix");
});

test("a learned absence of a prefix is enforced against a prefixed interface", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface Thing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface IFoo { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "none" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  const found = forKey(report, "interface_prefix");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].where, "IFoo");
  assert.equal(found[0].claim, "interfaces carry no prefix", "an absence is written out, never filled in");
});

test("a learned class read off the source is encoded before it reaches a claim", async (t) => {
  // The stored class of a source-learned row is repository text, so widening
  // the check to enforce it widens what a committed record can render (F4).
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends Base {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "Evil|Base\nX" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  const found = forKey(report, "extends_base");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.equal(found[0].claim, "classes here extend Evil Base X");
  assert.ok(!/[|\n]/.test(found[0].claim), JSON.stringify(found[0].claim));
});

test("a learned class the encoder empties enforces nothing", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/panel.ts", "export class Panel extends Base {}\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/widget.ts", "export class Widget extends Foo {}\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "extends_base", learned: "```" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/widget.ts");
  assert.deepEqual(forKey(report, "extends_base"), [], "a sentence that would name nothing states nothing");
});

test("a learned prefix outside its own vocabulary enforces nothing", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export interface IThing { id: string }\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.ts", "export interface Comment { id: string }\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "interface_prefix", learned: "\n# hostile\ninjected" })],
  });
  const report = await check(dir);
  assertExamined(report, "src/b.ts");
  assert.ok(!JSON.stringify(report.findings).includes("hostile"), JSON.stringify(report.findings));
  assert.deepEqual(forKey(report, "interface_prefix"), []);
});

test("a rename into a foreign filename class is a finding, a rename within the class is not", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/data-store.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/data-store.ts", "src/dataStore.ts");
    git("mv", "src/user-profile.ts", "src/user-page.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/dataStore.ts"], JSON.stringify(found));
  assert.equal(found[0].oldPath, "src/data-store.ts", "the rename provenance travels with the finding");
});

test("a stated routing claim is enforced at check time where the map offers it", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/logger.ts", `export const logger = { info(_m) {} };\n`);
    write("src/a.ts", `import { logger } from "./logger.js";\nlogger.info("x");\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/loud.ts", `console.log("direct");\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "route_logging", precision: "partial" })],
    capabilities: ["logging"],
  });
  const report = await check(dir);
  assertExamined(report, "src/loud.ts");
  const found = forKey(report, "route_logging");
  assert.equal(found.length, 1, JSON.stringify(report.findings));
  assert.ok(found[0].snippet.includes("console.log"));
});

test("a badly named new file that does not parse is still a filename finding", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/badName.ts", `export const = 5 ((((\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["src/badName.ts"], "the name needs no tree");
});

test("a Pascal-named migration breaks a stated snake_case claim (#33)", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("db/migrate/20260101000000_create_users.rb", `class CreateUsers < ActiveRecord::Migration[7.0]\n  def change\n  end\nend\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("db/migrate/20260816120000_AddBadColumn.rb", `class AddBadColumn < ActiveRecord::Migration[7.0]\n  def change\n  end\nend\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    path: "db/migrate",
    dimensions: [dim({ key: "file_naming_case", learned: "snake_case" })],
    areas: [{ id: "aaaaaaaa", path: "db/migrate", globs: [{ negated: false, dir: "db/migrate", tail: "**/*.rb" }], fileCount: 8,
      dimensions: [dim({ key: "file_naming_case", learned: "snake_case" })] }],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path), ["db/migrate/20260816120000_AddBadColumn.rb"], JSON.stringify(report.findings));
  assert.equal(found[0].severity, "MUST-FIX", "the baseline holds no violation, so this branch is the first");
});

/* --- the caveat codes, at the site each one is raised --- */

/** The codes a run answered with, so a case names the code rather than its sentence. */
const codesOf = (report) => report.caveats.map((c) => c.code);

test("a map from a build this one cannot read is one code, whatever the sentence says", async (t) => {
  // Two sentences answer this: a store directory resolving outside the
  // repository, and a schema this build does not read. They are one fact to a
  // reader, that there is a map and none of it was used.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });
  const store = join(dir, ".claude", "anatomiya", "facts.json");
  writeFileSync(store, JSON.stringify({ ...JSON.parse(readFileSync(store, "utf8")), schema: 999 }));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(codesOf(r), [CAVEATS.MAP_UNREADABLE]);
});

test("a map on disk that does not parse is reported as unreadable, not as no map", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });
  writeFileSync(join(dir, ".claude", "anatomiya", "facts.json"), "{bad");

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(codesOf(r), [CAVEATS.MAP_UNREADABLE]);
  assert.match(notes(r)[0], /does not parse as JSON/);
  assert.equal(r.staleReason, "the map on disk could not be read");
});

test("a repository holding none of the base refs says so, by code", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });

  const r = await check(dir);

  assert.ok(codesOf(r).includes(CAVEATS.NO_BASE_REF), JSON.stringify(codesOf(r)));
});

test("a branch sharing no history with its base is the degraded mode, not an empty answer", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "--orphan", "work");
    write("src/b.ts", swallow(1));
    commit("orphan");
    // Left in the tree: with no base to judge it against, a pending file is
    // named rather than charged to whoever happens to be running the check.
    write("src/c.ts", swallow(1));
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.NO_MERGE_BASE), JSON.stringify(codesOf(r)));
  assert.ok(codesOf(r).includes(CAVEATS.PENDING_UNJUDGED), JSON.stringify(codesOf(r)));
});

/**
 * A repository whose index git will not read.
 *
 * Every corpus probe goes through that index, and so does the pending edits
 * listing, while a three-dot diff between two commits does not. That is what
 * makes it the cheap way to reach the three codes below at once.
 */
function withUnreadableIndex(t, extra = null) {
  return repo(t, ({ dir, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    if (extra) write(extra.path, extra.body);
    commit("swallow");
    writeFileSync(join(dir, ".git", "index"), "this is not a git index");
  });
}

test("a corpus that will not list costs the routing claims and says so, by code", async (t) => {
  // Nothing here refuses over it: a probe that failed is a question left
  // unanswered rather than a branch nobody may report on.
  const dir = withUnreadableIndex(t);

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.PENDING_UNLISTED), JSON.stringify(codesOf(r)));
  assert.ok(codesOf(r).includes(CAVEATS.CAPABILITIES_UNKNOWN), JSON.stringify(codesOf(r)));
  // The discriminator between the two single-use codes: nothing examined here
  // could carry a framework, so the framework probe never ran. Exchanging the
  // two codes at their sites passes every other test in this repository.
  assert.ok(!codesOf(r).includes(CAVEATS.FRAMEWORKS_UNKNOWN), JSON.stringify(codesOf(r)));
});

test("a corpus that will not list costs the framework claims too, where one could signal", needsRuby, async (t) => {
  const dir = withUnreadableIndex(t, { path: "app/models/thing.rb", body: "class Thing\nend\n" });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.FRAMEWORKS_UNKNOWN), JSON.stringify(codesOf(r)));
});

test("a file that did not parse at the merge base is named apart from one that did not parse now", async (t) => {
  // The branch fixed it, so there is no base side to difference against and
  // every site in the file reads as newly introduced. The code is what tells
  // that apart from a file this branch broke.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/broken.ts", "export function x( { !!!\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/broken.ts", swallow(1));
    commit("fixed");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(codesOf(r), [CAVEATS.NO_MAP, CAVEATS.BASE_UNPARSED]);
});

test("a rules directory that is not a directory is one nobody could list", async (t) => {
  // `.claude/rules` is a repository path like any other, so a clone can ship a
  // regular file there. Reported rather than refused: the check has nothing to
  // refuse and says what it could not look at.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    write(".claude/rules", "not a directory\n");
    commit("swallow");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.ok(codesOf(r).includes(CAVEATS.RULES_UNLISTED), JSON.stringify(codesOf(r)));
});

test("a new file whose stem spells no naming class at all is a finding", async (t) => {
  // The one-sided shape H16 fixed for `module_include`, on the filename row: a
  // stem spelling a different class was caught and a stem spelling no class
  // escaped, so `TMP_FILE.ts` and `_tmpProbe.ts` passed a stated camelCase
  // claim while `TmpFile.ts` and `tmp_file.ts` were both caught.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/TMP_FILE.ts", `export const b = 2;\n`);
    write("src/_tmpProbe.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => f.path).sort(), ["src/TMP_FILE.ts", "src/_tmpProbe.ts"]);
  assert.equal(found[0].claim, "files here are named kebab-case");
});

test("the two names that match every class are still not sites", async (t) => {
  // A single lowercase run and a bare filename are the predicate's own two
  // exclusions, and they are kept: counting them would let a directory of
  // `index.ts` state a convention no filename ever expressed, and then break
  // its own claim on the next one.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/index.ts", `export const b = 2;\n`);
    write("src/Rakefile", `task :x\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assert.deepEqual(forKey(report, "file_naming_case"), []);
});

test("a route file whose name the router dictates is not told to rename itself", async (t) => {
  // Measured on a Next.js `src/pages` stating kebab-case at 40 of 40: a new
  // `[id].tsx` and `_document.tsx` were each reported "files here are named
  // kebab-case", and the only fix that finding offers breaks the dynamic route
  // or drops the special file. An underscore on a multi-word stem is still the
  // omission C23 counts, so `_tmpProbe.ts` stays a finding beside them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/pages/user-profile.tsx", `export default function P() {\n  return <main />;\n}\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/pages/[id].tsx", `export default function Post() {\n  return <main />;\n}\n`);
    write("src/pages/[...slug].tsx", `export default function All() {\n  return <main />;\n}\n`);
    write("src/pages/_document.tsx", `export default function Doc() {\n  return <html />;\n}\n`);
    write("src/pages/$postId.tsx", `export default function R() {\n  return <main />;\n}\n`);
    write("src/pages/+page.ts", `export const load = 1;\n`);
    write("src/pages/_tmpProbe.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });
  const report = await check(dir);
  assert.deepEqual(forKey(report, "file_naming_case").map((f) => f.path), ["src/pages/_tmpProbe.ts"]);
});

/* --- an explicit base that names nothing is a refusal (#51) --- */

test("an explicit base that resolves nowhere is refused, with the ref echoed back", async (t) => {
  // The command file's own contract is that a non-zero exit means the check
  // could not run. A typo used to be answered with 685 added-lines findings
  // over 2,150 files at exit 0, and the agent reading it saw a giant review it
  // never asked for on a branch that changed nothing.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  await assert.rejects(
    () => check(dir, { baseRef: "no/such/ref" }),
    (err) => {
      assert.match(err.message, /no\/such\/ref/, err.message);
      assert.match(err.message, /--base/, "the fix named is the argument, not the repository");
      return true;
    }
  );
});

test("HEAD resolves locally, so it is refused for what it is rather than as unfetchable", async (t) => {
  // `HEAD` resolves in every repository that has a commit, so reporting it as a
  // base the shallow clone could not fetch names the wrong cause and the wrong
  // fix. It is refused because it is this branch's own tip (E6).
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(
    () => check(dir, { baseRef: "HEAD" }),
    (err) => {
      assert.match(err.message, /HEAD/);
      assert.doesNotMatch(err.message, /fetch/, err.message);
      return true;
    }
  );
});

test("a base that does resolve is used, whatever its spelling", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  for (const ref of ["main", sha(dir, "main")]) {
    const r = await check(dir, { baseRef: ref });
    assert.equal(r.mode, "compare", `${ref} resolves`);
  }
});

test("the default candidate list still degrades rather than refusing", async (t) => {
  // The degradation stays for the case it was built for: a repository holding
  // none of the base refs was never asked for one, so nothing was mistyped.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "-m", "topic");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir);

  assert.equal(r.mode, "added-lines");
  assert.ok(codesOf(r).includes(CAVEATS.NO_BASE_REF), JSON.stringify(codesOf(r)));
});

test("a small plurality does not turn the practice most of the repository follows into a finding", async (t) => {
  // Measured end to end: a 7-site area at 3 named and 4 inline flipped the
  // printed sentence, and a branch adding a *named* handler was then reported
  // against the inverse. `handler_is_named` is 0.757 the other way repo-wide.
  const named = 'export const A = () => { const h = () => {}; return <button onClick={h} /> }\n';
  const inline = 'export const B = () => <button onClick={() => {}} />\n';
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 3; i++) write(`src/n${i}.tsx`, named.replace(/A/g, `A${i}`).replace("h", `h${i}`));
    for (let i = 0; i < 4; i++) write(`src/i${i}.tsx`, inline.replace("B", `B${i}`));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/new.tsx", named.replace(/A/g, "N").replace("h", "hn"));
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    fileCount: 7,
    pinned: ["src/n0.tsx", "src/n1.tsx", "src/n2.tsx", "src/i0.tsx", "src/i1.tsx", "src/i2.tsx", "src/i3.tsx"],
    dimensions: [
      dim({
        key: "handler_is_named",
        directive: false,
        states: null,
        gate: "ratio",
        candidates: 7,
        conforming: 3,
        counterClaim: "an event handler prop is given an inline arrow, not a named function",
        counterGate: "ratio",
        baseline: { candidates: 7, conforming: 3, exceptions: [] },
      }),
    ],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "handler_is_named"), [], JSON.stringify(forKey(r, "handler_is_named")));
});

test("a claim stated on borrowed confidence is capped, and the reason says whose confidence it was", () => {
  // The map may state a nine-site claim on the strength of the rest of the
  // repository, and the check may not then enforce it at the severity that
  // means "this branch is the first violation in the area's history". The old
  // reason read "9 of 9 baseline sites is thin" under a map that had just
  // stated it, which is a contradiction rather than an explanation.
  const d = dim({ borrowed: true, baseline: { candidates: 9, conforming: 9, exceptions: [] } });
  const v = severityFor({ path: "src/a.ts" }, { dim: d });

  assert.equal(v.severity, "FIX");
  assert.match(v.reason, /rest of the repository/, v.reason);
  assert.doesNotMatch(v.reason, /thin/);
});

test("a thin baseline nobody lent anything to still reads as thin", () => {
  const d = dim({ baseline: { candidates: 9, conforming: 9, exceptions: [] } });

  assert.match(severityFor({ path: "src/a.ts" }, { dim: d }).reason, /9 of 9 baseline sites is thin/);
});

test("an @ base is refused before anything is fetched, so a remote branch named HEAD cannot become one", async (t) => {
  // E6: over `<HEAD>..HEAD` the branch's own edits count as map drift, so the
  // literal ref is refused rather than quietly accepted. The shallow fallback
  // fetches by branch name, so the refusal has to come before it.
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(() => check(dir, { baseRef: "@" }), /--base @ names this branch's own tip/);
});

test("a base spelled in a way git will not take resolves to nothing and is refused as such", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
  });
  facts(dir, { sha: sha(dir, "HEAD") });

  await assert.rejects(() => check(dir, { baseRef: "bad..name" }), /--base bad\.\.name resolves to no commit/);
});

/* --- an area with no slot for a dimension inherits the nearest one that states (#55) --- */

test("the first site of a kind an area has never held is answered by the area it sits inside", async (t) => {
  // A dimension that finds zero sites in an area produces no slot at all, so
  // the area has no sentence to ask and the first `Net::HTTP` call it ever
  // sees, the one that decides whether the area's HTTP goes through the
  // repository's own client, could never be flagged at any severity. Covered
  // but first-of-kind was blinder than uncovered, which at least gets a NIT.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].area, "src/api");
  assert.equal(hits[0].severity, "FIX", "the ancestor's file is not delivered to this directory, so not MUST-FIX");
  assert.match(hits[0].reason, /counted in src/);
});

test("no slot anywhere on the path keeps today's silence", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim({ directive: false, states: null, gate: "authors" })] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], "an ancestor that states nothing lends nothing");
});

test("an area that holds its own slot never reads an ancestor's", async (t) => {
  // The deepest area containing a file supplies its claims. Inheriting past a
  // slot the area does have would judge the file against a convention counted
  // over a different population.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [dim({ directive: false, states: null, gate: "authors" })] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, "NIT", "its own suppressed slot, not the parent's stated one");
});

test("an inherited slot is judged on the side the ancestor was handed", async (t) => {
  // The polarity travels with the slot. Reading the ancestor for the finding
  // and the area for the side would charge an author for writing the sentence
  // the ancestor's map handed them.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a() { try { go() } catch (e) { log(e) } }\n`);
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write(
      "src/api/b.ts",
      `export const b = 1;\n` +
        "/** documented */\nexport function documented() { return 1 }\n" +
        "export function bare() { return 2 }\n"
    );
    commit("two exports");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [
          dim({
            key: "doc_comment_style",
            states: "counter",
            directive: false,
            gate: "ratio",
            counterClaim: "code here explains itself; exported functions carry no doc comment",
            counterGate: null,
            counterExceptions: [],
          }),
        ],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "doc_comment_style");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].where, "documented", "the documented export is what breaks the inherited sentence");
  assert.equal(hits[0].claim, "code here explains itself; exported functions carry no doc comment");
});

/* --- a directive the 40-line budget dropped may not reach MUST-FIX (#70) --- */

test("a claim the area file had no room to print is capped, and the reason says why", () => {
  const d = dim({ baseline: { candidates: 60, conforming: 60, exceptions: [] } });

  assert.equal(severityFor({ path: "src/a.ts" }, { dim: d }).severity, "MUST-FIX");
  const capped = severityFor({ path: "src/a.ts" }, { dim: d, dropped: true });
  assert.equal(capped.severity, "FIX");
  assert.match(capped.reason, /no room/, capped.reason);
});

test("a dropped claim the area file still names is capped under its own reason", () => {
  const d = dim({ baseline: { candidates: 60, conforming: 60, exceptions: [] } });

  const named = severityFor({ path: "src/a.ts" }, { dim: d, dropped: "named" });
  assert.equal(named.severity, "FIX");
  assert.equal(named.reason, "the area file names this claim without its counts");
  assert.match(severityFor({ path: "src/a.ts" }, { dim: d, dropped: "unnamed" }).reason, /no room/);
});

test("a directive the file dropped is enforced, but never at the top severity", async (t) => {
  // `check` reads facts.json, not the rendered area file, so a sentence the map
  // never printed was still reported as "all 60 baseline sites conform", which
  // means the map told the agent and they were the first to break it. On a
  // measured repository three slots with a perfect baseline reached MUST-FIX on
  // a claim that appears nowhere in the file the agent reads.
  const filler = [
    "error_shape", "module_state_const", "async_error_handling", "optional_chaining",
    "function_style", "explicit_return_type", "nullish_default", "non_null_assertion",
    "absent_is_null", "doc_comment_style",
  ];
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    // `swallowed_error` sits last, so it is the block the budget drops.
    dimensions: [...filler.map((key) => dim({ key, precision: "partial" })), dim()],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].severity, "FIX");
  assert.match(hits[0].reason, /^the area file (names this claim without its counts|had no room to state this claim)$/, hits[0].reason);
});

test("a dropped directive says whether the area file still names it", async (t) => {
  // The notice names the first stated slots it cannot print, and the check told
  // the agent the file never stated a sentence it prints word for word. The
  // record stores no claim-side prose, so the file is rendered here from the
  // slots the scan held, sentences and all.
  const claim = "catch blocks use the error they caught";
  for (const [fillers, reason] of [
    [10, "the area file names this claim without its counts"],
    [30, "the area file had no room to state this claim"],
  ]) {
    const dimensions = [
      ...Array.from({ length: fillers }, (_, i) => dim({ key: `filler_${i}`, precision: "partial", claim: `filler claim ${i}` })),
      dim({ claim }),
    ];
    const dir = repo(t, ({ git, write, commit }) => {
      write("src/a.ts", clean(2));
      commit("init");
      git("checkout", "-q", "-b", "work");
      write("src/a.ts", clean(2) + swallow(1));
      commit("swallow");
    });
    facts(dir, { sha: sha(dir, "main"), dimensions });
    const file = renderArea({ id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions }).split("\n");
    assert.ok(file.some((l) => /^and \d+ more not shown here/.test(l)), `${fillers}: the block was dropped`);
    assert.equal(file.includes(`  ${claim}`), fillers === 10, file.join("\n"));

    const hits = forKey(await check(dir, { baseRef: "main" }), "swallowed_error");

    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].severity, "FIX");
    assert.equal(hits[0].reason, reason, `${fillers} fillers`);
  }
});

test("an error class is not held to the base the area learned", needsRuby, async (t) => {
  // Every Rails service directory grows error classes, so on a perfect
  // baseline the next one anyone adds was a MUST-FIX asking for a class Ruby
  // refuses to raise.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/services/a.rb", "class A < ActiveInteraction::Base\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/services/quota_exceeded_error.rb", "class QuotaExceededError < StandardError\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/services",
      globs: [{ negated: false, dir: "app/services", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ActiveInteraction::Base" })],
    }],
  });

  const report = await check(dir);

  assert.deepEqual(forKey(report, "class_base"), [], JSON.stringify(forKey(report, "class_base")));
});

test("the class an area learned is not asked to inherit itself", needsRuby, async (t) => {
  // `class ApplicationRecord < ApplicationRecord` is a NameError.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User < ApplicationRecord\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/application_record.rb", "class ApplicationRecord < ActiveRecord::Base\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord" })],
    }],
  });

  const report = await check(dir);

  assert.deepEqual(forKey(report, "class_base"), [], JSON.stringify(forKey(report, "class_base")));
});

test("a new subclass of a class the map records as reaching the learned base is not a finding", needsRuby, async (t) => {
  // Single-table inheritance: the fold counted `Admin < User` as conforming
  // because User reaches ApplicationRecord, and the check has to agree, or a
  // branch adding `class Guest < User` is told to break the hierarchy.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User < ApplicationRecord\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/guest.rb", "class Guest < User\nend\n");
    write("app/models/ledger.rb", "class Ledger < Struct\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord", reaches: ["User"] })],
    }],
  });

  const report = await check(dir);

  const found = forKey(report, "class_base");
  assert.deepEqual(found.map((f) => f.path), ["app/models/ledger.rb"], JSON.stringify(found));
});

test("a subclass of a base the branch adds in the same area conforms when that base reaches the learned one", needsRuby, async (t) => {
  // The fold follows the chain through every class the area declares, and a
  // base the branch adds is one of them; read off the pinned map alone, each
  // subclass was told to skip the base the branch added on purpose.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User < ApplicationRecord\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/blocks_base.rb", "class Slack::BlocksBase < ApplicationRecord\nend\n");
    write("app/models/block_a.rb", "class Slack::BlockA < Slack::BlocksBase\nend\n");
    write("app/models/deep.rb", "class Deep < Mid\nend\nclass Mid < Slack::BlocksBase\nend\n");
    // A base outside the area is not one the fold follows.
    write("lib/outside_base.rb", "class OutsideBase < ApplicationRecord\nend\n");
    write("app/models/outside.rb", "class Outside < OutsideBase\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord", reaches: ["User"] })],
    }, {
      id: "bbbbbbbb",
      path: "lib",
      globs: [{ negated: false, dir: "lib", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord" })],
    }],
  });

  const report = await check(dir);

  const found = forKey(report, "class_base");
  assert.deepEqual(found.map((f) => f.path), ["app/models/outside.rb"], JSON.stringify(found));
});

test("a class the branch moves off the learned base no longer carries its subclasses", needsRuby, async (t) => {
  // The pinned map says User reaches the base, and the branch says it does not
  // any more; the branch's tree is the one being judged.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User < ApplicationRecord\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/user.rb", "class User < Struct\nend\n");
    write("app/models/guest.rb", "class Guest < User\nend\n");
    commit("move");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "class_base", learned: "ApplicationRecord", reaches: ["User"] })],
    }],
  });

  const report = await check(dir);

  const found = forKey(report, "class_base");
  assert.deepEqual(found.map((f) => f.path).sort(), ["app/models/guest.rb", "app/models/user.rb"], JSON.stringify(found));
});

/* --- an omission is only a finding where the map stated the claim (#54) --- */

test("a body that includes nothing is not judged against a row the map did not state", needsRuby, async (t) => {
  // H16's new site is the forgotten include, and its whole meaning is "you
  // should have written X". On a row the map holds at "20 of 31 sites, no
  // convention" that is advice the map itself refuses to print: a count failing
  // the gate prints as a count and never as a directive. The NIT tier softens
  // it, not the direction.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  def name; end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty", directive: false, states: null, gate: "ratio" })],
    }],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "module_include"), [], JSON.stringify(forKey(r, "module_include")));
});

test("a body that includes the wrong module is still counted where the map said nothing", needsRuby, async (t) => {
  // The difference is the direction of the advice. "you wrote a different
  // module from the one this area writes" is the count speaking; "add this
  // module" is a directive the gates refused.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  include Comparable\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty", directive: false, states: null, gate: "ratio" })],
    }],
  });

  const r = await check(dir);
  const hits = forKey(r, "module_include");

  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].severity, "NIT");
});

test("a forgotten include is still a finding where the map did state the claim", needsRuby, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/a.rb", "class A\n  include ActiveModel::Dirty\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/tmp_probe.rb", "class TmpProbe\n  def name; end\nend\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "module_include", learned: "ActiveModel::Dirty" })],
    }],
  });

  const r = await check(dir);

  assert.equal(forKey(r, "module_include").length, 1, JSON.stringify(r.findings));
});

test("the check excuses the wrapper the scan excused", async (t) => {
  // A scan-only exclusion is the H12 asymmetry in reverse: the map stops
  // naming the client as its own exception and the check keeps reporting it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/request.ts", `export const go = () => fetch("/x");\n`);
    write("src/userApi.ts", `export const go = () => fetch("/y");\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    capabilities: ["network"],
    dimensions: [dim({ key: "route_network", precision: "partial" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "route_network").map((f) => f.path), ["src/userApi.ts"], JSON.stringify(r.findings));
});

test("a branch that edits an abstract base is not asked for a spec for it", needsRuby, async (t) => {
  // A scan-only exclusion makes the one commit in 483 that edits a base
  // controller a finding against a file the map never counted.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/controllers/api/v1/base_controller.rb", "class Api::V1::BaseController\nend\n");
    write("app/controllers/api/v1/listings_controller.rb", "class Api::V1::ListingsController\nend\n");
    write("spec/controllers/api/v1/listings_controller_spec.rb", "describe Api::V1::ListingsController do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/controllers/api/v1/base_controller.rb", "class Api::V1::BaseController\n  def x; end\nend\n");
    commit("edit the base");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/controllers",
      globs: [{ negated: false, dir: "app/controllers", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "controller_spec" })],
    }],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "controller_spec"), [], JSON.stringify(r.findings));
});

test("a branch that ships its model with a spec commented out top to bottom still owes one", needsRuby, async (t) => {
  // The map counts that model unpaired, so a check that took the file name for
  // a spec would pass the branch on a file the runner collects nothing from.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/user.rb", "class User\nend\n");
    write("spec/models/user_spec.rb", "describe User do\n  it { }\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/post.rb", "class Post\nend\n");
    write("spec/models/post_spec.rb", "# describe Post do\n#   it { }\n# end\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [{
      id: "aaaaaaaa",
      path: "app/models",
      globs: [{ negated: false, dir: "app/models", tail: "**/*.rb" }],
      fileCount: 8,
      dimensions: [dim({ key: "model_spec" })],
    }],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "model_spec").map((f) => f.path), ["app/models/post.rb"], JSON.stringify(r.findings));
});

test("a plain JavaScript file on a branch is not asked for a return type", async (t) => {
  // The scan does not count it, so the check must not enforce it: the two
  // disagreeing about what a site is is the asymmetry every one of these rules
  // is written to close.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", `export function a(): number { return 1 }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/b.js", `export function b(rows) { return rows.length }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "explicit_return_type", precision: "partial" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "explicit_return_type"), [], JSON.stringify(r.findings));
});

test("a file that gains JSX on the branch does not have its whole base side skipped", async (t) => {
  // The kind was answered per revision, so a file whose base version held no
  // JSX had its base side judged as the other kind and skipped whole: every
  // pre-existing violation in it came back as newly introduced, at MUST-FIX, on
  // lines the diff never touched.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    write("src/Helper.tsx", `export function bad_helper(x) { return x + 1 }\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/Helper.tsx", `export function bad_helper(x) { return x + 1 }\nexport const Extra = () => <div />\n`);
    commit("add a component to the helper file");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "jsx", narrowed: true })],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "function_naming_case").map((f) => f.where),
    [],
    JSON.stringify(r.findings)
  );
});

test("a .ts file renamed to .tsx is parsed at the merge base as the .ts it was", async (t) => {
  // The base was parsed under the head path's grammar, and a generic arrow is
  // valid TypeScript and a syntax error in TSX: the whole file was skipped as
  // one that "did not parse at the merge base", its new violation with it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/util.ts", `export const identity = <T>(x: T): T => x;\n` + clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/util.ts", "src/util.tsx");
    write("src/util.tsx", `export const identity = <T,>(x: T): T => x;\n` + clean(2) + swallow(1));
    commit("to tsx");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assertExamined(r, "src/util.tsx");
  assert.deepEqual(forKey(r, "swallowed_error").map((f) => [f.path, f.line]), [["src/util.tsx", 4]]);
});

test("the sentence the check quotes is the one the map printed", async (t) => {
  // The map names the kind a narrowed row was learned over. The check built its
  // own text from the registry template and quoted the unqualified sentence,
  // the one that pools the excluded files back in, in the finding, the JSON and
  // the annotations at once.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/SyncTooltip.ts", `export function SyncTooltip(x) { return x }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({ key: "file_naming_case", learned: "camelCase", learnedKind: "module", narrowed: true }),
      dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "module", narrowed: true }),
    ],
  });

  const r = await check(dir);
  const claims = r.findings.map((f) => f.claim);

  assert.ok(claims.length >= 2, JSON.stringify(r.findings));
  for (const c of claims) {
    assert.match(c, /files that hold no JSX|files here that hold no JSX/, JSON.stringify(claims));
  }
});

test("an area the narrowing left whole keeps the plain sentence in the finding too", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/SyncTooltip.ts", `export function SyncTooltip(x) { return x }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "function_naming_case", learned: "camelCase", learnedKind: "module" })],
  });

  const r = await check(dir);

  assert.deepEqual(
    [...new Set(r.findings.map((f) => f.claim))],
    ["functions are named camelCase"],
    JSON.stringify(r.findings)
  );
});

test("a claim the owning area's own globs never deliver here is capped", async (t) => {
  // Ownership is the directory prefix and delivery is the glob, and A10 makes
  // the glob the narrower of the two: an area listing only its own files owns
  // every new subdirectory under it and delivers its sentences to none of them.
  // On one measured repository 11 of 156 areas carry no recursive glob of their
  // own, and a planted file in a new subdirectory of one of them drew MUST-FIX
  // on a claim its author was never handed.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/one.ts", `export const one = 1\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/nested/deep.ts", `let two = 2\nexport { two }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [{ negated: false, dir: "src", tail: "*.ts" }],
        fileCount: 8,
        dimensions: [dim({ key: "module_state_const" })],
      },
    ],
  });

  const r = await check(dir);
  const found = forKey(r, "module_state_const");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "FIX", JSON.stringify(found[0]));
  assert.match(found[0].reason, /which this directory sits inside/);
});

test("a file the area's globs miss by its type is capped for its type, not for a directory above it", async (t) => {
  // The cap is right: the area file is never delivered to a `.tsx`. The reason
  // said the file was "counted in src, which this directory sits inside" of a
  // file sitting in src itself, and hid that the globs do not cover the type.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/one.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/view.tsx", swallow(1));
    commit("add");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "swallowed_error");

  assert.deepEqual(found.map((f) => [f.severity, f.reason]), [
    ["FIX", "the area file for src does not reach .tsx files, so this claim was never delivered here"],
  ]);
});

test("an obligation is capped on a path the area's globs never deliver to, like every other finding", async (t) => {
  // The cap reached the tree rows and the filename rows and not the third
  // producer, so one file could draw a FIX for its name and a MUST-FIX for its
  // missing spec off the same undelivered area file.
  const dir = repo(t, ({ git, write, commit }) => {
    write("app/models/thing.rb", "class Thing\nend\n");
    write("spec/models/thing_spec.rb", "describe Thing do\nend\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("app/models/nested/other.rb", "class Other\nend\n");
    commit("a model in a new subdirectory, no spec");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "app/models",
        globs: [{ negated: false, dir: "app/models", tail: "*.rb" }],
        fileCount: 8,
        dimensions: [dim({ key: "model_spec", directive: true })],
      },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const found = forKey(r, "model_spec");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "FIX", JSON.stringify(found[0]));
  assert.match(found[0].reason, /which this directory sits inside/);
});

test("an undelivered claim the gates suppressed is still only a NIT", async (t) => {
  // The cap replaced the verdict instead of capping it, so a slot the map
  // prints as "no convention" was raised from NIT to FIX on exactly the paths
  // the map never delivered to, with a reason claiming it was counted there.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/one.ts", `export const one = 1\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/nested/deep.ts", `let two = 2\nexport { two }\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [{ negated: false, dir: "src", tail: "*.ts" }],
        fileCount: 8,
        dimensions: [dim({ key: "module_state_const", states: null, directive: false, gate: "ratio" })],
      },
    ],
  });

  const r = await check(dir);
  const found = forKey(r, "module_state_const");

  assert.equal(found.length, 1, JSON.stringify(r.findings));
  assert.equal(found[0].severity, "NIT", JSON.stringify(found[0]));
  assert.match(found[0].reason, /no convention stated here/);
});

test("a helper in a directory of components is not judged by the components' naming class", async (t) => {
  // The map learned PascalCase over the files that hold JSX. A camelCase helper
  // beside them expresses no opinion about that convention, and judging it by
  // one produced 5 of the 9 findings on one measured pull request.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    write("src/orderList.tsx", `export const orderList = () => <div />\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" })],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "file_naming_case").map((f) => f.path),
    ["src/orderList.tsx"],
    JSON.stringify(forKey(r, "file_naming_case"))
  );
});

test("an acronym component name is not judged by a PascalCase claim over files that hold JSX", async (t) => {
  // React reads `SBA` as a component exactly as it reads `Sba`, and the one
  // name that cleared the claim no longer matched the component inside it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.jsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/SBA.jsx", `const SBA = () => <div>SBA</div>\nexport default SBA\n`);
    write("src/DEBUG_PANEL.jsx", `const Panel = () => <div />\nexport default Panel\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" })],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "file_naming_case").map((f) => f.path),
    ["src/DEBUG_PANEL.jsx"],
    JSON.stringify(forKey(r, "file_naming_case"))
  );
});

test("a file the parser could not read is not sorted into a kind by its absence", async (t) => {
  // `facets: null` read as "module", so a row narrowed to the module side
  // judged an unread `.tsx` at MUST-FIX, one line under the caveat saying the
  // file was not checked, and the rename it asked for turns a component into a
  // host element.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/formatDate.ts", `export const formatDate = (x) => x\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/WidgetNew.tsx", `export function WidgetNew() {\n  return <div>x</div>\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "camelCase", learnedKind: "module" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case"), [], JSON.stringify(r.findings));
});

test("a map with no learned kind judges every file, which is what an older record means", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "PascalCase" })],
  });

  const r = await check(dir);

  assert.equal(forKey(r, "file_naming_case").length, 1);
});

test("a sibling whose path merely starts with another area's is not inside it", async (t) => {
  // `src/apiary` is not inside `src/api`. The separator is what makes the
  // prefix a containment rather than a spelling coincidence.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/api/a.ts", clean(2));
    write("src/apiary/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/apiary/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/apiary", globs: [glob("src/apiary")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error"), [], JSON.stringify(forKey(r, "swallowed_error")));
});

test("the repository root is an ancestor of everything and is asked last", async (t) => {
  // "." contains every path without being a prefix of any of them, the same
  // rule `areaOwner` already carries.
  const dir = repo(t, ({ git, write, commit }) => {
    write("root.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: ".", globs: [glob(".")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim({ key: "error_shape" })] },
      { id: "cccccccc", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });
  const hits = forKey(r, "swallowed_error");

  assert.equal(hits.length, 1, JSON.stringify(r.findings));
  assert.match(hits[0].reason, /counted in \./, hits[0].reason);
});

test("the nearest ancestor that states wins over a further one", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("root.ts", clean(2));
    write("src/api/b.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/b.ts", `export const b = 1;\n` + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: ".", globs: [glob(".")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "cccccccc", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.match(forKey(r, "swallowed_error")[0].reason, /counted in src/);
});

test("an inherited slot is judged over the population its ancestor measured, not over this file", async (t) => {
  // The two rules have to compose: a slot inherited from an ancestor is still
  // a class learned over one kind of file, and a helper does not answer it just
  // because it sits one directory further down.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/UserCard.tsx", `export const UserCard = () => <div />\n`);
    write("src/api/keep.tsx", `export const Keep = () => <div />\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/syncStatusTooltip.ts", `export const syncStatusTooltip = (x) => x\n`);
    write("src/api/orderList.tsx", `export const orderList = () => <div />\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" })],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir);

  assert.deepEqual(
    forKey(r, "file_naming_case").map((f) => f.path),
    ["src/api/orderList.tsx"],
    JSON.stringify(forKey(r, "file_naming_case"))
  );
});

test("a filename claim is inherited from the area above, capped at FIX", async (t) => {
  // An area with no slot for the filename row is one where nothing classified,
  // not one that declined the convention.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/api/index.ts", `export const b = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/api/orderList.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [glob("src")],
        fileCount: 8,
        dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
      },
      { id: "bbbbbbbb", path: "src/api", globs: [glob("src/api")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir);
  const hits = forKey(r, "file_naming_case");

  assert.deepEqual(hits.map((f) => f.path), ["src/api/orderList.ts"]);
  assert.equal(hits[0].severity, "FIX");
  assert.match(hits[0].reason, /counted in src/);
});

test("renaming a file that was not a site to one that is is still a finding", async (t) => {
  // The rename guard compared the two classes, and a name that spells no class
  // and a name that spells every class both classify to null, so renaming
  // `index.ts` to `TMP_FILE.ts` compared null against null and answered
  // "the name did not change class".
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/index.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/index.ts", "src/TMP_FILE.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case").map((f) => f.path), ["src/TMP_FILE.ts"]);
});

test("renaming between two names that both spell no class is not a new finding", async (t) => {
  // The old name predates the branch and both are the same non-answer.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    write("src/TMP_A.ts", `export const b = 2;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/TMP_A.ts", "src/TMP_B.ts");
    commit("rename");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [dim({ key: "file_naming_case", learned: "kebab-case" })],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case"), []);
});

test("a hand-edited area with no path does not take the whole check down", async (t) => {
  // The record is repository-committed, so a shape nobody wrote by machine has
  // to degrade rather than throw: the array is checked, its entries are not.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: null, globs: [glob("src")], fileCount: 8, dimensions: [] },
    ],
  });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(forKey(r, "swallowed_error").length, 1, JSON.stringify(r.findings));
});

test("a name spelling no class is an omission too, so it needs a stated claim", async (t) => {
  // The same rule the include-less body gets: "name this file differently" is
  // advice, and on a row the gates suppressed it is advice the map itself
  // refuses to print. A name spelling a *different* class is the count
  // speaking and is reported either way, which is what it always did.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/user-profile.ts", `export const a = 1;\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/TMP_FILE.ts", `export const b = 2;\n`);
    write("src/orderList.ts", `export const c = 3;\n`);
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    dimensions: [
      dim({ key: "file_naming_case", learned: "kebab-case", directive: false, states: null, gate: "evidence" }),
    ],
  });

  const r = await check(dir);

  assert.deepEqual(forKey(r, "file_naming_case").map((f) => f.path), ["src/orderList.ts"]);
});

/* --- the shallow arm, which #51 was measured on --- */

/**
 * A depth-1 clone of a repository with history, which is what CI checks out,
 * or a window as deep as a case needs.
 */
function shallowClone(t, build, { depth = 1, args = [] } = {}) {
  const outer = mkdtempSync(join(tmpdir(), "anatomiya-shallow-"));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const origin = join(outer, "origin");
  mkdirSync(origin, { recursive: true });

  const git = (...a) => execFileSync("git", a, { cwd: origin, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("checkout", "-q", "-b", "main");
  build({
    write: (rel, body) => {
      const abs = join(origin, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    },
    commit: (m) => {
      git("add", "-A");
      git("commit", "-qm", m);
    },
    git,
  });

  const clone = join(outer, "clone");
  execFileSync("git", ["clone", "-q", `--depth=${depth}`, ...args, `file://${origin}`, clone], { stdio: "pipe" });
  return clone;
}

test("a shallow clone refuses a base it cannot reach rather than reviewing the whole branch", async (t) => {
  // The measurement behind this was taken on a genuinely shallow clone, where
  // the fetch fallback exists for a reason: 685 added-lines findings over 2,150
  // files at exit 0, on a branch that changed nothing.
  const dir = shallowClone(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(3));
    commit("more");
  });
  assert.equal(
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: dir, encoding: "utf8" }).trim(),
    "true",
    "the fixture really is shallow"
  );

  await assert.rejects(
    () => check(dir, { baseRef: "no/such/ref" }),
    /--base no\/such\/ref resolves to no commit in this repository, and this shallow clone could not fetch it/
  );
});

test("a shallow clone fetches the one base commit the remote holds, and answers against it", async (t) => {
  // The fetch fallback's own arm: the base is on the remote and not in the
  // clone, so its sha comes off `ls-remote` and is fetched at depth one.
  const dir = shallowClone(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("branch", "base");
    write("src/a.ts", clean(3));
    commit("more");
  });

  const report = await check(dir, { baseRef: "origin/base" });

  assert.equal(report.base.ref, "origin/base");
  assert.match(report.base.sha, /^[0-9a-f]{40,64}$/);
});

test("a shallow clone with no base named still degrades rather than refusing", async (t) => {
  // The candidate list is this tool's own guess, and a clone that holds none of
  // them is an ordinary repository rather than a typo.
  const dir = shallowClone(t, ({ write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  execFileSync("git", ["remote", "remove", "origin"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["branch", "-m", "topic"], { cwd: dir, stdio: "pipe" });

  const r = await check(dir);

  assert.ok(codesOf(r).includes(CAVEATS.SHALLOW_UNFETCHED), JSON.stringify(codesOf(r)));
});

/**
 * What `actions/checkout` does on a pull request: no clone, one depth-1 fetch
 * of the merge ref the host built, and a detached checkout of it. The merge's
 * first parent is the base branch's tip, and the clone holds neither parent.
 * The build leaves the branch under review as `feat`, off `main`.
 */
function mergeRefCheckout(t, build, { trunk = "main" } = {}) {
  const outer = mkdtempSync(join(tmpdir(), "anatomiya-mergeref-"));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const origin = join(outer, "origin");
  mkdirSync(origin, { recursive: true });
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });
  git(origin, "init", "-q");
  git(origin, "config", "user.email", "t@t.test");
  git(origin, "config", "user.name", "T");
  git(origin, "checkout", "-q", "-b", trunk);
  build({
    write: (rel, body) => {
      const abs = join(origin, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    },
    commit: (m) => {
      git(origin, "add", "-A");
      git(origin, "commit", "-qm", m);
    },
    git: (...a) => git(origin, ...a),
  });
  git(origin, "checkout", "-q", "--detach", trunk);
  git(origin, "merge", "-q", "--no-ff", "feat", "-m", "Merge pull request #1");
  git(origin, "update-ref", "refs/pull/1/merge", "HEAD");
  git(origin, "checkout", "-q", trunk);

  const clone = join(outer, "clone");
  mkdirSync(clone);
  git(clone, "init", "-q");
  git(clone, "remote", "add", "origin", `file://${origin}`);
  git(clone, "fetch", "-q", "--no-tags", "--depth=1", "origin", "+refs/pull/1/merge:refs/remotes/pull/1/merge");
  git(clone, "checkout", "-q", "--force", "refs/remotes/pull/1/merge");
  return { clone, base: execFileSync("git", ["rev-parse", trunk], { cwd: origin, encoding: "utf8" }).trim() };
}

test("a base fetched into a shallow clone is the base its staleness is measured against", async (t) => {
  // The fetch lands in FETCH_HEAD and makes no ref, and staleness re-resolved
  // the base by its name: `origin/main` resolved nowhere, so every finding was
  // capped at FIX under "cannot resolve origin/main", one line below a header
  // naming origin/main as the base this run compared against.
  const dir = shallowClone(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  }, { depth: 2 });
  facts(dir, { sha: sha(dir, "HEAD~1") });

  const r = await check(dir, { baseRef: "origin/main" });

  assert.equal(r.mode, "compare", JSON.stringify(notes(r)));
  assert.equal(r.staleReason, null);
  assert.deepEqual(forKey(r, "swallowed_error").map((f) => f.severity), ["MUST-FIX"]);
});

test("a depth-1 pull request checkout is judged against the base its merge commit names", async (t) => {
  // The default CI checkout. The base fetched off the remote is the merge
  // commit's own first parent, which the commit records whatever the clone
  // holds, and `merge-base` cannot see past the graft: the run examined
  // nothing and printed 0 MUST-FIX, 0 FIX, 0 NIT on every pull request.
  const { clone, base } = mergeRefCheckout(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(clone, { sha: base });

  const r = await check(clone);

  assert.equal(r.mode, "compare", JSON.stringify(notes(r)));
  assert.equal(r.base.mergeBase, base);
  assert.deepEqual(forKey(r, "swallowed_error").map((f) => [f.path, f.line]), [["src/a.ts", 3]]);
});

test("a depth-1 checkout that still reaches no merge base names the fetch that would", async (t) => {
  // A branch head two commits past its base: HEAD's parent is the branch's own
  // first commit, so nothing the clone holds reaches the base. The run can
  // only examine nothing, and a CI log saying so without the way out reads as
  // this tool being unable to review pull requests at all.
  const dir = shallowClone(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    write("src/a.ts", clean(2) + swallow(2));
    commit("swallow again");
  });

  const r = await check(dir, { baseRef: "origin/main" });

  assert.equal(r.mode, "none");
  const said = r.caveats.find((c) => c.code === CAVEATS.SHALLOW_NO_HISTORY);
  assert.match(said?.message ?? "", /fetch-depth: 0/, JSON.stringify(r.caveats));
});

test("findings of one severity order by code unit, not by the host's locale", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("tools/a.ts", clean(2));
    write("tools/B.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("tools/a.ts", clean(2) + swallow(1));
    write("tools/B.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "swallowed_error").map((f) => f.path), ["tools/B.ts", "tools/a.ts"]);
});

test("a changed path that is now a fifo is skipped, not opened and waited on", needsPosixSpecialFiles, (t) => {
  // An open for reading waits for a writer on a fifo, and git lists the path as
  // modified, so the check hung with nothing printed. Driven in a child with a
  // bound, because a hung open holds this process too.
  const dir = repo(t, ({ git, write, commit }) => {
    for (let i = 0; i < 8; i++) write(`src/f${i}.js`, `export const a${i} = 1\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
  });
  rmSync(join(dir, "src/f1.js"));
  execFileSync("mkfifo", [join(dir, "src/f1.js")]);

  const script = `import { check } from ${JSON.stringify(new URL("../plugins/anatomiya/lib/check.mjs", import.meta.url).href)};
    const r = await check(${JSON.stringify(dir)}, { baseRef: "main" });
    process.stdout.write(JSON.stringify(r.caveats.map((c) => c.message)));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 8000 });

  assert.equal(run.signal, null, `still waiting on the fifo after 8 seconds: killed by ${run.signal}`);
  // The whole sentence rather than the prefix, like the other two: which of
  // the three places was looked in is the only thing the three of them say.
  assert.ok(JSON.parse(run.stdout || "[]").includes("could not read src/f1.js in the working tree"), run.stdout + run.stderr);
});

test("a blobless partial clone reads the merge base from its promisor rather than skipping every changed file", async (t) => {
  // F14 keeps every other read off the network, and the check's merge-base
  // read went with it: a clone that checked out its branch without ever
  // holding the base's blobs skipped each changed file as unreadable at the
  // base, and reported nothing.
  const { runScan } = await import("../plugins/anatomiya/lib/commands.mjs");
  const origin = scratch(t, "anatomiya-check-promisor-");
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
  run(origin, "init", "-q", "-b", "main");
  run(origin, "config", "uploadpack.allowFilter", "true");
  run(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  mkdirSync(join(origin, "src"));
  for (let i = 0; i < 8; i++) writeFileSync(join(origin, "src", `f${i}.ts`), `export function f${i}(a: number): number {\n  return a;\n}\n`);
  run(origin, "add", "-A");
  run(origin, "-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qm", "init");
  run(origin, "checkout", "-q", "-b", "feat");
  writeFileSync(join(origin, "src", "f0.ts"), "export const f0 = (a: number) => {\n  return a;\n};\n");
  // A rename too: detecting it reads the base side of both paths, and a diff
  // refused that read failed whole, so nothing at all was examined.
  run(origin, "mv", "src/f1.ts", "src/g1.ts");
  writeFileSync(join(origin, "src", "g1.ts"), "export function f1(a: number): number {\n  // renamed, and edited\n  return a;\n}\n");
  run(origin, "-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qam", "feat");
  run(origin, "checkout", "-q", "main");
  writeFileSync(join(origin, "src", "f2.ts"), "export function f2(a: number): number {\n  return a + 1;\n}\n");
  run(origin, "-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qam", "main moves on");

  const dir = scratch(t, "anatomiya-check-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin}`, dir], { stdio: "pipe" });
  run(dir, "checkout", "-q", "feat");
  await runScan(dir);

  const report = await check(dir, { baseRef: "origin/main" });

  assert.ok(!notes(report).some((n) => /at the merge base|could not be read/.test(n)), notes(report).join("\n"));
  assert.ok(report.findings.some((f) => f.path === "src/f0.ts"), "the changed file was judged against its base");
});

test("a shallow clone that already holds the base ref still finds the base its merge commit names", async (t) => {
  // `--no-single-branch` holds every branch at depth one, so `origin/main`
  // resolves locally and the fetch path never ran: that path is the only one
  // that asked HEAD's own commit for its parents, and the run examined nothing.
  const dir = shallowClone(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    // The remote's own HEAD back on main, so `origin/HEAD` names main.
    git("checkout", "-q", "main");
  }, { args: ["--no-single-branch", "--branch", "feat"] });
  const main = sha(dir, "origin/main");
  facts(dir, { sha: main });

  const r = await check(dir);

  assert.equal(r.mode, "compare", JSON.stringify(notes(r)));
  assert.equal(r.base.mergeBase, main);
  assert.deepEqual(forKey(r, "swallowed_error").map((f) => [f.path, f.line]), [["src/a.ts", 3]]);
});

test("a shallow clone holding a base ref that shares no held history names the fetch that would", async (t) => {
  const dir = shallowClone(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    write("src/a.ts", clean(2) + swallow(2));
    commit("swallow again");
    // The remote's own HEAD back on main, so `origin/HEAD` names main.
    git("checkout", "-q", "main");
  }, { args: ["--no-single-branch", "--branch", "feat"] });

  const r = await check(dir);

  assert.equal(r.mode, "none");
  const said = r.caveats.find((c) => c.code === CAVEATS.SHALLOW_NO_HISTORY);
  assert.match(said?.message ?? "", /fetch-depth: 0/, JSON.stringify(r.caveats));
});

test("a pull request checkout off a remote whose default branch is not main finds that branch", async (t) => {
  // `origin/HEAD` was asked of the remote as `refs/heads/HEAD`, a branch no
  // remote holds, so a trunk named anything but main or master resolved no base.
  const { clone, base } = mergeRefCheckout(t, ({ write, commit, git }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  }, { trunk: "trunk" });
  facts(clone, { sha: base });

  const r = await check(clone);

  assert.equal(r.base.ref, "origin/HEAD", JSON.stringify(notes(r)));
  assert.equal(r.mode, "compare", JSON.stringify(notes(r)));
  assert.equal(r.base.mergeBase, base);
});

test("a base spelled any way that names this branch's own tip is refused, not answered clean", async (t) => {
  // Only the literal `HEAD` and `@` were refused. `HEAD~0` or the branch's own
  // name is the same commit, and the run compared the branch with itself and
  // printed a clean report at exit 0 (E6).
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  for (const ref of ["HEAD~0", "@~0", "work", "refs/heads/work", "work~0"]) {
    await assert.rejects(
      () => check(dir, { baseRef: ref }),
      (err) => {
        assert.match(err.message, /own tip/, err.message);
        return true;
      },
      ref
    );
  }
  // The control: another branch at the same commit, or the commit by its id,
  // is what a branch holding only uncommitted work is checked against.
  execFileSync("git", ["branch", "same"], { cwd: dir, stdio: "pipe" });
  for (const ref of ["same", sha(dir)]) {
    assert.equal((await check(dir, { baseRef: ref })).mode, "compare", ref);
  }
});

test("a branch whose name spells like a commit id is still refused as its own base", async (t) => {
  // The id exemption was read off the spelling, so a branch named by a ticket
  // number or a hex word compared itself with itself and printed 0 changed
  // files at exit 0.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });

  for (const name of ["7812", "facade", "cafe0"]) {
    execFileSync("git", ["checkout", "-q", "-b", name, "feat"], { cwd: dir, stdio: "pipe" });
    await assert.rejects(() => check(dir, { baseRef: name }), /--base \w+ names this branch's own tip/, name);
  }
  // The tip's own id, full or abbreviated, stays a base.
  for (const ref of [sha(dir), sha(dir).slice(0, 7)]) {
    assert.equal((await check(dir, { baseRef: ref })).mode, "compare", ref);
  }
});

test("the branch's own name in another case is refused where the filesystem folds case", async (t) => {
  // The loose ref file opens under any case, so `FEAT` resolved to this tip as
  // `refs/heads/FEAT`, a name that is not HEAD's, and read as another branch.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "FEAT"], { cwd: dir, stdio: "pipe" });
  } catch {
    return t.skip("this filesystem tells FEAT from feat");
  }

  await assert.rejects(() => check(dir, { baseRef: "FEAT" }), /--base FEAT names this branch's own tip/);
  // A second branch at the same tip whose name only case tells apart is a
  // real ref, and stays a base.
  execFileSync("git", ["pack-refs", "--all"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["update-ref", "refs/heads/Feat", "HEAD"], { cwd: dir, stdio: "pipe" });
  assert.equal((await check(dir, { baseRef: "refs/heads/Feat" })).mode, "compare");
});

test("the branch's own name in another Unicode form is refused where the filesystem folds it", async (t) => {
  const nfc = "caf\u00e9";
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", nfc);
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });
  facts(dir, { sha: sha(dir, "main") });
  const nfd = nfc.normalize("NFD");
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", nfd.toUpperCase()], { cwd: dir, stdio: "pipe" });
  } catch {
    return t.skip("this filesystem tells the two spellings apart");
  }

  for (const name of [nfd, nfd.toUpperCase()]) {
    await assert.rejects(() => check(dir, { baseRef: name }), /names this branch's own tip/);
  }
});

test("a base name a tag and a branch both hold is refused, naming both", async (t) => {
  // git picks the tag and warns, and the warning never reached the report: one
  // pick compared against the wrong commit in silence, the other blamed the
  // branch's own tip for a tag git chose.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "feat");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    git("tag", "amb", "main");
    git("branch", "amb", "feat");
    git("branch", "amb2", "main");
    git("tag", "amb2", "feat");
  });
  facts(dir, { sha: sha(dir, "main") });

  for (const name of ["amb", "amb2"]) {
    await assert.rejects(
      () => check(dir, { baseRef: name }),
      (err) => {
        assert.match(err.message, new RegExp(`--base ${name} is ambiguous`), err.message);
        assert.ok(err.message.includes(`refs/heads/${name}`) && err.message.includes(`refs/tags/${name}`), err.message);
        return true;
      },
      name
    );
  }
  // The spelled-out name is one ref and stays a base.
  assert.equal((await check(dir, { baseRef: "refs/heads/amb2" })).base.sha, sha(dir, "main"));
});

test("a companion moved out of the corpus in the tree no longer satisfies the obligation", async (t) => {
  // The rows were filtered by the corpus before their old paths were read, so
  // a move to a name the corpus does not count took the old path with it:
  // committed, the missing spec was reported, and uncommitted it was not.
  const dir = pairedModels(t, ({ git }) => git("mv", "spec/models/thing_spec.rb", "spec/models/thing_spec.rb.bak"));

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(r, "model_spec").map((f) => f.path), ["app/models/thing.rb"]);
});

test("a test renamed within its own directory arrives nowhere new", needsRuby, async (t) => {
  // The rename counted as the file arriving, and the directory's only test was
  // the one that moved, so the directory read as holding none.
  const dir = await railsish(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/admin_mailer_spec.rb"), "RSpec.describe Admin do\nend\n");
  git("add", "-A");
  git("commit", "-qm", "first spec");
  const base = sha(dir);

  git("mv", "spec/mailers/admin_mailer_spec.rb", "spec/mailers/admins_mailer_spec.rb");
  git("commit", "-qm", "rename");

  assert.deepEqual(forKey(await check(dir, { baseRef: base }), "test_precedent"), []);
});

test("the base named is the ref's own tip, and the fork point is the merge base beside it", async (t) => {
  // On a full clone `sha` was the fork point and on a shallow fetch it was the
  // remote tip, so the header's `base main (3a5340c)` named a commit that was
  // not main whenever main had moved on.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    git("checkout", "-q", "main");
    write("src/b.ts", clean(1));
    commit("main moves on");
    git("checkout", "-q", "work");
  });
  const fork = sha(dir, "main~1");
  facts(dir, { sha: fork });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.base.sha, sha(dir, "main"));
  assert.equal(r.base.mergeBase, fork);
  assert.equal(r.staleReason, null);
  assert.match(formatReport(r), new RegExp(`base main \\(${sha(dir, "main").slice(0, 7)}\\)`));
});

test("a submodule whose path looks like source is not read as a file", async (t) => {
  // A gitlink has no blob at HEAD, so `src/lib/sub.ts` was reported as a file
  // this run could not read.
  const dir = repo(t, ({ dir: root, git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("update-index", "--add", "--cacheinfo", `160000,${sha(root)},src/lib/sub.ts`);
    git("commit", "-qm", "a submodule");
    // Where a clone leaves a submodule nobody initialised: an empty directory.
    // Missing altogether, the path reads as deleted in the tree and never
    // reaches the read.
    mkdirSync(join(root, "src/lib/sub.ts"), { recursive: true });
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.equal(r.mode, "compare");
  assert.deepEqual(notes(r).filter((n) => n.includes("sub.ts")), [], JSON.stringify(notes(r)));
  assert.ok(!r.examined.some((c) => c.path === "src/lib/sub.ts"));
});

test("a branch past the configured rename limit still reads its moves as moves", async (t) => {
  // Past `diff.renameLimit` git skips inexact rename detection and lists each
  // move as a deletion and an addition, and every site that came with the file
  // was charged to whoever moved it.
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", swallow(3) + "// a\n");
    write("src/b.ts", swallow(3) + "// b\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    git("config", "diff.renameLimit", "1");
    git("mv", "src/a.ts", "src/x.ts");
    git("mv", "src/b.ts", "src/y.ts");
    write("src/x.ts", swallow(3) + "// a, moved\n");
    write("src/y.ts", swallow(3) + "// b, moved\n");
    commit("move both");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((c) => [c.path, c.from]), [["src/x.ts", "src/a.ts"], ["src/y.ts", "src/b.ts"]]);
  assert.deepEqual(forKey(r, "swallowed_error"), []);
});

test("rename detection git skipped past the limit this run set is said, not charged silently", () => {
  const rows = (adds, dels) => [
    ...Array.from({ length: adds }, (_, i) => ({ status: "A", path: `n${i}.ts`, from: null })),
    ...Array.from({ length: dels }, (_, i) => ({ status: "D", path: `o${i}.ts`, from: `o${i}.ts` })),
    { status: "R", path: "r.ts", from: "q.ts" },
  ];
  assert.equal(renamesSkipped(rows(2, 2), 1), true);
  assert.equal(renamesSkipped(rows(1, 1), 1), false);
  assert.equal(renamesSkipped(rows(5, 0), 1), false, "nothing deleted is nothing to pair");
});

/* --- the reads after base resolution run side by side, and ask once --- */

/**
 * The git calls one check makes, through a shim on this process's own PATH,
 * since the check takes no environment. `fail` names the argument text that
 * makes the shim exit 128 instead of running git.
 */
async function checkThroughShim(t, dir, { fail = null } = {}) {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-check-bin-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, "calls");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  const refuse = fail === null ? "" : `case "$*" in *'${fail}'*) exit 128;; esac\n`;
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> '${log}'\n${refuse}exec '${real}' "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const report = await check(dir, { baseRef: "main" });
    return { report, calls: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    process.env.PATH = path;
  }
}

function pendingRubyDeletion(t) {
  return repo(t, ({ dir, git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    write("app/models/user.rb", "class User\nend\n");
    commit("init");
    // Pinned where the branch forks, so the baseline's reads are asked too.
    facts(dir, { sha: sha(dir), pinned: ["src/a.ts"] });
    git("checkout", "-q", "-b", "feature");
    write("src/a.ts", "export const a = 2\n");
    commit("edit");
    // A pending deletion of a Ruby file asks both readers of HEAD's tree: the
    // one that keeps only deletions HEAD holds, and the obligations.
    rmSync(join(git("rev-parse", "--show-toplevel").toString().trim(), "app/models/user.rb"));
  });
}

const namingHead = (calls) => calls.filter((c) => c.split(" ").some((arg) => /^HEAD\b|\.\.HEAD$/.test(arg)));

test("a check resolves HEAD once and lists HEAD's tree once", needsShebang, async (t) => {
  const dir = pendingRubyDeletion(t);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

  const { report, calls } = await checkThroughShim(t, dir);

  assert.deepEqual(report.removed, ["app/models/user.rb"], "the fixture reached the pending deletion");
  assert.notEqual(report.drift, null, "the fixture reached the baseline");
  // Every other read is handed HEAD's sha.
  assert.deepEqual(namingHead(calls), ["rev-parse --verify --quiet HEAD^{commit}"], calls.join("\n"));
  assert.equal(calls.filter((c) => c === "rev-parse --verify --quiet main^{commit}").length, 1, "and main once");
  const listing = calls.filter((c) => c.startsWith("ls-tree -r"));
  assert.deepEqual(listing, [`ls-tree -r --name-only -z ${head} --`], calls.join("\n"));
});

test("a merge base that cannot say whether it held a directory states no finding about a test for it", needsShebang, async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    for (const [rel, body] of [...PY_TREE, pyIn("src/bare/old", 9)]) write(rel, body);
    commit("init");
  });
  writeMap(await scan(dir), {});
  const { files } = await collect(dir);
  writePin(dir, buildPin(discover(files), { sha: sha(dir), corpus: files.length }));
  execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir, stdio: "pipe" });
  for (const [rel, body] of [pyIn("src/bare/old", 7), pyTestIn("src/bare/old", 9)]) writeFileSync(join(dir, rel), body);
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-qm", "source and a test"], { cwd: dir, stdio: "pipe" });
  const placement = "ls-tree -z --name-only";

  const answered = await checkThroughShim(t, dir);
  assert.equal(answered.calls.filter((c) => c.startsWith(placement)).length, 1, answered.calls.join("\n"));
  assert.deepEqual(forKey(answered.report, "test_precedent").map((f) => f.path), ["src/bare/old/test_m9.py"]);

  // Silent the way an index that cannot be listed is: the fact that decides the finding was not read (C33).
  const unanswered = (await checkThroughShim(t, dir, { fail: placement })).report;
  assert.deepEqual(forKey(unanswered, "test_precedent"), []);
  assert.deepEqual(unanswered.caveats, answered.report.caveats);
});

test("a change that puts no source under a directory asks the merge base nothing about it", needsShebang, async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    for (const [rel, body] of PY_TREE) write(rel, body);
    commit("init");
  });
  writeMap(await scan(dir), {});
  const { files } = await collect(dir);
  writePin(dir, buildPin(discover(files), { sha: sha(dir), corpus: files.length }));
  execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src/bare/fresh"));
  writeFileSync(join(dir, "src/bare/fresh/test_m0.py"), PY_TEST);
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-qm", "a test alone"], { cwd: dir, stdio: "pipe" });

  const { report, calls } = await checkThroughShim(t, dir);

  assert.deepEqual(calls.filter((c) => c.startsWith("ls-tree -z")), []);
  assert.deepEqual(forKey(report, "test_precedent").map((f) => f.path), ["src/bare/fresh/test_m0.py"]);
});

test("each read that runs beside the others still reports its own failure", needsShebang, async (t) => {
  // F15: reading the diff, the pending edits and the rest at once must not
  // let one failure stand for another, or go unsaid.
  const dir = pendingRubyDeletion(t);
  const said = (report, code) => report.caveats.filter((c) => c.code === code).map((c) => c.message);

  const noStatus = (await checkThroughShim(t, dir, { fail: " status " })).report;
  assert.deepEqual(said(noStatus, CAVEATS.PENDING_UNLISTED), [
    "the working tree's pending edits could not be listed, so only committed content was read",
  ]);
  assert.deepEqual(said(noStatus, CAVEATS.DIFF_UNREADABLE), []);
  assert.deepEqual(noStatus.examined.map((c) => c.path), ["src/a.ts"], "the diff still answered");

  const noDiff = (await checkThroughShim(t, dir, { fail: "--name-status" })).report;
  assert.deepEqual(said(noDiff, CAVEATS.DIFF_UNREADABLE), [
    "the diff against main could not be read, so no file was examined and this run found nothing it could look at",
  ]);
  assert.deepEqual(said(noDiff, CAVEATS.PENDING_UNLISTED), []);
  assert.deepEqual(noDiff.removed, ["app/models/user.rb"], "the pending edits still answered");
});

test("with no merge base, the added lines and the oldest commit are read at HEAD's sha too", needsShebang, async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("init");
    git("checkout", "-q", "--orphan", "feature");
    write("src/a.ts", "export const a = 2\n");
    commit("unrelated");
    write("src/b.ts", "export const b = 1\n");
    commit("second");
  });

  const { report, calls } = await checkThroughShim(t, dir);

  assert.equal(report.mode, "added-lines");
  assert.ok(calls.some((c) => c.startsWith("rev-list --max-parents=0 ")), calls.join("\n"));
  assert.ok(calls.some((c) => c.includes("--unified=0")), "the added ranges were read");
  assert.deepEqual(namingHead(calls), ["rev-parse --verify --quiet HEAD^{commit}"], calls.join("\n"));
});

/* --- a changed component is read the way a changed module is --- */

const COMPONENT_NAMES = ["UserCard", "OrderList", "DataTable", "FormInput", "NavBar", "ErrorPage", "BigTable", "SidePanel"];

const componentArea = (dimensions, ext = "vue") => [{
  id: "aaaaaaaa",
  path: "src/components",
  globs: [{ negated: false, dir: "src/components", tail: `**/*.${ext}` }],
  fileCount: 8,
  dimensions,
}];

const vueComponent = (script) => `<template>\n  <div />\n</template>\n\n<script setup>\n${script}</script>\n`;

test("a component named against the others is a finding at the file", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    for (const name of COMPONENT_NAMES) write(`src/components/${name}.vue`, vueComponent("const a = 1;\n"));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/components/user_card.vue", vueComponent("const a = 1;\n"));
    write("src/components/PlainBanner.vue", "<template>\n  <p>hello</p>\n</template>\n");
    write("src/components/plain_footer.vue", "<template>\n  <p>bye</p>\n</template>\n");
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: componentArea([dim({ key: "file_naming_case", learned: "PascalCase", learnedKind: "component" })]),
  });

  const report = await check(dir);

  assertExamined(report, "src/components/user_card.vue");
  const found = forKey(report, "file_naming_case");
  assert.deepEqual(found.map((f) => [f.path, f.line]), [
    ["src/components/plain_footer.vue", 1],
    ["src/components/user_card.vue", 1],
  ], "a component of markup alone is named like any other");
  assert.equal(found[0].claim, "files here are named PascalCase");
  assert.equal(found[1].severity, "MUST-FIX");
});

test("a component is not judged by the filename class the modules beside it learned", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/components/format-date.ts", "export const a = 1;\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/components/UserCard.vue", vueComponent("const a = 1;\n"));
    commit("add");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: componentArea([dim({ key: "file_naming_case", learned: "kebab-case", learnedKind: "module" })]),
  });

  const report = await check(dir);

  assertExamined(report, "src/components/UserCard.vue");
  assert.deepEqual(forKey(report, "file_naming_case"), []);
});

for (const [ext, open] of [["vue", "<script setup>"], ["svelte", "<script>"]]) {
  test(`a swallowed error added to a .${ext} script is reported at the file's own line`, async (t) => {
    // CRLF throughout and markup above the block: the line is the file's, not the script's.
    const component = (body) =>
      ["<!-- card -->", "<div>", "  <span>one</span>", "</div>", "", open, 'import { load } from "./load";', "", "function first() {", "  return load(1);", "}", "", ...body, "</script>", ""].join("\r\n");
    const dir = repo(t, ({ git, write, commit }) => {
      write(`src/components/Card.${ext}`, component(["function second() {", "  return load(2);", "}"]));
      commit("init");
      git("checkout", "-q", "-b", "work");
      write(`src/components/Card.${ext}`, component(["function second() {", "  try { load(2) } catch (e) { }", "}"]));
      commit("swallow");
    });
    facts(dir, { sha: sha(dir, "main"), areas: componentArea([dim()], ext) });

    const report = await check(dir);

    assertExamined(report, `src/components/Card.${ext}`);
    const found = forKey(report, "swallowed_error");
    assert.deepEqual(found.map((f) => [f.path, f.line, f.severity]), [[`src/components/Card.${ext}`, 14, "MUST-FIX"]]);
    assert.equal(found[0].where, "second");
  });
}

test("a component whose script the parser rejects is named unchecked, in a module's own words", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/components/UserCard.vue", vueComponent("const a = 1;\n"));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/components/broken.ts", "export const = ;\n");
    write("src/components/Broken.vue", vueComponent("const = ;\n"));
    write("src/components/Open.svelte", "<script>\n  let a = 1;\n\n<p>never closed</p>\n");
    commit("broken");
  });
  facts(dir, { sha: sha(dir, "main"), areas: componentArea([dim()]) });

  const report = await check(dir);

  assert.deepEqual(notes(report).sort(), [
    "src/components/Broken.vue holds syntax the parser rejected, so it was not checked",
    "src/components/Open.svelte holds syntax the parser rejected, so it was not checked",
    "src/components/broken.ts holds syntax the parser rejected, so it was not checked",
  ]);
  assert.deepEqual([...new Set(report.caveats.map((c) => c.code))], [CAVEATS.HEAD_REJECTED]);
  assert.deepEqual(report.findings, []);
});

test("an edit to a component's markup alone is read and reports nothing", async (t) => {
  const script = "function go() {\n  try { run() } catch (e) { }\n}\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/components/UserCard.vue", `<template>\n  <div />\n</template>\n\n<script setup>\n${script}</script>\n`);
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/components/UserCard.vue", `<template>\n  <div>\n    <p>more</p>\n  </div>\n</template>\n\n<script setup>\n${script}</script>\n`);
    commit("markup");
  });
  facts(dir, { sha: sha(dir, "main"), areas: componentArea([dim()]) });

  const report = await check(dir);

  // The swallowed error predates the branch and moved two lines down with the markup.
  assertExamined(report, "src/components/UserCard.vue");
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.caveats, []);
});

test("a C# file read with one branch of each conditional says so, and one read whole says nothing", async (t) => {
  const whole = (name) => `class ${name}\n{\n    public void F(string s)\n    {\n    }\n}\n`;
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/A.cs", whole("A"));
    write("src/B.cs", whole("B"));
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("src/A.cs", "class A\n{\n#if SPAN\n    public void F(System.ReadOnlySpan<char> s)\n#else\n    public void F(string s)\n#endif\n    {\n    }\n}\n");
    write("src/B.cs", whole("B").replace("string s", "int n"));
    commit("a signature per target");
  });
  facts(dir, { sha: sha(dir, "main") });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.examined.map((e) => e.path).sort(), ["src/A.cs", "src/B.cs"]);
  // The findings on such a file are about the branch that was read, and a reader has to be told the rest was not.
  assert.deepEqual(r.caveats.filter((c) => c.code === CAVEATS.HEAD_ONE_BRANCH), [
    { code: "head-one-branch", message: "src/A.cs was read with one branch of each #if, so its other branches were not checked" },
  ]);
});

const perTarget = (signature) => `class A\n{\n    /// <summary>Loads.</summary>\n${signature}\n    {\n    }\n}\n`;
const SPLIT = "#if NET8_0\n    public void Load(string path, int extra)\n#else\n    public void Load(string path)\n#endif";

test("a C# file read with one branch is judged on the text its tree was read from, as the scan judged it", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/components/A.cs", perTarget("    public void Load(string path)"));
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("src/components/A.cs", perTarget(SPLIT));
    commit("a signature per target");
  });
  facts(dir, { sha: sha(dir, "main"), areas: componentArea([dim({ key: "public_doc_comment", precision: "partial" })], "cs") });

  const scanned = await parseTreeFile(perTarget(SPLIT), "src/components/A.cs", "csharp");
  assert.equal(scanned.oneBranch, true);
  assert.deepEqual(scanned.hits.public_doc_comment, [{ conforming: true, where: "A.Load" }]);

  const report = await check(dir, { baseRef: "main" });

  // The doc comment sits above the #if. In the file as written that line is in the gap, and in the text the tree was read from it is blank.
  assert.deepEqual(report.examined.map((e) => e.path), ["src/components/A.cs"]);
  assert.deepEqual(report.caveats.map((c) => c.code), [CAVEATS.HEAD_ONE_BRANCH]);
  assert.deepEqual(forKey(report, "public_doc_comment"), []);
});

test("the base side of such a file is read from its own tree's text too, so what it already held is not charged to the branch", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/components/A.cs", perTarget(SPLIT));
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("src/components/A.cs", perTarget(SPLIT).replace("    {\n    }", "    {\n        Run();\n    }"));
    commit("a body");
  });
  const undocumented = counterDim({ key: "public_doc_comment", precision: "partial", claim: "public functions carry a doc comment", counterClaim: "public functions carry no doc comment" });
  facts(dir, { sha: sha(dir, "main"), areas: componentArea([undocumented], "cs") });

  const report = await check(dir, { baseRef: "main" });

  // Where the area documents nothing, the documented function is the one that breaks, and it was there before the branch.
  assert.deepEqual(report.examined.map((e) => e.path), ["src/components/A.cs"]);
  assert.deepEqual(report.caveats.map((c) => c.code), [CAVEATS.HEAD_ONE_BRANCH]);
  assert.deepEqual(forKey(report, "public_doc_comment"), []);
});

test("a test file pytest collects by its directory is a test file to the check on both sides, as it is to the scan", async (t) => {
  // No runner is imported and the name is not a test's: only the path says pytest collects this.
  const cases = "def test_total():\n    assert 1 == 1\n";
  const helper = "\n\ndef build_order():\n    return 1\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("tests/tests.py", cases + helper);
    write("tests/more.py", cases);
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("tests/tests.py", cases + helper.replace("return 1", "return 2"));
    write("tests/more.py", cases + helper);
    commit("a helper");
  });
  const documented = dim({ key: "public_doc_comment", precision: "partial" });
  facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: "tests", globs: [{ negated: false, dir: "tests", tail: "**/*.py" }], fileCount: 8, dimensions: [documented] }] });

  assert.deepEqual((await parseTreeFile(cases + helper, "tests/more.py", "python")).hits.public_doc_comment, undefined, "the scan counts nothing here");

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(report.examined.map((e) => e.path).sort(), ["tests/more.py", "tests/tests.py"]);
  assert.deepEqual(report.caveats, []);
  assert.deepEqual(report.findings, []);
});

for (const [lang, rel, glob, old, added, line, where] of [
  ["Python", "src/py/views.py", "**/*.py", "class A:\n    def run(self):\n        return 1\n", "class B:\n    def run(self):\n        return 2\n\n\n", 2, "B.run"],
  ["Java", "src/java/Views.java", "**/*.java", "class A {\n    public void run() {}\n}\n", "class B {\n    public void run() {}\n}\n\n", 2, "B.run"],
  ["Go", "src/go/views.go", "**/*.go", "package views\n\nfunc (a A) Run() {}\n", "package views\n\nfunc (b B) Run() {}\n", 3, "B.Run"],
  ["Rust", "src/rs/views.rs", "**/*.rs", "struct A;\n\nimpl A {\n    pub fn run(&self) {}\n}\n", "struct B;\n\nimpl B {\n    pub fn run(&self) {}\n}\n\n", 4, "B.run"],
  // An extension function is written on a type and inside no class.
  ["Kotlin", "src/kt/Mappers.kt", "**/*.kt", "fun User.toDto(): UserDto {\n    return UserDto(name)\n}\n", "fun Invoice.toDto(): InvoiceDto {\n    return InvoiceDto(total)\n}\n\n", 1, "Invoice.toDto"],
  // Written inside a class, it is that class's, and the receiver as written tells two of one type's name apart.
  ["Kotlin, inside a class", "src/kt/Mappers.kt", "**/*.kt", "class A {\n    fun User.show(): String {\n        return name\n    }\n}\n", "package shop\n\nclass B {\n    fun User.show(): String {\n        return name\n    }\n}\n\n", 4, "B.User.show"],
  ["Kotlin, a type argument", "src/kt/Mappers.kt", "**/*.kt", "fun List<User>.toDtos(): Int {\n    return size\n}\n", "fun List<Invoice>.toDtos(): Int {\n    return size\n}\n\n", 1, "List<Invoice>.toDtos"],
  ["Kotlin, a nullable receiver", "src/kt/Mappers.kt", "**/*.kt", "fun User.label(): String {\n    return name\n}\n", "fun User?.label(): String {\n    return \"\"\n}\n\n", 1, "User?.label"],
  ["Kotlin, a function type", "src/kt/Mappers.kt", "**/*.kt", "fun (() -> Int).twice(): Int {\n    return this() + this()\n}\n", "fun ((Int) -> Int).twice(): Int {\n    return 0\n}\n\n", 1, "((Int) -> Int).twice"],
  ["Kotlin, a qualified receiver", "src/kt/Mappers.kt", "**/*.kt", "fun java.util.Date.iso(): String {\n    return toString()\n}\n", "fun java.sql.Date.iso(): String {\n    return toString()\n}\n\n", 1, "java.sql.Date.iso"],
]) {
  test(`${lang}: a method written above an old one of its name, in another class, is reported on the line the branch wrote`, async (t) => {
    const dir = repo(t, ({ git, write, commit }) => {
      write(rel, old);
      commit("base");
      git("checkout", "-q", "-b", "work");
      // Go's package clause stays the file's first line.
      write(rel, lang === "Go" ? `${added}\n${old.replace("package views\n\n", "")}` : added + old);
      commit("a second class");
    });
    const documented = dim({ key: "public_doc_comment", precision: "partial" });
    const at = dirname(rel);
    facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: at, globs: [{ negated: false, dir: at, tail: glob }], fileCount: 8, dimensions: [documented] }] });

    const report = await check(dir, { baseRef: "main" });

    assert.deepEqual(report.caveats, []);
    assert.deepEqual(forKey(report, "public_doc_comment").map((f) => [f.line, f.where]), [[line, where]]);
  });
}

test("a handler written above an old one of its text, in a method of the same name in another class, is reported on the line the branch wrote", async (t) => {
  const cls = (name) => `class ${name} {\n    void run() {\n        try { go(); } catch (E e) { }\n    }\n}\n`;
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/java/Views.java", cls("A"));
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("src/java/Views.java", `${cls("B")}\n${cls("A")}`);
    commit("a second class");
  });
  facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: "src/java", globs: [{ negated: false, dir: "src/java", tail: "**/*.java" }], fileCount: 8, dimensions: [dim({ key: "caught_error_used", precision: "partial" })] }] });

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(forKey(report, "caught_error_used").map((f) => [f.line, f.where]), [[3, "B.run"]]);
});

test("a file renamed from a name that is no source into a language is new, and every site in it with it", async (t) => {
  const python = "def legacy(request):\n    return 1\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(1));
    write("src/notes.txt", swallow(1));
    write("src/py/a.py", 'def a():\n    """A."""\n');
    write("src/py/notes.txt", python);
    // The control: a source file renamed with nothing changed brings no site the base did not hold.
    write("src/old.ts", swallow(2));
    commit("base");
    git("checkout", "-q", "-b", "work");
    git("mv", "src/notes.txt", "src/notes.ts");
    git("mv", "src/py/notes.txt", "src/py/notes.py");
    git("mv", "src/old.ts", "src/moved.ts");
    commit("renamed, nothing edited");
  });
  facts(dir, {
    sha: sha(dir, "main"),
    areas: [
      { id: "aaaaaaaa", path: "src", globs: [glob("src")], fileCount: 8, dimensions: [dim()] },
      { id: "bbbbbbbb", path: "src/py", globs: [{ negated: false, dir: "src/py", tail: "**/*.py" }], fileCount: 8, dimensions: [dim({ key: "public_doc_comment", precision: "partial" })] },
    ],
  });

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(report.caveats, []);
  assert.deepEqual(report.examined.map((e) => e.path).sort(), ["src/moved.ts", "src/notes.ts", "src/py/notes.py"]);
  assert.deepEqual(report.findings.map((f) => [f.path, f.line, f.dimension]), [
    ["src/notes.ts", 1, "swallowed_error"],
    ["src/py/notes.py", 1, "public_doc_comment"],
  ]);
});

test("a Rust file cargo builds as a test by where it sits is a test file to the check, a case in it or none", async (t) => {
  const helper = "pub fn setup() {}\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("Cargo.toml", '[package]\nname = "shop"\n');
    write("tests/util.rs", helper);
    // The same file where no crate holds the directory, which is source.
    write("notes/tests/util.rs", helper);
    commit("base");
    git("checkout", "-q", "-b", "work");
    for (const at of ["tests", "notes/tests"]) write(`${at}/util.rs`, `${helper}\npub fn teardown() {}\n`);
    commit("one more helper");
  });
  const documented = dim({ key: "public_doc_comment", precision: "partial" });
  const area = (id, path) => ({ id, path, globs: [{ negated: false, dir: path, tail: "**/*.rs" }], fileCount: 8, dimensions: [documented] });
  facts(dir, { sha: sha(dir, "main"), areas: [area("aaaaaaaa", "tests"), area("bbbbbbbb", "notes/tests")] });

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(report.examined.map((e) => e.path).sort(), ["notes/tests/util.rs", "tests/util.rs"]);
  assert.deepEqual(report.caveats, []);
  assert.deepEqual(forKey(report, "public_doc_comment").map((f) => [f.path, f.line]), [["notes/tests/util.rs", 3]]);
});

for (const [side, facts_, reported] of [
  ["no return type", () => counterDim({ key: "declared_return_type", claim: "functions declare what they return", counterClaim: "functions declare no return type" }), "typed"],
  ["a return type", () => dim({ key: "declared_return_type" }), "untyped"],
]) {
  test(`where an area's functions declare ${side}, a new function written the other way is the finding and one written that way is none`, async (t) => {
    const dir = repo(t, ({ git, write, commit }) => {
      write("src/py/a.py", "def a():\n    return 1\n");
      commit("base");
      git("checkout", "-q", "-b", "work");
      write("src/py/a.py", "def a():\n    return 1\n\n\ndef typed() -> int:\n    return 1\n\n\ndef untyped():\n    return 1\n");
      commit("two functions");
    });
    facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: "src/py", globs: [{ negated: false, dir: "src/py", tail: "**/*.py" }], fileCount: 8, dimensions: [facts_()] }] });

    const report = await check(dir, { baseRef: "main" });

    assert.deepEqual(forKey(report, "declared_return_type").map((f) => [f.line, f.claim]), [
      reported === "typed" ? [5, "functions declare no return type"] : [9, "functions declare what they return"],
    ]);
  });
}

test("a file renamed out of a test tree is not charged the sites it already held", async (t) => {
  // Under tests/ pytest collects it and the row counts nothing in it; under src/ it is source. Nothing in it changed.
  const source = "def test_data():\n    assert 1 == 1\n\n\ndef load_tools(path):\n    return path\n\n\ndef save_tools(path):\n    return path\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("tests/tools.py", source);
    write("src/py/a.py", "def a():\n    \"\"\"A.\"\"\"\n");
    commit("base");
    git("checkout", "-q", "-b", "work");
    git("mv", "tests/tools.py", "src/py/tools.py");
    commit("move it");
  });
  const documented = dim({ key: "public_doc_comment", precision: "partial" });
  facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: "src/py", globs: [{ negated: false, dir: "src/py", tail: "**/*.py" }], fileCount: 8, dimensions: [documented] }] });

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(report.examined.map((e) => e.path), ["src/py/tools.py"]);
  assert.deepEqual(report.findings, []);
});

test("a file that stops being a test file by what it holds is not charged the sites it already held", async (t) => {
  const source = "import pytest\n\n\ndef load_tools(path):\n    return path\n\n\ndef test_data():\n    assert 1 == 1\n";
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/py/tools.py", source);
    commit("base");
    git("checkout", "-q", "-b", "work");
    write("src/py/tools.py", source.replace("import pytest\n\n\n", "").replace("def test_data():\n    assert 1 == 1\n", "def data():\n    \"\"\"Data.\"\"\"\n"));
    commit("no longer a test");
  });
  const documented = dim({ key: "public_doc_comment", precision: "partial" });
  facts(dir, { sha: sha(dir, "main"), areas: [{ id: "aaaaaaaa", path: "src/py", globs: [{ negated: false, dir: "src/py", tail: "**/*.py" }], fileCount: 8, dimensions: [documented] }] });

  const report = await check(dir, { baseRef: "main" });

  assert.deepEqual(report.examined.map((e) => e.path), ["src/py/tools.py"]);
  assert.deepEqual(forKey(report, "public_doc_comment").map((f) => f.line), []);
});
