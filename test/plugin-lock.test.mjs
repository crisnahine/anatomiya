import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { LOCK_ARGV, seedFor } from "../scripts/plugin-lock.mjs";
import { REL, ROOT } from "../scripts/plugins.mjs";
import { needsPathControl, needsShebang, needsSpawnableNpm } from "./platform.mjs";

const MANIFEST = {
  name: "anatomiya",
  version: "1.2.3",
  license: "MIT",
  dependencies: { "oxc-parser": "^0.144.0" },
  peerDependencies: { "a-peer": "^1.0.0" },
  optionalDependencies: { "an-optional": "^2.0.0" },
  devDependencies: { "a-dev": "^3.0.0" },
};

test("the seed carries the marketplace's resolutions and none of its workspaces", () => {
  // The plugin's lockfile has to answer the same versions as the root's, and
  // npm resolves a range to whatever is newest unless something already pins
  // it. So the root's tree is handed to it as a starting point, minus the parts
  // that describe the marketplace rather than this plugin: the root package
  // itself, the workspace packages, and the links npm leaves where a workspace
  // would otherwise be installed.
  const root = {
    lockfileVersion: 3,
    packages: {
      "": { name: "crisnahine", workspaces: ["plugins/*"] },
      "node_modules/anatomiya": { resolved: REL.anatomiya, link: true },
      "node_modules/oxc-parser": { version: "0.144.0" },
      [REL.anatomiya]: { name: "anatomiya", version: "1.2.3" },
      [REL.ultracode]: { name: "ultracode-anywhere", version: "0.1.1" },
    },
  };

  const seed = seedFor(root, MANIFEST);

  assert.deepEqual(Object.keys(seed.packages).sort(), ["", "node_modules/oxc-parser"]);
  assert.equal(seed.packages[""].name, "anatomiya");
  assert.deepEqual(seed.packages[""].dependencies, { "oxc-parser": "^0.144.0" });
  // Every kind npm resolves has to reach the root entry, or npm re-resolves the
  // one that was left out and the gate refuses a tree that was correct.
  assert.deepEqual(seed.packages[""].peerDependencies, { "a-peer": "^1.0.0" });
  assert.deepEqual(seed.packages[""].optionalDependencies, { "an-optional": "^2.0.0" });
  assert.deepEqual(seed.packages[""].devDependencies, { "a-dev": "^3.0.0" });
  assert.equal(seed.packages["node_modules/oxc-parser"].version, "0.144.0");
  assert.equal(seed.lockfileVersion, 3);
});

test("a resolution npm could not hoist is the plugin's own, and it wins", () => {
  // Two plugins in one tree, or a root devDependency, and npm resolves one
  // package twice: the hoisted copy at the top and the loser nested under the
  // workspace that needs the other version. Dropped with the workspace entry,
  // the plugin's lockfile is seeded with the copy that belongs to somebody
  // else, and the version it ships stops being the version this suite runs on.
  const root = {
    lockfileVersion: 3,
    packages: {
      "": { name: "crisnahine", workspaces: ["plugins/*"] },
      "node_modules/anatomiya": { resolved: REL.anatomiya, link: true },
      "node_modules/oxc-parser": { version: "0.144.0" },
      [`${REL.anatomiya}/node_modules/oxc-parser`]: { version: "0.144.7" },
      [REL.anatomiya]: { name: "anatomiya", version: "1.2.3" },
    },
  };

  const seed = seedFor(root, MANIFEST);

  assert.equal(seed.packages["node_modules/oxc-parser"].version, "0.144.7", "the nested one is this plugin's");
  assert.equal(seed.packages[`${REL.anatomiya}/node_modules/oxc-parser`], undefined, "and it is not left under a path this plugin has no root for");
});

test("a link nested under the plugin is still a link, and still goes", () => {
  // The nested entries are applied last so they win over the hoisted copy, and
  // the link test sat on the other branch only: a nested link then replaced a
  // real resolution with a pointer at another workspace, which is the third of
  // the three kinds the seed is supposed to drop, arriving through the one path
  // that beats the others.
  const root = {
    lockfileVersion: 3,
    packages: {
      "": { name: "crisnahine" },
      "node_modules/x": { version: "1.0.0", resolved: "https://registry.npmjs.org/x/-/x-1.0.0.tgz" },
      [`${REL.anatomiya}/node_modules/x`]: { link: true, resolved: REL.ultracode },
    },
  };

  const seed = seedFor(root, MANIFEST);

  assert.equal(seed.packages["node_modules/x"].version, "1.0.0", "the real resolution stands");
  assert.equal(seed.packages["node_modules/x"].link, undefined);
});

test("a package whose name begins with the workspace directory's is not a workspace", () => {
  const root = {
    lockfileVersion: 3,
    packages: {
      "": { name: "crisnahine" },
      "node_modules/plugins-of-something": { version: "1.0.0" },
      "node_modules/@plugins/scoped": { version: "2.0.0" },
    },
  };

  const seed = seedFor(root, MANIFEST);

  assert.equal(seed.packages["node_modules/plugins-of-something"].version, "1.0.0");
  assert.equal(seed.packages["node_modules/@plugins/scoped"].version, "2.0.0");
});

