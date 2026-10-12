/**
 * The co-change walk: which files the default branch's changes touched
 * together, read once per scan, and the claims that clear the gates.
 *
 * Nine fixed spec pairs cannot say that a new cop is entered in
 * `config/default.yml` or that a component ships with a changeset, and no count
 * over the tree sees it: the evidence is which files changed together. Measured
 * on 44 repositories, mined on the older four fifths of the changes and held
 * out on the newest fifth: 24 claims in 11 repositories, 1,563 of 1,633
 * held-out candidates conformed.
 *
 * The unit is one first-parent change, because a branch lands on the default
 * branch as one, so the change a claim was counted over and the change the
 * check enforces it on are the same thing. A cop added in one commit and
 * registered in the next of the same pull request is one change here.
 */
import { GATES, wilsonLower } from "./gates.mjs";
import { isPerson } from "./authors.mjs";
import { CHANGE_MOST, CLAIMS_MOST, classesOf, classParts, companionKey, keyCompanion } from "./cochange.mjs";
import { commitAt, filesAt, isSha, resolveBaseRef } from "./git.mjs";
import { SEP, historyFields } from "./history.mjs";
import { ownOutput } from "./corpus.mjs";
import { familyOf, language } from "./langs.mjs";
import { byCode, dirOf } from "./paths.mjs";
import { isTestPath } from "./precedent.mjs";
import { isTestTree } from "./test-shape.mjs";

export const COCHANGE = {
  // Wilson at 0.90 needs 35 perfect candidates, and few classes are added 35
  // times in 4,000 changes: 10 claims in 5 of 44 repositories there.
  depth: 20_000,
  // A deep window averages a habit with the years before it started: rubocop's
  // style cops ship with `config/default.yml` 76 of 76 times in the newest
  // 4,000 changes and 200 of 334 over all of them.
  perClass: 100,
  // The bound's own floor, and 0.90 of it, so no pair that could state is
  // left uncounted, and a near miss on the record has at least this many too.
  // Measured: 9,300 pair keys at most, against 593,687 unpruned.
  minCandidates: 35,
  minTouched: 32,
  keysMost: 100_000,
  lift: 2,
  // The share of a parent class's candidates that must come from child directories still at the tip.
  parentLive: 0.5,
  // A change deleting more than this is bulk too, so its deletions stay bounded.
  goneMost: 10_000,
};

const getOrSet = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};

/**
 * Where the walk stops: the pin where it loads and is reachable, else HEAD's
 * fork point with the first base ref that resolves, else HEAD, or null with no
 * commit. A branch cannot make its own claim in the first two.
 */
export async function cochangeTip(root, state) {
  if (state?.status === "ok" && isSha(state.sha)) return { tip: state.sha, from: "pin" };
  const base = await resolveBaseRef(root);
  if (base.ok && isSha(base.sha)) return { tip: base.sha, from: "base" };
  const head = await commitAt(root, "HEAD");
  return head === null ? null : { tip: head, from: "head" };
}

/**
 * Read `git log`'s NUL-delimited fields into changes, each handed to
 * `onChange` as it closes, with `end` closing the last.
 *
 * git 2.54 ends the format with a NUL and opens the first status with a
 * newline; an older one glues the header and that status into one field, the
 * way `authors.mjs` reads it. A change git printed no diff for is a header
 * followed directly by the next one.
 */
export function changeReader(onChange, own = () => false) {
  const canon = new Map();
  // One copy of each path for the whole walk, however many changes name it.
  const one = (p) => getOrSet(canon, p, () => p);
  let change = null;
  let status = null;

  const close = () => {
    if (change === null) return;
    const c = change;
    change = null;
    if (c.bulk) return onChange({ bulk: true });
    // With renames off a move is a deletion and an addition, and the moved file is no new one.
    const added = c.added.filter((p) => !c.gone.has(p.slice(p.lastIndexOf("/") + 1)));
    const touched = [...c.added, ...c.modified];
    onChange({ bulk: false, author: c.author, added, touched });
  };

  const open = (piece) => {
    close();
    const nl = piece.indexOf("\n");
    change = { author: (nl === -1 ? piece : piece.slice(0, nl)).trim().toLowerCase(), added: [], modified: [], gone: new Set(), bulk: false };
    return nl === -1 ? "" : piece.slice(nl + 1);
  };

  const row = (letter, path) => {
    // The map a scan wrote is rewritten by the refresh, never by the change itself.
    if (change === null || change.bulk || !path || own(path)) return;
    if (letter === "D") {
      change.gone.add(path.slice(path.lastIndexOf("/") + 1));
      if (change.gone.size > COCHANGE.goneMost) change.bulk = true;
      return;
    }
    const list = letter === "A" ? change.added : letter === "M" || letter === "T" ? change.modified : null;
    if (list === null) return;
    list.push(one(path));
    if (change.added.length + change.modified.length > CHANGE_MOST) change.bulk = true;
  };

  const read = (field) => {
    if (status !== null) {
      row(status, field);
      status = null;
      return;
    }
    let rest = field;
    const at = field.indexOf(SEP);
    if (at !== -1) for (const piece of field.slice(at + 1).split(SEP)) rest = open(piece);
    rest = rest.replace(/^\n+/, "");
    if (rest) status = rest[0];
  };
  read.end = close;
  return read;
}

