import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINCIPLES, principleKeys } from "../plugins/anatomiya/lib/principles.mjs";

test("no tests and no helper root ground nothing", () => {
  assert.deepEqual(principleKeys({ tests: [], roots: [{ helpers: null }] }), []);
});

test("tests with no helper root ground test shape alone", () => {
  const layout = { tests: [{ runner: "node:test", root: "test", files: 4 }], roots: [{ helpers: null }] };
  assert.deepEqual(principleKeys(layout), ["test_shape"]);
});

test("tests and a measured helper root ground both, table order", () => {
  const layout = {
    tests: [{ runner: "node:test", root: "test", files: 4 }],
    roots: [{ helpers: null }, { helpers: { extracted: 2 } }],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape", "granularity"]);
});

test("every key the record stores is one the renderer can look a sentence up by", () => {
  // The record carries keys and the section prints sentences, so a key nothing
  // in the table answers renders as a dropped line nobody sees go missing.
  const layout = {
    tests: [{ runner: "node:test", root: "test", files: 4 }],
    roots: [{ helpers: { extracted: 2 } }],
  };

  const known = PRINCIPLES.map((p) => p.key);
  for (const key of principleKeys(layout)) assert.ok(known.includes(key), `${key} is in no table row`);
  for (const p of PRINCIPLES) assert.ok(p.sentence, `${p.key} has no sentence to print`);
});

test("a directory with producers and no tests grounds the line that settles the conflict", () => {
  // The counted fact and a testing skill's Iron Law read in the same voice, and
  // the imperative wins because one is phrased as data and the other as an
  // instruction. The line appears only where such a directory exists (H38).
  const layout = {
    tests: [{ runner: "rspec", root: "spec", files: 6 }],
    roots: [
      { helpers: null, companions: { with: 6, of: 6, root: "spec/services" } },
      { helpers: null, companions: { with: 0, of: 4, root: null } },
    ],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape", "test_precedent"]);
  const line = PRINCIPLES.find((p) => p.key === "test_precedent").sentence;
  assert.match(line, /does not override a directory with no test precedent/);
});

test("a repository whose every directory is tested is not told about precedent", () => {
  const layout = {
    tests: [{ runner: "rspec", root: "spec", files: 6 }],
    roots: [{ helpers: null, companions: { with: 6, of: 6, root: "spec/services" } }],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape"]);
});

test("one or two untested files is a directory that has not spoken", () => {
  const layout = {
    tests: [{ runner: "rspec", root: "spec", files: 6 }],
    roots: [
      { helpers: null, companions: { with: 6, of: 6, root: "spec/services" } },
      { helpers: null, companions: { with: 0, of: 2, root: null } },
    ],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape"]);
});

test("a repository that pairs no tests anywhere is not told its pairing is missing here", () => {
  // Five Cypress specs beside five components read 0 of 5, because the namesake
  // matcher cannot pair Thing0.tsx with thing0.spec.js. A zero there means no
  // namesake was matched, never that the directory is untested, so the line
  // needs a repository that does pair tests somewhere before it can say this
  // directory does not.
  const layout = {
    tests: [{ runner: "cypress", root: "cypress/integration", files: 5 }],
    roots: [
      { helpers: null, companions: { with: 0, of: 5, root: null } },
      { helpers: null },
    ],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape"]);
});

test("a directory with one or two namesakes among many producers grounds the line too", () => {
  // The same floor the finding holds: one namesake in 517 files is not a
  // directory with a test habit, so the conflict the line settles is there.
  const layout = {
    tests: [{ runner: "vitest", root: "src", files: 6 }],
    roots: [
      { companions: { with: 4, of: 60 } },
      { companions: { with: 1, of: 517 } },
    ],
  };
  assert.ok(principleKeys(layout).includes("test_precedent"));
  layout.roots[1].companions.with = 3;
  assert.ok(!principleKeys(layout).includes("test_precedent"));
});

test("a repository whose only pairing is one or two namesakes is not told about precedent", () => {
  // The first conjunct reads the floor too, the way the finding's
  // repository-wide guard does: one pair is not yet a practice to depart from.
  const layout = {
    tests: [{ runner: "vitest", root: "src", files: 2 }],
    roots: [{ companions: { with: 2, of: 60 } }, { companions: { with: 0, of: 40 } }],
  };
  assert.ok(!principleKeys(layout).includes("test_precedent"));
});
