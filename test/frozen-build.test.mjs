import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FROZEN_FROM, frozenBuild } from "../scripts/frozen-build.mjs";
import { REL, ROOT } from "../scripts/plugins.mjs";
import { removeTree } from "./platform.mjs";

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
