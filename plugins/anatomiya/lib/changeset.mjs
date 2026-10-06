/**
 * What a branch changed: the committed diff from the fork point, the work the
 * working tree still holds, and the lines each file gained.
 *
 * Apart from the check because the end-of-turn hook asks two of these questions
 * on every stop, and taking them from the check loaded the parser and every
 * dimension for two git reads.
 */
import { isCorpusPath } from "./corpus.mjs";
import { filesAt, gitBuffered, gitStreamed, nameStatusReader, parsePorcelainRows, GIT } from "./git.mjs";

/**
 * From the fork point, never from the base branch's tip.
 *
 * The tip compared against HEAD lists, the moment the base branch moves ahead,
 * files other people changed, as reverse deltas, and the check then reports
 * findings in code the author never touched.
 *
 * `from` is already the fork point, or the oldest commit HEAD reaches, so the
 * two are compared directly. Spelled `from...HEAD`, git computes the merge
 * base a second time, which on every clone answers `from` itself and on a
 * depth-1 one, whose HEAD is grafted as a root, fails the whole diff. `head` is
 * HEAD's sha where the caller has resolved it.
 */
export async function changedFiles(root, from, head = "HEAD") {
  const rows = [];
  // The rename limit is set rather than inherited: past `diff.renameLimit`,
  // 1000 by default, git skips inexact rename detection and lists each move as
  // a deletion and an addition, and every site that came with a moved file was
  // charged to whoever moved it. Measured with the limit at 1 and two edited
  // moves: six findings on a branch that introduced none. Past this run's own
  // limit the same skip is named rather than absorbed (`renamesSkipped`).
  //
  // Submodules are left out by git rather than filtered after: a gitlink at a
  // source-like path has no blob to read, and the name-status listing carries
  // no mode to tell it by.
  // Streamed: a branch off a distant base lists every path in the repository,
  // and that is the read `execFile` answers with an uncatchable `RangeError`.
  //
  // A diff git refused to produce is not a branch that changed nothing, and the
  // two are the same empty list, so the failure is reported by exit code rather
  // than by output, the way unread history already is.
  try {
    await gitStreamed(
      root,
      [
        "-c", `diff.renameLimit=${RENAME_LIMIT}`,
        "diff", "--find-renames", "--ignore-submodules=all", "-z", "--name-status", from, head,
      ],
      nameStatusReader((row) => {
        rows.push(namedRow(row));
        return true;
      }),
      // Rename detection reads the merge base's side of each added and deleted
      // path, which a blobless clone never held; refused a fetch, the whole
      // diff failed and nothing was examined (F14).
      { timeout: GIT.checkTimeoutMs, maxFieldBytes: GIT.checkMaxBytes, lazyFetch: true }
    );
  } catch {
    return { ok: false, rows: [] };
  }
  return { ok: true, rows };
}

// Git's own default for a merge, which it chose as the size an exhaustive
// rename pass is still worth paying for; a diff's default is 1000. Past it the
// check's clock bounds the cost, and a diff that runs out of it is reported as
// unread rather than as a branch that changed nothing.
const RENAME_LIMIT = 7000;

/**
 * Whether git will have skipped inexact rename detection on this diff.
 *
 * Git's own test, over what it left unpaired: it gives up when the additions
 * times the deletions exceeds the limit squared, and whatever it skipped is
 * still unpaired afterwards, so the rows it answered with are enough to ask.
 * Git says so on stderr, which a streamed read that succeeded does not keep.
 */
export function renamesSkipped(rows, limit = RENAME_LIMIT) {
  const added = rows.filter((r) => r.status === "A").length;
  const deleted = rows.filter((r) => r.status === "D").length;
  return added * deleted > limit * limit;
}

/**
 * The diff's own vocabulary: `path` is where the file is now, and `from` is
 * where its base version is read from, which for anything but an addition is
 * the file itself.
 */
function namedRow(row) {
  return {
    status: row.status[0],
    path: row.to,
    from: row.from ?? (row.status[0] === "A" ? null : row.to),
  };
}

