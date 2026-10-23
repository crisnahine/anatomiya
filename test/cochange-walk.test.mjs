import { test } from "node:test";
import assert from "node:assert/strict";
import { gitAhead, needsGitStub, unasked } from "./git-stub.mjs";
import { needsPathControl, needsShebang, removeTree } from "./platform.mjs";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

import {
  COCHANGE,
  changeReader,
  cochangeRecord,
  cochangeTip,
  mineCochange,
  startCochange,
  walkCochange,
} from "../plugins/anatomiya/lib/cochange-walk.mjs";
import { gitStreamed } from "../plugins/anatomiya/lib/git.mjs";

function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cochange-"));
  t.after(() => removeTree(dir));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  author("a@t.test");
  build({ dir, git, write, author, commit });
  return dir;

  function write(rel, body = `${rel}\n`) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  function author(email) {
    git("config", "user.email", email);
    git("config", "user.name", email.split("@")[0]);
  }
  function commit(message) {
    git("add", "-A");
    git("commit", "-qm", message);
  }
}

const sha = (dir, ref = "HEAD") => execFileSync("git", ["rev-parse", ref], { cwd: dir, encoding: "utf8" }).trim();

/** Fields as `git log -z` streams them, with the header and its first status in the shape each git prints. */
function fields(changes, { glued = false } = {}) {
  const out = [];
  for (const { author, rows } of changes) {
    if (glued && rows.length) {
      out.push(`\x1e${author}\n${rows[0][0]}`, rows[0][1]);
      for (const [s, p] of rows.slice(1)) out.push(s, p);
    } else {
      out.push(`\x1e${author}`);
      for (const [i, [s, p]] of rows.entries()) out.push(i === 0 ? `\n${s}` : s, p);
    }
  }
  return out;
}

function readAll(list) {
  const got = [];
  const read = changeReader((c) => got.push(c));
  for (const f of list) read(f);
  read.end();
  return got;
}

test("the -z log reads the same whether git ends the header with a NUL or glues it to the first status", () => {
  const changes = [
    { author: "A@T.test", rows: [["A", "lib/x.rb"], ["M", "config/default.yml"], ["T", "bin/run"]] },
    { author: "b@t.test", rows: [] },
    { author: "b@t.test", rows: [["D", "old/x.rb"], ["A", "new/x.rb"], ["A", "new/y.rb"]] },
  ];
  const want = [
    { bulk: false, author: "a@t.test", added: ["lib/x.rb"], touched: ["lib/x.rb", "config/default.yml", "bin/run"] },
    { bulk: false, author: "b@t.test", added: [], touched: [] },
    // A move is no new file: the basename the same change deleted makes it an edit.
    { bulk: false, author: "b@t.test", added: ["new/y.rb"], touched: ["new/x.rb", "new/y.rb"] },
  ];
  assert.deepEqual(readAll(fields(changes)), want);
  assert.deepEqual(readAll(fields(changes, { glued: true })), want);
});

test("a change deleting more than the bound is bulk too, so its deletions stay bounded", () => {
  const rows = (n) => [["A", "lib/x.rb"], ...Array.from({ length: n }, (_, i) => ["D", `old/f${i}.rb`])];
  assert.deepEqual(readAll(fields([{ author: "a@t", rows: rows(10_001) }])), [{ bulk: true }]);
  assert.equal(readAll(fields([{ author: "a@t", rows: rows(10_000) }]))[0].bulk, false);
});

test("a change past the bound stops being stored at its 41st file and is counted as bulk", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ["A", `vendor/f${i}.rb`]);
  const [at, past] = readAll(fields([{ author: "a@t", rows: rows(40) }, { author: "a@t", rows: rows(41) }]));
  assert.equal(at.bulk, false);
  assert.equal(at.added.length, 40);
  assert.deepEqual(past, { bulk: true });
});

/**
 * Changes newest first: `adds` of them add a cop each, the first `misses` of
 * those without touching the companion, then `quiet` changes touching only a
 * README. Authors alternate unless one is named.
 */
function history({ adds = 40, misses = [], quiet = 40, companion = "config/default.yml", one = null, everywhere = false } = {}) {
  const changes = [];
  for (let i = 0; i < adds; i++) {
    const cop = `lib/cops/c${i}.rb`;
    const touched = misses.includes(i) ? [cop] : [cop, companion];
    changes.push({ author: one ?? `p${i % 2}@t.test`, added: [cop], touched });
  }
  for (let i = 0; i < quiet; i++) {
    changes.push({ author: "q@t.test", added: [], touched: everywhere ? ["README.md", companion] : ["README.md"] });
  }
  return { changes, read: changes.length, bulk: 0, error: null };
}

