import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { needsShebang } from "./platform.mjs";

import { gitBuffered, gitStreamed, nameStatusReader, parsePorcelainRows, showBlob } from "../plugins/anatomiya/lib/git.mjs";

/** Every row a NUL-delimited name-status listing yields, read as a stream. */
function nameStatusRows(out) {
  const rows = [];
  const onField = nameStatusReader((row) => rows.push(row));
  for (const field of String(out ?? "").split("\0")) onField(field);
  return rows;
}

/**
 * One runner and one record grammar, because four copies of each had drifted:
 * the baseline's runner carried no timeout at all, and three hand-rolled state
 * machines read the same `--name-status -z` output three ways.
 */
/**
 * Removed with retries, and the residue left to the operating system.
 *
 * Half these tests kill the git they started, and Windows holds a directory
 * open as a dying process's cwd. The retries cover the ordinary case, where the
 * child is gone within a few milliseconds; a runner under load can hold it past
 * any budget worth waiting for. What is under test is the walk, so a `rmdir`
 * that will not land must not fail a test that passed. This is the temporary
 * directory, and nothing else in the suite reads it.
 */
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // EBUSY or EPERM from a child that outlived its test.
    }
  });
  return dir;
}

function repo(t) {
  const dir = scratch(t, "anatomiya-git-");

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { dir, git };
}

test("a rename is one record carrying both of its paths", () => {
  // Three NUL fields where everything else has two. Splitting on NUL and
  // pairing blindly reads the old path as a status and shifts every record
  // after it.
  const rows = nameStatusRows("R100\0src/old.ts\0src/new.ts\0M\0src/other.ts\0");

  assert.deepEqual(rows, [
    { status: "R100", from: "src/old.ts", to: "src/new.ts" },
    { status: "M", from: null, to: "src/other.ts" },
  ]);
});

test("a path holding a newline stays one record", () => {
  // Why the grammar is read on NUL and never on newlines: git permits a newline
  // inside a path, and a newline split turns one hostile filename into two.
  const rows = nameStatusRows("A\0src/two\nlines.ts\0");

  assert.deepEqual(rows, [{ status: "A", from: null, to: "src/two\nlines.ts" }]);
});

test("a truncated record is dropped rather than completed with a guess", () => {
  // A byte cap can cut the output mid-record. Emitting the half that arrived
  // would name a file the diff never reported.
  assert.deepEqual(nameStatusRows("M\0src/a.ts\0R100\0src/old.ts\0"), [
    { status: "M", from: null, to: "src/a.ts" },
  ]);
});

test("a call that outruns its timeout answers instead of hanging", async () => {
  // The baseline's runner passed no timeout, so a git that never returns took
  // the scan with it.
  //
  // `hash-object --stdin` blocks reading a stdin nothing writes to, so the
  // timeout is the only thing that can end it and no machine finishes it early.
  // A fast command with a tiny budget is not the same test: it raced, and the
  // CI runner won.
  //
  // Run against a directory this file does not own, and needing no repository,
  // because Windows holds a directory open as a dying process's cwd: the killed
  // git outlived the test that started it and the temp repo would not delete.
  const r = await gitBuffered(tmpdir(), ["hash-object", "--stdin"], { timeout: 250 });

  assert.equal(r.ok, false, "a killed call is not a successful one");
  assert.equal(r.stdout, "", "and it reports no output it did not receive");
});

test("a non-zero exit is reported rather than read as an empty answer", async (t) => {
  // `git merge-base` exits 1 with empty stdout and no stderr when two commits
  // share no ancestor. A caller reading stdout alone passes "" on as a sha.
  const { dir, git } = repo(t);
  git("checkout", "-q", "--orphan", "other");
  writeFileSync(join(dir, "b.ts"), "export const b = 2\n");
  git("add", "-A");
  git("commit", "-qm", "unrelated");

  const r = await gitBuffered(dir, ["merge-base", "other", "main"]);

  assert.equal(r.ok, false);
  assert.notEqual(r.code, 0, "the exit code is what says so");
});

