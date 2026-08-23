#!/usr/bin/env node
/**
 * Claude Code emits its standing orchestration reminder only when the resolved
 * effort is xhigh. The Workflow tool itself carries no effort term, so
 * restating that reminder keeps the mode on at whatever level is selected, on
 * the cadence the built-in itself uses (A30).
 *
 * Node rather than a shell script: this runs on every prompt on whatever
 * machine the plugin is installed on, Windows included, where a bare `.sh` has
 * no interpreter to run it.
 */

import { appendLine, cached, nextTurn, stateDirFor, sweep } from "./counters.mjs";
import { here, invokedAs, parsePayload, readStdin, respond } from "./hook-io.mjs";
import { cliPath, conflictIn, driftCached, settingsFor } from "./upstream.mjs";

/**
 * Turns between refreshers, mirroring TURNS_BETWEEN_MAINTENANCE.
 *
 * The whole text opens the session and a one-line refresher comes back every
 * tenth turn after it, which is the shape of the thing being mirrored. The
 * turns in between say nothing at all: a line on every prompt is paid for on
 * every prompt, and it is louder than the built-in it stands in for.
 */
export const FULL_EVERY = 10;

/**
 * Turns the user did not type. A wakeup carries its own instructions.
 *
 * Read off the `source` the build's own payload schema declares, with exactly
 * these values. 2.1.238 declares the field and does not yet send it outside
 * Anthropic, so on that build a wakeup counts as a turn and gets whatever its
 * place in the cadence earns; the day the field arrives, the skip starts
 * working with no change here (A30).
 */
const WAKEUP_SOURCES = new Set(["loop_wakeup", "schedule_wakeup", "poll_event", "system"]);

const FULL = [
  "Ultracode is on: optimize for the most exhaustive, correct answer, not the fastest or cheapest. Use the Workflow tool on work whose scale or risk earns it; token cost is not a constraint there. See the Workflow tool's **Ultracode** section and quality patterns.",
  "Where it does not earn it, stay solo, and say so in one clause rather than orchestrating to look thorough: a question you can answer, a fact you can read back, one file's mechanical edit, anything already verified this turn. Before spawning one, name what the fan-out buys in one clause, the coverage or the independent check; if that clause will not come, the work did not need it. Scale the harness to the work: a few finders for a narrow question, a larger pool with adversarial verification for an audit.",
  "This standing opt-in comes from the user's own configuration and is the explicit opt-in the Workflow tool asks for, so do not wait for the keyword. It restores the orchestration instruction only: the session's effort level is unchanged and this text does not raise it. Subagents inherit that effort, so pass opts.effort ('high' or 'xhigh') on the verify, judge and critic stages that need the depth, and leave mechanical stages on the inherited level.",
].join("\n\n");

const SHORT = "Ultracode is still on: use the Workflow tool where the work is worth it, solo where it is not.";

/** The cadence this session runs at, and the default for anything unreadable. */
function cadenceFrom(env) {
  const every = String(env.ULTRACODE_ANYWHERE_EVERY ?? "");
  return {
    every: /^\d{1,4}$/.test(every) && Number(every) > 0 ? Number(every) : FULL_EVERY,
    refresher: env.ULTRACODE_ANYWHERE_REFRESHER !== "0",
    repeatFull: env.ULTRACODE_ANYWHERE_FULL === "repeat",
  };
}

/**
 * Whether this payload is a turn the user did not type.
 *
 * Read off the parsed payload rather than the raw text: JSON may put a space
 * after the colon, so a substring match on `"source":"loop_wakeup"` reads a
 * wakeup as a user turn, and a prompt quoting the field reads as a wakeup.
 */
export function isWakeup(payload) {
  return WAKEUP_SOURCES.has(payload?.source);
}

/** The session this turn belongs to, or null where the payload names none. */
function sessionIn(payload) {
  const id = payload?.session_id;
  return typeof id === "string" && id ? id : null;
}

/** Whether this turn is one the cadence speaks on at all. */
const onCadence = (turn, every = FULL_EVERY) => (turn - 1) % every === 0;

/**
 * What this turn is owed: the whole opt-in on the first turn, the line that
 * keeps it in view on every tenth after that, and nothing on the rest.
 */
export function contextFor(turn, cadence = { every: FULL_EVERY, refresher: true, repeatFull: false }) {
  if (turn === 1) return FULL;
  if (!cadence.refresher || !onCadence(turn, cadence.every)) return null;
  return cadence.repeatFull ? FULL : SHORT;
}

/** The text this turn should carry, or null when the turn is owed nothing. */
export function run({ stdin = "", env = process.env, state = stateDirFor(env) } = {}) {
  const payload = parsePayload(stdin);
  const debug = env.ULTRACODE_ANYWHERE_DEBUG;

  // Logged before the answers that are silence, since a fire that said nothing
  // is the one somebody turns the switch on to understand.
  if (env.ULTRACODE_ANYWHERE === "0") {
    if (debug) log(debug, stdin, "ULTRACODE_ANYWHERE=0");
    return null;
  }
  if (isWakeup(payload)) {
    if (debug) log(debug, stdin, `a wakeup, source ${payload.source}`);
    return null;
  }

  // A session that already resolves to xhigh gets the built-in reminder, and one
  // with no Workflow tool has nothing to be pointed at. Either way this hook has
  // nothing to add, and saying it anyway is tokens for nothing.
  const cwd = typeof payload.cwd === "string" ? payload.cwd : here();
  const conflict = conflictIn(settingsFor(env, cwd), env);
  const moved = !conflict && env.ULTRACODE_ANYWHERE_STRICT === "1" ? movedBuild(env, state) : null;

  if (debug) log(debug, stdin, conflict ?? moved);
  if (conflict || moved) return null;

  const cadence = cadenceFrom(env);
  const session = sessionIn(payload);
  const turn = session ? nextTurn(state, session) : 1;
  if (session && onCadence(turn, cadence.every)) sweep(state);
  return contextFor(turn, cadence);
}

/**
 * Why strict mode should stay quiet, or null when it should not.
 *
 * Strict is for whoever would rather have the mode off than have it pretend, so
 * it reads the build rather than trusting it. Read once and remembered beside
 * the counters: the answer cannot change inside a session, and the scan streams
 * most of a 321 MB file, a few hundred milliseconds rather than the 30 ms a
 * turn costs otherwise, against a hook timeout of 5 seconds.
 */
function movedBuild(env, state) {
  return driftCached(cliPath(env), state, cached);
}

function log(path, stdin, quiet) {
  appendLine(path, `=== ${new Date().toISOString()}${quiet ? ` quiet: ${quiet}` : ""}\n${stdin}\n`);
}

// The hook answers for itself, whatever went wrong and wherever it came from. A
// non-zero exit interrupts the run it exists to help, and it would do it on
// every prompt for the life of that session, so the guarantee belongs at the
// boundary rather than at each site that might throw (A24).
if (invokedAs(import.meta.url)) {
  try {
    respond("UserPromptSubmit", run({ stdin: await readStdin() }));
  } catch {
    // A turn that says nothing costs the mode; a turn that fails costs the run.
  }
}
