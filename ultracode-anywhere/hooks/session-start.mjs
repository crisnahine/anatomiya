#!/usr/bin/env node
/**
 * What the session should know before it trusts this plugin.
 *
 * The plugin mirrors one build's behaviour, so the two ways it can be worth
 * nothing are upstream moving and the settings already doing its job. Both are
 * silent otherwise: the reminder keeps arriving and the model keeps reading it,
 * whether or not the Workflow tool it names is still gated the way it was.
 * Reported once, at the start of a session, since neither answer changes inside
 * one.
 */
import { cached, firstTime, stateDirFor } from "./counters.mjs";
import { invokedAs, parsePayload, readStdin, respond } from "./hook-io.mjs";
import { CALIBRATED_AGAINST, behind, cliPath, conflictIn, driftCached, settingsFor, versionOf } from "./upstream.mjs";

/** The sentence this session is owed, or null when it is owed none. */
export function notice({ env = process.env, cli = cliPath(env), cwd = process.cwd(), state = stateDirFor(env) } = {}) {
  if (env.ULTRACODE_ANYWHERE === "0") return null;

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

  const conflict = conflictIn(settings);
  if (conflict) said.push(`ultracode-anywhere is quiet this session: ${conflict}.`);

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
    const payload = parsePayload(readStdin());
    respond("SessionStart", notice({ cwd: typeof payload.cwd === "string" ? payload.cwd : here() }));
  } catch {
    // Nothing to say, and nothing worth failing a session's first turn over.
  }
}

function here() {
  try {
    return process.cwd();
  } catch {
    return "";
  }
}