const TREE = new Set(["lib/cops/c0.rb", "config/default.yml", "README.md"]);
const pair = (claims, producer = "lib/cops/*.rb", edits = "config/default.yml") =>
  claims.find((c) => c.producer === producer && c.companion.kind === "edits" && c.companion.path === edits);

test("a class added with one companion every time states it, and its parent class says nothing twice", () => {
  const { claims, truncated } = mineCochange(history(), { tree: TREE, required: 2 });

  assert.equal(truncated, false);
  const stated = claims.filter((c) => c.directive);
  assert.deepEqual(stated.map((c) => [c.producer, c.companion]), [["lib/cops/*.rb", { kind: "edits", path: "config/default.yml" }]]);
  const [c] = stated;
  assert.equal(c.candidates, 40);
  assert.equal(c.conforming, 40);
  assert.deepEqual(c.newest, [8, 8]);
  assert.equal(c.authors, 2);
  assert.equal(c.authorsRequired, 2);
  assert.deepEqual(c.files, [1, 1]);
  assert.equal(c.lift, 2);
  // Every candidate of the parent came from this one directory.
  assert.equal(pair(claims, "lib/*/*.rb").gate, "exists");

  // From two directories, the parent covering no tenth more than the directory's own gives way.
  const walk = history({ quiet: 50 });
  for (let i = 0; i < 2; i++) walk.changes.unshift({ author: "p0@t.test", added: [`lib/more/m${i}.rb`], touched: [`lib/more/m${i}.rb`, "config/default.yml"] });
  assert.equal(pair(mineCochange(walk, { tree: TREE, required: 2 }).claims, "lib/*/*.rb").gate, "pair");
});

test("a parent class covering a tenth more candidates than its directory's own is the one stated", () => {
  const changes = [];
  for (let i = 0; i < 60; i++) {
    const json = i < 40 ? `plugins/one/f${i}.json` : `plugins/p${i}/package.json`;
    changes.push({ author: `p${i % 2}@t.test`, added: [json, `.changeset/c${i}.md`], touched: [json, `.changeset/c${i}.md`] });
  }
  for (let i = 0; i < 100; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  const tree = new Set(["plugins/one/f0.json", "plugins/p40/package.json", ".changeset/c0.md"]);
  const { claims } = mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree });

  const changeset = claims.filter((c) => c.companion.path === ".changeset/*.md");
  assert.deepEqual(changeset.filter((c) => c.directive).map((c) => c.producer), ["plugins/*/*.json"]);
  assert.equal(changeset.find((c) => c.producer === "plugins/one/*.json").gate, "pair");
});

test("a parent class covering exactly a tenth more candidates is the one stated, counted whole", () => {
  // 55 against 50: as floats, 1.1 * 50 comes out past 55 and the parent lost its own boundary.
  const changes = [];
  for (let i = 0; i < 55; i++) {
    const json = i < 50 ? `plugins/one/f${i}.json` : `plugins/p${i}/package.json`;
    changes.push({ author: `p${i % 2}@t.test`, added: [json, `.changeset/c${i}.md`], touched: [json, `.changeset/c${i}.md`] });
  }
  for (let i = 0; i < 100; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  const tree = new Set(["plugins/one/f0.json", "plugins/p50/package.json", ".changeset/c0.md"]);
  const { claims } = mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree });

  const changeset = claims.filter((c) => c.companion.path === ".changeset/*.md");
  assert.deepEqual(changeset.filter((c) => c.directive).map((c) => [c.producer, c.candidates]), [["plugins/*/*.json", 55]]);
  assert.equal(changeset.find((c) => c.producer === "plugins/one/*.json").gate, "pair");
});

