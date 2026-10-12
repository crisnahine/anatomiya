/**
 * How a file this tool writes reaches the disk: whole or not at all, staged
 * under a name a later sweep reads back to tell whose it was, and read whole to
 * put back only up to one bound.
 *
 * It imports only the path encoder, so the record, the map, the pin and the
 * refresh state all write through it without importing one another.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { encodePath } from "./encode.mjs";

/**
 * The most of one file the store reads whole: what any command reads of a
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

// The stager's process id where the name is one `owns` answers for with that added, or null.
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
    .filter(({ name, pid }) => {
      if (pid === null) return false;
      try {
        return lstatSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Write to a temp path in the same directory, then rename, so a crash never
 * leaves half a file. The pin, the refresh state and a record put back are
 * replaced through here; the map, the record's pair and the refresh lock stage
 * with `writeTemp` and decide for themselves how the file lands.
 *
 * The directory is the caller's to make. Doing it here cost one recursive
 * `mkdir` syscall per file on a caller writing a hundred of them into a
 * directory it had already created.
 */
export function atomic(path, body) {
  const tmp = writeTemp(path, body);
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

/** `body` in a new file beside `path`, whole, and that file's path. */
export function writeTemp(path, body) {
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
  const fd = openSync(tmp, "wx");
  try {
    try {
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
export function previousBytes(path) {
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
