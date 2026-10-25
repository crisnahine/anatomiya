// scripts/ab/arms.mjs
/**
 * Two checkouts of one commit: one holding the map, one holding none.
 *
 * Local clones, hard-linked, with no alternates, no remote and no reflog, so
 * neither arm holds a path back to the checkout that holds the map. Both arms are the
 * same bytes at the same commit by construction rather than by a checksum
 * somebody remembered to run. Not worktrees: a linked worktree with no map is
 * the one shape the plugin's hooks answer from its main checkout's map, so arm
 * B built as one was handed the map it exists to lack.
 *
 * Arm A gets the generated rule files and the pin. Arm B gets neither, and
 * getting that wrong is the whole experiment: a stale copy of the rules
 * directory left in B measures nothing, twice.
 */
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isMapName, resolveRulesDir, RULES_DIR, SETTINGS_PATH, STORE_DIR } from "../../plugins/anatomiya/lib/rules.mjs";

const run = promisify(execFile);

/**
 * git for the harness, not for the scan.
 *
 * The scan's own `git.mjs` refuses any argument that reads as an option unless
 * it is on a closed list, which is the F5 battery the scan runs behind.
 * Building and resetting an arm needs the flags below, and widening that list
 * would weaken every call the scan makes to serve a harness that is not even
 * shipped: `scripts/` is outside the plugin root. So the harness carries the
 * same battery over its own shorter list instead.
 */
const ARM_FLAGS = new Set(["--quiet", "--no-checkout", "--detach", "--hard", "-fdx"]);

async function git(root, args, { timeout = 60_000, maxBytes = 1 << 20 } = {}) {
  for (const arg of args) {
    if (typeof arg !== "string") return { ok: false, stdout: "", error: `git argument is not a string: ${typeof arg}` };
    if (arg.startsWith("-") && !ARM_FLAGS.has(arg)) {
      return { ok: false, stdout: "", error: `git argument reads as an option: ${arg.slice(0, 60)}` };
    }
  }
  try {
    const { stdout } = await run("git", args, { cwd: root, encoding: "utf8", timeout, maxBuffer: maxBytes });
    return { ok: true, stdout, error: null };
  } catch (err) {
    return { ok: false, stdout: "", error: (err && (err.stderr || err.message)) || "git failed" };
  }
}

/**
 * Settings files a checkout carries that would decide its own measurement.
 *
 * `settings.env` lands above the CLI flag: a file naming
 * CLAUDE_CODE_EFFORT_LEVEL sets the effort the build resolves, whatever
 * `--effort` says. An arm is a checkout of the repository under measurement, so
 * left in place the repository chooses the engine that measures it.
 *
 * Only these two go. Excluding the project settings source wholesale would take
 * the map with them, since `RULES_DIR` is read as part of it: measured on
 * 2.1.250, an arm holding a `paths` rule answered with the map's file count
 * when the sources were loaded and NONE when they were not.
 */
const ARM_SETTINGS = [join(dirname(SETTINGS_PATH), "settings.json"), SETTINGS_PATH];

/**
 * The settings files taken out of an arm, and the ones that would not go.
 *
 * Returned rather than thrown, so the caller names the arm and cleans up
 * before it fails.
 */
export function dropSettings(arm) {
  const gone = [];
  const kept = [];
  for (const rel of ARM_SETTINGS) {
    const at = join(arm, rel);
    if (!existsSync(at)) continue;
    try {
      unlinkSync(at);
      gone.push(rel);
    } catch (err) {
      kept.push(`${rel}: ${err.message}`);
    }
  }
  return { gone, kept };
}

/**
 * Two checkouts of one commit, the map installed in arm A, neither able to
 * decide its own measurement.
 *
 * `reset` puts both back to exactly that, and runs before every trial. Built
 * once and never reset, trial N started in a tree holding every file trials 1
 * to N-1 wrote: one that found its target already there wrote nothing and was
 * dropped, and one that rewrote it had read an earlier trial's answer first.
 *
 * A failure part way through removes what it made before it throws. Nothing is
 * registered in the repository under measurement, so the directory is all
 * there is to remove.
 */
