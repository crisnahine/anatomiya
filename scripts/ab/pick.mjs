// scripts/ab/pick.mjs
/**
 * Which stated claim has room for the arms to differ.
 *
 * The one A/B already run scored 10 of 10 in both arms, on a claim stated at
 * 140 of 145 sites. That is not a null result about the map, it is a task with
 * no headroom: the model would have to write the failing form three times in a
 * hundred for the two arms to look different at all. Picking the area by
 * headroom is the difference between a measurement and a coin that always lands
 * the same way.
 *
 * A suppressed dimension is never a candidate. The map said nothing about it,
 * so an arm holding the map and an arm holding none were handed the same
 * information about it.
 */
import { ALL_DIMENSIONS } from "../../lib/dimensions.mjs";
import { PAIRINGS } from "../../lib/pairing.mjs";
import { NAMING_CORPUS, fillClass } from "../../lib/dimensions-naming.mjs";

// The record stores counts, not sentences. Reading `claim` off it put the word
// "undefined" in the result file where the claim belongs, so the sentence comes
// from the one place that holds it.
const CLAIMS = new Map([...ALL_DIMENSIONS, ...PAIRINGS, ...NAMING_CORPUS].map((d) => [d.key, d.claim]));

export function rankAreas(facts, { minCandidates = 20 } = {}) {
  const out = [];
  for (const area of facts.areas ?? []) {
    for (const d of area.dimensions ?? []) {
      const stated = d.states === "claim" || (d.states === undefined && d.directive);
      if (!stated) continue;
      // The renderer drops a default-matching claim to a counts line, so the
      // map arm was never handed a directive to differ on.
      if (d.matchesDefault === true) continue;
      if (!d.candidates || d.candidates < minCandidates) continue;
      const ratio = d.conforming / d.candidates;
      const template = d.claim ?? CLAIMS.get(d.key) ?? d.key;
      out.push({
        path: area.path,
        key: d.key,
        // The record stores the class, not the sentence; the sentence is the
        // template filled with it.
        ...(d.learned !== undefined ? { learned: d.learned } : {}),
        claim: d.learned !== undefined ? fillClass(template, d.learned) : template,
        candidates: d.candidates,
        ratio,
        headroom: Math.max(0, 1 - ratio),
      });
    }
  }
  return out.sort((a, b) => b.headroom - a.headroom || b.candidates - a.candidates);
}

export const NO_HEADROOM =
  "every stated claim in this repository is at 1.00, so an A/B here can only measure a ceiling: pick another repository";
