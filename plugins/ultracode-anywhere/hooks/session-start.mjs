#!/usr/bin/env node
/**
 * What the session should know before it trusts this plugin.
 *
 * The plugin mirrors one build's behaviour, so the two ways it can be worth
 * nothing are upstream moving and the settings already doing its job. Both are
 * silent otherwise: the reminder keeps arriving and the model keeps reading it,
 * whether or not the Workflow tool it names is still gated the way it was.
 * Reported at the start of a session and again after a compaction or a clear,
 * which empty the context; a resume brings the transcript back with the lines in
 * it and is told nothing. The cap line is the exception: it is marked once per
 * state directory and said once.
 */
import { cached, firstTime, startOver, stateDirFor } from "./counters.mjs";
import { askedFor } from "./effort.mjs";
import { here, invokedAs, parsePayload, readStdin, respond } from "./hook-io.mjs";
import { CALIBRATED_AGAINST, behind, cliPath, conflictIn, driftCached, settingsFor, versionOf } from "./upstream.mjs";

/** The starts that empty the context under a session that goes on. */
const EMPTIES_CONTEXT = new Set(["compact", "clear"]);

/** The sentence this session is owed, or null when it is owed none. */
export function notice({
  env = process.env,
  cli = cliPath(env),
  cwd = process.cwd(),
  state = stateDirFor(env),
  source = "startup",
  session = null,
} = {}) {
  if (env.ULTRACODE_ANYWHERE === "0") return null;

  // A compaction takes the opening text out of the context, and the built-in
  // answers that by sending it whole again on the next turn; the cadence here
  // starts over the same way (A30).
  if (EMPTIES_CONTEXT.has(source) && session) startOver(state, session);

  // A resume brings the transcript back with the lines below already in it.
  // A compaction or a clear empties the context, so those are told again.
  if (source === "resume") return null;

  const said = [];
  const settings = settingsFor(env, cwd);

  const moved = driftCached(cli, state, cached);
  if (moved) {
    said.push(
      `ultracode-anywhere may no longer do anything: ${moved}. The plugin restates a reminder that build no longer carries, so check the plugin against the build before trusting the mode is on.`,
    );
  } else {
    // A build nobody checked it against is not a broken one, and saying so is
    // the difference between a plugin that ages and one that rots: the names
    // are still there, and whether the gate around them still reads the same
    // way is a question only a fresh wire-level diff answers.
    const unchecked = behind(versionOf(cli), CALIBRATED_AGAINST);
    if (unchecked) said.push(`ultracode-anywhere: ${unchecked}. See its README for how to re-check it.`);
  }

  const conflict = conflictIn(settings, env);
  if (conflict) said.push(`ultracode-anywhere is quiet this session: ${conflict}.`);

  // Said every session rather than once per machine, since this is a variable
  // one session carries and the next may not. Only where the reminder is going
  // out at all: with the prompt hook quiet there is no text to carry a level,
  // so the setting is not wrong, it is beside the point. Strict on a build that
  // moved is the second way it goes quiet, and the prompt hook reads the same
  // two answers in the same order.
  const quiet = conflict || (env.ULTRACODE_ANYWHERE_STRICT === "1" && moved);
  const asked = quiet ? null : askedFor(env);
  if (asked) said.push(`ultracode-anywhere: ${asked}.`);

  // The one thing native ultracode does that no reminder can: it lifts the
  // concurrent-subagent cap. Named once here rather than left in a README
  // nobody opens when a workflow is refused at 20.
  if (!conflict && env.ULTRACODE_ANYWHERE_CAP_NOTICE !== "0" && !capRaised(settings, env) && firstTime(state, "cap-said")) {
    said.push(
      'ultracode-anywhere does not lift the concurrent-subagent cap, which stays at its default of 20. Raise it in settings.json with "env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }, or set ULTRACODE_ANYWHERE_CAP_NOTICE=0 to stop saying so.',
    );
  }

  return said.length === 0 ? null : said.join(" ");
}

/** Whether the cap has already been raised, by settings or by the environment. */
function capRaised(settings, env) {
  return Boolean(settings?.env?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS || env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS);
}

// The same boundary the prompt hook keeps, for the same reason: whatever throws,
// a hook that fails is worse than a hook that said nothing (A24).
if (invokedAs(import.meta.url)) {
  try {
    const payload = parsePayload(await readStdin());
    respond(
      "SessionStart",
      notice({
        cwd: typeof payload.cwd === "string" ? payload.cwd : here(),
        source: typeof payload.source === "string" ? payload.source : "startup",
        session: typeof payload.session_id === "string" && payload.session_id ? payload.session_id : null,
      }),
    );
  } catch {
    // Nothing to say, and nothing worth failing a session's first turn over.
  }
}
