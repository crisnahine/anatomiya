import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execFileSync } from "node:child_process";

import { needsPosixPermissions, needsPosixSpecialFiles, needsSymlinks } from "./platform.mjs";
import { SWEEP_MOST, appendLine, cached, firstTime, nextTurn, ownState, startOver, stateDirFor, sweep } from "../ultracode-anywhere/hooks/counters.mjs";

/** A state directory of its own, so one test's turn count cannot reach another's. */
function stateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-counters-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// --- the turn counter ---------------------------------------------------------

test("a session id that is not a plain name writes nothing, inside the state directory or above it", (t) => {
  const dir = stateDir(t);
  const above = join(dir, "..", "escape");

  assert.equal(nextTurn(dir, "../escape"), 1);
  assert.equal(nextTurn(dir, ""), 1);
  assert.deepEqual(readdirSync(dir), [], "a name that is not a file name is not made into one");
  assert.equal(existsSync(above), false, "and it certainly does not land beside the directory");
});

test("counters outlive their session by a week, not forever", (t) => {
  const dir = stateDir(t);
  const old = join(dir, "ended-long-ago");
  const fresh = join(dir, "still-going");
  writeFileSync(old, "4");
  writeFileSync(fresh, "4");
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(old, eightDaysAgo, eightDaysAgo);

  assert.equal(sweep(dir), 1);
  assert.deepEqual(readdirSync(dir), ["still-going"], "a session still running keeps its count");
});

test("the sweep removes counters, not whatever else is in the directory", (t) => {
  // The state path is a switch a user can point anywhere, and a hook that
  // deletes week-old files from a directory someone else fills is a hook that
  // eats their files.
  const dir = stateDir(t);
  const longAgo = (Date.now() - 30 * 86_400_000) / 1000;
  for (const [name, body] of [["important.conf", "keep me"], ["a-session", "7"], ["notes.md", "12"]]) {
    writeFileSync(join(dir, name), body);
    utimesSync(join(dir, name), longAgo, longAgo);
  }

  assert.equal(sweep(dir), 1);
  assert.deepEqual(readdirSync(dir).sort(), ["important.conf", "notes.md"]);
});

test("sweeping a directory that is not there is not an error", (t) => {
  // Under a test's own scratch path: `ownState` creates what it is asked about,
  // and a fixed name under the shared temporary directory is the class the
  // plugin itself moved out of.
  assert.equal(sweep(join(stateDir(t), "absent")), 0);
});

test("a state directory that is a symlink is refused, so nothing is written or deleted through it", needsSymlinks, (t) => {
  // A predictable path under the temporary directory is a path another account
  // can create first. Followed, the counter write truncates whatever the link
  // points at and the sweep deletes week-old files beside it.
  const dir = stateDir(t);
  const real = join(dir, "real");
  const link = join(dir, "link");
  mkdirSync(real, { recursive: true, mode: 0o700 });
  chmodSync(real, 0o700);
  // The victim holds a count: text is refused by the corrupt-counter guard
  // whatever the directory is, so only a number proves the link arm.
  writeFileSync(join(real, "a-session"), "5");
  symlinkSync(real, link);

  assert.equal(nextTurn(link, "a-session"), 1);
  assert.equal(nextTurn(link, "a-session"), 1, "and it never starts counting");
  assert.equal(sweep(link), 0);
  assert.equal(readFileSync(join(real, "a-session"), "utf8"), "5", "and the count behind the link is not advanced");
});

test("a state directory other accounts can write to is refused", needsPosixPermissions, (t) => {
  const dir = stateDir(t);
  chmodSync(dir, 0o777);

  assert.equal(nextTurn(dir, "a-session"), 1);
  assert.deepEqual(readdirSync(dir), []);
});

test("a state path that is a file costs the session its cadence, not its reminder", (t) => {
  const dir = stateDir(t);
  const file = join(dir, "not-a-directory");
  writeFileSync(file, "");

  assert.equal(nextTurn(file, "a-session"), 1);
  assert.equal(nextTurn(file, "a-session"), 1);
  assert.equal(readFileSync(file, "utf8"), "", "and it does not write over the file either");
});

