import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_DIMENSIONS } from "../lib/dimensions.mjs";
import { PAIRINGS, applyPairings } from "../lib/pairing.mjs";
import { parseAll } from "../lib/parse.mjs";
import { declOf } from "../lib/langs.mjs";
import { needsRuby } from "./ruby-available.mjs";
import { REACT_HOOKS } from "../lib/dimensions-jsx.mjs";
import { COLUMN_TYPE } from "../lib/dimensions-rails.mjs";

/**
 * One witness pair per dimension: the sources the declared predicate says are
 * applicable, and one holding the neighbouring construct that must not count.
 *
 * `applicability` is whatever `run` emitted, so the declared sentence is a
 * claim about the code and this is where the code has to agree with it. A
 * predicate that under-counts gives a ratio of 1.0 over a narrow set and reads
 * as a strong convention, which is the dangerous direction and the whole reason
 * the sentence is written down (C2).
 *
 * `applicable` is a list, and its length is the point. One source proves the
 * sentence names something and nothing more: narrowing `optional_chaining` from
 * six receiver names to one is a six-fold under-count of the row this contract
 * already names as the measured false-convention case, and a single `opts`
 * witness stays green straight through it. Where a sentence enumerates a set,
 * every member it names gets a source, or the sentence is only as true as the
 * one member somebody happened to write down.
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
    applicable: [`try { a() } catch (e) { }`, `try { a() } catch { }`],
    inapplicable: `export function f() { return 1 }`,
  },
  error_shape: {
    lang: "js",
    applicable: [`export function f() { throw new Error("x") }`, `export function g() { return { ok: true } }`],
    // A throw inside a catch is a rethrow, which is deliberate rather than a
    // policy violation, so it is not a site.
    inapplicable: `try { a() } catch (e) { throw e }`,
  },
  module_state_const: {
    lang: "js",
    applicable: [`let a = 1`, `const b = 2`],
    // A binding in a loop head sits at module level by position and is not
    // module state.
    inapplicable: `for (let i = 0; i < 3; i++) { g(i) }`,
  },
  async_error_handling: {
    lang: "js",
    // Every shape an async function comes in. Measured on this repository:
    // 202 of 250 async sites are arrows, so a predicate narrowed to the
    // declaration drops four fifths of them and states over the remainder.
    applicable: [
      `export async function f() { await g() }`,
      `export const f = async () => { await g() }`,
      `export class C { async m() { await g() } }`,
      `export const f = async function () { await g() }`,
      `export const o = { async m() { await g() } }`,
    ],
    inapplicable: `export function f() { return g() }`,
  },
  optional_chaining: {
    lang: "js",
    applicable: [
      `export const a = opts.value`,
      `export const a = options.value`,
      `export const a = params.value`,
      `export const a = props.value`,
      `export const a = config.value`,
      `export const a = input.value`,
    ],
    // The declared blind spot, written as a test rather than as a comment: a
    // destructured optional carries none of the receiver names.
    inapplicable: `export function f({ value }) { return value }`,
  },

  // --- dimensions-extra.mjs ---
  function_style: {
    lang: "js",
    applicable: [`export function f() { return 1 }`, `export const g = () => 1`],
    // A method is a function that is not module state, and a file holding only
    // methods has made no module-level choice. Not a function nested in another
    // function: that file's outer function is itself a site, so it counts one
    // and the nesting is invisible in the total.
    inapplicable: `export class C { m() { return 1 } }`,
  },
  explicit_return_type: {
    lang: "js",
    applicable: [`export function f(): number { return 1 }`, `export const g = (): number => 1`],
    inapplicable: `function f(): number { return 1 }`,
  },
  type_only_import: {
    lang: "js",
    applicable: [
      `import { A } from "./a.ts"\nlet x: A`,
      `import A from "./a.ts"\nlet x: A`,
      `import * as A from "./a.ts"\nlet x: A.T`,
    ],
    // Read as a value as well as a type, so which it is cannot be decided here.
    inapplicable: `import { A } from "./a.ts"\nlet x: A\nexport const y = A`,
  },
  import_extension: {
    lang: "js",
    applicable: [`import { a } from "./a.ts"`, `export { a } from "./a.ts"`],
    // A bare package specifier is not relative and names no file of ours.
    inapplicable: `import { a } from "node:fs"`,
  },
  nullish_default: {
    lang: "js",
    applicable: [
      `export const a = b ?? 1`,
      `export const a = b || 1`,
      `export const a = b ?? []`,
      `export const a = b ?? {}`,
    ],
    // A call on the right is a fallback branch, where the two operators are not
    // interchangeable.
    inapplicable: `export const a = b || c()`,
  },
  non_null_assertion: {
    lang: "js",
    applicable: [`export const a = b!.c`, `export const a = b?.c`, `export const a = b?.()`],
    inapplicable: `export const a = b.c`,
  },
  absent_is_null: {
    lang: "js",
    applicable: [
      `export function f() { return null }`,
      `export function f() { return undefined }`,
      `export const g = () => null`,
      `export const h = () => undefined`,
    ],
    // A bare return is a guard clause saying "stop here", not a spelling of an
    // absent value.
    inapplicable: `export function f() { if (a) return\n  g() }`,
  },
  iterate_with_for_of: {
    lang: "js",
    applicable: [`for (const x of xs) { g(x) }`, `xs.forEach((x) => g(x))`],
    // An indexed for loop is the third form the claim does not name.
    inapplicable: `for (let i = 0; i < xs.length; i++) { g(xs[i]) }`,
  },
  test_call_style: {
    lang: "js",
    applicable: [`test("a", () => {})`, `it("a", () => {})`, `test.each([1])("a", () => {})`],
    // A regex `.test()` is an ordinary value that happens to share the name.
    inapplicable: `export const ok = /x/.test("x")`,
  },
  assertion_style: {
    lang: "js",
    applicable: [`expect(a).toBe(1)`, `assert(a)`, `assert.strict.equal(a, 1)`],
    inapplicable: `export function f() { return 1 }`,
  },

  doc_comment_style: {
    lang: "js",
    // Every exported form the walker treats apart. The comment is deliberately
    // absent from most: applicability is about being a site, not conforming.
    applicable: [
      `export function fooBar() {}`,
      `export class OrderList {}`,
      `export const fetchAll = () => {}`,
      `export default function () {}`,
      `/** documented */\nexport function documented() {}`,
    ],
    inapplicable: `function local() {}\nexport const limit = 3;`,
  },

  // --- dimensions-capability.mjs ---
  route_logging: {
    lang: "js",
    // Each direct form, and each import shape a wrapper binding arrives in.
    applicable: [
      `console.log("x")`,
      `console.error("x")`,
      `import logger from "./logger.js"; logger.info("x")`,
      `import { log } from "./logging.ts"; log("x")`,
      `import * as log from "../shared/app-logger.ts"; log.warn("x")`,
    ],
    inapplicable: `import winston from "winston"; winston.info("x")`,
  },
  route_network: {
    lang: "js",
    applicable: [
      `const a = await fetch("/x")`,
      `import axios from "axios"; await axios.get("/y")`,
      `import { api } from "./api-client.ts"; await api.get("/z")`,
      `import { request } from "./http.ts"; await request("/z")`,
    ],
    inapplicable: `import got from "got"; await got("/x")`,
  },
  route_env: {
    lang: "js",
    applicable: [
      `const a = process.env.PORT`,
      `const b = process.env["PORT"]`,
      `import { config } from "./config.ts"; const c = config.port`,
      `import settings from "./settings.js"; const d = settings.db.host`,
    ],
    inapplicable: `const e = process.argv[2]`,
  },

  // --- dimensions-naming.mjs ---
  function_naming_case: {
    lang: "js",
    // Every form the walker treats apart: a declaration, an arrow bound to a
    // const, a function expression bound to a const, in each spellable class.
    applicable: [
      `function fooBar() {}`,
      `function foo_bar() {}`,
      `const FooBar = () => {}`,
      `const fetchAll = function () {}`,
    ],
    // A single lowercase word matches every class and votes for none, and a
    // nested function is not module level.
    inapplicable: `function outer() { function innerName() {} }`,
  },
  exported_symbol_case: {
    lang: "js",
    applicable: [
      `export function fooBar() {}`,
      `export const my_thing = 1`,
      `export const doThing = () => {}`,
      `export default function fooBar() {}`,
    ],
    // A class and a type declaration are the other two rows' sites; an
    // anonymous default export and a renaming specifier are nobody's.
    inapplicable: [
      `export class OrderList {}`,
      `export type UserShape = { id: string }`,
      `export default function () {}`,
      `const plain = 1; export { plain as renamedThing }`,
    ],
  },
  exported_class_case: {
    lang: "js",
    applicable: [`export class OrderList {}`, `export const Foo = class {}`, `export default class Foo {}`],
    inapplicable: [`export function fooBar() {}`, `export default class {}`],
  },
  exported_type_case: {
    lang: "js",
    applicable: [`export interface IFoo { a: string }`, `export type UserShape = { id: string }`, `export enum Color { Red, Green }`],
    inapplicable: `export class OrderList {}`,
  },
  extends_base: {
    lang: "js",
    // Both spellings of a superclass the sentence names, on both class forms.
    applicable: [
      `export class A extends B {}`,
      `export class C extends React.Component {}`,
      `export const D = class extends Foo.Bar.Baz {}`,
    ],
    // A class naming no superclass has nothing to vote with.
    inapplicable: `export class E {}`,
  },
  interface_prefix: {
    lang: "js",
    applicable: [`export interface IFoo { a: string }`, `export interface Comment { a: string }`],
    inapplicable: `export type TBar = 1`,
  },
  type_alias_prefix: {
    lang: "js",
    applicable: [`export type TBar = 1`, `export type Plain = 2`],
    inapplicable: `export interface IFoo { a: string }`,
  },

  // --- dimensions-jsx.mjs ---
  hook_call_style: {
    lang: "jsx",
    applicable: [
      `import { useState } from "react"\nexport function C() { const [a] = useState(1); return <p>{a}</p> }`,
      `export function C() { const [a] = React.useState(1); return <p>{a}</p> }`,
    ],
    // Another library's method that happens to share a hook's name.
    inapplicable: `export function C() { const a = store.useState(1); return <p>{a}</p> }`,
  },
  handler_is_named: {
    lang: "jsx",
    applicable: [
      `export function C() { return <button onClick={() => g()} /> }`,
      `export function C() { return <button onClick={g} /> }`,
      `export function C() { return <button onClick={this.g} /> }`,
    ],
    // A bind call is the third form the claim does not name.
    inapplicable: `export function C() { return <button onClick={g.bind(null, 1)} /> }`,
  },
  spread_on_component: {
    lang: "jsx",
    // "once per spread attribute rather than once per element" is a count, and
    // a non-zero assertion proves nothing about it.
    applicable: [{ source: `export function C(p) { return <Child {...p} {...q} /> }`, sites: 2 }],
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
    applicable: [
      `begin\n  a\nrescue => e\nend`,
      { source: `begin\n  a\nrescue A => e\n  b\nrescue B => e\n  c\nend`, sites: 2 },
    ],
    inapplicable: `def f\n  1\nend`,
  },
  record_lookup: {
    lang: "ruby",
    applicable: [`User.find_by(id: 1)`, `User.find(1)`, `User.find!(1)`, `User.find_by!(id: 1)`],
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
    applicable: [
      `class S\n  def call\n    1\n  end\nend`,
      `class S\n  def self.call\n    1\n  end\nend`,
      `class S\n  def perform\n    1\n  end\nend`,
      `class S\n  def execute\n    1\n  end\nend`,
      `class S\n  def run\n    1\n  end\nend`,
      `module S\n  def self.call\n    1\n  end\nend`,
    ],
    inapplicable: [
      // A helper method is not an entry point, so counting it would charge every
      // raise in the repository.
      `class S\n  def helper\n    raise "x"\n  end\nend`,
      // A def on any other receiver belongs to that object, not to this class.
      // Widening the guard rather than narrowing it leaves every applicable
      // witness passing, so the other direction needs its own source.
      `class S\n  def other.call\n    1\n  end\nend`,
    ],
  },
  keyword_params: {
    lang: "ruby",
    applicable: [
      `def f(a:, b:, c:)\nend`,
      `def f(a, b, c)\nend`,
      `def f(a, b, c:)\nend`,
      `def f(a = 1, b = 2, c = 3)\nend`,
      `def f(a, *rest, b, c)\nend`,
    ],
    // Two arguments read fine positionally; the convention starts at three.
    inapplicable: `def f(a, b)\nend`,
  },
  zone_aware_time: {
    lang: "ruby",
    applicable: [
      `Time.now`, `DateTime.now`, `Date.today`,
      `Time.current`, `Date.current`, `DateTime.current`,
      `Time.zone.now`, `Time.zone.today`,
    ],
    inapplicable: `def f\n  1\nend`,
  },

  logger_over_puts: {
    lang: "ruby",
    applicable: [
      `puts "x"`,
      `pp result`,
      `warn "careful"`,
      `logger.info("x")`,
      `Rails.logger.warn("x")`,
      `@logger.debug("x")`,
    ],
    inapplicable: `compute(1)`,
  },
  http_through_client: {
    lang: "ruby",
    applicable: [
      `Net::HTTP.get(uri)`,
      `URI.open("https://x")`,
      `ApiClient.get("/x")`,
      `client.post("/y")`,
      `@client.post("/y")`,
    ],
    inapplicable: `record.save`,
  },
  class_base: {
    lang: "ruby",
    applicable: [`class A < ApplicationController\nend`, `class B < ActionController::Base\nend`],
    inapplicable: `class C\nend`,
  },
  module_include: {
    lang: "ruby",
    applicable: [
      `class W\n  include Sidekiq::Worker\nend`,
      `module M\n  include Enumerable\nend`,
      // The sentence says once per constant, and `include A, B` is where that
      // is either true or a half count.
      { source: `class W\n  include A, B\nend`, sites: 2 },
      // The class body is the site, so one declaring no mixin is a site too. An
      // include inside a method runs when the method does and declares nothing,
      // which leaves the body bare rather than outside the count.
      `class Forgot\nend`,
      `class Late\n  def go\n    include Foo\n  end\nend`,
      // A class written in two parts is one class, and the part carrying the
      // mixins is where it declared them: one site, not a second bare one.
      { source: `class BWorker\n  include Sidekiq::Worker\nend\n\nclass BWorker\n  def perform\n  end\nend`, sites: 1 },
    ],
    inapplicable: [
      // A module declaring nothing is namespacing, which is what modules are
      // for. One declaring an include composed a mixin and is in the applicable
      // half above.
      `module Namespace\nend`,
      // A subclass can be handed the mixin by its base, so its bare body is not
      // the forgotten include.
      `class BustCacheWorker < BustCacheBaseWorker\n  def perform\n  end\nend`,
      // A class inside a class is that class's helper, not a peer of the ones
      // the claim is about.
      `class Policy < Service::PolicyBase\n  class Strategy\n  end\nend`,
      // `prepend` puts the module ahead of the class rather than behind it, so
      // the body declared a mixin and has forgotten nothing.
      `class PWorker\n  prepend Sidekiq::Worker\nend`,
      // Not a body at all, so there is nothing for the sentence to be about.
      `include TopLevel`,
    ],
  },

  // --- dimensions-rails.mjs ---
  migration_reversible: {
    lang: "ruby",
    applicable: [
      `class M < ActiveRecord::Migration[7.0]\n  def change\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def up\n  end\n  def down\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def down\n  end\nend`,
    ],
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
    applicable: [
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_column :users, :name, :string, null: false\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users do |t|\n      t.string :name, null: false\n    end\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    change_table :users do |t|\n      t.string :name, null: false\n    end\n  end\nend`,
    ],
    // Each exclusion the sentence names: two that alter a column which already
    // exists, and two whose nullability the writer did not choose.
    inapplicable: [
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    change_column :users, :name, :text\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    change_column_null :users, :name, false\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users do |t|\n      t.timestamps\n    end\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users do |t|\n      t.references :org\n    end\n  end\nend`,
    ],
  },
  table_primary_key_declared: {
    lang: "ruby",
    applicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :users, id: :uuid do |t|\n    end\n  end\nend`,
    inapplicable: `class M < ActiveRecord::Migration[7.0]\n  def change\n    drop_table :users\n  end\nend`,
  },
  reference_foreign_key: {
    lang: "ruby",
    applicable: [
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_reference :posts, :user, foreign_key: true\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :posts do |t|\n      t.references :user, foreign_key: true\n    end\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    add_belongs_to :posts, :user, foreign_key: true\n  end\nend`,
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :posts do |t|\n      t.belongs_to :user, foreign_key: true\n    end\n  end\nend`,
    ],
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
      // Three ways the sentence says a file is not a producer, and the first is
      // the one that matters: producers exist whatever a repository tests with,
      // so a row asked there could only ever read zero.
      inapplicable: [
        [`${p.from}/thing${p.ext}`],
        [`${p.from}/thing${p.ext === ".rb" ? ".rake" : ".rb"}`, `${p.to}/thing${p.companionSuffix}`],
        [`somewhere/else/thing${p.ext}`, `${p.to}/thing${p.companionSuffix}`],
        // A producer whose own name ends in the companion suffix is not one.
        // Unreachable for the .rake row, where the two suffixes are disjoint by
        // construction and the extension test drops the file first.
        [`${p.from}/thing${p.companionSuffix}`, `${p.to}/other${p.companionSuffix}`],
      ],
    },
  ])
);

