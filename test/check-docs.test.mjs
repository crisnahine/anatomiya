import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { sitesOwed } from "../scripts/check-docs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const row = (over = {}) => ({ key: "k", counterClaim: null, ...over });

const sites = (over = {}) => ({
  defaults: new Set(["k"]),
  intake: new Map([["k", { key: "k", status: "shipped" }]]),
  dropped: new Set(),
  eligible: new Set(),
  refused: new Set(["k"]),
  ...over,
});

test("a row that reached every site owes nothing", () => {
  assert.deepEqual(sitesOwed(row(), sites()), []);
  assert.deepEqual(sitesOwed(row({ counterClaim: "handlers are named" }), sites({ eligible: new Set(["k"]), refused: new Set() })), []);
});

test("every site the row missed is reported, not the first one", () => {
  // An author misses more than one at a time, and two of the sites fail far
  // from the row. Reporting one per run sends them round the loop per site.
  const owed = sitesOwed(row(), sites({ defaults: new Set(), intake: new Map(), refused: new Set() }));

  assert.deepEqual(owed.map((o) => o.site), [
    "lib/model-defaults.json",
    "docs/dimension-intake.md",
    "test/fixtures/counter-pins.mjs",
  ]);
});

test("a missing model-defaults entry names the seeder as its remedy", () => {
  const owed = sitesOwed(row(), sites({ defaults: new Set() }));

  assert.equal(owed.length, 1);
  assert.equal(owed[0].site, "lib/model-defaults.json");
  assert.match(owed[0].remedy, /npm run defaults:seed/);
});

test("the intake row and the counter pin are never handed a command to run", () => {
  // Both are review gates by decision (G2, C6). Naming a script beside them
  // would read as an offer to generate the decision they exist to force.
  const owed = sitesOwed(row({ counterClaim: "handlers are named" }), sites({ intake: new Map(), eligible: new Set() }));

  assert.equal(owed.length, 2);
  for (const o of owed) assert.doesNotMatch(o.remedy, /npm run/);
});

test("an intake row that does not say shipped is reported", () => {
  const owed = sitesOwed(row(), sites({ intake: new Map([["k", { key: "k", status: "planned" }]]) }));

  assert.equal(owed.length, 1);
  assert.match(owed[0].missing, /planned/);
});

test("a key that ships and is also dropped is reported", () => {
  const owed = sitesOwed(row(), sites({ dropped: new Set(["k"]) }));

  assert.equal(owed.length, 1);
  assert.match(owed[0].missing, /dropped/);
});

test("a row carrying a counter owes ELIGIBLE, and one refusing it owes REFUSED", () => {
  const carrying = sitesOwed(row({ counterClaim: "handlers are named" }), sites({ eligible: new Set(), refused: new Set(["k"]) }));
  assert.equal(carrying.length, 1);
  assert.match(carrying[0].missing, /ELIGIBLE/);

  const refusing = sitesOwed(row(), sites({ refused: new Set() }));
  assert.equal(refusing.length, 1);
  assert.match(refusing[0].missing, /REFUSED/);
});

/**
 * The checker run against a copy of this repository, so a test can break one
 * file and read what the checker says about it.
 *
 * `realpathSync` because the script only runs when `argv[1]` resolves to its
 * own module URL, and macOS hands out temp directories under a symlink: the
 * child would exit 0 having read nothing.
 */
function repoCopy(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-check-docs-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const part of ["lib", "bin", "commands", "docs", "scripts", ".claude-plugin"]) {
    cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  }
  cpSync(join(ROOT, "test", "fixtures"), join(dir, "test", "fixtures"), { recursive: true });
  for (const f of readdirSync(ROOT).filter((f) => f.endsWith(".md"))) cpSync(join(ROOT, f), join(dir, f));
  cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
  return dir;
}

function check(dir) {
  try {
    return { status: 0, output: execFileSync(process.execPath, [join(dir, "scripts", "check-docs.mjs")], { encoding: "utf8", stdio: "pipe" }) };
  } catch (err) {
    return { status: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

/** The one count in `docs/how-it-works.md` this phrasing states, raised by one. */
function bumpCount(dir, phrasing) {
  const path = join(dir, "docs", "how-it-works.md");
  const text = readFileSync(path, "utf8");
  const stated = text.match(phrasing);
  assert.ok(stated, `section 4 states no count matching ${phrasing}`);
  const wrong = stated[0].replace(stated[1], String(Number(stated[1]) + 1));
  writeFileSync(path, text.replace(stated[0], wrong));
  return wrong;
}

test("an untouched copy of this repository passes", (t) => {
  // Every case below breaks one file in a copy. Without this one they would
  // all pass on a copy that was broken from the start.
  const { status, output } = check(repoCopy(t));

  assert.equal(status, 0, output);
  assert.match(output, /docs match the code/);
});

test("a registry key with no model-defaults entry is named, with the seeder as its remedy", (t) => {
  const dir = repoCopy(t);
  const path = join(dir, "lib", "model-defaults.json");
  const table = JSON.parse(readFileSync(path, "utf8"));
  delete table.swallowed_error;
  writeFileSync(path, JSON.stringify(table, null, 2) + "\n");

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /swallowed_error/);
  assert.match(output, /npm run defaults:seed/);
});

test("a shipping count in the walkthrough the registry does not hold fails", (t) => {
  const dir = repoCopy(t);
  const wrong = bumpCount(dir, /(\d+) ship\b/);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, new RegExp(wrong));
});

test("a per-language count in the walkthrough the registry does not hold fails", (t) => {
  const dir = repoCopy(t);
  const wrong = bumpCount(dir, /(\d+) that speak Ruby/);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, new RegExp(wrong));
});

test("the count of type-checked rows is read as a number even spelled as a word", (t) => {
  // Prose spells one row "one". A phrasing nothing parses is a number that
  // drifts silently, which is the whole reason this file exists.
  const dir = repoCopy(t);
  const path = join(dir, "docs", "how-it-works.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("plus the one type-checked row", "plus the two type-checked rows"));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /type-checked/);
});