/**
 * The newest first-parent changes up to `tip`, streamed under the git runner's
 * clock and field cap. `--no-renames` and `--name-status` read trees only, so a
 * blobless clone answers offline and a treeless one fails rather than fetching.
 * A git older than 2.31 refuses `--diff-merges`, which is an error and states nothing.
 * `history` is one scan's: with it the changes a store already holds are
 * replayed and only the rest are asked of git (`history.mjs`).
 */
export async function walkCochange(root, tip, { signal, history = null } = {}) {
  if (!isSha(tip)) return { changes: [], read: 0, bulk: 0, error: "no commit to walk from" };
  const own = ownOutput(root).asWritten;
  let changes, read, bulk, reader;
  // A read given up part way starts over, and the counts with it.
  const open = () => {
    changes = [];
    read = 0;
    bulk = 0;
    reader = changeReader((c) => {
      read++;
      if (c.bulk) bulk++;
      else if (c.touched.length > 0) changes.push(c);
    }, own);
    return reader;
  };
  try {
    await historyFields(
      root,
      {
        kind: "cochange",
        renames: false,
        // A root commit's diff is every file the repository started with, which is no habit.
        config: ["-c", "log.showRoot=false"],
        tip: [tip],
        walk: ["--first-parent"],
        diff: ["--diff-merges=first-parent", "--no-renames", "--name-status", "-z"],
        cap: [`--max-count=${COCHANGE.depth}`],
        env: process.env,
      },
      open,
      { signal, history }
    );
    reader.end();
  } catch (err) {
    return { changes: [], read: 0, bulk: 0, error: String(err && err.message ? err.message : err) };
  }
  return { changes, read, bulk, error: null };
}

/** The walk and the tip's tree, started together once the pin is known; `signal` stops both. */
export async function startCochange(root, state, { signal, history = null } = {}) {
  const at = await cochangeTip(root, state);
  if (at === null) return { tip: null, from: null, walk: { changes: [], read: 0, bulk: 0, error: null }, tree: null };
  const [walk, tree] = await Promise.all([walkCochange(root, at.tip, { signal, history }), filesAt(root, at.tip, { signal })]);
  return { ...at, walk, tree };
}

// Fixture and snapshot directories, the way the corpus spells them.
const FIXTURE_DIR = /^(?:__fixtures__|__snapshots__|(?:\w*_)?fixtures?)$/;

/**
 * Whether a path, or a file named into a class, is a test's: tests are what the
 * namesake count and the obligations speak for, file by file, and "adds a spec
 * here" is met by any spec at all. On rubocop 3 of 8 claims restated the cop
 * claims from the spec side.
 */
function isTestSide(path) {
  const lang = language(path);
  const family = lang ? familyOf(lang) : null;
  return isTestPath(path) || path.split("/").slice(0, -1).some((seg) => isTestTree(seg, family) || FIXTURE_DIR.test(seg));
}

const sample = (cls) => {
  const { dir, spans, suffix } = classParts(cls);
  return dir === null ? `x${suffix}` : spans ? `${dir}/x/x${suffix}` : `${dir}/x${suffix}`;
};

const upOf = (cls) => {
  const { dir, spans, suffix } = classParts(cls);
  if (dir === null || spans || !dir.includes("/")) return null;
  return `${dir.slice(0, dir.lastIndexOf("/"))}/*/*${suffix}`;
};

/**
 * The gates in order, each pair's first failure recorded: test and shape and
 * ratio decide whether it is kept at all, and evidence, authors, lift,
 * existence and recency name a near miss.
 */
