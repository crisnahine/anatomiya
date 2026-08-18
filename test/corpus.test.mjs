import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute, sep } from "node:path";
import { execFileSync } from "node:child_process";

import { collect, countUntrackedSource, isDenied, isExcludedDir, isGeneratedFile, isSource, safeResolve, gitRoot, frameworksIn } from "../lib/corpus.mjs";
import { language } from "../lib/langs.mjs";
import * as areaLib from "../lib/areas.mjs";

const { discover, globEntry, globText, assertGlobSafe, areaId, AREA } = areaLib;

// The two halves the area record carries, composed the way the renderer does.
const glob = (dir, langs) => globText(globEntry(dir, langs));

/** A temp directory removed by the runner, so a failed assertion still cleans up. */
function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function repo(t, build = () => {}) {
  const dir = tmp(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  build(dir, { git, write, mkdir });
  return dir;

  function write(rel, body = "export const x = 1\n") {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  function mkdir(rel) {
    mkdirSync(join(dir, rel), { recursive: true });
  }
}

/** Files as `discover` wants them, one per generated path. */
function fakeFiles(paths, lang = "js") {
  return paths.map((rel) => ({ rel, lang }));
}

test("corpus takes tracked source files only", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    write("src/b.ts");
    write("untracked.ts");
    write("README.md", "# hi\n");
    git("add", "src", "README.md");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);
  const rels = files.map((f) => f.rel).sort();

  assert.deepEqual(rels, ["src/a.ts", "src/b.ts"]);
  assert.equal(dropped.notSource, 1, "the tracked README is counted, not silently gone");
});

test("collect lists non-source tracked files as others", async (t) => {
  const dir = repo(t, (d, { write, git }) => {
    write("src/a.ts"); write("README.md", "# r\n"); write("docs/x.md", "x\n"); write("node_modules/y.md", "y\n");
    git("add", "-A"); git("commit", "-qm", "init");
  });
  const { files, others } = await collect(dir);
  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
  assert.deepEqual(others.map((f) => f.rel).sort(), ["README.md", "docs/x.md"]);
});

test("a tracked .env contributes nothing even though git lists it", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    write(".env", "AWS_SECRET=leak\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
  assert.equal(dropped.denied, 1, "denied is a count beside the other three, not a flag");
});

test("a tracked symlink pointing outside the repository is dropped", async (t) => {
  const outside = tmp(t);
  writeFileSync(join(outside, "secret.ts"), "export const KEY = 'leak'\n");

  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    symlinkSync(join(outside, "secret.ts"), join(d, "src", "linked.ts"));
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
  assert.equal(dropped.escaped, 1);
});

test("untracked source is counted by the same rule the corpus is collected by", async (t) => {
  // The number tells the reader to commit these files and scan again, so it has
  // to be a count of files a scan would then read. A symlink out of the
  // repository is one `collect` drops and this must drop too.
  const outside = tmp(t);
  writeFileSync(join(outside, "secret.ts"), "export const KEY = 'leak'\n");

  const dir = repo(t, (d, { write }) => {
    write("src/a.ts");
    write("src/b.ts");
    write("src/notes.md");
    symlinkSync(join(outside, "secret.ts"), join(d, "src", "linked.ts"));
  });

  const { files } = await collect(dir);
  assert.deepEqual(files, [], "nothing is committed, so the corpus is empty");
  assert.equal(await countUntrackedSource(dir), 2, "two readable source files, not the markdown or the escape");
});

test("a filename containing a newline stays one corpus entry", needsPosixPaths, async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    write("src/we\nird.ts");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.equal(files.length, 2, "NUL-split must not turn one hostile name into two");
  assert.ok(files.some((f) => f.rel.includes("\n")));
});

test("a tracked path starting with a dash is collected, not read as an option", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("-rf.ts");
    write("src/--output=x.ts");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel).sort(), ["-rf.ts", "src/--output=x.ts"]);
  assert.ok(files.every((f) => f.abs.startsWith(realpathSync(dir))));
});

test("excluded directories are counted rather than dropped in silence", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    write("node_modules/pkg/index.js");
    write("test/fixtures/weird.ts");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
  assert.equal(dropped.excluded, 2);
});

test("a repository with no commits yields an empty corpus, not an error", async (t) => {
  const dir = repo(t);

  const { files, truncated, dropped } = await collect(dir);

  assert.deepEqual(files, []);
  assert.equal(truncated, false);
  assert.deepEqual(dropped, { denied: 0, excluded: 0, escaped: 0, notSource: 0, generated: 0 });
});

test("staged-but-never-committed files are corpus, because git lists them", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    git("add", "-A");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
});

test("a directory outside any repository fails loudly on both entry points", async (t) => {
  const dir = tmp(t);

  await assert.rejects(() => gitRoot(dir), /not a git repository/);
  await assert.rejects(() => collect(dir), /git ls-files exited/);
});

test("gitRoot returns the top level from a subdirectory", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  // Compared against the root's own answer, not against a path this test spells
  // itself. One directory has several valid spellings on Windows, where git
  // prints the long name and a temporary directory carries the 8.3 form, and
  // asserting one of them tests the platform rather than the function.
  const fromRoot = await gitRoot(dir);
  assert.equal(await gitRoot(join(dir, "src")), fromRoot);
  assert.equal(isAbsolute(fromRoot), true, "callers join against this");
  assert.equal(fromRoot.includes("/") && sep === "\\", false, "and compare it with native separators");
  assert.equal(realpathSync(fromRoot), fromRoot, "already resolved, so no caller has to");
});

