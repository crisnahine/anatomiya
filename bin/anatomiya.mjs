#!/usr/bin/env node
import { runCheck, runPin, runScan } from "../lib/commands.mjs";
import { pinLines, scanLines } from "../lib/summary.mjs";
import { formatReport } from "../lib/check.mjs";

const USAGE = [
  "usage: anatomiya scan  [path] [--dry-run] [--deep]",
  "       anatomiya check [path] [--base <ref>]",
  "       anatomiya pin   [path] [--dry-run]",
  "",
  "--deep adds the typescript checker to a scan: about 26x slower, and it needs",
  "the optional typescript dependency. It is a scan option only, because the",
  "checker is whole-program and a check would have to build the corpus twice.",
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
  const opts = { cmd, path: null, dryRun: false, baseRef: null, deep: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") return { ...opts, help: true };
    if (arg === "--deep") {
      // The checker is whole-program. Answering a branch with it would mean
      // building the whole corpus at two revisions, which is a scan's cost and
      // not a check's, so the flag is refused here rather than accepted and
      // quietly ignored: it was accepted, recorded as having run, and never run.
      if (cmd !== "scan") {
        fail(`--deep is not a ${cmd} option: the type checker runs on \`anatomiya scan --deep\`\n${USAGE}`);
      }
      opts.deep = true;
      continue;
    }
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
  if (opts.cmd === "check") {
    const { report } = await runCheck(cwd, { baseRef: opts.baseRef });
    process.stdout.write(formatReport(report));
    // Findings never set the exit code. A non-zero exit here means the check
    // could not run, which is what the command file tells the agent to trust.
  } else if (opts.cmd === "pin") {
    const { summary } = await runPin(cwd, { dryRun: opts.dryRun });
    console.log(pinLines(summary).join("\n"));
  } else {
    const { summary } = await runScan(cwd, { dryRun: opts.dryRun, deep: opts.deep });
    console.log(scanLines(summary).join("\n"));
  }
} catch (err) {
  // A missing repository, an unreadable tree or a git that will not run are all
  // ordinary conditions here, and a stack trace is not what the caller needs.
  console.error(`anatomiya: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
}
