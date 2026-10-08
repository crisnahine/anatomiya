import { dirname } from "node:path/posix";
import { createHash } from "node:crypto";
// The registry's own table, or the glob delivers to less than the counts were
// taken over. Listing an extension the repository does not use matches nothing
// extra, so the list is the language's rather than the area's.
import { EXT_BY_LANG, LANGUAGES, rootIsPackage } from "./langs.mjs";
import { byCode } from "./paths.mjs";
import { sanitisePath } from "./encode.mjs";

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
    // "." is the repository root as an area path and a prefix of no path. It is
    // the package at the root, so it holds the files directly there: a
    // directory below it is another area's or nobody's.
    const inside = areaPath === "." ? !path.includes("/") : path === areaPath || path.startsWith(`${areaPath}/`);
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

const ROOT_AREA = "the repository root";

/**
 * An area's name as a listing or a sentence says it, a directory spelled by the caller's encoder.
 *
 * The area at the root has a path of one dot, which reads as punctuation, so
 * it is named in words. A directory can be called those words too, and it is
 * said as the path it is, `./` in front, so the two lines stay apart. Compared
 * after the encoder, which prints two spaces as one.
 */
export function areaLabel(path, encodeName) {
  if (path === ".") return ROOT_AREA;
  const said = typeof encodeName === "function" ? encodeName(path) : path;
  return said === ROOT_AREA ? `./${said}` : said;
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
 *
 * The pattern is kept in its two halves: the directory a caller may need to
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
  // A tail with no `*` is a file's own name, repository-controlled like the directory.
  const name = tail.includes("*") ? tail : encode(tail);
  return `${negated ? "!" : ""}${dir ? `${encode(dir)}/` : anchorFor(tail)}${name}`;
}

// What stands where the directory half would, for a pattern at the repository
// root. Claude Code matches `paths` by gitignore's rules, where a pattern
// holding no slash matches at every depth: `*.go` reaches `binding/json.go`.
// A leading slash is what holds it to the root, and a recursive tail has one.
const anchorFor = (tail) => (tail.startsWith("**/") ? "" : "/");

// The names the extension brace cannot spell, from the registry so the corpus
// filter and the cover cannot drift apart again.
const BARE_NAMES = LANGUAGES.flatMap((l) => l.filenames);

const baseName = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

/**
 * The extension glob for a directory, plus one pattern per bare name it holds.
 * `under` names a directory at any depth below `dir` that every pattern goes
 * through, which a recursive pattern alone can spell.
 */
function patternsFor(dir, langs, { recursive, negated }, bare, under = null) {
  const via = (e) => (under === null ? e : { ...e, tail: `**/${under}/${e.tail}` });
  return [
    via(globEntry(dir, langs, { recursive, negated })),
    ...bare.map((name) => via(entry(dir, recursive ? `**/${name}` : name, negated))),
  ];
}

/**
 * Whether an area's own globs deliver its file to this path.
 *
 * Ownership is the directory prefix and delivery is the glob, and A10 makes the
 * glob the narrower of the two on purpose: an area listing only its own files
 * owns every new subdirectory under it and hands its sentences to none of them.
 * The check reads this so it never reports at MUST-FIX a claim the map did not
 * deliver, which is the same rule the ancestor fallback already follows.
 *
 * The extension half matters as much as the directory half, because a row's
 * langs are wider than one area's brace: `file_naming_case` spans js, jsx and
 * ruby, so a `.jsx` file in a directory of `.js` counted as delivered and drew
 * MUST-FIX on a sentence its `paths` list cannot spell.
 *
 * A record carrying no globs predates them, and every path reads as delivered,
 * which is what the check did before this existed.
 */
export function globsReach(globs, rel) {
  if (!Array.isArray(globs) || globs.length === 0) return true;
  const path = foldCase(rel);
  if (globs.some((g) => g.negated && reaches(g, path))) return false;
  return globs.some((g) => !g.negated && reaches(g, path));
}

