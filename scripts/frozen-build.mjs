/**
 * This repository built at one commit, in a directory the working tree cannot
 * reach: a checkout of the commit, the install the working tree holds beside
 * it, and the versions the build answers with.
 *
 * The corpus run and the two A/B harnesses run `bin/anatomiya.mjs` from the
 * working tree, so a file edited while a run was in flight put two builds in
 * one report, and the freeze before a run was done by hand and recorded only in
 * prose. A frozen build is the same binary at a commit nothing edits, and a
 * rerun names it by that commit.
 *
 * The install is the working tree's `node_modules`, cloned where the filesystem
 * can, so a freeze costs seconds and no network. That is the right install
 * only while the commit's lockfile is the working tree's; where the two differ
 * the copy is installed from its own lockfile, which needs npm and a shell no
 * script here may spawn on Windows, so there it is refused with the reason.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REL, ROOT } from "./plugins.mjs";

/** Where the harnesses keep their frozen builds, one directory per commit, reused across runs. */
export const FROZEN_HOME = join(tmpdir(), "anatomiya-frozen");

/** The file a frozen build carries so a directory is known to be one, and which commit it is. */
export const FROZEN_FROM = "FROZEN_FROM";

/**
 * The build of `source` at `sha` under `scratch`, or `{ error }`.
 *
 * Answers `{ sha, root, pluginDir, binary, versions }`: `sha` the full commit,
 * `root` the checkout, `pluginDir` and `binary` the plugin and its entry point
 * inside it, and `versions.anatomiya` the plugin's version at that commit, in
 * the words `ab-scenario.mjs` records. A build already there for the commit is
 * answered as it stands.
 */
export function frozenBuild(sha, scratch, { source = ROOT } = {}) {
  const full = commitOf(source, sha);
  if (full === null) return { error: `${sha} is not a commit of ${source}` };
  const root = join(scratch, `anatomiya-${full.slice(0, 12)}`);
  const pluginDir = join(root, REL.anatomiya);
  const answer = () => ({ sha: full, root, pluginDir, binary: join(pluginDir, "bin", "anatomiya.mjs"), versions: versionsOf(pluginDir, full) });
  if (existsSync(join(root, FROZEN_FROM))) return answer();

  // Half a build left by a run that died is removed rather than trusted.
  rmSync(root, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", source, root], { stdio: "pipe" });
    execFileSync("git", ["checkout", "-q", "--detach", full], { cwd: root, stdio: "pipe" });
  } catch (err) {
    return { error: `could not check ${full.slice(0, 12)} out under ${scratch}: ${String(err.stderr ?? err.message).trim().split("\n")[0]}` };
  }
  const installed = installInto(root, source);
  if (installed.error) return installed;
  writeFileSync(join(root, FROZEN_FROM), `${full}\n`);
  return answer();
}

/** The full id of `sha` as `source` knows it, or null where it names no commit there. */
function commitOf(source, sha) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The working tree's install, cloned into the build, where the lockfile the
 * build was committed with is the working tree's; its own install otherwise.
 */
function installInto(root, source) {
  const same = ["package-lock.json", `${REL.anatomiya}/package-lock.json`].every((rel) => sameFile(join(root, rel), join(source, rel)));
  if (same) {
    const from = join(source, "node_modules");
    if (!existsSync(from)) return { error: `${source} holds no node_modules to freeze: run npm ci there first` };
    try {
      cpSync(from, join(root, "node_modules"), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    } catch (err) {
      return { error: `could not copy the install into ${root}: ${err.code ?? err.message}` };
    }
    return {};
  }
  // npm on Windows is a batch file, and running one needs a shell no script here may spawn.
  if (process.platform === "win32") return { error: `the lockfile at this commit is not the working tree's, so the build needs its own install, which this cannot run on Windows` };
  const ran = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (ran.status !== 0) return { error: `npm ci in ${root} exited ${ran.status ?? ran.signal}: ${(ran.stderr ?? "").trim().split("\n")[0]}` };
  return {};
}

const sameFile = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));

/** The plugin's version at the commit, said the way a result document records it. */
function versionsOf(pluginDir, sha) {
  const { version } = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"));
  return { anatomiya: `${version} at ${sha.slice(0, 12)}` };
}
