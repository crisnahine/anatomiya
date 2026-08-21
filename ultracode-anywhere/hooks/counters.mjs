/**
 * Where this plugin keeps what it has to remember between turns, and the rule
 * that decides whether it may write there at all.
 *
 * One session's turn count, and the marks that stop a once-per-machine line
 * arriving forever. The path is predictable, so on a shared machine another
 * account can create it first as a symlink: followed, a counter write truncates
 * whatever it points at and the sweep deletes week-old files beside it, both
 * reproduced on a temporary directory here (A28). Every refusal here answers as
 * though this were the first turn, which is a full reminder rather than silence.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from "node:fs";

import { readOwnFile } from "./hook-io.mjs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** A counter older than this has outlived the session that wrote it. */
const KEEP_DAYS = 7;

/**
 * Entries one sweep will look at, whether or not it removes them. A sweep runs
 * on a turn, and a directory holding fifty thousand counters too fresh to
 * remove read two seconds of a five second budget looking at all of them; what
 * this does not reach on one turn it reaches on the next.
 */
export const SWEEP_MOST = 500;

/**
 * A session id is a file name here, so it may hold only what a file name may
 * hold. Refused rather than stripped: two ids differing only in what a strip
 * removes would share one counter, and `../x` would quietly become `x`.
 */
const COUNTER_NAME = /^[A-Za-z0-9_-]{1,128}$/;

/** A mark and a cache share the dotfile namespace, and neither may leave it. */
const MARK_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** An answer this long is not one worth keeping: it is read back with the same bound. */
const MOST_KEPT = 4096;

/**
 * Where the counters live: beside the rest of this account's Claude Code state.
 *
 * Never the temporary directory. Every guard below exists because a predictable
 * path under a directory every account can write to is one another account can
 * create first, and keeping state out of it removes that class rather than
 * defending against it. The guards stay for the switch, which a user can point
 * anywhere.
 *
 * A machine with no home to write into gets no state, and the session loses its
 * cadence rather than its reminder: the one place a plugin can always write is
 * the one place this should not.
 */
export function stateDirFor(env = process.env) {
  if (env.ULTRACODE_ANYWHERE_STATE) return env.ULTRACODE_ANYWHERE_STATE;

  const home = homeOf(env);
  const config = env.CLAUDE_CONFIG_DIR || (home && join(home, ".claude"));
  return config ? join(config, "ultracode-anywhere") : "";
}

/** The home this account keeps its configuration in, and nothing when it has none. */
function homeOf(env) {
  const named = env.HOME || env.USERPROFILE;
  if (named) return named;
  if ("HOME" in env || "USERPROFILE" in env) return "";
  try {
    return homedir();
  } catch {
    return "";
  }
}

