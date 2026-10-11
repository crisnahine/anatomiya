/**
 * The sites a branch introduced in one file, judged against one polarity.
 *
 * The check's own re-judging path, kept apart from the scan's counts (B10, D6,
 * E2): it takes a parsed program and the same string the parser was handed,
 * reaches no git, no disk and no caveat, and answers with sites whose identity
 * is their content rather than their position. The severity a site is reported
 * at is decided by the caller, off the area's slot (H24), and `check.mjs` is
 * the only caller.
 */
import { createHash } from "node:crypto";

import { dimensionsFor } from "./dimensions.mjs";
import { CLASSES, claimFor } from "./dimensions-naming.mjs";
import { encode } from "./encode.mjs";
import { statedSide } from "./facts.mjs";
import { holdsTypeSyntax, spokenIn } from "./langs.mjs";
import { groupKey, isLearnedItself, reachesThrough, sameConstant } from "./reduce.mjs";
import { isFunctionLike, walk } from "./walk.mjs";

/**
 * The sites `head` holds that the branch introduced, judged against `base` or
 * against the added-line ranges, and against the one polarity the area states.
 *
 * `keyPath` is the path the file had at the base, so a rename produces the
 * same identities on both sides; it defaults to `path`. `head.facets` governs
 * both revisions, for which rows are asked and for what each row is told the
 * file is: the kind is a property of the file under review, and answering it
 * per revision skipped the whole base side of a file that gained JSX on the
 * branch, and charged a file moved out of a test tree every site it held.
 * `base` and `addedLines` are the two modes and cannot both be given; neither
 * is a file the branch added, where every head site is new.
 * `rows` narrows the registry, for a test driving one row. `parents` is what
 * `declaredParents` found in the files the branch changed in this area.
 *
 * A row that throws on one tree loses its own sites for that file and nothing
 * else. Order is registry order, then walk order, then the grouped bodies of
 * a row in first-seen order, which is what keeps the report byte-stable.
 */
export function newlyIntroduced({
  area,
  ancestorsOf = () => [],
  path,
  keyPath = path,
  lang,
  frameworks,
  capabilities,
  head,
  base = null,
  addedLines = null,
  rows,
  parents = new Map(),
}) {
  if (base && addedLines) throw new TypeError("a base revision and an added-line list are two answers to one question");
  // Read once and handed to both revisions: read separately, a file whose area
  // states the inverse would show every pre-existing site as newly introduced.
  const polarity = { ...sidesFor(area, ancestorsOf), parents };
  const judge = (rev, copies) =>
    breakingSites(rev.program, rev.source, lang, keyPath, {
      polarity,
      copies,
      frameworks,
      capabilities,
      rows,
      comments: rev.comments,
      stripped: rev.stripped,
      rel: path,
      facets: head.facets,
    });
  const headCopies = new Map();
  const found = judge(head, headCopies);
  if (addedLines) return found.filter((f) => addedLines.some(([a, b]) => f.line >= a && f.line <= b));
  const baseCopies = new Map();
  return absorb(found, base ? judge(base, baseCopies) : [], headCopies, baseCopies);
}

/**
 * The superclass each class in one revision names, per learned row, keyed by
 * the class's own qualified name.
 *
 * The fold follows a chain through every class its area declares, and the
 * check holds only the map's `reaches` for the classes it did not read. A base
 * the branch adds is in neither, so the check reads the branch's own
 * declarations too, or every subclass of that base is told to skip it.
 */
export function declaredParents({ path, lang, frameworks, capabilities, rows, head }) {
  const out = new Map();
  for (const dim of dimensionsFor(spokenIn(lang, head.facets), { frameworks, capabilities, rows })) {
    if (!dim.learnedClasses || dim.groupedSites) continue;
    const parents = new Map();
    try {
      dim.run(head.program, (hit) => {
        if (typeof hit.self === "string" && typeof hit.class === "string" && !parents.has(hit.self)) parents.set(hit.self, hit.class);
      }, { comments: head.comments, source: head.source, rel: path, facets: head.facets });
    } catch {
      continue;
    }
    if (parents.size) out.set(dim.key, parents);
  }
  return out;
}

