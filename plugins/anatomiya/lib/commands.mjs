import { execFile } from "node:child_process";
import { join } from "node:path";

import { absentInterpreter } from "./child.mjs";
import { scan } from "./scan.mjs";
import { loadTypeScript, notInstalledMessage } from "./semantic.mjs";
import { writeMap } from "./write.mjs";
import { check } from "./check.mjs";
import { collect, gitRoot } from "./corpus.mjs";
import { discover } from "./areas.mjs";
import { buildPin, loadPin, writePin, pinDelta, PIN_PATH } from "./baseline.mjs";
import { headSha } from "./git.mjs";
import { NODE_PROBE_IDS, PROBE_IDS, pluginRoot, probeName, readiness, readinessLines, remedyFor } from "./readiness.mjs";
import { pinSummary, scanSummary } from "./summary.mjs";
import { aboutDir, echoContext, holdsTestIn, isPathTaken, ownLayout, removeStaleHook, targetIn } from "./hook.mjs";
import { isTestPath, noticeFor } from "./precedent.mjs";

/**
 * One entry per command: the whole recipe, composed once.
 *
 * The CLI used to compose these itself, which put the only copy of "what a pin
 * does" inside an argv parser. Everything here answers with objects and prints
 * nothing, so a caller that is not a terminal gets the same answer.
 */

/** Scan the repository the path is in, and write the map unless this is a dry run. */
export async function runScan(cwd, { dryRun = false, deep = false } = {}) {
  // Refused before any work, not after the parse: --deep with no checker
  // installed is an install problem, and a scan that runs for a minute and then
  // says so has already spent the time (B13's shape).
  if (deep && (await loadTypeScript()) === null) throw new Error(notInstalledMessage(remedyFor("typescript")));

  const result = await scan(cwd, { deep });
  if (result.parse.missingParser) throw notInstalled(result.parse, "scan");

  const plan = writeMap(result, { dryRun });
  // 0.2.4 through 0.2.6 installed the re-delivery hook into the repository's own
  // settings, where `${CLAUDE_PLUGIN_ROOT}` is never substituted and Claude Code
  // refuses the hook by name on every prompt and every tool call. The plugin
  // declares it now, so what is left here is taking the broken one out. It
  // answers with a refusal rather than throwing one; the reasons are in
  // `removeStaleHook`.
  const hook = removeStaleHook(result.root, { dryRun });
  return { result, plan, hook, summary: scanSummary(result, plan, { dryRun, hook }) };
}

/**
 * What a hook re-delivers: the map, stamped, as `additionalContext`.
 *
 * Every failure is silent and exits 0 by the caller's hand: a hook that errors
 * interrupts the run it was meant to help, and there is no answer here worth
 * that. An absent map, an unreadable payload and an event this cannot name all
 * answer with the same empty object.
 */
