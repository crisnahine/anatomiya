/**
 * What the spawn hold aims at, and what this configuration is missing for it.
 *
 * A plugin cannot set a session's environment: `plugin.json` has no `env` key
 * and a plugin's own `settings.json` is honoured for two keys, neither one.
 * So the model a spawn resolves to, whether a fork exists at all, and the
 * preload a node program loads all stay the user's settings. This reads them
 * the way the build does and names each one the hold cannot do without (A81).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ownState, stateDirFor } from "./counters.mjs";
import { EFFORT_LEVELS, heldLevelIn, shown } from "./effort.mjs";
import { readJson } from "./hold-files.mjs";
import { projectNames, projectRedirects, switchEnv } from "./hold-switch.mjs";
import { configDirFor, homeOf, realOf } from "./hook-io.mjs";
import { isOff, isOn, settingsFor, versionOf } from "./upstream.mjs";

/** The command that checks the hold again from a terminal, spelled with this install's own path. */
export const RECHECK = `node "${join(dirname(fileURLToPath(import.meta.url)), "hold-upkeep.mjs")}" --verify`;

/** The prefix of every directory the self-check makes. A hook believes a probe's log only inside one. */
export const SCRATCH = "ultracode-hold-check-";

/** An id that names a file here, so it may hold nothing a path could use. */
export const FILE_ID = /^[\w-]{1,128}$/;

/** How long a self-check that did not pass waits before a session start tries it again. */
export const RETRY_MS = 30 * 60 * 1000;

/** How old a check directory is before a later run takes it for one a killed run left, the age a stale lock is taken over at. */
const LEFT_BEHIND_MS = 30 * 60 * 1000;

