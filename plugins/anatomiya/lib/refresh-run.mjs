/**
 * The refresh worker: the scan and the pin a moved HEAD calls for, run detached
 * by the `refresh` hook. Apart from the hook so a session start does not load
 * the scan to answer with a watch list.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, linkSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, join } from "node:path";

import { loadPin } from "./baseline.mjs";
import { runPin, runScan } from "./commands.mjs";
import { atomic, readFacts, readRecord, writeTemp } from "./facts.mjs";
import { BASE_REFS, caseMagic, commitAt, gitBuffered, gitStreamed, headSha, operationUnfinished, shaReachable } from "./git.mjs";
import { buildVersion } from "./readiness.mjs";
import { movedByRemote } from "./refresh.mjs";
import { carriedVerdict, checkerStamp, verdictStamp } from "./semantic.mjs";
import { OVERVIEW_FILE, readHead, realpathOf, REFRESH_STATE, resolveInside, STORE_DIR, targetState, trackedRulesDir } from "./rules.mjs";
import { isClaude, overviewName, TARGETS } from "./targets.mjs";
import { commonDirOf, gitDirOf } from "./worktree.mjs";

const LOCK_FILE = "refresh.lock";

// Left by a worker that found the lock taken, for the holder to read after it
// lets go.
const AGAIN_FILE = "refresh.again";

// A worker holds the lock for one scan, and the largest measured takes about
// two minutes. A lock older than this belongs to a worker that is not coming
// back, whatever its pid now names.
const LOCK_STALE_MS = 30 * 60 * 1000;

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
      round = await passes(root, store, { scan, pin });
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
async function passes(root, store, { scan, pin }) {
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
      const leaveAlone = await committedTargets(root);
      // A checker the last run measured as degraded, with nothing it reads
      // moved since, comes out the same and costs most of the scan. A scan run
      // by hand is handed no verdict and measures. The stamp reads the root
      // config, so it is taken only where there is a verdict to compare.
      const recorded = readFacts(root).facts?.semantic ?? null;
      const carried = recorded?.status === "degraded" ? carriedVerdict(recorded, verdictStamp(root, buildVersion())) : null;
      const options = { ...(leaveAlone.length > 0 ? { leaveAlone } : {}), ...(carried !== null ? { carried } : {}) };
      await (Object.keys(options).length > 0 ? scan(root, options) : scan(root));
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
 * the pin, this build, whether the repository holds packages, which of the two
 * config names the root is read through (`tsconfig.json`, `tsconfig.base.json`
 * or neither) and where typescript resolves, so installing the repository's
 * dependencies or adding a config after the first scan turns the checker on. Other working-tree edits are left out on purpose: they move with
 * every keystroke, and what a refresh follows is HEAD.
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
    .update(buildVersion() ?? "")
    .update("\0")
    .update(checkerStamp(root))
    .digest("hex");
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

/**
 * The other targets that are on and whose overview the repository commits, by
 * id. A scan here leaves those files as the commit has them, for the reason
 * above, and still writes the map nobody commits: a repository that commits
 * only the copy another tool reads from the remote has no other way to keep
 * the local one current. A question git could not answer leaves the target alone.
 */
async function committedTargets(root) {
  const magic = (await caseMagic(root)) ? ":(icase)" : "";
  const committed = [];
  for (const t of Object.values(TARGETS)) {
    if (isClaude(t) || targetState(root, t) !== "on") continue;
    const r = await gitBuffered(root, ["ls-files", "-z", "--", `${magic}${t.dir}/${overviewName(t)}`]);
    if (!r.ok || r.stdout.length > 0) committed.push(t.id);
  }
  return committed;
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
