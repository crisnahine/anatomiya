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
import { fillClass } from "../../plugins/anatomiya/lib/dimensions-naming.mjs";
import { REGISTRY } from "../../plugins/anatomiya/lib/registry.mjs";

// The record stores counts, not sentences. Reading `claim` off it put the word
// "undefined" in the result file where the claim belongs, so the sentence comes
// from the one place that holds it.
const CLAIMS = new Map(REGISTRY.map((d) => [d.key, d.claim]));

/** Fewer sites than this is not an arm anyone could read a difference off. */
const MIN_CANDIDATES = 20;

export function rankAreas(facts, { minCandidates = MIN_CANDIDATES } = {}) {
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
        // A naming row learned over one kind of file is scored over that kind.
        ...(typeof d.learnedKind === "string" ? { learnedKind: d.learnedKind } : {}),
        claim: d.learned !== undefined ? fillClass(template, d.learned) : template,
        candidates: d.candidates,
        ratio,
        headroom: Math.max(0, 1 - ratio),
      });
    }
  }
  return out.sort((a, b) => b.headroom - a.headroom || b.candidates - a.candidates);
}

/**
 * Why the best-ranked claim cannot be measured, naming the rule that refused
 * it, or null when it can. Only a claim at 1.00 is a ceiling; one under the
 * floor is named with its numbers, since a lower --min-headroom measures it.
 */
export function noHeadroom(best, { minHeadroom, key = null, area = null } = {}) {
  if (best && best.headroom >= minHeadroom) return null;
  const filters = [key && `--key ${key}`, area && `--area ${area}`].filter(Boolean);
  const claim = `stated claim${filters.length ? ` matching ${filters.join(" and ")}` : ""}`;
  if (!best) return `no ${claim} has ${MIN_CANDIDATES} sites or more that the model does not already write by default`;
  if (best.headroom === 0) return `every ${claim} is at 1.00, so an A/B here can only measure a ceiling: pick another repository`;
  return [
    `no ${claim} has headroom of at least ${minHeadroom}: the best is ${best.key} in ${best.path}`,
    ` at ${best.ratio.toFixed(3)}, headroom ${best.headroom.toFixed(3)}.`,
    " Lower --min-headroom to measure it, or pick another repository",
  ].join("");
}
