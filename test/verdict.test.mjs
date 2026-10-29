import { test } from "node:test";
import assert from "node:assert/strict";
import { cochangeSeverity, countedIn, deliveredOr, FINDING_FIELDS, findingOf, outsideScope, severityFor, slotFor, verdictFor } from "../plugins/anatomiya/lib/verdict.mjs";

const stated = (key, over = {}) => ({ key, states: "claim", directive: true, precision: "precise", candidates: 40, conforming: 40, baseline: { candidates: 40, conforming: 40, exceptions: [] }, ...over });
// An area's globs as `areas.mjs` composes them: a directory and a tail, `**/` where it reaches below the directory.
const area = (path, dims, globs = [{ dir: path === "." ? "" : path, tail: "**/*.ts" }]) => ({ path, globs, dimensions: dims });

test("the slot that speaks for a path is the area's own, else the nearest enclosing area's that states one, else none", () => {
  const root = area(".", [stated("k")], [{ dir: "", tail: "*.ts" }]);
  const src = area("src", [stated("k")]);
  const deep = area("src/core", [stated("other")]);
  const ancestorsOf = (a) => (a === deep ? [src, root] : a === src ? [root] : []);
  assert.deepEqual(slotFor(src, "k", ancestorsOf), { dim: src.dimensions[0], from: null }, "its own");
  assert.deepEqual(slotFor(deep, "k", ancestorsOf), { dim: src.dimensions[0], from: "src" }, "the nearest enclosing area that states it");
  assert.equal(slotFor(deep, "unknown", ancestorsOf), null);
  assert.equal(slotFor(null, "k", ancestorsOf), null, "outside every area");
  // An enclosing area that holds the row suppressed does not speak for it.
  const quiet = area("src", [stated("k", { states: null, directive: false })]);
  assert.equal(slotFor(deep, "k", () => [quiet]), null);
});

test("a site counted in an enclosing area is FIX whatever that area's baseline, and the area's own slot climbs the ladder", () => {
  const own = area("src", [stated("k")]);
  assert.deepEqual(verdictFor({ path: "src/a.ts", oldPath: null }, { dim: own.dimensions[0], from: null }, { area: own }), { severity: "MUST-FIX", reason: "all 40 baseline sites conform" });
  assert.deepEqual(verdictFor({ path: "src/core/a.ts", oldPath: null }, { dim: own.dimensions[0], from: "src" }, { area: area("src/core", []) }), countedIn("src"));
  assert.deepEqual(verdictFor({ path: "lib/a.ts", oldPath: null }, null, { area: null }), { severity: "NIT", reason: "no convention counted here" });
});

test("MUST-FIX is withheld where the area's own globs never delivered the claim to the path, and names which half missed", () => {
  const own = area("src", [stated("k")], [{ dir: "src", tail: "*.ts" }]);
  const must = { severity: "MUST-FIX", reason: "all 40 baseline sites conform" };
  assert.deepEqual(deliveredOr(must, own, "src/a.ts"), must, "delivered");
  assert.deepEqual(deliveredOr(must, own, "src/deep/a.ts"), countedIn("src"), "the directory is what the globs do not cover");
  assert.deepEqual(deliveredOr(must, own, "src/a.tsx"), { severity: "FIX", reason: "the area file for src does not reach .tsx files, so this claim was never delivered here" });
  assert.deepEqual(deliveredOr({ severity: "FIX", reason: "x" }, own, "src/deep/a.ts"), { severity: "FIX", reason: "x" }, "every other verdict is left alone");
  assert.deepEqual(verdictFor({ path: "src/deep/a.ts", oldPath: null }, { dim: own.dimensions[0], from: null }, { area: own }), countedIn("src"));
});

test("the shared rungs sit above the counts on both ladders, in one order", () => {
  const dim = stated("k");
  assert.equal(severityFor({ path: "a.ts" }, { dim, dropped: "named" }).reason, "the area file names this claim without its counts");
  assert.equal(severityFor({ path: "a.ts" }, { dim, dropped: true }).reason, "the area file had no room to state this claim");
  assert.equal(severityFor({ path: "a.ts" }, { dim, capped: "no map on disk" }).reason, "capped by this run: no map on disk");
  const claim = { candidates: 12, conforming: 12 };
  assert.equal(cochangeSeverity(claim, { from: "pin", area: "src", dropped: true, capped: null, size: 1 }).reason, "the area file had no room to state this claim");
  assert.equal(cochangeSeverity(claim, { from: "pin", area: "src", dropped: false, capped: "stale", size: 1 }).reason, "capped by this run: stale");
  assert.equal(cochangeSeverity(claim, { from: "pin", area: "src", dropped: false, capped: null, size: 1 }).severity, "MUST-FIX");
  assert.equal(cochangeSeverity(claim, { from: "head", area: "src", dropped: false, capped: null, size: 1 }).reason, "no baseline population recorded");
});

test("a slot whose scope names the kinds it was counted over raises nothing on a file of another kind", () => {
  assert.equal(outsideScope({ scope: [".ts"] }, "a.tsx"), true);
  assert.equal(outsideScope({ scope: [".ts"] }, "a.ts"), false);
  assert.equal(outsideScope({}, "a.tsx"), false, "no scope, every kind");
});

test("every finding has the one shape: the twelve fields present, the optional ones null, and nothing else", () => {
  const f = findingOf({ severity: "FIX", reason: "r", path: "a.ts", line: 3, dimension: "k", claim: "c", precision: "precise" });
  assert.deepEqual(Object.keys(f), FINDING_FIELDS);
  assert.deepEqual([f.oldPath, f.area, f.where, f.companion, f.snippet], [null, null, null, null, null]);
  assert.equal(findingOf({ severity: "FIX", reason: "r", path: "a.ts", line: 3, dimension: "k", claim: "c", precision: "precise", toldInClaim: true }).toldInClaim, true);
  assert.throws(() => findingOf({ severity: "FIX", reason: "r", path: "a.ts", line: 3, dimension: "k", claim: "c", precision: "precise", typo: 1 }), /a finding carries no typo/);
});