/** Whether the state directory is one this account owns and no other account can write to. */
export function ownState(dir) {
  if (!dir) return false;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // An existing directory is the ordinary case; whether it is ours is the
    // next question either way.
  }
  try {
    const seen = lstatSync(dir);
    if (!seen.isDirectory()) return false;
    if (process.platform === "win32") return true;
    return seen.uid === userInfo().uid && (seen.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/**
 * This turn's number in its session, counting from one.
 *
 * Any answer but a number is a session starting over: a count that cannot be
 * read is a count of zero, and a count that cannot be written costs the session
 * its cadence rather than its reminder.
 */
export function nextTurn(dir, session) {
  const name = COUNTER_NAME.test(String(session ?? "")) ? String(session) : null;
  if (!name || !ownState(dir)) return 1;
  const path = join(dir, name);

  // A file standing where this session's counter would go, holding anything but
  // a count, belongs to whoever put it there. The state path is a switch, so
  // that is a file a user pointed this at, and writing over it cost a 3 GB file
  // its contents in one reproduction.
  const held = readOwnFile(path, 64).trim();
  if (held !== "" && !/^\d{1,15}$/.test(held)) return 1;
  if (held === "" && standsThere(path) && !isEmptyFile(path)) return 1;

  const turn = (held === "" ? 0 : Number(held)) + 1;
  try {
    write(path, String(turn), constants.O_TRUNC);
  } catch {
    // The turn is still this turn; only the next one loses its place.
  }
  return turn;
}

/** Whether anything at all stands at a path, symlinks and fifos included. */
function standsThere(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A counter this plugin started writing and did not finish is still its own. */
function isEmptyFile(path) {
  try {
    const seen = lstatSync(path);
    return seen.isFile() && seen.size === 0;
  } catch {
    return false;
  }
}

/** The turns a counter has recorded, and zero for anything that is not a count. */
function countIn(path) {
  const seen = readOwnFile(path, 64).trim();
  return /^\d{1,15}$/.test(seen) ? Number(seen) : 0;
}

/**
 * Whether this is the first time `mark` has been asked for on this machine, and
 * marking it if so.
 *
 * For a line worth saying once: a setting to change, a version to look at. It
 * answers true where it cannot write, since saying such a line twice costs less
 * than never saying it.
 */
export function firstTime(dir, mark) {
  if (!MARK_NAME.test(mark)) return true;
  const path = join(dir, `.${mark}`);
  if (!ownState(dir)) return true;
  // Anything standing there is a mark already made: written with O_EXCL, a
  // crash between the create and the write leaves a file of no bytes, and read
  // as "never said" the line it guards comes back every session for ever.
  if (standsThere(path)) return false;
  {
    try {
      write(path, "said\n", constants.O_EXCL);
    } catch {
      // Racing another session for the same mark, or a directory that turned
      // unwritable between the two calls.
    }
    return true;
  }
}

/**
 * An answer worth computing once, kept beside the counters under the key it was
 * computed for.
 *
 * For a question whose answer costs more than a turn should: reading a 321 MB
 * build is 180 ms against a hook timeout of 5 seconds. The key is what the
 * answer depends on, so an upgrade in place is a new key rather than a stale
 * yes, and one file holds the current answer rather than one per build ever
 * installed. A directory this may not write costs the cache, not the answer.
 */
export function cached(dir, name, key, compute) {
  const path = join(dir, `.${name}`);
  const usable = MARK_NAME.test(name) && ownState(dir);

  if (usable) {
    const [stored, ...rest] = readOwnFile(path, MOST_KEPT * 2).split("\n");
    if (stored && stored === key) return rest.join("\n") || null;
  }

  let answer;
  try {
    answer = compute();
    if (String(answer ?? "").length > MOST_KEPT) return answer;
  } catch (err) {
    // A compute that refuses to answer is one whose answer is not worth
    // keeping, and the caller asked for the refusal rather than a value.
    if (err instanceof Unkept) return err.answer;
    throw err;
  }
  if (usable) {
    try {
      write(path, `${key}\n${answer ?? ""}`, constants.O_TRUNC);
    } catch {
      // An answer that cannot be kept is one computed again next turn.
    }
  }
  return answer;
}

/** Thrown by a compute whose answer must not be kept, carrying what to answer now. */
export class Unkept extends Error {
  constructor(answer = null) {
    super("not worth keeping");
    this.answer = answer;
  }
}

/**
 * A file written without following a symlink standing where it should be. The
 * directory is this account's own, but a write to a path someone else can
 * replace is not a write worth making.
 */
function write(path, body, mode) {
  const flags = constants.O_WRONLY | constants.O_CREAT | mode | (constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(path, flags, 0o600);
    writeSync(fd, body);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * A line onto the end of a file the caller named, without following a link
 * standing where it should be. The debug switch points at a path a user chose,
 * often a predictable one under the temporary directory.
 */
export function appendLine(path, body) {
  try {
    write(path, body, constants.O_APPEND);
  } catch {
    // A debug switch that cannot write is not worth failing a turn over.
  }
}

/**
 * Counters left by sessions that ended.
 *
 * A counter is a file named like a session holding a count and nothing else.
 * The state path is a switch a user can point anywhere, so anything that is not
 * one of this plugin's own counters is left where it is.
 */
export function sweep(dir, now = Date.now()) {
  if (!ownState(dir)) return 0;

  let removed = 0;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  let looked = 0;
  for (const entry of entries) {
    if (looked >= SWEEP_MOST) break;
    if (!COUNTER_NAME.test(entry)) continue;
    looked++;
    const path = join(dir, entry);
    try {
      if (!lstatSync(path).isFile()) continue;
      if (countIn(path) === 0) continue;
      if (now - lstatSync(path).mtimeMs < KEEP_DAYS * 86_400_000) continue;
      rmSync(path, { force: true });
      removed++;
    } catch {
      // A counter that cannot be read or removed is not this turn's problem.
    }
  }
  return removed;
}