/**
 * The identity of one site: the node's type and its normalised slice of the
 * parsed string, keyed under the path and the row. Never the line, since one
 * added import shifts every line below it. A parser that reports no offsets
 * leaves the node's own name as the identity.
 *
 * Every function and class body inside the node reads as `{}`: a row that
 * reports a whole declaration would otherwise give it a new identity for any
 * line added to its body, and the untouched declaration came back as new.
 */
export function siteIdentity(keyPath, key, node, source) {
  const text = located(node) ? normalise(withoutBodies(node, source)) : "";
  return fingerprint(keyPath, key, node.type, text || node.name || "");
}

/** Whether the parser reported offsets for a node; prism reports none (B5). */
const located = (node) => typeof node.start === "number" && typeof node.end === "number";

function withoutBodies(node, source) {
  const bodies = [];
  walk(node, (n) => {
    if ((isFunctionLike(n) || n.type === "ClassDeclaration" || n.type === "ClassExpression") && n.body && located(n.body)) {
      bodies.push(n.body);
    }
  });
  let text = "";
  let at = node.start;
  // A body inside one already cut starts before `at` and is skipped.
  for (const b of bodies.sort((x, y) => x.start - y.start)) {
    if (b.start < at) continue;
    text += `${source.slice(at, b.start)}{}`;
    at = b.end;
  }
  return text + source.slice(at, node.end);
}

/**
 * The normalised slice of the parsed string under a node, or nothing where the
 * parser reported no offsets. The same in-memory string the parser was handed,
 * never a disk buffer: oxc reports UTF-16 code units, a buffer is bytes, and
 * 5.4% of real files are non-ASCII, so indexing a buffer with a parser offset
 * corrupts silently (B5).
 */
const sliceOf = (node, source) => (located(node) ? normalise(source.slice(node.start, node.end)) : "");

/**
 * The identity of one grouped body: what it declares, sorted, so two includes
 * swapped are not a site anyone introduced.
 */
export function bodyIdentity(keyPath, key, hits) {
  return fingerprint(keyPath, key, "body", constantsOf(hits));
}

/**
 * The side each dimension of this area was rendered on, keyed by dimension.
 * A path in no area yields an empty map, and the claim side is the default,
 * which is what every one-sided dimension and every schema-1 map reads as.
 */
function sidesFor(area, ancestorsOf = () => []) {
  const sides = new Map();
  const learned = new Map();
  // Which kind of file each learned class was measured over. A row that
  // narrowed its population must be enforced over the same one, or the check
  // judges the files the map deliberately left out.
  const kinds = new Map();
  // The kind each sentence names, which is only the rows whose narrowing left
  // something out. Separate from `kinds` because one governs the population and
  // the other governs the words: an area holding one kind narrows and says
  // nothing about it.
  const qualified = new Map();
  // The keys whose slot the map actually stated. An omission site exists only
  // to say "you should have written X", which is a directive, so it may only be
  // reported where the gates let the map say it.
  const stated = new Set();
  // The area's classes the fold found reaching the learned base (STI), so a new
  // subclass of one of them conforms here as it does in the map.
  const reaching = new Map();
  const put = (d) => {
    if (sides.has(d.key)) return;
    sides.set(d.key, statedSide(d).side);
    if (statedSide(d).states !== null) stated.add(d.key);
    // The class the map measured is the only sentence a learned row may be
    // enforced as; a hit's own flag is a placeholder the reducer overwrites.
    if (typeof d.learned === "string") learned.set(d.key, d.learned);
    if (Array.isArray(d.reaches)) reaching.set(d.key, new Set(d.reaches.filter((c) => typeof c === "string")));
    if (typeof d.learnedKind === "string") kinds.set(d.key, d.learnedKind);
    if (typeof d.learnedKind === "string" && d.narrowed === true) qualified.set(d.key, d.learnedKind);
  };
  for (const d of (area && area.dimensions) || []) put(d);
  // A dimension this area holds no slot for is answered by the nearest area it
  // sits inside that states one, and the polarity travels with the slot. Read
  // separately, an inherited finding would be judged on the claim side while
  // the ancestor's map handed the agent the inverse.
  for (const up of ancestorsOf(area)) {
    for (const d of up.dimensions || []) if (statedSide(d).states !== null) put(d);
  }
  return { sides, learned, kinds, qualified, stated, reaching };
}

