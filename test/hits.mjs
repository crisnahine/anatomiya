import { walkFor } from "../plugins/anatomiya/lib/dimensions.mjs";
import { collectHits } from "../plugins/anatomiya/lib/walk.mjs";

/**
 * One row's sites on one tree, collected as the scan collects them: only the
 * fields that cross the worker boundary, with the node the check places a site
 * by. A field a row emits that the boundary does not carry is not here either.
 */
export function hitsOf(row, program, extra = {}) {
  return collectHits(program, [row], extra, { walker: walkFor(row), keepNode: true })[row.key] ?? [];
}
