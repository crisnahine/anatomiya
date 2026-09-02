import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import {
  DIMENSIONS,
  ALL_DIMENSIONS,
  dimensionsFor,
  assertPrecision,
  assertApplicability,
  assertClaimIsNotAVerdict,
  assertTier,
  assertRegistryRows,
  assertDeclaredFields,
  KINDS,
  PRINCIPLE_NAMES,
  PRECISIONS,
} from "../plugins/anatomiya/lib/dimensions.mjs";
import { NAMING_CORPUS } from "../plugins/anatomiya/lib/dimensions-naming.mjs";
import { REGISTRY } from "../plugins/anatomiya/lib/registry.mjs";
import { PAIRINGS, companionOf } from "../plugins/anatomiya/lib/pairing.mjs";
import { JS_DECLINED, PATH_DECLINED, RUBY_DECLINED } from "./declined-fixtures.mjs";
// The battery that stamps these rows runs where the registry is assembled.
import "../plugins/anatomiya/lib/registry.mjs";
import { SEMANTIC_DIMENSIONS } from "../plugins/anatomiya/lib/dimensions-semantic.mjs";
import { walk, collectHits } from "../plugins/anatomiya/lib/walk.mjs";

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
      assert.ok(!/^-{3,}|^~{3,}|<!--|--!?>/.test(s), `${d.key} carries a fence`);
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

test("the crossing keeps an empty nesting and a false group, and drops the node and an empty class", () => {
  // Each field rides its own predicate: an empty nesting is the top level and
  // a false group is a body, while an empty class is no vote at all.
  const hits = collectHits({}, [
    { key: "k", run: (_program, add) => add({ conforming: true, node: { start: 1 }, where: null, class: "", self: "", nesting: [], group: false }) },
  ]);

  assert.deepEqual(hits.k, [{ conforming: true, where: null, nesting: [], group: false }]);
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
    /forgot declares no applicabilityPredicate\.sites/
  );
  // A sentence too short to be one is told apart from an absent field, or
  // somebody who wrote `sites: "any file"` is sent looking for a key they can
  // already see on the page.
  assert.throws(
    () => assertApplicability([{ key: "terse", precision: "precise", applicabilityPredicate: { sites: "files", blind: null } }]),
    /terse states applicabilityPredicate\.sites as "files", which is a word rather than a predicate/
  );
});

test("a row declaring no blind key at all is refused, because absent is not a third state (C2)", () => {
  assert.throws(
    () => assertApplicability([{ key: "silent", precision: "partial", applicabilityPredicate: { sites: "a file holding a catch clause" } }]),
    /silent declares no applicabilityPredicate\.blind/
  );
});

test("precision and the blind spot cannot disagree (C2)", () => {
  // The marker and the reason are one decision. A precise row naming a blind
  // spot is a partial row nobody marked, which is the direction that costs a
  // severity level in the check.
  assert.throws(
    () =>
      assertApplicability([
        { key: "lying", precision: "precise", applicabilityPredicate: { sites: "a file holding a catch clause", blind: "a rethrow in a helper" } },
      ]),
    /lying is precise and names a blind spot/
  );
  assert.throws(
    () =>
      assertApplicability([
        { key: "quiet", precision: "partial", applicabilityPredicate: { sites: "a file holding a catch clause", blind: null } },
      ]),
    /quiet is partial and names no blind spot/
  );
});

test("a row whose precision this build does not know cannot have its blind spot checked (C2)", () => {
  // The tie between the marker and the reason only holds against a precision
  // this build knows. Both shipped registries run `assertPrecision` first, but
  // this is exported, and a row spelling `"Precise"` would otherwise satisfy
  // neither branch and pass with no blind spot checked at all.
  assert.throws(
    () =>
      assertApplicability([
        { key: "typo", precision: "Precise", applicabilityPredicate: { sites: "a file holding a catch clause", blind: null } },
      ]),
    /typo declares precision "Precise", so its blind spot cannot be checked/
  );
});

