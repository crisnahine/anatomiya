/**
 * What a change that adds one kind of file also touches: the class a file
 * belongs to, the sentence a claim is said in, and which claims a branch owes.
 *
 * Apart from the walk that mines the claims (`cochange-walk.mjs`), because the
 * notice runs on a write and the check at review time, and neither has history
 * to read: both ask only which class a path is in and what a stored claim says.
 * One rule for all three, so the class a claim was counted over is the class it
 * is enforced on.
 */
import { encode, encodePath } from "./encode.mjs";
import { byCode } from "./paths.mjs";

// Ruby names its tests by a suffix of their own, which is a kind of file apart from `.rb`.
const RUBY_KIND = /(_spec|_test)\.rb$/;

/**
 * The kind a file name spells: from the first dot, past any segment a version
 * number starts, or null for a name with none. The first-dot rule alone split
 * one directory of vendored gems into `*.1.0.gem` and `*.2.0.gem`.
 */
export function suffixOf(name) {
  const ruby = RUBY_KIND.exec(name);
  if (ruby) return ruby[0];
  const parts = name.split(".");
  // A dotfile's own name is not its kind: `.eslintrc.js` is a `.js`.
  let k = parts[0] === "" ? 2 : 1;
  if (parts.length <= k) return null;
  while (k < parts.length - 1 && /^\d/.test(parts[k])) k++;
  const kind = parts.slice(k);
  return kind.includes("") ? null : `.${kind.join(".")}`;
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
  if (companion.edits !== undefined) return `an edit to ${encodePath(companion.edits)}`;
  const { dir, suffix } = classParts(companion.adds);
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

/** The key a claim's block is dropped under, which no dimension key can spell. */
export const claimKey = (claim) =>
  `cochange\0${claim.producer}\0${claim.companion.edits !== undefined ? `edits\0${claim.companion.edits}` : `adds\0${claim.companion.adds}`}`;

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

// The record is committed, so a hand edit reaches every reader: a claim that is
// not whole is not one, rather than a crash in a hook that must never fail.
function isWhole(c) {
  if (!c || typeof c !== "object" || typeof c.producer !== "string") return false;
  const { companion } = c;
  const named = companion && (typeof companion.edits === "string") !== (typeof companion.adds === "string");
  return Boolean(named)
    && isCount(c.candidates) && isCount(c.conforming) && isCount(c.authors)
    && Array.isArray(c.files) && c.files.length === 2 && c.files.every(isCount)
    && (c.area === null || typeof c.area === "string");
}

/** The claims a record states, each of the shape this build writes. */
export function statedClaims(record) {
  const claims = Array.isArray(record?.claims) ? record.claims : [];
  return claims.filter((c) => isWhole(c) && c.directive === true);
}

/** The stated claims an area's file carries. */
export const claimsIn = (record, areaPath) => statedClaims(record).filter((c) => c.area === areaPath);

/** The stated claims whose producer class holds this path. */
export const claimsFor = (rel, record) => {
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
  const met = claim.companion.edits !== undefined
    ? touched.includes(claim.companion.edits)
    : added.some((p) => classesOf(p).includes(claim.companion.adds));
  return met ? [] : producers.sort(byCode);
}
