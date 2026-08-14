import { dirname } from "node:path";
import { createHash } from "node:crypto";
// The corpus' own table, or the glob delivers to less than the counts were
// taken over. Listing an extension the repository does not use matches nothing
// extra, so the list is the language's rather than the area's.
import { EXT_BY_LANG } from "./corpus.mjs";

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
 *
 * `recursive: false` gives the directory's own files and not its subtree, which
 * is what an area that shares a root with a deeper area needs.
 */
export function glob(path, langs, { recursive = true } = {}) {
  const exts = [...new Set(langs.flatMap((l) => EXT_BY_LANG[l] || []))].sort();
  // An empty list would render as `*.{}`, a glob that matches nothing and reads
  // like a working one.
  if (exts.length === 0) throw new Error(`no known extensions for langs: ${langs.join(",") || "(none)"}`);
  const ext = exts.length === 1 ? exts[0] : `{${exts.join(",")}}`;
  const tail = recursive ? `**/*.${ext}` : `*.${ext}`;
  return path === "." ? tail : `${path}/${tail}`;
}

// Ruby the extension brace cannot name. Kept beside the glob rather than
// imported from the corpus filter, because these are the names `paths` has to
// spell and that list is the one this file has to stay in step with.
const BARE_NAMES = ["Rakefile", "Gemfile", "config.ru"];

const baseName = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

// The inverse of what `glob` and `patternsFor` build. Only the extension form
// is a pattern; the bare names are a fixed list, so they are compared rather
// than spliced into a regex, which needs no escaping to get right.
const EXT_TAIL = /(?:^|\/)((?:\*\*\/)?\*\.[^/]*)$/;
const BARE_TAILS = BARE_NAMES.flatMap((n) => [`**/${n}`, n]);

/**
 * Take a pattern apart into the directory a caller may need to encode and the
 * tail it must not.
 *
 * Here rather than in the renderer, because this file is what puts the two
 * halves together and a second reading of the grammar somewhere else is a
 * second thing to keep in step. The renderer's own regex knew only the
 * extension form, so a bare name reached the path encoder whole and lost its
 * leading `**` to the markdown bullet rule.
 */
export function splitGlob(pattern) {
  const s = String(pattern ?? "");
  const negated = s.startsWith("!");
  const body = negated ? s.slice(1) : s;

  const ext = EXT_TAIL.exec(body);
  if (ext) return { negated, dir: body.slice(0, ext.index), tail: ext[1] };

  // Longest first, so `**/Rakefile` is not read as the directory `**` holding
  // the tail `Rakefile`.
  for (const tail of BARE_TAILS) {
    if (body === tail) return { negated, dir: "", tail };
    if (body.endsWith(`/${tail}`)) return { negated, dir: body.slice(0, -tail.length - 1), tail };
  }
  return { negated, dir: body, tail: null };
}

