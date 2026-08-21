#!/usr/bin/env node
/**
 * Claude Code emits its standing orchestration reminder only when the resolved
 * effort is xhigh. The Workflow tool itself carries no effort term, so
 * restating the reminder on every prompt keeps the mode on at whatever level is
 * selected.
 *
 * Node rather than a shell script: this runs on every prompt on whatever
 * machine the plugin is installed on, Windows included, where a bare `.sh` has
 * no interpreter to run it.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { cliPath, conflictIn, drift, settingsFor } from "./upstream.mjs";

/**
 * Full text on the first turn and every tenth after it, mirroring
 * TURNS_BETWEEN_MAINTENANCE. `ULTRACODE_ANYWHERE_EVERY` moves it, and 0 makes
 * every turn a full one.
 */
export const FULL_EVERY = 10;

/** The cadence this session runs at, and the default for anything unreadable. */
export function cadenceFrom(env = process.env) {
  const every = String(env.ULTRACODE_ANYWHERE_EVERY ?? "");
  return {
    every: /^\d{1,4}$/.test(every) ? Number(every) : FULL_EVERY,
    refresher: env.ULTRACODE_ANYWHERE_REFRESHER !== "0",
  };
}

/** Turns the user did not type. A wakeup carries its own instructions. */
export const WAKEUP_SOURCES = new Set(["loop_wakeup", "schedule_wakeup", "poll_event", "system"]);

/** A counter older than this has outlived the session that wrote it. */
const KEEP_DAYS = 7;

const FULL = [
  "Ultracode is on: optimize for the most exhaustive, correct answer, not the fastest or cheapest. Use the Workflow tool on work whose scale or risk earns it; token cost is not a constraint there. See the Workflow tool's **Ultracode** section and quality patterns.",
  "Where it does not earn it, stay solo, and say so in one clause rather than orchestrating to look thorough: a question you can answer, a fact you can read back, one file's mechanical edit, anything already verified this turn. Before spawning one, name what the fan-out buys in one clause, the coverage or the independent check; if that clause will not come, the work did not need it. Scale the harness to the work: a few finders for a narrow question, a larger pool with adversarial verification for an audit.",
  "This standing opt-in comes from the user's own configuration and is the explicit opt-in the Workflow tool asks for, so do not wait for the keyword. It restores the orchestration instruction only: the session's effort level is unchanged and this text does not raise it. Subagents inherit that effort, so pass opts.effort ('high' or 'xhigh') on the verify, judge and critic stages that need the depth, and leave mechanical stages on the inherited level.",
].join("\n\n");

const SHORT = "Ultracode is still on: use the Workflow tool where the work is worth it, solo where it is not.";

/**
 * The payload as an object, or an empty one.
 *
 * Parsed rather than matched on the raw text: JSON may put a space after the
 * colon, so a substring match on `"source":"loop_wakeup"` reads a wakeup as a
 * user turn, and a match for the session id takes whatever in the payload looks
 * most like one, which a prompt can write.
 */
