/**
 * Where a checkout's code index lives, the index read back and checked, and
 * whether its last scan could not write one. Apart from `code-index.mjs`, whose
 * imports are the scan's: the Stop hook asks this and loads none of those.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { constants as zlib, gunzipSync } from "node:zlib";

import { refreshRecord } from "./facts.mjs";
import { INDEX_FILE, STORE_DIR } from "./rules.mjs";
import { resolveInside } from "./contained.mjs";
import { READ_MOST } from "./store.mjs";
import { DOC_MOST, PARAMS_MOST, SYMBOL_KINDS } from "./symbols.mjs";
import { mainCheckoutOf } from "./worktree.mjs";

export const INDEX_SCHEMA = 1;

// Past this a file is not the one a scan wrote, and is not read.
export const INDEX_MOST = READ_MOST;
export const UNZIPPED_MOST = 4 * INDEX_MOST;

/** Where the index of the repository at `root` lives, or null where its store is not inside it. */
export function indexPath(root) {
  const dir = resolveInside(root, STORE_DIR);
  return dir === null ? null : join(dir, INDEX_FILE);
}

// What a scan writes first: the schema and how many definitions follow, read off the head of a file too large to read whole.
const HEAD_BYTES = 4096;
const HEAD = /^\{"schema":(\d+),"count":(\d+),"files":\[/;

/**
 * The bytes of the file at `path` through one handle, so the file sized is the file read: all of it, or
 * only its head where it is larger than `readMost`. Null where it is no regular file, a link refused, or
 * larger than any index a scan writes.
 */
function indexBytes(path, readMost) {
  let fd;
  try {
    // O_NONBLOCK, so a FIFO planted at the path is opened rather than waited on, and refused as no file.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > INDEX_MOST) return null;
    if (stat.size <= readMost) return { whole: true, bytes: readFileSync(fd) };
    const head = Buffer.alloc(HEAD_BYTES);
    return { whole: false, bytes: head.subarray(0, readSync(fd, head, 0, HEAD_BYTES, 0)) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The index in `bytes` read whole, or null where it is not one this schema writes. */
function indexOf(bytes) {
  try {
    const index = JSON.parse(gunzipSync(bytes, { maxOutputLength: UNZIPPED_MOST }).toString("utf8"));
    return index?.schema === INDEX_SCHEMA && Array.isArray(index.files) ? wellFormed(index.files) : null;
  } catch {
    return null;
  }
}

/** How many definitions an index's head says follow, or null where the head is not one this schema writes. */
function headCount(bytes) {
  try {
    const head = HEAD.exec(gunzipSync(bytes, { finishFlush: zlib.Z_SYNC_FLUSH }).toString("utf8"));
    return head !== null && Number(head[1]) === INDEX_SCHEMA ? Number(head[2]) : null;
  } catch {
    return null;
  }
}

/** The index a scan of this repository wrote, or null where there is none this can read. */
export function readIndex(root) {
  const path = indexPath(root);
  const read = path === null ? null : indexBytes(path, Infinity);
  return read === null || read.bytes.length === 0 ? null : indexOf(read.bytes);
}

/**
 * The index that answers for `root`, the checkout it is read from and how many
 * definitions it holds: its own, or for a linked worktree whose own cannot be
 * read its main checkout's, as the map is borrowed. Null where neither reads,
 * which is the one answer the reuse check, `find` and the doctor all take. A
 * file of more than `readMost` bytes is judged by its head and handed back
 * unread, as `index: null`, so a hook never parses an index larger than its
 * time allows.
 */
export function usableIndex(root, { readMost = Infinity } = {}) {
  for (const home of [root, mainCheckoutOf(root)]) {
    const path = home === null ? null : indexPath(home);
    const read = path === null ? null : indexBytes(path, readMost);
    if (read === null || read.bytes.length === 0) continue;
    if (!read.whole) {
      const count = headCount(read.bytes);
      if (count !== null) return { home, index: null, count };
      continue;
    }
    const index = indexOf(read.bytes);
    if (index !== null) return { home, index, count: index.count };
  }
  return null;
}

/** Whether the last refresh here, or in the main checkout a worktree borrows from, recorded that its scan could not write an index. */
export function indexRefused(root) {
  return [root, mainCheckoutOf(root)].some((at) => at !== null && refreshRecord(at)?.indexed === false);
}

const KINDS = new Set(SYMBOL_KINDS);
// No name or path a scan reads runs this long; a committed index's text reaches a subagent's prompt, so it is held to what a scan writes.
const NAME_MOST = 200;
const PATH_MOST = 1024;
const textOf = (value, most) => typeof value === "string" && value.length <= most;
const textOrNull = (value, most) => value === null || textOf(value, most);
const isSymbol = (s) =>
  Array.isArray(s) &&
  s.length === 7 &&
  textOf(s[0], NAME_MOST) &&
  KINDS.has(s[1]) &&
  Number.isInteger(s[2]) &&
  textOrNull(s[3], NAME_MOST) &&
  textOrNull(s[4], PARAMS_MOST) &&
  textOrNull(s[5], DOC_MOST) &&
  Number.isInteger(s[6]);

/**
 * The rows of a read index that have the shape this writes, and the count of them: a copy a repository
 * committed is its own to write, and a row `find` cannot read whole is dropped rather than printed.
 */
function wellFormed(files) {
  const rows = files.flatMap((file) => {
    if (!Array.isArray(file) || !textOf(file[0], PATH_MOST) || (file[1] !== 0 && file[1] !== 1) || !Array.isArray(file[2])) return [];
    const symbols = file[2].filter(isSymbol);
    return symbols.length ? [[file[0], file[1], symbols]] : [];
  });
  return { schema: INDEX_SCHEMA, count: rows.reduce((n, [, , symbols]) => n + symbols.length, 0), files: rows };
}
