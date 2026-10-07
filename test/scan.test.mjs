import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths, needsSymlinks } from "./platform.mjs";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

import { scan } from "../plugins/anatomiya/lib/scan.mjs";
import { renderArea, renderOverview } from "../plugins/anatomiya/lib/render.mjs";
import { planMap, writeMap } from "../plugins/anatomiya/lib/write.mjs";
import { TARGETS } from "../plugins/anatomiya/lib/targets.mjs";
import { factsJson } from "../plugins/anatomiya/lib/facts.mjs";
import { scanLines, scanSummary } from "../plugins/anatomiya/lib/summary.mjs";
import { globsReach } from "../plugins/anatomiya/lib/areas.mjs";
import { PIN_PATH, PIN_SCHEMA, resolve as resolveBaseline } from "../plugins/anatomiya/lib/baseline.mjs";
import { parseAll } from "../plugins/anatomiya/lib/parse.mjs";
import { RUBY_GUARDS } from "../plugins/anatomiya/lib/ruby.mjs";
import { defaultPoolSize } from "../plugins/anatomiya/lib/pool.mjs";
import { checkerBlocked, loadTypeScript } from "../plugins/anatomiya/lib/semantic.mjs";
import { needsRuby } from "./ruby-available.mjs";

// The directory is removed through the test context, so a failing assertion
// still cleans up instead of leaving a repository in the temporary directory.
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-scan-"));
  // Retried because a scan's history read can still hold the directory open on Windows.
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  build(dir, { git, write, author, pin });
  return dir;

  function write(rel, body = "export const x = 1\n") {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  function author(email) {
    git("config", "user.email", email);
    git("config", "user.name", email.split("@")[0]);
  }
  /** Accept a baseline: the pinned file list per area, at the given commit. */
  function pin(areas, sha = git("rev-parse", "HEAD").trim()) {
    const body = { schema: PIN_SCHEMA, sha, areas };
    const abs = join(dir, PIN_PATH);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(body, null, 2) + "\n");
    return sha;
  }
}

/** Module-level bindings, which is what the module_state_const dimension counts. */
function moduleSource(i, kind = "const") {
  return `const first${i} = 1\n${kind} second${i} = 2\nexport { first${i}, second${i} }\n`;
}

function dimension(result, path, key) {
  const area = result.areas.find((a) => a.path === path);
  assert.ok(area, `area ${path} exists`);
  const dim = area.dimensions.find((d) => d.key === key);
  assert.ok(dim, `${path} counts ${key}`);
  return dim;
}

/** Everything a second scan of unchanged source must reproduce exactly. */
function stable(result) {
  return {
    corpus: result.corpus,
    parse: result.parse,
    suppressAll: result.suppressAll,
    baseline: result.baseline,
    areas: result.areas.map((a) => ({
      id: a.id,
      path: a.path,
      glob: a.glob,
      fileCount: a.fileCount,
      baseline: a.baseline,
      dimensions: a.dimensions.map((d) => ({
        key: d.key,
        applicability: d.applicability,
        candidates: d.candidates,
        conforming: d.conforming,
        authors: d.authors,
        ratio: d.ratio,
        directive: d.directive,
        gate: d.gate,
        files: d.files,
        exceptions: d.exceptions,
        baseline: d.baseline,
      })),
    })),
  };
}

test("a scan that fails while the checker runs beside it stops the checker", async (t) => {
  if (defaultPoolSize() === 1) return t.skip("with no spare core the checker waits for the parse");
  if (!(await loadTypeScript())) return t.skip("typescript is not installed");
  const dir = repo(t, (d, { git, write }) => {
    write("tsconfig.json", "{}\n");
    write("src/a.ts");
    git("add", ".");
    git("commit", "-qm", "init");
    write("node_modules/dep/index.js", "\n");
  });
  assert.equal(await checkerBlocked(dir, { checkedRels: ["src/a.ts"] }), null, "the fixture has to open the checker's gate");
  const signals = [];
  const fakeChecker = (root, files, { signal }) => {
    signals.push(signal);
    return new Promise((done) => signal.addEventListener("abort", () => done({ records: new Map(), error: "stopped" })));
  };

  await assert.rejects(scan(dir, { guards: { nope: {} }, runChecker: fakeChecker }), /nope/);
  // Either the checker started before the parse failed or its gate is still
  // settling; give the gate the time it takes to reach the checker.
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  assert.ok(signals.every((s) => s.aborted), "a checker the failed scan started was left to run out its clock");
});

test("a scan that counted tracked source never also counts untracked source", async (t) => {
  // The overview's head lines for the two states say opposite things: one says
  // nothing was counted, the other says the counts were cut short. The bound
  // has room for one of them, and `render.test.mjs` holds the roster over the
  // reachable half on the strength of this.
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.js", "export const a = 1;\n");
    write("src/b.js", "export const b = 2;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    write("src/loose.js", "export const c = 3;\n");
  });

  const result = await scan(dir);

  assert.ok(result.corpus.files > 0, "the corpus holds the tracked files");
  assert.equal(result.corpus.untracked, 0, "so the untracked count is not asked for");
});

test("a scan that found no tracked source is never also a truncated scan", async (t) => {
  // The other half of the same pair. Both head lines together is the shape the
  // roster has no room for, so each direction is held rather than assumed.
  const dir = repo(t, (d, { git, write }) => {
    write("README.md", "# hi\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    write("src/loose.js", "export const c = 3;\n");
  });

  const result = await scan(dir);

  assert.ok(result.corpus.untracked > 0, "the untracked source is counted");
  assert.equal(result.corpus.truncated, false);
  assert.equal(result.suppressAll, false, "so no truncation line joins the untracked one");
});

test("a repository with no source files produces no areas", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("README.md", "# hi\n");
    write("docs/design.md", "# design\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 0);
  assert.deepEqual(result.areas, []);
  assert.deepEqual(result.parse, {
    parsed: 0,
    crashed: 0,
    skipped: 0,
    // A file that answers `ok: false` is charged here rather than counted as
    // parsed, which is what made a repository nothing could read look empty.
    failed: 0,
    syntaxErrors: 0,
    missingParser: null,
    missingStripper: false,
    // No file routed to an engine, so none ran: an engine that never started
    // reports no version, and none of them is missing either.
    engines: {},
    missingEngines: [],
    // No language is unreadable when the corpus holds none: an empty repository
    // is answered, not blindly skipped, and a scan of it may still clean up.
    unreadable: [],
  });

  // The overview still renders, because an empty repository is a real answer.
  assert.match(renderOverview(result, { uncovered: 0 }), /^## Areas \(0\)$/m);
});

test("a repository with no history produces no authors and still scans", async (t) => {
  // `git ls-files` sees the index, `git log` has nothing to read. The author
  // gate handles the gap; it is not an error that should lose the scan.
  // Twenty files, not six: `moduleSource` yields two sites each, and the
  // evidence gate refuses a perfect record under 35 sites before the author
  // gate is ever consulted. This test is about the author gate.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 20);
  assert.equal(result.areas.length, 1);
  const dims = result.areas[0].dimensions;
  assert.ok(dims.length > 0, "counts are still produced");
  for (const d of dims) {
    assert.equal(d.authors, 0);
    assert.equal(d.directive, false);
    assert.equal(d.gate, "authors", "D4: nobody's convention is not a convention");
  }
});

test("scanning a directory outside any repository fails loudly", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-scan-nogit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(() => scan(dir), /not a git repository/);
});

test("a file that kills the parser costs that one file", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    // Deep nesting is what was measured taking oxc down with an uncatchable
    // SIGSEGV from inside parseSync (B2).
    write("src/bomb.ts", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.crashed, 1, "the crash is reported, not swallowed");
  assert.equal(result.parse.parsed, 7, "every file got an answer");
  assert.equal(result.areas.length, 1, "the six healthy files still make an area");

  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.applicability, 6, "the crashed file contributes no sites");
  assert.ok(!dim.files.includes("src/bomb.ts"));
});

