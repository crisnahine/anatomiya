/**
 * Where a checkout's code index lives, and whether its last scan could not write
 * one. Apart from `code-index.mjs`, whose imports are the scan's: the Stop hook
 * asks this on every turn and loads none of those.
 */
import { join } from "node:path";

import { isPathTaken, refreshRecord } from "./hook.mjs";
import { INDEX_FILE, STORE_DIR } from "./rules.mjs";
import { mainCheckoutOf } from "./worktree.mjs";

/**
 * The checkout whose code index answers for `root`: its own, or for a linked
 * worktree with none its main checkout's, as the map is borrowed. Null where
 * neither holds one.
 */
export function indexHome(root) {
  const holds = (at) => isPathTaken(join(at, STORE_DIR, INDEX_FILE));
  if (holds(root)) return root;
  const main = mainCheckoutOf(root);
  return main !== null && holds(main) ? main : null;
}

/** Whether the last refresh here, or in the main checkout a worktree borrows from, recorded that its scan could not write an index. */
export function indexRefused(root) {
  return [root, mainCheckoutOf(root)].some((at) => at !== null && refreshRecord(at)?.indexed === false);
}