test("a counter holding anything but a number starts the session over rather than going silent", (t) => {
  // A count that cannot be read is a count of zero, and the turn still gets its
  // reminder. What it does not do is write over the file: the state path is a
  // switch, so a file with anything else in it is one somebody else put there.
  const dir = stateDir(t);
  writeFileSync(join(dir, "corrupt-1"), "not a number");

  assert.equal(nextTurn(dir, "corrupt-1"), 1);
  assert.equal(readFileSync(join(dir, "corrupt-1"), "utf8"), "not a number");
});

test("a counter this plugin started and did not finish is its own to write again", (t) => {
  // An interrupted write leaves a file of no bytes, which is the one empty
  // shape here that belongs to this plugin rather than to a user.
  const dir = stateDir(t);
  writeFileSync(join(dir, "half-written"), "");

  assert.equal(nextTurn(dir, "half-written"), 1);
  assert.equal(nextTurn(dir, "half-written"), 2, "and it counts on from there");
});

// --- a counter that is not the file it should be ------------------------------

test("a counter standing as a symlink is not written through", needsSymlinks, (t) => {
  // The directory is this account's own, so this is the second lock rather than
  // the first: a file replaced inside it between two turns is still not a file
  // worth truncating.
  const dir = stateDir(t);
  const victim = join(dir, "victim");
  writeFileSync(victim, "not a counter");
  symlinkSync(victim, join(dir, "a-session"));

  assert.equal(nextTurn(dir, "a-session"), 1);
  assert.equal(readFileSync(victim, "utf8"), "not a counter");
});

// --- a session that starts over -----------------------------------------------

test("a session told to start over counts from one again", (t) => {
  const dir = stateDir(t);
  nextTurn(dir, "compacted");
  nextTurn(dir, "compacted");

  assert.equal(startOver(dir, "compacted"), true);
  assert.equal(nextTurn(dir, "compacted"), 1);
  assert.equal(startOver(dir, "never-counted"), false, "a session with no count has nothing to forget");
});

test("starting over forgets a counter and nothing else standing in its place", needsSymlinks, (t) => {
  const dir = stateDir(t);
  writeFileSync(join(dir, "notes"), "not a count");
  writeFileSync(join(dir, "elsewhere"), "40");
  symlinkSync(join(dir, "elsewhere"), join(dir, "linked"));

  assert.equal(startOver(dir, "notes"), false);
  assert.equal(startOver(dir, "linked"), false);
  assert.equal(readFileSync(join(dir, "notes"), "utf8"), "not a count");
  assert.equal(existsSync(join(dir, "linked")), true, "the link stands where it stood");
  assert.equal(readFileSync(join(dir, "elsewhere"), "utf8"), "40");
});

// --- marks that are said once -------------------------------------------------

test("a mark is first said once, then never again", (t) => {
  const dir = stateDir(t);

  assert.equal(firstTime(dir, "cap-said"), true);
  assert.equal(firstTime(dir, "cap-said"), false);
  assert.equal(firstTime(dir, "another"), true, "marks are told apart by name");
});

test("a mark in a directory that is not ours is said again rather than written", needsSymlinks, (t) => {
  // Writing here bypassed the ownership rule the counters already keep: with
  // the state path a symlink, the mark landed in the link's target.
  const dir = stateDir(t);
  const real = join(dir, "real");
  mkdirSync(real, { recursive: true, mode: 0o700 });
  chmodSync(real, 0o700);
  symlinkSync(real, join(dir, "link"));

  assert.equal(firstTime(join(dir, "link"), "cap-said"), true);
  assert.equal(firstTime(join(dir, "link"), "cap-said"), true, "and again, since nothing was written");
  assert.deepEqual(readdirSync(real), []);
});

test("the state directory a mark or a counter refuses is one whose own mode lets others in", needsPosixPermissions, (t) => {
  const dir = stateDir(t);
  chmodSync(dir, 0o777);

  assert.equal(ownState(dir), false);
  assert.equal(stateDirFor({ ULTRACODE_ANYWHERE_STATE: dir }), dir);
});