/**
 * Whether the class the map stored may be enforced as this row's sentence.
 *
 * The value comes off a repository-committed record, so it is refused here
 * rather than where it is rendered (F4). A row whose class is a name out of the
 * source is encoded by `claimFor`, and what the encoder empties would state a
 * sentence naming nothing. Every other row votes inside a closed vocabulary,
 * and a value from outside it enforces nothing.
 */
function enforceableClass(dim, cls) {
  if (typeof cls !== "string") return false;
  if (dim.learnedFromSource) return encode(cls) !== "";
  // A row that can learn an absence is a prefix row: its vocabulary is one
  // capital or none at all. The rest vote for one of the four naming classes.
  return typeof dim.noneClaim === "string" ? /^(?:[A-Z]|none)$/.test(cls) : CLASSES.includes(cls);
}

/**
 * A site that exists because a construct is absent rather than wrong.
 *
 * A learned row's hit votes with the class it names, so a hit naming none is a
 * body that declared nothing: the forgotten include H16 made visible, and the
 * class that named no superclass. Its whole meaning is "you should have written
 * X", which is a directive, so it is only ever reported where the map stated
 * the claim. On a row the gates suppressed it manufactures guidance out of a
 * count the gates rejected.
 */
const isOmission = (hit) => hit.class === undefined || hit.class === null;

