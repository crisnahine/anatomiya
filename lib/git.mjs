/**
 * One git runner and one reading of the `--name-status -z` record grammar.
 *
 * Both existed four times over, and the copies had drifted: one runner carried
 * a 30s timeout, two carried 120s and one carried none at all, so a git that
 * never returned took the scan with it. The grammar was three hand-rolled state
 * machines, each with its own note that a rename is three fields.
 *
 * The buffered entry point here is deliberately not the only one. Every read
 * that grows with the repository streams instead (F6), because `execFile` throws
 * `RangeError: Invalid string length` from inside Node's own exit handler and
 * `maxBuffer` does not protect against it. This is for callers that ask for one
 * bounded thing at a time: a blob, a ref, one diff.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const GIT = {
  timeoutMs: 120_000,
  maxBytes: 64 * 1024 * 1024,
  // The check runs at review time, where a git that has stopped answering is
  // worth giving up on sooner than a scan would.
  checkTimeoutMs: 30_000,
  checkMaxBytes: 32 * 1024 * 1024,
};

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
  { encoding = "utf8", maxBytes = GIT.maxBytes, timeout = GIT.timeoutMs } = {}
) {
  try {
    const { stdout } = await run("git", args, { cwd: root, encoding, maxBuffer: maxBytes, timeout });
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