test("state lives in this account's own configuration directory, not in the shared temporary one", () => {
  // Every guard here exists because the old path sat under a directory every
  // account on the machine can write to. Keeping state out of it removes the
  // class rather than defending against it, and the guards stay for the switch
  // below, which a user can still point anywhere.
  assert.equal(stateDirFor({ CLAUDE_CONFIG_DIR: "/somewhere/config" }), join("/somewhere/config", "ultracode-anywhere"));
  assert.equal(stateDirFor({ HOME: "/home/someone" }), join("/home/someone", ".claude", "ultracode-anywhere"));
  assert.equal(stateDirFor({ ULTRACODE_ANYWHERE_STATE: "/chosen" }), "/chosen");
  assert.doesNotMatch(stateDirFor({ HOME: "/home/someone" }), /tmp/i);
});

test("a machine with no home to write into keeps no state rather than keeping it anywhere", (t) => {
  // The temporary directory is the one place a plugin can always write and the
  // one place it should not. Without a home there is nowhere of this account's
  // own, so the session loses its cadence and keeps its reminder.
  assert.equal(stateDirFor({ HOME: "", USERPROFILE: "" }), "");
  assert.equal(ownState(""), false);
  assert.equal(nextTurn("", "a-session"), 1);
  assert.equal(sweep(""), 0);
  assert.equal(firstTime("", "cap-said"), true);
  assert.equal(cached("", "drift", "k", () => "answer"), "answer");
});

// --- an answer worth keeping between turns ------------------------------------

test("an answer is computed once for a key and read back after that", (t) => {
  const dir = stateDir(t);
  let runs = 0;
  const compute = () => {
    runs++;
    return "the answer";
  };

  assert.equal(cached(dir, "strict", "build-1", compute), "the answer");
  assert.equal(cached(dir, "strict", "build-1", compute), "the answer");
  assert.equal(runs, 1, "the second turn reads the file rather than the build");
});

test("a new key is a new answer, and the old one does not survive it", (t) => {
  const dir = stateDir(t);

  assert.equal(cached(dir, "strict", "build-1", () => "first"), "first");
  assert.equal(cached(dir, "strict", "build-2", () => "second"), "second");
  assert.equal(cached(dir, "strict", "build-2", () => "third"), "second", "the key it was computed for is the one stored");
  assert.deepEqual(readdirSync(dir), [".strict"], "one file, not one per build ever installed");
});

test("an empty answer is remembered as an answer, not as nothing to remember", (t) => {
  const dir = stateDir(t);
  let runs = 0;

  cached(dir, "strict", "k", () => {
    runs++;
    return null;
  });
  cached(dir, "strict", "k", () => {
    runs++;
    return null;
  });

  assert.equal(runs, 1);
});

test("a state directory that is not ours costs the cache, not the answer", needsPosixPermissions, (t) => {
  const dir = stateDir(t);
  chmodSync(dir, 0o777);
  let runs = 0;
  const compute = () => {
    runs++;
    return "answer";
  };

  assert.equal(cached(dir, "strict", "k", compute), "answer");
  assert.equal(cached(dir, "strict", "k", compute), "answer");
  assert.equal(runs, 2, "it is computed every time rather than written where it should not be");
});

test("a file in the state directory that is not a counter is left as it is", (t) => {
  // The state path is a switch, and the session id decides a file name inside
  // it. A turn wrote over whatever stood there, which cost a 3 GB file its
  // contents in one reproduction.
  const dir = stateDir(t);
  writeFileSync(join(dir, "notes"), "notes the hook did not write");

  assert.equal(nextTurn(dir, "notes"), 1);
  assert.equal(readFileSync(join(dir, "notes"), "utf8"), "notes the hook did not write");
});

test("a counter that is not a plain file costs the cadence and not the turn", needsPosixSpecialFiles, (t) => {
  const dir = stateDir(t);
  execFileSync("mkfifo", [join(dir, "fifo-session")]);

  assert.equal(nextTurn(dir, "fifo-session"), 1);
  assert.equal(nextTurn(dir, "fifo-session"), 1, "and it does not wait on it either");
});