/** The extension glob for a directory, plus one pattern per bare name it holds. */
function patternsFor(dir, langs, recursive, bare) {
  const out = [glob(dir, langs, { recursive })];
  for (const name of bare) {
    const tail = recursive ? `**/${name}` : name;
    out.push(dir === "." ? tail : `${dir}/${tail}`);
  }
  return out;
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

/** Every corpus directory's recursive file count, its own file count, and its child directories. */
function corpusTree(files) {
  const under = new Map();
  const direct = new Map();
  const kids = new Map();
  for (const f of files) {
    let d = dirOf(f.rel);
    direct.set(d, (direct.get(d) || 0) + 1);
    under.set(d, (under.get(d) || 0) + 1);
    while (d !== ".") {
      const parent = dirOf(d);
      if (!kids.has(parent)) kids.set(parent, new Set());
      kids.get(parent).add(d);
      under.set(parent, (under.get(parent) || 0) + 1);
      d = parent;
    }
  }
  return { under, direct, kids };
}

/** The same counts over one area's own files, plus the directories it holds files in. */
function areaTree(files) {
  const under = new Map();
  const holds = new Set();
  for (const f of files) {
    let d = dirOf(f.rel);
    holds.add(d);
    under.set(d, (under.get(d) || 0) + 1);
    while (d !== ".") {
      const parent = dirOf(d);
      under.set(parent, (under.get(parent) || 0) + 1);
      d = parent;
    }
  }
  return { under, holds };
}

const children = (corpus, d) => [...(corpus.kids.get(d) || [])].sort();

/** A subtree holding nothing but this area's files needs one pattern and no descent. */
const whollyOwned = (corpus, mine, d) => corpus.under.get(d) === mine.under.get(d);

/** One pattern per directory the area holds files in, subtrees it wholly owns collapsed. */
function positiveCover(root, corpus, mine) {
  const out = [];
  const walk = (d) => {
    if (whollyOwned(corpus, mine, d)) return out.push({ dir: d, recursive: true, negated: false });
    if (mine.holds.has(d)) out.push({ dir: d, recursive: false, negated: false });
    for (const c of children(corpus, d)) if (mine.under.get(c)) walk(c);
  };
  walk(root);
  return out;
}

/**
 * One pattern over the whole subtree, minus the foreign subtrees below it and
 * the foreign files sitting directly in the directories it walks through.
 *
 * A directory's files always travel to one area together, since every fold
 * moves whole buckets, so a directory is entirely in the area or entirely
 * outside it. Both cases are foreign to some area, and the ceiling produces the
 * second: it can synthesize a host at a directory whose own bucket was already
 * orphaned, leaving a host that holds files under that directory and none in it.
 */
function negativeCover(root, corpus, mine) {
  const out = [{ dir: root, recursive: true, negated: false }];
  const walk = (d) => {
    if (whollyOwned(corpus, mine, d)) return;
    if ((corpus.direct.get(d) || 0) > 0 && !mine.holds.has(d)) {
      out.push({ dir: d, recursive: false, negated: true });
    }
    for (const c of children(corpus, d)) {
      if (mine.under.get(c)) walk(c);
      else out.push({ dir: c, recursive: true, negated: true });
    }
  };
  walk(root);
  return out;
}

/**
 * The globs for an area's `paths` key: the pattern set matching the files the
 * area's counts were taken over, and no others.
 *
 * One recursive glob from the area root was wrong wherever a deeper directory
 * became its own area. `app/workers/workers/**` matched
 * `app/workers/workers/google`, which had measured the same dimension over its
 * own files and been suppressed by the ratio gate at 0.64; the ancestor's
 * directive was then delivered to the directory that failed the gate, counted
 * over a population that directory is not part of. The gates stop a claim being
 * stated where the evidence does not hold, and the delivery channel was walking
 * around them.
 *
 * Two exact shapes, and the shorter wins. Measured on a 5,495-file Rails
 * repository with 156 areas: the negative shape totals 306 patterns and the
 * positive 606, but neither is uniformly smaller. An area holding ten files
 * beside five hundred child areas is one positive pattern or five hundred
 * negations. 37 of those 156 areas change; the other 119 hold a whole subtree
 * and emit the same single recursive glob they emitted before.
 */
export function assignGlobs(areas, files) {
  const corpus = corpusTree(files);
  for (const area of areas) {
    const mine = areaTree(area.files);
    const positive = positiveCover(area.path, corpus, mine);
    const negative = negativeCover(area.path, corpus, mine);
    // A tie goes to the shape with no negation: one pattern to read rather than
    // a pattern and a list of holes.
    const cover = negative.length < positive.length ? negative : positive;
    // The negations follow the pattern they cut into. Last match wins, so an
    // order that floated them to the front would exclude nothing.
    // A brace of extensions cannot spell `Rakefile`, so a file whose name
    // carries no extension needs a pattern of its own. Emitted per cover entry
    // rather than appended once, so a negation cuts the bare name out of a
    // foreign subtree exactly as it cuts the extension glob, and only for the
    // names this area actually holds, so nothing is excluded that was never
    // matched.
    const bare = BARE_NAMES.filter((n) => area.files.some((f) => baseName(f.rel) === n));
    area.globs = cover.flatMap((e) =>
      patternsFor(e.dir, area.langs, e.recursive, bare).map((p) =>
        assertGlobSafe(`${e.negated ? "!" : ""}${p}`)
      )
    );
  }
  return areas;
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
  // After the count is capped, never before: a glob is measured against the
  // areas that ended up existing, and a fold changes which subtrees are foreign.
  assignGlobs(all, files);
  all.orphaned = orphaned.concat(folded);
  return all;
}

// `globs` is filled by assignGlobs once the final area set is known, because a
// glob is defined by which other areas exist.
function build(path, files) {
  const langs = [...new Set(files.map((f) => f.lang))].sort();
  return {
    id: areaId(path),
    path,
    globs: [],
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
