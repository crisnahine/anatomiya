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
 * nothing is created anywhere else. Everything it keeps lives in the store
 * beside `facts.json`, which the README's exclude lines already cover.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { loadPin, PIN_PATH } from "./baseline.mjs";
import { runPin, runScan } from "./commands.mjs";
import { atomic, FACTS_PATH, readFacts, readRecord } from "./facts.mjs";
import { BASE_REFS, gitBuffered, headSha } from "./git.mjs";
import { ownLayout } from "./hook.mjs";
import { pluginRoot } from "./readiness.mjs";
import { OVERVIEW_FILE, readHead, resolveInside, RULES_DIR, STORE_DIR } from "./rules.mjs";

/** What the worker last did, relative to the repository root. */
export const REFRESH_STATE = `${STORE_DIR}/refresh.json`;
const LOCK_FILE = "refresh.lock";

// A worker holds the lock for one scan, and the largest measured takes about
// two minutes. A lock older than this belongs to a worker that is not coming
// back, whatever its pid now names.
const LOCK_STALE_MS = 30 * 60 * 1000;

/** The longest a worker may run before it gives up (F5: nothing here runs without a clock). */
export const WORKER_DEADLINE_MS = 20 * 60 * 1000;

// Rescans in one worker when HEAD keeps moving under it. A rebase landing
// commit by commit is the case; the next change after that starts another.
const PASSES = 3;

// The only remote-tracking refs a pin may follow. A local `main` can hold
// commits nobody else has seen, which is exactly what a pin must not accept.
const REMOTE_BASES = BASE_REFS.filter((r) => r.startsWith("origin/"));

// What git leaves in its directory while an operation is unfinished. A scan in
// the middle of one counts a tree that exists only until it completes.
const IN_PROGRESS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply", "index.lock"];

const EVENTS = new Set(["SessionStart", "FileChanged"]);

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
  // A map of this checkout's own. A linked worktree reading its main checkout's
  // (A93) is answered from there, labelled, and scanning it would write a map
  // nobody asked for.
  const own = ownLayout(base);
  if (!own || own.from !== null) return {};

  start(own.root);
  const watchPaths = watchTargets(own.root);
  // An empty list would replace every other hook's watches with nothing.
  if (watchPaths.length === 0) return {};
  return { hookSpecificOutput: { hookEventName: event, watchPaths } };
}

/**
 * The files whose change means HEAD moved, absolute, in this checkout's own git
 * directory.
 *
 * The reflog is appended on every move, a commit, a merge, a pull or a reset
 * included; HEAD itself is rewritten only when the branch changes, and is named
 * too for a repository with the reflog turned off. The index is not watched: a
 * plain `git status` rewrites it. Read off the files rather than asked of git,
 * for the reason the map walk is (A24): this runs inside a hook.
 */
