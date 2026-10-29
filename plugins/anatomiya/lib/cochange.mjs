/**
 * What a change that adds one kind of file also touches: the class a file
 * belongs to, the sentence a claim is said in, and which claims a branch owes.
 *
 * Apart from the walk that mines the claims (`cochange-walk.mjs`), because the
 * notice runs on a write and the check at review time, and neither reads
 * history: both ask only which class a path is in, what a stored claim says,
 * and the bounds it was counted under. One rule for all three, so the class a
 * claim was counted over is the class it is enforced on.
 */
import { encode, encodePath } from "./encode.mjs";
import { baseOf, byCode } from "./paths.mjs";
import { RUBY_TEST_NAME } from "./test-shape.mjs";

// The record keeps at most this many stated claims and this many near misses,
// and a reader takes no more than this many of either from it.
export const CLAIMS_MOST = 100;

// Past this many added or modified files a change is bulk: a vendored import or
// a rename sweep says nothing about what ships together, so the walk counts no
// such change and the check holds no such branch to a claim at MUST-FIX.
export const CHANGE_MOST = 40;

const SUFFIX_TEST_NAME = /_test\.(?:go|py)$/;

/**
 * One change's additions and the files it touched, taken row by row as git
 * prints them or as a check reads them, so the walk that counts a claim and
 * the check that enforces it read a change one way (C55). An `A` row is an
 * addition, `M` and `T` rows are edits, a `D` row records a name that left,
 * any other letter is passed over, and a path this tool writes is no part of a
 * change on either side. `close` answers `{ bulk: true }` where the change
 * grew past `most` added or modified files or `goneMost` deleted names, and
 * stops storing there, which is what keeps a vendored import bounded in the
 * walk (F27); otherwise `{ bulk: false, added, touched }`, where a move, a path
 * deleted and added under its own name, is no addition. `keep` is how a path is
 * stored, the walk's one copy of each.
 */
export function changeAccumulator(own = () => false, { most = CHANGE_MOST, goneMost = Infinity, keep = (p) => p } = {}) {
  const added = [];
  const modified = [];
  const gone = new Set();
  let bulk = false;
  return {
    row(letter, path) {
      if (bulk || !path || own(path)) return;
      if (letter === "D") {
        gone.add(baseOf(path));
        if (gone.size > goneMost) bulk = true;
        return;
      }
      const list = letter === "A" ? added : letter === "M" || letter === "T" ? modified : null;
      if (list === null) return;
      list.push(keep(path));
      if (added.length + modified.length > most) bulk = true;
    },
    close() {
      if (bulk) return { bulk: true };
      return { bulk: false, added: added.filter((p) => !gone.has(baseOf(p))), touched: [...added, ...modified] };
    },
  };
}

// A kind is printed in a sentence, so it holds nothing a sentence could be built from.
const KIND = /^[\w.-]+$/;

/**
 * The kind a file name spells: from the first dot, past any segment a version
 * number starts, or null for a name with none. The first-dot rule alone split
 * one directory of vendored gems into `*.1.0.gem` and `*.2.0.gem`.
 */
export function suffixOf(name) {
  // A test name's own suffix is a kind apart from the plain one.
  const test = RUBY_TEST_NAME.exec(name) ?? SUFFIX_TEST_NAME.exec(name);
  if (test) return test[0];
  const parts = name.split(".");
  // A dotfile's own name is not its kind: `.eslintrc.js` is a `.js`.
  let k = parts[0] === "" ? 2 : 1;
  if (parts.length <= k) return null;
  while (k < parts.length - 1 && /^\d/.test(parts[k])) k++;
  const kind = parts.slice(k);
  return kind.includes("") || !KIND.test(kind.join(".")) ? null : `.${kind.join(".")}`;
}

/**
 * The classes a path is in: its directory's, and the same suffix one directory
 * up, unless that would be the repository root. Built on the `/` git prints on
 * every platform, never with `path.dirname`, which on Windows also splits on `\`.
 */
export function classesOf(path) {
  const at = path.lastIndexOf("/");
  const suffix = suffixOf(path.slice(at + 1));
  if (suffix === null) return [];
  if (at === -1) return [`*${suffix}`];
  const dir = path.slice(0, at);
  const up = dir.lastIndexOf("/");
  return up === -1 ? [`${dir}/*${suffix}`] : [`${dir}/*${suffix}`, `${dir.slice(0, up)}/*/*${suffix}`];
}

