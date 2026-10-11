/**
 * The co-change walk: which files the default branch's changes touched
 * together, read once per scan, and the claims that clear the gates.
 *
 * Nine fixed spec pairs cannot say that a new cop is entered in
 * `config/default.yml` or that a component ships with a changeset, and no count
 * over the tree sees it: the evidence is which files changed together. Measured
 * on 44 repositories, mined on the older four fifths of the changes and held
 * out on the newest fifth: 25 claims in 11 repositories, 1,568 of 1,639
 * held-out candidates conformed.
 *
 * The unit is one first-parent change, because a branch lands on the default
 * branch as one, so the change a claim was counted over and the change the
 * check enforces it on are the same thing. A cop added in one commit and
 * registered in the next of the same pull request is one change here.
 */
import { GATES, wilsonLower } from "./gates.mjs";
import { isPerson } from "./authors.mjs";
import { CLAIMS_MOST, classesOf, classParts } from "./cochange.mjs";
import { commitAt, filesAt, gitStreamed, isSha, resolveBaseRef } from "./git.mjs";
import { ownOutput } from "./corpus.mjs";
import { familyOf, language } from "./langs.mjs";
import { byCode } from "./paths.mjs";
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
  // Past this many added or modified files a change is bulk: a vendored
  // import or a rename sweep says nothing about what ships together.
  changeMost: 40,
  // The bound's own floor, and 0.90 of it, so no pair that could state is
  // left uncounted. Measured: 9,300 pair keys at most, against 593,687 unpruned.
  minCandidates: 35,
  minTouched: 32,
  keysMost: 100_000,
  // Near misses kept on the record for audit, never rendered (D7).
  nearMiss: 10,
  lift: 2,
  // A change deleting more than this is bulk too, so its deletions stay bounded.
  goneMost: 10_000,
};

const SEP = "\x1e";

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
  const one = (p) => canon.get(p) ?? (canon.set(p, p), p);
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
    if (change.added.length + change.modified.length > COCHANGE.changeMost) change.bulk = true;
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
 */
export async function walkCochange(root, tip) {
  const changes = [];
  let read = 0;
  let bulk = 0;
  const reader = changeReader((c) => {
    read++;
    if (c.bulk) bulk++;
    else if (c.touched.length > 0) changes.push(c);
  }, ownOutput(root).asWritten);
  if (!isSha(tip)) return { changes, read, bulk, error: "no commit to walk from" };
  try {
    await gitStreamed(
      root,
      [
        // A root commit's diff is every file the repository started with, which is no habit.
        "-c", "log.showRoot=false",
        "log", tip, "--first-parent", "--diff-merges=first-parent", "--no-renames", "--name-status", "-z",
        `--format=${SEP}%aE`, `--max-count=${COCHANGE.depth}`, "--",
      ],
      reader,
      { terminated: false }
    );
    reader.end();
  } catch (err) {
    return { changes: [], read: 0, bulk: 0, error: String(err && err.message ? err.message : err) };
  }
  return { changes, read, bulk, error: null };
}