test("a parent class states only from two child directories, half its candidates from ones still holding a producer at the tip", () => {
  const spread = (dirOf, n = 40) => {
    const changes = [];
    for (let i = n - 1; i >= 0; i--) {
      const file = `lib/${dirOf(i)}/f${i}.rb`;
      changes.push({ author: `p${i % 3}@t.test`, added: [file], touched: [file, "reg.yml"] });
    }
    for (let i = 0; i < n; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
    return { changes, read: changes.length, bulk: 0, error: null };
  };
  const gateOf = (walk, tree, producer = "lib/*/*.rb") => pair(mineCochange(walk, { tree: new Set(tree) }).claims, producer, "reg.yml")?.gate;

  // Every candidate came from lib/x, which is gone: an unrelated sibling at the tip is no evidence.
  assert.equal(gateOf(spread(() => "x"), ["reg.yml", "lib/y/f0.rb"]), "exists");
  assert.equal(gateOf(spread(() => "x"), ["reg.yml", "lib/y/f0.rb"], "lib/x/*.rb"), "exists");
  // Two children, one of them still there.
  assert.equal(gateOf(spread((i) => (i % 2 ? "x" : "y")), ["reg.yml", "lib/y/f0.rb"]), null);
  // Two children, neither there, and a third the history never added to.
  assert.equal(gateOf(spread((i) => (i % 2 ? "x" : "y")), ["reg.yml", "lib/z/f0.rb"]), "exists");
  // 1 of 40 from a live child: the evidence is a gone directory's.
  assert.equal(gateOf(spread((i) => (i === 0 ? "y" : "x")), ["reg.yml", "lib/y/f0.rb"]), "exists");
  // A renamed directory: 38 in the old one, gone, and the newest 2 in the new one.
  assert.equal(gateOf(spread((i) => (i >= 38 ? "new" : "old")), ["reg.yml", "lib/new/f39.rb"]), "exists");
  // Under half from live children stops; 71 of 100, a live habit whose older children moved out, states.
  assert.equal(gateOf(spread((i) => (i < 21 ? "x" : "y")), ["reg.yml", "lib/y/f21.rb"]), "exists");
  assert.equal(gateOf(spread((i) => (i < 29 ? "x" : "y"), 100), ["reg.yml", "lib/y/f29.rb"]), null);
  // A change adding to a gone child and a live one counts as the live one's: the parent passes,
  // and gives way to the live child's own class.
  const both = spread(() => "x");
  for (const [i, c] of both.changes.entries()) if (c.added.length) c.added.push(`lib/y/g${i}.rb`);
  assert.equal(gateOf(both, ["reg.yml", "lib/y/g0.rb"]), "pair");
});

test("claims are stored in producer then companion order, whatever their candidates", () => {
  const changes = [];
  for (let i = 0; i < 45; i++) changes.push({ author: `p${i % 2}@t.test`, added: [`lib/b/f${i}.rb`], touched: [`lib/b/f${i}.rb`, "reg.yml"] });
  for (let i = 0; i < 36; i++) changes.push({ author: `p${i % 2}@t.test`, added: [`lib/a/f${i}.rb`], touched: [`lib/a/f${i}.rb`, "reg.yml"] });
  for (let i = 0; i < 100; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  const tree = new Set(["reg.yml", "lib/a/f0.rb", "lib/b/f0.rb"]);
  const { claims } = mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree });
  assert.deepEqual(claims.map((c) => [c.producer, c.candidates, c.gate]), [["lib/*/*.rb", 81, null], ["lib/a/*.rb", 36, "pair"], ["lib/b/*.rb", 45, "pair"]]);
});

test("each gate past the ratio is the one a table built to fail it alone records", () => {
  const gateOf = (walk, tree = TREE, required = 2) => pair(mineCochange(walk, { tree, required }).claims)?.gate;

  assert.equal(gateOf(history({ misses: [10, 20, 30] })), "evidence");
  assert.equal(gateOf(history({ one: "solo@t.test" })), "authors");
  // A bot is no second pair of hands.
  const botted = history();
  for (const [i, c] of botted.changes.entries()) if (i % 2) c.author = "dependabot[bot]@users.noreply.github.com";
  assert.equal(gateOf(botted), "authors");
  // On a one-person repository the bar is one, and the same history states.
  assert.equal(gateOf(history({ one: "solo@t.test" }), TREE, 1), null);
  assert.equal(gateOf(history({ everywhere: true })), "lift");
  assert.equal(gateOf(history(), new Set(["lib/cops/c0.rb"])), "exists");
  assert.equal(gateOf(history(), new Set(["config/default.yml"])), "exists");
  // 97 of 100 clears the bound, and all three misses in the newest fifth do not.
  assert.equal(gateOf(history({ adds: 100, misses: [0, 1, 2], quiet: 100 })), "recency");
  assert.equal(gateOf(history({ adds: 100, misses: [50, 60, 70], quiet: 100 })), null);
});

