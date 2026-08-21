/**
 * The two lines every hook here shares: read the payload off stdin, write one
 * object back. Shared so the two entry points cannot spell the answer
 * differently, which is the shape Claude Code parses.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A payload longer than this is not one of ours, and reading on costs the turn. */
const MOST = 1024 * 1024;

/**
 * The payload, and an empty string where there is none to read.
 *
 * Bounded and typed, because a hook runs on every prompt: an unbounded read of
 * a pipe nobody writes to holds the session until the hook times out, and the
 * same read of a device returns for as long as the device is willing to talk.
 */
export function readStdin(fd = 0) {
  try {
    const seen = statSync(fd);
    if (seen.isFile() && seen.size > MOST) return "";
  } catch {
    // A pipe has no size to check, which is the ordinary case here.
  }
  try {
    return readFileSync(fd, "utf8").slice(0, MOST);
  } catch {
    return "";
  }
}

/**
 * A file's text, or an empty string for anything that is not a plain file this
 * size. A fifo blocks and a device never ends, and either is the whole turn.
 */
export function readIfFile(path, most = MOST) {
  try {
    if (!statSync(path).isFile() || statSync(path).size > most) return "";
  } catch {
    return "";
  }
  try {
    return readFileSync(path, "utf8");
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
