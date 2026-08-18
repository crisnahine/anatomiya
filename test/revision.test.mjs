import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { readAtRevision } from "../lib/revision.mjs";
import { MAX_FILE_BYTES } from "../lib/limits.mjs";

// Torn down through `t.after` rather than a call at the end of the body: a
// failing assertion throws, and a cleanup line below it never runs.
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-revision-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  build(dir, { git, write, commit });
  return dir;

  function write(rel, body) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  function commit(msg) {
    git("add", "-A");
    git("commit", "-qm", msg);
    return git("rev-parse", "HEAD").trim();
  }
}

const FIRST = "export const n = 1\n";
const SECOND = "export const n = 2\n";

test("a path is read at the revision it was asked for, not at HEAD", async (t) => {
  let first;
  const dir = repo(t, (d, { write, commit }) => {
    write("a.js", FIRST);
    first = commit("first");
    write("a.js", SECOND);
    commit("second");
    writeFileSync(join(d, "a.js"), "export const n = 3\n");
  });

  const out = await readAtRevision(dir, first, [{ rel: "a.js" }], { withSource: true });
  t.after(out.dispose);

  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].source, FIRST, "the blob at that commit, not the later one and not the tree");
  assert.equal(readFileSync(out.files[0].abs, "utf8"), FIRST, "and the same bytes on disk");
  assert.equal(out.files[0].lang, "js", "the language falls back to the path's");
  assert.deepEqual(out.missing, []);
});

test("the language the caller names is the one that comes back", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("a.js", FIRST);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [{ rel: "a.js", lang: "jsx" }]);
  t.after(out.dispose);

  assert.equal(out.files[0].lang, "jsx");
});

test("a path that will not come back is named with the reason, not silently dropped", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("a.js", FIRST);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [
    { rel: "a.js" },
    { rel: "gone.js" },
    { rel: "../escape.js" },
    { rel: "/etc/passwd" },
    { rel: "" },
    null,
  ], { withSource: true });
  t.after(out.dispose);

  assert.deepEqual(out.files.map((f) => f.rel), ["a.js"]);
  assert.equal(out.missing.find((m) => m.rel === "gone.js").reason, "absent");
  assert.deepEqual(
    out.missing.map((m) => m.reason).sort(),
    ["absent", "unsafe path", "unsafe path", "unsafe path", "unsafe path"],
  );
  // An absolute rel resolves away from the temporary root without ever passing
  // through "..", so a prefix check on the joined string is not the guard.
  assert.ok(out.missing.some((m) => m.rel === "/etc/passwd"));
  assert.ok(out.missing.some((m) => m.rel === null), "a malformed entry is reported, not thrown on");
});

test("the bound git refused the blob under is the reason that comes back", async (t) => {
  // A real file past the cap rather than a cap narrowed for the test: the read
  // gives up at exactly the size the parser skips at, so no caller sets it and
  // a knob that only a test turns is one nothing production holds.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("big.js", `export const big = "${"x".repeat(MAX_FILE_BYTES)}"\n`);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [{ rel: "big.js" }]);
  t.after(out.dispose);

  assert.deepEqual(out.files, []);
  assert.deepEqual(out.missing, [{ rel: "big.js", reason: "over size cap" }]);
});

test("dispose removes the temporary tree", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("a.js", FIRST);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [{ rel: "a.js" }]);
  assert.equal(existsSync(out.dir), true);

  out.dispose();
  assert.equal(existsSync(out.dir), false, "the temporary tree does not outlive dispose");
});

test("the source is held only where the caller asked for it", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("a.js", FIRST);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [{ rel: "a.js" }]);
  t.after(out.dispose);

  // The baseline pass holds a whole population at once and needs none of the
  // bytes in the parent, so the key is absent rather than null.
  assert.equal("source" in out.files[0], false);
  assert.equal(readFileSync(out.files[0].abs, "utf8"), FIRST);
});

test("every path comes back, sorted, however few readers ran at once", async (t) => {
  const rels = Array.from({ length: 20 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    for (const rel of rels) write(rel, `export const n = "${rel}"\n`);
    sha = commit("first");
  });

  const out = await readAtRevision(dir, sha, [...rels].reverse().map((rel) => ({ rel })), {
    concurrency: 4,
    withSource: true,
  });
  t.after(out.dispose);

  assert.deepEqual(out.files.map((f) => f.rel), rels, "answered in path order, not in the order they finished");
  assert.deepEqual(out.missing, []);
  for (const f of out.files) assert.equal(f.source, `export const n = "${f.rel}"\n`, f.rel);
  // The directory the path names is rebuilt under the temporary root rather
  // than flattened, so two files sharing a basename cannot overwrite each other.
  assert.ok(out.files[0].abs.endsWith(join("src", "f00.js")));
});
