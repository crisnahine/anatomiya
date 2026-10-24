/**
 * How a file this tool writes reaches the disk: whole or not at all, staged
 * under a name a later sweep reads back to tell whose it was, and read whole to
 * put back only up to one bound. A set of them is replaced together, and put
 * back as it was when one of them fails.
 *
 * It imports only the path encoder, so the record, the map, the pin and the
 * refresh state all write through it without importing one another.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { encodePath } from "./encode.mjs";

/**
 * The most of one file this module reads whole: what any command reads of a
 * record, and what a scan reads to put a file back, so a scan reads whole no
 * more than any command reads (A113). Over six times the largest file a scan of
 * the corpus writes (9.7 MiB, vscode's facts.json).
 */
export const READ_MOST = 64 * 1024 * 1024;

/**
 * Where a file is staged before it is renamed to `path`: beside it, under the
 * stager's process id and sixteen hex digits nobody can predict.
 */
export const stagedPath = (path, pid, hex) => `${path}.tmp-${pid}-${hex}`;

// The one reading of what `stagedPath` adds.
const STAGED = /\.tmp-(\d+)-[0-9a-f]{16}$/;

/** The stager's process id where the name is one `owns` answers for with what `stagedPath` adds, or null. */
export function stager(name, owns) {
  const added = STAGED.exec(name);
  return added !== null && owns(name.slice(0, added.index)) ? Number(added[1]) : null;
}

/**
 * The temporary files a stopped writer left in the store, each with the process
 * that staged it: a regular file whose whole name is one of `names` and what
 * the stager adds. Never a link, a directory or a fifo, and never another name,
 * since the directory comes with the repository.
 */
export function stagedInStore(dir, names) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .sort()
    .map((name) => ({ name, pid: stager(name, (staged) => names.includes(staged)) }))
    .filter(({ name, pid }) => pid !== null && isFileAt(join(dir, name)));
}

