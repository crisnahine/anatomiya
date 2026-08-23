// scripts/ab/score.mjs
/**
 * Score one file the agent wrote, using the predicate the map used.
 *
 * The first A/B checked each written file by hand for `raise`, `errors.add` and
 * `Time.now`. That is a second predicate, written for one task, and it can
 * disagree with the dimension the map actually stated: the tool would report a
 * conforming file and the harness a violating one, with nothing to say which is
 * right. Going through `parseAll` and `reduceArea` makes the harness's number
 * and the map's number the same number by construction.
 *
 * `parseAll` takes a source with no path on disk, which is what this needs: the
 * file being scored lives in a worktree that is about to be deleted.
 */
import { parseAll } from "../../plugins/anatomiya/lib/parse.mjs";
import { reduceArea } from "../../plugins/anatomiya/lib/reduce.mjs";
import { classifyBasename } from "../../plugins/anatomiya/lib/dimensions-naming.mjs";

export async function scoreFile({ rel, source, lang }, { key, frameworks = [], learned = null } = {}) {
  const { records } = await parseAll([{ rel, source, lang }], { frameworks });
  const record = records.get(rel);
  if (!record || !record.ok) return null;

  // A learned row's sentence is the class the map learned. Letting the scored
  // file vote would measure it against itself: any single-class file reads
  // 1.0, whichever class it picked.
  if (learned !== null) {
    // The filename row has no worker hits; its site is the name the trial chose.
    if (key === "file_naming_case") {
      const cls = classifyBasename(rel);
      if (cls === null) return null;
      const conforming = cls === learned ? 1 : 0;
      return { candidates: 1, conforming, ratio: conforming };
    }
    const hits = (record.hits || {})[key] || [];
    if (!hits.length) return null;
    const conforming = hits.filter((h) => h.class === learned).length;
    return { candidates: hits.length, conforming, ratio: conforming / hits.length };
  }

  const area = { path: ".", langs: [lang], files: [{ rel, lang }], fileCount: 1 };
  const dims = reduceArea(area, [record], { frameworks });
  const dim = dims.find((d) => d.key === key);
  if (!dim || !dim.candidates) return null;

  return { candidates: dim.candidates, conforming: dim.conforming, ratio: dim.conforming / dim.candidates };
}
