import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

import { ASKS_BY_ID, exits, gitAhead, needsGitStub, unasked } from "./git-stub.mjs";
import { killPidIn, needsBatchZ, needsPosixPaths, needsShebang } from "./platform.mjs";

import { check } from "../plugins/anatomiya/lib/check.mjs";
import { MAX_FILE_BYTES } from "../plugins/anatomiya/lib/limits.mjs";
import { Unasked, answerWith, ask, askWhether, blobReader, caseMagic, changedSinceWorktree, commitAt, diffRange, filesAt, gitBuffered, gitStreamed, headSha, isSha, mergeBase, nameStatusReader, parsePorcelainRows, shaReachable, showBlob, resolveBaseRef, topLevel, unaskedAs } from "../plugins/anatomiya/lib/git.mjs";

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
 *
 * Never `removeTree` of `test/platform.mjs`, which fails a test on a directory
 * still held: these tests leave children behind on purpose.
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

test("a call that outruns its timeout answers instead of hanging", { timeout: 60_000 }, async () => {
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
  assert.equal(r.code, null, "and it has no exit code to read as an answer");
  assert.match(String(r.error), /git was ended by SIG[A-Z]+ after 250 ms/, "and its error says what ended it and when");
});

test("a timeout that is no whole number of milliseconds is refused rather than run with no clock", async (t) => {
  // A directory of its own, so no config read cached by an earlier test stands in for the refusal.
  const dir = scratch(t, "anatomiya-git-timeout-");
  for (const timeout of [-1, Number.NaN, 1.5, 2 ** 31]) {
    const r = await gitBuffered(dir, ["version"], { timeout });

    assert.equal(r.ok, false, String(timeout));
    assert.match(String(r.error), /^timeout must be a whole number of ms from 0 to 2147483647/, String(timeout));
    await assert.rejects(gitStreamed(dir, ["version"], () => {}, { timeout }), /^Error: timeout must be a whole number of ms from 0 to 2147483647/, String(timeout));
  }
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

test("a streamed read whose signal was stopped before the call is refused and hands over no field", async (t) => {
  // A listener added to a signal that already fired never fires, so the read would run to its end.
  const { dir } = repo(t);
  const seen = [];

  await assert.rejects(
    () => gitStreamed(dir, ["ls-files", "-z", "--"], (field) => seen.push(field), { signal: AbortSignal.abort() }),
    /^Error: git ls-files stopped by its caller$/
  );
  assert.deepEqual(seen, []);
});

test("a streamed read names its git subcommand past any config option before it", async (t) => {
  const { dir } = repo(t);
  await assert.rejects(
    () => gitStreamed(dir, ["-c", "core.quotePath=false", "ls-files", "-z", "--"], () => {}, { signal: AbortSignal.abort() }),
    /^Error: git ls-files stopped by its caller$/
  );
  await assert.rejects(
    () => gitStreamed(dir, ["-c", "core.quotePath=false", "ls-tree", "-z", "--name-only", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"], () => {}),
    /^Error: git ls-tree exited /
  );
  await assert.rejects(
    () => gitStreamed(dir, ["-c", "core.quotePath=false", "log", "--format=%ae", "--"], () => {}),
    /^Error: git log output ended mid-record$/
  );
  // A config git cannot parse leaves which commands it names unread.
  const { dir: broken } = repo(t);
  writeFileSync(join(broken, ".git", "config"), "[core\n");
  await assert.rejects(
    () => gitStreamed(broken, ["-c", "core.quotePath=false", "log", "--format=%ae", "--"], () => {}),
    /^Error: git log: could not read which commands this repository's config names/
  );
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
  // Only the listing hangs: the repository's config is read first, and a
  // stall there is that read's to report.
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$1" in ls-files) exec sleep 30;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  assert.equal((await gitBuffered(dir, ["rev-parse", "HEAD"], { env })).ok, true, "the config is read, on a clock of its own");

  await assert.rejects(() => gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, { timeout: 500, env }), /^Error: git ls-files exited SIGTERM/);
});

test("a listing whose git exits as its clock runs out is no answer, however it exited", needsShebang, async (t) => {
  // The clock shuts the pipes, and a git that exited 0 in that moment has left part of its listing in them.
  const { dir } = repo(t);
  const bin = scratch(t, "anatomiya-git-bin-");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$1" in ls-files) printf 'a\\000'; sleep 0.2; printf 'b\\000c\\000'; exit 0;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const seen = [];
  const held = new Int32Array(new SharedArrayBuffer(4));

  await assert.rejects(
    () =>
      gitStreamed(dir, ["ls-files", "-z", "--"], (f) => {
        seen.push(f);
        // Held past the clock and past git's own exit, so the clock is what the loop turns to first.
        if (seen.length === 1) Atomics.wait(held, 0, 0, 4500);
      }, { timeout: 3000, env }),
    /^Error: git ls-files exited SIGTERM/
  );
  assert.deepEqual(seen, ["a"]);
});

// A git that exits as its clock runs out leaves a code beside part of its answer: 0 would read as the whole
// answer, 1 as git saying no.
for (const exit of [0, 1]) {
  test(`a buffered read whose git exits ${exit} as its clock runs out is no answer either`, { ...needsShebang, timeout: 60_000 }, async (t) => {
    const { dir } = repo(t);
    const bin = scratch(t, "anatomiya-git-bin-");
    const started = join(bin, "started");
    const go = join(bin, "go");
    const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    // The rest of the listing waits for this test's word, so no machine is fast enough to finish it first.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\ncase "$1" in ls-files) : > '${started}'; printf 'a\\000'; while [ ! -e '${go}' ]; do sleep 0.05; done; printf 'b\\000c\\000'; exit ${exit};; esac\nexec '${real}' "$@"\n`,
      { mode: 0o755 }
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const cell = new Int32Array(new SharedArrayBuffer(4));

    const reading = gitBuffered(dir, ["ls-files", "-z", "--"], { timeout: 3000, env });
    await until(t, () => existsSync(started));
    // Held past the clock and past git's own exit, and from the loop's check phase, so the loop turns to its
    // timers, the clock among them, before it reads the pipe again. The word is given once the loop is held,
    // so a loaded machine cannot read git's exit before the clock is due.
    await new Promise((done) => {
      setImmediate(() => {
        writeFileSync(go, "");
        Atomics.wait(cell, 0, 0, 4500);
        done();
      });
    });
    const r = await reading;

    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.stdout, "");
    assert.equal(r.code, null, JSON.stringify(r));
    assert.match(String(r.error), /git was ended by SIGTERM after 3000 ms/);
  });
}

// What the config read leaves out is a command this repository names that nothing keeps from running.
for (const exit of [0, 1]) {
  test(`a configuration read whose git exits ${exit} as its clock runs out leaves the call unasked`, { ...needsShebang, timeout: 60_000 }, async (t) => {
    const { dir } = repo(t);
    const bin = scratch(t, "anatomiya-git-bin-");
    const started = join(bin, "started");
    const go = join(bin, "go");
    const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\ncase "$1" in config) : > '${started}'; while [ ! -e '${go}' ]; do sleep 0.05; done; exit ${exit};; esac\nexec '${real}' "$@"\n`,
      { mode: 0o755 }
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const cell = new Int32Array(new SharedArrayBuffer(4));

    const reading = gitBuffered(dir, ["ls-files", "-z", "--"], { timeout: 3000, env });
    await until(t, () => existsSync(started));
    // The word is given once the loop is held, as above.
    await new Promise((done) => {
      setImmediate(() => {
        writeFileSync(go, "");
        Atomics.wait(cell, 0, 0, 4500);
        done();
      });
    });
    const r = await reading;

    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(String(r.error), /git config was ended by SIGTERM after 3000 ms/);
  });
}

test("a configuration read whose git was reaped before its clock ran out is unasked too", { ...needsShebang, timeout: 60_000 }, async (t) => {
  // A process git started keeps its stdout, so Node has heard git exit 1 and still waits on the pipe: the clock
  // signals no live git, and only the clock says the list was cut off.
  const { dir } = repo(t);
  let holder = null;
  // Ahead of the directory's own removal, which takes the pid with it.
  t.after(() => killPidIn(holder));
  const bin = scratch(t, "anatomiya-git-bin-");
  holder = join(bin, "holder");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$1" in config) sleep 30 & echo $! > '${holder}'; exit 1;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };

  const r = await gitBuffered(dir, ["ls-files", "-z", "--"], { timeout: 1000, env });

  assert.equal(r.ok, false, JSON.stringify(r));
  assert.match(String(r.error), /git config was ended by SIGTERM after 1000 ms/);
});

test("a buffered read behind a launcher is ended by its own clock too", { ...needsShebang, timeout: 60_000 }, async (t) => {
  const { dir } = repo(t);
  const { env } = behindLauncher(t, "exec sleep 30");
  const started = performance.now();

  const r = await gitBuffered(dir, ["ls-files", "-z", "--"], { timeout: 2000, env });
  assert.match(String(r.error), /git was ended by SIGTERM after 2000 ms/);
  // Waiting on the pipes, the read would settle only when the stand-in's 30 s were up.
  assert.ok(performance.now() - started < 15_000, `settled after ${Math.round(performance.now() - started)} ms`);
});

/**
 * A `git` on PATH whose `ls-files` is a launcher: the listing is its child's, which writes its pid to
 * `behind` first and outlives a signal to the launcher, as the real git does behind Git for Windows' own.
 */
function behindLauncher(t, listing) {
  let behind = null;
  // Ahead of the directory's own removal, which takes the pid with it.
  t.after(() => killPidIn(behind));
  const bin = scratch(t, "anatomiya-git-bin-");
  behind = join(bin, "behind");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$1" in ls-files) sh -c 'echo $$ > "$0"; ${listing}' '${behind}' & wait; exit;; esac\nexec '${real}' "$@"\n`,
    { mode: 0o755 }
  );
  return { behind, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

test("a walk its caller ended does not wait on a git behind a launcher, and that git stops", { ...needsShebang, timeout: 60_000 }, async (t) => {
  const { dir } = repo(t);
  const { behind, env } = behindLauncher(t, `printf "a.ts\\000"; exec yes`);
  const seen = [];

  await gitStreamed(dir, ["ls-files", "-z", "--"], (f) => {
    seen.push(f);
    return false;
  }, { env });

  assert.deepEqual(seen, ["a.ts"]);
  assert.equal(existsSync(behind), true, "a git was started behind the launcher, so there was one to stop");
  await until(t, () => gone(behind));
});

test("a streamed read behind a launcher is ended by its own timeout too", { ...needsShebang, timeout: 60_000 }, async (t) => {
  // The one behind writes nothing, so nothing ends it: what is held is that the read does not wait on it.
  const { dir } = repo(t);
  const { env } = behindLauncher(t, "exec sleep 30");
  const started = performance.now();

  // Room for a stand-in written a moment ago to start: about half a second on a loaded Mac.
  await assert.rejects(() => gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, { timeout: 2000, env }), /^Error: git ls-files exited SIGTERM/);
  // Waiting on the pipes, the read would settle only when the stand-in's 30 s were up.
  assert.ok(performance.now() - started < 15_000, `settled after ${Math.round(performance.now() - started)} ms`);
});

// The case the stand-in launcher above holds, on whatever git this machine runs: Git for Windows starts the real
// git as a launcher's child. Measured there with the pipes left open, a 300 ms clock settled after 1632 and 2032 ms.
test("a long walk its clock ends settles near the clock, whatever starts git", { timeout: 180_000 }, async (t) => {
  const dir = scratch(t, "anatomiya-git-long-");
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  const commits = [];
  for (let i = 1; i <= 80_000; i++) {
    commits.push(`commit refs/heads/long\nmark :${i}\ncommitter T <t@t.test> ${1_700_000_000 + i} +0000\ndata 1\nc\n${i > 1 ? `from :${i - 1}\n` : ""}M 100644 inline f${i % 50}.txt\ndata ${String(i).length + 1}\n${i}\n\n`);
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: commits.join(""), stdio: ["pipe", "pipe", "pipe"] });
  execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/long"], { cwd: dir, stdio: "pipe" });
  const walk = (timeout) => gitStreamed(dir, ["log", "-z", "--name-status", "--format=%H", "--"], () => {}, { timeout, terminated: false });
  const CLOCK = 200;

  let started = performance.now();
  await walk(0);
  const whole = performance.now() - started;
  started = performance.now();
  await assert.rejects(walk(CLOCK), /^Error: git log exited SIGTERM/);
  const clocked = performance.now() - started;

  t.diagnostic(`whole walk ${Math.round(whole)} ms, with a ${CLOCK} ms clock ${Math.round(clocked)} ms`);
  // On Windows the walk must be long enough to tell from the clock, or the case this is for goes unheld.
  if (process.platform === "win32") assert.ok(whole > 4 * CLOCK, `the whole walk took ${Math.round(whole)} ms, too short to tell from a ${CLOCK} ms clock`);
  // Elsewhere only the rejection is held where it is not.
  if (whole > 4 * CLOCK) assert.ok(clocked < Math.min(whole / 2, CLOCK + 700), `settled after ${Math.round(clocked)} ms, against ${Math.round(whole)} ms for the whole walk`);
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
  await assert.rejects(
    () =>
      gitStreamed(dir, ["-c", "core.quotePath=false", "ls-files", "-z", "--"], () => {}, {
        maxFieldBytes: 1024,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
    /^Error: git ls-files sent one record past 1024 bytes$/
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
  writeFileSync(join(bin, "git"), "#!/bin/sh\nexec sleep 300\n", { mode: 0o755 });

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

test("the range diff pairs edited moves past the repository's own rename limit", async (t) => {
  // Inherited, a limit of 1 (or git's default 1000 on a large refactor) read every edited move as a
  // deletion and an addition: drift counted each file twice and the moved area read as greenfield.
  // Renamed as well as moved, since git pairs a moved file that keeps its name before the limit applies.
  const { diffRange } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir, git } = repo(t);
  const names = ["one", "two", "three"];
  for (const n of names) writeFileSync(join(dir, `${n}.ts`), `export const ${n} = "${n.repeat(20)}"\n`);
  git("add", "-A");
  git("commit", "-qm", "three");
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  mkdirSync(join(dir, "lib"));
  for (const n of names) {
    git("mv", `${n}.ts`, `lib/${n}-moved.ts`);
    writeFileSync(join(dir, "lib", `${n}-moved.ts`), `export const ${n} = "${n.repeat(20)}"\nexport const more = 1\n`);
  }
  git("add", "-A");
  git("commit", "-qm", "move and edit");
  git("config", "diff.renameLimit", "1");

  const range = await diffRange(dir, first, "HEAD");

  assert.deepEqual([...range.renames].sort(), names.map((n) => [`lib/${n}-moved.ts`, `${n}.ts`]).sort());
});

test("the files that differ from a commit name both paths of a move", async (t) => {
  // Git collapses a move to its new path once `diff.renames` is on, its default since 2.9.
  const { changedSinceWorktree } = await import("../plugins/anatomiya/lib/git.mjs");
  const { dir, git } = repo(t);
  git("mv", "a.ts", "moved.ts");

  assert.deepEqual([...(await changedSinceWorktree(dir, "HEAD"))].sort(), ["a.ts", "moved.ts"]);
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
  // The length the checkout holds, CRLF or not: git calls a file whose size moved changed
  // without reading it, and no driver runs for one, whatever is configured.
  const held = join(dir, "sub", "s.txt");
  writeFileSync(held, readFileSync(held, "utf8").replace("hello", "jello"));
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
  // By subcommand: a `-c` set for one call is part of how it is asked, not what.
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((c) => c.replace(/^(-c \S+ )+/, "")).filter((c) => !c.startsWith("config ")) : [];
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
  // same merge base three times and the same diff twice in one run. Whether
  // the commit still exists is the one question asked every time.
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
    ["merge-base", "rev-parse", "ls-tree", "diff"].map((sub) => [sub, spawned(sub)]),
    // One `rev-parse` for the commit a sha names, and one each time it is asked whether the commit is still there.
    [["merge-base", 1], ["rev-parse", 3], ["ls-tree", 1], ["diff", 1]],
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
  const { dir, git, first } = twoCommits(t);
  const absent = "f".repeat(40);
  // No common ancestor is an answer git gave, but a fetch can give the two one.
  const orphan = git("commit-tree", `${first}^{tree}`, "-m", "orphan").toString().trim();
  const answers = [];
  const calls = await gitCalls(t, async () => {
    for (let i = 0; i < 2; i++) {
      answers.push(await filesAt(dir, absent));
      answers.push(await diffRange(dir, first, absent));
      answers.push((await mergeBase(dir, first, absent)).failed);
      answers.push(await commitAt(dir, absent));
      answers.push(await mergeBase(dir, first, orphan));
    }
  });

  const unrelated = { found: false, failed: false, sha: null };
  assert.deepEqual(answers, [null, null, true, null, unrelated, null, null, true, null, unrelated]);
  const spawned = (sub) => calls.filter((c) => c.startsWith(`${sub} `)).length;
  assert.deepEqual(
    ["ls-tree", "diff", "merge-base"].map((sub) => [sub, spawned(sub)]),
    [["ls-tree", 2], ["diff", 2], ["merge-base", 4]],
    calls.join("\n")
  );
});

test("a read no git could be started for is asked again, never kept as the answer", { skip: process.platform === "win32" }, async (t) => {
  // An environment too large to start git with throws from the spawn itself,
  // and a kept answer would refuse that commit for the life of the process.
  const { dir, second } = twoCommits(t);
  process.env.GIT_ANATOMIYA_PAD = "x".repeat(4_000_000);
  try {
    await assert.rejects(() => commitAt(dir, second), /git could not be asked which commit [0-9a-f]{40} names: .*could not be started/s);
  } finally {
    delete process.env.GIT_ANATOMIYA_PAD;
  }
  assert.equal(await commitAt(dir, second), second);
});

test("a commit is there, is not there, or git could not be asked, and only the first two are answers", needsGitStub, async (t) => {
  // Measured on git 2.39.5 and 2.54: `rev-parse --verify --quiet` exits 1 for
  // a commit that is not there and 128 for a directory git cannot open, where
  // `cat-file -e` exits 128 for both. A git ended by a signal or a clock has no exit code.
  const { dir, second, git } = twoCommits(t);
  const absent = "f".repeat(40);
  assert.equal(await shaReachable(dir, second), true);
  assert.equal(await shaReachable(dir, absent), false, "git ran and said no");
  assert.equal(await shaReachable(dir, git("rev-parse", "HEAD^{tree}").toString().trim()), false, "a tree is no commit");
  assert.equal(await shaReachable(dir, "not a sha"), false, "no commit has this name, and git is not asked");

  const calls = gitAhead(t, unasked(ASKS_BY_ID));
  await assert.rejects(
    () => shaReachable(dir, second),
    new RegExp(`^Error: git could not be asked whether commit ${second} is still in this repository: git was ended by SIGTERM`)
  );
  calls.restore();
  assert.equal(await shaReachable(dir, second), true, "asked again, and answered");
});

test("a merge base git refuses for two commits it holds throws, and one for a name that is no commit is a failed one", needsGitStub, async (t) => {
  const { dir, first, second } = twoCommits(t);
  assert.deepEqual(await mergeBase(dir, first, "no-such-ref"), { found: false, failed: true, sha: null });
  gitAhead(t, `case " $* " in *' merge-base '*) echo 'fatal: refused' >&2; exit 128;; esac`);
  await assert.rejects(() => mergeBase(dir, first, second), (err) => err instanceof Unasked && /for the merge base of .*refused/.test(err.message));
});

test("a name git refuses without a word names no commit: a reflog entry past the log's end", async (t) => {
  // `rev-parse --verify --quiet` exits 128 for it and prints nothing, where a directory it cannot open says why.
  const { dir } = twoCommits(t);
  assert.equal(await commitAt(dir, "HEAD@{9999}"), null);
  await assert.rejects(() => commitAt(tmpdir(), "HEAD"), /git could not be asked which commit HEAD names: .*not a git repository/s);
});

test("a ref names a commit, names none, or git could not be asked, and only the first two are answers", needsGitStub, async (t) => {
  const { dir, second } = twoCommits(t);
  assert.equal(await commitAt(dir, "HEAD"), second);
  assert.equal(await commitAt(dir, "origin/nowhere"), null, "git ran and said no");
  assert.equal(await commitAt(dir, "HEAD^{tree}"), null, "a tree is no commit");
  assert.equal(await commitAt(dir, "--upload-pack=x"), null, "no ref has this name, and git is not asked");
  const empty = scratch(t, "anatomiya-no-commit-");
  execFileSync("git", ["init", "-q"], { cwd: empty, stdio: "pipe" });
  assert.equal(await commitAt(empty, "HEAD"), null, "a repository with no commit");

  const calls = gitAhead(t, unasked("*' rev-parse --verify '*"));
  await assert.rejects(() => commitAt(dir, "HEAD"), /^Error: git could not be asked which commit HEAD names: git was ended by SIGTERM/);
  await assert.rejects(() => headSha(dir), /git could not be asked which commit HEAD names/);
  // A full sha is the one question the memory keeps an answer to.
  await assert.rejects(() => commitAt(dir, second), /git could not be asked/);
  calls.restore();
  assert.equal(await commitAt(dir, second), second, "the refusal was not kept as the answer");
  assert.equal(await commitAt(dir, "HEAD"), second);
});

test("a git that refused is not a git that said no: only exit code 1 is", needsGitStub, async (t) => {
  // Exit code 128 is a directory git cannot open, whatever it holds.
  const { dir, second } = twoCommits(t);
  const nowhere = scratch(t, "anatomiya-no-repo-");
  await assert.rejects(() => shaReachable(nowhere, second), new RegExp(`^Error: git could not be asked whether commit ${second} is still in this repository: fatal: not a git repository`));
  await assert.rejects(() => commitAt(nowhere, "HEAD"), /^Error: git could not be asked which commit HEAD names: fatal: not a git repository/);
  await assert.rejects(() => commitAt(nowhere, second), /^Error: git could not be asked which commit [0-9a-f]{40} names: fatal: not a git repository/);

  let calls = gitAhead(t, exits("*' rev-parse --verify '*", 3));
  await assert.rejects(() => shaReachable(dir, second), /is still in this repository: git exited 3$/);
  await assert.rejects(() => commitAt(dir, "HEAD"), /which commit HEAD names: git exited 3$/);
  calls.restore();

  calls = gitAhead(t, exits("*' rev-parse --verify '*", 1));
  assert.equal(await shaReachable(dir, second), false, "the exit code is the answer, whatever is there");
  assert.equal(await commitAt(dir, "HEAD"), null);
  calls.restore();
  assert.equal(await commitAt(dir, second), second, "and a refusal was never kept as the answer");
});

test("a merge base git could not be asked for is kept apart from one git says is not there", needsGitStub, async (t) => {
  const { dir, first, second } = twoCommits(t);
  const calls = gitAhead(t, unasked("*' merge-base '*"));
  await assert.rejects(() => mergeBase(dir, first, second), (err) => err instanceof Unasked &&
    new RegExp(`^git could not be asked for the merge base of ${first} and ${second}: git was ended by SIGTERM`).test(err.message));
  // Read as no fork point, the drift and the check's range run to the ref's tip.
  await assert.rejects(() => resolveBaseRef(dir, first), new RegExp(`^Error: git could not be asked for the merge base of HEAD and ${first}: git was ended by SIGTERM`));
  calls.restore();

  // Exit code 1 with nothing printed is git saying the two share no commit.
  gitAhead(t, exits("*' merge-base '*", 1));
  const none = await mergeBase(dir, first, second);
  assert.deepEqual(none, { found: false, failed: false, sha: null });
  assert.deepEqual(await resolveBaseRef(dir, first), { ok: true, ref: first, sha: first, tip: first, forkPoint: false });
});

test("the merge base of a commit with itself still answers where the commit could not be asked about", needsGitStub, async (t) => {
  const { dir, second } = twoCommits(t);
  gitAhead(t, unasked("*' rev-parse --verify '*"));
  assert.deepEqual(await mergeBase(dir, second, second), { found: true, failed: false, sha: second }, "merge-base itself answered");
});

test("whether the repository folds case is yes, no, or a question git could not be asked", needsGitStub, async (t) => {
  const { dir } = repo(t);
  // `git init` writes the key on a volume that folds case.
  spawnSync("git", ["config", "--unset-all", "core.ignorecase"], { cwd: dir });
  assert.equal(await caseMagic(dir), "", "exit code 1 is git saying the key is not set");
  gitAhead(t, unasked("*' --get core.ignorecase '*"));
  await assert.rejects(() => caseMagic(dir), /^Error: git could not be asked whether this repository folds case: /);
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

test("past its bound the memory drops the oldest answer first, and a dropped sha is asked again", needsShebang, async (t) => {
  // A stand-in git that names whatever full sha it is asked about, so filling
  // the memory costs a shell per question rather than a commit each. What
  // earlier tests left is older still and goes first, so of this test's shas
  // only the first is dropped.
  const bin = scratch(t, "anatomiya-git-fill-");
  const log = join(bin, "asked");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase "$1" in config) exit 1 ;; esac\nsha="\${4%^\\{commit\\}}"\necho "$sha" >> '${log}'\necho "$sha"\n`,
    { mode: 0o755 }
  );
  const sha = (i) => (i + 1).toString(16).padStart(40, "0");
  const asked = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  let filled;
  let after;
  try {
    for (let i = 0; i <= 256; i++) assert.equal(await commitAt(bin, sha(i)), sha(i));
    filled = asked().length;
    rmSync(log);
    for (const i of [256, 0, 2, 1]) assert.equal(await commitAt(bin, sha(i)), sha(i));
    after = asked();
  } finally {
    process.env.PATH = path;
  }

  assert.equal(filled, 257);
  assert.deepEqual(after, [sha(0), sha(1)], "the first sha fell out, and asking it again pushed out the next oldest");
});

test("a commit pruned while the process runs reads as unreachable at once", async (t) => {
  // E3: reachability exists to notice a commit that went away, so it is never
  // answered from memory.
  const { dir, git, first, second } = twoCommits(t);
  git("checkout", "-q", "-b", "keep", first);
  assert.equal(await shaReachable(dir, second), true);

  for (const branch of git("branch", "--format=%(refname:short)").toString().trim().split("\n")) {
    if (branch !== "keep") git("branch", "-q", "-D", branch);
  }
  git("reflog", "expire", "--expire=now", "--all");
  git("gc", "-q", "--prune=now");

  assert.equal(await shaReachable(dir, second), false);
});

test("a listing read under one caller's bounds does not answer a caller with tighter ones", needsShebang, async (t) => {
  // A real git can answer inside a millisecond on a fast runner, so a stand-in
  // waits first: the unbounded caller always gets the listing, the 1 ms one never.
  const { dir, second } = twoCommits(t);
  const bin = scratch(t, "anatomiya-git-slow-");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\nsleep 0.3\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.deepEqual([...(await filesAt(dir, second))], ["a.ts", "b.ts"]);
    await assert.rejects(() => filesAt(dir, second, { timeout: 1 }), /git could not be asked which files [0-9a-f]{40} holds: git ls-tree exited SIGTERM/, "the tighter bound is asked, and git outlasts it");
  } finally {
    process.env.PATH = path;
  }
});

test("an answer one caller edits is not the answer the next caller of the same sha gets", async (t) => {
  const { dir, first, second } = twoCommits(t);

  const listing = await filesAt(dir, second);
  listing.delete("a.ts");
  listing.add("edited.ts");
  const range = await diffRange(dir, first, second);
  range.changed.clear();
  range.renames.set("edited.ts", "a.ts");

  assert.deepEqual([...(await filesAt(dir, second))], ["a.ts", "b.ts"]);
  const again = await diffRange(dir, first, second);
  assert.deepEqual([[...again.changed], [...again.renames]], [["b.ts"], []]);
});

/* --- one cat-file child answers every blob read at a revision --- */

const GITLINK = "1".repeat(40);

/**
 * One commit holding every kind of path a read can be asked for, and what the
 * per-call reader is known to say about each. The answers are written out, so
 * two readers that agreed on a wrong one would still fail.
 */
function awkwardRepo(t) {
  const { dir, git } = repo(t);
  const blobs = new Map([
    ["a\nb.ts", "newline\n"],
    ["cr.ts\r", "carriage return\n"],
    ["a\tb.ts", "tab\n"],
    ["-dash.ts", "dash\n"],
    ["a\\b.ts", "backslash\n"],
    ["caf\u00e9.ts", "utf-8 \u00e9\n"],
    ["empty.ts", ""],
    ["dir/inner.ts", "inner\n"],
    ["binary.bin", Buffer.from([0, 10, 0, 255, 0])],
    ["at-cap.ts", Buffer.alloc(MAX_FILE_BYTES, "x")],
    ["over-cap.ts", Buffer.alloc(MAX_FILE_BYTES + 1, "x")],
  ]);
  mkdirSync(join(dir, "dir"));
  for (const [rel, body] of blobs) writeFileSync(join(dir, rel), body);
  git("add", "-A");
  git("update-index", "--add", "--cacheinfo", `160000,${GITLINK},gitlink`);
  git("commit", "-qm", "awkward");
  const sha = git("rev-parse", "HEAD").toString().trim();

  const found = (rel) => [rel, { ok: true, bytes: Buffer.from(blobs.get(rel)).toString("hex") }];
  const expected = new Map([
    ...[...blobs.keys()].filter((rel) => rel !== "over-cap.ts").map(found),
    ["./a.ts", { ok: true, bytes: Buffer.from("export const a = 1\n").toString("hex") }],
    ["over-cap.ts", { ok: false, reason: "over size cap" }],
    ["dir", { ok: false, reason: "absent" }],
    ["", { ok: false, reason: "absent" }],
    ["gitlink", { ok: false, reason: "absent" }],
    ["missing.ts", { ok: false, reason: "absent" }],
    ["dir/missing.ts", { ok: false, reason: "absent" }],
    ["a.ts missing", { ok: false, reason: "absent" }],
    ["nul\0.ts", { ok: false, reason: "absent" }],
  ]);
  return { dir, sha, expected };
}

const answerOf = (blob) => (blob.ok ? { ok: true, bytes: blob.content.toString("hex") } : { ok: false, reason: blob.reason });

test("the batch reader and the per-call reader agree on every path", needsPosixPaths, async (t) => {
  const { dir, sha, expected } = awkwardRepo(t);
  const paths = [...expected.keys()];
  const reader = blobReader(dir, sha);
  t.after(() => reader.close());

  // Asked at once, so an answer handed to the wrong request would show.
  const batched = await Promise.all(paths.map((rel) => reader.read(rel)));

  for (const [i, rel] of paths.entries()) {
    const perCall = await showBlob(dir, sha, rel);
    assert.deepEqual(answerOf(perCall), expected.get(rel), `the per-call reader on ${JSON.stringify(rel)}`);
    assert.deepEqual(answerOf(batched[i]), expected.get(rel), `the batch reader on ${JSON.stringify(rel)}`);
  }
});

/**
 * A `git` that logs every call and, where `batch` or `perCall` is given, runs
 * that shell in place of the batch child or of a per-call read. `calls` is the
 * `cat-file` calls made so far.
 */
function gitShim(t, batch = null, perCall = null) {
  const bin = scratch(t, "anatomiya-git-shim-");
  const log = join(bin, "calls");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  const instead = [[batch, "'cat-file --batch -Z'"], [perCall, "'cat-file blob '*"]]
    .map(([run, call]) => (run === null ? "" : `case "$*" in ${call}) ${run({ bin, real })};; esac\n`))
    .join("");
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> '${log}'\n${instead}exec '${real}' "$@"\n`, { mode: 0o755 });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []).filter((c) => c.startsWith("cat-file "));
  return {
    bin,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    calls,
    batches: () => calls().filter((c) => c === "cat-file --batch -Z").length,
    perCall: () => calls().filter((c) => c.startsWith("cat-file blob ")).length,
  };
}

const A_TS = { ok: true, bytes: Buffer.from("export const a = 1\n").toString("hex") };
const ABSENT = { ok: false, reason: "absent" };
// What a read answers where git left no exit code: never the same as a path git says is not there.
const UNASKED = { ok: false, reason: "unasked" };

function oneCommit(t) {
  const { dir, git } = repo(t);
  return { dir, git, sha: git("rev-parse", "HEAD").toString().trim() };
}

test("a batch reader given a timeout that is no whole number of milliseconds asks git nothing", needsGitStub, async (t) => {
  const { dir, sha } = oneCommit(t);
  const calls = gitAhead(t);
  for (const timeout of [-1, Number.NaN, 1.5]) {
    const reader = blobReader(dir, sha, { timeout });
    assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED, String(timeout));
    await reader.close();
  }
  assert.deepEqual(calls(), []);
});

// Stops with the test, so a wait that never ends cannot outlive a timeout.
async function until(t, seen) {
  while (!seen()) await wait(20, undefined, { signal: t.signal });
}

function gone(pidFile) {
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), 0);
    return false;
  } catch {
    return true;
  }
}

// Longer than any of these takes on a loaded machine, and shorter than the
// 120 s a read waits on a stalled child, so a hand-over that only the clock
// made fails here.
const PROMPT = { timeout: 60_000 };

test("every read at a revision is answered by one child", { ...needsShebang, ...needsBatchZ }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const answers = await Promise.all(["a.ts", "gone.ts", "a.ts", "a.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [A_TS, ABSENT, A_TS, A_TS]);
  assert.deepEqual(shim.calls(), ["cat-file --batch -Z"]);
});

test("a git without -Z hands every read to the per-call reader", { ...needsShebang, ...PROMPT }, async (t) => {
  // A git older than 2.42 does not know the switch: it prints its usage and exits 129.
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, () => `echo "error: unknown switch 'Z'" >&2; exit 129`);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const answers = [];
  for (const rel of ["a.ts", "gone.ts", "a.ts"]) answers.push(answerOf(await reader.read(rel)));

  assert.deepEqual(answers, [A_TS, ABSENT, A_TS]);
  assert.equal(shim.batches(), 1, "one failed start, never a second");
  assert.equal(shim.perCall(), 3);
});

test("a child killed mid-reply hands the rest to the per-call reader", { ...needsShebang, ...PROMPT }, async (t) => {
  // A short body and then the end of the stream is all a reader sees of a kill.
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, () => `printf '${"a".repeat(40)} blob 19\\000export'; exit 0`);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const answers = await Promise.all(["a.ts", "gone.ts", "a.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [A_TS, ABSENT, A_TS], "the cut-off body is never the content");
  assert.equal(shim.batches(), 1);
  assert.equal(shim.perCall(), 3);
});

test("a child that stalls past the caller's timeout hands the rest to the per-call reader", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, () => "exec sleep 300");
  // The same clock bounds the read of the config and each per-call read after
  // the hand-over, so it is one a real git answers inside on a loaded machine.
  const reader = blobReader(dir, sha, { env: shim.env, timeout: 10_000 });
  t.after(() => reader.close());

  const answers = await Promise.all(["a.ts", "gone.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [A_TS, ABSENT]);
  assert.equal(shim.batches(), 1);
  assert.equal(shim.perCall(), 2);
});

test("a reply that is not a header hands the rest to the per-call reader", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  for (const reply of [
    "not a header\\000",
    // One byte of body, then a byte that is not the terminator.
    `${"a".repeat(40)} blob 1\\000xy`,
    // A whole reply, then bytes nobody asked for.
    `${"a".repeat(40)} blob 1\\000x\\000more`,
    `${sha}:a.ts missing\\000more`,
  ]) {
    const shim = gitShim(t, () => `printf '${reply}'; exec sleep 300`);
    const reader = blobReader(dir, sha, { env: shim.env });
    t.after(() => reader.close());

    assert.deepEqual(answerOf(await reader.read("a.ts")), A_TS, reply);
    assert.deepEqual(answerOf(await reader.read("gone.ts")), ABSENT, reply);
    assert.equal(shim.batches(), 1, reply);
  }
});

test("bytes that arrive with no request waiting end the child", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, ({ bin }) => [
    `echo $$ > '${bin}/pid'`,
    `printf '${sha}:gone.ts missing\\000'`,
    `while [ ! -e '${bin}/go' ]; do sleep 0.05; done`,
    "printf more",
    "exec sleep 300",
  ].join("; "));
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  assert.deepEqual(answerOf(await reader.read("gone.ts")), ABSENT, "answered by the child");
  assert.equal(shim.perCall(), 0);
  writeFileSync(join(shim.bin, "go"), "");
  await until(t, () => gone(join(shim.bin, "pid")));

  assert.deepEqual(answerOf(await reader.read("a.ts")), A_TS);
  assert.equal(shim.perCall(), 1, "and the next read did not wait on it");
});

