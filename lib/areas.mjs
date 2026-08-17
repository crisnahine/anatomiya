import { dirname } from "node:path";
import { createHash } from "node:crypto";
// The registry's own table, or the glob delivers to less than the counts were
// taken over. Listing an extension the repository does not use matches nothing
// extra, so the list is the language's rather than the area's.
import { EXT_BY_LANG, LANGUAGES } from "./langs.mjs";

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

/**
 * Which area a path belongs to: the deepest one containing it, or null.
 *
 * Nested areas both contain the file and only the deepest one measured it, so
 * this is the rule that decides whose claims a file carries and whose drift it
 * counts against. Both readings have to agree, or a file is judged against one
 * area and its drift charged to another.
 *
 * The separator is part of the test: without it `app/model` owns
 * `app/models/user.rb`.
 */
export function areaOwner(path, areaPaths) {
  let owner = null;
  for (const areaPath of areaPaths) {
    // "." is the repository root as an area path, and contains every path
    // without being a prefix of any of them.
    const inside = areaPath === "." || path === areaPath || path.startsWith(`${areaPath}/`);
    if (!inside) continue;
    if (owner === null || depth(areaPath) > depth(owner)) owner = areaPath;
  }
  return owner;
}

// The root is the least specific answer there is, and it is one character long,
// so its length cannot stand in for its depth.
const depth = (p) => (p === "." ? 0 : p.length);

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
/**
 * The same pattern, kept in its two halves: the directory a caller may need to
 * encode, and the tail it must not.
 *
 * Structured all the way to the renderer, because this file is what puts the
 * halves together and recovering them somewhere else means a second reading of
 * the grammar. The renderer's own regex knew only the extension form, so a bare
 * name reached the path encoder whole and lost its leading `**` to the markdown
 * bullet rule.
 */
export function globEntry(path, langs, { recursive = true, negated = false } = {}) {
  const exts = [...new Set(langs.flatMap((l) => EXT_BY_LANG[l] || []))].sort();
  // An empty list would render as `*.{}`, a glob that matches nothing and reads
  // like a working one.
  if (exts.length === 0) throw new Error(`no known extensions for langs: ${langs.join(",") || "(none)"}`);
  const ext = exts.length === 1 ? exts[0] : `{${exts.join(",")}}`;
  return entry(path, recursive ? `**/*.${ext}` : `*.${ext}`, negated);
}

// "." is the repository root, which contributes no directory half at all: the
// whole pattern is the tail, and a caller that encoded it would strip the
// leading `*`.
const entry = (dir, tail, negated) => ({ negated, dir: dir === "." ? "" : dir, tail });

/**
 * One entry as the matcher spells it. The composition lives here, beside the
 * split, so the two cannot disagree; the renderer passes its encoder in rather
 * than composing a second time.
 */
export function globText({ negated, dir, tail }, encodeDir) {
  // Ignored unless it is callable, because `globs.map(globText)` hands this the
  // array index and the pattern comes back unencoded rather than throwing.
  const encode = typeof encodeDir === "function" ? encodeDir : (d) => d;
  return `${negated ? "!" : ""}${dir ? `${encode(dir)}/` : ""}${tail}`;
}

// The names the extension brace cannot spell, from the registry so the corpus
// filter and the cover cannot drift apart again.
const BARE_NAMES = LANGUAGES.flatMap((l) => l.filenames);

const baseName = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

/** The extension glob for a directory, plus one pattern per bare name it holds. */
function patternsFor(dir, langs, { recursive, negated }, bare) {
  return [
    globEntry(dir, langs, { recursive, negated }),
    ...bare.map((name) => entry(dir, recursive ? `**/${name}` : name, negated)),
  ];
}

export function assertGlobSafe(g) {
  const text = globText(g);
  if (/\/\*\*$/.test(text)) {
    throw new Error(`glob ends in a bare /**, exclusions under it would silently fail: ${text}`);
  }
  return g;
}

/**
 * A directory name a `paths` pattern can spell literally.
 *
 * A path is repository-controlled (F4), and `**` is a legal directory name. Put
 * into a pattern it stops naming that directory: as glob syntax it reaches the
 * whole tree, which is the over-reach A10 exists to stop, and passed through the
 * encoder it loses its leading `*` run to the markdown bullet rule and matches
 * nothing at all. An area rooted there cannot be delivered either way, so it is
 * never rooted there: the files fold into an ancestor that can be spelled, whose
 * recursive tail still reaches them.
 */
const GLOB_SYNTAX = /[*?[\]{}!]/;
const spellable = (dir) => dir === "." || !dir.split("/").some((seg) => GLOB_SYNTAX.test(seg));

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
 * The shorter of the two shapes, out of the ones that can be spelled.
 *
 * Either shape may need to name a directory whose own name is glob syntax, and
 * a pattern that names it stops meaning that directory. The area root is always
 * spellable, so one recursive pattern from it is the fallback that always
 * exists: it describes more of the tree than the exact shapes do, and it is
 * still bounded by the area, which is what A10 asks.
 */
function spellableCover(root, positive, negative) {
  const ok = (cover) => cover.every((e) => spellable(e.dir));
  const shapes = [positive, negative].filter(ok);
  if (shapes.length === 0) return [{ dir: root, recursive: true, negated: false }];
  return shapes.reduce((a, b) => (b.length < a.length ? b : a));
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
    const cover = spellableCover(area.path, positive, negative);
    // The negations follow the pattern they cut into. Last match wins, so an
    // order that floated them to the front would exclude nothing.
    // A brace of extensions cannot spell `Rakefile`, so a file whose name
    // carries no extension needs a pattern of its own. Emitted per cover entry
    // rather than appended once, so a negation cuts the bare name out of a
    // foreign subtree exactly as it cuts the extension glob, and only for the
    // names this area actually holds, so nothing is excluded that was never
    // matched.
    const bare = BARE_NAMES.filter((n) => area.files.some((f) => baseName(f.rel) === n));
    area.globs = cover.flatMap((e) => patternsFor(e.dir, area.langs, e, bare).map(assertGlobSafe));
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
    while (cur !== "." && ((cumulative.get(cur) || 0) < minFiles || !spellable(cur))) cur = dirOf(cur);
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
    while (parent !== "." && (!byPath.has(parent) || !spellable(parent))) parent = dirOf(parent);

    // No ancestor is an area, which happens whenever a directory holds only
    // subdirectories: `src/mod0..mod499` have no area at `src`, because no file
    // sits directly in it. Its immediate parent is still a real directory and a
    // meaningful scope, so the area is created rather than the files dropped.
    // Left alone this orphaned 76,000 of 100,000 files on a measured repository.
    let immediate = dirOf(victim.path);
    while (immediate !== "." && !spellable(immediate)) immediate = dirOf(immediate);
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

/**
 * How many directories a set of paths spans.
 *
 * The directory gate compares an area's spread against one dimension's, so both
 * sides have to count the same way. Two spellings of "how many directories" is
 * a gate answering a question neither caller asked.
 */
export function dirCount(paths) {
  return new Set([...paths].map(dirOf)).size;
}
