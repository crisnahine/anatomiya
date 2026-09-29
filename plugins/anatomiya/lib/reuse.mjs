/**
 * The end-of-turn reuse check: which source lines a turn added, and the one
 * reason that asks for them to be checked against what the repository already
 * has (A91).
 *
 * The wording is the one that passed 24 of 24 hard cases where every wording
 * the model answered inline passed 9 or 10 of 12, and it is held word for word
 * because that measurement is the only reason it is here
 * (`docs/research/one-line-that-finds-the-existing-function.md`).
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { addedRanges, pendingPaths } from "./check.mjs";
import { isCorpusPath } from "./corpus.mjs";
import { encodePath } from "./encode.mjs";
import { gitBuffered, operationUnfinished } from "./git.mjs";
import { isPathTaken } from "./hook.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { byCode } from "./paths.mjs";
import { readHead, readTail } from "./rules.mjs";

/** What an ask or a record carries, so a later stop can tell which files it covered. */
export const REUSE_MARK = "anatomiya reuse check";

/** How long each git read may take, inside the timeout the hook declares. */
export const REUSE_GIT_MS = 5000;

const REASON_OPENING = "Before you finish, give one subagent this change's diff";

// The reason points at the change and the subagent reads the diff itself, so a
// long list buys nothing but tokens on every block.
const LISTED_MOST = 20;

// Enough for any turn a person would call one change, and a bound on the tag.
const MARKED_MOST = 200;

// This session's own asks sit at the end of its transcript, and its first
// entry at the start.
const TRANSCRIPT_MOST = 64 * 1024 * 1024;
const TRANSCRIPT_HEAD = 64 * 1024;

// A turn's commits are the last lines of the reflog, and one kept for years
// runs to megabytes.
const REFLOG_TAIL = 256 * 1024;

// `<old> <new> <name> <email> <seconds> <zone>\t<message>`.
const REFLOG_ENTRY = /^([0-9a-f]+) ([0-9a-f]+) .*> (\d+) [+-]\d{4}\t(.*)$/;

// What `git commit` writes, and `--amend`, whose parent is the commit it
// replaced. `commit (initial)` and `commit (merge)` are left out on purpose.
const OWN_COMMIT = /^commit(?: \(amend\))?: /;

const MARKS_READ = new RegExp(`${REUSE_MARK} ((?:[0-9a-f]{12} ?)+)\\)`, "g");

// A name a repository chose is shown as it is only where it cannot carry a
// line break or a quote into the reason the model reads.
const PLAIN_PATH = /^[\w./@+-]+$/;

const tag = (files) => `(${REUSE_MARK} ${files.slice(0, MARKED_MOST).map((f) => f.mark).join(" ")})`;

