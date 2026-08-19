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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { OVERVIEW_FILE, RULES_DIR } from "./rules.mjs";

export const SETTINGS_PATH = ".claude/settings.local.json";

// `${CLAUDE_PLUGIN_ROOT}` is the plugin's own directory, the same way
// `commands/*.md` reach this CLI: a hook that spelled a path into the user's
// checkout would break the moment the plugin moved.
export const HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo';

// Every user turn, and every tool call. `*` is every tool rather than a list,
// because a list is a thing to keep in step with the tools that exist.
const EVENTS = [
  { event: "UserPromptSubmit", matcher: null },
  { event: "PostToolUse", matcher: "*" },
];

const overviewPath = (root) => join(root, RULES_DIR, OVERVIEW_FILE);

/**
 * The map as a hook would deliver it, or null where there is none to deliver.
 *
 * Null rather than a note about the absence: a repository nobody has scanned is
 * the ordinary case, and saying so on every tool call is worse than silence.
 */
export function echoContext(root, { now = new Date() } = {}) {
  const path = overviewPath(root);
  let map;
  try {
    map = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  // The frontmatter is how the file is delivered, not what it says.
  const body = map.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
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
  const path = join(root, SETTINGS_PATH);
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
