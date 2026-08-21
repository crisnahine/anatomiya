import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsPosixPermissions, needsSymlinks } from "./platform.mjs";
import { cached, firstTime, nextTurn, ownState, stateDirFor, sweep } from "../ultracode-anywhere/hooks/counters.mjs";

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

test("sweeping a directory that is not there is not an error", () => {
  assert.equal(sweep(join(tmpdir(), "ultracode-anywhere-absent-directory")), 0);
});

test("the state directory belongs to one user, not to everyone on the machine", () => {
  const shared = stateDirFor({});
  const mine = stateDirFor({ ULTRACODE_ANYWHERE_STATE: "/somewhere/else" });

  assert.equal(mine, "/somewhere/else");
  assert.match(shared, /ultracode-anywhere/);
  if (process.platform !== "win32") assert.match(shared, /ultracode-anywhere-\d+$/);
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
  writeFileSync(join(real, "a-session"), "victim content");
  symlinkSync(real, link);

  assert.equal(nextTurn(link, "a-session"), 1);
  assert.equal(nextTurn(link, "a-session"), 1, "and it never starts counting");
  assert.equal(sweep(link), 0);
  assert.equal(readFileSync(join(real, "a-session"), "utf8"), "victim content");
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

test("a counter file holding anything but a number starts the session over rather than going silent", (t) => {
  // Under `set -u` the shell version aborted on this line and printed nothing,
  // so one corrupt file switched the plugin off for that session with no error
  // anyone would see. A count that cannot be read is a count of zero.
  const dir = stateDir(t);
  const session = "corrupt-1";
  writeFileSync(join(dir, session), "not a number");

  assert.equal(nextTurn(dir, session), 1);
  assert.match(readFileSync(join(dir, session), "utf8"), /^1$/);
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
