/**
 * The hook contract on the wire: the payload Claude Code writes to a hook's
 * stdin, read bounded and timed out, the one object written back, and which
 * transcript is the window a call lands in. A hook answers one object on stdout
 * or nothing, and exits 0 whatever happened (A24, A45).
 *
 * A leaf: it imports nothing of the library, so the binary reads a payload
 * before it knows which verb's modules to load.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * How long a path may be before it names nothing.
 *
 * `PATH_MAX` is 4096 on Linux and 1024 on macOS, and a path past it cannot open
 * anywhere. This is the larger of the two and generous with it: what it is for
 * is the payload that is not a path at all. The walk costs a stat and a copy
 * per segment, and a payload inside the megabyte a hook reads held 400,000 of
 * them and took 7.8 seconds against the 5 its declaration asks for, so the turn
 * lost its map and a process burnt the budget, before every tool call.
 */
export const PATH_MOST = 4096;

/**
 * The transcript of the context window a call lands in, or null where the
 * payload names none. A subagent's calls carry the session's `transcript_path`
 * and their own `agent_id`, and its window is logged beside the session's, or
 * under the workflow run that spawned it. The path may not exist yet, which
 * reads as a window holding nothing.
 */
export function windowOf(payload) {
  const path = payload?.transcript_path;
  if (typeof path !== "string") return null;
  const agent = payload.agent_id;
  if (agent == null) return path;
  if (typeof agent !== "string" || !/^[\w-]+$/.test(agent) || !/\.jsonl$/i.test(path)) return null;
  const subagents = join(path.slice(0, -".jsonl".length), "subagents");
  const file = `agent-${agent}.jsonl`;
  if (existsSync(join(subagents, file))) return join(subagents, file);
  return inWorkflowRun(join(subagents, "workflows"), file) ?? join(subagents, file);
}

// A session on this machine held at most 20 workflow runs; the bound keeps one
// tool call's cost fixed whatever a session grows to.
const WORKFLOW_RUNS_MOST = 256;

function inWorkflowRun(workflows, file) {
  let runs;
  try {
    runs = readdirSync(workflows).slice(0, WORKFLOW_RUNS_MOST);
  } catch {
    return null;
  }
  for (const run of runs) {
    if (existsSync(join(workflows, run, file))) return join(workflows, run, file);
  }
  return null;
}

/**
 * How much of a payload is read before the reading stops.
 *
 * A bound on what one tool call may cost, not a judgement about the payload: a
 * longer one is still ours, with a file's contents in it, and what the hooks
 * read is in the first few hundred bytes either way. Counted in UTF-16 units
 * against a decoded string, so it is a megabyte of ASCII and up to three of
 * anything else. Nothing here compares it against a count of bytes.
 */
const PAYLOAD_MOST = 1024 * 1024;

/**
 * How long the payload read waits before answering with nothing.
 *
 * Exported because it is half of a contract with two halves: this is what the
 * hook gives itself, and `hooks.json` declares what Claude Code will wait for.
 * A test that can read only the declaration cannot tell the two apart, and the
 * one that tried measured the answer against the outer bound, which the race it
 * was inside had already capped.
 */
export const PAYLOAD_WAIT_MS = 2000;

/**
 * The first `most` units of a string, without splitting a character in half.
 *
 * A cap counts UTF-16 units and a surrogate pair is two of them, so a cut at
 * the boundary halves one.
 */
function cutAt(text, most) {
  if (text.length <= most) return text;
  const cut = text.slice(0, most);
  const last = cut.charCodeAt(most - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A payload as an object, and what can still be read of one that will not parse. */
function asPayload(text) {
  try {
    const value = JSON.parse(text || "{}");
    if (value !== null && typeof value === "object") return value;
  } catch {
    // Not a document. What is here may still hold the four short fields the
    // hooks read, and throwing would exit non-zero, which is the one outcome a
    // hook must not have.
  }
  return fieldsIn(text);
}

/**
 * How long a value may be before it is the payload's cargo rather than a field.
 *
 * `PATH_MOST`, because every field either reader takes off a payload is a path,
 * a directory, a tool or event name, or a session id, and the first is the
 * longest of them. Anything past it names
 * no place a filesystem can hold, so it is the `content` of a write or the text
 * of a read, and copying it back out would rebuild the megabyte the cap stopped
 * reading to avoid.
 *
 * Measured on the raw token, quotes and escapes included, since that is what
 * can be counted before anything is copied. An escape-heavy value is refused
 * shorter than its decoded length, which is the safe direction: this is only
 * ever reached on a payload that would otherwise answer nothing at all.
 */
const VALUE_MOST = PATH_MOST;

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
 * `test/hook-contract.test.mjs` drives it against payloads cut at the cap.
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
 * The payload on stdin, or an empty object where there is none to read.
 *
 * Bounded and timed out, because this runs on every tool call and a hook that
 * waits on a pipe nobody writes to holds the whole session there for the
 * timeout the declaration asks for.
 *
 * What has arrived by the bound is read rather than thrown away, and `asPayload`
 * can read a document that stops in the middle, so a payload larger than the
 * bound still answers the fields the hooks need. Discarding it cost the turn its
 * map both for a payload that was already complete and whose writer had simply
 * not closed the handle, and for every write big enough to run past the cap.
 */
export function readPayload() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    // Resolving the promise is not enough to end the process: an open stdin is
    // a live handle, so a harness that opens the pipe and writes nothing kept
    // this alive for as long as it held it, measured at 8 seconds against the
    // 2 this claims. The bound has to release the handle, not just answer.
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(asPayload(data)), PAYLOAD_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      // At the cap what has arrived is read rather than thrown away, and it is
      // readable: `asPayload` falls back to the members it can take out of a
      // document that will not parse, which a cut one never does. Thrown away
      // instead, every payload larger than this cost its turn the map.
      if (data.length >= PAYLOAD_MOST) done(asPayload(cutAt(data, PAYLOAD_MOST)));
    });
    process.stdin.on("error", () => done(asPayload(data)));
    process.stdin.on("end", () => done(asPayload(data)));
  });
}

/**
 * One JSON object on stdout, whatever the reader does with it.
 *
 * A reader that goes away mid-write raises EPIPE on the stream rather than from
 * the call, so a try/catch around this never saw it and node turned it into an
 * uncaught exception and exit 1: the one outcome a hook must not have, on every
 * turn and every tool call for the life of that session. The listener is what
 * makes the error ordinary, and it replaces the binary's own, which lets every
 * error but EPIPE through for the commands a person runs.
 */
export function respond(value) {
  process.stdout.removeAllListeners("error").on("error", () => {});
  try {
    process.stdout.write(JSON.stringify(value));
  } catch {
    // A stream already destroyed raises from the call rather than on itself,
    // which the listener above cannot make ordinary. Whichever way it arrives,
    // a hook that cannot be read is not a hook that failed.
  }
}