/** A class's directory, whether it spans the directories under it, and its suffix. */
export function classParts(cls) {
  const at = cls.lastIndexOf("/");
  const suffix = cls.slice(at + 2);
  if (at === -1) return { dir: null, spans: false, suffix };
  const head = cls.slice(0, at);
  return head.endsWith("/*") ? { dir: head.slice(0, -2), spans: true, suffix } : { dir: head, spans: false, suffix };
}

const producerText = (cls) => {
  const { dir, spans, suffix } = classParts(cls);
  const kind = `a ${encode(suffix)} file added`;
  if (dir === null) return `${kind} at the repository root`;
  return spans ? `${kind} to a directory in ${encodePath(dir)}` : `${kind} to ${encodePath(dir)}`;
};

const companionText = (companion) => {
  if (companion.kind === "edits") return `an edit to ${encodePath(companion.path)}`;
  const { dir, suffix } = classParts(companion.path);
  const kind = `a new ${encode(suffix)} file`;
  return dir === null ? `${kind} at the repository root` : `${kind} in ${encodePath(dir)}`;
};

/** The claim as one sentence, every repository path in it through the path encoder. */
export function claimSentence(claim) {
  return `${producerText(claim.producer)} ships with ${companionText(claim.companion)}`;
}

/** How many of the changes a claim was counted over conformed. */
export function changesPhrase(claim) {
  return `${claim.conforming} of the last ${claim.candidates} changes that added one`;
}

/** The notice's line for one claim, about a path its producer class holds. */
export function noticeLine(claim) {
  const { suffix } = classParts(claim.producer);
  return `  A ${encode(suffix)} file added here ships with ${companionText(claim.companion)}: ${changesPhrase(claim)}.`;
}

/** A companion as one string: an edit to a named file and an added file of a class never spell the same. */
export const companionKey = (companion) => `${companion.kind}\0${companion.path}`;

/** The companion a `companionKey` was built from. */
export const keyCompanion = (key) => {
  const at = key.indexOf("\0");
  return { kind: key.slice(0, at), path: key.slice(at + 1) };
};

/** The key a claim's block is dropped under, which no dimension key can spell. */
export const claimKey = (claim) => `cochange\0${claim.producer}\0${companionKey(claim.companion)}`;

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

// A repository-relative path git could have printed: no empty, `.` or `..` segment.
const isPlainPath = (p) => typeof p === "string" && p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");

// A class this module could have built: a plain directory and a kind a file name gives.
function isClass(cls) {
  if (typeof cls !== "string") return false;
  const { dir, spans, suffix } = classParts(cls);
  const built = dir === null ? `*${suffix}` : spans ? `${dir}/*/*${suffix}` : `${dir}/*${suffix}`;
  return built === cls && suffixOf(`x${suffix}`) === suffix && (dir === null || isPlainPath(dir));
}

// The record is committed, so a hand edit reaches every reader: a claim that is
// not whole is not one, rather than a crash in a hook that must never fail.
function isWhole(c) {
  if (!c || typeof c !== "object" || !isClass(c.producer)) return false;
  const { companion } = c;
  const named = companion && (companion.kind === "edits" ? isPlainPath(companion.path) : companion.kind === "adds" && isClass(companion.path));
  return Boolean(named)
    && isCount(c.candidates) && isCount(c.conforming) && isCount(c.authors)
    && Array.isArray(c.files) && c.files.length === 2 && c.files.every(isCount)
    && (c.area === null || typeof c.area === "string");
}

/** The claims a record states, each of the shape this build writes, the first hundred at most. */
export function statedClaims(record) {
  // The writer keeps a hundred of each kind, so nothing past both is read.
  const claims = Array.isArray(record?.claims) ? record.claims.slice(0, 2 * CLAIMS_MOST) : [];
  return claims.filter((c) => isWhole(c) && c.directive === true).slice(0, CLAIMS_MOST);
}

/** The stated claims an area's file carries. */
export const claimsIn = (record, areaPath) => statedClaims(record).filter((c) => c.area === areaPath);

/** The stated claims whose producer class holds this path. */
export const claimsFor = (record, rel) => {
  const classes = classesOf(rel);
  return statedClaims(record).filter((c) => classes.includes(c.producer));
};

/**
 * The producers a change added that a claim says needed a companion it did not
 * touch, in code order, or none. Touched is an added or modified path equal to
 * the named file, or an added file of the companion class.
 */
export function owedBy(claim, { added, touched }) {
  const producers = added.filter((p) => classesOf(p).includes(claim.producer));
  if (producers.length === 0) return [];
  const { kind, path } = claim.companion;
  const met = kind === "edits" ? touched.includes(path) : added.some((p) => classesOf(p).includes(path));
  return met ? [] : producers.sort(byCode);
}