/** The line ranges each file gained from `from` to `to`, or to the working tree where `to` is null; null where git would not say. */
export async function addedRanges(root, from, to = "HEAD", { timeout } = {}) {
  const r = await gitBuffered(root, [
    "-c", "core.quotePath=false", "-c", `diff.renameLimit=${RENAME_LIMIT}`,
    // A repository's own config can name a diff driver, a text conversion, a
    // colour or a prefix: a command git would run, or output this cannot read.
    "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/",
    "--find-renames", "--unified=0", from,
    // `null` reads the working tree, which is what a turn changed. The `--` keeps
    // a tracked file named like a revision from being read as one.
    ...(to === null ? [] : [to]), "--",
  ], { maxBytes: GIT.checkMaxBytes, timeout: timeout ?? GIT.checkTimeoutMs });
  // Same rule as `changedFiles` (F15): a diff git refused to produce reads as a
  // file with no added lines, which drops every finding in it. `null` says the
  // ranges are unknown; an empty map would say there are none.
  if (!r.ok) return null;
  const byFile = new Map();
  let current = null;
  // A `+++` line is a file's name only between its `diff --git` line and its
  // first hunk: past that it is an added line whose own text starts with `++`.
  let inHeader = false;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      current = null;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const p = unquotePath(line.slice(4).replace(/\t$/, ""));
      current = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (current && !byFile.has(current)) byFile.set(current, []);
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    inHeader = false;
    if (!current) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) byFile.get(current).push([start, start + count - 1]);
  }
  return byFile;
}

/**
 * A name git wrote in C quotes, as the path it names.
 *
 * `core.quotePath=false` still quotes a name holding a quote, a backslash or a
 * control character, with octal escapes for the bytes, while `git status -z`
 * hands the same name over raw.
 */
