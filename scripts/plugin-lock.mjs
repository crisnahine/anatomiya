#!/usr/bin/env node
/**
 * The lockfile Claude Code installs a plugin's dependencies from.
 *
 * Measured on 2.1.251: the loader reads a plugin's root with a non-recursive
 * `readdir` and runs `npm ci --ignore-scripts` only where a `package.json` and
 * a lockfile sit together. The marketplace's own lockfile is one directory up
 * and invisible to it, so the plugin ships one of its own.
 *
 * One thing to hold if this is ever distributed as a tarball rather than as the
 * git tree the marketplace copies: `npm pack` never carries a
 * `package-lock.json`, and no `files` entry makes it. The loader's own table
 * takes `npm-shrinkwrap.json` too, which npm does publish, and that is the file
 * to switch to on the day the distribution changes.
 *
 * Two lockfiles for one dependency set drift the moment npm resolves a range
 * to something newer, and then the suite is green against a parser nobody
 * running the plugin has. So this one is not resolved afresh: the root's tree
 * is handed to npm as a starting point and npm prunes it to what the plugin
 * declares, which keeps every version the root already pinned. `validate.mjs`
 * holds the two to that.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { invokedAs } from "./entry.mjs";
import { REL, ROOT } from "./plugins.mjs";

/** What this writes under a given root, as a reader of the output would spell it. */
const lockfileIn = (root) => `${relative(ROOT, root) || "."}/${REL.anatomiya}/package-lock.json`.replace(/^\.\//, "");

/**
 * Whether the npm this runs can be spawned at all.
 *
 * npm ships on Windows as `npm.cmd` with no `npm.exe`, a spawn resolves an
 * extension-less name against `.com` and `.exe` only, so the attempt answers
 * ENOENT on a machine that has npm installed, and running the batch file needs
 * a shell no command here may spawn. `shipped.mjs` answers the same way for the
 * same reason. The gate runs on the Linux job either way, so what a Windows
 * checkout loses is coverage rather than the check.
 */
const RUNNABLE = process.platform !== "win32";

/**
 * The fields a lockfile's own root entry carries over from the manifest.
 *
 * Every kind `npm ci` resolves, dev dependencies included. A kind left out is a
 * kind the seed does not declare, so npm re-resolves it and the gate refuses a
 * tree that was correct. `validate.mjs` counts a narrower set as demanding a
 * lockfile, since a dev dependency is nothing the plugin needs at runtime, and
 * these two questions are not the same one.
 */
const CARRIED = ["name", "version", "license", "dependencies", "optionalDependencies", "peerDependencies", "devDependencies", "engines"];

/** Where this plugin's own nested resolutions sit in the marketplace's lockfile. */
const NESTED_UNDER = `${REL.anatomiya}/node_modules/`;

/**
 * What npm is asked to prune, rather than what it would resolve on its own.
 *
 * Two kinds of entry are dropped and one is moved. The root entry is the
 * marketplace's, a workspace entry is a plugin rather than a dependency, and a
 * link is where npm would have installed a workspace: none of the three is a
 * package this plugin needs. What is moved is a resolution npm could not hoist,
 * which it writes under the workspace that needed it. Two plugins wanting one
 * package at two versions puts the loser there, and dropped with its workspace
 * the seed would carry the copy that belongs to the other one, so the version
 * this plugin ships would stop being the version the suite runs on. Re-keyed to
 * this plugin's own root, where npm will look for it once the plugin is one,
 * and last, so it wins over the hoisted copy.
 */
export function seedFor(rootLock, manifest) {
  const packages = {};
  const nested = {};
  for (const [path, entry] of Object.entries(rootLock.packages ?? {})) {
    // The link test comes first, because the nested entries below are applied
    // last and win: on the other branch only, a nested link replaced a real
    // resolution with a pointer at another workspace.
    if (path === "" || entry?.link === true) continue;
    if (path.startsWith(NESTED_UNDER)) {
      nested[`node_modules/${path.slice(NESTED_UNDER.length)}`] = entry;
      continue;
    }
    // A workspace is a directory under `plugins/`, which a dependency's path
    // never is: every one of those begins `node_modules/`.
    if (!path.startsWith("node_modules/")) continue;
    packages[path] = entry;
  }
  Object.assign(packages, nested);
  packages[""] = Object.fromEntries(Object.entries(manifest).filter(([key]) => CARRIED.includes(key)));
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Whether two lockfiles say the same thing, whatever either one looks like. */
function same(a, b) {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    // One of them is not a lockfile at all, which is a difference like any other.
    return false;
  }
}

/**
 * What npm is asked to do, read rather than trusted: a test hands npm a stub
 * and reads back what it was handed. Offline when checking, because a gate
 * that reaches a registry fails on the network rather than on the repository,
 * the rule `shipped.mjs` already states. The seed carries every resolution, so
 * npm needs nothing from outside unless the manifest has grown a dependency
 * the root has not installed yet, and then the answer is to run this without
 * `--check`.
 */
export const LOCK_ARGV = ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"];

/**
 * The lockfile this plugin should ship, built in a directory of its own.
 *
 * Away from the checkout because npm walks up from where it runs and would
 * find the marketplace's workspaces, and because `--package-lock-only` writes
 * beside whatever manifest it read.
 */
function build(root, pluginRoot, { offline }) {
  const work = mkdtempSync(join(tmpdir(), "anatomiya-plugin-lock-"));
  try {
    const manifest = readJson(join(pluginRoot, "package.json"));
    cpSync(join(pluginRoot, "package.json"), join(work, "package.json"));
    writeFileSync(join(work, "package-lock.json"), `${JSON.stringify(seedFor(readJson(join(root, "package-lock.json")), manifest), null, 2)}\n`);
    // Bounded the way `runSetup` bounds its own npm: a cold resolve on a slow
    // link is minutes, and what comes back is one lockfile, but neither is a
    // reason to let a hung child hold a gate for ever or a runaway one fill
    // memory.
    const run = spawnSync("npm", offline ? [...LOCK_ARGV, "--offline"] : LOCK_ARGV, {
      cwd: work,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (run.status !== 0) {
      // Offline, the likeliest reason is a dependency the marketplace root has
      // not installed yet, and the seed then carries nothing to resolve it
      // with. That is the one failure the hint answers, so it is said here.
      const hint = offline ? "\nif a dependency was added, run npm run lock:plugin to resolve it" : "";
      throw new Error(`npm could not resolve the seed${offline ? ", offline" : ""}: ${run.stderr || run.stdout || run.error?.message}${hint}`);
    }
    return readFileSync(join(work, "package-lock.json"), "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * One line and a non-zero exit, the way the other gates in here refuse.
 *
 * Prefixed for the runner, because a workflow reads these as annotations and a
 * line it cannot see is a failure someone has to open the log to understand.
 * `validate.mjs` and `shipped.mjs` both do this, and this one is a step beside
 * them.
 */
function refuse(message) {
  console.error(`${process.env.GITHUB_ACTIONS === "true" ? "::error::" : ""}${message}`);
  process.exit(1);
}

function main() {
  const check = process.argv.includes("--check");
  if (!RUNNABLE) {
    // Said for the write as well as the check, because every refusal in here
    // names `npm run lock:plugin` as the fix and on Windows that writes
    // nothing: a reader following the hint has to be told why.
    console.log(
      check
        ? "not checked here: npm on Windows is a batch file, and running one needs a shell no command here may spawn"
        : "nothing written: npm on Windows is a batch file, and running one needs a shell no command here may spawn",
    );
    return;
  }
  // A root argument the way the sibling gates take one, so a case can point
  // this at a tree of its own rather than at the checkout it is running in.
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) refuse(`only one marketplace root may be given, and ${positional[1]} was the second`);
  const root = positional[0] ? resolve(positional[0]) : ROOT;
  const pluginRoot = join(root, REL.anatomiya);
  const path = join(pluginRoot, "package-lock.json");
  const named = lockfileIn(root);

  let built;
  try {
    built = build(root, pluginRoot, { offline: check });
  } catch (err) {
    // An npm that will not resolve is an ordinary condition here, and a stack
    // trace is not what the caller needs.
    refuse(String(err?.message ?? err));
    return;
  }

  if (!check) {
    writeFileSync(path, built);
    console.log(`wrote ${path}`);
    return;
  }
  let held;
  try {
    held = readFileSync(path, "utf8");
  } catch {
    refuse(`${named} is missing, so an install of this plugin would run nothing; run npm run lock:plugin`);
    return;
  }
  // Compared as records rather than as text, so indentation and a trailing
  // newline decide nothing. Not key order: `JSON.stringify` keeps it, so a npm
  // that reordered the file would still be refused, which is a gate firing on
  // something real with an answer that fixes it. Measured byte-identical under
  // npm 10, 11 and 12.
  if (!same(held, built)) refuse(`${named} is not what this script produces; run npm run lock:plugin`);
  console.log(`${named} is what this script produces`);
}

if (invokedAs(import.meta.url)) main();