// The same two halves `globText` composes, read back: a directory and a tail
// that is either an extension brace or one of the names the brace cannot spell.
// Case folded on both sides, as the delivery channel matches.
function reaches(g, rel) {
  const dir = foldCase(g.dir || "");
  if (dir && !rel.startsWith(`${dir}/`)) return false;
  const rest = rel.slice(dir ? dir.length + 1 : 0);
  const tail = foldCase(String(g.tail || ""));
  const named = tail.match(/^\*\*\/([^*/]+)\/\*\*\/(.+)$/);
  if (named) return rest.split("/").slice(0, -1).includes(named[1]) && spells(named[2], rest.slice(rest.lastIndexOf("/") + 1));
  const deep = tail.startsWith("**/");
  if (!deep && rest.includes("/")) return false;
  return spells(deep ? tail.slice(3) : tail, rest.slice(rest.lastIndexOf("/") + 1));
}

function spells(pattern, name) {
  if (!pattern.startsWith("*.")) return pattern === name;
  const ext = pattern.slice(2);
  const exts = ext.startsWith("{") && ext.endsWith("}") ? ext.slice(1, -1).split(",") : [ext];
  const dot = name.lastIndexOf(".");
  return dot > 0 && exts.includes(name.slice(dot + 1));
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
 *
 * The encoder is the other half of the same question. Every directory reaches
 * the rendered glob through it (F4), and it rewrites what it cannot render
 * safely rather than refusing it: a non-Latin name becomes a placeholder and a
 * path past its cap ends in `…`. Measured: `src/компоненты` and a 129-character
 * directory each got an area file whose `paths` could never match, written and
 * silent. So a directory is spellable only where the encoder hands it back
 * unchanged, and one it would rewrite folds like glob syntax does; what reaches
 * the root with nowhere spellable to go is reported as uncovered.
 *
 * Glob syntax includes `(`, `)` and `\`: picomatch and minimatch both read
 * `@(lib)` and `x+(y)` as extglobs, `(ab)` as a group and `a\b` as an escaped
 * `b`, so each of those directories rooted an area whose `paths` matched
 * nothing or a different directory. `+` and `@` only bite in front of a `(`.
 * Claude Code itself splits each `paths` entry on the commas outside a brace
 * before it expands braces or matches with gitignore rules, so `x,y/**` reads
 * as `x` and `y/**` and a comma is glob syntax too.
 */
const GLOB_SYNTAX = /[*?[\]{}!()\\,]/;
const spellable = (dir, twins = NO_TWINS) =>
  dir === "." || (!dir.split("/").some((seg) => GLOB_SYNTAX.test(seg)) && sanitisePath(dir) === dir && !underTwin(dir, twins));

const NO_TWINS = new Set();

/**
 * A name as a case-insensitive JavaScript regex without the `u` flag compares
 * it, which is how the `ignore` package Claude Code matches `paths` with is built.
 */
const foldCase = (name) =>
  name.replace(/[^]/g, (c) => {
    const u = c.toUpperCase();
    return u.length === 1 && !(c.charCodeAt(0) >= 128 && u.charCodeAt(0) < 128) ? u : c;
  });

/**
 * Every directory holding counted files beside a sibling whose name folds to
 * the same case. Claude Code's matcher folds case, so `src/**` delivers to
 * `Src/` as well: neither twin can root an area, and their files fold into the
 * parent, whose pattern reaches both. The NFC and NFD spellings of one name
 * are not twins, since the matcher compares code units.
 */
function caseTwins(files) {
  const byKey = new Map();
  for (const f of files) {
    for (let d = dirOf(f.rel); d !== "."; d = dirOf(d)) {
      const key = `${dirOf(d)}/${foldCase(baseName(d))}`;
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(d);
    }
  }
  return new Set([...byKey.values()].filter((dirs) => dirs.size > 1).flatMap((dirs) => [...dirs]));
}

function underTwin(dir, twins) {
  for (let d = dir; d !== "."; d = dirOf(d)) if (twins.has(d)) return true;
  return false;
}

/** Directory of a repository-relative file path, "." for the root. */
function dirOf(rel) {
  const d = dirname(rel);
  return d === "." ? "." : d;
}

/** Every directory's recursive file count, its own file count, and its child directories. */
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

const children = (corpus, d) => [...(corpus.kids.get(d) || [])].sort();

/** A subtree holding nothing but this area's files needs one pattern and no descent. */
const whollyOwned = (corpus, mine, d) => corpus.under.get(d) === mine.under.get(d);

/**
 * The files a directory holds that the counts left out, one negation each. A
 * directory's counted files all belong to one area, but a fixture or generated
 * file can sit beside them, and the directory's own pattern reaches it.
 */
const leftOut = (corpus, mine, d) =>
  mine.direct.has(d) ? (corpus.left.get(d) || []).map((name) => ({ dir: d, name, negated: true })) : [];

/**
 * One pattern per directory the area holds files in, subtrees it wholly owns collapsed.
 * Ownership is over the counted files: a left-out file costs a negation, never the
 * recursion, which is what still reaches a directory added after the scan.
 */
function positiveCover(root, corpus, mine) {
  const out = [];
  const walk = (d) => {
    if (whollyOwned(corpus.counted, mine, d)) return out.push(...negativeCover(d, corpus, mine));
    if (mine.direct.has(d)) out.push({ dir: d, recursive: false, negated: false }, ...leftOut(corpus, mine, d));
    for (const c of children(corpus, d)) if (mine.under.get(c)) walk(c);
  };
  walk(root);
  return out;
}

/**
 * One pattern over the whole subtree, minus the foreign subtrees below it and
 * the foreign files sitting directly in the directories it walks through.
 *
 * A directory's counted files always travel to one area together, since every
 * fold moves whole buckets, so a directory is entirely in the area or entirely
 * outside it, apart from the files the counts left out. Both cases are foreign
 * to some area, and the ceiling produces the second: it can synthesize a host
 * at a directory whose own bucket was already orphaned, leaving a host that
 * holds files under that directory and none in it.
 */
function negativeCover(root, corpus, mine) {
  const out = [{ dir: root, recursive: true, negated: false }];
  const walk = (d) => {
    if (whollyOwned(corpus, mine, d)) return;
    if ((corpus.direct.get(d) || 0) > 0 && !mine.direct.has(d)) {
      out.push({ dir: d, recursive: false, negated: true });
    }
    out.push(...leftOut(corpus, mine, d));
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
  const ok = (cover) => cover.every((e) => spellable(e.dir) && (e.name === undefined || spellable(e.name)));
  const shapes = [positive, negative].filter(ok);
  if (shapes.length === 0) return [{ dir: root, recursive: true, negated: false }];
  return shapes.reduce((a, b) => (b.length < a.length ? b : a));
}

/**
 * The root package's cover: its own files and never a directory below them.
 *
 * Neither general shape is taken. A recursive pattern from the root is the
 * shorter cover of a repository holding nothing else, and the fallback where a
 * name cannot be spelled, and either way it reaches every directory there is
 * or will be. A left-out file whose name is glob syntax is reached instead,
 * which is one file where the fallback is the whole tree.
 */
const rootCover = (corpus, mine) => [
  { dir: ".", recursive: false, negated: false },
  ...leftOut(corpus, mine, ".").filter((e) => spellable(e.name)),
];

/**
 * The tree the cover walks for one area: the counted files, plus the files the
 * counts left out that this area's patterns would otherwise reach. Those are in
 * no area, so they read as foreign, and a directory holding nothing else is cut
 * out whole. Only the area's own subtree is ever walked, so the counted tree is
 * shared and the left-out files are laid over it.
 */
function withLeftOut(corpus, left) {
  if (left.length === 0) return { ...corpus, counted: corpus, left: new Map() };
  const extra = corpusTree(left);
  const byDir = new Map();
  for (const f of left) {
    const d = dirOf(f.rel);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(baseName(f.rel));
  }
  const sum = (a, b) => ({ get: (d) => (a.get(d) || 0) + (b.get(d) || 0) || undefined });
  return {
    under: sum(corpus.under, extra.under),
    direct: sum(corpus.direct, extra.direct),
    kids: { get: (d) => new Set([...(corpus.kids.get(d) || []), ...(extra.kids.get(d) || [])]) },
    left: new Map([...byDir].map(([d, names]) => [d, names.sort(byCode)])),
    counted: corpus,
  };
}

/**
 * The left-out files an excluded directory's name can cut out in one pattern,
 * by that name, and the rest, which the cover walks as foreign files.
 *
 * Every file under a directory the exclusion names is left out wherever that
 * directory sits, so one negation by name replaces one per directory holding
 * it: prisma keeps a `_fixture/` beside each of 102 functional tests. Not where
 * the name also sits on a counted file's path, as `build` does under `src`,
 * and not a name the matcher would read as more than a name.
 */
function byExcludedName(area, left) {
  const under = area.path === "." ? "" : `${area.path}/`;
  const counted = new Set(area.files.flatMap((f) => f.rel.slice(under.length).split("/").slice(0, -1).map(foldCase)));
  const byName = new Map();
  const inTree = [];
  for (const f of left) {
    const n = f.excludedAt && f.excludedAt.startsWith(under) ? baseName(f.excludedAt) : null;
    if (n === null || counted.has(foldCase(n)) || !/^[\w.-]+$/.test(n) || !spellable(n)) {
      inTree.push(f);
      continue;
    }
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(f);
  }
  return { byName, inTree };
}

/** An area's files, their directories and every ancestor, case folded. */
function foldedPaths(files) {
  const rels = new Set();
  const dirs = new Set();
  const under = new Set();
  for (const f of files) {
    rels.add(foldCase(f.rel));
    dirs.add(foldCase(dirOf(f.rel)));
    for (let d = dirOf(f.rel); d !== "."; d = dirOf(d)) under.add(foldCase(d));
  }
  return { rels, dirs, under };
}

/**
 * Whether a negation, read with case folded as Claude Code reads it, cuts one of
 * the area's own files: a left-out `p/Build/` beside a counted `p/build/` cannot
 * be cut out without it, and the area keeps its own files first.
 */
function cutsOwn(g, own) {
  // A cut by name is held off the area's own names where it is chosen.
  if (/^\*\*\/[^*/]+\/\*\*\//.test(g.tail)) return false;
  const dir = foldCase(g.dir);
  if (g.tail.startsWith("**/")) return own.under.has(dir);
  if (g.tail.includes("*")) return own.dirs.has(dir);
  return own.rels.has(foldCase(dir ? `${g.dir}/${g.tail}` : g.tail));
}

/** The left-out files inside an area that its extension brace or its bare names would spell. */
function reachable(area, uncounted, bare) {
  const exts = new Set(area.langs.flatMap((l) => EXT_BY_LANG[l] || []).map(foldCase));
  const names = new Set(bare.map(foldCase));
  const under = area.path === "." ? "" : `${area.path}/`;
  return uncounted.filter((f) => {
    if (!f.rel.startsWith(under)) return false;
    const name = foldCase(baseName(f.rel));
    const dot = name.lastIndexOf(".");
    return names.has(name) || (dot > 0 && exts.has(name.slice(dot + 1)));
  });
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
function assignGlobs(areas, files, uncounted) {
  const counted = corpusTree(files);
  for (const area of areas) {
    const mine = corpusTree(area.files);
    const bare = BARE_NAMES.filter((n) => area.files.some((f) => baseName(f.rel) === n));
    const { byName, inTree } = byExcludedName(area, reachable(area, uncounted, bare));
    const corpus = withLeftOut(counted, inTree);
    // A tie goes to the shape with no negation: one pattern to read rather than
    // a pattern and a list of holes.
    const cover = area.path === "."
      ? rootCover(corpus, mine)
      : spellableCover(area.path, positiveCover(area.path, corpus, mine), negativeCover(area.path, corpus, mine));
    // The negations follow every pattern they cut into. Last match wins, so an
    // order that floated them to the front would exclude nothing, and the
    // matcher folds case, so `p/a/**` re-includes a file cut out of `p/A/`.
    // A brace of extensions cannot spell `Rakefile`, so a file whose name
    // carries no extension needs a pattern of its own. Emitted per cover entry
    // rather than appended once, so a negation cuts the bare name out of a
    // foreign subtree exactly as it cuts the extension glob, and only for the
    // names this area actually holds, so nothing is excluded that was never
    // matched.
    const globs = cover
      .flatMap((e) => (e.name === undefined ? patternsFor(e.dir, area.langs, e, bare) : [entry(e.dir, e.name, true)]))
      .sort((a, b) => a.negated - b.negated);
    // Cut out by name only where the cover would otherwise reach them.
    const names = [...byName].filter(([, fs]) => fs.some((f) => globsReach(globs, f.rel))).map(([n]) => n).sort(byCode);
    const own = foldedPaths(area.files);
    area.globs = globs
      .concat(names.flatMap((n) => patternsFor(area.path, area.langs, { recursive: true, negated: true }, bare, n)))
      .filter((g) => !(g.negated && cutsOwn(g, own)))
      .map(assertGlobSafe);
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
 *
 * `uncounted` is the tracked source the corpus left out as fixture or
 * generated code. It decides no area and counts toward none; it only keeps
 * the globs off it.
 */
export function discover(files, {
  minFiles = areaFloor(files.length),
  maxAreas = areaCeiling(files.length),
  uncounted = [],
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
  //
  // The files directly at the root are the one exception, where their language
  // builds the root as a package like any directory: they are one package's
  // code, and a pattern anchored there reaches them and nothing below. Taken on
  // their own count, so what folds up beside them neither makes the area nor joins it.
  const orphaned = [];
  const merged = new Map();
  const twins = caseTwins(files);
  const rootPackage = (byDir.get(".") || []).filter((f) => rootIsPackage(f.lang));
  const atRoot = rootPackage.length >= minFiles ? new Set(rootPackage) : new Set();
  if (atRoot.size > 0) merged.set(".", rootPackage);

  for (const [d, fs] of byDir) {
    let cur = d;
    while (cur !== "." && ((cumulative.get(cur) || 0) < minFiles || !spellable(cur, twins))) cur = dirOf(cur);
    if (cur === ".") {
      orphaned.push(...fs.filter((f) => !atRoot.has(f)));
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

  const capped = capCount(areas, maxAreas, twins);
  const folded = capped.orphaned || [];
  const all = capped.sort((a, b) => byCode(a.path, b.path));
  // After the count is capped, never before: a glob is measured against the
  // areas that ended up existing, and a fold changes which subtrees are foreign.
  assignGlobs(all, files, uncounted);
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
function capCount(areas, maxAreas, twins) {
  if (areas.length <= maxAreas) return areas;

  const order = [...areas].sort((a, b) => a.fileCount - b.fileCount);
  const byPath = new Map(areas.map((a) => [a.path, a]));

  const orphaned = [];

  while (byPath.size > maxAreas && order.length) {
    // An entry is live only while it is the object byPath holds: a host that
    // absorbed a victim is a new object queued again at its new size, and the
    // entry it left behind is skipped rather than folded early, or folded as
    // the stale object that loses the files it absorbed.
    const victim = order.shift();
    if (byPath.get(victim.path) !== victim) continue;

    // Fold into the nearest ancestor that is itself an area. Never into the
    // repository root: a root "area" is a bucket of everything that failed to
    // find a home, and a claim computed over it describes no code anyone works
    // on. Files with nowhere to go are reported as uncovered instead.
    let parent = dirOf(victim.path);
    while (parent !== "." && (!byPath.has(parent) || !spellable(parent, twins))) parent = dirOf(parent);

    // No ancestor is an area, which happens whenever a directory holds only
    // subdirectories: `src/mod0..mod499` have no area at `src`, because no file
    // sits directly in it. Its immediate parent is still a real directory and a
    // meaningful scope, so the area is created rather than the files dropped.
    // Left alone this orphaned 76,000 of 100,000 files on a measured repository.
    let immediate = dirOf(victim.path);
    while (immediate !== "." && !spellable(immediate, twins)) immediate = dirOf(immediate);
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
    //
    // At its size, not at the end, and a host that grew moves to its new size
    // too. Appended, a three-file host outlived every larger area: with a
    // ceiling of three, `x/y/v` (3), `m` (10), `n` (20) and `o` (30) kept `x/y`
    // and left m's ten files uncovered. Left where it was, a host that had just
    // absorbed a child was folded at the size it had before.
    requeue(order, merged);
  }

  const out = [...byPath.values()];
  out.orphaned = orphaned;
  return out;
}

// Put an area at its place in a queue kept smallest first, after any area of
// the same size so a tie keeps the order the queue already gave it. Found by
// halving rather than by scanning, since a large tree folds tens of thousands
// of times; the entry a grown host leaves behind stays and is skipped live.
function requeue(order, area) {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (order[mid].fileCount <= area.fileCount) lo = mid + 1;
    else hi = mid;
  }
  order.splice(lo, 0, area);
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
