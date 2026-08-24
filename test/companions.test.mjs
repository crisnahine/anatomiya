import { test } from "node:test";
import assert from "node:assert/strict";

import { namesakeCompanions, namesakeIndex } from "../plugins/anatomiya/lib/companions.mjs";
import { dirOf } from "../plugins/anatomiya/lib/paths.mjs";

const file = (rel) => ({ rel });
// A test file that names what it covers. The specifiers are what the parser
// records for a real file, relative to the test's own directory.
const imports = (rel, modules) => ({
  rel,
  facets: { imports: modules.map((module) => ({ module, names: [], relative: true })) },
});

test("a same-stem spec in an unrelated directory is not credited", () => {
  // puppet: lib/puppet/network.rb has no test anywhere. A decoy spec planted at
  // spec/unit/totally_unrelated/network_spec.rb, whose body describes something
  // with no relation to Puppet::Network, must not move the count.
  const source = [file("lib/puppet/network.rb")];
  const decoy = [file("spec/unit/totally_unrelated/network_spec.rb")];

  assert.deepEqual(namesakeCompanions(source, [], "lib/puppet"), { with: 0, of: 1, root: null });
  assert.deepEqual(namesakeCompanions(source, decoy, "lib/puppet"), { with: 0, of: 1, root: null });
});

test("many packages defining the same basename credit only the one with a real spec", () => {
  // openproject: 24 of 30 engines define Engine < Rails::Engine and exactly one,
  // backlogs, has a real engine_spec.rb. costs and github_integration must not
  // be credited via backlogs' spec merely for sharing the stem "engine".
  const backlogs = [
    file("modules/backlogs/lib/backlogs/engine.rb"),
    file("modules/backlogs/lib/backlogs/version.rb"),
  ];
  const tests = [
    file("modules/backlogs/spec/backlogs/engine_spec.rb"),
    file("modules/backlogs/spec/backlogs/version_spec.rb"),
  ];

  assert.deepEqual(namesakeCompanions(backlogs, tests, "modules/backlogs/lib/backlogs"), {
    with: 2,
    of: 2,
    root: "modules/backlogs/spec/backlogs",
  });

  const costsEngine = [file("modules/costs/lib/costs/engine.rb")];
  assert.deepEqual(namesakeCompanions(costsEngine, tests, "modules/costs/lib/costs"), {
    with: 0,
    of: 1,
    root: null,
  });
});

test("a same-stem file in another language is not credited", () => {
  // plots2 credits cable.js, a WebSocket consumer, with a server-side
  // cable_test.rb: the two share a stem and nothing else.
  const source = [file("app/assets/javascripts/channels/cable.js")];
  const tests = [file("test/models/cable_test.rb")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/assets/javascripts/channels"), {
    with: 0,
    of: 1,
    root: null,
  });
});

test("a bare top-level test directory does not answer every root's producers", () => {
  // Before this fix an empty tail matched unconditionally, so any same-stem
  // file anywhere, including a bare test/ directory with no structural
  // relation to the root, was credited. A bare tree-word directory still has
  // to mirror the root it is credited to.
  const source = [file("apps/www/Page0.tsx"), file("apps/www/Page1.tsx")];
  const tests = [file("test/Page0.test.tsx"), file("test/Page1.test.tsx")];

  assert.deepEqual(namesakeCompanions(source, tests, "apps/www"), { with: 0, of: 2, root: null });
});

test("the overview and an area file agree about the same files", () => {
  // huginn: app/assets/javascripts/components stated "2 of 6", crediting
  // form_configurable.js and utils.js with unrelated RSpec files, while the
  // same files scoped under app/assets (non-empty tail) correctly read "0 of
  // 18". Both evaluations must agree.
  const files = [
    file("app/assets/javascripts/components/form_configurable.js"),
    file("app/assets/javascripts/components/utils.js"),
  ];
  const tests = [file("spec/concerns/form_configurable_spec.rb"), file("spec/lib/utils_spec.rb")];

  const coarse = namesakeCompanions(files, tests, "app/assets");
  const fine = namesakeCompanions(files, tests, "app/assets/javascripts/components");

  assert.deepEqual(coarse, { with: 0, of: 2, root: null });
  assert.deepEqual(fine, { with: 0, of: 2, root: null });
});

