/**
 * Every git call this tool makes, and every reading of the NUL record grammars
 * it answers in.
 *
 * All of it existed four times over, and the copies had drifted: one runner
 * carried a 30s timeout, two carried 120s and one carried none at all, so a git
 * that never returned took the scan with it. The `--name-status -z` grammar was
 * three hand-rolled state machines, each with its own note that a rename is
 * three fields, and the porcelain grammar a fourth.
 *
 * Two entry points, because the split is real rather than incidental (F6).
 * `gitBuffered` is for callers that ask for one bounded thing at a time: a blob,
 * a ref, one diff. Every read that grows with the repository goes through
 * `gitStreamed`, because `execFile` throws `RangeError: Invalid string length`
 * from inside Node's own exit handler and `maxBuffer` does not protect against
 * it. Both carry the same battery: a timeout, a byte bound, and an exit code no
 * caller may read output without.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { MAX_FILE_BYTES } from "./limits.mjs";

const run = promisify(execFile);

export const GIT = {
  timeoutMs: 120_000,
  maxBytes: 64 * 1024 * 1024,
  // The check runs at review time, where a git that has stopped answering is
  // worth giving up on sooner than a scan would.
  checkTimeoutMs: 30_000,
  checkMaxBytes: 32 * 1024 * 1024,
};

// Enough to name the failure. Everything past it is the same message again.
const STDERR_CAP = 4096;

/**
 * Every call reports its exit code beside its output, and no caller may read
 * stdout without looking at `ok`.
 *
 * `git merge-base` exits 1 with empty stdout and no stderr when the two commits
 * have no common ancestor. Code that captures stdout alone cannot tell that from
 * a successful answer, and passes "" downstream as if it were a sha.
 */
export async function gitBuffered(
  root,
  args,
  { encoding = "utf8", maxBytes = GIT.maxBytes, timeout = GIT.timeoutMs, env = process.env } = {}
) {
  try {
    const { stdout } = await run("git", args, { cwd: root, encoding, maxBuffer: maxBytes, timeout, env });
    return { ok: true, code: 0, oversize: false, stdout, error: null };
  } catch (err) {
    const message = String((err && err.message) || err);
    return {
      ok: false,
      code: err && typeof err.code === "number" ? err.code : null,
      oversize: /maxBuffer/.test(message),
      // A call that failed answered part of a question at best, and the whole
      // point of reporting `ok` is that the part is never read as the answer.
      stdout: encoding === "buffer" ? Buffer.alloc(0) : "",
      error: message,
    };
  }
}

/**
 * The other entry point: output read off the stream, one NUL-delimited field at
 * a time (F6).
 */
export function gitStreamed(
  root,
  args,
  onField,
  { terminated = true, timeout = GIT.timeoutMs, env = process.env, maxFieldBytes = GIT.maxBytes } = {}
) {
  return new Promise((fulfil, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout, env });
    let rest = Buffer.alloc(0);
    let stderr = "";
    let stopped = false;
    let settled = false;

    // A caller that has seen enough gets the child killed rather than the rest
    // of the listing read and thrown away, on the repositories where the
    // listing is largest.
    const stop = () => {
      stopped = true;
      rest = Buffer.alloc(0);
      if (child.pid && !child.killed) child.kill("SIGKILL");
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      stop();
      reject(err);
    };

    // Capped, because stderr grows with the repository the same way stdout
    // does and the message only has to name the failure.
    child.stderr.on("data", (chunk) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      try {
        let at;
        while ((at = buf.indexOf(0)) !== -1) {
          const field = buf.subarray(0, at).toString("utf8");
          buf = buf.subarray(at + 1);
          if (onField(field) === false) return stop();
        }
      } catch (err) {
        // Throwing out of a stream handler would leave the promise pending and
        // the child alive.
        return fail(err);
      }
      // What is left is one record still arriving. Unbounded, it grows to V8's
      // string limit and throws from a place no caller can catch, which is the
      // failure streaming exists to avoid.
      if (buf.length > maxFieldBytes) {
        return fail(new Error(`git ${args[0]} sent one record past ${maxFieldBytes} bytes`));
      }
      rest = buf;
    });

    child.on("error", (err) => fail(new Error(`git ${args[0]} failed: ${err.message}`)));

    child.on("close", (code, signal) => {
      if (settled) return;
      // A walk this caller ended is not a walk that failed, however the killed
      // child exits.
      if (stopped) {
        settled = true;
        return fulfil();
      }
      // A caller of a stream has already been handed part of the output, so
      // the only way to say "that was not the answer" is to refuse the whole
      // read (F13, F15).
      if (code !== 0) return fail(new Error(`git ${args[0]} exited ${signal || code}: ${stderr.trim()}`));
      // Whether a leftover is the final record or a cut-off one is a fact about
      // the command, not about the caller: `ls-files -z` terminates every entry
      // and `log --format=` terminates none of them.
      if (rest.length) {
        if (terminated) return fail(new Error(`git ${args[0]} output ended mid-record`));
        // Guarded for the same reason the record loop is, and in the one branch
        // that runs after the child has gone: an escaping throw is an uncaught
        // exception beside a promise that never settles.
        try {
          onField(rest.toString("utf8"));
        } catch (err) {
          return fail(err);
        }
      }
      settled = true;
      fulfil();
    });
  });
}

