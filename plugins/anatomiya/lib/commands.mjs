import { execFile } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { absentInterpreter } from "./child.mjs";
import { scan } from "./scan.mjs";
import { deepRefusal } from "./semantic.mjs";
import { writeMap } from "./write.mjs";
import { check } from "./check.mjs";
import { engineOf, language } from "./langs.mjs";
import { collect, countUntrackedSource, gitRoot, lsFiles } from "./corpus.mjs";
import { discover } from "./areas.mjs";
import { buildPin, readPin, writePin, pinDelta, pinTarget, PIN_PATH } from "./baseline.mjs";
import { gitBuffered, headSha } from "./git.mjs";
import { encodePath, firstLine } from "./encode.mjs";
import { byCode } from "./paths.mjs";
import { plural } from "./render-layout.mjs";
import { listSome, LISTED, PREFIX, RULES_DIR, trackedRulesDir } from "./rules.mjs";
import { NODE_PROBE_IDS, PROBE_IDS, installProblem, pluginRoot, probeName, readiness, readinessAfresh, readinessLines, remedyFor } from "./readiness.mjs";
import { pinSummary, scanSummary } from "./summary.mjs";
import { untrackedSentence } from "./render.mjs";
import { aboutDir, childLayouts, echoContext, holdsTestIn, inCheckout, isPathTaken, ownLayout, removeStaleHook, targetIn, windowOf } from "./hook.mjs";
import { isTestPath, noticeFor } from "./precedent.mjs";
import { askedMarks, continuedByReuse, pendingChange, reuseReason, reuseRecord, sessionStart, turnStart } from "./reuse.mjs";

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
  const refused = deep ? await deepRefusal(remedyFor("typescript")) : null;
  if (refused) throw new Error(refused);

  const result = await scan(cwd, { deep });
  // Only where it left nothing to read (B13). An engine missing for one
  // language costs that language's files and the scan goes on for the rest:
  // refusing here gave a TypeScript repository with one Gemfile no map at all
  // on every machine without Ruby, and the summary and the map say which
  // language went unread and what to do about it (B41).
  if (result.parse.missingParser && result.readNothing) throw notInstalled(result.parse, "scan");

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
 * The directory whose repository answers this call.
 *
 * The call's own, where it has one. A file in no checkout at all falls to the
 * session's, because reading a system file, a dependency or another project's
 * source is ordinary and answering nothing there takes the map off a turn that
 * had one. A file that does have a checkout is answered by that checkout even
 * when the answer is silence: a nested repository with no map, or one whose map
 * is empty, must not be handed the enclosing one's counts, which is what the
 * boundary walk exists to refuse. A payload naming a place this cannot read at
 * all falls to the session's too, since it has said nothing about any other.
 *
 * The session's own may be absent: `process.cwd()` refuses once the directory a
 * session started in is unlinked, and the entry point lets that through rather
 * than losing the turn over it. Null then, and both callers answer with
 * silence, which is all a call this can place nowhere is owed.
 */
