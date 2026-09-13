/**
 * What a session starts with while the spawn hold is on (A81): the exports its
 * shell gets, the lines it is told, and the upkeep that runs behind it.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ownState, stateDirFor } from "./counters.mjs";
import { heldAskedFor } from "./effort.mjs";
import { copiesDir, enabledPlugins, recordLoaded } from "./hold-agents.mjs";
import { RECHECK, RETRY_MS, holdGaps, holdStatePath, holdTarget, preloadPath, probingIn, runningVersion } from "./hold-config.mjs";
import { readJson } from "./hold-files.mjs";
import { namesSwitch, projectNamesSwitch, projectRedirects, projectRoot, switchEnv } from "./hold-switch.mjs";
import { readIfFile } from "./hook-io.mjs";

const HOOKS = dirname(fileURLToPath(import.meta.url));

/** A state path plain enough to name to the session, since a project's settings can set it. */
const PLAIN_PATH = /^[\w./ ~:\\-]{1,512}$/;

/** The line the exports carry that says a shell has them already. */
const EXPORTED = "export ULTRACODE_ANYWHERE_HELD_CHILD=";

/** A path the way Git Bash reads it on Windows, where the Bash tool runs, and as it is anywhere else. */
export function bashPath(path, platform = process.platform) {
  if (platform !== "win32") return path;
  return path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

/** A value quoted for a POSIX shell, whatever it holds. */
export function shellQuoted(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * The exports a held session's shell sources before each command: the shim first
 * on PATH, the held level, the held model and the child marker for any claude
 * started there without it, and the session's project, since the shell can be
 * in any directory by then. Empty while the hold is off.
 */
export function exportsFor(env = process.env, pluginRoot = dirname(HOOKS), root = "") {
  const target = holdTarget(env, { root });
  if (!target) return "";
  const shim = bashPath(join(pluginRoot, "shim"));
  return `${[
    `export CLAUDE_CODE_EFFORT_LEVEL=${shellQuoted(target.level)}`,
    `export ANTHROPIC_MODEL=${shellQuoted(target.model)}`,
    `${EXPORTED}'1'`,
    `export PATH=${shellQuoted(shim)}:"$PATH"`,
    `export CSD_CLAUDE_BIN=${shellQuoted(`${shim}/claude`)}`,
    ...(root ? [`export ULTRACODE_ANYWHERE_PROJECT_DIR=${shellQuoted(root)}`] : []),
  ].join("\n")}\n`;
}

function onlyStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** What a session is owed about the hold, one sentence per line, and nothing while it is off and complete. */
export function holdNotice({ env = process.env, cwd = "", accountHome = null } = {}) {
  const root = projectRoot(env, cwd);
  const asked = heldAskedFor(switchEnv(env, { root, accountHome }));
  if (asked) return [`ultracode-anywhere: ${asked}.`];
  const target = holdTarget(env, { root, accountHome });
  const moved = projectRedirects(root);
  if (!target && moved.some((key) => ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE"].includes(key)) && namesSwitch(env)) {
    return [`ultracode-anywhere: this project's settings set ${moved.join(", ")}, so the spawn hold reads your settings only from your own CLAUDE_CONFIG_DIR or your account's own home, which do not turn it on, and it is off here.`];
  }
  if (!target && projectNamesSwitch(root)) {
    return ["ultracode-anywhere: this project's settings set ULTRACODE_ANYWHERE_SPAWN_EFFORT, and only your own settings turn the spawn hold on, so it is off here."];
  }
  if (!target) return [];

  const said = [];
  const state = stateDirFor(env);
  // A state directory a project moved may sit in the repository, so nothing here makes it or reads it.
  const owned = moved.length === 0 && ownState(state);
  if (moved.length === 0 && !owned) {
    const where = PLAIN_PATH.test(state) ? state : "the directory ULTRACODE_ANYWHERE_STATE names";
    said.push(`ultracode-anywhere holds spawns to ${target.level} and cannot keep its state in ${state ? where : "a home this account has"}, which has to be a directory this account owns with no access for anyone else, so no upkeep runs and every spawn is refused.`);
  }
  const preload = preloadPath(env);
  const { required, recommended } = holdGaps(env, { preload: preload && existsSync(preload) ? preload : null, settings: { enabledPlugins: enabledPlugins(env, root) }, root, accountHome });
  if (required.length > 0) {
    said.push(`ultracode-anywhere holds spawns to ${target.level}, and every spawn is refused until these are fixed in settings.json: ${required.join("; ")}.`);
  }
  if (recommended.length > 0) said.push(`ultracode-anywhere holds spawns to ${target.level}, and these leave some spawns uncovered: ${recommended.join("; ")}.`);

  const version = runningVersion(env);
  if (!version || !owned) return said;
  const upkeep = readJson(holdStatePath(env, "upkeep.json"), null);
  if (upkeep?.version === version && typeof upkeep.error === "string") {
    said.push(`ultracode-anywhere's spawn hold upkeep failed on Claude Code ${version}, so spawns may be refused: ${upkeep.error}. Run ${RECHECK} to see it again.`);
  }
  const verified = readJson(holdStatePath(env, "verified.json"), null);
  if (verified?.version !== version) return said;
  const leaks = onlyStrings(verified.leaks);
  const infra = onlyStrings(verified.infra);
  if (leaks.length > 0) {
    said.push(`ultracode-anywhere's self-check found spawns off the level on Claude Code ${version}, so spawns are refused: ${leaks.join("; ")}. Run ${RECHECK} once it is fixed.`);
  } else if (infra.length > 0) {
    said.push(
      `ultracode-anywhere's self-check could not finish on Claude Code ${version}: ${infra.join("; ")}. The tripwire still stops a subagent off the level, and the check runs again at a session start once ${RETRY_MS / 60000} minutes have passed.`,
    );
  }
  return said;
}

/** Whether a hold that is off now left copies or shadows behind for upkeep to clean. */
function leftBehind(env) {
  const shadows = holdStatePath(env, "shadows.json");
  const copies = copiesDir(env);
  return Boolean((shadows && existsSync(shadows)) || (copies && existsSync(copies)));
}

/** Starts upkeep detached, since a capture or a self-check outlives any hook's timeout. */
function runUpkeep(args) {
  const child = spawn(process.execPath, [join(HOOKS, "hold-upkeep.mjs"), ...args], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

/**
 * The session-start half of the hold: the exports into the session's env file
 * once, the agents a new process loads, and upkeep in the background wherever
 * there is something for it to do.
 * A self-check probe is a session too, and upkeep from inside one would start
 * another self-check.
 */
export function startHold({ env = process.env, pluginRoot = dirname(HOOKS), cwd = "", session = null, source = "startup", startUpkeep = runUpkeep } = {}) {
  const root = projectRoot(env, cwd);
  const exports = exportsFor(env, pluginRoot, root);
  // A project that moves what the hold reads has every spawn refused, and may have pointed the hold's state into itself.
  const moved = projectRedirects(root).length > 0;
  // Before anything else can fail, and before upkeep can write definitions this process never loads.
  if (exports && !moved) {
    try {
      recordLoaded(env, session, root, { replace: source === "startup" });
    } catch {
      // An Agent call in this session is refused with the reason, which is the safe way to fail.
    }
  }
  if (exports && env.CLAUDE_ENV_FILE && !readIfFile(env.CLAUDE_ENV_FILE).includes(EXPORTED)) appendFileSync(env.CLAUDE_ENV_FILE, exports);
  // A project that names the switch turns the hold off only here, so what the hold wrote for sessions elsewhere stays.
  if (moved || (projectNamesSwitch(root) && !exports) || probingIn(env)) return;
  if (exports || leftBehind(env)) startUpkeep(["--session-start", "--cwd", cwd]);
}
