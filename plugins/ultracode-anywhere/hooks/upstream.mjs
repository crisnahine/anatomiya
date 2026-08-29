/**
 * What this plugin mirrors, and whether it is still there.
 *
 * The premise is read off one installed build: the standing orchestration
 * reminder is gated on the resolved effort being xhigh, the Workflow tool is
 * gated on `enableWorkflows` and the plan and policy around it with no effort
 * term anywhere, and the reminder repeats on a fixed turn cadence. A build
 * that stops carrying those strings, or the gate, is a build this plugin can
 * no longer claim to mirror, and a plugin that cannot tell is one that rots
 * quietly. Four names and one shape are what a read can check; what it cannot
 * see is the list in VERIFYING.md.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";

import { readIfFile } from "./hook-io.mjs";
import { Unkept } from "./counters.mjs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/**
 * The build this plugin's premise was read off, and the shape it was read as.
 * A version whose minor or major differs, or that sits a run of patches on, is
 * one nobody has checked, which is worth saying out loud even when every name
 * is still there.
 */
export const CALIBRATED_AGAINST = "2.1.251";

/**
 * The gate itself, as a shape rather than a name.
 *
 * The build ships as a compiled binary but its JavaScript is readable inside:
 * the predicate is one minified function whose names change between builds and
 * whose shape does not. What the premise needs is that the xhigh term is a
 * conjunct, so this matches a function returning a flag, a call and an effort
 * comparison against "xhigh". A build that stops requiring xhigh there is a
 * build this plugin no longer describes, whatever names survive (A31).
 *
 * Spellings a minifier chooses between are all accepted: `!0` or `true`,
 * either quote, a helper called with an argument or through `?.`. Read as a
 * drift, a respelling nags every session, or under strict switches the plugin
 * off on a build whose gate still holds.
 */
export const GATE = /function [A-Za-z_$][\w$]*\([^)]{0,24}\)\{return [\w$]+===(?:!0|true)&&[\w$]+(?:\?\.)?\([^)]{0,24}\)&&[\w$]+\([^)]{0,24}\)===["']xhigh["']\}/;

/** What a missing gate is called when the check reports it. */
export const GATE_SHAPE = "the xhigh gate the reminder is emitted under";

/** Characters kept across a read boundary so a gate lying on one is still whole. */
const GATE_REACH = 200;

/**
 * What the premise rests on, each one read out of an installed build.
 *
 * The last is the load-bearing one and it is a sentence rather than a name: the
 * Workflow tool's own description counts a standing ultracode mode as the
 * explicit opt-in it otherwise refuses to act without, and names a
 * system-reminder as what confirms that mode. That sentence is the contract
 * this plugin satisfies by restating the reminder. Reworded upstream, the
 * reminder still arrives and means nothing.
 *
 * A proximity test on the gate itself was tried and dropped: the closest
 * `xhigh` to any of the 9 `ultra_effort_enter` sites in the build this was read
 * off is 168,197 bytes away, so any window narrow enough to mean anything would
 * have failed on the build it was calibrated against (A29).
 */
export const MARKERS = [
  "ultra_effort_enter",
  "enableWorkflows",
  "TURNS_BETWEEN_MAINTENANCE",
  "Ultracode is on for the session (a system-reminder confirms it)",
];

/**
 * The settings and variables that decide whether this hook has anything to
 * add, in the order the build reads them: the two disable switches first, then
 * the variable that withdraws the feature, then `enableWorkflows`, then the
 * standing mode itself.
 */
export const CONFLICTS = {
  CLAUDE_CODE_DISABLE_WORKFLOWS: "CLAUDE_CODE_DISABLE_WORKFLOWS is set, so there is no Workflow tool for the reminder to point at",
  disableWorkflows: "settings.json sets \"disableWorkflows\": true, so there is no Workflow tool for the reminder to point at",
  CLAUDE_CODE_WORKFLOWS: "CLAUDE_CODE_WORKFLOWS is set to false, so there is no Workflow tool for the reminder to point at",
  enableWorkflows: "settings.json sets \"enableWorkflows\": false, so there is no Workflow tool for the reminder to point at",
  ultracode: "settings.json sets \"ultracode\": true, so effort resolves to xhigh over effortLevel and the built-in reminder fires. A --effort flag or /effort below xhigh beats the key, and that session gets no reminder from either side",
};

/** A boolean variable as the build reads one: 1, true, yes or on, in any case. */
function isOn(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase().trim());
}