function answersFor(payload, cwd) {
  const about = aboutDir(payload, cwd);
  if (about !== null && inCheckout(about)) return about;
  return cwd ?? null;
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
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  const additionalContext = echoContext(root, { transcript: windowOf(payload) });
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
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  const found = ownLayout(root);
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
  const additionalContext = noticeFor(rel, found.layout, { holdsTest, from: found.from });
  if (additionalContext === null) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/**
 * What the end of a turn is asked about the source it added, or nothing (A91).
 *
 * Once per file as it stands: a file an ask or a record in this session already
 * marked is not named again, and the stop right after this hook's own block
 * records what the check left, so its fix is not asked about on the next turn.
 *
 * A session started above its checkouts has no map of its own and a Stop
 * payload names no file, so each mapped checkout directly below is read, and
 * its files named from the session's directory. A file's mark is its
 * checkout's, so a session that later moves into the checkout is not asked again.
 */
export async function runReuse(cwd, payload) {
  if (payload?.hook_event_name !== "Stop") return {};
  const root = answersFor(payload, cwd);
  if (root === null) return {};
  const found = ownLayout(root);
  const checkouts = found !== null ? [{ root: found.root, prefix: "" }] : childLayouts(root).map((c) => ({ root: c.root, prefix: `${c.name}/` }));
  if (checkouts.length === 0) return {};
  // Both halves of "once per change, and only this session's work" are read off
  // the transcript: when the session began, and what it already asked. One that
  // cannot be read says neither, so nothing is asked. Asking anyway blocked
  // every turn, a question included, over a tree left dirty before the session,
  // since no ask it made was ever recorded anywhere it could read back.
  const since = sessionStart(payload.transcript_path);
  if (since === null) return {};
  const turn = turnStart(payload.transcript_path);
  const changes = await Promise.all(checkouts.map((c) => pendingChange(c.root, { since, turnStart: turn })));
  const change = checkouts.flatMap((c, i) => (changes[i] ?? []).map((file) => ({ ...file, path: c.prefix + file.path })));
  if (change.length === 0) return {};
  const asked = askedMarks(payload.transcript_path);
  const fresh = change.filter((file) => !asked.has(file.mark));
  if (fresh.length === 0) return {};
  if (payload.stop_hook_active === true) {
    return continuedByReuse(payload.transcript_path) ? { systemMessage: reuseRecord(fresh) } : {};
  }
  return { decision: "block", reason: reuseReason(fresh) };
}

/**
 * Accept the current population as the baseline (E5).
 *
 * A separate command, and it answers with the delta and no recommendation: the
 * moment a re-pin looks most warranted is the moment the agent's own output is
 * largest, and a suggestion there launders it.
 *
 * `collectFiles` is a seam for tests, which land a commit while the list is
 * read.
 */
export async function runPin(cwd, { dryRun = false, expect = null, collectFiles = collect } = {}) {
  const root = await gitRoot(cwd);
  const sha = await headSha(root);
  if (!sha) throw new Error("no commit to pin: this repository has no HEAD");
  // The refresh judges a commit and then pins; a commit landing between the two
  // would be pinned unjudged.
  if (expect !== null && sha !== expect) throw new Error(`HEAD moved from ${expect} to ${sha} before the pin was taken`);
  // Refused by the half that plans, so a dry run cannot answer with a clean
  // delta for a write that would land outside the repository.
  pinTarget(root);
  await refuseUnlikeHead(root);

  const { files, truncated, dropped } = await collectFiles(root);
  // Asked again once the list is read. It comes from the index, and reading it
  // takes seconds on a large repository: a commit or a `git add` landing in
  // that window put files into a pin labelled with the commit judged before.
  if ((await headSha(root)) !== sha) throw new Error(`HEAD moved from ${sha} while the pin was being taken`);
  await refuseUnlikeHead(root);
  // No repository size truncates the corpus any more, so this cannot fire from
  // `collect`. It stays because a pin must describe a whole population, and the
  // flag is the one thing that says whether this one is.
  if (truncated) throw new Error("only part of the corpus was read, so this would pin a partial population");
  // Paths outside a sparse checkout's cone are skip-worktree, so `git status`
  // is clean while the tree holds only part of HEAD. A file unreadable for any
  // other reason stays out of every scan as well, so it is no gap in the pin.
  if (dropped?.unreadable > 0) {
    const outside = await absentSkipWorktree(root);
    if (outside > 0) {
      throw new Error(
        `${plural(outside, "tracked file")} ${outside === 1 ? "is" : "are"} outside this sparse checkout, and a pin records HEAD: ` +
          "disable or widen the sparse checkout first, then pin"
      );
    }
  }
  // An empty population is not a smaller baseline, it is one that makes every
  // area written after it postdate it, so nothing is stated anywhere until a
  // human pins again. The usual cause is source nobody has committed yet, and
  // the scan counts that in the same state, so the refusal counts it too.
  if (files.length === 0) {
    const untracked = await countUntrackedSource(root);
    throw new Error(
      untracked
        ? `nothing to pin: ${untrackedSentence(untracked)}; commit them, then pin`
        : "nothing to pin: this repository tracks no source file"
    );
  }

  const areas = discover(files);
  // No area is the empty population by another route: every area a later
  // commit makes postdates it.
  if (areas.length === 0) {
    const { shown, rest } = listSome(areas.orphaned.map((f) => f.rel).sort(byCode), LISTED.overview);
    const n = areas.orphaned.length;
    throw new Error(
      `nothing to pin: the ${plural(n, "source file")} tracked here ${n === 1 ? "sits" : "sit"} in no area ` +
        `(${shown.map(encodePath).join(", ")}${rest ? `, and ${rest} more` : ""}), and a pin with no area holds back ` +
        "every area made after it: pin once a directory holds enough source to be one"
    );
  }
  const next = buildPin(areas, { sha, corpus: files.length });
  // A pin on disk this build cannot read is compared against as nothing, and
  // replaced. Said, rather than printed as a first pin: it may be a conflict
  // somebody meant to resolve, or a newer build's.
  const { pin: previous, unreadable } = readPin(root);
  const delta = pinDelta(previous, next);
  if (!dryRun) writePin(root, next);

  return {
    summary: pinSummary({ root, previous, next, delta, path: PIN_PATH, dryRun, previousUnreadable: unreadable }),
    pin: next,
    previous,
    delta,
  };
}

/**
 * Refuse a tree that is not HEAD's. The pin records HEAD and the file list each
 * area holds, and that list is read from the index and the working tree.
 */
async function refuseUnlikeHead(root) {
  // Asked first and of the whole index: an unmerged path also shows in the
  // status below, whose advice to stash is one git refuses mid-merge. A tracked
  // source file under `.claude/` is corpus like any other. An unmerged path is
  // listed once per stage, so a pin taken mid-merge holds it three times and a
  // corpus larger than the tree, and the corpus fixes the area floor for every
  // scan after.
  const unmerged = await gitBuffered(root, ["ls-files", "--unmerged", "-z"]);
  if (!unmerged.ok) throw new Error(`could not read whether the index holds unmerged paths: ${firstLine(unmerged.error ?? "")}`);
  if (unmerged.stdout.length > 0) {
    throw new Error("the index holds unmerged paths, and a pin records HEAD: finish or abort the merge first, then pin");
  }
  // A staged, edited or deleted tracked file is listed against a commit that
  // does not hold it, and every scan after reads that area as a population
  // change for as long as the pin stands. This tool's own output under
  // `.claude/` is left out: a repository that commits its map rewrites it on
  // every scan, and it is never part of the population. A map written through
  // a `.claude/rules` link is stored under the link's target.
  const rules = trackedRulesDir(root);
  const own = rules === RULES_DIR ? [] : [`:(exclude)${rules}/${PREFIX}*.md`];
  const dirty = await gitBuffered(root, ["status", "--porcelain", "--untracked-files=no", "-z", "--", ".", ":(exclude).claude", ...own]);
  if (!dirty.ok) throw new Error(`could not read whether the working tree matches HEAD: ${firstLine(dirty.error ?? "")}`);
  if (dirty.stdout.length > 0) {
    throw new Error("tracked files differ from HEAD, and a pin records HEAD: commit or stash them first, then pin");
  }
}

/** How many skip-worktree paths the working tree does not hold. */
async function absentSkipWorktree(root) {
  let n = 0;
  await lsFiles(root, (entry) => {
    if (entry.startsWith("S ") && !lstatSync(join(root, entry.slice(2)), { throwIfNoEntry: false })) n++;
  }, ["-t"]);
  return n;
}

/** Answer the branch against the map on disk. */
export async function runCheck(cwd, { baseRef = null } = {}) {
  const report = await check(cwd, { baseRef });
  const { missingParser, missingEngines } = report.parse;
  if (missingParser) {
    // The scan's rule, for the same reason: a change that touched a Gemfile
    // beside a TypeScript file went unchecked because one file of another
    // language could not be read (B41). Refused only where every file this
    // change examined needed the missing engine, since a report of no findings
    // there reads as a check that ran (B13). Otherwise each unread file carries
    // its own caveat, and one more says which engine and what to do.
    const readable = report.examined.some((c) => !missingEngines.includes(engineOf(language(c.path))));
    if (!readable) throw notInstalled(report.parse, "check");
  }
  return { report };
}

/**
 * Whether every engine this parses with is installed, and what to do about each
 * that is not.
 *
 * Led by the one thing wrong with the installation itself where there is one,
 * since every node-hosted row is then absent for that reason. Those rows are
 * told the remedy has been said, so they keep what was wrong with each engine
 * and drop what to do about it: printed on the lead and on every row it
 * explains, one sentence appeared four times and the report read as four faults
 * again, which is what the lead is there to stop.
 */
export async function runDoctor() {
  const rows = await readiness({ engines: PROBE_IDS });
  const problem = installProblem(rows);
  const lines = readinessLines(rows, { installSaid: problem !== null });
  return { rows, lines: problem === null ? lines : [problem, ...lines] };
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
  // Present and not ready is a copy resolving from somewhere other than this
  // plugin's own install, one the tool will not use, and the install puts a
  // usable one ahead of it.
  const needed = rows.filter((r) => !r.present || !r.ok).map(probeName);
  const where = `${INSTALL.join(" ")} in ${root}`;
  const state =
    needed.length === 0
      ? `nothing to install: ${rows.map((r) => `${probeName(r)} ${r.version ?? "no version"}`).join(", ")}`
      : `not installed: ${needed.join(", ")}`;

  // With nothing needed there is no install to describe: "nothing to install"
  // followed by "would run npm install" contradicted itself about one install.
  if (needed.length === 0) return answer(root, needed, { output: state });
  if (dryRun) return answer(root, needed, { output: `${state}\nwould run ${where}` });

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
  const lines = [state, how, tail(said)].filter(Boolean);
  if (err) return answer(root, needed, { ran: true, ok: false, output: lines.join("\n") });

  // An exit of 0 says npm finished, not that anything loads. Measured with
  // `npm_config_optional=false`: npm left out oxc's native binding, which is an
  // optional dependency of the parser, answered "up to date", and setup
  // reported success to a doctor that went on sending the user back to setup.
  // So the engines are asked again, and one this run needs that still does not
  // load fails the setup under its own row's reason.
  // Asked of a fresh node: this process tried every engine before the install,
  // and a module whose evaluation threw stays failed here whatever npm did.
  const { rows: after, error } = await readinessAfresh({ engines: NODE_PROBE_IDS });
  const still = [];
  for (const r of after ?? []) if (!r.ok) still.push(`${probeName(r)} (${r.reason})`);
  if (error) lines.push(`npm finished, and whether the engines load now could not be asked: ${error}`);
  else if (still.length) lines.push(`npm finished, and still not loading: ${still.join(", ")}`);
  return answer(root, needed, { ran: true, ok: !error && still.length === 0, output: lines.join("\n") });
}

/**
 * The install, spelled once and both printed and run from here.
 *
 * `--ignore-scripts` is the load-bearing flag: without it a dependency's
 * install script runs arbitrary code in the plugin directory.
 *
 * `--include=optional` because the parser's native binding is an optional
 * dependency of `oxc-parser`, one per platform, and so is the checker. npm
 * reads `optional=false` or `omit=optional` from the user's own config, and
 * under it the install answered "up to date" and left no parser that loads;
 * an include wins over an omit of the same type, whoever set it.
 */
const INSTALL = Object.freeze(["npm", "install", "--omit=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"]);

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
 * Claude Code installs a plugin's dependencies from the lockfile beside its
 * manifest, so this is what an install that did not run or did not finish
 * leaves. Both commands used to answer it as a repository with nothing in it:
 * the scan wrote an empty map and exited 0, the check reported no findings.
 *
 * The remedy is the missing engine's own. One sentence used to be appended to
 * whatever the parse said, so a machine with no `ruby` on it was told to run
 * npm, which is the one thing that cannot install an interpreter.
 */
function notInstalled(parse, command) {
  return new Error(`${parse.missingParser}\n${remedyFor(parse.missingEngines[0])}, then ${command} again`);
}
