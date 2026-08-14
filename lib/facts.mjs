/**
 * The machine record of every slot, and the one place its shape is known.
 *
 * The map is derivable from this file and the check reads it rather than the
 * rendered map, so writer and reader have to agree about the shape. They used to
 * agree by coincidence: the version lived in the writer, the rule for reading an
 * older record was copied into two modules, and the reader never looked at the
 * version at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FACTS_PATH = ".claude/anatomiya/facts.json";

// 2 added the polarity fields. A reader of the older shape sees no `states` and
// falls back to `directive`, which is the claim side and is what every schema-1
// record meant. 3 replaced the single `glob` with the `globs` an area delivers
// on. Every one of those is still readable here; a version this reader has not
// heard of is not.
export const FACTS_SCHEMA = 3;

/**
 * Which of a dimension's two sentences an area is about, with the counts and
 * the exception list that belong to it.
 *
 * Here rather than in the renderer, because the renderer and the check must
 * never name different sides of the same dimension and only one of them is a
 * presentation decision. A suppressed dimension still picks a side, because
 * "2 of 61 sites" reads as a directory with no habit when it has a very strong
 * one that was merely too concentrated to state. An exact tie prefers the
 * claim, which keeps the choice a pure function of the counts (A5).
 *
 * A record written before the inverse existed carries no `states`, and
 * `undefined !== null` would mark every suppressed dimension as stated.
 */
export function statedSide(d) {
  const states = d.states ?? (d.directive ? "claim" : null);
  const counter =
    d.counterClaim && (states === "counter" || (states === null && d.candidates - d.conforming > d.conforming));
  return counter
    ? {
        states,
        side: "counter",
        claim: d.counterClaim,
        conforming: d.candidates - d.conforming,
        exceptions: d.counterExceptions || [],
        more: d.moreCounterExceptions || 0,
        gate: d.counterGate,
      }
    : {
        states,
        side: "claim",
        claim: d.claim,
        conforming: d.conforming,
        exceptions: d.exceptions || [],
        more: d.moreExceptions || 0,
        gate: d.gate,
      };
}

/**
 * The facts on disk, or why they could not be used.
 *
 * A version past this reader's is refused rather than read: fields move between
 * versions, and a record read against the wrong shape enforces a convention
 * nobody stated. Absent or malformed stays `null`, which is the ordinary case of
 * a repository nobody has scanned.
 */
export function readFacts(root) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, FACTS_PATH), "utf8"));
  } catch {
    return { facts: null, unreadable: null };
  }
  if (!parsed || !Array.isArray(parsed.areas)) return { facts: null, unreadable: null };

  const schema = Number(parsed.schema);
  if (Number.isFinite(schema) && schema > FACTS_SCHEMA) {
    return {
      facts: null,
      unreadable: `the map on disk is schema ${schema} and this build reads up to ${FACTS_SCHEMA}, so nothing was enforced from it: scan again with this build`,
    };
  }
  return { facts: parsed, unreadable: null };
}
