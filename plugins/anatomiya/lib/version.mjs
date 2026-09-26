/**
 * Version numbers, compared as numbers.
 *
 * Its own module because two sides ask it: the readiness probe holding an
 * engine to its floor, and the Ruby bridge choosing which installed prism to
 * load. The bridge is imported by the probe, so the comparison cannot live in
 * either one without a cycle.
 */

/**
 * Whether a version is below a floor, by its numbers.
 *
 * A string compare is the wrong answer that looks right: "1.10.0" sorts below
 * "1.9.0" as text, and prism is already past its tenth minor, so text would
 * refuse the version this asks for.
 */
export function olderThan(version, floor) {
  if (!version || !floor) return false;
  const have = numbers(version);
  const want = numbers(floor);
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) < (want[i] ?? 0);
  }
  return false;
}

// `||` rather than `??`: a part that is not a number parses to NaN, which is
// not absent, and comparing against it answers false in both directions.
const numbers = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
