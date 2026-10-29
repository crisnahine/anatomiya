/**
 * What each hook verb answers with. Kept apart from the commands a person runs,
 * so a hook process loads the map readers and not the scan, the check or the
 * parser behind them; and each verb loads its own module inside its function,
 * so the notice pays for no echo and the echo for no change reader (A100).
 */
import { join } from "node:path";

import { aboutDir, childLayouts, holdsTestIn, inCheckout, isPathTaken, ownLayout, targetIn } from "./hook.mjs";
import { windowOf } from "./payload.mjs";

/**
 * The directory whose repository answers this call.
 *
 * The call's own, where it has one. A file in no checkout at all falls to the
 * session's, because reading a system file, a dependency or another project's
 * source is ordinary and answering nothing there takes the map off a turn that
 * had one. A file that does have a checkout is answered by that checkout even
 * when the answer is silence: a nested repository with no map, or one whose map
 * is empty, must not be handed the enclosing one's counts, which is what the
 * boundary walk exists to refuse. A payload naming a place this cannot read at
 * all falls to the session's too, since it has said nothing about any other.
 *
 * The session's own may be absent: `process.cwd()` refuses once the directory a
 * session started in is unlinked, and the entry point lets that through rather
 * than losing the turn over it. Null then, and both callers answer with
 * silence, which is all a call this can place nowhere is owed.
 */
function answersFor(payload, cwd) {
  const about = aboutDir(payload, cwd);
  if (about !== null && inCheckout(about)) return about;
  return cwd ?? null;
}

/**
 * What a hook re-delivers: the map, stamped, as `additionalContext`.
 *
 * Every failure is silent and exits 0 by the caller's hand: a hook that errors
 * interrupts the run it was meant to help, and there is no answer here worth
 * that. An absent map, an unreadable payload and an event this cannot name all
 * answer with the same empty object.
 */
export async function runEcho(cwd, payload) {
  const event = payload?.hook_event_name;
  if (!event) return {};
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  // Loaded here: the echo's lock, its transcript walk and its text are the echo's alone.
  const { echoContext } = await import("./echo.mjs");
  const additionalContext = echoContext(root, { transcript: windowOf(payload), data: process.env.CLAUDE_PLUGIN_DATA ?? null });
  if (additionalContext === null) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/**
 * What a write is told about where it is going, or nothing at all (A44).
 *
 * It informs and never refuses. `deny` and `ask` are the only answers that stop
 * a path being chosen, and this rule rests on a namesake match that can read a
 * tested directory as untested, so refusing on it would stall real work over a
 * count that was wrong. The same reason the rest of this file exits 0 whatever
 * happens (A24).
 */
export async function runNotice(cwd, payload) {
  const event = payload?.hook_event_name;
  if (!event) return {};
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  const found = ownLayout(root);
  if (found === null) return {};
  const rel = targetIn(payload, found.root, cwd);
  if (rel === null) return {};
  // Only a path nothing is at yet. Where a file exists the path was chosen some
  // turns ago, and an `Edit` names one every time: saying it again on each edit
  // of the same spec is the block on every result this exists instead of.
  if (isPathTaken(join(found.root, rel))) return {};
  // No exclusion to make, unlike `check`, which subtracts everything its change
  // brought: the guard above has already answered for a path something is at,
  // so anything this finds in that directory is another file.
  // Loaded here: the echo shares this module and runs on every tool call, and
  // the notice's rules reach twelve modules the echo never loads.
  const { isTestPath, noticeFor } = await import("./precedent.mjs");
  const holdsTest = holdsTestIn(found.root, isTestPath);
  const additionalContext = noticeFor(rel, found.layout, { holdsTest, from: found.from });
  if (additionalContext === null) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/**
 * What the end of a turn is asked about the source it added, or nothing (A91).
 *
 * Once per file as it stands: a file an ask or a record in this session already
 * marked is not named again, and the stop right after this hook's own block
 * records what the check left, so its fix is not asked about on the next turn.
 *
 * A session started above its checkouts has no map of its own and a Stop
 * payload names no file, so each mapped checkout directly below is read, and
 * its files named from the session's directory. What the turn is asked is
 * `reuseAnswer`'s, in the module that reads the change.
 */
export async function runReuse(cwd, payload) {
  if (payload?.hook_event_name !== "Stop") return {};
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  const found = ownLayout(root);
  const checkouts = found !== null ? [{ root: found.root, prefix: "" }] : childLayouts(root).map((c) => ({ root: c.root, prefix: `${c.name}/` }));
  if (checkouts.length === 0) return {};
  // Loaded here: the change it reads comes from the check, which the echo and
  // the notice must not pay for on every tool call.
  const { reuseAnswer } = await import("./reuse.mjs");
  return reuseAnswer(checkouts, payload, { own: found?.root ?? null });
}