export function mineCochange(walk, { tree, required = GATES.authorEvidence }) {
  const changes = walk.changes;
  const classCache = new Map();
  const classes = (p) => getOrSet(classCache, p, () => classesOf(p));
  const keysOf = (change) => {
    const keys = new Set();
    for (const p of change.touched) keys.add(companionKey({ kind: "edits", path: p }));
    for (const p of change.added) for (const cls of classes(p)) keys.add(companionKey({ kind: "adds", path: cls }));
    return keys;
  };

  // First pass: each class's newest candidates, and how often each companion is touched at all.
  const timesAdded = new Map();
  const candidatesOf = new Map();
  const touches = new Map();
  const countedIn = [];
  const added = new Set();
  for (const [i, change] of changes.entries()) {
    for (const key of keysOf(change)) touches.set(key, (touches.get(key) ?? 0) + 1);
    const counted = [];
    for (const producer of new Set(change.added.flatMap(classes))) {
      const before = timesAdded.get(producer) ?? 0;
      timesAdded.set(producer, before + 1);
      if (before >= COCHANGE.perClass) continue;
      counted.push(producer);
      getOrSet(candidatesOf, producer, () => []).push(i);
    }
    countedIn.push(counted);
    for (const p of change.added) added.add(p);
  }
  const support = (producer) => candidatesOf.get(producer)?.length ?? 0;

  // Second pass: pairs, only where the bound could ever be met.
  const together = new Map();
  let pairKeys = 0;
  for (const [i, change] of changes.entries()) {
    const producers = countedIn[i].filter((producer) => support(producer) >= COCHANGE.minCandidates);
    if (producers.length === 0) continue;
    const companions = [...keysOf(change)].filter((key) => touches.get(key) >= COCHANGE.minTouched);
    for (const producer of producers) {
      const row = getOrSet(together, producer, () => new Map());
      const own = companionKey({ kind: "adds", path: producer });
      for (const key of companions) {
        if (key === own) continue;
        const conforming = row.get(key);
        if (conforming === undefined && ++pairKeys > COCHANGE.keysMost) return { claims: [], truncated: true };
        row.set(key, (conforming ?? 0) + 1);
      }
    }
  }

  const kept = [];
  for (const [producer, row] of together) {
    const candidates = support(producer);
    for (const [key, conforming] of row) {
      const companion = keyCompanion(key);
      const isAdded = companion.kind === "adds";
      if (isTestSide(sample(producer)) || isTestSide(isAdded ? sample(companion.path) : companion.path)) continue;
      if (isAdded && (classParts(companion.path).spans || companion.path === producer || upOf(companion.path) === producer)) continue;
      if (conforming / candidates < GATES.minRatio) continue;
      kept.push({ producer, key, conforming, candidates, companion });
    }
  }

  // The tip's tree, asked only about the classes a kept pair names.
  const asked = new Set(kept.flatMap(({ producer, companion }) => [producer, ...(companion.kind === "adds" ? [companion.path] : [])]));
  // Per class: [files at the tip a counted change added, files at the tip], the record's `files`.
  const atTip = new Map([...asked].map((cls) => [cls, [0, 0]]));
  // The child directories a spanning class still holds a file in at the tip.
  const dirsAtTip = new Map();
  for (const p of tree ?? []) {
    for (const cls of classes(p)) {
      const at = atTip.get(cls);
      if (!at) continue;
      at[1]++;
      if (added.has(p)) at[0]++;
      if (classParts(cls).spans) getOrSet(dirsAtTip, cls, () => new Set()).add(dirOf(p));
    }
  }
  // A spanning class speaks for its children only where the history it was
  // counted over came from two of them, at least half of it from ones still
  // there: evidence mostly from directories the tree no longer holds is none for
  // a sibling it does, and older children moving out is the recency gate's to judge.
  const producerExists = (producer) => {
    if (!classParts(producer).spans) return atTip.get(producer)[1] > 0;
    const candidates = candidatesOf.get(producer);
    const dirsOf = (i) => changes[i].added.filter((p) => classes(p).includes(producer)).map(dirOf);
    const held = dirsAtTip.get(producer) ?? new Set();
    const live = candidates.filter((i) => dirsOf(i).some((d) => held.has(d))).length;
    return new Set(candidates.flatMap(dirsOf)).size >= 2 && live / candidates.length >= COCHANGE.parentLive;
  };

  const keysAt = new Map();
  const claims = kept.map(({ producer, key, conforming, candidates, companion }) => {
    const flags = candidatesOf.get(producer).map((i) => getOrSet(keysAt, i, () => keysOf(changes[i])).has(key));
    const authors = new Set();
    for (const [j, i] of candidatesOf.get(producer).entries()) if (flags[j] && isPerson(changes[i].author)) authors.add(changes[i].author);
    const lift = conforming / candidates / (touches.get(key) / changes.length);
    // A fifth of at least 35 candidates is at least 7, past the design's floor of 5.
    const recent = Math.ceil(candidates / 5);
    const met = flags.slice(0, recent).filter(Boolean).length;
    const exists = (companion.kind === "edits" ? tree?.has(companion.path) : atTip.get(companion.path)[1] > 0) && producerExists(producer);
    const gate =
      wilsonLower(conforming, candidates) < GATES.minRatio ? "evidence"
        : authors.size < required ? "authors"
          : lift < COCHANGE.lift ? "lift"
            : !exists ? "exists"
              : met / recent < GATES.minRatio ? "recency"
                : null;
    return {
      producer,
      companion,
      candidates,
      conforming,
      newest: [met, recent],
      authors: authors.size,
      authorsRequired: required,
      lift: Math.round(lift * 100) / 100,
      files: atTip.get(producer),
      area: null,
      gate,
      directive: gate === null,
    };
  });
  onePerPair(claims);
  const byPair = (a, b) => byCode(a.producer, b.producer) || byCode(companionKey(a.companion), companionKey(b.companion));
  const strongest = (stated) => claims
    .filter((c) => c.directive === stated)
    .sort((a, b) => b.candidates - a.candidates || byPair(a, b))
    .slice(0, CLAIMS_MOST);
  return { claims: [...strongest(true), ...strongest(false)].sort(byPair), truncated: false };
}