/** The measured wording, with the lines these files added and the tag that covers them. */
export function reuseReason(files) {
  const lines = files.flatMap((f) => {
    const shown = PLAIN_PATH.test(f.path) ? f.path : encodePath(f.path);
    return f.hunks.map((h) => `${shown}:${h.from}-${h.to}${h.created ? " (new file)" : ""}`);
  });
  const more = lines.length - LISTED_MOST;
  const list = `${lines.slice(0, LISTED_MOST).join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
  return (
    `${REASON_OPENING} and these added functions: ${list}. ` +
    "Have it grep shared and utility modules, files near the change, and code making the same calls, then name any existing function that does the same job. " +
    "Call each named function and delete the copy it replaces. If it names none, finish without changing anything.\n" +
    tag(files)
  );
}

/** What the stop after a check says, which is also what keeps those files from being asked about again. */
export function reuseRecord(files) {
  return `anatomiya checked ${files.length} changed ${files.length === 1 ? "file" : "files"} for existing functions ${tag(files)}`;
}

/**
 * Each changed source file with the lines the working tree adds over HEAD, or
 * null where there are none or git would not say.
 *
 * A file's mark is taken over its content rather than its line numbers, since
 * two different edits can land on the same lines, and per file, so an edit to
 * one file does not make every other one look new. `since` leaves out a file
 * last written before that moment, which is work the session did not do, and
 * nothing is read while a merge or the like is unfinished, which is another
 * branch's.
 *
 * `turnStart` adds what this turn committed: a turn told to write and commit
 * leaves the tree clean, and read against HEAD alone its work was never asked
 * about. The commits are found in the reflog rather than in state this writes,
 * since a marker file would be one more change `git status` reports (A91).
 */
export async function pendingChange(root, { since = null, turnStart = null } = {}) {
  // git names every path from the top of the checkout, which is where a scan
  // writes its record. A record further down came with a copy of another
  // project, and joined against it git's paths name files nobody changed.
  if (!isPathTaken(join(root, ".git"))) return null;
  // Asked beside the status read rather than after it, so the hook still makes
  // two git reads in a row inside the time it declares.
  const [pending, gitdir] = await Promise.all([pendingPaths(root, { timeout: REUSE_GIT_MS }), gitDir(root)]);
  if (gitdir === null || operationUnfinished(gitdir) || pending === null) return null;
  // One diff from before the turn's first commit to the tree reads what it
  // committed and what it left uncommitted together, so the reads in a row
  // stay two however many commits the turn made.
  const base = turnStart === null ? null : await committedSince(root, gitdir, turnStart);
  if (pending.present.length === 0 && base === null) return null;
  const edited = base !== null || pending.present.some((p) => p.status === "M");
  const ranges = edited ? await addedRanges(root, base ?? "HEAD", null, { timeout: REUSE_GIT_MS }) : new Map();
  if (ranges === null) return null;

  // A committed file is in the diff and nowhere in the status, and reads as an
  // edit: its hunks are the lines it added over the turn's base.
  const listed = new Set(pending.present.map((p) => p.path));
  const committed = [...ranges.keys()].filter((path) => !listed.has(path) && isCorpusPath(path));
  const changed = [...pending.present, ...committed.map((path) => ({ path, status: "M" }))];
  const files = [];
  for (const { path, status } of changed.sort((a, b) => byCode(a.path, b.path))) {
    const entry = readHead(join(root, path), MAX_FILE_BYTES + 1);
    // Past the size the parser skips, or not a file: nothing this reads either.
    if (entry.kind !== "file" || entry.size > MAX_FILE_BYTES) continue;
    if (since !== null && entry.mtimeMs < since) continue;
    const hunks =
      status === "A"
        ? [{ from: 1, to: lineCount(entry.head), created: true }].filter((h) => h.to > 0)
        : (ranges.get(path) ?? []).map(([from, to]) => ({ from, to, created: false }));
    if (hunks.length === 0) continue;
    const mark = createHash("sha256").update(`${path}\0`).update(entry.head).digest("hex").slice(0, 12);
    files.push({ path, mark, hunks });
  }
  return files.length > 0 ? files : null;
}

/**
 * This checkout's git directory, or null where git will not name one.
 *
 * It says whether a merge, a pick, a revert or a rebase is waiting to be
 * finished, and it holds the reflog. A git directory nobody can name asks
 * nothing: the status read beside this one fails the same way.
 */
async function gitDir(root) {
  const r = await gitBuffered(root, ["rev-parse", "--absolute-git-dir"], { timeout: REUSE_GIT_MS });
  const dir = r.ok ? r.stdout.trim() : "";
  return dir === "" ? null : dir;
}

/**
 * The commit this turn's own commits were made on top of, or null where the
 * turn committed nothing it can be charged with.
 *
 * `logs/HEAD` records every move of HEAD with the second it happened. Only the
 * commits made after the turn's last checkout, pull, reset, merge or rebase
 * are its own, since each of those brings in work nobody in this session
 * wrote. A first commit has no parent to diff from and a merge commit holds
 * the other side's work, so either ends the run the way a move does.
 *
 * Read off the file where there is one, which costs no git read. The reftable
 * backend keeps no `logs/`, and there the same entries are asked of git: read
 * off the file alone, a turn that committed everything it wrote was never
 * asked about on reftable.
 */
async function committedSince(root, gitdir, turnStart) {
  const entries = headMoves(gitdir) ?? (await headMovesFromGit(root));
  if (entries === null) return null;
  let run = null;
  for (const { from, to, seconds, message } of entries) {
    // A second the reflog recorded is the turn's if any part of it is.
    if ((seconds + 1) * 1000 <= turnStart) continue;
    if (!OWN_COMMIT.test(message)) run = null;
    else if (from === null || run === null || run.to !== from) run = from === null ? null : { from, to };
    else run.to = to;
  }
  return run === null ? null : run.from;
}

/** HEAD's moves, oldest first, off `logs/HEAD`; null where there is no such file. */
function headMoves(gitdir) {
  const log = readTail(join(gitdir, "logs", "HEAD"), REFLOG_TAIL);
  if (log === null) return null;
  const moves = [];
  for (const line of log.split("\n")) {
    const entry = REFLOG_ENTRY.exec(line);
    if (entry !== null) moves.push({ from: entry[1], to: entry[2], seconds: Number(entry[3]), message: entry[4] });
  }
  return moves;
}

// How far back git is asked, where there is no file to read the tail of. A
// turn's commits are the newest entries.
const REFLOG_ASKED = 256;

/**
 * The same moves asked of git, oldest first. Git names each entry's new commit
 * and not the one it moved from, which is the entry before it; the oldest one
 * asked has no such entry and cannot start a run.
 */
async function headMovesFromGit(root) {
  const r = await gitBuffered(
    root,
    ["log", "-g", `--max-count=${REFLOG_ASKED}`, "--date=unix", "--format=%H %gd %gs", "HEAD"],
    { timeout: REUSE_GIT_MS }
  );
  if (!r.ok) return null;
  const moves = [];
  for (const line of r.stdout.split("\n").reverse()) {
    const entry = /^([0-9a-f]+) [^@]*@\{(\d+)\} (.*)$/.exec(line);
    if (entry === null) continue;
    moves.push({ from: moves.at(-1)?.to ?? null, to: entry[1], seconds: Number(entry[2]), message: entry[3] });
  }
  return moves;
}

const lineCount = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/**
 * The moment this session's transcript began, or null where it cannot be read.
 *
 * Its first entry carrying a timestamp, which 2.1.272 writes before the first
 * prompt is answered.
 */
export function sessionStart(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
  const entry = readHead(transcriptPath, TRANSCRIPT_HEAD);
  if (entry.kind !== "file") return null;
  for (const line of entry.head.split("\n")) {
    const at = /"timestamp":"([^"]+)"/.exec(line);
    const ms = at ? Date.parse(at[1]) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * The moment this turn's prompt arrived, or null where the transcript names none.
 *
 * The last user entry that a person wrote: a tool's result and a hook's block
 * reason are written as user entries too, and either would move the turn's
 * start past the commits it made. Read from the end, so a long session parses
 * only the lines after its last prompt.
 */
export function turnStart(transcriptPath) {
  const tail = readTail(transcriptPath, TRANSCRIPT_MOST);
  if (tail === null) return null;
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("\"user\"")) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type !== "user" || entry.isMeta === true) continue;
    const content = entry.message?.content;
    if (Array.isArray(content) && content.some((part) => part?.type === "tool_result")) continue;
    const ms = Date.parse(entry.timestamp);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * The marks this session's transcript already holds, from an ask or a record.
 *
 * A transcript that cannot be read holds none: the worst that costs is one more
 * search, where a mark read that was never there would skip a file nobody checked.
 */
export function askedMarks(transcriptPath) {
  const marks = new Set();
  const tail = readTail(transcriptPath, TRANSCRIPT_MOST);
  if (tail === null) return marks;
  for (const [, list] of tail.matchAll(MARKS_READ)) {
    for (const mark of list.trim().split(" ")) marks.add(mark);
  }
  return marks;
}

/**
 * Whether the last block this session saw at a stop was this hook's own.
 *
 * `stop_hook_active` says some hook continued the turn, not which one, and
 * recording after another hook's block would mark a file checked that no search
 * read.
 */
export function continuedByReuse(transcriptPath) {
  const tail = readTail(transcriptPath, TRANSCRIPT_MOST);
  if (tail === null) return false;
  const last = tail.lastIndexOf("Stop hook feedback:");
  return last !== -1 && tail.indexOf(REASON_OPENING, last) !== -1;
}
