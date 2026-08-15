#!/usr/bin/env node
import { scan } from "../lib/scan.mjs";
import { writeMap } from "../lib/write.mjs";
import { check, formatReport } from "../lib/check.mjs";
import { unexaminedLines } from "../lib/render.mjs";
import { statedSide } from "../lib/facts.mjs";
import { collect, gitRoot } from "../lib/corpus.mjs";
import { discover } from "../lib/areas.mjs";
import { buildPin, loadPin, writePin, pinDelta, formatDelta, PIN_PATH } from "../lib/baseline.mjs";
import { headSha } from "../lib/git.mjs";

const USAGE = [
  "usage: anatomiya scan  [path] [--dry-run]",
  "       anatomiya check [path] [--base <ref>]",
  "       anatomiya pin   [path] [--dry-run]",
  "",
  "[path] picks the repository, not a subtree: every command covers the whole",
  "repository the path is in, and scan prints the root it resolved to.",
].join("\n");

const COMMANDS = new Set(["scan", "check", "pin"]);

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

/**
 * Anything starting with `-` is a flag, never a path. A tracked file may be
 * named `--instruction-file-path=.git/config`, and taking it as the positional
 * argument would hand it straight to a subprocess.
 */
function parseArgs(argv) {
  const cmd = COMMANDS.has(argv[0]) ? argv.shift() : "scan";
  const opts = { cmd, path: null, dryRun: false, baseRef: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { ...opts, help: true };
    if (arg === "--dry-run") {
      if (cmd === "check") fail(`--dry-run is not a ${cmd} option\n${USAGE}`);
      opts.dryRun = true;
      continue;
    }
    if (arg === "--base" || arg.startsWith("--base=")) {
      if (cmd !== "check") fail(`--base is not a ${cmd} option\n${USAGE}`);
      const value = arg === "--base" ? argv[++i] : arg.slice("--base=".length);
      if (!value || value.startsWith("-")) fail(`--base needs a ref\n${USAGE}`);
      opts.baseRef = value;
      continue;
    }
    if (arg.startsWith("-")) fail(`unknown option: ${arg}\n${USAGE}`);
    if (opts.path !== null) fail(`only one path may be given\n${USAGE}`);
    opts.path = arg;
  }

  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}
const cwd = opts.path === null ? process.cwd() : opts.path;

