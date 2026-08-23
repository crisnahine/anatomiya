/**
 * The two lines every hook here shares: read the payload off stdin, write one
 * object back. Shared so the two entry points cannot spell the answer
 * differently, which is the shape Claude Code parses.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A megabyte, which is more than anything this reads ever is.
 *
 * Spent as UTF-16 units against a decoded payload and as bytes against a file
 * on disk, since a cap is a bound on what one turn may cost and both readings
 * bound it. Nothing here compares one against the other.
 */
const MOST = 1024 * 1024;

/** How long to wait for a payload before answering without one. */
const WAIT_MS = 2000;

/**
 * The payload, and an empty string where there is none to read.
 *
 * Read a megabyte at most and stopped there, because a hook runs on every
 * prompt: reading a stream whole costs whatever the writer sends. Three hundred
 * megabytes piped in read as 1.2 GB of memory before this counted what it had
 * taken.
 *
 * Bounded in time as well as in bytes, and read off a stream rather than with
 * `readSync`, because a pipe is blocking by default: a caller that opened the
 * handle and had not written yet held the read inside the syscall, where no
 * timer runs, until Claude Code killed the hook at the timeout it declares.
 * That is five seconds of every prompt and fifteen of every session start,
 * spent waiting for a payload that had already been decided. Whatever has not
 * arrived by now is not coming, and a hook that says nothing is cheaper than a
 * hook that is still waiting.
 *
 * Called once per process, and only once: releasing the handle is half of what
 * the bound is for, so a second call has nothing left to read.
 */
export function readStdin() {
  return new Promise((resolve) => {
    let taken = "";
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Resolving is not enough to end the process: an open stdin is a live
      // handle, so answering while still holding it leaves the hook running
      // until something kills it. The bound has to release the handle too.
      process.stdin.pause();
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(taken), WAIT_MS);

    // `process.stdin` rather than a stream opened on the descriptor: an
    // `fs` read goes to the threadpool, where a blocking pipe parks a worker
    // inside the syscall and nothing can cancel it, so the timer fires, the
    // answer comes back, and the process still will not exit with no handle
    // left to point at. This one is a libuv pipe, and destroying it ends the
    // read.
    //
    // Decoded rather than concatenated as buffers, so a multibyte character
    // split across two reads does not arrive as U+FFFD.
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      taken += chunk;
      if (taken.length >= MOST) done(cutAt(taken, MOST));
    });
    process.stdin.on("error", () => done(taken));
    process.stdin.on("end", () => done(taken));
  });
}

/**
 * The first `most` units of a string, without splitting a character in half.
 *
 * A cap on a decoded string counts UTF-16 units, and a surrogate pair is two of
 * them, so cutting between them undoes the decoding the read does to avoid
 * exactly that. A string that is not over the cap is not cut at all: the caller
 * hands this everything from `most` units upwards, and at exactly `most` this
 * shortened a string nothing had split, which is a different answer from the
 * one the other plugin gives for the same bytes.
 */
function cutAt(text, most) {
  if (text.length <= most) return text;
  const first = text.charCodeAt(most - 1);
  const back = first >= 0xd800 && first <= 0xdbff ? 1 : 0;
  return text.slice(0, most - back);
}

/**
 * A file's text, or an empty string for anything that is not a plain file this
 * size.
 *
 * Opened first and asked what it is afterwards, through the handle rather than
 * the path: a fifo blocks and a device never ends, and a path checked and then
 * opened is a path something else can swap in between.
 */
export function readIfFile(path, most = MOST, flags = 0) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | flags);
    const seen = fstatSync(fd);
    if (!seen.isFile() || seen.size > most) return "";
    return upTo(fd, most);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The same read for a file this plugin wrote itself, which may not be a link.
 *
 * A user's own file is allowed to be one, since a dotfiles repository keeps
 * `settings.json` behind a link and following it is the point. A counter this
 * plugin keeps under a predictable path is not that: followed, a link there
 * reads somebody else's file as a turn count.
 */
export function readOwnFile(path, most = MOST) {
  return readIfFile(path, most, constants.O_NOFOLLOW ?? 0);
}

/** At most `most` bytes off a handle, however much the far end wants to send. */
function upTo(fd, most) {
  const buffer = Buffer.allocUnsafe(Math.min(most, 1 << 20));
  const parts = [];
  let taken = 0;
  while (taken < most) {
    let read;
    try {
      read = readSync(fd, buffer, 0, Math.min(buffer.length, most - taken), null);
    } catch (err) {
      // A non-blocking handle with nothing ready to read says so rather than
      // waiting, and a turn is not worth waiting for the rest.
      if (err?.code === "EAGAIN" || err?.code === "EOF") break;
      throw err;
    }
    if (read <= 0) break;
    // Kept as bytes and decoded once at the end: a character can straddle two
    // reads, and decoding each on its own turns one into two replacement
    // characters. The stdin read above is written the same way for the same
    // reason, and this one was not.
    parts.push(Buffer.from(buffer.subarray(0, read)));
    taken += read;
  }
  return Buffer.concat(parts).toString("utf8");
}

/** This process's own directory, and nothing when it has been removed under it. */
export function here() {
  try {
    return process.cwd();
  } catch {
    return "";
  }
}

/** The payload as an object, or an empty one. */
export function parsePayload(stdin) {
  try {
    const value = JSON.parse(stdin);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/**
 * One JSON object on stdout, and nothing at all when there is nothing to say.
 *
 * A reader that goes away mid-write raises EPIPE, which is the one way this
 * plugin can reach stderr and exit non-zero, and a hook that fails is worse
 * than a hook nobody read.
 */
export function respond(event, context) {
  if (context === null || context === undefined) return;
  const line = `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } })}\n`;
  // One listener however many times this is called: node warns at eleven, and
  // the warning goes to stderr, which a hook may not write to.
  if (process.stdout.listenerCount("error") === 0) process.stdout.on("error", () => {});
  try {
    process.stdout.write(line);
  } catch {
    // Nobody is reading, which is not this hook's problem to report.
  }
}

/**
 * Whether this module is the file the process was told to run.
 *
 * Compared through the real path on both sides: `import.meta.url` is always
 * resolved and `process.argv[1]` is whatever the caller spelled, so a plugin
 * reached through a symlinked directory, which is what a relocated home looks
 * like, ran nothing at all and said nothing about it.
 */
export function invokedAs(url) {
  if (!process.argv[1]) return false;
  return realOf(fileURLToPath(url)) === realOf(resolve(process.argv[1]));
}

function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
