import { gitBuffered, gitStreamed } from "./git.mjs";

// A record separator git will never find inside an email address or a path.
const SEP = "\x1e";

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

  // Asked before the log rather than after it: every return below carries the
  // answer, including the one for a repository with nothing committed.
  map.shallow = await shallowHistory(root);

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
async function headState(root) {
  const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (r.ok) return "ok";
  return r.code === 1 ? "no-commits" : "unusable";
}

/**
 * How much history this clone holds, where it does not hold all of it, or null.
 *
 * `git log` succeeds on a shallow clone and returns a truthful answer about a
 * window nobody chose. Nothing above it asked whether the window was the whole
 * history, so the author count read as the team: a `--depth=1` checkout, which
 * is what `actions/checkout` does by default, held one author, dropped the
 * author bar to one and stated 484 claims where the full clone states 465.
 *
 * Null where the clone is whole, and null where the question cannot be
 * answered: a call that fails reads as not shallow, which costs a caveat rather
 * than a wrong answer (F15).
 *
 * The boundary is the grafted root, which is the oldest commit the clone holds.
 * A shallow cut across a merge can graft more than one, and `log` orders by
 * commit date rather than topologically, so the oldest is taken rather than
 * whichever line git printed last.
 */
async function shallowHistory(root) {
  const asked = await gitBuffered(root, ["rev-parse", "--is-shallow-repository"]);
  if (!asked.ok || asked.stdout.trim() !== "true") return null;
  const counted = await gitBuffered(root, ["rev-list", "--count", "HEAD"]);
  const commits = counted.ok ? Number.parseInt(counted.stdout.trim(), 10) : Number.NaN;
  const roots = await gitBuffered(root, ["log", "--format=%cI", "--max-parents=0", "--"]);
  // A value that does not read as a moment is dropped rather than compared:
  // every comparison against NaN is false, so an unparseable first entry would
  // win and shadow a real date.
  const grafted = roots.ok ? roots.stdout.trim().split("\n").filter((line) => !Number.isNaN(Date.parse(line))) : [];
  const oldest = grafted.reduce((a, b) => (a === null || Date.parse(b) < Date.parse(a) ? b : a), null);
  return { commits: Number.isFinite(commits) ? commits : null, oldest };
}

/**
 * Whether this clone keeps its blobs locally.
 *
 * `-M` scores similarity, which needs blob *content*. On a `--filter=blob:none`
 * clone that content is not here, so git fetches it from the promisor one round
 * trip at a time: a local scan makes outbound network calls nobody asked for,
 * and a clone whose promisor is unreachable cannot answer at all. 33 of 35
 * measured clones were that shape and every one of them reported "history could
 * not be read", dropped every claim to counts, and installed the map anyway.
 *
 * `-M100%` matches renames by blob OID, which the trees already carry, so it
 * answers offline. It loses rename-with-edit, which is why it is used only
 * where `-M` cannot work rather than everywhere.
 */
async function isPartialClone(root) {
  const r = await gitBuffered(root, ["config", "--get", "remote.origin.promisor"]);
  return r.ok && r.stdout.trim() === "true";
}

/**
 * Feed each NUL-delimited field of the log to `onField`.
 *
 * The rename-chain state machine above stays here, because it is this pass's
 * own reading of what the fields mean and forcing it through a shared parser
 * would cost more clarity than the sharing buys. What crosses the seam is the
 * field split alone.
 */
async function logStream(root, onField) {
  const partial = await isPartialClone(root);
  return gitStreamed(
    root,
    // Nothing follows `--`, which is the rule for every git call here: no
    // argument after it can be read as an option.
    ["log", partial ? "-M100%" : "-M", "--no-merges", "--name-status", "-z", `--format=${SEP}%ae`, "--"],
    onField,
    {
      // `--format` leaves the final record unterminated, so a remainder at exit
      // is the last commit's author rather than a truncated one.
      terminated: false,
      // Belt as well as braces on a partial clone: nothing in this walk may
      // reach the network, so a missing object fails here instead of hanging.
      env: partial ? { ...process.env, GIT_NO_LAZY_FETCH: "1" } : process.env,
    }
  );
}

/**
 * Whether an author email is a person's. GitHub mints `[bot]` into the local
 * part, and brackets are illegal in a real unquoted address, so this excludes
 * nothing a person can be called.
 */
export const isPerson = (email) => !email.includes("[bot]");

/**
 * How many people could supply author evidence at all: the authors of the files
 * this tool counts over.
 *
 * Someone who has only ever touched documentation can never appear in a
 * dimension's author set, so counting them raises a bar they cannot help clear.
 * Measured: 15 emails in one repository's log against 13 who ever touched a
 * counted source file, 154 against 131 on another.
 */
export function repoAuthorCount(files, authors) {
  const who = new Set();
  for (const f of files) for (const a of authors.get(f.rel) || []) if (isPerson(a)) who.add(a);
  return who.size;
}