test("fixture and vendor directories are excluded", () => {
  assert.equal(isExcludedDir("test/fixtures/weird/a.ts"), true);
  assert.equal(isExcludedDir("src/__fixtures__/a.ts"), true);
  assert.equal(isExcludedDir("node_modules/pkg/a.js"), true);
  assert.equal(isExcludedDir("src/features/billing/a.ts"), false);
  assert.equal(isExcludedDir("src/fixtures-helper/a.ts"), false, "the segment must match whole");
});

test("the other names deliberately unidiomatic code goes by are excluded too", () => {
  // Same code, different directory name. angular keeps 2,010 files of golden
  // compiler output under `test_cases`, which became 55 of its 339 areas and
  // every one of its 476 unparseable files; the map taught an agent the house
  // style of expected output.
  for (const p of [
    "packages/compiler-cli/test/compliance/test_cases/a.js",
    "pkg/testdata/a.ts",
    "pkg/test-data/a.ts",
    "src/golden/a.ts",
    "src/goldens/a.ts",
    "src/__mocks__/fs.js",
    "src/mocks/handlers.ts",
  ]) {
    assert.equal(isExcludedDir(p), true, p);
  }
  // Whole segments only, and `examples` stays in: 8,967 paths in the corpus
  // match it and a good share of them are code someone maintains.
  for (const p of ["src/test_cases_helper/a.ts", "src/mocksmith/a.ts", "examples/basic/a.ts"]) {
    assert.equal(isExcludedDir(p), false, p);
  }
});

test("a repository's own fixture naming is caught by compounding, not just the bare word", () => {
  // webpack: 347 of 393 areas and 3 of 14 stated directives, two contradicting
  // each other on the same dimension, came from `cases`, `configCases`,
  // `statsCases`, `watchCases`, `hotCases`, `benchmarkCases`,
  // `memoryLimitCases` and `typesCases`, none of which matched a whole-segment
  // `cases`. angular's `golden-test` is a hyphenated compound `/goldens?/`
  // does not reach. prisma's `_fixture` is singular and underscore-prefixed
  // (309 source files); diaspora's `jasmine_fixtures` is the same shape the
  // other way round. next.js spells two of its fixture trees singular with no
  // underscore at all: `tests/fixture`, `tests/snapshot` (75 of 500 areas).
  for (const p of [
    "test/cases/mjs/a.js",
    "test/configCases/foo/a.js",
    "test/statsCases/foo/a.js",
    "test/watchCases/foo/a.js",
    "test/hotCases/foo/a.js",
    "test/benchmarkCases/foo/a.js",
    "test/memoryLimitCases/foo/a.js",
    "test/typesCases/foo/a.js",
    "packages/core/schematics/migrations/signal-migration/test/golden-test/a.ts",
    "prisma/relation-mode-gh-1-to-n/_fixture/contract.d.ts",
    "spec/controllers/jasmine_fixtures/a.rb",
    "tests/fixture/a.ts",
    "tests/snapshot/a.ts",
  ]) {
    assert.equal(isExcludedDir(p), true, p);
  }
});

test("the widened fixture match stops at a real word boundary", () => {
  // A rule that reaches `golden-test` and `configCases` must not also reach a
  // directory a human could plausibly name: `use-cases` and `showcases` are
  // real compounds already in use, and `spec/data` and `tests/execution` are
  // common enough words that excluding them bare would cost more real
  // directories than the fixture trees it would catch. chef's own `spec/data`
  // (8 of 70 areas) and next.js's `tests/execution` are the measured leaks
  // this rule still does not reach.
  for (const p of [
    "docs/use-cases/a.ts",
    "src/showcases/a.ts",
    "spec/data/a.rb",
    "tests/execution/a.ts",
  ]) {
    assert.equal(isExcludedDir(p), false, p);
  }
});

test("a build/ nested under a repository's own source shell is not compiled output", () => {
  // turbopack-cli/src/build/mod.rs is real Rust source: the bare-word match on
  // `build` swallowed it, harmless there only because Rust is not parsed. A
  // hand-written module named for the "build" verb has to survive this rule
  // wherever the language it is written in is one this tool does read.
  assert.equal(isExcludedDir("turbopack-cli/src/build/mod.rs"), false);
  assert.equal(isExcludedDir("packages/cli/src/build/index.ts"), false);
  // Compiled output at a package root, or nested one directory into a
  // monorepo package, is unaffected: neither sits under a source shell.
  assert.equal(isExcludedDir("build/index.js"), true);
  assert.equal(isExcludedDir("packages/app/build/index.js"), true);
});

test("deny-list covers credential-shaped paths", () => {
  for (const p of [".env", "config/.env.production", "certs/server.pem", "id_rsa",
                   ".claude/settings.local.json", ".git/config"]) {
    assert.equal(isDenied(p), true, p);
  }
  assert.equal(isDenied("src/environment.ts"), false);
  assert.equal(isDenied("src/envelope/key.ts"), false, "a .ts is not a private key");
});

test("safeResolve refuses traversal", (t) => {
  const dir = tmp(t);
  assert.equal(safeResolve(dir, "../../etc/passwd"), null);
  assert.equal(safeResolve(dir, "ok.ts"), null); // missing file fails closed
});