/** Whether a regular file is at `path`, asked of the name itself: a link is not one, and neither is a name that will not stat. */
export function isFileAt(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Write to a temp path in the same directory, then rename, so a crash never
 * leaves half a file. The pin, the refresh state and a file put back are
 * replaced through here; the map, the record's pair and the refresh lock stage
 * with `writeTemp` and decide for themselves how the file lands.
 *
 * The directory is the caller's to make. Doing it here cost one recursive
 * `mkdir` syscall per file on a caller writing a hundred of them into a
 * directory it had already created.
 */
export function atomic(path, body) {
  // A file replaced keeps its mode, as one written in place does: a person's 0600 settings stay theirs alone.
  const tmp = writeTemp(path, body, fileMode(path));
  try {
    // Replaces the destination entry itself, never what a link there names.
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

// The permission bits of a regular file at `path`; null for anything else or nothing.
function fileMode(path) {
  try {
    const entry = lstatSync(path);
    return entry.isFile() ? entry.mode & 0o7777 : null;
  } catch {
    return null;
  }
}

/**
 * `body` in a new file beside `path`, whole, and that file's path. Given a
 * `mode`, the file has it before a byte is written, so the bytes are never in a
 * file more open than the one they replace.
 */
export function writeTemp(path, body, mode = null) {
  // Unpredictable, and created exclusively: `wx` is O_CREAT|O_EXCL, which
  // refuses any entry already there, a planted link included, and never follows
  // one. The name was `<path>.tmp-<pid>`, opened with a plain write, so a
  // repository shipping that name as a tracked symlink had the map's bytes
  // written wherever it pointed. The directories were resolved (F2); this
  // leaf was not.
  const tmp = stagedPath(path, process.pid, randomBytes(8).toString("hex"));
  // Created on its own, and written inside the cleanup: a write that fails part
  // way, on a full disk, has already made the temp file, and ENOSPC out of a
  // single `writeFileSync` before the `try` left it beside the map. A create
  // that fails made nothing, so there is nothing of this call's to remove, and
  // an entry already at that name is somebody else's.
  const fd = openSync(tmp, "wx", mode ?? 0o666);
  try {
    try {
      // The umask can narrow what the create asked for; a filesystem that keeps no mode leaves it narrower.
      if (mode !== null && (fstatSync(fd).mode & 0o7777) !== mode) {
        try {
          fchmodSync(fd, mode);
        } catch {}
      }
      writeFileSync(fd, body);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
  return tmp;
}

/**
 * The size of a regular file at `path` past `READ_MOST`, or null: what a
 * scan asks before it plans to replace or remove the file.
 */
export function tooLargeToPutBack(path) {
  try {
    const entry = lstatSync(path);
    return entry.isFile() && entry.size > READ_MOST ? entry.size : null;
  } catch {
    return null;
  }
}

/** The refusal's first half for such a file, named by the repository's spelling of it. */
export const tooLargeSentence = (at, size) => `${encodePath(at)} is ${size} bytes, past the ${READ_MOST / 2 ** 20} MiB a scan reads to put a file back`;

/**
 * A regular file's bytes, `null` where nothing is, `undefined` where they cannot
 * be put back. Past `READ_MOST` it throws, with the size on `tooLarge`.
 */
function previousBytes(path) {
  let fd;
  try {
    // Opened then typed through the handle, so the file read is the file typed;
    // O_NOFOLLOW refuses a link the way lstat did.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return undefined;
    if (stat.size > READ_MOST) throw Object.assign(new Error(tooLargeSentence(path, stat.size)), { tooLarge: stat.size });
    return readFileSync(fd);
  } catch (err) {
    if (err.tooLarge !== undefined) throw err;
    return err.code === "ENOENT" ? null : undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** `previousBytes` of a record, `null` past the bound: no command reads one, so there is nothing in it to keep. */
export function recordBytes(path) {
  try {
    return previousBytes(path);
  } catch (err) {
    if (err.tooLarge === undefined) throw err;
    return null;
  }
}

/**
 * `previous`, as `previousBytes` or `recordBytes` read it, back at `path`:
 * removed where nothing was or a record was past the bound, left where it
 * could not be read, and otherwise replaced whole.
 */
export function putBack(path, previous) {
  if (previous === undefined) return;
  if (previous === null) unlinkSync(path);
  else atomic(path, previous);
}

export const PUT_BACK = "stopped and put back what it had replaced";

// What a rename or a removal answers where it is not allowed. On Windows: `EPERM` for a target held open or
// read-only, `EBUSY` for a sharing violation. Elsewhere: `EPERM` for an immutable file, `EACCES` for a directory
// that cannot be written.
export const LOCKED = ["EPERM", "EACCES", "EBUSY"];

// `locked` carries the sentence's first half, for the rollback to say what it put back.
function lockedFile(err, at, verb) {
  if (!LOCKED.includes(err.code)) return err;
  return Object.assign(new Error(err.message, { cause: err }), { locked: `${at} could not be ${verb} (${err.code})` });
}

export const UNLOCK = "close what holds it or change its mode";

const lockedSentence = (locked, did) => `${locked}, so the scan ${did}: the file is locked or read-only, so ${UNLOCK}, then scan again`;

// `moved` names the directory, for the rollback to say what it could not reach.
export function movedAway(dir, did) {
  const sentence = `${dir} was replaced by something else while the map was being written, so the scan ${did}: look at what is at ${dir} now, then scan again`;
  return Object.assign(new Error(sentence), { moved: dir });
}

/**
 * Rename every staged file into place and remove the orphans, or put back what
 * was there before the first one moved. `stillOwn` throws for a path whose
 * directory is no longer where the plan found it. A path in `pair.leftover` is
 * removed unread and never put back, and one whose removal fails goes on
 * `pair.left` and stops nothing. One in `pair.records` past the bound is
 * replaced without being read and taken back out on a rollback. The record at
 * `pair.record` is put back by `pair.restore(previous)`, which writes its
 * layout file again only where one answered for it; every other path by
 * `putBack`.
 *
 * A rename in a directory the temporary file was just created in still fails:
 * Windows refuses one over a file another process holds open. `said` names a
 * path for the sentence that failure gets.
 *
 * Where `pair.spared` answers for the path with a target, that failure stops
 * the target's directory alone: `pair.settle` writes the record again to name
 * what that directory held, then what was replaced there is put back and
 * nothing more is done there. A permission in a directory another tool owns
 * may not stop Claude Code's map. Answers the targets stopped that way, each
 * with what stopped it.
 */
export function replaceAll(staged, removals, pair, stillOwn, said) {
  // Read before the first rename, so the window between the facts and the last
  // file holds renames and nothing else.
  const kept = removals.filter((path) => !pair.leftover.has(path));
  const before = new Map([...staged.map(([, path]) => path), ...kept].map((p) => [p, pair.records.has(p) ? recordBytes(p) : bytesToPutBack(p, said)]));
  const undo = [];
  const stopped = new Map();
  const past = (path) => stopped.has(pair.spared(path)?.id);
  // Put one directory back and go on without it, or throw for the whole scan to be put back.
  const stop = (err, path) => {
    const t = pair.spared(path);
    if (t === null || !err.locked) throw err;
    // The record first, so a process killed from here on leaves one that names the files the directory holds.
    try {
      pair.settle(new Set([...stopped.keys(), t.id]));
    } catch (failed) {
      throw lockedFile(failed, said(pair.record), "replaced");
    }
    for (let i = undo.length - 1; i >= 0; i--) {
      const [done, previous] = undo[i];
      if (pair.spared(done) !== t) continue;
      try {
        stillOwn(done);
        putBack(done, previous);
      } catch {
        // Not as it was, so not a directory to go on without.
        throw err;
      }
      undo.splice(i, 1);
    }
    for (const [tmp, to] of staged) if (pair.spared(to) === t) quietUnlink(tmp);
    stopped.set(t.id, err.locked);
  };
  try {
    for (const [tmp, path] of staged) {
      if (past(path)) continue;
      stillOwn(path);
      try {
        renameSync(tmp, path);
      } catch (err) {
        // A directory swapped since the look above fails here on an errno, so it is asked once more.
        stillOwn(path);
        stop(lockedFile(err, said(path), "replaced"), path);
        continue;
      }
      undo.push([path, before.get(path)]);
    }
    for (const path of removals) {
      if (past(path)) continue;
      stillOwn(path);
      try {
        unlinkSync(path);
      } catch (err) {
        if (err.code === "ENOENT") continue;
        // Litter, and never a reason to stop: one that will not go stays, and the scan says how many did.
        if (pair.leftover.has(path)) {
          pair.left.push(path);
          continue;
        }
        stop(lockedFile(err, said(path), "removed"), path);
        continue;
      }
      // A leftover has no bytes here, which the put-back reads as one to leave gone.
      undo.push([path, before.get(path)]);
    }
    return stopped;
  } catch (err) {
    let lost = 0;
    for (const [path, previous] of undo.reverse()) {
      try {
        // The layout file is stamped from the record alone, so only the
        // record's put-back writes it again. Nothing is put back through a
        // directory that stopped being the repository's own.
        stillOwn(path);
        if (path === pair.record) pair.restore(previous);
        else putBack(path, previous);
      } catch {
        lost++;
      }
    }
    // What this run had already put in a directory went with it when it moved.
    if (err.moved && lost > 0) err.message = movedAway(err.moved, `${PUT_BACK} everywhere else`).message;
    if (err.locked) err.message = lockedSentence(err.locked, lost > 0 ? "stopped part way" : PUT_BACK);
    throw err;
  }
}

// `previousBytes`, with a file grown past the bound since the plan refused by the repository's spelling of it.
function bytesToPutBack(path, said) {
  try {
    return previousBytes(path);
  } catch (err) {
    if (err.tooLarge === undefined) throw err;
    throw tooLarge(said(path), err.tooLarge);
  }
}

export const MOVE_IT = "move or delete it";
export const tooLarge = (at, size) => new Error(`${tooLargeSentence(at, size)}, so nothing was written: ${MOVE_IT} and scan again`);

/** Removes `path`, and says nothing where it is gone already or the system will not remove it. */
export function quietUnlink(path) {
  try {
    unlinkSync(path);
  } catch {}
}
