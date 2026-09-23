/**
 * The installed Claude Code build, and the settings a trial would run under.
 *
 * The measurement harness needs both: `scripts/ab/engine.mjs` refuses a batch
 * whose engine a settings file decides ahead of its flags, and `test/ab.test.mjs`
 * reads the build itself for the model and the effort the harness pins. Neither
 * question is about a plugin, so neither belongs inside one; this is where the
 * two callers can name it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { realOf } from "./entry.mjs";
import { byCode } from "../plugins/anatomiya/lib/paths.mjs";

/**
 * The floor a file has to clear to be the build rather than something pointing
 * at it. The shipped bundle is a couple of hundred megabytes; the `claude` on
 * PATH is often a launcher of about a kilobyte, and `npm test` puts one first.
 * Read as the build, a launcher carries none of the strings a caller looks for
 * and every machine with one is told the build dropped them.
 */
export const MIN_BUNDLE = 5_000_000;

/**
 * The settings Claude Code would read for this account, or an empty object
 * where it has none.
 *
 * The user scope only. A project's own settings are read by the child after it
 * starts and the arms run in worktrees this harness has already cleared, so
 * there is nothing there a batch could inherit.
 *
 * Read with a plain `readFileSync`, which a hook on every prompt could not
 * afford: a fifo at this path blocks the read rather than answering nothing.
 * This runs once, at the start of a measurement somebody asked for, on that
 * person's own machine.
 */
export function settingsFor(env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || (homeOf(env) && join(homeOf(env), ".claude"));
  if (!config) return {};
  try {
    const value = JSON.parse(readFileSync(join(config, "settings.json"), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * The home Claude Code would read, which a test may point somewhere of its own,
 * and "" when the account has none. A home named and empty is no home rather
 * than the process's own.
 */
function homeOf(env) {
  const named = env.HOME || env.USERPROFILE;
  if (named) return named;
  if ("HOME" in env || "USERPROFILE" in env) return "";
  try {
    return homedir();
  } catch {
    return "";
  }
}

/**
 * The installed Claude Code bundle, or null when this cannot find one.
 *
 * The running build says where it is, then the command on PATH resolved through
 * its links, which is where a version-managed install keeps the real file.
 */
export function cliPath(env = process.env) {
  for (const candidate of candidates(env)) {
    if (isBundle(candidate)) return candidate;
  }
  return null;
}

/** Every place a build could be, most specific first. */
function* candidates(env) {
  if (env.CLAUDE_CODE_EXECPATH) yield realOf(env.CLAUDE_CODE_EXECPATH);

  // Windows installs put a launcher rather than the build on PATH, under any of
  // three names, and this yields all of them: the size floor decides which, if
  // any, is the build itself.
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude.ps1", "claude"] : ["claude"];
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) yield realOf(join(dir, name));
  }

  const home = homeOf(env);
  if (!home) return;
  const versions = join(home, ".local", "share", "claude", "versions");
  for (const name of newestFirst(versions)) yield realOf(join(versions, name));
  yield realOf(join(home, ".claude", "local", "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
}

/**
 * Version directory entries, highest version first.
 *
 * Ordered by the version in the name rather than by timestamp: two files
 * written in the same millisecond are a tie a fast runner produces and a laptop
 * does not, and a rollback writes an old version with a new timestamp. Names
 * that are not versions fall to the end, newest of those first.
 */
function newestFirst(dir) {
  try {
    return readdirSync(dir)
      .map((name) => ({ name, version: /^\d+\.\d+\.\d+$/.test(name) ? name : null, at: mtimeOf(join(dir, name)) }))
      .sort((a, b) => compareVersions(a, b) || b.at - a.at || byCode(a.name, b.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** A version before one below it, and any version before a name that is not one. */
function compareVersions(a, b) {
  if (!a.version || !b.version) return Number(Boolean(b.version)) - Number(Boolean(a.version));
  const left = a.version.split(".").map(Number);
  const right = b.version.split(".").map(Number);
  for (let at = 0; at < 3; at++) {
    if (left[at] !== right[at]) return right[at] - left[at];
  }
  return 0;
}

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Whether a path is big enough to be the build itself rather than a pointer to it. */
function isBundle(path) {
  try {
    const seen = statSync(path);
    return seen.isFile() && seen.size >= MIN_BUNDLE;
  } catch {
    return false;
  }
}
