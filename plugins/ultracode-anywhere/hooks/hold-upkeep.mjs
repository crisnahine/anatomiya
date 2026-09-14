#!/usr/bin/env node
/**
 * The spawn hold's upkeep (A81): the preload, the shadows of the built-in
 * agents, the copies held to the level, and the self-check.
 *
 * A session start runs it in the background, since a capture or a self-check
 * outlives any hook's timeout, and a terminal runs it to check the hold again:
 *
 *   node hold-upkeep.mjs --session-start --cwd DIR
 *   node hold-upkeep.mjs --verify [--cwd DIR]
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ownState, stateDirFor } from "./counters.mjs";
import { EFFORT_LEVELS } from "./effort.mjs";
import { TYPE_NAME, copiesDir, installedPlugins, pruneSessions, removeCopies, removeShadows, staleShadows, syncCopies, userFileAt, writeShadow } from "./hold-agents.mjs";
import { agentPlan, claudeVersion, inBatches, pruneChecks, realClaude, runProbe, scratchIn, verify } from "./hold-check.mjs";
import { FULL_ID, RETRY_MS, effortPin, holdStatePath, holdTarget, preloadPath, runningVersion } from "./hold-config.mjs";
import { plainLine, processRunning, readJson, writeWhole } from "./hold-files.mjs";
import { projectRoot } from "./hold-switch.mjs";
import { configDirFor, here, homeOf, invokedAs, localSettingsDir, projectSettingsFiles, readIfFile } from "./hook-io.mjs";
import { settingsFor } from "./upstream.mjs";

/** Where a captured subagent prompt ends and the text of the agent that launched it begins. */
const PROMPT_END = "\n\nMessages from the agent that launched you";

/** How many built-ins are captured at once, each a claude process of its own. */
const CAPTURES_AT_ONCE = 4;

/** A lock older than this belongs to a run that died, since a whole run takes far less. */
const LOCK_STALE_MS = 30 * 60 * 1000;

/** The user settings keys that decide a spawn's model, effort or hooks. */
const DECIDING_KEYS = ["env", "hooks", "disableAllHooks", "effortLevel", "maxEffortLevel", "model", "modelSettings", "ultracode"];

/** The variables the hold reads, which decide what a self-check finds as much as any setting does. */
const DECIDING_ENV = ["ULTRACODE_ANYWHERE_SPAWN_EFFORT", "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL_FORCE", "CLAUDE_CODE_FORK_SUBAGENT", "CLAUDE_CODE_EFFORT_LEVEL", "NODE_OPTIONS"];

/**
 * What NODE_OPTIONS loads into every node process. Inside a session a claude that
 * a node program starts runs at the held level on the held model, the switch
 * read the way `heldFrom` in hold-shim.mjs reads it, and a claude started from a
 * terminal is a main session that keeps its own, an npm install's included. It
 * needs nothing of the plugin, which can be uninstalled while NODE_OPTIONS still
 * names this file.
 */
const PRELOAD = `"use strict";
// ultracode-anywhere's spawn hold. A claude that a node program inside a session starts runs at the held level on the held model.
if (process.env.CLAUDECODE === "1") {
  const { lstatSync, readFileSync, realpathSync, statSync } = require("node:fs");
  const { homedir, userInfo } = require("node:os");
  const { basename, dirname, join, resolve } = require("node:path");
  ${homeOf}
  ${localSettingsDir}
  ${projectSettingsFiles}
  // A preload that throws stops every node program in the session, so anything unforeseen leaves this one alone.
  try {
    const envIn = (file) => {
      try {
        const env = JSON.parse(readFileSync(file, "utf8")).env;
        return env && typeof env === "object" && !Array.isArray(env) ? env : {};
      } catch {
        return {};
      }
    };
    const named = (env) => String(env.ULTRACODE_ANYWHERE_SPAWN_EFFORT ?? "").trim() !== "";
    const levelAt = (root) => {
      const project = projectSettingsFiles(root).map(envIn);
      // Windows reads an environment's names in any case, so a project's keys are too.
      const sets = (key, filled = false) => project.some((env) => Object.entries(env).some(([name, value]) => name.toUpperCase() === key && (!filled || String(value ?? "").trim() !== "")));
      const movesHome = sets("HOME") || sets("USERPROFILE");
      let own = {};
      try {
        const under = (home) => (home ? join(home, ".claude") : "");
        const account = () => under(userInfo().homedir);
        const dir = sets("CLAUDE_CONFIG_DIR") ? account() : process.env.CLAUDE_CONFIG_DIR || (movesHome ? account() : under(homeOf(process.env)));
        if (dir) own = envIn(join(dir, "settings.json"));
      } catch {}
      const decided = named(own) ? own : sets("ULTRACODE_ANYWHERE_SPAWN_EFFORT", true) || sets("CLAUDE_CONFIG_DIR") || movesHome ? {} : process.env;
      return String(decided.ULTRACODE_ANYWHERE_SPAWN_EFFORT ?? "").trim().toLowerCase();
    };
    // The directories the shim reads, in its order, and the first that holds decides.
    const roots = [process.env.ULTRACODE_ANYWHERE_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR];
    try {
      roots.push(process.cwd());
    } catch {}
    const level = [...new Set(roots.filter(Boolean))].map(levelAt).find((found) => ${JSON.stringify(EFFORT_LEVELS)}.includes(found));
    const model = String(process.env.CLAUDE_CODE_SUBAGENT_MODEL || "").trim();
    if (level) {
      const was = process.env.CLAUDE_CODE_EFFORT_LEVEL;
      // A hook runs under this too, and the hold refuses over the session's own value.
      if (was !== undefined && was !== level) process.env.ULTRACODE_ANYWHERE_REPLACED_EFFORT = was;
      process.env.CLAUDE_CODE_EFFORT_LEVEL = level;
      if (new RegExp(${JSON.stringify(FULL_ID.source)}, "i").test(model)) process.env.ANTHROPIC_MODEL = model;
    }
  } catch {}
}
`;