test("the scan counts a grammar's unread files apart, and a record of the older languages is the one it was", async (t) => {
  const older = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("src/broken.ts", "export const broken = 5\nfoo(\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const before = (await scan(older)).parse;
  assert.equal(before.syntaxErrors, 1);
  assert.equal("rejections" in before, false, "nothing new on a record no grammar touched");

  const mixed = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("src/broken.ts", "export const broken = 5\nfoo(\n");
    // Correct Kotlin the grammar has no rule for: a member on the line that closes its class.
    write("app/A.kt", "class A { fun f() {} }\n");
    write("app/B.kt", "class B { val x = 1 }\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const after = (await scan(mixed)).parse;
  assert.equal(after.syntaxErrors, 3, "the count of files rejected, whoever rejected them");
  assert.deepEqual(after.rejections, { syntax: 1, grammar: 2 });
});

test("the scan counts the files it read with one branch of their conditionals, and says so under Not covered", async (t) => {
  const member = (i) => `namespace App;\n\npublic class M${i}\n{\n    public int F(int x)\n    {\n        return x + ${i};\n    }\n}\n`;
  const older = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/M${i}.cs`, member(i));
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const before = await scan(older);
  assert.equal("oneBranch" in before.parse, false, "nothing new on the record of a run that read every file whole");
  assert.doesNotMatch(renderOverview(before, { uncovered: 0 }), /one branch/);

  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/M${i}.cs`, member(i));
    write("src/Chain.cs", 'namespace App;\n\npublic class Chain\n{\n    public bool F(string s)\n    {\n        return s\n#if SPAN\n            .Trim()\n#else\n            .TrimEnd()\n#endif\n            .StartsWith("a");\n    }\n}\n');
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const after = await scan(dir);
  assert.equal(after.parse.syntaxErrors, 0);
  assert.equal(after.parse.oneBranch, 1);
  assert.match(renderOverview(after, { uncovered: 0 }), /^- 1 file was read with one branch of each #if; the other branches were not read$/m);
});

test("a file the parser could not read costs that one file", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    // oxc recovers instead of dying, so this file was charged as parsed and its
    // recovery walked as if it were the file. Whatever the recovery leaves is
    // not what anyone wrote, and on react/react 288 files are this shape.
    write("src/broken.ts", "export const broken = 5\nfoo(\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.syntaxErrors, 1, "reported as what it is, not as a file that could not be read");
  assert.equal(result.parse.failed, 0, "a syntax error is not the same as an unreadable file");
  assert.equal(result.parse.parsed, 7, "every file got an answer");

  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.applicability, 6, "the unreadable file contributes no sites");
  assert.ok(!dim.files.includes("src/broken.ts"));
});

test("a directory nothing could be counted in is not a directory that was too small", async (t) => {
  // Discovery put all six in an area; the area was then dropped because no
  // dimension found a site, which is the parse failure and not the floor. The
  // uncovered count folded the two together and named only the floor.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/broken${i}.ts`, `export const a${i} = 1\nfoo(\n`);
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 6);
  assert.equal(result.parse.syntaxErrors, 6, "none of them was read");
  assert.equal(result.areas.length, 0, "so the area they were in states nothing and is dropped");
  assert.equal(result.corpus.orphaned, 0, "and none of them was left without an area by discovery");
});

test("the corpus tallies every file it has no language for, by extension", async (t) => {
  // The overview names an unread language from this field, and it exists
  // because the roster cannot be counted back off for the number: a root prints
  // its top two extensions and folds the rest away, which held 781 of the
  // 1,016 files next.js had in a language this did not read. Pinned here rather than only at the renderer, where a
  // hand-built record would pass whatever the scan actually stored.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 4; i++) write(`src/a${i}.ts`, `export const a${i} = 1\n`);
    for (let i = 0; i < 3; i++) write(`Sources/Core/m${i}.swift`, `func f${i}() -> Int { ${i} }\n`);
    write("Sources/Api/n0.swift", "func g() -> Int { 0 }\n");
    write("README.md", "# hi\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.deepEqual(result.corpus.otherExts, [[".swift", 4], [".md", 1]]);
  assert.equal("scriptOnly" in result.corpus, false, "a repository with no component carries no count of them");
  assert.equal(result.corpus.files, 4, "and the source count is the four it can read");
});

test("a language whose parser could not run at all is named", async (t) => {
  // The condition is "the parser never ran", which is what a missing
  // interpreter looks like: every file charged as a crash. It is not "no file
  // came back ok". A syntax error also fails a file, and treating that as a
  // blind run let one bad file in a one-file language freeze the whole map.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    // Deep nesting takes oxc down with a SIGSEGV, which is a crash, and this is
    // the only .jsx file in the repository.
    write("src/bomb.jsx", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.parse.crashed, 1);
  assert.deepEqual(result.parse.unreadable, ["jsx"], "no jsx file was readable, and the parser never answered");
});

test("a file skipped before the parser ran is no proof the parser answered", async (t) => {
  // An oversize file never reaches the engine, so it says nothing about
  // whether the engine is there. Counted as an answer, one generated bundle
  // beside a missing engine let the scan remove every area of that language.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("src/bomb.jsx", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    write("gen/big.jsx", "export const v = 1\n".repeat(60_000));
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.parse.skipped, 1, "the bundle was skipped for its size");
  assert.deepEqual(result.parse.unreadable, ["jsx"], "and the one jsx file the parser was handed never answered");
});

test("a language every file of which was skipped for its size is not a blind one", async (t) => {
  // The symmetric case: nothing reached the engine, so nothing says it failed.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("gen/big.jsx", "export const v = 1\n".repeat(60_000));
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.parse.skipped, 1);
  assert.deepEqual(result.parse.unreadable, []);
  assert.equal(result.readNothing, false);
});

test("an area holding a file of a language no file of which was read is held, not described", async (t) => {
  // Decided per language (B41): described from the half of its files that
  // answered, the area's file would be written over with claims this run had
  // no way to measure. It is handed to the writer to leave as it is, while a
  // directory of the language that was read is described as usual.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("src/bomb.jsx", "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n");
    for (let i = 0; i < 6; i++) write(`lib/n${i}.ts`, moduleSource(10 + i));
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.deepEqual(result.parse.unreadable, ["jsx"]);
  assert.deepEqual(result.held.map((a) => a.path), ["src"]);
  assert.deepEqual(result.areas.map((a) => a.path), ["lib"], "the directory that was read is still described");
  assert.equal(result.readNothing, false);
});

test("one file with a syntax error is not a language this run went blind on", async (t) => {
  // Measured: six healthy .ts files and one broken .jsx froze the entire map,
  // wrote nothing, and told the reader a interpreter was missing. jsx is its
  // own language, so one file is the whole population of it.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("src/broken.jsx", "export const x = <div>\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.parse.syntaxErrors, 1, "the file is still reported unread");
  assert.deepEqual(result.parse.unreadable, [], "but the parser ran, so this run can still speak");
});

test("a file discovery could not place is counted as orphaned", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) write(`src/deep/m${i}.ts`, moduleSource(i));
    // Two files one level up, below the floor, with no ancestor that clears it.
    write("src/loose.ts", moduleSource(90));
    write("src/other.ts", moduleSource(91));
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.deepEqual(result.areas.map((a) => a.path), ["src/deep"]);
  assert.equal(result.corpus.orphaned, 2, "the two the floor left behind");
});

test("an area's globs stay off the fixture and generated files the corpus left out", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) write(`src/comp/m${i}.ts`, moduleSource(i));
    write("src/comp/fixtures/F.ts", moduleSource(90));
    write("src/comp/Gen.ts", "// Code generated by protoc. DO NOT EDIT.\nexport const g = 1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  const [comp] = result.areas;
  assert.equal(comp.path, "src/comp");
  assert.equal(globsReach(comp.globs, "src/comp/m0.ts"), true);
  assert.equal(globsReach(comp.globs, "src/comp/fixtures/F.ts"), false);
  assert.equal(globsReach(comp.globs, "src/comp/Gen.ts"), false);
});

test("a path with a newline or a leading dash survives the whole scan", needsPosixPaths, async (t) => {
  // F1 and F5 end to end: the corpus is NUL-split, and no repository-controlled
  // path reaches an argument position where git or the parser reads it as an
  // option. A path lost here would silently shrink an area's population.
  const odd = ["src/we\nird.ts", "src/-dash.ts"];
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    // Only these two files carry the second author, so the author count is
    // where a path the log walk dropped would show up.
    author("second@t.test");
    write(odd[0], moduleSource(90));
    write(odd[1], moduleSource(91));
    git("add", "-A");
    git("commit", "-qm", "odd paths");
  });

  const result = await scan(dir);

  assert.equal(result.corpus.files, 7);
  assert.equal(result.parse.crashed, 0);
  const dim = dimension(result, "src", "module_state_const");
  for (const rel of odd) assert.ok(dim.files.includes(rel), `${JSON.stringify(rel)} was counted`);
  assert.equal(dim.authors, 2, "git log attributed the odd paths too");
});

test("the author who wrote only the exception is not a second author of the habit", async (t) => {
  // D4 counts authors over the files carrying the side being stated. Sixty
  // files by one person hold every conforming site, and a second person wrote
  // the one file that breaks the habit. Counted over every file with a site,
  // the deviator became the second pair of hands the gate asks for, and the
  // map stated one person's habit as the directory's convention.
  const counterOnly = "let first = 1\nlet second = 2\nexport { first, second }\n";
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 60; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/zz.ts", counterOnly);
    git("add", "-A");
    git("commit", "-qm", "the exception");
  });

  const result = await scan(dir);
  const dim = dimension(result, "src", "module_state_const");

  assert.equal(result.authors.repo, 2, "the bar is two: this repository has two people in it");
  assert.deepEqual({ candidates: dim.candidates, conforming: dim.conforming }, { candidates: 122, conforming: 120 });
  assert.equal(dim.authors, 1, "only one person wrote a conforming site");
  assert.equal(dim.directive, false);
  assert.equal(dim.gate, "authors");
});

test("two scans of an unchanged repository agree", async (t) => {
  // This is what makes the overview's byte-stability claim reachable (A5).
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
  });

  const first = await scan(dir);
  const second = await scan(dir);

  assert.deepEqual(stable(second), stable(first));

  const overview = (r) => renderOverview(r, { uncovered: 0 });
  assert.equal(Buffer.compare(Buffer.from(overview(first)), Buffer.from(overview(second))), 0);

  // Two authors and a leaf directory, so the map has something to state. A
  // scan that agreed with itself while saying nothing would prove little.
  const stated = first.areas.flatMap((a) => a.dimensions).filter((d) => d.directive);
  assert.ok(stated.length > 0, "the fixture reaches a stated directive");
});