function breakingSites(program, source, lang, keyPath, { polarity, copies = new Map(), frameworks, capabilities, rows, comments = [], stripped = false, rel = null, facets = null }) {
  const { sides, learned, kinds, qualified, stated, reaching = new Map(), parents = new Map() } = polarity;
  const out = [];
  // One index of line starts per revision, built on the first site that asks.
  const lines = lazyLines(source);
  // A tree that came back from the Flow retry has its annotations blanked, so
  // the dimensions whose question is the annotation would report a site
  // beside the line that satisfies it. The scan drops them for such a file and
  // this has to agree, or the map and the check disagree about the same file.
  // The rows are the ones the scan ran on this file, JSX rows included where
  // the head's tree holds JSX under a `.js` name.
  for (const dim of dimensionsFor(spokenIn(lang, facets), { frameworks, capabilities, rows })) {
    if (stripped && dim.blindWhenStripped) continue;
    // A plain JavaScript file cannot carry a type annotation, so the scan left
    // it out of this row's population and the check has to leave it out of the
    // findings.
    if (dim.needsTypeSyntax && !holdsTypeSyntax(rel ?? keyPath, facets)) continue;
    // A learned row with no class the map may state has no sentence to
    // enforce: every hit is a vote, and a vote is not a finding.
    const cls = learned.get(dim.key);
    if (dim.learnedClasses && !enforceableClass(dim, cls)) continue;
    // The map's class was learned over one kind of file, so judging the other
    // kind by it is the pooling the narrowing exists to stop. A record with no
    // learned kind is an older scan, which narrowed nothing.
    if (dim.splitBy && kinds.has(dim.key) && dim.splitBy({ facets }) !== kinds.get(dim.key)) continue;
    // A map written when the row still had an inverse stated it; judged as the
    // claim, the area's own majority would be the finding.
    if (sides.get(dim.key) === "counter" && typeof dim.counterClaim !== "string") continue;
    const counter = sides.get(dim.key) === "counter";
    const found = [];
    // A site that is the very class the area learned cannot inherit itself, so
    // it reads as conforming here rather than as a finding. The fold drops it
    // from the population; the check re-runs the predicate and has to agree.
    const chain = dim.learnedClasses ? chainOf(cls, reaching.get(dim.key), parents.get(dim.key)) : null;
    const conformingOf = (hit) =>
      dim.learnedClasses
        ? sameConstant(hit.class, cls, hit.nesting) || isLearnedItself(hit, cls) || reachesThrough(hit.class, cls, chain)
        : hit.conforming;
    const site = (hit, fp = siteIdentity(keyPath, dim.key, hit.node || {}, source)) => {
      const node = hit.node || {};
      const found = {
        dimension: dim.key,
        claim: counter ? dim.counterClaim : dim.learnedClasses ? claimFor(dim, cls, qualified.get(dim.key)) : dim.claim,
        precision: dim.precision,
        where: hit.where || null,
        line: located(node) ? lines().lineAt(node.start) : node.line || 1,
        text: sliceOf(node, source),
        // Through the exported spelling, so the identity every pin imports is
        // the one written here, at the cost of slicing the node twice.
        fp,
      };
      if (located(node)) contextOf.set(found, lines().around(node.start, node.end));
      return found;
    };
    // A grouped row answers per enclosing body, so its hits are held until the
    // walk is over: one include out of two matching is the body conforming, and
    // reporting per constant would charge the author twice for one class.
    const bodies = dim.groupedSites ? new Map() : null;
    // A dimension that throws on this program loses its own findings for this
    // file. Both sides of the comparison run the same dimensions over the same
    // shapes, so a failure that is not symmetric can only lose a finding, never
    // manufacture one.
    try {
      dim.run(program, (hit) => {
        if (bodies) {
          const key = groupKey(hit, bodies.size);
          if (bodies.has(key)) bodies.get(key).push(hit);
          else bodies.set(key, [hit]);
          return;
        }
        // Every copy of a body-judging row is kept, conforming or not, in walk
        // order per identity, declaration and opening line.
        let copy = null;
        if (dim.judgesBody && located(hit.node)) {
          const fp = siteIdentity(keyPath, dim.key, hit.node, source);
          const at = `${fp}\0${hit.where ?? ""}\0${lines().around(hit.node.start, hit.node.start)}`;
          copy = { fp, text: sliceOf(hit.node, source), site: null };
          if (copies.has(at)) copies.get(at).push(copy);
          else copies.set(at, [copy]);
        }
        // On the counter side the conforming sites are the ones that break what
        // the map said. Enforcing `!conforming` there charges an author for
        // writing the sentence the area handed them.
        if (counter ? !conformingOf(hit) : conformingOf(hit)) return;
        if (dim.learnedClasses && isOmission(hit) && !stated.has(dim.key)) return;
        const at = site(hit, copy?.fp);
        if (copy) {
          copy.site = at;
          judged.add(at);
        }
        found.push(at);
      }, { comments, source, rel, facets });
    } catch {
      continue;
    }
    for (const hits of bodies ? bodies.values() : []) {
      const conforming = hits.some(conformingOf);
      if (counter ? !conforming : conforming) continue;
      if (dim.learnedClasses && hits.every(isOmission) && !stated.has(dim.key)) continue;
      // The body's first hit is where the reader is sent, because that is where
      // the body says what it mixes in.
      const at = site(hits[0]);
      // The whole body is the site, so its identity is what it mixes in, sorted:
      // the first hit's own node is `include` in every body of the file, and
      // swapping two includes is not a site anyone introduced. Adding one
      // to a body that already broke the sentence is charged, which is accepted:
      // the branch did edit that body.
      at.fp = bodyIdentity(keyPath, dim.key, hits);
      found.push(at);
    }
    out.push(...found);
  }
  return out;
}

/**
 * One parent map for `reachesThrough`: each class the map recorded as reaching
 * the learned base is one step from it, and what the branch declares replaces
 * that, since a branch can move a class off the base as well as add one.
 */
function chainOf(learned, reaching = new Set(), declared = new Map()) {
  const chain = new Map([...reaching].map((c) => [c, learned]));
  for (const [self, parent] of declared) chain.set(self, parent);
  return chain;
}

