/**
 * Where a checkout's code index lives, the index read back and checked, and
 * whether its last scan could not write one. Apart from `code-index.mjs`, whose
 * imports are the scan's: the Stop hook asks this and loads none of those.
 */
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { refreshRecord } from "./hook.mjs";
import { INDEX_FILE, resolveInside, STORE_DIR } from "./rules.mjs";
import { READ_MOST, recordBytes } from "./store.mjs";
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

/** The index a scan of this repository wrote, or null where there is none this can read. */
export function readIndex(root) {
  const path = indexPath(root);
  if (path === null) return null;
  try {
    // Typed and read through one handle, a link refused, so the file read is the file checked.
    const bytes = recordBytes(path);
    if (!bytes) return null;
    const index = JSON.parse(gunzipSync(bytes, { maxOutputLength: UNZIPPED_MOST }).toString("utf8"));
    return index?.schema === INDEX_SCHEMA && Array.isArray(index.files) ? wellFormed(index.files) : null;
  } catch {
    return null;
  }
}

/**
 * The index that answers for `root` and the checkout it is read from: its own,
 * or for a linked worktree whose own cannot be read its main checkout's, as the
 * map is borrowed. Null where neither reads, which is the one answer the reuse
 * check, `find` and the doctor all take.
 */
export function usableIndex(root) {
  for (const home of [root, mainCheckoutOf(root)]) {
    const index = home === null ? null : readIndex(home);
    if (index !== null) return { home, index };
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
