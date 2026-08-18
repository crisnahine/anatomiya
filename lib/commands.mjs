import { scan } from "./scan.mjs";
import { loadTypeScript, notInstalledMessage } from "./semantic.mjs";
import { writeMap } from "./write.mjs";
import { check } from "./check.mjs";
import { collect, gitRoot } from "./corpus.mjs";
import { discover } from "./areas.mjs";
import { buildPin, loadPin, writePin, pinDelta, PIN_PATH } from "./baseline.mjs";
import { headSha } from "./git.mjs";
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
  if (deep && (await loadTypeScript()) === null) throw new Error(notInstalledMessage());

  const result = await scan(cwd, { deep });
  if (result.parse.missingParser) throw notInstalled(result.parse.missingParser, "scan");

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
  if (report.parse.missingParser) throw notInstalled(report.parse.missingParser, "check");
  return { report };
}

/**
 * `/plugin install` does not run `npm install`, so this is the first thing a new
 * user hits. Both commands used to answer it as a repository with nothing in it:
 * the scan wrote an empty map and exited 0, the check reported no findings.
 */
function notInstalled(message, command) {
  return new Error(`${message}\nrun \`npm install --omit=dev\` in the plugin directory, then ${command} again`);
}
