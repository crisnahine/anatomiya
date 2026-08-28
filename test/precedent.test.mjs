import { test } from "node:test";
import assert from "node:assert/strict";

import { PRECEDENT_FLOOR, noticeFor, precedentFindings } from "../plugins/anatomiya/lib/precedent.mjs";
import { principleKeys } from "../plugins/anatomiya/lib/principles.mjs";
import { LEVEL_ONLY_LABEL } from "../plugins/anatomiya/lib/layout.mjs";

/** A baseline layout root, in the shape `layout.mjs` records one. */
const root = (dir, { files = 4, companions = null, testRoot = false, tests = [], levelOnly = false } = {}) => ({
  path: levelOnly ? `${dir}${LEVEL_ONLY_LABEL}` : dir,
  dir,
  files,
  source: files,
  exts: [[".rb", files]],
  other: 0,
  jsx: 0,
  jsxExt: null,
  tests,
  testRoot,
  ...(companions ? { companions } : {}),
});

test("a test added where its own siblings have none is a finding", () => {
  // The whole of H38: `spec/mailers/` did not exist, so the file is the only
  // member of its directory and every content rule conforms with itself.
  // The question nobody asked is whether a mailer is tested here at all, and
  // the baseline already answers it: 0 of 4.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
    root("spec/services", { files: 6, testRoot: true }),
  ];

  const found = precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots);

  assert.equal(found.length, 1);
  assert.equal(found[0].path, "spec/mailers/cim_share_mailer_spec.rb");
  assert.equal(found[0].area, "app/mailers");
  assert.equal(found[0].severity, "FIX");
  assert.equal(found[0].dimension, "test_precedent");
  assert.equal(found[0].reason, "spec/mailers holds no other test; app/mailers: 4 files, 0 with a namesake test");
  assert.match(found[0].claim, /a test goes where this kind of file's tests already go/);
});

test("a test added beside siblings that already have one is not a finding", () => {
  // The discriminating case. A rule that fires on both is a rule that fires on
  // everything, and the same session that invented spec/mailers also added a
  // service spec that was exactly right.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  assert.deepEqual(precedentFindings(["spec/services/dispatcher_spec.rb"], roots), []);
});

test("a repository that tests nothing yet is starting, not deviating", () => {
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 0, of: 6, root: null } }),
  ];

  assert.deepEqual(precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots), []);
});

