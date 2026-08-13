import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { collect, isDenied, isExcludedDir, isSource, safeResolve, language, gitRoot } from "../lib/corpus.mjs";
import * as areaLib from "../lib/areas.mjs";

const { discover, glob, assertGlobSafe, areaId, AREA } = areaLib;

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

test("a tracked .env contributes nothing even though git lists it", async (t) => {
  const dir = repo(t, (d, { git, write }) => {
    write("src/a.ts");
    write(".env", "AWS_SECRET=leak\n");
    git("add", "-A");
    git("commit", "-qm", "init");
  });

  const { files, dropped } = await collect(dir);

  assert.deepEqual(files.map((f) => f.rel), ["src/a.ts"]);
  assert.equal(dropped.denied, true);
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

test("a filename containing a newline stays one corpus entry", async (t) => {
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
  assert.deepEqual(dropped, { denied: false, excluded: 0, escaped: 0, notSource: 0 });
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

  assert.equal(await gitRoot(join(dir, "src")), realpathSync(dir));
});

test("fixture and vendor directories are excluded", () => {
  assert.equal(isExcludedDir("test/fixtures/weird/a.ts"), true);
  assert.equal(isExcludedDir("src/__fixtures__/a.ts"), true);
  assert.equal(isExcludedDir("node_modules/pkg/a.js"), true);
  assert.equal(isExcludedDir("src/features/billing/a.ts"), false);
  assert.equal(isExcludedDir("src/fixtures-helper/a.ts"), false, "the segment must match whole");
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

test("isSource takes the seven extensions and nothing else", () => {
  for (const p of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs", "a.rb", "a.rake"]) {
    assert.equal(isSource(p), true, p);
  }
  for (const p of ["a.md", "a.json", "a.rbi", "a.ts.snap", "Rakefile"]) {
    assert.equal(isSource(p), false, p);
  }
});

// --- areas ---

test("no generated glob ends in a bare /**", () => {
  const areas = discover(fakeFiles(
    Array.from({ length: 6 }, (_, i) => `app/services/s${i}.rb`), "ruby"));

  assert.equal(areas.length, 1);
  for (const a of areas) assert.doesNotThrow(() => assertGlobSafe(a.glob));
  assert.equal(areas[0].glob, "app/services/**/*.{rake,rb}");
  assert.throws(() => assertGlobSafe("app/**"), /bare \/\*\*/);
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
  assert.equal(glob("src", ["js", "jsx"]), "src/**/*.{cjs,js,jsx,mjs,ts,tsx}");
  assert.equal(glob("src", ["jsx"]), "src/**/*.{jsx,tsx}");
  assert.equal(glob(".", ["ruby"]), "**/*.{rake,rb}");
});

test("a glob over no known language throws instead of matching nothing", () => {
  assert.throws(() => glob("src", ["python"]), /no known extensions/);
  assert.throws(() => glob("src", []), /no known extensions/);
});