export function parsePayload(stdin) {
  try {
    const value = JSON.parse(stdin);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** The session this turn belongs to, or null when the payload names none. */
export function sessionOf(stdin) {
  const id = parsePayload(stdin).session_id;
  return typeof id === "string" && id ? id : null;
}

export function isWakeup(payload) {
  return WAKEUP_SOURCES.has(payload?.source);
}

/** Where the turn counters live: this user's own directory, not one shared with every account on the box. */
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

/**
 * A session id is a file name here, so it may hold only what a file name may
 * hold. Refused rather than stripped: two ids differing only in what a strip
 * removes would share one counter, and `../x` would quietly become `x`.
 */
const COUNTER_NAME = /^[A-Za-z0-9_-]{1,128}$/;

function counterName(session) {
  const name = String(session ?? "");
  return COUNTER_NAME.test(name) ? name : null;
}

/**
 * Whether the state directory is one this account owns and no other account can
 * write to.
 *
 * The path is predictable, so on a shared machine another account can create it
 * first as a symlink. Followed, the counter write truncates whatever it points
 * at and the sweep deletes week-old files beside it; both were reproduced on a
 * temporary directory here. A refusal costs the session its cadence, not its
 * reminder.
 */
function ownState(dir) {
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
 * its cadence rather than its reminder. Every failure here answers 1, which is
 * a full reminder, and none of them says anything on stderr.
 */
export function nextTurn(dir, session) {
  const name = counterName(session);
  if (!name || !ownState(dir)) return 1;
  const path = join(dir, name);

  const turn = countIn(path) + 1;
  try {
    writeCounter(path, turn);
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
 * The counter, written without following a symlink standing where it should be.
 * The directory is this user's own, but a truncating write to a path someone
 * else can replace is not a write worth making.
 */
function writeCounter(path, turn) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = openSync(path, flags, 0o600);
    writeSync(fd, String(turn));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Counters left by sessions that ended, removed on full turns only: this runs on
 * every prompt.
 *
 * A counter is a file named like a session holding a count and nothing else.
 * The state path is a switch a user can point anywhere, so anything that is not
 * one of this hook's own counters is left where it is.
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

/** The build strict mode reads, which is the one the session is running. */
function cliFor(env) {
  return cliPath(env);
}

/** Whether this turn is one of the ones that carries the whole text. */
const isFull = (turn, every = FULL_EVERY) => every === 0 || (turn - 1) % every === 0;

/**
 * What this turn is owed: the whole opt-in, the line that keeps it in view, or
 * nothing when the refresher is off.
 */
export function contextFor(turn, cadence = { every: FULL_EVERY, refresher: true }) {
  if (isFull(turn, cadence.every)) return FULL;
  return cadence.refresher ? SHORT : null;
}

/** The text this turn should carry, or null when the turn is owed nothing. */
export function run({ stdin = "", env = process.env, state = stateDirFor(env) } = {}) {
  if (env.ULTRACODE_ANYWHERE === "0") return null;

  const payload = parsePayload(stdin);
  if (isWakeup(payload)) return null;

  // A session that already resolves to xhigh gets the built-in reminder, and one
  // with no Workflow tool has nothing to be pointed at. Either way this hook has
  // nothing to add, and saying it anyway is tokens for nothing.
  const conflict = conflictIn(settingsFor(env, typeof payload.cwd === "string" ? payload.cwd : process.cwd()));

  // Strict is for whoever would rather have the mode off than have it pretend:
  // on a build that no longer carries what this mirrors, the reminder is a
  // sentence about a contract that has moved. Loud by default, since going
  // silent costs the mode to everyone whose build is fine.
  const moved = env.ULTRACODE_ANYWHERE_STRICT === "1" ? drift({ cli: cliFor(env) }) : null;

  if (env.ULTRACODE_ANYWHERE_DEBUG) log(env.ULTRACODE_ANYWHERE_DEBUG, stdin, conflict ?? moved?.reason);
  if (conflict) return null;
  if (moved?.checked && moved.missing.length > 0) return null;

  const cadence = cadenceFrom(env);
  const session = sessionOf(stdin);
  const turn = session ? nextTurn(state, session) : 1;
  if (session && isFull(turn, cadence.every)) sweep(state);
  return contextFor(turn, cadence);
}

function log(path, stdin, conflict = null) {
  try {
    writeFileSync(path, `=== ${new Date().toISOString()}${conflict ? ` quiet: ${conflict}` : ""}\n${stdin}\n`, { flag: "a" });
  } catch {
    // A debug switch that cannot write is not worth failing a turn over.
  }
}

/** The line Claude Code reads back: one JSON object on stdout, nothing else. */
export function render(context) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
  });
}

function main() {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
  const context = run({ stdin });
  if (context !== null) process.stdout.write(`${render(context)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
