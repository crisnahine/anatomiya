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
import { mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { RULES_DIR, STORE_DIR } from "../../plugins/anatomiya/lib/rules.mjs";

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

export async function buildArms(repo, sha, { workdir = tmpdir() } = {}) {
  const base = mkdtempSync(join(workdir, "anatomiya-ab-"));
  const a = join(base, "with-map");
  const b = join(base, "no-map");

  for (const [path, name] of [[a, "with-map"], [b, "no-map"]]) {
    const r = await git(repo, ["worktree", "add", "--detach", path, sha]);
    if (!r.ok) throw new Error(`could not create the ${name} worktree: ${r.error}`);
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