const jsKeys = Object.keys(WITNESSES).filter((k) => WITNESSES[k].lang !== "ruby");
const rubyKeys = Object.keys(WITNESSES).filter((k) => WITNESSES[k].lang === "ruby");

// The extension `materialise` will actually give this source, not a second copy
// of the table. The parse worker picks its grammar from the name, so a private
// mapping that drifted would hand every JSX witness to the TypeScript grammar,
// read `<button` as a type assertion, and report five broken predicates.
const rel = (key, half, i = 0) => `${key}.${half}.${i}.${declOf(WITNESSES[key].lang).scratchExt}`;
const listed = (v) => (Array.isArray(v) ? v : [v]);

async function hitsFor(keys) {
  const files = keys.flatMap((key) => {
    const w = WITNESSES[key];
    return [
      ...listed(w.applicable).map((x, i) => ({ rel: rel(key, "applicable", i), source: sourceOf(x), lang: w.lang })),
      ...listed(w.inapplicable).map((x, i) => ({ rel: rel(key, "inapplicable", i), source: sourceOf(x), lang: w.lang })),
    ];
  });
  // One pass for every witness rather than one per dimension: `parseAll` forks
  // a pool, and a pool per source is a minute of fork cost for nothing.
  const { records } = await parseAll(files, { frameworks: ["rails"] });
  return records;
}

