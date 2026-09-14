/**
 * What the spawn hold's cases build on: a throwaway home with a Claude Code
 * configuration, one enabled plugin, a project, and the environment that points
 * at them and at nothing of the machine running the case.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { checksDir } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";

/** A file with its directories made, answering its own path. */
export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A git repository with a directory below its root, where a session can start short of the root. */
export function repoWithSub(t) {
  // Real, as a session directory is, since the build compares it with the real home.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "ultracode-repo-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, ".git"));
  mkdirSync(join(repo, "sub", ".claude"), { recursive: true });
  return { repo, sub: join(repo, "sub") };
}

/** An agent or skill file whose frontmatter holds `fields`. */
export function agentText(fields, body = "body") {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n${body}\n`;
}

/**
 * A home holding a configuration with the plugin `kit` installed and enabled, a
 * project two levels under the home, and a transcript path for a session.
 *
 * The environment turns the hold on at `level` with every required setting in
 * place, so a case that wants a gap takes one away.
 */
export function world(t, { level = "medium" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ultracode-hold-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const cfg = join(home, ".claude");
  const plugin = join(root, "plugin");
  const project = join(home, "work", "project");
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "ultracode-anywhere@m": true } }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "kit@m": [{ installPath: plugin, version: "1.0.0" }] } }));
  mkdirSync(join(project, ".claude"), { recursive: true });
  // Made the way the plugin makes it, for this account alone, which the counters and the lock insist on.
  mkdirSync(join(root, "state"), { mode: 0o700 });
  const env = {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: cfg,
    ULTRACODE_ANYWHERE_STATE: join(root, "state"),
    ULTRACODE_ANYWHERE_SPAWN_EFFORT: level,
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-5[1m]",
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
    CLAUDE_CODE_FORK_SUBAGENT: "0",
  };
  return { root, home, cfg, plugin, project, env, transcript: join(root, "session.jsonl") };
}

/** A log in a directory the self-check made inside the hold's state, which is what a hook believes a probe by. */
export function probeLog(env) {
  mkdirSync(checksDir(env), { recursive: true, mode: 0o700 });
  return write(join(mkdtempSync(join(checksDir(env), "ultracode-hold-check-")), "tripwire.log"), "");
}

/**
 * Runs a workflow script the way the runtime does: `meta` as a plain constant,
 * the rest as an async strict body, with writable `agent` and `workflow`
 * globals. A nested workflow runs its file the same way.
 */
export async function runStages(script, calls = [], nested = []) {
  const context = vm.createContext({});
  Object.defineProperty(context, "agent", { value: (_prompt, opts) => { calls.push(opts); return "ok"; }, writable: true, configurable: true });
  Object.defineProperty(context, "workflow", {
    value: async (ref) => {
      nested.push(ref);
      return runStages(readFileSync(ref.scriptPath, "utf8"), calls, nested);
    },
    writable: true,
    configurable: true,
  });
  await vm.runInContext(`(async () => {'use strict'; ${script.replace(/^export const meta/m, "const meta")} })()`, context);
  return calls;
}
