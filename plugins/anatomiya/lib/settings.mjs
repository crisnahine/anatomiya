/**
 * The settings entry an older version arranged, and its removal.
 *
 * 0.2.4 through 0.2.6 wrote the echo into `settings.local.json`, where
 * `${CLAUDE_PLUGIN_ROOT}` is never substituted (A24); the plugin declares its
 * hooks in `hooks/hooks.json` now, and a scan takes the old entry out.
 *
 * `settings.local.json` rather than `settings.json`: A1 keeps this tool's
 * writes inside `.claude/rules/` so a writer bug cannot destroy a file somebody
 * maintains by hand, and a repository's `settings.json` holds its permission
 * lists and its other hooks. The local file is Claude Code's own per-developer
 * scope, it is git-ignored, and it matches where the map already lives: yours,
 * on this machine, not committed.
 */
import { accessSync, constants, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { HEAD_BYTES, SETTINGS_PATH, readHead, resolveInside } from "./rules.mjs";
import { atomic } from "./store.mjs";

export { SETTINGS_PATH };

// `${CLAUDE_PLUGIN_ROOT}` is the plugin's own directory, and it is substituted
// only for a hook the plugin declares in `hooks/hooks.json`. Written into a
// repository's own settings it is not substituted at all: Claude Code refuses
// the hook by name, on every prompt and every tool call, for the life of that
// session. So the declaration lives in `hooks/hooks.json` beside this, and the
// string is exported for the test that holds the two in step.
export const HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo';

/** The write-time half, declared on `PreToolUse` and answering for one path. */
export const NOTICE_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" notice';

/** The end-of-turn half, declared on `Stop` and answering for what the turn added. */
export const REUSE_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" reuse';

/** The session-start and HEAD-moved hook: starts the refresh worker (`refresh.mjs`). */
export const REFRESH_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" refresh';

// What an older version wrote, quoted or not. The removal has to reach every
// spelling that ever shipped rather than only the one this build would write.
// `echo` and no other verb, because the sweep may only take out what a version
// of this tool put there: 0.2.4 through 0.2.6 wrote that one and nothing has
// written a settings hook since, so matching `notice` here would delete one a
// person installed by hand. Named through `${CLAUDE_PLUGIN_ROOT}` and ending at
// the verb, because every one of them did, and that variable going unsubstituted
// is what broke them: a hook a person wired to a clone's absolute path runs,
// and `echo-stats` is somebody's own verb, and a looser match takes both. A whole group
// goes at a time, so one sharing a group with the old entry still goes with it;
// what that installer wrote was a group of its own, which is what keeps the
// path narrow rather than closed.
const isOurCommand = (command) => /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/anatomiya\.mjs"?\s+echo\s*$/.test(String(command ?? ""));

/** Whether a hook group is one of ours, by the command it runs. */
const isOurs = (group) => (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => isOurCommand(h?.command));

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The shape a value has to have before it is merged into, or the reason it does
 * not.
 *
 * Spreading is what makes this necessary rather than optional: `{...someString}`
 * is `{"0":"P","1":"r",...}` and `[..."fmt.sh"]` is a list of characters, so a
 * settings file holding the wrong type one level down was rewritten into
 * indexed keys rather than refused. Same rule the top level already applies,
 * applied at every level a spread reaches.
 */
const mustBe = (ok, what, where) => {
  if (!ok) throw new Error(`${SETTINGS_PATH} has ${where} as ${what}, so it was left alone`);
};

/**
 * What taking the old hook out would change, without changing it (A19).
 *
 * Settings that do not parse are refused rather than replaced. The file holds
 * permission lists and other people's hooks, and a writer that treats
 * unreadable as absent is a writer that deletes them.
 */
export function planRemoval(root) {
  // F2, and the reason it is asked here rather than assumed: `join` normalises
  // `..` and resolves no link, so a tracked `settings.local.json -> ../../x`,
  // or one link at `.claude`, put a rewrite in a file the repository does not
  // own. Both survive a clone.
  const path = resolveInside(root, SETTINGS_PATH);
  if (path === null) {
    throw new Error(`${SETTINGS_PATH} resolves outside the repository, so it was left alone`);
  }
  if (!existsSync(path)) return { root, path, changed: false, settings: null, empty: false };

  // Through the same reader as everything else this module opens, rather than a
  // bare `readFileSync`: that types nothing and bounds nothing, so a fifo left
  // at this path held every scan for ever with nothing printed, and a large
  // file at it was the cost of every scan. `readHead` opens with O_NONBLOCK,
  // stats the handle it opened rather than the path, and stops at the cap.
  const entry = readHead(path, HEAD_BYTES + 1);
  if (entry.kind !== "file") {
    throw new Error(`${SETTINGS_PATH} could not be read as a file, so it was left alone`);
  }
  if (entry.size > HEAD_BYTES) {
    throw new Error(`${SETTINGS_PATH} could not be read: it is larger than the ${HEAD_BYTES} bytes this reads`);
  }
  // A byte-order mark is not a malformed file, it is a file an editor wrote.
  const raw = entry.head.replace(/^\ufeff/, "");
  let settings;
  try {
    settings = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch (err) {
    throw new Error(`${SETTINGS_PATH} could not be read as JSON, so it was left alone: ${err.message}`);
  }
  if (!isPlainObject(settings)) {
    throw new Error(`${SETTINGS_PATH} could not be read as a settings object, so it was left alone`);
  }

  // Null and absent say the same thing here, no hooks at all, and neither holds
  // one of ours. Anything else is a shape this cannot read without inventing.
  mustBe(settings.hooks == null || isPlainObject(settings.hooks), "something other than a block", "hooks");
  if (settings.hooks == null) return { root, path, changed: false, settings, empty: false };

  const hooks = {};
  let changed = false;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    mustBe(Array.isArray(groups), "something other than a list", event);
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length !== groups.length) changed = true;
    // An event holding only ours goes with it, rather than staying as an empty
    // list nobody wrote and nothing reads.
    if (kept.length > 0) hooks[event] = kept;
  }
  if (!changed) return { root, path, changed: false, settings, empty: false };

  const rest = { ...settings };
  if (Object.keys(hooks).length > 0) rest.hooks = hooks;
  else delete rest.hooks;
  return { root, path, changed: true, settings: rest, empty: Object.keys(rest).length === 0 };
}

