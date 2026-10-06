import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { needsShebang } from "./platform.mjs";

import { check } from "../plugins/anatomiya/lib/check.mjs";
import {
  caseMagic, changedSinceWorktree, commitAt, diffRange, filesAt, gitBuffered, gitStreamed, headSha, isSha, mergeBase,
  nameStatusReader, parsePorcelainRows, shaReachable, showBlob,
} from "../plugins/anatomiya/lib/git.mjs";

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

function repo(t, env) {
  const dir = scratch(t, "anatomiya-git-");

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe", env });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { dir, git };
}

test("a repository's own config cannot make a status run a command", needsShebang, async (t) => {
  // A repository shipped as a tarball carries its own `.git/config`, and
  // `core.fsmonitor` there names a command `git status` runs. Measured: before
  // the environment turned it off, a status through gitBuffered ran the script.
  const { dir, git } = repo(t);
  const marker = join(dir, "ran");
  const hook = join(dir, "monitor.sh");
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
  chmodSync(hook, 0o755);
  git("config", "core.fsmonitor", hook);
  writeFileSync(join(dir, "a.ts"), "export const a = 2\n");

  // Somebody else's command-line config reaches git beside ours.
  const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "status.relativePaths", GIT_CONFIG_VALUE_0: "false" };
  for (const run of [
    () => gitBuffered(dir, ["status", "--porcelain"], { env }),
    () => gitBuffered(dir, ["diff", "--name-only"], { env }),
    () => gitStreamed(dir, ["status", "--porcelain", "-z"], () => {}, { env }),
  ]) {
    await run();
    assert.equal(existsSync(marker), false, "the repository's monitor never ran");
  }
  const kept = await gitBuffered(dir, ["config", "status.relativePaths"], { env });
  assert.equal(kept.stdout.trim(), "false", "and a caller's own config entries still arrive");
  const off = await gitBuffered(dir, ["config", "core.fsmonitor"], { env });
  assert.equal(off.stdout.trim(), "false");

  // What the test is standing on: plain git runs it.
  spawnSync("git", ["status", "--porcelain"], { cwd: dir });
  assert.equal(existsSync(marker), true, "the monitor is one git would run");
});

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
  // Compared with what it was rather than with absence: a CI runner or a
  // sandbox can set the variable for every process, and the question is only
  // whether this call changed it.
  const before = process.env.GIT_TERMINAL_PROMPT;

  const r = await gitBuffered(dir, ["config", "--get", "core.askpass"], { env: process.env });

  assert.equal(typeof r.ok, "boolean");
  assert.equal(process.env.GIT_TERMINAL_PROMPT, before, "the parent's environment is untouched");
});

test("the pathspecs this tool writes keep their magic whatever the caller's environment says", async (t) => {
  // These variables switch pathspec magic off or on for every call, and the
  // pin and the refresh build `:(exclude)`, `:(icase)` and globbed pathspecs of their own.
  const { dir, git } = repo(t);
  // Default mode lets `*` cross `/`; glob mode does not, so only a nested file shows it.
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "b.ts"), "export const b = 1\n");
  git("add", "-A");
  for (const name of ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) {
    const env = { ...process.env, [name]: "1" };
    assert.equal((await gitBuffered(dir, ["ls-files", "-z", "--", ":(icase)A.TS"], { env })).stdout, "a.ts\0", name);
    assert.equal((await gitBuffered(dir, ["ls-files", "-z", "--", "*.ts", ":(exclude)A.ts"], { env })).stdout, "a.ts\0src/b.ts\0", name);
  }
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

