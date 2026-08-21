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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CALIBRATED_AGAINST, behind, cliPath, conflictIn, drift, settingsFor, versionOf } from "./upstream.mjs";
import { stateDirFor } from "./standing-ultracode.mjs";

/** The sentence this session is owed, or null when it is owed none. */
export function notice({ cli = cliPath(), env = process.env, cwd = process.cwd(), state = stateDirFor(env), capAdvice = true } = {}) {
  const said = [];
  const settings = settingsFor(env, cwd);

  const moved = drift({ cli });
  if (moved.checked && moved.missing.length > 0) {
    said.push(
      `ultracode-anywhere may no longer do anything: ${moved.reason}. The plugin restates a reminder that build no longer carries, so check the plugin against the build before trusting the mode is on.`,
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
  if (capAdvice && !conflict && env.ULTRACODE_ANYWHERE_CAP_NOTICE !== "0" && !capRaised(settings, env) && firstTime(state)) {
    said.push(
      'ultracode-anywhere does not lift the concurrent-subagent cap, which stays at its default of 20. Raise it in settings.json with "env": { "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "40" }, or set ULTRACODE_ANYWHERE_CAP_NOTICE=0 to stop saying so.',
    );
  }

  return said.length === 0 ? null : said.join(" ");
}

/**
 * Whether the cap has been mentioned on this machine yet.
 *
 * Said once rather than every session: a line that arrives forever is one a
 * reader learns to skip, and the setting it names is a one-time edit. The mark
 * is a file beside the turn counters, and a state directory this cannot write
 * means it is said again rather than lost.
 */
function firstTime(state) {
  const mark = join(state, ".cap-said");
  try {
    readFileSync(mark, "utf8");
    return false;
  } catch {
    try {
      mkdirSync(state, { recursive: true, mode: 0o700 });
      writeFileSync(mark, "said\n");
    } catch {
      // Saying it twice is a smaller cost than not saying it at all.
    }
    return true;
  }
}

/** Whether the cap has already been raised, by settings or by the environment. */
function capRaised(settings, env) {
  return Boolean(settings?.env?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS || env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS);
}

function main() {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
  let cwd = process.cwd();
  try {
    const payload = JSON.parse(stdin);
    if (payload && typeof payload.cwd === "string") cwd = payload.cwd;
  } catch {
    // A payload that will not parse still leaves a working directory to read
    // settings from.
  }

  const said = notice({ cwd });
  if (said === null) return;
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: said } })}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