/** The directories in the checks directory `dir` a killed run left, old enough that no run still going owns one. */
export function leftBehindChecks(dir, now = Date.now()) {
  try {
    return readdirSync(dir).filter((name) => {
      if (!name.startsWith(SCRATCH)) return false;
      try {
        return now - statSync(join(dir, name)).mtimeMs > LEFT_BEHIND_MS;
      } catch {
        // Gone since the listing, so nothing to clean.
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** What follows a probe's name in a leak that says its main loop was lowered. */
export const LOWERED = ": the main loop was lowered to ";

/** The value of a record's `mainLoopJudge` when a control run judged its main-loop leaks. */
export const JUDGED_BY_CONTROL = "control";

/** Where the hold keeps one file of its own state, beside the turn counters, or null for a machine with nowhere to keep it. */
export function holdStatePath(env = process.env, name) {
  const dir = stateDirFor(env);
  return dir ? join(dir, "hold", name) : null;
}

/** Where the self-check makes its directories: inside the hold's own state, where no repository can put one. */
export function checksDir(env = process.env) {
  return holdStatePath(env, "checks");
}

/**
 * Whether a call comes from a self-check probe on its own local stand-in.
 *
 * A settings file can set the flag, a local base URL and the log's path, so the
 * log also has to sit in a directory the self-check made inside the hold's
 * state, for this account alone.
 */
export function probingIn(env = process.env) {
  const log = String(env.ULTRACODE_ANYWHERE_HOLD_CHECK_LOG ?? "");
  const checks = checksDir(env);
  return (
    env.ULTRACODE_ANYWHERE_HOLD_CHECK === "1" &&
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(String(env.ANTHROPIC_BASE_URL ?? "")) &&
    Boolean(checks) &&
    basename(dirname(log)).startsWith(SCRATCH) &&
    realOf(dirname(dirname(log))) === realOf(checks) &&
    existsSync(log) &&
    ownState(dirname(log))
  );
}

/**
 * The build running this session, or "" where nothing says. `AI_AGENT` names it
 * on every install, and the exec path names it only on the native one.
 */
export function runningVersion(env = process.env) {
  const named = /claude-code_(\d+)-(\d+)-(\d+)/.exec(String(env.AI_AGENT ?? ""));
  if (named) return `${named[1]}.${named[2]}.${named[3]}`;
  return versionOf(env.CLAUDE_CODE_EXECPATH) ?? "";
}

/** Claude Code's own state file: in the home directory, or inside `CLAUDE_CONFIG_DIR` when that is set. */
export function globalConfigFile(env = process.env) {
  const base = env.CLAUDE_CONFIG_DIR || homeOf(env);
  return base ? join(base, ".claude.json") : null;
}

/** A model id a request can be compared against. An alias names no family, and `inherit` names the session's. */
export const FULL_ID = /^claude-[a-z0-9][a-z0-9.-]*(\[1m\])?$/i;

/** The suffix that asks for the 1M context window, which requests and transcripts leave off the name. */
const CONTEXT_1M = /\[1m\]$/i;

/** Where the preload lives: beside the configuration, and out of the state directory a reset of the turn counters removes. */
export function preloadPath(env = process.env) {
  const config = configDirFor(env);
  return config ? join(config, "ultracode-anywhere-preload.cjs") : null;
}

/** Whether a plugin is on in a merged `enabledPlugins`, under whichever marketplace it came from. */
export function pluginEnabled(enabled, plugin) {
  return Object.entries(enabled ?? {}).some(([id, on]) => on === true && id.startsWith(`${plugin}@`));
}

/** Whether a model is the held family: its own name, or that name and a date. */
export function sameFamily(model, family) {
  const name = String(model ?? "").toLowerCase();
  return name === family || (name.startsWith(`${family}-`) && /^\d{8}$/.test(name.slice(family.length + 1)));
}

function listed(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A model id quoted where it is one, and counted where it is not, since the sentence reaches the session. */
function modelShown(value) {
  return FULL_ID.test(value) ? `"${value}"` : shown(value);
}

/**
 * What CLAUDE_CODE_EFFORT_LEVEL pins every request to, read the way the build
 * reads it: untrimmed, a level or an integer budget, null for unset or auto,
 * which send no effort and drop a spawn's own with it, and undefined for a value
 * that names nothing, which pins nothing.
 */
export function effortPin(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).toLowerCase();
  if (text === "unset" || text === "auto") return null;
  const level = text === "med" ? "medium" : text;
  if (EFFORT_LEVELS.includes(level)) return level;
  const budget = Number.parseInt(text, 10);
  return Number.isInteger(budget) ? budget : undefined;
}

/**
 * The level and model every spawn is held to, or null where the hold is off.
 *
 * The model is whatever `CLAUDE_CODE_SUBAGENT_MODEL` names, since that variable
 * is what the build spawns on, and a model this plugin named itself would go
 * stale with the next release.
 */
export function holdTarget(env = process.env, place = {}) {
  const level = heldLevelIn(switchEnv(env, place));
  if (!level) return null;
  const model = String(env.CLAUDE_CODE_SUBAGENT_MODEL ?? "").trim();
  return { level, model, family: model.replace(CONTEXT_1M, "").toLowerCase(), context1m: CONTEXT_1M.test(model) };
}

/**
 * What in this configuration keeps spawns from being held, each as a sentence
 * naming the setting.
 *
 * `required` is what every spawn is refused over until it is set, since without
 * it a spawn's model or effort is not the hold's to decide. `recommended` leaves
 * one kind of spawn uncovered, and the session is told of it without a refusal:
 * a node program starting claude, and episodic-memory's summarizer.
 */
export function holdGaps(env = process.env, { preload = null, settings = {}, root = "", accountHome = null } = {}) {
  const gaps = { required: [], recommended: [] };
  const decided = switchEnv(env, { root, accountHome });
  const target = holdTarget(env, { root, accountHome });
  if (!target) return gaps;

  const moved = projectRedirects(root);
  if (moved.length > 0) {
    gaps.required.push(`a project's settings set ${listed(moved)}, which the hold reads to find the user's settings, the session's project, its own state and the build a session runs`);
  }

  if (!FULL_ID.test(target.model)) {
    gaps.required.push(`CLAUDE_CODE_SUBAGENT_MODEL is ${target.model ? shown(target.model) : "unset"}, and spawns can only be held to a full model id such as claude-opus-5[1m]`);
  }
  const userModel = decided === env ? "" : String(decided.CLAUDE_CODE_SUBAGENT_MODEL ?? "").trim();
  if (userModel && userModel !== target.model) {
    gaps.required.push(`CLAUDE_CODE_SUBAGENT_MODEL is ${target.model ? modelShown(target.model) : "unset"} in this session and ${modelShown(userModel)} in the user settings, so a project's settings moved the model spawns run on`);
  }
  if (!userModel && projectNames(root, "CLAUDE_CODE_SUBAGENT_MODEL")) {
    gaps.required.push("a project's settings set CLAUDE_CODE_SUBAGENT_MODEL, and spawns can only be held to a model the user settings name beside the switch");
  }
  if (!isOn(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE)) {
    gaps.required.push("CLAUDE_CODE_SUBAGENT_MODEL_FORCE is not on, so an agent's own model or its caller's still decides what a spawn runs");
  }
  if (!isOff(env.CLAUDE_CODE_FORK_SUBAGENT)) {
    gaps.required.push("CLAUDE_CODE_FORK_SUBAGENT is not 0, and a fork runs at the session's own effort and model");
  }
  const read = settingsFor(env, root);
  // The preload sets this variable in every node process of a session, a hook's included, so the value it replaced and the settings are read too.
  for (const effort of new Set([env.CLAUDE_CODE_EFFORT_LEVEL, env.ULTRACODE_ANYWHERE_REPLACED_EFFORT, read.env?.CLAUDE_CODE_EFFORT_LEVEL])) {
    const pin = effortPin(effort);
    if (pin !== undefined && pin !== target.level) {
      gaps.required.push(`CLAUDE_CODE_EFFORT_LEVEL is ${shown(effort)}, and it outranks every spawn's own effort, so it has to be ${target.level} or removed`);
    }
  }
  for (const [name, cap] of [["maxEffortLevel", read.maxEffortLevel], ["the held model's maxEffortLevel", read.modelSettings?.[target.family]?.maxEffortLevel]]) {
    const at = EFFORT_LEVELS.indexOf(String(cap ?? "").toLowerCase());
    if (at >= 0 && at < EFFORT_LEVELS.indexOf(target.level)) gaps.required.push(`${name} is ${shown(cap)}, which caps every spawn below ${target.level}`);
  }

  if (preload && !requiredFiles(env.NODE_OPTIONS).includes(realOf(preload))) {
    gaps.recommended.push(`NODE_OPTIONS does not require ${preload}, so a claude that a node program starts keeps its own effort`);
  }
  const summarizer = pluginEnabled(settings?.enabledPlugins, "episodic-memory");
  if (summarizer && env.EPISODIC_MEMORY_API_MODEL !== target.model) {
    gaps.recommended.push(summarizes("EPISODIC_MEMORY_API_MODEL", env.EPISODIC_MEMORY_API_MODEL));
  }
  if (summarizer && env.EPISODIC_MEMORY_API_MODEL_FALLBACK !== target.model) {
    gaps.recommended.push(summarizes("EPISODIC_MEMORY_API_MODEL_FALLBACK", env.EPISODIC_MEMORY_API_MODEL_FALLBACK));
  }
  return gaps;
}

function summarizes(name, value) {
  return `${name} is ${value ? shown(value) : "unset"}, so episodic-memory summarizes on another model`;
}

/**
 * The files NODE_OPTIONS requires, as real paths.
 *
 * `-r=` is refused by node inside NODE_OPTIONS, so only `--require=`, and a
 * flag followed by its own word, count.
 */
function requiredFiles(nodeOptions) {
  const words = nodeOptionWords(String(nodeOptions ?? ""));
  const files = [];
  for (let at = 0; at < words.length; at++) {
    if (words[at] === "--require" || words[at] === "-r") files.push(words[++at]);
    else if (words[at].startsWith("--require=")) files.push(words[at].slice("--require=".length));
  }
  return files.filter(Boolean).map(realOf);
}

/**
 * NODE_OPTIONS split the way node's own parser splits it: on spaces alone, with
 * double quotes grouping and allowed to open inside a word, and a backslash
 * inside quotes taking the next character as it is. Node starts nothing on an
 * unterminated quote or a trailing escape, so those answer no words at all.
 */
function nodeOptionWords(text) {
  const words = [];
  let quoted = false;
  let fresh = true;
  for (let at = 0; at < text.length; at++) {
    let c = text[at];
    if (c === "\\" && quoted) {
      if (at + 1 === text.length) return [];
      c = text[++at];
    } else if (c === " " && !quoted) {
      fresh = true;
      continue;
    } else if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (fresh) words.push(c);
    else words[words.length - 1] += c;
    fresh = false;
  }
  return quoted ? [] : words;
}

/** Whether a leak says a probe's main loop was lowered. */
export function isMainLoopLeak(leak) {
  return typeof leak === "string" && leak.includes(LOWERED);
}

/** The self-check's last record, leaving out the main-loop leaks of one no control run judged. */
export function verifiedRecord(env = process.env) {
  const last = readJson(holdStatePath(env, "verified.json"), null);
  if (last?.mainLoopJudge === JUDGED_BY_CONTROL || !Array.isArray(last?.leaks)) return last;
  return { ...last, leaks: last.leaks.filter((leak) => !isMainLoopLeak(leak)) };
}
