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
import { closeSync, constants, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Full text on the first turn and every tenth after it, mirroring TURNS_BETWEEN_MAINTENANCE. */
export const FULL_EVERY = 10;

/** Turns the user did not type. A wakeup carries its own instructions. */
export const WAKEUP_SOURCES = new Set(["loop_wakeup", "schedule_wakeup", "poll_event", "system"]);

/** A counter older than this has outlived the session that wrote it. */
const KEEP_DAYS = 7;

const FULL = [
  "Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the Workflow tool's **Ultracode** section and quality patterns. Solo only on conversational/trivial turns.",
  "This standing opt-in comes from the user's own configuration and holds at every effort level, including this one. It is the explicit opt-in the Workflow tool asks for, so do not wait for the keyword or for a higher effort level.",
  "Subagents inherit the session effort, which may not be xhigh here. Pass opts.effort ('high' or 'xhigh') on verify, judge and critic stages that need the depth, and leave mechanical stages on the inherited level.",
].join("\n\n");

const SHORT = "Ultracode is still on — use the Workflow tool; see its Ultracode section.";

/**
 * The payload as an object, or an empty one.
 *
 * Parsed rather than matched: a substring match on `"source":"loop_wakeup"`
 * missed the same field spelled with a space after the colon, and a greedy
 * match for the session id took the last thing in the payload that looked like
 * one, which a prompt can write.
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

/** A session id is a file name here, so it may hold only what a file name may hold. */
function counterName(session) {
  const safe = String(session ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return safe.length > 0 && safe.length <= 128 ? safe : null;
}

/**
 * This turn's number in its session, counting from one.
 *
 * Any answer but a number is a session starting over. The shell version aborted
 * on a counter it could not read and printed nothing at all, which switched the
 * plugin off for that session with no error anyone would see.
 */
export function nextTurn(dir, session) {
  const name = counterName(session);
  if (!name) return 1;
  const path = join(dir, name);

  let seen = "";
  try {
    seen = readFileSync(path, "utf8").trim();
  } catch {
    // The first turn of a session has no counter yet, which is not a failure.
  }
  const turn = (/^\d{1,15}$/.test(seen) ? Number(seen) : 0) + 1;

  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeCounter(path, turn);
  } catch {
    // A counter that cannot be written costs this session its cadence, not its
    // reminder: every turn then reads as the first one.
  }
  return turn;
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

/** Counters left by sessions that ended. Swept on full turns only: this runs on every prompt. */
export function sweep(dir, now = Date.now()) {
  let removed = 0;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      if (now - statSync(path).mtimeMs < KEEP_DAYS * 86_400_000) continue;
      rmSync(path, { force: true });
      removed++;
    } catch {
      // A counter that cannot be read or removed is not this turn's problem.
    }
  }
  return removed;
}

/** What this turn is owed: the whole opt-in, or the line that keeps it in view. */
export function contextFor(turn) {
  return (turn - 1) % FULL_EVERY === 0 ? FULL : SHORT;
}

/** The text this turn should carry, or null when the turn is owed nothing. */
export function run({ stdin = "", env = process.env, state = stateDirFor(env) } = {}) {
  if (env.ULTRACODE_ANYWHERE === "0") return null;

  const payload = parsePayload(stdin);
  if (isWakeup(payload)) return null;

  if (env.ULTRACODE_ANYWHERE_DEBUG) log(env.ULTRACODE_ANYWHERE_DEBUG, stdin);

  const session = typeof payload.session_id === "string" ? payload.session_id : null;
  const turn = session ? nextTurn(state, session) : 1;
  if ((turn - 1) % FULL_EVERY === 0) sweep(state);
  return contextFor(turn);
}

function log(path, stdin) {
  try {
    writeFileSync(path, `=== ${new Date().toISOString()}\n${stdin}\n`, { flag: "a" });
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
