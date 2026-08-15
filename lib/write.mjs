import { mkdirSync, readFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderArea, renderOverview, areaFilename, isOwned, splitUncovered, PREFIX } from "./render.mjs";
import { writeFacts, atomic } from "./facts.mjs";

const RULES = ".claude/rules";
const STORE = ".claude/anatomiya";

/**
 * Write the map.
 *
 * The invariant: no rendered file exists that is not derivable from the facts
 * on disk. So facts are written first, rendering reads only what is on disk,
 * and orphans are removed last.
 */
export function writeMap(result, { dryRun = false } = {}) {
  const rulesDir = join(result.root, RULES);
  const storeDir = join(result.root, STORE);

  const withDirectives = result.areas.filter((a) => a.dimensions.length > 0);
  const uncovered = result.corpus.files - result.areas.reduce((s, a) => s + a.fileCount, 0);
  // Of those, the ones discovery found nowhere to put. The remainder sit in an
  // area that was discovered and then dropped for counting nothing, which is a
  // parse failure or a language with no dimension, not a directory too small.
  const { orphaned } = splitUncovered(uncovered, result.corpus.orphaned ?? uncovered);

  // A run that read no file of a language cannot describe this repository, so it
  // does not write over a run that could. Every file of that language is charged
  // as a failure, every area it held counts nothing and would be removed as
  // gone, and the overview would be rewritten to claim zero areas beside area
  // files that still load. `env -i PATH=/usr/bin:/bin` on a Rails repository is
  // the whole of it: three correct area files deleted in the same run that
  // reports it could not read one.
  //
  // Nothing rather than a subset, which is what a truncated corpus already gets.
  // A repository holding none of a language is not blind to it, so an empty
  // corpus still writes and still cleans up.
  const unreadable = result.parse.unreadable || [];
  const blind = unreadable.length > 0;

  const planned = new Map();
  if (!blind) {
    planned.set("anatomiya-overview.md", renderOverview(result, { uncovered, orphaned }));
    for (const a of withDirectives) planned.set(areaFilename(a), renderArea(a));
  }

  const existing = existsSync(rulesDir)
    ? readdirSync(rulesDir).filter((f) => f.startsWith(PREFIX) && f.endsWith(".md"))
    : [];

  // Removal needs all three: our prefix, our frontmatter key, and being absent
  // from this scan. A prefixed file we did not write is reported, not deleted.
  const stale = [];
  const foreign = [];
  for (const f of existing) {
    if (planned.has(f)) continue;
    const body = safeRead(join(rulesDir, f));
    if (isOwned(body)) {
      if (!blind) stale.push(f);
    } else {
      foreign.push(f);
    }
  }

  // Any file in .claude/rules/ that is not ours at all still reaches the agent.
  // It is a repository directory, so a clone can ship one, and a rule file with
  // no `paths` key loads on every turn from the moment of clone.
  const unattributed = existsSync(rulesDir)
    ? readdirSync(rulesDir).filter((f) => f.endsWith(".md") && !f.startsWith(PREFIX))
    : [];

  const plan = {
    write: [...planned.keys()],
    remove: stale,
    foreign,
    unattributed,
    uncovered,
    orphaned,
    unreadable,
  };

  if (dryRun) return plan;

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });

  // Facts too. Keeping the rendered files while replacing what they were
  // derived from breaks the invariant above, and `check` reads facts.json.
  if (!blind) writeFacts(result.root, result);
  for (const [name, body] of planned) atomic(join(rulesDir, name), body);
  for (const f of stale) {
    try {
      unlinkSync(join(rulesDir, f));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return plan;
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export const EXCLUDE_LINES = [
  `${RULES}/${PREFIX}*.md`,
  `${STORE}/`,
];