test("assertApplicability returns the rows it accepted, so a registry can wrap itself", () => {
  const rows = [
    { key: "ok", precision: "partial", applicabilityPredicate: { sites: "a file holding a catch clause", blind: "a rethrow inside a helper" } },
  ];

  assert.equal(assertApplicability(rows), rows);
});

test("an ambient declaration is not module state", () => {
  // `declare const x: number` binds nothing at run time: it describes something
  // declared elsewhere. Counted as a module binding it moved the ratio on a
  // claim about mutable state, and it vanishes when a file's types are
  // stripped, so the same file counted two ways.
  assert.deepEqual(counts("module_state_const", "declare const x: number;\ndeclare let y: string;\n"), {
    candidates: 0,
    conforming: 0,
  });
  // The ordinary declarations beside it still count.
  assert.deepEqual(counts("module_state_const", "declare let y: string;\nlet a = 1;\nconst b = 2;\n"), {
    candidates: 2,
    conforming: 1,
  });
});

test("a binding inside a namespace is not module state", () => {
  // `declare module 'x' { export var y }` and `namespace N { var y }` are both
  // scoped to the block, not to the module, and the first binds nothing at run
  // time at all.
  assert.deepEqual(counts("module_state_const", "declare module 'bar' {\n  export var foo: any;\n}\n"), {
    candidates: 0,
    conforming: 0,
  });
  assert.deepEqual(counts("module_state_const", "namespace N {\n  var inner = 1;\n}\nlet outer = 2;\n"), {
    candidates: 1,
    conforming: 0,
  });
});

test("a claim naming a principle does not load", () => {
  // `claim` is the sentence an agent reads. A rendered 1.0 beside a principle's
  // name reads as agreement with the principle rather than as a count of this
  // repository's sites, which is the one thing a counted claim cannot say.
  assert.throws(
    () => assertClaimIsNotAVerdict([{ key: "x", claim: "the code follows the Law of Demeter", counterClaim: null }]),
    /Law of Demeter/
  );
  // The counter-claim is rendered too, so it is held to the same rule.
  assert.throws(
    () => assertClaimIsNotAVerdict([{ key: "x", claim: "calls stay shallow", counterClaim: "SOLID is ignored" }]),
    /SOLID/
  );
});

test("the principle check does not depend on how the name is capitalised", () => {
  // Nobody writes a claim in the glossary's capitalisation. "law of demeter" in
  // a lowercase sentence is the same endorsement.
  assert.throws(
    () => assertClaimIsNotAVerdict([{ key: "x", claim: "calls follow the law of demeter", counterClaim: null }]),
    /Law of Demeter/
  );
  assert.throws(
    () => assertClaimIsNotAVerdict([{ key: "x", claim: "the code is solid and tested", counterClaim: null }]),
    /SOLID/
  );
});

test("the names that have been proposed as labels are all on the list", () => {
  // The list is the rule. Written out here rather than read from the module,
  // since an expectation taken from the code agrees with it by construction.
  for (const name of ["Postel's Law", "Law of Demeter", "Principle of least privilege", "SOLID", "DRY", "YAGNI"]) {
    assert.ok(PRINCIPLE_NAMES.includes(name), `${name} is not on the list`);
  }
});

test("a claim about the code loads", () => {
  assert.doesNotThrow(() =>
    assertClaimIsNotAVerdict([{ key: "y", claim: "a call chain stays inside one type", counterClaim: null }])
  );
});

test("every shipped claim says what the code does", () => {
  assert.doesNotThrow(() => assertClaimIsNotAVerdict(ALL_DIMENSIONS));
});

test("every registry row declares a tier, and an unknown one refuses to load", () => {
  for (const d of ALL_DIMENSIONS) {
    assert.ok(["syntactic", "semantic"].includes(d.tier), `${d.key} declares tier ${JSON.stringify(d.tier)}`);
  }
  assert.throws(() => assertTier([{ key: "x", tier: "Syntactic" }]), /tier/);
  assert.throws(() => assertTier([{ key: "y" }]), /tier/);
});

