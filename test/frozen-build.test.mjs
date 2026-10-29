import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FROZEN_FROM, RESULTS_ROOT, frozenBuild, runFrozen, withoutFrozen } from "../scripts/frozen-build.mjs";
import { REL, ROOT } from "../scripts/plugins.mjs";
import { removeTree } from "./platform.mjs";
import { repository } from "./repository.mjs";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-frozen-test-"));
  t.after(() => removeTree(dir));
  return dir;
}

const head = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const needsCheckout = head() === null ? { skip: "this tree is not a git checkout, so there is no commit to build" } : {};
// The install is cloned from this checkout's, which a tree with none cannot give.
const needsInstall = existsSync(join(ROOT, "node_modules")) ? needsCheckout : { skip: "no node_modules beside this checkout" };

test("a name that is no commit is refused before anything is written", needsCheckout, (t) => {
  const dir = scratch(t);
  assert.match(frozenBuild("no-such-commit", dir).error, /is not a commit of/);
  assert.equal(existsSync(join(dir, "anatomiya-no-such-com")), false);
});

test("a build is the commit checked out with the install beside it, its binary answers from the copy, and a second ask finds the first", needsInstall, (t) => {
  const dir = scratch(t);
  const sha = head();
  const build = frozenBuild(sha, dir);
  assert.equal(build.error, undefined, build.error);
  assert.equal(build.sha, sha);
  assert.equal(build.root, join(dir, `anatomiya-${sha.slice(0, 12)}`));
  assert.equal(build.pluginDir, join(build.root, REL.anatomiya));
  assert.equal(readFileSync(join(build.root, FROZEN_FROM), "utf8"), `${sha}\n`);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: build.root, encoding: "utf8" }).trim(), sha, "the checkout is the commit");
  assert.match(build.versions.anatomiya, new RegExp(`^\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)? at ${sha.slice(0, 12)}$`));
  // The dependency resolution from the copy: the binary loads its own lib and the engines from the install beside it.
  const usage = execFileSync(process.execPath, [build.binary, "--help"], { encoding: "utf8", cwd: build.root });
  assert.match(usage, /anatomiya\s+scan/);

  writeFileSync(join(build.root, "kept.txt"), "left by a run");
  const again = frozenBuild(sha, dir);
  assert.equal(again.root, build.root);
  assert.ok(existsSync(join(build.root, "kept.txt")), "a build already there is answered as it stands, not rebuilt");
});

test("a frozen run is the harness at the commit, out of the build, with the freeze flag taken off its arguments and the results root named", needsCheckout, (t) => {
  assert.deepEqual(withoutFrozen(["a", "--frozen", "abc", "b", "--frozen=def", "c"]), ["a", "b", "c"]);
  // A repository of one script that writes where it ran from and what it was given, so the run from
  // the copy is told apart from one in the working tree.
  const made = repository(t, { prefix: "anatomiya-frozen-source-" });
  made.write("scripts/say.mjs", 'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], JSON.stringify({ url: import.meta.url, argv: process.argv.slice(3), results: process.env.ANATOMIYA_RESULTS_ROOT ?? null }));\n');
  const sha = made.commit("say");
  const dir = scratch(t);
  const said = join(dir, "said.json");
  const ran = runFrozen(sha, "scripts/say.mjs", [said, "--frozen", sha, "x", `--frozen=${sha}`, "y"], { scratch: dir, source: made.dir });
  assert.deepEqual(ran, { status: 0 });
  const record = JSON.parse(readFileSync(said, "utf8"));
  assert.ok(record.url.includes(`anatomiya-${sha.slice(0, 12)}`), `ran from the build: ${record.url}`);
  assert.deepEqual(record.argv, ["x", "y"]);
  assert.equal(record.results, made.dir, `the results root is the checkout the run started from (${RESULTS_ROOT})`);
  assert.match(runFrozen(sha, "scripts/no-such-harness.mjs", [], { scratch: dir, source: made.dir }).error, /is not at/);
  // A directory at the build's name that is no build is cleared, not a dead end.
  const half = join(dir, `anatomiya-${sha.slice(0, 12)}`);
  removeTree(half);
  mkdirSync(half, { recursive: true });
  writeFileSync(join(half, "left-by-a-killed-run"), "");
  assert.equal(frozenBuild(sha, dir, { source: made.dir }).error, undefined);
  assert.ok(existsSync(join(half, FROZEN_FROM)) && !existsSync(join(half, "left-by-a-killed-run")));
  // A temp directory a killed freeze left is swept once it is a day old, and a fresh one is left for the freeze that owns it.
  const stale = join(dir, ".building-abcdef012345-old");
  const fresh = join(dir, ".building-abcdef012345-new");
  for (const p of [stale, fresh]) mkdirSync(p);
  const dayAgo = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
  utimesSync(stale, dayAgo, dayAgo);
  removeTree(half);
  assert.equal(frozenBuild(sha, dir, { source: made.dir }).error, undefined);
  assert.deepEqual([existsSync(stale), existsSync(fresh)], [false, true]);
});