/**
 * Identical sites in one file are distinguished by count, not by identity: two
 * copies of the same site at the base absorb two at HEAD, and a third one
 * is new. The enclosing declaration's name is deliberately not part of the key,
 * because renaming a function does not introduce the site inside it.
 *
 * The name still picks which copies the base held. Absorbed in walk order, a
 * copy added above an old one was taken for the old one, and the report sent
 * the reader to code the branch never touched; in Ruby, where prism reports no
 * offsets and every rescue in a file is one identity, that was any rescue added
 * above a swallowing one. So a head copy whose declaration holds a base copy is
 * matched to it first, and only what is left absorbs by count.
 *
 * Between the two, the lines the site sits on. A function renamed below one
 * added above it left neither copy's declaration matching the base's, and
 * count absorbed the added one in walk order: the report named the renamed
 * function's untouched line and said nothing about the line the branch wrote.
 * The site's own text is the same in every copy, which is why the copies share
 * an identity, but the lines around it are what the branch did or did not
 * touch. Where those match too, the copies are alike and order is all there is.
 *
 * The identity leaves bodies out, so the first pass also asks for the site's
 * own text, which is what the identity alone matched before. A copy whose body
 * the branch edited matches neither of the first two and is taken by the name
 * around it last, so a new copy of the same shape elsewhere is the one left.
 *
 * A row that judges the body cannot be matched by name or count, since which
 * copy breaks is the question. Its alike copies, conforming or not, are
 * aligned the way a line diff aligns lines: an unchanged copy anchors, and a
 * run between two anchors holding as many copies on each side was edited in
 * place, so a head copy breaks anew where its partner did not. A run where the
 * branch added or removed a copy has no partner to read, and its sites are
 * matched as any other, with the whole text as the identity.
 */
function absorb(head, base, headCopies = new Map(), baseCopies = new Map()) {
  const out = new Set();
  const settled = new Set();
  for (const [key, now] of headCopies) {
    for (const [was, is] of runs(baseCopies.get(key) || [], now)) {
      if (was.length !== is.length) continue;
      is.forEach((c, i) => {
        if (c.site && !was[i].site) out.add(c.site);
        settled.add(c.site).add(was[i].site);
      });
    }
  }
  const unsettled = (sites) => sites.filter((f) => !settled.has(f));
  for (const f of byIdentity(unsettled(head), unsettled(base))) out.add(f);
  return head.filter((f) => out.has(f));
}

function byIdentity(head, base) {
  const id = (f) => (judged.has(f) ? `${f.fp}\0${f.text}` : f.fp);
  const remaining = new Map();
  for (const f of base) remaining.set(id(f), (remaining.get(id(f)) || 0) + 1);

  // A base copy one pass matched is spent for the next, or one copy could
  // answer for two head sites and leave a copy nobody matched.
  const spent = new Set();
  const held = new Set();
  for (const key of [
    (f) => `${f.fp}\0${f.where ?? ""}\0${f.text}`,
    (f) => (contextOf.has(f) ? `${f.fp}\0${contextOf.get(f)}` : null),
    (f) => `${id(f)}\0${f.where ?? ""}`,
  ]) {
    const copies = new Map();
    for (const f of base) {
      const k = key(f);
      if (k === null || spent.has(f)) continue;
      if (copies.has(k)) copies.get(k).push(f);
      else copies.set(k, [f]);
    }
    for (const f of head) {
      if (held.has(f)) continue;
      const k = key(f);
      const copy = k === null ? undefined : copies.get(k)?.shift();
      if (!copy) continue;
      spent.add(copy);
      remaining.set(id(copy), remaining.get(id(copy)) - 1);
      held.add(f);
    }
  }

  return head.filter((f) => {
    if (held.has(f)) return false;
    const left = remaining.get(id(f)) || 0;
    if (left > 0) remaining.set(id(f), left - 1);
    return left === 0;
  });
}

/**
 * Two lists of copies cut into runs, each a pair of the base's and the head's
 * copies in order: one unchanged copy on each side, or what lies between two
 * of them. The unchanged ones are a longest common subsequence of the texts,
 * after the common ends are trimmed, which is all an unedited file costs.
 */
