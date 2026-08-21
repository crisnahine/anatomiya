/**
 * The map put back in front of the model after every step, and the settings
 * entry that arranges it.
 *
 * The always-loaded channel already carries the overview once per turn (H1),
 * and this does not replace it: "What is deliberately not built" refuses a hook
 * as the delivery channel, and the 10-to-40% adherence that refusal cites was
 * measured on a hook *instead of* the always-loaded file. This is a hook *on
 * top of* it. The channel that scored 100% keeps carrying the map, and what
 * this adds is recency and a timestamp, so a long run cannot drift away from a
 * fact it was given hundreds of tool calls ago, and a copy that has gone stale
 * reads as stale rather than as the current answer.
 *
 * Written to `settings.local.json` rather than `settings.json`: A1 keeps this
 * tool's writes inside `.claude/rules/` so a writer bug cannot destroy a file
 * somebody maintains by hand, and a repository's `settings.json` holds its
 * permission lists and its other hooks. The local file is Claude Code's own
 * per-developer scope, it is git-ignored, and it matches where the map already
 * lives: yours, on this machine, not committed.
 */
import { existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { HEAD_BYTES, isOwned, OVERVIEW_FILE, RULES_DIR, SETTINGS_PATH, readHead, realpathOrNull, resolveInside } from "./rules.mjs";

export { SETTINGS_PATH };

// `${CLAUDE_PLUGIN_ROOT}` is the plugin's own directory, and it is substituted
// only for a hook the plugin declares in `hooks/hooks.json`. Written into a
// repository's own settings it is not substituted at all: Claude Code refuses
// the hook by name, on every prompt and every tool call, for the life of that
// session. So the declaration lives in `hooks/hooks.json` beside this, and the
// string is exported for the test that holds the two in step.
export const HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo';

// What an older version wrote, whichever way it spelled the path. The removal
// has to reach every spelling that ever shipped rather than only the one this
// build would write, and the quoting has already changed once.
const isOurCommand = (command) => /anatomiya\.mjs"?\s+echo\b/.test(String(command ?? ""));

/**
 * Whether a level is where one checkout's counts stop being about the code
 * under it: it carries a `.git` of any shape, or it cannot be looked at.
 *
 * Those two answer together because they fail the same way. `existsSync`
 * swallowed every error and said no, walking straight past a level it could
 * not see; `lstat` suppresses only ENOENT and throws the rest, and nothing
 * between here and the process catches it. A level that cannot be seen cannot
 * be shown to belong to the map above it, and silence costs one delivery where
 * the wrong map costs the session.
 */
function isBoundary(at) {
  try {
    return lstatSync(join(at, ".git"), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * The nearest map at or above a directory, or null where there is none.
 *
 * A hook fires with the session's own working directory, which is wherever the
 * model happens to be, and the map is written once at the repository root.
 * Walked rather than asked of `git rev-parse`, which is what every other
 * command does: this runs on every tool call, and a subprocess per call to
 * learn a path already on disk is a subprocess per call. `dirname` is its own
 * fixed point at the filesystem root, which is what ends the loop.
 *
 * The walk ends at a boundary, so a worktree, a submodule or a nested
 * repository hears nothing rather than the enclosing checkout's map, against a
 * branch those counts never described. Anything named `.git` is one, which is
 * the cheap side of asking the filesystem instead of git on every tool call.
 *
 * The starting directory is resolved through its links rather than around them,
 * which is F2's reasoning arriving at the read side: `resolve` normalises `..`
 * and follows no link, so a cwd reached through one walked the link's own
 * parents and stepped around every boundary beneath it. A cwd that will not
 * resolve answers no map, since a reader that cannot say where it is cannot say
 * the map above it is about the code there.
 */
function ownMap(from) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return null;
  for (;;) {
    const map = readOwned(join(at, RULES_DIR, OVERVIEW_FILE));
    if (map !== null) return map;
    if (isBoundary(at)) return null;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The file's text, when this tool wrote it and it is no larger than one of ours.
 *
 * Through `readHead` rather than a plain read, because this runs on every turn
 * and every tool call and the path is whatever is sitting there: a named pipe
 * never returns at all, which is a session that never returns, and a file
 * carrying our frontmatter and five megabytes of anything else went into the
 * model's context whole. `readHead` opens non-blocking, types the shape before
 * reading a byte, and stops at the size this repository already decided a rule
 * file may be. One byte past the cap is enough to know the file is over it.
 *
 * Whose it is decides whether the walk stops here, not only whether it answers:
 * a hand-written file in a subdirectory used to silence the repository's own
 * map for every session under it.
 */
function readOwned(path) {
  const entry = readHead(path, HEAD_BYTES + 1);
  if (entry.kind !== "file" || Buffer.byteLength(entry.head) > HEAD_BYTES) return null;
  return isOwned(entry.head) ? entry.head : null;
}

/**
 * The map as a hook would deliver it, or null where there is none to deliver.
 *
 * Null rather than a note about the absence: a repository nobody has scanned is
 * the ordinary case, and saying so on every tool call is worse than silence.
 */
export function echoContext(root, { now = new Date() } = {}) {
  const map = ownMap(root);
  if (map === null) return null;

  // The frontmatter is how the file is delivered, not what it says. A leading
  // BOM and CRLF are both read, the way `isOwned` reads them one module over:
  // a map re-saved on Windows carries both, and a strip that misses them puts
  // `generator: anatomiya` into the echoed body as if it were content.
  const body = map.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "").trim();
  if (body === "") return null;

  return [
    `<repository-map delivered="${now.toISOString()}">`,
    "Counted from this repository's own code and re-read just now.",
    "Where this and the code disagree, the code is right and the map is stale:",
    "run `anatomiya scan .` rather than believing this.",
    "",
    body,
    "</repository-map>",
  ].join("\n");
}

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

  // A byte-order mark is not a malformed file, it is a file an editor wrote.
  const raw = readFileSync(path, "utf8").replace(/^\ufeff/, "");
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
  // `{}` left behind is a file somebody has to wonder about.
  if (plan.empty) unlinkSync(plan.path);
  else writeFileSync(plan.path, `${JSON.stringify(plan.settings, null, 2)}\n`);
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
