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
  const have = parts(version);
  const want = parts(floor);
  for (let i = 0; i < Math.max(have.numbers.length, want.numbers.length); i++) {
    const a = have.numbers[i] ?? 0;
    const b = want.numbers[i] ?? 0;
    if (a !== b) return a < b;
  }
  // The same numbers, so a prerelease comes before the release. Read as numbers
  // alone, `1.0.0.rc1` met a 1.0.0 floor and `1.0.0-rc.1` read as 1.0.0.1, past
  // it. Two candidates of one version are ordered by the numbers in them.
  if (have.pre === null) return false;
  if (want.pre === null) return true;
  return comparePre(have.pre, want.pre) < 0;
}

/**
 * Two prerelease tags, run by run: digits as numbers, anything else by code
 * unit, so `rc10` follows `rc9`. Not `localeCompare`, whose answer is the
 * host's locale's.
 */
function comparePre(a, b) {
  const runs = (s) => s.match(/\d+|[^\d.-]+/g) ?? [];
  const x = runs(a);
  const y = runs(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d/.test(x[i]);
    const ny = /^\d/.test(y[i]);
    if (nx && ny) {
      const d = Number(x[i]) - Number(y[i]);
      if (d !== 0) return d;
    } else if (x[i] !== y[i]) {
      if (nx !== ny) return nx ? -1 : 1;
      return x[i] < y[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The leading numbers of a version, and what follows them when that is a
 * prerelease: RubyGems spells one `1.0.0.rc1`, semver `1.0.0-rc.1`. Build
 * metadata after a `+` is not one.
 */
function parts(v) {
  const m = /^(\d+(?:\.\d+)*)(.*)$/s.exec(String(v));
  if (m === null) return { numbers: numbers(String(v)), pre: null };
  const rest = m[2];
  return { numbers: numbers(m[1]), pre: rest === "" || rest.startsWith("+") ? null : rest.replace(/^[.-]/, "") };
}

// `||` rather than `??`: a part that is not a number parses to NaN, which is
// not absent, and comparing against it answers false in both directions.
const numbers = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