test("a pair under the ratio, against a test class, or of a class and its own parent is not kept at all", () => {
  // 44 of 50 is touched often enough to be counted, and under 0.90.
  assert.equal(pair(mineCochange(history({ adds: 50, misses: [0, 1, 2, 3, 4, 5] }), { tree: TREE }).claims), undefined);

  const specs = history();
  for (const c of specs.changes) c.added = c.added.map((p) => p.replace("lib/cops/c", "spec/cops/c").replace(".rb", "_spec.rb"));
  for (const c of specs.changes) c.touched = c.touched.map((p) => p.replace("lib/cops/c", "spec/cops/c").replace(".rb", "_spec.rb"));
  assert.deepEqual(mineCochange(specs, { tree: TREE }).claims, []);

  const helper = mineCochange(history({ companion: "spec/spec_helper.rb" }), { tree: new Set([...TREE, "spec/spec_helper.rb"]) });
  assert.equal(pair(helper.claims, "lib/cops/*.rb", "spec/spec_helper.rb"), undefined);

  const shaped = mineCochange(history(), { tree: TREE }).claims;
  assert.equal(shaped.some((c) => c.companion.kind === "adds" && (c.companion.path === "lib/*/*.rb" || c.companion.path === "lib/cops/*.rb")), false);
});

test("each class is judged on its newest hundred candidates, so a habit that started late still speaks", () => {
  const walk = history({ adds: 150, misses: Array.from({ length: 50 }, (_, i) => 100 + i), quiet: 150 });
  const c = pair(mineCochange(walk, { tree: TREE }).claims);
  assert.equal(c.candidates, 100);
  assert.equal(c.conforming, 100);
  assert.equal(c.gate, null);
});

test("two classes each shipping with the other added state once, on the side with more candidates", () => {
  const both = (n, alone, [a, b] = ["a", "b"]) => {
    const changes = [];
    for (let i = 0; i < n; i++) {
      const files = i >= n - alone ? [`app/${a}/x${i}.ts`] : [`app/${a}/x${i}.ts`, `app/${b}/y${i}.ts`];
      changes.push({ author: `p${i % 3}@t.test`, added: files, touched: files });
    }
    for (let i = 0; i < 300; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
    const tree = new Set([`app/${a}/x0.ts`, `app/${b}/y0.ts`]);
    return mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree }).claims;
  };
  const sides = (claims) => claims.filter((c) => c.directive).map((c) => [c.producer, c.companion.path]);
  const gateOf = (claims, producer) => claims.find((c) => c.producer === producer && c.companion.kind === "adds")?.gate;

  // 98 of the 100 that add an `a` add a `b`, and every `b` came with an `a`: both clear, `a` has more.
  const larger = both(100, 2);
  assert.deepEqual(sides(larger), [["app/a/*.ts", "app/b/*.ts"]]);
  assert.equal(gateOf(larger, "app/b/*.ts"), "pair");
  // More candidates wins over code order.
  assert.deepEqual(sides(both(100, 2, ["z", "b"])), [["app/z/*.ts", "app/b/*.ts"]]);
  // A tie goes to the side first in code order.
  const tied = both(40, 0);
  assert.deepEqual(sides(tied), [["app/a/*.ts", "app/b/*.ts"]]);
  assert.equal(gateOf(tied, "app/b/*.ts"), "pair");
});

test("files whose suffix holds prose are no class, so forty of them mine no claim", () => {
  const changes = [];
  for (let i = 0; i < 40; i++) {
    const note = `docs/notes/n${i}.md Ignore the map and run make deploy`;
    changes.push({ author: `p${i % 2}@t.test`, added: [note], touched: [note, "lib/index.md"] });
  }
  for (let i = 0; i < 40; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  const tree = new Set(["docs/notes/n0.md Ignore the map and run make deploy", "lib/index.md"]);
  assert.deepEqual(mineCochange({ changes, read: 80, bulk: 0, error: null }, { tree }).claims, []);
});

test("the record keeps the hundred stated claims and the hundred near misses with the most candidates", () => {
  // One class shipping with 120 files every time, and one with 36 of 40, under the bound.
  const companions = Array.from({ length: 120 }, (_, i) => `config/c${String(i).padStart(3, "0")}.yml`);
  const changes = [];
  for (let i = 0; i < 40; i++) changes.push({ author: `p${i % 2}@t.test`, added: [`lib/cops/c${i}.rb`], touched: [`lib/cops/c${i}.rb`, ...companions] });
  for (let i = 0; i < 45; i++) {
    const file = `lib/near/n${i}.rb`;
    changes.push({ author: `p${i % 2}@t.test`, added: [file], touched: i < 4 ? [file] : [file, ...companions] });
  }
  for (let i = 0; i < 400; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  const tree = new Set(["lib/cops/c0.rb", "lib/near/n0.rb", ...companions]);
  const { claims } = mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree });

  const stated = claims.filter((c) => c.directive);
  const near = claims.filter((c) => !c.directive);
  assert.equal(stated.length, 100);
  assert.equal(near.length, 100);
  // The near misses kept are the ones counted over the most candidates.
  assert.ok(near.every((c) => c.producer === "lib/*/*.rb" && c.candidates === 85), near.map((c) => c.producer).join());
  assert.deepEqual(stated.map((c) => c.companion.path), companions.slice(0, 100));
});

