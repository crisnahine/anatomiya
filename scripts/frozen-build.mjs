/**
 * This repository built at one commit, in a directory the working tree cannot
 * reach: a checkout of the commit, the install the working tree holds beside
 * it, and the versions the build answers with; and `runFrozen`, which runs a
 * harness out of that checkout.
 *
 * The corpus run and the two A/B harnesses run `bin/anatomiya.mjs` from the
 * working tree, so a file edited while a run was in flight put two builds in
 * one report, and the freeze before a run was done by hand and recorded only in
 * prose. The harness runs at the commit too, binary and all: run from the
 * working tree over a frozen binary it read the binary's record against its
 * own constants and cloned this repository's own row from the working tree.
 *
 * The install is the working tree's `node_modules`, cloned where the filesystem
 * can, so a freeze costs seconds and no network. That is the right install
 * only while the commit's lockfile is the working tree's; where the two differ
 * the copy is installed from its own lockfile, which needs npm and a shell no
 * script here may spawn on Windows, so there it is refused with the reason.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REL, ROOT } from "./plugins.mjs";

/** Where the harnesses keep their frozen builds, one directory per commit, reused across runs. */
const FROZEN_HOME = join(tmpdir(), "anatomiya-frozen");

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

  // Built under a name of its own and moved into place whole, so two harnesses
  // freezing one commit at once never read half a build: the one that moves
  // second finds the first's and uses it.
  mkdirSync(scratch, { recursive: true });
  const building = mkdtempSync(join(scratch, `.building-${full.slice(0, 12)}-`));
  try {
    try {
      execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", source, building], { stdio: "pipe" });
      execFileSync("git", ["checkout", "-q", "--detach", full], { cwd: building, stdio: "pipe" });
    } catch (err) {
      return { error: `could not check ${full.slice(0, 12)} out under ${scratch}: ${String(err.stderr ?? err.message).trim().split("\n")[0]}` };
    }
    const installed = installInto(building, source);
    if (installed.error) return installed;
    writeFileSync(join(building, FROZEN_FROM), `${full}\n`);
    try {
      renameSync(building, root);
    } catch (err) {
      if (!existsSync(join(root, FROZEN_FROM))) return { error: `could not put the build of ${full.slice(0, 12)} at ${root}: ${err.code ?? err.message}` };
    }
  } finally {
    rmSync(building, { recursive: true, force: true });
  }
  return answer();
}

/**
 * The harness at `scriptRel` run out of the build of `sha`, with `argv` less
 * the `--frozen` that asked for this, and this process's stdio: `{ status }`,
 * or `{ error }` where there is no build or no such script at that commit.
 */
export function runFrozen(sha, scriptRel, argv, { scratch = FROZEN_HOME, source = ROOT } = {}) {
  const build = frozenBuild(sha, scratch, { source });
  if (build.error) return build;
  const script = join(build.root, scriptRel);
  if (!existsSync(script)) return { error: `${scriptRel} is not at ${build.sha.slice(0, 12)}, so there is no harness there to run` };
  console.log(`build: anatomiya ${build.versions.anatomiya}, under ${build.root}`);
  const ran = spawnSync(process.execPath, [script, ...withoutFrozen(argv)], { stdio: "inherit" });
  return { status: ran.status ?? 1 };
}

/** `argv` with its `--frozen <sha>` or `--frozen=<sha>` taken out, so the harness at the commit does not freeze again. */
export function withoutFrozen(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--frozen") {
      i += 1;
      continue;
    }
    if (argv[i].startsWith("--frozen=")) continue;
    out.push(argv[i]);
  }
  return out;
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
