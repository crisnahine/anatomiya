import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { PAIRINGS, applyPairings } from "../lib/pairing.mjs";
import { parseAll } from "../lib/parse.mjs";
import { needsRuby } from "./ruby-available.mjs";

/**
 * One witness pair per dimension: a source the declared predicate says is
 * applicable, and one holding the neighbouring construct that must not count.
 *
 * `applicability` is whatever `run` emitted, so the declared sentence is a
 * claim about the code and this is where the code has to agree with it. A
 * predicate that under-counts gives a ratio of 1.0 over a narrow set and reads
 * as a strong convention, which is the dangerous direction and the whole reason
 * the sentence is written down (C2).
 *
 * The inapplicable half is where the bugs live. It is the neighbouring
 * construct, not an empty file: a property key spelling a binding's name, a
 * rethrow inside a catch, an inner arrow whose try sits in the outer function's
 * byte range.
 *
 * Driven through `parseAll`, which is the seam the scan and the check both use.
 * Going at `dim.run` directly would test a function no caller calls that way.
 */
const WITNESSES = {
  // --- dimensions.mjs ---
  swallowed_error: {
    lang: "js",
    applicable: `try { a() } catch (e) { }`,
    inapplicable: `export function f() { return 1 }`,
  },
  error_shape: {
    lang: "js",
    applicable: `export function f() { throw new Error("x") }`,
    // A throw inside a catch is a rethrow, which is deliberate rather than a
    // policy violation, so it is not a site.
    inapplicable: `try { a() } catch (e) { throw e }`,
  },
  module_state_const: {
    lang: "js",
    applicable: `let a = 1`,
    // A binding in a loop head sits at module level by position and is not
    // module state.
    inapplicable: `for (let i = 0; i < 3; i++) { g(i) }`,
  },
  async_error_handling: {
    lang: "js",
    applicable: `export async function f() { await g() }`,
    inapplicable: `export function f() { return g() }`,
  },
  optional_chaining: {
    lang: "js",
    applicable: `export const a = opts.value`,
    // The declared blind spot, written as a test rather than as a comment: a
    // destructured optional carries none of the receiver names.
    inapplicable: `export function f({ value }) { return value }`,
  },

  // --- dimensions-extra.mjs ---
  function_style: {
    lang: "js",
    applicable: `export function f() { return 1 }`,
    // A method is a function that is not module state, and a file holding only
    // methods has made no module-level choice. Not a function nested in another
    // function: that file's outer function is itself a site, so it counts one
    // and the nesting is invisible in the total.
    inapplicable: `export class C { m() { return 1 } }`,
  },
  explicit_return_type: {
    lang: "js",
    applicable: `export function f(): number { return 1 }`,
    inapplicable: `function f(): number { return 1 }`,
  },
  type_only_import: {
    lang: "js",
    applicable: `import { A } from "./a.ts"\nlet x: A`,
    // Read as a value as well as a type, so which it is cannot be decided here.
    inapplicable: `import { A } from "./a.ts"\nlet x: A\nexport const y = A`,
  },
  import_extension: {
    lang: "js",
    applicable: `import { a } from "./a.ts"`,
    // A bare package specifier is not relative and names no file of ours.
    inapplicable: `import { a } from "node:fs"`,
  },
  nullish_default: {
    lang: "js",
    applicable: `export const a = b ?? 1`,
    // A call on the right is a fallback branch, where the two operators are not
    // interchangeable.
    inapplicable: `export const a = b || c()`,
  },
  non_null_assertion: {
    lang: "js",
    applicable: `export const a = b!.c`,
    inapplicable: `export const a = b.c`,
  },
  absent_is_null: {
    lang: "js",
    applicable: `export function f() { return null }`,
    // A bare return is a guard clause saying "stop here", not a spelling of an
    // absent value.
    inapplicable: `export function f() { if (a) return\n  g() }`,
  },
  iterate_with_for_of: {
    lang: "js",
    applicable: `for (const x of xs) { g(x) }`,
    // An indexed for loop is the third form the claim does not name.
    inapplicable: `for (let i = 0; i < xs.length; i++) { g(xs[i]) }`,
  },
  test_call_style: {
    lang: "js",
    applicable: `test("a", () => {})`,
    // A regex `.test()` is an ordinary value that happens to share the name.
    inapplicable: `export const ok = /x/.test("x")`,
  },
  assertion_style: {
    lang: "js",
    applicable: `expect(a).toBe(1)`,
    inapplicable: `export function f() { return 1 }`,
  },

  // --- dimensions-jsx.mjs ---
  hook_call_style: {
    lang: "jsx",
    applicable: `import { useState } from "react"\nexport function C() { const [a] = useState(1); return <p>{a}</p> }`,
    // Another library's method that happens to share a hook's name.
    inapplicable: `export function C() { const a = store.useState(1); return <p>{a}</p> }`,
  },
  handler_is_named: {
    lang: "jsx",
    applicable: `export function C() { return <button onClick={() => g()} /> }`,
    // A bind call is the third form the claim does not name.
    inapplicable: `export function C() { return <button onClick={g.bind(null, 1)} /> }`,
  },
  spread_on_component: {
    lang: "jsx",
    applicable: `export function C(p) { return <Child {...p} /> }`,
    inapplicable: `export function C(p) { return <Child a={p.a} /> }`,
  },
  text_translated: {
    lang: "jsx",
    applicable: `import { useTranslation } from "react-i18next"\nexport function C() { const { t } = useTranslation(); return <p>Hello {t("x")}</p> }`,
    // No translation layer in the file, so a repository without one produces no
    // sites rather than a directory of zeros.
    inapplicable: `export function C() { return <p>Hello</p> }`,
  },
  handler_memoised: {
    lang: "jsx",
    applicable: `export function C() { const h = () => g(); return <Child onX={h} /> }`,
    // Received rather than created here, so it was decided where the value was
    // made.
    inapplicable: `export function C({ h }) { return <Child onX={h} /> }`,
  },

  // --- dimensions-ruby.mjs ---
  rescue_uses_error: {
    lang: "ruby",
    applicable: `begin\n  a\nrescue => e\nend`,
    inapplicable: `def f\n  1\nend`,
  },
  record_lookup: {
    lang: "ruby",
    applicable: `User.find_by(id: 1)`,
    // Enumerable#find takes a block and is a different method despite the name.
    inapplicable: `xs.find { |x| x.ok? }`,
  },
  model_callbacks: {
    lang: "ruby",
    applicable: `class User < ApplicationRecord\nend`,
    inapplicable: `class Plain\nend`,
  },
  service_result_shape: {
    lang: "ruby",
    applicable: `class S\n  def call\n    1\n  end\nend`,
    // A helper method is not an entry point, so counting it would charge every
    // raise in the repository.
    inapplicable: `class S\n  def helper\n    raise "x"\n  end\nend`,
  },
  keyword_params: {
    lang: "ruby",
    applicable: `def f(a:, b:, c:)\nend`,
    // Two arguments read fine positionally; the convention starts at three.
    inapplicable: `def f(a, b)\nend`,
  },
  zone_aware_time: {
    lang: "ruby",
    applicable: `Time.now`,
    inapplicable: `def f\n  1\nend`,
  },

  // --- dimensions-rails.mjs ---
  migration_reversible: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n  end\nend`,
    // A helper-only migration class has made no choice about reversibility.
    inapplicable: `class M < ActiveRecord::Migration[7.0]\n  def helper\n  end\nend`,
  },
  migration_schema_only: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    User.update_all(x: 1)\n  end\nend`,
    inapplicable: `class Plain\n  def change\n  end\nend`,
  },
  column_null_declared: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_column :users, :name, :string, null: false\n  end\nend`,
    // change_column alters a column that already exists rather than declaring a
    // new one.
    inapplicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    change_column :users, :name, :text\n  end\nend`,
  },
  table_primary_key_declared: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users, id: :uuid do |t|\n    end\n  end\nend`,
    inapplicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    drop_table :users\n  end\nend`,
  },
  reference_foreign_key: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_reference :posts, :user, foreign_key: true\n  end\nend`,
    inapplicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_column :posts, :title, :string\n  end\nend`,
  },
};

