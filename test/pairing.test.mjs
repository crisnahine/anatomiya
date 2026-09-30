import { test } from "node:test";
import assert from "node:assert/strict";

import { PAIRINGS, applyPairings, companionOf, companionRoot, pairingHits, pairingViolations, pairingsFor } from "../plugins/anatomiya/lib/pairing.mjs";
import { reduceArea } from "../plugins/anatomiya/lib/reduce.mjs";

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




test("a record reused from another corpus answers the obligation this corpus holds, or none", () => {
  // The baseline reuses today's record for every producer unchanged since the
  // pin, and today's record already carries today's pairing answer. Where the
  // pinned tree held no companion of that shape, re-applying over it left
  // today's answer in place, so specs added after the pin read as the
  // baseline's own habit and the branch was held to it.
  const today = { rel: "lib/tasks/a.rake", ok: true, hits: { rake_task_spec: [{ conforming: true, elsewhere: false }], other: [{ conforming: true }] } };
  const parsed = new Map([["lib/tasks/a.rake", today]]);
  const atPin = new Set(["lib/tasks/a.rake"]);

  applyPairings(parsed, atPin, ["ruby"]);

  assert.equal(parsed.get("lib/tasks/a.rake").hits.rake_task_spec, undefined);
  assert.deepEqual(parsed.get("lib/tasks/a.rake").hits.other, [{ conforming: true }], "other hits survive");
  assert.deepEqual(today.hits.rake_task_spec, [{ conforming: true, elsewhere: false }], "and today's record is not written to");
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
    "app/models/x/a.rb",
    "app/models/b.rb",
    "spec/models/b_spec.rb",
    "spec/legacy/x/a_spec.rb",
  ]);
  const parsed = new Map([
    ["app/models/x/a.rb", { rel: "app/models/x/a.rb", ok: true, hits: {} }],
    ["app/models/b.rb", { rel: "app/models/b.rb", ok: true, hits: {} }],
  ]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.deepEqual(parsed.get("app/models/x/a.rb").hits.model_spec, [{ conforming: false, elsewhere: true }]);
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
  // vote one each, spec/models wins on being the declared pair. A flat
  // producer's tail carries its directory, `models`, which legacy/ lacks.
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
    ["app/models/post.rb", [{ conforming: false, elsewhere: false }]],
    ["app/models/order.rb", [{ conforming: false, elsewhere: false }]],
  ]));
});

