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
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { OVERVIEW_FILE, RULES_DIR, SETTINGS_PATH, realpathOrNull, resolveInside } from "./rules.mjs";

export { SETTINGS_PATH };

// `${CLAUDE_PLUGIN_ROOT}` is the plugin's own directory, the same way
// `commands/*.md` reach this CLI: a hook that spelled a path into the user's
// checkout would break the moment the plugin moved.
export const HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo';

// Every user turn, and every tool call whichever way it went. `*` is every tool
// rather than a list, because a list is a thing to keep in step with the tools
// that exist. The failure event is here because `PostToolUse` fires only when a
// call succeeds, and a call that failed is still a move: without it, a run of
// denied edits or failing commands is the run that hears the map least, which
// is exactly backwards.
const EVENTS = [
  { event: "UserPromptSubmit", matcher: null },
  { event: "PostToolUse", matcher: "*" },
  { event: "PostToolUseFailure", matcher: "*" },
];

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
function overviewPath(from) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return null;
  for (;;) {
    const candidate = join(at, RULES_DIR, OVERVIEW_FILE);
    if (existsSync(candidate)) return candidate;
    if (isBoundary(at)) return null;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The map as a hook would deliver it, or null where there is none to deliver.
 *
 * Null rather than a note about the absence: a repository nobody has scanned is
 * the ordinary case, and saying so on every tool call is worse than silence.
 */
export function echoContext(root, { now = new Date() } = {}) {
  const path = overviewPath(root);
  if (path === null) return null;
  let map;
  try {
    map = readFileSync(path, "utf8");
  } catch {
    return null;
  }

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
const isOurs = (group) => (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => h?.command === HOOK_COMMAND);

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
 * What installing would change, without changing it (A19).
 *
 * Settings that do not parse are refused rather than replaced. The file holds
 * permission lists and other people's hooks, and a writer that treats
 * unreadable as absent is a writer that deletes them.
 */
export function planHook(root) {
  // F2, and the reason it is asked here rather than assumed: `join` normalises
  // `..` and resolves no link, so a tracked `settings.local.json -> ../../x`,
  // or one link at `.claude`, put this write in a file the repository does not
  // own. Both survive a clone. Measured before this call existed: a JSON file
  // two directories outside the repository came back with our hooks merged in.
  const path = resolveInside(root, SETTINGS_PATH);
  if (path === null) {
    throw new Error(`${SETTINGS_PATH} resolves outside the repository, so it was left alone`);
  }
  let settings = {};
  if (existsSync(path)) {
    // A byte-order mark is not a malformed file, it is a file an editor wrote.
    // `JSON.parse` refuses one, so it comes off before the parse rather than
    // costing a user the install over a character they cannot see.
    const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
    try {
      settings = raw.trim() === "" ? {} : JSON.parse(raw);
    } catch (err) {
      throw new Error(`${SETTINGS_PATH} could not be read as JSON, so it was left alone: ${err.message}`);
    }
    if (!isPlainObject(settings)) {
      throw new Error(`${SETTINGS_PATH} could not be read as a settings object, so it was left alone`);
    }
  }

  // Null and absent say the same thing here, no hooks yet, and both merge.
  // Anything else is a shape this cannot merge into without inventing keys.
  mustBe(settings.hooks == null || isPlainObject(settings.hooks), "something other than a block", "hooks");

  const hooks = { ...(settings.hooks ?? {}) };
  let changed = false;
  for (const { event, matcher } of EVENTS) {
    mustBe(hooks[event] == null || Array.isArray(hooks[event]), "something other than a list", event);
    const groups = [...(hooks[event] ?? [])];
    if (groups.some(isOurs)) continue;
    groups.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: "command", command: HOOK_COMMAND }],
    });
    hooks[event] = groups;
    changed = true;
  }

  return { root, path, changed, settings: { ...settings, hooks } };
}

/** Perform the plan, on the root it was planned for and no other (A19). */
export function commitHook(root, plan) {
  if (root !== plan.root) {
    throw new Error(`the plan was planned for ${plan.root}, so nothing was written to ${root}`);
  }
  if (!plan.changed) return plan;

  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, `${JSON.stringify(plan.settings, null, 2)}\n`);
  return plan;
}

/**
 * The pair composed, the way `writeMap` composes the map's own two calls.
 *
 * A refusal is an answer here rather than a throw: the map is the product and
 * this is an addition to it, so a settings file this will not touch must not
 * take a scan that already wrote the whole map down with it. A blind run wrote
 * no map (A13) and a dry run wrote nothing, and a hook pointed at a map that is
 * not there echoes nothing on every tool call for the life of the session.
 */
export function installHook(root, { dryRun = false, blind = false } = {}) {
  if (dryRun || blind) return { present: false, refused: null };
  try {
    commitHook(root, planHook(root));
    // Whether the hook is there, not whether this run put it there. The summary
    // reports what is true of the tree the way every other line in it does, and
    // a line that appeared only on the run that installed made the summary a
    // function of prior state: two scans over unchanged source then disagreed,
    // which is the one thing the corpus harness asserts they never do.
    return { present: true, refused: null };
  } catch (err) {
    return { present: false, refused: err.message };
  }
}
