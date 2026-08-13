import { dirname } from "node:path";
import { createHash } from "node:crypto";

export const AREA = {
  floor: [3, 8],        // a directory below the floor folds into its parent
  floorDivisor: 6,      // sqrt(N)/6 reaches the floor's ceiling of 8 at N = 2025
  ceiling: [120, 500],  // how many areas the overview's listing may hold
  filesPerArea: 16,     // the ceiling's slope: the average area may not fall below this
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The floor rises with the corpus and stops at eight.
 *
 * A fixed 5 gives a measured 2,468-file repository 209 areas of median 7 files
 * and 1.61 stated claims for the file being edited, against 127 areas of median
 * 11 and 1.81 at eight. A fixed 8 leaves a 12-file repository with no area at
 * all and every one of its files uncovered.
 */
export const areaFloor = (n) => clamp(Math.round(Math.sqrt(n) / AREA.floorDivisor), ...AREA.floor);

/**
 * A budget backstop, not a size rule: it reads "the average area holds at least
 * sixteen files" and must never bind before the floor has done its work. Where
 * it binds first, "fold the smallest until the count fits" replaces the floor,
 * which cost 26 stated claims on a measured 2,468-file repository.
 */
export const areaCeiling = (n) => clamp(Math.ceil(n / AREA.filesPerArea), ...AREA.ceiling);

const EXT_BY_LANG = { js: ["ts", "js", "mjs", "cjs"], jsx: ["tsx", "jsx"], ruby: ["rb", "rake"] };

export function areaId(path) {
  return createHash("sha256").update(path).digest("hex").slice(0, 8);
}

/**
 * A glob for the delivery channel's `paths` key.
 *
 * Never ends in a bare `/**`: the matcher strips a trailing `/**` before
 * matching, which turns "app/**" into "app" and excludes the *directory*, and
 * gitignore semantics then forbid re-including anything beneath it. So an
 * exclusion written against a bare `/**` pattern silently does nothing.
 */
export function glob(path, langs) {
  const exts = [...new Set(langs.flatMap((l) => EXT_BY_LANG[l] || []))].sort();
  // An empty list would render as `*.{}`, a glob that matches nothing and reads
  // like a working one.
  if (exts.length === 0) throw new Error(`no known extensions for langs: ${langs.join(",") || "(none)"}`);
  const ext = exts.length === 1 ? exts[0] : `{${exts.join(",")}}`;
  return path === "." ? `**/*.${ext}` : `${path}/**/*.${ext}`;
}

export function assertGlobSafe(g) {
  if (/\/\*\*$/.test(g)) {
    throw new Error(`glob ends in a bare /**, exclusions under it would silently fail: ${g}`);
  }
  return g;
}

/** Directory of a repository-relative file path, "." for the root. */
function dirOf(rel) {
  const d = dirname(rel);
  return d === "." ? "." : d;
}

/**
 * Group files into areas.
 *
 * The previous approach matched directories against a fixed table of roots
 * (`app/*`, `src/*`, ...). Measured on a real repository it put 41% of the
 * source in no area at all, and produced an unexplainable split where
 * `scripts/lib` became an area and its larger sibling `scripts/hooks` did not.
 * Any directory holding enough source is a candidate instead.
 *
 * The floor and the ceiling are resolved once from the whole corpus, and the
 * caller passes the pinned corpus size where there is one: the floor is a step
 * function, so one added file otherwise re-partitions the repository and every
 * area reads as a population change against the pin.
 */
export function discover(files, {
  minFiles = areaFloor(files.length),
  maxAreas = areaCeiling(files.length),
} = {}) {
  const byDir = new Map();
  for (const f of files) {
    const d = dirOf(f.rel);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }

  // Cumulative counts: a directory with three direct files and twenty in its
  // subtree is a real area, and a per-directory count would fold it away.
  const cumulative = new Map();
  for (const [d, fs] of byDir) {
    let cur = d;
    for (;;) {
      cumulative.set(cur, (cumulative.get(cur) || 0) + fs.length);
      if (cur === ".") break;
      cur = dirOf(cur);
    }
  }

  // Fold a directory below the floor into the nearest ancestor that clears it.
  // The root is never a target: everything that reaches it has nothing in
  // common, and its glob is `**/*` over the whole repository, so a claim
  // computed over one part of it is rendered against every other area too.
  // Files with nowhere to go are reported as uncovered instead.
  const orphaned = [];
  const merged = new Map();

  for (const [d, fs] of byDir) {
    let cur = d;
    while (cur !== "." && (cumulative.get(cur) || 0) < minFiles) cur = dirOf(cur);
    if (cur === ".") {
      orphaned.push(...fs);
      continue;
    }
    if (!merged.has(cur)) merged.set(cur, []);
    merged.get(cur).push(...fs);
  }

  // A directory clears the floor on its whole subtree, but the subtree may have
  // become its own areas and left the parent holding less than the floor. That
  // remainder is uncovered, not silently dropped.
  const areas = [];
  for (const [path, fs] of merged) {
    if (fs.length < minFiles) orphaned.push(...fs);
    else areas.push(build(path, fs));
  }

  const capped = capCount(areas, maxAreas);
  const folded = capped.orphaned || [];
  const all = capped.sort((a, b) => a.path.localeCompare(b.path));
  all.orphaned = orphaned.concat(folded);
  return all;
}

function build(path, files) {
  const langs = [...new Set(files.map((f) => f.lang))].sort();
  return {
    id: areaId(path),
    path,
    glob: assertGlobSafe(glob(path, langs)),
    langs,
    files,
    fileCount: files.length,
  };
}

/**
 * Keep the area count inside the overview's budget by folding the smallest
 * areas upward. An 85-area index costs about 1.2k tokens and a 977-area index
 * about 15.8k, so this is a hard ceiling rather than a preference.
 */
function capCount(areas, maxAreas) {
  if (areas.length <= maxAreas) return areas;

  const order = [...areas].sort((a, b) => a.fileCount - b.fileCount);
  const byPath = new Map(areas.map((a) => [a.path, a]));

  const orphaned = [];

  while (byPath.size > maxAreas && order.length) {
    // Re-read through byPath: an area that already absorbed a victim is a new
    // object, and folding the stale one loses the files it absorbed.
    const victim = byPath.get(order.shift().path);
    if (!victim) continue;

    // Fold into the nearest ancestor that is itself an area. Never into the
    // repository root: a root "area" is a bucket of everything that failed to
    // find a home, and a claim computed over it describes no code anyone works
    // on. Files with nowhere to go are reported as uncovered instead.
    let parent = dirOf(victim.path);
    while (parent !== "." && !byPath.has(parent)) parent = dirOf(parent);

    // No ancestor is an area, which happens whenever a directory holds only
    // subdirectories: `src/mod0..mod499` have no area at `src`, because no file
    // sits directly in it. Its immediate parent is still a real directory and a
    // meaningful scope, so the area is created rather than the files dropped.
    // Left alone this orphaned 76,000 of 100,000 files on a measured repository.
    const immediate = dirOf(victim.path);
    if (parent === "." && immediate !== ".") parent = immediate;

    byPath.delete(victim.path);
    if (parent === ".") {
      orphaned.push(...victim.files);
      continue;
    }

    const host = byPath.get(parent);
    const merged = build(parent, host ? host.files.concat(victim.files) : victim.files);
    byPath.set(parent, merged);
    // Creating a host is the one fold that does not shrink the map, so the new
    // area joins the queue: without it a tree of single-child directories walks
    // the queue to the end and returns more areas than the ceiling allows.
    if (!host) order.push(merged);
  }

  const out = [...byPath.values()];
  out.orphaned = orphaned;
  return out;
}
