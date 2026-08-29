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
import { stageEffortIn } from "./effort.mjs";
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
 * these values. 2.1.241 declares the field and does not send it: a payload
 * caught off that build carries `session_id`, `transcript_path`, `cwd`,
 * `prompt_id`, `permission_mode`, `hook_event_name` and `prompt`, and no
 * `source`. So a wakeup counts as a turn there and gets whatever its place in
 * the cadence earns; the day the field arrives, the skip starts working with no
 * change here (A30).
 */
const WAKEUP_SOURCES = new Set(["loop_wakeup", "schedule_wakeup", "poll_event", "system"]);

/** The two paragraphs that say the same thing at every level. */
const OPENING = [
  "Ultracode is on: optimize for the most exhaustive, correct answer, not the fastest or cheapest. Use the Workflow tool on work whose scale or risk earns it; token cost is not a constraint there. See the Workflow tool's **Ultracode** section and quality patterns.",
  "Where it does not earn it, stay solo, and say so in one clause rather than orchestrating to look thorough: a question you can answer, a fact you can read back, one file's mechanical edit, anything already verified this turn. Before spawning one, name what the fan-out buys in one clause, the coverage or the independent check; if that clause will not come, the work did not need it. Scale the harness to the work: a few finders for a narrow question, a larger pool with adversarial verification for an audit.",
];

/** The sentences either third paragraph opens with, since both are true either way. */
const STANDING =
  "This standing opt-in comes from the user's own configuration and is the explicit opt-in the Workflow tool asks for, so do not wait for the keyword. It restores the orchestration instruction only: the session's effort level is unchanged and this text does not raise it.";

/** One level runs the whole session, which is what a session that set none gets. */
const ONE_LEVEL =
  "Every subagent and every workflow stage runs at that same level, so leave opts.effort alone. Depth comes from how the work is split and independently checked, at the level the session is set to.";

/**
 * The one stage a cheaper fan-out does not reach, spelled once because both
 * texts state it and a model reading them compares them.
 *
 * It is the exception rather than a detail: a stage checking another's output is
 * the independent check the whole depth argument rests on, and running that one
 * shallower is where the saving stops being free.
 */
const CHECKING_STAGE = "a stage checking or judging another stage's work";

/**
 * The fan-out at a level the user named, which is the one thing a session
 * cannot ask for any other way.
 *
 * A stage carries no definition file to hold an effort, so `opts.effort` is the
 * only lever that reaches one, and the Agent tool takes no effort argument at
 * all.
 */
function loweredTo(level) {
  return `That same configuration asks the fan-out to run below the session, so pass opts.effort '${level}' on every workflow stage, except ${CHECKING_STAGE}, which keeps the session's level. The Agent tool carries no effort of its own, so this reaches workflow stages and nothing else. Depth comes from how the work is split and independently checked.`;
}

/** The whole standing opt-in, at the stage level this session asked for. */
function full(stageEffort = null) {
  return [...OPENING, `${STANDING} ${stageEffort ? loweredTo(stageEffort) : ONE_LEVEL}`].join("\n\n");
}

/** The line that keeps the mode in view, carrying the level where one was asked for. */
function short(stageEffort = null) {
  const still = "Ultracode is still on: use the Workflow tool where the work is worth it, solo where it is not";
  return stageEffort ? `${still}, and stages at opts.effort '${stageEffort}' except ${CHECKING_STAGE}.` : `${still}.`;
}

/** What this session's switches ask the text to be, and the default for anything unreadable. */
function switchesFrom(env) {
  const every = String(env.ULTRACODE_ANYWHERE_EVERY ?? "");
  return {
    every: /^\d{1,4}$/.test(every) && Number(every) > 0 ? Number(every) : FULL_EVERY,
    refresher: env.ULTRACODE_ANYWHERE_REFRESHER !== "0",
    repeatFull: env.ULTRACODE_ANYWHERE_FULL === "repeat",
    stageEffort: stageEffortIn(env),
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
 * What a session that set no switch gets, in one place.
 *
 * Read through rather than compared against, so a caller handing over a partial
 * object gets these for the keys it left out. Spelled at the signature instead,
 * the default was a literal every caller had its own copy of, and the next key
 * added would have arrived as `undefined` at each of them with nothing failing.
 */
const DEFAULTS = { every: FULL_EVERY, refresher: true, repeatFull: false, stageEffort: null };

/**
 * What this turn is owed: the whole opt-in on the first turn, the line that
 * keeps it in view on every tenth after that, and nothing on the rest.
 */
export function contextFor(turn, asked = DEFAULTS) {
  const { every, refresher, repeatFull, stageEffort } = { ...DEFAULTS, ...asked };
  if (turn === 1) return full(stageEffort);
  if (!refresher || !onCadence(turn, every)) return null;
  return repeatFull ? full(stageEffort) : short(stageEffort);
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

  const switches = switchesFrom(env);
  const session = sessionIn(payload);
  const turn = session ? nextTurn(state, session) : 1;
  if (session && onCadence(turn, switches.every)) sweep(state);
  return contextFor(turn, switches);
}

/**
 * Why strict mode should stay quiet, or null when it should not.
 *
 * Strict is for whoever would rather have the mode off than have it pretend, so
 * it reads the build rather than trusting it. Read once and remembered beside
 * the counters: the answer cannot change inside a session, and the scan streams
 * most of a 325 MB file, a few hundred milliseconds rather than the 30 ms a
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