test("a gitlink is absent, and the reads after it are still answered by the one child", { ...needsShebang, ...needsBatchZ }, async (t) => {
  const { dir, git } = repo(t);
  git("update-index", "--add", "--cacheinfo", `160000,${GITLINK},sub`);
  git("commit", "-qm", "gitlink");
  const sha = git("rev-parse", "HEAD").toString().trim();
  const shim = gitShim(t);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const answers = await Promise.all(["a.ts", "sub", "a.ts", "gone.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [A_TS, ABSENT, A_TS, ABSENT]);
  assert.deepEqual(shim.calls(), ["cat-file --batch -Z"]);
});

function withBigBlob(t) {
  const { dir, git } = repo(t);
  writeFileSync(join(dir, "big.ts"), Buffer.alloc(MAX_FILE_BYTES + 1, "x"));
  git("add", "-A");
  git("commit", "-qm", "big");
  return { dir, sha: git("rev-parse", "HEAD").toString().trim() };
}

test("the reads after a blob over the cap and after a directory still answer", async (t) => {
  const { dir, sha } = withBigBlob(t);
  const reader = blobReader(dir, sha);
  t.after(() => reader.close());

  const answers = await Promise.all(["a.ts", "big.ts", "a.ts", "", "gone.ts", "a.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [A_TS, { ok: false, reason: "over size cap" }, A_TS, ABSENT, ABSENT, A_TS]);
});

test("a reply whose body is not wanted ends that child, and the next read starts another", { ...needsShebang, ...needsBatchZ }, async (t) => {
  // The header carries the size, so a blob over the cap is refused before a
  // byte of it is read; a child left running would send it anyway.
  const { dir, sha } = withBigBlob(t);
  const shim = gitShim(t);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const answers = await Promise.all(["big.ts", "a.ts", "", "a\0.ts", "a.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map(answerOf), [{ ok: false, reason: "over size cap" }, A_TS, ABSENT, ABSENT, A_TS]);
  assert.equal(shim.batches(), 3, "one child, one more after the blob, one more after the tree");
  assert.equal(shim.perCall(), 0, "and nothing was handed to the per-call reader");
});

test("a sha that is not one is refused without starting a child", needsShebang, async (t) => {
  const { dir } = oneCommit(t);
  const shim = gitShim(t);
  const reader = blobReader(dir, "not-a-sha", { env: shim.env });
  t.after(() => reader.close());

  assert.deepEqual(await reader.read("a.ts"), { ok: false, reason: "bad sha" });
  assert.deepEqual(shim.calls(), []);
});

test("a git that cannot be started hands the read to the per-call reader", needsShebang, async (t) => {
  const { dir, sha } = oneCommit(t);
  // Answers the read of the repository's config and removes itself, so the
  // child is the first git this PATH does not hold.
  const bin = scratch(t, "anatomiya-git-once-");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\n/bin/rm -f "$0"\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const reader = blobReader(dir, sha, { env: { ...process.env, PATH: bin } });
  t.after(() => reader.close());

  assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED, "what the per-call reader says with no git to run");
  assert.equal(existsSync(join(bin, "git")), false, "the config was read, so the child was the call that failed");
});

test("a repository whose config cannot be read starts no child", needsShebang, async (t) => {
  const { dir, sha } = oneCommit(t);
  const broken = join(scratch(t, "anatomiya-git-config-"), "config");
  writeFileSync(broken, "[broken\n");
  let answer;

  const calls = await gitCalls(t, async () => {
    const reader = blobReader(dir, sha, { env: { ...process.env, GIT_CONFIG_GLOBAL: broken } });
    answer = await reader.read("a.ts");
    await reader.close();
  });

  assert.deepEqual(answerOf(answer), UNASKED, "as the per-call reader answers it");
  assert.deepEqual(calls, [], "nothing but the two reads of the config");
});

test("a reader told not to fetch leaves a missing blob missing, and one told to fetch reads it", async (t) => {
  const origin = repo(t);
  origin.git("config", "uploadpack.allowFilter", "true");
  const dir = scratch(t, "anatomiya-git-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  const blobId = execFileSync("git", ["rev-parse", `${head}:a.ts`], { cwd: dir }).toString().trim();
  const held = () => spawnSync("git", ["cat-file", "-e", blobId], { cwd: dir, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } }).status === 0;

  const local = blobReader(dir, head);
  t.after(() => local.close());
  assert.deepEqual(answerOf(await local.read("a.ts")), ABSENT);
  assert.equal(held(), false, "the object is still not in this clone");

  const fetching = blobReader(dir, head, { lazyFetch: true });
  t.after(() => fetching.close());
  assert.deepEqual(answerOf(await fetching.read("a.ts")), A_TS);
  assert.equal(held(), true);
});

test("a reader that has handed over still fetches, and still gives up on its caller's clock", { ...needsShebang, ...PROMPT }, async (t) => {
  const origin = repo(t);
  origin.git("config", "uploadpack.allowFilter", "true");
  const dir = scratch(t, "anatomiya-git-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  const refusesZ = () => "exit 129";

  const fetching = blobReader(dir, head, { lazyFetch: true, env: gitShim(t, refusesZ).env });
  t.after(() => fetching.close());
  assert.deepEqual(answerOf(await fetching.read("a.ts")), A_TS);

  const slow = gitShim(t, refusesZ, ({ bin }) => `echo $$ > '${bin}/pid'; exec sleep 300`);
  const stalled = blobReader(dir, head, { timeout: 10_000, env: slow.env });
  t.after(() => stalled.close());
  assert.deepEqual(answerOf(await stalled.read("a.ts")), UNASKED);
  // A config read that ran out of time answers unasked too, with no per-call read started.
  assert.equal(existsSync(join(slow.bin, "pid")), true, "the per-call read was running");
  assert.equal(gone(join(slow.bin, "pid")), true, "and the caller's clock ended it");
});

test("a reader nobody closed does not hold its process open", PROMPT, async (t) => {
  const { dir, sha } = oneCommit(t);
  const lib = new URL("../plugins/anatomiya/lib/git.mjs", import.meta.url).href;
  const script = `
    import { blobReader } from ${JSON.stringify(lib)};
    const blob = await blobReader(${JSON.stringify(dir)}, ${JSON.stringify(sha)}).read("a.ts");
    process.stdout.write(blob.content);
  `;

  const { stdout } = await runGit(process.execPath, ["--input-type=module", "-e", script]);

  assert.equal(stdout, "export const a = 1\n");
});

test("a closed reader leaves no clock running", async (t) => {
  const { dir, sha } = oneCommit(t);
  const lib = new URL("../plugins/anatomiya/lib/git.mjs", import.meta.url).href;
  const script = `
    import { blobReader } from ${JSON.stringify(lib)};
    const reader = blobReader(${JSON.stringify(dir)}, ${JSON.stringify(sha)});
    const blob = await reader.read("a.ts");
    await reader.close();
    process.stdout.write(JSON.stringify({ read: blob.ok, timers: process.getActiveResourcesInfo().filter((r) => r === "Timeout") }));
  `;

  const { stdout } = await runGit(process.execPath, ["--input-type=module", "-e", script]);

  assert.deepEqual(JSON.parse(stdout), { read: true, timers: [] });
});

test("closing a reader ends its child by closing stdin", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  // Stands in for a git that answers nothing: it reads to the end of stdin
  // and says so, after longer than a reader waits on a child by default.
  const shim = gitShim(t, ({ bin }) => `cat > /dev/null; sleep 2; touch '${bin}/eof'; exit 0`);
  // A grace no loaded machine outlasts, so only the end of stdin can be what ended the child.
  const reader = blobReader(dir, sha, { env: shim.env, closeGrace: 30_000 });

  const read = reader.read("a.ts");
  await until(t, () => shim.batches() === 1);
  await reader.close();

  assert.equal(existsSync(join(shim.bin, "eof")), true, "the child saw its stdin end and left on its own");
  assert.deepEqual(answerOf(await read), A_TS, "and the read it never answered was not lost");
});

test("closing a reader kills a child that will not leave", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, ({ bin }) => `echo $$ > '${bin}/pid'; exec sleep 300`);
  // Waited out once before the kill, and the room a starved runner needs to reap the child after it.
  const reader = blobReader(dir, sha, { env: shim.env, closeGrace: 5_000 });

  const read = reader.read("a.ts");
  await until(t, () => existsSync(join(shim.bin, "pid")) && readFileSync(join(shim.bin, "pid"), "utf8").trim() !== "");
  await reader.close();

  assert.equal(gone(join(shim.bin, "pid")), true, "the child is gone by the time close answers");
  assert.deepEqual(answerOf(await read), A_TS);
});

test("a reader closed before its child started never starts one", needsShebang, async (t) => {
  // Closed at once, and closed while the repository's config is still being read.
  for (const pause of [() => {}, () => new Promise(setImmediate)]) {
    const { dir, sha } = oneCommit(t);
    const shim = gitShim(t);
    const reader = blobReader(dir, sha, { env: shim.env });

    const read = reader.read("a.ts");
    await pause();
    await reader.close();

    assert.deepEqual(answerOf(await read), A_TS);
    assert.equal(shim.batches(), 0);
    assert.equal(shim.perCall(), 1);
  }
});

test("a reader with no descriptors left for a child answers as the per-call reader does", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const lib = new URL("../plugins/anatomiya/lib/git.mjs", import.meta.url).href;
  const said = `(asked) => asked.then((answer) => answer ?? "resolved", (err) => "rejected: " + err.message)`;
  const script = `
    import { closeSync, openSync } from "node:fs";
    import { blobReader, showBlob } from ${JSON.stringify(lib)};
    const [dir, sha] = ${JSON.stringify([dir, sha])};
    const said = ${said};
    // The repository's config is read while a git can still be started.
    const out = { warm: (await showBlob(dir, sha, "a.ts")).ok };
    const held = [];
    try {
      for (;;) held.push(openSync("/dev/null", "r"));
    } catch {
      // Every descriptor this process may hold is open.
    }
    try {
      const reader = blobReader(dir, sha);
      out.perCall = await said(showBlob(dir, sha, "a.ts"));
      out.first = await said(reader.read("a.ts"));
      out.second = await said(reader.read("a.ts"));
      out.closed = await said(reader.close());
      out.again = await said(reader.close());
    } finally {
      for (const fd of held) closeSync(fd);
    }
    process.stdout.write(JSON.stringify(out));
  `;

  // The limit is lowered for this one child, so the machine's own table is
  // never the one that fills. In a process group of its own, because a kill
  // sent to a child that never started is a kill of the sender's group.
  const starved = spawn("sh", ["-c", 'ulimit -n 64 && exec "$0" --input-type=module -e "$1"', process.execPath, script], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  starved.stdout.on("data", (chunk) => (stdout += chunk));
  const [code, signal] = await once(starved, "close");

  assert.deepEqual({ code, signal }, { code: 0, signal: null });
  const got = JSON.parse(stdout);
  for (const read of ["perCall", "first", "second"]) {
    assert.match(got[read].error, /^git could not be asked for a\.ts at [0-9a-f]{40}: spawn git EMFILE/, read);
    got[read] = answerOf(got[read]);
  }
  assert.deepEqual(got, {
    warm: true,
    perCall: UNASKED,
    first: UNASKED,
    second: UNASKED,
    closed: "resolved",
    again: "resolved",
  });
});

test("a streamed read with no descriptors left for its git is rejected as a git that failed to start", { ...needsShebang, ...PROMPT }, async (t) => {
  // Measured on Node 22: spawn then hands back a child with no pipes and
  // queues its error, so a pipe read first is a TypeError and the error after
  // it has no listener, which ends the process.
  const { dir } = oneCommit(t);
  const lib = new URL("../plugins/anatomiya/lib/git.mjs", import.meta.url).href;
  const script = `
    import { closeSync, openSync } from "node:fs";
    import { gitBuffered, gitStreamed } from ${JSON.stringify(lib)};
    const dir = ${JSON.stringify(dir)};
    // The repository's config is read while a git can still be started.
    const out = { warm: (await gitBuffered(dir, ["rev-parse", "HEAD"])).ok };
    const held = [];
    try {
      for (;;) held.push(openSync("/dev/null", "r"));
    } catch {
      // Every descriptor this process may hold is open.
    }
    try {
      out.read = await gitStreamed(dir, ["ls-files", "-z", "--"], () => {}).then(() => "resolved", (err) => "rejected: " + err.message);
      out.fed = await gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, { input: "x" }).then(() => "resolved", (err) => "rejected: " + err.message);
      // A turn of the loop, for an error nobody listened to.
      await new Promise(setImmediate);
    } finally {
      for (const fd of held) closeSync(fd);
    }
    process.stdout.write(JSON.stringify(out));
  `;

  // The limit is lowered for this one child, in a process group of its own, so
  // the machine's own table is never the one that fills.
  const starved = spawn("sh", ["-c", 'ulimit -n 64 && exec "$0" --input-type=module -e "$1"', process.execPath, script], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  starved.stdout.on("data", (chunk) => (stdout += chunk));
  starved.stderr.on("data", (chunk) => (stderr += chunk));
  const [code, signal] = await once(starved, "close");

  assert.deepEqual({ code, signal }, { code: 0, signal: null }, stderr);
  const out = JSON.parse(stdout);
  assert.equal(out.warm, true);
  assert.match(out.read, /^rejected: git ls-files failed: spawn git (EMFILE|ENFILE)/);
  assert.match(out.fed, /^rejected: git ls-files failed: spawn git (EMFILE|ENFILE)/);
});

test("a streamed read whose pipe fails is rejected, and the failure ends no process", PROMPT, async (t) => {
  // A stream's `error` with no listener is an uncaught exception. No real git
  // breaks its own pipe on request, so the pipes are found as they are listened
  // to and failed by hand, in a process of its own.
  const { dir } = oneCommit(t);
  const lib = new URL("../plugins/anatomiya/lib/git.mjs", import.meta.url).href;
  const script = `
    import { Socket } from "node:net";
    import { gitBuffered, gitStreamed } from ${JSON.stringify(lib)};
    const dir = ${JSON.stringify(dir)};
    const out = { warm: (await gitBuffered(dir, ["rev-parse", "HEAD"])).ok };
    const on = Socket.prototype.on;
    const failing = (count) => {
      const pipes = new Set();
      Socket.prototype.on = function (event, ...rest) {
        if (event === "data" && !pipes.has(this) && pipes.add(this).size === count) queueMicrotask(() => this.destroy(new Error("read EIO")));
        return on.call(this, event, ...rest);
      };
      return gitStreamed(dir, ["ls-files", "-z", "--"], () => {}).then(() => "resolved", (err) => "rejected: " + err.message).finally(() => (Socket.prototype.on = on));
    };
    // The order the runner listens in: stderr, then stdout.
    out.stderr = await failing(1);
    out.stdout = await failing(2);
    await new Promise(setImmediate);
    process.stdout.write(JSON.stringify(out));
  `;
  const run = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  run.stdout.on("data", (chunk) => (stdout += chunk));
  run.stderr.on("data", (chunk) => (stderr += chunk));
  const [code, signal] = await once(run, "close");

  assert.deepEqual({ code, signal }, { code: 0, signal: null }, stderr);
  // What git wrote to stderr only words a failure, so losing it fails nothing.
  assert.deepEqual(JSON.parse(stdout), { warm: true, stderr: "resolved", stdout: "rejected: git ls-files failed: read EIO" });
});

test("a child whose start throws hands every read to the per-call reader", async (t) => {
  const { dir, sha } = oneCommit(t);
  // Node refuses a NUL in an environment value before it starts anything, and
  // the config already read for this repository is not asked for again.
  const env = { ...process.env, ANATOMIYA_NUL: "a\0b" };
  assert.deepEqual(answerOf(await showBlob(dir, sha, "a.ts")), A_TS);
  const reader = blobReader(dir, sha, { env });

  assert.deepEqual(answerOf(await showBlob(dir, sha, "a.ts", { env })), UNASKED, "what the per-call reader says");
  assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED);
  assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED);
  await reader.close();
  await reader.close();
});

test("a streamed read whose start throws is rejected as a git that failed to start", async (t) => {
  const { dir } = oneCommit(t);
  assert.equal((await gitBuffered(dir, ["rev-parse", "HEAD"])).ok, true, "the repository's config is read");
  const env = { ...process.env, ANATOMIYA_NUL: "a\0b" };
  await assert.rejects(gitStreamed(dir, ["ls-files", "-z", "--"], () => {}, { env }), /^Error: git ls-files failed: .*null bytes/);
});

test("a fault in building git's environment is thrown, not read as a configuration nobody could read", async (t) => {
  const { dir } = oneCommit(t);
  await assert.rejects(() => gitBuffered(dir, ["rev-parse", "HEAD"], { env: null }), TypeError);
});

test("an environment Node refuses is an answer where the repository's config is not yet read", async (t) => {
  // Node throws from the call that would read the config, before any git starts.
  const env = { ...process.env, ANATOMIYA_NUL: "a\0b" };
  const said = (asked) => asked.then((answer) => answer, (err) => `rejected: ${err.message}`);
  const fresh = () => oneCommit(t);

  let { dir, sha } = fresh();
  assert.deepEqual(answerOf(await said(showBlob(dir, sha, "a.ts", { env }))), UNASKED, "the per-call reader");

  ({ dir, sha } = fresh());
  const buffered = await said(gitBuffered(dir, ["rev-parse", "HEAD"], { env }));
  assert.deepEqual({ ok: buffered.ok, code: buffered.code, stdout: buffered.stdout }, { ok: false, code: null, stdout: "" });
  assert.match(buffered.error, /could not read which commands this repository's config names/);

  // A streamed read has handed part of its output on, so a rejection is how it says no.
  ({ dir, sha } = fresh());
  assert.match(
    await said(gitStreamed(dir, ["ls-tree", "-r", "--name-only", "-z", sha], () => {}, { env })),
    /^rejected: git ls-tree: could not read which commands this repository's config names/
  );

  ({ dir, sha } = fresh());
  const reader = blobReader(dir, sha, { env });
  assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED);
  assert.deepEqual(answerOf(await reader.read("a.ts")), UNASKED);
  await reader.close();
});

test("a fetching reader's child never fetches, and the blobs a clone does not hold are fetched side by side", { ...needsShebang, ...needsBatchZ, ...PROMPT }, async (t) => {
  const origin = repo(t);
  const unheld = ["b.ts", "c.ts", "d.ts"];
  for (const rel of unheld) writeFileSync(join(origin.dir, rel), `export const ${rel[0]} = 1\n`);
  origin.git("add", "-A");
  origin.git("commit", "-qm", "more");
  origin.git("config", "uploadpack.allowFilter", "true");
  const dir = scratch(t, "anatomiya-git-partial-");
  execFileSync("git", ["clone", "-q", "--no-checkout", "--filter=blob:none", `file://${origin.dir}`, dir], { stdio: "pipe" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  // One blob the clone holds, fetched by a plain git.
  execFileSync("git", ["cat-file", "blob", `${head}:a.ts`], { cwd: dir, stdio: "pipe" });
  const shim = gitShim(
    t,
    ({ bin, real }) => `echo "\${GIT_NO_LAZY_FETCH-unset}" > '${bin}/batch-no-lazy-fetch'; exec '${real}' "$@"`,
    // Each per-call read waits for a second one to be running before it asks
    // git, so reads made in turn never get past the first. Bounded so that one
    // nobody joins does not outlive the test.
    ({ bin, real }) => [
      `: > '${bin}/alive.'$$`,
      "n=0",
      `while [ "$(ls '${bin}' | grep -c '^alive')" -lt 2 ] && [ $n -lt 2400 ]; do sleep 0.05; n=$((n+1)); done`,
      `exec '${real}' "$@"`,
    ].join("; ")
  );
  const reader = blobReader(dir, head, { lazyFetch: true, env: shim.env });
  t.after(() => reader.close());

  // The held blob last, so a child that left over a missing one could not answer it.
  const answers = await Promise.all([...unheld, "a.ts"].map((rel) => reader.read(rel)));

  assert.deepEqual(answers.map((blob) => blob.ok && blob.content.toString()), [
    "export const b = 1\n",
    "export const c = 1\n",
    "export const d = 1\n",
    "export const a = 1\n",
  ]);
  assert.equal(readFileSync(join(shim.bin, "batch-no-lazy-fetch"), "utf8"), "1\n", "the child was told not to fetch");
  assert.equal(shim.batches(), 1, "and it stayed up to answer what the clone holds");
  assert.equal(shim.perCall(), 3, "one per-call read for each blob the clone did not hold");
});

test("a child that has closed its stdin hands the next read to the per-call reader", { ...needsShebang, ...PROMPT }, async (t) => {
  // Nobody holds the other end, so a request written to it is an EPIPE: the
  // second on a pipe, and already the first where the streams are sockets.
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, () => `exec <&-; printf '${sha}:gone.ts missing\\000'; exec sleep 300`);
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  assert.deepEqual(answerOf(await reader.read("gone.ts")), ABSENT);
  // Under the 120 s a read waits on a silent child, so only the error on stdin ends this in time.
  assert.deepEqual(answerOf(await reader.read("a.ts")), A_TS);
  assert.equal(shim.batches(), 1);
});

test("a header that arrives in two pieces is read as one", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  const oid = "a".repeat(40);
  const shim = gitShim(t, ({ bin }) => [
    // Cut inside the type, so the second piece alone is no header at all.
    `printf '${oid} bl'`,
    `: > '${bin}/half'`,
    `while [ ! -e '${bin}/go' ]; do sleep 0.05; done`,
    `printf 'ob 19\\000export const a = 1\\n\\000'`,
    "exec sleep 300",
  ].join("; "));
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  const read = reader.read("a.ts");
  // The first piece is in the pipe before the file that says so exists. The
  // wait sees the file from a timer, and the check phase this resumes in comes
  // after that turn's poll phase, which reads the piece: the second one is let
  // through only then, with no clock.
  await until(t, () => existsSync(join(shim.bin, "half")));
  await new Promise(setImmediate);
  writeFileSync(join(shim.bin, "go"), "");

  assert.deepEqual(answerOf(await read), A_TS);
  assert.equal(shim.perCall(), 0, "answered by the child");
});

test("a child that sends more than a header can hold with no end to it hands over", { ...needsShebang, ...PROMPT }, async (t) => {
  // Under the 120 s a read waits on a silent child, so only the bound on a header ends this in time.
  const { dir, sha } = oneCommit(t);
  const shim = gitShim(t, () => "printf '%0500d' 0; exec sleep 300");
  const reader = blobReader(dir, sha, { env: shim.env });
  t.after(() => reader.close());

  assert.deepEqual(answerOf(await reader.read("a.ts")), A_TS);
  assert.equal(shim.perCall(), 1);
});

test("closing a reader whose child has already exited does not wait for it", { ...needsShebang, ...PROMPT }, async (t) => {
  // The shell leaves and a process it started keeps the pipes: an exited
  // child whose streams have not closed, so the reader has not heard of it.
  const { dir, sha } = oneCommit(t);
  let holder = null;
  // Ahead of the shim directory's own removal, which takes the pid with it.
  t.after(() => killPidIn(holder));
  const shim = gitShim(t, ({ bin }) => `sleep 300 & echo $! > '${bin}/holder'; echo $$ > '${bin}/pid'; exit 0`);
  holder = join(shim.bin, "holder");
  // A grace past this test's own bound, so a close that waits it out fails.
  const reader = blobReader(dir, sha, { env: shim.env, closeGrace: 600_000 });

  const read = reader.read("a.ts");
  await until(t, () => existsSync(join(shim.bin, "pid")) && gone(join(shim.bin, "pid")));
  await reader.close();

  assert.deepEqual(answerOf(await read), A_TS);
});

test("a child ended for a reply nobody wanted is gone when its reader has closed", { ...needsShebang, ...needsBatchZ, ...PROMPT }, async (t) => {
  const { dir, sha } = withBigBlob(t);
  const shim = gitShim(t, ({ bin, real }) => `echo $$ > '${bin}/pid'; exec '${real}' "$@"`);
  // Room a starved runner needs to reap a killed child, and no wait where it is reaped at once.
  const reader = blobReader(dir, sha, { env: shim.env, closeGrace: 30_000 });

  assert.deepEqual(answerOf(await reader.read("big.ts")), { ok: false, reason: "over size cap" });
  await reader.close();

  assert.equal(existsSync(join(shim.bin, "pid")), true, "a child was started, so there was one to end");
  assert.equal(gone(join(shim.bin, "pid")), true);
});

test("a git behind a launcher stops when the reply it is sending is refused", { ...needsShebang, ...PROMPT }, async (t) => {
  const { dir, sha } = oneCommit(t);
  // Git for Windows starts the real git as the child of a launcher, and a signal ends the launcher alone.
  // The one behind it here writes its pid, answers a blob past the cap and never stops sending it.
  let shim = null;
  // Ahead of the shim's own removal, which takes the pid with it.
  t.after(() => killPidIn(join(shim.bin, "behind")));
  shim = gitShim(
    t,
    ({ bin }) =>
      `exec 3<&0; sh -c 'echo $$ > "$0"; head -c 1 > /dev/null; printf "%040d blob ${MAX_FILE_BYTES + 1}\\000" 0; exec yes' '${bin}/behind' <&3 & wait; exit`
  );
  const reader = blobReader(dir, sha, { env: shim.env, closeGrace: 30_000 });

  assert.deepEqual(answerOf(await reader.read("a.ts")), { ok: false, reason: "over size cap" });
  await reader.close();

  assert.equal(existsSync(join(shim.bin, "behind")), true, "a git was started behind the launcher, so there was one to stop");
  await until(t, () => gone(join(shim.bin, "behind")));
});

// On Windows the reader's child is such a launcher. The loop is held from the read's answer to the removal,
// so nothing this process reads lets a git that is still sending finish: it has to stop for want of a reader.
test("a repository is free to be removed once its reader has refused a reply", { ...needsBatchZ, ...PROMPT }, async (t) => {
  const { dir, sha } = withBigBlob(t);
  const reader = blobReader(dir, sha, { closeGrace: 30_000 });
  t.after(() => reader.close());

  assert.deepEqual(answerOf(await reader.read("big.ts")), { ok: false, reason: "over size cap" });

  const refusal = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
      return null;
    } catch (err) {
      return err.code;
    }
  };
  const nap = new Int32Array(new SharedArrayBuffer(4));
  let code = refusal();
  for (let tries = 100; code !== null && tries > 0; tries--) {
    Atomics.wait(nap, 0, 0, 100);
    code = refusal();
  }
  assert.equal(code, null);
});