test("a streamed read hands over one field per NUL-delimited record", async (t) => {
  // The streamed entry point exists because `execFile` throws
  // `RangeError: Invalid string length` from inside Node's own exit handler on
  // output that grows with the repository, where no caller can catch it (F6).
  // What crosses this seam is the field split, and nothing above it.
  const { dir } = repo(t);
  const seen = [];

  await gitStreamed(dir, ["ls-files", "-z", "--"], (field) => seen.push(field));

  assert.deepEqual(seen, ["a.ts"]);
});

test("a streamed read that git refused is rejected, not resolved as an empty answer", async (t) => {
  // The whole of F13 and F15: buffering an oversize log put it in the same
  // silent branch as a repository with no commits, and every file came back
  // with no author. A caller that has already been handed some fields has to
  // hear that they were not the answer.
  const { dir } = repo(t);

  await assert.rejects(
    () => gitStreamed(dir, ["ls-tree", "-z", "--name-only", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"], () => {}),
    /not a tree object|exited/
  );
});

test("the last record of an unterminated stream still reaches the caller", async (t) => {
  // `git log --format=...` does not terminate its final record, so a reader
  // that only emits on NUL drops the last commit's author entirely. That is
  // the field the author gate counts.
  const { dir } = repo(t);
  const seen = [];

  await gitStreamed(dir, ["log", "--format=%ae", "--"], (f) => seen.push(f), { terminated: false });

  assert.deepEqual(seen, ["t@t.test\n"]);
});

test("a leftover on a terminated stream is a cut-off record, not a short one", async (t) => {
  // A caller that says its command terminates every record is saying anything
  // left in the buffer at exit is half of one. Handing it over would name a
  // file git never listed. `log --format=` stands in for a cut-off listing here
  // because it reliably ends without a delimiter.
  const { dir } = repo(t);

  await assert.rejects(
    () => gitStreamed(dir, ["log", "--format=%ae", "--"], () => {}),
    /ended mid-record/
  );
});

test("a caller that has seen enough stops the walk rather than reading the rest", async (t) => {
  // Reading to the end and discarding the tail pays for a listing nobody
  // wanted, on the repositories where the listing is largest. No caller stops
  // early today, since B10 removed the corpus cap that used to; the seam keeps
  // it because a bound that cannot end the walk it bounds is not a bound.
  const { dir, git } = repo(t);
  for (const n of ["b.ts", "c.ts", "d.ts"]) writeFileSync(join(dir, n), "export const x = 1\n");
  git("add", "-A");
  git("commit", "-qm", "more");
  const seen = [];

  await gitStreamed(dir, ["ls-files", "-z", "--"], (f) => {
    seen.push(f);
    return false;
  });

  assert.deepEqual(seen, ["a.ts"], "the walk ends on the first refusal");
});

test("a streamed read that never returns is ended by its own timeout", needsShebang, async (t) => {
  // The baseline's runner carried no timeout at all, so a git that stopped
  // answering took the scan with it. A stream cannot be given a byte budget the
  // way a buffered read can, so the clock is the only bound it has.
  //
  // A shim on PATH rather than a real git command, because every git command
  // that blocks does so on a stdin this runner has already closed, and a fast
  // command with a tiny budget races the machine.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });

  await assert.rejects(
    () =>
      gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, {
        timeout: 250,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
    /exited SIG/
  );
});

test("a record that never ends is refused before it reaches V8's string limit", needsShebang, async (t) => {
  // The cap F5 asks for. Both hand-rolled readers grew one buffer until a NUL
  // arrived, so output carrying none of them reached `Invalid string length`
  // from inside the exit handler, which is the failure streaming exists to
  // avoid in the first place.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  writeFileSync(join(bin, "git"), '#!/bin/sh\nhead -c 5000 /dev/zero | tr "\\0" "x"\n', { mode: 0o755 });

  await assert.rejects(
    () =>
      gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, {
        maxFieldBytes: 1024,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
    /one record past 1024 bytes/
  );
});

test("a porcelain record is a two-character status, a space, and the path", () => {
  // The other grammar git prints NUL-delimited, read a fourth time in the
  // check. Slicing three characters off is the whole record format, and
  // getting the offset wrong takes three characters off every filename.
  assert.deepEqual(parsePorcelainRows(" M lib/a.ts\0?? lib/b.ts\0"), [
    { x: " ", y: "M", path: "lib/a.ts", orig: null },
    { x: "?", y: "?", path: "lib/b.ts", orig: null },
  ]);
});

test("a porcelain rename names the file once, not once per path it carries", () => {
  // A rename is followed by its origin as a bare field. Read as another record
  // it counts the rename twice and takes three characters off the old name.
  // The origin is kept, not dropped: it is where the file's committed version
  // lives, and a caller comparing against it otherwise has nothing.
  assert.deepEqual(parsePorcelainRows("R  lib/new.ts\0lib/old.ts\0M  lib/c.ts\0"), [
    { x: "R", y: " ", path: "lib/new.ts", orig: "lib/old.ts" },
    { x: "M", y: " ", path: "lib/c.ts", orig: null },
  ]);
});

test("a porcelain path holding a newline stays one record", () => {
  assert.deepEqual(parsePorcelainRows("A  lib/two\nlines.ts\0").map((r) => r.path), ["lib/two\nlines.ts"]);
});

test("a caller that throws while reading ends the walk instead of hanging it", async (t) => {
  // A throw out of a stream handler leaves the promise pending and the child
  // alive: the scan stops with no error and no exit.
  const { dir } = repo(t);

  await assert.rejects(
    () =>
      gitStreamed(dir, ["ls-files", "-z", "--"], () => {
        throw new Error("the caller could not use this field");
      }),
    /the caller could not use this field/
  );
});

test("a caller that throws on the final unterminated record is answered too", async (t) => {
  // The same hazard as the record loop, in the one branch that runs after the
  // child has closed. Unguarded, the throw escapes as an uncaught exception and
  // the promise never settles: the scan stops with no error and no exit.
  //
  // `log --format=` prints no NUL at all, so the only field this caller sees
  // comes from the close handler.
  const { dir } = repo(t);

  await assert.rejects(
    () =>
      gitStreamed(dir, ["log", "--format=%ae", "--"], () => {
        throw new Error("the caller could not use the last field");
      }, { terminated: false }),
    /the caller could not use the last field/
  );
});

test("a blob past the parser's per-file ceiling is refused without being asked to", async (t) => {
  // The cap used to be applied unconditionally inside this function. Handing it
  // to the caller made the default sixteen times wider, and the one caller that
  // passes no options buffers the whole blob through `execFile`, which is the
  // read F5's byte cap exists to bound.
  const { dir, git } = repo(t);
  writeFileSync(join(dir, "big.ts"), `export const big = "${"x".repeat(5 * 1024 * 1024)}"\n`);
  git("add", "-A");
  git("commit", "-qm", "big");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

  const blob = await showBlob(dir, sha, "big.ts");

  assert.equal(blob.ok, false);
  assert.equal(blob.reason, "over size cap", "and it says which bound refused it");
});

test("a path that has become a directory errors instead of yielding a tree listing", async (t) => {
  // `git show <sha>:<path>` prints a tree listing for a directory, and a caller
  // reading blobs then parses that listing as source. `cat-file blob` asserts
  // the object type, so the two outcomes stay apart.
  const { dir, git } = repo(t);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

  const listing = await showBlob(dir, sha, "");

  assert.equal(listing.ok, false, "the repository root is a tree, not a blob");
});

test("a blob read runs the git its caller pointed at", needsShebang, async (t) => {
  // `showBlob` is shared by the scan and the check, and they do not agree about
  // how long to wait. It can only take the caller's bound if it takes the
  // caller's options at all, and dropping them silently is invisible: the real
  // git answers, just on the wrong clock.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  writeFileSync(join(bin, "git"), '#!/bin/sh\nprintf SHIM\n', { mode: 0o755 });

  const blob = await showBlob(dir, "a".repeat(40), "a.ts", {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.equal(blob.ok, true);
  assert.equal(blob.content.toString("utf8"), "SHIM", "the caller's environment reached the runner");
});

test("a blob read gives up on the clock its caller set, not the scan's", needsShebang, async (t) => {
  // The check runs at review time and gives up on a stalled git sooner than a
  // scan does. This is its most frequent git call, up to two per examined file,
  // so inheriting the scan's 120s bound would hang a review for two minutes a
  // file. The shim outlasts any bound but the one passed here, so the call can
  // only settle if that bound was honoured.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  writeFileSync(join(bin, "git"), "#!/bin/sh\nsleep 300\n", { mode: 0o755 });

  const blob = await showBlob(dir, "a".repeat(40), "a.ts", {
    timeout: 250,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.equal(blob.ok, false, "a killed read is not a successful one");
});

/* --- an argument that reads as an option never reaches git (F5) --- */

test("a repository-controlled value shaped like an option refuses the call", async (t) => {
  // Measured: a tracked file named `--instruction-file-path=.git/config`
  // exfiltrated a secret. `--` neutralises the whole class where git takes it,
  // and `rev-parse`, `cat-file`, `merge-base`, `config` and `status` take none,
  // so the rule is stated from the other side: an argument that looks like an
  // option must be one this tool wrote.
  const { dir } = repo(t);

  const r = await gitBuffered(dir, ["rev-parse", "--upload-pack=touch /tmp/pwned"]);

  assert.equal(r.ok, false);
  assert.match(r.error, /reads as an option/);
  assert.equal(r.stdout, "", "and nothing that looks like an answer");
});

test("the streamed runner refuses the same argument the buffered one does", async (t) => {
  const { dir } = repo(t);

  await assert.rejects(
    () => gitStreamed(dir, ["ls-files", "-z", "--exclude-from=/etc/passwd", "--"], () => true),
    /reads as an option/
  );
});

test("a path that begins with a dash is refused rather than quoted", async (t) => {
  // The corpus already drops these, and this is the layer that makes a
  // predicate somebody forgot fail loudly instead of reaching git.
  const { dir } = repo(t);

  const r = await gitBuffered(dir, ["ls-tree", "-r", "--name-only", "-z", "--not-a-sha", "--"]);

  assert.equal(r.ok, false);
  assert.match(r.error, /reads as an option/);
});

test("every option this tool actually passes is allowed through", async (t) => {
  // The allowlist is a closed set, so it fails in the direction that breaks a
  // real call rather than the one that lets an argument through.
  const { dir } = repo(t);

  for (const args of [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    ["rev-parse", "--is-shallow-repository"],
    ["ls-files", "-z", "--"],
    ["ls-files", "-z", "--others", "--exclude-standard", "--"],
    ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--"],
    ["diff", "--name-only", "-z", "HEAD", "--"],
    ["diff", "--find-renames", "--name-status", "-z", "HEAD..HEAD", "--"],
    ["status", "--porcelain", "-z"],
    ["config", "--get", "user.name"],
    ["log", "-M", "--no-merges", "--name-status", "-z", "--format=%ae", "--"],
    ["log", "-M100%", "--no-merges", "--name-status", "-z", "--format=%ae", "--"],
    ["rev-list", "--max-parents=0", "HEAD"],
    ["-c", "core.quotePath=false", "diff", "--find-renames", "--unified=0", "HEAD", "HEAD"],
  ]) {
    const r = await gitBuffered(dir, args);
    assert.doesNotMatch(r.error || "", /reads as an option/, args.join(" "));
  }
});

test("a git call cannot stop to ask for a credential", async (t) => {
  // A prompt on a terminal nobody is watching is a scan that never returns. The
  // environment refuses instead, which turns a hang into an exit code.
  const { dir } = repo(t);

  const r = await gitBuffered(dir, ["config", "--get", "core.askpass"], { env: process.env });

  assert.equal(typeof r.ok, "boolean");
  assert.equal(process.env.GIT_TERMINAL_PROMPT, undefined, "the parent's environment is untouched");
});

/* --- the listings that grow with the repository are streamed (F6) --- */

test("the grammar does not care how the fields were cut up", () => {
  // What streaming buys is that a record need not arrive whole. Three
  // hand-rolled state machines used to read this output three ways, each with
  // its own note that a rename carries three fields.
  const whole = nameStatusRows("R100\0src/old.ts\0src/new.ts\0M\0src/other.ts\0");

  const rows = [];
  const onField = nameStatusReader((row) => rows.push(row));
  for (const field of ["R100", "src/old.ts", "src/new.ts", "M", "src/other.ts", ""]) onField(field);

  assert.deepEqual(rows, whole);
  assert.equal(rows.length, 2);
});

test("a listing arriving in chunks that split a path is still one record", async () => {
  // What streaming is for: a record does not arrive whole, and a reader that
  // assumes it does names half a file.
  const { nameStatusReader } = await import("../plugins/anatomiya/lib/git.mjs");
  const rows = [];
  const onField = nameStatusReader((row) => rows.push(row));
  for (const field of ["R100", "src/old.ts", "src/new.ts", ""]) onField(field);

  assert.deepEqual(rows, [{ status: "R100", from: "src/old.ts", to: "src/new.ts" }]);
});

test("the tree listing and the range diff answer over a real repository", async (t) => {
  const { filesAt, diffRange, changedSinceWorktree } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir, git } = repo(t);
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  writeFileSync(join(dir, "b.ts"), "export const b = 2\n");
  git("add", "-A");
  git("commit", "-qm", "second");

  assert.deepEqual([...(await filesAt(dir, "HEAD"))].sort(), ["a.ts", "b.ts"]);
  assert.deepEqual([...(await filesAt(dir, first))], ["a.ts"]);

  const range = await diffRange(dir, first, "HEAD");
  assert.deepEqual([...range.changed], ["b.ts"]);
  assert.equal(range.renames.size, 0);

  writeFileSync(join(dir, "a.ts"), "export const a = 99\n");
  assert.deepEqual([...(await changedSinceWorktree(dir, "HEAD"))], ["a.ts"]);
});

test("no read git refused answers as a repository where there was nothing", async (t) => {
  // One rule for all three, and `filesAt` used to be the exception: it answered
  // an empty set, which is a real answer meaning "no files", and the obligation
  // reads that as "no companion exists anywhere". A diff that failed must never
  // read as a branch that changed nothing, and a file list that failed must
  // never read as a commit holding none.
  const { filesAt, diffRange, changedSinceWorktree } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir } = repo(t);
  const absent = "0".repeat(40);

  assert.equal(await filesAt(dir, absent), null);
  assert.equal(await diffRange(dir, absent, "HEAD"), null);
  assert.equal(await changedSinceWorktree(dir, absent), null);
});

test("a rename survives the streamed range diff with both of its paths", async (t) => {
  // E7: at the pinned commit only the old path exists, so both names count as
  // changed and the map is what lets a renamed file find its own baseline.
  const { diffRange } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir, git } = repo(t);
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  git("mv", "a.ts", "moved.ts");
  git("commit", "-qm", "move");

  const range = await diffRange(dir, first, "HEAD");

  assert.equal(range.renames.get("moved.ts"), "a.ts");
  assert.deepEqual([...range.changed].sort(), ["a.ts", "moved.ts"]);
});

test("a tree listing git would not produce is unknown, not empty", async (t) => {
  // F15: a read the check could not perform is reported, never absorbed as an
  // empty answer. An empty tree is a real answer meaning "no files", and the
  // obligation check reads it as "no companion exists anywhere", so every
  // changed producer on the branch becomes a violation that can reach MUST-FIX.
  const { filesAt } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir } = repo(t);

  assert.equal(await filesAt(dir, "0".repeat(40)), null, "an unreadable commit answers nothing");
  assert.equal(await filesAt(dir, "not-a-sha"), null, "and so does a rev it will not take");
  assert.deepEqual([...(await filesAt(dir, "HEAD"))], ["a.ts"], "a real tree still answers");
});
