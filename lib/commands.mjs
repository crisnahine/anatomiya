import { execFile } from "node:child_process";

import { scan } from "./scan.mjs";
import { loadTypeScript, notInstalledMessage } from "./semantic.mjs";
import { writeMap } from "./write.mjs";
import { check } from "./check.mjs";
import { collect, gitRoot } from "./corpus.mjs";
import { discover } from "./areas.mjs";
import { buildPin, loadPin, writePin, pinDelta, PIN_PATH } from "./baseline.mjs";
import { headSha } from "./git.mjs";
import { ENGINES } from "./langs.mjs";
import { PROBE_IDS, pluginRoot, probeName, readiness, readinessLines, remedyFor } from "./readiness.mjs";
import { pinSummary, scanSummary } from "./summary.mjs";

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
  return { result, plan, summary: scanSummary(result, plan, { dryRun }) };
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
 * Install what the node-hosted engine needs, in this plugin's own directory.
 *
 * A command of its own, and the one thing here that reaches the network. A scan
 * that installed its own dependencies on finding them missing would make every
 * run an outbound call, so `scan`, `check` and `pin` refuse instead and this is
 * what a person runs about it (F5).
 */
export async function runSetup({ dryRun = false } = {}) {
  const root = pluginRoot();
  const rows = await readiness({ engines: INSTALLABLE });
  const needed = rows.filter((r) => !r.present).map(probeName);
  const where = `${INSTALL.join(" ")} in ${root}`;
  const state =
    needed.length === 0
      ? `nothing to install: ${rows.map((r) => `${probeName(r)} ${r.version ?? "no version"}`).join(", ")}`
      : `not installed: ${needed.join(", ")}`;

  if (dryRun) return answer(root, needed, { output: `${state}\nwould run ${where}` });
  if (needed.length === 0) return answer(root, needed, { output: state });

  const { err, stdout, stderr } = await npmInstall(root);
  if (err && err.code === "ENOENT") {
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

// Which engines an install can do anything about, read off the table rather
// than listed again: npm installs a node-hosted engine, and an interpreter is
// the machine's own.
const INSTALLABLE = Object.values(ENGINES).filter((e) => e.host === "node").map((e) => e.id);

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
 * The one subprocess this tool runs that reaches the network.
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