function isOff(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase().trim());
}

const CHUNK = 1 << 20;

/**
 * The floor a file has to clear to be the build rather than something pointing
 * at it. The shipped bundle is hundreds of megabytes; the `claude` on PATH is
 * often a launcher of about a kilobyte, and `npm test` puts one first. Read as
 * the build, a launcher carries none of the markers and every machine with one
 * is told upstream moved.
 */
export const MIN_BUNDLE = 5_000_000;

/** The settings Claude Code would read here: the user's, with a project's own on top. */
export function settingsFor(env = process.env, cwd = "") {
  const home = homeOf(env);
  const config = env.CLAUDE_CONFIG_DIR || (home && join(home, ".claude"));
  const paths = config ? [join(config, "settings.json")] : [];
  if (cwd) paths.push(join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json"));

  const merged = {};
  for (const path of paths) Object.assign(merged, readSettings(path));
  return merged;
}

/**
 * The home Claude Code would read, which a test may point somewhere of its
 * own, and nothing when the account has none. The same rule as the counters
 * keep: a home named and empty is no home, not the process's own.
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

function readSettings(path) {
  try {
    const value = JSON.parse(readIfFile(path));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Why this hook should stay quiet in this session, or null when it should speak. */
export function conflictIn(settings, env = process.env) {
  if (isOn(env.CLAUDE_CODE_DISABLE_WORKFLOWS)) return CONFLICTS.CLAUDE_CODE_DISABLE_WORKFLOWS;
  if (settings?.disableWorkflows === true) return CONFLICTS.disableWorkflows;
  if (isOff(env.CLAUDE_CODE_WORKFLOWS)) return CONFLICTS.CLAUDE_CODE_WORKFLOWS;
  if (settings?.enableWorkflows === false) return CONFLICTS.enableWorkflows;
  if (settings?.ultracode === true) return CONFLICTS.ultracode;
  return null;
}

/**
 * The installed Claude Code bundle, or null when this cannot find one.
 *
 * A path it was handed wins, then the command on PATH resolved through its
 * links, which is where a version-managed install keeps the real file.
 */
export function cliPath(env = process.env) {
  for (const candidate of candidates(env)) {
    if (isBundle(candidate)) return real(candidate);
  }
  return null;
}

/** Every place a build could be, most specific first. */
function* candidates(env) {
  // The running build says where it is. Read off the environment Claude Code
  // sets rather than guessed at, which is the only candidate here that cannot
  // be some other program of the same name.
  if (env.CLAUDE_CODE_EXECPATH) yield real(env.CLAUDE_CODE_EXECPATH);

  // Windows installs put a launcher rather than the build on PATH, under any of
  // three names, and this yields all of them: the size floor below decides
  // which, if any, is the build itself.
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude.ps1", "claude"] : ["claude"];
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) yield real(join(dir, name));
  }

  const home = homeOf(env);
  if (!home) return;
  const versions = join(home, ".local", "share", "claude", "versions");
  for (const name of newestFirst(versions)) yield real(join(versions, name));
  yield real(join(home, ".claude", "local", "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
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
      .map((name) => ({ name, version: versionOf(name), at: mtimeOf(join(dir, name)) }))
      .sort((a, b) => compareVersions(a, b) || b.at - a.at || a.name.localeCompare(b.name))
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

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The version of the build being read, when the path says it, and null when it
 * does not. Read off the path rather than by running the binary: this is a
 * session-start check, and spawning the CLI to ask costs more than the check.
 */
export function versionOf(cli) {
  const name = String(cli ?? "").split(/[\\/]/).pop() ?? "";
  return /^\d+\.\d+\.\d+$/.test(name) ? name : null;
}

/**
 * Patch releases between the calibrated build and the installed one before the
 * gap is worth a line.
 *
 * One patch is noise: Claude Code updates itself, and a line on every update is
 * a line nobody reads. A run of them is a fact, and ten is chosen for that noise
 * rather than fitted to any drift: the one that put this here went three patches
 * and would still be silent here. What the line buys is that the gap cannot grow
 * without bound, not that it catches the next one early. A patch bump is not
 * cosmetic either way, since two of the builds in that drift were the same size
 * to the byte with 176,881,324 of them different.
 */
export const PATCHES_BEFORE_STALE = 10;

/** A sentence when the installed build is one nobody calibrated against, or null. */
export function behind(installed, calibrated = CALIBRATED_AGAINST) {
  if (!installed || !/^\d+\.\d+\.\d+$/.test(installed)) return null;
  const [major, minor, patch] = installed.split(".").map(Number);
  const [wasMajor, wasMinor, wasPatch] = calibrated.split(".").map(Number);
  if (major === wasMajor && minor === wasMinor && patch - wasPatch < PATCHES_BEFORE_STALE) return null;
  return `this plugin was read off Claude Code ${calibrated} and the build here is ${installed}, which nobody has checked it against`;
}

/**
 * The same answer as `drift`, computed once per build rather than once per
 * session: reading a 197 MB bundle is about ninety milliseconds warm, and the
 * answer cannot change while the file it was read from has not.
 */
export function driftCached(cli, state, remember) {
  try {
    return remember(state, "drift", buildKey(cli), () => {
      const read = drift({ cli });
      // An answer nobody could read is not an answer: kept, it would say "fine"
      // for as long as the build's size and timestamp hold still, which an
      // unreadable build does not move.
      if (!read.checked) throw new Unkept(null);
      return read.reason;
    });
  } catch (err) {
    // Whether the memoiser understands a refusal is its business, not the
    // caller's: this module asked for it, so this module answers for it.
    if (err instanceof Unkept) return err.answer;
    throw err;
  }
}

/** What the answer depends on: this build, at this size, written at this moment. */
function buildKey(cli) {
  if (!cli) return "none";
  try {
    const seen = statSync(cli);
    return `${cli} ${seen.size} ${seen.mtimeMs}`;
  } catch {
    return cli;
  }
}

/**
 * Which markers the installed build no longer carries, and whether the gate is
 * still spelled the way the premise needs it spelled.
 *
 * `checked: false` is the answer when there is nothing to read: no build found,
 * or one this account cannot open. Not finding a build is not evidence of
 * drift, and reporting it as drift would cry wolf on every machine that keeps
 * its install somewhere this does not look.
 */
export function drift({ cli = cliPath() } = {}) {
  const absent = { checked: false, missing: [], reason: null };
  if (!cli || !existsSync(cli)) return absent;
  // A file too small to be the build is a launcher or a stub: no evidence
  // either way, the way a build this cannot find is none. Reading markers out
  // of one reports a drift that has not happened, and answering "checked" for
  // one kept a launcher on record as a build that is fine.
  if (!isBundle(cli)) return absent;

  let found;
  try {
    found = carries(cli);
  } catch {
    return absent;
  }

  // A file carrying none of them is not a build that dropped them, it is some
  // other program of the same name, and a 5 MB file called `claude` earlier on
  // PATH is all it takes. Drift is some of the four missing, not all.
  const missing = MARKERS.filter((m) => !found.markers.has(m));
  if (missing.length === MARKERS.length) return absent;
  if (!found.gate) missing.push(GATE_SHAPE);
  return {
    checked: true,
    missing,
    reason: missing.length === 0 ? null : `this Claude Code build no longer carries ${missing.join(", ")}`,
  };
}

/**
 * The markers and the gate present in a file, found in one read.
 *
 * The bundle is hundreds of megabytes, so it is streamed rather than read
 * whole, and a second pass for the gate read most of it twice: the last marker
 * sits at the 172 MB mark of a 197 MB build and the gate at the 156 MB mark.
 */
function carries(path) {
  const markers = new Set();
  let gate = false;
  scan(path, Math.max(GATE_REACH, ...MARKERS.map((m) => m.length)), (text) => {
    for (const marker of MARKERS) {
      if (!markers.has(marker) && text.includes(marker)) markers.add(marker);
    }
    if (!gate) gate = GATE.test(text);
    return gate && markers.size === MARKERS.length;
  });
  return { markers, gate };
}

/**
 * Reads a file a megabyte at a time, handing each chunk to `look` with the tail
 * of the last one in front of it, so a match lying across a boundary is still
 * found. `look` returning true ends the read.
 */
function scan(path, overlap, look) {
  const buffer = Buffer.allocUnsafe(CHUNK);
  let fd;
  let carry = "";
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    // Advanced by what was read, not by what was asked for: a short read on a
    // network or fuse filesystem would otherwise skip the difference, and a
    // marker in the gap reads as a build that dropped it.
    for (let at = 0; at < size; ) {
      const read = readSync(fd, buffer, 0, CHUNK, at);
      if (read <= 0) break;
      at += read;
      const text = carry + buffer.toString("latin1", 0, read);
      if (look(text)) break;
      carry = text.slice(-overlap);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