const sourceOf = (w) => (typeof w === "string" ? w : w.source);
const expected = (w) => (typeof w === "string" ? null : w.sites);

/**
 * How many sites the predicate found, or why the witness itself is the problem.
 *
 * A witness that does not parse comes back `ok: false` with no `hits` at all,
 * which read as zero sites and passed the whole inapplicable half on a typo. A
 * fixture nobody can parse proves nothing in either direction, so it is its own
 * answer rather than a count.
 */
function sitesIn(records, key, half, i) {
  const record = records.get(rel(key, half, i));
  if (!record) return { error: "was never parsed" };
  if (record.ok !== true) return { error: `did not parse (${record.kind}${record.error ? `: ${record.error}` : ""})` };
  return { sites: (record.hits?.[key] ?? []).length };
}

test("every shipped dimension has a witness pair", () => {
  // The witnesses here are driven through `parseAll`, which is the syntactic
  // engine. A semantic row's predicate takes a checker instead and cannot be
  // proved by a parse, so its witnesses live in `dimensions-semantic.test.mjs`
  // and that file holds the same completeness assertion over its own registry.
  const shipped = [
    ...ALL_DIMENSIONS.filter((d) => d.tier !== "semantic").map((d) => d.key),
    ...PAIRINGS.map((p) => p.key),
  ].sort();
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
    const w = WITNESSES[key];
    const sites = ALL_DIMENSIONS.find((d) => d.key === key).applicabilityPredicate.sites;

    // Every member the sentence names, not the first one that happens to match.
    listed(w.applicable).forEach((witness, i) => {
      const src = JSON.stringify(sourceOf(witness));
      const got = sitesIn(records, key, "applicable", i);
      if (got.error) return problems.push(`${key}'s applicable witness ${src} ${got.error}`);
      if (got.sites === 0) return problems.push(`${key} says it applies to "${sites}" and found no site in ${src}`);
      // Where the sentence promises a count, the count is the claim. "once per
      // spread attribute rather than once per element" and "each link of a
      // multi-rescue chain" are both cardinality, and non-zero proves neither.
      const want = expected(witness);
      if (want !== null && got.sites !== want) {
        problems.push(`${key} promises ${want} site(s) in ${src} and found ${got.sites}`);
      }
    });

    listed(w.inapplicable).forEach((witness, i) => {
      const src = JSON.stringify(sourceOf(witness));
      const got = sitesIn(records, key, "inapplicable", i);
      if (got.error) return problems.push(`${key}'s inapplicable witness ${src} ${got.error}`);
      if (got.sites !== 0) {
        problems.push(`${key} counted ${got.sites} site(s) in ${src}, which its sentence does not claim`);
      }
    });
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
    const sites = pairing.applicabilityPredicate.sites;
    if (applyTo(w.applicable, pairing.key) === 0) {
      problems.push(`${pairing.key} says it applies to "${sites}" and counted no producer in its own witness`);
    }
    for (const corpus of w.inapplicable) {
      const n = applyTo(corpus, pairing.key);
      if (n !== 0) problems.push(`${pairing.key} counted ${n} producer(s) in ${JSON.stringify(corpus)}, which its sentence does not claim`);
    }
  }

  assert.deepEqual(problems, []);
});