/**
 * `-z` because git permits newlines in a path, and a newline split would turn
 * one hostile filename into two entries. A rename or a copy record is three
 * NUL-separated fields, everything else is two.
 *
 * A record cut in half by a byte cap is dropped rather than completed: emitting
 * the field that arrived would name a file the diff never reported.
 */
export function parseNameStatusZ(out) {
  const fields = String(out ?? "").split("\0");
  const rows = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    if (!status) {
      i++;
      continue;
    }
    const renamed = status[0] === "R" || status[0] === "C";
    const from = renamed ? fields[i + 1] : null;
    const to = renamed ? fields[i + 2] : fields[i + 1];
    if (!to) break;
    rows.push({ status, from: from || null, to });
    i += renamed ? 3 : 2;
  }
  return rows;
}

/**
 * The paths `git status --porcelain -z` reports as dirty.
 *
 * The other NUL grammar, and the second place a rename is an extra field: a
 * record is `XY <path>`, and a rename or a copy is followed by its origin as a
 * bare field. Read as another record it counts the rename twice and takes the
 * three status characters off the old name.
 *
 * Beside `parseNameStatusZ` rather than in the check, so the note that a rename
 * carries two paths lives once for both of git's spellings of it.
 */
export function parsePorcelainZ(out) {
  const fields = String(out ?? "").split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2))) i++;
  }
  return paths;
}

/* --- the plumbing every phase reads a repository through --- */

/**
 * Reading a repository, separated from deciding what the reading means. A base
 * ref has nothing to do with a baseline, and both phases resolve one.
 */

// A sha reaches a git argument, so it is validated as a sha rather than trusted
// as a string: a pin file is a repository-controlled input like any other.
export function isSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha);
}

// A ref name cannot begin with a dash. `rev-parse` takes revisions before any
// `--`, so a ref of `--upload-pack=...` would be read as an option; a tracked
// file with that name already exfiltrated a secret through the same class of
// argument elsewhere.
function safeRef(ref) {
  return typeof ref === "string" && ref.length > 0 && !ref.startsWith("-");
}

/**
 * Is the baseline commit still in this repository at all?
 *
 * Squash-merge-to-main is the common workflow, not the edge: the branch's
 * commits never land, and after the branch is deleted the pinned sha names an
 * object that no longer exists. Every caller checks this before reading a blob,
 * and drops to counts-only when it fails (E3).
 */
export async function shaReachable(root, sha) {
  if (!isSha(sha)) return false;
  const r = await gitBuffered(root, ["cat-file", "-e", `${sha}^{commit}`]);
  return r.ok;
}

/**
 * The commit a pin would record. Never a ref name: a pin holds a sha because a
 * branch moves and the population it named would move with it.
 */
export async function headSha(root) {
  const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const sha = r.ok ? r.stdout.trim() : "";
  return isSha(sha) ? sha : null;
}

/**
 * The contents of one path as of the baseline commit (E2).
 *
 * Never the working tree. Reading the working tree makes the baseline and the
 * current population the same numbers, so an agent that edits three of fourteen
 * baseline files moves the baseline it is being measured against.
 *
 * `git cat-file blob` is `git show <sha>:<path>` with the object type asserted,
 * so a path that has since become a directory errors instead of quietly
 * yielding a tree listing that would then be parsed as source.
 *
 * An empty file returns ok with empty content; an absent path returns not-ok.
 * The two must never collapse into the same value.
 *
 * The read gives up at exactly the size the parser skips at, which is what makes
 * a blob this refuses one the parse would have refused anyway. A caller may
 * widen it; none does.
 *
 * The clock is the caller's. The scan and the check do not agree about how long
 * to wait on a stalled git, and this is the check's most frequent call.
 */
export async function showBlob(root, sha, path, { maxBytes = MAX_FILE_BYTES, timeout, env } = {}) {
  if (!isSha(sha)) return { ok: false, reason: "bad sha" };
  const r = await gitBuffered(root, ["cat-file", "blob", `${sha}:${path}`], {
    encoding: "buffer",
    maxBytes,
    ...(timeout === undefined ? {} : { timeout }),
    ...(env === undefined ? {} : { env }),
  });
  if (r.ok) return { ok: true, content: r.stdout };
  return { ok: false, reason: r.oversize ? "over size cap" : "absent" };
}