test("the gates read the baseline population, not the current one", async (t) => {
  // D6. Two of six files violate at the pin, so the baseline ratio is 0.83; the
  // working tree is then repaired to 1.00. Gating on today's counts would let an
  // agent clear its own bar by writing conforming sites.
  // Twenty files, five violating at the pin: the baseline ratio is 0.875 and
  // fails, while the repaired tree has the 35 sites the evidence gate wants, so
  // the control below proves the suppression is the baseline and nothing else.
  const files = Array.from({ length: 20 }, (_, i) => `src/m${i}.ts`);
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i, i < 5 ? "let" : "const"));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "src", files }]);

    author("second@t.test");
    for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("commit", "-qam", "repair");
  });

  const pinned = await scan(dir);
  const dim = dimension(pinned, "src", "module_state_const");

  assert.deepEqual(pinned.areas[0].baseline, { status: "ok", files: 20, missing: 0 });
  assert.deepEqual(
    { candidates: dim.baseline.candidates, conforming: dim.baseline.conforming },
    { candidates: 40, conforming: 35 },
    "E2: the baseline is read at the pinned commit, not from the working tree"
  );
  assert.equal(dim.candidates, 40);
  assert.equal(dim.conforming, 40, "D7: today's counts still print");
  assert.equal(dim.authors, 2);
  assert.equal(dim.directive, false);
  assert.equal(dim.gate, "ratio");

  // The control: the same tree with no pin does state the directive, so the
  // suppression above is the baseline and not some unrelated gate.
  rmSync(join(dir, PIN_PATH), { force: true });
  const unpinned = await scan(dir);
  const same = dimension(unpinned, "src", "module_state_const");
  assert.equal(same.baseline, null);
  assert.equal(same.directive, true);
});

test("an unreachable pinned commit drops the scan to counts", async (t) => {
  // E3. Squash-merge deletes the branch and the pinned sha with it. Never fall
  // back to stored counts: the pin stores none.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
    pin([{ path: "src", files: ["src/m0.ts"] }], "0".repeat(40));
  });

  const result = await scan(dir);

  assert.equal(result.baseline.status, "unreachable");
  assert.equal(result.baseline.countsOnly, true);
  assert.deepEqual(result.areas[0].baseline, { status: "unreachable", files: 0, missing: 0 });
  const dims = result.areas[0].dimensions;
  assert.ok(dims.length > 0, "counts are still produced");
  for (const d of dims) {
    assert.equal(d.directive, false);
    assert.equal(d.gate, "unreachable");
    assert.equal(d.baseline, null);
  }
});

test("an area that postdates the baseline states nothing", async (t) => {
  // E4. Greenfield directories are where agents write most, and there the
  // baseline would be the agent's own output at 100%.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`old/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "old", files: Array.from({ length: 20 }, (_, i) => `old/m${i}.ts`) }]);

    author("second@t.test");
    for (let i = 0; i < 20; i++) write(`src/n${i}.ts`, moduleSource(i));
    write("old/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("add", "-A");
    git("commit", "-qm", "greenfield");
  });

  const result = await scan(dir);

  const greenfield = result.areas.find((a) => a.path === "src");
  assert.equal(greenfield.baseline.status, "postdates-baseline");
  for (const d of greenfield.dimensions) {
    assert.equal(d.directive, false);
    assert.equal(d.gate, "postdates-baseline");
  }

  // The pinned area beside it is unaffected, so this is not a scan-wide stop.
  const old = dimension(result, "old", "module_state_const");
  assert.equal(old.baseline.candidates, 40);
  assert.equal(old.directive, true);
});

test("a greenfield area does not state its inverse either", async (t) => {
  // The same E4 stop, on the other side. Forcing `directive` false alone leaves
  // a two-sided dimension free to state its counter from a population that is
  // entirely the agent's own output, which is the identical laundering with the
  // sentence flipped.
  const arrows = (i) => `const a${i} = () => 1\nconst b${i} = () => 2\nexport { a${i}, b${i} }\n`;

  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`old/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "old", files: Array.from({ length: 20 }, (_, i) => `old/m${i}.ts`) }]);

    for (let i = 0; i < 10; i++) write(`src/n${i}.ts`, arrows(i));
    git("add", "-A");
    git("commit", "-qm", "greenfield, first hand");

    author("second@t.test");
    for (let i = 10; i < 20; i++) write(`src/n${i}.ts`, arrows(i));
    git("add", "-A");
    git("commit", "-qm", "greenfield, second hand");
  });

  const result = await scan(dir);
  const d = dimension(result, "src", "function_style");

  // Every count the counter's gates read is at its maximum, so nothing but the
  // block is holding the sentence back.
  assert.equal(d.candidates, 40);
  assert.equal(d.conforming, 0);
  assert.equal(d.counterRatio, 1);
  assert.ok(d.counterBound >= 0.9, `counter bound ${d.counterBound} clears the bar on its own`);
  assert.equal(d.counterAuthors, 2, "both people wrote the counter sites");

  assert.equal(d.states, null, "the inverse is blocked with the claim");
  assert.equal(d.directive, false);
  assert.equal(d.gate, "postdates-baseline");
  assert.equal(d.counterGate, "postdates-baseline");
});

test("a pinned file that left the area suppresses until a human re-pins", async (t) => {
  // E1. The pinned list is the population. A violating file moved out of the
  // area would otherwise lift the baseline ratio with every other guard holding.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 8; i++) write(`src/m${i}.ts`, moduleSource(i, i < 2 ? "let" : "const"));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "src", files: Array.from({ length: 8 }, (_, i) => `src/m${i}.ts`) }]);

    author("second@t.test");
    git("rm", "-q", "src/m0.ts", "src/m1.ts");
    git("commit", "-qm", "drop the violations");
  });

  const result = await scan(dir);

  assert.deepEqual(result.areas[0].baseline, { status: "population-change", files: 8, missing: 2 });
  const dim = dimension(result, "src", "module_state_const");
  assert.equal(dim.candidates, 12, "the current counts print");
  assert.equal(dim.conforming, 12);
  assert.equal(dim.directive, false);
  assert.equal(dim.gate, "population-change");
  assert.equal(dim.baseline, null);
});

test("no repository size truncates the corpus", async (t) => {
  // There was a 50,000-file cap here, and hitting it did not trim the tail: it
  // set `truncated`, which suppresses every directive in the whole map. A
  // repository one file over the line got counts and no conventions at all.
  // The cap existed because the parent held every syntax tree; the trees stay
  // in their workers now, so nothing is left for a file count to protect.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 200; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/m0.ts", moduleSource(0) + "const extra = 3\nexport { extra }\n");
    git("commit", "-qam", "second");
  });

  const out = await scan(dir);

  assert.equal(out.corpus.files, 200);
  assert.equal(out.corpus.truncated, false);
  assert.equal(out.suppressAll, false);
  assert.ok(
    out.areas.flatMap((a) => a.dimensions).some((d) => d.directive),
    "a corpus this size states directives rather than being suppressed wholesale"
  );
});

test("a corpus only partly answered states nothing at all", needsRuby, async (t) => {
  // F7, through its one remaining cause: the Ruby stream's per-line guard. A
  // partial corpus answered for an arbitrary subset, and a ratio counted over
  // that subset and rendered as a convention is worse than reporting counts.
  // The suppression has to reach the dimension, not just the overview's note,
  // or the area files still state directives.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 8; i++) write(`app/services/s${i}.rb`, `class S${i}\n  TZ = Time.zone.now\nend\n`);
    // The line guard reads the undrained buffer, so it needs one file whose
    // tree spans stdout chunks: 400 KB of JSON against a 64 KB pipe chunk.
    write("app/services/big.rb", Array.from({ length: 2000 }, (_, i) => `X${i} = Time.zone.now`).join("\n") + "\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("app/services/s0.rb", "class S0\n  TZ = Time.zone.now\n  OTHER = Time.zone.now\nend\n");
    git("commit", "-qam", "second");
  });

  const full = await scan(dir);
  assert.equal(full.suppressAll, false);

  const partial = await scan(dir, { guards: { ruby: { ...RUBY_GUARDS, maxLineBytes: 8 } } });

  assert.equal(partial.corpus.truncated, true);
  assert.equal(partial.suppressAll, true);
  assert.equal(partial.layout.truncated, true);
  assert.equal(partial.layout.roots.length, 0, "a roster over an arbitrary subset is worse than none");
  assert.ok(full.layout.roots.length > 0, "the same repository answered whole does get one");
  for (const a of partial.areas) {
    assert.equal(a.kinds, null, "and no area describes its own kinds from that subset either");
  }
  for (const d of partial.areas.flatMap((a) => a.dimensions)) {
    assert.equal(d.directive, false, "no directive survives a partial corpus");
    assert.equal(d.gate, "corpus-truncated");
  }
});

test("a rake task with no spec is counted, and one with a spec conforms", needsRuby, async (t) => {
  // Issue #7: an obligation between two files, not syntax inside one. The count
  // is a set-membership test over the corpus, so nothing here needs the parser
  // to see the spec at all.
  const dir = repo(t, (d, { git, write }) => {
    write("lib/tasks/backfill.rake", "task :backfill do\n  puts 1\nend\n");
    write("lib/tasks/cleanup.rake", "task :cleanup do\n  puts 2\nend\n");
    write("lib/tasks/reindex.rake", "task :reindex do\n  puts 3\nend\n");
    write("spec/lib/tasks/backfill_spec.rb", "describe 'backfill' do\nend\n");
    git("add", "-A");
    git("commit", "-qm", "one");
  });

  const result = await scan(dir);
  const area = result.areas.find((a) => a.path === "lib/tasks");

  assert.ok(area, `no lib/tasks area: ${result.areas.map((a) => a.path).join(", ")}`);
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");
  assert.ok(row, `no obligation counted: ${area.dimensions.map((dim) => dim.key).join(", ")}`);
  assert.equal(row.candidates, 3, "one site per rake task");
  assert.equal(row.conforming, 1, "only backfill ships a spec");
});

test("the baseline counts an obligation against the pinned corpus, not today's", needsRuby, async (t) => {
  // An obligation is answered by which files exist, so a branch that DELETES a
  // spec changes the answer without touching the producer. The producer's bytes
  // are unchanged, so the baseline reuses the corpus parse, and that record
  // carries hits computed over today's file list. Reusing them makes the
  // baseline agree with the branch and the violation disappears.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (const n of ["backfill", "cleanup", "reindex"]) {
      write(`lib/tasks/${n}.rake`, `task :${n} do\n  puts 1\nend\n`);
      write(`spec/lib/tasks/${n}_spec.rb`, `describe '${n}' do\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "lib/tasks", files: ["lib/tasks/backfill.rake", "lib/tasks/cleanup.rake", "lib/tasks/reindex.rake"] }]);

    author("second@t.test");
    git("rm", "-q", "spec/lib/tasks/cleanup_spec.rb");
    git("commit", "-qm", "drop a spec");
  });

  const result = await scan(dir);
  const area = result.areas.find((a) => a.path === "lib/tasks");
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");

  assert.equal(row.conforming, 2, "today: cleanup lost its spec");
  assert.equal(row.candidates, 3);
  assert.ok(row.baseline, "no baseline counts at all");
  assert.equal(row.baseline.conforming, 3, "at the pin every task had a spec");
  assert.equal(row.baseline.candidates, 3);
});

