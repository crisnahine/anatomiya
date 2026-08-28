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

import { ENGINE, engineEnv, engineFor } from "./engine.mjs";

export const CLAUDE_DEFAULTS = {
  model: ENGINE.model,
  effort: ENGINE.effort,
  maxTurns: 12,
  tools: ["Read", "Write", "Glob", "Grep"],
  timeoutMs: 10 * 60 * 1000,
  maxBytes: 4 * 1024 * 1024,
};

/**
 * One trial, at the stated engine, in an environment that cannot move it.
 *
 * The answer comes back as JSON so `ran` can say which engine served it. A
 * trial is still counted on the files it left behind, so an answer this cannot
 * read costs the reading rather than the trial.
 */
export function runTrial(arm, prompt, options = {}) {
  const o = { ...CLAUDE_DEFAULTS, ...options };
  const engine = engineFor(o);
  if (engine.error) return Promise.resolve({ ok: false, wrote: [], stdout: "", ran: null, reason: engine.error });
  const before = snapshot(arm);

  return new Promise((resolve) => {
    const args = [
      "-p", prompt,
      "--model", engine.model,
      "--effort", engine.effort,
      "--max-turns", String(o.maxTurns),
      "--allowedTools", o.tools.join(","),
      // Asked for so the answer says which engine actually served it. The flags
      // above are a request; `modelUsage` is what the run reports back.
      "--output-format", "json",
    ];
    execFile(
      "claude",
      args,
      {
        cwd: arm,
        timeout: o.timeoutMs,
        maxBuffer: o.maxBytes,
        env: { ...engineEnv(o.env ?? process.env), CI: "1" },
      },
      (err, stdout) => {
        if (err && err.code === "ENOENT") {
          return resolve({ ok: false, wrote: [], stdout: "", ran: null, reason: "the claude CLI is not on PATH" });
        }
        // A trial that hit the turn cap wrote nothing and is not a failure of
        // the arm: it is dropped from both arms' denominators and counted.
        const wrote = added(arm, before);
        const said = answerIn(String(stdout ?? ""), engine.model);
        resolve({ ok: !err, wrote, stdout: said.text, ran: said.ran, reason: err ? String(err.message) : null });
      }
    );
  });
}

/**
 * The answer text and the engine that produced it.
 *
 * A run names more than one model, since a trial spends a small one on its own
 * housekeeping, and the asked-for one is looked up by name rather than picked
 * out by size: a housekeeping model with a wider window would win a guess. A
 * run that used something else reports whichever model did the most work, so
 * the substitution reaches the record instead of reading as unknown. An answer
 * this cannot read costs the reading and not the trial, since what a trial is
 * counted on is the files it left behind.
 */
function answerIn(stdout, askedModel) {
  let said;
  try {
    said = JSON.parse(stdout);
  } catch {
    return { text: stdout, ran: null };
  }
  const text = typeof said?.result === "string" ? said.result : stdout;
  const used = Object.entries(said?.modelUsage ?? {});
  if (!used.length) return { text, ran: null };
  const busiest = (a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0);
  const [model, usage] = used.find(([m]) => m === askedModel) ?? [...used].sort(busiest)[0];
  return { text, ran: { model, contextWindow: usage?.contextWindow ?? null } };
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