test("a nested corpus is unaffected: the same engine shape one level up stays byte-identical", () => {
  // The tail is non-empty here (`budgets/lib/budgets`), the path openproject
  // measured zero cross-engine leakage over 2,623 producers on. Pinned so the
  // empty-tail fix cannot be the thing that moves it.
  const source = [
    file("modules/budgets/lib/budgets/engine.rb"),
    file("modules/budgets/lib/budgets/railtie.rb"),
  ];
  const tests = [
    file("modules/budgets/spec/budgets/engine_spec.rb"),
    file("modules/budgets/spec/budgets/railtie_spec.rb"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "modules"), {
    with: 2,
    of: 2,
    root: "modules/budgets/spec",
  });
});

test("an empty tail still finds its companion when the whole directory mirrors the root", () => {
  const source = [file("app/models/foo.rb"), file("app/models/bar.rb")];
  const tests = [file("spec/models/foo_spec.rb"), file("spec/models/bar_spec.rb")];

  assert.deepEqual(namesakeCompanions(source, tests, "app/models"), {
    with: 2,
    of: 2,
    root: "spec/models",
  });
});

test("a source root whose tree-less form outruns the spec tree still credits its own files", () => {
  // `app/mcp` is a Rails autoload root, so `app/mcp/mcp/context.rb` is
  // `Mcp::Context` and its spec is `spec/mcp/context_spec.rb`. Stripping the
  // tree words leaves `mcp/mcp` against `mcp`, and the mirror was asked in one
  // direction only, so every file sitting directly in that root read untested.
  const src = ["context", "rack_app", "server_instructions"].map((n) => file(`app/mcp/mcp/${n}.rb`));
  const tst = ["context", "rack_app", "server_instructions"].map((n) => file(`spec/mcp/${n}_spec.rb`));

  assert.deepEqual(namesakeCompanions(src, tst, "app/mcp/mcp", namesakeIndex(tst, src)), {
    with: 3,
    of: 3,
    root: "spec/mcp",
  });
});

test("one file answers the same at that root and at the area inside it", () => {
  // The same invariant the package case pins, on the other trigger:
  // `app/mcp/mcp/engineering/context.rb` read 1 of 1 at `app/mcp/mcp` and 0 of
  // 1 at the directory it actually sits in.
  const src = [file("app/mcp/mcp/engineering/context.rb")];
  const tst = [file("spec/mcp/engineering/context_spec.rb")];
  const byStem = namesakeIndex(tst, src);

  assert.equal(
    namesakeCompanions(src, tst, "app/mcp/mcp/engineering", byStem).with,
    namesakeCompanions(src, tst, "app/mcp/mcp", byStem).with
  );
});

test("the reversed mirror is asked of a test tree and of nothing else", () => {
  // H18 measured the unguarded match at 668 false matches on openproject, 43.5%
  // of everything it found, so the reversed direction is held to a directory
  // whose top segment is a tree the repository keeps tests in. Without that,
  // any deeper directory sharing a tail answers.
  const src = [file("app/vendor/stripe/client.rb")];

  assert.equal(
    namesakeCompanions(src, [file("spec/stripe/client_spec.rb")], "app/vendor/stripe").with,
    1,
    "a spec tree answers"
  );
  assert.equal(
    namesakeCompanions(src, [file("qa/stripe/client_spec.rb")], "app/vendor/stripe").with,
    0,
    "and a directory that is nobody's test tree does not"
  );
});

test("neither direction of the empty-tail mirror crosses an engine", () => {
  // mastodon keeps `app/javascript/mastodon/models/account.ts` beside
  // `app/models/account.rb`, and holds both a `spec/models` and a
  // `spec/javascript`. Each direction credited the other language's file: the
  // TypeScript model took the Ruby spec, and the Ruby model took the
  // TypeScript test. The forward direction matched a shape and the reversed one
  // matches a name, and neither is evidence across an engine.
  const ts = [file("app/javascript/mastodon/models/account.ts")];
  const rb = [file("app/models/account.rb")];

  assert.equal(namesakeCompanions(ts, [file("spec/models/account_spec.rb")], "app/javascript/mastodon/models").with, 0);
  assert.equal(namesakeCompanions(rb, [file("spec/javascript/models/account.test.ts")], "app/models").with, 0);

  assert.equal(
    namesakeCompanions(rb, [file("spec/models/account_spec.rb")], "app/models").with,
    1,
    "and the same shape within one engine still answers"
  );
});