test("a listing or a range git could not be asked for throws, and one git refused answers null", needsGitStub, async (t) => {
  const { dir, first, second } = twoCommits(t);
  const absent = "0".repeat(40);
  assert.equal(await filesAt(dir, absent), null, "git ran and refused: exit code 128");
  assert.equal(await diffRange(dir, absent, second), null);
  assert.equal(await changedSinceWorktree(dir, absent), null);

  const calls = gitAhead(t, unasked("*' ls-tree '*|*' diff '*"));
  await assert.rejects(() => filesAt(dir, second), new RegExp(`^Error: git could not be asked which files ${second} holds: git ls-tree exited SIGTERM`));
  await assert.rejects(() => diffRange(dir, first, second), new RegExp(`^Error: git could not be asked what changed from ${first} to ${second}: git diff exited SIGTERM`));
  await assert.rejects(() => changedSinceWorktree(dir, second), new RegExp(`^Error: git could not be asked which files differ from ${second}: git diff exited SIGTERM`));
  for (const read of [() => filesAt(dir, second), () => diffRange(dir, first, second)]) {
    await assert.rejects(read, (err) => err instanceof Unasked);
  }
  calls.restore();
  assert.deepEqual([...(await filesAt(dir, second))], ["a.ts", "b.ts"], "asked again, and answered");
  assert.deepEqual([...(await diffRange(dir, first, second)).changed], ["b.ts"]);
});