test("the default caller is offered the syntactic tier only", () => {
  // The tier is opt-in. A caller that forgets to ask must not get a claim that
  // needs a checker nobody ran.
  const keys = dimensionsFor(["js"]).map((d) => d.key);
  for (const d of SEMANTIC_DIMENSIONS) assert.equal(keys.includes(d.key), false, `${d.key} leaked into the default set`);
});

test("asking for all tiers returns the semantic rows too", () => {
  const keys = dimensionsFor(["js"], { tier: "all" }).map((d) => d.key);
  for (const d of SEMANTIC_DIMENSIONS) assert.ok(keys.includes(d.key), `${d.key} is missing from the deep set`);
});

test("a principle's name is matched as a word, not as a substring", () => {
  // The short entries are acronyms, and a bare substring match finds them
  // inside ordinary English: "consolidated" holds SOLID, "dry-run" holds DRY,
  // "kissed" holds KISS. The assert runs at module load over the whole
  // registry, so one legitimate claim spelled that way kills scan, check and
  // pin at startup and names a principle the sentence never mentions.
  for (const claim of [
    "errors are consolidated at the boundary",
    "migrations are dry-run first",
    "a stale handler is kissed goodbye",
    "the payload is yagni-free",
  ]) {
    assert.doesNotThrow(() => assertClaimIsNotAVerdict([{ key: "x", claim, counterClaim: null }]), claim);
  }

  // The names themselves still refuse, whatever the surrounding case.
  for (const claim of [
    "the code follows SOLID",
    "handlers are DRY",
    "keep it KISS",
    "YAGNI applies here",
    "calls follow the law of demeter",
  ]) {
    assert.throws(() => assertClaimIsNotAVerdict([{ key: "x", claim, counterClaim: null }]), /principle/, claim);
  }
});

test("a cast does not hide a result-shaped return either", () => {
  // C11 closed this class on absent_is_null and nullish_default and left
  // error_shape reading the raw argument, so `return { ok: true } as Result`,
  // which is the ordinary way to write it in a typed repository, stopped being
  // a conforming site while every throw beside it still counted.
  assert.deepEqual(counts("error_shape", "export function f() { return { ok: true, value: 1 } }"), {
    candidates: 1,
    conforming: 1,
  });

  for (const cast of ["as Result", "satisfies Result", "!"]) {
    const src = `export function f() { return { ok: true, value: 1 } ${cast} }`;
    assert.deepEqual(counts("error_shape", src), { candidates: 1, conforming: 1 }, src);
  }
});

test("every registry row carries its kind after load, all three lists included", () => {
  for (const d of [...ALL_DIMENSIONS, ...NAMING_CORPUS, ...PAIRINGS]) {
    assert.ok(KINDS.includes(d.kind), `${d.key} carries kind ${JSON.stringify(d.kind)}`);
  }
});

const probeRow = (over = {}) => ({
  key: "probe_row",
  tier: "syntactic",
  claim: "widgets here are checked before they are returned",
  counterClaim: null,
  precision: "precise",
  applicabilityPredicate: { sites: "a file holding at least one widget literal", blind: null },
  langs: ["js"],
  run: () => {},
  ...over,
});

test("a tree row is stamped rather than spelled, and a wrong kind refuses", () => {
  const row = probeRow();
  assertRegistryRows([row]);
  assert.equal(row.kind, "tree");
  assert.throws(() => assertRegistryRows([probeRow({ kind: "Tree" })]), /Tree/);
});

test("the newest fields are held to shape at load", () => {
  assert.throws(() => assertRegistryRows([probeRow({ groupedSites: true })]), /learning a class/);
  assert.throws(() => assertRegistryRows([probeRow({ capability: "telemetry" })]), /telemetry/);
  assert.throws(() => assertRegistryRows([probeRow({ framework: "django" })]), /django/);
});

test("a framework row loads on any language, whichever engine reads it", () => {
  // The registry once refused this, on the reading that the oxc worker selects
  // its own dimensions unfiltered and so would count the row ungated. It counts
  // nothing: the reducer and the check both select through `dimensionsFor`, and
  // a hit no slot reads is a hit nobody counted.
  const row = probeRow({ framework: "rails" });
  assertRegistryRows([row]);
  assert.equal(row.kind, "tree");
});

