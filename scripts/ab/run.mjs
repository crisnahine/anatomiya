// scripts/ab/run.mjs
/**
 * One headless trial in one arm.
 *
 * Every setting is fixed and stated rather than inherited, because the two arms
 * differ in exactly one thing and anything that varies between them is a second
 * variable nobody controlled. The tool list is the same four the first run used:
 * an agent that can run bash can `cat` a rule file, and reading one that way is
 * how the map reaches an arm that was supposed to have none.
 */
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const CLAUDE_DEFAULTS = {
  model: "claude-opus-5",
  maxTurns: 12,
  tools: ["Read", "Write", "Glob", "Grep"],
  timeoutMs: 10 * 60 * 1000,
  maxBytes: 4 * 1024 * 1024,
};

export function runTrial(arm, prompt, options = {}) {
  const o = { ...CLAUDE_DEFAULTS, ...options };
  const before = snapshot(arm);

  return new Promise((resolve) => {
    const args = [
      "-p", prompt,
      "--model", o.model,
      "--max-turns", String(o.maxTurns),
      "--allowedTools", o.tools.join(","),
    ];
    execFile(
      "claude",
      args,
      { cwd: arm, timeout: o.timeoutMs, maxBuffer: o.maxBytes, env: { ...process.env, CI: "1" } },
      (err, stdout) => {
        if (err && err.code === "ENOENT") {
          return resolve({ ok: false, wrote: [], stdout: "", reason: "the claude CLI is not on PATH" });
        }
        // A trial that hit the turn cap wrote nothing and is not a failure of
        // the arm: it is dropped from both arms' denominators and counted.
        const wrote = added(arm, before);
        resolve({ ok: !err, wrote, stdout: String(stdout ?? ""), reason: err ? String(err.message) : null });
      }
    );
  });
}

function snapshot(dir) {
  const seen = new Map();
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      if (name === ".git" || name === "node_modules") continue;
      const abs = join(at, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else seen.set(abs, st.mtimeMs);
    }
  };
  walk(dir);
  return seen;
}

function added(dir, before) {
  const out = [];
  for (const [abs, mtime] of snapshot(dir)) {
    if (before.has(abs) && before.get(abs) === mtime) continue;
    out.push({ rel: relative(dir, abs), source: readFileSync(abs, "utf8") });
  }
  return out;
}