test("a component and the test file beside it are one engine, whatever the extension spells", () => {
  // `language` tells `.tsx` from `.ts`, which is the grammar the parser is
  // asked for and not what a test may cover: a component tested by a plain
  // `.ts` file is the ordinary shape in every React repository there is.
  const src = [file("packages/ui/src/components/Button.tsx")];

  assert.equal(namesakeCompanions(src, [file("spec/components/Button.test.ts")], "packages/ui/src/components").with, 1);
  assert.equal(namesakeCompanions(src, [file("spec/components/Button.spec.rb")], "packages/ui/src/components").with, 0);
});

test("the reversed mirror does not cross a language", () => {
  // mastodon keeps `app/javascript/mastodon/models/account.ts` beside
  // `app/models/account.rb`, and `spec/models/account_spec.rb` covers the Ruby
  // one. Asked in reverse with no language test, the TypeScript model was
  // credited with the Ruby spec: 8 of its 17 files, on a corpus measurement.
  // The forward direction already matched a shape; this one matches a name.
  const src = [file("app/javascript/mastodon/models/account.ts")];
  const tst = [file("spec/models/account_spec.rb")];

  assert.deepEqual(namesakeCompanions(src, tst, "app/javascript/mastodon/models"), { with: 0, of: 1, root: null });

  const ruby = [file("app/mcp/mcp/context.rb")];
  assert.equal(
    namesakeCompanions(ruby, [file("spec/mcp/context_spec.rb")], "app/mcp/mcp").with,
    1,
    "and the same shape within one language still answers"
  );
});

test("a candidate whose directory is nothing but tree words is not asked in reverse", () => {
  // `withoutTree("spec")` is the empty string, and an empty candidate matched
  // against the root would answer whatever sits under it.
  const src = [file("app/vendor/stripe/client.rb")];
  const tst = [file("spec/client_spec.rb")];

  assert.deepEqual(namesakeCompanions(src, tst, "app/vendor/stripe"), { with: 0, of: 1, root: null });
});

test("the nested path is never asked the reversed question, which has nothing to ask it of", () => {
  // `rootBare` is null wherever the tail is not empty, and the reversed call
  // puts it in the receiver position, so an unguarded version throws on every
  // repository rather than counting one wrong.
  const src = [file("packages/foo/src/parser.ts")];
  const tst = [file("packages/foo/test/parser.test.ts")];

  assert.doesNotThrow(() => namesakeCompanions(src, tst, "packages", namesakeIndex(tst, src)));
});

test("a colocated namesake at an evaluated root is still credited", () => {
  const source = [file("src/components/Foo.tsx"), file("src/components/Bar.tsx")];
  const tests = [file("src/components/Foo.test.tsx"), file("src/components/Bar.test.tsx")];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components",
  });
});

test("a bare tree word at the repository root still answers its own files", () => {
  const source = [file("a.ts"), file("b.ts")];
  const tests = [file("a.test.ts"), file("b.test.ts")];

  assert.deepEqual(namesakeCompanions(source, tests, ""), { with: 2, of: 2, root: null });
});

test("a test directory beside the file at an evaluated root is still credited", () => {
  const source = [file("src/components/Foo.tsx"), file("src/components/Bar.tsx")];
  const tests = [
    file("src/components/__tests__/Foo.test.tsx"),
    file("src/components/__tests__/Bar.test.tsx"),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "src/components"), {
    with: 2,
    of: 2,
    root: "src/components/__tests__",
  });
});

test("namesakeIndex builds the stem map namesakeCompanions is handed", () => {
  const index = namesakeIndex([file("spec/models/foo_spec.rb")]);

  assert.deepEqual(index.get("foo"), [
    { rel: "spec/models/foo_spec.rb", dir: "spec/models", bare: "models", covers: new Set(), owner: null },
  ]);
});

test("a flat repository still pairs its own top-level roots", () => {
  // This repository's own shape: scripts/measure-layout.mjs is tested by
  // test/measure-layout.test.mjs, and 8 of its 15 scripts pair that way. Both
  // sides sit at the top of the tree, which is what separates this from the
  // decoys above and from a package root answered by a repository-wide test/.
  const scripts = [
    file("scripts/measure-layout.mjs"),
    file("scripts/seed-defaults.mjs"),
    file("scripts/validate.mjs"),
  ];
  const tests = [file("test/measure-layout.test.mjs"), file("test/seed-defaults.test.mjs")];

  assert.deepEqual(namesakeCompanions(scripts, tests, "scripts", namesakeIndex(tests)), {
    with: 2,
    of: 3,
    root: "test",
  });
});