test("a row may not be both a framework's and a capability's, because adoption reads hits raw", () => {
  // `adoptedCapabilities` counts adopting files off the worker's records and
  // selects through nothing, the one hit reader the framework filter does not
  // reach, so such a row would vote off-framework for a capability's adoption.
  assert.throws(
    () => assertRegistryRows([probeRow({ framework: "rails", capability: "logging" })]),
    /framework and capability/
  );
});

test("a pairing row with a mistyped tier refuses to load now", () => {
  // The battery reached `ALL_DIMENSIONS` and the corpus rows and never the
  // pairings, so this exact misspelling shipped a row every reader would
  // silently drop.
  assert.throws(() => assertRegistryRows([{ ...PAIRINGS[0], tier: "Syntactic" }]), /Syntactic/);
});

/* --- module_state_const counts only where const was a real choice (#57) --- */

test("a binding const cannot hold is not a site", () => {
  // `const container: HTMLDivElement` with no initialiser is a SyntaxError and
  // assigning to a const is a TypeError, so the finding asked for code that
  // does not compile, at the severity meaning "the first violation in the
  // area's history". This is the ordinary React Testing Library setup.
  const r = counts("module_state_const", `
    let container: HTMLDivElement
    let reactRoot: Root
    const render = () => { container = document.createElement("div"); reactRoot = createRoot(container) }
  `);
  assert.deepEqual(r, { candidates: 1, conforming: 1 }, "only the const is a site");
});

test("a let const could have held is still a violation", () => {
  assert.deepEqual(counts("module_state_const", `let a = 1`), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("module_state_const", `var a = 1`), { candidates: 1, conforming: 0 });
});

test("a member assignment does not excuse the binding that shares its name", () => {
  // `obj.x = 1` writes a property, not the binding, which is the distinction
  // `usesParam` already draws for a catch parameter.
  assert.deepEqual(counts("module_state_const", `let x = 1\nobj.x = 1`), { candidates: 1, conforming: 0 });
});

test("a destructuring let is judged on every name the pattern binds", () => {
  assert.deepEqual(counts("module_state_const", `let { a, b } = f()`), { candidates: 1, conforming: 0 });
  assert.deepEqual(counts("module_state_const", `let { a, b } = f()\na = 2`), { candidates: 0, conforming: 0 });
});

test("an increment and a for-of head are assignments, and a redeclared var is not a const", () => {
  assert.equal(hits("module_state_const", `let i = 0\ni++`).length, 0);
  assert.equal(hits("module_state_const", `let x = 1\nfor (x of xs) { g(x) }`).length, 0);
  assert.equal(hits("module_state_const", `var x = 1\nvar x = 2`).length, 0);
});

test("a const stays a site whatever else the file assigns", () => {
  // The conforming count cannot move, so the ratio can only rise by losing
  // violations nobody could act on.
  assert.deepEqual(counts("module_state_const", `const a = 1\nlet b\nb = 2`), { candidates: 1, conforming: 1 });
});

test("one uninitialised declarator takes the whole declaration out", () => {
  assert.equal(hits("module_state_const", `let a = 1, b`).length, 0);
});

test("a pairing row may not declare a counter-claim, because only one direction is enforceable", () => {
  // `pairingViolations` computes one direction, the companion that is not
  // there, and the check skips an obligation whose claim side did not state. A
  // pairing row with a counter would print a sentence in the map and enforce
  // nothing, which is the H12 asymmetry the corpus rows are already closed
  // against. Refused at load rather than guarded in the check, so the hole
  // cannot be opened by an edit to `pairing.mjs` alone.
  assert.throws(
    () =>
      assertRegistryRows([
        {
          key: "probe_spec",
          kind: "pairing",
          tier: "syntactic",
          claim: "a probe ships with a spec",
          counterClaim: "a probe ships without a spec",
          precision: "precise",
          applicabilityPredicate: { sites: "a .rb file anywhere under app/probes whose own name does not end in _spec.rb", blind: null },
          langs: ["ruby"],
          from: "app/probes",
          to: "spec/probes",
          ext: ".rb",
          companionSuffix: "_spec.rb",
        },
      ]),
    /probe_spec is a pairing row with a counterClaim/
  );
});