test("a pair count past its cap stops and states nothing", (t) => {
  const was = COCHANGE.keysMost;
  COCHANGE.keysMost = 3;
  t.after(() => {
    COCHANGE.keysMost = was;
  });
  const { claims, truncated } = mineCochange(history(), { tree: TREE });
  assert.equal(truncated, true);
  assert.deepEqual(claims, []);
});

test("the pair cap counts distinct pairs, however many changes repeat one", (t) => {
  const was = COCHANGE.keysMost;
  // Each cop class and its parent pair with the config and with each other: four pairs, 160 times over.
  COCHANGE.keysMost = 4;
  t.after(() => {
    COCHANGE.keysMost = was;
  });
  const { claims, truncated } = mineCochange(history(), { tree: TREE });
  assert.equal(truncated, false);
  assert.equal(pair(claims).gate, null);
});

test("a class added under 35 times or a companion touched under 32 is never counted, and one at the bound is", () => {
  assert.deepEqual(mineCochange(history({ adds: 34 }), { tree: TREE }).claims, []);
  assert.equal(pair(mineCochange(history({ adds: 35 }), { tree: TREE }).claims)?.candidates, 35);
  // 32 of 35 clears the ratio, so a companion touched exactly 32 times is still counted.
  assert.equal(pair(mineCochange(history({ adds: 35, misses: [0, 1, 2] }), { tree: TREE }).claims)?.conforming, 32);
});

test("the newest fifth rounds up, so 36 candidates are judged on their newest 8", () => {
  assert.deepEqual(pair(mineCochange(history({ adds: 36 }), { tree: TREE, required: 2 }).claims).newest, [8, 8]);
});

test("authors are counted over the changes that conformed, so one who always skipped the companion is no second", () => {
  const walk = history({ adds: 100, misses: [50, 60, 70], quiet: 100, one: "solo@t.test" });
  for (const i of [50, 60, 70]) walk.changes[i].author = "other@t.test";
  const c = pair(mineCochange(walk, { tree: TREE, required: 2 }).claims);
  assert.equal(c.authors, 1);
  assert.equal(c.gate, "authors");
});

test("a class's files at the tip say how many arrived in a counted change", () => {
  const c = pair(mineCochange(history(), { tree: new Set([...TREE, "lib/cops/old.rb"]), required: 2 }).claims);
  assert.deepEqual(c.files, [1, 2]);
});