test("a streamed read rejects as unasked where git left no exit code, and as refused where it left one", needsGitStub, async (t) => {
  const { dir } = twoCommits(t);
  const read = () => gitStreamed(dir, ["ls-files", "-z"], () => true);
  await assert.rejects(() => gitStreamed(dir, ["ls-files", "--no-such-flag"], () => true), (err) => err instanceof Unasked, "an argument this tool refuses");
  let calls = gitAhead(t, exits("*' ls-files '*", 3));
  await assert.rejects(read, (err) => !(err instanceof Unasked) && /git ls-files exited 3/.test(err.message));
  calls.restore();
  calls = gitAhead(t, unasked("*' ls-files '*"));
  await assert.rejects(read, (err) => err instanceof Unasked && /git ls-files exited SIGTERM/.test(err.message));
  calls.restore();
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(() => gitStreamed(dir, ["ls-files", "-z"], () => true, { signal: stopped.signal }), (err) => !(err instanceof Unasked), "a read its caller stopped is the caller's own");
});

test("a blob git could not be asked for is unasked, never absent, through either reader", needsGitStub, async (t) => {
  const { dir, second } = twoCommits(t);
  assert.deepEqual(await showBlob(dir, second, "nowhere.ts"), { ok: false, reason: "absent" });

  gitAhead(t, unasked("*' cat-file '*"));
  const one = await showBlob(dir, second, "a.ts");
  assert.deepEqual([one.ok, one.reason], [false, "unasked"]);
  assert.match(one.error, new RegExp(`^git could not be asked for a.ts at ${second}: git was ended by SIGTERM`));
  // The batch child dies too, and its read falls to the per-call reader, which could not ask either.
  const reader = blobReader(dir, second);
  t.after(() => reader.close());
  const batched = await reader.read("a.ts");
  assert.deepEqual([batched.ok, batched.reason], [false, "unasked"]);
});