try {
  if (opts.cmd === "check") await runCheck(cwd, opts);
  else if (opts.cmd === "pin") await runPin(cwd, opts);
  else await runScan(cwd, opts);
} catch (err) {
  // A missing repository, an unreadable tree or a git that will not run are all
  // ordinary conditions here, and a stack trace is not what the caller needs.
  console.error(`anatomiya: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
}

async function runScan(cwd, { dryRun }) {
  const result = await scan(cwd);

  if (result.parse.missingParser) throw notInstalled(result.parse.missingParser, "scan");

  const plan = writeMap(result, { dryRun });

  const slots = result.areas.flatMap((a) => a.dimensions);
  // Through the renderer's own side selection, or the line undercounts every
  // area that was handed the inverse and the summary disagrees with the map.
  const stated = slots.filter((d) => statedSide(d).states !== null);
  const unwritten = plan.unattributed.length + plan.foreign.length;

  // The root, because a path argument does not scope the scan: `git rev-parse
  // --show-toplevel` resolves any path inside the repository to its root, so
  // `scan ./packages/api` in a monorepo maps the monorepo. Areas, the pin and
  // the baseline are all repository-anchored, so that is the behaviour they
  // need and the line is what says so.
  console.log(`${result.corpus.files} files, ${result.areas.length} areas, ${result.durationMs}ms, root ${result.root}`);
  if (result.corpus.untracked)
    console.log(
      `${result.corpus.untracked} source files are untracked and were not counted: the corpus is tracked files only`
    );
  console.log(`${stated.length} of ${slots.length} claims stated, the rest print as counts`);
  console.log(baselineLine(result.baseline));
  if (result.corpus.truncated)
    console.log("only part of the corpus was read, so every directive is suppressed and only counts print");
  // The two causes named apart, the way the overview names them. One folded
  // number printed beside "N files crashed the parser" invited exactly the
  // reading the overview line was fixed to stop.
  const barren = plan.uncovered - plan.orphaned;
  if (plan.orphaned > 0) console.log(`${plan.orphaned} files in no area: too few per directory`);
  if (barren > 0) console.log(`${barren} files in a directory nothing was counted in`);
  for (const line of unexaminedLines(result.parse)) console.log(line);
  if (result.authors.error)
    console.log(`history could not be read, so every claim fails the author gate: ${result.authors.error}`);
  if (unwritten) console.log(`${unwritten} file(s) in .claude/rules/ not written by this tool`);
  if (plan.remove.length)
    console.log(`${plan.remove.length} area file(s) removed: their area is gone or states nothing`);
  // Nothing was written, and the reason is not "this repository has nothing in
  // it". Said before the count, because the count is 0 and reads as the first.
  if (plan.unreadable.length) {
    console.log(
      `read no ${plan.unreadable.join(" or ")} file at all, so nothing was written and the previous map was left alone`
    );
    console.log("this is usually a missing interpreter rather than a repository that changed");
    return;
  }
  console.log(dryRun ? `would write ${plan.write.length} files` : `wrote ${plan.write.length} files`);
  // Measured: a rewritten context file does not re-attach mid-session.
  if (!dryRun) console.log("a session already running still holds the old map; restart to pick it up");
}

/**
 * Which population the gates read. An unpinned repository states claims off the
 * current tree, which is the weaker guarantee, so it says so rather than
 * reading like a scan measured against an accepted baseline.
 */
function baselineLine(b) {
  if (b.status === "unreachable")
    return `the pinned commit ${b.sha ? b.sha.slice(0, 8) : "?"} is gone from this clone, so every claim dropped to counts`;
  if (b.countsOnly)
    return "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. `anatomiya pin` accepts one";
  const drift = b.drift === null ? "" : `, ${b.drift} files changed since ${b.baseRef ? b.baseRef.ref : "the base"}`;
  return `baseline ${b.sha.slice(0, 8)}${drift}`;
}

/**
 * Accept the current population as the baseline (E5).
 *
 * A separate command, and it prints the delta and no recommendation: the moment
 * a re-pin looks most warranted is the moment the agent's own output is largest,
 * and a suggestion there launders it.
 */
async function runPin(cwd, { dryRun }) {
  const root = await gitRoot(cwd);
  const sha = await headSha(root);
  if (!sha) throw new Error("no commit to pin: this repository has no HEAD");

  const { files, truncated } = await collect(root);
  // No repository size truncates the corpus any more, so this cannot fire from
  // `collect`. It stays because a pin must describe a whole population, and the
  // flag is the one thing that says whether this one is.
  if (truncated) throw new Error("only part of the corpus was read, so this would pin a partial population");

  const next = buildPin(discover(files), { sha, corpus: files.length });
  console.log(formatDelta(pinDelta(loadPin(root), next)));

  if (dryRun) {
    console.log(`\nwould write ${PIN_PATH}`);
    return;
  }
  writePin(root, next);
  console.log(`\nwrote ${PIN_PATH}`);
  console.log("run `anatomiya scan` to measure the map against it");
}

/**
 * `/plugin install` does not run `npm install`, so this is the first thing a new
 * user hits. Both commands used to answer it as a repository with nothing in it:
 * the scan wrote an empty map and exited 0, the check reported no findings.
 */
function notInstalled(message, command) {
  return new Error(`${message}\nrun \`npm install --omit=dev\` in the plugin directory, then ${command} again`);
}

async function runCheck(cwd, { baseRef }) {
  const report = await check(cwd, { baseRef });
  if (report.parse.missingParser) throw notInstalled(report.parse.missingParser, "check");
  process.stdout.write(formatReport(report));
  // Findings never set the exit code. A non-zero exit here means the check
  // could not run, which is what the command file tells the agent to trust.
}