test("a top-level test tree pairs however it files its tests inside itself", () => {
  // Splitting tests by type under the test root is ordinary: test/unit,
  // test/integration. `unit` is nobody's tree word, so requiring the candidate's
  // own directory to reduce to nothing refused a real pair. What both sides
  // share is the top of the tree, not the shape below it.
  const source = [file("scripts/build.mjs"), file("scripts/deploy.mjs"), file("scripts/release.mjs")];
  const typed = [file("test/unit/build.test.mjs"), file("test/unit/deploy.test.mjs")];

  assert.equal(namesakeCompanions(source, typed, "scripts", namesakeIndex(typed)).with, 2);
});

test("a top-level pair still has to be written in the same language", () => {
  // plots2 credited a 17-line WebSocket consumer with a server-side Ruby spec.
  // The nested path never had to ask, since the directories part first; two
  // files at the top of the tree share a stem and nothing else.
  const source = [file("scripts/release.mjs")];
  const other = [file("test/release_spec.rb")];
  const same = [file("test/release.test.mjs")];

  assert.equal(namesakeCompanions(source, other, "scripts", namesakeIndex(other)).with, 0);
  assert.equal(namesakeCompanions(source, same, "scripts", namesakeIndex(same)).with, 1);
});

test("a test tree nested inside a package does not answer a top-level file", () => {
  // The producer is at the top of the tree, so the candidate has to be too: a
  // package's own test directory answers that package, not the repository root.
  const source = [file("scripts/runner.mjs")];
  const packaged = [file("packages/tool/test/runner.test.mjs")];

  assert.equal(namesakeCompanions(source, packaged, "scripts", namesakeIndex(packaged)).with, 0);
});

test("a nested producer is credited by the test of its own name that imports it", () => {
  // The shape this repository's second plugin has: its sources sit together in
  // a `hooks` directory and every test sits flat under `test/`. The tail
  // `hooks` mirrors nothing on the other side, so path shape alone reads 0 of 5
  // over five files that are each genuinely tested. The import edge is what
  // separates this from the decoys above, which name nothing they cover.
  const names = ["counters", "hook-io", "session-start", "standing-ultracode", "upstream"];
  const source = names.map((n) => file(`ultracode-anywhere/hooks/${n}.mjs`));
  const tests = names.map((n) =>
    imports(`test/${n}.test.mjs`, [`../ultracode-anywhere/hooks/${n}.mjs`]));

  assert.deepEqual(namesakeCompanions(source, tests, "ultracode-anywhere", namesakeIndex(tests)), {
    with: 5,
    of: 5,
    root: "test",
  });
});

test("a test that imports another file of the same stem does not credit this one", () => {
  // The import edge is only evidence for the file it actually names. Two
  // packages holding an index.mjs are answered by the test that imports each,
  // never by the other, which is the openproject engine_spec shape read through
  // the new branch rather than through the tail.
  const source = [file("packages/one/index.mjs"), file("packages/two/index.mjs")];
  const tests = [imports("test/index.test.mjs", ["../packages/one/index.mjs"])];

  assert.deepEqual(namesakeCompanions(source, tests, "packages", namesakeIndex(tests)), {
    with: 1,
    of: 2,
    root: null,
  });
});

test("a bare package specifier names no file in this repository", () => {
  // `import { counters } from "counters"` is a dependency, not the file beside
  // it, and resolving it as a path would credit any file that shares the name.
  const source = [file("ultracode-anywhere/hooks/counters.mjs")];
  const tests = [imports("test/counters.test.mjs", ["counters"])];

  assert.equal(namesakeCompanions(source, tests, "ultracode-anywhere", namesakeIndex(tests)).with, 0);
});