/** Perform the plan, on the root it was planned for and no other (A19). */
export function commitRemoval(root, plan) {
  if (root !== plan.root) {
    throw new Error(`the plan was planned for ${plan.root}, so nothing was written to ${root}`);
  }
  if (!plan.changed) return plan;

  // A file this tool created and that now holds nothing else goes entirely: a
  // `{}` left behind is a file somebody has to wonder about. Replaced whole, since
  // a rewrite in place truncates first, and a full disk then left the file empty.
  if (plan.empty) unlinkSync(plan.path);
  else {
    // A rename needs only the directory's write bit, so a file its owner made read-only is refused first.
    accessSync(plan.path, constants.W_OK);
    atomic(plan.path, `${JSON.stringify(plan.settings, null, 2)}\n`);
  }
  return plan;
}

/**
 * Take out what an older version installed, and report what was there.
 *
 * A refusal is an answer rather than a throw, the way the install this replaces
 * refused: the map is the product, and a settings file this will not touch must
 * not take a scan that already wrote the whole map down with it. A dry run
 * changes nothing but still says what it found, because the whole point of one
 * is to be told.
 */
export function removeStaleHook(root, { dryRun = false } = {}) {
  try {
    const plan = planRemoval(root);
    if (!dryRun) commitRemoval(root, plan);
    return { removed: plan.changed, refused: null };
  } catch (err) {
    return { removed: false, refused: err.message };
  }
}
