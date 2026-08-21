/**
 * The two lines every hook here shares: read the payload off stdin, write one
 * object back. Shared so the two entry points cannot spell the answer
 * differently, which is the shape Claude Code parses.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A payload longer than this is not one of ours, and reading on costs the turn. */
const MOST = 1024 * 1024;

/**
 * The payload, and an empty string where there is none to read.
 *
 * Read a megabyte at most and stopped there, because a hook runs on every
 * prompt: reading a stream whole holds the session until the hook times out if
 * nobody closes the other end, and costs whatever the writer sends if somebody
 * does. Three hundred megabytes piped in read as 1.2 GB of memory before this
 * counted what it had taken.
 */
export function readStdin(fd = 0) {
  try {
    return upTo(fd, MOST);
  } catch {
    return "";
  }
}

/**
 * A file's text, or an empty string for anything that is not a plain file this
 * size.
 *
 * Opened first and asked what it is afterwards, through the handle rather than
 * the path: a fifo blocks and a device never ends, and a path checked and then
 * opened is a path something else can swap in between.
 */
export function readIfFile(path, most = MOST) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const seen = fstatSync(fd);
    if (!seen.isFile() || seen.size > most) return "";
    return upTo(fd, most);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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
    parts.push(buffer.toString("utf8", 0, read));
    taken += read;
  }
  return parts.join("");
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
  process.stdout.on("error", () => {});
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