test("an import climbing above the repository root names nothing", () => {
  // Nested, so the top-level pair cannot be what answers it: only the import
  // edge could, and it names a file above the tree that this corpus never held.
  const source = [file("pkg/hooks/counters.mjs")];
  const tests = [imports("test/counters.test.mjs", ["../../outside/counters.mjs"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 0);
});

test("an extension-less specifier answers the file it resolves to", () => {
  // TypeScript and bundler resolution both write the import without the
  // extension, so the two spellings have to reach the same file.
  const source = [file("src/deep/parser.ts")];
  const tests = [imports("test/parser.test.ts", ["../src/deep/parser"])];

  assert.equal(namesakeCompanions(source, tests, "src", namesakeIndex(tests)).with, 1);
});

test("a test naming nothing it covers is still refused by path shape alone", () => {
  // The pinned apps/www decoy, restated with facets present but empty: a parsed
  // file that imports nothing has said nothing, and the tail still governs.
  const source = [file("apps/www/Page0.tsx"), file("apps/www/Page1.tsx")];
  const tests = [imports("test/Page0.test.tsx", []), imports("test/Page1.test.tsx", [])];

  assert.deepEqual(namesakeCompanions(source, tests, "apps/www", namesakeIndex(tests)), {
    with: 0,
    of: 2,
    root: null,
  });
});

test("a data file of the same name is not the module beside it", () => {
  // Dropping the extension to let `./parser` answer `parser.ts` also let
  // `./defaults.json` answer `defaults.mjs`, crediting a module with a test
  // that only ever reads the table next to it.
  // Nested, so only the import edge could answer it, and the edge names the
  // table rather than the module.
  const source = [file("pkg/lib/defaults.mjs")];
  const tests = [imports("test/defaults.test.mjs", ["../pkg/lib/defaults.json"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 0);
});

test("a structural root outvotes an import edge that sorted earlier", () => {
  // An integration test in another package imports these models and sorts
  // before the package's own spec tree. The import edge is evidence that the
  // file is tested; it is not evidence about where this package keeps tests,
  // and claiming the vote left the line naming a directory in a different
  // package.
  const names = ["queue", "worker", "mailer", "cache"];
  const source = names.map((n) => file(`packages/core/src/models/${n}.ts`));
  const tests = [
    ...names.map((n) => imports(`apps/admin/test/${n}.test.ts`, [`../../../packages/core/src/models/${n}`])),
    ...names.map((n) => file(`packages/core/spec/models/${n}.test.ts`)),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "packages/core", namesakeIndex(tests)), {
    with: 4,
    of: 4,
    root: "packages/core/spec",
  });
});

test("a directory import is not the file of the same name beside it", () => {
  // `../pkg/src/foo/` means `foo/index.js`. Nothing is resolved against the
  // filesystem here, so the directory answers nothing rather than answering the
  // unrelated sibling that shares its name.
  const source = [file("pkg/src/foo.js")];
  const tests = [imports("test/foo.test.js", ["../pkg/src/foo/"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 0);
});

test("a .js specifier answers the .ts file it is written for", () => {
  // TypeScript under NodeNext requires the compiled extension in the specifier,
  // so `../src/parser.js` is how a spec names `src/parser.ts`. It is the
  // dominant modern spelling and it is not a different file.
  const source = [file("pkg/src/parser.ts")];
  const tests = [imports("test/parser.test.ts", ["../pkg/src/parser.js"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 1);
});

test("a build-tool suffix on a specifier still names the file", () => {
  // Vite and webpack spell a loader with a query, and the file it names is the
  // file before the question mark.
  const source = [file("pkg/src/worker.ts")];
  const tests = [imports("test/worker.test.ts", ["../pkg/src/worker.ts?worker"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 1);
});

test("a root that reduces to the repository itself is not a place, and does not outvote one", () => {
  // `wholeRoot` answers the empty string when the candidate's own directory is
  // the whole tail. The renderer already refuses to print that, so counting it
  // as a vote only let it beat a directory that is a real place.
  const source = ["a", "b", "c", "d"].map((n) => file(`app/models/${n}.mjs`));
  const tests = [
    file("models/a.test.mjs"),
    file("models/b.test.mjs"),
    imports("zz/spec/c.test.mjs", ["../../app/models/c.mjs"]),
    imports("zz/spec/d.test.mjs", ["../../app/models/d.mjs"]),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "app", namesakeIndex(tests)), {
    with: 4,
    of: 4,
    root: "zz/spec",
  });
});

test("a compiled specifier answers the TypeScript file and nothing else of that name", () => {
  // `./foo.js` is how NodeNext spells `foo.ts`. It is not how anything
  // spells `lib/foo.json` or `lib/foo.css`, and stripping the extension outright
  // credited every file in the directory that shared the stem.
  const source = [file("pkg/lib/foo.ts"), file("pkg/lib/foo.json"), file("pkg/lib/foo.css")];
  const tests = [imports("test/foo.test.js", ["../pkg/lib/foo.js"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 1);
});

test("a dot segment is a directory like any other and answers nothing", () => {
  // `../pkg/src/x/.` and `../pkg/src/x/..` name directories, the same shape the
  // trailing slash names, and resolving them left a directory standing for the
  // module beside it.
  const source = [file("pkg/src/x.mjs")];
  const here = [imports("test/x.test.mjs", ["../pkg/src/x/."])];
  const up = [imports("test/x.test.mjs", ["../pkg/src/x/.."])];

  assert.equal(namesakeCompanions(source, here, "pkg", namesakeIndex(here)).with, 0);
  assert.equal(namesakeCompanions(source, up, "pkg", namesakeIndex(up)).with, 0);
});

test("a colocated test answers for itself, and a second suite does not take the place", () => {
  // The tests sit beside the files. `wholeRoot` reduces that to the repository
  // itself, which is not a name worth printing, and the answer is to print no
  // place rather than to hand it to a cypress tree that merely imports them.
  const names = ["Button", "Card", "Modal", "Tabs"];
  const source = names.map((n) => file(`src/${n}.jsx`));
  const tests = [
    ...names.map((n) => file(`src/${n}.test.jsx`)),
    ...names.map((n) => imports(`cypress/${n}.test.jsx`, [`../src/${n}.jsx`])),
  ];

  assert.deepEqual(namesakeCompanions(source, tests, "", namesakeIndex(tests)), {
    with: 4,
    of: 4,
    root: null,
  });
});

test("a specifier with no extension reaches only what a resolver would reach", () => {
  // `../src/parser` resolves to the module, never to the stylesheet, the table
  // or the declaration file that share its name. Only the population filter one
  // caller applies was keeping those out.
  const source = ["ts", "d.ts", "py", "css", "json"].map((e) => file(`pkg/src/parser.${e}`));
  const tests = [imports("test/parser.test.ts", ["../pkg/src/parser"])];

  assert.equal(namesakeCompanions(source, tests, "pkg", namesakeIndex(tests)).with, 1);
});

test("a package answers the same whichever root above it is evaluated", () => {
  // The overview counts a root and an area file counts a directory inside it,
  // and both ask this. `packages/foo` read 0 of 2 where `packages` and
  // `packages/foo/src` both read 2 of 2: the tail there is `src`, which is a
  // tree word, and nothing was left to match a candidate against.
  const src = [file("packages/foo/src/parser.ts"), file("packages/foo/src/lexer.ts")];
  const tst = [file("packages/foo/test/parser.test.ts"), file("packages/foo/test/lexer.test.ts")];
  const byStem = namesakeIndex(tst);

  for (const root of ["packages", "packages/foo", "packages/foo/src"]) {
    assert.deepEqual(
      namesakeCompanions(src, tst, root, byStem),
      { with: 2, of: 2, root: "packages/foo/test" },
      root
    );
  }
});

test("a spec in a sibling namespace does not answer this one's file", () => {
  // empire-flippers/api: app/services/stripe/reports/generate.rb has no spec.
  // Counted against the area's own tail, `reports`, every spec directory
  // ending in `/reports` answered it, and Shopify's spec was credited to
  // Stripe. The kinds line then said 15 where the pairing claim said 13.
  const stripe = [
    file("app/services/stripe/reports/generate.rb"),
    file("app/services/stripe/reports/start.rb"),
    file("app/services/stripe/charge.rb"),
  ];
  const shopify = [
    file("app/services/shopify/reports/generate.rb"),
    file("app/services/shopify/reports/start.rb"),
  ];
  const specs = [
    file("spec/services/shopify/reports/generate_spec.rb"),
    file("spec/services/shopify/reports/start_spec.rb"),
    file("spec/services/stripe/charge_spec.rb"),
  ];
  // The whole corpus's sources, which is what decides contention: the index is
  // built once per scan over every file, and a root only ever holds one side.
  const byStem = namesakeIndex(specs, [...stripe, ...shopify]);

  assert.deepEqual(namesakeCompanions(stripe, specs, "app/services/stripe", byStem), {
    with: 1,
    of: 3,
    root: null,
  });
  // Shopify keeps both: they are its specs, and refusing Stripe must not cost
  // the directory that actually owns them.
  assert.deepEqual(namesakeCompanions(shopify, specs, "app/services/shopify", byStem), {
    with: 2,
    of: 2,
    root: "spec/services/shopify",
  });
});

test("a directory that spells its specs with a longer suffix is counted on that spelling", () => {
  // empire-flippers/api writes 52 of its 166 models as `<name>_model_spec.rb`
  // and 46 on the bare suffix. Read on the bare one alone the overview said
  // `46 of 166 have a namesake test`, which is a repository that specs its
  // models at 57% reading as one that does it at 28%.
  const models = Array.from({ length: 20 }, (_, i) => `app/models/m${i}.rb`).map(file);
  const specs = [
    ...models.slice(0, 6).map((f) => file(`spec/models/${f.rel.slice(11, -3)}_spec.rb`)),
    ...models.slice(6, 14).map((f) => file(`spec/models/${f.rel.slice(11, -3)}_model_spec.rb`)),
  ];

  assert.deepEqual(namesakeCompanions(models, specs, "app/models", namesakeIndex(specs, models)), {
    with: 14,
    of: 20,
    root: "spec/models",
  });
});

test("a suffix a handful of files carry names another file, and is not learned", () => {
  // `m30_membership_spec.rb` is M30Membership's spec. Learning it would credit
  // `m30.rb` with a test written for something else.
  const models = Array.from({ length: 40 }, (_, i) => `app/models/m${i}.rb`).map(file);
  const specs = [
    ...models.slice(0, 30).map((f) => file(`spec/models/${f.rel.slice(11, -3)}_spec.rb`)),
    file("spec/models/m30_membership_spec.rb"),
    file("spec/models/m31_membership_spec.rb"),
  ];

  assert.deepEqual(namesakeCompanions(models, specs, "app/models", namesakeIndex(specs, models)), {
    with: 30,
    of: 40,
    root: "spec/models",
  });
});

test("where only the import edge answers, a suite beside the code beats a distant one", () => {
  // Both directories hold a namesake test that imports the file, so the count
  // is right either way and only the place is in question. `e2e` won it by
  // sorting before `pkg`, and the repository keeps its unit specs beside the
  // code. Measured over the corpus: of 38 roots with two covering directories,
  // 34 had one beside the code and the printed root was that one in all 34, so
  // preferring it costs nothing measured and settles the rest.
  const names = ["a", "b", "c", "d", "e"];
  const src = names.map((x) => file(`pkg/hooks/${x}.ts`));
  const tests = [
    ...names.map((x) => imports(`e2e/${x}.test.ts`, [`../pkg/hooks/${x}.js`])),
    ...names.map((x) => imports(`pkg/hooks/__spec__/${x}.test.ts`, [`../${x}.js`])),
  ];

  assert.deepEqual(namesakeCompanions(src, tests, "pkg", namesakeIndex(tests)), {
    with: 5,
    of: 5,
    root: "pkg/hooks/__spec__",
  });
});

test("ownership is decided within one language, so a Ruby spec cannot be owned by a JS module", () => {
  // `learnStemExtras` already refuses to read `index_spec.rb` as `index.js`'s
  // test. Ownership asked the same question keyed on the stem alone, so a
  // module that merely shares a name and sits deeper could take a spec off the
  // Ruby file the spec is structurally written for, and the model then read as
  // untested.
  const models = [file("app/models/user.rb")];
  const sources = [...models, file("app/javascript/admin/models/user.mjs")];
  const specs = [file("spec/admin/models/user_spec.rb")];

  assert.deepEqual(namesakeCompanions(models, specs, "app/models", namesakeIndex(specs, sources)), {
    with: 1,
    of: 1,
    root: null,
  });
});

test("a test file answering two stems is owned once per stem, not once overall", () => {
  // `spec/models/address_model_spec.rb` is the literal namesake of
  // `address_model.rb` and the learned-spelling namesake of `address.rb`.
  // Carried as one owner on one shared object, whichever stem was decided last
  // won, and the file whose own name the spec spells read untested.
  const models = [
    file("app/models/address.rb"),
    file("app/models/address_model.rb"),
    file("app/models/company.rb"),
    file("app/models/device.rb"),
    file("app/models/order.rb"),
  ];
  const sources = [...models, file("app/legacy/address.rb")];
  const specs = ["address", "company", "device", "order"].map((n) => file(`spec/models/${n}_model_spec.rb`));
  const byStem = namesakeIndex(specs, sources);

  assert.deepEqual(namesakeCompanions([file("app/models/address_model.rb")], specs, "app/models", byStem), {
    with: 1,
    of: 1,
    root: null,
  });
});

test("a learned spelling begins where the covered name ends, at a separator", () => {
  // `m0.rb` beside `m0book_spec.rb` is not `m0`'s spec with a `book_spec`
  // spelling; it is `m0book`'s. Every real second spelling measured starts at
  // a separator, `_model_spec`, `.unittest`, `-test`, and on a small root the
  // floor and the share coincide, so the noise gate alone does not separate it.
  const models = Array.from({ length: 10 }, (_, i) => file(`app/models/m${i}.rb`));
  const specs = [0, 1, 2].map((i) => file(`spec/models/m${i}book_spec.rb`));

  assert.deepEqual(namesakeCompanions(models, specs, "app/models", namesakeIndex(specs, models)), {
    with: 0,
    of: 10,
    root: null,
  });
});

test("an incidental import does not take a test off the file it sits beside", () => {
  // A spec reaching its own subject through an index file, and naming a
  // same-stem module elsewhere as a stub, said outright that it covers the
  // stub. Taken as proof, it moved the test off the file in its own directory,
  // which already had it, onto one two directories away that has its own.
  const sources = [file("src/api/client.js"), file("src/db/client.js")];
  const tests = [
    imports("src/api/client.test.js", ["./index.js", "../db/client.js"]),
    imports("src/db/client.test.js", ["./client.js"]),
  ];
  const byStem = namesakeIndex(tests, sources);

  assert.deepEqual(namesakeCompanions([file("src/api/client.js")], tests, "src/api", byStem), {
    with: 1,
    of: 1,
    root: null,
  });
});

test("the share decides a spelling, not the floor alone", () => {
  // Four files carry `_helper`, which clears the floor of three and sits at a
  // twentieth of the directory, well under the measured fifth. Pinning the two
  // gates apart: with only the floor to answer to, this would be learned.
  const models = Array.from({ length: 80 }, (_, i) => file(`app/models/m${i}.rb`));
  const specs = [
    ...Array.from({ length: 76 }, (_, i) => file(`spec/models/m${i}_spec.rb`)),
    ...[76, 77, 78, 79].map((i) => file(`spec/models/m${i}_helper_spec.rb`)),
  ];

  assert.deepEqual(namesakeCompanions(models, specs, "app/models", namesakeIndex(specs, models)), {
    with: 76,
    of: 80,
    root: "spec/models",
  });
});

test("a test that imports one file and mirrors another decides neither", () => {
  // Two readings of the edge, each with a counter-example the other gets right,
  // and no repository in the corpus holds the shape to settle them. Where the
  // import and the structure disagree the candidate is left unowned, so it goes
  // on answering both: at worst a false positive, never a retired real test.
  const across = [file("src/foo/parse.js"), file("src/bar/parse.js")];
  const tests = [imports("test/foo/parse.test.js", ["../../src/bar/parse.js"])];
  const byStem = namesakeIndex(tests, across);

  assert.equal(byStem.get("parse")[0].owner, null, "neither signal wins");
  for (const rel of ["src/foo/parse.js", "src/bar/parse.js"]) {
    assert.deepEqual(namesakeCompanions([file(rel)], tests, dirOf(rel), byStem), {
      with: 1,
      of: 1,
      root: null,
    }, rel);
  }
});

test("an import agreeing with the structure settles a tie between two spellings", () => {
  // `src/a/parse.js` and `src/a/parse.mjs` sit in one directory, so structure
  // cannot separate them and the import names which one the spec covers.
  const both = [file("src/a/parse.js"), file("src/a/parse.mjs")];
  const tests = [imports("src/a/parse.test.js", ["./parse.js"])];
  const byStem = namesakeIndex(tests, both);

  assert.equal(byStem.get("parse")[0].owner, "src/a/parse.js");
  assert.deepEqual(namesakeCompanions([file("src/a/parse.mjs")], tests, "src/a", byStem), {
    with: 0,
    of: 1,
    root: null,
  });
});

test("one stem holding two languages decides each against its own sources", () => {
  // `foo_spec.rb` and `foo.test.js` share the stem `foo`, so they sit in one
  // bucket. Read against whichever language happened to sort first, the other
  // language's candidate was matched to the wrong source list.
  const sources = [
    file("app/models/foo.rb"),
    file("app/models/nested/foo.rb"),
    file("src/foo.js"),
    file("src/nested/foo.js"),
  ];
  const tests = [file("spec/models/nested/foo_spec.rb"), file("test/nested/foo.test.js")];
  const byStem = namesakeIndex(tests, sources);
  const owners = Object.fromEntries(byStem.get("foo").map((t) => [t.rel, t.owner]));

  assert.equal(owners["spec/models/nested/foo_spec.rb"], "app/models/nested/foo.rb");
  assert.equal(owners["test/nested/foo.test.js"], "src/nested/foo.js");
});
