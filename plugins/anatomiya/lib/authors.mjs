import { Unasked, answered, gitBuffered } from "./git.mjs";
import { SEP, historyFields } from "./history.mjs";

/**
 * Distinct authors per file, from one read of history in git's order: one
 * `git log` pass, or the same commits replayed from a store (`history.mjs`).
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
 *
 * `history` is one scan's: with it the commits a store already holds are
 * replayed and only the rest are asked of git (`history.mjs`).
 */
export async function authorsByFile(root, { history = null } = {}) {
  // Asked before the log rather than after it: the map carries the answer
  // however the log goes, a repository with nothing committed included.
  let shallow = null;
  let reader = authorsReader();
  let error;
  try {
    shallow = await shallowHistory(root);
    // A read given up part way starts over, and the reader with it.
    await logStream(root, () => (reader = authorsReader()).onField, history);
  } catch (err) {
    // A repository with no commits yields no authors, and `git log` fails on
    // it. That is a gap the author gate handles, not a failure, so the two are
    // told apart by asking whether HEAD resolves rather than by reading git's
    // message, which is translated. Anything else travels with the map: unread
    // history and empty history both state nothing, and only one is an answer.
    // A question git could not be asked is unread history whatever HEAD says.
    if (err instanceof Unasked || (await headState(root)) !== "no-commits") error = String(err && err.message ? err.message : err);
  }
  const { map } = reader;
  map.shallow = shallow;
  if (error !== undefined) map.error = error;
  return map;
}

/** The map one walk builds, and the reader that builds it a field at a time. */
function authorsReader() {
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
      // Case folded, because git's own mailmap matching ignores it and an
      // address typed in capitals once is not a second person.
      email = (nl === -1 ? rest : rest.slice(0, nl)).trim().toLowerCase();
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

  return { map, onField };
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
 * Null where the clone is whole, and where git ran and gave any other answer.
 * It throws where git could not be asked: read as whole, a window states the
 * claims above, so the history is unread. A count or a root that could not be
 * read leaves the clone shallow with that part unknown.
 *
 * The boundary is the grafted root, which is the oldest commit the clone holds.
 * A shallow cut across a merge can graft more than one, and `log` orders by
 * commit date rather than topologically, so the oldest is taken rather than
 * whichever line git printed last.
 */
async function shallowHistory(root) {
  const asked = answered(await gitBuffered(root, ["rev-parse", "--is-shallow-repository"]), "whether this clone holds its whole history");
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
 *
 * Any remote can be the promisor, not only `origin`: `git clone -o upstream
 * --filter=blob:none` marks `remote.upstream.promisor`. A clone sets
 * `extensions.partialClone` to its promisor's name, and each remote's own
 * flag covers a promisor added after the clone: one read answers for both.
 *
 * It throws where git cannot be asked, and where a flag holds a value git
 * refuses as a boolean, which its own `log` dies on. "Not partial" is an
 * answer, and one given on a guess picks `-M` for a clone that needs
 * `-M100%`: the map then differs from one scan to the next.
 */
async function isPartialClone(root) {
  const asked = await gitBuffered(root, ["config", "--null", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"]);
  // Exit code 1 is git saying neither key is set.
  if (!asked.ok && asked.code !== 1) throw new Error(`git could not say whether this clone is partial: ${asked.error.trim()}`);
  let extension;
  let flagged = false;
  // A key and its value a line apart, and a key with no value alone.
  for (const [key, value] of asked.stdout.split("\0").filter(Boolean).map((entry) => entry.split(/\n(.*)/s, 2))) {
    if (key === "extensions.partialclone") {
      extension = value;
      continue;
    }
    const flag = gitBoolean(value);
    if (flag === null) throw new Error(`git could not say whether this clone is partial: ${key} holds no boolean git reads`);
    // git makes a promisor of the remote at the first value that is true, whatever a later one says.
    flagged ||= flag;
  }
  return flagged || Boolean(extension?.trim());
}

/**
 * A configuration value as git reads a boolean, or null where git refuses it:
 * a key with no value is true and an empty one false, then the words in any
 * case, then an integer as `strtoimax` reads one with base 0 (`0x10`, `010`),
 * which a `k`, `m` or `g` scales and which must fit an `int`. Any but zero is true.
 */
function gitBoolean(value) {
  if (value === undefined) return true;
  if (value === "") return false;
  if (/^(?:true|yes|on)$/i.test(value)) return true;
  if (/^(?:false|no|off)$/i.test(value)) return false;
  const number = /^[ \t\n\v\f\r]*([+-]?)(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)([kmg]?)$/i.exec(value);
  if (number === null) return null;
  const [, sign, digits, unit] = number;
  const size = BigInt(/^0[0-7]/.test(digits) ? `0o${digits.slice(1)}` : digits) * 1024n ** BigInt(["", "k", "m", "g"].indexOf(unit.toLowerCase()));
  // git 2.54 takes the least `int` and 2.39 refuses it; read as true, the log of a git that refuses it says so itself.
  if (size > 2n ** 31n - (sign === "-" ? 0n : 1n)) return null;
  return size !== 0n;
}

/**
 * Feed each NUL-delimited field of the log to the reader `open` answers with.
 *
 * The rename-chain state machine above stays here, because it is this pass's
 * own reading of what the fields mean and forcing it through a shared parser
 * would cost more clarity than the sharing buys. What crosses the seam is the
 * field split alone.
 */
async function logStream(root, open, history) {
  const partial = await isPartialClone(root);
  return historyFields(
    root,
    {
      kind: "authors",
      renames: true,
      // `log.showRoot=false` prints no diff for a root commit, so every file the
      // first commit added would carry no author: forced back on, as git ships it.
      config: ["-c", "log.showRoot=true"],
      tip: [],
      walk: ["--no-merges"],
      // `%aE`, which the walk asks for, is the address after the repository's
      // .mailmap, so a person the repository has already said is one person
      // under two addresses is counted once.
      diff: [partial ? "-M100%" : "-M", "--name-status", "-z"],
      cap: [],
      // Belt as well as braces on a partial clone: nothing in this walk may
      // reach the network, so a missing object fails here instead of hanging.
      env: partial ? { ...process.env, GIT_NO_LAZY_FETCH: "1" } : process.env,
    },
    open,
    { history }
  );
}

/**
 * Whether an author email is a person's. GitHub mints `[bot]` into the local
 * part, and brackets are illegal in a real unquoted address, so this excludes
 * nothing a person can be called.
 */
export function isPerson(email) {
  return !email.includes("[bot]");
}

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
  for (const f of files) for (const a of authors.get(f.rel) ?? []) if (isPerson(a)) who.add(a);
  return who.size;
}