test("a SHA-256 repository has a HEAD, and its blobs read", async (t) => {
  // git names objects with 64 hex digits under `--object-format=sha256`. A
  // 40-digit ceiling read that HEAD as none, so `pin` said the repository had
  // no commit and every blob the check asked for came back unread.
  const dir = scratch(t, "anatomiya-git-sha256-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString().trim();
  git("init", "-q", "--object-format=sha256");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const head = git("rev-parse", "HEAD");

  assert.equal(head.length, 64);
  assert.equal(await headSha(dir), head);
  const blob = await showBlob(dir, head, "a.ts");
  assert.equal(blob.ok, true);
  assert.equal(blob.content.toString("utf8"), "export const a = 1\n");
  assert.equal(isSha("a".repeat(65)), false, "and nothing longer than a sha");
});

test("a blob a partial clone does not hold is never fetched to answer a read", async (t) => {
  // F14: a blobless clone fetches a missing object from its promisor on
  // demand, so a scan reading pinned files reached the network, and with the
  // remote gone every pinned blob came back unread.
  const origin = repo(t);
  origin.git("config", "uploadpack.allowFilter", "true");
  writeFileSync(join(origin.dir, "b.ts"), "export const b = 2\n");
  origin.git("add", "-A");
  origin.git("commit", "-qm", "second");
  const dir = scratch(t, "anatomiya-git-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  const blobId = execFileSync("git", ["rev-parse", `${head}:b.ts`], { cwd: dir }).toString().trim();

  const blob = await showBlob(dir, head, "b.ts");

  assert.equal(blob.ok, false);
  const present = spawnSync("git", ["cat-file", "-e", blobId], { cwd: dir, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } });
  assert.notEqual(present.status, 0, "the object is still not in this clone");
});

/* --- the commands a repository's own config names are never run (F5) --- */

/**
 * A script that leaves a file behind when anything runs it, then does `body`.
 * The marker is what every case below asserts on, and its control asserts the
 * same script is one plain git runs, so each case proves something.
 */
function tripwire(dir, name, body = "") {
  const marker = join(dir, `ran-${name}`);
  const path = join(dir, `${name}.sh`);
  writeFileSync(path, `#!/bin/sh\ntouch '${marker}'\n${body}\n`);
  chmodSync(path, 0o755);
  return { path, marker, ran: () => existsSync(marker) };
}

// What a case hands git beside the process's own environment: none of the
// variables that would answer before the repository's config is ever read, so
// the control can show that config being obeyed, and no proxy between git and
// a server on the loopback. Command-line config goes too: a sandbox that sets
// `credential.interactive=false` there stops git 2.46 and later from asking an
// askpass at all, and the control would then prove nothing.
function plainEnv(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extra };
  for (const name of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(name)) delete env[name];
  }
  for (const name of [
    "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_PROXY_COMMAND",
    "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy",
  ]) delete env[name];
  return env;
}

let stamp = 1_000_000_000;
// The index keeps each file's stat, and a file whose stat still matches is not
// read at all. Moving the mtime before every read is what makes git hash the
// file again, which is where a clean filter runs.
function touchBack(path) {
  stamp += 1000;
  utimesSync(path, stamp, stamp);
}

const runGit = promisify(execFile);

