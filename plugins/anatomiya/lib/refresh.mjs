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
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { loadPin, PIN_PATH } from "./baseline.mjs";
import { runPin, runScan } from "./commands.mjs";
import { atomic, FACTS_PATH, readFacts, readRecord } from "./facts.mjs";
import { BASE_REFS, gitBuffered, gitStreamed, headSha, UNFINISHED_OPERATIONS } from "./git.mjs";
import { ownLayout } from "./hook.mjs";
import { pluginRoot } from "./readiness.mjs";
import { OVERVIEW_FILE, readHead, REFRESH_STATE, resolveInside, RULES_DIR, STORE_DIR } from "./rules.mjs";

const LOCK_FILE = "refresh.lock";

// A worker holds the lock for one scan, and the largest measured takes about
// two minutes. A lock older than this belongs to a worker that is not coming
// back, whatever its pid now names.
const LOCK_STALE_MS = 30 * 60 * 1000;

/** The longest a worker may run before it gives up (F5: nothing here runs without a clock). */
export const WORKER_DEADLINE_MS = 20 * 60 * 1000;

// How long a failed rescan of an unchanged checkout waits before it is tried
// again. A failure can be the machine's rather than the checkout's (a temp
// directory removed under a worker, a fork refused under load), and held for
// ever it stopped every refresh until the next commit; tried on every trigger
// it paid a whole failing scan each time a watched file changed.
const RETRY_MS = 30 * 60 * 1000;

const retryDue = (state) => {
  const at = Date.parse(state?.at ?? "");
  return !Number.isFinite(at) || Date.now() - at > RETRY_MS;
};

// Rescans in one worker when HEAD keeps moving under it. A rebase landing
// commit by commit is the case; the next change after that starts another.
const PASSES = 3;

// The only remote-tracking refs a pin may follow. A local `main` can hold
// commits nobody else has seen, which is exactly what a pin must not accept.
const REMOTE_BASES = BASE_REFS.filter((r) => r.startsWith("origin/"));

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

  const watchPaths = watchTargets(own.root);
  // The watch list is one list shared by every hook. A change to a file this
  // hook did not ask for is somebody else's, and answering it would both start
  // a worker for nothing and replace their watch with ours.
  if (event === "FileChanged" && !watchPaths.includes(resolve(String(payload.file_path ?? "")))) return {};
  start(own.root);
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
 * tracked, no-map, outside, no-head.
 */
export async function refreshRepository(root, { scan = runScan, pin = runPin } = {}) {
  const store = resolveInside(root, STORE_DIR);
  if (store === null) return { reason: "outside", pinned: false };
  const facts = readFacts(root).facts;
  if (!facts) return { reason: "no-map", pinned: false };
  // The type checker is opt-in and about 26x slower (B7), so a refresh keeps the
  // mode the person chose: a map built with it is rebuilt with it, rather than
  // skipped (which left it stale after every checkout) or rebuilt without it
  // (which dropped the claims it added). A checker that is no longer installed
  // fails the rescan, and the previous map stays.
  const deep = facts.semantic?.ran === true;
  if (await mapTracked(root)) return { reason: "tracked", pinned: false };
  if (await gitBusy(root)) return { reason: "git-busy", pinned: false };

  const lock = acquire(join(store, LOCK_FILE));
  if (!lock) return { reason: "busy", pinned: false };
  try {
    const accepted = await followPin(root, pin);
    const pinned = accepted !== null;
    for (let pass = 0; pass < PASSES; pass++) {
      const stamp = await stampOf(root);
      if (stamp === null) return { reason: "no-head", pinned };
      const state = readRecord(join(store, basename(REFRESH_STATE))).record;
      if (state?.stamp === stamp && (state.ok || !retryDue(state))) {
        return { reason: state.ok ? (pass === 0 ? "current" : "scanned") : "failed-before", pinned };
      }
      try {
        await scan(root, { deep });
      } catch (err) {
        // The previous map stays: a scan that throws has written nothing
        // (A13), and one that would not run now will not run on the next
        // trigger either, until something about the checkout changes.
        writeState(store, { stamp, ok: false, error: String(err?.message ?? err), pinned: accepted });
        return { reason: "failed", pinned };
      }
      writeState(store, { stamp, ok: true, error: null, pinned: accepted });
    }
    return { reason: "scanned", pinned };
  } finally {
    release(lock);
  }
}

/**
 * Record a scan somebody ran by hand as the refresh's own. The echo sends a
 * session to `/anatomiya:scan` when a refresh failed, and without this the
 * warning outlived the scan that answered it, and the next refresh rescanned a
 * checkout that had not moved. What the last automatic pin accepted is kept.
 * Never throws: the scan it follows has already succeeded.
 */
