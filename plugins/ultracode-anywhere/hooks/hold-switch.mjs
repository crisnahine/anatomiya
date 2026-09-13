/**
 * Where the spawn hold's switch is read (A81), apart from the hold itself, so the
 * hook that runs on every tool call can read it before it loads anything else.
 *
 * The user's own settings decide it. A project's settings win over them for the
 * session and a cloned repository can carry some, so a project that moves the
 * home or the configuration directory away from the user's settings is read
 * past, to a CLAUDE_CONFIG_DIR it did not set or the account's own home, and a
 * project that names the switch itself turns nothing on.
 */
import { userInfo } from "node:os";
import { join } from "node:path";

import { configDirFor, readIfFile } from "./hook-io.mjs";

/** The variables a project could set to move what the hold reads: the user's settings, its own state, and the build a session runs. */
const REDIRECTS = ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE", "ULTRACODE_ANYWHERE_STATE", "AI_AGENT", "CLAUDE_CODE_EXECPATH"];

function settingsEnvIn(file) {
  try {
    const env = JSON.parse(readIfFile(file))?.env;
    return env && typeof env === "object" && !Array.isArray(env) ? env : {};
  } catch {
    return {};
  }
}

/** Whether a settings `env` names the switch at all, with a level or without one. */
export function namesSwitch(env) {
  return String(env?.ULTRACODE_ANYWHERE_SPAWN_EFFORT ?? "").trim() !== "";
}

/**
 * The project a session runs in: the directory Claude Code names for it, the one
 * a held session's exports name for its shell, which Claude Code names nothing
 * to, else where the call runs.
 */
export function projectRoot(env = process.env, cwd = "") {
  return env.CLAUDE_PROJECT_DIR || env.ULTRACODE_ANYWHERE_PROJECT_DIR || cwd;
}

function projectEnvs(root) {
  return root ? [settingsEnvIn(join(root, ".claude", "settings.json")), settingsEnvIn(join(root, ".claude", "settings.local.json"))] : [];
}

/** The redirecting variables a project's own settings set, in any case since Windows reads names that way, in the order `REDIRECTS` lists them. */
export function projectRedirects(root) {
  const named = projectEnvs(root);
  return REDIRECTS.filter((key) => named.some((env) => Object.keys(env).some((name) => name.toUpperCase() === key)));
}

/** Whether a project's own settings name the switch, in any case, which only the user's own settings may. */
export function projectNamesSwitch(root) {
  return projectEnvs(root).some((env) => Object.entries(env).some(([name, value]) => name.toUpperCase() === "ULTRACODE_ANYWHERE_SPAWN_EFFORT" && String(value ?? "").trim() !== ""));
}

/** The redirects that move where Claude Code reads the user's own settings. */
const SETTINGS_LOCATION = ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE"];

/** The account's own home, read off the account, where a project's settings cannot move it. */
export function accountHome() {
  try {
    return userInfo().homedir;
  } catch {
    return "";
  }
}

/**
 * Where the user's own settings are, as far as a project cannot have moved them:
 * a CLAUDE_CONFIG_DIR the project did not set, the account home's where the
 * project moved the home, and the usual place otherwise.
 */
function userSettingsDir(env, moved, home) {
  const account = () => {
    const dir = home ?? accountHome();
    return dir ? join(dir, ".claude") : "";
  };
  if (moved.includes("CLAUDE_CONFIG_DIR")) return account();
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  return moved.includes("HOME") || moved.includes("USERPROFILE") ? account() : configDirFor(env);
}

/**
 * The settings `env` that decides the switch: the user's own where they name
 * one, nothing where a project names it or moved where they are read, and the
 * session's otherwise.
 */
export function switchEnv(env = process.env, { root = "", accountHome: home = null } = {}) {
  const moved = projectRedirects(root);
  const config = userSettingsDir(env, moved, home);
  const own = config ? settingsEnvIn(join(config, "settings.json")) : {};
  if (namesSwitch(own)) return own;
  // The session's value may be the project's, from its own settings or from settings it moved the session to.
  if (projectNamesSwitch(root) || moved.some((key) => SETTINGS_LOCATION.includes(key))) return {};
  return env;
}