/* --- a read in a write position has no ?. form (#77 row 2) --- */

test("a write position has no ?. form, so it is not a site", () => {
  // `o?.r = 3` is TS2779 and `new params?.Client()` is "Invalid optional chain
  // from new expression": replacing the counted operator does not compile.
  for (const src of [
    `function f(options) { options.retries = 3 }`,
    `function f(props) { props.count += 1 }`,
    `function f(input) { input.z++ }`,
    `function f(params) { return new params.Client() }`,
    `function f(config, xs) { for (config.k of xs) {} }`,
  ]) {
    assert.equal(hits("optional_chaining", src).length, 0, src);
  }
});

test("the positions ?. is legal in stay sites", () => {
  assert.equal(hits("optional_chaining", `function f(config) { delete config.cache }`).length, 1);
  assert.equal(hits("optional_chaining", `function f(options) { for (const k in options.map) {} }`).length, 1);
  assert.deepEqual(counts("optional_chaining", `function f(opts) { return opts.value }`), { candidates: 1, conforming: 0 });
});

test("splitBy is refused off a row that learns no class", () => {
  // Every other declared field is held at load. Without this one a mistyped
  // `splitBy` throws mid-scan, on whichever repository reached it first.
  const probe = (o) => ({
    key: "probe",
    tier: "syntactic",
    claim: "probes here are named <style>",
    counterClaim: null,
    precision: "precise",
    applicabilityPredicate: { sites: "a file holding a probe declaration", blind: null },
    langs: ["js"],
    run() {},
    ...o,
  });

  assert.throws(() => assertRegistryRows([probe({ splitBy: () => "module" })]), /splitBy without learning a class/);
  assert.throws(() => assertRegistryRows([probe({ learnedClasses: true, splitBy: "jsx" })]), /splitBy without learning a class/);
  const split = { learnedClasses: true, splitBy: () => "module" };
  const both = { a: "probes here of a are named <style>", b: "probes here of b are named <style>" };
  assert.doesNotThrow(() => assertRegistryRows([probe({ ...split, splitClaim: both })]));
});

test("a row that splits its population says so in both sentences", () => {
  // Without the second sentence the narrowing is invisible: the area file loads
  // on the files the population excluded and instructs them in a convention
  // measured over the other kind, which the check then does not judge.
  const probe = (o) => ({
    key: "probe",
    tier: "syntactic",
    claim: "probes here are named <style>",
    counterClaim: null,
    learnedClasses: true,
    splitBy: () => "module",
    precision: "precise",
    applicabilityPredicate: { sites: "a file holding a probe declaration", blind: null },
    langs: ["js"],
    run() {},
    ...o,
  });

  assert.throws(() => assertRegistryRows([probe({})]), /splitBy without a sentence per kind/);
  assert.throws(
    () => assertRegistryRows([probe({ splitClaim: { module: "probes here are named <style>" } })]),
    /splitBy without a sentence per kind/,
    "one side is not a split"
  );
  assert.throws(
    () => assertRegistryRows([probe({ splitClaim: { a: "probes of a are named PascalCase", b: "b <style>" } })]),
    /sentence for a states a class the learning cannot fill/
  );
});

test("every splitting row spells both of the kinds its own splitter answers", () => {
  // The guard holds the shape; only the row itself knows which kinds it yields.
  for (const d of ALL_DIMENSIONS.filter((x) => x.splitBy)) {
    for (const facets of [{ jsx: true }, { jsx: false }, {}]) {
      const kind = d.splitBy({ facets });
      assert.equal(typeof d.splitClaim[kind], "string", `${d.key} has no sentence for ${kind}`);
    }
  }
});