export async function noteScan(root) {
  try {
    const store = resolveInside(root, STORE_DIR);
    if (store === null) return;
    const stamp = await stampOf(root);
    if (stamp === null) return;
    const previous = readRecord(join(store, basename(REFRESH_STATE))).record;
    writeState(store, { stamp, ok: true, error: null, pinned: previous?.pinned ?? null });
  } catch {
    // Nothing to record; the next refresh rescans, which is the old behaviour.
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
  // Streamed into the hash: the index grows with the repository, and a buffered
  // read gave up past its byte cap, which left the stamp null and the map never
  // refreshed on the largest repositories (F6).
  const hash = createHash("sha256").update(head).update("\0");
  try {
    await gitStreamed(root, ["ls-files", "-s", "-z"], (field) => {
      hash.update(field);
      hash.update("\0");
    });
  } catch {
    return null;
  }
  // The pin that was read, not the file beside this checkout: a linked worktree
  // reads its main checkout's, and a pin moving there changes this map too.
  const pinBytes = JSON.stringify(loadPin(root));
  return hash
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
  if (!head) return null;
  const tip = await remoteTip(root);
  if (tip === null || tip.sha !== head) return null;
  // Pushed is not reviewed, and a ref written by hand is not the remote's. A
  // session can run `git push` or `git update-ref` itself, and a pin that
  // followed either accepted the agent's own commits as the population every
  // gate reads. Git records how the remote-tracking ref last moved, and only a
  // fetch or a pull brought commits the remote already held, and a ref with
  // no record counts only as the clone that brought it. A commit this clone
  // made is refused below however it reached the remote.
  if (!(await fetchedHere(root, tip.ref, tip.sha))) return null;
  const current = loadPin(root);
  if (current?.sha === head) return null;
  if (current) {
    // Newer than this checkout: the remote was rewound, or this clone is
    // behind the one that pinned. Either way the pin does not move backwards.
    const newer = await gitBuffered(root, ["merge-base", "--is-ancestor", head, current.sha]);
    if (newer.ok) return null;
  }
  if (await madeHereOnLine(root, current?.sha ?? null, head)) return null;
  // A staged or edited tracked file is refused by `pin` itself, the one rule for
  // what a pin may record, and so is HEAD having moved since it was judged here.
  // A refusal is simply no pin.
  try {
    const { delta } = await pin(root, { expect: head });
    // What was accepted, kept where a person can read it: the pin is taken with
    // nobody watching, so this is the one place its population delta is said.
    return { from: current?.sha ?? null, to: head, addedFiles: delta.addedFiles, removedFiles: delta.removedFiles };
  } catch {
    return null;
  }
}

// A reflog entry that records a commit this clone created: a commit, amend or
// merge commit, a pick, a revert, a patch applied, a step of a rebase that
// rewrote one, a merge commit made by `merge` or `pull`. A rebase's step is
// named by whatever ran it (`rebase (pick)`, `pull -q origin main (pick)`, with
// `pull.rebase` set), so the step is read and not the command. A rebase's
// `(start)` and `(finish)` name the commit it moved onto, which is upstream's,
// and a fast-forward creates nothing; counting either stalled the pin on every
// rebase onto the remote.
const MADE_HERE = /^(commit|cherry-pick|revert|am)\b|\((pick|reword|edit|squash|fixup|continue)\): |: Merge made /;

/**
 * Whether a commit this clone created sits on the first-parent line the pin
 * would move along. A fetched tip is not enough: `git push <url>` moves no
 * tracking ref, so the fetch after it is ordinary, and brings this clone's own
 * commit back as if the team had. The line is first-parent only because that is
 * what a direct push writes; a branch merged on the remote with a merge commit
 * sits behind its second parent, the merge being its review, and counting it
 * stalled the pin for every merge-commit workflow. Branch reflogs are shared by
 * every worktree, and a commit made on a detached HEAD in a linked worktree is
 * the one this does not see. Anything git could not answer counts as made here.
 */
async function madeHereOnLine(root, from, to) {
  const log = await gitBuffered(root, ["log", "-g", "--all", "--format=%H %gs"]);
  if (!log.ok) return true;
  const made = new Set();
  for (const line of log.stdout.split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0 && MADE_HERE.test(line.slice(space + 1))) made.add(line.slice(0, space));
  }
  if (made.size === 0) return false;
  const line = await gitBuffered(root, ["rev-list", "--first-parent", from ? `${from}..${to}` : to]);
  if (!line.ok) return true;
  return line.stdout.split("\n").some((sha) => made.has(sha.trim()));
}

/**
 * The remote default branch's tip and the ref it was read from: the first of
 * `origin/HEAD`, `origin/main`, `origin/master` that resolves, or, in a clone
 * whose only remote has another name, that remote's HEAD.
 */
async function remoteTip(root) {
  const candidates = [...REMOTE_BASES];
  const remotes = await gitBuffered(root, ["remote"]);
  const names = remotes.ok ? remotes.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  if (names.length === 1 && names[0] !== "origin" && /^[A-Za-z0-9._-]+$/.test(names[0])) candidates.push(`${names[0]}/HEAD`);
  for (const ref of candidates) {
    const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    const sha = r.ok ? r.stdout.trim() : "";
    if (sha) return { sha, ref };
  }
  return null;
}

