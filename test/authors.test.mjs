import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

import { authorsByFile } from "../lib/authors.mjs";
import { applyGates } from "../lib/reduce.mjs";
import * as scan from "../lib/scan.mjs";

/** A dimension every gate but the author one passes, over `files` of ten sites each. */
const evenly = (files) => ({
  key: "k", claim: "c", precision: "precise",
  applicability: files.length,
  candidates: files.length * 10,
  conforming: files.length * 10,
  effectiveFiles: files.length,
  top: { candidates: 10, conforming: 10 },
  files,
  exceptions: [], moreExceptions: 0,
});

function repo(build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-authors-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "first@t.test");
  git("config", "user.name", "first");
  build(dir, { git, write, author, commit });
  return dir;

  function write(rel, body) {
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

/** The per-file `git log` D5 replaces, kept here as the thing to agree with. */
function perFileAuthors(dir, path) {
  const out = execFileSync("git", ["log", "--no-merges", "--format=%ae", "--", path], {
    cwd: dir,
    encoding: "utf8",
  });
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

const sorted = (set) => [...(set || [])].sort();

test("distinct authors per file come from one pass and match per-file git log", async () => {
  // D5: one pass is 271x faster than per-file calls on an eight-year repository
  // and the two were measured agreeing 99.6% to 100%.
  const dir = repo((d, { write, author, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    write("src/b.ts", "export const b = 1\n");
    commit("init");

    author("second@t.test");
    write("src/a.ts", "export const a = 2\n");
    commit("touch a");

    author("third@t.test");
    write("src/b.ts", "export const b = 2\n");
    write("src/c.ts", "export const c = 1\n");
    commit("touch b and add c");
  });

  const map = await authorsByFile(dir);

  assert.deepEqual(sorted(map.get("src/a.ts")), ["first@t.test", "second@t.test"]);
  assert.deepEqual(sorted(map.get("src/b.ts")), ["first@t.test", "third@t.test"]);
  assert.deepEqual(sorted(map.get("src/c.ts")), ["third@t.test"]);

  for (const path of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
    assert.deepEqual(sorted(map.get(path)), sorted(perFileAuthors(dir, path)), path);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a renamed file keeps the authors of its earlier name", async () => {
  // D5 unions rename chains. Without it a file that changed name looks
  // single-author, and the author gate wrongly refuses a real convention. That
  // was measured on 6.3% of files.
  const dir = repo((d, { git, write, author, commit }) => {
    write("src/old.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n");
    commit("init");

    author("second@t.test");
    git("mv", "src/old.ts", "src/new.ts");
    commit("rename");
  });

  const map = await authorsByFile(dir);

  assert.deepEqual(
    sorted(map.get("src/new.ts")),
    ["first@t.test", "second@t.test"],
    "the author of the file under its old name still counts"
  );
  rmSync(dir, { recursive: true, force: true });
});

test("a file renamed twice keeps the authors of every earlier name", async () => {
  const dir = repo((d, { git, write, author, commit }) => {
    write("src/old.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n");
    commit("init");

    author("second@t.test");
    git("mv", "src/old.ts", "src/mid.ts");
    commit("first rename");

    author("third@t.test");
    git("mv", "src/mid.ts", "src/new.ts");
    commit("second rename");
  });

  const map = await authorsByFile(dir);

  assert.deepEqual(sorted(map.get("src/new.ts")), [
    "first@t.test",
    "second@t.test",
    "third@t.test",
  ]);
  assert.equal(map.has("src/old.ts"), false, "an earlier name is not a key of its own");
  assert.equal(map.has("src/mid.ts"), false, "an earlier name is not a key of its own");
  rmSync(dir, { recursive: true, force: true });
});

test("a path holding a newline keys the map by the path on disk", needsPosixPaths, async () => {
  // The `-z` in D5's one pass. Without it git C-quotes the path and the key no
  // longer matches the corpus, so the file silently loses every author.
  const rel = "src/we\nird.ts";
  const dir = repo((d, { write, author, commit }) => {
    write(rel, "export const w = 1\n");
    commit("init");

    author("second@t.test");
    write(rel, "export const w = 2\n");
    commit("touch");
  });

  const map = await authorsByFile(dir);

  assert.deepEqual(sorted(map.get(rel)), ["first@t.test", "second@t.test"]);
  for (const key of map.keys()) {
    assert.ok(!key.startsWith('"'), `${JSON.stringify(key)} came back C-quoted`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a blobless clone answers without reaching for the network", async (t) => {
  // Inexact rename detection needs blob content to score similarity, and on a
  // --filter=blob:none clone the blobs are not local, so `-M` fetches them from
  // the promisor one round trip at a time. 33 of 35 measured clones are that
  // shape and not one could answer this call: the scan reported "history could
  // not be read", every claim dropped to counts, and the map installed anyway.
  //
  // The promisor is deleted here rather than made slow, because the failure to
  // pin is "this needs the network at all", not "this is slow".
  const origin = repo((d, { git, write, author, commit }) => {
    git("config", "uploadpack.allowFilter", "true");
    write("src/a.ts", "export const a = 1\nexport const b = 2\n");
    commit("one");
    author("second@t.test");
    git("mv", "src/a.ts", "src/b.ts");
    write("src/b.ts", "export const a = 1\nexport const b = 2\nexport const c = 3\n");
    commit("rename and edit, which only inexact detection follows");
  });
  const parent = mkdtempSync(join(tmpdir(), "anatomiya-partial-"));
  const clone = join(parent, "clone");
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
    rmSync(origin, { recursive: true, force: true });
  });
  execFileSync("git", ["clone", "-q", "--filter=blob:none", `file://${origin}`, clone], { stdio: "pipe" });
  rmSync(origin, { recursive: true, force: true });

  const map = await authorsByFile(clone);

  assert.equal(map.error, undefined, `history must read offline: ${map.error}`);
  assert.ok(map.size > 0, "and it must be an answer, not an empty map");
  assert.deepEqual(sorted(map.get("src/b.ts")), ["second@t.test"]);
});

test("a repository with no commits yields an empty map instead of losing the scan", async () => {
  const dir = repo(() => {});

  const map = await authorsByFile(dir);

  assert.equal(map.size, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a directory that is not a repository yields an empty map", async () => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-authors-bare-"));
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n");

  const map = await authorsByFile(dir);

  assert.equal(map.size, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("one commit is one author, and that author's practice is the repository's convention", async () => {
  // A fixed 2 asks a one-author repository for something it cannot supply, so
  // it states nothing on every dimension of every area and its only fix is to
  // hire someone. With one person in the repository there is nobody to
  // disagree, and the other gates are what stand in for the second opinion.
  const dir = repo((d, { write, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/m${i}.ts`, `export const m${i} = ${i}\n`);
    commit("init");
  });

  const map = await authorsByFile(dir);
  const who = new Set();
  for (const set of map.values()) for (const email of set) who.add(email);

  assert.deepEqual([...who], ["first@t.test"]);

  const files = Array.from({ length: 6 }, (_, i) => `src/m${i}.ts`);
  const gated = applyGates(evenly(files), {
    authors: who.size,
    repoAuthors: scan.repoAuthorCount(files.map((rel) => ({ rel })), map),
    areaFileCount: 6,
    areaDirCount: 1,
  });

  assert.equal(gated.ratio, 1);
  assert.equal(gated.authorsRequired, 1);
  assert.equal(gated.directive, true);
  assert.equal(gated.gate, null);
  rmSync(dir, { recursive: true, force: true });
});

test("a second person in the repository restores the two-author requirement", async () => {
  // The bar is lowered only where the repository cannot supply two. Reading the
  // area's own author count instead would pass every single-author area inside
  // a large team, which is the one case the gate was written for.
  const dir = repo((d, { write, author, commit }) => {
    for (let i = 0; i < 6; i++) write(`src/mine/m${i}.ts`, `export const m${i} = ${i}\n`);
    commit("init");

    author("second@t.test");
    write("src/theirs/t.ts", "export const t = 1\n");
    commit("theirs");
  });

  const map = await authorsByFile(dir);
  const files = Array.from({ length: 6 }, (_, i) => `src/mine/m${i}.ts`);
  const corpus = [...files, "src/theirs/t.ts"].map((rel) => ({ rel }));

  assert.equal(scan.repoAuthorCount(corpus, map), 2);

  const gated = applyGates(evenly(files), {
    authors: 1,
    repoAuthors: scan.repoAuthorCount(corpus, map),
    areaFileCount: 7,
    areaDirCount: 1,
  });

  assert.equal(gated.authorsRequired, 2);
  assert.equal(gated.directive, false);
  assert.equal(gated.gate, "authors");
  rmSync(dir, { recursive: true, force: true });
});

test("a bot is not the second author", async () => {
  // A solo public repository with a dependency bot would otherwise read as a
  // two-person team and be blocked forever, which is the same misfire the
  // requirement removes. Measured: the dependabot address is the second-heaviest
  // committer in a 154-author repository on this disk, at 136 commits.
  const authors = new Map([
    ["src/a.ts", new Set(["me@x.test", "49699333+dependabot[bot]@users.noreply.github.com"])],
  ]);
  const files = [{ rel: "src/a.ts" }];

  assert.equal(scan.repoAuthorCount(files, authors), 1);

  // Six files, not three: the evidence gate wants 35 sites before a perfect
  // record may be stated, and this test is about the author bar, not the size.
  const gated = applyGates(evenly(["a", "b", "c", "d", "e", "f"].map((n) => `src/${n}.ts`)), {
    authors: 1,
    repoAuthors: scan.repoAuthorCount(files, authors),
    historyRead: true,
    areaFileCount: 12,
    areaDirCount: 1,
  });

  assert.equal(gated.authorsRequired, 1);
  assert.equal(gated.directive, true);
});

test("someone who only ever touched documentation does not raise the bar", async () => {
  // Counting the whole log returns 2 here and blocks the entire map on a
  // repository with one code author. Measured gap between the two
  // denominators: 15 log authors against 13 who ever touched a counted file on
  // one repository, 154 against 131 on another.
  const authors = new Map([
    ...Array.from({ length: 6 }, (_, i) => [`src/f${i}.ts`, new Set(["first@t.test"])]),
    ["README.md", new Set(["docs@t.test"])],
  ]);
  const files = Array.from({ length: 6 }, (_, i) => ({ rel: `src/f${i}.ts` }));

  assert.equal(scan.repoAuthorCount(files, authors), 1);

  const gated = applyGates(evenly(files.map((f) => f.rel)), {
    authors: 1,
    repoAuthors: scan.repoAuthorCount(files, authors),
    areaFileCount: 6,
    areaDirCount: 1,
  });

  assert.equal(gated.directive, true);
});

test("a merge commit does not add an author", async () => {
  // A merge's author touched no line. Counting them inflates every file the
  // merge carried and lets a release manager satisfy the gate on their own.
  const dir = repo((d, { git, write, author, commit }) => {
    write("src/a.ts", "export const a = 1\n");
    commit("base");

    git("checkout", "-qb", "feature");
    author("second@t.test");
    write("src/a.ts", "export const a = 2\n");
    commit("feature");

    git("checkout", "-q", "main");
    author("third@t.test");
    write("src/side.ts", "export const s = 1\n");
    commit("side");

    author("merger@t.test");
    git("merge", "-q", "--no-ff", "-m", "merge feature", "feature");
  });

  const map = await authorsByFile(dir);

  assert.deepEqual(sorted(map.get("src/a.ts")), ["first@t.test", "second@t.test"]);
  for (const [path, set] of map) {
    assert.ok(!set.has("merger@t.test"), `${path} counts the merge author`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("history git could not read is distinguished from history that is empty", async (t) => {
  // Both give every file zero authors and fail the author gate on every
  // dimension. Buffering the log put an oversize repository in the same silent
  // branch as a repository with no commits: no authors, no claims, no reason.
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-nogit-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));

  const unread = await authorsByFile(outside);
  assert.equal(unread.size, 0);
  assert.match(unread.error, /not a git repository/);

  const empty = repo(() => {});
  const none = await authorsByFile(empty);
  assert.equal(none.size, 0);
  assert.equal(none.error, undefined, "an empty history is an answer, not a failure");
});

test("the log is read off the stream, so history size sets no ceiling", async () => {
  // Buffering capped history at maxBuffer and dropped every author on overflow.
  // What proves the stream parser is that a record spans a stdout chunk, so the
  // output has to clear 64 KB: 40 commits over 200 files is roughly 300 KB,
  // where 400 commits over one file is 12 KB and crosses nothing.
  const FILES = 200;
  const COMMITS = 40;
  const dir = repo((d, { git, write, author }) => {
    for (let i = 0; i < FILES; i++) write(`src/f${i}.ts`, "export const x = 0\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    for (let c = 0; c < COMMITS; c++) {
      author(`dev${c % 7}@t.test`);
      for (let i = 0; i < FILES; i++) write(`src/f${i}.ts`, `export const x = ${c + 1}\n`);
      git("commit", "-qam", `edit ${c}`);
    }
  });

  const authors = await authorsByFile(dir);

  assert.equal(authors.error, undefined);
  assert.equal(authors.size, FILES, "every file came back");
  // Seven rotating authors plus the one that made the initial commit.
  assert.equal(authors.get("src/f0.ts").size, 8);
  assert.equal(authors.get(`src/f${FILES - 1}.ts`).size, 8, "the last file is as complete as the first");
});