test("a source root too small to have said anything is not precedent", () => {
  // One or two untested files is a repository that has not spoken, and reading
  // silence there as a rule turns the first file written into the convention.
  const roots = [
    root("app/mailers", { files: 2, companions: { with: 0, of: 2, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  assert.deepEqual(precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots), []);
});

test("a file that is not a test is not asked the question", () => {
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  assert.deepEqual(precedentFindings(["app/mailers/report_mailer.rb"], roots), []);
});

test("a run with no map to read finds nothing rather than throwing", () => {
  // `check` hands this whatever the facts hold, and a repository with no map
  // holds null. A rule that throws there takes down every other finding in the
  // run, which is the one thing a rule may not do.
  assert.deepEqual(precedentFindings(["spec/mailers/a_spec.rb"], []), []);
  assert.deepEqual(precedentFindings([], []), []);
});

test("a run that cannot say what is newly added states the same finding as a NIT", () => {
  // Every other finding caps at NIT where the two-run comparison could not be
  // made, because nothing there establishes that a site is new. Addedness is
  // read off the same diff, so this rule owes the same caution.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  const [capped] = precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots, { fresh: false });
  assert.equal(capped.severity, "NIT");
  assert.match(capped.reason, /this run could not establish/);

  const [full] = precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots);
  assert.equal(full.severity, "FIX");
});

test("the principle and the finding refuse on the same floor", () => {
  // `principles.mjs` imports nothing from lib on purpose, so its floor is
  // spelled rather than shared. Asked of what each does at the boundary, so
  // the two can only agree by behaving alike.
  const at = (of) => [
    root("app/mailers", { files: of, companions: { with: 0, of, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];
  const spec = "spec/mailers/cim_share_mailer_spec.rb";

  assert.equal(precedentFindings([spec], at(PRECEDENT_FLOOR)).length, 1);
  assert.ok(principleKeys({ tests: [], roots: at(PRECEDENT_FLOOR) }).includes("test_precedent"));

  assert.deepEqual(precedentFindings([spec], at(PRECEDENT_FLOOR - 1)), []);
  assert.ok(!principleKeys({ tests: [], roots: at(PRECEDENT_FLOOR - 1) }).includes("test_precedent"));
});

test("a write into a directory with no precedent is worth a word before it happens", () => {
  // A44: the claim arrives on PostToolUse, after the file exists, and an area
  // file loads only when something in it is read, so a directory nobody read
  // says nothing at all. The verdict is decidable from the path alone.
  const layout = {
    roots: [
      root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
      root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
    ],
  };

  const said = noticeFor("spec/mailers/cim_share_mailer_spec.rb", layout);

  assert.match(said, /spec\/mailers\/cim_share_mailer_spec\.rb/);
  assert.match(said, /app\/mailers: 4 files, 0 with a namesake test/);
  assert.match(said, /Nothing here was matched to a test by name/);
});

test("an ordinary write says nothing, so the one that matters is not one banner in a hundred", () => {
  // An unchanged block on every result is anti-signal, and the fact that
  // mattered was one clause inside it (A44).
  const layout = {
    roots: [
      root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
      root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
    ],
  };

  assert.equal(noticeFor("spec/services/dispatcher_spec.rb", layout), null);
  assert.equal(noticeFor("app/services/dispatcher.rb", layout), null);
  assert.equal(noticeFor("README.md", layout), null);
});

test("a record whose version this build knows can still hold a root that is not one", () => {
  // The schema gate answers the version and says nothing about the shape, so a
  // root missing its `path` reached `endsWith` and threw. The hook's never-fail
  // catch turned that into silence at the boundary, which is a floor rather
  // than an answer: it would have taken every other finding in a `check` run
  // down with it.
  const roots = [
    { dir: "app/mailers", companions: { with: 0, of: 4 }, tests: [] },
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  assert.deepEqual(precedentFindings(["spec/mailers/x_spec.rb"], roots), []);
  assert.equal(noticeFor("spec/mailers/x_spec.rb", { roots }), null);
});

test("a repository with no map to read says nothing rather than throwing", () => {
  assert.equal(noticeFor("spec/mailers/x_spec.rb", { roots: [] }), null);
  assert.equal(noticeFor("spec/mailers/x_spec.rb", null), null);
});

test("a directory holding tests that pair with nothing is told so, not told it has none", () => {
  // The ratio on its own is the gap that got walked through: `0 of 1003 have a
  // namesake test` never spoke about `__tests__/helper.test.ts`, because that
  // is not a namesake, so it forbade nothing the session was about to do.
  const roots = [
    root("src/pages", {
      files: 1003,
      companions: { with: 0, of: 1003, root: null },
      tests: [{ runner: "vitest", files: 2, sub: "__tests__", under: 2 }],
    }),
    root("src/utils", { files: 6, companions: { with: 6, of: 6, root: "src/utils/__tests__" } }),
  ];

  const [found] = precedentFindings(["src/pages/Listing/__tests__/nda.test.ts"], roots);
  assert.match(found.reason, /elsewhere in it 2 vitest specs under __tests__, none of them a namesake/);

  const said = noticeFor("src/pages/Listing/__tests__/nda.test.ts", { roots });
  assert.match(said, /elsewhere in it 2 vitest specs under __tests__, none of them a namesake/);
});

test("a tail two roots answer to is precedent where either of them has it", () => {
  // Longest is not nearest. `spec/mailers` reaches both `app/mailers` and an
  // engine's own `app/mailers`, and answering from the longer one told a spec
  // sitting beside four siblings of its own that it had no precedent, off a
  // directory it has nothing to do with.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 4, of: 4, root: "spec/mailers" } }),
    root("engines/legacy/app/mailers", { files: 3, companions: { with: 0, of: 3, root: null } }),
  ];

  assert.deepEqual(precedentFindings(["spec/mailers/new_thing_mailer_spec.rb"], roots), []);
});

test("where every root a tail answers to is untested, the one with the most producers speaks", () => {
  // Which of two untested roots the file is about cannot be read off the path,
  // and the verdict is the same either way, so the stronger count is the one
  // worth printing rather than whichever directory has the longer name.
  const roots = [
    root("app/mailers", { files: 9, companions: { with: 0, of: 9, root: null } }),
    root("engines/legacy/app/mailers", { files: 3, companions: { with: 0, of: 3, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  const [found] = precedentFindings(["spec/mailers/new_thing_mailer_spec.rb"], roots);
  assert.equal(found.area, "app/mailers");
  assert.match(found.reason, /app\/mailers: 9 files/);
});

test("a tests directory in the middle of a path names neither where nor what", () => {
  // `src/__tests__/pages` is about `src/pages`, and dropping the tree word is
  // what reaches it: shortening the tail alone walks past `src/pages` to `src`.
  const roots = [
    root("src/pages", { files: 8, companions: { with: 0, of: 8, root: null } }),
    root("src", { files: 40, companions: { with: 40, of: 40, root: "test" } }),
  ];

  const [found] = precedentFindings(["src/__tests__/pages/foo.test.ts"], roots);
  assert.equal(found.area, "src/pages");
});

test("the finding states what was counted, not a conclusion the count cannot carry", () => {
  // A zero is "no namesake matched", and the namesake match is case sensitive,
  // so five Cypress specs named `thing0.cy.js` beside `Thing0.tsx` read as
  // none. The count is true; "there is no test here" would not be.
  const roots = [
    root("src/components", { files: 5, companions: { with: 0, of: 5, root: null } }),
    root("src/utils", { files: 4, companions: { with: 4, of: 4, root: "src/utils/__tests__" } }),
  ];

  const said = noticeFor("src/components/__tests__/Thing5.test.tsx", { roots });

  assert.match(said, /0 with a namesake test/);
  assert.doesNotMatch(said, /No precedent for a test here/);
  assert.match(said, /Nothing here was matched to a test by name/);
});

test("a root recorded for one level says nothing about the subtree beneath it", () => {
  // Measured on react: `packages/react-reconciler/src` reads 0 of 81 while the
  // `__tests__` directly under it holds 78, because the root's record covers
  // the level and its children are roots of their own. All 78 were told the
  // directory holding them had no precedent for a test.
  const roots = [
    root("packages/react-reconciler/src", {
      files: 82,
      companions: { with: 0, of: 81, root: null },
      levelOnly: true,
    }),
    root("packages/react-dom", { files: 40, companions: { with: 40, of: 40, root: "packages/react-dom/src/__tests__" } }),
  ];

  assert.deepEqual(precedentFindings(["packages/react-reconciler/src/__tests__/Activity-test.js"], roots), []);
});

test("a snapshot or a fixture beside a test is not itself one", () => {
  // The name alone admits `Component.test.tsx.snap`, `seed.test.sql` and
  // `tsconfig.test.json`, all measured in the corpus; 42 of react's 461
  // matches were files like these.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  for (const rel of ["spec/mailers/__snapshots__/a.test.tsx.snap", "spec/mailers/seed.test.sql", "spec/mailers/tsconfig.test.json"]) {
    assert.deepEqual(precedentFindings([rel], roots), [], rel);
  }
});

test("a directory that already holds a test is its own precedent, and the nearest there is", () => {
  // Issue 120 asked for both halves and this had only the second: "a test file
  // in a directory holding no other test file, in a repository whose sibling
  // ratio for that kind is 0 of N". A third spec landing beside two that are
  // already there is following them, whatever the root's ratio says.
  const roots = [
    root("src/pages", {
      files: 24,
      companions: { with: 0, of: 24, root: null },
      tests: [{ runner: "vitest", files: 2, sub: "__tests__", under: 2 }],
    }),
    root("src/utils", { files: 4, companions: { with: 4, of: 4, root: "src/utils/__tests__" } }),
  ];
  const holdsTest = (dir) => dir === "src/pages/helpers/__tests__";

  assert.deepEqual(precedentFindings(["src/pages/helpers/__tests__/slug.test.ts"], roots, { holdsTest }), []);
  assert.equal(precedentFindings(["src/pages/Listing/__tests__/nda.test.ts"], roots, { holdsTest }).length, 1);
});

test("the finding names the directory that has nothing in it, which is the signal", () => {
  // "A directory that a change invents is the strongest possible signal of a
  // deviation", and the finding never said which directory that was.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  const [found] = precedentFindings(["spec/mailers/cim_share_mailer_spec.rb"], roots);

  assert.match(found.reason, /^spec\/mailers holds no other test; app\/mailers: 4 files, 0 with a namesake test$/);
});

test("a directory with a habit of its own is not one with no precedent", () => {
  // The floor read from the other side. Two tests that pair with nothing is a
  // directory that has not said anything, and four hundred is one whose habit
  // is simply not namesakes: telling it there is no precedent for a test there
  // is the false half of a true count.
  const roots = [
    root("src/pages", {
      files: 1003,
      companions: { with: 0, of: 1003, root: null },
      tests: [{ runner: "vitest", files: 400, sub: "__tests__", under: 400 }],
    }),
    root("src/utils", { files: 6, companions: { with: 6, of: 6, root: "src/utils/__tests__" } }),
  ];

  assert.deepEqual(precedentFindings(["src/pages/Listing/__tests__/nda.test.ts"], roots), []);
});

test("a test moved into a directory with no precedent carries where it came from", () => {
  // A rename is the same deviation as a fresh write, and git reports it as `R`
  // rather than `A`, so a rule reading only additions let the relocation past.
  const roots = [
    root("app/mailers", { files: 4, companions: { with: 0, of: 4, root: null } }),
    root("app/services", { files: 6, companions: { with: 6, of: 6, root: "spec/services" } }),
  ];

  const [found] = precedentFindings(
    [{ path: "spec/mailers/alpha_mailer_spec.rb", oldPath: "spec/services/alpha_spec.rb" }],
    roots
  );

  assert.equal(found.path, "spec/mailers/alpha_mailer_spec.rb");
  assert.equal(found.oldPath, "spec/services/alpha_spec.rb");
});
