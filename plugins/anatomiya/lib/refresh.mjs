/**
 * Keeping a map current without anybody running `scan` again.
 *
 * The map is a snapshot of one working tree, and a checkout, a pull or a commit
 * leaves it describing another one with nothing on disk saying so. Two hooks
 * notice the move and one worker acts on it:
 *
 * - `refresh`, on `SessionStart` and `FileChanged`, answers with the git files
 *   whose change means HEAD moved, and starts the worker. It does no git work of
 *   its own and returns at once: a SessionStart hook holds the first response
 *   until it exits, and a synchronous scan there would not reach the session
 *   anyway, since Claude Code reads the always-loaded rules before its hooks
 *   finish (`docs/research/when-a-hook-can-refresh-the-map.md`).
 * - the worker, detached and with every stdio closed, decides whether anything
 *   moved and rescans if it did. A rewritten overview reaches a running session
 *   through the echo's digest (A92), and an area file is read from disk the
 *   first time its directory is.
 *
 * The scoping is the hook's own (A24): only a checkout that already holds a map
 * of its own is ever refreshed, so the first `/anatomiya:scan` is the opt-in and
 * nothing is created anywhere else. Everything it keeps lives in `.claude/anatomiya/`
 * beside `facts.json`, which the README's exclude lines already cover.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { loadPin } from "./baseline.mjs";
import { locator } from "./encode.mjs";
import { readRecord } from "./facts.mjs";
import { childLayouts, isPathTaken, ownLayout } from "./hook.mjs";
import { pluginRoot } from "./readiness.mjs";
import { REFRESH_STATE, resolveInside } from "./rules.mjs";
import { commonDirOf, gitDirOf } from "./worktree.mjs";

/** The longest a worker may run before it gives up (F5: nothing here runs without a clock). */
export const WORKER_DEADLINE_MS = 20 * 60 * 1000;

const EVENTS = new Set(["SessionStart", "FileChanged"]);

// A compaction or a clear inside a session the person already started.
const QUIET_SOURCES = new Set(["compact", "clear"]);

/**
 * The hook. One object back, and the worker started, or `{}` and nothing.
 *
 * `start` is the seam a test records through; the hook itself never waits on
 * what it starts.
 */
export function runRefresh(cwd, payload, { start = startWorker } = {}) {
  const event = payload?.hook_event_name;
  if (!EVENTS.has(event)) return {};
  const base = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : cwd;
  if (!base) return {};
  const found = refreshRoots(base);
  if (found.length === 0) return {};
  const roots = found.map((c) => c.root);

  // The watch list is one list shared by every hook. A change to a file this
  // hook did not ask for is somebody else's, and answering it would both start
  // a worker for nothing and replace their watch with ours. Ours is any file
  // the watch could name in these checkouts' git directories, not only the ones
  // it names now: a first commit writes `logs/HEAD`, which moves the watch off
  // the index it named before, and refusing the index's change then left the
  // session watching a file nothing would change again.
  const changed = event === "FileChanged" ? resolve(String(payload.file_path ?? "")) : null;
  const moved = changed === null ? roots : roots.filter((root) => ownWatch(root, changed));
  if (moved.length === 0) return {};
  for (const root of moved) start(root);
  const watchPaths = roots.flatMap(watchTargets);
  // Said to the person when they start or resume a session: a `made-here` hold
  // never ends on its own.
  const notices = event === "SessionStart" && !QUIET_SOURCES.has(payload.source) ? found.map((c) => holdNotice(c.root, c.name)).filter((n) => n !== null) : [];
  const said = notices.length === 0 ? {} : { systemMessage: notices.join("\n") };
  // An empty list would replace every other hook's watches with nothing.
  if (watchPaths.length === 0) return said;
  return { ...said, hookSpecificOutput: { hookEventName: event, watchPaths } };
}

/**
 * The checkouts a session in this directory refreshes: the one whose own map it
 * is in, or where it is in none, the mapped checkouts directly below it, each
 * with its name there.
 */
function refreshRoots(base) {
  const own = ownLayout(base);
  if (own === null) return childLayouts(base).map((child) => ({ root: child.root, name: child.name }));
  // A linked worktree reading its main checkout's map (A93) is answered from
  // there, labelled, and scanning it would write a map nobody asked for. A
  // record below its checkout's root came with a copy of another project; the
  // scan it would start writes at the checkout's root, which never opted in
  // (A24), and the end-of-turn check refuses the same record for the same reason.
  return own.from === null && isPathTaken(join(own.root, ".git")) ? [{ root: own.root, name: null }] : [];
}

/**
 * The files whose change means HEAD moved, absolute, in this checkout's own git
 * directory.
 *
 * The reflog is appended on every move, a commit, a merge, a pull or a reset
 * included; HEAD itself is rewritten only when the branch changes. Where there
 * is no reflog to watch, something else that every move rewrites stands in: on
 * the reftable backend `reftable/tables.list`, rewritten by every ref update,
 * with a linked worktree's own stack beside the shared one, since that is where
 * its HEAD lives; and in a files repository created without a reflog the index,
 * which a commit, a pull, a checkout and a reset all write. The index is the
 * last resort because a plain `git status` rewrites it too, and each of those
 * then costs a worker that finds the stamp unchanged. Read off the files rather
 * than asked of git, for the reason the map walk is (A24): this runs inside a
 * hook. Every basename here is in the `FileChanged` matcher in `hooks.json`.
 */