/**
 * Whether the remote-tracking ref last moved because a fetch or a pull moved it.
 *
 * Asked through `git reflog`, which reads every ref backend: the files backend
 * keeps `logs/refs/...`, reftable keeps none, and reading the file had a
 * reftable clone, or one with `core.logAllRefUpdates=false`, follow its own
 * push. A clone writes no entry for the branch it brought, so an empty reflog
 * is the remote's only where the main checkout's first move was that clone,
 * onto this same commit; anything else with no record is refused.
 */
async function fetchedHere(root, ref, sha) {
  const full = await gitBuffered(root, ["rev-parse", "--symbolic-full-name", ref]);
  const name = full.ok ? full.stdout.trim() : "";
  if (!name.startsWith("refs/remotes/")) return false;
  const last = await gitBuffered(root, ["reflog", "show", "-n1", "--format=%gs", name]);
  if (!last.ok) return false;
  const message = last.stdout.trim();
  return message === "" ? clonedOnto(root, sha) : movedByRemote(message);
}

/** Whether the main checkout's oldest reflog entry is the clone that checked out `sha`. */
async function clonedOnto(root, sha) {
  const log = await gitBuffered(root, ["reflog", "show", "--format=%H %gs", "main-worktree/HEAD"]);
  if (!log.ok) return false;
  const first = log.stdout.trimEnd().split("\n").pop() ?? "";
  return first.startsWith(`${sha} clone: `);
}

/**
 * Whether a reflog message is a fetch or pull that took its refspecs from the
 * remote's configuration. Git logs the command line (`fetch -q . HEAD:refs/
 * remotes/origin/main: fast-forward`), and one that names a path or writes
 * through an explicit `src:dst` put whatever it named into the tracking ref:
 * a local commit, or another repository's. Those are refused. What stays open
 * is a remote reconfigured to point somewhere else, which is the repository's
 * own setting (E11).
 */
export function movedByRemote(message) {
  const words = message.replace(/: [^:]*$/, "").split(" ");
  if (!/^(fetch|pull)$/.test(words[0])) return false;
  return !words.slice(1).some((w) => !w.startsWith("-") && (w.includes(":") || /^[./~]/.test(w)));
}

/**
 * Whether the repository commits what this tool writes. A committed map travels
 * with every branch already, and a committed pin can never name the commit that
 * holds it, so following either would leave a change in `git status` nobody made.
 */
async function mapTracked(root) {
  const r = await gitBuffered(root, ["ls-files", "-z", "--", `${RULES_DIR}/${OVERVIEW_FILE}`, FACTS_PATH, PIN_PATH]);
  return r.ok && r.stdout.length > 0;
}

async function gitBusy(root) {
  const r = await gitBuffered(root, ["rev-parse", "--absolute-git-dir"]);
  if (!r.ok) return true;
  const gitdir = r.stdout.trim();
  return UNFINISHED_OPERATIONS.some((name) => existsSync(join(gitdir, name)));
}

function writeState(store, { stamp, ok, error, pinned = null }) {
  const at = new Date().toISOString();
  atomic(join(store, basename(REFRESH_STATE)), JSON.stringify({ stamp, ok, error, at, ...(pinned ? { pinned } : {}) }, null, 2) + "\n");
}

/**
 * Take the lock, or answer null when a live worker holds it.
 *
 * Created exclusively, so two workers cannot both create it. One whose owner is
 * gone, or which is older than any scan runs, is taken over by renaming it
 * aside rather than unlinking it: two workers that both judged it stale race
 * for one rename of one entry, and only one of them gets it. A worker whose
 * rename caught a lock somebody created after it judged the old one stale
 * finds bytes it did not judge, and puts that lock back.
 */
function acquire(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      create(path, JSON.stringify({ pid: process.pid, at: Date.now(), nonce: randomBytes(8).toString("hex") }));
      return path;
    } catch (err) {
      if (err?.code !== "EEXIST") return null;
      const judged = contentOf(path);
      if (!stale(judged)) return null;
      const aside = `${path}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
      try {
        renameSync(path, aside);
      } catch {
        return null;
      }
      if (contentOf(aside) !== judged) {
        try {
          linkSync(aside, path);
        } catch {
          // Somebody holds it already; either way it is not ours.
        }
        release(aside);
        return null;
      }
      release(aside);
    }
  }
  return null;
}

/**
 * The lock file, appearing whole or not at all. Opened with `wx` and filled in
 * after, it was empty for a moment; a second worker reading it then (a checkout
 * rewrites `HEAD` and `logs/HEAD` within milliseconds) found nothing parsable,
 * judged it abandoned and took it over, and two scans ran at once. The content
 * is written beside it and linked into place, which fails with EEXIST exactly
 * as `wx` does. A filesystem with no hard links takes the `wx` path.
 */
function create(path, content) {
  const temp = `${path}.new-${process.pid}-${randomBytes(8).toString("hex")}`;
  const fd = openSync(temp, "wx");
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temp, path);
  } catch (err) {
    if (err?.code === "EEXIST") throw err;
    const direct = openSync(path, "wx");
    try {
      writeSync(direct, content);
    } finally {
      closeSync(direct);
    }
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      // Already gone; nothing of ours is left.
    }
  }
}

function contentOf(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function stale(content) {
  let held;
  try {
    held = JSON.parse(content);
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