/** The walk and the tip's tree, started together once the pin is known. */
export async function startCochange(root, state) {
  const at = await cochangeTip(root, state);
  if (at === null) return { tip: null, from: null, walk: { changes: [], read: 0, bulk: 0, error: null }, tree: null };
  const [walk, tree] = await Promise.all([walkCochange(root, at.tip), filesAt(root, at.tip)]);
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

const companionOf = (key) => (key[0] === "e" ? { edits: key.slice(2) } : { adds: key.slice(2) });

/**
 * The gates in order, each pair's first failure recorded: test and shape and
 * ratio decide whether it is kept at all, and evidence, authors, lift,
 * existence and recency name a near miss.
 */
export function mineCochange(walk, { tree, required = GATES.authorEvidence }) {
  const changes = walk.changes;
  const classCache = new Map();
  const classes = (p) => classCache.get(p) ?? (classCache.set(p, classesOf(p)), classCache.get(p));
  const keysOf = (c) => {
    const keys = new Set();
    for (const p of c.touched) keys.add(`e\0${p}`);
    for (const p of c.added) for (const k of classes(p)) keys.add(`a\0${k}`);
    return keys;
  };

  // First pass: each class's newest candidates, and how often each companion is touched at all.
  const seen = new Map();
  const candidatesOf = new Map();
  const base = new Map();
  const live = [];
  const added = new Set();
  for (const [i, c] of changes.entries()) {
    for (const k of keysOf(c)) base.set(k, (base.get(k) ?? 0) + 1);
    const counted = [];
    for (const t of new Set(c.added.flatMap(classes))) {
      const n = seen.get(t) ?? 0;
      seen.set(t, n + 1);
      if (n >= COCHANGE.perClass) continue;
      counted.push(t);
      if (n === 0) candidatesOf.set(t, []);
      candidatesOf.get(t).push(i);
    }
    live.push(counted);
    for (const p of c.added) added.add(p);
  }
  const support = (t) => candidatesOf.get(t)?.length ?? 0;

  // Second pass: pairs, only where the bound could ever be met.
  const together = new Map();
  let keys = 0;
  for (const [i, c] of changes.entries()) {
    const producers = live[i].filter((t) => support(t) >= COCHANGE.minCandidates);
    if (producers.length === 0) continue;
    const companions = [...keysOf(c)].filter((k) => base.get(k) >= COCHANGE.minTouched);
    for (const t of producers) {
      const row = together.get(t) ?? (together.set(t, new Map()), together.get(t));
      for (const k of companions) {
        if (k === `a\0${t}`) continue;
        const n = row.get(k);
        if (n === undefined && ++keys > COCHANGE.keysMost) return { claims: [], truncated: true };
        row.set(k, (n ?? 0) + 1);
      }
    }
  }

  const kept = [];
  for (const [t, row] of together) {
    const of = support(t);
    for (const [k, n] of row) {
      const companion = companionOf(k);
      const target = companion.edits ?? companion.adds;
      if (isTestSide(sample(t)) || isTestSide(companion.edits ?? sample(target))) continue;
      if (companion.adds !== undefined && (classParts(target).spans || target === t || upOf(t) === target || upOf(target) === t)) continue;
      if (of < COCHANGE.nearMiss || n / of < GATES.minRatio) continue;
      kept.push({ t, k, n, of, companion });
    }
  }

  // The tip's tree, asked only about the classes a kept pair names.
  const asked = new Set(kept.flatMap(({ t, companion }) => [t, ...(companion.adds ? [companion.adds] : [])]));
  const atTip = new Map([...asked].map((cls) => [cls, [0, 0]]));
  const dirOf = (p) => p.slice(0, p.lastIndexOf("/"));
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
  // counted over came from two of them and one is still there: one child's
  // habit, gone at the tip, is no evidence for a sibling the tree still holds.
  const producerExists = (t) => {
    if (!classParts(t).spans) return atTip.get(t)[1] > 0;
    const from = new Set(candidatesOf.get(t).flatMap((i) => changes[i].added.filter((p) => classes(p).includes(t)).map(dirOf)));
    const held = dirsAtTip.get(t);
    return from.size >= 2 && [...from].some((d) => held?.has(d));
  };

  const keysAt = new Map();
  const keysOfAt = (i) => keysAt.get(i) ?? (keysAt.set(i, keysOf(changes[i])), keysAt.get(i));
  const claims = kept.map(({ t, k, n, of, companion }) => {
    const flags = candidatesOf.get(t).map((i) => keysOfAt(i).has(k));
    const hands = new Set();
    for (const [j, i] of candidatesOf.get(t).entries()) if (flags[j] && isPerson(changes[i].author)) hands.add(changes[i].author);
    const lift = n / of / (base.get(k) / changes.length);
    // A fifth of at least 35 candidates is at least 7, past the design's floor of 5.
    const recent = Math.ceil(of / 5);
    const met = flags.slice(0, recent).filter(Boolean).length;
    const exists = (companion.edits !== undefined ? tree?.has(companion.edits) : atTip.get(companion.adds)[1] > 0) && producerExists(t);
    const gate =
      wilsonLower(n, of) < GATES.minRatio ? "evidence"
        : hands.size < required ? "authors"
          : lift < COCHANGE.lift ? "lift"
            : !exists ? "exists"
              : met / recent < GATES.minRatio ? "recency"
                : null;
    return {
      producer: t,
      companion,
      candidates: of,
      conforming: n,
      newest: [met, recent],
      authors: hands.size,
      authorsRequired: required,
      lift: Math.round(lift * 100) / 100,
      files: atTip.get(t),
      area: null,
      gate,
      directive: gate === null,
    };
  });
  onePerPair(claims);
  const strongest = (stated) => claims
    .filter((c) => c.directive === stated)
    .sort((a, b) => b.candidates - a.candidates || byCode(a.producer, b.producer) || byCode(keyText(a), keyText(b)))
    .slice(0, CLAIMS_MOST);
  const stored = [...strongest(true), ...strongest(false)];
  stored.sort((a, b) => byCode(a.producer, b.producer) || byCode(keyText(a), keyText(b)));
  return { claims: stored, truncated: false };
}

const keyText = (c) => (c.companion.edits !== undefined ? `e\0${c.companion.edits}` : `a\0${c.companion.adds}`);

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
  const same = (a, b) => keyText(a) === keyText(b);
  for (const parent of stated.filter((c) => classParts(c.producer).spans)) {
    const children = stated.filter((c) => same(c, parent) && upOf(c.producer) === parent.producer);
    if (children.length === 0) continue;
    if (!children.every((c) => parent.candidates >= 1.1 * c.candidates)) drop(parent);
    else for (const c of children) drop(c);
  }
  for (const a of stated.filter((c) => c.companion.adds !== undefined)) {
    const b = stated.find((c) => c.directive && c.producer === a.companion.adds && c.companion.adds === a.producer);
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
