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
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

/** A counter older than this has outlived the session that wrote it. */
const KEEP_DAYS = 7;

/**
 * A session id is a file name here, so it may hold only what a file name may
 * hold. Refused rather than stripped: two ids differing only in what a strip
 * removes would share one counter, and `../x` would quietly become `x`.
 */
const COUNTER_NAME = /^[A-Za-z0-9_-]{1,128}$/;

/** Where the counters live: this user's own directory, not one shared with every account on the box. */
export function stateDirFor(env = process.env) {
  if (env.ULTRACODE_ANYWHERE_STATE) return env.ULTRACODE_ANYWHERE_STATE;
  let who = "";
  try {
    who = String(userInfo().uid ?? "");
  } catch {
    who = "";
  }
  return join(tmpdir(), `ultracode-anywhere${who === "" ? "" : `-${who}`}`);
}

/** Whether the state directory is one this account owns and no other account can write to. */
export function ownState(dir) {
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

  const turn = countIn(path) + 1;
  try {
    write(path, String(turn), constants.O_TRUNC);
  } catch {
    // The turn is still this turn; only the next one loses its place.
  }
  return turn;
}

/** The turns a counter has recorded, and zero for anything that is not a count. */
function countIn(path) {
  let seen = "";
  try {
    seen = readFileSync(path, "utf8").trim();
  } catch {
    return 0;
  }
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
  const path = join(dir, `.${mark}`);
  if (!ownState(dir)) return true;
  try {
    readFileSync(path, "utf8");
    return false;
  } catch {
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
 * build is 190 ms against a hook timeout of 5 seconds. The key is what the
 * answer depends on, so an upgrade in place is a new key rather than a stale
 * yes, and one file holds the current answer rather than one per build ever
 * installed. A directory this may not write costs the cache, not the answer.
 */
export function cached(dir, name, key, compute) {
  const path = join(dir, `.${name}`);
  const usable = ownState(dir);

  if (usable) {
    try {
      const [stored, ...rest] = readFileSync(path, "utf8").split("\n");
      if (stored === key) return rest.join("\n") || null;
    } catch {
      // Nothing kept for this key yet, which is what computing is for.
    }
  }

  const answer = compute();
  if (usable) {
    try {
      write(path, `${key}\n${answer ?? ""}`, constants.O_TRUNC);
    } catch {
      // An answer that cannot be kept is one computed again next turn.
    }
  }
  return answer;
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
  for (const entry of entries) {
    if (!COUNTER_NAME.test(entry)) continue;
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
