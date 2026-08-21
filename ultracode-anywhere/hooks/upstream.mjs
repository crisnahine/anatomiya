/**
 * What this plugin mirrors, and whether it is still there.
 *
 * The premise is read off one installed build: the standing orchestration
 * reminder is gated on the resolved effort being xhigh, the Workflow tool is
 * gated on `enableWorkflows` alone, and the reminder repeats on a fixed turn
 * cadence. A build that stops carrying those strings is a build this plugin can
 * no longer claim to mirror, and a plugin that cannot tell is one that rots
 * quietly. Names, not behaviour: a string check cannot prove the gate still
 * reads the way it read, only that the thing it named still exists.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";

import { readIfFile } from "./hook-io.mjs";
import { Unkept } from "./counters.mjs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/**
 * The build this plugin's premise was read off, and the shape it was read as.
 * A version whose minor or major differs is one nobody has checked, which is
 * worth saying out loud even when every name is still there.
 */
export const CALIBRATED_AGAINST = "2.1.238";

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
 * A proximity test on the gate itself was tried and dropped: `xhigh` appears
 * nowhere within 20,000 characters of any of the 14 `ultra_effort_enter` sites
 * in the build this was read off, so it would have failed on the build it was
 * calibrated against (A29).
 */
/**
 * The gate itself, as a shape rather than a name.
 *
 * The build ships as a compiled binary but its JavaScript is readable inside:
 * the predicate is one minified function whose names change between builds and
 * whose shape does not. What the premise needs is that the xhigh term is a
 * conjunct, so this matches a function of three arguments returning a flag, a
 * call and an effort comparison against "xhigh". A build that stops requiring
 * xhigh there is a build this plugin no longer describes, whatever names
 * survive (A31).
 */
export const GATE = /function [A-Za-z_$][\w$]*\([^)]{0,24}\)\{return [\w$]+===!0&&[\w$]+\(\)&&[\w$]+\([^)]{0,24}\)==="xhigh"\}/;

/** What a missing gate is called when the check reports it. */
export const GATE_SHAPE = "the xhigh gate the reminder is emitted under";

export const MARKERS = [
  "ultra_effort_enter",
  "enableWorkflows",
  "TURNS_BETWEEN_MAINTENANCE",
  "Ultracode is on for the session (a system-reminder confirms it)",
];

/** Settings keys that decide whether this hook has anything to add. */
export const CONFLICTS = {
  ultracode: "settings.json sets \"ultracode\": true, so the built-in reminder already fires and effort is xhigh whatever effortLevel says",
  enableWorkflows: "settings.json sets \"enableWorkflows\": false, so there is no Workflow tool for the reminder to point at",
};

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
  const config = env.CLAUDE_CONFIG_DIR || join(homeOf(env), ".claude");
  const paths = [join(config, "settings.json")];
  if (cwd) paths.push(join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json"));

  const merged = {};
  for (const path of paths) Object.assign(merged, readSettings(path));
  return merged;
}

/** The home Claude Code would read, which a test may point somewhere of its own. */
function homeOf(env) {
  try {
    return env.CLAUDE_CONFIG_DIR ? "" : env.HOME || env.USERPROFILE || homedir();
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
export function conflictIn(settings) {
  if (settings?.ultracode === true) return CONFLICTS.ultracode;
  if (settings?.enableWorkflows === false) return CONFLICTS.enableWorkflows;
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

  const home = homeOf(env) || homedir();
  const versions = join(home, ".local", "share", "claude", "versions");
  for (const name of newestFirst(versions)) yield real(join(versions, name));
  yield real(join(home, ".claude", "local", "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
}

/** Version directory entries, newest name last written first. */
function newestFirst(dir) {
  try {
    return readdirSync(dir)
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .map((e) => e.name);
  } catch {
    return [];
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

/** A sentence when the installed build is one nobody calibrated against, or null. */
export function behind(installed, calibrated = CALIBRATED_AGAINST) {
  if (!installed || !/^\d+\.\d+\.\d+$/.test(installed)) return null;
  const [major, minor] = installed.split(".").map(Number);
  const [wasMajor, wasMinor] = calibrated.split(".").map(Number);
  if (major === wasMajor && minor === wasMinor) return null;
  return `this plugin was read off Claude Code ${calibrated} and the build here is ${installed}, which nobody has checked it against`;
}

/**
 * The same answer as `drift`, computed once per build rather than once per
 * session: reading a 321 MB bundle is 180 ms, and the answer cannot change
 * while the file it was read from has not.
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
 * Which markers the installed build no longer carries.
 *
 * `checked: false` is the answer when there is nothing to read: no build found,
 * or one this account cannot open. Not finding a build is not evidence of
 * drift, and reporting it as drift would cry wolf on every machine that keeps
 * its install somewhere this does not look.
 */
export function drift({ cli = cliPath(), markers = MARKERS } = {}) {
  const absent = { checked: false, missing: [], reason: null };
  if (!cli || !existsSync(cli)) return absent;
  // A file too small to be the build is a launcher or a stub, and reading
  // markers out of one reports a drift that has not happened.
  if (!isBundle(cli)) return { checked: true, missing: [], reason: null };

  let found;
  try {
    found = markersIn(cli, markers);
  } catch {
    return absent;
  }

  const gate = markers === MARKERS ? gateIn(cli) : true;

  // A file carrying none of them is not a build that dropped them, it is some
  // other program of the same name, and a 5 MB file called `claude` earlier on
  // PATH is all it takes. Drift is some of the four missing, not all.
  const missing = markers.filter((m) => !found.has(m));
  if (missing.length === markers.length) return absent;
  if (!gate) missing.push(GATE_SHAPE);
  return {
    checked: true,
    missing,
    reason: missing.length === 0 ? null : `this Claude Code build no longer carries ${missing.join(", ")}`,
  };
}

/** Whether the gate is still spelled the way the premise needs it spelled. */
function gateIn(path) {
  let found = false;
  try {
    scan(path, 200, (text) => {
      found = GATE.test(text);
      return found;
    });
  } catch {
    return true;
  }
  return found;
}

/**
 * The markers present in a file, read a megabyte at a time.
 *
 * The bundle is hundreds of megabytes, so it is streamed rather than read whole,
 * and each read keeps the tail of the last one so a marker lying across a
 * boundary is still found.
 */
function markersIn(path, markers) {
  const found = new Set();
  scan(path, Math.max(...markers.map((m) => m.length)), (text) => {
    for (const marker of markers) {
      if (!found.has(marker) && text.includes(marker)) found.add(marker);
    }
    return found.size === markers.length;
  });
  return found;
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