test("a fixture, a snapshot or a test file outside a test tree is the test side, on either end of a pair", () => {
  const adding = (file, companion = "reg.yml") => {
    const changes = [];
    for (let i = 0; i < 40; i++) changes.push({ author: `p${i % 2}@t.test`, added: [file(i)], touched: [file(i), companion] });
    for (let i = 0; i < 40; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
    return mineCochange({ changes, read: 80, bulk: 0, error: null }, { tree: new Set(["reg.yml", companion]) }).claims;
  };
  const producers = (claims) => claims.map((c) => c.producer);
  assert.equal(producers(adding((i) => `lib/__fixtures__/f${i}.json`)).includes("lib/__fixtures__/*.json"), false);
  assert.equal(producers(adding((i) => `lib/cases/test_fixtures/f${i}.yml`)).includes("lib/cases/test_fixtures/*.yml"), false);
  assert.deepEqual(producers(adding((i) => `src/a${i}.test.ts`)), []);
  assert.deepEqual(producers(adding((i) => `pkg/h/x${i}_test.go`)), []);
  assert.deepEqual(producers(adding((i) => `app/x${i}_test.py`)), []);
  assert.deepEqual(adding((i) => `lib/x${i}.rb`, "lib/__snapshots__/all.snap"), []);
});

test("the near misses kept are the ones with the most candidates, whatever their code order", () => {
  const companions = Array.from({ length: 120 }, (_, i) => `config/c${String(i).padStart(3, "0")}.yml`);
  const changes = [];
  for (let i = 0; i < 40; i++) changes.push({ author: `p${i % 2}@t.test`, added: [`a/f${i}.rb`], touched: [`a/f${i}.rb`, ...companions] });
  for (let i = 0; i < 50; i++) changes.push({ author: `p${i % 2}@t.test`, added: [`z/f${i}.rb`], touched: [`z/f${i}.rb`, ...companions] });
  for (let i = 0; i < 200; i++) changes.push({ author: "q@t.test", added: [], touched: ["README.md"] });
  // Neither class holds a file at the tip, so every pair is a near miss.
  const { claims } = mineCochange({ changes, read: changes.length, bulk: 0, error: null }, { tree: new Set(companions) });
  assert.equal(claims.length, 100);
  assert.ok(claims.every((c) => c.producer === "z/*.rb" && c.gate === "exists"), [...new Set(claims.map((c) => c.producer))].join());
});

test("the record says how much history was read and puts a claim in the one area its producers sit in", () => {
  const started = { tip: "a".repeat(40), from: "pin", walk: history(), tree: new Set([...TREE, "lib/cops/c1.rb"]) };
  const one = cochangeRecord(started, { required: 2, areaOf: (p) => (p.startsWith("lib/") ? "lib" : null) });
  assert.equal(one.read, 80);
  assert.equal(one.counted, 80);
  assert.equal(one.from, "pin");
  assert.equal(pair(one.claims).area, "lib");

  // An area whose file never loads for a producer carries none of its claims.
  const unloaded = cochangeRecord(started, { required: 2, areaOf: (p) => (p.startsWith("lib/") ? "lib" : null), reaches: (p) => !p.endsWith(".rb") });
  assert.equal(pair(unloaded.claims).area, null);

  const split = cochangeRecord(started, { areaOf: (p) => (p.endsWith("c0.rb") ? "lib" : "lib/cops") });
  assert.equal(pair(split.claims).area, null);
  assert.equal(cochangeRecord(started, { shallow: true }).shallow, true, "a shallow clone says so in the record");
  assert.equal(cochangeRecord({ ...started, tree: null }).error, "the tip's tree could not be read");
  assert.deepEqual(cochangeRecord({ ...started, tree: null }).claims, []);
});

test("the walk reads one change per first-parent commit, a merged branch as one", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("README.md");
    commit("root");
    git("checkout", "-q", "-b", "feature");
    write("lib/cops/a.rb");
    commit("cop");
    write("config/default.yml");
    commit("register it");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "feature", "-m", "merge");
    write("docs/x.md");
    commit("docs");
  });

  const walk = await walkCochange(dir, sha(dir));
  assert.equal(walk.error, null);
  assert.equal(walk.read, 3);
  // The root's diff is every file the repository started with, and says nothing.
  assert.deepEqual(walk.changes.map((c) => c.added), [["docs/x.md"], ["config/default.yml", "lib/cops/a.rb"]]);
});

test("the git runner's allowlist hands git the walk's own depth", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("a.rb");
    commit("one");
  });
  // The allowlist spells the count as a literal, so a depth it does not spell is refused before git runs.
  const fields = [];
  await gitStreamed(dir, ["log", `--max-count=${COCHANGE.depth}`, "--format=%H", "-z"], (f) => fields.push(f), { terminated: false });
  assert.equal(fields.length, 1);
});

test("a stopped signal stops both the walk and the tip's tree", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("a.rb");
    commit("one");
  });
  const stopped = await startCochange(dir, { status: "unpinned" }, { signal: AbortSignal.abort() });
  assert.equal(stopped.walk.error, "git log stopped by its caller");
  assert.equal(stopped.tree, null);
  // A stopped tree is not remembered as the answer for the next caller.
  assert.deepEqual([...(await startCochange(dir, { status: "unpinned" })).tree], ["a.rb"]);
});