/* --- a question asked by its kind, and a git scripted in git's place --- */

test("ask answers with git's exit code and what it printed, whatever the code, and throws where git gave none", async (t) => {
  const { dir } = repo(t);
  assert.deepEqual(await ask(dir, ["rev-parse", "--is-shallow-repository"], "whether this clone is shallow"), { code: 0, stdout: "false\n", said: "" });
  const missing = await ask(dir, ["rev-parse", "--verify", "--quiet", "nothing-here^{commit}"], "which commit nothing-here names");
  assert.deepEqual([missing.code, missing.stdout], [1, ""]);
  assert.equal(missing.said, "git exited 1", "a code git left with nothing said is still worded");

  const restore = answerWith((args) => (args.includes("--is-shallow-repository") ? { signal: "SIGTERM" } : null));
  t.after(restore);
  await assert.rejects(ask(dir, ["rev-parse", "--is-shallow-repository"], "whether this clone is shallow"), (err) => err instanceof Unasked && /^git could not be asked whether this clone is shallow: .*SIGTERM/.test(err.message));
});

test("askWhether is git's yes or no, and anything else is no answer", async (t) => {
  const { dir } = repo(t);
  const asked = (args) => askWhether(dir, args, "whether it holds");
  assert.equal(await asked(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]), true);
  assert.equal(await asked(["rev-parse", "--verify", "--quiet", "nothing-here^{commit}"]), false);
  t.after(answerWith((args) => (args.includes("refused") ? { code: 128, stderr: "fatal: not today" } : null)));
  await assert.rejects(asked(["rev-parse", "--verify", "--quiet", "refused"]), (err) => err instanceof Unasked && /fatal: not today/.test(err.message));
});