test("a mid-chain assertion does not carry a write position past the grammar test", () => {
  // The same leak on the row whose remedy is the same `?.`: one `!` between the
  // receiver and the assignment flipped every refused position back to a site.
  for (const src of [
    `function f(options) { options.a!.retries = 3 }`,
    `function f(props) { props.a!.count += 1 }`,
    `function f(input) { input.a!.z++ }`,
    `function f(params) { return new (params.a!.Client)() }`,
    `function f(config, xs) { for (config.a!.k of xs) {} }`,
    `function f(opts, q) { ({ a: opts.a!.x } = q) }`,
    `function f(opts) { [opts.a!.y] = [2] }`,
  ]) {
    assert.equal(hits("optional_chaining", src).length, 0, src);
  }
});

/* --- the form a predicate declines is written down where it misreads (#97) --- */

test("the rows that name a declined form are the rows one true clause can name", () => {
  // Three bars, and the middle one is what a first pass got wrong. A row
  // qualifies when its claim's own sentence names a construct the predicate then
  // declines; when a reader would MEET that construct in a file the claim
  // credits; and when one line names the whole exclusion truthfully.
  //
  // The middle bar is what separates a per-site decline from a per-file one. A
  // `create_table` block can hold four counted columns and one `t.string :name,
  // **opts` that was dropped, all under a perfect `4 of 4` in a file the claim
  // credits, and nothing on the line reveals it. A migration declined whole
  // never enters the count at all, and `N of N sites across X of Y files`
  // already says a file went uncounted, so a line there restates the count
  // above it.
  //
  // The third bar is why the Ruby rows carry none: `module_include` declines
  // five separate shapes, and a list belongs in `sites`, which nothing prints.
  // A clause written off that prose and never run against the predicate was
  // wrong or partial far more often than not, which is what the fixtures below
  // exist to stop.
  const declared = REGISTRY.filter((d) => d.applicabilityPredicate?.notCounted).map((d) => d.key);

  assert.deepEqual(declared.slice().sort(), [
    "column_null_declared", "controller_spec", "extends_base", "import_extension", "job_spec",
    "job_test", "model_spec", "model_test", "non_null_assertion", "nullish_default",
    "optional_chaining", "rake_task_spec", "reference_foreign_key", "route_env", "route_logging",
    "route_network", "serializer_spec", "service_spec", "spread_on_component", "worker_spec",
  ]);
});

test("a declined-form clause is one short line, because it costs one of forty", () => {
  // The renderer prints this into a file bounded at forty lines, so the shape is
  // a bound rather than a preference. `assertApplicability` is where it is
  // enforced; this asks the shipped registry the same question.
  for (const d of REGISTRY) {
    const clause = d.applicabilityPredicate?.notCounted;
    if (clause === undefined) continue;
    assert.equal(typeof clause, "string", d.key);
    assert.doesNotMatch(clause, /\s{2,}|[\r\n]/, `${d.key} spans more than one line`);
    assert.ok(clause.length > 0 && clause.length <= 120, `${d.key} runs to ${clause.length} characters`);
    // Register, over the eighteen strings that actually ship. A capital is only
    // wrong here because none of these opens on a constant; the validator does
    // not police it, because a rule cannot tell the two apart.
    assert.doesNotMatch(clause, /^[A-Z]/, `${d.key} reads as a sentence rather than a clause`);
  }
});

test("the clause contract is refused at the registry gate, not only in this file", () => {
  const row = (notCounted) => [{
    key: "k", kind: "syntactic", tier: "syntactic", claim: "c", precision: "precise", langs: ["js"],
    applicabilityPredicate: { sites: "a file holding the construct", notCounted, blind: null },
    run() {},
  }];

  assert.throws(() => assertApplicability(row("one\ntwo")), /not one line/);
  assert.throws(() => assertApplicability(row("x".repeat(121))), /not one line/);
  assert.doesNotThrow(() => assertApplicability(row("a spread onto a host element, which has no prop names to write")));
  // The gate is the shape, not the register: a clause may open on a constant a
  // language spells with a capital, and no rule there could tell `Net::HTTP`
  // from a sentence.
  assert.doesNotThrow(() => assertApplicability(row("Net::HTTP called through a constant receiver, which is the client itself")));
});

