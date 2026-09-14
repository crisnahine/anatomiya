/**
 * The `claude` a held session's shell starts (A81).
 *
 * The session hook puts `shim/` first on the Bash tool's PATH, so a claude
 * started from there runs on the held model at the held level, whatever it was
 * given, with its hooks left on. A plugin's own `bin/` is appended after the
 * user's PATH and loses to the real claude, which is why the shim is not there.
 */
import { spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, existsSync, openSync, readSync, statSync } from "node:fs";
import { constants as os } from "node:os";
import { delimiter, join } from "node:path";

import { PLUGIN } from "./catalogue.mjs";
import { shown } from "./effort.mjs";
import { enabledPlugins } from "./hold-agents.mjs";
import { holdGaps, holdTarget, pluginEnabled } from "./hold-config.mjs";
import { gateReason } from "./hold-rules.mjs";
import { here, readIfFile } from "./hook-io.mjs";
import { isOff } from "./upstream.mjs";

/** What marks a file as a copy of this shim, which a lookup for the real claude skips. */
export const SHIM_MARKER = "ultracode-anywhere-shim";

/** How much of a file a lookup reads for the marker. The shim keeps it on its second line. */
export const SHIM_HEAD_BYTES = 256;

/** Subcommands that start no session, passed through with their own arguments. */
const PASS_THROUGH = new Set(["attach", "auth", "auto-mode", "doctor", "gateway", "install", "kill", "logs", "mcp", "plugin", "plugins", "project", "rm", "setup-token", "stop", "update", "upgrade", "-v", "--version", "-h", "--help"]);

/** Flags whose value the shim sets itself. */
const FORCED = new Set(["--model", "--effort", "--fallback-model"]);

/** Flags that start sessions through a background daemon a Bash command does not start. */
const DAEMON = new Set(["--bg", "--background", "agents", "respawn"]);

/** Variables that turn the hooks off the way `--bare` and `--safe-mode` do. */
const HOOKS_OFF = ["CLAUDE_CODE_SIMPLE", "CLAUDE_CODE_SAFE_MODE"];

/** Flags that define the agents a session runs, which nothing here can hold to a level. */
const AGENT_FLAGS = new Set(["--agents", "--agent"]);

/**
 * Settings keys a `--settings` value may not carry: `env` and the model and
 * effort keys decide what the child and its spawns run, the hook keys and
 * `enabledPlugins` decide whether this plugin's hooks run, and `agent` names
 * the session's own agent.
 */
const REFUSED_SETTINGS = ["env", "model", "availableModels", "effortLevel", "maxEffortLevel", "modelSettings", "hooks", "disableAllHooks", "allowManagedHooksOnly", "enabledPlugins", "agent"];

/** The launcher scripts a Windows install puts on PATH in place of a native claude.exe. */
const LAUNCHERS = ["claude.cmd", "claude.bat", "claude.ps1"];

/** Flags and subcommands that start or host a cloud session, where nothing here reaches its agents. `--remote` is `--cloud`'s old name. */
const CLOUD = new Set(["--cloud", "--remote", "--environment", "ultrareview", "self-hosted-runner"]);

/** Whether a path is a file this account may run. */
export function isRunnable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether a file carries the shim's marker near its top. */
export function isShim(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(SHIM_HEAD_BYTES);
    return head.subarray(0, readSync(fd, head, 0, SHIM_HEAD_BYTES, 0)).toString("latin1").includes(SHIM_MARKER);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The first claude on PATH that is a file and no copy of this shim, or null.
 *
 * Every copy is skipped, this one among them: two installs of the plugin each put
 * a shim on PATH, and two shims that skipped only themselves would start each
 * other for ever. On Windows only the native `claude.exe` is looked for, since
 * starting a batch file or a shell script safely needs a shell and a prompt is
 * not safe to hand one.
 */
export function realClaudeOn(env = process.env, platform = process.platform) {
  const names = platform === "win32" ? ["claude.exe"] : ["claude"];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const path = join(dir, name);
      if (isRunnable(path) && !isShim(path)) return path;
    }
  }
  return null;
}