test("a question git could not be asked answers what the caller chose for it, and any other failure passes on", async () => {
  assert.equal(await Promise.reject(new Unasked("x")).catch(unaskedAs(null)), null);
  await assert.rejects(Promise.reject(new Error("refused")).catch(unaskedAs(null)), /refused/);
});

test("a git scripted in git's place answers the buffered and the streamed reads, and the rest go to git", async (t) => {
  const { dir } = repo(t);
  const seen = [];
  const restore = answerWith((args) => {
    seen.push(args.join(" "));
    if (args.includes("ls-files")) return { stdout: "a.ts\0b.ts\0" };
    if (args.includes("cat-file")) return { signal: "SIGTERM" };
    if (args.includes("log")) return { code: 128, stderr: "fatal: bad revision" };
    return null;
  });
  const fields = [];
  await gitStreamed(dir, ["ls-files", "-z", "--"], (f) => { if (f) fields.push(f); });
  assert.deepEqual(fields, ["a.ts", "b.ts"]);
  await assert.rejects(gitStreamed(dir, ["cat-file", "--batch-check"], () => {}), (err) => err instanceof Unasked);
  await assert.rejects(gitStreamed(dir, ["log", "--format=%H"], () => {}), (err) => !(err instanceof Unasked) && /exited 128: fatal: bad revision/.test(err.message));
  assert.equal((await ask(dir, ["rev-parse", "--is-shallow-repository"], "whether this clone is shallow")).stdout, "false\n", "an unscripted call runs git");
  // A blob is read through the scripted git too, which the batch reader cannot be.
  await assert.rejects(Promise.resolve(blobReader(dir, "0".repeat(40)).read("a.ts")).then((r) => { if (r.reason === "unasked") throw new Unasked(r.error); return r; }), (err) => err instanceof Unasked);
  restore();
  assert.ok(seen.some((s) => s.startsWith("ls-files")) && seen.some((s) => s.startsWith("rev-parse")));
  const after = [];
  await gitStreamed(dir, ["ls-files", "-z", "--"], (f) => { if (f) after.push(f); });
  assert.notDeepEqual(after, ["a.ts", "b.ts"], "the stand-in is gone once restored");
});

