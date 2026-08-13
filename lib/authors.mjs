import { spawn } from "node:child_process";

// A record separator git will never find inside an email address or a path.
const SEP = "\x1e";

const GIT_TIMEOUT_MS = 120_000;

/**
 * Distinct authors per file, from ONE pass over history.
 *
 * Measured: one `git log` pass is 0.03s to 0.84s regardless of file count,
 * against 103s for per-file calls on an eight-year repository, and the two
 * agree 99.6% to 100%.
 *
 * `git blame` is worse than slow, it is wrong: one repository-wide formatter
 * commit reassigns every line to the formatter, and the author gate then fails
 * on files that genuinely have three contributors.
 *
 * `-M --name-status` prints `R100 <old> <new>`, so the authors of a file's
 * earlier names union into its current name. `--name-only` prints the new path
 * alone, which loses them and failed the gate on 6.3% of files.
 *
 * `-z` because git permits newlines and tabs in paths: without it those paths
 * come back C-quoted and no longer match the corpus keys.
 *
 * The output is parsed off the stream rather than buffered. Buffering capped
 * history at whatever `maxBuffer` was set to, and overflowing it landed in the
 * same `catch` as a repository with no commits: every file came back with no
 * author, every dimension failed the author gate, and the map stated nothing
 * with nothing to say why. That ceiling used to sit behind a 50,000-file corpus
 * cap, which no longer exists.
 *
 * Returns a Map of path to a Set of emails, carrying `error` when git itself
 * failed, so a scan can tell an empty history from an unread one.
 */
export async function authorsByFile(root) {
  const map = new Map();
  const renamedTo = new Map();

  // History runs newest first, so a rename is seen before the commits that used
  // the old name, and every older path resolves forward to the name on disk.
  const current = (path) => {
    let name = path;
    for (let hops = 0; hops < 64; hops++) {
      const next = renamedTo.get(name);
      if (next === undefined || next === name) break;
      name = next;
    }
    return name;
  };

  const add = (path, email) => {
    if (!path || !email) return;
    if (!map.has(path)) map.set(path, new Set());
    map.get(path).add(email);
  };

  // The fields arrive one at a time, so what the buffered parser did with an
  // index is a position instead: after a status the next field is its path, and
  // after a rename or copy the next two are its pair. Consumed positionally so
  // a path is never read as a status.
  let email = null;
  let expect = "status";
  let from = null;
  let renaming = false;

  const onField = (field) => {
    if (expect === "path") {
      add(current(field), email);
      expect = "status";
      return;
    }
    if (expect === "from") {
      from = field;
      expect = "to";
      return;
    }
    if (expect === "to") {
      const name = current(field);
      add(name, email);
      if (renaming && from && field && from !== name) renamedTo.set(from, name);
      expect = "status";
      return;
    }

    if (!field) return;

    // The commit header ends in a newline that git leaves attached to whatever
    // follows it, glued into the same field on versions that do not terminate
    // the format with a NUL.
    let status = field;
    const header = field.indexOf(SEP);
    if (header !== -1) {
      const rest = field.slice(header + 1);
      const nl = rest.indexOf("\n");
      email = (nl === -1 ? rest : rest.slice(0, nl)).trim();
      status = nl === -1 ? "" : rest.slice(nl + 1);
    }
    status = status.replace(/^\n+/, "");
    if (!status) return;

    if (/^[RC]\d*$/.test(status)) {
      renaming = status[0] === "R";
      expect = "from";
    } else {
      expect = "path";
    }
  };

  try {
    await logStream(root, onField);
  } catch (err) {
    // A repository with no commits yields no authors, and `git log` fails on
    // it. That is a gap the author gate handles, not a failure, so the two are
    // told apart by asking whether HEAD resolves rather than by reading git's
    // message, which is translated. Anything else travels with the map: unread
    // history and empty history both state nothing, and only one is an answer.
    if ((await headState(root)) === "no-commits") return map;
    map.error = String(err && err.message ? err.message : err);
  }

  return map;
}

/**
 * Whether HEAD resolves, and if not, why.
 *
 * git separates the two by exit code: 1 is a real repository with nothing
 * committed yet, 128 is not a repository. Read from the code rather than the
 * message, which is translated.
 */
function headState(root) {
  return new Promise((fulfil) => {
    const child = spawn("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], {
      cwd: root,
      stdio: "ignore",
      timeout: GIT_TIMEOUT_MS,
    });
    child.on("error", () => fulfil("unusable"));
    child.on("close", (code) => fulfil(code === 0 ? "ok" : code === 1 ? "no-commits" : "unusable"));
  });
}

/** Feed each NUL-delimited field of the log to `onField`. */
function logStream(root, onField) {
  return new Promise((fulfil, reject) => {
    const child = spawn(
      "git",
      // Nothing follows `--`, which is the rule for every git call here: no
      // argument after it can be read as an option.
      ["log", "-M", "--no-merges", "--name-status", "-z", `--format=${SEP}%ae`, "--"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS }
    );

    let rest = Buffer.alloc(0);
    let stderr = "";
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (child.pid && !child.killed) child.kill("SIGKILL");
      reject(err);
    };

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      try {
        let at;
        while ((at = buf.indexOf(0)) !== -1) {
          onField(buf.subarray(0, at).toString("utf8"));
          buf = buf.subarray(at + 1);
        }
      } catch (err) {
        // Throwing out of a stream handler would leave the promise pending and
        // the child alive.
        return fail(err);
      }
      rest = buf;
    });

    child.on("error", (err) => fail(new Error(`git log failed: ${err.message}`)));

    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) return fail(new Error(`git log exited ${signal || code}: ${stderr.trim()}`));
      // The last record carries no trailing NUL, so a remainder here is the
      // final field rather than a truncated one.
      if (rest.length) {
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
