export const GATES = {
  minRatio: 0.9,
  z: 1.96,                // Wilson 95%; a perfect record needs 35 sites to hold 0.90
  authorEvidence: 2,      // two pairs of hands is the whole claim a per-file author count carries
  minEffectiveFiles: 3,   // how many files the evidence is worth, not how many carry it
  minApplicabilityShare: 0.25, // the floor that holds on a large area, where a root does not
  applicabilityShareCap: 3,    // in roots: the share stops growing where the risk it guards does not
};

/**
 * Wilson score lower bound.
 *
 * The gate asks whether the true conformance rate can be trusted at
 * `minRatio`, not whether this sample happened to reach it: 6 of 6 is a point
 * ratio of 1.00 whose true rate could plausibly be 0.61.
 */
export function wilsonLower(conforming, candidates, z = GATES.z) {
  const n = candidates;
  // Zero conforming is exactly zero: the general form leaves 2e-17 there, which
  // would put the bound a hair above the ratio it must never exceed.
  if (!(n > 0) || !(conforming > 0)) return 0;
  const p = Math.min(1, conforming / n); // a corrupt count would make the variance term negative
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (centre - margin) / (1 + z2 / n);
}

/**
 * The mirror of `wilsonLower`: the same centre, plus the margin.
 *
 * Asked of the area's own sample when it borrows a repository-wide rate, so a
 * sample that is plainly worse than the rate it is borrowing cannot borrow it.
 *
 * Held to the two bounds the arithmetic owes and the division does not give: it
 * is a probability, so never above one, and it is an upper bound on the rate it
 * was handed, so never below it. Unheld, `wilsonUpper(n, n)` returned
 * 0.9999999999999998 at 118 of the first 500 sample sizes and 1.0000000000000002
 * at others, and the borrow compares it against a rate that is exactly 1 wherever
 * the rest of the repository holds a claim without exception. On a measured front
 * end, 37 perfect rows were denied at n = 12, 20, 21 and 31 while n = 16, 17, 19
 * and 23 through 26 denied none between them: the size decided, not the evidence.
 *
 * The lower clamp is what carries the perfect case, and it subsumes asking
 * whether the sample already meets the rate it is borrowing: at or above that
 * rate the bound is too, by construction rather than by rounding.
 */
export function wilsonUpper(conforming, candidates, z = GATES.z) {
  const n = candidates;
  if (!(n > 0)) return 1;
  const p = Math.min(1, conforming / n);
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, Math.max(p, (centre + margin) / (1 + z2 / n)));
}