test("a package with no companion of its own is told a path under that package", () => {
  // The fallback to the declared pair, mirrored under the prefix, is what the
  // check prints to a reader. Nothing pinned the two sides of it apart: both a
  // real path and the string "null/..." are equally absent from the corpus, so
  // every existing test read the same either way.
  const changed = ["decidim-admin/app/models/decidim/admin/dashboard.rb"];
  const corpus = new Set([
    "decidim-core/app/models/decidim/component.rb",
    "decidim-core/spec/models/decidim/component_spec.rb",
    "decidim-admin/app/models/decidim/admin/dashboard.rb",
  ]);

  assert.deepEqual(pairingViolations(changed, corpus, MODEL_SPEC), [
    {
      path: "decidim-admin/app/models/decidim/admin/dashboard.rb",
      companion: "decidim-admin/spec/models/decidim/admin/dashboard_spec.rb",
    },
  ]);
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

/* --- an abstract base is never routed to, so it is not a site (#66) --- */

const CONTROLLER_SPEC = { from: "app/controllers", to: "spec/controllers", ext: ".rb", companionSuffix: "_spec.rb" };

test("an abstract base names no companion", () => {
  // Three unroutable files took a 62-of-62 claim to 62 of 65, the evidence gate
  // then read 0.8729 against the 0.90 bar, and the whole claim went unstated
  // over files nobody could ever satisfy. A reviewer left "No spec for this
  // controller. All 56 siblings have one" on a live pull request; the map had
  // the data and could not say it.
  assert.equal(companionOf("app/controllers/api/v1/base_controller.rb", CONTROLLER_SPEC), null);
  assert.equal(companionOf("app/controllers/api/v1/chrome_extension/base_controller.rb", CONTROLLER_SPEC), null);
  assert.equal(companionOf("app/controllers/base.rb", CONTROLLER_SPEC), null);
});

test("the noun has to match the directory, so a base of another kind is still a site", () => {
  assert.equal(companionOf("app/models/base_controller.rb", MODEL_SPEC), "spec/models/base_controller_spec.rb");
  assert.equal(companionOf("app/models/base_model.rb", MODEL_SPEC), null);
});

test("a concrete controller whose name merely starts with base is still a site", () => {
  assert.equal(
    companionOf("app/controllers/base_price_controller.rb", CONTROLLER_SPEC),
    "spec/controllers/base_price_controller_spec.rb"
  );
});

test("the base is not a site on either side, so the scan and the check agree about it", () => {
  // The load-bearing one. A rule placed in `pairingHits` alone leaves `check`
  // firing a MUST-FIX against a file the map never counted, which is the H12
  // asymmetry in reverse.
  const corpus = new Set([
    "app/controllers/api/v1/base_controller.rb",
    "app/controllers/api/v1/listings_controller.rb",
    "spec/controllers/api/v1/listings_controller_spec.rb",
  ]);

  const hits = pairingHits(corpus, CONTROLLER_SPEC);

  assert.deepEqual([...hits.keys()], ["app/controllers/api/v1/listings_controller.rb"]);
  assert.deepEqual(pairingViolations(["app/controllers/api/v1/base_controller.rb"], corpus, CONTROLLER_SPEC), []);
});

test("a repository writing its specs with a longer suffix is counted on the suffix it writes", () => {
  // empire-flippers/api spells the majority of spec/models as
  // `<name>_model_spec.rb`: 52 of 166 models against 46 on the bare suffix.
  // Read on the bare one alone the row said 44 of 129 and the map told an
  // agent this repository does not spec its models, at half the real rate.
  const models = Array.from({ length: 20 }, (_, i) => `app/models/m${i}.rb`);
  const corpus = new Set([
    ...models,
    // Six on the declared spelling, eight on the longer one, and six with none.
    ...models.slice(0, 6).map((r) => `spec/models/${r.slice("app/models/".length, -3)}_spec.rb`),
    ...models.slice(6, 14).map((r) => `spec/models/${r.slice("app/models/".length, -3)}_model_spec.rb`),
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("app/models/m0.rb"), [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(hits.get("app/models/m6.rb"), [{ conforming: true, elsewhere: false }], "the learned spelling");
  assert.deepEqual(hits.get("app/models/m14.rb"), [{ conforming: false, elsewhere: false }]);
  assert.equal([...hits.values()].filter(([h]) => h.conforming).length, 14);
});

test("a suffix only a handful of files carry is another model's spec, not a spelling", () => {
  // `user.rb` beside `user_membership_spec.rb` is UserMembership's spec.
  // Measured across the corpus, every repository's second suffix but one sits
  // at or under a sixteenth of the producers and is exactly this; the one that
  // is a real spelling carries a third of them.
  const models = Array.from({ length: 40 }, (_, i) => `app/models/m${i}.rb`);
  const corpus = new Set([
    ...models,
    ...models.slice(0, 30).map((r) => `spec/models/${r.slice("app/models/".length, -3)}_spec.rb`),
    "spec/models/m30_membership_spec.rb",
    "spec/models/m31_membership_spec.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("app/models/m30.rb"), [{ conforming: false, elsewhere: false }]);
  assert.equal([...hits.values()].filter(([h]) => h.conforming).length, 30);
});

test("a learned spelling begins at a separator, not inside the producer's name", () => {
  // `m0.rb` beside `m0book_spec.rb` is `m0book`'s spec. On a small root three
  // of them clear both the floor and the share, so the noise gate alone cannot
  // tell a spelling from a longer name.
  const models = Array.from({ length: 10 }, (_, i) => `app/models/m${i}.rb`);
  const corpus = new Set([...models, ...[0, 1, 2].map((i) => `spec/models/m${i}book_spec.rb`)]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.equal([...hits.values()].filter(([h]) => h.conforming).length, 0);
});

/* --- a companion is a test file, not a file name --- */

const SERVICE_SPEC = { from: "app/services", to: "spec/services", ext: ".rb", companionSuffix: "_spec.rb" };

test("a spec for another class of the same basename is not this producer's namesake elsewhere", () => {
  // empire-flippers/api summed 185 namesakes elsewhere and 2 were specs of the
  // same class: `create_spec.rb` alone matched 54 producers on its basename.
  const corpus = new Set([
    "app/services/users/create.rb",
    "app/services/orders/create.rb",
    "app/services/orders/sync.rb",
    "spec/services/users/create_spec.rb",
    "spec/legacy/orders/sync_spec.rb",
  ]);

  const hits = pairingHits(corpus, SERVICE_SPEC);

  assert.deepEqual(hits.get("app/services/users/create.rb"), [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(hits.get("app/services/orders/create.rb"), [{ conforming: false, elsewhere: false }]);
  assert.deepEqual(hits.get("app/services/orders/sync.rb"), [{ conforming: false, elsewhere: true }], "the same tail under another root");
});

test("a file named like a companion outside every test tree does not open the row", () => {
  // A RuboCop cop named for the guard it enforces put "a model ships with a
  // test: 0 of 141" into an RSpec repository with no test directory at all.
  const corpus = new Set([
    "app/models/user.rb",
    "spec/models/user_spec.rb",
    "lib/rubocop/cops/sleep_without_unless_test.rb",
  ]);

  const keys = [...applyPairings(new Map(), corpus, ["ruby"])];

  assert.ok(keys.includes("model_spec"));
  assert.equal(keys.includes("model_test"), false);
});

test("a file named like a companion outside every test tree answers no producer on either side", () => {
  // Left in, it is the only vote for a companion root and wins it outright.
  const corpus = new Set(["app/models/user.rb", "lib/models/user_test.rb", "test/models/other_test.rb"]);
  const parsed = new Map([["app/models/user.rb", { rel: "app/models/user.rb", ok: true, hits: {} }]]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.deepEqual(parsed.get("app/models/user.rb").hits.model_test, [{ conforming: false, elsewhere: false }]);
  const records = new Map([["lib/models/user_test.rb", { ok: true, facets: {} }]]);
  assert.deepEqual(pairingViolations(["app/models/user.rb"], corpus, MODEL_TEST, new Set(), records), [
    { path: "app/models/user.rb", companion: "test/models/user_test.rb" },
  ]);
});

test("a spec the check did not read keeps its name's answer, wherever the repository keeps it", () => {
  // The scan read it and found `RSpec.describe`; the check reads only the
  // branch's files, and `specs/` is no named test tree.
  const corpus = new Set(["app/models/m1.rb", "app/models/m2.rb", "specs/models/m1_spec.rb", "specs/models/m2_spec.rb"]);
  const records = new Map([["app/models/m1.rb", { ok: true, facets: {} }]]);

  assert.deepEqual(pairingViolations(["app/models/m1.rb"], corpus, MODEL_SPEC, new Set(), records), []);
});

test("a branch that empties a spec is asked about the producer it answered, as one that deletes it is", () => {
  const corpus = new Set(["app/models/user.rb", "app/models/post.rb", "spec/models/user_spec.rb", "spec/models/post_spec.rb"]);
  const records = new Map([["spec/models/user_spec.rb", { ok: true, facets: { empty: true } }]]);

  assert.deepEqual(pairingViolations(["spec/models/user_spec.rb"], corpus, MODEL_SPEC, new Set(), records), [
    { path: "app/models/user.rb", companion: "spec/models/user_spec.rb" },
  ]);
});

test("a producer directly under its root is matched on its directory and basename, never the basename alone", () => {
  // `spec/requests/vote_spec.rb` is a request spec; whitehall's models are
  // tested under `test/unit/app/models`, one directory deeper.
  const corpus = new Set([
    "app/models/user.rb",
    "app/models/vote.rb",
    "app/models/tag.rb",
    "spec/models/user_spec.rb",
    "spec/requests/vote_spec.rb",
    "spec/unit/app/models/tag_spec.rb",
  ]);

  const hits = pairingHits(corpus, MODEL_SPEC);

  assert.deepEqual(hits.get("app/models/vote.rb"), [{ conforming: false, elsewhere: false }]);
  assert.deepEqual(hits.get("app/models/tag.rb"), [{ conforming: false, elsewhere: true }]);
});

test("a spec the parse found empty answers no producer, so the pairing row and the kinds line agree", () => {
  // Commented out top to bottom, it made one area file print "2 of 6 have a
  // namesake test" above "3 of 6 sites" for the same six services.
  const corpus = new Set([
    "app/services/billing/svc1.rb",
    "app/services/billing/svc2.rb",
    "spec/services/billing/svc1_spec.rb",
    "spec/services/billing/svc2_spec.rb",
    "spec/legacy/billing/svc2_spec.rb",
  ]);
  const record = (rel, facets) => [rel, { rel, ok: true, hits: {}, ...(facets ? { facets } : {}) }];
  const parsed = new Map([
    record("app/services/billing/svc1.rb"),
    record("app/services/billing/svc2.rb"),
    record("spec/services/billing/svc1_spec.rb", { testCalls: true }),
    record("spec/services/billing/svc2_spec.rb", { empty: true }),
    record("spec/legacy/billing/svc2_spec.rb", { empty: true }),
  ]);

  applyPairings(parsed, corpus, ["ruby"]);

  assert.deepEqual(parsed.get("app/services/billing/svc1.rb").hits.service_spec, [{ conforming: true, elsewhere: false }]);
  assert.deepEqual(parsed.get("app/services/billing/svc2.rb").hits.service_spec, [{ conforming: false, elsewhere: false }]);
});

test("a branch that satisfies an obligation with an empty spec is still told to write one", () => {
  const corpus = new Set(["app/models/user.rb", "spec/models/user_spec.rb", "spec/models/post_spec.rb"]);
  const records = new Map([["spec/models/user_spec.rb", { ok: true, facets: { empty: true } }]]);

  assert.deepEqual(pairingViolations(["app/models/user.rb"], corpus, MODEL_SPEC), []);
  assert.deepEqual(pairingViolations(["app/models/user.rb"], corpus, MODEL_SPEC, new Set(), records), [
    { path: "app/models/user.rb", companion: "spec/models/user_spec.rb" },
  ]);
});

test("the base clause says what the rule reads, a name, and claims nothing about specs", () => {
  // A base is excluded on its name alone, and 6 of 18 measured bases had a
  // spec, so "can never own one" was false about the tree it printed in.
  for (const row of PAIRINGS) {
    const { sites, notCounted } = row.applicabilityPredicate;
    assert.doesNotMatch(notCounted, /own one/, row.key);
    assert.doesNotMatch(sites, /own one/, row.key);
    assert.match(notCounted, /abstract base/, row.key);
  }
});