export function runEcho(cwd, payload) {
  const event = payload?.hook_event_name;
  if (!event) return {};
  // The call's own repository first, then the session's. Reading something
  // outside the repository is ordinary, a system file or another project's, and
  // answering nothing there takes the map off a turn that had one before.
  const additionalContext = echoContext(aboutDir(payload, cwd)) ?? echoContext(cwd);
  if (additionalContext === null) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/**
 * What a write is told about where it is going, or nothing at all (A44).
 *
 * It informs and never refuses. `deny` and `ask` are the only answers that stop
 * a path being chosen, and this rule rests on a namesake match that can read a
 * tested directory as untested, so refusing on it would stall real work over a
 * count that was wrong. The same reason the rest of this file exits 0 whatever
 * happens (A24).
 */
export function runNotice(cwd, payload) {
  const event = payload?.hook_event_name;
  if (!event) return {};
  // No falling back to the session's layout, unlike the map above: a target
  // outside the repository that answered is outside this one too, so `targetIn`
  // refuses it a line later and both roads end in silence.
  const found = ownLayout(aboutDir(payload, cwd) ?? cwd);
  if (found === null) return {};
  const rel = targetIn(payload, found.root, cwd);
  if (rel === null) return {};
  // Only a path nothing is at yet. Where a file exists the path was chosen some
  // turns ago, and an `Edit` names one every time: saying it again on each edit
  // of the same spec is the block on every result this exists instead of.
  if (isPathTaken(join(found.root, rel))) return {};
  // No exclusion to make, unlike `check`, which subtracts everything its change
  // brought: the guard above has already answered for a path something is at,
  // so anything this finds in that directory is another file.
  const holdsTest = holdsTestIn(found.root, isTestPath);
  const additionalContext = noticeFor(rel, found.layout, { holdsTest });
  if (additionalContext === null) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/**
 * Accept the current population as the baseline (E5).
 *
 * A separate command, and it answers with the delta and no recommendation: the
 * moment a re-pin looks most warranted is the moment the agent's own output is
 * largest, and a suggestion there launders it.
 */
export async function runPin(cwd, { dryRun = false } = {}) {
  const root = await gitRoot(cwd);
  const sha = await headSha(root);
  if (!sha) throw new Error("no commit to pin: this repository has no HEAD");

  const { files, truncated } = await collect(root);
  // No repository size truncates the corpus any more, so this cannot fire from
  // `collect`. It stays because a pin must describe a whole population, and the
  // flag is the one thing that says whether this one is.
  if (truncated) throw new Error("only part of the corpus was read, so this would pin a partial population");

  const next = buildPin(discover(files), { sha, corpus: files.length });
  const previous = loadPin(root);
  const delta = pinDelta(previous, next);
  if (!dryRun) writePin(root, next);

  return { summary: pinSummary({ previous, next, delta, path: PIN_PATH, dryRun }), pin: next, previous, delta };
}

/** Answer the branch against the map on disk. */
export async function runCheck(cwd, { baseRef = null } = {}) {
  const report = await check(cwd, { baseRef });
  if (report.parse.missingParser) throw notInstalled(report.parse, "check");
  return { report };
}

/** Whether every engine this parses with is installed, and what to do about each that is not. */
export async function runDoctor() {
  const rows = await readiness({ engines: PROBE_IDS });
  return { rows, lines: readinessLines(rows) };
}

/**
 * Install what one npm install in this plugin's own directory provides: the
 * node-hosted engine, its extras, and the optional checker beside them.
 *
 * A command of its own, and the only one that installs anything or reaches a
 * package registry. A scan that installed its own dependencies on finding them
 * missing would make every run an outbound call, so `scan`, `check` and `pin`
 * refuse instead and this is what a person runs about it (F5).
 *
 * `platform` is a test seam with one real use: the Windows refusal below is a
 * refusal about the platform, and it can only be proved on one of them.
 */
export async function runSetup({ dryRun = false, platform = process.platform } = {}) {
  const root = pluginRoot();
  const rows = await readiness({ engines: NODE_PROBE_IDS });
  const needed = rows.filter((r) => !r.present).map(probeName);
  const where = `${INSTALL.join(" ")} in ${root}`;
  const state =
    needed.length === 0
      ? `nothing to install: ${rows.map((r) => `${probeName(r)} ${r.version ?? "no version"}`).join(", ")}`
      : `not installed: ${needed.join(", ")}`;

  if (dryRun) return answer(root, needed, { output: `${state}\nwould run ${where}` });
  if (needed.length === 0) return answer(root, needed, { output: state });

  // npm ships as `npm.cmd` on Windows, and a spawn resolves an extension-less
  // name against `.com` and `.exe` only, so the attempt answers ENOENT on a
  // machine that has npm installed and on PATH. Running the batch file needs a
  // shell, which no subprocess here may use, so this hands the command over
  // rather than telling a Windows user to install what they already have.
  if (platform === "win32") {
    return answer(root, needed, {
      ok: false,
      output: `npm on Windows is a batch file, and running one needs a shell no command here may spawn\nrun it yourself: ${where}`,
    });
  }

  const { err, stdout, stderr } = await npmInstall(root);
  if (absentInterpreter(err)) {
    // npm cannot install itself, and neither can this. The same trap the Ruby
    // remedy closed: name the thing that is actually missing.
    return answer(root, needed, { ok: false, output: "npm was not found; install Node.js 22 with npm, then run setup again" });
  }
  // A child our own timer killed is not an install that ran and failed, and a
  // spawn that never started says nothing at all, so its own error stands in.
  const how = err ? `${where} ${err.killed ? `did not finish within ${INSTALL_TIMEOUT_MS / 60_000} minutes` : "failed"}` : `ran ${where}`;
  const said = err ? stderr || stdout || err.message : stdout;
  return answer(root, needed, { ran: true, ok: !err, output: [state, how, tail(said)].filter(Boolean).join("\n") });
}

/**
 * The install, spelled once and both printed and run from here.
 *
 * `--ignore-scripts` is the load-bearing flag: without it a dependency's
 * install script runs arbitrary code in the plugin directory.
 */
const INSTALL = Object.freeze(["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);

// A cold install of a native parser on a slow link is minutes, so this is a
// bound on a hang rather than on a slow network.
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** One shape whichever way a setup came out, so a caller reads the same fields every time. */
const answer = (root, needed, { ran = false, ok = true, output }) => ({
  pluginRoot: root,
  needed,
  ran,
  command: [...INSTALL],
  ok,
  output,
});

// What npm said, bounded: the buffer cap is 8 MB and a terminal is not.
const tail = (text, lines = 20) => text.trim().split("\n").slice(-lines).join("\n");

/**
 * The only subprocess this tool runs against a package registry.
 *
 * `cwd` is the plugin's own directory and never the repository being scanned:
 * every command runs inside somebody else's tree, and installing there would
 * leave this tool's dependencies in it. The environment is inherited, because
 * npm's registry, proxy and credential configuration lives there.
 */
function npmInstall(cwd) {
  return new Promise((resolve) => {
    execFile(
      INSTALL[0],
      INSTALL.slice(1),
      { cwd, env: process.env, encoding: "utf8", timeout: INSTALL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    );
  });
}

/**
 * `/plugin install` does not run `npm install`, so this is the first thing a new
 * user hits. Both commands used to answer it as a repository with nothing in it:
 * the scan wrote an empty map and exited 0, the check reported no findings.
 *
 * The remedy is the missing engine's own. One sentence used to be appended to
 * whatever the parse said, so a machine with no `ruby` on it was told to run
 * npm, which is the one thing that cannot install an interpreter.
 */
function notInstalled(parse, command) {
  return new Error(`${parse.missingParser}\n${remedyFor(parse.missingEngines[0])}, then ${command} again`);
}