test("safeResolve returns the resolved path, so the caller reads what was checked", (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export const x = 1\n");
  symlinkSync(join(dir, "src", "a.ts"), join(dir, "src", "link.ts"));

  assert.equal(safeResolve(dir, "src/a.ts"), join(realpathSync(dir), "src", "a.ts"));
  assert.equal(safeResolve(dir, "src/link.ts"), join(realpathSync(dir), "src", "a.ts"));
});

test("language is derived from the extension", () => {
  assert.equal(language("a.rb"), "ruby");
  assert.equal(language("a.rake"), "ruby");
  assert.equal(language("a.tsx"), "jsx");
  assert.equal(language("a.jsx"), "jsx");
  assert.equal(language("a.ts"), "js");
  assert.equal(language("a.mjs"), "js");
  assert.equal(language("a.cjs"), "js");
});

test("isSource takes what the two parsers can read, and nothing else", () => {
  for (const p of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.rb", "a.rake"]) {
    assert.equal(isSource(p), true, p);
  }
  // TypeScript's module extensions. oxc reads both today, `import = require`
  // included, and the corpus held 346 of them with nothing counting any.
  for (const p of ["a.mts", "a.cts", "src/deep/b.mts"]) {
    assert.equal(isSource(p), true, p);
  }
  // Ruby whose filename does not say so. prism reads all of these with zero
  // errors, and they are the files least likely to be edited by someone who
  // remembers the habit in them.
  for (const p of ["Rakefile", "Gemfile", "config.ru", "a.gemspec", "app/views/x.json.jbuilder"]) {
    assert.equal(isSource(p), true, p);
  }
  for (const p of ["lib/Rakefile", "sub/Gemfile", "sub/config.ru"]) {
    assert.equal(isSource(p), true, `${p} is the same file one directory down`);
  }
  for (const p of ["a.md", "a.json", "a.ts.snap", "Gemfile.lock", "Rakefile.md", "config.ruby"]) {
    assert.equal(isSource(p), false, p);
  }
  // Sorbet signatures describe types, not what anyone wrote. 318 in the corpus,
  // and a claim counted over them speaks for no code.
  assert.equal(isSource("a.rbi"), false, "a.rbi");
});

test("the filename that carries no extension still names its language", () => {
  for (const p of ["Rakefile", "Gemfile", "config.ru", "a.gemspec", "app/views/x.json.jbuilder"]) {
    assert.equal(language(p), "ruby", p);
  }
  assert.equal(language("a.mts"), "js");
  assert.equal(language("a.cts"), "js");
});

// --- areas ---

