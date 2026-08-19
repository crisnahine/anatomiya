#!/usr/bin/env node
import { runCheck, runDoctor, runEcho, runPin, runScan, runSetup } from "../lib/commands.mjs";
import { pinJson, pinLines, scanJson, scanLines } from "../lib/summary.mjs";
import { formatReport, formatReportGithub, formatReportJson } from "../lib/check-report.mjs";

const USAGE = [
  "usage: anatomiya scan   [path] [--dry-run] [--deep] [--format <name>]",
  "       anatomiya check  [path] [--base <ref>] [--format <name>]",
  "       anatomiya pin    [path] [--dry-run] [--format <name>]",
  "       anatomiya doctor",
  "       anatomiya setup  [--dry-run]",
  "",
  "--deep adds the typescript checker to a scan: about 26x slower, and it needs",
  "the optional typescript dependency. It is a scan option only, because the",
  "checker is whole-program and a check would have to build the corpus twice.",
  "",
  "--format is text by default. json prints the same answer as a record, for a",
  "reader that is not a terminal. github prints one annotation per finding and",
  "is a check option only, since nothing else here has findings. doctor and",
  "setup print lines for a person to read and take neither.",
  "",
  "[path] picks the repository, not a subtree: every command covers the whole",
  "repository the path is in, and scan prints the root it resolved to. doctor",
  "and setup take no path: they answer about this installation.",
  "",
  "setup installs the node-hosted engine's dependencies in the plugin's own",
  "directory. It is the only command that installs anything and the only one",
  "that reaches a package registry, and nothing else here runs it. On Windows",
  "it prints the command to run by hand instead.",
].join("\n");

/**
 * Every command, and which of the shared arguments it answers to. An argument a
 * command has no use for is refused with the usage rather than accepted and
 * quietly ignored, which is the trade --deep already makes.
 */
const COMMANDS = {
  scan: { path: true, dryRun: true, formats: ["text", "json"] },
  check: { path: true, dryRun: false, formats: ["text", "json", "github"] },
  pin: { path: true, dryRun: true, formats: ["text", "json"] },
  doctor: { path: false, dryRun: false, formats: ["text"] },
  setup: { path: false, dryRun: true, formats: ["text"] },
  // Not for a person: a hook runs this, hands it the event on stdin and reads
  // one JSON object back. It takes a path because a hook's own cwd is the
  // repository it fired in.
  echo: { path: true, dryRun: false, formats: ["json"] },
};

// One writer per format, and the set of names the flag takes.
const CHECK_WRITERS = { text: formatReport, json: formatReportJson, github: formatReportGithub };
const FORMATS = new Set(Object.keys(CHECK_WRITERS));

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
  const cmd = Object.hasOwn(COMMANDS, argv[0]) ? argv.shift() : "scan";
  const spec = COMMANDS[cmd];
  const opts = { cmd, path: null, dryRun: false, baseRef: null, deep: false, format: "text" };

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
      if (!spec.dryRun) fail(`--dry-run is not a ${cmd} option\n${USAGE}`);
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
    if (arg === "--format" || arg.startsWith("--format=")) {
      const value = arg === "--format" ? argv[++i] : arg.slice("--format=".length);
      if (!value || value.startsWith("-")) fail(`--format needs a name\n${USAGE}`);
      if (!FORMATS.has(value)) fail(`unknown format: ${value}\n${USAGE}`);
      // Refused rather than accepted and answered in text, which is the same
      // trade --deep makes: a format that was asked for and quietly not used
      // reads as a run whose output shape nobody has to check.
      if (!spec.formats.includes(value)) {
        fail(`--format ${value} is not a ${cmd} option: ${cmd} answers in ${spec.formats.join(" and ")}\n${USAGE}`);
      }
      opts.format = value;
      continue;
    }
    if (arg.startsWith("-")) fail(`unknown option: ${arg}\n${USAGE}`);
    if (!spec.path) fail(`${cmd} takes no path: it answers about this installation\n${USAGE}`);
    if (opts.path !== null) fail(`only one path may be given\n${USAGE}`);
    opts.path = arg;
  }

  return opts;
}

/**
 * The hook event on stdin, or an empty object where there is none to read.
 *
 * Bounded and timed out, because this runs on every tool call and a hook that
 * waits on a pipe nobody writes to holds the whole session there. Unparseable
 * is the same answer as absent: the caller has nothing to say either way, and
 * throwing would exit non-zero, which is the one outcome a hook must not have.
 */
function readPayload() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    // Resolving the promise is not enough to end the process: an open stdin is
    // a live handle, so a harness that opens the pipe and writes nothing kept
    // this alive for as long as it held it, measured at 8 seconds against the
    // 2 this claims. The bound has to release the handle, not just answer.
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done({}), 2000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) done({});
    });
    process.stdin.on("error", () => done({}));
    process.stdin.on("end", () => {
      try {
        done(JSON.parse(data || "{}"));
      } catch {
        done({});
      }
    });
  });
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
    // Findings never set the exit code, in any format. A non-zero exit here
    // means the check could not run, which is what the command file tells the
    // agent to trust.
    process.stdout.write(CHECK_WRITERS[opts.format](report));
  } else if (opts.cmd === "pin") {
    const { summary } = await runPin(cwd, { dryRun: opts.dryRun });
    if (opts.format === "json") process.stdout.write(pinJson(summary));
    else console.log(pinLines(summary).join("\n"));
  } else if (opts.cmd === "doctor") {
    // Exit 0 whichever way it came out: what it found is the report, and a
    // non-zero exit would read as a probe that could not run.
    const { lines } = await runDoctor();
    console.log(lines.join("\n"));
  } else if (opts.cmd === "setup") {
    const { ok, output } = await runSetup({ dryRun: opts.dryRun });
    if (!ok) fail(output);
    console.log(output);
  } else if (opts.cmd === "echo") {
    // A hook, so its own failure is the one thing it must never be: a non-zero
    // exit interrupts the run it exists to help. Every path here writes an
    // object and exits 0, including the one where stdin was never readable.
    process.stdout.write(JSON.stringify(runEcho(cwd, await readPayload())));
  } else {
    const { summary } = await runScan(cwd, { dryRun: opts.dryRun, deep: opts.deep });
    if (opts.format === "json") process.stdout.write(scanJson(summary));
    else console.log(scanLines(summary).join("\n"));
  }
} catch (err) {
  // A missing repository, an unreadable tree or a git that will not run are all
  // ordinary conditions here, and a stack trace is not what the caller needs.
  console.error(`anatomiya: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
}
