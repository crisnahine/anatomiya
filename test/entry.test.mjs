import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { needsSymlinks } from "./platform.mjs";
import { REL } from "../scripts/plugins.mjs";
import { invokedAs } from "../scripts/entry.mjs";

// Resolved, because `import.meta.url` always is. That is what makes it the
// control the symlinked spelling below is measured against.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("a module that is not the one being run says so", () => {
  // This suite is what node was told to run, so nothing else can claim to be.
  assert.equal(invokedAs(pathToFileURL(join(ROOT, "scripts", "entry.mjs")).href), false);
});

test("the file being run says so", () => {
  assert.equal(invokedAs(pathToFileURL(process.argv[1]).href), true);
});

test("a process with no script at all is running nothing", () => {
  // `node -e` leaves argv[1] unset, and a comparison against it read the
  // execPath as a script.
  const run = spawnSync(
    process.execPath,
    ["-e", `import(${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "entry.mjs")).href)}).then((m) => console.log(String(m.invokedAs(import.meta.url))))`],
    { encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "false");
});

test("a script whose own file has gone is still the file being run", (t) => {
  // `realpathSync` throws on a path that no longer resolves, and a guard that
  // let that through would take down every script that runs while its own
  // directory is being replaced. Both sides fall back to the path as spelled,
  // so the fixture is resolved first: through a link, the two spellings differ
  // and the answer flips, which is a fact about the temp directory rather than
  // about the guard.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-entry-gone-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "gone.mjs");
  writeFileSync(
    script,
    `import { unlinkSync } from "node:fs";
     import { invokedAs } from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "entry.mjs")).href)};
     unlinkSync(${JSON.stringify(script)});
     process.stdout.write(String(invokedAs(import.meta.url)));`,
  );

  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "true", "the file being run is still the file being run once it is gone");
});

test("a gate reached through a symlinked path answers what it answers directly", needsSymlinks, (t) => {
  // The whole documentation check runs at module scope and only the verdict is
  // guarded, so a guard that answers no leaves a gate that ran everything and
  // said nothing. Exit 0 either way; the difference is whether it spoke.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(ROOT, join(dir, "repo"));

  const direct = spawnSync(process.execPath, [join(ROOT, "scripts", "check-docs.mjs")], { encoding: "utf8" });
  const linked = spawnSync(process.execPath, [join(dir, "repo", "scripts", "check-docs.mjs")], { encoding: "utf8" });

  assert.equal(linked.status, direct.status, linked.stderr);
  assert.equal(linked.stdout, direct.stdout);
});

/**
 * Every `.mjs` under the directories this repository keeps source in.
 *
 * Named rather than discovered, so an untracked worktree sitting in the tree is
 * not swept up as a finding. What it costs is a file added at the top level or
 * in a directory nobody has thought of, which is the trade the list is.
 */
function sources() {
  const found = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const at = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith(".mjs")) found.push(at);
    }
  };
  for (const dir of ["scripts", "test", `${REL.anatomiya}/bin`, `${REL.anatomiya}/lib`, `${REL.anatomiya}/hooks`, REL.ultracode]) walk(dir);
  return found;
}

test("nothing outside the two guards reads the path this process was started with", () => {
  // `import.meta.url` is resolved and `process.argv[1]` is whatever the caller
  // typed, so comparing them answers no for every invocation whose path holds a
  // symlink. It shipped in nine places and was found twice.
  //
  // The rule is where the value may be read rather than which comparison is
  // written, because the comparisons are not a list: a first pass refused two
  // spellings and `process.argv[1] === fileURLToPath(import.meta.url)` carries
  // the same defect and matches neither. Nothing else here has any use for it.
  const reading = sources().filter((rel) => /process\.argv\[1\]/.test(readFileSync(join(ROOT, rel), "utf8")));

  assert.deepEqual(reading.sort(), [...GUARDS].sort());
});

/** The two modules that answer the question, one per plugin, and this suite. */
const GUARDS = ["scripts/entry.mjs", `${REL.ultracode}/hooks/hook-io.mjs`, "test/entry.test.mjs"];

test("both copies of the guard recognise a file run as itself", (t) => {
  // Measured: node absolutises and normalises `argv[1]` before a script sees
  // it, so `.`, `..`, `//` and a relative spelling all collapse and a symlink
  // is the only difference that survives. There is no spelling that separates
  // this guard from a raw string comparison without one, which is why the
  // discriminating case below needs the privilege and this one does not.
  //
  // What this holds on every platform is the failure that costs the most: a
  // guard answering no for its own file leaves a script that runs nothing and
  // exits 0, and the second plugin's copy is otherwise never run at all where
  // symlinks are unavailable.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-entry-direct-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const module of GUARDS.slice(0, 2)) {
    const name = `${module.replace(/\W/g, "-")}.mjs`;
    writeFileSync(
      join(dir, name),
      `import { invokedAs } from ${JSON.stringify(pathToFileURL(join(ROOT, module)).href)};\n` +
        `process.stdout.write(String(invokedAs(import.meta.url)));\n`,
    );

    const run = spawnSync(process.execPath, [join(dir, name)], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "true", `${module} does not recognise itself run directly`);
  }
});

test("both copies of the guard answer yes through a symlinked path", needsSymlinks, (t) => {
  // The two plugins cannot import from each other, so the second one keeps its
  // own copy, and what they may not do is disagree about the rule. Run as a
  // file rather than through `node -e`, because `-e` leaves argv[1] unset and
  // then every spelling of the guard answers no: the rule under test is what
  // happens when argv[1] is set and holds a link, so a case that never sets it
  // passes whatever the comparison is.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-entry-both-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const real = join(dir, "real");
  mkdirSync(real);
  symlinkSync(real, join(dir, "link"));

  for (const module of GUARDS.slice(0, 2)) {
    const name = `${module.replace(/\W/g, "-")}.mjs`;
    writeFileSync(
      join(real, name),
      `import { invokedAs } from ${JSON.stringify(pathToFileURL(join(ROOT, module)).href)};\n` +
        `process.stdout.write(String(invokedAs(import.meta.url)));\n`,
    );

    const direct = spawnSync(process.execPath, [join(real, name)], { encoding: "utf8" });
    const linked = spawnSync(process.execPath, [join(dir, "link", name)], { encoding: "utf8" });

    assert.equal(direct.status, 0, direct.stderr);
    assert.equal(linked.status, 0, linked.stderr);
    assert.equal(direct.stdout, "true", `${module} does not recognise itself run directly`);
    assert.equal(linked.stdout, "true", `${module} does not recognise itself reached through a link`);
  }
});