function digest(value) {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

function textsIn(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(textsIn);
  return [];
}

/** The built-in types the Agent tool's listing names, with each one's description and tools. */
export function listingEntries(body) {
  for (const text of textsIn(body)) {
    const at = text.indexOf("Available agent types");
    if (at < 0) continue;
    return text
      .slice(at)
      .split("\n")
      .flatMap((line) => {
        const found = /^- ([^:\s]+(?::[^:\s]+)?): (.*) \(Tools: (.*)\)$/.exec(line);
        return found ? [{ type: found[1], description: found[2], tools: found[3] }] : [];
      });
  }
  return [];
}

/**
 * What the built-in prompts can list: the enabled plugins at their installed
 * versions, and the user's skills. Timestamps are left out, since an update
 * check rewrites them without changing anything.
 */
export function pluginStamp(env = process.env) {
  const config = configDirFor(env);
  const enabled = settingsFor(env).enabledPlugins ?? {};
  let skills = [];
  try {
    skills = config ? readdirSync(join(config, "skills")).sort() : [];
  } catch {
    // No skills of the user's own.
  }
  const plugins = installedPlugins(env)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, installs]) => [id, enabled[id] === true, installs.map((install) => `${install.version}@${install.installPath}`).sort()]);
  return digest([plugins, skills]);
}

/** What a self-check result rests on: the plugin stamp, the user settings that decide a spawn, and the variables the hold reads. */
export function configStamp(env = process.env) {
  const settings = settingsFor(env);
  const held = holdTarget(env)?.level;
  // A hook carries the level the preload set and keeps the session's own aside, where a terminal carries the session's own.
  const effort = env.ULTRACODE_ANYWHERE_REPLACED_EFFORT ?? env.CLAUDE_CODE_EFFORT_LEVEL;
  const stamped = (name) => {
    if (name !== "CLAUDE_CODE_EFFORT_LEVEL") return env[name] ?? null;
    return held && effortPin(effort) === held ? null : effort ?? null;
  };
  return digest([pluginStamp(env), DECIDING_KEYS.map((key) => settings[key] ?? null), DECIDING_ENV.map(stamped)]);
}

/**
 * A configuration holding the real plugins, skills and commands but no agents
 * and no hooks, so a capture sees the built-ins answer with prompts that list
 * what this machine has installed.
 */
function captureConfig(env) {
  const config = configDirFor(env);
  const dir = scratchIn(env);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ enabledPlugins: settingsFor(env).enabledPlugins ?? {}, disableAllHooks: true }));
  for (const leaf of ["plugins", "skills", "commands"]) {
    try {
      if (config && existsSync(join(config, leaf))) symlinkSync(join(config, leaf), join(dir, leaf), "junction");
    } catch {
      // A capture without them lists less, and still captures the built-ins.
    }
  }
  return dir;
}

async function captureType(env, type, run) {
  const config = captureConfig(env);
  try {
    // Print mode reports an SDK entrypoint, and claude-code-guide is not offered to those.
    const { seen } = await runProbe({ ...run, base: env, plan: { main: agentPlan(type) }, env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_ENTRYPOINT: "shadow-capture" } });
    return { main: seen.find((row) => row.isMain)?.body, child: seen.find((row) => row.subagent)?.body };
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
}

function lastSystemText(body) {
  const system = body?.system;
  if (typeof system === "string") return system;
  return Array.isArray(system) ? String(system.at(-1)?.text ?? "") : "";
}

/**
 * Captures each built-in off the build and writes its shadow at `level`,
 * answering one line per type. A file of the user's own under a built-in's name
 * is kept, since it replaces the built-in already.
 */