test("a spec in the wrong directory is counted, so a narrow predicate is visible", needsRuby, async (t) => {
  // Measured on alphagov/whitehall: the app/models area scores 0 of 160, and 117
  // of those models have a test one directory deeper. Without this count the row
  // reads "this repository does not test its models".
  const dir = repo(t, (d, { git, write }) => {
    for (const n of ["backfill", "cleanup", "reindex"]) {
      write(`lib/tasks/${n}.rake`, `task :${n} do\n  puts 1\nend\n`);
    }
    write("spec/lib/tasks/backfill_spec.rb", "describe 'backfill' do\nend\n");
    // cleanup is specced, one directory away from where the predicate looks.
    write("spec/tasks/cleanup_spec.rb", "describe 'cleanup' do\nend\n");
    git("add", "-A");
    git("commit", "-qm", "one");
  });

  const result = await scan(dir);
  const area = result.areas.find((a) => a.path === "lib/tasks");
  const row = area.dimensions.find((dim) => dim.key === "rake_task_spec");

  assert.equal(row.candidates, 3);
  assert.equal(row.conforming, 1, "only backfill is specced where the predicate looks");
  assert.equal(row.companionsElsewhere, 1, "cleanup is specced, one directory away");
});

test("a Ruby repository with no Rails in it is not asked a Rails question", needsRuby, async (t) => {
  // zone_aware_time's counterClaim is null, so off-Rails it can only ever print
  // "0 of N sites" forever: Homebrew 123 sites, puppet 197, fastlane 97, chef
  // 96, none of them able to state either side.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 6; i++) {
      write(`lib/tool${i}.rb`, `class Tool${i}\n  def call\n    Time.now\n  end\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("lib/tool0.rb", "class Tool0\n  def call\n    Time.now\n  end\nend\n\n");
    git("add", "-A");
    git("commit", "-qm", "second author");
  });

  const result = await scan(dir);
  const area = result.areas.find((a) => a.path === "lib");

  assert.ok(area, "the area exists");
  assert.equal(
    area.dimensions.find((d) => d.key === "zone_aware_time"),
    undefined,
    "no line that can only ever read zero"
  );
  assert.ok(area.dimensions.length > 0, "and the Ruby claims that are Ruby still count");
});

test("a Rails repository is still asked", needsRuby, async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) {
      write(`app/models/thing${i}.rb`, `class Thing${i}\n  def stamp\n    Time.now\n  end\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);
  const area = result.areas.find((a) => a.path === "app/models");

  assert.ok(
    area.dimensions.some((d) => d.key === "zone_aware_time"),
    "app/models is the shape, so the question applies"
  );
});

/** The checker runs where the repository's own dependencies are on disk. */
function withDeps(dir) {
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  return dir;
}

function typedRepo(t, { deps = "dir", pinned = false, areas = ["src/models"], broken = false } = {}) {
  return repo(t, (d, { git, write, pin }) => {
    write("tsconfig.json", `{"compilerOptions":{"strict":true}}`);
    write(".gitignore", "node_modules\n");
    const pinnedAreas = [];
    for (const path of areas) {
      const files = Array.from({ length: 8 }, (_, i) => `${path}/m${i}.ts`);
      if (broken) files.push(`${path}/bad.ts`);
      for (const [i, rel] of files.entries()) {
        write(rel, rel.endsWith("bad.ts") ? "export const = ;\n" : `export class M${i} { name = "m${i}"; label() { return this.name.trim() } }\n`);
      }
      pinnedAreas.push({ path, files });
    }
    if (deps === "dir") write("node_modules/left-pad/index.js", "");
    if (deps === "link") {
      const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-deps-"));
      t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
      symlinkSync(elsewhere, join(d, "node_modules"), "dir");
    }
    git("add", "-A");
    git("commit", "-qm", "init");
    if (pinned) pin(pinnedAreas);
  });
}

test("the checker runs on its own where the repository can use it", async (t) => {
  const r = await scan(typedRepo(t));
  assert.equal(r.semantic.ran, true);
  assert.ok(r.areas.some((a) => a.dimensions.some((d) => d.key === "law_of_demeter")));
});

test("the checker stays off in a repository with no file it reads", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) write(`app/m${i}.py`, "x = 1\n");
    write("node_modules/left-pad/index.js", "");
    git("add", "app");
    git("commit", "-qm", "init");
  });
  assert.equal((await scan(dir)).semantic.reason, "no-checked-files");
});

for (const [name, opts, reason] of [
  ["with no dependencies on disk", { deps: null }, "no-dependencies"],
  ["with its dependencies linked in from elsewhere", { deps: "link" }, "no-dependencies"],
]) {
  test(`the checker stays off ${name}`, { skip: opts.deps === "link" && process.platform === "win32" }, async (t) => {
    const r = await scan(typedRepo(t, opts));
    assert.deepEqual(r.semantic, { ran: false, status: null, reason, typedResolutionRate: null });
    assert.ok(!r.areas.some((a) => a.dimensions.some((d) => d.key === "law_of_demeter")));
  });
}

