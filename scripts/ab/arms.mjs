// scripts/ab/arms.mjs
/**
 * Two worktrees off one commit: one holding the map, one holding none.
 *
 * Worktrees rather than clones because they share the object store, so both
 * arms are the same bytes at the same commit by construction rather than by
 * a checksum somebody remembered to run.
 *
 * Arm A gets the generated rule files and the pin. Arm B gets neither, and
 * getting that wrong is the whole experiment: a stale copy of the rules
 * directory left in B measures nothing, twice.
 */
import { mkdtempSync, rmSync, cpSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { RULES_DIR, SETTINGS_PATH, STORE_DIR } from "../../plugins/anatomiya/lib/rules.mjs";

const run = promisify(execFile);

/**
 * git for the harness, not for the scan.
 *
 * The scan's own `git.mjs` refuses any argument that reads as an option unless
 * it is on a closed list, which is the F5 battery the scan runs behind. A
 * worktree needs `--detach` and `--force`, and widening that list would weaken
 * every call the scan makes to serve a harness that is not even shipped:
 * `scripts/` is outside both plugin roots. So the harness carries the same
 * battery over its own shorter list instead.
 */
const WORKTREE_FLAGS = new Set(["--detach", "--force"]);

async function git(root, args, { timeout = 60_000, maxBytes = 1 << 20 } = {}) {
  for (const arg of args) {
    if (typeof arg !== "string") return { ok: false, stdout: "", error: `git argument is not a string: ${typeof arg}` };
    if (arg.startsWith("-") && !WORKTREE_FLAGS.has(arg)) {
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
 * `--effort` says. An arm is a worktree of the repository under measurement, so
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
 * Returned rather than thrown: a throw here lands between creating the
 * worktrees and returning the disposer for them, which leaves one registered in
 * the repository being measured. The caller can fail after cleaning up.
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
 * Two worktrees off one commit, neither able to decide its own measurement.
 *
 * A failure part way through removes what it made before it throws: the arms
 * are registered in the repository under measurement, and one left behind
 * outlives the run that made it.
 */
export async function buildArms(repo, sha, { workdir = tmpdir() } = {}) {
  const base = mkdtempSync(join(workdir, "anatomiya-ab-"));
  const a = join(base, "with-map");
  const b = join(base, "no-map");

  const made = [];
  const fail = async (message) => {
    for (const path of made) await git(repo, ["worktree", "remove", "--force", path]);
    rmSync(base, { recursive: true, force: true });
    throw new Error(message);
  };

  for (const [path, name] of [[a, "with-map"], [b, "no-map"]]) {
    // Recorded before the check: an add that registered and then failed leaves
    // a registration behind, and removing one that was never made costs nothing.
    made.push(path);
    const r = await git(repo, ["worktree", "add", "--detach", path, sha]);
    if (!r.ok) await fail(`could not create the ${name} worktree: ${r.error}`);
    const settings = dropSettings(path);
    // Left in place, the repository under measurement sets the effort that
    // measures it, so a run that cannot remove them is not a run.
    if (settings.kept.length) await fail(`could not clear the ${name} arm's own settings: ${settings.kept.join(", ")}`);
  }

  return {
    a,
    b,
    async dispose() {
      for (const path of [a, b]) {
        await git(repo, ["worktree", "remove", "--force", path]);
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/**
 * Copy a scanned map into arm A.
 *
 * The map is generated in the source repository and copied rather than
 * regenerated in the worktree, so both arms hold the same commit and only one
 * of them holds the map. Regenerating would also re-pin, and the pin is what
 * every gate reads.
 */
export function installMap(source, arm) {
  for (const rel of [RULES_DIR, STORE_DIR]) {
    const from = join(source, rel);
    if (existsSync(from)) cpSync(from, join(arm, rel), { recursive: true });
  }
}

/**
 * The probe: did the map actually attach in this arm?
 *
 * A `paths` rule attaches when the agent uses the Read tool on a matching file
 * or when an `@file` mention names it. Not on grep, not on glob, not on `cat`,
 * not on an edit with no prior read. An arm where it did not attach measured
 * nothing, and the only way to know is to ask.
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