test("a repository's filter drivers never run on a read", needsShebang, async (t) => {
  // A tarball's `.gitattributes` names a driver and its `.git/config` names the
  // command. Measured on git 2.43 and 2.51: a `status` or a `diff` against the
  // working tree ran the clean command, and a long-running `process` one.
  const { dir, git } = repo(t);
  const out = scratch(t, "anatomiya-git-trip-");
  writeFileSync(join(dir, ".gitattributes"), "*.ts filter=evil\n*.js filter=proc\n");
  writeFileSync(join(dir, "b.js"), "export const b = 1\n");
  git("add", "-A");
  git("commit", "-qm", "attrs");
  const clean = tripwire(out, "clean", "cat");
  const smudge = tripwire(out, "smudge", "cat");
  const proc = tripwire(out, "process", "cat");
  git("config", "filter.evil.clean", clean.path);
  git("config", "filter.evil.smudge", smudge.path);
  git("config", "filter.evil.required", "true");
  git("config", "filter.proc.process", proc.path);
  git("config", "filter.proc.required", "true");
  // The same size, so only the content can say the file changed.
  writeFileSync(join(dir, "a.ts"), "export const a = 2\n");
  writeFileSync(join(dir, "b.js"), "export const b = 2\n");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

  const reads = [
    async () => (await gitBuffered(dir, ["status", "--porcelain", "-z"])).stdout,
    async () => (await gitBuffered(dir, ["diff", "--name-only", "-z", "HEAD", "--"])).stdout,
    async () => {
      const seen = [];
      await gitStreamed(dir, ["status", "--porcelain", "-z"], (f) => { if (f) seen.push(f); });
      return seen.join("\0");
    },
    async () => [...((await changedSinceWorktree(dir, head)) ?? [])].join("\0"),
    async () => (await gitBuffered(dir, ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", "HEAD", "--"])).stdout,
  ];
  for (const read of reads) {
    touchBack(join(dir, "a.ts"));
    touchBack(join(dir, "b.js"));
    const said = await read();
    assert.equal(clean.ran() || smudge.ran() || proc.ran(), false, "no driver the repository named ran");
    // Read as the bytes on disk, so the edit is still seen.
    assert.match(said, /a\.ts/);
    assert.match(said, /b\.js/);
  }

  // What the test is standing on: plain git runs both.
  touchBack(join(dir, "a.ts"));
  touchBack(join(dir, "b.js"));
  spawnSync("git", ["status", "--porcelain"], { cwd: dir });
  assert.equal(clean.ran(), true, "the clean driver is one git would run");
  assert.equal(proc.ran(), true, "and so is the process driver");
});

test("Git LFS installed for this repository alone still runs, and nothing else under its name does", needsShebang, async (t) => {
  // `git lfs install --local` writes the standard commands into `.git/config`.
  // They run the user's own installed `git-lfs`, not a script the repository
  // ships, and replacing them made every LFS file whose stat moved read as
  // changed, so `pin` refused a clean tree.
  const bin = scratch(t, "anatomiya-git-lfs-bin-");
  // A host that ran `git lfs install` (the macOS runners do) names the real
  // `git-lfs filter-process` globally, which the stand-in cannot answer.
  writeFileSync(join(bin, "gitconfig"), "");
  const isolated = { GIT_CONFIG_GLOBAL: join(bin, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  const { dir, git } = repo(t, plainEnv(isolated));
  const marker = join(bin, "ran-lfs");
  writeFileSync(join(bin, "git-lfs"), `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  chmodSync(join(bin, "git-lfs"), 0o755);
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  writeFileSync(join(dir, "a.bin"), "payload\n");
  git("add", "-A");
  git("commit", "-qm", "lfs");
  // The stand-in speaks no long-running protocol, so the standard clean and
  // smudge commands stand for all three; `filter-process` is exempted the same.
  git("config", "filter.lfs.clean", "git-lfs clean -- %f");
  git("config", "filter.lfs.smudge", "git-lfs smudge -- %f");
  git("config", "filter.lfs.required", "true");
  const env = plainEnv({ ...isolated, PATH: `${bin}:${process.env.PATH}` });

  touchBack(join(dir, "a.bin"));
  const r = await gitBuffered(dir, ["status", "--porcelain", "-z"], { env });
  assert.equal(r.ok, true, r.error);
  assert.equal(existsSync(marker), true, "the user's own git-lfs ran");
  assert.equal(r.stdout, "", "and a file whose stat alone moved is not an edit");

  // The same filter name with a command of the repository's own is not LFS.
  // Another repository, since a process reads each one's config once.
  const other = repo(t, plainEnv(isolated));
  writeFileSync(join(other.dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(other.dir, "a.bin"), "payload\n");
  other.git("add", "-A");
  other.git("commit", "-qm", "lfs");
  const evil = tripwire(bin, "evil", "cat");
  other.git("config", "filter.lfs.clean", `${evil.path} clean -- %f`);
  other.git("config", "filter.lfs.required", "true");
  touchBack(join(other.dir, "a.bin"));
  await gitBuffered(other.dir, ["status", "--porcelain", "-z"], { env });
  assert.equal(evil.ran(), false, "a command under the lfs name that is not git-lfs's own never runs");
  // The read above refreshed the index's stat, so move it again for the control.
  touchBack(join(other.dir, "a.bin"));
  spawnSync("git", ["status", "--porcelain"], { cwd: other.dir, env });
  assert.equal(evil.ran(), true, "and plain git would have run it");
});

test("a repository that names a command for Git LFS to run keeps git-lfs from running at all", needsShebang, async (t) => {
  // git-lfs reads the repository's config too, and runs an `lfs.extension` clean
  // command on every clean it does. The standard filter, local or the user's
  // global one, is then the door to the repository's command.
  const bin = scratch(t, "anatomiya-git-lfs-bin-");
  const marker = join(bin, "ran-lfs");
  writeFileSync(join(bin, "git-lfs"), `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  chmodSync(join(bin, "git-lfs"), 0o755);
  const extension = tripwire(bin, "extension", "cat");
  const cases = [
    ["filter.lfs.clean", "git-lfs clean -- %f"],
    ["lfs.extension.x.clean", `${extension.path} %f`],
    ["lfs.customtransfer.x.path", extension.path],
    ["lfs.standalonetransferagent", "x"],
  ];
  for (const [key, value] of cases.slice(1)) {
    for (const where of ["local", "global"]) {
      const global = join(bin, `gitconfig-${where}-${key}`);
      writeFileSync(global, "");
      const isolated = { GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" };
      const { dir, git } = repo(t, plainEnv(isolated));
      writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
      writeFileSync(join(dir, "a.bin"), "payload\n");
      git("add", "-A");
      git("commit", "-qm", "lfs");
      if (where === "local") git("config", ...cases[0]);
      else writeFileSync(global, "[filter \"lfs\"]\n\tclean = git-lfs clean -- %f\n\trequired = true\n");
      git("config", key, value);
      rmSync(marker, { force: true });
      touchBack(join(dir, "a.bin"));

      const r = await gitBuffered(dir, ["status", "--porcelain", "-z"], { env: plainEnv({ ...isolated, PATH: `${bin}:${process.env.PATH}` }) });

      assert.equal(r.ok, true, r.error);
      assert.equal(existsSync(marker), false, `git-lfs never ran beside ${key} (${where} filter)`);
    }
  }
});

test("a submodule's filter driver never runs through the superproject's status", needsShebang, async (t) => {
  // Status asks every populated submodule whether it is dirty by running git
  // inside it, under the submodule's own config, which the tarball also ships
  // and whose driver names this process never read. A `.git/config` entry
  // asking for that (`submodule.<name>.ignore=none`) outranks every default.
  const { dir, git } = repo(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const src = scratch(t, "anatomiya-git-sub-");
  const sub = (...a) => execFileSync("git", a, { cwd: src, stdio: "pipe" });
  sub("init", "-q");
  sub("config", "user.email", "t@t.test");
  sub("config", "user.name", "T");
  writeFileSync(join(src, ".gitattributes"), "*.txt filter=sf\n");
  writeFileSync(join(src, "s.txt"), "hello\n");
  sub("add", "-A");
  sub("commit", "-qm", "s");
  git("-c", "protocol.file.allow=always", "submodule", "-q", "add", src, "sub");
  git("commit", "-qm", "sub");
  const clean = tripwire(out, "subclean", "cat");
  execFileSync("git", ["config", "filter.sf.clean", clean.path], { cwd: join(dir, "sub") });
  git("config", "submodule.sub.ignore", "none");
  writeFileSync(join(dir, "sub", "s.txt"), "jello\n");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

  for (const read of [
    () => gitBuffered(dir, ["status", "--porcelain", "-z"]),
    () => gitBuffered(dir, ["status", "--porcelain", "--untracked-files=no", "-z", "--", "."]),
    () => gitBuffered(dir, ["diff", "--name-only", "-z", "HEAD", "--"]),
    () => changedSinceWorktree(dir, head),
  ]) {
    touchBack(join(dir, "sub", "s.txt"));
    await read();
    assert.equal(clean.ran(), false, "the submodule's driver never ran");
  }

  touchBack(join(dir, "sub", "s.txt"));
  spawnSync("git", ["status", "--porcelain"], { cwd: dir });
  assert.equal(clean.ran(), true, "the driver is one git would run");
});

/**
 * A depth-1 clone whose remote holds a `base` branch the clone does not, so
 * `check --base origin/base` has to reach the remote for it.
 */
function shallowWithBase(t) {
  const origin = repo(t);
  origin.git("branch", "-M", "main");
  origin.git("branch", "base");
  writeFileSync(join(origin.dir, "a.ts"), "export const a = 3\n");
  origin.git("commit", "-qam", "more");
  const dir = join(scratch(t, "anatomiya-git-shallow-"), "clone");
  execFileSync("git", ["clone", "-q", "--depth=1", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  return { dir, git, origin };
}

test("the check's shallow fetch never runs the upload-pack a repository names", needsShebang, async (t) => {
  // `remote.<name>.uploadpack` is a command git runs to serve a local or file
  // remote, and the first one configured wins, so no later config entry can
  // replace it. Measured on 2.43 and 2.51: an environment entry left the
  // repository's command running, with "more than one uploadpack given".
  const { dir, git } = shallowWithBase(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const pack = tripwire(out, "uploadpack", 'exec git-upload-pack "$@"');
  git("config", "remote.origin.uploadpack", pack.path);

  const report = await check(dir, { baseRef: "origin/base" });

  assert.equal(report.base.ref, "origin/base", "the base was still fetched");
  assert.equal(pack.ran(), false, "through git's own upload-pack");

  spawnSync("git", ["ls-remote", "origin"], { cwd: dir });
  assert.equal(pack.ran(), true, "the repository's upload-pack is one git would run");
});

test("a partial clone's lazy fetch never runs the upload-pack a repository names", needsShebang, async (t) => {
  // The fetch a lazy read starts is git's own child, which reads the upload-pack
  // from config with no command line of ours to outrank the repository's.
  const origin = repo(t);
  origin.git("config", "uploadpack.allowFilter", "true");
  writeFileSync(join(origin.dir, "b.ts"), "export const b = 2\n");
  origin.git("add", "-A");
  origin.git("commit", "-qm", "second");
  const dir = scratch(t, "anatomiya-git-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const pack = tripwire(scratch(t, "anatomiya-git-trip-"), "uploadpack", 'exec git-upload-pack "$@"');
  execFileSync("git", ["config", "remote.origin.uploadpack", pack.path], { cwd: dir });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

  const r = await gitBuffered(dir, ["cat-file", "blob", `${head}:b.ts`], { lazyFetch: true });

  assert.equal(pack.ran(), false, "the repository's upload-pack never ran");
  assert.equal(r.ok, false, "the blob stays missing, as it would with no remote");
  spawnSync("git", ["cat-file", "blob", `${head}:b.ts`], { cwd: dir });
  assert.equal(pack.ran(), true, "the lazy fetch runs it in plain git");
});

test("the check's shallow fetch never runs the ssh command a repository names", needsShebang, async (t) => {
  if (process.env.GIT_SSH_COMMAND !== undefined) return t.skip("GIT_SSH_COMMAND answers before any config is read");
  const { dir, git } = shallowWithBase(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const ssh = tripwire(out, "ssh", "exit 1");
  git("remote", "set-url", "origin", "ssh://example.invalid/r.git");
  git("config", "core.sshCommand", ssh.path);

  await assert.rejects(() => check(dir, { baseRef: "origin/base" }), /could not fetch it/);
  assert.equal(ssh.ran(), false, "the repository's ssh command never ran");

  spawnSync("git", ["ls-remote", "origin"], { cwd: dir, env: plainEnv() });
  assert.equal(ssh.ran(), true, "the command is one git would run");
});

test("a user's own global ssh command still carries the fetch", needsShebang, async (t) => {
  // The one legitimate owner of the key: somebody whose global config routes
  // ssh through a wrapper. The repository's value is replaced by theirs, not
  // by a default.
  const { dir, git } = shallowWithBase(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const mine = tripwire(out, "global-ssh", "exit 1");
  const theirs = tripwire(out, "local-ssh", "exit 1");
  const global = join(out, "gitconfig");
  writeFileSync(global, `[core]\n\tsshCommand = ${mine.path}\n`);
  git("remote", "set-url", "origin", "ssh://example.invalid/r.git");
  git("config", "core.sshCommand", theirs.path);
  const env = plainEnv({ GIT_CONFIG_GLOBAL: global });

  const r = await gitBuffered(dir, ["ls-remote", "origin"], { env });

  assert.equal(r.ok, false);
  assert.equal(theirs.ran(), false, "the repository's command never ran");
  assert.equal(mine.ran(), true, "the user's own global one did");
});

test("a repository's credential helper and askpass never run", needsShebang, async (t) => {
  // A server answering 401 is what makes git ask for a credential: first every
  // helper configured, then `core.askPass`, which runs even with terminal
  // prompts refused. Both are commands, and a tarball's config can name each.
  const server = createServer((req, res) => {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="x"', "Content-Length": "0" });
    res.end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const { port } = server.address();

  const { dir, git } = repo(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const helper = tripwire(out, "helper", "exit 0");
  const scoped = tripwire(out, "scoped-helper", "exit 0");
  const askpass = tripwire(out, "askpass", "echo x");
  const mine = tripwire(out, "global-helper", "exit 0");
  const global = join(out, "gitconfig");
  writeFileSync(global, `[credential]\n\thelper = ${mine.path}\n`);
  git("remote", "add", "origin", `http://127.0.0.1:${port}/r.git`);
  git("config", "credential.helper", helper.path);
  git("config", `credential.http://127.0.0.1:${port}.helper`, scoped.path);
  git("config", "core.askPass", askpass.path);
  const env = plainEnv({ GIT_CONFIG_GLOBAL: global });

  const r = await gitBuffered(dir, ["ls-remote", "origin"], { env, timeout: 20_000 });

  assert.equal(r.ok, false);
  assert.equal(helper.ran(), false, "the repository's helper never ran");
  assert.equal(scoped.ran(), false, "nor its helper for one URL");
  assert.equal(askpass.ran(), false, "nor its askpass");
  assert.equal(mine.ran(), true, "the user's own global helper was still asked");

  // Asynchronous, because this process is also the server git is talking to.
  await runGit("git", ["ls-remote", "origin"], { cwd: dir, env, timeout: 20_000 }).catch(() => {});
  assert.equal(helper.ran() && scoped.ran() && askpass.ran(), true, "all three are commands git would run");
});

test("a repository's git:// proxy command never runs", needsShebang, async (t) => {
  // `core.gitProxy` is first-match-wins, so an entry after the repository's
  // cannot replace it. Measured: an environment entry of `none` left it running.
  const { dir, git } = repo(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const proxy = tripwire(out, "proxy", "exit 1");
  git("remote", "add", "origin", "git://127.0.0.1:9/r.git");
  git("config", "core.gitProxy", proxy.path);

  await gitBuffered(dir, ["ls-remote", "origin"], { env: plainEnv(), timeout: 20_000 });
  assert.equal(proxy.ran(), false, "the repository's proxy never ran");

  spawnSync("git", ["ls-remote", "origin"], { cwd: dir, env: plainEnv(), timeout: 20_000 });
  assert.equal(proxy.ran(), true, "the proxy is one git would run");
});

test("the check's shallow fetch never runs a repository's alternate-refs command", needsShebang, async (t) => {
  // With an alternate object store, `fetch` asks it for refs to negotiate
  // with, through `core.alternateRefsCommand` when one is configured.
  const { dir, git, origin } = shallowWithBase(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const other = join(out, "other.git");
  execFileSync("git", ["init", "-q", "--bare", other], { stdio: "pipe" });
  execFileSync("git", ["fetch", "-q", origin.dir, "HEAD:refs/heads/x"], { cwd: other, stdio: "pipe" });
  writeFileSync(join(dir, ".git", "objects", "info", "alternates"), `${join(other, "objects")}\n`);
  const alt = tripwire(out, "alternate-refs", "exit 0");
  git("config", "core.alternateRefsCommand", alt.path);

  const report = await check(dir, { baseRef: "origin/base" });

  assert.equal(report.base.ref, "origin/base", "the base was still fetched");
  assert.equal(alt.ran(), false, "the repository's command never ran");

  writeFileSync(join(origin.dir, "a.ts"), "export const a = 4\n");
  origin.git("commit", "-qam", "again");
  spawnSync("git", ["fetch", "-q", "--depth=1", "origin", "main"], { cwd: dir });
  assert.equal(alt.ran(), true, "the command is one git would run");
});

test("a log never runs the signature program a repository names", needsShebang, async (t) => {
  // `log.showSignature` makes every `log` verify each signed commit, whatever
  // its format, with the `gpg.program` the same config names.
  const { dir, git } = repo(t);
  const out = scratch(t, "anatomiya-git-trip-");
  const gpg = tripwire(out, "gpg", "exit 1");
  const body = execFileSync("git", ["cat-file", "commit", "HEAD"], { cwd: dir }).toString();
  const signed = body.replace(/^(committer .*)$/m, "$1\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----");
  const sha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: dir, input: signed }).toString().trim();
  git("update-ref", "HEAD", sha);
  git("config", "log.showSignature", "true");
  git("config", "gpg.program", gpg.path);

  await gitBuffered(dir, ["log", "--format=%H"]);
  await gitStreamed(dir, ["log", "--first-parent", "-z", "--format=%H %ce", "HEAD"], () => {}, { terminated: false });
  assert.equal(gpg.ran(), false, "the repository's program never ran");

  spawnSync("git", ["log", "-1", "--format=%H"], { cwd: dir });
  assert.equal(gpg.ran(), true, "the program is one git would run");
});

test("the fetch never recurses into a submodule and its own config", needsShebang, async (t) => {
  // A fetch that brings a commit moving a submodule fetches that submodule
  // too, from inside it, under a config this process never read.
  const out = scratch(t, "anatomiya-git-trip-");
  const run = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });
  const who = ["-c", "user.email=t@t.test", "-c", "user.name=T", "-c", "protocol.file.allow=always"];
  run(out, "init", "-q", "--bare", "--initial-branch=main", "subup.git");
  run(out, "init", "-q", "--bare", "--initial-branch=main", "up.git");
  run(out, "init", "-q", "--initial-branch=main", "sub");
  writeFileSync(join(out, "sub", "s.txt"), "s\n");
  run(join(out, "sub"), "add", "-A");
  run(join(out, "sub"), ...who, "commit", "-qm", "s");
  run(join(out, "sub"), "push", "-q", "../subup.git", "HEAD:main");
  run(out, "init", "-q", "--initial-branch=main", "super");
  run(join(out, "super"), ...who, "submodule", "-q", "add", `file://${join(out, "subup.git")}`, "sub");
  run(join(out, "super"), ...who, "commit", "-qm", "add");
  run(join(out, "super"), "push", "-q", "../up.git", "HEAD:main");
  run(out, ...who, "clone", "-q", "--recurse-submodules", `file://${join(out, "up.git")}`, "work");
  const pack = tripwire(out, "sub-uploadpack", 'exec git-upload-pack "$@"');
  run(join(out, "work", "sub"), "config", "remote.origin.uploadpack", pack.path);
  // The superproject's remote moves the submodule on.
  writeFileSync(join(out, "sub", "n.txt"), "n\n");
  run(join(out, "sub"), "add", "-A");
  run(join(out, "sub"), ...who, "commit", "-qm", "n");
  run(join(out, "sub"), "push", "-q", "../subup.git", "HEAD:main");
  run(join(out, "super", "sub"), "pull", "-q", "origin", "main");
  run(join(out, "super"), "add", "sub");
  run(join(out, "super"), ...who, "commit", "-qm", "bump");
  run(join(out, "super"), "push", "-q", "../up.git", "HEAD:main");
  cpSync(join(out, "work"), join(out, "control"), { recursive: true });

  const r = await gitBuffered(join(out, "work"), ["fetch", "origin"]);

  assert.equal(r.ok, true, r.error);
  assert.equal(pack.ran(), false, "the submodule's upload-pack never ran");

  spawnSync("git", ["-c", "protocol.file.allow=always", "fetch", "origin"], { cwd: join(out, "control") });
  assert.equal(pack.ran(), true, "a plain fetch recurses and runs it");
});

test("the repository's config is read once per repository, not once per call", needsShebang, async (t) => {
  // The hooks make a handful of reads each, and every one of them paying for
  // a second git would double what a hook costs.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  const log = join(bin, "calls");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$1" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  // A PATH no earlier case used, so no read already made in this process
  // answers for this one.
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };

  for (let i = 0; i < 4; i++) await gitBuffered(dir, ["rev-parse", "--show-toplevel"], { env });
  await gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, { env });

  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls.filter((c) => c === "config").length, 1, calls.join(","));
  assert.equal(calls.filter((c) => c === "rev-parse").length, 4);
});

test("a pathspec folds case exactly where the repository's git does", async (t) => {
  const dir = scratch(t, "anatomiya-icase-");
  execFileSync("git", ["init", "-q", dir]);
  const set = (v) => execFileSync("git", ["config", "core.ignorecase", v], { cwd: dir });
  set("yes");
  assert.equal(await caseMagic(dir), "icase", "git's own bool spelling");
  set("false");
  assert.equal(await caseMagic(dir), "");
  execFileSync("git", ["config", "--unset", "core.ignorecase"], { cwd: dir });
  assert.equal(await caseMagic(dir), "");
});

/* --- an answer about a full commit sha is asked once per process --- */

/**
 * Every git this process starts while `run` is awaited, as its argument lists.
 * The readers under test take no environment, so the shim goes on this
 * process's own PATH and comes off it whatever `run` does.
 */
async function gitCalls(t, run) {
  const bin = scratch(t, "anatomiya-git-log-");
  const log = join(bin, "calls");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await run();
  } finally {
    process.env.PATH = path;
  }
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((c) => !c.startsWith("config ")) : [];
}

function twoCommits(t) {
  const { dir, git } = repo(t);
  const first = git("rev-parse", "HEAD").toString().trim();
  writeFileSync(join(dir, "b.ts"), "export const b = 1\n");
  git("add", "-A");
  git("commit", "-qm", "second");
  return { dir, git, first, second: git("rev-parse", "HEAD").toString().trim() };
}

test("a question about full commit shas spawns git once however often it is asked", needsShebang, async (t) => {
  // An object named by its full hash cannot change, and the check asked the
  // same merge base three times and the same diff twice in one run.
  const { dir, first, second } = twoCommits(t);
  const answers = [];
  const calls = await gitCalls(t, async () => {
    for (let i = 0; i < 2; i++) {
      answers.push(await mergeBase(dir, first, second));
      answers.push(await commitAt(dir, second));
      answers.push(await shaReachable(dir, second));
      answers.push([...(await filesAt(dir, second))]);
      answers.push([...(await diffRange(dir, first, second)).changed]);
    }
  });

  assert.deepEqual(answers.slice(0, 5), [{ found: true, failed: false, sha: first }, second, true, ["a.ts", "b.ts"], ["b.ts"]]);
  assert.deepEqual(answers.slice(5), answers.slice(0, 5), "the second asking answers the same");
  const spawned = (sub) => calls.filter((c) => c.startsWith(`${sub} `)).length;
  assert.deepEqual(
    ["merge-base", "rev-parse", "cat-file", "ls-tree", "diff"].map((sub) => [sub, spawned(sub)]),
    [["merge-base", 1], ["rev-parse", 1], ["cat-file", 0], ["ls-tree", 1], ["diff", 1]],
    calls.join("\n")
  );
});

test("a ref name or a short sha is asked again every time, because what it names moves", needsShebang, async (t) => {
  const { dir, git, first } = twoCommits(t);
  const short = first.slice(0, 7);
  let before = null;
  let after = null;
  const calls = await gitCalls(t, async () => {
    before = await commitAt(dir, "HEAD");
    await mergeBase(dir, "HEAD", first);
    await filesAt(dir, "HEAD");
    await commitAt(dir, short);
    writeFileSync(join(dir, "c.ts"), "export const c = 1\n");
    git("add", "-A");
    git("commit", "-qm", "third");
    after = await commitAt(dir, "HEAD");
    await mergeBase(dir, "HEAD", first);
    await filesAt(dir, "HEAD");
    await commitAt(dir, short);
  });

  assert.notEqual(after, before, "HEAD moved, and the answer moved with it");
  const spawned = (prefix) => calls.filter((c) => c.startsWith(prefix)).length;
  assert.equal(spawned("rev-parse --verify --quiet HEAD^{commit}"), 2);
  assert.equal(spawned("merge-base HEAD"), 2);
  assert.equal(spawned("ls-tree -r --name-only -z HEAD"), 2);
  assert.equal(spawned(`rev-parse --verify --quiet ${short}^{commit}`), 2);
});

test("a question git could not answer is asked again, never remembered as the answer", needsShebang, async (t) => {
  // F15: a failure kept would read as a fact about the commit for the rest of
  // the process, and a later read that would have worked never runs.
  const { dir, first } = twoCommits(t);
  const absent = "f".repeat(40);
  const answers = [];
  const calls = await gitCalls(t, async () => {
    for (let i = 0; i < 2; i++) {
      answers.push(await filesAt(dir, absent));
      answers.push(await diffRange(dir, first, absent));
      answers.push((await mergeBase(dir, first, absent)).failed);
      answers.push(await commitAt(dir, absent));
    }
  });

  assert.deepEqual(answers, [null, null, true, null, null, null, true, null]);
  const spawned = (sub) => calls.filter((c) => c.startsWith(`${sub} `)).length;
  assert.deepEqual(
    ["ls-tree", "diff", "merge-base"].map((sub) => [sub, spawned(sub)]),
    [["ls-tree", 2], ["diff", 2], ["merge-base", 2]],
    calls.join("\n")
  );
});

test("the merge base of a commit with itself is the commit, with no merge-base spawned", needsShebang, async (t) => {
  const { dir, second } = twoCommits(t);
  const answers = [];
  const calls = await gitCalls(t, async () => {
    answers.push(await mergeBase(dir, second, second));
    answers.push(await mergeBase(dir, second, second));
  });

  assert.deepEqual(answers, [{ found: true, failed: false, sha: second }, { found: true, failed: false, sha: second }]);
  assert.deepEqual(calls, [`rev-parse --verify --quiet ${second}^{commit}`], "only the commit itself was verified");
});