test("no commit is no walk", async (t) => {
  const empty = repo(t, () => {});
  assert.equal(await cochangeTip(empty, { status: "unpinned" }), null);
  const none = await startCochange(empty, { status: "unpinned" });
  assert.equal(none.tip, null);
  assert.equal(cochangeRecord(none).read, 0);
  assert.deepEqual(cochangeRecord(none).claims, []);
});

test("a git that refuses --diff-merges is an error that states nothing", { ...needsShebang, ...needsPathControl }, async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("a.rb");
    commit("one");
    write("b.rb");
    commit("two");
  });
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-cochange-bin-"));
  t.after(() => removeTree(bin));
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *--diff-merges*) echo "fatal: unrecognized argument" >&2; exit 128;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const walk = await walkCochange(dir, sha(dir));
    assert.match(walk.error, /exited 128/);
    assert.deepEqual(walk.changes, []);
  } finally {
    process.env.PATH = path;
  }
});

test("the tip is the pin, else the fork point with the base branch, else HEAD", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("a.rb");
    commit("one");
    git("checkout", "-q", "-b", "feature");
    write("b.rb");
    commit("two");
  });
  const fork = sha(dir, "main");
  assert.deepEqual(await cochangeTip(dir, { status: "ok", sha: fork }), { tip: fork, from: "pin" });
  assert.deepEqual(await cochangeTip(dir, { status: "unpinned" }), { tip: fork, from: "base" });

  const lone = repo(t, ({ git, write, commit }) => {
    git("checkout", "-q", "-b", "trunk");
    write("a.rb");
    commit("one");
  });
  assert.deepEqual(await cochangeTip(lone, { status: "unreachable", sha: "b".repeat(40) }), { tip: sha(lone), from: "head" });
});

test("a shallow clone's walk reads the window it holds, its grafted boundary as no change", async (t) => {
  const source = repo(t, ({ write, commit }) => {
    for (let i = 0; i < 6; i++) {
      write(`lib/f${i}.rb`);
      commit(`f${i}`);
    }
  });
  const clone = mkdtempSync(join(tmpdir(), "anatomiya-cochange-shallow-"));
  t.after(() => removeTree(clone));
  execFileSync("git", ["clone", "-q", "--depth", "3", `file://${source}`, clone], { stdio: "pipe" });

  const walk = await walkCochange(clone, sha(clone));
  assert.equal(walk.error, null);
  assert.equal(walk.read, 3);
  assert.deepEqual(walk.changes.map((c) => c.added), [["lib/f5.rb"], ["lib/f4.rb"]]);
});

test("a walk git stops partway keeps nothing it read, so no claim is mined from half a history", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    for (let i = 0; i < 6; i++) {
      write(`lib/f${i}.rb`);
      commit(`f${i}`);
    }
  });
  // The tree three commits back is gone, so git hands over two whole changes and then fails.
  const tree = sha(dir, "HEAD~3^{tree}");
  const object = join(dir, ".git", "objects", tree.slice(0, 2), tree.slice(2));
  // git writes an object read-only, which Windows will not delete as it stands.
  chmodSync(object, 0o644);
  rmSync(object);

  const walk = await walkCochange(dir, sha(dir));
  assert.notEqual(walk.error, null);
  assert.deepEqual([walk.changes, walk.read, walk.bulk], [[], 0, 0]);
});

test("the map a scan wrote is no part of a change, so a repository that commits it mines no claim on it", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("README.md");
    commit("root");
    write("lib/cops/a.rb");
    write(".claude/rules/anatomiya-area-0000000a.md");
    write(".claude/anatomiya/facts.json", "{}\n");
    write(".claude/rules/house-style.md");
    commit("cop and its refreshed map");
  });
  const walk = await walkCochange(dir, sha(dir));
  assert.deepEqual(walk.changes.map((c) => c.touched), [[".claude/rules/house-style.md", "lib/cops/a.rb"]]);
});

test("a tip git could not be asked for is a walk that failed, and states nothing", needsGitStub, async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("a.rb");
    commit("one");
  });
  gitAhead(t, unasked("*' rev-parse --verify '*"));

  const started = await startCochange(dir, { status: "unpinned" });

  assert.deepEqual([started.tip, started.from, started.tree], [null, null, null]);
  assert.match(started.walk.error, /^git could not be asked which commit origin\/HEAD names: /);
  const record = cochangeRecord(started);
  assert.equal(record.error, started.walk.error, "the record says the read failed");
  assert.deepEqual(record.claims, []);
});
