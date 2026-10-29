import { walkFor } from "../plugins/anatomiya/lib/dimensions.mjs";
import { language } from "../plugins/anatomiya/lib/langs.mjs";
import { collectHits, fileContext } from "../plugins/anatomiya/lib/walk.mjs";

/**
 * One row's sites on one tree, collected as the scan collects them: only the
 * fields that cross the worker boundary, with the node the check places a site
 * by. A field a row emits that the boundary does not carry is not here either.
 */
export function hitsOf(row, program, extra = {}) {
  // Through the same context the bridges build, with the language the path spells where a test names none.
  const lang = extra.lang ?? (extra.rel ? language(extra.rel) : null);
  return collectHits(program, [row], fileContext({ ...extra, lang }), { walker: walkFor(row), keepNode: true })[row.key] ?? [];
}
