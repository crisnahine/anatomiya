/**
 * The one lock both the echo and the refresh worker take: an exclusive create,
 * and a dead lock broken one generation at a time. What makes a lock dead is
 * each caller's own, so it is passed in as a judge: the echo reads the lock's
 * mtime against the hook timeout (A92), the refresh worker its owner's pid and
 * age (A95).
 *
 * A judge answers `null` where the lock is gone, `{ live: true }`, which may
 * name its `generation` too, or `{ live: false, generation, identity }`:
 * `generation` names the lock's token, and the lock is removed only while the
 * judge, asked again under that token, still answers it dead with the same
 * `identity` (the generation where it gives none).
 */
import { createHash } from "node:crypto";
import { closeSync, linkSync, lstatSync, opendirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { readHead } from "./rules.mjs";
import { writeTemp } from "./store.mjs";

/**
 * Creates `path` with an exclusive create: true where this call made it, false where a file holds the name.
 *
 * With `content`, the lock appears whole or not at all: written beside it and linked into place, which
 * fails with EEXIST exactly as `wx` does. Opened with `wx` and filled in after, it was empty for a moment,
 * and a worker reading it then judged it abandoned (A95). A filesystem with no hard links takes the `wx`
 * path, so a link refused for any other reason falls through to it at once.
 *
 * Windows answers EPERM, not EEXIST, for a name another process is still deleting, which frees in
 * milliseconds; a refusal that outlasts the backoff is thrown, and the caller answers alone.
 */
export function createdAlone(path, content = null) {
  const temp = content === null ? null : writeTemp(path, content);
  try {
    if (temp !== null) {
      try {
        linkSync(temp, path);
        return true;
      } catch (err) {
        if (err?.code === "EEXIST") return false;
      }
    }
    const fd = openedAlone(path);
    if (fd === null) return false;
    try {
      if (content !== null) writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    return true;
  } finally {
    if (temp !== null) {
      try {
        unlinkSync(temp);
      } catch {
        // Already gone; nothing of ours is left.
      }
    }
  }
}

function openedAlone(path) {
  for (let tries = 0; ; tries++) {
    try {
      return openSync(path, "wx");
    } catch (err) {
      if (err?.code === "EEXIST") return null;
      if (err?.code !== "EPERM" || tries === DELETING_RETRIES) throw err;
    }
    Atomics.wait(PAUSE, 0, 0, 2 ** tries);
  }
}

// Seven waits doubling from 1 ms: 127 ms asked for, longer on a coarse timer.
const DELETING_RETRIES = 7;
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/**
 * Breaks the lock where `judge` finds it dead, then makes the one create of it; true where this call holds it.
 *
 * The right to remove one dead generation goes to whichever call creates the token named by it, and that
 * call removes the lock only while it is still that generation. Every other call goes to the one create,
 * and the losers stay out. Moving a dead lock aside instead freed the name for a third call while the
 * first holder still held it.
 *
 * A token older than any break could hold it was left by a call killed mid-break, and left in place it
 * turned every later call away from that dead lock for good. So a token is itself a lock, judged by its
 * mtime and broken by this same protocol, one level down and no further. Unlinked by age alone, two calls
 * finding one old token could both remove it, the second taking the first's fresh one. What is left: a
 * breaker suspended past the bound, which the next call takes for dead (A92 accepts the same of a holder);
 * and a breaker killed holding a token's own token, which nothing here breaks, so the lock stays taken
 * until a sweep clears it: the echo's day-old sweep, or for the refresh worker, which answers busy till
 * then, the scan's store sweep (`leftTokens`).
 */
export function takeDeadLock(lock, judge, content = null) {
  return broken(lock, judge, content, 1);
}

function broken(lock, judge, content, levels) {
  const found = judge(lock);
  if (found?.live) return false;
  if (found !== null) {
    const token = `${lock}.${found.generation}`;
    if (createdAlone(token) || (levels > 0 && broken(token, TOKEN_AGE, null, levels - 1))) {
      try {
        const now = judge(lock);
        if (now !== null && !now.live && sameGeneration(now, found)) removeDeadLock(lock);
      } finally {
        removeLockToken(token);
      }
    }
  }
  return createdAlone(lock, content);
}

// Each judge derives the generation from its identity, so the identity alone decides.
const sameGeneration = (a, b) => (a.identity ?? a.generation) === (b.identity ?? b.generation);

/** Removes a dead lock; one the system will not let go of is thrown, so the caller answers alone rather than wait on it for good. */
function removeDeadLock(lock) {
  try {
    unlinkSync(lock);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

/**
 * Removes a lock token; one the system refuses to remove is left behind. It names a generation no call
 * breaks again: a later dead lock takes its name only after the clock is set back, or by a nonce repeated.
 */
function removeLockToken(path) {
  try {
    unlinkSync(path);
  } catch {
    // Still there, or gone already.
  }
}

/**
 * The echo's judge: a lock whose mtime is within `heldMostMs + slackMs` of the clock, either way, is live.
 * Its generation is the mtime in ms, and the inode and the mtime in ns are what must still match: read
 * exactly, since an NTFS file id runs past what a float holds.
 */
export const mtimeAge = ({ heldMostMs, slackMs, now = Date.now }) => (path) => {
  const found = lstatOf(path);
  if (found === null) return null;
  if (Math.abs(now() - Number(found.mtimeMs)) <= heldMostMs + slackMs) return { live: true };
  return { live: false, generation: String(found.mtimeMs), identity: `${found.ino}:${found.mtimeNs}` };
};

// A break takes microseconds; a minute, plus the 2 s a FAT mtime can be off by, is far past any live breaker.
const TOKEN_AGE = mtimeAge({ heldMostMs: 60_000, slackMs: 2000 });

/**
 * The refresh worker's judge, over the lock's `{pid, at, nonce}`: dead where it does not parse, its pid is
 * not an integer or its `at` not a number, it is older than `staleMs` or stamped later than now, or its
 * process is gone. Its generation is its nonce, and the whole content is what must still match; a lock
 * with no nonce of ours is named by a digest of what was read, so its token is still one name of ours.
 */
export const ownerAge = ({ staleMs, now = Date.now, alive = processAlive }) => (path) => {
  if (lstatOf(path) === null) return null;
  // Bounded and typed, since the directory can come with the repository: a lock
  // planted as a link to `/dev/zero` read whole never returned. Ours is under 100 bytes.
  const entry = readHead(path, 256);
  const content = entry.kind === "file" ? entry.head : null;
  const identity = `${entry.kind}:${content ?? ""}`;
  // A live lock names its generation too, so the store sweep can tell its tokens from a gone one's.
  const generation = nonceOf(content) ?? createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return ownerGone(content, staleMs, now, alive) ? { live: false, generation, identity } : { live: true, generation };
};

/**
 * The refresh worker's lock as the worker and the scan's store sweep both judge it. A worker holds it
 * for one scan, and the largest measured takes about two minutes, so a lock older than half an hour
 * belongs to a worker that is not coming back, whatever its pid now names.
 */
export const workerAge = ownerAge({ staleMs: 30 * 60 * 1000 });

// What the refresh worker writes as a nonce, and so the one shape its tokens are named by.
const GENERATION = /^[0-9a-f]{16}$/;

function nonceOf(content) {
  try {
    const nonce = JSON.parse(content)?.nonce;
    return typeof nonce === "string" && GENERATION.test(nonce) ? nonce : null;
  } catch {
    return null;
  }
}

function ownerGone(content, staleMs, now, alive) {
  let held;
  try {
    held = JSON.parse(content);
  } catch {
    return true;
  }
  if (!Number.isInteger(held?.pid) || !Number.isFinite(held?.at)) return true;
  // A moment that has not come yet is no worker's on this machine.
  const age = now() - held.at;
  if (age < 0 || age > staleMs) return true;
  return !alive(held.pid);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM is a process that exists and belongs to somebody else.
    return err?.code === "EPERM";
  }
}

/** A lock's stat, or null where it is gone. Exact: an NTFS file id runs past what a float holds. */
function lstatOf(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch {
    return null;
  }
}

// The store holds a handful of files; a directory past this is not ours to walk.
const TOKENS_LISTED_MOST = 256;

// A token's name past the lock's: its generation, and for a token's own token the token's mtime in ms.
const TOKEN = /^([0-9a-f]{16})(\.\d+)?$/;

/** The tokens beside `lock` by name, each with the generation it names and whether it is a token's own token. */
function tokensOf(lock) {
  const prefix = `${basename(lock)}.`;
  const names = [];
  try {
    const listing = opendirSync(dirname(lock));
    try {
      for (let entry; names.length < TOKENS_LISTED_MOST && (entry = listing.readSync()) !== null; ) names.push(entry.name);
    } finally {
      listing.closeSync();
    }
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const token = name.startsWith(prefix) ? TOKEN.exec(name.slice(prefix.length)) : null;
    return token === null ? [] : [{ name, generation: token[1], ofToken: token[2] !== undefined }];
  });
}

/**
 * Removes the tokens of `lock` that `ownerAge` names, but `live`'s. Called by the holder, so every other
 * generation is gone, and a token one names is a breaker's that died before removing it: left, it would
 * turn away the break of a later lock that repeats its name. A breaker still running finds the lock is
 * not the generation it judged and leaves it, so taking its token from under it breaks nothing. A
 * token's own token goes with it.
 */
export function removeLeftTokens(lock, live) {
  for (const { name, generation } of tokensOf(lock)) if (generation !== live) removeLockToken(join(dirname(lock), name));
}

/**
 * The tokens of `lock` a breaker that died left, by name, as `judge` reads the lock now: every one of a
 * generation it does not name, and a token's own token of the dead generation it names once older than
 * any break holds one. Nothing breaks a token's token, so a breaker killed holding one left that lock
 * unbreakable for good. Never a live lock's, and never an entry that is not a regular file.
 */
export function leftTokens(lock, judge) {
  const now = judge(lock);
  return tokensOf(lock)
    .filter(({ name, generation, ofToken }) => {
      const path = join(dirname(lock), name);
      if (lstatOf(path)?.isFile() !== true) return false;
      if (generation !== now?.generation) return true;
      return ofToken && !now.live && TOKEN_AGE(path)?.live === false;
    })
    .map(({ name }) => name);
}