function launcherOn(env) {
  for (const dir of String(env.PATH ?? env.Path ?? "").split(delimiter)) {
    const found = dir ? LAUNCHERS.map((name) => join(dir, name)).find((path) => existsSync(path)) : undefined;
    if (found) return found;
  }
  return null;
}

/** A `--flag=value` split into the flag and its value, or the argument and no value. */
function splitFlag(arg) {
  const at = arg.indexOf("=");
  return arg.startsWith("--") && at > 0 ? [arg.slice(0, at), arg.slice(at + 1)] : [arg, null];
}

/** How long a `--setting-sources` list may be and still be quoted back whole, which any list of the three sources is. */
const SOURCES_SHOWN_MOST = 32;

/** Why a `--setting-sources` value is refused: a list without `user` drops the settings that hold the hooks. */
function sourcesRefusal(value) {
  const sources = String(value ?? "").split(",").map((source) => source.trim());
  if (sources.includes("user")) return null;
  // shown() quotes one plain word, so a short list is quoted when each of its words would be.
  const plain = value !== null && value.length <= SOURCES_SHOWN_MOST && sources.every((source) => shown(source).startsWith('"'));
  const said = value === null ? "with no value" : plain ? `"${sources.join(",")}"` : shown(value);
  return `--setting-sources ${said} leaves out the user settings that hold the hooks`;
}

/**
 * A `--settings` value read once, as `{ settings }` or `{ refused }`. A value
 * opening with `{` is JSON, and any other is a file this has to be able to
 * read, since one it cannot read or parse is one it cannot check. The child is
 * handed what was read, so a file changed after the check changes nothing.
 */