/**
 * An obligation's site is the file, so its witness is a layout rather than a
 * source: the producer that must count, and a tree that must not be asked the
 * question at all.
 */
const PAIRING_WITNESSES = Object.fromEntries(
  PAIRINGS.map((p) => [
    p.key,
    {
      // A producer and one companion of this shape, which is the evidence the
      // repository uses this suffix at all.
      applicable: [`${p.from}/thing${p.ext}`, `${p.to}/thing${p.companionSuffix}`],
      // The same producer with no companion of this shape anywhere. Producers
      // exist whatever a repository tests with, so a row asked here could only
      // ever read zero.
      inapplicable: [`${p.from}/thing${p.ext}`],
    },
  ])
);

const jsKeys = Object.keys(WITNESSES).filter((k) => WITNESSES[k].lang !== "ruby");
const rubyKeys = Object.keys(WITNESSES).filter((k) => WITNESSES[k].lang === "ruby");

const EXT = { js: "ts", jsx: "tsx", ruby: "rb" };
const rel = (key, half) => `${key}.${half}.${EXT[WITNESSES[key].lang]}`;

async function hitsFor(keys) {
  const files = keys.flatMap((key) => {
    const w = WITNESSES[key];
    return [
      { rel: rel(key, "applicable"), source: w.applicable, lang: w.lang },
      { rel: rel(key, "inapplicable"), source: w.inapplicable, lang: w.lang },
    ];
  });
  // One pass for every witness rather than one per dimension: `parseAll` forks
  // a pool, and eighty pools is a minute of fork cost for nothing.
  const { records } = await parseAll(files, { frameworks: ["rails"] });
  return records;
}

