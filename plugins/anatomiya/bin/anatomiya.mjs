#!/usr/bin/env node
import { runCheck, runDoctor, runEcho, runNotice, runPin, runScan, runSetup } from "../lib/commands.mjs";
import { readPayload, respond } from "../lib/hook.mjs";
import { pinJson, pinLines, scanJson, scanLines } from "../lib/summary.mjs";
import { formatReport, formatReportGithub, formatReportJson } from "../lib/check-report.mjs";

const USAGE = [
  "usage: anatomiya scan   [path] [--dry-run] [--deep] [--format <name>]",
  "       anatomiya check  [path] [--base <ref>] [--format <name>]",
  "       anatomiya pin    [path] [--dry-run] [--format <name>]",
  "       anatomiya doctor",
  "       anatomiya setup  [--dry-run]",
  "",
  "A command word is required. Given none, this usage is what prints, and",
  "nothing is written; an unknown one is refused by name.",
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
 * Every command: which of the shared arguments it answers to, and its arm. An
 * argument a command has no use for is refused with the usage rather than
 * accepted and quietly ignored, which is the trade --deep already makes. The
 * arm lives here so a verb cannot be declared without one: the dispatch that
 * ended in a bare else scanned for any verb it did not name.
 */
const COMMANDS = {
  scan: {
    path: true,
    dryRun: true,
    formats: ["text", "json"],
    async run(cwd, opts) {
      const { summary } = await runScan(cwd, { dryRun: opts.dryRun, deep: opts.deep });
      if (opts.format === "json") process.stdout.write(scanJson(summary));
      else console.log(scanLines(summary).join("\n"));
    },
  },
  check: {
    path: true,
    dryRun: false,
    formats: ["text", "json", "github"],
    async run(cwd, opts) {
      const { report } = await runCheck(cwd, { baseRef: opts.baseRef });
      // Findings never set the exit code, in any format. A non-zero exit here
      // means the check could not run, which is what the command file tells the
      // agent to trust.
      process.stdout.write(CHECK_WRITERS[opts.format](report));
    },
  },
  pin: {
    path: true,
    dryRun: true,
    formats: ["text", "json"],
    async run(cwd, opts) {
      const { summary } = await runPin(cwd, { dryRun: opts.dryRun });
      if (opts.format === "json") process.stdout.write(pinJson(summary));
      else console.log(pinLines(summary).join("\n"));
    },
  },
  doctor: {
    path: false,
    dryRun: false,
    formats: ["text"],
    async run() {
      // Exit 0 whichever way it came out: what it found is the report, and a
      // non-zero exit would read as a probe that could not run.
      const { lines } = await runDoctor();
      console.log(lines.join("\n"));
    },
  },
  setup: {
    path: false,
    dryRun: true,
    formats: ["text"],
    async run(_cwd, opts) {
      const { ok, output } = await runSetup({ dryRun: opts.dryRun });
      if (!ok) fail(output);
      console.log(output);
    },
  },
  // Not for a person: a hook runs these, hands them the payload on stdin and
  // reads one JSON object back. They take a path because a hook's own cwd is
  // the repository it fired in. `hook` is what the never-fail guarantee below
  // is keyed on, so a third verb inherits it by declaring itself here.
  echo: {
    path: true,
    dryRun: false,
    formats: ["json"],
    hook: true,
    async run(cwd) {
      // A hook, so its own failure is the one thing it must never be: a non-zero
      // exit interrupts the run it exists to help. Every path here writes an
      // object and exits 0, including the one where stdin was never readable and
      // the one where nobody is left to read the answer.
      respond(runEcho(cwd, await readPayload()));
    },
  },
  notice: {
    path: true,
    dryRun: false,
    formats: ["json"],
    hook: true,
    async run(cwd) {
      // The same guarantee `echo` makes, on the event before the tool rather
      // than the one after it.
      respond(runNotice(cwd, await readPayload()));
    },
  },
};

// One writer per format, and the set of names the flag takes.
const CHECK_WRITERS = { text: formatReport, json: formatReportJson, github: formatReportGithub };
const FORMATS = new Set(Object.keys(CHECK_WRITERS));

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

/**
 * The directory this process is in, or nothing where it has been removed under it.
 *
 * `process.cwd()` refuses with ENOENT once the directory a session started in is
 * unlinked, which `git worktree remove` does to a session sitting in one. Node
 * caches the answer and clears it only on a `chdir`, so a process that read it
 * once keeps the stale path for ever and one that never did refuses for ever:
 * the failure is whole-process, which is why a session goes quiet for the rest
 * of its life rather than for one call, and why a case that proves anything
 * about it has to start a process with the directory already gone.
 *
 * A hook may not lose the turn over it: the payload carries its own `cwd`, and
 * its readers already answer with no base at all, so the absent one is let
 * through to them. A scan needs a real directory to walk, and says which one is
 * missing rather than handing nothing to a git call to fail on later.
 */
function sessionDir(isHook) {
  try {
    return process.cwd();
  } catch {
    if (isHook) return null;
    throw new Error("the directory this was run from has been removed, so there is no repository to answer about: give a path");
  }
}

/**
 * Anything starting with `-` is a flag, never a path. A tracked file may be
 * named `--instruction-file-path=.git/config`, and taking it as the positional
 * argument would hand it straight to a subprocess.
 */
function parseArgs(argv) {
  // The command word is required. It used to default to `scan`, which writes,
  // so typing the bare name to see what the tool does replaced the map, and a
  // mistyped command was read as a path and refused as a bad repository, which
  // names the wrong fix. A mistyped option was already refused by name.
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") return { cmd: null, help: true };
  if (!Object.hasOwn(COMMANDS, argv[0])) {
    if (argv[0].startsWith("-")) fail(`no command given, and an option cannot stand in for one: ${argv[0]}\n${USAGE}`);
    fail(`unknown command: ${argv[0]}\n${USAGE}`);
  }
  const cmd = argv.shift();
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
        fail(`${cmd} takes no --deep option: the type checker runs on \`anatomiya scan --deep\`\n${USAGE}`);
      }
      opts.deep = true;
      continue;
    }
    if (arg === "--dry-run") {
      if (!spec.dryRun) fail(`${cmd} takes no --dry-run option\n${USAGE}`);
      opts.dryRun = true;
      continue;
    }
    if (arg === "--base" || arg.startsWith("--base=")) {
      if (cmd !== "check") fail(`${cmd} takes no --base option\n${USAGE}`);
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
        fail(`${cmd} does not answer in ${value}: it answers in ${spec.formats.join(" and ")}\n${USAGE}`);
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

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  // Returned rather than exited from: a write to a pipe is asynchronous once it
  // is larger than the buffer, and `process.exit` drops what has not flushed.
  console.log(USAGE);
} else {
  try {
    // Only the verbs that answer about a repository ask where this process is.
    // `doctor` and `setup` answer about this installation and take no path, so
    // a directory removed under them decides nothing they say.
    const spec = COMMANDS[opts.cmd];
    const cwd = spec.path ? opts.path ?? sessionDir(spec.hook === true) : null;
    await spec.run(cwd, opts);
  } catch (err) {
    // The hook answers for itself, whatever went wrong and wherever it came from.
    // A non-zero exit interrupts the run it exists to help, and it would do it on
    // every turn and every tool call for the life of that session, so the
    // guarantee belongs at the boundary rather than at each site that might throw.
    if (COMMANDS[opts.cmd]?.hook) {
      // Answered, and then nothing: the exit code is 0 because nothing set it,
      // and no `process.exit` runs, which would drop a write the pipe has not
      // flushed.
      respond({});
    } else {
      // A missing repository, an unreadable tree or a git that will not run are
      // all ordinary conditions here, and a stack trace is not what the caller
      // needs.
      console.error(`anatomiya: ${err && err.message ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}
