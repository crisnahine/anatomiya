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
import { closeSync, existsSync, linkSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { loadPin } from "./baseline.mjs";
import { runPin, runScan } from "./commands.mjs";
import { atomic, readFacts, readRecord, writeTemp } from "./facts.mjs";
import { BASE_REFS, caseMagic, commitAt, gitBuffered, gitStreamed, headSha, operationUnfinished, shaReachable } from "./git.mjs";
import { childLayouts, isPathTaken, ownLayout } from "./hook.mjs";
import { pluginRoot } from "./readiness.mjs";
import { OVERVIEW_FILE, readHead, realpathOf, REFRESH_STATE, resolveInside, STORE_DIR, trackedRulesDir } from "./rules.mjs";
import { commonDirOf, gitDirOf } from "./worktree.mjs";

const LOCK_FILE = "refresh.lock";

// Left by a worker that found the lock taken, for the holder to read after it
// lets go.
const AGAIN_FILE = "refresh.again";

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
 * The worker: bring the map, and where it is safe the pin, up to date with the
 * checkout, and say what it did.
 *
 * `reason` is one of: scanned, current, failed, failed-before, busy, git-busy,
 * tracked, no-map, outside, no-head.
 */
export async function refreshRepository(root, { scan = runScan, pin = runPin } = {}) {
  const store = resolveInside(root, STORE_DIR);
  if (store === null) return { reason: "outside", pinned: false };
  // Only a checkout's own root: a scan resolves the root from wherever it is
  // started and writes there, so a worker handed a directory below one scanned
  // the enclosing checkout, which never opted in (A24).
  const top = await gitBuffered(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || realpathOf(top.stdout.trim()) !== realpathOf(root)) return { reason: "outside", pinned: false };
  const facts = readFacts(root).facts;
  if (!facts) return { reason: "no-map", pinned: false };
  // The type checker is opt-in and about 3x a plain scan (B7), so a refresh keeps the
  // mode the person chose: a map built with it is rebuilt with it, rather than
  // skipped (which left it stale after every checkout) or rebuilt without it
  // (which dropped the claims it added). A checker that is no longer installed
  // fails the rescan, and the previous map stays.
  const deep = facts.semantic?.ran === true;
  if (await mapTracked(root)) return { reason: "tracked", pinned: false };
  if (await gitBusy(root)) return { reason: "git-busy", pinned: false };

  const lockPath = join(store, LOCK_FILE);
  const again = join(store, AGAIN_FILE);
  let lock = acquire(lockPath);
  if (!lock) {
    // The holder may be past its last look at HEAD. It reads this after letting
    // go and runs again, so the move that started this worker is not lost.
    leaveWord(again);
    lock = acquire(lockPath);
    if (!lock) return { reason: "busy", pinned: false };
  }
  let result = null;
  let pinned = false;
  for (;;) {
    let round;
    try {
      round = await passes(root, store, { scan, pin, deep });
    } finally {
      release(lock);
    }
    result = result !== null && round.reason === "current" ? { ...round, reason: result.reason } : round;
    pinned ||= round.pinned;
    if (!takeWord(again)) return { ...result, pinned };
    lock = acquire(lockPath);
    if (!lock) return { ...result, pinned };
  }
}

/** Follow the pin, then rescan until HEAD holds still or the passes run out. */
async function passes(root, store, { scan, pin, deep }) {
  const { accepted, held } = await followPin(root, pin);
  const pinned = accepted !== null;
  for (let pass = 0; pass < PASSES; pass++) {
    const stamp = await stampOf(root);
    if (stamp === null) return { reason: "no-head", pinned, held };
    const state = readRecord(join(store, basename(REFRESH_STATE))).record;
    if (state?.stamp === stamp && (state.ok || !retryDue(state)) && sameHold(state.held, held)) {
      return { reason: state.ok ? (pass === 0 ? "current" : "scanned") : "failed-before", pinned, held };
    }
    if (state?.stamp === stamp && (state.ok || !retryDue(state))) {
      // Nothing to rescan; only what the pin decided is new.
      // The retry clock is the failure's, so it keeps its moment.
      writeState(store, { ...state, pinned: state.pinned ?? null, held });
      return { reason: state.ok ? "current" : "failed-before", pinned, held };
    }
    try {
      await scan(root, { deep });
    } catch (err) {
      // The previous map stays: a scan that throws has written nothing or
      // put back what it replaced, and one that would not run now will not
      // run on the next trigger either, until something about the checkout
      // changes.
      writeState(store, { stamp, ok: false, error: String(err?.message ?? err), pinned: accepted, held });
      return { reason: "failed", pinned, held };
    }
    writeState(store, { stamp, ok: true, error: null, pinned: accepted, held });
  }
  return { reason: "scanned", pinned, held };
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
    writeState(store, { stamp, ok: true, error: null, pinned: previous?.pinned ?? null, held: previous?.held ?? null });
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
  const none = { accepted: null, held: null };
  const head = await headSha(root);
  if (!head) return none;
  const tip = await remoteTip(root);
  if (tip === null || tip.sha !== head) return none;
  // Pushed is not reviewed, and a ref written by hand is not the remote's: a
  // session can `git push` or `git update-ref` itself. Only a fetch or a pull
  // moves the tracking ref for the remote. From here the checkout sits on the
  // tip, and a refusal is a hold the person hears about, never the model.
  const current = loadPin(root);
  if (current?.sha === head) return none;
  // Each hold names the pin it held, so a pin taken by hand since ends it.
  const hold = (reason, commit, by = null) => ({ accepted: null, held: { reason, commit, pin: current?.sha ?? null, ...(by ? { by } : {}) } });
  const moved = await fetchedHere(root, tip.ref, tip.sha);
  if (moved !== "fetched") return hold(moved === "no-record" ? "no-record" : "not-fetched", head);
  // A pinned commit git no longer holds (its branch merged, deleted and
  // collected) bounds nothing, and the line is read as for a first pin.
  const from = current !== null && (await shaReachable(root, current.sha)) ? current.sha : null;
  if (from !== null) {
    // Newer than this checkout: the remote was rewound, or this clone is
    // behind the one that pinned. Either way the pin does not move backwards.
    const newer = await gitBuffered(root, ["merge-base", "--is-ancestor", head, from]);
    if (newer.ok) return none;
  }
  const made = await madeHereOnLine(root, from, head);
  if (made === "") return hold("unread", head);
  if (made !== null) return hold("made-here", made.commit, made.by);
  // A staged or edited tracked file is refused by `pin` itself, the one rule for
  // what a pin may record, and so is HEAD having moved since it was judged here.
  // A refusal is simply no pin: the tree is mid-edit, not held.
  try {
    const { delta } = await pin(root, { expect: head });
    // What was accepted, kept where a person can read it: the pin is taken with
    // nobody watching, so this is the one place its population delta is said.
    return {
      accepted: { from: current?.sha ?? null, to: head, addedFiles: delta.addedFiles, removedFiles: delta.removedFiles },
      held: null,
    };
  } catch {
    return none;
  }
}

// Reflog entries that create no commit; every other entry is a commit made
// here, since a list of what creates commits missed each spelling git gives a
// rebase's steps (`pull -q --rebase (pick)`). Both ends are anchored: a pick
// subject "Fast-forward the lockfile" and a merge of `wip(start)` are commits.
const COMMAND = "(?:(?!: ).)*";
const CREATES_NOTHING = new RegExp(
  "^(clone|checkout|reset|branch|fetch|initial pull|update by push|remote set-head|remote: renamed)\\b" +
    `|^(pull|merge)\\b${COMMAND}: (fast-forward|storing head|forced-update)$` +
    "|^cherry-pick: fast-forward$" +
    `|^(rebase|pull)\\b${COMMAND} \\((start|finish|abort|reset|label|update-refs)\\): `,
  "i"
);

/**
 * Whether a commit this clone created sits on the first-parent line the pin
 * would move along. A fetched tip is not enough: `git push <url>` moves no
 * tracking ref, so the fetch after it is ordinary, and brings this clone's own
 * commit back as if the team had. The line is first-parent only because that is
 * what a direct push writes; a branch merged on the remote with a merge commit
 * sits behind its second parent, the merge being its review, and counting it
 * stalled the pin for every merge-commit workflow. Branch reflogs are shared by
 * every worktree, and a commit made on a detached HEAD in a linked worktree is
 * the one this does not see. A walk git could not answer is left open, never
 * read as a teammate's.
 *
 * The commit found and what matched it (`reflog` or `identity`), so the hold
 * can say which; `""` where git could not answer, and null where nothing on
 * the line was made here.
 */
async function madeHereOnLine(root, from, to) {
  // Both walks grow with the repository, a first pin's with its whole history,
  // so they stream (F6). `-z` separates records with a NUL, and whether git
  // also ends the last one is left open (`terminated: false`).
  const made = new Set();
  let found = null;
  try {
    const me = await committerEmail(root);
    // Past a pin, the pin bounds the line. A first pin reads the whole of it.
    const since = from === null ? await clonedAt(root) : null;
    // Each entry with the ref it belongs to. A remote-tracking ref's entries are
    // never where a commit is created (a fetch, a push, a clone or a hand
    // write moves it); read as one, the entry a reftable clone writes there
    // with an empty message held the pin on every reftable clone (git 2.51).
    await gitStreamed(root, ["log", "-g", "--all", "-z", "--format=%H %gD %gs"], (entry) => {
      const [sha, selector = ""] = entry.split(" ", 2);
      if (!sha || selector.startsWith("refs/remotes/")) return;
      const message = entry.slice(sha.length + selector.length + 2);
      // `git worktree add` logs the new HEAD with no message at all, and from
      // inside that worktree its HEAD is spelled plain `HEAD`.
      if (message === "" && /^(?:worktrees\/[^/]+\/|main-worktree\/)?HEAD@\{/.test(selector)) return;
      if (!CREATES_NOTHING.test(message)) made.add(sha);
    }, { terminated: false });
    if (made.size === 0 && me === null) return null;
    await gitStreamed(root, ["log", "--first-parent", "-z", "--format=%H %ct %ce", from ? `${from}..${to}` : to], (record) => {
      const [sha, time, email = ""] = record.trim().split(" ");
      const mine = me !== null && email.toLowerCase() === me && (since === null || Number(time) >= since);
      if (!made.has(sha) && !mine) return true;
      found = { commit: sha, by: made.has(sha) ? "reflog" : "identity" };
      return false;
    }, { terminated: false });
  } catch {
    return "";
  }
  return found;
}

/**
 * The address this clone commits as, lowercased, or null where git names none:
 * git makes no commit without one, so there is nothing for this half to find.
 *
 * The reflog forgets: removing a linked worktree drops its HEAD's log,
 * deleting a branch drops the branch's, and `gc` expires every entry after 90
 * days, and each of those let this clone's own commit pass as a teammate's
 * once a fetch brought it back. The committer on the commit itself does not
 * forget. A merge or a squash made on the remote carries the host's committer
 * and still pins; a fast-forward merge on a host that keeps the author as
 * committer holds, the safe direction.
 */
async function committerEmail(root) {
  const r = await gitBuffered(root, ["var", "GIT_COMMITTER_IDENT"]);
  const email = r.ok ? /<([^>]*)>/.exec(r.stdout)?.[1]?.trim().toLowerCase() : "";
  return email ? email : null;
}

/**
 * The earliest moment this clone is known to exist, in seconds, or null where
 * nothing says. The committer names who made a commit, not where: read over a
 * first pin's whole line, one commit this person pushed from another machine
 * years before held it for good. `description` is written when a clone is made
 * and never again. The oldest reflog entry stands in where it is gone, and
 * alone it let a commit through once `gc` expired every entry older than it.
 */
async function clonedAt(root) {
  const times = [];
  const gitdir = gitDirOf(root);
  try {
    if (gitdir !== null) times.push(Math.floor(lstatSync(join(commonDirOf(gitdir), "description")).mtimeMs / 1000));
  } catch {
    // No such file, which a clone made without templates leaves.
  }
  const log = await gitBuffered(root, ["reflog", "show", "--date=unix", "--format=%gd", "main-worktree/HEAD"]);
  const oldest = log.ok ? (log.stdout.trimEnd().split("\n").pop() ?? "") : "";
  const at = /@\{(\d+)\}$/.exec(oldest)?.[1];
  if (at !== undefined) times.push(Number(at));
  return times.length > 0 ? Math.min(...times) : null;
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
    const sha = await commitAt(root, ref);
    if (sha) return { sha, ref };
  }
  return null;
}

/**
 * How the remote-tracking ref last moved: `fetched` by a fetch or a pull,
 * `moved-here` by this clone (a push, a ref written by hand, a fetch naming its
 * own source), or `no-record` where git kept none to tell by.
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
  if (!name.startsWith("refs/remotes/")) return "moved-here";
  const last = await gitBuffered(root, ["reflog", "show", "-n1", "--format=%gs", name]);
  if (!last.ok) return "no-record";
  const message = last.stdout.trim();
  if (message !== "") return movedByRemote(message) ? "fetched" : "moved-here";
  return (await clonedOnto(root, sha)) ? "fetched" : "no-record";
}

/** Whether the main checkout's oldest reflog entry is the clone that checked out `sha`. */
async function clonedOnto(root, sha) {
  const log = await gitBuffered(root, ["reflog", "show", "--format=%H %gs", "main-worktree/HEAD"]);
  if (!log.ok) return false;
  const first = log.stdout.trimEnd().split("\n").pop() ?? "";
  return first.startsWith(`${sha} clone: `);
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
 * Whether the repository commits what this tool writes. A committed map travels
 * with every branch already, a committed pin can never name the commit that
 * holds it, and the lock and the word are removed after use, so following any
 * of them would leave a change in `git status` nobody made.
 */
async function mapTracked(root) {
  const magic = (await caseMagic(root)) ? ":(icase)" : "";
  const r = await gitBuffered(root, ["ls-files", "-z", "--", `${magic}${trackedRulesDir(root)}/${OVERVIEW_FILE}`, `${magic}${STORE_DIR}`]);
  return r.ok && r.stdout.length > 0;
}

async function gitBusy(root) {
  const r = await gitBuffered(root, ["rev-parse", "--absolute-git-dir"]);
  return !r.ok || operationUnfinished(r.stdout.trim());
}

function writeState(store, { stamp, ok, error, pinned = null, held = null, at = new Date().toISOString() }) {
  const record = { stamp, ok, error, at, ...(pinned ? { pinned } : {}), ...(held ? { held } : {}) };
  atomic(join(store, basename(REFRESH_STATE)), JSON.stringify(record, null, 2) + "\n");
}

const sameHold = (a, b) => ["reason", "commit", "pin", "by"].every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));

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
  const shown = /^[\w.@+-]+$/.test(name) ? name : JSON.stringify(name);
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
    const content = JSON.stringify({ pid: process.pid, at: Date.now(), nonce: randomBytes(8).toString("hex") });
    try {
      create(path, content);
      return { path, content };
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
        remove(aside);
        return null;
      }
      remove(aside);
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
  const temp = writeTemp(path, content);
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

// Bounded and typed, since the directory can come with the repository: a lock
// planted as a link to `/dev/zero` read whole never returned. Ours is under 100 bytes.
function contentOf(path) {
  const entry = readHead(path, 256);
  return entry.kind === "file" ? entry.head : null;
}

function stale(content) {
  let held;
  try {
    held = JSON.parse(content);
  } catch {
    return true;
  }
  if (!Number.isInteger(held?.pid) || !Number.isFinite(held?.at)) return true;
  // A moment that has not come yet is no worker's on this machine.
  const age = Date.now() - held.at;
  if (age < 0 || age > LOCK_STALE_MS) return true;
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

/**
 * Give the lock back, but only while it is still this worker's. A takeover
 * can leave the entry at the lock's path belonging to another worker (three
 * interleaving over one stale lock), and unlinking by path then freed a live
 * worker's lock for a fourth to take.
 */
function release(lock) {
  if (contentOf(lock.path) === lock.content) remove(lock.path);
}

function remove(path) {
  try {
    unlinkSync(path);
  } catch {
    // Already gone is released.
  }
}

// Exclusive, so a link planted at the path is never followed.
function leaveWord(path) {
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    // Already left, which says the same thing.
  }
}

function takeWord(path) {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