/* --- every clause is pinned to what its own predicate actually declines (#97) --- */

// One row, one source, one optional path: enough to run any of the rows oxc
// answers for. `rel` is what the three routing rows read, and nothing else on
// the list looks at it.
function siteCount(key, src, rel = undefined) {
  const row = REGISTRY.find((d) => d.key === key);
  assert.ok(row, `no registry row named ${key}`);
  // Always .tsx: the one extension oxc reads both the TypeScript and the JSX on
  // this list with, and no row here branches on the filename.
  const { program } = parseSync("f.tsx", src, { sourceType: "module" });
  let n = 0;
  row.run(program, () => n++, { rel });
  return n;
}

const source = (f) => (typeof f === "string" ? { src: f, rel: undefined } : f);

for (const [key, { declined, counted }] of Object.entries(JS_DECLINED)) {
  test(`${key} counts none of what its clause says it declines`, () => {
    for (const f of declined) {
      const { src, rel } = source(f);
      assert.equal(siteCount(key, src, rel), 0, `${key} counted a site in ${JSON.stringify(src)} at ${rel}`);
    }
    const { src, rel } = source(counted);
    assert.ok(siteCount(key, src, rel) > 0, `${key} counted nothing in ${JSON.stringify(src)} at ${rel}`);
  });
}

test("a companion row declines the base it names and the file already named like a companion", () => {
  // One test for nine rows: they share a mechanism and a clause, and the noun
  // the clause speaks of follows each row's own root rather than the package.
  for (const row of PAIRINGS) {
    for (const rel of PATH_DECLINED.declined(row)) {
      assert.equal(companionOf(rel, row), null, `${row.key} owed a companion for ${rel}`);
    }
    const producer = PATH_DECLINED.counted(row);
    assert.ok(companionOf(producer, row), `${row.key} asked nothing of ${producer}`);
  }
});

test("no row carries a clause that nothing runs", () => {
  // The hole that let a first pass ship clauses that were wrong: the shape is
  // checked by `assertApplicability` and the truth by nothing. A clause is prose
  // and prose cannot be asserted, so a row that grows one has to grow a fixture
  // that runs its predicate, and this is what refuses the row that does not.
  const claused = REGISTRY.filter((d) => d.applicabilityPredicate?.notCounted).map((d) => d.key);
  const pinned = new Set([
    ...Object.keys(JS_DECLINED),
    ...Object.keys(RUBY_DECLINED),
    ...PAIRINGS.map((p) => p.key),
  ]);

  assert.deepEqual(claused.filter((k) => !pinned.has(k)), [], "these rows state a clause nothing runs");
});

test("the newest declared fields are held to shape at load, each refused by name", () => {
  // The battery covered the fields that had already caused an incident; these
  // are the ones from H11 and H14, and this is the one gate no test drove.
  const learned = { key: "k", learnedClasses: true, claim: "x <style>" };
  assert.throws(() => assertDeclaredFields([{ key: "k", groupedSites: true }]), /groupedSites without learning a class/);
  assert.throws(() => assertDeclaredFields([{ key: "k", noneClaim: "none" }]), /noneClaim off a learned row/);
  assert.throws(() => assertDeclaredFields([{ key: "k", learnedFromSource: true }]), /learnedFromSource without learning a class/);
  assert.throws(() => assertDeclaredFields([{ key: "k", splitBy: () => "a" }]), /splitBy without learning a class/);
  assert.throws(
    () => assertDeclaredFields([{ ...learned, splitBy: () => "a", splitClaim: { a: "x <style>" } }]),
    /without a sentence per kind/
  );
  assert.throws(
    () => assertDeclaredFields([{ ...learned, splitBy: () => "a", splitClaim: { a: "x <style>", b: "no class" } }]),
    /states a class the learning cannot fill/
  );
  assert.doesNotThrow(() =>
    assertDeclaredFields([{ ...learned, groupedSites: true, noneClaim: "n", learnedFromSource: true, splitBy: () => "a", splitClaim: { a: "x <style>", b: "y <style>" } }])
  );
});