/**
 * One statement per pair, the other recorded under the gate `pair`. A class and
 * its parent with the same companion: the directory's own, unless the parent
 * covers at least a tenth more candidates. Two classes each shipping with the
 * other added: the side with more candidates, a tie broken on code order.
 */
function onePerPair(claims) {
  const stated = claims.filter((c) => c.directive);
  const drop = (c) => {
    c.directive = false;
    c.gate = "pair";
  };
  const same = (a, b) => companionKey(a.companion) === companionKey(b.companion);
  for (const parent of stated.filter((c) => classParts(c.producer).spans)) {
    const children = stated.filter((c) => same(c, parent) && upOf(c.producer) === parent.producer);
    if (children.length === 0) continue;
    // In whole numbers: 1.1 * 50 is past 55 as a float.
    if (!children.every((c) => 10 * parent.candidates >= 11 * c.candidates)) drop(parent);
    else for (const c of children) drop(c);
  }
  const shipsWithAdded = (c, cls) => c.companion.kind === "adds" && c.companion.path === cls;
  for (const a of stated.filter((c) => c.companion.kind === "adds")) {
    const b = stated.find((c) => c.directive && c.producer === a.companion.path && shipsWithAdded(c, a.producer));
    if (!a.directive || !b) continue;
    const aWins = a.candidates !== b.candidates ? a.candidates > b.candidates : byCode(a.producer, b.producer) < 0;
    drop(aWins ? b : a);
  }
}

/**
 * The record a scan stores: the walk's counts, and every claim and near miss
 * with the one area each producer class's files at the tip all fall in, or
 * null where they fall in more than one or in none, or where that area's file
 * never loads for any of them. `areaOf` answers for a path with the area whose
 * file this scan writes, or null, and `reaches` whether that file loads for the path.
 */
export function cochangeRecord(started, { required = GATES.authorEvidence, shallow = false, areaOf = () => null, reaches = () => true } = {}) {
  const { tip, from, walk, tree } = started;
  const record = {
    unit: "first-parent",
    depth: COCHANGE.depth,
    perClass: COCHANGE.perClass,
    tip,
    from,
    read: walk.read,
    counted: walk.changes.length,
    bulk: walk.bulk,
    shallow: Boolean(shallow),
    error: walk.error,
    truncated: false,
    claims: [],
  };
  if (tip === null || walk.error !== null || walk.changes.length === 0) return record;
  // Unread is not evidence: a tree git would not list answers no existence gate.
  if (tree === null) return { ...record, error: "the tip's tree could not be read" };
  const { claims, truncated } = mineCochange(walk, { tree, required });
  const producers = new Set(claims.map((c) => c.producer));
  const where = new Map();
  const reached = new Set();
  for (const p of tree) {
    for (const cls of classesOf(p)) {
      if (!producers.has(cls)) continue;
      const area = areaOf(p);
      getOrSet(where, cls, () => new Set()).add(area);
      if (area !== null && reaches(p)) reached.add(cls);
    }
  }
  for (const c of claims) {
    const areas = where.get(c.producer);
    c.area = areas?.size === 1 && reached.has(c.producer) ? [...areas][0] : null;
  }
  return { ...record, truncated, claims };
}
