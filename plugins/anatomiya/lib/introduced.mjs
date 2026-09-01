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
import { holdsTypeSyntax } from "./langs.mjs";
import { groupKey, isLearnedItself } from "./reduce.mjs";

/**
 * The sites `head` holds that the branch introduced, judged against `base` or
 * against the added-line ranges, and against the one polarity the area states.
 *
 * `keyPath` is the path the file had at the base, so a rename produces the
 * same identities on both sides; it defaults to `path`. `head.facets` governs
 * both revisions: the kind is a property of the file under review, and
 * answering it per revision skipped the whole base side of a file that gained
 * JSX on the branch. `base` and `addedLines` are the two modes and cannot both
 * be given; neither is a file the branch added, where every head site is new.
 * `rows` narrows the registry, for a test driving one row.
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
}) {
  if (base && addedLines) throw new TypeError("a base revision and an added-line list are two answers to one question");
  // Read once and handed to both revisions: read separately, a file whose area
  // states the inverse would show every pre-existing site as newly introduced.
  const polarity = sidesFor(area, ancestorsOf);
  const judge = (rev) =>
    breakingSites(rev.program, rev.source, lang, keyPath, {
      polarity,
      frameworks,
      capabilities,
      rows,
      comments: rev.comments,
      stripped: rev.stripped,
      rel: path,
      facets: head.facets,
    });
  const found = judge(head);
  if (addedLines) return found.filter((f) => addedLines.some(([a, b]) => f.line >= a && f.line <= b));
  return absorb(found, base ? judge(base) : []);
}

/**
 * The identity of one site: the node's type and its normalised slice of the
 * parsed string, keyed under the path and the row. Never the line, since one
 * added import shifts every line below it. A parser that reports no offsets
 * leaves the node's own name as the identity.
 */
export function siteIdentity(keyPath, key, node, source) {
  const text = sliceOf(node, source);
  return fingerprint(keyPath, key, node.type, text || node.name || "");
}

/** Whether the parser reported offsets for a node; prism reports none (B5). */
const located = (node) => typeof node.start === "number" && typeof node.end === "number";

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
  const put = (d) => {
    if (sides.has(d.key)) return;
    sides.set(d.key, statedSide(d).side);
    if (statedSide(d).states !== null) stated.add(d.key);
    // The class the map measured is the only sentence a learned row may be
    // enforced as; a hit's own flag is a placeholder the reducer overwrites.
    if (typeof d.learned === "string") learned.set(d.key, d.learned);
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
  return { sides, learned, kinds, qualified, stated };
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

function breakingSites(program, source, lang, keyPath, { polarity, frameworks, capabilities, rows, comments = [], stripped = false, rel = null, facets = null }) {
  const { sides, learned, kinds, qualified, stated } = polarity;
  const out = [];
  // A tree that came back from the Flow retry has its annotations blanked, so
  // the dimensions whose question is the annotation would report a site
  // beside the line that satisfies it. The scan drops them for such a file and
  // this has to agree, or the map and the check disagree about the same file.
  for (const dim of dimensionsFor([lang], { frameworks, capabilities, rows })) {
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
    const counter = sides.get(dim.key) === "counter" && typeof dim.counterClaim === "string";
    const found = [];
    // A site that is the very class the area learned cannot inherit itself, so
    // it reads as conforming here rather than as a finding. The fold drops it
    // from the population; the check re-runs the predicate and has to agree.
    const conformingOf = (hit) =>
      dim.learnedClasses ? hit.class === cls || isLearnedItself(hit, cls) : hit.conforming;
    const site = (hit) => {
      const node = hit.node || {};
      return {
        dimension: dim.key,
        claim: counter ? dim.counterClaim : dim.learnedClasses ? claimFor(dim, cls, qualified.get(dim.key)) : dim.claim,
        precision: dim.precision,
        where: hit.where || null,
        line: located(node) ? lineAt(source, node.start) : node.line || 1,
        text: sliceOf(node, source),
        // Through the exported spelling, so the identity every pin imports is
        // the one written here, at the cost of slicing the node twice.
        fp: siteIdentity(keyPath, dim.key, node, source),
      };
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
        // On the counter side the conforming sites are the ones that break what
        // the map said. Enforcing `!conforming` there charges an author for
        // writing the sentence the area handed them.
        if (counter ? !conformingOf(hit) : conformingOf(hit)) return;
        if (dim.learnedClasses && isOmission(hit) && !stated.has(dim.key)) return;
        found.push(site(hit));
      }, { comments, source, rel });
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
 * Identical sites in one file are distinguished by count, not by identity: two
 * copies of the same site at the base absorb two at HEAD, and a third one
 * is new. The enclosing declaration's name is deliberately not part of the key,
 * because renaming a function does not introduce the site inside it.
 */
function absorb(head, base) {
  const remaining = new Map();
  for (const f of base) remaining.set(f.fp, (remaining.get(f.fp) || 0) + 1);

  const out = [];
  for (const f of head) {
    const left = remaining.get(f.fp) || 0;
    if (left > 0) {
      remaining.set(f.fp, left - 1);
      continue;
    }
    out.push(f);
  }
  return out;
}

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

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}