function watchTargets(root) {
  const marker = join(root, ".git");
  const entry = readHead(marker, 4096);
  let gitdir = null;
  if (entry.kind === "file") {
    const pointed = /^gitdir: (.+)/.exec(entry.head.split("\n")[0])?.[1]?.trim();
    if (pointed) gitdir = isAbsolute(pointed) ? pointed : resolve(root, pointed);
  } else if (entry.kind === "other" && existsSync(join(marker, "HEAD"))) {
    gitdir = marker;
  }
  return gitdir === null ? [] : [join(gitdir, "logs", "HEAD"), join(gitdir, "HEAD")];
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
 * The worker: bring the map, and where it is safe the pin, up to date with the
 * checkout, and say what it did.
 *
 * `reason` is one of: scanned, current, failed, failed-before, busy, git-busy,
 * tracked, deep, no-map, outside, no-head.
 */
export async function refreshRepository(root, { scan = runScan, pin = runPin } = {}) {
  const store = resolveInside(root, STORE_DIR);
  if (store === null) return { reason: "outside", pinned: false };
  const facts = readFacts(root).facts;
  if (!facts) return { reason: "no-map", pinned: false };
  // The type checker is opt-in and about 26x slower (B7): rescanning without it
  // drops the claims it added, and rescanning with it is a cost nobody asked for.
  if (facts.semantic?.ran === true) return { reason: "deep", pinned: false };
  if (await mapTracked(root)) return { reason: "tracked", pinned: false };
  if (await gitBusy(root)) return { reason: "git-busy", pinned: false };

  const lock = acquire(join(store, LOCK_FILE));
  if (!lock) return { reason: "busy", pinned: false };
  try {
    const pinned = await followPin(root, pin);
    for (let pass = 0; pass < PASSES; pass++) {
      const stamp = await stampOf(root);
      if (stamp === null) return { reason: "no-head", pinned };
      const state = readRecord(join(store, basename(REFRESH_STATE))).record;
      if (state?.stamp === stamp) return { reason: state.ok ? (pass === 0 ? "current" : "scanned") : "failed-before", pinned };
      try {
        await scan(root);
      } catch (err) {
        // The previous map stays: a scan that throws has written nothing
        // (A13), and one that would not run now will not run on the next
        // trigger either, until something about the checkout changes.
        writeState(store, { stamp, ok: false, error: String(err?.message ?? err) });
        return { reason: "failed", pinned };
      }
      writeState(store, { stamp, ok: true, error: null });
    }
    return { reason: "scanned", pinned };
  } finally {
    release(lock);
  }
}

/**
 * Everything a scan's answer depends on that can change without the scan
 * knowing: the commit, the index (which paths are tracked, and what is staged),
 * the pin, and this build. Working-tree edits are left out on purpose: they
 * move with every keystroke, and what a refresh follows is HEAD.
 */
async function stampOf(root) {
  const head = await headSha(root);
  if (!head) return null;
  const index = await gitBuffered(root, ["ls-files", "-s", "-z"], { encoding: "buffer" });
  if (!index.ok) return null;
  const pinPath = resolveInside(root, PIN_PATH);
  let pinBytes = "";
  try {
    pinBytes = pinPath === null ? "" : readFileSync(pinPath);
  } catch {
    pinBytes = "";
  }
  return createHash("sha256")
    .update(head)
    .update("\0")
    .update(index.stdout)
    .update("\0")
    .update(pinBytes)
    .update("\0")
    .update(buildVersion())
    .digest("hex");
}

function buildVersion() {
  try {
    return JSON.parse(readFileSync(join(pluginRoot(), "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}

/**
 * Pin the checkout, but only onto what the remote default branch already holds.
 *
 * The pin is the population a human accepted (E5). Where the checkout sits
 * exactly on the tip of `origin`'s default branch with nothing uncommitted, that
 * acceptance has already happened: every commit there was merged or pushed to
 * the branch the team shares, so none of it is the work under review. A
 * feature branch, a local commit the remote has not seen, a staged or edited
 * file, or a repository with no remote at all never pins, and the pin never
 * moves back onto an older commit. What is pinned is the index at HEAD, which
 * a clean tree makes byte-for-byte the commit.
 */
async function followPin(root, pin) {
  const head = await headSha(root);
  if (!head) return false;
  let tip = null;
  for (const ref of REMOTE_BASES) {
    const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (r.ok && r.stdout.trim()) {
      tip = r.stdout.trim();
      break;
    }
  }
  if (tip !== head) return false;
  const status = await gitBuffered(root, ["status", "--porcelain", "--untracked-files=no", "-z"]);
  if (!status.ok || status.stdout.length > 0) return false;
  const current = loadPin(root);
  if (current?.sha === head) return false;
  if (current) {
    // Newer than this checkout: the remote was rewound, or this clone is
    // behind the one that pinned. Either way the pin does not move backwards.
    const newer = await gitBuffered(root, ["merge-base", "--is-ancestor", head, current.sha]);
    if (newer.ok) return false;
  }
  try {
    await pin(root);
    return true;
  } catch {
    return false;
  }
}

async function mapTracked(root) {
  const r = await gitBuffered(root, ["ls-files", "-z", "--", `${RULES_DIR}/${OVERVIEW_FILE}`, FACTS_PATH]);
  return r.ok && r.stdout.length > 0;
}

async function gitBusy(root) {
  const r = await gitBuffered(root, ["rev-parse", "--absolute-git-dir"]);
  if (!r.ok) return true;
  const gitdir = r.stdout.trim();
  return IN_PROGRESS.some((name) => existsSync(join(gitdir, name)));
}

function writeState(store, { stamp, ok, error }) {
  atomic(join(store, basename(REFRESH_STATE)), JSON.stringify({ stamp, ok, error }, null, 2) + "\n");
}

/**
 * Take the lock, or answer null when a live worker holds it.
 *
 * Created exclusively, so two workers started by two sessions cannot both
 * believe they hold it. One whose owner is gone, or which is older than any
 * scan runs, is taken over once.
 */
function acquire(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return path;
    } catch (err) {
      if (err?.code !== "EEXIST") return null;
      if (!stale(path)) return null;
      try {
        unlinkSync(path);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function stale(path) {
  let held;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return true;
  }
  if (!Number.isInteger(held?.pid) || !Number.isFinite(held?.at)) return true;
  if (Date.now() - held.at > LOCK_STALE_MS) return true;
  return !alive(held.pid);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM is a process that exists and belongs to somebody else.
    return err?.code === "EPERM";
  }
}

function release(path) {
  try {
    unlinkSync(path);
  } catch {
    // Already gone is released.
  }
}