test("the seed states the plugin's own name and version, not the marketplace's", () => {
  const seed = seedFor({ lockfileVersion: 3, packages: { "": { name: "crisnahine" } } }, MANIFEST);

  assert.equal(seed.name, "anatomiya");
  assert.equal(seed.version, "1.2.3");
});

test("the committed lockfile is the one this script produces", needsSpawnableNpm, () => {
  // A lockfile refreshed by hand drifts from the root's the moment npm resolves
  // a range differently, which is what the gate in `validate.mjs` then reports
  // against a file nobody can reproduce. `--check` answers without writing.
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "plugin-lock.mjs"), "--check"], {
    encoding: "utf8",
    timeout: 120_000,
  });

  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

/** The script, run against a marketplace of this test's own making. */
function check(root, env = {}) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", "plugin-lock.mjs"), "--check", root], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
}

/** This marketplace's own tracked files, copied where a case may take one away. */
function marketplace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-lock-root-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(ROOT, "package-lock.json"), join(dir, "package-lock.json"));
  cpSync(join(ROOT, REL.anatomiya), join(dir, REL.anatomiya), { recursive: true });
  return dir;
}

test("the root to read is an argument, the way the gates beside this one take one", needsSpawnableNpm, (t) => {
  // Hardwired to the checkout it runs in, a case cannot build the tree it needs
  // to prove the refusals below, and the gate goes untested rather than wrong.
  const dir = marketplace(t);

  const run = check(dir);

  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test("a lockfile that is not what the seed produces is refused", needsSpawnableNpm, (t) => {
  // The case above asks the script to compare its own build against the file
  // and asserts it agreed with itself, which a comparison that never refuses
  // passes. This is the branch that has to bite: one version moved, and the
  // marketplace's own lockfile still says the other.
  const dir = marketplace(t);
  const path = join(dir, REL.anatomiya, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const [name] = Object.keys(lock.packages).filter((k) => k && lock.packages[k].version);
  lock.packages[name].version = "9.9.9";
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);

  const run = check(dir);

  assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /is not what this script produces; run npm run lock:plugin/);
});

test("a plugin with no lockfile is refused by what it costs, not by a stack trace", needsSpawnableNpm, (t) => {
  const dir = marketplace(t);
  unlinkSync(join(dir, REL.anatomiya, "package-lock.json"));

  const run = check(dir);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /package-lock\.json is missing, so an install of this plugin would run nothing/);
  assert.doesNotMatch(run.stderr, /at .*plugin-lock\.mjs:/, "a stack trace is not what the caller needs");
});

test("a refusal reaches the runner as an annotation", needsSpawnableNpm, () => {
  // A workflow reads these as annotations, and a line it cannot see is a
  // failure someone has to open the log to understand. The sibling gates both
  // prefix; this one is a step beside them.
  const run = check(join(tmpdir(), "anatomiya-no-marketplace-here"), { GITHUB_ACTIONS: "true" });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /^::error::/m, run.stderr);
});

test("on Windows the gate says why it did not run, rather than failing on npm", () => {
  // npm ships there as a batch file with no `.exe`, a spawn resolves an
  // extension-less name against `.com` and `.exe` only, and running the batch
  // file needs a shell no command here spawns. `shipped.mjs` answers the same
  // way for the same reason: the Linux job is where this gate runs, so what a
  // Windows checkout loses is coverage rather than the check. Driven through a
  // process that says it is Windows, since that is the one thing about it a
  // machine here cannot be.
  const script = `Object.defineProperty(process, "platform", { value: "win32" });
    process.argv = [process.argv[0], ${JSON.stringify(join(ROOT, "scripts", "plugin-lock.mjs"))}, "--check"];
    await import(${JSON.stringify(new URL("../scripts/plugin-lock.mjs", import.meta.url).href)});`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 60_000 });

  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /^not checked here: npm on Windows is a batch file/m, `${run.stdout}${run.stderr}`);
});

// The list says what the gate means to run, and nothing checked the argv the
// npm it spawns is handed: `--offline` under `--check` is what keeps a gate off
// the network (B35), and a call site spelling its own argv would pass the list.
// The stub records what it was handed and answers nothing this can read, so
// the exit status is the gate's own reported condition and not this case's.
test("the npm the gate runs is handed the list, offline under --check and online for a write", { ...needsShebang, ...needsPathControl }, (t) => {
  const dir = marketplace(t);
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-lock-npm-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const seen = join(bin, "argv.txt");
  writeFileSync(join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${seen}\n`, { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}` };

  check(dir, env);
  assert.deepEqual(readFileSync(seen, "utf8").split("\n").filter(Boolean), [...LOCK_ARGV, "--offline"]);

  spawnSync(process.execPath, [join(ROOT, "scripts", "plugin-lock.mjs"), dir], { encoding: "utf8", timeout: 120_000, env: { ...process.env, ...env } });
  assert.deepEqual(readFileSync(seen, "utf8").split("\n").filter(Boolean), LOCK_ARGV);
});