test("no generated glob ends in a bare /**", () => {
  const areas = discover(fakeFiles(
    Array.from({ length: 6 }, (_, i) => `app/services/s${i}.rb`), "ruby"));

  assert.equal(areas.length, 1);
  for (const a of areas) for (const g of a.globs) assert.doesNotThrow(() => assertGlobSafe(g));
  assert.deepEqual(areas[0].globs.map((g) => areaLib.globText(g)), [
    "app/services/**/*.{gemspec,jbuilder,rake,rb}",
  ]);
  assert.throws(() => assertGlobSafe({ negated: false, dir: "app", tail: "**" }), /bare \/\*\*/);
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The matcher's semantics: `*` stops at a slash, a `**` segment spans any depth including none. */
function toRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:[^/]*/)*";
      i += 2;
    } else if (pattern[i] === "*") {
      out += "[^/]*";
    } else if (pattern[i] === "{") {
      const end = pattern.indexOf("}", i);
      out += `(?:${pattern.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
      i = end;
    } else {
      out += escapeRe(pattern[i]);
    }
  }
  return new RegExp(`${out}$`);
}

/** Which of `globs` a path ends up matching: negations included, last match winning. */
function matches(globs, rel) {
  let hit = false;
  for (const g of globs) {
    // The area record carries the halves apart; the matcher reads the pattern
    // the delivery channel would.
    if (toRegExp(areaLib.globText({ ...g, negated: false })).test(rel)) hit = !g.negated;
  }
  return hit;
}

test("an area's globs match the files it counted and no others", () => {
  // The bug: `lib/core/**/*` matched `lib/core/deep`, whose own area measured
  // the same dimension over its own files and was suppressed by a gate. The
  // ancestor's directive reached the directory that failed the gate.
  const files = fakeFiles([
    ...Array.from({ length: 5 }, (_, i) => `lib/core/c${i}.js`),
    ...Array.from({ length: 5 }, (_, i) => `lib/core/deep/d${i}.js`),
  ]);
  const areas = discover(files);
  const byPath = new Map(areas.map((a) => [a.path, a]));

  assert.deepEqual([...byPath.keys()].sort(), ["lib/core", "lib/core/deep"]);
  for (const a of areas) {
    const mine = new Set(a.files.map((f) => f.rel));
    for (const f of files) {
      assert.equal(matches(a.globs, f.rel), mine.has(f.rel), `${a.path} vs ${f.rel}`);
    }
  }
});

test("an area's globs reach every shape it counted, extension or not", () => {
  // The rule #4 established: an area's paths matches the files its counts were
  // taken over. A brace of extensions cannot spell `Rakefile`, so admitting a
  // file with no extension has to widen the glob or the file is counted and
  // never delivered, which is the same defect arriving from the other side.
  const ruby = [
    ...Array.from({ length: 5 }, (_, i) => ({ rel: `lib/tasks/t${i}.rake`, lang: "ruby" })),
    { rel: "lib/tasks/Rakefile", lang: "ruby" },
    { rel: "lib/tasks/Gemfile", lang: "ruby" },
  ];
  const rubyAreas = discover(ruby);
  assert.equal(rubyAreas.length, 1);
  for (const f of ruby) assert.equal(matches(rubyAreas[0].globs, f.rel), true, f.rel);

  const js = [
    ...Array.from({ length: 5 }, (_, i) => ({ rel: `src/lib/m${i}.ts`, lang: "js" })),
    { rel: "src/lib/entry.mts", lang: "js" },
    { rel: "src/lib/legacy.cts", lang: "js" },
  ];
  const jsAreas = discover(js);
  assert.equal(jsAreas.length, 1);
  for (const f of js) assert.equal(matches(jsAreas[0].globs, f.rel), true, f.rel);

  for (const a of [...rubyAreas, ...jsAreas]) {
    for (const g of a.globs) assert.doesNotThrow(() => assertGlobSafe(g), g);
  }
});

test("an area holding its whole subtree still emits one recursive glob", () => {
  const areas = discover(fakeFiles([
    ...Array.from({ length: 5 }, (_, i) => `lib/core/c${i}.js`),
    ...Array.from({ length: 2 }, (_, i) => `lib/core/deep/d${i}.js`),
  ]));

  assert.equal(areas.length, 1);
  assert.deepEqual(areas[0].globs.map((g) => areaLib.globText(g)), [
    "lib/core/**/*.{cjs,cts,js,mjs,mts,ts}",
  ]);
});

test("an area with many owned directories and few foreign ones states the foreign ones", () => {
  // 20 directories the area holds, one that became its own area. Twenty
  // patterns to name what it owns, two to cut out what it does not.
  const files = fakeFiles([
    ...Array.from({ length: 20 }, (_, i) => `app/svc/d${i}/a.js`),
    ...Array.from({ length: 8 }, (_, i) => `app/svc/own/o${i}.js`),
  ]);
  const areas = discover(files, { minFiles: 3 });
  const parent = areas.find((a) => a.path === "app/svc");

  assert.ok(areas.some((a) => a.path === "app/svc/own"), "the deeper directory is its own area");
  assert.deepEqual(parent.globs.map((g) => areaLib.globText(g)), [
    "app/svc/**/*.{cjs,cts,js,mjs,mts,ts}",
    "!app/svc/own/**/*.{cjs,cts,js,mjs,mts,ts}",
  ]);
  assert.equal(matches(parent.globs, "app/svc/own/o1.js"), false);
  assert.equal(matches(parent.globs, "app/svc/d3/a.js"), true);
});

test("a negation never ends in a bare /**, which the matcher would strip", () => {
  const areas = discover(fakeFiles([
    ...Array.from({ length: 20 }, (_, i) => `app/svc/d${i}/a.js`),
    ...Array.from({ length: 8 }, (_, i) => `app/svc/own/o${i}.js`),
  ]), { minFiles: 3 });

  for (const a of areas) {
    for (const g of a.globs) assert.doesNotThrow(() => assertGlobSafe(g), g);
  }
});

test("a file no area holds receives no area's globs", () => {
  // `app/svc` clears the floor on its subtree, but its own remainder does not,
  // so those two files are uncovered. An ancestor glob used to deliver to them.
  const files = fakeFiles([
    ...Array.from({ length: 2 }, (_, i) => `app/svc/loose${i}.js`),
    ...Array.from({ length: 8 }, (_, i) => `app/svc/own/o${i}.js`),
  ]);
  const areas = discover(files, { minFiles: 3 });

  assert.deepEqual(areas.map((a) => a.path), ["app/svc/own"]);
  assert.equal(areas.orphaned.length, 2);
  for (const a of areas) assert.equal(matches(a.globs, "app/svc/loose0.js"), false);
});

test("an area the ceiling synthesized delivers to nothing it left uncovered", () => {
  // `capCount` creates a host area at a directory whose own bucket was already
  // orphaned, so the host holds files under that directory and none in it. A
  // recursive glob from there reaches the orphans, which is the nesting bug
  // arriving by a second route.
  const files = fakeFiles([
    "lib/loose0.js", "lib/loose1.js",
    ...Array.from({ length: 4 }, (_, i) => `lib/a/x${i}.js`),
    ...Array.from({ length: 4 }, (_, i) => `lib/b/y${i}.js`),
    ...Array.from({ length: 4 }, (_, i) => `src/c/z${i}.js`),
  ]);
  const areas = discover(files, { minFiles: 3, maxAreas: 2 });
  const host = areas.find((a) => a.path === "lib");

  assert.equal(host.fileCount, 8, "the host holds the two subdirectories and neither loose file");
  assert.deepEqual(areas.orphaned.map((f) => f.rel), ["lib/loose0.js", "lib/loose1.js"]);
  for (const f of areas.orphaned) {
    for (const a of areas) assert.equal(matches(a.globs, f.rel), false, `${a.path} <- ${f.rel}`);
  }
});

test("a directory below the floor folds into its parent", () => {
  const areas = discover(fakeFiles([
    ...Array.from({ length: 5 }, (_, i) => `src/lib/a${i}.ts`),
    ...Array.from({ length: 2 }, (_, i) => `src/lib/tiny/b${i}.ts`),
  ]));

  assert.equal(areas.length, 1);
  assert.equal(areas[0].path, "src/lib");
  assert.equal(areas[0].fileCount, 7, "the folded files must still be counted");
  assert.deepEqual(areas.orphaned, []);
});

test("a directory the old root table would have missed still becomes an area", () => {
  const areas = discover(fakeFiles(
    Array.from({ length: 8 }, (_, i) => `scripts/hooks/h${i}.mjs`)));

  assert.equal(areas.length, 1);
  assert.equal(areas[0].path, "scripts/hooks");
});

test("a parent left below the floor by its own subtree is uncovered, not an area", () => {
  const areas = discover(fakeFiles([
    ...Array.from({ length: 10 }, (_, i) => `app/big/a${i}.ts`),
    ...Array.from({ length: 2 }, (_, i) => `app/b${i}.ts`),
  ]));

  assert.deepEqual(areas.map((a) => a.path), ["app/big"]);
  assert.deepEqual(areas.orphaned.map((f) => f.rel).sort(), ["app/b0.ts", "app/b1.ts"]);
});

test("files at the repository root never form an area", () => {
  const areas = discover(fakeFiles(
    Array.from({ length: 9 }, (_, i) => `r${i}.ts`)));

  assert.deepEqual(areas.map((a) => a.path), []);
  assert.equal(areas.orphaned.length, 9, "a root glob would render every claim over every area");
});

test("an empty corpus discovers nothing and still carries an orphan list", () => {
  const areas = discover([]);

  assert.equal(areas.length, 0);
  assert.deepEqual(areas.orphaned, []);
});

test("the area cap holds and folding loses no file", () => {
  const minFiles = 5;
  const maxAreas = 120;
  const dirs = maxAreas + 2;
  const paths = [
    ...Array.from({ length: 6 }, (_, i) => `src/top${i}.ts`),
    ...Array.from({ length: dirs }, (_, d) =>
      Array.from({ length: minFiles }, (_, i) => `src/d${d}/f${i}.ts`)).flat(),
  ];
  const areas = discover(fakeFiles(paths), { minFiles, maxAreas });

  assert.equal(areas.length, maxAreas);
  const kept = areas.reduce((n, a) => n + a.fileCount, 0);
  assert.equal(kept + areas.orphaned.length, paths.length, "every file is in an area or uncovered");
  for (const a of areas) assert.equal(a.fileCount, a.files.length);
});

test("directories with no area above them fold into their parent, not into nothing", () => {
  // A directory holding only subdirectories is never itself an area, so the
  // walk to a host used to reach the repository root and drop the files. On a
  // 100,000-file repository that orphaned 76,000 of them; the parent directory
  // is a real scope and folding into it is what covers a large tree.
  const minFiles = 5;
  const maxAreas = 120;
  const dirs = maxAreas + 40;
  const paths = Array.from({ length: dirs }, (_, d) =>
    Array.from({ length: minFiles }, (_, i) => `src/mod${d}/f${i}.ts`)).flat();

  const areas = discover(fakeFiles(paths), { minFiles, maxAreas });

  assert.deepEqual(areas.orphaned, [], "nothing sits at the root with a home one level up");
  assert.ok(areas.length <= maxAreas, `${areas.length} areas exceeds the ceiling`);
  assert.equal(
    areas.reduce((n, a) => n + a.fileCount, 0),
    paths.length,
    "every file is still counted exactly once"
  );
  assert.ok(areas.some((a) => a.path === "src"), "the created host is the real parent directory");
});

test("a file whose only home would be the repository root is uncovered, not bucketed", () => {
  // The rule the fold above must not break: a root area is everything that
  // failed to find a home, and a claim over it describes no code anyone owns.
  const minFiles = 5;
  const maxAreas = 120;
  const paths = [
    ...Array.from({ length: maxAreas + 2 }, (_, d) =>
      Array.from({ length: minFiles }, (_, i) => `top${d}/f${i}.ts`)).flat(),
  ];

  const areas = discover(fakeFiles(paths), { minFiles, maxAreas });

  assert.ok(!areas.some((a) => a.path === "."), "no root bucket");
  assert.equal(
    areas.reduce((n, a) => n + a.fileCount, 0) + areas.orphaned.length,
    paths.length,
    "every file is in an area or reported uncovered"
  );
});

test("the area floor rises with the corpus, stops at eight, and never falls below three", () => {
  // A fixed 5 gives a measured 2,468-file repository 209 areas of median 7
  // files and 1.61 stated claims for the file being edited, against 127 areas
  // of median 11 and 1.81 at a floor of 8. A fixed 8 leaves a 12-file
  // repository with no area at all and every one of its files uncovered.
  assert.deepEqual(
    [12, 15, 224, 467, 2024, 2025, 2468, 5477, 100000].map((n) => areaLib.areaFloor(n)),
    [3, 3, 3, 4, 7, 8, 8, 8, 8]
  );
});

test("the area ceiling never binds before the size floor", () => {
  // The ceiling is a budget backstop reading "the average area holds at least
  // 16 files", not a size rule. Where it binds first, "fold the smallest until
  // the count fits" replaces the floor: measured cost of the fixed 120 at the
  // same floor is 194 stated claims against 220 on the TypeScript repository
  // and 60 against 81 on the Ruby one.
  assert.equal(areaLib.areaCeiling(467), 120);
  assert.equal(areaLib.areaCeiling(2468), 155);
  assert.equal(areaLib.areaCeiling(5477), 343);
  assert.equal(areaLib.areaCeiling(100000), 500);

  const dirs = 120;
  const paths = Array.from({ length: dirs }, (_, d) =>
    Array.from({ length: 20 }, (_, i) => `src/mod${d}/f${i}.ts`)).flat();
  const found = discover(fakeFiles(paths));

  assert.ok(dirs < areaLib.areaCeiling(paths.length), "the corpus must be under its own ceiling");
  assert.equal(found.length, dirs);
  assert.deepEqual(found.orphaned, []);
  assert.ok(found.every((a) => a.path.startsWith("src/mod")), "no area was folded into a host");
});

test("the area layout is taken from the pin, so a corpus crossing a floor boundary keeps its areas", () => {
  // The floor is a step function with boundaries at 441, 729, 1089, 1521 and
  // 2025 files, so one added file re-partitions the repository, changing area
  // ids and the filenames under .claude/rules. Re-scanning against a layout the
  // pin did not know suppressed 914 of 1,677 measured slots as
  // population-change and dropped stated claims from 277 to 143.
  assert.equal(areaLib.areaFloor(2024), 7);
  assert.equal(areaLib.areaFloor(2025), 8);

  const paths = [
    ...Array.from({ length: 2018 }, (_, i) => `src/big/f${i}.ts`),
    ...Array.from({ length: 7 }, (_, i) => `src/small/f${i}.ts`),
  ];

  const pinned = discover(fakeFiles(paths), { minFiles: areaLib.areaFloor(2024) });
  assert.deepEqual(pinned.map((a) => a.path).sort(), ["src/big", "src/small"]);

  const today = discover(fakeFiles(paths));
  assert.deepEqual(today.map((a) => a.path), ["src/big"],
    "today's own corpus size folds the seven-file directory away");
});

test("the area table holds only numbers something reads", () => {
  assert.deepEqual(AREA.floor, [3, 8]);
  assert.equal(AREA.floorDivisor, 6);
  assert.deepEqual(AREA.ceiling, [120, 500]);
  assert.equal(AREA.filesPerArea, 16);
  // Discovery splits at every directory that clears the floor, unconditionally,
  // so the rule this named was already the default and nothing ever read it. An
  // unused number in an exported table reads as a live rule and gets cited.
  assert.equal(AREA.splitAbove, undefined);
  assert.equal(AREA.minFiles, undefined, "the floor is a function of the corpus now");
  assert.equal(AREA.maxAreas, undefined, "the ceiling is a function of the corpus now");
});

test("area ids are stable hashes of the path", () => {
  assert.equal(areaId("app/services"), areaId("app/services"));
  assert.notEqual(areaId("app/services"), areaId("app/models"));
  assert.match(areaId("app/services"), /^[0-9a-f]{8}$/);
});

test("mixed languages produce a brace-expanded extension list", () => {
  assert.equal(glob("src", ["js", "jsx"]), "src/**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}");
  assert.equal(glob("src", ["jsx"]), "src/**/*.{jsx,tsx}");
  assert.equal(glob(".", ["ruby"]), "**/*.{gemspec,jbuilder,rake,rb}");
});

test("a glob over no known language throws instead of matching nothing", () => {
  assert.throws(() => glob("src", ["python"]), /no known extensions/);
  assert.throws(() => glob("src", []), /no known extensions/);
});

test("the frameworks a repository uses are read from its own corpus", () => {
  // Measured across 19 Ruby repositories: app/models, db/migrate or
  // config/application.rb separates 14 Rails from 5 plain with no error. It has
  // to be the corpus and not `git ls-files`: rubocop's only app/models files
  // are three fixtures under spec/fixtures, which the corpus already drops, and
  // reading the raw list calls rubocop a Rails application.
  const rails = frameworksIn(fakeFiles(["app/models/user.rb", "lib/x.rb"], "ruby"));
  assert.deepEqual([...rails], ["rails"]);

  assert.deepEqual([...frameworksIn(fakeFiles(["db/migrate/1_x.rb"], "ruby"))], ["rails"]);
  assert.deepEqual([...frameworksIn(fakeFiles(["config/application.rb"], "ruby"))], ["rails"]);
  // An engine keeps the same shape one directory down, which is decidim, the
  // one repository config/application.rb alone gets wrong.
  assert.deepEqual([...frameworksIn(fakeFiles(["decidim-core/app/models/a.rb"], "ruby"))], ["rails"]);

  assert.deepEqual([...frameworksIn(fakeFiles(["lib/tool.rb", "spec/tool_spec.rb"], "ruby"))], []);
  assert.deepEqual([...frameworksIn(fakeFiles(["src/app.ts"], "js"))], [], "a JS repository has no Rails");
  assert.deepEqual([...frameworksIn([])], []);
});

test("the deepest area containing a path is the one whose claims it carries", () => {
  // Nested areas both contain the file, and only the deepest one measured it.
  // The rule lived twice, in the check's finding attribution and in the
  // baseline's drift count, so a fix to one left the other reporting drift
  // against an ancestor.
  const paths = ["app", "app/models", "lib"];

  assert.equal(areaLib.areaOwner("app/models/user.rb", paths), "app/models");
  assert.equal(areaLib.areaOwner("app/jobs/mail.rb", paths), "app");
  assert.equal(areaLib.areaOwner("bin/run.rb", paths), null);
});

test("a sibling sharing a name prefix does not own the path", () => {
  // "app/model" is a prefix of "app/models/user.rb" as a string and contains
  // none of it as a directory. Testing the prefix without the separator hands
  // the file to a directory it was never counted in.
  assert.equal(areaLib.areaOwner("app/models/user.rb", ["app/model"]), null);
});

test("the repository root owns a path only when nothing deeper does", () => {
  // "." contains every path without being a prefix of any of them, and it is
  // the least specific answer there is.
  assert.equal(areaLib.areaOwner("lib/a.ts", [".", "lib"]), "lib");
  assert.equal(areaLib.areaOwner("a.ts", ["."]), ".");
});

test("an area carries its globs as structure, so nothing has to read the pattern back", () => {
  // The cover entries were built structured and flattened to strings, and the
  // renderer then recovered the halves with a regex it kept its own copy of.
  // One grammar, two modules, and the regex knew only the extension form: a
  // bare name from A12 fell through to the path encoder, which strips a leading
  // `**` as a markdown bullet and leaves `/Rakefile`.
  const areas = areaLib.discover(fakeFiles(
    Array.from({ length: 6 }, (_, i) => `app/services/s${i}.rb`), "ruby"));

  assert.deepEqual(areas[0].globs, [
    { negated: false, dir: "app/services", tail: "**/*.{gemspec,jbuilder,rake,rb}" },
  ]);
});

test("a bare name the extension brace cannot spell is its own entry, with its own tail", () => {
  // A12. The tail is what a renderer must not encode, and here it carries no
  // `*.` at all, which is the shape the regex missed.
  const files = [
    ...fakeFiles(Array.from({ length: 5 }, (_, i) => `lib/tasks/t${i}.rake`), "ruby"),
    ...fakeFiles(["lib/tasks/Rakefile"], "ruby"),
  ];

  const areas = areaLib.discover(files);

  assert.deepEqual(areas[0].globs.map((g) => g.tail).sort(), [
    "**/*.{gemspec,jbuilder,rake,rb}",
    "**/Rakefile",
  ]);
});

test("a directory whose name is glob syntax never becomes an area root", () => {
  // A path is repository-controlled (F4), and a directory may legally be called
  // `**`. Spelled into a pattern it stops naming that directory: as a glob it
  // over-reaches to the whole tree, and encoded it loses the leading `*` run to
  // the markdown bullet rule and matches nothing. Neither is deliverable, so
  // the files fold into an ancestor whose name can be spelled, where the
  // recursive tail still reaches them.
  const files = [
    ...fakeFiles(Array.from({ length: 4 }, (_, i) => `app/a${i}.ts`)),
    ...fakeFiles(Array.from({ length: 6 }, (_, i) => `app/**/s${i}.ts`)),
  ];

  const areas = areaLib.discover(files);

  assert.deepEqual(areas.map((a) => a.path), ["app"], "the glob-shaped directory hosts nothing");
  for (const g of areas[0].globs) assert.ok(!g.dir.includes("*"), `dir is spellable: ${g.dir}`);
  assert.equal(matches(areas[0].globs, "app/**/s0.ts"), true, "and its files are still covered");
});

test("no emitted pattern begins with a bare separator", () => {
  // What a lost leading `*` run leaves behind. It reads like a working absolute
  // path and matches nothing.
  const files = [
    ...fakeFiles(Array.from({ length: 4 }, (_, i) => `app/a${i}.ts`)),
    ...fakeFiles(Array.from({ length: 6 }, (_, i) => `app/**/s${i}.ts`)),
  ];

  for (const a of areaLib.discover(files)) {
    for (const g of a.globs) assert.ok(!areaLib.globText(g).replace(/^!/, "").startsWith("/"), areaLib.globText(g));
  }
});

test("no cover entry names a directory a pattern cannot spell", () => {
  // The fold keeps a glob-shaped directory from rooting an area, but an area
  // above it still has to describe the subtree it holds. Naming it there puts
  // the same unspellable segment into the pattern by the other route.
  const files = [
    ...fakeFiles(Array.from({ length: 4 }, (_, i) => `app/a${i}.ts`)),
    ...fakeFiles(Array.from({ length: 4 }, (_, i) => `app/**/s${i}.ts`)),
    ...fakeFiles(Array.from({ length: 8 }, (_, i) => `app/deep/d${i}.ts`)),
  ];

  const areas = areaLib.discover(files);

  for (const a of areas) {
    for (const g of a.globs) {
      assert.ok(!/[*?[\]{}!]/.test(g.dir), `${a.path} names an unspellable directory: ${g.dir}`);
    }
  }
  const app = areas.find((a) => a.path === "app");
  assert.equal(matches(app.globs, "app/**/s0.ts"), true, "and it still covers what it counted");
  assert.equal(matches(app.globs, "app/deep/d0.ts"), false, "without reaching the area below it");
});

test("area discovery does not depend on the order the files arrived in", () => {
  // A5: the overview must be byte-stable across scans of unchanged source, and
  // its listing is this order. `git ls-files` happens to answer sorted today,
  // which is not the same as the map not caring: a filter, a merge or a cache
  // that reorders the corpus would silently rewrite an always-loaded file.
  const files = [];
  for (const d of ["src/api", "src/web", "lib/http", "lib/util", "app/models"]) {
    for (let i = 0; i < 6; i++) files.push({ rel: `${d}/f${i}.ts`, abs: `/r/${d}/f${i}.ts`, lang: "js" });
  }

  const forward = discover(files).map((a) => a.path);
  const backward = discover([...files].reverse()).map((a) => a.path);

  assert.deepEqual(backward, forward);
  assert.deepEqual(forward, [...forward].sort(), "and the order is one a human can predict");
});

test("a yarn directory is vendor, wherever it sits", () => {
  // Measured: 14 files across the 35-repository corpus, every one a
  // machine-generated bundle, and the 2 MB releases sit at the parse timeout
  // boundary, flipping between crashed and rejected across runs, which moves
  // the always-loaded overview (A5).
  assert.equal(isExcludedDir(".yarn/releases/yarn-4.8.1.cjs"), true);
  assert.equal(isExcludedDir("workspaces/ui/.yarn/plugins/plugin-backstage.cjs"), true);
  assert.equal(isExcludedDir("src/yarn-utils/a.ts"), false, "a directory merely named yarn-ish stays");
});

// --- generated code ---

test("a file stamped with a generated-file marker does not enter the corpus", async (t) => {
  // babel's own runtime helpers carry no such marker and still are compiler
  // output (DECISIONS.md has the fuller story); prisma's do, word for word:
  // `// GENERATED FILE - DO NOT EDIT`, on an area of 24 files every one
  // stamped, mined and reported as a 3-author human convention.
  const dir = repo(t, (d, { git, write }) => {
    write("gen/a.ts", "// GENERATED FILE - DO NOT EDIT\nexport const a = 1\n");
    write("gen/b.ts", "export const b = 1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["gen/b.ts"]);
  assert.equal(dropped.generated, 1);
});

test("all three generated markers are read", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("a.ts", "// @generated\nexport const a = 1\n");
    write("b.ts", "// DO NOT EDIT\nexport const b = 1\n");
    write("c.ts", "// Code generated by protoc-gen-go.\nexport const c = 1\n");
    write("d.ts", "export const d = 1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["d.ts"]);
});

test("a marker found only past the head of the file does not count", async (t) => {
  // The read is bounded rather than whole-file: a marker "in the first lines"
  // means the first lines, and a bound protects against a pathological
  // single-line bundle the same way the size cap protects the parser.
  const dir = repo(t, (d, { git, write }) => {
    write("a.ts", `${"x".repeat(5000)}\n// @generated\nexport const a = 1\n`);
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["a.ts"], "the marker sits past the head cap");
});

test("a generated directory contributes nothing while an identical hand-written one does", async (t) => {
  // The fixture-defence gates catch code that looks unusual; generated code
  // looks ordinary. Excluding the marked files one by one is what keeps a
  // wholly-generated directory from ever reaching a stated directive, with no
  // second rule about directories at all.
  const dir = repo(t, (d, { git, write }) => {
    for (let i = 0; i < 6; i++) {
      write(`lib/gen/f${i}.ts`, `// GENERATED FILE - DO NOT EDIT\nexport const f${i} = ${i}\n`);
      write(`lib/hand/f${i}.ts`, `export const f${i} = ${i}\n`);
    }
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);
  const rels = files.map((f) => f.rel);

  assert.deepEqual(rels.filter((r) => r.startsWith("lib/gen/")), []);
  assert.equal(rels.filter((r) => r.startsWith("lib/hand/")).length, 6);
});

test("a path .gitattributes marks linguist-generated is excluded with no marker in the file", async (t) => {
  // next.js vendors ~678 files of byte-for-byte @babel/runtime, carrying no
  // marker of its own: an unmodified copy of somebody else's published
  // package has no reason to say so.
  const dir = repo(t, (d, { git, write }) => {
    write(".gitattributes", "compiled/** linguist-generated\n");
    write("compiled/pkg/index.js", "export const x = 1\n");
    write("src/a.ts", "export const a = 1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
});

test("gitattributes negation, an extension pattern and an unsupported shape are all handled", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write(".gitattributes", [
      "# a comment, and a blank line below",
      "",
      "generated/** linguist-generated",
      "generated/keep.ts -linguist-generated",
      "*.pb.ts linguist-generated",
      "*.txt text", // an unrelated attribute, never linguist-generated
      "libs/*/output/** linguist-generated", // a mid-path wildcard this reader does not expand
    ].join("\n") + "\n");
    write("generated/drop.ts", "export const a = 1\n");
    write("generated/keep.ts", "export const b = 1\n");
    write("proto/thing.pb.ts", "export const c = 1\n");
    write("libs/foo/output/index.ts", "export const e = 1\n");
    write("src/a.ts", "export const d = 1\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel).sort(), [
    "generated/keep.ts",
    "libs/foo/output/index.ts",
    "src/a.ts",
  ]);
});

test("isGeneratedFile answers false rather than throwing on anything but a regular file", (t) => {
  const dir = tmp(t);
  assert.equal(isGeneratedFile(dir), false, "a directory is not a file to read");
  assert.equal(isGeneratedFile(join(dir, "missing.ts")), false, "nothing to open");
});

test("a repository with no .gitattributes reads as having no generated declarations", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
});