test("the checker stays off in plain JavaScript, with its dependencies installed and a declaration file beside it", async (t) => {
  // A package's hand-written index.d.ts types nothing its .js files import, so
  // it is not the TypeScript that would let the checker resolve.
  const dir = repo(t, (d, { git, write }) => {
    write(".gitignore", "node_modules\n");
    for (let i = 0; i < 8; i++) write(`app/m${i}.js`, `export const m${i} = (o) => o.a.b.c();\n`);
    write("index.d.ts", "export declare const m0: unknown;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const r = await scan(withDeps(dir));
  assert.deepEqual(r.semantic, { ran: false, status: null, reason: "plain-javascript", typedResolutionRate: null });
});

const demeterRow = async (dir, path = "src/models") => dimension(await scan(dir), path, "law_of_demeter");

test("a pinned repository baselines a type-checked row over its pinned files", async (t) => {
  const row = await demeterRow(typedRepo(t, { pinned: true }));
  assert.equal(row.gate, "ratio");
  assert.deepEqual([row.baseline.candidates, row.baseline.conforming], [8, 0]);
});

for (const [name, change] of [
  ["edited in the working tree", (dir) => writeFileSync(join(dir, "src/models/m0.ts"), `export const m0 = 1\n`)],
  [
    "renamed in a commit",
    (dir) => {
      const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
      git("mv", "src/models/m0.ts", "src/models/renamed.ts");
      git("commit", "-qm", "rename");
    },
  ],
]) {
  test(`a checked file ${name} since the pin closes its area's type-checked row`, async (t) => {
    // Read back from the pin, the file has no type-checked hits, so counting the
    // rest would let an edit take a violation out of the baseline.
    const dir = typedRepo(t, { pinned: true });
    change(dir);
    const row = await demeterRow(dir);
    assert.equal(row.gate, "semantic-unbaselined");
    assert.equal(row.states, null);
  });
}

test("an edit closes only the area that holds it", async (t) => {
  const dir = typedRepo(t, { pinned: true, areas: ["src/models", "src/other"] });
  writeFileSync(join(dir, "src/other/m0.ts"), `export const m0 = 1\n`);

  assert.equal((await demeterRow(dir, "src/other")).gate, "semantic-unbaselined");
  assert.equal((await demeterRow(dir, "src/models")).gate, "ratio");
});

test("a file that parses on neither side has not moved, so it closes nothing", async (t) => {
  const row = await demeterRow(typedRepo(t, { pinned: true, broken: true }));
  assert.equal(row.gate, "ratio");
  assert.deepEqual([row.baseline.candidates, row.baseline.conforming], [8, 0]);
});

test("a degraded checker suppresses its own claims across a real scan", async (t) => {
  // B8's whole point. The tier ran on two real repositories at 70% and 29%
  // resolution, and both stated semantic claims anyway, because the tier's
  // state reached the record and never reached the verdict.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-degraded-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "src"), { recursive: true });
  // A tsconfig that does not parse, so the tier is degraded by rule whatever
  // resolved. A missing one no longer is: the checker runs on its defaults
  // there and the rate decides.
  writeFileSync(join(dir, "tsconfig.json"), "{ this is not json");
  for (let i = 0; i < 14; i++) {
    writeFileSync(
      join(dir, "src", `f${i}.ts`),
      `export function f${i}(s: string) {\n  return s.trim().toLowerCase()\n}\n`
    );
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");

  const r = await scan(withDeps(dir));

  assert.equal(r.semantic.ran, true);
  assert.equal(r.semantic.status, "degraded", `the tier was expected degraded, got ${r.semantic.reason}`);
  for (const area of r.areas) {
    for (const d of area.dimensions.filter((x) => x.key === "law_of_demeter")) {
      assert.equal(d.states, null, `${area.path} stated a semantic claim off a degraded tier`);
      assert.equal(d.gate, "degraded-semantic", `${area.path} closed it for ${d.gate} instead`);
    }
  }
});

test("the resolution rate is taken over the areas the map describes", async (t) => {
  // A directory of vendored bundles is discovered as an area, counts nothing
  // and is dropped, and the map then says nothing was counted in it. Its
  // untyped accesses still took a fully typed repository to 26% and closed
  // every type-checked claim.
  const dir = repo(t, (d, { git, write }) => {
    write("tsconfig.json", `{"include":["src","public"],"compilerOptions":{"strict":true,"allowJs":true}}`);
    for (let i = 0; i < 8; i++) {
      write(`src/models/m${i}.ts`, `export class M${i} { name = "m${i}"; label() { return this.name.trim() } }\n`);
      write(`src/services/s${i}.ts`, `import { M${i} } from "../models/m${i}"\nexport const s${i} = new M${i}().label().length\n`);
      const body = Array.from({ length: 150 }, (_, n) => `o.f${n}=function(a,b){return a.x.y+b.z;};`).join("");
      write(`public/js/lib${i}.js`, `(function(){var o={};${body}})();\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const r = await scan(withDeps(dir));

  assert.ok(!r.areas.some((a) => a.path === "public/js"), "the bundles are counted in no area");
  assert.equal(r.semantic.status, "ok", `degraded for ${r.semantic.reason} at ${r.semantic.typedResolutionRate}`);
  assert.equal(r.semantic.typedResolutionRate, 1);
});

test("areas holding no checked file take no rate from a dropped bundle directory", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) {
      write(`app/models/m${i}.rb`, `class M${i} < ApplicationRecord\n  validates :name, presence: true\nend\n`);
      write(`app/services/s${i}_service.rb`, `class S${i}Service\n  def call\n    M${i}.first\n  end\nend\n`);
      const body = Array.from({ length: 150 }, (_, n) => `o.f${n}=function(a,b){return a.x.y+b.z;};`).join("");
      write(`public/js/lib${i}.js`, `(function(){var o={};${body}})();\n`);
    }
    // Plain JavaScript with no config is skipped before the checker runs.
    write("tsconfig.json", "{}\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const r = await scan(withDeps(dir));

  assert.ok(r.areas.length > 0 && !r.areas.some((a) => a.path === "public/js"), "only the Ruby areas are described");
  assert.equal(r.semantic.status, "ok", `degraded for ${r.semantic.reason} at ${r.semantic.typedResolutionRate}`);
  assert.equal(r.semantic.typedResolutionRate, null);
});

test("a repository whose every area was dropped takes no rate from it", async (t) => {
  // No area was discovered and every area was dropped both leave nothing
  // folded; only the first is a repository the whole corpus speaks for.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) {
      const body = Array.from({ length: 150 }, (_, n) => `o.f${n}=function(a,b){return a.x.y+b.z;};`).join("");
      write(`public/js/lib${i}.js`, `(function(){var o={};${body}})();\n`);
    }
    // Plain JavaScript with no config is skipped before the checker runs.
    write("tsconfig.json", "{}\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const r = await scan(withDeps(dir));

  assert.deepEqual(r.areas, []);
  assert.equal(r.semantic.status, "ok", `degraded for ${r.semantic.reason} at ${r.semantic.typedResolutionRate}`);
  assert.equal(r.semantic.typedResolutionRate, null);
});

/** A workspace whose packages import each other through an alias only the base config declares. */
function aliasedWorkspace(t, { base }) {
  return repo(t, (d, { git, write }) => {
    if (base) {
      write("tsconfig.base.json", `{"compilerOptions":{"strict":true,"baseUrl":".","paths":{"@acme/util":["libs/util/src/index.ts"]}}}`);
    }
    write(".gitignore", "node_modules\n");
    write(
      "libs/util/src/index.ts",
      `export class Leaf { label = "x"; }\nexport class Mid { beta = new Leaf(); }\nexport class Top { alpha = new Mid(); }\nexport function make(): Top { return new Top(); }\n`
    );
    for (let i = 0; i < 8; i++) {
      write(`apps/web/src/m${i}.ts`, `import { make } from "@acme/util";\nexport const v${i} = make().alpha.beta.label.length;\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });
}

test("a workspace root with only a base config resolves through it", async (t) => {
  // Measured on six Nx-style roots: three read degraded on the compiler's
  // defaults and ok once the aliases in tsconfig.base.json were read.
  const r = await scan(withDeps(aliasedWorkspace(t, { base: true })));

  assert.equal(r.semantic.ran, true);
  assert.equal(r.semantic.status, "ok", `degraded for ${r.semantic.reason} at ${r.semantic.typedResolutionRate}`);
  assert.equal(r.semantic.reason, null);
  assert.ok(r.semantic.typedResolutionRate >= 0.8, `resolved ${r.semantic.typedResolutionRate}`);
});

test("the same workspace with no config at its root reads its aliases as any", async (t) => {
  const r = await scan(withDeps(aliasedWorkspace(t, { base: false })));

  assert.equal(r.semantic.status, "degraded");
  assert.equal(r.semantic.reason, "no-tsconfig");
});

test("root code below the area floor keeps its rate beside a dropped bundle directory", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 1; i <= 3; i++) write(`f${i}.ts`, `import { make } from "foo";\nexport const v${i} = make().alpha.beta.gamma;\n`);
    for (let i = 0; i < 8; i++) {
      const body = Array.from({ length: 150 }, (_, n) => `o.f${n}=function(a,b){return a.x.y+b.z;};`).join("");
      write(`public/js/lib${i}.js`, `(function(){var o={};${body}})();\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const r = await scan(withDeps(dir));

  assert.deepEqual(r.areas, []);
  assert.equal(r.semantic.status, "degraded");
  assert.equal(r.semantic.reason, "no-tsconfig");
  assert.equal(r.semantic.typedResolutionRate, 0);
});

test("root code below the area floor keeps its rate beside Ruby areas, with or without a Ruby", async (t) => {
  // Areas holding no checked file leave the rate to the files in no area, so
  // a machine that holds Ruby areas back answers the same as one that reads them.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 1; i <= 3; i++) write(`f${i}.ts`, `import { make } from "foo";\nexport const v${i} = make().alpha.beta.gamma;\n`);
    for (let i = 0; i < 8; i++) {
      write(`app/models/m${i}.rb`, `class M${i} < ApplicationRecord\n  validates :name, presence: true\nend\n`);
      write(`app/services/s${i}_service.rb`, `class S${i}Service\n  def call\n    M${i}.first\n  end\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const verdict = (r) => ({ status: r.semantic.status, reason: r.semantic.reason, rate: r.semantic.typedResolutionRate });
  const expected = { status: "degraded", reason: "no-tsconfig", rate: 0 };

  assert.deepEqual(verdict(await scan(withDeps(dir))), expected);

  if (process.platform === "win32") return;
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-bin-"));
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  });
  symlinkSync(execFileSync("sh", ["-c", "command -v git"]).toString().trim(), join(bin, "git"));
  process.env.PATH = bin;

  const blind = await scan(withDeps(dir));

  assert.deepEqual(blind.parse.unreadable, ["ruby"], "the Ruby areas are held");
  assert.deepEqual(verdict(blind), expected);
});

test("a repository with no area is still measured over every file it holds", async (t) => {
  // An empty measured set read as a corpus with no property access, so an
  // install that resolved nothing reported ok with no rate.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 1; i <= 3; i++) write(`f${i}.ts`, `import { make } from "foo";\nexport const v${i} = make().alpha.beta.gamma;\n`);
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const r = await scan(withDeps(dir));

  assert.deepEqual(r.areas, []);
  assert.equal(r.semantic.status, "degraded");
  assert.equal(r.semantic.reason, "no-tsconfig");
  assert.equal(r.semantic.typedResolutionRate, 0);
});

test("the scan writes down which kinds of file live where", async (t) => {
  // The denominator the roster exists for: five Cypress specs beside five
  // components is a repository that tests in Cypress, and nothing in the map
  // said so, because every other row counts a site inside a file.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 5; i++) {
      write(
        `src/components/Thing${i}.tsx`,
        `export const Thing${i} = () => {\n  const label = "thing${i}"\n  return <div className="thing">{label}</div>\n}\n`
      );
      write(
        `cypress/integration/thing${i}.spec.js`,
        `describe("thing${i}", () => {\n  it("loads", () => {\n    cy.visit("/")\n  })\n})\n`
      );
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  assert.equal(result.layout.truncated, false);
  assert.deepEqual(result.layout.roots.map((r) => r.path).sort(), ["cypress/integration", "src/components"]);
  assert.equal(result.layout.tests[0].runner, "cypress", "the directory answers where the parse could not");
  assert.equal(result.layout.tests[0].files, 5);
  assert.deepEqual(result.layout.principles, ["test_shape"]);

  const components = result.areas.find((a) => a.path === "src/components");
  assert.ok(components, "the area exists");
  assert.deepEqual(components.kinds.exts, [[".tsx", 5]], "an area is counted the way a root is");
  assert.equal(components.kinds.jsx, 5);
});

test("an area names what its files import and what other files import from it", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) {
      write(
        `src/components/Thing${i}.tsx`,
        `import styled from "styled-components"\nimport { fullName } from "../utils/user"\n` +
          `const Box${i} = styled.div\`\`\nexport const Thing${i} = () => <Box${i}>{fullName()}</Box${i}>\n`
      );
    }
    write("src/utils/user.ts", "export function fullName(): string {\n  return \"x\"\n}\n");
    write("src/utils/dates.ts", "export function today(): number {\n  return 1\n}\n");
    write("src/utils/ids.ts", "export function nextId(): number {\n  return 2\n}\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  const components = result.areas.find((a) => a.path === "src/components");
  assert.ok(components, "the importing area exists");
  assert.deepEqual(
    components.imports,
    [{ module: "styled-components", files: 6, of: 6 }],
    "a relative sibling import is not a convention, so only the package is named"
  );

  const utils = result.areas.find((a) => a.path === "src/utils");
  assert.ok(utils, "the imported area exists");
  assert.deepEqual(utils.reused, [{ name: "fullName", file: "src/utils/user.ts", importers: 6 }]);
  assert.deepEqual(utils.imports, [], "nothing in here imports anything, which is a count and not a gap");
});

test("an area with no static import surface is asked neither question", needsRuby, async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 4; i++) {
      write(`app/models/thing${i}.rb`, `class Thing${i}\n  def call\n    1\n  end\nend\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  const models = result.areas.find((a) => a.path === "app/models");
  assert.ok(models, "the area exists");
  assert.equal(models.imports, null, "Ruby has no import to count, and zero would read as a measured none");
  assert.equal(models.reused, null);
});

/* --- the pooled prior is built from the whole repository (#56) --- */

/** A file with one interface, prefixed or not, which is what interface_prefix counts. */
const iface = (i, prefix = "I") => `export interface ${prefix}Thing${i} { a: number }\n`;

test("a small perfect directory borrows the confidence of the rest of the repository", async (t) => {
  // The Wilson bound needs about 35 perfect sites to reach 0.90, and a measured
  // front end's median area holds 11 files, so a directory could be perfectly
  // consistent and never speak. `interface_prefix` held at 2,125 of 2,152 sites
  // repo-wide, cleared the ratio gate in 116 of its 118 areas, and stated in six.
  const dir = repo(t, (d, { git, write, author }) => {
    for (let i = 0; i < 60; i++) write(`src/big/f${i}.ts`, iface(i));
    for (let i = 0; i < 9; i++) write(`src/small/g${i}.ts`, iface(100 + i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    write("src/small/g0.ts", iface(100) + "export const touched = 1\n");
    git("add", "-A");
    git("commit", "-qm", "second hand");
  });

  const r = await scan(dir);
  const small = dimension(r, "src/small", "interface_prefix");

  assert.equal(small.candidates, 9, "nine sites is all it has");
  assert.ok(small.bound < 0.9, `its own bound cannot carry it: ${small.bound}`);
  assert.equal(small.gate, null, JSON.stringify({ gate: small.gate, priorBound: small.priorBound }));
  assert.equal(small.borrowed, true);
});

test("a directory whose population nobody accepted lends nothing", async (t) => {
  // The pool is built from slots no other condition has closed. A greenfield
  // area's population is the agent's own output (E4), so counting it into the
  // prior would let the agent lend itself the confidence to state a claim.
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 9; i++) write(`src/small/g${i}.ts`, iface(100 + i));
    git("add", "-A");
    git("commit", "-qm", "init");
    author("second@t.test");
    // The big directory arrives after the pin, so its counts postdate the
    // baseline and it may not vote.
    for (let i = 0; i < 60; i++) write(`src/big/f${i}.ts`, iface(i));
    git("add", "-A");
    const sha = git("rev-parse", "HEAD").trim();
    git("commit", "-qm", "greenfield");
    pin([{ id: "s", path: "src/small", files: Array.from({ length: 9 }, (_, i) => `src/small/g${i}.ts`) }], sha);
  });

  const r = await scan(dir);
  const small = dimension(r, "src/small", "interface_prefix");

  assert.equal(small.gate, "evidence", JSON.stringify({ gate: small.gate, priorBound: small.priorBound }));
  assert.equal(small.borrowed, false);
});

test("the parse starts before the baseline answers, and the map is the same as when it waited", async (t) => {
  // The parse needs only the files and the frameworks; awaiting the baseline's
  // git reads first held it for nothing. A baseline that answers only once the
  // parse has started proves the order, and the pinned fixture makes the
  // baseline's answer reach the map.
  const files = Array.from({ length: 20 }, (_, i) => `src/m${i}.ts`);
  const dir = repo(t, (d, { git, write, author, pin }) => {
    for (let i = 0; i < 20; i++) write(`src/m${i}.ts`, moduleSource(i, i < 5 ? "let" : "const"));
    git("add", "-A");
    git("commit", "-qm", "init");
    pin([{ path: "src", files }]);
    author("second@t.test");
    for (let i = 0; i < 5; i++) write(`src/m${i}.ts`, moduleSource(i));
    git("commit", "-qam", "repair");
  });
  const plain = await scan(dir);

  let parseStarted;
  const started = new Promise((resolve) => (parseStarted = resolve));
  const parseFiles = (input, options) => {
    parseStarted("parse first");
    return parseAll(input, options);
  };
  let order = null;
  const resolveState = async (root) => {
    let timer;
    order = await Promise.race([started, new Promise((resolve) => (timer = setTimeout(resolve, 5_000, "baseline first")))]);
    clearTimeout(timer);
    // And slower than the parse may take, so the parse is still running when it answers.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return resolveBaseline(root);
  };
  const delayed = await scan(dir, { resolveState, parseFiles });

  assert.equal(order, "parse first");
  assert.equal(plain.areas[0].baseline.status, "ok", "the fixture reaches the baseline");
  assert.deepEqual(stable(delayed), stable(plain));
});

test("a directory of components becomes an area that counts its scripts and its names", async (t) => {
  const names = ["UserCard", "OrderList", "DataTable", "FormInput", "NavBar", "ErrorPage", "BigTable", "SidePanel"];
  const script = `import { api } from "../api";\n\nasync function loadItem(id) {\n  try {\n    return await api.get(id);\n  } catch (err) {\n    console.error(err);\n  }\n}\n`;
  const dir = repo(t, (d, { git, write }) => {
    for (const name of names) {
      write(`src/components/${name}.vue`, `<template>\n  <div @click="loadItem(1)" />\n</template>\n\n<script setup>\n${script}</script>\n`);
      write(`src/lib/${name}.svelte`, `<script>\n${script}</script>\n\n<button onclick={() => loadItem(1)}>load</button>\n`);
    }
    // Markup alone: no script to read, and still a component with a name.
    write("src/components/PlainBanner.vue", "<template>\n  <p>hello</p>\n</template>\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);

  for (const [path, ext, files] of [["src/components", ".vue", 9], ["src/lib", ".svelte", 8]]) {
    const area = result.areas.find((a) => a.path === path);
    assert.ok(area, `${path} is an area`);
    assert.match(renderArea(area), new RegExp(`^paths:\\n  - "${path}/\\*\\*/\\*\\${ext}"$`, "m"));
    const named = dimension(result, path, "file_naming_case");
    assert.equal(named.learned, "PascalCase");
    assert.equal(named.learnedKind, "component");
    assert.equal(named.candidates, files, "a component with no script still votes with its name");
    assert.deepEqual(
      [dimension(result, path, "swallowed_error").candidates, dimension(result, path, "function_naming_case").candidates],
      [8, 8],
      "the script rows count inside the block"
    );
  }

  const lines = [...scanLines(scanSummary(result, planMap(result))), renderOverview(result, { uncovered: 0 })].join("\n");
  assert.doesNotMatch(lines, /nothing was counted in/);
  assert.deepEqual(result.corpus.scriptOnly, [[".vue", 9], [".svelte", 8]]);
  assert.match(lines, /^- of 17 \.vue and \.svelte files only the script block is read; the template is not$/m);
});

test("a claim counted over a Gemfile names it, not the label the kinds line gives a file with no extension", async (t) => {
  const rescued = "begin\n  run\nrescue StandardError => e\n  warn e\nend\n";
  const dir = repo(t, (d, { git, write }) => {
    for (const name of ["load", "save", "list", "drop"]) write(`tools/${name}.rb`, rescued);
    write("tools/Gemfile", `source "https://rubygems.org"\n${rescued}`);
    write("tools/old.js", "const old = 1;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);
  const text = planMap(result).bodies.get([...planMap(result).bodies.keys()].find((name) => name !== "anatomiya-overview.md"));

  assert.match(text, /^kinds: .*\(none\)/m);
  assert.match(text, /^rescue blocks use the error they caught, in \.rb files and Gemfile: /m);
  assert.match(text, /^module-level bindings are const, in \.js files: /m);
});

test("a claim learned from the modules of a directory says so beside the components it was not asked of", async (t) => {
  const caught = "try {\n  run();\n} catch (err) {\n  console.error(err);\n}\n";
  const dir = repo(t, (d, { git, write }) => {
    for (const name of ["load", "save", "list", "drop"]) {
      write(`src/routes/${name}.ts`, `export const ${name} = 1;\n${caught}`);
      write(`src/routes/${name}.svelte`, `<script>\n  let { data } = $props();\n${caught}</script>\n\n<p>{data}</p>\n`);
    }
    write("src/routes/old.js", "const old = 1;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const result = await scan(dir);
  const text = planMap(result).bodies.get([...planMap(result).bodies.keys()].find((name) => name !== "anatomiya-overview.md"));

  assert.match(text, /^module-level bindings are const, in \.js and \.ts files: /m);
  assert.match(text, /^catch blocks use the error they caught: /m, "a row asked of every file here names none");
  assert.doesNotMatch(factsJson(result), /extsByLang|askedExts/, "the record holds neither");
});

test("a claim names only the extensions its row was asked of, and a row asked of no file prints nothing", async (t) => {
  const handler = (name) => `export const ${name} = () => {\n  const onPick = () => {};\n  return <List onPick={onPick} />;\n};\n`;
  const dir = repo(t, (d, { git, write }) => {
    for (const name of ["Load", "Save", "List", "Drop"]) write(`src/panel/${name}.tsx`, handler(name));
    for (const name of ["load", "save", "list", "drop"]) write(`src/panel/use-${name}.ts`, `export const ${name} = 1;\n`);
    write("src/panel/Panel.vue", "<template><p /></template>\n");
    for (const name of ["load", "save", "list", "drop"]) write(`src/hooks/use-${name}.ts`, `export const ${name} = 1;\n`);
    write("src/hooks/Hook.vue", "<template><p /></template>\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const bodies = planMap(await scan(dir)).bodies;
  const text = (dirName) => [...bodies.values()].find((body) => body.includes(`# ${dirName}`));

  assert.match(text("src/panel"), /^an event handler prop is given [^,]+, [^,]+, in \.tsx files: /m);
  assert.doesNotMatch(text("src/hooks"), /event handler prop|^\s*, in /m);
});

/** A team's own files beside where each target's map lands, and enough source for one area. */
function teamRepo(t) {
  return repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) write(`src/m${i}.ts`, moduleSource(i));
    for (const f of ["workflows/ci.yml", "workflows/release.yml", "dependabot.yml"]) write(`.github/${f}`, "on: push\n");
    for (const f of ["team", "style", "review"]) write(`.cursor/rules/${f}.mdc`, "# ours\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
}

/** Every file in every target's directory, by path. */
function mapBytes(dir) {
  const out = {};
  for (const target of Object.values(TARGETS)) {
    for (const name of readdirSync(join(dir, target.dir)).sort()) {
      out[`${target.dir}/${name}`] = readFileSync(join(dir, target.dir, name), "utf8");
    }
  }
  return out;
}

const rosterLines = (bytes, dirName) =>
  bytes[".claude/rules/anatomiya-overview.md"].split("\n").filter((l) => l.startsWith(`- ${dirName}`));

async function threeScans(t, afterFirst) {
  const dir = teamRepo(t);
  writeMap(await scan(dir), { targets: Object.keys(TARGETS) });
  const first = mapBytes(dir);
  afterFirst(dir);
  writeMap(await scan(dir), { targets: null });
  const second = mapBytes(dir);
  writeMap(await scan(dir), { targets: null });
  return { first, second, third: mapBytes(dir) };
}

test("three scans with every target on leave every file byte-identical after the first", async (t) => {
  // A repository that commits its map: the second scan's listing holds the first scan's files.
  const { first, second, third } = await threeScans(t, (dir) => {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("add", "-A");
    git("commit", "-qm", "the map");
    const tracked = git("ls-files").toString();
    for (const target of Object.values(TARGETS)) assert.ok(tracked.includes(`${target.dir}/anatomiya-overview`), target.dir);
  });

  assert.ok(Object.keys(first).some((p) => p.startsWith(".github/instructions/anatomiya-area-")), "an area file per target");
  assert.ok(Object.keys(first).some((p) => p.startsWith(".cursor/rules/anatomiya-area-")));
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.deepEqual(rosterLines(third, ".github"), ["- .github: 3 .yml"]);
  assert.deepEqual(rosterLines(third, ".cursor"), ["- .cursor/rules: 3 .mdc"]);
  assert.deepEqual(rosterLines(third, ".claude"), [], "nor the store and the map under .claude");
});

test("three scans with every target on and the map untracked leave every file byte-identical", async (t) => {
  const { first, second, third } = await threeScans(t, () => {});

  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.deepEqual(rosterLines(third, ".github"), ["- .github: 3 .yml"]);
  assert.deepEqual(rosterLines(third, ".cursor"), ["- .cursor/rules: 3 .mdc"]);
});

test("three scans leave a map committed through a .claude/rules link byte-identical", needsSymlinks, async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 8; i++) write(`src/m${i}.ts`, moduleSource(i));
    write("agents/rules/team.md", "# ours\n");
    mkdirSync(join(d, ".claude"));
    symlinkSync("../agents/rules", join(d, ".claude", "rules"), "dir");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  const written = () => Object.fromEntries(
    readdirSync(join(dir, "agents/rules")).sort().map((n) => [n, readFileSync(join(dir, "agents/rules", n), "utf8")])
  );
  const scanned = async () => { writeMap(await scan(dir)); return written(); };

  const first = await scanned();
  git("add", "-A");
  git("commit", "-qm", "the map");
  assert.match(git("ls-files"), /^agents\/rules\/anatomiya-overview\.md$/m, "git tracks the map under the link's target");
  const second = await scanned();
  const third = await scanned();

  assert.ok(Object.keys(first).some((n) => n.startsWith("anatomiya-area-")), "an area file");
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  const roster = third["anatomiya-overview.md"].split("## What lives where\n\n")[1].split("\n\n")[0].split("\n");
  // The link and the team's one file, and none of the three the scan wrote beside it.
  assert.deepEqual(roster, ["- src: 8 .ts", "- and 2 files in 2 directories too small for a line of their own"]);
});

// One small repository per language, in the layout that language's own
// repositories were measured to use: three sources, two of them tested.
const SEVEN = {
  python: {
    runner: "pytest",
    source: (s) => [`src/shop/${s}.py`, `def ${s}():\n    return 1\n`],
    test: (s) => [`tests/test_${s}.py`, `from shop.${s} import ${s}\n\n\ndef test_${s}():\n    assert ${s}() == 1\n`],
  },
  php: {
    runner: "phpunit",
    source: (s) => [`src/Shop/${cap(s)}.php`, `<?php\n\nnamespace Shop;\n\nclass ${cap(s)}\n{\n}\n`],
    test: (s) => [
      `tests/Shop/${cap(s)}Test.php`,
      `<?php\n\nnamespace Shop\\Tests;\n\nclass ${cap(s)}Test extends TestCase\n{\n    public function testRuns(): void\n    {\n    }\n}\n`,
    ],
  },
  go: {
    runner: "go test",
    source: (s) => [`shop/${s}.go`, `package shop\n\nfunc ${cap(s)}() int {\n\treturn 1\n}\n`],
    test: (s) => [`shop/${s}_test.go`, `package shop\n\nimport "testing"\n\nfunc Test${cap(s)}(t *testing.T) {\n}\n`],
  },
  java: {
    runner: "junit",
    source: (s) => [`src/main/java/shop/${cap(s)}.java`, `package shop;\n\nclass ${cap(s)} {\n}\n`],
    test: (s) => [
      `src/test/java/shop/${cap(s)}Test.java`,
      `package shop;\n\nimport org.junit.jupiter.api.Test;\n\nclass ${cap(s)}Test {\n    @Test\n    void runs() {}\n}\n`,
    ],
  },
  csharp: {
    runner: "xunit",
    source: (s) => [`src/Shop/${cap(s)}.cs`, `namespace Shop;\n\npublic class ${cap(s)}\n{\n}\n`],
    test: (s) => [`test/Shop.Tests/${cap(s)}Tests.cs`, `namespace Shop.Tests;\n\npublic class ${cap(s)}Tests\n{\n    [Fact]\n    public void Runs() {}\n}\n`],
  },
  kotlin: {
    runner: "kotlin.test",
    source: (s) => [`shop/commonMain/src/shop/${cap(s)}.kt`, `package shop\n\nclass ${cap(s)}\n`],
    test: (s) => [
      `shop/commonTest/src/shop/${cap(s)}Test.kt`,
      `package shop\n\nimport kotlin.test.Test\n\nclass ${cap(s)}Test {\n    @Test\n    fun runs() {\n    }\n}\n`,
    ],
  },
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);

for (const [lang, { runner, source, test: spec }] of Object.entries(SEVEN)) {
  test(`${lang}: a scan counts the tests by their runner and the sources that have one of their name`, async (t) => {
    const dir = repo(t, (d, { git, write }) => {
      for (const s of ["cart", "order", "price"]) write(...source(s));
      for (const s of ["cart", "order"]) write(...spec(s));
      git("add", "-A");
      git("commit", "-q", "-m", "init");
    });

    const result = await scan(dir);
    assert.deepEqual(result.layout.tests.map((g) => [g.runner, g.files]), [[runner, 2]]);
    const companions = result.layout.roots.map((r) => r.companions).filter(Boolean);
    assert.deepEqual(companions.map((c) => [c.with, c.of]), [[2, 3]], JSON.stringify(result.layout.roots));
    const overview = renderOverview(result, { uncovered: 0 });
    assert.match(overview, new RegExp(`^- tests: 2 ${runner}.*; 2 of 3 `, "m"), overview);
  });
}

test("rust: a scan counts a file that holds its own tests apart, and only what cargo collects as test files", async (t) => {
  const inline = (s) => `pub fn ${s}() -> i64 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn runs() {\n        assert_eq!(${s}(), 1);\n    }\n}\n`;
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["cart", "order"]) write(`src/${s}.rs`, inline(s));
    write("src/price.rs", "pub fn price() -> i64 {\n    1\n}\n");
    write("tests/checkout.rs", "#[test]\nfn pays() {}\n");
    write("tests/refund.rs", "#[test]\nfn refunds() {}\n");
    write("tests/util.rs", "pub fn setup() {}\n");
    write("tests/common/mod.rs", "pub fn setup() {}\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  assert.deepEqual(result.layout.tests.map((g) => [g.runner, g.files]), [["cargo test", 3]]);
  const overview = renderOverview(result, { uncovered: 0 });
  assert.match(overview, /^- tests: 3 cargo test.*; 0 of 1 .*; 2 hold their own tests$/m, overview);
});

test("a row that leaves test files out leaves out every file the kinds line of its area calls a test", async (t) => {
  const undocumented = (n) => Array.from({ length: n }, (_, i) => `pub fn helper${i}() {}\n`).join("\n");
  const dir = repo(t, (d, { git, write }) => {
    write("Cargo.toml", '[package]\nname = "shop"\n');
    for (let i = 0; i < 6; i++) write(`src/m${i}.rs`, `/// Runs.\npub fn run${i}() {}\n`);
    // cargo builds each of these as a test target, a case in it or none.
    for (let i = 0; i < 3; i++) write(`tests/cased${i}.rs`, `#[test]\nfn works() {}\n\n${undocumented(2)}`);
    for (let i = 0; i < 3; i++) write(`tests/bare${i}.rs`, undocumented(2));
    // A `tests` directory in no crate is a directory, and what it holds is source.
    for (let i = 0; i < 6; i++) write(`notes/tests/n${i}.rs`, undocumented(1));
    for (let i = 0; i < 5; i++) write(`py/tests/test_m${i}.py`, `def test_m${i}():\n    pass\n`);
    write("py/tests/conftest.py", "import pytest\n\n\n@pytest.fixture\ndef client():\n    return 1\n\n\ndef make_app():\n    return 1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  assert.deepEqual(Object.fromEntries(result.layout.tests.map((g) => [g.runner, g.files])), { "cargo test": 6, pytest: 6 });
  // An area none of whose files holds a site of any row is not written.
  const counted = Object.fromEntries(result.areas.map((a) => [a.path, a.dimensions.map((d) => [d.key, d.candidates])]));
  assert.deepEqual(counted, { "notes/tests": [["public_doc_comment", 6]], src: [["public_doc_comment", 6]] });
});

test("python: a package is asked for a test of its directory's name, since its __init__ is the package", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["cart", "order", "price"]) write(`src/shop/${s}.py`, `def ${s}():\n    return 1\n`);
    for (const s of ["__init__", "tag", "provider"]) write(`src/shop/json/${s}.py`, `def ${s.replace(/_/g, "") || "x"}():\n    return 1\n`);
    for (const s of ["cart", "order", "json"]) write(`tests/test_${s}.py`, `def test_${s}():\n    assert True\n`);
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  const [shop] = result.layout.roots.filter((r) => r.companions);
  assert.deepEqual([shop.path, shop.companions.with, shop.companions.of, shop.companions.root], ["src/shop", 3, 6, "tests"]);
  // The package's own directory, counted as an area, credits the same file and no other.
  const json = result.areas.find((a) => a.path === "src/shop/json");
  assert.deepEqual([json.kinds.companions.with, json.kinds.companions.of], [1, 3]);
});

test("java: a test paired with the class of its own module answers no class of that name in another", async (t) => {
  const cls = (name) => `package com.x;\n\npublic class ${name} {\n}\n`;
  const spec = (name) => `package com.x;\n\nimport org.junit.jupiter.api.Test;\n\nclass ${name}Test {\n    @Test\n    void runs() {}\n}\n`;
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["Foo", "A", "B"]) write(`mod-a/src/main/java/com/x/${s}.java`, cls(s));
    for (const s of ["Foo", "C", "D"]) write(`mod-b/src/main/java/com/x/${s}.java`, cls(s));
    for (const s of ["Foo", "A", "B"]) write(`mod-a/src/test/java/com/x/${s}Test.java`, spec(s));
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  const counted = Object.fromEntries(result.layout.roots.filter((r) => r.companions).map((r) => [r.path, [r.companions.with, r.companions.of]]));
  assert.deepEqual(counted, { "mod-a/src/main/java/com/x": [3, 3], "mod-b/src/main/java/com/x": [0, 3] });
});

test("php: a component that keeps a Tests directory beside its classes is counted as tested by it", async (t) => {
  const cls = (ns, name) => `<?php\n\nnamespace ${ns};\n\nclass ${name}\n{\n}\n`;
  const spec = (ns, name) => `<?php\n\nnamespace ${ns}\\Tests;\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass ${name}Test extends TestCase\n{\n    public function testRuns(): void\n    {\n    }\n}\n`;
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["Item", "Pool", "Lock"]) write(`src/Component/Cache/${s}.php`, cls("S\\Cache", s));
    for (const s of ["Item", "Pool"]) write(`src/Component/Cache/Tests/${s}Test.php`, spec("S\\Cache", s));
    // The same class name in another component, with no test of its own.
    for (const s of ["Item", "Queue", "Worker"]) write(`src/Component/Messenger/${s}.php`, cls("S\\Messenger", s));
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  assert.deepEqual(result.layout.tests.map((g) => [g.runner, g.files]), [["phpunit", 2]]);
  // Two of the six, and not three: `Messenger/Item.php` is not credited with the test of `Cache/Item.php`.
  const [component] = result.layout.roots;
  assert.deepEqual([component.path, component.companions.with, component.companions.of, component.companions.root], ["src/Component", 2, 6, "src/Component/Cache/Tests"]);
});

test("csharp: a test project named in the singular is paired with the project its name carries", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["Cart", "Order", "Price"]) write(`src/Shop/${s}.cs`, `namespace Shop;\n\npublic class ${s}\n{\n}\n`);
    for (const s of ["Cart", "Order"]) write(`test/Shop.Test/Sub/${s}Tests.cs`, `namespace Shop.Test;\n\npublic class ${s}Tests\n{\n    [Fact]\n    public void Runs() {}\n}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  const companions = result.layout.roots.map((r) => r.companions).filter(Boolean);
  assert.deepEqual(companions.map((c) => [c.with, c.of]), [[2, 3]], JSON.stringify(result.layout.roots));
});

test("a Go test beside a Python file of its stem is no test of the Python file", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    for (const s of ["cart", "order", "price"]) write(`shop/${s}.py`, `def ${s}():\n    return 1\n`);
    write("shop/cart_test.go", 'package shop\n\nimport "testing"\n\nfunc TestCart(t *testing.T) {\n}\n');
    write("shop/order_test.go", 'package shop\n\nimport "testing"\n\nfunc TestOrder(t *testing.T) {\n}\n');
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  const result = await scan(dir);
  const [shop] = result.layout.roots;
  assert.deepEqual([shop.companions.with, shop.companions.of, shop.companions.ext], [0, 3, ".py"]);
});