test("a scripted git that never answers is ended by its clock, as a stalled git is", { timeout: 10_000 }, async (t) => {
  const { dir } = repo(t);
  t.after(answerWith((args) => (args.includes("--is-shallow-repository") ? new Promise(() => {}) : null)));

  await assert.rejects(ask(dir, ["rev-parse", "--is-shallow-repository"], "whether this clone is shallow", { timeout: 50 }), (err) => err instanceof Unasked && /after 50 ms/.test(err.message));
});

test("two scripted gits undone in the order t.after runs them leave neither behind", async (t) => {
  const { dir } = repo(t);
  const shallow = () => ask(dir, ["rev-parse", "--is-shallow-repository"], "whether this clone is shallow");
  const asked = (outcome) => (args) => (args.includes("--is-shallow-repository") ? outcome : null);
  const first = answerWith(asked({ signal: "SIGTERM" }));
  const second = answerWith(asked({ code: 128, stderr: "fatal: the second" }));
  first();
  assert.equal((await shallow()).said, "fatal: the second", "undoing the first leaves the second answering");
  second();
  assert.equal((await shallow()).stdout, "false\n", "undoing both leaves git");
});

test("a scripted blob is handed over as the bytes it was scripted with", async (t) => {
  const { dir } = repo(t);
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
  t.after(answerWith((args) => (args.includes("cat-file") ? { stdout: bytes } : null)));
  assert.deepEqual(await showBlob(dir, "a".repeat(40), "a.ts"), { ok: true, content: bytes });
});

test("a repository top git names as an empty line is no repository, never the directory the process runs in", async (t) => {
  const { dir } = repo(t);
  // git prints forward slashes on Windows, so the answer is held to a real path as `gitRoot` holds it.
  assert.equal(realpathSync.native(await topLevel(dir)), realpathSync.native(dir));
  t.after(answerWith((args) => (args.includes("--show-toplevel") ? { stdout: "\n" } : null)));
  await assert.rejects(topLevel(dir, "there"), /^Error: not a git repository: there$/);
});

test("a scripted read past its bound is refused as one past the bound, and a caller that stops a scripted stream is answered", async (t) => {
  const { dir } = repo(t);
  t.after(answerWith((args) => (args.includes("cat-file") ? { stdout: "x".repeat(64) } : args.includes("ls-files") ? { stdout: "a\0b\0c\0" } : null)));
  const r = await gitBuffered(dir, ["cat-file", "blob", "HEAD:a.ts"], { maxBytes: 16 });
  assert.deepEqual([r.ok, r.oversize, r.code], [false, true, null]);
  const seen = [];
  await gitStreamed(dir, ["ls-files", "-z", "--"], (f) => {
    seen.push(f);
    return false;
  });
  assert.deepEqual(seen, ["a"]);
});