export async function syncShadows({ env = process.env, version, stamp, level, ...run }) {
  const typesFile = holdStatePath(env, "builtin-types.json");
  if (!typesFile || !configDirFor(env)) return ["shadows: this machine has no configuration directory to write them into"];
  const first = await captureType(env, "general-purpose", run);
  const listing = listingEntries(first.main);
  const types = listing.map((entry) => entry.type).filter((type) => !type.includes(":"));
  if (types.length === 0) {
    // Kept so the session is told why a built-in is refused, and so the capture waits out the pause.
    const error = "the listing of built-in agents could not be read off this build, so no shadow was written, and a built-in agent without a current shadow is refused";
    writeWhole(holdStatePath(env, "shadows.json"), JSON.stringify({ version, stamp, level, at: new Date().toISOString(), error }));
    return ["shadows: the listing could not be read, so nothing was written"];
  }
  writeWhole(typesFile, JSON.stringify(types));

  const lines = await inBatches(types, CAPTURES_AT_ONCE, async (type) => {
    if (!TYPE_NAME.test(type)) return `${type}: not written, the name is not one a file can take`;
    if (userFileAt(env, type)) return `${type}: kept, a file of the user's own is there`;
    const { child } = type === "general-purpose" ? first : await captureType(env, type, run);
    const text = lastSystemText(child);
    const end = text.indexOf(PROMPT_END);
    if (end < 0) return `${type}: not captured`;
    const written = writeShadow(env, listing.find((entry) => entry.type === type), text.slice(0, end), version, level);
    return written ? `${type}: written from ${version}` : `${type}: kept, a file of the user's own is there`;
  });
  writeWhole(holdStatePath(env, "shadows.json"), JSON.stringify({ version, stamp, level, at: new Date().toISOString() }));
  return lines;
}

/**
 * An exclusive lock, answering the token that releases it or null: created only
 * where absent, released only by its holder, and taken over once stale. Two runs
 * that find one stale lock at once can both take it, and only repeat work, since
 * every write is whole.
 */
export function acquireLock(env = process.env) {
  const lock = holdStatePath(env, "lock");
  if (!lock || !ownState(stateDirFor(env))) return null;
  const token = `${process.pid}-${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(lock), { recursive: true });
      writeFileSync(lock, token, { flag: "wx" });
      return token;
    } catch (err) {
      if (err?.code !== "EEXIST") return null;
      try {
        // A holder that has exited released nothing, and one whose id cannot be read is given the whole stale age.
        const holder = /^(\d{1,10})-/.exec(readFileSync(lock, "utf8"))?.[1];
        const died = holder !== undefined && !processRunning(Number(holder));
        if (!died && Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) return null;
        unlinkSync(lock);
      } catch {
        // Released or taken over between the two reads.
      }
    }
  }
  return null;
}

/** Releases the lock when `token` still holds it. */
export function releaseLock(env = process.env, token) {
  const lock = holdStatePath(env, "lock");
  try {
    if (lock && readFileSync(lock, "utf8") === token) unlinkSync(lock);
  } catch {
    // Released already.
  }
}

/** Whether a record is due again: another build or stamp, or a failed run whose pause is over. */
export function needsVerify(state, version, stamp, now = Date.now()) {
  if (!state || state.version !== version || state.stamp !== stamp) return true;
  if (state.ok === true) return false;
  return !(now - Date.parse(state.at) < RETRY_MS);
}

/** Writes the preload where NODE_OPTIONS names it, answering its path, or null for a machine with nowhere to keep it. */
export function writePreload(env = process.env) {
  const path = preloadPath(env);
  if (!path) return null;
  if (readIfFile(path) !== PRELOAD) writeWhole(path, PRELOAD);
  return path;
}

/**
 * Removes the shadows and copies once the hold is off for a session in `root`.
 * The preload stays: NODE_OPTIONS may still name it, and node starts nothing
 * that requires a file that is gone.
 */
export function cleanUp(env = process.env, root = "") {
  if (holdTarget(env, { root })) return { copies: 0, shadows: 0 };
  const cleaned = { copies: removeCopies(env).length, shadows: removeShadows(env).length };
  try {
    rmdirSync(copiesDir(env));
  } catch {
    // Holding a file of the user's own, or not there.
  }
  const shadows = holdStatePath(env, "shadows.json");
  if (shadows) rmSync(shadows, { force: true });
  return cleaned;
}

/** Records upkeep that failed, for the session-start notice. */
export function recordFailure(env = process.env, version, err) {
  const file = holdStatePath(env, "upkeep.json");
  if (file) writeWhole(file, JSON.stringify({ version, error: plainLine(err?.message ?? err), at: new Date().toISOString() }));
}

/**
 * What a session start does. With the hold off it cleans up. With it on it writes
 * the preload, the shadows when the build or the plugins moved, and the copies,
 * and runs the self-check when it is due or `force` asks for it.
 */
export async function refresh({ env = process.env, root = "", version, force = false, now = Date.now(), ...run }) {
  const target = holdTarget(env, { root });
  if (!target) {
    pruneChecks(env, now);
    return { off: true, cleaned: cleanUp(env, root) };
  }

  pruneSessions(env, now);
  pruneChecks(env, now);
  writePreload(env);
  const plugins = pluginStamp(env);
  const lastCapture = readJson(holdStatePath(env, "shadows.json"), null);
  const moved = lastCapture?.version !== version || lastCapture?.stamp !== plugins || lastCapture?.level !== target.level;
  // A capture that left a built-in without its shadow, or read no listing, waits out the same pause a failed self-check does.
  const due = moved || ((staleShadows(env, version, target.level).length > 0 || typeof lastCapture.error === "string") && !(now - Date.parse(lastCapture.at) < RETRY_MS));
  const shadows = due ? await syncShadows({ env, version, stamp: plugins, level: target.level, ...run }) : [];
  const copies = syncCopies({ env, level: target.level });
  const stamp = configStamp(env);
  const previous = readJson(holdStatePath(env, "verified.json"), null);
  const verified = force || needsVerify(previous, version, stamp, now);
  const state = verified ? await verify({ env, version, stamp, ...run }) : previous;
  const failed = holdStatePath(env, "upkeep.json");
  const afterCapture = readJson(holdStatePath(env, "shadows.json"), null);
  if (afterCapture?.version === version && typeof afterCapture.error === "string") recordFailure(env, version, afterCapture.error);
  else if (failed) rmSync(failed, { force: true });
  return { shadows, copies, verified, state };
}

function report(done, version) {
  if (done.off) {
    process.stdout.write(`The spawn hold is not on, since ULTRACODE_ANYWHERE_SPAWN_EFFORT names no level. Removed ${done.cleaned.copies} copies and ${done.cleaned.shadows} shadows.\n`);
    return 1;
  }
  const { copies, shadows, state } = done;
  const lines = [`copies: ${copies.total} definitions off the level, ${copies.written.length} written, ${copies.removed.length} removed`, ...copies.written.map((file) => `+ ${file}`), ...copies.removed.map((file) => `- ${file}`), ...shadows];
  const findings = [...(state.leaks ?? []), ...(state.infra ?? []), ...(state.error ? [state.error] : [])];
  lines.push(state.ok ? `self-check passed on ${version}` : `self-check FAILED on ${version}:\n  ${findings.join("\n  ")}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return state.ok ? 0 : 1;
}

