import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import {
  DIMENSIONS,
  ALL_DIMENSIONS,
  dimensionsFor,
  assertPrecision,
  assertApplicability,
  PRECISIONS,
} from "../lib/dimensions.mjs";
import { PAIRINGS } from "../lib/pairing.mjs";
import { walk, collectHits } from "../lib/walk.mjs";

const dim = (key) => DIMENSIONS.find((d) => d.key === key);

function hits(key, src) {
  const { program } = parseSync("f.ts", src, { sourceType: "module" });
  const out = [];
  dim(key).run(program, (h) => out.push(h));
  return out;
}

const counts = (key, src) => {
  const h = hits(key, src);
  return { candidates: h.length, conforming: h.filter((x) => x.conforming).length };
};

// --- swallowed_error ---

test("an empty catch is a violation, a used error is not", () => {
  const r = counts("swallowed_error", `
    try { a() } catch (e) { }
    try { b() } catch (e) { log(e) }
  `);
  assert.deepEqual(r, { candidates: 2, conforming: 1 });
});

test("a rethrow counts as handled", () => {
  const r = counts("swallowed_error", `try { a() } catch (e) { throw new Wrapped() }`);
  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

test("a catch that only builds an object mentioning e is not fooled by a key named e", () => {
  // The property KEY `e:` must not read as a use of the caught binding.
  const r = counts("swallowed_error", `try { a() } catch (e) { return { e: 1 } }`);
  assert.equal(r.candidates, 1);
  assert.equal(r.conforming, 0, "a key named e is not a use of the error");
});

test("a file with no catch clause contributes nothing", () => {
  assert.equal(hits("swallowed_error", `export const a = 1`).length, 0);
});

test("a binding-less catch is a candidate that cannot conform", () => {
  const r = counts("swallowed_error", `try { a() } catch { log("boom") }`);
  assert.equal(r.candidates, 1, "catch with no parameter still swallows");
  assert.equal(r.conforming, 0, "a handler with no binding cannot use the error");
});

test("a destructured catch parameter is a use of the error", () => {
  const r = counts("swallowed_error", `try { a() } catch ({ message }) { log(message) }`);
  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

test("a catch inside a class method is attributed to the method", () => {
  const [hit] = hits("swallowed_error", `class C { m() { try { a() } catch (e) { } } }`);
  assert.equal(hit.where, "m", "the site has to name the method it sits in");
});

// --- error_shape ---

test("a rethrow inside catch is not counted as a policy violation", () => {
  const r = counts("error_shape", `try { a() } catch (e) { throw e }`);
  assert.equal(r.candidates, 0, "a rethrow is deliberate, not a thrown-vs-returned choice");
});

test("a bare throw is a violation and a Result return conforms", () => {
  const r = counts("error_shape", `
    function a() { throw new Error("x") }
    function b() { return Result.ok(1) }
    function c() { return { ok: false, error: "x" } }
  `);
  assert.equal(r.candidates, 3);
  assert.equal(r.conforming, 2);
});

// --- module_state_const ---

test("module level is no enclosing declaration, not byte position", () => {
  const r = counts("module_state_const", `
    let bad = 1
    const good = 2
    function f() { let inner = 3 }
  `);
  assert.equal(r.candidates, 2, "the binding inside f is not module state");
  assert.equal(r.conforming, 1);
});

test("a top-level loop binding is not module state", () => {
  const r = counts("module_state_const", `for (let i = 0; i < 3; i++) {}`);
  assert.equal(r.candidates, 0);
});

test("an exported binding is still module state", () => {
  const r = counts("module_state_const", `
    export let bad = 1
    export const good = 2
  `);
  assert.equal(r.candidates, 2, "the export wrapper does not hide the declaration");
  assert.equal(r.conforming, 1);
});

// --- async_error_handling ---

test("an inner arrow's try does not satisfy the outer async function", () => {
  const r = counts("async_error_handling", `
    async function outer() {
      items.forEach(() => { try { risky() } catch (e) { log(e) } })
      await go()
    }
  `);
  assert.equal(r.candidates, 1);
  assert.equal(r.conforming, 0, "the handler belongs to the arrow, not to outer");
});

test("a try directly in the async function counts", () => {
  const r = counts("async_error_handling", `
    async function outer() { try { await go() } catch (e) { log(e) } }
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 1 });
});

// --- optional_chaining ---

test("optional access on a known-optional binding is the conforming form", () => {
  const r = counts("optional_chaining", `
    function f(opts) { return opts?.a + opts.b }
  `);
  assert.equal(r.candidates, 2);
  assert.equal(r.conforming, 1);
});

test("a computed access is not counted", () => {
  const r = counts("optional_chaining", `function f(opts) { return opts[key] }`);
  assert.equal(r.candidates, 0);
});

test("a receiver outside the known-optional names is not counted", () => {
  const r = counts("optional_chaining", `function f(user) { return user.name }`);
  assert.equal(r.candidates, 0, "the claim is about optional bags, not every member read");
});

// --- walk contract, which every dimension depends on ---

test("scope attribution resolves to the innermost declaration", () => {
  const { program } = parseSync("f.ts", `
    class C {
      method() {
        const run = async () => { db.query() }
      }
    }
  `, { sourceType: "module" });

  let where = "unset";
  walk(program, (n, ctx) => {
    if (n.type === "CallExpression" && n.callee?.property?.name === "query") {
      where = ctx.fn ? ctx.fn.type : null;
    }
  });
  assert.equal(where, "ArrowFunctionExpression", "innermost function wins, not the method");
});

test("outermost-first ordering makes a nested chain collapse to one visit path", () => {
  const { program } = parseSync("f.ts", `a.b.c.d`, { sourceType: "module" });
  const seen = [];
  walk(program, (n) => {
    if (n.type === "MemberExpression") seen.push(n.end - n.start);
  });
  assert.equal(seen.length, 3);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] < seen[i - 1], `visit ${i} widened: ${seen.join(",")}`);
  }
});

test("every shipped dimension declares its precision honestly", () => {
  for (const d of ALL_DIMENSIONS) {
    assert.ok(["precise", "partial"].includes(d.precision), d.key);
    assert.ok(d.claim && d.claim.length > 10, `${d.key} needs a readable claim`);
    assert.ok(d.langs && d.langs.length > 0, `${d.key} claims about no language`);
    assert.equal(typeof d.run, "function", d.key);
  }
});

test("no claim needs the encoder to be safe to render", () => {
  // Claims are ours, not repository-controlled, so they render unencoded: the
  // encoder strips `|` as a table boundary and turned "defaults are taken with
  // ??, not ||" into "defaults are taken with ??, not" in every JS area of
  // every repository. That holds only while the registry writes plain
  // sentences, so the constraint lives here rather than in a comment.
  for (const d of ALL_DIMENSIONS) {
    for (const s of [d.claim, d.counterClaim]) {
      if (typeof s !== "string") continue;
      assert.ok(!/[\n\r`]/.test(s), `${d.key} carries a line break or a backtick`);
      assert.ok(!/^\s*(?:[#>*+-]|\d+[.)])/.test(s), `${d.key} opens a markdown block`);
      assert.ok(!/^-{3,}|^~{3,}|<!--|-->/.test(s), `${d.key} carries a fence`);
      assert.ok(s.length <= 120, `${d.key} is ${s.length} chars, past the line budget`);
    }
  }
});

test("every shipped dimension decides its inverse, and refusing is written down", () => {
  // `applyGates` reads `typeof counterClaim === "string"`, so a dimension that
  // simply never got the field is silently one-sided and looks identical to one
  // whose inverse was judged a defect. Requiring the key present makes the
  // refusal a decision on the page.
  for (const d of ALL_DIMENSIONS) {
    assert.ok("counterClaim" in d, `${d.key} never decided whether its inverse may be stated`);
    assert.ok(
      d.counterClaim === null || (typeof d.counterClaim === "string" && d.counterClaim.length > 10),
      `${d.key} needs a readable counter sentence or an explicit null`
    );
    if (typeof d.counterClaim === "string") {
      assert.notEqual(d.counterClaim, d.claim, `${d.key} states the same sentence on both sides`);
    }
  }
});

test("dimension keys are unique across the whole registry", () => {
  // reduce.mjs and check.mjs both key their per-area maps by dimension key, so
  // a collision between the three lists drops one claim without a word.
  const keys = ALL_DIMENSIONS.map((d) => d.key);
  assert.deepEqual([...new Set(keys)].sort(), [...keys].sort());
});

test("a Ruby area never selects a dimension that walks an oxc tree", () => {
  const rb = dimensionsFor(["ruby"]);
  assert.ok(rb.length > 0);
  for (const d of rb) assert.ok(!d.langs.includes("js"), `${d.key} would run on a prism tree`);
  for (const d of dimensionsFor(["js"])) {
    assert.ok(!d.langs.includes("ruby"), `${d.key} would run on an oxc tree`);
  }
  assert.equal(dimensionsFor([]).length, 0);
  assert.equal(dimensionsFor(["cobol"]).length, 0);
});

test("an empty program yields no candidates rather than throwing", () => {
  const { program } = parseSync("f.ts", "", { sourceType: "module" });
  for (const d of DIMENSIONS) {
    let n = 0;
    d.run(program, () => n++);
    assert.equal(n, 0, d.key);
  }
});

test("a dimension a framework owns is not offered to a repository without it", () => {
  // zone_aware_time counts Time.now as a violation, which is right under Rails
  // and wrong in plain Ruby, and its counterClaim is null so it can never state
  // either side there. Measured as a permanently unsatisfiable line on
  // Homebrew (123 sites), puppet (197), fastlane (97) and chef (96), and as a
  // NIT that check delivers onto a branch: "the current time is read through
  // the application time zone" on a repository with no Rails in it.
  const withRails = dimensionsFor(["ruby"], { frameworks: ["rails"] }).map((d) => d.key);
  const without = dimensionsFor(["ruby"], { frameworks: [] }).map((d) => d.key);

  assert.ok(withRails.includes("zone_aware_time"));
  assert.ok(withRails.includes("record_lookup"));
  assert.ok(!without.includes("zone_aware_time"), "a repository with no Rails is not asked");
  assert.ok(!without.includes("record_lookup"));

  // The rest of Ruby is Ruby. Only the two that cannot see their own context
  // are owned; model_callbacks and the migrations already gate on an
  // ActiveRecord superclass and find nothing off-Rails on their own.
  for (const key of ["rescue_uses_error", "keyword_params", "service_result_shape", "model_callbacks"]) {
    assert.ok(without.includes(key), `${key} is Ruby, not Rails`);
  }
});

test("a caller that names no frameworks is offered everything", () => {
  // The parse worker has no repository to ask. It computes hits the reducer may
  // never read, which costs a walk and keeps the framework set out of every
  // parse job; the reducer is what decides which dimensions get a slot.
  const all = dimensionsFor(["ruby"]).map((d) => d.key);
  assert.ok(all.includes("zone_aware_time"), "no answer is not the same as the answer 'none'");
});

/* --- the loop both parser bridges run --- */

test("a dimension that throws costs its own count and not the other twenty", () => {
  // One odd tree used to be able to lose a whole file. The loop was copied into
  // both bridges, so this guarantee held twice or not at all.
  const hits = collectHits({}, [
    { key: "boom", run: () => { throw new Error("an odd tree"); } },
    { key: "fine", run: (_program, add) => add({ conforming: true, where: "f" }) },
  ]);

  assert.deepEqual(Object.keys(hits), ["fine"]);
  assert.deepEqual(hits.fine, [{ conforming: true, where: "f" }]);
});

test("a dimension that found nothing gets no entry at all", () => {
  // An area file lists the dimensions that appeared in it, so a dimension with
  // no sites must not arrive as an empty one.
  const hits = collectHits({}, [{ key: "quiet", run: () => {} }]);

  assert.deepEqual(hits, {});
});

test("a site keeps its conforming flag and its scope, and nothing else", () => {
  // What crosses the process boundary is a flag and a name. The node stays in
  // the worker: an AST serialises to about 16x the source it came from.
  const hits = collectHits({}, [
    { key: "k", run: (_program, add) => add({ conforming: false, node: { start: 1, end: 2 }, where: "outer" }) },
  ]);

  assert.deepEqual(hits.k, [{ conforming: false, where: "outer" }]);
});

test("a registry row with no precision does not ship (C5)", () => {
  // C5: the severity rule reads this field, and a row that forgets it is capped
  // by the same comparison a deliberate `partial` is. Silent, and a claim
  // quietly worth less than it should be. Checked at load, because the registry
  // is assembled from six files and a seventh would arrive without a test.
  assert.throws(
    () => assertPrecision([{ key: "forgot", claim: "something" }]),
    /declares precision undefined, not one of precise or partial/
  );
  assert.throws(
    () => assertPrecision([{ key: "typo", precision: "Precise" }]),
    /declares precision "Precise"/
  );
});

test("assertPrecision returns the rows it accepted, so a registry can wrap itself", () => {
  const rows = [{ key: "ok", precision: "partial" }];

  assert.equal(assertPrecision(rows), rows);
});

test("the obligations declare their precision like every other row (C5)", () => {
  // Pairings are a registry the dimension checks never reached: they are not in
  // ALL_DIMENSIONS, and the reducer composes both lists.
  for (const p of PAIRINGS) {
    assert.ok(PRECISIONS.includes(p.precision), p.key);
  }
});

test("every shipped row declares which files could participate (C2)", () => {
  // The obligations are in here too. They are not in ALL_DIMENSIONS, the
  // reducer composes both lists, and a checker blind to a whole class would
  // pass while nine rows carried nothing.
  assert.doesNotThrow(() => assertApplicability([...ALL_DIMENSIONS, ...PAIRINGS]));
});

test("a registry row that cannot say which files it speaks about does not ship (C2)", () => {
  // C2: `applicability` is whatever `run` happened to emit, so a predicate
  // seeing a tenth of its own construct gives 1.0 over four files and reads as
  // a strong convention. The three numbers cannot show that; the sentence can.
  assert.throws(
    () => assertApplicability([{ key: "forgot", precision: "precise" }]),
    /forgot declares no applicability.sites/
  );
  assert.throws(
    () => assertApplicability([{ key: "terse", precision: "precise", applicability: { sites: "files", blind: null } }]),
    /terse declares no applicability.sites/
  );
});

test("a row declaring no blind key at all is refused, because absent is not a third state (C2)", () => {
  assert.throws(
    () => assertApplicability([{ key: "silent", precision: "partial", applicability: { sites: "a file holding a catch clause" } }]),
    /silent declares no applicability.blind/
  );
});

test("precision and the blind spot cannot disagree (C2)", () => {
  // The marker and the reason are one decision. A precise row naming a blind
  // spot is a partial row nobody marked, which is the direction that costs a
  // severity level in the check.
  assert.throws(
    () =>
      assertApplicability([
        { key: "lying", precision: "precise", applicability: { sites: "a file holding a catch clause", blind: "a rethrow in a helper" } },
      ]),
    /lying is precise and names a blind spot/
  );
  assert.throws(
    () =>
      assertApplicability([
        { key: "quiet", precision: "partial", applicability: { sites: "a file holding a catch clause", blind: null } },
      ]),
    /quiet is partial and names no blind spot/
  );
});

test("assertApplicability returns the rows it accepted, so a registry can wrap itself", () => {
  const rows = [
    { key: "ok", precision: "partial", applicability: { sites: "a file holding a catch clause", blind: "a rethrow inside a helper" } },
  ];

  assert.equal(assertApplicability(rows), rows);
});