export async function buildArms(repo, sha, { workdir = tmpdir(), name = basename(resolve(repo)) } = {}) {
  // Each arm sits alone, at the same leaf name: an agent with a shell sees its
  // working directory, and "no-map" beside "with-map" told it which arm it was
  // in and where the other arm's map lay.
  const bases = [];
  const dispose = async () => {
    for (const base of bases) rmSync(base, { recursive: true, force: true });
  };
  for (let i = 0; i < 2; i++) bases.push(mkdtempSync(join(workdir, "ab-")));
  const a = join(bases[0], name);
  const b = join(bases[1], name);
  const arms = [[a, "with-map"], [b, "no-map"]];

  const reset = async () => {
    for (const [path, name] of arms) {
      for (const args of [["reset", "--quiet", "--hard", sha], ["clean", "--quiet", "-fdx"]]) {
        const r = await git(path, args);
        if (!r.ok) throw new Error(`could not reset the ${name} arm: ${r.error}`);
      }
      const settings = dropSettings(path);
      // Left in place, the repository under measurement sets the effort that
      // measures it, so a run that cannot remove them is not a run.
      if (settings.kept.length) throw new Error(`could not clear the ${name} arm's own settings: ${settings.kept.join(", ")}`);
    }
    installMap(repo, a);
  };

  try {
    for (const [path, name] of arms) {
      // `.` rather than `repo`: git runs inside it, where a relative `repo` names somewhere else.
      const cloned = await git(repo, ["clone", "--quiet", "--no-checkout", ".", path]);
      if (!cloned.ok) throw new Error(`could not create the ${name} arm: ${cloned.error}`);
      const cut = await git(path, ["remote", "remove", "origin"]);
      if (!cut.ok) throw new Error(`could not cut the ${name} arm from its source: ${cut.error}`);
      // The reflog opens with "clone: from <source>", the checkout that holds the map.
      rmSync(join(path, ".git", "logs"), { recursive: true, force: true });
      // Before the checkout, so an arm holds the commit's bytes on Windows too.
      const bytes = await git(path, ["config", "core.autocrlf", "false"]);
      if (!bytes.ok) throw new Error(`could not configure the ${name} arm: ${bytes.error}`);
      const at = await git(path, ["checkout", "--quiet", "--detach", sha]);
      if (!at.ok) throw new Error(`could not check out ${sha} in the ${name} arm: ${at.error}`);
    }
    await reset();
  } catch (err) {
    await dispose();
    throw err;
  }
  return { a, b, reset, dispose };
}

/**
 * Copy a scanned map into arm A.
 *
 * The map is generated in the source repository and copied rather than
 * regenerated in the arm, so both arms hold the same commit and only one
 * of them holds the map. Regenerating would also re-pin, and the pin is what
 * every gate reads.
 */
function installMap(source, arm) {
  // Where the plugin writes, a link included: cal.diy points .claude/rules at agents/rules.
  const from = resolveRulesDir(source);
  const names = from && existsSync(from) ? readdirSync(from).filter((name) => isMapName(name) && statSync(join(from, name)).isFile()) : [];
  if (names.length) {
    const to = resolveRulesDir(arm);
    // A link the arm cannot follow would leave it without the map it exists to have.
    if (!to) throw new Error(`could not install the map in the with-map arm: its ${RULES_DIR} leads nowhere it can be written`);
    mkdirSync(to, { recursive: true });
    for (const name of names) copyFileSync(join(from, name), join(to, name));
  }
  const store = join(source, STORE_DIR);
  if (existsSync(store)) cpSync(store, join(arm, STORE_DIR), { recursive: true });
}

/**
 * The probe: did the map actually attach in this arm?
 *
 * A `paths` rule attaches when the agent uses the Read tool on a matching file
 * or when an `@file` mention names it, and from 2.1.288 after a Write or Edit.
 * Not on grep, not on glob, not on `cat`, and before 2.1.288 not on an edit
 * with no prior read. An arm where it did not attach measured nothing, and the
 * only way to know is to ask.
 */
export const PROBE = [
  "Read the file at {file}.",
  "Then answer with one line and nothing else: the directory and file count from any repository map",
  "you were given for that path, or the single word NONE if you were given none.",
].join(" ");

/** The probe for one file, its name taken as characters: a `$` in a filename is not a replacement pattern. */
export function probeFor(file) {
  return PROBE.replace("{file}", () => file);
}