const count = (records, key, half) => (records.get(rel(key, half))?.hits?.[key] ?? []).length;

test("every shipped dimension has a witness pair", () => {
  const shipped = [...ALL_DIMENSIONS.map((d) => d.key), ...PAIRINGS.map((p) => p.key)].sort();
  const witnessed = [...Object.keys(WITNESSES), ...Object.keys(PAIRING_WITNESSES)].sort();

  assert.deepEqual(witnessed, shipped, "a dimension without a witness ships a predicate nobody proved");
});

/**
 * Both engines answer the same question, so they get one body. Split by
 * language because only one of them needs a Ruby on the machine, and skipping
 * that half must not take the other with it.
 */
async function witnessProblems(keys) {
  const records = await hitsFor(keys);
  const problems = [];

  for (const key of keys) {
    const applicable = count(records, key, "applicable");
    const inapplicable = count(records, key, "inapplicable");
    const sites = ALL_DIMENSIONS.find((d) => d.key === key).applicabilityPredicate.sites;
    if (applicable === 0) problems.push(`${key} says it applies to "${sites}" and found no site in its own witness`);
    if (inapplicable !== 0) problems.push(`${key} counted ${inapplicable} site(s) in a file its predicate does not claim`);
  }

  return problems;
}

test("every JavaScript predicate sees the file its sentence claims, and only that one", async () => {
  assert.deepEqual(await witnessProblems(jsKeys), []);
});

test("every Ruby predicate sees the file its sentence claims, and only that one", needsRuby, async () => {
  assert.deepEqual(await witnessProblems(rubyKeys), []);
});

test("every obligation counts its producer, and asks nothing of a repository with no companion of that shape", () => {
  const problems = [];

  // Through `applyPairings`, which is what the scan calls. `pairingHits` alone
  // answers the same number for both halves, because the gate that decides
  // whether a repository is asked the question at all lives one level up: the
  // witness has to cross it or it distinguishes nothing.
  const applyTo = (corpus, key) => {
    const parsed = new Map(corpus.map((rel) => [rel, { rel, ok: true, hits: {} }]));
    applyPairings(parsed, new Set(corpus), ["ruby"]);
    return [...parsed.values()].filter((r) => r.hits[key]).length;
  };

  for (const pairing of PAIRINGS) {
    const w = PAIRING_WITNESSES[pairing.key];
    const applicable = applyTo(w.applicable, pairing.key);
    const inapplicable = applyTo(w.inapplicable, pairing.key);
    const sites = pairing.applicabilityPredicate.sites;
    if (applicable === 0) problems.push(`${pairing.key} says it applies to "${sites}" and counted no producer in its own witness`);
    if (inapplicable !== 0) {
      problems.push(`${pairing.key} asked a repository holding no ${pairing.companionSuffix} file, where it can only read zero`);
    }
  }

  assert.deepEqual(problems, []);
});