/**
 * The merge base of two commits, with the three outcomes kept apart: found,
 * genuinely no common ancestor (exit 1, empty stdout, no stderr), and the
 * command failing for some other reason.
 */
export async function mergeBase(root, a, b) {
  if (!safeRef(a) || !safeRef(b)) return { found: false, failed: true, sha: null };
  const r = await gitBuffered(root, ["merge-base", a, b]);
  if (r.ok) {
    const sha = r.stdout.trim();
    return { found: sha.length > 0, failed: false, sha: sha || null };
  }
  return { found: false, failed: r.code !== 1, sha: null };
}

/**
 * The refs a base is looked for in, in order. `origin/HEAD` names the remote's
 * default branch, which is what a change is actually reviewed against.
 *
 * `@{upstream}` is deliberately absent: a pushed feature branch tracks itself,
 * and the merge base of HEAD with itself is HEAD.
 */
export const BASE_REFS = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

/**
 * The commit the change under review is built on.
 *
 * Never HEAD (E6). Over `<baseline>..HEAD` the branch's own edits count as map
 * drift, so a claim's reported staleness rises with the size of the change
 * being reviewed and bundling more files into a branch walks it past the
 * threshold. The literal ref is refused rather than quietly accepted.
 *
 * This is the only base resolver: scan and check measuring drift against
 * different refs is two different answers to one question.
 */
export async function resolveBaseRef(root, ref = null) {
  if (ref === "HEAD" || ref === "@") {
    return { ok: false, reason: "base ref must not be HEAD" };
  }
  if (ref !== null && !safeRef(ref)) {
    return { ok: false, reason: `not a ref name: ${ref}` };
  }

  const tried = ref ? [ref] : BASE_REFS;
  for (const candidate of tried) {
    const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    const sha = r.ok ? r.stdout.trim() : "";
    if (!sha) continue;

    // The fork point, where one exists, so the branch's own commits sit outside
    // the range. Unrelated histories fall back to the ref tip rather than to "".
    const base = await mergeBase(root, "HEAD", sha);
    return { ok: true, ref: candidate, sha: base.found ? base.sha : sha, forkPoint: base.found };
  }
  return { ok: false, reason: ref ? `cannot resolve ${ref}` : "no base branch found" };
}

/**
 * Paths whose working-tree content differs from `sha`.
 *
 * Everything tracked and absent from this set is byte-identical to the commit,
 * so its baseline parse and its corpus parse are the same parse. Without this
 * the baseline stage re-reads and re-parses the whole population through one
 * `git cat-file` process per file, which measured 6.9s against 1.4s to parse
 * the entire corpus, on a repository where nothing had changed at all.
 *
 * `null` rather than an empty set when git will not answer: an empty set claims
 * every file is unchanged, which is the unsafe direction.
 */
export async function changedSinceWorktree(root, sha) {
  if (!safeRef(sha)) return null;
  // No `--find-renames`: a rename lands here as both paths, and both are then
  // materialised rather than reused. Cheap, and it keeps the reuse rule simple.
  const r = await gitBuffered(root, ["diff", "--name-only", "-z", sha, "--"]);
  if (!r.ok) return null;
  return new Set(r.stdout.split("\0").filter(Boolean));
}

/**
 * Every tracked path at one commit.
 *
 * A file-to-file obligation is answered by which files exist, so measuring it
 * against the baseline needs the baseline's file list and not the working
 * tree's. An unreadable commit comes back empty, which the caller reads as a
 * population it cannot count rather than as a repository with no files.
 */
export async function filesAt(root, sha) {
  // The rev goes before the separator: git reads anything past `--` as a path.
  const r = await gitBuffered(root, ["ls-tree", "-r", "--name-only", "-z", sha, "--"]);
  if (!r.ok) return new Set();
  return new Set(r.stdout.split("\0").filter(Boolean));
}

/**
 * Renames and changed paths between two commits, in one pass.
 *
 * NUL-delimited because git permits newlines in paths, the same reason the
 * corpus is collected with `ls-files -z`. Rename records arrive as three
 * fields, everything else as two.
 */
export async function diffRange(root, from, to) {
  // `${from}..` puts a leading dash at the head of the argument, where git
  // reads it as an option.
  if (!safeRef(from) || !safeRef(to)) return null;

  const r = await gitBuffered(root, ["diff", "--find-renames", "--name-status", "-z", `${from}..${to}`, "--"]);
  if (!r.ok) return null;

  const renames = new Map();
  const changed = new Set();

  for (const row of parseNameStatusZ(r.stdout)) {
    changed.add(row.to);
    // Both names count as changed: at the pinned commit only the old one
    // exists, and the map is what lets a renamed file find its own baseline
    // instead of reading as greenfield (E7).
    if (row.from) {
      renames.set(row.to, row.from);
      changed.add(row.from);
    }
  }

  return { renames, changed };
}