/** A terminal's environment with the user's settings env on top, the way a session started there would have it. */
function sessionEnv(env) {
  const named = env.CLAUDECODE === "1" ? null : settingsFor(env).env;
  if (!named || typeof named !== "object" || Array.isArray(named)) return env;
  const set = Object.entries(named).filter(([, value]) => value !== null && value !== undefined);
  return { ...env, ...Object.fromEntries(set.map(([name, value]) => [name, String(value)])) };
}

async function main(args, env = sessionEnv(process.env)) {
  const at = args.indexOf("--cwd");
  // A directory named on the command line is the one asked about, over any project a held shell names.
  const root = at >= 0 && args[at + 1] ? env.CLAUDE_PROJECT_DIR || args[at + 1] : projectRoot(env, here());
  const binary = realClaude(env);
  const version = runningVersion(env) || claudeVersion(binary, env);
  const asked = args.includes("--verify");
  // Shadows and a record kept under no build would never match a real one.
  if (asked && !version) {
    process.stderr.write("Could not tell which Claude Code build is installed: this is not a Claude Code session, and no claude on PATH answered --version. Nothing was recorded.\n");
    return 1;
  }
  const token = acquireLock(env);
  try {
    if (asked && !token) {
      const why = ownState(stateDirFor(env))
        ? `Another upkeep run holds the lock at ${holdStatePath(env, "lock")}. It is released when that run finishes, and taken over once its run has exited.`
        : "The hold's state directory is not one this account owns with no access for anyone else, so no lock can be taken there.";
      process.stderr.write(`${why} Nothing was recorded.\n`);
      return 1;
    }
    if (asked) return report(await refresh({ env, root, version, binary, force: true }), version);
    if (!token) return 0;
    try {
      if (version) await refresh({ env, root, version, binary });
      else {
        pruneChecks(env);
        if (holdTarget(env, { root })) {
          writePreload(env);
          syncCopies({ env, level: holdTarget(env, { root }).level });
        } else cleanUp(env, root);
      }
    } catch (err) {
      if (version) recordFailure(env, version, err);
    }
    return 0;
  } finally {
    if (token) releaseLock(env, token);
  }
}

if (invokedAs(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