function runs(was, now) {
  const same = (i, j) => was[i].text === now[j].text;
  let lo = 0;
  while (lo < was.length && lo < now.length && same(lo, lo)) lo++;
  let hi = 0;
  while (hi < was.length - lo && hi < now.length - lo && same(was.length - 1 - hi, now.length - 1 - hi)) hi++;
  const m = was.length - hi;
  const n = now.length - hi;
  const out = [];
  for (let k = 0; k < lo; k++) out.push([[was[k]], [now[k]]]);
  if ((m - lo) * (n - lo) > ALIGNED_CELLS) {
    // Two one-sided runs have no partners, so the middle is matched by its whole text.
    out.push([was.slice(lo, m), []], [[], now.slice(lo, n)]);
  } else {
    const L = Array.from({ length: m - lo + 1 }, () => new Uint32Array(n - lo + 1));
    for (let i = m - 1; i >= lo; i--) {
      for (let j = n - 1; j >= lo; j--) {
        L[i - lo][j - lo] = same(i, j) ? L[i - lo + 1][j - lo + 1] + 1 : Math.max(L[i - lo + 1][j - lo], L[i - lo][j - lo + 1]);
      }
    }
    let gap = [[], []];
    let i = lo;
    let j = lo;
    while (i < m || j < n) {
      if (i < m && j < n && same(i, j) && L[i - lo][j - lo] === L[i - lo + 1][j - lo + 1] + 1) {
        out.push(gap, [[was[i++]], [now[j++]]]);
        gap = [[], []];
      } else if (j >= n || (i < m && L[i - lo + 1][j - lo] >= L[i - lo][j - lo + 1])) gap[0].push(was[i++]);
      else gap[1].push(now[j++]);
    }
    out.push(gap);
  }
  for (let k = hi; k > 0; k--) out.push([[was[was.length - k]], [now[now.length - k]]]);
  return out;
}

// About 2,000 copies a side, 16 MB and tens of milliseconds; past it the table is quadratic.
const ALIGNED_CELLS = 1 << 22;

// What a grouped body declares, in one order whatever order it was written in.
// A body that declares nothing has no constants to be told apart by, so it
// answers with its own name: every bare body in a file was otherwise the same
// site, and a new one absorbed an older one's finding, which put the report on
// a body the branch never touched.
const constantsOf = (hits) => {
  const constants = hits.map((h) => h.class).filter(Boolean).sort().join(" ");
  return constants || `body ${hits[0]?.where ?? ""}`;
};

function fingerprint(path, key, kind, text) {
  return createHash("sha256").update([path, key, kind, text].join("\0")).digest("hex").slice(0, 16);
}

const normalise = (s) => s.replace(/\s+/g, " ").trim();

// The lines a located site sits on, normalised, which is what `absorb` tells
// alike copies apart by. Beside the site rather than on it, so the record the
// caller reads keeps the shape it had.
const contextOf = new WeakMap();

// The sites of a body-judging row, whose identity leaves out what the row
// judges, so the whole text has to stand beside it.
const judged = new WeakSet();

/**
 * Where each line of one source starts, found once and searched by halving.
 *
 * Counted from the start of the file per site, the work grew with the square
 * of the file: a 619 KB file holding 30,000 sites took 28 seconds. Built on
 * the first call, so a revision with no site pays nothing.
 */
function lazyLines(source) {
  let index = null;
  return () => {
    if (index) return index;
    const starts = [0];
    for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) starts.push(i + 1);
    // The line holding an offset: the last start at or before it. An offset
    // past the end reads as the last line, as the count it replaces did.
    const indexOf = (offset) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    index = {
      lineAt: (offset) => indexOf(Math.min(offset, source.length)) + 1,
      around: (start, end) => {
        const last = indexOf(Math.max(start, end - 1));
        const stop = last + 1 < starts.length ? starts[last + 1] : source.length;
        return normalise(source.slice(starts[indexOf(start)], stop));
      },
    };
    return index;
  };
}