function readSettingsFlag(value) {
  const text = String(value ?? "").trim();
  if (text === "") return { refused: "--settings with no value is not one this shim can check" };
  let body = text;
  if (!text.startsWith("{")) {
    // Opened once and asked through the handle, so the file checked is the file read.
    body = readIfFile(text);
    if (body === "") return { refused: `--settings ${shown(text)} could not be read as a settings file` };
  }
  let settings;
  try {
    settings = JSON.parse(body);
  } catch {
    return { refused: "--settings holds JSON this shim cannot read" };
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { refused: "--settings holds no settings object" };
  const named = REFUSED_SETTINGS.filter((key) => Object.hasOwn(settings, key));
  return named.length > 0 ? { refused: `--settings may not set ${named.join(" or ")} here` } : { settings };
}

function refuse(reason, target) {
  return {
    refuse: `claude: ${reason.replace(/\.$/, "")}. A claude started from a held session runs at ${target.level} effort on ${target.model} with its hooks on.`,
    status: 2,
  };
}

/**
 * The hold a claude started in `cwd` takes from the first directory that holds:
 * the session's project, whose settings made the environment it inherits, or its
 * own directory, whose settings it reads. The preload decides the same way.
 */
export function heldFrom(env = process.env, cwd = here()) {
  const roots = [...new Set([env.ULTRACODE_ANYWHERE_PROJECT_DIR, env.CLAUDE_PROJECT_DIR, cwd].filter(Boolean))];
  return { roots, target: roots.map((root) => holdTarget(env, { root })).find(Boolean) ?? null };
}

/**
 * What the shim does with one command line: the real claude to start, with its
 * arguments and environment, or a refusal and the status to exit with.
 */
export function shimPlan(args, env = process.env, cwd = here(), platform = process.platform) {
  const real = realClaudeOn(env, platform);
  if (!real) {
    const launcher = platform === "win32" ? launcherOn(env) : null;
    if (!launcher) return { refuse: "claude: not found on PATH", status: 127 };
    return { refuse: `claude: ${launcher} is a launcher script, and starting one takes a shell this shim will not hand a prompt to. Install Claude Code's native build, whose claude.exe it starts`, status: 126 };
  }
  const { roots, target } = heldFrom(env, cwd);
  if (!target) return { exec: { file: real, args, env } };

  // Handed as flag settings too, whose env a project's settings cannot outrank.
  const held = { ULTRACODE_ANYWHERE_HELD_CHILD: "1", CLAUDE_CODE_EFFORT_LEVEL: target.level, ANTHROPIC_MODEL: target.model };
  const child = { ...env, ...held };
  if (PASS_THROUGH.has(args[0])) return { exec: { file: real, args, env: child } };

  const kept = [];
  const handed = {};
  let sources = ["user", "project", "local"];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === "--") {
      kept.push(...args.slice(at));
      break;
    }
    const [flag, inline] = splitFlag(arg);
    if (FORCED.has(flag)) {
      if (inline === null) at++;
      continue;
    }
    if (arg === "--bare" || arg === "--safe-mode") return refuse(`${arg} turns off the hooks`, target);
    if (arg === "--restricted") return refuse("--restricted ignores the user settings that hold the hooks", target);
    if (DAEMON.has(arg)) return refuse(`${arg} starts sessions through a background daemon this shell does not start`, target);
    if (CLOUD.has(flag)) return refuse(`${flag} runs cloud sessions, where nothing here reaches their agents`, target);
    if (AGENT_FLAGS.has(flag)) return refuse(`${flag} defines agents this shim cannot hold to a level`, target);
    if (flag === "--settings") {
      const read = readSettingsFlag(inline ?? args[at + 1] ?? null);
      if (read.refused) return refuse(read.refused, target);
      Object.assign(handed, read.settings);
      if (inline === null) at++;
      continue;
    }
    if (flag === "--setting-sources") {
      const value = inline ?? args[at + 1] ?? null;
      const refused = sourcesRefusal(value);
      if (refused) return refuse(refused, target);
      sources = String(value).split(",").map((source) => source.trim());
      kept.push(arg);
      if (inline === null) kept.push(args[++at]);
      continue;
    }
    kept.push(arg);
  }

  for (const name of HOOKS_OFF) {
    const value = String(env[name] ?? "").trim();
    if (value !== "" && !isOff(value)) return refuse(`${name} turns off the hooks`, target);
  }
  // Read the way the build reads them: project settings in cwd, local settings at the git root above it as well.
  if (!pluginEnabled(enabledPlugins(env, cwd, sources), PLUGIN)) {
    return refuse(`the configuration this claude reads does not enable ${PLUGIN}, so nothing would hold its spawns`, target);
  }
  const required = [...new Set(roots.flatMap((root) => holdGaps(env, { root }).required))];
  if (required.length > 0) return refuse(`this configuration cannot hold spawns: ${required.join("; ")}`, target);
  const leak = gateReason(env);
  if (leak) return refuse(leak, target);
  return { exec: { file: real, args: ["--model", target.model, "--effort", target.level, "--settings", JSON.stringify({ ...handed, env: held }), ...kept], env: child } };
}

/** Carries out the plan for one command line, answering the exit status the shell should see. */
export function runShim(args, env = process.env, cwd = here()) {
  const plan = shimPlan(args, env, cwd);
  if (plan.refuse) {
    process.stderr.write(`${plan.refuse}\n`);
    return plan.status;
  }
  // The claude being started reads the terminal's interrupt itself, so this process outlives one.
  if (process.platform !== "win32") for (const signal of ["SIGINT", "SIGQUIT"]) process.on(signal, () => {});
  const run = spawnSync(plan.exec.file, plan.exec.args, { stdio: "inherit", env: plan.exec.env });
  if (run.error) {
    process.stderr.write(`claude: ${plan.exec.file} could not be started: ${run.error.message}\n`);
    return 126;
  }
  if (run.signal) return 128 + (os.signals[run.signal] ?? 0);
  return run.status ?? 1;
}