export function unquotePath(text) {
  if (text.length < 2 || !text.startsWith("\"") || !text.endsWith("\"")) return text;
  const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, "\"": 34, "\\": 92 };
  const bytes = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; ) {
    if (body[i] !== "\\") {
      const ch = String.fromCodePoint(body.codePointAt(i));
      bytes.push(...Buffer.from(ch, "utf8"));
      i += ch.length;
    } else if (/^[0-7]{3}$/.test(body.slice(i + 1, i + 4))) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(ESCAPES[body[i + 1]] ?? body.charCodeAt(i + 1));
      i += 2;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The paths carrying work that is not committed yet.
 *
 * Filtered by the same predicate that decides what the check would read, not by
 * intersection with the diff: work still only in the working tree is absent
 * from the diff by definition, and that is the state this exists to reach. An
 * agent writes, checks, fixes, then commits, so the moment the findings are
 * cheapest is the moment the work is not committed.
 */
export async function pendingPaths(root, { timeout } = {}) {
  // `-uall`, because the default collapses an untracked directory to a single
  // entry ending in `/`, which is not a source path and was dropped: a wholly
  // new directory checked before its first commit read clean.
  //
  // Rename detection asked for rather than inherited, the way the committed
  // diff asks with `--find-renames`: `status` follows `status.renames`, which
  // defaults to `diff.renames`, and a user who turned that off for speed had a
  // `git mv` read as a deletion and an addition, every site that came with the
  // file charged to whoever moved it. The limit is the diff's, for the same
  // reason, and a submodule is left out the way the diff leaves it out.
  const r = await gitBuffered(
    root,
    ["-c", "status.renames=true", "-c", `status.renameLimit=${RENAME_LIMIT}`, "status", "--porcelain", "-uall", "--ignore-submodules=all", "-z"],
    { maxBytes: GIT.checkMaxBytes, timeout: timeout ?? GIT.checkTimeoutMs }
  );
  if (!r.ok) return null;
  // The old path of a move is read before the corpus filter, which asks about
  // the new one: `git mv thing_spec.rb thing_spec.rb.bak` took the spec's own
  // path out with the row, and a companion moved away in the tree still
  // satisfied its producer, where the same move committed was reported.
  const all = parsePorcelainRows(r.stdout);
  const rows = all.filter((row) => isCorpusPath(row.path));
  const gone = (row) => row.x === "D" || row.y === "D";
  // Untracked, or added to the index: there is no committed version to compare
  // against, which is what an addition is. `git add -N` writes its letter in
  // the tree column, ` A`, and read off the index column alone it was taken for
  // an edit of a file the merge base never held and skipped.
  const isNew = (row) => row.x === "?" || row.x === "A" || row.y === "A";
  return {
    present: rows
      .filter((row) => !gone(row))
      .map((row) => ({
        path: row.path,
        status: isNew(row) ? "A" : "M",
        // Where the base version is read from. A rename keeps its old path, or
        // every site in the file reads as new and a `git mv` before committing
        // charges this branch for code it never wrote.
        from: isNew(row) ? null : (row.orig ?? row.path),
      })),
    // Listed as pending with nothing to read: examined as a file, it reported
    // one file read from the tree and one it could not read, about the same
    // path, in the same run. It still reaches the obligations, because a
    // companion deleted in the tree is a companion this branch owes. A rename
    // is a deletion of the path it moved away from and says no `D` at all, so
    // that path is taken from `orig` rather than from the status letters.
    //
    // Both are candidates until `onlyInHead` asks HEAD, which is left to the
    // caller that reads them: the Stop hook reads neither and has two reads.
    deleted: [
      ...rows.filter(gone).map((row) => row.path),
      ...all.map((row) => row.orig).filter((path) => path != null && isCorpusPath(path)),
    ],
    // What left HEAD, for the report, read the way the committed diff reads it:
    // any path, and a move is no deletion.
    removed: all.flatMap((row) => !gone(row) ? [] : [row.orig ?? row.path]),
  };
}

/**
 * The pending deletions of paths HEAD holds.
 *
 * HEAD is asked rather than the letters, which spell an index-only addition
 * deleted again more than one way (`AD`, ` D` after `add -N`), and a file no
 * commit held is no companion lost. A listing git would not give keeps both.
 * `head` is HEAD's sha where the caller has resolved it.
 */
export async function onlyInHead(root, pending, head = "HEAD") {
  if (pending.deleted.length + pending.removed.length === 0) return pending;
  const atHead = await filesAt(root, head, { timeout: GIT.checkTimeoutMs, maxFieldBytes: GIT.checkMaxBytes });
  if (atHead === null) return pending;
  const held = (paths) => paths.filter((path) => atHead.has(path));
  return { ...pending, deleted: held(pending.deleted), removed: held(pending.removed) };
}

/**
 * Which pending additions have a base version after all.
 *
 * The index letter says a path is an addition, which is a fact about the index
 * and not about the merge base: `git rm --cached` and a delete-then-restore
 * both report one for a path whose committed version is right there. Read as
 * having no base, every site in the file is charged to this branch.
 *
 * One listing, and only when a row claims to be new. What it cannot answer is a
 * file moved to a name it never had: `git status` rename-detects nothing for an
 * untracked path, so that file is new until the move is committed, where
 * `--find-renames` picks it up.
 */
export async function resolvePendingBases(root, mergeBase, rows) {
  const claims = rows.filter((row) => row.from === null);
  if (!mergeBase || claims.length === 0) return;
  const atBase = await filesAt(root, mergeBase, {
    timeout: GIT.checkTimeoutMs,
    maxFieldBytes: GIT.checkMaxBytes,
  });
  if (atBase === null) return;
  for (const row of claims) {
    if (atBase.has(row.path)) row.from = row.path;
  }
}

/**
 * The diff rows, with the working tree's own edits folded in.
 *
 * A path already in the diff keeps its row, and `from` with it, so a rename
 * edited before it was committed still reads its base version from the old
 * path. A path only in the tree is a row of its own. Either way the row is
 * marked, because the head side of a marked row is read from disk and the run
 * is then not reproducible from git alone, which the report has to say.
 *
 * A path deleted in the tree leaves, the path a pending move left included:
 * judged from HEAD it was a finding on a file that no longer exists.
 */
export function withPendingEdits(rows, { present, deleted }) {
  const committed = new Map(rows.map((row) => [row.path, row]));
  const gone = new Set(deleted);
  const byPath = new Map(rows.filter((row) => !gone.has(row.path)).map((row) => [row.path, row]));
  for (const { path, status, from } of present) {
    const row = committed.get(path);
    // A row the diff already named keeps its own `from`: the diff resolved the
    // rename against the merge base, which is the comparison being made, and
    // `status` says nothing the diff has not already said better.
    if (row) {
      byPath.set(path, { ...row, tree: true });
      continue;
    }
    // A pending move names where the file sits at HEAD, and the diff says where
    // that file was at the merge base, which is the side it is judged against.
    // A move of a file the branch itself added is still an addition: read at
    // its HEAD path, the base version was missing and the file was skipped.
    const moved = from === null ? undefined : committed.get(from);
    byPath.set(path, moved
      ? { status: moved.from === null ? "A" : status, path, from: moved.from, tree: true }
      : { status, path, from, tree: true });
  }
  return [...byPath.values()];
}