test("a state directory that is a plain file is refused by its own arm, whatever its mode", needsPosixPermissions, (t) => {
  const dir = stateDir(t);
  const file = join(dir, "state-file");
  writeFileSync(file, "");
  chmodSync(file, 0o600);

  assert.equal(ownState(file), false);
});

test("a mark or an answer may only be kept under a plain name", (t) => {
  const dir = stateDir(t);

  assert.equal(firstTime(dir, "../escape"), true);
  assert.equal(cached(dir, "../escape", "k", () => "answer"), "answer");
  assert.deepEqual(readdirSync(dir), [], "a name that is not a file name is not made into one");
});

test("a sweep of a directory holding more than it should stops rather than reading all of it", (t) => {
  const dir = stateDir(t);
  const longAgo = (Date.now() - 30 * 86_400_000) / 1000;
  for (let i = 0; i < SWEEP_MOST + 20; i++) {
    const path = join(dir, `session-${i}`);
    writeFileSync(path, "3");
    utimesSync(path, longAgo, longAgo);
  }

  assert.equal(sweep(dir), SWEEP_MOST, "one turn's worth, and the rest on the turns after");
});

test("a sweep reads a bounded number of entries, not every file in the directory", (t) => {
  // The cap is on what it looks at, not on what it removes: a directory full of
  // counters that are all too fresh to remove read two seconds of a five second
  // budget while removing nothing.
  const dir = stateDir(t);
  for (let i = 0; i < 700; i++) writeFileSync(join(dir, `fresh-${i}`), "3");
  const longAgo = (Date.now() - 30 * 86_400_000) / 1000;
  writeFileSync(join(dir, "zz-old"), "3");
  utimesSync(join(dir, "zz-old"), longAgo, longAgo);

  assert.equal(SWEEP_MOST, 500);
  assert.equal(sweep(dir), 0, "the old one sits past the bound, and the next turn reaches it");
  assert.equal(readdirSync(dir).length, 701);
});

test("a mark file of no bytes is one already made, not one to make again forever", (t) => {
  // Written with O_EXCL, so a crash between the create and the write leaves an
  // empty file: read as "never said", the line it guards came back every
  // session and the write that would stop it always failed.
  const dir = stateDir(t);
  writeFileSync(join(dir, ".cap-said"), "");

  assert.equal(firstTime(dir, "cap-said"), false);
});

test("an answer larger than the cache reads back is not written at all", (t) => {
  const dir = stateDir(t);
  let runs = 0;
  const long = "x".repeat(8000);

  assert.equal(cached(dir, "big", "k", () => { runs++; return long; }), long);
  assert.equal(cached(dir, "big", "k", () => { runs++; return long; }), long);
  assert.equal(runs, 2, "it is computed again rather than half-read back");
  assert.deepEqual(readdirSync(dir), [], "and nothing is left behind that cannot be read");
});

test("a counter reached through a symlink is not read through it either", needsSymlinks, (t) => {
  // The write already refused a link standing where a counter should be. The
  // read followed one, so a counter pointed at a file full of digits counted
  // that file's turns.
  const dir = stateDir(t);
  writeFileSync(join(dir, "elsewhere"), "40");
  symlinkSync(join(dir, "elsewhere"), join(dir, "linked-session"));

  assert.equal(nextTurn(dir, "linked-session"), 1, "the link is not the counter it points at");
  assert.equal(readFileSync(join(dir, "elsewhere"), "utf8"), "40");
});

test("a debug log or a cache that is a fifo with no reader is not waited on", needsPosixSpecialFiles, (t) => {
  // The read side opens non-blocking so a fifo cannot hold a turn. The write
  // side did not, and `ULTRACODE_ANYWHERE_DEBUG` at a fifo held every prompt
  // of the session to the hook timeout.
  const dir = stateDir(t);
  execFileSync("mkfifo", [join(dir, "debug.log")]);
  execFileSync("mkfifo", [join(dir, ".drift")]);

  const started = Date.now();
  appendLine(join(dir, "debug.log"), "a line\n");
  assert.equal(cached(dir, "drift", "k", () => "answer"), "answer");

  assert.equal(Date.now() - started < 3000, true, "and the turn goes on without either");
});
