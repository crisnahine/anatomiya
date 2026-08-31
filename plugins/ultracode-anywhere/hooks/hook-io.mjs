/**
 * The two lines every hook here shares: read the payload off stdin, write one
 * object back. Shared so the two entry points cannot spell the answer
 * differently, which is the shape Claude Code parses.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
      // Read rather than thrown away: `parsePayload` can take the members out
      // of a document that stops in the middle, so a payload past the bound
      // still answers the short fields these hooks read.
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

/**
 * Where Claude Code keeps this account's configuration, and "" where it has
 * none.
 *
 * Three callers need this and each had its own copy of it, which is three
 * places for one rule to drift: the settings the plugin reads, the state it
 * writes, and the agent files it reports on all hang off this one path.
 */
export function configDirFor(env = process.env) {
  const home = homeOf(env);
  return env.CLAUDE_CONFIG_DIR || (home && join(home, ".claude")) || "";
}

/**
 * The home Claude Code would read, which a test may point somewhere of its own,
 * and "" when the account has none.
 *
 * A home named and empty is no home rather than the process's own: a caller
 * that set `HOME: ""` said where to look, and falling back to `homedir()`
 * there would read the machine's real one out from under a test.
 */
export function homeOf(env) {
  const named = env.HOME || env.USERPROFILE;
  if (named) return named;
  if ("HOME" in env || "USERPROFILE" in env) return "";
  try {
    return homedir();
  } catch {
    return "";
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

/** The payload as an object, or what can still be read of one that will not parse. */
export function parsePayload(stdin) {
  try {
    const value = JSON.parse(stdin);
    if (value && typeof value === "object") return value;
  } catch {
    // Not a document. What is here may still hold the short fields these hooks
    // read, and the other plugin's reader answers the same for the same bytes.
  }
  return fieldsIn(stdin);
}

/**
 * How long a value may be before it is the payload's cargo rather than a field.
 *
 * 4096, which is the larger of the two `PATH_MAX` values this runs on: every
 * field either reader takes off a payload is a path, a directory, a tool or
 * event name, or a session id, and the first is the longest of them. Anything past it names no place a
 * filesystem can hold, so it is the `content` of a write or the text of a read,
 * and copying it back out would rebuild the megabyte the bound above stopped
 * reading to avoid. The other plugin holds the same number, for the same
 * reason, under the name its own path check already gave it.
 *
 * Measured on the raw token, quotes and escapes included, since that is what
 * can be counted before anything is copied. An escape-heavy value is refused
 * shorter than its decoded length, which is the safe direction: this is only
 * ever reached on a payload that would otherwise answer nothing at all.
 */
const VALUE_MOST = 4096;

/** The one member whose own members are read, and the only nesting this enters. */
const NESTED_MEMBER = "tool_input";

/** Space between tokens, as the JSON grammar spells it and no wider (ECMA-404 §4). */
function isSpace(c) {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function skipSpace(text, i) {
  let at = i;
  while (at < text.length && isSpace(text[at])) at++;
  return at;
}

/**
 * What can still be read out of a payload that will not parse whole.
 *
 * `JSON.parse` reads a document or nothing, so a complete payload followed by
 * one stray byte answers the same as no payload at all, and a payload larger
 * than the cap answers nothing whatever the cap keeps. Both are ordinary: a
 * `Write` of a generated file carries it in `tool_input.content`, and a `Read`
 * of a minified bundle carries it back in `tool_response`. The turn then lost
 * its map over a payload naming a live file in a mapped repository.
 *
 * So this reads the members it can and stops where the text does. What it
 * answers, it answers as `JSON.parse` would: the string members, only at the
 * top and inside `tool_input`, only ones whose closing quote it actually
 * reached, and a member said twice reading as the last one said it did. Everything else is stepped over, and every value it does answer is
 * decoded by `JSON.parse` rather than by this, so escapes, surrogate pairs and
 * a Windows path full of backslashes are the parser's business and not a second
 * implementation of them.
 *
 * Reading the grammar rather than matching a pattern is the whole of it: the
 * cargo being stepped over is a file's own text, and a reader that found
 * `"cwd"` inside one would answer another repository's path for a live write.
 * Nothing here looks inside a string.
 *
 * The other plugin holds this reader and its helpers too, for the reason
 * `cutAt` above is held twice: a plugin may not run a file outside its own
 * root, so a module both could import cannot exist. `test/hook-contract.test.mjs`
 * drives both against one list of payloads, refuses any they answer
 * differently, and compares the block itself character for character. Those two
 * cases are the whole of what keeps the two in step.
 */
export function fieldsIn(text) {
  const fields = {};
  const at = skipSpace(text, 0);
  if (text[at] !== "{") return fields;
  readMembers(text, at + 1, fields, true);
  return fields;
}

/**
 * The members of one object into `fields`, answering where it ended or -1 where
 * the text ran out first.
 *
 * Recurses once and no further: `tool_input` is the only member whose own
 * members are read, and everything else is stepped over by a loop, so no
 * payload's own nesting decides how deep this goes.
 */
function readMembers(text, from, fields, top) {
  let i = from;
  for (;;) {
    i = skipSpace(text, i);
    if (text[i] === "}") return i + 1;
    if (text[i] !== '"') return -1;
    const nameEnd = endOfString(text, i);
    if (nameEnd < 0) return -1;
    const name = decodeString(text, i, nameEnd);
    i = skipSpace(text, nameEnd);
    if (text[i] !== ":") return -1;
    i = skipSpace(text, i + 1);
    if (i >= text.length) return -1;

    // A member said twice answers what the last one said, whatever its type,
    // which is what `JSON.parse` would do with the same document. Left alone,
    // an earlier string stood while the parser had taken a later number, so the
    // answer held a value the document does not have.
    if (typeof name === "string") delete fields[name];

    if (text[i] === '"') {
      const end = endOfString(text, i);
      if (end < 0) return -1;
      const value = decodeString(text, i, end);
      if (typeof name === "string" && typeof value === "string") put(fields, name, value);
      i = end;
    } else if (top && name === NESTED_MEMBER && text[i] === "{") {
      const inner = {};
      const end = readMembers(text, i + 1, inner, false);
      // Kept even where the object never closed, since the members before the
      // cut are the ones this is here for.
      if (Object.keys(inner).length > 0) put(fields, NESTED_MEMBER, inner);
      if (end < 0) return -1;
      i = end;
    } else {
      const end = skipValue(text, i);
      if (end < 0) return -1;
      i = end;
    }

    i = skipSpace(text, i);
    if (text[i] === ",") {
      i++;
      continue;
    }
    return text[i] === "}" ? i + 1 : -1;
  }
}

/**
 * One member onto the answer, whatever it is called.
 *
 * Defined rather than assigned, because a plain assignment to `__proto__` runs
 * the setter on `Object.prototype` instead of making a property: the member
 * vanished, while `JSON.parse` keeps it as the object's own. A string cannot
 * reparent anything through that setter, so nothing was ever at risk; what was
 * wrong is that the two readers of one document disagreed about what was in it.
 */
function put(fields, name, value) {
  Object.defineProperty(fields, name, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Where the string starting at `from` ends, or -1 where it never does.
 *
 * A backslash takes the next unit with it whatever that unit is, which is all
 * the escape grammar a reader needs to find the closing quote: `\"` is not it
 * and `\\` leaves the next quote to close.
 */
function endOfString(text, from) {
  for (let j = from + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === '"') return j + 1;
  }
  return -1;
}

/**
 * The string between those two offsets, or null for one this will not carry.
 *
 * Measured before it is copied: a `content` of five megabytes is passed over as
 * a span rather than sliced and parsed, so stepping over the cargo costs an
 * index and not a second copy of it.
 */
function decodeString(text, from, end) {
  if (end - from > VALUE_MOST) return null;
  try {
    return JSON.parse(text.slice(from, end));
  } catch {
    return null;
  }
}

/**
 * Past one value of any shape, or -1 where the text ran out inside it.
 *
 * Depth is counted rather than recursed, because the payload decides it: a
 * value nested fifty thousand deep is a stack overflow in a reader that calls
 * itself, and this runs before every tool call.
 */
function skipValue(text, from) {
  if (text[from] === '"') return endOfString(text, from);
  if (text[from] === "{" || text[from] === "[") {
    let depth = 0;
    for (let j = from; j < text.length; j++) {
      const c = text[j];
      if (c === '"') {
        const end = endOfString(text, j);
        if (end < 0) return -1;
        j = end - 1;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return -1;
  }
  // A number, `true`, `false` or `null`: read up to whatever ends it, and left
  // unchecked, since nothing here reads one. A reader that validated it would
  // stop at a malformed literal and lose the members after it; this one steps
  // over and carries on, so it answers everything a strict reader would and
  // sometimes more. Measured over 400,000 texts: no input where checking the
  // literal recovered a member this does not.
  let j = from;
  while (j < text.length && !isSpace(text[j]) && text[j] !== "," && text[j] !== "}" && text[j] !== "]") j++;
  return j === from ? -1 : j;
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
