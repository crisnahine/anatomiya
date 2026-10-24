import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, scratch } from "./git-worktrees.mjs";
import { needsPosixSpecialFiles } from "./platform.mjs";
import { privateNames } from "../scripts/private-names.mjs";

/** A committed repository at `dir` holding `files`, a map of path to contents. */
function committed(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** A corpus of one private and one public repository, and the repository checked against it. */
function layout(t, { priv = {}, pub = {}, repo = {} }) {
  const root = scratch(t, "anatomiya-private-");
  const corpus = join(root, "corpus");
  committed(join(corpus, "owner__secret"), { "README.md": "private\n", ...priv });
  committed(join(corpus, "owner__open"), { "README.md": "public\n", ...pub });
  return { corpus, repo: committed(join(root, "repo"), { "README.md": "checked\n", ...repo }), root };
}

test("a name only a private repository shares with this one is reported, with the file that carries it", (t) => {
  const { corpus, repo } = layout(t, {
    priv: { "app/models/order.rb": "class ZebraQuota\n  def common_helper; end\nend\n" },
    pub: { "lib/common.rb": "def common_helper; end\n" },
    repo: { "test/a.test.mjs": "// ZebraQuota and common_helper\n" },
  });

  const { found } = privateNames({ repo, corpus, privates: ["owner__secret"] });

  assert.deepEqual(found, [{ kind: "name", text: "ZebraQuota", files: ["test/a.test.mjs"] }]);
});

test("a path only a private repository holds is reported once, at its longest, and a path a public one holds is not", (t) => {
  // Every segment here is an ordinary word a public repository could hold, so
  // the name pass passes it: what gives the codebase away is the path.
  const { corpus, repo } = layout(t, {
    priv: { "app/services/ledger/sync/fetch.rb": "x\n", "app/models/user.rb": "x\n" },
    pub: { "app/models/user.rb": "x\n", "app/services/ledger/sync/README": "x\n" },
    repo: { "docs/note.md": "Read `app/services/ledger/sync/fetch.rb` and `app/models/user.rb`.\n" },
  });

  const { found } = privateNames({ repo, corpus, privates: ["owner__secret"] });

  assert.deepEqual(found, [{ kind: "path", text: "app/services/ledger/sync/fetch.rb", files: ["docs/note.md"] }]);
});

test("a line copied out of a private repository is reported, wherever a fixture string puts it", (t) => {
  // The copied line holds only ordinary names, so only the line itself gives it
  // away. A line a public repository also holds is the framework's, not theirs.
  const { corpus, repo } = layout(t, {
    priv: {
      "db/migrate/1_add.rb": "class Add\n    add_index :tickets, :status, algorithm: :concurrently\n    t.timestamps null: false, default: nil\nend\n",
    },
    pub: { "db/schema.rb": "class Schema\n  add_index :tickets, :status # algorithm, concurrently\n  t.timestamps null: false, default: nil\n" },
    repo: {
      "test/m.test.mjs":
        'const m = "class Add\\n    add_index :tickets, :status, algorithm: :concurrently\\n    t.timestamps null: false, default: nil\\nend\\n";\n',
    },
  });

  const { found } = privateNames({ repo, corpus, privates: ["owner__secret"] });

  assert.deepEqual(found, [{ kind: "line", text: "add_index :tickets, :status, algorithm: :concurrently", files: ["test/m.test.mjs"] }]);
});

test("a tracked file that a FIFO now stands in for is passed over, not read", needsPosixSpecialFiles, (t) => {
  // Read, a FIFO holds the process until something writes to it, and nothing will.
  const { corpus, repo } = layout(t, {
    priv: { "app/models/stuck.rb": "class StuckQuota\nend\n" },
    repo: { "docs/a.md": "StuckQuota\n" },
  });
  const stuck = join(corpus, "owner__secret", "app/models/stuck.rb");
  rmSync(stuck);
  execFileSync("mkfifo", [stuck]);

  assert.deepEqual(privateNames({ repo, corpus, privates: ["owner__secret"] }).found, []);
});

test("a name, line or path on the accepted list is not reported", (t) => {
  const { corpus, repo } = layout(t, {
    priv: { "app/models/order.rb": "class ZebraQuota\nend\n", "lib/ledger/sync.rb": "x\n" },
    repo: { "docs/a.md": "ZebraQuota sits in lib/ledger/sync.rb\n" },
  });

  const accepted = new Set(["ZebraQuota", "lib/ledger/sync.rb"]);

  assert.deepEqual(privateNames({ repo, corpus, privates: ["owner__secret"], accepted }).found, []);
});

const RUN = join(import.meta.dirname, "..", "scripts", "private-names.mjs");

/** The command's exit code, stdout and stderr. */
const run = (...args) => spawnSync(process.execPath, [RUN, ...args], { encoding: "utf8" });

test("the command exits 1 naming each finding and its files, and 0 once each is accepted", (t) => {
  const { corpus, repo, root } = layout(t, {
    priv: { "app/models/order.rb": "class ZebraQuota\nend\n" },
    repo: { "test/a.test.mjs": "// ZebraQuota\n", "docs/b.md": "ZebraQuota\n" },
  });

  const found = run(corpus, "owner__secret", "--repo", repo);
  assert.equal(found.status, 1, found.stderr);
  assert.equal(found.stdout, "name ZebraQuota: docs/b.md, test/a.test.mjs\n");

  const accept = join(root, "accepted.txt");
  writeFileSync(accept, "ZebraQuota\n");
  const clean = run(corpus, "owner__secret", "--repo", repo, "--accept", accept);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, "");
  assert.match(clean.stderr, /^no name, line or path here is held only by owner__secret\n$/);
});

test("the command refuses a private name the corpus does not hold, and an accepted list kept inside the repository", (t) => {
  // A list tracked here would itself name what it hides.
  const { corpus, repo } = layout(t, {});
  writeFileSync(join(repo, "accepted.txt"), "x\n");

  const missing = run(corpus, "owner__absent", "--repo", repo);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /^the corpus holds no repository named owner__absent\n/);

  const inside = run(corpus, "owner__secret", "--repo", repo, "--accept", join(repo, "accepted.txt"));
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /accepted\.txt sits inside the repository it checks/);

  const bare = run(corpus);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /usage: node scripts\/private-names\.mjs <corpusDir> <private>\.\.\./);
});

test("a repository git cannot list is refused with a sentence, not a stack", (t) => {
  const { corpus, root } = layout(t, {});
  const plain = join(root, "plain");
  mkdirSync(plain);

  const refused = run(corpus, "owner__secret", "--repo", plain);

  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^git cannot list the files of .*plain/);
  assert.doesNotMatch(refused.stderr, /\n\s+at /);
});
