// scripts/ab/run.mjs
/**
 * One headless trial in one arm.
 *
 * Every setting is fixed and stated rather than inherited, because the two arms
 * differ in exactly one thing and anything that varies between them is a second
 * variable nobody controlled. By default the tool list is the same four the
 * first run used, since in `scripts/ab.mjs` both arms load the plugin and a
 * shell could `cat` a rule file into the arm meant to have none; the scenario
 * run passes the tools a coding session has and runs its second arm with no
 * plugin at all. `--tools` is what takes the others away; `--allowedTools` only
 * approves, and left alone it let Bash run.
 *
 * Nothing comes from the operator's own `~/.claude`: their CLAUDE.md, plugins
 * and MCP servers made two machines run two experiments. The project source
 * stays, since the map is read through it, and the plugin under measurement is
 * loaded from this repository unless a caller passes `pluginDir: null`.
 */
import { execFile, execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { ENGINE, engineEnv, engineFor } from "./engine.mjs";
import { ANATOMIYA } from "../plugins.mjs";

export const CLAUDE_DEFAULTS = {
  model: ENGINE.model,
  effort: ENGINE.effort,
  maxTurns: 12,
  tools: ["Read", "Write", "Glob", "Grep"],
  settingSources: "project,local",
  pluginDir: ANATOMIYA,
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
  const started = Date.now();

  return new Promise((resolve) => {
    const args = [
      "-p", prompt,
      "--model", engine.model,
      "--effort", engine.effort,
      "--max-turns", String(o.maxTurns),
      "--tools", o.tools.join(","),
      "--allowedTools", o.tools.join(","),
      "--strict-mcp-config",
      "--setting-sources", o.settingSources,
      // Null is the arm that runs without the plugin at all, hooks included.
      ...(o.pluginDir === null ? [] : ["--plugin-dir", o.pluginDir]),
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
      (err, stdout, stderr) => {
        if (err && err.code === "ENOENT") {
          return resolve({ ok: false, wrote: [], stdout: "", ran: null, reason: "the claude CLI is not on PATH" });
        }
        // A trial that hit the turn cap exits 1 with its files already written,
        // so they are kept and scored; `ok` only says it ended early.
        const wrote = added(arm, before);
        const said = answerIn(String(stdout ?? ""), engine.model);
        const reason = err ? endedBy(err, said.subtype, String(stderr ?? "")) : wrote.length ? null : `answered ${firstLine(said.text)}`;
        resolve({ ok: !err, wrote, stdout: said.text, ran: said.ran, spent: { ...said.spent, wallMs: Date.now() - started }, reason });
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
    return { text: stdout, ran: null, spent: null, subtype: null };
  }
  const text = typeof said?.result === "string" ? said.result : stdout;
  const spent = spentIn(said);
  const subtype = typeof said?.subtype === "string" ? said.subtype : null;
  const used = Object.entries(said?.modelUsage ?? {});
  if (!used.length) return { text, ran: null, spent, subtype };
  const busiest = (a, b) => (b[1]?.outputTokens ?? 0) - (a[1]?.outputTokens ?? 0);
  const [model, usage] = used.find(([m]) => m === askedModel) ?? [...used].sort(busiest)[0];
  return { text, ran: { model, contextWindow: usage?.contextWindow ?? null }, spent, subtype };
}

/**
 * Why a trial ended early, in one line that carries no command line: Node's own
 * message is "Command failed:" and the whole argv, the prompt and this
 * machine's plugin path among it, and a reason reaches a committed record.
 */
function endedBy(err, subtype, stderr) {
  if (err.killed) return `ended by ${err.signal ?? "a signal"}, past the trial's clock`;
  const why = subtype ?? stderr.trim().split("\n")[0]?.trim().slice(0, 200);
  return `exited ${err.code ?? "early"}${why ? `: ${why}` : ""}`;
}

/**
 * What the trial cost as the CLI reported it, summed over every model the run
 * used, its subagents and the plugin's hooks included. A field the answer does
 * not carry is null, never zero, so a missing report cannot pass for a free trial.
 * Not `duration_ms` or `num_turns`: measured on 2.1.310, both cover only the
 * stretch after the last background notification, so the clock is the harness's.
 */
function spentIn(said) {
  const number = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const usage = Object.values(said?.modelUsage ?? {});
  const tokens = (field) => (usage.length ? usage.reduce((sum, u) => sum + (number(u?.[field]) ?? 0), 0) : null);
  return {
    costUsd: number(said?.total_cost_usd),
    inputTokens: tokens("inputTokens"),
    outputTokens: tokens("outputTokens"),
    cacheReadTokens: tokens("cacheReadInputTokens"),
  };
}

/** Encoded, so an answer cannot break the log line it is quoted on. */
function firstLine(text) {
  return JSON.stringify((text.trim().split("\n")[0] ?? "").trim().slice(0, 200));
}

/**
 * Every regular file under `dir` and its mtime. A link is not followed: one to
 * a page nobody built made the whole run throw, and a trial's work is the files
 * it wrote, not what a link happens to point at.
 */
function snapshot(dir) {
  const seen = new Map();
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      if (name === ".git" || name === "node_modules") continue;
      const abs = join(at, name);
      const st = lstatSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) seen.set(abs, st.mtimeMs);
    }
  };
  walk(dir);
  return seen;
}

/**
 * What the trial changed, as git would show it: a file git ignores is a cache
 * or a log the trial's tools left, not its work. Measured on a Rails clone, a
 * trial that booted the app left 4,360 ignored files beside the two it wrote.
 */
function added(dir, before) {
  const changed = [];
  for (const [abs, mtime] of snapshot(dir)) {
    if (!(before.has(abs) && before.get(abs) === mtime)) changed.push(relative(dir, abs));
  }
  const ignored = ignoredIn(dir, changed);
  return changed.filter((rel) => !ignored.has(rel)).map((rel) => ({ rel, source: readFileSync(join(dir, rel), "utf8") }));
}

/** The paths git ignores in `dir`, or none where `dir` is no repository. */
function ignoredIn(dir, rels) {
  if (!rels.length) return new Set();
  const listed = (out) => new Set(String(out ?? "").split("\0").filter(Boolean));
  try {
    return listed(execFileSync("git", ["check-ignore", "--stdin", "-z"], { cwd: dir, input: rels.join("\0"), stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    // Exit 1 is "none of them is ignored", and outside a repository git names none either.
    return listed(err.stdout);
  }
}