export function watchTargets(root) {
  const gitdir = gitDirOf(root);
  if (gitdir === null) return [];
  const head = join(gitdir, "HEAD");
  const common = commonDirOf(gitdir);
  if (existsSync(join(common, "reftable"))) {
    const lists = [join(common, "reftable", "tables.list")];
    if (gitdir !== common && existsSync(join(gitdir, "reftable"))) lists.push(join(gitdir, "reftable", "tables.list"));
    return [...lists, head];
  }
  const log = join(gitdir, "logs", "HEAD");
  return [existsSync(log) ? log : join(gitdir, "index"), head];
}

/** Whether a changed file is one a watch of this checkout names, or could have named. */
function ownWatch(root, changed) {
  const gitdir = gitDirOf(root);
  if (gitdir === null) return false;
  const common = commonDirOf(gitdir);
  const could = [
    join(gitdir, "HEAD"),
    join(gitdir, "logs", "HEAD"),
    join(gitdir, "index"),
    join(gitdir, "reftable", "tables.list"),
    join(common, "reftable", "tables.list"),
  ];
  return could.includes(changed);
}

/**
 * Start the worker and let go of it.
 *
 * Detached, with every stdio closed: Claude Code waits for a hook's pipes to
 * close rather than for its process to exit, and a scan holding one open would
 * hold the session's first response for as long as it ran. Outside the
 * repository, with no shell, and with the node that is already running.
 */
function startWorker(root) {
  try {
    const child = spawn(process.execPath, [join(pluginRoot(), "bin", "anatomiya.mjs"), "refresh-run", root], {
      cwd: tmpdir(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // A worker that would not start is a map that stays as it was, which is
    // what it was before this hook existed.
  }
}

/**
 * Whether a reflog message is a fetch or pull that moved the tracking ref the
 * way the remote's configuration maps it. Git logs the command line (`fetch -q
 * . HEAD:refs/remotes/origin/main: fast-forward`), and one fetching from a path
 * or a URL, or writing an explicit destination under the remote-tracking refs,
 * put whatever it named into the tracking ref: a local commit, another
 * repository's, or a teammate's unmerged branch. Those are refused. A local
 * destination (`fetch origin main:main`) leaves the tracking ref to the
 * configured mapping. What stays open is a remote reconfigured to point
 * somewhere else, which is the repository's own setting (E11).
 */
export function movedByRemote(message) {
  const words = message.replace(/: [^:]*$/, "").split(" ");
  if (!/^(fetch|pull)$/.test(words[0])) return false;
  // `--refmap` replaces the configured mapping itself.
  if (words.some((w) => w.startsWith("--refmap"))) return false;
  const [repository, ...refspecs] = words.slice(1).filter((w) => !w.startsWith("-"));
  if (repository !== undefined && (repository.includes(":") || /^[./~]/.test(repository))) return false;
  // Git reads a destination spelled `remotes/...` as `refs/remotes/...`.
  return !refspecs.some((r) => /^(refs\/)?remotes\//.test(r.slice(r.indexOf(":") + 1)));
}

/**
 * What the person hears at the start of a session when the pin has stopped
 * following the remote, or null. For the terminal (`systemMessage`), never the
 * model's context: the model is the author E5 keeps from accepting its own
 * work, and a sentence in its context naming the way to accept it is the
 * suggestion E5 refuses. Only fixed words and hex commit ids, validated here,
 * since the record sits in a directory the repository could ship.
 *
 * `name` is the checkout's directory, given where the session sits above it:
 * `/anatomiya:pin` pins the checkout it runs in, which is not the session's.
 */
export function holdNotice(root, name = null) {
  const body = heldBecause(root);
  if (body === null) return null;
  if (name === null) return `anatomiya: ${body} Pinning it is a person's call, made with /anatomiya:pin.`;
  const shown = /^[\w.@+-]+$/.test(name) ? name : JSON.stringify(locator(name));
  return `anatomiya (${shown}): ${body} Pinning it is a person's call, made with /anatomiya:pin in a session started inside ${shown}.`;
}

function heldBecause(root) {
  const path = resolveInside(root, REFRESH_STATE);
  if (path === null) return null;
  const held = readRecord(path).record?.held;
  const pin = loadPin(root)?.sha ?? null;
  // A pin moved since the hold, by hand, has answered it.
  if ((held?.pin ?? null) !== pin) return null;
  const commit = typeof held?.commit === "string" && /^[0-9a-f]{7,64}$/.test(held.commit) ? held.commit.slice(0, 7) : null;
  const at = typeof pin === "string" && /^[0-9a-f]{7,64}$/.test(pin) ? ` at ${pin.slice(0, 7)}` : "";
  if (held?.reason === "made-here") {
    // The committer names who made a commit, not where.
    const how =
      held.by === "identity"
        ? "was committed under this clone's git identity, which the automatic pin reads as this clone's own work."
        : "was made in this clone, and the automatic pin never accepts this clone's own work.";
    return `the pin stays${at}: ${commit ? `commit ${commit}` : "a commit"} on origin's default branch ${how}`;
  }
  if (held?.reason === "no-record") {
    return (
      `the pin stays${at}: git kept no record of how origin's default branch last ` +
      "moved in this clone (no reflog), so a fetch cannot be told from a push and the automatic pin does not follow it."
    );
  }
  if (held?.reason === "unread") {
    return (
      `the pin stays${at}: git could not say whether a commit on origin's default branch was made ` +
      "in this clone, so the automatic pin does not follow it."
    );
  }
  if (held?.reason === "not-fetched") {
    return (
      `the pin stays${at}: origin's default branch was last moved by this clone ` +
      "(a push, or a ref written by hand), not by a fetch, so the automatic pin does not follow it."
    );
  }
  return null;
}