/**
 * A predicate that recognises its construct through a closed table of names.
 *
 * The witness pairs above prove a predicate sees each shape the code treats
 * differently, and a table is one shape however many names it holds: dropping
 * `next-intl` from the module list, or two hooks from the hook set, changes no
 * shape and survives every test above. What it changes is which repositories
 * the dimension can speak about at all, silently, which is the under-counted
 * applicability C2 exists to refuse.
 *
 * So each member is driven through the real predicate, and the list here is
 * written out rather than read from the table: an expectation computed the way
 * the code computes it agrees with the code by construction and can never
 * disagree with it. Shrink the table and the members it dropped fail here.
 *
 * The comparison runs both ways: a member added to the table and not to this
 * list fails too, which is the point at which somebody decides whether it
 * belongs. One direction alone lets a table grow with nobody looking.
 */
const TABLES = [
  {
    what: "the test-runner modifiers",
    key: "test_call_style",
    lang: "js",
    members: ["each", "only", "skip", "todo", "failing", "concurrent", "skipIf", "runIf", "if", "for"],
    source: (m) => `test.${m}([1])("a", () => {})`,
  },
  {
    what: "React's own hooks",
    key: "hook_call_style",
    lang: "jsx",
    members: [
      "useState", "useEffect", "useContext", "useReducer", "useCallback", "useMemo",
      "useRef", "useImperativeHandle", "useLayoutEffect", "useInsertionEffect",
      "useDebugValue", "useId", "useDeferredValue", "useTransition",
      "useSyncExternalStore", "useOptimistic", "useActionState",
    ],
    source: (m) => `export function C() { const a = ${m}(1); return <p>{a}</p> }`,
  },
  {
    what: "the translation modules a file may reach its layer through",
    key: "text_translated",
    lang: "jsx",
    members: ["react-intl", "react-i18next", "i18next", "next-intl", "react-intl-universal", "@lingui/react", "@formatjs/intl"],
    source: (m) => `import { t } from "${m}"\nexport function C() { return <p>Hello</p> }`,
  },
  {
    what: "the translation calls",
    key: "text_translated",
    lang: "jsx",
    members: ["t", "translate", "formatMessage", "__", "gettext"],
    source: (m) => `import { x } from "i18next"\nexport function C() { return <p>{${m}("k")}</p> }`,
  },
  {
    what: "the extensions a relative import may name a source file with",
    key: "import_extension",
    lang: "js",
    members: ["js", "jsx", "mjs", "cjs", "ts", "tsx"],
    // Dropping one does not merely narrow applicability: the same table decides
    // conforming, so a repository importing through that extension reads as
    // breaking the claim everywhere rather than as not being asked.
    source: (m) => `import { a } from "./a.${m}"`,
  },
  {
    what: "the elements a file may reach its translation layer through",
    key: "text_translated",
    lang: "jsx",
    members: ["FormattedMessage", "FormattedHTMLMessage", "Trans", "Translate"],
    // The element is what makes the file applicable; the visible text beside it
    // is the site, so the source carries both.
    source: (m) => `export function C() { return <div><${m} id="k" />Hello</div> }`,
  },
  {
    what: "the model base classes",
    key: "model_callbacks",
    lang: "ruby",
    members: ["ApplicationRecord", "ActiveRecord::Base", "ApplicationRecord::Base"],
    source: (m) => `class User < ${m}
end`,
  },
  {
    what: "the column types a migration may declare",
    key: "column_null_declared",
    lang: "ruby",
    members: [
      "string", "text", "integer", "bigint", "float", "decimal", "numeric", "datetime",
      "timestamp", "time", "date", "binary", "boolean", "json", "jsonb", "uuid", "inet",
      "cidr", "macaddr", "citext", "interval", "money", "hstore", "vector", "daterange",
      "tsvector", "xml", "column", "primary_key", "enum",
    ],
    source: (m) =>
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :t do |t|\n      t.${m} :c, null: false\n    end\n  end\nend`,
  },
  {
    what: "the reference-column calls",
    key: "reference_foreign_key",
    lang: "ruby",
    members: ["add_reference", "add_belongs_to"],
    source: (m) => `class M < ActiveRecord::Migration[7.0]\n  def change\n    ${m} :posts, :user, foreign_key: true\n  end\nend`,
  },
  {
    what: "the reference-column calls inside a block",
    key: "reference_foreign_key",
    lang: "ruby",
    members: ["references", "belongs_to"],
    source: (m) =>
      `class M < ActiveRecord::Migration[7.0]\n  def change\n    create_table :posts do |t|\n      t.${m} :user, foreign_key: true\n    end\n  end\nend`,
  },
];

async function tableProblems(tables) {
  const files = tables.flatMap((t, ti) =>
    t.members.map((m, mi) => ({ rel: `table${ti}.${mi}.${declOf(t.lang).scratchExt}`, source: t.source(m), lang: t.lang }))
  );
  const { records } = await parseAll(files, { frameworks: ["rails"] });
  const problems = [];

  tables.forEach((t, ti) => {
    t.members.forEach((m, mi) => {
      const record = records.get(`table${ti}.${mi}.${declOf(t.lang).scratchExt}`);
      if (!record || record.ok !== true) {
        return problems.push(`${t.key}'s witness for ${JSON.stringify(m)} did not parse`);
      }
      if ((record.hits?.[t.key] ?? []).length === 0) {
        problems.push(`${t.key} does not recognise ${JSON.stringify(m)}, one of ${t.what}`);
      }
    });
  });

  return problems;
}

test("no table grew a member this list has not seen", () => {
  // The other direction. Driving each listed member through the predicate shows
  // the table did not shrink; only comparing the two lists shows it did not
  // grow, and a name added with nobody looking is a claim nobody decided to
  // make.
  const shipped = {
    hook_call_style: REACT_HOOKS,
    column_null_declared: COLUMN_TYPE,
  };
  for (const [key, table] of Object.entries(shipped)) {
    const listed = TABLES.filter((t) => t.key === key && t.members.length === table.size);
    assert.equal(listed.length, 1, `${key}: no TABLES row matches the shipped table's size`);
    assert.deepEqual([...listed[0].members].sort(), [...table].sort(), `${key} grew or lost a member`);
  }
});

test("every JavaScript name a predicate recognises through a table is recognised", async () => {
  assert.deepEqual(await tableProblems(TABLES.filter((t) => t.lang !== "ruby")), []);
});

test("every Ruby name a predicate recognises through a table is recognised", needsRuby, async () => {
  assert.deepEqual(await tableProblems(TABLES.filter((t) => t.lang === "ruby")), []);
});
