import { test } from "node:test";
import assert from "node:assert/strict";

import { PAIRINGS, applyPairings, companionOf, companionRoot, pairingHits, pairingViolations, pairingsFor } from "../lib/pairing.mjs";
import { reduceArea } from "../lib/reduce.mjs";

const RAKE_SPEC = {
  from: "lib/tasks",
  to: "spec/lib/tasks",
  ext: ".rake",
  companionSuffix: "_spec.rb",
};

test("a rake task names the spec it is obliged to ship with", () => {
  assert.equal(
    companionOf("lib/tasks/backfill/listings.rake", RAKE_SPEC),
    "spec/lib/tasks/backfill/listings_spec.rb",
  );
});

test("a file outside the producer directory has no companion to name", () => {
  assert.equal(companionOf("app/models/user.rb", RAKE_SPEC), null);
});

test("each eligible file is one site, conforming when its companion is tracked", () => {
  const corpus = new Set([
    "lib/tasks/backfill/listings.rake",
    "lib/tasks/cleanup.rake",
    "spec/lib/tasks/backfill/listings_spec.rb",
    "app/models/user.rb",
  ]);

  const hits = pairingHits(corpus, RAKE_SPEC);

  assert.deepEqual([...hits.keys()].sort(), ["lib/tasks/backfill/listings.rake", "lib/tasks/cleanup.rake"]);
  assert.deepEqual(hits.get("lib/tasks/backfill/listings.rake"), [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(hits.get("lib/tasks/cleanup.rake"), [{ conforming: false, elsewhere: false }]);
});

const TS_TEST = { from: "src", to: "src", ext: ".ts", companionSuffix: ".test.ts" };

test("a companion is not counted as a producer needing its own companion", () => {
  // `src/api.test.ts` sits under `src` and ends in `.ts`, so a naive eligibility
  // check makes every test file a producer that owes `api.test.test.ts`. That
  // doubles the denominator with sites no repository can ever satisfy.
  const corpus = new Set(["src/api.ts", "src/api.test.ts"]);

  const hits = pairingHits(corpus, TS_TEST);

  assert.deepEqual([...hits.keys()], ["src/api.ts"]);
  assert.deepEqual(hits.get("src/api.ts"), [{ conforming: true, elsewhere: false }]);
});

test("pairings are selected by the languages the area holds", () => {
  const ruby = pairingsFor(["ruby"]).map((p) => p.key);
  const js = pairingsFor(["js"]).map((p) => p.key);

  assert.ok(ruby.includes("rake_task_spec"), `ruby pairings: ${ruby.join(", ")}`);
  assert.equal(js.includes("rake_task_spec"), false);
});

test("a pairing carries no run function, so the parser must never be handed one", () => {
  // Dimensions run inside the parse worker against a program. A pairing has no
  // program to run against; handing it to the worker throws on every file and
  // the whole area comes back unparsed.
  for (const p of pairingsFor(["ruby", "js", "jsx"])) {
    assert.equal(typeof p.run, "undefined", p.key);
    assert.equal(p.kind, "pairing", p.key);
  }
});

test("the existing fold counts a pairing without knowing it is different", () => {
  // The hit shape is deliberately the one every dimension produces, so nothing
  // in reduceArea has to special-case an obligation.
  const area = {
    langs: ["ruby"],
    files: [
      { rel: "lib/tasks/a.rake", lang: "ruby" },
      { rel: "lib/tasks/b.rake", lang: "ruby" },
    ],
  };
  const parsed = [
    { rel: "lib/tasks/a.rake", ok: true, hits: { rake_task_spec: [{ conforming: true }] } },
    { rel: "lib/tasks/b.rake", ok: true, hits: { rake_task_spec: [{ conforming: false }] } },
  ];

  const row = reduceArea(area, parsed).find((d) => d.key === "rake_task_spec");

  assert.ok(row, "the pairing produced no row at all");
  assert.equal(row.applicability, 2);
  assert.equal(row.candidates, 2);
  assert.equal(row.conforming, 1);
  assert.deepEqual(row.exceptions, [{ path: "lib/tasks/b.rake", count: 1 }]);
});

test("the corpus decides the obligation, and only parsed files can carry it", () => {
  // A producer that failed to parse is unexamined, and the existing fold drops
  // it the way it drops every other unexamined file. Counting it here would
  // make this one dimension speak for files nothing else in the map does.
  const corpus = new Set([
    "lib/tasks/a.rake",
    "lib/tasks/b.rake",
    "lib/tasks/broken.rake",
    "spec/lib/tasks/a_spec.rb",
  ]);
  const parsed = new Map([
    ["lib/tasks/a.rake", { rel: "lib/tasks/a.rake", ok: true, hits: {} }],
    ["lib/tasks/b.rake", { rel: "lib/tasks/b.rake", ok: true, hits: {} }],
    ["lib/tasks/broken.rake", { rel: "lib/tasks/broken.rake", ok: false, error: "parse failed" }],
  ]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.deepEqual(parsed.get("lib/tasks/a.rake").hits.rake_task_spec, [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(parsed.get("lib/tasks/b.rake").hits.rake_task_spec, [{ conforming: false, elsewhere: false }]);
  assert.equal(parsed.get("lib/tasks/broken.rake").hits, undefined);
});

test("a pairing whose language is absent is never applied", () => {
  const corpus = new Set(["lib/tasks/a.rake"]);
  const parsed = new Map([["lib/tasks/a.rake", { rel: "lib/tasks/a.rake", ok: true, hits: {} }]]);

  applyPairings(parsed, corpus, ["js"]);

  assert.deepEqual(parsed.get("lib/tasks/a.rake").hits, {});
});

test("applying pairings does not mutate the record it was handed", () => {
  // The baseline map and the corpus map hold the SAME record objects for files
  // unchanged since the pin. Writing hits into one therefore writes them into
  // the other, and the baseline stops being a different measurement.
  const record = { rel: "lib/tasks/a.rake", ok: true, hits: { other: [{ conforming: true }] } };
  const parsed = new Map([["lib/tasks/a.rake", record]]);
  // One companion of the shape somewhere, or the obligation is not counted here
  // at all and this case would prove nothing.
  const corpus = new Set(["lib/tasks/a.rake", "spec/lib/tasks/elsewhere_spec.rb"]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.equal(record.hits.rake_task_spec, undefined, "the original record was written to");
  assert.deepEqual(parsed.get("lib/tasks/a.rake").hits.rake_task_spec, [{ conforming: false, elsewhere: false }]);
  assert.deepEqual(parsed.get("lib/tasks/a.rake").hits.other, [{ conforming: true }], "other hits survive");
});




test("a dimension that is not a pairing carries no companion count at all", () => {
  // The fold stays blind to the difference: an absent key is absent, not zero,
  // so nothing renders a companion line for a syntax dimension.
  const area = { langs: ["js"], files: [{ rel: "src/a.ts", lang: "js" }] };
  const parsed = [{ rel: "src/a.ts", ok: true, hits: { module_state_const: [{ conforming: true }] } }];

  const row = reduceArea(area, parsed).find((d) => d.key === "module_state_const");

  assert.equal("companionsElsewhere" in row, false);
});

test("a changed producer with no companion in the tree is a violation", () => {
  const changed = ["lib/tasks/new.rake", "lib/tasks/paired.rake", "app/models/user.rb"];
  const corpus = new Set([
    "lib/tasks/new.rake",
    "lib/tasks/paired.rake",
    "spec/lib/tasks/paired_spec.rb",
    "app/models/user.rb",
  ]);

  const found = pairingViolations(changed, corpus, RAKE_SPEC);

  assert.deepEqual(found, [{ path: "lib/tasks/new.rake", companion: "spec/lib/tasks/new_spec.rb" }]);
});

test("a file the branch did not touch is not reported, however unpaired", () => {
  // The check speaks about this branch. An obligation the repository has been
  // carrying for years is the map's business, not a finding against this diff.
  const changed = ["lib/tasks/touched.rake"];
  const corpus = new Set(["lib/tasks/touched.rake", "lib/tasks/ancient.rake", "spec/lib/tasks/touched_spec.rb"]);

  assert.deepEqual(pairingViolations(changed, corpus, RAKE_SPEC), []);
});

const MODEL_TEST = { from: "app/models", to: "test/models", ext: ".rb", companionSuffix: "_test.rb" };
const MODEL_SPEC = { from: "app/models", to: "spec/models", ext: ".rb", companionSuffix: "_spec.rb" };



test("the row counts companions elsewhere over this area's own producers", () => {
  // Reviewed and rebuilt: the count used to be taken over the whole corpus and
  // printed onto every area, so a nine-file area under app/services claimed the
  // repository's 185. Carried on the hit, it folds per area like every other
  // number on the line.
  const area = {
    langs: ["ruby"],
    files: [
      { rel: "app/models/a.rb", lang: "ruby" },
      { rel: "app/models/b.rb", lang: "ruby" },
    ],
  };
  const parsed = [
    { rel: "app/models/a.rb", ok: true, hits: { model_spec: [{ conforming: false, elsewhere: true }] } },
    { rel: "app/models/b.rb", ok: true, hits: { model_spec: [{ conforming: false, elsewhere: false }] } },
  ];

  const row = reduceArea(area, parsed).find((d) => d.key === "model_spec");

  assert.equal(row.candidates, 2);
  assert.equal(row.conforming, 0);
  assert.equal(row.companionsElsewhere, 1, "only a.rb has a namesake in another directory");
});

test("a dimension that is not an obligation carries no companion count", () => {
  const area = { langs: ["js"], files: [{ rel: "src/a.ts", lang: "js" }] };
  const parsed = [{ rel: "src/a.ts", ok: true, hits: { module_state_const: [{ conforming: true }] } }];

  const row = reduceArea(area, parsed).find((d) => d.key === "module_state_const");

  assert.equal("companionsElsewhere" in row, false);
});

test("a producer whose companion sits elsewhere is marked on its own hit", () => {
  const corpus = new Set([
    "app/models/a.rb",
    "app/models/b.rb",
    "spec/models/b_spec.rb",
    "spec/legacy/a_spec.rb",
  ]);
  const parsed = new Map([
    ["app/models/a.rb", { rel: "app/models/a.rb", ok: true, hits: {} }],
    ["app/models/b.rb", { rel: "app/models/b.rb", ok: true, hits: {} }],
  ]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.deepEqual(parsed.get("app/models/a.rb").hits.model_spec, [{ conforming: false, elsewhere: true }]);
  assert.deepEqual(parsed.get("app/models/b.rb").hits.model_spec, [{ conforming: true, elsewhere: false }]);
});

test("the registry carries every obligation the corpus showed a habit for", () => {
  // Each row was chosen from a measurement across the Rails repositories in the
  // corpus,
  // not from a list of conventions. A repository without the layout gives its
  // row zero eligible files and it prints nothing, which is why counting a
  // habit the repository does not have costs nothing.
  const keys = pairingsFor(["ruby"]).map((p) => p.key).sort();
  assert.deepEqual(keys, [
    "controller_spec",
    "job_spec",
    "job_test",
    "model_spec",
    "model_test",
    "rake_task_spec",
    "serializer_spec",
    "service_spec",
    "worker_spec",
  ]);
});

test("every registry row is well formed, so a typo cannot ship as a silent zero", () => {
  // A row with a stray slash matches nothing, and matching nothing is
  // indistinguishable from a repository that has no such habit.
  const seen = new Set();
  for (const p of PAIRINGS) {
    assert.equal(p.kind, "pairing", p.key);
    assert.equal(typeof p.run, "undefined", p.key);
    assert.ok(p.claim && p.langs?.length, p.key);
    assert.equal(seen.has(p.key), false, `duplicate key ${p.key}`);
    seen.add(p.key);
    for (const dir of [p.from, p.to]) {
      assert.ok(dir && !dir.startsWith("/") && !dir.endsWith("/"), `${p.key}: ${dir}`);
    }
    assert.ok(p.ext.startsWith("."), `${p.key}: ${p.ext}`);
    assert.ok(/^[._]/.test(p.companionSuffix), `${p.key}: ${p.companionSuffix}`);
  }
});

test("an obligation whose companion shape appears nowhere is not counted at all", () => {
  // Every Rails repository holds app/models, so the producers of both the RSpec
  // row and the minitest row exist in all of them. Counting both puts a row
  // reading "a model ships with a test: 0 of 129" into every RSpec map, and a
  // row that can only ever read zero is a false statement about the repository,
  // not a measurement of it.
  const rspec = new Set(["app/models/user.rb", "spec/models/user_spec.rb"]);

  const keys = [...applyPairings(new Map(), rspec, ["ruby"])];

  assert.ok(keys.includes("model_spec"), "the framework this repository uses is counted");
  assert.equal(keys.includes("model_test"), false, "the framework it does not use is not");
});

test("an obligation whose companion shape appears somewhere is counted, even at zero", () => {
  // One companion anywhere is the evidence that the habit exists. Zero of many
  // then means the repository has the habit and this producer set lacks it,
  // which is a real answer.
  const minitest = new Set(["app/models/user.rb", "test/models/order_test.rb"]);
  const keys = [...applyPairings(new Map(), minitest, ["ruby"])];

  assert.ok(keys.includes("model_test"));
  assert.equal(keys.includes("model_spec"), false);
});

test("the companion root is learned from where the companions actually are", () => {
  // alphagov/whitehall keeps model tests under test/unit/app/models, so the
  // hardcoded test/models pair scored 0 of 160 against a habit it plainly has,
  // with 117 namesakes sitting one prefix away. The substitution was right; the
  // prefix it substituted was a guess.
  const corpus = new Set([
    "app/models/edition.rb",
    "app/models/document.rb",
    "app/models/edition/auditable.rb",
    "test/unit/app/models/edition_test.rb",
    "test/unit/app/models/document_test.rb",
    "test/unit/app/models/edition/auditable_test.rb",
  ]);
  const shape = { from: "app/models", ext: ".rb", companionSuffix: "_test.rb" };

  assert.equal(companionRoot(corpus, shape), "test/unit/app/models");
});

test("a repository that keeps them where the rule guessed still learns that", () => {
  const corpus = new Set([
    "app/services/pay.rb",
    "app/services/refund.rb",
    "spec/services/pay_spec.rb",
    "spec/services/refund_spec.rb",
  ]);
  const shape = { from: "app/services", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape), "spec/services");
});

test("the root the most producers agree on wins, so one stray file cannot move it", () => {
  // discourse's controller specs are in spec/requests, 95 of them, beside a
  // handful elsewhere. A rule that took the first match it found would learn
  // whichever path sorted first.
  const corpus = new Set([
    ...["a", "b", "c", "d"].map((n) => `app/controllers/${n}.rb`),
    ...["a", "b", "c"].map((n) => `spec/requests/${n}_spec.rb`),
    "spec/controllers/d_spec.rb",
  ]);
  const shape = { from: "app/controllers", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape), "spec/requests");
});

test("no companion anywhere learns no root, so the obligation is not asked", () => {
  const corpus = new Set(["app/models/a.rb", "app/models/b.rb", "spec/lib/unrelated_spec.rb"]);
  const shape = { from: "app/models", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape), null);
});

test("the companion root is learned inside one package, not the whole corpus", () => {
  // decidim: every gem nests its own app/ one level down. The vote has to stay
  // inside decidim-core, or a same-named spec anywhere else in the monorepo
  // could win it.
  const corpus = new Set([
    "decidim-core/app/models/foo.rb",
    "decidim-core/spec/models/foo_spec.rb",
    "decidim-admin/spec/models/bar_spec.rb",
  ]);
  const shape = { from: "app/models", to: "spec/models", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape, "decidim-core"), "decidim-core/spec/models");
});

test("a package with the producer but no companion of its own learns nothing, even if a sibling package has one", () => {
  const corpus = new Set([
    "decidim-admin/app/models/bar.rb",
    "decidim-core/spec/models/foo_spec.rb",
  ]);
  const shape = { from: "app/models", to: "spec/models", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape, "decidim-admin"), null);
});

test("an obligation counts against the root this repository uses", () => {
  // The whitehall shape end to end: 3 models, 2 with a test, under a root the
  // hardcoded pair never named. Before this the row read 0 of 3.
  const corpus = new Set([
    "app/models/edition.rb",
    "app/models/document.rb",
    "app/models/orphan.rb",
    "test/unit/app/models/edition_test.rb",
    "test/unit/app/models/document_test.rb",
  ]);
  const parsed = new Map(
    [...corpus].map((rel) => [rel, { rel, ok: true, hits: {} }])
  );

  const applied = applyPairings(parsed, corpus, ["ruby"]);

  assert.ok(applied.has("model_test"), "the obligation applies, because the companions exist");
  const hits = (rel) => parsed.get(rel).hits.model_test;
  assert.equal(hits("app/models/edition.rb")[0].conforming, true);
  assert.equal(hits("app/models/document.rb")[0].conforming, true);
  assert.equal(hits("app/models/orphan.rb")[0].conforming, false, "and the one with none still fails");
  assert.equal(hits("test/unit/app/models/edition_test.rb"), undefined, "a companion owes nothing itself");
});

test("a tie the declared pair has no part in learns nothing", () => {
  // Two roots on one vote each is a repository that has said nothing, and
  // picking the alphabetical winner decides an obligation by a filename, which
  // is what the tie-break exists to refuse. Falling back to the declared pair
  // reports the honest zero with the namesakes counted beside it.
  const corpus = new Set([
    "app/models/user.rb",
    "app/models/post.rb",
    "zzz/user_spec.rb",
    "aaa/post_spec.rb",
  ]);
  const shape = { from: "app/models", to: "spec/models", ext: ".rb", companionSuffix: "_spec.rb" };

  assert.equal(companionRoot(corpus, shape), null);
});

test("a producer root nested inside a package is learned, and the obligation fires inside that package", () => {
  // decidim: PAIRINGS declares "app/models" literally, so on a monorepo where
  // every gem nests its own app/ one level down, the producer set was empty
  // and the obligation never fired on any of the 28 gems.
  const corpus = new Set([
    "decidim-core/app/models/decidim/component.rb",
    "decidim-core/spec/models/decidim/component_spec.rb",
    "decidim-core/app/models/decidim/untested.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("decidim-core/app/models/decidim/component.rb"), [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(hits.get("decidim-core/app/models/decidim/untested.rb"), [{ conforming: false, elsewhere: false }]);
});

test("a producer pairs only within its own package, never across a sibling package", () => {
  // A model in decidim-admin must never be credited by decidim-core's spec of
  // the identical basename. That cross-package credit is the one thing this
  // learning must refuse.
  const corpus = new Set([
    "decidim-core/app/models/decidim/foo.rb",
    "decidim-core/spec/models/decidim/foo_spec.rb",
    "decidim-admin/app/models/decidim/foo.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("decidim-core/app/models/decidim/foo.rb"), [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(hits.get("decidim-admin/app/models/decidim/foo.rb"), [{ conforming: false, elsewhere: true }]);
});

test("a flat corpus learns the identical root and hits it always did", () => {
  // Pin: package-prefix learning must be a no-op with no package boundary.
  // Hand-computed against the pre-fix algorithm: user and post tie the root
  // vote one each, spec/models wins on being the declared pair.
  const corpus = new Set([
    "app/models/user.rb",
    "app/models/post.rb",
    "app/models/order.rb",
    "spec/models/user_spec.rb",
    "spec/legacy/post_spec.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits, new Map([
    ["app/models/user.rb", [{ conforming: true, elsewhere: false }]],
    ["app/models/post.rb", [{ conforming: false, elsewhere: true }]],
    ["app/models/order.rb", [{ conforming: false, elsewhere: false }]],
  ]));
});

test("a package's spec cannot answer the obligation of a model at the repository root", () => {
  // The root is a package too, the one everything not inside another belongs
  // to. Restricting only the named prefixes left it able to see every spec in
  // the repository, so a nested package's spec of the same basename satisfied
  // a root-level model that has none of its own.
  const corpus = new Set([
    "app/models/foo.rb",
    "app/models/bar.rb",
    "packages/x/app/models/foo.rb",
    "packages/x/spec/models/foo_spec.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("app/models/foo.rb"), [{ conforming: false, elsewhere: true }]);
  assert.deepEqual(hits.get("packages/x/app/models/foo.rb"), [{ conforming: true, elsewhere: false }]);
});

test("a changed producer inside a package owes a companion inside that same package", () => {
  const changed = ["decidim-core/app/models/decidim/new_thing.rb"];
  const corpus = new Set([
    "decidim-core/app/models/decidim/new_thing.rb",
    "decidim-core/app/models/decidim/existing.rb",
    "decidim-core/spec/models/decidim/existing_spec.rb",
  ]);

  assert.deepEqual(pairingViolations(changed, corpus, MODEL_SPEC), [
    {
      path: "decidim-core/app/models/decidim/new_thing.rb",
      companion: "decidim-core/spec/models/decidim/new_thing_spec.rb",
    },
  ]);
});

test("applying pairings on a monorepo credits each package's own producers, not a sibling's", () => {
  const corpus = new Set([
    "decidim-core/app/models/decidim/component.rb",
    "decidim-core/spec/models/decidim/component_spec.rb",
    "decidim-admin/app/models/decidim/admin/dashboard.rb",
  ]);
  const parsed = new Map([...corpus].map((rel) => [rel, { rel, ok: true, hits: {} }]));

  const applied = applyPairings(parsed, corpus, ["ruby"]);

  assert.ok(applied.has("model_spec"));
  assert.equal(parsed.get("decidim-core/app/models/decidim/component.rb").hits.model_spec[0].conforming, true);
  assert.equal(parsed.get("decidim-admin/app/models/decidim/admin/dashboard.rb").hits.model_spec[0].conforming, false);
});
